import {
  createKJDrawSDK,
  type KJCommandReceipt,
  type KJDocument,
  type KJEntity,
} from '@kanjieteam/kjdraw'
import { createKJDrawEditor, type KJWorkbenchLayout } from '@kanjieteam/kjdraw/editor'

// Compiled from the installed package, not from workspace source aliases.
function mountEditor(host: HTMLElement, layout: KJWorkbenchLayout) {
  const editor = createKJDrawEditor(host, { document: 'sample', layout })
  editor.setLayout('compact').setOptions({ layout: 'focus' })
  const current: KJWorkbenchLayout = editor.layout
  return { editor, current }
}
void mountEditor

const sdk = createKJDrawSDK()
const drawing: KJDocument = sdk.createDocument({
  documentId: 'vanilla-consumer',
  title: 'Vanilla TypeScript consumer',
  units: 'millimeter',
})

const created = await sdk.executeCommand<KJEntity>('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 0, 0] },
})
const envelope = sdk.createCommandEnvelope('MOVE', { id: created.id, dx: 25, dy: 10 })
const receipt: KJCommandReceipt | unknown = await sdk.executeCommandEnvelope(envelope)

console.log(drawing.revision, receipt)
