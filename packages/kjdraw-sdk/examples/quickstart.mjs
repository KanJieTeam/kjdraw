import { createKJDrawSDK } from '@kanjie/kjdraw-sdk'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'npm-quickstart', title: 'NPM quickstart', units: 'millimeter' })
const created = await sdk.executeCommand('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 0, 0] },
})
await sdk.executeCommand('MOVE', { id: created.id, dx: 25, dy: 10 })
const kjd = await sdk.writeDocument(drawing, { format: 'KJD' })
const reopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })

console.log(JSON.stringify({
  sdkVersion: sdk.version,
  documentId: reopened.id,
  revision: reopened.revision,
  entities: reopened.listEntities().length,
  line: reopened.getObject(created.id).payload,
}, null, 2))
