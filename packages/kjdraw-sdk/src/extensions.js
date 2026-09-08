// Generated from extensions.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJRegistrationError } from './errors.js';
import { deepFreeze } from './utils.js';
export const KJ_EXTENSION_POINTS = Object.freeze([
    'entity-type',
    'object-type',
    'geometry-kernel',
    'renderer',
    'file-adapter',
    'command',
    'tool',
    'snap-provider',
    'property-provider',
    'workspace',
    'survey-package'
]);
export class KJExtensionRegistry {
    #points = new Map();
    constructor(points = KJ_EXTENSION_POINTS){
        for (const point of points)this.#points.set(point, new Map());
    }
    register(point, definition, { owner = 'application', replace = false } = {}) {
        const registry = this.#points.get(point);
        if (!registry) throw new KJRegistrationError(`Unknown extension point: ${point}`);
        const id = String(definition?.id ?? '').trim();
        if (!id) throw new KJRegistrationError(`Extension registered at ${point} requires an id`);
        if (registry.has(id) && !replace) throw new KJRegistrationError(`Extension already registered: ${point}/${id}`);
        const entry = deepFreeze({
            ...definition,
            id,
            owner: String(owner)
        });
        registry.set(id, entry);
        return ()=>registry.get(id) === entry && registry.delete(id);
    }
    get(point, id) {
        return this.#points.get(point)?.get(String(id)) ?? null;
    }
    has(point, id) {
        return this.#points.get(point)?.has(String(id)) ?? false;
    }
    list(point) {
        return [
            ...this.#points.get(point)?.values() ?? []
        ];
    }
    removeOwner(owner) {
        let count = 0;
        for (const registry of this.#points.values()){
            for (const [id, entry] of registry){
                if (entry.owner === owner) {
                    registry.delete(id);
                    count += 1;
                }
            }
        }
        return count;
    }
}
