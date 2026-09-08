import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true, viewport: { width: 1280, height: 900 } })

async function mount(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    document.body.style.margin = '0'
    const host = document.createElement('div')
    host.style.cssText = 'width:1200px;height:800px'
    document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK()
    const drawing = sdk.createDocument({ documentId: 'selection-grips', units: 'millimeter' })
    const entities = await sdk.executeCommand('CREATEBATCH', { entities: [
      { type: 'LINE', payload: { start: [10, 20, 0], end: [30, 20, 0] } },
      { type: 'LINE', payload: { start: [50, 20, 0], end: [90, 20, 0] } },
      { type: 'CIRCLE', payload: { center: [45, 50, 0], radius: 10 } },
      { type: 'LWPOLYLINE', payload: { vertices: [{ point: [70, 50, 0] }, { point: [80, 65, 0] }, { point: [100, 50, 0] }], closed: false } },
      { type: 'LINE', layerName: 'Locked reference', payload: { start: [10, 80, 0], end: [25, 80, 0] } },
      { type: 'LINE', layerName: 'Hidden reference', payload: { start: [30, 80, 0], end: [45, 80, 0] } },
      { type: 'LINE', layerName: 'Frozen reference', payload: { start: [50, 80, 0], end: [65, 80, 0] } },
    ] }, { document: drawing })
    for (const [index, patch] of [[4, { locked: true }], [5, { visible: false }], [6, { frozen: true }]]) {
      await sdk.executeCommand('LAYERUPDATE', { id: entities[index].payload.layerId, patch }, { document: drawing })
    }
    const errors = []
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, showLayers: false, showInspector: false, grid: false, onError: error => errors.push(String(error)) })
    await workbench.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize()
    Object.assign(workbench.renderer.camera, { centerX: 50, centerY: 40, scale: 5 })
    workbench.renderer.render()
    window.__selectionGrips = { sdk, drawing, entities, workbench, errors }
  })
}

async function position(page, world) {
  return page.evaluate(world => {
    const { workbench } = window.__selectionGrips
    const rect = workbench.root.querySelector('[data-canvas]').getBoundingClientRect()
    const p = workbench.renderer.worldToScreen(world)
    return { x: rect.left + p[0], y: rect.top + p[1] }
  }, world)
}

async function clickWorld(page, world) {
  const p = await position(page, world)
  await page.mouse.click(p.x, p.y)
}

async function dragStart(page, first, last) {
  const a = await position(page, first), b = await position(page, last)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 5 })
}

async function secondaryPointer(page, type, world, pointerId, pointerType = 'touch') {
  const location = await position(page, world)
  await page.evaluate(({ type, location, pointerId, pointerType }) => {
    const canvas = window.__selectionGrips.workbench.root.querySelector('[data-canvas]')
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId, pointerType,
      isPrimary: pointerType === 'pen', button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: location.x, clientY: location.y,
    }))
  }, { type, location, pointerId, pointerType })
}

async function selected(page) {
  return page.evaluate(() => {
    const { workbench, entities } = window.__selectionGrips
    return workbench.snapshot().selectedIds.map(id => entities.findIndex(entity => entity.id === id)).sort()
  })
}

async function entityState(page, index) {
  return page.evaluate(index => {
    const { drawing, entities } = window.__selectionGrips
    return { revision: drawing.revision, payload: drawing.getObject(entities[index].id).payload }
  }, index)
}

test('embedded CAD window/crossing selection has directional visuals and additive/subtractive shortcuts', async ({ page }) => {
  await mount(page)
  const revision = (await entityState(page, 0)).revision
  const overlay = page.locator('[data-overlay]')
  await expect(page.locator('[data-hint]')).toContainText('Shift adds')

  await dragStart(page, [5, 30], [35, 10])
  await expect(overlay).toHaveAttribute('data-selection-mode', 'window')
  expect(await selected(page)).toEqual([])
  const blueFill = await page.evaluate(() => {
    const { workbench } = window.__selectionGrips
    const canvas = workbench.root.querySelector('[data-overlay]')
    const p = workbench.renderer.worldToScreen([15, 25]), ratio = canvas.width / canvas.getBoundingClientRect().width
    return [...canvas.getContext('2d').getImageData(Math.round(p[0] * ratio), Math.round(p[1] * ratio), 1, 1).data]
  })
  expect(blueFill[2]).toBeGreaterThan(blueFill[0])
  expect(blueFill[3]).toBeGreaterThan(0)
  await page.mouse.up()
  await expect.poll(() => selected(page)).toEqual([0])

  await page.keyboard.down('Shift')
  await dragStart(page, [75, 28], [60, 12])
  await expect(overlay).toHaveAttribute('data-selection-mode', 'crossing')
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(() => selected(page)).toEqual([0, 1])

  await page.keyboard.down('Control')
  await dragStart(page, [5, 30], [35, 10])
  await page.mouse.up()
  await page.keyboard.up('Control')
  await expect.poll(() => selected(page)).toEqual([1])

  // A window touching only part of B must not include it; reversing that window does.
  await dragStart(page, [60, 28], [75, 12])
  await page.mouse.up()
  await expect.poll(() => selected(page)).toEqual([])
  await dragStart(page, [75, 28], [60, 12])
  await page.mouse.up()
  await expect.poll(() => selected(page)).toEqual([1])
  await page.keyboard.down('Shift')
  await clickWorld(page, [60, 20])
  await page.keyboard.up('Shift')
  expect(await selected(page)).toEqual([1])
  await page.keyboard.down('Control')
  await clickWorld(page, [60, 20])
  await page.keyboard.up('Control')
  await expect.poll(() => selected(page)).toEqual([])

  await page.keyboard.press('Control+a')
  await expect.poll(() => selected(page)).toEqual([0, 1, 2, 3])
  expect((await entityState(page, 0)).revision).toBe(revision)
  await clickWorld(page, [5, 5])
  await clickWorld(page, [15, 20])
  await expect.poll(() => selected(page)).toEqual([0])
  await page.locator('[data-command]').fill('select this text')
  await page.locator('[data-command]').press('Control+a')
  expect(await selected(page)).toEqual([0])
  expect(await page.locator('[data-command]').evaluate(input => input.selectionEnd - input.selectionStart)).toBe('select this text'.length)
  await page.locator('[data-action="language"]').click()
  await expect(page.locator('[data-hint]')).toContainText('Ctrl/⌘ 减选')
  expect(await page.evaluate(() => window.__selectionGrips.errors)).toEqual([])
})

test('endpoint, radius and polyline grips preview without mutation and commit one undoable edit', async ({ page }) => {
  await mount(page)
  const cases = [
    { index: 0, select: [15, 20], from: [30, 20], to: [36, 32], grips: 3, field: 'end' },
    { index: 2, select: [45 + Math.SQRT1_2 * 10, 50 + Math.SQRT1_2 * 10], from: [55, 50], to: [59, 50], grips: 5, field: 'radius' },
    { index: 3, select: [75, 57.5], from: [80, 65], to: [83, 73], grips: 5, field: 'vertex' },
  ]
  for (const item of cases) {
    await clickWorld(page, item.select)
    await expect.poll(() => selected(page)).toEqual([item.index])
    await expect(page.locator('[data-overlay]')).toHaveAttribute('data-grip-count', String(item.grips))
    const before = await entityState(page, item.index)
    await dragStart(page, item.from, item.to)
    expect(await entityState(page, item.index)).toEqual(before)
    await expect(page.locator('[data-hint]')).toContainText('new grip position')
    if (item.index === 0) {
      await page.evaluate(async () => {
        const { sdk, drawing, entities } = window.__selectionGrips
        await sdk.executeCommand('SELECT', { ids: [entities[1].id], operation: 'replace' }, { document: drawing })
      })
      // The host may change its current selection; the captured grip still belongs to A.
      await expect(page.locator('[data-overlay]')).toHaveAttribute('data-grip-count', '3')
      expect((await entityState(page, 1)).payload.start).toEqual([50, 20, 0])
    }
    await page.mouse.up()
    await expect.poll(async () => (await entityState(page, item.index)).revision).toBe(before.revision + 1)
    const after = await entityState(page, item.index)
    if (item.field === 'radius') expect(Math.abs(after.payload.radius - 14) * 5).toBeLessThanOrEqual(1.5)
    else {
      const actual = item.field === 'vertex' ? after.payload.vertices[1].point : after.payload.end
      expect(Math.hypot(actual[0] - item.to[0], actual[1] - item.to[1]) * 5).toBeLessThanOrEqual(1.5)
      expect(actual[2]).toBe(0)
    }
    await page.locator('[data-action="undo"]').click()
    expect((await entityState(page, item.index)).payload).toEqual(before.payload)
    await page.locator('[data-action="redo"]').click()
    expect((await entityState(page, item.index)).payload).toEqual(after.payload)
    await page.locator('[data-action="undo"]').click()
  }
  expect(await page.evaluate(() => window.__selectionGrips.errors)).toEqual([])
})

test('grip and box gestures safely cancel on Escape, external revisions, layout and document replacement', async ({ page }) => {
  await mount(page)
  await clickWorld(page, [15, 20])
  const initial = await entityState(page, 0)
  await dragStart(page, [30, 20], [36, 32])
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await entityState(page, 0)).toEqual(initial)
  expect(await selected(page)).toEqual([0])

  await dragStart(page, [75, 28], [60, 12])
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await selected(page)).toEqual([0])
  await expect(page.locator('[data-overlay]')).not.toHaveAttribute('data-selection-mode', /.+/)

  await dragStart(page, [30, 20], [36, 32])
  await page.evaluate(() => {
    const canvas = window.__selectionGrips.workbench.root.querySelector('[data-canvas]')
    canvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }))
  })
  await page.mouse.up()
  expect(await entityState(page, 0)).toEqual(initial)
  expect(await selected(page)).toEqual([0])

  await dragStart(page, [30, 20], [36, 32])
  await page.evaluate(async () => {
    const { sdk, drawing } = window.__selectionGrips
    await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [110, 70, 0] } }, { document: drawing })
  })
  await page.mouse.up()
  expect((await entityState(page, 0)).payload).toEqual(initial.payload)
  expect((await entityState(page, 0)).revision).toBe(initial.revision + 1)
  expect(await selected(page)).toEqual([0])

  await dragStart(page, [75, 28], [60, 12])
  await page.evaluate(() => window.__selectionGrips.workbench.setLayout('compact'))
  await page.mouse.up()
  expect(await selected(page)).toEqual([0])
  await page.evaluate(() => window.__selectionGrips.workbench.setLayout('classic'))
  await dragStart(page, [30, 20], [36, 32])
  await page.evaluate(async () => {
    const { sdk, workbench } = window.__selectionGrips
    const other = sdk.createDocument({ documentId: 'replacement-drawing', units: 'millimeter' })
    await workbench.setDocument(other)
  })
  await page.mouse.up()
  expect((await entityState(page, 0)).payload).toEqual(initial.payload)
  const replacement = await page.evaluate(() => window.__selectionGrips.workbench.snapshot())
  expect(replacement.documentId).toBe('replacement-drawing')
  expect(replacement.entityCount).toBe(0)
  expect(replacement.selectedIds).toEqual([])
  expect(await page.evaluate(() => window.__selectionGrips.errors)).toEqual([])
})

test('selected-body drag still moves the full selection and readonly hosts never expose editable grips', async ({ page }) => {
  await mount(page)
  await clickWorld(page, [15, 20])
  await page.keyboard.down('Shift')
  await clickWorld(page, [60, 20])
  await page.keyboard.up('Shift')
  await expect.poll(() => selected(page)).toEqual([0, 1])
  const before = [await entityState(page, 0), await entityState(page, 1)]
  await dragStart(page, [15, 20], [20, 30])
  await page.evaluate(async () => {
    const { sdk, drawing, entities } = window.__selectionGrips
    await sdk.executeCommand('SELECT', { ids: [entities[2].id], operation: 'replace' }, { document: drawing })
  })
  await page.mouse.up()
  for (const [index, state] of before.entries()) {
    const after = await entityState(page, index)
    expect(after.revision).toBe(state.revision + 1)
    expect(Math.hypot(after.payload.start[0] - state.payload.start[0] - 5, after.payload.start[1] - state.payload.start[1] - 10) * 5).toBeLessThanOrEqual(1.5)
  }
  expect((await entityState(page, 2)).payload.center).toEqual([45, 50, 0])
  await page.locator('[data-action="undo"]').click()
  expect((await entityState(page, 0)).payload).toEqual(before[0].payload)
  expect((await entityState(page, 1)).payload).toEqual(before[1].payload)
  await page.evaluate(() => window.__selectionGrips.workbench.setOptions({ readonly: true }))
  await clickWorld(page, [15, 20])
  await expect.poll(() => selected(page)).toEqual([0])
  await expect(page.locator('[data-overlay]')).toHaveAttribute('data-grip-count', '0')
  const readOnlyState = await entityState(page, 0)
  await dragStart(page, [30, 20], [36, 32])
  await page.mouse.up()
  expect(await entityState(page, 0)).toEqual(readOnlyState)
})

test('FENCE selects only the open path, supports point undo and first-point selection modifiers', async ({ page }) => {
  await mount(page)
  const command = page.locator('[data-command]')
  const revision = (await entityState(page, 0)).revision
  await command.fill('FENCE')
  await command.press('Enter')
  await clickWorld(page, [15, 10])
  await clickWorld(page, [15, 30])
  await clickWorld(page, [85, 10])
  await page.keyboard.press('Backspace')
  await clickWorld(page, [85, 30])
  expect(await selected(page)).toEqual([])
  await page.keyboard.press('Enter')
  // A closing diagonal would also touch B. A fence is deliberately not a closed polygon.
  await expect.poll(() => selected(page)).toEqual([0])

  await command.fill('FENCE')
  await command.press('Enter')
  await page.keyboard.down('Control')
  await clickWorld(page, [15, 10])
  await page.keyboard.up('Control')
  await clickWorld(page, [15, 30])
  await page.keyboard.press('Enter')
  await expect.poll(() => selected(page)).toEqual([])

  await clickWorld(page, [60, 20])
  await command.fill('FENCE')
  await command.press('Enter')
  await page.keyboard.down('Shift')
  await clickWorld(page, [15, 10])
  await page.keyboard.up('Shift')
  await clickWorld(page, [15, 30])
  await page.keyboard.press('Enter')
  await expect.poll(() => selected(page)).toEqual([0, 1])
  expect((await entityState(page, 0)).revision).toBe(revision)

  await command.fill('FENCE')
  await command.press('Enter')
  await clickWorld(page, [60, 10])
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  expect(await selected(page)).toEqual([0, 1])
  expect(await page.evaluate(() => window.__selectionGrips.errors)).toEqual([])
})

test('layer controls unlock and thaw protected drawing content and are disabled for readonly hosts', async ({ page }) => {
  await mount(page)
  await page.evaluate(() => window.__selectionGrips.workbench.setOptions({ showLayers: true }))
  const locked = page.locator('.layer').filter({ hasText: 'Locked reference' })
  const frozen = page.locator('.layer').filter({ hasText: 'Frozen reference' })
  await clickWorld(page, [17, 80])
  expect(await selected(page)).toEqual([])
  await expect(locked.locator('[data-layer-property="locked"]')).toHaveAttribute('aria-label', 'Unlock layer: Locked reference')
  await locked.locator('[data-layer-property="locked"]').click()
  await clickWorld(page, [17, 80])
  await expect.poll(() => selected(page)).toEqual([4])
  await expect(page.locator('[data-overlay]')).toHaveAttribute('data-grip-count', '3')
  await locked.locator('[data-layer-property="locked"]').click()
  await frozen.locator('[data-layer-property="frozen"]').click()
  await clickWorld(page, [5, 5])
  await page.keyboard.press('Control+a')
  await expect.poll(() => selected(page)).toEqual([0, 1, 2, 3, 6])
  await page.locator('[data-action="language"]').click()
  await expect(locked.locator('[data-layer-property="locked"]')).toHaveAttribute('aria-label', '解锁图层: Locked reference')
  await expect(frozen.locator('[data-layer-property="frozen"]')).toHaveAttribute('aria-label', '冻结图层: Frozen reference')
  const state = await entityState(page, 0)
  await page.evaluate(() => window.__selectionGrips.workbench.setOptions({ readonly: true }))
  await expect(locked.locator('[data-layer-property="locked"]')).toBeDisabled()
  await expect(frozen.locator('[data-layer-property="frozen"]')).toBeDisabled()
  await expect(locked.locator('input')).toBeDisabled()
  expect(await entityState(page, 0)).toEqual(state)
  expect(await page.evaluate(() => window.__selectionGrips.errors)).toEqual([])
})

test('secondary pointer streams cannot overwrite, finish or cancel the owning CAD gesture', async ({ page }) => {
  await mount(page)
  const overlay = page.locator('[data-overlay]')
  const revision = (await entityState(page, 0)).revision

  // Keep a real primary mouse gesture active; synthetic touch events model the second contact.
  await dragStart(page, [5, 30], [35, 10])
  const beforeForeignMove = await overlay.evaluate(canvas => canvas.toDataURL())
  await secondaryPointer(page, 'pointerdown', [65, 35], 201)
  await secondaryPointer(page, 'pointermove', [75, 15], 201)
  await secondaryPointer(page, 'pointerup', [75, 15], 201)
  await expect(overlay).toHaveAttribute('data-selection-mode', 'window')
  expect(await overlay.evaluate(canvas => canvas.toDataURL())).toBe(beforeForeignMove)
  expect(await selected(page)).toEqual([])
  expect((await entityState(page, 0)).revision).toBe(revision)
  await page.mouse.up()
  await expect.poll(() => selected(page)).toEqual([0])

  await dragStart(page, [75, 28], [60, 12])
  await secondaryPointer(page, 'pointerdown', [15, 25], 202)
  await secondaryPointer(page, 'pointercancel', [15, 25], 202)
  await expect(overlay).toHaveAttribute('data-selection-mode', 'crossing')
  expect(await selected(page)).toEqual([0])
  await page.mouse.up()
  await expect.poll(() => selected(page)).toEqual([1])

  await clickWorld(page, [5, 5])
  await clickWorld(page, [15, 20])
  await dragStart(page, [30, 20], [36, 32])
  // A pen can report isPrimary=true for its own pointer type. Its ignored stream must stay
  // ignored even if it ends after the original mouse owner has already committed and released.
  await secondaryPointer(page, 'pointerdown', [55, 50], 203, 'pen')
  await secondaryPointer(page, 'pointermove', [45, 50], 203, 'pen')
  await page.mouse.up()
  await expect.poll(async () => (await entityState(page, 0)).revision).toBe(revision + 1)
  const committed = await entityState(page, 0)
  expect(Math.hypot(committed.payload.end[0] - 36, committed.payload.end[1] - 32) * 5).toBeLessThanOrEqual(1.5)
  await secondaryPointer(page, 'pointerup', [65, 65], 203, 'pen')
  expect(await selected(page)).toEqual([0])
  expect(await entityState(page, 0)).toEqual(committed)
  expect((await entityState(page, 2)).payload.center).toEqual([45, 50, 0])
  await page.locator('[data-action="undo"]').click()

  const command = page.locator('[data-command]')
  for (const endAfterOwner of [false, true]) {
    await clickWorld(page, [5, 5])
    await command.fill('FENCE')
    await command.press('Enter')
    await clickWorld(page, [15, 10])
    // An unrelated touch cancelled outside this canvas must not cancel an armed fence.
    await secondaryPointer(page, 'pointercancel', [85, 10], 999)
    expect(await page.evaluate(() => window.__selectionGrips.workbench.tool)).toBe('fence')
    const next = await position(page, [15, 30])
    await page.mouse.move(next.x, next.y)
    await page.mouse.down()
    const pointerId = endAfterOwner ? 205 : 204, pointerType = endAfterOwner ? 'pen' : 'touch'
    await secondaryPointer(page, 'pointerdown', [85, 10], pointerId, pointerType)
    await secondaryPointer(page, 'pointermove', [85, 10], pointerId, pointerType)
    if (!endAfterOwner) await secondaryPointer(page, 'pointerup', [85, 10], pointerId, pointerType)
    await page.mouse.up()
    if (endAfterOwner) await secondaryPointer(page, 'pointerup', [85, 10], pointerId, pointerType)
    await page.keyboard.press('Enter')
    // Adding the foreign contact would create a third segment crossing B instead of this A-only fence.
    await expect.poll(() => selected(page)).toEqual([0])
  }
  expect(await page.evaluate(() => window.__selectionGrips.errors)).toEqual([])
})

test('long bilingual guidance cannot expand the host grid or move the drawing camera', async ({ page }) => {
  await mount(page)
  await page.evaluate(async () => {
    const { workbench } = window.__selectionGrips
    workbench.container.style.width = '1100px'
    workbench.setOptions({ showLayers: true, showInspector: true })
    workbench.setTool('select')
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.fit()
  })
  const layoutState = () => page.evaluate(() => {
    const { workbench } = window.__selectionGrips
    const root = workbench.root, host = workbench.container.getBoundingClientRect(), rect = root.getBoundingClientRect()
    const canvas = root.querySelector('[data-canvas]').getBoundingClientRect()
    const hint = root.querySelector('[data-hint]').getBoundingClientRect()
    const rows = ['.appbar', '.ribbon', '.workspace', '.statusbar'].map(selector => root.querySelector(selector).getBoundingClientRect())
    return {
      hostWidth: host.width, rootWidth: rect.width, canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
      camera: { ...workbench.renderer.camera },
      rowsFit: rows.every(row => row.left >= rect.left && row.right <= rect.right),
      hintFits: hint.left >= canvas.left && hint.right <= canvas.right,
      hintPassesThrough: getComputedStyle(root.querySelector('[data-hint]')).pointerEvents === 'none',
      labelsStayOnOneLine: [...root.querySelectorAll('.appbar button [data-copy]')].every(label => label.getBoundingClientRect().height <= parseFloat(getComputedStyle(label).lineHeight) + 1),
    }
  })
  const initial = await layoutState()
  expect(initial).toMatchObject({ hostWidth: 1100, rootWidth: 1100, rowsFit: true, hintFits: true, hintPassesThrough: true, labelsStayOnOneLine: true })

  // Changing geometry and replacing a long hint with a short command receipt must not
  // manufacture a viewport resize and trigger an unwanted fit to the new, distant object.
  await page.evaluate(async () => {
    const { workbench } = window.__selectionGrips
    await workbench.execute('CREATE', { type: 'POINT', payload: { position: [300, 300, 0] } })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  expect(await layoutState()).toEqual(initial)
  for (const locale of ['zh-CN', 'en']) {
    await page.evaluate(async locale => {
      const { workbench } = window.__selectionGrips
      workbench.setLocale(locale)
      workbench.setTool('select')
      workbench.setOptions({ title: locale === 'en' ? 'A long engineering drawing title '.repeat(12) : '多行业工程总图及专业构造详图'.repeat(15) })
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }, locale)
    expect(await layoutState()).toEqual(initial)
  }
  expect(await page.evaluate(() => window.__selectionGrips.errors)).toEqual([])
})
