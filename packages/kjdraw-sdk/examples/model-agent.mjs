import assert from 'node:assert/strict'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { KJAgentToolSession } from '@kanjieteam/kjdraw/agent-tools'
import { createKJModelAdapter } from '@kanjieteam/kjdraw/model-adapters'
import { runKJAgentTask } from '@kanjieteam/kjdraw/agent-runner'

const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
const prompt = 'Read the drawing, then propose a circle centered at (20, 25) millimeters with a radius of 3 millimeters. Do not apply it.'
const circle = { expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 20, y: 25 }, radius: 3 }] }

// Deliberately synthetic protocol fixtures; these do not measure model quality.
function fixtureResponse(protocol, step) {
  const name = step === 0 ? 'cad_read_drawing' : 'cad_propose_circles'
  const args = step === 0 ? {} : circle
  const id = `example-${step}`
  if (protocol === 'responses') return { status: 'completed', output: [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }] }
  if (protocol === 'chat-completions') return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }
  if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input: args }] }
  return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { id, name, args } }] } }] }
}

async function run(protocol, modelName, request, live = false) {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, drawing)
  const model = createKJModelAdapter({ protocol, model: modelName, request })
  const result = await runKJAgentTask({ session, model, prompt, toolNames: ['cad_read_drawing', 'cad_propose_circles'], maxTurns: 4, maxToolCalls: 8, timeoutMs: 60000 })
  if (live) {
    // No automatic approval in the live path. Use a host review UI to approve/reject.
    console.log(JSON.stringify({ mode: 'live-proposal-only', protocol, model: modelName, result }, null, 2))
    if (result.status !== 'awaiting-approval') process.exitCode = 1
    return
  }
  assert.equal(result.status, 'awaiting-approval', JSON.stringify(result))
  assert.equal(drawing.revision, 0)
  assert.equal((await session.approve(result.proposalIds[0], 'fixture-only-reviewer')).ok, true)
  assert.equal(drawing.listEntities()[0].payload.radius, 3)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(reopened.listEntities()[0].payload.center, [20, 25, 0])
  await sdk.executeCommand('UNDO')
  assert.equal(drawing.listEntities().length, 0)
}

if (process.argv.includes('--live')) {
  // Server/CLI only: never put a provider key in browser bundles or drawing files.
  const protocol = process.env.KJDRAW_MODEL_PROTOCOL
  const model = process.env.KJDRAW_MODEL_NAME
  const endpoint = process.env.KJDRAW_MODEL_ENDPOINT
  const key = process.env.KJDRAW_MODEL_API_KEY
  if (!protocols.includes(protocol) || !model || !endpoint) throw new Error('Set KJDRAW_MODEL_PROTOCOL, KJDRAW_MODEL_NAME and KJDRAW_MODEL_ENDPOINT before --live')
  const url = new URL(endpoint)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new Error('Use a trusted HTTPS endpoint, or explicit HTTP loopback; no URL credentials, query or fragment')
  if (!loopback && !key) throw new Error('Set KJDRAW_MODEL_API_KEY on the server for the selected endpoint')
  const headers = { 'Content-Type': 'application/json' }
  if (protocol === 'anthropic-messages') { headers['anthropic-version'] = '2023-06-01'; if (key) headers['x-api-key'] = key }
  else if (protocol === 'gemini-generate-content') { if (key) headers['x-goog-api-key'] = key }
  else if (key) headers.Authorization = `Bearer ${key}`
  await run(protocol, model, async ({ body, signal }) => {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' })
    if (!response.ok) throw new Error(`Model HTTP ${response.status}`)
    // Bound the decoded HTTP response before parsing it. The SDK separately bounds history.
    const reader = response.body.getReader()
    const chunks = []
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 1048576) throw new Error('Model HTTP response exceeds 1 MiB')
        chunks.push(value)
      }
    } finally { await reader.cancel(); reader.releaseLock() }
    const buffer = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder().decode(buffer))
  }, true)
} else {
  for (const protocol of protocols) {
    let step = 0
    await run(protocol, 'offline-fixture-model', async () => fixtureResponse(protocol, step++))
  }
  console.log(JSON.stringify({ modelAdapters: true, protocols: 4, offline: true, approval: true, reopen: true, undo: true }))
}
