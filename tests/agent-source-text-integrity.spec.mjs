import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { validateAgentSourceText } from '../packages/kjdraw-sdk/src/agent-source-text.js'
import { suppliedCreationCallerFacts } from '../scripts/testing/helpers/geology-supplied-creation-oracles.mjs'
import { buildPublicScenarioFixture } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'

test('source encoding guard preserves exact multilingual strings and never normalizes or reads getters', () => {
  const input = { name: '黏土', description: '原标点；e\u0301 / é 🧭', empty: '', rows: [{ id: '孔-甲' }] }
  const before = structuredClone(input)
  assert.doesNotThrow(() => validateAgentSourceText(input)); assert.deepEqual(input, before)
  for (const damaged of ['\uFFFD土', '土\uD800', '\uDC00土']) {
    assert.throws(() => validateAgentSourceText({ holes: [{ strata: [{ name: damaged }] }] }),
      error => /input.holes\[0\].strata\[0\].name/.test(error.message) && /do not guess/.test(error.message))
  }
  let reads = 0
  validateAgentSourceText(Object.defineProperty({}, 'name', { enumerable: true, get() { reads++; return 'not data' } }))
  assert.equal(reads, 0, 'pure guard is not authority to read accessors; the caller must validate the schema first')
})

for (const kind of ['column', 'section']) test(`FULL ${kind}: damaged caller text cannot become an approvable native proposal`, async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  t.after(() => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) })
  const session = new KJAgentToolSession(sdk, document)
  const input = { version: '1.0.0', expectedRevision: 0, units: 'millimeter',
    ...suppliedCreationCallerFacts(`GUS1-source-section.create-supplied-${kind}-zh-direct`).input }
  const hole = kind === 'column' ? input.hole : input.holes[0]
  const original = hole.strata[1].name, before = document.serialize(), history = structuredClone(document.history)
  for (const name of ['\uFFFD土', '\uD800土']) {
    hole.strata[1].name = name
    const result = await session.call(`cad_propose_geology_${kind}`, input)
    assert.equal(result.ok, false); assert.match(result.error.message, /source text.*strata\[1\].name/)
    assert.equal(document.serialize(), before); assert.deepEqual(document.history, history)
    assert.deepEqual(sdk.agentPlans.list(), [])
  }
  hole.strata[1].name = original
  const proposal = await session.call(`cad_propose_geology_${kind}`, input)
  assert.equal(proposal.ok, true, JSON.stringify(proposal.error)); assert.equal(document.serialize(), before)
  assert.equal((await session.approve(proposal.value.planId, 'public-text-integrity-reviewer')).ok, true)
  const stored = readGeologyDrawingRecipe(document, proposal.value.engineeringEvidence.rootObjectId).source
  const retainedHole = kind === 'column' ? stored.input.hole : stored.input.holes[0]
  assert.equal(retainedHole.strata[1].name, original, 'complete caller source text survives native compilation and approval')
  assert.equal(document.validate().valid, true)
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  assert.equal(reopened.validate().valid, true)
})

test('FULL source revision rejects a damaged requested name without corrupting retained source or unrelated objects', async t => {
  const f = await buildPublicScenarioFixture('synthetic-source-section-v1')
  t.after(() => f.dispose())
  const session = new KJAgentToolSession(f.sdk, f.document), before = f.document.serialize()
  const layer = f.source.input.holes[0].strata[0]
  const result = await session.call('cad_propose_geology_revision', {
    expectedRevision: f.document.revision, units: 'millimeter', drawingId: f.drawingId,
    updates: [{ holeId: f.source.input.holes[0].id, stratumChanges: { update: [{
      target: { intervalId: layer.intervalId, expectedTop: layer.top, expectedBottom: layer.bottom },
      set: { name: '\uFFFD填土' },
    }] } }],
  })
  assert.equal(result.ok, false); assert.match(result.error.message, /updates\[0\].stratumChanges/)
  assert.equal(f.document.serialize(), before); assert.deepEqual(f.sdk.agentPlans.list(), [])
})
