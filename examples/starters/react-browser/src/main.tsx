import { StrictMode, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { KJDraw, type KJDrawEditor } from '@kanjieteam/kjdraw/react'

function App() {
  const editor = useRef<KJDrawEditor | null>(null)
  const createCircle = async () => {
    await editor.current?.execute('CREATE', {
      type: 'CIRCLE', payload: { center: [20, 20, 0], radius: 5 },
    })
    editor.current?.fit()
  }
  return <main><button onClick={() => void createCircle()}>Create 5 mm circle</button><KJDraw ref={editor} document="blank" style={{ height: 720 }} /></main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
