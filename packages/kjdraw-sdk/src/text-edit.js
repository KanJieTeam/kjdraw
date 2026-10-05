// Generated from text-edit.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
const fail = (message)=>{
    throw new KJValidationError(`TEXTEDIT: ${message}`);
};
export function validateTextEdits(input) {
    const plain = (value, keys)=>{
        if (!value || typeof value !== 'object' || Array.isArray(value) || ![
            Object.prototype,
            null
        ].includes(Object.getPrototypeOf(value))) return fail('expected plain data');
        const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(value);
        if (actual.length !== keys.length || actual.some((key)=>typeof key !== 'string' || !keys.includes(key) || !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) return fail('unexpected fields or accessors');
        return value;
    };
    const source = plain(input, [
        'changes'
    ]).changes;
    if (!Array.isArray(source) || Object.getPrototypeOf(source) !== Array.prototype || source.length < 1 || source.length > 64 || Reflect.ownKeys(source).length !== source.length + 1) return fail('changes must contain 1–64 entries');
    const ids = new Set(), result = [];
    let characters = 0;
    for(let index = 0; index < source.length; index++){
        const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail('changes must not contain holes or accessors');
        const row = plain(descriptor.value, [
            'id',
            'expectedText',
            'text'
        ]);
        if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 256 || /[\u0000-\u001f]/.test(row.id) || ids.has(row.id)) return fail('IDs must be unique bounded strings');
        for (const key of [
            'expectedText',
            'text'
        ]){
            const value = row[key];
            if (typeof value !== 'string' || value.length > 16384 || value.includes('\0')) return fail('text must be a string of at most 16384 characters without NUL');
            characters += value.length;
            if (characters > 65536) return fail('batch text exceeds 65536 characters');
            if (/%<|>%/.test(value)) return fail('dynamic field expressions require explicit field editing');
        }
        if (!row.text.trim() || row.text === row.expectedText) return fail('replacement must be nonblank and different from the expected text');
        ids.add(row.id);
        result.push({
            id: row.id,
            expectedText: row.expectedText,
            text: row.text
        });
    }
    return result;
}
export function applyTextEdits(document, transaction, input) {
    const changes = validateTextEdits(input);
    for (const change of changes){
        const entity = transaction.getObject(change.id);
        if (!entity || entity.kind !== 'entity' || ![
            'TEXT',
            'MTEXT'
        ].includes(entity.type) || entity.ownerId !== document.spaces.modelSpaceId) return fail('only existing model-space TEXT and MTEXT may be edited');
        if (entity.payload.visible === false || entity.payload.locked === true || entity.payload.frozen === true) return fail('annotation is hidden, locked or frozen');
        if (entity.payload.text !== change.expectedText) return fail(`expected text does not match object ${change.id}`);
        const layerId = entity.payload.layerId ?? document.getTable('layers')?.currentId, layer = layerId ? transaction.getObject(String(layerId)) : null;
        if (!layer || layer.type !== 'LAYER' || layer.payload.visible === false || layer.payload.locked === true || layer.payload.frozen === true) return fail('annotation layer must be visible, thawed and unlocked');
    }
    return changes.map((change)=>transaction.updateObject(change.id, {
            payload: {
                text: change.text
            }
        }));
}
