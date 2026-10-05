// Generated from agent-native-geometry-query.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJDocument } from './document.js';
import { KJDrawError, KJRevisionConflictError, KJValidationError } from './errors.js';
import { deepFreeze } from './utils.js';
const commonKeys = [
    'documentId',
    'expectedRevision',
    'ownerId',
    'units',
    'ownerPolicy',
    'visibility',
    'typeScope',
    'unsupportedPolicy',
    'offset',
    'limit',
    'maxEntities',
    'maxBytes'
];
const MAX_COORDINATE = 1e12;
const MAX_ENTITIES = 4096;
const MAX_BYTES = 262144;
const encoder = new TextEncoder();
function invalid(message) {
    throw new KJValidationError(message);
}
function own(value, key, required = true) {
    if (!value || typeof value !== 'object') invalid('Native query data must be an object');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
        if (required || key in value) invalid(`Native query requires own data field ${key}`);
        return undefined;
    }
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(`Native query field ${key} must be enumerable data`);
    return descriptor.value;
}
function identifier(value, label) {
    if (typeof value !== 'string' || !value.length || value.length > 256 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) invalid(`${label} must be a bounded nonempty data string`);
    return value;
}
function integer(value, minimum, maximum, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(`${label} must be an integer from ${minimum} to ${maximum}`);
    return value;
}
function finite(value, label, positive = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE || positive && value <= 0) invalid(`${label} must be a ${positive ? 'positive ' : ''}finite numeric value within ${MAX_COORDINATE}`);
    return value;
}
function numericPoint(value, label) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 3 || Reflect.ownKeys(value).length !== 4) invalid(`${label} must be a plain native XYZ tuple`);
    return [
        0,
        1,
        2
    ].map((axis)=>finite(own(value, String(axis)), label));
}
function xy(value, label) {
    const p = numericPoint(value, label);
    return [
        p[0],
        p[1]
    ];
}
function orientation(payload) {
    for (const key of [
        'normal',
        'extrusionDirection'
    ]){
        const value = own(payload, key, false);
        if (value !== undefined) {
            const p = numericPoint(value, key);
            if (p[0] !== 0 || p[1] !== 0 || p[2] !== 1) throw new KJDrawError('Only default native XY orientation is supported', {
                code: 'KJNATIVE_GEOMETRY_UNSUPPORTED_ORIENTATION'
            });
        }
    }
    const thickness = own(payload, 'thickness', false);
    if (thickness !== undefined && finite(thickness, 'thickness') !== 0) throw new KJDrawError('Extruded thickness is not a finite native XY centerline curve', {
        code: 'KJNATIVE_GEOMETRY_UNSUPPORTED_THICKNESS'
    });
}
function validateOptions(value, neighborhood) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![
        Object.prototype,
        null
    ].includes(Object.getPrototypeOf(value))) invalid('Native query options must be plain data');
    const keys = [
        ...commonKeys,
        ...neighborhood ? [
            'anchorId',
            'radius',
            'metric',
            'boundary'
        ] : []
    ];
    if (Reflect.ownKeys(value).some((key)=>typeof key !== 'string' || !keys.includes(key))) invalid('Unknown native query option');
    keys.forEach((key)=>own(value, key));
    identifier(own(value, 'documentId'), 'documentId');
    identifier(own(value, 'ownerId'), 'ownerId');
    identifier(own(value, 'units'), 'units');
    integer(own(value, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'expectedRevision');
    integer(own(value, 'offset'), 0, MAX_ENTITIES, 'offset');
    integer(own(value, 'limit'), 1, 200, 'limit');
    integer(own(value, 'maxEntities'), 1, MAX_ENTITIES, 'maxEntities');
    integer(own(value, 'maxBytes'), 1024, MAX_BYTES, 'maxBytes');
    if (own(value, 'ownerPolicy') !== 'model-space-only') invalid('Explicit ownerPolicy must be model-space-only; paper/block units are unsupported');
    if (![
        'include-hidden',
        'visible-only'
    ].includes(own(value, 'visibility'))) invalid('Explicit visibility policy is required');
    if (![
        'all-owner-entities',
        'finite-line-circle-only'
    ].includes(own(value, 'typeScope'))) invalid('Explicit native type scope is required');
    if (![
        'reject',
        'diagnostics'
    ].includes(own(value, 'unsupportedPolicy'))) invalid('Explicit unsupported geometry policy is required');
    if (neighborhood) {
        identifier(own(value, 'anchorId'), 'anchorId');
        finite(own(value, 'radius'), 'radius', true);
        if (own(value, 'metric') !== 'text-insertion-to-finite-native-xy-curve' || own(value, 'boundary') !== 'inclusive') invalid('Explicit finite native XY metric and inclusive boundary are required');
    }
}
function capture(document, options) {
    if (!(document instanceof KJDocument)) invalid('Native query requires an actual KJDocument');
    const state = KJDocument.prototype.snapshot.call(document);
    if (state.documentId !== options.documentId) throw new KJDrawError('Native query document identity mismatch', {
        code: 'KJNATIVE_GEOMETRY_DOCUMENT_MISMATCH'
    });
    if (state.revision !== options.expectedRevision) throw new KJRevisionConflictError(options.expectedRevision, state.revision);
    if (state.header.units !== options.units) throw new KJDrawError('Native query units must match native model document units exactly', {
        code: 'KJNATIVE_GEOMETRY_UNITS_MISMATCH'
    });
    const owner = Object.hasOwn(state.objects, options.ownerId) ? state.objects[options.ownerId] : undefined;
    if (!owner || owner.erased || owner.kind !== 'block-record' || owner.type !== 'BLOCK_RECORD' || options.ownerId !== state.spaces.modelSpaceId || !state.tables.blockRecords.recordIds.includes(options.ownerId)) throw new KJDrawError('Only the explicitly selected native model owner is supported; no paper projection or block expansion', {
        code: 'KJNATIVE_GEOMETRY_OWNER_UNSUPPORTED'
    });
    return state;
}
function visible(state, entity) {
    const layerId = identifier(own(entity.payload, 'layerId'), 'native layerId');
    const layer = Object.hasOwn(state.objects, layerId) ? state.objects[layerId] : undefined;
    if (!layer || layer.erased || layer.kind !== 'table-record' || layer.type !== 'LAYER' || !state.tables.layers.recordIds.includes(layerId)) invalid('Native geometry requires its exact live registered layer');
    const entityVisible = own(entity.payload, 'visible', false), layerVisible = own(layer.payload, 'visible', false), frozen = own(layer.payload, 'frozen', false);
    for (const flag of [
        entityVisible,
        layerVisible,
        frozen
    ])if (flag !== undefined && typeof flag !== 'boolean') invalid('Native visibility flags must be booleans, never coerced values');
    return entityVisible !== false && layerVisible !== false && frozen !== true;
}
function curve(entity, isVisible) {
    orientation(entity.payload);
    const row = {
        id: identifier(entity.id, 'native id'),
        handle: identifier(entity.handle, 'native handle'),
        ownerId: identifier(entity.ownerId, 'native owner'),
        layerId: identifier(own(entity.payload, 'layerId'), 'native layerId'),
        type: entity.type,
        visible: isVisible
    };
    if (entity.type === 'LINE') {
        const start = xy(own(entity.payload, 'start'), 'LINE start'), end = xy(own(entity.payload, 'end'), 'LINE end');
        return {
            row: {
                ...row,
                bounds: {
                    min: [
                        Math.min(start[0], end[0]),
                        Math.min(start[1], end[1])
                    ],
                    max: [
                        Math.max(start[0], end[0]),
                        Math.max(start[1], end[1])
                    ]
                }
            },
            start,
            end
        };
    }
    const center = xy(own(entity.payload, 'center'), 'CIRCLE center'), radius = finite(own(entity.payload, 'radius'), 'CIRCLE radius', true);
    return {
        row: {
            ...row,
            bounds: {
                min: [
                    center[0] - radius,
                    center[1] - radius
                ],
                max: [
                    center[0] + radius,
                    center[1] + radius
                ]
            }
        },
        center,
        radius
    };
}
function diagnostic(entity, reason) {
    return {
        id: identifier(entity.id, 'native id'),
        handle: identifier(entity.handle, 'native handle'),
        type: identifier(entity.type, 'native type'),
        reason
    };
}
function inspect(state, options, anchorId) {
    const inspection = {
        state,
        curves: [],
        diagnostics: [],
        excludedCounts: {
            hidden: 0,
            otherTypes: 0,
            anchor: 0
        },
        count: 0
    };
    for(const id in state.objects){
        if (!Object.hasOwn(state.objects, id)) continue;
        const entity = state.objects[id];
        if (entity.kind !== 'entity' || entity.erased || entity.ownerId !== options.ownerId) continue;
        if (++inspection.count > options.maxEntities) throw new KJDrawError('Entire live owner entity count exceeds maxEntities; no partial query was produced', {
            code: 'KJNATIVE_GEOMETRY_ENTITY_LIMIT'
        });
    }
    for(const id in state.objects){
        if (!Object.hasOwn(state.objects, id)) continue;
        const entity = state.objects[id];
        if (entity.kind !== 'entity' || entity.erased || entity.ownerId !== options.ownerId) continue;
        try {
            const isVisible = visible(state, entity);
            if (options.visibility === 'visible-only' && !isVisible) {
                inspection.excludedCounts.hidden++;
                continue;
            }
            if (entity.id === anchorId) {
                inspection.excludedCounts.anchor++;
                continue;
            }
            if (![
                'LINE',
                'CIRCLE'
            ].includes(entity.type)) {
                if (options.typeScope === 'finite-line-circle-only') {
                    inspection.excludedCounts.otherTypes++;
                    continue;
                }
                inspection.diagnostics.push(diagnostic(entity, 'unsupported-native-entity-type'));
                continue;
            }
            inspection.curves.push(curve(entity, isVisible));
        } catch (error) {
            inspection.diagnostics.push(diagnostic(entity, error instanceof KJDrawError ? error.code : 'invalid-native-geometry'));
        }
    }
    if (inspection.diagnostics.length && options.unsupportedPolicy === 'reject') {
        const details = {
            diagnostics: inspection.diagnostics
        };
        if (encoder.encode(JSON.stringify(details)).length > options.maxBytes) throw new KJDrawError('Native geometry diagnostics exceed maxBytes', {
            code: 'KJNATIVE_GEOMETRY_BYTE_LIMIT'
        });
        throw new KJDrawError('Declared native scope contains unsupported or invalid geometry; no partial answer was produced', {
            code: 'KJNATIVE_GEOMETRY_SCOPE_UNSUPPORTED',
            details
        });
    }
    return inspection;
}
function finish(document, options, state, result) {
    if (KJDocument.prototype.snapshot.call(document) !== state) throw new KJRevisionConflictError(options.expectedRevision, KJDocument.prototype.snapshot.call(document).revision);
    if (encoder.encode(JSON.stringify(result)).length > options.maxBytes) throw new KJDrawError('Complete native query response exceeds maxBytes; nothing was truncated', {
        code: 'KJNATIVE_GEOMETRY_BYTE_LIMIT'
    });
    return deepFreeze(result);
}
function page(inspection, options, kind, rows) {
    const scopeComplete = inspection.diagnostics.length === 0;
    if (!scopeComplete && options.offset !== 0) invalid('An unsupported scope has no continuation page');
    if (scopeComplete && options.offset > rows.length) invalid('Native query offset cannot skip beyond the complete result list');
    const selected = scopeComplete ? rows.slice(options.offset, options.offset + options.limit) : [];
    const nextOffset = scopeComplete && options.offset + selected.length < rows.length ? options.offset + selected.length : null;
    return {
        kind,
        documentId: inspection.state.documentId,
        revision: inspection.state.revision,
        ownerId: options.ownerId,
        units: options.units,
        ownerPolicy: options.ownerPolicy,
        visibility: options.visibility,
        typeScope: options.typeScope,
        method: 'native-analytic-owner-xy-centerline-curves-v1',
        numericalPolicy: 'binary64-no-selection-tolerance',
        inspectedOwnerEntityCount: inspection.count,
        eligibleCurveCount: inspection.curves.length,
        excludedCounts: inspection.excludedCounts,
        scopeComplete,
        complete: scopeComplete && options.offset === 0 && nextOffset === null,
        offset: options.offset,
        nextOffset,
        totalResultCount: scopeComplete ? rows.length : null,
        rows: selected,
        diagnostics: inspection.diagnostics
    };
}
export function queryNativeCurveBounds(document, options) {
    validateOptions(options, false);
    const state = capture(document, options), inspection = inspect(state, options), rows = inspection.curves.map((item)=>item.row);
    let bounds = null;
    if (!inspection.diagnostics.length && rows.length) bounds = {
        min: [
            Math.min(...rows.map((row)=>row.bounds.min[0])),
            Math.min(...rows.map((row)=>row.bounds.min[1]))
        ],
        max: [
            Math.max(...rows.map((row)=>row.bounds.max[0])),
            Math.max(...rows.map((row)=>row.bounds.max[1]))
        ]
    };
    return finish(document, options, state, {
        ...page(inspection, options, 'native-curve-bounds', rows),
        bounds
    });
}
function distance(anchor, value) {
    if (value.row.type === 'LINE') {
        const start = value.start, end = value.end, dx = end[0] - start[0], dy = end[1] - start[1];
        const scale = Math.max(Math.abs(dx), Math.abs(dy)), ax = anchor[0] - start[0], ay = anchor[1] - start[1];
        let fraction = 0;
        if (scale !== 0) {
            const sx = dx / scale, sy = dy / scale, norm = Math.hypot(sx, sy);
            fraction = (ax / scale * sx + ay / scale * sy) / (sx * sx + sy * sy);
            if (!Number.isFinite(fraction)) fraction = (ax * (sx / norm) + ay * (sy / norm)) / scale / norm;
            if (Number.isNaN(fraction)) throw new KJDrawError('Finite native segment projection is numerically unsupported', {
                code: 'KJNATIVE_GEOMETRY_NUMERICAL_UNSUPPORTED'
            });
        }
        const parameter = Math.max(0, Math.min(1, fraction));
        const closestPoint = [
            start[0] + dx * parameter,
            start[1] + dy * parameter
        ];
        return {
            distance: Math.hypot(anchor[0] - closestPoint[0], anchor[1] - closestPoint[1]),
            closestPoint,
            closestPointUnique: true
        };
    }
    const center = value.center, radius = value.radius, dx = anchor[0] - center[0], dy = anchor[1] - center[1];
    const scale = Math.max(Math.abs(dx), Math.abs(dy)), radial = Math.hypot(dx, dy);
    const norm = scale === 0 ? 1 : Math.hypot(dx / scale, dy / scale);
    return {
        distance: Math.abs(radial - radius),
        closestPoint: scale === 0 ? null : [
            center[0] + dx / scale / norm * radius,
            center[1] + dy / scale / norm * radius
        ],
        closestPointUnique: scale !== 0
    };
}
export function queryNativeCurveNeighborhood(document, options) {
    validateOptions(options, true);
    const state = capture(document, options), anchor = Object.hasOwn(state.objects, options.anchorId) ? state.objects[options.anchorId] : undefined;
    if (!anchor || anchor.erased || anchor.kind !== 'entity' || anchor.type !== 'TEXT' || anchor.ownerId !== options.ownerId) throw new KJDrawError('Anchor must be the exact live same-owner native TEXT insertion point', {
        code: 'KJNATIVE_GEOMETRY_ANCHOR_UNSUPPORTED'
    });
    orientation(anchor.payload);
    const anchorVisible = visible(state, anchor);
    if (options.visibility === 'visible-only' && !anchorVisible) throw new KJDrawError('Hidden anchor is excluded by the explicit visibility policy', {
        code: 'KJNATIVE_GEOMETRY_ANCHOR_HIDDEN'
    });
    const position = xy(own(anchor.payload, 'position'), 'TEXT native insertion point'), inspection = inspect(state, options, anchor.id);
    const rows = inspection.diagnostics.length ? [] : inspection.curves.map((item)=>({
            ...item.row,
            ...distance(position, item)
        })).filter((row)=>row.distance <= options.radius);
    return finish(document, options, state, {
        ...page(inspection, options, 'native-curve-neighborhood', rows),
        anchor: {
            id: identifier(anchor.id, 'native anchor id'),
            handle: identifier(anchor.handle, 'native anchor handle'),
            ownerId: options.ownerId,
            type: 'TEXT',
            position,
            visible: anchorVisible
        },
        radius: options.radius,
        metric: options.metric,
        boundary: options.boundary
    });
}
