import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime, computeAiProposalCamera } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

async function callerDrawingFixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Public caller geometry', tx => {
    tx.createEntity('LINE', { start: [5, 10, 0], end: [45, 10, 0] })
    tx.createEntity('CIRCLE', { center: [145, 80, 0], radius: 18 })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [180, 0], [180, 110], [0, 110]], closed: true })
  })
  return { sdk, document, dxf: await sdk.writeDocument(document, { format: 'DXF' }) }
}

function callerGeometry(document) {
  return document.listEntities().map(({ type, payload }) => {
    if (type === 'LINE') return { type, start: payload.start, end: payload.end }
    if (type === 'CIRCLE') return { type, center: payload.center, radius: payload.radius }
    assert.equal(type, 'LWPOLYLINE')
    return { type, vertices: payload.vertices, closed: payload.closed }
  })
}

async function reopenDxf(chat) {
  const document = await createKJDrawSDK().readDocument(await chat.exportDocument(), { format: 'DXF' })
  assert.equal(document.validate().valid, true)
  return document
}

test('validated caller DXF exports and reopens without claiming a model approval', async () => {
  const fixture = await callerDrawingFixture(), chat = createAiChatRuntime()
  try {
    const imported = await chat.importDocument(new File([fixture.dxf], 'caller.dxf'))
    assert.equal(imported.entityCount, 3)
    const before = await chat.exportLocalState()
    assert.equal(before.committed, false)
    assert.equal(before.sourceFormat, 'DXF')
    assert.deepEqual(callerGeometry(await reopenDxf(chat)), callerGeometry(fixture.document))
    assert.equal((await chat.exportLocalState()).drawing, before.drawing)
    assert.equal((await chat.exportLocalState()).committed, false)
    assert.equal(chat.drawingHistory.canUndo, false, 'opening the caller baseline is not an approved edit')
    await assert.rejects(chat.exportDocument('PDF'), /DXF/)
  } finally { chat.destroy() }
  await assert.rejects(chat.exportDocument(), /会话已经结束/)
})

test('legacy saved caller imports retain export access after validated local restoration', async () => {
  const fixture = await callerDrawingFixture()
  const drawing = await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })
  for (const sourceFormat of ['DXF', 'KJD', 'KJP']) {
    const chat = createAiChatRuntime(), reopened = createAiChatRuntime()
    try {
      await chat.restoreLocalState({ drawing, sourceFormat, committed: false, history: [] })
      assert.deepEqual(callerGeometry(await reopenDxf(chat)), callerGeometry(fixture.document))
      const state = await chat.exportLocalState()
      assert.equal(state.committed, false)
      await reopened.restoreLocalState(state)
      assert.deepEqual(callerGeometry(await reopenDxf(reopened)), callerGeometry(fixture.document))
    } finally { chat.destroy(); reopened.destroy() }
  }
})

test('pending and rejected edit exports preserve only the actual caller or approved drawing', async () => {
  const fixture = await callerDrawingFixture()
  let calls = 0
  const chat = createAiChatRuntime({ endpoint: 'https://export-fixture.invalid/v1/chat/completions', model: 'fixture',
    fetchImpl: async (_url, request) => {
      const last = JSON.parse(request.body).messages.at(-1)
      let name = 'cad_read_drawing', args = {}
      if (last.role === 'tool') {
        const read = JSON.parse(last.content)
        assert.equal(read.ok, true)
        name = 'cad_propose_move'
        args = { expectedRevision: read.value.revision, units: read.value.units,
          ids: [read.value.entities.find(entity => entity.type === 'LINE').id], dx: 10, dy: 0 }
      }
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '',
        tool_calls: [{ id: 'export-call-' + ++calls, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] })
    },
  })
  const restoredPending = createAiChatRuntime()
  try {
    await chat.importDocument(new File([fixture.dxf], 'caller.dxf'))
    const original = callerGeometry(await reopenDxf(chat)), revision = chat.revision
    const pending = await chat.send('Move the line 10 mm right; preserve the circle and outline.')
    assert.equal(pending.status, 'proposal', JSON.stringify(pending.error))
    assert.ok(pending.proposal.preview.after.some(entity => entity.type === 'LINE' && entity.payload.start[0] === 15))
    assert.equal(chat.revision, revision)
    assert.deepEqual(callerGeometry(await reopenDxf(chat)), original, 'pending preview is never the export source')
    const pendingState = await chat.exportLocalState()
    assert.equal(pendingState.committed, false)
    await restoredPending.restoreLocalState(pendingState)
    assert.deepEqual(callerGeometry(await reopenDxf(restoredPending)), original)
    assert.equal((await restoredPending.approve(pending.proposal.planId)).status, 'error')
    assert.equal((await chat.approve(pending.proposal.planId)).status, 'applied')
    const approved = callerGeometry(await reopenDxf(chat))
    assert.deepEqual(approved[0], { type: 'LINE', start: [15, 10, 0], end: [55, 10, 0] })
    assert.deepEqual(approved.slice(1), original.slice(1))
    assert.equal((await chat.exportLocalState()).committed, true)
    const next = await chat.send('Move the line another 10 mm right; preserve everything else.')
    assert.equal(next.status, 'proposal', JSON.stringify(next.error))
    assert.deepEqual(callerGeometry(await reopenDxf(chat)), approved)
    assert.equal(chat.reject(next.proposal.planId).status, 'rejected')
    assert.deepEqual(callerGeometry(await reopenDxf(chat)), approved)
    assert.equal((await chat.applyHistory('undo')).status, 'applied')
    assert.deepEqual(callerGeometry(await reopenDxf(chat)), original)
    assert.equal((await chat.applyHistory('redo')).status, 'applied')
    assert.deepEqual(callerGeometry(await reopenDxf(chat)), approved)
  } finally { chat.destroy(); restoredPending.destroy() }
})

test('blank, failed import and ambiguous saved provenance never gain drawing export permission', async () => {
  const chat = createAiChatRuntime(), fixture = await callerDrawingFixture()
  try {
    await assert.rejects(chat.exportDocument(), /请先审阅/)
    await assert.rejects(chat.importDocument(new File(['invalid DXF'], 'invalid.dxf')))
    assert.equal(chat.entityCount, 0)
    assert.equal((await chat.exportLocalState()).committed, false)
    await assert.rejects(chat.exportDocument(), /请先审阅/)
    await assert.rejects(chat.restoreLocalState({ drawing: 'invalid KJD', sourceFormat: 'DXF' }))
    await assert.rejects(chat.exportDocument(), /请先审阅/)
    await chat.importDocument(new File([fixture.dxf], 'valid-after-failure.dxf'))
    assert.deepEqual(callerGeometry(await reopenDxf(chat)), callerGeometry(fixture.document))
  } finally { chat.destroy() }
  const drawing = await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })
  for (const sourceFormat of [undefined, null, '', 'unknown', 'blank']) {
    const restored = createAiChatRuntime(), reopened = createAiChatRuntime()
    try {
      await restored.restoreLocalState({ drawing, sourceFormat, committed: false })
      await assert.rejects(restored.exportDocument(), /请先审阅/)
      await reopened.restoreLocalState(await restored.exportLocalState())
      await assert.rejects(reopened.exportDocument(), /请先审阅/, 'saving again must not upgrade ambiguous source provenance')
    } finally { restored.destroy(); reopened.destroy() }
  }
  const fresh = createAiChatRuntime()
  try { await assert.rejects(fresh.exportDocument(), /请先审阅/) } finally { fresh.destroy() }
})

test('validated import still obeys the SDK barrier against lossy viewport-linked DXF export', async () => {
  const dxf = [
    0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES', 0, 'TEXT', 5, '10', 8, '0', 10, 1, 20, 2, 40, 2, 1, 'PUBLIC LABEL',
    0, 'VIEWPORT', 5, '20', 102, '{ACAD_XDICTIONARY', 360, 'DEAD', 102, '}', 8, '0', 67, 1,
    10, 50, 20, 50, 30, 0, 40, 90, 41, 80, 68, 1, 69, 2, 12, 0, 22, 0, 16, 0, 26, 0, 36, 1,
    17, 0, 27, 0, 37, 0, 45, 80, 90, 0, 0, 'ENDSEC', 0, 'EOF', '',
  ].join('\n')
  const chat = createAiChatRuntime()
  try {
    await chat.importDocument(new File([dxf], 'incomplete-viewports.dxf'))
    const before = await chat.exportLocalState()
    assert.equal(before.committed, false)
    await assert.rejects(chat.exportDocument(), error => {
      assert.equal(error.code, 'KJFILE_ADAPTER_FAILED')
      assert.match(error.cause?.message ?? '', /DXF viewport metadata: unsupported source metadata/)
      return true
    })
    assert.equal((await chat.exportLocalState()).drawing, before.drawing)
  } finally { chat.destroy() }
})

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
    await assert.rejects(chat.exportDocument(), /请先审阅/)
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
    await assert.rejects(chat.exportDocument(), /请先审阅/)
    const restoredPending = createAiChatRuntime()
    try {
      await restoredPending.restoreLocalState(await chat.exportLocalState())
      await assert.rejects(restoredPending.exportDocument(), /请先审阅/)
      assert.equal((await restoredPending.approve(result.proposal.planId)).status, 'error')
    } finally { restoredPending.destroy() }
    const applied = await chat.approve(result.proposal.planId)
    assert.equal(applied.status, 'applied', JSON.stringify(applied.error))
    assert.equal(chat.revision, 1)
    assert.equal(chat.entityCount, 1)
    assert.match(await chat.exportDocument('DXF'), /LINE/)
    const defaultExport = await chat.exportDocument()
    assert.match(defaultExport, /0\r?\nSECTION\r?\n2\r?\nHEADER/)
    assert.match(defaultExport, /LINE/)
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

test('tool-output diagnostics are opt-in, contain the actual pending SDK proposal and are never persisted', async () => {
  for (const captureToolOutputs of [undefined, false, true]) {
    let requests = 0
    const chat = createAiChatRuntime({ endpoint: 'https://example.invalid/v1/chat/completions', model: 'mock-model',
      ...(captureToolOutputs === undefined ? {} : { captureToolOutputs }),
      fetchImpl: async () => {
        requests++
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{
          id: 'diagnostic-actual-call', type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify({
            expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [],
          }) },
        }] } }], toolOutputs: [{ id: 'invented-provider-result', result: { ok: true, value: { status: 'committed' } } }] })
      },
    })
    try {
      const result = await chat.send('Draw only a line from 0,0 to 20,0 millimeters.')
      assert.equal(result.status, 'proposal', JSON.stringify(result.error))
      assert.equal(requests, 1, 'the final real proposal result requires no extra provider response')
      assert.equal(chat.entityCount, 0)
      assert.equal(chat.revision, 0)
      if (captureToolOutputs === true) {
        assert.equal(result.toolOutputs.length, 1)
        const output = result.toolOutputs[0]
        assert.equal(output.id, 'diagnostic-actual-call')
        assert.equal(output.name, 'cad_propose_drawing_pattern')
        assert.equal(output.result.ok, true)
        assert.equal(output.result.value, result.proposal)
        assert.equal(output.result.value.status, 'awaiting-host-approval')
        assert.equal(Object.isFrozen(output) && Object.isFrozen(output.result), true)
      } else assert.equal(Object.hasOwn(result, 'toolOutputs'), false)
      const pendingState = await chat.exportLocalState()
      assert.equal(JSON.stringify(pendingState).includes('toolOutputs'), false)
      assert.equal(JSON.stringify(pendingState).includes('diagnostic-actual-call'), false)
      assert.equal(JSON.stringify(pendingState).includes('invented-provider-result'), false)
      assert.equal((await chat.approve(result.proposal.planId)).status, 'applied')
      assert.equal(chat.revision, 1)
      assert.equal(chat.entityCount, 1)
      const committedState = await chat.exportLocalState()
      assert.equal(JSON.stringify(committedState).includes('toolOutputs'), false)
      assert.equal(JSON.stringify(committedState).includes('diagnostic-actual-call'), false)
      const reopened = createAiChatRuntime({ captureToolOutputs: true })
      try {
        await reopened.restoreLocalState(committedState)
        assert.equal(reopened.entityCount, 1)
        assert.equal(reopened.revision, 1)
        assert.equal((await reopened.approve(result.proposal.planId)).status, 'error', 'a diagnostic copy never restores host approval authority')
      } finally { reopened.destroy() }
    } finally { chat.destroy() }
  }
})

test('opt-in diagnostics capture actual read outputs but cannot fabricate outputs from provider message fields', async () => {
  let requests = 0
  const chat = createAiChatRuntime({ endpoint: 'https://example.invalid/v1/chat/completions', model: 'mock-model', captureToolOutputs: true,
    fetchImpl: async (_url, request) => {
      requests++
      const body = JSON.parse(request.body)
      const last = body.messages.at(-1)
      if (requests === 1) return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{
        id: 'diagnostic-native-read', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' },
      }] } }] })
      assert.equal(last.role, 'tool')
      const actual = JSON.parse(last.content)
      assert.equal(actual.ok, true)
      assert.equal(actual.value.revision, 0)
      return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'No geometry has been created.',
        toolOutputs: [{ id: 'fabricated-read', result: { ok: true, value: { revision: 9000 } } }],
      } }] })
    },
  })
  try {
    const result = await chat.send('Inspect the drawing without modifying it.')
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    assert.equal(requests, 2)
    assert.equal(result.toolOutputs.length, 1)
    assert.equal(result.toolOutputs[0].id, 'diagnostic-native-read')
    assert.equal(result.toolOutputs[0].name, 'cad_read_drawing')
    assert.equal(result.toolOutputs[0].result.ok, true)
    assert.equal(result.toolOutputs[0].result.value.revision, 0)
    const sdk = createKJDrawSDK(), state = await chat.exportLocalState()
    const document = await sdk.readDocument(state.drawing, { format: 'KJD' })
    assert.equal(result.toolOutputs[0].result.value.documentId, document.id)
    assert.equal(chat.revision, 0)
    assert.equal(chat.entityCount, 0)
    assert.equal(JSON.stringify(state).includes('toolOutputs'), false)
    assert.equal(JSON.stringify(state).includes('fabricated-read'), false)
  } finally { chat.destroy() }
})
