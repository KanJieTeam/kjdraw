import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime, expectsAiDrawingProposal } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

const tools = ['cad_read_drawing', 'cad_query_drawing', 'cad_propose_move']
test('proposal follow-up policy covers ordinary edits, not read-only or hypothetical instructions', () => {
  for (const request of ['Move the line and text 10 mm right; preserve everything else.',
    '把这两个对象向右移动10毫米，其他对象不要修改。', 'Please undo the last change.',
    'Update hole ZK2 depth to 18; do not change other source fields.',
    '在已确认备注原文加“复核版”，其余标点保留。', '给备注末尾加“待复核”。',
    '补充备注“人工复核”。', 'Append " reviewed" to this note.', 'Prepend "DRAFT: " to the title-block text.',
    '按完整源表生成剖面，不能补测量值。', 'Generate the section using supplied facts.', 'Plot the provided borehole data.']) {
    assert.equal(expectsAiDrawingProposal(request, tools), true, request)
  }
  for (const request of ['Read-only: explain how to move this line.', 'Do not modify the drawing; inspect it.',
    'How would moving this line affect its neighbours?', '如果移动这条线会怎么样？',
    '只读，请检查图纸。', 'List the current entities.',
    '如何给备注原文加“复核版”？', '只读看看备注是否需要补充，不修改图纸。',
    '不要生成图纸，只解释需要哪些输入。', '不要创建剖面，先列出源数据。',
    'Do not generate a drawing; explain required input.', 'Without plotting the drawing, list available data.',
    'How would you generate the section?', '如果生成这个剖面会怎样？']) {
    assert.equal(expectsAiDrawingProposal(request, tools), false, request)
  }
  assert.equal(expectsAiDrawingProposal('Move the line.', ['cad_read_drawing']), false)
})

const wire = (name, args, content = '') => Response.json({ choices: [{ finish_reason: name ? 'tool_calls' : 'stop',
  message: { role: 'assistant', content, ...(name ? { tool_calls: [{ id: name,
    type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : {}) } }] })

async function fixtureRuntime(reply, { includeNote = false } = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Caller drawing', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [20, 0, 0] }, { id: 'line-a' })
    tx.createEntity('CIRCLE', { center: [60, 0, 0], radius: 4 }, { id: 'untouched' })
    if (includeNote) tx.createEntity('TEXT', { position: [0, -10, 0], height: 2, text: 'REV A;保持原标点。' }, { id: 'note' })
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

for (const request of ['在备注原文加“复核版”，其余不改。', 'Append "复核版" to the note, preserving other entities.'])
test(`literal annotation follow-up stays model-driven, review-only and exactly undoable: ${request}`, async () => {
  const { chat, sdk, document, requests } = await fixtureRuntime((body, number, source) => {
    assert.ok(body.tools.some(tool => tool.function.name === 'cad_propose_text_edit'))
    assert.ok(!body.tools.some(tool => tool.function.name === 'cad_propose_drawing_pattern'))
    if (number === 1) return wire('cad_find_text', { expectedRevision: source.revision, search: 'REV A', match: 'contains' })
    if (number === 2) return wire(null, null, 'I read the complete note; awaiting further confirmation.')
    assert.equal(number, 3)
    assert.match(body.messages.at(-1).content, /no reviewable proposal exists/)
    assert.doesNotMatch(body.messages.at(-1).content, /复核版|REV A|note/)
    const receipt = JSON.parse(body.messages.find(message => message.role === 'tool').content)
    assert.equal(receipt.ok, true)
    const target = receipt.value.matches[0]
    assert.equal(target.text, 'REV A;保持原标点。')
    return wire('cad_propose_text_edit', { expectedRevision: source.revision, units: 'millimeter',
      changes: [{ id: target.id, expectedText: target.text, text: target.text + '复核版' }] })
  }, { includeNote: true })
  try {
    const before = await chat.exportLocalState()
    const result = await chat.send(request)
    assert.equal(result.status, 'proposal', JSON.stringify(result.error))
    assert.equal(result.proposalRepairAttempts, 1)
    assert.equal(requests.length, 3)
    assert.equal((await chat.exportLocalState()).drawing, before.drawing)
    assert.equal(chat.drawingHistory.canUndo, false)
    assert.equal((await chat.approve(result.proposal.planId)).status, 'applied')
    const reopened = await sdk.readDocument(await chat.exportDocument('DXF'), { format: 'DXF' })
    assert.equal(reopened.listEntities().find(entity => entity.type === 'TEXT').payload.text, 'REV A;保持原标点。复核版')
    for (const id of ['line-a', 'untouched']) {
      const native = await sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
      assert.deepEqual(native.getObject(id), document.getObject(id))
    }
    assert.equal((await chat.applyHistory('undo')).status, 'applied')
    const restored = await sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    assert.equal(restored.getObject('note').payload.text, 'REV A;保持原标点。')
  } finally { chat.destroy() }
})

test('online FULL tool exposes literal affixes and executes only a reviewed native TEXTEDIT', async () => {
  let callbackFailure = null
  const { chat, sdk, document, requests } = await fixtureRuntime((body, number, source) => {
    try {
    const tool = body.tools.find(item => item.function.name === 'cad_propose_text_edit')
    assert.ok(tool.function.parameters.properties.changes.items.properties.append)
    assert.match(body.messages.map(message => message.content).join('\n'), /engine joins them exactly/)
    if (number === 1) return wire('cad_find_text', { expectedRevision: source.revision, search: 'REV A', match: 'contains' })
    const receipt = JSON.parse(body.messages.find(message => message.role === 'tool').content)
    return wire('cad_propose_text_edit', { expectedRevision: source.revision, units: 'millimeter',
      changes: [{ id: receipt.value.matches[0].id, expectedText: receipt.value.matches[0].text, append: '复核版' }] })
    } catch (error) { callbackFailure = error; throw error }
  }, { includeNote: true })
  try {
    const before = await chat.exportLocalState()
    const result = await chat.send('Append "复核版" to the REV A note; do not add any separator.')
    if (callbackFailure) throw callbackFailure
    assert.equal(result.status, 'proposal', JSON.stringify(result.error))
    assert.equal(requests.length, 2)
    assert.equal((await chat.exportLocalState()).drawing, before.drawing)
    assert.equal((await chat.approve(result.proposal.planId)).status, 'applied')
    const reopened = await sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    assert.equal(reopened.getObject('note').payload.text, document.getObject('note').payload.text + '复核版')
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
