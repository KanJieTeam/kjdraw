// Generated from road-drawing-recipe.ts by scripts/build-typescript.mjs. Do not edit directly.
import { buildRoadDrawing } from './road-drawing.js';
import { applyRoadDrawingRevision } from './road-drawing-update.js';
import { KJRevisionConflictError, KJValidationError } from './errors.js';
import { deepFreeze } from './utils.js';
export const KJDRAW_ROAD_RECIPE_SCHEMA = 'com.kanjie.kjdraw.road-drawing-recipe';
function fail(message) {
    throw new KJValidationError(`Road drawing recipe: ${message}`);
}
function snapshotRecipe(input) {
    let nodes = 0, characters = 0;
    const active = new Set();
    const visit = (value, depth)=>{
        if (++nodes > 100000 || depth > 24) fail('finite JSON traversal budget exceeded');
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) fail('numbers must be finite');
            return value;
        }
        if (typeof value === 'string') {
            if ((characters += value.length) > 1048576) fail('recipe exceeds the 1 MiB budget');
            return value;
        }
        if (!value || typeof value !== 'object' || active.has(value)) fail('recipe requires acyclic plain JSON data');
        const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
        if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) fail('recipe requires plain objects and arrays');
        const keys = Reflect.ownKeys(value);
        if (keys.length > 100000 || array && keys.length !== value.length + 1) fail('arrays must be dense and input must fit the traversal budget');
        active.add(value);
        const result = array ? [] : {};
        for (const key of keys){
            if (array && key === 'length') continue;
            if (typeof key !== 'string' || [
                '__proto__',
                'prototype',
                'constructor'
            ].includes(key)) fail('unsafe JSON property');
            if ((characters += key.length) > 1048576) fail('recipe exceeds the 1 MiB budget');
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor.enumerable || !('value' in descriptor) || array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail('accessors, sparse arrays and non-data properties are forbidden');
            result[key] = visit(descriptor.value, depth + 1);
        }
        active.delete(value);
        return result;
    };
    const copied = visit(input, 0);
    const fields = [
        'schema',
        'schemaVersion',
        'compilerVersion',
        'documentId',
        'input',
        'options'
    ];
    if (!copied || typeof copied !== 'object' || Array.isArray(copied) || Object.keys(copied).length !== fields.length || fields.some((field)=>!Object.hasOwn(copied, field))) fail('recipe fields do not match the versioned format');
    const recipe = copied;
    if (recipe.schema !== KJDRAW_ROAD_RECIPE_SCHEMA || recipe.schemaVersion !== 1 || recipe.compilerVersion !== 1) fail('unsupported schema or compiler version; explicit migration is required');
    if (typeof recipe.documentId !== 'string' || !recipe.documentId.trim() || recipe.documentId.length > 256) fail('documentId must be a bounded nonempty string');
    if (new TextEncoder().encode(JSON.stringify(recipe)).byteLength > 1048576) fail('recipe exceeds the 1 MiB budget');
    return recipe;
}
export async function restoreRoadDrawingRecipe(document, input) {
    const recipe = snapshotRecipe(input), source = document.snapshot(), revision = document.revision;
    if (recipe.documentId !== document.id) fail('recipe belongs to a different document');
    if (source.header.units !== 'meter' || recipe.input?.units !== 'meter') fail('recipe and document units must be meter');
    const drawing = buildRoadDrawing(recipe.input, recipe.options);
    const expectedIds = new Set([
        ...drawing.entities.map((entity)=>entity.options.id),
        ...drawing.resources.layers.map((layer)=>layer.id),
        ...drawing.resources.linetypes.map((type)=>type.id)
    ]);
    const prefix = `road:${recipe.options.drawingId}:`;
    for (const id of Object.keys(source.objects))if (id.startsWith(prefix) && !expectedIds.has(id)) fail(`unexpected object occupies this drawing identity: ${id}`);
    const branch = document.fork();
    await applyRoadDrawingRevision(branch, drawing, drawing, {
        expectedRevision: revision
    });
    if (document.snapshot() !== source || document.revision !== revision) throw new KJRevisionConflictError(revision, document.revision, {
        documentId: recipe.documentId
    });
    return deepFreeze({
        recipe,
        drawing,
        documentId: recipe.documentId,
        revision
    });
}
export async function createRoadDrawingRecipe(document, input, options) {
    const restored = await restoreRoadDrawingRecipe(document, {
        schema: KJDRAW_ROAD_RECIPE_SCHEMA,
        schemaVersion: 1,
        compilerVersion: 1,
        documentId: document.id,
        input,
        options
    });
    return restored.recipe;
}
