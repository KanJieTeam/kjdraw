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
function fixtureProvider({ clarificationText = 'There are five upper candidates. Which three should be removed?' } = {}) {
  let round = 0, count = 0, ids = []
  return async (_url, request) => {
    count++
    const body = JSON.parse(request.body)
    const context = body.messages.find(message => message.role === 'user').content
    const match = /revision (\d+); units (\w+)\./.exec(context)
    const expectedRevision = Number(match[1]), units = match[2]
    const output = body.messages.findLast(message => message.role === 'tool')
    const value = output ? JSON.parse(output.content).value : null
    const reply = (name, args) => Response.json({ choices: [{ message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'fixture-' + count, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    }, finish_reason: 'tool_calls' }] })
    if (round === 0) {
      round++
      return Response.json({ choices: [{ message: { role: 'assistant', content: clarificationText }, finish_reason: 'stop' }] })
    }
    if (round === 1) {
      if (!value) return reply('cad_query_spatial_candidates', { expectedRevision, indices: [18, 19] })
      if (value.candidates) {
        ids = value.candidates.flatMap(candidate => candidate.memberIds)
        return reply('cad_query_impact', { expectedRevision, units, operation: 'erase', ids, tolerance: 0.01, maxBytes: 262144 })
      }
      round++
      return reply('cad_propose_structural_edit', { expectedRevision, units, eraseIds: ids, tolerance: 0.01, maxBytes: 262144 })
    }
    if (!value) return reply('cad_read_history', { expectedRevision })
    const kind = round++ === 2 ? 'undo' : 'redo'
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
      result.status = 'observer-only-mutated-result'
      result.text = 'observer-only-private-marker'
      if (result.proposal) result.proposal.preview.before.length = 0
    } })
  assert.equal(report.passed, true, JSON.stringify(report))
  assert.equal(report.requests, 8)
  assert.equal(report.naturalLanguageModelCalls, 0)
  assert.deepEqual(report.rounds.map(round => round.operation), ['ambiguity', 'erase', 'undo', 'redo'])
  assert.equal(report.originalBytesUnchanged, true)
  assert.equal(report.localHistory.archived, true)
  assert.deepEqual(observed, ['ambiguity', 'erase', 'undo', 'redo'])
  assert.deepEqual(toolOutputCounts, [0, 3, 2, 2])
  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /input\.dxf|entity-|targetHistoryId|memberIds|Authorization|apiKey|3F|observer-only/)
})

test('bounded transport stops rather than inventing a successful model result', async () => {
  const report = await runImportedSpatialModel({ bytes: await publicPlan(), connection, fetchImpl: fixtureProvider(), maxRequests: 1,
    executionOrigin: 'deterministic-protocol-fixture' })
  assert.equal(report.passed, false)
  assert.equal(report.requests, 1)
  assert.equal(report.rounds[0].passed, true)
  assert.equal(report.rounds[1].passed, false)
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
