import { KJValidationError } from './errors.js'

export type KJPatternPoint = readonly [number, number, number]
export type KJPatternEntity =
  | { type: 'LINE'; payload: { start: KJPatternPoint; end: KJPatternPoint } }
  | { type: 'CIRCLE'; payload: { center: KJPatternPoint; radius: number } }
  | { type: 'ARC'; payload: { center: KJPatternPoint; radius: number; startAngle: number; endAngle: number; clockwise: boolean } }
  | { type: 'LWPOLYLINE'; payload: { vertices: readonly KJPatternPoint[]; closed: boolean } }
export interface KJRectangularDrawingPattern { rows: number; columns: number; dx: number; dy: number }
export interface KJDrawingPatternBudget { maxEntities?: number; maxPoints?: number }

const ENTITY_LIMIT = 4096 // Deliberately stricter than CREATEBATCH; expansion needs explicit headroom.
const POINT_LIMIT = 262144
const COORDINATE_LIMIT = 1e12 // Same coordinate range as agent drawing inputs.
const reject = (message: string): never => { throw new KJValidationError(message) }
const coordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT
const same = (a: KJPatternPoint, b: KJPatternPoint) => a[0] === b[0] && a[1] === b[1]
function keys(value: unknown, expected: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('Pattern definitions must be objects')
  const actual = Object.keys(value as object)
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) reject('Unsupported pattern definition fields')
}
function limit(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) reject('Pattern budget must be a positive integer within the hard limit')
}

/** Pure translation of native XY geometry; no document access, IDs, commands or evaluation.
 * Includes the source position and emits row, column, then source order. dx is column
 * spacing and dy is row spacing, matching ARRAYRECT. Every output owns its geometry.
 * Only straight, zero-width polylines and native z=0 geometry are supported. Arcs use
 * radians. All cardinality, point-work and translated-coordinate checks precede expansion.
 */
export function expandRectangularDrawingPattern(
  entities: readonly KJPatternEntity[], pattern: KJRectangularDrawingPattern, budget: KJDrawingPatternBudget = {},
): KJPatternEntity[] {
  const maxEntities = budget.maxEntities ?? 64, maxPoints = budget.maxPoints ?? POINT_LIMIT
  limit(maxEntities, ENTITY_LIMIT); limit(maxPoints, POINT_LIMIT)
  keys(pattern, ['rows', 'columns', 'dx', 'dy'])
  const { rows, columns, dx, dy } = pattern
  if (![rows, columns].every(value => Number.isSafeInteger(value) && value >= 1)) reject('Pattern rows and columns must be positive safe integers')
  if (!coordinate(dx) || !coordinate(dy)) reject('Pattern spacing must be finite and within the coordinate range')
  if ((columns > 1 && dx === 0) || (rows > 1 && dy === 0)) reject('Repeated pattern directions require nonzero spacing')
  if (!Array.isArray(entities) || !entities.length || entities.length > maxEntities) reject('Pattern requires a nonempty bounded entity array')
  if (rows > Math.floor(maxEntities / entities.length / columns)) reject('Pattern exceeds the entity budget')
  const copies = rows * columns, lastX = (columns - 1) * dx, lastY = (rows - 1) * dy
  if (!Number.isFinite(lastX) || !Number.isFinite(lastY)) reject('Pattern translation is not finite')
  let pointsPerCopy = 0
  const checkSegment = (a: KJPatternPoint, b: KJPatternPoint): void => {
    if (same(a, b)) reject('Pattern segments require distinct endpoints')
  }
  const checkPoint = (point: KJPatternPoint): void => {
    if (!Array.isArray(point) || point.length !== 3 || !coordinate(point[0]) || !coordinate(point[1]) || point[2] !== 0) reject('Pattern points must be finite native XY triples within the coordinate range')
    if (!coordinate(point[0] + lastX) || !coordinate(point[1] + lastY)) reject('Expanded pattern exceeds the coordinate range')
    pointsPerCopy++
    if (pointsPerCopy > Math.floor(maxPoints / copies)) reject('Pattern exceeds the point-work budget')
  }
  for (const entity of entities) {
    keys(entity, ['type', 'payload'])
    const payload = entity.payload
    switch (entity.type) {
      case 'LINE': {
        keys(payload, ['start', 'end'])
        const { start, end } = entity.payload
        checkPoint(start); checkPoint(end)
        checkSegment(start, end)
        break
      }
      case 'CIRCLE': case 'ARC': {
        keys(payload, entity.type === 'CIRCLE' ? ['center', 'radius'] : ['center', 'radius', 'startAngle', 'endAngle', 'clockwise'])
        checkPoint(entity.payload.center)
        if (!coordinate(entity.payload.radius) || entity.payload.radius <= 0) reject('Pattern radius must be positive and within the coordinate range')
        if (entity.type === 'ARC') {
          const { startAngle, endAngle, clockwise } = entity.payload
          if (![startAngle, endAngle].every(angle => Number.isFinite(angle) && angle >= 0 && angle <= Math.PI * 2) || typeof clockwise !== 'boolean' || (endAngle - startAngle) % (Math.PI * 2) === 0) reject('Pattern arcs require bounded radian angles and a nonzero partial sweep')
        }
        break
      }
      case 'LWPOLYLINE': {
        keys(payload, ['vertices', 'closed'])
        const { vertices, closed } = entity.payload
        if (typeof closed !== 'boolean' || !Array.isArray(vertices) || vertices.length < (closed ? 3 : 2) || vertices.length > 64) reject('Pattern polylines require 2–64 vertices, or at least 3 when closed')
        for (let index = 0; index < vertices.length; index++) {
          checkPoint(vertices[index]!)
          if (index > 0) checkSegment(vertices[index]!, vertices[index - 1]!)
        }
        if (closed) checkSegment(vertices[0]!, vertices[vertices.length - 1]!)
        break
      }
      default: reject('Unsupported pattern entity type')
    }
  }
  // Floating-point alignment can collapse an intermediate cell even when the corners
  // remain distinct. Inspect every actual cell before allocating output; the point-work
  // budget above bounds this pass, including all polyline segments and closures.
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = column * dx, y = row * dy
    const distinct = (a: KJPatternPoint, b: KJPatternPoint): void => {
      if (a[0] + x === b[0] + x && a[1] + y === b[1] + y) reject('Pattern translation loses segment precision')
    }
    for (const entity of entities) {
      if (entity.type === 'LINE') distinct(entity.payload.start, entity.payload.end)
      else if (entity.type === 'LWPOLYLINE') {
        const { vertices, closed } = entity.payload
        for (let index = 1; index < vertices.length; index++) distinct(vertices[index - 1]!, vertices[index]!)
        if (closed) distinct(vertices[vertices.length - 1]!, vertices[0]!)
      }
    }
  }
  const expanded: KJPatternEntity[] = []
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = column * dx, y = row * dy
    const translate = (point: KJPatternPoint): KJPatternPoint => [point[0] + x, point[1] + y, 0]
    for (const entity of entities) {
      switch (entity.type) {
        case 'LINE': expanded.push({ type: 'LINE', payload: { start: translate(entity.payload.start), end: translate(entity.payload.end) } }); break
        case 'CIRCLE': expanded.push({ type: 'CIRCLE', payload: { center: translate(entity.payload.center), radius: entity.payload.radius } }); break
        case 'ARC': expanded.push({ type: 'ARC', payload: { ...entity.payload, center: translate(entity.payload.center) } }); break
        case 'LWPOLYLINE': expanded.push({ type: 'LWPOLYLINE', payload: { vertices: entity.payload.vertices.map(translate), closed: entity.payload.closed } }); break
      }
    }
  }
  return expanded
}
