import test from 'node:test'
import assert from 'node:assert/strict'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'

function fixture(options = {}) {
  const sdk = createKJDrawSDK(options)
  const document = sdk.createDocument({ documentId: 'tools', units: 'millimeter' })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
const point = (x, y) => ({ x, y })
const lineArgs = (revision = 0) => ({ expectedRevision: revision, units: 'millimeter', lines: [{ start: point(0, 0), end: point(100, 0) }] })
const circleArgs = (revision = 0) => ({ expectedRevision: revision, units: 'millimeter', circles: [{ center: point(20, 20), radius: 3 }] })
function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }

test('tool definitions are frozen serializable schemas with no approval or arbitrary execution tool', () => {
  assert.equal(KJDRAW_AGENT_TOOLS.length, 7)
  assert.ok(KJDRAW_AGENT_TOOLS.every(tool => ['read', 'propose'].includes(tool.effect)))
  assert.deepEqual(JSON.parse(JSON.stringify(KJDRAW_AGENT_TOOLS)), KJDRAW_AGENT_TOOLS)
  for (const tool of KJDRAW_AGENT_TOOLS) {
    assert.equal(tool.inputSchema.additionalProperties, false)
    assert.deepEqual(tool.inputSchema.required, Object.keys(tool.inputSchema.properties))
    assert.throws(() => { tool.inputSchema.additionalProperties = true }, TypeError)
  }
})

test('reading and exact distance do not change geometry or history', async () => {
  const { document, session } = fixture()
  const before = document.serialize()
  const context = value(await session.call('cad_read_drawing', {}))
  assert.equal(context.documentId, 'tools')
  assert.equal(context.units, 'millimeter')
  assert.equal(value(await session.call('cad_measure_distance', { expectedRevision: 0, units: 'millimeter', start: point(0, 0), end: point(3, 4) })).distance, 5)
  assert.equal(document.serialize(), before)
})

test('model proposals require host approval, create real geometry and undo as one edit', async () => {
  const { sdk, document, session } = fixture()
  const before = document.serialize()
  const proposal = value(await session.call('cad_propose_lines', lineArgs()))
  assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.previewKind, 'geometry')
  assert.deepEqual(proposal.preview.before, [])
  assert.deepEqual(proposal.preview.after[0].payload.end, [100, 0, 0])
  assert.throws(() => { proposal.preview.after[0].payload.end[0] = 42 }, TypeError)
  assert.equal(document.serialize(), before)
  assert.equal((await session.call('approve', { planId: proposal.planId, reviewerId: 'model' })).ok, false)
  assert.equal(document.serialize(), before)
  assert.throws(() => { proposal.arguments.entities[0].payload.end[0] = 1000 }, TypeError)
  const receipt = value(await session.approve(proposal.planId, 'trusted-user'))
  assert.equal(receipt.afterRevision, 1)
  assert.deepEqual(document.listEntities()[0].payload.end, [100, 0, 0])
  assert.equal(document.listEntities()[0].id, proposal.preview.after[0].id)
  assert.deepEqual(document.listEntities()[0].payload, proposal.preview.after[0].payload)
  assert.equal((await session.approve(proposal.planId, 'trusted-user')).ok, false)
  assert.equal(document.listEntities().length, 1)
  await sdk.executeCommand('UNDO')
  assert.equal(document.listEntities().length, 0)
})

test('circles and moves execute against the bound document even if the active document changes', async () => {
  const { sdk, document, session } = fixture()
  const other = sdk.createDocument({ documentId: 'other', units: 'meter' })
  const circle = value(await session.call('cad_propose_circles', circleArgs()))
  value(await session.approve(circle.planId, 'reviewer'))
  const id = document.listEntities()[0].id
  const proposal = value(await session.call('cad_propose_move', { expectedRevision: 1, units: 'millimeter', ids: [id], dx: 5, dy: -3 }))
  assert.deepEqual(proposal.preview.before[0].payload.center, [20, 20, 0])
  assert.deepEqual(proposal.preview.after[0].payload.center, [25, 17, 0])
  assert.deepEqual(document.getObject(id).payload.center, [20, 20, 0])
  value(await session.approve(proposal.planId, 'reviewer'))
  assert.deepEqual(document.getObject(id).payload.center, [25, 17, 0])
  assert.equal(other.revision, 0)
  assert.equal(other.listEntities().length, 0)
})

test('rejecting proposals and rejecting a forged approval never changes the drawing', async () => {
  const { document, session } = fixture()
  const proposal = value(await session.call('cad_propose_lines', lineArgs()))
  assert.equal((await session.approve(proposal.planId, '')).ok, false)
  assert.equal((await session.call('cad_propose_lines', { ...lineArgs(), confirmation: { status: 'confirmed' } })).ok, false)
  value(session.reject(proposal.planId, 'reviewer'))
  assert.equal((await session.approve(proposal.planId, 'reviewer')).ok, false)
  assert.equal(document.revision, 0)
})

test('stale revisions and changed drawings require a fresh proposal', async () => {
  const { sdk, document, session } = fixture()
  const proposal = value(await session.call('cad_propose_lines', lineArgs()))
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [0, 0] } })
  const before = document.serialize()
  assert.equal((await session.call('cad_propose_circles', circleArgs())).error.code, 'KJDOCUMENT_REVISION_CONFLICT')
  assert.equal((await session.approve(proposal.planId, 'reviewer')).ok, false)
  assert.equal(document.serialize(), before)
})

test('schema and geometric validation reject malformed requests before any plan or edit', async () => {
  const { document, session } = fixture()
  const before = document.serialize()
  const inputs = [
    null, [], {}, { ...lineArgs(), units: 'meter' }, { ...lineArgs(), expectedRevision: 0.5 },
    { ...lineArgs(), lines: [] }, { ...lineArgs(), lines: Array(65).fill(lineArgs().lines[0]) },
    { ...lineArgs(), lines: [{ start: point(0, 0), end: point(0, 0) }] },
    { ...lineArgs(), lines: [{ start: point(0, 0), end: point(Infinity, 0) }] },
    { ...lineArgs(), lines: [{ start: point(0, 0), end: point(1e13, 0) }] },
    { ...lineArgs(), lines: [{ start: { x: '1', y: 0 }, end: point(2, 0) }] },
    { ...lineArgs(), documentId: 'other' },
  ]
  for (const input of inputs) assert.equal((await session.call('cad_propose_lines', input)).ok, false, JSON.stringify(input))
  assert.equal((await session.call('cad_propose_circles', { ...circleArgs(), circles: [{ center: point(0, 0), radius: 0 }] })).ok, false)
  let read = false
  const getter = Object.defineProperty({}, 'units', { get() { read = true; return 'millimeter' } })
  assert.equal((await session.call('cad_propose_lines', getter)).ok, false)
  assert.equal(read, false)
  assert.equal(document.serialize(), before)
})

test('move rejects missing, protected, duplicate and unsupported objects', async () => {
  const { document, session } = fixture()
  await document.transact('Import protected fixture', transaction => {
    const layer = transaction.upsertTableRecord('layers', { name: 'Locked', payload: { locked: true } })
    transaction.createEntity('LINE', { start: [0, 0], end: [1, 0], layerId: layer.id })
    transaction.createEntity('POINT', { position: [0, 0] })
  })
  const ids = document.listEntities().map(entity => entity.id)
  const before = document.serialize()
  for (const selection of [['missing'], [ids[0]], [ids[1]], [ids[1], ids[1]]]) {
    assert.equal((await session.call('cad_propose_move', { expectedRevision: 1, units: 'millimeter', ids: selection, dx: 1, dy: 0 })).ok, false)
  }
  assert.equal(document.serialize(), before)
})

test('pagination is revision-bound and does not pretend omitted pages are complete', async () => {
  const { sdk, session } = fixture()
  await sdk.executeCommand('CREATEBATCH', { entities: Array.from({ length: 55 }, (_, x) => ({ type: 'POINT', payload: { position: [x, 0] } })) })
  const first = value(await session.call('cad_read_drawing', {}))
  assert.equal(first.entities.length, 50)
  assert.equal(first.nextOffset, 50)
  const next = value(await session.call('cad_read_page', { expectedRevision: first.revision, offset: first.nextOffset, layerOffset: 0 }))
  assert.equal(next.entities.length, 5)
  assert.equal(next.nextOffset, null)
  assert.equal((await session.call('cad_read_page', { expectedRevision: 0, offset: 50, layerOffset: 0 })).ok, false)
})

test('concurrent host approvals cannot execute the proposal twice', async () => {
  const { document, session } = fixture()
  const proposal = value(await session.call('cad_propose_lines', lineArgs()))
  const results = await Promise.all([session.approve(proposal.planId, 'user'), session.approve(proposal.planId, 'user')])
  assert.equal(results.filter(result => result.ok).length, 1)
  assert.equal(document.revision, 1)
})

test('sessions cannot access a detached or replaced document', async () => {
  const { sdk, document, session } = fixture()
  sdk.documents.delete(document.id)
  assert.equal((await session.call('cad_read_drawing', {})).ok, false)
  assert.throws(() => new KJAgentToolSession(sdk, document))
})

test('expired and cross-session proposals fail closed', async () => {
  let now = 1000
  const { sdk, document, session } = fixture({ agentPlanOptions: { clock: () => now, defaultTtlMs: 10 } })
  const proposal = value(await session.call('cad_propose_lines', lineArgs()))
  const another = new KJAgentToolSession(sdk, document)
  assert.equal((await another.approve(proposal.planId, 'user')).ok, false)
  now += 20
  assert.equal((await session.approve(proposal.planId, 'user')).ok, false)
  assert.equal(document.revision, 0)
})

test('creation preflight rejects a locked default layer without registering or editing a plan', async () => {
  const { sdk, document, session } = fixture()
  const layer = document.getObject(document.snapshot().tables.layers.currentId)
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } })
  const before = document.serialize()
  const result = await session.call('cad_propose_lines', lineArgs(document.revision))
  assert.equal(result.ok, false)
  assert.equal(document.serialize(), before)
  assert.equal(document.listEntities().length, 0)
})

test('a replacement host command is never executed against an existing preview', async () => {
  const { sdk, document, session } = fixture()
  const proposal = value(await session.call('cad_propose_lines', lineArgs()))
  let executed = false
  sdk.commands.register({ id: 'CREATEBATCH', execute() { executed = true } }, { replace: true })
  const result = await session.approve(proposal.planId, 'reviewer')
  assert.equal(result.ok, false)
  assert.match(result.error.message, /Command changed/)
  assert.equal(executed, false)
  assert.equal(document.revision, 0)
  assert.equal((await session.call('cad_propose_lines', lineArgs())).ok, false)
})

test('preview isolation preserves history and detects a concurrent source edit', async () => {
  const { document, session } = fixture()
  const proposing = session.call('cad_propose_lines', lineArgs())
  await document.transact('Concurrent host edit', transaction => transaction.createEntity('POINT', { position: [7, 8] }))
  const result = await proposing
  assert.equal(result.ok, false)
  assert.match(result.error.message, /changed while preparing/)
  assert.equal(document.listEntities().length, 1)
  assert.equal(document.listEntities()[0].type, 'POINT')
})

test('oversized drawing previews fail before touching the source', async () => {
  const { document, session } = fixture()
  await document.transact('Large imported metadata', transaction => transaction.createEntity('TEXT', { position: [0, 0], text: 'x'.repeat(4194304) }))
  const before = document.serialize()
  const result = await session.call('cad_propose_lines', lineArgs(document.revision))
  assert.equal(result.ok, false)
  assert.match(result.error.message, /4 MiB/)
  assert.equal(document.serialize(), before)
})
