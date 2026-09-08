import { useRef } from 'react'
import { KJDraw, type KJDrawEditor } from '@kanjieteam/kjdraw/react'

/** A complete KJDraw editor surface for React applications. */
export function EngineeringDrawing() {
  const editor = useRef<KJDrawEditor | null>(null)

  return (
    <KJDraw
      ref={editor}
      document="sample"
      locale="en"
      theme="dark"
      title="Engineering drawing"
      style={{ width: '100%', height: 720 }}
      onReady={instance => instance.fit()}
    />
  )
}
