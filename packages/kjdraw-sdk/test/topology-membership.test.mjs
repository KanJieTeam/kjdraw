import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, createKJDrawSDK } from '../src/index.js'

const records = drawing => Object.fromEntries(drawing.listObjects({ includeErased: true }).map(record => [record.id, record]))

for (const [command, sourceSpec, args] of [
  ['BREAK', { type: 'LINE', payload: { start: [0, 0, 4], end: [10, 0, 4], color: 2 } }, { point: [4, 0] }],
  ['EXPLODE', { type: 'LWPOLYLINE', payload: { vertices: [{ point: [0, 0], bulge: 1 }, { point: [2, 0] }, { point: [5, 0] }], elevation: 4, color: 3 } }, {}],
]) test(`${command} replaces persistent source memberships with every derived entity in source order`, async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: `membership-${command.toLowerCase()}` })
  const beforeMarker = await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [-5, 0, 4] } })
  const source = await sdk.executeCommand('CREATE', sourceSpec)
  const afterMarker = await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [15, 0, 4] } })
  const group = await sdk.executeCommand('GROUP', { name: `${command} assembly`, ids: [beforeMarker.id, source.id, afterMarker.id] })
  sdk.activeSelection.replace([afterMarker.id, source.id, beforeMarker.id])
  const saved = await sdk.getSelectionManager().saveNamed(`${command} saved`)
  const before = records(drawing), revision = drawing.revision

  const derived = await sdk.executeCommand(command, { id: source.id, ...args })
  const derivedIds = derived.map(entity => entity.id)
  assert.equal(drawing.getObject(source.id)?.id ?? null, command === 'BREAK' ? derived[0].id : null)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [beforeMarker.id, ...derivedIds, afterMarker.id])
  assert.deepEqual(drawing.getObject(saved.id).payload.memberIds, [afterMarker.id, ...derivedIds, beforeMarker.id])
  assert.equal(drawing.revision, revision + 1)
  if (command === 'BREAK') assert.equal(derived[0].source, null)
  for (const entity of derived.slice(command === 'BREAK' ? 1 : 0)) assert.equal(entity.source.derivedFromId, source.id)
  assert.equal(drawing.validate().valid, true)

  const current = records(drawing), serialized = drawing.serialize()
  assert.deepEqual(records(KJDocument.open(serialized)), current)
  await sdk.executeCommand('UNDO'); assert.deepEqual(records(drawing), before)
  await sdk.executeCommand('REDO'); assert.deepEqual(records(drawing), current)
})

test('BREAK and EXPLODE deduplicate legacy repeated source memberships at the first source position', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'topology-membership-dedup' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const marker = await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [20, 0] } })
  const group = await sdk.executeCommand('GROUP', { name: 'Legacy duplicate', ids: [line.id, marker.id] })
  await drawing.transact('legacy duplicate members', transaction => transaction.updateObject(group.id, { payload: { memberIds: [line.id, marker.id, line.id, marker.id] } }))
  const pieces = await sdk.executeCommand('BREAK', { id: line.id, point: [5, 0] })
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [...pieces.map(piece => piece.id), marker.id])
})
