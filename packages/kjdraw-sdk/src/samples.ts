// Original synthetic drawings built only from public KJDraw entities.
// They are intentionally fictional and contain no customer drawing or proprietary template.
import type { KJDrawSDK } from './sdk.js'
import type { KJDocument } from './document.js'
import type { KJCommandArguments, KJEntityBatchSpec } from './commands.js'
import type { KJObjectPayload, KJObjectSpec } from './schema.js'
import { transformEntityPayload } from './geometry/transform.js'
import { compileGeologySection, type KJGeologySectionInput } from './geology-engineering.js'
import { buildAgentGeologyPlan, type KJAgentGeologyPlanInput } from './agent-geology-plan.js'

type Point = [number, number]
export interface KJDrawSample {
  readonly id: string
  readonly title: string
  readonly titleZh: string
  readonly discipline: string
}
interface SampleDefinition extends KJDrawSample {
  units?: string
  modelScale?: number
  layers?: [string, number][]
  build?: (kit: ReturnType<typeof draftingKit>) => void
  buildCompiled?: (sdk: KJDrawSDK, document: KJDocument) => Promise<void>
}
interface SheetOptions {
  x?: number; y?: number; width?: number; height?: number
  title: string; number: string; scale: string; discipline: string
}

function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => omitUndefined(item)) as T
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) result[key] = omitUndefined(child)
    }
    return result as T
  }
  return value
}

const sampleCatalog: SampleDefinition[] = [
  { id: 'sample-site-plan', title: 'Riverside research park / site plan', titleZh: '滨河研发园 / 场地总图', discipline: 'CIVIL', build: buildSitePlan },
  { id: 'sample-architecture', title: 'Innovation hub / ground floor', titleZh: '创新中心 / 首层平面', discipline: 'ARCHITECTURE', build: buildArchitecture },
  { id: 'sample-road-profile', title: 'Hill route C2 / longitudinal profile', titleZh: '山区道路 C2 / 纵断面', discipline: 'TRANSPORTATION', build: buildRoadProfile },
  { id: 'sample-mechanical', title: 'Bearing bracket / manufacturing drawing', titleZh: '轴承支架 / 制造工程图', discipline: 'MECHANICAL', build: buildMechanical },
  { id: 'sample-mechanical-flange', title: 'Six-hole mounting flange / manufacturing drawing', titleZh: '六孔安装法兰 / 制造工程图', discipline: 'MECHANICAL', build: buildMechanicalFlange },
  { id: 'sample-borehole-log', title: 'Loess borehole / engineering log', titleZh: '黄土钻孔 / 工程柱状图', discipline: 'GEOLOGY', build: buildBoreholeLog },
  { id: 'sample-geology-section', title: 'Geological section', titleZh: '剖面图', discipline: 'GEOLOGY', buildCompiled: buildGeologySectionCompiled },
  { id: 'sample-geology-plan', title: 'Investigation points / location plan', titleZh: '勘探点 / 平面位置图', discipline: 'GEOLOGY', units: 'meter', buildCompiled: buildGeologyPlanCompiled },
]

export const INDUSTRY_SAMPLES: readonly KJDrawSample[] = Object.freeze(sampleCatalog.map(({ id, title, titleZh, discipline }) => Object.freeze({ id, title, titleZh, discipline })))

function draftingKit(entities: KJEntityBatchSpec[]) {
  const add = (type: string, payload: KJObjectPayload, layerName: string, options?: KJObjectSpec) => entities.push({ type, layerName, payload: omitUndefined(payload), ...(options === undefined ? {} : { options: omitUndefined(options) }) })
  const line = (start: Point, end: Point, layer: string) => add('LINE', { start, end }, layer)
  const circle = (center: Point, radius: number, layer: string) => add('CIRCLE', { center, radius }, layer)
  const arc = (center: Point, radius: number, startAngle: number, endAngle: number, layer: string) => add('ARC', { center, radius, startAngle, endAngle }, layer)
  const text = (position: Point, value: string, height: number, layer = 'ANNO', rotation = 0) => add('TEXT', { position, text: value, height, rotation }, layer)
  const poly = (points: Point[], layer: string, closed = true) => add('LWPOLYLINE', { vertices: points.map(point => ({ point })), closed }, layer)
  const rect = (x: number, y: number, width: number, height: number, layer: string) => poly([[x, y], [x + width, y], [x + width, y + height], [x, y + height]], layer)
  const cross = (x: number, y: number, radius: number, layer: string) => { line([x - radius, y], [x + radius, y], layer); line([x, y - radius], [x, y + radius], layer) }
  const arrow = (at: Point, direction: Point, size: number, layer: string) => {
    const angle = Math.atan2(direction[1], direction[0]), wing = Math.PI * .82
    line(at, [at[0] + Math.cos(angle + wing) * size, at[1] + Math.sin(angle + wing) * size], layer)
    line(at, [at[0] + Math.cos(angle - wing) * size, at[1] + Math.sin(angle - wing) * size], layer)
  }
  const dimH = (x1: number, x2: number, y: number, offset: number, value: string, layer = 'DIMS') => {
    const dy = offset >= 0 ? 1 : -1, dimensionY = y + offset
    line([x1, y], [x1, dimensionY + dy * 1.5], layer); line([x2, y], [x2, dimensionY + dy * 1.5], layer)
    line([x1, dimensionY], [x2, dimensionY], layer); arrow([x1, dimensionY], [1, 0], 2, layer); arrow([x2, dimensionY], [-1, 0], 2, layer)
    text([(x1 + x2) / 2 - String(value).length * .65, dimensionY + dy * 1.1], String(value), 1.5, layer)
  }
  const dimV = (x: number, y1: number, y2: number, offset: number, value: string, layer = 'DIMS') => {
    const dx = offset >= 0 ? 1 : -1, dimensionX = x + offset
    line([x, y1], [dimensionX + dx * 1.5, y1], layer); line([x, y2], [dimensionX + dx * 1.5, y2], layer)
    line([dimensionX, y1], [dimensionX, y2], layer); arrow([dimensionX, y1], [0, 1], 2, layer); arrow([dimensionX, y2], [0, -1], 2, layer)
    text([dimensionX + dx * 1.1, (y1 + y2) / 2 - String(value).length * .65], String(value), 1.5, layer, Math.PI / 2)
  }
  const sheet = ({ x = -8, y = -12, width = 256, height = 164, title, number, scale, discipline }: SheetOptions) => {
    rect(x, y, width, height, 'FRAME'); rect(x + 3, y + 3, width - 6, height - 6, 'FRAME')
    const blockX = x + width - 112, blockY = y + 3
    rect(blockX, blockY, 109, 18, 'FRAME'); line([blockX + 58, blockY], [blockX + 58, blockY + 18], 'FRAME')
    line([blockX + 82, blockY], [blockX + 82, blockY + 18], 'FRAME'); line([blockX + 58, blockY + 9], [blockX + 109, blockY + 9], 'FRAME')
    text([blockX + 3, blockY + 11], title, 2.25, 'TITLE'); text([blockX + 3, blockY + 5], discipline, 1.35, 'TITLE')
    text([blockX + 61, blockY + 12.5], `SCALE  ${scale}`, 1.15, 'TITLE'); text([blockX + 61, blockY + 4.5], 'REV  A', 1.15, 'TITLE')
    text([blockX + 85, blockY + 12.5], number, 1.2, 'TITLE'); text([blockX + 85, blockY + 4.5], 'SYNTHETIC', .95, 'TITLE')
  }
  return { add, line, circle, arc, text, poly, rect, cross, arrow, dimH, dimV, sheet }
}

async function createDrawing(sdk: KJDrawSDK, sample: SampleDefinition): Promise<KJDocument> {
  let documentId = sample.id
  let copy = 2
  while (sdk.documents.has(documentId)) documentId = `${sample.id}-${copy++}`
  const document = sdk.createDocument({
    documentId,
    title: sample.title,
    units: sample.units ?? 'millimeter',
    tags: ['sample', sample.discipline.toLowerCase()],
    metadata: { synthetic: true, sampleId: sample.id, discipline: sample.discipline, titleZh: sample.titleZh },
  })
  const entities: KJEntityBatchSpec[] = []
  const kit = draftingKit(entities)
  const layers = sample.layers ?? []
  for (const [name, color] of layers) await sdk.executeCommand('LAYERNEW', { name, color }, { document })
  if (sample.buildCompiled) await sample.buildCompiled(sdk, document)
  else {
    sample.build!(kit)
    if (sample.modelScale) {
      const scale = sample.modelScale
      for (const entity of entities) entity.payload = omitUndefined(transformEntityPayload(entity.type, entity.payload, [scale, 0, 0, scale, 0, 0]))
    }
    await sdk.executeCommand('CREATEBATCH', { entities }, { document })
  }
  const baseline = document.toJSON()
  sdk.closeDocument(document.id)
  return sdk.openDocument(baseline)
}

/** Build one editable industry drawing in the supplied SDK. */
export async function createIndustrySample(sdk: KJDrawSDK, id: string): Promise<KJDocument> {
  const sample = sampleCatalog.find(item => item.id === id)
  if (!sample) throw new RangeError(`Unknown KJDraw sample: ${id}`)
  return createDrawing(sdk, sample)
}

/** Build the complete collection of original industry drawings. */
export async function createIndustrySamples(sdk: KJDrawSDK): Promise<KJDocument[]> {
  const drawings: KJDocument[] = []
  for (const sample of sampleCatalog) drawings.push(await createDrawing(sdk, sample))
  return drawings
}

sampleCatalog[0]!.units = 'meter'
sampleCatalog[0]!.layers = [
  ['FRAME', 7], ['BOUNDARY', 1], ['C-TOPO', 8], ['C-ROAD', 7], ['A-BUILD', 4], ['C-UTIL', 5], ['L-PLANT', 3], ['DIMS', 2], ['ANNO', 7], ['TITLE', 7],
]
function buildSitePlan({ line, circle, text, poly, rect, cross, dimH, dimV, sheet }: ReturnType<typeof draftingKit>) {
  sheet({ title: 'RIVERSIDE RESEARCH PARK', number: 'C-101', scale: '1:500', discipline: 'SITE DEVELOPMENT PLAN' })
  poly([[4, 18], [24, 139], [225, 143], [238, 31], [213, 19]], 'BOUNDARY')
  for (let i = 0; i < 17; i++) {
    const y = 25 + i * 6.2
    const points: Point[] = []
    for (let j = 0; j <= 20; j++) points.push([8 + j * 11, y + Math.sin(i * .38 + j * .48) * 2.3])
    poly(points, 'C-TOPO', false); if (i % 4 === 0) text([13, y + 2.8], `${108 + i}.00`, 1.1, 'C-TOPO')
  }
  poly([[16, 33], [48, 37], [84, 39], [121, 44], [161, 54], [220, 55]], 'C-ROAD', false)
  poly([[15, 41], [47, 45], [83, 47], [119, 52], [160, 62], [219, 63]], 'C-ROAD', false)
  for (let i = 0; i < 22; i++) { const x = 20 + i * 9; line([x, 38 + Math.sin(i * .2) * 2], [x + 4, 42 + Math.sin(i * .2) * 2], 'C-ROAD') }
  rect(38, 68, 58, 35, 'A-BUILD'); rect(40, 70, 54, 31, 'A-BUILD'); text([52, 86], 'LAB 01', 3, 'ANNO')
  rect(113, 72, 72, 43, 'A-BUILD'); rect(115, 74, 68, 39, 'A-BUILD'); text([133, 94], 'LAB 02', 3, 'ANNO')
  rect(193, 75, 27, 25, 'A-BUILD'); text([198, 87], 'UTILITY', 1.8, 'ANNO')
  for (const [x, y, label] of [[14, 22, 'CP-01'], [227, 27, 'CP-02'], [219, 136, 'CP-03'], [27, 132, 'CP-04']] as [number, number, string][]) { circle([x, y], 1.2, 'BOUNDARY'); cross(x, y, 2, 'BOUNDARY'); text([x + 2.5, y + 1], label, 1.2, 'ANNO') }
  poly([[10, 58], [42, 59], [99, 63], [148, 68], [207, 69], [230, 74]], 'C-UTIL', false)
  poly([[13, 55], [43, 56], [100, 60], [149, 65], [209, 66], [231, 71]], 'C-UTIL', false)
  text([18, 61], 'DN200 WATER', 1.25, 'C-UTIL')
  for (let i = 0; i < 38; i++) { const x = 20 + (i % 19) * 11, y = i < 19 ? 119 : 127; circle([x, y], 1.5, 'L-PLANT'); circle([x, y], .45, 'L-PLANT'); cross(x, y, 1, 'L-PLANT') }
  dimH(38, 96, 68, -7, '58.00 m'); dimH(113, 185, 72, -7, '72.00 m'); dimV(185, 72, 115, 7, '43.00 m')
  line([229, 112], [229, 134], 'ANNO'); line([229, 134], [226, 128], 'ANNO'); line([229, 134], [232, 128], 'ANNO'); text([227.8, 137], 'N', 2.5, 'ANNO')
  text([9, 146], 'GENERAL NOTES  ·  ALL DIMENSIONS IN METERS  ·  COORDINATE DATUM: LOCAL DEMO GRID', 1.15, 'TITLE')
}

sampleCatalog[1]!.modelScale = 100
sampleCatalog[1]!.layers = [
  ['FRAME', 7], ['A-GRID', 8], ['A-WALL', 7], ['A-COLUMN', 3], ['A-DOOR', 2], ['A-WINDOW', 4], ['A-FURN', 5], ['DIMS', 2], ['ANNO', 7], ['TITLE', 7],
]
function buildArchitecture({ line, circle, arc, text, poly, rect, dimH, dimV, sheet }: ReturnType<typeof draftingKit>) {
  sheet({ title: 'INNOVATION HUB · LEVEL 01', number: 'A-101', scale: '1:100', discipline: 'ARCHITECTURAL FLOOR PLAN' })
  const x0 = 22, y0 = 36, x1 = 220, y1 = 130
  const bayStarts = [22, 55, 88, 121, 154, 187] as const
  for (let i = 0; i < 7; i++) { const x = x0 + i * 33; line([x, y0 - 8], [x, y1 + 8], 'A-GRID'); circle([x, y1 + 11], 2.5, 'A-GRID'); text([x - .8, y1 + 10], String(i + 1), 1.5, 'A-GRID') }
  for (let i = 0; i < 4; i++) { const y = y0 + i * 31.3; line([x0 - 8, y], [x1 + 8, y], 'A-GRID'); circle([x0 - 11, y], 2.5, 'A-GRID'); text([x0 - 11.7, y - .7], String.fromCharCode(65 + i), 1.5, 'A-GRID') }
  rect(x0, y0, x1 - x0, y1 - y0, 'A-WALL'); rect(x0 + 1.8, y0 + 1.8, x1 - x0 - 3.6, y1 - y0 - 3.6, 'A-WALL')
  for (const x of [55, 88, 121, 154, 187]) { line([x, y0 + 2], [x, y1 - 2], 'A-WALL'); line([x + 1.3, y0 + 2], [x + 1.3, y1 - 2], 'A-WALL') }
  const doorOpenings: readonly (readonly [number, number])[] = bayStarts.map((bayStart) => [bayStart + 6, bayStart + 14] as const)
  const horizontalWallWithOpenings = (y: number) => {
    let cursor = x0 + 2
    for (const [start, end] of doorOpenings) {
      line([cursor, y], [start, y], 'A-WALL'); line([cursor, y + 1.3], [start, y + 1.3], 'A-WALL')
      line([start, y], [start, y + 1.3], 'A-WALL'); line([end, y], [end, y + 1.3], 'A-WALL')
      cursor = end
    }
    line([cursor, y], [x1 - 2, y], 'A-WALL'); line([cursor, y + 1.3], [x1 - 2, y + 1.3], 'A-WALL')
  }
  horizontalWallWithOpenings(67); horizontalWallWithOpenings(98)
  for (const x of [22, 55, 88, 121, 154, 187, 220]) for (const y of [36, 67, 98, 130]) rect(x - 1.5, y - 1.5, 3, 3, 'A-COLUMN')
  for (const x of [47, 80, 113, 146, 179, 212]) { line([x, y0], [x + 7, y0], 'A-WINDOW'); line([x, y0 + 1.8], [x + 7, y0 + 1.8], 'A-WINDOW') }
  for (const [start, end] of doorOpenings) {
    const width = end - start
    // Doors on the lower corridor swing into the lower rooms; upper doors swing into the upper rooms.
    line([start, 67], [start, 67 - width], 'A-DOOR'); arc([start, 67], width, -Math.PI / 2, 0, 'A-DOOR')
    line([start, 99.3], [start, 99.3 + width], 'A-DOOR'); arc([start, 99.3], width, 0, Math.PI / 2, 'A-DOOR')
  }
  const lowerRooms = ['RECEPTION', 'MEETING 01', 'STUDIO', 'MAKER LAB', 'CAFE', 'SERVICE'] as const
  const middleRooms = ['PROJECT 01', 'PROJECT 02', 'OPEN OFFICE', 'OPEN OFFICE', 'PROJECT 03', 'PROJECT 04'] as const
  const upperRooms = ['LAB 01', 'LAB 02', 'FOCUS 01', 'FOCUS 02', 'CORE', 'SUPPORT'] as const
  for (let i = 0; i < bayStarts.length; i++) {
    const bayStart = bayStarts[i]!
    text([bayStart + 15, 60.5], lowerRooms[i]!, 1.35, 'ANNO')
    text([bayStart + 10, 93.5], middleRooms[i]!, 1.25, 'ANNO')
    text([bayStart + 12, 124], upperRooms[i]!, 1.25, 'ANNO')
    // Each furniture cluster stays within its own 3300 mm structural bay.
    for (const deskX of [bayStart + 5, bayStart + 18]) for (const deskY of [75.5, 84]) {
      rect(deskX, deskY, 8, 4.2, 'A-FURN'); circle([deskX + 4, deskY - 1.5], .8, 'A-FURN')
    }
    rect(bayStart + 9, 111, 16, 5, 'A-FURN')
    circle([bayStart + 17, 109.4], .9, 'A-FURN'); circle([bayStart + 17, 117.6], .9, 'A-FURN')
  }
  dimH(x0, x1, y0, -10, '19800'); for (let i = 0; i < 6; i++) dimH(x0 + i * 33, x0 + (i + 1) * 33, y1, 9, '3300')
  dimV(x0, y0, y1, -10, '9400'); text([9, 146], 'GROUND FLOOR · MODEL UNITS: MILLIMETERS · ORIGINAL SAMPLE DRAWING', 1.15, 'TITLE')
}

sampleCatalog[2]!.units = 'meter'
sampleCatalog[2]!.layers = [
  ['FRAME', 7], ['C-GRID', 8], ['C-GROUND', 6], ['C-GRADE', 3], ['C-DRAIN', 4], ['C-STRUCT', 2], ['DIMS', 2], ['ANNO', 7], ['TITLE', 7],
]
function buildRoadProfile({ line, circle, text, poly, rect, dimH, sheet }: ReturnType<typeof draftingKit>) {
  sheet({ title: 'HILL ROUTE C2 · LONGITUDINAL PROFILE', number: 'C-301', scale: 'H 1:1000 / V 1:100', discipline: 'ROAD ENGINEERING' })
  const left = 18, right = 232, bottom = 35, top = 132
  rect(left, bottom, right - left, top - bottom, 'C-GRID')
  for (let i = 0; i <= 10; i++) { const x = left + i * (right - left) / 10; line([x, bottom], [x, top], 'C-GRID'); text([x - 2.5, bottom - 5], `${i * 100}`, 1.2, 'ANNO') }
  for (let i = 0; i <= 8; i++) { const y = bottom + i * 10.5; line([left, y], [right, y], 'C-GRID'); text([left - 10, y - .6], `${92 + i * 2}`, 1.15, 'ANNO') }
  const existing: Point[] = [], grade: Point[] = []
  for (let i = 0; i <= 50; i++) { const x = left + i * (right - left) / 50; existing.push([x, 64 + Math.sin(i * .38) * 9 + Math.sin(i * .13) * 7 + i * .42]); grade.push([x, 68 + i * .37 + Math.sin(i * .11) * 2.2]) }
  poly(existing, 'C-GROUND', false); poly(grade, 'C-GRADE', false)
  for (let i = 0; i < grade.length; i += 5) { const point = grade[i]!; line([point[0], bottom], point, 'C-GRADE'); circle(point, 1.1, 'C-GRADE'); text([point[0] - 2.5, point[1] + 3], `PVI ${i * 20}`, 1.05, 'ANNO') }
  for (const [station, y, label] of [[73, 70, 'BOX CULVERT 2.0 × 1.5'], [158, 91, 'PIPE Ø1200'], [205, 105, 'BRIDGE B-02']] as [number, number, string][]) { line([station, bottom], [station, y], 'C-STRUCT'); rect(station - 3, y - 3, 6, 3, 'C-STRUCT'); text([station + 3, y - 1], label, 1.15, 'C-STRUCT') }
  poly([[18, 52], [36, 53], [51, 49], [66, 50], [82, 47], [99, 48]], 'C-DRAIN', false); text([20, 55], 'DRAINAGE INVERT', 1.1, 'C-DRAIN')
  dimH(left, right, bottom, -11, 'CHAINAGE 0+000 — 1+000')
  text([20, 125], 'EXISTING GROUND', 1.4, 'C-GROUND'); line([55, 126], [70, 126], 'C-GROUND')
  text([82, 125], 'DESIGN GRADE', 1.4, 'C-GRADE'); line([112, 126], [127, 126], 'C-GRADE')
  text([9, 146], 'DATUM 90.00 m  ·  DESIGN SPEED 60 km/h  ·  ALL LEVELS ARE SYNTHETIC', 1.15, 'TITLE')
}

sampleCatalog[3]!.layers = [
  ['FRAME', 7], ['M-OBJECT', 7], ['M-HIDDEN', 8], ['M-CENTER', 3], ['M-HATCH', 6], ['DIMS', 2], ['ANNO', 7], ['TITLE', 7],
]
function buildMechanical({ line, circle, arc, text, poly, rect, cross, dimH, dimV, sheet }: ReturnType<typeof draftingKit>) {
  sheet({ title: 'BEARING BRACKET · MACHINING', number: 'M-2047', scale: '1:1', discipline: 'MECHANICAL DETAIL' })
  // Front elevation: base, webs, bearing boss and machined holes.
  poly([[22, 47], [22, 63], [39, 63], [47, 78], [47, 111], [91, 111], [91, 78], [99, 63], [116, 63], [116, 47]], 'M-OBJECT')
  line([22, 47], [116, 47], 'M-OBJECT'); circle([69, 88], 18, 'M-OBJECT'); circle([69, 88], 10, 'M-OBJECT')
  for (const x of [34, 104]) { circle([x, 55], 4, 'M-OBJECT'); cross(x, 55, 7, 'M-CENTER') }
  cross(69, 88, 25, 'M-CENTER'); line([51, 88], [87, 88], 'M-HIDDEN'); line([69, 70], [69, 106], 'M-HIDDEN')
  // Section view with conventional hatch strokes.
  rect(139, 47, 70, 62, 'M-OBJECT'); rect(154, 62, 40, 31, 'M-OBJECT'); circle([174, 77.5], 10, 'M-OBJECT'); cross(174, 77.5, 34, 'M-CENTER')
  for (let x = 141; x < 208; x += 5) { line([x, 49], [Math.min(x + 19, 208), Math.min(68, 49 + 19)], 'M-HATCH'); line([x, 95], [Math.min(x + 12, 208), Math.min(107, 95 + 12)], 'M-HATCH') }
  line([130, 117], [217, 117], 'M-CENTER'); text([163, 112], 'SECTION A—A', 1.8, 'ANNO')
  // Enlarged detail.
  circle([190, 128], 10, 'M-OBJECT'); arc([190, 128], 6, 0, Math.PI * 1.5, 'M-OBJECT'); cross(190, 128, 13, 'M-CENTER'); text([204, 132], 'DETAIL B', 1.5, 'ANNO')
  dimH(22, 116, 47, -9, '94'); dimH(47, 91, 111, 9, '44'); dimV(116, 47, 111, 10, '64')
  line([83, 103], [105, 119], 'DIMS'); text([106, 119], 'Ø36 H7', 1.55, 'DIMS'); line([73, 88], [107, 94], 'DIMS'); text([108, 94], 'Ø20 THRU', 1.35, 'DIMS')
  rect(9, 20, 101, 20, 'FRAME'); line([9, 30], [110, 30], 'FRAME'); line([34, 20], [34, 40], 'FRAME'); line([76, 20], [76, 40], 'FRAME')
  text([12, 34], 'MATERIAL', 1, 'TITLE'); text([12, 25], 'EN-GJS-500-7', 1.25, 'TITLE'); text([38, 34], 'FINISH', 1, 'TITLE'); text([38, 25], 'Ra 3.2 UNLESS NOTED', 1.15, 'TITLE'); text([80, 34], 'TOLERANCE', 1, 'TITLE'); text([80, 25], 'ISO 2768-mK', 1.15, 'TITLE')
  text([9, 146], 'REMOVE BURRS · BREAK SHARP EDGES 0.5 · DIMENSIONS IN MILLIMETERS', 1.15, 'TITLE')
}

sampleCatalog[5]!.units = 'meter'
sampleCatalog[4]!.layers = [
  ['FRAME', 7], ['GEO-DEPTH', 8], ['GEO-ELEV', 3], ['GEO-BOUNDARY', 7], ['GEO-HATCH', 6], ['GEO-WATER', 4], ['DIMS', 2], ['ANNO', 7], ['TITLE', 7],
]
function buildBoreholeLog({ line, text, rect, poly, dimV, sheet }: ReturnType<typeof draftingKit>) {
  sheet({ title: 'LOESS BOREHOLE LOG · ZK01', number: 'G-101', scale: 'V 1:200', discipline: 'ENGINEERING GEOLOGY' })
  const top = 126, bottom = 30, left = 28, right = 92, depthStep = (top - bottom) / 30
  rect(left, bottom, right - left, top - bottom, 'GEO-BOUNDARY')
  line([left + 14, bottom], [left + 14, top], 'GEO-BOUNDARY'); line([left + 28, bottom], [left + 28, top], 'GEO-BOUNDARY'); line([left + 43, bottom], [left + 43, top], 'GEO-BOUNDARY')
  const units = [
    ['FILL', 2, 'GEO-HATCH'], ['MALAN LOESS', 7, 'GEO-HATCH'], ['PALEOSOL', 3, 'GEO-HATCH'], ['LISHI LOESS', 6, 'GEO-HATCH'], ['PALEOSOL', 2, 'GEO-HATCH'], ['SILTY CLAY', 10, 'GEO-HATCH'],
  ] as const
  let cursor = top
  for (const [name, metres] of units) { const height = metres * depthStep; rect(left + 43, cursor - height, 21, height, 'GEO-BOUNDARY'); for (let x = left + 45; x < left + 63; x += 5) for (let y = cursor - 3; y > cursor - height + 2; y -= 5) line([x, y], [x + 3, y - 3], 'GEO-HATCH'); text([left + 45, cursor - height / 2], name, 1.35, 'ANNO'); cursor -= height }
  for (let depth = 0; depth <= 30; depth += 3) { const y = top - depth * depthStep; line([left - 3, y], [right + 4, y], 'GEO-DEPTH'); text([left - 12, y - .5], String(depth), 1.15, 'GEO-DEPTH'); text([right + 7, y - .5], (300 - depth).toFixed(2), 1.1, 'GEO-ELEV') }
  text([left + 2, top + 7], 'DEPTH m', 1.25, 'TITLE'); text([left + 16, top + 7], 'ELEV. m', 1.25, 'TITLE'); text([left + 31, top + 7], 'CODE', 1.25, 'TITLE'); text([left + 46, top + 7], 'LITHOLOGY', 1.25, 'TITLE')
  for (let i = 1; i <= 9; i++) text([left + 2, top - i * 3.33 - 1], String(i), 1, 'ANNO')
  line([left + 43, 33], [left + 64, 33], 'GEO-WATER'); text([left + 66, 33], 'GWL 18.40 m', 1.2, 'GEO-WATER'); dimV(left + 73, top, bottom, 6, '30.00 m'); text([left, 21], 'COLLAR 300.00 m  ·  DEPTH POSITIVE DOWNWARD  ·  SYNTHETIC SAMPLE', 1.15, 'TITLE')
}

sampleCatalog[5]!.units = 'meter'
sampleCatalog[6]!.layers = [
  ['FRAME', 7], ['GEO-GRID', 8], ['GEO-STRATA', 6], ['GEO-WATER', 4], ['GEO-POINTS', 3], ['DIMS', 2], ['ANNO', 7], ['TITLE', 7],
]
async function buildGeologySectionCompiled(sdk: KJDrawSDK, document: KJDocument): Promise<void> {
  const layers = [
    ['1', 'Cultivated soil', 'cultivated-soil'], ['2', 'Loess', 'loess'],
    ['3', 'Paleosol', 'paleosol'], ['4', 'Loess', 'loess'],
    ['5', 'Silty clay', 'silty-clay'],
  ] as const
  const boundaries = [0, 3, 8, 12, 20, 30]
  const holes: KJGeologySectionInput['holes'] = Array.from({ length: 5 }, (_, index) => {
    const id = `ZK${String(index + 1).padStart(2, '0')}`
    return { id, station: index * 25, collarElevation: 300 + [0, 0.35, -0.15, 0.25, -0.3][index]!, depth: 30,
      strata: layers.map(([code, name, lithology], layerIndex) => ({
        intervalId: `${id}-L${layerIndex + 1}`, code, name, lithology,
        top: boundaries[layerIndex]!, bottom: boundaries[layerIndex + 1]!,
      })) }
  })
  const correlations: KJGeologySectionInput['correlations'] = []
  for (let holeIndex = 0; holeIndex < holes.length - 1; holeIndex++) for (let layerIndex = 0; layerIndex < layers.length; layerIndex++)
    correlations.push({ fromHoleId: holes[holeIndex]!.id, toHoleId: holes[holeIndex + 1]!.id,
      fromIntervalId: `${holes[holeIndex]!.id}-L${layerIndex + 1}`,
      toIntervalId: `${holes[holeIndex + 1]!.id}-L${layerIndex + 1}` })
  const compiled = compileGeologySection({ holes, correlations, sourceFactMode: 'illustrative',
    horizontalScaleDenominator: 500, verticalScaleDenominator: 200, datumElevation: 265,
    surfaceRule: 'straight-between-supplied-collars', expectedRevision: document.revision,
    title: 'GEOLOGICAL SECTION A—A′ · ILLUSTRATIVE, NOT MEASURED' })
  await sdk.executeCommand('CREATEBATCH', structuredClone(compiled.commandArgs) as KJCommandArguments, { document })
}

async function buildGeologyPlanCompiled(sdk: KJDrawSDK, document: KJDocument): Promise<void> {
  const ids = Array.from({ length: 5 }, (_, index) => `ZK${String(index + 1).padStart(2, '0')}`)
  const input: KJAgentGeologyPlanInput = {
    version: '1.0.0', expectedRevision: document.revision, units: 'meter', locale: 'en',
    drawingId: 'SYNTHETIC-INVESTIGATION-PLAN', title: 'INVESTIGATION POINT PLAN · ILLUSTRATIVE, NOT MEASURED',
    scale: 500, boundary: [[980, 980], [1120, 980], [1120, 1020], [980, 1020]],
    boreholes: ids.map((id, index) => ({ id, position: [1000 + index * 25, 1000],
      collarElevation: 300 + [0, 0.35, -0.15, 0.25, -0.3][index]!, depth: 30, kind: 'borehole' })),
    sectionLines: [{ id: 'SECTION-A', holeIds: ids, label: 'A—A′', endpointLabels: ['A', 'A′'] }],
    coordinateGrid: { origin: [980, 980], spacing: 20 }, northAngleDegrees: 0,
  }
  const compiled = buildAgentGeologyPlan(document, input)
  await sdk.executeCommand('CREATEBATCH', structuredClone(compiled.commandArgs) as KJCommandArguments, { document })
}
sampleCatalog[4]!.layers = [
  ['FRAME', 7], ['M-OBJECT', 7], ['M-CENTER', 3], ['M-HIDDEN', 8], ['DIMS', 2], ['ANNO', 7], ['TITLE', 7],
]
function buildMechanicalFlange({ line, circle, text, rect, cross, dimH, dimV, sheet }: ReturnType<typeof draftingKit>) {
  sheet({ width: 350, height: 230, title: 'SIX-HOLE MOUNTING FLANGE', number: 'M-2050', scale: '1:1', discipline: 'MECHANICAL DETAIL' })
  const cx = 92, cy = 109, outerRadius = 60, boreRadius = 20, pitchRadius = 45, holeRadius = 5
  circle([cx, cy], outerRadius, 'M-OBJECT')
  circle([cx, cy], boreRadius, 'M-OBJECT')
  circle([cx, cy], pitchRadius, 'M-CENTER')
  cross(cx, cy, outerRadius + 3, 'M-CENTER')
  for (let index = 0; index < 6; index++) {
    const angle = index * Math.PI / 3
    const x = cx + Math.cos(angle) * pitchRadius, y = cy + Math.sin(angle) * pitchRadius
    circle([x, y], holeRadius, 'M-OBJECT')
    cross(x, y, holeRadius + 2, 'M-CENTER')
  }
  text([cx - 22, 40], 'FRONT / FACE VIEW', 1.6, 'ANNO')
  dimH(cx - outerRadius, cx + outerRadius, cy, -78, 'Ø120')
  text([cx - 20, cy + 70], '6 × Ø10 THRU  ·  PCD Ø90', 1.55, 'DIMS')
  line([cx + boreRadius * .7, cy + boreRadius * .7], [cx + 31, cy + 32], 'DIMS')
  text([cx + 32, cy + 32], 'Ø40 BORE', 1.4, 'DIMS')

  // True 1:1 longitudinal section: 120 mm outside, 40 mm through bore and 20 mm axial thickness.
  const sectionLeft = 222, sectionRight = 242, bottom = cy - outerRadius, top = cy + outerRadius
  rect(sectionLeft, bottom, sectionRight - sectionLeft, top - bottom, 'M-OBJECT')
  line([sectionLeft, cy - boreRadius], [sectionRight, cy - boreRadius], 'M-OBJECT')
  line([sectionLeft, cy + boreRadius], [sectionRight, cy + boreRadius], 'M-OBJECT')
  line([sectionLeft - 10, cy], [sectionRight + 10, cy], 'M-CENTER')
  for (let index = 0; index < 8; index++) {
    const offset = index * 4
    line([sectionLeft + 2, bottom + 3 + offset], [sectionLeft + 7, bottom + 8 + offset], 'M-HIDDEN')
    line([sectionLeft + 2, cy + boreRadius + 3 + offset], [sectionLeft + 7, cy + boreRadius + 8 + offset], 'M-HIDDEN')
  }
  dimH(sectionLeft, sectionRight, bottom, -13, '20')
  dimV(sectionRight, bottom, top, 17, 'Ø120')
  text([sectionLeft - 8, 32], 'SECTION B—B  ·  1:1', 1.55, 'ANNO')
  text([11, 195], 'C45 STEEL  ·  SIX Ø10 THRU HOLES ON Ø90 PCD  ·  BREAK SHARP EDGES', 1.2, 'TITLE')
}