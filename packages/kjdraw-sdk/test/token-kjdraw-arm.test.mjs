import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createKJDrawSDK } from '../src/sdk.js'
import { tokenEfficiencyTaskCorpus } from '../../../scripts/benchmarks/token-efficiency-task-corpus.mjs'
import { createTokenKjdrawArm, executeTokenKjdrawRound } from '../../../scripts/benchmarks/token-kjdraw-arm.mjs'

const task = family => tokenEfficiencyTaskCorpus.find(item => item.family === family)
async function output(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-token-arm-'))
  t.after(async () => { assert.ok(resolve(directory).startsWith(resolve(tmpdir()))); await rm(directory, { recursive: true, force: true }) })
  return directory
}
async function reopened(dxf) { return createKJDrawSDK().readDocument(dxf, { format: 'DXF' }) }

test('hole-move seed maps neutral IDs to editable entities and preserves identities through two DXF rounds', async t => {
  const source = task('hole-move-x'), directory = await output(t)
  const state = await createTokenKjdrawArm({ seed: source.seed, outputDirectory: directory, mode: 'fixture' })
  assert.equal(Object.keys(state.featureIds).length, 3)
  assert.equal(state.document.getObject(state.featureIds['target-hole']).type, 'CIRCLE')
  const stable = state.featureIds['fixed-hole'], before = state.document.getObject(stable)
  const first = await executeTokenKjdrawRound({ state, roundIndex: 1, toolName: 'cad_propose_move',
    parameters: { ids: ['target-hole'], dx: 4, dy: 0 }, syntheticFixture: true })
  assert.equal(first.status, 'applied', JSON.stringify(first.failure))
  assert.equal(first.arguments.ids[0], state.featureIds['target-hole'])
  assert.equal(first.toolCallCount, 1)
  assert.deepEqual(state.document.getObject(stable), before)
  assert.deepEqual(state.document.getObject(state.featureIds['target-hole']).payload.center, [24, 20, 0])
  const second = await executeTokenKjdrawRound({ state, roundIndex: 2, toolName: 'cad_propose_move',
    parameters: { ids: ['target-hole'], dx: -2, dy: 0 }, syntheticFixture: true })
  assert.equal(second.status, 'applied', JSON.stringify(second.failure))
  assert.deepEqual(state.document.getObject(state.featureIds['target-hole']).payload.center, [22, 20, 0])
  assert.deepEqual((await reopened(second.artifacts.dxf)).listEntities({ type: 'CIRCLE' }).map(x => x.payload.center[0]).sort((a, b) => a - b), [22, 102])
  assert.equal(await readFile(join(directory, 'round-2.dxf'), 'utf8'), second.artifacts.dxf)
})

test('radius scale uses model supplied factor and retains center and neutral feature identity', async t => {
  const source = task('hole-diameter'), state = await createTokenKjdrawArm({ seed: source.seed, outputDirectory: await output(t), mode: 'fixture' })
  const id = state.featureIds['target-hole']
  const first = await executeTokenKjdrawRound({ state, roundIndex: 1, toolName: 'cad_propose_scale',
    parameters: { ids: ['target-hole'], center: { x: 20, y: 20 }, factor: 1.25 }, syntheticFixture: true })
  assert.equal(first.status, 'applied', JSON.stringify(first.failure))
  assert.equal(state.document.getObject(id).payload.radius, 5)
  const second = await executeTokenKjdrawRound({ state, roundIndex: 2, toolName: 'cad_propose_scale',
    parameters: { ids: ['target-hole'], center: { x: 20, y: 20 }, factor: 1.2 }, syntheticFixture: true })
  assert.equal(second.status, 'applied', JSON.stringify(second.failure))
  assert.equal(state.document.getObject(id).payload.radius, 6)
  assert.deepEqual(state.document.getObject(id).payload.center, [20, 20, 0])
  assert.equal((await reopened(second.artifacts.dxf)).listEntities({ type: 'CIRCLE' }).find(x => x.payload.center[0] === 20).payload.radius, 6)
})

test('two calls in one model response use the latest host revision and units', async () => {
  const source = task('paired-hole-spacing')
  const state = await createTokenKjdrawArm({ seed: source.seed, mode: 'fixture' })
  const modelRevision = state.document.revision
  const first = await executeTokenKjdrawRound({ state, roundIndex: 1, toolName: 'cad_propose_move',
    parameters: { expectedRevision: modelRevision, units: 'meter', ids: ['hole-a'], dx: 3, dy: 0 }, syntheticFixture: true })
  const second = await executeTokenKjdrawRound({ state, roundIndex: 1, toolName: 'cad_propose_move',
    parameters: { expectedRevision: modelRevision, units: 'meter', ids: ['hole-b'], dx: -3, dy: 0 }, syntheticFixture: true })
  assert.equal(first.status, 'applied', JSON.stringify(first.failure))
  assert.equal(second.status, 'applied', JSON.stringify(second.failure))
  assert.equal(first.arguments.expectedRevision, modelRevision)
  assert.equal(second.arguments.expectedRevision, modelRevision + 1)
  assert.equal(first.arguments.units, 'millimeter')
  assert.equal(second.arguments.units, 'millimeter')
  assert.deepEqual(state.document.getObject(state.featureIds['hole-a']).payload.center, [23, 20, 0])
  assert.deepEqual(state.document.getObject(state.featureIds['hole-b']).payload.center, [87, 20, 0])
})

test('boundary stretch edits only right edge and preserves datum in two rounds', async t => {
  const source = task('boundary-width'), state = await createTokenKjdrawArm({ seed: source.seed, outputDirectory: await output(t), mode: 'fixture' })
  const datum = state.document.getObject(state.featureIds.datum)
  for (const [roundIndex, x] of [[1, 110], [2, 118]]) {
    const result = await executeTokenKjdrawRound({ state, roundIndex, toolName: 'cad_propose_stretch',
      parameters: { ids: ['boundary'], crossingStart: { x: x - 1, y: -1 }, crossingEnd: { x: x + 1, y: 66 }, dx: 8, dy: 0 }, syntheticFixture: true })
    assert.equal(result.status, 'applied', JSON.stringify(result.failure))
    assert.deepEqual(state.document.getObject(state.featureIds.datum), datum)
    const boundary = state.document.getObject(state.featureIds.boundary)
    assert.deepEqual(boundary.payload.vertices.map(vertex => vertex.point[0]), [0, x + 8, x + 8, 0])
    const dxfBoundary = (await reopened(result.artifacts.dxf)).listEntities({ type: 'LWPOLYLINE' })[0]
    assert.deepEqual(dxfBoundary.payload.vertices.map(vertex => vertex.point[0]), [0, x + 8, x + 8, 0])
  }
})

test('live-shaped call leaves proposal unapproved and rejects unknown tool without changing drawing', async t => {
  const state = await createTokenKjdrawArm({ seed: task('hole-move-x').seed, outputDirectory: await output(t) })
  const id = state.featureIds['target-hole'], before = state.document.getObject(id)
  await assert.rejects(executeTokenKjdrawRound({ state, roundIndex: 1, toolName: 'cad_propose_move',
    parameters: { ids: ['target-hole'], dx: 4, dy: 0 }, syntheticFixture: true }), /fixture mode/)
  const pending = await executeTokenKjdrawRound({ state, roundIndex: 1, toolName: 'cad_propose_move', parameters: { ids: ['target-hole'], dx: 4, dy: 0 } })
  assert.equal(pending.status, 'awaiting-review')
  assert.equal(pending.approval.approved, false)
  assert.deepEqual(state.document.getObject(id), before)
  const failed = await executeTokenKjdrawRound({ state, roundIndex: 2, toolName: 'unknown-tool', parameters: { ids: ['target-hole'] } })
  assert.equal(failed.status, 'failed')
  assert.deepEqual(state.document.getObject(id), before)
})
