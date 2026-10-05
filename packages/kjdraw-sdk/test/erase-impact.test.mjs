import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createEraseImpact } from '../src/erase-impact.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const query = (document, ids, change = {}) => ({ expectedRevision: document.revision, units: 'millimeter', operation: 'erase', ids, tolerance: .001, maxBytes: 262144, ...change })

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'erase-impact', units: 'millimeter' })
  await document.transact('Exact erase impact graph', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { id: 'left' })
    const bridge = tx.createEntity('LINE', { start: [10, 0, 0], end: [20, 0, 0] }, { id: 'bridge' })
    tx.createEntity('LINE', { start: [20, 0, 0], end: [30, 0, 0] }, { id: 'right' })
    tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[15, 4, 0], [10, 0, 0], [20, 0, 0]], dimensionAssociations: [
      { definitionPointIndex: 1, entityId: bridge.id, feature: 'start' }, { definitionPointIndex: 2, entityId: bridge.id, feature: 'end' },
    ] }, { id: 'bridge-dimension' })
    tx.createEntity('HATCH', {
      solid: false, associative: true, patternName: 'CUSTOM_STRATUM', patternLines: [{ angle: 0, base: [0, 0], offset: [0, 2], dashes: [4, -2] }],
      boundaryLoops: [{ external: true, sourceHandles: [bridge.handle], vertices: [[10, -2], [20, -2], [20, 2], [10, 2]] }],
      rawTags: [{ code: 92, value: 3 }, { code: 97, value: 1 }, { code: 330, value: bridge.handle }], custom: { geologicalPattern: 'sandstone' },
    }, { id: 'stratum-hatch' })
    const definition = tx.upsertTableRecord('blockRecords', { id: 'symbol-definition', name: 'GEOLOGY SYMBOL', payload: { basePoint: [0, 0, 0], entityIds: [] } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [2, 0, 0] }, { id: 'block-member', ownerId: definition.id })
    tx.createEntity('INSERT', { blockRecordId: definition.id, position: [40, 0, 0], scale: [1, 1, 1], rotation: 0, attributeIds: [], sequenceEndId: null }, { id: 'symbol-instance' })
    const attributed = tx.createEntity('INSERT', { blockRecordId: definition.id, position: [50, 0, 0], scale: [1, 1, 1], rotation: 0, attributeIds: [], sequenceEndId: null }, { id: 'attributed-symbol' })
    tx.createEntity('ATTRIB', { parentInsertId: attributed.id, tag: 'CODE', text: 'BH-03', position: [50, 0, 0], height: 2 }, { id: 'symbol-code', ownerId: attributed.ownerId })
    tx.createObject({ id: 'symbol-end', kind: 'custom', type: 'SEQEND', ownerId: attributed.id, payload: { dxfOwnerMode: 'insert' } })
    tx.updateObject(attributed.id, { payload: { attributeIds: ['symbol-code'], sequenceEndId: 'symbol-end' } })
    tx.createEntity('MTEXT', { position: [60, 5, 0], text: 'NOTE', height: 2, width: 10, rotation: 0, attachmentPoint: 7 }, { id: 'leader-note' })
    tx.createEntity('LEADER', { vertices: [[55, 0, 0], [58, 5, 0]], textPosition: [60, 5, 0], horizontalDirection: [1, 0, 0], annotationId: 'leader-note', ownsAnnotation: true, annotationType: 0 }, { id: 'leader' })
    tx.createObject({ id: 'bridge-group', kind: 'group', type: 'GROUP', ownerId: document.snapshot().namedObjectsDictionaryId, name: 'Bridge group', payload: { memberIds: ['left', 'bridge', 'right'] } })
  })
  const design = await sdk.executeCommand('DESIGNCREATE', { name: 'Bridge length', definition: {
    parameters: [{ name: 'length', value: 20, min: 1, max: 100 }], derived: [], bindings: [{ entityId: 'bridge', path: 'end.0', expression: { constant: 0, terms: [{ parameter: 'length', coefficient: 1 }] } }], requirements: [],
  } }, { document })
  await sdk.getSelectionManager(document.id).saveNamed('Bridge selection', { ids: ['bridge', 'bridge-dimension', 'stratum-hatch'] })
  return { sdk, document, design, session: new KJAgentToolSession(sdk, document) }
}

test('cad_query_impact reports exact dangling relations and a non-prescriptive connectivity split without editing', async () => {
  const { document, design, session } = await fixture(), before = document.serialize(), revision = document.revision
  const impact = value(await session.call('cad_query_impact', query(document, ['bridge'])))
  assert.equal(document.serialize(), before); assert.equal(document.revision, revision)
  assert.equal(impact.canErase, false)
  assert.deepEqual(impact.requestedIds, ['bridge']); assert.deepEqual(impact.eraseRootIds, ['bridge'])
  assert.deepEqual(impact.blockers.map(item => item.kind), ['design-relation', 'dimension-association', 'hatch-source'])
  assert.equal(impact.designRelations[0].id, design.id); assert.equal(impact.designRelations[0].condition, 'would-dangle-design-binding')
  assert.deepEqual(impact.dimensions[0].affectedSourceIds, ['bridge']); assert.equal(impact.dimensions[0].resolvedBySameErase, false)
  assert.equal(impact.hatchSourceReferences[0].reference, 'raw-97-330'); assert.equal(impact.hatchSourceReferences[0].resolvedBySameErase, false)
  assert.deepEqual(impact.groups[0].affectedMemberIds, ['bridge'])
  assert.deepEqual(impact.selectionSets[0].affectedMemberIds, ['bridge'])
  assert.deepEqual(impact.connectivity.before.affectedComponents, [['bridge', 'left', 'right']])
  assert.deepEqual(impact.connectivity.after.retainedComponents, [['left'], ['right']])
  assert.equal(impact.connectivity.disconnectCandidates[0].condition, 'selected-entities-bridge-retained-endpoint-connectivity')
  assert.equal(impact.connectivity.disconnectCandidates[0].requiresCapabilityConfirmation, true)
  assert.equal(impact.connectivity.semanticInference, 'none')
  assert.ok(new TextEncoder().encode(JSON.stringify({ ok: true, value: impact })).length <= impact.limits.maxBytes)
})

test('ERASE shares the impact blockers, resolves included references atomically and cleans persistent selection membership', async () => {
  const { sdk, document, design } = await fixture()
  await sdk.executeCommand('DESIGNDELETE', { id: design.id }, { document })
  const blocked = document.serialize()
  await assert.rejects(sdk.executeCommand('ERASE', { ids: ['bridge', 'bridge-dimension'] }, { document }), /must include HATCH stratum-hatch/)
  assert.equal(document.serialize(), blocked)
  const impact = createEraseImpact(document, query(document, ['bridge', 'bridge-dimension', 'stratum-hatch']))
  assert.equal(impact.canErase, true); assert.equal(impact.dimensions[0].resolvedBySameErase, true); assert.equal(impact.hatchSourceReferences[0].resolvedBySameErase, true)
  assert.deepEqual(impact.nativeCandidates, [{ id: 'stratum-hatch', type: 'HATCH', structuralRole: 'region-fill', patternCandidate: { eligible: true, kind: 'region-fill', inferredRole: null, boundaryRole: 'unassigned' }, expandedGeometry: false }])
  const before = document.snapshot().objects, revision = document.revision
  await sdk.executeCommand('ERASE', { ids: ['bridge', 'bridge-dimension', 'stratum-hatch'] }, { document })
  assert.equal(document.revision, revision + 1)
  for (const id of ['bridge', 'bridge-dimension', 'stratum-hatch']) assert.equal(document.getObject(id), null)
  assert.deepEqual(sdk.getSelectionManager(document.id).listNamed()[0].memberIds, [])
  await sdk.executeCommand('UNDO', {}, { document }); assert.deepEqual(document.snapshot().objects, before)
})

test('INSERT attachments, owned annotations and block reverse instances stay explicit without expansion', async () => {
  const { sdk, document, session } = await fixture()
  const child = value(await session.call('cad_query_impact', query(document, ['symbol-code'])))
  assert.equal(child.canErase, false); assert.equal(child.blockers[0].kind, 'attached-insert-record'); assert.equal(child.blockers[0].dependentId, 'attributed-symbol')
  await assert.rejects(sdk.executeCommand('ERASE', { id: 'symbol-code' }, { document }), /parent INSERT attributed-symbol/)
  const insert = value(await session.call('cad_query_impact', query(document, ['attributed-symbol'])))
  assert.equal(insert.canErase, true)
  assert.deepEqual(insert.effectiveEraseIds, ['attributed-symbol', 'symbol-code', 'symbol-end'])
  assert.deepEqual(insert.insertAttachments[0].attributeIds, ['symbol-code']); assert.equal(insert.insertAttachments[0].sequenceEndId, 'symbol-end')
  assert.equal(insert.nativeCandidates[0].patternCandidate.kind, 'symbol-candidate'); assert.equal(insert.nativeCandidates[0].expandedGeometry, false)
  await sdk.executeCommand('ERASE', { id: 'attributed-symbol' }, { document })
  for (const id of ['attributed-symbol', 'symbol-code', 'symbol-end']) assert.equal(document.getObject(id), null)
  await sdk.executeCommand('UNDO', {}, { document })

  const member = value(await session.call('cad_query_impact', query(document, ['block-member'])))
  assert.equal(member.canErase, true); assert.deepEqual(member.blockDefinitionInstances[0].instanceIds, ['attributed-symbol', 'symbol-instance'])
  assert.equal(member.blockDefinitionInstances[0].requiresCapabilityConfirmation, true); assert.equal(member.blockDefinitionInstances[0].expandedInstances, false)

  const leader = value(await session.call('cad_query_impact', query(document, ['leader-note'])))
  assert.equal(leader.canErase, true); assert.deepEqual(leader.effectiveEraseIds, ['leader', 'leader-note'])
  assert.deepEqual(leader.leaderPairs[0], { leaderId: 'leader', annotationId: 'leader-note', condition: 'owned-native-annotation-erased-atomically', resolvedBySameErase: true })
  await sdk.executeCommand('ERASE', { id: 'leader-note' }, { document })
  assert.equal(document.getObject('leader'), null); assert.equal(document.getObject('leader-note'), null)
})

test('impact schema, identity and byte limits fail closed', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  const definition = session.definitions.find(tool => tool.name === 'cad_query_impact')
  assert.equal(definition.effect, 'read'); assert.deepEqual(definition.inputSchema.required, ['expectedRevision', 'units', 'operation', 'ids', 'tolerance', 'maxBytes'])
  for (const input of [
    { ...query(document, ['bridge']), extra: true }, query(document, ['bridge'], { operation: 'move' }), query(document, ['bridge'], { units: 'meter' }),
    query(document, ['bridge'], { expectedRevision: document.revision - 1 }), query(document, ['bridge', 'bridge']), query(document, Array.from({ length: 65 }, (_, index) => `id-${index}`)),
    query(document, ['missing']), query(document, ['bridge'], { tolerance: 0 }), query(document, ['bridge'], { tolerance: 1.000001 }), query(document, ['bridge'], { maxBytes: 1023 }), query(document, ['bridge'], { maxBytes: 1024 }),
  ]) assert.equal((await session.call('cad_query_impact', input)).ok, false)
  assert.equal(document.serialize(), before)
})

test('public object scans stay capped while core reference validation may scan the already-open document without connectivity work', async () => {
  const { document } = await fixture(), input = query(document, ['symbol-instance'])
  assert.throws(() => createEraseImpact(document, input, { maxObjectsLimit: 1 }), /exceeds 1 live objects/)
  const objectCount = Object.keys(document.snapshot().objects).length
  const impact = createEraseImpact(document, input, { maxObjectsLimit: objectCount, analyzeConnectivity: false })
  assert.equal(impact.canErase, true); assert.equal(impact.limits.maxObjects, objectCount)
  assert.equal(impact.connectivity.status, 'skipped-for-core-reference-validation')
  assert.equal(impact.connectivity.comparisons, 0)
})

test('spline fit-point code 97 is not mistaken for a native HATCH source list', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Spline hatch', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0] }, { id: 'unrelated' })
    tx.createEntity('HATCH', {
      solid: false, associative: false, patternName: 'EARTH', boundaryLoops: [{ external: true, vertices: [[0, 0], [2, 0], [2, 2], [0, 2]] }],
      rawTags: [{ code: 92, value: 0 }, { code: 93, value: 1 }, { code: 72, value: 4 }, { code: 97, value: 2 }, { code: 11, value: 2 }, { code: 21, value: 3 }, { code: 11, value: 4 }, { code: 21, value: 5 }],
    }, { id: 'spline-hatch' })
  })
  const impact = createEraseImpact(document, query(document, ['unrelated']))
  assert.equal(impact.canErase, true); assert.deepEqual(impact.hatchSourceReferences, [])
  await sdk.executeCommand('ERASE', { id: 'unrelated' }, { document })
  assert.equal(document.getObject('unrelated'), null); assert.ok(document.getObject('spline-hatch'))
})

test('oversized imported HATCH tag streams fail the shared reference budget', async () => {
  const { document } = await fixture(), state = structuredClone(document.snapshot())
  state.objects['stratum-hatch'].payload.rawTags = Array.from({ length: 500001 }, () => null)
  const oversized = new Proxy(document, { get(target, property) {
    if (property === 'snapshot') return () => state
    const result = Reflect.get(target, property, target)
    return typeof result === 'function' ? result.bind(target) : result
  } })
  assert.throws(() => createEraseImpact(oversized, query(document, ['bridge'])), /exceeds 500000 references/)
})

test('entities without layerId use the command current layer for protection', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'CURRENT PROTECTED' }, { document })
  await sdk.executeCommand('LAYERCURRENT', { id: layer.id }, { document })
  await document.transact('Imported implicit layer', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0], layerId: null }, { id: 'implicit-current' }))
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } }, { document })
  const impact = createEraseImpact(document, query(document, ['implicit-current']))
  assert.equal(impact.canErase, false); assert.equal(impact.blockers[0].reason, 'locked')
  await assert.rejects(sdk.executeCommand('ERASE', { id: 'implicit-current' }, { document }), /locked/)
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false } }, { document })
  await sdk.executeCommand('ERASE', { id: 'implicit-current' }, { document })
  assert.equal(document.getObject('implicit-current'), null)
})

test('core ERASE uses decision mode and is not rejected by diagnostic output bytes', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Diagnostic-heavy memberships', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0] }, { id: 'member' })
    for (let index = 0; index < 80; index++) tx.createObject({ kind: 'group', type: 'SELECTION_SET', name: `Persistent selection ${String(index).padStart(3, '0')} ${'x'.repeat(80)}`, payload: { memberIds: ['member'] } })
  })
  assert.throws(() => createEraseImpact(document, query(document, ['member'], { maxBytes: 1024 })), /exceeds maxBytes/)
  await sdk.executeCommand('ERASE', { id: 'member' }, { document })
  assert.equal(document.getObject('member'), null)
  assert.equal(document.listObjects({ kind: 'group', type: 'SELECTION_SET' }).every(set => set.payload.memberIds.length === 0), true)
})

test('INSERT declarations must exactly match reverse ATTRIB and SEQEND ownership', async () => {
  const { document } = await fixture()
  const state = structuredClone(document.snapshot()), source = state.objects['symbol-code']
  state.objects['undeclared-attribute'] = { ...source, id: 'undeclared-attribute', handle: 'FFFFFF', payload: { ...source.payload, tag: 'EXTRA' } }
  const malformed = new Proxy(document, { get(target, property) {
    if (property === 'snapshot') return () => state
    const result = Reflect.get(target, property, target)
    return typeof result === 'function' ? result.bind(target) : result
  } })
  const impact = createEraseImpact(malformed, query(document, ['attributed-symbol']))
  assert.equal(impact.canErase, false); assert.equal(impact.blockers[0].kind, 'attached-insert-record')
})
