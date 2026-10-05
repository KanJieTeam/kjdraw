import assert from 'node:assert/strict'
import test from 'node:test'

import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const input = (document, change = {}) => {
  const result = {
    expectedRevision: document.revision, units: 'millimeter', eraseIds: ['bridge'],
    reconnections: [{ type: 'LINE', points: [{ x: 10, y: 0 }, { x: 20, y: 0 }], layerId: 'connection-layer' }],
    relayer: { ids: ['retained'], layerId: 'review-layer' }, tolerance: .001, maxBytes: 262144, ...change,
  }
  for (const [key, value] of Object.entries(result)) if (value === undefined) delete result[key]
  return result
}

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: `structural-${Math.random()}`, units: 'millimeter' })
  await document.transact('Structural edit fixture', tx => {
    tx.upsertTableRecord('layers', { id: 'source-layer', name: 'SOURCE', payload: { visible: true, frozen: false, locked: false } })
    tx.upsertTableRecord('layers', { id: 'connection-layer', name: 'CONNECTION', payload: { visible: true, frozen: false, locked: false } })
    tx.upsertTableRecord('layers', { id: 'review-layer', name: 'REVIEWED', payload: { visible: true, frozen: false, locked: false } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0], layerId: 'source-layer' }, { id: 'left' })
    tx.createEntity('LINE', { start: [10, 0, 0], end: [20, 0, 0], layerId: 'source-layer' }, { id: 'bridge' })
    tx.createEntity('LINE', { start: [20, 0, 0], end: [30, 0, 0], layerId: 'source-layer' }, { id: 'right' })
    tx.createEntity('CIRCLE', { center: [15, 8, 0], radius: 2, layerId: 'source-layer' }, { id: 'retained' })
    tx.createObject({ id: 'structural-group', kind: 'group', type: 'GROUP', ownerId: document.snapshot().namedObjectsDictionaryId, name: 'Structural group', payload: { memberIds: ['bridge', 'retained'] } })
  })
  await sdk.getSelectionManager(document.id).saveNamed('Structural working set', { ids: ['bridge', 'retained'] })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}

test('structural proposal previews and atomically commits erase, reconnect and relayer as one history step', async () => {
  const { sdk, document, session } = await fixture(), before = document.serialize(), revision = document.revision
  const proposal = value(await session.call('cad_propose_structural_edit', input(document)))
  assert.equal(document.serialize(), before); assert.equal(document.revision, revision)
  assert.equal(proposal.command, 'STRUCTURALEDIT'); assert.equal(proposal.structuralEdit.semanticInference, 'none')
  assert.deepEqual(proposal.structuralEdit.requestedEraseIds, ['bridge'])
  assert.equal(proposal.structuralEdit.reconnectionIds.length, 1)
  assert.deepEqual(proposal.structuralEdit.groups[0].affectedMemberIds, ['bridge'])
  assert.deepEqual(proposal.structuralEdit.selectionSets[0].affectedMemberIds, ['bridge'])
  assert.ok(proposal.preview.recordChanges.some(change => change.id === 'structural-group'))
  assert.ok(proposal.preview.recordChanges.some(change => change.id === sdk.getSelectionManager(document.id).listNamed()[0].id))
  const createdId = proposal.structuralEdit.reconnectionIds[0]
  assert.equal(proposal.arguments.reconnections[0].id, createdId)
  assert.deepEqual(new Set(proposal.preview.before.map(entity => entity.id)), new Set(['bridge', 'retained']))
  assert.deepEqual(new Set(proposal.preview.after.map(entity => entity.id)), new Set([createdId, 'retained']))
  assert.equal(proposal.preview.after.find(entity => entity.id === 'retained').payload.layerId, 'review-layer')
  assert.deepEqual(proposal.preview.after.find(entity => entity.id === createdId).payload.start, [10, 0, 0])

  const receipt = value(await session.approve(proposal.planId, 'host-reviewer'))
  assert.equal(receipt.afterRevision, revision + 1)
  assert.equal(document.getObject('bridge'), null)
  assert.equal(document.getObject('retained').payload.layerId, 'review-layer')
  assert.deepEqual(document.getObject(createdId).payload.end, [20, 0, 0])
  assert.deepEqual(document.getObject('structural-group').payload.memberIds, ['retained'])
  assert.deepEqual(sdk.getSelectionManager(document.id).listNamed()[0].memberIds, ['retained'])
  await document.undo()
  assert.ok(document.getObject('bridge')); assert.equal(document.getObject(createdId), null); assert.equal(document.getObject('retained').payload.layerId, 'source-layer')
  await document.redo()
  assert.equal(document.getObject('bridge'), null); assert.ok(document.getObject(createdId)); assert.equal(document.getObject('retained').payload.layerId, 'review-layer')

  const reopenedSdk = createKJDrawSDK(), reopened = await reopenedSdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.equal(reopened.getObject('bridge'), null); assert.ok(reopened.getObject(createdId)); assert.equal(reopened.getObject('retained').payload.layerId, 'review-layer')
  assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
})

test('structural proposal refuses unresolved references and never leaves a partial edit', async () => {
  const { document, session } = await fixture()
  await document.transact('Associative dimension', tx => tx.createEntity('DIMENSION', {
    dimensionType: 'ALIGNED', definitionPoints: [[15, 4, 0], [10, 0, 0], [20, 0, 0]], layerId: 'source-layer',
    dimensionAssociations: [{ definitionPointIndex: 1, entityId: 'bridge', feature: 'start' }, { definitionPointIndex: 2, entityId: 'bridge', feature: 'end' }],
  }, { id: 'bridge-dimension' }))
  const before = document.serialize()
  const blocked = await session.call('cad_propose_structural_edit', input(document))
  assert.equal(blocked.ok, false); assert.match(blocked.error.message, /must include dimension bridge-dimension/)
  assert.equal(document.serialize(), before)
  const proposal = value(await session.call('cad_propose_structural_edit', input(document, { eraseIds: ['bridge', 'bridge-dimension'] })))
  assert.equal(document.serialize(), before)
  value(session.reject(proposal.planId, 'host-reviewer'))
  assert.equal(document.serialize(), before)
})

test('structural proposal exposes native HATCH and INSERT only as unclassified confirmation candidates', async () => {
  const { document, session } = await fixture()
  await document.transact('Native patterns', tx => {
    tx.createEntity('HATCH', { solid: true, associative: false, patternName: 'SOLID', boundaryLoops: [{ external: true, vertices: [[40, 0], [45, 0], [45, 5], [40, 5]] }] }, { id: 'native-hatch' })
    const definition = tx.upsertTableRecord('blockRecords', { id: 'native-symbol-definition', name: 'NATIVE SYMBOL', payload: { basePoint: [0, 0, 0], entityIds: [] } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0] }, { id: 'native-symbol-member', ownerId: definition.id })
    tx.createEntity('INSERT', { blockRecordId: definition.id, position: [50, 0, 0], scale: [1, 1, 1], rotation: 0, attributeIds: [], sequenceEndId: null }, { id: 'native-insert' })
  })
  const proposal = value(await session.call('cad_propose_structural_edit', input(document, { eraseIds: ['native-hatch', 'native-insert'], reconnections: [], relayer: undefined })))
  assert.equal(proposal.structuralEdit.semanticInference, 'none')
  assert.deepEqual(proposal.structuralEdit.nativeCandidates.map(candidate => [candidate.id, candidate.patternCandidate.inferredRole, candidate.patternCandidate.boundaryRole, candidate.expandedGeometry, candidate.confirmationRequired]), [
    ['native-hatch', null, 'unassigned', false, true], ['native-insert', null, 'unassigned', false, true],
  ])
  assert.deepEqual(proposal.preview.after, [])
  value(session.reject(proposal.planId, 'host-reviewer'))
})

test('structural proposal validates bounded exact plans before a proposal exists', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  for (const change of [
    { expectedRevision: document.revision - 1 },
    { relayer: { ids: ['bridge'], layerId: 'review-layer' } },
    { reconnections: [{ type: 'LINE', points: [{ x: 1, y: 1 }, { x: 1, y: 1 }], layerId: 'connection-layer' }] },
    { reconnections: [{ type: 'ARC', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], layerId: 'connection-layer' }] },
    { reconnections: [{ type: 'LINE', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], layerId: 'missing' }] },
    { eraseIds: ['bridge', 'bridge'] }, { tolerance: 0 }, { maxBytes: 1024 },
  ]) assert.equal((await session.call('cad_propose_structural_edit', input(document, change))).ok, false)
  assert.equal(document.serialize(), before)
})

test('structural proposal rejects block-definition and paper-space erases before exposing a partial preview', async () => {
  const { document, session } = await fixture()
  let paperSpaceId
  await document.transact('Non-model structural targets', tx => {
    const definition = tx.upsertTableRecord('blockRecords', { id: 'shared-definition', name: 'SHARED', payload: { basePoint: [0, 0, 0], entityIds: [] } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [2, 0, 0], layerId: 'source-layer' }, { id: 'definition-line', ownerId: definition.id })
    tx.createEntity('INSERT', { blockRecordId: definition.id, position: [50, 0, 0], scale: [1, 1, 1], rotation: 0, attributeIds: [], sequenceEndId: null, layerId: 'source-layer' }, { id: 'shared-instance' })
    paperSpaceId = tx.createLayout({ id: 'paper-layout', blockRecordId: 'paper-space', name: 'Paper' }).payload.blockRecordId
    tx.createEntity('LINE', { start: [0, 0, 0], end: [5, 0, 0], layerId: 'source-layer' }, { id: 'paper-line', ownerId: paperSpaceId })
  })
  const before = document.serialize()
  for (const eraseIds of [['definition-line'], ['paper-line']]) {
    const result = await session.call('cad_propose_structural_edit', input(document, { eraseIds, reconnections: [], relayer: undefined }))
    assert.equal(result.ok, false)
    assert.match(result.error.message, /limited to model-space/)
  }
  assert.equal(document.serialize(), before)
})
