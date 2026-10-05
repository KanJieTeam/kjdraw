import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { getKJDrawChatToolNamesForRequest } from '../apps/playground/agent-chat.js'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Public read-only fixture', tx => tx.createEntity('MTEXT', {
    text: '{\\fArial|b0;Public literal text\\PSecond line}', position: [0, 0, 0], height: 2, width: 60,
  }))
  return { sdk, document }
}

test('explicit read-only tool routing retains every available read and removes all proposal schemas', async () => {
  const { sdk, document } = await fixture()
  const session = new KJAgentToolSession(sdk, document)
  for (const prompt of ['只读查看完整 MTEXT，不修改图纸。', 'Read-only: inspect all layers and objects.']) {
    const names = getKJDrawChatToolNamesForRequest(document, prompt)
    assert.ok(Object.isFrozen(names))
    for (const name of names) assert.equal(session.definitions.find(tool => tool.name === name).effect, 'read')
    for (const name of ['cad_query_drawing', 'cad_read_page', 'cad_find_text', 'cad_read_history', 'cad_read_geology_source', 'cad_read_hatch_patterns']) assert.ok(names.includes(name))
    assert.ok(names.length > 0 && names.length < 20)
  }
  // The requested edit is actionable; preservation of another field is not
  // permission to silently omit the edit schema.
  assert.ok(getKJDrawChatToolNamesForRequest(document, '把标签改为 B，不修改其余文字。').includes('cad_propose_text_edit'))
})

test('read-only AI runtime does not reintroduce undo/redo and rejects a model mutation before dispatch', async () => {
  const { sdk, document } = await fixture()
  const before = document.serialize()
  let requested = false
  const chat = createAiChatRuntime({ endpoint: 'https://fixture.invalid/v1/chat/completions', model: 'fixture-only',
    fetchImpl: async (_url, init) => {
      requested = true
      const body = JSON.parse(init.body)
      assert.ok(body.tools.every(tool => !tool.function.name.startsWith('cad_propose_')))
      return Response.json({ model: 'fixture-only', choices: [{ message: { role: 'assistant', content: '',
        tool_calls: [{ id: 'forbidden', type: 'function', function: { name: 'cad_propose_undo', arguments: JSON.stringify({ expectedRevision: document.revision }) } }],
      }, finish_reason: 'tool_calls' }] })
    } })
  try {
    const content = await sdk.writeDocument(document, { format: 'DXF' })
    await chat.importDocument(new File([content], 'public-read-only.dxf'))
    const state = await chat.exportLocalState()
    const result = await chat.send('只读检查全部文字，不修改图纸。')
    assert.equal(requested, true)
    assert.equal(result.status, 'error')
    assert.equal(result.error.code, 'KJAGENT_TOOL_NOT_ALLOWED')
    assert.equal((await chat.exportLocalState()).drawing, state.drawing)
    assert.equal(document.serialize(), before)
  } finally { chat.destroy() }
})
