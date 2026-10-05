import { test, expect } from '@playwright/test'

test.use({ bypassCSP: true, viewport: { width: 1360, height: 860 } })

test('actual Canvas and SVG render scoped local MTEXT fonts, preserving raw DXF through UI approval and reviewed undo/redo', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'font-workbench'; host.style.cssText = 'width:1280px;height:800px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }, { createAgentChat }, { KJAgentToolSession }, { exportDrawingSvg }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'), import('/apps/playground/agent-chat.js'),
      import('/packages/kjdraw-sdk/src/agent-tools.js'), import('/packages/kjdraw-sdk/src/svg-export.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    const style = await sdk.executeCommand('TEXTSTYLE', { operation: 'create', name: 'LOCAL-BASE', properties: { fontFamily: 'Times New Roman' }, current: true }, { document: drawing })
    const layout = drawing.snapshot().spaces.layoutIds.map(id => drawing.getObject(id)).find(record => record.name === 'Model')
    await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 160, paperHeight: 100, paperUnits: 1,
      plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 160, windowMaxY: 100, flags: 0,
      scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 } }, { document: drawing })
    const raw = 'BASE {\\fArial;待核对 {\\fCourier New;WW} Pending review} END\\P第二段：合成资料'
    await drawing.transact('Existing scoped text', tx => {
      tx.createEntity('MTEXT', { position: [20, 40, 0], text: raw, height: 3, attachmentPoint: 1, styleId: style.id }, { id: 'notes' })
      tx.createEntity('LINE', { start: [0, 0, 0], end: [100, 0, 0] }, { id: 'untouched' })
    })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, showInspector: false, grid: false }); await workbench.ready
    const container = document.createElement('section'); container.id = 'font-chat'; container.style.cssText = 'position:fixed;inset:0 auto 0 0;width:440px;z-index:10000;background:white;display:flex;flex-direction:column'; document.body.append(container)
    const h = window.__mtextFonts = { sdk, drawing, workbench, raw, layoutId: layout.id, baseline: drawing.fingerprint(), untouched: JSON.stringify(drawing.getObject('untouched')), originalNote: drawing.getObject('notes'), exportDrawingSvg, historySession: new KJAgentToolSession(sdk, drawing) }
    h.paint = () => {
      const context = workbench.renderer.context, original = context.fillText, runs = []
      context.fillText = function (text, x, y, ...rest) { runs.push({ text, font: this.font, x, y }); return original.call(this, text, x, y, ...rest) }
      try { workbench.renderer.fit(); return { runs, report: workbench.renderer.render() } }
      finally { context.fillText = original }
    }
    const chat = createAgentChat(container, { locale: () => 'zh', getContext: () => ({ sdk, document: drawing }), getSelected: () => [],
      onBeforeRun() {}, onPreview() {}, runMutation: operation => operation(), onApplied() { workbench.renderer.render(); chat.syncContext() } })
    chat.setModel({ createConversation: () => ({ next: async input => {
      if (input.kind === 'prompt') return { text: '', calls: [{ id: 'read', name: 'cad_query_drawing', arguments: { expectedRevision: drawing.revision, filters: { ids: ['notes'] }, offset: 0, layerOffset: 0, limit: 10, maxLayers: 10, maxBytes: 16384 } }] }
      const read = input.results.find(result => result.name === 'cad_query_drawing' && result.result.ok)
      if (!read) throw new Error('Actual native MTEXT read failed')
      const entity = read.result.value.entities[0]
      return { text: '仅修改待核对文字，保持字体和段落。', calls: [{ id: 'edit', name: 'cad_propose_text_edit', arguments: { expectedRevision: read.result.value.revision, units: 'millimeter', changes: [{ id: entity.id, expectedText: entity.geometry.text, text: entity.geometry.text.replace('待核对', '已核对') }] } }] }
    } }) })
  })

  const painted = await page.evaluate(() => window.__mtextFonts.paint())
  expect(painted.report.unsupported).toBe(0)
  expect(painted.runs.find(run => run.text === 'WW').font).toMatch(/px (?:"Courier New"|Courier New),/)
  expect(painted.runs.find(run => run.text === '待核对 ').font).toMatch(/px (?:"Arial"|Arial),/)
  expect(painted.runs.find(run => run.text === ' END').font).toMatch(/px (?:"Times New Roman"|Times New Roman),/)
  expect(painted.runs.map(run => run.text)).toEqual(expect.arrayContaining(['BASE ', '待核对 ', 'WW', ' Pending review', ' END', '第二段：合成资料']))
  for (const run of painted.runs) expect(Number.isFinite(run.x) && Number.isFinite(run.y)).toBe(true)
  expect(painted.runs.find(run => run.text === 'WW').x).toBeGreaterThan(painted.runs.find(run => run.text === '待核对 ').x)

  const chat = page.locator('#font-chat')
  await chat.locator('#chat-input').fill('将待核对改成已核对，保留字体、段落、位置和所有其他对象。')
  await chat.locator('#chat-send').click()
  await expect(chat.locator('.chat-text-change')).toHaveCount(1)
  expect(await page.evaluate(() => window.__mtextFonts.drawing.getObject('notes').payload.text)).toContain('待核对')
  await chat.getByRole('button', { name: '应用修改', exact: true }).click()
  await expect(chat.locator('.chat-proposal-state')).toContainText('修改已应用')
  const result = await page.evaluate(async () => {
    const h = window.__mtextFonts, committed = h.drawing.fingerprint(), expected = h.raw.replace('待核对', '已核对')
    const painted = h.paint(), svg = h.exportDrawingSvg(h.drawing, { layoutId: h.layoutId })
    const parsed = new DOMParser().parseFromString(svg.svg, 'image/svg+xml')
    const spans = Array.from(parsed.querySelectorAll('tspan')).map(span => ({ text: span.textContent, family: span.getAttribute('font-family'), x: Number(span.getAttribute('x')), y: Number(span.getAttribute('y')) }))
    const dxf = await h.sdk.writeDocument(h.drawing, { format: 'DXF' })
    const reopened = await h.sdk.readDocument(dxf, { format: 'DXF' }), native = reopened.listEntities({ type: 'MTEXT' })[0]
    const history = []
    for (const kind of ['undo', 'redo']) {
      const read = await h.historySession.call('cad_read_history', { expectedRevision: h.drawing.revision })
      if (!read.ok) throw new Error('Actual history read failed')
      const pending = h.drawing.serialize()
      const proposal = await h.historySession.call(`cad_propose_${kind}`, { expectedRevision: read.value.revision, units: read.value.units, targetHistoryId: read.value.history[`${kind}Target`].id })
      if (!proposal.ok || h.drawing.serialize() !== pending) throw new Error('Actual reviewed history proposal failed or mutated before approval')
      const approved = await h.historySession.approve(proposal.value.planId, 'browser-font-reviewer')
      if (!approved.ok) throw new Error('Actual reviewed history approval failed')
      history.push({ kind, fingerprint: h.drawing.fingerprint(), text: h.drawing.getObject('notes').payload.text, unsupported: h.paint().report.unsupported })
    }
    return { expected, text: h.drawing.getObject('notes').payload.text, originalRaw: h.raw, baseline: h.baseline, committed, history,
      untouched: JSON.stringify(h.drawing.getObject('untouched')) === h.untouched,
      nativeText: native.payload.text, nativeHandle: native.handle, expectedHandle: h.originalNote.handle,
      spans, svgStatus: svg.report.status, svgDiagnostics: svg.report.diagnostics, parserErrors: parsed.querySelectorAll('parsererror').length,
      external: parsed.querySelectorAll('script,image,foreignObject,[href],[src]').length, painted }
  })
  expect(result.text).toBe(result.expected)
  expect(result.untouched).toBe(true)
  expect(result.nativeText).toBe(result.expected)
  expect(result.nativeHandle).toBe(result.expectedHandle)
  expect(result.history).toEqual([
    { kind: 'undo', fingerprint: result.baseline, text: result.originalRaw, unsupported: 0 },
    { kind: 'redo', fingerprint: result.committed, text: result.expected, unsupported: 0 },
  ])
  expect(result.svgStatus).toBe('approximate')
  expect(result.svgDiagnostics).toEqual([])
  expect(result.parserErrors + result.external).toBe(0)
  expect(result.spans.find(span => span.text === 'WW').family).toMatch(/^"Courier New",/)
  expect(result.spans.find(span => span.text === '已核对 ').family).toMatch(/^"Arial",/)
  expect(result.painted.report.unsupported).toBe(0)
  for (const span of result.spans) expect(Number.isFinite(span.x) && Number.isFinite(span.y)).toBe(true)
  await page.screenshot({ path: '.cache/mtext-local-font-scope-approved.png', fullPage: true })
})
