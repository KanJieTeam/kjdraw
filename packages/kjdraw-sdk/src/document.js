// Generated from document.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJ_EVENT_NAMES } from './constants.js';
import { KJEventBus } from './events.js';
import { KJRevisionConflictError, KJTransactionError, KJValidationError } from './errors.js';
import { createEmptyDocumentState, migrateDocumentState, validateDocumentState } from './schema.js';
import { KJTransaction } from './transaction.js';
import { createId } from './ids.js';
import { canonicalStringify, clone, deepFreeze, nowIso, stableHash } from './utils.js';
export const KJ_DOCUMENT_HISTORY_ARCHIVE_SCHEMA = 'com.kanjie.kjdraw.document-history@1';
export const KJ_DOCUMENT_HISTORY_ARCHIVE_LIMIT = 50;
export const KJ_DOCUMENT_HISTORY_ARCHIVE_MAX_BYTES = 16777216;
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
function historyState(state) {
    return {
        ...state,
        revisions: []
    };
}
export class KJDocument {
    #state;
    #events = new KJEventBus();
    #undo = [];
    #redo = [];
    #historyLimit;
    #historyBaselineRevision;
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
        this.#historyBaselineRevision = state.revision;
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
        branch.#historyBaselineRevision = this.#state.revision;
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
            redoLabel: this.#redo.at(-1)?.label ?? null,
            undoCount: this.#undo.length,
            redoCount: this.#redo.length,
            undoTarget: this.#historyTarget(this.#undo.at(-1)),
            redoTarget: this.#historyTarget(this.#redo.at(-1))
        });
    }
    #historyTarget(entry) {
        return entry ? Object.freeze({
            id: entry.id,
            label: entry.label,
            revision: entry.revision,
            source: entry.source
        }) : null;
    }
    #requireHistoryTarget(kind, options) {
        if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
            throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, {
                documentId: this.id
            });
        }
        const entry = (kind === 'undo' ? this.#undo : this.#redo).at(-1);
        if (options.targetHistoryId !== undefined && (typeof options.targetHistoryId !== 'string' || !options.targetHistoryId || entry?.id !== options.targetHistoryId)) {
            throw new KJValidationError(`The reviewed ${kind} history target is unavailable or changed; read history and propose again`);
        }
        return entry;
    }
    previewHistory(kind, options = {}) {
        if (kind !== 'undo' && kind !== 'redo') throw new KJValidationError('History preview requires undo or redo');
        const entry = this.#requireHistoryTarget(kind, options);
        if (!entry) throw new KJValidationError(`No ${kind} history is available in this document session`);
        const branch = this.fork(), source = kind === 'undo' ? entry.before : entry.after;
        branch.#adoptState({
            ...source,
            revision: this.#state.revision,
            revisions: this.#state.revisions
        }, null);
        return Object.freeze({
            target: this.#historyTarget(entry),
            document: branch
        });
    }
    clearHistory(options = {}) {
        return this.#enqueue(()=>{
            if (options.expectedRevision != null && options.expectedRevision !== this.revision) throw new KJRevisionConflictError(options.expectedRevision, this.revision);
            this.#undo = [];
            this.#redo = [];
            this.#historyBaselineRevision = this.revision;
            this.#events.emit(KJ_EVENT_NAMES.HISTORY, this.history);
            return this.history;
        });
    }
    exportHistory(options = {}) {
        const limit = options.limit ?? KJ_DOCUMENT_HISTORY_ARCHIVE_LIMIT;
        const maxBytes = options.maxBytes ?? KJ_DOCUMENT_HISTORY_ARCHIVE_MAX_BYTES;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > KJ_DOCUMENT_HISTORY_ARCHIVE_LIMIT || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > KJ_DOCUMENT_HISTORY_ARCHIVE_MAX_BYTES) throw new KJValidationError('History archive requires limit 1–50 and maxBytes 1024–16777216');
        const undoCount = Math.min(this.#undo.length, Math.ceil(limit / 2) + Math.max(0, Math.floor(limit / 2) - this.#redo.length));
        const redoCount = Math.min(this.#redo.length, limit - undoCount);
        const projectEntry = ({ label, source, revision, before, after })=>({
                label,
                source,
                revision,
                before,
                after
            });
        const archive = {
            schema: KJ_DOCUMENT_HISTORY_ARCHIVE_SCHEMA,
            documentId: this.id,
            documentRevision: this.revision,
            documentFingerprint: this.fingerprint(),
            baselineRevision: this.#historyBaselineRevision,
            undo: [],
            redo: []
        };
        const undo = undoCount ? this.#undo.slice(-undoCount).reverse() : [], redo = redoCount ? this.#redo.slice(-redoCount).reverse() : [];
        let byteLength = new TextEncoder().encode(JSON.stringify(archive)).length;
        let undoFull = false, redoFull = false;
        for(let index = 0; index < Math.max(undo.length, redo.length); index++){
            for (const kind of [
                'undo',
                'redo'
            ]){
                const entry = (kind === 'undo' ? undo : redo)[index];
                if (!entry || (kind === 'undo' ? undoFull : redoFull)) continue;
                const projected = projectEntry(entry), addition = new TextEncoder().encode(JSON.stringify(projected)).length + (archive[kind].length ? 1 : 0);
                if (byteLength + addition > maxBytes) {
                    if (kind === 'undo') undoFull = true;
                    else redoFull = true;
                    continue;
                }
                archive[kind].unshift(projected);
                byteLength += addition;
            }
            if (undoFull && redoFull) break;
        }
        if (this.#undo.length + this.#redo.length > 0 && !archive.undo.length && !archive.redo.length) throw new KJValidationError('One history snapshot exceeds the local archive byte limit');
        return deepFreeze(clone(archive));
    }
    restoreHistory(input, options = {}) {
        return this.#enqueue(()=>{
            if (options.expectedRevision != null && options.expectedRevision !== this.revision) throw new KJRevisionConflictError(options.expectedRevision, this.revision);
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw new KJValidationError('History archive must be an object');
            const serialized = canonicalStringify(input);
            if (!serialized || new TextEncoder().encode(serialized).length > KJ_DOCUMENT_HISTORY_ARCHIVE_MAX_BYTES) throw new KJValidationError('History archive exceeds the 16 MiB limit');
            const archive = clone(input);
            if (Object.keys(archive).sort().join(',') !== 'baselineRevision,documentFingerprint,documentId,documentRevision,redo,schema,undo' || archive.schema !== KJ_DOCUMENT_HISTORY_ARCHIVE_SCHEMA || archive.documentId !== this.id || archive.documentRevision !== this.revision || archive.documentFingerprint !== this.fingerprint()) throw new KJValidationError('History archive does not match the current document identity, revision or content fingerprint');
            if (!Number.isSafeInteger(archive.baselineRevision) || archive.baselineRevision < 0 || archive.baselineRevision > this.revision) throw new KJValidationError('History archive baseline revision is invalid');
            if (!Array.isArray(archive.undo) || !Array.isArray(archive.redo) || archive.undo.length + archive.redo.length > KJ_DOCUMENT_HISTORY_ARCHIVE_LIMIT) throw new KJValidationError('History archive exceeds the 50 step limit');
            const content = (state)=>canonicalStringify(contentForFingerprint(state));
            for (const entry of [
                ...archive.undo,
                ...archive.redo
            ]){
                if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'after,before,label,revision,source' || typeof entry.label !== 'string' || entry.label.length > 1024 || typeof entry.source !== 'string' || entry.source.length > 256 || entry.source === 'adapter:dxf-ascii' || !Number.isSafeInteger(entry.revision) || entry.revision <= archive.baselineRevision || entry.revision > this.revision) throw new KJValidationError('Invalid history archive entry or attempt to undo the import baseline');
                for (const state of [
                    entry.before,
                    entry.after
                ]){
                    validateDocumentState(state);
                    if (state.documentId !== this.id || !Number.isSafeInteger(state.revision) || state.revision < archive.baselineRevision || state.revision > this.revision || state.revisions.length !== 0) throw new KJValidationError('History snapshot identity, revision or audit trail is invalid');
                    if (Object.entries(state.objects).some(([id, record])=>record.id !== id)) throw new KJValidationError('History snapshot object IDs do not match their registry keys');
                }
                if (entry.before.revision >= entry.after.revision) throw new KJValidationError('History snapshot revisions are not ordered');
                const recorded = this.#state.revisions.find((record)=>record.revision === entry.revision);
                if (!recorded || recorded.kind !== 'commit' || recorded.label !== entry.label || recorded.source !== entry.source) throw new KJValidationError('History entry is not bound to a recorded document commit');
            }
            let current = content(this.#state);
            for (const entry of [
                ...archive.undo
            ].reverse()){
                if (content(entry.after) !== current) throw new KJValidationError('Undo history snapshot chain does not match current or adjacent content');
                current = content(entry.before);
            }
            current = content(this.#state);
            for (const entry of [
                ...archive.redo
            ].reverse()){
                if (content(entry.before) !== current) throw new KJValidationError('Redo history snapshot chain does not match current or adjacent content');
                current = content(entry.after);
            }
            const renew = (entry)=>({
                    ...entry,
                    id: createId('history')
                });
            this.#undo = archive.undo.slice(-this.#historyLimit).map(renew);
            this.#redo = archive.redo.slice(-this.#historyLimit).map(renew);
            this.#historyBaselineRevision = archive.baselineRevision;
            this.#events.emit(KJ_EVENT_NAMES.HISTORY, this.history);
            return this.history;
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
                id: createId('history'),
                label: String(label),
                source: record.source,
                before: historyState(before),
                after: historyState(accepted),
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
            const entry = this.#requireHistoryTarget('undo', options);
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
                after: historyState(current)
            });
            this.#emitChange(KJ_EVENT_NAMES.UNDO, this.#state.revisions.at(-1));
            return true;
        });
    }
    redo(options = {}) {
        return this.#enqueue(async ()=>{
            const entry = this.#requireHistoryTarget('redo', options);
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
                before: historyState(before),
                after: historyState(accepted)
            });
            this.#emitChange(KJ_EVENT_NAMES.REDO, this.#state.revisions.at(-1));
            return true;
        });
    }
    #restoreHistoricalState(source, options) {
        const restored = createTransactionState(source);
        const revision = this.#state.revision + 1;
        restored.revision = revision;
        restored.revisions = [
            ...this.#state.revisions
        ];
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
        const authority = this.#authority;
        const sourceState = this.#state;
        const serialized = canonicalStringify(candidate) ?? '';
        try {
            const acceptedSource = await authority.commit(serialized, expectedRevision);
            if (this.#authority !== authority || this.#state !== sourceState) {
                throw new KJValidationError('Authoritative backend response belongs to an obsolete document session');
            }
            const accepted = typeof acceptedSource === 'string' ? JSON.parse(acceptedSource) : clone(acceptedSource);
            validateDocumentState(accepted);
            const acceptedJson = canonicalStringify(accepted);
            if (accepted.documentId !== this.id || Number(accepted.revision) !== Number(expectedRevision) + 1 || acceptedJson !== serialized && acceptedJson !== canonicalStringify(this.#canonicalAuthorityCandidate(serialized))) {
                throw new KJValidationError('Authoritative backend returned a mismatched document commit');
            }
            return accepted;
        } catch (error) {
            if (this.#authority === authority) {
                this.#authority = null;
                try {
                    authority.close();
                } catch  {}
            }
            throw error;
        }
    }
    #canonicalAuthorityCandidate(serialized) {
        const normalized = JSON.parse(serialized);
        for (const object of Object.values(normalized.objects)){
            object.handle = object.handle.replace(/[a-z]/g, (value)=>value.toUpperCase());
            object.type = object.type.replace(/[a-z]/g, (value)=>value.toUpperCase());
            for (const [key, value] of Object.entries({
                ownerId: null,
                name: null,
                payload: {},
                extension: {},
                erased: false,
                source: null
            })){
                if (!Object.hasOwn(object, key)) object[key] = value;
            }
        }
        for (const table of Object.values(normalized.tables))if (!Object.hasOwn(table, 'currentId')) table.currentId = null;
        if (!Object.hasOwn(normalized, 'opaquePayloads')) normalized.opaquePayloads = {};
        if (!Object.hasOwn(normalized, 'revisions')) normalized.revisions = [];
        return normalized;
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
