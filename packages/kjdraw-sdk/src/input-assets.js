// Generated from input-assets.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { computeRoadDesign } from './road-design.js';
import { canonicalizeAgentPlanBinding, KJ_AGENT_PLAN_BINDING_CANONICALIZATION } from './agent-plans.js';
import { deepFreeze } from './utils.js';
export const KJDRAW_ROAD_INPUT_ASSET_SCHEMA = 'com.kanjie.kjdraw.road-design-input@1';
function fail(message) {
    throw new KJValidationError('Input asset: ' + message);
}
function snapshot(input) {
    let nodes = 0, characters = 0;
    const active = new Set();
    const visit = (value, depth)=>{
        if (++nodes > 30000 || depth > 12) fail('structural budget exceeded');
        if (typeof value === 'string') {
            if ((characters += value.length) > 1048576) fail('text budget exceeded');
            return value;
        }
        if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
        if (!value || typeof value !== 'object') fail('finite plain JSON data is required');
        const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
        if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) fail('plain objects and arrays are required');
        if (active.has(value)) fail('cycles are forbidden');
        const keys = Reflect.ownKeys(value);
        if (keys.length > 30000 || array && keys.length !== value.length + 1) fail('arrays must be dense and bounded');
        const copy = array ? [] : Object.create(null);
        active.add(value);
        for (const key of keys){
            if (array && key === 'length') continue;
            if (typeof key !== 'string' || [
                '__proto__',
                'prototype',
                'constructor'
            ].includes(key)) fail('unsafe property');
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor.enumerable || !('value' in descriptor) || array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail('accessors, sparse arrays and hidden properties are forbidden');
            if ((characters += key.length) > 1048576) fail('text budget exceeded');
            copy[key] = visit(descriptor.value, depth + 1);
        }
        active.delete(value);
        return copy;
    };
    return visit(input, 0);
}
export async function createAgentInputAsset(input) {
    const copy = snapshot(input);
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) fail('registration must be an object');
    const item = copy;
    if (Object.keys(item).length !== 3 || ![
        'assetId',
        'schema',
        'data'
    ].every((key)=>Object.hasOwn(item, key))) fail('registration requires exactly assetId, schema and data');
    if (typeof item.assetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item.assetId)) fail('assetId must be a bounded local identifier, never a path or URL');
    if (item.schema !== KJDRAW_ROAD_INPUT_ASSET_SCHEMA) fail('unsupported data schema or version');
    const canonical = canonicalizeAgentPlanBinding({
        schema: item.schema,
        data: item.data
    });
    const bytes = new TextEncoder().encode(canonical);
    if (bytes.byteLength > 1048576) fail('data exceeds the 1 MiB asset budget');
    const data = JSON.parse(canonical).data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('road data must be an object');
    const bounded = (value, maximum)=>Array.isArray(value) && value.length >= 2 && value.length <= maximum;
    if (!bounded(data.alignment, 64) || !bounded(data.profile, 64) || !bounded(data.sections, 64)) fail('road data requires 2–64 alignment points, profile knots and sections');
    let groundPoints = 0;
    for (const section of data.sections){
        if (!section || !bounded(section.ground, 256)) fail('each section requires 2–256 ground points');
        groundPoints += section.ground.length;
    }
    if (groundPoints > 4096) fail('ground data exceeds the 4096-point agent budget');
    const calculation = computeRoadDesign(data);
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) fail('SHA-256 requires the Web Crypto API');
    const digest = await subtle.digest('SHA-256', bytes);
    const sha256 = [
        ...new Uint8Array(digest)
    ].map((byte)=>byte.toString(16).padStart(2, '0')).join('');
    return deepFreeze({
        descriptor: {
            assetId: item.assetId,
            sha256,
            schema: KJDRAW_ROAD_INPUT_ASSET_SCHEMA,
            canonicalization: KJ_AGENT_PLAN_BINDING_CANONICALIZATION,
            units: 'meter',
            byteLength: bytes.byteLength,
            counts: {
                alignment: data.alignment.length,
                profile: data.profile.length,
                sections: data.sections.length,
                groundPoints
            },
            stationRange: [
                calculation.startStation,
                calculation.endStation
            ]
        },
        data
    });
}
