import { KJValidationError } from './errors.js'
import { deepFreeze, type ReadonlyDeep } from './utils.js'

export type KJRoadPoint = readonly [number, number]
export interface KJRoadDesignInput {
  units: 'meter'
  startStation: number
  alignment: readonly KJRoadPoint[]
  profile: readonly { station: number; elevation: number }[]
  /** Offsets increase toward the left when looking along increasing station. */
  sections: readonly { station: number; ground: readonly KJRoadPoint[] }[]
  /** Crossfall is signed outward rise/run on each side; negative values form a crown. */
  pavement: { leftWidth: number; rightWidth: number; leftCrossfall: number; rightCrossfall: number }
  slopes: { cutHtoV: number; fillHtoV: number }
}
export interface KJRoadAlignmentSegment {
  startStation: number; endStation: number; start: KJRoadPoint; end: KJRoadPoint; length: number; tangent: KJRoadPoint
}
export interface KJRoadSectionResult {
  station: number; center: KJRoadPoint; tangent: KJRoadPoint
  designElevation: number; groundCenterElevation: number; longitudinalGrade: number
  ground: KJRoadPoint[]; pavement: KJRoadPoint[]; design: KJRoadPoint[]
  worldDesign: [number, number, number][]
  daylight: { left: { point: KJRoadPoint; mode: 'cut' | 'fill' | 'none' }; right: { point: KJRoadPoint; mode: 'cut' | 'fill' | 'none' } }
  areas: { cut: number; fill: number }
  strips: { fromOffset: number; toOffset: number; cutArea: number; fillArea: number }[]
}
export interface KJRoadDesignResult {
  units: 'meter'; areaUnits: 'square-meter'; volumeUnits: 'cubic-meter'
  startStation: number; endStation: number; length: number
  alignment: KJRoadAlignmentSegment[]
  grades: { fromStation: number; toStation: number; fromElevation: number; toElevation: number; grade: number }[]
  sections: KJRoadSectionResult[]
  volumeMethod: 'average-end-area'
  volumeRange: KJRoadPoint
  intervals: { fromStation: number; toStation: number; length: number; cutVolume: number; fillVolume: number }[]
  totalVolume: { cut: number; fill: number }
  limitations: readonly string[]
}

const fail = (message: string): never => { throw new KJValidationError(`Road design: ${message}`) }
const finite = (value: unknown, label: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) fail(`${label} must be finite within ±1e9`)
}
function record(value: unknown, keys: readonly string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`)
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== 'string' || !keys.includes(key) || !('value' in descriptor) || !descriptor.enumerable) fail(`${label} contains unsupported fields or accessors`)
  }
  for (const key of keys) if (!Object.hasOwn(value as object, key)) fail(`${label} requires ${key}`)
}
function list(value: unknown, min: number, max: number, label: string): void {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} requires ${min}–${max} entries`)
  const array = value as unknown[]
  for (const key of Reflect.ownKeys(array)) {
    if (key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(array, key)!
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= array.length || !('value' in descriptor) || !descriptor.enumerable) fail(`${label} must contain only dense data entries`)
  }
  for (let index = 0; index < array.length; index++) if (!Object.hasOwn(array, index)) fail(`${label} must not be sparse`)
}
const copyPoint = (point: KJRoadPoint): KJRoadPoint => [point[0], point[1]]
function points(value: readonly KJRoadPoint[], label: string): void {
  list(value, 2, 2048, label)
  for (const point of value) { list(point, 2, 2, label); finite(point[0], label); finite(point[1], label) }
}
function increasing(value: number, previous: number, label: string): void {
  if (!(value > previous)) fail(`${label} must be strictly increasing without duplicate or reversed values`)
}
function interpolation(points: readonly KJRoadPoint[], x: number): number {
  if (x < points[0]![0] || x > points.at(-1)![0]) fail('interpolation would extrapolate beyond supplied data')
  let lo = 0, hi = points.length - 1
  while (hi - lo > 1) { const middle = (lo + hi) >>> 1; if (points[middle]![0] <= x) lo = middle; else hi = middle }
  const a = points[lo]!, b = points[hi]!
  if (x === a[0]) return a[1]
  if (x === b[0]) return b[1]
  return a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]))
}

/** Piecewise-linear native engineering calculation, not a road-standard or survey certification.
 * Each side must have one discrete daylight intersection over the supplied outward ground extent.
 * Profile/alignment knots use their outgoing slope/tangent, except at the terminal point.
 * End-area volumes are approximations: https://highways.dot.gov/federal-lands/pddm/dpg/earthwork-design
 * There is no cross-section interpolation, terrain extrapolation, road structure deduction,
 * shrink/swell factor, horizontal/vertical curve, overlap or curvature-volume correction.
 * The supplied pavement surface is also the earthwork comparison surface.
 */
export function computeRoadDesign(input: KJRoadDesignInput): ReadonlyDeep<KJRoadDesignResult> {
  record(input, ['units', 'startStation', 'alignment', 'profile', 'sections', 'pavement', 'slopes'], 'input')
  if (input.units !== 'meter') fail('units must be meter')
  finite(input.startStation, 'startStation')
  points(input.alignment, 'alignment')
  list(input.profile, 2, 2048, 'profile')
  list(input.sections, 2, 2048, 'sections')
  record(input.pavement, ['leftWidth', 'rightWidth', 'leftCrossfall', 'rightCrossfall'], 'pavement')
  record(input.slopes, ['cutHtoV', 'fillHtoV'], 'slopes')
  for (const [key, value] of Object.entries(input.pavement)) finite(value, key)
  for (const [key, value] of Object.entries(input.slopes)) { finite(value, key); if (!(value > 0)) fail(`${key} must be positive`) }
  if (!(input.pavement.leftWidth > 0 && input.pavement.rightWidth > 0)) fail('pavement widths must be positive')
  let groundPoints = 0
  for (const [index, item] of input.profile.entries()) {
    record(item, ['station', 'elevation'], 'profile point'); finite(item.station, 'profile station'); finite(item.elevation, 'profile elevation')
    if (index) increasing(item.station, input.profile[index - 1]!.station, 'profile station')
  }
  for (const [index, section] of input.sections.entries()) {
    record(section, ['station', 'ground'], 'section'); finite(section.station, 'section station'); points(section.ground, 'ground')
    if (index) increasing(section.station, input.sections[index - 1]!.station, 'section station')
    groundPoints += section.ground.length
    if (groundPoints > 131072) fail('ground point-work budget exceeds 131072')
    for (let point = 1; point < section.ground.length; point++) increasing(section.ground[point]![0], section.ground[point - 1]![0], 'ground offsets')
    if (section.ground[0]![0] >= -input.pavement.rightWidth || section.ground.at(-1)![0] <= input.pavement.leftWidth) fail('ground must extend beyond both pavement edges')
  }
  const alignment: KJRoadAlignmentSegment[] = []
  let endStation = input.startStation
  for (let index = 1; index < input.alignment.length; index++) {
    const a = input.alignment[index - 1]!, b = input.alignment[index]!, dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
    if (!(length > 0) || endStation + length === endStation) fail('alignment has duplicate points or unresolvable segment length')
    const segment = { startStation: endStation, endStation: endStation + length, start: copyPoint(a), end: copyPoint(b), length, tangent: [dx / length, dy / length] as KJRoadPoint }
    alignment.push(segment); endStation = segment.endStation
  }
  finite(endStation, 'endStation')
  if (input.profile[0]!.station !== input.startStation || input.profile.at(-1)!.station !== endStation) fail('profile endpoints must cover the exact full alignment station range')
  const grades = input.profile.slice(1).map((point, index) => {
    const before = input.profile[index]!
    return { fromStation: before.station, toStation: point.station, fromElevation: before.elevation, toElevation: point.elevation, grade: (point.elevation - before.elevation) / (point.station - before.station) }
  })
  const profile = input.profile.map(point => [point.station, point.elevation] as KJRoadPoint)
  const sections = input.sections.map(section => {
    const { station, ground } = section
    if (station < input.startStation || station > endStation) fail('section station is outside the alignment')
    const segment = alignment.find(item => station < item.endStation) ?? alignment.at(-1)!
    const grade = grades.find(item => station < item.toStation) ?? grades.at(-1)!
    const distance = station - segment.startStation
    const center: KJRoadPoint = [segment.start[0] + distance * segment.tangent[0], segment.start[1] + distance * segment.tangent[1]]
    const elevation = interpolation(profile, station), { leftWidth, rightWidth, leftCrossfall, rightCrossfall } = input.pavement
    const pavement: KJRoadPoint[] = [[-rightWidth, elevation + rightWidth * rightCrossfall], [0, elevation], [leftWidth, elevation + leftWidth * leftCrossfall]]
    const daylight = (edge: KJRoadPoint, direction: -1 | 1): KJRoadSectionResult['daylight']['left'] => {
      const atEdge = interpolation(ground, edge[0]), difference = atEdge - edge[1]
      if (difference === 0) return { point: copyPoint(edge), mode: 'none' }
      const mode = difference > 0 ? 'cut' : 'fill'
      const outwardGrade = mode === 'cut' ? 1 / input.slopes.cutHtoV : -1 / input.slopes.fillHtoV
      const designZ = (offset: number): number => edge[1] + direction * (offset - edge[0]) * outwardGrade
      const outer = ground.filter(point => direction * (point[0] - edge[0]) > 0)
      if (direction === -1) outer.reverse()
      const samples: KJRoadPoint[] = [[edge[0], atEdge], ...outer]
      const intersections: KJRoadPoint[] = []
      const add = (point: KJRoadPoint): void => {
        if (!intersections.some(existing => existing[0] === point[0])) intersections.push(point)
      }
      for (let index = 1; index < samples.length; index++) {
        const a = samples[index - 1]!, b = samples[index]!, da = a[1] - designZ(a[0]), db = b[1] - designZ(b[0])
        if (da === 0 && db === 0) fail('ambiguous ground: side slope overlaps a terrain segment')
        if (da === 0) add([a[0], a[1]])
        if (db === 0) add([b[0], b[1]])
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const offset = a[0] + (b[0] - a[0]) * (da / (da - db))
          if (offset === a[0] || offset === b[0]) fail('daylight intersection loses numeric precision')
          add([offset, designZ(offset)])
        }
      }
      if (intersections.length !== 1) fail(intersections.length ? 'ambiguous ground: multiple side-slope intersections' : 'side slope has no intersection within supplied ground')
      return { point: intersections[0]!, mode }
    }
    const right = daylight(pavement[0]!, -1), left = daylight(pavement[2]!, 1)
    const design = [right.point, ...pavement, left.point].filter((point, index, all) => !index || point[0] !== all[index - 1]![0])
    const offsets = [...new Set([...design.map(point => point[0]), ...ground.filter(point => point[0] > right.point[0] && point[0] < left.point[0]).map(point => point[0])])].sort((a, b) => a - b)
    // The two endpoints were solved as daylight intersections. Preserve that exact
    // closure instead of integrating a roundoff-sized opposite-sign sliver there.
    const differences = offsets.map((offset, index) => index === 0 || index === offsets.length - 1 ? 0 : interpolation(design, offset) - interpolation(ground, offset))
    const strips: KJRoadSectionResult['strips'] = []
    const addStrip = (from: number, to: number, a: number, b: number): void => {
      const signedArea = (to - from) * (a + b) / 2
      strips.push({ fromOffset: from, toOffset: to, cutArea: Math.max(0, -signedArea), fillArea: Math.max(0, signedArea) })
    }
    for (let index = 1; index < offsets.length; index++) {
      const from = offsets[index - 1]!, to = offsets[index]!, a = differences[index - 1]!, b = differences[index]!
      if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
        const zero = from + (to - from) * (a / (a - b))
        if (zero === from || zero === to) fail('earthwork sign crossing loses numeric precision')
        addStrip(from, zero, a, 0); addStrip(zero, to, 0, b)
      } else addStrip(from, to, a, b)
    }
    return {
      station, center, tangent: copyPoint(segment.tangent), designElevation: elevation, groundCenterElevation: interpolation(ground, 0), longitudinalGrade: grade.grade,
      ground: ground.map(copyPoint), pavement, design, daylight: { left, right },
      worldDesign: design.map(([offset, z]) => [center[0] - segment.tangent[1] * offset, center[1] + segment.tangent[0] * offset, z] as [number, number, number]),
      strips, areas: { cut: strips.reduce((sum, strip) => sum + strip.cutArea, 0), fill: strips.reduce((sum, strip) => sum + strip.fillArea, 0) },
    }
  })
  const intervals = sections.slice(1).map((section, index) => {
    const before = sections[index]!, length = section.station - before.station
    return { fromStation: before.station, toStation: section.station, length, cutVolume: length * (before.areas.cut + section.areas.cut) / 2, fillVolume: length * (before.areas.fill + section.areas.fill) / 2 }
  })
  const result: KJRoadDesignResult = {
    units: 'meter', areaUnits: 'square-meter', volumeUnits: 'cubic-meter', startStation: input.startStation, endStation, length: endStation - input.startStation,
    alignment, grades, sections, volumeMethod: 'average-end-area', volumeRange: [sections[0]!.station, sections.at(-1)!.station], intervals,
    totalVolume: { cut: intervals.reduce((sum, interval) => sum + interval.cutVolume, 0), fill: intervals.reduce((sum, interval) => sum + interval.fillVolume, 0) },
    limitations: ['This calculation does not certify supplied ground survey data.', 'Piecewise-linear alignment and profile; no horizontal or vertical curves.', 'Pavement is the earthwork comparison surface; no pavement thickness, topsoil, shrink or swell adjustments.', 'Average end-area volumes cover supplied section intervals only and do not correct for curvature, overlap, or unknown terrain between sections.', 'No road-standard compliance or construction certification is implied.'],
  }
  const verifyFinite = (value: unknown): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('calculation produced a nonfinite result')
    if (value && typeof value === 'object') for (const item of Object.values(value)) verifyFinite(item)
  }
  verifyFinite(result)
  return deepFreeze(result)
}
