import test from 'node:test'
import assert from 'node:assert/strict'
import { captureSemanticEntityState, diffSemanticEntityStates } from '../scripts/benchmarks/semantic-entity-diff.mjs'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'

const entity = (id, handle, radius = 5) => ({ id, handle, kind: 'entity', type: 'CIRCLE', ownerId: 'model', name: null,
  payload: { center: [0, 0, 0], radius, layerId: 'layer' }, extension: { xdata: {} }, source: null })
const doc = (revision, entities) => ({ id: 'fixture', revision, listEntities: () => entities })

test('semantic entity diff flags only the targeted KJD edit and preserves untouched records', () => {
  const before = captureSemanticEntityState(doc(1, [entity('target', 'A'), entity('untouched', 'B')]))
  assert.equal(Object.isFrozen(before.entities[0].payload.center), true)
  const after = captureSemanticEntityState(doc(2, [entity('target', 'A', 8), entity('untouched', 'B')]))
  const diff = diffSemanticEntityStates(before, after, { allowedChangedIds: ['target'] })
  assert.deepEqual(diff.added, [])
  assert.deepEqual(diff.removed, [])
  assert.deepEqual(diff.modified, [{ id: 'target', fields: ['/payload/radius'] }])
  assert.deepEqual(diff.unchanged, ['untouched'])
  assert.deepEqual(diff.unexpectedExistingChanges, [])
  assert.deepEqual(diffSemanticEntityStates(before, after).unexpectedExistingChanges, ['target'])
})

test('DXF-style ID regeneration is reported, not counted as preserved identity', () => {
  const before = captureSemanticEntityState(doc(1, [entity('kjd-id', 'A')]))
  const after = captureSemanticEntityState(doc(0, [entity('imported-id', 'A')]))
  const diff = diffSemanticEntityStates(before, after)
  assert.deepEqual(diff.added, ['imported-id'])
  assert.deepEqual(diff.removed, ['kjd-id'])
  assert.deepEqual(diff.unchanged, [])
  assert.deepEqual(diff.idChurnByHandle, [{ handle: 'A', beforeId: 'kjd-id', afterId: 'imported-id', fieldsWithoutId: [] }])
  assert.deepEqual(diff.unexpectedExistingChanges, ['kjd-id'])
})

test('capture rejects duplicate IDs and nested payload edits retain JSON pointer locations', () => {
  assert.throws(() => captureSemanticEntityState(doc(0, [entity('same', 'A'), entity('same', 'B')])), /unique/)
  const before = captureSemanticEntityState(doc(0, [entity('a', 'A')]))
  const changed = entity('a', 'A')
  changed.payload.center[1] = 2
  const after = captureSemanticEntityState(doc(1, [changed]))
  assert.deepEqual(diffSemanticEntityStates(before, after).modified[0].fields, ['/payload/center/1'])
})

test('real approved CAD edit changes only its target; KJD reopen keeps the entity IDs', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'semantic-diff-fixture', units: 'millimeter' })
  await drawing.transact('Seed two entities', tx => {
    tx.createEntity('CIRCLE', { center: [20, 30, 0], radius: 5 }, { id: 'hole' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [50, 0, 0] }, { id: 'datum' })
  })
  const before = captureSemanticEntityState(drawing)
  const session = new KJAgentToolSession(sdk, drawing)
  const proposal = await session.call('cad_propose_set_circle_radius', { expectedRevision: drawing.revision, units: 'millimeter', id: 'hole', radius: 8 })
  assert.equal(proposal.ok, true, JSON.stringify(proposal))
  assert.equal((await session.approve(proposal.value.planId, 'benchmark-reviewer')).ok, true)
  const after = captureSemanticEntityState(drawing)
  const diff = diffSemanticEntityStates(before, after, { allowedChangedIds: ['hole'] })
  assert.deepEqual(diff.unchanged, ['datum'])
  assert.deepEqual(diff.modified.map(change => change.id), ['hole'])
  assert.deepEqual(diff.unexpectedExistingChanges, [])
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(diffSemanticEntityStates(after, captureSemanticEntityState(reopened)).added, [])
  assert.deepEqual(reopened.listEntities().map(item => item.id).sort(), drawing.listEntities().map(item => item.id).sort())
})
