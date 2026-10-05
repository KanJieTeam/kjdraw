import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { runKJAgentTask } from '../src/agent-runner.js'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Seed actual label', tx => tx.createEntity('TEXT', {
    position: [0, 0, 0], height: 2, text: 'ZK01',
  }, { id: 'actual-label' }))
  return { document, session: new KJAgentToolSession(sdk, document) }
}
const read = { text: '', calls: [{ id: 'actual-read', name: 'cad_read_drawing', arguments: {} }] }
const answer = { text: 'There is one actual TEXT label.', calls: [] }
const propose = { text: 'Review the edit.', calls: [{ id: 'actual-proposal', name: 'cad_propose_text_edit',
  arguments: { expectedRevision: 1, units: 'millimeter', changes: [
    { id: 'actual-label', expectedText: 'ZK01', text: 'ZK02' },
  ] } }] }
function modelWith(turns, inspect = () => {}) {
  let index = 0
  return { createConversation(options) {
    inspect(options, null, 0)
    return { next: async input => {
      inspect(options, input, index + 1)
      const turn = turns[index++]
      assert.ok(turn, 'No unbudgeted model turn may be requested')
      return turn
    } }
  } }
}

test('explicit read contract gives one bounded correction, never fabricates or auto-dispatches a read', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  const result = await runKJAgentTask({ session, prompt: 'Count the actual current drawing.', expectReadEvidence: true,
    toolNames: ['cad_read_drawing'], model: modelWith([answer, read, answer], (options, input, turn) => {
      assert.equal(options.allowTextContinuation, true)
      assert.deepEqual(options.tools.map(item => item.name), ['cad_read_drawing'])
      if (turn === 2) {
        assert.equal(input.kind, 'prompt')
        assert.match(input.text, /no supplied CAD read tool has returned a successful result/)
        assert.doesNotMatch(input.text, /ZK01|actual-label|There is one/)
      }
      if (turn === 3) assert.equal(input.results[0].result.ok, true)
    }) })
  assert.equal(result.status, 'responded')
  assert.equal(result.turns, 3)
  assert.equal(result.readRepairAttempts, 1)
  assert.equal(result.repairAttempts, 1)
  assert.equal(result.toolCalls, 1)
  assert.equal(result.failedToolCalls, 0)
  assert.equal(result.outputs[0].result.value.entities.length, 1)
  assert.equal(result.outputs[0].result.value.pageEntityCounts.TEXT, 1)
  assert.equal(document.serialize(), before)
})

test('repeated confident text without actual reads fails rather than pretending drawing evidence', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  const result = await runKJAgentTask({ session, prompt: 'Count the drawing.', expectReadEvidence: true,
    model: modelWith([answer, answer]) })
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'KJAGENT_READ_REQUIRED')
  assert.equal(result.turns, 2)
  assert.equal(result.readRepairAttempts, 1)
  assert.equal(result.toolCalls, 0)
  assert.deepEqual(result.outputs, [])
  assert.deepEqual(result.proposalIds, [])
  assert.equal(document.serialize(), before)
})

for (const limits of [{ maxRepairAttempts: 0 }, { maxTurns: 1 }]) test(`missing-read correction respects ${JSON.stringify(limits)}`, async () => {
  const { session } = await fixture()
  const result = await runKJAgentTask({ session, prompt: 'Inspect actual drawing.', expectReadEvidence: true,
    ...limits, model: modelWith([answer]) })
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'KJAGENT_READ_REQUIRED')
  assert.equal(result.turns, 1)
  assert.equal(result.readRepairAttempts, 0)
  assert.equal(result.toolCalls, 0)
})

test('a failed read and later missing-read correction share, not add to, the repair budget', async () => {
  const { session } = await fixture()
  const invalidRead = { text: '', calls: [{ id: 'bad-read', name: 'cad_read_drawing', arguments: { unexpected: true } }] }
  const result = await runKJAgentTask({ session, prompt: 'Read actual drawing.', expectReadEvidence: true,
    maxRepairAttempts: 1, model: modelWith([invalidRead, answer]) })
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'KJAGENT_READ_REQUIRED')
  assert.equal(result.repairAttempts, 1)
  assert.equal(result.readRepairAttempts, 0)
  assert.equal(result.failedToolCalls, 1)
})

test('a proposed edit without required reads is rejected, cannot be approved and never changes the drawing', async () => {
  const { session, document } = await fixture(), before = document.serialize()
  const result = await runKJAgentTask({ session, prompt: 'Change label to ZK02.', expectReadEvidence: true,
    model: modelWith([propose]) })
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'KJAGENT_READ_REQUIRED')
  assert.deepEqual(result.proposalIds, [])
  const planId = result.outputs[0].result.value.planId
  assert.equal((await session.approve(planId, 'reviewer')).ok, false)
  assert.equal(document.serialize(), before)
})

test('an actual read followed by a proposal still stops before approval and remains undoable', async () => {
  const { session, document } = await fixture(), before = document.serialize()
  const result = await runKJAgentTask({ session, prompt: 'Change the exact label.', expectReadEvidence: true,
    model: modelWith([read, propose]) })
  assert.equal(result.status, 'awaiting-approval')
  assert.equal(result.readRepairAttempts, 0)
  assert.equal(document.serialize(), before)
  assert.equal((await session.approve(result.proposalIds[0], 'reviewer')).value.status, 'committed')
  assert.equal(document.getObject('actual-label').payload.text, 'ZK02')
  await document.undo()
  assert.equal(document.getObject('actual-label').payload.text, 'ZK01')
})

test('read and missing-proposal corrections use the same two-repair ceiling', async () => {
  const { session } = await fixture()
  const result = await runKJAgentTask({ session, prompt: 'Change label.', expectReadEvidence: true, expectProposal: true,
    model: modelWith([answer, read, answer, propose]) })
  assert.equal(result.status, 'awaiting-approval')
  assert.equal(result.turns, 4)
  assert.equal(result.repairAttempts, 2)
  assert.equal(result.readRepairAttempts, 1)
  assert.equal(result.proposalRepairAttempts, 1)
})

test('ordinary default and explicit false preserve text-only conversations without extra requests', async () => {
  for (const expectReadEvidence of [undefined, false]) {
    const { session } = await fixture()
    const result = await runKJAgentTask({ session, prompt: 'Explain CAD generally.', expectReadEvidence,
      model: modelWith([answer], options => assert.notEqual(options.allowTextContinuation, true)) })
    assert.equal(result.status, 'responded')
    assert.equal(result.turns, 1)
    assert.equal(result.readRepairAttempts, undefined)
  }
})

test('actual reads do not authorize declaring the answer correct or bypassing pagination', async () => {
  const { session } = await fixture()
  const wrongAnswer = { text: 'There are 999 circles.', calls: [] }
  const result = await runKJAgentTask({ session, prompt: 'Count drawing.', expectReadEvidence: true,
    model: modelWith([read, wrongAnswer]) })
  assert.equal(result.status, 'responded')
  assert.equal(result.text, wrongAnswer.text)
  assert.equal(Object.hasOwn(result, 'answerCorrect'), false)
  assert.equal(result.outputs[0].result.value.entities.length, 1)
  assert.equal(result.outputs[0].result.value.pageEntityCounts.TEXT, 1)
})

test('read evidence is run-local: a prior conversation successful read cannot validate later text-only answers', async () => {
  const { session } = await fixture()
  const first = await runKJAgentTask({ session, prompt: 'Read.', expectReadEvidence: true, model: modelWith([read, answer]) })
  assert.equal(first.status, 'responded')
  const second = await runKJAgentTask({ session, prompt: 'Read again.', expectReadEvidence: true, model: modelWith([answer, answer]) })
  assert.equal(second.error.code, 'KJAGENT_READ_REQUIRED')
  assert.equal(second.toolCalls, 0)
})

test('invalid expectation or selected tools without a read fail before contacting the model', async () => {
  const { session } = await fixture(), model = { createConversation: () => assert.fail('No model request allowed') }
  for (const expectReadEvidence of [null, 'true', 1, {}]) await assert.rejects(runKJAgentTask({
    session, prompt: 'Read.', model, expectReadEvidence,
  }), /expectReadEvidence must be a boolean/)
  await assert.rejects(runKJAgentTask({ session, prompt: 'Read.', model, expectReadEvidence: true,
    toolNames: ['cad_propose_text_edit'],
  }), /requires a selected drawing read tool/)
})
