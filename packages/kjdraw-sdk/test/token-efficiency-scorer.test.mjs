import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { manufacturingTaskSuite } from '../../../scripts/benchmarks/manufacturing-task-suite.mjs'
import { featureHandlesFromKJDrawDocument, scoreTokenEfficiencyRound, scoreTokenEfficiencySeed } from '../../../scripts/benchmarks/token-efficiency-scorer.mjs'
import { tokenEfficiencyTaskCorpus } from '../../../scripts/benchmarks/token-efficiency-task-corpus.mjs'

const python = process.env.KJDRAW_PYTHON ?? 'python'
const taskById = id => tokenEfficiencyTaskCorpus.find(task => task.id === id)
const handles = (document, task) => featureHandlesFromKJDrawDocument({ document, featureIds: Object.fromEntries(task.seed.features.map(feature => [feature.id, feature.id])) })

test('scorer returns only pass/fail reasons and rejects malformed input', () => {
  assert.deepEqual(scoreTokenEfficiencyRound({}), { passed: false, reasons: ['INVALID_ROUND_INPUT'] })
  assert.deepEqual(scoreTokenEfficiencySeed({}), { passed: false, reasons: ['INVALID_SEED_INPUT'] })
  assert.deepEqual(scoreTokenEfficiencyRound({ task: taskById('simple-corner-hole-plate-1'), roundIndex: 7, dxf: 'x' }), { passed: false, reasons: ['INVALID_ROUND_INPUT'] })
})

test('KJDraw entity IDs are translated to exported DXF handles', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  let entityId
  await document.transact('seed', tx => { entityId = tx.createEntity('CIRCLE', { center: [10, 10, 0], radius: 2 }).id })
  assert.notEqual(entityId, document.getObject(entityId).handle)
  assert.deepEqual(featureHandlesFromKJDrawDocument({ document, featureIds: { 'test-feature': entityId } }), { 'test-feature': document.getObject(entityId).handle })
})

test('independent scorer checks seed handles, each edit, and native continuity', async t => {
  const task = taskById('edit-hole-move-x-1')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: task.units })
  await document.transact('neutral seed', tx => {
    for (const feature of task.seed.features) {
      const shape = feature.shape
      if (feature.kind === 'polylines') tx.createEntity('LWPOLYLINE', { vertices: shape.vertices.map(point => [point.x, point.y, 0]), closed: shape.closed }, { id: feature.id })
      else if (feature.kind === 'circles') tx.createEntity('CIRCLE', { center: [shape.center.x, shape.center.y, 0], radius: shape.radius }, { id: feature.id })
      else throw new Error('Unexpected seed fixture kind')
    }
  })
  const seedDxf = String(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }))
  const seedHandles = handles(document, task)
  assert.deepEqual(seedHandles, Object.fromEntries(task.seed.features.map(feature => [feature.id, document.getObject(feature.id).handle])))
  const seedResult = scoreTokenEfficiencySeed({ task, dxf: seedDxf, featureHandles: seedHandles, python })
  if (seedResult.reasons.includes('INDEPENDENT_VALIDATOR_UNAVAILABLE')) { t.skip('ezdxf unavailable'); return }
  assert.deepEqual(seedResult, { passed: true, reasons: [] })
  if (process.env.KJDRAW_EZDXF_PATH) {
    const prior = process.env.PYTHONPATH
    delete process.env.PYTHONPATH
    try {
      assert.deepEqual(scoreTokenEfficiencySeed({ task, dxf: seedDxf, featureHandles: seedHandles, python, ezdxfPath: process.env.KJDRAW_EZDXF_PATH }), { passed: true, reasons: [] })
    } finally {
      if (prior === undefined) delete process.env.PYTHONPATH
      else process.env.PYTHONPATH = prior
    }
  }
  const swapped = { ...seedHandles, 'fixed-hole': seedHandles['target-hole'], 'target-hole': seedHandles['fixed-hole'] }
  assert.deepEqual(scoreTokenEfficiencySeed({ task, dxf: seedDxf, featureHandles: swapped, python }).reasons, ['FEATURE_HANDLE_GEOMETRY_MISMATCH'])

  const session = new KJAgentToolSession(sdk, document)
  const move = await session.call('cad_propose_move', { expectedRevision: document.revision, units: task.units, ids: ['target-hole'], dx: 4, dy: 0 })
  assert.equal(move.ok, true)
  assert.equal((await session.approve(move.value.planId, 'offline-scorer-fixture')).ok, true)
  const roundDxf = String(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }))
  const currentHandles = handles(document, task)
  assert.deepEqual(scoreTokenEfficiencyRound({ task, roundIndex: 0, dxf: roundDxf, featureHandles: currentHandles, previousFeatureHandles: seedHandles, python }), { passed: true, reasons: [] })
  assert.deepEqual(scoreTokenEfficiencyRound({ task, roundIndex: 0, dxf: roundDxf, featureHandles: currentHandles, python }).reasons, ['PREVIOUS_FEATURE_HANDLES_REQUIRED'])
  assert.deepEqual(scoreTokenEfficiencyRound({ task, roundIndex: 0, dxf: roundDxf, featureHandles: currentHandles, previousFeatureHandles: { ...seedHandles, 'target-hole': 'FFFF' }, python }).reasons, ['FEATURE_HANDLE_CHANGED'])
  assert.deepEqual(scoreTokenEfficiencyRound({ task, roundIndex: 0, dxf: seedDxf, featureHandles: seedHandles, previousFeatureHandles: seedHandles, python }).reasons, ['GEOMETRY_OR_DXF_MISMATCH'])
  assert.deepEqual(Object.keys(seedResult), ['passed', 'reasons'])
})

test('manufacturing round uses its independent sheet validator without feature identity', async t => {
  const task = taskById('sheet-fixture-plate-240x140-a3')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: task.units }), session = new KJAgentToolSession(sdk, document)
  const proposal = await session.call('cad_propose_manufacturing_sheet', structuredClone(manufacturingTaskSuite[0].input))
  assert.equal(proposal.ok, true)
  assert.equal((await session.approve(proposal.value.planId, 'offline-scorer-fixture')).ok, true)
  const dxf = String(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }))
  const scored = scoreTokenEfficiencyRound({ task, roundIndex: 0, dxf, python })
  if (scored.reasons.includes('INDEPENDENT_VALIDATOR_UNAVAILABLE')) { t.skip('ezdxf unavailable'); return }
  assert.deepEqual(scored, { passed: true, reasons: [] })
})
