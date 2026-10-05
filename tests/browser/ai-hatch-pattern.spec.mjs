import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { resolveChatToolReceipt } from '../helpers/native-entity-wire-references.mjs'

const endpoint = 'https://ai-public-hatch-protocol.invalid/v1/chat/completions'
const sourceName = '素填土', destinationName = '杂填土'
const patternFields = new Set(['patternName', 'solid', 'patternLines', 'patternDefinitionAngle', 'patternDefinitionScale', 'patternScale', 'patternAngle'])

async function publicPatternSheet() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-pattern-only-sheet', units: 'millimeter' })
  const sourceLines = [
    { angle: 0, base: [0, 0], offset: [0, 4], dashes: [1, -3] },
    { angle: Math.PI / 2, base: [1, 0], offset: [5, 0], dashes: [2, -4] },
  ]
  const destinationLines = [
    { angle: 0, base: [0, 0], offset: [0, 6], dashes: [3, -2] },
    { angle: Math.PI / 2, base: [1, 1], offset: [7, 0], dashes: [1, -2, 0, -2] },
    { angle: Math.PI / 4, base: [2, 0], offset: [-4, 4], dashes: [2, -3] },
    { angle: Math.PI * 3 / 4, base: [0, 2], offset: [-5, -5], dashes: [1, -4] },
  ]
  await document.transact('Public synthetic graphical patterns, not soil classification data', tx => {
    // Forward associations exercise actual DXF handle resolution. Both the
    // outer source boundary and island have reciprocal native HATCH reactors.
    tx.createEntity('HATCH', {
      patternName: sourceName, solid: false, associative: true,
      patternScale: 1, patternAngle: 0, patternDefinitionScale: 1, patternDefinitionAngle: 0, patternLines: sourceLines,
      boundaryLoops: [
        { external: true, flags: 3, closed: true, vertices: [[0, 0], [40, 0], [40, 25], [0, 25]], sourceBoundaryIds: ['public-outer-boundary'] },
        { external: false, flags: 0, edges: [{ type: 'ARC', center: [20, 12, 0], radius: 2, startAngle: 0, endAngle: Math.PI * 2, counterClockwise: true }], sourceBoundaryIds: ['public-island'] },
      ],
    }, { id: 'public-source-pattern' })
    tx.createEntity('LWPOLYLINE', { closed: true, vertices: [[0, 0], [40, 0], [40, 25], [0, 25]], dxfReactorIds: ['public-source-pattern'] }, { id: 'public-outer-boundary' })
    tx.createEntity('CIRCLE', { center: [20, 12, 0], radius: 2, dxfReactorIds: ['public-source-pattern'] }, { id: 'public-island' })
    tx.createEntity('HATCH', {
      patternName: destinationName, solid: false, associative: false,
      patternScale: 1, patternAngle: 0, patternDefinitionScale: 1, patternDefinitionAngle: 0, patternLines: destinationLines,
      boundaryLoops: [{ external: true, flags: 3, closed: true, vertices: [[55, 0], [85, 0], [85, 25], [55, 25]] }],
    }, { id: 'public-destination-pattern' })
    tx.createEntity('LINE', { start: [-4, -4, 0], end: [95, -4, 0] }, { id: 'public-retained-line' })
    tx.createEntity('TEXT', { text: 'PUBLIC NOTE: KEEP POSITION AND CONTENT', position: [0, -9, 0], height: 2 }, { id: 'public-retained-note' })
  })
  return { sdk, dxf: await sdk.writeDocument(document, { format: 'DXF' }) }
}

async function savedDrawing(page, sdk) {
  const saved = await page.evaluate(async () => (await import('/apps/playground/ai/local-history.js')).loadLocalHistory())
  const session = saved.sessions.find(item => item.id === saved.activeId)
  return { session, document: await sdk.readDocument(session.state.drawing, { format: 'KJD' }) }
}
function sortedEntities(document) {
  return [...document.listEntities()].sort((left, right) => left.id.localeCompare(right.id))
}
function retainedPayload(entity) {
  return Object.fromEntries(Object.entries(entity.payload).filter(([key]) => !patternFields.has(key)))
}
function referenceHandles(value, document) {
  if (typeof value === 'string') {
    const target = document.getObject(value)
    return ['table-record', 'block-record'].includes(target?.kind) ? { type: target.type, name: target.name } : target?.handle ?? value
  }
  if (Array.isArray(value)) return value.map(item => referenceHandles(item, document))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, referenceHandles(item, document)]))
  return value
}
function semanticEntity(entity, document) {
  const owner = referenceHandles(entity.ownerId, document)
  const payload = { ...entity.payload }
  if (payload.rawTags) {
    // DXF reconstructs table-record handles. Compare ownership by its named
    // native space, while retaining every entity reactor and HATCH source 330.
    let inReactors = false, inHatch = false
    payload.rawTags = payload.rawTags.map(tag => {
      if (tag.code === 102 && tag.value === '{ACAD_REACTORS') inReactors = true
      if (tag.code === 102 && tag.value === '}') inReactors = false
      if (tag.code === 100 && tag.value === 'AcDbHatch') inHatch = true
      return tag.code === 330 && !inReactors && !inHatch ? { code: tag.code, value: owner } : tag
    })
  }
  return { type: entity.type, handle: entity.handle, owner,
    payload: referenceHandles(payload, document) }
}
function checkAssociations(document, hatch) {
  expect(hatch.payload.associative).toBe(true)
  expect(hatch.payload.boundaryLoops).toHaveLength(2)
  for (const loop of hatch.payload.boundaryLoops) {
    expect(loop.sourceBoundaryIds).toHaveLength(1)
    const boundary = document.getObject(loop.sourceBoundaryIds[0])
    expect(boundary.erased).toBe(false)
    expect(boundary.ownerId).toBe(hatch.ownerId)
    expect(loop.sourceBoundaryHandles).toEqual([boundary.handle])
    expect(boundary.payload.dxfReactorIds).toEqual([hatch.id])
  }
}

for (const protocol of ['JSON', 'SSE']) {
  test(`protocol fixture (${protocol}): a pattern-only soil name edits real HATCH families after review, exports intact boundaries, and undoes exactly`, async ({ page }) => {
    // Reproducible protocol fixture, not a live-model quality measurement.
    // Model replies are controlled; SDK tool execution, preview, human approval,
    // local persistence, browser download, and DXF decoding are all actual.
    const { sdk, dxf } = await publicPatternSheet()
    const calls = [], receipts = []
    let catalog, proposalArgs
    await page.route(endpoint, route => {
      const body = route.request().postDataJSON()
      expect(body.stream).toBe(true)
      expect(body.tools.some(tool => tool.function.name === 'cad_read_hatch_patterns')).toBe(true)
      expect(body.tools.some(tool => tool.function.name === 'cad_propose_hatch_pattern')).toBe(true)
      const wireBefore = JSON.stringify(body), receipt = resolveChatToolReceipt(body)
      expect(JSON.stringify(body)).toBe(wireBefore)
      if (receipt) { expect(receipt.ok).toBe(true); receipts.push(receipt) }
      let name, args
      if (calls.length === 0) { name = 'cad_read_drawing'; args = {} }
      else if (calls.length === 1) {
        name = 'cad_read_hatch_patterns'
        args = { expectedRevision: receipt.value.revision, offset: 0, limit: 64, maxBytes: 262144 }
      } else if (calls.length === 2) {
        catalog = receipt.value
        const source = catalog.patterns.find(pattern => pattern.name === sourceName)
        const destination = catalog.patterns.find(pattern => pattern.name === destinationName)
        expect(source).toMatchObject({ source: 'drawing', lineFamilies: 2, entityCount: 1, entityIdsTruncated: false })
        expect(destination).toMatchObject({ source: 'drawing', lineFamilies: 4, entityCount: 1 })
        expect(source.entityIds).toHaveLength(1)
        name = 'cad_query_drawing'
        args = { expectedRevision: catalog.revision, filters: { ids: source.entityIds }, offset: 0, limit: 64, layerOffset: 0, maxLayers: 64, maxBytes: 262144 }
        proposalArgs = { expectedRevision: catalog.revision, units: catalog.units, ids: source.entityIds, patternId: destination.patternId }
      } else {
        expect(calls).toHaveLength(3)
        expect(receipt.value.revision).toBe(catalog.revision)
        expect(receipt.value.units).toBe(catalog.units)
        expect(receipt.value.entities).toHaveLength(1)
        const actualWire = JSON.parse(body.messages.findLast(message => message.role === 'tool').content)
        expect(actualWire.value.entities[0].nativeEntityReference).toBeDefined()
        expect(receipt.value.entities[0]).toMatchObject({ id: proposalArgs.ids[0], type: 'HATCH' })
        name = 'cad_propose_hatch_pattern'
        args = { ...proposalArgs, expectedRevision: receipt.value.revision, units: receipt.value.units }
      }
      calls.push(name)
      const id = `public-hatch-protocol-${calls.length}`
      if (protocol === 'JSON') return route.fulfill({ json: { choices: [{ message: {
        role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      }, finish_reason: 'tool_calls' }] } })
      const serialized = JSON.stringify(args), split = Math.max(1, Math.floor(serialized.length / 2))
      const chunks = [
        { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: serialized.slice(0, split) } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: serialized.slice(split) } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]
      return route.fulfill({ contentType: 'text/event-stream', body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' })
    })

    await page.goto('/ai/')
    await page.getByTestId('drawing-file').setInputFiles({ name: 'public-pattern-only-sheet.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
    await expect(page.locator('#drawing-name')).toHaveText('public-pattern-only-sheet.dxf')
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    const baseline = await savedDrawing(page, sdk), before = sortedEntities(baseline.document)
    const source = before.find(entity => entity.type === 'HATCH' && entity.payload.patternName === sourceName)
    const destination = before.find(entity => entity.type === 'HATCH' && entity.payload.patternName === destinationName)
    expect(source.payload.patternLines).toHaveLength(2)
    expect(destination.payload.patternLines).toHaveLength(4)
    expect(before.filter(entity => ['TEXT', 'MTEXT'].includes(entity.type) && [sourceName, destinationName].some(name => String(entity.payload.text).includes(name)))).toEqual([])
    checkAssociations(baseline.document, source)

    await page.getByTestId('settings-open').click()
    await page.getByTestId('settings-provider').selectOption('custom')
    await page.getByTestId('settings-endpoint').fill(endpoint)
    await page.getByTestId('settings-model').fill(`public-${protocol.toLowerCase()}-protocol-fixture-not-a-live-model`)
    await page.getByTestId('settings-save').click()
    await expect(page.locator('#settings-dialog')).not.toBeVisible()
    await page.getByTestId('chat-input').fill('将唯一的素填土填充改为图中已有的杂填土花纹，只改图形花纹，保留边界、孔深和其他对象，先让我审核。')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('proposal-approve')).toBeVisible()
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    const proposalCard = page.getByTestId('drawing-result')
    await expect(proposalCard.locator('.proposal-subtitle')).toHaveText(`Revision ${baseline.document.revision}`)
    await expect(proposalCard.locator('.proposal-subtitle')).not.toContainText('HATCHPATTERN')
    await expect(proposalCard.locator('.proposal-details pre')).not.toBeVisible()
    await expect(proposalCard.locator('.proposal-details pre')).toContainText('"command": "HATCHPATTERN"')
    await expect(page.locator('.drawing-drop-overlay small')).toHaveText('DXF · KJD · KJP')
    await page.locator('#language-button').click()
    await expect(proposalCard.locator('.proposal-subtitle')).toHaveText(`版本 ${baseline.document.revision}`)
    await page.locator('#language-button').click()
    await expect(proposalCard.locator('.proposal-subtitle')).toHaveText(`Revision ${baseline.document.revision}`)
    expect(calls).toEqual(['cad_read_drawing', 'cad_read_hatch_patterns', 'cad_query_drawing', 'cad_propose_hatch_pattern'])
    expect(receipts).toHaveLength(3)
    expect(sortedEntities((await savedDrawing(page, sdk)).document)).toEqual(before)

    const preview = page.getByTestId('drawing-result').locator('.drawing-viewer')
    await expect(preview.locator('canvas')).toBeVisible()
    await expect.poll(() => preview.evaluate(node => Number(node.dataset.viewerRendered ?? 0))).toBeGreaterThan(0)
    const fitScale = await preview.locator('canvas').evaluate(canvas => Number(canvas.dataset.viewerScale))
    await preview.locator('[data-viewer-action="zoom-in"]').click()
    await expect.poll(() => preview.locator('canvas').evaluate(canvas => Number(canvas.dataset.viewerScale))).toBeGreaterThan(fitScale)
    await preview.locator('[data-viewer-action="fit"]').click()
    await expect(preview.locator('.drawing-viewer-status')).toHaveText('100%')
    await expect.poll(() => preview.locator('canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let drawn = 0
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 220 || pixels[index + 1] < 220 || pixels[index + 2] < 220) drawn++
      return drawn
    })).toBeGreaterThan(100)
    expect(sortedEntities((await savedDrawing(page, sdk)).document)).toEqual(before)

    await page.getByTestId('proposal-approve').click()
    await expect(page.getByTestId('drawing-result').locator('.proposal-tag')).toHaveText('Applied')
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    const approved = await savedDrawing(page, sdk), after = sortedEntities(approved.document)
    const changed = after.find(entity => entity.id === source.id)
    expect(changed.payload.patternName).toBe(destinationName)
    expect(changed.payload.patternLines).toEqual(destination.payload.patternLines)
    expect(changed.payload.patternLines).toHaveLength(4)
    expect(changed.payload.patternScale).toBe(source.payload.patternScale)
    expect(changed.payload.patternAngle).toBe(source.payload.patternAngle)
    expect(changed).toMatchObject({ id: source.id, handle: source.handle, type: 'HATCH', ownerId: source.ownerId })
    expect(retainedPayload(changed)).toEqual(retainedPayload(source))
    expect(after.filter(entity => entity.id !== source.id)).toEqual(before.filter(entity => entity.id !== source.id))
    checkAssociations(approved.document, changed)
    expect(approved.session.state.committed).toBe(true)
    expect(approved.session.state.drawingHistory.undo).toHaveLength(1)

    const downloading = page.waitForEvent('download')
    await page.getByTestId('drawing-download').click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe('public-pattern-only-sheet.dxf')
    const reopened = await sdk.readDocument(new Uint8Array(await readFile(await download.path())), { format: 'DXF' })
    expect(reopened.validate().valid).toBe(true)
    expect(reopened.listEntities()).toHaveLength(before.length)
    const exported = reopened.listEntities().find(entity => entity.handle === source.handle)
    expect(exported.payload.patternName).toBe(destinationName)
    expect(exported.payload.patternLines).toHaveLength(4)
    expect(exported.payload.patternLines).toEqual(destination.payload.patternLines)
    expect(Number(exported.payload.rawTags.find(tag => tag.code === 78).value)).toBe(4)
    expect(referenceHandles(exported.payload.boundaryLoops, reopened)).toEqual(referenceHandles(source.payload.boundaryLoops, baseline.document))
    checkAssociations(reopened, exported)
    for (const retained of before.filter(entity => entity.id !== source.id)) {
      const actual = reopened.listEntities().find(entity => entity.handle === retained.handle)
      expect(semanticEntity(actual, reopened)).toEqual(semanticEntity(retained, baseline.document))
    }

    await page.reload()
    await expect(page.getByTestId('drawing-undo')).toBeEnabled()
    expect(sortedEntities((await savedDrawing(page, sdk)).document)).toEqual(after)
    await page.getByTestId('drawing-undo').click()
    await expect(page.getByTestId('drawing-redo')).toBeEnabled()
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    expect(sortedEntities((await savedDrawing(page, sdk)).document)).toEqual(before)
    await page.reload()
    await expect(page.getByTestId('drawing-redo')).toBeEnabled()
    expect(sortedEntities((await savedDrawing(page, sdk)).document)).toEqual(before)
    expect(calls).toHaveLength(4)
  })
}
