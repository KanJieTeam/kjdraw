import { expect, test } from '@playwright/test'
import { arcSweep } from '../../packages/kjdraw-sdk/src/geometry/measure.js'

test.use({ bypassCSP: true, viewport: { width: 1280, height: 900 } })

async function mountCurveFixture(page, type, extend = false) {
  await page.goto('/')
  await page.evaluate(async ({ type, extend }) => {
    document.body.replaceChildren()
    document.body.style.margin = '0'
    const host = document.createElement('div')
    host.id = 'curve-trim-editor'
    host.style.cssText = 'width:1200px;height:800px'
    document.body.append(host)
    const [{ createKJDrawSDK }, { createKJDrawEditor }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/editor.js'),
    ])
    const sdk = createKJDrawSDK()
    const drawing = sdk.createDocument({ documentId: `embedded-${type.toLowerCase()}-trim`, units: 'millimeter' })
    const layer = await sdk.executeCommand('LAYERNEW', { name: 'Curve parts', color: 3 }, { document: drawing })
    const target = await sdk.executeCommand('CREATE', { type, options: { name: 'Elevated curve' }, payload: {
      layerId: layer.id, center: [0, 0, 6], radius: 10, color: 2, lineweight: 35, linetypeScale: 1.5,
      ...(type === 'ARC' ? { startAngle: 0, endAngle: extend ? Math.PI / 2 : Math.PI, clockwise: false } : {}),
    } }, { document: drawing })
    const definitions = type === 'CIRCLE'
      ? [{ start: [-15, 0, 6], end: [15, 0, 6] }]
      : (extend ? [-5] : [5, -5]).map(x => ({ start: [x, 0, 6], end: [x, 15, 6] }))
    const boundaries = []
    for (const payload of definitions) {
      boundaries.push(await sdk.executeCommand('CREATE', { type: 'LINE', payload }, { document: drawing }))
    }
    const group = await sdk.executeCommand('GROUP', { name: 'Curve assembly', ids: [target.id] })
    sdk.activeSelection.replace([target.id])
    const saved = await sdk.getSelectionManager().saveNamed('Curve selection')
    sdk.activeSelection.clear()
    const errors = []
    const editor = createKJDrawEditor(host, {
      sdk, document: drawing, grid: false, layers: false, properties: false,
      onError: error => errors.push(String(error)),
    })
    await editor.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    editor.fit()
    window.__curveTrim = { editor, target, boundaries, layer, group, saved, errors }
  }, { type, extend })
}

async function clickWorld(page, world) {
  const point = await page.evaluate(world => {
    const { editor } = window.__curveTrim
    const rect = editor.element.querySelector('[data-canvas]').getBoundingClientRect()
    const point = editor.workbench.renderer.worldToScreen(world)
    return { x: rect.left + point[0], y: rect.top + point[1] }
  }, world)
  await page.mouse.click(point.x, point.y)
}

async function state(page) {
  return page.evaluate(() => {
    const { editor, target, boundaries, layer, group, saved, errors } = window.__curveTrim
    const drawing = editor.document
    return {
      revision: drawing.revision, objects: drawing.snapshot().objects, count: drawing.listEntities().length,
      pieces: drawing.listEntities().filter(entity => entity.payload.layerId === layer.id)
        .sort((a, b) => Number(a.payload.startAngle ?? 0) - Number(b.payload.startAngle ?? 0)),
      boundaries: boundaries.map(entity => drawing.getObject(entity.id)),
      original: target, currentTarget: drawing.getObject(target.id), layerId: layer.id,
      groupMembers: drawing.getObject(group.id).payload.memberIds,
      savedMembers: drawing.getObject(saved.id).payload.memberIds,
      selectedIds: [...editor.getSelection()], errors: [...errors],
    }
  })
}

async function selectAndTrim(page, before, boundaryPicks) {
  // Initial target selection and added boundary selections use ordinary mouse hit tests.
  await clickWorld(page, [0, 10])
  await expect.poll(async () => (await state(page)).selectedIds).toEqual([before.original.id])
  await page.keyboard.down('Shift')
  for (const point of boundaryPicks) await clickWorld(page, point)
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await state(page)).selectedIds)
    .toEqual([before.original.id, ...before.boundaries.map(entity => entity.id)])

  await page.locator('#curve-trim-editor [data-action="modify"]').click()
  await expect(page.locator('#curve-trim-editor [data-modification-dialog]')).toBeVisible()
  await page.locator('#curve-trim-editor [data-modification]').selectOption('trim')
  await page.locator('#curve-trim-editor [data-action="start-modification"]').click()
  await expect(page.locator('#curve-trim-editor [data-modification-dialog]')).not.toBeVisible()
  expect((await state(page)).objects).toEqual(before.objects)
  await clickWorld(page, [0, 10])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
}

function expectStyleAndPlane(entity, before) {
  expect(entity.type).toBe('ARC')
  expect(entity.ownerId).toBe(before.original.ownerId)
  expect(entity.name).toBe(before.original.name)
  expect(entity.payload).toMatchObject({
    layerId: before.layerId, color: 2, lineweight: 35, linetypeScale: 1.5, center: [0, 0, 6], radius: 10,
  })
}

function expectArcPoint(payload, fraction, expected) {
  const angle = payload.startAngle + arcSweep(payload) * fraction
  const point = [payload.center[0] + payload.radius * Math.cos(angle), payload.center[1] + payload.radius * Math.sin(angle)]
  expect(point[0]).toBeCloseTo(expected[0], 9)
  expect(point[1]).toBeCloseTo(expected[1], 9)
}

async function verifyUndoRedoAndReopen(page, before, trimmed) {
  expect(trimmed.boundaries).toEqual(before.boundaries)
  expect(trimmed.errors).toEqual([])
  const pieceIds = trimmed.pieces.map(entity => entity.id)
  expect(trimmed.groupMembers).toEqual(pieceIds)
  expect(trimmed.savedMembers).toEqual(pieceIds)
  await page.locator('#curve-trim-editor [data-action="undo"]').click()
  await expect.poll(async () => (await state(page)).objects).toEqual(before.objects)
  await page.locator('#curve-trim-editor [data-action="redo"]').click()
  await expect.poll(async () => (await state(page)).objects).toEqual(trimmed.objects)
  const replaced = await page.evaluate(async () => {
    const { editor } = window.__curveTrim
    const previous = editor.document
    const bytes = await editor.save({ format: 'KJD', download: false })
    await editor.open(bytes, { format: 'KJD', fileName: 'trimmed-curves.kjd' })
    return previous !== editor.document
  })
  expect(replaced).toBe(true)
  const reopened = await state(page)
  expect(reopened.objects).toEqual(trimmed.objects)
  expect(reopened.pieces).toEqual(trimmed.pieces)
  expect(reopened.boundaries).toEqual(before.boundaries)
  expect(reopened.groupMembers).toEqual(pieceIds)
  expect(reopened.savedMembers).toEqual(pieceIds)
  expect(reopened.errors).toEqual([])
}

test('embedded toolbar trims the upper semicircle into a new lower ARC and restores the original circle in one undo', async ({ page }) => {
  await mountCurveFixture(page, 'CIRCLE')
  const before = await state(page)
  expect(before.count).toBe(2)
  await selectAndTrim(page, before, [[-12, 0]])
  const trimmed = await state(page)
  expect(trimmed.count).toBe(2)
  expect(trimmed.currentTarget).toBeNull()
  expect(trimmed.pieces).toHaveLength(1)
  const arc = trimmed.pieces[0]
  // Entity types are immutable: changing CIRCLE to ARC creates a derived entity,
  // instead of changing the old entity's type behind a stable ID and handle.
  expect(arc.id).not.toBe(before.original.id)
  expect(arc.handle).not.toBe(before.original.handle)
  expect(arc.source).toMatchObject({ derivedFromId: before.original.id, derivedFromHandle: before.original.handle })
  expectStyleAndPlane(arc, before)
  expect(Math.abs(arcSweep(arc.payload))).toBeCloseTo(Math.PI, 10)
  expectArcPoint(arc.payload, 0.5, [0, -10])
  for (const angle of [arc.payload.startAngle, arc.payload.startAngle + arcSweep(arc.payload)]) {
    expect(Math.abs(Math.cos(angle) * 10)).toBeCloseTo(10, 9)
    expect(Math.sin(angle) * 10).toBeCloseTo(0, 9)
  }
  await expect.poll(async () => (await state(page)).selectedIds).toEqual([arc.id])
  await verifyUndoRedoAndReopen(page, before, trimmed)
})

test('embedded toolbar removes only the middle of an elevated ARC and retains both styled arc ends through undo and reopen', async ({ page }) => {
  await mountCurveFixture(page, 'ARC')
  const before = await state(page)
  expect(before.count).toBe(3)
  await selectAndTrim(page, before, [[5, 13], [-5, 13]])
  const trimmed = await state(page)
  expect(trimmed.count).toBe(4)
  expect(trimmed.pieces).toHaveLength(2)
  const [first, last] = trimmed.pieces
  expect(first.id).toBe(before.original.id)
  expect(first.handle).toBe(before.original.handle)
  expect(last.id).not.toBe(before.original.id)
  const intersectY = Math.sqrt(75)
  for (const arc of trimmed.pieces) {
    expectStyleAndPlane(arc, before)
    expect(arcSweep(arc.payload)).toBeCloseTo(Math.PI / 3, 10)
  }
  expectArcPoint(first.payload, 0, [10, 0])
  expectArcPoint(first.payload, 1, [5, intersectY])
  expectArcPoint(last.payload, 0, [-5, intersectY])
  expectArcPoint(last.payload, 1, [-10, 0])
  await verifyUndoRedoAndReopen(page, before, trimmed)
})

test('embedded toolbar extends a picked ARC end to its boundary with unchanged identity and public save/reopen', async ({ page }) => {
  await mountCurveFixture(page, 'ARC', true)
  const before = await state(page)
  await clickWorld(page, [Math.sqrt(50), Math.sqrt(50)])
  await expect.poll(async () => (await state(page)).selectedIds).toEqual([before.original.id])
  await page.keyboard.down('Shift')
  await clickWorld(page, [-5, 13])
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await state(page)).selectedIds).toEqual([before.original.id, before.boundaries[0].id])
  await page.locator('#curve-trim-editor [data-action="modify"]').click()
  await page.locator('#curve-trim-editor [data-modification]').selectOption('extend')
  await page.locator('#curve-trim-editor [data-action="start-modification"]').click()
  await expect(page.locator('#curve-trim-editor [data-modification-dialog]')).not.toBeVisible()
  expect((await state(page)).objects).toEqual(before.objects)
  await clickWorld(page, [0, 10])
  await expect.poll(async () => (await state(page)).revision).toBe(before.revision + 1)
  const extended = await state(page), arc = extended.currentTarget
  expect(extended.count).toBe(before.count)
  expect(arc.id).toBe(before.original.id)
  expect(arc.handle).toBe(before.original.handle)
  expectStyleAndPlane(arc, before)
  expect(arcSweep(arc.payload)).toBeCloseTo(2 * Math.PI / 3, 10)
  expectArcPoint(arc.payload, 0, [10, 0])
  expectArcPoint(arc.payload, 1, [-5, Math.sqrt(75)])
  await verifyUndoRedoAndReopen(page, before, extended)
})
