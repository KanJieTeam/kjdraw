import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'

const mdb = process.env.KJDRAW_GEOLOGY_MDB
const server = process.env.KJDRAW_KANJIE_SERVER
const python = process.env.KJDRAW_PYTHON ?? 'python'
const sheetFitError = error => /core labels collide with a boundary or another text lane|too thin for readable geometry at this scale/
  .test(String(error?.message ?? error))

function readCurrentProjectFacts() {
  const code = [
    'import json, sys',
    'from app.services.ytkc_mdb_adapter import YtkcMdbAdapter',
    'facts = YtkcMdbAdapter(use_cache=False).inspect(sys.argv[1])',
    'json.dump({"holes": facts["holes"], "sections": facts["sections"]}, sys.stdout, ensure_ascii=False)',
  ].join('\n')
  const result = spawnSync(python, ['-c', code, mdb], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: server, PYTHONIOENCODING: 'utf-8' },
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function lithology(name) {
  if (/填土/.test(name)) return 'fill'
  if (/粉质[黏粘]土/.test(name)) return 'silty-clay'
  if (/砾|卵石/.test(name)) return 'gravel'
  if (/砂/.test(name)) return 'sand'
  throw new Error('Unmapped real lithology; do not guess: ' + name)
}

function asColumnHole(source) {
  assert.ok(Number.isFinite(source.elevation), source.id + ': missing collar elevation')
  assert.ok(Number.isFinite(source.explorationDepth) && source.explorationDepth > 0,
    source.id + ': missing exploration depth')
  const strata = source.strata.map((stratum, index) => {
    assert.ok(stratum.layerName, source.id + ': unnamed interval ' + index)
    assert.ok(Number.isFinite(stratum.topDepth) && Number.isFinite(stratum.bottomDepth),
      source.id + ': missing interval boundary ' + index)
    return {
      intervalId: source.id + '-' + (index + 1),
      code: stratum.layerCode || String(index + 1),
      name: stratum.layerName,
      top: stratum.topDepth,
      bottom: stratum.bottomDepth,
      lithology: lithology(stratum.layerName),
    }
  })
  assert.ok(strata.length, source.id + ': no source strata')
  assert.ok(Math.abs(strata.at(-1).bottom - source.explorationDepth) < 0.001,
    source.id + ': interval depths do not reach declared exploration depth')
  const hole = {
    id: source.id,
    collarElevation: source.elevation,
    depth: source.explorationDepth,
    strata,
  }
  if (source.stableWaterDepth != null) hole.stableWaterDepth = source.stableWaterDepth
  if (source.initialWaterDepth != null) hole.initialWaterDepth = source.initialWaterDepth
  return hole
}

async function compileColumn(hole, pageHeightMillimeters) {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, drawing)
  const proposal = await session.call('cad_propose_geology_column', {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN',
    hole, projectName: '本地 MDB 源事实回归',
    ...(pageHeightMillimeters ? { pageHeightMillimeters } : {}),
  })
  assert.equal(proposal.ok, true, JSON.stringify(proposal.error))
  assert.equal(proposal.value.engineeringEvidence.parameters.stratumCount, hole.strata.length)
  assert.ok(proposal.value.arguments.entities.some(entity =>
    entity.type === 'TEXT' && entity.payload.text === hole.id), 'missing source borehole label')
  assert.ok(proposal.value.arguments.entities.some(entity => entity.type === 'HATCH'), 'missing native hatch')
  assert.equal(drawing.listEntities().length, 0, 'model proposal must not change the drawing')
  const receipt = await session.approve(proposal.value.planId, 'local-geology-source-review')
  assert.equal(receipt.ok, true, JSON.stringify(receipt.error))
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format }), { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, drawing.listEntities().length)
  }
  return drawing
}

async function proposeColumnOnly(hole, pageHeightMillimeters) {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, drawing)
  const result = await session.call('cad_propose_geology_column', {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN',
    hole, projectName: '本地 MDB 假设编辑压力测试',
    ...(pageHeightMillimeters ? { pageHeightMillimeters } : {}),
  })
  assert.equal(drawing.listEntities().length, 0, 'proposal must remain pending')
  return result
}

const hypotheticalEdits = [
  ['collar +0.1m', hole => { hole.collarElevation += 0.1 }],
  ['collar +0.5m', hole => { hole.collarElevation += 0.5 }],
  ['collar -0.5m', hole => { hole.collarElevation -= 0.5 }],
  ['stable water 20%', hole => { hole.stableWaterDepth = hole.depth * 0.2 }],
  ['stable water 40%', hole => { hole.stableWaterDepth = hole.depth * 0.4 }],
  ['stable water 60%', hole => { hole.stableWaterDepth = hole.depth * 0.6 }],
  ['initial water 30%', hole => { hole.initialWaterDepth = hole.depth * 0.3 }],
  ['initial water 50%', hole => { hole.initialWaterDepth = hole.depth * 0.5 }],
  ['add sample 20%', hole => { hole.observations = [{ kind: 'sample', id: 'T20', depth: hole.depth * 0.2 }] }],
  ['add sample 50%', hole => { hole.observations = [{ kind: 'sample', id: 'T50', depth: hole.depth * 0.5 }] }],
  ['add SPT 30%', hole => { hole.observations = [{ kind: 'spt', id: 'N30', depth: hole.depth * 0.3, value: 12 }] }],
  ['add SPT 70%', hole => { hole.observations = [{ kind: 'spt', id: 'N70', depth: hole.depth * 0.7, value: 24 }] }],
  ['deepen 0.5m', hole => { hole.depth += 0.5; hole.strata.at(-1).bottom += 0.5 }],
  ['deepen 1m', hole => { hole.depth += 1; hole.strata.at(-1).bottom += 1 }],
  ['rename top interval', hole => { hole.strata[0].name += '（复核）' }],
  ['rename bottom interval', hole => { hole.strata.at(-1).name += '（复核）' }],
  ['lower first boundary 0.2m', hole => {
    hole.strata[0].bottom += 0.2
    hole.strata[1].top += 0.2
  }],
  ['raise first boundary 0.2m', hole => {
    hole.strata[0].bottom -= 0.2
    hole.strata[1].top -= 0.2
  }],
  ['split thickest interval', hole => {
    const index = hole.strata.reduce((best, item, position, all) =>
      item.bottom - item.top > all[best].bottom - all[best].top ? position : best, 0)
    const original = hole.strata[index]
    const originalBottom = original.bottom
    const midpoint = (original.top + originalBottom) / 2
    original.bottom = midpoint
    hole.strata.splice(index + 1, 0, {
      ...original, intervalId: original.intervalId + '-split',
      code: original.code + '-1', top: midpoint, bottom: originalBottom,
    })
  }],
  ['merge first two intervals after explicit reclassification', hole => {
    hole.strata[0].bottom = hole.strata[1].bottom
    hole.strata.splice(1, 1)
  }],
]

test('current local MDB: every complete borehole recompiles with native hatches and reopens', {
  skip: !mdb || !server,
}, async t => {
  const facts = readCurrentProjectFacts()
  assert.ok(facts.holes.length > 0)
  let longSheetCount = 0
  for (const source of facts.holes) {
    await t.test('hole ' + source.id, async subtest => {
      const hole = asColumnHole(source)
      try {
        await compileColumn(hole)
      } catch (error) {
        if (!sheetFitError(error)) throw error
        try {
          await compileColumn(hole, 500)
          subtest.diagnostic('A4 label collision; declared 500 mm continuous sheet preserves the same source facts')
        } catch (secondError) {
          if (!sheetFitError(secondError)) throw secondError
          await compileColumn(hole, 841)
          subtest.diagnostic('500 mm label collision; declared 841 mm long sheet preserves the same source facts')
        }
        longSheetCount++
      }
    })
  }
  t.diagnostic('source boreholes: ' + facts.holes.length + '; long sheets: ' + longSheetCount)
})

test('current local MDB: ten hypothetical fact changes each trigger a full, reviewed column redraw', {
  skip: !mdb || !server,
}, async t => {
  const source = readCurrentProjectFacts().holes.find(hole => hole.strata.length >= 4)
  assert.ok(source)
  const hole = asColumnHole(source)
  const edits = [
    () => { hole.collarElevation += 0.5 },
    () => { hole.initialWaterDepth = hole.depth / 3 },
    () => { hole.stableWaterDepth = hole.depth / 2 },
    () => { hole.strata[0].bottom += 0.1; hole.strata[1].top += 0.1 },
    () => { hole.strata[1].bottom += 0.1; hole.strata[2].top += 0.1 },
    () => { hole.strata[1].name = '粉质黏土'; hole.strata[1].lithology = 'silty-clay' },
    () => { hole.observations = [{ kind: 'sample', id: 'T-1', depth: hole.depth / 4 }] },
    () => { hole.observations.push({ kind: 'spt', id: 'N-1', depth: hole.depth / 2, value: 18 }) },
    () => { hole.depth += 1; hole.strata.at(-1).bottom += 1 },
    () => {
      const last = hole.strata.at(-1)
      const split = last.top + (last.bottom - last.top) / 2
      last.bottom = split
      hole.strata.push({ ...last, intervalId: hole.id + '-split', code: last.code + '-1', top: split, bottom: hole.depth })
    },
  ]
  for (const [round, edit] of edits.entries()) {
    edit()
    await t.test('hypothetical edit ' + (round + 1), async () => compileColumn(structuredClone(hole)))
  }
})

test('current local MDB: 20 common fact-change and re-stratification scenarios across every borehole', {
  skip: !mdb || !server || process.env.KJDRAW_GEOLOGY_STRESS !== '1',
}, async t => {
  const facts = readCurrentProjectFacts()
  let attempts = 0, longSheets = 0
  for (const source of facts.holes) {
    const base = asColumnHole(source)
    for (const [label, mutate] of hypotheticalEdits) {
      const hole = structuredClone(base)
      mutate(hole)
      let result = await proposeColumnOnly(hole)
      if (!result.ok && sheetFitError(result.error)) {
        result = await proposeColumnOnly(hole, 500)
        if (!result.ok && sheetFitError(result.error))
          result = await proposeColumnOnly(hole, 841)
        longSheets++
      }
      assert.equal(result.ok, true, source.id + ' / ' + label + ': ' + JSON.stringify(result.error))
      assert.equal(result.value.engineeringEvidence.parameters.stratumCount, hole.strata.length)
      assert.ok(result.value.arguments.entities.some(entity => entity.type === 'HATCH'),
        source.id + ' / ' + label + ': missing native hatch')
      attempts++
    }
  }
  assert.equal(attempts, facts.holes.length * hypotheticalEdits.length)
  t.diagnostic('hypothetical proposals: ' + attempts + '; long-sheet layouts: ' + longSheets)
})
