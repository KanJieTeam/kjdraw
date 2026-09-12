import assert from 'node:assert/strict'
import test from 'node:test'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'
import { createKJDrawSDK, entityLength2 } from '../src/index.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)

async function fixture(options = {}) {
  const sdk = createKJDrawSDK(options), document = sdk.createDocument({ documentId: 'agent-pedit', units: 'millimeter' })
  await document.transact('Agent polyline fixtures', transaction => {
    transaction.createEntity('LWPOLYLINE', { vertices: [{ point: [0, 0], bulge: 1, startWidth: 2, endWidth: 6 }, { point: [10, 0] }], closed: false }, { id: 'curve' })
    transaction.createEntity('LWPOLYLINE', { vertices: [[0, 10], [5, 10], [10, 10]], closed: false }, { id: 'path' })
    transaction.createEntity('LWPOLYLINE', { vertices: [[0, 20], [10, 20]], closed: false, visible: false }, { id: 'hidden-path' })
    transaction.createEntity('LWPOLYLINE', { vertices: [[0, 30], [10, 30]], closed: false, locked: true }, { id: 'locked-path' })
    transaction.createEntity('LWPOLYLINE', { vertices: [[0, 40], [10, 40]], closed: false, frozen: true }, { id: 'frozen-path' })
    transaction.createEntity('LWPOLYLINE', { vertices: [[0, 50], [10, 50]], closed: false }, { id: 'paper-path', ownerId: document.snapshot().spaces.paperSpaceIds[0] })
    transaction.createEntity('CIRCLE', { center: [20, 0], radius: 2 }, { id: 'circle' })
  })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}

test('AI PEDIT previews and approves an exact bulge-arc split with one undoable stable-identity edit', async () => {
  const { sdk, document, session } = await fixture()
  const source = document.serialize(), original = document.getObject('curve'), originalLength = entityLength2(original).value
  const proposal = value(await session.call('cad_propose_polyline_edit', {
    expectedRevision: document.revision, units: 'millimeter', id: 'curve', operation: 'INSERT', segmentIndex: 0, point: { x: 5, y: -5 },
  }))
  assert.equal(document.serialize(), source)
  assert.equal(proposal.command, 'PEDIT'); assert.deepEqual(proposal.arguments, { id: 'curve', operation: 'INSERT', segmentIndex: 0, point: [5, -5, 0] })
  assert.deepEqual(proposal.preview.before.map(entity => entity.id), ['curve'])
  assert.deepEqual(proposal.preview.after.map(entity => entity.id), ['curve'])
  assert.equal(proposal.preview.after[0].payload.vertices.length, 3)
  close(proposal.preview.after[0].payload.vertices[0].bulge, Math.tan(Math.PI / 8))
  close(proposal.preview.after[0].payload.vertices[1].bulge, Math.tan(Math.PI / 8))
  close(entityLength2(proposal.preview.after[0]).value, originalLength)
  assert.throws(() => { proposal.preview.after[0].payload.vertices[0].bulge = 0 }, TypeError)

  const receipt = value(await session.approve(proposal.planId, 'host-reviewer'))
  assert.equal(receipt.command, 'PEDIT'); assert.equal(document.revision, 2)
  assert.equal(document.getObject('curve').id, original.id); assert.equal(document.getObject('curve').handle, original.handle)
  close(entityLength2(document.getObject('curve')).value, originalLength)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  close(entityLength2(reopened.listEntities({ type: 'LWPOLYLINE' })[0]).value, originalLength, 1e-7)
  assert.equal(reopened.listEntities({ type: 'LWPOLYLINE' })[0].payload.vertices.length, 3)
  await sdk.executeCommand('UNDO'); assert.deepEqual(document.getObject('curve'), original)
  await sdk.executeCommand('REDO'); assert.equal(document.getObject('curve').payload.vertices.length, 3)
  assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
})

test('AI PEDIT supports delete and signed sweep proposals while rejecting ambiguous or unsafe inputs without edits', async () => {
  const { document, session } = await fixture()
  let proposal = value(await session.call('cad_propose_polyline_edit', {
    expectedRevision: document.revision, units: 'millimeter', id: 'path', operation: 'DELETE', vertexIndex: 1,
  }))
  assert.deepEqual(proposal.preview.after[0].payload.vertices.map(vertex => vertex.point), [[0, 10, 0], [10, 10, 0]])
  value(await session.approve(proposal.planId, 'host-reviewer'))
  proposal = value(await session.call('cad_propose_polyline_edit', {
    expectedRevision: document.revision, units: 'millimeter', id: 'path', operation: 'SET_BULGE', segmentIndex: 0, sweepDegrees: -90,
  }))
  close(proposal.preview.after[0].payload.vertices[0].bulge, -Math.tan(Math.PI / 8))
  value(await session.approve(proposal.planId, 'host-reviewer'))
  proposal = value(await session.call('cad_propose_polyline_edit', {
    expectedRevision: document.revision, units: 'millimeter', id: 'path', operation: 'SET_WIDTH', segmentIndex: 0, startWidth: 2, endWidth: 6,
  }))
  assert.deepEqual(proposal.preview.after[0].payload.vertices.slice(0, 2).map(vertex => [vertex.startWidth, vertex.endWidth]), [[2, 6], [0, 0]])
  value(await session.approve(proposal.planId, 'host-reviewer'))

  const before = document.serialize(), revision = document.revision
  const invalid = [
    { id: 'curve', operation: 'DELETE', vertexIndex: 1 },
    { id: 'curve', operation: 'INSERT', segmentIndex: 0 },
    { id: 'curve', operation: 'INSERT', segmentIndex: 0, point: { x: 5, y: -5 }, vertexIndex: 1 },
    { id: 'curve', operation: 'SET_BULGE', segmentIndex: 0 },
    { id: 'curve', operation: 'SET_BULGE', segmentIndex: 0, bulge: 1, sweepDegrees: 180 },
    { id: 'curve', operation: 'SET_BULGE', segmentIndex: 1, bulge: 1 },
    { id: 'path', operation: 'SET_BULGE', segmentIndex: 0, bulge: 33 },
    { id: 'path', operation: 'SET_BULGE', segmentIndex: 0, sweepDegrees: 351 },
    { id: 'path', operation: 'SET_WIDTH', segmentIndex: 0, startWidth: -1, endWidth: 2 },
    { id: 'path', operation: 'SET_WIDTH', segmentIndex: 0, startWidth: 1 },
    { id: 'curve', operation: 'SET_BULGE', segmentIndex: 0, bulge: 1 },
    { id: 'path', operation: 'INSERT', segmentIndex: 0, point: { x: 2.5, y: 1 }, tolerance: 1 },
    { id: 'hidden-path', operation: 'SET_BULGE', segmentIndex: 0, bulge: 1 },
    { id: 'locked-path', operation: 'SET_BULGE', segmentIndex: 0, bulge: 1 },
    { id: 'frozen-path', operation: 'SET_BULGE', segmentIndex: 0, bulge: 1 },
    { id: 'paper-path', operation: 'SET_BULGE', segmentIndex: 0, bulge: 1 },
    { id: 'circle', operation: 'DELETE', vertexIndex: 0 },
  ]
  for (const item of invalid) {
    const result = await session.call('cad_propose_polyline_edit', { expectedRevision: revision, units: 'millimeter', ...item })
    assert.equal(result.ok, false, JSON.stringify(item)); assert.equal(document.serialize(), before)
  }
})

test('AI PEDIT rejects unbounded curves, excessive snapping and approval-time command replacement atomically', async () => {
  const ordinary = await fixture()
  await assert.rejects(createAgentGeometryPreview(ordinary.document, 'PEDIT', { id: 'path', operation: 'SET_BULGE', segmentIndex: 0, bulge: 1e12 }), /bulge.*±32/i)
  await assert.rejects(createAgentGeometryPreview(ordinary.document, 'PEDIT', { id: 'path', operation: 'INSERT', segmentIndex: 0, point: [2.5, 1e12, 0], tolerance: 1e12 }), /tolerance/i)
  assert.equal(ordinary.document.revision, 1)

  let enterVerify, releaseVerify
  const verifying = new Promise(resolve => { enterVerify = resolve })
  const gate = new Promise(resolve => { releaseVerify = resolve })
  const bindingProvider = {
    algorithm: 'HOST-SIGNATURE/pedit-race-test',
    async create(content) { return `signed:${content.length}` },
    async verify(content, binding) {
      enterVerify()
      await gate
      return binding === `signed:${content.length}`
    },
  }
  const { sdk, document, session } = await fixture({ agentPlanOptions: { bindingProvider } })
  const proposal = value(await session.call('cad_propose_polyline_edit', {
    expectedRevision: document.revision, units: 'millimeter', id: 'path', operation: 'DELETE', vertexIndex: 1,
  }))
  const before = document.serialize(); let invoked = false
  const approval = session.approve(proposal.planId, 'host-reviewer')
  await verifying
  sdk.commands.register({ id: 'PEDIT', execute: ({ transaction }) => {
    invoked = true
    transaction.updateObject('path', { payload: { vertices: [[0, 0], [999, 999]] } })
  } }, { owner: 'host-plugin', replace: true })
  releaseVerify()
  const result = await approval
  assert.equal(result.ok, false)
  assert.match(result.error.message, /Command changed before execution/)
  assert.equal(invoked, false)
  assert.equal(document.serialize(), before)
  assert.equal(document.revision, 1)
})

test('AI PEDIT rejects protected and stale geometry, and approval refuses a substituted core command', async () => {
  const { sdk, document, session } = await fixture()
  await sdk.executeCommand('LAYERNEW', { name: 'Locked path' })
  const layer = document.listObjects({ kind: 'table-record', type: 'LAYER' }).find(item => item.name === 'Locked path')
  await document.transact('Protect path', transaction => transaction.updateObject('path', { payload: { layerId: layer.id } }))
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } })
  const args = { expectedRevision: document.revision, units: 'millimeter', id: 'path', operation: 'DELETE', vertexIndex: 1 }
  const before = document.serialize()
  assert.equal((await session.call('cad_propose_polyline_edit', args)).ok, false)
  assert.equal((await session.call('cad_propose_polyline_edit', { ...args, expectedRevision: args.expectedRevision - 1 })).ok, false)
  assert.equal(document.serialize(), before)

  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false } })
  const proposal = value(await session.call('cad_propose_polyline_edit', { ...args, expectedRevision: document.revision }))
  const core = sdk.commands.resolve('PEDIT'); let invoked = false
  sdk.commands.register({ id: 'PEDIT', execute: () => { invoked = true } }, { owner: 'host-plugin', replace: true })
  assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
  assert.equal(invoked, false); assert.equal(document.getObject('path').payload.vertices.length, 3)
  sdk.commands.register(core, { owner: '@kanjieteam/kjdraw', replace: true })
})

test('AI PEDIT definition stays compact, optional by operation and available to model tool selection', () => {
  const definition = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_polyline_edit')
  assert.equal(definition.effect, 'propose')
  assert.deepEqual(definition.inputSchema.required, ['expectedRevision', 'units', 'id', 'operation'])
  assert.deepEqual(definition.inputSchema.properties.operation.enum, ['INSERT', 'DELETE', 'SET_BULGE', 'SET_WIDTH'])
  assert.match(definition.description, /host approval/i)
  assert.ok(Buffer.byteLength(JSON.stringify(definition), 'utf8') < 3000)
})
