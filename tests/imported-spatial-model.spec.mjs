import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { importedSpatialModelProtocol, runImportedSpatialModel } from '../scripts/benchmarks/imported-spatial-model.mjs'

// These are deterministic protocol/host-oracle selftests, not model passes.
const connection = { endpoint: 'https://spatial-fixture.invalid/v1/chat/completions', model: 'fixture' }
async function publicPlan() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Public synthetic source-specific oracle fixture', tx => {
    for (let index = 0; index < 20; index++) {
      const row = index < 18 ? Math.floor(index / 5) : 4
      const x = (index < 18 ? index % 5 : index - 18) * 80, y = 300 - row * 60
      tx.createEntity('LWPOLYLINE', { vertices: [[x, y], [x + 24, y], [x + 24, y + 20], [x, y + 20]], closed: true })
      tx.createEntity('TEXT', { position: [x + 4, y + 10], text: '3F', height: 2 })
      if (index >= 18) for (let item = 0; item < (index === 18 ? 10 : 9); item++) {
        tx.createEntity('CIRCLE', { center: [x + 2 + item * 2, y + 4], radius: 0.3 })
      }
    }
    for (let index = 0; index < 777; index++) tx.createEntity('LINE', {
      start: [10000 + index * 2, 0], end: [10001 + index * 2, 1],
    })
  })
  return new TextEncoder().encode(await sdk.writeDocument(document, { format: 'DXF' }))
}
function fixtureProvider({ clarificationText, initialClarificationWithoutRead = false, neverRead = false, proposeAmbiguous = false } = {}) {
  let count = 0, ids = []
  return async (_url, request) => {
    count++
    const body = JSON.parse(request.body)
    const context = body.messages.find(message => message.role === 'user').content
    const match = /revision (\d+); units (\w+)\./.exec(context)
    const expectedRevision = Number(match[1]), units = match[2]
    // Test-only frozen protocol binding, not a model intent interpreter. The
    // first Host context keeps the ORIGINAL user request through generic read
    // and proposal corrections. A transport response never starts a new round.
    const originalRequest = context.slice(context.lastIndexOf('Current user request: ') + 'Current user request: '.length)
    const operation = importedSpatialModelProtocol.rounds.find(round => round.prompt === originalRequest)?.operation
    assert.ok(operation, 'Every fixture request must retain one exact original frozen task')
    const output = body.messages.findLast(message => message.role === 'tool')
    const value = output ? JSON.parse(output.content).value : null
    const reply = (name, args) => Response.json({ choices: [{ message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'fixture-' + count, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    }, finish_reason: 'tool_calls' }] })
    const clarify = text => Response.json({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] })
    if (operation === 'ambiguity') {
      if (neverRead || initialClarificationWithoutRead && count === 1)
        return clarify(clarificationText ?? 'There may be several upper candidates. Which three should be removed?')
      if (!value) return reply('cad_query_spatial_candidates', { expectedRevision, indices: [0, 1, 2, 3, 4] })
      if (proposeAmbiguous) {
        if (value.candidates) {
          ids = value.candidates.slice(0, 3).flatMap(candidate => candidate.memberIds)
          return reply('cad_query_impact', { expectedRevision, units, operation: 'erase', ids, tolerance: 0.01, maxBytes: 262144 })
        }
        return reply('cad_propose_structural_edit', { expectedRevision, units, eraseIds: ids, tolerance: 0.01, maxBytes: 262144 })
      }
      assert.equal(value.expectedRevision, expectedRevision)
      const upperCount = value.extremeEdgeBands.top.indices.length
      assert.equal(value.candidates.length, upperCount, 'Clarification must follow a real complete read of the upper band')
      return clarify(clarificationText ?? `There are ${upperCount === 5 ? 'five' : upperCount} upper candidates. Which three should be removed?`)
    }
    if (operation === 'erase') {
      if (!value) return reply('cad_query_spatial_candidates', { expectedRevision, indices: [18, 19] })
      if (value.candidates) {
        ids = value.candidates.flatMap(candidate => candidate.memberIds)
        return reply('cad_query_impact', { expectedRevision, units, operation: 'erase', ids, tolerance: 0.01, maxBytes: 262144 })
      }
      return reply('cad_propose_structural_edit', { expectedRevision, units, eraseIds: ids, tolerance: 0.01, maxBytes: 262144 })
    }
    if (!value) return reply('cad_read_history', { expectedRevision })
    const kind = operation
    return reply('cad_propose_' + kind, { expectedRevision, units, targetHistoryId: value.history[kind + 'Target'].id })
  }
}

test('fixed spatial protocol is frozen and mismatched inputs never contact a model', async () => {
  assert.equal(Object.isFrozen(importedSpatialModelProtocol.rounds[0]), true)
  assert.equal(Object.isFrozen(importedSpatialModelProtocol.oracle.bottomIndices), true)
  const sdk = createKJDrawSDK(), doc = sdk.createDocument()
  await doc.transact('Different input', tx => tx.createEntity('LINE', { start: [0, 0], end: [1, 1] }))
  let requests = 0
  const report = await runImportedSpatialModel({ bytes: new TextEncoder().encode(await sdk.writeDocument(doc, { format: 'DXF' })),
    connection, fetchImpl: async () => { requests++; throw new Error('must not be reached') }, executionOrigin: 'deterministic-protocol-fixture' })
  assert.equal(requests, 0)
  assert.equal(report.failure, 'SOURCE_PROTOCOL_IDENTITY_MISMATCH')
  assert.equal(report.originalBytesUnchanged, true)
})

test('deterministic public selftest verifies reviewed exact erase, real undo/redo and reopen; zero natural language model calls', async () => {
  const observed = [], toolOutputCounts = []
  const report = await runImportedSpatialModel({ bytes: await publicPlan(), connection, fetchImpl: fixtureProvider(),
    executionOrigin: 'deterministic-protocol-fixture', reviewClarification: ({ topCandidateCount }) => topCandidateCount === 5,
    onModelResult: ({ operation, result }) => {
      observed.push(operation)
      toolOutputCounts.push(result.toolOutputs.length)
      if (operation === 'ambiguity') {
        assert.equal(result.status, 'message')
        assert.equal(result.proposal, undefined)
        const actualRead = result.toolOutputs[0]
        assert.equal(actualRead.name, 'cad_query_spatial_candidates')
        assert.equal(actualRead.result.ok, true)
        assert.equal(actualRead.result.value.returned, 5)
        assert.deepEqual(actualRead.result.value.extremeEdgeBands.top.indices, [0, 1, 2, 3, 4])
      }
      result.status = 'observer-only-mutated-result'
      result.text = 'observer-only-private-marker'
      if (result.proposal) result.proposal.preview.before.length = 0
    } })
  assert.equal(report.passed, true, JSON.stringify(report))
  assert.equal(report.requests, 10, 'One real ambiguity read and one bounded proposal correction precede the clarified message')
  assert.equal(report.naturalLanguageModelCalls, 0)
  assert.deepEqual(report.rounds.map(round => round.operation), ['ambiguity', 'erase', 'undo', 'redo'])
  assert.equal(report.originalBytesUnchanged, true)
  assert.equal(report.localHistory.archived, true)
  assert.deepEqual(observed, ['ambiguity', 'erase', 'undo', 'redo'])
  assert.deepEqual(toolOutputCounts, [1, 3, 2, 2])
  assert.deepEqual(report.trace.filter(turn => turn.round === 1).flatMap(turn => turn.toolCalls), ['cad_query_spatial_candidates'],
    'The ambiguous original request must never drift into impact or a mutation proposal')
  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /input\.dxf|entity-|targetHistoryId|memberIds|Authorization|apiKey|3F|observer-only/)
})

test('bounded transport stops rather than inventing a successful model result', async () => {
  const report = await runImportedSpatialModel({ bytes: await publicPlan(), connection, fetchImpl: fixtureProvider(), maxRequests: 1,
    executionOrigin: 'deterministic-protocol-fixture' })
  assert.equal(report.passed, false)
  assert.equal(report.requests, 1)
  assert.equal(report.rounds[0].passed, false, 'A partial native read is not a completed model clarification')
  assert.equal(report.rounds.length, 1)
  assert.equal(report.originalBytesUnchanged, true)
})

test('opt-in original plan passes deterministic SDK/oracle selftest without source writes or natural language model calls', {
  skip: !process.env.KJDRAW_SPATIAL_DXF,
}, async () => {
  const path = process.env.KJDRAW_SPATIAL_DXF, bytes = new Uint8Array(await readFile(path))
  const hash = value => createHash('sha256').update(value).digest('hex')
  const beforeHash = hash(bytes)
  const report = await runImportedSpatialModel({ bytes, connection, fetchImpl: fixtureProvider(),
    executionOrigin: 'deterministic-protocol-fixture', reviewClarification: ({ topCandidateCount }) => topCandidateCount === 5 })
  assert.equal(report.passed, true, JSON.stringify(report))
  assert.equal(report.naturalLanguageModelCalls, 0)
  assert.equal(hash(await readFile(path)), beforeHash)
})

test('ungraded natural-language meaning cannot become an overall clarification pass', async () => {
  const report = await runImportedSpatialModel({ bytes: await publicPlan(), connection, fetchImpl: fixtureProvider(),
    executionOrigin: 'deterministic-protocol-fixture' })
  assert.equal(report.nativeProtocolPassed, true)
  assert.equal(report.semanticClarificationConfirmed, null)
  assert.equal(report.passed, false)
  assert.equal(report.failure, 'CLARIFICATION_REVIEW_REQUIRED')
})

test('a safe clarification with the wrong candidate count remains a semantic failure', async () => {
  const report = await runImportedSpatialModel({ bytes: await publicPlan(), connection,
    fetchImpl: fixtureProvider({ clarificationText: 'There are four upper candidates. Which three should be removed?' }),
    executionOrigin: 'deterministic-protocol-fixture',
    reviewClarification: ({ text }) => text.includes('five upper candidates'),
  })
  assert.equal(report.nativeProtocolPassed, true)
  assert.equal(report.semanticClarificationConfirmed, false)
  assert.equal(report.passed, false)
  assert.equal(report.failure, 'CLARIFICATION_NOT_CONFIRMED')
  assert.equal(report.originalBytesUnchanged, true)
})

test('read then proposal corrections remain bound to the original ambiguity and fail closed at the existing text-continuation limit', async () => {
  const observed = []
  const report = await runImportedSpatialModel({ bytes: await publicPlan(), connection,
    fetchImpl: fixtureProvider({ initialClarificationWithoutRead: true }), executionOrigin: 'deterministic-protocol-fixture',
    reviewClarification: ({ text, topCandidateCount }) => topCandidateCount === 5 && text.includes('five upper candidates'),
    onModelResult: ({ operation, result }) => observed.push({ operation, status: result.status,
      errorCode: result.error?.code, names: result.toolOutputs.map(output => output.name), proposal: Boolean(result.proposal) }) })
  // The existing adapter permits one text continuation, not an unbounded chain
  // of read and proposal reminders. A successful read must not conceal a later
  // typed protocol failure or let this fixture advance to the erase task.
  assert.equal(report.passed, false, JSON.stringify(report))
  assert.equal(report.nativeProtocolPassed, false)
  assert.equal(report.semanticClarificationConfirmed, null)
  assert.equal(report.naturalLanguageModelCalls, 0)
  assert.equal(report.requests, 3)
  assert.equal(report.rounds.length, 1)
  assert.equal(report.rounds[0].requests, 3)
  assert.deepEqual(observed[0], { operation: 'ambiguity', status: 'error', errorCode: 'KJMODEL_PROTOCOL',
    names: ['cad_query_spatial_candidates'], proposal: false })
  assert.equal(report.failureStage, 'AMBIGUITY_APPROVAL_ISOLATION')
  assert.equal(report.failure, 'AMBIGUOUS_TARGET_NOT_CLARIFIED')
  assert.deepEqual(report.trace.filter(turn => turn.round === 1).flatMap(turn => turn.toolCalls), ['cad_query_spatial_candidates'])
  assert.equal(report.originalBytesUnchanged, true)
})

test('persistent prose without actual reads is rejected by the online read guard, never graded as safe clarification', async () => {
  let result
  const report = await runImportedSpatialModel({ bytes: await publicPlan(), connection,
    fetchImpl: fixtureProvider({ neverRead: true }), executionOrigin: 'deterministic-protocol-fixture',
    reviewClarification: () => true, onModelResult: ({ result: actual }) => { result = actual } })
  assert.equal(result.status, 'error')
  assert.equal(result.error.code, 'KJAGENT_READ_REQUIRED')
  assert.equal(result.proposal, undefined)
  assert.deepEqual(result.toolOutputs, [])
  assert.equal(report.passed, false)
  assert.equal(report.nativeProtocolPassed, false)
  assert.equal(report.rounds.length, 1)
  assert.equal(report.requests, 2)
  assert.equal(report.failure, 'AMBIGUOUS_TARGET_NOT_CLARIFIED')
  assert.equal(report.naturalLanguageModelCalls, 0)
  assert.equal(report.originalBytesUnchanged, true)
})

test('a real structural proposal that guesses three of five upper candidates is never approved as clarification', async () => {
  let result
  const report = await runImportedSpatialModel({ bytes: await publicPlan(), connection,
    fetchImpl: fixtureProvider({ proposeAmbiguous: true }), executionOrigin: 'deterministic-protocol-fixture',
    reviewClarification: () => true, onModelResult: ({ result: actual }) => { result = actual } })
  assert.equal(result.status, 'proposal')
  assert.equal(result.proposals.length, 1)
  assert.equal(result.proposal.command, 'STRUCTURALEDIT')
  assert.deepEqual(result.toolOutputs.map(output => output.name), ['cad_query_spatial_candidates', 'cad_query_impact', 'cad_propose_structural_edit'])
  assert.equal(result.toolOutputs.every(output => output.result.ok), true)
  assert.equal(report.passed, false)
  assert.equal(report.nativeProtocolPassed, false)
  assert.equal(report.semanticClarificationConfirmed, null)
  assert.equal(report.failureStage, 'AMBIGUITY_APPROVAL_ISOLATION')
  assert.equal(report.failure, 'AMBIGUOUS_TARGET_NOT_CLARIFIED')
  assert.equal(report.rounds.length, 1)
  assert.equal(report.requests, 3)
  assert.equal(report.naturalLanguageModelCalls, 0)
  assert.equal(report.originalBytesUnchanged, true)
})
