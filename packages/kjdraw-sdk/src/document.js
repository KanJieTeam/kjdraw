// Generated from document.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJ_EVENT_NAMES } from './constants.js';
import { KJEventBus } from './events.js';
import { KJRevisionConflictError, KJTransactionError, KJValidationError } from './errors.js';
import { createEmptyDocumentState, migrateDocumentState, validateDocumentState } from './schema.js';
import { KJTransaction } from './transaction.js';
import { canonicalStringify, clone, deepFreeze, nowIso, stableHash } from './utils.js';
function contentForFingerprint(state) {
    return {
        ...state,
        revision: 0,
        revisions: [],
        metadata: {
            ...state.metadata,
            modifiedAt: null
        }
    };
}
function createTransactionState(state) {
    return {
        ...state,
        header: {
            ...state.header,
            systemVariables: {
                ...state.header.systemVariables
            }
        },
        tables: Object.fromEntries(Object.entries(state.tables).map(([name, table])=>[
                name,
                {
                    currentId: table.currentId,
                    recordIds: [
                        ...table.recordIds
                    ]
                }
            ])),
        spaces: {
            ...state.spaces,
            paperSpaceIds: [
                ...state.spaces.paperSpaceIds
            ],
            layoutIds: [
                ...state.spaces.layoutIds
            ]
        },
        objects: {
            ...state.objects
        },
        resources: Object.fromEntries(Object.entries(state.resources).map(([name, collection])=>[
                name,
                {
                    ...collection
                }
            ])),
        opaquePayloads: {
            ...state.opaquePayloads
        },
        revisions: [
            ...state.revisions
        ],
        metadata: {
            ...state.metadata,
            tags: [
                ...state.metadata.tags
            ],
            custom: {
                ...state.metadata.custom
            }
        }
    };
}
export class KJDocument {
    #state;
    #events = new KJEventBus();
    #undo = [];
    #redo = [];
    #historyLimit;
    #queue = Promise.resolve();
    #authority = null;
    #snapshotCache = null;
    #fingerprintCache = null;
    #objectCache = new Map();
    #queryCache = new Map();
    #tableCache = new Map();
    #ownerEntityIndex = null;
    constructor(input = {}, options = {}){
        const candidate = input;
        const state = candidate?.schema || Array.isArray(candidate?.entities) || Array.isArray(candidate?.layers) ? migrateDocumentState(input) : createEmptyDocumentState(input);
        validateDocumentState(state);
        this.#state = clone(state);
        this.#historyLimit = Math.max(1, Number(options.historyLimit ?? 500));
    }
    static create(options = {}) {
        return new KJDocument(options, options);
    }
    static open(input, options = {}) {
        return new KJDocument(typeof input === 'string' ? JSON.parse(input) : input, options);
    }
    fork() {
        const branch = KJDocument.create({
            historyLimit: this.#historyLimit
        });
        branch.#state = this.#state;
        branch.#snapshotCache = this.#snapshotCache;
        branch.#fingerprintCache = this.#fingerprintCache;
        return branch;
    }
    get id() {
        return this.#state.documentId;
    }
    get revision() {
        return this.#state.revision;
    }
    get schemaVersion() {
        return this.#state.schemaVersion;
    }
    get hasAuthoritativeBackend() {
        return this.#authority != null;
    }
    get history() {
        return Object.freeze({
            canUndo: this.#undo.length > 0,
            canRedo: this.#redo.length > 0,
            undoLabel: this.#undo.at(-1)?.label ?? null,
            redoLabel: this.#redo.at(-1)?.label ?? null
        });
    }
    on(name, listener, options) {
        return this.#events.on(name, listener, options);
    }
    once(name, listener, options) {
        return this.#events.once(name, listener, options);
    }
    snapshot() {
        this.#snapshotCache ??= deepFreeze(clone(this.#state));
        return this.#snapshotCache;
    }
    get metadata() {
        return deepFreeze(clone(this.#state.metadata));
    }
    get spaces() {
        return deepFreeze(clone(this.#state.spaces));
    }
    toJSON({ includeRevisions = true } = {}) {
        const state = clone(this.#state);
        if (!includeRevisions) state.revisions = [];
        return state;
    }
    serialize({ pretty = false, includeRevisions = true } = {}) {
        return canonicalStringify(this.toJSON({
            includeRevisions
        }), pretty ? 2 : 0) ?? '';
    }
    fingerprint() {
        this.#fingerprintCache ??= stableHash(contentForFingerprint(this.#state));
        return this.#fingerprintCache;
    }
    validate() {
        return validateDocumentState(this.#state, {
            throwOnError: false
        });
    }
    bindAuthority(session) {
        if (!session || typeof session.commit !== 'function' || typeof session.serialize !== 'function' || typeof session.close !== 'function') {
            throw new KJValidationError('Document authority must expose commit, serialize and close');
        }
        try {
            const source = session.serialize();
            const accepted = typeof source === 'string' ? JSON.parse(source) : source;
            validateDocumentState(accepted);
            if (accepted.documentId !== this.id || Number(accepted.revision) !== this.revision) {
                throw new KJValidationError('Document authority does not match the current document identity and revision');
            }
            this.unbindAuthority();
            this.#adoptState(clone(accepted));
            this.#authority = session;
            return this;
        } catch (error) {
            session.close();
            throw error;
        }
    }
    unbindAuthority() {
        if (!this.#authority) return false;
        const authority = this.#authority;
        this.#authority = null;
        authority.close();
        return true;
    }
    getObject(id, { includeErased = false } = {}) {
        const key = `${includeErased ? '1' : '0'}:${String(id)}`;
        if (this.#objectCache.has(key)) return this.#objectCache.get(key) ?? null;
        const object = this.#state.objects[String(id)];
        const result = !object || object.erased && !includeErased ? null : deepFreeze(object);
        this.#objectCache.set(key, result);
        return result;
    }
    listObjects({ kind, type, ownerId, includeErased = false } = {}) {
        const normalizedType = type == null ? null : String(type).toUpperCase();
        const key = `${kind ?? ''}|${normalizedType ?? ''}|${ownerId ?? ''}|${includeErased ? '1' : '0'}`;
        const cached = this.#queryCache.get(key);
        if (cached) return cached;
        let objects = kind === 'entity' && ownerId != null ? [
            ...this.#entitiesByOwner(ownerId)
        ] : Object.values(this.#state.objects).filter((object)=>kind == null || object.kind === kind).filter((object)=>ownerId == null || object.ownerId === ownerId);
        objects = objects.filter((object)=>includeErased || !object.erased).filter((object)=>normalizedType == null || object.type === normalizedType);
        const result = Object.freeze(objects.map((object)=>this.getObject(object.id, {
                includeErased
            })));
        this.#queryCache.set(key, result);
        return result;
    }
    listEntities(options = {}) {
        return this.listObjects({
            ...options,
            kind: 'entity'
        });
    }
    getTable(name) {
        const key = String(name);
        if (this.#tableCache.has(key)) return this.#tableCache.get(key) ?? null;
        const table = this.#state.tables[key];
        const result = table ? Object.freeze({
            currentId: table.currentId,
            records: Object.freeze(table.recordIds.map((id)=>this.getObject(id, {
                    includeErased: true
                })).filter((record)=>Boolean(record)))
        }) : null;
        this.#tableCache.set(key, result);
        return result;
    }
    getActiveLayout() {
        return this.getObject(this.#state.spaces.activeLayoutId);
    }
    #adoptState(state, fingerprint = null) {
        this.#state = state;
        this.#snapshotCache = null;
        this.#fingerprintCache = fingerprint;
        this.#objectCache.clear();
        this.#queryCache.clear();
        this.#tableCache.clear();
        this.#ownerEntityIndex = null;
    }
    #entitiesByOwner(ownerId) {
        if (!this.#ownerEntityIndex) {
            const grouped = new Map();
            for (const object of Object.values(this.#state.objects))if (object.kind === 'entity' && object.ownerId != null) {
                const values = grouped.get(object.ownerId);
                if (values) values.push(object);
                else grouped.set(object.ownerId, [
                    object
                ]);
            }
            this.#ownerEntityIndex = new Map();
            for (const [owner, values] of grouped){
                const remaining = new Map(values.map((object)=>[
                        object.id,
                        object
                    ])), ordered = [];
                for (const id of this.#state.objects[owner]?.payload.entityIds ?? []){
                    const object = remaining.get(id);
                    if (object) {
                        ordered.push(object);
                        remaining.delete(id);
                    }
                }
                ordered.push(...[
                    ...remaining.values()
                ].sort((a, b)=>{
                    const left = BigInt(`0x${a.handle}`), right = BigInt(`0x${b.handle}`);
                    return left < right ? -1 : left > right ? 1 : 0;
                }));
                this.#ownerEntityIndex.set(owner, ordered);
            }
        }
        return this.#ownerEntityIndex.get(String(ownerId)) ?? [];
    }
    #enqueue(work) {
        const result = this.#queue.then(work, work);
        this.#queue = result.catch(()=>undefined);
        return result;
    }
    transact(label, work, options = {}) {
        if (typeof work !== 'function') return Promise.reject(new KJTransactionError('Transaction callback must be a function'));
        return this.#enqueue(()=>this.#performTransaction(label, work, options));
    }
    async #performTransaction(label, work, options) {
        if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
            throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, {
                documentId: this.id
            });
        }
        const before = this.#state;
        const draft = createTransactionState(this.#state);
        const transaction = new KJTransaction(draft, {
            label,
            metadata: options.metadata ?? {}
        });
        try {
            const result = await work(transaction);
            validateDocumentState(draft, {
                previousState: before
            });
            const revision = this.#state.revision + 1;
            draft.revision = revision;
            draft.metadata.modifiedAt = options.at ?? nowIso();
            const record = {
                revision,
                kind: 'commit',
                label: String(label),
                at: draft.metadata.modifiedAt,
                author: options.author ?? null,
                source: options.source ?? 'sdk',
                metadata: clone(options.metadata ?? {}),
                operationCount: transaction.operationCount,
                operations: transaction._revisionOperations()
            };
            draft.revisions.push(record);
            const accepted = await this.#acceptAuthoritativeCommit(draft, before.revision);
            transaction._close();
            let beforeSnapshot = null;
            let afterSnapshot = null;
            const beforeCommit = Object.freeze({
                get before () {
                    return beforeSnapshot ??= deepFreeze(clone(before));
                },
                get after () {
                    return afterSnapshot ??= deepFreeze(clone(accepted));
                },
                revision: deepFreeze(clone(record))
            });
            this.#events.emit(KJ_EVENT_NAMES.BEFORE_COMMIT, beforeCommit);
            const acceptedFingerprint = accepted.revisions.at(-1)?.fingerprint;
            this.#adoptState(accepted, typeof acceptedFingerprint === 'string' ? acceptedFingerprint : null);
            this.#undo.push({
                label: String(label),
                before,
                after: accepted,
                revision
            });
            if (this.#undo.length > this.#historyLimit) this.#undo.shift();
            this.#redo = [];
            this.#emitChange(KJ_EVENT_NAMES.AFTER_COMMIT, record);
            return result;
        } catch (error) {
            transaction._close();
            if (error instanceof KJValidationError || error instanceof KJTransactionError) throw error;
            throw new KJTransactionError(`Transaction failed: ${label}`, {
                label
            }, error);
        }
    }
    undo(options = {}) {
        return this.#enqueue(async ()=>{
            if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
                throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, {
                    documentId: this.id
                });
            }
            const entry = this.#undo.at(-1);
            if (!entry) return false;
            const current = this.#state;
            const restored = this.#restoreHistoricalState(entry.before, {
                kind: 'undo',
                label: `Undo ${entry.label}`,
                targetRevision: entry.revision,
                ...options
            });
            const accepted = await this.#acceptAuthoritativeCommit(restored, current.revision);
            this.#undo.pop();
            this.#adoptState(accepted, restored.revisions.at(-1)?.fingerprint ?? null);
            this.#redo.push({
                ...entry,
                after: current
            });
            this.#emitChange(KJ_EVENT_NAMES.UNDO, this.#state.revisions.at(-1));
            return true;
        });
    }
    redo(options = {}) {
        return this.#enqueue(async ()=>{
            if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
                throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, {
                    documentId: this.id
                });
            }
            const entry = this.#redo.at(-1);
            if (!entry) return false;
            const before = this.#state;
            const restored = this.#restoreHistoricalState(entry.after, {
                kind: 'redo',
                label: `Redo ${entry.label}`,
                targetRevision: entry.revision,
                ...options
            });
            const accepted = await this.#acceptAuthoritativeCommit(restored, before.revision);
            this.#redo.pop();
            this.#adoptState(accepted, restored.revisions.at(-1)?.fingerprint ?? null);
            this.#undo.push({
                ...entry,
                before,
                after: accepted
            });
            this.#emitChange(KJ_EVENT_NAMES.REDO, this.#state.revisions.at(-1));
            return true;
        });
    }
    #restoreHistoricalState(source, options) {
        const restored = createTransactionState(source);
        const revision = this.#state.revision + 1;
        restored.revision = revision;
        restored.revisions = clone(this.#state.revisions);
        restored.metadata.modifiedAt = options.at ?? nowIso();
        const record = {
            revision,
            kind: options.kind,
            label: options.label,
            targetRevision: options.targetRevision,
            at: restored.metadata.modifiedAt,
            author: options.author ?? null,
            source: options.source ?? 'sdk',
            operationCount: 0,
            operations: []
        };
        restored.revisions.push(record);
        validateDocumentState(restored, {
            previousState: this.#state
        });
        return restored;
    }
    async #acceptAuthoritativeCommit(candidate, expectedRevision) {
        if (!this.#authority) return candidate;
        const serialized = canonicalStringify(candidate) ?? '';
        const acceptedSource = await this.#authority.commit(serialized, expectedRevision);
        const accepted = typeof acceptedSource === 'string' ? JSON.parse(acceptedSource) : clone(acceptedSource);
        validateDocumentState(accepted);
        if (accepted.documentId !== this.id || Number(accepted.revision) !== Number(expectedRevision) + 1) {
            throw new KJValidationError('Authoritative backend returned a mismatched document commit');
        }
        return accepted;
    }
    #emitChange(eventName, revision) {
        const owner = this;
        let documentSnapshot = null;
        const payload = Object.freeze({
            get document () {
                return documentSnapshot ??= owner.snapshot();
            },
            documentId: this.id,
            documentRevision: this.revision,
            revision: deepFreeze(clone(revision)),
            history: this.history
        });
        this.#events.emit(eventName, payload);
        this.#events.emit(KJ_EVENT_NAMES.CHANGE, payload);
        this.#events.emit(KJ_EVENT_NAMES.HISTORY, this.history);
    }
}
