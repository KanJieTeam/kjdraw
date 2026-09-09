// Offline wire-byte comparison. No model quality, inference speed or token claims.
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../packages/kjdraw-sdk/src/agent-tools.js'
import { runKJAgentTask } from '../../packages/kjdraw-sdk/src/agent-runner.js'
import { createKJModelAdapter } from '../../packages/kjdraw-sdk/src/model-adapters.js'

const bytes = value => Buffer.byteLength(JSON.stringify(value))
const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
const rows = []
for (const protocol of protocols) for (const selected of [false, true]) {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument({ documentId: 'public-byte-comparison', units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, doc), requests = []
  let step = 0
  const model = createKJModelAdapter({ protocol, model: 'offline-byte-fixture', request: async ({ body }) => {
    const { tools, ...rest } = body
    requests.push({ schemaBytes: bytes(tools), otherRequestBytes: bytes(rest), totalRequestBytes: bytes(body) })
    const id = `call-${step}`, name = step === 0 ? 'cad_read_drawing' : 'cad_propose_circles'
    const input = step === 0 ? {} : { expectedRevision: 0, units: step === 1 ? 'meter' : 'millimeter', circles: [{ center: { x: 20, y: 25 }, radius: 3 }] }
    step++
    if (protocol === 'responses') return { status: 'completed', output: [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(input) }] }
    if (protocol === 'chat-completions') return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(input) } }] } }] }
    if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] }
    return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { id, name, args: input } }] } }] }
  } })
  const run = await runKJAgentTask({ session, model, prompt: 'Read units and propose a circle at (20,25) mm, radius 3 mm.', ...(selected ? { toolNames: ['cad_read_drawing', 'cad_propose_circles'] } : {}) })
  assert.equal(run.status, 'awaiting-approval'); assert.equal(run.turns, 3)
  assert.equal(run.outputs[0].result.ok, true); assert.equal(run.outputs[1].result.ok, false); assert.equal(run.outputs[2].result.ok, true)
  assert.equal(doc.revision, 0)
  assert.equal((await session.approve(run.proposalIds[0], 'offline-reviewer')).ok, true)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(doc, { format: 'DXF' }), { format: 'DXF' })
  assert.deepEqual(reopened.listEntities()[0].payload.center, [20, 25, 0]); assert.equal(reopened.listEntities()[0].payload.radius, 3)
  await sdk.executeCommand('UNDO'); assert.equal(doc.listEntities().length, 0)
  await sdk.executeCommand('REDO'); assert.equal(doc.listEntities()[0].payload.radius, 3)
  rows.push({ protocol, selected, requests, toolResultBytes: run.outputs.map(output => bytes(output.result)), geometryPassed: true })
}
for (const protocol of protocols) {
  const [full, selected] = rows.filter(row => row.protocol === protocol)
  assert.ok(selected.requests[0].schemaBytes < full.requests[0].schemaBytes)
  assert.equal(selected.requests.length, full.requests.length)
  assert.deepEqual(selected.requests.map(request => request.otherRequestBytes), full.requests.map(request => request.otherRequestBytes))
  assert.deepEqual(selected.toolResultBytes, full.toolResultBytes)
}
console.log(JSON.stringify({ scope: 'Offline synthetic protocol byte measurement; UTF-8 JSON bytes, not model tokens or real-model success. Includes read, unit-error correction, proposal, host approval, DXF reopen, undo and redo. No HTTP requests.', rows }, null, 2))
