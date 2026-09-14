import assert from 'node:assert/strict'
import test from 'node:test'
import { performance } from 'node:perf_hooks'

import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const query = (document, ids, change = {}) => ({ expectedRevision: document.revision, units: 'millimeter', ids, tolerance: .001, maxBytes: 262144, ...change })

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-topology-query', units: 'millimeter' })
  await document.transact('Seed topology', tx => {
    const locked = tx.upsertTableRecord('layers', { id: 'locked-layer', name: 'LOCKED', payload: { locked: true } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { id: 'line-a' })
    tx.createEntity('LINE', { start: [10.0005, 0, 0], end: [20, 0, 0], layerId: locked.id }, { id: 'line-b' })
    tx.createEntity('LWPOLYLINE', { vertices: [{ point: [10, 0, 0] }, { point: [10, 10, 0] }], closed: false }, { id: 'path' })
    tx.createEntity('LWPOLYLINE', { vertices: [{ point: [0, 0, 0] }, { point: [10, 0, 0] }, { point: [10, 10, 0] }, { point: [0, 10, 0] }], closed: true }, { id: 'stratum-boundary' })
    tx.createEntity('LWPOLYLINE', { vertices: [{ point: [3, 3, 0] }, { point: [7, 3, 0] }, { point: [7, 7, 0] }, { point: [3, 7, 0] }], closed: true }, { id: 'stratum-island' })
    tx.createEntity('TEXT', { position: [2, 2, 0], text: 'boundary label', height: 2 }, { id: 'label' })
    const block = tx.upsertTableRecord('blockRecords', { id: 'symbol-block', name: 'SYMBOL', payload: { entityIds: [] } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0] }, { id: 'symbol-edge', ownerId: block.id })
    tx.createEntity('INSERT', { blockRecordId: block.id, position: [30, 5, 0], scale: [1, 1, 1], rotation: 0 }, { id: 'symbol' })
    tx.createEntity('INSERT', { blockRecordId: block.id, position: [40, 5, 0], scale: [1, 1, 1], rotation: 0 }, { id: 'symbol-repeat' })
    tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[5, -3, 0], [0, 0, 0], [10, 0, 0]], dimensionAssociations: [
      { definitionPointIndex: 1, entityId: 'line-a', feature: 'start' },
      { definitionPointIndex: 2, entityId: 'line-a', feature: 'end' },
    ] }, { id: 'dimension' })
  })
  const lineHandle = document.getObject('line-a').handle, boundaryHandle = document.getObject('stratum-boundary').handle, islandHandle = document.getObject('stratum-island').handle, labelHandle = document.getObject('label').handle, insertHandle = document.getObject('symbol').handle
  await document.transact('Native hatch sources', tx => tx.createEntity('HATCH', {
    solid: false, associative: true, patternName: 'ANSI31', patternScale: 2, patternAngle: .5, boundaryLoops: [{ vertices: [[0, 0], [10, 0], [10, 10], [0, 10]] }, { external: false, vertices: [[3, 3], [7, 3], [7, 7], [3, 7]] }],
    rawTags: [{ code: 92, value: 3 }, { code: 97, value: 5 }, { code: 330, value: boundaryHandle }, { code: 330, value: lineHandle }, { code: 330, value: labelHandle }, { code: 330, value: insertHandle }, { code: 330, value: 'FFFF' }, { code: 92, value: 2 }, { code: 97, value: 1 }, { code: 330, value: islandHandle }],
  }, { id: 'hatch' }))
  await sdk.getSelectionManager(document.id).saveNamed('Connected detail', { ids: ['line-a', 'path'] })
  await sdk.executeCommand('DESIGNCREATE', { name: 'Driven edge', definition: {
    parameters: [{ name: 'length', value: 10, min: 1, max: 100 }], derived: [],
    bindings: [{ entityId: 'line-a', path: 'end.0', expression: { constant: 0, terms: [{ parameter: 'length', coefficient: 1 }] } }], requirements: [],
  } }, { document })
  return { document, session: new KJAgentToolSession(sdk, document) }
}

test('topology query returns deterministic connectivity, branch nodes and native relationship summaries without editing', async () => {
  const { document, session } = await fixture()
  const ids = ['symbol', 'symbol-repeat', 'symbol-edge', 'hatch', 'dimension', 'path', 'line-b', 'line-a']
  const before = document.serialize(), revision = document.revision
  const forward = value(await session.call('cad_query_topology', query(document, ids)))
  const reverse = value(await session.call('cad_query_topology', query(document, [...ids].reverse())))
  assert.deepEqual(reverse, forward)
  assert.equal(document.serialize(), before); assert.equal(document.revision, revision)
  assert.equal(forward.coordinateSpace, 'owner-local'); assert.equal(forward.semanticInference, 'none')
  const lineA = forward.entities.find(entity => entity.id === 'line-a')
  assert.equal(lineA.editable, true)
  assert.equal(lineA.selectionSetIds.length, 1); assert.equal(lineA.designIds.length, 1)
  assert.deepEqual(lineA.associatedAnnotationIds, ['dimension'])
  assert.equal(forward.entities.find(entity => entity.id === 'line-b').layer.editable, false)
  assert.deepEqual(forward.entities.find(entity => entity.id === 'dimension').annotationDependencies.map(item => [item.entityId, item.feature]), [['line-a', 'start'], ['line-a', 'end']])
  const junction = forward.connectionGroups.find(group => group.members.some(member => member.entityId === 'line-a' && member.feature === 'end'))
  assert.deepEqual(junction.members.map(member => member.entityId), ['line-a', 'line-b', 'path'])
  assert.deepEqual(forward.branchNodes, [{ connectionId: junction.id, entityIds: ['line-a', 'line-b', 'path'], degree: 3 }])
  assert.deepEqual(forward.connectedComponents.map(component => component.entityIds), [['line-a', 'line-b', 'path'], ['symbol-edge']])
  assert.equal(forward.unsupported.some(item => ['symbol', 'hatch'].includes(item.id)), false)
  assert.equal(forward.entities.find(entity => entity.id === 'symbol').connectivity.status, 'not-applicable')
  assert.equal(forward.entities.find(entity => entity.id === 'hatch').connectivity.status, 'not-applicable')
  assert.deepEqual(forward.connectivityOmissions.filter(item => ['symbol', 'hatch'].includes(item.id)).map(item => item.reason).sort(), ['block-instance-not-expanded', 'region-fill-not-connectivity'])
  const insert = forward.entities.find(entity => entity.id === 'symbol').nativeReferences.insert
  assert.equal(insert.status, 'matched'); assert.equal(insert.definitionEntityCount, 1); assert.deepEqual(insert.definitionTypes, { LINE: 1 }); assert.equal(insert.source, 'native')
  assert.match(insert.typeCountSignature, /^[a-f0-9]{16}$/); assert.equal(Object.hasOwn(insert, 'structuralSignature'), false)
  assert.equal(insert.repeat.sameDefinitionInstanceCount, 2)
  assert.deepEqual(forward.entities.find(entity => entity.id === 'symbol').nativeReferences.displayExtent, { source: 'native-projection', status: 'complete', bounds: [30, 5, 31, 5] })
  assert.equal(forward.entities.find(entity => entity.id === 'symbol').nativeReferences.structuralRole, 'block-instance')
  assert.deepEqual(forward.entities.find(entity => entity.id === 'symbol').nativeReferences.patternCandidate, { eligible: true, kind: 'symbol-candidate', source: 'native-entity-type', inferredRole: null, boundaryRole: 'unassigned' })
  const hatch = forward.entities.find(entity => entity.id === 'hatch').nativeReferences
  assert.equal(hatch.structuralRole, 'region-fill'); assert.deepEqual({ patternName: hatch.hatch.patternName, solid: hatch.hatch.solid, associative: hatch.hatch.associative, patternScale: hatch.hatch.patternScale, patternAngle: hatch.hatch.patternAngle }, { patternName: 'ANSI31', solid: false, associative: true, patternScale: 2, patternAngle: .5 })
  assert.equal(hatch.hatch.loops.length, 2)
  const sources = hatch.hatch.loops[0].boundarySources
  assert.deepEqual(forward.entities.find(entity => entity.id === 'hatch').nativeReferences.displayExtent.bounds, [0, 0, 10, 10])
  assert.deepEqual(sources.map(source => [source.status, source.type ?? null]).sort(), [['matched', 'LINE'], ['matched', 'LWPOLYLINE'], ['missing', null], ['unsupported-type', 'INSERT'], ['unsupported-type', 'TEXT']])
  assert.deepEqual(hatch.hatch.loops[1].boundarySources.map(source => [source.status, source.type]), [['matched', 'LWPOLYLINE']])
  assert.equal(forward.connectionGroups.some(group => group.members.some(member => ['symbol', 'symbol-repeat', 'hatch'].includes(member.entityId))), false)
  assert.ok(new TextEncoder().encode(JSON.stringify({ ok: true, value: forward })).length <= forward.limits.maxBytes)
})

test('branch degree counts incident curve segments at an internal polyline vertex', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('T junction', tx => {
    tx.createEntity('LWPOLYLINE', { vertices: [{ point: [-10, 0, 0] }, { point: [0, 0, 0] }, { point: [10, 0, 0] }], closed: false }, { id: 'through' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [0, 10, 0] }, { id: 'stem' })
  })
  const result = value(await new KJAgentToolSession(sdk, document).call('cad_query_topology', query(document, ['through', 'stem'])))
  assert.equal(result.branchNodes.length, 1)
  assert.deepEqual(result.branchNodes[0].entityIds, ['stem', 'through']); assert.equal(result.branchNodes[0].degree, 3)
  const node = result.connectionGroups.find(group => group.id === result.branchNodes[0].connectionId)
  assert.deepEqual(node.members.map(member => [member.entityId, member.incidentSegmentCount]), [['stem', 1], ['through', 2]])
})

test('dense features use bounded deterministic spatial matching instead of quadratic distance scans', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const dense = Array.from({ length: 4096 }, () => ({ point: [0, 0, 0] }))
  await document.transact('Dense coincident features', tx => {
    tx.createEntity('LWPOLYLINE', { vertices: dense, closed: false }, { id: 'dense-a' })
    tx.createEntity('LWPOLYLINE', { vertices: dense, closed: false }, { id: 'dense-b' })
  })
  const session = new KJAgentToolSession(sdk, document), before = document.serialize(), started = performance.now()
  const result = await session.call('cad_query_topology', query(document, ['dense-a', 'dense-b']))
  assert.equal(result.ok, false); assert.match(result.error.message, /exceeds maxBytes/)
  assert.ok(performance.now() - started < 2000); assert.equal(document.serialize(), before)
})

test('adversarial neighboring buckets stop at the explicit comparison budget', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const cluster = x => Array.from({ length: 800 }, (_, index) => ({ point: [x, index * .0001, 0] }))
  await document.transact('Bound comparison work', tx => tx.createEntity('LWPOLYLINE', { vertices: [...cluster(.001), ...cluster(1.499)], closed: false }, { id: 'adversarial' }))
  const session = new KJAgentToolSession(sdk, document), before = document.serialize(), started = performance.now()
  const result = await session.call('cad_query_topology', query(document, ['adversarial'], { tolerance: 1 }))
  assert.equal(result.ok, false); assert.match(result.error.message, /comparison budget exceeded/)
  assert.ok(performance.now() - started < 2000); assert.equal(document.serialize(), before)
})

test('topology query rejects stale/incorrect identity, duplicate or missing IDs, invalid tolerance and undersized output budgets atomically', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  for (const args of [
    query(document, ['line-a'], { expectedRevision: document.revision - 1 }),
    query(document, ['line-a'], { units: 'meter' }),
    query(document, ['line-a', 'line-a']),
    query(document, ['missing']),
    query(document, ['line-a'], { tolerance: 0 }),
    query(document, ['line-a'], { tolerance: 1000001 }),
    query(document, ['line-a', 'line-b', 'path', 'dimension', 'hatch', 'symbol'], { maxBytes: 1024 }),
  ]) {
    assert.equal((await session.call('cad_query_topology', args)).ok, false)
    assert.equal(document.serialize(), before)
  }
})

test('topology tool schema is strict, model visible and bounded to 64 IDs', async () => {
  const { document, session } = await fixture()
  const definition = session.definitions.find(tool => tool.name === 'cad_query_topology')
  assert.equal(definition.effect, 'read'); assert.deepEqual(definition.inputSchema.required, ['expectedRevision', 'units', 'ids', 'tolerance', 'maxBytes'])
  assert.equal(definition.inputSchema.properties.ids.minItems, 1); assert.equal(definition.inputSchema.properties.ids.maxItems, 64)
  assert.equal((await session.call('cad_query_topology', { ...query(document, ['line-a']), extra: true })).ok, false)
  assert.equal((await session.call('cad_query_topology', query(document, Array.from({ length: 65 }, (_, index) => `id-${index}`)))).ok, false)
})
