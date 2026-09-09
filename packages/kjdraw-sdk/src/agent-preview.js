// Generated from agent-preview.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJCommandRegistry, registerCoreCommands } from './commands.js';
import { KJDocument } from './document.js';
import { KJValidationError } from './errors.js';
import { canonicalStringify, deepFreeze } from './utils.js';
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
export async function createAgentGeometryPreview(document, command, args) {
    if (![
        'CREATEBATCH',
        'MOVE'
    ].includes(command)) throw new KJValidationError('This preview supports only CREATEBATCH and MOVE');
    if (command === 'CREATEBATCH') {
        if (!Array.isArray(args.entities) || !args.entities.length || args.entities.length > 64 || args.entities.some((spec)=>!spec || typeof spec !== 'object' || !supported.includes(String(spec.type)))) throw new KJValidationError('Preview creation requires 1–64 LINE/CIRCLE/ARC/LWPOLYLINE entities');
    } else if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 64 || args.ids.some((id)=>!supported.includes(document.getObject(String(id))?.type ?? ''))) throw new KJValidationError('Preview movement requires 1–64 LINE/CIRCLE/ARC/LWPOLYLINE entities');
    const source = document.serialize(), revision = document.revision;
    if (new TextEncoder().encode(source).length > 4194304) throw new KJValidationError('Agent preview document exceeds the 4 MiB source limit');
    const draft = KJDocument.open(source);
    const commands = new KJCommandRegistry();
    registerCoreCommands(commands);
    await commands.execute(command, {
        document: draft,
        expectedRevision: revision
    }, args);
    if (document.revision !== revision || document.serialize() !== source) throw new KJValidationError('Drawing changed while preparing the preview; propose again');
    const before = [], after = [];
    const old = new Map(document.listEntities().map((entity)=>[
            entity.id,
            entity
        ]));
    for (const entity of draft.listEntities()){
        const previous = old.get(entity.id);
        if (!previous || canonicalStringify(project(previous)) !== canonicalStringify(project(entity))) {
            if (previous) before.push(project(previous));
            after.push(project(entity));
        }
        old.delete(entity.id);
    }
    for (const entity of old.values())before.push(project(entity));
    if (before.length > 64 || after.length > 64) throw new KJValidationError('Preview exceeds the changed-entity limit');
    const preview = {
        documentId: document.id,
        revision,
        command,
        before,
        after
    };
    if (new TextEncoder().encode(JSON.stringify(preview)).length > 262144) throw new KJValidationError('Agent geometry preview exceeds the 256 KiB output limit');
    return deepFreeze(preview);
}
export function agentPreviewMatchesDocument(document, preview) {
    const retained = new Set(preview.after.map((entity)=>entity.id));
    return document.id === preview.documentId && preview.after.every((expected)=>{
        const actual = document.getObject(expected.id);
        return actual?.kind === 'entity' && canonicalStringify(project(actual)) === canonicalStringify(expected);
    }) && preview.before.every((previous)=>retained.has(previous.id) || !document.getObject(previous.id));
}
