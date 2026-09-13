import { KJValidationError } from './errors.js'
import { stableHash } from './utils.js'

export const KJDRAW_SITE_PLAN_VERSION = '1.0.0' as const

export type KJAgentSiteUtilityKind = 'water' | 'drainage' | 'power' | 'gas' | 'telecom'

export interface KJAgentSiteRoad {
  name: string
  width: number
  centerline: [number, number][]
}

export interface KJAgentSiteBuilding {
  name: string
  floors?: number
  footprint: [number, number][]
}

export interface KJAgentSiteUtility {
  kind: KJAgentSiteUtilityKind
  name: string
  path: [number, number][]
  diameterMm?: number
  nodeIndices?: number[]
}

export interface KJAgentSiteCoordinateReference {
  position: [number, number]
  easting: number
  northing: number
  crs: string
}

export interface KJAgentSitePlanInput {
  version: typeof KJDRAW_SITE_PLAN_VERSION
  expectedRevision: number
  units: 'meter'
  drawingId: string
  title: string
  revision: string
  boundary: [number, number][]
  roads: KJAgentSiteRoad[]
  buildings: KJAgentSiteBuilding[]
  utilities: KJAgentSiteUtility[]
  coordinateReference: KJAgentSiteCoordinateReference
  northAngleDegrees?: number
  scale: 500
}

interface SitePlanDocument {
  id: string
  revision: number
  snapshot(): { header?: { units?: string }; objects?: Record<string, unknown> }
}

type Point2 = [number, number]
type Point3 = [number, number, number]
type EntitySpec = { type: string; payload: Record<string, unknown>; options: { id: string } }

const INPUT_KEYS = ['version', 'expectedRevision', 'units', 'drawingId', 'title', 'revision', 'boundary', 'roads', 'buildings', 'utilities', 'coordinateReference', 'northAngleDegrees', 'scale']
const ROAD_KEYS = ['name', 'width', 'centerline']
const BUILDING_KEYS = ['name', 'floors', 'footprint']
const UTILITY_KEYS = ['kind', 'name', 'path', 'diameterMm', 'nodeIndices']
const COORDINATE_KEYS = ['position', 'easting', 'northing', 'crs']
const UTILITY_KINDS = ['water', 'drainage', 'power', 'gas', 'telecom'] as const
const MAX_ENTITY_COUNT = 512
const MAX_TOTAL_POINTS = 1_024
const EPSILON = 1e-8

function plain(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KJValidationError(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new KJValidationError(`${label} must be a plain object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unsupported = Object.keys(value).filter(key => !allowed.includes(key))
  if (unsupported.length) throw new KJValidationError(`${label} contains unsupported field: ${unsupported[0]}`)
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new KJValidationError(`${label} must be a string`)
  const result = value.trim()
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new KJValidationError(`${label} must contain 1-${maximum} printable characters`)
  return result
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new KJValidationError(`${label} must be a finite number from ${minimum} to ${maximum}`)
  }
  return value
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const result = boundedNumber(value, label, minimum, maximum)
  if (!Number.isInteger(result)) throw new KJValidationError(`${label} must be an integer`)
  return result
}

function point2(value: unknown, label: string): Point2 {
  if (!Array.isArray(value) || value.length !== 2) throw new KJValidationError(`${label} must contain exactly two coordinates`)
  return [boundedNumber(value[0], `${label}[0]`, -10_000_000, 10_000_000), boundedNumber(value[1], `${label}[1]`, -10_000_000, 10_000_000)]
}

function samePoint(left: Point2, right: Point2): boolean {
  return Math.abs(left[0] - right[0]) <= EPSILON && Math.abs(left[1] - right[1]) <= EPSILON
}

function cross(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  return Math.abs(cross(start, end, point)) <= EPSILON
    && point[0] >= Math.min(start[0], end[0]) - EPSILON && point[0] <= Math.max(start[0], end[0]) + EPSILON
    && point[1] >= Math.min(start[1], end[1]) - EPSILON && point[1] <= Math.max(start[1], end[1]) + EPSILON
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true
  return (Math.abs(abC) <= EPSILON && pointOnSegment(c, a, b))
    || (Math.abs(abD) <= EPSILON && pointOnSegment(d, a, b))
    || (Math.abs(cdA) <= EPSILON && pointOnSegment(a, c, d))
    || (Math.abs(cdB) <= EPSILON && pointOnSegment(b, c, d))
}

function polygonArea(points: Point2[]): number {
  let twiceArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!, next = points[(index + 1) % points.length]!
    twiceArea += point[0] * next[1] - next[0] * point[1]
  }
  return Math.abs(twiceArea) / 2
}

function validateSimplePolygon(points: Point2[], label: string): void {
  if (polygonArea(points) < 0.01) throw new KJValidationError(`${label} must enclose at least 0.01 square meters`)
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length
    if (samePoint(points[index]!, points[next]!)) throw new KJValidationError(`${label} contains a zero-length edge`)
    for (let other = index + 1; other < points.length; other += 1) {
      const otherNext = (other + 1) % points.length
      if (other === index || other === next || otherNext === index) continue
      if (segmentsIntersect(points[index]!, points[next]!, points[other]!, points[otherNext]!)) throw new KJValidationError(`${label} must not self-intersect`)
    }
  }
}

function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[previous]!, b = polygon[index]!
    if (pointOnSegment(point, a, b)) return true
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function polygonInside(inner: Point2[], outer: Point2[]): boolean {
  if (!inner.every(point => pointInPolygon(point, outer))) return false
  for (let innerIndex = 0; innerIndex < inner.length; innerIndex += 1) {
    const a = inner[innerIndex]!, b = inner[(innerIndex + 1) % inner.length]!
    const midpoint: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    if (!pointInPolygon(midpoint, outer)) return false
    for (let outerIndex = 0; outerIndex < outer.length; outerIndex += 1) {
      const c = outer[outerIndex]!, d = outer[(outerIndex + 1) % outer.length]!
      if (segmentsIntersect(a, b, c, d) && !pointOnSegment(a, c, d) && !pointOnSegment(b, c, d)) return false
    }
  }
  return true
}

function points(value: unknown, label: string, minimum: number, maximum: number): Point2[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new KJValidationError(`${label} must contain ${minimum}-${maximum} points`)
  return value.map((point, index) => point2(point, `${label}[${index}]`))
}

function polylineLength(value: Point2[]): number {
  let length = 0
  for (let index = 1; index < value.length; index += 1) length += Math.hypot(value[index]![0] - value[index - 1]![0], value[index]![1] - value[index - 1]![1])
  return length
}

function validatePolyline(value: Point2[], label: string): void {
  for (let index = 1; index < value.length; index += 1) if (samePoint(value[index - 1]!, value[index]!)) throw new KJValidationError(`${label} contains consecutive duplicate points`)
  if (polylineLength(value) < 0.01) throw new KJValidationError(`${label} must be at least 0.01 meters long`)
}

function extent(value: Point2[]) {
  const xs = value.map(point => point[0]), ys = value.map(point => point[1])
  const minimum: Point2 = [Math.min(...xs), Math.min(...ys)], maximum: Point2 = [Math.max(...xs), Math.max(...ys)]
  return { minimum, maximum, width: maximum[0] - minimum[0], height: maximum[1] - minimum[1] }
}

function polygonLabelPoint(polygon: Point2[]): Point2 {
  let signedTwiceArea = 0, x = 0, y = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index]!, next = polygon[(index + 1) % polygon.length]!, factor = point[0] * next[1] - next[0] * point[1]
    signedTwiceArea += factor
    x += (point[0] + next[0]) * factor
    y += (point[1] + next[1]) * factor
  }
  const centroid: Point2 = [x / (3 * signedTwiceArea), y / (3 * signedTwiceArea)]
  if (Number.isFinite(centroid[0]) && Number.isFinite(centroid[1]) && pointInPolygon(centroid, polygon)) return centroid
  const average: Point2 = [polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length, polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length]
  return pointInPolygon(average, polygon) ? average : polygon[0]!
}

function offsetPolyline(centerline: Point2[], distance: number, label: string): { left: Point2[]; right: Point2[] } {
  const normals: Point2[] = []
  for (let index = 1; index < centerline.length; index += 1) {
    const previous = centerline[index - 1]!, point = centerline[index]!
    const dx = point[0] - previous[0], dy = point[1] - previous[1], length = Math.hypot(dx, dy)
    normals.push([-dy / length, dx / length])
  }
  const side = (sign: -1 | 1) => centerline.map((point, index): Point2 => {
    if (index === 0) return [point[0] + normals[0]![0] * distance * sign, point[1] + normals[0]![1] * distance * sign]
    if (index === centerline.length - 1) return [point[0] + normals[normals.length - 1]![0] * distance * sign, point[1] + normals[normals.length - 1]![1] * distance * sign]
    const previous = normals[index - 1]!, next = normals[index]!
    const sumX = previous[0] + next[0], sumY = previous[1] + next[1], sumLength = Math.hypot(sumX, sumY)
    if (sumLength <= 1e-5) throw new KJValidationError(`${label} contains a 180-degree reversal`)
    const miter: Point2 = [sumX / sumLength, sumY / sumLength]
    const denominator = miter[0] * next[0] + miter[1] * next[1]
    if (denominator <= 0.25) throw new KJValidationError(`${label} contains a turn too sharp for its road width`)
    const amount = distance / denominator
    if (amount > distance * 4) throw new KJValidationError(`${label} produces an excessive road-edge miter`)
    return [point[0] + miter[0] * amount * sign, point[1] + miter[1] * amount * sign]
  })
  return { left: side(1), right: side(-1) }
}

function validateInput(document: SitePlanDocument, source: KJAgentSitePlanInput) {
  if (!document || typeof document.id !== 'string' || !Number.isInteger(document.revision) || typeof document.snapshot !== 'function') throw new KJValidationError('Site plan compiler requires a KJDraw document')
  const input = plain(source, 'input')
  exactKeys(input, INPUT_KEYS, 'input')
  if (input.version !== KJDRAW_SITE_PLAN_VERSION) throw new KJValidationError(`input.version must be ${KJDRAW_SITE_PLAN_VERSION}`)
  if (input.units !== 'meter') throw new KJValidationError('input.units must be meter')
  if (input.scale !== 500) throw new KJValidationError('input.scale must be 500 for site-plan version 1.0.0')
  const expectedRevision = boundedInteger(input.expectedRevision, 'input.expectedRevision', 0, Number.MAX_SAFE_INTEGER)
  if (expectedRevision !== document.revision) throw new KJValidationError(`input.expectedRevision ${expectedRevision} does not match document revision ${document.revision}`)
  if (document.snapshot()?.header?.units !== 'meter') throw new KJValidationError('Site plan compiler requires a meter document')
  if (Object.values(document.snapshot()?.objects ?? {}).some(value => value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'entity')) {
    throw new KJValidationError('Site plan compiler version 1.0.0 requires a blank document')
  }

  let totalPoints = 0
  const boundary = points(input.boundary, 'input.boundary', 3, 128); totalPoints += boundary.length
  validateSimplePolygon(boundary, 'input.boundary')
  const boundaryExtent = extent(boundary)

  if (!Array.isArray(input.roads) || input.roads.length < 1 || input.roads.length > 16) throw new KJValidationError('input.roads must contain 1-16 roads')
  const roads = input.roads.map((sourceRoad: unknown, index: number) => {
    const road = plain(sourceRoad, `input.roads[${index}]`); exactKeys(road, ROAD_KEYS, `input.roads[${index}]`)
    const centerline = points(road.centerline, `input.roads[${index}].centerline`, 2, 64); totalPoints += centerline.length
    validatePolyline(centerline, `input.roads[${index}].centerline`)
    const width = boundedNumber(road.width, `input.roads[${index}].width`, 2, 60)
    offsetPolyline(centerline, width / 2, `input.roads[${index}].centerline`)
    return { name: boundedString(road.name, `input.roads[${index}].name`, 80), width, centerline }
  })

  if (!Array.isArray(input.buildings) || input.buildings.length < 1 || input.buildings.length > 64) throw new KJValidationError('input.buildings must contain 1-64 buildings')
  const buildings = input.buildings.map((sourceBuilding: unknown, index: number) => {
    const building = plain(sourceBuilding, `input.buildings[${index}]`); exactKeys(building, BUILDING_KEYS, `input.buildings[${index}]`)
    const footprint = points(building.footprint, `input.buildings[${index}].footprint`, 3, 64); totalPoints += footprint.length
    validateSimplePolygon(footprint, `input.buildings[${index}].footprint`)
    if (!polygonInside(footprint, boundary)) throw new KJValidationError(`input.buildings[${index}].footprint must lie inside the site boundary`)
    const floors = building.floors == null ? undefined : boundedInteger(building.floors, `input.buildings[${index}].floors`, 1, 200)
    return { name: boundedString(building.name, `input.buildings[${index}].name`, 80), floors, footprint }
  })

  if (!Array.isArray(input.utilities) || input.utilities.length < 2 || input.utilities.length > 32) throw new KJValidationError('input.utilities must contain 2-32 utility routes')
  const utilities = input.utilities.map((sourceUtility: unknown, index: number) => {
    const utility = plain(sourceUtility, `input.utilities[${index}]`); exactKeys(utility, UTILITY_KEYS, `input.utilities[${index}]`)
    if (!UTILITY_KINDS.includes(utility.kind as KJAgentSiteUtilityKind)) throw new KJValidationError(`input.utilities[${index}].kind is unsupported`)
    const path = points(utility.path, `input.utilities[${index}].path`, 2, 128); totalPoints += path.length
    validatePolyline(path, `input.utilities[${index}].path`)
    const diameterMm = utility.diameterMm == null ? undefined : boundedNumber(utility.diameterMm, `input.utilities[${index}].diameterMm`, 10, 5_000)
    const rawNodeIndices = utility.nodeIndices ?? [0, path.length - 1]
    if (!Array.isArray(rawNodeIndices) || rawNodeIndices.length < 1 || rawNodeIndices.length > path.length) throw new KJValidationError(`input.utilities[${index}].nodeIndices must identify 1-${path.length} path vertices`)
    const nodeIndices = rawNodeIndices.map((value, nodeIndex) => boundedInteger(value, `input.utilities[${index}].nodeIndices[${nodeIndex}]`, 0, path.length - 1))
    if (new Set(nodeIndices).size !== nodeIndices.length) throw new KJValidationError(`input.utilities[${index}].nodeIndices must be unique`)
    return { kind: utility.kind as KJAgentSiteUtilityKind, name: boundedString(utility.name, `input.utilities[${index}].name`, 80), path, diameterMm, nodeIndices }
  })
  if (!utilities.some(utility => utility.kind === 'water') || !utilities.some(utility => utility.kind === 'drainage')) throw new KJValidationError('input.utilities must include water and drainage routes')

  const coordinate = plain(input.coordinateReference, 'input.coordinateReference'); exactKeys(coordinate, COORDINATE_KEYS, 'input.coordinateReference')
  const coordinateReference = {
    position: point2(coordinate.position, 'input.coordinateReference.position'),
    easting: boundedNumber(coordinate.easting, 'input.coordinateReference.easting', -100_000_000, 100_000_000),
    northing: boundedNumber(coordinate.northing, 'input.coordinateReference.northing', -100_000_000, 100_000_000),
    crs: boundedString(coordinate.crs, 'input.coordinateReference.crs', 96),
  }
  if (!pointInPolygon(coordinateReference.position, boundary)) throw new KJValidationError('input.coordinateReference.position must lie inside the site boundary')
  if (totalPoints > MAX_TOTAL_POINTS) throw new KJValidationError(`Site plan input contains ${totalPoints} points; maximum is ${MAX_TOTAL_POINTS}`)

  const northAngleDegrees = boundedNumber(input.northAngleDegrees ?? 0, 'input.northAngleDegrees', -360, 360)
  const viewMargin = Math.max(8, Math.min(20, Math.max(boundaryExtent.width, boundaryExtent.height) * 0.06))
  const viewWidth = boundaryExtent.width + viewMargin * 2, viewHeight = boundaryExtent.height + viewMargin * 2
  const groundWidthAtA1 = 801 * 500 / 1_000, groundHeightAtA1 = 544 * 500 / 1_000
  if (viewWidth > groundWidthAtA1 + EPSILON || viewHeight > groundHeightAtA1 + EPSILON) throw new KJValidationError('input.boundary does not fit ISO A1 landscape at 1:500 with standard margins')
  const withinView = (point: Point2) => point[0] >= boundaryExtent.minimum[0] - viewMargin - EPSILON
    && point[0] <= boundaryExtent.maximum[0] + viewMargin + EPSILON
    && point[1] >= boundaryExtent.minimum[1] - viewMargin - EPSILON
    && point[1] <= boundaryExtent.maximum[1] + viewMargin + EPSILON
  for (let index = 0; index < roads.length; index += 1) {
    const road = roads[index]!, edges = offsetPolyline(road.centerline, road.width / 2, `input.roads[${index}].centerline`)
    if (![...edges.left, ...edges.right].every(withinView)) throw new KJValidationError(`input.roads[${index}] exceeds the A1 viewport around the site boundary`)
  }
  for (let index = 0; index < utilities.length; index += 1) {
    if (!utilities[index]!.path.every(withinView)) throw new KJValidationError(`input.utilities[${index}] exceeds the A1 viewport around the site boundary`)
  }

  return {
    version: input.version,
    expectedRevision,
    units: input.units,
    drawingId: boundedString(input.drawingId, 'input.drawingId', 96),
    title: boundedString(input.title, 'input.title', 160),
    revision: boundedString(input.revision, 'input.revision', 32),
    boundary, boundaryExtent, roads, buildings, utilities, coordinateReference, northAngleDegrees, viewMargin,
  }
}

function format(value: number, digits = 2): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')
}

export function buildAgentSitePlan(document: SitePlanDocument, source: KJAgentSitePlanInput) {
  const input = validateInput(document, source)
  const idPrefix = `site-${stableHash({ drawingId: input.drawingId, version: input.version }).slice(0, 12)}`
  const entities: EntitySpec[] = []
  const linetypeIds = {
    continuous: `${idPrefix}-lt-continuous`,
    center: `${idPrefix}-lt-center`,
    dashed: `${idPrefix}-lt-dashed`,
  }
  const layerDefinitions = {
    SITE_BOUNDARY: { id: `${idPrefix}-layer-boundary`, color: 7, linetypeId: linetypeIds.continuous, lineweight: 50 },
    ROAD_EDGE: { id: `${idPrefix}-layer-road-edge`, color: 8, linetypeId: linetypeIds.continuous, lineweight: 35 },
    ROAD_CENTER: { id: `${idPrefix}-layer-road-center`, color: 2, linetypeId: linetypeIds.center, lineweight: 18 },
    BUILDING: { id: `${idPrefix}-layer-building`, color: 1, linetypeId: linetypeIds.continuous, lineweight: 50 },
    WATER: { id: `${idPrefix}-layer-water`, color: 5, linetypeId: linetypeIds.continuous, lineweight: 25 },
    DRAINAGE: { id: `${idPrefix}-layer-drainage`, color: 3, linetypeId: linetypeIds.dashed, lineweight: 25 },
    POWER: { id: `${idPrefix}-layer-power`, color: 6, linetypeId: linetypeIds.dashed, lineweight: 25 },
    GAS: { id: `${idPrefix}-layer-gas`, color: 30, linetypeId: linetypeIds.dashed, lineweight: 25 },
    TELECOM: { id: `${idPrefix}-layer-telecom`, color: 4, linetypeId: linetypeIds.dashed, lineweight: 18 },
    UTILITY_NODE: { id: `${idPrefix}-layer-utility-node`, color: 7, linetypeId: linetypeIds.continuous, lineweight: 25 },
    ANNOTATION: { id: `${idPrefix}-layer-annotation`, color: 7, linetypeId: linetypeIds.continuous, lineweight: 18 },
    DIMENSIONS: { id: `${idPrefix}-layer-dimensions`, color: 2, linetypeId: linetypeIds.continuous, lineweight: 18 },
  } as const
  type LayerName = keyof typeof layerDefinitions
  const p3 = (point: Point2): Point3 => [point[0], point[1], 0]
  const add = (type: string, layer: LayerName, payload: Record<string, unknown>) => {
    const id = `${idPrefix}-${String(entities.length + 1).padStart(4, '0')}`
    entities.push({ type, payload: { ...payload, layerId: layerDefinitions[layer].id }, options: { id } })
  }
  const polyline = (value: Point2[], layer: LayerName, closed = false) => add('LWPOLYLINE', layer, { vertices: value.map(p3), closed })
  const line = (start: Point2, end: Point2, layer: LayerName) => add('LINE', layer, { start: p3(start), end: p3(end) })
  const text = (position: Point2, value: string, height: number, rotation = 0) => add('TEXT', 'ANNOTATION', { position: p3(position), text: value, height, rotation })
  const dimension = (start: Point2, end: Point2, textPosition: Point2) => add('DIMENSION', 'DIMENSIONS', {
    dimensionType: 'ALIGNED', definitionPoints: [p3(textPosition), p3(start), p3(end)], textPosition: p3(textPosition), textOverride: null, textHeight: 1.75, styleName: 'STANDARD',
  })

  const span = Math.max(input.boundaryExtent.width, input.boundaryExtent.height)
  const textHeight = Math.max(1.25, Math.min(3, span / 80))
  polyline(input.boundary, 'SITE_BOUNDARY', true)

  for (const road of input.roads) {
    const edges = offsetPolyline(road.centerline, road.width / 2, `road ${road.name}`)
    polyline(edges.left, 'ROAD_EDGE'); polyline(edges.right, 'ROAD_EDGE'); polyline(road.centerline, 'ROAD_CENTER')
    const middleIndex = Math.floor((road.centerline.length - 1) / 2), start = road.centerline[middleIndex]!, end = road.centerline[middleIndex + 1]!
    const rotation = Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI
    text([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2 + textHeight], `${road.name}  W=${format(road.width)}m`, textHeight, rotation)
  }

  for (const building of input.buildings) {
    polyline(building.footprint, 'BUILDING', true)
    const label = building.floors == null ? building.name : `${building.name}  ${building.floors}F`
    text(polygonLabelPoint(building.footprint), label, textHeight)
  }

  const utilityLayer: Record<KJAgentSiteUtilityKind, LayerName> = { water: 'WATER', drainage: 'DRAINAGE', power: 'POWER', gas: 'GAS', telecom: 'TELECOM' }
  let utilityNodeCount = 0
  for (const utility of input.utilities) {
    polyline(utility.path, utilityLayer[utility.kind])
    const labelPoint = utility.path[Math.floor((utility.path.length - 1) / 2)]!
    text([labelPoint[0] + textHeight, labelPoint[1] + textHeight], `${utility.name}${utility.diameterMm == null ? '' : ` DN${format(utility.diameterMm, 0)}`}`, textHeight * 0.9)
    for (const nodeIndex of utility.nodeIndices) {
      const center = utility.path[nodeIndex]!, radius = Math.max(0.35, textHeight * 0.22)
      add('CIRCLE', 'UTILITY_NODE', { center: p3(center), radius })
      utilityNodeCount += 1
    }
  }

  const dimensionOffset = Math.max(4, textHeight * 2.5)
  const { minimum, maximum } = input.boundaryExtent
  dimension([minimum[0], minimum[1]], [maximum[0], minimum[1]], [(minimum[0] + maximum[0]) / 2, minimum[1] - dimensionOffset])
  dimension([minimum[0], minimum[1]], [minimum[0], maximum[1]], [minimum[0] - dimensionOffset, (minimum[1] + maximum[1]) / 2])

  const control = input.coordinateReference
  const marker = Math.max(1, textHeight * 0.65)
  line([control.position[0] - marker, control.position[1]], [control.position[0] + marker, control.position[1]], 'ANNOTATION')
  line([control.position[0], control.position[1] - marker], [control.position[0], control.position[1] + marker], 'ANNOTATION')
  text([control.position[0] + marker, control.position[1] + marker], `${control.crs}  E=${format(control.easting, 3)}  N=${format(control.northing, 3)}`, textHeight * 0.9)

  const northAnchor: Point2 = [maximum[0] - input.viewMargin * 0.75, maximum[1] - input.viewMargin * 0.75]
  const northLength = Math.max(6, Math.min(14, span * 0.08)), angle = (90 + input.northAngleDegrees) * Math.PI / 180
  const northTip: Point2 = [northAnchor[0] + Math.cos(angle) * northLength, northAnchor[1] + Math.sin(angle) * northLength]
  line(northAnchor, northTip, 'ANNOTATION')
  const arrowAngle = 0.45, arrowLength = northLength * 0.28
  polyline([
    northTip,
    [northTip[0] - Math.cos(angle - arrowAngle) * arrowLength, northTip[1] - Math.sin(angle - arrowAngle) * arrowLength],
    [northTip[0] - Math.cos(angle + arrowAngle) * arrowLength, northTip[1] - Math.sin(angle + arrowAngle) * arrowLength],
  ], 'ANNOTATION', true)
  text([northTip[0], northTip[1] + textHeight], 'N', textHeight * 1.3)

  const noteOrigin: Point2 = [minimum[0] + input.viewMargin * 0.2, maximum[1] - input.viewMargin * 0.3]
  text(noteOrigin, input.title, textHeight * 1.2)
  text([noteOrigin[0], noteOrigin[1] - textHeight * 1.6], `DRAWING ${input.drawingId}  REV ${input.revision}  SCALE 1:500`, textHeight)
  text([noteOrigin[0], noteOrigin[1] - textHeight * 3], `SITE AREA ${format(polygonArea(input.boundary))} m2`, textHeight)

  if (entities.length + 1 > MAX_ENTITY_COUNT) throw new KJValidationError(`Site plan expands to ${entities.length + 1} entities; maximum is ${MAX_ENTITY_COUNT}`)
  const viewCenter: Point2 = [(minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2]
  const viewBounds = {
    minimum: [viewCenter[0] - 400.5 / 2, viewCenter[1] - 272 / 2] as Point2,
    maximum: [viewCenter[0] + 400.5 / 2, viewCenter[1] + 272 / 2] as Point2,
  }
  const layoutName = `KJ_SITE_${idPrefix.slice(5, 17).toUpperCase()}_A1`
  const outputConfig = {
    layoutName,
    paper: { standard: 'ISO A1', orientation: 'landscape', widthMm: 841, heightMm: 594, marginsMm: { left: 20, right: 20, top: 15, bottom: 35 } },
    scaleNumerator: 1,
    scaleDenominator: 500,
    modelUnits: 'meter' as const,
    viewport: {
      center: viewCenter,
      bounds: viewBounds,
      width: viewBounds.maximum[0] - viewBounds.minimum[0],
      height: viewBounds.maximum[1] - viewBounds.minimum[1],
    },
  }
  const layout = {
    id: `${idPrefix}-layout`,
    blockRecordId: `${idPrefix}-paper-space`,
    name: layoutName,
    dxfPlotSettings: {
      paperWidth: 841, paperHeight: 594,
      marginLeft: 20, marginBottom: 35, marginRight: 20, marginTop: 15,
      originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 1,
      flags: 0, paperUnits: 1 as const, rotation: 0 as const, plotType: 5 as const,
    },
    viewport: {
      id: `${idPrefix}-viewport`, center: [420.5, 307, 0] as Point3, width: 801, height: 544,
      viewCenter: [viewCenter[0], viewCenter[1], 0] as Point3,
      viewHeight: 272, twistAngle: 0, modelUnits: 'meter' as const, scaleDenominator: 500,
    },
  }
  const resources = {
    linetypes: [
      { id: linetypeIds.continuous, name: `KJ_${idPrefix.slice(5, 17)}_CONT`, pattern: [] },
      { id: linetypeIds.center, name: `KJ_${idPrefix.slice(5, 17)}_CENTER`, pattern: [6, -1.5, 1, -1.5] },
      { id: linetypeIds.dashed, name: `KJ_${idPrefix.slice(5, 17)}_DASHED`, pattern: [3, -1.5] },
    ],
    layers: Object.entries(layerDefinitions).map(([name, definition]) => ({ name, ...definition })),
  }
  return {
    commandArgs: { entities, resources, layout },
    outputConfig,
    evidence: {
      drawingId: input.drawingId,
      skillId: 'site-plan',
      skillVersion: KJDRAW_SITE_PLAN_VERSION,
      units: 'meter' as const,
      expectedRevision: input.expectedRevision,
      modelEntityCount: entities.length,
      entityCount: entities.length + 1,
      siteAreaSquareMeters: polygonArea(input.boundary),
      boundaryBounds: input.boundaryExtent,
      roadCount: input.roads.length,
      roadCenterlineMeters: input.roads.reduce((sum, road) => sum + polylineLength(road.centerline), 0),
      buildingCount: input.buildings.length,
      buildingAreasSquareMeters: input.buildings.map(building => ({ name: building.name, area: polygonArea(building.footprint) })),
      utilityCount: input.utilities.length,
      utilityMeters: input.utilities.reduce((sum, utility) => sum + polylineLength(utility.path), 0),
      utilityNodeCount,
      coordinateReference: control,
      output: outputConfig,
      limitations: ['Version 1.0.0 compiles one site boundary and one A1 landscape view at 1:500', 'Road edges use bounded miter joins', 'Utility nodes are placed only on declared path vertices'],
    },
  }
}
