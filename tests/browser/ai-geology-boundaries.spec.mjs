import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { delimiter } from 'node:path'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK, compileGeologyColumn } from '../../packages/kjdraw-sdk/src/index.js'

// Synthetic source facts and a mocked provider protocol. These tests exercise
// the real browser, CAD engine, human-review boundary and local persistence;
// they do not count as independent or real-model geology interpretation tests.
const endpoint = 'https://geology-boundary.invalid/v1/chat/completions'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const source = { kind: 'column', input: { expectedRevision: 0, locale: 'zh-CN', hole: {
    id: 'ZK-BROWSER', collarElevation: 105, depth: 16, initialWaterDepth: 2, stableWaterDepth: 4,
    strata: [
      { intervalId: 'fill', code: '1', name: '填土', top: 0, bottom: 3, lithology: 'fill' },
      { intervalId: 'clay', code: '2', name: '黏土', top: 3, bottom: 16, lithology: 'clay' },
    ],
  } } }
  const compiled = compileGeologyColumn(source.input)
  await sdk.executeCommand('CREATEBATCH', { ...structuredClone(compiled.commandArgs), geologySource: source }, { document })
  await document.transact('Unrelated manual review mark', tx => tx.createEntity('CIRCLE', {
    center: [900, 900, 0], radius: 3,
  }, { id: 'manual-review-circle' }))
  return { sdk, document, source, drawingId: compiled.evidence.rootObjectId }
}

async function openDrawing(page, bytes, name = 'survey-source.kjd') {
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name, mimeType: name.endsWith('.dxf') ? 'application/dxf' : 'application/json', buffer: Buffer.from(bytes) })
  await expect(page.locator('#drawing-name')).toHaveText(name)
}

async function connect(page) {
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(endpoint)
  await page.getByTestId('settings-model').fill('mock-geology-protocol')
  await page.getByTestId('settings-key').fill('synthetic-key-not-a-real-credential')
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
}

async function send(page, text) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
}

async function localState(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('kjdraw-ai-local')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const request = db.transaction('conversations').objectStore('conversations').get('history')
      request.onerror = () => { db.close(); reject(request.error) }
      request.onsuccess = () => { const session = request.result?.sessions?.[0]; db.close(); resolve(session ?? null) }
    }
  }))
}

async function storedDrawing(page) {
  await expect.poll(async () => Boolean((await localState(page))?.state?.drawing)).toBe(true)
  return createKJDrawSDK().readDocument((await localState(page)).state.drawing, { format: 'KJD' })
}

function sourceFacts(document, drawingId) {
  return document.snapshot().opaquePayloads[`geology-drawing-recipe:${drawingId}`].source.input.hole
}

function drawingContent(document) {
  const state = document.snapshot()
  return { revision: document.revision, objects: state.objects, tables: state.tables, spaces: state.spaces, opaquePayloads: state.opaquePayloads }
}

function independentlyCheckDownloadedDxf(path) {
  // Explicit opt-in so contributors without Python/ezdxf can still run browser
  // tests. When requested, a missing validator is a failure, not a silent skip.
  const code = [
    'import ezdxf, json, sys',
    'document = ezdxf.readfile(sys.argv[1])',
    'auditor = document.audit()',
    'model = document.modelspace()',
    'json.dump({"reader": ezdxf.__version__, "errors": len(auditor.errors), "fixes": len(auditor.fixes),',
    '"texts": [entity.dxf.text for entity in model.query("TEXT")],',
    '"hatches": len(model.query("HATCH")),',
    '"manualMark": any(entity.dxf.radius == 3 and entity.dxf.center.x == 900 for entity in model.query("CIRCLE"))}, sys.stdout)',
  ].join('\n')
  const result = spawnSync(process.env.KJDRAW_PYTHON ?? 'python', ['-c', code, path], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONPATH: [process.env.KJDRAW_EZDXF_PATH, process.env.PYTHONPATH].filter(Boolean).join(delimiter), PYTHONIOENCODING: 'utf-8' },
  })
  expect(result.status, result.stderr || result.error?.message).toBe(0)
  const independent = JSON.parse(result.stdout)
  expect(independent.errors).toBe(0)
  expect(independent.fixes).toBe(0)
  expect(independent.texts).toContain('3.00')
  expect(independent.texts).toContain('5.00')
  expect(independent.hatches).toBeGreaterThan(0)
  expect(independent.manualMark).toBe(true)
}

async function mockRevision(page, data, update, onRead = () => {}) {
  let phase = 0
  await page.route(endpoint, async route => {
    const body = route.request().postDataJSON()
    const names = body.tools.map(tool => tool.function.name)
    expect(names).toContain('cad_read_geology_source')
    expect(names).toContain('cad_propose_geology_revision')
    const read = phase++ % 2 === 0
    if (!read) {
      const result = JSON.parse(body.messages.findLast(item => item.role === 'tool').content)
      expect(result.ok).toBe(true)
      expect(result.value.facts.hole.id).toBe('ZK-BROWSER')
      onRead(result.value.facts.hole)
    }
    const name = read ? 'cad_read_geology_source' : 'cad_propose_geology_revision'
    const revision = Number(body.messages.findLast(message => message.role === 'user').content.match(/revision (\d+)/)[1])
    const args = read ? { expectedRevision: revision, drawingId: data.drawingId, maxBytes: 262144 }
      : { expectedRevision: revision, drawingId: data.drawingId, units: 'millimeter', updates: [{ holeId: 'ZK-BROWSER', ...(typeof update === 'function' ? update() : update) }] }
    await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: `boundary-${phase}`, type: 'function', function: { name, arguments: JSON.stringify(args) },
    }] }, finish_reason: 'tool_calls' }] } })
  })
}

for (const variant of [
  { label: 'water', prompt: '把 ZK-BROWSER 钻孔初见水位改成 3 米，稳定水位改成 5 米，同步重绘。', update: { initialWaterDepth: 3, stableWaterDepth: 5 }, review: ['2 m', '3 m', '4 m', '5 m'] },
  { label: 'strata', prompt: '把 ZK-BROWSER 钻孔填土与黏土分层界线从 3 米改成 5 米，保持总孔深 16 米并重绘。', update: { strata: [
    { intervalId: 'fill', code: '1', name: '填土', top: 0, bottom: 5, lithology: 'fill' },
    { intervalId: 'clay', code: '2', name: '黏土', top: 5, bottom: 16, lithology: 'clay' },
  ] }, review: ['fill', 'clay', '0–3 m', '0–5 m', '3–16 m', '5–16 m'] },
]) {
  test(`geology ${variant.label} source stays unchanged through preview, discard and refresh`, async ({ page }) => {
    const data = await fixture()
    await mockRevision(page, data, variant.update)
    await openDrawing(page, await data.sdk.writeDocument(data.document, { format: 'KJD' }))
    await connect(page)
    await send(page, variant.prompt)
    await expect(page.getByTestId('proposal-approve')).toBeVisible()
    for (const value of variant.review) await expect(page.getByTestId('geology-source-changes')).toContainText(value)
    const pending = await storedDrawing(page)
    expect(drawingContent(pending)).toEqual(drawingContent(data.document))
    await expect(page.getByTestId('drawing-download')).toHaveCount(0)
    await page.getByTestId('proposal-reject').click()
    await expect(page.getByTestId('drawing-result')).toContainText('Discarded')
    await expect(page.getByTestId('drawing-result').locator('.proposal-preview-fallback')).toHaveText('Discarded')
    await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
    await expect(page.getByTestId('proposal-reject')).toHaveCount(0)
    await expect.poll(async () => (await localState(page))?.messages?.find(message => message.proposals)?.proposals?.[0]?.uiState).toBe('rejected')
    expect(drawingContent(await storedDrawing(page))).toEqual(drawingContent(data.document))
    await page.reload()
    await expect(page.getByTestId('drawing-result')).toContainText('Discarded')
    await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
    expect(drawingContent(await storedDrawing(page))).toEqual(drawingContent(data.document))
  })
}

test('refresh expires an unapproved geology proposal and a fresh review can export the changed DXF', async ({ page }) => {
  const data = await fixture()
  const update = { initialWaterDepth: 3, stableWaterDepth: 5 }
  const readFacts = []
  await mockRevision(page, data, update, hole => readFacts.push(hole))
  await openDrawing(page, await data.sdk.writeDocument(data.document, { format: 'KJD' }))
  await connect(page)
  await send(page, '把 ZK-BROWSER 钻孔初见水位改成 3 米，稳定水位改成 5 米。')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await expect.poll(async () => (await localState(page))?.messages?.find(message => message.proposals)?.proposals?.[0]?.uiState).toBe('pending')
  await page.reload()
  await expect(page.getByTestId('drawing-result')).toContainText('Expired')
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
  expect(drawingContent(await storedDrawing(page))).toEqual(drawingContent(data.document))
  await send(page, '请重新生成 ZK-BROWSER 钻孔水位修改提案：初见 3 米，稳定 5 米。')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  expect(readFacts).toHaveLength(2)
  expect(readFacts[1].initialWaterDepth).toBe(2)
  expect(readFacts[1].stableWaterDepth).toBe(4)
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  await expect.poll(async () => (await localState(page))?.state?.committed).toBe(true)
  const approved = await storedDrawing(page)
  expect(approved.revision).toBe(data.document.revision + 1)
  expect(sourceFacts(approved, data.drawingId)).toMatchObject(update)
  expect(approved.getObject('manual-review-circle')).toEqual(data.document.getObject('manual-review-circle'))
  const downloading = page.waitForEvent('download')
  await page.getByTestId('drawing-download').click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/\.dxf$/)
  const dxf = await data.sdk.readDocument(new Uint8Array(await readFile(await download.path())), { format: 'DXF' })
  expect(dxf.validate().valid).toBe(true)
  const values = dxf.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
  expect(values).toContain('3.00')
  expect(values).toContain('5.00')
  expect(dxf.listEntities({ type: 'HATCH' }).length).toBeGreaterThan(0)
  expect(dxf.listEntities({ type: 'CIRCLE' }).some(entity => entity.payload.radius === 3 && entity.payload.center[0] === 900)).toBe(true)
  expect(Object.keys(dxf.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:'))).toBe(false)
  if (process.env.KJDRAW_BROWSER_EZDXF === '1') independentlyCheckDownloadedDxf(await download.path())
  await page.reload()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  expect(sourceFacts(await storedDrawing(page), data.drawingId)).toMatchObject(update)
})

test('a raw imported DXF cannot fabricate a measured geology source recipe', async ({ page }) => {
  const data = await fixture()
  const dxf = await data.sdk.writeDocument(data.document, { format: 'DXF' })
  let requests = 0
  await page.route(endpoint, route => {
    const body = route.request().postDataJSON()
    // Bind every follow-up to the original authoritative request, never a
    // later host protocol reminder. A real read precedes the source refusal.
    const user = body.messages.find(message => message.role === 'user' && message.content.startsWith('Host context: document ')).content
    expect(user).toContain('This imported DXF is graphics, not a verified borehole source table')
    const names = body.tools.map(tool => tool.function.name)
    expect(names).not.toContain('cad_propose_geology_column')
    requests++
    if (requests === 1) {
      return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
        id: 'actual-graphics-read', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' },
      }] }, finish_reason: 'tool_calls' }] } })
    }
    if (requests === 2) {
      const read = JSON.parse(body.messages.findLast(message => message.role === 'tool').content)
      expect(read).toMatchObject({ ok: true, value: { documentId: imported.id, revision: imported.revision, units: 'millimeter' } })
      expect(read.value.entities.length).toBeGreaterThan(0)
      // Even if a model attempts to use a guessed recipe ID, the engine must
      // refuse it. A prompt warning or a hidden button is not the safeguard.
      const revision = Number(user.match(/revision (\d+)/)[1])
      return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
        id: 'fabricated-source', type: 'function', function: { name: 'cad_propose_geology_revision', arguments: JSON.stringify({
          expectedRevision: revision, drawingId: data.drawingId, units: 'millimeter', updates: [{ holeId: 'ZK-BROWSER', stableWaterDepth: 6 }],
        }) },
      }] }, finish_reason: 'tool_calls' }] } })
    }
    const result = JSON.parse(body.messages.findLast(message => message.role === 'tool').content)
    expect(result.ok).toBe(false)
    expect(result.error.message).toMatch(/source|recipe/i)
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '缺少原始钻孔数据；仅凭 DXF 文字无法验证分层和水位。请提供钻孔源数据。' }, finish_reason: 'stop' }] } })
  })
  await openDrawing(page, dxf, 'graphics-only.dxf')
  const imported = await storedDrawing(page)
  await connect(page)
  await send(page, '把 ZK-BROWSER 钻孔稳定水位改成 6 米并重新分层重绘。')
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('缺少原始钻孔数据')
  expect(requests).toBe(3)
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
  const after = await storedDrawing(page)
  expect(drawingContent(after)).toEqual(drawingContent(imported))
  expect(Object.keys(after.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:'))).toBe(false)
})

test('ten reviewed browser geology revisions preserve unrelated objects and each downloaded DXF reopens', async ({ page }) => {
  const data = await fixture()
  let round = 0
  const update = () => ({ initialWaterDepth: 2 + round / 10, stableWaterDepth: 4 + round / 10, strata: [
    { ...data.source.input.hole.strata[0], bottom: 3 + round / 10 },
    { ...data.source.input.hole.strata[1], top: 3 + round / 10 },
  ] })
  await mockRevision(page, data, update, hole => {
    expect(hole.initialWaterDepth).toBe(2 + (round - 1) / 10)
    expect(hole.stableWaterDepth).toBe(4 + (round - 1) / 10)
    expect(hole.strata[0].bottom).toBe(3 + (round - 1) / 10)
  })
  await openDrawing(page, await data.sdk.writeDocument(data.document, { format: 'KJD' }))
  await connect(page)
  for (round = 1; round <= 10; round++) {
    const changed = update()
    await send(page, `把 ZK-BROWSER 钻孔初见水位改成 ${changed.initialWaterDepth} 米、稳定水位改成 ${changed.stableWaterDepth} 米；填土底界改成 ${changed.strata[0].bottom} 米，保持黏土连续到 16 米并同步重绘。`)
    await expect(page.getByTestId('proposal-approve')).toBeVisible()
    expect((await storedDrawing(page)).revision).toBe(data.document.revision + round - 1)
    await page.getByTestId('proposal-approve').click()
    await expect(page.getByTestId('drawing-download')).toHaveCount(round)
    await expect.poll(async () => (await storedDrawing(page)).revision).toBe(data.document.revision + round)
    const current = await storedDrawing(page)
    expect(sourceFacts(current, data.drawingId)).toMatchObject(changed)
    expect(current.getObject('manual-review-circle')).toEqual(data.document.getObject('manual-review-circle'))
    const downloading = page.waitForEvent('download')
    await page.getByTestId('drawing-download').last().click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/\.dxf$/)
    const restored = await data.sdk.readDocument(new Uint8Array(await readFile(await download.path())), { format: 'DXF' })
    expect(restored.validate().valid).toBe(true)
    expect(restored.listEntities()).toHaveLength(current.listEntities().length)
    expect(restored.listEntities({ type: 'HATCH' }).length).toBeGreaterThan(0)
    const texts = restored.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
    expect(texts).toContain(changed.initialWaterDepth.toFixed(2))
    expect(texts).toContain(changed.stableWaterDepth.toFixed(2))
    if (round === 10 && process.env.KJDRAW_BROWSER_EZDXF === '1') independentlyCheckDownloadedDxf(await download.path())
    if (round === 5) {
      await page.reload()
      await expect(page.getByTestId('drawing-download')).toHaveCount(5)
      expect(sourceFacts(await storedDrawing(page), data.drawingId)).toMatchObject(changed)
    }
  }
})

test('cancelling a model request preserves the source-backed drawing and cannot leave an approvable proposal', async ({ page }) => {
  const data = await fixture()
  let requested = false
  await page.route(endpoint, async route => {
    requested = true
    await new Promise(resolve => setTimeout(resolve, 1500))
    try { await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: 'Late response' }, finish_reason: 'stop' }] } }) } catch {}
  })
  await openDrawing(page, await data.sdk.writeDocument(data.document, { format: 'KJD' }))
  await connect(page)
  await send(page, '修改 ZK-BROWSER 钻孔分层，先审核。')
  await expect.poll(() => requested).toBe(true)
  await page.getByTestId('chat-stop').click()
  await expect(page.getByTestId('chat-stop')).toBeHidden()
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('Stopped')
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
  expect(drawingContent(await storedDrawing(page))).toEqual(drawingContent(data.document))
  await page.reload()
  expect(drawingContent(await storedDrawing(page))).toEqual(drawingContent(data.document))
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
})
