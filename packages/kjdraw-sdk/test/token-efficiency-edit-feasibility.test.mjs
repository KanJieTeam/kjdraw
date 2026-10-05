import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { independentValidation } from '../../../scripts/benchmarks/paired-model-benchmark.mjs'
import { tokenEfficiencyTaskCorpus } from '../../../scripts/benchmarks/token-efficiency-task-corpus.mjs'

const radians = degrees => degrees * Math.PI / 180
function native(feature) {
  const shape = feature.shape
  if (feature.kind === 'lines') return ['LINE', { start: [shape.start.x, shape.start.y, 0], end: [shape.end.x, shape.end.y, 0] }]
  if (feature.kind === 'circles') return ['CIRCLE', { center: [shape.center.x, shape.center.y, 0], radius: shape.radius }]
  if (feature.kind === 'arcs') return ['ARC', { center: [shape.center.x, shape.center.y, 0], radius: shape.radius, startAngle: radians(shape.startDegrees), endAngle: radians(shape.endDegrees), clockwise: false }]
  if (feature.kind === 'polylines') return ['LWPOLYLINE', { vertices: shape.vertices.map(v => [v.x, v.y, 0]), closed: shape.closed }]
  throw new Error(`Unsupported fixture feature kind ${feature.kind}`)
}
const oldCircle = document => document.getObject('target-hole').payload
const expectedCircle = round => round.expected.circles.at(-1)
const maxX = points => Math.max(...points.map(point => point.point[0]))
const maxY = points => Math.max(...points.map(point => point.point[1]))

async function approveCall(session, document, name, args) {
  const result = await session.call(name, { expectedRevision: document.revision, units: 'millimeter', ...args })
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`)
  const approved = await session.approve(result.value.planId, 'offline-benchmark-feasibility-review')
  assert.equal(approved.ok, true, `${name}: ${JSON.stringify(approved)}`)
}

async function runRound(task, round, document, session) {
  const family = task.family
  if (family.startsWith('hole-')) {
    const before = oldCircle(document), after = expectedCircle(round)
    if (after.radius !== before.radius) await approveCall(session, document, 'cad_propose_scale', {
      ids: ['target-hole'], center: { x: before.center[0], y: before.center[1] }, factor: after.radius / before.radius,
    })
    else await approveCall(session, document, 'cad_propose_move', {
      ids: ['target-hole'], dx: after.center.x - before.center[0], dy: after.center.y - before.center[1],
    })
  } else if (family === 'boundary-width' || family === 'boundary-height') {
    const before = document.getObject('boundary').payload.vertices
    const after = round.expected.polylines[0].vertices
    if (family === 'boundary-width') {
      const x = maxX(before), dx = Math.max(...after.map(point => point.x)) - x
      await approveCall(session, document, 'cad_propose_stretch', { ids: ['boundary'], crossingStart: { x: x - 1, y: -1 }, crossingEnd: { x: x + 1, y: maxY(before) + 1 }, dx, dy: 0 })
    } else {
      const y = maxY(before), dy = Math.max(...after.map(point => point.y)) - y
      await approveCall(session, document, 'cad_propose_stretch', { ids: ['boundary'], crossingStart: { x: -1, y: y - 1 }, crossingEnd: { x: maxX(before) + 1, y: y + 1 }, dx: 0, dy })
    }
  } else if (family === 'slot-length') {
    const oldRight = document.getObject('slot-right').payload.center[0]
    const newRight = round.expected.arcs[0].center.x
    const dx = newRight - oldRight
    const low = document.getObject('slot-lower').payload.start[1], high = document.getObject('slot-upper').payload.start[1]
    await approveCall(session, document, 'cad_propose_stretch', { ids: ['slot-lower', 'slot-upper'], crossingStart: { x: oldRight - 1, y: low - 1 }, crossingEnd: { x: oldRight + 1, y: high + 1 }, dx, dy: 0 })
    await approveCall(session, document, 'cad_propose_move', { ids: ['slot-right'], dx, dy: 0 })
  } else if (family === 'paired-hole-spacing') {
    const currentA = document.getObject('hole-a').payload.center[0]
    const targetA = round.expected.circles[0].center.x
    const dx = targetA - currentA
    await approveCall(session, document, 'cad_propose_move', { ids: ['hole-a'], dx, dy: 0 })
    await approveCall(session, document, 'cad_propose_move', { ids: ['hole-b'], dx: -dx, dy: 0 })
  } else throw new Error(`No offline tool adapter for ${family}`)
}

test('one real KJDraw tool path per edit family reaches every expected intermediate DXF', async t => {
  const python = process.env.KJDRAW_PYTHON ?? 'python'
  let validatorAvailable = true
  try { independentValidation({ python, validatorKind: 'generic' }) } catch { validatorAvailable = false; t.diagnostic('ezdxf unavailable: SDK transition checks only') }
  const tasks = tokenEfficiencyTaskCorpus.filter(task => task.category === 'multi-round-edit')
  const selected = process.env.KJDRAW_CORPUS_FULL_VALIDATION === '1' ? tasks : [...new Set(tasks.map(task => task.family))].map(family => tasks.find(item => item.family === family))
  for (const task of selected) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: task.units })
    await document.transact('Seed neutral benchmark features', tx => {
      for (const feature of task.seed.features) { const [type, payload] = native(feature); tx.createEntity(type, payload, { id: feature.id }) }
    })
    const session = new KJAgentToolSession(sdk, document)
    for (const round of task.expectedRounds) {
      const before = new Map(document.listEntities().map(entity => [entity.id, structuredClone(entity.payload)]))
      await runRound(task, round, document, session)
      for (const id of round.preservedFeatureIds) assert.deepEqual(document.getObject(id).payload, before.get(id), `${task.id}/${round.id}: ${id} drifted`)
      const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
      if (validatorAvailable) {
        const scored = independentValidation({ python, dxf: String(dxf), expected: round.expected, validatorKind: round.validatorKind })
        assert.equal(scored.passed, true, `${task.id}/${round.id}: ${JSON.stringify(scored)}`)
      }
    }
  }
})
