import { expect, test } from '@playwright/test'
import { openAiChat } from './ai-chat-ui.mjs'
import { readFile } from 'node:fs/promises'
import {
  KJProjectSession,
  buildAgentArchitecturePlan,
  buildAgentSitePlan,
  createKJDrawSDK,
} from '../../packages/kjdraw-sdk/src/index.js'

const architecture = {
  version: '1.0.0', expectedRevision: 0, units: 'millimeter', drawingId: 'UI-ARCH-PRODUCTION', title: 'TWO ROOM OFFICE PLAN', width: 10000, depth: 8000, wallThickness: 200,
  exteriorOpenings: [{ wall: 'south', offset: 1200, width: 900, kind: 'door' }, { wall: 'north', offset: 3000, width: 1500, kind: 'window' }, { wall: 'east', offset: 3000, width: 1500, kind: 'window' }],
  partitions: [{ id: 'P1', axis: 'vertical', position: 5000, start: 200, end: 7800, openings: [{ offset: 3100, width: 900, kind: 'door' }] }],
  rooms: [{ id: 'R101', name: 'MEETING', bounds: [200, 200, 4700, 7600] }, { id: 'R102', name: 'STUDIO', bounds: [5100, 200, 4700, 7600] }], textHeight: 250,
}

const site = {
  version: '1.0.0', expectedRevision: 0, units: 'meter', drawingId: 'UI-SITE-PRODUCTION', title: 'MIXED USE CAMPUS GENERAL SITE PLAN', revision: 'C3',
  boundary: [[1000, 2000], [1260, 2000], [1270, 2120], [1220, 2220], [1000, 2200]],
  roads: [{ name: 'MAIN ACCESS ROAD', width: 8, centerline: [[990, 2020], [1080, 2020], [1160, 2060], [1280, 2060]] }, { name: 'SERVICE ROAD', width: 6, centerline: [[1110, 1990], [1110, 2140], [1220, 2180]] }],
  buildings: [{ name: 'ADMINISTRATION', floors: 4, footprint: [[1025, 2040], [1080, 2040], [1080, 2080], [1025, 2080]] }, { name: 'WORKSHOP', floors: 2, footprint: [[1140, 2080], [1230, 2080], [1230, 2140], [1140, 2140]] }, { name: 'WAREHOUSE', footprint: [[1035, 2120], [1125, 2120], [1125, 2180], [1035, 2180]] }],
  utilities: [{ kind: 'water', name: 'DOMESTIC WATER', diameterMm: 200, path: [[1005, 2028], [1090, 2028], [1170, 2070], [1240, 2070]], nodeIndices: [0, 1, 2, 3] }, { kind: 'drainage', name: 'STORM DRAIN', diameterMm: 600, path: [[1010, 2190], [1080, 2160], [1160, 2160], [1250, 2120]], nodeIndices: [0, 1, 2, 3] }, { kind: 'power', name: '11kV POWER', path: [[1005, 2010], [1100, 2010], [1180, 2050]], nodeIndices: [0, 2] }],
  coordinateReference: { position: [1010, 2010], easting: 385000.125, northing: 3452000.75, crs: 'EPSG:32650' }, northAngleDegrees: -8, scale: 500,
}

const wire = (name, args, text) => ({ choices: [{ finish_reason: 'tool_calls', message: {
  role: 'assistant', content: text, tool_calls: [{ id: `${name}-fixture-call`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
} }] })

async function fixture(kind) {
  const intent = kind === 'architecture' ? architecture : site
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: `semantic-production-${kind}`, units: intent.units })
  const compiled = kind === 'architecture' ? buildAgentArchitecturePlan(drawing, intent) : buildAgentSitePlan(drawing, intent)
  const layers = Object.fromEntries(compiled.commandArgs.resources.layers.map(layer => [layer.name, layer.id]))
  let targets, expected
  if (kind === 'architecture') {
    const roomLabel = compiled.commandArgs.entities.find(entity => entity.type === 'TEXT' && entity.payload.text === 'MEETING')
    if (!roomLabel) throw new Error('Expected an editable architectural room label')
    targets = [roomLabel.options.id]
    expected = { id: targets[0], position: roomLabel.payload.position.map((value, index) => value + (index === 0 ? 200 : index === 1 ? 100 : 0)) }
  } else {
    const footprint = compiled.commandArgs.entities.find(entity => entity.type === 'LWPOLYLINE' && entity.payload.layerId === layers.BUILDING)
    const label = compiled.commandArgs.entities.find(entity => entity.type === 'TEXT' && String(entity.payload.text).startsWith('ADMINISTRATION'))
    if (!footprint || !label) throw new Error('Expected an editable site building and label')
    targets = [footprint.options.id, label.options.id]
    expected = { id: targets[0], firstVertex: [footprint.payload.vertices[0][0] + 5, footprint.payload.vertices[0][1] - 2, 0], labelId: targets[1], labelPosition: [label.payload.position[0] + 5, label.payload.position[1] - 2, 0] }
  }
  return { intent, compiled, targets, expected, blank: await sdk.writeDocument(drawing, { format: 'KJD' }) }
}

async function openBlankAndConnect(page, source) {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: `blank-${source.intent.units}.kjd`, mimeType: 'application/json', buffer: Buffer.from(source.blank) })
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await openAiChat(page)
  await page.getByRole('button', { name: 'Connect model', exact: true }).click()
  await page.locator('#chat-endpoint').fill('/api/model')
  await page.locator('#chat-model').fill('deterministic-protocol-fixture-not-a-real-model')
  await page.locator('#chat-protocol').selectOption('chat-completions')
  await page.getByRole('button', { name: 'Use this connection', exact: true }).click()
}

async function send(page, prompt) {
  await page.locator('#chat-input').fill(prompt)
  await page.locator('#chat-send').click()
}

async function saveProject(page) {
  const pending = page.waitForEvent('download')
  await page.locator('#save').click()
  const bytes = await readFile(await (await pending).path())
  return { bytes, project: await KJProjectSession.open(bytes, { sdk: createKJDrawSDK() }) }
}

async function createThrowawayDrawing(page, units) {
  await page.locator('#new-drawing').click()
  const dialog = page.locator('#app-dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('[name="name"]').fill('Reopen isolation check')
  await dialog.locator('[name="units"]').selectOption(units)
  await dialog.locator('#dialog-submit').click()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
}

async function exportSelectedSvg(page, layoutId) {
  const select = page.locator('#output-layout')
  await expect(select.locator(`option[value="${layoutId}"]`)).toHaveCount(1)
  await select.selectOption(layoutId)
  const pending = page.waitForEvent('download')
  await page.locator('#export-svg').click()
  const svg = await readFile(await (await pending).path(), 'utf8')
  return page.evaluate(source => {
    const drawing = new DOMParser().parseFromString(source, 'image/svg+xml')
    if (drawing.querySelector('parsererror')) throw new Error('Exported SVG is invalid XML')
    return {
      width: drawing.documentElement.getAttribute('width'),
      height: drawing.documentElement.getAttribute('height'),
      report: JSON.parse(drawing.querySelector('metadata').textContent),
    }
  }, svg)
}

for (const kind of ['architecture', 'site']) test(`${kind} product path compiles, incrementally edits, reopens and exports physical SVG`, async ({ page }) => {
  test.setTimeout(90_000)
  const source = await fixture(kind), requests = [], move = kind === 'architecture' ? { dx: 200, dy: 100 } : { dx: 5, dy: -2 }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openBlankAndConnect(page, source)

  // Deterministic protocol fixtures verify the browser product path only; they are not model-quality, latency or token evidence.
  await page.route('**/api/model', route => {
    const body = route.request().postDataJSON()
    requests.push(body)
    if (requests.length === 1) {
      expect(body.tools.map(tool => tool.function.name)).toEqual([`cad_propose_${kind}_plan`])
      return route.fulfill({ json: wire(`cad_propose_${kind}_plan`, source.intent, 'Deterministic product-path fixture: review the compiled plan.') })
    }
    expect(body.tools.some(tool => tool.function.name === 'cad_propose_move')).toBe(true)
    expect(body.tools.length).toBeGreaterThan(1)
    return route.fulfill({ json: wire('cad_propose_move', { expectedRevision: 1, units: source.intent.units, ids: source.targets, ...move }, 'Deterministic product-path fixture: review this incremental edit.') })
  })

  const initialPrompt = kind === 'architecture'
    ? 'Create a complete architectural floor plan with two rooms, walls, doors, windows, areas, dimensions, layers and an A3 1:100 paper layout.'
    : 'Create a complete general site plan with boundary, roads, buildings, utilities, coordinates, dimensions, north arrow and an A1 1:500 paper layout.'
  await send(page, initialPrompt)
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('#entity-count')).toHaveText(`${source.compiled.evidence.entityCount} entities`)
  await expect(page.locator('#revision')).toHaveText('REV 1')

  await send(page, kind === 'architecture' ? 'Move the existing first room label 200 mm right and 100 mm up; keep all other geometry unchanged.' : 'Move the existing administration building and its label 5 m east and 2 m south; do not regenerate the site plan.')
  await expect(page.locator('#revision')).toHaveText('REV 1')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).last().click()
  await expect(page.locator('#revision')).toHaveText('REV 2')
  expect(requests).toHaveLength(2)

  const saved = await saveProject(page), drawing = saved.project.activeDocument
  const layout = drawing.getObject(source.compiled.commandArgs.layout.id)
  expect(layout?.name).toBe(source.compiled.commandArgs.layout.name)
  const viewports = drawing.listEntities({ ownerId: layout.payload.blockRecordId, type: 'VIEWPORT' })
  expect(viewports).toHaveLength(1)
  if (kind === 'architecture') {
    expect(drawing.getObject(source.expected.id).payload.position).toEqual(source.expected.position)
    expect(viewports[0].payload.height / viewports[0].payload.viewHeight).toBeCloseTo(0.01, 10)
  } else {
    expect(drawing.getObject(source.expected.id).payload.vertices[0].point).toEqual(source.expected.firstVertex)
    expect(drawing.getObject(source.expected.labelId).payload.position).toEqual(source.expected.labelPosition)
    expect(viewports[0].payload.height / viewports[0].payload.viewHeight).toBeCloseTo(2, 10)
  }
  saved.project.destroy()

  await createThrowawayDrawing(page, source.intent.units)
  await page.locator('#file-input').setInputFiles({ name: `${kind}-production-reviewed.kjp`, mimeType: 'application/zip', buffer: saved.bytes })
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  await expect(page.locator('#entity-count')).toHaveText(`${source.compiled.evidence.entityCount} entities`)
  const reopened = await saveProject(page)
  expect(reopened.project.activeDocument.revision).toBe(2)
  expect(reopened.project.activeDocument.getObject(source.expected.id)).toBeTruthy()
  reopened.project.destroy()

  const svg = await exportSelectedSvg(page, source.compiled.commandArgs.layout.id)
  expect(svg.width).toBe(kind === 'architecture' ? '420mm' : '841mm')
  expect(svg.height).toBe(kind === 'architecture' ? '297mm' : '594mm')
  expect(svg.report.diagnostics).toEqual([])
  expect(svg.report.rendered).toBeGreaterThan(0)
  expect(svg.report.viewports).toHaveLength(1)
  expect(svg.report.viewports[0].millimetersPerModelUnit).toBeCloseTo(kind === 'architecture' ? 0.01 : 2, 10)
})
