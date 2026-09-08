import { useRef, useState } from 'react'
import { KJDraw, type KJDrawEditor, type KJWorkbenchLayout } from '@kanjieteam/kjdraw/react'

/** A complete KJDraw editor surface for React applications. */
export function EngineeringDrawing() {
  const editor = useRef<KJDrawEditor | null>(null)
  const [layout, setLayout] = useState<KJWorkbenchLayout>('classic')

  async function createAndMoveLine() {
    const instance = editor.current
    if (!instance) return
    const created = await instance.execute<{ id: string }>('CREATE', {
      type: 'LINE',
      payload: { start: [0, 0, 0], end: [100, 0, 0] },
    })
    if (created.result) {
      await instance.execute('MOVE', { id: created.result.id, dx: 25, dy: 10 })
    }
  }

  return (
    <section>
      <div>
        <button onClick={() => setLayout('classic')}>Classic</button>
        <button onClick={() => setLayout('compact')}>Compact</button>
        <button onClick={() => setLayout('focus')}>Focus</button>
        <button onClick={() => void createAndMoveLine()}>Create + move line</button>
      </div>
      <KJDraw
        ref={editor}
        document="sample"
        locale="en"
        theme="dark"
        layout={layout}
        title="Engineering drawing"
        style={{ width: '100%', height: 720 }}
        onReady={instance => instance.fit()}
      />
    </section>
  )
}
