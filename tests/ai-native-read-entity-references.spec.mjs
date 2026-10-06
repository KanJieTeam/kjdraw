import test from 'node:test'
import assert from 'node:assert/strict'
import { runKJAgentTask } from '../packages/kjdraw-sdk/src/agent-runner.js'
import { createKJModelAdapter } from '../packages/kjdraw-sdk/src/model-adapters.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'

// Offline protocol/native fixtures only: none of these are real-model passes.
const clone = structuredClone
const query = 'cad_query_drawing'
const nativeNames = ['cad_read_drawing', 'cad_read_page', query]
const bytes = value => Buffer.byteLength(JSON.stringify(value))
const ref = row => row.nativeEntityReference
function row(id = 'public-text', text = 'Public native text. '.repeat(40)) {
  return { id, type: 'TEXT', ownerId: 'public-owner', layerId: 'public-layer', visible: true, editable: true,
    geometry: { position: [0, 0, 0], alignmentPoint: [0, 0, 0], text, height: 2, rotation: 0,
      styleId: 'public-style', horizontalAlignment: 0, verticalAlignment: 0 }, geometryOmittedReason: null }
}
function page(rows = [row()], extra = {}) {
  const pageEntityCounts = {}
  for (const entity of rows) Object.defineProperty(pageEntityCounts, entity.type, {
    enumerable: true, configurable: true, writable: true, value: (Object.hasOwn(pageEntityCounts, entity.type) ? pageEntityCounts[entity.type] : 0) + 1,
  })
  return { documentId: 'public-document', revision: 0, units: 'millimeter', spaceId: 'public-owner', layers: [], entities: clone(rows),
    pageEntityCounts, truncated: false, truncationReasons: [], nextOffset: null, nextLayerOffset: null,
    limits: { limit: 200, maxLayers: 100, maxBytes: 262144, maxGeometryBytes: 8192 }, ...extra }
}
function spatial(rows = [row()], match = 'unclassified', extra = {}) {
  return page(rows.map(entity => ({ ...entity, spatialMatch: match })), {
    spatialQuery: { bounds: [0, 0, 20, 20], coordinates: 'owner-xy', mode: 'crossing', unclassifiedIncluded: true }, ...extra,
  })
}

test('native handles and coordinate policy remain exact in reusable read evidence; changed handles are not the same row', async () => {
  const native = { ...row(), handle: 'AB', coordinateSpace: 'owner-local' }
  const changed = { ...native, handle: 'CD' }
  const { inputs } = await runPages([page([native]), page([native]), page([changed]), page([changed])])
  assert.deepEqual(inputs[1].results[0].result.value.entities[0], native)
  assert.ok(ref(inputs[2].results[0].result.value.entities[0]))
  assert.deepEqual(inputs[3].results[0].result.value.entities[0], changed)
  assert.ok(ref(inputs[4].results[0].result.value.entities[0]))
})

test('invalid or future handle/coordinate policies retain full native receipts rather than unsafe reference reuse', async () => {
  for (const fields of [{ handle: '' }, { handle: 10 }, { coordinateSpace: 'invented-world-space' }]) {
    const receipt = page([{ ...row(), ...fields }])
    const { inputs } = await runPages([receipt, receipt])
    assert.deepEqual(inputs[2].results[0].result.value, receipt)
    assert.equal(ref(inputs[2].results[0].result.value.entities[0]), undefined)
  }
})
async function runPages(values, options = {}) {
  const { names = values.map(() => query), ids = values.map((_, index) => `read-${index}`), effects = {}, onInput, onConversation,
    throwAt, callsAtTurn, ...runOptions } = options
  const inputs = [], nativeCalls = [], definitions = [...new Set(names)].map(name => ({ name, effect: effects[name] ?? 'read',
    description: 'Public offline native receipt fixture', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }))
  let callIndex = 0, turnIndex = 0
  const session = { definitions, call: async (name, args) => { nativeCalls.push({ name, args }); const value = values[callIndex++];
    return value?.ok === false ? value : { ok: true, value } }, reject: () => { throw new Error('No approval/proposal fixture allowed') } }
  const model = { createConversation: conversationOptions => { onConversation?.(conversationOptions); return { next: async input => {
    inputs.push(input); onInput?.(input, turnIndex)
    if (throwAt === turnIndex++) throw new Error('Public offline transport failure')
    if (callIndex >= values.length) return { text: 'Read-only fixture complete.', calls: [] }
    const count = callsAtTurn?.[turnIndex - 1] ?? 1
    return { text: '', calls: Array.from({ length: count }, (_, offset) => ({ id: ids[callIndex + offset], name: names[callIndex + offset], arguments: {} })) }
  } } } }
  const result = await runKJAgentTask({ session, model, prompt: 'Inspect public native objects without modifying the drawing.',
    maxTurns: 32, maxToolCalls: 128, reuseReadEntityReferences: true, readEntityReferenceProtocol: 'chat-completions', ...runOptions })
  return { result, inputs, nativeCalls }
}

test('only later wire rows shrink; native outputs, first complete receipt and query metadata remain exact', async () => {
  const initial = page([row('zero-position'), row('second')]), next = spatial([row('second'), row('zero-position')], 'unclassified', {
    layers: [{ id: 'public-layer', name: '0' }], truncated: true, truncationReasons: ['entity-limit'], nextOffset: 2, nextLayerOffset: 1,
  })
  const before = clone([initial, next]), { inputs, result, nativeCalls } = await runPages([initial, next])
  assert.equal(result.status, 'responded'); assert.equal(nativeCalls.length, 2)
  assert.deepEqual(inputs[1].results[0].result.value, initial)
  const reduced = inputs[2].results[0].result.value
  assert.deepEqual({ ...reduced, entities: next.entities }, next)
  assert.deepEqual(ref(reduced.entities[0]), { originalToolCallId: 'read-0', originalEntityIndex: 1 })
  assert.deepEqual(ref(reduced.entities[1]), { originalToolCallId: 'read-0', originalEntityIndex: 0 })
  assert.equal(reduced.entities[0].id, 'second'); assert.equal(reduced.entities[0].spatialMatch, 'unclassified')
  assert.ok(bytes(reduced) < bytes(next)); assert.deepEqual(result.outputs.map(output => output.result.value), before)
  assert.deepEqual([initial, next], before); assert.equal(result.outputs.some(output => ref(output.result.value.entities[0])), false)
})

for (const name of nativeNames) test(`${name} complete native rows can anchor a later query`, async () => {
  const { inputs } = await runPages([page(), spatial()], { names: [name, query] })
  assert.equal(ref(inputs[2].results[0].result.value.entities[0]).originalToolCallId, 'read-0')
})

test('four repeated reads always reference the earlier full row, never a reference chain', async () => {
  const { inputs, result } = await runPages([page(), spatial(), spatial(), page()])
  for (const input of inputs.slice(2)) {
    const entity = input.results[0].result.value.entities[0]
    assert.deepEqual(ref(entity), { originalToolCallId: 'read-0', originalEntityIndex: 0 })
  }
  assert.equal(Object.hasOwn(inputs.at(-1).results[0].result.value.entities[0], 'spatialMatch'), false)
  assert.equal(result.outputs.length, 4); assert.ok(result.outputs.every(output => output.result.value.entities[0].geometry.text))
})

test('spatial classification belongs only to the current wrapper, including reverse absence and different bounds', async () => {
  const first = spatial([row()], 'intersects'), plain = page(), other = spatial([row()], 'unclassified', {
    spatialQuery: { bounds: [100, 100, 120, 120], coordinates: 'owner-xy', mode: 'crossing', unclassifiedIncluded: true },
  })
  const { inputs } = await runPages([first, plain, other])
  assert.equal(Object.hasOwn(inputs[2].results[0].result.value.entities[0], 'spatialMatch'), false)
  assert.equal(Object.hasOwn(inputs[2].results[0].result.value, 'spatialQuery'), false)
  assert.equal(inputs[3].results[0].result.value.entities[0].spatialMatch, 'unclassified')
  assert.deepEqual(inputs[3].results[0].result.value.spatialQuery, other.spatialQuery)
  assert.equal(ref(inputs[3].results[0].result.value.entities[0]).originalToolCallId, 'read-0')
})

test('same-batch duplicate native reads are both full; a later batch references the first visible full call', async () => {
  const { inputs } = await runPages([page(), page(), spatial()], { callsAtTurn: [2, 1] })
  assert.equal(inputs[1].results.length, 2)
  assert.ok(inputs[1].results.every(output => output.result.value.entities[0].geometry))
  assert.deepEqual(ref(inputs[2].results[0].result.value.entities[0]), { originalToolCallId: 'read-0', originalEntityIndex: 0 })
})

for (const options of [{ reuseReadEntityReferences: false }, { reuseReadEntityReferences: undefined },
  { readEntityReferenceProtocol: undefined }, { readEntityReferenceProtocol: 'gemini-generate-content' }]) {
  test(`disabled or non-referenceable protocol keeps complete inputs: ${JSON.stringify(options)}`, async () => {
    const values = [page(), spatial()], { inputs } = await runPages(values, options)
    assert.deepEqual(inputs[2].results[0].result.value, values[1])
  })
}
test('trusted reference instructions exist only in the explicitly enabled referenceable-protocol contract', async () => {
  let baseline
  await runPages([page()], { reuseReadEntityReferences: false, onConversation: value => { baseline = value.instructions } })
  assert.doesNotMatch(baseline, /Host opt-in native entity reference protocol/)
  for (const options of [{ reuseReadEntityReferences: false }, { reuseReadEntityReferences: undefined },
    { readEntityReferenceProtocol: undefined }, { readEntityReferenceProtocol: 'gemini-generate-content' }]) {
    await runPages([page()], { ...options, onConversation: value => assert.equal(value.instructions, baseline) })
  }
  for (const protocol of ['chat-completions', 'responses', 'anthropic-messages']) {
    await runPages([page()], { readEntityReferenceProtocol: protocol, onConversation: value => {
      assert.ok(value.instructions.startsWith(baseline))
      assert.match(value.instructions, /value\.entities\[originalEntityIndex\]/)
      assert.match(value.instructions, /discard its old spatialMatch/)
      assert.match(value.instructions, /absent current spatialMatch means no spatial classification/)
      assert.match(value.instructions, /not approval, edit receipts or verified geology source facts/)
    } })
  }
})
for (const value of [null, 1, 'true', {}, []]) test(`invalid entity reference opt-in fails before model use: ${JSON.stringify(value)}`, async () => {
  await assert.rejects(runPages([page()], { reuseReadEntityReferences: value }), error => error.code === 'KJAGENT_OPTIONS')
})
for (const value of [null, 1, '', 'chat', {}, []]) test(`invalid reference protocol fails before model use: ${JSON.stringify(value)}`, async () => {
  await assert.rejects(runPages([page()], { readEntityReferenceProtocol: value }), error => error.code === 'KJAGENT_OPTIONS')
})

for (const [label, change] of [
  ['document', value => { value.documentId = 'other-document' }],
  ['revision', value => { value.revision = 1 }],
  ['units', value => { value.units = 'meter' }],
  ['space', value => { value.spaceId = 'other-owner'; value.entities[0].ownerId = 'other-owner' }],
  ['identity', value => { value.entities[0].id = 'different-id' }],
  ['geometry', value => { value.entities[0].geometry.position[0] = 1 }],
  ['text', value => { value.entities[0].geometry.text = 'Different actual text.' }],
  ['owner mismatch', value => { value.entities[0].ownerId = 'wrong-owner' }],
  ['layer', value => { value.entities[0].layerId = 'other-layer' }],
  ['visible', value => { value.entities[0].visible = false }],
  ['editable', value => { value.entities[0].editable = false }],
  ['type', value => { value.entities[0].type = 'MTEXT'; value.pageEntityCounts = { MTEXT: 1 } }],
  ['omitted geometry', value => { value.entities[0].geometry = null; value.entities[0].geometryOmittedReason = 'response-budget' }],
  ['omitted reason', value => { value.entities[0].geometryOmittedReason = 'unsupported-data' }],
  ['new native row field', value => { value.entities[0].futureField = 'Keep fully.' }],
  ['source recipe envelope', value => { value.source = { measuredDepth: 12 } }],
  ['wrong page counts', value => { value.pageEntityCounts.TEXT = 2 }],
  ['duplicate native identity', value => { value.entities.push(clone(value.entities[0])); value.pageEntityCounts.TEXT = 2 }],
  ['unknown limits', value => { value.limits.maxGeometryBytes = 16384 }],
  ['non-native row budget', value => { value.entities[0].geometry.text = 'x'.repeat(8192) }],
  ['invalid query classification', value => { value.entities[0].spatialMatch = 'inside' }],
  ['native property order', value => { const old = value.entities[0]; value.entities[0] = { type: old.type, id: old.id,
    ...Object.fromEntries(Object.entries(old).filter(([key]) => !['id', 'type'].includes(key))) } }],
]) test(`changed or unsupported ${label} keeps the complete current native receipt`, async () => {
  const next = spatial(); change(next)
  const { inputs, result } = await runPages([page(), next])
  assert.deepEqual(inputs[2].results[0].result.value, next); assert.deepEqual(result.outputs[1].result.value, next)
})

test('changed complete native row becomes a new full anchor, not an old-object reference', async () => {
  const changed = page([row('public-text', 'Changed native text. '.repeat(40))])
  const { inputs } = await runPages([page(), changed, spatial(changed.entities)])
  assert.deepEqual(inputs[2].results[0].result.value, changed)
  assert.deepEqual(ref(inputs[3].results[0].result.value.entities[0]), { originalToolCallId: 'read-1', originalEntityIndex: 0 })
})

for (const name of ['cad_read_geology_source', 'cad_check_geometry', 'cad_propose_structural_edit']) test(`${name} never supplies native-row references`, async () => {
  const values = [page(), spatial()], { inputs } = await runPages(values, { names: [name, name], effects: { [name]: name.startsWith('cad_read') ? 'read' : 'propose' } })
  assert.deepEqual(inputs[2].results[0].result.value, values[1])
})
test('a non-read definition using an allowlisted name remains complete', async () => {
  const values = [page(), spatial()], { inputs } = await runPages(values, { effects: { [query]: 'propose' } })
  assert.deepEqual(inputs[2].results[0].result.value, values[1])
})
test('an actual failed read remains full and does not anchor future rows', async () => {
  const failure = { ok: false, error: { code: 'PUBLIC_OFFLINE_READ_FAILURE', message: 'Fixture read failed.' } }
  const { inputs } = await runPages([failure, spatial()])
  assert.deepEqual(inputs[1].results[0].result, failure); assert.ok(inputs[2].results[0].result.value.entities[0].geometry)
})
test('a duplicate model call ID rejects the complete batch before another native dispatch', async () => {
  const { result, nativeCalls, inputs } = await runPages([page(), spatial()], { ids: ['same-call', 'same-call'] })
  assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'KJMODEL_CALL_ID'); assert.equal(nativeCalls.length, 1)
  assert.equal(inputs.length, 2); assert.ok(result.outputs[0].result.value.entities[0].geometry)
})
test('non-referenceable visible call ID shape conservatively keeps later rows complete', async () => {
  const { inputs } = await runPages([page(), spatial()], { ids: ['visible id with spaces', 'read-1'] })
  assert.ok(inputs[2].results[0].result.value.entities[0].geometry)
})
test('failed model consumption retains the complete audit receipt without inventing a future anchor/read', async () => {
  const { inputs, result, nativeCalls } = await runPages([page(), spatial()], { throwAt: 1 })
  assert.equal(result.status, 'failed'); assert.equal(nativeCalls.length, 1)
  assert.ok(inputs[1].results[0].result.value.entities[0].geometry); assert.ok(result.outputs[0].result.value.entities[0].geometry)
})
test('new runs start with full receipts, never cross-conversation anchors', async () => {
  for (let run = 0; run < 2; run++) {
    const { inputs } = await runPages([page(), spatial()])
    assert.ok(inputs[1].results[0].result.value.entities[0].geometry)
    assert.equal(ref(inputs[2].results[0].result.value.entities[0]).originalToolCallId, 'read-0')
  }
})
test('prototype-looking native IDs are safe Map identities, not object keys', async () => {
  const rows = [row('__proto__'), row('constructor'), row('toString')], { inputs } = await runPages([page(rows), spatial(rows)])
  assert.deepEqual(inputs[2].results[0].result.value.entities.map(entity => entity.id), rows.map(entity => entity.id))
  assert.ok(inputs[2].results[0].result.value.entities.every(entity => ref(entity)))
})
test('small native rows remain complete when an explicit reference would be longer', async () => {
  const tiny = { id: 'p', type: 'POINT', ownerId: 'public-owner', layerId: null, visible: true, editable: true,
    geometry: { position: [0, 0, 0] }, geometryOmittedReason: null }
  const longId = 'p'.repeat(256), values = [page([tiny]), page([tiny])]
  const { inputs } = await runPages(values, { ids: [longId, 'read-1'] })
  assert.deepEqual(inputs[2].results[0].result.value, values[1])
})

test('2048-row cache cap falls back to full rows without dropping any entity', async () => {
  const make = id => row(id, 'x'.repeat(200))
  const seed = Array.from({ length: 11 }, (_, index) => page(Array.from({ length: 200 }, (_, offset) => make(`public-${index * 200 + offset}`))))
  const later = page([make('public-0'), make('public-2048'), make('public-2199')])
  const { inputs, result } = await runPages([...seed, later])
  const entities = inputs.at(-1).results[0].result.value.entities
  assert.equal(entities.length, 3); assert.ok(ref(entities[0])); assert.ok(entities[1].geometry); assert.ok(entities[2].geometry)
  assert.equal(result.outputs.reduce((count, output) => count + output.result.value.entities.length, 0), 2203)
})
test('two-MiB native-row cache cap falls back to full even before the row cap', async () => {
  const make = id => row(id, 'x'.repeat(7800))
  const seed = Array.from({ length: 14 }, (_, index) => page(Array.from({ length: 20 }, (_, offset) => make(`large-${index * 20 + offset}`))))
  const later = page([make('large-0'), make('large-279')]), { inputs, result } = await runPages([...seed, later])
  const entities = inputs.at(-1).results[0].result.value.entities
  assert.ok(ref(entities[0])); assert.ok(entities[1].geometry); assert.equal(result.outputs.length, 15)
})

function wire(protocol, calls = [], text = '') {
  if (protocol === 'responses') return { status: 'completed', output: [...calls.map(call => ({ type: 'function_call', id: `item-${call.id}`,
    call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) })), ...(text ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] : [])] }
  if (protocol === 'chat-completions') return { choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: {
    role: 'assistant', content: text || null, tool_calls: calls.map(call => ({ type: 'function', id: call.id, function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } }] }
  if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: calls.length ? 'tool_use' : 'end_turn',
    content: [...calls.map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })), ...(text ? [{ type: 'text', text }] : [])] }
  return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [...calls.map(call => ({ functionCall: { name: call.name, args: call.arguments } })), ...(text ? [{ text }] : [])] } }] }
}
function wireResults(protocol, body) {
  if (protocol === 'responses') return body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output))
  if (protocol === 'chat-completions') return body.messages.filter(item => item.role === 'tool').map(item => JSON.parse(item.content))
  if (protocol === 'anthropic-messages') return body.messages.filter(item => item.role === 'user').flatMap(item => Array.isArray(item.content)
    ? item.content.filter(block => block.type === 'tool_result').map(block => JSON.parse(block.content)) : [])
  return body.contents.flatMap(item => item.parts.filter(part => part.functionResponse).map(part => part.functionResponse.response))
}
for (const protocol of ['chat-completions', 'responses', 'anthropic-messages', 'gemini-generate-content']) {
  for (const wholeReferences of [false, true]) test(`${protocol}/whole=${wholeReferences}: four actual native reads retain full first/history/audit without chained references`, async t => {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-protocol-native', units: 'millimeter' })
    await document.transact('Public native fixture', tx => tx.createEntity('TEXT', { position: [0, 0, 0], text: 'Public real native receipt. '.repeat(40), height: 2 }, { id: 'public-actual-text' }))
    const session = new KJAgentToolSession(sdk, document), requests = [], before = document.serialize()
    t.after(() => { sdk.closeDocument(document.id) })
    const args = { expectedRevision: document.revision, filters: {}, offset: 0, layerOffset: 0, limit: 200, maxLayers: 100, maxBytes: 262144 }
    const model = createKJModelAdapter({ protocol, model: 'public-offline-reference-fixture', reuseReadResultReferences: wholeReferences,
      request: async ({ body }) => { requests.push(body); return requests.length < 5
        ? wire(protocol, [{ id: `actual-read-${requests.length}`, name: query, arguments: args }]) : wire(protocol, [], 'Actual native reads complete; no edit.') } })
    const result = await runKJAgentTask({ session, model, prompt: 'Inspect native objects; do not edit.', reuseReadEntityReferences: true, readEntityReferenceProtocol: protocol })
    assert.equal(result.status, 'responded'); assert.equal(result.outputs.length, 4); assert.equal(document.serialize(), before)
    const history = wireResults(protocol, requests.at(-1)), first = history[0].value.entities[0]
    assert.equal(first.geometry.text, 'Public real native receipt. '.repeat(40)); assert.equal(history.length, 4)
    for (const current of history.slice(1)) {
      if (protocol === 'gemini-generate-content') assert.deepEqual(current.value.entities[0], first)
      else assert.deepEqual(ref(current.value.entities[0]), { originalToolCallId: 'actual-read-1', originalEntityIndex: 0 })
    }
    assert.ok(result.outputs.every(output => output.result.value.entities[0].geometry.text === first.geometry.text))
    assert.deepEqual(result.proposalIds, [])
  })
}
