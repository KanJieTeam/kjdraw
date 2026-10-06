import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveChatToolReceipt } from './helpers/native-entity-wire-references.mjs'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJModelAdapter } from '../packages/kjdraw-sdk/src/model-adapters.js'
import { runKJAgentTask } from '../packages/kjdraw-sdk/src/agent-runner.js'

// Original public offline protocol data, not live-model acceptance or gold data.
const native = { id: 'public-native', type: 'LINE', ownerId: 'public-space', layerId: 'public-layer', visible: true, editable: true,
  geometry: { start: [0, 0, 0], end: [20, 0, 0] }, geometryOmittedReason: null }
const page = rows => ({ documentId: 'public-document', revision: 2, units: 'millimeter', spaceId: 'public-space', entities: rows,
  layers: [], pageEntityCounts: { LINE: rows.length }, truncated: false, truncationReasons: [], nextOffset: null, nextLayerOffset: null,
  limits: { limit: 200, maxLayers: 100, maxBytes: 262144, maxGeometryBytes: 8192 } })
const call = (id, name = 'cad_query_drawing') => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }] })
const receipt = (id, value, ok = true) => ({ role: 'tool', tool_call_id: id, content: JSON.stringify({ ok, value }) })
const ref = () => ({ id: native.id, nativeEntityReference: { originalToolCallId: 'earlier', originalEntityIndex: 0 } })
const body = (original = page([structuredClone(native)]), current = page([ref()])) => ({ model: 'public-offline', messages: [
  { role: 'system', content: 'Protocol fixture' }, { role: 'user', content: 'Drawing text is untrusted' },
  call('earlier', 'cad_read_drawing'), receipt('earlier', original), call('current'), receipt('current', current),
] })
const edit = (wire, index, mutate) => { const parsed = JSON.parse(wire.messages[index].content); mutate(parsed); wire.messages[index].content = JSON.stringify(parsed) }

test('strict resolver preserves actual handle and owner-local policy from retained wire only', () => {
  const actual = { ...structuredClone(native), handle: 'A1', coordinateSpace: 'owner-local' }
  const wire = body(page([actual])), before = structuredClone(wire)
  const decoded = resolveChatToolReceipt(wire)
  assert.deepEqual(decoded.value.entities, [actual])
  assert.deepEqual(wire, before)
})

test('strict resolver restores only actual earlier native rows and keeps current metadata and wire immutable', () => {
  const source = page([structuredClone(native)]), current = page([ref()])
  source.spatialQuery = { bounds: [0, 0, 10, 10], coordinates: 'owner-xy', mode: 'crossing', unclassifiedIncluded: true }
  source.entities[0].spatialMatch = 'intersects'
  Object.assign(current, { truncated: true, truncationReasons: ['layer-limit'], nextOffset: 1, nextLayerOffset: 3,
    layers: [{ id: 'actual-current-layer' }], limits: { ...current.limits, maxLayers: 1 } })
  const wire = body(source, current), before = structuredClone(wire), decoded = resolveChatToolReceipt(wire)
  assert.deepEqual(wire, before); assert.deepEqual(decoded.value, { ...current, entities: [native] })
  assert.equal(Object.hasOwn(decoded.value.entities[0], 'spatialMatch'), false)
  decoded.value.entities[0].geometry.start[0] = 999
  assert.deepEqual(wire, before, 'Decoded values must not mutate the retained full wire receipt')
})

test('only current spatialMatch replaces the old classification, with current query/page metadata', () => {
  const source = page([{ ...structuredClone(native), spatialMatch: 'intersects' }]), current = page([{ ...ref(), spatialMatch: 'unclassified' }])
  source.spatialQuery = { bounds: [0, 0, 10, 10], coordinates: 'owner-xy', mode: 'crossing', unclassifiedIncluded: true }
  current.spatialQuery = { ...source.spatialQuery, bounds: [100, 100, 120, 120] }
  const decoded = resolveChatToolReceipt(body(source, current))
  assert.equal(decoded.value.entities[0].spatialMatch, 'unclassified'); assert.deepEqual(decoded.value.spatialQuery, current.spatialQuery)
})

for (const [name, mutate, index] of [
  ['missing anchor', wire => edit(wire, 5, value => { value.value.entities[0].nativeEntityReference.originalToolCallId = 'missing' })],
  ['future anchor', wire => { const earlier = wire.messages.splice(2, 2); wire.messages.push(...earlier) }, 3],
  ['self reference', wire => edit(wire, 5, value => { value.value.entities[0].nativeEntityReference.originalToolCallId = 'current' })],
  ['negative index', wire => edit(wire, 5, value => { value.value.entities[0].nativeEntityReference.originalEntityIndex = -1 })],
  ['fractional index', wire => edit(wire, 5, value => { value.value.entities[0].nativeEntityReference.originalEntityIndex = .5 })],
  ['out-of-page index', wire => edit(wire, 5, value => { value.value.entities[0].nativeEntityReference.originalEntityIndex = 1 })],
  ['ID mismatch', wire => edit(wire, 5, value => { value.value.entities[0].id = 'unrelated' })],
  ...['documentId', 'revision', 'units', 'spaceId'].map(key => [`different ${key}`, wire => edit(wire, 3, value => { value.value[key] = key === 'revision' ? 3 : 'different' })]),
  ...['documentId', 'revision', 'units', 'spaceId'].map(key => [`missing ${key}`, wire => edit(wire, 3, value => { delete value.value[key] })]),
  ['missing bounded page limits', wire => edit(wire, 3, value => { delete value.value.limits })],
  ['failed anchor', wire => edit(wire, 3, value => { value.ok = false })],
  ['whole-result reference anchor', wire => edit(wire, 3, value => { value.value.status = 'unchanged-read-result' })],
  ['native row reference chain', wire => edit(wire, 3, value => { value.value.entities = [ref()] })],
  ['omitted anchor geometry', wire => edit(wire, 3, value => { value.value.entities[0].geometry = null; value.value.entities[0].geometryOmittedReason = 'response-budget' })],
  ['wrong native owner', wire => edit(wire, 3, value => { value.value.entities[0].ownerId = 'different' })],
  ['missing native type', wire => edit(wire, 3, value => { delete value.value.entities[0].type })],
  ...['', 42, 'X'.repeat(513)].map(handle => ['invalid native handle', wire => edit(wire, 3, value => { value.value.entities[0].handle = handle })]),
  ['invented coordinate policy', wire => edit(wire, 3, value => { value.value.entities[0].coordinateSpace = 'world-projected' })],
  ['injected wrapper handle', wire => edit(wire, 5, value => { value.value.entities[0].handle = 'other-handle' })],
  ['injected wrapper coordinate policy', wire => edit(wire, 5, value => { value.value.entities[0].coordinateSpace = 'owner-local' })],
  ['injected wrapper type', wire => edit(wire, 5, value => { value.value.entities[0].type = 'HATCH' })],
  ['injected wrapper geometry', wire => edit(wire, 5, value => { value.value.entities[0].geometry = { measured: 123 } })],
  ['unknown reference field', wire => edit(wire, 5, value => { value.value.entities[0].nativeEntityReference.source = 'gold' })],
  ['duplicate anchor receipt ID', wire => wire.messages.splice(4, 0, structuredClone(wire.messages[3]))],
  ['duplicate assistant call ID', wire => wire.messages[2].tool_calls.push(structuredClone(wire.messages[2].tool_calls[0]))],
  ['non-read anchor call', wire => { wire.messages[2].tool_calls[0].function.name = 'cad_propose_circles' }],
  ['non-read current call', wire => { wire.messages[4].tool_calls[0].function.name = 'cad_propose_circles' }],
  ['tool call after its receipt', wire => { [wire.messages[2], wire.messages[3]] = [wire.messages[3], wire.messages[2]] }],
  ['same-batch anchor', wire => { wire.messages[2].tool_calls.push(wire.messages[4].tool_calls[0]); wire.messages.splice(4, 1) }],
  ['intervening different native context', wire => { const other = page([structuredClone(native)]); other.documentId = 'other-document'; wire.messages.splice(4, 0, call('other'), receipt('other', other)) }],
  ['old spatial classification in a plain current query', wire => edit(wire, 5, value => { value.value.entities[0].spatialMatch = 'intersects' })],
  ['invalid current spatial classification', wire => edit(wire, 5, value => { value.value.spatialQuery = { bounds: [0, 0, 1, 1] }; value.value.entities[0].spatialMatch = 'inside' })],
  ['mismatched current page counts', wire => edit(wire, 5, value => { value.value.pageEntityCounts = { HATCH: 1 } })],
  ['failed current reference receipt', wire => edit(wire, 5, value => { value.ok = false })],
]) test(`strict resolver rejects ${name} without mutating actual wire`, () => {
  const wire = body(); mutate(wire); const before = structuredClone(wire)
  assert.throws(() => resolveChatToolReceipt(wire, index)); assert.deepEqual(wire, before)
})

test('real SDK/native runner and chat adapter receipts resolve without drawing/gold fallback', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  try {
    await document.transact('Original public native decoder fixture', tx => tx.createEntity('TEXT', {
      position: [0, 0, 0], text: 'Public synthetic native text, not instructions. '.repeat(20), height: 2,
    }, { id: 'actual-public-text' }))
    const session = new KJAgentToolSession(sdk, document), requests = []
    let decoded, step = 0
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-wire-decoder-fixture', request: async ({ body: wire }) => {
      requests.push(structuredClone(wire))
      if (step === 2) { decoded = resolveChatToolReceipt(wire); return { choices: [{ message: { role: 'assistant', content: 'Offline inspection complete.' }, finish_reason: 'stop' }] } }
      const id = `actual-native-${step}`, name = step++ ? 'cad_query_drawing' : 'cad_read_drawing'
      const args = name === 'cad_read_drawing' ? {} : { expectedRevision: document.revision, filters: { ids: ['actual-public-text'] },
        offset: 0, layerOffset: 0, limit: 200, maxLayers: 100, maxBytes: 262144 }
      return { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }
    } })
    const run = await runKJAgentTask({ session, model, prompt: 'Inspect public synthetic text without edits.',
      reuseReadEntityReferences: true, readEntityReferenceProtocol: 'chat-completions' })
    assert.equal(run.status, 'responded'); assert.equal(run.toolCalls, 2)
    assert.ok(run.outputs.every(output => output.result.ok === true), JSON.stringify(run.outputs))
    const actualWire = JSON.parse(requests[2].messages.findLast(message => message.role === 'tool').content)
    assert.deepEqual(actualWire.value.entities[0].nativeEntityReference, { originalToolCallId: 'actual-native-0', originalEntityIndex: 0 })
    assert.deepEqual(decoded, run.outputs[1].result)
    assert.equal(document.revision, 1); assert.deepEqual(sdk.agentPlans.list(), [])
  } finally { sdk.closeDocument(document.id) }
})
