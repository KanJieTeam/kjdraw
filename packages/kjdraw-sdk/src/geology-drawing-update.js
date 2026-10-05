// Generated from geology-drawing-update.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { createCommandEditScope } from './edit-policy.js';
import { compileGeologyColumn, compileGeologySection } from './geology-engineering.js';
import { createObjectRecord } from './schema.js';
import { normalizeStandardEntityPayload } from './standard-entities.js';
import { canonicalStringify, deepFreeze, stableHash } from './utils.js';
function fail(message) {
    throw new KJValidationError(`Geology drawing update: ${message}`);
}
const equal = (a, b)=>canonicalStringify(a) === canonicalStringify(b);
const recipeKey = (id)=>`geology-drawing-recipe:${id}`;
function snapshot(input) {
    let nodes = 0, characters = 0;
    const path = new Set();
    const visit = (value, depth)=>{
        if (++nodes > 150000 || depth > 32) fail('source data budget exceeded');
        if (value === null || typeof value === 'boolean') return;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) fail('nonfinite source value');
            return;
        }
        if (typeof value === 'string') {
            if ((characters += value.length) > 2000000) fail('source text budget exceeded');
            return;
        }
        if (!value || typeof value !== 'object' || path.has(value)) fail('source must be finite acyclic plain data');
        if (Array.isArray(value)) {
            if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) fail('source arrays must be dense plain data');
        } else if (![
            Object.prototype,
            null
        ].includes(Object.getPrototypeOf(value))) fail('source must be plain data');
        path.add(value);
        for (const key of Reflect.ownKeys(value)){
            if (Array.isArray(value) && key === 'length') continue;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (typeof key !== 'string' || [
                '__proto__',
                'constructor',
                'prototype'
            ].includes(key) || !descriptor.enumerable || !('value' in descriptor)) fail('accessors and non-data properties are forbidden');
            if (Array.isArray(value) && (String(Number(key)) !== key || !Number.isSafeInteger(Number(key)) || Number(key) < 0 || Number(key) >= value.length)) fail('source arrays must contain indexed data only');
            visit(descriptor.value, depth + 1);
        }
        path.delete(value);
    };
    visit(input, 0);
    return structuredClone(input);
}
function compile(source) {
    if (!source || !equal(Object.keys(source).sort(), [
        'input',
        'kind'
    ])) fail('source requires kind and input only');
    if (source.kind === 'column') return compileGeologyColumn(source.input);
    if (source.kind === 'section') return compileGeologySection(source.input);
    return fail('only explicit column or section source facts are supported');
}
function remap(value, root, target) {
    if (typeof value === 'string') return value.startsWith(`${root}-`) ? target + value.slice(root.length) : value;
    if (Array.isArray(value)) return value.map((item)=>remap(item, root, target));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item])=>[
            key,
            remap(item, root, target)
        ]));
    return value;
}
function records(document, result, root, textStyleId, entityIds) {
    if (result.commandArgs.entities.length > 8192 || entityIds.length !== result.commandArgs.entities.length || new Set(entityIds).size !== entityIds.length) fail('invalid generated entity identity map');
    const resources = result.commandArgs.resources;
    const sourceRoot = result.evidence.rootObjectId;
    const resourceRecords = [];
    for (const type of resources.linetypes)resourceRecords.push(createObjectRecord({
        id: String(remap(type.id, sourceRoot, root)),
        kind: 'table-record',
        type: 'LINETYPE',
        name: `GEO_${stableHash(root).toUpperCase()}_CONT`,
        payload: {
            description: '',
            pattern: [
                ...type.pattern
            ],
            totalPatternLength: type.pattern.reduce((sum, item)=>sum + Math.abs(item), 0),
            dxfFlags: 0
        }
    }));
    for (const layer of resources.layers){
        const id = String(remap(layer.id, sourceRoot, root)), linetypeId = String(remap(layer.linetypeId, sourceRoot, root));
        resourceRecords.push(createObjectRecord({
            id,
            kind: 'table-record',
            type: 'LAYER',
            name: layer.name,
            payload: {
                color: layer.color,
                linetypeId,
                linetypeName: resourceRecords.find((item)=>item.id === linetypeId).name,
                lineweight: layer.lineweight,
                visible: true,
                frozen: false,
                locked: false,
                plottable: true
            }
        }));
    }
    for (const style of resources.textStyles ?? [])resourceRecords.push(createObjectRecord({
        id: String(remap(style.id, sourceRoot, root)),
        kind: 'table-record',
        type: 'TEXT_STYLE',
        name: style.name,
        payload: structuredClone(style.payload)
    }));
    const entities = result.commandArgs.entities.map((spec, index)=>{
        const payload = structuredClone(spec.payload);
        for (const key of [
            'layerId',
            'linetypeId',
            'styleId'
        ])if (typeof payload[key] === 'string') payload[key] = remap(payload[key], sourceRoot, root);
        if ([
            'TEXT',
            'MTEXT'
        ].includes(spec.type) && payload.styleId === undefined) payload.styleId = textStyleId;
        return createObjectRecord({
            id: entityIds[index],
            kind: 'entity',
            type: spec.type,
            ownerId: document.spaces.modelSpaceId,
            payload: normalizeStandardEntityPayload(spec.type, payload)
        });
    });
    return {
        entities,
        resources: resourceRecords
    };
}
function sameRecord(a, b) {
    return !!a && typeof a === 'object' && equal({
        ...a,
        handle: ''
    }, b);
}
function expectedRecipeRecords(document, recipe) {
    const keys = [
        'schema',
        'version',
        'compilerVersion',
        'documentId',
        'drawingId',
        'source',
        'entityIds',
        'resourceRoot',
        'textStyleId'
    ];
    if (!equal(Object.keys(recipe).sort(), keys.sort()) || recipe.schema !== 'com.kanjie.kjdraw.geology-drawing-recipe' || recipe.version !== 1 || recipe.compilerVersion !== 1) fail('unsupported recipe format');
    if (recipe.documentId !== document.id || document.snapshot().header.units !== 'millimeter') fail('recipe document or units do not match');
    const textStyle = document.getObject(recipe.textStyleId);
    if (!/^geo-[a-zA-Z0-9_-]{1,100}$/.test(recipe.drawingId) || recipe.resourceRoot !== recipe.drawingId || !textStyle || textStyle.erased || textStyle.kind !== 'table-record' || textStyle.type !== 'TEXT_STYLE' || !document.snapshot().tables.textStyles.recordIds.includes(recipe.textStyleId)) fail('invalid recipe identity or text style');
    if (!Array.isArray(recipe.entityIds) || recipe.entityIds.some((id)=>typeof id !== 'string' || !id.startsWith(`${recipe.drawingId}-entity-`) || id.length > 200)) fail('invalid recipe entity IDs');
    const compiled = compile(recipe.source);
    const expected = records(document, compiled, recipe.resourceRoot, recipe.textStyleId, recipe.entityIds);
    const state = document.snapshot(), model = new Set(state.objects[document.spaces.modelSpaceId].payload.entityIds);
    return {
        expected,
        state,
        model
    };
}
function validateRecipe(document, recipe) {
    const { expected, state, model } = expectedRecipeRecords(document, recipe);
    for (const record of expected.resources){
        const table = record.type === 'LAYER' ? state.tables.layers : record.type === 'LINETYPE' ? state.tables.linetypes : state.tables.textStyles;
        if (!table.recordIds.includes(record.id) || !sameRecord(document.getObject(record.id), record)) fail(`generated resource changed: ${record.id}`);
    }
    for (const entity of expected.entities)if (!model.has(entity.id) || !sameRecord(document.getObject(entity.id), entity)) fail(`generated object changed: ${entity.id}; reconcile manual edits before rebuilding`);
    return expected;
}
export function createGeologyDrawingRecipe(document, source) {
    const input = snapshot(source), compiled = compile(input), root = compiled.evidence.rootObjectId;
    const textStyleId = document.getTable('textStyles')?.currentId;
    if (!textStyleId) fail('current text style is missing');
    const recipe = {
        schema: 'com.kanjie.kjdraw.geology-drawing-recipe',
        version: 1,
        compilerVersion: 1,
        documentId: document.id,
        drawingId: root,
        resourceRoot: root,
        textStyleId,
        source: input,
        entityIds: compiled.commandArgs.entities.map((spec)=>spec.options.id)
    };
    validateRecipe(document, recipe);
    return deepFreeze(recipe);
}
export async function registerGeologyDrawingRecipe(document, source, options) {
    const safeOptions = snapshot(options);
    if (!equal(Object.keys(safeOptions), [
        'expectedRevision'
    ]) || !Number.isSafeInteger(safeOptions.expectedRevision) || safeOptions.expectedRevision < 0) fail('registration requires an explicit nonnegative expectedRevision');
    const recipe = createGeologyDrawingRecipe(document, source);
    await document.transact('Register geology source facts', (tx)=>{
        if (Object.hasOwn(document.snapshot().opaquePayloads, recipeKey(recipe.drawingId))) fail('source recipe is already registered');
        tx.putOpaquePayload(recipeKey(recipe.drawingId), recipe);
    }, {
        expectedRevision: safeOptions.expectedRevision,
        source: 'geology-source-registration'
    });
    return recipe;
}
export function readGeologyDrawingRecipe(document, drawingId) {
    const recipe = snapshot(document.snapshot().opaquePayloads[recipeKey(drawingId)]);
    if (!recipe) fail('no source-backed geology recipe; do not infer borehole facts from CAD text');
    if (recipe.drawingId !== drawingId) fail('recipe key and drawing identity do not match');
    validateRecipe(document, recipe);
    return deepFreeze(recipe);
}
export function inspectGeologyDrawingRecipe(document, drawingId, options) {
    const safeOptions = snapshot(options);
    if (!equal(Object.keys(safeOptions), [
        'expectedRevision'
    ]) || !Number.isSafeInteger(safeOptions.expectedRevision) || safeOptions.expectedRevision !== document.revision) fail('stale or invalid expected revision');
    const retained = document.snapshot().opaquePayloads[recipeKey(drawingId)];
    if (!retained) fail('no source-backed geology recipe; do not infer borehole facts from CAD text');
    const recipe = snapshot(retained);
    if (recipe.drawingId !== drawingId) fail('recipe key and drawing identity do not match');
    const { expected, state, model } = expectedRecipeRecords(document, recipe);
    const conflicts = [];
    const conflictTypes = [];
    const addConflict = (kind, record, reason)=>{
        conflicts.push({
            kind,
            id: record.id,
            reason
        });
        const actual = state.objects[record.id];
        conflictTypes.push({
            id: record.id,
            generatedType: record.type,
            actualType: actual && !actual.erased ? actual.type : null
        });
    };
    for (const record of expected.resources){
        const table = record.type === 'LAYER' ? state.tables.layers : record.type === 'LINETYPE' ? state.tables.linetypes : state.tables.textStyles;
        const actual = document.getObject(record.id);
        if (!actual) addConflict('resource', record, 'missing');
        else if (!table.recordIds.includes(record.id)) addConflict('resource', record, 'owner-membership');
        else if (!sameRecord(actual, record)) addConflict('resource', record, 'record-changed');
    }
    for (const record of expected.entities){
        const actual = document.getObject(record.id);
        if (!actual) addConflict('entity', record, 'missing');
        else if (!model.has(record.id)) addConflict('entity', record, 'owner-membership');
        else if (!sameRecord(actual, record)) addConflict('entity', record, 'record-changed');
    }
    return deepFreeze({
        documentId: document.id,
        revision: document.revision,
        drawingId,
        recipe,
        sourceGeometryConsistent: conflicts.length === 0,
        conflicts,
        conflictTypes
    });
}
export function prepareGeologyDrawingRevision(document, previous, next, options) {
    const safe = snapshot({
        previous,
        next,
        options
    });
    if (!equal(Object.keys(safe.options), [
        'expectedRevision'
    ]) || !Number.isSafeInteger(safe.options.expectedRevision) || safe.options.expectedRevision !== document.revision) fail('stale or invalid expected revision');
    const recipe = safe.previous;
    if (safe.next.kind !== recipe.source.kind) fail('drawing kind cannot change');
    if (equal(recipe.source, safe.next)) fail('source facts have not changed');
    const before = validateRecipe(document, recipe), compiled = compile(safe.next);
    const temporaryIds = compiled.commandArgs.entities.map((_, index)=>`${recipe.drawingId}-entity-r${document.revision + 1}-${index}`);
    const after = records(document, compiled, recipe.resourceRoot, recipe.textStyleId, temporaryIds);
    if (!equal(before.resources, after.resources)) fail('resource style changes require a separate explicit workflow');
    const available = new Map();
    const signature = (record)=>canonicalStringify({
            type: record.type,
            payload: record.payload
        });
    for (const entity of before.entities){
        const key = signature(entity), bucket = available.get(key) ?? [];
        bucket.push(entity);
        available.set(key, bucket);
    }
    const unchangedIds = [], createdIds = [], retained = new Set();
    for (const entity of after.entities){
        const match = available.get(signature(entity))?.shift();
        if (match) {
            entity.id = match.id;
            unchangedIds.push(match.id);
            retained.add(match.id);
        } else {
            if (document.getObject(entity.id)) fail(`new generated ID collision: ${entity.id}`);
            createdIds.push(entity.id);
        }
    }
    const removedIds = before.entities.filter((item)=>!retained.has(item.id)).map((item)=>item.id);
    if (!removedIds.length && !createdIds.length) fail('source change does not alter supported drawing output');
    const removed = new Set(removedIds), owned = new Set(recipe.entityIds);
    const refers = (value)=>typeof value === 'string' ? removed.has(value) : !!value && typeof value === 'object' && Object.values(value).some(refers);
    for (const object of document.listObjects()){
        if (owned.has(object.id)) continue;
        const payload = object.id === document.spaces.modelSpaceId ? Object.fromEntries(Object.entries(object.payload).filter(([key])=>key !== 'entityIds')) : object.payload;
        if (refers([
            object.ownerId,
            payload,
            object.extension,
            object.source
        ])) fail(`external object refers to changed geometry: ${object.id}`);
    }
    for (const [key, value] of Object.entries(document.snapshot().opaquePayloads))if (key !== recipeKey(recipe.drawingId) && refers(value)) fail(`external payload refers to changed geometry: ${key}`);
    const stored = document.snapshot().opaquePayloads[recipeKey(recipe.drawingId)];
    if (stored !== undefined && !equal(stored, recipe)) fail('registered source facts have changed');
    const nextRecipe = {
        ...recipe,
        source: safe.next,
        entityIds: after.entities.map((item)=>item.id)
    };
    return deepFreeze({
        recipe: nextRecipe,
        previousRevision: document.revision,
        revision: document.revision + 1,
        createdIds,
        removedIds,
        unchangedIds,
        before: before.entities.filter((item)=>removed.has(item.id)),
        after: after.entities.filter((item)=>createdIds.includes(item.id)),
        evidence: compiled.evidence
    });
}
export async function applyGeologyDrawingRevision(document, previous, next, options) {
    const result = prepareGeologyDrawingRevision(document, previous, next, options);
    await document.transact('Update geology source facts and drawing', (native)=>{
        const scope = createCommandEditScope(native, 'GEOLOGY_DRAWING_UPDATE'), tx = scope.transaction;
        for (const id of result.removedIds)tx.eraseObject(id, {
            hard: true
        });
        for (const entity of result.after)tx.createEntity(entity.type, structuredClone(entity.payload), {
            id: entity.id,
            ownerId: entity.ownerId
        });
        tx.putOpaquePayload(recipeKey(result.recipe.drawingId), result.recipe);
        scope.validate();
    }, {
        expectedRevision: options.expectedRevision,
        source: 'geology-drawing-update',
        metadata: {
            drawingId: result.recipe.drawingId
        }
    });
    return result;
}
