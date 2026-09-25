import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

async function sourceFile({ withBlock = false, locked = false } = {}) {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'block-reuse-ui', units: 'millimeter' })
  await drawing.transact('sources', tx => {
    tx.createEntity('LINE', { start: [0, 0], end: [30, 0] }, { id: 'source-line' })
    tx.createEntity('CIRCLE', { center: [15, 10], radius: 4 }, { id: 'source-circle' })
  })
  if (withBlock) await sdk.executeCommand('BLOCKCREATE', { name: 'FRAME_TAGGED', ids: ['source-line', 'source-circle'], basePoint: [0, 0], attributeDefinitions: [{ tag: 'MARK', defaultValue: 'F-001', position: [2, 2], height: 2 }] }, { document: drawing })
  if (locked) await sdk.executeCommand('LAYERUPDATE', { id: drawing.getTable('layers').currentId, patch: { locked: true } }, { document: drawing })
  return Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' }))
}

async function savedDrawing(page) {
  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  const pending = page.waitForEvent('download')
  await page.locator('#save').click()
  const bytes = await readFile(await (await pending).path())
  const project = await KJProjectSession.open(bytes, { sdk: createKJDrawSDK() })
  const drawing = project.activeDocument
  return { project, drawing }
}

function blockInstances(drawing) {
  return [...drawing.listEntities({ ownerId: drawing.snapshot().spaces.modelSpaceId, type: 'INSERT' })].sort((a, b) => Number(a.payload.position[0]) - Number(b.payload.position[0]))
}

function attributeText(drawing, instance) {
  return drawing.getObject(instance.payload.attributeIds[0]).payload.text
}

test('Playground reuses a native block through one undoable BLOCKINSERT and round-trips KJD/DXF', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kjdraw.language', 'en'))
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'source.kjd', mimeType: 'application/json', buffer: await sourceFile() })
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await page.getByRole('button', { name: 'DRAW', exact: true }).click()
  await expect(page.locator('#block-insert')).toBeDisabled()
  await expect(page.locator('#block-insert')).toHaveAttribute('title', 'No reusable block definitions exist in this drawing.')

  await page.keyboard.press('Control+a')
  await page.locator('#block-create').click()
  await page.locator('#dialog-fields [name=name]').fill('FRAME_TAGGED')
  await page.locator('#dialog-fields [name=attributes]').fill('MARK=F-001')
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#status')).toContainText('BLOCKCREATE committed')
  await expect(page.locator('#block-insert')).toBeEnabled()
  const revision = Number((await page.locator('#revision').textContent()).replace('REV ', ''))

  await page.locator('#block-insert').click()
  await expect(page.locator('#dialog-fields [name=blockRecordId] option')).toHaveText('FRAME_TAGGED')
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#dialog-fields [name=attribute_0]')).toHaveValue('F-001')
  await page.locator('#dialog-fields [name=position]').fill('60, 20')
  await page.locator('#dialog-fields [name=scaleX]').fill('2')
  await page.locator('#dialog-fields [name=scaleY]').fill('1.5')
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#dialog-error')).toContainText('cannot use different X and Y scales')
  await expect(page.locator('#revision')).toHaveText(`REV ${revision}`)
  await page.locator('#dialog-fields [name=scaleY]').fill('2')
  await page.locator('#dialog-fields [name=rotation]').fill('30')
  await page.locator('#dialog-fields [name=attribute_0]').fill('F-002')
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#status')).toContainText('BLOCKINSERT committed')
  await expect(page.locator('#revision')).toHaveText(`REV ${revision + 1}`)
  await expect(page.locator('#inspector [data-block-attribute=MARK]')).toHaveValue('F-002')

  let saved = await savedDrawing(page)
  let instances = blockInstances(saved.drawing)
  expect(instances).toHaveLength(2)
  expect(instances.map(instance => instance.payload.position.slice(0, 2))).toEqual([[0, 0], [60, 20]])
  expect(instances[0].payload.blockRecordId).toBe(instances[1].payload.blockRecordId)
  expect(instances[1].payload.scale).toEqual([2, 2, 1])
  expect(instances[1].payload.rotation).toBeCloseTo(Math.PI / 6)
  expect(instances.map(instance => attributeText(saved.drawing, instance))).toEqual(['F-001', 'F-002'])
  saved.project.destroy()

  await page.locator('#inspector [data-block-attribute=MARK]').fill('F-009')
  await page.getByRole('button', { name: 'Apply properties', exact: true }).click()
  await expect(page.locator('#status')).toContainText('BLOCKINSTANCEUPDATE committed')
  await page.locator('#undo').click()
  await expect(page.locator('#inspector [data-block-attribute=MARK]')).toHaveValue('F-002')
  await page.locator('#redo').click()
  await expect(page.locator('#inspector [data-block-attribute=MARK]')).toHaveValue('F-009')

  saved = await savedDrawing(page)
  instances = blockInstances(saved.drawing)
  expect(instances.map(instance => attributeText(saved.drawing, instance))).toEqual(['F-001', 'F-009'])
  for (const format of ['KJD', 'DXF']) {
    const bytes = await createKJDrawSDK().writeDocument(saved.drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await createKJDrawSDK().readDocument(bytes, { format })
    const reopenedInstances = blockInstances(reopened)
    expect(reopenedInstances).toHaveLength(2)
    expect(reopenedInstances.map(instance => attributeText(reopened, instance))).toEqual(['F-001', 'F-009'])
    expect(reopenedInstances[1].payload.position.slice(0, 2)).toEqual([60, 20])
    expect(reopenedInstances[1].payload.scale.slice(0, 2)).toEqual([2, 2])
  }
  saved.project.destroy()

  await page.locator('#undo').click()
  await page.locator('#undo').click()
  saved = await savedDrawing(page)
  expect(blockInstances(saved.drawing)).toHaveLength(1)
  saved.project.destroy()
  await page.locator('#redo').click()
  await page.locator('#redo').click()
  saved = await savedDrawing(page)
  expect(blockInstances(saved.drawing)).toHaveLength(2)
  expect(blockInstances(saved.drawing).map(instance => attributeText(saved.drawing, instance))).toEqual(['F-001', 'F-009'])
  saved.project.destroy()
})

test('Playground blocks insertion on a locked current layer and exposes Chinese labels', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kjdraw.language', 'zh'))
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'locked.kjd', mimeType: 'application/json', buffer: await sourceFile({ withBlock: true, locked: true }) })
  await expect(page.locator('#file-state')).toContainText('已在本地打开')
  await page.getByRole('button', { name: '绘图', exact: true }).click()
  await expect(page.locator('#block-insert')).toHaveText('插入已有块')
  await expect(page.locator('#block-insert')).toBeDisabled()
  await expect(page.locator('#block-insert')).toHaveAttribute('title', '当前图层已隐藏、冻结或锁定；请先切换到可编辑图层。')
  await page.locator('#toggle-layers').click()
  await page.locator('#layers .layer-lock').first().click()
  await expect(page.locator('#block-insert')).toBeEnabled()
  await page.locator('#block-insert').click()
  await expect(page.locator('#dialog-fields label')).toContainText(['块定义'])
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#dialog-fields label').first()).toContainText('插入点 X, Y')
  await page.keyboard.press('Escape')
  await expect(page.locator('#dialog-title')).not.toBeVisible()
})
