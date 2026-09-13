import type { KJCommandArguments } from './commands.js'
import { chamferLinePair, filletLinePair, offsetEntityPayload } from './editing.js'
import { reflectionAcrossLine3, rotationAround3, transformEntityPayload, transformPoint3, translation3 } from './geometry/index.js'
import type { KJReadonlyObjectRecord } from './schema.js'

export type KJModificationId =
  | 'rotate'
  | 'scale'
  | 'mirror'
  | 'array-rect'
  | 'array-polar'
  | 'offset'
  | 'break'
  | 'break-two-point'
  | 'join'
  | 'explode'
  | 'trim'
  | 'extend'
  | 'lengthen'
  | 'stretch'
  | 'polyline-insert'
  | 'polyline-delete'
  | 'polyline-arc'
  | 'polyline-width'
  | 'chamfer'
  | 'fillet'

export type KJModificationFieldType = 'number' | 'integer' | 'boolean'
export type KJModificationPoint = readonly [number, number]

export interface KJLocalizedControlText {
  readonly en: string
  readonly zh: string
}

export interface KJModificationFieldDefinition {
  readonly key: string
  readonly label: KJLocalizedControlText
  readonly type: KJModificationFieldType
  readonly default: number | boolean
  readonly min?: number
  readonly max?: number
  readonly step?: number
}

export interface KJModificationPointDefinition {
  readonly key: string
  readonly label: KJLocalizedControlText
}

export interface KJModificationDefinition {
  readonly id: KJModificationId
  readonly command: string
  readonly label: KJLocalizedControlText
  readonly description: KJLocalizedControlText
  readonly minSelection: number
  readonly maxSelection?: number
  /** When present, every selected entity must use one of these types. */
  readonly supportedEntityTypes?: readonly string[]
  /** For boundary-based operations, the first selected entity is the target. */
  readonly targetEntityTypes?: readonly string[]
  readonly boundaryEntityTypes?: readonly string[]
  readonly fields: readonly KJModificationFieldDefinition[]
  readonly pointKeys: readonly KJModificationPointDefinition[]
}

export interface KJModificationBuildContext {
  readonly ids: readonly string[]
  readonly values?: Readonly<Record<string, unknown>>
  readonly points?: readonly KJModificationPoint[]
  readonly selectionCenter?: KJModificationPoint
}

export interface KJModificationCommand {
  readonly command: string
  readonly arguments: KJCommandArguments
}

export interface KJModificationPreviewEntity {
  readonly type: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface KJModificationPreview {
  /** Existing geometry replaced or erased by the operation. */
  readonly before: readonly KJModificationPreviewEntity[]
  /** Exact resulting geometry, capped by maxEntities. */
  readonly after: readonly KJModificationPreviewEntity[]
  readonly omittedCount: number
}

const commandModificationIds = Object.freeze({
  MIRROR: 'mirror', MI: 'mirror',
  ARRAYRECT: 'array-rect', ARRAYRECTANGULAR: 'array-rect',
  ARRAYPOLAR: 'array-polar', POLARARRAY: 'array-polar',
  OFFSET: 'offset', O: 'offset',
  CHAMFER: 'chamfer', CHA: 'chamfer',
  FILLET: 'fillet', F: 'fillet',
} satisfies Readonly<Record<string, KJModificationId>>)

const text = (en: string, zh: string): KJLocalizedControlText => Object.freeze({ en, zh })
const number = (
  key: string,
  en: string,
  zh: string,
  defaultValue: number,
  options: { type?: 'number' | 'integer'; min?: number; max?: number; step?: number } = {},
): KJModificationFieldDefinition => Object.freeze({
  key,
  label: text(en, zh),
  type: options.type ?? 'number',
  default: defaultValue,
  ...(options.min === undefined ? {} : { min: options.min }),
  ...(options.max === undefined ? {} : { max: options.max }),
  ...(options.step === undefined ? {} : { step: options.step }),
})
const boolean = (key: string, en: string, zh: string, defaultValue: boolean): KJModificationFieldDefinition => Object.freeze({
  key,
  label: text(en, zh),
  type: 'boolean',
  default: defaultValue,
})
const pick = (key: string, en: string, zh: string): KJModificationPointDefinition => Object.freeze({ key, label: text(en, zh) })

export const KJ_MODIFICATION_IDS = Object.freeze([
  'rotate', 'scale', 'mirror', 'array-rect', 'array-polar', 'offset',
  'break', 'break-two-point', 'join', 'explode', 'trim', 'extend', 'lengthen', 'stretch',
  'polyline-insert', 'polyline-delete', 'polyline-arc', 'polyline-width', 'chamfer', 'fillet',
] as const)

export const KJ_MODIFICATION_DEFINITIONS: readonly KJModificationDefinition[] = Object.freeze([
  {
    id: 'rotate', command: 'ROTATE', label: text('Rotate', '旋转'),
    description: text('Rotate the selection around a point.', '绕指定基点旋转选中对象。'),
    minSelection: 1,
    fields: [number('angleDegrees', 'Angle (°)', '角度（°）', 90, { step: 1 })],
    pointKeys: [pick('center', 'Pick the rotation center', '在画布上指定旋转中心')],
  },
  {
    id: 'scale', command: 'SCALE', label: text('Scale', '缩放'),
    description: text('Scale the selection uniformly around a point.', '绕指定基点等比缩放选中对象。'),
    minSelection: 1,
    fields: [number('factor', 'Scale factor', '缩放比例', 2, { step: 0.1 })],
    pointKeys: [pick('center', 'Pick the scale center', '在画布上指定缩放基点')],
  },
  {
    id: 'mirror', command: 'MIRROR', label: text('Mirror', '镜像'),
    description: text('Mirror the selection across a two-point axis.', '以画布上两点定义的轴镜像选中对象。'),
    minSelection: 1,
    fields: [boolean('eraseSource', 'Erase source', '删除源对象', false)],
    pointKeys: [pick('lineStart', 'Pick the first axis point', '指定镜像轴第一点'), pick('lineEnd', 'Pick the second axis point', '指定镜像轴第二点')],
  },
  {
    id: 'array-rect', command: 'ARRAYRECT', label: text('Rectangular array', '矩形阵列'),
    description: text('Create rows and columns of the selection.', '按行列间距创建选中对象的矩形阵列。'),
    minSelection: 1,
    fields: [
      number('rows', 'Rows', '行数', 2, { type: 'integer', min: 1, max: 100000, step: 1 }),
      number('columns', 'Columns', '列数', 3, { type: 'integer', min: 1, max: 100000, step: 1 }),
      number('rowSpacing', 'Row spacing', '行间距', 10, { step: 1 }),
      number('columnSpacing', 'Column spacing', '列间距', 10, { step: 1 }),
    ],
    pointKeys: [],
  },
  {
    id: 'array-polar', command: 'ARRAYPOLAR', label: text('Polar array', '环形阵列'),
    description: text('Distribute the selection around a center point.', '围绕画布上指定中心阵列选中对象。'),
    minSelection: 1,
    fields: [
      number('count', 'Item count', '项目数', 6, { type: 'integer', min: 2, max: 100000, step: 1 }),
      number('angleDegrees', 'Fill angle (°)', '填充角度（°）', 360, { step: 1 }),
      boolean('rotateItems', 'Rotate items', '旋转阵列项', true),
    ],
    pointKeys: [pick('center', 'Pick the array center', '在画布上指定阵列中心')],
  },
  {
    id: 'offset', command: 'OFFSET', label: text('Offset', '偏移'),
    description: text('Create one exact parallel or concentric entity.', '在指定侧创建一个精确平行或同心对象。'),
    minSelection: 1, maxSelection: 1,
    supportedEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'],
    fields: [number('distance', 'Distance', '偏移距离', 2, { min: Number.EPSILON, step: 0.1 })],
    pointKeys: [pick('sidePoint', 'Pick the offset side', '在画布上指定偏移侧')],
  },
  {
    id: 'break', command: 'BREAK', label: text('Break', '打断'),
    description: text('Split one line, arc or open polyline at an exact point.', '在精确点打断直线、圆弧或开放多段线。'),
    minSelection: 1, maxSelection: 1,
    supportedEntityTypes: ['LINE', 'ARC', 'LWPOLYLINE', 'POLYLINE'],
    fields: [number('tolerance', 'Pick tolerance', '点选容差', 0.1, { min: 0, step: 0.01 })],
    pointKeys: [pick('point', 'Pick the break point', '在画布上指定打断点')],
  },
  {
    id: 'break-two-point', command: 'BREAK', label: text('Two-point break', '两点打断'),
    description: text('Split one circle or closed polyline at two exact points.', '在两个精确点拆分圆或闭合多段线。'),
    minSelection: 1, maxSelection: 1,
    supportedEntityTypes: ['CIRCLE', 'LWPOLYLINE', 'POLYLINE'],
    fields: [number('tolerance', 'Pick tolerance', '点选容差', 0.1, { min: 0, step: 0.01 })],
    pointKeys: [pick('firstPoint', 'Pick the first break point', '指定第一个打断点'), pick('secondPoint', 'Pick the second break point', '指定第二个打断点')],
  },
  {
    id: 'join', command: 'JOIN', label: text('Join', '合并'),
    description: text('Join connected lines, arcs and open polylines into one editable path.', '将相连的直线、圆弧和开放多段线合并为一条可编辑路径。'),
    minSelection: 2, maxSelection: 4096,
    supportedEntityTypes: ['LINE', 'ARC', 'LWPOLYLINE', 'POLYLINE'],
    fields: [number('tolerance', 'Endpoint tolerance', '端点容差', 1e-9, { min: 0, step: 0.001 })],
    pointKeys: [],
  },
  {
    id: 'explode', command: 'EXPLODE', label: text('Explode', '分解'),
    description: text('Explode one polyline-compatible entity into primitives.', '将一个多段线类对象分解为基础图元。'),
    minSelection: 1, maxSelection: 1,
    supportedEntityTypes: ['LWPOLYLINE', 'POLYLINE', 'REVISION_CLOUD', 'WIPEOUT'],
    fields: [], pointKeys: [],
  },
  {
    id: 'trim', command: 'TRIM', label: text('Trim', '修剪'),
    description: text('Select the line, arc, circle or ellipse first, then Shift-select the cutting boundaries.', '先选择待修剪的直线、圆弧、圆或椭圆，再按住 Shift 选择切割边界。'),
    minSelection: 2,
    targetEntityTypes: ['LINE', 'ARC', 'CIRCLE', 'ELLIPSE'],
    boundaryEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'],
    fields: [],
    pointKeys: [pick('pickPoint', 'Pick the portion of the target to remove', '在目标图形上指定要删除的区段')],
  },
  {
    id: 'extend', command: 'EXTEND', label: text('Extend', '延伸'),
    description: text('Select the line or arc first, then Shift-select the limiting boundaries.', '先选择待延伸的直线或圆弧，再按住 Shift 选择延伸边界。'),
    minSelection: 2,
    targetEntityTypes: ['LINE', 'ARC'],
    boundaryEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'],
    fields: [],
    pointKeys: [pick('pickPoint', 'Pick near the end of the target to extend', '在目标图形上靠近要延伸的一端点选')],
  },
  {
    id: 'lengthen', command: 'LENGTHEN', label: text('Lengthen', '定长'),
    description: text('Set the exact length from the endpoint selected on canvas.', '从画布中指定的端点设置精确长度。'),
    minSelection: 1, maxSelection: 1,
    supportedEntityTypes: ['LINE', 'ARC'],
    fields: [number('value', 'Target length', '目标长度', 10, { min: Number.EPSILON, step: 0.1 })],
    pointKeys: [pick('pickPoint', 'Pick the endpoint to change', '选择要修改的端点')],
  },
  {
    id: 'stretch', command: 'STRETCH', label: text('Stretch', '拉伸'),
    description: text('Move selected vertices inside a crossing window.', '移动交叉窗口内的选中顶点。'),
    minSelection: 1, maxSelection: 4096,
    supportedEntityTypes: ['LINE', 'LWPOLYLINE', 'POLYLINE'],
    fields: [number('dx', 'Horizontal displacement', '水平位移', 10, { step: 0.1 }), number('dy', 'Vertical displacement', '垂直位移', 0, { step: 0.1 })],
    pointKeys: [pick('crossingStart', 'Pick the first crossing-window corner', '指定交叉窗口第一个角点'), pick('crossingEnd', 'Pick the opposite crossing-window corner', '指定交叉窗口对角点')],
  },
  {
    id: 'polyline-insert', command: 'PEDIT', label: text('Insert polyline vertex', '插入多段线顶点'),
    description: text('Pick a straight or arc segment to insert an exact vertex.', '点选直线段或圆弧段，精确插入顶点。'),
    minSelection: 1, maxSelection: 1,
    supportedEntityTypes: ['LWPOLYLINE', 'POLYLINE'],
    fields: [number('tolerance', 'Pick tolerance', '点选容差', 0.1, { min: 0, step: 0.01 })],
    pointKeys: [pick('point', 'Pick a point on the segment', '在线段上指定插入点')],
  },
  {
    id: 'polyline-delete', command: 'PEDIT', label: text('Delete polyline vertex', '删除多段线顶点'),
    description: text('Pick one vertex to delete while preserving valid topology.', '点选一个顶点删除，并保持多段线拓扑有效。'),
    minSelection: 1, maxSelection: 1,
    supportedEntityTypes: ['LWPOLYLINE', 'POLYLINE'],
    fields: [number('tolerance', 'Pick tolerance', '点选容差', 0.1, { min: 0, step: 0.01 })],
    pointKeys: [pick('point', 'Pick the vertex to delete', '点选要删除的顶点')],
  },
  {
    id: 'polyline-arc', command: 'PEDIT', label: text('Edit polyline arc', '编辑多段线圆弧段'),
    description: text('Pick a segment and set its signed sweep; use 0° for straight.', '点选线段并设置有向扫角；输入 0° 切换为直线段。'),
    minSelection: 1, maxSelection: 1,
    supportedEntityTypes: ['LWPOLYLINE', 'POLYLINE'],
    fields: [
      number('sweepDegrees', 'Sweep angle (°)', '扫角（°）', 90, { min: -359.999999, max: 359.999999, step: 1 }),
      number('tolerance', 'Pick tolerance', '点选容差', 0.1, { min: 0, step: 0.01 }),
    ],
    pointKeys: [pick('point', 'Pick the segment to change', '点选要切换的线段')],
  },
  {
    id: 'polyline-width', command: 'PEDIT', label: text('Edit polyline width', '编辑多段线宽度'),
    description: text('Pick one segment and set its exact start and end widths.', '点选一个线段并设置精确的起点和终点宽度。'),
    minSelection: 1, maxSelection: 1,
    supportedEntityTypes: ['LWPOLYLINE', 'POLYLINE'],
    fields: [
      number('startWidth', 'Start width', '起点宽度', 0, { min: 0, max: 1e12, step: 0.1 }),
      number('endWidth', 'End width', '终点宽度', 0, { min: 0, max: 1e12, step: 0.1 }),
      number('tolerance', 'Pick tolerance', '点选容差', 0.1, { min: 0, step: 0.01 }),
    ],
    pointKeys: [pick('point', 'Pick the segment whose width will change', '点选要修改宽度的线段')],
  },
  {
    id: 'chamfer', command: 'CHAMFER', label: text('Chamfer lines', '直线倒角'),
    description: text('Trim two selected LINE entities and add a chamfer.', '修剪两条选中直线并创建倒角。'),
    minSelection: 2, maxSelection: 2,
    supportedEntityTypes: ['LINE'],
    fields: [
      number('distance1', 'First distance', '第一距离', 2, { min: 0, step: 0.1 }),
      number('distance2', 'Second distance', '第二距离', 2, { min: 0, step: 0.1 }),
    ],
    pointKeys: [pick('pickPoint1', 'Pick the side of the first line to keep', '在第一条直线上指定保留侧'), pick('pickPoint2', 'Pick the side of the second line to keep', '在第二条直线上指定保留侧')],
  },
  {
    id: 'fillet', command: 'FILLET', label: text('Fillet lines', '直线圆角'),
    description: text('Trim two selected LINE entities and add a tangent arc.', '修剪两条选中直线并创建相切圆弧。'),
    minSelection: 2, maxSelection: 2,
    supportedEntityTypes: ['LINE'],
    fields: [number('radius', 'Radius', '半径', 2, { min: Number.EPSILON, step: 0.1 })],
    pointKeys: [pick('pickPoint1', 'Pick the side of the first line to keep', '在第一条直线上指定保留侧'), pick('pickPoint2', 'Pick the side of the second line to keep', '在第二条直线上指定保留侧')],
  },
] satisfies readonly KJModificationDefinition[])

const definitionById = new Map(KJ_MODIFICATION_DEFINITIONS.map(definition => [definition.id, definition] as const))

/** Center of the selected entities' defining points, used as the non-rotating array anchor. */
export function getKJModificationSelectionCenter(entities: readonly { readonly payload: Readonly<Record<string, unknown>> }[]): KJModificationPoint {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity
  const add=(value:unknown):void=>{
    if(value&&typeof value==='object'&&!Array.isArray(value)&&'point' in value)value=value.point
    if(!Array.isArray(value))return
    const x=Number(value[0]),y=Number(value[1]);if(!Number.isFinite(x)||!Number.isFinite(y))return
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)
  }
  for(const {payload} of entities){
    for(const key of ['start','end','center','position','insertionPoint','origin'])add(payload[key])
    for(const key of ['vertices','controlPoints','fitPoints','definitionPoints'])if(Array.isArray(payload[key]))for(const point of payload[key])add(point)
    for(const raw of Array.isArray(payload.boundaryLoops)?payload.boundaryLoops:[]){
      const loop=raw as Record<string,unknown>
      for(const point of Array.isArray(loop.vertices)?loop.vertices:[])add(point)
      for(const rawEdge of Array.isArray(loop.edges)?loop.edges:[]){const edge=rawEdge as Record<string,unknown>;add(edge.start);add(edge.end);add(edge.center)}
    }
  }
  return Number.isFinite(minX)?[(minX+maxX)/2,(minY+maxY)/2]:[0,0]
}

export function getKJModificationDefinition(id: KJModificationId): KJModificationDefinition {
  const definition = definitionById.get(id)
  if (!definition) throw new RangeError(`Unsupported KJDraw modification: ${String(id)}`)
  return definition
}

/** Resolve modification commands that require the parameter dialog and/or ordered canvas picks. */
export function getKJInteractiveModificationDefinition(command: string): KJModificationDefinition | null {
  const id = commandModificationIds[String(command).trim().toUpperCase() as keyof typeof commandModificationIds]
  return id ? getKJModificationDefinition(id) : null
}

/** Parse optional positional command parameters into the same values used by the modification dialog. */
export function parseKJModificationCommandValues(
  id: KJModificationId,
  tokens: readonly string[],
  locale: 'en' | 'zh' = 'en',
): Readonly<Record<string, number | boolean>> {
  const definition = getKJModificationDefinition(id)
  const fail = (en: string, zh: string): never => { throw new RangeError(locale === 'zh' ? zh : en) }
  if (tokens.length > definition.fields.length) {
    fail(`${definition.command} accepts at most ${definition.fields.length} parameter values`, `${definition.label.zh}最多接受 ${definition.fields.length} 个参数值`)
  }
  const source: Record<string, unknown> = {}
  for (const [index, token] of tokens.entries()) {
    const field = definition.fields[index]!
    if (field.type === 'boolean') {
      const normalized = token.trim().toUpperCase()
      const truthy = ['1', 'TRUE', 'YES', 'ON', 'ERASE', 'ROTATE']
      const falsy = ['0', 'FALSE', 'NO', 'OFF', 'KEEP', 'STATIC']
      if (!truthy.includes(normalized) && !falsy.includes(normalized)) {
        fail(`${field.label.en} must be true or false`, `${field.label.zh}必须为 true 或 false`)
      }
      source[field.key] = truthy.includes(normalized)
    } else {
      const value = Number(token)
      if (!Number.isFinite(value)) fail(`${field.label.en} must be a finite number`, `${field.label.zh}必须是有限数值`)
      if (field.type === 'integer' && !Number.isInteger(value)) fail(`${field.label.en} must be an integer`, `${field.label.zh}必须是整数`)
      if (field.min !== undefined && value < field.min) fail(`${field.label.en} must be at least ${field.min}`, `${field.label.zh}必须至少为 ${field.min}`)
      if (field.max !== undefined && value > field.max) fail(`${field.label.en} must be at most ${field.max}`, `${field.label.zh}不能超过 ${field.max}`)
      source[field.key] = value
    }
  }
  return Object.freeze(normalizedValues(definition, source))
}

/** Shared preflight used by hosted and embedded workbenches before collecting points. */
export function validateKJModificationSelection(
  definition: KJModificationDefinition,
  entities: readonly ({ readonly id: string; readonly type: string; readonly kind?: string } | null)[],
  locale: 'en' | 'zh' = 'en',
): void {
  const fail = (en: string, zh: string): never => { throw new RangeError(locale === 'zh' ? zh : en) }
  if (entities.some(entity => !entity || (entity.kind !== undefined && entity.kind !== 'entity'))) fail('Selection contains an unavailable entity', '选择中包含不可用的图元')
  if (new Set(entities.map(entity => entity!.id)).size !== entities.length) fail('Select each entity only once', '请勿重复选择同一图元')
  if (entities.length < definition.minSelection) fail(`${definition.command} requires at least ${definition.minSelection} selected objects`, `${definition.label.zh}至少需要选择 ${definition.minSelection} 个对象`)
  if (definition.maxSelection !== undefined && entities.length > definition.maxSelection) fail(`${definition.command} accepts at most ${definition.maxSelection} selected objects`, `${definition.label.zh}最多允许选择 ${definition.maxSelection} 个对象`)
  if (definition.supportedEntityTypes && entities.some(entity => !definition.supportedEntityTypes!.includes(entity!.type))) fail(`${definition.command} supports ${definition.supportedEntityTypes.join(', ')}`, `${definition.label.zh}支持的图元：${definition.supportedEntityTypes.join('、')}`)
  if (definition.targetEntityTypes && !definition.targetEntityTypes.includes(entities[0]!.type)) fail(`Select a ${definition.targetEntityTypes.join(', ')} target first, then Shift-select boundaries`, `请先选择目标图元（${definition.targetEntityTypes.join('、')}），再按住 Shift 选择边界`)
  if (definition.boundaryEntityTypes && entities.slice(1).some(entity => !definition.boundaryEntityTypes!.includes(entity!.type))) fail(`Boundaries must be ${definition.boundaryEntityTypes.join(', ')}`, `边界必须是 ${definition.boundaryEntityTypes.join('、')}`)
}

function normalizedIds(definition: KJModificationDefinition, ids: readonly string[]): string[] {
  const result = [...new Set(ids.map(String).filter(Boolean))]
  if (result.length < definition.minSelection) throw new RangeError(`${definition.command} requires at least ${definition.minSelection} selected object${definition.minSelection === 1 ? '' : 's'}`)
  if (definition.maxSelection !== undefined && result.length > definition.maxSelection) throw new RangeError(`${definition.command} accepts at most ${definition.maxSelection} selected object${definition.maxSelection === 1 ? '' : 's'}`)
  return result
}

function normalizedValues(definition: KJModificationDefinition, source: Readonly<Record<string, unknown>>): Record<string, number | boolean> {
  const result: Record<string, number | boolean> = {}
  for (const field of definition.fields) {
    const raw = source[field.key] ?? field.default
    if (field.type === 'boolean') {
      result[field.key] = typeof raw === 'string' ? !['', '0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase()) : Boolean(raw)
      continue
    }
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new TypeError(`${field.label.en} must be a finite number`)
    if (field.type === 'integer' && !Number.isInteger(value)) throw new RangeError(`${field.label.en} must be an integer`)
    if (field.min !== undefined && value < field.min) throw new RangeError(`${field.label.en} must be at least ${field.min}`)
    if (field.max !== undefined && value > field.max) throw new RangeError(`${field.label.en} must be at most ${field.max}`)
    result[field.key] = value
  }
  return result
}

function normalizedPoints(definition: KJModificationDefinition, points: readonly KJModificationPoint[]): KJModificationPoint[] {
  if (points.length !== definition.pointKeys.length) throw new RangeError(`${definition.command} requires ${definition.pointKeys.length} canvas point${definition.pointKeys.length === 1 ? '' : 's'}`)
  return points.map((point, index) => {
    const x = Number(point?.[0]), y = Number(point?.[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError(`${definition.pointKeys[index]?.label.en ?? 'Point'} must contain finite coordinates`)
    return [x, y] as const
  })
}

/** Build a core command from UI-neutral form values and ordered canvas picks. */
export function buildKJModificationCommand(id: KJModificationId, context: KJModificationBuildContext): KJModificationCommand {
  const definition = getKJModificationDefinition(id)
  const ids = normalizedIds(definition, context.ids)
  const values = normalizedValues(definition, context.values ?? {})
  const points = normalizedPoints(definition, context.points ?? [])
  const all = { ids, ...values } as KJCommandArguments
  switch (id) {
    case 'rotate': return { command: definition.command, arguments: { ...all, center: points[0]! } }
    case 'scale': return { command: definition.command, arguments: { ...all, center: points[0]! } }
    case 'mirror': return { command: definition.command, arguments: { ...all, lineStart: points[0]!, lineEnd: points[1]! } }
    case 'array-rect': return { command: definition.command, arguments: all }
    case 'array-polar': return {
      command: definition.command,
      arguments: { ...all, center: points[0]!, ...(values.rotateItems === false ? { basePoint: context.selectionCenter ?? points[0]! } : {}) },
    }
    case 'offset': return { command: definition.command, arguments: { id: ids[0]!, ...values, sidePoint: points[0]! } }
    case 'break': return { command: definition.command, arguments: { id: ids[0]!, ...values, point: points[0]! } }
    case 'break-two-point': return { command: definition.command, arguments: { id: ids[0]!, ...values, firstPoint: points[0]!, secondPoint: points[1]! } }
    case 'join': return { command: definition.command, arguments: { id: ids[0]!, ids, ...values } }
    case 'explode': return { command: definition.command, arguments: { id: ids[0]! } }
    case 'trim': return { command: definition.command, arguments: { id: ids[0]!, boundaryIds: ids.slice(1), pickPoint: points[0]! } }
    case 'extend': return { command: definition.command, arguments: { id: ids[0]!, boundaryIds: ids.slice(1), pickPoint: points[0]! } }
    case 'lengthen': return { command: definition.command, arguments: { id: ids[0]!, mode: 'TOTAL', ...values, pickPoint: points[0]! } }
    case 'stretch': return { command: definition.command, arguments: { ids, ...values, crossingStart: points[0]!, crossingEnd: points[1]! } }
    case 'polyline-insert': return { command: definition.command, arguments: { id: ids[0]!, operation: 'INSERT', ...values, point: points[0]! } }
    case 'polyline-delete': return { command: definition.command, arguments: { id: ids[0]!, operation: 'DELETE', ...values, point: points[0]! } }
    case 'polyline-arc': return { command: definition.command, arguments: { id: ids[0]!, operation: 'SET_BULGE', ...values, point: points[0]! } }
    case 'polyline-width': return { command: definition.command, arguments: { id: ids[0]!, operation: 'SET_WIDTH', ...values, point: points[0]! } }
    case 'chamfer': return { command: definition.command, arguments: { firstId: ids[0]!, secondId: ids[1]!, ...values, pickPoint1: points[0]!, pickPoint2: points[1]! } }
    case 'fillet': return { command: definition.command, arguments: { firstId: ids[0]!, secondId: ids[1]!, ...values, pickPoint1: points[0]!, pickPoint2: points[1]! } }
  }
}

/**
 * Build a bounded, exact geometry-only preview for point-driven modification controls.
 * This function never owns a document or transaction and cannot change drawing history.
 */
export function previewKJModification(
  id: KJModificationId,
  context: KJModificationBuildContext,
  entities: readonly KJReadonlyObjectRecord[],
  options: { readonly maxEntities?: number } = {},
): KJModificationPreview | null {
  if (!['mirror', 'array-polar', 'offset', 'chamfer', 'fillet'].includes(id)) return null
  const maxEntities = options.maxEntities ?? 256
  if (!Number.isSafeInteger(maxEntities) || maxEntities < 1 || maxEntities > 512) throw new RangeError('Modification preview maxEntities must be an integer from 1 to 512')
  if (context.ids.length > 64) throw new RangeError('Modification preview supports at most 64 selected entities')
  const byId = new Map(entities.map(entity => [entity.id, entity] as const))
  const selected = context.ids.map(entityId => {
    const entity = byId.get(entityId)
    if (!entity || entity.kind !== 'entity' || entity.erased) throw new RangeError(`Modification preview entity is unavailable: ${entityId}`)
    return entity
  })
  for (const entity of selected) {
    const layer = byId.get(String(entity.payload.layerId ?? ''))
    const reason = entity.payload.locked === true || layer?.payload.locked === true ? 'locked'
      : entity.payload.frozen === true || layer?.payload.frozen === true ? 'frozen'
        : entity.payload.visible === false || layer?.payload.visible === false ? 'hidden' : null
    if (reason) throw new RangeError(`Modification preview requires visible editable geometry; ${entity.id} is ${reason}`)
  }
  const request = buildKJModificationCommand(id, context)
  const args = request.arguments
  const before: KJModificationPreviewEntity[] = []
  const after: KJModificationPreviewEntity[] = []
  let total = 0
  const spec = (entity: KJReadonlyObjectRecord, payload: Readonly<Record<string, unknown>> = entity.payload): KJModificationPreviewEntity => ({ type: entity.type, payload })
  const add = (value: KJModificationPreviewEntity): void => { total += 1; if (after.length < maxEntities) after.push(value) }

  if (id === 'mirror') {
    const matrix = reflectionAcrossLine3(args.lineStart as KJModificationPoint, args.lineEnd as KJModificationPoint)
    for (const entity of selected) add(spec(entity, transformEntityPayload(entity.type, entity.payload, matrix)))
    if (args.eraseSource === true) before.push(...selected.map(entity => spec(entity)))
  } else if (id === 'array-polar') {
    const center = args.center as KJModificationPoint
    const count = Number(args.count), fillAngle = Number(args.angleDegrees) * Math.PI / 180
    const fullCircle = Math.abs(Math.abs(fillAngle) - Math.PI * 2) <= 1e-10
    const step = fillAngle / (fullCircle ? count : count - 1)
    outer: for (let index = 1; index < count; index += 1) {
      const rotation = rotationAround3(step * index, center)
      let matrix = rotation
      if (args.rotateItems === false) {
        const basePoint = args.basePoint as KJModificationPoint
        const rotated = transformPoint3(rotation, basePoint)
        matrix = translation3(rotated[0] - basePoint[0], rotated[1] - basePoint[1])
      }
      for (const entity of selected) {
        add(spec(entity, transformEntityPayload(entity.type, entity.payload, matrix)))
        if (after.length >= maxEntities) break outer
      }
    }
    total = (count - 1) * selected.length
  } else if (id === 'offset') {
    const entity = selected[0]!
    add(spec(entity, offsetEntityPayload(entity, args.distance, args)))
  } else {
    const first = selected[0]!, second = selected[1]!
    const result = id === 'chamfer' ? chamferLinePair(first, second, args) : filletLinePair(first, second, args)
    before.push(spec(first), spec(second))
    add(spec(first, result.first)); add(spec(second, result.second))
    const connector = result.connector
    if (connector.type !== 'LINE' || Math.hypot(Number(connector.payload.end[0]) - Number(connector.payload.start[0]), Number(connector.payload.end[1]) - Number(connector.payload.start[1])) > 1e-12) add(connector)
  }
  return Object.freeze({ before: Object.freeze(before), after: Object.freeze(after), omittedCount: Math.max(0, total - after.length) })
}
