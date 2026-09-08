// Generated from workbench.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJCanvasRenderer } from './canvas-renderer.js';
import { createKJDrawSDK } from './sdk.js';
import { KJDocument } from './document.js';
import { createIndustrySample } from './samples.js';
import { KJDRAW_THEME_CSS, kjdrawIcon } from './theme.js';
const copy = {
    en: {
        open: 'Open',
        saveKjd: 'Save KJD',
        exportDxf: 'Export DXF',
        draw: 'Draw',
        modify: 'Modify',
        view: 'View',
        select: 'Select',
        pan: 'Pan',
        line: 'Line',
        polyline: 'Polyline',
        circle: 'Circle',
        arc: 'Arc',
        rectangle: 'Rectangle',
        text: 'Text',
        measure: 'Measure',
        undo: 'Undo',
        redo: 'Redo',
        erase: 'Delete',
        move: 'Move',
        copy: 'Copy',
        rotate: 'Rotate',
        offset: 'Offset',
        fit: 'Fit',
        grid: 'Grid',
        layers: 'Layers',
        properties: 'Properties',
        noSelection: 'Select an object to inspect its properties.',
        drawing: 'Drawing',
        entities: 'entities',
        selected: 'selected',
        layer: 'Layer',
        radius: 'Radius',
        apply: 'Apply',
        ready: 'Ready',
        readonly: 'Read only',
        firstPoint: 'Specify the first point',
        nextPoint: 'Specify the next point',
        finishPolyline: 'Click vertices · Enter or double-click to finish',
        arcStart: 'Specify arc start',
        arcEnd: 'Specify arc endpoint',
        textPrompt: 'Type TEXT followed by content, then click an insertion point',
        measured: 'Measured distance',
        unsupported: 'projection limits',
        theme: 'Theme',
        language: '中文',
        sample: 'Starter drawing',
        openFailed: 'Could not open drawing',
        command: 'Command',
        run: 'Run',
        commandHint: 'MOVE 10 0 · COPY 10 0 · ROTATE 15 · OFFSET 2 · SCALE 1.2',
        fileTooLarge: 'File exceeds the workbench limit'
    },
    'zh-CN': {
        open: '打开',
        saveKjd: '保存 KJD',
        exportDxf: '导出 DXF',
        draw: '绘图',
        modify: '修改',
        view: '视图',
        select: '选择',
        pan: '平移',
        line: '直线',
        polyline: '多段线',
        circle: '圆',
        arc: '圆弧',
        rectangle: '矩形',
        text: '文字',
        measure: '测距',
        undo: '撤销',
        redo: '重做',
        erase: '删除',
        move: '移动',
        copy: '复制',
        rotate: '旋转',
        offset: '偏移',
        fit: '全图',
        grid: '栅格',
        layers: '图层',
        properties: '特性',
        noSelection: '选择图元后可查看和修改属性。',
        drawing: '图纸',
        entities: '图元',
        selected: '已选择',
        layer: '图层',
        radius: '半径',
        apply: '应用',
        ready: '就绪',
        readonly: '只读',
        firstPoint: '指定第一个点',
        nextPoint: '指定下一个点',
        finishPolyline: '连续指定顶点 · Enter 或双击完成',
        arcStart: '指定圆弧起点',
        arcEnd: '指定圆弧端点',
        textPrompt: '输入 TEXT 和文字内容，再指定插入点',
        measured: '测量距离',
        unsupported: '投影限制',
        theme: '主题',
        language: 'EN',
        sample: '入门图纸',
        openFailed: '无法打开图纸',
        command: '命令',
        run: '执行',
        commandHint: 'MOVE 10 0 · COPY 10 0 · ROTATE 15 · OFFSET 2 · SCALE 1.2',
        fileTooLarge: '文件超过工作台限制'
    }
};
const WORKBENCH_STYLE = `
:host{display:block;min-height:480px;color-scheme:light}
.kjwb{--surface:var(--kj-surface,#fff);--surface-subtle:var(--kj-surface-subtle,#eef1f5);--chrome:var(--kj-chrome,#f6f7f9);--border:var(--kj-border,#d9dee6);--text:var(--kj-text,#202936);--muted:var(--kj-muted,#637083);--action:var(--kj-action,#2863df);--action-soft:var(--kj-action-soft,#eaf1ff);--brand:var(--kj-brand,#bdf878);--radius:var(--kj-radius,6px);height:100%;min-height:480px;display:grid;grid-template-rows:44px 92px minmax(300px,1fr) 32px;background:var(--chrome);color:var(--text);font:13px/1.4 var(--kj-font,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif);border:1px solid var(--border);overflow:hidden;isolation:isolate}
.kjwb *{box-sizing:border-box}.kjwb :where(:not(svg):not(svg *)){all:revert;box-sizing:border-box}.kjwb button,.kjwb select,.kjwb input{font:inherit}.kjwb .appbar{display:flex;align-items:center;gap:6px;padding:0 10px;background:var(--chrome);border-bottom:1px solid var(--border)}
.kjwb .mark{display:grid;place-items:center;width:28px;height:28px;border-radius:var(--radius);background:var(--brand);color:#16220f;flex:0 0 auto}.kjwb .mark .icon{width:19px;height:19px}.kjwb .brand{font-size:14px;font-weight:700;letter-spacing:-.015em}.kjwb .docname{min-width:0;margin-left:8px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kjwb .spacer{flex:1}
.kjwb button{min-height:32px;border:1px solid transparent;color:var(--text);background:transparent;border-radius:var(--radius);cursor:pointer}.kjwb button:hover:not(:disabled){background:var(--surface-subtle);border-color:var(--border)}.kjwb button:focus-visible{outline:2px solid var(--action);outline-offset:1px}.kjwb button:disabled{opacity:.38;cursor:default}.kjwb .icon{display:inline-grid;place-items:center;width:18px;height:18px;color:#526075;flex:0 0 auto}.kjwb .icon svg{display:block;width:100%;height:100%}
.kjwb .appbar button{height:32px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;gap:6px}.kjwb .primary{background:var(--action)!important;border-color:var(--action)!important;color:#fff!important}.kjwb .primary .icon{color:#fff}.kjwb .panel-toggle.active{background:var(--action-soft);border-color:#c8d8fa;color:var(--action)}.kjwb .panel-toggle.active .icon{color:var(--action)}
.kjwb .ribbon{display:flex;gap:0;background:var(--surface);border-bottom:1px solid var(--border);overflow-x:auto;overflow-y:hidden}.kjwb .group{display:flex;align-items:stretch;gap:2px;padding:8px 8px 22px;border-right:1px solid var(--border);position:relative}.kjwb .group>span{position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:12px;line-height:16px;letter-spacing:.02em;color:var(--muted)}
.kjwb .tool{min-width:54px;padding:5px 7px;display:grid;grid-template-rows:24px auto;place-items:center;align-content:center;gap:2px}.kjwb .tool .icon{width:21px;height:21px}.kjwb .tool small{font-size:12px;line-height:16px;white-space:nowrap;color:var(--text)}.kjwb .tool.active{background:var(--action-soft);border-color:#c8d8fa;color:var(--action)}.kjwb .tool.active .icon,.kjwb .tool.active small{color:var(--action)}
.kjwb .workspace{min-height:0;display:grid;grid-template-columns:232px minmax(0,1fr) 260px}.kjwb .workspace.no-layers{grid-template-columns:minmax(0,1fr) 260px}.kjwb .workspace.no-inspector{grid-template-columns:232px minmax(0,1fr)}.kjwb .workspace.no-layers.no-inspector{grid-template-columns:minmax(0,1fr)}
.kjwb .side{min-width:0;background:var(--surface);border-right:1px solid var(--border);overflow:auto}.kjwb .side.right{border-right:0;border-left:1px solid var(--border)}.kjwb .side h2{height:40px;margin:0;padding:11px 12px;border-bottom:1px solid var(--border);font-size:12px;line-height:17px;font-weight:700;letter-spacing:.035em;color:var(--muted)}
.kjwb .layer{width:100%;min-height:38px;display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:7px;padding:6px 12px;border-bottom:1px solid var(--surface-subtle);text-align:left}.kjwb .layer:hover{background:var(--surface-subtle)}.kjwb .layer input{width:16px;height:16px;accent-color:var(--action)}.kjwb .layer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kjwb .layer small{min-width:24px;padding:1px 5px;border-radius:10px;background:var(--surface-subtle);color:var(--muted);font-size:12px;text-align:center}
.kjwb .canvas-wrap{position:relative;min-width:0;min-height:0;background:#081016;overflow:hidden}.kjwb.light .canvas-wrap{background:#f8fafc}.kjwb .canvas-wrap canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none}.kjwb .canvas-wrap .overlay{pointer-events:none}.kjwb .crosshair{cursor:crosshair!important}.kjwb .pan{cursor:grab!important}.kjwb .pan.dragging{cursor:grabbing!important}
.kjwb .hint{position:absolute;left:12px;bottom:12px;max-width:min(540px,calc(100% - 24px));padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius);background:#fffffff2;color:var(--muted);box-shadow:0 4px 16px #17233a14;pointer-events:none}.kjwb .snap{position:absolute;width:9px;height:9px;border:2px solid var(--brand);box-shadow:0 0 0 2px #20293680;transform:translate(-50%,-50%);pointer-events:none;display:none}
.kjwb .command{position:absolute;left:50%;bottom:48px;transform:translateX(-50%);width:min(700px,calc(100% - 28px));min-height:40px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:3px 4px 3px 11px;border:1px solid var(--border);border-radius:var(--radius);background:#fffffff5;box-shadow:0 8px 26px #17233a24}.kjwb .command span{font:12px/16px var(--kj-mono,ui-monospace,SFMono-Regular,Consolas,monospace);font-weight:700;color:var(--muted);letter-spacing:.025em}.kjwb .command input{min-width:0;height:32px;border:0;outline:0;background:transparent;color:var(--text)}.kjwb .command input::placeholder{color:#8b96a6}.kjwb .command button{height:32px;padding:0 14px;background:var(--action);border-color:var(--action);color:#fff}.kjwb .command+.hint{bottom:96px}
.kjwb .inspector{padding:12px}.kjwb .empty{margin:2px 0;color:var(--muted);line-height:1.65}.kjwb .entity-title{padding-bottom:10px;border-bottom:1px solid var(--border);font-size:16px;font-weight:700;margin-bottom:8px}.kjwb .kv{display:grid;grid-template-columns:82px minmax(0,1fr);gap:9px;padding:8px 0;border-bottom:1px solid var(--surface-subtle)}.kjwb .kv span{color:var(--muted)}.kjwb .kv b{font-weight:600;overflow:hidden;text-overflow:ellipsis}.kjwb .field{display:grid;gap:6px;margin:12px 0}.kjwb .field span{font-size:12px;font-weight:600;color:var(--muted);letter-spacing:.025em}.kjwb .field input,.kjwb .field select{min-width:0;width:100%;height:32px;padding:0 9px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);outline:0}.kjwb .field input:focus,.kjwb .field select:focus{border-color:var(--action);box-shadow:0 0 0 2px var(--action-soft)}.kjwb .apply{width:100%;height:32px;background:var(--action);border-color:var(--action);color:#fff}.kjwb .warning{margin-top:12px;padding:9px;border:1px solid #e4b95f;border-radius:var(--radius);background:#fff8e8;color:#76530c;font-size:12px}
.kjwb .statusbar{display:flex;align-items:center;gap:14px;padding:0 10px;background:var(--chrome);border-top:1px solid var(--border);color:var(--muted);font:12px/1.3 var(--kj-mono,ui-monospace,SFMono-Regular,Consolas,monospace)}.kjwb .statusbar .message{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kjwb .statusbar b{color:var(--text);font-weight:600}.kjwb .file-input{display:none}
@media(max-width:980px){.kjwb .workspace,.kjwb .workspace.no-layers{grid-template-columns:minmax(0,1fr) 230px}.kjwb .workspace.no-inspector,.kjwb .workspace.no-layers.no-inspector{grid-template-columns:minmax(0,1fr)}.kjwb .side.layers{display:none}.kjwb .panel-toggle[data-action="toggle-layers"]{display:none}.kjwb .tool{min-width:50px;padding-inline:5px}}
@media(max-width:680px){.kjwb .workspace,.kjwb .workspace.no-layers,.kjwb .workspace.no-inspector,.kjwb .workspace.no-layers.no-inspector{grid-template-columns:minmax(0,1fr)}.kjwb .side.right{display:none}.kjwb .panel-toggle{display:none!important}.kjwb .hide-small{display:none!important}.kjwb .brand{font-size:13px}.kjwb .docname{margin-left:2px}.kjwb .group{padding-inline:4px}.kjwb .appbar{gap:3px;padding-inline:6px}}
`;
function assertBrowser() {
    if (typeof document === 'undefined') throw new Error('KJDraw workbench requires a browser DOM');
}
function query(root, selector) {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`KJDraw workbench element is missing: ${selector}`);
    return element;
}
function point(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return [
        event.clientX - rect.left,
        event.clientY - rect.top
    ];
}
function formatFromName(fileName) {
    const match = /\.([a-z0-9]+)$/i.exec(fileName);
    const extension = match?.[1]?.toUpperCase();
    return extension === 'KJD' || extension === 'DXF' ? extension : undefined;
}
function sourceByteLength(source) {
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return source.byteLength;
    if (typeof Blob !== 'undefined' && source instanceof Blob) return source.size;
    return null;
}
function downloadBytes(content, name, type) {
    let part;
    if (content instanceof Uint8Array) part = content;
    else if (content instanceof ArrayBuffer) part = content;
    else part = String(content ?? '');
    const url = URL.createObjectURL(new Blob([
        part
    ], {
        type
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url), 30_000);
}
async function starterDocument(sdk) {
    return createIndustrySample(sdk, 'sample-site-plan');
}
function availableDocumentId(sdk, prefix) {
    const base = `${prefix}-${Date.now()}`;
    let documentId = base;
    let copy = 2;
    while(sdk.documents.has(documentId))documentId = `${base}-${copy++}`;
    return documentId;
}
const workbenchDocumentLeases = new WeakMap();
function acquireDocumentLease(sdk, workbench, document1, generated) {
    let leases = workbenchDocumentLeases.get(sdk);
    if (!leases) {
        leases = new Map();
        workbenchDocumentLeases.set(sdk, leases);
    }
    const current = leases.get(document1);
    const lease = current ?? {
        document: document1,
        viewers: new Set(),
        generated: false
    };
    lease.generated ||= generated;
    lease.viewers.add(workbench);
    leases.set(document1, lease);
}
function releaseDocumentLease(sdk, workbench, document1) {
    const leases = workbenchDocumentLeases.get(sdk);
    const lease = leases?.get(document1);
    if (!leases || !lease) return;
    lease.viewers.delete(workbench);
    if (lease.viewers.size) return;
    leases.delete(document1);
    if (!leases.size) workbenchDocumentLeases.delete(sdk);
    if (lease.generated && sdk.documents.get(document1.id) === document1) sdk.closeDocument(document1.id);
}
function hasOtherDocumentViewer(sdk, workbench, document1) {
    const lease = workbenchDocumentLeases.get(sdk)?.get(document1);
    if (!lease) return false;
    for (const viewer of lease.viewers)if (viewer !== workbench) return true;
    return false;
}
export class KJDrawWorkbench {
    container;
    root;
    sdk;
    renderer;
    ready;
    #options;
    #locale;
    #theme;
    #tool = 'select';
    #canvas;
    #overlay;
    #overlayContext;
    #overlayObserver = null;
    #abort = new AbortController();
    #disposeDocument = null;
    #disposeSelection = null;
    #draftStart = null;
    #draftPoints = [];
    #cursorWorld = null;
    #snapWorld = null;
    #pendingText = 'KJDraw';
    #snappableEntityIds = [];
    #panStart = null;
    #activePointer = null;
    #message = '';
    #fileName = 'drawing.kjd';
    #maxFileBytes;
    #leasedDocument = null;
    constructor(container, options = {}){
        assertBrowser();
        if (!(container instanceof HTMLElement) && !(container instanceof ShadowRoot)) throw new TypeError('KJDrawWorkbench requires an HTMLElement or ShadowRoot');
        this.container = container;
        this.#options = options;
        this.#locale = options.locale ?? 'en';
        this.#theme = options.theme ?? 'dark';
        this.#maxFileBytes = Number(options.maxFileBytes ?? 20 * 1024 * 1024);
        if (!Number.isSafeInteger(this.#maxFileBytes) || this.#maxFileBytes <= 0) throw new RangeError('maxFileBytes must be a positive safe integer');
        this.sdk = options.sdk ?? createKJDrawSDK();
        this.root = document.createElement('section');
        this.root.className = `kjwb ${this.#theme}${options.toolbar === false ? ' no-toolbar' : ''}`;
        this.root.tabIndex = 0;
        this.root.innerHTML = this.#markup();
        container.append(this.root);
        this.#canvas = query(this.root, 'canvas[data-canvas]');
        this.#overlay = query(this.root, 'canvas[data-overlay]');
        const overlayContext = this.#overlay.getContext('2d');
        if (!overlayContext) throw new Error('Canvas 2D overlay is unavailable');
        this.#overlayContext = overlayContext;
        this.renderer = new KJCanvasRenderer(this.#canvas, {
            theme: this.#theme,
            grid: options.grid ?? true
        });
        if (typeof ResizeObserver !== 'undefined') {
            this.#overlayObserver = new ResizeObserver(()=>this.#drawOverlay());
            this.#overlayObserver.observe(this.#canvas);
        }
        this.#bind();
        const initialDocument = options.document === undefined ? 'sample' : options.document;
        this.ready = this.#initialize(initialDocument);
    }
    get document() {
        return this.renderer.document;
    }
    get #selection() {
        return this.document ? this.sdk.getSelectionManager(this.document.id)?.active ?? null : null;
    }
    get locale() {
        return this.#locale;
    }
    get theme() {
        return this.#theme;
    }
    get tool() {
        return this.#tool;
    }
    setOptions(options) {
        if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed');
        if (options.maxFileBytes !== undefined) {
            const nextLimit = Number(options.maxFileBytes);
            if (!Number.isSafeInteger(nextLimit) || nextLimit <= 0) throw new RangeError('maxFileBytes must be a positive safe integer');
            this.#maxFileBytes = nextLimit;
        }
        this.#options = {
            ...this.#options,
            ...options
        };
        if (options.grid !== undefined) this.renderer.setGrid(options.grid);
        const workspace = query(this.root, '.workspace');
        workspace.classList.toggle('no-layers', this.#options.showLayers === false);
        workspace.classList.toggle('no-inspector', this.#options.showInspector === false);
        this.root.classList.toggle('no-toolbar', this.#options.toolbar === false);
        query(this.root, '.side.layers').hidden = this.#options.showLayers === false;
        query(this.root, '.side.right').hidden = this.#options.showInspector === false;
        const layersToggle = this.root.querySelector('[data-action="toggle-layers"]');
        const inspectorToggle = this.root.querySelector('[data-action="toggle-inspector"]');
        const syncPanelToggle = (button, visible)=>{
            if (!button) return;
            button.classList.toggle('active', visible);
            button.setAttribute('aria-pressed', String(visible));
        };
        syncPanelToggle(layersToggle, this.#options.showLayers !== false);
        syncPanelToggle(inspectorToggle, this.#options.showInspector !== false);
        for (const button of this.root.querySelectorAll('[data-command-template],[data-action="erase"],[data-tool]')){
            button.disabled = this.#options.readonly === true && ![
                'select',
                'pan',
                'measure'
            ].includes(button.dataset.tool ?? '');
        }
        if (this.#options.readonly && ![
            'select',
            'pan',
            'measure'
        ].includes(this.#tool)) this.setTool('select');
        this.#refreshDocumentPanels();
        this.renderer.resize();
        this.#drawOverlay();
        return this;
    }
    setLocale(locale) {
        if (locale !== 'en' && locale !== 'zh-CN') throw new RangeError(`Unsupported KJDraw workbench locale: ${String(locale)}`);
        this.#locale = locale;
        this.#updateCopy();
        this.#refreshDocumentPanels();
        this.#setMessage(this.#t('ready'));
        return this;
    }
    snapshot() {
        const drawing = this.document;
        return Object.freeze({
            locale: this.#locale,
            theme: this.#theme,
            tool: this.#tool,
            documentId: drawing?.id ?? null,
            revision: drawing?.revision ?? 0,
            entityCount: drawing?.listEntities().length ?? 0,
            selectedIds: Object.freeze([
                ...this.#selection?.ids ?? []
            ]),
            render: this.renderer.report
        });
    }
    setTheme(theme) {
        if (theme !== 'dark' && theme !== 'light') throw new RangeError(`Unsupported KJDraw workbench theme: ${String(theme)}`);
        this.#theme = theme;
        this.root.classList.toggle('dark', theme === 'dark');
        this.root.classList.toggle('light', theme === 'light');
        this.renderer.setTheme(theme);
        const toggle = this.root.querySelector('[data-action="theme"]');
        const toggleIcon = toggle?.querySelector('[data-theme-icon]');
        if (toggleIcon) toggleIcon.innerHTML = kjdrawIcon(theme === 'dark' ? 'sun' : 'moon');
        this.#refreshViewport();
        return this;
    }
    setTool(tool) {
        const tools = [
            'select',
            'pan',
            'line',
            'polyline',
            'circle',
            'arc',
            'rectangle',
            'text',
            'measure'
        ];
        if (!tools.includes(tool)) throw new RangeError(`Unsupported KJDraw workbench tool: ${String(tool)}`);
        if (this.#options.readonly && ![
            'select',
            'pan',
            'measure'
        ].includes(tool)) {
            this.#setMessage(this.#t('readonly'));
            return this;
        }
        this.#tool = tool;
        this.#draftStart = null;
        this.#draftPoints = [];
        this.#canvas.classList.toggle('crosshair', [
            'line',
            'polyline',
            'circle',
            'arc',
            'rectangle',
            'text',
            'measure'
        ].includes(tool));
        this.#canvas.classList.toggle('pan', tool === 'pan');
        for (const button of this.root.querySelectorAll('[data-tool]'))button.classList.toggle('active', button.dataset.tool === tool);
        this.#hideSnap();
        this.#drawOverlay();
        this.#setMessage(tool === 'select' ? this.#t('ready') : tool === 'text' ? this.#t('textPrompt') : this.#t('firstPoint'));
        return this;
    }
    async setDocument(document1) {
        return this.#setDocument(document1, false);
    }
    async #setDocument(document1, generated) {
        if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed');
        const registered = this.sdk.documents.get(document1.id);
        if (registered && registered !== document1) throw new Error(`A different KJDraw document is already attached with id: ${document1.id}`);
        if (!registered) this.sdk.attachDocument(document1);
        this.sdk.setActiveDocument(document1.id);
        const previousLease = this.#leasedDocument;
        const acquire = previousLease !== document1;
        if (acquire) acquireDocumentLease(this.sdk, this, document1, generated);
        try {
            this.renderer.setDocument(document1);
            this.#subscribeDocument(document1);
            this.renderer.setSelection(this.sdk.getSelectionManager(document1.id)?.active.ids ?? []);
            this.#leasedDocument = document1;
            if (previousLease && previousLease !== document1) releaseDocumentLease(this.sdk, this, previousLease);
            this.#fileName = `${document1.id}.kjd`;
            this.#refreshDocumentPanels();
            this.renderer.fit();
            this.#refreshViewport();
            this.root.dispatchEvent(new CustomEvent('kjdraw:document', {
                detail: {
                    document: document1
                },
                bubbles: true,
                composed: true
            }));
            return this;
        } catch (error) {
            if (acquire) releaseDocumentLease(this.sdk, this, document1);
            throw error;
        }
    }
    async open(source, options = {}) {
        if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed');
        const byteLength = sourceByteLength(source);
        if (byteLength != null && byteLength > this.#maxFileBytes) throw new RangeError(`${this.#t('fileTooLarge')}: ${byteLength.toLocaleString()} > ${this.#maxFileBytes.toLocaleString()} bytes`);
        const format = options.format ?? formatFromName(options.fileName ?? '');
        const result = await this.sdk.fileAdapters.read(source, {
            ...options,
            ...format === undefined ? {} : {
                format
            }
        });
        if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed');
        if (!(result instanceof KJDocument) && (!result || typeof result !== 'object' || Array.isArray(result))) throw new Error('File adapter did not return a drawing');
        const drawing = result instanceof KJDocument ? result : KJDocument.open(result);
        const previous = this.sdk.documents.get(drawing.id);
        if (previous && previous !== drawing) {
            if (previous !== this.document) throw new Error(`Another drawing is already open with id: ${drawing.id}`);
            if (hasOtherDocumentViewer(this.sdk, this, previous)) {
                throw new Error(`Drawing ${drawing.id} is shared by another KJDraw workbench; load it as a separate document before reopening`);
            }
            this.#releaseCurrentDocumentLease();
            this.sdk.closeDocument(drawing.id);
        }
        await this.setDocument(drawing);
        this.#fileName = options.fileName ?? `${drawing.id}.${String(format ?? 'kjd').toLowerCase()}`;
        this.#setMessage(`${this.#t('open')} · ${this.#fileName}`);
        return drawing;
    }
    async execute(command, args = {}) {
        if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed');
        if (this.#options.readonly && ![
            'SELECT',
            'SEARCH',
            'FIND',
            'LENGTH',
            'AREA',
            'DISTANCE',
            'NEAREST',
            'INTERSECT',
            'ANGLE'
        ].includes(command.toUpperCase())) throw new Error('This editor is read only');
        const drawing = this.document;
        if (!drawing) throw new Error('No active KJDraw document');
        if (this.sdk.documents.get(drawing.id) !== drawing) throw new Error('This drawing was closed or replaced by the host; setDocument before editing');
        this.#activateDocument();
        const receipt = await this.sdk.executeCommand(this.sdk.createCommandEnvelope(command, args, {
            document: drawing,
            expectedRevision: drawing.revision,
            origin: 'ui'
        }));
        this.#setMessage(`${command} · REV ${drawing.revision}`);
        this.#refreshViewport();
        return receipt;
    }
    async save(format = 'KJD', options = {}) {
        if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed');
        const drawing = this.document;
        if (!drawing) throw new Error('No active KJDraw document');
        const output = await this.sdk.writeDocument(drawing, {
            ...options,
            format,
            ...format === 'DXF' && options.version == null ? {
                version: '2018'
            } : {}
        });
        if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed');
        if (options.download !== false) {
            const extension = format.toLowerCase();
            const base = (options.fileName ?? this.#fileName).replace(/\.[^.]+$/, '') || drawing.id;
            downloadBytes(output, `${base}.${extension}`, format === 'DXF' ? 'application/dxf' : 'application/vnd.kanjie.kjdraw+json');
        }
        this.#setMessage(`${format} · ${drawing.fingerprint()}`);
        return output;
    }
    dispose() {
        if (this.#abort.signal.aborted) return;
        this.#abort.abort();
        this.#disposeDocument?.();
        this.#disposeDocument = null;
        this.#disposeSelection?.();
        this.#disposeSelection = null;
        this.#overlayObserver?.disconnect();
        this.#overlayObserver = null;
        this.renderer.dispose();
        this.root.remove();
        this.#releaseCurrentDocumentLease();
    }
    async #initialize(input) {
        try {
            const drawing = input && typeof input === 'object' ? input : input === 'blank' || input === null ? this.sdk.createDocument({
                documentId: availableDocumentId(this.sdk, 'drawing'),
                units: 'millimeter'
            }) : await starterDocument(this.sdk);
            const generated = input === null || typeof input === 'string';
            if (this.#abort.signal.aborted) {
                if (generated) {
                    if (this.sdk.documents.get(drawing.id) === drawing) this.sdk.closeDocument(drawing.id);
                }
                return this;
            }
            await this.#setDocument(drawing, generated);
            this.#setMessage(this.#t('ready'));
            return this;
        } catch (error) {
            this.#handleError(error);
            throw error;
        }
    }
    #markup() {
        const t = (key)=>this.#t(key);
        const icon = (name, attributes = '')=>`<span class="icon" aria-hidden="true" ${attributes}>${kjdrawIcon(name)}</span>`;
        const readonly = this.#options.readonly === true;
        const showLayers = this.#options.showLayers !== false;
        const showInspector = this.#options.showInspector !== false;
        return `<style>${KJDRAW_THEME_CSS}\n${WORKBENCH_STYLE}\n.kjwb [hidden]{display:none!important}.kjwb.no-toolbar{grid-template-rows:44px 0 minmax(300px,1fr) 32px}.kjwb.no-toolbar .ribbon{display:none}</style>
      <header class="appbar"><span class="mark" aria-hidden="true">${icon('logo')}</span><span class="brand">KJDraw</span><span class="docname" data-document-name>${t('sample')}</span><span class="spacer"></span>
        <input class="file-input" type="file" accept=".dxf,.kjd" aria-label="${t('open')}" data-file>
        <button type="button" class="panel-toggle hide-small ${showLayers ? 'active' : ''}" data-action="toggle-layers" aria-pressed="${showLayers}">${icon('layers')}<span data-copy="layers">${t('layers')}</span></button>
        <button type="button" class="panel-toggle hide-small ${showInspector ? 'active' : ''}" data-action="toggle-inspector" aria-pressed="${showInspector}">${icon('panel')}<span data-copy="properties">${t('properties')}</span></button>
        <button type="button" data-action="open">${icon('open')}<span data-copy="open">${t('open')}</span></button><button type="button" class="hide-small" data-action="save-kjd">${icon('save')}<span data-copy="saveKjd">${t('saveKjd')}</span></button><button type="button" class="primary" data-action="save-dxf">${icon('export')}<span data-copy="exportDxf">${t('exportDxf')}</span></button><button type="button" data-action="theme" data-copy-title="theme" title="${t('theme')}">${icon(this.#theme === 'dark' ? 'sun' : 'moon', 'data-theme-icon')}</button><button type="button" data-action="language"><span data-copy="language">${t('language')}</span></button>
      </header>
      <nav class="ribbon" aria-label="CAD tools">
        <div class="group"><button type="button" class="tool active" data-tool="select">${icon('select')}<small data-copy="select">${t('select')}</small></button><button type="button" class="tool" data-tool="pan">${icon('pan')}<small data-copy="pan">${t('pan')}</small></button><span data-copy="view">${t('view')}</span></div>
        <div class="group"><button type="button" class="tool" data-tool="line" ${readonly ? 'disabled' : ''}>${icon('line')}<small data-copy="line">${t('line')}</small></button><button type="button" class="tool" data-tool="polyline" ${readonly ? 'disabled' : ''}>${icon('polyline')}<small data-copy="polyline">${t('polyline')}</small></button><button type="button" class="tool" data-tool="circle" ${readonly ? 'disabled' : ''}>${icon('circle')}<small data-copy="circle">${t('circle')}</small></button><button type="button" class="tool" data-tool="arc" ${readonly ? 'disabled' : ''}>${icon('arc')}<small data-copy="arc">${t('arc')}</small></button><button type="button" class="tool" data-tool="rectangle" ${readonly ? 'disabled' : ''}>${icon('rectangle')}<small data-copy="rectangle">${t('rectangle')}</small></button><button type="button" class="tool" data-tool="text" ${readonly ? 'disabled' : ''}>${icon('text')}<small data-copy="text">${t('text')}</small></button><span data-copy="draw">${t('draw')}</span></div>
        <div class="group"><button type="button" class="tool" data-command-template="MOVE 10 0" ${readonly ? 'disabled' : ''}>${icon('move')}<small data-copy="move">${t('move')}</small></button><button type="button" class="tool" data-command-template="COPY 10 0" ${readonly ? 'disabled' : ''}>${icon('copy')}<small data-copy="copy">${t('copy')}</small></button><button type="button" class="tool" data-command-template="ROTATE 15" ${readonly ? 'disabled' : ''}>${icon('rotate')}<small data-copy="rotate">${t('rotate')}</small></button><button type="button" class="tool" data-command-template="OFFSET 2" ${readonly ? 'disabled' : ''}>${icon('offset')}<small data-copy="offset">${t('offset')}</small></button><button type="button" class="tool" data-action="undo" ${readonly ? 'disabled' : ''}>${icon('undo')}<small data-copy="undo">${t('undo')}</small></button><button type="button" class="tool" data-action="redo" ${readonly ? 'disabled' : ''}>${icon('redo')}<small data-copy="redo">${t('redo')}</small></button><button type="button" class="tool" data-action="erase" ${readonly ? 'disabled' : ''}>${icon('delete')}<small data-copy="erase">${t('erase')}</small></button><span data-copy="modify">${t('modify')}</span></div>
        <div class="group"><button type="button" class="tool" data-action="fit">${icon('fit')}<small data-copy="fit">${t('fit')}</small></button><button type="button" class="tool" data-action="grid">${icon('grid')}<small data-copy="grid">${t('grid')}</small></button><button type="button" class="tool" data-tool="measure">${icon('measure')}<small data-copy="measure">${t('measure')}</small></button><span data-copy="view">${t('view')}</span></div>
      </nav>
      <div class="workspace ${this.#options.showLayers === false ? 'no-layers' : ''} ${this.#options.showInspector === false ? 'no-inspector' : ''}">
        <aside class="side layers" ${this.#options.showLayers === false ? 'hidden' : ''}><h2 data-copy="layers">${t('layers')}</h2><div data-layers></div></aside>
        <main class="canvas-wrap"><canvas class="cad-canvas" data-canvas aria-label="KJDraw CAD canvas"></canvas><canvas class="overlay" data-overlay aria-hidden="true"></canvas><span class="snap" data-snap></span><div class="command"><span data-copy="command">${t('command')}</span><input data-command aria-label="${t('command')}" placeholder="${t('commandHint')}" autocomplete="off"><button type="button" data-action="run-command" data-copy="run">${t('run')}</button></div><div class="hint" data-hint>${t('ready')}</div></main>
        <aside class="side right" ${this.#options.showInspector === false ? 'hidden' : ''}><h2 data-copy="properties">${t('properties')}</h2><div class="inspector" data-inspector><p class="empty">${t('noSelection')}</p></div></aside>
      </div>
      <footer class="statusbar"><span class="message" data-message>${readonly ? t('readonly') : t('ready')}</span><span data-coordinate>X 0.000 · Y 0.000</span><span data-selection>0 ${t('selected')}</span><b data-count>0 ${t('entities')}</b><span data-revision>REV 0</span><span data-zoom>100%</span></footer>`;
    }
    #bind() {
        const signal = this.#abort.signal;
        this.root.addEventListener('focusin', ()=>this.#activateDocument(), {
            signal
        });
        this.root.addEventListener('pointerdown', ()=>this.#activateDocument(), {
            signal
        });
        for (const button of this.root.querySelectorAll('[data-tool]'))button.addEventListener('click', ()=>this.setTool(button.dataset.tool), {
            signal
        });
        for (const button of this.root.querySelectorAll('[data-command-template]'))button.addEventListener('click', ()=>{
            const input = query(this.root, '[data-command]');
            input.value = button.dataset.commandTemplate ?? '';
            input.focus();
            input.select();
        }, {
            signal
        });
        query(this.root, '[data-action="open"]').addEventListener('click', ()=>query(this.root, '[data-file]').click(), {
            signal
        });
        query(this.root, '[data-file]').addEventListener('change', (event)=>{
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            void this.#run(async ()=>{
                try {
                    if (file.size > this.#maxFileBytes) throw new RangeError(`${this.#t('fileTooLarge')}: ${file.size.toLocaleString()} > ${this.#maxFileBytes.toLocaleString()} bytes`);
                    await this.open(new Uint8Array(await file.arrayBuffer()), {
                        fileName: file.name
                    });
                } finally{
                    input.value = '';
                }
            });
        }, {
            signal
        });
        query(this.root, '[data-action="save-kjd"]').addEventListener('click', ()=>void this.#run(()=>this.save('KJD')), {
            signal
        });
        query(this.root, '[data-action="save-dxf"]').addEventListener('click', ()=>void this.#run(()=>this.save('DXF')), {
            signal
        });
        query(this.root, '[data-action="undo"]').addEventListener('click', ()=>void this.#run(()=>this.execute('UNDO')), {
            signal
        });
        query(this.root, '[data-action="redo"]').addEventListener('click', ()=>void this.#run(()=>this.execute('REDO')), {
            signal
        });
        query(this.root, '[data-action="erase"]').addEventListener('click', ()=>void this.#eraseSelection(), {
            signal
        });
        query(this.root, '[data-action="toggle-layers"]').addEventListener('click', ()=>this.setOptions({
                showLayers: this.#options.showLayers === false
            }), {
            signal
        });
        query(this.root, '[data-action="toggle-inspector"]').addEventListener('click', ()=>this.setOptions({
                showInspector: this.#options.showInspector === false
            }), {
            signal
        });
        query(this.root, '[data-action="fit"]').addEventListener('click', ()=>{
            this.renderer.fit();
            this.#refreshViewport();
        }, {
            signal
        });
        query(this.root, '[data-action="grid"]').addEventListener('click', ()=>{
            this.renderer.setGrid(!this.renderer.grid);
            this.#refreshViewport();
        }, {
            signal
        });
        query(this.root, '[data-action="theme"]').addEventListener('click', ()=>this.setTheme(this.#theme === 'dark' ? 'light' : 'dark'), {
            signal
        });
        query(this.root, '[data-action="language"]').addEventListener('click', ()=>this.setLocale(this.#locale === 'en' ? 'zh-CN' : 'en'), {
            signal
        });
        const commandInput = query(this.root, '[data-command]');
        query(this.root, '[data-action="run-command"]').addEventListener('click', ()=>void this.#runCommand(), {
            signal
        });
        commandInput.addEventListener('keydown', (event)=>{
            if (event.key === 'Enter') {
                event.preventDefault();
                void this.#runCommand();
            }
        }, {
            signal
        });
        this.#canvas.addEventListener('wheel', (event)=>{
            event.preventDefault();
            this.renderer.zoomAt(Math.exp(-event.deltaY * 0.0015), point(event, this.#canvas));
            this.#refreshViewport();
        }, {
            signal,
            passive: false
        });
        this.#canvas.addEventListener('pointerdown', (event)=>this.#pointerDown(event), {
            signal
        });
        this.#canvas.addEventListener('pointermove', (event)=>this.#pointerMove(event), {
            signal
        });
        this.#canvas.addEventListener('pointerup', (event)=>void this.#pointerUp(event), {
            signal
        });
        this.#canvas.addEventListener('pointercancel', ()=>{
            this.#cancelPointer();
            this.#hideSnap();
        }, {
            signal
        });
        this.#canvas.addEventListener('pointerleave', ()=>{
            this.#cursorWorld = null;
            this.#hideSnap();
            this.#drawOverlay();
        }, {
            signal
        });
        this.#canvas.addEventListener('dblclick', (event)=>{
            if (this.#tool === 'polyline') {
                event.preventDefault();
                void this.#finishPolyline();
            }
        }, {
            signal
        });
        this.root.addEventListener('keydown', (event)=>{
            if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
            if (event.key === 'Escape') {
                this.#draftStart = null;
                this.#draftPoints = [];
                this.setTool('select');
            }
            if (event.key === 'Enter' && this.#tool === 'polyline' && this.#draftPoints.length >= 2) {
                event.preventDefault();
                void this.#finishPolyline();
            }
            if (!this.#options.readonly && (event.key === 'Delete' || event.key === 'Backspace')) {
                event.preventDefault();
                void this.#eraseSelection();
            }
            if (!this.#options.readonly && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                void this.#run(()=>this.execute(event.shiftKey ? 'REDO' : 'UNDO'));
            }
            if (!this.#options.readonly && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
                event.preventDefault();
                void this.#run(()=>this.execute('REDO'));
            }
            if (event.key.toLowerCase() === 'f') {
                this.renderer.fit();
                this.#refreshViewport();
            }
        }, {
            signal
        });
    }
    #subscribeDocument(drawing) {
        this.#disposeDocument?.();
        this.#disposeSelection?.();
        this.#disposeDocument = drawing.on('document:change', ()=>{
            this.#refreshDocumentPanels();
            const change = {
                document: drawing,
                revision: drawing.revision,
                entityCount: drawing.listEntities().length
            };
            this.#options.onChange?.(change);
            this.root.dispatchEvent(new CustomEvent('kjdraw:change', {
                detail: change,
                bubbles: true,
                composed: true
            }));
        });
        const selection = this.sdk.getSelectionManager(drawing.id)?.active;
        this.#disposeSelection = selection?.onChange(()=>{
            this.renderer.setSelection(selection.ids);
            this.#refreshSelectionPanels();
            this.#drawOverlay();
            this.root.dispatchEvent(new CustomEvent('kjdraw:selection', {
                detail: {
                    document: drawing,
                    ids: selection.ids
                },
                bubbles: true,
                composed: true
            }));
        }) ?? null;
    }
    #activateDocument() {
        const drawing = this.document;
        if (!drawing || this.sdk.documents.get(drawing.id) !== drawing || this.sdk.activeDocumentId === drawing.id) return;
        this.sdk.setActiveDocument(drawing.id);
    }
    #releaseCurrentDocumentLease() {
        const drawing = this.#leasedDocument;
        if (!drawing) return;
        this.#leasedDocument = null;
        releaseDocumentLease(this.sdk, this, drawing);
    }
    async #runCommand() {
        const input = query(this.root, '[data-command]');
        const raw = input.value.trim();
        if (!raw) return;
        const separator = raw.search(/\s/);
        const command = (separator < 0 ? raw : raw.slice(0, separator)).toUpperCase();
        const remainder = separator < 0 ? '' : raw.slice(separator).trim();
        const tokens = remainder ? remainder.split(/\s+/) : [];
        const values = tokens.map(Number);
        const finiteValues = (count)=>{
            if (values.length !== count || values.some((value)=>!Number.isFinite(value))) throw new Error(`${command} expects ${count} numeric values`);
            return values;
        };
        const selectedIds = ()=>{
            const ids = [
                ...this.#selection?.ids ?? []
            ];
            if (!ids.length) throw new Error(`${command} requires a selection`);
            return ids;
        };
        const result = await this.#run(async ()=>{
            if (command === 'FIT' || command === 'EXTENTS') {
                this.renderer.fit();
                this.#refreshViewport();
                return;
            }
            if (remainder.startsWith('{')) {
                if (this.#options.readonly) throw new Error(this.#t('readonly'));
                const parsed = JSON.parse(remainder);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Command JSON arguments must be an object');
                await this.execute(command, parsed);
                return;
            }
            if (this.#options.readonly && ![
                'PAN',
                'SELECT',
                'MEASURE'
            ].includes(command)) throw new Error(this.#t('readonly'));
            if (command === 'PAN' || command === 'SELECT' || command === 'MEASURE') {
                this.setTool(command.toLowerCase());
                return;
            }
            if (command === 'PL' || command === 'PLINE' || command === 'POLYLINE') {
                if (!tokens.length) {
                    this.setTool('polyline');
                    return;
                }
                if (values.length < 4 || values.length % 2 !== 0 || values.some((value)=>!Number.isFinite(value))) throw new Error('POLYLINE expects at least two x y pairs');
                const vertices = Array.from({
                    length: values.length / 2
                }, (_, index)=>({
                        point: [
                            values[index * 2],
                            values[index * 2 + 1],
                            0
                        ]
                    }));
                await this.execute('CREATE', {
                    type: 'LWPOLYLINE',
                    payload: {
                        vertices,
                        closed: false,
                        ...this.#activeLayerPayload()
                    }
                });
                return;
            }
            if (command === 'L' || command === 'LINE') {
                if (!tokens.length) {
                    this.setTool('line');
                    return;
                }
                const [x1, y1, x2, y2] = finiteValues(4);
                await this.execute('CREATE', {
                    type: 'LINE',
                    payload: {
                        start: [
                            x1,
                            y1,
                            0
                        ],
                        end: [
                            x2,
                            y2,
                            0
                        ],
                        ...this.#activeLayerPayload()
                    }
                });
                return;
            }
            if (command === 'C' || command === 'CIRCLE') {
                if (!tokens.length) {
                    this.setTool('circle');
                    return;
                }
                const [x, y, radius] = finiteValues(3);
                if (radius <= 0) throw new Error('CIRCLE radius must be positive');
                await this.execute('CREATE', {
                    type: 'CIRCLE',
                    payload: {
                        center: [
                            x,
                            y,
                            0
                        ],
                        radius,
                        ...this.#activeLayerPayload()
                    }
                });
                return;
            }
            if (command === 'REC' || command === 'RECTANG' || command === 'RECTANGLE') {
                if (!tokens.length) {
                    this.setTool('rectangle');
                    return;
                }
                const [x1, y1, x2, y2] = finiteValues(4);
                const vertices = [
                    [
                        x1,
                        y1,
                        0
                    ],
                    [
                        x2,
                        y1,
                        0
                    ],
                    [
                        x2,
                        y2,
                        0
                    ],
                    [
                        x1,
                        y2,
                        0
                    ]
                ].map((value)=>({
                        point: value
                    }));
                await this.execute('CREATE', {
                    type: 'LWPOLYLINE',
                    payload: {
                        vertices,
                        closed: true,
                        ...this.#activeLayerPayload()
                    }
                });
                return;
            }
            if (command === 'A' || command === 'ARC') {
                if (!tokens.length) {
                    this.setTool('arc');
                    return;
                }
                const [cx, cy, sx, sy, ex, ey] = finiteValues(6);
                const radius = Math.hypot(sx - cx, sy - cy);
                if (radius <= 1e-12) throw new Error('ARC start point must differ from its center');
                await this.execute('CREATE', {
                    type: 'ARC',
                    payload: {
                        center: [
                            cx,
                            cy,
                            0
                        ],
                        radius,
                        startAngle: Math.atan2(sy - cy, sx - cx),
                        endAngle: Math.atan2(ey - cy, ex - cx),
                        clockwise: false,
                        ...this.#activeLayerPayload()
                    }
                });
                return;
            }
            if (command === 'T' || command === 'TEXT') {
                const x = Number(tokens[0]), y = Number(tokens[1]);
                if (tokens.length >= 3 && Number.isFinite(x) && Number.isFinite(y)) {
                    const text = tokens.slice(2).join(' ');
                    await this.execute('CREATE', {
                        type: 'TEXT',
                        payload: {
                            position: [
                                x,
                                y,
                                0
                            ],
                            text,
                            height: Math.max(1, 16 / this.renderer.camera.scale),
                            rotation: 0,
                            ...this.#activeLayerPayload()
                        }
                    });
                } else {
                    this.#pendingText = remainder || 'KJDraw';
                    this.setTool('text');
                }
                return;
            }
            if (command === 'E' || command === 'ERASE' || command === 'DELETE') {
                await this.#eraseSelection();
                return;
            }
            if (command === 'M' || command === 'MOVE' || command === 'CO' || command === 'CP' || command === 'COPY') {
                const [dx, dy] = finiteValues(2);
                await this.execute(command === 'M' || command === 'MOVE' ? 'MOVE' : 'COPY', {
                    ids: selectedIds(),
                    dx,
                    dy
                });
                return;
            }
            if (command === 'RO' || command === 'ROTATE') {
                const [angleDegrees] = finiteValues(1);
                const ids = selectedIds();
                await this.execute('ROTATE', {
                    ids,
                    angleDegrees,
                    center: this.#selectionCenter(ids)
                });
                return;
            }
            if (command === 'SC' || command === 'SCALE') {
                const [factor] = finiteValues(1);
                const ids = selectedIds();
                await this.execute('SCALE', {
                    ids,
                    factor,
                    center: this.#selectionCenter(ids)
                });
                return;
            }
            if (command === 'O' || command === 'OFFSET') {
                const [distance] = finiteValues(1);
                const ids = selectedIds();
                if (ids.length !== 1) throw new Error('OFFSET requires exactly one selected entity');
                await this.execute('OFFSET', {
                    id: ids[0],
                    distance
                });
                return;
            }
            if (!remainder) {
                await this.execute(command);
                return;
            }
            throw new Error(`${command} arguments must use JSON, for example: ${command} {"id":"..."}`);
        });
        if (result !== null) input.value = '';
    }
    #activeLayerPayload() {
        const layerId = this.document?.getTable('layers')?.currentId;
        return layerId ? {
            layerId
        } : {};
    }
    #selectionCenter(ids) {
        const drawing = this.document;
        if (!drawing) return [
            0,
            0
        ];
        const points = [];
        const add = (value)=>{
            if (!Array.isArray(value)) return;
            const x = Number(value[0]), y = Number(value[1]);
            if (Number.isFinite(x) && Number.isFinite(y)) points.push([
                x,
                y
            ]);
        };
        for (const id of ids){
            const entity = drawing.getObject(id);
            if (!entity || entity.kind !== 'entity') continue;
            const payload = entity.payload;
            for (const key of [
                'start',
                'end',
                'center',
                'position',
                'insertionPoint',
                'origin'
            ])add(payload[key]);
            if (Array.isArray(payload.vertices)) for (const vertex of payload.vertices)add(vertex && typeof vertex === 'object' && 'point' in vertex ? vertex.point : vertex);
        }
        if (!points.length) return [
            0,
            0
        ];
        const xs = points.map((value)=>value[0]), ys = points.map((value)=>value[1]);
        return [
            (Math.min(...xs) + Math.max(...xs)) / 2,
            (Math.min(...ys) + Math.max(...ys)) / 2
        ];
    }
    #visibleModelEntityIds() {
        const drawing = this.document;
        if (!drawing) return [];
        const modelSpaceId = drawing.snapshot().spaces.modelSpaceId;
        const layers = new Map(drawing.getTable('layers')?.records.map((layer)=>[
                layer.id,
                layer.payload
            ]) ?? []);
        return drawing.listEntities({
            ownerId: modelSpaceId
        }).filter((entity)=>{
            const layer = layers.get(String(entity.payload.layerId ?? ''));
            return layer?.visible !== false && layer?.frozen !== true;
        }).map((entity)=>entity.id);
    }
    #snapAt(world) {
        const drawing = this.document;
        if (!drawing || !this.#snappableEntityIds.length) return null;
        const candidate = this.sdk.snap(world, {
            document: drawing,
            entityIds: this.#snappableEntityIds,
            radius: 10 / this.renderer.camera.scale,
            modes: [
                'endpoint',
                'midpoint',
                'center',
                'nearest'
            ]
        })[0];
        return candidate ? [
            candidate.point[0],
            candidate.point[1]
        ] : null;
    }
    #showSnap(world) {
        const marker = this.root.querySelector('[data-snap]');
        if (!marker || !world) {
            this.#hideSnap();
            return;
        }
        this.#snapWorld = world;
        const screen = this.renderer.worldToScreen(world);
        marker.style.display = 'block';
        marker.style.left = `${screen[0]}px`;
        marker.style.top = `${screen[1]}px`;
    }
    #hideSnap() {
        this.#snapWorld = null;
        const marker = this.root.querySelector('[data-snap]');
        if (marker) marker.style.display = 'none';
    }
    #pointerDown(event) {
        this.root.focus();
        const location = point(event, this.#canvas);
        if (event.button === 1 || this.#tool === 'pan') {
            event.preventDefault();
            this.#panStart = location;
            this.#activePointer = event.pointerId;
            this.#canvas.setPointerCapture(event.pointerId);
            this.#canvas.classList.add('dragging');
        }
    }
    #pointerMove(event) {
        const location = point(event, this.#canvas), rawWorld = this.renderer.screenToWorld(location);
        const coordinate = this.root.querySelector('[data-coordinate]');
        if (coordinate) coordinate.textContent = `X ${rawWorld[0].toFixed(3)} · Y ${rawWorld[1].toFixed(3)}`;
        if (this.#panStart && this.#activePointer === event.pointerId) {
            this.renderer.panBy(location[0] - this.#panStart[0], location[1] - this.#panStart[1]);
            this.#panStart = location;
            this.#cursorWorld = null;
            this.#hideSnap();
            this.#refreshViewport();
            return;
        }
        const drawingTool = [
            'line',
            'polyline',
            'circle',
            'arc',
            'rectangle',
            'text',
            'measure'
        ].includes(this.#tool);
        const snapped = drawingTool ? this.#snapAt(rawWorld) : null;
        this.#cursorWorld = snapped ?? rawWorld;
        this.#showSnap(snapped);
        this.#drawOverlay();
    }
    async #pointerUp(event) {
        if (this.#activePointer === event.pointerId) {
            this.#cancelPointer();
            return;
        }
        if (event.button !== 0 || !this.document) return;
        const location = point(event, this.#canvas);
        const rawWorld = this.renderer.screenToWorld(location);
        const snapped = [
            'line',
            'polyline',
            'circle',
            'arc',
            'rectangle',
            'text',
            'measure'
        ].includes(this.#tool) ? this.#snapAt(rawWorld) : null;
        const world = snapped ?? rawWorld;
        this.#cursorWorld = world;
        if (this.#tool === 'select') {
            const hit = this.renderer.hitTest(location, 9);
            if (event.shiftKey && !hit) return;
            const operation = event.shiftKey ? this.#selection?.has(hit.entity.id) ? 'remove' : 'add' : 'replace';
            await this.sdk.executeCommand('SELECT', {
                ids: hit ? [
                    hit.entity.id
                ] : [],
                operation
            }, {
                document: this.document
            });
            return;
        }
        if (this.#tool === 'pan') return;
        if (this.#tool === 'text') {
            if (this.#options.readonly) return;
            await this.#run(()=>this.execute('CREATE', {
                    type: 'TEXT',
                    payload: {
                        position: [
                            ...world,
                            0
                        ],
                        text: this.#pendingText,
                        height: Math.max(1, 16 / this.renderer.camera.scale),
                        rotation: 0,
                        ...this.#activeLayerPayload()
                    }
                }));
            this.#setMessage(this.#t('textPrompt'));
            this.#drawOverlay();
            return;
        }
        if (this.#tool === 'polyline') {
            const previous = this.#draftPoints.at(-1);
            if (!previous || Math.hypot(previous[0] - world[0], previous[1] - world[1]) > 1e-12) this.#draftPoints.push(world);
            this.#setMessage(this.#draftPoints.length < 2 ? this.#t('nextPoint') : this.#t('finishPolyline'));
            this.#drawOverlay();
            return;
        }
        if (this.#tool === 'arc') {
            this.#draftPoints.push(world);
            if (this.#draftPoints.length === 1) this.#setMessage(this.#t('arcStart'));
            else if (this.#draftPoints.length === 2) this.#setMessage(this.#t('arcEnd'));
            else {
                const [center, start, end] = this.#draftPoints;
                this.#draftPoints = [];
                const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
                if (radius <= 1e-12) {
                    this.#handleError(new Error('ARC start point must differ from its center'));
                    this.#drawOverlay();
                    return;
                }
                await this.#run(()=>this.execute('CREATE', {
                        type: 'ARC',
                        payload: {
                            center: [
                                ...center,
                                0
                            ],
                            radius,
                            startAngle: Math.atan2(start[1] - center[1], start[0] - center[0]),
                            endAngle: Math.atan2(end[1] - center[1], end[0] - center[0]),
                            clockwise: false,
                            ...this.#activeLayerPayload()
                        }
                    }));
                this.#setMessage(this.#t('firstPoint'));
            }
            this.#drawOverlay();
            return;
        }
        if (!this.#draftStart) {
            this.#draftStart = world;
            this.#setMessage(this.#t('nextPoint'));
            this.#drawOverlay();
            return;
        }
        const start = this.#draftStart;
        this.#draftStart = null;
        if (this.#tool === 'measure') {
            const distance = Math.hypot(world[0] - start[0], world[1] - start[1]);
            this.#setMessage(`${this.#t('measured')}: ${distance.toFixed(3)}`);
            this.#drawOverlay();
            return;
        }
        if (this.#options.readonly) return;
        let type = 'LINE', payload = {
            start: [
                ...start,
                0
            ],
            end: [
                ...world,
                0
            ],
            ...this.#activeLayerPayload()
        };
        if (this.#tool === 'circle') {
            type = 'CIRCLE';
            payload = {
                center: [
                    ...start,
                    0
                ],
                radius: Math.hypot(world[0] - start[0], world[1] - start[1]),
                ...this.#activeLayerPayload()
            };
        } else if (this.#tool === 'rectangle') {
            type = 'LWPOLYLINE';
            payload = {
                vertices: [
                    [
                        start[0],
                        start[1],
                        0
                    ],
                    [
                        world[0],
                        start[1],
                        0
                    ],
                    [
                        world[0],
                        world[1],
                        0
                    ],
                    [
                        start[0],
                        world[1],
                        0
                    ]
                ].map((value)=>({
                        point: value
                    })),
                closed: true,
                ...this.#activeLayerPayload()
            };
        }
        await this.#run(()=>this.execute('CREATE', {
                type,
                payload
            }));
        this.#setMessage(this.#t('firstPoint'));
        this.#drawOverlay();
    }
    async #finishPolyline() {
        if (this.#options.readonly) return;
        if (this.#draftPoints.length < 2) {
            this.#setMessage(this.#t('nextPoint'));
            return;
        }
        const vertices = this.#draftPoints.map((value)=>({
                point: [
                    value[0],
                    value[1],
                    0
                ]
            }));
        this.#draftPoints = [];
        await this.#run(()=>this.execute('CREATE', {
                type: 'LWPOLYLINE',
                payload: {
                    vertices,
                    closed: false,
                    ...this.#activeLayerPayload()
                }
            }));
        this.#setMessage(this.#t('firstPoint'));
        this.#drawOverlay();
    }
    #cancelPointer() {
        if (this.#activePointer != null && this.#canvas.hasPointerCapture(this.#activePointer)) this.#canvas.releasePointerCapture(this.#activePointer);
        this.#activePointer = null;
        this.#panStart = null;
        this.#canvas.classList.remove('dragging');
    }
    async #eraseSelection() {
        const ids = this.#selection?.ids ?? [];
        const drawing = this.document;
        if (!ids.length || this.#options.readonly || !drawing) return;
        const receipt = await this.#run(()=>this.execute('ERASE', {
                ids
            }));
        if (!receipt) return;
        await this.sdk.executeCommand('SELECT', {
            ids: [],
            operation: 'clear'
        }, {
            document: drawing
        });
    }
    #drawOverlay() {
        const rect = this.#canvas.getBoundingClientRect();
        const width = Math.max(1, this.#canvas.width), height = Math.max(1, this.#canvas.height);
        if (this.#overlay.width !== width) this.#overlay.width = width;
        if (this.#overlay.height !== height) this.#overlay.height = height;
        const context = this.#overlayContext;
        const cssWidth = Math.max(1, rect.width || this.#canvas.clientWidth || width);
        const cssHeight = Math.max(1, rect.height || this.#canvas.clientHeight || height);
        context.setTransform(width / cssWidth, 0, 0, height / cssHeight, 0, 0);
        context.clearRect(0, 0, cssWidth, cssHeight);
        const cursor = this.#cursorWorld;
        const screen = (value)=>this.renderer.worldToScreen(value);
        context.save();
        context.strokeStyle = this.#theme === 'dark' ? '#a4ef55' : '#1769e0';
        context.fillStyle = context.strokeStyle;
        context.lineWidth = 1.5;
        context.setLineDash([
            6,
            4
        ]);
        if (this.#tool === 'polyline' && this.#draftPoints.length) {
            const points = cursor ? [
                ...this.#draftPoints,
                cursor
            ] : this.#draftPoints;
            context.beginPath();
            points.forEach((value, index)=>{
                const projected = screen(value);
                if (index === 0) context.moveTo(projected[0], projected[1]);
                else context.lineTo(projected[0], projected[1]);
            });
            context.stroke();
        } else if (this.#tool === 'arc' && this.#draftPoints.length && cursor) {
            const center = this.#draftPoints[0], centerScreen = screen(center);
            if (this.#draftPoints.length === 1) {
                const end = screen(cursor);
                context.beginPath();
                context.moveTo(centerScreen[0], centerScreen[1]);
                context.lineTo(end[0], end[1]);
                context.stroke();
            } else {
                const start = this.#draftPoints[1];
                const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
                const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
                const endAngle = Math.atan2(cursor[1] - center[1], cursor[0] - center[0]);
                context.beginPath();
                context.arc(centerScreen[0], centerScreen[1], radius * this.renderer.camera.scale, -startAngle, -endAngle, true);
                context.stroke();
            }
        } else if (this.#draftStart && cursor) {
            const start = screen(this.#draftStart), end = screen(cursor);
            if (this.#tool === 'circle') {
                context.beginPath();
                context.arc(start[0], start[1], Math.hypot(end[0] - start[0], end[1] - start[1]), 0, Math.PI * 2);
                context.stroke();
            } else if (this.#tool === 'rectangle') {
                context.strokeRect(start[0], start[1], end[0] - start[0], end[1] - start[1]);
            } else {
                context.beginPath();
                context.moveTo(start[0], start[1]);
                context.lineTo(end[0], end[1]);
                context.stroke();
            }
        } else if (this.#tool === 'text' && cursor) {
            const insertion = screen(cursor);
            context.setLineDash([]);
            context.font = '13px ui-monospace, SFMono-Regular, Consolas, monospace';
            context.fillText(this.#pendingText, insertion[0] + 5, insertion[1] - 5);
            context.beginPath();
            context.moveTo(insertion[0] - 4, insertion[1]);
            context.lineTo(insertion[0] + 4, insertion[1]);
            context.moveTo(insertion[0], insertion[1] - 4);
            context.lineTo(insertion[0], insertion[1] + 4);
            context.stroke();
        }
        context.setLineDash([]);
        for (const value of this.#draftPoints){
            const projected = screen(value);
            context.strokeRect(projected[0] - 3, projected[1] - 3, 6, 6);
        }
        context.restore();
    }
    #refreshViewport() {
        const zoom = this.root.querySelector('[data-zoom]');
        if (zoom) zoom.textContent = `${Math.round(this.renderer.camera.scale * 100)}%`;
        if (this.#snapWorld) this.#showSnap(this.#snapWorld);
        this.#drawOverlay();
    }
    #refreshSelectionPanels() {
        const selection = this.#selection;
        const output = this.root.querySelector('[data-selection]');
        if (output) output.textContent = `${selection?.size ?? 0} ${this.#t('selected')}`;
        const erase = this.root.querySelector('[data-action="erase"]');
        if (erase) erase.disabled = this.#options.readonly === true || !selection?.size;
        this.#refreshInspector();
    }
    #refreshDocumentPanels() {
        const drawing = this.document;
        if (!drawing) return;
        this.#snappableEntityIds = this.#visibleModelEntityIds();
        const name = this.root.querySelector('[data-document-name]');
        if (name) name.textContent = this.#options.title ?? String(drawing.snapshot().metadata.title ?? drawing.id);
        const count = drawing.listEntities().length;
        const set = (selector, value)=>{
            const element = this.root.querySelector(selector);
            if (element) element.textContent = value;
        };
        set('[data-count]', `${count.toLocaleString()} ${this.#t('entities')}`);
        set('[data-revision]', `REV ${drawing.revision}`);
        const undo = this.root.querySelector('[data-action="undo"]'), redo = this.root.querySelector('[data-action="redo"]');
        if (undo) undo.disabled = this.#options.readonly === true || !drawing.history.canUndo;
        if (redo) redo.disabled = this.#options.readonly === true || !drawing.history.canRedo;
        this.#refreshLayers();
        this.#refreshSelectionPanels();
        this.#refreshViewport();
    }
    #refreshLayers() {
        const host = this.root.querySelector('[data-layers]'), drawing = this.document;
        if (!host || !drawing) return;
        host.replaceChildren();
        const counts = new Map();
        for (const entity of drawing.listEntities())counts.set(String(entity.payload.layerId ?? ''), (counts.get(String(entity.payload.layerId ?? '')) ?? 0) + 1);
        for (const layer of drawing.getTable('layers')?.records ?? []){
            const label = document.createElement('label');
            label.className = 'layer';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = layer.payload.visible !== false;
            input.disabled = this.#options.readonly === true;
            input.addEventListener('change', ()=>void this.#run(()=>this.execute('LAYERUPDATE', {
                        id: layer.id,
                        patch: {
                            visible: input.checked
                        }
                    })), {
                signal: this.#abort.signal
            });
            const name = document.createElement('span');
            name.textContent = layer.name ?? '0';
            const count = document.createElement('small');
            count.textContent = String(counts.get(layer.id) ?? 0);
            label.append(input, name, count);
            host.append(label);
        }
    }
    #refreshInspector() {
        const host = this.root.querySelector('[data-inspector]'), drawing = this.document;
        if (!host || !drawing) return;
        host.replaceChildren();
        const id = this.#selection?.ids.at(-1), entity = id ? drawing.getObject(id) : null;
        if (!entity || entity.kind !== 'entity') {
            const empty = document.createElement('p');
            empty.className = 'empty';
            empty.textContent = this.#t('noSelection');
            host.append(empty);
            return;
        }
        const title = document.createElement('div');
        title.className = 'entity-title';
        title.textContent = entity.type;
        host.append(title, this.#kv('Handle', entity.handle), this.#kv(this.#t('layer'), drawing.getObject(String(entity.payload.layerId ?? ''))?.name ?? '0'));
        const layerField = document.createElement('label');
        layerField.className = 'field';
        layerField.innerHTML = `<span>${this.#t('layer')}</span>`;
        const layerSelect = document.createElement('select');
        layerSelect.disabled = this.#options.readonly === true;
        for (const layer of drawing.getTable('layers')?.records ?? []){
            const option = document.createElement('option');
            option.value = layer.id;
            option.textContent = layer.name ?? '0';
            option.selected = entity.payload.layerId === layer.id;
            layerSelect.append(option);
        }
        layerField.append(layerSelect);
        host.append(layerField);
        let valueInput = null;
        if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
            const field = document.createElement('label');
            field.className = 'field';
            field.innerHTML = `<span>${this.#t('radius')}</span>`;
            valueInput = document.createElement('input');
            valueInput.type = 'number';
            valueInput.min = '0.000001';
            valueInput.step = '0.1';
            valueInput.value = String(entity.payload.radius ?? '');
            valueInput.disabled = this.#options.readonly === true;
            field.append(valueInput);
            host.append(field);
        } else if ([
            'TEXT',
            'MTEXT',
            'ATTDEF',
            'ATTRIB'
        ].includes(entity.type)) {
            const field = document.createElement('label');
            field.className = 'field';
            field.innerHTML = `<span>${this.#t('text')}</span>`;
            valueInput = document.createElement('input');
            valueInput.value = String(entity.payload.text ?? '');
            valueInput.disabled = this.#options.readonly === true;
            field.append(valueInput);
            host.append(field);
        }
        if (!this.#options.readonly) {
            const apply = document.createElement('button');
            apply.type = 'button';
            apply.className = 'apply';
            apply.textContent = this.#t('apply');
            apply.addEventListener('click', ()=>void this.#run(async ()=>{
                    const payload = {
                        ...structuredClone(entity.payload),
                        layerId: layerSelect.value
                    };
                    if (valueInput && (entity.type === 'CIRCLE' || entity.type === 'ARC')) payload.radius = Number(valueInput.value);
                    if (valueInput && [
                        'TEXT',
                        'MTEXT',
                        'ATTDEF',
                        'ATTRIB'
                    ].includes(entity.type)) payload.text = valueInput.value;
                    await this.execute('PROPERTIES', {
                        id: entity.id,
                        patch: {
                            payload
                        }
                    });
                }), {
                signal: this.#abort.signal
            });
            host.append(apply);
        }
        if (this.renderer.report.unsupported) {
            const warning = document.createElement('div');
            warning.className = 'warning';
            warning.textContent = `${this.renderer.report.unsupportedTypes.join(', ')} · ${this.#t('unsupported')}`;
            host.append(warning);
        }
    }
    #kv(label, value) {
        const row = document.createElement('div');
        row.className = 'kv';
        const key = document.createElement('span');
        key.textContent = label;
        const output = document.createElement('b');
        output.textContent = String(value ?? '—');
        row.append(key, output);
        return row;
    }
    #updateCopy() {
        for (const element of this.root.querySelectorAll('[data-copy]')){
            const key = element.dataset.copy;
            if (Object.prototype.hasOwnProperty.call(copy.en, key)) element.textContent = this.#t(key);
        }
        for (const element of this.root.querySelectorAll('[data-copy-title]')){
            const key = element.dataset.copyTitle;
            if (!Object.prototype.hasOwnProperty.call(copy.en, key)) continue;
            element.title = this.#t(key);
            element.setAttribute('aria-label', this.#t(key));
        }
        const file = this.root.querySelector('[data-file]');
        if (file) file.setAttribute('aria-label', this.#t('open'));
        const command = this.root.querySelector('[data-command]');
        if (command) {
            command.setAttribute('aria-label', this.#t('command'));
            command.placeholder = this.#t('commandHint');
        }
        this.#canvas.setAttribute('aria-label', `${this.#t('drawing')} · KJDraw CAD`);
    }
    #t(key) {
        return String(copy[this.#locale][key]);
    }
    #setMessage(value) {
        this.#message = value;
        const message = this.root.querySelector('[data-message]');
        if (message) message.textContent = value;
        const hint = this.root.querySelector('[data-hint]');
        if (hint) hint.textContent = value;
    }
    #handleError(error) {
        this.#setMessage(error instanceof Error ? error.message : String(error));
        this.#options.onError?.(error);
        this.root.dispatchEvent(new CustomEvent('kjdraw:error', {
            detail: error,
            bubbles: true,
            composed: true
        }));
    }
    async #run(operation) {
        try {
            return await operation();
        } catch (error) {
            this.#handleError(error);
            return null;
        }
    }
}
export function mountKJDrawWorkbench(container, options = {}) {
    return new KJDrawWorkbench(container, options);
}
export function defineKJDrawWorkbenchElement(tagName = 'kjdraw-workbench') {
    assertBrowser();
    const normalized = String(tagName).trim().toLowerCase();
    const existing = customElements.get(normalized);
    if (existing) return existing;
    class KJDrawWorkbenchElement extends HTMLElement {
        instance = null;
        connectedCallback() {
            if (this.instance) return;
            const root = this.shadowRoot ?? this.attachShadow({
                mode: 'open'
            });
            const locale = this.getAttribute('locale') === 'zh-CN' ? 'zh-CN' : 'en';
            const theme = this.getAttribute('theme') === 'light' ? 'light' : 'dark';
            this.instance = mountKJDrawWorkbench(root, {
                locale,
                theme,
                readonly: this.hasAttribute('readonly')
            });
        }
        disconnectedCallback() {
            this.instance?.dispose();
            this.instance = null;
        }
    }
    customElements.define(normalized, KJDrawWorkbenchElement);
    return KJDrawWorkbenchElement;
}
