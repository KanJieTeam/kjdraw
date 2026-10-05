import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createKJDrawSDK, previewPlanarBoundaries, applyPlanarBoundaryExtraction } from '../packages/kjdraw-sdk/src/index.js'

const directory = resolve(process.argv[2] ?? 'work/planar-boundaries-example')
await mkdir(directory, { recursive: true })
const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
await document.transact('Original public synthetic sources', tx => {
  const points = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]]
  for (let i = 0; i < 4; i++) tx.createEntity('LINE', { start: points[i], end: points[(i + 1) % 4] }, { id: `edge-${i}` })
  tx.createEntity('CIRCLE', { center: [20, 15, 0], radius: 5 }, { id: 'hole' })
  tx.createEntity('CIRCLE', { center: [60, 15, 0], radius: 4 }, { id: 'island' })
  tx.createEntity('TEXT', { text: 'Synthetic boundary example', position: [0, 38, 0], height: 2 }, { id: 'manual-note' })
})
const before = document.serialize(), sources = document.listEntities().map(e => structuredClone(e))
const request = { ids: ['island', 'edge-2', 'edge-0', 'hole', 'edge-3', 'edge-1'], units: 'millimeter', expectedRevision: document.revision }
const preview = await previewPlanarBoundaries(document, request)
assert.equal(document.serialize(), before)
assert.equal(preview.complete, true)
assert.equal(preview.contours.length, 3)
const result = await applyPlanarBoundaryExtraction(document, { ...request, expectedGeometryDigest: preview.receipt.geometryDigest })
for (const source of sources) assert.deepEqual(document.getObject(source.id), source)
await document.undo()
assert.equal(document.listEntities().length, sources.length)
await document.redo()
const reopened = createKJDrawSDK().openDocument(document.serialize())
for (const source of sources) assert.deepEqual(reopened.getObject(source.id), JSON.parse(JSON.stringify(source)))
await writeFile(join(directory, 'boundaries.kjd'), document.serialize())
await writeFile(join(directory, 'boundaries.dxf'), await sdk.writeDocument(document, { format: 'DXF', version: '2018' }))
await writeFile(join(directory, 'boundary-receipt.json'), JSON.stringify({ preview, resultIds: result.resultIds, sourcesPreserved: true, undoRedoAndKjdReopen: true, source: 'Original synthetic geometry; no customer drawings or model calls.' }, null, 2))
console.log(`Created ${result.resultIds.length} editable native boundaries in ${directory}`)
