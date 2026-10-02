import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { reviewDrawingFiles, writeReviewReport } from './report.mjs'

// Original sample, generated with the public SDK. No private drawing is shipped.
const out = path.resolve(process.argv[2] ?? 'work/drawing-review-demo')
await mkdir(out, { recursive: true })
const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter', title: 'Original review sample' })
let hole, note
await document.transact('Original demonstration', tx => {
  tx.createEntity('LINE', { start: [0, 0, 0], end: [100, 0, 0] })
  tx.createEntity('LINE', { start: [0, 0, 0], end: [100, 0, 0] })
  tx.createEntity('LINE', { start: [80, 40, 0], end: [80, 40, 0] })
  tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [100, 0], [100, 60], [0, 60]], closed: true })
  hole = tx.createEntity('CIRCLE', { center: [25, 30, 0], radius: 5 })
  note = tx.createEntity('TEXT', { position: [5, 70, 0], text: 'Plate A', height: 5 })
})
const before = path.join(out, 'sample-a.dxf'), after = path.join(out, 'sample-b.dxf')
await writeFile(before, await sdk.writeDocument(document, { format: 'DXF' }), 'utf8')
await document.transact('Revised hole and label', tx => {
  tx.updateObject(hole.id, { payload: { center: [30, 30, 0], radius: 6 } })
  tx.updateObject(note.id, { payload: { text: 'Plate B' } })
})
await writeFile(after, await sdk.writeDocument(document, { format: 'DXF' }), 'utf8')
const report = await reviewDrawingFiles({ before, after, units: 'millimeter', scope: 'model', identity: 'same-lineage-handles', window: [-15, -15, 115, 90] })
console.log(await writeReviewReport(report, out))
