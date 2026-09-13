import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const execute = (sdk, document, command, args = {}) => sdk.executeCommand(command, args, { document })

test('AI COPY allocates stable result identities, previews without editing, and round-trips native geometry', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-copy', units: 'millimeter' })
  const line = await execute(sdk, document, 'CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [30, 40, 0] }, options: { id: 'source-line' } })
  const circle = await execute(sdk, document, 'CREATE', { type: 'CIRCLE', payload: { center: [12, 8, 0], radius: 3 }, options: { id: 'source-circle' } })
  await execute(sdk, document, 'SELECTIONSAVE', { name: 'Detail A', ids: [line.id, circle.id] })
  const session = new KJAgentToolSession(sdk, document), before = document.serialize(), beforeObjects = structuredClone(document.snapshot().objects), revision = document.revision
  const plan = value(await session.call('cad_propose_copy', { expectedRevision: revision, units: 'millimeter', selectionSetName: 'Detail A', dx: 75, dy: -5 }))

  assert.equal(document.serialize(), before)
  assert.equal(plan.command, 'COPY'); assert.equal(plan.preview.command, 'COPY')
  assert.deepEqual(plan.preview.before, []); assert.equal(plan.preview.after.length, 2)
  assert.deepEqual(plan.arguments.ids, [line.id, circle.id])
  assert.deepEqual(plan.preview.after.map(entity => entity.id), plan.arguments.resultIds)
  assert.deepEqual(plan.preview.after.find(entity => entity.type === 'LINE').payload.start, [75, -5, 0])
  assert.deepEqual(plan.preview.after.find(entity => entity.type === 'CIRCLE').payload.center, [87, 3, 0])

  value(await session.approve(plan.planId, 'copy-reviewer'))
  assert.equal(document.revision, revision + 1)
  for (const expected of plan.preview.after) assert.deepEqual(document.getObject(expected.id).payload, expected.payload)
  const committedObjects = structuredClone(document.snapshot().objects)
  await execute(sdk, document, 'UNDO'); assert.deepEqual(document.snapshot().objects, beforeObjects)
  await execute(sdk, document, 'REDO'); assert.deepEqual(document.snapshot().objects, committedObjects)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    const copiedLine = format === 'KJD' ? reopened.getObject(plan.arguments.resultIds[0]) : reopened.listEntities({ type: 'LINE' }).find(entity => entity.payload.start[0] === 75)
    const copiedCircle = format === 'KJD' ? reopened.getObject(plan.arguments.resultIds[1]) : reopened.listEntities({ type: 'CIRCLE' }).find(entity => entity.payload.center[0] === 87)
    assert.deepEqual(copiedLine.payload.start, [75, -5, 0])
    assert.deepEqual(copiedCircle.payload.center, [87, 3, 0])
  }
})

for (const selected of ['leader', 'annotation']) test(`AI COPY expands an owned ${selected} into one isolated native leader pair`, async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: `agent-copy-${selected}`, units: 'millimeter' })
  const pair = await execute(sdk, document, 'LEADER', { vertices: [[0,0,0],[10,5,0],[20,5,0]], textPosition: [24,5,0], text: 'VALVE V-01', textHeight: 2.5, width: 24, rotation: 0, attachmentPoint: 7 })
  const session = new KJAgentToolSession(sdk, document), source = pair[selected]
  const plan = value(await session.call('cad_propose_copy', { expectedRevision: document.revision, units: 'millimeter', ids: [source.id], dx: 40, dy: 10 }))
  assert.equal(plan.arguments.ids.length, 2); assert.equal(plan.arguments.resultIds.length, 2); assert.equal(plan.preview.after.length, 2)
  const leader = plan.preview.after.find(entity => entity.type === 'LEADER'), annotation = plan.preview.after.find(entity => entity.type === 'MTEXT')
  assert.equal(leader.payload.annotationId, annotation.id); assert.deepEqual(annotation.payload.position, [64,15,0])
  value(await session.approve(plan.planId, 'leader-copy-reviewer'))
  assert.equal(document.getObject(leader.id).payload.annotationId, annotation.id)
  assert.equal(document.getObject(annotation.id).payload.text, 'VALVE V-01')
})

test('AI COPY rejects overlap, ambiguous targets, forged identities, protected geometry and revision drift atomically', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-copy-reject', units: 'millimeter' })
  const layer = await execute(sdk, document, 'LAYERNEW', { name: 'LOCKED' })
  const open = await execute(sdk, document, 'CREATE', { type: 'LINE', payload: { start: [0,0,0], end: [10,0,0] }, options: { id: 'open-line' } })
  const locked = await execute(sdk, document, 'CREATE', { type: 'LINE', payload: { start: [0,5,0], end: [10,5,0], layerId: layer.id }, options: { id: 'locked-line' } })
  await execute(sdk, document, 'LAYERUPDATE', { id: layer.id, patch: { locked: true } })
  const session = new KJAgentToolSession(sdk, document), args = { expectedRevision: document.revision, units: 'millimeter', ids: [open.id], dx: 2, dy: 3 }, before = document.serialize()
  for (const bad of [
    { ...args, dx: 0, dy: 0 },
    { ...args, selectionSetName: 'also supplied' },
    { ...args, ids: undefined },
    { ...args, resultIds: ['forged'] },
    { ...args, ids: [locked.id] },
  ]) assert.equal((await session.call('cad_propose_copy', bad)).ok, false)
  assert.equal(document.serialize(), before)

  const plan = value(await session.call('cad_propose_copy', args))
  await execute(sdk, document, 'CREATE', { type: 'CIRCLE', payload: { center: [50,50,0], radius: 1 } })
  assert.equal((await session.approve(plan.planId, 'reviewer')).ok, false)
  assert.equal(document.listEntities().filter(entity => plan.arguments.resultIds.includes(entity.id)).length, 0)
})

test('core preallocated COPY refuses duplicate, existing and cardinality-mismatched result IDs', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'copy-result-id-contract' })
  await execute(sdk, document, 'CREATE', { type: 'LINE', payload: { start: [0,0,0], end: [1,0,0] }, options: { id: 'a' } })
  await execute(sdk, document, 'CREATE', { type: 'LINE', payload: { start: [0,1,0], end: [1,1,0] }, options: { id: 'b' } })
  const before = document.serialize()
  for (const resultIds of [[], ['new'], ['same','same'], ['a','new']]) {
    await assert.rejects(execute(sdk, document, 'COPY', { ids: ['a','b'], dx: 1, dy: 1, resultIds }))
    assert.equal(document.serialize(), before)
  }
})
