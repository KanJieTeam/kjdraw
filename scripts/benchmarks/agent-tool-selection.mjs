// Offline wire-byte comparison. No model quality, inference speed or token claims.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../packages/kjdraw-sdk/src/agent-tools.js'
import { runKJAgentTask } from '../../packages/kjdraw-sdk/src/agent-runner.js'
import { createKJModelAdapter } from '../../packages/kjdraw-sdk/src/model-adapters.js'

const bytes = value => Buffer.byteLength(JSON.stringify(value))
const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']

/** Read actual adapter wire slots; remove only tools and their instruction slot. */
export function measureToolSelectionRequest(protocol, body) {
  assert.ok(protocols.includes(protocol), 'Unknown benchmark protocol')
  const wireBody = structuredClone(body), remainingBody = structuredClone(body)
  assert.ok(Array.isArray(wireBody.tools), 'Actual wire tools must be present')
  delete remainingBody.tools
  let instructions, instructionsField
  if (protocol === 'responses') {
    instructionsField = 'instructions'; instructions = wireBody.instructions
    assert.equal(typeof instructions, 'string'); delete remainingBody.instructions
  } else if (protocol === 'chat-completions') {
    instructionsField = 'messages[role=system]'
    assert.ok(Array.isArray(wireBody.messages))
    instructions = wireBody.messages.filter(message => message.role === 'system')
    assert.equal(instructions.length, 1)
    assert.equal(typeof instructions[0].content, 'string')
    remainingBody.messages = remainingBody.messages.filter(message => message.role !== 'system')
  } else if (protocol === 'anthropic-messages') {
    instructionsField = 'system'; instructions = wireBody.system
    assert.equal(typeof instructions, 'string'); delete remainingBody.system
  } else {
    instructionsField = 'systemInstruction'; instructions = wireBody.systemInstruction
    assert.ok(Array.isArray(instructions?.parts)); assert.equal(instructions.parts.length, 1)
    assert.equal(typeof instructions.parts[0].text, 'string'); delete remainingBody.systemInstruction
  }
  const schemaBytes = bytes(wireBody.tools), instructionsBytes = bytes(instructions), remainingRequestBytes = bytes(remainingBody), totalRequestBytes = bytes(wireBody)
  return { schemaBytes, instructionsBytes, remainingRequestBytes, totalRequestBytes,
    serializationOverheadBytes: totalRequestBytes - schemaBytes - instructionsBytes - remainingRequestBytes,
    instructionsField, wireSha256: createHash('sha256').update(JSON.stringify(wireBody)).digest('hex'),
    // Keep exact offline request evidence for assertions/callers, without
    // flooding the CLI byte report with repeated complete tool definitions.
    wireBody, instructions, remainingBody }
}

export async function runOfflineToolSelectionBenchmark() {
const rows = []
// Open the exact same native baseline independently for every arm. Creating
// separate empty documents would give their read receipts different random
// layer/space IDs despite equal byte lengths; never normalize actual wire data.
const seedSdk = createKJDrawSDK(), seed = seedSdk.createDocument({ documentId: 'public-byte-comparison', units: 'millimeter' })
const fixture = seed.serialize()
seedSdk.closeDocument(seed.id)
for (const protocol of protocols) for (const selected of [false, true]) {
  const sdk = createKJDrawSDK(), doc = sdk.openDocument(fixture)
  assert.equal(doc.serialize(), fixture, 'Every arm must start from the identical complete native snapshot')
  const session = new KJAgentToolSession(sdk, doc), requests = []
  let step = 0
  const model = createKJModelAdapter({ protocol, model: 'offline-byte-fixture', request: async ({ body }) => {
    requests.push(measureToolSelectionRequest(protocol, body))
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
  const reopenedSdk = createKJDrawSDK(), reopened = await reopenedSdk.readDocument(await sdk.writeDocument(doc, { format: 'DXF' }), { format: 'DXF' })
  assert.deepEqual(reopened.listEntities()[0].payload.center, [20, 25, 0]); assert.equal(reopened.listEntities()[0].payload.radius, 3)
  await sdk.executeCommand('UNDO'); assert.equal(doc.listEntities().length, 0)
  await sdk.executeCommand('REDO'); assert.equal(doc.listEntities()[0].payload.radius, 3)
  rows.push({ protocol, selected, requests, toolResultBytes: run.outputs.map(output => bytes(output.result)), geometryPassed: true })
  for (const id of [...reopenedSdk.documents.keys()]) reopenedSdk.closeDocument(id)
  for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id)
}
for (const protocol of protocols) {
  const [full, selected] = rows.filter(row => row.protocol === protocol)
  assert.ok(selected.requests[0].schemaBytes < full.requests[0].schemaBytes)
  assert.equal(selected.requests.length, full.requests.length)
  assert.deepEqual(selected.requests.map(request => request.remainingBody), full.requests.map(request => request.remainingBody), 'Except tools and corresponding instructions, actual request contents must be exactly equal')
  assert.deepEqual(selected.requests.map(request => request.remainingRequestBytes), full.requests.map(request => request.remainingRequestBytes))
  assert.deepEqual(selected.toolResultBytes, full.toolResultBytes)
}
return { scope: 'Offline synthetic protocol byte measurement; UTF-8 JSON bytes, not model tokens or real-model success. Schema/instructions are separately encoded actual wire values; remainingRequestBytes excludes only those actual slots, and serializationOverheadBytes accounts for their JSON envelopes. totalRequestBytes measures the original complete wire body, not a rewritten request. Exact wire bodies are retained in the benchmark return value and compared after removing only tools/corresponding instructions. Includes read, unit-error correction, proposal, host approval, DXF reopen, undo and redo. No HTTP requests.', rows }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runOfflineToolSelectionBenchmark()
  console.log(JSON.stringify({ ...report, rows: report.rows.map(row => ({ ...row, requests: row.requests.map(({ wireBody, instructions, remainingBody, ...measurement }) => measurement) })) }, null, 2))
}
