import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK, hatchPatternFromCatalog, KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG } from '../../packages/kjdraw-sdk/src/index.js'
import { nativeHatchPattern } from '../../packages/kjdraw-sdk/src/agent-hatch-pattern.js'
import { resolveChatToolReceipt } from '../helpers/native-entity-wire-references.mjs'

// Controlled public protocol responses, not live-model acceptance. HTTP bytes,
// SDK resource discovery, native CAD, browser preview/approval, DXF and IDB are real.
let server, endpoint, respond
const filename = 'public-source-only-STT.dxf', destinationName = '杂填土'
const patternFields = new Set(['patternName', 'solid', 'patternLines', 'patternDefinitionAngle', 'patternDefinitionScale', 'patternScale', 'patternAngle'])

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' })
      response.end(); return
    }
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      respond(response, JSON.parse(Buffer.concat(chunks).toString()))
    } catch (error) {
      // A fixture assertion must fail the test, not become an unhandled server error.
      respond.error = error
      response.writeHead(500, { 'Access-Control-Allow-Origin': '*' }); response.end('Public protocol fixture failed')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${server.address().port}/v1/chat/completions`
})
test.afterAll(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

async function sourceOnlySheet() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-source-only-patterns', units: 'millimeter' })
  const source = hatchPatternFromCatalog(KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG, 'STT')
  expect(source.patternLines).toHaveLength(2)
  await document.transact('Public synthetic geometry with source STT only', tx => {
    for (let index = 0; index < 2; index++) {
      const x = index * 55, id = `public-source-${index}`, boundary = `public-outer-${index}`
      const vertices = [[x, 0], [x + 40, 0], [x + 40, 25], [x, 25]]
      const loops = [{ external: true, flags: 3, closed: true, vertices, sourceBoundaryIds: [boundary] }]
      if (!index) loops.push({ external: false, flags: 0, edges: [{ type: 'ARC', center: [20, 12, 0], radius: 2, startAngle: 0, endAngle: Math.PI * 2, counterClockwise: true }], sourceBoundaryIds: ['public-island'] })
      tx.createEntity('HATCH', { ...source, associative: true, patternScale: index ? 0.65 : 2.25,
        patternAngle: index ? -Math.PI / 5 : Math.PI / 7, boundaryLoops: loops }, { id })
      tx.createEntity('LWPOLYLINE', { closed: true, vertices, dxfReactorIds: [id] }, { id: boundary })
    }
    tx.createEntity('CIRCLE', { center: [20, 12, 0], radius: 2, dxfReactorIds: ['public-source-0'] }, { id: 'public-island' })
    tx.createEntity('LINE', { start: [-4, -4, 0], end: [100, -4, 0] }, { id: 'public-retained-line' })
    tx.createEntity('TEXT', { text: 'PUBLIC SYNTHETIC NOTE: RETAIN EXACTLY', position: [0, -9, 0], height: 2 }, { id: 'public-retained-note' })
  })
  return { sdk, dxf: await sdk.writeDocument(document, { format: 'DXF' }) }
}
async function savedDrawing(page, sdk) {
  const saved = await page.evaluate(async () => (await import('/apps/playground/ai/local-history.js')).loadLocalHistory())
  const session = saved.sessions.find(item => item.id === saved.activeId)
  return { session, document: await sdk.readDocument(session.state.drawing, { format: 'KJD' }) }
}
const objects = document => Object.values(document.snapshot().objects).sort((left, right) => left.id.localeCompare(right.id))
const retainedPayload = entity => Object.fromEntries(Object.entries(entity.payload).filter(([key]) => !patternFields.has(key)))
function handles(value, document) {
  if (typeof value === 'string') {
    const target = document.getObject(value)
    return ['table-record', 'block-record'].includes(target?.kind) ? { type: target.type, name: target.name } : target?.handle ?? value
  }
  if (Array.isArray(value)) return value.map(item => handles(item, document))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, handles(item, document)]))
  return value
}
function semanticEntity(entity, document) {
  const owner = handles(entity.ownerId, document), payload = { ...entity.payload }
  if (payload.rawTags) {
    let reactors = false, hatch = false
    payload.rawTags = payload.rawTags.map(tag => {
      if (tag.code === 102 && tag.value === '{ACAD_REACTORS') reactors = true
      if (tag.code === 102 && tag.value === '}') reactors = false
      if (tag.code === 100 && tag.value === 'AcDbHatch') hatch = true
      return tag.code === 330 && !reactors && !hatch ? { code: tag.code, value: owner } : tag
    })
  }
  return { type: entity.type, handle: entity.handle, owner, payload: handles(payload, document) }
}
function associations(document, hatch) {
  expect(hatch.payload.associative).toBe(true)
  for (const loop of hatch.payload.boundaryLoops) {
    expect(loop.sourceBoundaryIds).toHaveLength(1)
    const boundary = document.getObject(loop.sourceBoundaryIds[0])
    expect(boundary.erased).toBe(false)
    expect(boundary.ownerId).toBe(hatch.ownerId)
    expect(loop.sourceBoundaryHandles).toEqual([boundary.handle])
    expect(boundary.payload.dxfReactorIds).toEqual([hatch.id])
  }
}
function near(actual, expected) {
  if (typeof expected === 'number') { expect(actual).toBeCloseTo(expected, 9); return }
  if (Array.isArray(expected)) {
    expect(actual).toHaveLength(expected.length); expected.forEach((value, index) => near(actual[index], value)); return
  }
  if (expected && typeof expected === 'object') {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort())
    for (const [key, value] of Object.entries(expected)) near(actual[key], value)
    return
  }
  expect(actual).toBe(expected)
}

for (const protocol of ['JSON', 'SSE']) {
  test(`bundled catalog protocol fixture (${protocol}): source-only STT resolves new four-family fill, approvals and DXF/history preserve geometry`, async ({ page }) => {
    const { sdk, dxf } = await sourceOnlySheet(), calls = [], receipts = []
    let revision, source, destination, proposalArgs
    respond = (response, body) => {
      expect(body.stream).toBe(true)
      expect(body.model).toBe(`public-${protocol.toLowerCase()}-catalog-protocol-fixture-not-a-live-model`)
      for (const name of ['cad_read_hatch_patterns', 'cad_propose_hatch_pattern']) expect(body.tools.some(tool => tool.function.name === name)).toBe(true)
      const wireBefore = JSON.stringify(body), receipt = resolveChatToolReceipt(body)
      expect(JSON.stringify(body)).toBe(wireBefore)
      if (receipt) { expect(receipt.ok).toBe(true); receipts.push(receipt) }
      let name, args
      if (!calls.length) { name = 'cad_read_drawing'; args = {} }
      else if (calls.length === 1) {
        revision = receipt.value.revision
        // Ordinary Chinese discovery must return the actual imported STT IDs
        // even when its transforms produce a distinct exact fingerprint. The
        // explicit literal-name metadata relation never merges its geometry.
        name = 'cad_read_hatch_patterns'; args = { expectedRevision: revision, search: '素填土', offset: 0, limit: 64, maxBytes: 262144 }
      } else if (calls.length === 2) {
        const drawingSources = receipt.value.patterns.filter(pattern => pattern.name === 'STT' && pattern.source === 'drawing')
        expect(drawingSources.length).toBeGreaterThan(0)
        for (const pattern of drawingSources) {
          expect(pattern).toMatchObject({ lineFamilies: 2, entityIdsTruncated: false, catalogMetadataMatch: 'literal-name' })
          expect(pattern.descriptions).toContain('素填土')
        }
        source = { entityIds: drawingSources.flatMap(pattern => pattern.entityIds) }
        expect(source.entityIds).toHaveLength(2); expect(new Set(source.entityIds).size).toBe(2)
        name = 'cad_read_hatch_patterns'; args = { expectedRevision: revision, search: destinationName, offset: 0, limit: 64, maxBytes: 262144 }
      } else if (calls.length === 3) {
        destination = receipt.value.patterns.find(pattern => pattern.name === destinationName)
        expect(destination).toMatchObject({ source: 'host-catalog', lineFamilies: 4, entityCount: 0, matchKind: 'exact-name' })
        expect(destination.entityIds).toEqual([])
        proposalArgs = { expectedRevision: receipt.value.revision, units: receipt.value.units, ids: source.entityIds, patternId: destination.patternId }
        name = 'cad_query_drawing'; args = { expectedRevision: revision, filters: { ids: source.entityIds }, offset: 0, limit: 64, layerOffset: 0, maxLayers: 64, maxBytes: 262144 }
      } else {
        expect(calls).toHaveLength(4); expect(receipt.value.revision).toBe(revision)
        const actualWire = JSON.parse(body.messages.findLast(message => message.role === 'tool').content)
        expect(actualWire.value.entities.every(entity => entity.nativeEntityReference)).toBe(true)
        expect(receipt.value.entities.map(entity => entity.id).sort()).toEqual([...source.entityIds].sort())
        expect(receipt.value.entities.every(entity => entity.type === 'HATCH')).toBe(true)
        name = 'cad_propose_hatch_pattern'; args = proposalArgs
      }
      calls.push(name)
      const id = `public-bundled-catalog-${calls.length}`, serialized = JSON.stringify(args)
      response.writeHead(200, { 'Content-Type': protocol === 'JSON' ? 'application/json' : 'text/event-stream', 'Access-Control-Allow-Origin': '*' })
      if (protocol === 'JSON') {
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: serialized } }] }, finish_reason: 'tool_calls' }] })); return
      }
      const split = Math.max(1, Math.floor(serialized.length / 2))
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: serialized.slice(0, split) } }] }, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: serialized.slice(split) } }] }, finish_reason: null }] })}\n\n`)
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
    }

    await page.goto('/ai/')
    await page.getByTestId('drawing-file').setInputFiles({ name: filename, mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
    await expect(page.locator('#drawing-name')).toHaveText(filename)
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    const baseline = await savedDrawing(page, sdk), before = objects(baseline.document), original = baseline.document.listEntities({ type: 'HATCH' })
    expect(baseline.session.source).toMatchObject({ name: filename, format: 'DXF' })
    expect(objects(baseline.document).some(object => object.kind === 'recipe')).toBe(false)
    expect(original).toHaveLength(2)
    expect(original.every(entity => entity.payload.patternName === 'STT' && entity.payload.patternLines.length === 2)).toBe(true)
    expect(baseline.document.listEntities().some(entity => entity.payload.patternName === destinationName)).toBe(false)
    for (const hatch of original) associations(baseline.document, hatch)
    await page.getByTestId('settings-open').click()
    await page.getByTestId('settings-provider').selectOption('custom')
    await page.getByTestId('settings-endpoint').fill(endpoint)
    await page.getByTestId('settings-model').fill(`public-${protocol.toLowerCase()}-catalog-protocol-fixture-not-a-live-model`)
    await page.getByTestId('settings-save').click()
    await expect(page.locator('#settings-dialog')).not.toBeVisible()
    const prompt = '把这张图的素填土花纹换成杂填土，保留两个区域的边界、关联、各自比例角度与其他对象，先给我审核。'
    await page.getByTestId('chat-input').fill(prompt)
    await expect(page.getByTestId('chat-input')).toHaveValue(prompt)
    await page.getByTestId('chat-send').click()
    await expect.poll(async () => {
      if (respond.error) throw respond.error
      return page.getByTestId('proposal-approve').count()
    }).toBe(1)
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    expect(respond.error).toBeUndefined()
    expect(calls).toEqual(['cad_read_drawing', 'cad_read_hatch_patterns', 'cad_read_hatch_patterns', 'cad_query_drawing', 'cad_propose_hatch_pattern'])
    expect(receipts).toHaveLength(4)
    expect(objects((await savedDrawing(page, sdk)).document)).toEqual(before)
    const preview = page.getByTestId('drawing-result').locator('.drawing-viewer')
    await expect(preview.locator('canvas')).toBeVisible()
    await expect.poll(() => preview.evaluate(node => Number(node.dataset.viewerRendered ?? 0))).toBeGreaterThan(0)
    await expect.poll(() => preview.locator('canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let ink = 0
      for (let at = 0; at < pixels.length; at += 4) if (pixels[at] < 220 || pixels[at + 1] < 220 || pixels[at + 2] < 220) ink++
      return ink
    })).toBeGreaterThan(100)
    expect(objects((await savedDrawing(page, sdk)).document)).toEqual(before)
    await page.getByTestId('proposal-approve').click()
    await expect(page.getByTestId('drawing-result').locator('.proposal-tag')).toHaveText('Applied')
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    const approved = await savedDrawing(page, sdk), after = objects(approved.document), targetIds = new Set(original.map(entity => entity.id))
    const target = hatchPatternFromCatalog(KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG, destinationName)
    expect(target.patternLines).toHaveLength(4)
    for (const old of original) {
      const changed = approved.document.getObject(old.id)
      expect(changed).toMatchObject({ id: old.id, handle: old.handle, ownerId: old.ownerId, type: old.type })
      expect(retainedPayload(changed)).toEqual(retainedPayload(old))
      expect(changed.payload.patternName).toBe(destinationName)
      expect(changed.payload.patternLines).toEqual(target.patternLines)
      expect(changed.payload).toMatchObject({ solid: false, patternDefinitionScale: 1, patternDefinitionAngle: 0 })
      expect(nativeHatchPattern(changed.payload)).toEqual({ ...nativeHatchPattern(target),
        patternScale: old.payload.patternScale, patternAngle: old.payload.patternAngle })
      expect(changed.payload.patternScale).toBe(old.payload.patternScale)
      expect(changed.payload.patternAngle).toBe(old.payload.patternAngle)
      associations(approved.document, changed)
    }
    expect(after.filter(object => !targetIds.has(object.id))).toEqual(before.filter(object => !targetIds.has(object.id)))
    expect(approved.session.state.drawingHistory.undo).toHaveLength(1)
    const downloading = page.waitForEvent('download')
    await page.getByTestId('drawing-download').click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe(filename)
    const reopened = await sdk.readDocument(new Uint8Array(await readFile(await download.path())), { format: 'DXF' })
    expect(reopened.validate().valid).toBe(true)
    expect(reopened.listEntities()).toHaveLength(baseline.document.listEntities().length)
    expect(reopened.listEntities({ type: 'HATCH' })).toHaveLength(2)
    for (const old of original) {
      const actual = reopened.listEntities().find(entity => entity.handle === old.handle)
      near(nativeHatchPattern(actual.payload), nativeHatchPattern(approved.document.getObject(old.id).payload))
      expect(Number(actual.payload.rawTags.find(tag => tag.code === 78).value)).toBe(4)
      expect(handles(actual.payload.boundaryLoops, reopened)).toEqual(handles(old.payload.boundaryLoops, baseline.document))
      associations(reopened, actual)
    }
    for (const retained of baseline.document.listEntities().filter(entity => !targetIds.has(entity.id))) {
      expect(semanticEntity(reopened.listEntities().find(entity => entity.handle === retained.handle), reopened)).toEqual(semanticEntity(retained, baseline.document))
    }
    await page.reload()
    await expect(page.getByTestId('drawing-undo')).toBeEnabled()
    expect(objects((await savedDrawing(page, sdk)).document)).toEqual(after)
    await page.getByTestId('drawing-undo').click()
    await expect(page.getByTestId('drawing-redo')).toBeEnabled()
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    expect(objects((await savedDrawing(page, sdk)).document)).toEqual(before)
    await page.reload()
    await expect(page.getByTestId('drawing-redo')).toBeEnabled()
    expect(objects((await savedDrawing(page, sdk)).document)).toEqual(before)
    await page.getByTestId('drawing-redo').click()
    await expect(page.getByTestId('drawing-undo')).toBeEnabled()
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    expect(objects((await savedDrawing(page, sdk)).document)).toEqual(after)
    await page.reload()
    await expect(page.getByTestId('drawing-undo')).toBeEnabled()
    expect(objects((await savedDrawing(page, sdk)).document)).toEqual(after)
    expect(calls).toHaveLength(5)
  })
}
