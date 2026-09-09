import assert from 'node:assert/strict'
import { arcSweep, createKJDrawSDK } from '@kanjieteam/kjdraw'
import { trimEntityPayloads, extendEntityPayload } from '@kanjieteam/kjdraw/editing'

// This file is copied into an isolated consumer and imports only its installed package.
const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0, 6], radius: 10, color: 2 } })
const boundary = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-15, 0, 6], end: [15, 0, 6] } })
const group = await sdk.executeCommand('GROUP', { name: 'Profile', ids: [circle.id, boundary.id] })
const preview = trimEntityPayloads(circle, [boundary], [0, 10])
assert.equal(preview.length, 1)
assert.equal(preview[0].type, 'ARC')
const revision = drawing.revision
const arc = await sdk.executeCommand('TRIM', { id: circle.id, boundaryIds: [boundary.id], pickPoint: [0, 10] })
assert.equal(drawing.revision, revision + 1)
assert.equal(arc.type, 'ARC')
assert.equal(arc.source.derivedFromId, circle.id)
assert.ok(Math.abs(arcSweep(arc.payload) - Math.PI) < 1e-9)
assert.deepEqual(arc.payload.center, [0, 0, 6])
assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [arc.id, boundary.id])
await sdk.executeCommand('UNDO')
assert.deepEqual(drawing.getObject(circle.id), circle)
assert.deepEqual(drawing.getObject(group.id), group)
await sdk.executeCommand('REDO')
assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [arc.id, boundary.id])
const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
const reopened = await sdk.fileAdapters.read(dxf, { format: 'DXF' })
const savedArc = reopened.listEntities({ type: 'ARC' })[0]
assert.deepEqual(savedArc.payload.center, [0, 0, 6])
assert.ok(Math.abs(arcSweep(savedArc.payload) - Math.PI) < 1e-9)
const extended = extendEntityPayload({ type: 'ARC', payload: { center: [0, 0, 6], radius: 10, startAngle: 0, endAngle: Math.PI / 4 } }, [
  { type: 'LINE', payload: { start: [0, 0, 6], end: [0, 15, 6] } },
], [Math.sqrt(50), Math.sqrt(50)])
assert.ok(Math.abs(arcSweep(extended) - Math.PI / 2) < 1e-9)
console.log(JSON.stringify({ curveEditing: true, nativeArc: true, undoRedo: true, dxfReopen: true }))
