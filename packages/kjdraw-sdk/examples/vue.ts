import { defineComponent, h, ref } from 'vue'
import { KJDraw, type KJDrawExposed, type KJWorkbenchLayout } from '@kanjieteam/kjdraw/vue'

/** A complete KJDraw editor surface for Vue applications. */
export const EngineeringDrawing = defineComponent({
  name: 'EngineeringDrawing',
  setup() {
    const editor = ref<KJDrawExposed | null>(null)
    const layout = ref<KJWorkbenchLayout>('classic')

    const createAndMoveLine = async (): Promise<void> => {
      const created = await editor.value?.execute<{ id: string }>('CREATE', {
        type: 'LINE',
        payload: { start: [0, 0, 0], end: [100, 0, 0] },
      })
      if (created?.result) {
        await editor.value?.execute('MOVE', { id: created.result.id, dx: 25, dy: 10 })
      }
    }

    return () => h('section', [
      h('div', [
        ...(['classic', 'compact', 'focus'] as const).map(value => h('button', {
          onClick: () => { layout.value = value },
        }, value)),
        h('button', { onClick: () => void createAndMoveLine() }, 'Create + move line'),
      ]),
      h(KJDraw, {
        ref: editor,
        document: 'sample',
        locale: 'en',
        theme: 'dark',
        layout: layout.value,
        title: 'Engineering drawing',
        style: { width: '100%', height: '720px' },
        onReady: () => editor.value?.fit(),
      }),
    ])
  },
})
