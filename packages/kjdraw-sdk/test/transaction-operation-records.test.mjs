import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, KJDocument, KJTransaction } from '../src/index.js'

test('CREATE and TRIM revisions retain operation kinds separately from entity types', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const create = (type, payload) => sdk.executeCommand('CREATE', { type, payload }, { document })
  const boundaryA = await create('LINE', { start: [3, -10, 6], end: [3, 10, 6] })
  const boundaryB = await create('LINE', { start: [7, -10, 6], end: [7, 10, 6] })
  const target = await create('LINE', { start: [0, 0, 6], end: [10, 0, 6], color: 2 })

  const createRevision = document.snapshot().revisions.at(-1)
  const createOperation = createRevision.operations.find(operation => operation.id === target.id)
  assert.ok(createOperation)
  assert.equal(createOperation.type, 'object.create')
  assert.equal(createOperation.objectType, 'LINE')
  const createdTarget = document.getObject(target.id)
  assert.ok(createdTarget)
  assert.equal(createdTarget.type, 'LINE')
  assert.equal('objectType' in createdTarget, false)

  await sdk.executeCommand('TRIM', {
    id: target.id, boundaryIds: [boundaryA.id, boundaryB.id], pickPoint: [5, 0],
  }, { document })
  const trimRevision = document.snapshot().revisions.at(-1)
  const retainedCreation = trimRevision.operations.find(operation => operation.type === 'object.create')
  assert.ok(retainedCreation)
  assert.equal(retainedCreation.objectType, 'LINE')
  const retained = document.getObject(retainedCreation.id)
  assert.ok(retained)
  assert.equal(retained.type, 'LINE')
  assert.equal('objectType' in retained, false)
  assert.deepEqual(retained.payload.start, [7, 0, 6])
  assert.deepEqual(retained.payload.end, [10, 0, 6])
})

test('operation compaction counts record kinds without changing created entity data', () => {
  const state = KJDocument.create({ units: 'millimeter' }).toJSON()
  const transaction = new KJTransaction(state)
  const line = transaction.createEntity('LINE', { start: [1, 2, 3], end: [4, 5, 6], color: 3 })
  const arc = transaction.createEntity('ARC', { center: [7, 8, 9], radius: 2, startAngle: 0, endAngle: Math.PI })

  assert.deepEqual(transaction.operations.map(operation => [operation.type, operation.objectType]), [
    ['object.create', 'LINE'],
    ['object.create', 'ARC'],
  ])
  const compacted = transaction._revisionOperations(1)
  assert.deepEqual(compacted, [{
    type: 'operations.compacted',
    operationCount: 2,
    byType: { 'object.create': 2 },
    digest: compacted[0].digest,
  }])
  assert.equal(line.type, 'LINE')
  assert.deepEqual(line.payload.start, [1, 2, 3])
  assert.equal(arc.type, 'ARC')
  assert.deepEqual(arc.payload.center, [7, 8, 9])
  assert.equal(state.objects[line.id].type, 'LINE')
  assert.equal(state.objects[arc.id].type, 'ARC')
  assert.equal('objectType' in state.objects[line.id], false)
  assert.equal('objectType' in state.objects[arc.id], false)
})
