import { onScopeDispose, ref, shallowRef } from 'vue'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'

export function useKJDraw() {
  const sdk = createKJDrawSDK()
  const document = shallowRef(sdk.createDocument({ documentId: 'vue-drawing', units: 'millimeter' }))
  const revision = ref(document.value.revision)
  const off = sdk.events.on('command:committed', ({ document: changed }) => { revision.value = changed.revision })
  onScopeDispose(off)

  const drawLine = () => sdk.executeCommand('CREATE', {
    type: 'LINE',
    payload: { start: [0, 0, 0], end: [100, 0, 0] },
  })

  return { sdk, document, revision, drawLine }
}
