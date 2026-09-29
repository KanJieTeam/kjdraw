import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { independentValidation } from '../../../scripts/benchmarks/paired-model-benchmark.mjs'
import { tokenEfficiencyCorpusCounts, tokenEfficiencyCorpusSchema, tokenEfficiencyCorpusSeed, tokenEfficiencyCorpusSha256, tokenEfficiencyCorpusVersion, tokenEfficiencyHoldoutIds, tokenEfficiencyTaskCorpus } from '../../../scripts/benchmarks/token-efficiency-task-corpus.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const groups = tasks => Object.fromEntries([...new Set(tasks.map(task => task.family))].sort().map(family => [family, tasks.filter(task => task.family === family).length]))
const expectedFromSeed = seed => {
  const expected = { expectedRevision: 0, units: seed.units, lines: [], circles: [], arcs: [], polylines: [] }
  for (const feature of seed.features) expected[feature.kind].push(structuredClone(feature.shape))
  return expected
}

test('100 frozen tasks expose reproducible prompts and scorer-only expectations', () => {
  assert.equal(tokenEfficiencyCorpusSchema, 'com.kanjie.kjdraw.benchmark.token-efficiency-corpus@1')
  assert.equal(tokenEfficiencyCorpusVersion, '1.0.0')
  assert.equal(tokenEfficiencyCorpusSeed, 20260929)
  assert.deepEqual(tokenEfficiencyCorpusCounts, { total: 100, simpleOneShot: 30, complexOneShot: 30, multiRoundEdit: 40 })
  assert.equal(tokenEfficiencyTaskCorpus.length, 100)
  assert.equal(new Set(tokenEfficiencyTaskCorpus.map(task => task.id)).size, 100)
  assert.equal(tokenEfficiencyCorpusSha256, '3a09bda31d3643e8df9d4c8fb1870252fc35d2c6cedcd44cb51522228218c322')
  assert.equal(hash(tokenEfficiencyTaskCorpus), tokenEfficiencyCorpusSha256)
  assert.deepEqual(groups(tokenEfficiencyTaskCorpus.filter(task => task.category === 'simple-one-shot')), {
    'corner-hole-plate': 5, 'guide-rails': 5, 'radial-flange': 5, 'rounded-slot': 5, 'semicircular-track': 5, 'stepped-bracket': 5,
  })
  assert.deepEqual(groups(tokenEfficiencyTaskCorpus.filter(task => task.category === 'multi-round-edit')), {
    'boundary-height': 5, 'boundary-width': 5, 'hole-correction': 5, 'hole-diameter': 5,
    'hole-move-x': 5, 'hole-move-y': 5, 'paired-hole-spacing': 5, 'slot-length': 5,
  })
  assert.deepEqual(groups(tokenEfficiencyTaskCorpus.filter(task => task.category === 'complex-one-shot')), { 'manufacturing-sheet': 30 })
  assert.equal(tokenEfficiencyHoldoutIds.length, 5)
  assert.ok(tokenEfficiencyHoldoutIds.every(id => !tokenEfficiencyTaskCorpus.some(task => task.id === id)))
  assert.equal(new Set(tokenEfficiencyTaskCorpus.map(task => task.rounds.map(round => round.prompt).join('\n'))).size, 100)
  for (const task of tokenEfficiencyTaskCorpus) {
    assert.equal(task.version, tokenEfficiencyCorpusVersion, task.id)
    assert.match(task.id, /^[a-z0-9-]+$/, task.id)
    assert.ok(['simple-one-shot', 'complex-one-shot', 'multi-round-edit'].includes(task.category), task.id)
    assert.equal(task.units, 'millimeter', task.id)
    assert.equal(task.rounds.length, task.expectedRounds.length, task.id)
    assert.equal(task.acceptanceSha256, hash(task.expectedRounds), task.id)
    assert.ok(task.rounds.every((round, index) => round.id === task.expectedRounds[index].id && round.prompt.length > 30), task.id)
    assert.ok(task.expectedRounds.every(round => round.expected.units === task.units), task.id)
    if (task.category === 'multi-round-edit') {
      assert.equal(task.rounds.length, task.family === 'hole-move-x' ? 10 : 2, task.id)
      assert.equal(task.seedSha256, hash(task.seed), task.id)
      assert.deepEqual(task.seed.units, task.units, task.id)
      assert.equal(new Set(task.seed.features.map(feature => feature.id)).size, task.seed.features.length, task.id)
      assert.ok(task.expectedRounds.every(round => round.validatorKind === 'generic' && round.preservedFeatureIds.length > 0), task.id)
      assert.ok(task.expectedRounds.every(round => round.requiredFeatureIds.length === task.seed.features.length), task.id)
      let prior = new Map(task.seed.features.map(feature => [feature.id, feature]))
      for (const round of task.expectedRounds) {
        const features = new Map(round.expectedFeatures.map(feature => [feature.id, feature]))
        assert.deepEqual([...features.keys()], round.requiredFeatureIds, `${task.id}/${round.id}`)
        assert.deepEqual(expectedFromSeed({ units: task.units, features: round.expectedFeatures }), round.expected, `${task.id}/${round.id}`)
        for (const id of round.preservedFeatureIds) assert.deepEqual(features.get(id), prior.get(id), `${task.id}/${round.id}: preserved feature drift`)
        prior = features
      }
      assert.deepEqual([...new Set(task.seed.features.map(feature => feature.kind))].every(kind => ['lines', 'circles', 'arcs', 'polylines'].includes(kind)), true, task.id)
      assert.equal(expectedFromSeed(task.seed).units, task.units, task.id)
    } else {
      assert.equal(task.rounds.length, 1, task.id)
      assert.equal(task.seed, null, task.id)
    }
  }
})

test('every basic and edit family has materializable editable reference geometry', async t => {
  const python = process.env.KJDRAW_PYTHON ?? 'python'
  let validatorAvailable = true
  try { independentValidation({ python, validatorKind: 'generic' }) } catch { validatorAvailable = false; t.diagnostic('ezdxf unavailable: materialization verified, independent DXF scoring deferred') }
  const categories = ['simple-one-shot', 'multi-round-edit']
  for (const category of categories) {
    const tasks = tokenEfficiencyTaskCorpus.filter(task => task.category === category)
    const selected = process.env.KJDRAW_CORPUS_FULL_VALIDATION === '1' ? tasks : [...new Set(tasks.map(task => task.family))].map(family => tasks.find(candidate => candidate.family === family))
    for (const task of selected) {
      const expectedRounds = category === 'multi-round-edit'
        ? [{ id: 'seed', validatorKind: 'generic', expected: expectedFromSeed(task.seed) }, ...task.expectedRounds]
        : task.expectedRounds
      for (const round of expectedRounds) {
        const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: task.units }), session = new KJAgentToolSession(sdk, document)
        const proposal = await session.call('cad_propose_drawing', structuredClone(round.expected))
        assert.equal(proposal.ok, true, `${task.id}/${round.id}: ${JSON.stringify(proposal)}`)
        assert.equal((await session.approve(proposal.value.planId, 'corpus-conformance-fixture')).ok, true, `${task.id}/${round.id}`)
        assert.equal(document.listEntities().length, ['lines', 'circles', 'arcs', 'polylines'].reduce((sum, kind) => sum + round.expected[kind].length, 0), `${task.id}/${round.id}`)
        const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
        assert.match(String(dxf), /SECTION/, `${task.id}/${round.id}`)
        if (validatorAvailable) {
          const result = independentValidation({ python, dxf: String(dxf), expected: round.expected, validatorKind: round.validatorKind })
          assert.equal(result.passed, true, `${task.id}/${round.id}: ${JSON.stringify(result)}`)
        }
      }
    }
  }
})
