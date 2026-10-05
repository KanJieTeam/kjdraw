import { createApp, defineComponent, h, ref } from 'vue'
import { KJDraw, type KJDrawExposed } from '@kanjieteam/kjdraw/vue'

const App = defineComponent({
  setup() {
    const editor = ref<KJDrawExposed | null>(null)
    const createCircle = async () => {
      await editor.value?.execute('CREATE', {
        type: 'CIRCLE', payload: { center: [20, 20, 0], radius: 5 },
      })
      editor.value?.fit()
    }
    return () => h('main', [
      h('button', { onClick: () => void createCircle() }, 'Create 5 mm circle'),
      h(KJDraw, { ref: editor, document: 'blank', style: { height: '720px' } }),
    ])
  },
})

createApp(App).mount('#app')
