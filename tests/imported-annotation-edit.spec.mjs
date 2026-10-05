import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/index.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { publicAnnotationSheet } from './helpers/public-annotation-sheet.mjs'
import { runImportedDrawingEditJourney } from './helpers/imported-drawing-edit-journey.mjs'

test('public imported sheet survives ten cumulative edits, manual edits, undo/redo and both reopen formats', async () => {
  const { dxf } = await publicAnnotationSheet()
  const result = await runImportedDrawingEditJourney(new TextEncoder().encode(dxf))
  assert.equal(result.rounds.length, 10)
  assert.ok(result.rounds.every(round => round.passed && round.untouchedEntities === 78))
  assert.equal(result.naturalLanguageModelCalls, 0)
})

test('chat transport can find a late imported label then edit only that ID over ten requests', async () => {
  // The transport below is a deterministic protocol fixture, not a live model result.
  const { dxf } = await publicAnnotationSheet()
  const sdk = createKJDrawSDK()
  const source = await sdk.readDocument(dxf, { format: 'DXF' })
  const original = source.listEntities().find(entity => entity.payload.text === 'ZK03')
  let round = 0
  let revision = source.revision
  let currentText = 'ZK03'
  let phase = 0
  const calls = []
  const configuration = { endpoint: 'https://model.fixture.invalid/v1/chat/completions', model: 'fixture',
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      assert.ok(body.tools.some(tool => tool.function.name === 'cad_find_text'))
      let name, args
      if (phase === 0) {
        assert.match(body.messages.at(-1).content, /use cad_find_text/)
        name = 'cad_find_text'
        args = { expectedRevision: revision, search: currentText, match: 'exact' }
      } else {
        const found = JSON.parse(body.messages.at(-1).content)
        assert.equal(found.ok, true)
        assert.equal(found.value.totalMatches, 1)
        assert.equal(found.value.matches[0].handle, original.handle)
        assert.equal(found.value.matches[0].text, currentText)
        name = 'cad_propose_text_edit'
        args = { expectedRevision: revision, units: 'millimeter', changes: [{
          id: found.value.matches[0].id, expectedText: currentText, text: 'ZK03-' + (round + 1),
        }] }
      }
      phase++
      calls.push(name)
      return Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
        id: 'fixture-' + calls.length, type: 'function', function: { name, arguments: JSON.stringify(args) },
      }] }, finish_reason: 'tool_calls' }] })
    },
  }
  let chat = createAiChatRuntime(configuration)
  try {
    await chat.importDocument(new File([dxf], 'public-sheet.dxf'))
    const imported = await sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    const baseline = imported.listEntities()
    const targetId = baseline.find(entity => entity.handle === original.handle).id
    for (; round < 10; round++) {
      phase = 0
      const before = (await chat.exportLocalState()).drawing
      const proposal = await chat.send(`把孔号标注“${currentText}”改成“ZK03-${round + 1}”，只修改标注文字。`)
      assert.equal(proposal.status, 'proposal', JSON.stringify(proposal.error))
      assert.equal((await chat.exportLocalState()).drawing, before, 'A model request must not apply its own proposal')
      assert.deepEqual(proposal.proposal.preview.before.map(entity => entity.id), [targetId])
      assert.equal((await chat.approve(proposal.proposal.planId)).status, 'applied')
      revision = chat.revision
      currentText = 'ZK03-' + (round + 1)
      const current = await sdk.readDocument(await chat.exportDocument('KJD'), { format: 'KJD' })
      const expected = structuredClone(baseline.find(entity => entity.id === targetId))
      expected.payload.text = currentText
      assert.equal(canonicalStringify(current.getObject(targetId)), canonicalStringify(expected))
      for (const entity of baseline.filter(entity => entity.id !== targetId)) {
        assert.equal(canonicalStringify(current.getObject(entity.id)), canonicalStringify(entity), 'Unrequested object changed')
      }
      if (round === 4) {
        const state = await chat.exportLocalState()
        chat.destroy()
        chat = createAiChatRuntime(configuration)
        await chat.restoreLocalState(state)
        revision = chat.revision
      }
    }
    assert.deepEqual(calls, Array.from({ length: 10 }, () => ['cad_find_text', 'cad_propose_text_edit']).flat())
    const reopened = await sdk.readDocument(await chat.exportDocument('DXF'), { format: 'DXF' })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().find(entity => entity.handle === original.handle).payload.text, currentText)
  } finally { chat.destroy() }
})
