import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn, compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'

async function sourceColumnFixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const source = { kind: 'column', input: { expectedRevision: 0, units: 'millimeter', locale: 'en', hole: {
    id: 'PUBLIC-A', collarElevation: 106.5, depth: 18, initialWaterDepth: 2, stableWaterDepth: 4,
    strata: [
      { intervalId: 'I-FILL', code: '1', name: 'Fill', lithology: 'fill', top: 0, bottom: 3 },
      { intervalId: 'I-CLAY', code: '2', name: 'Clay', lithology: 'clay', top: 3, bottom: 10 },
      { intervalId: 'I-SAND', code: '3', name: 'Sand', lithology: 'sand', top: 10, bottom: 18 },
    ],
  } } }
  const compiled = compileGeologyColumn(source.input)
  await sdk.executeCommand('CREATEBATCH', { ...structuredClone(compiled.commandArgs), geologySource: source }, { document })
  await document.transact('Unrelated manual geometry', tx => tx.createEntity('CIRCLE', { center: [200, 200, 0], radius: 3 }, { id: 'manual-retained' }))
  const recipe = readGeologyDrawingRecipe(document, compiled.evidence.rootObjectId)
  assert.deepEqual(recipe.source, source)
  return { sdk, document, source, drawingId: recipe.drawingId }
}
function wire(name, args, id, text = '') {
  return Response.json({ choices: [{ finish_reason: name ? 'tool_calls' : 'stop', message: {
    role: 'assistant', content: text,
    ...(name ? { tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : {}),
  } }], usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 } })
}
async function loadSource(chat, fixture) {
  await chat.restoreLocalState({ drawing: await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }),
    sourceFormat: 'KJD', committed: false, history: [] })
}

test('source-backed edit corrects one missing proposal after a real read and still waits for a host receipt', async () => {
  const fixture = await sourceColumnFixture(), requests = []
  const chat = createAiChatRuntime({ endpoint: 'https://source-fixture.invalid/chat/completions', model: 'fixture-model', captureToolOutputs: true,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      requests.push(body)
      const names = body.tools.map(tool => tool.function.name)
      assert.ok(names.includes('cad_read_geology_source') && names.includes('cad_propose_geology_revision'))
      assert.equal(names.includes('cad_propose_text_edit'), false)
      assert.match(body.messages[0].content, /pageEntityCounts/)
      assert.match(body.messages[0].content, /genuinely missing design requirements/)
      assert.match(body.messages[0].content, /does not require an extra execution consent/)
      assert.match(body.tools.find(tool => tool.function.name === 'cad_propose_geology_revision').function.description,
        /collarElevation minus stored depths/)
      if (requests.length === 1) return wire('cad_read_geology_source',
        { expectedRevision: fixture.document.revision, drawingId: fixture.drawingId, maxBytes: 262144 }, 'source-read')
      if (requests.length === 2) {
        const result = JSON.parse(body.messages.at(-1).content)
        assert.equal(result.ok, true)
        assert.equal(result.value.facts.hole.id, 'PUBLIC-A')
        assert.equal(result.value.facts.hole.stableWaterDepth, 4)
        return wire(null, null, null, 'Please confirm that I may prepare the requested source proposal.')
      }
      assert.equal(requests.length, 3, 'the host permits exactly one missing-proposal correction')
      assert.equal(body.messages.at(-1).role, 'user')
      assert.match(body.messages.at(-1).content, /no reviewable proposal exists/)
      assert.match(body.messages.at(-1).content, /requirements are genuinely missing/)
      const sourceRead = JSON.parse(body.messages.find(message => message.role === 'tool').content)
      return wire('cad_propose_geology_revision', { expectedRevision: sourceRead.value.revision, units: 'millimeter',
        drawingId: sourceRead.value.drawingId, updates: [{ holeId: 'PUBLIC-A', collarElevation: 108.5 }] }, 'source-proposal')
    },
  })
  try {
    await loadSource(chat, fixture)
    const before = await chat.exportLocalState(), manual = fixture.document.getObject('manual-retained')
    const result = await chat.send('Change borehole PUBLIC-A collar elevation to 108.5 metres; preserve its water depths and all other supplied source fields.')
    assert.equal(result.status, 'proposal', JSON.stringify(result.error))
    assert.equal(result.proposalRepairAttempts, 1)
    assert.equal(requests.length, 3)
    assert.equal(result.proposal.status, 'awaiting-host-approval')
    assert.equal(result.toolOutputs.at(-1).result.value, result.proposal)
    assert.equal((await chat.exportLocalState()).drawing, before.drawing)
    assert.equal(chat.revision, fixture.document.revision)
    assert.equal(chat.drawingHistory.canUndo, false)
    assert.equal(result.receipt, undefined)
    assert.equal(result.proposal.engineeringEvidence.beforeSource.facts.hole.collarElevation, 106.5)
    assert.equal(result.proposal.engineeringEvidence.afterSource.facts.hole.collarElevation, 108.5)
    assert.equal(result.proposal.engineeringEvidence.afterSource.facts.hole.stableWaterDepth, 4)
    assert.equal(result.proposal.engineeringEvidence.afterSource.facts.hole.initialWaterDepth, 2)
    assert.deepEqual(result.proposal.engineeringEvidence.afterSource.facts.hole.strata, fixture.source.input.hole.strata)
    const applied = await chat.approve(result.proposal.planId)
    assert.equal(applied.status, 'applied', JSON.stringify(applied.error))
    assert.equal(applied.receipt.command, result.proposal.command)
    assert.equal(applied.receipt.beforeRevision, fixture.document.revision)
    assert.equal(applied.receipt.afterRevision, fixture.document.revision + 1)
    const after = await fixture.sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    const recovered = readGeologyDrawingRecipe(after, fixture.drawingId)
    const expectedSource = structuredClone(fixture.source)
    expectedSource.input.hole.collarElevation = 108.5
    assert.deepEqual(recovered.source, expectedSource)
    assert.deepEqual(after.getObject('manual-retained'), manual)
    assert.equal(after.validate().valid, true)
    assert.equal(chat.drawingHistory.undoCount, 1)
    assert.equal((await chat.approve(result.proposal.planId)).status, 'error', 'a used receipt cannot authorize a second application')
  } finally { chat.destroy() }
})

test('genuine missing source requirements survive one correction as clarification without guessed facts or mutation', async () => {
  const fixture = await sourceColumnFixture(), requests = []
  const question = 'What measured stable groundwater depth should replace the existing value? No proposal has been created.'
  const chat = createAiChatRuntime({ endpoint: 'https://source-fixture.invalid/chat/completions', model: 'fixture-model', captureToolOutputs: true,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      requests.push(body)
      if (requests.length === 1) return wire('cad_read_geology_source',
        { expectedRevision: fixture.document.revision, drawingId: fixture.drawingId, maxBytes: 262144 }, 'clarification-source-read')
      if (requests.length === 2) assert.equal(JSON.parse(body.messages.at(-1).content).ok, true)
      else {
        assert.equal(requests.length, 3)
        assert.match(body.messages.at(-1).content, /requirements are genuinely missing/)
      }
      return wire(null, null, null, question)
    },
  })
  try {
    await loadSource(chat, fixture)
    const before = (await chat.exportLocalState()).drawing
    const result = await chat.send('Update borehole PUBLIC-A stable groundwater depth, using the measured value I will provide next.')
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    assert.equal(result.text, question)
    assert.equal(result.noProposal, true)
    assert.equal(result.proposalRepairAttempts, 1)
    assert.equal(result.proposal, undefined)
    assert.equal(result.receipt, undefined)
    assert.equal(requests.length, 3)
    assert.equal(result.toolOutputs.length, 1)
    assert.equal(result.toolOutputs[0].name, 'cad_read_geology_source')
    assert.equal((await chat.exportLocalState()).drawing, before)
    assert.equal(chat.drawingHistory.canUndo, false)
    assert.equal((await chat.approve('fabricated-missing-facts-plan')).status, 'error')
    assert.equal((await chat.exportLocalState()).drawing, before)
  } finally { chat.destroy() }
})

test('online source clarification without a successful read fails after one bounded read reminder and never creates a proposal', async () => {
  const fixture = await sourceColumnFixture()
  let requests = 0
  const question = 'Please provide the new measured water depth; the drawing is unchanged.'
  const chat = createAiChatRuntime({ endpoint: 'https://source-fixture.invalid/chat/completions', model: 'fixture-model',
    fetchImpl: async () => { requests++; return wire(null, null, null, question) },
  })
  try {
    await loadSource(chat, fixture)
    const before = await chat.exportLocalState()
    const result = await chat.send('Revise borehole PUBLIC-A stable groundwater depth to the value I have not supplied yet.')
    assert.equal(result.status, 'error')
    assert.equal(result.error.code, 'KJAGENT_READ_REQUIRED')
    assert.equal(result.text, '', 'Unverified provider prose is not presented as a successful current-document result')
    assert.equal(result.proposal, undefined)
    assert.equal(result.receipt, undefined)
    assert.equal(requests, 2, 'One read-evidence reminder only; no host-dispatched read or extended budget')
    assert.equal(Object.hasOwn(result, 'toolOutputs'), false)
    const after = await chat.exportLocalState()
    assert.equal(after.drawing, before.drawing)
    assert.deepEqual(after.drawingHistory, before.drawingHistory)
    assert.equal(chat.drawingHistory.canUndo, false)
  } finally { chat.destroy() }
})

test('online source clarification after a real successful source read preserves missing facts and never guesses a replacement value', async () => {
  const fixture = await sourceColumnFixture(), requests = []
  const question = 'Please provide the new measured water depth; the drawing is unchanged.'
  const chat = createAiChatRuntime({ endpoint: 'https://source-fixture.invalid/chat/completions', model: 'fixture-model', captureToolOutputs: true,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      requests.push(body)
      if (requests.length === 1) return wire('cad_read_geology_source',
        { expectedRevision: fixture.document.revision, drawingId: fixture.drawingId, maxBytes: 262144 }, 'actual-source-before-clarification')
      if (requests.length === 2) {
        const actual = JSON.parse(body.messages.at(-1).content)
        assert.equal(actual.ok, true)
        assert.equal(actual.value.documentId, fixture.document.id)
        assert.equal(actual.value.revision, fixture.document.revision)
        assert.equal(actual.value.facts.hole.stableWaterDepth, 4, 'The existing fact is not permission to invent a new measured replacement')
      } else {
        assert.equal(requests.length, 3)
        assert.match(body.messages.at(-1).content, /requirements are genuinely missing/)
      }
      return wire(null, null, null, question)
    },
  })
  try {
    await loadSource(chat, fixture)
    const before = await chat.exportLocalState()
    const result = await chat.send('Revise borehole PUBLIC-A stable groundwater depth to the value I have not supplied yet.')
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    assert.equal(result.text, question)
    assert.equal(result.noProposal, true)
    assert.equal(result.proposalRepairAttempts, 1)
    assert.equal(requests.length, 3)
    assert.equal(result.proposal, undefined)
    assert.equal(result.receipt, undefined)
    assert.equal(result.toolOutputs.length, 1)
    assert.equal(result.toolOutputs[0].name, 'cad_read_geology_source')
    assert.equal(result.toolOutputs[0].result.ok, true)
    const after = await chat.exportLocalState()
    assert.equal(after.drawing, before.drawing)
    assert.deepEqual(after.drawingHistory, before.drawingHistory)
    assert.equal(chat.drawingHistory.canUndo, false)
    assert.equal((await chat.approve('not-a-missing-facts-proposal')).error.code, 'AI_PROPOSAL_MISSING')
  } finally { chat.destroy() }
})

test('actual section compiler derives stable-water native geometry from collar minus stored depth without inventing an elevation source field', async () => {
  const baseHole = (id, station, collarElevation, stableWaterDepth) => ({ id, station, collarElevation, depth: 16,
    ...(stableWaterDepth === undefined ? {} : { stableWaterDepth }),
    strata: [{ intervalId: id + '-FILL', code: '1', name: 'Fill', lithology: 'fill', top: 0, bottom: 3 },
      { intervalId: id + '-CLAY', code: '2', name: 'Clay', lithology: 'clay', top: 3, bottom: 16 }],
  })
  const input = { expectedRevision: 0, units: 'millimeter', locale: 'en', holes: [baseHole('PUBLIC-A', 0, 106, 4), baseHole('PUBLIC-B', 20, 109)],
    horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 85,
    surfaceRule: 'straight-between-supplied-collars', correlations: [
      { fromHoleId: 'PUBLIC-A', toHoleId: 'PUBLIC-B', fromIntervalId: 'PUBLIC-A-FILL', toIntervalId: 'PUBLIC-B-FILL' },
      { fromHoleId: 'PUBLIC-A', toHoleId: 'PUBLIC-B', fromIntervalId: 'PUBLIC-A-CLAY', toIntervalId: 'PUBLIC-B-CLAY' },
    ],
  }
  async function nativeText(candidate, text) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    const compiled = compileGeologySection(candidate)
    await sdk.executeCommand('CREATEBATCH', structuredClone(compiled.commandArgs), { document })
    const matches = document.listEntities({ type: 'TEXT' }).filter(entity => entity.payload.text === text)
    assert.equal(matches.length, 1, `one actual native annotation: ${text}`)
    assert.equal(document.validate().valid, true)
    const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
    // KJD is JSON: an optional undefined alignmentPoint is not a stored field.
    // Compare every serializable record field, including identity and geometry.
    assert.deepEqual(reopened.getObject(matches[0].id), JSON.parse(JSON.stringify(matches[0])))
    return matches[0].payload.position
  }
  const baselineWater = await nativeText(input, 'WL 4.00')
  const baselineCollar = await nativeText(input, '106.00')
  const millimetresPerMetre = 1000 / input.verticalScaleDenominator
  assert.ok(Math.abs((baselineCollar[1] - 3.2) - (baselineWater[1] + 0.7) - 4 * millimetresPerMetre) < 1e-9)
  const raised = structuredClone(input)
  raised.holes[0].collarElevation = 108
  const raisedWater = await nativeText(raised, 'WL 4.00')
  assert.ok(Math.abs(raisedWater[1] - baselineWater[1] - 2 * millimetresPerMetre) < 1e-9)
  const deeper = structuredClone(input)
  deeper.holes[0].stableWaterDepth = 6
  const deeperWater = await nativeText(deeper, 'WL 6.00')
  assert.ok(Math.abs(deeperWater[1] - baselineWater[1] + 2 * millimetresPerMetre) < 1e-9)
  assert.equal(raisedWater[0], baselineWater[0])
  assert.equal(deeperWater[0], baselineWater[0])
  assert.equal(Object.hasOwn(input.holes[0], 'stableWaterElevation'), false)
  assert.equal(Object.hasOwn(raised.holes[0], 'stableWaterElevation'), false)
  assert.deepEqual(raised.holes[1], input.holes[1])
})
