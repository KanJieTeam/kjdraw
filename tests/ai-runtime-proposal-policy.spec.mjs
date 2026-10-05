import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime, expectsAiDrawingProposal } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

const tools = ['cad_read_drawing', 'cad_query_drawing', 'cad_propose_move']
test('proposal follow-up policy covers ordinary edits, not read-only or hypothetical instructions', () => {
  for (const request of ['Move the line and text 10 mm right; preserve everything else.',
    '把这两个对象向右移动10毫米，其他对象不要修改。', 'Please undo the last change.',
    'Update hole ZK2 depth to 18; do not change other source fields.']) {
    assert.equal(expectsAiDrawingProposal(request, tools), true, request)
  }
  for (const request of ['Read-only: explain how to move this line.', 'Do not modify the drawing; inspect it.',
    'How would moving this line affect its neighbours?', '如果移动这条线会怎么样？',
    '只读，请检查图纸。', 'List the current entities.']) {
    assert.equal(expectsAiDrawingProposal(request, tools), false, request)
  }
  assert.equal(expectsAiDrawingProposal('Move the line.', ['cad_read_drawing']), false)
})

const wire = (name, args, content = '') => Response.json({ choices: [{ finish_reason: name ? 'tool_calls' : 'stop',
  message: { role: 'assistant', content, ...(name ? { tool_calls: [{ id: name,
    type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : {}) } }] })

async function fixtureRuntime(reply) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Caller drawing', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [20, 0, 0] }, { id: 'line-a' })
    tx.createEntity('CIRCLE', { center: [60, 0, 0], radius: 4 }, { id: 'untouched' })
  })
  const requests = []
  const chat = createAiChatRuntime({ endpoint: 'https://policy-fixture.invalid/chat/completions', model: 'fixture',
    captureToolOutputs: true, fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body)
      return reply(body, requests.length, document)
    } })
  await chat.restoreLocalState({ drawing: await sdk.writeDocument(document, { format: 'KJD' }), history: [], sourceFormat: 'DXF' })
  return { chat, sdk, document, requests }
}

test('ordinary geometry edit receives one model correction, never automatic approval or fabricated targets', async () => {
  const { chat, sdk, document, requests } = await fixtureRuntime((body, number, source) => {
    if (number === 1) return wire('cad_read_drawing', {})
    if (number === 2) return wire(null, null, 'I found the line. Moving it may disconnect neighbours. Shall I proceed?')
    assert.equal(number, 3)
    assert.match(body.messages.at(-1).content, /no reviewable proposal exists/)
    assert.doesNotMatch(body.messages.at(-1).content, /line-a|10 mm/)
    const native = JSON.parse(body.messages.find(message => message.role === 'tool').content)
    assert.equal(native.ok, true)
    return wire('cad_propose_move', { expectedRevision: source.revision, units: 'millimeter', ids: ['line-a'], dx: 10, dy: 0 })
  })
  try {
    const before = await chat.exportLocalState()
    const result = await chat.send('Move the line 10 mm right, keeping the circle unchanged.')
    assert.equal(result.status, 'proposal', JSON.stringify(result.error))
    assert.equal(result.proposalRepairAttempts, 1)
    assert.equal(requests.length, 3)
    assert.equal((await chat.exportLocalState()).drawing, before.drawing)
    assert.equal(chat.drawingHistory.canUndo, false)
    assert.equal((await chat.approve(result.proposal.planId)).status, 'applied')
    const reopened = await sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    assert.deepEqual(reopened.getObject('line-a').payload.start, [10, 0, 0])
    assert.deepEqual(reopened.getObject('untouched'), document.getObject('untouched'))
  } finally { chat.destroy() }
})

test('read-only geometry request finishes after its read without an edit correction', async () => {
  const { chat, requests } = await fixtureRuntime((_body, number) => number === 1
    ? wire('cad_read_drawing', {}) : wire(null, null, 'One line and one circle; no proposal created.'))
  try {
    const before = await chat.exportLocalState()
    const result = await chat.send('Read-only: inspect this drawing, do not modify the drawing.')
    assert.equal(result.status, 'message')
    assert.equal(requests.length, 2)
    assert.equal(result.noProposal, undefined)
    assert.equal((await chat.exportLocalState()).drawing, before.drawing)
  } finally { chat.destroy() }
})

test('insufficient geometry facts remain clarification after the single bounded correction', async () => {
  const { chat, requests } = await fixtureRuntime((_body, number) => number === 1
    ? wire('cad_read_drawing', {}) : wire(null, null, 'What measured distance should I use? No proposal created.'))
  try {
    const before = await chat.exportLocalState()
    const result = await chat.send('Move the line right, but I have not supplied a distance.')
    assert.equal(result.status, 'message')
    assert.equal(result.proposalRepairAttempts, 1)
    assert.equal(requests.length, 3)
    assert.match(result.text, /measured distance/)
    assert.equal(result.proposal, undefined)
    assert.equal((await chat.exportLocalState()).drawing, before.drawing)
  } finally { chat.destroy() }
})
