import test from 'node:test'
import assert from 'node:assert/strict'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { applyGeologyStratumChanges } from '../packages/kjdraw-sdk/src/geology-stratum-changes.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { buildRound3ScenarioFixture, expectedRound3ScenarioOutcome } from '../scripts/testing/helpers/geology-round3-scenario-oracles.mjs'

// Synthetic native-engine regressions only. These do not count as model passes.
const clone = structuredClone
const value = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value }
const target = layer => ({ intervalId: layer.intervalId, expectedTop: layer.top, expectedBottom: layer.bottom })
const content = document => {
  const { objects, tables, spaces, resources, opaquePayloads } = document.snapshot()
  // Undo/redo are new journal operations, so their audit timestamp advances.
  // All other metadata and all native/source content must restore exactly.
  const { modifiedAt: _auditTime, ...metadata } = document.snapshot().metadata
  return { objects, tables, spaces, resources, opaquePayloads, metadata }
}

test('a display-label delta preserves soil name/classification, measured boundaries, pattern and other source fields', () => {
  const before = [{ intervalId: 'PUBLIC-CLAY', code: '2', name: 'Public clay', lithology: 'clay', top: 3, bottom: 10,
    patternLabel: 'Public pattern', description: 'Retain', descriptionSource: 'interval', patternVisibility: 'filled' }]
  const original = clone(before)
  const after = applyGeologyStratumChanges(before, { update: [{ target: target(before[0]), set: { patternLabel: 'Public label revised' } }] })
  assert.deepEqual(after, [{ ...original[0], patternLabel: 'Public label revised' }]); assert.deepEqual(before, original)
  assert.throws(() => applyGeologyStratumChanges(before, { update: [{ target: target(before[0]), set: { patternLabel: 'x'.repeat(25) } }] }), /bounded nonempty/)
  assert.throws(() => applyGeologyStratumChanges(before, { update: [{ target: target(before[0]), set: { patternLabel: ' ' } }] }), /bounded nonempty/)
})

for (const suffix of ['zh-direct', 'zh-casual', 'en-direct', 'zh-followup', 'mixed', 'zh-correction']) {
  const id = 'GUS1-geological-presentation.source-pattern-label-' + suffix
  test(`real declared pattern-label style: exact proposal/approval/undo/reopen, ${suffix}`, async () => {
    const f = await buildRound3ScenarioFixture(id), reopenedSdk = createKJDrawSDK()
    try {
      const session = new KJAgentToolSession(f.sdk, f.document)
      const initialSnapshot = f.document.snapshot(), before = content(f.document), sourceBefore = clone(f.source)
      const expected = expectedRound3ScenarioOutcome(id, f)
      const expectedHole = expected.afterSource.input.hole
      const actualRead = value(await session.call('cad_read_geology_source', { expectedRevision: f.document.revision, drawingId: f.drawingId, maxBytes: 262144 }))
      const selected = actualRead.facts.hole.strata.find(layer => layer.intervalId === 'I-CLAY')
      const label = expectedHole.strata.find(layer => layer.intervalId === selected.intervalId).patternLabel
      const request = { expectedRevision: f.document.revision, units: 'millimeter', drawingId: f.drawingId,
        updates: [{ holeId: actualRead.facts.hole.id, stratumChanges: { update: [{ target: target(selected), set: { patternLabel: label } }] } }] }
      const pending = value(await session.call('cad_propose_geology_revision', request))
      assert.equal(pending.status, 'awaiting-host-approval'); assert.deepEqual(content(f.document), before)
      assert.equal(f.document.snapshot(), initialSnapshot, 'Preparing the proposal cannot change even audit metadata')
      assert.deepEqual(pending.engineeringEvidence.beforeSource.facts.hole, sourceBefore.input.hole)
      assert.deepEqual(pending.engineeringEvidence.afterSource.facts.hole, expectedHole)
      const complete = clone(request); delete complete.updates[0].stratumChanges; complete.updates[0].strata = clone(expectedHole.strata)
      const equivalent = value(await session.call('cad_propose_geology_revision', complete))
      assert.deepEqual(pending.preview, equivalent.preview); assert.deepEqual(pending.engineeringEvidence, equivalent.engineeringEvidence)
      const unrelated = pending.unchangedIds.map(entityId => clone(f.document.getObject(entityId)))
      const hatchPayloads = f.document.listEntities({ type: 'HATCH' }).map(entity => clone(entity.payload))
      assert.equal(value(await session.approve(pending.planId, 'public-pattern-label-reviewer')).status, 'committed')
      assert.deepEqual(readGeologyDrawingRecipe(f.document, f.drawingId).source, expected.afterSource)
      for (const record of unrelated) assert.deepEqual(f.document.getObject(record.id), record)
      assert.deepEqual(f.document.listEntities({ type: 'HATCH' }).map(entity => entity.payload), hatchPayloads)
      assert.ok(f.document.listEntities().some(entity => ['TEXT', 'MTEXT'].includes(entity.type) && entity.payload.text === label))
      const after = content(f.document)
      await f.document.undo(); assert.deepEqual(content(f.document), before)
      await f.document.redo(); assert.deepEqual(content(f.document), after)
      const native = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'KJD' }), { format: 'KJD' })
      assert.deepEqual(readGeologyDrawingRecipe(native, f.drawingId).source, expected.afterSource)
      const dxf = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'DXF' }), { format: 'DXF' })
      assert.equal(dxf.validate().valid, true)
      assert.ok(dxf.listEntities().some(entity => ['TEXT', 'MTEXT'].includes(entity.type) && entity.payload.text === label))
      assert.equal(dxf.listEntities({ type: 'HATCH' }).length, hatchPayloads.length)
    } finally { f.dispose(); for (const documentId of [...reopenedSdk.documents.keys()]) reopenedSdk.closeDocument(documentId) }
  })
}
