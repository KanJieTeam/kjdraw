import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { runKJAgentTask } from '../src/agent-runner.js'

// Instruction-boundary fixtures, not actual-model drawing acceptance.
for (const profile of ['full', 'geology-scalars-v1']) {
  test(`${profile}: illustrative design permission never grants measured facts, calls or approval`, async () => {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    const session = new KJAgentToolSession(sdk, document, { toolProfile: profile })
    const before = document.serialize(), seen = []
    try {
      const result = await runKJAgentTask({ session, prompt: 'Discuss a synthetic example without applying any changes.',
        model: { createConversation(options) {
          seen.push(options)
          return { async next(input) {
            assert.equal(input.kind, 'prompt')
            return { calls: [], text: 'Illustrative only; no drawing has been modified.' }
          } }
        } } })
      assert.equal(result.status, 'responded')
      assert.equal(result.toolCalls, 0)
      assert.deepEqual(result.proposalIds, [])
      assert.equal(document.serialize(), before)
      assert.equal(seen.length, 1)
      const instructions = seen[0].instructions
      assert.doesNotMatch(instructions, /never infer omitted geometry/)
      assert.match(instructions, /Existing native geometry and measured source facts must come from actual reads, not guesses/)
      if (profile === 'full') {
        assert.match(instructions, /user explicitly requests a synthetic example or simulation/)
        assert.match(instructions, /clearly describe them as simulated rather than measured/)
        assert.match(instructions, /not to infer actual borehole facts/)
        assert.match(instructions, /overwrite unrelated existing measurements or bypass host review/)
        assert.match(instructions, /requires facts about the real site, still ask/)
        assert.match(instructions, /unspecified depths, layer counts, interval boundaries and illustrative connections are design choices/)
        assert.match(instructions, /without requiring an extra permission to choose those values/)
        assert.match(instructions, /do not guess existing geometry/)
      } else assert.doesNotMatch(instructions, /you may choose illustrative design coordinates/)
    } finally { sdk.closeDocument(document.id) }
  })
}

test('a restricted full session without the atomic structural tool retains its existing instruction boundary', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  try {
    await runKJAgentTask({ session, toolNames: ['cad_read_drawing'], prompt: 'Read the drawing only.',
      model: { createConversation({ instructions, tools }) {
        assert.doesNotMatch(instructions, /you may choose illustrative design coordinates/)
        assert.deepEqual(tools.map(tool => tool.name), ['cad_read_drawing'])
        return { async next() { return { calls: [], text: 'No change.' } } }
      } } })
    assert.equal(document.revision, 0)
    assert.equal(document.history.undoCount, 0)
  } finally { sdk.closeDocument(document.id) }
})
