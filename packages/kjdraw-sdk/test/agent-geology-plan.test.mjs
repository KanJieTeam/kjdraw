import assert from 'node:assert/strict'
import test from 'node:test'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'

function accepted(result) {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.value
}

test('millimetre sessions expose both geology plan compilers with correct source units', () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const definitions = new KJAgentToolSession(sdk, document).definitions
  const measured = definitions.find(tool => tool.name === 'cad_propose_geology_plan')
  const illustrative = definitions.find(tool => tool.name === 'cad_propose_geology_plan_example')
  assert.ok(measured)
  assert.ok(illustrative)
  assert.deepEqual(measured.inputSchema.properties.units.enum, ['meter'])
  assert.deepEqual(illustrative.inputSchema.properties.units.enum, ['millimeter'])
})

test('five-point plan follows a five-hole section without generic fallback', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const section = accepted(await session.call('cad_propose_geology_section_example', {
    expectedRevision: 0, units: 'millimeter', locale: 'zh-CN', holeCount: 5, depthMeters: 30,
  }))
  accepted(await session.approve(section.planId, 'geology-regression'))
  const sectionIds = new Set(document.listEntities().map(entity => entity.id))
  const sectionEntityCount = sectionIds.size

  const plan = accepted(await session.call('cad_propose_geology_plan_example', {
    expectedRevision: 1, units: 'millimeter', locale: 'zh-CN', pointCount: 5, depthMeters: 30,
  }))
  assert.equal(plan.engineeringEvidence.inputKind, 'illustrative-example')
  assert.equal(plan.engineeringEvidence.measuredData, false)
  assert.equal(plan.engineeringEvidence.sourceUnits, 'meter')
  assert.equal(plan.engineeringEvidence.units, 'millimeter')
  assert.equal(plan.engineeringEvidence.boreholeCount, 5)
  assert.equal(document.listEntities().length, sectionEntityCount)

  const pointSymbols = plan.arguments.entities.filter(entity =>
    entity.type === 'CIRCLE' && entity.payload.semanticRole === 'investigation-point')
  assert.equal(pointSymbols.length, 5)
  assert.ok(pointSymbols.every(entity => entity.payload.center[0] > 900_000))
  assert.ok(plan.arguments.entities.some(entity => entity.payload.semanticRole === 'section-line'))
  assert.ok(plan.arguments.entities.some(entity => entity.payload.semanticRole === 'north-arrow'))
  assert.ok(plan.arguments.entities.some(entity => entity.type === 'TEXT' && entity.payload.text.includes('非实测')))
  assert.equal(plan.arguments.layout.viewport.modelUnits, 'millimeter')
  assert.ok(plan.arguments.layout.viewport.viewHeight > 10_000)

  accepted(await session.approve(plan.planId, 'geology-regression'))
  assert.equal(document.revision, 2)
  assert.ok([...sectionIds].every(id => document.getObject(id)))
  assert.equal(document.listEntities().length, sectionEntityCount + plan.engineeringEvidence.entityCount)

  const layoutId = document.snapshot().spaces.layoutIds.find(id => document.getObject(id)?.name === plan.arguments.layout.name)
  assert.ok(layoutId)
  assert.equal(exportDrawingSvg(document, { layoutId }).report.diagnostics.length, 0)

  await document.undo()
  assert.equal(document.listEntities().length, sectionEntityCount)
  await document.redo()
  assert.equal(document.listEntities().length, sectionEntityCount + plan.engineeringEvidence.entityCount)

  for (const [format, bytes] of [
    ['KJD', await sdk.writeDocument(document, { format: 'KJD' })],
    ['DXF', await sdk.writeDocument(document, { format: 'DXF', version: '2018' })],
  ]) {
    const reopened = await createKJDrawSDK().readDocument(bytes, { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, document.listEntities().length)
    const reopenedLayoutId = reopened.snapshot().spaces.layoutIds.find(id => reopened.getObject(id)?.name === plan.arguments.layout.name)
    assert.ok(reopenedLayoutId)
    assert.equal(exportDrawingSvg(reopened, { layoutId: reopenedLayoutId }).report.diagnostics.length, 0)
  }
})

test('illustrative geology plan remains variable for ten points', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const proposal = accepted(await session.call('cad_propose_geology_plan_example', {
    expectedRevision: 0, units: 'millimeter', locale: 'zh-CN', pointCount: 10, depthMeters: 30, spacingMeters: 25,
  }))
  assert.equal(proposal.engineeringEvidence.boreholeCount, 10)
  assert.equal(proposal.arguments.entities.filter(entity =>
    entity.type === 'CIRCLE' && entity.payload.semanticRole === 'investigation-point').length, 10)
  assert.ok(proposal.arguments.entities.some(entity => entity.type === 'TEXT' && entity.payload.text.includes('10孔')))
})
