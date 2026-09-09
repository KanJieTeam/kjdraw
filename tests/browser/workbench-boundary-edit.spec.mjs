import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true, viewport: { width: 1280, height: 900 } })

const root = '#boundary-edit-host'
const controls = `${root} [data-boundary-actions]`

async function mount(page, operation = 'trim', locked = false) {
  await page.goto('/')
  await page.evaluate(async ({ operation, locked }) => {
    document.body.replaceChildren()
    document.body.style.margin = '0'
    const host = document.createElement('div')
    host.id = 'boundary-edit-host'
    host.style.cssText = 'width:1200px;height:800px'
    document.body.append(host)
    const [{ createKJDrawSDK }, { createKJDrawEditor }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/editor.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: `continuous-${operation}`, units: 'millimeter' })
    const layer = await sdk.executeCommand('LAYERNEW', { name: 'Machined profiles', color: 2 })
    const boundaryLayer = await sdk.executeCommand('LAYERNEW', { name: 'Cutting edges', color: 3 })
    const boundaries = []
    for (const x of operation === 'trim' ? [30, 70] : [40]) {
      boundaries.push(await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
        start: [x, -20, 6], end: [x, 40, 6], layerId: boundaryLayer.id, color: 3,
      } }))
    }
    const targets = []
    for (const y of [0, 20]) {
      targets.push(await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
        start: [0, y, 6], end: [operation === 'trim' ? 100 : 20, y, 6],
        layerId: layer.id, color: 2, lineweight: 35, linetypeScale: 1.5,
      } }))
    }
    const unrelated = await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
      start: [-25, 10, 6], end: [-5, 10, 6], color: 5,
    } })
    if (locked) await sdk.executeCommand('LAYERUPDATE', { id: boundaryLayer.id, patch: { locked: true } })
    sdk.activeSelection.clear()
    const errors = []
    const editor = createKJDrawEditor(host, { sdk, document: drawing, grid: false, layers: false, properties: false,
      onError: error => errors.push(String(error)),
    })
    await editor.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    editor.fit()
    window.__boundaryEdit = { editor, sdk, targets, boundaries, layer, boundaryLayer, unrelated, errors }
  }, { operation, locked })
}

async function screen(page, world) {
  return page.evaluate(world => {
    const { editor } = window.__boundaryEdit
    const rect = editor.element.querySelector('[data-canvas]').getBoundingClientRect()
    const point = editor.workbench.renderer.worldToScreen(world)
    return { x: rect.left + point[0], y: rect.top + point[1] }
  }, world)
}

async function clickWorld(page, world) {
  const point = await screen(page, world)
  await page.mouse.click(point.x, point.y)
}

async function state(page) {
  return page.evaluate(() => {
    const { editor, layer, boundaries, targets, unrelated, errors } = window.__boundaryEdit
    return {
      revision: editor.document.revision, objects: editor.document.snapshot().objects,
      pieces: editor.document.listEntities().filter(entity => entity.payload.layerId === layer.id)
        .sort((a, b) => a.payload.start[1] - b.payload.start[1] || a.payload.start[0] - b.payload.start[0]),
      boundaries: boundaries.map(entity => editor.document.getObject(entity.id)),
      targets, unrelated: editor.document.getObject(unrelated.id), selected: [...editor.getSelection()], errors: [...errors],
    }
  })
}

async function beginToolbar(page, operation = 'trim') {
  await page.locator(`${root} [data-action="modify"]`).click()
  await page.locator(`${root} [data-modification]`).selectOption(operation)
  await expect(page.locator(`${root} [data-boundary-workflow]`)).toHaveValue('boundaries')
  await page.locator(`${root} [data-action="start-modification"]`).click()
  await expect(page.locator(controls)).toBeVisible()
  await expect(page.locator(controls)).toHaveAttribute('data-boundary-stage', 'boundaries')
}

async function command(page, text) {
  const input = page.locator(`${root} [data-command]`)
  await input.fill(text)
  await input.press('Enter')
}

async function selectBoundaries(page, operation = 'trim') {
  for (const x of operation === 'trim' ? [30, 70] : [40]) await clickWorld(page, [x, 35])
}

async function confirm(page, keyboard = false) {
  if (keyboard) await page.keyboard.press('Enter')
  else await page.locator(`${root} [data-action="boundary-confirm"]`).click()
  await expect(page.locator(controls)).toHaveAttribute('data-boundary-stage', 'targets')
  await expect(page.locator(`${root} [data-overlay]`)).toHaveAttribute('data-grip-count', '0')
}

test('embedded boundary-first TRIM edits two profiles in separate undo steps and preserves locked boundaries, XYZ, styles and saved files', async ({ page }, testInfo) => {
  await mount(page, 'trim', true)
  const before = await state(page)
  await beginToolbar(page)
  await selectBoundaries(page)
  await expect.poll(async () => (await state(page)).selected).toEqual(before.boundaries.map(entity => entity.id))
  await page.keyboard.down('Control')
  await clickWorld(page, [70, 35])
  await page.keyboard.up('Control')
  await expect.poll(async () => (await state(page)).selected).toEqual([before.boundaries[0].id])
  await clickWorld(page, [70, 35])
  await confirm(page)
  await expect(page.locator(`${root} [data-boundary-summary]`)).toHaveText('TRIM · 2 boundaries · 0 edits')
  expect((await state(page)).objects).toEqual(before.objects)
  const plainCanvas = await page.locator(`${root} [data-canvas]`).screenshot()
  const hover = await screen(page, [50, 0])
  await page.mouse.move(hover.x, hover.y)
  await expect(page.locator(`${root} [data-overlay]`)).toHaveAttribute('data-boundary-preview-count', '2')
  expect((await page.locator(`${root} [data-canvas]`).screenshot()).equals(plainCanvas)).toBe(false)
  await page.locator(root).screenshot({ path: testInfo.outputPath('boundary-trim-preview.png') })
  expect((await state(page)).objects).toEqual(before.objects)
  expect((await state(page)).revision).toBe(before.revision)
  await clickWorld(page, [50, 0])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  await expect(page.locator(`${root} [data-boundary-summary]`)).toHaveText('TRIM · 2 boundaries · 1 edit')
  const first = await state(page)
  expect(first.pieces).toHaveLength(3)
  await expect(page.locator(controls)).toHaveAttribute('data-boundary-stage', 'targets')
  await clickWorld(page, [50, 20])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 2)
  await expect(page.locator(`${root} [data-boundary-summary]`)).toHaveText('TRIM · 2 boundaries · 2 edits')
  const second = await state(page)
  expect(second.pieces).toHaveLength(4)
  expect(second.boundaries).toEqual(before.boundaries)
  expect(second.unrelated).toEqual(before.unrelated)
  for (const [index, entity] of second.pieces.entries()) {
    const y = index < 2 ? 0 : 20
    expect(entity.payload.start).toEqual([index % 2 ? 70 : 0, y, 6])
    expect(entity.payload.end).toEqual([index % 2 ? 100 : 30, y, 6])
    expect(entity.payload).toMatchObject({ color: 2, lineweight: 35, linetypeScale: 1.5 })
  }
  expect(second.pieces[0].id).toBe(before.targets[0].id)
  expect(second.pieces[2].id).toBe(before.targets[1].id)
  await page.locator(`${root} [data-action="undo"]`).click()
  await expect.poll(async () => (await state(page)).objects).toEqual(first.objects)
  await expect(page.locator(controls)).not.toBeVisible()
  await page.locator(`${root} [data-action="undo"]`).click()
  await expect.poll(async () => (await state(page)).objects).toEqual(before.objects)
  await page.locator(`${root} [data-action="redo"]`).click()
  await expect.poll(async () => (await state(page)).objects).toEqual(first.objects)
  await page.locator(`${root} [data-action="redo"]`).click()
  await expect.poll(async () => (await state(page)).objects).toEqual(second.objects)
  await page.evaluate(async () => {
    const { editor } = window.__boundaryEdit
    await editor.open(await editor.save({ format: 'KJD', download: false }), { format: 'KJD', fileName: 'continuous-trim.kjd' })
  })
  expect((await state(page)).objects).toEqual(second.objects)
  expect((await state(page)).errors).toEqual([])
})

test('embedded no-argument EXTEND enters boundary mode, repeatedly reaches a limiting edge and finishes with Enter', async ({ page }) => {
  await mount(page, 'extend')
  const before = await state(page)
  await command(page, 'EXTEND')
  await expect(page.locator(controls)).toHaveAttribute('data-boundary-stage', 'boundaries')
  await selectBoundaries(page, 'extend')
  await confirm(page, true)
  await clickWorld(page, [18, 0])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  await clickWorld(page, [18, 20])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 2)
  const after = await state(page)
  expect(after.pieces.map(entity => entity.id)).toEqual(before.targets.map(entity => entity.id))
  expect(after.pieces.map(entity => entity.payload.end)).toEqual([[40, 0, 6], [40, 20, 6]])
  expect(after.boundaries).toEqual(before.boundaries)
  await page.keyboard.press('Enter')
  await expect(page.locator(controls)).not.toBeVisible()
  expect(after.errors).toEqual([])
})

test('embedded continuous TRIM keeps empty and non-intersecting picks retryable, suppresses boundary dragging and localizes the live session', async ({ page }) => {
  await mount(page)
  const before = await state(page)
  await command(page, 'TRIM')
  await selectBoundaries(page)
  await page.locator(`${root} [data-action="language"]`).click()
  await expect(page.locator(`${root} [data-action="boundary-confirm"]`)).toHaveText('确认边界')
  await confirm(page)
  await clickWorld(page, [90, 35])
  await expect(page.locator(`${root} [data-message]`)).toContainText('没有可编辑目标')
  await clickWorld(page, [-15, 10])
  await expect(page.locator(`${root} [data-message]`)).toContainText('此处无法修剪')
  const a = await screen(page, [30, 30]), b = await screen(page, [35, 30])
  await page.mouse.move(a.x, a.y); await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up()
  expect((await state(page)).objects).toEqual(before.objects)
  await expect(page.locator(controls)).toHaveAttribute('data-boundary-stage', 'targets')
  await page.locator(`${root} [data-action="language"]`).click()
  await expect(page.locator(`${root} [data-message]`)).toContainText('Trim: click')
  await clickWorld(page, [50, 0])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  await page.locator(`${root} [data-action="boundary-finish"]`).click()
  await expect(page.locator(controls)).not.toBeVisible()
})

test('embedded single-selection workflow remains the default when target and cutting boundaries are already selected', async ({ page }) => {
  await mount(page)
  const before = await state(page)
  await clickWorld(page, [50, 0])
  await page.keyboard.down('Shift')
  await selectBoundaries(page)
  await page.keyboard.up('Shift')
  await page.locator(`${root} [data-action="modify"]`).click()
  await page.locator(`${root} [data-modification]`).selectOption('trim')
  await expect(page.locator(`${root} [data-boundary-workflow]`)).toHaveValue('single')
  await page.locator(`${root} [data-action="start-modification"]`).click()
  await expect(page.locator(controls)).not.toBeVisible()
  await clickWorld(page, [50, 0])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  expect((await state(page)).pieces).toHaveLength(3)
  expect((await state(page)).boundaries).toEqual(before.boundaries)
  expect((await state(page)).errors).toEqual([])
})

test('embedded lost native pointer capture cancels the pending boundary-edit click without committing and allows a fresh retry', async ({ page }) => {
  await mount(page)
  const before = await state(page)
  await command(page, 'TRIM')
  await selectBoundaries(page)
  await confirm(page)
  await page.evaluate(() => {
    const canvas = window.__boundaryEdit.editor.element.querySelector('[data-canvas]')
    canvas.addEventListener('pointerdown', event => { window.__boundaryOwnerId = event.pointerId }, { once: true })
    canvas.addEventListener('lostpointercapture', () => { window.__boundaryCaptureLost = true }, { once: true })
  })
  const target = await screen(page, [50, 0])
  await page.mouse.move(target.x, target.y)
  await page.mouse.down()
  await page.mouse.move(target.x + 2, target.y)
  const captured = await page.evaluate(() => {
    const canvas = window.__boundaryEdit.editor.element.querySelector('[data-canvas]')
    const owned = canvas.hasPointerCapture(window.__boundaryOwnerId)
    canvas.releasePointerCapture(window.__boundaryOwnerId)
    return owned
  })
  expect(captured).toBe(true)
  // Let the browser dispatch genuine lostpointercapture while processing the
  // next trusted pointer event; do not assume a browser-specific mouse ID.
  await page.mouse.move(target.x + 3, target.y)
  await expect.poll(() => page.evaluate(() => window.__boundaryCaptureLost)).toBe(true)
  await page.mouse.up()
  expect((await state(page)).objects).toEqual(before.objects)
  await expect(page.locator(controls)).toHaveAttribute('data-boundary-stage', 'targets')
  await clickWorld(page, [50, 0])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  expect((await state(page)).pieces).toHaveLength(3)
  expect((await state(page)).boundaries).toEqual(before.boundaries)
  expect((await state(page)).errors).toEqual([])
})

test('embedded boundary sessions end on cancellation, host revision, readonly, layout or document replacement without reviving old edits', async ({ page }) => {
  await mount(page)
  const before = await state(page)
  await clickWorld(page, [30, 35])
  await beginToolbar(page)
  await clickWorld(page, [30, 35])
  await page.keyboard.press('Escape')
  await expect(page.locator(controls)).not.toBeVisible()
  expect((await state(page)).objects).toEqual(before.objects)
  for (const change of ['revision', 'readonly', 'layout', 'document']) {
    await page.evaluate(() => window.__boundaryEdit.editor.setSelection([]))
    await command(page, 'TRIM')
    await selectBoundaries(page)
    await confirm(page)
    const pendingPick = await screen(page, [50, 0])
    await page.mouse.move(pendingPick.x, pendingPick.y)
    await page.mouse.down()
    await page.evaluate(async change => {
      const { editor, sdk, unrelated } = window.__boundaryEdit
      if (change === 'revision') await sdk.executeCommand('MOVE', { id: unrelated.id, dx: 0, dy: 1 }, { document: editor.document })
      if (change === 'readonly') editor.setOptions({ readonly: true })
      if (change === 'layout') editor.setLayout('compact')
      if (change === 'document') {
        const replacement = sdk.createDocument({ documentId: 'replacement-boundary-drawing' })
        await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [100, 0] } }, { document: replacement })
        await editor.setDocument(replacement)
      }
    }, change)
    await page.mouse.up()
    await expect(page.locator(controls)).not.toBeVisible()
    const revision = await page.evaluate(() => window.__boundaryEdit.editor.document.revision)
    await clickWorld(page, [50, 0])
    await page.keyboard.press('Enter')
    expect(await page.evaluate(() => window.__boundaryEdit.editor.document.revision)).toBe(revision)
    if (change === 'readonly') await page.evaluate(() => window.__boundaryEdit.editor.setOptions({ readonly: false }))
  }
})

test('embedded boundary controls remain visible, clickable and within a 390px Chinese host', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mount(page)
  await page.evaluate(async () => {
    document.querySelector('#boundary-edit-host').style.width = '100%'
    const { editor } = window.__boundaryEdit
    editor.setLocale('zh-CN')
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    editor.fit()
  })
  async function expectAppbarContained(locale) {
    const appbar = page.locator(`${root} .appbar`)
    for (const [action, name] of locale === 'zh-CN'
      ? [['open', '打开'], ['save-dxf', '导出 DXF']]
      : [['open', 'Open'], ['save-dxf', 'Export DXF']]) {
      const button = appbar.locator(`[data-action="${action}"]`)
      await expect(button).toBeVisible()
      await expect(button).toHaveAccessibleName(name)
      await expect(button).toHaveAttribute('title', name)
      await expect(button.locator('[data-copy]')).not.toBeVisible()
      // Firefox can return 31.999984741210938 for a 32px layout box.
      // Keep the size requirement within 0.0005 CSS px, not exact float equality.
      expect((await button.boundingBox()).width).toBeCloseTo(32, 3)
    }
    const visibleButtons = appbar.locator('button:visible')
    expect(await visibleButtons.count()).toBeGreaterThan(0)
    for (const button of await visibleButtons.all()) await expect(button).toHaveAccessibleName(/\S/)
    const metrics = await appbar.evaluate(bar => {
      const bounds = element => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height }
      }
      return {
        bounds: bounds(bar), scrollHeight: bar.scrollHeight, clientHeight: bar.clientHeight,
        scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth,
        buttons: [...bar.querySelectorAll('button')].filter(button => button.getClientRects().length).map(button => ({
          bounds: bounds(button), scrollHeight: button.scrollHeight, clientHeight: button.clientHeight,
          scrollWidth: button.scrollWidth, clientWidth: button.clientWidth,
          contents: [...button.querySelectorAll('.icon, svg, [data-copy]')]
            .filter(element => element.getClientRects().length).map(bounds),
        })),
      }
    })
    expect(metrics.bounds.left).toBeGreaterThanOrEqual(0)
    expect(metrics.bounds.right).toBeLessThanOrEqual(390)
    expect(metrics.bounds.height).toBeCloseTo(44, 3)
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1)
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
    for (const button of metrics.buttons) {
      expect(button.bounds.left).toBeGreaterThanOrEqual(metrics.bounds.left)
      expect(button.bounds.right).toBeLessThanOrEqual(metrics.bounds.right)
      expect(button.bounds.top).toBeGreaterThanOrEqual(metrics.bounds.top)
      expect(button.bounds.bottom).toBeLessThanOrEqual(metrics.bounds.bottom)
      expect(button.scrollHeight).toBeLessThanOrEqual(button.clientHeight + 1)
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1)
      for (const content of button.contents) {
        expect(content.left).toBeGreaterThanOrEqual(button.bounds.left)
        expect(content.right).toBeLessThanOrEqual(button.bounds.right)
        expect(content.top).toBeGreaterThanOrEqual(button.bounds.top)
        expect(content.bottom).toBeLessThanOrEqual(button.bounds.bottom)
      }
    }
  }
  await expectAppbarContained('zh-CN')
  await page.locator(`${root} [data-action="language"]`).click()
  await expectAppbarContained('en')
  await page.locator(`${root} [data-action="language"]`).click()
  await expectAppbarContained('zh-CN')
  await page.locator(`${root} .appbar`).screenshot({ path: testInfo.outputPath('boundary-390-zh-appbar.png') })
  const before = await state(page)
  await command(page, 'TRIM')
  const confirmButton = page.locator(`${root} [data-action="boundary-confirm"]`)
  await expect(confirmButton).toHaveText('确认边界')
  async function expectControlsContained() {
    const metrics = await page.locator(root).evaluate(host => {
      const rect = host.getBoundingClientRect()
      const canvas = host.querySelector('[data-canvas]').getBoundingClientRect()
      const actions = host.querySelector('[data-boundary-actions]')
      const actionBox = actions.getBoundingClientRect()
      const summary = actions.querySelector('[data-boundary-summary]')
      const summaryBox = summary.getBoundingClientRect()
      return {
        pageWidth: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth,
        hostWidth: rect.width, hostScroll: host.scrollWidth, canvasWidth: canvas.width,
        actionBounds: { left: actionBox.left, right: actionBox.right, top: actionBox.top, bottom: actionBox.bottom },
        summary: { text: summary.textContent, left: summaryBox.left, right: summaryBox.right, top: summaryBox.top, bottom: summaryBox.bottom },
        buttons: [...actions.querySelectorAll('button')].filter(button => button.getClientRects().length)
          .map(button => { const box = button.getBoundingClientRect(); return { text: button.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom } }),
      }
    })
    expect(metrics.hostWidth).toBeLessThanOrEqual(390)
    expect(metrics.pageScroll).toBeLessThanOrEqual(metrics.pageWidth + 1)
    expect(metrics.hostScroll).toBeLessThanOrEqual(391)
    expect(metrics.canvasWidth).toBeLessThanOrEqual(390)
    expect(metrics.summary.text).toMatch(/^修剪 · \d+ 条边界 · \d+ 次$/)
    expect(metrics.buttons).toHaveLength(2)
    for (const item of [metrics.actionBounds, metrics.summary, ...metrics.buttons]) {
      expect(item.left).toBeGreaterThanOrEqual(0)
      expect(item.right).toBeLessThanOrEqual(390)
      expect(item.top).toBeGreaterThanOrEqual(0)
      expect(item.bottom).toBeLessThanOrEqual(844)
    }
  }
  await expectControlsContained()
  await selectBoundaries(page)
  await expect(page.locator(`${root} [data-boundary-summary]`)).toHaveText('修剪 · 2 条边界 · 0 次')
  await expectControlsContained()
  await page.locator(root).screenshot({ path: testInfo.outputPath('boundary-390-zh-selection.png') })
  await confirm(page)
  await expect(page.locator(`${root} [data-action="boundary-finish"]`)).toHaveText('完成')
  await expect(page.locator(`${root} [data-action="boundary-cancel"]`)).toHaveText('取消')
  await expectControlsContained()
  const hover = await screen(page, [50, 0])
  await page.mouse.move(hover.x, hover.y)
  await expect(page.locator(`${root} [data-overlay]`)).toHaveAttribute('data-boundary-preview-count', '2')
  expect((await state(page)).revision).toBe(before.revision)
  await page.locator(root).screenshot({ path: testInfo.outputPath('boundary-390-zh-preview.png') })
  await clickWorld(page, [50, 0])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  await expect(page.locator(`${root} [data-boundary-summary]`)).toHaveText('修剪 · 2 条边界 · 1 次')
  await expectControlsContained()
  await page.locator(`${root} [data-action="boundary-finish"]`).click()
  await expect(page.locator(controls)).not.toBeVisible()
  expect((await state(page)).boundaries).toEqual(before.boundaries)
  expect((await state(page)).errors).toEqual([])
})
