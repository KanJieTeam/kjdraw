import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { runKJAgentTask } from '../src/agent-runner.js'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Seed label', tx => tx.createEntity('TEXT', {
    text: 'ZK01', position: [0, 0, 0], height: 2,
  }, { id: 'label' }))
  return { document, session: new KJAgentToolSession(sdk, document) }
}
const read = { text: '', calls: [{ id: 'find', name: 'cad_find_text',
  arguments: { expectedRevision: 1, search: 'ZK01', match: 'exact' } }] }
const prose = { text: 'The proposal is ready for approval.', calls: [] }
const propose = { text: '', calls: [{ id: 'edit', name: 'cad_propose_text_edit', arguments: {
  expectedRevision: 1, units: 'millimeter', changes: [{ id: 'label', expectedText: 'ZK01', text: 'ZK01-A' }],
} }] }
const toolNames = ['cad_find_text', 'cad_query_drawing', 'cad_propose_text_edit']

test('one host protocol correction obtains a real, unapplied proposal without widening tools', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  let turns = 0
  const result = await runKJAgentTask({ session, expectProposal: true, toolNames,
    prompt: 'Change only the ZK01 label to ZK01-A.', model: { createConversation: options => {
      assert.deepEqual(options.tools.map(tool => tool.name).sort(), [...toolNames].sort())
      return { next: async input => {
        turns++
        if (turns === 1) return read
        if (turns === 2) { assert.equal(input.results[0].result.ok, true); return prose }
        assert.equal(input.kind, 'prompt')
        assert.match(input.text, /no reviewable proposal exists/)
        return propose
      } }
    } },
  })
  assert.equal(result.status, 'awaiting-approval')
  assert.equal(result.turns, 3)
  assert.equal(result.repairAttempts, 1)
  assert.equal(result.proposalRepairAttempts, 1)
  assert.equal(result.failedToolCalls, 0)
  assert.equal(result.proposalIds.length, 1)
  assert.equal(document.serialize(), before)
  assert.equal((await session.approve(result.proposalIds[0], 'reviewer')).ok, true)
  assert.equal(document.getObject('label').payload.text, 'ZK01-A')
  await document.undo()
  assert.equal(document.getObject('label').payload.text, 'ZK01')
})

test('repeated prose stops after one correction and cannot become a proposal', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  let turns = 0
  const result = await runKJAgentTask({ session, expectProposal: true, prompt: 'Change the label.',
    model: { createConversation: () => ({ next: async () => ++turns === 1 ? read : prose }) },
  })
  assert.equal(turns, 3)
  assert.equal(result.status, 'responded')
  assert.equal(result.proposalRepairAttempts, 1)
  assert.deepEqual(result.proposalIds, [])
  assert.equal(document.serialize(), before)
})

test('read-only default and initial clarification do not send a correction', async () => {
  for (const expectProposal of [undefined, false, true]) {
    const { session } = await fixture()
    let turns = 0
    const result = await runKJAgentTask({ session, expectProposal, prompt: 'Clarify the request.',
      model: { createConversation: () => ({ next: async () => {
        turns++
        return expectProposal === true || turns > 1 ? prose : read
      } }) },
    })
    assert.equal(turns, expectProposal === true ? 1 : 2)
    assert.equal(result.proposalRepairAttempts, expectProposal === true ? 0 : undefined)
    assert.deepEqual(result.proposalIds, [])
  }
})

test('proposal correction respects repair, turn and tool-call budgets', async () => {
  for (const limits of [{ maxRepairAttempts: 0 }, { maxTurns: 2 }, { maxToolCalls: 1 }]) {
    const { session, document } = await fixture(), before = document.serialize()
    let turns = 0
    const result = await runKJAgentTask({ session, expectProposal: true, ...limits, prompt: 'Edit.',
      model: { createConversation: () => ({ next: async () => ++turns === 1 ? read : prose }) },
    })
    assert.equal(turns, 2)
    assert.equal(result.proposalRepairAttempts, 0)
    assert.deepEqual(result.proposalIds, [])
    assert.equal(document.serialize(), before)
  }
})

test('failed reads do not trigger a missing-proposal correction', async () => {
  const { session } = await fixture()
  let turns = 0
  const result = await runKJAgentTask({ session, expectProposal: true, prompt: 'Edit.',
    model: { createConversation: () => ({ next: async () => ++turns === 1
      ? { ...read, calls: [{ ...read.calls[0], arguments: { ...read.calls[0].arguments, expectedRevision: 0 } }] }
      : prose }) },
  })
  assert.equal(turns, 2)
  assert.equal(result.failedToolCalls, 1)
  assert.equal(result.proposalRepairAttempts, 0)
})

test('cancellation during correction never dispatches the returned proposal', async () => {
  const { session, document } = await fixture(), before = document.serialize()
  const controller = new AbortController()
  let turns = 0
  const result = await runKJAgentTask({ session, expectProposal: true, signal: controller.signal, prompt: 'Edit.',
    model: { createConversation: () => ({ next: async () => {
      turns++
      if (turns === 1) return read
      if (turns === 2) return prose
      controller.abort()
      return propose
    } }) },
  })
  assert.equal(result.status, 'cancelled')
  assert.equal(result.proposalRepairAttempts, 1)
  assert.equal(result.toolCalls, 1)
  assert.deepEqual(result.proposalIds, [])
  assert.equal(document.serialize(), before)
})

test('invalid proposal expectation is rejected before opening a model conversation', async () => {
  const { session } = await fixture()
  for (const expectProposal of [null, 'true', 1, {}]) {
    await assert.rejects(runKJAgentTask({ session, expectProposal, prompt: 'Edit.',
      model: { createConversation: () => assert.fail('must not contact model') },
    }), /expectProposal must be a boolean/)
  }
})
