import { test, expect } from '@playwright/test'

test.use({ bypassCSP: true })

async function mount(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div')
    host.id = 'associative-workbench'
    host.style.cssText = 'width:1100px;height:760px'
    document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    await drawing.transact('Dimension sources', transaction => {
      transaction.createEntity('LINE', { start: [-30, -20, 0], end: [-10, -20, 0] }, { id: 'linear-source' })
      transaction.createEntity('LINE', { start: [-15, -26, 0], end: [-15, -6, 0] }, { id: 'trim-boundary' })
      transaction.createEntity('CIRCLE', { center: [20, -15, 0], radius: 6 }, { id: 'circle-source' })
      transaction.createEntity('LINE', { start: [-5, 15, 0], end: [5, 15, 0] }, { id: 'ray-a' })
      transaction.createEntity('LINE', { start: [-5, 15, 0], end: [-5, 25, 0] }, { id: 'ray-b' })
    })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing })
    await workbench.ready
    workbench.renderer.resize()
    Object.assign(workbench.renderer.camera, { centerX: 0, centerY: 0, scale: 10 })
    workbench.renderer.render()
    window.associativeDimension = { sdk, drawing, workbench }
  })
}

async function command(page, value) {
  const input = page.locator('#associative-workbench [data-command]')
  await input.fill(value)
  await input.press('Enter')
  await expect(input).toHaveValue('')
}

async function clickWorld(page, world) {
  const position = await page.evaluate(world => {
    const { workbench } = window.associativeDimension
    const bounds = workbench.root.querySelector('[data-canvas]').getBoundingClientRect()
    const point = workbench.renderer.worldToScreen(world)
    return { x: bounds.left + point[0], y: bounds.top + point[1] }
  }, world)
  await page.mouse.click(position.x, position.y)
}

async function drawDimension(page, commandName, points, expectedCount) {
  await command(page, commandName)
  for (const point of points) await clickWorld(page, point)
  await expect.poll(() => page.evaluate(() => window.associativeDimension.drawing.listEntities({ type: 'DIMENSION' }).length)).toBe(expectedCount)
  await page.keyboard.press('Escape')
}

test('pointer-created native dimensions capture supported snap references and roll back cancelled or invalid input', async ({ page }) => {
  await mount(page)
  await drawDimension(page, 'DIMALIGNED', [[-30, -20], [-10, -20], [-20, -14]], 1)
  await drawDimension(page, 'DIMLINEAR', [[-30, -20], [-10, -20], [-20, -10]], 2)
  await drawDimension(page, 'DIMRADIUS', [[20, -15], [26, -15]], 3)
  await drawDimension(page, 'DIMDIAMETER', [[14, -15], [26, -15]], 4)
  await drawDimension(page, 'DIMANGULAR3P', [[-5, 15], [5, 15], [-5, 25], [0, 20]], 5)

  const captured = await page.evaluate(() => window.associativeDimension.drawing.listEntities({ type: 'DIMENSION' }).map(entity => ({
    id: entity.id, type: entity.payload.dimensionType, associations: entity.payload.dimensionAssociations,
  })))
  expect(captured.map(item => [item.type, item.associations.length])).toEqual([
    ['ALIGNED', 2], ['ROTATED', 2], ['RADIUS', 2], ['DIAMETER', 2], ['ANGULAR_3_POINT', 3],
  ])
  expect(captured[0].associations).toEqual([
    { definitionPointIndex: 1, entityId: 'linear-source', feature: 'start' },
    { definitionPointIndex: 2, entityId: 'linear-source', feature: 'end' },
  ])
  expect(captured[2].associations.every(item => item.entityId === 'circle-source')).toBe(true)
  expect(captured[4].associations.map(item => item.definitionPointIndex).sort()).toEqual([1, 2, 3])

  const beforeCancel = await page.evaluate(() => window.associativeDimension.drawing.listEntities({ type: 'DIMENSION' }).length)
  await command(page, 'DIMALIGNED')
  await clickWorld(page, [-30, -20])
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.associativeDimension.drawing.listEntities({ type: 'DIMENSION' }).length)).toBe(beforeCancel)
  await command(page, 'DIMALIGNED')
  await clickWorld(page, [-30, -20])
  await clickWorld(page, [-30, -20])
  await page.waitForTimeout(50)
  expect(await page.evaluate(() => window.associativeDimension.drawing.listEntities({ type: 'DIMENSION' }).length)).toBe(beforeCancel)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.associativeDimension.drawing.listEntities({ type: 'DIMENSION' }).length)).toBe(beforeCancel)
})

test('workbench boundary TRIM refreshes a pointer-associated dimension in the same undoable commit', async ({ page }) => {
  await mount(page)
  await drawDimension(page, 'DIMALIGNED', [[-30, -20], [-10, -20], [-20, -14]], 1)
  const before = await page.evaluate(() => {
    const { drawing } = window.associativeDimension
    const dimension = drawing.listEntities({ type: 'DIMENSION' })[0]
    return { revision: drawing.revision, dimensionId: dimension.id, dimensionHandle: dimension.handle }
  })
  const root = '#associative-workbench'
  await page.locator(root + ' [data-action="modify"]').click()
  await page.locator(root + ' [data-modification]').selectOption('trim')
  await page.locator(root + ' [data-boundary-workflow]').selectOption('boundaries')
  await page.locator(root + ' [data-action="start-modification"]').click()
  await clickWorld(page, [-15, -8])
  await page.locator(root + ' [data-action="boundary-confirm"]').click()
  await expect(page.locator(root + ' [data-boundary-actions]')).toHaveAttribute('data-boundary-stage', 'targets')
  await clickWorld(page, [-12, -20])
  await expect.poll(() => page.evaluate(() => window.associativeDimension.drawing.revision)).toBe(before.revision + 1)
  const changed = await page.evaluate(() => {
    const { drawing } = window.associativeDimension
    const line = drawing.getObject('linear-source'), dimension = drawing.listEntities({ type: 'DIMENSION' })[0]
    const a = dimension.payload.definitionPoints[1], b = dimension.payload.definitionPoints[2]
    return { lineEnd: line.payload.end, dimensionId: dimension.id, dimensionHandle: dimension.handle, measurement: Math.hypot(b[0] - a[0], b[1] - a[1]) }
  })
  expect(changed).toEqual({ lineEnd: [-15, -20, 0], dimensionId: before.dimensionId, dimensionHandle: before.dimensionHandle, measurement: 15 })
  await page.keyboard.press('Escape')
  await expect(page.locator(root + ' [data-boundary-actions]')).toBeHidden()
})
