// Generated from constants.ts by scripts/build-typescript.mjs. Do not edit directly.
export const KJD_SCHEMA = 'com.kanjie.kjdraw.document';
export const KJD_SCHEMA_VERSION = 1;
export const KJ_OBJECT_KINDS = Object.freeze([
    'entity',
    'table-record',
    'block-record',
    'layout',
    'dictionary',
    'xrecord',
    'group',
    'custom',
    'proxy'
]);
export const KJ_TABLE_NAMES = Object.freeze([
    'layers',
    'linetypes',
    'textStyles',
    'dimensionStyles',
    'ucs',
    'views',
    'blockRecords'
]);
export const KJ_SPACE_NAMES = Object.freeze({
    MODEL: '*MODEL_SPACE',
    PAPER: '*PAPER_SPACE'
});
export const KJ_EVENT_NAMES = Object.freeze({
    BEFORE_COMMIT: 'document:before-commit',
    AFTER_COMMIT: 'document:after-commit',
    CHANGE: 'document:change',
    UNDO: 'document:undo',
    REDO: 'document:redo',
    HISTORY: 'document:history'
});
export const KJ_FORMAT_CAPABILITY = Object.freeze({
    EXACT: 'exact',
    CONVERTED: 'converted',
    OPAQUE: 'opaque',
    UNSUPPORTED: 'unsupported'
});
export const KJ_STANDARD_TYPES = Object.freeze({
    entity: Object.freeze([
        'LINE',
        'RAY',
        'XLINE',
        'LWPOLYLINE',
        'POLYLINE',
        'ARC',
        'CIRCLE',
        'ELLIPSE',
        'SPLINE',
        'POINT',
        'HATCH',
        'SOLID',
        'TRACE',
        'IMAGE',
        'TEXT',
        'MTEXT',
        'ATTDEF',
        'ATTRIB',
        'INSERT',
        'LEADER',
        'MLEADER',
        'DIMENSION',
        'TABLE',
        'VIEWPORT',
        'WIPEOUT',
        'REVISION_CLOUD',
        'SOLID3D',
        'PROXY_ENTITY'
    ]),
    object: Object.freeze([
        'LAYER',
        'LINETYPE',
        'TEXT_STYLE',
        'DIM_STYLE',
        'UCS',
        'VIEW',
        'BLOCK_RECORD',
        'LAYOUT',
        'DICTIONARY',
        'XRECORD',
        'GROUP',
        'MATERIAL',
        'IMAGE_DEFINITION',
        'PROXY_OBJECT'
    ])
});
