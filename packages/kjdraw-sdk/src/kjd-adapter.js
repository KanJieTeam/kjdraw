// Generated from kjd-adapter.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJD_SCHEMA, KJD_SCHEMA_VERSION } from './constants.js';
import { KJDocument } from './document.js';
import { KJValidationError } from './errors.js';
import { defineFileAdapter } from './file-adapters.js';
export const KJD_DEFAULT_READ_LIMITS = Object.freeze({
    maxBytes: 64 * 1024 ** 2,
    maxObjects: 250_000
});
function readLimits(options = {}) {
    const overrides = 'limits' in options && options.limits ? options.limits : options;
    return {
        ...KJD_DEFAULT_READ_LIMITS,
        ...overrides
    };
}
function assertSize(size, limits) {
    if (Number.isFinite(size) && Number(size) > limits.maxBytes) throw new KJValidationError(`KJD source exceeds the ${limits.maxBytes} byte read limit`);
}
function assertObjectCount(value, limits) {
    if (!value || typeof value !== 'object' || !('objects' in value)) return;
    const objects = value.objects;
    if (objects && typeof objects === 'object' && Object.keys(objects).length > limits.maxObjects) throw new KJValidationError(`KJD object count exceeds the ${limits.maxObjects} read limit`);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
async function sourceText(source, options = {}) {
    const limits = readLimits(options);
    if (typeof source === 'string') {
        assertSize(new TextEncoder().encode(source).byteLength, limits);
        return source;
    }
    if (source instanceof Uint8Array) {
        assertSize(source.byteLength, limits);
        return new TextDecoder().decode(source);
    }
    if (source instanceof ArrayBuffer) {
        assertSize(source.byteLength, limits);
        return new TextDecoder().decode(new Uint8Array(source));
    }
    if (source && typeof source === 'object' && 'text' in source && typeof source.text === 'function') {
        const textSource = source;
        assertSize(textSource.size, limits);
        const text = await textSource.text();
        assertSize(new TextEncoder().encode(text).byteLength, limits);
        return text;
    }
    if (source && typeof source === 'object') return JSON.stringify(source);
    throw new KJValidationError('KJD source must be text, bytes, Blob/File, or an object');
}
async function parseSource(source, options = {}) {
    const limits = readLimits(options);
    if (options.signal?.aborted) throw new KJValidationError('KJD read aborted');
    if (source instanceof KJDocument) return source.toJSON();
    if (source && typeof source === 'object' && !(source instanceof Uint8Array) && !(source instanceof ArrayBuffer) && !('text' in source && typeof source.text === 'function')) {
        assertObjectCount(source, limits);
        return source;
    }
    const text = await sourceText(source, limits);
    let value;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new KJValidationError('KJD source is not valid JSON', {
            cause: errorMessage(error)
        });
    }
    assertObjectCount(value, limits);
    return value;
}
export function createKJDFileAdapter(options = {}) {
    return defineFileAdapter({
        id: options.id ?? 'kanjie.kjd.v1',
        vendor: 'Kanjie',
        priority: Number(options.priority ?? 1000),
        formats: {
            KJD: {
                read: [
                    String(KJD_SCHEMA_VERSION)
                ],
                write: [
                    String(KJD_SCHEMA_VERSION)
                ],
                notes: [
                    'Canonical KJDraw document'
                ]
            }
        },
        capabilities: {
            certification: 'schema-roundtrip',
            container: 'canonical-json',
            modelSpace: true,
            paperSpace: true,
            layouts: true,
            tables: true,
            resources: true,
            opaquePayloads: true,
            revisions: true
        },
        preservation: {
            handles: 'exact',
            ownership: 'exact',
            objectIds: 'exact',
            opaqueObjects: 'exact',
            resources: 'exact'
        },
        sniff: async (source)=>{
            try {
                const state = await parseSource(source, options);
                return state?.schema === KJD_SCHEMA && Number(state?.schemaVersion) === KJD_SCHEMA_VERSION;
            } catch  {
                return false;
            }
        },
        read: async (source, readOptions = {})=>KJDocument.open(await parseSource(source, readOptions)),
        write: async (document, writeOptions = {})=>{
            if (!(document instanceof KJDocument)) throw new KJValidationError('KJD writer requires a KJDocument');
            return document.serialize({
                pretty: Boolean(writeOptions.pretty),
                includeRevisions: writeOptions.includeRevisions !== false
            });
        }
    });
}
