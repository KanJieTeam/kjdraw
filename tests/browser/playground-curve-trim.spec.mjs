import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'
import { arcSweep } from '../../packages/kjdraw-sdk/src/geometry/measure.js'

async function openCircleFixture(page) {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'demo-circle-trim', title: 'Elevated circular profile', units: 'millimeter' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Curve parts', color: 3 }, { document: drawing })
  const target = await sdk.executeCommand('CREATE', { type: 'CIRCLE', options: { name: 'Elevated circle' }, payload: {
    center: [0, 0, 6], radius: 10, layerId: layer.id, color: 2, lineweight: 35, linetypeScale: 1.5,
  } }, { document: drawing })
  const boundary = await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
    start: [-15, 0, 6], end: [15, 0, 6],
  } }, { document: drawing })
  const content = await sdk.writeDocument(drawing, { format: 'KJD' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'circle-trim.kjd', mimeType: 'application/json', buffer: Buffer.from(content) })
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
  await page.locator('#nav-fit').click()
  return { target, boundary, layer }
}

async function screen(page, x, y) {
  // The uploaded fixture has bounds [-15,-10]..[15,10]; the Demo's public Fit
  // uses 82 CSS pixels of padding on each side. No browser SDK state is read.
  const box = await page.locator('#canvas').boundingBox()
  const scale = Math.min((box.width - 164) / 30, (box.height - 164) / 20)
  return { x: box.x + box.width / 2 + x * scale, y: box.y + box.height / 2 - y * scale }
}

async function clickWorld(page, x, y) {
  const p = await screen(page, x, y)
  await page.mouse.click(p.x, p.y)
}

async function beginTrim(page) {
  // Cancelling a tool preserves the CAD selection; clear it with a real empty-space click.
  await clickWorld(page, 0, -5)
  await expect(page.locator('#selection-count')).toHaveText('0 selected')
  await clickWorld(page, 0, 10)
  await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await expect(page.locator('#inspector h3')).toHaveText('CIRCLE')
  await page.keyboard.down('Shift')
  await clickWorld(page, -12, 0)
  await page.keyboard.up('Shift')
  await expect(page.locator('#selection-count')).toHaveText('2 selected')
  await page.locator('.ribbon-tabs [data-i18n="modify"]').click()
  await page.locator('#modification-tool').selectOption('trim')
  await expect(page.locator('#app-dialog')).toBeVisible()
  await expect(page.locator('#dialog-fields select[name="mode"]')).toHaveValue('single')
  await page.locator('#dialog-submit').click()
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('#hint')).toContainText('Trim')
  expect(await page.locator('.workbench').getAttribute('data-last-error')).toBeNull()
}

async function save(page) {
  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  const pending = page.waitForEvent('download')
  await page.locator('#save').click()
  const bytes = await readFile(await (await pending).path())
  const session = await KJProjectSession.open(bytes, { sdk: createKJDrawSDK() })
  const snapshot = session.activeDocument.snapshot()
  session.destroy()
  return { bytes, snapshot, entities: Object.values(snapshot.objects).filter(entity => entity.kind === 'entity' && !entity.erased) }
}

function expectLowerArc(saved, fixture) {
  const { target, boundary, layer } = fixture
  const arcs = saved.entities.filter(entity => entity.type === 'ARC')
  expect(saved.entities).toHaveLength(2)
  expect(saved.entities.some(entity => entity.id === target.id)).toBe(false)
  expect(saved.snapshot.objects[target.id]).toEqual({ ...target, erased: true })
  expect(arcs).toHaveLength(1)
  const arc = arcs[0]
  expect(arc.id).not.toBe(target.id)
  expect(arc.handle).not.toBe(target.handle)
  expect(arc.source).toMatchObject({ derivedFromId: target.id, derivedFromHandle: target.handle })
  expect(arc.ownerId).toBe(target.ownerId)
  expect(arc.name).toBe(target.name)
  expect(arc.payload).toMatchObject({ center: [0, 0, 6], radius: 10, layerId: layer.id, color: 2, lineweight: 35, linetypeScale: 1.5 })
  const sweep = arcSweep(arc.payload), middle = arc.payload.startAngle + sweep / 2
  expect(Math.abs(sweep)).toBeCloseTo(Math.PI, 10)
  expect(Math.cos(middle) * 10).toBeCloseTo(0, 9)
  expect(Math.sin(middle) * 10).toBeCloseTo(-10, 9)
  for (const angle of [arc.payload.startAngle, arc.payload.startAngle + sweep]) {
    expect(Math.abs(Math.cos(angle) * 10)).toBeCloseTo(10, 9)
    expect(Math.sin(angle) * 10).toBeCloseTo(0, 9)
  }
  expect(saved.snapshot.objects[boundary.id]).toEqual(boundary)
  return arc
}

async function verifyHistoryAndReopen(page, original, result) {
  await page.locator('#undo').click()
  expect((await save(page)).snapshot.objects).toEqual(original.snapshot.objects)
  await page.locator('#redo').click()
  expect((await save(page)).snapshot.objects).toEqual(result.snapshot.objects)
  await page.locator('#file-input').setInputFiles({ name: 'trimmed-curves.kjp', mimeType: 'application/zip', buffer: result.bytes })
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  expect((await save(page)).snapshot.objects).toEqual(result.snapshot.objects)
}

test('Demo trims a real uploaded circle into the lower styled elevated ARC and preserves one-step history and KJP reopen', async ({ page }) => {
  const fixture = await openCircleFixture(page), original = await save(page)
  const revision = Number((await page.locator('#revision').textContent()).replace(/\D/g, ''))
  await beginTrim(page)
  await clickWorld(page, 0, 10)
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('#inspector h3')).toHaveText('ARC')
  const result = await save(page)
  expectLowerArc(result, fixture)
  expect(result.snapshot.revision).toBe(original.snapshot.revision + 1)
  expect(Number((await page.locator('#revision').textContent()).replace(/\D/g, ''))).toBe(revision + 1)
  await verifyHistoryAndReopen(page, original, result)
})

test('Demo circle trim cancels before its pick and lets an exact-cut failure retry without rearming the tool', async ({ page }) => {
  const fixture = await openCircleFixture(page), original = await save(page)
  const revision = await page.locator('#revision').textContent()
  await beginTrim(page)
  const hover = await screen(page, 0, 10)
  await page.mouse.move(hover.x, hover.y)
  await expect(page.locator('#revision')).toHaveText(revision)
  await page.keyboard.press('Escape')
  await expect(page.locator('#revision')).toHaveText(revision)
  expect((await save(page)).snapshot.objects).toEqual(original.snapshot.objects)

  await beginTrim(page)
  // Exact coordinates avoid pixel rounding accidentally turning this ambiguous
  // boundary pick into a valid interval pick. The user supplies the input normally.
  await page.locator('#command-input').fill('10,0')
  await page.locator('#command-input').press('Enter')
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.workbench')).toHaveAttribute('data-last-error', /cutting boundary/i)
  await expect(page.locator('#revision')).toHaveText(revision)
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  // No command or selection restart here: the failed task must accept a fresh pick.
  await clickWorld(page, 0, 10)
  await expect(page.locator('#inspector h3')).toHaveText('ARC')
  const result = await save(page)
  expectLowerArc(result, fixture)
  expect(result.snapshot.revision).toBe(original.snapshot.revision + 1)
  await verifyHistoryAndReopen(page, original, result)
})
