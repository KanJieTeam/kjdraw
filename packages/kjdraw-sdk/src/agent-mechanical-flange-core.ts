import { KJValidationError } from './errors.js'
import { projectDimension } from './geometry/annotation.js'
import { KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK } from './knowledge-packs/mechanical-flange-core.js'
import { stableHash } from './utils.js'

export const KJDRAW_MECHANICAL_FLANGE_CORE_VERSION = '1.0.0' as const
type Point2 = [number, number]
type Point3 = [number, number, number]
type Entity = { type: 'LINE' | 'CIRCLE' | 'TEXT' | 'MTEXT' | 'DIMENSION'; payload: Record<string, unknown>; options: { id: string } }
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

export interface KJAgentMechanicalFlangeCoreInput {
  version: typeof KJDRAW_MECHANICAL_FLANGE_CORE_VERSION
  expectedRevision: number
  units: 'millimeter'
  drawingId: string
  endView: { center: Point2; ringRadii: number[]; squareHoles: { pitch: number; radius: number } }
  sideViewAxis?: { xRange: Point2; symmetricProfiles?: KJFlangeSymmetricProfile[] }
  dimensions?: KJFlangeDimension[]
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
  const input = plain(source, 'input'); exact(input, ['version', 'expectedRevision', 'units', 'drawingId', 'endView', 'sideViewAxis', 'dimensions', 'sheet'], 'input')
  if (input.version !== KJDRAW_MECHANICAL_FLANGE_CORE_VERSION) throw new KJValidationError(`input.version must be ${KJDRAW_MECHANICAL_FLANGE_CORE_VERSION}`)
  if (input.units !== 'millimeter' || document.snapshot().header?.units !== 'millimeter') throw new KJValidationError('Flange compiler requires millimeter units')
  const expectedRevision = finite(input.expectedRevision, 'input.expectedRevision', 0, Number.MAX_SAFE_INTEGER)
  if (!Number.isInteger(expectedRevision) || expectedRevision !== document.revision) throw new KJValidationError('input.expectedRevision must match the document revision')
  if (typeof input.drawingId !== 'string' || !input.drawingId.trim() || input.drawingId.length > 96 || /[\u0000-\u001f\u007f]/u.test(input.drawingId)) throw new KJValidationError('input.drawingId must be printable text')
  const end = plain(input.endView, 'input.endView'); exact(end, ['center', 'ringRadii', 'squareHoles'], 'input.endView')
  const center = point(end.center, 'input.endView.center')
  const ringRadii = increasing(end.ringRadii, 'input.endView.ringRadii', 16, 0.1, 100_000)
  if (ringRadii.length < 2) throw new KJValidationError('input.endView.ringRadii requires at least two radii')
  const holes = plain(end.squareHoles, 'input.endView.squareHoles'); exact(holes, ['pitch', 'radius'], 'input.endView.squareHoles')
  const pitch = finite(holes.pitch, 'input.endView.squareHoles.pitch', 0.1, 100_000)
  const radius = finite(holes.radius, 'input.endView.squareHoles.radius', 0.1, 100_000)
  if (pitch <= radius * 2) throw new KJValidationError('square-hole pitch must exceed the hole diameter')
  const side = input.sideViewAxis == null ? null : plain(input.sideViewAxis, 'input.sideViewAxis')
  if (side) exact(side, ['xRange', 'symmetricProfiles'], 'input.sideViewAxis')
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
  return { expectedRevision, drawingId: input.drawingId.trim(), center, ringRadii, pitch, radius, xRange, symmetricProfiles, dimensions, sheetOrigin, sheetSize, inset, titleGrid, notes }
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
  for (const note of input.notes) emit(note.kind === 'single-line' ? 'TEXT' : 'MTEXT', {
    position: p3(...note.position), text: note.text, height: note.height, rotation: note.rotation,
    ...(note.width == null ? {} : { width: note.width }), layerId: noteLayerId,
  })
  for (const dimension of input.dimensions) emit('DIMENSION', {
    dimensionType: dimension.kind.toUpperCase(), definitionPoints: dimension.definitionPoints.map(([x, y]) => p3(x, y)),
    ...(dimension.textPosition == null ? {} : { textPosition: p3(...dimension.textPosition) }),
    textOverride: dimension.textOverride ?? null, rotation: dimension.rotation ?? 0, styleName: 'STANDARD', layerId: noteLayerId,
  })
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
        symmetricProfileCount: input.symmetricProfiles.length, noteCount: input.notes.length, dimensionCount: input.dimensions.length },
      limitations: ['Flange end-view, symmetric axial-profile, native dimension and sheet-grid core only', 'Does not generate attributes or hatches', 'Private drawings and labels are not embedded'],
    },
  }
}
