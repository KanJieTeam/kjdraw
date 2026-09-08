import type { ReadonlyDeep } from './utils.js';
import type { KJPointInput } from './grips.js';
import type { KJDocument } from './document.js';
import type { KJSelectionManager } from './selection.js';
import type { KJObjectPatch, KJTransaction } from './transaction.js';
import type { KJObjectPayload, KJObjectSpec } from './schema.js';
export interface KJCommandEnvelopeContext {
    readonly id?: unknown;
    readonly schema?: unknown;
    readonly schemaVersion?: unknown;
    readonly origin?: unknown;
}
export interface KJSolidSerialization extends Record<string, unknown> {
    validation?: {
        readonly valid?: boolean;
    };
}
export interface KJSolidSession {
    readonly volume: number;
    serialize(): KJSolidSerialization;
    transform(matrix: unknown): KJSolidSession;
    boolean(other: KJSolidSession, operation: unknown): KJSolidSession;
    validate(): unknown;
    close(): void;
}
export interface KJSolidAuthority extends Record<string, unknown> {
    readonly authoritative: true;
    openMesh(input: {
        vertices: unknown;
        triangles: unknown;
    }): KJSolidSession;
}
export interface KJCommandSDKContext {
    readonly solidAuthority?: unknown;
    getSelectionManager(documentId?: string | null): KJSelectionManager | null;
}
export interface KJCommandContext {
    readonly sdk: KJCommandSDKContext;
    readonly document: KJDocument;
    readonly transaction: KJTransaction;
    readonly author?: unknown;
    readonly expectedRevision?: number;
    readonly commandEnvelope?: KJCommandEnvelopeContext | null;
    readonly events?: unknown;
    readonly extensions?: unknown;
}
export type KJCommandInputContext = Partial<KJCommandContext>;
export interface KJEntityBatchSpec extends Record<string, unknown> {
    type?: string;
    payload?: KJObjectPayload;
    options?: KJObjectSpec;
    layerName?: string;
    layer?: {
        color?: unknown;
        visible?: unknown;
        frozen?: unknown;
        locked?: unknown;
        plottable?: unknown;
    };
}
/**
 * Extensible command argument bag. Known core fields are typed for editor and
 * framework consumers; third-party commands may add names through the index
 * signature without weakening the SDK through an untyped escape hatch.
 */
export interface KJCommandArguments extends Record<string, unknown> {
    id?: string;
    ids?: readonly string[];
    firstId?: string;
    secondId?: string;
    boundaryIds?: readonly string[];
    ownerId?: string | null;
    layerId?: string;
    layoutId?: string;
    layoutName?: string;
    blockRecordId?: string;
    name?: string;
    newName?: string | null;
    type?: string;
    operation?: string;
    mode?: string;
    query?: string;
    status?: string;
    referenceType?: string;
    gripId?: string;
    sha256?: string | null;
    checkedAt?: unknown;
    author?: unknown;
    value?: unknown;
    source?: unknown;
    other?: unknown;
    otherDocument?: unknown;
    payload?: KJObjectPayload;
    patch?: KJObjectPatch;
    properties?: KJObjectPayload;
    options?: KJObjectSpec;
    payloadPatch?: KJObjectPayload;
    connectorPayloadPatch?: KJObjectPayload;
    entities?: readonly KJEntityBatchSpec[];
    modes?: readonly string[];
    kinds?: readonly string[];
    types?: readonly string[];
    boundaryLoops?: unknown;
    attributes?: unknown;
    mappings?: unknown;
    pattern?: unknown;
    settings?: Record<string, unknown>;
    position?: unknown;
    insertionPoint?: unknown;
    center?: KJPointInput;
    basePoint?: KJPointInput;
    from?: KJPointInput;
    to?: KJPointInput;
    start?: KJPointInput;
    end?: KJPointInput;
    lineStart?: KJPointInput;
    lineEnd?: KJPointInput;
    point?: KJPointInput;
    firstPoint?: KJPointInput;
    secondPoint?: KJPointInput;
    firstVector?: KJPointInput;
    secondVector?: KJPointInput;
    vertex?: KJPointInput;
    pickPoint?: KJPointInput;
    sidePoint?: KJPointInput;
    points?: readonly KJPointInput[];
    origin?: unknown;
    xAxis?: unknown;
    yAxis?: unknown;
    viewCenter?: unknown;
    frozenLayerIds?: readonly string[];
    matrix?: unknown;
    scale?: unknown;
    factor?: unknown;
    angle?: unknown;
    angleDegrees?: unknown;
    rotation?: unknown;
    radius?: unknown;
    distance?: unknown;
    distance1?: unknown;
    distance2?: unknown;
    dx?: unknown;
    dy?: unknown;
    rows?: unknown;
    columns?: unknown;
    rowSpacing?: unknown;
    columnSpacing?: unknown;
    count?: unknown;
    items?: unknown;
    width?: unknown;
    height?: unknown;
    viewHeight?: unknown;
    twistAngle?: unknown;
    patternScale?: unknown;
    patternAngle?: unknown;
    color?: unknown;
    lineweight?: unknown;
    linetypeId?: unknown;
    fontFamily?: unknown;
    fontFile?: unknown;
    bigFontFile?: unknown;
    fixedHeight?: unknown;
    widthFactor?: unknown;
    obliqueAngle?: unknown;
    description?: unknown;
    patternName?: unknown;
    enabled?: unknown;
    visible?: unknown;
    frozen?: unknown;
    locked?: unknown;
    plottable?: unknown;
    solid?: unknown;
    append?: unknown;
    keepSource?: unknown;
    eraseSource?: unknown;
    eraseSources?: unknown;
    includeErased?: unknown;
    includeSource?: unknown;
    rotateItems?: unknown;
    selectable?: unknown;
    side?: unknown;
    limit?: unknown;
}
export interface KJCommandDefinition {
    readonly id: string;
    readonly title?: string;
    readonly aliases?: readonly string[];
    readonly transactional?: boolean;
    readonly capabilities?: Record<string, unknown>;
    readonly execute: (context: KJCommandContext, args: KJCommandArguments) => unknown | Promise<unknown>;
    readonly canExecute?: (context: KJCommandInputContext, args: KJCommandArguments) => boolean | Promise<boolean>;
}
export interface KJRegisteredCommand extends KJCommandDefinition {
    readonly owner: string;
    readonly aliases: readonly string[];
    readonly capabilities: ReadonlyDeep<Record<string, unknown>>;
}
/**
 * Exact, machine-readable scope of the built-in command implementations.
 * A command being registered never implies that it supports every entity type.
 */
export declare const KJ_CORE_COMMAND_CAPABILITIES: {
    readonly UNDO: {
        domain: string;
    };
    readonly REDO: {
        domain: string;
    };
    readonly SELECT: {
        readonly domain: string;
        readonly operations: readonly string[];
    };
    readonly SELECTIONSAVE: {
        domain: string;
        persistence: string;
    };
    readonly SELECTIONRESTORE: {
        domain: string;
        persistence: string;
    };
    readonly CREATE: {
        domain: string;
        supportedEntityTypes: string;
    };
    readonly CREATEBATCH: {
        domain: string;
        supportedEntityTypes: string;
        atomic: boolean;
        maximumEntities: number;
    };
    readonly ERASE: {
        domain: string;
        supportedObjectKinds: string;
    };
    readonly RESTORE: {
        domain: string;
        supportedObjectKinds: string;
    };
    readonly PROPERTIES: {
        domain: string;
        supportedObjectKinds: string;
    };
    readonly SETVAR: {
        domain: string;
    };
    readonly LAYERNEW: {
        domain: string;
    };
    readonly LAYERCURRENT: {
        domain: string;
    };
    readonly LAYERUPDATE: {
        domain: string;
    };
    readonly LAYERDELETE: {
        domain: string;
        guard: string;
    };
    readonly MOVE: {
        domain: string;
        precision: string;
        supportedEntityTypes: readonly string[];
    };
    readonly ROTATE: {
        domain: string;
        precision: string;
        supportedEntityTypes: readonly string[];
    };
    readonly SCALE: {
        domain: string;
        precision: string;
        supportedEntityTypes: readonly string[];
    };
    readonly COPY: {
        domain: string;
        precision: string;
        supportedEntityTypes: readonly string[];
    };
    readonly MIRROR: {
        domain: string;
        precision: string;
        supportedEntityTypes: readonly string[];
    };
    readonly ARRAYRECT: {
        domain: string;
        precision: string;
        supportedEntityTypes: readonly string[];
    };
    readonly ARRAYPOLAR: {
        domain: string;
        precision: string;
        supportedEntityTypes: readonly string[];
    };
    readonly OFFSET: {
        readonly domain: string;
        readonly precision: string;
        readonly supportedEntityTypes: readonly string[];
    };
    readonly BREAK: {
        readonly domain: string;
        readonly precision: string;
        readonly supportedEntityTypes: readonly string[];
    };
    readonly EXPLODE: {
        readonly domain: string;
        readonly precision: string;
        readonly supportedEntityTypes: readonly string[];
    };
    readonly TRIM: {
        readonly domain: string;
        readonly precision: string;
        readonly targetEntityTypes: readonly string[];
        readonly boundaryEntityTypes: readonly string[];
    };
    readonly EXTEND: {
        readonly domain: string;
        readonly precision: string;
        readonly targetEntityTypes: readonly string[];
        readonly boundaryEntityTypes: readonly string[];
    };
    readonly CHAMFER: {
        readonly domain: string;
        readonly precision: string;
        readonly supportedEntityTypes: readonly string[];
    };
    readonly FILLET: {
        readonly domain: string;
        readonly precision: string;
        readonly supportedEntityTypes: readonly string[];
    };
    readonly GRIPEDIT: {
        domain: string;
        precision: string;
        supportedEntityTypes: readonly string[];
    };
    readonly LENGTH: {
        readonly domain: string;
        readonly exactEntityTypes: readonly string[];
        readonly approximateEntityTypes: readonly string[];
    };
    readonly AREA: {
        readonly domain: string;
        readonly exactEntityTypes: readonly string[];
    };
    readonly DISTANCE: {
        readonly domain: string;
        readonly precision: string;
        readonly modes: readonly string[];
        readonly supportedEntityTypes: readonly string[];
    };
    readonly ANGLE: {
        readonly domain: string;
        readonly precision: string;
        readonly modes: readonly string[];
    };
    readonly INTERSECT: {
        readonly domain: string;
        readonly precision: string;
        readonly supportedEntityTypes: readonly string[];
    };
    readonly NEAREST: {
        readonly domain: string;
        readonly precision: string;
        readonly supportedEntityTypes: readonly string[];
    };
    readonly ORTHO: {
        domain: string;
        systemVariable: string;
    };
    readonly SNAPSETTINGS: {
        domain: string;
        snapModes: readonly ["endpoint", "midpoint", "center", "quadrant", "insertion", "node", "nearest", "intersection"];
    };
    readonly BLOCKCREATE: {
        domain: string;
        precision: string;
        supportedEntityTypes: readonly string[];
    };
    readonly BLOCKINSERT: {
        domain: string;
        entityType: string;
    };
    readonly XREFATTACH: {
        domain: string;
        authority: string;
        remoteUrls: boolean;
    };
    readonly XREFRELOAD: {
        domain: string;
        authority: string;
    };
    readonly XREFDETACH: {
        domain: string;
    };
    readonly GROUP: {
        domain: string;
        persistence: string;
    };
    readonly HATCH: {
        readonly domain: string;
        readonly entityType: string;
        readonly boundaryModes: readonly string[];
    };
    readonly LINETYPE: {
        readonly domain: string;
        readonly table: string;
        readonly operations: readonly string[];
    };
    readonly TEXTSTYLE: {
        readonly domain: string;
        readonly table: string;
        readonly operations: readonly string[];
    };
    readonly DIMSTYLE: {
        readonly domain: string;
        readonly table: string;
        readonly operations: readonly string[];
    };
    readonly UCS: {
        readonly domain: string;
        readonly table: string;
        readonly operations: readonly string[];
    };
    readonly LAYOUT: {
        readonly domain: string;
        readonly operations: readonly string[];
    };
    readonly VIEWPORT: {
        readonly domain: string;
        readonly entityType: string;
        readonly operations: readonly string[];
    };
    readonly PLOTSETUP: {
        readonly domain: string;
        readonly persistence: string;
        readonly devices: readonly string[];
    };
    readonly PLOTSTYLE: {
        domain: string;
        persistence: string;
    };
    readonly SEARCH: {
        readonly domain: string;
        readonly fields: readonly string[];
    };
    readonly COMPARE: {
        readonly domain: string;
        readonly identity: string;
        readonly classifications: readonly string[];
    };
    readonly SOLIDBOX: {
        domain: string;
        authority: string;
        operation: string;
    };
    readonly SOLIDCYLINDER: {
        domain: string;
        authority: string;
        operation: string;
    };
    readonly SOLIDCONE: {
        domain: string;
        authority: string;
        operation: string;
    };
    readonly SOLIDSPHERE: {
        domain: string;
        authority: string;
        operation: string;
    };
    readonly SOLIDSWEEP: {
        domain: string;
        authority: string;
        operation: string;
        profile: string;
    };
    readonly SOLIDLOFT: {
        domain: string;
        authority: string;
        operation: string;
        profile: string;
    };
    readonly SOLIDTRANSFORM: {
        domain: string;
        authority: string;
        operation: string;
    };
    readonly SOLIDBOOLEAN: {
        readonly domain: string;
        readonly authority: string;
        readonly operations: readonly string[];
        readonly exactScope: string;
    };
    readonly SOLIDVALIDATE: {
        readonly domain: string;
        readonly authority: string;
        readonly checks: readonly string[];
    };
    readonly SOLIDVOLUME: {
        domain: string;
        authority: string;
        precision: string;
    };
};
export declare class KJCommandRegistry {
    #private;
    register(definition: KJCommandDefinition, { owner, replace }?: {
        owner?: string;
        replace?: boolean;
    }): () => boolean;
    resolve(id: unknown): KJRegisteredCommand | null;
    list(): KJRegisteredCommand[];
    removeOwner(owner: unknown): number;
    execute(id: unknown, context?: KJCommandInputContext, args?: KJCommandArguments): Promise<unknown>;
}
export declare function registerCoreCommands(registry: KJCommandRegistry): () => void;
