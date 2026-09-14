import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateAgentCapabilityCandidates } from '../src/agent-capability-candidates.js'
import { createAgentTopologyContext } from '../src/agent-topology-context.js'
import { createKJDrawSDK } from '../src/sdk.js'

const source = (scope, path) => ({ toolName: 'cad_query_topology', scope, path })
const resolvedRule = (patch = {}) => ({
  id: 'repeat-in-region', candidateKind: 'pattern-instance', seed: { entityTypes: ['INSERT'] },
  predicates: [
    { fact: 'property', source: source('seed', 'entities[].nativeReferences.insert.blockRecordId'), operator: 'exists', relation: 'native-block' },
    { fact: 'property', source: source('seed', 'entities[].nativeReferences.insert.blockRecordId'), operator: 'equals', value: 'block-a', relation: 'expected-block' },
    { fact: 'repeat-group', source: source('seed', 'entities[].nativeReferences.insert.repeat.sameDefinitionInstanceCount'), operator: 'at_least', value: 3, relation: 'repeat-minimum' },
    { fact: 'repeat-group', source: source('seed', 'entities[].nativeReferences.insert.repeat.sameDefinitionInstanceCount'), operator: 'at_most', value: 4, relation: 'repeat-maximum' },
    { fact: 'property', source: source('seed', 'entities[].ownerId'), operator: 'same_as', compareTo: source('related', 'entities[].ownerId'), relation: 'same-owner' },
    { fact: 'property', source: source('seed', 'entities[].layer.id'), operator: 'same_as', compareTo: source('related', 'entities[].layer.id'), relation: 'same-layer' },
    { fact: 'property', source: source('seed', 'entities[].nativeReferences.insert.blockRecordId'), operator: 'same_as', compareTo: source('related', 'entities[].nativeReferences.insert.blockRecordId'), relation: 'same-block-record' },
    { fact: 'geometry-relation', source: source('seed', 'entities[].nativeReferences.displayExtent.bounds'), operator: 'within', compareTo: source('related', 'entities[].nativeReferences.displayExtent.bounds'), relation: 'inside-region' },
  ],
  evidenceCodes: ['native-block-exact', 'repeat-count-bounded', 'owner-layer-contained'], nonMatchPolicy: 'preserve', confirmation: 'always',
  capabilityId: 'example.patterns', capabilityVersion: '1.0.0', ...patch,
})

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'candidate-evaluation', units: 'millimeter' })
  await document.transact('Candidate fixture', tx => {
    const blockA = tx.upsertTableRecord('blockRecords', { id: 'block-a', name: 'A', payload: { entityIds: [] } })
    tx.createEntity('LWPOLYLINE', { vertices: [{ point: [0, 0, 0] }, { point: [1, 0, 0] }, { point: [1, 1, 0] }, { point: [0, 1, 0] }], closed: true }, { id: 'block-a-shape', ownerId: blockA.id })
    const blockB = tx.upsertTableRecord('blockRecords', { id: 'block-b', name: 'B', payload: { entityIds: [] } })
    tx.createEntity('LWPOLYLINE', { vertices: [{ point: [0, 0, 0] }, { point: [1, 0, 0] }, { point: [1, 1, 0] }, { point: [0, 1, 0] }], closed: true }, { id: 'block-b-shape', ownerId: blockB.id })
    tx.createEntity('INSERT', { blockRecordId: blockA.id, position: [0, 0, 0], scale: [1, 1, 1], rotation: 0 }, { id: 'seed' })
    tx.createEntity('INSERT', { blockRecordId: blockA.id, position: [-1, -1, 0], scale: [4, 4, 4], rotation: 0 }, { id: 'near-container' })
    tx.createEntity('INSERT', { blockRecordId: blockA.id, position: [100, 100, 0], scale: [4, 4, 4], rotation: 0 }, { id: 'remote-container' })
    tx.createEntity('INSERT', { blockRecordId: blockB.id, position: [-1, -1, 0], scale: [4, 4, 4], rotation: 0 }, { id: 'same-signature-wrong-block' })
    tx.createEntity('LWPOLYLINE', { vertices: [{ point: [-2, -2, 0] }, { point: [3, -2, 0] }, { point: [3, 3, 0] }, { point: [-2, 3, 0] }], closed: true }, { id: 'hatch-boundary' })
    tx.createEntity('TEXT', { position: [0, 0, 0], text: 'not a boundary', height: 1 }, { id: 'hatch-text' })
    tx.createEntity('LINE', { start: [-1, 0, 0], end: [2, 0, 0] }, { id: 'line-seed' })
  })
  const handle = document.getObject('hatch-boundary').handle, ownerMismatchHandle = document.getObject('block-a-shape').handle, unsupportedHandle = document.getObject('hatch-text').handle
  await document.transact('Associative HATCH fixtures', tx => {
    const payload = boundaryHandles => ({ solid: false, associative: true, patternName: 'ANSI31', boundaryLoops: [{ vertices: [[-2, -2], [3, -2], [3, 3], [-2, 3]] }], rawTags: [{ code: 92, value: 3 }, { code: 97, value: boundaryHandles.length }, ...boundaryHandles.map(value => ({ code: 330, value }))] })
    tx.createEntity('HATCH', payload([handle]), { id: 'hatch-good' })
    tx.createEntity('HATCH', payload(['FFFF']), { id: 'hatch-missing' })
    tx.createEntity('HATCH', payload([ownerMismatchHandle, unsupportedHandle, 'FFFF']), { id: 'hatch-bad-kinds' })
    tx.createEntity('HATCH', { ...payload([handle]), rawTags: [] }, { id: 'hatch-empty' })
  })
  return { sdk, document }
}

const documentUnits = document => document.snapshot().header.units
const topology = (document, ids, change = {}) => createAgentTopologyContext(document, {
  expectedRevision: document.revision, units: documentUnits(document), ids, tolerance: .001, maxBytes: 262144, ...change,
})
const input = (document, candidateRules, seedIds, relatedIds, change = {}) => ({
  candidateRules, topology: topology(document, [...seedIds, ...relatedIds]), expectedRevision: document.revision,
  expectedTolerance: .001, units: documentUnits(document), seedIds, relatedIds, maxBytes: 262144, ...change,
})

test('executes scalar, repeat, exact block, owner/layer and directional containment predicates deterministically', async () => {
  const { document } = await fixture()
  const rule = resolvedRule(), replace = (operator, value) => rule.predicates.map(predicate => predicate.operator === operator ? { ...predicate, value } : predicate)
  const wrongRules = [
    resolvedRule({ id: 'repeat-minimum-fails', predicates: replace('at_least', 4) }),
    resolvedRule({ id: 'repeat-maximum-fails', predicates: replace('at_most', 2) }),
    resolvedRule({ id: 'repeat-equals-fails', predicates: replace('equals', 'block-b') }),
  ]
  const seedIds = ['seed'], relatedIds = ['near-container', 'remote-container', 'same-signature-wrong-block']
  const before = document.serialize(), revision = document.revision
  const forward = evaluateAgentCapabilityCandidates(input(document, [rule, ...wrongRules], seedIds, relatedIds))
  const reverseTopology = topology(document, [...relatedIds, ...seedIds].reverse())
  const reverse = evaluateAgentCapabilityCandidates({ candidateRules: [...wrongRules, rule].reverse(), topology: reverseTopology, expectedRevision: revision, expectedTolerance: .001, units: documentUnits(document), seedIds: [...seedIds].reverse(), relatedIds: [...relatedIds].reverse(), maxBytes: 262144 })
  assert.deepEqual(reverse, forward)
  assert.equal(document.serialize(), before); assert.equal(document.revision, revision)
  assert.equal(forward.candidates.length, 1)
  assert.deepEqual(forward.candidates[0].relatedIds, ['near-container'])
  assert.deepEqual(forward.candidates[0].nonMatchingIds, ['remote-container', 'same-signature-wrong-block'])
  assert.deepEqual(forward.nonMatchingIds, ['remote-container', 'same-signature-wrong-block'])
  assert.equal(forward.candidates[0].confirmationRequired, true)
  const passedEvidence = forward.evidence.find(item => item.ruleId === rule.id)
  assert.deepEqual([...new Set(passedEvidence.predicates.map(item => item.operator))].sort(), ['at_least', 'at_most', 'equals', 'exists', 'same_as', 'within'])
  const wrongBlock = passedEvidence.predicates.find(item => item.relation === 'same-block-record')
  assert.ok(wrongBlock.nonMatchingIds.includes('same-signature-wrong-block'))
  const containment = passedEvidence.predicates.find(item => item.relation === 'inside-region')
  assert.ok(containment.nonMatchingIds.includes('remote-container'))
  for (const id of wrongRules.map(item => item.id)) assert.equal(forward.evidence.find(item => item.ruleId === id).passed, false)
  assert.ok(Object.isFrozen(forward)); assert.ok(Object.isFrozen(forward.candidates[0].relatedIds)); assert.ok(Object.isFrozen(forward.evidence[0].predicates))
  assert.throws(() => { forward.candidates[0].relatedIds.push('x') }, TypeError)
})

test('all_resolved is non-vacuous and rejects missing native HATCH sources without mutation', async () => {
  const { document } = await fixture()
  const rule = resolvedRule({
    id: 'associative-fill', candidateKind: 'region-fill', seed: { entityTypes: ['HATCH'] }, confirmation: 'always',
    predicates: [
      { fact: 'native-reference', source: source('seed', 'entities[].nativeReferences.hatch.loops[].boundarySources'), operator: 'exists', relation: 'has-source' },
      { fact: 'native-reference', source: source('seed', 'entities[].nativeReferences.hatch.loops[].boundarySources'), operator: 'all_resolved', relation: 'sources-resolve' },
    ], evidenceCodes: ['native-sources-complete'],
  })
  const unavailable = resolvedRule({ id: 'missing-insert-property', candidateKind: 'region-fill', seed: { entityTypes: ['HATCH'] }, confirmation: 'always', predicates: [{ fact: 'property', source: source('seed', 'entities[].nativeReferences.insert.blockRecordId'), operator: 'exists', relation: 'insert-only' }], evidenceCodes: ['insert-only'] })
  const before = document.serialize(), result = evaluateAgentCapabilityCandidates(input(document, [rule, unavailable], ['hatch-missing', 'hatch-good', 'hatch-bad-kinds', 'hatch-empty'], []))
  assert.deepEqual(result.candidates.map(candidate => candidate.seedIds[0]), ['hatch-good'])
  assert.deepEqual(result.nonMatchingIds, ['hatch-bad-kinds', 'hatch-empty', 'hatch-missing'])
  assert.equal(result.confirmationRequired, true)
  const failed = result.evidence.find(item => item.seedId === 'hatch-missing')
  assert.equal(failed.passed, false)
  assert.deepEqual(failed.predicates.find(item => item.operator === 'all_resolved').observed.source.statuses, { missing: 1 })
  const mixed = result.evidence.find(item => item.ruleId === rule.id && item.seedId === 'hatch-bad-kinds')
  assert.deepEqual(mixed.predicates.find(item => item.operator === 'all_resolved').observed.source.statuses, { missing: 1, 'owner-mismatch': 1, 'unsupported-type': 1 })
  const empty = result.evidence.find(item => item.ruleId === rule.id && item.seedId === 'hatch-empty')
  assert.equal(empty.predicates.find(item => item.operator === 'exists').passed, false)
  assert.equal(empty.predicates.find(item => item.operator === 'all_resolved').passed, false)
  assert.equal(result.evidence.find(item => item.ruleId === unavailable.id && item.seedId === 'hatch-good').predicates[0].passed, false)
  assert.equal(document.serialize(), before)
})

test('HATCH or INSERT in related candidates always requires confirmation', async () => {
  const { document } = await fixture()
  const rule = resolvedRule({
    id: 'same-owner-related', candidateKind: 'neighbor', seed: { entityTypes: ['LINE'] }, confirmation: 'when-ambiguous',
    predicates: [{ fact: 'property', source: source('seed', 'entities[].ownerId'), operator: 'same_as', compareTo: source('related', 'entities[].ownerId'), relation: 'same-owner' }],
    evidenceCodes: ['same-owner'],
  })
  const result = evaluateAgentCapabilityCandidates(input(document, [rule], ['line-seed'], ['hatch-good']))
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].confirmationRequired, true)
  assert.throws(() => evaluateAgentCapabilityCandidates(input(document, [{ ...rule, id: 'bad-boundary-label', candidateKind: 'stratum-boundary' }], ['line-seed'], ['hatch-good'])), /cannot classify HATCH or INSERT.*noise or boundary/)
  assert.throws(() => evaluateAgentCapabilityCandidates(input(document, [{ ...rule, id: 'bad-noise-label', candidateKind: 'noise' }], ['line-seed'], ['hatch-good'])), /cannot classify HATCH or INSERT.*noise or boundary/)
  assert.throws(() => evaluateAgentCapabilityCandidates(input(document, [{ ...rule, id: 'bad-uppercase-label', candidateKind: 'Boundary' }], ['line-seed'], ['hatch-good'])), /stable lowercase identifier/)
})

test('strict identity, revision, units, disjoint scopes and safe JSON inputs fail closed', async () => {
  const { document } = await fixture(), rule = resolvedRule(), valid = input(document, [rule], ['seed'], ['near-container'])
  assert.throws(() => evaluateAgentCapabilityCandidates({ ...valid, expectedRevision: document.revision - 1 }), /revision/)
  assert.throws(() => evaluateAgentCapabilityCandidates({ ...valid, units: 'meter' }), /units/)
  assert.throws(() => evaluateAgentCapabilityCandidates({ ...valid, expectedTolerance: .002 }), /tolerance/)
  assert.throws(() => evaluateAgentCapabilityCandidates({ ...valid, expectedTolerance: 2, topology: topology(document, ['seed', 'near-container'], { tolerance: 2 }) }), /at most 1/)
  assert.throws(() => evaluateAgentCapabilityCandidates({ ...valid, seedIds: ['seed', 'seed'] }), /unique/)
  assert.throws(() => evaluateAgentCapabilityCandidates({ ...valid, relatedIds: ['seed'] }), /disjoint/)
  assert.throws(() => evaluateAgentCapabilityCandidates({ ...valid, topology: { ...valid.topology, entities: valid.topology.entities.slice(0, 1) } }), /exactly match/)
  assert.throws(() => evaluateAgentCapabilityCandidates({ ...valid, topology: { ...valid.topology, entities: [...valid.topology.entities, { ...valid.topology.entities[0], id: 'extra' }] } }), /exactly match/)
  const accessor = { ...valid }
  Object.defineProperty(accessor, 'units', { enumerable: true, get() { throw new Error('must not run') } })
  assert.throws(() => evaluateAgentCapabilityCandidates(accessor), /accessors/)
  assert.throws(() => evaluateAgentCapabilityCandidates({ ...valid, poison: true }), /unsupported fields/)
  assert.throws(() => evaluateAgentCapabilityCandidates({ ...valid, maxBytes: 1024 }), /exceeds maxBytes/)
})

test('within permits the declared tolerance but never compares owner-local extents across owners', () => {
  const rule = resolvedRule({ predicates: [{ fact: 'geometry-relation', source: source('seed', 'entities[].nativeReferences.displayExtent.bounds'), operator: 'within', compareTo: source('related', 'entities[].nativeReferences.displayExtent.bounds'), relation: 'bounded' }] })
  const entity = (id, ownerId, bounds) => ({ id, type: 'INSERT', ownerId, layer: { id: null }, visible: true, editable: true, selectionSetIds: [], designIds: [], associatedAnnotationIds: [], annotationDependencies: [], connectivity: { status: 'not-applicable', connectionFeatureCount: 0 }, nativeReferences: { displayExtent: { source: 'native-projection', status: 'complete', bounds }, insert: { source: 'native', status: 'matched', blockRecordId: 'block-a', typeCountSignature: 'same', repeat: { source: 'native', scope: 'document', sameDefinitionInstanceCount: 2 } } } })
  const make = owner => ({ documentId: 'bounds', revision: 7, units: 'millimeter', tolerance: .001, coordinateSpace: 'owner-local', semanticInference: 'none', entities: [entity('seed', 'model', [0, 0, 1, 1]), entity('related', owner, [0, 0, .9995, .9995])], connectionGroups: [], connectedComponents: [], branchNodes: [], unsupported: [], connectivityOmissions: [], omitted: [], limits: {} })
  const base = { candidateRules: [rule], expectedRevision: 7, expectedTolerance: .001, units: 'millimeter', seedIds: ['seed'], relatedIds: ['related'], maxBytes: 262144 }
  assert.equal(evaluateAgentCapabilityCandidates({ ...base, topology: make('model') }).candidates.length, 1)
  assert.equal(evaluateAgentCapabilityCandidates({ ...base, topology: make('paper') }).candidates.length, 0)
})

test('predicate work and output bytes are explicitly bounded', () => {
  const entity = id => ({ id, type: 'LINE', ownerId: 'model', layer: { id: null } })
  const seedIds = Array.from({ length: 32 }, (_, index) => `seed-${index}`), relatedIds = Array.from({ length: 32 }, (_, index) => `related-${index}`)
  const paired = Array.from({ length: 16 }, (_, index) => ({ fact: 'property', source: source('seed', 'entities[].ownerId'), operator: 'same_as', compareTo: source('related', 'entities[].ownerId'), relation: `owner-${index}` }))
  const rules = Array.from({ length: 32 }, (_, index) => resolvedRule({ id: `rule-${index}`, seed: { entityTypes: ['LINE'] }, predicates: paired, evidenceCodes: ['bounded'], confirmation: 'when-ambiguous' }))
  const topologyValue = { documentId: 'budget', revision: 1, units: 'millimeter', tolerance: .001, coordinateSpace: 'owner-local', semanticInference: 'none', entities: [...seedIds, ...relatedIds].map(entity) }
  assert.throws(() => evaluateAgentCapabilityCandidates({ candidateRules: rules, topology: topologyValue, expectedRevision: 1, expectedTolerance: .001, units: 'millimeter', seedIds, relatedIds, maxBytes: 262144 }), /evaluation budget/)
})
