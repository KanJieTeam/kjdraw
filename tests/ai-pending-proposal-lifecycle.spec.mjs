import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn } from '../packages/kjdraw-sdk/src/geology-engineering.js'

// Public synthetic protocol fixtures exercise the actual native source,
// history, plan registry and adapters. They are not real-model acceptance.
const content = document => {
  const { objects, tables, spaces, opaquePayloads } = document.snapshot()
  return { objects, tables, spaces, opaquePayloads }
}
async function fixture(t) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-pending-undo', units: 'millimeter' })
  const source = { kind: 'column', input: { expectedRevision: 0, locale: 'zh-CN', verticalScaleDenominator: 200,
    hole: { id: 'PUBLIC-HOLE', collarElevation: 100, depth: 6, strata: [
      { intervalId: 'PUBLIC-FILL', code: '1', name: '素填土', lithology: 'fill', top: 0, bottom: 2 },
      { intervalId: 'PUBLIC-CLAY', code: '2', name: '黏土', lithology: 'clay', top: 2, bottom: 6 },
    ] } } }
  await sdk.executeCommand('CREATEBATCH', { ...structuredClone(compileGeologyColumn(source.input).commandArgs),
    geologySource: structuredClone(source) }, { document })
  assert.equal(document.revision, 1)
  const drawingId = Object.keys(document.snapshot().opaquePayloads).find(key => key.startsWith('geology-drawing-recipe:')).slice('geology-drawing-recipe:'.length)
  const drawing = await sdk.writeDocument(document, { format: 'KJD' })
  // Compare the exact native input that the runtime actually opens, not the
  // compiler's pre-serialization optional undefined properties.
  const baseline = content(await sdk.readDocument(drawing, { format: 'KJD' }))
  let mode = 'oversized', requestCount = 0, requestStarted
  const started = () => new Promise(resolve => { requestStarted = resolve })
  const runtime = createAiChatRuntime({ endpoint: 'https://public-pending.invalid/v1/chat/completions',
    model: 'offline-protocol-fixture', captureToolOutputs: true,
    fetchImpl: async (_url, init) => {
      requestCount++
      const body = JSON.parse(init.body), context = body.messages.find(message => message.role === 'user').content
      const revision = Number(/; revision (\d+);/.exec(context)[1]), last = body.messages.at(-1)
      const prompt = context.slice(context.lastIndexOf('Current user request: ') + 'Current user request: '.length)
      let name, args
      if (prompt === '素填土改成杂填土') {
        if (last.role === 'user') { name = 'cad_read_geology_source'; args = { expectedRevision: revision, drawingId, maxBytes: 262144 } }
        else {
          const receipt = JSON.parse(last.content); assert.equal(receipt.ok, true)
          const hole = receipt.value.facts.hole, interval = hole.strata[0]
          name = 'cad_propose_geology_revision'
          args = { expectedRevision: receipt.value.revision, units: receipt.value.units, drawingId,
            updates: [{ holeId: hole.id, stratumChanges: { update: [{ target: { intervalId: interval.intervalId,
              expectedTop: interval.top, expectedBottom: interval.bottom }, set: { name: '杂填土' } }] } }] }
        }
      } else if (prompt === '撤销' || prompt === '再生成撤销提案') {
        if (last.role === 'user') { name = 'cad_read_history'; args = { expectedRevision: revision } }
        else {
          const receipt = JSON.parse(last.content); assert.equal(receipt.ok, true)
          name = 'cad_propose_undo'; args = { expectedRevision: receipt.value.revision, units: receipt.value.units,
            targetHistoryId: receipt.value.history.undoTarget.id }
        }
      } else if (mode === 'transport') return new Response('', { status: 500 })
      else if (mode === 'cancel') {
        requestStarted?.()
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Offline cancellation')), { once: true }))
      } else if (mode === 'oversized') return Response.json({ choices: [{ message: { role: 'assistant', content: 'x'.repeat(1048600) }, finish_reason: 'stop' }] })
      else if (last.role === 'user') { name = 'cad_read_history'; args = { expectedRevision: revision } }
      else return Response.json({ choices: [{ message: { role: 'assistant', content: 'Read-only history information; no new proposal.' }, finish_reason: 'stop' }] })
      return Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
        id: 'public-pending-' + requestCount, type: 'function', function: { name, arguments: JSON.stringify(args) },
      }] }, finish_reason: 'tool_calls' }] })
    } })
  t.after(() => { runtime.destroy(); for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) })
  await runtime.importDocument(new File([drawing], 'public-pending.kjd'))
  const rename = await runtime.send('素填土改成杂填土')
  assert.equal(rename.status, 'proposal', JSON.stringify(rename.error))
  assert.equal((await runtime.approve(rename.proposal.planId)).status, 'applied')
  assert.equal(runtime.revision, 2)
  const undo = await runtime.send('撤销')
  assert.equal(undo.status, 'proposal', JSON.stringify(undo.error)); assert.equal(undo.proposal.command, 'UNDO')
  assert.equal(undo.proposal.expectedRevision, 2)
  return { sdk, runtime, baseline, undo, started, mode: value => { mode = value } }
}
async function approveOriginal(f) {
  f.runtime.getViewerCamera({ mode: 'proposal', planId: f.undo.proposal.planId })
  const applied = await f.runtime.approve(f.undo.proposal.planId)
  assert.equal(applied.status, 'applied', JSON.stringify(applied.error))
  assert.equal(applied.receipt.command, 'UNDO'); assert.equal(applied.receipt.beforeRevision, 2); assert.equal(applied.receipt.afterRevision, 3)
  const state = await f.runtime.exportLocalState(), reopened = await f.sdk.readDocument(state.drawing, { format: 'KJD' })
  assert.deepEqual(content(reopened), f.baseline, 'real undo restores all native resources and source facts')
  assert.equal((await f.runtime.approve(f.undo.proposal.planId)).error.code, 'AI_PROPOSAL_MISSING')
}

for (const mode of ['oversized', 'transport']) test('REV2 undo remains reviewable after failed next request: ' + mode, async t => {
  const f = await fixture(t); f.mode(mode)
  const saved = await f.runtime.exportLocalState()
  assert.equal(saved.drawingHistory.documentRevision, 2)
  const result = await f.runtime.send('复合请求失败诊断')
  assert.equal(result.status, 'error')
  if (mode === 'oversized') {
    assert.equal(result.error.code, 'KJMODEL_SIZE_LIMIT')
    assert.deepEqual(Object.keys(result.error.details).sort(), ['actualBytes', 'maxBytes', 'phase'])
    assert.equal(result.error.details.phase, 'response'); assert.equal(result.error.details.maxBytes, 1048576)
    assert.ok(result.error.details.actualBytes > result.error.details.maxBytes)
  }
  assert.equal(f.runtime.revision, 2)
  await approveOriginal(f)
})
test('in-flight approval is blocked, and cancelled next request preserves the original REV2 undo', async t => {
  const f = await fixture(t); f.mode('cancel')
  const controller = new AbortController(), started = f.started(), sending = f.runtime.send('下一条取消的请求', { signal: controller.signal })
  await started
  assert.equal((await f.runtime.approve(f.undo.proposal.planId)).error.code, 'AI_BUSY')
  controller.abort()
  assert.equal((await sending).status, 'cancelled'); assert.equal(f.runtime.revision, 2)
  await approveOriginal(f)
})
test('a successful read-only response does not supersede a valid undo review', async t => {
  const f = await fixture(t); f.mode('message')
  assert.equal((await f.runtime.send('只读说明当前历史，不改图')).status, 'message')
  assert.equal(f.runtime.revision, 2)
  await approveOriginal(f)
})
test('a successfully prepared replacement proposal explicitly supersedes the old review without approving either', async t => {
  const f = await fixture(t), replacement = await f.runtime.send('再生成撤销提案')
  assert.equal(replacement.status, 'proposal'); assert.notEqual(replacement.proposal.planId, f.undo.proposal.planId)
  assert.equal(f.runtime.revision, 2)
  assert.throws(() => f.runtime.getViewerCamera({ mode: 'proposal', planId: f.undo.proposal.planId }), /提案已失效/)
  assert.equal((await f.runtime.approve(f.undo.proposal.planId)).error.code, 'AI_PROPOSAL_MISSING')
  f.undo = replacement
  await approveOriginal(f)
})
test('manual native history change still invalidates the previous revision-bound undo plan', async t => {
  const f = await fixture(t)
  assert.equal((await f.runtime.applyHistory('undo')).status, 'applied')
  assert.equal(f.runtime.revision, 3)
  assert.equal((await f.runtime.approve(f.undo.proposal.planId)).error.code, 'AI_PROPOSAL_MISSING')
})

test('generic imported inventory guidance permits model-selected native 200-row paging without extra host reads', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-inventory-542', units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', { entities: Array.from({ length: 542 }, (_, index) => ({
    type: 'LINE', options: { id: 'PUBLIC-LINE-' + index }, payload: { start: [index, 0, 0], end: [index, 10, 0] },
  })) }, { document })
  const drawing = await sdk.writeDocument(document, { format: 'KJD' }), seen = [], pageSizes = []
  let requests = 0
  const runtime = createAiChatRuntime({ endpoint: 'https://public-pagination.invalid/v1/chat/completions', model: 'offline-protocol-fixture', captureToolOutputs: true,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body), context = body.messages.find(message => message.role === 'user').content, last = body.messages.at(-1)
      requests++
      assert.match(context, /cad_query_drawing with filters:\{\}, offset:0, layerOffset:0, limit:200, maxLayers:100, maxBytes:262144/)
      assert.match(context, /For a local named target, prefer cad_find_text and a local cad_query_drawing/)
      let offset = 0, layerOffset = 0
      if (last.role === 'tool') {
        const receipt = JSON.parse(last.content); assert.equal(receipt.ok, true)
        assert.equal(receipt.value.revision, runtime.revision)
        seen.push(...receipt.value.entities.map(entity => entity.id)); pageSizes.push(receipt.value.entities.length)
        if (receipt.value.nextOffset === null && receipt.value.nextLayerOffset === null)
          return Response.json({ choices: [{ message: { role: 'assistant', content: 'Complete native drawing inventory read.' }, finish_reason: 'stop' }] })
        offset = receipt.value.nextOffset ?? 0; layerOffset = receipt.value.nextLayerOffset ?? 0
      }
      return Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'inventory-' + requests,
        type: 'function', function: { name: 'cad_query_drawing', arguments: JSON.stringify({ expectedRevision: runtime.revision,
          filters: {}, offset, layerOffset, limit: 200, maxLayers: 100, maxBytes: 262144 }) } }] }, finish_reason: 'tool_calls' }] })
    } })
  t.after(() => { runtime.destroy(); for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) })
  await runtime.importDocument(new File([drawing], 'public-inventory.kjd'))
  const before = await runtime.exportLocalState(), result = await runtime.send('只读完整盘点这张图，不改图')
  assert.equal(result.status, 'message', JSON.stringify(result.error))
  assert.equal(requests, 4); assert.deepEqual(pageSizes, [200, 200, 142])
  assert.equal(seen.length, 542); assert.equal(new Set(seen).size, 542)
  assert.deepEqual([...seen].sort(), document.listEntities().map(entity => entity.id).sort())
  assert.equal(result.toolOutputs.length, 3); assert.ok(result.toolOutputs.every(output => output.name === 'cad_query_drawing' && output.result.ok))
  assert.equal((await runtime.exportLocalState()).drawing, before.drawing)
})

test('frozen scalar profile receives no new full-inventory pagination notice', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', { entities: [{ type: 'LINE', payload: { start: [0, 0, 0], end: [10, 0, 0] } }] }, { document })
  const drawing = await sdk.writeDocument(document, { format: 'KJD' })
  let requests = 0
  const runtime = createAiChatRuntime({ toolProfile: 'geology-scalars-v1', endpoint: 'https://public-scalar-notice.invalid/v1/chat/completions', model: 'offline-protocol-fixture',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body), context = body.messages.find(message => message.role === 'user').content
      assert.doesNotMatch(context, /When a complete native drawing inventory is relevant|limit:200, maxLayers:100|cad_read_page has a fixed small page size/)
      if (requests++ === 0) return Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
        id: 'scalar-notice-read', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' },
      }] }, finish_reason: 'tool_calls' }] })
      assert.equal(JSON.parse(body.messages.at(-1).content).ok, true)
      return Response.json({ choices: [{ message: { role: 'assistant', content: 'Read-only native drawing information.' }, finish_reason: 'stop' }] })
    } })
  t.after(() => { runtime.destroy(); for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) })
  await runtime.importDocument(new File([drawing], 'public-scalar.kjd'))
  assert.equal((await runtime.send('只读这张图，不改图')).status, 'message')
  assert.equal(requests, 2); assert.equal(runtime.revision, 1)
})
