// Generated from edit-policy.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
const ENTITY_WRITES = new Set([
    'eraseObject',
    'restoreObject',
    'reparentObject',
    'transformEntity',
    'setXData',
    'putOpaquePayload'
]);
export function createCommandEditScope(transaction, commandId) {
    let rejection = null;
    const methods = new Map();
    const assertLayerWritable = (layerId, entityId)=>{
        const effectiveLayerId = String(layerId ?? transaction._draft().tables.layers.currentId ?? '');
        const layer = transaction.getObject(effectiveLayerId);
        if (!layer || layer.type !== 'LAYER') return;
        const reason = layer.payload.locked === true ? 'locked' : layer.payload.frozen === true ? 'frozen' : layer.payload.visible === false ? 'hidden' : null;
        if (!reason) return;
        const error = new KJValidationError(`${commandId}: layer "${layer.name ?? layer.id}" is ${reason}; unlock, thaw or show it before editing`, {
            policy: 'layer-editability',
            commandId,
            layerId: layer.id,
            layerName: layer.name,
            entityId,
            reason
        });
        rejection ??= error;
        throw error;
    };
    const assertEntityWritable = (id)=>{
        const entity = transaction.getObject(String(id));
        if (entity?.kind === 'entity') {
            assertLayerWritable(entity.payload.layerId, entity.id);
            if (entity.type === 'INSERT') for (const childId of entity.payload.attributeIds ?? []){
                const child = transaction.getObject(childId);
                if (child?.kind === 'entity') assertLayerWritable(child.payload.layerId, child.id);
            }
        }
        return entity;
    };
    const guarded = new Proxy(transaction, {
        get (target, property) {
            const value = Reflect.get(target, property, target);
            if (typeof value !== 'function') return value;
            if (methods.has(property)) return methods.get(property);
            const method = (...args)=>{
                if (rejection) throw rejection;
                if (property === 'createEntity') {
                    const payload = args[1];
                    assertLayerWritable(payload?.layerId, null);
                } else if (property === 'createObject') {
                    const spec = args[0];
                    if (spec?.kind === 'entity') assertLayerWritable(spec.payload?.layerId, spec.id ?? null);
                } else if (property === 'updateObject') {
                    const entity = assertEntityWritable(args[0]);
                    const patch = args[1];
                    if (entity?.kind === 'entity' && patch?.payload && 'layerId' in patch.payload) {
                        assertLayerWritable(patch.payload.layerId, entity.id);
                    }
                } else if (ENTITY_WRITES.has(property)) {
                    assertEntityWritable(args[0]);
                }
                return Reflect.apply(value, target, args);
            };
            methods.set(property, method);
            return method;
        }
    });
    return {
        transaction: guarded,
        validate () {
            if (rejection) throw rejection;
        }
    };
}
