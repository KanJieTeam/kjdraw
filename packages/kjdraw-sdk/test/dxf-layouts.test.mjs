import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { createDXFFileAdapter } from '../src/dxf-adapter.js'

test('DXF preserves empty named layouts and explicit block ownership without 410 tags', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  await document.transact('three sheets', tx => {
    const populated = tx.createLayout({ name: 'Plan A' })
    tx.createLayout({ name: 'Empty B' })
    tx.createEntity('LINE', { start: [1, 2], end: [3, 4] }, { ownerId: populated.payload.blockRecordId })
  })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  // Real ownership, not an entity's optional layout-name hint, locates the sheet.
  const withoutHints = dxf.replace(/410\r\n[^\r\n]*\r\n/g, '')
  const reopened = await createKJDrawSDK().readDocument(withoutHints, { format: 'DXF' })
  const layouts = reopened.snapshot().spaces.layoutIds.map(id => reopened.getObject(id))
  assert.deepEqual(layouts.map(x => x.name), ['Model', 'Layout1', 'Plan A', 'Empty B'])
  assert.equal(reopened.listEntities({ ownerId: layouts[2].payload.blockRecordId }).length, 1)
  assert.equal(reopened.listEntities({ ownerId: layouts[3].payload.blockRecordId }).length, 0)
  assert.equal(reopened.getTable('blockRecords').records.filter(x => x.payload.isSpace).length, 4)
  const again = await sdk.writeDocument(reopened, { format: 'DXF', version: '2018' })
  assert.equal((again.match(/\r\nLAYOUT\r\n/g) ?? []).length, 4)
  assert.equal(reopened.validate().valid, true)
})

const record = (type, ...tags) => [0, type, ...tags].join('\n') + '\n'
const section = (name, content) => record('SECTION', 2, name) + content + record('ENDSEC')
const line = (handle, owner, x = 1) => record('LINE', 5, handle, 102, '{ACAD_REACTORS', 330, 'DEAD', 102, '}', ...(owner ? [330, owner] : []), 10, x, 20, 2, 11, x + 3, 21, 4)
const read = text => createKJDrawSDK().readDocument(text + record('EOF'), { format: 'DXF' })
const layoutsOf = doc => doc.snapshot().spaces.layoutIds.map(id => doc.getObject(id))

test('DXF legacy/noncontinuous space blocks retain entities and empty spaces without OBJECTS or hints', async () => {
  const blocks = [['*Model_Space', 'A0'], ['*Paper_Space', 'B0'], ['*Paper_Space7', 'C0'], ['*Paper_Space42', 'D0']]
  const doc = await read(section('TABLES', blocks.map(([name, handle]) => record('BLOCK_RECORD', 5, handle, 2, name)).join('')) +
    section('BLOCKS', blocks.map(([name, handle], i) => record('BLOCK', 330, handle, 2, name) + (i === 2 ? line('E2', handle, 20) : '') + record('ENDBLK')).join('')) +
    section('ENTITIES', line('E0', 'A0') + line('E1', 'B0', 10)))
  assert.deepEqual(layoutsOf(doc).map(l => l.name), ['Model', 'Layout1', 'Layout7', 'Layout42'])
  assert.deepEqual(layoutsOf(doc).map(l => doc.listEntities({ ownerId: l.payload.blockRecordId }).map(e => e.payload.start[0])), [[1], [10], [20], []])
  assert.equal(doc.getTable('blockRecords').records.filter(b => b.payload.isSpace).length, 4)
})

test('DXF R12 block-contained paper geometry stays in paper space', async () => {
  const doc = await read(section('BLOCKS', record('BLOCK', 2, '$PAPER_SPACE') + line('E0', '') + record('ENDBLK')) + section('ENTITIES', line('E1', '', 50)))
  assert.deepEqual(layoutsOf(doc).map(l => doc.listEntities({ ownerId: l.payload.blockRecordId }).map(e => e.payload.start[0])), [[50], [1]])
})

test('DXF resolves layout subclass owner, preserves sparse tab order and does not invent Layout1 from 67', async () => {
  const doc = await read(section('TABLES', record('BLOCK_RECORD', 5, 'B0', 2, '*Paper_Space7')) +
    section('OBJECTS', record('LAYOUT', 5, 'B1', 330, 'FF', 100, 'AcDbPlotSettings', 1, 'Plot preset', 100, 'AcDbLayout', 1, 'Sheet Z', 71, 17, 330, 'B0') + record('LAYOUT', 5, 'C1', 100, 'AcDbLayout', 1, 'Empty', 71, 3, 330, 'C0')) +
    section('ENTITIES', line('E0', 'B0') .replace('10\n1\n', '67\n1\n10\n1\n')))
  assert.deepEqual(layoutsOf(doc).map(l => [l.name, l.payload.tabOrder]), [['Model', 0], ['Empty', 3], ['Sheet Z', 17]])
  assert.equal(doc.listEntities({ ownerId: layoutsOf(doc)[2].payload.blockRecordId }).length, 1)
  const output = await createKJDrawSDK().writeDocument(doc, { format: 'DXF', version: '2018' })
  const again = await read(output)
  assert.deepEqual(layoutsOf(again).map(l => [l.name, l.payload.tabOrder]), layoutsOf(doc).map(l => [l.name, l.payload.tabOrder]))
})

test('DXF duplicate cross-section space entities import once; conflicting handles and ambiguous owners reject', async () => {
  const block = section('BLOCKS', record('BLOCK', 2, '*Model_Space') + line('E0', '') + record('ENDBLK'))
  assert.equal((await read(block + section('ENTITIES', line('E0', '')))).listEntities().length, 1)
  await assert.rejects(read(block + section('ENTITIES', line('E0', '', 8))), e => /conflicting duplicate/.test(e.cause?.message))
  await assert.rejects(read(section('ENTITIES', line('E0', 'ABCD'))), e => /unknown owner/.test(e.cause?.message))
  await assert.rejects(read(section('OBJECTS', record('LAYOUT', 100, 'AcDbLayout', 1, 'Sheet', 330, 'B0') + record('LAYOUT', 100, 'AcDbLayout', 1, 'sheet', 330, 'C0'))), e => /duplicate layout/.test(e.cause?.message))
})

test('DXF versions keep model/paper membership through save, reopen, move and history', async () => {
  for (const version of ['R12', 'R14', '2000', '2004', '2010', '2013', '2018', '2024']) {
    const sdk = createKJDrawSDK(), doc = sdk.createDocument()
    const paper = layoutsOf(doc)[1]
    let entity
    await doc.transact('paper line', tx => { entity = tx.createEntity('LINE', { start: [1, 2], end: [3, 4] }, { ownerId: paper.payload.blockRecordId }) })
    await sdk.executeCommand('MOVE', { id: entity.id, dx: 10, dy: 20 })
    const reopened = await read(await createDXFFileAdapter().write(doc, { format: 'DXF', version }))
    const actual = reopened.listEntities({ ownerId: layoutsOf(reopened)[1].payload.blockRecordId })
    assert.deepEqual(actual.map(e => e.payload.start), [[11, 22, 0]], version)
    await sdk.executeCommand('UNDO')
    assert.deepEqual(doc.getObject(entity.id).payload.start, [1, 2, 0])
    await sdk.executeCommand('REDO')
    assert.equal(doc.getObject(entity.id).ownerId, paper.payload.blockRecordId)
    if (version === 'R12' || version === 'R14') {
      await doc.transact('empty extra sheet', tx => tx.createLayout({ name: 'Empty extra' }))
      assert.throws(() => createDXFFileAdapter().write(doc, { format: 'DXF', version }), /cannot preserve multiple named paper spaces/)
    }
  }
})
