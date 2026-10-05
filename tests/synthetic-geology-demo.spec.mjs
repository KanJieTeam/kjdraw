import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { createSyntheticGeologyDemo, proposeSyntheticGeologyScenario, SYNTHETIC_GEOLOGY_PROVENANCE,
  SYNTHETIC_GEOLOGY_SCENARIOS } from '../examples/synthetic-geology-demo.mjs'
import { collectSyntheticModelEvidence, SYNTHETIC_LIVE_ROUNDS, validateSyntheticLiveSource,
  runSyntheticGeologyRecording, validateSyntheticLiveCad, validateSyntheticLiveReads, teeSyntheticProviderResponse,
  collectSyntheticProviderResponse, SyntheticProviderEvidenceError, validateSyntheticLiveDxf,
  createSyntheticCaptureClock, auditSyntheticLiveProposalAttempts, projectSyntheticLiveSourceFacts,
  validateSyntheticLiveWireSource, validateSyntheticViewerObservations } from '../scripts/record-synthetic-geology-demo.mjs'

const clone = value => structuredClone(value)
const byHole = (source, id) => source.input.holes.find(hole => hole.id === id)
const drawingContent = document => {
  const { objects, tables, spaces, opaquePayloads } = document.snapshot()
  return { objects, tables, spaces, opaquePayloads }
}

test('live publication gate rejects any observed unavailable native preview, even if the CAD source checks pass', () => {
  assert.equal(validateSyntheticViewerObservations([]), true)
  assert.throws(() => validateSyntheticViewerObservations([{ timeMs: 1, mode: 'proposal' }]), /preview must never enter an unavailable state/)
  assert.throws(() => validateSyntheticViewerObservations(null), /actual browser viewer observations/)
})

test('offline capture clock validates finite monotonic real-video offsets, not fabricated frames', () => {
  const observations = [100, 125.5, 130, 130], elapsed = createSyntheticCaptureClock(() => observations.shift())
  assert.deepEqual([elapsed(), elapsed(), elapsed()], [25.5, 30, 30])
  assert.throws(() => createSyntheticCaptureClock(() => Number.NaN), /finite/)
  const backwards = [100, 110, 109], badElapsed = createSyntheticCaptureClock(() => backwards.shift())
  assert.equal(badElapsed(), 10); assert.throws(() => badElapsed(), /monotonic/)
})

test('offline harness: ten sequential source oracles validate one actual CAD instance without claiming a model run', async () => {
  const fixture = await createSyntheticGeologyDemo()
  try {
    assert.equal(SYNTHETIC_LIVE_ROUNDS.length, 10)
    const documentId = fixture.document.id
    for (const { id } of SYNTHETIC_LIVE_ROUNDS) {
      const beforeCad = await createKJDrawSDK().readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }), { format: 'KJD' })
      const before = clone(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source)
      const pending = await proposeSyntheticGeologyScenario(fixture, id)
      await pending.approve()
      const actual = readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source
      assert.equal(validateSyntheticLiveSource(id, before, actual), true)
      const afterCad = await createKJDrawSDK().readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }), { format: 'KJD' })
      validateSyntheticLiveCad(beforeCad, afterCad, fixture.drawingId)
      assert.equal(fixture.document.id, documentId)
      assert.deepEqual(fixture.document.getObject(fixture.manual.id), fixture.manual)
      const wrong = clone(actual); wrong.input.holes[0].collarElevation += 1
      assert.throws(() => validateSyntheticLiveSource(id, before, wrong), /unrequested source fact/)
    }
    assert.equal(fixture.document.revision, 12)
  } finally { fixture.dispose() }
})

test('offline transport fixture: split SSE tool fragments and reported usage become capture evidence, not live acceptance', async () => {
  const events = [
    { model: 'public-protocol-fixture-not-a-live-provider', choices: [{ delta: { content: '示例', tool_calls: [{ index: 0, id: 'fixture-call', function: { name: 'cad_read_drawing', arguments: '{' } }] }, finish_reason: null }] },
    { model: 'public-protocol-fixture-not-a-live-provider', choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] },
    { model: 'public-protocol-fixture-not-a-live-provider', choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
  ]
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  const evidence = await collectSyntheticModelEvidence('text/event-stream', body)
  assert.equal(evidence.streamed, true); assert.equal(evidence.textDeltas, 1)
  assert.deepEqual(evidence.toolCalls, [{ id: 'fixture-call', name: 'cad_read_drawing', arguments: {} }])
  assert.equal(evidence.usage.inputTokens, 100); assert.equal(evidence.usage.totalTokens, 120)
})

test('offline transport fixture: absent usage, truncated arguments and length finish cannot be claimed as successful capture', async () => {
  const receipt = { model: 'public-protocol-fixture-not-live', choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }
  await assert.rejects(collectSyntheticModelEvidence('application/json', JSON.stringify({ ...receipt, usage: null })), /usage receipt/)
  await assert.rejects(collectSyntheticModelEvidence('application/json', JSON.stringify({ ...receipt, choices: [{ ...receipt.choices[0], finish_reason: 'length' }] })), /truncated/)
  const malformed = { ...receipt, choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'fixture', function: { name: 'cad_read_drawing', arguments: '{' } }] }, finish_reason: 'tool_calls' }] }
  await assert.rejects(collectSyntheticModelEvidence('application/json', JSON.stringify(malformed)))
})

test('offline transport fixture: failed SSE capture retains safe actual model, length and usage metadata without partial body', async () => {
  const privateFixtureText = 'public-offline-body-marker-not-for-receipts'
  const events = [
    { model: 'public-offline-protocol-not-live', choices: [{ delta: { content: privateFixtureText,
      tool_calls: [{ index: 0, id: 'offline-call', function: { name: 'cad_propose_geology_revision', arguments: `{"private":"${privateFixtureText}` } }] }, finish_reason: 'length' }] },
    { model: 'public-offline-protocol-not-live', choices: [], usage: { prompt_tokens: 100, completion_tokens: 4096, total_tokens: 4196 } },
  ]
  const prefix = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  for (const [suffix, stage] of [['data: [DONE]\n\n', 'finish-reason'], ['data: {"incomplete":', 'response-decoding']]) {
    await assert.rejects(collectSyntheticModelEvidence('text/event-stream', prefix + suffix), error => {
      assert.ok(error instanceof SyntheticProviderEvidenceError)
      assert.equal(error.metadata.stage, stage)
      assert.equal(error.metadata.model, events[0].model)
      assert.equal(error.metadata.finishReason, 'length')
      assert.equal(error.metadata.usage.outputTokens, 4096)
      assert.equal(error.metadata.usage.totalTokens, 4196)
      assert.equal(error.metadata.completeValidatedTurn, false)
      assert.equal(error.metadata.toolCallCount, 1)
      assert.equal(error.metadata.eventCount, 2)
      assert.ok(error.metadata.argumentBytes > 0)
      assert.equal(JSON.stringify(error.metadata).includes(privateFixtureText), false)
      assert.equal(JSON.stringify(error.metadata).includes('cad_propose_geology_revision'), false)
      return true
    })
  }
})

test('offline transport fixture: complete finish with invalid arguments remains failed while retaining only safe usage metadata', async () => {
  const receipt = { model: 'public-offline-protocol-not-live', choices: [{ message: { tool_calls: [
    { id: 'offline-call', function: { name: 'cad_read_drawing', arguments: '{"neverPersistPartialBody":' } },
  ] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }
  await assert.rejects(collectSyntheticModelEvidence('application/json', JSON.stringify(receipt)), error => {
    assert.ok(error instanceof SyntheticProviderEvidenceError)
    assert.equal(error.metadata.stage, 'tool-call-json')
    assert.equal(error.metadata.finishReason, 'tool_calls')
    assert.equal(error.metadata.usage.totalTokens, 120)
    assert.equal(error.metadata.completeValidatedTurn, false)
    assert.equal(JSON.stringify(error.metadata).includes('neverPersistPartialBody'), false)
    assert.equal(error.message, 'actual tool-call arguments are incomplete or invalid JSON')
    return true
  })
})

test('offline transport fixture: provider tee retains complete real bytes/usage after the browser consumer cancels at DONE', async () => {
  const event = { model: 'public-offline-protocol-fixture-not-live', choices: [{ delta: { content: 'Synthetic fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }
  const source = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`)); setTimeout(() => controller.close(), 10) } })
  let evidencePromise
  const browser = teeSyntheticProviderResponse(new Response(source, { headers: { 'content-type': 'text/event-stream' } }), response => { evidencePromise = collectSyntheticProviderResponse(response) })
  const reader = browser.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /\[DONE\]/)
  const cancelled = reader.cancel()
  const evidence = await evidencePromise
  await cancelled; reader.releaseLock()
  assert.equal(evidence.streamed, true); assert.equal(evidence.model, event.model); assert.equal(evidence.usage.totalTokens, 120)
})

test('offline transport fixture: provider tee capture rejects reflected forbidden values and non-success HTTP without exposing body', async () => {
  await assert.rejects(collectSyntheticProviderResponse(new Response('public-forbidden-fixture-marker'), 'public-forbidden-fixture-marker'), /reflected credential/)
  await assert.rejects(collectSyntheticProviderResponse(new Response('public-body-not-to-log', { status: 502 })), /provider HTTP response status/)
})

test('offline capture gate: --live without the project credential fails closed, never calling or mocking a provider', async () => {
  const oldKey = process.env.KJDRAW_DEEPSEEK_API_KEY, oldFixture = process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT
  delete process.env.KJDRAW_DEEPSEEK_API_KEY; delete process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT
  try {
    await assert.rejects(runSyntheticGeologyRecording(['--live', '--output', '.cache/synthetic-geology-demo/offline-missing-key']), /LIVE_CREDENTIAL_REQUIRED/)
  } finally {
    if (oldKey !== undefined) process.env.KJDRAW_DEEPSEEK_API_KEY = oldKey
    if (oldFixture !== undefined) process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT = oldFixture
  }
})

test('offline CAD oracle rejects actual unrequested extra native entities and resource mutations after a valid revision', async () => {
  const fixture = await createSyntheticGeologyDemo(), sdk = createKJDrawSDK()
  const durable = () => fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }).then(data => sdk.readDocument(data, { format: 'KJD' }))
  try {
    const before = await durable(), pending = await proposeSyntheticGeologyScenario(fixture, 'collar')
    await pending.approve(); validateSyntheticLiveCad(before, await durable(), fixture.drawingId)
    await fixture.sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [405, 280, 0], radius: 2 }, options: { id: 'synthetic-review-unrequested-extra' } }, { document: fixture.document, expectedRevision: fixture.document.revision })
    assert.throws(() => validateSyntheticLiveCad(before, fixture.document, fixture.drawingId), /exact native object inventory/)
    await fixture.document.undo()
    const receipt = JSON.parse(await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }))
    const styleId = readGeologyDrawingRecipe(fixture.document, fixture.drawingId).textStyleId
    receipt.objects[styleId].name = 'Synthetic unrequested renamed text style'
    const altered = await sdk.readDocument(JSON.stringify(receipt), { format: 'KJD' })
    assert.throws(() => validateSyntheticLiveCad(before, altered, fixture.drawingId), /untouched objects/)
  } finally { fixture.dispose() }
})

test('offline receipt oracle rejects failed/listing/stale/source-mismatch reads before an actual proposal-shaped response', async () => {
  const fixture = await createSyntheticGeologyDemo()
  try {
    const identity = { revision: fixture.document.revision, documentId: fixture.document.id, drawingId: fixture.drawingId, source: fixture.source }
    const actualRead = await fixture.session.call('cad_read_geology_source', { expectedRevision: identity.revision, drawingId: identity.drawingId, maxBytes: 262144 })
    const calls = [
      { toolCalls: [{ id: 'offline-read', name: 'cad_read_geology_source', arguments: { expectedRevision: identity.revision, drawingId: identity.drawingId } }], toolReceipts: [] },
      { toolCalls: [{ id: 'offline-propose', name: 'cad_propose_geology_revision', arguments: {} }], toolReceipts: [{ id: 'offline-read', name: 'cad_read_geology_source', result: actualRead }] },
    ]
    assert.equal(validateSyntheticLiveReads(calls, identity), true)
    const badValues = [
      { ok: false, error: { code: 'OFFLINE_EXPECTED_FAILURE' } },
      { ok: true, value: { documentId: identity.documentId, revision: identity.revision, drawingIds: [identity.drawingId], sourceBacked: true } },
      { ok: true, value: { ...actualRead.value, revision: identity.revision - 1 } },
      { ok: true, value: { ...actualRead.value, documentId: 'different-public-document' } },
      { ok: true, value: { ...actualRead.value, drawingId: 'different-public-source' } },
    ]
    for (const result of badValues) { const wrong = clone(calls); wrong[1].toolReceipts[0].result = result; assert.throws(() => validateSyntheticLiveReads(wrong, identity), /successful full current source receipt/) }
    const wrongFacts = clone(calls); wrongFacts[1].toolReceipts[0].result.value.facts.holes[0].depth += 1
    assert.throws(() => validateSyntheticLiveReads(wrongFacts, identity), /exact current source facts/)
    const suppliedPack = clone(calls); suppliedPack[1].toolReceipts[0].result.value.facts.sectionStylePack = clone(identity.source.input.sectionStylePack)
    assert.throws(() => validateSyntheticLiveReads(suppliedPack, identity), /exact current source facts/)
    assert.throws(() => validateSyntheticLiveReads([calls[1], calls[0]], identity), /successful full current source receipt/)
  } finally { fixture.dispose() }
})

async function actualOfflineRepairReceipts() {
  const fixture = await createSyntheticGeologyDemo()
  const identity = { revision: fixture.document.revision, documentId: fixture.document.id, drawingId: fixture.drawingId, source: fixture.source }
  const readArguments = { expectedRevision: identity.revision, drawingId: identity.drawingId, maxBytes: 262144 }
  const read = await fixture.session.call('cad_read_geology_source', readArguments)
  const badArguments = { expectedRevision: identity.revision, units: 'millimeter', drawingId: identity.drawingId,
    updates: [{ holeId: 'SYN-04', stratumChanges: { update: [{ target: { intervalId: 'SYN-04-L2', expectedTop: 1.8, expectedBottom: 7.05 }, set: { bottom: 7.85 } }] } }] }
  const before = fixture.document.fingerprint(), rejected = await fixture.session.call('cad_propose_geology_revision', badArguments)
  assert.equal(rejected.ok, false)
  assert.equal(fixture.document.fingerprint(), before, 'rejected real host call cannot partially mutate CAD')
  const strata = clone(fixture.source.input.holes.find(hole => hole.id === 'SYN-04').strata)
  strata[1].bottom = 7.85; strata[2].top = 7.85
  const goodArguments = { expectedRevision: identity.revision, units: 'millimeter', drawingId: identity.drawingId, updates: [{ holeId: 'SYN-04', strata }] }
  const accepted = await fixture.session.call('cad_propose_geology_revision', goodArguments)
  assert.equal(accepted.ok, true, JSON.stringify(accepted.error))
  assert.equal(accepted.value.status, 'awaiting-host-approval')
  assert.equal(fixture.document.fingerprint(), before, 'corrected pending real host call still cannot mutate CAD')
  const readReceipt = { id: 'offline-current-read', name: 'cad_read_geology_source', result: read }
  const failedReceipt = { id: 'offline-rejected-proposal', name: 'cad_propose_geology_revision', result: rejected }
  // This is the exact cumulative tool-message shape consumed by successive
  // provider requests. Repeated history is one failure, not multiple failures.
  const calls = [
    { sequence: 0, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 }, toolCalls: [{ id: readReceipt.id, name: readReceipt.name, arguments: readArguments }], toolReceipts: [] },
    { sequence: 1, usage: { inputTokens: 200, outputTokens: 20, totalTokens: 220 }, toolCalls: [{ id: failedReceipt.id, name: failedReceipt.name, arguments: badArguments }], toolReceipts: [readReceipt] },
    { sequence: 2, usage: { inputTokens: 300, outputTokens: 30, totalTokens: 330 }, toolCalls: [], toolReceipts: [readReceipt, failedReceipt] },
    { sequence: 3, usage: { inputTokens: 400, outputTokens: 40, totalTokens: 440 }, toolCalls: [{ id: 'offline-corrected-proposal', name: 'cad_propose_geology_revision', arguments: goodArguments }], toolReceipts: [readReceipt, failedReceipt] },
  ]
  // Distinct HTTPS requests serialize independent historical snapshots; they
  // must not share mutable receipt references in a negative test fixture.
  return { fixture, identity, calls: calls.map(clone), accepted, before }
}

test('offline real host repair receipts admit one correct pending proposal after a documented safe failure without hiding its cost', async () => {
  const { fixture, identity, calls, accepted, before } = await actualOfflineRepairReceipts()
  try {
    const audit = auditSyntheticLiveProposalAttempts(calls)
    assert.equal(audit.totalAttempts, 2); assert.equal(audit.finalCallId, 'offline-corrected-proposal')
    assert.equal(audit.failedAttempts.length, 1)
    assert.deepEqual(audit.failedAttempts[0], { callId: 'offline-rejected-proposal', toolName: 'cad_propose_geology_revision',
      code: calls[2].toolReceipts[1].result.error.code, modelRequestSequence: 1, usage: calls[1].usage })
    assert.equal(calls.reduce((sum, call) => sum + call.usage.totalTokens, 0), 1100, 'all model requests including rejected attempt and repair count toward total cost')
    assert.equal(validateSyntheticLiveReads(calls, identity), true)
    assert.equal(fixture.document.fingerprint(), before)
    validateSyntheticLiveWireSource('boundary', fixture.source, accepted.value.engineeringEvidence.afterSource)
    const approved = await fixture.session.approve(accepted.value.planId, 'offline-public-repair-reviewer')
    assert.equal(approved.ok, true)
    validateSyntheticLiveSource('boundary', fixture.source, readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source)
  } finally { fixture.dispose() }
})

test('SDK wire projection preserves every editable fact and locks host-owned packs without weakening full source or CAD checks', async () => {
  const fixture = await createSyntheticGeologyDemo()
  try {
    const before = clone(fixture.source), beforeBytes = JSON.stringify(before)
    const facts = projectSyntheticLiveSourceFacts(before)
    for (const key of ['columnStylePack', 'sectionStylePack', 'hatchPack']) assert.equal(Object.hasOwn(facts, key), false)
    assert.ok(before.input.sectionStylePack.rules['geology-section-layout'].legendStyle)
    facts.holes[0].name = 'unrequested mutation of detached test view'
    assert.equal(JSON.stringify(fixture.source), beforeBytes)
    const pending = await proposeSyntheticGeologyScenario(fixture, 'collar')
    const actualWire = pending.proposal.engineeringEvidence.afterSource
    assert.equal(validateSyntheticLiveWireSource('collar', before, actualWire), true)
    for (const key of ['columnStylePack', 'sectionStylePack', 'hatchPack']) {
      const supplied = clone(actualWire); supplied.facts[key] = { maliciousReplacement: true }
      assert.throws(() => validateSyntheticLiveWireSource('collar', before, supplied), /host-owned packs/)
    }
    const extra = clone(actualWire); extra.sectionStylePack = clone(before.input.sectionStylePack)
    assert.throws(() => validateSyntheticLiveWireSource('collar', before, extra), /exact SDK source-facts wire schema/)
    const omitted = clone(actualWire); delete omitted.facts.holes[0].strata[0].description
    assert.throws(() => validateSyntheticLiveWireSource('collar', before, omitted), /every unrequested source fact/)
    const unrequested = clone(actualWire); unrequested.facts.holes[1].depth += 1
    assert.throws(() => validateSyntheticLiveWireSource('collar', before, unrequested), /every unrequested source fact/)
    const wrongKind = clone(actualWire); wrongKind.kind = 'column'
    assert.throws(() => validateSyntheticLiveWireSource('collar', before, wrongKind), /every unrequested source fact/)
    assert.equal(JSON.stringify(before), beforeBytes, 'wire reconstruction cannot mutate the before oracle')
    await pending.approve()
    const persisted = readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source
    assert.deepEqual(persisted.input.sectionStylePack, before.input.sectionStylePack, 'actual persisted source retains the exact host-owned pack')
    validateSyntheticLiveSource('collar', before, persisted)
  } finally { fixture.dispose() }
})

test('offline repair admission rejects fake, absent, duplicate, mismatched, unresolved or successful earlier proposal receipts', async () => {
  const { fixture, identity, calls } = await actualOfflineRepairReceipts()
  try {
    const edits = [
      data => { for (const request of data.slice(2)) delete request.toolReceipts[1].result.error },
      data => { for (const request of data.slice(2)) request.toolReceipts[1].result = { ok: false, error: { code: 'OFFLINE' }, value: { status: 'awaiting-host-approval' } } },
      data => { for (const request of data.slice(2)) request.toolReceipts = [request.toolReceipts[0]] },
      data => { data[3].toolCalls[0].id = data[1].toolCalls[0].id },
      data => { data[3].toolReceipts.push(clone(data[3].toolReceipts[1])) },
      data => { for (const request of data.slice(2)) request.toolReceipts[1].id = 'offline-wrong-call-id' },
      data => { for (const request of data.slice(2)) request.toolReceipts[1].name = 'cad_read_drawing' },
      data => { for (const request of data.slice(2)) request.toolReceipts[1].result = { ok: true, value: { status: 'awaiting-host-approval' } } },
      data => { data[3].toolReceipts[1].result.error.code = 'DIFFERENT_HOST_RESULT' },
      data => { data[1].toolReceipts.push(clone(data[2].toolReceipts[1])) },
      data => { data[3].toolCalls.push({ id: 'offline-unresolved-extra-proposal', name: 'cad_propose_geology_revision', arguments: {} }) },
      data => { data[3].toolCalls[0].name = 'cad_propose_unknown' },
      data => { data[3].toolReceipts.push({ id: data[3].toolCalls[0].id, name: data[3].toolCalls[0].name, result: { ok: false, error: { code: 'OFFLINE' } } }) },
    ]
    for (const edit of edits) {
      const invalid = clone(calls); edit(invalid)
      assert.throws(() => auditSyntheticLiveProposalAttempts(invalid))
      assert.throws(() => validateSyntheticLiveReads(invalid, identity))
    }
  } finally { fixture.dispose() }
})

// Exact target facts are checked independently of the scenario parameter builder.
function assertTargetAndUnchangedFacts(id, before, actual) {
  const unchangedBefore = clone(before), unchangedAfter = clone(actual)
  const omit = (holeId, ...fields) => {
    for (const field of fields) { delete byHole(unchangedBefore, holeId)[field]; delete byHole(unchangedAfter, holeId)[field] }
  }
  switch (id) {
    case 'collar': assert.equal(byHole(actual, 'SYN-03').collarElevation, 108.95); omit('SYN-03', 'collarElevation'); break
    case 'depth': {
      const next = byHole(actual, 'SYN-08'), old = byHole(before, 'SYN-08')
      assert.equal(next.depth, 33); assert.equal(next.strata.at(-1).bottom, 33)
      assert.deepEqual(next.strata.slice(0, -1), old.strata.slice(0, -1))
      assert.deepEqual({ ...next.strata.at(-1), bottom: old.strata.at(-1).bottom }, old.strata.at(-1))
      omit('SYN-08', 'depth', 'strata'); break
    }
    case 'stable-water': assert.equal(byHole(actual, 'SYN-02').stableWaterDepth, 4.9); omit('SYN-02', 'stableWaterDepth'); break
    case 'boundary': {
      const next = byHole(actual, 'SYN-04'), old = byHole(before, 'SYN-04')
      assert.equal(next.strata[1].bottom, 7.85); assert.equal(next.strata[2].top, 7.85)
      const adjusted = clone(next.strata); adjusted[1].bottom = old.strata[1].bottom; adjusted[2].top = old.strata[2].top
      assert.deepEqual(adjusted, old.strata); omit('SYN-04', 'strata'); break
    }
    case 'lithology-pattern': case 'boundary-only': {
      for (const old of before.input.holes) {
        const next = byHole(actual, old.id), adjusted = clone(next.strata)
        if (id === 'lithology-pattern') {
          assert.equal(next.strata[0].lithology, 'cultivated-soil'); assert.match(next.strata[0].name, /示例耕植土|Synthetic topsoil/)
          adjusted[0].lithology = old.strata[0].lithology; adjusted[0].name = old.strata[0].name
        } else { assert.equal(next.strata[0].patternVisibility, 'boundary-only'); adjusted[0].patternVisibility = old.strata[0].patternVisibility }
        assert.deepEqual(adjusted, old.strata); omit(old.id, 'strata')
      }
      break
    }
    case 'sample-add': {
      const observations = byHole(actual, 'SYN-05').observations
      assert.equal(observations.length, 5)
      assert.deepEqual(observations.at(-1), { kind: 'sample', id: 'SYN-05-SNEW', depth: 11.25, displayLabel: 'S5-NEW', sampleMarker: 'filled-circle' })
      assert.deepEqual(observations.slice(0, -1), byHole(before, 'SYN-05').observations); omit('SYN-05', 'observations'); break
    }
    case 'spt-update': {
      const observations = byHole(actual, 'SYN-03').observations
      assert.equal(observations[2].value, 32); assert.equal(observations[2].depth, 16.5)
      const adjusted = clone(observations); adjusted[2].value = byHole(before, 'SYN-03').observations[2].value
      assert.deepEqual(adjusted, byHole(before, 'SYN-03').observations); omit('SYN-03', 'observations'); break
    }
    case 'sample-remove': {
      const old = byHole(before, 'SYN-06').observations, observations = byHole(actual, 'SYN-06').observations
      assert.deepEqual(observations, old.filter(record => record.id !== 'SYN-06-S2'))
      omit('SYN-06', 'observations'); break
    }
    case 'unlink': {
      const link = before.input.correlations.find(item => item.fromHoleId === 'SYN-03' && item.toHoleId === 'SYN-04' && item.fromIntervalId === 'SYN-03-L4')
      assert.deepEqual(actual.input.correlations, before.input.correlations.filter(item => item !== link))
      assert.deepEqual(actual.input.uncorrelatedOccurrences, [
        { holeId: 'SYN-03', adjacentHoleId: 'SYN-04', intervalId: 'SYN-03-L4' },
        { holeId: 'SYN-04', adjacentHoleId: 'SYN-03', intervalId: 'SYN-04-L4' },
      ])
      delete unchangedBefore.input.correlations; delete unchangedAfter.input.correlations
      delete unchangedBefore.input.uncorrelatedOccurrences; delete unchangedAfter.input.uncorrelatedOccurrences; break
    }
    case 'split-layer': {
      for (const old of before.input.holes) {
        const next = byHole(actual, old.id)
        assert.equal(next.strata.length, 7)
        assert.equal(next.strata[1].intervalId, old.id + '-L2A'); assert.equal(next.strata[2].intervalId, old.id + '-L2B')
        assert.equal(next.strata[1].bottom, next.strata[2].top)
        assert.equal(next.strata[1].top, old.strata[1].top); assert.equal(next.strata[2].bottom, old.strata[1].bottom)
        assert.deepEqual([next.strata[0], ...next.strata.slice(3)], [old.strata[0], ...old.strata.slice(2)])
        omit(old.id, 'strata')
      }
      assert.equal(actual.input.correlations.length, 49)
      for (const link of before.input.correlations.filter(item => !item.fromIntervalId.endsWith('-L2'))) assert.ok(actual.input.correlations.some(item => JSON.stringify(item) === JSON.stringify(link)))
      delete unchangedBefore.input.correlations; delete unchangedAfter.input.correlations; break
    }
    case 'station': assert.equal(byHole(actual, 'SYN-05').station, 85.5); omit('SYN-05', 'station'); break
    case 'water-unknown': assert.equal(Object.hasOwn(byHole(actual, 'SYN-04'), 'stableWaterDepth'), false); omit('SYN-04', 'stableWaterDepth'); break
    case 'sheet-title':
      assert.equal(actual.input.title, 'Synthetic revised example / 示例修订剖面 A-A')
      delete unchangedBefore.input.title; delete unchangedAfter.input.title; break
    case 'hole-identity': {
      assert.equal(byHole(actual, 'SYN-07'), undefined)
      assert.deepEqual({ ...byHole(actual, 'SYN-07A'), id: 'SYN-07' }, byHole(before, 'SYN-07'))
      byHole(unchangedAfter, 'SYN-07A').id = 'SYN-07'
      for (const link of unchangedAfter.input.correlations) {
        if (link.fromHoleId === 'SYN-07A') link.fromHoleId = 'SYN-07'
        if (link.toHoleId === 'SYN-07A') link.toHoleId = 'SYN-07'
      }
      break
    }
    default: assert.fail(`No independent oracle for ${id}`)
  }
  assert.deepEqual(unchangedAfter, unchangedBefore, 'every unspecified source fact, link, identity and optional-field presence stays exact')
}

const comparablePayload = payload => JSON.parse(JSON.stringify({ normal: [0, 0, 1], ...payload }, (key, value) => {
  if (key === 'rawTags' || key === 'contractVersion' || /Ids?$/.test(key)) return undefined
  if (typeof value === 'number' && /angle$/i.test(key)) value = ((value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value
}))

async function assertDxfClosure(fixture) {
  const { sdk, document } = fixture
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  assert.equal(reopened.validate().valid, true)
  assert.equal(reopened.listEntities().length, document.listEntities().length)
  const objects = new Map(reopened.listEntities().map(entity => [entity.handle, entity]))
  for (const original of document.listEntities()) {
    const after = objects.get(original.handle)
    assert.ok(after); assert.equal(after.type, original.type)
    const expected = clone(original.payload), actual = clone(after.payload)
    if (original.type === 'HATCH') for (const value of [expected, actual]) {
      value.associative ??= false
      value.hatchStyle ??= 0
      for (const loop of value.boundaryLoops) loop.flags ??= 2 | (loop.external ? 1 : 0)
    }
    assert.deepEqual(comparablePayload(actual), comparablePayload(expected), 'DXF reopens every native geometry/text/hatch payload')
    for (const key of ['layerId', 'styleId', 'linetypeId']) assert.equal(reopened.getObject(actual[key])?.name, document.getObject(expected[key])?.name)
  }
  // DXF is graphics; a KJD retains the actual source recipe and identity.
  assert.equal(Object.keys(reopened.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:')), false)
  return reopened
}

test('DXF semantic oracle equates omitted normal hatch style with zero, never hiding a nonzero style change', async () => {
  const fixture = await createSyntheticGeologyDemo()
  try {
    const reopened = await fixture.sdk.readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' }), { format: 'DXF' })
    validateSyntheticLiveDxf(fixture.document, reopened)
    const receipt = JSON.parse(await fixture.sdk.writeDocument(reopened, { format: 'KJD' }))
    const hatchId = reopened.listEntities({ type: 'HATCH' })[0].id
    receipt.objects[hatchId].payload.hatchStyle = 1
    const wrongStyle = await fixture.sdk.readDocument(JSON.stringify(receipt), { format: 'KJD' })
    assert.throws(() => validateSyntheticLiveDxf(fixture.document, wrongStyle), /native geometry\/text\/pattern/)
  } finally { fixture.dispose() }
})

test('public complex fixture is eight synthetic holes, six strata each, 42 explicit links and original native patterns', async () => {
  const fixture = await createSyntheticGeologyDemo()
  try {
    assert.equal(SYNTHETIC_GEOLOGY_PROVENANCE.measuredData, false)
    assert.equal(SYNTHETIC_GEOLOGY_PROVENANCE.modelInvocations, 0)
    assert.equal(fixture.document.validate().valid, true)
    assert.equal(fixture.source.input.holes.length, 8)
    assert.ok(fixture.source.input.holes.every(hole => /^SYN-\d{2}$/.test(hole.id) && hole.strata.length === 6 && hole.observations.length === 4))
    assert.equal(fixture.source.input.correlations.length, 42)
    assert.ok(fixture.source.input.holes.every(hole => hole.strata.every(layer => /示例|Synthetic/.test(layer.name))))
    assert.match(fixture.source.input.title, /示例|Synthetic/)
    const hatches = fixture.document.listEntities({ type: 'HATCH' })
    assert.ok(hatches.length >= 90)
    assert.ok(hatches.every(entity => entity.payload.patternName.startsWith('GEO_') && entity.payload.patternLines?.length > 0))
    await assertDxfClosure(fixture)
  } finally { fixture.dispose() }
})

for (const scenario of SYNTHETIC_GEOLOGY_SCENARIOS) test(`${scenario.id}: exact requested engineering change + unchanged facts/objects + reviewed commit + undo/redo + KJD/DXF closure`, async () => {
  const fixture = await createSyntheticGeologyDemo()
  try {
    const originalRecipe = readGeologyDrawingRecipe(fixture.document, fixture.drawingId)
    const before = drawingContent(fixture.document), beforeFingerprint = fixture.document.fingerprint(), revision = fixture.document.revision
    const pending = await proposeSyntheticGeologyScenario(fixture, scenario.id)
    assert.deepEqual(drawingContent(fixture.document), before, 'planning never edits live data or geometry')
    assert.equal(fixture.document.revision, revision)
    assert.ok(pending.preview.before.length + pending.preview.after.length > 0)
    const retained = pending.unchangedIds.map(id => clone(fixture.document.getObject(id)))
    await pending.approve()
    const afterRecipe = readGeologyDrawingRecipe(fixture.document, fixture.drawingId)
    assert.equal(afterRecipe.drawingId, originalRecipe.drawingId)
    assert.equal(afterRecipe.resourceRoot, originalRecipe.resourceRoot)
    assert.equal(afterRecipe.documentId, originalRecipe.documentId)
    assertTargetAndUnchangedFacts(scenario.id, originalRecipe.source, afterRecipe.source)
    assert.deepEqual(fixture.document.getObject(fixture.manual.id), fixture.manual)
    for (const record of retained) assert.deepEqual(fixture.document.getObject(record.id), record, 'every declared unchanged CAD record stays exact')
    const after = drawingContent(fixture.document), afterFingerprint = fixture.document.fingerprint()
    assert.notEqual(afterFingerprint, beforeFingerprint)
    await fixture.document.undo()
    assert.deepEqual(drawingContent(fixture.document), before)
    assert.equal(fixture.document.fingerprint(), beforeFingerprint)
    await fixture.document.redo()
    assert.deepEqual(drawingContent(fixture.document), after)
    assert.equal(fixture.document.fingerprint(), afterFingerprint)
    const reopened = await fixture.sdk.readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }), { format: 'KJD' })
    assert.equal(reopened.validate().valid, true)
    assert.deepEqual(readGeologyDrawingRecipe(reopened, fixture.drawingId).source, afterRecipe.source)
    await assertDxfClosure(fixture)
  } finally { fixture.dispose() }
})

test('agent revision boundary explicitly rejects unsupported title and source hole rename without modifying the sheet', async () => {
  const fixture = await createSyntheticGeologyDemo()
  try {
    const before = drawingContent(fixture.document)
    for (const extra of [{ title: 'Synthetic replacement title' }, { updates: [{ holeId: 'SYN-07', id: 'SYN-07A' }] }]) {
      const result = await fixture.session.call('cad_propose_geology_revision', {
        expectedRevision: fixture.document.revision, units: 'millimeter', drawingId: fixture.drawingId,
        updates: [{ holeId: 'SYN-02', stableWaterDepth: 4.9 }], ...extra,
      })
      assert.equal(result.ok, false)
      assert.deepEqual(drawingContent(fixture.document), before)
    }
  } finally { fixture.dispose() }
})
