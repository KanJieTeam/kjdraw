import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, validatePluginManifest } from '../../packages/kjdraw-sdk/src/index.js'
import { activateCenterMarker } from '../../examples/plugin-starter/src/index.js'

const source = JSON.parse(await readFile(new URL('../../examples/plugin-starter/kjdraw.plugin.json', import.meta.url), 'utf8'))
const manifest = validatePluginManifest(source)
const sdk = createKJDrawSDK({ version: '1.0.0' })
const document = sdk.createDocument({ documentId: 'plugin-starter-audit' })
const scope = activateCenterMarker(sdk, manifest)

const marker = await sdk.executeCommand('KJ_MARK_CENTER', { x: 25, y: 40, radius: 7.5 })
assert.equal(marker.type, 'CIRCLE')
assert.deepEqual(marker.payload.center, [25, 40, 0])
assert.equal(marker.payload.radius, 7.5)
assert.equal(document.revision, 1)
assert.equal(sdk.commands.resolve('KJ_MARK_CENTER')?.owner, manifest.id)

scope.dispose()
assert.equal(sdk.commands.resolve('KJ_MARK_CENTER'), null)
console.log(JSON.stringify({
  schema: 'com.kanjie.kjdraw.audit.plugin-starter@1',
  plugin: `${manifest.id}@${manifest.version}`,
  command: 'KJ_MARK_CENTER',
  lifecycle: ['manifest-valid', 'compatible', 'permission-granted', 'activated', 'transaction-committed', 'disposed'],
}, null, 2))
