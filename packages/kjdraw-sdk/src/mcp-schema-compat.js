// Generated from mcp-schema-compat.ts by scripts/build-typescript.mjs. Do not edit directly.
export const KJDRAW_MCP_SCHEMA_PROFILE = 'moonshot-walle-compatible-v1';
const STRICT_BOUND_EPSILON = 1e-12;
function inclusiveLowerBound(schema) {
    let minimum = schema.minimum;
    if (schema.exclusiveMinimum !== undefined) {
        const delta = Math.max(STRICT_BOUND_EPSILON, Math.abs(schema.exclusiveMinimum) * Number.EPSILON);
        const replacement = schema.exclusiveMinimum + delta;
        minimum = minimum === undefined ? replacement : Math.max(minimum, replacement);
    }
    return minimum;
}
export function portableMcpInputSchema(schema) {
    const common = {
        type: schema.type,
        ...schema.enum ? {
            enum: [
                ...schema.enum
            ]
        } : {}
    };
    if (schema.type === 'object') {
        return {
            ...common,
            properties: Object.fromEntries(Object.entries(schema.properties ?? {}).map(([name, child])=>[
                    name,
                    portableMcpInputSchema(child)
                ])),
            required: [
                ...schema.required ?? []
            ],
            ...schema.additionalProperties === false ? {
                additionalProperties: false
            } : {}
        };
    }
    if (schema.type === 'array') {
        return {
            ...common,
            ...schema.items ? {
                items: portableMcpInputSchema(schema.items)
            } : {},
            ...schema.minItems === undefined ? {} : {
                minItems: schema.minItems
            },
            ...schema.maxItems === undefined ? {} : {
                maxItems: schema.maxItems
            }
        };
    }
    if (schema.type === 'string') {
        return {
            ...common,
            ...schema.minLength === undefined ? {} : {
                minLength: schema.minLength
            },
            ...schema.maxLength === undefined ? {} : {
                maxLength: schema.maxLength
            }
        };
    }
    if (schema.type === 'number' || schema.type === 'integer') {
        const minimum = inclusiveLowerBound(schema);
        return {
            ...common,
            ...minimum === undefined ? {} : {
                minimum
            },
            ...schema.maximum === undefined ? {} : {
                maximum: schema.maximum
            }
        };
    }
    return common;
}
const ALLOWED = Object.freeze({
    object: new Set([
        'type',
        'properties',
        'required',
        'additionalProperties'
    ]),
    array: new Set([
        'type',
        'items',
        'minItems',
        'maxItems'
    ]),
    string: new Set([
        'type',
        'minLength',
        'maxLength',
        'enum'
    ]),
    number: new Set([
        'type',
        'minimum',
        'maximum',
        'enum'
    ]),
    integer: new Set([
        'type',
        'minimum',
        'maximum',
        'enum'
    ]),
    boolean: new Set([
        'type',
        'enum'
    ]),
    null: new Set([
        'type',
        'enum'
    ])
});
export function assertPortableMcpInputSchema(schema, path = 'inputSchema') {
    const allowed = ALLOWED[schema.type];
    if (!allowed) throw new Error(`${path} has an unsupported schema type`);
    for (const key of Object.keys(schema))if (!allowed.has(key)) throw new Error(`${path} uses unsupported MCP schema keyword ${key}`);
    if (schema.type === 'object') {
        if (!schema.properties || !Array.isArray(schema.required)) throw new Error(`${path} must declare object properties and required`);
        for (const [name, child] of Object.entries(schema.properties))assertPortableMcpInputSchema(child, `${path}.properties.${name}`);
    }
    if (schema.type === 'array') {
        if (!schema.items) throw new Error(`${path} must declare array items`);
        assertPortableMcpInputSchema(schema.items, `${path}.items`);
    }
}
