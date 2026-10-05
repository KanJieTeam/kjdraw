import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { registerGeologyDrawingRecipe, readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'

// These network fixtures inspect actual runtime context and SDK receipts only;
// they are not evidence that any live provider follows the instructions.
async function sourceDrawing({ override = false } = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const source = { kind: 'column', input: { expectedRevision: 0, locale: 'zh-CN',
    hatchPack: structuredClone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK),
    hole: { id: 'SYNTHETIC-CONTEXT', collarElevation: 100, depth: 10, strata: [
      { intervalId: 'SYNTHETIC-L1', code: '1', name: '示例填土', lithology: 'fill', top: 0, bottom: 3,
        ...(override ? { patternKey: 'fill' } : {}) },
      { intervalId: 'SYNTHETIC-L2', code: '2', name: '示例黏土', lithology: 'clay', top: 3, bottom: 10 },
    ] } } }
  await sdk.executeCommand('CREATEBATCH', structuredClone(compileGeologyColumn(source.input).commandArgs), { document })
  const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
  return { sdk, document, recipe, dispose() { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}

const response = (name, args, content = '') => Response.json({ choices: [{ finish_reason: name ? 'tool_calls' : 'stop',
  message: { role: 'assistant', content, ...(name ? { tool_calls: [{ id: `fixture-${name}`, type: 'function',
    function: { name, arguments: JSON.stringify(args) } }] } : {}) } }] })
const userContext = body => body.messages.find(message => message.role === 'user').content
const languageContract = context => {
  assert.match(context, /Reply in the language of the current user request/)
  assert.match(context, /Keep user-facing prose concise/)
  assert.match(context, /do not expose internal tool names or object IDs unless the user asks/)
}

test('runtime source-backed geology uses compiler lithology mapping without requiring destination hatch in the imported drawing', async () => {
  const fixture = await sourceDrawing(), requests = []
  assert.equal(fixture.document.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternName === 'GEO_TOPSOIL'), false)
  const chat = createAiChatRuntime({ model: 'offline-context-fixture-not-live', endpoint: 'https://context-fixture.invalid/chat/completions',
    captureToolOutputs: true, fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body)
      return requests.length === 1 ? response('cad_read_geology_source', { expectedRevision: chat.revision, drawingId: fixture.recipe.drawingId, maxBytes: 262144 }) : response(null, null, '合成图的土类花纹由编译器映射。')
    } })
  try {
    await chat.importDocument(new File([await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })], 'synthetic-context.kjd'))
    const revision = chat.revision, result = await chat.send('请介绍这张示例图的土类花纹来源。')
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    const context = userContext(requests[0]); languageContract(context)
    assert.match(context, /Source-backed geology drawing IDs:/)
    assert.match(context, /compiler supplies its own patterns.*destination pattern need not already exist/)
    assert.match(context, /Use updates\[\]\.stratumChanges/)
    assert.match(context, /do not resend complete strata arrays/)
    assert.match(context, /Do not substitute a graphics-only HATCH edit or a text edit/)
    assert.doesNotMatch(context, /If the destination pattern or target scope is missing/)
    assert.doesNotMatch(context, /This imported DXF is graphics/)
    assert.equal(result.toolOutputs[0].result.ok, true)
    assert.equal(result.toolOutputs[0].result.value.sourceBacked, true)
    assert.equal(chat.revision, revision)
  } finally { chat.destroy(); fixture.dispose() }
})

test('runtime imported DXF graphics require a real available pattern resource and do not inherit source-backed mappings', async () => {
  const fixture = await sourceDrawing(), requests = []
  const chat = createAiChatRuntime({ model: 'offline-context-fixture-not-live', endpoint: 'https://context-fixture.invalid/chat/completions',
    captureToolOutputs: true, fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body)
      return requests.length === 1 ? response('cad_read_hatch_patterns', { expectedRevision: chat.revision, search: 'SYNTHETIC_MISSING_RESOURCE' }) : response(null, null, '请提供目标花纹资源。')
    } })
  try {
    await chat.importDocument(new File([await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' })], 'synthetic-context.dxf'))
    const before = await chat.exportLocalState(), result = await chat.send('请说明目标花纹缺失时需要什么资料。')
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    const context = userContext(requests[0]); languageContract(context)
    assert.match(context, /names may be native HATCH patternName values rather than TEXT labels/)
    assert.match(context, /an available pattern can be replaced through cad_propose_hatch_pattern without a geology source recipe/)
    assert.match(context, /If the destination pattern or target scope is missing, ask one focused resource\/layer question/)
    assert.match(context, /This imported DXF is graphics, not a verified borehole source table/)
    assert.doesNotMatch(context, /Source-backed geology drawing IDs:/)
    assert.doesNotMatch(context, /compiler supplies its own patterns/)
    assert.doesNotMatch(context, /Use updates\[\]\.stratumChanges/)
    assert.equal(result.toolOutputs[0].result.ok, true)
    assert.deepEqual(result.toolOutputs[0].result.value.patterns, [])
    assert.equal(result.text, '请提供目标花纹资源。')
    assert.equal((await chat.exportLocalState()).drawing, before.drawing)
  } finally { chat.destroy(); fixture.dispose() }
})

test('runtime source-backed explicit pattern overrides remain real facts and require clarification on conflicting changes', async () => {
  const fixture = await sourceDrawing({ override: true }), requests = []
  const chat = createAiChatRuntime({ model: 'offline-context-fixture-not-live', endpoint: 'https://context-fixture.invalid/chat/completions',
    captureToolOutputs: true, fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body)
      return requests.length === 1 ? response('cad_read_geology_source', { expectedRevision: chat.revision, drawingId: fixture.recipe.drawingId, maxBytes: 262144 }) : response(null, null, '这层已有显式花纹覆盖，请确认是否保留。')
    } })
  try {
    await chat.importDocument(new File([await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })], 'synthetic-explicit-override.kjd'))
    const before = await chat.exportLocalState(), result = await chat.send('请解释这张图的显式花纹覆盖如何处理。')
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    const context = userContext(requests[0]); languageContract(context)
    assert.match(context, /Retain any explicit source pattern overrides and all other unrequested facts/)
    assert.match(context, /If an explicit override conflicts.*ask about that specific override rather than inventing a resource/)
    const read = result.toolOutputs[0].result
    assert.equal(read.ok, true); assert.equal(read.value.facts.hole.strata[0].patternKey, 'fill')
    const after = await chat.exportLocalState()
    assert.equal(after.drawing, before.drawing)
    const actual = await fixture.sdk.readDocument(after.drawing, { format: 'KJD' })
    assert.equal(readGeologyDrawingRecipe(actual, fixture.recipe.drawingId).source.input.hole.strata[0].patternKey, 'fill')
  } finally { chat.destroy(); fixture.dispose() }
})

test('runtime reviewed stratum-name delta preserves explicit licensed pattern override and every unrequested source fact', async () => {
  const fixture = await sourceDrawing({ override: true }), requests = []
  const chat = createAiChatRuntime({ model: 'offline-context-fixture-not-live', endpoint: 'https://context-fixture.invalid/chat/completions',
    captureToolOutputs: true, fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body))
      if (requests.length === 1) return response('cad_read_geology_source', { expectedRevision: chat.revision, drawingId: fixture.recipe.drawingId, maxBytes: 262144 })
      return response('cad_propose_geology_revision', { expectedRevision: chat.revision, units: 'millimeter', drawingId: fixture.recipe.drawingId,
        updates: [{ holeId: 'SYNTHETIC-CONTEXT', stratumChanges: { update: [{ target: { intervalId: 'SYNTHETIC-L1', expectedTop: 0, expectedBottom: 3 },
          set: { name: '示例人工填土' } }] } }] })
    } })
  try {
    await chat.importDocument(new File([await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })], 'synthetic-override-revision.kjd'))
    const before = await chat.exportLocalState(), result = await chat.send('将第一层名称改为示例人工填土，保留土类和显式花纹覆盖。')
    assert.equal(result.status, 'proposal', JSON.stringify(result.error))
    assert.equal((await chat.exportLocalState()).drawing, before.drawing, 'a reviewed candidate does not mutate source/CAD')
    assert.equal((await chat.approve(result.proposal.planId)).status, 'applied')
    const after = await fixture.sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    const actual = readGeologyDrawingRecipe(after, fixture.recipe.drawingId).source
    const expected = structuredClone(fixture.recipe.source)
    expected.input.hole.strata[0].name = '示例人工填土'
    assert.deepEqual(actual, expected)
    assert.equal(actual.input.hole.strata[0].patternKey, 'fill')
    assert.ok(after.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternName === 'GEO_FILL'))
    assert.equal(after.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternName === 'GEO_TOPSOIL'), false)
  } finally { chat.destroy(); fixture.dispose() }
})
