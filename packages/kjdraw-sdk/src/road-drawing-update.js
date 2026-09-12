// Generated from road-drawing-update.ts by scripts/build-typescript.mjs. Do not edit directly.
import { createObjectRecord } from './schema.js';
import { normalizeStandardEntityPayload } from './standard-entities.js';
import { createCommandEditScope } from './edit-policy.js';
import { KJValidationError } from './errors.js';
import { canonicalStringify, deepFreeze } from './utils.js';
function fail(message) {
    throw new KJValidationError(`Road drawing update: ${message}`);
}
const equal = (a, b)=>canonicalStringify(a) === canonicalStringify(b);
function dataOnly(value) {
    let nodes = 0, characters = 0;
    const path = new Set();
    const visit = (item, depth)=>{
        if (++nodes > 4_000_000 || depth > 32) fail('input data budget exceeded');
        if (item === null || typeof item === 'boolean') return;
        if (typeof item === 'number') {
            if (!Number.isFinite(item)) fail('nonfinite input');
            return;
        }
        if (typeof item === 'string') {
            characters += item.length;
            if (characters > 32_000_000) fail('input string budget exceeded');
            return;
        }
        if (!item || typeof item !== 'object' || path.has(item)) fail('inputs must be finite acyclic plain data');
        if (Array.isArray(item)) {
            if (Object.getPrototypeOf(item) !== Array.prototype || Reflect.ownKeys(item).length !== item.length + 1) fail('arrays must contain dense data only');
        } else if (![
            Object.prototype,
            null
        ].includes(Object.getPrototypeOf(item))) fail('inputs must be plain data');
        path.add(item);
        for (const key of Reflect.ownKeys(item)){
            if (Array.isArray(item) && key === 'length') continue;
            if (Array.isArray(item) && (typeof key !== 'string' || String(Number(key)) !== key || !Number.isSafeInteger(Number(key)) || Number(key) < 0 || Number(key) >= item.length)) fail('arrays must contain indexed data only');
            const descriptor = Object.getOwnPropertyDescriptor(item, key);
            if (typeof key !== 'string' || [
                '__proto__',
                'constructor',
                'prototype'
            ].includes(key) || !('value' in descriptor) || !descriptor.enumerable) fail('accessors and non-data properties are not allowed');
            visit(descriptor.value, depth + 1);
        }
        path.delete(item);
    };
    visit(value, 0);
}
function fields(value, names) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !equal(Object.keys(value).sort(), [
        ...names
    ].sort())) fail('compiled result fields do not match the road drawing format');
}
function prepare(result, modelSpaceId) {
    fields(result, [
        'units',
        'calculation',
        'entities',
        'resources',
        'frames',
        'bounds',
        'projections',
        'limitations'
    ]);
    if (result.units !== 'meter') fail('compiled drawing units must be meter');
    fields(result.resources, [
        'linetypes',
        'layers'
    ]);
    const { linetypes, layers } = result.resources;
    if (!Array.isArray(linetypes) || linetypes.length !== 2 || !Array.isArray(layers) || layers.length !== 6) fail('expected the road compiler semantic resources');
    const match = linetypes.map((type)=>typeof type.id === 'string' ? type.id.match(/^road:([A-Za-z0-9_-]{1,64}):linetype:continuous$/) : null).find(Boolean);
    if (!match) fail('missing road drawing identity');
    const drawingId = match[1], prefix = `road:${drawingId}`, resources = new Map();
    for (const role of [
        'continuous',
        'ground'
    ]){
        const type = linetypes.find((value)=>value.id === `${prefix}:linetype:${role}`);
        if (!type) fail('linetype identity mismatch');
        fields(type, [
            'id',
            'name',
            'pattern'
        ]);
        if (type.name !== `${drawingId}_ROAD_${role.toUpperCase()}` || !equal(type.pattern, role === 'continuous' ? [] : [
            3,
            -1
        ])) fail('linetype does not match the compiler semantic resource');
        resources.set(type.id, createObjectRecord({
            id: type.id,
            kind: 'table-record',
            type: 'LINETYPE',
            name: type.name,
            payload: {
                description: '',
                pattern: type.pattern,
                totalPatternLength: type.pattern.reduce((sum, segment)=>sum + Math.abs(segment), 0),
                dxfFlags: 0
            }
        }));
    }
    const roles = [
        'DESIGN',
        'GROUND',
        'AXIS',
        'ANNOTATION',
        'FRAME',
        'TABLE'
    ];
    for (const [index, role] of roles.entries()){
        const layer = layers.find((value)=>value.id === `${prefix}:layer:${role}`);
        if (!layer) fail('layer identity mismatch');
        fields(layer, [
            'id',
            'name',
            'color',
            'linetypeId',
            'lineweight'
        ]);
        if (layer.name !== `${drawingId}_ROAD_${role}` || layer.color !== [
            3,
            8,
            4,
            7,
            7,
            7
        ][index] || layer.lineweight !== (role === 'DESIGN' ? 35 : role === 'FRAME' ? 25 : 18) || layer.linetypeId !== `${prefix}:linetype:${role === 'GROUND' ? 'ground' : 'continuous'}`) fail('layer does not match the compiler semantic resource');
        resources.set(layer.id, createObjectRecord({
            id: layer.id,
            kind: 'table-record',
            type: 'LAYER',
            name: layer.name,
            payload: {
                color: layer.color,
                linetypeId: layer.linetypeId,
                linetypeName: resources.get(layer.linetypeId).name,
                lineweight: layer.lineweight,
                visible: true,
                frozen: false,
                locked: false,
                plottable: true
            }
        }));
    }
    if (!Array.isArray(result.entities) || result.entities.length < 1 || result.entities.length > 100000) fail('entity budget must be within 1..100000');
    const entities = new Map();
    for (const spec of result.entities){
        fields(spec, [
            'key',
            'type',
            'payload',
            'options'
        ]);
        fields(spec.options, [
            'id'
        ]);
        if (typeof spec.key !== 'string' || spec.key.length > 180 || !/^(plan|profile|sections)\/[A-Za-z0-9_./-]+$/.test(spec.key) || spec.options.id !== `${prefix}:${spec.key}` || entities.has(spec.options.id)) fail('entity key or stable ID mismatch');
        const payloadFields = spec.type === 'LINE' ? [
            'start',
            'end',
            'layerId'
        ] : spec.type === 'LWPOLYLINE' ? [
            'vertices',
            'closed',
            'layerId'
        ] : spec.type === 'TEXT' ? [
            'text',
            'position',
            'height',
            'rotation',
            'layerId'
        ] : null;
        if (!payloadFields) fail('only road compiler native entity types are supported');
        fields(spec.payload, payloadFields);
        if (resources.get(String(spec.payload.layerId))?.type !== 'LAYER') fail('entity layer must belong to this road drawing');
        const payload = normalizeStandardEntityPayload(spec.type, spec.payload);
        entities.set(spec.options.id, createObjectRecord({
            id: spec.options.id,
            kind: 'entity',
            type: spec.type,
            ownerId: modelSpaceId,
            payload
        }));
    }
    for (const key of [
        'plan/frame',
        'plan/alignment',
        'profile/frame',
        'profile/design',
        'sections/frame'
    ])if (!entities.has(`${prefix}:${key}`)) fail('compiled drawing is missing required frames or geometry');
    return {
        drawingId,
        entities,
        resources
    };
}
function sameRecord(actual, expected) {
    if (!actual || typeof actual !== 'object') return false;
    const record = actual;
    return equal({
        ...record,
        handle: ''
    }, expected);
}
export async function applyRoadDrawingRevision(document, previous, next, options) {
    dataOnly({
        previous,
        next,
        options
    });
    fields(options, [
        'expectedRevision'
    ]);
    if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) fail('expectedRevision must be a nonnegative safe integer');
    const expectedRevision = options.expectedRevision, modelSpaceId = document.spaces.modelSpaceId;
    const before = prepare(structuredClone(previous), modelSpaceId), after = prepare(structuredClone(next), modelSpaceId);
    if (before.drawingId !== after.drawingId) fail('previous and next drawingId must match');
    const updatedIds = [], createdIds = [], removedIds = [], unchangedIds = [];
    await document.transact('Update road drawing', (native)=>{
        const scope = createCommandEditScope(native, 'ROAD_DRAWING_UPDATE'), tx = scope.transaction, state = native._draft();
        if (state.header.units !== 'meter' || state.spaces.modelSpaceId !== modelSpaceId) fail('document units or model-space owner changed');
        for (const [id, expected] of before.resources){
            const table = expected.type === 'LAYER' ? state.tables.layers : state.tables.linetypes;
            if (!table.recordIds.includes(id) || !sameRecord(tx.getObject(id), expected) || !equal(expected, after.resources.get(id))) fail(`resource was changed, removed or moved: ${id}`);
        }
        const modelIds = new Set(state.objects[modelSpaceId]?.payload.entityIds ?? []);
        for (const [id, expected] of before.entities){
            if (!modelIds.has(id) || !sameRecord(tx.getObject(id), expected)) fail(`generated object was changed, removed or moved: ${id}`);
            const target = after.entities.get(id);
            if (!target) removedIds.push(id);
            else if (target.type !== expected.type) fail(`native entity type cannot change for a stable key: ${id}`);
            else if (equal(target.payload, expected.payload)) unchangedIds.push(id);
            else updatedIds.push(id);
        }
        for (const id of after.entities.keys())if (!before.entities.has(id)) {
            if (Object.hasOwn(state.objects, id)) fail(`new stable ID collides with an existing object: ${id}`);
            createdIds.push(id);
        }
        const removed = new Set(removedIds);
        const refersToRemoved = (value)=>typeof value === 'string' ? removed.has(value) : !!value && typeof value === 'object' && Object.values(value).some(refersToRemoved);
        if (removed.size) for (const object of Object.values(state.objects)){
            if (before.entities.has(object.id)) continue;
            const payload = object.id === modelSpaceId ? Object.fromEntries(Object.entries(object.payload).filter(([key])=>key !== 'entityIds')) : object.payload;
            if (refersToRemoved([
                object.ownerId,
                payload,
                object.extension,
                object.source
            ])) fail(`another object refers to a removed road object: ${object.id}`);
        }
        for (const id of updatedIds)tx.updateObject(id, {
            payload: after.entities.get(id).payload
        });
        for (const id of removedIds)tx.eraseObject(id, {
            hard: true
        });
        for (const id of createdIds){
            const spec = after.entities.get(id);
            tx.createEntity(spec.type, spec.payload, {
                id,
                ownerId: modelSpaceId
            });
        }
        scope.validate();
    }, {
        expectedRevision,
        source: 'road-drawing-update',
        metadata: {
            drawingId: before.drawingId
        }
    });
    return deepFreeze({
        documentId: document.id,
        drawingId: before.drawingId,
        previousRevision: expectedRevision,
        revision: expectedRevision + 1,
        updatedIds,
        createdIds,
        removedIds,
        unchangedIds
    });
}
