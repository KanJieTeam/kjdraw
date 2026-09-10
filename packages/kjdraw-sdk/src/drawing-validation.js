// Generated from drawing-validation.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJRevisionConflictError, KJValidationError } from './errors.js';
import { deepFreeze } from './utils.js';
const fail = (message)=>{
    throw new KJValidationError(message);
};
const boundedNumber = (value, label)=>typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : fail(`${label} must be a finite number between 0 and 1e12`);
const text = (value, label)=>typeof value === 'string' && !!value.trim() && value.length <= 256 && !value.includes('\0') ? value : fail(`${label} must be nonempty text of at most 256 characters`);
function snapshot(input) {
    let count = 0, characters = 0;
    const active = new Set();
    function copy(value, depth) {
        if (++count > 4096 || depth > 6) return fail('Validation input exceeds the structural budget');
        if (typeof value === 'string') {
            characters += value.length;
            if (characters > 65536) return fail('Validation input exceeds the text budget');
            return value;
        }
        if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
        if (!value || typeof value !== 'object') return fail('Validation input must contain only finite JSON values');
        const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
        if (proto !== (array ? Array.prototype : Object.prototype) && !(proto === null && !array)) return fail('Validation input must use plain objects');
        if (active.has(value)) return fail('Validation input must not contain cycles');
        const keys = Reflect.ownKeys(value);
        if (keys.length > 4096) return fail('Validation input exceeds the structural budget');
        const result = array ? [] : Object.create(null);
        active.add(value);
        for (const key of keys){
            if (array && key === 'length') continue;
            if (typeof key !== 'string' || [
                '__proto__',
                'constructor',
                'prototype'
            ].includes(key)) return fail('Unsafe validation input property');
            if (array && !/^(0|[1-9]\d*)$/.test(key)) return fail('Validation arrays require indexed values');
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor.enumerable || !('value' in descriptor)) return fail('Validation input must not contain accessors or hidden properties');
            result[key] = copy(descriptor.value, depth + 1);
        }
        if (array && keys.length - 1 !== value.length) return fail('Validation arrays must not contain holes');
        active.delete(value);
        return result;
    }
    return copy(input, 0);
}
function record(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label} must be an object`);
    const item = value;
    if (Object.keys(item).some((key)=>!allowed.includes(key))) return fail(`${label} contains unknown fields`);
    return item;
}
function point(value) {
    if (!Array.isArray(value) || value.length !== 3 || !value.every((n)=>typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e12)) return fail('Referenced geometry must contain finite native 3D points within 1e12');
    return value;
}
const distance = (a, b)=>Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function validateDrawingGeometry(document, input) {
    const source = record(snapshot(input), [
        'expectedRevision',
        'units',
        'checks'
    ], 'Drawing validation');
    if (new TextEncoder().encode(JSON.stringify(source)).byteLength > 65536) fail('Validation input exceeds the byte budget');
    if (!Number.isSafeInteger(source.expectedRevision) || source.expectedRevision < 0) fail('expectedRevision must be a nonnegative safe integer');
    if (source.expectedRevision !== document.revision) throw new KJRevisionConflictError(source.expectedRevision, document.revision);
    const units = text(source.units, 'units');
    if (units !== document.snapshot().header.units) fail('Validation units must exactly match the drawing units');
    if (!Array.isArray(source.checks) || !source.checks.length || source.checks.length > 64) return fail('Supply 1 to 64 explicit geometry checks');
    const ids = new Set();
    let verticesInspected = 0;
    const entity = (id, references, feature)=>{
        const objectId = text(id, 'objectId'), object = document.getObject(objectId);
        if (!object || object.kind !== 'entity' || !object.ownerId || document.getObject(object.ownerId)?.type !== 'BLOCK_RECORD') return fail('Geometry checks require an existing entity with a live owner space');
        references.push({
            objectId,
            ownerId: object.ownerId,
            ...feature ? {
                feature
            } : {}
        });
        return object;
    };
    const featurePoint = (value, refs)=>{
        const ref = record(value, [
            'objectId',
            'feature'
        ], 'Point reference');
        if (![
            'start',
            'end',
            'center',
            'origin'
        ].includes(ref.feature)) return fail('Unsupported geometry point feature');
        const feature = ref.feature, object = entity(ref.objectId, refs, feature);
        if ((feature === 'start' || feature === 'end') && object.type !== 'LINE' || feature === 'origin' && ![
            'XLINE',
            'RAY'
        ].includes(object.type) || feature === 'center' && ![
            'CIRCLE',
            'ARC'
        ].includes(object.type)) return fail('Point feature is unsupported for this entity type');
        if (feature === 'center') {
            const normal = point(object.payload.normal);
            if (normal[0] !== 0 || normal[1] !== 0 || normal[2] <= 0) fail('Point-distance center requires the default +Z plane; OCS transformation is not inferred');
        }
        return point(object.payload[feature]);
    };
    const checks = source.checks.map((value)=>{
        const item = record(value, [
            'id',
            'kind',
            'objectId',
            'from',
            'to',
            'expected',
            'tolerance'
        ], 'Geometry check');
        const id = text(item.id, 'Check id');
        if (ids.has(id)) fail('Check ids must be unique');
        ids.add(id);
        if (![
            'line-length',
            'circle-radius',
            'point-distance',
            'polyline-closed'
        ].includes(item.kind)) return fail('Unsupported geometry check kind');
        const kind = item.kind, refs = [];
        const tolerance = boundedNumber(item.tolerance, 'tolerance');
        let actual, expected;
        if (kind === 'point-distance') {
            if ('objectId' in item) fail('point-distance uses from/to references, not objectId');
            const from = featurePoint(item.from, refs), to = featurePoint(item.to, refs);
            if (refs[0].ownerId !== refs[1].ownerId) fail('Point-distance requires both entities in the same native owner space');
            actual = distance(from, to);
            expected = boundedNumber(item.expected, 'expected');
        } else {
            if ('from' in item || 'to' in item) fail('This check uses objectId, not from/to references');
            const object = entity(item.objectId, refs);
            if (kind === 'line-length') {
                if (object.type !== 'LINE') fail('line-length requires a native LINE entity');
                actual = distance(point(object.payload.start), point(object.payload.end));
                expected = boundedNumber(item.expected, 'expected');
            } else if (kind === 'circle-radius') {
                if (object.type !== 'CIRCLE') fail('circle-radius requires a native CIRCLE entity');
                actual = boundedNumber(object.payload.radius, 'Circle radius');
                if (actual === 0) fail('Circle radius must be positive');
                expected = boundedNumber(item.expected, 'expected');
            } else {
                if (![
                    'LWPOLYLINE',
                    'POLYLINE'
                ].includes(object.type)) fail('polyline-closed requires a native polyline');
                if (typeof item.expected !== 'boolean' || tolerance !== 0) fail('polyline-closed requires a boolean expected and tolerance 0');
                const vertices = object.payload.vertices;
                if (typeof object.payload.closed !== 'boolean' || !Array.isArray(vertices) || vertices.length < 2) return fail('Polyline closure requires a canonical closed flag and valid vertices');
                verticesInspected += vertices.length;
                if (verticesInspected > 20000) fail('Polyline checks exceed the 20000-vertex budget');
                for (const vertex of vertices){
                    if (!vertex || typeof vertex !== 'object' || Array.isArray(vertex)) fail('Polyline checks require canonical vertices');
                    point(vertex.point);
                    for (const name of [
                        'bulge',
                        'startWidth',
                        'endWidth'
                    ]){
                        const number = vertex[name];
                        if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 1e12 || name !== 'bulge' && number < 0) fail('Polyline vertex parameters must be finite canonical values');
                    }
                }
                actual = object.payload.closed;
                expected = item.expected;
            }
        }
        const error = typeof actual === 'boolean' ? actual === expected ? 0 : 1 : Math.abs(actual - expected);
        if (!Number.isFinite(error)) fail('Geometry check produced a nonfinite result');
        return {
            id,
            kind,
            actual,
            expected,
            error,
            tolerance,
            passed: error <= tolerance,
            references: refs
        };
    });
    return deepFreeze({
        documentId: document.id,
        revision: document.revision,
        units,
        passed: checks.every((check)=>check.passed),
        checks
    });
}
