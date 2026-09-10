import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { KJAgentCapabilityRegistry } from '../src/agent-capabilities.js'
import { runKJAgentTask } from '../src/agent-runner.js'
import { createKjpPackage, openKjpPackage } from '../src/project-package.js'

const names = ['cad_read_drawing', 'cad_measure_distance']
const manifest = (patch = {}) => ({
  schema: 'com.kanjie.kjdraw.agent-capability', schemaVersion: 1,
  id: 'example.clearances', name: 'Clearance inspection', version: '1.0.0', toolApiVersion: 1,
  instructions: 'Read the native drawing units before checking the requested clearance.',
  requiredToolNames: names,
  requirements: [{ id: 'clearance', description: 'Check minimum clearance against the requested value.', check: { toolName: 'cad_measure_distance', assertion: 'Measure the actual relevant drawing points in the same coordinate system, then compare against the requested minimum.' } }],
  ...patch,
})
function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document), registry = new KJAgentCapabilityRegistry()
  registry.register(manifest())
  const lock = registry.createLock([{ id: 'example.clearances', version: '1.0.0' }])
  return { sdk, document, session, registry, lock }
}

test('runner sends the locked domain guidance and tools; only an explicit replacement lock upgrades a run', async () => {
  const { session, registry, lock } = fixture(), received = []
  const model = { createConversation(options) { received.push(options); return { next: async () => ({ text: 'Please provide the minimum clearance.', calls: [] }) } } }
  const run = selection => runKJAgentTask({ session, model, prompt: 'Check clearances.', capabilities: { registry, lock: selection } })
  assert.equal((await run(lock)).status, 'responded')
  registry.register(manifest({ version: '1.1.0', instructions: 'Request the manufacturing clearance and measurement tolerance.' }))
  await run(lock)
  await run(registry.createLock([{ id: 'example.clearances', version: '1.1.0' }]))
  assert.deepEqual(received[0].tools.map(tool => tool.name), names)
  assert.equal(received[0].instructions, received[1].instructions)
  assert.match(received[1].instructions, /native drawing units/)
  assert.doesNotMatch(received[1].instructions, /manufacturing clearance/)
  assert.match(received[2].instructions, /manufacturing clearance/)
  assert.match(received[2].instructions, /Approval belongs to the host/)
  assert.match(received[2].instructions, /do not override the CAD tool schemas/)
})

test('missing host tool grants and unknown capability tools fail before model contact', async () => {
  const { session, registry, lock } = fixture()
  let contacts = 0
  const model = { createConversation() { contacts++; throw new Error('Must not contact model') } }
  await assert.rejects(runKJAgentTask({ session, model, prompt: 'Inspect.', toolNames: ['cad_read_drawing'], capabilities: { registry, lock } }), /outside the host allowlist/)
  registry.register(manifest({ id: 'example.unknown', requiredToolNames: ['cad_unknown_tool'], requirements: [] }))
  await assert.rejects(runKJAgentTask({ session, model, prompt: 'Inspect.', capabilities: { registry, lock: registry.createLock([{ id: 'example.unknown', version: '1.0.0' }]) } }), /outside the host allowlist/)
  assert.equal(contacts, 0)
})

test('a selected-out tool rejects the entire model batch before any read or mutation dispatch', async () => {
  const { session, registry, lock, document } = fixture()
  const before = document.serialize(), dispatched = []
  const original = session.call.bind(session)
  session.call = async (...args) => { dispatched.push(args[0]); return original(...args) }
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [
    { id: 'read', name: 'cad_read_drawing', arguments: {} },
    { id: 'write', name: 'cad_propose_lines', arguments: { expectedRevision: 0, units: 'millimeter', lines: [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }] } },
  ] }) }) }
  const result = await runKJAgentTask({ session, model, prompt: 'Inspect only.', capabilities: { registry, lock } })
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'KJAGENT_TOOL_NOT_ALLOWED')
  assert.deepEqual(dispatched, [])
  assert.deepEqual(result.outputs, [])
  assert.equal(document.serialize(), before)
})

test('a numeric measurement and untrusted model success text do not produce a requirement validation receipt', async () => {
  const { session, registry, lock, document } = fixture()
  const before = document.serialize(), inputs = []
  let step = 0
  const model = { createConversation: ({ instructions }) => {
    assert.match(instructions, /requested checks are not execution receipts/)
    return { next: async input => {
      inputs.push(input)
      if (step++ === 0) return { text: '', calls: [{ id: 'read', name: 'cad_read_drawing', arguments: {} }] }
      if (step === 2) return { text: '', calls: [{ id: 'measure', name: 'cad_measure_distance', arguments: { expectedRevision: 0, units: 'millimeter', start: { x: 0, y: 0 }, end: { x: 3, y: 4 } } }] }
      // An adversarial claim: raw text must never become a structured validation result.
      return { text: 'Every engineering requirement passed.', calls: [] }
    } }
  } }
  const result = await runKJAgentTask({ session, model, prompt: 'Inspect clearances.', capabilities: { registry, lock } })
  assert.equal(result.status, 'responded')
  assert.equal(result.outputs[1].result.value.distance, 5)
  assert.equal(inputs[2].results[0].result.value.distance, 5)
  assert.equal(result.text, 'Every engineering requirement passed.')
  assert.equal('requirementsPassed' in result, false)
  assert.equal('validated' in result.outputs[1].result.value, false)
  assert.deepEqual(result.proposalIds, [])
  assert.equal(document.serialize(), before)
  const selected = registry.resolve({ lock, allowedToolNames: names })
  assert.equal('passed' in selected.requirements[0], false)
})

test('exact capability locks survive real KJD and KJP serialization and can drive a reopened project', async () => {
  const { registry, lock } = fixture(), sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'locked-drawing', units: 'millimeter', metadata: { agentCapabilityLock: lock } })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [30, 40] } })
  const reopenedKjd = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(reopenedKjd.snapshot().metadata.custom.agentCapabilityLock, lock)
  const bytes = await createKjpPackage({ projectId: 'locked-project', title: 'Locked capability project', drawings: { 'locked-drawing': drawing }, activeDrawing: 'locked-drawing', metadata: { agentCapabilityLock: lock } })
  const reopened = await openKjpPackage(bytes)
  assert.deepEqual(reopened.manifest.metadata.agentCapabilityLock, lock)
  assert.deepEqual(reopened.activeDocument.snapshot().metadata.custom.agentCapabilityLock, lock)
  assert.deepEqual(reopened.activeDocument.listEntities()[0].payload.end, [30, 40, 0])
  registry.register(manifest({ version: '1.1.0', instructions: 'Changed domain guidance.' }))
  const reopenedSdk = createKJDrawSDK()
  reopenedSdk.attachDocument(reopened.activeDocument)
  const session = new KJAgentToolSession(reopenedSdk, reopened.activeDocument)
  const result = await runKJAgentTask({ session, prompt: 'Continue checking this drawing.', capabilities: { registry, lock: reopened.manifest.metadata.agentCapabilityLock }, model: { createConversation: ({ instructions }) => {
    assert.match(instructions, /example.clearances@1.0.0/)
    assert.doesNotMatch(instructions, /Changed domain guidance/)
    return { next: async () => ({ text: 'Please confirm the minimum clearance.', calls: [] }) }
  } } })
  assert.equal(result.status, 'responded')
})
