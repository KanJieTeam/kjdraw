import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDrawingPrintHtml,
  createKJDrawSDK,
  exportDrawingSvg,
} from '../packages/kjdraw-sdk/src/index.js'

const point = (x, y) => [x, y, 0]
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function modelSheet(sdk, document, bounds = [-15, -15, 135, 95]) {
  const layoutId = document.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PLOTSETUP', { layoutId, dxf: {
    paperWidth: 210, paperHeight: 148, paperUnits: 1, plotType: 4, flags: 0,
    windowMinX: bounds[0], windowMinY: bounds[1], windowMaxX: bounds[2], windowMaxY: bounds[3],
    scaleNumerator: 1, scaleDenominator: 1,
  } }, { document })
  return layoutId
}

async function geometrySpecimen() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-geometry-specimen', units: 'millimeter' })
  await document.transact('Create editable curve specimen', transaction => {
    transaction.createEntity('LINE', { start: point(0, 0), end: point(30, 0) }, { id: 'geometry-line' })
    transaction.createEntity('CIRCLE', { center: point(15, 20), radius: 10 }, { id: 'geometry-circle' })
    transaction.createEntity('ARC', { center: point(45, 20), radius: 10, startAngle: 0, endAngle: Math.PI * 1.5 }, { id: 'geometry-arc' })
    transaction.createEntity('ELLIPSE', { center: point(75, 20), majorAxis: point(14, 0), ratio: .5, startParameter: 0, endParameter: Math.PI * 2 }, { id: 'geometry-ellipse' })
    transaction.createEntity('LWPOLYLINE', { vertices: [point(0, 45), point(25, 45), point(30, 60), point(5, 65)], closed: true }, { id: 'geometry-polyline' })
    transaction.createEntity('HATCH', { boundaryLoops: [{ vertices: [point(45, 45), point(80, 45), point(80, 65), point(45, 65)] }], patternName: 'ANSI31', patternScale: 2 }, { id: 'geometry-hatch' })
  })
  return { id: 'geometry', title: 'Editable 2D entities', category: 'entities', sdk, document, layoutId: await modelSheet(sdk, document), facts: { entityTypes: ['LINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'LWPOLYLINE', 'HATCH'] } }
}

async function dimensionsSpecimen() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-dimension-specimen', units: 'millimeter' })
  await document.transact('Create native dimensions', transaction => {
    const style = transaction.upsertTableRecord('dimensionStyles', { id: 'public-dimension-style', name: 'PUBLIC-DIM', payload: { textHeight: 3, arrowSize: 2.5, extensionOffset: .7, extensionBeyond: 1.2, decimalPlaces: 2 } })
    transaction.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [point(20, 15), point(0, 0), point(40, 0)], styleId: style.id, color: 7 }, { id: 'dimension-aligned' })
    transaction.createEntity('DIMENSION', { dimensionType: 'RADIUS', definitionPoints: [point(65, 20), point(80, 20)], styleId: style.id, color: 7 }, { id: 'dimension-radius' })
    transaction.createEntity('DIMENSION', { dimensionType: 'DIAMETER', definitionPoints: [point(45, 55), point(75, 55)], styleId: style.id, color: 7 }, { id: 'dimension-diameter' })
    transaction.createEntity('DIMENSION', { dimensionType: 'ANGULAR_3_POINT', definitionPoints: [point(110, 65), point(115, 45), point(125, 55), point(105, 45)], styleId: style.id, color: 7 }, { id: 'dimension-angular' })
  })
  return { id: 'dimensions', title: 'Native engineering dimensions', category: 'annotations', sdk, document, layoutId: await modelSheet(sdk, document, [-10, -10, 135, 80]), facts: { dimensionTypes: ['ALIGNED', 'RADIUS', 'DIAMETER', 'ANGULAR_3_POINT'] } }
}

async function typographySpecimen() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-typography-specimen', units: 'millimeter' })
  const style = await sdk.executeCommand('TEXTSTYLE', { operation: 'create', name: 'LOCAL-FALLBACK', current: true, properties: { fontFamily: '"Source Han Sans SC", Microsoft YaHei, Arial, sans-serif', widthFactor: 1 } }, { document })
  await document.transact('Create bilingual editable text', transaction => {
    transaction.createEntity('TEXT', { position: point(0, 30), text: '工程图纸 KJDraw 123', height: 8, styleId: style.id }, { id: 'typography-text' })
    transaction.createEntity('MTEXT', { position: point(0, 15), text: 'Local glyph fallback\\PEditable Unicode: Δ ⌀ ±', height: 5, width: 120, attachmentPoint: 1, styleId: style.id }, { id: 'typography-mtext' })
  })
  return { id: 'typography', title: 'Bilingual local font fallback', category: 'fonts', sdk, document, layoutId: await modelSheet(sdk, document, [-10, 0, 135, 50]), facts: { textStyle: style.name, textCount: 2 } }
}

async function printSpecimen() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-print-specimen', units: 'millimeter' })
  const layout = document.listObjects({ kind: 'layout' }).find(item => item.name !== 'Model')
  if (!layout) throw new Error('Paper-space layout unavailable')
  const ownerId = layout.payload.blockRecordId
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 297, paperHeight: 210, paperUnits: 1, plotType: 5, flags: 0, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10 } }, { document })
  await document.transact('Create A4 paper-space sheet', transaction => {
    transaction.createEntity('LWPOLYLINE', { vertices: [point(10, 10), point(287, 10), point(287, 200), point(10, 200)], closed: true }, { id: 'print-frame', ownerId })
    transaction.createEntity('TEXT', { position: point(20, 185), text: 'A4 LANDSCAPE · PAPER SPACE 1:1', height: 6 }, { id: 'print-title', ownerId })
    transaction.createEntity('LINE', { start: point(20, 170), end: point(277, 170) }, { id: 'print-rule', ownerId })
  })
  return { id: 'layout-print', title: 'A4 vector print layout', category: 'layout-print', sdk, document, layoutId: layout.id, facts: { paper: 'A4 landscape', paperWidthMm: 297, paperHeightMm: 210 } }
}

async function importSpecimen() {
  const source = ['0','SECTION','2','HEADER','9','$ACADVER','1','AC1032','9','$DWGCODEPAGE','3','UTF-8','0','ENDSEC','0','SECTION','2','ENTITIES',
    '0','LINE','5','A1','8','0','10','0','20','0','30','0','11','80','21','0','31','0',
    '0','CIRCLE','5','A2','8','0','10','40','20','25','30','0','40','15',
    '0','TEXT','5','A3','8','0','10','0','20','55','30','0','40','6','1','UTF-8 工程导入',
    '0','ENDSEC','0','EOF',''].join('\r\n')
  const sdk = createKJDrawSDK(), document = await sdk.readDocument(new TextEncoder().encode(source), { format: 'DXF' })
  sdk.attachDocument(document)
  return { id: 'dxf-import', title: 'UTF-8 DXF import compatibility', category: 'import', sdk, document, layoutId: await modelSheet(sdk, document, [-10, -10, 100, 70]), facts: { sourceHandles: ['A1', 'A2', 'A3'], importedTypes: ['LINE', 'CIRCLE', 'TEXT'] } }
}

async function editingSpecimen() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-editing-specimen', units: 'millimeter' })
  const source = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: point(20, 20), radius: 10 }, options: { id: 'editing-source' } }, { document })
  await sdk.executeCommand('MOVE', { id: source.id, dx: 30, dy: 15 }, { document })
  const moved = [...document.getObject(source.id).payload.center]
  await sdk.executeCommand('UNDO', {}, { document })
  const undone = [...document.getObject(source.id).payload.center]
  await sdk.executeCommand('REDO', {}, { document })
  const redone = [...document.getObject(source.id).payload.center]
  const beforeFailure = document.serialize(), revisionBeforeFailure = document.revision
  try { await document.transact('Reject invalid owner atomically', transaction => transaction.createEntity('LINE', { start: point(0, 0), end: point(1, 1) }, { ownerId: 'missing-owner' })) } catch {}
  if (document.serialize() !== beforeFailure || document.revision !== revisionBeforeFailure) throw new Error('Failed edit mutated the document')
  return { id: 'editing-history', title: 'Edit, undo, redo and atomic rejection', category: 'editing', sdk, document, layoutId: await modelSheet(sdk, document, [0, 0, 80, 60]), facts: { moved, undone, redone, failedEditAtomic: true } }
}

async function blocksSpecimen() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-blocks-specimen', units: 'millimeter' })
  const stem = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: point(0, -8), end: point(0, 8) }, options: { id: 'symbol-stem' } }, { document })
  const ring = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: point(0, 0), radius: 5 }, options: { id: 'symbol-ring' } }, { document })
  const definition = await sdk.executeCommand('BLOCKCREATE', { name: 'PUBLIC-REFERENCE-MARK', ids: [stem.id, ring.id], basePoint: [0, 0], description: 'Synthetic reusable reference mark' }, { document })
  await sdk.executeCommand('MOVE', { id: definition.insert.id, dx: 20, dy: 20 }, { document })
  await sdk.executeCommand('BLOCKINSERT', { blockRecordId: definition.block.id, position: [55, 20], scale: [1.5, 1.5, 1], rotation: Math.PI / 6 }, { document })
  await sdk.executeCommand('BLOCKINSERT', { blockRecordId: definition.block.id, position: [90, 20], scale: [.75, .75, 1], rotation: -Math.PI / 4 }, { document })
  return { id: 'blocks-references', title: 'Reusable block references', category: 'blocks', sdk, document, layoutId: await modelSheet(sdk, document, [0, 0, 115, 45]), facts: { definitionName: definition.block.name, definitionEntityCount: 2, insertCount: 3 } }
}

const builders = [geometrySpecimen, dimensionsSpecimen, typographySpecimen, printSpecimen, importSpecimen, editingSpecimen, blocksSpecimen]

/** In-memory specimen documents for docs/showcase builders; no files are written. */
export async function buildCadCapabilitySpecimenDocuments() {
  return Promise.all(builders.map(build => build()))
}

export async function buildCadCapabilitySpecimens(outputDirectory) {
  const root = resolve(outputDirectory), specimens = []
  await mkdir(root, { recursive: true })
  for (const specimen of await buildCadCapabilitySpecimenDocuments()) {
    const directory = resolve(root, specimen.id)
    const kjd = await specimen.sdk.writeDocument(specimen.document, { format: 'KJD', version: '1' })
    const dxf = await specimen.sdk.writeDocument(specimen.document, { format: 'DXF', version: '2018' })
    const drawing = exportDrawingSvg(specimen.document, { layoutId: specimen.layoutId })
    if (drawing.report.diagnostics.length) throw new Error(`${specimen.id} SVG diagnostics: ${JSON.stringify(drawing.report.diagnostics)}`)
    const files = { kjd: `${specimen.id}.kjd`, dxf: `${specimen.id}.dxf`, svg: `${specimen.id}.svg` }
    await mkdir(directory, { recursive: true })
    await Promise.all([
      writeFile(resolve(directory, files.kjd), kjd), writeFile(resolve(directory, files.dxf), dxf), writeFile(resolve(directory, files.svg), drawing.svg),
    ])
    if (specimen.id === 'layout-print') {
      files.print = `${specimen.id}.print.html`
      await writeFile(resolve(directory, files.print), createDrawingPrintHtml(specimen.document, { layoutId: specimen.layoutId, title: specimen.title }).html)
    }
    specimens.push({ id: specimen.id, title: specimen.title, category: specimen.category, files, facts: specimen.facts, revision: specimen.document.revision,
      entityCount: specimen.document.listEntities().length, svg: { status: drawing.report.status, rendered: drawing.report.rendered, diagnostics: drawing.report.diagnostics.length }, dxfSha256: sha256(dxf) })
  }
  const manifest = { schemaVersion: 1, synthetic: true, specimenCount: specimens.length, specimens }
  await writeFile(resolve(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildCadCapabilitySpecimens(process.argv[2] ?? 'kjdraw-capability-specimens')
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
}
