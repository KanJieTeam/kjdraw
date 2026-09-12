import assert from 'node:assert/strict'
import test from 'node:test'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'
import { KJDocument, createKJDrawSDK } from '../src/index.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-stretch', units: 'millimeter' })
  let line, path
  await document.transact('Agent stretch fixtures', transaction => {
    line = transaction.createEntity('LINE', { start: [-5, 0, 3], end: [5, 0, 4], color: 2 })
    path = transaction.createEntity('LWPOLYLINE', { vertices: [
      { point: [-5, 5], bulge: 0.5, startWidth: 1, endWidth: 2 },
      { point: [5, 5], bulge: -0.25, startWidth: 3, endWidth: 4 },
      { point: [15, 5], bulge: 0, startWidth: 0, endWidth: 0 },
    ], elevation: 9, closed: false, lineweight: 30 })
  })
  const group = await sdk.executeCommand('GROUP', { name: 'Stretch assembly', ids: [line.id, path.id] })
  return { sdk, document, session: new KJAgentToolSession(sdk, document), line, path, group }
}

test('AI STRETCH previews exact crossing-window vertices and approves one stable undoable edit', async () => {
  const { sdk, document, session, line, path, group } = await fixture()
  const before = document.serialize(), originalLine = document.getObject(line.id), originalPath = document.getObject(path.id)
  const proposal = value(await session.call('cad_propose_stretch', {
    expectedRevision: document.revision, units: 'millimeter', ids: [line.id, path.id],
    crossingStart: { x: 0, y: 10 }, crossingEnd: { x: 10, y: -1 }, dx: 5, dy: 2,
  }))
  assert.equal(document.serialize(), before)
  assert.equal(proposal.command, 'STRETCH')
  assert.deepEqual(proposal.arguments, { ids: [line.id, path.id], crossingStart: [0, 10], crossingEnd: [10, -1], dx: 5, dy: 2 })
  assert.deepEqual(proposal.preview.before.map(entity => entity.id), [line.id, path.id])
  assert.deepEqual(proposal.preview.after[0].payload, { ...originalLine.payload, start: [-5, 0, 3], end: [10, 2, 4] })
  assert.deepEqual(proposal.preview.after[1].payload.vertices.map(vertex => vertex.point), [[-5, 5, 0], [10, 7, 0], [15, 5, 0]])
  assert.deepEqual(proposal.preview.after[1].payload.vertices.map(vertex => [vertex.bulge, vertex.startWidth, vertex.endWidth]), [[0.5, 1, 2], [-0.25, 3, 4], [0, 0, 0]])
  value(await session.approve(proposal.planId, 'host-reviewer'))
  assert.equal(document.getObject(line.id).handle, originalLine.handle)
  assert.equal(document.getObject(path.id).handle, originalPath.handle)
  assert.deepEqual(document.getObject(group.id).payload.memberIds, [line.id, path.id])
  assert.equal(document.validate().valid, true)
  assert.equal(KJDocument.open(document.serialize()).serialize(), document.serialize())
  assert.equal(document.getObject(path.id).payload.elevation, 9)
  assert.equal(document.getObject(path.id).payload.lineweight, 30)

  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.deepEqual(reopened.listEntities({ type: 'LINE' })[0].payload.end, [10, 2, 4])
  assert.deepEqual(reopened.listEntities({ type: 'LWPOLYLINE' })[0].payload.vertices.map(vertex => vertex.point), [[-5, 5, 0], [10, 7, 0], [15, 5, 0]])
  await sdk.executeCommand('UNDO')
  assert.deepEqual(document.getObject(line.id), originalLine)
  assert.deepEqual(document.getObject(path.id), originalPath)
  await sdk.executeCommand('REDO')
  assert.deepEqual(document.getObject(line.id).payload.end, [10, 2, 4])
  assert.deepEqual(document.getObject(path.id).payload.vertices[1].point, [10, 7, 0])
  assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
})

test('AI STRETCH rejects ambiguous, protected, unsupported, empty and unbounded edits atomically', async () => {
  const { document, session, line } = await fixture()
  const lockedLayer = await document.transact('Create stretch layer', transaction => transaction.upsertTableRecord('layers', { name: 'Locked stretch', payload: { locked: false, visible: true, frozen: false } }))
  await document.transact('Unsafe stretch fixtures', transaction => {
    transaction.createEntity('LINE', { start: [0, 20, 0], end: [5, 20, 0], visible: false }, { id: 'hidden-line' })
    transaction.createEntity('LINE', { start: [0, 30, 0], end: [5, 30, 0], layerId: lockedLayer.id }, { id: 'locked-line' })
    transaction.createEntity('LINE', { start: [0, 40, 0], end: [5, 40, 0] }, { id: 'paper-line', ownerId: document.snapshot().spaces.paperSpaceIds[0] })
    transaction.createEntity('CIRCLE', { center: [0, 50, 0], radius: 2 }, { id: 'circle' })
    transaction.createEntity('POLYLINE', { vertices: [[0, 60, 0], [5, 60, 0]], flags: 8 }, { id: 'polyline-3d' })
    transaction.createEntity('LWPOLYLINE', { vertices: [[0, 70, 0], [5, 70, 0]], normal: [0, 1, 0] }, { id: 'ocs-path' })
    transaction.createEntity('LINE', { start: [0, 80, 0], end: [5, 80, 0], thickness: 1 }, { id: 'thick-line' })
  })
  await document.transact('Lock stretch layer', transaction => transaction.updateObject(lockedLayer.id, { payload: { locked: true } }))
  const revision = document.revision, before = document.serialize()
  const base = { expectedRevision: revision, units: 'millimeter', ids: [line.id], crossingStart: { x: 0, y: -1 }, crossingEnd: { x: 10, y: 1 }, dx: 1, dy: 0 }
  const invalid = [
    { ...base, ids: [line.id, line.id] },
    { ...base, ids: [] },
    { ...base, ids: ['missing'] },
    { ...base, ids: Array(65).fill(line.id) },
    { ...base, ids: [line.id, 'hidden-line'] },
    { ...base, crossingEnd: { x: 0, y: 1 } },
    { ...base, dx: 0, dy: 0 },
    { ...base, crossingStart: { x: 20, y: 20 }, crossingEnd: { x: 30, y: 30 } },
    { ...base, ids: ['hidden-line'], crossingStart: { x: -1, y: 19 }, crossingEnd: { x: 6, y: 21 } },
    { ...base, ids: ['locked-line'], crossingStart: { x: -1, y: 29 }, crossingEnd: { x: 6, y: 31 } },
    { ...base, ids: ['paper-line'], crossingStart: { x: -1, y: 39 }, crossingEnd: { x: 6, y: 41 } },
    { ...base, ids: ['circle'], crossingStart: { x: -3, y: 47 }, crossingEnd: { x: 3, y: 53 } },
    { ...base, ids: ['polyline-3d'], crossingStart: { x: -1, y: 59 }, crossingEnd: { x: 6, y: 61 } },
    { ...base, ids: ['ocs-path'], crossingStart: { x: -1, y: 69 }, crossingEnd: { x: 6, y: 71 } },
    { ...base, ids: ['thick-line'], crossingStart: { x: -1, y: 79 }, crossingEnd: { x: 6, y: 81 } },
    { ...base, from: { x: 0, y: 0 } },
    { ...base, crossingStart: { x: 4, y: -1 }, crossingEnd: { x: 6, y: 1 }, dx: 1e12 },
    { ...base, expectedRevision: revision - 1 },
  ]
  for (const args of invalid) {
    const result = await session.call('cad_propose_stretch', args)
    assert.equal(result.ok, false, JSON.stringify(args))
    assert.equal(document.serialize(), before)
    assert.equal(document.revision, revision)
  }
})

test('AI STRETCH includes window edges, moves whole selections and rejects stale or substituted approvals', async () => {
  const { sdk, document, session, line } = await fixture()
  const args = { expectedRevision: document.revision, units: 'millimeter', ids: [line.id], crossingStart: { x: -5, y: -1 }, crossingEnd: { x: 5, y: 1 }, dx: 2, dy: 3 }
  const proposal = value(await session.call('cad_propose_stretch', args))
  assert.deepEqual(proposal.preview.after[0].payload.start, [-3, 3, 3])
  assert.deepEqual(proposal.preview.after[0].payload.end, [7, 3, 4])
  await sdk.executeCommand('MOVE', { ids: [line.id], dx: 1, dy: 0 })
  const drift = document.serialize()
  assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
  assert.equal(document.serialize(), drift)

  const replacement = value(await session.call('cad_propose_stretch', { ...args, expectedRevision: document.revision, crossingEnd: { x: 6, y: 1 } }))
  let invoked = false
  sdk.commands.register({ id: 'STRETCH', execute() { invoked = true } }, { owner: 'plugin', replace: true })
  assert.equal((await session.approve(replacement.planId, 'host-reviewer')).ok, false)
  assert.equal(invoked, false)
  assert.equal(document.serialize(), drift)

  const direct = { ids: [line.id], crossingStart: [-5, -1], crossingEnd: [6, 1], dx: 1, dy: 0 }
  await assert.rejects(createAgentGeometryPreview(document, 'STRETCH', { ...direct, ids: [line.id, line.id] }), /unique strings/)
  await assert.rejects(createAgentGeometryPreview(document, 'STRETCH', { ...direct, ids: [1] }), /unique strings/)
  await assert.rejects(createAgentGeometryPreview(document, 'STRETCH', { ...direct, from: [0, 0] }), /Unexpected/)
  assert.equal(document.serialize(), drift)
})

test('AI STRETCH definition is compact and available to model tool selection', () => {
  const definition = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_stretch')
  assert.equal(definition.effect, 'propose')
  assert.deepEqual(definition.inputSchema.required, ['expectedRevision', 'units', 'ids', 'crossingStart', 'crossingEnd', 'dx', 'dy'])
  assert.match(definition.description, /host approval/i)
  assert.ok(Buffer.byteLength(JSON.stringify(definition), 'utf8') < 3000)
})
