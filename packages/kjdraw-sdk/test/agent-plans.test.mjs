import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KJ_AGENT_PLAN_BINDING_CANONICALIZATION,
  KJAgentPlanRegistry,
  KJValidationError,
  createCommandEnvelope,
  createKJDrawSDK,
} from '../src/index.js'

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
  assert.equal(planned.result.bindingAlgorithm, 'SHA-256')
  assert.equal(planned.result.bindingCanonicalization, KJ_AGENT_PLAN_BINDING_CANONICALIZATION)
  assert.match(planned.result.binding, /^[0-9a-f]{64}$/)

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

test('canonical binding is independent of object key insertion order', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-canonical' })
  const plan = plannedCreate(sdk, document, { payload: { position: [1, 2] }, type: 'POINT' })
  await sdk.executeCommandEnvelope(plan)
  const execution = confirm(sdk, plan, { type: 'POINT', payload: { position: [1, 2] } })
  const receipt = await sdk.executeCommandEnvelope(execution)
  assert.equal(receipt.status, 'committed')
})

test('SHA-256 binding detects document content drift even if a legacy fingerprint collides', async () => {
  const registry = new KJAgentPlanRegistry()
  const state = { documentId: 'agent-content', revision: 0, geometry: { x: 1, y: 2 } }
  const document = {
    id: state.documentId,
    revision: state.revision,
    fingerprint: () => '0000000000000000',
    serialize: () => JSON.stringify(state),
  }
  const plan = createCommandEnvelope('CREATE', { type: 'POINT', payload: { position: [1, 2] } }, {
    id: 'content-bound-plan',
    documentId: document.id,
    expectedRevision: document.revision,
    mode: 'plan',
    origin: 'ai',
  })
  await registry.register(plan, document)
  state.geometry.x = 99
  const execution = createCommandEnvelope(plan.command, plan.arguments, {
    documentId: document.id,
    expectedRevision: document.revision,
    origin: 'ai',
    confirmation: { status: 'confirmed', planId: plan.id, confirmedBy: 'reviewer-1' },
  })
  await assert.rejects(registry.consume(execution, document), error => error instanceof KJValidationError && /document content/.test(error.message))
})

test('concurrent replays cannot both consume the same plan', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-concurrent' })
  const plan = plannedCreate(sdk, document)
  await sdk.executeCommandEnvelope(plan)
  const first = sdk.executeCommandEnvelope(confirm(sdk, plan))
  const replay = sdk.executeCommandEnvelope(confirm(sdk, plan))
  await assert.rejects(replay, error => error instanceof KJValidationError && /already being consumed/.test(error.message))
  assert.equal((await first).status, 'committed')
  assert.equal(document.revision, 1)
})

test('injected async binding providers fail closed when a plan expires during verification', async () => {
  let now = Date.parse('2026-01-01T00:00:00.000Z')
  const phases = []
  const bindingProvider = {
    algorithm: 'HOST-SIGNATURE/test',
    async create(content, context) {
      phases.push(context.phase)
      return `signed:${content.length}`
    },
    async verify(content, binding, context) {
      phases.push(context.phase)
      now += 100
      return binding === `signed:${content.length}`
    },
  }
  const sdk = createKJDrawSDK({ agentPlanOptions: { clock: () => now, defaultTtlMs: 100, bindingProvider } })
  const document = sdk.createDocument({ documentId: 'agent-provider-expiry' }), plan = plannedCreate(sdk, document)
  const preview = await sdk.executeCommandEnvelope(plan)
  assert.equal(preview.result.bindingAlgorithm, bindingProvider.algorithm)
  await assert.rejects(sdk.executeCommandEnvelope(confirm(sdk, plan)), error => error instanceof KJValidationError && /expired/.test(error.message))
  assert.deepEqual(phases, ['create', 'verify'])
  assert.equal(document.revision, 0)
})
