import { test, expect } from '@playwright/test'

test('scattered native boundaries are reviewed, committed and edited after browser save/reopen', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const m = await import('/packages/kjdraw-sdk/src/index.js')
    const sdk = m.createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    await document.transact('Scattered contour', tx => {
      const points = [[0, 0, 0], [20, 0, 0], [20, 10, 0], [0, 10, 0]]
      for (let i = 0; i < 4; i++) tx.createEntity('LINE', { start: points[i], end: points[(i + 1) % 4] }, { id: `edge-${i}` })
      tx.createEntity('CIRCLE', { center: [10, 5, 0], radius: 2 }, { id: 'hole' })
      tx.createEntity('TEXT', { text: 'Hand-added note', position: [30, 0, 0], height: 2 }, { id: 'note' })
    })
    const before = document.serialize(), sourceRecords = document.listEntities().map(e => JSON.stringify(e))
    const request = { ids: ['edge-3', 'hole', 'edge-1', 'edge-0', 'edge-2'], units: 'millimeter', expectedRevision: document.revision }
    const preview = await m.previewPlanarBoundaries(document, request)
    const previewReadOnly = before === document.serialize()
    const applied = await sdk.executeCommand('CONTOURBOUNDARIES', { ...request, expectedGeometryDigest: preview.receipt.geometryDigest }, { document, expectedRevision: document.revision })
    const sourcesUnchanged = document.listEntities().slice(0, 6).map(e => JSON.stringify(e)).every((value, i) => value === sourceRecords[i])
    await document.undo()
    const undoCount = document.listEntities().length
    await document.redo()
    const reopenedSDK = m.createKJDrawSDK(), reopened = reopenedSDK.openDocument(document.serialize())
    const dxf = await reopenedSDK.writeDocument(reopened, { format: 'DXF', version: '2018' })
    const nativeSDK = m.createKJDrawSDK(), native = await nativeSDK.readDocument(dxf, { format: 'DXF' })
    const nativeRings = applied.resultIds.map(id => reopened.getObject(id).handle).map(handle => native.listEntities().find(e => e.handle === handle))
    const continued = await nativeSDK.executeCommand('CONTOUROFFSET', { operation: 'offset', ids: nativeRings.map(e => e.id), units: 'millimeter', expectedRevision: native.revision, distance: 1 }, { document: native, expectedRevision: native.revision })
    return { complete: preview.complete, depths: preview.contours.map(c => c.depth), previewReadOnly, sourcesUnchanged, undoCount, redoCount: document.listEntities().length, resultCount: applied.resultIds.length, continuedArea: continued.area, manualNote: native.listEntities({ type: 'TEXT' })[0].payload.text }
  })
  expect(result).toMatchObject({ complete: true, depths: [0, 1], previewReadOnly: true, sourcesUnchanged: true, undoCount: 6, redoCount: 8, resultCount: 2, manualNote: 'Hand-added note' })
  expect(result.continuedArea).toBeCloseTo(260, 7)
  expect(errors).toEqual([])
})

test('a diagnosed gap cannot create partial browser geometry or history', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const m = await import('/packages/kjdraw-sdk/src/index.js')
    const sdk = m.createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    await document.transact('Open input', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { id: 'open' }))
    const request = { ids: ['open'], units: 'millimeter', expectedRevision: document.revision }, before = document.serialize(), history = document.history
    const preview = await m.previewPlanarBoundaries(document, request)
    let refused = false
    try { await m.applyPlanarBoundaryExtraction(document, { ...request, expectedGeometryDigest: preview.receipt.geometryDigest }) } catch (error) { refused = /incomplete/i.test(error.message) }
    return { complete: preview.complete, codes: preview.diagnostics.map(d => d.code), refused, unchanged: before === document.serialize(), sameHistory: JSON.stringify(history) === JSON.stringify(document.history) }
  })
  expect(result).toMatchObject({ complete: false, codes: ['open-chain'], refused: true, unchanged: true, sameHistory: true })
})
