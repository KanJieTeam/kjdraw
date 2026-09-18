import { KJValidationError } from './errors.js'
import { projectDimension } from './geometry/annotation.js'
import { KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK } from './knowledge-packs/mechanical-flange-core.js'
import { stableHash } from './utils.js'

export const KJDRAW_MECHANICAL_FLANGE_CORE_VERSION = '1.0.0' as const
type Point2 = [number, number]
type Point3 = [number, number, number]
type Entity = { type: 'LINE' | 'CIRCLE' | 'ARC' | 'SOLID' | 'LEADER' | 'TEXT' | 'MTEXT' | 'DIMENSION' | 'HATCH'; payload: Record<string, unknown>; options: { id: string } }
interface Document { id: string; revision: number; snapshot(): { header?: { units?: string } } }

export interface KJFlangeTitleGrid {
  origin: Point2
  size: Point2
  /** Full-height column boundaries measured from the grid's left edge. */
  columns: number[]
  /** Column boundaries that stop below the grid's top edge. */
  partialColumns?: { offset: number; height: number }[]
  /** Row boundaries measured from the bottom; breaks split one row into segments. */
  rows: { offset: number; breaks?: number[] }[]
  /** Bounded horizontal rules measured from the grid's bottom and left edges. */
  horizontalSegments?: { offset: number; start: number; end: number }[]
  /** Bounded vertical rules measured from the grid's left and bottom edges. */
  verticalSegments?: { offset: number; start: number; end: number }[]
  diagonalHeader?: { width: number; drop: number }
}

/** One source-measured meridian of an axially symmetric side view.
 *  Stations are absolute drawing X coordinates and radii are positive
 *  distances from the side-view axis. Repeated stations express shoulders.
 */
export interface KJFlangeSymmetricProfile {
  vertices: { station: number; radius: number }[]
  endCaps?: 'none' | 'start' | 'end' | 'both'
}

/** Source-measured side-view geometry. Stations use drawing X coordinates;
 *  offsets are measured from the shared projection axis. */
export type KJFlangeSideViewOutlineSegment =
  | { kind: 'line'; start: { station: number; offset: number }; end: { station: number; offset: number } }
  | { kind: 'arc'; center: { station: number; offset: number }; radius: number; startAngle: number; endAngle: number }
  | { kind: 'circle'; center: { station: number; offset: number }; radius: number }

/** A source-measured cut face in the side view. Boundary coordinates are
 *  relative to the projection axis; the pattern is generated, not copied
 *  from DXF tags or a private block definition. */
export interface KJFlangeSectionHatch {
  edges: (
    | { kind: 'line'; start: { station: number; offset: number }; end: { station: number; offset: number } }
    | { kind: 'arc'; center: { station: number; offset: number }; radius: number; startAngle: number; endAngle: number; counterClockwise?: boolean }
  )[]
  lineAngle: number
  lineSpacing: number
  patternOrigin?: Point2
}

/** Source-supplied visible sheet text. Content remains input data and is not
 *  retained by the reusable knowledge pack. */
export interface KJFlangeSheetNote {
  kind: 'single-line' | 'multiline'
  text: string
  position: Point2
  height: number
  rotation?: number
  width?: number
}

/** A bounded native mechanical dimension supplied as engineering annotation
 *  facts. Measurements are derived from definition points, never accepted. */
export interface KJFlangeDimension {
  kind: 'aligned' | 'rotated' | 'diameter' | 'radius' | 'angular'
  definitionPoints: Point2[]
  textPosition?: Point2
  textOverride?: string
  rotation?: number
}

/** A source-measured native leader without private annotation handles. */
export interface KJFlangeLeader {
  vertices: Point2[]
  arrowEnabled?: boolean
  pathType?: number
  annotationType?: number
  hookLineDirection?: number
  hookLineEnabled?: boolean
}

/** Source-measured visible end-view outline geometry, expressed relative to
 *  the end-view center so that the same rule remains position independent. */
export type KJFlangeEndViewOutlineSegment =
  | { kind: 'line'; startOffset: Point2; endOffset: Point2 }
  | { kind: 'arc'; centerOffset: Point2; radius: number; startAngle: number; endAngle: number }
  | { kind: 'circle'; centerOffset: Point2; radius: number }

/** A source-positioned cutting-plane mark, relative to the end-view center.
 *  The stem and tick vectors retain the drafting direction of each mark. */
export interface KJFlangeCuttingPlaneMark {
  anchorOffset: Point2
  stemVector: Point2
  tickVector: Point2
  arrowhead?: { length: number; width: number }
}

export interface KJAgentMechanicalFlangeCoreInput {
  version: typeof KJDRAW_MECHANICAL_FLANGE_CORE_VERSION
  expectedRevision: number
  units: 'millimeter'
  drawingId: string
  endView: { center: Point2; ringRadii: number[]; squareHoles: { pitch: number; radius: number }; outlineSegments?: KJFlangeEndViewOutlineSegment[]; cuttingPlaneMarks?: KJFlangeCuttingPlaneMark[] }
  sideViewAxis?: { xRange: Point2; symmetricProfiles?: KJFlangeSymmetricProfile[]; outlineSegments?: KJFlangeSideViewOutlineSegment[]; sectionHatches?: KJFlangeSectionHatch[] }
  dimensions?: KJFlangeDimension[]
  leaders?: KJFlangeLeader[]
  sheet: { origin: Point2; size: Point2; inset: number; titleGrid?: KJFlangeTitleGrid; notes?: KJFlangeSheetNote[] }
}

const finite = (value: unknown, label: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new KJValidationError(`${label} must be finite from ${min} to ${max}`)
  return value
}
const plain = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new KJValidationError(`${label} must be a plain object`)
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  const extra = Object.keys(value).find(key => !keys.includes(key))
  if (extra) throw new KJValidationError(`${label} contains unsupported field: ${extra}`)
}
const point = (value: unknown, label: string): Point2 => {
  if (!Array.isArray(value) || value.length !== 2) throw new KJValidationError(`${label} must contain two coordinates`)
  return [finite(value[0], `${label}[0]`, -1_000_000, 1_000_000), finite(value[1], `${label}[1]`, -1_000_000, 1_000_000)]
}
const increasing = (value: unknown, label: string, maxCount: number, min: number, max: number): number[] => {
  if (!Array.isArray(value) || value.length > maxCount) throw new KJValidationError(`${label} exceeds its item budget`)
  const result = value.map((item, index) => finite(item, `${label}[${index}]`, min, max))
  if (result.some((item, index) => index > 0 && item <= result[index - 1]!)) throw new KJValidationError(`${label} must increase strictly`)
  return result
}

function validate(document: Document, source: KJAgentMechanicalFlangeCoreInput) {
  if (!document || typeof document.id !== 'string' || !Number.isSafeInteger(document.revision) || typeof document.snapshot !== 'function') throw new KJValidationError('Flange compiler requires a KJDraw document')
  const input = plain(source, 'input'); exact(input, ['version', 'expectedRevision', 'units', 'drawingId', 'endView', 'sideViewAxis', 'dimensions', 'leaders', 'sheet'], 'input')
  if (input.version !== KJDRAW_MECHANICAL_FLANGE_CORE_VERSION) throw new KJValidationError(`input.version must be ${KJDRAW_MECHANICAL_FLANGE_CORE_VERSION}`)
  if (input.units !== 'millimeter' || document.snapshot().header?.units !== 'millimeter') throw new KJValidationError('Flange compiler requires millimeter units')
  const expectedRevision = finite(input.expectedRevision, 'input.expectedRevision', 0, Number.MAX_SAFE_INTEGER)
  if (!Number.isInteger(expectedRevision) || expectedRevision !== document.revision) throw new KJValidationError('input.expectedRevision must match the document revision')
  if (typeof input.drawingId !== 'string' || !input.drawingId.trim() || input.drawingId.length > 96 || /[\u0000-\u001f\u007f]/u.test(input.drawingId)) throw new KJValidationError('input.drawingId must be printable text')
  const end = plain(input.endView, 'input.endView'); exact(end, ['center', 'ringRadii', 'squareHoles', 'outlineSegments', 'cuttingPlaneMarks'], 'input.endView')
  const center = point(end.center, 'input.endView.center')
  const ringRadii = increasing(end.ringRadii, 'input.endView.ringRadii', 16, 0.1, 100_000)
  if (ringRadii.length < 2) throw new KJValidationError('input.endView.ringRadii requires at least two radii')
  const holes = plain(end.squareHoles, 'input.endView.squareHoles'); exact(holes, ['pitch', 'radius'], 'input.endView.squareHoles')
  const pitch = finite(holes.pitch, 'input.endView.squareHoles.pitch', 0.1, 100_000)
  const radius = finite(holes.radius, 'input.endView.squareHoles.radius', 0.1, 100_000)
  if (pitch <= radius * 2) throw new KJValidationError('square-hole pitch must exceed the hole diameter')
  if (end.outlineSegments != null && !Array.isArray(end.outlineSegments)) throw new KJValidationError('input.endView.outlineSegments must be an array')
  if ((end.outlineSegments as unknown[] | undefined)?.length && (end.outlineSegments as unknown[]).length > 128) throw new KJValidationError('input.endView.outlineSegments exceed their budget')
  const outlineSegments: KJFlangeEndViewOutlineSegment[] = ((end.outlineSegments ?? []) as unknown[]).map((value, index) => {
    const segment = plain(value, `input.endView.outlineSegments[${index}]`)
    if (segment.kind === 'line') {
      exact(segment, ['kind', 'startOffset', 'endOffset'], `input.endView.outlineSegments[${index}]`)
      const startOffset = point(segment.startOffset, `input.endView.outlineSegments[${index}].startOffset`)
      const endOffset = point(segment.endOffset, `input.endView.outlineSegments[${index}].endOffset`)
      if (startOffset[0] === endOffset[0] && startOffset[1] === endOffset[1]) throw new KJValidationError(`input.endView.outlineSegments[${index}] must not have zero length`)
      return { kind: 'line', startOffset, endOffset }
    }
    if (segment.kind === 'arc') {
      exact(segment, ['kind', 'centerOffset', 'radius', 'startAngle', 'endAngle'], `input.endView.outlineSegments[${index}]`)
      const centerOffset = point(segment.centerOffset, `input.endView.outlineSegments[${index}].centerOffset`)
      const arcRadius = finite(segment.radius, `input.endView.outlineSegments[${index}].radius`, 0.1, 100_000)
      const startAngle = finite(segment.startAngle, `input.endView.outlineSegments[${index}].startAngle`, -Math.PI * 4, Math.PI * 4)
      const endAngle = finite(segment.endAngle, `input.endView.outlineSegments[${index}].endAngle`, -Math.PI * 4, Math.PI * 4)
      if (startAngle === endAngle) throw new KJValidationError(`input.endView.outlineSegments[${index}] arc sweep must not be zero`)
      return { kind: 'arc', centerOffset, radius: arcRadius, startAngle, endAngle }
    }
    if (segment.kind === 'circle') {
      exact(segment, ['kind', 'centerOffset', 'radius'], `input.endView.outlineSegments[${index}]`)
      return { kind: 'circle', centerOffset: point(segment.centerOffset, `input.endView.outlineSegments[${index}].centerOffset`),
        radius: finite(segment.radius, `input.endView.outlineSegments[${index}].radius`, 0.1, 100_000) }
    }
    throw new KJValidationError(`input.endView.outlineSegments[${index}].kind is invalid`)
  })
  if (end.cuttingPlaneMarks != null && !Array.isArray(end.cuttingPlaneMarks)) throw new KJValidationError('input.endView.cuttingPlaneMarks must be an array')
  if ((end.cuttingPlaneMarks as unknown[] | undefined)?.length && (end.cuttingPlaneMarks as unknown[]).length > 16) throw new KJValidationError('input.endView.cuttingPlaneMarks exceed their budget')
  const cuttingPlaneMarks: KJFlangeCuttingPlaneMark[] = ((end.cuttingPlaneMarks ?? []) as unknown[]).map((value, index) => {
    const mark = plain(value, `input.endView.cuttingPlaneMarks[${index}]`)
    exact(mark, ['anchorOffset', 'stemVector', 'tickVector', 'arrowhead'], `input.endView.cuttingPlaneMarks[${index}]`)
    const anchorOffset = point(mark.anchorOffset, `input.endView.cuttingPlaneMarks[${index}].anchorOffset`)
    const stemVector = point(mark.stemVector, `input.endView.cuttingPlaneMarks[${index}].stemVector`)
    const tickVector = point(mark.tickVector, `input.endView.cuttingPlaneMarks[${index}].tickVector`)
    if (stemVector[0] === 0 && stemVector[1] === 0 || tickVector[0] === 0 && tickVector[1] === 0) throw new KJValidationError(`input.endView.cuttingPlaneMarks[${index}] vectors must not have zero length`)
    const arrow = mark.arrowhead == null ? null : plain(mark.arrowhead, `input.endView.cuttingPlaneMarks[${index}].arrowhead`)
    if (arrow) exact(arrow, ['length', 'width'], `input.endView.cuttingPlaneMarks[${index}].arrowhead`)
    return { anchorOffset, stemVector, tickVector, ...(arrow ? { arrowhead: { length: finite(arrow.length, `input.endView.cuttingPlaneMarks[${index}].arrowhead.length`, 0.1, 100_000), width: finite(arrow.width, `input.endView.cuttingPlaneMarks[${index}].arrowhead.width`, 0.1, 100_000) } } : {}) }
  })
  const side = input.sideViewAxis == null ? null : plain(input.sideViewAxis, 'input.sideViewAxis')
  if (side) exact(side, ['xRange', 'symmetricProfiles', 'outlineSegments', 'sectionHatches'], 'input.sideViewAxis')
  const xRange = side ? point(side.xRange, 'input.sideViewAxis.xRange') : null
  if (xRange && xRange[0] >= xRange[1]) throw new KJValidationError('input.sideViewAxis.xRange must increase')
  if (side?.symmetricProfiles != null && !Array.isArray(side.symmetricProfiles)) throw new KJValidationError('input.sideViewAxis.symmetricProfiles must be an array')
  if ((side?.symmetricProfiles as unknown[] | undefined)?.length && (side!.symmetricProfiles as unknown[]).length > 64) throw new KJValidationError('input.sideViewAxis.symmetricProfiles exceed their budget')
  const symmetricProfiles: KJFlangeSymmetricProfile[] = ((side?.symmetricProfiles ?? []) as unknown[]).map((value, profileIndex) => {
    const profile = plain(value, `input.sideViewAxis.symmetricProfiles[${profileIndex}]`)
    exact(profile, ['vertices', 'endCaps'], `input.sideViewAxis.symmetricProfiles[${profileIndex}]`)
    if (!Array.isArray(profile.vertices) || profile.vertices.length < 2 || profile.vertices.length > 64) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices must contain 2 to 64 points`)
    const vertices = profile.vertices.map((vertexValue, vertexIndex) => {
      const vertex = plain(vertexValue, `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}]`)
      exact(vertex, ['station', 'radius'], `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}]`)
      const station = finite(vertex.station, `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}].station`, xRange![0], xRange![1])
      const radius = finite(vertex.radius, `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}].radius`, 0.1, 100_000)
      return { station, radius }
    })
    for (let index = 1; index < vertices.length; index++) {
      const previous = vertices[index - 1]!, current = vertices[index]!
      if (current.station < previous.station) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}] stations must not decrease`)
      if (current.station === previous.station && current.radius === previous.radius) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}] contains a zero-length segment`)
    }
    const endCaps = profile.endCaps ?? 'none'
    if (!['none', 'start', 'end', 'both'].includes(endCaps as string)) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}].endCaps is invalid`)
    return { vertices, endCaps } as KJFlangeSymmetricProfile
  })
  if (side?.outlineSegments != null && !Array.isArray(side.outlineSegments)) throw new KJValidationError('input.sideViewAxis.outlineSegments must be an array')
  if ((side?.outlineSegments as unknown[] | undefined)?.length && (side!.outlineSegments as unknown[]).length > 128) throw new KJValidationError('input.sideViewAxis.outlineSegments exceed their budget')
  const sideOutlineSegments: KJFlangeSideViewOutlineSegment[] = ((side?.outlineSegments ?? []) as unknown[]).map((value, index) => {
    const segment = plain(value, `input.sideViewAxis.outlineSegments[${index}]`)
    const stationOffset = (pointValue: unknown, label: string) => {
      const value = plain(pointValue, label)
      exact(value, ['station', 'offset'], label)
      return { station: finite(value.station, `${label}.station`, xRange![0], xRange![1]), offset: finite(value.offset, `${label}.offset`, -100_000, 100_000) }
    }
    if (segment.kind === 'line') {
      exact(segment, ['kind', 'start', 'end'], `input.sideViewAxis.outlineSegments[${index}]`)
      const start = stationOffset(segment.start, `input.sideViewAxis.outlineSegments[${index}].start`)
      const end = stationOffset(segment.end, `input.sideViewAxis.outlineSegments[${index}].end`)
      if (start.station === end.station && start.offset === end.offset) throw new KJValidationError(`input.sideViewAxis.outlineSegments[${index}] must not have zero length`)
      return { kind: 'line', start, end }
    }
    if (segment.kind === 'arc') {
      exact(segment, ['kind', 'center', 'radius', 'startAngle', 'endAngle'], `input.sideViewAxis.outlineSegments[${index}]`)
      const arcCenter = stationOffset(segment.center, `input.sideViewAxis.outlineSegments[${index}].center`)
      const arcRadius = finite(segment.radius, `input.sideViewAxis.outlineSegments[${index}].radius`, 0.1, 100_000)
      const startAngle = finite(segment.startAngle, `input.sideViewAxis.outlineSegments[${index}].startAngle`, -Math.PI * 4, Math.PI * 4)
      const endAngle = finite(segment.endAngle, `input.sideViewAxis.outlineSegments[${index}].endAngle`, -Math.PI * 4, Math.PI * 4)
      if (startAngle === endAngle) throw new KJValidationError(`input.sideViewAxis.outlineSegments[${index}] arc sweep must not be zero`)
      return { kind: 'arc', center: arcCenter, radius: arcRadius, startAngle, endAngle }
    }
    if (segment.kind === 'circle') {
      exact(segment, ['kind', 'center', 'radius'], `input.sideViewAxis.outlineSegments[${index}]`)
      return { kind: 'circle', center: stationOffset(segment.center, `input.sideViewAxis.outlineSegments[${index}].center`),
        radius: finite(segment.radius, `input.sideViewAxis.outlineSegments[${index}].radius`, 0.1, 100_000) }
    }
    throw new KJValidationError(`input.sideViewAxis.outlineSegments[${index}].kind is invalid`)
  })
  if (side?.sectionHatches != null && !Array.isArray(side.sectionHatches)) throw new KJValidationError('input.sideViewAxis.sectionHatches must be an array')
  if ((side?.sectionHatches as unknown[] | undefined)?.length && (side!.sectionHatches as unknown[]).length > 32) throw new KJValidationError('input.sideViewAxis.sectionHatches exceed their budget')
  const sectionHatches: KJFlangeSectionHatch[] = ((side?.sectionHatches ?? []) as unknown[]).map((value, hatchIndex) => {
    const label = `input.sideViewAxis.sectionHatches[${hatchIndex}]`, hatch = plain(value, label)
    exact(hatch, ['edges', 'lineAngle', 'lineSpacing', 'patternOrigin'], label)
    if (!Array.isArray(hatch.edges) || hatch.edges.length < 3 || hatch.edges.length > 128) throw new KJValidationError(`${label}.edges must contain 3 to 128 edges`)
    const localPoint = (value: unknown, label: string) => {
      const coordinate = plain(value, label); exact(coordinate, ['station', 'offset'], label)
      return { station: finite(coordinate.station, `${label}.station`, xRange![0], xRange![1]), offset: finite(coordinate.offset, `${label}.offset`, -100_000, 100_000) }
    }
    const edges = hatch.edges.map((value, edgeIndex) => {
      const labelEdge = `${label}.edges[${edgeIndex}]`, edge = plain(value, labelEdge)
      if (edge.kind === 'line') {
        exact(edge, ['kind', 'start', 'end'], labelEdge)
        const start = localPoint(edge.start, `${labelEdge}.start`), end = localPoint(edge.end, `${labelEdge}.end`)
        if (start.station === end.station && start.offset === end.offset) throw new KJValidationError(`${labelEdge} must not have zero length`)
        return { kind: 'line' as const, start, end }
      }
      if (edge.kind === 'arc') {
        exact(edge, ['kind', 'center', 'radius', 'startAngle', 'endAngle', 'counterClockwise'], labelEdge)
        if (edge.counterClockwise != null && typeof edge.counterClockwise !== 'boolean') throw new KJValidationError(`${labelEdge}.counterClockwise must be boolean`)
        const startAngle = finite(edge.startAngle, `${labelEdge}.startAngle`, -Math.PI * 4, Math.PI * 4)
        const endAngle = finite(edge.endAngle, `${labelEdge}.endAngle`, -Math.PI * 4, Math.PI * 4)
        if (startAngle === endAngle) throw new KJValidationError(`${labelEdge} arc sweep must not be zero`)
        return { kind: 'arc' as const, center: localPoint(edge.center, `${labelEdge}.center`),
          radius: finite(edge.radius, `${labelEdge}.radius`, 0.1, 100_000), startAngle, endAngle, counterClockwise: edge.counterClockwise !== false }
      }
      throw new KJValidationError(`${labelEdge}.kind is invalid`)
    })
    const lineAngle = finite(hatch.lineAngle, `${label}.lineAngle`, -Math.PI * 2, Math.PI * 2)
    const lineSpacing = finite(hatch.lineSpacing, `${label}.lineSpacing`, 0.01, 100_000)
    const patternOrigin = hatch.patternOrigin == null ? [0, 0] as Point2 : point(hatch.patternOrigin, `${label}.patternOrigin`)
    return { edges, lineAngle, lineSpacing, patternOrigin }
  })
  const sheet = plain(input.sheet, 'input.sheet'); exact(sheet, ['origin', 'size', 'inset', 'titleGrid', 'notes'], 'input.sheet')
  const sheetOrigin = point(sheet.origin, 'input.sheet.origin'), sheetSize = point(sheet.size, 'input.sheet.size')
  if (sheetSize[0] < 100 || sheetSize[1] < 100) throw new KJValidationError('input.sheet.size is too small')
  const inset = finite(sheet.inset, 'input.sheet.inset', 0, Math.min(...sheetSize) / 2 - 1)
  const grid = sheet.titleGrid == null ? null : plain(sheet.titleGrid, 'input.sheet.titleGrid')
  if (grid) exact(grid, ['origin', 'size', 'columns', 'partialColumns', 'rows', 'horizontalSegments', 'verticalSegments', 'diagonalHeader'], 'input.sheet.titleGrid')
  let titleGrid: KJFlangeTitleGrid | null = null
  if (grid) {
    const origin = point(grid.origin, 'input.sheet.titleGrid.origin'), size = point(grid.size, 'input.sheet.titleGrid.size')
    if (size[0] <= 0 || size[1] <= 0 || origin[0] < sheetOrigin[0] + inset || origin[1] < sheetOrigin[1] + inset
      || origin[0] + size[0] > sheetOrigin[0] + sheetSize[0] - inset || origin[1] + size[1] > sheetOrigin[1] + sheetSize[1] - inset) throw new KJValidationError('title grid must lie inside the inset frame')
    const columns = increasing(grid.columns, 'input.sheet.titleGrid.columns', 32, 0, size[0])
    if (!Array.isArray(grid.rows) || grid.rows.length > 16) throw new KJValidationError('title grid rows exceed their budget')
    const rows = grid.rows.map((value, index) => {
      const entry = plain(value, `input.sheet.titleGrid.rows[${index}]`); exact(entry, ['offset', 'breaks'], `input.sheet.titleGrid.rows[${index}]`)
      return { offset: finite(entry.offset, `input.sheet.titleGrid.rows[${index}].offset`, 0, size[1]), breaks: increasing(entry.breaks ?? [], `input.sheet.titleGrid.rows[${index}].breaks`, 16, 0, size[0]) }
    })
    if (rows.some((row, index) => index > 0 && row.offset <= rows[index - 1]!.offset)) throw new KJValidationError('title grid row offsets must increase')
    if (!Array.isArray(grid.partialColumns) && grid.partialColumns != null) throw new KJValidationError('title grid partialColumns must be an array')
    if ((grid.partialColumns as unknown[] | undefined)?.length && (grid.partialColumns as unknown[]).length > 16) throw new KJValidationError('title grid partialColumns exceed their budget')
    const partialColumns = ((grid.partialColumns ?? []) as unknown[]).map((value, index) => {
      const entry = plain(value, `input.sheet.titleGrid.partialColumns[${index}]`); exact(entry, ['offset', 'height'], `input.sheet.titleGrid.partialColumns[${index}]`)
      return { offset: finite(entry.offset, `input.sheet.titleGrid.partialColumns[${index}].offset`, 0, size[0]), height: finite(entry.height, `input.sheet.titleGrid.partialColumns[${index}].height`, 0, size[1]) }
    })
    const segments = (value: unknown, label: string, offsetMax: number, spanMax: number) => {
      if (value != null && !Array.isArray(value)) throw new KJValidationError(`${label} must be an array`)
      if ((value as unknown[] | undefined)?.length && (value as unknown[]).length > 64) throw new KJValidationError(`${label} exceed their budget`)
      return ((value ?? []) as unknown[]).map((segmentValue, index) => {
        const entry = plain(segmentValue, `${label}[${index}]`)
        exact(entry, ['offset', 'start', 'end'], `${label}[${index}]`)
        const segment = {
          offset: finite(entry.offset, `${label}[${index}].offset`, 0, offsetMax),
          start: finite(entry.start, `${label}[${index}].start`, 0, spanMax),
          end: finite(entry.end, `${label}[${index}].end`, 0, spanMax),
        }
        if (segment.start >= segment.end) throw new KJValidationError(`${label}[${index}] start must be less than end`)
        return segment
      })
    }
    const horizontalSegments = segments(grid.horizontalSegments, 'input.sheet.titleGrid.horizontalSegments', size[1], size[0])
    const verticalSegments = segments(grid.verticalSegments, 'input.sheet.titleGrid.verticalSegments', size[0], size[1])
    const diagonal = grid.diagonalHeader == null ? null : plain(grid.diagonalHeader, 'input.sheet.titleGrid.diagonalHeader')
    if (diagonal) exact(diagonal, ['width', 'drop'], 'input.sheet.titleGrid.diagonalHeader')
    titleGrid = { origin, size, columns, rows, partialColumns, horizontalSegments, verticalSegments,
      ...(diagonal ? { diagonalHeader: { width: finite(diagonal.width, 'input.sheet.titleGrid.diagonalHeader.width', 0, size[0]), drop: finite(diagonal.drop, 'input.sheet.titleGrid.diagonalHeader.drop', 0, size[1]) } } : {}) }
  }
  if (sheet.notes != null && !Array.isArray(sheet.notes)) throw new KJValidationError('input.sheet.notes must be an array')
  if ((sheet.notes as unknown[] | undefined)?.length && (sheet.notes as unknown[]).length > 128) throw new KJValidationError('input.sheet.notes exceed their budget')
  let noteCharacters = 0
  const notes: KJFlangeSheetNote[] = ((sheet.notes ?? []) as unknown[]).map((value, index) => {
    const note = plain(value, `input.sheet.notes[${index}]`)
    exact(note, ['kind', 'text', 'position', 'height', 'rotation', 'width'], `input.sheet.notes[${index}]`)
    if (note.kind !== 'single-line' && note.kind !== 'multiline') throw new KJValidationError(`input.sheet.notes[${index}].kind is invalid`)
    if (typeof note.text !== 'string' || !note.text || note.text.length > 512 || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(note.text)) throw new KJValidationError(`input.sheet.notes[${index}].text must be bounded visible text`)
    if (note.kind === 'single-line' && /[\r\n]/u.test(note.text)) throw new KJValidationError(`input.sheet.notes[${index}].text must stay on one line`)
    const text = note.kind === 'multiline' ? note.text.replace(/\r\n?|\n/gu, '\\P') : note.text
    noteCharacters += text.length
    if (noteCharacters > 8_192) throw new KJValidationError('input.sheet.notes exceed the text budget')
    const position = point(note.position, `input.sheet.notes[${index}].position`)
    if (position[0] < sheetOrigin[0] || position[0] > sheetOrigin[0] + sheetSize[0] || position[1] < sheetOrigin[1] || position[1] > sheetOrigin[1] + sheetSize[1]) throw new KJValidationError(`input.sheet.notes[${index}].position must lie on the sheet`)
    const height = finite(note.height, `input.sheet.notes[${index}].height`, 0.1, Math.min(...sheetSize) / 4)
    const rotation = note.rotation == null ? 0 : finite(note.rotation, `input.sheet.notes[${index}].rotation`, -Math.PI * 2, Math.PI * 2)
    const width = note.width == null ? undefined : finite(note.width, `input.sheet.notes[${index}].width`, 0.1, sheetSize[0])
    if (note.kind === 'single-line' && width != null) throw new KJValidationError(`input.sheet.notes[${index}].width is only valid for multiline text`)
    return { kind: note.kind, text, position, height, rotation, ...(width == null ? {} : { width }) }
  })
  if (input.dimensions != null && !Array.isArray(input.dimensions)) throw new KJValidationError('input.dimensions must be an array')
  if ((input.dimensions as unknown[] | undefined)?.length && (input.dimensions as unknown[]).length > 128) throw new KJValidationError('input.dimensions exceed their budget')
  const dimensions: KJFlangeDimension[] = ((input.dimensions ?? []) as unknown[]).map((value, index) => {
    const dimension = plain(value, `input.dimensions[${index}]`)
    exact(dimension, ['kind', 'definitionPoints', 'textPosition', 'textOverride', 'rotation'], `input.dimensions[${index}]`)
    if (!['aligned', 'rotated', 'diameter', 'radius', 'angular'].includes(dimension.kind as string)) throw new KJValidationError(`input.dimensions[${index}].kind is invalid`)
    const requiredPoints = dimension.kind === 'angular' ? 5 : ['diameter', 'radius'].includes(dimension.kind as string) ? 2 : 3
    if (!Array.isArray(dimension.definitionPoints) || dimension.definitionPoints.length !== requiredPoints) throw new KJValidationError(`input.dimensions[${index}].definitionPoints must contain ${requiredPoints} points`)
    const definitionPoints = dimension.definitionPoints.map((value, pointIndex) => point(value, `input.dimensions[${index}].definitionPoints[${pointIndex}]`))
    const textPosition = dimension.textPosition == null ? undefined : point(dimension.textPosition, `input.dimensions[${index}].textPosition`)
    const textOverride = dimension.textOverride == null ? undefined : dimension.textOverride
    if (textOverride != null && (typeof textOverride !== 'string' || textOverride.length > 128 || /[\r\n\u0000-\u001f\u007f]/u.test(textOverride))) throw new KJValidationError(`input.dimensions[${index}].textOverride must be bounded single-line text`)
    const rotation = dimension.rotation == null ? 0 : finite(dimension.rotation, `input.dimensions[${index}].rotation`, -Math.PI * 2, Math.PI * 2)
    const dimensionType = String(dimension.kind).toUpperCase()
    const payload = { dimensionType, definitionPoints: definitionPoints.map(([x, y]) => [x, y, 0]),
      ...(textPosition == null ? {} : { textPosition: [...textPosition, 0] }), textOverride: textOverride ?? null, rotation }
    if (!projectDimension(payload)) throw new KJValidationError(`input.dimensions[${index}] does not define a projectable native dimension`)
    return { kind: dimension.kind as KJFlangeDimension['kind'], definitionPoints, ...(textPosition == null ? {} : { textPosition }),
      ...(textOverride == null ? {} : { textOverride }), rotation }
  })
  if (input.leaders != null && !Array.isArray(input.leaders)) throw new KJValidationError('input.leaders must be an array')
  if ((input.leaders as unknown[] | undefined)?.length && (input.leaders as unknown[]).length > 64) throw new KJValidationError('input.leaders exceed their budget')
  const leaders: KJFlangeLeader[] = ((input.leaders ?? []) as unknown[]).map((value, index) => {
    const leader = plain(value, `input.leaders[${index}]`)
    exact(leader, ['vertices', 'arrowEnabled', 'pathType', 'annotationType', 'hookLineDirection', 'hookLineEnabled'], `input.leaders[${index}]`)
    if (!Array.isArray(leader.vertices) || leader.vertices.length < 2 || leader.vertices.length > 64) throw new KJValidationError(`input.leaders[${index}].vertices must contain 2 to 64 points`)
    const vertices = leader.vertices.map((value, pointIndex) => point(value, `input.leaders[${index}].vertices[${pointIndex}]`))
    const integer = (value: unknown, label: string, max: number) => value == null ? 0 : finite(value, label, 0, max)
    return { vertices, arrowEnabled: leader.arrowEnabled == null ? true : leader.arrowEnabled === true,
      pathType: integer(leader.pathType, `input.leaders[${index}].pathType`, 1), annotationType: integer(leader.annotationType, `input.leaders[${index}].annotationType`, 3),
      hookLineDirection: integer(leader.hookLineDirection, `input.leaders[${index}].hookLineDirection`, 1), hookLineEnabled: leader.hookLineEnabled === true }
  })
  return { expectedRevision, drawingId: input.drawingId.trim(), center, ringRadii, pitch, radius, outlineSegments, cuttingPlaneMarks, xRange, symmetricProfiles, sideOutlineSegments, sectionHatches, dimensions, leaders, sheetOrigin, sheetSize, inset, titleGrid, notes }
}

/** Compile reusable flange and sheet facts; incomplete views remain incomplete. */
export function buildAgentMechanicalFlangeCore(document: Document, source: KJAgentMechanicalFlangeCoreInput) {
  const input = validate(document, source), prefix = `flange-${stableHash({ id: input.drawingId, version: KJDRAW_MECHANICAL_FLANGE_CORE_VERSION }).slice(0, 12)}`
  const linetypeId = `${prefix}-continuous`, geometryLayerId = `${prefix}-geometry`, sheetLayerId = `${prefix}-sheet`, centerLayerId = `${prefix}-center`, noteLayerId = `${prefix}-notes`
  const entities: Entity[] = [], p3 = (x: number, y: number): Point3 => [x, y, 0]
  const emit = (type: Entity['type'], payload: Record<string, unknown>) => entities.push({ type, payload, options: { id: `${prefix}-${String(entities.length + 1).padStart(4, '0')}` } })
  const line = (a: Point2, b: Point2, layerId = sheetLayerId) => emit('LINE', { start: p3(...a), end: p3(...b), layerId })
  const rectangle = (origin: Point2, size: Point2) => {
    const [x, y] = origin, [w, h] = size
    line([x, y], [x + w, y]); line([x + w, y], [x + w, y + h]); line([x + w, y + h], [x, y + h]); line([x, y + h], [x, y])
  }
  const [cx, cy] = input.center
  for (const ringRadius of input.ringRadii) emit('CIRCLE', { center: p3(cx, cy), radius: ringRadius, layerId: geometryLayerId })
  const halfPitch = input.pitch / 2
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) emit('CIRCLE', { center: p3(cx + dx * halfPitch, cy + dy * halfPitch), radius: input.radius, layerId: geometryLayerId })
  for (const segment of input.outlineSegments) {
    if (segment.kind === 'line') line([cx + segment.startOffset[0], cy + segment.startOffset[1]], [cx + segment.endOffset[0], cy + segment.endOffset[1]], geometryLayerId)
    else if (segment.kind === 'arc') emit('ARC', { center: p3(cx + segment.centerOffset[0], cy + segment.centerOffset[1]), radius: segment.radius,
      startAngle: segment.startAngle, endAngle: segment.endAngle, layerId: geometryLayerId })
    else emit('CIRCLE', { center: p3(cx + segment.centerOffset[0], cy + segment.centerOffset[1]), radius: segment.radius, layerId: geometryLayerId })
  }
  for (const mark of input.cuttingPlaneMarks) {
    const anchor: Point2 = [cx + mark.anchorOffset[0], cy + mark.anchorOffset[1]]
    line(anchor, [anchor[0] + mark.stemVector[0], anchor[1] + mark.stemVector[1]], noteLayerId)
    line(anchor, [anchor[0] + mark.tickVector[0], anchor[1] + mark.tickVector[1]], noteLayerId)
    if (mark.arrowhead) {
      const tip: Point2 = [anchor[0] + mark.tickVector[0], anchor[1] + mark.tickVector[1]], norm = Math.hypot(mark.tickVector[0], mark.tickVector[1])
      const unit: Point2 = [mark.tickVector[0] / norm, mark.tickVector[1] / norm], perpendicular: Point2 = [-unit[1], unit[0]]
      const base: Point2 = [tip[0] - unit[0] * mark.arrowhead.length, tip[1] - unit[1] * mark.arrowhead.length]
      const half = mark.arrowhead.width / 2
      const a: Point2 = [base[0] + perpendicular[0] * half, base[1] + perpendicular[1] * half]
      const b: Point2 = [base[0] - perpendicular[0] * half, base[1] - perpendicular[1] * half]
      emit('SOLID', { vertices: [p3(...tip), p3(...a), p3(...b), p3(...b)], layerId: noteLayerId })
    }
  }
  rectangle(input.sheetOrigin, input.sheetSize)
  rectangle([input.sheetOrigin[0] + input.inset, input.sheetOrigin[1] + input.inset], [input.sheetSize[0] - input.inset * 2, input.sheetSize[1] - input.inset * 2])
  if (input.titleGrid) {
    const grid = input.titleGrid, [x, y] = grid.origin, [w, h] = grid.size
    line([x, y + h], [x + w, y + h])
    for (const offset of grid.columns) line([x + offset, y], [x + offset, y + h])
    for (const column of grid.partialColumns ?? []) line([x + column.offset, y], [x + column.offset, y + column.height])
    for (const row of grid.rows) {
      const spans = [0, ...(row.breaks ?? []), w]
      for (let index = 0; index < spans.length - 1; index++) line([x + spans[index]!, y + row.offset], [x + spans[index + 1]!, y + row.offset])
    }
    for (const segment of grid.horizontalSegments ?? []) line([x + segment.start, y + segment.offset], [x + segment.end, y + segment.offset])
    for (const segment of grid.verticalSegments ?? []) line([x + segment.offset, y + segment.start], [x + segment.offset, y + segment.end])
    if (grid.diagonalHeader) line([x, y + h], [x + grid.diagonalHeader.width, y + h - grid.diagonalHeader.drop])
  }
  if (input.xRange) line([input.xRange[0], cy], [input.xRange[1], cy], centerLayerId)
  for (const profile of input.symmetricProfiles) {
    for (let index = 1; index < profile.vertices.length; index++) {
      const previous = profile.vertices[index - 1]!, current = profile.vertices[index]!
      line([previous.station, cy + previous.radius], [current.station, cy + current.radius], geometryLayerId)
      line([previous.station, cy - previous.radius], [current.station, cy - current.radius], geometryLayerId)
    }
    const start = profile.vertices[0]!, end = profile.vertices.at(-1)!
    if (profile.endCaps === 'start' || profile.endCaps === 'both') line([start.station, cy - start.radius], [start.station, cy + start.radius], geometryLayerId)
    if (profile.endCaps === 'end' || profile.endCaps === 'both') line([end.station, cy - end.radius], [end.station, cy + end.radius], geometryLayerId)
  }
  for (const segment of input.sideOutlineSegments) {
    if (segment.kind === 'line') line([segment.start.station, cy + segment.start.offset], [segment.end.station, cy + segment.end.offset], geometryLayerId)
    else if (segment.kind === 'arc') emit('ARC', { center: p3(segment.center.station, cy + segment.center.offset), radius: segment.radius,
      startAngle: segment.startAngle, endAngle: segment.endAngle, layerId: geometryLayerId })
    else emit('CIRCLE', { center: p3(segment.center.station, cy + segment.center.offset), radius: segment.radius, layerId: geometryLayerId })
  }
  for (const hatch of input.sectionHatches) emit('HATCH', { boundaryLoops: [{ external: false, flags: 0, edges: hatch.edges.map(edge => edge.kind === 'line'
    ? { type: 'LINE', start: p3(edge.start.station, cy + edge.start.offset), end: p3(edge.end.station, cy + edge.end.offset) }
    : { type: 'ARC', center: p3(edge.center.station, cy + edge.center.offset), radius: edge.radius,
      startAngle: edge.startAngle, endAngle: edge.endAngle, counterClockwise: edge.counterClockwise !== false }) }],
    patternName: 'ANSI31', solid: false, associative: false, patternAngle: 0, patternScale: 1,
    patternLines: [{ angle: hatch.lineAngle, base: hatch.patternOrigin, offset: [-Math.sin(hatch.lineAngle) * hatch.lineSpacing, Math.cos(hatch.lineAngle) * hatch.lineSpacing], dashes: [] }],
    patternDefinitionAngle: 0, patternDefinitionScale: 1, layerId: geometryLayerId })
  for (const note of input.notes) emit(note.kind === 'single-line' ? 'TEXT' : 'MTEXT', {
    position: p3(...note.position), text: note.text, height: note.height, rotation: note.rotation,
    ...(note.width == null ? {} : { width: note.width }), layerId: noteLayerId,
  })
  for (const dimension of input.dimensions) emit('DIMENSION', {
    dimensionType: dimension.kind.toUpperCase(), definitionPoints: dimension.definitionPoints.map(([x, y]) => p3(x, y)),
    ...(dimension.textPosition == null ? {} : { textPosition: p3(...dimension.textPosition) }),
    textOverride: dimension.textOverride ?? null, rotation: dimension.rotation ?? 0, styleName: 'STANDARD', layerId: noteLayerId,
  })
  for (const leader of input.leaders) emit('LEADER', { vertices: leader.vertices.map(([x, y]) => p3(x, y)), annotationId: null, ownsAnnotation: false,
    arrowEnabled: leader.arrowEnabled !== false, pathType: leader.pathType ?? 0, annotationType: leader.annotationType ?? 3,
    hookLineDirection: leader.hookLineDirection ?? 0, hookLineEnabled: leader.hookLineEnabled === true, layerId: noteLayerId })
  return {
    commandArgs: { entities, resources: {
      linetypes: [{ id: linetypeId, name: `${prefix}_CONT`, pattern: [] }],
      layers: [
        { id: geometryLayerId, name: 'FLANGE_GEOMETRY', color: 7, linetypeId, lineweight: 35 },
        { id: sheetLayerId, name: 'FLANGE_SHEET', color: 7, linetypeId, lineweight: 18 },
        { id: centerLayerId, name: 'FLANGE_CENTER', color: 7, linetypeId, lineweight: 18 },
        { id: noteLayerId, name: 'FLANGE_NOTES', color: 7, linetypeId, lineweight: 18 },
      ],
    } },
    evidence: { knowledgePackId: KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK.id,
      knowledgePackVersion: KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK.version,
      expectedRevision: input.expectedRevision, entityCount: entities.length,
      parameters: { ringCount: input.ringRadii.length, squareHolePitch: input.pitch, squareHoleRadius: input.radius, titleGrid: input.titleGrid != null, sideViewAxis: input.xRange != null,
        outlineSegmentCount: input.outlineSegments.length, cuttingPlaneMarkCount: input.cuttingPlaneMarks.length,
        symmetricProfileCount: input.symmetricProfiles.length, sideOutlineSegmentCount: input.sideOutlineSegments.length,
        sectionHatchCount: input.sectionHatches.length, noteCount: input.notes.length, dimensionCount: input.dimensions.length, leaderCount: input.leaders.length },
      limitations: ['Flange end-view, symmetric axial-profile, cut-face hatches, native dimension and sheet-grid core only', 'Does not generate attributes or arbitrary blocks', 'Private drawings and labels are not embedded'],
    },
  }
}
