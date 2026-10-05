import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

// Public synthetic SDK/CLI evidence, not a Skill execution or a model benchmark.
// Approval below belongs to a deterministic test host, not a claimed human review.
const tool = 'cad_propose_drawing_pattern'
const reviewer = 'community-hole-pattern-test-host'
const cli = fileURLToPath(new URL('../packages/kjdraw-sdk/bin/kjdraw.mjs', import.meta.url))
const prefix = 'kjdraw-community-hole-pattern-'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const facts = Object.freeze({ center: [0, 0], pitchDiameter: 90, holeDiameter: 10, count: 6, startAngle: 0 })
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

function input(document, supplied = facts) {
  // Only derive the ONE seed from explicit facts. All copies come from the
  // engine's native polar array; this helper is not a second geometry engine.
  const angle = supplied.startAngle * Math.PI / 180
  return {
    expectedRevision: document.revision, units: document.snapshot().header.units,
    lines: [], circles: [[
      supplied.center[0] + supplied.pitchDiameter / 2 * Math.cos(angle),
      supplied.center[1] + supplied.pitchDiameter / 2 * Math.sin(angle),
      supplied.holeDiameter / 2,
    ]], arcs: [], polylines: [], arrays: [],
    polarArrays: [{ sources: ['circles:0'], center: { x: supplied.center[0], y: supplied.center[1] }, count: supplied.count, angleDegrees: 360 }],
  }
}

function assertHoles(entities, supplied = facts, ownerId) {
  assert.equal(entities.length, supplied.count)
  assert.equal(new Set(entities.map(entity => entity.id)).size, supplied.count)
  for (let index = 0; index < entities.length; index++) {
    const entity = entities[index], p = entity.payload
    assert.equal(entity.type, 'CIRCLE', 'Native circles must not be tessellated')
    if (ownerId) assert.equal(entity.ownerId, ownerId)
    assert.equal(p.center.length, 3); assert.equal(p.center[2], 0)
    near(p.radius, supplied.holeDiameter / 2)
    near(Math.hypot(p.center[0] - supplied.center[0], p.center[1] - supplied.center[1]), supplied.pitchDiameter / 2)
    const angle = (supplied.startAngle + index * 360 / supplied.count) * Math.PI / 180
    near(p.center[0], supplied.center[0] + supplied.pitchDiameter / 2 * Math.cos(angle))
    near(p.center[1], supplied.center[1] + supplied.pitchDiameter / 2 * Math.sin(angle))
    for (const earlier of entities.slice(0, index)) {
      assert.ok(Math.hypot(p.center[0] - earlier.payload.center[0], p.center[1] - earlier.payload.center[1]) > 1e-9, 'Repeated endpoint or coincident hole')
    }
  }
}

function assertPreview(proposed, supplied, ownerId) {
  // Geometry preview rows omit ownerId; the reviewed command carries ownership.
  assertHoles(proposed.preview.after, supplied)
  assert.equal(proposed.arguments.entities.length, supplied.count)
  for (let index = 0; index < supplied.count; index++) {
    assert.equal(proposed.arguments.entities[index].options.ownerId, ownerId)
    assert.equal(proposed.arguments.entities[index].options.id, proposed.preview.after[index].id)
  }
}

async function fixture({ units = 'millimeter' } = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'community-public-hole-pattern', units })
  const execute = (command, args) => sdk.executeCommand(command, args, { document })
  const linetype = await execute('LINETYPE', { name: 'PUBLIC-CENTER', description: 'Public fixture center', pattern: [12, -3, 2, -3] })
  const style = await execute('TEXTSTYLE', { name: 'PUBLIC-NOTE', fontFile: 'simplex.shx', widthFactor: 0.8, obliqueAngle: 0.1 })
  const layer = await execute('LAYERNEW', { name: 'PUBLIC-REFERENCE', color: 2, linetypeId: linetype.id, lineweight: 25, plottable: false })
  await document.transact('Public mechanical fixture', tx => {
    tx.createEntity('TEXT', { position: [120, 100, 0], alignmentPoint: [120, 100, 0], height: 3, text: 'PUBLIC FIXTURE', styleId: style.id, layerId: layer.id, color: 3 }, { id: 'unrelated-note' })
    tx.createEntity('LINE', { start: [100, 90, 0], end: [130, 90, 0], layerId: layer.id, linetypeId: linetype.id, color: 4, lineweight: 35 }, { id: 'unrelated-line' })
  })
  const group = await execute('GROUP', { name: 'PUBLIC REFERENCES', ids: ['unrelated-note', 'unrelated-line'], description: 'Unrelated public fixture' })
  const session = new KJAgentToolSession(sdk, document)
  return { sdk, document, session, execute, group, layer, style, linetype, before: document.snapshot(), serialized: document.serialize(), history: document.exportHistory() }
}

function unchanged(f) {
  assert.equal(f.document.serialize(), f.serialized)
  assert.deepEqual(f.document.exportHistory(), f.history)
  assert.equal(f.document.validate().valid, true)
}

function sourcePreserved(f, createdIds) {
  const after = f.document.snapshot(), owner = f.before.spaces.modelSpaceId
  for (const [id, object] of Object.entries(f.before.objects)) {
    if (id !== owner) assert.deepEqual(after.objects[id], object, `Unrelated native object ${id} changed`)
  }
  assert.deepEqual(after.objects[owner].payload.entityIds, [...f.before.objects[owner].payload.entityIds, ...createdIds])
  assert.deepEqual(after.tables, f.before.tables)
  assert.deepEqual(after.spaces, f.before.spaces)
  assert.deepEqual(after.resources, f.before.resources)
  assert.deepEqual(after.opaquePayloads, f.before.opaquePayloads)
  assert.equal(after.header.units, f.before.header.units)
  assert.deepEqual(after.metadata.custom, f.before.metadata.custom)
  assert.equal(f.document.validate().valid, true)
}

async function workspace(t) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, prefix)))
  const child = relative(parent, root)
  assert.ok(child && !isAbsolute(child) && !child.split(sep).includes('..'))
  assert.ok(basename(root).startsWith(prefix))
  t.after(async () => {
    // Remove only this exact newly created fixture directory.
    assert.equal(await realpath(root), root); assert.equal(resolve(parent, child), root)
    await rm(root, { recursive: true, force: true })
  })
  return root
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, KJDRAW_KNOWLEDGE_UPDATES: 'off' },
  })
}
function successful(child) {
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr || child.stdout)
  return JSON.parse(child.stdout)
}

test('actual source-checkout CLI exposes the native polar contract and does not create files for schema discovery', async t => {
  const root = await workspace(t)
  const discovery = successful(run(root, ['agent', 'tools']))
  assert.ok(discovery.tools.some(definition => definition.name === tool))
  const definition = successful(run(root, ['agent', 'tools', tool])).tool
  assert.deepEqual(definition.inputSchema.required, ['expectedRevision', 'units', 'lines', 'circles', 'arcs', 'polylines', 'arrays'])
  const polar = definition.inputSchema.properties.polarArrays.items
  assert.deepEqual(polar.required, ['sources', 'center', 'count', 'angleDegrees'])
  assert.equal(polar.additionalProperties, false)
  assert.deepEqual(polar.properties.count, { type: 'integer', minimum: 2, maximum: 512 })
  assert.equal(polar.properties.angleDegrees.minimum, -360); assert.equal(polar.properties.angleDegrees.maximum, 360)
  assert.equal(Object.hasOwn(definition.inputSchema.properties, 'groupName'), false)
  assert.deepEqual(await readdir(root), [])
})

test('six explicit holes use one native seed and a full pending preview with unchanged source and history', async () => {
  const f = await fixture(), request = input(f.document), copy = structuredClone(request)
  assert.deepEqual(request.circles, [[45, 0, 5]])
  const proposed = value(await f.session.call(tool, request))
  assert.deepEqual(request, copy); unchanged(f)
  assert.equal(proposed.status, 'awaiting-host-approval'); assert.equal(proposed.command, 'CREATEBATCH')
  assert.equal(proposed.expectedRevision, f.before.revision); assert.equal(proposed.units, 'millimeter')
  assert.equal(proposed.preview.documentId, f.document.id); assert.equal(proposed.preview.revision, f.before.revision)
  assert.deepEqual(proposed.preview.before, [])
  assertPreview(proposed, facts, f.before.spaces.modelSpaceId)
  assert.equal(proposed.arguments.entities.length, 6)
  assert.equal(f.sdk.agentPlans.get(proposed.planId).status, 'active')
})

test('deterministic SDK test-host approval adds exactly six circles in one history entry and one exact object undo/redo', async () => {
  const f = await fixture(), proposed = value(await f.session.call(tool, input(f.document)))
  const receipt = value(await f.session.approve(proposed.planId, reviewer))
  assert.equal(receipt.status, 'committed'); assert.equal(receipt.command, 'CREATEBATCH')
  assert.equal(receipt.beforeRevision, f.before.revision); assert.equal(receipt.afterRevision, f.before.revision + 1)
  const ids = proposed.preview.after.map(entity => entity.id)
  for (const entity of proposed.preview.after) assert.deepEqual(f.document.getObject(entity.id).payload, entity.payload)
  assertHoles(ids.map(id => f.document.getObject(id)), facts, f.before.spaces.modelSpaceId)
  sourcePreserved(f, ids)
  const history = f.document.exportHistory(), committed = f.document.snapshot()
  assert.equal(history.undo.length, f.history.undo.length + 1)
  assert.equal(history.undo.at(-1).source, 'command:CREATEBATCH')
  assert.equal(f.sdk.agentPlans.get(proposed.planId).status, 'consumed')
  const serialized = f.document.serialize()
  assert.equal((await f.session.approve(proposed.planId, reviewer)).ok, false)
  assert.equal(f.document.serialize(), serialized, 'A consumed plan committed twice')
  await f.execute('UNDO', {})
  assert.deepEqual(f.document.snapshot().objects, f.before.objects)
  assert.deepEqual(f.document.snapshot().tables, f.before.tables)
  assert.deepEqual(f.document.snapshot().resources, f.before.resources)
  assert.deepEqual(f.document.snapshot().spaces, f.before.spaces)
  assert.equal(f.document.listEntities({ type: 'CIRCLE' }).length, 0)
  assert.equal(f.document.exportHistory().redo.length, 1)
  await f.execute('REDO', {})
  assert.deepEqual(f.document.snapshot().objects, committed.objects)
  assert.deepEqual(f.document.snapshot().tables, committed.tables)
  assert.deepEqual(f.document.snapshot().resources, committed.resources)
  assert.deepEqual(f.document.snapshot().spaces, committed.spaces)
  assert.equal(f.document.exportHistory().redo.length, 0)
  assertHoles(ids.map(id => f.document.getObject(id)), facts, f.before.spaces.modelSpaceId)
})

test('native KJD reopening retains all object identities, resources, styles and the unrelated GROUP', async () => {
  const f = await fixture(), proposed = value(await f.session.call(tool, input(f.document)))
  value(await f.session.approve(proposed.planId, reviewer))
  const committed = f.document.snapshot()
  const reopened = await createKJDrawSDK().readDocument(await f.sdk.writeDocument(f.document, { format: 'KJD' }), { format: 'KJD' })
  assert.equal(reopened.id, f.document.id); assert.equal(reopened.revision, f.document.revision)
  assert.deepEqual(reopened.snapshot().objects, committed.objects)
  assert.deepEqual(reopened.snapshot().tables, committed.tables); assert.deepEqual(reopened.snapshot().resources, committed.resources)
  assert.deepEqual(reopened.getObject(f.group.id), f.before.objects[f.group.id])
  assertHoles(proposed.preview.after.map(entity => reopened.getObject(entity.id)), facts, reopened.snapshot().spaces.modelSpaceId)
  assert.equal(reopened.validate().valid, true)
})

test('independent DXF reopen retains native circles, units, unrelated TEXT/LINE and named standard resources', async t => {
  const f = await fixture(), root = await workspace(t)
  const source = join(root, 'source.dxf'), sourceBytes = Buffer.from(await f.sdk.writeDocument(f.document, { format: 'DXF' }))
  await writeFile(source, sourceBytes)
  const sourceHash = sha256(sourceBytes), proposed = value(await f.session.call(tool, input(f.document)))
  assert.equal(sha256(await readFile(source)), sourceHash)
  value(await f.session.approve(proposed.planId, reviewer))
  await writeFile(join(root, 'reviewed.dxf'), await f.sdk.writeDocument(f.document, { format: 'DXF', version: '2018' }))
  const reopened = await createKJDrawSDK().readDocument(await readFile(join(root, 'reviewed.dxf')), { format: 'DXF' })
  assert.equal(reopened.snapshot().header.units, 'millimeter')
  assertHoles(reopened.listEntities({ type: 'CIRCLE' }), facts, reopened.snapshot().spaces.modelSpaceId)
  assert.equal(reopened.listEntities().length, 8); assert.equal(reopened.validate().valid, true)
  const note = reopened.listEntities({ type: 'TEXT' })[0], line = reopened.listEntities({ type: 'LINE' })[0]
  assert.equal(note.handle, f.before.objects['unrelated-note'].handle); assert.equal(line.handle, f.before.objects['unrelated-line'].handle)
  assert.equal(note.payload.text, 'PUBLIC FIXTURE'); assert.deepEqual(note.payload.position, [120, 100, 0])
  assert.equal(note.payload.height, 3); assert.equal(note.payload.color, 3)
  assert.deepEqual(line.payload.start, [100, 90, 0]); assert.deepEqual(line.payload.end, [130, 90, 0])
  assert.equal(line.payload.color, 4); assert.equal(line.payload.lineweight, 35)
  const layer = reopened.getTable('layers').records.find(record => record.name === 'PUBLIC-REFERENCE')
  const style = reopened.getTable('textStyles').records.find(record => record.name === 'PUBLIC-NOTE')
  const linetype = reopened.getTable('linetypes').records.find(record => record.name === 'PUBLIC-CENTER')
  assert.equal(layer.payload.color, 2); assert.equal(layer.payload.lineweight, 25); assert.equal(layer.payload.plottable, false)
  assert.deepEqual(linetype.payload.pattern, [12, -3, 2, -3]); assert.equal(layer.payload.linetypeId, linetype.id)
  assert.equal(style.payload.fontFile, 'simplex.shx'); assert.equal(style.payload.widthFactor, 0.8); near(style.payload.obliqueAngle, 0.1)
  assert.equal(note.payload.styleId, style.id); assert.equal(note.payload.layerId, layer.id)
  assert.equal(line.payload.layerId, layer.id); assert.equal(line.payload.linetypeId, linetype.id)
  assert.equal(sha256(await readFile(source)), sourceHash, 'Export overwrote the input DXF')
  sourcePreserved(f, proposed.preview.after.map(entity => entity.id))
  // Existing interchange boundary: DXF emits geometry/standard tables, not
  // KJDraw native GROUP records. KJD preservation is proved separately above.
  t.diagnostic('DXF GROUP round-trip is unsupported; this test makes no GROUP persistence claim')
})

test('declared meter coordinates remain native 1:1 through approval and DXF reopen', async () => {
  const f = await fixture({ units: 'meter' })
  const supplied = { center: [2, 3], pitchDiameter: 0.09, holeDiameter: 0.01, count: 6, startAngle: 0 }
  const proposed = value(await f.session.call(tool, input(f.document, supplied)))
  assert.equal(proposed.units, 'meter'); assertPreview(proposed, supplied, f.before.spaces.modelSpaceId)
  value(await f.session.approve(proposed.planId, reviewer))
  const reopened = await createKJDrawSDK().readDocument(await f.sdk.writeDocument(f.document, { format: 'DXF' }), { format: 'DXF' })
  assert.equal(reopened.snapshot().header.units, 'meter')
  assertHoles(reopened.listEntities({ type: 'CIRCLE' }), supplied, reopened.snapshot().spaces.modelSpaceId)
})

test('translated cardinal and noncardinal first-hole angles retain their supplied orientation without JS copy expansion', async () => {
  for (const supplied of [
    { center: [10, 20], pitchDiameter: 40, holeDiameter: 4, count: 8, startAngle: 90 },
    { center: [-12, 7], pitchDiameter: 58, holeDiameter: 3, count: 7, startAngle: -17.5 },
  ]) {
    const f = await fixture(), request = input(f.document, supplied)
    assert.equal(request.circles.length, 1); assert.equal(request.polarArrays.length, 1)
    const proposed = value(await f.session.call(tool, request))
    assertPreview(proposed, supplied, f.before.spaces.modelSpaceId); unchanged(f)
    value(await f.session.approve(proposed.planId, reviewer))
    sourcePreserved(f, proposed.preview.after.map(entity => entity.id))
  }
})

test('invalid counts and nonpositive or nonfinite hole radii reject before any proposal or partial geometry', async () => {
  const f = await fixture(), request = input(f.document)
  for (const count of [0, 1, 1.5, 513, NaN, Infinity]) {
    const changed = structuredClone(request); changed.polarArrays[0].count = count
    assert.equal((await f.session.call(tool, changed)).ok, false, `count ${count}`); unchanged(f)
  }
  for (const radius of [-5, 0, NaN, Infinity]) {
    const changed = structuredClone(request); changed.circles[0][2] = radius
    assert.equal((await f.session.call(tool, changed)).ok, false, `radius ${radius}`); unchanged(f)
  }
  assert.deepEqual(f.sdk.agentPlans.list(), [])
})

test('missing native fields, invalid source references, invalid angles and incompatible units fail atomically', async () => {
  const f = await fixture(), request = input(f.document), cases = []
  for (const key of ['expectedRevision', 'units', 'lines', 'circles', 'arcs', 'polylines', 'arrays']) {
    const changed = structuredClone(request); delete changed[key]; cases.push(changed)
  }
  const missingCount = structuredClone(request); delete missingCount.polarArrays[0].count; cases.push(missingCount)
  const missingCenter = structuredClone(request); delete missingCenter.polarArrays[0].center.x; cases.push(missingCenter)
  const missingRadius = structuredClone(request); missingRadius.circles[0].pop(); cases.push(missingRadius)
  for (const units of ['meter', 'unitless', -1]) cases.push({ ...request, units })
  for (const angleDegrees of [0, 361, NaN, Infinity]) cases.push({ ...request, polarArrays: [{ ...request.polarArrays[0], angleDegrees }] })
  for (const sources of [['circles:1'], ['circles:0', 'circles:0'], ['unrelated-line'], []]) cases.push({ ...request, polarArrays: [{ ...request.polarArrays[0], sources }] })
  for (const changed of cases) { assert.equal((await f.session.call(tool, changed)).ok, false); unchanged(f) }
  assert.deepEqual(f.sdk.agentPlans.list(), [])
  // Pitch diameter and first angle are Skill-level required engineering facts,
  // not fields of this low-level tool. The SDK cannot attest their provenance.
})

test('stale proposal revisions and stale host approvals preserve every current object and history entry', async () => {
  const f = await fixture(), request = input(f.document)
  assert.equal((await f.session.call(tool, { ...request, expectedRevision: f.document.revision - 1 })).ok, false); unchanged(f)
  const proposed = value(await f.session.call(tool, request))
  await f.execute('CREATE', { type: 'LINE', payload: { start: [150, 90, 0], end: [160, 90, 0] }, options: { id: 'later-host-edit' } })
  const serialized = f.document.serialize(), history = f.document.exportHistory()
  assert.equal((await f.session.approve(proposed.planId, reviewer)).ok, false)
  assert.equal(f.document.serialize(), serialized); assert.deepEqual(f.document.exportHistory(), history)
  assert.equal(f.document.listEntities({ type: 'CIRCLE' }).length, 0)
})

test('missing host identity and explicit host rejection never commit a pending pattern', async () => {
  const f = await fixture(), proposed = value(await f.session.call(tool, input(f.document)))
  assert.equal((await f.session.approve(proposed.planId, '')).ok, false); unchanged(f)
  assert.equal(f.sdk.agentPlans.get(proposed.planId).status, 'active')
  assert.equal(value(f.session.reject(proposed.planId, reviewer)).status, 'rejected'); unchanged(f)
  assert.equal((await f.session.approve(proposed.planId, reviewer)).ok, false); unchanged(f)
})

test('changed radius or hole cardinality cannot reuse approval for the exact reviewed native arguments', async () => {
  const f = await fixture(), proposed = value(await f.session.call(tool, input(f.document)))
  assert.throws(() => { proposed.arguments.entities[0].payload.radius = 6 }, TypeError)
  const changedRadius = structuredClone(proposed.arguments); changedRadius.entities[0].payload.radius = 6
  const changedCount = structuredClone(proposed.arguments); changedCount.entities.pop()
  for (const argumentsOverride of [changedRadius, changedCount]) {
    const envelope = f.sdk.createCommandEnvelope('CREATEBATCH', argumentsOverride, {
      document: f.document, expectedRevision: proposed.expectedRevision, origin: 'ai',
      confirmation: { status: 'confirmed', planId: proposed.planId, confirmedBy: reviewer },
    })
    await assert.rejects(f.sdk.executeCommandEnvelope(envelope, { document: f.document }), /do not match the reviewed proposal/)
    unchanged(f); assert.equal(f.sdk.agentPlans.get(proposed.planId).status, 'active')
  }
  value(await f.session.approve(proposed.planId, reviewer))
  assertHoles(f.document.listEntities({ type: 'CIRCLE' }), facts, f.before.spaces.modelSpaceId)
  sourcePreserved(f, proposed.preview.after.map(entity => entity.id))
})

test('actual CLI native read and polar proposal write only source-bound pending evidence, never approved drawing output', async t => {
  const f = await fixture(), root = await workspace(t)
  const sourceBytes = Buffer.from(await f.sdk.writeDocument(f.document, { format: 'KJD' }))
  await writeFile(join(root, 'source.kjd'), sourceBytes)
  const dxfBytes = Buffer.from(await f.sdk.writeDocument(f.document, { format: 'DXF' }))
  await writeFile(join(root, 'source.dxf'), dxfBytes)
  const call = async (name, args) => {
    await writeFile(join(root, 'request.json'), JSON.stringify(args))
    return successful(run(root, ['agent', 'call', name, '--input', 'source.kjd', '--args-file', 'request.json', '--workspace', root]))
  }
  const read = await call('cad_read_drawing', {})
  assert.equal(read.ok, true); assert.equal(read.value.documentId, f.document.id)
  assert.equal(read.value.units, 'millimeter'); assert.equal(read.value.revision, f.before.revision)
  assert.equal(read.value.entities.length, 2)
  const request = input(f.document), output = await call(tool, request)
  assert.equal(output.ok, true); assert.equal(output.value.status, 'awaiting-host-approval')
  assertPreview(output.value, facts, read.value.spaceId)
  const ledger = JSON.parse(await readFile(join(root, output.ledger), 'utf8'))
  assert.equal(ledger.source.path, 'source.kjd'); assert.equal(ledger.source.sha256, sha256(sourceBytes))
  assert.equal(ledger.source.documentId, read.value.documentId); assert.equal(ledger.source.revision, read.value.revision)
  assert.equal(ledger.proposals.length, 1)
  assert.equal(ledger.proposals[0].tool, tool); assert.deepEqual(ledger.proposals[0].input, request)
  assert.equal(ledger.proposals[0].sourceRevision, read.value.revision)
  assert.equal(ledger.proposals[0].sourceFingerprint, ledger.source.fingerprint)
  assert.deepEqual(ledger.proposals[0].result, output.value)
  assert.equal(Object.hasOwn(ledger, 'approval'), false)
  assert.equal(Object.hasOwn(ledger.proposals[0], 'delivery'), false)
  const rejected = structuredClone(request); rejected.polarArrays[0].count = 1
  await writeFile(join(root, 'request.json'), JSON.stringify(rejected))
  const child = run(root, ['agent', 'call', tool, '--input', 'source.kjd', '--args-file', 'request.json', '--workspace', root])
  assert.equal(child.error, undefined); assert.equal(child.status, 1)
  const failure = JSON.parse(child.stdout); assert.equal(failure.ok, false); assert.equal(Object.hasOwn(failure, 'value'), false)
  assert.deepEqual(JSON.parse(await readFile(join(root, failure.ledger), 'utf8')).proposals, [])
  assert.equal(sha256(await readFile(join(root, 'source.kjd'))), sha256(sourceBytes))
  assert.equal(sha256(await readFile(join(root, 'source.dxf'))), sha256(dxfBytes))
  const reopened = await createKJDrawSDK().readDocument(await readFile(join(root, 'source.kjd')), { format: 'KJD' })
  assert.deepEqual(reopened.snapshot().objects, f.before.objects); assert.equal(reopened.listEntities({ type: 'CIRCLE' }).length, 0)
  assert.deepEqual((await readdir(root)).sort(), ['.kjdraw', 'request.json', 'source.dxf', 'source.kjd'])
  unchanged(f)
})
