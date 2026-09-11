import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'
import { createAgentGeometryPreview, agentPreviewMatchesDocument, KJDRAW_AGENT_MOVABLE_TYPES } from '../src/agent-preview.js'
import { projectDimension } from '../src/geometry/annotation.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const move = (document, ids, changes = {}) => ({ expectedRevision: document.revision, units: 'millimeter', ids, dx: 15, dy: -8, ...changes })
const pointFields = payload => ['position', 'alignmentPoint', 'textPosition'].filter(key => Array.isArray(payload[key]))
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Dimensioned mechanical detail', tx => {
    const layer = tx.upsertTableRecord('layers', { name: 'DETAIL', payload: { color: 3 } })
    const style = tx.upsertTableRecord('dimensionStyles', { name: 'DETAIL-DIM', payload: { textHeight: 3, decimalPlaces: 3 } })
    tx.createEntity('TEXT', { position: [10, 20, 0], alignmentPoint: [30, 20, 0], text: 'P-12 / 6061-T6 / 去毛刺', height: 3, rotation: .25, layerId: layer.id }, { id: 'note' })
    for (const [id, dimensionType, definitionPoints, rotation] of [
      ['aligned', 'ALIGNED', [[0, 20, 0], [0, 0, 0], [30, 40, 0]], 0],
      ['rotated', 'ROTATED', [[0, -10, 0], [0, 0, 0], [100, 0, 0]], 0],
      ['radius', 'RADIUS', [[50, 50, 0], [53, 54, 0]], 0],
      ['diameter', 'DIAMETER', [[45, 50, 0], [55, 50, 0]], 0],
    ]) tx.createEntity('DIMENSION', { dimensionType, definitionPoints, textPosition: [70, 65, 0], rotation, styleId: style.id, layerId: layer.id }, { id })
    tx.createEntity('CIRCLE', { center: [50, 50, 0], radius: 5, layerId: layer.id }, { id: 'hole' })
    tx.createEntity('LINE', { start: [400, 300, 0], end: [450, 300, 0] }, { id: 'unrelated' })
  })
  return { sdk, document, session: new KJAgentToolSession(sdk, document), ids: ['note', 'aligned', 'rotated', 'radius', 'diameter', 'hole'] }
}

test('reviewed mixed detail moves include complete annotation geometry and preserve measurement, identity, history and files', async () => {
  const { sdk, document, session, ids } = await fixture()
  const original = new Map(document.listObjects().map(object => [object.id, object]))
  const source = document.serialize(), history = document.history
  const other = sdk.createDocument({ units: 'meter' }), otherSource = other.serialize()
  const query = value(await session.call('cad_query_drawing', { expectedRevision: document.revision, filters: { ids }, offset: 0, layerOffset: 0, limit: 64, maxLayers: 0, maxBytes: 65536 }))
  assert.equal(query.entities.length, ids.length)
  assert.ok(query.entities.every(entity => entity.geometry && entity.editable))
  const proposal = value(await session.call('cad_propose_move', move(document, ids)))
  assert.equal(document.serialize(), source)
  assert.deepEqual(document.history, history)
  assert.equal(proposal.preview.before.length, ids.length)
  assert.equal(proposal.preview.after.length, ids.length)
  assert.deepEqual(proposal.preview.before.map(entity => entity.payload), proposal.preview.before.map(entity => original.get(entity.id).payload))
  for (const after of proposal.preview.after) {
    const before = original.get(after.id).payload
    for (const field of pointFields(before)) assert.deepEqual(after.payload[field], [before[field][0] + 15, before[field][1] - 8, before[field][2]])
    if (after.type === 'DIMENSION') {
      assert.deepEqual(after.payload.definitionPoints, before.definitionPoints.map(point => [point[0] + 15, point[1] - 8, point[2]]))
      near(projectDimension(after.payload).measurement, projectDimension(before).measurement)
      assert.equal(after.payload.styleId, before.styleId)
    }
    if (after.type === 'TEXT') { assert.equal(after.payload.text, before.text); assert.equal(after.payload.height, before.height); near(after.payload.rotation, before.rotation) }
    assert.throws(() => { after.payload.position = [0, 0, 0] }, TypeError)
  }
  const receipt = value(await session.approve(proposal.planId, 'reviewer'))
  assert.equal(receipt.afterRevision, receipt.beforeRevision + 1)
  assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
  assert.equal(other.serialize(), otherSource)
  for (const entity of document.listObjects()) {
    const before = original.get(entity.id)
    if (!ids.includes(entity.id)) assert.deepEqual(entity, before)
    else { assert.equal(entity.handle, before.handle); assert.equal(entity.ownerId, before.ownerId); assert.deepEqual(entity.extension, before.extension) }
  }
  const accepted = new Map(document.listObjects().map(object => [object.id, object]))
  for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await createKJDrawSDK().readDocument(bytes, { format })
    const notes = reopened.listEntities({ type: 'TEXT', ownerId: reopened.snapshot().spaces.modelSpaceId })
    assert.equal(notes.length, 1)
    assert.equal(notes[0].payload.text, original.get('note').payload.text)
    assert.deepEqual(notes[0].payload.position, [25, 12, 0])
    for (const dimension of reopened.listEntities({ type: 'DIMENSION', ownerId: reopened.snapshot().spaces.modelSpaceId })) {
      const matching = [...accepted.values()].find(entity => entity.type === 'DIMENSION' && entity.payload.dimensionType === dimension.payload.dimensionType)
      assert.ok(matching)
      assert.deepEqual(dimension.payload.definitionPoints, matching.payload.definitionPoints)
      near(projectDimension(dimension.payload).measurement, projectDimension(matching.payload).measurement)
    }
    assert.equal(reopened.listEntities({ type: 'DIMENSION', ownerId: reopened.snapshot().spaces.modelSpaceId }).length, 4)
  }
  await document.undo()
  for (const [id, entity] of original) assert.deepEqual(document.getObject(id), entity)
  await document.redo()
  for (const [id, entity] of accepted) assert.deepEqual(document.getObject(id), entity)
  assert.equal((await session.approve(proposal.planId, 'reviewer')).ok, false)
})

test('annotation moves reject hidden, frozen, locked and paper selections atomically', async () => {
  const { document, session } = await fixture()
  await document.transact('Protected annotations', tx => {
    const locked = tx.upsertTableRecord('layers', { name: 'LOCKED', payload: { locked: true } })
    const frozen = tx.upsertTableRecord('layers', { name: 'FROZEN', payload: { frozen: true } })
    for (const type of ['TEXT', 'DIMENSION']) for (const state of ['locked', 'frozen', 'hidden', 'paper']) {
      const source = document.getObject(type === 'TEXT' ? 'note' : 'aligned')
      tx.createEntity(type, { ...source.payload, ...(state === 'locked' ? { layerId: locked.id } : state === 'frozen' ? { layerId: frozen.id } : state === 'hidden' ? { visible: false } : {}) }, { id: `${type}-${state}`, ...(state === 'paper' ? { ownerId: document.snapshot().spaces.paperSpaceIds[0] } : {}) })
    }
  })
  const source = document.serialize()
  for (const type of ['TEXT', 'DIMENSION']) for (const state of ['locked', 'frozen', 'hidden', 'paper']) {
    assert.equal((await session.call('cad_propose_move', move(document, ['note', `${type}-${state}`]))).ok, false)
    assert.equal(document.serialize(), source)
  }
})

test('unsupported annotation planes and unrenderable dimensions never produce a partial move preview', async () => {
  const { document, session } = await fixture()
  await document.transact('Unsupported annotation cases', tx => {
    tx.createEntity('TEXT', { ...document.getObject('note').payload, normal: [0, 1, 0] }, { id: 'tilted-text' })
    tx.createEntity('TEXT', { ...document.getObject('note').payload, position: [1, 2, 3] }, { id: 'raised-text' })
    tx.createEntity('DIMENSION', { ...document.getObject('aligned').payload, normal: [0, 0, -1] }, { id: 'flipped-dimension' })
    tx.createEntity('DIMENSION', { ...document.getObject('aligned').payload, dimensionType: 'ORDINATE' }, { id: 'unsupported-dimension' })
    tx.createEntity('DIMENSION', { ...document.getObject('aligned').payload, definitionPoints: [[0, 10, 0], [0, 0, 0], [0, 0, 0]] }, { id: 'degenerate-dimension' })
    const block = tx.upsertTableRecord('blockRecords', { name: 'External block', payload: { entityIds: [], dxfFlags: 4 } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [5, 0, 0] }, { ownerId: block.id })
    tx.createEntity('INSERT', { blockRecordId: block.id, position: [1, 2, 0] }, { id: 'insert' })
  })
  const source = document.serialize()
  for (const id of ['tilted-text', 'raised-text', 'flipped-dimension', 'unsupported-dimension', 'degenerate-dimension', 'insert']) {
    assert.equal((await session.call('cad_propose_move', move(document, ['note', id]))).ok, false, id)
    await assert.rejects(createAgentGeometryPreview(document, 'MOVE', { ids: ['note', id], dx: 1, dy: 2 }))
    assert.equal(document.serialize(), source)
  }
})

test('annotation proposal rejection, stale geometry and unchanged budgets preserve drawing truth', async () => {
  const { document, session } = await fixture()
  const source = document.serialize()
  const rejected = value(await session.call('cad_propose_move', move(document, ['note', 'aligned'])))
  value(session.reject(rejected.planId, 'reviewer'))
  assert.equal((await session.approve(rejected.planId, 'reviewer')).ok, false)
  assert.equal(document.serialize(), source)
  const stale = value(await session.call('cad_propose_move', move(document, ['note', 'aligned'])))
  await document.transact('User changed note', tx => tx.updateObject('note', { payload: { text: 'User revision' } }))
  const changed = document.serialize()
  assert.equal((await session.approve(stale.planId, 'reviewer')).ok, false)
  assert.equal(document.serialize(), changed)
  assert.equal((await session.call('cad_propose_move', move(document, Array(65).fill('note')))).ok, false)
  assert.equal((await session.call('cad_propose_move', move(document, ['note', 'note']))).ok, false)
  assert.equal(document.serialize(), changed)
  const definition = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_move')
  assert.equal(definition.inputSchema.properties.ids.maxItems, 64)
  for (const type of KJDRAW_AGENT_MOVABLE_TYPES) assert.ok(definition.description.includes(type))
  assert.match(definition.description, /complete block geometry and styles are included in blockDependencies/)
})
