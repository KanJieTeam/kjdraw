import { test, expect } from '@playwright/test'

test('public editor preserves imported page settings through partial edit, history and DXF reopen', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK, createKJDrawEditor } = await import('/packages/kjdraw-sdk/src/index.js')
    const sdk = createKJDrawSDK(), doc = sdk.createDocument()
    await doc.transact('original sheets', tx => {
      const sheet = tx.createLayout({ name: 'Original A1', dxfPlotSettings: { paperName: 'A1', paperWidth: 594, paperHeight: 841, paperUnits: 1, rotation: 0, scaleNumerator: 1, scaleDenominator: 50, marginLeft: 7.5, printerName: '' } })
      tx.createEntity('LINE', { start: [0, 0], end: [100, 200] }, { ownerId: sheet.payload.blockRecordId })
      tx.createLayout({ name: 'Empty A5', dxfPlotSettings: { paperWidth: 148, paperHeight: 210 } })
    })
    const source = await sdk.writeDocument(doc, { format: 'DXF' })
    const host = document.createElement('div'); host.style.cssText = 'width:1100px;height:700px'; document.body.replaceChildren(host)
    const editor = createKJDrawEditor(host, { document: 'blank' }); await editor.ready
    await editor.open(new File([source], 'page-configurations.dxf'))
    const sheets = () => editor.document.snapshot().spaces.layoutIds.map(id => editor.document.getObject(id))
    const sheet = () => sheets().find(l => l.name === 'Original A1')
    const original = JSON.stringify(sheet().payload.dxfPlotSettings)
    await editor.execute('PAGESETUP', { layoutName: 'Original A1', dxf: { rotation: 1, scaleDenominator: 100 } })
    const edited = JSON.stringify(sheet().payload.dxfPlotSettings)
    await editor.undo(); const undone = JSON.stringify(sheet().payload.dxfPlotSettings) === original
    await editor.redo(); const redone = JSON.stringify(sheet().payload.dxfPlotSettings) === edited
    await editor.open(new File([await editor.save({ format: 'DXF', download: false })], 'edited-pages.dxf'))
    const reopened = sheet().payload.dxfPlotSettings
    return { undone, redone, reopened, empty: sheets().find(l => l.name === 'Empty A5').payload.dxfPlotSettings, entities: editor.document.listEntities({ ownerId: sheet().payload.blockRecordId }).map(e => e.payload.end) }
  })
  expect(result).toEqual({ undone: true, redone: true, reopened: { paperName: 'A1', paperWidth: 594, paperHeight: 841, paperUnits: 1, rotation: 1, scaleNumerator: 1, scaleDenominator: 100, marginLeft: 7.5, printerName: '' }, empty: { paperWidth: 148, paperHeight: 210 }, entities: [[100, 200, 0]] })
})


test('browser agent discovers saved sheets and queries exact paper geometry after editor page changes', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK, createKJDrawEditor, KJAgentToolSession } = await import('/packages/kjdraw-sdk/src/index.js')
    const sdk = createKJDrawSDK(), doc = sdk.createDocument()
    await doc.transact('sheets', tx => {
      const sheet = tx.createLayout({ name: 'Inspect sheet', dxfPlotSettings: { paperWidth: 420, printerName: 'PRIVATE_PRINTER' } })
      tx.createEntity('LINE', { start: [1, 2], end: [3, 4] }, { ownerId: sheet.payload.blockRecordId })
      tx.createEntity('CIRCLE', { center: [10, 20], radius: 5 })
    })
    const host = document.createElement('div'); host.style.cssText = 'width:1100px;height:700px'; document.body.replaceChildren(host)
    const editor = createKJDrawEditor(host, { document: 'blank' }); await editor.ready
    await editor.open(new File([await sdk.writeDocument(doc, { format: 'DXF' })], 'sheets.dxf'))
    await editor.execute('PAGESETUP', { layoutName: 'Inspect sheet', dxf: { paperWidth: 594, rotation: 1 } })
    await editor.open(new File([await editor.save({ format: 'DXF', download: false })], 'edited.dxf'))
    const session = new KJAgentToolSession(editor.sdk, editor.document), before = editor.document.serialize()
    const layouts = await session.call('cad_read_layouts', { expectedRevision: editor.document.revision, offset: 0, limit: 20, maxBytes: 4096 })
    if (!layouts.ok) throw new Error(JSON.stringify(layouts))
    const sheet = layouts.value.layouts.find(l => l.name === 'Inspect sheet')
    const objects = await session.call('cad_query_drawing', { expectedRevision: layouts.value.revision, filters: { spaceId: sheet.spaceId }, offset: 0, layerOffset: 0, limit: 20, maxLayers: 0, maxBytes: 4096 })
    if (!objects.ok) throw new Error(JSON.stringify(objects))
    return { page: sheet.pageSettings, types: objects.value.entities.map(e => e.type), geometry: objects.value.entities.map(e => e.geometry.end), unchanged: before === editor.document.serialize(), resourceHidden: !JSON.stringify(layouts).includes('PRIVATE_PRINTER') }
  })
  expect(result).toEqual({ page: { paperWidth: 594, rotation: 1 }, types: ['LINE'], geometry: [[3, 4, 0]], unchanged: true, resourceHidden: true })
})
