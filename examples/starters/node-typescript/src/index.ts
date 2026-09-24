import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'

const outputDirectory = resolve(
  process.env.KJDRAW_STARTER_OUTPUT
    ?? fileURLToPath(new URL('../output/', import.meta.url)),
)
await mkdir(outputDirectory, { recursive: true })

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({
  documentId: 'five-minute-circle',
  title: '5 mm circle',
  units: 'millimeter',
})
await sdk.executeCommand('CREATE', {
  type: 'CIRCLE',
  payload: { center: [20, 20, 0], radius: 5 },
}, { document: drawing })

const kjd = await sdk.writeDocument<string>(drawing, { format: 'KJD' })
const dxf = await sdk.writeDocument<string>(drawing, { format: 'DXF' })
await Promise.all([
  writeFile(resolve(outputDirectory, 'circle.kjd'), kjd, 'utf8'),
  writeFile(resolve(outputDirectory, 'circle.dxf'), dxf, 'utf8'),
])

const verificationSdk = createKJDrawSDK()
const [reopenedKjd, reopenedDxf] = await Promise.all([
  verificationSdk.readDocument(kjd, { format: 'KJD' }),
  verificationSdk.readDocument(dxf, { format: 'DXF' }),
])
const circles = reopenedKjd.listEntities({ type: 'CIRCLE' })
if (circles.length !== 1 || circles[0]?.payload.radius !== 5) {
  throw new Error('KJD reopen verification did not preserve the 5 mm circle')
}
if (reopenedDxf.listEntities({ type: 'CIRCLE' }).length !== 1) {
  throw new Error('DXF reopen verification did not preserve the circle')
}

console.log(JSON.stringify({
  ok: true,
  revision: reopenedKjd.revision,
  entities: circles.length,
  radius: circles[0].payload.radius,
  outputs: ['circle.kjd', 'circle.dxf'],
}, null, 2))
