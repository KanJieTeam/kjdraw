// Generated from agent-capabilities.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJRegistrationError, KJValidationError } from './errors.js';
import { deepFreeze, stableHash } from './utils.js';
export const KJDRAW_AGENT_CAPABILITY_SCHEMA = 'com.kanjie.kjdraw.agent-capability';
export const KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION = 1;
export const KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION_V2 = 2;
export const KJDRAW_AGENT_CAPABILITY_TOOL_API_VERSION = 1;
const ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const TOOL = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const MAX_MANIFEST_BYTES = 32768;
const MAX_SELECTION_BYTES = 65536;
const FACTS = new Set([
    'native-reference',
    'geometry-relation',
    'repeat-group',
    'spatial-cluster',
    'property'
]);
const PREDICATE_OPERATORS = new Set([
    'exists',
    'equals',
    'at_least',
    'at_most',
    'all_resolved',
    'same_as',
    'within'
]);
const ASSERTION_OPERATORS = new Set([
    'equals',
    'at_least',
    'at_most',
    'is_true'
]);
const PLACEHOLDERS = new Set([
    '$candidate.seedIds',
    '$candidate.relatedIds',
    '$candidate.nonMatchingIds',
    '$document.revision',
    '$document.units'
]);
const EVIDENCE_PATHS = new Set([
    'entities[].ownerId',
    'entities[].layer.id',
    'entities[].nativeReferences.hatch.loops[].boundarySources',
    'entities[].nativeReferences.insert.typeCountSignature',
    'entities[].nativeReferences.insert.repeat.sameDefinitionInstanceCount',
    'entities[].nativeReferences.displayExtent.bounds'
]);
const PATH_FACTS = {
    'entities[].ownerId': [
        'property'
    ],
    'entities[].layer.id': [
        'property'
    ],
    'entities[].nativeReferences.hatch.loops[].boundarySources': [
        'native-reference'
    ],
    'entities[].nativeReferences.insert.typeCountSignature': [
        'property'
    ],
    'entities[].nativeReferences.insert.repeat.sameDefinitionInstanceCount': [
        'repeat-group'
    ],
    'entities[].nativeReferences.displayExtent.bounds': [
        'property',
        'geometry-relation',
        'spatial-cluster'
    ]
};
const ENTITY_TYPE = /^[A-Z][A-Z0-9_]{0,63}$/;
const INPUT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ASSERTION_PATH = /^[A-Za-z][A-Za-z0-9_.\[\]-]{0,255}$/;
const UNSAFE_PATH_SEGMENTS = new Set([
    '__proto__',
    'prototype',
    'constructor'
]);
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
function finiteScalar(value, label) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    return fail(`${label} must be a finite JSON scalar`);
}
function evidenceSource(value, requiredToolNames, label) {
    const source = record(value, [
        'toolName',
        'scope',
        'path'
    ], label);
    if (source.toolName !== 'cad_query_topology' || !requiredToolNames.includes(source.toolName)) return fail(`${label} must use the declared cad_query_topology tool`);
    if (![
        'seed',
        'related'
    ].includes(String(source.scope))) return fail(`${label} scope is unsupported`);
    if (!EVIDENCE_PATHS.has(String(source.path))) return fail(`${label} path is unsupported`);
    return {
        toolName: 'cad_query_topology',
        scope: source.scope,
        path: source.path
    };
}
function candidateRules(value, requiredToolNames) {
    if (!Array.isArray(value) || !value.length || value.length > 32) return fail('Capability candidateRules must contain 1 to 32 rules');
    const rules = value.map((rule)=>{
        const item = record(rule, [
            'id',
            'candidateKind',
            'seed',
            'predicates',
            'evidenceCodes',
            'nonMatchPolicy',
            'confirmation'
        ], 'Capability candidate rule');
        const seed = record(item.seed, [
            'entityTypes'
        ], 'Capability candidate seed');
        if (!Array.isArray(seed.entityTypes) || !seed.entityTypes.length || seed.entityTypes.length > 16) return fail('Capability candidate seed must contain 1 to 16 entity types');
        const entityTypes = seed.entityTypes.map((value)=>text(value, 'Candidate entity type', 64));
        if (entityTypes.some((value)=>!ENTITY_TYPE.test(value)) || new Set(entityTypes).size !== entityTypes.length) return fail('Candidate entity types must be unique canonical names');
        if (!Array.isArray(item.predicates) || !item.predicates.length || item.predicates.length > 16) return fail('Capability candidate predicates must contain 1 to 16 entries');
        const predicates = item.predicates.map((value)=>{
            const predicate = record(value, [
                'fact',
                'source',
                'operator',
                'compareTo',
                'relation',
                'value'
            ], 'Capability candidate predicate');
            if (!FACTS.has(String(predicate.fact))) return fail('Capability candidate predicate fact is unsupported');
            if (!PREDICATE_OPERATORS.has(String(predicate.operator))) return fail('Capability candidate predicate operator is unsupported');
            const fact = predicate.fact;
            const operator = predicate.operator;
            const source = evidenceSource(predicate.source, requiredToolNames, 'Capability candidate predicate source');
            if (!PATH_FACTS[source.path].includes(fact)) return fail(`Capability candidate predicate ${fact} cannot use evidence path ${source.path}`);
            const hasValue = Object.hasOwn(predicate, 'value');
            const hasComparison = Object.hasOwn(predicate, 'compareTo');
            if ([
                'equals',
                'at_least',
                'at_most'
            ].includes(operator) !== hasValue || [
                'same_as',
                'within'
            ].includes(operator) !== hasComparison) return fail(`Capability candidate predicate ${operator} has invalid value or comparison fields`);
            const scalar = hasValue ? finiteScalar(predicate.value, 'Capability candidate predicate value') : undefined;
            if ([
                'at_least',
                'at_most'
            ].includes(operator) && typeof scalar !== 'number') return fail(`Capability candidate predicate ${operator} requires a numeric value`);
            const compareTo = hasComparison ? evidenceSource(predicate.compareTo, requiredToolNames, 'Capability candidate predicate comparison source') : undefined;
            if (compareTo && compareTo.scope === source.scope) return fail('Capability candidate predicate comparisons must bind seed and related scopes');
            if (compareTo && compareTo.path !== source.path) return fail('Capability candidate predicate comparisons must use the same evidence path');
            const allowedByFact = {
                'native-reference': [
                    'exists',
                    'all_resolved'
                ],
                'repeat-group': [
                    'at_least',
                    'at_most'
                ],
                property: [
                    'exists',
                    'equals',
                    'same_as'
                ],
                'geometry-relation': [
                    'within'
                ],
                'spatial-cluster': [
                    'within'
                ]
            };
            if (!allowedByFact[fact].includes(operator)) return fail(`Capability candidate predicate ${fact}/${operator} combination is unsupported`);
            const relation = predicate.relation === undefined ? undefined : identifier(predicate.relation, 'Capability candidate relation');
            return {
                fact,
                source,
                operator,
                ...compareTo === undefined ? {} : {
                    compareTo
                },
                ...relation === undefined ? {} : {
                    relation
                },
                ...hasValue ? {
                    value: scalar
                } : {}
            };
        });
        if (predicates.some((predicate)=>predicate.fact === 'repeat-group')) {
            const scopedBy = (path)=>predicates.some((predicate)=>predicate.operator === 'same_as' && predicate.source.path === path);
            const contained = predicates.some((predicate)=>predicate.operator === 'within' && predicate.source.path === 'entities[].nativeReferences.displayExtent.bounds');
            if (!scopedBy('entities[].ownerId') || !scopedBy('entities[].layer.id') || !contained) return fail('Repeated candidates must bind owner, layer and related spatial containment');
        }
        if (!Array.isArray(item.evidenceCodes) || !item.evidenceCodes.length || item.evidenceCodes.length > 16) return fail('Capability candidate evidenceCodes must contain 1 to 16 entries');
        const evidenceCodes = item.evidenceCodes.map((value)=>identifier(value, 'Capability evidence code'));
        if (new Set(evidenceCodes).size !== evidenceCodes.length) return fail('Capability evidence codes must be unique');
        if (item.nonMatchPolicy !== undefined && item.nonMatchPolicy !== 'preserve') return fail('Capability candidate nonMatchPolicy is unsupported');
        if (![
            'always',
            'when-ambiguous'
        ].includes(String(item.confirmation))) return fail('Capability candidate confirmation is unsupported');
        if (entityTypes.some((type)=>type === 'HATCH' || type === 'INSERT') && item.confirmation !== 'always') return fail('HATCH and INSERT semantic candidates require explicit confirmation');
        return {
            id: identifier(item.id, 'Capability candidate rule id'),
            candidateKind: identifier(item.candidateKind, 'Capability candidate kind'),
            seed: {
                entityTypes
            },
            predicates,
            evidenceCodes,
            ...item.nonMatchPolicy === undefined ? {} : {
                nonMatchPolicy: item.nonMatchPolicy
            },
            confirmation: item.confirmation
        };
    });
    if (new Set(rules.map((rule)=>rule.id)).size !== rules.length) return fail('Capability candidate rule ids must be unique');
    return rules;
}
const PLACEHOLDER_SHAPES = {
    '$candidate.seedIds': {
        type: 'array',
        itemType: 'string'
    },
    '$candidate.relatedIds': {
        type: 'array',
        itemType: 'string'
    },
    '$candidate.nonMatchingIds': {
        type: 'array',
        itemType: 'string'
    },
    '$document.revision': {
        type: 'integer'
    },
    '$document.units': {
        type: 'string'
    }
};
function templateValue(value, schema, label) {
    if (typeof value === 'string' && value.startsWith('$')) {
        if (!PLACEHOLDERS.has(value)) return fail(`${label} placeholder is unsupported`);
        const shape = PLACEHOLDER_SHAPES[value];
        if (schema.type !== shape.type || shape.itemType && schema.items?.type !== shape.itemType) return fail(`${label} placeholder does not match the tool schema`);
        return value;
    }
    if (schema.type === 'null') {
        if (value !== null) return fail(`${label} must be null`);
        return null;
    }
    if (schema.type === 'boolean') {
        if (typeof value !== 'boolean') return fail(`${label} must be boolean`);
        return value;
    }
    if (schema.type === 'string') {
        if (typeof value !== 'string' || schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength || schema.enum && !schema.enum.includes(value)) return fail(`${label} does not match the tool string schema`);
        return value;
    }
    if (schema.type === 'number' || schema.type === 'integer') {
        if (typeof value !== 'number' || !Number.isFinite(value) || schema.type === 'integer' && !Number.isSafeInteger(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum || schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return fail(`${label} does not match the tool numeric schema`);
        return value;
    }
    if (schema.type === 'array') {
        if (!Array.isArray(value) || schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems || !schema.items) return fail(`${label} does not match the tool array schema`);
        return value.map((item, index)=>templateValue(item, schema.items, `${label}[${index}]`));
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !schema.properties) return fail(`${label} does not match the tool object schema`);
    const source = value, keys = Object.keys(source);
    if (schema.additionalProperties === false && keys.some((key)=>!Object.hasOwn(schema.properties, key))) return fail(`${label} contains fields outside the tool schema`);
    if ((schema.required ?? []).some((key)=>!Object.hasOwn(source, key))) return fail(`${label} is missing required tool fields`);
    const result = {};
    for (const key of keys){
        const propertySchema = schema.properties[key];
        if (!propertySchema) return fail(`${label} contains a field without a tool schema`);
        result[key] = templateValue(source[key], propertySchema, `${label}.${key}`);
    }
    return result;
}
function acceptanceTemplates(value, requiredToolNames, toolDefinitions) {
    if (!Array.isArray(value) || !value.length || value.length > 32) return fail('Capability acceptanceTemplates must contain 1 to 32 templates');
    const templates = value.map((template)=>{
        const item = record(template, [
            'id',
            'description',
            'toolName',
            'input',
            'assertions'
        ], 'Capability acceptance template');
        const toolName = text(item.toolName, 'Acceptance template tool name', 128);
        if (!requiredToolNames.includes(toolName)) return fail('Acceptance template tools must be declared required tools');
        const definition = toolDefinitions.get(toolName);
        if (!definition) return fail('Acceptance template tool must have a registered KJDraw tool schema');
        const input = templateValue(item.input, definition.inputSchema, 'Capability acceptance template input');
        const inputKeys = Object.keys(input);
        if (inputKeys.length > 16 || inputKeys.some((key)=>!INPUT_KEY.test(key))) return fail('Capability acceptance template input must contain at most 16 valid keys');
        if (!Array.isArray(item.assertions) || !item.assertions.length || item.assertions.length > 16) return fail('Capability acceptance assertions must contain 1 to 16 entries');
        const assertions = item.assertions.map((value)=>{
            const assertion = record(value, [
                'path',
                'operator',
                'expected'
            ], 'Capability acceptance assertion');
            const path = text(assertion.path, 'Acceptance assertion path', 256);
            if (!ASSERTION_PATH.test(path) || path.split(/[.\[\]-]+/).some((segment)=>UNSAFE_PATH_SEGMENTS.has(segment))) return fail('Acceptance assertion path is invalid');
            if (!ASSERTION_OPERATORS.has(String(assertion.operator))) return fail('Acceptance assertion operator is unsupported');
            const operator = assertion.operator;
            const expected = finiteScalar(assertion.expected, 'Acceptance assertion expected value');
            if ([
                'at_least',
                'at_most'
            ].includes(operator) && typeof expected !== 'number' || operator === 'is_true' && expected !== true) return fail(`Acceptance assertion ${operator} has an invalid expected value`);
            return {
                path,
                operator,
                expected
            };
        });
        return {
            id: identifier(item.id, 'Capability acceptance template id'),
            description: text(item.description, 'Capability acceptance template description', 2048),
            toolName,
            input,
            assertions
        };
    });
    if (new Set(templates.map((template)=>template.id)).size !== templates.length) return fail('Capability acceptance template ids must be unique');
    return templates;
}
export function validateAgentCapabilityManifest(input, { toolDefinitions = [] } = {}) {
    const detached = jsonSnapshot(input);
    if (!detached || typeof detached !== 'object' || Array.isArray(detached)) return fail('Capability manifest must be an object');
    const schemaVersion = detached.schemaVersion;
    const commonFields = [
        'schema',
        'schemaVersion',
        'id',
        'name',
        'version',
        'toolApiVersion',
        'instructions',
        'requiredToolNames',
        'requirements'
    ];
    const source = record(detached, schemaVersion === KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION_V2 ? [
        ...commonFields,
        'candidateRules',
        'acceptanceTemplates'
    ] : commonFields, 'Capability manifest');
    byteBudget(source, MAX_MANIFEST_BYTES);
    if (source.schema !== KJDRAW_AGENT_CAPABILITY_SCHEMA || ![
        KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION,
        KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION_V2
    ].includes(source.schemaVersion)) return fail('Unsupported agent capability schema');
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
    const base = {
        schema: KJDRAW_AGENT_CAPABILITY_SCHEMA,
        schemaVersion: source.schemaVersion,
        id: identifier(source.id, 'Capability id'),
        name: text(source.name, 'Capability name'),
        version: version(source.version),
        toolApiVersion: source.toolApiVersion,
        instructions: text(source.instructions, 'Capability instructions', 16384),
        requiredToolNames,
        requirements
    };
    if (source.schemaVersion === KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION) return deepFreeze(base);
    if (!Array.isArray(toolDefinitions) || toolDefinitions.length > 256 || toolDefinitions.some((definition)=>!definition || typeof definition !== 'object' || !TOOL.test(definition.name))) return fail('Capability tool definitions must be a bounded declared tool list');
    const toolDefinitionMap = new Map(toolDefinitions.map((definition)=>[
            definition.name,
            definition
        ]));
    if (toolDefinitionMap.size !== toolDefinitions.length) return fail('Capability tool definition names must be unique');
    return deepFreeze({
        ...base,
        schemaVersion: KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION_V2,
        candidateRules: candidateRules(source.candidateRules, requiredToolNames),
        acceptanceTemplates: acceptanceTemplates(source.acceptanceTemplates, requiredToolNames, toolDefinitionMap)
    });
}
export class KJAgentCapabilityRegistry {
    #toolApiVersion;
    #toolDefinitions;
    #manifests = new Map();
    constructor({ toolApiVersion = KJDRAW_AGENT_CAPABILITY_TOOL_API_VERSION, toolDefinitions = [] } = {}){
        if (!Number.isSafeInteger(toolApiVersion) || toolApiVersion < 1) fail('Registry toolApiVersion must be a positive integer');
        this.#toolApiVersion = toolApiVersion;
        this.#toolDefinitions = toolDefinitions;
    }
    get toolApiVersion() {
        return this.#toolApiVersion;
    }
    register(input) {
        const manifest = validateAgentCapabilityManifest(input, {
            toolDefinitions: this.#toolDefinitions
        });
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
                    }))),
            candidateRules: manifests.flatMap((manifest)=>manifest.schemaVersion === KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION_V2 ? manifest.candidateRules.map((item)=>({
                        ...item,
                        capabilityId: manifest.id,
                        capabilityVersion: manifest.version
                    })) : []),
            acceptanceTemplates: manifests.flatMap((manifest)=>manifest.schemaVersion === KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION_V2 ? manifest.acceptanceTemplates.map((item)=>({
                        ...item,
                        capabilityId: manifest.id,
                        capabilityVersion: manifest.version
                    })) : [])
        };
        byteBudget(result, MAX_SELECTION_BYTES);
        return deepFreeze(result);
    }
}
