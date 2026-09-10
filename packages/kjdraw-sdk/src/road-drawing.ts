import { computeRoadDesign, type KJRoadDesignInput, type KJRoadDesignResult, type KJRoadPoint } from './road-design.js'
import { KJValidationError } from './errors.js'
import { deepFreeze, type ReadonlyDeep } from './utils.js'
import type { KJObjectPayload } from './schema.js'

export type KJRoadDrawingBounds = [number, number, number, number]
export interface KJRoadDrawingOptions {
  drawingId: string
  title: string
  /** Drawing XY units per physical metre. These are diagram transformations, not paper scales. */
  profileScale: { horizontal: number; vertical: number }
  sectionScale: { horizontal: number; vertical: number }
  /** Lower-left corner of the profile frame; never translates the true-XY plan. */
  origin?: KJRoadPoint
  textHeight?: number
  sectionColumns?: number
  precision?: number
  maxEntities?: number
}
export interface KJRoadDrawingEntity {
  key: string
  type: 'LINE' | 'LWPOLYLINE' | 'TEXT'
  payload: KJObjectPayload
  options: { id: string }
}
export interface KJRoadDrawingResult {
  units: 'meter'
  calculation: ReadonlyDeep<KJRoadDesignResult>
  entities: KJRoadDrawingEntity[]
  resources: {
    linetypes: { id: string; name: string; pattern: number[] }[]
    layers: { id: string; name: string; color: number; linetypeId: string; lineweight: number }[]
  }
  frames: { key: 'plan' | 'profile-tables' | 'sections'; bounds: KJRoadDrawingBounds }[]
  bounds: KJRoadDrawingBounds
  projections: {
    plan: { coordinateSystem: 'native-world-XY'; horizontal: 1; vertical: 1 }
    profile: { horizontal: number; vertical: number; stationDatum: number; elevationDatum: number; origin: KJRoadPoint }
    sections: { station: number; horizontal: number; vertical: number; offsetDatum: number; elevationDatum: number; origin: KJRoadPoint }[]
  }
  /** Stable keys support host-managed comparisons; this function does not mutate or associate a document. */
  limitations: readonly string[]
}

const fail = (message: string): never => { throw new KJValidationError(`Road drawing: ${message}`) }
function object(value: unknown, required: string[], optional: string[] = []): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('options must be plain data')
  for (const key of Reflect.ownKeys(value as object)) {
    const d = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== 'string' || ![...required, ...optional].includes(key) || !('value' in d) || !d.enumerable) fail('unsupported fields or accessors')
  }
  if (required.some(key => !Object.hasOwn(value as object, key))) fail('required options missing')
}
const positive = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1e-6 || value > 1e6) fail(`${label} must be finite in [1e-6, 1e6]`)
  return value as number
}
const intersects = (a: KJRoadDrawingBounds, b: KJRoadDrawingBounds): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
const xyz = (x: number, y: number): [number, number, number] => [x, y, 0]

/** Compile computed road engineering data into three editable model-space drawing frames.
 * The plan uses the supplied world XY unchanged. Longitudinal/cross-section diagrams use
 * explicit, labelled projections; their stretched lengths must not be read as native dimensions.
 * Ground lines and quantities derive only from computeRoadDesign, with no terrain invention.
 * Resources and IDs are deterministic for a drawingId. A host must reconcile existing IDs on
 * subsequent builds; replaying CREATEBATCH is not an associative-update mechanism.
 */
export function buildRoadDrawing(input: KJRoadDesignInput, options: KJRoadDrawingOptions): ReadonlyDeep<KJRoadDrawingResult> {
  object(options, ['drawingId', 'title', 'profileScale', 'sectionScale'], ['origin', 'textHeight', 'sectionColumns', 'precision', 'maxEntities'])
  if (typeof options.drawingId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(options.drawingId)) fail('drawingId requires 1–64 ASCII letters, digits, underscores or hyphens')
  if (typeof options.title !== 'string' || !options.title.trim() || options.title.length > 120 || /[\u0000-\u001f\u007f]/.test(options.title)) fail('title requires bounded single-line text')
  for (const scale of [options.profileScale, options.sectionScale]) { object(scale, ['horizontal', 'vertical']); positive(scale.horizontal, 'horizontal scale'); positive(scale.vertical, 'vertical scale') }
  const t = positive(options.textHeight ?? 2, 'textHeight'), columns = options.sectionColumns ?? 3, precision = options.precision ?? 3, maxEntities = options.maxEntities ?? 100000
  if (!Number.isSafeInteger(columns) || columns < 1 || columns > 8 || !Number.isSafeInteger(precision) || precision < 0 || precision > 6 || !Number.isSafeInteger(maxEntities) || maxEntities < 1 || maxEntities > 100000) fail('columns, precision or entity budget outside limits')
  if (options.origin) {
    if (!Array.isArray(options.origin) || options.origin.length !== 2) fail('origin requires an XY tuple')
    for (let i = 0; i < 2; i++) {
      const d = Object.getOwnPropertyDescriptor(options.origin, String(i))
      if (!d || !('value' in d) || typeof d.value !== 'number' || !Number.isFinite(d.value) || Math.abs(d.value) > 1e9) fail('origin requires finite data coordinates within ±1e9')
    }
  }
  const calculation = computeRoadDesign(input), n = calculation.sections.length
  // Coordinate work remains bounded before layout. Entity count is determined exactly by
  // lightweight deferred primitives, including wrapped notes and nonempty table cells;
  // native payloads/IDs are allocated only after every primitive and frame passes preflight.
  const pointWork = calculation.sections.reduce((sum, s) => sum + s.ground.length + 2 * s.design.length + 16, 0) + input.alignment.length + input.profile.length + calculation.alignment.length * 4 + 64
  if (pointWork > 262144) fail('point-work budget exceeds 262144')
  const entities: KJRoadDrawingEntity[] = [], pending: { key: string; type: KJRoadDrawingEntity['type']; payload: () => KJObjectPayload; layer: string }[] = []
  const prefix = `road:${options.drawingId}`, pad = 6 * t, gap = 10 * t
  const formats = (value: number): string => (Math.abs(value) < .5 * 10 ** -precision ? 0 : value).toFixed(precision)
  const sid = (station: number): string => String(Object.is(station, -0) ? 0 : station)
  const resources: KJRoadDrawingResult['resources'] = {
    linetypes: [{ id: `${prefix}:linetype:continuous`, name: `${options.drawingId}_ROAD_CONTINUOUS`, pattern: [] }, { id: `${prefix}:linetype:ground`, name: `${options.drawingId}_ROAD_GROUND`, pattern: [3, -1] }],
    layers: ['DESIGN', 'GROUND', 'AXIS', 'ANNOTATION', 'FRAME', 'TABLE'].map((name, i) => ({ id: `${prefix}:layer:${name}`, name: `${options.drawingId}_ROAD_${name}`, color: [3, 8, 4, 7, 7, 7][i]!, linetypeId: `${prefix}:linetype:${name === 'GROUND' ? 'ground' : 'continuous'}`, lineweight: name === 'DESIGN' ? 35 : name === 'FRAME' ? 25 : 18 })),
  }
  const add = (key: string, type: KJRoadDrawingEntity['type'], payload: () => KJObjectPayload, layer = 'ANNOTATION'): void => {
    if (pending.length >= maxEntities) fail('exact entity count exceeds maxEntities')
    pending.push({ key, type, payload, layer })
  }
  const checkXY = (point: readonly number[]): void => { if (!point.slice(0, 2).every(n => Number.isFinite(n) && Math.abs(n) <= 1e12)) fail('projected output exceeds finite coordinate budget') }
  const poly = (key: string, points: readonly (readonly number[])[], layer = 'DESIGN', closed = false): void => {
    points.forEach(checkXY)
    for (let i = 1; i < points.length; i++) if (points[i]![0] === points[i - 1]![0] && points[i]![1] === points[i - 1]![1]) fail('projected polyline loses numeric resolution')
    add(key, 'LWPOLYLINE', () => ({ vertices: points.map(point => xyz(point[0]!, point[1]!)), closed }), layer)
  }
  const line = (key: string, a: KJRoadPoint, b: KJRoadPoint, layer = 'AXIS'): void => {
    checkXY(a); checkXY(b)
    if (a[0] === b[0] && a[1] === b[1]) fail('projected line loses numeric resolution')
    add(key, 'LINE', () => ({ start: xyz(...a), end: xyz(...b) }), layer)
  }
  const text = (key: string, value: string, x: number, y: number, height = t): void => {
    checkXY([x, y])
    add(key, 'TEXT', () => ({ text: value, position: xyz(x, y), height, rotation: 0 }))
  }
  const frame = (key: string, b: KJRoadDrawingBounds, title: string): void => {
    poly(`${key}/frame`, [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], 'FRAME', true)
    text(`${key}/title`, `${options.title} | ${title}`, b[0] + pad, b[3] - 3 * t, 1.3 * t)
  }
  const wrap = (value: string, width: number): string[] => {
    const limit = Math.max(12, Math.floor(width / (1.2 * t))), lines: string[] = []
    let current = ''
    for (const word of value.split(/\s+/)) {
      if (current && current.length + word.length + 1 > limit) { lines.push(current); current = '' }
      current += (current ? ' ' : '') + word
    }
    if (current) lines.push(current)
    return lines
  }
  const titleWidth = (options.title.length + 32) * 1.6 * t + 2 * pad
  const edgeSegments = calculation.alignment.flatMap((segment, i) => {
    const pavement = calculation.sections[0]!.pavement
    return [['right', pavement[0]![0]], ['left', pavement.at(-1)![0]]].map(([side, offset]) => ({ key: `plan/span/${i}/${side}-pavement-edge`, points: [segment.start, segment.end].map(p => [p[0] - segment.tangent[1] * Number(offset), p[1] + segment.tangent[0] * Number(offset)] as KJRoadPoint) }))
  })
  const worldPoints = [...input.alignment, ...edgeSegments.flatMap(edge => edge.points), ...calculation.sections.flatMap(section => section.worldDesign.map(p => [p[0], p[1]] as KJRoadPoint))]
  const minX = Math.min(...worldPoints.map(p => p[0])), maxX = Math.max(...worldPoints.map(p => p[0])), minY = Math.min(...worldPoints.map(p => p[1])), maxY = Math.max(...worldPoints.map(p => p[1]))
  const planBounds: KJRoadDrawingBounds = [minX - pad, minY - 12 * t, Math.max(maxX + 24 * t, minX - pad + Math.max(titleWidth, 110 * t)), maxY + 12 * t]
  frame('plan', planBounds, 'PLAN / MODEL XY 1:1')
  poly('plan/alignment', input.alignment, 'AXIS')
  for (const edge of edgeSegments) line(edge.key, edge.points[0]!, edge.points[1]!, 'DESIGN')
  for (const section of calculation.sections) {
    const key = `station/${sid(section.station)}`
    poly(`plan/${key}/section`, section.worldDesign, 'DESIGN')
    text(`plan/${key}/label`, `STA ${formats(section.station)}`, section.center[0] + t, section.center[1] + 2 * t)
  }
  text('plan/disclaimer', 'True XY plan; section lines are sampled locations, not a terrain model.', planBounds[0] + pad, planBounds[1] + 3 * t)
  text('plan/edge-limit', 'Pavement edges follow straight spans; no bend transition design is supplied.', planBounds[0] + pad, planBounds[1] + 5 * t)

  const profileRows = calculation.sections.map(s => ({ key: sid(s.station), cells: [formats(s.station), formats(s.designElevation), formats(s.groundCenterElevation), formats(s.longitudinalGrade * 100), formats(s.areas.cut), formats(s.areas.fill)] }))
  const quantityRows = calculation.intervals.map(i => ({ key: `${sid(i.fromStation)}-${sid(i.toStation)}`, cells: [formats(i.fromStation), formats(i.toStation), formats(i.length), formats(i.cutVolume), formats(i.fillVolume)] }))
  quantityRows.push({ key: 'total', cells: ['TOTAL', '', '', formats(calculation.totalVolume.cut), formats(calculation.totalVolume.fill)] })
  const tableColumns = (headers: string[], rows: { cells: string[] }[]): number[] => headers.map((header, i) => (Math.max(header.length, ...rows.map(row => row.cells[i]!.length)) * 1.2 + 2) * t)
  const profileHeaders = ['Station m', 'Design Z m', 'Ground Z m', 'Grade %', 'Cut m2', 'Fill m2'], quantityHeaders = ['From m', 'To m', 'Length m', 'Cut m3', 'Fill m3']
  const widths1 = tableColumns(profileHeaders, profileRows), widths2 = tableColumns(quantityHeaders, quantityRows)
  const elevations = [...input.profile.map(p => p.elevation), ...calculation.sections.map(s => s.groundCenterElevation)], datum = Math.min(...elevations), elevationMax = Math.max(...elevations)
  const ph = options.profileScale.horizontal, pv = options.profileScale.vertical, graphHeight = Math.max(12 * t, (elevationMax - datum) * pv + 4 * t)
  const profileScaleLabel = `H ${ph} / V ${pv} units per m; datum Z ${formats(datum)} m`
  const profileWidth = Math.max(titleWidth, profileScaleLabel.length * 1.2 * t + 2 * pad, calculation.length * ph + 2 * pad + 10 * t, widths1.reduce((a, b) => a + b, 0) + 2 * pad, widths2.reduce((a, b) => a + b, 0) + 2 * pad)
  const notices = [`Diagram coordinates only: H=${ph} and V=${pv} drawing units per m; vertical exaggeration=${formats(pv / ph)}. Not native distance dimensions.`, `Tables rounded to ${precision} decimals; quantities use unrounded calculation. Average-end-area volume range ${formats(calculation.volumeRange[0])} to ${formats(calculation.volumeRange[1])} m.`, ...calculation.limitations]
  const noteLines = notices.flatMap(value => wrap(value, profileWidth - 2 * pad)), rowHeight = 3 * t
  const profileHeight = graphHeight + (profileRows.length + quantityRows.length + 2) * rowHeight + noteLines.length * 2 * t + 32 * t
  const profileCorner = options.origin ?? [planBounds[2] + gap, planBounds[1]]
  const profileBounds: KJRoadDrawingBounds = [profileCorner[0], profileCorner[1], profileCorner[0] + profileWidth, profileCorner[1] + profileHeight]
  if (intersects(planBounds, profileBounds)) fail('diagram origin makes profile and native plan frames overlap')
  frame('profile', profileBounds, 'PROFILE / DATA / EARTHWORK')
  const profileOrigin: KJRoadPoint = [profileBounds[0] + pad + 10 * t, profileBounds[3] - 8 * t - graphHeight]
  const plotProfile = (station: number, elevation: number): KJRoadPoint => [profileOrigin[0] + (station - calculation.startStation) * ph, profileOrigin[1] + (elevation - datum) * pv]
  line('profile/datum-axis', profileOrigin, [profileOrigin[0] + calculation.length * ph, profileOrigin[1]])
  const legend = (key: string, x: number, y: number): void => {
    line(`${key}/design-sample`, [x, y], [x + 4 * t, y], 'DESIGN')
    text(`${key}/design-label`, 'Design', x + 5 * t, y - .4 * t)
    line(`${key}/ground-sample`, [x + 17 * t, y], [x + 21 * t, y], 'GROUND')
    text(`${key}/ground-label`, 'Supplied ground', x + 22 * t, y - .4 * t)
  }
  legend('profile/legend', profileBounds[0] + pad, profileBounds[3] - 6 * t)
  const profileTickTop = datum + Math.max(elevationMax - datum, 6 * t / pv)
  // Seven station positions and five elevation positions keep labels readable without
  // pretending that the diagram's stretched coordinates are native distance dimensions.
  const stationIntervals = Math.max(1, Math.min(6, Math.floor(calculation.length * ph / (14 * t))))
  for (let i = 0; i <= stationIntervals; i++) {
    const station = calculation.startStation + calculation.length * i / stationIntervals, location = plotProfile(station, datum), label = formats(station)
    line(`profile/station-tick/${i}/grid`, location, plotProfile(station, profileTickTop))
    text(`profile/station-tick/${i}/value`, label, location[0] - label.length * .6 * t, location[1] - 2 * t)
  }
  const elevationIntervals = Math.max(1, Math.min(4, Math.floor((profileTickTop - datum) * pv / (3 * t))))
  for (let i = 0; i <= elevationIntervals; i++) {
    const elevation = datum + (profileTickTop - datum) * i / elevationIntervals, location = plotProfile(calculation.startStation, elevation)
    if (i) line(`profile/elevation-tick/${i}/grid`, location, plotProfile(calculation.endStation, elevation))
    text(`profile/elevation-tick/${i}/value`, formats(elevation), profileBounds[0] + pad, location[1] - .4 * t)
  }
  // Draw measured curves after their coordinate grid so a datum grid cannot hide flat ground.
  poly('profile/ground', calculation.sections.map(s => plotProfile(s.station, s.groundCenterElevation)), 'GROUND')
  poly('profile/design', input.profile.map(p => plotProfile(p.station, p.elevation)))
  text('profile/scale', profileScaleLabel, profileBounds[0] + pad, profileOrigin[1] - 5 * t)
  const table = (key: string, headers: string[], rows: { key: string; cells: string[] }[], widths: number[], top: number): number => {
    const x = profileBounds[0] + pad, w = widths.reduce((a, b) => a + b, 0), bottom = top - (rows.length + 1) * rowHeight
    let offset = x
    for (let c = 0; c <= widths.length; c++) {
      line(`${key}/column/${c}`, [offset, top], [offset, bottom], 'TABLE')
      if (c < widths.length) { text(`${key}/header/${c}`, headers[c]!, offset + t, top - 2 * t); offset += widths[c]! }
    }
    line(`${key}/top`, [x, top], [x + w, top], 'TABLE')
    line(`${key}/header-bottom`, [x, top - rowHeight], [x + w, top - rowHeight], 'TABLE')
    rows.forEach((row, r) => {
      let left = x
      row.cells.forEach((value, c) => { if (value) text(`${key}/row/${row.key}/cell/${c}`, value, left + t, top - (r + 1) * rowHeight - 2 * t); left += widths[c]! })
      line(`${key}/row/${row.key}/bottom`, [x, top - (r + 2) * rowHeight], [x + w, top - (r + 2) * rowHeight], 'TABLE')
    })
    return bottom
  }
  let tableBottom = table('profile/station-table', profileHeaders, profileRows, widths1, profileOrigin[1] - 8 * t)
  tableBottom = table('profile/volume-table', quantityHeaders, quantityRows, widths2, tableBottom - 4 * t)
  noteLines.forEach((value, i) => text(`profile/note/${i}`, value, profileBounds[0] + pad, tableBottom - (i + 2) * 2 * t))

  const sh = options.sectionScale.horizontal, sv = options.sectionScale.vertical
  const offsetMin = Math.min(...calculation.sections.map(s => s.ground[0]![0])), offsetMax = Math.max(...calculation.sections.map(s => s.ground.at(-1)![0]))
  const sectionRanges = calculation.sections.map(s => { const z = [...s.ground, ...s.design].map(p => p[1]); return { min: Math.min(...z), max: Math.max(...z) } })
  const sectionLabelWidth = Math.max(...calculation.sections.flatMap((s, i) => [
    `STA ${formats(s.station)} | Z ${formats(s.designElevation)} m`, `Cut ${formats(s.areas.cut)} m2 | Fill ${formats(s.areas.fill)} m2`,
    `H ${sh} / V ${sv}; datum Z ${formats(sectionRanges[i]!.min)} m`, `Offset m: ${formats(offsetMin)} to ${formats(offsetMax)}; positive LEFT`,
    `L width ${formats(s.pavement.at(-1)![0])} m; outward crossfall ${formats((s.pavement.at(-1)![1] - s.designElevation) / s.pavement.at(-1)![0] * 100)}%`,
    `R width ${formats(-s.pavement[0]![0])} m; outward crossfall ${formats((s.pavement[0]![1] - s.designElevation) / -s.pavement[0]![0] * 100)}%`,
  ]).map(value => value.length * 1.2 * t))
  const cellWidth = Math.max(sectionLabelWidth + 2 * t, (offsetMax - offsetMin) * sh + 16 * t), cellHeight = Math.max(18 * t, Math.max(...sectionRanges.map(r => r.max - r.min)) * sv + 16 * t)
  const usedColumns = Math.min(columns, n), rows = Math.ceil(n / usedColumns)
  const sectionBounds: KJRoadDrawingBounds = [profileBounds[2] + gap, profileBounds[1], profileBounds[2] + gap + Math.max(titleWidth, usedColumns * cellWidth + (usedColumns - 1) * gap + 2 * pad), profileBounds[1] + rows * cellHeight + (rows - 1) * gap + 12 * t]
  frame('sections', sectionBounds, 'CROSS SECTIONS / DIAGRAMS')
  legend('sections/legend', sectionBounds[0] + pad, sectionBounds[3] - 5 * t)
  const projections: KJRoadDrawingResult['projections'] = { plan: { coordinateSystem: 'native-world-XY', horizontal: 1, vertical: 1 }, profile: { horizontal: ph, vertical: pv, stationDatum: calculation.startStation, elevationDatum: datum, origin: profileOrigin }, sections: [] }
  calculation.sections.forEach((section, i) => {
    const col = i % usedColumns, row = Math.floor(i / usedColumns), cellX = sectionBounds[0] + pad + col * (cellWidth + gap), cellTop = sectionBounds[3] - 7 * t - row * (cellHeight + gap)
    const origin: KJRoadPoint = [cellX + 12 * t, cellTop - cellHeight + 6 * t], elevationDatum = sectionRanges[i]!.min, key = `sections/station/${sid(section.station)}`
    const project = (p: KJRoadPoint): KJRoadPoint => [origin[0] + (p[0] - offsetMin) * sh, origin[1] + (p[1] - elevationDatum) * sv]
    text(`${key}/title`, `STA ${formats(section.station)} | Z ${formats(section.designElevation)} m`, cellX, cellTop)
    text(`${key}/areas`, `Cut ${formats(section.areas.cut)} m2 | Fill ${formats(section.areas.fill)} m2`, cellX, cellTop - 2 * t)
    const right = section.pavement[0]!, left = section.pavement.at(-1)!
    text(`${key}/left-width-crossfall`, `L width ${formats(left[0])} m; outward crossfall ${formats((left[1] - section.designElevation) / left[0] * 100)}%`, cellX, cellTop - 4 * t)
    text(`${key}/right-width-crossfall`, `R width ${formats(-right[0])} m; outward crossfall ${formats((right[1] - section.designElevation) / -right[0] * 100)}%`, cellX, cellTop - 6 * t)
    line(`${key}/axis`, project([0, elevationDatum - t / sv]), project([0, sectionRanges[i]!.max + t / sv]), 'AXIS')
    line(`${key}/offset-axis`, project([offsetMin, elevationDatum]), project([offsetMax, elevationDatum]))
    const upperElevation = elevationDatum + Math.max(sectionRanges[i]!.max - elevationDatum, 2 * t / sv)
    line(`${key}/elevation-upper-grid`, project([offsetMin, upperElevation]), project([offsetMax, upperElevation]))
    text(`${key}/elevation-lower-value`, formats(elevationDatum), cellX, origin[1] - .4 * t)
    text(`${key}/elevation-upper-value`, formats(upperElevation), cellX, project([0, upperElevation])[1] - .4 * t)
    for (const [name, offset] of [['right', offsetMin], ['center', 0], ['left', offsetMax]] as const) {
      const location = project([offset, elevationDatum]), label = formats(offset)
      text(`${key}/offset-${name}-value`, label, location[0] - label.length * .6 * t, location[1] - 2 * t)
    }
    poly(`${key}/ground`, section.ground.map(project), 'GROUND')
    poly(`${key}/design`, section.design.map(project))
    text(`${key}/scale`, `H ${sh} / V ${sv}; datum Z ${formats(elevationDatum)} m`, cellX, origin[1] - 4 * t)
    text(`${key}/offsets`, `Offset m: ${formats(offsetMin)} to ${formats(offsetMax)}; positive LEFT`, cellX, origin[1] - 6 * t)
    projections.sections.push({ station: section.station, horizontal: sh, vertical: sv, offsetDatum: offsetMin, elevationDatum, origin })
  })
  const frames: KJRoadDrawingResult['frames'] = [{ key: 'plan', bounds: planBounds }, { key: 'profile-tables', bounds: profileBounds }, { key: 'sections', bounds: sectionBounds }]
  if (frames.some((a, i) => frames.some((b, j) => i < j && intersects(a.bounds, b.bounds)))) fail('drawing frames overlap')
  const bounds: KJRoadDrawingBounds = [Math.min(...frames.map(f => f.bounds[0])), Math.min(...frames.map(f => f.bounds[1])), Math.max(...frames.map(f => f.bounds[2])), Math.max(...frames.map(f => f.bounds[3]))]
  const verify = (value: unknown): void => {
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e12)) fail('projected output exceeds finite coordinate budget')
    if (value && typeof value === 'object') for (const item of Object.values(value)) verify(item)
  }
  verify(bounds)
  for (const item of pending) entities.push({ key: item.key, type: item.type, payload: { ...item.payload(), layerId: `${prefix}:layer:${item.layer}` }, options: { id: `${prefix}:${item.key}` } })
  verify(entities)
  return deepFreeze({ units: 'meter', calculation, entities, resources, frames, bounds, projections, limitations: [...calculation.limitations, 'Three model-space drawing frames, not paper-space sheets or a certified construction document.', 'Profile and cross sections use explicitly stretched diagram coordinates; do not measure them as world geometry.', 'Stable keys allow host-managed revision comparisons; automatic associative update is not implemented.', 'Ground profile connects supplied section center elevations only; no surveyed terrain between sections is inferred.'] })
}
