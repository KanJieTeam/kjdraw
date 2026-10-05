import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true })

let bundle = ''
test.beforeAll(async () => {
  const built = await build({
    stdin: {
      contents: "import * as sdk from './packages/kjdraw-sdk/src/index.js'; globalThis.__kjdrawContourBundle = sdk;",
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    },
    bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false,
  })
  bundle = built.outputFiles[0].text
})

test('script-bundled SDK imports lazily and executes native contours with explicit assets', async ({ page }) => {
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('.wasm')) requests.push(request.url()) })
  await page.goto('/')
  requests.length = 0
  await page.addScriptTag({ content: bundle })
  expect(await page.evaluate(() => typeof window.__kjdrawContourBundle?.createKJDrawSDK)).toBe('function')
  expect(requests).toEqual([])
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK, applyPlanarContourEdit, computePlanarContours } = window.__kjdrawContourBundle
    const drawing = createKJDrawSDK().createDocument({ units: 'millimeter' })
    await drawing.transact('Circle', tx => tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 5 }, { id: 'source' }))
    const before = drawing.serialize(), historyBefore = JSON.stringify(drawing.history)
    let unconfigured
    try {
      await applyPlanarContourEdit(drawing, { operation: 'offset', ids: ['source'], units: 'millimeter', expectedRevision: drawing.revision, distance: 2 })
      unconfigured = { rejected: false }
    } catch (error) {
      unconfigured = { rejected: true, code: error.code, message: error.message, unchanged: before === drawing.serialize(), historyUnchanged: historyBefore === JSON.stringify(drawing.history) }
    }
    const asset = '/packages/kjdraw-sdk/src/assets/kjcontour.wasm'
    const wasmBytes = new Uint8Array(await (await fetch(asset)).arrayBuffer())
    const circle = { closed: true, vertices: [{ point: [-5, 0, 0], bulge: 1 }, { point: [5, 0, 0], bulge: 1 }] }
    const outcomes = []
    for (const options of [{ wasmBytes }, { wasmUrl: new URL(asset, location.href).href }, { wasmUrl: 'packages/kjdraw-sdk/src/assets/kjcontour.wasm' }, { wasmUrl: new URL(asset, location.href) }]) {
      const geometry = await computePlanarContours({ operation: 'offset', contours: [circle], distance: 2 }, options)
      outcomes.push({ area: geometry.area, nativeArcs: geometry.contours[0].vertices.every(vertex => vertex.bulge !== 0) })
    }
    const applied = await applyPlanarContourEdit(drawing, { operation: 'offset', ids: ['source'], units: 'millimeter', expectedRevision: drawing.revision, distance: 2 }, { wasmBytes })
    const afterCount = drawing.listEntities().length
    await drawing.undo()
    const undoCount = drawing.listEntities().length
    await drawing.redo()
    const translated = { closed: true, vertices: [{ point: [1, 0, 0], bulge: 1 }, { point: [11, 0, 0], bulge: 1 }] }
    const intersection = await computePlanarContours({ operation: 'intersection', contours: [circle, translated] }, { wasmBytes })
    return { unconfigured, outcomes, appliedArea: applied.area, afterCount, undoCount, redoCount: drawing.listEntities().length,
      booleanArea: intersection.area, booleanNativeArcs: intersection.contours[0].vertices.every(vertex => vertex.bulge !== 0) }
  })
  expect(result.unconfigured).toMatchObject({ rejected: true, code: 'KJDOCUMENT_INVALID', unchanged: true, historyUnchanged: true })
  expect(result.unconfigured.message).toContain('explicit wasmUrl or wasmBytes')
  expect(result.outcomes).toHaveLength(4)
  for (const outcome of result.outcomes) {
    expect(outcome.area).toBeCloseTo(Math.PI * 49, 7)
    expect(outcome.nativeArcs).toBe(true)
  }
  expect(result.appliedArea).toBeCloseTo(Math.PI * 49, 7)
  expect(result.booleanArea).toBeCloseTo(50 * Math.acos(0.6) - 24, 7)
  expect(result.booleanNativeArcs).toBe(true)
  expect(result).toMatchObject({ afterCount: 2, undoCount: 1, redoCount: 2 })
  expect(errors).toEqual([])
})

test('script-bundled native boundaries survive history and KJD/DXF reopen for another offset', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.addScriptTag({ content: bundle })
  const result = await page.evaluate(async () => {
    const m = window.__kjdrawContourBundle
    const wasmBytes = new Uint8Array(await (await fetch('/packages/kjdraw-sdk/src/assets/kjcontour.wasm')).arrayBuffer())
    const sdk = m.createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    await drawing.transact('Scattered sources', tx => {
      const points = [[0, 0, 0], [20, 0, 0], [20, 10, 0], [0, 10, 0]]
      for (let index = 0; index < 4; index++) tx.createEntity('LINE', { start: points[index], end: points[(index + 1) % 4] }, { id: `edge-${index}` })
      tx.createEntity('CIRCLE', { center: [10, 5, 0], radius: 2 }, { id: 'hole' })
      tx.createEntity('TEXT', { text: 'Hand-added note', position: [30, 0, 0], height: 2 }, { id: 'note' })
    })
    const before = drawing.serialize(), sources = drawing.listEntities().map(entity => JSON.stringify(entity))
    const request = { ids: ['edge-3', 'hole', 'edge-1', 'edge-0', 'edge-2'], units: 'millimeter', expectedRevision: drawing.revision }
    const preview = await m.previewPlanarBoundaries(drawing, request, { wasmBytes })
    const previewReadOnly = before === drawing.serialize()
    const applied = await m.applyPlanarBoundaryExtraction(drawing, { ...request, expectedGeometryDigest: preview.receipt.geometryDigest }, { wasmBytes })
    const sourcesUnchanged = drawing.listEntities().slice(0, 6).every((entity, index) => JSON.stringify(entity) === sources[index])
    await drawing.undo()
    const undoCount = drawing.listEntities().length
    await drawing.redo()
    const reopenedSDK = m.createKJDrawSDK(), reopened = reopenedSDK.openDocument(drawing.serialize())
    const dxf = await reopenedSDK.writeDocument(reopened, { format: 'DXF', version: '2018' })
    const nativeSDK = m.createKJDrawSDK(), native = await nativeSDK.readDocument(dxf, { format: 'DXF' })
    const rings = applied.resultIds.map(id => reopened.getObject(id).handle).map(handle => native.listEntities().find(entity => entity.handle === handle))
    const continued = await m.applyPlanarContourEdit(native, { operation: 'offset', ids: rings.map(entity => entity.id), units: 'millimeter', expectedRevision: native.revision, distance: 1 }, { wasmBytes })
    return { complete: preview.complete, depths: preview.contours.map(contour => contour.depth), previewReadOnly, sourcesUnchanged,
      undoCount, redoCount: drawing.listEntities().length, resultCount: applied.resultIds.length, continuedArea: continued.area,
      nativeArcHole: rings[1].payload.vertices.every(vertex => vertex.bulge !== 0), manualNote: native.listEntities({ type: 'TEXT' })[0].payload.text }
  })
  expect(result).toMatchObject({ complete: true, depths: [0, 1], previewReadOnly: true, sourcesUnchanged: true,
    undoCount: 6, redoCount: 8, resultCount: 2, nativeArcHole: true, manualNote: 'Hand-added note' })
  expect(result.continuedArea).toBeCloseTo(260, 7)
  expect(errors).toEqual([])
})
