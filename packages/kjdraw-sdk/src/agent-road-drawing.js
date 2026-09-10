// Generated from agent-road-drawing.ts by scripts/build-typescript.mjs. Do not edit directly.
import { buildRoadDrawing } from './road-drawing.js';
import { KJRevisionConflictError, KJValidationError } from './errors.js';
import { deepFreeze } from './utils.js';
const fail = (message)=>{
    throw new KJValidationError(`Road proposal: ${message}`);
};
const fields = [
    'expectedRevision',
    'units',
    'drawingId',
    'title',
    'startStation',
    'alignment',
    'profile',
    'sections',
    'pavement',
    'slopes',
    'profileScale',
    'sectionScale',
    'textHeight',
    'sectionColumns',
    'precision'
];
function snapshot(value) {
    let nodes = 0, characters = 0;
    const active = new Set();
    const visit = (item, depth)=>{
        if (++nodes > 30000 || depth > 12) fail('input traversal budget exceeded');
        if (typeof item === 'string') {
            if ((characters += item.length) > 1048576) fail('input text budget exceeded');
            return item;
        }
        if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
        if (!item || typeof item !== 'object') return fail('input requires finite plain JSON data');
        const array = Array.isArray(item);
        if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype) && !(Object.getPrototypeOf(item) === null && !array)) fail('input requires plain objects and arrays');
        if (active.has(item)) fail('cyclic input');
        const keys = Reflect.ownKeys(item), result = array ? [] : {};
        if (keys.length > 30000) fail('input key budget exceeded');
        active.add(item);
        for (const key of keys){
            if (array && key === 'length') continue;
            const d = Object.getOwnPropertyDescriptor(item, key);
            if (typeof key !== 'string' || [
                '__proto__',
                'prototype',
                'constructor'
            ].includes(key) || !d.enumerable || !('value' in d) || array && !/^(0|[1-9]\d*)$/.test(key)) fail('input contains unsafe properties or accessors');
            result[key] = visit(d.value, depth + 1);
        }
        if (array && keys.length - 1 !== item.length) fail('input arrays must be dense');
        active.delete(item);
        return result;
    };
    const copied = visit(value, 0);
    if (!copied || typeof copied !== 'object' || Array.isArray(copied) || Object.keys(copied).length !== fields.length || fields.some((field)=>!Object.hasOwn(copied, field))) fail('all specified road input fields are required; extra fields are forbidden');
    if (new TextEncoder().encode(JSON.stringify(copied)).length > 1048576) fail('input exceeds 1 MiB');
    return copied;
}
export function buildAgentRoadDrawing(document, input) {
    const data = snapshot(input), state = document.snapshot();
    if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) fail('expectedRevision must be a nonnegative safe integer');
    if (document.revision !== data.expectedRevision) throw new KJRevisionConflictError(data.expectedRevision, document.revision);
    if (data.units !== 'meter' || state.header.units !== 'meter') fail('input and document must both use meter units');
    const ownerId = state.spaces.modelSpaceId, owner = state.objects[ownerId];
    if (!owner || owner.erased || owner.kind !== 'block-record' || owner.payload.isSpace !== true) fail('a valid document model space is required');
    if (!Array.isArray(data.sections) || data.sections.length < 2 || data.sections.length > 64) fail('supply 2–64 explicitly defined cross sections');
    if (data.sections.reduce((count, section)=>count + (Array.isArray(section?.ground) ? section.ground.length : 4097), 0) > 4096) fail('ground data exceeds the 4096-point agent budget');
    const { units, startStation, alignment, profile, sections, pavement, slopes, drawingId, title, profileScale, sectionScale, textHeight, sectionColumns, precision } = data;
    const designParameters = {
        input: {
            units,
            startStation,
            alignment,
            profile,
            sections,
            pavement,
            slopes
        },
        options: {
            drawingId,
            title,
            profileScale,
            sectionScale,
            textHeight,
            sectionColumns,
            precision,
            maxEntities: 512
        }
    };
    const drawing = buildRoadDrawing(designParameters.input, designParameters.options);
    if (drawing.entities.length > 512) fail('proposal exceeds the 512 entity limit');
    const prefix = `road:${drawingId}:`;
    if (Object.keys(state.objects).some((id)=>id.startsWith(prefix))) fail('drawingId already has document objects; choose a new drawingId for a new drawing');
    for (const table of [
        'linetypes',
        'layers'
    ]){
        const existing = new Set(document.getTable(table).records.map((record)=>String(record.name).toUpperCase()));
        if (drawing.resources[table].some((resource)=>Object.hasOwn(state.objects, resource.id) || existing.has(resource.name.toUpperCase()))) fail('drawing resource IDs or names already exist');
    }
    const commandArgs = {
        entities: drawing.entities.map((entity)=>({
                ...structuredClone(entity),
                options: {
                    id: entity.options.id,
                    ownerId
                }
            })),
        resources: structuredClone(drawing.resources)
    };
    const evidence = {
        drawingId,
        units,
        expectedRevision: data.expectedRevision,
        entityCount: drawing.entities.length,
        designParameters,
        calculation: drawing.calculation,
        frames: structuredClone(drawing.frames),
        bounds: [
            ...drawing.bounds
        ],
        projections: structuredClone(drawing.projections),
        limitations: drawing.limitations
    };
    if (new TextEncoder().encode(JSON.stringify(commandArgs)).length > 4194304) fail('command data exceeds 4 MiB');
    if (new TextEncoder().encode(JSON.stringify(evidence)).length > 262144) fail('calculation evidence exceeds 256 KiB');
    if (document.snapshot() !== state || document.revision !== data.expectedRevision) throw new KJRevisionConflictError(data.expectedRevision, document.revision);
    return deepFreeze({
        commandArgs,
        evidence
    });
}
