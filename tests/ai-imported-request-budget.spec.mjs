import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime, aiDrawingRequestLimits } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

test('imported native paging has a deterministic 8–32 turn cap, without wider call or JSON budgets', () => {
  for (const [count, turns] of [[0, 8], [200, 8], [201, 9], [542, 15], [1400, 32], [250000, 32]]) {
    assert.deepEqual(aiDrawingRequestLimits(count, true), { maxTurns: turns, maxToolCalls: 32 })
    assert.deepEqual(aiDrawingRequestLimits(count, false), { maxTurns: 8, maxToolCalls: 32 })
    assert.equal(Object.isFrozen(aiDrawingRequestLimits(count, true)), true)
  }
  for (const count of [-1, 1.5, NaN, Infinity, '542', null]) assert.throws(() => aiDrawingRequestLimits(count, true))
  assert.throws(() => aiDrawingRequestLimits(542, 'yes'))
})

test('a 542-object imported drawing can finish eleven actual 50-row native pages and a final answer', async t => {
  // Transparent scripted model-protocol fixture; never actual-model acceptance.
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', { entities: Array.from({ length: 542 }, (_, index) => ({
    type: 'LINE', options: { id: 'PUBLIC-BUDGET-LINE-' + index }, payload: { start: [index, 0, 0], end: [index, 1, 0] },
  })) }, { document })
  const input = await sdk.writeDocument(document, { format: 'DXF' }), seen = [], pages = []
  let requests = 0
  const runtime = createAiChatRuntime({ endpoint: 'https://public-budget.invalid/v1/chat/completions', model: 'offline-fixture',
    captureToolOutputs: true, fetchImpl: async (_url, init) => {
      requests++
      const body = JSON.parse(init.body), last = body.messages.at(-1)
      assert.equal(body.max_tokens, 8192)
      assert.ok(Buffer.byteLength(init.body) <= 2097152)
      let name = 'cad_read_drawing', args = {}
      if (last.role === 'tool') {
        const receipt = JSON.parse(last.content)
        assert.equal(receipt.ok, true)
        const value = receipt.value
        seen.push(...value.entities.map(row => row.id)); pages.push(value.entities.length)
        if (value.nextOffset === null && value.nextLayerOffset === null) return Response.json({ choices: [{ finish_reason: 'stop',
          message: { role: 'assistant', content: 'Complete read-only native inventory; no drawing has been modified.' } }] })
        name = 'cad_read_page'; args = { expectedRevision: value.revision,
          offset: value.nextOffset ?? 542, layerOffset: value.nextLayerOffset ?? 0 }
      }
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{
        id: 'public-budget-call-' + requests, type: 'function', function: { name, arguments: JSON.stringify(args) },
      }] } }] })
    } })
  t.after(() => { runtime.destroy(); for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) })
  await runtime.importDocument(new File([input], 'public-native-542.dxf'))
  const baseline = await runtime.exportDocument('KJD'), revision = runtime.revision
  const result = await runtime.send('Read the entire drawing inventory, do not edit the drawing.')
  assert.equal(result.status, 'message', JSON.stringify(result.error))
  assert.equal(requests, 12)
  assert.equal(result.toolOutputs.length, 11)
  assert.deepEqual(pages, [...Array(10).fill(50), 42])
  assert.equal(seen.length, 542); assert.equal(new Set(seen).size, 542)
  assert.equal(runtime.revision, revision)
  assert.equal(await runtime.exportDocument('KJD'), baseline)
})
