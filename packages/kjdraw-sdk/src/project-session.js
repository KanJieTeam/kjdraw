// Generated from project-session.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJDocument } from './document.js';
import { KJEventBus } from './events.js';
import { KJValidationError } from './errors.js';
import { createId } from './ids.js';
import { createKjpPackage, openKjpPackage } from './project-package.js';
import { clone, deepFreeze, nowIso } from './utils.js';
const SNAPSHOT_SCHEMA = 'com.kanjie.kjdraw.snapshot@1';
function projectId(value) {
    const id = String(value ?? '').trim();
    if (!id) throw new KJValidationError('KJDraw 工程 id 不能为空');
    return id;
}
function entryMap(entries, prefix) {
    const result = new Map();
    for (const [path, value] of entries ?? [])if (path.startsWith(prefix)) result.set(path.slice(prefix.length), value);
    return result;
}
function documentRows(input) {
    if (input instanceof Map) return [
        ...input
    ];
    if (Array.isArray(input)) return input.map((document)=>[
            document instanceof KJDocument ? document.id : undefined,
            document
        ]);
    return Object.entries(input ?? {});
}
function normalizeDocument(input) {
    return input instanceof KJDocument ? input : KJDocument.open(input);
}
export class KJProjectSession {
    #events = new KJEventBus();
    #documentOff = new Map();
    #sdkOff = [];
    #savedFingerprint = '';
    sdk;
    id;
    title;
    createdAt;
    modifiedAt;
    metadata;
    migrations;
    documents = new Map();
    activeDocumentId = null;
    commands = [];
    assets = new Map();
    snapshots = new Map();
    snapshotLedger = [];
    dirty = false;
    state = 'unbound';
    lastError = null;
    constructor({ sdk, id, title = '未命名工程', createdAt, metadata = {}, migrations = [] } = {}){
        if (!sdk?.attachDocument || !sdk?.events) throw new KJValidationError('KJProjectSession 需要 KJDrawSDK');
        this.sdk = sdk;
        this.id = projectId(id ?? createId('project'));
        this.title = String(title || '未命名工程');
        this.createdAt = String(createdAt ?? nowIso());
        this.modifiedAt = this.createdAt;
        this.metadata = clone(metadata);
        this.migrations = clone([
            ...migrations
        ]);
        this.#sdkOff.push(sdk.events.on('command:committed', (value)=>this.#recordCommand(value)));
    }
    static create(options) {
        const session = new KJProjectSession(options);
        for (const [, input] of documentRows(options.documents))session.attachDocument(normalizeDocument(input));
        if (!session.documents.size) session.attachDocument(KJDocument.create({
            documentId: options.documentId ?? 'model',
            title: session.title
        }));
        const firstDocumentId = session.documents.keys().next().value;
        if (!firstDocumentId) throw new KJValidationError('KJDraw 工程无法创建默认图纸');
        session.setActiveDocument(options.activeDocumentId ?? firstDocumentId);
        session.dirty = true;
        session.state = 'unbound';
        return session;
    }
    static async open(source, options) {
        const opened = await openKjpPackage(source, options);
        const session = new KJProjectSession({
            sdk: options.sdk,
            id: opened.manifest.projectId,
            title: opened.manifest.title,
            createdAt: opened.manifest.createdAt,
            metadata: opened.manifest.metadata,
            migrations: opened.manifest.migrations
        });
        session.modifiedAt = opened.manifest.modifiedAt;
        session.commands = clone(opened.commands);
        session.assets = entryMap(opened.entries, 'assets/');
        session.snapshots = entryMap(opened.entries, 'snapshots/');
        const snapshots = opened.manifest.metadata.snapshots;
        session.snapshotLedger = Array.isArray(snapshots) ? clone(snapshots) : [];
        for (const document of opened.drawings.values())session.attachDocument(document);
        session.setActiveDocument(opened.manifest.activeDrawing);
        session.dirty = false;
        session.state = 'saved';
        session.#savedFingerprint = session.fingerprint();
        return session;
    }
    on(name, listener, options) {
        return this.#events.on(name, listener, options);
    }
    attachDocument(input) {
        const document = normalizeDocument(input);
        const existing = this.documents.get(document.id);
        if (existing && existing !== document) this.detachDocument(document.id);
        if (!this.sdk.documents.has(document.id)) this.sdk.attachDocument(document);
        else if (this.sdk.documents.get(document.id) !== document) throw new KJValidationError(`SDK 已存在不同的同名图纸：${document.id}`);
        this.documents.set(document.id, document);
        this.#documentOff.set(document.id, document.on('document:change', ()=>this.markDirty('document-change')));
        this.activeDocumentId ??= document.id;
        return document;
    }
    detachDocument(id) {
        const documentId = String(id);
        if (!this.documents.has(documentId)) return false;
        this.#documentOff.get(documentId)?.();
        this.#documentOff.delete(documentId);
        this.documents.delete(documentId);
        this.sdk.closeDocument(documentId);
        if (this.activeDocumentId === documentId) this.activeDocumentId = this.documents.keys().next().value ?? null;
        this.markDirty('document-detached');
        return true;
    }
    setActiveDocument(id) {
        const documentId = String(id);
        const document = this.documents.get(documentId);
        if (!document) throw new KJValidationError(`工程中不存在图纸：${documentId}`);
        this.activeDocumentId = documentId;
        this.sdk.setActiveDocument(documentId);
        this.#events.emit('active-document', {
            documentId
        });
        return document;
    }
    get activeDocument() {
        return this.activeDocumentId ? this.documents.get(this.activeDocumentId) ?? null : null;
    }
    #recordCommand({ envelope, receipt, document }) {
        if (!document || !this.documents.has(document.id)) return;
        this.commands.push(deepFreeze({
            envelope: clone(envelope),
            receipt: clone(receipt)
        }));
        this.markDirty('command');
        this.#events.emit('command', {
            envelope,
            receipt,
            documentId: document.id
        });
    }
    markDirty(reason = 'change') {
        this.modifiedAt = nowIso();
        this.dirty = true;
        if (this.state !== 'saving' && this.state !== 'error') this.state = 'dirty';
        this.#events.emit('state', this.snapshotState(reason));
    }
    snapshotState(reason = '') {
        return deepFreeze({
            id: this.id,
            title: this.title,
            state: this.state,
            dirty: this.dirty,
            activeDocumentId: this.activeDocumentId,
            modifiedAt: this.modifiedAt,
            reason,
            error: this.lastError?.message ?? null
        });
    }
    fingerprint() {
        return [
            ...this.documents.values()
        ].map((document)=>`${document.id}:${document.fingerprint()}`).sort().join('|');
    }
    createSnapshot(label = '版本快照', options = {}) {
        const id = String(options.id ?? createId('snapshot'));
        const at = String(options.at ?? nowIso());
        const documents = [];
        for (const document of this.documents.values()){
            const path = `${id}/${document.id}.kjd`;
            this.snapshots.set(path, document.serialize());
            documents.push({
                id: document.id,
                path: `snapshots/${path}`,
                revision: document.revision,
                fingerprint: document.fingerprint()
            });
        }
        const record = deepFreeze({
            schema: SNAPSHOT_SCHEMA,
            id,
            label: String(label),
            at,
            activeDocumentId: this.activeDocumentId,
            documents
        });
        this.snapshotLedger.push(record);
        const limit = Math.max(1, Number(options.limit ?? 100));
        while(this.snapshotLedger.length > limit){
            const removed = this.snapshotLedger.shift();
            if (!removed) break;
            for (const row of removed.documents)this.snapshots.delete(row.path.replace(/^snapshots\//, ''));
        }
        this.markDirty('snapshot');
        return record;
    }
    async package(options = {}) {
        if (!this.documents.size || !this.activeDocumentId) throw new KJValidationError('空工程不能保存');
        const modifiedAt = String(options.modifiedAt ?? this.modifiedAt ?? nowIso());
        return createKjpPackage({
            projectId: this.id,
            title: this.title,
            drawings: this.documents,
            activeDrawing: this.activeDocumentId,
            commands: this.commands,
            assets: this.assets,
            snapshots: this.snapshots,
            createdAt: this.createdAt,
            modifiedAt,
            migrations: this.migrations,
            metadata: {
                ...clone(this.metadata),
                snapshots: clone(this.snapshotLedger)
            },
            ...options.writerVersion === undefined ? {} : {
                writerVersion: options.writerVersion
            },
            ...options.recovery === undefined ? {} : {
                recovery: options.recovery
            },
            ...options.diagnostics === undefined ? {} : {
                diagnostics: options.diagnostics
            }
        });
    }
    beginSave() {
        this.state = 'saving';
        this.lastError = null;
        this.#events.emit('state', this.snapshotState('save-start'));
    }
    markSaved() {
        this.#savedFingerprint = this.fingerprint();
        this.dirty = false;
        this.state = 'saved';
        this.lastError = null;
        this.#events.emit('state', this.snapshotState('save-complete'));
    }
    markSaveError(error) {
        this.dirty = true;
        this.state = 'error';
        this.lastError = error instanceof Error ? error : new Error(String(error || '工程保存失败'));
        this.#events.emit('state', this.snapshotState('save-error'));
    }
    hasChangedSinceSave() {
        return this.dirty || this.fingerprint() !== this.#savedFingerprint;
    }
    destroy() {
        for (const off of this.#sdkOff.splice(0))off();
        for (const off of this.#documentOff.values())off();
        this.#documentOff.clear();
        for (const id of this.documents.keys())this.sdk.closeDocument(id);
        this.documents.clear();
        this.#events.clear();
    }
}
export { SNAPSHOT_SCHEMA };
