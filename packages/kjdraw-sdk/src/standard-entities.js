// Generated from standard-entities.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { clone, normalizeName } from './utils.js';
import { length2, vec2 } from './geometry/vector2.js';
export const KJ_ENTITY_CONTRACT_VERSION = 1;
const STANDARD = new Set([
    'LINE',
    'RAY',
    'XLINE',
    'POINT',
    'CIRCLE',
    'ARC',
    'LWPOLYLINE',
    'POLYLINE',
    'ELLIPSE',
    'SPLINE',
    'TEXT',
    'MTEXT',
    'ATTDEF',
    'ATTRIB',
    'INSERT',
    'IMAGE',
    'HATCH',
    'LEADER',
    'MLEADER',
    'DIMENSION',
    'VIEWPORT',
    'WIPEOUT',
    'REVISION_CLOUD',
    'SOLID',
    'TRACE',
    'TABLE',
    'PROXY_ENTITY',
    'SOLID3D'
]);
export function listStandardEntityTypes() {
    return Object.freeze([
        ...STANDARD
    ]);
}
function finite(value, label) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new KJValidationError(`${label} must be finite`);
    return numeric;
}
function positive(value, label, { allowZero = false } = {}) {
    const numeric = finite(value, label);
    if (allowZero ? numeric < 0 : numeric <= 0) throw new KJValidationError(`${label} must be ${allowZero ? 'non-negative' : 'positive'}`);
    return numeric;
}
function positiveInteger(value, label) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 1) throw new KJValidationError(`${label} must be a positive integer`);
    return numeric;
}
function point3(value, label) {
    const [x, y] = vec2(value, label);
    const candidate = Array.isArray(value) ? value[2] ?? 0 : value && typeof value === 'object' ? value.z ?? 0 : 0;
    const z = finite(candidate, `${label}.z`);
    return [
        x,
        y,
        z
    ];
}
function vector3(value, label) {
    const result = point3(value, label);
    if (length2(result) <= 1e-15 && Math.abs(result[2]) <= 1e-15) throw new KJValidationError(`${label} cannot be zero`);
    return result;
}
function base(payload) {
    return {
        ...clone(payload),
        contractVersion: KJ_ENTITY_CONTRACT_VERSION
    };
}
function nativeTextFields(payload) {
    const integer = (value, name, maximum)=>{
        const result = finite(value ?? 0, name);
        if (!Number.isInteger(result) || result < 0 || result > maximum) throw new KJValidationError(`${name} is outside its native text range`);
        return result;
    };
    return {
        widthFactor: positive(payload.widthFactor ?? 1, 'widthFactor'),
        generationFlags: integer(payload.generationFlags, 'generationFlags', 0xffff),
        horizontalAlignment: integer(payload.horizontalAlignment, 'horizontalAlignment', 5),
        verticalAlignment: integer(payload.verticalAlignment, 'verticalAlignment', 3),
        obliqueAngle: finite(payload.obliqueAngle ?? 0, 'obliqueAngle')
    };
}
function optionalObjectId(value, label) {
    if (value == null) return null;
    if (typeof value !== 'string' || !value.trim()) throw new KJValidationError(`${label} must be a non-empty object id`);
    return value;
}
function normalizeVertex(vertex, index) {
    if (Array.isArray(vertex)) return {
        point: point3(vertex, `vertices[${index}]`),
        bulge: 0,
        startWidth: 0,
        endWidth: 0
    };
    const value = vertex && typeof vertex === 'object' ? vertex : {};
    return {
        ...clone(value),
        point: point3(value.point, `vertices[${index}].point`),
        bulge: finite(value.bulge ?? 0, `vertices[${index}].bulge`),
        startWidth: positive(value.startWidth ?? 0, `vertices[${index}].startWidth`, {
            allowZero: true
        }),
        endWidth: positive(value.endWidth ?? 0, `vertices[${index}].endWidth`, {
            allowZero: true
        })
    };
}
function normalizePolyline(payload) {
    const source = payload.vertices ?? payload.points;
    if (!Array.isArray(source) || source.length < 2) throw new KJValidationError('Polyline requires at least two vertices');
    return {
        ...base(payload),
        vertices: source.map(normalizeVertex),
        closed: Boolean(payload.closed),
        elevation: finite(payload.elevation ?? 0, 'elevation')
    };
}
function normalizeHatch(payload) {
    if (!Array.isArray(payload.boundaryLoops) || !payload.boundaryLoops.length) throw new KJValidationError('Hatch requires at least one boundary loop');
    const loops = payload.boundaryLoops.map((loop, loopIndex)=>{
        const value = {
            ...clone(loop),
            external: loop.external !== false
        };
        if (loop.vertices) value.vertices = loop.vertices.map((vertex, index)=>normalizeVertex(vertex, `${loopIndex}.${index}`));
        if (!value.vertices?.length && !Array.isArray(loop.edges)) throw new KJValidationError(`Hatch loop ${loopIndex} requires vertices or edges`);
        return value;
    });
    return {
        ...base(payload),
        boundaryLoops: loops,
        patternName: String(payload.patternName ?? 'SOLID'),
        patternScale: positive(payload.patternScale ?? 1, 'patternScale'),
        patternAngle: finite(payload.patternAngle ?? 0, 'patternAngle'),
        solid: Boolean(payload.solid ?? normalizeName(payload.patternName) === 'SOLID')
    };
}
export function isStandardEntityType(type) {
    return STANDARD.has(normalizeName(type));
}
export function normalizeStandardEntityPayload(type, input = {}) {
    const normalizedType = normalizeName(type);
    const payload = input;
    if (!STANDARD.has(normalizedType)) return clone(payload);
    switch(normalizedType){
        case 'LINE':
            {
                const value = {
                    ...base(payload),
                    start: point3(payload.start, 'start'),
                    end: point3(payload.end, 'end')
                };
                const degenerate = length2([
                    value.end[0] - value.start[0],
                    value.end[1] - value.start[1]
                ]) <= 1e-15 && Math.abs(value.end[2] - value.start[2]) <= 1e-15;
                return {
                    ...value,
                    degenerate
                };
            }
        case 'RAY':
        case 'XLINE':
            return {
                ...base(payload),
                origin: point3(payload.origin, 'origin'),
                direction: vector3(payload.direction, 'direction')
            };
        case 'POINT':
            return {
                ...base(payload),
                position: point3(payload.position, 'position')
            };
        case 'CIRCLE':
            return {
                ...base(payload),
                center: point3(payload.center, 'center'),
                radius: positive(payload.radius, 'radius'),
                normal: vector3(payload.normal ?? [
                    0,
                    0,
                    1
                ], 'normal')
            };
        case 'ARC':
            return {
                ...base(payload),
                center: point3(payload.center, 'center'),
                radius: positive(payload.radius, 'radius'),
                startAngle: finite(payload.startAngle, 'startAngle'),
                endAngle: finite(payload.endAngle, 'endAngle'),
                clockwise: Boolean(payload.clockwise),
                normal: vector3(payload.normal ?? [
                    0,
                    0,
                    1
                ], 'normal')
            };
        case 'LWPOLYLINE':
        case 'POLYLINE':
            return normalizePolyline(payload);
        case 'ELLIPSE':
            {
                const ratio = positive(payload.ratio, 'ratio');
                if (ratio > 1) throw new KJValidationError('Ellipse ratio cannot exceed 1');
                return {
                    ...base(payload),
                    center: point3(payload.center, 'center'),
                    majorAxis: vector3(payload.majorAxis, 'majorAxis'),
                    ratio,
                    startParameter: finite(payload.startParameter ?? 0, 'startParameter'),
                    endParameter: finite(payload.endParameter ?? Math.PI * 2, 'endParameter')
                };
            }
        case 'SPLINE':
            {
                const degree = Math.trunc(positive(payload.degree, 'degree'));
                const controlPoints = (payload.controlPoints ?? []).map((point, index)=>point3(point, `controlPoints[${index}]`));
                if (controlPoints.length < degree + 1) throw new KJValidationError('Spline requires at least degree + 1 control points');
                const weights = payload.weights?.map((value, index)=>positive(value, `weights[${index}]`));
                if (weights && weights.length !== controlPoints.length) throw new KJValidationError('Spline weights must match control points');
                const knots = payload.knots?.map((value, index)=>finite(value, `knots[${index}]`));
                if (knots && knots.length !== controlPoints.length + degree + 1) throw new KJValidationError('Spline knot vector length must equal control points + degree + 1');
                if (knots?.some((value, index)=>index > 0 && value < knots[index - 1])) throw new KJValidationError('Spline knots must be non-decreasing');
                if (knots && !(knots[controlPoints.length] > knots[degree])) throw new KJValidationError('Spline knot domain is empty');
                return {
                    ...base(payload),
                    degree,
                    controlPoints,
                    fitPoints: payload.fitPoints?.map((point, index)=>point3(point, `fitPoints[${index}]`)),
                    knots,
                    weights,
                    closed: Boolean(payload.closed),
                    periodic: Boolean(payload.periodic)
                };
            }
        case 'TEXT':
            return {
                ...base(payload),
                ...nativeTextFields(payload),
                position: point3(payload.position, 'position'),
                alignmentPoint: payload.alignmentPoint && point3(payload.alignmentPoint, 'alignmentPoint'),
                text: String(payload.text ?? ''),
                height: positive(payload.height ?? 2.5, 'height'),
                rotation: finite(payload.rotation ?? 0, 'rotation'),
                styleId: payload.styleId == null ? null : String(payload.styleId)
            };
        case 'MTEXT':
            return {
                ...base(payload),
                position: point3(payload.position, 'position'),
                alignmentPoint: payload.alignmentPoint && point3(payload.alignmentPoint, 'alignmentPoint'),
                text: String(payload.text ?? ''),
                height: positive(payload.height ?? 2.5, 'height'),
                rotation: finite(payload.rotation ?? 0, 'rotation'),
                styleId: payload.styleId == null ? null : String(payload.styleId)
            };
        case 'ATTDEF':
        case 'ATTRIB':
            return {
                ...base(payload),
                ...nativeTextFields(payload),
                ...normalizedType === 'ATTRIB' ? {
                    parentInsertId: optionalObjectId(payload.parentInsertId, 'parentInsertId')
                } : {},
                position: point3(payload.position, 'position'),
                alignmentPoint: payload.alignmentPoint && point3(payload.alignmentPoint, 'alignmentPoint'),
                text: String(payload.text ?? ''),
                tag: String(payload.tag ?? ''),
                prompt: String(payload.prompt ?? ''),
                flags: Math.trunc(finite(payload.flags ?? 0, 'flags')),
                height: positive(payload.height ?? 2.5, 'height'),
                rotation: finite(payload.rotation ?? 0, 'rotation'),
                styleId: payload.styleId == null ? null : String(payload.styleId),
                lockPosition: Boolean(payload.lockPosition)
            };
        case 'INSERT':
            {
                if (!payload.blockRecordId) throw new KJValidationError('Block insert requires blockRecordId');
                const scale = Array.isArray(payload.scale) ? payload.scale.map((value, index)=>finite(value, `scale[${index}]`)) : [
                    finite(payload.scale ?? 1, 'scale'),
                    finite(payload.scale ?? 1, 'scale'),
                    finite(payload.scale ?? 1, 'scale')
                ];
                if (scale.length !== 3 || scale.some((value)=>Math.abs(value) <= 1e-15)) throw new KJValidationError('Block insert scale must contain three non-zero values');
                const attributeIds = payload.attributeIds ?? [];
                if (!Array.isArray(attributeIds) || attributeIds.some((id)=>typeof id !== 'string' || !id.trim()) || new Set(attributeIds).size !== attributeIds.length) throw new KJValidationError('INSERT attributeIds must contain unique non-empty object ids');
                return {
                    ...base(payload),
                    blockRecordId: String(payload.blockRecordId),
                    position: point3(payload.position ?? [
                        0,
                        0,
                        0
                    ], 'position'),
                    scale,
                    rotation: finite(payload.rotation ?? 0, 'rotation'),
                    attributes: clone(payload.attributes ?? {}),
                    attributeIds: [
                        ...attributeIds
                    ],
                    sequenceEndId: optionalObjectId(payload.sequenceEndId, 'sequenceEndId')
                };
            }
        case 'IMAGE':
            return {
                ...base(payload),
                imageResourceId: String(payload.imageResourceId ?? ''),
                position: point3(payload.position, 'position'),
                uVector: vector3(payload.uVector, 'uVector'),
                vVector: vector3(payload.vVector, 'vVector'),
                clipBoundary: payload.clipBoundary?.map((point, index)=>point3(point, `clipBoundary[${index}]`))
            };
        case 'HATCH':
            return normalizeHatch(payload);
        case 'LEADER':
        case 'MLEADER':
            return {
                ...base(payload),
                vertices: (payload.vertices ?? []).map((point, index)=>point3(point, `vertices[${index}]`)),
                textPosition: payload.textPosition && point3(payload.textPosition, 'textPosition'),
                annotationId: payload.annotationId == null ? null : String(payload.annotationId)
            };
        case 'DIMENSION':
            return {
                ...base(payload),
                dimensionType: normalizeName(payload.dimensionType ?? 'ALIGNED'),
                definitionPoints: (payload.definitionPoints ?? []).map((point, index)=>point3(point, `definitionPoints[${index}]`)),
                textPosition: payload.textPosition && point3(payload.textPosition, 'textPosition'),
                textOverride: payload.textOverride == null ? null : String(payload.textOverride),
                styleId: payload.styleId == null ? null : String(payload.styleId),
                styleName: String(payload.styleName ?? 'STANDARD'),
                blockName: payload.blockName == null ? null : String(payload.blockName),
                measurement: payload.measurement == null ? null : finite(payload.measurement, 'measurement'),
                dxfDimensionType: payload.dxfDimensionType == null ? null : Math.trunc(finite(payload.dxfDimensionType, 'dxfDimensionType')),
                rotation: finite(payload.rotation ?? 0, 'rotation')
            };
        case 'VIEWPORT':
            {
                const integer = (value, label, min, max)=>{
                    const result = finite(value, label);
                    if (!Number.isInteger(result) || result < min || result > max) throw new KJValidationError(`${label} must be an integer from ${min} to ${max}`);
                    return result;
                };
                let flags = integer(payload.flags ?? 0, 'flags', 0, 2147483647);
                for (const [name, mask] of [
                    [
                        'perspective',
                        1
                    ],
                    [
                        'nonRectangularClip',
                        65536
                    ]
                ]){
                    if (payload[name] !== undefined) {
                        if (typeof payload[name] !== 'boolean') throw new KJValidationError(`${name} must be boolean`);
                        flags = payload[name] ? flags | mask : flags & ~mask;
                    }
                }
                const frozenLayerIds = payload.frozenLayerIds ?? [];
                if (!Array.isArray(frozenLayerIds) || frozenLayerIds.length > 4096 || frozenLayerIds.some((id)=>typeof id !== 'string' || !id.trim() || id.length > 512) || new Set(frozenLayerIds).size !== frozenLayerIds.length) throw new KJValidationError('frozenLayerIds must be unique bounded layer IDs');
                const clippingBoundaryId = payload.clippingBoundaryId ?? payload.clipBoundaryId ?? null;
                if (clippingBoundaryId !== null && (typeof clippingBoundaryId !== 'string' || !clippingBoundaryId.trim() || clippingBoundaryId.length > 512)) throw new KJValidationError('clippingBoundaryId must be a bounded entity ID');
                if (payload.clippingBoundaryId && payload.clipBoundaryId && payload.clippingBoundaryId !== payload.clipBoundaryId) throw new KJValidationError('Conflicting clipping boundary IDs');
                const normalizedBase = base(payload);
                delete normalizedBase.perspective;
                delete normalizedBase.nonRectangularClip;
                delete normalizedBase.clipBoundaryId;
                return {
                    ...normalizedBase,
                    center: point3(payload.center, 'center'),
                    width: positive(payload.width, 'width'),
                    height: positive(payload.height, 'height'),
                    viewCenter: point3(payload.viewCenter ?? [
                        0,
                        0,
                        0
                    ], 'viewCenter'),
                    viewHeight: positive(payload.viewHeight, 'viewHeight'),
                    twistAngle: finite(payload.twistAngle ?? 0, 'twistAngle'),
                    viewTarget: point3(payload.viewTarget ?? [
                        0,
                        0,
                        0
                    ], 'viewTarget'),
                    viewDirection: vector3(payload.viewDirection ?? [
                        0,
                        0,
                        1
                    ], 'viewDirection'),
                    status: integer(payload.status ?? 1, 'status', -1, 32767),
                    ...payload.viewportId !== undefined ? {
                        viewportId: integer(payload.viewportId, 'viewportId', -1, 32767)
                    } : {},
                    flags,
                    lensLength: positive(payload.lensLength ?? 50, 'lensLength'),
                    frontClipDistance: finite(payload.frontClipDistance ?? 0, 'frontClipDistance'),
                    backClipDistance: finite(payload.backClipDistance ?? 0, 'backClipDistance'),
                    frozenLayerIds: [
                        ...frozenLayerIds
                    ],
                    clippingBoundaryId
                };
            }
        case 'WIPEOUT':
        case 'REVISION_CLOUD':
            return normalizePolyline({
                ...payload,
                closed: true
            });
        case 'SOLID':
        case 'TRACE':
            {
                const vertices = (payload.vertices ?? payload.points ?? []).map((point, index)=>point3(point, `vertices[${index}]`));
                if (vertices.length < 3 || vertices.length > 4) throw new KJValidationError(`${normalizedType} requires three or four vertices`);
                return {
                    ...base(payload),
                    vertices
                };
            }
        case 'SOLID3D':
            {
                if (payload.kernelAuthority !== 'kjcore-rust-wasm' || Number(payload.solidModelVersion) !== 1) throw new KJValidationError('SOLID3D requires the KJCore Rust WASM authority');
                const vertices = (payload.vertices ?? []).map((point, index)=>point3(point, `vertices[${index}]`));
                if (vertices.length < 4) throw new KJValidationError('SOLID3D requires at least four vertices');
                const triangles = (payload.triangles ?? []).map((triangle, index)=>{
                    if (!Array.isArray(triangle) || triangle.length !== 3 || !triangle.every((value)=>Number.isInteger(value) && Number(value) >= 0 && Number(value) < vertices.length)) throw new KJValidationError(`triangles[${index}] must contain three valid vertex indices`);
                    if (new Set(triangle).size !== 3) throw new KJValidationError(`triangles[${index}] is degenerate`);
                    return triangle.map(Number);
                });
                if (triangles.length < 4) throw new KJValidationError('SOLID3D requires at least four triangles');
                const validation = clone(payload.validation ?? {});
                if (validation.valid !== true || validation.finite !== true || validation.orientation !== 'outward' || Number(validation.volume) <= 0 || Number(validation.boundaryEdges) !== 0 || Number(validation.nonManifoldEdges) !== 0 || Number(validation.inconsistentEdges) !== 0 || Number(validation.degenerateTriangles) !== 0) throw new KJValidationError('SOLID3D must carry a successful KJCore topology validation');
                return {
                    ...base(payload),
                    kernelAuthority: 'kjcore-rust-wasm',
                    solidModelVersion: 1,
                    construction: String(payload.construction ?? 'solid'),
                    vertices,
                    triangles,
                    validation
                };
            }
        case 'TABLE':
            {
                const rows = positiveInteger(payload.rows, 'rows'), columns = positiveInteger(payload.columns, 'columns');
                const cells = Array.from({
                    length: rows
                }, (_, row)=>Array.from({
                        length: columns
                    }, (_, column)=>clone(payload.cells?.[row]?.[column] ?? {
                            text: ''
                        })));
                const rowHeights = Array.from({
                    length: rows
                }, (_, index)=>positive(payload.rowHeights?.[index] ?? payload.rowHeight ?? 8, `rowHeights[${index}]`));
                const columnWidths = Array.from({
                    length: columns
                }, (_, index)=>positive(payload.columnWidths?.[index] ?? payload.columnWidth ?? 25, `columnWidths[${index}]`));
                return {
                    ...base(payload),
                    position: point3(payload.position ?? [
                        0,
                        0,
                        0
                    ], 'position'),
                    rows,
                    columns,
                    cells,
                    rowHeights,
                    columnWidths,
                    styleId: payload.styleId == null ? null : String(payload.styleId)
                };
            }
        case 'PROXY_ENTITY':
            return {
                ...base(payload),
                originalType: normalizeName(payload.originalType ?? 'UNKNOWN'),
                proxyClass: payload.proxyClass == null ? null : String(payload.proxyClass),
                rawTags: clone(payload.rawTags ?? []),
                rawData: clone(payload.rawData ?? null),
                importError: payload.importError == null ? null : String(payload.importError)
            };
        default:
            return base(payload);
    }
}
export function normalizeLegacyEntityPayload(type, input = {}) {
    const normalizedType = normalizeName(type);
    const payload = input;
    if (normalizedType === 'LINE' && payload.start == null && payload.x1 != null) return normalizeStandardEntityPayload(normalizedType, {
        ...payload,
        start: [
            payload.x1,
            payload.y1,
            payload.z1 ?? 0
        ],
        end: [
            payload.x2,
            payload.y2,
            payload.z2 ?? 0
        ]
    });
    if ([
        'CIRCLE',
        'ARC'
    ].includes(normalizedType) && payload.center == null && payload.x != null) return normalizeStandardEntityPayload(normalizedType, {
        ...payload,
        center: [
            payload.x,
            payload.y,
            payload.z ?? 0
        ],
        startAngle: payload.startAngle ?? 0,
        endAngle: payload.endAngle ?? Math.PI * 2
    });
    if ([
        'LWPOLYLINE',
        'POLYLINE'
    ].includes(normalizedType) && payload.vertices == null && payload.points) return normalizeStandardEntityPayload(normalizedType, {
        ...payload,
        vertices: payload.points
    });
    if ([
        'TEXT',
        'MTEXT',
        'ATTDEF',
        'ATTRIB'
    ].includes(normalizedType) && payload.position == null && payload.x != null) return normalizeStandardEntityPayload(normalizedType, {
        ...payload,
        position: [
            payload.x,
            payload.y,
            payload.z ?? 0
        ]
    });
    return normalizeStandardEntityPayload(normalizedType, payload);
}
