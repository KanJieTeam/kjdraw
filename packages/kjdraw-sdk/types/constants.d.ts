export declare const KJD_SCHEMA: 'com.kanjie.kjdraw.document';
export declare const KJD_SCHEMA_VERSION: 1;
export declare const KJ_OBJECT_KINDS: readonly ["entity", "table-record", "block-record", "layout", "dictionary", "xrecord", "group", "custom", "proxy"];
export type KJObjectKind = typeof KJ_OBJECT_KINDS[number];
export declare const KJ_TABLE_NAMES: readonly ["layers", "linetypes", "textStyles", "dimensionStyles", "ucs", "views", "blockRecords"];
export type KJTableName = typeof KJ_TABLE_NAMES[number];
export declare const KJ_SPACE_NAMES: Readonly<{
    readonly MODEL: '*MODEL_SPACE';
    readonly PAPER: '*PAPER_SPACE';
}>;
export type KJSpaceName = typeof KJ_SPACE_NAMES[keyof typeof KJ_SPACE_NAMES];
export declare const KJ_EVENT_NAMES: Readonly<{
    readonly BEFORE_COMMIT: 'document:before-commit';
    readonly AFTER_COMMIT: 'document:after-commit';
    readonly CHANGE: 'document:change';
    readonly UNDO: 'document:undo';
    readonly REDO: 'document:redo';
    readonly HISTORY: 'document:history';
}>;
export type KJEventName = typeof KJ_EVENT_NAMES[keyof typeof KJ_EVENT_NAMES];
export declare const KJ_FORMAT_CAPABILITY: Readonly<{
    readonly EXACT: 'exact';
    readonly CONVERTED: 'converted';
    readonly OPAQUE: 'opaque';
    readonly UNSUPPORTED: 'unsupported';
}>;
export type KJFormatCapability = typeof KJ_FORMAT_CAPABILITY[keyof typeof KJ_FORMAT_CAPABILITY];
export declare const KJ_STANDARD_TYPES: Readonly<{
    readonly entity: readonly ["LINE", "RAY", "XLINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE", "POINT", "HATCH", "SOLID", "TRACE", "IMAGE", "TEXT", "MTEXT", "ATTDEF", "ATTRIB", "INSERT", "LEADER", "MLEADER", "DIMENSION", "TABLE", "VIEWPORT", "WIPEOUT", "REVISION_CLOUD", "SOLID3D", "PROXY_ENTITY"];
    readonly object: readonly ["LAYER", "LINETYPE", "TEXT_STYLE", "DIM_STYLE", "UCS", "VIEW", "BLOCK_RECORD", "LAYOUT", "DICTIONARY", "XRECORD", "GROUP", "MATERIAL", "IMAGE_DEFINITION", "PROXY_OBJECT"];
}>;
export type KJStandardEntityType = typeof KJ_STANDARD_TYPES.entity[number];
export type KJStandardObjectType = typeof KJ_STANDARD_TYPES.object[number];
export type KJStandardType = KJStandardEntityType | KJStandardObjectType;
