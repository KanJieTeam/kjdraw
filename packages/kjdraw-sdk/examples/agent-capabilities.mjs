import assert from 'node:assert/strict'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { KJAgentCapabilityRegistry } from '@kanjieteam/kjdraw/agent-capabilities'
import { KJAgentToolSession } from '@kanjieteam/kjdraw/agent-tools'
import { runKJAgentTask } from '@kanjieteam/kjdraw/agent-runner'

// Offline integration fixture, not a language-model design demonstration or a success-rate benchmark.
const registry = new KJAgentCapabilityRegistry()
registry.register({
  schema: 'com.kanjie.kjdraw.agent-capability', schemaVersion: 1,
  id: 'example.inspection-guide', name: 'Inspection guide', version: '1.0.0', toolApiVersion: 1,
  instructions: 'Read units first. Ask for missing dimensions. Propose only the requested guide geometry.',
  requiredToolNames: ['cad_read_drawing', 'cad_propose_lines'],
  requirements: [{ id: 'guide-length', description: 'The guide must have the requested length.', check: { toolName: 'cad_read_drawing', assertion: 'After a host applies the proposal, inspect the resulting endpoints and independently check the requested length.' } }],
})
const lock = registry.createLock([{ id: 'example.inspection-guide', version: '1.0.0' }])
const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter', metadata: { agentCapabilityLock: lock } })
const session = new KJAgentToolSession(sdk, drawing)
const selected = registry.resolve({ lock, allowedToolNames: session.definitions.map(tool => tool.name) })
assert.deepEqual(selected.toolNames, ['cad_read_drawing', 'cad_propose_lines'])

let step = 0
const model = { createConversation({ instructions, tools }) {
  assert.match(instructions, /example.inspection-guide@1.0.0/)
  assert.deepEqual(tools.map(tool => tool.name), selected.toolNames)
  return { next: async () => step++ === 0
    ? { text: '', calls: [{ id: 'read', name: 'cad_read_drawing', arguments: {} }] }
    : { text: 'The fixture proposes a 30 mm guide for host review.', calls: [{ id: 'guide', name: 'cad_propose_lines', arguments: { expectedRevision: drawing.revision, units: 'millimeter', lines: [{ start: { x: 0, y: 0 }, end: { x: 30, y: 0 } }] } }] },
  }
} }
const result = await runKJAgentTask({ session, model, prompt: 'Propose a horizontal guide from (0, 0) to (30, 0) mm.', capabilities: { registry, lock } })
assert.equal(result.status, 'awaiting-approval')
assert.equal(drawing.listEntities().length, 0)
assert.equal(drawing.revision, 0)
const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format: 'KJD' }), { format: 'KJD' })
assert.deepEqual(reopened.snapshot().metadata.custom.agentCapabilityLock, lock)
// The real host shows result.outputs' preview, then approves or rejects after authenticated review.
// This fixture deliberately leaves the proposal pending and does not certify requirements.
console.log(JSON.stringify({ mode: 'offline-capability-integration-fixture', status: result.status, applied: false, requirementValidation: 'not-performed', lockedVersions: selected.lock.map(({ id, version }) => ({ id, version })), tools: selected.toolNames, projectLockReopened: true }, null, 2))
