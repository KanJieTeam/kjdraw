import assert from 'node:assert/strict'
import test from 'node:test'
import { createDXFFileAdapter } from '../src/dxf-adapter.js'

test('legacy DXF adapter honors ANSI_936 byte sources', async () => {
  const before = new TextEncoder().encode([
    '0','SECTION','2','HEADER','9','$ACADVER','1','AC1018','9','$DWGCODEPAGE','3','ANSI_936','0','ENDSEC',
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

function modernFile(version, codePage, text) {
  return ['0','SECTION','2','HEADER','9','$ACADVER','1',version,
    '9','$DWGCODEPAGE','3',codePage,'0','ENDSEC',
    '0','SECTION','2','ENTITIES','0','TEXT','5','100','8','0',
    '10','1','20','2','40','2.5','1',text,'0','ENDSEC','0','EOF',''].join('\r\n')
}

test('R2007 and later UTF-8 bytes override stale legacy codepage headers', async () => {
  const adapter = createDXFFileAdapter()
  const text = '工程剖面 · Café · 日本語 · Δ · 🛠'
  for (const version of ['AC1021', 'AC1024', 'AC1027', 'AC1032']) {
    for (const codePage of ['ANSI_936', 'ANSI_1252', 'ANSI_932']) {
      const bytes = new TextEncoder().encode(modernFile(version, codePage, text))
      for (const source of [bytes, bytes.buffer, new Blob([bytes])]) {
        const doc = await adapter.read(source)
        assert.equal(doc.listEntities()[0].payload.text, text, `${version}/${codePage}`)
        const reopened = await adapter.read(new TextEncoder().encode(adapter.write(doc, { version: '2018' })))
        assert.equal(reopened.listEntities()[0].payload.text, text)
      }
    }
  }
})

test('invalid modern UTF-8 fails instead of silently corrupting drawing text', async () => {
  const bytes = new TextEncoder().encode(modernFile('AC1032', 'ANSI_936', 'MARKER'))
  bytes[Buffer.from(bytes).indexOf('MARKER')] = 0xff
  await assert.rejects(createDXFFileAdapter().read(bytes), /UTF-8/)
})

test('DXF text and intermediate MTEXT chunks retain significant whitespace', async () => {
  const adapter = createDXFFileAdapter()
  const text = '  中文图签  '
  const file = modernFile('AC1032', 'ANSI_936', text).replace(
    '0\r\nENDSEC\r\n0\r\nEOF',
    '0\r\nMTEXT\r\n5\r\n200\r\n8\r\n0\r\n10\r\n0\r\n20\r\n0\r\n40\r\n2.5\r\n3\r\nfirst chunk  \r\n1\r\nlast chunk  \r\n0\r\nENDSEC\r\n0\r\nEOF')
  const doc = await adapter.read(new TextEncoder().encode(file))
  const expected = [text, 'first chunk  last chunk  ']
  assert.deepEqual(doc.listEntities().map(e => e.payload.text), expected)
  const reopened = await adapter.read(new TextEncoder().encode(adapter.write(doc, { version: '2018' })))
  assert.deepEqual(reopened.listEntities().map(e => e.payload.text), expected)
})
