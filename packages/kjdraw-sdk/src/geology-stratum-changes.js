// Generated from geology-stratum-changes.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
const fields = [
    'name',
    'lithology',
    'description',
    'descriptionSource',
    'code',
    'patternVisibility',
    'patternLabel'
];
const lithologies = [
    'fill',
    'cultivated-soil',
    'clay',
    'silty-clay',
    'silt',
    'sand',
    'gravel',
    'rock',
    'weathered-rock',
    'loess',
    'loess-collapsible',
    'loess-like',
    'paleosol',
    'calcareous-nodule'
];
function fail(message) {
    throw new KJValidationError(`Geology stratum changes: ${message}`);
}
function dataCopy(input) {
    let nodes = 0, characters = 0;
    const ancestors = new Set();
    const visit = (value, depth)=>{
        if (++nodes > 10000 || depth > 16) fail('data budget exceeded');
        if (value === undefined || value === null || typeof value === 'boolean') return;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) fail('nonfinite data');
            return;
        }
        if (typeof value === 'string') {
            if ((characters += value.length) > 200000) fail('text budget exceeded');
            return;
        }
        if (!value || typeof value !== 'object' || ancestors.has(value)) fail('require finite acyclic plain data');
        const array = Array.isArray(value);
        if (array ? Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1 : ![
            Object.prototype,
            null
        ].includes(Object.getPrototypeOf(value))) fail('require plain objects and dense arrays');
        ancestors.add(value);
        for (const key of Reflect.ownKeys(value)){
            if (array && key === 'length') continue;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (typeof key !== 'string' || [
                '__proto__',
                'constructor',
                'prototype'
            ].includes(key) || !descriptor.enumerable || !('value' in descriptor)) fail('accessors, hidden, symbol and unsafe properties are forbidden');
            if (array && (String(Number(key)) !== key || !Number.isSafeInteger(Number(key)) || Number(key) < 0 || Number(key) >= value.length)) fail('require indexed array data only');
            visit(descriptor.value, depth + 1);
        }
        ancestors.delete(value);
    };
    visit(input, 0);
    return structuredClone(input);
}
function closed(value, allowed, required, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
    const record = value;
    if (Object.keys(record).some((key)=>!allowed.includes(key)) || required.some((key)=>!Object.hasOwn(record, key))) fail(`${path} requires only its published fields`);
    return record;
}
export function applyGeologyStratumChanges(before, changes) {
    const original = dataCopy(before), operations = dataCopy(changes);
    if (!Array.isArray(original) || !original.length || original.length > 80) fail('require 1–80 existing source strata');
    closed(operations, [
        'update'
    ], [
        'update'
    ], 'stratumChanges');
    if (!Array.isArray(operations.update) || !operations.update.length || operations.update.length > 80) fail('require 1–80 explicit updates');
    const changed = new Map(), touched = new Set();
    for (const operation of operations.update){
        closed(operation, [
            'target',
            'set'
        ], [
            'target',
            'set'
        ], 'update');
        const target = closed(operation.target, [
            'intervalId',
            'expectedTop',
            'expectedBottom'
        ], [
            'intervalId',
            'expectedTop',
            'expectedBottom'
        ], 'target');
        const { intervalId, expectedTop, expectedBottom } = target;
        if (typeof intervalId !== 'string' || !intervalId.trim() || intervalId.length > 64 || typeof expectedTop !== 'number' || !Number.isFinite(expectedTop) || expectedTop < 0 || typeof expectedBottom !== 'number' || !Number.isFinite(expectedBottom) || expectedBottom <= expectedTop) fail('target requires exact intervalId and finite measured expectedTop/expectedBottom');
        const matches = original.flatMap((layer, index)=>layer.intervalId === intervalId ? [
                index
            ] : []);
        if (matches.length !== 1) fail('intervalId must match exactly one existing stratum in this hole');
        const index = matches[0], layer = original[index];
        if (layer.top !== expectedTop || layer.bottom !== expectedBottom) fail('expectedTop and expectedBottom must match the exact BEFORE source boundaries');
        if (touched.has(intervalId)) fail('an original interval cannot be updated more than once');
        touched.add(intervalId);
        const set = closed(operation.set, fields, [], 'set');
        if (!Object.keys(set).length) fail('set requires explicit changed fields');
        for (const field of Object.keys(set)){
            const value = set[field], maximum = field === 'description' ? 512 : field === 'name' ? 64 : field === 'code' || field === 'patternLabel' ? 24 : 32;
            if (field === 'patternVisibility') {
                if (value !== 'filled' && value !== 'boundary-only') fail('patternVisibility requires filled or boundary-only; it is a display choice, not a lithology change');
                continue;
            }
            if (field === 'descriptionSource') {
                if (value !== 'interval' && value !== 'layer-definition') fail('descriptionSource requires interval or layer-definition provenance');
                continue;
            }
            if (typeof value !== 'string' || !value.trim() || value.length > maximum || field === 'lithology' && !lithologies.includes(value)) fail('set fields must be bounded nonempty strings with a supported lithology');
        }
        if (!Object.keys(set).some((field)=>!Object.hasOwn(layer, field) || layer[field] !== set[field])) fail('an update must change stored facts');
        const updated = Object.assign(structuredClone(layer), structuredClone(set));
        if (updated.descriptionSource !== undefined && (typeof updated.description !== 'string' || !updated.description.trim())) fail('descriptionSource requires a nonempty final description; no description may be invented');
        changed.set(index, updated);
    }
    return original.map((layer, index)=>changed.get(index) ?? structuredClone(layer));
}
