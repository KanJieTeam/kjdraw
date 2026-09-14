import assert from 'node:assert/strict'
import test from 'node:test'

import { KJAgentToolSession } from '../src/agent-tools.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { readDesignRelations } from '../src/design-relations.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const json = input => JSON.parse(JSON.stringify(input))
const args = (document, change = {}) => {
  const result = { expectedRevision: document.revision, units: 'millimeter', selectionSetName: 'Geology detail', layerId: 'geology-layer', maxBytes: 262144, ...change }
  for (const [key, value] of Object.entries(result)) if (value === undefined) delete result[key]
  return result
}
const withoutLayer = payload => { const result = json(payload); delete result.layerId; return result }

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: `agent-relayer-${Math.random()}`, units: 'millimeter' })
  await document.transact('Native section detail', tx => {
    const old = tx.upsertTableRecord('layers', { id: 'source-layer', name: 'SOURCE', payload: { color: 7, visible: true, frozen: false, locked: false } })
    const geology = tx.upsertTableRecord('layers', { id: 'geology-layer', name: 'GEOLOGY', payload: { color: 3, visible: true, frozen: false, locked: false } })
    const line = tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0], layerId: old.id }, { id: 'boundary' })
    tx.createEntity('HATCH', { solid: false, associative: true, patternName: 'CUSTOM_STRATUM', patternScale: 2, patternAngle: .25, layerId: old.id,
      patternLines: [{ angle: .125, base: [.25, .5], offset: [1.5, 2.5], dashes: [3, -1, 0] }],
      boundaryLoops: [{ external: true, sourceHandles: [line.handle], vertices: [[0, 0], [10, 0], [10, 5], [0, 5]] }],
      rawTags: [{ code: 78, value: '1' }, { code: 53, value: '7.161972' }], custom: { geologicalPattern: 'sandstone', revision: 3 } }, { id: 'stratum-hatch' })
    const block = tx.upsertTableRecord('blockRecords', { id: 'symbol-block', name: 'GEOLOGICAL SYMBOL', payload: { basePoint: [0, 0, 0], entityIds: [] } })
    tx.createEntity('LINE', { start: [-1, 0, 0], end: [1, 0, 0], layerId: old.id }, { id: 'symbol-child', ownerId: block.id })
    const insert = tx.createEntity('INSERT', { blockRecordId: block.id, position: [4, 2, 0], scale: [1, 1, 1], rotation: 0, attributes: {}, attributeIds: [], sequenceEndId: null, layerId: old.id }, { id: 'symbol' })
    tx.createEntity('ATTRIB', { parentInsertId: insert.id, tag: 'CODE', text: 'G-03', position: [4, 2, 0], height: 1, layerId: old.id }, { id: 'symbol-attribute', ownerId: insert.ownerId })
    tx.createObject({ id: 'symbol-sequence', kind: 'custom', type: 'SEQEND', ownerId: insert.id, payload: { dxfOwnerMode: 'insert', layerId: old.id } })
    tx.updateObject(insert.id, { payload: { attributeIds: ['symbol-attribute'], sequenceEndId: 'symbol-sequence' } })
    tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[5, -3, 0], [0, 0, 0], [10, 0, 0]], dimensionAssociations: [
      { definitionPointIndex: 1, entityId: 'boundary', feature: 'start' }, { definitionPointIndex: 2, entityId: 'boundary', feature: 'end' },
    ], measurement: 10, textHeight: 1, layerId: old.id }, { id: 'width-dimension' })
    tx.createEntity('MTEXT', { position: [14, 4, 0], text: 'STRATUM A', height: 2, width: 12, rotation: 0, attachmentPoint: 7, layerId: old.id }, { id: 'leader-note' })
    tx.createEntity('LEADER', { vertices: [[10, 2, 0], [12, 4, 0]], textPosition: [14, 4, 0], horizontalDirection: [1, 0, 0], annotationId: 'leader-note', ownsAnnotation: true, annotationType: 0, layerId: old.id }, { id: 'leader' })
    tx.createEntity('CIRCLE', { center: [30, 0, 0], radius: 2, layerId: geology.id }, { id: 'already-geology' })
  })
  await sdk.executeCommand('DESIGNCREATE', { name: 'Section boundary', definition: {
    parameters: [{ name: 'width', value: 10, min: 1, max: 100 }], derived: [],
    bindings: [{ entityId: 'boundary', path: 'end.0', expression: { constant: 0, terms: [{ parameter: 'width', coefficient: 1 }] } }], requirements: [],
  } }, { document })
  await sdk.getSelectionManager(document.id).saveNamed('Geology detail', { ids: ['boundary', 'stratum-hatch', 'symbol', 'width-dimension', 'leader', 'already-geology'] })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}

test('relayer preserves complex native relationships through exact preview, approval, undo, redo and KJD reopen', async () => {
  const { sdk, document, session } = await fixture(), source = document.serialize(), revision = document.revision
  const originals = new Map(document.listObjects().map(item => [item.id, json(item)]))
  const proposal = value(await session.call('cad_propose_relayer', args(document)))
  assert.equal(document.serialize(), source)
  assert.equal(proposal.command, 'PROPERTIES')
  assert.deepEqual(proposal.unchangedIds, ['already-geology'])
  assert.deepEqual(proposal.layerChange.unchangedIds, ['already-geology'])
  assert.equal(proposal.layerChange.targetLayer.id, 'geology-layer')
  assert.deepEqual(new Set(proposal.arguments.ids), new Set(['boundary', 'stratum-hatch', 'symbol', 'width-dimension', 'leader', 'leader-note']))
  assert.deepEqual(new Set(proposal.preview.before.map(item => item.id)), new Set(proposal.arguments.ids))
  assert.deepEqual(new Set(proposal.preview.after.map(item => item.id)), new Set(proposal.arguments.ids))
  for (const before of proposal.preview.before) {
    const after = proposal.preview.after.find(item => item.id === before.id)
    assert.equal(after.payload.layerId, 'geology-layer')
    assert.deepEqual(withoutLayer(after.payload), withoutLayer(before.payload), before.id)
  }
  assert.deepEqual(proposal.preview.after.find(item => item.id === 'stratum-hatch').payload.boundaryLoops, originals.get('stratum-hatch').payload.boundaryLoops)
  assert.equal(proposal.preview.after.find(item => item.id === 'symbol').payload.blockRecordId, 'symbol-block')
  assert.deepEqual(proposal.preview.after.find(item => item.id === 'width-dimension').payload.dimensionAssociations, originals.get('width-dimension').payload.dimensionAssociations)
  assert.deepEqual(json(document.getObject('symbol-child')), originals.get('symbol-child'))
  assert.deepEqual(json(document.getObject('symbol-attribute')), originals.get('symbol-attribute'))
  assert.deepEqual(json(document.getObject('symbol-sequence')), originals.get('symbol-sequence'))
  assert.deepEqual(document.getObject(proposal.selectionSet.id).payload.memberIds, proposal.selectionSet.memberIds)
  assert.deepEqual(readDesignRelations(document)[0].driftedEntityIds, [])

  const receipt = value(await session.approve(proposal.planId, 'host-reviewer'))
  assert.equal(receipt.afterRevision, revision + 1)
  for (const id of proposal.arguments.ids) assert.equal(document.getObject(id).payload.layerId, 'geology-layer')
  assert.equal(document.getObject('already-geology').payload.layerId, 'geology-layer')
  assert.deepEqual(json(document.getObject('symbol-child')), originals.get('symbol-child'))
  assert.deepEqual(json(document.getObject('symbol-attribute')), originals.get('symbol-attribute'))
  assert.deepEqual(json(document.getObject('symbol-sequence')), originals.get('symbol-sequence'))
  assert.deepEqual(readDesignRelations(document)[0].driftedEntityIds, [])
  await document.undo()
  for (const id of proposal.arguments.ids) assert.equal(document.getObject(id).payload.layerId, 'source-layer')
  await document.redo()
  for (const id of proposal.arguments.ids) assert.equal(document.getObject(id).payload.layerId, 'geology-layer')

  const reopenedSdk = createKJDrawSDK(), reopened = await reopenedSdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(reopened.getObject('stratum-hatch').payload.boundaryLoops, originals.get('stratum-hatch').payload.boundaryLoops)
  assert.equal(reopened.getObject('symbol').payload.blockRecordId, 'symbol-block')
  assert.deepEqual(reopened.getObject('symbol-attribute').payload, originals.get('symbol-attribute').payload)
  assert.deepEqual(reopened.getObject('symbol-sequence').payload, originals.get('symbol-sequence').payload)
  assert.deepEqual(reopened.getObject('width-dimension').payload.dimensionAssociations, originals.get('width-dimension').payload.dimensionAssociations)
  assert.deepEqual(reopened.getObject(proposal.selectionSet.id).payload.memberIds, proposal.selectionSet.memberIds)
  assert.deepEqual(readDesignRelations(reopened)[0].driftedEntityIds, [])
  await reopenedSdk.executeCommand('DESIGNUPDATE', { id: readDesignRelations(reopened)[0].id, parameters: { width: 20 } }, { document: reopened })
  assert.equal(reopened.getObject('boundary').payload.end[0], 20)
  assert.equal(reopened.getObject('boundary').payload.layerId, 'geology-layer')
  assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
})

test('relayer resolves exact ids, filters no-op members and rejects malformed targets or protected sources without a plan', async () => {
  const { sdk, document, session } = await fixture()
  const direct = value(await session.call('cad_propose_relayer', args(document, { selectionSetName: undefined, ids: ['boundary', 'already-geology'] })))
  assert.deepEqual(direct.arguments.ids, ['boundary'])
  assert.deepEqual(direct.unchangedIds, ['already-geology'])
  value(session.reject(direct.planId, 'reviewer'))
  await document.transact('Legacy implicit Layer 0 entity', tx => {
    tx.createEntity('LINE', { start: [40, 0, 0], end: [45, 0, 0] }, { id: 'implicit-zero' })
    tx.updateObject('implicit-zero', { payload: { layerId: null } })
  })
  await sdk.executeCommand('LAYERCURRENT', { id: 'source-layer' }, { document })
  const implicit = value(await session.call('cad_propose_relayer', args(document, { selectionSetName: undefined, ids: ['implicit-zero'] })))
  assert.deepEqual(implicit.arguments.ids, ['implicit-zero'])
  assert.equal(implicit.layerChange.sourceLayers[0].name, 'SOURCE')
  value(session.reject(implicit.planId, 'reviewer'))
  await sdk.executeCommand('LAYERCURRENT', { id: 'geology-layer' }, { document })
  assert.equal((await session.call('cad_propose_relayer', args(document, { selectionSetName: undefined, ids: ['implicit-zero'] }))).ok, false)
  const source = document.serialize()
  for (const change of [
    { layerId: 'GEOLOGY' }, { layerId: 'missing' }, { layerId: 'symbol-block' }, { ids: ['boundary'] }, { selectionSetName: undefined },
    { ids: ['boundary', 'boundary'], selectionSetName: undefined }, { selectionSetName: 'missing' },
    { ids: Array.from({ length: 65 }, (_, index) => `entity-${index}`), selectionSetName: undefined },
  ]) {
    const input = args(document, change)
    assert.equal((await session.call('cad_propose_relayer', input)).ok, false)
    assert.equal(document.serialize(), source)
  }
  assert.equal((await session.call('cad_propose_relayer', args(document, { ids: ['already-geology'], selectionSetName: undefined }))).ok, false)
  assert.equal(document.serialize(), source)

  for (const [id, payload] of [['locked-target', { locked: true }], ['hidden-target', { visible: false }], ['frozen-target', { frozen: true }]]) {
    await document.transact('Protected target', tx => tx.upsertTableRecord('layers', { id, name: id, payload }))
    const before = document.serialize()
    assert.equal((await session.call('cad_propose_relayer', args(document, { layerId: id }))).ok, false)
    assert.equal(document.serialize(), before)
  }
  for (const [field, value] of [['visible', false], ['locked', true], ['frozen', true]]) {
    await document.transact('Protect source layer', tx => tx.updateObject('source-layer', { payload: { [field]: value } }))
    const protectedSource = document.serialize()
    assert.equal((await session.call('cad_propose_relayer', args(document, { ids: ['boundary'], selectionSetName: undefined }))).ok, false, `source layer ${field}`)
    assert.equal(document.serialize(), protectedSource)
    await document.transact('Restore source layer', tx => tx.updateObject('source-layer', { payload: { [field]: field === 'visible' } }))
  }
  for (const [field, value] of [['visible', false], ['locked', true], ['frozen', true]]) {
    await document.transact('Protect source entity', tx => tx.updateObject('boundary', { payload: { [field]: value } }))
    const protectedSource = document.serialize()
    assert.equal((await session.call('cad_propose_relayer', args(document, { ids: ['boundary'], selectionSetName: undefined }))).ok, false, `source entity ${field}`)
    assert.equal(document.serialize(), protectedSource)
    await document.transact('Restore source entity', tx => tx.updateObject('boundary', { payload: { [field]: field === 'visible' } }))
  }
})

test('relayer refuses broken and ambiguous owned leader associations before creating a plan', async () => {
  for (const kind of ['broken', 'ambiguous']) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
    await document.transact(`Unsafe ${kind} leader association`, tx => {
      const target = tx.upsertTableRecord('layers', { id: 'target', name: 'TARGET', payload: {} })
      if (kind === 'ambiguous') tx.createEntity('MTEXT', { position: [10, 4, 0], text: 'NOTE', height: 2, width: 8, rotation: 0, attachmentPoint: 7 }, { id: 'note' })
      tx.createEntity('LEADER', { vertices: [[0, 0, 0], [5, 4, 0]], textPosition: [10, 4, 0], horizontalDirection: [1, 0, 0], annotationId: kind === 'broken' ? 'missing' : 'note', ownsAnnotation: true, annotationType: 0 }, { id: 'leader' })
      if (kind === 'ambiguous') tx.createEntity('LEADER', { vertices: [[1, 0, 0], [6, 4, 0]], textPosition: [10, 4, 0], horizontalDirection: [1, 0, 0], annotationId: 'note', ownsAnnotation: false, annotationType: 0 }, { id: 'other-leader' })
      assert.equal(target.type, 'LAYER')
    })
    const before = document.serialize()
    const result = await session.call('cad_propose_relayer', { expectedRevision: document.revision, units: 'millimeter', ids: ['leader'], layerId: 'target', maxBytes: 262144 })
    assert.equal(result.ok, false, kind)
    assert.equal(document.serialize(), before)
  }
})

test('relayer maxBytes, revision and approval checks fail closed and task-bound approval stays unsupported', async () => {
  const { sdk, document, session } = await fixture(), source = document.serialize()
  assert.equal((await session.call('cad_propose_relayer', args(document, { maxBytes: 1024 }))).ok, false)
  assert.equal((await session.call('cad_propose_relayer', args(document, { maxBytes: 1023 }))).ok, false)
  assert.equal((await session.call('cad_propose_relayer', args(document, { expectedRevision: document.revision - 1 }))).ok, false)
  assert.equal(document.serialize(), source)
  const proposal = value(await session.call('cad_propose_relayer', args(document)))
  assert.throws(() => session.bindTaskProposal(proposal.planId, {}), /Persistent task approval supports/)
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [50, 0, 0], end: [60, 0, 0] } }, { document })
  const stale = document.serialize()
  assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
  assert.equal(document.serialize(), stale)
})

test('relayer preview accepts arbitrary model-space HATCH and INSERT payloads but rejects unsafe patches and spaces', async () => {
  const { document } = await fixture()
  const preview = await createAgentGeometryPreview(document, 'PROPERTIES', { ids: ['stratum-hatch', 'symbol'], patch: { payload: { layerId: 'geology-layer' } } })
  assert.deepEqual(preview.after.map(item => item.id), ['stratum-hatch', 'symbol'])
  await assert.rejects(createAgentGeometryPreview(document, 'PROPERTIES', { ids: ['stratum-hatch'], patch: { payload: { layerId: 'geology-layer', color: 1 } } }), /exactly patch.payload.layerId/)
  await assert.rejects(createAgentGeometryPreview(document, 'PROPERTIES', { ids: ['stratum-hatch'], patch: { payload: { layerId: 'GEOLOGY' } } }), /does not exist/)
  const paperOwner = document.getObject(document.spaces.layoutIds[1]).payload.blockRecordId
  await document.transact('Paper entity', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0] }, { id: 'paper-line', ownerId: paperOwner }))
  await assert.rejects(createAgentGeometryPreview(document, 'PROPERTIES', { ids: ['paper-line'], patch: { payload: { layerId: 'geology-layer' } } }), /model space/)
})
