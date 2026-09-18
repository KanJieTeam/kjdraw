import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

test('30 m A4 borehole renders all nine distinct lithology legend cells without overlap', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1300 })
  await page.goto('/')
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
  const expected = ['fill', 'cultivated soil', 'clay', 'silty clay', 'silt', 'sand', 'gravel', 'loess', 'paleosol']
  const result = await page.evaluate(async () => {
    const { compileGeologyColumn, createKJDrawSDK, exportDrawingSvg } = await import('/packages/kjdraw-sdk/src/index.js')
    const kinds = ['fill', 'cultivated-soil', 'clay', 'silty-clay', 'silt', 'sand', 'gravel', 'loess', 'paleosol']
    const compiled = compileGeologyColumn({ hole: { id: 'ZK09', collarElevation: 300, depth: 30,
      strata: kinds.map((lithology, index) => ({ code: String(index + 1), name: `Unit ${index + 1}`,
        top: index * 30 / 9, bottom: (index + 1) * 30 / 9, lithology })) }, expectedRevision: 0 })
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document: drawing })
    const layoutId = drawing.snapshot().spaces.layoutIds.find(id => drawing.getObject(id)?.name === 'Model')
    await sdk.executeCommand('PAGESETUP', { layoutId, dxf: { paperWidth: 210, paperHeight: 297,
      paperUnits: 1, plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 210, windowMaxY: 297,
      flags: 0, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0,
      marginTop: 0, marginBottom: 0 } }, { document: drawing })
    const exported = exportDrawingSvg(drawing, { layoutId, allowPartial: true })
    document.body.innerHTML = '<main id="paper"></main>'
    const style = document.createElement('style')
    style.textContent = 'body{margin:0;background:#ddd}#paper{width:840px;height:1188px;background:#fff;margin:16px auto;box-shadow:0 2px 14px #888}#paper svg{display:block;width:840px;height:1188px}'
    document.head.replaceChildren(style)
    document.querySelector('#paper').innerHTML = exported.svg
    return { report: exported.report, hatchCount: drawing.listEntities({ type: 'HATCH' }).length,
      evidence: compiled.evidence.parameters }
  })
  expect(result.report.status, JSON.stringify(result.report.diagnostics)).not.toBe('partial')
  expect(result.report.diagnostics).toEqual([])
  expect(result.hatchCount).toBe(18)
  expect(result.evidence.lithologyCount).toBe(9)
  const paperSize = await page.locator('#paper svg').evaluate(element => [element.getBoundingClientRect().width, element.getBoundingClientRect().height])
  expect(paperSize[0]).toBeGreaterThan(700)
  expect(paperSize[1]).toBeGreaterThan(1000)
  const boxes = await page.locator('#paper svg text').evaluateAll((texts, expectedLabels) => {
    const svg = document.querySelector('#paper svg'), page = svg.getBoundingClientRect()
    return expectedLabels.map(label => {
      const matches = texts.filter(text => text.textContent === label)
      return { label, matches: matches.length, box: matches[0]?.getBoundingClientRect().toJSON(),
        page: page.toJSON() }
    })
  }, expected)
  for (const { label, matches, box, page: sheet } of boxes) {
    expect(matches, label).toBe(1)
    expect(box.width, label).toBeGreaterThan(2)
    expect(box.height, label).toBeGreaterThan(2)
    expect(box.left, label).toBeGreaterThanOrEqual(sheet.left)
    expect(box.right, label).toBeLessThanOrEqual(sheet.right)
    expect(box.top, label).toBeGreaterThanOrEqual(sheet.top)
    expect(box.bottom, label).toBeLessThanOrEqual(sheet.bottom)
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].box, b = boxes[j].box
    const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    expect(overlap, `${boxes[i].label} overlaps ${boxes[j].label}`).toBe(0)
  }
  await mkdir('.cache/geology-nine-legend', { recursive: true })
  await page.locator('#paper svg').screenshot({ path: '.cache/geology-nine-legend/a4-nine-lithologies.png' })
})
