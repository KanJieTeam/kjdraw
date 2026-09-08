import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue'
import { KJDraw, type KJDrawExposed } from '../../packages/kjdraw-sdk/src/vue.js'

interface VueFrameworkTest {
  addLine(): Promise<void>
  moveLine(): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  setLayout(value: 'classic' | 'compact' | 'focus'): Promise<void>
  setLocale(value: 'en' | 'zh-CN'): Promise<void>
  setToolbar(value: boolean): Promise<void>
  snapshot(): {
    mounted: boolean
    sameInstance: boolean
    sameDocument: boolean
    disposed: boolean
    entityCount: number
    locale: string | null
    layout: string | null
    lineStart: readonly unknown[] | null
    toolbarVisible: boolean
    workbenches: number
  }
  captureInstance(): void
  unmount(): boolean
}

declare global {
  interface Window { __kjdrawVueTest?: VueFrameworkTest }
}

const host = document.querySelector<HTMLElement>('#framework-host')
if (!host) throw new Error('Vue framework test host is missing')

const exposed = ref<KJDrawExposed | null>(null)
const state = reactive({ toolbar: true, locale: 'en' as 'en' | 'zh-CN', layout: 'classic' as 'classic' | 'compact' | 'focus' })
let firstInstance = exposed.value?.instance ?? null
let firstDocument = exposed.value?.instance?.document ?? null
let lastInstance = exposed.value?.instance ?? null
let testLineId: string | null = null

const App = defineComponent({
  name: 'VueFrameworkTest',
  setup() {
    return () => h(KJDraw, {
      ref: exposed,
      document: 'sample',
      locale: state.locale,
      layout: state.layout,
      toolbar: state.toolbar,
      title: 'Vue framework test',
      style: { width: '100%', height: '640px' },
    })
  },
})

const app = createApp(App)
app.mount(host)

window.__kjdrawVueTest = {
  async addLine() {
    const editor = exposed.value?.instance
    if (!editor) throw new Error('Vue KJDraw expose is not ready')
    await editor.ready
    const receipt = await exposed.value?.execute<{ id: string }>('CREATE', {
      type: 'LINE',
      payload: { start: [0, 0, 0], end: [25, 10, 0] },
    })
    testLineId = receipt?.result?.id ?? null
  },
  async moveLine() {
    if (!testLineId) throw new Error('Vue test line is not ready')
    await exposed.value?.execute('MOVE', { id: testLineId, dx: 6, dy: 4 })
  },
  async undo() { await exposed.value?.undo() },
  async redo() { await exposed.value?.redo() },
  async setLayout(value) { state.layout = value; await nextTick() },
  async setLocale(value) { state.locale = value; await nextTick() },
  async setToolbar(value) { state.toolbar = value; await nextTick() },
  captureInstance() {
    const editor = exposed.value?.instance
    if (!editor) throw new Error('Vue KJDraw expose is not ready')
    firstInstance = editor
    firstDocument = editor.document
  },
  snapshot() {
    const editor = exposed.value?.instance ?? null
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
      toolbarVisible: ribbon ? getComputedStyle(ribbon).display !== 'none' && getComputedStyle(ribbon).visibility !== 'hidden' && ribbon.getBoundingClientRect().height > 0 : false,
      workbenches: host.querySelectorAll('.kjwb').length,
    }
  },
  unmount() {
    lastInstance = exposed.value?.instance ?? null
    app.unmount()
    return lastInstance?.disposed ?? false
  },
}
