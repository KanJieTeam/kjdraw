import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, openKjpPackage } from '../../packages/kjdraw-sdk/src/index.js'
import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../../packages/kjdraw-sdk/examples/fixtures/road-design.mjs'
import { buildRoadDrawing } from '../../packages/kjdraw-sdk/src/road-drawing.js'
import { restoreRoadDrawingRecipe } from '../../packages/kjdraw-sdk/src/road-drawing-recipe.js'
import { createAgentInputAsset, KJDRAW_ROAD_INPUT_ASSET_SCHEMA } from '../../packages/kjdraw-sdk/src/input-assets.js'
import { CHAT_ROAD_ASSET_TOOL_NAMES } from '../../apps/playground/chat-road-asset.js'

// Deterministic transport conformance only; this does not measure a real model.
const wire = (calls = [], text = '') => ({ choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: {
  role: 'assistant', content: text || null,
  tool_calls: calls.map(([id, name, args = {}]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })),
} }] })

test('explicit typed data stays local while chat previews, approves, saves and revises native drawing without retaining asset permission', async ({ page }) => {
  test.setTimeout(120_000)
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'chat-typed-road', units: 'meter' })
  const input = createRoadDesignFixture(), registration = { assetId: 'user-road', schema: KJDRAW_ROAD_INPUT_ASSET_SCHEMA, data: input }
  const sourceText = JSON.stringify(registration), { descriptor } = await createAgentInputAsset(registration)
  const compiled = buildRoadDrawing(input, roadDrawingFixtureOptions), requests = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'empty.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(document, { format: 'KJD' })) })
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.locator('#agent-tab').click()
  await expect(page.locator('#chat-input')).toBeVisible()
  await page.evaluate(async () => {
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js'), original = KJCanvasRenderer.prototype.drawPreview
    window.typedAssetPreviews = []
    KJCanvasRenderer.prototype.drawPreview = function (entities, color, offset, resources) {
      const result = original.call(this, entities, color, offset, resources)
      if (entities.length > 64) window.typedAssetPreviews.push({ ids: entities.map(entity => entity.id), resources: (resources ?? []).map(resource => resource.id), source: this.document.serialize() })
      return result
    }
  })
  await page.route('**/api/model', async route => {
    const body = route.request().postDataJSON(); requests.push(body)
    const names = body.tools.map(tool => tool.function.name), userText = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n')
    expect(userText).not.toMatch(/450000|3300000|"ground"|"sections":\[/)
    if (requests.length <= 2) {
      expect([...names].sort()).toEqual([...CHAT_ROAD_ASSET_TOOL_NAMES].sort())
      expect(userText).toContain(descriptor.sha256)
      expect(userText).toContain('synthetic-user-road.json')
      expect(userText).not.toContain(sourceText)
    } else {
      expect(names).not.toContain('cad_propose_road_drawing_from_asset')
      expect(names).toContain('cad_propose_road_revision')
      expect(userText).toContain('Verified saved road designs')
      expect(userText).not.toContain(descriptor.sha256)
    }
    if (requests.length % 2 === 1) return route.fulfill({ json: wire([['read', 'cad_read_drawing']]) })
    const read = JSON.parse(body.messages.at(-1).content)
    expect(read.ok).toBe(true); expect(read.value.documentId).toBe(document.id)
    const call = requests.length === 2
      ? ['typed-create', 'cad_propose_road_drawing_from_asset', { ...roadDrawingFixtureOptions, expectedRevision: read.value.revision, units: 'meter', assetId: descriptor.assetId, sha256: descriptor.sha256 }]
      : ['revise', 'cad_propose_road_revision', { expectedRevision: read.value.revision, units: 'meter', drawingId: roadDrawingFixtureOptions.drawingId, leftWidthDelta: .5, rightWidthDelta: .5, elevationDelta: .25 }]
    return route.fulfill({ json: wire([call], 'Protocol conformance proposal; review before applying.') })
  })
  await page.getByRole('button', { name: 'Connect model', exact: true }).click()
  await page.locator('#chat-endpoint').fill('/api/model')
  await page.locator('#chat-model').fill('browser-fixture')
  await page.locator('#chat-protocol').selectOption('chat-completions')
  await page.getByRole('button', { name: 'Use this connection', exact: true }).click()
  await page.locator('#chat-data-file').setInputFiles({ name: 'synthetic-user-road.json', mimeType: 'application/json', buffer: Buffer.from(sourceText) })
  await page.locator('#chat-input').fill('Compile this explicitly attached input for review. This is a software protocol test.')
  await page.locator('#chat-send').click()
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeEnabled()
  await expect(page.locator('.chat-sent-data pre')).toHaveText(sourceText)
  await expect(page.locator('.chat-road-evidence')).toHaveAttribute('data-entity-count', String(compiled.entities.length))
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  const revision = await page.locator('#revision').textContent()
  await page.getByRole('button', { name: 'Preview on drawing', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.typedAssetPreviews.length)).toBeGreaterThan(0)
  const preview = await page.evaluate(() => window.typedAssetPreviews.at(-1))
  expect(preview.ids).toEqual(compiled.entities.map(entity => entity.options.id))
  expect(preview.resources.sort()).toEqual([...compiled.resources.layers, ...compiled.resources.linetypes].map(resource => resource.id).sort())
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await expect(page.locator('#revision')).toHaveText(revision)
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('#entity-count')).toHaveText(`${compiled.entities.length} entities`)
  const save = async () => {
    const promised = page.waitForEvent('download'); await page.locator('#save').click()
    return openKjpPackage(await readFile(await (await promised).path()))
  }
  const first = await save(), key = `${document.id}:${roadDrawingFixtureOptions.drawingId}`
  const firstRecipe = first.manifest.metadata.roadDrawingRecipes[key]
  expect(firstRecipe.input).toEqual(input)
  const firstRestored = await restoreRoadDrawingRecipe(first.activeDocument, firstRecipe)
  expect(firstRestored.drawing.entities.length).toBe(compiled.entities.length)
  expect(firstRestored.drawing.calculation.totalVolume).toEqual(compiled.calculation.totalVolume)
  await page.locator('#chat-input').fill(`Modify ${roadDrawingFixtureOptions.drawingId}: widen each side by 0.5 m and raise design elevations by 0.25 m. Keep terrain unchanged.`)
  await page.locator('#chat-send').click()
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true }).last()).toBeEnabled()
  await page.getByRole('button', { name: 'Preview on drawing', exact: true }).last().click()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).last().click()
  await expect(page.locator('.chat-proposal-state').last()).toContainText('Changes applied')
  await expect(page.locator('.chat-proposal-state').last()).not.toContainText('not saved')
  const revisedInput = structuredClone(input)
  revisedInput.pavement.leftWidth += .5; revisedInput.pavement.rightWidth += .5
  for (const point of revisedInput.profile) point.elevation += .25
  const revised = buildRoadDrawing(revisedInput, roadDrawingFixtureOptions)
  const second = await save(), secondRecipe = second.manifest.metadata.roadDrawingRecipes[key]
  expect(secondRecipe.input).toEqual(revisedInput)
  const secondRestored = await restoreRoadDrawingRecipe(second.activeDocument, secondRecipe)
  expect(secondRestored.drawing.calculation.totalVolume).toEqual(revised.calculation.totalVolume)
  await page.getByRole('button', { name: 'Undo this change', exact: true }).last().click()
  const undone = await save(), persisted = document => JSON.parse(JSON.stringify(document.listEntities()))
  expect(persisted(undone.activeDocument)).toEqual(persisted(first.activeDocument))
  await page.locator('#redo').click()
  expect(persisted((await save()).activeDocument)).toEqual(persisted(second.activeDocument))
  expect(requests).toHaveLength(4); expect(errors).toEqual([])
})

