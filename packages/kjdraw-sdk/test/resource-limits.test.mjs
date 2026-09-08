import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK, decodeZip64, encodeZip64 } from '../src/index.js'

test('KJD and DXF readers enforce host-configurable byte budgets before parsing', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'resource-budget' })
  const kjd = document.serialize()
  await assert.rejects(
    sdk.readDocument(kjd, { format: 'KJD', limits: { maxBytes: 16 } }),
    error => /byte read limit/.test(error.cause?.message ?? error.message),
  )

  const dxf = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'
  await assert.rejects(
    sdk.readDocument(dxf, { format: 'DXF', limits: { maxBytes: 16 } }),
    error => /byte read limit/.test(error.cause?.message ?? error.message),
  )
})

test('KJD and DXF readers enforce object and tag budgets', async () => {
  const sdk = createKJDrawSDK()
  const source = sdk.createDocument({ documentId: 'object-budget' }).toJSON()
  await assert.rejects(
    sdk.readDocument(source, { format: 'KJD', limits: { maxObjects: 1 } }),
    error => /object count/.test(error.cause?.message ?? error.message),
  )
  const dxf = '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n0\nENDSEC\n0\nEOF\n'
  await assert.rejects(
    sdk.readDocument(dxf, { format: 'DXF', limits: { maxTags: 2 } }),
    error => /tag count/.test(error.cause?.message ?? error.message),
  )
})

test('KJP rejects oversized archives and individual entries before copying content', () => {
  const archive = encodeZip64({ 'manifest.json': '0123456789', 'history/commands.ndjson': '' })
  assert.throws(() => decodeZip64(archive, { maxArchiveBytes: 16 }), /archive exceeds/)
  assert.throws(() => decodeZip64(archive, { maxEntryBytes: 4 }), /单文件限制/)
})
