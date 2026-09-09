import assert from 'node:assert/strict'
import test from 'node:test'
import { createBoundaryEditSession } from '../src/boundary-edit.js'
import { createKJDrawSDK, KJDocument } from '../src/index.js'

const records = document => Object.fromEntries(document.listObjects({ includeErased: true }).map(record => [record.id, record]))
const code = value => error => error.details?.code === `boundary-edit.${value}`

async function expectUnexpectedCommit(promise, session) {
  await assert.rejects(promise, code('unexpected-commit'))
  assert.equal(session.state.committedCount, 0)
  assert.equal(session.state.phase, 'cancelled')
}

async function fixture(operation = 'trim', options = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const create = (type, payload) => sdk.executeCommand('CREATE', { type, payload }, { document })
  const boundaries = [await create('LINE', { start: [3, -10, 6], end: [3, 15, 6] }), await create('LINE', { start: [7, -10, 6], end: [7, 15, 6] })]
  const targets = []
  for (const y of [0, 5]) targets.push(await create('LINE', { start: [0, y, 6], end: [operation === 'trim' ? 10 : 2, y, 6], color: 2, lineweight: 35 }))
  const session = createBoundaryEditSession(operation, { document, ...options })
  const execute = request => sdk.executeCommandEnvelope(sdk.createCommandEnvelope(request.command, request.arguments, {
    document, expectedRevision: request.expectedRevision, origin: 'ui',
  }), { document })
  return { sdk, document, create, boundaries, targets, session, execute }
}

for (const operation of ['trim', 'extend']) test(`continuous ${operation} locks boundaries once, commits each target separately and reopens exact records`, async () => {
  const { sdk, document, boundaries, targets, session, execute } = await fixture(operation)
  const ids = boundaries.map(entity => entity.id), before = records(document), revision = document.revision
  session.setBoundaries([...ids, ids[0]])
  ids.length = 0
  assert.equal(session.state.boundaryIds.length, 2)
  assert.throws(() => session.preview(targets[0].id, [1, 0]), code('phase'))
  session.confirmBoundaries()
  const previews = targets.map((target, index) => session.preview(target.id, [operation === 'trim' ? 5 : 2, index * 5]))
  assert.deepEqual(records(document), before)
  assert.equal(document.revision, revision)
  assert.equal(previews[0].pieces.length, operation === 'trim' ? 2 : 1)
  await session.apply(previews[0], execute)
  const first = records(document)
  assert.equal(document.revision, revision + 1)
  assert.equal(session.state.phase, 'targets')
  await assert.rejects(session.apply(previews[1], execute), code('stale-preview'))
  await session.apply(session.preview(targets[1].id, [operation === 'trim' ? 5 : 2, 5]), execute)
  const after = records(document)
  assert.equal(session.state.committedCount, 2)
  assert.equal(document.revision, revision + 2)
  for (const boundary of boundaries) assert.deepEqual(document.getObject(boundary.id), boundary)
  for (const target of targets) {
    const result = document.getObject(target.id)
    assert.deepEqual(result.payload.end, [3, target.payload.start[1], 6])
    assert.equal(result.payload.color, 2)
    assert.equal(result.payload.lineweight, 35)
  }
  session.finish()
  assert.throws(() => session.preview(targets[0].id, [1, 0]), code('stale-session'))
  await sdk.executeCommand('UNDO'); assert.deepEqual(records(document), first)
  await sdk.executeCommand('UNDO'); assert.deepEqual(records(document), before)
  await sdk.executeCommand('REDO'); await sdk.executeCommand('REDO')
  assert.deepEqual(records(document), after)
  assert.deepEqual(records(KJDocument.open(document.serialize())), after)
})

test('preview data is deeply immutable; foreign, cloned and consumed previews cannot execute', async () => {
  const { document, boundaries, targets, session, execute } = await fixture()
  session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
  const preview = session.preview(targets[0].id, [5, 0]), before = records(document)
  assert.throws(() => { preview.command.arguments.id = targets[1].id }, TypeError)
  assert.throws(() => { preview.pieces[0].payload.end[0] = 999 }, TypeError)
  await assert.rejects(session.apply(structuredClone(preview), execute), code('stale-preview'))
  const other = createBoundaryEditSession('trim', { document, boundaryIds: boundaries.map(entity => entity.id) })
  other.confirmBoundaries()
  await assert.rejects(other.apply(preview, execute), code('stale-preview'))
  assert.deepEqual(records(document), before)
  await session.apply(preview, execute)
  await assert.rejects(session.apply(preview, execute), code('stale-preview'))
})

test('invalid boundaries, self targets, geometry failures and invalid points preserve the session for retry', async () => {
  const { document, boundaries, targets, session, execute, create } = await fixture()
  const point = await create('POINT', { position: [0, 0] })
  // A session does not rebase to mutations performed after it was created.
  assert.throws(() => session.setBoundaries([point.id]), code('stale-session'))
  const retry = createBoundaryEditSession('trim', { document })
  assert.throws(() => retry.confirmBoundaries(), code('empty-boundaries'))
  assert.throws(() => retry.setBoundaries([point.id]), code('boundary-type'))
  assert.throws(() => retry.setBoundaries(['missing']), code('missing-entity'))
  retry.setBoundaries(boundaries.map(entity => entity.id)); retry.confirmBoundaries()
  const before = records(document)
  assert.throws(() => retry.preview(boundaries[0].id, [3, 0]), code('boundary-as-target'))
  assert.throws(() => retry.preview(targets[0].id, [NaN, 0]), code('invalid-point'))
  assert.throws(() => retry.preview(targets[0].id, [3, 0]), code('geometry'))
  assert.deepEqual(records(document), before)
  assert.equal(retry.state.phase, 'targets')
  await retry.apply(retry.preview(targets[0].id, [5, 0]), execute)
})

test('external revisions and mounted-document replacement invalidate previews without modifying either drawing', async () => {
  for (const reason of ['revision', 'replacement']) {
    let current = true
    const { document, boundaries, targets, session, execute, create } = await fixture('trim', { isDocumentCurrent: () => current })
    session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
    const preview = session.preview(targets[0].id, [5, 0])
    if (reason === 'revision') await create('POINT', { position: [20, 20] })
    else current = false
    const before = records(document)
    await assert.rejects(session.apply(preview, execute), code('stale-session'))
    assert.equal(session.state.phase, 'cancelled')
    assert.deepEqual(records(document), before)
  }
})

test('protected targets reject in preview while locked boundaries remain usable', async () => {
  const { sdk, document, boundaries, targets, execute } = await fixture()
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Protected' })
  await document.transact('Protect boundary', tx => {
    tx.updateObject(boundaries[0].id, { payload: { layerId: layer.id } })
    tx.updateObject(layer.id, { payload: { locked: true } })
  })
  const session = createBoundaryEditSession('trim', { document, boundaryIds: boundaries.map(entity => entity.id) })
  session.confirmBoundaries()
  await session.apply(session.preview(targets[0].id, [5, 0]), execute)
  await document.transact('Protect target', tx => tx.updateObject(targets[1].id, { payload: { layerId: layer.id } }))
  const protectedSession = createBoundaryEditSession('trim', { document, boundaryIds: boundaries.map(entity => entity.id) })
  protectedSession.confirmBoundaries()
  const before = records(document)
  assert.throws(() => protectedSession.preview(targets[1].id, [5, 5]), code('protected-target'))
  assert.deepEqual(records(document), before)
})

test('failed execution can retry with a fresh preview; concurrent applications never dispatch twice', async () => {
  const { boundaries, targets, session, execute } = await fixture()
  session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
  const preview = session.preview(targets[0].id, [5, 0])
  await assert.rejects(session.apply(preview, async () => { throw new Error('provider unavailable') }), /provider unavailable/)
  assert.equal(session.state.phase, 'targets')
  await assert.rejects(session.apply(preview, execute), code('stale-preview'))
  let release, calls = 0
  const ready = new Promise(resolve => { release = resolve })
  const next = session.preview(targets[0].id, [5, 0])
  const pending = session.apply(next, async request => { calls += 1; await ready; return execute(request) })
  await assert.rejects(session.apply(next, execute), code('phase'))
  release(); await pending
  assert.equal(calls, 1)
  assert.equal(session.state.committedCount, 1)
})

test('cancelling an in-flight edit never resurrects the session or pretends to undo its dispatched commit', async () => {
  const { document, boundaries, targets, session, execute } = await fixture()
  session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
  let release
  const ready = new Promise(resolve => { release = resolve }), revision = document.revision
  const pending = session.apply(session.preview(targets[0].id, [5, 0]), async request => { await ready; return execute(request) })
  session.cancel(); release(); await pending
  assert.equal(session.state.phase, 'cancelled')
  assert.equal(session.state.committedCount, 1)
  assert.equal(document.revision, revision + 1)
  assert.throws(() => session.preview(targets[1].id, [5, 5]), code('stale-session'))
})

test('locale changes keep the chosen boundaries and phase; a no-op executor is not reported as a completed edit', async () => {
  const { document, boundaries, targets, session } = await fixture()
  session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
  const before = session.state
  session.setLocale('zh')
  assert.match(session.prompt, /连续点选/)
  assert.deepEqual(session.state, before)
  const revision = document.revision
  await assert.rejects(session.apply(session.preview(targets[0].id, [5, 0]), async () => ({ status: 'planned' })), code('unexpected-commit'))
  assert.equal(session.state.committedCount, 0)
  assert.equal(document.revision, revision)
})

test('the same geometric preview feeds review-bound AI commands, rejects changed arguments and remains one undo step', async () => {
  const { sdk, document, boundaries, targets, session } = await fixture()
  session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
  const before = records(document), preview = session.preview(targets[0].id, [5, 0])
  const plan = sdk.createCommandEnvelope(preview.command.command, preview.command.arguments, {
    document, expectedRevision: preview.revision, origin: 'ai', mode: 'plan',
  })
  assert.equal((await sdk.executeCommandEnvelope(plan, { document })).status, 'planned')
  assert.deepEqual(records(document), before)
  const confirm = args => sdk.createCommandEnvelope(plan.command, args, {
    document, expectedRevision: plan.expectedRevision, origin: 'ai',
    confirmation: { status: 'confirmed', planId: plan.id, confirmedBy: 'test-reviewer' },
  })
  await assert.rejects(sdk.executeCommandEnvelope(confirm({ ...plan.arguments, id: targets[1].id }), { document }), /do not match/)
  const receipt = await session.apply(preview, request => sdk.executeCommandEnvelope(confirm(request.arguments), { document }))
  assert.equal(receipt.status, 'committed')
  assert.equal(sdk.agentPlans.get(plan.id).status, 'consumed')
  assert.deepEqual(document.getObject(targets[1].id), targets[1])
  await sdk.executeCommand('UNDO')
  assert.deepEqual(records(document), before)
})

test('a different one-revision command cannot masquerade as the previewed boundary edit', async () => {
  const { sdk, document, boundaries, targets, session } = await fixture()
  session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
  const preview = session.preview(targets[0].id, [5, 0])
  const targetBefore = document.getObject(targets[0].id), revision = document.revision
  let wrongReceipt

  await expectUnexpectedCommit(session.apply(preview, async request => {
    const envelope = sdk.createCommandEnvelope('CREATE', { type: 'POINT', payload: { position: [99, 99] } }, {
      document, expectedRevision: request.expectedRevision, origin: 'ui',
    })
    wrongReceipt = await sdk.executeCommandEnvelope(envelope, { document })
    return wrongReceipt
  }), session)

  assert.equal(document.revision, revision + 1)
  assert.deepEqual(document.getObject(targets[0].id), targetBefore)
  assert.equal(document.getObject(wrongReceipt.result.id).type, 'POINT')
  assert.deepEqual(document.getObject(wrongReceipt.result.id).payload.position, [99, 99, 0])
})

test('an unrelated concurrent commit cannot satisfy a pending boundary executor', async () => {
  const { sdk, document, boundaries, targets, session } = await fixture()
  session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
  const preview = session.preview(targets[0].id, [5, 0])
  const targetBefore = document.getObject(targets[0].id), revision = document.revision
  let release, unrelatedReceipt
  const waiting = new Promise(resolve => { release = resolve })
  const pending = session.apply(preview, async () => { await waiting; return unrelatedReceipt })

  const envelope = sdk.createCommandEnvelope('CREATE', { type: 'POINT', payload: { position: [88, 88] } }, {
    document, expectedRevision: revision, origin: 'ui',
  })
  unrelatedReceipt = await sdk.executeCommandEnvelope(envelope, { document })
  release()
  await expectUnexpectedCommit(pending, session)

  assert.equal(document.revision, revision + 1)
  assert.deepEqual(document.getObject(targets[0].id), targetBefore)
  assert.deepEqual(document.getObject(unrelatedReceipt.result.id).payload.position, [88, 88, 0])
})

test('malformed and forged callback receipts cannot report a boundary commit', async t => {
  await t.test('a committed-looking object without a document commit is rejected', async () => {
    const { document, boundaries, targets, session } = await fixture()
    session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
    const revision = document.revision
    await expectUnexpectedCommit(session.apply(session.preview(targets[0].id, [5, 0]), async request => ({
      status: 'committed', command: request.command, documentId: document.id,
      beforeRevision: revision, afterRevision: revision + 1,
    })), session)
    assert.equal(document.revision, revision)
  })

  await t.test('a forged receipt does not roll back the real commit it misreports', async () => {
    const { document, boundaries, targets, session, execute } = await fixture()
    session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
    const before = records(document), revision = document.revision
    await expectUnexpectedCommit(session.apply(session.preview(targets[0].id, [5, 0]), async request => {
      const receipt = await execute(request)
      return { ...receipt, commandEnvelopeId: 'forged-envelope-id' }
    }), session)
    assert.equal(document.revision, revision + 1)
    assert.notDeepEqual(records(document), before)
  })
})

test('the exact TRIM arguments are bound even when another pick yields identical geometry', async () => {
  const { sdk, document, boundaries, targets, session } = await fixture()
  session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
  const preview = session.preview(targets[0].id, [5, 0])
  const before = records(document), revision = document.revision

  await expectUnexpectedCommit(session.apply(preview, request => {
    const arguments_ = { ...request.arguments, pickPoint: [4, 0] }
    const envelope = sdk.createCommandEnvelope(request.command, arguments_, {
      document, expectedRevision: request.expectedRevision, origin: 'ui',
    })
    return sdk.executeCommandEnvelope(envelope, { document })
  }), session)

  assert.equal(document.revision, revision + 1)
  assert.notDeepEqual(records(document), before)
  assert.deepEqual(document.getObject(targets[0].id).payload, preview.pieces[0].payload)
  const retained = document.listEntities().filter(entity => entity.source?.derivedFromId === targets[0].id)
  assert.equal(retained.some(entity => JSON.stringify(entity.payload) === JSON.stringify(preview.pieces[1].payload)), true)
})

test('a host replacement with matching TRIM metadata and receipt cannot commit different geometry', async () => {
  const { sdk, document, boundaries, targets, session, execute } = await fixture()
  session.setBoundaries(boundaries.map(entity => entity.id)); session.confirmBoundaries()
  const preview = session.preview(targets[0].id, [5, 0]), revision = document.revision
  sdk.commands.register({
    id: 'TRIM', aliases: ['TR'], title: 'Host trim replacement',
    execute: ({ document: drawing, transaction }, args) => {
      const target = drawing.getObject(String(args.id))
      return transaction.updateObject(target.id, { payload: { ...target.payload, end: [9, 9, 6] } })
    },
  }, { owner: 'test.host', replace: true })

  await expectUnexpectedCommit(session.apply(preview, execute), session)
  assert.equal(document.revision, revision + 1)
  assert.deepEqual(document.getObject(targets[0].id).payload.end, [9, 9, 6])
})

test('a compacted TRIM commit discovers derived pieces from snapshots and remains one undo step', async () => {
  const { sdk, document, boundaries, targets, execute } = await fixture()
  const ownerId = document.snapshot().namedObjectsDictionaryId
  const groupIds = await document.transact('Create bulk trim memberships', transaction => Array.from({ length: 1001 }, (_, index) => transaction.createObject({
    kind: 'group', type: 'GROUP', ownerId, name: `Bulk trim group ${index}`,
    payload: { memberIds: [targets[0].id] },
  }).id))
  const targetBefore = document.getObject(targets[0].id)
  const session = createBoundaryEditSession('trim', { document, boundaryIds: boundaries.map(entity => entity.id) })
  session.confirmBoundaries()

  const receipt = await session.apply(session.preview(targets[0].id, [5, 0]), execute)
  const derived = document.listEntities({ type: 'LINE' }).find(entity => entity.source?.derivedFromId === targets[0].id)
  assert.ok(derived)
  assert.equal(receipt.status, 'committed')
  assert.equal(session.state.committedCount, 1)
  assert.equal(session.state.phase, 'targets')
  assert.deepEqual(document.getObject(targets[0].id).payload.end, [3, 0, 6])
  assert.deepEqual(derived.payload.start, [7, 0, 6])
  assert.deepEqual(derived.payload.end, [10, 0, 6])
  assert.equal(groupIds.every(id => JSON.stringify(document.getObject(id).payload.memberIds) === JSON.stringify([targets[0].id, derived.id])), true)

  const revision = document.snapshot().revisions.at(-1)
  assert.equal(revision.operationCount, 1003)
  assert.deepEqual(revision.operations, [{
    type: 'operations.compacted', operationCount: 1003,
    byType: { 'object.update': 1002, 'object.create': 1 },
    digest: revision.operations[0].digest,
  }])

  assert.equal(await sdk.executeCommand('UNDO', {}, { document }), true)
  assert.deepEqual(document.getObject(targets[0].id), targetBefore)
  assert.equal(document.getObject(derived.id), null)
  assert.equal(groupIds.every(id => JSON.stringify(document.getObject(id).payload.memberIds) === JSON.stringify([targets[0].id])), true)
})

test('matching TRIM geometry cannot hide a write to an unrelated existing entity', async () => {
  const { sdk, document, boundaries, targets, create, execute } = await fixture()
  const unrelated = await create('POINT', { position: [20, 20, 6] })
  const coreTrim = sdk.commands.resolve('TRIM')
  assert.ok(coreTrim)
  sdk.commands.register({
    id: 'TRIM', aliases: ['TR'], title: 'Trim with unrelated side effect',
    execute: async (context, args) => {
      const result = await coreTrim.execute(context, args)
      context.transaction.updateObject(unrelated.id, { payload: { position: [999, 999, 6] } })
      return result
    },
  }, { owner: 'test.host', replace: true })
  const session = createBoundaryEditSession('trim', { document, boundaryIds: boundaries.map(entity => entity.id) })
  session.confirmBoundaries()

  await expectUnexpectedCommit(session.apply(session.preview(targets[0].id, [5, 0]), execute), session)
  assert.deepEqual(document.getObject(unrelated.id).payload.position, [999, 999, 6])
  assert.deepEqual(document.getObject(targets[0].id).payload.end, [3, 0, 6])
})

test('matching TRIM geometry cannot hide an incorrect persistent group membership', async () => {
  const { sdk, document, boundaries, targets, execute } = await fixture()
  const group = await sdk.executeCommand('GROUP', { name: 'Trim profile', id: targets[0].id }, { document })
  const coreTrim = sdk.commands.resolve('TRIM')
  assert.ok(coreTrim)
  sdk.commands.register({
    id: 'TRIM', aliases: ['TR'], title: 'Trim with stale group membership',
    execute: async (context, args) => {
      const result = await coreTrim.execute(context, args)
      context.transaction.updateObject(group.id, { payload: { memberIds: [targets[0].id] } })
      return result
    },
  }, { owner: 'test.host', replace: true })
  const session = createBoundaryEditSession('trim', { document, boundaryIds: boundaries.map(entity => entity.id) })
  session.confirmBoundaries()

  await expectUnexpectedCommit(session.apply(session.preview(targets[0].id, [5, 0]), execute), session)
  const derived = document.listEntities({ type: 'LINE' }).find(entity => entity.source?.derivedFromId === targets[0].id)
  assert.ok(derived)
  assert.deepEqual(document.getObject(group.id).payload.memberIds, [targets[0].id])
})
