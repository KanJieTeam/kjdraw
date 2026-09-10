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
