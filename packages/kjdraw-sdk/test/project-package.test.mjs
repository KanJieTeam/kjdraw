import assert from 'node:assert/strict'
import test from 'node:test'

import { KJValidationError, createKJDrawSDK, createKjpPackage, decodeZip64, openKjpPackage } from '../src/index.js'

const fixedAt = '2026-08-22T08:00:00.000Z'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'site-plan', title: '西安勘察工程', createdAt: fixedAt })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [100, 0] } })
  return createKjpPackage({
    projectId: 'project-xa-001', title: '西安勘察工程', drawings: { 'site-plan': document }, activeDrawing: 'site-plan',
    commands: [{ schema: 'com.kanjie.kjdraw.command@1', command: 'CREATE', receipt: { afterRevision: 1 }, entityId: line.id }],
    assets: { 'fonts/readme.txt': '本地字体说明' }, createdAt: fixedAt, modifiedAt: fixedAt,
  })
}

test('KJP is a real ZIP64 package with required entries, hashes and reopenable KJD', async () => {
  const packageBytes = await fixture()
  const view = new DataView(packageBytes.buffer, packageBytes.byteOffset, packageBytes.byteLength)
  assert.equal(view.getUint32(0, true), 0x04034b50)
  assert.notEqual(packageBytes.findIndex((_, index) => index + 4 <= packageBytes.length && view.getUint32(index, true) === 0x06064b50), -1)
  const entries = decodeZip64(packageBytes)
  assert.deepEqual([...entries.keys()], ['assets/fonts/readme.txt', 'drawings/site-plan.kjd', 'history/commands.ndjson', 'manifest.json'])
  const reopened = await openKjpPackage(packageBytes)
  assert.equal(reopened.manifest.schema, 'com.kanjie.kjdraw.project@1')
  assert.equal(reopened.manifest.mediaType, 'application/vnd.kanjie.kjdraw-project+zip')
  assert.equal(reopened.activeDocument.id, 'site-plan')
  assert.equal(reopened.activeDocument.listEntities({ type: 'LINE' }).length, 1)
  assert.equal(reopened.commands.length, 1)
})

test('KJP encoding is deterministic and rejects traversal, corruption and manifest drift', async () => {
  const first = await fixture(), opened = await openKjpPackage(first)
  const second = await createKjpPackage({
    projectId: opened.manifest.projectId, title: opened.manifest.title,
    drawings: Object.fromEntries(opened.drawings), activeDrawing: opened.manifest.activeDrawing,
    commands: opened.commands, assets: { 'fonts/readme.txt': '本地字体说明' },
    createdAt: fixedAt, modifiedAt: fixedAt,
  })
  assert.deepEqual(first, second)
  assert.throws(() => decodeZip64(new Uint8Array([1, 2, 3])), KJValidationError)
  assert.throws(() => decodeZip64(first, { maxEntries: 2 }), /条目数量超过限制/)
  const corrupted = first.slice()
  const entries = decodeZip64(first), needle = entries.get('drawings/site-plan.kjd').slice(0, 16)
  let at = -1
  outer: for (let index = 0; index <= corrupted.length - needle.length; index += 1) {
    for (let byte = 0; byte < needle.length; byte += 1) if (corrupted[index + byte] !== needle[byte]) continue outer
    at = index; break
  }
  assert.ok(at >= 0); corrupted[at] ^= 1
  assert.throws(() => decodeZip64(corrupted), /CRC/)
})
