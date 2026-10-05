import assert from 'node:assert/strict'
import test from 'node:test'
import { createDXFFileAdapter } from '../src/index.js'
import { DXF_VIEWPORT_METADATA_KEY } from '../src/dxf-viewport-metadata.js'

// Anonymous standard DXF objects, never derived from a user's drawing.
const fixture = () => [
  0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES',
  0, 'TEXT', 5, '10', 8, '0', 10, 1, 20, 2, 40, 2, 1, 'SYNTHETIC',
  0, 'VIEWPORT', 5, '20', 102, '{ACAD_XDICTIONARY', 360, '30', 102, '}', 8, '0', 67, 1,
  10, 50, 20, 50, 30, 0, 40, 90, 41, 80, 68, 1, 69, 2,
  12, 0, 22, 0, 16, 0, 26, 0, 36, 1, 17, 0, 27, 0, 37, 0, 45, 80, 90, 0,
  0, 'ENDSEC', 0, 'SECTION', 2, 'OBJECTS',
  0, 'DICTIONARY', 5, '30', 330, '20', 100, 'AcDbDictionary', 281, 1, 3, 'SYNTHETIC_DATA', 360, '31',
  0, 'XRECORD', 5, '31', 330, '30', 100, 'AcDbXrecord', 280, 1, 1, 'opaque annotation data',
  0, 'ENDSEC', 0, 'EOF', '',
].join('\n')

async function forgedGraph(mutator) {
  const adapter = createDXFFileAdapter()
  const document = await adapter.read(fixture())
  const metadata = structuredClone(document.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY])
  mutator(metadata, document)
  await document.transact('Simulate caller-supplied opaque metadata', tx => tx.putOpaquePayload(DXF_VIEWPORT_METADATA_KEY, metadata))
  return { adapter, document }
}

test('viewport extension dictionary references cannot survive a removed stored graph as dangling handles', async () => {
  const { adapter, document } = await forgedGraph(metadata => {
    metadata.records = []
    metadata.rootEntries = []
    metadata.entityReferences = []
  })
  assert.throws(() => adapter.write(document), /viewport metadata|unresolved|missing|unavailable/iu)
})

test('stored metadata reference aliases cannot redirect an extension dictionary to an unrelated TEXT entity', async () => {
  const { adapter, document } = await forgedGraph((metadata, source) => {
    metadata.entityReferences.push({ handle: '30', id: source.listEntities({ type: 'TEXT' })[0].id })
  })
  assert.throws(() => adapter.write(document), /viewport metadata|collision|alias|ambiguous/iu)
})

test('invalid stored metadata source versions cannot bypass the opaque DXF format conversion gate', async () => {
  const { adapter, document } = await forgedGraph(metadata => { metadata.sourceVersion = 'INVALID' })
  assert.throws(() => adapter.write(document, { version: '2018' }), /viewport metadata|version|format/iu)
})

test('viewport visual-style handles cannot refer to an unrelated native TEXT entity', async () => {
  const source = fixture().replace('90\n0\n0\nENDSEC', '90\n0\n348\n10\n0\nENDSEC')
  const adapter = createDXFFileAdapter()
  const document = await adapter.read(source)
  assert.throws(() => adapter.write(document), /viewport metadata|visual style|VISUALSTYLE|reference/iu)
})

test('duplicate metadata object handles and erased metadata entity targets remain rejected', async () => {
  const duplicated = await forgedGraph(metadata => { metadata.records.push(structuredClone(metadata.records[0])) })
  assert.throws(() => duplicated.adapter.write(duplicated.document), /collision/iu)

  const adapter = createDXFFileAdapter()
  const document = await adapter.read(fixture())
  const viewport = document.listEntities({ type: 'VIEWPORT' })[0]
  await document.transact('Erase viewport', tx => tx.eraseObject(viewport.id))
  assert.throws(() => adapter.write(document), /erased|unavailable|viewport changed/iu)
})

test('unsupported viewport extension metadata remains viewable but cannot be silently exported', async () => {
  const source = fixture().replace('1\nopaque annotation data', '1\nopaque annotation data\n1001\nSYNTHETIC_APP\n1000\nopaque XDATA')
  const adapter = createDXFFileAdapter()
  const document = await adapter.read(source)
  assert.equal(document.listEntities({ type: 'VIEWPORT' }).length, 1)
  assert.equal(document.listEntities({ type: 'TEXT' }).length, 1)
  assert.throws(() => adapter.write(document), /unsupported|metadata|XDATA/iu)
})
