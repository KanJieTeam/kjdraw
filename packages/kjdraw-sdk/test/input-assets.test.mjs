import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createAgentInputAsset, KJDRAW_ROAD_INPUT_ASSET_SCHEMA as schema } from '../src/input-assets.js'
import { canonicalizeAgentPlanBinding } from '../src/agent-plans.js'
import { createRoadDesignFixture } from '../examples/fixtures/road-design.mjs'

const input = () => ({ assetId: 'survey-c2', schema, data: createRoadDesignFixture() })

test('road input assets are detached finite data with independently verified canonical SHA-256', async () => {
  const source = input(), original = structuredClone(source), pending = createAgentInputAsset(source)
  source.data.sections[0].ground[0][1] = 900
  const asset = await pending
  assert.deepEqual(asset.data, original.data)
  const canonical = canonicalizeAgentPlanBinding({ schema, data: original.data })
  assert.equal(asset.descriptor.sha256, createHash('sha256').update(canonical).digest('hex'))
  assert.equal(asset.descriptor.byteLength, Buffer.byteLength(canonical))
  assert.deepEqual(asset.descriptor.counts, { alignment: 3, profile: 5, sections: 13, groundPoints: 91 })
  assert.deepEqual(asset.descriptor.stationRange, [0, 600])
  assert.equal(asset.descriptor.units, 'meter')
  assert.ok(JSON.stringify(asset.descriptor).length < 600)
  assert.equal('data' in asset.descriptor, false)
  assert.throws(() => { asset.data.sections[0].ground[0][1] = 3 }, TypeError)
  assert.throws(() => { asset.descriptor.sha256 = 'forged' }, TypeError)
  const reordered = Object.fromEntries(Object.entries(original.data).reverse())
  assert.equal((await createAgentInputAsset({ assetId: 'other-name', schema, data: reordered })).descriptor.sha256, asset.descriptor.sha256)
  original.data.profile[1].elevation += .1
  assert.notEqual((await createAgentInputAsset(original)).descriptor.sha256, asset.descriptor.sha256)
})

test('unsupported schemas, paths, inferred units and invalid road engineering are rejected', async () => {
  const edits = [
    value => { value.schema += '-next' }, value => { value.assetId = '../data' }, value => { value.assetId = 'https://example.invalid/road' },
    value => { value.assetId = 'a'.repeat(129) }, value => { value.extra = true }, value => { delete value.data },
    value => { value.data.units = 'millimeter' }, value => { delete value.data.units }, value => { value.data.profile[0].station = 1 },
    value => { value.data.alignment[1] = value.data.alignment[0] }, value => { value.data.sections[1].station = 0 },
    value => { value.data.sections[0].ground.reverse() }, value => { value.data.sections[0].ground = [[-2, 99], [2, 99]] },
    value => { value.data.slopes.fillHtoV = 0 }, value => { value.data.pavement.leftWidth = -1 },
    value => { value.data.profile[0].elevation = Infinity }, value => { value.data.profile[0].elevation = '100' },
    value => { value.data.sectionInterpolation = true },
  ]
  for (const edit of edits) { const value = input(); edit(value); await assert.rejects(createAgentInputAsset(value)) }
})

test('input asset validation does not invoke accessors or conversions and rejects dangerous structure', async () => {
  let calls = 0
  const accessor = input()
  Object.defineProperty(accessor.data.sections[0].ground[0], '1', { enumerable: true, get() { calls++; return 99 } })
  await assert.rejects(createAgentInputAsset(accessor), /accessors/); assert.equal(calls, 0)
  const conversion = input(); conversion.data.toJSON = () => { calls++; return {} }
  await assert.rejects(createAgentInputAsset(conversion)); assert.equal(calls, 0)
  const cycle = input(); cycle.data.alignment.push(cycle)
  const sparse = input(); delete sparse.data.sections[0].ground[0]
  const hidden = input(); Object.defineProperty(hidden.data, 'extra', { enumerable: false, value: 2 })
  const inherited = input(); Object.setPrototypeOf(inherited.data, { units: 'meter' })
  const symbol = input(); symbol.data[Symbol('unknown')] = 1
  for (const value of [cycle, sparse, hidden, inherited, symbol]) await assert.rejects(createAgentInputAsset(value))
  const pollution = JSON.parse('{"assetId":"x","schema":"' + schema + '","data":{"__proto__":{}}}')
  await assert.rejects(createAgentInputAsset(pollution), /unsafe/)
})

test('road source point, section, profile, traversal and byte budgets are checked before compilation', async () => {
  const changes = [
    value => { value.data.alignment = Array.from({ length: 65 }, (_, i) => [i, 0]) },
    value => { value.data.profile = Array.from({ length: 65 }, (_, i) => ({ station: i, elevation: 100 })) },
    value => { value.data.sections = Array.from({ length: 65 }, (_, i) => ({ station: i, ground: [[-25, 99], [25, 99]] })) },
    value => { value.data.sections[0].ground = Array.from({ length: 257 }, (_, i) => [i, 99]) },
    value => { value.data.sections = Array.from({ length: 17 }, (_, i) => ({ station: i, ground: Array.from({ length: 256 }, (_, j) => [j, 99]) })) },
    value => { value.data.extra = 'x'.repeat(1048577) },
    value => { value.data.extra = Array.from({ length: 30001 }, () => 0) },
  ]
  for (const change of changes) { const value = input(); change(value); await assert.rejects(createAgentInputAsset(value), /budget|requires|bounded/) }
})

