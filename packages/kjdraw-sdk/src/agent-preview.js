// Generated from agent-preview.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJCommandRegistry, registerCoreCommands } from './commands.js';
import { KJValidationError } from './errors.js';
import { canonicalStringify, deepFreeze } from './utils.js';
import { projectDimension } from './geometry/annotation.js';
import { captureAgentBlockDependencies, agentBlockDependenciesMatchDocument } from './agent-preview-blocks.js';
const project = (entity)=>({
        id: entity.id,
        type: entity.type,
        payload: entity.payload
    });
const supported = [
    'LINE',
    'CIRCLE',
    'ARC',
    'LWPOLYLINE'
];
export const KJDRAW_AGENT_MOVABLE_TYPES = Object.freeze([
    ...supported,
    'XLINE',
    'RAY',
    'TEXT',
    'DIMENSION',
    'INSERT'
]);
const creatable = [
    ...supported,
    'TEXT',
    'DIMENSION'
];
function validateMovableAnnotation(document, entity) {
    if (entity.type !== 'TEXT' && entity.type !== 'DIMENSION') return;
    const payload = entity.payload;
    for (const field of [
        'normal',
        'extrusionDirection'
    ]){
        const normal = payload[field];
        if (normal !== undefined && normal !== null && (!Array.isArray(normal) || normal.length !== 3 || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) throw new KJValidationError('Annotation move preview requires the default +Z plane');
    }
    const points = entity.type === 'TEXT' ? [
        payload.position,
        ...payload.alignmentPoint ? [
            payload.alignmentPoint
        ] : []
    ] : [
        ...Array.isArray(payload.definitionPoints) ? payload.definitionPoints : [],
        ...payload.textPosition ? [
            payload.textPosition
        ] : []
    ];
    if (!points.length || points.some((point)=>!Array.isArray(point) || point.length !== 3 || point.some((value)=>typeof value !== 'number' || !Number.isFinite(value)) || point[2] !== 0)) throw new KJValidationError('Annotation move preview requires complete model XY geometry at z=0');
    if (entity.type === 'DIMENSION' && !projectDimension(payload, document.getObject(String(payload.styleId ?? ''))?.payload)) throw new KJValidationError('Annotation move preview requires supported nondegenerate native dimension geometry');
}
export async function createAgentGeometryPreview(document, command, args, options = {}) {
    if (![
        'CREATEBATCH',
        'MOVE'
    ].includes(command)) throw new KJValidationError('This preview supports only CREATEBATCH and MOVE');
    const maxCreatedEntities = options.maxCreatedEntities ?? 64;
    if (!Number.isSafeInteger(maxCreatedEntities) || maxCreatedEntities < 1 || maxCreatedEntities > 512) throw new KJValidationError('Preview creation budget must be an integer from 1 to 512');
    if (command === 'CREATEBATCH') {
        if (!Array.isArray(args.entities) || !args.entities.length || args.entities.length > maxCreatedEntities || args.entities.some((spec)=>!spec || typeof spec !== 'object' || !creatable.includes(String(spec.type)))) throw new KJValidationError(`Preview creation requires 1–${maxCreatedEntities} LINE/CIRCLE/ARC/LWPOLYLINE/TEXT/DIMENSION entities`);
    } else {
        if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 64 || args.ids.some((id)=>!KJDRAW_AGENT_MOVABLE_TYPES.includes(document.getObject(String(id))?.type ?? ''))) throw new KJValidationError(`Preview movement requires 1–64 ${KJDRAW_AGENT_MOVABLE_TYPES.join('/')} entities`);
        for (const id of args.ids)validateMovableAnnotation(document, document.getObject(String(id)));
    }
    const source = document.snapshot(), revision = document.revision;
    if (Object.keys(source.objects).length > 250000) throw new KJValidationError('Agent preview exceeds the 250000 object document limit');
    const blockDependencies = command === 'MOVE' ? captureAgentBlockDependencies(document, args.ids) : undefined;
    const workingSet = command === 'MOVE' ? args.ids.map((id)=>document.getObject(String(id))) : args.entities;
    if (new TextEncoder().encode(JSON.stringify({
        args,
        workingSet
    })).length > 4194304) throw new KJValidationError('Agent preview working set exceeds the 4 MiB limit');
    const draft = document.fork();
    const commands = new KJCommandRegistry();
    registerCoreCommands(commands);
    await commands.execute(command, {
        document: draft,
        expectedRevision: revision
    }, args);
    if (blockDependencies && canonicalStringify(captureAgentBlockDependencies(draft, args.ids)) !== canonicalStringify(blockDependencies)) throw new KJValidationError('Block definitions or styles changed during move preview');
    if (document.revision !== revision || document.snapshot() !== source) throw new KJValidationError('Drawing changed while preparing the preview; propose again');
    const before = [], after = [];
    const old = new Map(document.listEntities().map((entity)=>[
            entity.id,
            entity
        ]));
    for (const entity of draft.listEntities()){
        const previous = old.get(entity.id);
        if (!previous || canonicalStringify(project(previous)) !== canonicalStringify(project(entity))) {
            if (previous) before.push(project(previous));
            if (command === 'MOVE') validateMovableAnnotation(draft, entity);
            after.push(project(entity));
        }
        old.delete(entity.id);
    }
    for (const entity of old.values())before.push(project(entity));
    if (before.length > 64 || after.length > (command === 'CREATEBATCH' ? maxCreatedEntities : 64)) throw new KJValidationError('Preview exceeds the changed-entity limit');
    const resources = draft.listObjects({
        kind: 'table-record'
    }).filter((item)=>!document.getObject(item.id)).map((item)=>({
            id: item.id,
            type: item.type,
            name: item.name,
            payload: item.payload
        }));
    if (resources.length > 32) throw new KJValidationError('Preview exceeds the 32 new resource limit');
    const preview = {
        documentId: document.id,
        revision,
        command,
        before,
        after,
        ...resources.length ? {
            resources
        } : {},
        ...blockDependencies ? {
            blockDependencies
        } : {}
    };
    if (new TextEncoder().encode(JSON.stringify(preview)).length > 262144) throw new KJValidationError('Agent geometry preview exceeds the 256 KiB output limit');
    return deepFreeze(preview);
}
export function agentPreviewMatchesDocument(document, preview) {
    const retained = new Set(preview.after.map((entity)=>entity.id));
    return document.id === preview.documentId && agentBlockDependenciesMatchDocument(document, preview.blockDependencies) && (preview.resources ?? []).every((expected)=>{
        const actual = document.getObject(expected.id);
        return actual?.kind === 'table-record' && actual.type === expected.type && actual.name === expected.name && canonicalStringify(actual.payload) === canonicalStringify(expected.payload);
    }) && preview.after.every((expected)=>{
        const actual = document.getObject(expected.id);
        return actual?.kind === 'entity' && canonicalStringify(project(actual)) === canonicalStringify(expected);
    }) && preview.before.every((previous)=>retained.has(previous.id) || !document.getObject(previous.id));
}
