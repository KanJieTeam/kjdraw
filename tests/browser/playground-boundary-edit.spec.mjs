import { test, expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

async function fixture(page, operation = 'trim') {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: `boundary-${operation}`, title: 'Continuous boundary editing', units: 'millimeter' })
  await drawing.transact('Boundary editing fixture', tx => {
    const parts = tx.upsertTableRecord('layers', { name: 'Parts', type: 'LAYER', payload: { color: 2, visible: true } })
    const reference = tx.upsertTableRecord('layers', { name: 'Reference', type: 'LAYER', payload: { color: 4, visible: true, locked: true } })
    for (const [id, y] of [['target-a', 0], ['target-b', 20]]) tx.createEntity('LINE', { start: [0, y, 6], end: [operation === 'trim' ? 100 : 20, y, 6], layerId: parts.id, color: 2, lineweight: 35, linetypeScale: 1.5 }, { id })
    tx.createEntity('LINE', { start: [70, -30, 6], end: [70, 50, 6], layerId: reference.id }, { id: 'boundary-right' })
    if (operation === 'trim') tx.createEntity('LINE', { start: [30, -30, 6], end: [30, 50, 6] }, { id: 'boundary-left' })
    tx.createEntity('CIRCLE', { center: [10, 65, 6], radius: 5 }, { id: 'uncut-circle' })
    tx.createEntity('LINE', { start: [0, 40, 6], end: [100, 40, 6], layerId: reference.id }, { id: 'protected-target' })
    // Visible fixed extents keep the camera stable while target lengths change.
    tx.createEntity('POINT', { position: [-20, -40, 6], layerId: reference.id }, { id: 'extent-min' })
    tx.createEntity('POINT', { position: [120, 100, 6], layerId: reference.id }, { id: 'extent-max' })
  })
  const buffer = Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' }))
  await page.setViewportSize({ width: 1440, height: 960 }); await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'continuous.kjd', mimeType: 'application/json', buffer })
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
  return { buffer, original: (await save(page)).snapshot }
}
async function at(page, x, y) {
  const box = await page.locator('#canvas').boundingBox(), scale = Math.min((box.width - 164) / 140, (box.height - 164) / 140)
  return { x: box.x + box.width / 2 + (x - 50) * scale, y: box.y + box.height / 2 - (y - 30) * scale }
}
async function click(page, x, y) { const point = await at(page, x, y); await page.mouse.click(point.x, point.y); await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false') }
async function command(page, text) {
  await page.locator('#command-input').fill(text); await page.locator('#command-input').press('Enter')
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
}
async function save(page) {
  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  const pending = page.waitForEvent('download'); await page.locator('#save').click()
  const bytes = await readFile(await (await pending).path()), project = await KJProjectSession.open(bytes, { sdk: createKJDrawSDK() }), snapshot = project.activeDocument.snapshot()
  project.destroy(); return { bytes, snapshot }
}
async function selectBoundaries(page, operation = 'trim') {
  await page.keyboard.press('Escape'); await click(page, 105, 75)
  await command(page, operation.toUpperCase())
  await expect(page.locator('.workbench')).toHaveAttribute('data-boundary-edit', 'boundaries')
  if (operation === 'trim') await click(page, 30, -15)
  await click(page, 70, -15)
}
async function reopen(page, saved) {
  await page.locator('#file-input').setInputFiles({ name: 'continuous.kjp', mimeType: 'application/zip', buffer: saved.bytes })
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  expect((await save(page)).snapshot.objects).toEqual(saved.snapshot.objects)
}
function parts(snapshot, y) {
  return Object.values(snapshot.objects).filter(entity => entity.kind === 'entity' && entity.type === 'LINE' && entity.payload.start[1] === y)
    .sort((a, b) => a.payload.start[0] - b.payload.start[0])
}
function expectTrim(snapshot, y) {
  const pieces = parts(snapshot, y)
  expect(pieces.map(entity => [entity.payload.start, entity.payload.end])).toEqual([[[0, y, 6], [30, y, 6]], [[70, y, 6], [100, y, 6]]])
  for (const entity of pieces) expect(entity.payload).toMatchObject({ color: 2, lineweight: 35, linetypeScale: 1.5 })
}

test('boundaries-first TRIM retries errors, edits multiple targets and undoes one edit at a time', async ({ page }, testInfo) => {
  const { original } = await fixture(page), revision = Number((await page.locator('#revision').textContent()).replace('REV ', ''))
  await selectBoundaries(page)
  // A locked reference is a valid read-only boundary; selecting never edits it.
  await expect(page.locator('#boundary-edit-count')).toHaveText('2 boundaries · 0 edits')
  await page.keyboard.down('Control'); await click(page, 30, -15); await page.keyboard.up('Control')
  await expect(page.locator('#boundary-edit-count')).toHaveText('1 boundary · 0 edits')
  await page.keyboard.down('Shift'); await click(page, 30, -15); await page.keyboard.up('Shift')
  await page.keyboard.press('Enter')
  await expect(page.locator('.workbench')).toHaveAttribute('data-boundary-edit', 'targets')
  await click(page, 105, 75); await expect(page.locator('#status')).toContainText('No target found')
  await click(page, 15, 65); await expect(page.locator('#status')).toContainText('Cannot trim here')
  await click(page, 50, 40); await expect(page.locator('#status')).toContainText('unlock')
  await expect(page.locator('#revision')).toHaveText(`REV ${revision}`)
  await expect(page.locator('.workbench')).toHaveAttribute('data-boundary-edit', 'targets')
  await click(page, 50, 0); await expect(page.locator('#revision')).toHaveText(`REV ${revision + 1}`)
  const beforeHover=await page.locator('#canvas').evaluate(canvas=>canvas.toDataURL()),hover=await at(page,50,20)
  await page.mouse.move(hover.x,hover.y)
  await expect.poll(()=>page.locator('#canvas').evaluate(canvas=>canvas.toDataURL())).not.toBe(beforeHover)
  await expect(page.locator('#revision')).toHaveText(`REV ${revision + 1}`)
  await page.locator('.ribbon-tabs').hover()
  await expect.poll(()=>page.locator('#canvas').evaluate(canvas=>canvas.toDataURL())).toBe(beforeHover)
  await expect(page.locator('.workbench')).toHaveAttribute('data-boundary-edit','targets')
  await expect(page.locator('#revision')).toHaveText(`REV ${revision + 1}`)
  await page.mouse.move(hover.x,hover.y)
  await expect.poll(()=>page.locator('#canvas').evaluate(canvas=>canvas.toDataURL())).not.toBe(beforeHover)
  if(testInfo.project.name==='chromium'){
    await mkdir('.cache/boundary-demo-results',{recursive:true})
    await page.screenshot({path:'.cache/boundary-demo-results/boundary-trim-preview.png'})
  }
  await click(page, 50, 20); await expect(page.locator('#revision')).toHaveText(`REV ${revision + 2}`)
  await expect(page.locator('#boundary-edit-count')).toHaveText('2 boundaries · 2 edits')
  expect(await page.locator('.workbench').getAttribute('data-last-error')).toBeNull()
  const edited = await save(page); expectTrim(edited.snapshot, 0); expectTrim(edited.snapshot, 20)
  for (const id of ['boundary-left', 'boundary-right', 'protected-target', 'uncut-circle']) expect(edited.snapshot.objects[id]).toEqual(original.objects[id])
  await page.locator('#undo').click(); await expect(page.locator('#boundary-edit-controls')).toBeHidden()
  const undone = await save(page); expectTrim(undone.snapshot, 0); expect(undone.snapshot.objects['target-b']).toEqual(original.objects['target-b'])
  await page.locator('#redo').click(); expect((await save(page)).snapshot.objects).toEqual(edited.snapshot.objects)
  await reopen(page, edited)
})

test('boundaries-first EXTEND applies separate edits and supports confirm and finish buttons', async ({ page }) => {
  const { original } = await fixture(page, 'extend')
  await selectBoundaries(page, 'extend'); await page.locator('#boundary-edit-confirm').click()
  await click(page, 15, 0); await click(page, 15, 20)
  await expect(page.locator('#boundary-edit-count')).toHaveText('1 boundary · 2 edits')
  await page.locator('#boundary-edit-finish').click(); await expect(page.locator('#boundary-edit-controls')).toBeHidden()
  const edited = await save(page)
  for (const [id, y] of [['target-a', 0], ['target-b', 20]]) expect(edited.snapshot.objects[id].payload).toMatchObject({ start: [0, y, 6], end: [70, y, 6], color: 2, lineweight: 35, linetypeScale: 1.5 })
  expect(edited.snapshot.objects['boundary-right']).toEqual(original.objects['boundary-right'])
  await page.locator('#undo').click(); expect((await save(page)).snapshot.objects['target-b']).toEqual(original.objects['target-b'])
  await page.locator('#redo').click(); expect((await save(page)).snapshot.objects).toEqual(edited.snapshot.objects)
  await reopen(page, edited)
})

test('modification menu exposes working mode while preserving preselected single-operation editing', async ({ page }) => {
  await fixture(page)
  // Only editable objects are preselected; this single operation uses the left boundary.
  await click(page, 10, 0); await page.keyboard.down('Shift'); await click(page, 30, -15); await page.keyboard.up('Shift')
  await page.locator('.ribbon-tabs [data-i18n="modify"]').click(); await page.locator('#modification-tool').selectOption('trim')
  await expect(page.locator('#app-dialog')).toBeVisible(); await expect(page.locator('#dialog-fields select[name="mode"]')).toHaveValue('single')
  await page.locator('#dialog-submit').click(); await click(page, 10, 0)
  const edited = await save(page)
  expect(parts(edited.snapshot, 0).map(entity => [entity.payload.start, entity.payload.end])).toEqual([[[30, 0, 6], [100, 0, 6]]])
  expect(await page.locator('.workbench').getAttribute('data-boundary-edit')).toBeNull()
  await page.keyboard.press('Escape'); await click(page, 105, 75)
  await page.locator('.ribbon-tabs [data-i18n="modify"]').click(); await page.locator('#modification-tool').selectOption('extend')
  await expect(page.locator('#dialog-fields select[name="mode"]')).toHaveValue('continuous')
  await page.locator('#dialog-submit').click(); await expect(page.locator('.workbench')).toHaveAttribute('data-boundary-edit', 'boundaries')
})

test('boundary selection supports window selection and language changes preserve the active session', async ({ page }) => {
  const { original } = await fixture(page)
  await command(page, 'TRIM')
  const first = await at(page, 26, 54), last = await at(page, 74, -34)
  await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.mouse.move(last.x, last.y, { steps: 8 }); await page.mouse.up()
  await expect(page.locator('#boundary-edit-count')).toHaveText('2 boundaries · 0 edits')
  await page.locator('#language').click(); await expect(page.locator('#boundary-edit-confirm')).toHaveText('确认边界 ↵')
  await expect(page.locator('#hint')).toContainText('选择边界（2）')
  await page.locator('#boundary-edit-confirm').click(); await page.locator('#language').click()
  await expect(page.locator('.workbench')).toHaveAttribute('data-boundary-edit', 'targets')
  await expect(page.locator('#hint')).toContainText('each portion to remove')
  await command(page, ''); await expect(page.locator('#boundary-edit-controls')).toBeHidden()
  expect((await save(page)).snapshot.objects).toEqual(original.objects)
})

test('target gestures cannot move selected boundaries or grab grips, and layout changes safely cancel', async ({ page }) => {
  const { original } = await fixture(page)
  await selectBoundaries(page); await page.locator('#boundary-edit-confirm').click()
  const first = await at(page, 50, 0), last = await at(page, 60, 8)
  await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.mouse.move(last.x, last.y, { steps: 8 }); await page.mouse.up()
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  const edited = await save(page); expectTrim(edited.snapshot, 0)
  expect(edited.snapshot.objects['boundary-left']).toEqual(original.objects['boundary-left'])
  expect(edited.snapshot.objects['boundary-right']).toEqual(original.objects['boundary-right'])
  expect(await page.locator('.workbench').getAttribute('data-grip')).toBeNull()
  await page.locator('#layout-select').selectOption('compact')
  await expect(page.locator('#boundary-edit-controls')).toBeHidden()
  expect((await save(page)).snapshot.objects).toEqual(edited.snapshot.objects)
})

test('Escape, cancellation, document replacement and external revisions end boundary editing without extra edits', async ({ page }) => {
  const { buffer, original } = await fixture(page)
  await command(page, 'TRIM'); await page.locator('#boundary-edit-confirm').click()
  await expect(page.locator('#status')).toContainText('Select at least one cutting boundary')
  await expect(page.locator('.workbench')).toHaveAttribute('data-boundary-edit', 'boundaries')
  await page.keyboard.press('Escape'); await expect(page.locator('#boundary-edit-controls')).toBeHidden()
  await selectBoundaries(page); await page.locator('#boundary-edit-cancel').click()
  expect((await save(page)).snapshot.objects).toEqual(original.objects)
  await command(page, 'EXTEND'); await page.locator('#file-input').setInputFiles({ name: 'replacement.kjd', mimeType: 'application/json', buffer })
  await expect(page.locator('#file-state')).toContainText('Opened locally'); await expect(page.locator('#boundary-edit-controls')).toBeHidden()
  await selectBoundaries(page); await page.locator('#boundary-edit-confirm').click()
  if (!(await page.locator('.workbench').getAttribute('class')).includes('layers-open')) await page.locator('#toggle-layers').click()
  await page.locator('.layer[data-layer-name="Reference"]').getByRole('button', { name: 'Unlock layer · Reference', exact: true }).click()
  await expect(page.locator('#boundary-edit-controls')).toBeHidden()
  const changed = await save(page)
  for (const id of ['target-a', 'target-b', 'boundary-left', 'boundary-right']) expect(changed.snapshot.objects[id]).toEqual(original.objects[id])
})
