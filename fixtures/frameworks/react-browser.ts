import { StrictMode, createElement, createRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJDraw, type KJDrawEditor } from '../../packages/kjdraw-sdk/src/react.js'

interface ReactFrameworkTest {
  addLine(): Promise<void>
  moveLine(): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  setLayout(value: 'classic' | 'compact' | 'focus'): void
  setLocale(value: 'en' | 'zh-CN'): void
  setReadonly(value: boolean): void
  setToolbar(value: boolean): void
  attemptEdit(): Promise<string | null>
  reopen(): Promise<boolean>
  snapshot(): {
    mounted: boolean
    sameInstance: boolean
    sameDocument: boolean
    disposed: boolean
    entityCount: number
    locale: string | null
    layout: string | null
    lineStart: readonly unknown[] | null
    changeEvents: number
    hostDocumentPresent: boolean
    sdkDocuments: number
    toolbarVisible: boolean
    workbenches: number
  }
  captureInstance(): void
  unmount(): boolean
}

declare global {
  interface Window { __kjdrawReactTest?: ReactFrameworkTest }
}

const host = document.querySelector<HTMLElement>('#framework-host')
if (!host) throw new Error('React framework test host is missing')

const editorRef = createRef<KJDrawEditor>()
const sharedSDK = createKJDrawSDK()
sharedSDK.createDocument({ documentId: 'react-host-document', units: 'millimeter' })
let firstInstance: KJDrawEditor | null = null
let firstDocument: KJDrawEditor['document'] = null
let lastInstance: KJDrawEditor | null = null
let testLineId: string | null = null
let updateToolbar: (value: boolean) => void = () => {}
let updateLocale: (value: 'en' | 'zh-CN') => void = () => {}
let updateReadonly: (value: boolean) => void = () => {}
let updateLayout: (value: 'classic' | 'compact' | 'focus') => void = () => {}
let changeEvents = 0

function App() {
  const [toolbar, setToolbar] = useState(true)
  const [locale, setLocale] = useState<'en' | 'zh-CN'>('en')
  const [readonly, setReadonly] = useState(false)
  const [layout, setLayout] = useState<'classic' | 'compact' | 'focus'>('classic')
  updateToolbar = setToolbar
  updateLocale = setLocale
  updateReadonly = setReadonly
  updateLayout = setLayout

  return createElement(KJDraw, {
    ref: editorRef,
    document: 'sample',
    sdk: sharedSDK,
    locale,
    layout,
    readonly,
    toolbar,
    title: 'React framework test',
    style: { width: '100%', height: 640 },
    onChange: () => { changeEvents += 1 },
  })
}

const root = createRoot(host)
root.render(createElement(StrictMode, null, createElement(App)))

window.__kjdrawReactTest = {
  async addLine() {
    const editor = editorRef.current
    if (!editor) throw new Error('React KJDraw ref is not ready')
    await editor.ready
    const receipt = await editor.execute<{ id: string }>('CREATE', {
      type: 'LINE',
      payload: { start: [0, 0, 0], end: [25, 10, 0] },
    })
    testLineId = receipt.result?.id ?? null
  },
  async moveLine() {
    const editor = editorRef.current
    if (!editor || !testLineId) throw new Error('React test line is not ready')
    await editor.execute('MOVE', { id: testLineId, dx: 6, dy: 4 })
  },
  async undo() { await editorRef.current?.undo() },
  async redo() { await editorRef.current?.redo() },
  setLayout(value) { updateLayout(value) },
  setLocale(value) { updateLocale(value) },
  setReadonly(value) { updateReadonly(value) },
  setToolbar(value) { updateToolbar(value) },
  async attemptEdit() {
    const editor = editorRef.current
    if (!editor) throw new Error('React KJDraw ref is not ready')
    try {
      await editor.execute('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [1, 1, 0] } })
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  },
  async reopen() {
    const editor = editorRef.current
    if (!editor?.document) throw new Error('React KJDraw ref is not ready')
    const before = editor.document
    const source = await editor.save({ format: 'KJD', download: false })
    const reopened = await editor.open(source, { format: 'KJD', fileName: 'react-reopen.kjd' })
    return reopened !== before && editor.document === reopened
  },
  captureInstance() {
    if (!editorRef.current) throw new Error('React KJDraw ref is not ready')
    firstInstance = editorRef.current
    firstDocument = editorRef.current.document
  },
  snapshot() {
    const editor = editorRef.current
    const ribbon = host.querySelector<HTMLElement>('.ribbon')
    const line = testLineId ? editor?.document?.getObject(testLineId) : null
    const lineStart = Array.isArray(line?.payload.start) ? [...line.payload.start] : null
    return {
      mounted: Boolean(editor),
      sameInstance: Boolean(editor && editor === firstInstance),
      sameDocument: Boolean(editor?.document && editor.document === firstDocument),
      disposed: editor?.disposed ?? lastInstance?.disposed ?? false,
      entityCount: editor?.document?.listEntities().length ?? 0,
      locale: editor?.locale ?? null,
      layout: editor?.layout ?? null,
      lineStart,
      changeEvents,
      hostDocumentPresent: sharedSDK.documents.has('react-host-document'),
      sdkDocuments: sharedSDK.documents.size,
      toolbarVisible: ribbon ? getComputedStyle(ribbon).display !== 'none' && getComputedStyle(ribbon).visibility !== 'hidden' && ribbon.getBoundingClientRect().height > 0 : false,
      workbenches: host.querySelectorAll('.kjwb').length,
    }
  },
  unmount() {
    lastInstance = editorRef.current
    root.unmount()
    return lastInstance?.disposed ?? false
  },
}
