import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true })
let bundle = ''
test.beforeAll(async () => {
  const built = await build({
    stdin: { contents: "import * as sdk from './packages/kjdraw-sdk/src/index.js'; import { KJDrawWorkbench } from './packages/kjdraw-sdk/src/workbench.js'; globalThis.__kjdrawContourCommands = { ...sdk, KJDrawWorkbench };", resolveDir: fileURLToPath(new URL('../../', import.meta.url)) },
    bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false,
  })
  bundle = built.outputFiles[0].text
})

for (const assetKind of ['bytes', 'absolute-url', 'relative-url', 'url-object']) {
  test(`script-bundled editor, workbench and confirmed agent contour commands use ${assetKind}`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async assetKind => {
      const m = window.__kjdrawContourCommands
      const asset = '/packages/kjdraw-sdk/src/assets/kjcontour.wasm'
      const backend = assetKind === 'bytes' ? { wasmBytes: new Uint8Array(await (await fetch(asset)).arrayBuffer()) }
        : { wasmUrl: assetKind === 'url-object' ? new URL(asset, location.href) : assetKind === 'absolute-url' ? new URL(asset, location.href).href : asset.slice(1) }
      const sdk = m.createKJDrawSDK({ contourBackend: backend })
      const drawing = sdk.createDocument({ units: 'millimeter' })
      await drawing.transact('Sources and manual note', tx => {
        tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 5 }, { id: 'circle-a' })
        tx.createEntity('CIRCLE', { center: [6, 0, 0], radius: 5 }, { id: 'circle-b' })
        const points = [[30, 0, 0], [50, 0, 0], [50, 10, 0], [30, 10, 0]]
        for (let i = 0; i < 4; i++) tx.createEntity('LINE', { start: points[i], end: points[(i + 1) % 4] }, { id: `edge-${i}` })
        tx.createEntity('CIRCLE', { center: [40, 5, 0], radius: 2 }, { id: 'hole' })
        tx.createEntity('TEXT', { text: 'Hand-added note', position: [60, 0, 0], height: 2 }, { id: 'note' })
      })
      const sources = drawing.listEntities().map(entity => JSON.stringify(entity))
      const host = document.createElement('div'); host.style.cssText = 'width:900px;height:500px'; document.body.append(host)
      const editor = m.createKJDrawEditor(host, { sdk, document: drawing, grid: false, toolbar: false, layers: false, properties: false })
      await editor.ready
      const before = drawing.serialize(), history = JSON.stringify(drawing.history)
      const offsetRequest = { operation: 'offset', ids: ['circle-a'], units: 'millimeter', expectedRevision: drawing.revision, distance: 2 }
      // Direct preview already worked before the fix; the actual registered command must use the SDK's host asset too.
      const offsetPreview = await m.previewPlanarContourEdit(drawing, offsetRequest, backend)
      const previewReadOnly = before === drawing.serialize() && history === JSON.stringify(drawing.history)
      const offset = (await editor.execute('CONTOUROFFSET', { ...offsetRequest, expectedGeometryDigest: offsetPreview.receipt.geometryDigest })).result
      await editor.undo()
      const undoCount = drawing.listEntities().length
      await editor.redo()
      const redoCount = drawing.listEntities().length
      const booleanRequest = { operation: 'intersection', ids: ['circle-a', 'circle-b'], units: 'millimeter', expectedRevision: drawing.revision }
      const booleanPreview = await m.previewPlanarContourEdit(drawing, booleanRequest, sdk.contourBackend)
      const boolean = (await editor.workbench.execute('CONTOURBOOLEAN', { ...booleanRequest, expectedGeometryDigest: booleanPreview.receipt.geometryDigest })).result
      const boundaryRequest = { ids: ['edge-3', 'hole', 'edge-1', 'edge-0', 'edge-2'], units: 'millimeter', expectedRevision: drawing.revision }
      const boundaryBefore = drawing.serialize()
      const boundaryPreview = await m.previewPlanarBoundaries(drawing, boundaryRequest, sdk.contourBackend)
      const boundaryArgs = { ...boundaryRequest, expectedGeometryDigest: boundaryPreview.receipt.geometryDigest }
      const proposal = sdk.createCommandEnvelope('CONTOURBOUNDARIES', boundaryArgs, { document: drawing, expectedRevision: drawing.revision, mode: 'plan', origin: 'ai' })
      const planned = await sdk.executeCommandEnvelope(proposal)
      const agentReadOnly = boundaryBefore === drawing.serialize()
      const envelope = sdk.createCommandEnvelope('CONTOURBOUNDARIES', boundaryArgs, { document: drawing, expectedRevision: drawing.revision, origin: 'ai', confirmation: { status: 'confirmed', planId: proposal.id, confirmedBy: 'browser-test-reviewer' } })
      const boundaries = (await sdk.executeCommandEnvelope(envelope)).result
      const sourcesUnchanged = drawing.listEntities().slice(0, 8).every((entity, i) => JSON.stringify(entity) === sources[i])
      const saved = await editor.save({ format: 'KJD', download: false })
      const savedWithoutBackend = !/wasmBytes|wasmUrl|contourBackend/.test(saved) && !/wasmBytes|wasmUrl|contourBackend/.test(JSON.stringify(envelope))
      editor.dispose(); host.remove()
      const reopenedSDK = m.createKJDrawSDK({ contourBackend: backend }), reopened = reopenedSDK.openDocument(saved)
      const continued = await reopenedSDK.executeCommand('CONTOUROFFSET', { ids: offset.resultIds, units: 'millimeter', expectedRevision: reopened.revision, distance: 1 }, { document: reopened, expectedRevision: reopened.revision })
      const dxf = await reopenedSDK.writeDocument(reopened, { format: 'DXF', version: '2018' })
      const nativeSDK = m.createKJDrawSDK({ contourBackend: backend }), native = await nativeSDK.readDocument(dxf, { format: 'DXF' })
      const handles = boundaries.resultIds.map(id => reopened.getObject(id).handle)
      const rings = handles.map(handle => native.listEntities().find(entity => entity.handle === handle))
      const nativeHost = document.createElement('div'); nativeHost.style.cssText = 'width:900px;height:500px'; document.body.append(nativeHost)
      const workbench = new m.KJDrawWorkbench(nativeHost, { sdk: nativeSDK, document: native, toolbar: false, showLayers: false, showInspector: false })
      await workbench.ready
      const afterDXF = (await workbench.execute('CONTOUROFFSET', { ids: rings.map(entity => entity.id), units: 'millimeter', expectedRevision: native.revision, distance: 1 })).result
      workbench.dispose(); nativeHost.remove()
      return { previewReadOnly, offsetArea: offset.area, undoCount, redoCount, booleanArea: boolean.area, sourcesUnchanged,
        boundaryComplete: boundaryPreview.complete, depths: boundaryPreview.contours.map(contour => contour.depth), plannedStatus: planned.status, agentReadOnly,
        savedWithoutBackend, continuedArea: continued.area, afterDXFArea: afterDXF.area, nativeArcs: rings[1].payload.vertices.every(vertex => vertex.bulge !== 0),
        manualNote: native.listEntities({ type: 'TEXT' })[0].payload.text }
    }, assetKind)
    expect(result).toMatchObject({ previewReadOnly: true, undoCount: 8, redoCount: 9, sourcesUnchanged: true, boundaryComplete: true, depths: [0, 1], plannedStatus: 'planned', agentReadOnly: true, savedWithoutBackend: true, nativeArcs: true, manualNote: 'Hand-added note' })
    expect(result.offsetArea).toBeCloseTo(Math.PI * 49, 7)
    expect(result.booleanArea).toBeCloseTo(50 * Math.acos(0.6) - 24, 7)
    expect(result.continuedArea).toBeCloseTo(Math.PI * 64, 7)
    expect(result.afterDXFArea).toBeCloseTo(260, 7)
    expect(errors).toEqual([])
  })
}

test('unconfigured bundled contour commands refuse atomically and preserve redo history', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.addScriptTag({ content: bundle })
  const result = await page.evaluate(async () => {
    const m = window.__kjdrawContourCommands, sdk = m.createKJDrawSDK()
    const drawing = sdk.createDocument({ units: 'millimeter' })
    await drawing.transact('Sources', tx => {
      tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 5 }, { id: 'a' })
      tx.createEntity('CIRCLE', { center: [6, 0, 0], radius: 5 }, { id: 'b' })
    })
    await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { text: 'Redo me', position: [20, 0, 0], height: 2 } })
    await drawing.undo()
    const host = document.createElement('div'); document.body.append(host)
    const editor = m.createKJDrawEditor(host, { sdk, document: drawing, toolbar: false, layers: false, properties: false }); await editor.ready
    const before = drawing.serialize(), history = JSON.stringify(drawing.history), revision = drawing.revision
    const wasmBytes = new Uint8Array(await (await fetch('/packages/kjdraw-sdk/src/assets/kjcontour.wasm')).arrayBuffer())
    const boundary = { ids: ['a'], units: 'millimeter', expectedRevision: revision }
    const preview = await m.previewPlanarBoundaries(drawing, boundary, { wasmBytes })
    const outcomes = []
    for (const [command, args] of [
      ['CONTOUROFFSET', { ids: ['a'], units: 'millimeter', expectedRevision: revision, distance: 1 }],
      ['CONTOURBOOLEAN', { operation: 'intersection', ids: ['a', 'b'], units: 'millimeter', expectedRevision: revision }],
      ['CONTOURBOUNDARIES', { ...boundary, expectedGeometryDigest: preview.receipt.geometryDigest }],
    ]) {
      try { await editor.execute(command, args); outcomes.push({ command, rejected: false }) }
      catch (error) { outcomes.push({ command, rejected: true, code: error.code, message: error.message, unchanged: before === drawing.serialize() && history === JSON.stringify(drawing.history) && revision === drawing.revision }) }
    }
    await editor.redo()
    const redoNote = drawing.listEntities({ type: 'TEXT' })[0].payload.text
    editor.dispose(); host.remove()
    return { outcomes, redoNote }
  })
  expect(result.outcomes).toHaveLength(3)
  for (const outcome of result.outcomes) {
    expect(outcome).toMatchObject({ rejected: true, code: 'KJDOCUMENT_INVALID', unchanged: true })
    expect(outcome.message).toContain('explicit wasmUrl or wasmBytes')
  }
  expect(result.redoNote).toBe('Redo me')
  expect(errors).toEqual([])
})
