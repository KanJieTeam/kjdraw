import assert from 'node:assert/strict'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createBoundaryEditSession } from '@kanjieteam/kjdraw/boundary-edit'

// Executed inside an isolated installation of the real package, without aliases.
const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
const create = (type, payload) => sdk.executeCommand('CREATE', { type, payload }, { document })
const boundary = await create('LINE', { start: [-15, 0, 0], end: [15, 0, 0] })
const targets = [await create('CIRCLE', { center: [-4, 0, 0], radius: 3 }), await create('CIRCLE', { center: [4, 0, 0], radius: 3 })]
const session = createBoundaryEditSession('trim', { document, boundaryIds: [boundary.id] })
session.confirmBoundaries()
const initialRevision = document.revision
const preview = session.preview(targets[0].id, [-4, 3])
assert.equal(document.revision, initialRevision)
assert.equal(preview.pieces[0].type, 'ARC')
assert.equal(Object.isFrozen(preview.pieces[0].payload), true)
const plan = sdk.createCommandEnvelope(preview.command.command, preview.command.arguments, {
  document, mode: 'plan', origin: 'ai', expectedRevision: preview.revision,
})
assert.equal((await sdk.executeCommandEnvelope(plan, { document })).status, 'planned')
assert.equal(document.revision, initialRevision)
const confirmation = { status: 'confirmed', planId: plan.id, confirmedBy: 'consumer-test-reviewer' }
await assert.rejects(sdk.executeCommandEnvelope(sdk.createCommandEnvelope(plan.command, {
  ...plan.arguments, id: targets[1].id,
}, { document, origin: 'ai', expectedRevision: preview.revision, confirmation }), { document }), /do not match/)
const receipt = await session.apply(preview, request => sdk.executeCommandEnvelope(sdk.createCommandEnvelope(request.command, request.arguments, {
  document, expectedRevision: request.expectedRevision, origin: 'ai', confirmation,
}), { document }))
assert.equal(receipt.status, 'committed')
assert.equal(sdk.agentPlans.get(plan.id).status, 'consumed')
await assert.rejects(session.apply(preview, async () => { throw new Error('must not dispatch') }), /stale|consumed/)
await session.apply(session.preview(targets[1].id, [4, 3]), request => sdk.executeCommandEnvelope(sdk.createCommandEnvelope(request.command, request.arguments, {
  document, expectedRevision: request.expectedRevision, origin: 'ui',
}), { document }))
assert.equal(session.state.committedCount, 2)
assert.equal(document.revision, initialRevision + 2)
session.finish()
await sdk.executeCommand('UNDO')
assert.deepEqual(document.getObject(targets[1].id), targets[1])
await sdk.executeCommand('UNDO')
assert.deepEqual(document.getObject(targets[0].id), targets[0])
console.log(JSON.stringify({ boundarySession: true, preview: true, reviewedAgentEdit: true, continuousUiEdit: true, separateUndo: true }))
