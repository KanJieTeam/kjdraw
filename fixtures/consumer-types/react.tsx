import { useRef } from 'react'
import { KJDraw, type KJDrawEditor } from '@kanjieteam/kjdraw/react'

export function ReactKJDrawConsumer() {
  const editor = useRef<KJDrawEditor | null>(null)

  return (
    <KJDraw
      ref={editor}
      document="sample"
      locale="en"
      theme="dark"
      layout="compact"
      title="React engineering drawing"
      style={{ width: '100%', height: 720 }}
      onReady={instance => instance.setLayout('focus').fit()}
    />
  )
}
