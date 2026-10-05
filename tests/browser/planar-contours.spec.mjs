import { test, expect } from '@playwright/test'

test('native arc regions load in the browser and remain editable after reopen', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const sdkModule = await import('/packages/kjdraw-sdk/src/index.js')
    const { computePlanarContours, previewPlanarContourEdit, applyPlanarContourEdit } = sdkModule
    const circle = (x, radius) => ({ closed: true, vertices: [
      { point: [x - radius, 0, 0], bulge: 1 }, { point: [x + radius, 0, 0], bulge: 1 },
    ] })
    const overlap = await computePlanarContours({ operation: 'intersection', contours: [circle(0, 5), circle(6, 5)] })
    const square = x => ({ closed: true, vertices: [[x, x, 0], [x + 10, x, 0], [x + 10, x + 10, 0], [x, x + 10, 0]].map(point => ({ point })) })
    const separated = await computePlanarContours({ operation: 'union', contours: [square(9e8), square(-9e8)] })
    const sdk = sdkModule.createKJDrawSDK()
    const drawing = sdk.createDocument({ units: 'millimeter' })
    await drawing.transact('Circle', tx => tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 5 }, { id: 'source' }))
    const original = JSON.stringify(drawing.getObject('source'))
    const before = drawing.serialize()
    const request = { operation: 'offset', ids: ['source'], units: 'millimeter', expectedRevision: drawing.revision, distance: 2 }
    const preview = await previewPlanarContourEdit(drawing, request)
    const previewUnchanged = before === drawing.serialize()
    const applied = await applyPlanarContourEdit(drawing, { ...request, expectedGeometryDigest: preview.receipt.geometryDigest })
    const nativeArcs = drawing.getObject(applied.resultIds[0]).payload.vertices.every(v => v.bulge !== 0)
    const afterCount = drawing.listEntities().length
    await drawing.undo()
    const undoCount = drawing.listEntities().length
    await drawing.redo()
    const reopenedSdk = sdkModule.createKJDrawSDK()
    const reopened = reopenedSdk.openDocument(drawing.serialize())
    const next = await reopenedSdk.executeCommand('CONTOUROFFSET', {
      ids: [applied.resultIds[0]], units: 'millimeter', expectedRevision: reopened.revision, distance: 1,
    }, { document: reopened, expectedRevision: reopened.revision })
    return {
      overlapArea: overlap.area, overlapBulges: overlap.contours[0].vertices.map(v => v.bulge),
      separatedArea: separated.area,
      area: applied.area, afterCount, undoCount, redoCount: drawing.listEntities().length,
      previewUnchanged, originalUnchanged: original === JSON.stringify(drawing.getObject('source')),
      nativeArcs, nextArea: next.area, nextCount: reopened.listEntities().length,
    }
  })
  const lensArea = 50 * Math.acos(0.6) - 3 * Math.sqrt(64)
  expect(result.overlapArea).toBeCloseTo(lensArea, 7)
  expect(result.overlapBulges.every(value => value !== 0)).toBe(true)
  expect(result.separatedArea).toBe(200)
  expect(result.area).toBeCloseTo(Math.PI * 49, 7)
  expect(result.nextArea).toBeCloseTo(Math.PI * 64, 7)
  expect(result).toMatchObject({ afterCount: 2, undoCount: 1, redoCount: 2, nextCount: 3, previewUnchanged: true, originalUnchanged: true, nativeArcs: true })
  expect(errors).toEqual([])
})

test('missing native assets fail without changing a browser document', async ({ page }) => {
  await page.goto('/')
  await page.route('**/missing-contour.wasm', route => route.fulfill({ status: 404, body: 'missing' }))
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK, applyPlanarContourEdit } = await import('/packages/kjdraw-sdk/src/index.js')
    const drawing = createKJDrawSDK().createDocument({ units: 'millimeter' })
    await drawing.transact('Circle', tx => tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 5 }, { id: 'source' }))
    const before = drawing.serialize()
    try {
      await applyPlanarContourEdit(drawing, { operation: 'offset', ids: ['source'], units: 'millimeter', expectedRevision: drawing.revision, distance: 1 }, { wasmUrl: '/missing-contour.wasm' })
      return { rejected: false }
    } catch (error) { return { rejected: true, unchanged: before === drawing.serialize(), message: error.message } }
  })
  expect(result).toMatchObject({ rejected: true, unchanged: true })
  expect(result.message).toContain('404')
})
