// Generated from agent-preview-blocks.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { canonicalStringify, deepFreeze } from './utils.js';
import { projectDimension } from './geometry/annotation.js';
import { multiply3, rotation3, scale3, translation3, transformPoint3 } from './geometry/matrix3.js';
import { transformEntityPayload } from './geometry/transform.js';
const MAX_DEPTH = 8, MAX_INSTANCES = 512, MAX_DEPENDENCIES = 1024, MAX_BYTES = 131072;
const supported = new Set([
    'LINE',
    'CIRCLE',
    'ARC',
    'LWPOLYLINE',
    'TEXT',
    'DIMENSION',
    'INSERT'
]);
function fail(message) {
    throw new KJValidationError(`Block move preview: ${message}`);
}
const project = (object)=>({
        id: object.id,
        kind: object.kind,
        type: object.type,
        ownerId: object.ownerId,
        name: object.name,
        payload: object.payload
    });
const xy = (point)=>Array.isArray(point) && point.length === 3 && point.every((n)=>typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e12) && point[2] === 0;
function plane(payload) {
    if (payload.mirrored === true) fail('mirrored block geometry is not supported');
    for (const key of [
        'normal',
        'extrusionDirection'
    ]){
        const normal = payload[key];
        if (normal != null && (!Array.isArray(normal) || normal.length !== 3 || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) fail('only default +Z block geometry is supported');
    }
    for (const key of [
        'elevation',
        'thickness'
    ])if (payload[key] != null && payload[key] !== 0) fail('nonzero elevation or thickness is not supported');
}
export function captureAgentBlockDependencies(document, ids) {
    const roots = ids.map((id)=>document.getObject(id)).filter((entity)=>entity?.type === 'INSERT');
    if (!roots.length) return undefined;
    const dependencies = new Map();
    const blockChildren = new Map();
    let instances = 0, bytes = 2, nodes = 0;
    const byteGuard = (value, depth = 0)=>{
        if (++nodes > 32768 || depth > 32) fail('dependency structure exceeds its budget');
        if (typeof value === 'string') {
            if (value.length > MAX_BYTES) fail('dependency exceeds 128 KiB');
        } else if (Array.isArray(value)) {
            if (value.length > 32768) fail('dependency array exceeds its budget');
            for (const child of value)byteGuard(child, depth + 1);
        } else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)){
            byteGuard(key, depth + 1);
            byteGuard(child, depth + 1);
        }
    };
    const add = (object)=>{
        if (dependencies.has(object.id)) return;
        if (dependencies.size >= MAX_DEPENDENCIES) fail('more than 1024 dependency records');
        const record = project(object);
        byteGuard(record);
        const serialized = JSON.stringify(record);
        bytes += new TextEncoder().encode(serialized).length + 1;
        if (bytes > MAX_BYTES) fail('dependency snapshot exceeds 128 KiB');
        dependencies.set(object.id, JSON.parse(serialized));
    };
    const resource = (id, type)=>{
        if (id == null || id === '') return null;
        if (typeof id !== 'string') return fail('invalid resource reference');
        const object = document.getObject(id);
        if (!object || object.kind !== 'table-record' || object.type !== type) return fail(`missing ${type} resource`);
        add(object);
        return object;
    };
    const linetype = (payload)=>{
        if (payload.linetypeId) resource(payload.linetypeId, 'LINETYPE');
        else if (typeof payload.linetypeName === 'string' && ![
            'BYLAYER',
            'BYBLOCK',
            'CONTINUOUS'
        ].includes(payload.linetypeName.toUpperCase())) {
            const record = document.getTable('linetypes')?.records.find((item)=>item.name?.toUpperCase() === payload.linetypeName.toUpperCase());
            if (!record) fail('missing named linetype');
            add(record);
        }
    };
    const visible = (object)=>{
        if (object.payload.visible === false || object.payload.frozen === true || object.payload.locked === true) fail('hidden, frozen or locked block geometry is not supported');
        const layer = resource(object.payload.layerId, 'LAYER');
        if (layer) {
            if (layer.payload.visible === false || layer.payload.frozen === true || layer.payload.locked === true) fail('hidden, frozen or locked block layers are not supported');
            linetype(layer.payload);
        }
        linetype(object.payload);
        if (object.type === 'TEXT') resource(object.payload.styleId, 'TEXT_STYLE');
        if (object.type === 'DIMENSION') resource(object.payload.styleId, 'DIM_STYLE');
    };
    const geometry = (type, payload)=>{
        plane(payload);
        let points = [];
        if (type === 'LINE') points = [
            payload.start,
            payload.end
        ];
        else if (type === 'CIRCLE' || type === 'ARC') {
            points = [
                payload.center
            ];
            if (typeof payload.radius !== 'number' || !Number.isFinite(payload.radius) || payload.radius <= 0 || payload.radius > 1e12) fail('invalid or oversized circle or arc');
        } else if (type === 'TEXT') {
            if (typeof payload.text !== 'string' || !payload.text.trim()) fail('empty text does not provide visible block geometry');
            if (typeof payload.height !== 'number' || !Number.isFinite(payload.height) || payload.height <= 0 || payload.height > 1e12) fail('invalid or oversized text height');
            points = [
                payload.position,
                ...payload.alignmentPoint ? [
                    payload.alignmentPoint
                ] : []
            ];
        } else if (type === 'DIMENSION') {
            points = [
                ...Array.isArray(payload.definitionPoints) ? payload.definitionPoints : [],
                ...payload.textPosition ? [
                    payload.textPosition
                ] : []
            ];
            if (!projectDimension(payload, document.getObject(String(payload.styleId ?? ''))?.payload)) fail('unsupported or degenerate dimension');
        } else if (type === 'LWPOLYLINE') {
            for (const key of [
                'constantWidth',
                'width',
                'defaultStartWidth',
                'defaultEndWidth'
            ])if (payload[key] != null && payload[key] !== 0) fail('wide polyline preview is not supported');
            const vertices = payload.vertices;
            if (!Array.isArray(vertices) || vertices.length < 2 || vertices.length > 4096) fail('invalid or oversized polyline');
            points = vertices.map((vertex)=>{
                if (vertex.startWidth && vertex.startWidth !== 0 || vertex.endWidth && vertex.endWidth !== 0) fail('wide polyline preview is not supported');
                return vertex.point;
            });
        }
        if (!points.length || !points.every(xy)) fail('complete finite model-XY geometry at z=0 is required');
        if ((type === 'LINE' || type === 'LWPOLYLINE') && points.every((point)=>canonicalStringify(point) === canonicalStringify(points[0]))) fail('degenerate block geometry cannot be previewed');
    };
    const dimensionInView = (entity, matrix)=>{
        geometry('DIMENSION', entity.payload);
        const projection = projectDimension(entity.payload, document.getObject(String(entity.payload.styleId ?? ''))?.payload);
        const bounded = (value)=>Number.isFinite(value) && Math.abs(value) <= 1e12;
        const scale = Math.hypot(matrix[0], matrix[1]);
        const points = [
            ...projection.lines.flat(),
            ...projection.arrows.flat(),
            projection.label.position
        ];
        if (!bounded(projection.measurement) || !bounded(projection.label.height * scale) || projection.label.height * scale <= 0 || !bounded(projection.label.rotation)) fail('dimension display exceeds the finite geometry budget');
        for (const point of points)if (!transformPoint3(matrix, point).every((value)=>typeof value === 'number' && bounded(value))) fail('dimension display exceeds the finite geometry budget');
        for (const arc of projection.arcs){
            const center = transformPoint3(matrix, arc.center), radius = arc.radius * scale;
            if (!bounded(radius) || radius <= 0 || !bounded(arc.startAngle) || !bounded(arc.endAngle) || ![
                center[0] - radius,
                center[0] + radius,
                center[1] - radius,
                center[1] + radius
            ].every(bounded)) fail('dimension arc display exceeds the finite geometry budget');
        }
    };
    const visit = (entity, path, depth, inheritedMatrix)=>{
        if (++instances > MAX_INSTANCES) fail('expanded block graph exceeds 512 instances');
        if (!supported.has(entity.type)) fail(`unsupported block entity ${entity.type}`);
        visible(entity);
        if (entity.type !== 'INSERT') {
            if (entity.type === 'DIMENSION' && inheritedMatrix) dimensionInView(entity, inheritedMatrix);
            else geometry(entity.type, inheritedMatrix ? transformEntityPayload(entity.type, entity.payload, inheritedMatrix) : entity.payload);
            return;
        }
        if (depth >= MAX_DEPTH) fail('block nesting exceeds 8 levels');
        const rendered = entity.payload;
        plane(rendered);
        if (!xy(rendered.position)) fail('INSERT position must be model XY at z=0');
        const scale = rendered.scale;
        if (!Array.isArray(scale) || scale.length !== 3 || scale.some((n)=>typeof n !== 'number' || !Number.isFinite(n) || n <= 0) || scale[0] !== scale[1]) fail('only positive uniform XY INSERT scales are supported');
        if (typeof rendered.rotation !== 'number' || !Number.isFinite(rendered.rotation)) fail('invalid INSERT rotation');
        if (rendered.attributes && (typeof rendered.attributes !== 'object' || Array.isArray(rendered.attributes) || Object.keys(rendered.attributes).length)) fail('attribute-bearing INSERTs need a separate complete preview');
        const block = document.getObject(String(rendered.blockRecordId ?? ''));
        if (!block || block.kind !== 'block-record' || block.payload.isSpace || block.payload.importedPlaceholder) fail('a complete local block definition is required');
        if (path.has(block.id)) fail('cyclic block references are not supported');
        const flags = block.payload.dxfFlags ?? 0;
        if (!Number.isSafeInteger(flags) || Number(flags) < 0 || (Number(flags) & 124) !== 0 || block.name?.includes('|') || [
            'xref',
            'xrefPath',
            'externalReference',
            'externalReferenceId',
            'externalPath'
        ].some((key)=>Boolean(block.payload[key]) || Boolean(entity.payload[key]))) fail('external-reference blocks are not supported');
        visible(block);
        const base = block.payload.basePoint ?? [
            0,
            0,
            0
        ];
        if (!xy(base)) fail('block base point must be model XY at z=0');
        add(block);
        const children = blockChildren.get(block.id) ?? document.listEntities({
            ownerId: block.id
        });
        blockChildren.set(block.id, children);
        if (!children.length) fail('empty block cannot supply a complete visual preview');
        const basePoint = base, position = rendered.position;
        const localMatrix = multiply3(translation3(position[0], position[1]), multiply3(rotation3(rendered.rotation), multiply3(scale3(scale[0], scale[1]), translation3(-basePoint[0], -basePoint[1]))));
        const matrix = inheritedMatrix ? multiply3(inheritedMatrix, localMatrix) : localMatrix;
        if (!matrix.every(Number.isFinite) || inheritedMatrix && !xy(transformPoint3(inheritedMatrix, position))) fail('block transform exceeds the finite geometry budget');
        const nextPath = new Set(path);
        nextPath.add(block.id);
        for (const child of children){
            add(child);
            visit(child, nextPath, depth + 1, matrix);
        }
    };
    for (const root of roots)visit(root, new Set(), 0);
    return deepFreeze([
        ...dependencies.values()
    ]);
}
export function agentBlockDependenciesMatchDocument(document, expected = []) {
    return expected.every((item)=>{
        const current = document.getObject(item.id);
        return current !== null && canonicalStringify(project(current)) === canonicalStringify(item);
    });
}
