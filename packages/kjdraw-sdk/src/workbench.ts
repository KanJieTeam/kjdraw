import { KJCanvasRenderer } from './canvas-renderer.js'
import { createKJDrawSDK } from './sdk.js'
import type { KJDrawSDK, KJSDKCommandEnvelopeReceipt } from './sdk.js'
import { KJDocument } from './document.js'
import type { KJCommandArguments } from './commands.js'
import type { KJFileAdapterOptions } from './file-adapters.js'
import { createIndustrySample } from './samples.js'

export type KJWorkbenchLocale = 'en' | 'zh-CN'
export type KJWorkbenchTheme = 'dark' | 'light'
export type KJWorkbenchTool = 'select' | 'pan' | 'line' | 'polyline' | 'circle' | 'arc' | 'rectangle' | 'text' | 'measure'

export interface KJDrawWorkbenchOptions {
  sdk?: KJDrawSDK
  document?: KJDocument | 'blank' | 'sample' | null
  locale?: KJWorkbenchLocale
  theme?: KJWorkbenchTheme
  readonly?: boolean
  grid?: boolean
  showLayers?: boolean
  showInspector?: boolean
  toolbar?: boolean
  title?: string
  /** Browser-side ceiling checked before a selected file is read into memory. */
  maxFileBytes?: number
  onChange?: (event: KJDrawWorkbenchChange) => void
  onError?: (error: unknown) => void
}

export interface KJDrawWorkbenchChange {
  document: KJDocument
  revision: number
  entityCount: number
}

export interface KJWorkbenchOpenOptions extends KJFileAdapterOptions {
  fileName?: string
}

export interface KJWorkbenchSaveOptions extends KJFileAdapterOptions {
  fileName?: string
  download?: boolean
}

export interface KJWorkbenchSnapshot {
  locale: KJWorkbenchLocale
  theme: KJWorkbenchTheme
  tool: KJWorkbenchTool
  documentId: string | null
  revision: number
  entityCount: number
  selectedIds: readonly string[]
  render: ReturnType<KJCanvasRenderer['render']>
}

type Point2 = readonly [number, number]

const copy = {
  en: {
    open: 'Open', saveKjd: 'Save KJD', exportDxf: 'Export DXF', draw: 'Draw', modify: 'Modify', view: 'View',
    select: 'Select', pan: 'Pan', line: 'Line', polyline: 'Polyline', circle: 'Circle', arc: 'Arc', rectangle: 'Rectangle', text: 'Text', measure: 'Measure',
    undo: 'Undo', redo: 'Redo', erase: 'Delete', move: 'Move', copy: 'Copy', rotate: 'Rotate', offset: 'Offset', fit: 'Fit', grid: 'Grid', layers: 'Layers', properties: 'Properties',
    noSelection: 'Select an object to inspect its properties.', drawing: 'Drawing', entities: 'entities', selected: 'selected',
    layer: 'Layer', radius: 'Radius', apply: 'Apply', ready: 'Ready', readonly: 'Read only',
    firstPoint: 'Specify the first point', nextPoint: 'Specify the next point', finishPolyline: 'Click vertices · Enter or double-click to finish', arcStart: 'Specify arc start', arcEnd: 'Specify arc endpoint', textPrompt: 'Type TEXT followed by content, then click an insertion point', measured: 'Measured distance',
    unsupported: 'projection limits', theme: 'Theme', language: '中文', sample: 'Starter drawing', openFailed: 'Could not open drawing', command: 'Command', run: 'Run', commandHint: 'MOVE 10 0 · COPY 10 0 · ROTATE 15 · OFFSET 2 · SCALE 1.2', fileTooLarge: 'File exceeds the workbench limit',
  },
  'zh-CN': {
    open: '打开', saveKjd: '保存 KJD', exportDxf: '导出 DXF', draw: '绘图', modify: '修改', view: '视图',
    select: '选择', pan: '平移', line: '直线', polyline: '多段线', circle: '圆', arc: '圆弧', rectangle: '矩形', text: '文字', measure: '测距',
    undo: '撤销', redo: '重做', erase: '删除', move: '移动', copy: '复制', rotate: '旋转', offset: '偏移', fit: '全图', grid: '栅格', layers: '图层', properties: '特性',
    noSelection: '选择图元后可查看和修改属性。', drawing: '图纸', entities: '图元', selected: '已选择',
    layer: '图层', radius: '半径', apply: '应用', ready: '就绪', readonly: '只读',
    firstPoint: '指定第一个点', nextPoint: '指定下一个点', finishPolyline: '连续指定顶点 · Enter 或双击完成', arcStart: '指定圆弧起点', arcEnd: '指定圆弧端点', textPrompt: '输入 TEXT 和文字内容，再指定插入点', measured: '测量距离',
    unsupported: '投影限制', theme: '主题', language: 'EN', sample: '入门图纸', openFailed: '无法打开图纸', command: '命令', run: '执行', commandHint: 'MOVE 10 0 · COPY 10 0 · ROTATE 15 · OFFSET 2 · SCALE 1.2', fileTooLarge: '文件超过工作台限制',
  },
} as const

const WORKBENCH_STYLE = `
:host{display:block;min-height:480px;color-scheme:dark light}
.kjwb{--bg:#091016;--panel:#101923;--panel2:#16212d;--line:#293746;--text:#e8eef4;--muted:#8ea0b2;--accent:#a4ef55;--accent2:#1769e0;height:100%;min-height:480px;display:grid;grid-template-rows:42px 82px minmax(300px,1fr) 28px;background:var(--bg);color:var(--text);font:13px/1.35 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;border:1px solid var(--line);overflow:hidden;isolation:isolate}
.kjwb.light{--bg:#f4f6f8;--panel:#fff;--panel2:#eef2f5;--line:#d5dde5;--text:#17212c;--muted:#667587;--accent:#1769e0;--accent2:#1769e0}
.kjwb *{all:revert;box-sizing:border-box}.kjwb button,.kjwb select,.kjwb input{font:inherit}.kjwb .appbar{display:flex;align-items:center;gap:8px;padding:0 10px;background:var(--panel);border-bottom:1px solid var(--line)}
.kjwb .mark{display:grid;place-items:center;width:25px;height:25px;border-radius:6px;background:var(--accent);color:#08100e;font-weight:900}.kjwb .brand{font-weight:760;letter-spacing:-.02em}.kjwb .docname{min-width:0;margin-left:8px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kjwb .spacer{flex:1}
.kjwb button{border:0;color:inherit;background:transparent;border-radius:5px;cursor:pointer}.kjwb button:hover:not(:disabled){background:var(--panel2)}.kjwb button:focus-visible{outline:2px solid var(--accent2);outline-offset:1px}.kjwb button:disabled{opacity:.38;cursor:default}
.kjwb .appbar button{height:30px;padding:0 9px}.kjwb .primary{background:var(--accent2)!important;color:#fff!important}.kjwb .ribbon{display:flex;gap:0;background:var(--panel);border-bottom:1px solid var(--line);overflow-x:auto}.kjwb .group{display:flex;align-items:stretch;gap:3px;padding:7px 9px 18px;border-right:1px solid var(--line);position:relative}.kjwb .group>span{position:absolute;bottom:2px;left:0;right:0;text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.kjwb .tool{min-width:48px;padding:5px 7px;display:grid;place-items:center;gap:2px}.kjwb .tool b{font-size:18px;line-height:1}.kjwb .tool small{font-size:10px;white-space:nowrap}.kjwb .tool.active{background:color-mix(in srgb,var(--accent2) 16%,transparent);box-shadow:inset 0 0 0 1px var(--accent2)}
.kjwb .workspace{min-height:0;display:grid;grid-template-columns:220px minmax(0,1fr) 240px}.kjwb .workspace.no-layers{grid-template-columns:minmax(0,1fr) 240px}.kjwb .workspace.no-inspector{grid-template-columns:220px minmax(0,1fr)}.kjwb .workspace.no-layers.no-inspector{grid-template-columns:minmax(0,1fr)}
.kjwb .side{min-width:0;background:var(--panel);border-right:1px solid var(--line);overflow:auto}.kjwb .side.right{border-right:0;border-left:1px solid var(--line)}.kjwb .side h2{height:34px;margin:0;padding:9px 11px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.kjwb .layer{width:100%;display:grid;grid-template-columns:22px 1fr auto;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent);text-align:left}.kjwb .layer input{accent-color:var(--accent2)}.kjwb .layer small{color:var(--muted)}
.kjwb .canvas-wrap{position:relative;min-width:0;min-height:0;background:var(--bg);overflow:hidden}.kjwb .canvas-wrap canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none}.kjwb .canvas-wrap .overlay{pointer-events:none}.kjwb .crosshair{cursor:crosshair!important}.kjwb .pan{cursor:grab!important}.kjwb .pan.dragging{cursor:grabbing!important}
.kjwb .hint{position:absolute;left:12px;bottom:11px;max-width:min(540px,calc(100% - 24px));padding:6px 9px;border:1px solid var(--line);border-radius:5px;background:color-mix(in srgb,var(--panel) 88%,transparent);color:var(--muted);pointer-events:none}.kjwb .snap{position:absolute;width:9px;height:9px;border:1px solid var(--accent);transform:translate(-50%,-50%);pointer-events:none;display:none}
.kjwb .command{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);width:min(680px,calc(100% - 28px));height:35px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:7px;padding:3px 4px 3px 9px;border:1px solid var(--line);border-radius:6px;background:color-mix(in srgb,var(--panel) 94%,transparent);box-shadow:0 7px 24px #0004}.kjwb .command span{font:10px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--muted);text-transform:uppercase}.kjwb .command input{min-width:0;height:27px;border:0;outline:0;background:transparent;color:var(--text)}.kjwb .command button{height:27px;padding:0 12px;background:var(--accent2);color:#fff}.kjwb .command+.hint{bottom:88px}
.kjwb .inspector{padding:10px}.kjwb .empty{color:var(--muted);line-height:1.6}.kjwb .entity-title{font-size:16px;font-weight:750;margin-bottom:10px}.kjwb .kv{display:grid;grid-template-columns:75px 1fr;gap:8px;padding:5px 0;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent)}.kjwb .kv span{color:var(--muted)}.kjwb .kv b{font-weight:600;overflow:hidden;text-overflow:ellipsis}.kjwb .field{display:grid;gap:4px;margin:10px 0}.kjwb .field span{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.kjwb .field input,.kjwb .field select{min-width:0;width:100%;height:30px;padding:0 7px;border:1px solid var(--line);border-radius:4px;background:var(--panel2);color:var(--text)}.kjwb .apply{width:100%;height:31px;background:var(--accent2);color:#fff}.kjwb .warning{margin-top:12px;padding:8px;border:1px solid #a8792a;border-radius:5px;color:#e7bd6b;font-size:11px}
.kjwb .statusbar{display:flex;align-items:center;gap:14px;padding:0 10px;background:var(--panel);border-top:1px solid var(--line);color:var(--muted);font:11px ui-monospace,SFMono-Regular,Consolas,monospace}.kjwb .statusbar .message{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kjwb .statusbar b{color:var(--text);font-weight:600}.kjwb .file-input{display:none}
@media(max-width:860px){.kjwb .workspace{grid-template-columns:minmax(0,1fr) 210px}.kjwb .side.layers{display:none}.kjwb .ribbon{height:72px}.kjwb{grid-template-rows:42px 72px minmax(300px,1fr) 28px}.kjwb .tool{min-width:43px;padding-inline:4px}}
@media(max-width:620px){.kjwb .workspace,.kjwb .workspace.no-layers{grid-template-columns:minmax(0,1fr)}.kjwb .side.right{display:none}.kjwb .hide-small{display:none}.kjwb .brand{font-size:12px}.kjwb .group{padding-inline:4px}}
`

function assertBrowser(): void {
  if (typeof document === 'undefined') throw new Error('KJDraw workbench requires a browser DOM')
}

function query<ElementType extends Element>(root: ParentNode, selector: string): ElementType {
  const element = root.querySelector<ElementType>(selector)
  if (!element) throw new Error(`KJDraw workbench element is missing: ${selector}`)
  return element
}

function point(event: PointerEvent | WheelEvent, canvas: HTMLCanvasElement): Point2 {
  const rect = canvas.getBoundingClientRect()
  return [event.clientX - rect.left, event.clientY - rect.top]
}

function formatFromName(fileName: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(fileName)
  const extension = match?.[1]?.toUpperCase()
  return extension === 'KJD' || extension === 'DXF' ? extension : undefined
}

function sourceByteLength(source: unknown): number | null {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return source.byteLength
  if (typeof Blob !== 'undefined' && source instanceof Blob) return source.size
  return null
}

function downloadBytes(content: unknown, name: string, type: string): void {
  let part: BlobPart
  if (content instanceof Uint8Array) part = content as BlobPart
  else if (content instanceof ArrayBuffer) part = content
  else part = String(content ?? '')
  const url = URL.createObjectURL(new Blob([part], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

async function starterDocument(sdk: KJDrawSDK): Promise<KJDocument> {
  return createIndustrySample(sdk, 'sample-site-plan')
}

function availableDocumentId(sdk: KJDrawSDK, prefix: string): string {
  const base = `${prefix}-${Date.now()}`
  let documentId = base
  let copy = 2
  while (sdk.documents.has(documentId)) documentId = `${base}-${copy++}`
  return documentId
}

interface KJWorkbenchDocumentLease {
  document: KJDocument
  viewers: Set<KJDrawWorkbench>
  generated: boolean
}

const workbenchDocumentLeases = new WeakMap<KJDrawSDK, Map<KJDocument, KJWorkbenchDocumentLease>>()

function acquireDocumentLease(sdk: KJDrawSDK, workbench: KJDrawWorkbench, document: KJDocument, generated: boolean): void {
  let leases = workbenchDocumentLeases.get(sdk)
  if (!leases) {
    leases = new Map()
    workbenchDocumentLeases.set(sdk, leases)
  }
  const current = leases.get(document)
  const lease = current ?? { document, viewers: new Set<KJDrawWorkbench>(), generated: false }
  lease.generated ||= generated
  lease.viewers.add(workbench)
  leases.set(document, lease)
}

function releaseDocumentLease(sdk: KJDrawSDK, workbench: KJDrawWorkbench, document: KJDocument): void {
  const leases = workbenchDocumentLeases.get(sdk)
  const lease = leases?.get(document)
  if (!leases || !lease) return
  lease.viewers.delete(workbench)
  if (lease.viewers.size) return
  leases.delete(document)
  if (!leases.size) workbenchDocumentLeases.delete(sdk)
  if (lease.generated && sdk.documents.get(document.id) === document) sdk.closeDocument(document.id)
}

function hasOtherDocumentViewer(sdk: KJDrawSDK, workbench: KJDrawWorkbench, document: KJDocument): boolean {
  const lease = workbenchDocumentLeases.get(sdk)?.get(document)
  if (!lease) return false
  for (const viewer of lease.viewers) if (viewer !== workbench) return true
  return false
}

/** A framework-neutral reference CAD workbench that can be embedded with one call. */
export class KJDrawWorkbench {
  readonly container: HTMLElement | ShadowRoot
  readonly root: HTMLElement
  readonly sdk: KJDrawSDK
  readonly renderer: KJCanvasRenderer
  readonly ready: Promise<this>
  #options: KJDrawWorkbenchOptions
  #locale: KJWorkbenchLocale
  #theme: KJWorkbenchTheme
  #tool: KJWorkbenchTool = 'select'
  #canvas: HTMLCanvasElement
  #overlay: HTMLCanvasElement
  #overlayContext: CanvasRenderingContext2D
  #overlayObserver: ResizeObserver | null = null
  #abort = new AbortController()
  #disposeDocument: (() => void) | null = null
  #disposeSelection: (() => void) | null = null
  #draftStart: Point2 | null = null
  #draftPoints: Point2[] = []
  #cursorWorld: Point2 | null = null
  #snapWorld: Point2 | null = null
  #pendingText = 'KJDraw'
  #snappableEntityIds: string[] = []
  #panStart: Point2 | null = null
  #activePointer: number | null = null
  #message = ''
  #fileName = 'drawing.kjd'
  #maxFileBytes: number
  #leasedDocument: KJDocument | null = null

  constructor(container: HTMLElement | ShadowRoot, options: KJDrawWorkbenchOptions = {}) {
    assertBrowser()
    if (!(container instanceof HTMLElement) && !(container instanceof ShadowRoot)) throw new TypeError('KJDrawWorkbench requires an HTMLElement or ShadowRoot')
    this.container = container
    this.#options = options
    this.#locale = options.locale ?? 'en'
    this.#theme = options.theme ?? 'dark'
    this.#maxFileBytes = Number(options.maxFileBytes ?? 20 * 1024 * 1024)
    if (!Number.isSafeInteger(this.#maxFileBytes) || this.#maxFileBytes <= 0) throw new RangeError('maxFileBytes must be a positive safe integer')
    this.sdk = options.sdk ?? createKJDrawSDK()
    this.root = document.createElement('section')
    this.root.className = `kjwb ${this.#theme}${options.toolbar === false ? ' no-toolbar' : ''}`
    this.root.tabIndex = 0
    this.root.innerHTML = this.#markup()
    container.append(this.root)
    this.#canvas = query<HTMLCanvasElement>(this.root, 'canvas[data-canvas]')
    this.#overlay = query<HTMLCanvasElement>(this.root, 'canvas[data-overlay]')
    const overlayContext = this.#overlay.getContext('2d')
    if (!overlayContext) throw new Error('Canvas 2D overlay is unavailable')
    this.#overlayContext = overlayContext
    this.renderer = new KJCanvasRenderer(this.#canvas, { theme: this.#theme, grid: options.grid ?? true })
    if (typeof ResizeObserver !== 'undefined') {
      this.#overlayObserver = new ResizeObserver(() => this.#drawOverlay())
      this.#overlayObserver.observe(this.#canvas)
    }
    this.#bind()
    const initialDocument = options.document === undefined ? 'sample' : options.document
    this.ready = this.#initialize(initialDocument)
  }

  get document(): KJDocument | null { return this.renderer.document }
  get #selection() { return this.document ? this.sdk.getSelectionManager(this.document.id)?.active ?? null : null }
  get locale(): KJWorkbenchLocale { return this.#locale }
  get theme(): KJWorkbenchTheme { return this.#theme }
  get tool(): KJWorkbenchTool { return this.#tool }

  /** Change presentation without replacing the drawing or its undo history. */
  setOptions(options: Pick<KJDrawWorkbenchOptions, 'readonly' | 'grid' | 'toolbar' | 'showLayers' | 'showInspector' | 'title' | 'maxFileBytes'>): this {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    if (options.maxFileBytes !== undefined) {
      const nextLimit = Number(options.maxFileBytes)
      if (!Number.isSafeInteger(nextLimit) || nextLimit <= 0) throw new RangeError('maxFileBytes must be a positive safe integer')
      this.#maxFileBytes = nextLimit
    }
    this.#options = { ...this.#options, ...options }
    if (options.grid !== undefined) this.renderer.setGrid(options.grid)
    const workspace = query<HTMLElement>(this.root, '.workspace')
    workspace.classList.toggle('no-layers', this.#options.showLayers === false)
    workspace.classList.toggle('no-inspector', this.#options.showInspector === false)
    this.root.classList.toggle('no-toolbar', this.#options.toolbar === false)
    query<HTMLElement>(this.root, '.side.layers').hidden = this.#options.showLayers === false
    query<HTMLElement>(this.root, '.side.right').hidden = this.#options.showInspector === false
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-command-template],[data-action="erase"],[data-tool]')) {
      button.disabled = this.#options.readonly === true && !['select', 'pan', 'measure'].includes(button.dataset.tool ?? '')
    }
    if (this.#options.readonly && !['select', 'pan', 'measure'].includes(this.#tool)) this.setTool('select')
    this.#refreshDocumentPanels()
    this.renderer.resize()
    this.#drawOverlay()
    return this
  }

  setLocale(locale: KJWorkbenchLocale): this {
    if (locale !== 'en' && locale !== 'zh-CN') throw new RangeError(`Unsupported KJDraw workbench locale: ${String(locale)}`)
    this.#locale = locale
    this.#updateCopy()
    this.#refreshDocumentPanels()
    this.#setMessage(this.#t('ready'))
    return this
  }

  snapshot(): Readonly<KJWorkbenchSnapshot> {
    const drawing = this.document
    return Object.freeze({
      locale: this.#locale,
      theme: this.#theme,
      tool: this.#tool,
      documentId: drawing?.id ?? null,
      revision: drawing?.revision ?? 0,
      entityCount: drawing?.listEntities().length ?? 0,
      selectedIds: Object.freeze([...(this.#selection?.ids ?? [])]),
      render: this.renderer.report,
    })
  }

  setTheme(theme: KJWorkbenchTheme): this {
    if (theme !== 'dark' && theme !== 'light') throw new RangeError(`Unsupported KJDraw workbench theme: ${String(theme)}`)
    this.#theme = theme
    this.root.classList.toggle('light', theme === 'light')
    this.renderer.setTheme(theme)
    const toggle = this.root.querySelector<HTMLButtonElement>('[data-action="theme"]')
    if (toggle) toggle.textContent = theme === 'dark' ? '☾' : '☀'
    this.#refreshViewport()
    return this
  }

  setTool(tool: KJWorkbenchTool): this {
    const tools: readonly KJWorkbenchTool[] = ['select', 'pan', 'line', 'polyline', 'circle', 'arc', 'rectangle', 'text', 'measure']
    if (!tools.includes(tool)) throw new RangeError(`Unsupported KJDraw workbench tool: ${String(tool)}`)
    if (this.#options.readonly && !['select', 'pan', 'measure'].includes(tool)) {
      this.#setMessage(this.#t('readonly'))
      return this
    }
    this.#tool = tool
    this.#draftStart = null
    this.#draftPoints = []
    this.#canvas.classList.toggle('crosshair', ['line', 'polyline', 'circle', 'arc', 'rectangle', 'text', 'measure'].includes(tool))
    this.#canvas.classList.toggle('pan', tool === 'pan')
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.classList.toggle('active', button.dataset.tool === tool)
    this.#hideSnap()
    this.#drawOverlay()
    this.#setMessage(tool === 'select' ? this.#t('ready') : tool === 'text' ? this.#t('textPrompt') : this.#t('firstPoint'))
    return this
  }

  async setDocument(document: KJDocument): Promise<this> {
    return this.#setDocument(document, false)
  }

  async #setDocument(document: KJDocument, generated: boolean): Promise<this> {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    const registered = this.sdk.documents.get(document.id)
    if (registered && registered !== document) throw new Error(`A different KJDraw document is already attached with id: ${document.id}`)
    if (!registered) this.sdk.attachDocument(document)
    this.sdk.setActiveDocument(document.id)
    const previousLease = this.#leasedDocument
    const acquire = previousLease !== document
    if (acquire) acquireDocumentLease(this.sdk, this, document, generated)
    try {
      this.renderer.setDocument(document)
      this.#subscribeDocument(document)
      this.renderer.setSelection(this.sdk.getSelectionManager(document.id)?.active.ids ?? [])
      this.#leasedDocument = document
      if (previousLease && previousLease !== document) releaseDocumentLease(this.sdk, this, previousLease)
      this.#fileName = `${document.id}.kjd`
      this.#refreshDocumentPanels()
      this.renderer.fit()
      this.#refreshViewport()
      this.root.dispatchEvent(new CustomEvent('kjdraw:document', { detail: { document }, bubbles: true, composed: true }))
      return this
    } catch (error) {
      if (acquire) releaseDocumentLease(this.sdk, this, document)
      throw error
    }
  }

  async open(source: unknown, options: KJWorkbenchOpenOptions = {}): Promise<KJDocument> {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    const byteLength = sourceByteLength(source)
    if (byteLength != null && byteLength > this.#maxFileBytes) throw new RangeError(`${this.#t('fileTooLarge')}: ${byteLength.toLocaleString()} > ${this.#maxFileBytes.toLocaleString()} bytes`)
    const format = options.format ?? formatFromName(options.fileName ?? '')
    const result = await this.sdk.fileAdapters.read(source, { ...options, ...(format === undefined ? {} : { format }) })
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    if (!(result instanceof KJDocument) && (!result || typeof result !== 'object' || Array.isArray(result))) throw new Error('File adapter did not return a drawing')
    const drawing = result instanceof KJDocument ? result : KJDocument.open(result as Record<string, unknown>)
    const previous = this.sdk.documents.get(drawing.id)
    if (previous && previous !== drawing) {
      if (previous !== this.document) throw new Error(`Another drawing is already open with id: ${drawing.id}`)
      if (hasOtherDocumentViewer(this.sdk, this, previous)) {
        throw new Error(`Drawing ${drawing.id} is shared by another KJDraw workbench; load it as a separate document before reopening`)
      }
      // Reopening this editor's own file also refreshes the selection manager.
      this.#releaseCurrentDocumentLease()
      this.sdk.closeDocument(drawing.id)
    }
    await this.setDocument(drawing)
    this.#fileName = options.fileName ?? `${drawing.id}.${String(format ?? 'kjd').toLowerCase()}`
    this.#setMessage(`${this.#t('open')} · ${this.#fileName}`)
    return drawing
  }

  async execute<TResult = unknown>(command: string, args: KJCommandArguments = {}): Promise<KJSDKCommandEnvelopeReceipt<TResult>> {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    if (this.#options.readonly && !['SELECT', 'SEARCH', 'FIND', 'LENGTH', 'AREA', 'DISTANCE', 'NEAREST', 'INTERSECT', 'ANGLE'].includes(command.toUpperCase())) throw new Error('This editor is read only')
    const drawing = this.document
    if (!drawing) throw new Error('No active KJDraw document')
    if (this.sdk.documents.get(drawing.id) !== drawing) throw new Error('This drawing was closed or replaced by the host; setDocument before editing')
    this.#activateDocument()
    const receipt = await this.sdk.executeCommand<TResult>(this.sdk.createCommandEnvelope(command, args, {
      document: drawing,
      expectedRevision: drawing.revision,
      origin: 'ui',
    }))
    this.#setMessage(`${command} · REV ${drawing.revision}`)
    this.#refreshViewport()
    return receipt
  }

  async save(format: 'KJD' | 'DXF' = 'KJD', options: KJWorkbenchSaveOptions = {}): Promise<unknown> {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    const drawing = this.document
    if (!drawing) throw new Error('No active KJDraw document')
    const output = await this.sdk.writeDocument(drawing, { ...options, format, ...(format === 'DXF' && options.version == null ? { version: '2018' } : {}) })
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    if (options.download !== false) {
      const extension = format.toLowerCase()
      const base = (options.fileName ?? this.#fileName).replace(/\.[^.]+$/, '') || drawing.id
      downloadBytes(output, `${base}.${extension}`, format === 'DXF' ? 'application/dxf' : 'application/vnd.kanjie.kjdraw+json')
    }
    this.#setMessage(`${format} · ${drawing.fingerprint()}`)
    return output
  }

  dispose(): void {
    if (this.#abort.signal.aborted) return
    this.#abort.abort()
    this.#disposeDocument?.(); this.#disposeDocument = null
    this.#disposeSelection?.(); this.#disposeSelection = null
    this.#overlayObserver?.disconnect(); this.#overlayObserver = null
    this.renderer.dispose()
    this.root.remove()
    this.#releaseCurrentDocumentLease()
  }

  async #initialize(input: KJDocument | 'blank' | 'sample' | null): Promise<this> {
    try {
      const drawing = input && typeof input === 'object'
        ? input
        : input === 'blank' || input === null
          ? this.sdk.createDocument({ documentId: availableDocumentId(this.sdk, 'drawing'), units: 'millimeter' })
          : await starterDocument(this.sdk)
      const generated = input === null || typeof input === 'string'
      if (this.#abort.signal.aborted) {
        if (generated) {
          if (this.sdk.documents.get(drawing.id) === drawing) this.sdk.closeDocument(drawing.id)
        }
        return this
      }
      await this.#setDocument(drawing, generated)
      this.#setMessage(this.#t('ready'))
      return this
    } catch (error) {
      this.#handleError(error)
      throw error
    }
  }

  #markup(): string {
    const t = (key: keyof typeof copy.en) => this.#t(key)
    const readonly = this.#options.readonly === true
    return `<style>${WORKBENCH_STYLE}\n.kjwb [hidden]{display:none!important}.kjwb.no-toolbar{grid-template-rows:42px 0 minmax(300px,1fr) 28px}.kjwb.no-toolbar .ribbon{display:none}</style>
      <header class="appbar"><span class="mark">K</span><span class="brand">KJDraw</span><span class="docname" data-document-name>${t('sample')}</span><span class="spacer"></span>
        <input class="file-input" type="file" accept=".dxf,.kjd" aria-label="${t('open')}" data-file>
        <button type="button" data-action="open"><span aria-hidden="true">↗</span> <span data-copy="open">${t('open')}</span></button><button type="button" class="hide-small" data-action="save-kjd"><span aria-hidden="true">↓</span> <span data-copy="saveKjd">${t('saveKjd')}</span></button><button type="button" class="primary" data-action="save-dxf" data-copy="exportDxf">${t('exportDxf')}</button><button type="button" data-action="theme" data-copy-title="theme" title="${t('theme')}">${this.#theme === 'dark' ? '☾' : '☀'}</button><button type="button" data-action="language" data-copy="language">${t('language')}</button>
      </header>
      <nav class="ribbon" aria-label="CAD tools">
        <div class="group"><button type="button" class="tool active" data-tool="select"><b>⌁</b><small data-copy="select">${t('select')}</small></button><button type="button" class="tool" data-tool="pan"><b>✋</b><small data-copy="pan">${t('pan')}</small></button><span data-copy="view">${t('view')}</span></div>
        <div class="group"><button type="button" class="tool" data-tool="line" ${readonly ? 'disabled' : ''}><b>╱</b><small data-copy="line">${t('line')}</small></button><button type="button" class="tool" data-tool="polyline" ${readonly ? 'disabled' : ''}><b>⌁</b><small data-copy="polyline">${t('polyline')}</small></button><button type="button" class="tool" data-tool="circle" ${readonly ? 'disabled' : ''}><b>○</b><small data-copy="circle">${t('circle')}</small></button><button type="button" class="tool" data-tool="arc" ${readonly ? 'disabled' : ''}><b>◜</b><small data-copy="arc">${t('arc')}</small></button><button type="button" class="tool" data-tool="rectangle" ${readonly ? 'disabled' : ''}><b>□</b><small data-copy="rectangle">${t('rectangle')}</small></button><button type="button" class="tool" data-tool="text" ${readonly ? 'disabled' : ''}><b>T</b><small data-copy="text">${t('text')}</small></button><span data-copy="draw">${t('draw')}</span></div>
        <div class="group"><button type="button" class="tool" data-command-template="MOVE 10 0" ${readonly ? 'disabled' : ''}><b>✣</b><small data-copy="move">${t('move')}</small></button><button type="button" class="tool" data-command-template="COPY 10 0" ${readonly ? 'disabled' : ''}><b>▣</b><small data-copy="copy">${t('copy')}</small></button><button type="button" class="tool" data-command-template="ROTATE 15" ${readonly ? 'disabled' : ''}><b>↻</b><small data-copy="rotate">${t('rotate')}</small></button><button type="button" class="tool" data-command-template="OFFSET 2" ${readonly ? 'disabled' : ''}><b>⇉</b><small data-copy="offset">${t('offset')}</small></button><button type="button" class="tool" data-action="undo" ${readonly ? 'disabled' : ''}><b>↶</b><small data-copy="undo">${t('undo')}</small></button><button type="button" class="tool" data-action="redo" ${readonly ? 'disabled' : ''}><b>↷</b><small data-copy="redo">${t('redo')}</small></button><button type="button" class="tool" data-action="erase" ${readonly ? 'disabled' : ''}><b>⌫</b><small data-copy="erase">${t('erase')}</small></button><span data-copy="modify">${t('modify')}</span></div>
        <div class="group"><button type="button" class="tool" data-action="fit"><b>⛶</b><small data-copy="fit">${t('fit')}</small></button><button type="button" class="tool" data-action="grid"><b>⌗</b><small data-copy="grid">${t('grid')}</small></button><button type="button" class="tool" data-tool="measure"><b>↔</b><small data-copy="measure">${t('measure')}</small></button><span data-copy="view">${t('view')}</span></div>
      </nav>
      <div class="workspace ${this.#options.showLayers === false ? 'no-layers' : ''} ${this.#options.showInspector === false ? 'no-inspector' : ''}">
        <aside class="side layers" ${this.#options.showLayers === false ? 'hidden' : ''}><h2 data-copy="layers">${t('layers')}</h2><div data-layers></div></aside>
        <main class="canvas-wrap"><canvas class="cad-canvas" data-canvas aria-label="KJDraw CAD canvas"></canvas><canvas class="overlay" data-overlay aria-hidden="true"></canvas><span class="snap" data-snap></span><div class="command"><span data-copy="command">${t('command')}</span><input data-command aria-label="${t('command')}" placeholder="${t('commandHint')}" autocomplete="off"><button type="button" data-action="run-command" data-copy="run">${t('run')}</button></div><div class="hint" data-hint>${t('ready')}</div></main>
        <aside class="side right" ${this.#options.showInspector === false ? 'hidden' : ''}><h2 data-copy="properties">${t('properties')}</h2><div class="inspector" data-inspector><p class="empty">${t('noSelection')}</p></div></aside>
      </div>
      <footer class="statusbar"><span class="message" data-message>${readonly ? t('readonly') : t('ready')}</span><span data-coordinate>X 0.000 · Y 0.000</span><span data-selection>0 ${t('selected')}</span><b data-count>0 ${t('entities')}</b><span data-revision>REV 0</span><span data-zoom>100%</span></footer>`
  }

  #bind(): void {
    const signal = this.#abort.signal
    this.root.addEventListener('focusin', () => this.#activateDocument(), { signal })
    this.root.addEventListener('pointerdown', () => this.#activateDocument(), { signal })
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.addEventListener('click', () => this.setTool(button.dataset.tool as KJWorkbenchTool), { signal })
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-command-template]')) button.addEventListener('click', () => {
      const input = query<HTMLInputElement>(this.root, '[data-command]')
      input.value = button.dataset.commandTemplate ?? ''
      input.focus(); input.select()
    }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="open"]').addEventListener('click', () => query<HTMLInputElement>(this.root, '[data-file]').click(), { signal })
    query<HTMLInputElement>(this.root, '[data-file]').addEventListener('change', event => {
      const input = event.currentTarget as HTMLInputElement
      const file = input.files?.[0]
      if (!file) return
      void this.#run(async () => {
        try {
          if (file.size > this.#maxFileBytes) throw new RangeError(`${this.#t('fileTooLarge')}: ${file.size.toLocaleString()} > ${this.#maxFileBytes.toLocaleString()} bytes`)
          await this.open(new Uint8Array(await file.arrayBuffer()), { fileName: file.name })
        } finally { input.value = '' }
      })
    }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="save-kjd"]').addEventListener('click', () => void this.#run(() => this.save('KJD')), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="save-dxf"]').addEventListener('click', () => void this.#run(() => this.save('DXF')), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="undo"]').addEventListener('click', () => void this.#run(() => this.execute('UNDO')), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="redo"]').addEventListener('click', () => void this.#run(() => this.execute('REDO')), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="erase"]').addEventListener('click', () => void this.#eraseSelection(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="fit"]').addEventListener('click', () => { this.renderer.fit(); this.#refreshViewport() }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="grid"]').addEventListener('click', () => { this.renderer.setGrid(!this.renderer.grid); this.#refreshViewport() }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="theme"]').addEventListener('click', () => this.setTheme(this.#theme === 'dark' ? 'light' : 'dark'), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="language"]').addEventListener('click', () => this.setLocale(this.#locale === 'en' ? 'zh-CN' : 'en'), { signal })
    const commandInput = query<HTMLInputElement>(this.root, '[data-command]')
    query<HTMLButtonElement>(this.root, '[data-action="run-command"]').addEventListener('click', () => void this.#runCommand(), { signal })
    commandInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void this.#runCommand() } }, { signal })
    this.#canvas.addEventListener('wheel', event => {
      event.preventDefault(); this.renderer.zoomAt(Math.exp(-event.deltaY * 0.0015), point(event, this.#canvas)); this.#refreshViewport()
    }, { signal, passive: false })
    this.#canvas.addEventListener('pointerdown', event => this.#pointerDown(event), { signal })
    this.#canvas.addEventListener('pointermove', event => this.#pointerMove(event), { signal })
    this.#canvas.addEventListener('pointerup', event => void this.#pointerUp(event), { signal })
    this.#canvas.addEventListener('pointercancel', () => { this.#cancelPointer(); this.#hideSnap() }, { signal })
    this.#canvas.addEventListener('pointerleave', () => { this.#cursorWorld = null; this.#hideSnap(); this.#drawOverlay() }, { signal })
    this.#canvas.addEventListener('dblclick', event => {
      if (this.#tool === 'polyline') { event.preventDefault(); void this.#finishPolyline() }
    }, { signal })
    this.root.addEventListener('keydown', event => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return
      if (event.key === 'Escape') { this.#draftStart = null; this.#draftPoints = []; this.setTool('select') }
      if (event.key === 'Enter' && this.#tool === 'polyline' && this.#draftPoints.length >= 2) { event.preventDefault(); void this.#finishPolyline() }
      if (!this.#options.readonly && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); void this.#eraseSelection() }
      if (!this.#options.readonly && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void this.#run(() => this.execute(event.shiftKey ? 'REDO' : 'UNDO')) }
      if (!this.#options.readonly && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); void this.#run(() => this.execute('REDO')) }
      if (event.key.toLowerCase() === 'f') { this.renderer.fit(); this.#refreshViewport() }
    }, { signal })
  }

  #subscribeDocument(drawing: KJDocument): void {
    this.#disposeDocument?.(); this.#disposeSelection?.()
    this.#disposeDocument = drawing.on('document:change', () => {
      this.#refreshDocumentPanels()
      const change = { document: drawing, revision: drawing.revision, entityCount: drawing.listEntities().length }
      this.#options.onChange?.(change)
      this.root.dispatchEvent(new CustomEvent('kjdraw:change', { detail: change, bubbles: true, composed: true }))
    })
    const selection = this.sdk.getSelectionManager(drawing.id)?.active
    this.#disposeSelection = selection?.onChange(() => {
      this.renderer.setSelection(selection.ids)
      this.#refreshSelectionPanels()
      this.#drawOverlay()
      this.root.dispatchEvent(new CustomEvent('kjdraw:selection', { detail: { document: drawing, ids: selection.ids }, bubbles: true, composed: true }))
    }) ?? null
  }

  #activateDocument(): void {
    const drawing = this.document
    if (!drawing || this.sdk.documents.get(drawing.id) !== drawing || this.sdk.activeDocumentId === drawing.id) return
    this.sdk.setActiveDocument(drawing.id)
  }

  #releaseCurrentDocumentLease(): void {
    const drawing = this.#leasedDocument
    if (!drawing) return
    this.#leasedDocument = null
    releaseDocumentLease(this.sdk, this, drawing)
  }

  async #runCommand(): Promise<void> {
    const input = query<HTMLInputElement>(this.root, '[data-command]')
    const raw = input.value.trim()
    if (!raw) return
    const separator = raw.search(/\s/)
    const command = (separator < 0 ? raw : raw.slice(0, separator)).toUpperCase()
    const remainder = separator < 0 ? '' : raw.slice(separator).trim()
    const tokens = remainder ? remainder.split(/\s+/) : []
    const values = tokens.map(Number)
    const finiteValues = (count: number): number[] => {
      if (values.length !== count || values.some(value => !Number.isFinite(value))) throw new Error(`${command} expects ${count} numeric values`)
      return values
    }
    const selectedIds = (): string[] => {
      const ids = [...(this.#selection?.ids ?? [])]
      if (!ids.length) throw new Error(`${command} requires a selection`)
      return ids
    }
    const result = await this.#run(async () => {
      if (command === 'FIT' || command === 'EXTENTS') {
        this.renderer.fit(); this.#refreshViewport(); return
      }
      if (remainder.startsWith('{')) {
        if (this.#options.readonly) throw new Error(this.#t('readonly'))
        const parsed = JSON.parse(remainder) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Command JSON arguments must be an object')
        await this.execute(command, parsed as KJCommandArguments)
        return
      }
      if (this.#options.readonly && !['PAN', 'SELECT', 'MEASURE'].includes(command)) throw new Error(this.#t('readonly'))
      if (command === 'PAN' || command === 'SELECT' || command === 'MEASURE') {
        this.setTool(command.toLowerCase() as KJWorkbenchTool)
        return
      }
      if (command === 'PL' || command === 'PLINE' || command === 'POLYLINE') {
        if (!tokens.length) { this.setTool('polyline'); return }
        if (values.length < 4 || values.length % 2 !== 0 || values.some(value => !Number.isFinite(value))) throw new Error('POLYLINE expects at least two x y pairs')
        const vertices = Array.from({ length: values.length / 2 }, (_, index) => ({ point: [values[index * 2]!, values[index * 2 + 1]!, 0] }))
        await this.execute('CREATE', { type: 'LWPOLYLINE', payload: { vertices, closed: false, ...this.#activeLayerPayload() } })
        return
      }
      if (command === 'L' || command === 'LINE') {
        if (!tokens.length) { this.setTool('line'); return }
        const [x1, y1, x2, y2] = finiteValues(4)
        await this.execute('CREATE', { type: 'LINE', payload: { start: [x1, y1, 0], end: [x2, y2, 0], ...this.#activeLayerPayload() } })
        return
      }
      if (command === 'C' || command === 'CIRCLE') {
        if (!tokens.length) { this.setTool('circle'); return }
        const [x, y, radius] = finiteValues(3)
        if (radius! <= 0) throw new Error('CIRCLE radius must be positive')
        await this.execute('CREATE', { type: 'CIRCLE', payload: { center: [x, y, 0], radius, ...this.#activeLayerPayload() } })
        return
      }
      if (command === 'REC' || command === 'RECTANG' || command === 'RECTANGLE') {
        if (!tokens.length) { this.setTool('rectangle'); return }
        const [x1, y1, x2, y2] = finiteValues(4)
        const vertices = [[x1, y1, 0], [x2, y1, 0], [x2, y2, 0], [x1, y2, 0]].map(value => ({ point: value }))
        await this.execute('CREATE', { type: 'LWPOLYLINE', payload: { vertices, closed: true, ...this.#activeLayerPayload() } })
        return
      }
      if (command === 'A' || command === 'ARC') {
        if (!tokens.length) { this.setTool('arc'); return }
        const [cx, cy, sx, sy, ex, ey] = finiteValues(6)
        const radius = Math.hypot(sx! - cx!, sy! - cy!)
        if (radius <= 1e-12) throw new Error('ARC start point must differ from its center')
        await this.execute('CREATE', { type: 'ARC', payload: { center: [cx, cy, 0], radius, startAngle: Math.atan2(sy! - cy!, sx! - cx!), endAngle: Math.atan2(ey! - cy!, ex! - cx!), clockwise: false, ...this.#activeLayerPayload() } })
        return
      }
      if (command === 'T' || command === 'TEXT') {
        const x = Number(tokens[0]), y = Number(tokens[1])
        if (tokens.length >= 3 && Number.isFinite(x) && Number.isFinite(y)) {
          const text = tokens.slice(2).join(' ')
          await this.execute('CREATE', { type: 'TEXT', payload: { position: [x, y, 0], text, height: Math.max(1, 16 / this.renderer.camera.scale), rotation: 0, ...this.#activeLayerPayload() } })
        } else {
          this.#pendingText = remainder || 'KJDraw'
          this.setTool('text')
        }
        return
      }
      if (command === 'E' || command === 'ERASE' || command === 'DELETE') {
        await this.#eraseSelection(); return
      }
      if (command === 'M' || command === 'MOVE' || command === 'CO' || command === 'CP' || command === 'COPY') {
        const [dx, dy] = finiteValues(2)
        await this.execute(command === 'M' || command === 'MOVE' ? 'MOVE' : 'COPY', { ids: selectedIds(), dx, dy })
        return
      }
      if (command === 'RO' || command === 'ROTATE') {
        const [angleDegrees] = finiteValues(1)
        const ids = selectedIds()
        await this.execute('ROTATE', { ids, angleDegrees, center: this.#selectionCenter(ids) })
        return
      }
      if (command === 'SC' || command === 'SCALE') {
        const [factor] = finiteValues(1)
        const ids = selectedIds()
        await this.execute('SCALE', { ids, factor, center: this.#selectionCenter(ids) })
        return
      }
      if (command === 'O' || command === 'OFFSET') {
        const [distance] = finiteValues(1)
        const ids = selectedIds()
        if (ids.length !== 1) throw new Error('OFFSET requires exactly one selected entity')
        await this.execute('OFFSET', { id: ids[0]!, distance })
        return
      }
      if (!remainder) { await this.execute(command); return }
      throw new Error(`${command} arguments must use JSON, for example: ${command} {"id":"..."}`)
    })
    if (result !== null) input.value = ''
  }

  #activeLayerPayload(): Record<string, unknown> {
    const layerId = this.document?.getTable('layers')?.currentId
    return layerId ? { layerId } : {}
  }

  #selectionCenter(ids: readonly string[]): Point2 {
    const drawing = this.document
    if (!drawing) return [0, 0]
    const points: Point2[] = []
    const add = (value: unknown): void => {
      if (!Array.isArray(value)) return
      const x = Number(value[0]), y = Number(value[1])
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y])
    }
    for (const id of ids) {
      const entity = drawing.getObject(id)
      if (!entity || entity.kind !== 'entity') continue
      const payload = entity.payload
      for (const key of ['start', 'end', 'center', 'position', 'insertionPoint', 'origin'] as const) add(payload[key])
      if (Array.isArray(payload.vertices)) for (const vertex of payload.vertices) add(vertex && typeof vertex === 'object' && 'point' in vertex ? vertex.point : vertex)
    }
    if (!points.length) return [0, 0]
    const xs = points.map(value => value[0]), ys = points.map(value => value[1])
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
  }

  #visibleModelEntityIds(): string[] {
    const drawing = this.document
    if (!drawing) return []
    const modelSpaceId = drawing.snapshot().spaces.modelSpaceId
    const layers = new Map(drawing.getTable('layers')?.records.map(layer => [layer.id, layer.payload]) ?? [])
    return drawing.listEntities({ ownerId: modelSpaceId }).filter(entity => {
      const layer = layers.get(String(entity.payload.layerId ?? ''))
      return layer?.visible !== false && layer?.frozen !== true
    }).map(entity => entity.id)
  }

  #snapAt(world: Point2): Point2 | null {
    const drawing = this.document
    if (!drawing || !this.#snappableEntityIds.length) return null
    const candidate = this.sdk.snap(world, {
      document: drawing,
      entityIds: this.#snappableEntityIds,
      radius: 10 / this.renderer.camera.scale,
      modes: ['endpoint', 'midpoint', 'center', 'nearest'],
    })[0]
    return candidate ? [candidate.point[0], candidate.point[1]] : null
  }

  #showSnap(world: Point2 | null): void {
    const marker = this.root.querySelector<HTMLElement>('[data-snap]')
    if (!marker || !world) { this.#hideSnap(); return }
    this.#snapWorld = world
    const screen = this.renderer.worldToScreen(world)
    marker.style.display = 'block'
    marker.style.left = `${screen[0]}px`
    marker.style.top = `${screen[1]}px`
  }

  #hideSnap(): void {
    this.#snapWorld = null
    const marker = this.root.querySelector<HTMLElement>('[data-snap]')
    if (marker) marker.style.display = 'none'
  }

  #pointerDown(event: PointerEvent): void {
    this.root.focus()
    const location = point(event, this.#canvas)
    if (event.button === 1 || this.#tool === 'pan') {
      event.preventDefault(); this.#panStart = location; this.#activePointer = event.pointerId; this.#canvas.setPointerCapture(event.pointerId); this.#canvas.classList.add('dragging')
    }
  }

  #pointerMove(event: PointerEvent): void {
    const location = point(event, this.#canvas), rawWorld = this.renderer.screenToWorld(location)
    const coordinate = this.root.querySelector<HTMLElement>('[data-coordinate]')
    if (coordinate) coordinate.textContent = `X ${rawWorld[0].toFixed(3)} · Y ${rawWorld[1].toFixed(3)}`
    if (this.#panStart && this.#activePointer === event.pointerId) {
      this.renderer.panBy(location[0] - this.#panStart[0], location[1] - this.#panStart[1])
      this.#panStart = location
      this.#cursorWorld = null
      this.#hideSnap()
      this.#refreshViewport()
      return
    }
    const drawingTool = ['line', 'polyline', 'circle', 'arc', 'rectangle', 'text', 'measure'].includes(this.#tool)
    const snapped = drawingTool ? this.#snapAt(rawWorld) : null
    this.#cursorWorld = snapped ?? rawWorld
    this.#showSnap(snapped)
    this.#drawOverlay()
  }

  async #pointerUp(event: PointerEvent): Promise<void> {
    if (this.#activePointer === event.pointerId) { this.#cancelPointer(); return }
    if (event.button !== 0 || !this.document) return
    const location = point(event, this.#canvas)
    const rawWorld = this.renderer.screenToWorld(location)
    const snapped = ['line', 'polyline', 'circle', 'arc', 'rectangle', 'text', 'measure'].includes(this.#tool) ? this.#snapAt(rawWorld) : null
    const world: Point2 = snapped ?? rawWorld
    this.#cursorWorld = world
    if (this.#tool === 'select') {
      const hit = this.renderer.hitTest(location, 9)
      if (event.shiftKey && !hit) return
      const operation = event.shiftKey
        ? this.#selection?.has(hit!.entity.id) ? 'remove' : 'add'
        : 'replace'
      await this.sdk.executeCommand('SELECT', { ids: hit ? [hit.entity.id] : [], operation }, { document: this.document })
      return
    }
    if (this.#tool === 'pan') return
    if (this.#tool === 'text') {
      if (this.#options.readonly) return
      await this.#run(() => this.execute('CREATE', { type: 'TEXT', payload: { position: [...world, 0], text: this.#pendingText, height: Math.max(1, 16 / this.renderer.camera.scale), rotation: 0, ...this.#activeLayerPayload() } }))
      this.#setMessage(this.#t('textPrompt'))
      this.#drawOverlay()
      return
    }
    if (this.#tool === 'polyline') {
      const previous = this.#draftPoints.at(-1)
      if (!previous || Math.hypot(previous[0] - world[0], previous[1] - world[1]) > 1e-12) this.#draftPoints.push(world)
      this.#setMessage(this.#draftPoints.length < 2 ? this.#t('nextPoint') : this.#t('finishPolyline'))
      this.#drawOverlay()
      return
    }
    if (this.#tool === 'arc') {
      this.#draftPoints.push(world)
      if (this.#draftPoints.length === 1) this.#setMessage(this.#t('arcStart'))
      else if (this.#draftPoints.length === 2) this.#setMessage(this.#t('arcEnd'))
      else {
        const [center, start, end] = this.#draftPoints
        this.#draftPoints = []
        const radius = Math.hypot(start![0] - center![0], start![1] - center![1])
        if (radius <= 1e-12) { this.#handleError(new Error('ARC start point must differ from its center')); this.#drawOverlay(); return }
        await this.#run(() => this.execute('CREATE', { type: 'ARC', payload: { center: [...center!, 0], radius, startAngle: Math.atan2(start![1] - center![1], start![0] - center![0]), endAngle: Math.atan2(end![1] - center![1], end![0] - center![0]), clockwise: false, ...this.#activeLayerPayload() } }))
        this.#setMessage(this.#t('firstPoint'))
      }
      this.#drawOverlay()
      return
    }
    if (!this.#draftStart) { this.#draftStart = world; this.#setMessage(this.#t('nextPoint')); this.#drawOverlay(); return }
    const start = this.#draftStart
    this.#draftStart = null
    if (this.#tool === 'measure') {
      const distance = Math.hypot(world[0] - start[0], world[1] - start[1])
      this.#setMessage(`${this.#t('measured')}: ${distance.toFixed(3)}`)
      this.#drawOverlay()
      return
    }
    if (this.#options.readonly) return
    let type = 'LINE', payload: Record<string, unknown> = { start: [...start, 0], end: [...world, 0], ...this.#activeLayerPayload() }
    if (this.#tool === 'circle') {
      type = 'CIRCLE'; payload = { center: [...start, 0], radius: Math.hypot(world[0] - start[0], world[1] - start[1]), ...this.#activeLayerPayload() }
    } else if (this.#tool === 'rectangle') {
      type = 'LWPOLYLINE'; payload = { vertices: [[start[0], start[1], 0], [world[0], start[1], 0], [world[0], world[1], 0], [start[0], world[1], 0]].map(value => ({ point: value })), closed: true, ...this.#activeLayerPayload() }
    }
    await this.#run(() => this.execute('CREATE', { type, payload }))
    this.#setMessage(this.#t('firstPoint'))
    this.#drawOverlay()
  }

  async #finishPolyline(): Promise<void> {
    if (this.#options.readonly) return
    if (this.#draftPoints.length < 2) { this.#setMessage(this.#t('nextPoint')); return }
    const vertices = this.#draftPoints.map(value => ({ point: [value[0], value[1], 0] }))
    this.#draftPoints = []
    await this.#run(() => this.execute('CREATE', { type: 'LWPOLYLINE', payload: { vertices, closed: false, ...this.#activeLayerPayload() } }))
    this.#setMessage(this.#t('firstPoint'))
    this.#drawOverlay()
  }

  #cancelPointer(): void {
    if (this.#activePointer != null && this.#canvas.hasPointerCapture(this.#activePointer)) this.#canvas.releasePointerCapture(this.#activePointer)
    this.#activePointer = null; this.#panStart = null; this.#canvas.classList.remove('dragging')
  }

  async #eraseSelection(): Promise<void> {
    const ids = this.#selection?.ids ?? []
    const drawing = this.document
    if (!ids.length || this.#options.readonly || !drawing) return
    const receipt = await this.#run(() => this.execute('ERASE', { ids }))
    if (!receipt) return
    await this.sdk.executeCommand('SELECT', { ids: [], operation: 'clear' }, { document: drawing })
  }

  #drawOverlay(): void {
    const rect = this.#canvas.getBoundingClientRect()
    const width = Math.max(1, this.#canvas.width), height = Math.max(1, this.#canvas.height)
    if (this.#overlay.width !== width) this.#overlay.width = width
    if (this.#overlay.height !== height) this.#overlay.height = height
    const context = this.#overlayContext
    const cssWidth = Math.max(1, rect.width || this.#canvas.clientWidth || width)
    const cssHeight = Math.max(1, rect.height || this.#canvas.clientHeight || height)
    context.setTransform(width / cssWidth, 0, 0, height / cssHeight, 0, 0)
    context.clearRect(0, 0, cssWidth, cssHeight)
    const cursor = this.#cursorWorld
    const screen = (value: Point2): Point2 => this.renderer.worldToScreen(value)
    context.save()
    context.strokeStyle = this.#theme === 'dark' ? '#a4ef55' : '#1769e0'
    context.fillStyle = context.strokeStyle
    context.lineWidth = 1.5
    context.setLineDash([6, 4])
    if (this.#tool === 'polyline' && this.#draftPoints.length) {
      const points = cursor ? [...this.#draftPoints, cursor] : this.#draftPoints
      context.beginPath()
      points.forEach((value, index) => { const projected = screen(value); if (index === 0) context.moveTo(projected[0], projected[1]); else context.lineTo(projected[0], projected[1]) })
      context.stroke()
    } else if (this.#tool === 'arc' && this.#draftPoints.length && cursor) {
      const center = this.#draftPoints[0]!, centerScreen = screen(center)
      if (this.#draftPoints.length === 1) {
        const end = screen(cursor); context.beginPath(); context.moveTo(centerScreen[0], centerScreen[1]); context.lineTo(end[0], end[1]); context.stroke()
      } else {
        const start = this.#draftPoints[1]!
        const radius = Math.hypot(start[0] - center[0], start[1] - center[1])
        const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
        const endAngle = Math.atan2(cursor[1] - center[1], cursor[0] - center[0])
        context.beginPath(); context.arc(centerScreen[0], centerScreen[1], radius * this.renderer.camera.scale, -startAngle, -endAngle, true); context.stroke()
      }
    } else if (this.#draftStart && cursor) {
      const start = screen(this.#draftStart), end = screen(cursor)
      if (this.#tool === 'circle') {
        context.beginPath(); context.arc(start[0], start[1], Math.hypot(end[0] - start[0], end[1] - start[1]), 0, Math.PI * 2); context.stroke()
      } else if (this.#tool === 'rectangle') {
        context.strokeRect(start[0], start[1], end[0] - start[0], end[1] - start[1])
      } else {
        context.beginPath(); context.moveTo(start[0], start[1]); context.lineTo(end[0], end[1]); context.stroke()
      }
    } else if (this.#tool === 'text' && cursor) {
      const insertion = screen(cursor)
      context.setLineDash([])
      context.font = '13px ui-monospace, SFMono-Regular, Consolas, monospace'
      context.fillText(this.#pendingText, insertion[0] + 5, insertion[1] - 5)
      context.beginPath(); context.moveTo(insertion[0] - 4, insertion[1]); context.lineTo(insertion[0] + 4, insertion[1]); context.moveTo(insertion[0], insertion[1] - 4); context.lineTo(insertion[0], insertion[1] + 4); context.stroke()
    }
    context.setLineDash([])
    for (const value of this.#draftPoints) { const projected = screen(value); context.strokeRect(projected[0] - 3, projected[1] - 3, 6, 6) }
    context.restore()
  }

  #refreshViewport(): void {
    const zoom = this.root.querySelector<HTMLElement>('[data-zoom]')
    if (zoom) zoom.textContent = `${Math.round(this.renderer.camera.scale * 100)}%`
    if (this.#snapWorld) this.#showSnap(this.#snapWorld)
    this.#drawOverlay()
  }

  #refreshSelectionPanels(): void {
    const selection = this.#selection
    const output = this.root.querySelector<HTMLElement>('[data-selection]')
    if (output) output.textContent = `${selection?.size ?? 0} ${this.#t('selected')}`
    const erase = this.root.querySelector<HTMLButtonElement>('[data-action="erase"]')
    if (erase) erase.disabled = this.#options.readonly === true || !(selection?.size)
    this.#refreshInspector()
  }

  #refreshDocumentPanels(): void {
    const drawing = this.document
    if (!drawing) return
    this.#snappableEntityIds = this.#visibleModelEntityIds()
    const name = this.root.querySelector<HTMLElement>('[data-document-name]')
    if (name) name.textContent = this.#options.title ?? String(drawing.snapshot().metadata.title ?? drawing.id)
    const count = drawing.listEntities().length
    const set = (selector: string, value: string) => { const element = this.root.querySelector<HTMLElement>(selector); if (element) element.textContent = value }
    set('[data-count]', `${count.toLocaleString()} ${this.#t('entities')}`)
    set('[data-revision]', `REV ${drawing.revision}`)
    const undo = this.root.querySelector<HTMLButtonElement>('[data-action="undo"]'), redo = this.root.querySelector<HTMLButtonElement>('[data-action="redo"]')
    if (undo) undo.disabled = this.#options.readonly === true || !drawing.history.canUndo
    if (redo) redo.disabled = this.#options.readonly === true || !drawing.history.canRedo
    this.#refreshLayers()
    this.#refreshSelectionPanels()
    this.#refreshViewport()
  }

  #refreshLayers(): void {
    const host = this.root.querySelector<HTMLElement>('[data-layers]'), drawing = this.document
    if (!host || !drawing) return
    host.replaceChildren()
    const counts = new Map<string, number>()
    for (const entity of drawing.listEntities()) counts.set(String(entity.payload.layerId ?? ''), (counts.get(String(entity.payload.layerId ?? '')) ?? 0) + 1)
    for (const layer of drawing.getTable('layers')?.records ?? []) {
      const label = document.createElement('label'); label.className = 'layer'
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = layer.payload.visible !== false; input.disabled = this.#options.readonly === true
      input.addEventListener('change', () => void this.#run(() => this.execute('LAYERUPDATE', { id: layer.id, patch: { visible: input.checked } })), { signal: this.#abort.signal })
      const name = document.createElement('span'); name.textContent = layer.name ?? '0'
      const count = document.createElement('small'); count.textContent = String(counts.get(layer.id) ?? 0)
      label.append(input, name, count); host.append(label)
    }
  }

  #refreshInspector(): void {
    const host = this.root.querySelector<HTMLElement>('[data-inspector]'), drawing = this.document
    if (!host || !drawing) return
    host.replaceChildren()
    const id = this.#selection?.ids.at(-1), entity = id ? drawing.getObject(id) : null
    if (!entity || entity.kind !== 'entity') { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = this.#t('noSelection'); host.append(empty); return }
    const title = document.createElement('div'); title.className = 'entity-title'; title.textContent = entity.type
    host.append(title, this.#kv('Handle', entity.handle), this.#kv(this.#t('layer'), drawing.getObject(String(entity.payload.layerId ?? ''))?.name ?? '0'))
    const layerField = document.createElement('label'); layerField.className = 'field'; layerField.innerHTML = `<span>${this.#t('layer')}</span>`
    const layerSelect = document.createElement('select'); layerSelect.disabled = this.#options.readonly === true
    for (const layer of drawing.getTable('layers')?.records ?? []) {
      const option = document.createElement('option'); option.value = layer.id; option.textContent = layer.name ?? '0'; option.selected = entity.payload.layerId === layer.id; layerSelect.append(option)
    }
    layerField.append(layerSelect); host.append(layerField)
    let valueInput: HTMLInputElement | null = null
    if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
      const field = document.createElement('label'); field.className = 'field'; field.innerHTML = `<span>${this.#t('radius')}</span>`
      valueInput = document.createElement('input'); valueInput.type = 'number'; valueInput.min = '0.000001'; valueInput.step = '0.1'; valueInput.value = String(entity.payload.radius ?? ''); valueInput.disabled = this.#options.readonly === true; field.append(valueInput); host.append(field)
    } else if (['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].includes(entity.type)) {
      const field = document.createElement('label'); field.className = 'field'; field.innerHTML = `<span>${this.#t('text')}</span>`
      valueInput = document.createElement('input'); valueInput.value = String(entity.payload.text ?? ''); valueInput.disabled = this.#options.readonly === true; field.append(valueInput); host.append(field)
    }
    if (!this.#options.readonly) {
      const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'apply'; apply.textContent = this.#t('apply')
      apply.addEventListener('click', () => void this.#run(async () => {
        const payload: Record<string, unknown> = { ...structuredClone(entity.payload), layerId: layerSelect.value }
        if (valueInput && (entity.type === 'CIRCLE' || entity.type === 'ARC')) payload.radius = Number(valueInput.value)
        if (valueInput && ['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].includes(entity.type)) payload.text = valueInput.value
        await this.execute('PROPERTIES', { id: entity.id, patch: { payload } })
      }), { signal: this.#abort.signal })
      host.append(apply)
    }
    if (this.renderer.report.unsupported) { const warning = document.createElement('div'); warning.className = 'warning'; warning.textContent = `${this.renderer.report.unsupportedTypes.join(', ')} · ${this.#t('unsupported')}`; host.append(warning) }
  }

  #kv(label: string, value: unknown): HTMLElement {
    const row = document.createElement('div'); row.className = 'kv'
    const key = document.createElement('span'); key.textContent = label
    const output = document.createElement('b'); output.textContent = String(value ?? '—')
    row.append(key, output); return row
  }

  #updateCopy(): void {
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-copy]')) {
      const key = element.dataset.copy as keyof typeof copy.en
      if (Object.prototype.hasOwnProperty.call(copy.en, key)) element.textContent = this.#t(key)
    }
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-copy-title]')) {
      const key = element.dataset.copyTitle as keyof typeof copy.en
      if (!Object.prototype.hasOwnProperty.call(copy.en, key)) continue
      element.title = this.#t(key)
      element.setAttribute('aria-label', this.#t(key))
    }
    const file = this.root.querySelector<HTMLInputElement>('[data-file]')
    if (file) file.setAttribute('aria-label', this.#t('open'))
    const command = this.root.querySelector<HTMLInputElement>('[data-command]')
    if (command) {
      command.setAttribute('aria-label', this.#t('command'))
      command.placeholder = this.#t('commandHint')
    }
    this.#canvas.setAttribute('aria-label', `${this.#t('drawing')} · KJDraw CAD`)
  }

  #t(key: keyof typeof copy.en): string { return String(copy[this.#locale][key]) }
  #setMessage(value: string): void { this.#message = value; const message = this.root.querySelector<HTMLElement>('[data-message]'); if (message) message.textContent = value; const hint = this.root.querySelector<HTMLElement>('[data-hint]'); if (hint) hint.textContent = value }
  #handleError(error: unknown): void { this.#setMessage(error instanceof Error ? error.message : String(error)); this.#options.onError?.(error); this.root.dispatchEvent(new CustomEvent('kjdraw:error', { detail: error, bubbles: true, composed: true })) }
  async #run<Result>(operation: () => Result | Promise<Result>): Promise<Result | null> { try { return await operation() } catch (error) { this.#handleError(error); return null } }
}

export function mountKJDrawWorkbench(container: HTMLElement | ShadowRoot, options: KJDrawWorkbenchOptions = {}): KJDrawWorkbench {
  return new KJDrawWorkbench(container, options)
}

export function defineKJDrawWorkbenchElement(tagName = 'kjdraw-workbench'): CustomElementConstructor {
  assertBrowser()
  const normalized = String(tagName).trim().toLowerCase()
  const existing = customElements.get(normalized)
  if (existing) return existing
  class KJDrawWorkbenchElement extends HTMLElement {
    instance: KJDrawWorkbench | null = null
    connectedCallback(): void {
      if (this.instance) return
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
      const locale = this.getAttribute('locale') === 'zh-CN' ? 'zh-CN' : 'en'
      const theme = this.getAttribute('theme') === 'light' ? 'light' : 'dark'
      this.instance = mountKJDrawWorkbench(root, { locale, theme, readonly: this.hasAttribute('readonly') })
    }
    disconnectedCallback(): void { this.instance?.dispose(); this.instance = null }
  }
  customElements.define(normalized, KJDrawWorkbenchElement)
  return KJDrawWorkbenchElement
}
