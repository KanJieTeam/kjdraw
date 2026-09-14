import { expect, test } from '@playwright/test'

if (process.env.KJDRAW_TEST_BASE_URL) test.use({ baseURL: process.env.KJDRAW_TEST_BASE_URL })

test('workbench exposes registered readable formats and keeps file replacement atomic', async ({ page }) => {
  const workbenchModule = process.env.KJDRAW_WORKBENCH_MODULE ?? '/packages/kjdraw-sdk/src/workbench.js'
  await page.goto('/')
  await page.evaluate(async workbenchModule => {
    document.body.replaceChildren()
    const host = document.createElement('div')
    host.style.cssText = 'width:1100px;height:720px'
    document.body.append(host)

    const [{ createKJDrawSDK }, { KJDocument }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'),
      import('/packages/kjdraw-sdk/src/document.js'),
      import(workbenchModule),
    ])
    const sdk = createKJDrawSDK()
    const drawing = sdk.createDocument({ documentId: 'original-drawing', units: 'millimeter' })
    await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [20, 0, 0] } }, { document: drawing })
    const calls = [], errors = []
    const workbench = mountKJDrawWorkbench(host, {
      sdk,
      document: drawing,
      grid: false,
      showLayers: false,
      showInspector: false,
      onError: error => errors.push(error instanceof Error ? error.message : String(error)),
    })
    await workbench.ready

    let sequence = 0
    window.__registerDwgReader = () => sdk.fileAdapters.register({
      id: 'test.dwg.reader',
      priority: 900,
      formats: { DWG: { read: ['*'], notes: ['Test-only host conversion adapter'] } },
      capabilities: { conversion: true },
      read: async (source, options) => {
        const name = String(source?.name ?? '')
        calls.push({ name, format: options.format, adapterId: options.adapter?.id })
        options.onProgress?.({ phase: 'source', completed: 1, total: 3, unit: 'bytes' })
        if (name.includes('broken')) throw new Error('DWG conversion failed')
        if (name.includes('slow')) {
          options.onProgress?.({ phase: 'parse', completed: 2, total: 4, unit: 'tags' })
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 5_000)
            const abort = () => { clearTimeout(timer); reject(new Error('host conversion aborted')) }
            if (options.signal?.aborted) abort()
            else options.signal?.addEventListener('abort', abort, { once: true })
          })
        }
        options.onProgress?.({ phase: 'import', completed: 1, total: 1, unit: 'entities' })
        sequence += 1
        return KJDocument.create({ documentId: `converted-dwg-${sequence}`, units: 'millimeter' })
      },
    })
    window.__fileCapabilityTest = { workbench, sdk, drawing, calls, errors }
  }, workbenchModule)

  const root = page.locator('.kjwb'), input = root.locator('[data-file]')
  await expect(input).toHaveAttribute('accept', '.dxf,.kjd')
  expect(await page.evaluate(async () => {
    const { workbench, sdk } = window.__fileCapabilityTest
    const kjd = await sdk.writeDocument(workbench.document, { format: 'KJD' })
    const reopenedKjd = await workbench.open(kjd, { fileName: 'built-in.kjd' })
    const dxf = await sdk.writeDocument(reopenedKjd, { format: 'DXF', version: '2018' })
    const reopenedDxf = await workbench.open(dxf, { fileName: 'built-in.dxf' })
    window.__fileCapabilityTest.preDwgDocument = reopenedDxf
    return { kjdEntities: reopenedKjd.listEntities().length, dxfEntities: reopenedDxf.listEntities().length }
  })).toEqual({ kjdEntities: 1, dxfEntities: 1 })
  expect(await page.evaluate(async () => {
    const { workbench, preDwgDocument } = window.__fileCapabilityTest
    let message = ''
    try { await workbench.open(new Blob(['not a drawing']), { fileName: 'unsupported.dwg' }) } catch (error) { message = error.message }
    return { message, sameDocument: workbench.document === preDwgDocument }
  })).toMatchObject({ message: expect.stringContaining('No reader'), sameDocument: true })

  await page.evaluate(() => window.__registerDwgReader())
  const chooserPromise = page.waitForEvent('filechooser')
  await root.locator('[data-action="open"]').click()
  const chooser = await chooserPromise
  await expect(input).toHaveAttribute('accept', '.dxf,.kjd,.dwg')
  await chooser.setFiles({ name: 'plant-layout.dwg', mimeType: 'application/acad', buffer: Buffer.from('converted source') })
  await expect.poll(() => page.evaluate(() => window.__fileCapabilityTest.workbench.document?.id)).toBe('converted-dwg-1')
  expect(await page.evaluate(() => window.__fileCapabilityTest.calls[0])).toEqual({ name: 'plant-layout.dwg', format: 'DWG', adapterId: 'test.dwg.reader' })
  await page.evaluate(() => { window.__fileCapabilityTest.successfulDocument = window.__fileCapabilityTest.workbench.document })

  await input.setInputFiles({ name: 'broken.dwg', mimeType: 'application/acad', buffer: Buffer.from('broken source') })
  await expect(root.locator('[data-message]')).toContainText('Adapter test.dwg.reader failed to read DWG')
  expect(await page.evaluate(() => window.__fileCapabilityTest.workbench.document === window.__fileCapabilityTest.successfulDocument)).toBe(true)

  await input.setInputFiles({ name: 'slow.dwg', mimeType: 'application/acad', buffer: Buffer.from('slow source') })
  await expect(root.locator('[data-message]')).toContainText('Parsing drawing')
  await root.press('Escape')
  await expect(root.locator('[data-message]')).toContainText('Open cancelled')
  expect(await page.evaluate(() => ({
    sameDocument: window.__fileCapabilityTest.workbench.document === window.__fileCapabilityTest.successfulDocument,
    errors: window.__fileCapabilityTest.errors,
    formats: window.__fileCapabilityTest.calls.map(call => call.format),
  }))).toEqual({ sameDocument: true, errors: [expect.stringContaining('Adapter test.dwg.reader failed to read DWG')], formats: ['DWG', 'DWG', 'DWG'] })
})
