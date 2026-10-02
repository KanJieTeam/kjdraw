import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

// Source positions below are caller-declared PUBLIC SYNTHETIC metres, not
// measurements and not an inferred coordinate reference system.
function input(expectedRevision = 0) {
  return { version: '1.0.0', expectedRevision, units: 'meter', locale: 'zh-CN', drawingId: 'PUBLIC-POINT-UNIT-TEST',
    scale: 1000, boundary: [[1000, 2000], [1120, 2000], [1120, 2080], [1000, 2080]],
    boreholes: [{ id: 'TEST-A', position: [1015, 2020], collarElevation: 106.5, depth: 18 },
      { id: 'TEST-B', position: [1095, 2060], collarElevation: 107.5, depth: 21 },
      { id: 'TEST-C', position: [1055, 2025], collarElevation: 108.25, depth: 24 }],
    sectionLines: [{ id: 'SECTION-A', holeIds: ['TEST-A', 'TEST-B', 'TEST-C'], label: 'A—A' }],
    coordinateCallouts: [{ id: 'COORD-A', point: [1015, 2020], elbow: [1020, 2032], landingEnd: [1040, 2032],
      xLabelPosition: [1021, 2035], yLabelPosition: [1021, 2029], precision: 3, textHeight: 1.25 }], northAngleDegrees: 0 }
}
const accepted = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value }
const close = sdk => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }

for (const units of ['meter', 'millimeter']) test(`supplied metre point facts compile in the actual ${units} host, preserving source values and exact 1:1000 layout`, async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units }), session = new KJAgentToolSession(sdk, document)
  try {
    const before = canonicalStringify(document.snapshot())
    const source = input(), proposal = accepted(await session.call('cad_propose_geology_plan', source))
    assert.equal(canonicalStringify(document.snapshot()), before)
    assert.equal(proposal.engineeringEvidence.sourceUnits, 'meter')
    assert.equal(proposal.engineeringEvidence.units, units)
    const factor = units === 'millimeter' ? 1000 : 1
    for (const hole of source.boreholes) {
      const point = proposal.preview.after.find(entity => entity.type === 'CIRCLE' && entity.payload.sourceId === hole.id)
      assert.deepEqual(point.payload.center, [...hole.position.map(value => value * factor), 0])
      assert.equal(point.payload.radius, 2.2 * factor)
    }
    const route = proposal.preview.after.find(entity => entity.payload.semanticRole === 'section-line')
    assert.deepEqual(route.payload.referencedHoleIds, source.sectionLines[0].holeIds)
    assert.deepEqual(route.payload.vertices.map(vertex => vertex.point), source.boreholes.map(hole => [...hole.position.map(value => value * factor), 0]))
    const coordinates = proposal.preview.after.filter(entity => entity.payload.semanticRole === 'coordinate-callout-label')
    assert.deepEqual(coordinates.map(entity => entity.payload.text), ['X=2020.000', 'Y=1015.000'])
    const layout = proposal.arguments.layout
    assert.equal(layout.viewport.modelUnits, units)
    assert.deepEqual(layout.viewport.viewCenter, [1060 * factor, 2040 * factor, 0])
    assert.equal(layout.viewport.viewHeight, 250 * factor)
    assert.equal(layout.viewport.scaleDenominator, 1000)
    assert.equal(layout.viewport.viewHeight / factor * 1000 / layout.viewport.height, 1000)
    assert.equal(layout.dxfPlotSettings.paperWidth, 420)
    assert.equal(layout.dxfPlotSettings.paperHeight, 297)
    accepted(await session.approve(proposal.planId, 'point-source-unit-real-native-reviewer'))
    assert.equal(document.revision, 1)
    assert.equal(document.listEntities().length, proposal.engineeringEvidence.entityCount)
  } finally { close(sdk) }
})

test('the sole metre-source exception does not relax ordinary drawing-unit rules', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  try {
    for (const [name, args] of [
      ['cad_propose_circles', { expectedRevision: 0, units: 'meter', circles: [{ center: { x: 0, y: 0 }, radius: 5 }] }],
      ['cad_measure_distance', { expectedRevision: 0, units: 'meter', start: { x: 0, y: 0 }, end: { x: 3, y: 4 } }],
      ['cad_propose_geology_plan', { ...input(), units: 'millimeter' }],
      ['cad_propose_geology_plan', { ...input(), units: 'centimeter' }],
    ]) {
      const before = canonicalStringify(document.snapshot()), result = await session.call(name, args)
      assert.equal(result.ok, false, name)
      assert.equal(canonicalStringify(document.snapshot()), before)
    }
  } finally { close(sdk) }
})

test('unknown host units, stale revisions, missing source facts and nonblank hosts still reject before any partial proposal', async () => {
  for (const [units, change, seed] of [
    ['centimeter', () => {}, false],
    ['millimeter', args => { args.expectedRevision = 2 }, false],
    ['millimeter', args => { delete args.boreholes[0].collarElevation }, false],
    ['millimeter', () => {}, true],
  ]) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units }), session = new KJAgentToolSession(sdk, document)
    try {
      if (seed) await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 5 } }, { document })
      const args = input(document.revision); change(args)
      const before = canonicalStringify(document.snapshot())
      assert.equal((await session.call('cad_propose_geology_plan', args)).ok, false)
      assert.equal(canonicalStringify(document.snapshot()), before)
    } finally { close(sdk) }
  }
})
