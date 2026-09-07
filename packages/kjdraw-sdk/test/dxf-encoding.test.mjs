import assert from 'node:assert/strict'
import test from 'node:test'
import { createDXFFileAdapter } from '../src/dxf-adapter.js'

test('DXF adapter honors ANSI_936 byte sources', async () => {
  const before = new TextEncoder().encode([
    '0','SECTION','2','HEADER','9','$ACADVER','1','AC1032','9','$DWGCODEPAGE','3','ANSI_936','0','ENDSEC',
    '0','SECTION','2','ENTITIES','0','TEXT','5','10','8','0','10','1','20','2','30','0','40','2.5','1',
  ].join('\r\n') + '\r\n')
  const chinese = Uint8Array.from([0xbf, 0xb1, 0xbd, 0xe7, 0xcd, 0xbc, 0xc7, 0xa9])
  const after = new TextEncoder().encode('\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n')
  const bytes = new Uint8Array(before.length + chinese.length + after.length)
  bytes.set(before); bytes.set(chinese, before.length); bytes.set(after, before.length + chinese.length)
  const document = await createDXFFileAdapter().read(bytes)
  assert.equal(document.listEntities()[0].payload.text, '勘界图签')
  assert.equal(document.toJSON().header.codePage, 'ANSI_936')
})
