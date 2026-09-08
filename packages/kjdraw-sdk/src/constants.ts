export const KJD_SCHEMA = 'com.kanjie.kjdraw.document' as const
export const KJD_SCHEMA_VERSION = 1 as const

export const KJ_OBJECT_KINDS = Object.freeze([
  'entity',
  'table-record',
  'block-record',
  'layout',
  'dictionary',
  'xrecord',
  'group',
  'custom',
  'proxy',
] as const)

export type KJObjectKind = typeof KJ_OBJECT_KINDS[number]

export const KJ_TABLE_NAMES = Object.freeze([
  'layers',
  'linetypes',
  'textStyles',
  'dimensionStyles',
  'ucs',
  'views',
  'blockRecords',
] as const)

export type KJTableName = typeof KJ_TABLE_NAMES[number]

export const KJ_SPACE_NAMES = Object.freeze({
  MODEL: '*MODEL_SPACE',
  PAPER: '*PAPER_SPACE',
} as const)

export type KJSpaceName = typeof KJ_SPACE_NAMES[keyof typeof KJ_SPACE_NAMES]

export const KJ_EVENT_NAMES = Object.freeze({
  BEFORE_COMMIT: 'document:before-commit',
  AFTER_COMMIT: 'document:after-commit',
  CHANGE: 'document:change',
  UNDO: 'document:undo',
  REDO: 'document:redo',
  HISTORY: 'document:history',
} as const)

export type KJEventName = typeof KJ_EVENT_NAMES[keyof typeof KJ_EVENT_NAMES]

export const KJ_FORMAT_CAPABILITY = Object.freeze({
  EXACT: 'exact',
  CONVERTED: 'converted',
  OPAQUE: 'opaque',
  UNSUPPORTED: 'unsupported',
} as const)

export type KJFormatCapability = typeof KJ_FORMAT_CAPABILITY[keyof typeof KJ_FORMAT_CAPABILITY]

export const KJ_STANDARD_TYPES = Object.freeze({
  entity: Object.freeze([
    'LINE', 'RAY', 'XLINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE',
    'ELLIPSE', 'SPLINE', 'POINT', 'HATCH', 'SOLID', 'TRACE', 'IMAGE',
    'TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB', 'INSERT', 'LEADER', 'MLEADER', 'DIMENSION', 'TABLE',
    'VIEWPORT', 'WIPEOUT', 'REVISION_CLOUD', 'SOLID3D',
    'PROXY_ENTITY',
  ] as const),
  object: Object.freeze([
    'LAYER', 'LINETYPE', 'TEXT_STYLE', 'DIM_STYLE', 'UCS', 'VIEW',
    'BLOCK_RECORD', 'LAYOUT', 'DICTIONARY', 'XRECORD', 'GROUP',
    'MATERIAL', 'IMAGE_DEFINITION', 'PROXY_OBJECT',
  ] as const),
} as const)

export type KJStandardEntityType = typeof KJ_STANDARD_TYPES.entity[number]
export type KJStandardObjectType = typeof KJ_STANDARD_TYPES.object[number]
export type KJStandardType = KJStandardEntityType | KJStandardObjectType
