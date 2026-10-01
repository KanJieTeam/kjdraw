import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

// Opt-in local interoperability check. The source drawing is never copied into this repository.
test('imported real DXF can be queried, proposed, approved and reopened', {
  skip: !process.env.KJDRAW_REAL_DXF,
}, async () => {
  const bytes = new Uint8Array(await readFile(process.env.KJDRAW_REAL_DXF))
  let phase = 0
  let revision = 0
  let memberIds = []
  const calls = []
  const progressEvents = []
  const runtime = createAiChatRuntime({
    endpoint: 'https://model.fixture.invalid/v1/chat/completions',
    model: 'fixture',
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      let name, args
      if (phase === 0) {
        assert.match(body.messages.at(-1).content, /Current user request: 删除底部两个楼/)
        name = 'cad_query_spatial_candidates'
        args = { expectedRevision: revision, indices: [18, 19] }
      } else if (phase === 1) {
        const result = JSON.parse(body.messages.at(-1).content)
        assert.equal(result.ok, true)
        memberIds = result.value.candidates.flatMap(candidate => candidate.memberIds)
        name = 'cad_query_impact'
        args = { expectedRevision: revision, units: 'unitless', operation: 'erase', ids: memberIds, tolerance: 0.01, maxBytes: 262144 }
      } else {
        const result = JSON.parse(body.messages.at(-1).content)
        assert.equal(result.ok, true)
        assert.equal(result.value.canErase, true)
        name = 'cad_propose_structural_edit'
        args = { expectedRevision: revision, units: 'unitless', eraseIds: memberIds, tolerance: 0.01, maxBytes: 262144 }
      }
      calls.push(name)
      phase++
      return Response.json({ choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{
          id: 'real-dxf-call-' + phase, type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        }] },
        finish_reason: 'tool_calls',
      }] })
    },
  })
  try {
    const imported = await runtime.importDocument(new File([bytes], 'source.dxf'))
    assert.equal(imported.format, 'DXF')
    assert.equal(imported.entityCount, 836)
    revision = imported.revision
    const pending = await runtime.send('删除底部两个楼', { onProgress: progress => progressEvents.push(progress.phase) })
    assert.equal(pending.status, 'proposal', JSON.stringify({ error: pending.error, phase, calls, progressEvents }))
    assert.deepEqual(calls, ['cad_query_spatial_candidates', 'cad_query_impact', 'cad_propose_structural_edit'])
    assert.equal(memberIds.length, 23)
    assert.equal(runtime.entityCount, 836, 'model tools must not mutate before approval')
    const approved = await runtime.approve(pending.proposal.planId)
    assert.equal(approved.status, 'applied')
    assert.equal(runtime.entityCount, 813)
    const dxf = await runtime.exportDocument('DXF')
    const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, 813)
  } finally {
    runtime.destroy()
  }
})
