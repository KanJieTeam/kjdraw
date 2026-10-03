import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createKJDrawSDK, applyPlanarContourEdit } from '../packages/kjdraw-sdk/src/index.js'

const output = resolve(process.argv[2] ?? 'work/planar-contours-example')
const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
await drawing.transact('Source circles', transaction => {
  transaction.createEntity('CIRCLE', { center: [0, 0, 0], radius: 50 }, { id: 'outer' })
  transaction.createEntity('CIRCLE', { center: [0, 0, 0], radius: 20 }, { id: 'inner' })
})
const difference = await applyPlanarContourEdit(drawing, {
  operation: 'difference', ids: ['outer', 'inner'], units: 'millimeter', expectedRevision: drawing.revision,
})
const expansion = await applyPlanarContourEdit(drawing, {
  operation: 'offset', ids: difference.resultIds, distance: 5,
  units: 'millimeter', expectedRevision: drawing.revision,
})
await mkdir(output, { recursive: true })
await writeFile(join(output, 'annular-contours.kjd'), await sdk.writeDocument(drawing, { format: 'KJD' }))
await writeFile(join(output, 'annular-contours.dxf'), await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }))
await writeFile(join(output, 'receipt.json'), JSON.stringify({
  units: 'millimeter', sourceRadii: [50, 20], difference,
  expansion: { distance: 5, ...expansion },
  expectedAreas: { difference: Math.PI * 2100, expansion: Math.PI * 2800 },
}, null, 2))
console.log(JSON.stringify({ output, differenceArea: difference.area, expandedArea: expansion.area, sourceIds: ['outer', 'inner'], resultIds: expansion.resultIds }))
