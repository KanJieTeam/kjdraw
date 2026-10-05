import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK, exportDrawingSvg } from '../packages/kjdraw-sdk/src/index.js'

const p = (x, y) => [x, y, 0]
const hash = data => createHash('sha256').update(data).digest('hex')

const designs = Object.freeze([
  { id: 'sleeve-bushing', code: 'ME-101', title: 'THROUGH-BORE SLEEVE', material: 'STEEL / CONCEPT', family: 'turned-part', draw: drawSleeve,
    parameters: { outerDiameter: 60, boreDiameter: 32, length: 64 } },
  { id: 'four-hole-plate', code: 'ME-102', title: 'FOUR-HOLE MOUNTING PLATE', material: 'ALUMINUM / CONCEPT', family: 'milled-part', draw: drawPlate,
    parameters: { length: 120, width: 80, thickness: 8, boreDiameter: 36, holeDiameter: 10, holePitchX: 80, holePitchY: 40 } },
  { id: 'angle-support', code: 'ME-103', title: 'RIBBED ANGLE SUPPORT', material: 'STEEL / CONCEPT', family: 'support', draw: drawAngle,
    parameters: { footLength: 90, height: 90, thickness: 12, depth: 45, mountingHoleDiameter: 10, mountingHolePitch: 40 } },
  { id: 'hole-gauge', code: 'ME-104', title: 'SIX-POINT HOLE GAUGE', material: 'ALUMINUM / CONCEPT', family: 'inspection', draw: drawGauge,
    parameters: { length: 150, width: 90, holeDiameter: 8, columnPitch: 49, rowPitch: 38 } },
])

function drawingTools(tx, layers, dimensionStyleId, prefix) {
  let serial = 0
  const add = (type, payload, layer = 'outline') => tx.createEntity(type,
    { ...payload, layerId: layers[layer].id }, { id: `${prefix}-${String(++serial).padStart(3, '0')}` })
  const line = (x1, y1, x2, y2, layer) => add('LINE', { start: p(x1, y1), end: p(x2, y2) }, layer)
  const rect = (x1, y1, x2, y2, layer) => add('LWPOLYLINE', { vertices: [p(x1, y1), p(x2, y1), p(x2, y2), p(x1, y2)], closed: true }, layer)
  const poly = (vertices, closed = false, layer) => add('LWPOLYLINE', { vertices: vertices.map(([x, y]) => p(x, y)), closed }, layer)
  const circle = (x, y, radius, layer) => add('CIRCLE', { center: p(x, y), radius }, layer)
  const text = (x, y, value, height = 3, layer = 'notes') => add('TEXT', { position: p(x, y), text: value, height }, layer)
  const dim = (x1, y1, x2, y2, dx, dy) => add('DIMENSION', { dimensionType: 'ALIGNED',
    definitionPoints: [p(dx, dy), p(x1, y1), p(x2, y2)], styleId: dimensionStyleId }, 'dimensions')
  const center = (x, y, radius = 8) => {
    line(x - radius, y, x + radius, y, 'center')
    line(x, y - radius, x, y + radius, 'center')
  }
  return { add, line, rect, poly, circle, text, dim, center }
}

function drawSheetFrame(d, design) {
  d.rect(8, 8, 289, 202, 'sheet')
  d.rect(12, 12, 285, 198, 'sheet')
  d.line(12, 183, 285, 183, 'sheet')
  d.line(12, 39, 285, 39, 'sheet')
  d.line(183, 12, 183, 39, 'sheet')
  d.line(237, 12, 237, 39, 'sheet')
  d.line(12, 26, 285, 26, 'sheet')
  d.text(17, 190, 'KJDRAW  /  EDITABLE CAD COLLECTION', 4.1)
  d.text(209, 190, `${design.code}  |  REV A`, 3.5)
  d.text(16, 30.5, 'DRAWING', 2.5)
  d.text(50, 30, design.title, 4.1)
  d.text(16, 17, 'DESIGN', 2.5)
  d.text(50, 17, design.code, 4.1)
  d.text(187, 30.5, 'MATERIAL', 2.5)
  d.text(187, 17, design.material, 2.9)
  d.text(241, 30.5, 'UNITS  mm', 2.5)
  d.text(241, 17, 'SCALE  1:1', 2.9)
  d.text(16, 43, 'ILLUSTRATIVE DESIGN  /  VERIFY DIMENSIONS BEFORE MANUFACTURE', 2.55)
}

function drawSleeve(d) {
  // Front annulus and longitudinal section are two views of OD 60, ID 32, L 64.
  d.circle(83, 112, 30)
  d.circle(83, 112, 16)
  d.center(83, 112, 36)
  for (const [y1, y2] of [[128, 142], [82, 96]]) {
    d.add('HATCH', { boundaryLoops: [{ vertices: [p(164, y1), p(228, y1), p(228, y2), p(164, y2)] }], patternName: 'ANSI31', patternScale: 1.7 }, 'hatch')
  }
  d.rect(164, 82, 228, 142)
  d.line(164, 96, 228, 96)
  d.line(164, 128, 228, 128)
  d.line(159, 112, 233, 112, 'center')
  d.dim(164, 142, 228, 142, 196, 154)
  d.dim(53, 82, 53, 142, 39, 112)
  d.text(53, 63, 'END VIEW', 3.5)
  d.text(173, 63, 'LONGITUDINAL SECTION', 3.5)
  d.text(47, 52, 'BORE DIA 32', 3)
  d.text(166, 52, 'THROUGH BORE  /  DEBURR EDGES', 2.8)
  d.line(100, 100, 125, 83, 'notes')
  d.line(125, 83, 150, 83, 'notes')
  d.text(124, 86, 'ID 32', 2.8)
}

function drawPlate(d) {
  d.rect(68, 73, 188, 153)
  d.circle(128, 113, 18)
  d.center(128, 113, 23)
  for (const [x, y] of [[88, 93], [168, 93], [88, 133], [168, 133]]) {
    d.circle(x, y, 5)
    d.center(x, y, 8)
  }
  d.rect(68, 54, 188, 62)
  d.dim(68, 153, 188, 153, 128, 165)
  d.dim(68, 73, 68, 153, 54, 113)
  d.dim(88, 93, 168, 93, 128, 80)
  d.dim(188, 54, 188, 62, 201, 58)
  d.text(77, 49, 'PLAN VIEW', 3.3)
  d.text(206, 144, '4X DIA 10 THRU', 3)
  d.text(206, 133, 'CENTER DIA 36', 3)
  d.text(206, 122, 'BREAK SHARP EDGES', 3)
  d.text(206, 111, 'HOLE GRID: 80 X 40', 3)
  d.text(206, 100, 'FLATNESS: DESIGN', 3)
  d.line(173, 136, 199, 150, 'notes')
  d.line(199, 150, 230, 150, 'notes')
}

function drawAngle(d) {
  // Profile and top view share a 90 mm foot length; the 45 mm top view is depth.
  d.poly([[53, 68], [143, 68], [143, 80], [65, 80], [65, 158], [53, 158]], true)
  d.poly([[65, 80], [98, 80], [65, 113]], true)
  d.add('HATCH', { boundaryLoops: [{ vertices: [p(65, 80), p(98, 80), p(65, 113)] }], patternName: 'ANSI31', patternScale: 2 }, 'hatch')
  d.rect(179, 85, 269, 130)
  d.line(191, 85, 191, 130)
  for (const x of [215, 255]) {
    d.circle(x, 107.5, 5)
    d.center(x, 107.5, 8)
  }
  d.dim(53, 68, 143, 68, 98, 56)
  d.dim(53, 68, 53, 158, 40, 113)
  d.dim(179, 130, 269, 130, 224, 144)
  d.dim(179, 85, 179, 130, 167, 107.5)
  d.text(72, 161, 'PROFILE', 3.2)
  d.text(210, 161, 'TOP VIEW', 3.2)
  d.text(188, 68, '2X DIA 10 THRU', 3)
  d.text(188, 58, 'HOLE PITCH 40', 3)
  d.text(71, 49, 'WALL 12 / RIB SCHEMATIC', 2.75)
}

function drawGauge(d) {
  d.rect(55, 67, 205, 157)
  d.line(55, 60, 205, 60, 'center')
  d.line(49, 67, 49, 157, 'center')
  const xs = [81, 130, 179], ys = [93, 131]
  for (let row = 0; row < ys.length; row++) for (let col = 0; col < xs.length; col++) {
    d.circle(xs[col], ys[row], 4)
    d.center(xs[col], ys[row], 7)
    d.text(xs[col] - 5, ys[row] + 10, `${'ABC'[col]}${row + 1}`, 2.9)
  }
  d.dim(55, 157, 205, 157, 130, 169)
  d.dim(55, 67, 55, 157, 38, 112)
  d.dim(81, 93, 130, 93, 105.5, 82)
  d.dim(179, 93, 179, 131, 191, 112)
  d.text(215, 148, '6X DIA 8 THRU', 3.0)
  d.text(215, 135, 'COLUMN PITCH 49', 3.0)
  d.text(215, 122, 'ROW PITCH 38', 3.0)
  d.text(215, 109, 'DATUM A: BOTTOM', 3.0)
  d.text(215, 96, 'DATUM B: LEFT', 3.0)
  d.text(68, 49, 'PATTERN CHECK / POSITION DEMONSTRATION', 3)
}

async function buildOne(design) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `public-${design.id}`, title: design.title, units: 'millimeter' })
  await document.transact(`Compose ${design.title}`, tx => {
    const continuous = document.getTable('linetypes').records.find(record => record.name === 'CONTINUOUS')
    const centerType = tx.upsertTableRecord('linetypes', { id: `${design.id}-center-linetype`, name: 'CENTER',
      payload: { description: 'Long-short center line', pattern: [8, -1, 1, -1] } })
    const layerSpecs = {
      sheet: ['SHEET_FRAME', 8, 18], outline: ['PART_OUTLINE', 7, 35], hatch: ['SECTION_HATCH', 8, 13],
      center: ['CENTER_LINES', 3, 13], dimensions: ['DIMENSIONS', 2, 18], notes: ['NOTES', 7, 18],
    }
    const layers = Object.fromEntries(Object.entries(layerSpecs).map(([key, [name, color, lineweight]]) =>
      [key, tx.upsertTableRecord('layers', { id: `${design.id}-${key}-layer`, name, payload: {
        color, lineweight, visible: true, plottable: true,
        linetypeId: key === 'center' ? centerType.id : continuous.id,
        linetypeName: key === 'center' ? centerType.name : continuous.name,
      } })]))
    const style = tx.upsertTableRecord('dimensionStyles', { id: `${design.id}-dimension-style`, name: 'KJDRAW-SHOWCASE',
      payload: { textHeight: 3, arrowSize: 2.4, extensionOffset: .8, extensionBeyond: 1.2, decimalPlaces: 0 } })
    const tools = drawingTools(tx, layers, style.id, design.id)
    drawSheetFrame(tools, design)
    design.draw(tools)
  })
  const layoutId = document.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PLOTSETUP', { layoutId, dxf: { paperWidth: 297, paperHeight: 210, paperUnits: 1,
    plotType: 4, flags: 0, windowMinX: 0, windowMinY: 0, windowMaxX: 297, windowMaxY: 210,
    scaleNumerator: 1, scaleDenominator: 1 } }, { document })
  return { id: design.id, title: design.title, family: design.family, code: design.code,
    parameters: design.parameters, sdk, document, layoutId }
}

export async function buildCuratedMechanicalSheetDocuments() {
  return Promise.all(designs.map(buildOne))
}

export async function buildCuratedMechanicalSheets(outputDirectory) {
  const root = resolve(outputDirectory)
  await mkdir(root, { recursive: true })
  const cases = []
  for (const item of await buildCuratedMechanicalSheetDocuments()) {
    const folder = resolve(root, item.id)
    await mkdir(folder, { recursive: true })
    const [kjd, dxf] = await Promise.all([
      item.sdk.writeDocument(item.document, { format: 'KJD', version: '1' }),
      item.sdk.writeDocument(item.document, { format: 'DXF', version: '2018' }),
    ])
    const preview = exportDrawingSvg(item.document, { layoutId: item.layoutId })
    if (preview.report.diagnostics.length) throw new Error(`${item.id}: SVG diagnostics ${JSON.stringify(preview.report.diagnostics)}`)
    const files = { kjd: `${item.id}.kjd`, dxf: `${item.id}.dxf`, svg: `${item.id}.svg` }
    await Promise.all([writeFile(resolve(folder, files.kjd), kjd), writeFile(resolve(folder, files.dxf), dxf),
      writeFile(resolve(folder, files.svg), preview.svg)])
    cases.push({ id: item.id, title: item.title, family: item.family, code: item.code,
      parameters: item.parameters, files, entityCount: item.document.listEntities().length,
      layerNames: item.document.getTable('layers').records.map(record => record.name).sort(),
      svg: { status: preview.report.status, rendered: preview.report.rendered, diagnostics: preview.report.diagnostics.length },
      dxfSha256: hash(dxf) })
  }
  const manifest = { schemaVersion: 1, synthetic: true, count: cases.length, cases }
  await writeFile(resolve(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await buildCuratedMechanicalSheets(process.argv[2] ?? 'kjdraw-curated-mechanical'), null, 2)}\n`)
}
