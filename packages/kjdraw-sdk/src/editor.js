// Generated from editor.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJDrawWorkbench } from './workbench.js';
import { KJEventBus } from './events.js';
export class KJDrawEditor {
    workbench;
    ready;
    #events = new KJEventBus();
    #abort = new AbortController();
    #title;
    #maxFileBytes;
    #operations = Promise.resolve();
    constructor(container, options = {}){
        if (typeof document === 'undefined') throw new Error('Mount KJDraw in a browser or a client-side component lifecycle');
        const host = typeof container === 'string' ? document.querySelector(container) : container;
        if (!host) throw new Error(`KJDraw container was not found: ${String(container)}`);
        this.#title = options.title ?? null;
        this.#maxFileBytes = options.maxFileBytes ?? 20 * 1024 * 1024;
        if (options.onReady) this.#events.on('ready', options.onReady);
        if (options.onChange) this.#events.on('change', options.onChange);
        if (options.onSelectionChange) this.#events.on('selectionchange', options.onSelectionChange);
        if (options.onError) this.#events.on('error', options.onError);
        const { layers, properties, onChange: _change, onError: _error, onReady: _ready, onSelectionChange: _selection, ...base } = options;
        this.workbench = new KJDrawWorkbench(host, {
            ...base,
            ...layers === undefined ? {} : {
                showLayers: layers
            },
            ...properties === undefined ? {} : {
                showInspector: properties
            },
            onChange: (event)=>{
                this.#applyTitle();
                this.#events.emit('change', event);
            },
            onError: (error)=>{
                if (!this.disposed) this.#events.emit('error', error);
            }
        });
        this.workbench.root.addEventListener('kjdraw:selection', (event)=>{
            this.#events.emit('selectionchange', event.detail);
        }, {
            signal: this.#abort.signal
        });
        this.workbench.root.addEventListener('kjdraw:document', (event)=>{
            this.#applyTitle();
            this.#events.emit('documentchange', event.detail);
        }, {
            signal: this.#abort.signal
        });
        this.ready = this.workbench.ready.then(()=>{
            if (this.disposed) return this;
            this.#applyTitle();
            this.#events.emit('ready', this);
            return this;
        });
        void this.ready.catch(()=>{});
    }
    get document() {
        return this.workbench.document;
    }
    get sdk() {
        return this.workbench.sdk;
    }
    get element() {
        return this.workbench.root;
    }
    get disposed() {
        return this.#abort.signal.aborted;
    }
    get locale() {
        return this.workbench.locale;
    }
    get theme() {
        return this.workbench.theme;
    }
    on(name, listener) {
        this.#assertMounted();
        return this.#events.on(name, listener);
    }
    open(source, options = {}) {
        return this.#enqueue(async ()=>{
            const bytes = typeof source === 'string' ? new TextEncoder().encode(source).byteLength : source instanceof Blob ? source.size : source.byteLength;
            if (bytes > this.#maxFileBytes) throw new RangeError(`Input file exceeds maxFileBytes (${bytes} > ${this.#maxFileBytes})`);
            const fileName = options.fileName ?? (typeof File !== 'undefined' && source instanceof File ? source.name : undefined);
            const data = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source;
            this.#assertMounted();
            return this.workbench.open(data, {
                ...options,
                ...fileName === undefined ? {} : {
                    fileName
                }
            });
        });
    }
    save(options = {}) {
        return this.#enqueue(async ()=>{
            const { format = 'KJD', ...rest } = options;
            const result = await this.workbench.save(format, rest);
            if (typeof result === 'string' || result instanceof Uint8Array) return result;
            if (result instanceof ArrayBuffer) return new Uint8Array(result);
            throw new Error('The file adapter returned an unsupported output type');
        });
    }
    setDocument(drawing) {
        return this.#enqueue(async ()=>{
            await this.workbench.setDocument(drawing);
            this.#applyTitle();
            return this;
        });
    }
    execute(command, args = {}) {
        return this.#enqueue(()=>this.workbench.execute(command, args));
    }
    undo() {
        return this.execute('UNDO');
    }
    redo() {
        return this.execute('REDO');
    }
    setSelection(ids) {
        return this.#enqueue(async ()=>{
            await this.workbench.execute('SELECT', {
                ids,
                operation: 'replace'
            });
            return this.getSelection();
        });
    }
    getSelection() {
        this.#assertMounted();
        return this.workbench.snapshot().selectedIds;
    }
    fit() {
        this.#assertMounted();
        this.workbench.renderer.resize().fit();
        return this;
    }
    setTheme(theme) {
        this.#assertMounted();
        this.workbench.setTheme(theme);
        return this;
    }
    setLocale(locale) {
        this.#assertMounted();
        this.workbench.setLocale(locale);
        this.#applyTitle();
        return this;
    }
    setTool(tool) {
        this.#assertMounted();
        this.workbench.setTool(tool);
        return this;
    }
    setTitle(title) {
        this.#assertMounted();
        this.#title = title;
        this.#applyTitle();
        return this;
    }
    setOptions(options) {
        this.#assertMounted();
        const { layers, properties, ...rest } = options;
        if (options.title !== undefined) this.#title = options.title;
        if (options.maxFileBytes !== undefined) {
            const nextLimit = Number(options.maxFileBytes);
            if (!Number.isSafeInteger(nextLimit) || nextLimit <= 0) throw new RangeError('maxFileBytes must be a positive safe integer');
            this.#maxFileBytes = nextLimit;
        }
        this.workbench.setOptions({
            ...rest,
            ...layers === undefined ? {} : {
                showLayers: layers
            },
            ...properties === undefined ? {} : {
                showInspector: properties
            }
        });
        this.#applyTitle();
        return this;
    }
    dispose() {
        if (this.disposed) return;
        this.#abort.abort();
        this.workbench.dispose();
        try {
            this.#events.emit('dispose', undefined);
        } finally{
            this.#events.clear();
        }
    }
    #assertMounted() {
        if (this.disposed) throw new Error('KJDraw editor has been disposed');
    }
    #applyTitle() {
        const label = this.workbench?.root.querySelector('[data-document-name]');
        if (label && this.#title !== null) label.textContent = this.#title;
    }
    #enqueue(operation) {
        const next = this.#operations.then(async ()=>{
            await this.ready;
            this.#assertMounted();
            try {
                return await operation();
            } catch (error) {
                if (!this.disposed) this.#events.emit('error', error);
                throw error;
            }
        });
        this.#operations = next.catch(()=>{});
        return next;
    }
}
export function createKJDrawEditor(container, options = {}) {
    return new KJDrawEditor(container, options);
}
