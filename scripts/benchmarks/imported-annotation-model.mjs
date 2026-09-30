import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createAiChatRuntime } from '../../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { extractKJModelUsage } from '../../packages/kjdraw-sdk/src/model-usage.js'
import { canonicalStringify } from '../../packages/kjdraw-sdk/src/utils.js'
import { publicAnnotationSheet } from '../../tests/helpers/public-annotation-sheet.mjs'
import { checkDrawingReopen } from '../../tests/helpers/imported-drawing-edit-journey.mjs'

// Default: node scripts/benchmarks/imported-annotation-model.mjs (zero API requests).
// Opt-in: set KJDRAW_BENCH_ENDPOINT/MODEL/API_KEY locally, then append --run.
// Use --drawing path/to/source.dxf --target-text exact-label for a private source.
// Without --drawing, uses a generated public sheet. Live private-source execution
// sends the requested label and queried drawing context to the configured provider.
// Reports contain counters/check outcomes, not prompts, drawing text or API keys.

const operations = Object.freeze([
  ['text', '-A'], ['move', 2, 0], ['move', 0, 1], ['text', '-B'], ['move', -1, 0],
  ['text', '-C'], ['move', 0, -1], ['text', ''], ['move', -1, 0], ['text', '-验收'],
].map(operation => Object.freeze(operation)))
export const importedAnnotationModelProtocol = Object.freeze({
  version: 'imported-annotation-v1', rounds: 10, maxRequests: 40, operations,
  scope: 'Exploratory single-arm native annotation edits, not geological data redraw, model comparison or token-saving evidence.',
  approval: 'Harness approval only after exact full-record oracle checks; not an independent human acceptance test.',
})

/** No customer data or credentials are returned. Source DXF bytes are never overwritten. */
export async function runImportedAnnotationModel({ bytes, targetText, connection, fetchImpl = fetch, maxRequests = 40 } = {}) {
  assert.ok(Number.isSafeInteger(maxRequests) && maxRequests >= 1 && maxRequests <= 40)
  const sdk = createKJDrawSDK()
  const source = await sdk.readDocument(bytes, { format: 'DXF' })
  const target = source.listEntities({ ownerId: source.spaces.modelSpaceId }).find(entity =>
    entity.type === 'TEXT' && (targetText ? entity.payload.text === targetText : /^ZK[- ]?\d+$|^\d{4}$/i.test(entity.payload.text)))
  assert.ok(target, 'Provide an explicit native model-space label with --target-text')
  assert.equal(source.listEntities().filter(entity => entity.payload.text === target.payload.text).length, 1,
    'The initial label must be unique; this protocol does not guess between duplicate labels')
  const protocolHash = createHash('sha256').update(JSON.stringify(importedAnnotationModelProtocol)).digest('hex')
  const report = {
    protocol: importedAnnotationModelProtocol.version, protocolHash, scope: importedAnnotationModelProtocol.scope,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'), model: connection.model,
    rounds: [], requests: 0, usage: [], passed: false,
  }
  const chat = createAiChatRuntime({ ...connection, fetchImpl: async (url, request) => {
    if (report.requests >= maxRequests) throw new Error('MODEL_REQUEST_BUDGET')
    report.requests++
    const started = performance.now()
    const response = await fetchImpl(url, request)
    if (response.ok && /json/.test(response.headers.get('content-type') ?? '')) {
      const body = await response.clone().json()
      report.usage.push(extractKJModelUsage(connection.protocol ?? 'chat-completions', body, { latencyMs: performance.now() - started }))
    }
    return response
  } })
  try {
    await chat.importDocument(new File([bytes], 'input.dxf'))
    const imported = await sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    const id = imported.listEntities().find(entity => entity.handle === target.handle).id
    const initialText = target.payload.text
    for (const [index, [kind, value, dy]] of operations.entries()) {
      const beforeState = await chat.exportLocalState()
      const before = await sdk.readDocument(beforeState.drawing, { format: 'KJD' })
      const expected = structuredClone(before.getObject(id))
      const oldText = expected.payload.text
      const units = before.snapshot().header.units
      let prompt
      if (kind === 'text') {
        expected.payload.text = initialText + value
        prompt = `把孔号标注“${oldText}”改成“${expected.payload.text}”。仅修改这个文字对象，不调整孔的几何或数据。`
      } else {
        prompt = `把孔号标注“${oldText}”沿 X 移动 ${value}、沿 Y 移动 ${dy}，单位为图纸当前单位 ${units}。只移动这一个文字对象，其他对象保持不变。`
        for (const key of ['position', 'alignmentPoint']) if (expected.payload[key]) {
          expected.payload[key][0] += value
          expected.payload[key][1] += dy
        }
      }
      const started = performance.now()
      const requestsBefore = report.requests
      const result = await chat.send(prompt)
      const entry = { round: index + 1, operation: kind, status: result.status, requests: report.requests - requestsBefore,
        elapsedMs: Math.round(performance.now() - started), passed: false }
      report.rounds.push(entry)
      let stage = 'proposal-isolation'
      try {
        assert.equal((await chat.exportLocalState()).drawing, beforeState.drawing)
        stage = 'model-proposal'
        assert.equal(result.status, 'proposal')
        assert.equal(result.proposals.length, 1)
        stage = 'target-scope'
        assert.deepEqual(result.proposal.preview.before.map(entity => entity.id), [id])
        stage = 'predicted-edit'
        assert.equal(canonicalStringify(result.proposal.preview.after[0]), canonicalStringify({
          id: expected.id, type: expected.type, payload: expected.payload,
        }))
        stage = 'approval'
        assert.equal((await chat.approve(result.proposal.planId)).status, 'applied')
        stage = 'committed-edit'
        const after = await sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
        assert.equal(canonicalStringify(after.getObject(id)), canonicalStringify(expected))
        stage = 'untouched-objects'
        for (const entity of before.listEntities().filter(entity => entity.id !== id)) {
          assert.equal(canonicalStringify(after.getObject(entity.id)), canonicalStringify(entity))
        }
        stage = 'save-reopen'
        await checkDrawingReopen(sdk, after)
        entry.passed = true
      } catch {
        if (result.proposal) chat.reject(result.proposal.planId)
        entry.failure = result.error?.code ?? 'EXACT_ORACLE_OR_REOPEN_FAILED'
        entry.failureStage = stage
        break // Preserve cumulative semantics; never silently reset a failed journey.
      }
    }
    report.passed = report.rounds.length === 10 && report.rounds.every(round => round.passed)
    const complete = report.usage.length === report.requests && report.usage.every(usage => usage.totalTokens !== null)
    report.totalTokens = complete ? report.usage.reduce((sum, usage) => sum + usage.totalTokens, 0) : null
    return report
  } finally { chat.destroy() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv.includes('--run')) {
    console.log(JSON.stringify({ mode: 'dry-run', requests: 0, ...importedAnnotationModelProtocol }, null, 2))
  } else {
    const option = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
    const endpoint = process.env.KJDRAW_BENCH_ENDPOINT
    const model = process.env.KJDRAW_BENCH_MODEL
    const apiKey = process.env.KJDRAW_BENCH_API_KEY
    if (!endpoint || !model || !apiKey) throw new Error('Set KJDRAW_BENCH_ENDPOINT, KJDRAW_BENCH_MODEL and KJDRAW_BENCH_API_KEY locally; do not put credentials in CLI arguments.')
    const file = option('--drawing')
    const bytes = file ? new Uint8Array(await readFile(file)) : new TextEncoder().encode((await publicAnnotationSheet()).dxf)
    const report = await runImportedAnnotationModel({ bytes, targetText: option('--target-text'),
      connection: { endpoint, model, apiKey, protocol: process.env.KJDRAW_BENCH_PROTOCOL ?? 'chat-completions' },
    })
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.passed ? 0 : 1
  }
}
