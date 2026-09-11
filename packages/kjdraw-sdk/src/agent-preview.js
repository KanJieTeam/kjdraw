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
function validateTransformGeometry(document, entity) {
    const payload = entity.payload;
    const bounded = (value)=>typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12;
    const point = (value)=>Array.isArray(value) && value.length === 3 && value.every(bounded) && value[2] === 0;
    for (const key of [
        'normal',
        'extrusionDirection'
    ]){
        const normal = payload[key];
        if (normal != null && (!Array.isArray(normal) || normal.length !== 3 || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) throw new KJValidationError('Transform preview requires default +Z geometry');
    }
    for (const key of [
        'elevation',
        'thickness'
    ])if (payload[key] != null && payload[key] !== 0) throw new KJValidationError('Transform preview does not support elevation or thickness');
    let points = [];
    if (entity.type === 'LINE') points = [
        payload.start,
        payload.end
    ];
    else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
        points = [
            payload.center
        ];
        if (!bounded(payload.radius) || payload.radius <= 1e-12) throw new KJValidationError('Transform preview requires a bounded nondegenerate radius');
        if (entity.type === 'ARC' && (!bounded(payload.startAngle) || !bounded(payload.endAngle))) throw new KJValidationError('Transform preview requires finite arc angles');
    } else if (entity.type === 'XLINE' || entity.type === 'RAY') {
        points = [
            payload.origin,
            payload.direction
        ];
        if (!Array.isArray(payload.direction) || Math.hypot(Number(payload.direction[0]), Number(payload.direction[1])) <= 1e-12) throw new KJValidationError('Transform preview requires a nonzero XY guide direction');
    } else if (entity.type === 'TEXT' || entity.type === 'INSERT') {
        points = [
            payload.position,
            ...payload.alignmentPoint ? [
                payload.alignmentPoint
            ] : []
        ];
        if (!bounded(payload.rotation)) throw new KJValidationError('Transform preview requires finite rotation');
        if (entity.type === 'TEXT' && (typeof payload.text !== 'string' || !payload.text.trim() || !bounded(payload.height) || payload.height <= 1e-12)) throw new KJValidationError('Transform preview requires visible bounded text');
    } else if (entity.type === 'DIMENSION') {
        points = [
            ...Array.isArray(payload.definitionPoints) ? payload.definitionPoints : [],
            ...payload.textPosition ? [
                payload.textPosition
            ] : []
        ];
        validateMovableAnnotation(document, entity);
        const projection = projectDimension(payload, document.getObject(String(payload.styleId ?? ''))?.payload);
        const visiblePoints = [
            ...projection.lines.flat(),
            ...projection.arrows.flat(),
            projection.label.position,
            ...projection.arcs.map((arc)=>arc.center)
        ];
        if (!visiblePoints.every((p)=>p.every(bounded)) || !bounded(projection.measurement) || !bounded(projection.label.height) || projection.arcs.some((arc)=>!bounded(arc.radius))) throw new KJValidationError('Transform annotation projection exceeds its finite coordinate budget');
    } else if (entity.type === 'LWPOLYLINE') {
        for (const key of [
            'constantWidth',
            'width',
            'defaultStartWidth',
            'defaultEndWidth'
        ])if (payload[key] != null && payload[key] !== 0) throw new KJValidationError('Transform preview does not support wide polylines');
        if (!Array.isArray(payload.vertices) || payload.vertices.length < 2 || payload.vertices.length > 4096) throw new KJValidationError('Transform preview requires 2–4096 polyline vertices');
        points = payload.vertices.map((vertex)=>{
            const record = vertex;
            if (record.startWidth && record.startWidth !== 0 || record.endWidth && record.endWidth !== 0) throw new KJValidationError('Transform preview does not support wide polylines');
            if (record.bulge != null && !bounded(record.bulge)) throw new KJValidationError('Transform preview requires bounded bulges');
            return record.point;
        });
    }
    if (!points.length || !points.every(point)) throw new KJValidationError('Transform preview requires complete finite XY geometry at z=0 within ±1e12');
    if ((entity.type === 'LINE' || entity.type === 'LWPOLYLINE') && points.every((value)=>canonicalStringify(value) === canonicalStringify(points[0]))) throw new KJValidationError('Transform preview requires nondegenerate geometry');
}
function validateTransformArguments(command, args) {
    const keys = command === 'ROTATE' ? [
        'ids',
        'center',
        'angleDegrees'
    ] : [
        'ids',
        'center',
        'factor'
    ];
    if (Object.keys(args).some((key)=>!keys.includes(key))) throw new KJValidationError('Unexpected transform preview argument');
    if (!Array.isArray(args.center) || args.center.length !== 2 || args.center.some((value)=>typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12)) throw new KJValidationError('Transform preview requires an explicit bounded XY center');
    if (command === 'ROTATE') {
        if (typeof args.angleDegrees !== 'number' || !Number.isFinite(args.angleDegrees) || args.angleDegrees === 0 || Math.abs(args.angleDegrees) >= 360) throw new KJValidationError('Rotation must be nonzero degrees strictly between -360 and 360');
    } else if (typeof args.factor !== 'number' || !Number.isFinite(args.factor) || args.factor < 1e-6 || args.factor > 1e6 || args.factor === 1) throw new KJValidationError('Scale must be positive and between 0.000001 and 1000000, excluding 1');
}
export async function createAgentGeometryPreview(document, command, args, options = {}) {
    if (![
        'CREATEBATCH',
        'MOVE',
        'ROTATE',
        'SCALE'
    ].includes(command)) throw new KJValidationError('This preview supports only CREATEBATCH, MOVE, ROTATE and SCALE');
    const affine = command === 'ROTATE' || command === 'SCALE';
    if (affine) validateTransformArguments(command, args);
    const maxCreatedEntities = options.maxCreatedEntities ?? 64;
    if (!Number.isSafeInteger(maxCreatedEntities) || maxCreatedEntities < 1 || maxCreatedEntities > 512) throw new KJValidationError('Preview creation budget must be an integer from 1 to 512');
    if (command === 'CREATEBATCH') {
        if (!Array.isArray(args.entities) || !args.entities.length || args.entities.length > maxCreatedEntities || args.entities.some((spec)=>!spec || typeof spec !== 'object' || !creatable.includes(String(spec.type)))) throw new KJValidationError(`Preview creation requires 1–${maxCreatedEntities} LINE/CIRCLE/ARC/LWPOLYLINE/TEXT/DIMENSION entities`);
    } else {
        if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 64 || args.ids.some((id)=>!KJDRAW_AGENT_MOVABLE_TYPES.includes(document.getObject(String(id))?.type ?? ''))) throw new KJValidationError(`Preview movement requires 1–64 ${KJDRAW_AGENT_MOVABLE_TYPES.join('/')} entities`);
        for (const id of args.ids)validateMovableAnnotation(document, document.getObject(String(id)));
        if (affine) {
            if (args.ids.some((id)=>typeof id !== 'string') || new Set(args.ids).size !== args.ids.length) throw new KJValidationError('Object IDs must be unique strings');
            for (const id of args.ids){
                const entity = document.getObject(String(id));
                const layer = document.getObject(String(entity.payload.layerId ?? ''));
                if (entity.ownerId !== document.snapshot().spaces.modelSpaceId || entity.payload.visible === false || entity.payload.locked === true || entity.payload.frozen === true || layer?.payload.visible === false || layer?.payload.locked === true || layer?.payload.frozen === true) throw new KJValidationError('Transform preview requires visible editable model-space entities');
                validateTransformGeometry(document, entity);
            }
        }
    }
    const source = document.snapshot(), revision = document.revision;
    if (Object.keys(source.objects).length > 250000) throw new KJValidationError('Agent preview exceeds the 250000 object document limit');
    const blockDependencies = command !== 'CREATEBATCH' ? captureAgentBlockDependencies(document, args.ids) : undefined;
    const workingSet = command !== 'CREATEBATCH' ? args.ids.map((id)=>document.getObject(String(id))) : args.entities;
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
    if (blockDependencies && canonicalStringify(captureAgentBlockDependencies(draft, args.ids)) !== canonicalStringify(blockDependencies)) throw new KJValidationError('Block definitions or styles changed during transform preview');
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
            if (affine) validateTransformGeometry(draft, entity);
            after.push(project(entity));
        }
        old.delete(entity.id);
    }
    for (const entity of old.values())before.push(project(entity));
    if (affine && !after.length) throw new KJValidationError('Transform would leave the selected geometry unchanged');
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
