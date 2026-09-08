import { defineComponent, h, ref } from 'vue'
import { KJDraw, type KJDrawExposed } from '@kanjieteam/kjdraw/vue'

export const VueKJDrawConsumer = defineComponent({
  name: 'VueKJDrawConsumer',
  setup() {
    const editor = ref<KJDrawExposed | null>(null)

    return () => h(KJDraw, {
      ref: editor,
      document: 'sample',
      locale: 'zh-CN',
      theme: 'light',
      title: 'Vue 工程图纸',
      style: { width: '100%', height: '720px' },
      onReady: () => editor.value?.fit(),
    })
  },
})
