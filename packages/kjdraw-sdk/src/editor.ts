import { KJDrawWorkbench } from './workbench.js'
import { KJEventBus } from './events.js'
import type { KJDocument } from './document.js'
import type { KJDrawSDK, KJSDKCommandEnvelopeReceipt } from './sdk.js'
import type { KJCommandArguments } from './commands.js'
import type { KJWorkbenchLayout, KJWorkbenchLocale, KJWorkbenchTheme, KJWorkbenchTool, KJWorkbenchOpenOptions, KJDrawWorkbenchChange } from './workbench.js'
import type { KJFileAdapterOptions } from './file-adapters.js'

export type { KJWorkbenchLayout } from './workbench.js'

/** Options for an embedded CAD editor. Give the container a height before mounting. */
export interface KJDrawEditorOptions {
  /** Drawing to open initially. Defaults to the included sample. */
  document?: KJDocument | 'sample' | 'blank' | null
  /** Reuse an application SDK to share commands and plugins. */
  sdk?: KJDrawSDK
  /** Workbench language. Default: en. */
  locale?: KJWorkbenchLocale
  /** Panel and canvas appearance. Default: dark. */
  theme?: KJWorkbenchTheme
  /** Workbench chrome arrangement. Default: classic. */
  layout?: KJWorkbenchLayout
  /** Enable inspection and file export with editing controls disabled. Default: false. */
  readonly?: boolean
  /** Show the drawing grid. Default: true. */
  grid?: boolean
  /** Show the ribbon toolbar. Default: true. */
  toolbar?: boolean
  /** Show the layers panel. Default: true. */
  layers?: boolean
  /** Show the properties panel. Default: true. */
  properties?: boolean
  /** Editor title displayed above the drawing. */
  title?: string
  /** Maximum input file size in bytes. Default: 20 MiB. */
  maxFileBytes?: number
  onReady?: (editor: KJDrawEditor) => void
  onChange?: (event: KJDrawWorkbenchChange) => void
  onSelectionChange?: (event: KJDrawEditorSelectionEvent) => void
  onError?: (error: unknown) => void
}

export interface KJDrawEditorSelectionEvent { document: KJDocument; ids: readonly string[] }
export interface KJDrawEditorSaveOptions extends KJFileAdapterOptions {
  /** Output format. Default: KJD. */
  format?: 'KJD' | 'DXF'
  fileName?: string
  /** Trigger a browser download. Default: true. Use false for custom storage. */
  download?: boolean
}
export interface KJDrawEditorEvents {
  ready: KJDrawEditor
  change: KJDrawWorkbenchChange
  selectionchange: KJDrawEditorSelectionEvent
  documentchange: { document: KJDocument }
  error: unknown
  dispose: undefined
}

/** A mounted CAD editor. Use ready before reading the initial drawing. */
export class KJDrawEditor {
  readonly workbench: KJDrawWorkbench
  readonly ready: Promise<this>
  #events = new KJEventBus<KJDrawEditorEvents>()
  #abort = new AbortController()
  #title: string | null
  #maxFileBytes: number
  #operations: Promise<unknown> = Promise.resolve()

  constructor(container: string | HTMLElement | ShadowRoot, options: KJDrawEditorOptions = {}) {
    if (typeof document === 'undefined') throw new Error('Mount KJDraw in a browser or a client-side component lifecycle')
    const host = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container
    if (!host) throw new Error(`KJDraw container was not found: ${String(container)}`)
    this.#title = options.title ?? null
    this.#maxFileBytes = options.maxFileBytes ?? 20 * 1024 * 1024
    if (options.onReady) this.#events.on('ready', options.onReady)
    if (options.onChange) this.#events.on('change', options.onChange)
    if (options.onSelectionChange) this.#events.on('selectionchange', options.onSelectionChange)
    if (options.onError) this.#events.on('error', options.onError)
    const { layers, properties, onChange: _change, onError: _error, onReady: _ready, onSelectionChange: _selection, ...base } = options
    this.workbench = new KJDrawWorkbench(host, {
      ...base,
      ...(layers === undefined ? {} : { showLayers: layers }),
      ...(properties === undefined ? {} : { showInspector: properties }),
      onChange: event => { this.#applyTitle(); this.#events.emit('change', event) },
      onError: error => { if (!this.disposed) this.#events.emit('error', error) },
    })
    this.workbench.root.addEventListener('kjdraw:selection', event => {
      this.#events.emit('selectionchange', (event as CustomEvent<KJDrawEditorSelectionEvent>).detail)
    }, { signal: this.#abort.signal })
    this.workbench.root.addEventListener('kjdraw:document', event => {
      this.#applyTitle()
      this.#events.emit('documentchange', (event as CustomEvent<{ document: KJDocument }>).detail)
    }, { signal: this.#abort.signal })
    this.ready = this.workbench.ready.then(() => {
      if (this.disposed) return this
      this.#applyTitle()
      this.#events.emit('ready', this)
      return this
    })
    // Callers can await ready for initialization errors; lifecycle cleanup never
    // leaves a rejected background promise unobserved (React StrictMode).
    void this.ready.catch(() => {})
  }

  get document(): KJDocument | null { return this.workbench.document }
  get sdk(): KJDrawSDK { return this.workbench.sdk }
  get element(): HTMLElement { return this.workbench.root }
  get disposed(): boolean { return this.#abort.signal.aborted }
  get locale(): KJWorkbenchLocale { return this.workbench.locale }
  get theme(): KJWorkbenchTheme { return this.workbench.theme }
  get layout(): KJWorkbenchLayout { return this.workbench.layout }

  /** Subscribe to an editor event. The return value unsubscribes the listener. */
  on<Name extends keyof KJDrawEditorEvents>(name: Name, listener: (event: KJDrawEditorEvents[Name]) => void): () => boolean {
    this.#assertMounted()
    return this.#events.on(name, listener)
  }

  /** Open a File, Blob, text or bytes. Pass format for bytes without a filename. */
  open(source: Blob | string | ArrayBuffer | ArrayBufferView, options: KJWorkbenchOpenOptions = {}): Promise<KJDocument> {
    return this.#enqueue(async () => {
      const bytes = typeof source === 'string' ? new TextEncoder().encode(source).byteLength : source instanceof Blob ? source.size : source.byteLength
      if (bytes > this.#maxFileBytes) throw new RangeError(`Input file exceeds maxFileBytes (${bytes} > ${this.#maxFileBytes})`)
      const fileName = options.fileName ?? (typeof File !== 'undefined' && source instanceof File ? source.name : undefined)
      const data = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source
      this.#assertMounted()
      return this.workbench.open(data, { ...options, ...(fileName === undefined ? {} : { fileName }) })
    })
  }

  /** Save the current drawing, or return its content with download: false. */
  save(options: KJDrawEditorSaveOptions = {}): Promise<string | Uint8Array> {
    return this.#enqueue(async () => {
      const { format = 'KJD', ...rest } = options
      const result = await this.workbench.save(format, rest)
      if (typeof result === 'string' || result instanceof Uint8Array) return result
      if (result instanceof ArrayBuffer) return new Uint8Array(result)
      throw new Error('The file adapter returned an unsupported output type')
    })
  }

  setDocument(drawing: KJDocument): Promise<this> {
    return this.#enqueue(async () => { await this.workbench.setDocument(drawing); this.#applyTitle(); return this })
  }

  /** Execute an SDK command using the current drawing and its undo history. */
  execute<TResult = unknown>(command: string, args: KJCommandArguments = {}): Promise<KJSDKCommandEnvelopeReceipt<TResult>> {
    return this.#enqueue(() => this.workbench.execute<TResult>(command, args))
  }
  undo(): Promise<KJSDKCommandEnvelopeReceipt> { return this.execute('UNDO') }
  redo(): Promise<KJSDKCommandEnvelopeReceipt> { return this.execute('REDO') }
  setSelection(ids: readonly string[]): Promise<readonly string[]> {
    return this.#enqueue(async () => { await this.workbench.execute('SELECT', { ids, operation: 'replace' }); return this.getSelection() })
  }
  getSelection(): readonly string[] { this.#assertMounted(); return this.workbench.snapshot().selectedIds }
  fit(): this { this.#assertMounted(); this.workbench.renderer.resize().fit(); return this }
  setTheme(theme: KJWorkbenchTheme): this { this.#assertMounted(); this.workbench.setTheme(theme); return this }
  setLayout(layout: KJWorkbenchLayout): this { this.#assertMounted(); this.workbench.setLayout(layout); return this }
  setLocale(locale: KJWorkbenchLocale): this { this.#assertMounted(); this.workbench.setLocale(locale); this.#applyTitle(); return this }
  setTool(tool: KJWorkbenchTool): this { this.#assertMounted(); this.workbench.setTool(tool); return this }
  setTitle(title: string): this { this.#assertMounted(); this.#title = title; this.#applyTitle(); return this }

  /** Update presentation and editing mode while preserving the active drawing. */
  setOptions(options: Pick<KJDrawEditorOptions, 'layout' | 'readonly' | 'grid' | 'toolbar' | 'layers' | 'properties' | 'title' | 'maxFileBytes'>): this {
    this.#assertMounted()
    const { layers, properties, ...rest } = options
    if (options.title !== undefined) this.#title = options.title
    if (options.maxFileBytes !== undefined) {
      const nextLimit = Number(options.maxFileBytes)
      if (!Number.isSafeInteger(nextLimit) || nextLimit <= 0) throw new RangeError('maxFileBytes must be a positive safe integer')
      this.#maxFileBytes = nextLimit
    }
    this.workbench.setOptions({ ...rest, ...(layers === undefined ? {} : { showLayers: layers }), ...(properties === undefined ? {} : { showInspector: properties }) })
    this.#applyTitle()
    return this
  }

  /** Unmount the editor and release its listeners and rendering resources. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.#abort.abort()
    this.workbench.dispose()
    try { this.#events.emit('dispose', undefined) } finally { this.#events.clear() }
  }

  #assertMounted(): void { if (this.disposed) throw new Error('KJDraw editor has been disposed') }
  #applyTitle(): void {
    const label = this.workbench?.root.querySelector('[data-document-name]')
    if (label && this.#title !== null) label.textContent = this.#title
  }
  #enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const next = this.#operations.then(async () => {
      await this.ready
      this.#assertMounted()
      try { return await operation() } catch (error) { if (!this.disposed) this.#events.emit('error', error); throw error }
    })
    this.#operations = next.catch(() => {})
    return next
  }
}

/** Mount an editor into a CSS selector, HTMLElement or ShadowRoot. */
export function createKJDrawEditor(container: string | HTMLElement | ShadowRoot, options: KJDrawEditorOptions = {}): KJDrawEditor {
  return new KJDrawEditor(container, options)
}
