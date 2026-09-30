import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'

const layer = (holeId, suffix, code, name, top, bottom, lithology) => ({
  intervalId: holeId + '-' + suffix, code, name, top, bottom, lithology,
})
function hole(id, station, elevation) {
  return {
    id, station, collarElevation: elevation, depth: 16,
    strata: [
      layer(id, 'a', '1', '填土', 0, 3, 'fill'),
      layer(id, 'b', '2', '粉质黏土', 3, 9, 'clay'),
      layer(id, 'c', '3', '中砂', 9, 16, 'sand'),
    ],
  }
}
function correlations(holes) {
  return holes.slice(1).flatMap((next, index) =>
    holes[index].strata.map(stratum => ({
      fromHoleId: holes[index].id, toHoleId: next.id,
      fromIntervalId: stratum.intervalId,
      toIntervalId: next.id + '-' + stratum.intervalId.split('-').at(-1),
    })))
}
async function compileAndReopen(name, input, expectedHoles) {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, drawing)
  const result = await session.call(name, input)
  assert.equal(result.ok, true, JSON.stringify(result.error))
  assert.equal(result.value.status, 'awaiting-host-approval')
  assert.equal(drawing.listEntities().length, 0, 'proposal must not mutate before review')
  const entities = result.value.arguments.entities
  const texts = entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const holeId of expectedHoles) assert.ok(texts.includes(holeId), 'missing borehole label ' + holeId)
  assert.ok(entities.some(entity => entity.type === 'HATCH'), 'strata hatches must be native')
  const approval = await session.approve(result.value.planId, 'geology-fact-review')
  assert.equal(approval.ok, true, JSON.stringify(approval.error))
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format }), { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, entities.length)
    assert.equal(reopened.listEntities({ type: 'HATCH' }).length,
      entities.filter(entity => entity.type === 'HATCH').length)
  }
  return result.value
}

test('ten cumulative borehole fact snapshots rebuild with reviewed native hatches and reopen', async () => {
  const source = hole('ZK01', 0, 105.25)
  const mutations = [
    () => { source.depth = 18; source.strata[2].bottom = 18 },
    () => { source.collarElevation = 106.4 },
    () => { source.stableWaterDepth = 4.4 },
    () => { source.strata[0].bottom = 2.5; source.strata[1].top = 2.5 },
    () => { source.strata[1].bottom = 10; source.strata[2].top = 10 },
    () => { source.observations = [{ kind: 'sample', id: 'S1', depth: 5 }] },
    () => { source.observations.push({ kind: 'spt', id: 'N1', depth: 12, value: 18 }) },
    () => { source.strata[1].name = '黄土状粉质黏土'; source.strata[1].lithology = 'loess-like' },
    () => { source.strata[2].bottom = 14; source.strata.push(layer(source.id, 'd', '4', '砾砂', 14, 18, 'sand')) },
    () => { source.strata[3].name = '粗砂'; source.strata[3].code = '4-1' },
  ]
  for (const [round, mutate] of mutations.entries()) {
    mutate()
    const result = await compileAndReopen('cad_propose_geology_column', {
      version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN',
      hole: structuredClone(source), projectName: '合成测试，不代表实测资料',
    }, [source.id])
    assert.equal(result.engineeringEvidence.parameters.stratumCount, source.strata.length, 'round ' + (round + 1))
  }
})

test('thin source interval stays explicit on a declared long column sheet', async () => {
  const source = hole('ZK-THIN', 0, 105.25)
  source.depth = 40.3
  const boundaries = [1.5, 10.4, 20.1, 20.4, 29.8, 37.8, 40.3]
  const names = ['素填土', '粉质黏土', '中砂', '细砂薄层', '中砂', '圆砾', '粉质黏土']
  const lithologies = ['fill', 'silty-clay', 'sand', 'sand', 'sand', 'gravel', 'silty-clay']
  source.strata = boundaries.map((bottom, index) => layer(source.id, String(index + 1),
    String(index + 1), names[index], index ? boundaries[index - 1] : 0, bottom, lithologies[index]))
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, drawing)
  const args = {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN',
    hole: source, projectName: '合成薄层测试',
  }
  const a4 = await session.call('cad_propose_geology_column', args)
  assert.equal(a4.ok, false)
  assert.match(a4.error.message, /core labels collide/)
  assert.equal(drawing.listEntities().length, 0, 'failed layout must not partly modify the drawing')
  const longSheet = await compileAndReopen('cad_propose_geology_column', {
    ...args, pageHeightMillimeters: 500,
  }, [source.id])
  assert.equal(longSheet.engineeringEvidence.parameters.stratumCount, source.strata.length)
  assert.ok(longSheet.arguments.entities.some(entity =>
    entity.type === 'TEXT' && entity.payload.text === '细砂薄层'), 'thin interval name must remain visible')
})

test('revised layer names fit legibly or reject without truncating source text', async () => {
  const source = hole('ZK-NAME', 0, 105.25)
  source.strata[0].name = '圆砾+卵石（复核）'
  source.strata[0].lithology = 'gravel'
  const proposal = await compileAndReopen('cad_propose_geology_column', {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN',
    hole: source,
  }, [source.id])
  const label = proposal.arguments.entities.find(entity =>
    entity.type === 'TEXT' && entity.payload.text === source.strata[0].name)
  assert.ok(label, 'the revised full layer name must remain visible')
  assert.ok(label.payload.height >= 1.5, 'fitted text must stay legible')

  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, drawing)
  source.strata[0].name = '超长地层名称'.repeat(8)
  const rejected = await session.call('cad_propose_geology_column', {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN', hole: source,
  })
  assert.equal(rejected.ok, false)
  assert.match(rejected.error.message, /layerName text does not fit/)
  assert.equal(drawing.listEntities().length, 0)
})

test('ten cumulative section fact snapshots rebuild from explicit correlations and reopen', async () => {
  const holes = [hole('ZK01', 0, 105.25), hole('ZK02', 12, 104.8)]
  const mutations = [
    () => { holes[0].collarElevation = 105.8 },
    () => { holes[1].station = 15 },
    () => { for (const item of holes) { item.depth = 18; item.strata[2].bottom = 18 } },
    () => { for (const item of holes) { item.strata[0].bottom = 2.5; item.strata[1].top = 2.5 } },
    () => { for (const item of holes) { item.strata[1].bottom = 10; item.strata[2].top = 10 } },
    () => { holes[0].stableWaterDepth = 5 },
    () => { holes[1].observations = [{ kind: 'sample', id: 'S1', depth: 6 }] },
    () => {
      for (const item of holes) {
        item.strata[2].bottom = 14
        item.strata.push(layer(item.id, 'd', '4', '粗砂', 14, 18, 'sand'))
      }
    },
    () => {
      const third = hole('ZK03', 28, 104.2)
      third.depth = 18
      third.strata[2].bottom = 14
      third.strata.push(layer(third.id, 'd', '4', '粗砂', 14, 18, 'sand'))
      holes.push(third)
    },
    () => {
      for (const item of holes) {
        item.strata[2].bottom = 18
        item.strata.pop()
      }
      holes[2].collarElevation = 104.6
      holes[2].station = 30
    },
  ]
  for (const mutate of mutations) {
    mutate()
    await compileAndReopen('cad_propose_geology_section', {
      version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN',
      holes: structuredClone(holes), correlations: correlations(holes),
      horizontalScaleDenominator: 200, verticalScaleDenominator: 125,
      datumElevation: 85, surfaceRule: 'straight-between-supplied-collars',
      title: '合成测试剖面图',
    }, holes.map(item => item.id))
  }
})
