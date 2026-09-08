import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue'
import { KJDraw, type KJDrawExposed } from '../../packages/kjdraw-sdk/src/vue.js'

interface VueFrameworkTest {
  addLine(): Promise<void>
  setLocale(value: 'en' | 'zh-CN'): Promise<void>
  setToolbar(value: boolean): Promise<void>
  snapshot(): {
    mounted: boolean
    sameInstance: boolean
    disposed: boolean
    entityCount: number
    locale: string | null
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
const state = reactive({ toolbar: true, locale: 'en' as 'en' | 'zh-CN' })
let firstInstance = exposed.value?.instance ?? null
let lastInstance = exposed.value?.instance ?? null

const App = defineComponent({
  name: 'VueFrameworkTest',
  setup() {
    return () => h(KJDraw, {
      ref: exposed,
      document: 'sample',
      locale: state.locale,
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
    await exposed.value?.execute('CREATE', {
      type: 'LINE',
      payload: { start: [0, 0, 0], end: [25, 10, 0] },
    })
  },
  async setLocale(value) { state.locale = value; await nextTick() },
  async setToolbar(value) { state.toolbar = value; await nextTick() },
  captureInstance() {
    const editor = exposed.value?.instance
    if (!editor) throw new Error('Vue KJDraw expose is not ready')
    firstInstance = editor
  },
  snapshot() {
    const editor = exposed.value?.instance ?? null
    const ribbon = host.querySelector<HTMLElement>('.ribbon')
    return {
      mounted: Boolean(editor),
      sameInstance: Boolean(editor && editor === firstInstance),
      disposed: editor?.disposed ?? lastInstance?.disposed ?? false,
      entityCount: editor?.document?.listEntities().length ?? 0,
      locale: editor?.locale ?? null,
      toolbarVisible: ribbon ? getComputedStyle(ribbon).display !== 'none' : false,
      workbenches: host.querySelectorAll('.kjwb').length,
    }
  },
  unmount() {
    lastInstance = exposed.value?.instance ?? null
    app.unmount()
    return lastInstance?.disposed ?? false
  },
}
