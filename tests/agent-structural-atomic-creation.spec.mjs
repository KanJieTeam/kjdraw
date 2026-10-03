import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createAgentGeometryPreview } from '../packages/kjdraw-sdk/src/agent-preview.js'
import { createAgentHatchPatternCatalog } from '../packages/kjdraw-sdk/src/agent-hatch-pattern.js'
import { canonicalStringify, stableHash } from '../packages/kjdraw-sdk/src/utils.js'

// Entirely original public synthetic native geometry; no client drawing/source facts.
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const hash = value => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const xy = (x, y) => ({ x, y })
const loops = () => [{ vertices: [xy(0, 0), xy(20, 0), xy(20, 20), xy(0, 20)] },
  { vertices: [xy(5, 5), xy(10, 5), xy(10, 10), xy(5, 10)] }]
async function fixture(t, { bundled = false } = {}) {
  const sdk = createKJDrawSDK({ includeBundledHatchPatterns: bundled }), document = sdk.createDocument({ units: 'millimeter' })
  t.after(() => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) })
  await document.transact('Original public synthetic native structural fixture', tx => {
    for (const [id, name, payload] of [['source', 'SOURCE', {}], ['simulation', 'SIMULATION', {}], ['review', 'REVIEW', {}],
      ['locked', 'LOCKED', { locked: true }], ['hidden', 'HIDDEN', { visible: false }], ['frozen', 'FROZEN', { frozen: true }]])
      tx.upsertTableRecord('layers', { id, name, payload })
    const block = tx.upsertTableRecord('blockRecords', { id: 'symbol-definition', name: 'PUBLIC SYMBOL', payload: { basePoint: [0, 0, 0], entityIds: [] } })
    tx.createEntity('LINE', { start: [-1, 0, 0], end: [1, 0, 0], layerId: 'source' }, { id: 'definition-member', ownerId: block.id })
    const insert = tx.createEntity('INSERT', { blockRecordId: block.id, position: [-10, 0, 0], scale: [1, 1, 1], rotation: 0, layerId: 'source', attributeIds: [], sequenceEndId: null }, { id: 'left-hole' })
    tx.createEntity('ATTRIB', { parentInsertId: insert.id, tag: 'ID', text: 'SIM-LEFT', position: [-10, 1, 0], height: 1, layerId: 'source' }, { id: 'left-code', ownerId: insert.ownerId })
    tx.createObject({ id: 'left-end', kind: 'custom', type: 'SEQEND', ownerId: insert.id, payload: { dxfOwnerMode: 'insert', layerId: 'source' } })
    tx.updateObject(insert.id, { payload: { attributeIds: ['left-code'], sequenceEndId: 'left-end' } })
    tx.createEntity('LINE', { start: [30, 0, 0], end: [30, 20, 0], layerId: 'source' }, { id: 'right-line' })
    tx.createEntity('CIRCLE', { center: [50, 50, 0], radius: 2, layerId: 'source' }, { id: 'untargeted' })
    tx.createObject({ id: 'public-group', kind: 'group', type: 'GROUP', ownerId: document.snapshot().namedObjectsDictionaryId, name: 'Public working group', payload: { memberIds: ['left-hole', 'right-line'] } })
  })
  await sdk.getSelectionManager(document.id).saveNamed('Public selection', { ids: ['left-hole', 'right-line'] })
  const session = new KJAgentToolSession(sdk, document)
  const patterns = ok(await session.call('cad_read_hatch_patterns', { expectedRevision: document.revision, search: bundled ? 'STT' : 'ANSI31' }))
  const pattern = patterns.patterns.find(entry => entry.name === (bundled ? 'STT' : 'ANSI31'))
  assert.ok(pattern, JSON.stringify(patterns))
  return { sdk, document, session, pattern }
}
const input = (f, patch = {}) => ({ expectedRevision: f.document.revision, units: 'millimeter', eraseIds: ['left-hole'],
  tolerance: .001, maxBytes: 262144, creations: {
    lines: [{ start: xy(20, 10), end: xy(30, 10), layerId: 'simulation' }],
    polylines: [{ vertices: [xy(0, 25), xy(10, 25), xy(10, 30)], closed: false, layerId: 'simulation' }],
    hatches: [{ loops: loops(), patternId: f.pattern.patternId, patternScale: .75, patternAngleDegrees: 30, layerId: 'simulation' }],
    texts: [{ text: 'Illustrative simulation — not measured strata', position: xy(0, 32), height: 1, rotationDegrees: 0, layerId: 'simulation' }],
  }, ...patch })
const denseLines = (count, layerId = 'simulation') => Array.from({ length: count }, (_, index) => ({ start: xy(index, 40), end: xy(index, 41), layerId }))
function entityTags(bytes) {
  const lines = Buffer.from(bytes).toString('utf8').replace(/\r/g, '').trimEnd().split('\n'), tags = []
  for (let index = 0; index < lines.length; index += 2) tags.push([Number(lines[index].trim()), lines[index + 1].trim()])
  const start = tags.findIndex((tag, index) => tag[0] === 0 && tag[1] === 'SECTION' && tags[index + 1]?.[1] === 'ENTITIES') + 2
  assert.ok(start >= 2)
  const records = []
  for (let index = start; index < tags.length && tags[index][1] !== 'ENDSEC'; index++) {
    if (tags[index][0] === 0) records.push([])
    records.at(-1).push(tags[index])
  }
  return records
}
const tag = (record, code) => record.find(item => item[0] === code)?.[1]
function islandGeometry(payload) {
  assert.equal(payload.boundaryLoops.length, 2)
  const areas = payload.boundaryLoops.map((loop, index) => {
    assert.equal(loop.closed, true); assert.equal(loop.external, index === 0)
    const vertices = loop.vertices.map(vertex => vertex.point ?? vertex)
    assert.deepEqual(vertices, loops()[index].vertices.map(point => [point.x, point.y, 0]))
    return Math.abs(vertices.reduce((sum, a, i) => { const b = vertices[(i + 1) % vertices.length]; return sum + a[0] * b[1] - b[0] * a[1] }, 0)) / 2
  })
  return { outerArea: areas[0], islandArea: areas[1], filledArea: areas[0] - areas[1], loopCount: 2 }
}

test('structural creations are additive FULL-bound typed groups; exact global/scalar wire stays frozen', async t => {
  const f = await fixture(t), unbound = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_structural_edit')
  assert.equal(hash(KJDRAW_AGENT_TOOLS), '2cc7ebef693b7012c0fd3be88f8eb2e9db9668853369a35a2e46fe409d8e44ef')
  assert.equal(Object.hasOwn(unbound.inputSchema.properties, 'creations'), false)
  const bound = f.session.definitions.find(tool => tool.name === unbound.name)
  assert.deepEqual(bound.inputSchema.required, unbound.inputSchema.required)
  assert.deepEqual(Object.keys(bound.inputSchema.properties.creations.properties), ['lines', 'polylines', 'hatches', 'texts'])
  assert.equal(bound.inputSchema.properties.creations.additionalProperties, false)
  assert.match(bound.description, /16 total creations plus reconnections.*64 total changed records/)
  assert.match(bound.description, /never model-supplied PAT/)
  const scalar = new KJAgentToolSession(f.sdk, f.document, { toolProfile: 'geology-scalars-v1' })
  assert.equal(hash(scalar.definitions), '30326cf01cd7e970ca6073ddbe0cd7a665262adb1f8f39e51bb7af68883ffd2f')
  assert.equal((await scalar.call(unbound.name, input(f))).ok, false)
})

for (const bundled of [false, true]) test(`one atomic approved edit erases owned native records, creates all four types and seals ${bundled ? 'bundled STT PAT' : 'ANSI31'} island; DXF reopen/undo/redo`, async t => {
  const f = await fixture(t, { bundled }), { sdk, document, session } = f, before = document.snapshot(), history = document.history, revision = document.revision
  const proposal = ok(await session.call('cad_propose_structural_edit', input(f, { relayer: { ids: ['right-line'], layerId: 'review' } })))
  assert.equal(document.snapshot(), before); assert.deepEqual(document.history, history)
  assert.equal(proposal.command, 'STRUCTURALEDIT'); assert.equal(proposal.structuralEdit.semanticInference, 'none')
  assert.deepEqual(proposal.structuralEdit.effectiveEraseIds, ['left-code', 'left-end', 'left-hole'])
  assert.equal(proposal.arguments.creations.length, 4)
  assert.deepEqual(proposal.structuralEdit.creationIds, proposal.arguments.creations.map(item => item.id))
  assert.deepEqual(new Set(proposal.preview.before.map(item => item.id)), new Set(['left-code', 'left-hole', 'right-line']))
  assert.deepEqual(new Set(proposal.preview.after.map(item => item.id)), new Set([...proposal.structuralEdit.creationIds, 'right-line']))
  assert.deepEqual(new Set(proposal.preview.recordChanges.map(item => item.id)), new Set(['left-end', 'public-group', sdk.getSelectionManager(document.id).listNamed()[0].id]))
  assert.equal(proposal.preview.resources?.length ?? 0, 0)
  const hatchSpec = proposal.arguments.creations.find(item => item.type === 'HATCH'), hatchPreview = proposal.preview.after.find(item => item.id === hatchSpec.id)
  assert.deepEqual(islandGeometry(hatchPreview.payload), { outerArea: 400, islandArea: 25, filledArea: 375, loopCount: 2 })
  const expectedPattern = createAgentHatchPatternCatalog(document, sdk.hatchPatternCatalogs ?? []).entries.find(entry => entry.patternId === f.pattern.patternId)
  assert.ok(expectedPattern); assert.deepEqual(hatchSpec.payload.patternLines, expectedPattern.pattern.patternLines)
  assert.equal(hatchSpec.payload.patternName, bundled ? 'STT' : 'ANSI31')
  assert.equal(hatchSpec.payload.patternScale, .75); assert.equal(hatchSpec.payload.patternAngle, Math.PI / 6)
  assert.throws(() => { hatchSpec.payload.patternLines[0].offset[0] = 999 }, TypeError)
  assert.throws(() => { proposal.arguments.creations[0].payload.end[0] = 999 }, TypeError)
  assert.equal((await session.approve(proposal.planId, '')).ok, false); assert.equal(document.snapshot(), before)
  ok(await session.approve(proposal.planId, 'fixture-host-reviewer'))
  assert.equal(document.revision, revision + 1); assert.equal(document.history.undoCount, history.undoCount + 1)
  for (const id of proposal.structuralEdit.effectiveEraseIds) assert.equal(document.getObject(id), null)
  for (const record of proposal.preview.after) assert.deepEqual(document.getObject(record.id).payload, record.payload)
  for (const id of ['untargeted', 'definition-member', 'symbol-definition', 'source', 'simulation']) assert.deepEqual(document.getObject(id), before.objects[id])
  assert.deepEqual(document.getObject('public-group').payload.memberIds, ['right-line'])
  const afterObjects = document.snapshot().objects, bytes = await sdk.writeDocument(document, { format: 'DXF' }), records = entityTags(bytes), hatchRecord = records.find(record => tag(record, 5) === document.getObject(hatchSpec.id).handle)
  assert.equal(tag(hatchRecord, 0), 'HATCH'); assert.equal(tag(hatchRecord, 2), bundled ? 'STT' : 'ANSI31')
  assert.equal(tag(hatchRecord, 91), '2'); assert.equal(tag(hatchRecord, 78), String(hatchSpec.payload.patternLines.length))
  assert.deepEqual(hatchRecord.filter(item => item[0] === 92).map(item => Number(item[1])), [3, 2])
  assert.equal(records.some(record => tag(record, 5) === before.objects['left-hole'].handle), false)
  const reopened = await sdk.readDocument(bytes, { format: 'DXF' })
  assert.equal(reopened.validate().valid, true)
  const reopenedHatch = reopened.listEntities({ type: 'HATCH' }).find(item => item.handle === document.getObject(hatchSpec.id).handle)
  assert.deepEqual(islandGeometry(reopenedHatch.payload), islandGeometry(hatchPreview.payload))
  assert.equal(reopenedHatch.payload.patternLines.length, hatchSpec.payload.patternLines.length)
  assert.equal(reopened.listEntities({ type: 'TEXT' }).some(item => item.payload.text === input(f).creations.texts[0].text), true)
  assert.equal((await session.approve(proposal.planId, 'fixture-host-reviewer')).ok, false)
  await document.undo(); assert.deepEqual(document.snapshot().objects, before.objects)
  await document.redo(); assert.deepEqual(document.snapshot().objects, afterObjects)
})

test('legacy core erase-only receipt keeps its original shape; no new resources or source recipe', async t => {
  const f = await fixture(t), result = await f.sdk.executeCommand('STRUCTURALEDIT', { eraseIds: ['left-hole'], reconnections: [] }, { document: f.document })
  assert.deepEqual(Object.keys(result), ['semanticInference', 'effectiveEraseIds', 'erased', 'relayered', 'reconnected'])
  assert.deepEqual(Object.keys(f.document.snapshot().opaquePayloads), [])
})

const badInputs = [
  ['raw PAT injection', f => { const v = input(f); v.creations.hatches[0].patternLines = []; return v }],
  ['raw native payload injection', f => ({ ...input(f), creations: { entities: [{ type: 'HATCH', payload: {} }] } })],
  ['unknown create group', f => ({ ...input(f), creations: { circles: [] } })],
  ['hidden source facts', f => { const v = input(f); v.creations.texts[0].sourceMeasurements = { depth: 8 }; return v }],
  ['injected owner', f => { const v = input(f); v.creations.lines[0].ownerId = 'symbol-definition'; return v }],
  ['injected entity ID', f => { const v = input(f); v.creations.lines[0].id = 'untargeted'; return v }],
  ['missing exact pattern ref', f => { const v = input(f); delete v.creations.hatches[0].patternId; return v }],
  ['unknown PAT ref', f => { const v = input(f); v.creations.hatches[0].patternId = 'STT'; return v }],
  ['empty creation object', f => ({ ...input(f), creations: {} })],
  ['empty creation arrays', f => ({ ...input(f), creations: { lines: [] } })],
  ['17 combined creations', f => ({ ...input(f), creations: { lines: denseLines(16) }, reconnections: [{ type: 'LINE', points: [xy(0, 60), xy(1, 60)], layerId: 'simulation' }] })],
  ['missing target layer', f => ({ ...input(f), creations: { lines: denseLines(1, 'missing') } })],
  ['locked target layer', f => ({ ...input(f), creations: { lines: denseLines(1, 'locked') } })],
  ['hidden target layer', f => ({ ...input(f), creations: { lines: denseLines(1, 'hidden') } })],
  ['frozen target layer', f => ({ ...input(f), creations: { lines: denseLines(1, 'frozen') } })],
  ['wrong resource kind', f => ({ ...input(f), creations: { lines: denseLines(1, 'symbol-definition') } })],
  ['degenerate line', f => ({ ...input(f), creations: { lines: [{ start: xy(1, 1), end: xy(1, 1), layerId: 'simulation' }] } })],
  ['closed polyline has two vertices', f => ({ ...input(f), creations: { polylines: [{ vertices: [xy(1, 1), xy(2, 2)], closed: true, layerId: 'simulation' }] } })],
  ['display bounds overflow', f => ({ ...input(f), creations: { texts: [{ text: 'Explicit label', position: xy(1e12, 0), height: 1e12, rotationDegrees: 0, layerId: 'simulation' }] } })],
  ['wrong units', f => ({ ...input(f), units: 'meter' })],
  ['stale revision', f => ({ ...input(f), expectedRevision: f.document.revision - 1 })],
  ['small complete preview budget', f => ({ ...input(f), maxBytes: 1024 })],
]
for (const [name, build] of badInputs) test(`fail-closed structural creation: ${name}`, async t => {
  const f = await fixture(t), before = f.document.snapshot(), history = f.document.history
  const result = await f.session.call('cad_propose_structural_edit', build(f))
  assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(f.document.snapshot(), before)
  assert.deepEqual(f.document.history, history); assert.deepEqual(f.sdk.agentPlans.list(), [])
})

for (const [name, hide] of [
  ['top-level creations', args => { Object.defineProperty(args, 'creations', { value: args.creations, enumerable: false }) }],
  ['optional hatches group', args => { Object.defineProperty(args.creations, 'hatches', { value: args.creations.hatches, enumerable: false }) }],
  ['nested required geometry coordinate', args => { Object.defineProperty(args.creations.lines[0].start, 'x', { value: args.creations.lines[0].start.x, enumerable: false }) }],
]) test(`original structural input rejects hidden ${name} before cloning or preparing a partial proposal`, async t => {
  const f = await fixture(t), args = input(f), before = f.document.snapshot(), history = f.document.history
  hide(args)
  const result = await f.session.call('cad_propose_structural_edit', args)
  assert.equal(result.ok, false, `Hidden ${name} must not become a successful partial edit`)
  assert.match(result.error.message, /enumerable.*plain data|hidden changes/i)
  assert.equal(f.document.snapshot(), before); assert.deepEqual(f.document.history, history)
  assert.deepEqual(f.sdk.agentPlans.list(), [])
})

for (const [name, patch] of [
  ['island outside outer', hatch => { hatch.loops[1].vertices = [xy(25, 25), xy(27, 25), xy(27, 27)] }],
  ['island touches outer', hatch => { hatch.loops[1].vertices = [xy(0, 5), xy(5, 5), xy(5, 10), xy(0, 10)] }],
  ['self crossing loop', hatch => { hatch.loops[0].vertices = [xy(0, 0), xy(20, 20), xy(20, 0), xy(0, 20)] }],
  ['nested empty islands', hatch => { hatch.loops.push({ vertices: [xy(6, 6), xy(7, 6), xy(7, 7), xy(6, 7)] }) }],
  ['repeated closure vertex', hatch => { hatch.loops[0].vertices.push(xy(0, 0)) }],
]) test(`HATCH polygon semantics reject ${name} before any source mutation`, async t => {
  const f = await fixture(t), v = input(f), before = f.document.snapshot(); patch(v.creations.hatches[0])
  assert.equal((await f.session.call('cad_propose_structural_edit', v)).ok, false)
  assert.equal(f.document.snapshot(), before); assert.deepEqual(f.sdk.agentPlans.list(), [])
})

test('64 total changes include owned records and actual group/selection memberships; exact full-record boundary succeeds and 65 fails preview/core', async t => {
  const f = await fixture(t)
  await f.document.transact('Original public budget filler', tx => {
    for (let index = 0; index < 44; index++) tx.createEntity('LINE', { start: [index, 80, 0], end: [index, 81, 0], layerId: 'source' }, { id: `filler-${index}` })
  })
  const eraseIds = ['left-hole', ...Array.from({ length: 44 }, (_, index) => `filler-${index}`)]
  const before = f.document.snapshot(), args = input(f, { eraseIds, creations: { lines: denseLines(16) } })
  const bad = await f.session.call('cad_propose_structural_edit', args)
  assert.equal(bad.ok, false); assert.match(bad.error.message, /64 total/); assert.equal(f.document.snapshot(), before)
  const native = { eraseIds, reconnections: [], creations: denseLines(16).map((item, index) => ({ id: `native-${index}`, type: 'LINE', payload: { start: [item.start.x, item.start.y, 0], end: [item.end.x, item.end.y, 0], layerId: 'simulation' } })) }
  await assert.rejects(createAgentGeometryPreview(f.document, 'STRUCTURALEDIT', native), /64 total/)
  await assert.rejects(f.sdk.executeCommand('STRUCTURALEDIT', native, { document: f.document }), /64 total/)
  assert.equal(f.document.snapshot(), before)
  const good = ok(await f.session.call('cad_propose_structural_edit', { ...args, eraseIds: eraseIds.slice(0, -1) }))
  assert.equal(good.structuralEdit.effectiveEraseIds.length + good.arguments.creations.length + good.preview.recordChanges.filter(record => record.before.kind === 'group').length, 64)
  ok(await f.session.approve(good.planId, 'fixture-host-reviewer'))
  const after = f.document.snapshot(), ids = [...new Set([...Object.keys(before.objects), ...Object.keys(after.objects)])]
  const changed = ids.filter(id => { const record = after.objects[id] ?? before.objects[id]; return (record.kind === 'entity' || record.kind === 'group' || record.type === 'SEQEND') && canonicalStringify(before.objects[id] ?? null) !== canonicalStringify(after.objects[id] ?? null) })
  assert.equal(changed.length, 64)
  await f.document.undo(); assert.deepEqual(f.document.snapshot().objects, before.objects)
})

test('core creation IDs, owner/raw fields and PAT integrity reject before erase; prepared args are immutable', async t => {
  const f = await fixture(t), plan = ok(await f.session.call('cad_propose_structural_edit', input(f))), original = structuredClone(plan.arguments), before = f.document.snapshot()
  ok(f.session.reject(plan.planId, 'fixture-host-reviewer'))
  const mutations = [
    v => { v.creations[0].id = 'untargeted' },
    v => { v.creations[1].id = v.creations[0].id },
    v => { v.creations[0].ownerId = 'symbol-definition' },
    v => { v.creations[0].payload.rawTags = [] },
    v => { v.creations[2].payload.patternLines = [] },
    v => { v.creations[2].payload.patternDefinitionScale = 2 },
    v => { v.creations[2].payload.boundaryLoops[1].external = true },
    v => { v.creations[0].type = 'INSERT' },
  ]
  for (const mutate of mutations) {
    const v = structuredClone(original); mutate(v)
    await assert.rejects(f.sdk.executeCommand('STRUCTURALEDIT', v, { document: f.document }))
    assert.equal(f.document.snapshot(), before)
  }
  let invoked = false
  const v = structuredClone(original); Object.defineProperty(v.creations[0].payload, 'start', { enumerable: true, get() { invoked = true; return [0, 0, 0] } })
  await assert.rejects(createAgentGeometryPreview(f.document, 'STRUCTURALEDIT', v), /accessors|opaque/)
  assert.equal(invoked, false); assert.equal(f.document.snapshot(), before)
})

test('source-bound geometry and non-model scopes cannot be erased to make room for creations', async t => {
  const f = await fixture(t)
  await f.sdk.executeCommand('DESIGNCREATE', { name: 'Public exact relation', definition: { parameters: [{ name: 'y', value: 20, min: 1, max: 100 }], derived: [],
    bindings: [{ entityId: 'right-line', path: 'end.1', expression: { constant: 0, terms: [{ parameter: 'y', coefficient: 1 }] } }], requirements: [] } }, { document: f.document })
  let paperId
  await f.document.transact('Public paper scope', tx => {
    paperId = tx.createLayout({ id: 'paper-layout', blockRecordId: 'paper-space', name: 'Paper' }).payload.blockRecordId
    tx.createEntity('LINE', { start: [0, 0, 0], end: [5, 0, 0], layerId: 'source' }, { id: 'paper-line', ownerId: paperId })
  })
  const before = f.document.snapshot()
  for (const [id, message] of [['right-line', /design relation/], ['definition-member', /model-space/], ['paper-line', /model-space/]]) {
    const result = await f.session.call('cad_propose_structural_edit', input(f, { eraseIds: [id] }))
    assert.equal(result.ok, false); assert.match(result.error.message, message); assert.equal(f.document.snapshot(), before)
  }
})

test('foreign and stale/rejected atomic plans cannot replay', async t => {
  const f = await fixture(t), proposal = ok(await f.session.call('cad_propose_structural_edit', input(f)))
  const foreign = new KJAgentToolSession(f.sdk, f.document)
  assert.equal((await foreign.approve(proposal.planId, 'fixture-host-reviewer')).ok, false)
  await f.document.transact('Concurrent edit', tx => tx.updateObject('untargeted', { payload: { radius: 3 } }))
  const before = f.document.snapshot(), result = await f.session.approve(proposal.planId, 'fixture-host-reviewer')
  assert.equal(result.ok, false); assert.equal(f.document.snapshot(), before)
  assert.equal((await f.session.approve(proposal.planId, 'fixture-host-reviewer')).ok, false)
})

test('caller-owned host PAT catalog mutation cannot alter the prepared native definition at approval', async t => {
  const f = await fixture(t), patterns = [{ name: 'PUBLIC_SIM', description: 'Original public simulation PAT', lines: [{ angle: .2, base: [1, 2], offset: [0, 4], dashes: [2, -2] }] }]
  const catalog = { version: '1.0.0', contentHash: stableHash(patterns), patterns }
  const session = new KJAgentToolSession(f.sdk, f.document, { hatchPatternCatalogs: [catalog] })
  const read = ok(await session.call('cad_read_hatch_patterns', { expectedRevision: f.document.revision, search: 'PUBLIC_SIM' }))
  const v = input(f); v.creations.hatches[0].patternId = read.patterns[0].patternId
  const plan = ok(await session.call('cad_propose_structural_edit', v)), hatch = plan.arguments.creations.find(item => item.type === 'HATCH'), preparedLines = structuredClone(hatch.payload.patternLines)
  assert.deepEqual(preparedLines, patterns[0].lines)
  patterns[0].lines[0].offset[1] = 999
  ok(await session.approve(plan.planId, 'fixture-host-reviewer'))
  assert.deepEqual(f.document.getObject(hatch.id).payload.patternLines, preparedLines)
  assert.notDeepEqual(f.document.getObject(hatch.id).payload.patternLines, patterns[0].lines)
})

test('exact plan argument seal rejects valid-geometry and PAT-parameter tampering before approval', async t => {
  const f = await fixture(t), plan = ok(await f.session.call('cad_propose_structural_edit', input(f))), before = f.document.snapshot()
  for (const mutate of [v => { v.creations[0].payload.end[0] += 1 }, v => { v.creations[2].payload.patternScale *= 2 }, v => { v.creations[2].payload.patternLines[0].offset[0] += 1 }, v => { v.eraseIds = ['untargeted'] }]) {
    const changed = structuredClone(plan.arguments); mutate(changed)
    const envelope = f.sdk.createCommandEnvelope('STRUCTURALEDIT', changed, { document: f.document, expectedRevision: before.revision, origin: 'ai', confirmation: { status: 'confirmed', planId: plan.planId, confirmedBy: 'fixture-host-reviewer' } })
    await assert.rejects(f.sdk.executeCommandEnvelope(envelope, { document: f.document }), /do not match/)
    assert.equal(f.document.snapshot(), before); assert.equal(f.sdk.agentPlans.get(plan.planId).status, 'active')
  }
  ok(await f.session.approve(plan.planId, 'fixture-host-reviewer'))
})

for (const [id, patch] of [['left-code', { layerId: 'locked' }], ['left-end', { layerId: 'frozen' }], ['left-end', { locked: true }]])
test(`effective owned erase protection is fail-closed with creations: ${id} ${JSON.stringify(patch)}`, async t => {
  const f = await fixture(t)
  await f.document.transact('Explicit protected owned record', tx => tx.updateObject(id, { payload: patch }))
  const before = f.document.snapshot(), result = await f.session.call('cad_propose_structural_edit', input(f))
  assert.equal(result.ok, false); assert.match(result.error.message, /locked|frozen|editable/)
  assert.equal(f.document.snapshot(), before); assert.deepEqual(f.sdk.agentPlans.list(), [])
})

for (const bundled of [false, true]) test(`independent ezdxf reads native ${bundled ? 'bundled STT' : 'ANSI31'} atomic island output without repair`, { skip: !process.env.KJDRAW_PYTHON }, async t => {
  const f = await fixture(t, { bundled }), plan = ok(await f.session.call('cad_propose_structural_edit', input(f)))
  ok(await f.session.approve(plan.planId, 'fixture-host-reviewer'))
  const bytes = await f.sdk.writeDocument(f.document, { format: 'DXF' })
  const code = 'import io,json,sys,ezdxf\ndoc=ezdxf.read(io.StringIO(sys.stdin.read()))\na=doc.audit()\nh=list(doc.modelspace().query("HATCH"))\np=h[0].paths\narea=lambda v:abs(sum(v[i][0]*v[(i+1)%len(v)][1]-v[(i+1)%len(v)][0]*v[i][1] for i in range(len(v))))/2\nprint(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"hatches":len(h),"paths":len(p),"pattern":h[0].dxf.pattern_name,"area":area(p[0].vertices)-area(p[1].vertices),"flags":[x.path_type_flags for x in p],"lines":len(h[0].pattern.lines),"types":[e.dxftype() for e in doc.modelspace()]}))'
  const child = spawnSync(process.env.KJDRAW_PYTHON, ['-c', code], { input: Buffer.from(bytes).toString('utf8'), encoding: 'utf8', windowsHide: true })
  assert.equal(child.status, 0, child.stderr)
  const actual = JSON.parse(child.stdout)
  assert.deepEqual({ errors: actual.errors, fixes: actual.fixes, hatches: actual.hatches, paths: actual.paths, pattern: actual.pattern, area: actual.area, flags: actual.flags }, { errors: 0, fixes: 0, hatches: 1, paths: 2, pattern: bundled ? 'STT' : 'ANSI31', area: 375, flags: [3, 2] })
  assert.equal(actual.lines, plan.arguments.creations.find(item => item.type === 'HATCH').payload.patternLines.length)
  for (const type of ['LINE', 'LWPOLYLINE', 'HATCH', 'TEXT']) assert.ok(actual.types.includes(type))
})
