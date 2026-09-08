import { onScopeDispose, ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { createKJDrawSDK, type KJDocument, type KJDrawSDK } from '@kanjieteam/kjdraw'

export function useKJDraw(): {
  sdk: KJDrawSDK
  document: ShallowRef<KJDocument>
  revision: Ref<number>
  drawLine: () => Promise<unknown>
} {
  const sdk = createKJDrawSDK()
  const document = shallowRef(sdk.createDocument({ documentId: 'vue-consumer', units: 'millimeter' }))
  const revision = ref(document.value.revision)
  const off = sdk.events.on('command:committed', ({ document: changed }) => {
    revision.value = changed.revision
  })
  onScopeDispose(off)

  const drawLine = () => sdk.executeCommand('CREATE', {
    type: 'LINE',
    payload: { start: [0, 0, 0], end: [100, 0, 0] },
  })

  return { sdk, document, revision, drawLine }
}
