import test from 'node:test'
import assert from 'node:assert/strict'
import { measureToolSelectionRequest, runOfflineToolSelectionBenchmark } from '../scripts/benchmarks/agent-tool-selection.mjs'

const bytes = value => Buffer.byteLength(JSON.stringify(value))
for (const [protocol, body, field] of [
  ['responses', { model: 'offline', instructions: 'Full instructions 模拟', input: [{ role: 'user', content: 'keep system text' }], tools: [{ name: 'read' }] }, 'instructions'],
  ['chat-completions', { model: 'offline', messages: [{ role: 'system', content: 'Full instructions 模拟' }, { role: 'user', content: 'keep system text' }], tools: [{ type: 'function' }] }, 'messages[role=system]'],
  ['anthropic-messages', { model: 'offline', system: 'Full instructions 模拟', messages: [{ role: 'user', content: 'keep system text' }], tools: [{ name: 'read' }] }, 'system'],
  ['gemini-generate-content', { systemInstruction: { parts: [{ text: 'Full instructions 模拟' }] }, contents: [{ role: 'user', parts: [{ text: 'keep system text' }] }], tools: [{ functionDeclarations: [{ name: 'read' }] }] }, 'systemInstruction'],
]) test(`${protocol} measures its actual instruction field without rewriting other wire content`, () => {
  const before = structuredClone(body), measured = measureToolSelectionRequest(protocol, body)
  assert.deepEqual(body, before); assert.deepEqual(measured.wireBody, before)
  assert.equal(measured.instructionsField, field)
  assert.equal(measured.schemaBytes, bytes(body.tools)); assert.equal(measured.instructionsBytes, bytes(measured.instructions))
  assert.equal(measured.remainingRequestBytes, bytes(measured.remainingBody)); assert.equal(measured.totalRequestBytes, bytes(body))
  assert.equal(measured.schemaBytes + measured.instructionsBytes + measured.remainingRequestBytes + measured.serializationOverheadBytes, measured.totalRequestBytes)
  assert.match(measured.wireSha256, /^[a-f0-9]{64}$/)
  assert.ok(JSON.stringify(measured.remainingBody).includes('keep system text'))
  assert.equal(Object.hasOwn(measured.remainingBody, 'tools'), false)
})

test('the executed four-protocol offline benchmark separates legitimate instruction differences and retains all geometry/approval/history checks', async () => {
  const report = await runOfflineToolSelectionBenchmark()
  assert.match(report.scope, /not model tokens or real-model success/)
  assert.equal(report.rows.length, 8)
  for (const protocol of ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']) {
    const [full, selected] = report.rows.filter(row => row.protocol === protocol)
    assert.equal(full.geometryPassed, true); assert.equal(selected.geometryPassed, true)
    assert.equal(full.requests.length, 3); assert.equal(selected.requests.length, 3)
    assert.deepEqual(full.toolResultBytes, selected.toolResultBytes)
    for (let index = 0; index < 3; index++) {
      const left = full.requests[index], right = selected.requests[index]
      assert.deepEqual(left.remainingBody, right.remainingBody)
      assert.equal(left.remainingRequestBytes, right.remainingRequestBytes)
      assert.ok(left.schemaBytes > right.schemaBytes)
      assert.ok(left.instructionsBytes > right.instructionsBytes)
      assert.equal(left.totalRequestBytes - right.totalRequestBytes,
        left.schemaBytes - right.schemaBytes + left.instructionsBytes - right.instructionsBytes + left.serializationOverheadBytes - right.serializationOverheadBytes)
      assert.equal(left.totalRequestBytes, bytes(left.wireBody)); assert.equal(right.totalRequestBytes, bytes(right.wireBody))
    }
  }
})
