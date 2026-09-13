import { expect, test } from '@playwright/test'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

const manufacturing = {
  version: '1.0.0', expectedRevision: 0, units: 'millimeter', drawingId: 'RC-MECH-001', title: 'CNC FIXTURE PLATE', revision: 'C', material: '6061-T6 ALUMINUM', quantity: 4,
  length: 300, width: 180, thickness: 12,
  holePatterns: [
    { rows: 8, columns: 12, origin: [12.5, 15], spacing: [25, 21], throughDiameter: 5 },
    { rows: 2, columns: 2, origin: [20, 20], spacing: [260, 140], throughDiameter: 9, counterboreDiameter: 16, counterboreDepth: 6 },
  ],
  slots: [{ center: [150, 90], length: 40, width: 10, orientationDegrees: 0 }, { center: [80, 90], length: 30, width: 8, orientationDegrees: 90 }],
  sheet: { origin: [0, 0], size: [420, 297] }, textHeight: 3.5,
}

const architecture = {
  version: '1.0.0', expectedRevision: 0, units: 'millimeter', drawingId: 'RC-ARCH-001', title: 'TWO ROOM OFFICE PLAN', width: 10000, depth: 8000, wallThickness: 200,
  exteriorOpenings: [{ wall: 'south', offset: 1200, width: 900, kind: 'door' }, { wall: 'north', offset: 3000, width: 1500, kind: 'window' }, { wall: 'east', offset: 3000, width: 1500, kind: 'window' }],
  partitions: [{ id: 'P1', axis: 'vertical', position: 5000, start: 200, end: 7800, openings: [{ offset: 3100, width: 900, kind: 'door' }] }],
  rooms: [{ id: 'R101', name: 'MEETING', bounds: [200, 200, 4700, 7600] }, { id: 'R102', name: 'STUDIO', bounds: [5100, 200, 4700, 7600] }], textHeight: 250,
}

const site = {
  version: '1.0.0', expectedRevision: 0, units: 'meter', drawingId: 'RC-SITE-001', title: 'MIXED USE CAMPUS GENERAL SITE PLAN', revision: 'C3',
  boundary: [[1000, 2000], [1260, 2000], [1270, 2120], [1220, 2220], [1000, 2200]],
  roads: [{ name: 'MAIN ACCESS ROAD', width: 8, centerline: [[990, 2020], [1080, 2020], [1160, 2060], [1280, 2060]] }, { name: 'SERVICE ROAD', width: 6, centerline: [[1110, 1990], [1110, 2140], [1220, 2180]] }],
  buildings: [{ name: 'ADMINISTRATION', floors: 4, footprint: [[1025, 2040], [1080, 2040], [1080, 2080], [1025, 2080]] }, { name: 'WORKSHOP', floors: 2, footprint: [[1140, 2080], [1230, 2080], [1230, 2140], [1140, 2140]] }, { name: 'WAREHOUSE', footprint: [[1035, 2120], [1125, 2120], [1125, 2180], [1035, 2180]] }],
  utilities: [{ kind: 'water', name: 'DOMESTIC WATER', diameterMm: 200, path: [[1005, 2028], [1090, 2028], [1170, 2070], [1240, 2070]], nodeIndices: [0, 1, 2, 3] }, { kind: 'drainage', name: 'STORM DRAIN', diameterMm: 600, path: [[1010, 2190], [1080, 2160], [1160, 2160], [1250, 2120]], nodeIndices: [0, 1, 2, 3] }, { kind: 'power', name: '11kV POWER', path: [[1005, 2010], [1100, 2010], [1180, 2050]], nodeIndices: [0, 2] }],
  coordinateReference: { position: [1010, 2010], easting: 385000.125, northing: 3452000.75, crs: 'EPSG:32650' }, northAngleDegrees: -8, scale: 500,
}

const scenarios = [
  { kind: 'mechanical', input: manufacturing, paper: [420, 297], scale: 0.5 },
  { kind: 'architecture', input: architecture, paper: [420, 297], scale: 0.01 },
  { kind: 'site', input: site, paper: [841, 594], scale: 2 },
]

test('exact candidate proves three blank-to-output industry workflows through the public Workbench', async ({ page }) => {
  test.setTimeout(120_000)
  await page.route('**/candidate-workbench-host.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto('/candidate-workbench-host.html')
  const results = []
  for (const scenario of scenarios) {
    const result = await page.evaluate(async ({ kind, input, paper, scale }) => {
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.style.cssText = 'width:1400px;height:900px'
      document.body.append(host)
      const api = await import('/packages/kjdraw-sdk/src/index.js')
      const { mountKJDrawWorkbench } = await import('/packages/kjdraw-sdk/src/workbench.js')
      const sdk = api.createKJDrawSDK()
      const drawing = sdk.createDocument({ documentId: `candidate-${kind}`, units: input.units })
      const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', theme: 'light', grid: false })
      await workbench.ready
      if (drawing.listEntities().length !== 0) throw new Error(`${kind} did not start blank`)

      const compiled = kind === 'mechanical'
        ? api.buildAgentManufacturingSheet(drawing, input)
        : kind === 'architecture'
          ? api.buildAgentArchitecturePlan(drawing, input)
          : api.buildAgentSitePlan(drawing, input)
      await workbench.execute('CREATEBATCH', compiled.commandArgs)
      const createdCount = drawing.listEntities().length
      if (createdCount < 20 || createdCount !== compiled.evidence.entityCount) throw new Error(`${kind} semantic compiler entity mismatch`)

      let targetIds, before, delta
      if (kind === 'mechanical') {
        const target = drawing.listEntities({ type: 'TEXT' }).find(entity => entity.payload.text === 'MACHINING NOTES:')
        if (!target) throw new Error('mechanical editable note missing')
        targetIds = [target.id]; before = [...target.payload.position]; delta = [2, 1]
      } else if (kind === 'architecture') {
        const target = drawing.listEntities({ type: 'TEXT' }).find(entity => entity.payload.text === 'MEETING')
        if (!target) throw new Error('architecture editable room label missing')
        targetIds = [target.id]; before = [...target.payload.position]; delta = [200, 100]
      } else {
        const layers = Object.fromEntries(compiled.commandArgs.resources.layers.map(layer => [layer.name, layer.id]))
        const footprint = drawing.listEntities({ type: 'LWPOLYLINE' }).find(entity => entity.payload.layerId === layers.BUILDING)
        const label = drawing.listEntities({ type: 'TEXT' }).find(entity => String(entity.payload.text).startsWith('ADMINISTRATION'))
        if (!footprint || !label) throw new Error('site editable building pair missing')
        targetIds = [footprint.id, label.id]; before = [...footprint.payload.vertices[0].point]; delta = [5, -2]
      }
      await workbench.execute('MOVE', { ids: targetIds, dx: delta[0], dy: delta[1] })
      const targetPoint = () => {
        const target = drawing.getObject(targetIds[0])
        return target.type === 'LWPOLYLINE' ? target.payload.vertices[0].point : target.payload.position
      }
      const moved = targetPoint().slice(0, 2)
      const expected = [before[0] + delta[0], before[1] + delta[1]]
      if (moved.some((value, index) => Math.abs(value - expected[index]) > 1e-9)) throw new Error(`${kind} edit failed`)
      await workbench.execute('UNDO')
      if (targetPoint().slice(0, 2).some((value, index) => Math.abs(value - before[index]) > 1e-9)) throw new Error(`${kind} undo failed`)
      await workbench.execute('REDO')
      if (targetPoint().slice(0, 2).some((value, index) => Math.abs(value - expected[index]) > 1e-9)) throw new Error(`${kind} redo failed`)

      let layoutId
      if (kind === 'mechanical') {
        layoutId = drawing.snapshot().spaces.layoutIds
          .map(id => drawing.getObject(id))
          .find(layout => layout.payload.blockRecordId === drawing.snapshot().spaces.modelSpaceId).id
        await workbench.execute('PAGESETUP', { layoutId, dxf: {
          paperWidth: paper[0], paperHeight: paper[1], paperUnits: 1,
          marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10,
          originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 2,
          plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 420, windowMaxY: 297,
          rotation: 0, flags: 0,
        } })
      } else {
        layoutId = drawing.snapshot().spaces.layoutIds.map(id => drawing.getObject(id)).find(layout => layout.name === compiled.commandArgs.layout.name)?.id
      }
      if (!layoutId) throw new Error(`${kind} output layout missing`)
      if (!drawing.validate().valid) throw new Error(`${kind} document validation failed`)

      const beforeKjd = drawing.fingerprint()
      const kjd = await workbench.save('KJD', { download: false })
      await workbench.open(kjd, { format: 'KJD', fileName: `${kind}.kjd` })
      if (workbench.document.fingerprint() !== beforeKjd) throw new Error(`${kind} KJD fingerprint mismatch`)
      const reopenedDrawing = workbench.document
      const project = api.KJProjectSession.create({ sdk, id: `candidate-${kind}`, documents: [reopenedDrawing], activeDocumentId: reopenedDrawing.id })
      const kjp = await project.package()
      const reopenedProject = await api.KJProjectSession.open(kjp, { sdk: api.createKJDrawSDK() })
      if (reopenedProject.activeDocument.fingerprint() !== reopenedDrawing.fingerprint()) throw new Error(`${kind} KJP fingerprint mismatch`)
      if (!reopenedProject.activeDocument.validate().valid) throw new Error(`${kind} reopened project validation failed`)

      workbench.setDrawingLayout(kind === 'mechanical' ? null : layoutId)
      let svg
      try { svg = await workbench.save('SVG', { download: false, layoutId }) }
      catch (error) { throw new Error(`${kind} SVG failed: ${error.message}; cause=${error.cause?.message ?? 'none'}; layout=${layoutId}`) }
      const png = await workbench.exportPng({ download: false, layoutId, maxEdge: 900, theme: 'light' })
      const printed = api.createDrawingPrintHtml(reopenedDrawing, { layoutId, title: `${kind} candidate`, locale: 'en' })
      const svgWidth = Number(svg.match(/<svg[^>]*\bwidth="([0-9.]+)mm"/)?.[1])
      const svgHeight = Number(svg.match(/<svg[^>]*\bheight="([0-9.]+)mm"/)?.[1])
      const outputScale = kind === 'mechanical'
        ? printed.paper.millimetersPerDrawingUnit
        : printed.report.viewports[0]?.millimetersPerModelUnit
      const layers = reopenedDrawing.getTable('layers').records.map(layer => layer.name)
      const independent = kind === 'mechanical'
        ? { circles: reopenedDrawing.listEntities({ type: 'CIRCLE' }).length, dimensions: reopenedDrawing.listEntities({ type: 'DIMENSION' }).length, layers }
        : kind === 'architecture'
          ? { inserts: reopenedDrawing.listEntities({ type: 'INSERT' }).length, dimensions: reopenedDrawing.listEntities({ type: 'DIMENSION' }).length, layers }
          : { closedPolylines: reopenedDrawing.listEntities({ type: 'LWPOLYLINE' }).filter(entity => entity.payload.closed).length, dimensions: reopenedDrawing.listEntities({ type: 'DIMENSION' }).length, layers }
      reopenedProject.destroy()
      workbench.dispose()
      project.destroy()
      return {
        kind, startedBlank: true, entityCount: createdCount, editedIds: targetIds.length,
        kjdReopened: true, kjpReopened: true, valid: true,
        paperMm: [svgWidth, svgHeight], millimetersPerModelUnit: outputScale,
        svgBytes: new TextEncoder().encode(svg).length, pngBytes: Math.floor((png.dataUrl.length - 'data:image/png;base64,'.length) * 3 / 4), printBytes: new TextEncoder().encode(printed.html).length,
        svgDiagnostics: printed.report.diagnostics.length,
        pngComplete: png.renderReport.unsupported === 0 && png.renderReport.detailCulled === 0 && !(png.renderReport.hatchDiagnostics?.length) && !(png.renderReport.viewportDiagnostics?.some(item => item.unsupported > 0 || item.reason === 'budget')),
        independent,
        expected: { paperMm: paper, millimetersPerModelUnit: scale },
      }
    }, scenario)
    results.push(result)
  }

  for (const result of results) {
    expect(result.startedBlank).toBe(true)
    expect(result.kjdReopened).toBe(true)
    expect(result.kjpReopened).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.paperMm).toEqual(result.expected.paperMm)
    expect(result.millimetersPerModelUnit).toBeCloseTo(result.expected.millimetersPerModelUnit, 10)
    expect(result.svgBytes).toBeGreaterThan(1_000)
    expect(result.pngBytes).toBeGreaterThan(1_000)
    expect(result.printBytes).toBeGreaterThan(result.svgBytes)
    expect(result.svgDiagnostics).toBe(0)
    expect(result.pngComplete).toBe(true)
    expect(result.independent.dimensions).toBeGreaterThanOrEqual(2)
    expect(result.independent.layers.length).toBeGreaterThanOrEqual(4)
  }
  expect(results.find(result => result.kind === 'mechanical').independent.circles).toBeGreaterThanOrEqual(100)
  expect(results.find(result => result.kind === 'architecture').independent.inserts).toBeGreaterThanOrEqual(4)
  expect(results.find(result => result.kind === 'site').independent.closedPolylines).toBeGreaterThanOrEqual(5)

  if (process.env.KJDRAW_THREE_INDUSTRY_RESULT) {
    await mkdir(dirname(process.env.KJDRAW_THREE_INDUSTRY_RESULT), { recursive: true })
    await writeFile(process.env.KJDRAW_THREE_INDUSTRY_RESULT, JSON.stringify({ scenarios: results }, null, 2))
  }
})
