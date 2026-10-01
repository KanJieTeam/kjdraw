import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'

async function retainedSourceFixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  // The bundled Chinese layout declares separate description/sample/SPT columns,
  // so a description edit can legitimately preserve both existing observations.
  const source = { kind: 'column', input: { expectedRevision: 0, units: 'millimeter', locale: 'zh-CN', hole: {
    id: 'PUBLIC-ROUTING-A', collarElevation: 106.5, depth: 18, initialWaterDepth: 2, stableWaterDepth: 4,
    strata: [
      { intervalId: 'I-FILL', code: '1', name: 'Fill', lithology: 'fill', top: 0, bottom: 3 },
      { intervalId: 'I-CLAY', code: '2', name: 'Clay', lithology: 'clay', top: 3, bottom: 10 },
      { intervalId: 'I-SAND', code: '3', name: 'Sand', lithology: 'sand', top: 10, bottom: 18 },
    ],
    observations: [{ kind: 'sample', id: 'S-A', depth: 5 }, { kind: 'spt', id: 'N-A', depth: 12, value: 15 }],
  } } }
  const compiled = compileGeologyColumn(source.input)
  await sdk.executeCommand('CREATEBATCH', { ...structuredClone(compiled.commandArgs), geologySource: source }, { document })
  await document.transact('Unrelated public geometry', tx => tx.createEntity('CIRCLE', { center: [220, 220, 0], radius: 3 }, { id: 'manual-routing-circle' }))
  const recipe = readGeologyDrawingRecipe(document, compiled.evidence.rootObjectId)
  assert.deepEqual(recipe.source, source)
  return { sdk, document, source, drawingId: recipe.drawingId,
    dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}

function modelResponse(name, args, id, text = '') {
  return Response.json({ choices: [{ finish_reason: name ? 'tool_calls' : 'stop', message: {
    role: 'assistant', content: text,
    ...(name ? { tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : {}),
  } }], usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 } })
}
async function restoreFixture(chat, fixture, format = 'KJD') {
  const baseline = format === 'DXF'
    ? await fixture.sdk.readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' }), { format: 'DXF' })
    : fixture.document
  await chat.restoreLocalState({ drawing: await fixture.sdk.writeDocument(baseline, { format: 'KJD' }),
    sourceFormat: format, committed: false, history: [] })
}
const identityNotice = '\nPublic synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting.'
const mutations = [
  { field: 'descriptionSource', prompt: 'Set I-CLAY description to Brownish yellow, plastic with descriptionSource=interval, without inventing other descriptions.',
    change: strata => { strata[1].description = 'Brownish yellow, plastic'; strata[1].descriptionSource = 'interval' } },
  { field: 'patternVisibility', prompt: 'Set I-SAND patternVisibility to boundary-only, removing its fill but retaining the interval name and boundaries.',
    change: strata => { strata[2].patternVisibility = 'boundary-only' } },
]

for (const mutation of mutations) test(`retained-source ${mutation.field} stays available beside CAD tools and corrects Shall I proceed exactly once`, async () => {
  const fixture = await retainedSourceFixture(), requests = []
  const chat = createAiChatRuntime({ endpoint: 'https://source-routing-fixture.invalid/chat/completions', model: 'fixture-model', captureToolOutputs: true,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      requests.push(body)
      const names = body.tools.map(tool => tool.function.name)
      for (const name of ['cad_find_text', 'cad_query_drawing', 'cad_propose_text_edit', 'cad_read_geology_source', 'cad_propose_geology_revision']) assert.ok(names.includes(name), name)
      if (requests.length === 1) return modelResponse('cad_read_geology_source',
        { expectedRevision: fixture.document.revision, drawingId: fixture.drawingId, maxBytes: 262144 }, 'read-source')
      if (requests.length === 2) {
        assert.equal(JSON.parse(body.messages.at(-1).content).ok, true)
        return modelResponse(null, null, null, 'Shall I proceed?')
      }
      assert.equal(requests.length, 3, 'one bounded protocol correction, not repeated requests for consent')
      assert.equal(body.messages.at(-1).role, 'user')
      assert.match(body.messages.at(-1).content, /no reviewable proposal exists/)
      assert.match(body.messages.at(-1).content, /requirements are genuinely missing/)
      const { value } = JSON.parse(body.messages.find(message => message.role === 'tool').content)
      const strata = structuredClone(value.facts.hole.strata)
      mutation.change(strata)
      return modelResponse('cad_propose_geology_revision', { expectedRevision: value.revision, units: value.units,
        drawingId: value.drawingId, updates: [{ holeId: value.facts.hole.id, strata }] }, 'reviewable-source-proposal')
    },
  })
  try {
    await restoreFixture(chat, fixture)
    const before = await chat.exportLocalState()
    const result = await chat.send(mutation.prompt + identityNotice)
    assert.equal(result.status, 'proposal', JSON.stringify({ error: result.error, requests: requests.map(body => ({
      offeredTools: body.tools.map(tool => tool.function.name),
      toolErrors: body.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content)).filter(output => !output.ok),
    })) }))
    assert.equal(result.proposalRepairAttempts, 1)
    assert.equal(requests.length, 3)
    assert.equal(result.proposal.command, 'GEOLOGY_DRAWING_UPDATE')
    assert.equal(result.proposal.status, 'awaiting-host-approval')
    assert.equal(result.receipt, undefined)
    assert.equal(result.toolOutputs.length, 2)
    assert.equal(result.toolOutputs[0].name, 'cad_read_geology_source')
    assert.equal(result.toolOutputs[1].result.value, result.proposal)
    assert.equal((await chat.exportLocalState()).drawing, before.drawing)
    assert.equal(chat.revision, fixture.document.revision)
    assert.equal(chat.drawingHistory.canUndo, false)
    const expectedSource = structuredClone(fixture.source)
    mutation.change(expectedSource.input.hole.strata)
    assert.deepEqual(result.proposal.engineeringEvidence.beforeSource.facts, fixture.source.input)
    assert.deepEqual(result.proposal.engineeringEvidence.afterSource.facts, expectedSource.input)
    const approved = await chat.approve(result.proposal.planId)
    assert.equal(approved.status, 'applied', JSON.stringify(approved.error))
    assert.equal(approved.receipt.command, 'GEOLOGY_DRAWING_UPDATE')
    assert.equal(approved.receipt.beforeRevision, fixture.document.revision)
    assert.equal(approved.receipt.afterRevision, fixture.document.revision + 1)
    const reopened = await fixture.sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    assert.deepEqual(readGeologyDrawingRecipe(reopened, fixture.drawingId).source, expectedSource)
    assert.deepEqual(reopened.getObject('manual-routing-circle'), fixture.document.getObject('manual-routing-circle'))
    const baseline = await fixture.sdk.readDocument(before.drawing, { format: 'KJD' })
    for (const id of result.proposal.unchangedIds) assert.deepEqual(reopened.getObject(id), baseline.getObject(id), `unchanged full native record: ${id}`)
    assert.equal(reopened.validate().valid, true)
    assert.equal(chat.drawingHistory.undoCount, 1)
    assert.equal((await chat.approve(result.proposal.planId)).status, 'error')
    assert.equal(requests.length, 3, 'host approval never contacts the model')
  } finally { chat.destroy(); fixture.dispose() }
})

test('expanded retained-source policy permits exactly one correction but does not override genuinely missing data', async () => {
  const fixture = await retainedSourceFixture(), requests = []
  const question = 'What exact interval description should be recorded? No proposal has been created.'
  const chat = createAiChatRuntime({ endpoint: 'https://source-routing-fixture.invalid/chat/completions', model: 'fixture-model', captureToolOutputs: true,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      requests.push(body)
      const names = body.tools.map(tool => tool.function.name)
      assert.ok(names.includes('cad_propose_text_edit') && names.includes('cad_propose_geology_revision'))
      if (requests.length === 1) return modelResponse('cad_read_geology_source',
        { expectedRevision: fixture.document.revision, drawingId: fixture.drawingId, maxBytes: 262144 }, 'missing-description-source-read')
      assert.ok(requests.length <= 3)
      if (requests.length === 3) assert.match(body.messages.at(-1).content, /requirements are genuinely missing/)
      return modelResponse(null, null, null, question)
    },
  })
  try {
    await restoreFixture(chat, fixture)
    const before = (await chat.exportLocalState()).drawing
    const result = await chat.send('Set I-CLAY descriptionSource=interval; I have not supplied the exact description text yet.' + identityNotice)
    assert.equal(result.status, 'message')
    assert.equal(result.text, question)
    assert.equal(result.noProposal, true)
    assert.equal(result.proposalRepairAttempts, 1)
    assert.equal(requests.length, 3)
    assert.equal(result.proposal, undefined)
    assert.equal(result.receipt, undefined)
    assert.equal(result.toolOutputs.length, 1)
    assert.equal((await chat.exportLocalState()).drawing, before)
    assert.equal(chat.drawingHistory.canUndo, false)
    assert.equal((await chat.approve('invented-missing-description-plan')).status, 'error')
    assert.equal((await chat.exportLocalState()).drawing, before)
  } finally { chat.destroy(); fixture.dispose() }
})

test('explicit read-only source inspection never requests a proposal correction or offers a source edit', async () => {
  const fixture = await retainedSourceFixture(), requests = []
  const chat = createAiChatRuntime({ endpoint: 'https://source-routing-fixture.invalid/chat/completions', model: 'fixture-model', captureToolOutputs: true,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      requests.push(body)
      const names = body.tools.map(tool => tool.function.name)
      assert.ok(names.includes('cad_read_geology_source'))
      assert.equal(names.includes('cad_propose_geology_revision'), false)
      if (requests.length === 1) return modelResponse('cad_read_geology_source',
        { expectedRevision: fixture.document.revision, drawingId: fixture.drawingId, maxBytes: 262144 }, 'readonly-source-read')
      assert.equal(requests.length, 2)
      return modelResponse(null, null, null, 'Source inspected. No drawing change was requested or proposed.')
    },
  })
  try {
    await restoreFixture(chat, fixture)
    const before = (await chat.exportLocalState()).drawing
    const result = await chat.send('Read I-CLAY descriptionSource and I-SAND patternVisibility. Do not change the drawing.' + identityNotice)
    assert.equal(result.status, 'message')
    assert.equal(result.noProposal, undefined)
    assert.equal(result.proposalRepairAttempts, undefined)
    assert.equal(result.proposal, undefined)
    assert.equal(result.receipt, undefined)
    assert.equal(requests.length, 2)
    assert.equal((await chat.exportLocalState()).drawing, before)
    assert.equal(chat.drawingHistory.canUndo, false)
  } finally { chat.destroy(); fixture.dispose() }
})

test('geometry-only DXF does not acquire source mutation tools from geology-like labels or host revision framing', async () => {
  const fixture = await retainedSourceFixture(), requests = []
  const question = 'This DXF has no retained source record. Please supply the actual source facts; no proposal exists.'
  const chat = createAiChatRuntime({ endpoint: 'https://source-routing-fixture.invalid/chat/completions', model: 'fixture-model',
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      requests.push(body)
      const names = body.tools.map(tool => tool.function.name)
      assert.equal(names.includes('cad_read_geology_source'), false)
      assert.equal(names.includes('cad_propose_geology_revision'), false)
      assert.ok(names.includes('cad_propose_text_edit'))
      return modelResponse(null, null, null, question)
    },
  })
  try {
    await restoreFixture(chat, fixture, 'DXF')
    const before = (await chat.exportLocalState()).drawing
    const result = await chat.send('Set I-CLAY descriptionSource=interval.' + identityNotice)
    assert.equal(result.status, 'message')
    assert.equal(result.text, question)
    assert.equal(result.proposalRepairAttempts, 0, 'no successful source or CAD read permits a correction')
    assert.equal(result.proposal, undefined)
    assert.equal(result.receipt, undefined)
    assert.equal(requests.length, 1)
    assert.equal((await chat.exportLocalState()).drawing, before)
    assert.equal(chat.drawingHistory.canUndo, false)
  } finally { chat.destroy(); fixture.dispose() }
})
