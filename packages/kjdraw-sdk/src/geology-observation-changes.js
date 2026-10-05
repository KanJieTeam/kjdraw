// Generated from geology-observation-changes.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { canonicalStringify } from './utils.js';
const identity = (record)=>JSON.stringify([
        record.kind,
        record.id,
        record.depth
    ]);
const fail = (message)=>{
    throw new KJValidationError(`Geology observation changes: ${message}`);
};
export function applyGeologyObservationChanges(before, changes) {
    const additions = changes.add ?? [], updates = changes.update ?? [], removals = changes.remove ?? [];
    const count = additions.length + updates.length + removals.length;
    if (!count || count > 256) fail('require between 1 and 256 explicit operations');
    const original = before ?? [];
    const changed = new Map();
    const removed = new Set(), touched = new Set();
    const resolve = (target)=>{
        const key = identity({
            kind: target.kind,
            id: target.id,
            depth: target.expectedDepth
        });
        const matches = original.flatMap((record, index)=>identity(record) === key ? [
                index
            ] : []);
        if (matches.length !== 1) fail('target kind, id and expectedDepth must match exactly one existing record in this hole');
        if (touched.has(key)) fail('an original record cannot be updated or removed more than once');
        touched.add(key);
        return matches[0];
    };
    for (const operation of updates){
        const index = resolve(operation.target), record = original[index];
        const set = operation.set ?? {}, clear = operation.clearFields ?? [];
        if (!Object.keys(set).length && !clear.length) fail('an update requires explicit changed fields');
        if (new Set(clear).size !== clear.length) fail('an update cannot clear a field twice');
        if (clear.some((field)=>Object.hasOwn(set, field))) fail('an update cannot both set and clear a field');
        const next = structuredClone(record);
        Object.assign(next, structuredClone(set));
        for (const field of clear)delete next[field];
        if (canonicalStringify(next) === canonicalStringify(record)) fail('an update must change stored facts');
        changed.set(index, next);
    }
    for (const target of removals)removed.add(resolve(target));
    const additionIdentities = new Set();
    for (const record of additions){
        const key = identity(record);
        if (additionIdentities.has(key) || touched.has(key) || original.some((item)=>identity(item) === key)) fail('an addition cannot duplicate an existing, touched or newly added identity');
        additionIdentities.add(key);
    }
    return [
        ...original.flatMap((record, index)=>removed.has(index) ? [] : [
                changed.get(index) ?? structuredClone(record)
            ]),
        ...additions.map((record)=>structuredClone(record))
    ];
}
