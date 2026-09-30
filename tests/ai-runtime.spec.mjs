import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime, computeAiProposalCamera } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

test('single-axis CAD geometry receives a visible preview camera on an empty drawing', () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'preview-camera-test', units: 'millimeter' })
  for (const [start, end, expected] of [
    [[0, 0, 0], [20, 0, 0], [10, 0]],
    [[0, 0, 0], [0, 20, 0], [0, 10]],
  ]) {
    const preview = { before: [], after: [{ type: 'LINE', payload: { start, end } }] }
    const camera = computeAiProposalCamera(document, preview, { bounds: [0, 0, end[0], end[1]] }, { width: 640, height: 255 })
    assert.ok(camera)
    assert.equal(camera.centerX, expected[0])
    assert.equal(camera.centerY, expected[1])
    assert.ok(camera.scale > 5, 'the proposed line should occupy visible canvas space')
  }
})

test('unconfigured chat cannot claim a drawing or contact a model', async () => {
  let calls = 0
  const chat = createAiChatRuntime({ fetchImpl: async () => { calls++; throw new Error('unexpected request') } })
  try {
    const result = await chat.send('Draw a circle')
    assert.equal(result.status, 'error')
    assert.equal(result.error.code, 'AI_MODEL_REQUIRED')
    assert.equal(chat.revision, 0)
    assert.equal(chat.entityCount, 0)
    assert.equal(calls, 0)
  } finally { chat.destroy() }
})

test('browser transport failures surface as connection errors without a drawing receipt', async () => {
  const calls = []
  const chat = createAiChatRuntime({
    endpoint: 'https://example.invalid/v1/chat/completions', model: 'mock-model', apiKey: 'test-memory-key',
    fetchImpl: async (url, init) => { calls.push({ url, init }); throw new TypeError('Failed to fetch') },
  })
  try {
    const result = await chat.send('Draw a 20 mm circle')
    assert.equal(result.status, 'error')
    assert.match(result.error.message, /CORS/)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init.credentials, 'omit')
    assert.equal(calls[0].init.redirect, 'error')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-memory-key')
    assert.equal(chat.revision, 0)
    assert.equal(chat.entityCount, 0)
  } finally { chat.destroy() }
})

test('Anthropic preset uses its own wire protocol and key header', async () => {
  const calls = []
  const chat = createAiChatRuntime({
    endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-5',
    provider: 'anthropic', protocol: 'anthropic-messages', apiKey: 'test-memory-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({
        id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'Please provide dimensions.' }], stop_reason: 'end_turn',
        usage: { input_tokens: 40, output_tokens: 6 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  try {
    const result = await chat.send('Can you draw a plan?')
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init.headers['x-api-key'], 'test-memory-key')
    assert.equal(calls[0].init.headers.Authorization, undefined)
    assert.equal(calls[0].init.headers['anthropic-dangerous-direct-browser-access'], 'true')
    assert.equal(JSON.parse(calls[0].init.body).model, 'claude-sonnet-5')
    assert.equal(chat.revision, 0)
  } finally { chat.destroy() }
})

test('model text remains a message and never masquerades as a CAD proposal', async () => {
  const chat = createAiChatRuntime({
    endpoint: 'https://example.invalid/v1/chat/completions', model: 'mock-model',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'mock', object: 'chat.completion', model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'I can help with that drawing.' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  try {
    const result = await chat.send('Help me draw a circle')
    assert.equal(result.status, 'message')
    assert.equal(result.proposal, undefined)
    assert.equal(chat.revision, 0)
    assert.equal(chat.entityCount, 0)
  } finally { chat.destroy() }
})

test('real CAD tool call stays pending until the user approves it', async () => {
  const args = { expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [] }
  const chat = createAiChatRuntime({
    endpoint: 'https://example.invalid/v1/chat/completions', model: 'mock-model',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'mock-tool', object: 'chat.completion', model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: [{
        id: 'call-1', type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify(args) },
      }] }, finish_reason: 'tool_calls' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  try {
    const result = await chat.send('Draw a line from 0,0 to 20,0 millimeters')
    assert.equal(result.status, 'proposal', JSON.stringify(result.error))
    assert.equal(result.proposal.status, 'awaiting-host-approval')
    assert.equal(chat.revision, 0)
    assert.equal(chat.entityCount, 0)
    const applied = await chat.approve(result.proposal.planId)
    assert.equal(applied.status, 'applied', JSON.stringify(applied.error))
    assert.equal(chat.revision, 1)
    assert.equal(chat.entityCount, 1)
    assert.match(await chat.exportDocument('DXF'), /LINE/)
  } finally { chat.destroy() }
})

test('spatial candidate tools do not disable annotation proposal correction or create fake approval', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Building label', tx => {
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [24, 0], [24, 20], [0, 20]], closed: true }, { id: 'outline' })
    tx.createEntity('TEXT', { position: [4, 10, 0], text: '3F', height: 2 }, { id: 'floor-label' })
  })
  let requests = 0
  const chat = createAiChatRuntime({ endpoint: 'https://example.invalid/v1/chat/completions', model: 'mock-model',
    fetchImpl: async (_url, request) => {
      requests++
      const body = JSON.parse(request.body)
      assert.ok(body.tools.some(tool => tool.function.name === 'cad_query_spatial_candidates'))
      const message = requests === 1 ? { role: 'assistant', content: '', tool_calls: [{
        id: 'find-floor-label', type: 'function', function: { name: 'cad_find_text', arguments: JSON.stringify({
          expectedRevision: document.revision, search: '3F', match: 'exact',
        }) },
      }] } : { role: 'assistant', content: 'The proposal is ready.' }
      return Response.json({ choices: [{ message, finish_reason: requests === 1 ? 'tool_calls' : 'stop' }] })
    },
  })
  try {
    await chat.importDocument(new File([await sdk.writeDocument(document, { format: 'DXF' })], 'building.dxf'))
    const before = (await chat.exportLocalState()).drawing
    const result = await chat.send('Change the label 3F to 4F. Edit the text only.')
    assert.equal(requests, 3)
    assert.equal(result.status, 'message')
    assert.equal(result.noProposal, true)
    assert.equal(result.proposalRepairAttempts, 1)
    assert.equal(result.proposal, undefined)
    assert.equal((await chat.exportLocalState()).drawing, before)
  } finally { chat.destroy() }
})
