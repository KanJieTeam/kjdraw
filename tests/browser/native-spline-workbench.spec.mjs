import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true, viewport: { width: 1280, height: 900 } })

const root = '#native-spline-workbench'
const overlay = `${root} [data-overlay]`
const controls = `${root} [data-boundary-actions]`
const arch = { degree: 2, controlPoints: [[0, 0, 0], [5, 10, 0], [10, 0, 0]], knots: [2, 2, 2, 6, 6, 6] }
const quarter = { degree: 2, controlPoints: [[35, 0, 0], [35, 5, 0], [30, 5, 0]], knots: [0, 0, 0, 1, 1, 1], weights: [1, Math.SQRT1_2, 1] }
const crossing = { degree: 1, controlPoints: [[0, 0, 0], [4, 4, 0], [0, 4, 0], [4, 0, 0]], knots: [0, 0, 1, 2, 3, 3] }
const browserErrors = new WeakMap()
test.beforeEach(({ page }) => {
  const errors = []; browserErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(({ page }) => { expect(browserErrors.get(page)).toEqual([]) })

// Independent recursive B-spline basis, with an analytic circle check below.
// The test never uses the SDK evaluator to judge the resulting native pieces.
function evaluate(payload, u) {
  const p = payload, end = p.knots[p.controlPoints.length]
  if (u === end) return p.controlPoints.at(-1)
  const basis = (i, degree) => {
    if (!degree) return p.knots[i] <= u && u < p.knots[i + 1] ? 1 : 0
    const a = p.knots[i + degree] - p.knots[i], b = p.knots[i + degree + 1] - p.knots[i + 1]
    return (a ? (u - p.knots[i]) / a * basis(i, degree - 1) : 0)
      + (b ? (p.knots[i + degree + 1] - u) / b * basis(i + 1, degree - 1) : 0)
  }
  const coefficients = p.controlPoints.map((_, i) => basis(i, p.degree) * (p.weights?.[i] ?? 1))
  const denominator = coefficients.reduce((a, b) => a + b, 0)
  return [0, 1, 2].map(axis => p.controlPoints.reduce((sum, point, i) => sum + point[axis] * coefficients[i], 0) / denominator)
}

function domain(entity) {
  const p = entity.payload
  return [p.knots[p.degree], p.knots[p.controlPoints.length]]
}

function verifyPieces(pieces, original, circle = false) {
  expect(pieces.length).toBeGreaterThan(0)
  for (const entity of pieces) {
    expect(entity.type).toBe('SPLINE')
    expect(entity.payload.degree).toBe(original.degree)
    const [start, end] = domain(entity)
    expect(start).toBeLessThan(end)
    for (const f of [0, .13, .37, .73, 1]) {
      const u = start + (end - start) * f, actual = evaluate(entity.payload, u), expected = evaluate(original, u)
      expect(Math.hypot(...actual.map((value, axis) => value - expected[axis]))).toBeLessThan(1e-9)
      if (circle) expect(Math.abs(Math.hypot(actual[0] - 30, actual[1]) - 5)).toBeLessThan(1e-10)
    }
  }
}

async function mount(page, kind = 'arch') {
  // An empty same-origin fixture avoids running the unrelated Playground app
  // while its DOM is replaced. All SDK/editor modules still come from the real
  // test server; no geometry, event, command or drawing API is intercepted.
  await page.route('**/native-spline-pointer-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Native spline workbench</title></head><body></body></html>',
  }))
  await page.goto('/native-spline-pointer-fixture')
  await page.evaluate(async ({ kind, arch, quarter, crossing }) => {
    document.body.replaceChildren(); document.body.style.margin = '0'
    const host = document.createElement('div'); host.id = 'native-spline-workbench'
    host.style.cssText = 'width:1200px;height:800px'; document.body.append(host)
    const [{ createKJDrawSDK }, { createKJDrawEditor }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/editor.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: `native-spline-pointer-${kind}`, units: 'millimeter' })
    const layer = await sdk.executeCommand('LAYERNEW', { name: 'Native curves', color: 2 })
    const cutterLayer = await sdk.executeCommand('LAYERNEW', { name: 'Preserved cutters', color: 3 })
    const targets = []
    for (const payload of kind === 'continuous' ? [arch, quarter] : [kind === 'crossing' ? crossing : kind === 'quarter' ? quarter : arch]) {
      targets.push(await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { ...payload, layerId: layer.id, color: 2, lineweight: 35, linetypeScale: 1.5 } }))
    }
    const cutters = []
    if (kind === 'continuous') {
      for (const x of [3, 7, 31.5, 33.5]) cutters.push(await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
        start: [x, -1, 0], end: [x, 7, 0], layerId: cutterLayer.id, color: 3,
      } }))
      await sdk.executeCommand('LAYERUPDATE', { id: cutterLayer.id, patch: { locked: true } })
    }
    const note = await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { text: 'Keep this manual note', position: [-2, -2, 0], height: .5 } })
    const errors = [], commands = [], pointerPicks = []
    const editor = createKJDrawEditor(host, { sdk, document: drawing, grid: false, layers: false, properties: false,
      onError: error => errors.push(String(error)),
    })
    await editor.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    editor.fit()
    sdk.events.on('command:before-execute', ({ envelope }) => {
      if (['BREAK', 'TRIM'].includes(envelope.command)) commands.push(JSON.parse(JSON.stringify(envelope)))
    })
    const canvas = editor.element.querySelector('[data-canvas]')
    canvas.addEventListener('pointerup', event => {
      const rect = canvas.getBoundingClientRect()
      pointerPicks.push(editor.workbench.renderer.screenToWorld([event.clientX - rect.left, event.clientY - rect.top]))
    })
    window.__nativeSplinePointer = { sdk, editor, layer, targets, cutters, note, errors, commands, pointerPicks }
  }, { kind, arch, quarter, crossing })
}

async function state(page) {
  return page.evaluate(() => {
    const { editor, layer, targets, cutters, note, errors, commands, pointerPicks } = window.__nativeSplinePointer
    const drawing = editor.document
    return {
      revision: drawing.revision, objects: drawing.snapshot().objects, history: [drawing.history.undoCount, drawing.history.redoCount],
      pieces: drawing.listEntities().filter(entity => entity.payload.layerId === layer.id),
      targets, cutters: cutters.map(entity => drawing.getObject(entity.id)), note: drawing.getObject(note.id),
      selected: [...editor.getSelection()], errors: [...errors], commands: [...commands], pointerPicks: [...pointerPicks],
    }
  })
}

async function screen(page, world, offset = [0, 0]) {
  return page.evaluate(({ world, offset }) => {
    const { editor } = window.__nativeSplinePointer, rect = editor.element.querySelector('[data-canvas]').getBoundingClientRect()
    const p = editor.workbench.renderer.worldToScreen(world)
    const x = Math.round(rect.left + p[0]) + offset[0], y = Math.round(rect.top + p[1]) + offset[1]
    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) throw new Error('Test fixture pick lies outside the canvas')
    return { x, y }
  }, { world, offset })
}

async function click(page, world, offset) {
  const p = await screen(page, world, offset); await page.mouse.click(p.x, p.y)
}

async function command(page, value) {
  const input = page.locator(`${root} [data-command]`); await input.fill(value); await input.press('Enter')
}

async function beginBreak(page, two = false) {
  await command(page, 'BREAK')
  await expect(page.locator(`${root} [data-modification-dialog]`)).toBeVisible()
  if (two) await page.locator(`${root} [data-modification]`).selectOption('break-two-point')
  await expect(page.locator(`${root} [data-modification-field="tolerance"]`)).toHaveValue('1e-7')
  await page.locator(`${root} [data-action="start-modification"]`).click()
}

function verifyPointArguments(envelope, raw) {
  const args = envelope.arguments
  for (const key of ['parameter', 'parameters', 'pickParameter']) expect(args).not.toHaveProperty(key)
  const points = args.secondPoint ? [args.firstPoint, args.secondPoint] : args.point ? [args.point] : [args.pickPoint]
  expect(points.length).toBeGreaterThan(0)
  expect(Math.hypot(points.at(-1)[0] - raw[0], points.at(-1)[1] - raw[1])).toBeGreaterThan(1e-5)
}

function verifySourceMetadata(pieces, original) {
  const primary = pieces.find(entity => entity.id === original.id)
  const { payload: _beforePayload, ...before } = original
  const { payload: _afterPayload, ...after } = primary
  expect(after).toEqual(before)
  for (const piece of pieces.filter(entity => entity.id !== original.id)) {
    expect(piece.ownerId).toBe(original.ownerId)
    expect(piece.extension).toEqual(original.extension)
    expect(piece.source).toEqual({ derivedFromId: original.id, derivedFromHandle: original.handle })
  }
}

async function reopen(page, expected) {
  // Public file I/O only: all edits above and after this helper use real mouse input.
  const result = await page.evaluate(async () => {
    const { editor, sdk } = window.__nativeSplinePointer
    const native = await sdk.readDocument(await editor.save({ format: 'DXF', download: false }), { format: 'DXF' })
    const curves = native.listEntities({ type: 'SPLINE' })
    await editor.open(await editor.save({ format: 'KJD', download: false }), { format: 'KJD', fileName: 'native-pointer-edit.kjd' })
    return { curves, polylines: native.listEntities({ type: 'LWPOLYLINE' }).length,
      nativeLineCount: native.listEntities({ type: 'LINE' }).length, nativeNote: native.listEntities({ type: 'TEXT' })[0].payload.text }
  })
  expect((await state(page)).objects).toEqual(expected.objects)
  expect(result.curves).toHaveLength(expected.pieces.length)
  expect(result.polylines).toBe(0)
  expect(result.nativeLineCount).toBe(expected.cutters.length)
  expect(result.nativeNote).toBe(expected.note.payload.text)
  return result.curves
}

test('real mouse BREAK projects an off-curve arch pick without relaxing core tolerance, retries and survives history/native reopening', async ({ page }) => {
  await mount(page)
  await click(page, evaluate(arch, 2 + 4 * .21))
  const before = await state(page)
  expect(before.selected).toEqual([before.targets[0].id])
  await beginBreak(page)
  await click(page, [4.31, 2.12])
  await expect(page.locator(`${root} [data-hint]`)).toContainText(/tolerance|parameter/i)
  const refused = await state(page)
  expect(refused.objects).toEqual(before.objects); expect(refused.revision).toBe(before.revision); expect(refused.history).toEqual(before.history)
  const p = await screen(page, evaluate(arch, 2 + 4 * .371), [3, 2])
  await page.mouse.move(p.x, p.y)
  await expect(page.locator(overlay)).toHaveAttribute('data-modification-preview-count', '2')
  expect((await state(page)).objects).toEqual(before.objects)
  await page.mouse.click(p.x, p.y)
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  const after = await state(page)
  expect(after.pieces).toHaveLength(2); expect(after.history[0]).toBe(before.history[0] + 1)
  expect(after.pieces[0].id).toBe(before.targets[0].id); expect(after.pieces[0].handle).toBe(before.targets[0].handle)
  expect(after.pieces[0].source).toEqual(before.targets[0].source); expect(after.note).toEqual(before.note)
  verifyPieces(after.pieces, arch)
  verifySourceMetadata(after.pieces, before.targets[0])
  expect(domain(after.pieces[0])[1]).toBe(domain(after.pieces[1])[0])
  const envelope = after.commands.at(-1)
  expect(envelope.arguments.tolerance).toBe(1e-7); verifyPointArguments(envelope, after.pointerPicks.at(-1))
  await page.locator(`${root} [data-action="undo"]`).click(); await expect.poll(async () => (await state(page)).objects).toEqual(before.objects)
  await page.locator(`${root} [data-action="redo"]`).click(); await expect.poll(async () => (await state(page)).objects).toEqual(after.objects)
  verifyPieces(await reopen(page, after), arch)
})

test('real mouse two-point BREAK keeps rational circle pieces native and can cut again after KJD reopen', async ({ page }) => {
  await mount(page, 'quarter')
  await click(page, evaluate(quarter, .1))
  const before = await state(page)
  await beginBreak(page, true)
  await click(page, evaluate(quarter, .27), [2, 3])
  const p = await screen(page, evaluate(quarter, .74), [3, 2]); await page.mouse.move(p.x, p.y)
  await expect(page.locator(overlay)).toHaveAttribute('data-modification-preview-count', '2')
  expect((await state(page)).objects).toEqual(before.objects)
  await page.mouse.click(p.x, p.y)
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  const after = await state(page)
  expect(after.pieces).toHaveLength(2); verifyPieces(after.pieces, quarter, true)
  verifySourceMetadata(after.pieces, before.targets[0]); expect(after.note).toEqual(before.note)
  expect(after.history[0]).toBe(before.history[0] + 1)
  expect(domain(after.pieces[0])[0]).toBe(0); expect(domain(after.pieces[1])[1]).toBe(1)
  expect(domain(after.pieces[0])[1]).toBeLessThan(domain(after.pieces[1])[0])
  const envelope = after.commands.at(-1)
  expect(envelope.arguments.firstPoint).toHaveLength(2); expect(envelope.arguments.secondPoint).toHaveLength(2)
  expect(envelope.arguments.tolerance).toBe(1e-7)
  verifyPointArguments(envelope, after.pointerPicks.at(-1))
  await page.locator(`${root} [data-action="undo"]`).click(); await expect.poll(async () => (await state(page)).objects).toEqual(before.objects)
  await page.locator(`${root} [data-action="redo"]`).click(); await expect.poll(async () => (await state(page)).objects).toEqual(after.objects)
  verifyPieces(await reopen(page, after), quarter, true)
  await click(page, evaluate(quarter, .1))
  const reopened = await state(page); await beginBreak(page); await click(page, evaluate(quarter, .14), [2, 2])
  await expect.poll(async () => (await state(page)).revision).toBe(reopened.revision + 1)
  const again = await state(page); expect(again.pieces).toHaveLength(3); verifyPieces(again.pieces, quarter, true)
  expect(again.errors).toEqual([])
})

test('real mouse continuous TRIM projects arch and rational-circle picks, preserves locked cutters and gives one undo per edit', async ({ page }) => {
  await mount(page, 'continuous')
  const before = await state(page)
  await command(page, 'TRIM')
  await expect(page.locator(controls)).toHaveAttribute('data-boundary-stage', 'boundaries')
  for (const x of [3, 7, 31.5, 33.5]) await click(page, [x, 6.5])
  await expect.poll(async () => (await state(page)).selected).toEqual(before.cutters.map(entity => entity.id))
  await page.locator(`${root} [data-action="boundary-confirm"]`).click()
  await expect(page.locator(controls)).toHaveAttribute('data-boundary-stage', 'targets')
  await click(page, [15, 2])
  expect((await state(page)).objects).toEqual(before.objects)
  const firstPoint = await screen(page, evaluate(arch, 2 + 4 * .47), [3, 2]); await page.mouse.move(firstPoint.x, firstPoint.y)
  await expect(page.locator(overlay)).toHaveAttribute('data-boundary-preview-count', '2')
  expect((await state(page)).revision).toBe(before.revision)
  await page.mouse.click(firstPoint.x, firstPoint.y)
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  const first = await state(page)
  await expect(page.locator(controls)).toHaveAttribute('data-boundary-stage', 'targets')
  const secondPoint = await screen(page, evaluate(quarter, .61), [3, 2]); await page.mouse.move(secondPoint.x, secondPoint.y)
  await expect(page.locator(overlay)).toHaveAttribute('data-boundary-preview-count', '2')
  expect((await state(page)).objects).toEqual(first.objects)
  await page.mouse.click(secondPoint.x, secondPoint.y)
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 2)
  const second = await state(page)
  expect(second.pieces).toHaveLength(4); expect(second.history[0]).toBe(before.history[0] + 2)
  expect(second.cutters).toEqual(before.cutters); expect(second.note).toEqual(before.note)
  const archPieces = second.pieces.filter(entity => entity.id === before.targets[0].id || entity.source?.derivedFromId === before.targets[0].id)
  const circlePieces = second.pieces.filter(entity => entity.id === before.targets[1].id || entity.source?.derivedFromId === before.targets[1].id)
  verifyPieces(archPieces, arch); verifyPieces(circlePieces, quarter, true)
  verifySourceMetadata(archPieces, before.targets[0]); verifySourceMetadata(circlePieces, before.targets[1])
  expect(archPieces.map(domain)).toEqual([[2, expect.closeTo(3.2, 6)], [expect.closeTo(4.8, 6), 6]])
  for (const entity of second.pieces) expect(entity.payload).toMatchObject({ color: 2, lineweight: 35, linetypeScale: 1.5 })
  for (const [index, envelope] of second.commands.entries()) {
    expect(envelope.arguments).not.toHaveProperty('tolerance') // Core TRIM default remains 1e-7.
    verifyPointArguments(envelope, second.pointerPicks.at(index === 0 ? -2 : -1))
  }
  await expect(page.locator(`${root} [data-boundary-summary]`)).toHaveText('TRIM · 4 boundaries · 2 edits')
  await page.keyboard.press('Escape'); await expect(page.locator(controls)).not.toBeVisible()
  await page.locator(`${root} [data-action="undo"]`).click(); await expect.poll(async () => (await state(page)).objects).toEqual(first.objects)
  await page.locator(`${root} [data-action="undo"]`).click(); await expect.poll(async () => (await state(page)).objects).toEqual(before.objects)
  await page.locator(`${root} [data-action="redo"]`).click(); await expect.poll(async () => (await state(page)).objects).toEqual(first.objects)
  await page.locator(`${root} [data-action="redo"]`).click(); await expect.poll(async () => (await state(page)).objects).toEqual(second.objects)
  const native = await reopen(page, second)
  verifyPieces(native.filter(entity => entity.payload.controlPoints[0][0] < 20), arch)
  verifyPieces(native.filter(entity => entity.payload.controlPoints[0][0] > 20), quarter, true)
  expect((await state(page)).errors).toEqual([])
})

test('real mouse crossing-point BREAK refuses ambiguity atomically and remains retryable on a unique branch', async ({ page }) => {
  await mount(page, 'crossing')
  await click(page, [1, 1])
  // Public camera pan only: align the actual crossing to an integer CSS pixel,
  // so browser pointer quantization does not accidentally choose one branch.
  await page.evaluate(() => {
    const { editor } = window.__nativeSplinePointer, renderer = editor.workbench.renderer
    const rect = editor.element.querySelector('[data-canvas]').getBoundingClientRect(), p = renderer.worldToScreen([2, 2])
    renderer.panBy(Math.round(rect.left + p[0]) - rect.left - p[0], Math.round(rect.top + p[1]) - rect.top - p[1])
  })
  const before = await state(page); expect(before.selected).toEqual([before.targets[0].id])
  await beginBreak(page); await click(page, [2, 2])
  await expect(page.locator(`${root} [data-hint]`)).toContainText(/unique|multiple|ambiguous/i)
  const refused = await state(page)
  expect(Math.hypot(refused.pointerPicks.at(-1)[0] - 2, refused.pointerPicks.at(-1)[1] - 2)).toBeLessThan(1e-10)
  expect(refused.objects).toEqual(before.objects); expect(refused.revision).toBe(before.revision); expect(refused.history).toEqual(before.history)
  await click(page, [.83, .83], [2, 1])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  const after = await state(page); expect(after.pieces).toHaveLength(2); verifyPieces(after.pieces, crossing)
  expect(after.commands.at(-1).arguments.tolerance).toBe(1e-7)
  verifyPointArguments(after.commands.at(-1), after.pointerPicks.at(-1))
  await page.locator(`${root} [data-action="undo"]`).click(); await expect.poll(async () => (await state(page)).objects).toEqual(before.objects)
})
