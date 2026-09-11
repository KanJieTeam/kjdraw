// Generated from drawing-context.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJRevisionConflictError, KJValidationError } from './errors.js';
import { deepFreeze } from './utils.js';
import { classifyEntityInBox } from './selection-geometry.js';
import { PLOT_SETTING_FIELDS } from './plot-settings.js';
import { projectDimension, resolveDimensionAnnotationStyle } from './geometry/annotation.js';
const MAX_GEOMETRY_BYTES = 8192;
const REASONS = [
    'entity-limit',
    'layer-limit',
    'response-budget',
    'geometry-budget',
    'unsupported-geometry'
];
const OPTION_KEYS = new Set([
    'ids',
    'types',
    'layerIds',
    'spaceId',
    'includeHidden',
    'bounds',
    'expectedRevision',
    'offset',
    'layerOffset',
    'limit',
    'maxLayers',
    'maxBytes'
]);
const encoder = new TextEncoder();
const scalar = 'scalar';
const point = [
    scalar
];
const vertex = {
    point,
    bulge: scalar,
    startWidth: scalar,
    endWidth: scalar
};
const polyline = {
    vertices: [
        vertex
    ],
    closed: scalar,
    elevation: scalar
};
const textGeometry = {
    position: point,
    alignmentPoint: point,
    text: scalar,
    height: scalar,
    rotation: scalar,
    mirrored: scalar,
    styleId: scalar,
    horizontalAlignment: scalar,
    verticalAlignment: scalar,
    width: scalar,
    attachmentPoint: scalar
};
const lineEdge = {
    type: scalar,
    start: point,
    end: point
};
const arcEdge = {
    type: scalar,
    center: point,
    radius: scalar,
    startAngle: scalar,
    endAngle: scalar,
    clockwise: scalar,
    counterClockwise: scalar
};
const GEOMETRY = {
    LINE: {
        start: point,
        end: point,
        degenerate: scalar
    },
    RAY: {
        origin: point,
        direction: point
    },
    XLINE: {
        origin: point,
        direction: point
    },
    POINT: {
        position: point
    },
    CIRCLE: {
        center: point,
        radius: scalar,
        normal: point
    },
    ARC: {
        center: point,
        radius: scalar,
        startAngle: scalar,
        endAngle: scalar,
        clockwise: scalar,
        normal: point
    },
    LWPOLYLINE: polyline,
    POLYLINE: polyline,
    WIPEOUT: polyline,
    REVISION_CLOUD: polyline,
    ELLIPSE: {
        center: point,
        majorAxis: point,
        ratio: scalar,
        startParameter: scalar,
        endParameter: scalar,
        clockwise: scalar
    },
    SPLINE: {
        degree: scalar,
        controlPoints: [
            point
        ],
        fitPoints: [
            point
        ],
        weights: [
            scalar
        ],
        knots: [
            scalar
        ],
        closed: scalar,
        periodic: scalar
    },
    TEXT: textGeometry,
    MTEXT: textGeometry,
    ATTDEF: {
        ...textGeometry,
        tag: scalar,
        prompt: scalar,
        flags: scalar,
        lockPosition: scalar
    },
    ATTRIB: {
        ...textGeometry,
        tag: scalar,
        prompt: scalar,
        flags: scalar,
        lockPosition: scalar
    },
    INSERT: {
        blockRecordId: scalar,
        position: point,
        scale: point,
        rotation: scalar,
        mirrored: scalar
    },
    IMAGE: {
        imageResourceId: scalar,
        position: point,
        uVector: point,
        vVector: point,
        clipBoundary: [
            point
        ]
    },
    HATCH: {
        boundaryLoops: [
            {
                external: scalar,
                closed: scalar,
                vertices: [
                    vertex
                ],
                edges: [
                    'hatch-edge'
                ]
            }
        ],
        patternName: scalar,
        patternScale: scalar,
        patternAngle: scalar,
        solid: scalar
    },
    LEADER: {
        vertices: [
            point
        ],
        textPosition: point,
        annotationId: scalar
    },
    MLEADER: {
        vertices: [
            point
        ],
        textPosition: point,
        annotationId: scalar
    },
    DIMENSION: {
        dimensionType: scalar,
        definitionPoints: [
            point
        ],
        textPosition: point,
        textOverride: scalar,
        styleId: scalar,
        styleName: scalar,
        blockName: scalar,
        measurement: scalar,
        dxfDimensionType: scalar,
        rotation: scalar,
        textHeight: scalar,
        precision: scalar,
        linearPrecision: scalar,
        angularUnits: scalar,
        overallScale: scalar,
        arrowSize: scalar,
        extensionOffset: scalar,
        extensionBeyond: scalar,
        incompleteAngularDefinition: scalar
    },
    VIEWPORT: {
        center: point,
        width: scalar,
        height: scalar,
        viewCenter: point,
        viewHeight: scalar,
        twistAngle: scalar,
        frozenLayerIds: [
            scalar
        ]
    },
    SOLID: {
        vertices: [
            point
        ]
    },
    TRACE: {
        vertices: [
            point
        ]
    },
    SOLID3D: {
        vertices: [
            point
        ],
        triangles: [
            point
        ],
        kernelAuthority: scalar,
        solidModelVersion: scalar
    },
    TABLE: {
        position: point,
        rows: scalar,
        columns: scalar,
        cells: [
            [
                {
                    text: scalar
                }
            ]
        ],
        rowHeights: [
            scalar
        ],
        columnWidths: [
            scalar
        ],
        styleId: scalar
    }
};
function integer(value, fallback, min, max, name) {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new KJValidationError(`Drawing context ${name} must be an integer in ${min}..${max}`);
    }
    return value;
}
function filterStrings(value, name, normalize = false) {
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.length > 200) throw new KJValidationError(`Drawing context ${name} must be an array of at most 200 strings`);
    const result = new Set();
    for (const entry of value){
        if (typeof entry !== 'string' || !entry.trim() || entry.length > 512) throw new KJValidationError(`Drawing context ${name} entries must be non-empty strings of at most 512 characters`);
        result.add(normalize ? entry.trim().toUpperCase() : entry);
    }
    return result;
}
class ProjectionFailure {
    reason;
    constructor(reason){
        this.reason = reason;
    }
}
class ProjectionBudget {
    remaining = MAX_GEOMETRY_BYTES;
    charge(bytes) {
        this.remaining -= bytes;
        if (this.remaining < 0) throw new ProjectionFailure('geometry-budget');
    }
}
function project(value, shape, budget) {
    if (value === null) {
        budget.charge(4);
        return null;
    }
    if (shape === 'scalar') {
        if (typeof value === 'string') {
            if (value.length > budget.remaining) throw new ProjectionFailure('geometry-budget');
        } else if (typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) {
            throw new ProjectionFailure('unsupported-data');
        }
        budget.charge(encoder.encode(JSON.stringify(value)).byteLength);
        return value;
    }
    if (shape === 'hatch-edge') {
        const type = value && typeof value === 'object' ? value.type : null;
        if (type !== 'LINE' && type !== 'ARC') throw new ProjectionFailure('unsupported-data');
        return project(value, type === 'LINE' ? lineEdge : arcEdge, budget);
    }
    if (Array.isArray(shape)) {
        if (!Array.isArray(value)) throw new ProjectionFailure('unsupported-data');
        budget.charge(2);
        const result = [];
        for (const child of value){
            if (result.length) budget.charge(1);
            result.push(project(child, shape[0], budget));
        }
        return result;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectionFailure('unsupported-data');
    budget.charge(2);
    const result = {};
    for (const [key, childShape] of Object.entries(shape)){
        const child = value[key];
        if (child === undefined) continue;
        budget.charge((Object.keys(result).length ? 1 : 0) + key.length + 3);
        result[key] = project(child, childShape, budget);
    }
    return result;
}
const annotationShape = {
    status: scalar,
    reason: scalar,
    coordinateSpace: scalar,
    measurement: scalar,
    measurementUnit: scalar,
    measurementBasis: scalar,
    associativity: scalar,
    labelRotationUnit: scalar,
    label: {
        text: scalar,
        position: point,
        height: scalar,
        rotation: scalar
    },
    effectiveStyle: {
        binding: scalar,
        styleId: scalar,
        styleName: scalar,
        lengthUnits: scalar,
        lengthsAreUnscaled: scalar,
        overallScale: scalar,
        textHeight: scalar,
        arrowSize: scalar,
        extensionOffset: scalar,
        extensionBeyond: scalar
    },
    formatInputs: {
        entityPrecision: scalar,
        entityLinearPrecision: scalar,
        entityAngularUnits: scalar,
        styleDecimalPlaces: scalar,
        styleAngularDecimalPlaces: scalar,
        styleAngularUnits: scalar
    }
};
function dimensionAnnotation(entity, geometry, state) {
    const coordinateSpace = entity.ownerId === state.spaces.modelSpaceId ? 'model-xy' : state.spaces.paperSpaceIds.includes(String(entity.ownerId)) ? 'paper-xy' : 'block-local';
    const type = String(geometry.dimensionType), angular = type === 'ANGULAR' || type === 'ANGULAR_3_POINT';
    const measurementUnit = angular ? 'degrees' : coordinateSpace === 'model-xy' ? state.header.units : 'unknown';
    const styleId = typeof geometry.styleId === 'string' && geometry.styleId ? geometry.styleId : null;
    const record = styleId && Object.hasOwn(state.objects, styleId) ? state.objects[styleId] : undefined;
    const validStyle = record?.kind === 'table-record' && record.type === 'DIM_STYLE' && !record.erased && state.tables.dimensionStyles.recordIds.includes(record.id);
    const style = validStyle ? record.payload : {};
    const inputNumber = (value)=>typeof value === 'number' && Number.isFinite(value) ? value : null;
    const base = {
        coordinateSpace,
        measurementUnit,
        measurementBasis: 'native-definition-points',
        associativity: 'not-evaluated',
        labelRotationUnit: 'radians',
        formatInputs: {
            entityPrecision: inputNumber(geometry.precision),
            entityLinearPrecision: inputNumber(geometry.linearPrecision),
            entityAngularUnits: inputNumber(geometry.angularUnits),
            styleDecimalPlaces: inputNumber(style.decimalPlaces),
            styleAngularDecimalPlaces: inputNumber(style.angularDecimalPlaces),
            styleAngularUnits: inputNumber(style.angularUnits)
        }
    };
    const unsupported = (reason)=>({
            ...base,
            status: 'unsupported',
            reason,
            measurement: null,
            label: null,
            effectiveStyle: null
        });
    if (styleId && !validStyle) return unsupported('unresolved-style-reference');
    const isXY = (p)=>Array.isArray(p) && p.length >= 2 && p.length <= 3 && p.every((n)=>typeof n === 'number' && Number.isFinite(n)) && (p.length === 2 || p[2] === 0);
    const points = geometry.definitionPoints;
    if (!Array.isArray(points) || !points.every(isXY)) return unsupported('non-xy-definition');
    if (geometry.textPosition !== undefined && geometry.textPosition !== null && !isXY(geometry.textPosition)) return unsupported('non-xy-text-position');
    for (const key of [
        'normal',
        'extrusionDirection'
    ]){
        const n = geometry[key];
        if (n !== undefined && n !== null && (!Array.isArray(n) || n.length !== 3 || n[0] !== 0 || n[1] !== 0 || n[2] !== 1)) return unsupported('non-xy-orientation');
    }
    const projection = projectDimension(geometry, style);
    if (!projection) return unsupported('unsupported-native-projection');
    const effectiveStyle = {
        ...resolveDimensionAnnotationStyle(geometry, style),
        binding: validStyle ? 'style-id' : 'projection-defaults',
        styleId,
        styleName: validStyle ? record.name : null,
        lengthUnits: 'owner-coordinate-units',
        lengthsAreUnscaled: true
    };
    return {
        ...base,
        status: 'projected',
        reason: null,
        measurement: projection.measurement,
        label: projection.label,
        effectiveStyle
    };
}
function nativeGeometry(entity, state) {
    const shape = Object.hasOwn(GEOMETRY, entity.type) ? GEOMETRY[entity.type] : undefined;
    if (!shape) return {
        geometry: null,
        geometryOmittedReason: 'unsupported-type'
    };
    try {
        const orientedShape = {
            ...shape,
            normal: point,
            extrusionDirection: point
        };
        const budget = new ProjectionBudget();
        const geometry = project(entity.payload, orientedShape, budget);
        if (entity.type === 'DIMENSION') {
            const hadCache = Object.hasOwn(geometry, 'measurement');
            geometry.cachedMeasurement = geometry.measurement ?? null;
            delete geometry.measurement;
            budget.charge((hadCache ? 'cachedMeasurement'.length - 'measurement'.length : '"cachedMeasurement":null'.length + (Object.keys(geometry).length > 1 ? 1 : 0)) + ',"annotation":'.length);
            geometry.annotation = project(dimensionAnnotation(entity, geometry, state), annotationShape, budget);
        }
        return {
            geometry,
            geometryOmittedReason: null
        };
    } catch (error) {
        if (!(error instanceof ProjectionFailure)) throw error;
        return {
            geometry: null,
            geometryOmittedReason: error.reason
        };
    }
}
function jsonBytes(value) {
    return encoder.encode(JSON.stringify(value)).byteLength;
}
function checkIdentity(value, maxBytes) {
    if (value !== null && (typeof value !== 'string' || value.length > maxBytes)) {
        throw new KJValidationError('Drawing context identity or layer name cannot fit the response budget');
    }
}
export function createLayoutContext(document, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new KJValidationError('Layout context options must be an object');
    for (const key of Object.keys(options))if (![
        'expectedRevision',
        'offset',
        'limit',
        'maxBytes'
    ].includes(key)) throw new KJValidationError('Unknown layout context option');
    const limit = integer(options.limit, 20, 1, 100, 'limit'), maxBytes = integer(options.maxBytes, 16384, 1024, 262144, 'maxBytes');
    const offset = integer(options.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
    const revision = options.expectedRevision === undefined ? undefined : integer(options.expectedRevision, 0, 0, Number.MAX_SAFE_INTEGER, 'expectedRevision');
    if (offset && revision === undefined) throw new KJValidationError('Layout context continuation requires expectedRevision');
    if (!document || typeof document.snapshot !== 'function') throw new KJValidationError('Layout context requires a KJDocument');
    if (revision !== undefined && revision !== document.revision) throw new KJRevisionConflictError(revision, document.revision);
    const state = document.snapshot();
    if (revision !== undefined && revision !== state.revision) throw new KJRevisionConflictError(revision, state.revision);
    checkIdentity(state.documentId, maxBytes);
    const layouts = [];
    const result = {
        documentId: state.documentId,
        revision: state.revision,
        layouts,
        nextOffset: null,
        truncated: false,
        pageSemantics: {
            physicalUnits: 'millimeter',
            rotation: 'quarter-turns-counterclockwise',
            windowCoordinates: 'drawing-units',
            resourceNamesIncluded: false
        },
        limits: {
            limit,
            maxBytes
        }
    };
    const live = state.spaces.layoutIds.filter((id)=>state.objects[id]?.kind === 'layout' && !state.objects[id]?.erased);
    const fits = (entry)=>jsonBytes({
            ...result,
            layouts: entry ? [
                ...layouts,
                entry
            ] : layouts,
            nextOffset: Number.MAX_SAFE_INTEGER,
            truncated: false
        }) <= maxBytes;
    if (!fits()) throw new KJValidationError('Layout context document identity cannot fit the response budget');
    let cursor = offset;
    while(cursor < live.length && layouts.length < limit){
        const layout = state.objects[live[cursor]], spaceId = layout.payload.blockRecordId;
        if (typeof spaceId !== 'string' || state.objects[spaceId]?.kind !== 'block-record' || state.objects[spaceId].erased) throw new KJValidationError('Layout context requires a live owner space');
        for (const value of [
            layout.id,
            spaceId
        ])checkIdentity(value, maxBytes);
        const omitted = [];
        let name = layout.name;
        if (name !== null && name.length > 512) {
            name = null;
            omitted.push('name');
        }
        let pageSettings = null;
        if (layout.payload.dxfPlotSettings !== undefined) {
            pageSettings = {};
            for (const [key, [, kind]] of Object.entries(PLOT_SETTING_FIELDS)){
                if (kind === 'string') continue;
                const value = layout.payload.dxfPlotSettings[key];
                if (typeof value === 'number' && Number.isFinite(value)) pageSettings[key] = value;
            }
        }
        const entry = {
            id: layout.id,
            name,
            spaceId,
            model: spaceId === state.spaces.modelSpaceId,
            active: layout.id === state.spaces.activeLayoutId,
            tabOrder: typeof layout.payload.tabOrder === 'number' && Number.isFinite(layout.payload.tabOrder) ? layout.payload.tabOrder : null,
            pageSettings,
            omitted
        };
        if (!fits(entry)) {
            if (layouts.length) break;
            if (name !== null) {
                name = null;
                omitted.push('name');
            }
            if (pageSettings !== null) {
                pageSettings = null;
                omitted.push('page-settings');
            }
            const reduced = {
                ...entry,
                name,
                pageSettings
            };
            if (!fits(reduced)) throw new KJValidationError('Layout identity cannot fit the response budget');
            layouts.push(reduced);
        } else layouts.push(entry);
        cursor++;
    }
    result.nextOffset = cursor < live.length ? cursor : null;
    result.truncated = result.nextOffset !== null || layouts.some((layout)=>layout.omitted.length > 0);
    return deepFreeze(result);
}
export function createDrawingContext(document, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new KJValidationError('Drawing context options must be an object');
    for (const key of Object.keys(options))if (!OPTION_KEYS.has(key)) throw new KJValidationError('Unknown drawing context option');
    if (options.includeHidden !== undefined && typeof options.includeHidden !== 'boolean') throw new KJValidationError('Drawing context includeHidden must be boolean');
    const bounds = options.bounds;
    if (bounds !== undefined && (!Array.isArray(bounds) || bounds.length !== 4 || [
        ...bounds
    ].some((n)=>typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e12) || bounds[0] > bounds[2] || bounds[1] > bounds[3])) throw new KJValidationError('Drawing context bounds must be ordered finite XY extents within +/-1e12');
    const limit = integer(options.limit, 50, 0, 200, 'limit');
    const maxLayers = integer(options.maxLayers, 50, 0, 100, 'maxLayers');
    const maxBytes = integer(options.maxBytes, 65536, 1024, 262144, 'maxBytes');
    const offset = integer(options.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
    const layerOffset = integer(options.layerOffset, 0, 0, Number.MAX_SAFE_INTEGER, 'layerOffset');
    const expectedRevision = options.expectedRevision === undefined ? undefined : integer(options.expectedRevision, 0, 0, Number.MAX_SAFE_INTEGER, 'expectedRevision');
    if ((offset > 0 || layerOffset > 0) && expectedRevision === undefined) throw new KJValidationError('Drawing context continuation requires expectedRevision');
    const ids = filterStrings(options.ids, 'ids');
    const types = filterStrings(options.types, 'types', true);
    const layerIds = filterStrings(options.layerIds, 'layerIds');
    if (options.spaceId !== undefined) filterStrings([
        options.spaceId
    ], 'spaceId');
    if (!document || typeof document.snapshot !== 'function') throw new KJValidationError('Drawing context requires a KJDocument');
    if (expectedRevision !== undefined && document.revision !== expectedRevision) throw new KJRevisionConflictError(expectedRevision, document.revision);
    const state = document.snapshot();
    if (expectedRevision !== undefined && state.revision !== expectedRevision) throw new KJRevisionConflictError(expectedRevision, state.revision);
    const spaceId = options.spaceId ?? state.spaces.modelSpaceId;
    const space = Object.hasOwn(state.objects, spaceId) ? state.objects[spaceId] : undefined;
    if (!space || space.erased || space.kind !== 'block-record') throw new KJValidationError('Drawing context spaceId must identify a live block record');
    for (const value of [
        state.documentId,
        state.header.units,
        spaceId
    ])checkIdentity(value, maxBytes);
    const result = {
        documentId: state.documentId,
        revision: state.revision,
        units: state.header.units,
        spaceId,
        ...bounds ? {
            spatialQuery: {
                bounds: [
                    ...bounds
                ],
                coordinates: 'owner-xy',
                mode: 'crossing',
                unclassifiedIncluded: true
            }
        } : {},
        layers: [],
        entities: [],
        truncated: false,
        truncationReasons: [],
        nextOffset: null,
        nextLayerOffset: null,
        limits: {
            limit,
            maxLayers,
            maxBytes,
            maxGeometryBytes: MAX_GEOMETRY_BYTES
        }
    };
    let usedBytes = jsonBytes({
        ...result,
        truncated: false,
        truncationReasons: REASONS,
        nextOffset: Number.MAX_SAFE_INTEGER,
        nextLayerOffset: Number.MAX_SAFE_INTEGER
    });
    if (usedBytes > maxBytes) throw new KJValidationError('Drawing context document identity cannot fit the response budget');
    const reasons = new Set();
    const addReason = (reason)=>{
        if (reason) reasons.add(reason === 'unsupported-type' || reason === 'unsupported-data' ? 'unsupported-geometry' : reason);
    };
    let matched = 0;
    if (limit > 0) for (const id of ids ?? space.payload.entityIds ?? []){
        const entity = Object.hasOwn(state.objects, id) ? state.objects[id] : undefined;
        if (!entity || entity.erased || entity.kind !== 'entity' || entity.ownerId !== spaceId) continue;
        const layerId = entity.payload.layerId ?? null;
        if (types && !types.has(entity.type) || layerIds && (layerId === null || !layerIds.has(layerId))) continue;
        const layer = layerId !== null && Object.hasOwn(state.objects, layerId) ? state.objects[layerId] : undefined;
        const visible = entity.payload.visible !== false && layer?.payload.visible !== false && layer?.payload.frozen !== true;
        if (!visible && !options.includeHidden) continue;
        const spatialMatch = bounds ? classifyEntityInBox(document, entity, bounds) : undefined;
        if (spatialMatch === 'outside') continue;
        if (matched++ < offset) continue;
        if (result.entities.length >= limit) {
            result.nextOffset = matched - 1;
            reasons.add('entity-limit');
            break;
        }
        for (const value of [
            entity.id,
            entity.type,
            entity.ownerId,
            layerId
        ])checkIdentity(value, maxBytes);
        const item = {
            id: entity.id,
            type: entity.type,
            ownerId: entity.ownerId,
            layerId,
            visible,
            editable: visible && layer?.payload.locked !== true,
            ...nativeGeometry(entity, state),
            ...spatialMatch ? {
                spatialMatch
            } : {}
        };
        let bytes = jsonBytes(item) + (result.entities.length ? 1 : 0);
        if (usedBytes + bytes > maxBytes && item.geometry !== null) {
            item.geometry = null;
            item.geometryOmittedReason = 'response-budget';
            bytes = jsonBytes(item) + (result.entities.length ? 1 : 0);
        }
        if (usedBytes + bytes > maxBytes) {
            if (!result.entities.length) throw new KJValidationError('Drawing context entity identity cannot fit the response budget');
            result.nextOffset = matched - 1;
            reasons.add('response-budget');
            break;
        }
        usedBytes += bytes;
        result.entities.push(item);
        addReason(item.geometryOmittedReason);
    }
    let matchedLayers = 0;
    if (maxLayers > 0) for (const id of state.tables.layers.recordIds){
        const layer = state.objects[id];
        if (!layer || layer.erased || layerIds && !layerIds.has(id)) continue;
        if (matchedLayers++ < layerOffset) continue;
        if (result.layers.length >= maxLayers) {
            result.nextLayerOffset = matchedLayers - 1;
            reasons.add('layer-limit');
            break;
        }
        checkIdentity(layer.id, maxBytes);
        checkIdentity(layer.name, maxBytes);
        const visible = layer.payload.visible !== false && layer.payload.frozen !== true;
        const item = {
            id: layer.id,
            name: layer.name,
            visible,
            frozen: layer.payload.frozen === true,
            locked: layer.payload.locked === true,
            editable: visible && layer.payload.locked !== true
        };
        const bytes = jsonBytes(item) + (result.layers.length ? 1 : 0);
        if (usedBytes + bytes > maxBytes) {
            if (!result.entities.length && !result.layers.length) throw new KJValidationError('Drawing context layer identity cannot fit the response budget');
            result.nextLayerOffset = matchedLayers - 1;
            reasons.add('response-budget');
            break;
        }
        usedBytes += bytes;
        result.layers.push(item);
    }
    result.truncationReasons = REASONS.filter((reason)=>reasons.has(reason));
    result.truncated = result.truncationReasons.length > 0;
    if (document.revision !== state.revision) throw new KJRevisionConflictError(state.revision, document.revision);
    deepFreeze(result);
    return result;
}
