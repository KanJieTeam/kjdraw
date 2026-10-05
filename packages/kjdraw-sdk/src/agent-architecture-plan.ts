import { KJValidationError } from './errors.js'
import { stableHash } from './utils.js'

export const KJDRAW_ARCHITECTURE_PLAN_VERSION = '1.0.0' as const

export type KJArchitectureWallReference = 'north' | 'south' | 'east' | 'west' | string
export type KJArchitectureOpeningKind = 'door' | 'window'

export interface KJAgentArchitectureOpening {
  wall: KJArchitectureWallReference
  offset: number
  width: number
  kind: KJArchitectureOpeningKind
}

export interface KJAgentArchitecturePartitionOpening {
  offset: number
  width: number
  kind: KJArchitectureOpeningKind
}

export interface KJAgentArchitecturePartition {
  id: string
  axis: 'horizontal' | 'vertical'
  position: number
  start: number
  end: number
  openings?: KJAgentArchitecturePartitionOpening[]
}

export interface KJAgentArchitectureRoom {
  id: string
  name: string
  bounds: [number, number, number, number]
}

export interface KJAgentArchitecturePlanInput {
  version: typeof KJDRAW_ARCHITECTURE_PLAN_VERSION
  expectedRevision: number
  units: 'millimeter'
  locale?: 'zh-CN' | 'en'
  drawingId: string
  title: string
  width: number
  depth: number
  wallThickness: number
  exteriorOpenings?: KJAgentArchitectureOpening[]
  partitions?: KJAgentArchitecturePartition[]
  rooms: KJAgentArchitectureRoom[]
  textHeight?: number
}

interface ArchitectureDocument {
  id: string
  revision: number
  snapshot(): { header?: { units?: string } }
  listEntities(): readonly unknown[]
}

type Point3 = [number, number, number]
type EntitySpec = { type: string; payload: Record<string, unknown>; options: { id: string } }
type BlockSpec = { id: string; name: string; basePoint: Point3; entities: EntitySpec[] }
type Interval = { start: number; end: number; kind: KJArchitectureOpeningKind; width: number }

const INPUT_KEYS = ['version', 'expectedRevision', 'units', 'locale', 'drawingId', 'title', 'width', 'depth', 'wallThickness', 'exteriorOpenings', 'partitions', 'rooms', 'textHeight']
const EXTERIOR_OPENING_KEYS = ['wall', 'offset', 'width', 'kind']
const PARTITION_KEYS = ['id', 'axis', 'position', 'start', 'end', 'openings']
const PARTITION_OPENING_KEYS = ['offset', 'width', 'kind']
const ROOM_KEYS = ['id', 'name', 'bounds']
const OUTER_WALLS = new Set(['north', 'south', 'east', 'west'])
const MAX_ENTITY_COUNT = 512
const MAX_BLOCKS = 16
const EPSILON = 1e-7

function plain(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KJValidationError(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new KJValidationError(`${label} must be a plain object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) throw new KJValidationError(`${label} contains unsupported field: ${unknown[0]}`)
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new KJValidationError(`${label} must be a string`)
  const result = value.trim()
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new KJValidationError(`${label} must contain 1-${maximum} printable characters`)
  return result
}

function identifier(value: unknown, label: string): string {
  const result = boundedString(value, label, 64)
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(result)) throw new KJValidationError(`${label} must start with a letter and contain only letters, numbers, _ or -`)
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

function numericTuple(value: unknown, label: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new KJValidationError(`${label} must contain exactly ${length} numbers`)
  return value.map((item, index) => boundedNumber(item, `${label}[${index}]`, -1_000_000, 1_000_000))
}

function openingKind(value: unknown, label: string): KJArchitectureOpeningKind {
  if (value !== 'door' && value !== 'window') throw new KJValidationError(`${label} must be door or window`)
  return value
}

function validateIntervals(intervals: Interval[], length: number, endClearance: number, label: string): Interval[] {
  const sorted = [...intervals].sort((left, right) => left.start - right.start || left.end - right.end)
  for (let index = 0; index < sorted.length; index += 1) {
    const interval = sorted[index]!
    if (interval.start < endClearance - EPSILON || interval.end > length - endClearance + EPSILON) {
      throw new KJValidationError(`${label}[${index}] must leave wall material at both ends`)
    }
    if (index > 0 && interval.start < sorted[index - 1]!.end + endClearance - EPSILON) {
      throw new KJValidationError(`${label} openings overlap or leave insufficient wall material`)
    }
  }
  return sorted
}

function rectangleIntersects(left: [number, number, number, number], right: [number, number, number, number]): boolean {
  return Math.min(left[0] + left[2], right[0] + right[2]) - Math.max(left[0], right[0]) > EPSILON
    && Math.min(left[1] + left[3], right[1] + right[3]) - Math.max(left[1], right[1]) > EPSILON
}

function validateInput(document: ArchitectureDocument, source: KJAgentArchitecturePlanInput) {
  if (!document || typeof document.id !== 'string' || !Number.isInteger(document.revision) || typeof document.snapshot !== 'function' || typeof document.listEntities !== 'function') {
    throw new KJValidationError('Architecture plan compiler requires a KJDraw document')
  }
  if (document.listEntities().length !== 0) throw new KJValidationError('Architecture plan compiler requires a blank document')
  const input = plain(source, 'input')
  exactKeys(input, INPUT_KEYS, 'input')
  if (input.version !== KJDRAW_ARCHITECTURE_PLAN_VERSION) throw new KJValidationError(`input.version must be ${KJDRAW_ARCHITECTURE_PLAN_VERSION}`)
  if (input.units !== 'millimeter') throw new KJValidationError('input.units must be millimeter')
  const expectedRevision = boundedInteger(input.expectedRevision, 'input.expectedRevision', 0, Number.MAX_SAFE_INTEGER)
  if (expectedRevision !== document.revision) throw new KJValidationError(`input.expectedRevision ${expectedRevision} does not match document revision ${document.revision}`)
  if (document.snapshot()?.header?.units !== 'millimeter') throw new KJValidationError('Architecture plan compiler requires a millimeter document')

  const width = boundedNumber(input.width, 'input.width', 3_000, 34_000)
  const depth = boundedNumber(input.depth, 'input.depth', 3_000, 22_000)
  const wallThickness = boundedNumber(input.wallThickness, 'input.wallThickness', 80, 600)
  if (wallThickness * 6 >= Math.min(width, depth)) throw new KJValidationError('input.wallThickness leaves insufficient usable floor area')
  const textHeight = input.textHeight == null ? 250 : boundedNumber(input.textHeight, 'input.textHeight', 100, 500)

  const partitionSource = input.partitions ?? []
  if (!Array.isArray(partitionSource) || partitionSource.length > 24) throw new KJValidationError('input.partitions must contain at most 24 partitions')
  const partitionIds = new Set<string>()
  let totalOpeningCount = 0
  const partitions = partitionSource.map((source: unknown, index: number) => {
    const partition = plain(source, `input.partitions[${index}]`)
    exactKeys(partition, PARTITION_KEYS, `input.partitions[${index}]`)
    const id = identifier(partition.id, `input.partitions[${index}].id`)
    if (partitionIds.has(id.toUpperCase())) throw new KJValidationError(`input.partitions contains duplicate id: ${id}`)
    partitionIds.add(id.toUpperCase())
    if (partition.axis !== 'horizontal' && partition.axis !== 'vertical') throw new KJValidationError(`input.partitions[${index}].axis must be horizontal or vertical`)
    const axisLength = partition.axis === 'horizontal' ? width : depth
    const crossLength = partition.axis === 'horizontal' ? depth : width
    const position = boundedNumber(partition.position, `input.partitions[${index}].position`, wallThickness * 2, crossLength - wallThickness * 2)
    const start = boundedNumber(partition.start, `input.partitions[${index}].start`, wallThickness, axisLength - wallThickness)
    const end = boundedNumber(partition.end, `input.partitions[${index}].end`, wallThickness, axisLength - wallThickness)
    if (end - start < wallThickness * 3) throw new KJValidationError(`input.partitions[${index}] must have a positive usable span`)
    const openingSource = partition.openings ?? []
    if (!Array.isArray(openingSource) || openingSource.length > 8) throw new KJValidationError(`input.partitions[${index}].openings must contain at most 8 openings`)
    totalOpeningCount += openingSource.length
    const openings = openingSource.map((source: unknown, openingIndex: number) => {
      const opening = plain(source, `input.partitions[${index}].openings[${openingIndex}]`)
      exactKeys(opening, PARTITION_OPENING_KEYS, `input.partitions[${index}].openings[${openingIndex}]`)
      const kind = openingKind(opening.kind, `input.partitions[${index}].openings[${openingIndex}].kind`)
      const openingWidth = boundedNumber(opening.width, `input.partitions[${index}].openings[${openingIndex}].width`, kind === 'door' ? 600 : 300, 4_000)
      const offset = boundedNumber(opening.offset, `input.partitions[${index}].openings[${openingIndex}].offset`, 0, end - start)
      return { start: offset, end: offset + openingWidth, width: openingWidth, kind }
    })
    const validated = validateIntervals(openings, end - start, wallThickness, `input.partitions[${index}].openings`)
    return { id, axis: partition.axis as 'horizontal' | 'vertical', position, start, end, openings: validated }
  })

  const exteriorSource = input.exteriorOpenings ?? []
  if (!Array.isArray(exteriorSource) || exteriorSource.length > 32) throw new KJValidationError('input.exteriorOpenings must contain at most 32 openings')
  totalOpeningCount += exteriorSource.length
  if (totalOpeningCount > 48) throw new KJValidationError('Architecture plan supports at most 48 openings')
  const exteriorOpenings = exteriorSource.map((source: unknown, index: number) => {
    const opening = plain(source, `input.exteriorOpenings[${index}]`)
    exactKeys(opening, EXTERIOR_OPENING_KEYS, `input.exteriorOpenings[${index}]`)
    if (typeof opening.wall !== 'string' || !OUTER_WALLS.has(opening.wall)) throw new KJValidationError(`input.exteriorOpenings[${index}].wall must be north, south, east or west`)
    const kind = openingKind(opening.kind, `input.exteriorOpenings[${index}].kind`)
    const openingWidth = boundedNumber(opening.width, `input.exteriorOpenings[${index}].width`, kind === 'door' ? 600 : 300, 4_000)
    const wallLength = opening.wall === 'north' || opening.wall === 'south' ? width : depth
    const offset = boundedNumber(opening.offset, `input.exteriorOpenings[${index}].offset`, 0, wallLength)
    return { wall: opening.wall as 'north' | 'south' | 'east' | 'west', start: offset, end: offset + openingWidth, width: openingWidth, kind }
  })
  for (const wall of OUTER_WALLS) {
    const wallLength = wall === 'north' || wall === 'south' ? width : depth
    validateIntervals(exteriorOpenings.filter(opening => opening.wall === wall), wallLength, wallThickness, `input.exteriorOpenings.${wall}`)
  }

  const roomSource = input.rooms
  if (!Array.isArray(roomSource) || roomSource.length < 1 || roomSource.length > 64) throw new KJValidationError('input.rooms must contain 1-64 rooms')
  const roomIds = new Set<string>()
  const rooms = roomSource.map((source: unknown, index: number) => {
    const room = plain(source, `input.rooms[${index}]`)
    exactKeys(room, ROOM_KEYS, `input.rooms[${index}]`)
    const id = identifier(room.id, `input.rooms[${index}].id`)
    if (roomIds.has(id.toUpperCase())) throw new KJValidationError(`input.rooms contains duplicate id: ${id}`)
    roomIds.add(id.toUpperCase())
    const bounds = numericTuple(room.bounds, `input.rooms[${index}].bounds`, 4) as [number, number, number, number]
    if (bounds[2] < 600 || bounds[3] < 600) throw new KJValidationError(`input.rooms[${index}].bounds must have width and depth of at least 600`)
    if (bounds[0] < wallThickness - EPSILON || bounds[1] < wallThickness - EPSILON || bounds[0] + bounds[2] > width - wallThickness + EPSILON || bounds[1] + bounds[3] > depth - wallThickness + EPSILON) {
      throw new KJValidationError(`input.rooms[${index}] lies outside the inner wall boundary`)
    }
    return { id, name: boundedString(room.name, `input.rooms[${index}].name`, 96), bounds }
  })
  for (let left = 0; left < rooms.length; left += 1) for (let right = left + 1; right < rooms.length; right += 1) {
    if (rectangleIntersects(rooms[left]!.bounds, rooms[right]!.bounds)) throw new KJValidationError(`input.rooms ${rooms[left]!.id} and ${rooms[right]!.id} overlap`)
  }

  const wallSolids: [number, number, number, number][] = []
  for (const partition of partitions) {
    let cursor = partition.start
    for (const opening of partition.openings) {
      const openingStart = partition.start + opening.start
      const openingEnd = partition.start + opening.end
      if (openingStart > cursor + EPSILON) wallSolids.push(partition.axis === 'horizontal'
        ? [cursor, partition.position - wallThickness / 2, openingStart - cursor, wallThickness]
        : [partition.position - wallThickness / 2, cursor, wallThickness, openingStart - cursor])
      cursor = openingEnd
    }
    if (cursor < partition.end - EPSILON) wallSolids.push(partition.axis === 'horizontal'
      ? [cursor, partition.position - wallThickness / 2, partition.end - cursor, wallThickness]
      : [partition.position - wallThickness / 2, cursor, wallThickness, partition.end - cursor])
  }
  for (const room of rooms) if (wallSolids.some(wall => rectangleIntersects(room.bounds, wall))) {
    throw new KJValidationError(`input.rooms[${rooms.indexOf(room)}] crosses a solid partition segment`)
  }

  const blockKeys = new Set([
    ...exteriorOpenings.map(opening => `${opening.kind}:${opening.width}`),
    ...partitions.flatMap(partition => partition.openings.map(opening => `${opening.kind}:${opening.width}`)),
  ])
  if (blockKeys.size > MAX_BLOCKS) throw new KJValidationError(`Architecture plan requires ${blockKeys.size} block definitions; maximum is ${MAX_BLOCKS}`)

  return {
    version: input.version,
    expectedRevision,
    units: input.units,
    locale: input.locale == null
      ? [input.title, ...rooms.map(room => room.name)].some(value => /[\u3400-\u9fff]/u.test(String(value))) ? 'zh-CN' as const : 'en' as const
      : input.locale === 'zh-CN' || input.locale === 'en' ? input.locale
        : (() => { throw new KJValidationError('input.locale must be zh-CN or en') })(),
    drawingId: boundedString(input.drawingId, 'input.drawingId', 96),
    title: boundedString(input.title, 'input.title', 160),
    width, depth, wallThickness, exteriorOpenings, partitions, rooms, textHeight,
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function splitWall(length: number, openings: Interval[]): [number, number][] {
  const result: [number, number][] = []
  let cursor = 0
  for (const opening of openings) {
    if (opening.start > cursor + EPSILON) result.push([cursor, opening.start])
    cursor = opening.end
  }
  if (cursor < length - EPSILON) result.push([cursor, length])
  return result
}

export function buildAgentArchitecturePlan(document: ArchitectureDocument, source: KJAgentArchitecturePlanInput) {
  const input = validateInput(document, source)
  const zh = input.locale === 'zh-CN'
  const totalOpeningCount = input.exteriorOpenings.length + input.partitions.reduce((sum, partition) => sum + partition.openings.length, 0)
  const idPrefix = `arch-${stableHash({ drawingId: input.drawingId, version: input.version }).slice(0, 12)}`
  const continuousId = `${idPrefix}-lt-continuous`
  const dashedId = `${idPrefix}-lt-dashed`
  const layerDefinitions = {
    'A-WALL': { id: `${idPrefix}-layer-wall`, color: 7, linetypeId: continuousId, lineweight: 50 },
    'A-DOOR': { id: `${idPrefix}-layer-door`, color: 1, linetypeId: continuousId, lineweight: 25 },
    'A-WINDOW': { id: `${idPrefix}-layer-window`, color: 5, linetypeId: continuousId, lineweight: 25 },
    'A-ANNO': { id: `${idPrefix}-layer-anno`, color: 3, linetypeId: continuousId, lineweight: 18 },
    'A-DIMS': { id: `${idPrefix}-layer-dims`, color: 2, linetypeId: continuousId, lineweight: 18 },
    'A-SHEET': { id: `${idPrefix}-layer-sheet`, color: 8, linetypeId: continuousId, lineweight: 25 },
    'A-ROOM': { id: `${idPrefix}-layer-room`, color: 4, linetypeId: dashedId, lineweight: 13 },
  } as const
  type LayerName = keyof typeof layerDefinitions
  const entities: EntitySpec[] = []
  const p3 = (x: number, y: number): Point3 => [x, y, 0]
  const add = (type: string, layer: LayerName, payload: Record<string, unknown>) => {
    const id = `${idPrefix}-entity-${String(entities.length + 1).padStart(4, '0')}`
    entities.push({ type, payload: { ...payload, layerId: layerDefinitions[layer].id }, options: { id } })
  }
  const rectangle = (x: number, y: number, width: number, height: number, layer: LayerName) => add('LWPOLYLINE', layer, {
    vertices: [p3(x, y), p3(x + width, y), p3(x + width, y + height), p3(x, y + height)], closed: true,
  })
  const text = (x: number, y: number, value: string, height = input.textHeight, layer: LayerName = 'A-ANNO') => add('TEXT', layer, { position: p3(x, y), text: value, height })
  const dimension = (start: Point3, end: Point3, position: Point3) => add('DIMENSION', 'A-DIMS', {
    dimensionType: 'ALIGNED', definitionPoints: [position, start, end], textPosition: position,
    textOverride: null, textHeight: input.textHeight, styleName: 'STANDARD',
  })

  const exteriorByWall = (wall: 'north' | 'south' | 'east' | 'west') => input.exteriorOpenings
    .filter(opening => opening.wall === wall)
    .sort((left, right) => left.start - right.start)
  for (const [start, end] of splitWall(input.width, exteriorByWall('south'))) rectangle(start, 0, end - start, input.wallThickness, 'A-WALL')
  for (const [start, end] of splitWall(input.width, exteriorByWall('north'))) rectangle(start, input.depth - input.wallThickness, end - start, input.wallThickness, 'A-WALL')
  for (const [start, end] of splitWall(input.depth, exteriorByWall('west'))) rectangle(0, start, input.wallThickness, end - start, 'A-WALL')
  for (const [start, end] of splitWall(input.depth, exteriorByWall('east'))) rectangle(input.width - input.wallThickness, start, input.wallThickness, end - start, 'A-WALL')

  for (const partition of input.partitions) {
    let cursor = partition.start
    for (const opening of partition.openings) {
      const openingStart = partition.start + opening.start
      const openingEnd = partition.start + opening.end
      if (openingStart > cursor + EPSILON) {
        if (partition.axis === 'horizontal') rectangle(cursor, partition.position - input.wallThickness / 2, openingStart - cursor, input.wallThickness, 'A-WALL')
        else rectangle(partition.position - input.wallThickness / 2, cursor, input.wallThickness, openingStart - cursor, 'A-WALL')
      }
      cursor = openingEnd
    }
    if (cursor < partition.end - EPSILON) {
      if (partition.axis === 'horizontal') rectangle(cursor, partition.position - input.wallThickness / 2, partition.end - cursor, input.wallThickness, 'A-WALL')
      else rectangle(partition.position - input.wallThickness / 2, cursor, input.wallThickness, partition.end - cursor, 'A-WALL')
    }
  }

  const blockByKey = new Map<string, BlockSpec>()
  const blockFor = (kind: KJArchitectureOpeningKind, width: number): BlockSpec => {
    const key = `${kind}:${width}`
    const current = blockByKey.get(key)
    if (current) return current
    const token = stableHash({ kind, width, wallThickness: input.wallThickness }).slice(0, 10)
    const id = `${idPrefix}-block-${token}`
    const layer: LayerName = kind === 'door' ? 'A-DOOR' : 'A-WINDOW'
    const members: EntitySpec[] = []
    const member = (type: string, payload: Record<string, unknown>) => members.push({
      type, payload: { ...payload, layerId: layerDefinitions[layer].id }, options: { id: `${id}-member-${String(members.length + 1).padStart(2, '0')}` },
    })
    if (kind === 'door') {
      member('LINE', { start: p3(0, 0), end: p3(width, 0) })
      member('ARC', { center: p3(0, 0), radius: width, startAngle: 0, endAngle: Math.PI / 2, clockwise: false })
    } else {
      const half = input.wallThickness * 0.32
      member('LINE', { start: p3(0, -half), end: p3(width, -half) })
      member('LINE', { start: p3(0, 0), end: p3(width, 0) })
      member('LINE', { start: p3(0, half), end: p3(width, half) })
    }
    const block = { id, name: `KJ_ARCH_${kind.toUpperCase()}_${formatNumber(width)}`, basePoint: p3(0, 0), entities: members }
    blockByKey.set(key, block)
    return block
  }
  const insert = (kind: KJArchitectureOpeningKind, width: number, position: Point3, rotation: number) => {
    const block = blockFor(kind, width)
    add('INSERT', kind === 'door' ? 'A-DOOR' : 'A-WINDOW', {
      blockRecordId: block.id, position, scale: [1, 1, 1], rotation, attributes: {}, attributeIds: [], sequenceEndId: null,
    })
  }

  for (const opening of input.exteriorOpenings) {
    if (opening.wall === 'south') insert(opening.kind, opening.width, p3(opening.start, input.wallThickness / 2), 0)
    else if (opening.wall === 'north') insert(opening.kind, opening.width, p3(opening.end, input.depth - input.wallThickness / 2), Math.PI)
    else if (opening.wall === 'west') insert(opening.kind, opening.width, p3(input.wallThickness / 2, opening.end), -Math.PI / 2)
    else insert(opening.kind, opening.width, p3(input.width - input.wallThickness / 2, opening.start), Math.PI / 2)
  }
  for (const partition of input.partitions) for (const opening of partition.openings) {
    if (partition.axis === 'horizontal') insert(opening.kind, opening.width, p3(partition.start + opening.start, partition.position), 0)
    else insert(opening.kind, opening.width, p3(partition.position, partition.start + opening.start), Math.PI / 2)
  }

  for (const room of input.rooms) {
    const [x, y, roomWidth, roomDepth] = room.bounds
    rectangle(x, y, roomWidth, roomDepth, 'A-ROOM')
    const centerX = x + roomWidth / 2, centerY = y + roomDepth / 2
    text(centerX - Math.min(roomWidth * 0.18, input.textHeight * 2), centerY + input.textHeight * 0.35, room.name)
    text(centerX - input.textHeight * 1.5, centerY - input.textHeight * 0.9, `${formatNumber(roomWidth * roomDepth / 1_000_000)} ${zh ? 'm²' : 'm2'}`, input.textHeight * 0.9)
  }

  dimension(p3(0, 0), p3(input.width, 0), p3(input.width / 2, -800))
  dimension(p3(0, 0), p3(0, input.depth), p3(-800, input.depth / 2))
  const sheetX = -3_000, sheetY = -4_500, sheetWidth = 42_000, sheetHeight = 29_700
  rectangle(sheetX, sheetY, sheetWidth, sheetHeight, 'A-SHEET')
  rectangle(sheetX + 500, sheetY + 500, sheetWidth - 1_000, sheetHeight - 1_000, 'A-SHEET')
  const titleX = 18_000, titleY = sheetY + 500, titleWidth = sheetX + sheetWidth - 500 - titleX, titleHeight = 2_200
  rectangle(titleX, titleY, titleWidth, titleHeight, 'A-SHEET')
  add('LINE', 'A-SHEET', { start: p3(titleX + titleWidth * 0.68, titleY), end: p3(titleX + titleWidth * 0.68, titleY + titleHeight) })
  text(titleX + 500, titleY + 1_350, input.title, input.textHeight * 1.15, 'A-SHEET')
  text(titleX + 500, titleY + 500, `${zh ? '图号' : 'DRAWING'} ${input.drawingId}`, input.textHeight * 0.9, 'A-SHEET')
  text(titleX + titleWidth * 0.68 + 400, titleY + 1_350, 'A3', input.textHeight, 'A-SHEET')
  text(titleX + titleWidth * 0.68 + 400, titleY + 500, zh ? '比例 1:100 / mm' : 'SCALE 1:100 / mm', input.textHeight * 0.9, 'A-SHEET')

  const blocks = [...blockByKey.values()].sort((left, right) => left.name.localeCompare(right.name))
  const blockMemberCount = blocks.reduce((sum, block) => sum + block.entities.length, 0)
  const generatedEntityCount = entities.length + blockMemberCount
  if (generatedEntityCount + 1 > MAX_ENTITY_COUNT) throw new KJValidationError(`Architecture plan expands to ${generatedEntityCount + 1} entities; maximum is ${MAX_ENTITY_COUNT}`)
  const resources = {
    linetypes: [
      { id: continuousId, name: `KJ_${idPrefix.slice(5, 17)}_CONT`, pattern: [] as number[] },
      { id: dashedId, name: `KJ_${idPrefix.slice(5, 17)}_DASHED`, pattern: [400, -200] },
    ],
    layers: Object.entries(layerDefinitions).map(([name, definition]) => ({ name, ...definition })),
    // CREATEBATCH v1 block resource contract: create each block record, then create its
    // entities with ownerId=block.id, before validating and creating top-level INSERTs.
    blocks,
  }
  const layoutName = `KJ_ARCH_${idPrefix.slice(5, 17).toUpperCase()}_A3`
  const layout = {
    id: `${idPrefix}-layout`,
    blockRecordId: `${idPrefix}-paper-space`,
    name: layoutName,
    dxfPlotSettings: {
      paperWidth: 420, paperHeight: 297,
      marginLeft: 0, marginBottom: 0, marginRight: 0, marginTop: 0,
      originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 1,
      flags: 0, paperUnits: 1 as const, rotation: 0 as const, plotType: 5 as const,
    },
    viewport: {
      id: `${idPrefix}-viewport`, center: [210, 148.5, 0] as Point3, width: 420, height: 297,
      viewCenter: [sheetX + sheetWidth / 2, sheetY + sheetHeight / 2, 0] as Point3,
      viewHeight: 29_700, twistAngle: 0, modelUnits: 'millimeter' as const, scaleDenominator: 100,
    },
  }
  return {
    commandArgs: { entities, resources, layout },
    evidence: {
      drawingId: input.drawingId,
      skillId: 'architecture-plan',
      skillVersion: KJDRAW_ARCHITECTURE_PLAN_VERSION,
      units: input.units,
      expectedRevision: input.expectedRevision,
      entityCount: generatedEntityCount + 1,
      modelEntityCount: entities.length,
      blockDefinitionCount: blocks.length,
      blockMemberCount,
      parameters: {
        title: input.title, width: input.width, depth: input.depth, wallThickness: input.wallThickness,
        partitionCount: input.partitions.length, openingCount: totalOpeningCount, roomCount: input.rooms.length,
        roomAreasSquareMeters: Object.fromEntries(input.rooms.map(room => [room.id, room.bounds[2] * room.bounds[3] / 1_000_000])),
        sheet: { paper: 'A3', scale: '1:100', layoutName, modelFrame: { origin: [sheetX, sheetY], size: [sheetWidth, sheetHeight] } },
      },
      validation: {
        blankDocument: true, wallBounds: true, openingBounds: true, openingSeparation: true,
        roomBounds: true, roomOverlap: false, roomPartitionIntersections: false,
      },
      limitations: ['Rectangular exterior envelope', 'Straight horizontal or vertical partitions', 'One A3 landscape paper layout at 1:100'],
    },
  }
}
