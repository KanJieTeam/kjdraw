import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createLayoutContext, createDrawingContext } from '../src/drawing-context.js'

const options = doc => ({ expectedRevision: doc.revision, offset: 0, limit: 100, maxBytes: 16384 })
async function fixture() {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument()
  let sheet
  await doc.transact('sheets', tx => {
    sheet = tx.createLayout({ name: 'Sheet — 图纸', dxfPlotSettings: { paperWidth: 594, paperHeight: 841, rotation: 1, paperUnits: 0, scaleDenominator: 100, printerName: 'PRIVATE_PRINTER', styleSheet: 'PRIVATE_STYLE', pageSetupName: 'PRIVATE_SETUP', paperName: 'PRIVATE_PAPER', viewName: 'PRIVATE_VIEW' } })
    tx.updateObject(sheet.id, { payload: { custom: 'PRIVATE_PAYLOAD', plotSettings: { outputDevice: 'PRIVATE_DEVICE' } } })
    tx.createEntity('LINE', { start: [1, 2], end: [3, 4] }, { id: 'paper-line', ownerId: sheet.payload.blockRecordId })
    tx.createEntity('LINE', { start: [10, 20], end: [30, 40] }, { id: 'model-line' })
    tx.createLayout({ name: 'Empty sheet' })
  })
  return { sdk, doc, sheet, session: new KJAgentToolSession(sdk, doc) }
}

test('layout discovery exposes exact owner IDs and numeric page settings without resource payloads or mutations', async () => {
  const { doc, sheet, session } = await fixture(), before = doc.serialize()
  const result = await session.call('cad_read_layouts', options(doc))
  assert.equal(result.ok, true, JSON.stringify(result))
  const context = result.value, row = context.layouts.find(l => l.id === sheet.id)
  assert.equal(context.layouts.length, 4)
  assert.equal(context.layouts.filter(l => l.model).length, 1)
  assert.equal(context.layouts.filter(l => l.active).length, 1)
  assert.deepEqual(row.pageSettings, { paperWidth: 594, paperHeight: 841, scaleDenominator: 100, paperUnits: 0, rotation: 1 })
  assert.equal(row.spaceId, sheet.payload.blockRecordId)
  assert.ok(!JSON.stringify(context).includes('PRIVATE_'))
  assert.equal(context.pageSemantics.physicalUnits, 'millimeter')
  assert.ok(Object.isFrozen(row.pageSettings)); assert.ok(Object.isFrozen(context.layouts))
  const query = await session.call('cad_query_drawing', { expectedRevision: context.revision, filters: { spaceId: row.spaceId, types: ['LINE'] }, offset: 0, layerOffset: 0, limit: 20, maxLayers: 0, maxBytes: 2048 })
  assert.equal(query.ok, true); assert.deepEqual(query.value.entities.map(e => e.id), ['paper-line'])
  assert.equal(doc.serialize(), before)
})

test('layout pagination obeys UTF-8 budgets and advances across long Unicode names without losing identities', async () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument()
  await doc.transact('many sheets', tx => {
    for (let i = 0; i < 25; i++) tx.createLayout({ name: `${i}-` + '图'.repeat(i % 2 ? 510 : 600), dxfPlotSettings: { paperWidth: 100 + i, paperHeight: 200 + i } })
  })
  const all = [], omitted = [], expected = doc.snapshot().spaces.layoutIds
  let offset = 0
  do {
    const page = createLayoutContext(doc, { expectedRevision: doc.revision, offset, limit: 3, maxBytes: 1024 })
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024)
    assert.ok(page.layouts.length > 0 && page.layouts.length <= 3)
    all.push(...page.layouts.map(l => l.id)); omitted.push(...page.layouts.flatMap(l => l.omitted))
    if (page.nextOffset !== null) assert.ok(page.nextOffset > offset)
    offset = page.nextOffset
  } while (offset !== null)
  assert.deepEqual(all, expected); assert.ok(omitted.includes('name')); assert.ok(omitted.includes('page-settings'))
  assert.deepEqual(createLayoutContext(doc, { expectedRevision: doc.revision, offset: 999 }).layouts, [])
})

test('layout reads reject malformed and stale requests; page edits, undo, redo and DXF reopening are observed', async () => {
  const { sdk, doc, sheet, session } = await fixture(), originalRevision = doc.revision
  for (const bad of [null, [], { nope: 1 }, { limit: 0 }, { limit: 101 }, { maxBytes: 1023 }, { maxBytes: 262145 }, { offset: 1 }, { offset: -1 }, { expectedRevision: NaN }]) assert.throws(() => createLayoutContext(doc, bad))
  assert.equal((await session.call('cad_read_layouts', { ...options(doc), extra: true })).ok, false)
  assert.equal((await session.call('cad_read_layouts', { offset: 0, limit: 1, maxBytes: 1024 })).ok, false)
  await sdk.executeCommand('PAGESETUP', { layoutId: sheet.id, dxf: { paperWidth: 610 } })
  assert.throws(() => createLayoutContext(doc, { expectedRevision: originalRevision }), /revision/i)
  assert.equal((await session.call('cad_read_layouts', { ...options(doc), expectedRevision: originalRevision })).ok, false)
  const width = () => createLayoutContext(doc).layouts.find(l => l.id === sheet.id).pageSettings.paperWidth
  assert.equal(width(), 610)
  await sdk.executeCommand('UNDO'); assert.equal(width(), 594)
  await sdk.executeCommand('REDO'); assert.equal(width(), 610)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(doc, { format: 'DXF' }), { format: 'DXF' })
  const row = createLayoutContext(reopened).layouts.find(l => l.name === sheet.name)
  assert.equal(row.pageSettings.paperWidth, 610)
  assert.deepEqual(createDrawingContext(reopened, { spaceId: row.spaceId }).entities.map(e => e.geometry.end), [[3, 4, 0]])
})

test('layout identity cannot be silently shortened to meet a response budget', () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument({ documentId: '图'.repeat(1100) })
  assert.throws(() => createLayoutContext(doc, { maxBytes: 1024 }), /budget/)
})
