import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../src/sdk.js'
import { reviewLedger } from '../bin/kjdraw-review.mjs'
import { readDesignRelations } from '../src/design-relations.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'

const mcp = fileURLToPath(new URL('../bin/kjdraw-mcp.mjs', import.meta.url))
const cli = fileURLToPath(new URL('../bin/kjdraw-review.mjs', import.meta.url))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params })

async function propose(root, sourceName, ledgerName, name, args) {
  const requests = [rpc(1, 'initialize', { protocolVersion: '2025-11-25' }), rpc(2, 'tools/call', { name, arguments: args })]
  const child = spawnSync(process.execPath, [mcp, '--workspace', root, '--input', sourceName, '--proposals', ledgerName], {
    input: `${requests.join('\n')}\n`, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(child.status, 0, child.stderr)
  const responses = child.stdout.trim().split('\n').map(JSON.parse)
  assert.equal(responses[1].result.structuredContent.ok, true, JSON.stringify(responses[1].result.structuredContent))
  return JSON.parse(await readFile(join(root, ledgerName), 'utf8'))
}

async function designFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-design-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter', documentId: 'two-hole-review-fixture' })
  await document.transact('Original two-hole fixture', tx => {
    tx.createEntity('CIRCLE', { center: [10, 20, 0], radius: 3, color: 3 }, { id: 'hole-left' })
    tx.createEntity('CIRCLE', { center: [50, 20, 0], radius: 3, color: 5 }, { id: 'hole-right' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [100, 0, 0], color: 4 }, { id: 'unrelated-line' })
    tx.createEntity('TEXT', { position: [0, 40, 0], text: 'Independent fixture note', height: 3 }, { id: 'unrelated-note' })
  })
  const source = Buffer.from(await sdk.writeDocument(document, { format: 'KJD' }))
  await writeFile(join(root, 'source.kjd'), source, { flag: 'wx' })
  const definition = {
    parameters: [{ name: 'diameter', value: 6, min: 2, max: 20 }, { name: 'spacing', value: 40, min: 10, max: 80 }],
    derived: [],
    bindings: [
      ...['hole-left', 'hole-right'].map(entityId => ({ entityId, path: 'radius', expression: { constant: 0, terms: [{ parameter: 'diameter', coefficient: .5 }] } })),
      { entityId: 'hole-right', path: 'center.0', expression: { constant: 10, terms: [{ parameter: 'spacing', coefficient: 1 }] } },
    ],
    requirements: [{ name: 'separation', expression: { constant: 0, terms: [{ parameter: 'spacing', coefficient: 1 }, { parameter: 'diameter', coefficient: -1 }] }, min: 1, max: 100 }],
  }
  const ledger = await propose(root, 'source.kjd', 'bind.json', 'cad_propose_design_bind', {
    expectedRevision: document.revision, units: 'millimeter', name: 'Two explicit holes', definition,
  })
  return { root, source, document, definition, ledger }
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-host-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ units: 'millimeter', documentId: 'host-review-fixture' })
  const source = Buffer.from(await sdk.writeDocument(document, { format: 'KJD' }))
  await writeFile(join(root, 'source.kjd'), source, { flag: 'wx' })
  const requests = [
    rpc(1, 'initialize', { protocolVersion: '2025-11-25' }),
    rpc(2, 'tools/call', { name: 'cad_propose_circles', arguments: { expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 10, y: 10 }, radius: 5 }] } }),
  ]
  const child = spawnSync(process.execPath, [mcp, '--workspace', root, '--input', 'source.kjd', '--proposals', 'pending.json'], {
    input: `${requests.join('\n')}\n`, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(child.status, 0, child.stderr)
  const responses = child.stdout.trim().split('\n').map(JSON.parse)
  assert.equal(responses[1].result.structuredContent.ok, true, JSON.stringify(responses[1].result.structuredContent))
  const ledger = JSON.parse(await readFile(join(root, 'pending.json'), 'utf8'))
  assert.equal(ledger.source.sha256, digest(source))
  return { root, source, ledger }
}

test('host-only review creates new editable KJD/DXF and evidence without overwriting the MCP source', async t => {
  const { root, source } = await fixture(t)
  const review = await reviewLedger({ workspace: root, ledger: 'pending.json', sequence: 1, candidate: 'candidate.kjd', reviewer: 'fixture-reviewer' }, async () => true)
  assert.equal(review.execution.command, 'CREATEBATCH')
  assert.equal(review.execution.beforeRevision, 0)
  assert.equal(review.execution.afterRevision, 1)
  assert.equal(review.execution.createdEntityCount, 1)
  assert.equal(review.execution.liveUndoRedoVerified, true)
  assert.equal(review.execution.reopenUndoHistory, false)
  assert.equal(review.hostConfirmed, false)
  assert.equal(review.confirmationMethod, 'internal-test-fixture')
  assert.equal(review.noInputOverwrite, true)
  assert.deepEqual(await readFile(join(root, 'source.kjd')), source)
  const kjd = await createKJDrawSDK().readDocument(await readFile(join(root, 'candidate.kjd')), { format: 'KJD' })
  const dxf = await createKJDrawSDK().readDocument(await readFile(join(root, 'candidate.dxf')), { format: 'DXF' })
  for (const document of [kjd, dxf]) {
    assert.equal(document.validate().valid, true)
    assert.equal(document.listEntities().length, 1)
    assert.equal(document.listEntities()[0].type, 'CIRCLE')
    assert.equal(document.listEntities()[0].payload.radius, 5)
  }
  assert.deepEqual(JSON.parse(await readFile(join(root, 'candidate.review.json'), 'utf8')), review)
  assert.equal((await readdir(root)).filter(name => name.includes('.claim.json')).length, 1)
  await assert.rejects(reviewLedger({ workspace: root, ledger: 'pending.json', sequence: 1, candidate: 'candidate.kjd' }, async () => true), /must not exist yet/u)
  await assert.rejects(reviewLedger({ workspace: root, ledger: 'pending.json', sequence: 1, candidate: 'another-new.kjd' }, async () => true), /already been claimed or consumed/u)
  await assert.rejects(readFile(join(root, 'another-new.kjd')), { code: 'ENOENT' })
  const changedLedger = JSON.parse(await readFile(join(root, 'pending.json'), 'utf8'))
  changedLedger.proposals[0].reviewNote = 'changed without changing the original plan identity'
  await writeFile(join(root, 'pending.json'), JSON.stringify(changedLedger))
  await assert.rejects(reviewLedger({ workspace: root, ledger: 'pending.json', sequence: 1, candidate: 'third-new.kjd' }, async () => true), /already been claimed or consumed/u)
  await assert.rejects(readFile(join(root, 'third-new.kjd')), { code: 'ENOENT' })
})

test('host review binds two existing holes and resumes two parameter changes from saved KJD without replacing unrelated objects', async t => {
  const { root, source, document, definition } = await designFixture(t)
  const sourceEntities = JSON.parse(JSON.stringify(document.listEntities()))
  let confirmationCount = 0
  const receipt = await reviewLedger({ workspace: root, ledger: 'bind.json', sequence: 1, candidate: 'bound.kjd',
    flattenDesignRelations: true, reviewer: 'internal-test-fixture' }, async summary => {
    confirmationCount++
    assert.equal(summary.command, 'DESIGNCREATE')
    assert.deepEqual(summary.designRelations, { count: 1, kjd: 'preserved', dxf: 'explicitly-flattened' })
    assert.equal(summary.createdEntityCount, 0)
    assert.equal(summary.changedEntityCount, 0)
    assert.deepEqual(await readFile(join(root, 'source.kjd')), source)
    await assert.rejects(readFile(join(root, 'bound.kjd')), { code: 'ENOENT' })
    return true
  })
  assert.equal(confirmationCount, 1)
  assert.equal(receipt.confirmationMethod, 'internal-test-fixture')
  assert.equal(receipt.hostConfirmed, false)
  assert.equal(receipt.execution.command, 'DESIGNCREATE')
  assert.equal(receipt.execution.liveUndoRedoVerified, true)
  assert.deepEqual(receipt.designRelations, { count: 1, kjd: 'preserved', dxf: 'explicitly-flattened' })
  let previousName = 'bound.kjd'
  let previous = await createKJDrawSDK().readDocument(await readFile(join(root, previousName)), { format: 'KJD' })
  assert.deepEqual(previous.listEntities(), sourceEntities)
  assert.deepEqual(readDesignRelations(previous)[0].definition, definition)
  const designId = readDesignRelations(previous)[0].id
  for (const [index, diameter, spacing] of [[1, 8, 60], [2, 10, 70]]) {
    const sourceBytes = await readFile(join(root, previousName))
    const ledgerName = `update-${index}.json`, candidateName = `updated-${index}.kjd`
    const pending = await propose(root, previousName, ledgerName, 'cad_propose_design_update', {
      expectedRevision: previous.revision, units: 'millimeter', id: designId,
      changes: [{ name: 'diameter', value: diameter }, { name: 'spacing', value: spacing }],
    })
    let prematureConfirmation = false
    const pendingOptions = { workspace: root, ledger: ledgerName, sequence: 1, candidate: candidateName }
    await assert.rejects(reviewLedger(pendingOptions, async () => { prematureConfirmation = true; return true }), /--flatten-design-relations/u)
    assert.equal(prematureConfirmation, false)
    if (index === 1) {
      const forgedPreview = structuredClone(pending)
      forgedPreview.proposals[0].result.preview.after[0].payload.radius = 99
      await writeFile(join(root, ledgerName), JSON.stringify(forgedPreview))
      await assert.rejects(reviewLedger({ ...pendingOptions, flattenDesignRelations: true }, async () => {
        prematureConfirmation = true; return true
      }), /Native preview disagrees/u)
      const forgedArgs = structuredClone(pending)
      forgedArgs.proposals[0].result.arguments.parameters.diameter = diameter + 1
      forgedArgs.proposals[0].result.preview = await createAgentGeometryPreview(previous, 'DESIGNUPDATE', forgedArgs.proposals[0].result.arguments)
      await writeFile(join(root, ledgerName), JSON.stringify(forgedArgs))
      await assert.rejects(reviewLedger({ ...pendingOptions, flattenDesignRelations: true }, async () => {
        prematureConfirmation = true; return true
      }), /Native design arguments disagree/u)
      assert.equal(prematureConfirmation, false)
      await writeFile(join(root, ledgerName), JSON.stringify(pending))
    }
    const update = await reviewLedger({ workspace: root, ledger: ledgerName, sequence: 1, candidate: candidateName,
      flattenDesignRelations: true, reviewer: 'internal-test-fixture' }, async summary => {
      assert.equal(summary.command, 'DESIGNUPDATE')
      assert.equal(summary.createdEntityCount, 0)
      assert.equal(summary.changedEntityCount, 2)
      assert.deepEqual(await readFile(join(root, previousName)), sourceBytes)
      await assert.rejects(readFile(join(root, candidateName)), { code: 'ENOENT' })
      return true
    })
    assert.equal(update.confirmationMethod, 'internal-test-fixture')
    assert.equal(update.hostConfirmed, false)
    assert.equal(update.execution.liveUndoRedoVerified, true)
    assert.deepEqual(await readFile(join(root, previousName)), sourceBytes)
    const reopened = await createKJDrawSDK().readDocument(await readFile(join(root, candidateName)), { format: 'KJD' })
    const dxf = await createKJDrawSDK().readDocument(await readFile(join(root, `updated-${index}.dxf`)), { format: 'DXF' })
    assert.deepEqual(readDesignRelations(dxf), [])
    for (const result of [reopened, dxf]) {
      const circles = [...result.listEntities({ type: 'CIRCLE' })].sort((a, b) => a.payload.center[0] - b.payload.center[0])
      assert.deepEqual(circles.map(circle => circle.payload.center), [[10, 20, 0], [10 + spacing, 20, 0]])
      assert.deepEqual(circles.map(circle => circle.payload.radius), [diameter / 2, diameter / 2])
    }
    for (const entity of sourceEntities) {
      const current = reopened.getObject(entity.id)
      assert.equal(current.id, entity.id)
      assert.equal(current.handle, entity.handle)
      assert.equal(current.payload.color, entity.payload.color)
      if (entity.id.startsWith('unrelated-')) assert.deepEqual(current, entity)
    }
    const design = readDesignRelations(reopened)[0]
    assert.equal(design.id, designId)
    assert.equal(design.values.diameter, diameter)
    assert.equal(design.values.spacing, spacing)
    assert.deepEqual(design.driftedEntityIds, [])
    assert.deepEqual(JSON.parse(await readFile(join(root, `updated-${index}.review.json`), 'utf8')), update)
    previousName = candidateName
    previous = reopened
  }
  assert.deepEqual(await readFile(join(root, 'source.kjd')), source)
})

test('design review requires explicit DXF flattening before confirmation and preserves original files after a denied review', async t => {
  const { root, source } = await designFixture(t)
  const options = { workspace: root, ledger: 'bind.json', sequence: 1, candidate: 'denied.kjd' }
  let called = false
  await assert.rejects(reviewLedger(options, async () => { called = true; return true }), /--flatten-design-relations/u)
  assert.equal(called, false)
  await assert.rejects(reviewLedger({ ...options, flattenDesignRelations: 'true' }, async () => true), /explicit boolean/u)
  await assert.rejects(reviewLedger({ ...options, flattenDesignRelations: true }, async () => false), /Host did not confirm/u)
  assert.deepEqual(await readFile(join(root, 'source.kjd')), source)
  for (const file of ['denied.kjd', 'denied.dxf', 'denied.review.json']) await assert.rejects(readFile(join(root, file)), { code: 'ENOENT' })
  assert.equal((await readdir(root)).filter(name => name.includes('.claim.json')).length, 0)
  const nonInteractive = spawnSync(process.execPath, [cli, '--workspace', root, '--ledger', 'bind.json', '--sequence', '1',
    '--candidate', 'denied.kjd', '--approve', '--flatten-design-relations'], { encoding: 'utf8' })
  assert.notEqual(nonInteractive.status, 0)
  assert.match(nonInteractive.stderr, /Interactive host TTY is required/u)
})

test('design review rejects unsupported commands, mismatched tools, forged preview and self-consistent arguments differing from tool input', async t => {
  const { root, source, document, ledger } = await designFixture(t)
  const options = { workspace: root, ledger: 'bind.json', sequence: 1, candidate: 'forged.kjd', flattenDesignRelations: true }
  const original = structuredClone(ledger)
  let confirmed = false
  const confirm = async () => { confirmed = true; return true }
  for (const [mutate, expected] of [
    [item => { item.result.command = 'MOVE'; item.result.preview.command = 'MOVE' }, /unsupported by host review/u],
    [item => { item.tool = 'cad_propose_design_update' }, /tool does not match/u],
    [item => { delete item.input }, /original tool input/u],
    [item => { item.result.preview.designChange.after.parameters[0].max = 30 }, /Native preview disagrees/u],
    [item => { item.result.preview.designChange.dictionary.id = 'forged-dictionary' }, /Native preview disagrees/u],
  ]) {
    const forged = structuredClone(original)
    mutate(forged.proposals[0])
    await writeFile(join(root, 'bind.json'), JSON.stringify(forged))
    await assert.rejects(reviewLedger(options, confirm), expected)
  }
  const forged = structuredClone(original)
  forged.proposals[0].result.arguments.definition.parameters[0].max = 30
  forged.proposals[0].result.preview = await createAgentGeometryPreview(document, 'DESIGNCREATE', forged.proposals[0].result.arguments)
  await writeFile(join(root, 'bind.json'), JSON.stringify(forged))
  await assert.rejects(reviewLedger(options, confirm), /Native design arguments disagree/u)
  assert.equal(confirmed, false)
  assert.deepEqual(await readFile(join(root, 'source.kjd')), source)
  for (const file of ['forged.kjd', 'forged.dxf', 'forged.review.json']) await assert.rejects(readFile(join(root, file)), { code: 'ENOENT' })
  assert.equal((await readdir(root)).filter(name => name.includes('.claim.json')).length, 0)
})

test('two concurrent reviews of one proposal create only one candidate and one retained claim', async t => {
  const { root, source } = await fixture(t)
  const base = { workspace: root, ledger: 'pending.json', sequence: 1 }
  const results = await Promise.allSettled(['one.kjd', 'two.kjd'].map(candidate =>
    reviewLedger({ ...base, candidate }, async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return true
    })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected' && /already been claimed or consumed/u.test(result.reason.message)).length, 1)
  const files = await readdir(root)
  assert.equal(files.filter(name => name.endsWith('.kjd') && name !== 'source.kjd').length, 1)
  assert.equal(files.filter(name => name.includes('.claim.json')).length, 1)
  assert.deepEqual(await readFile(join(root, 'source.kjd')), source)
})

test('forged preview, changed source bytes, rejected review and non-TTY --approve never create a candidate', async t => {
  const { root, source, ledger } = await fixture(t)
  const options = { workspace: root, ledger: 'pending.json', sequence: 1, candidate: 'denied.kjd' }
  await assert.rejects(reviewLedger(options, async () => false), /Host did not confirm/u)
  await assert.rejects(readFile(join(root, 'denied.kjd')), { code: 'ENOENT' })
  assert.equal((await readdir(root)).filter(name => name.includes('.claim.json')).length, 0)
  const nonInteractive = spawnSync(process.execPath, [cli, '--workspace', root, '--ledger', 'pending.json', '--sequence', '1', '--candidate', 'denied.kjd', '--approve'], { encoding: 'utf8' })
  assert.notEqual(nonInteractive.status, 0)
  assert.match(nonInteractive.stderr, /Interactive host TTY is required/u)
  ledger.proposals[0].result.preview.after[0].payload.radius = 8
  await writeFile(join(root, 'pending.json'), JSON.stringify(ledger))
  await assert.rejects(reviewLedger(options, async () => true), /Native preview disagrees/u)
  ledger.proposals[0].result.preview.after[0].payload.radius = 5
  await writeFile(join(root, 'pending.json'), JSON.stringify(ledger))
  ledger.proposals[0].result.arguments.entities[0].payload.radius = 8
  await writeFile(join(root, 'pending.json'), JSON.stringify(ledger))
  await assert.rejects(reviewLedger(options, async () => true), /Native preview disagrees/u)
  ledger.proposals[0].result.arguments.entities[0].payload.radius = 5
  await writeFile(join(root, 'pending.json'), JSON.stringify(ledger))
  await assert.rejects(reviewLedger({ ...options, candidate: '../escape.kjd' }, async () => true), /project-relative path/u)
  await assert.rejects(reviewLedger(options, async () => {
    await writeFile(join(root, 'source.kjd'), Buffer.concat([source, Buffer.from('\n')]))
    return true
  }), /Source drawing bytes changed/u)
  await writeFile(join(root, 'source.kjd'), source)
  await writeFile(join(root, 'source.kjd'), Buffer.concat([source, Buffer.from('\n')]))
  await assert.rejects(reviewLedger(options, async () => true), /Source drawing bytes changed/u)
  await assert.rejects(readFile(join(root, 'denied.kjd')), { code: 'ENOENT' })
})
