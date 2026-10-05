import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK, exportDrawingSvg } from '../packages/kjdraw-sdk/src/index.js'

const point = (x, y) => [x, y, 0]
const digest = value => createHash('sha256').update(value).digest('hex')

const designs = Object.freeze([
  { id: 'stepped-drive-shaft', code: 'MC-201', title: 'STEPPED DRIVE SHAFT', family: 'turned-part',
    material: 'STEEL / CONCEPT', draw: drawShaft,
    parameters: { totalLength: 115, diameters: [24, 36, 20], segmentLengths: [35, 50, 30] } },
  { id: 'keyed-hub', code: 'MC-202', title: 'KEYED TRANSMISSION HUB', family: 'power-transmission',
    material: 'STEEL / CONCEPT', draw: drawHub,
    parameters: { outerDiameter: 56, boreDiameter: 24, length: 42, keywayWidth: 8 } },
  { id: 'slotted-linkage', code: 'MC-203', title: 'SLOTTED LINKAGE PLATE', family: 'linkage',
    material: 'STEEL / CONCEPT', draw: drawLinkage,
    parameters: { length: 150, width: 46, thickness: 8, endHoleDiameter: 12, slotWidth: 12, slotCenters: 32 } },
  { id: 'pillow-block-housing', code: 'MC-204', title: 'PILLOW BLOCK HOUSING', family: 'bearing-support',
    material: 'CAST IRON / CONCEPT', draw: drawHousing,
    parameters: { baseLength: 124, baseDepth: 54, shaftBoreDiameter: 30, mountingHoleDiameter: 10, mountingPitch: 94 } },
])

function tools(tx, layers, dimensionStyleId, prefix) {
  let serial = 0
  const add = (type, payload, layer = 'outline') => tx.createEntity(type,
    { ...payload, layerId: layers[layer].id }, { id: `${prefix}-${String(++serial).padStart(3, '0')}` })
  const line = (x1, y1, x2, y2, layer) => add('LINE', { start: point(x1, y1), end: point(x2, y2) }, layer)
  const rect = (x1, y1, x2, y2, layer) => add('LWPOLYLINE',
    { vertices: [point(x1, y1), point(x2, y1), point(x2, y2), point(x1, y2)], closed: true }, layer)
  const poly = (vertices, closed = false, layer) => add('LWPOLYLINE',
    { vertices: vertices.map(([x, y]) => point(x, y)), closed }, layer)
  const circle = (x, y, radius, layer) => add('CIRCLE', { center: point(x, y), radius }, layer)
  const arc = (x, y, radius, startAngle, endAngle, layer) => add('ARC', { center: point(x, y), radius, startAngle, endAngle }, layer)
  const text = (x, y, value, height = 3, layer = 'notes') => add('TEXT',
    { position: point(x, y), text: value, height }, layer)
  const dim = (x1, y1, x2, y2, dx, dy) => add('DIMENSION', { dimensionType: 'ALIGNED',
    definitionPoints: [point(dx, dy), point(x1, y1), point(x2, y2)], styleId: dimensionStyleId }, 'dimensions')
  const center = (x, y, radius = 8) => {
    line(x - radius, y, x + radius, y, 'center')
    line(x, y - radius, x, y + radius, 'center')
  }
  const hatch = vertices => add('HATCH', { boundaryLoops: [{ vertices: vertices.map(([x, y]) => point(x, y)) }],
    patternName: 'ANSI31', patternScale: 1.6 }, 'hatch')
  return { add, line, rect, poly, circle, arc, text, dim, center, hatch }
}

function sheet(d, design) {
  d.rect(8, 8, 289, 202, 'sheet')
  d.rect(12, 12, 285, 198, 'sheet')
  d.line(12, 183, 285, 183, 'sheet')
  d.line(12, 39, 285, 39, 'sheet')
  d.line(12, 26, 285, 26, 'sheet')
  d.line(175, 12, 175, 39, 'sheet')
  d.line(238, 12, 238, 39, 'sheet')
  d.text(17, 190, 'KJDRAW  /  EDITABLE MACHINE COMPONENTS', 4)
  d.text(244, 190, `${design.code} / A`, 3.2)
  d.text(16, 30, 'PART', 2.4)
  d.text(47, 29, design.title, 4)
  d.text(16, 17, 'DRAWING', 2.4)
  d.text(47, 17, design.code, 3.8)
  d.text(179, 30, 'MATERIAL', 2.4)
  d.text(179, 17, design.material, 2.7)
  d.text(241, 30, 'UNITS  mm', 2.4)
  d.text(241, 17, 'SCALE  1:1', 2.7)
  d.text(16, 43, 'ILLUSTRATIVE COMPONENT / DIMENSIONS REQUIRE DESIGN REVIEW', 2.65)
}

function drawShaft(d) {
  // Axial orthographic profile: 35 + 50 + 30 = 115, diameters 24/36/20.
  const x0 = 52, x1 = 87, x2 = 137, x3 = 167, cy = 111
  d.poly([[x0, 99], [x1, 99], [x1, 93], [x2, 93], [x2, 101], [x3, 101],
    [x3, 121], [x2, 121], [x2, 129], [x1, 129], [x1, 123], [x0, 123]], true)
  d.line(45, cy, 174, cy, 'center')
  d.line(x1, 87, x1, 135, 'center')
  d.line(x2, 87, x2, 135, 'center')
  d.circle(222, 111, 18)
  d.circle(222, 111, 12)
  d.center(222, 111, 24)
  d.dim(x0, 129, x3, 129, 109.5, 161)
  d.dim(x0, 99, x1, 99, 69.5, 80)
  d.dim(x1, 93, x2, 93, 112, 75)
  d.dim(x2, 101, x3, 101, 152, 81)
  d.dim(x1, 93, x1, 129, 34, 111)
  d.text(58, 145, 'AXIAL VIEW', 3.2)
  d.text(200, 145, 'END VIEW', 3.2)
  d.text(193, 68, 'MAIN DIA 36', 3)
  d.text(193, 59, 'END DIA 24 / 20', 3)
  d.text(51, 54, 'CHAMFERS AND FITS ARE NOT SPECIFIED', 2.9)
}

function drawHub(d) {
  // End view shows a 56 OD, 24 bore, and 8 wide keyway. Section length 42.
  d.circle(82, 112, 28)
  d.circle(82, 112, 12)
  d.rect(78, 124, 86, 129)
  d.center(82, 112, 34)
  d.hatch([[168, 84], [210, 84], [210, 100], [168, 100]])
  d.hatch([[168, 124], [210, 124], [210, 140], [168, 140]])
  d.rect(168, 84, 210, 140)
  d.line(168, 100, 210, 100)
  d.line(168, 124, 210, 124)
  d.line(163, 112, 215, 112, 'center')
  d.dim(168, 140, 210, 140, 189, 153)
  d.dim(54, 84, 54, 140, 39, 112)
  d.text(55, 68, 'END VIEW', 3.2)
  d.text(166, 68, 'AXIAL SECTION', 3.2)
  d.text(223, 135, 'OD 56', 3)
  d.text(223, 123, 'BORE DIA 24', 3)
  d.text(223, 111, 'KEYWAY 8 WIDE', 3)
  d.text(223, 99, 'LENGTH 42', 3)
  d.text(54, 54, 'KEY DEPTH, TOLERANCE AND FIT TO BE DEFINED', 2.8)
}

function drawLinkage(d) {
  // Flat plate outline is 150 x 46. The center slot is a schematic 12-wide obround.
  d.poly([[53, 98], [59, 92], [197, 92], [203, 98], [203, 132], [197, 138], [59, 138], [53, 132]], true)
  d.circle(68, 115, 6)
  d.circle(188, 115, 6)
  d.center(68, 115, 10)
  d.center(188, 115, 10)
  d.arc(112, 115, 6, Math.PI / 2, Math.PI * 1.5)
  d.arc(144, 115, 6, Math.PI * 1.5, Math.PI * 2.5)
  d.line(112, 109, 144, 109)
  d.line(112, 121, 144, 121)
  d.line(112, 115, 144, 115, 'center')
  d.rect(53, 71, 203, 79)
  d.dim(53, 138, 203, 138, 128, 152)
  d.dim(53, 92, 53, 138, 36, 115)
  d.dim(68, 92, 188, 92, 128, 61)
  d.dim(53, 71, 53, 79, 39, 75)
  d.text(60, 163, 'PLAN VIEW / 2X DIA 12 THRU', 3)
  d.text(213, 133, 'SLOT 12 WIDE', 3)
  d.text(213, 121, 'SLOT CENTERS 32', 3)
  d.text(213, 109, 'END PITCH 120', 3)
  d.text(213, 97, 'THICKNESS 8', 3)
  d.text(60, 52, 'OBROUND SLOT / VERIFY FIT BEFORE FABRICATION', 2.8)
}

function drawHousing(d) {
  // Conceptual pillow-block elevation and top view; bore and base holes remain editable.
  d.rect(55, 77, 179, 93)
  d.poly([[76, 93], [82, 132], [92, 144], [142, 144], [152, 132], [158, 93]], true)
  d.circle(117, 119, 15)
  d.circle(117, 119, 25)
  d.center(117, 119, 30)
  d.line(55, 85, 179, 85, 'center')
  d.rect(55, 54, 179, 69)
  d.line(70, 54, 70, 69)
  d.line(164, 54, 164, 69)
  for (const x of [70, 164]) {
    d.circle(x, 61.5, 5)
    d.center(x, 61.5, 8)
  }
  d.dim(70, 54, 164, 54, 117, 50)
  d.dim(55, 77, 55, 144, 39, 110.5)
  d.text(58, 158, 'FRONT ELEVATION', 3.2)
  d.text(190, 145, 'SHAFT BORE DIA 30', 3)
  d.text(190, 133, '2X DIA 10 MOUNT', 3)
  d.text(190, 121, 'MOUNT PITCH 94', 3)
  d.text(190, 109, 'BASE LENGTH 124', 3)
  d.text(190, 97, 'BASE DEPTH 54', 3)
  d.text(190, 85, 'BOSS / FILLET CONCEPT', 2.8)
}

async function buildOne(design) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `public-${design.id}`, title: design.title, units: 'millimeter' })
  await document.transact(`Compose ${design.title}`, tx => {
    const continuous = document.getTable('linetypes').records.find(record => record.name === 'CONTINUOUS')
    const centerType = tx.upsertTableRecord('linetypes', { id: `${design.id}-center-linetype`, name: 'CENTER',
      payload: { description: 'Long-short center line', pattern: [8, -1, 1, -1] } })
    const specs = {
      sheet: ['SHEET_FRAME', 8, 18], outline: ['PART_OUTLINE', 7, 35], hatch: ['SECTION_HATCH', 8, 13],
      center: ['CENTER_LINES', 3, 13], dimensions: ['DIMENSIONS', 2, 18], notes: ['NOTES', 7, 18],
    }
    const layers = Object.fromEntries(Object.entries(specs).map(([key, [name, color, lineweight]]) =>
      [key, tx.upsertTableRecord('layers', { id: `${design.id}-${key}-layer`, name, payload: {
        color, lineweight, visible: true, plottable: true,
        linetypeId: key === 'center' ? centerType.id : continuous.id,
        linetypeName: key === 'center' ? centerType.name : continuous.name,
      } })]))
    const style = tx.upsertTableRecord('dimensionStyles', { id: `${design.id}-dimension-style`, name: 'KJDRAW-SHOWCASE',
      payload: { textHeight: 3, arrowSize: 2.4, extensionOffset: .8, extensionBeyond: 1.2, decimalPlaces: 0 } })
    const d = tools(tx, layers, style.id, design.id)
    sheet(d, design)
    design.draw(d)
  })
  const layoutId = document.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PLOTSETUP', { layoutId, dxf: { paperWidth: 297, paperHeight: 210, paperUnits: 1,
    plotType: 4, flags: 0, windowMinX: 0, windowMinY: 0, windowMaxX: 297, windowMaxY: 210,
    scaleNumerator: 1, scaleDenominator: 1 } }, { document })
  return { id: design.id, title: design.title, family: design.family, code: design.code,
    parameters: design.parameters, sdk, document, layoutId }
}

export async function buildCuratedMachineComponentDocuments() {
  return Promise.all(designs.map(buildOne))
}

export async function buildCuratedMachineComponents(outputDirectory) {
  const root = resolve(outputDirectory)
  await mkdir(root, { recursive: true })
  const cases = []
  for (const item of await buildCuratedMachineComponentDocuments()) {
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
      dxfSha256: digest(dxf) })
  }
  const manifest = { schemaVersion: 1, synthetic: true, count: cases.length, cases }
  await writeFile(resolve(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await buildCuratedMachineComponents(process.argv[2] ?? 'kjdraw-machine-components'), null, 2)}\n`)
}
