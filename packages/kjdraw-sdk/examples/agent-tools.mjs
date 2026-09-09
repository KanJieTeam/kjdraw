import assert from 'node:assert/strict'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { KJAgentToolSession } from '@kanjieteam/kjdraw/agent-tools'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'agent-tools-example', units: 'millimeter' })
const session = new KJAgentToolSession(sdk, drawing)

// A provider adapter exposes only session.definitions and session.call to a model.
// This deterministic example calls the tools directly; it does not contact AI.
const result = await session.call('cad_propose_circles', {
  expectedRevision: 0,
  units: 'millimeter',
  circles: [{ center: { x: 20, y: 20 }, radius: 3 }],
})
assert.equal(result.ok, true)
assert.equal(drawing.revision, 0)
const proposal = result.value
assert.equal(proposal.status, 'awaiting-host-approval')
assert.equal(proposal.previewKind, 'geometry')
assert.deepEqual(proposal.preview.before, [])
assert.deepEqual(proposal.preview.after[0].payload.center, [20, 20, 0])

// Test-only simulated approval. A real host authenticates the reviewer and
// presents the exact proposed arguments before invoking this host-only method.
const approved = await session.approve(proposal.planId, 'example-reviewer')
assert.equal(approved.ok, true)
assert.equal(drawing.revision, 1)
assert.equal(drawing.listEntities()[0].payload.radius, 3)
assert.equal(drawing.listEntities()[0].id, proposal.preview.after[0].id)
assert.deepEqual(drawing.listEntities()[0].payload, proposal.preview.after[0].payload)
assert.equal((await session.approve(proposal.planId, 'example-reviewer')).ok, false)

const saved = await sdk.writeDocument(drawing, { format: 'KJD' })
const reopenedSdk = createKJDrawSDK()
const reopened = await reopenedSdk.readDocument(saved, { format: 'KJD' })
assert.deepEqual(reopened.listEntities()[0].payload.center, [20, 20, 0])
assert.equal(reopened.listEntities()[0].payload.radius, 3)
await sdk.executeCommand('UNDO')
assert.equal(drawing.listEntities().length, 0)
console.log(JSON.stringify({ agentTools: true, hostApproval: true, duplicateRejected: true, reopen: true, undo: true }))
