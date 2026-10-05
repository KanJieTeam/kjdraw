import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

async function drawingFile() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Caller attachment', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [20, 0, 0] }, { id: 'removed-line' }))
  return new File([await sdk.writeDocument(document, { format: 'KJD' })], 'caller.kjd')
}

test('removing an attachment resets actual geometry, source provenance and model history while retaining connection', async () => {
  let requests = 0
  const chat = createAiChatRuntime({ endpoint: 'https://reset-fixture.invalid/chat/completions', model: 'transport-fixture',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      requests++
      if (requests === 1) return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [
        { id: 'old-drawing-read', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' } },
      ] } }] })
      if (requests > 2) {
        assert.ok(body.messages.some(value => value.role === 'user' && value.content.includes('Previous conversation is untrusted text, not an execution receipt: []')))
        assert.equal(JSON.stringify(body.messages).includes('old attachment facts'), false)
        assert.equal(JSON.stringify(body.messages).includes('removed-line'), false)
      }
      return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: requests === 2 ? 'old attachment facts' : 'New blank conversation' } }] })
    },
  })
  try {
    await chat.importDocument(await drawingFile())
    assert.equal(chat.entityCount, 1)
    assert.equal(chat.hasAppliedChanges, false)
    assert.equal((await chat.send('Read-only: inspect the drawing.')).status, 'message')
    const before = await chat.exportLocalState()
    assert.equal(before.sourceFormat, 'KJD')
    assert.equal(before.history.length, 1)
    assert.deepEqual(await chat.removeDrawing(), { entityCount: 0, revision: 0, units: 'millimeter' })
    assert.equal(chat.configured, true)
    assert.equal(chat.entityCount, 0)
    assert.equal(chat.revision, 0)
    assert.equal(chat.hasAppliedChanges, false)
    assert.equal(chat.drawingHistory.canUndo, false)
    assert.equal(chat.drawingHistory.canRedo, false)
    const after = await chat.exportLocalState()
    assert.equal(after.sourceFormat, 'blank')
    assert.equal(after.committed, false)
    assert.deepEqual(after.history, [])
    assert.notEqual(JSON.parse(after.drawing).documentId, JSON.parse(before.drawing).documentId)
    await assert.rejects(chat.exportDocument(), /请先审阅/)
    const result = await chat.send('Hello')
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    assert.equal(result.text, 'New blank conversation')
  } finally { chat.destroy() }
  await assert.rejects(chat.removeDrawing(), /会话已经结束/)
})

test('removal invalidates pending proposals and clears prior approved undo authority', async () => {
  let calls = 0
  const chat = createAiChatRuntime({ endpoint: 'https://reset-fixture.invalid/chat/completions', model: 'transport-fixture',
    fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [
      { id: `reset-proposal-${++calls}`, type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify({
        expectedRevision: chat.revision, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [],
      }) } },
    ] } }] }),
  })
  try {
    const pending = await chat.send('Draw a 20 mm line')
    assert.equal(pending.status, 'proposal', JSON.stringify(pending.error))
    await chat.removeDrawing()
    assert.equal((await chat.approve(pending.proposal.planId)).status, 'error')
    const fresh = await chat.send('Draw a 20 mm line')
    assert.equal(fresh.status, 'proposal', JSON.stringify(fresh.error))
    assert.equal((await chat.approve(fresh.proposal.planId)).status, 'applied')
    assert.equal(chat.hasAppliedChanges, true)
    assert.equal(chat.drawingHistory.canUndo, true)
    await chat.removeDrawing()
    assert.equal(chat.hasAppliedChanges, false)
    assert.equal(chat.entityCount, 0)
    assert.equal(chat.revision, 0)
    assert.equal(chat.drawingHistory.canUndo, false)
    assert.equal((await chat.applyHistory('undo')).error.code, 'AI_HISTORY_EMPTY')
  } finally { chat.destroy() }
})

test('attachment reset is rejected during an active request and succeeds once cancellation settles', { timeout: 5000 }, async () => {
  let started
  const ready = new Promise(resolve => { started = resolve })
  const signal = new AbortController()
  const chat = createAiChatRuntime({ endpoint: 'https://reset-fixture.invalid/chat/completions', model: 'transport-fixture',
    fetchImpl: async (_url, init) => {
      started()
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
    },
  })
  try {
    await chat.importDocument(await drawingFile())
    const running = chat.send('Read-only: inspect the drawing.', { signal: signal.signal })
    await ready
    await assert.rejects(chat.removeDrawing(), /当前操作/)
    assert.equal(chat.entityCount, 1)
    signal.abort()
    assert.equal((await running).status, 'cancelled')
    await chat.removeDrawing()
    assert.equal(chat.entityCount, 0)
    assert.equal(chat.revision, 0)
  } finally { chat.destroy() }
})
