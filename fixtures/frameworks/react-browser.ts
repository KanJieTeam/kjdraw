import { StrictMode, createElement, createRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJDraw, type KJDrawEditor } from '../../packages/kjdraw-sdk/src/react.js'

interface ReactFrameworkTest {
  addLine(): Promise<void>
  setLocale(value: 'en' | 'zh-CN'): void
  setReadonly(value: boolean): void
  setToolbar(value: boolean): void
  attemptEdit(): Promise<string | null>
  reopen(): Promise<boolean>
  snapshot(): {
    mounted: boolean
    sameInstance: boolean
    disposed: boolean
    entityCount: number
    locale: string | null
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
let lastInstance: KJDrawEditor | null = null
let updateToolbar: (value: boolean) => void = () => {}
let updateLocale: (value: 'en' | 'zh-CN') => void = () => {}
let updateReadonly: (value: boolean) => void = () => {}
let changeEvents = 0

function App() {
  const [toolbar, setToolbar] = useState(true)
  const [locale, setLocale] = useState<'en' | 'zh-CN'>('en')
  const [readonly, setReadonly] = useState(false)
  updateToolbar = setToolbar
  updateLocale = setLocale
  updateReadonly = setReadonly

  return createElement(KJDraw, {
    ref: editorRef,
    document: 'sample',
    sdk: sharedSDK,
    locale,
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
    await editor.execute('CREATE', {
      type: 'LINE',
      payload: { start: [0, 0, 0], end: [25, 10, 0] },
    })
  },
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
  },
  snapshot() {
    const editor = editorRef.current
    const ribbon = host.querySelector<HTMLElement>('.ribbon')
    return {
      mounted: Boolean(editor),
      sameInstance: Boolean(editor && editor === firstInstance),
      disposed: editor?.disposed ?? lastInstance?.disposed ?? false,
      entityCount: editor?.document?.listEntities().length ?? 0,
      locale: editor?.locale ?? null,
      changeEvents,
      hostDocumentPresent: sharedSDK.documents.has('react-host-document'),
      sdkDocuments: sharedSDK.documents.size,
      toolbarVisible: ribbon ? getComputedStyle(ribbon).display !== 'none' : false,
      workbenches: host.querySelectorAll('.kjwb').length,
    }
  },
  unmount() {
    lastInstance = editorRef.current
    root.unmount()
    return lastInstance?.disposed ?? false
  },
}
