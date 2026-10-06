// Real hosted browser + real provider. No model mocks, private drawings or keys
// in artifacts. Opt-in paid test; exact preview oracle acts as a TEST reviewer,
// not independent human acceptance. Does not measure general CAD correctness.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { createKJDrawSDK, compileGeologySection } from '../../packages/kjdraw-sdk/src/index.js'
import { canonicalStringify } from '../../packages/kjdraw-sdk/src/utils.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = 'https://kanjieteam.github.io/kjdraw/'
const modelOrigin = 'https://api.deepseek.com'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const sorted = document => [...document.listEntities()].sort((a, b) => a.id.localeCompare(b.id))
const projected = document => sorted(document).map(({ id, type, payload }) => ({ id, type, payload }))

export async function hostedSyntheticSection() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const holes = ['SYN-A', 'SYN-B', 'SYN-C'].map((id, index) => ({
    id, station: index * 20, collarElevation: 106 + index, depth: 18,
    strata: [
      { intervalId: id + '-1', code: '1', name: '模拟填土', lithology: 'fill', top: 0, bottom: 3 },
      { intervalId: id + '-2', code: '2', name: '模拟黏土', lithology: 'clay', top: 3, bottom: 10 },
      { intervalId: id + '-3', code: '3', name: '模拟砂层', lithology: 'sand', top: 10, bottom: 18 },
    ],
  }))
  const compiled = compileGeologySection({ expectedRevision: 0, locale: 'zh-CN', holes,
    horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 85,
    surfaceRule: 'straight-between-supplied-collars',
    correlations: holes.slice(0, -1).flatMap((hole, index) => hole.strata.map((interval, layer) => ({
      fromHoleId: hole.id, toHoleId: holes[index + 1].id,
      fromIntervalId: interval.intervalId, toIntervalId: holes[index + 1].strata[layer].intervalId,
    }))),
  })
  await sdk.executeCommand('CREATEBATCH', structuredClone(compiled.commandArgs), { document })
  await document.transact('Public synthetic graphics-only test labels', tx => {
    for (const [index, text] of ['项目名称:合成回归项目', '孔号:TEST-01', '历史备注；原标点。 Historical note; keep punctuation.'].entries()) {
      tx.createEntity('TEXT', { text, position: [5, -10 - index * 5, 0], height: 2 })
    }
  })
  assert.equal(document.validate().valid, true)
  // Import as ordinary DXF: no claimed source recipe or factual soil inference.
  return { sdk, bytes: await sdk.writeDocument(document, { format: 'DXF' }) }
}

export function hostedSmokeOptions(args) {
  const values = new Map(), allowed = new Set(['--run', '--help', '--suite', '--output-dir'])
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (!allowed.has(flag) || values.has(flag)) throw new Error('Unknown or duplicate option')
    if (flag === '--run' || flag === '--help') { values.set(flag, true); continue }
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error('Option needs a value')
    values.set(flag, value)
  }
  const suite = values.get('--suite') ?? 'circle'
  if (!['circle', 'imported-geology'].includes(suite)) throw new Error('Unknown hosted suite')
  const run = values.has('--run') && !values.has('--help')
  if (run && !values.has('--output-dir')) throw new Error('Paid execution requires a NEW --output-dir')
  return { run, suite, output: values.get('--output-dir') }
}

export function assertHostedTextPreview(proposal, document, from, to) {
  const targets = document.listEntities().filter(entity => entity.payload.text === from)
  assert.equal(targets.length, 1)
  const target = targets[0]
  assert.equal(proposal.command, 'TEXTEDIT')
  assert.equal(proposal.expectedRevision, document.revision)
  // Compare the same canonical JSON representation used by the engine's
  // preview guard. In-memory optional undefined fields do not survive JSON.
  // This is not tolerance for changed CAD values, IDs, positions or whitespace.
  assert.equal(canonicalStringify(proposal.preview.before), canonicalStringify([{ id: target.id, type: target.type, payload: target.payload }]))
  assert.equal(canonicalStringify(proposal.preview.after), canonicalStringify([{ id: target.id, type: target.type, payload: { ...target.payload, text: to } }]))
}

async function runHosted(options) {
  const key = process.env.KJDRAW_DEEPSEEK_API_KEY
  if (!key) throw new Error('Set the provider environment key; never pass it as an argument')
  const folder = resolve(root, options.output)
  await mkdir(folder) // Existing evidence is never replaced.
  const report = { schema: 'com.kanjie.kjdraw.testing.hosted-live-smoke@1',
    suite: options.suite, origin, requestedModel: 'deepseek-chat',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
    scope: 'Synthetic development questions; exact programmatic test review, not independent human acceptance, full source regeneration or token-savings evidence.',
    privateUserData: false, mockedModel: false, rounds: [], providerRequests: 0, passed: false, stage: 'launch' }
  let browser
  try {
    const chrome = process.env.KJDRAW_CHROME_PATH ?? (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined)
    browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}),
      ...(process.env.KJDRAW_BENCH_PROXY ? { proxy: { server: process.env.KJDRAW_BENCH_PROXY } } : {}) })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    report.stage = 'version-check'
    const asset = 'apps/playground/ai/runtime.js'
    const expected = digest(await readFile(resolve(root, asset)))
    const url = new URL(asset, origin); url.searchParams.set('verify', String(Date.now()))
    const response = await context.request.get(url.href, { timeout: 30000 })
    assert.equal(response.status(), 200)
    report.runtimeSha256 = digest(await response.body())
    assert.equal(report.runtimeSha256, expected, 'Hosted runtime must match before sending a key')
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    page.on('request', request => {
      if (new URL(request.url()).origin === modelOrigin && request.method() === 'POST') report.providerRequests++
    })
    report.stage = 'connect'
    await page.goto(new URL('ai/', origin).href, { waitUntil: 'networkidle', timeout: 45000 })
    await page.getByTestId('settings-open').click()
    await page.getByTestId('settings-provider').selectOption('deepseek')
    // The alias used by the frozen development runs may not be one of the
    // provider's current preset options. Use the ordinary custom-model control.
    await page.getByTestId('settings-common-model').selectOption('')
    await page.getByTestId('settings-model').fill('deepseek-chat')
    await page.getByTestId('settings-key').fill(key)
    await page.getByTestId('settings-save').click()
    // Saving credentials awaits durable IDB completion. A click is not proof
    // the dialog has closed or the connection is ready for the next action.
    await expect(page.locator('#settings-dialog')).not.toBeVisible()
    await expect(page.locator('#connection-pill')).toHaveClass(/connected/)

    const sdk = createKJDrawSDK()
    const saved = async () => {
      const record = await page.evaluate(async () => (await import('../apps/playground/ai/local-history.js')).loadLocalHistory())
      const session = record.sessions.find(item => item.id === record.activeId)
      return { session, document: await sdk.readDocument(session.state.drawing, { format: 'KJD' }) }
    }
    const send = async (prompt, check) => {
      await expect(page.getByTestId('chat-send')).toBeEnabled()
      await page.getByTestId('chat-input').fill(prompt)
      await expect.poll(async () => page.evaluate(async () => {
        const record = await (await import('../apps/playground/ai/local-history.js')).loadLocalHistory()
        return record.sessions.some(session => session.id === record.activeId)
      })).toBe(true)
      const before = await saved(), entities = sorted(before.document)
      await page.getByTestId('chat-send').click()
      await expect(page.getByTestId('proposal-approve')).toBeVisible({ timeout: 120000 })
      await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 120000 })
      const pending = await saved()
      assert.deepEqual(sorted(pending.document), entities, 'Preview must not modify the drawing')
      const proposals = pending.session.messages.flatMap(message => message.proposals ?? []).filter(item => item.uiState === 'pending')
      assert.equal(proposals.length, 1)
      check(proposals[0], before.document)
      await page.getByTestId('proposal-approve').click()
      await expect(page.getByTestId('drawing-result').last().locator('.proposal-tag')).toHaveText('已应用')
      return { before: before.document, after: (await saved()).document }
    }
    const download = async () => {
      const ready = page.waitForEvent('download')
      await page.getByTestId('drawing-download').last().click()
      const file = await ready
      assert.equal(file.suggestedFilename().endsWith('.dxf'), true)
      return sdk.readDocument(new Uint8Array(await readFile(await file.path())), { format: 'DXF' })
    }

    if (options.suite === 'circle') {
      report.stage = 'circle-proposal'
      const result = await send('以 (0,0) 为圆心画半径 5 毫米的圆，先让我审核。', proposal => {
        assert.equal(proposal.preview.before.length, 0)
        assert.equal(proposal.preview.after.length, 1)
        assert.equal(proposal.preview.after[0].type, 'CIRCLE')
        assert.equal(proposal.preview.after[0].payload.radius, 5)
        assert.deepEqual(proposal.preview.after[0].payload.center, [0, 0, 0])
      })
      assert.equal(result.after.listEntities().length, 1)
      const reopened = await download()
      assert.equal(reopened.validate().valid, true)
      assert.equal(reopened.listEntities()[0].payload.radius, 5)
      report.rounds.push({ id: 'circle', passed: true, dxfReopened: true })
    } else {
      report.stage = 'import-synthetic-section'
      const fixture = await hostedSyntheticSection()
      await writeFile(resolve(folder, 'synthetic-input.dxf'), fixture.bytes, { flag: 'wx' })
      await page.getByTestId('drawing-file').setInputFiles({ name: 'synthetic-geology-section.dxf', mimeType: 'application/dxf', buffer: Buffer.from(fixture.bytes) })
      await expect(page.locator('#drawing-name')).toHaveText('synthetic-geology-section.dxf')
      await expect(page.getByTestId('chat-send')).toBeEnabled()
      report.initialEntities = (await saved()).document.listEntities().length
      const note = '历史备注；原标点。 Historical note; keep punctuation.'
      const changes = [
        ['项目名称:合成回归项目', '项目名称:合成复核项目'],
        ['孔号:TEST-01', '孔号:TEST-02'],
        [note, note + '复核版'],
        [note + '复核版', '说明：' + note + '复核版'],
        ['说明：' + note + '复核版', '模拟图纸，仅供测试'],
        ['孔号:TEST-02', '孔号:TEST-03'],
        ['项目名称:合成复核项目', '项目名称:合成终审项目'],
        ['模拟图纸，仅供测试', '模拟图纸，仅供测试 / checked'],
        ['孔号:TEST-03', '孔号:TEST-04'],
        ['项目名称:合成终审项目', '项目名称:合成归档项目'],
      ]
      for (const [index, [from, to]] of changes.entries()) {
        report.stage = `graphics-edit-${index + 1}`
        const prompt = index === 2 ? '在历史备注原文末尾追加“复核版”，不加空格和其他符号，只改这条图形文字，先让我审核。'
          : index === 3 ? '在刚才那条历史备注原文开头加“说明：”，其余原文保持不变，先让我审核。'
            : `只将完整图形文字“${from}”替换为“${to}”，其他文字、地层、花纹和几何保持不变，先让我审核。`
        const { before, after } = await send(prompt, (proposal, document) => {
          assertHostedTextPreview(proposal, document, from, to)
        })
        const expected = projected(before).map(entity => entity.payload.text === from
          ? { ...entity, payload: { ...entity.payload, text: to } } : entity)
        assert.deepEqual(projected(after), expected, 'IDs and every unrelated native payload must remain exact')
        const reopened = await download()
        assert.equal(reopened.validate().valid, true)
        assert.equal(reopened.listEntities().length, after.listEntities().length)
        assert.equal(reopened.listEntities().filter(entity => entity.payload.text === to).length, 1)
        await page.reload({ waitUntil: 'networkidle' })
        assert.deepEqual(sorted((await saved()).document), sorted(after), 'Refresh must preserve exact native IDs and geometry')
        report.rounds.push({ id: `graphics-edit-${index + 1}`, passed: true, unchangedObjectsExact: true, dxfReopened: true, refreshExact: true })
        console.log(JSON.stringify({ completedRounds: report.rounds.length, providerRequests: report.providerRequests }))
      }
    }
    report.stage = 'final-reload'
    const final = sorted((await saved()).document)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByTestId('drawing-download').last()).toBeVisible()
    assert.deepEqual(sorted((await saved()).document), final)
    assert(report.providerRequests > 0)
    report.historyRestored = true
    report.passed = true
    report.stage = 'complete'
  } catch (error) {
    // Never archive provider error strings, request headers, credentials,
    // screenshots of connection settings or arbitrary user transcripts.
    report.errorCode = 'HOSTED_LIVE_SMOKE_FAILED'
    report.failureKind = error.name
    const location = String(error.stack).match(/run-hosted-ai-smoke\.mjs:(\d+):(\d+)/)
    if (location) report.failureLocation = { line: Number(location[1]), column: Number(location[2]) }
    process.exitCode = 1
  } finally {
    await browser?.close()
    await writeFile(resolve(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify(report))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = hostedSmokeOptions(process.argv.slice(2))
  if (!options.run) console.log(JSON.stringify({ mode: 'dry-run', modelCalls: 0, suite: options.suite,
    origin, usage: 'Set KJDRAW_DEEPSEEK_API_KEY in the environment, then use --run --output-dir <NEW folder>. Optional --suite imported-geology executes 10 graphics-only edits on a public synthetic DXF section. KJDRAW_CHROME_PATH and KJDRAW_BENCH_PROXY are optional.',
    scope: 'Not independent users, source-data relayering, arbitrary private-DXF correctness or a token-savings benchmark.' }, null, 2))
  else await runHosted(options)
}
