import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK } from '../src/index.js'

function plannedCreate(sdk, document, args = { type: 'POINT', payload: { position: [1, 2] } }) {
  return sdk.createCommandEnvelope('CREATE', args, {
    mode: 'plan',
    origin: 'ai',
    expectedRevision: document.revision,
  })
}

function confirm(sdk, plan, argumentsOverride = plan.arguments) {
  return sdk.createCommandEnvelope(plan.command, argumentsOverride, {
    origin: 'ai',
    expectedRevision: plan.expectedRevision,
    confirmation: { status: 'confirmed', planId: plan.id, confirmedBy: 'reviewer-1' },
  })
}

test('reviewed agent plans bind exact arguments and are consumed once', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-bound' })
  const plan = plannedCreate(sdk, document)
  const planned = await sdk.executeCommandEnvelope(plan)
  assert.equal(planned.status, 'planned')
  assert.equal(planned.result.status, 'active')
  assert.equal(planned.result.documentFingerprint, document.fingerprint())

  await assert.rejects(sdk.executeCommandEnvelope(confirm(sdk, plan, { type: 'POINT', payload: { position: [99, 2] } })), error => error instanceof KJValidationError && /do not match/.test(error.message))
  assert.equal(sdk.agentPlans.get(plan.id).status, 'active')

  const execution = confirm(sdk, plan)
  const receipt = await sdk.executeCommandEnvelope(execution)
  assert.equal(receipt.status, 'committed')
  assert.equal(sdk.agentPlans.get(plan.id).status, 'consumed')
  await assert.rejects(sdk.executeCommandEnvelope(execution), error => error instanceof KJValidationError && /consumed/.test(error.message))
})

test('agent plans reject document drift after review', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-drift' })
  const plan = plannedCreate(sdk, document)
  await sdk.executeCommandEnvelope(plan)
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [1, 0] } })
  await assert.rejects(sdk.executeCommandEnvelope(confirm(sdk, plan)), error => error instanceof KJValidationError && /document state changed/.test(error.message))
  assert.equal(document.listEntities().length, 1)
})

test('agent plans expire against a host-controlled clock', async () => {
  let now = Date.parse('2026-01-01T00:00:00.000Z')
  const sdk = createKJDrawSDK({ agentPlanOptions: { clock: () => now, defaultTtlMs: 100 } })
  const document = sdk.createDocument({ documentId: 'agent-expiry' }), plan = plannedCreate(sdk, document)
  await sdk.executeCommandEnvelope(plan)
  now += 101
  await assert.rejects(sdk.executeCommandEnvelope(confirm(sdk, plan)), error => error instanceof KJValidationError && /expired/.test(error.message))
  assert.equal(sdk.agentPlans.get(plan.id).status, 'expired')
  assert.equal(document.revision, 0)
})
