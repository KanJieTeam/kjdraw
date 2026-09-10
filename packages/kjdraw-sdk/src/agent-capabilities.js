// Generated from agent-capabilities.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJRegistrationError, KJValidationError } from './errors.js';
import { deepFreeze, stableHash } from './utils.js';
export const KJDRAW_AGENT_CAPABILITY_SCHEMA = 'com.kanjie.kjdraw.agent-capability';
export const KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION = 1;
export const KJDRAW_AGENT_CAPABILITY_TOOL_API_VERSION = 1;
const ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const TOOL = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const MAX_MANIFEST_BYTES = 32768;
const MAX_SELECTION_BYTES = 65536;
const fail = (message)=>{
    throw new KJValidationError(message);
};
function jsonSnapshot(input) {
    let nodes = 0, characters = 0;
    const active = new Set();
    const visit = (value, depth)=>{
        if (++nodes > 2048 || depth > 8) return fail('Capability data exceeds the structural budget');
        if (typeof value === 'string') {
            characters += value.length;
            if (characters > MAX_SELECTION_BYTES) return fail('Capability data exceeds the text budget');
            return value;
        }
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (!value || typeof value !== 'object') return fail('Capability data must contain only finite JSON values');
        if (active.has(value)) return fail('Capability data must not contain cycles');
        const array = Array.isArray(value);
        if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) && !(Object.getPrototypeOf(value) === null && !array)) return fail('Capability data must use plain objects and arrays');
        const keys = Reflect.ownKeys(value);
        if (keys.length > 2048) return fail('Capability data exceeds the structural budget');
        const result = array ? [] : Object.create(null);
        active.add(value);
        for (const key of keys){
            if (array && key === 'length') continue;
            if (typeof key !== 'string' || [
                '__proto__',
                'prototype',
                'constructor'
            ].includes(key)) return fail('Capability data contains an unsafe property');
            if (array && !/^(0|[1-9]\d*)$/.test(key)) return fail('Capability arrays must contain only indexed values');
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor.enumerable || !('value' in descriptor)) return fail('Capability data must not contain accessors or hidden properties');
            characters += key.length;
            result[key] = visit(descriptor.value, depth + 1);
        }
        if (array && keys.length - 1 !== value.length) return fail('Capability arrays must not contain holes');
        active.delete(value);
        return result;
    };
    return visit(input, 0);
}
function record(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label} must be an object`);
    const result = value;
    if (Object.keys(result).some((key)=>!keys.includes(key))) return fail(`${label} contains unknown fields`);
    return result;
}
function text(value, label, maximum = 256) {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0')) return fail(`${label} must be nonempty text of at most ${maximum} characters`);
    return value;
}
function identifier(value, label) {
    const result = text(value, label, 128);
    if (!ID.test(result)) return fail(`${label} must be a stable lowercase identifier`);
    return result;
}
function version(value) {
    const result = text(value, 'Capability version', 128);
    if (!SEMVER.test(result)) return fail('Capability version must be an exact semantic version');
    return result;
}
function toolNames(value) {
    if (!Array.isArray(value) || !value.length || value.length > 64) return fail('Supply 1 to 64 unique capability tool names');
    const names = value.map((name)=>text(name, 'Tool name', 128));
    if (names.some((name)=>!TOOL.test(name)) || new Set(names).size !== names.length) return fail('Capability tool names must be valid and unique');
    return names;
}
function byteBudget(value, maximum) {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum) fail('Capability data exceeds the byte budget');
}
function reference(value) {
    const item = record(value, [
        'id',
        'version'
    ], 'Capability reference');
    return {
        id: identifier(item.id, 'Capability id'),
        version: version(item.version)
    };
}
export function validateAgentCapabilityManifest(input) {
    const source = record(jsonSnapshot(input), [
        'schema',
        'schemaVersion',
        'id',
        'name',
        'version',
        'toolApiVersion',
        'instructions',
        'requiredToolNames',
        'requirements'
    ], 'Capability manifest');
    byteBudget(source, MAX_MANIFEST_BYTES);
    if (source.schema !== KJDRAW_AGENT_CAPABILITY_SCHEMA || source.schemaVersion !== KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION) return fail('Unsupported agent capability schema');
    if (!Number.isSafeInteger(source.toolApiVersion) || source.toolApiVersion < 1) return fail('Capability toolApiVersion must be a positive integer');
    const requiredToolNames = toolNames(source.requiredToolNames);
    if (!Array.isArray(source.requirements) || source.requirements.length > 64) return fail('Capability requirements must be an array of at most 64 items');
    const requirements = source.requirements.map((value)=>{
        const item = record(value, [
            'id',
            'description',
            'check'
        ], 'Capability requirement');
        const check = record(item.check, [
            'toolName',
            'assertion'
        ], 'Capability requirement check');
        const toolName = text(check.toolName, 'Requirement tool name', 128);
        if (!requiredToolNames.includes(toolName)) return fail('Requirement checks must use a declared required tool');
        return {
            id: identifier(item.id, 'Requirement id'),
            description: text(item.description, 'Requirement description', 2048),
            check: {
                toolName,
                assertion: text(check.assertion, 'Requirement assertion', 2048)
            }
        };
    });
    if (new Set(requirements.map((item)=>item.id)).size !== requirements.length) return fail('Capability requirement ids must be unique');
    return deepFreeze({
        schema: KJDRAW_AGENT_CAPABILITY_SCHEMA,
        schemaVersion: KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION,
        id: identifier(source.id, 'Capability id'),
        name: text(source.name, 'Capability name'),
        version: version(source.version),
        toolApiVersion: source.toolApiVersion,
        instructions: text(source.instructions, 'Capability instructions', 16384),
        requiredToolNames,
        requirements
    });
}
export class KJAgentCapabilityRegistry {
    #toolApiVersion;
    #manifests = new Map();
    constructor({ toolApiVersion = KJDRAW_AGENT_CAPABILITY_TOOL_API_VERSION } = {}){
        if (!Number.isSafeInteger(toolApiVersion) || toolApiVersion < 1) fail('Registry toolApiVersion must be a positive integer');
        this.#toolApiVersion = toolApiVersion;
    }
    register(input) {
        const manifest = validateAgentCapabilityManifest(input);
        if (manifest.toolApiVersion !== this.#toolApiVersion) throw new KJRegistrationError(`Capability ${manifest.id} requires tool API ${manifest.toolApiVersion}; current ${this.#toolApiVersion}`);
        const key = `${manifest.id}@${manifest.version}`;
        if (this.#manifests.has(key)) throw new KJRegistrationError(`Capability version is already registered: ${key}`);
        if (this.#manifests.size >= 256) throw new KJRegistrationError('Capability registry exceeds its 256-version budget');
        this.#manifests.set(key, manifest);
        return manifest;
    }
    list() {
        return Object.freeze([
            ...this.#manifests.values()
        ]);
    }
    #get(ref) {
        const result = this.#manifests.get(`${ref.id}@${ref.version}`);
        if (!result) throw new KJRegistrationError(`Capability version is not registered: ${ref.id}@${ref.version}`);
        return result;
    }
    createLock(references) {
        const values = jsonSnapshot(references);
        if (!Array.isArray(values) || !values.length || values.length > 16) return fail('Select 1 to 16 exact capability versions');
        const refs = values.map(reference);
        if (new Set(refs.map((ref)=>ref.id)).size !== refs.length) return fail('Select only one version of each capability id');
        return deepFreeze(refs.map((ref)=>({
                ...ref,
                contentHash: stableHash(this.#get(ref))
            })));
    }
    resolve({ lock, allowedToolNames }) {
        const input = record(jsonSnapshot({
            lock,
            allowedToolNames
        }), [
            'lock',
            'allowedToolNames'
        ], 'Capability selection');
        const allowed = new Set(toolNames(input.allowedToolNames));
        if (!Array.isArray(input.lock) || !input.lock.length || input.lock.length > 16) return fail('Select 1 to 16 locked capability versions');
        const locks = input.lock.map((value)=>{
            const item = record(value, [
                'id',
                'version',
                'contentHash'
            ], 'Capability lock entry');
            const ref = reference({
                id: item.id,
                version: item.version
            });
            const manifest = this.#get(ref);
            if (item.contentHash !== stableHash(manifest)) throw new KJRegistrationError(`Capability content does not match the project lock: ${ref.id}@${ref.version}`);
            return {
                ...ref,
                contentHash: item.contentHash
            };
        });
        if (new Set(locks.map((ref)=>ref.id)).size !== locks.length) return fail('Select only one version of each capability id');
        const manifests = locks.map((ref)=>this.#get(ref));
        const names = [
            ...new Set(manifests.flatMap((manifest)=>manifest.requiredToolNames))
        ];
        if (names.some((name)=>!allowed.has(name))) throw new KJRegistrationError('Selected capabilities require tools outside the host allowlist');
        const result = {
            lock: locks,
            toolNames: names,
            instructions: manifests.map((manifest)=>`Capability ${manifest.id}@${manifest.version}: ${manifest.name}\n${manifest.instructions}\nRequested evidence checks (not validation results):\n${manifest.requirements.map((item)=>`${item.id}: ${item.description}\nUse ${item.check.toolName} to check: ${item.check.assertion}`).join('\n')}`).join('\n\n'),
            requirements: manifests.flatMap((manifest)=>manifest.requirements.map((item)=>({
                        ...item,
                        capabilityId: manifest.id,
                        capabilityVersion: manifest.version
                    })))
        };
        byteBudget(result, MAX_SELECTION_BYTES);
        return deepFreeze(result);
    }
}
