import { useEffect, useRef, useState } from 'react'
import { createKJDrawSDK, type KJDrawSDK } from '@kanjieteam/kjdraw'

export function useKJDraw() {
  const sdkRef = useRef<KJDrawSDK | null>(null)
  if (!sdkRef.current) {
    sdkRef.current = createKJDrawSDK()
    sdkRef.current.createDocument({ documentId: 'react-drawing', units: 'millimeter' })
  }

  const sdk = sdkRef.current
  const document = sdk.activeDocument
  if (!document) throw new Error('KJDraw document initialization failed')
  const [revision, setRevision] = useState(document.revision)
  useEffect(() => sdk.events.on('command:committed', ({ document }) => setRevision(document.revision)), [sdk])

  const drawLine = () => sdk.executeCommand('CREATE', {
    type: 'LINE',
    payload: { start: [0, 0, 0], end: [100, 0, 0] },
  })

  return { sdk, document, revision, drawLine }
}
