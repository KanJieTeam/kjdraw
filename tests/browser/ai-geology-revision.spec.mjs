import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK, compileGeologyColumn } from '../../packages/kjdraw-sdk/src/index.js'

test('AI chat reviews borehole source changes, exports DXF and resumes source facts after refresh', async ({ page }) => {
  // Mock model protocol; the actual browser, importer, engine and approvals run.
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const source = { kind: 'column', input: { expectedRevision: 0, hole: {
    id: 'ZK01', collarElevation: 105, depth: 16,
    strata: [{ intervalId: 'a', code: '1', name: '填土', top: 0, bottom: 3, lithology: 'fill' },
      { intervalId: 'b', code: '2', name: '黏土', top: 3, bottom: 16, lithology: 'clay' }],
  } } }
  const compiled = compileGeologyColumn(source.input)
  await sdk.executeCommand('CREATEBATCH', { ...structuredClone(compiled.commandArgs), geologySource: source }, { document })
  let phase = 0, revision = document.revision, waterDepth = 4
  await page.route('https://ai-test.invalid/v1/chat/completions', route => {
    const body = route.request().postDataJSON()
    const names = body.tools.map(tool => tool.function.name)
    expect(names).toContain('cad_read_geology_source')
    expect(names).toContain('cad_propose_geology_revision')
    const read = phase++ % 2 === 0
    if (!read) {
      const result = JSON.parse(body.messages.findLast(item => item.role === 'tool').content)
      expect(result.ok).toBe(true)
      expect(result.value.facts.hole.id).toBe('ZK01')
      revision = result.value.revision
    }
    const name = read ? 'cad_read_geology_source' : 'cad_propose_geology_revision'
    const args = read ? { expectedRevision: revision, drawingId: compiled.evidence.rootObjectId, maxBytes: 262144 }
      : { expectedRevision: revision, units: 'millimeter', drawingId: compiled.evidence.rootObjectId,
        updates: [{ holeId: 'ZK01', stableWaterDepth: waterDepth }] }
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: `geo-${phase}`, type: 'function', function: { name, arguments: JSON.stringify(args) },
    }] }, finish_reason: 'tool_calls' }] } })
  })
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name: 'source-backed-column.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(document, { format: 'KJD' })) })
  await page.getByTestId('chat-input').fill('把 ZK01 钻孔稳定水位改成 4 米，同步更新图纸。')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-key').fill('browser-test-key')
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('geology-source-changes')).toContainText('ZK01')
  await expect(page.getByTestId('geology-source-changes')).toContainText('4 m')
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
  await expect.poll(() => page.getByTestId('drawing-result').locator('canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 220 || pixels[index + 1] < 220 || pixels[index + 2] < 220) count++
    return count
  })).toBeGreaterThan(30)
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  revision++
  const waiting = page.waitForEvent('download')
  await page.getByTestId('drawing-download').click()
  const download = await waiting
  expect(download.suggestedFilename()).toMatch(/\.dxf$/)
  const reopened = await sdk.readDocument(new Uint8Array(await readFile(await download.path())), { format: 'DXF' })
  expect(reopened.validate().valid).toBe(true)
  expect(reopened.listEntities({ type: 'HATCH' })).not.toHaveLength(0)
  await page.reload()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  waterDepth = 5
  await page.getByTestId('chat-input').fill('把 ZK01 钻孔稳定水位再改成 5 米。')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('geology-source-changes').last()).toContainText('4 m')
  await expect(page.getByTestId('geology-source-changes').last()).toContainText('5 m')
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-download')).toHaveCount(2)
})
