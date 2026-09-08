import { defineComponent, h, ref } from 'vue'
import { KJDraw, type KJDrawExposed } from '@kanjieteam/kjdraw/vue'

/** A complete KJDraw editor surface for Vue applications. */
export const EngineeringDrawing = defineComponent({
  name: 'EngineeringDrawing',
  setup() {
    const editor = ref<KJDrawExposed | null>(null)

    return () => h(KJDraw, {
      ref: editor,
      document: 'sample',
      locale: 'en',
      theme: 'dark',
      title: 'Engineering drawing',
      style: { width: '100%', height: '720px' },
      onReady: () => editor.value?.fit(),
    })
  },
})
