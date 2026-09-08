import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDXFFileAdapter,
  decodeZip64,
  encodeZip64,
  openKjpPackage,
} from '../src/index.js'

test('DXF and KJP readers reject work that was already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const dxf = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'
  await assert.rejects(createDXFFileAdapter().read(dxf, { signal: controller.signal }), /DXF read aborted/)
  await assert.rejects(openKjpPackage(new Uint8Array(), { signal: controller.signal }), /KJP read aborted/)
})

test('KJP validates finite limits and cumulative unpacked size', () => {
  const archive = encodeZip64({ 'one.bin': '12345', 'two.bin': '67890' })
  assert.throws(() => decodeZip64(archive, { maxArchiveBytes: Number.NaN }), /有限正数/)
  assert.throws(() => decodeZip64(archive, { maxEntryBytes: 10, maxUncompressedBytes: 8 }), /解包大小超过限制/)
})
