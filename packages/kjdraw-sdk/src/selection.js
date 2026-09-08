// Generated from selection.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJEventBus } from './events.js';
import { KJValidationError } from './errors.js';
import { normalizeName } from './utils.js';
export { isEntitySelectable, selectEntitiesInBox, selectEntitiesByFence } from './selection-geometry.js';
const NAMED_PREFIX = 'KJ_SELECTION_SET:';
function referenceId(value) {
    return String(typeof value === 'object' ? value.id : value);
}
function entityId(document, value) {
    const id = referenceId(value);
    const object = document.getObject(id);
    if (!object || object.kind !== 'entity') throw new KJValidationError(`Selectable entity does not exist: ${id}`);
    return id;
}
export class KJSelectionSet {
    #document;
    #ids = [];
    #events = new KJEventBus();
    constructor(document, ids = []){
        if (!document?.getObject) throw new KJValidationError('Selection set requires a KJDocument');
        this.#document = document;
        this.replace(ids, {
            silent: true
        });
    }
    get size() {
        return this.#ids.length;
    }
    get ids() {
        return Object.freeze([
            ...this.#ids
        ]);
    }
    get objects() {
        return Object.freeze(this.#ids.map((id)=>this.#document.getObject(id)).filter((object)=>Boolean(object)));
    }
    has(value) {
        return this.#ids.includes(referenceId(value));
    }
    onChange(listener, options) {
        return this.#events.on('change', listener, options);
    }
    #emit(reason, changedIds) {
        this.#events.emit('change', Object.freeze({
            reason,
            changedIds: Object.freeze([
                ...changedIds
            ]),
            ids: this.ids,
            size: this.size
        }));
    }
    add(values, { silent = false } = {}) {
        const incoming = Array.isArray(values) ? values : [
            values
        ];
        const changed = [];
        for (const value of incoming){
            const id = entityId(this.#document, value);
            if (!this.#ids.includes(id)) {
                this.#ids.push(id);
                changed.push(id);
            }
        }
        if (changed.length && !silent) this.#emit('add', changed);
        return this;
    }
    remove(values, { silent = false } = {}) {
        const targets = new Set((Array.isArray(values) ? values : [
            values
        ]).map(referenceId));
        const changed = this.#ids.filter((id)=>targets.has(id));
        if (changed.length) this.#ids = this.#ids.filter((id)=>!targets.has(id));
        if (changed.length && !silent) this.#emit('remove', changed);
        return this;
    }
    toggle(value) {
        return this.has(value) ? this.remove(value) : this.add(value);
    }
    clear({ silent = false } = {}) {
        const changed = [
            ...this.#ids
        ];
        this.#ids = [];
        if (changed.length && !silent) this.#emit('clear', changed);
        return this;
    }
    replace(values = [], { silent = false } = {}) {
        const next = [];
        for (const value of values){
            const id = entityId(this.#document, value);
            if (!next.includes(id)) next.push(id);
        }
        const changed = [
            ...new Set([
                ...this.#ids,
                ...next
            ])
        ];
        this.#ids = next;
        if (changed.length && !silent) this.#emit('replace', changed);
        return this;
    }
    selectWhere(predicate, { append = false } = {}) {
        if (typeof predicate !== 'function') throw new KJValidationError('Selection predicate must be a function');
        const matches = this.#document.listEntities().filter(predicate).map((object)=>object.id);
        return append ? this.add(matches) : this.replace(matches);
    }
    prune() {
        const removed = this.#ids.filter((id)=>!this.#document.getObject(id));
        if (removed.length) this.remove(removed);
        return removed;
    }
}
export class KJSelectionManager {
    #document;
    #disposeDocumentChange;
    active;
    constructor(document){
        this.#document = document;
        this.active = new KJSelectionSet(document);
        this.#disposeDocumentChange = document.on('document:change', ()=>this.active.prune());
    }
    dispose() {
        this.#disposeDocumentChange?.();
        this.#disposeDocumentChange = null;
    }
    listNamed() {
        return this.#document.listObjects({
            kind: 'group',
            type: 'SELECTION_SET'
        }).map((group)=>({
                id: group.id,
                name: group.name,
                description: group.payload.description ?? null,
                memberIds: Object.freeze([
                    ...group.payload.memberIds ?? []
                ])
            }));
    }
    getNamed(name) {
        const key = normalizeName(name);
        return this.#document.listObjects({
            kind: 'group',
            type: 'SELECTION_SET'
        }).find((group)=>normalizeName(group.name) === key) ?? null;
    }
    loadNamed(name, { append = false } = {}) {
        const group = this.getNamed(name);
        if (!group) throw new KJValidationError(`Named selection set does not exist: ${name}`);
        const ids = (group.payload.memberIds ?? []).filter((id)=>this.#document.getObject(id));
        if (append) this.active.add(ids);
        else this.active.replace(ids);
        return this.active;
    }
    async saveNamed(name, options = {}) {
        name = String(name ?? '').trim();
        if (!name) throw new KJValidationError('Named selection set requires a name');
        const memberIds = [
            ...options.ids ?? this.active.ids
        ].map((id)=>entityId(this.#document, id));
        const existing = this.getNamed(name);
        return this.#document.transact(`Save selection set ${name}`, (transaction)=>{
            const group = existing ? transaction.updateObject(existing.id, {
                name,
                payload: {
                    memberIds,
                    description: options.description ?? existing.payload.description ?? null
                }
            }) : transaction.createObject({
                kind: 'group',
                type: 'SELECTION_SET',
                ownerId: this.#document.snapshot().namedObjectsDictionaryId,
                name,
                payload: {
                    memberIds,
                    description: options.description ?? null
                }
            });
            transaction.addDictionaryEntry(this.#document.snapshot().namedObjectsDictionaryId, `${NAMED_PREFIX}${name}`, group.id);
            return group;
        }, {
            source: 'selection-manager'
        });
    }
    async deleteNamed(name) {
        const group = this.getNamed(name);
        if (!group) return false;
        await this.#document.transact(`Delete selection set ${group.name}`, (transaction)=>{
            transaction.removeDictionaryEntry(this.#document.snapshot().namedObjectsDictionaryId, `${NAMED_PREFIX}${group.name}`);
            transaction.eraseObject(group.id, {
                hard: true
            });
        }, {
            source: 'selection-manager'
        });
        return true;
    }
}
