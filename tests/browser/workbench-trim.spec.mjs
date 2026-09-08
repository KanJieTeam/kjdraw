import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true, viewport: { width: 1280, height: 900 } })

async function mountTrimFixture(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    document.body.style.margin = '0'
    const host = document.createElement('div')
    host.id = 'trim-editor'
    host.style.cssText = 'width:1200px;height:800px'
    document.body.append(host)
    const [{ createKJDrawSDK }, { createKJDrawEditor }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/editor.js'),
    ])
    const sdk = createKJDrawSDK()
    const drawing = sdk.createDocument({ documentId: 'embedded-trim-interval', units: 'millimeter' })
    const layer = await sdk.executeCommand('LAYERNEW', { name: 'Trim parts', color: 3 }, { document: drawing })
    const target = await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
      layerId: layer.id, start: [0, 0, 6], end: [100, 0, 6], color: 2, lineweight: 35, linetypeScale: 1.5,
    } }, { document: drawing })
    const boundaries = []
    for (const x of [30, 70]) {
      boundaries.push(await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
        start: [x, -20, 6], end: [x, 20, 6],
      } }, { document: drawing }))
    }
    const errors = []
    const editor = createKJDrawEditor(host, {
      sdk, document: drawing, grid: false, layers: false, properties: false,
      onError: error => errors.push(String(error)),
    })
    await editor.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    editor.fit()
    window.__trimEditor = { editor, drawing, target, boundaries, layer, errors }
  })
}

async function clickWorld(page, world) {
  const point = await page.evaluate(world => {
    const { editor } = window.__trimEditor
    const rect = editor.element.querySelector('[data-canvas]').getBoundingClientRect()
    const point = editor.workbench.renderer.worldToScreen(world)
    return { x: rect.left + point[0], y: rect.top + point[1] }
  }, world)
  await page.mouse.click(point.x, point.y)
}

async function state(page) {
  return page.evaluate(() => {
    const { editor, target, boundaries, layer, errors } = window.__trimEditor
    const drawing = editor.document
    return {
      revision: drawing.revision,
      objects: drawing.snapshot().objects,
      count: drawing.listEntities().length,
      pieces: drawing.listEntities().filter(entity => entity.payload.layerId === layer.id)
        .sort((a, b) => a.payload.start[0] - b.payload.start[0]),
      boundaries: boundaries.map(entity => drawing.getObject(entity.id)),
      targetId: target.id, targetHandle: target.handle, layerId: layer.id,
      selectedIds: [...editor.getSelection()], errors: [...errors],
    }
  })
}

test('embedded editor toolbar trims only the middle interval, retaining styled elevated sides through undo and public save/reopen', async ({ page }) => {
  await mountTrimFixture(page)
  const before = await state(page)
  expect(before.count).toBe(3)

  // Select the target body first, then add the two boundary bodies with real Shift-clicks.
  await clickWorld(page, [10, 0])
  await expect.poll(async () => (await state(page)).selectedIds).toEqual([before.targetId])
  await page.keyboard.down('Shift')
  await clickWorld(page, [30, 10])
  await clickWorld(page, [70, 10])
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await state(page)).selectedIds)
    .toEqual([before.targetId, ...before.boundaries.map(entity => entity.id)])

  await page.locator('#trim-editor [data-action="modify"]').click()
  await expect(page.locator('#trim-editor [data-modification-dialog]')).toBeVisible()
  await page.locator('#trim-editor [data-modification]').selectOption('trim')
  await page.locator('#trim-editor [data-action="start-modification"]').click()
  await expect(page.locator('#trim-editor [data-modification-dialog]')).not.toBeVisible()
  expect((await state(page)).objects).toEqual(before.objects)
  await clickWorld(page, [50, 0])

  await expect.poll(async () => (await state(page)).count).toBe(4)
  const trimmed = await state(page)
  expect(trimmed.revision).toBe(before.revision + 1)
  expect(trimmed.pieces).toHaveLength(2)
  expect(trimmed.pieces[0].id).toBe(before.targetId)
  expect(trimmed.pieces[0].handle).toBe(before.targetHandle)
  expect(trimmed.pieces[1].id).not.toBe(before.targetId)
  expect(trimmed.pieces.map(entity => [entity.payload.start, entity.payload.end]))
    .toEqual([[[0, 0, 6], [30, 0, 6]], [[70, 0, 6], [100, 0, 6]]])
  for (const entity of trimmed.pieces) {
    expect(entity.type).toBe('LINE')
    expect(entity.payload).toMatchObject({ layerId: before.layerId, color: 2, lineweight: 35, linetypeScale: 1.5 })
  }
  expect(trimmed.boundaries).toEqual(before.boundaries)
  expect(trimmed.errors).toEqual([])

  await page.locator('#trim-editor [data-action="undo"]').click()
  await expect.poll(async () => (await state(page)).objects).toEqual(before.objects)
  await page.locator('#trim-editor [data-action="redo"]').click()
  await expect.poll(async () => (await state(page)).objects).toEqual(trimmed.objects)

  // Exercise the same public storage API an embedding application uses, without
  // injecting replacement geometry or selecting entities through internal helpers.
  const replacedDocument = await page.evaluate(async () => {
    const { editor } = window.__trimEditor
    const previous = editor.document
    const content = await editor.save({ format: 'KJD', download: false })
    await editor.open(content, { format: 'KJD', fileName: 'trimmed-interval.kjd' })
    return editor.document !== previous
  })
  expect(replacedDocument).toBe(true)
  const reopened = await state(page)
  expect(reopened.objects).toEqual(trimmed.objects)
  expect(reopened.pieces).toEqual(trimmed.pieces)
  expect(reopened.boundaries).toEqual(before.boundaries)
  expect(reopened.errors).toEqual([])
})
