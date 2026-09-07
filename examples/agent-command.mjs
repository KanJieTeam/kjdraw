import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/index.js'

const sdk = createKJDrawSDK()
const document = sdk.createDocument({ documentId: 'agent-example' })
const args = { type: 'LINE', payload: { start: [0, 0, 0], end: [100, 0, 0] } }
const plan = sdk.createCommandEnvelope('CREATE', args, {
  mode: 'plan', origin: 'ai', expectedRevision: document.revision,
})
const preview = await sdk.executeCommandEnvelope(plan)
console.log('Plan (does not mutate):', preview)
console.log('Review binding:', preview.result.binding, 'expires:', preview.result.expiresAt)
// In a real host, show the plan and collect user confirmation before this step.
// This deterministic example simulates that host interaction; no model is called.
const confirmed = sdk.createCommandEnvelope(plan.command, plan.arguments, {
  origin: 'ai', expectedRevision: plan.expectedRevision,
  confirmation: { status: 'confirmed', planId: plan.id, confirmedBy: 'example-user' },
})
console.log('Receipt:', await sdk.executeCommandEnvelope(confirmed))
console.log('Document revision:', document.revision)
await sdk.executeCommand('UNDO')
console.log('Entities after undo:', document.listEntities().length)
