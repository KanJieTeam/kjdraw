import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  KJDRAW_MANUFACTURING_SHEET_VERSION,
  KJProjectSession,
  buildAgentManufacturingSheet,
  createKJDrawSDK,
  exportDrawingSvg,
} from '../../packages/kjdraw-sdk/src/index.js'

const sheet = {
  version: KJDRAW_MANUFACTURING_SHEET_VERSION,
  expectedRevision: 0,
  units: 'millimeter',
  drawingId: 'UI-PRODUCTION-001',
  title: 'CNC FIXTURE PLATE',
  revision: 'A',
  material: '6061-T6 ALUMINUM',
  quantity: 2,
  length: 300,
  width: 180,
  thickness: 12,
  holePatterns: [
    { rows: 8, columns: 12, origin: [12.5, 15], spacing: [25, 21], throughDiameter: 5 },
    { rows: 2, columns: 2, origin: [20, 20], spacing: [260, 140], throughDiameter: 9, counterboreDiameter: 16, counterboreDepth: 6 },
  ],
  slots: [
    { center: [150, 90], length: 40, width: 10, orientationDegrees: 0 },
    { center: [80, 90], length: 30, width: 8, orientationDegrees: 90 },
  ],
  sheet: { origin: [0, 0], size: [594, 420] },
  textHeight: 3.5,
}

const wire = (calls = [], text = '') => ({ choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: {
  role: 'assistant',
  content: text || null,
  tool_calls: calls.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })),
} }] })

async function manufacturingFixture() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'production-workflow-ui', title: sheet.title, units: sheet.units })
  const compiled = buildAgentManufacturingSheet(drawing, sheet)
  const outlineLayer = compiled.commandArgs.resources.layers.find(layer => layer.name === 'OUTLINE')
  const slotEdge = compiled.commandArgs.entities.find(entity => entity.type === 'LINE'
    && entity.payload.layerId === outlineLayer.id
    && entity.payload.start[1] === entity.payload.end[1]
    && Math.abs(entity.payload.end[0] - entity.payload.start[0]) === 30)
  if (!slotEdge) throw Error('Expected the horizontal 40 x 10 slot edge')
  return { blank: await sdk.writeDocument(drawing, { format: 'KJD' }), compiled, slotEdge, count: compiled.evidence.entityCount }
}

const rectangle = (id, layerId, x1, y1, x2, y2) => ({
  type: 'LWPOLYLINE',
  payload: { layerId, vertices: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], closed: true },
  options: { id },
})

async function architectureFixture() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'production-architecture-ui', title: 'Two-room office plan', units: 'millimeter' })
  const wall = await sdk.executeCommand('LAYERNEW', { name: 'A-WALL', color: 7, lineweight: 50 }, { document: drawing })
  const opening = await sdk.executeCommand('LAYERNEW', { name: 'A-OPENING', color: 1, lineweight: 25 }, { document: drawing })
  const windowLayer = await sdk.executeCommand('LAYERNEW', { name: 'A-WINDOW', color: 5, lineweight: 25 }, { document: drawing })
  await sdk.executeCommand('CREATEBATCH', { entities: [
    rectangle('wall-south-west', wall.id, 0, 0, 1200, 200),
    rectangle('wall-south-east', wall.id, 2100, 0, 10000, 200),
    rectangle('wall-north', wall.id, 0, 7800, 10000, 8000),
    rectangle('wall-west', wall.id, 0, 200, 200, 7800),
    rectangle('wall-east', wall.id, 9800, 200, 10000, 7800),
    rectangle('wall-partition-south', wall.id, 4900, 200, 5100, 3300),
    rectangle('wall-partition-north', wall.id, 4900, 4200, 5100, 7800),
    rectangle('room-101', opening.id, 200, 200, 4900, 7800),
    rectangle('room-102', opening.id, 5100, 200, 9800, 7800),
  ] }, { document: drawing })
  const doorMembers = await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'LINE', payload: { layerId: opening.id, start: [0, 0], end: [900, 0] }, options: { id: 'door-leaf' } },
    { type: 'ARC', payload: { layerId: opening.id, center: [0, 0], radius: 900, startAngle: 0, endAngle: Math.PI / 2 }, options: { id: 'door-swing' } },
  ] }, { document: drawing })
  const door = await sdk.executeCommand('BLOCKCREATE', { name: 'A-DOOR-0900', ids: doorMembers.map(entity => entity.id), basePoint: [0, 0] }, { document: drawing })
  await sdk.executeCommand('PROPERTIES', { id: door.insert.id, patch: { payload: { layerId: opening.id } } }, { document: drawing })
  await sdk.executeCommand('MOVE', { id: door.insert.id, dx: 1200, dy: 200 }, { document: drawing })
  await sdk.executeCommand('BLOCKINSERT', { name: 'A-DOOR-0900', position: [4900, 3300], rotation: Math.PI / 2, layerId: opening.id }, { document: drawing })
  const windowMembers = await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'LINE', payload: { layerId: windowLayer.id, start: [0, 0], end: [1500, 0] }, options: { id: 'window-frame-a' } },
    { type: 'LINE', payload: { layerId: windowLayer.id, start: [0, 200], end: [1500, 200] }, options: { id: 'window-frame-b' } },
    { type: 'LINE', payload: { layerId: windowLayer.id, start: [750, 0], end: [750, 200] }, options: { id: 'window-mullion' } },
  ] }, { document: drawing })
  const windowBlock = await sdk.executeCommand('BLOCKCREATE', { name: 'A-WINDOW-1500', ids: windowMembers.map(entity => entity.id), basePoint: [0, 0] }, { document: drawing })
  await sdk.executeCommand('ERASE', { ids: [windowBlock.insert.id] }, { document: drawing })
  await sdk.executeCommand('BLOCKINSERT', { name: 'A-WINDOW-1500', position: [3000, 7800], layerId: windowLayer.id }, { document: drawing })
  return { drawing, bytes: await sdk.writeDocument(drawing, { format: 'KJD' }), targetId: door.insert.id, targetPosition: [1200, 200, 0], bounds: [0, 0, 10000, 8000] }
}

async function siteFixture() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'production-site-ui', title: 'Utility coordination site plan', units: 'meter' })
  const boundary = await sdk.executeCommand('LAYERNEW', { name: 'C-BOUNDARY', color: 2, lineweight: 50 }, { document: drawing })
  const road = await sdk.executeCommand('LAYERNEW', { name: 'C-ROAD', color: 1, lineweight: 35 }, { document: drawing })
  const building = await sdk.executeCommand('LAYERNEW', { name: 'A-BUILDING', color: 3, lineweight: 50 }, { document: drawing })
  const water = await sdk.executeCommand('LAYERNEW', { name: 'U-WATER', color: 5, lineweight: 25 }, { document: drawing })
  await sdk.executeCommand('CREATEBATCH', { entities: [
    rectangle('site-boundary', boundary.id, 0, 0, 120, 80),
    { type: 'LWPOLYLINE', payload: { layerId: road.id, vertices: [[10, 40], [110, 40]] }, options: { id: 'road-centerline' } },
    { type: 'LWPOLYLINE', payload: { layerId: road.id, vertices: [[10, 35], [110, 35]] }, options: { id: 'road-edge-south' } },
    { type: 'LWPOLYLINE', payload: { layerId: road.id, vertices: [[10, 45], [110, 45]] }, options: { id: 'road-edge-north' } },
    rectangle('building-a', building.id, 25, 52, 45, 70),
    rectangle('building-b', building.id, 75, 10, 100, 28),
    { type: 'LWPOLYLINE', payload: { layerId: water.id, vertices: [[15, 20], [60, 30], [105, 20]] }, options: { id: 'water-main' } },
    { type: 'CIRCLE', payload: { layerId: water.id, center: [15, 20], radius: 1 }, options: { id: 'water-manhole-west' } },
    { type: 'CIRCLE', payload: { layerId: water.id, center: [105, 20], radius: 1 }, options: { id: 'water-manhole-east' } },
  ] }, { document: drawing })
  return { drawing, bytes: await sdk.writeDocument(drawing, { format: 'KJD' }), roadIds: ['road-centerline', 'road-edge-south', 'road-edge-north'], bounds: [0, 0, 120, 80] }
}

async function saveProject(page) {
  const pending = page.waitForEvent('download')
  await page.locator('#save').click()
  const download = await pending
  const bytes = await readFile(await download.path())
  const project = await KJProjectSession.open(bytes, { sdk: createKJDrawSDK() })
  return { bytes, project }
}

async function screenPoint(page, point, bounds = [0, 0, sheet.sheet.size[0], sheet.sheet.size[1]]) {
  const box = await page.locator('#canvas').boundingBox()
  const width = bounds[2] - bounds[0], height = bounds[3] - bounds[1]
  const scale = Math.min((box.width - 164) / width, (box.height - 164) / height)
  return {
    x: box.x + box.width / 2 + (point[0] - (bounds[0] + bounds[2]) / 2) * scale,
    y: box.y + box.height / 2 - (point[1] - (bounds[1] + bounds[3]) / 2) * scale,
  }
}

async function openDrawing(page, name, bytes, expectedEntities) {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(bytes) })
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  await expect(page.locator('#entity-count')).toHaveText(`${expectedEntities} entities`)
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
}

async function openBlankChat(page, bytes) {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'blank-millimeter-drawing.kjd', mimeType: 'application/json', buffer: Buffer.from(bytes) })
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.locator('#agent-tab').click()
  await expect(page.locator('#chat-input')).toBeVisible()
}

async function connectFixtureTransport(page) {
  await page.getByRole('button', { name: 'Connect model', exact: true }).click()
  await page.locator('#chat-endpoint').fill('/api/model')
  await page.locator('#chat-model').fill('ui-contract-fixture')
  await page.locator('#chat-protocol').selectOption('chat-completions')
  await page.getByRole('button', { name: 'Use this connection', exact: true }).click()
}

test('public Playground builds a dense manufacturing sheet from one visible AI request, then edits, reopens and outputs it at 1:2', async ({ page }) => {
  const source = await manufacturingFixture(), targetId = source.slotEdge.options.id, requests = []
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openBlankChat(page, source.blank)
  // This deterministic transport response verifies the public AI/UI contract. It is not a model-quality or latency result.
  await page.route('**/api/model', route => {
    const body = route.request().postDataJSON()
    requests.push(body)
    expect(body.tools.map(tool => tool.function.name)).toContain('cad_propose_manufacturing_sheet')
    expect(body.messages.some(message => String(message.content).includes('8 by 12 precision hole grid'))).toBe(true)
    return route.fulfill({ json: wire([['manufacturing-sheet', 'cad_propose_manufacturing_sheet', sheet]], 'A complete editable fixture plate is ready for review.') })
  })
  await connectFixtureTransport(page)
  await page.locator('#chat-input').fill('Create a complete A2 CNC fixture-plate drawing with an 8 by 12 precision hole grid, four counterbored mounting holes, two slots, orthographic views, dimensions, layers, title block and machining notes.')
  await page.locator('#chat-send').click()
  const evidence = page.locator('.chat-manufacturing-evidence')
  await expect(evidence).toHaveAttribute('data-entity-count', String(source.count))
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.getByRole('button', { name: 'Preview on drawing', exact: true }).click()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('#entity-count')).toHaveText(`${source.count} entities`)
  expect(requests).toHaveLength(1)

  await page.locator('#fit-ribbon').click()
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
  const midpoint = [
    source.slotEdge.payload.start[0] + (source.slotEdge.payload.end[0] - source.slotEdge.payload.start[0]) * 0.25,
    source.slotEdge.payload.start[1],
  ]
  const screen = await screenPoint(page, midpoint)
  await page.mouse.click(screen.x, screen.y)
  await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await page.locator('#command-input').fill('MOVE 5 0')
  await page.locator('#command-input').press('Enter')
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')

  const movedSave = await saveProject(page), moved = movedSave.project.activeDocument
  expect(moved.listEntities()).toHaveLength(source.count)
  expect(moved.getObject(targetId).payload.start).toEqual([source.slotEdge.payload.start[0] + 5, source.slotEdge.payload.start[1], 0])
  expect(moved.getObject(targetId).payload.end).toEqual([source.slotEdge.payload.end[0] + 5, source.slotEdge.payload.end[1], 0])
  expect(moved.listEntities({ type: 'CIRCLE' })).toHaveLength(104)
  movedSave.project.destroy()

  await page.locator('#undo').click()
  const undoneSave = await saveProject(page)
  expect(undoneSave.project.activeDocument.getObject(targetId).payload.start).toEqual(source.slotEdge.payload.start)
  expect(undoneSave.project.activeDocument.getObject(targetId).payload.end).toEqual(source.slotEdge.payload.end)
  undoneSave.project.destroy()
  await page.locator('#redo').click()

  await page.locator('#file-input').setInputFiles({ name: 'fixture-plate-reviewed.kjp', mimeType: 'application/zip', buffer: movedSave.bytes })
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  await expect(page.locator('#entity-count')).toHaveText(`${source.count} entities`)

  await page.locator('#page-setup').click()
  for (const [name, value] of Object.entries({ width: 420, height: 297, margin: 10, denominator: 2, x0: 0, y0: 0, x1: 594, y1: 420 })) {
    await page.locator(`#dialog-fields [name="${name}"]`).fill(String(value))
  }
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#app-dialog')).not.toBeVisible()
  await expect(page.locator('#status')).toContainText('Page setup saved')

  const outputPending = page.waitForEvent('download')
  await page.locator('#export-svg').click()
  const output = await outputPending
  expect(output.suggestedFilename()).toBe('drawing.svg')
  const svg = await readFile(await output.path(), 'utf8')
  expect(svg).toContain('width="420mm"')
  expect(svg).toContain('height="297mm"')
  expect(svg).toContain(`data-entity-id="${targetId}"`)

  const finalSave = await saveProject(page), reopened = finalSave.project.activeDocument
  const modelLayout = reopened.snapshot().spaces.layoutIds
    .map(id => reopened.getObject(id))
    .find(layout => layout.payload.blockRecordId === reopened.snapshot().spaces.modelSpaceId)
  expect(modelLayout).toBeTruthy()
  expect(modelLayout.payload.dxfPlotSettings).toMatchObject({
    paperWidth: 420,
    paperHeight: 297,
    scaleNumerator: 1,
    scaleDenominator: 2,
    windowMinX: 0,
    windowMinY: 0,
    windowMaxX: 594,
    windowMaxY: 420,
  })
  const independent = exportDrawingSvg(reopened, { layoutId: modelLayout.id })
  expect(independent.paper.millimetersPerDrawingUnit).toBeCloseTo(0.5, 12)
  expect(independent.report.diagnostics).toEqual([])
  expect(reopened.getObject(targetId).payload.start[0]).toBe(source.slotEdge.payload.start[0] + 5)
  finalSave.project.destroy()
})

test('public Playground continues an imported architectural plan and preserves its reusable door through edit and reopen', async ({ page }) => {
  const source = await architectureFixture(), entityCount = source.drawing.listEntities().length
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openDrawing(page, 'two-room-office.kjd', source.bytes, entityCount)

  const doorPoint = await screenPoint(page, [1650, 200], source.bounds)
  await page.mouse.click(doorPoint.x, doorPoint.y)
  await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await expect(page.locator('#inspector')).toContainText('INSERT')
  await page.locator('#command-input').fill('MOVE 200 0')
  await page.locator('#command-input').press('Enter')
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')

  const movedSave = await saveProject(page), moved = movedSave.project.activeDocument
  expect(moved.getObject(source.targetId).payload.position).toEqual([1400, 200, 0])
  expect(moved.getTable('blockRecords').records.find(block => block.name === 'A-DOOR-0900').payload.entityIds).toEqual(['door-leaf', 'door-swing'])
  movedSave.project.destroy()

  await page.locator('#undo').click()
  const undone = await saveProject(page)
  expect(undone.project.activeDocument.getObject(source.targetId).payload.position).toEqual(source.targetPosition)
  undone.project.destroy()
  await page.locator('#redo').click()
  const redone = await saveProject(page)
  expect(redone.project.activeDocument.getObject(source.targetId).payload.position).toEqual([1400, 200, 0])
  redone.project.destroy()

  await page.locator('#file-input').setInputFiles({ name: 'two-room-office-reviewed.kjp', mimeType: 'application/zip', buffer: redone.bytes })
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  const reopened = await saveProject(page)
  expect(reopened.project.activeDocument.getObject(source.targetId).payload.position).toEqual([1400, 200, 0])
  expect(reopened.project.activeDocument.listEntities({ type: 'INSERT' })).toHaveLength(3)
  reopened.project.destroy()
})

test('public Playground continues an imported site plan with a visible three-line road edit and exact meter reopen', async ({ page }) => {
  const source = await siteFixture(), modelId = source.drawing.snapshot().spaces.modelSpaceId
  const modelCount = source.drawing.listEntities({ ownerId: modelId }).length
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openDrawing(page, 'utility-site-plan.kjd', source.bytes, modelCount)

  for (const [index, y] of [40, 35, 45].entries()) {
    if (index > 0) await page.keyboard.down('Shift')
    const point = await screenPoint(page, [60, y], source.bounds)
    await page.mouse.click(point.x, point.y)
    if (index > 0) await page.keyboard.up('Shift')
  }
  await expect(page.locator('#selection-count')).toHaveText('3 selected')
  await page.locator('#command-input').fill('MOVE 5 -2')
  await page.locator('#command-input').press('Enter')
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')

  const movedSave = await saveProject(page), moved = movedSave.project.activeDocument
  expect(source.roadIds.map(id => moved.getObject(id).payload.vertices[0].point)).toEqual([[15, 38, 0], [15, 33, 0], [15, 43, 0]])
  expect(moved.getObject('site-boundary').payload.vertices[0].point).toEqual([0, 0, 0])
  movedSave.project.destroy()

  await page.locator('#undo').click()
  const undone = await saveProject(page)
  expect(source.roadIds.map(id => undone.project.activeDocument.getObject(id).payload.vertices[0].point)).toEqual([[10, 40, 0], [10, 35, 0], [10, 45, 0]])
  undone.project.destroy()
  await page.locator('#redo').click()
  const redone = await saveProject(page)
  expect(source.roadIds.map(id => redone.project.activeDocument.getObject(id).payload.vertices[0].point)).toEqual([[15, 38, 0], [15, 33, 0], [15, 43, 0]])
  redone.project.destroy()

  await page.locator('#file-input').setInputFiles({ name: 'utility-site-plan-reviewed.kjp', mimeType: 'application/zip', buffer: redone.bytes })
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  const reopened = await saveProject(page)
  expect(source.roadIds.map(id => reopened.project.activeDocument.getObject(id).payload.vertices[1].point)).toEqual([[115, 38, 0], [115, 33, 0], [115, 43, 0]])
  expect(reopened.project.activeDocument.snapshot().header.units).toBe('meter')
  reopened.project.destroy()
})
