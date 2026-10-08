import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { runKJAgentTask } from '../packages/kjdraw-sdk/src/agent-runner.js'

// Deterministic engine/transport tests, not real-provider acceptance evidence.
async function fixture(next) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Public drawing', tx => tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 5 }, { id: 'circle' }))
  const snapshot = document.snapshot(), requests = []
  const session = new KJAgentToolSession(sdk, document)
  const model = { createConversation: () => ({ next: async (input, signal) => {
    requests.push(input)
    return next(input, requests.length, signal, document)
  } }) }
  return { sdk, document, snapshot, session, model, requests, close: () => sdk.closeDocument(document.id) }
}
const text = value => ({ text: value, calls: [] })
const read = _document => ({ text: '', calls: [{ id: 'native-read', name: 'cad_read_drawing', arguments: {} }] })

test('default preserves one correction and fails closed after two unsupported model answers', async () => {
  const f = await fixture(() => text('I claim there are ten holes, without reading.'))
  try {
    const result = await runKJAgentTask({ session: f.session, model: f.model, prompt: 'Inspect this drawing.', expectReadEvidence: true })
    assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'KJAGENT_READ_REQUIRED')
    assert.equal(result.readRepairAttempts, 1); assert.equal(result.repairAttempts, 1); assert.equal(f.requests.length, 2)
    assert.equal(f.document.snapshot(), f.snapshot); assert.equal(result.outputs.length, 0); assert.equal(result.proposalIds.length, 0)
  } finally { f.close() }
})

test('opt-in second correction obtains an actual read, never invents values or changes state', async () => {
  const f = await fixture((_input, number, _signal, document) => number < 3 ? text('Unverified inventory.') : number === 3 ? read(document) : text('The native drawing has one circle.'))
  try {
    const result = await runKJAgentTask({ session: f.session, model: f.model, prompt: 'Inspect this drawing.', expectReadEvidence: true, maxReadRepairAttempts: 2 })
    assert.equal(result.status, 'responded'); assert.equal(result.readRepairAttempts, 2); assert.equal(result.repairAttempts, 2)
    assert.equal(f.requests.length, 4); assert.equal(result.outputs.length, 1); assert.equal(result.outputs[0].result.ok, true)
    assert.equal(result.outputs[0].result.value.entities[0].id, 'circle')
    for (const input of f.requests.slice(1, 3)) {
      assert.equal(input.kind, 'prompt'); assert.match(input.text, /no supplied CAD read tool/)
      assert.doesNotMatch(input.text, /circle|radius|one hole|ten holes/)
    }
    assert.equal(f.document.snapshot(), f.snapshot); assert.deepEqual(result.proposalIds, [])
  } finally { f.close() }
})

for (const [label, options, expectedRequests] of [
  ['zero read corrections', { maxReadRepairAttempts: 0 }, 1],
  ['zero shared corrections', { maxReadRepairAttempts: 2, maxRepairAttempts: 0 }, 1],
  ['shared budget caps read corrections', { maxReadRepairAttempts: 3, maxRepairAttempts: 1 }, 2],
  ['turn budget caps read corrections', { maxReadRepairAttempts: 3, maxTurns: 2 }, 2],
  ['read budget caps shared corrections', { maxReadRepairAttempts: 2, maxRepairAttempts: 4 }, 3],
]) test(label, async () => {
  const f = await fixture(() => text('Still no native evidence.'))
  try {
    const result = await runKJAgentTask({ session: f.session, model: f.model, prompt: 'Inspect.', expectReadEvidence: true, ...options })
    assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'KJAGENT_READ_REQUIRED')
    assert.equal(f.requests.length, expectedRequests); assert.equal(result.readRepairAttempts, expectedRequests - 1)
    assert.equal(f.document.snapshot(), f.snapshot); assert.equal(result.proposalIds.length, 0)
  } finally { f.close() }
})

test('failed read tool and missing-read corrections share one bounded repair budget', async () => {
  const f = await fixture((_input, number) => number === 1
    ? { text: '', calls: [{ id: 'invalid-read', name: 'cad_read_drawing', arguments: { expectedRevision: 999 } }] }
    : text('No successful read.'))
  try {
    const result = await runKJAgentTask({ session: f.session, model: f.model, prompt: 'Inspect.', expectReadEvidence: true, maxReadRepairAttempts: 2, maxRepairAttempts: 2 })
    assert.equal(result.status, 'failed'); assert.equal(result.repairAttempts, 2); assert.equal(result.readRepairAttempts, 1)
    assert.equal(f.requests.length, 3); assert.equal(result.failedToolCalls, 1); assert.equal(result.outputs[0].result.ok, false)
    assert.equal(f.document.snapshot(), f.snapshot)
  } finally { f.close() }
})

test('cancellation between corrections prevents a third request and any mutation', async () => {
  const controller = new AbortController()
  const f = await fixture((_input, number) => { if (number === 2) controller.abort(); return text('No evidence.') })
  try {
    const result = await runKJAgentTask({ session: f.session, model: f.model, prompt: 'Inspect.', expectReadEvidence: true, maxReadRepairAttempts: 2, signal: controller.signal })
    assert.equal(result.status, 'cancelled'); assert.equal(f.requests.length, 2); assert.equal(f.document.snapshot(), f.snapshot)
  } finally { f.close() }
})

test('extra read budget does not retry transport exceptions', async () => {
  const f = await fixture(() => { throw new Error('Private transport failure') })
  try {
    const result = await runKJAgentTask({ session: f.session, model: f.model, prompt: 'Inspect.', expectReadEvidence: true, maxReadRepairAttempts: 2 })
    assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'KJMODEL_REQUEST_FAILED'); assert.equal(f.requests.length, 1)
    assert.doesNotMatch(result.error.message, /Private transport/); assert.equal(f.document.snapshot(), f.snapshot)
  } finally { f.close() }
})

for (const limit of [-1, 0.5, 33, NaN, Infinity, '2', null]) test(`invalid read budget rejected before model: ${String(limit)}`, async () => {
  const f = await fixture(() => text('Should not run.'))
  try {
    await assert.rejects(runKJAgentTask({ session: f.session, model: f.model, prompt: 'Inspect.', expectReadEvidence: true, maxReadRepairAttempts: limit }), /Read repair attempt limit/)
    assert.equal(f.requests.length, 0); assert.equal(f.document.snapshot(), f.snapshot)
  } finally { f.close() }
})

test('read budget has no effect when read evidence was not requested', async () => {
  const f = await fixture(() => text('Plain response.'))
  try {
    const result = await runKJAgentTask({ session: f.session, model: f.model, prompt: 'Explain CAD.', maxReadRepairAttempts: 2 })
    assert.equal(result.status, 'responded'); assert.equal(result.readRepairAttempts, undefined); assert.equal(f.requests.length, 1)
  } finally { f.close() }
})
