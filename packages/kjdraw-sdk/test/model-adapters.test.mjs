import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJModelAdapter } from '../src/model-adapters.js'
import { runKJAgentTask } from '../src/agent-runner.js'
import { mountingProfile } from '../examples/fixtures/mounting-profile.mjs'

const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
const args = { expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 20, y: 25 }, radius: 3 }] }
const call = (id, name, arguments_ = {}) => ({ id, name, arguments: arguments_ })
function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'model-conformance', units: 'millimeter' })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
function wire(protocol, calls = [], text = '') {
  if (protocol === 'responses') return { status: 'completed', output: [
    { type: 'reasoning', id: 'reasoning-item', encrypted_content: 'opaque-signed-reasoning' },
    ...calls.map(c => ({ type: 'function_call', id: `item-${c.id}`, call_id: c.id, name: c.name, arguments: JSON.stringify(c.arguments) })),
    ...(text ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] : []),
  ] }
  if (protocol === 'chat-completions') return { choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: text || null, reasoning_content: 'opaque-provider-reasoning', tool_calls: calls.map(c => ({ type: 'function', id: c.id, function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } }] }
  if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: calls.length ? 'tool_use' : 'end_turn', content: [{ type: 'thinking', thinking: 'provider-thinking', signature: 'opaque-signature' }, ...calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments })), ...(text ? [{ type: 'text', text }] : [])] }
  return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'provider-thinking', thought: true, thoughtSignature: 'opaque-thought-signature' }, ...calls.map(c => ({ functionCall: { id: c.id, name: c.name, args: c.arguments } })), ...(text ? [{ text }] : [])] } }] }
}
function resultAtEnd(protocol, body) {
  if (protocol === 'responses') return JSON.parse(body.input.at(-1).output)
  if (protocol === 'chat-completions') return JSON.parse(body.messages.at(-1).content)
  if (protocol === 'anthropic-messages') return JSON.parse(body.messages.at(-1).content[0].content)
  return body.contents.at(-1).parts[0].functionResponse.response
}
function assertContinuation(protocol, body) {
  if (protocol === 'responses') {
    assert.ok(body.input.some(item => item.encrypted_content === 'opaque-signed-reasoning'))
    assert.equal(body.input.at(-1).call_id, 'read')
    assert.equal(body.store, false)
    assert.deepEqual(body.include, ['reasoning.encrypted_content'])
  } else if (protocol === 'chat-completions') {
    assert.equal(body.messages.at(-2).reasoning_content, 'opaque-provider-reasoning')
    assert.equal(body.messages.at(-1).tool_call_id, 'read')
  } else if (protocol === 'anthropic-messages') {
    assert.equal(body.messages.at(-2).content[0].signature, 'opaque-signature')
    assert.equal(body.messages.at(-1).content[0].tool_use_id, 'read')
    assert.equal(body.messages.at(-1).content[0].is_error, false)
  } else {
    assert.equal(body.contents.at(-2).parts[0].thoughtSignature, 'opaque-thought-signature')
    assert.equal(body.contents.at(-1).parts[0].functionResponse.id, 'read')
    assert.equal(body.model, undefined)
  }
}

for (const protocol of protocols) {
  test(`${protocol}: actual object checks return failed requirements as successful read results`, async () => {
    const { document, session } = fixture()
    await document.transact('Measured geometry', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [3, 4, 12] }, { id: 'inspection-line' }))
    const before = document.serialize()
    let step = 0
    const model = createKJModelAdapter({ protocol, model: 'offline-geometry-check-fixture', request: async ({ body }) => {
      const defs = protocol === 'gemini-generate-content' ? body.tools[0].functionDeclarations : body.tools
      assert.deepEqual(defs.map(tool => tool.function?.name ?? tool.name).sort(), ['cad_check_geometry', 'cad_read_drawing'])
      const def = defs.find(tool => (tool.function?.name ?? tool.name) === 'cad_check_geometry')
      const schema = def.function?.parameters ?? def.parameters ?? def.input_schema ?? def.parametersJsonSchema
      assert.equal(schema.additionalProperties, false)
      assert.deepEqual(schema.required, ['expectedRevision', 'units', 'lineLengths', 'circleRadii', 'pointDistances', 'polylineClosures'])
      assert.equal(schema.properties.lineLengths.maxItems, 64)
      if (step++ === 0) return wire(protocol, [call('read', 'cad_read_drawing')])
      const toolResult = resultAtEnd(protocol, body)
      assert.equal(toolResult.ok, true, JSON.stringify(toolResult))
      if (step === 2) {
        const entity = toolResult.value.entities.find(item => item.type === 'LINE')
        assert.equal(entity.id, 'inspection-line')
        return wire(protocol, [call('check', 'cad_check_geometry', { expectedRevision: toolResult.value.revision, units: toolResult.value.units,
          lineLengths: [{ id: 'requested-length', objectId: entity.id, expected: 20, tolerance: 0.001 }], circleRadii: [], pointDistances: [], polylineClosures: [] })])
      }
      assert.equal(toolResult.value.passed, false)
      assert.equal(toolResult.value.checks[0].actual, 13)
      assert.equal(toolResult.value.checks[0].expected, 20)
      assert.equal(toolResult.value.checks[0].error, 7)
      if (protocol === 'anthropic-messages') assert.equal(body.messages.at(-1).content[0].is_error, false)
      return wire(protocol, [], 'The actual line is 13 mm; the required 20 mm length failed by 7 mm. No edits were applied.')
    } })
    const result = await runKJAgentTask({ session, model, prompt: 'Check that the existing line is 20 mm long within 0.001 mm.', toolNames: ['cad_read_drawing', 'cad_check_geometry'] })
    assert.equal(result.status, 'responded', JSON.stringify(result))
    assert.match(result.text, /failed by 7 mm/)
    assert.equal(result.outputs[1].result.ok, true)
    assert.equal(result.outputs[1].result.value.passed, false)
    assert.deepEqual(result.proposalIds, [])
    assert.equal(document.serialize(), before)
  })
  test(`${protocol}: queried construction lines become a reviewed direction-preserving move`, async () => {
    const { document, session } = fixture()
    await document.transact('guides', tx => {
      tx.createEntity('XLINE', { origin: [1000000,10,3], direction: [3,4,0] }, { id: 'guide' })
      tx.createEntity('RAY', { origin: [-1000000,20,6], direction: [-3,0,4] }, { id: 'ray' })
    })
    const before = document.serialize()
    let requests = 0
    const model = createKJModelAdapter({ protocol, model: 'offline-guide-fixture', request: async ({ body }) => {
      if (requests++ === 0) return wire(protocol, [call('read', 'cad_read_drawing')])
      const result = resultAtEnd(protocol, body)
      assert.equal(result.ok, true)
      assert.deepEqual(result.value.entities.map(e=>e.type), ['XLINE','RAY'])
      return wire(protocol, [call('move', 'cad_propose_move', { expectedRevision: result.value.revision, units: result.value.units, ids: result.value.entities.map(e=>e.id), dx: 2, dy: 3 })])
    } })
    const result = await runKJAgentTask({ session, model, prompt: 'Move the construction guides by (2,3).', toolNames: ['cad_read_drawing','cad_propose_move'] })
    assert.equal(result.status, 'awaiting-approval', JSON.stringify(result))
    assert.equal(document.serialize(), before)
    assert.equal((await session.approve(result.proposalIds[0], 'host-review')).ok, true)
    assert.deepEqual(document.getObject('guide').payload.origin, [1000002,13,3])
    assert.deepEqual(document.getObject('ray').payload.origin, [-999998,23,6])
    assert.deepEqual(document.getObject('guide').payload.direction, [3,4,0])
    assert.deepEqual(document.getObject('ray').payload.direction, [-3,0,4])
  })
  test(`${protocol}: discover paper layouts and query their exact owner space in a read-only conversation`, async () => {
    const { document, session } = fixture()
    await document.transact('paper geometry', tx => {
      const sheet = tx.createLayout({ name: 'Target sheet', dxfPlotSettings: { paperWidth: 420, paperHeight: 297, printerName: 'PRIVATE_PRINTER' } })
      tx.createEntity('LINE', { start: [1, 2], end: [3, 4] }, { id: 'paper-target', ownerId: sheet.payload.blockRecordId })
      tx.createEntity('LINE', { start: [10, 20], end: [30, 40] }, { id: 'model-other' })
    })
    const before = document.serialize()
    let step = 0
    const model = createKJModelAdapter({ protocol, model: 'offline-layout-fixture', request: async ({ body }) => {
      const defs = protocol === 'gemini-generate-content' ? body.tools[0].functionDeclarations : body.tools
      const def = defs.find(t => (t.function?.name ?? t.name) === 'cad_read_layouts')
      const schema = def.function?.parameters ?? def.parameters ?? def.input_schema ?? def.parametersJsonSchema
      assert.equal(schema.additionalProperties, false)
      assert.deepEqual(schema.required, ['expectedRevision', 'offset', 'limit', 'maxBytes'])
      assert.equal(schema.properties.limit.maximum, 100)
      if (step++ === 0) return wire(protocol, [call('layouts', 'cad_read_layouts', { expectedRevision: 1, offset: 0, limit: 20, maxBytes: 4096 })])
      const result = resultAtEnd(protocol, body)
      assert.equal(result.ok, true, JSON.stringify(result))
      if (step === 2) {
        assert.ok(!JSON.stringify(result).includes('PRIVATE_PRINTER'))
        const sheet = result.value.layouts.find(l => l.name === 'Target sheet')
        assert.equal(sheet.pageSettings.paperWidth, 420)
        return wire(protocol, [call('paper', 'cad_query_drawing', { expectedRevision: result.value.revision, filters: { spaceId: sheet.spaceId, types: ['LINE'] }, offset: 0, layerOffset: 0, limit: 10, maxLayers: 0, maxBytes: 2048 })])
      }
      assert.deepEqual(result.value.entities.map(e => e.id), ['paper-target'])
      return wire(protocol, [], 'Inspected the target paper space.')
    } })
    const result = await runKJAgentTask({ session, model, prompt: 'Inspect the lines on Target sheet.', toolNames: ['cad_read_layouts', 'cad_query_drawing'] })
    assert.equal(result.status, 'responded', JSON.stringify(result))
    assert.equal(step, 3); assert.equal(document.serialize(), before)
  })
  test(`${protocol}: filtered query schema and pagination select exact geometry for a reviewed move`, async () => {
    const { sdk, document, session } = fixture()
    await document.transact('source', tx => {
      tx.createEntity('LINE', { start: [-10, 0], end: [10, 0] }, { id: 'target' })
      tx.createEntity('LINE', { start: [100, 100], end: [101, 101] }, { id: 'unrelated' })
    })
    const before = document.getObject('unrelated'), inputs = []
    const model = createKJModelAdapter({ protocol, model: 'offline-query-fixture', request: async ({ body }) => {
      const defs = protocol === 'gemini-generate-content' ? body.tools[0].functionDeclarations : body.tools
      const def = defs.find(t => (t.function?.name ?? t.name) === 'cad_query_drawing')
      const schema = def.function?.parameters ?? def.parameters ?? def.input_schema ?? def.parametersJsonSchema
      assert.deepEqual(schema.properties.filters.required, [])
      assert.equal(schema.properties.filters.additionalProperties, false)
      assert.equal(schema.properties.filters.properties.bounds.minItems, 4)
      if (!inputs.length) {
        inputs.push(true)
        return wire(protocol, [call('query', 'cad_query_drawing', { expectedRevision: 1, filters: { types: ['LINE'], bounds: [-1, -1, 1, 1] }, offset: 0, layerOffset: 0, limit: 10, maxLayers: 0, maxBytes: 2048 })])
      }
      const result = resultAtEnd(protocol, body)
      assert.equal(result.ok, true); assert.deepEqual(result.value.entities.map(e => e.id), ['target'])
      assert.equal(result.value.entities[0].spatialMatch, 'intersects')
      assert.equal(result.value.spatialQuery.coordinates, 'owner-xy')
      return wire(protocol, [call('move', 'cad_propose_move', { expectedRevision: result.value.revision, units: result.value.units, ids: result.value.entities.map(e => e.id), dx: 2, dy: 3 })])
    } })
    const result = await runKJAgentTask({ session, model, prompt: 'Inspect the supplied region and move the line by (2,3).', toolNames: ['cad_query_drawing', 'cad_propose_move'] })
    assert.equal(result.status, 'awaiting-approval', JSON.stringify(result)); assert.equal(document.revision, 1)
    assert.equal((await session.approve(result.proposalIds[0], 'host-review')).ok, true)
    assert.deepEqual(document.getObject('target').payload.start, [-8, 3, 0]); assert.deepEqual(document.getObject('unrelated'), before)
    await sdk.executeCommand('UNDO'); assert.deepEqual(document.getObject('target').payload.start, [-10, 0, 0])
    await sdk.executeCommand('REDO'); assert.deepEqual(document.getObject('target').payload.end, [12, 3, 0])
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
    assert.ok(reopened.listEntities().some(e => JSON.stringify(e.payload.start) === '[-8,3,0]'))
  })

  test(`${protocol}: selected tools retain units, error correction, host approval and saved geometry`, async () => {
    const { sdk, document, session } = fixture()
    let requests = 0
    const selected = ['cad_propose_circles', 'cad_read_drawing']
    const model = createKJModelAdapter({ protocol, model: 'offline-selected-tools', request: async ({ body }) => {
      const defs = protocol === 'gemini-generate-content' ? body.tools[0].functionDeclarations : body.tools
      assert.deepEqual(defs.map(tool => tool.function?.name ?? tool.name), ['cad_read_drawing', 'cad_propose_circles'])
      if (requests++ === 0) return wire(protocol, [call('read', 'cad_read_drawing')])
      if (requests === 2) {
        assertContinuation(protocol, body)
        assert.equal(resultAtEnd(protocol, body).value.units, 'millimeter')
        return wire(protocol, [call('bad-units', 'cad_propose_circles', { ...args, units: 'meter' })])
      }
      assert.equal(resultAtEnd(protocol, body).ok, false)
      return wire(protocol, [call('proposal', 'cad_propose_circles', args)])
    } })
    const result = await runKJAgentTask({ session, model, prompt: 'Read and propose the specified circle.', toolNames: selected })
    assert.equal(result.status, 'awaiting-approval', JSON.stringify(result))
    assert.equal(requests, 3); assert.equal(document.revision, 0)
    assert.equal((await session.approve(result.proposalIds[0], 'host-review')).ok, true)
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
    assert.deepEqual(reopened.listEntities()[0].payload.center, [20, 25, 0])
    assert.equal(reopened.listEntities()[0].payload.radius, 3)
    await sdk.executeCommand('UNDO'); assert.equal(document.listEntities().length, 0)
    await sdk.executeCommand('REDO'); assert.equal(document.listEntities()[0].payload.radius, 3)
  })

  test(`${protocol}: one omitted tool rejects the whole batch before any dispatch`, async () => {
    const { session, document } = fixture()
    let dispatched = 0
    const original = session.call.bind(session)
    session.call = (...params) => { dispatched++; return original(...params) }
    const model = createKJModelAdapter({ protocol, model: 'offline-host-policy', request: async () => wire(protocol, [call('allowed', 'cad_read_drawing'), call('omitted', 'cad_propose_circles', args)]) })
    const result = await runKJAgentTask({ session, model, prompt: 'Inspect only.', toolNames: ['cad_read_drawing'] })
    assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'KJAGENT_TOOL_NOT_ALLOWED')
    assert.equal(dispatched, 0); assert.equal(result.toolCalls, 0)
    assert.deepEqual(result.outputs, []); assert.deepEqual(result.proposalIds, [])
    assert.equal(document.revision, 0)
  })

  test(`${protocol}: mixed drawing schema and proposal use the same core`, async () => {
    const { document, session } = fixture()
    const model = createKJModelAdapter({ protocol, model: 'offline-profile-fixture', request: async ({ body }) => {
      const definitions = protocol === 'gemini-generate-content' ? body.tools[0].functionDeclarations : body.tools
      const definition = definitions.find(tool => (tool.function?.name ?? tool.name) === 'cad_propose_drawing')
      const schema = definition.function?.parameters ?? definition.parameters ?? definition.input_schema ?? definition.parametersJsonSchema
      assert.equal(schema.properties.polylines.items.properties.closed.type, 'boolean')
      assert.equal(schema.properties.arcs.minItems, 0)
      return wire(protocol, [call('profile', 'cad_propose_drawing', mountingProfile())])
    } })
    const result = await runKJAgentTask({ session, model, prompt: 'Draw the specified mounting profile for review.' })
    assert.equal(result.status, 'awaiting-approval', JSON.stringify(result))
    assert.equal(document.revision, 0)
    assert.equal(result.outputs[0].result.value.preview.after.length, 9)
    assert.equal((await session.approve(result.proposalIds[0], 'host-reviewer')).ok, true)
    assert.equal(document.listEntities().length, 9)
    assert.equal(document.revision, 1)
  })

  test(`${protocol}: read, repair a unit error, propose, host approve, save/reopen and undo`, async () => {
    const { sdk, document, session } = fixture()
    let requests = 0
    const model = createKJModelAdapter({ protocol, model: `host-selected-${protocol}`, request: async request => {
      assert.equal(request.protocol, protocol)
      assert.equal(request.model, `host-selected-${protocol}`)
      assert.ok(request.signal instanceof AbortSignal)
      assert.ok(Object.isFrozen(request.body))
      const body = request.body
      if (requests++ === 0) {
        const defs = protocol === 'gemini-generate-content' ? body.tools[0].functionDeclarations : body.tools
        assert.deepEqual(defs.map(tool => tool.function?.name ?? tool.name).sort(), session.definitions.map(tool => tool.name).sort())
        assert.ok(!JSON.stringify(defs).includes('execute_anything'))
        return wire(protocol, [call('read', 'cad_read_drawing')])
      }
      if (requests === 2) {
        assertContinuation(protocol, body)
        assert.equal(resultAtEnd(protocol, body).value.units, 'millimeter')
        return wire(protocol, [call('bad-units', 'cad_propose_circles', { ...args, units: 'meter' })])
      }
      assert.equal(resultAtEnd(protocol, body).ok, false)
      if (protocol === 'anthropic-messages') assert.equal(body.messages.at(-1).content[0].is_error, true)
      return wire(protocol, [call('corrected', 'cad_propose_circles', args)], 'Please review this circle.')
    } })
    const result = await runKJAgentTask({ session, model, prompt: 'Create the specified circle after checking the units.' })
    assert.equal(result.status, 'awaiting-approval', JSON.stringify(result))
    assert.equal(result.turns, 3)
    assert.equal(result.toolCalls, 3)
    assert.equal(requests, 3, 'no further model request after a proposal')
    assert.equal(document.revision, 0, 'model does not mutate the drawing')
    assert.equal(document.listEntities().length, 0)
    assert.equal((await session.approve(result.proposalIds[0], 'authenticated-host-user')).ok, true)
    assert.equal(document.listEntities()[0].payload.radius, 3)
    const saved = await sdk.writeDocument(document, { format: 'KJD' })
    const reopened = await createKJDrawSDK().readDocument(saved, { format: 'KJD' })
    assert.deepEqual(reopened.listEntities()[0].payload.center, [20, 25, 0])
    assert.equal((await session.approve(result.proposalIds[0], 'authenticated-host-user')).ok, false)
    await sdk.executeCommand('UNDO')
    assert.equal(document.listEntities().length, 0)
  })

  test(`${protocol}: truncated output cannot dispatch even a syntactically valid proposal`, async () => {
    const { session, document } = fixture()
    const response = wire(protocol, [call('unsafe', 'cad_propose_circles', args)])
    if (protocol === 'responses') response.status = 'incomplete'
    else if (protocol === 'chat-completions') response.choices[0].finish_reason = 'length'
    else if (protocol === 'anthropic-messages') response.stop_reason = 'max_tokens'
    else response.candidates[0].finishReason = 'MAX_TOKENS'
    const model = createKJModelAdapter({ protocol, model: 'fixture', request: async () => response })
    const result = await runKJAgentTask({ session, model, prompt: 'draw' })
    assert.equal(result.status, 'failed')
    assert.equal(result.error.code, 'KJMODEL_INCOMPLETE')
    assert.equal(result.toolCalls, 0)
    assert.equal(document.revision, 0)
    assert.deepEqual(result.proposalIds, [])
  })
}

test('host tool selection rejects invalid options before opening a model conversation', async () => {
  const { session } = fixture()
  let opened = 0
  const model = { createConversation() { opened++; return { next: async () => ({ text: 'Ready.', calls: [] }) } } }
  for (const toolNames of [null, 'cad_read_drawing', [], ['cad_read_drawing', 'cad_read_drawing'], ['approve'], ['cad_read_drawing '], [1], new Array(1)]) {
    await assert.rejects(runKJAgentTask({ session, model, prompt: 'inspect', toolNames }), { code: 'KJAGENT_OPTIONS' })
  }
  assert.equal(opened, 0)
  assert.equal((await runKJAgentTask({ session, model, prompt: 'inspect', toolNames: ['cad_read_drawing'] })).status, 'responded')
})

test('caller and custom bridge cannot widen the selected set, and the next run has independent policy', async () => {
  const { session, document } = fixture()
  const names = ['cad_read_drawing']
  const model = { createConversation({ tools }) {
    names.push('cad_propose_circles')
    assert.ok(Object.isFrozen(tools)); assert.ok(Object.isFrozen(tools[0].inputSchema))
    assert.throws(() => tools.push(session.definitions[4]), TypeError)
    return { next: async () => ({ text: '', calls: [call('escape', 'cad_propose_circles', args)] }) }
  } }
  const result = await runKJAgentTask({ session, model, prompt: 'inspect', toolNames: names })
  assert.equal(result.error.code, 'KJAGENT_TOOL_NOT_ALLOWED'); assert.equal(result.toolCalls, 0)
  assert.equal(document.revision, 0)
  const next = await runKJAgentTask({ session, prompt: 'propose', toolNames: ['cad_propose_circles'], model: { createConversation: () => ({ next: async () => ({ text: '', calls: [call('new-run', 'cad_propose_circles', args)] }) }) } })
  assert.equal(next.status, 'awaiting-approval'); assert.equal(document.revision, 0)
})

test('malformed JSON arguments become tool errors and can be corrected without evaluating code', async () => {
  const { session } = fixture()
  let step = 0
  const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'fixture', request: async ({ body }) => {
    if (step++ === 0) {
      const response = wire('chat-completions', [call('bad', 'cad_read_drawing')])
      response.choices[0].message.tool_calls[0].function.arguments = 'not valid JSON'
      return response
    }
    assert.equal(resultAtEnd('chat-completions', body).ok, false)
    return wire('chat-completions', [], 'Please clarify the dimensions.')
  } })
  const result = await runKJAgentTask({ session, model, prompt: 'draw' })
  assert.equal(result.status, 'responded')
  assert.equal(result.text, 'Please clarify the dimensions.')
})

test('Gemini without provider call IDs uses local correlation but does not invent IDs on the wire', async () => {
  let step = 0
  const model = createKJModelAdapter({ protocol: 'gemini-generate-content', model: 'fixture', request: async ({ body }) => {
    if (step++ === 0) {
      const response = wire('gemini-generate-content', [call('remove-id', 'cad_read_drawing')])
      delete response.candidates[0].content.parts[1].functionCall.id
      return response
    }
    assert.equal(body.contents.at(-1).parts[0].functionResponse.id, undefined)
    return wire('gemini-generate-content', [], 'Read complete.')
  } })
  assert.equal((await runKJAgentTask({ session: fixture().session, model, prompt: 'inspect' })).status, 'responded')
})

test('conversation enforces call/result correlation, request limits and explicit model configuration', async () => {
  const session = fixture().session
  assert.throws(() => createKJModelAdapter({ protocol: 'unknown', model: 'x', request: async () => ({}) }))
  assert.throws(() => createKJModelAdapter({ protocol: 'responses', model: '', request: async () => ({}) }))
  assert.throws(() => createKJModelAdapter({ protocol: 'responses', model: 'x', maxOutputTokens: 0, request: async () => ({}) }))
  const model = createKJModelAdapter({ protocol: 'responses', model: 'fixture', request: async () => wire('responses', [call('read', 'cad_read_drawing')]) })
  const conversation = model.createConversation({ instructions: 'inspect', tools: session.definitions })
  await conversation.next({ kind: 'prompt', text: 'inspect' }, new AbortController().signal)
  await assert.rejects(conversation.next({ kind: 'tool-results', results: [{ id: 'wrong', name: 'cad_read_drawing', result: { ok: true, value: {} } }] }, new AbortController().signal), /call IDs/)
  const tiny = createKJModelAdapter({ protocol: 'responses', model: 'fixture', maxResponseBytes: 10, request: async () => wire('responses', [], 'hello') })
  const result = await runKJAgentTask({ session, model: tiny, prompt: 'inspect' })
  assert.equal(result.error.code, 'KJMODEL_SIZE_LIMIT')
})

test('chat token-limit fields are host-selected without hardcoded model names', async () => {
  for (const chatTokenParameter of ['max_tokens', 'max_completion_tokens']) {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'custom/local-model', chatTokenParameter, maxOutputTokens: 321, request: async ({ body }) => {
      assert.equal(body[chatTokenParameter], 321)
      assert.equal(body.model, 'custom/local-model')
      assert.equal(Object.keys(body).filter(key => key.startsWith('max_')).length, 1)
      return wire('chat-completions', [], 'Ready.')
    } })
    assert.equal((await runKJAgentTask({ session: fixture().session, model, prompt: 'inspect' })).status, 'responded')
  }
})

test('a custom framework/model bridge uses the same runner without any built-in protocol', async () => {
  const { session, document } = fixture()
  const model = { createConversation({ tools, instructions }) {
    assert.deepEqual(tools.map(tool => tool.name).sort(), session.definitions.map(tool => tool.name).sort())
    assert.match(instructions, /untrusted/)
    return { async next() { return { text: 'Review before editing.', calls: [call('custom', 'cad_propose_circles', args)] } } }
  } }
  const result = await runKJAgentTask({ session, model, prompt: 'circle' })
  assert.equal(result.status, 'awaiting-approval')
  assert.equal(document.revision, 0)
})

test('duplicate calls and fabricated approval tools cannot mutate or self-approve', async () => {
  for (const calls of [[call('same', 'cad_read_drawing'), call('same', 'cad_propose_circles', args)], [call('approve', 'approve', { planId: 'fake', reviewerId: 'model' })]]) {
    const { session, document } = fixture()
    const model = { createConversation: () => ({ next: async () => ({ text: '', calls }) }) }
    const result = await runKJAgentTask({ session, model, prompt: 'draw', maxTurns: 1 })
    assert.ok(['failed', 'limit-reached'].includes(result.status))
    assert.equal(document.revision, 0)
    assert.deepEqual(result.proposalIds, [])
  }
})

test('turn and call budgets stop the loop without silently dropping part of a call batch', async () => {
  let counter = 0
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [call(`read-${counter++}`, 'cad_read_drawing')] }) }) }
  const result = await runKJAgentTask({ session: fixture().session, model, prompt: 'inspect', maxTurns: 2 })
  assert.equal(result.status, 'limit-reached')
  assert.equal(result.toolCalls, 2)
  const batch = { createConversation: () => ({ next: async () => ({ text: '', calls: [call('a', 'cad_read_drawing'), call('b', 'cad_read_drawing')] }) }) }
  const blocked = await runKJAgentTask({ session: fixture().session, model: batch, prompt: 'inspect', maxToolCalls: 1 })
  assert.equal(blocked.status, 'limit-reached')
  assert.equal(blocked.toolCalls, 0)
})

test('transport errors do not leak raw credentials or backend bodies', async () => {
  const model = createKJModelAdapter({ protocol: 'responses', model: 'fixture', request: async () => { throw new Error('private transport diagnostic must stay private') } })
  const result = await runKJAgentTask({ session: fixture().session, model, prompt: 'inspect' })
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'KJMODEL_REQUEST_FAILED')
  assert.ok(!JSON.stringify(result).includes('private transport diagnostic'))
})

test('cancellation and timeout ignore late model calls, and concurrent runs cannot share a session', async () => {
  const { session, document } = fixture()
  let release, enter
  const entered = new Promise(resolve => { enter = resolve })
  const model = { createConversation: () => ({ next: async () => { enter(); return new Promise(resolve => { release = resolve }) } }) }
  const controller = new AbortController()
  const running = runKJAgentTask({ session, model, prompt: 'draw', signal: controller.signal })
  await entered
  await assert.rejects(runKJAgentTask({ session, model, prompt: 'overlap' }), /active agent run/)
  controller.abort()
  assert.equal((await running).status, 'cancelled')
  release({ text: '', calls: [call('late', 'cad_propose_circles', args)] })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(document.revision, 0)
  const timedOut = await runKJAgentTask({ session, prompt: 'inspect', timeoutMs: 10, model: { createConversation: () => ({ next: () => new Promise(() => {}) }) } })
  assert.equal(timedOut.status, 'cancelled')
})

test('Chat stop with complete tool calls continues through real CAD reads and a host-reviewed proposal', async () => {
  const { session, document } = fixture()
  let step = 0
  const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'compatible-stop-fixture', request: async ({ body }) => {
    if (step++ === 0) {
      const response = wire('chat-completions', [call('read', 'cad_read_drawing')])
      response.choices[0].finish_reason = 'stop'
      return response
    }
    assertContinuation('chat-completions', body)
    assert.equal(resultAtEnd('chat-completions', body).ok, true)
    const response = wire('chat-completions', [call('circle', 'cad_propose_circles', args)])
    response.choices[0].finish_reason = 'stop'
    return response
  } })
  const result = await runKJAgentTask({ session, model, prompt: 'Read and propose a circle', toolNames: ['cad_read_drawing', 'cad_propose_circles'] })
  assert.equal(result.status, 'awaiting-approval'); assert.equal(result.toolCalls, 2); assert.equal(step, 2)
  assert.equal(document.revision, 0); assert.equal(result.proposalIds.length, 1)
  assert.equal((await session.approve(result.proposalIds[0], 'test-host-reviewer')).ok, true)
  assert.equal(document.revision, 1)
  const drawing = await session.call('cad_read_drawing', {})
  assert.equal(drawing.ok, true); assert.equal(drawing.value.entities.length, 1)
  assert.equal(drawing.value.entities[0].type, 'CIRCLE')
})

test('Chat stop compatibility does not accept incomplete, refused, empty or structurally invalid calls', async () => {
  const cases = [
    ['length', r => { r.choices[0].finish_reason = 'length' }, 'KJMODEL_INCOMPLETE'],
    ['filter', r => { r.choices[0].finish_reason = 'content_filter' }, 'KJMODEL_INCOMPLETE'],
    ['refusal', r => { r.choices[0].message.refusal = 'Refused.' }, 'KJMODEL_REFUSED'],
    ['wrong type', r => { r.choices[0].message.tool_calls[0].type = 'code' }, 'KJMODEL_PROTOCOL'],
    ['missing id', r => { delete r.choices[0].message.tool_calls[0].id }, 'KJMODEL_PROTOCOL'],
    ['nonarray', r => { r.choices[0].message.tool_calls = {} }, 'KJMODEL_PROTOCOL'],
    ['duplicate id', r => { r.choices[0].message.tool_calls.push(r.choices[0].message.tool_calls[0]) }, 'KJMODEL_PROTOCOL'],
    ['empty tool_calls finish', r => { r.choices[0].finish_reason = 'tool_calls'; r.choices[0].message.tool_calls = [] }, 'KJMODEL_PROTOCOL'],
    ['empty stop', r => { r.choices[0].message.tool_calls = [] }, 'KJMODEL_PROTOCOL'],
  ]
  for (const [name, mutate, code] of cases) {
    const { session, document } = fixture(), before = document.serialize()
    const response = wire('chat-completions', [call('circle', 'cad_propose_circles', args)])
    response.choices[0].finish_reason = 'stop'; mutate(response)
    const result = await runKJAgentTask({ session, model: createKJModelAdapter({ protocol: 'chat-completions', model: 'compatible-stop-fixture', request: async () => response }), prompt: 'circle' })
    assert.equal(result.status, 'failed', name); assert.equal(result.error.code, code, name)
    assert.equal(result.toolCalls, 0, name); assert.equal(document.serialize(), before, name)
  }
  const { session, document } = fixture(), response = wire('chat-completions', [call('bad-json', 'cad_propose_circles', args)])
  response.choices[0].finish_reason = 'stop'; response.choices[0].message.tool_calls[0].function.arguments = '{broken'
  const result = await runKJAgentTask({ session, model: createKJModelAdapter({ protocol: 'chat-completions', model: 'compatible-stop-fixture', request: async () => response }), prompt: 'circle', maxTurns: 1 })
  assert.equal(result.status, 'limit-reached'); assert.equal(result.outputs[0].result.ok, false)
  assert.equal(result.proposalIds.length, 0); assert.equal(document.revision, 0)
})
