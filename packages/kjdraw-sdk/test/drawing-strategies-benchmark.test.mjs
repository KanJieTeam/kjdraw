import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKJDrawSDK } from '../src/sdk.js'
import { strategyTasks, proposalBatches, executeStrategy, checkDrawing, summarizeRuns, comparisonCharts, runStrategyBenchmark } from '../../../scripts/benchmarks/drawing-strategies.mjs'

test('published benchmark artifacts retain their measured byte hashes across checkouts', async () => {
  const base = new URL('../../../docs/benchmarks/local-drawing-strategies-2026-09-10/', import.meta.url)
  const report = JSON.parse(await readFile(new URL('report.json', base), 'utf8'))
  assert.equal(report.runs.length, 40)
  let checked = 0
  for (const run of report.runs) for (const [kind, name] of Object.entries(run.files ?? {})) {
    const bytes = await readFile(new URL(name, base))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), run.sha256[kind], name)
    checked++
  }
  assert.equal(checked, 32)
})

test('strategy benchmark batches preserve every original entity and both strategies produce the same verified CAD geometry', async () => {
  const complex = strategyTasks.find(task => task.id === 'perforated-panel-209')
  assert.equal(proposalBatches(complex.expected, 1).length, 209)
  assert.equal(proposalBatches(complex.expected, 64).length, 4)
  for (const task of strategyTasks) {
    const individual = await executeStrategy(task, 'per-entity')
    const batched = await executeStrategy(task, 'batched-64')
    assert.equal(individual.passed, true, task.id)
    assert.equal(batched.passed, true, task.id)
    assert.equal(individual.checks.original.geometrySha256, batched.checks.original.geometrySha256)
    assert.ok(individual.toolCallJsonBytes > batched.toolCallJsonBytes)
    for (const run of [individual, batched]) {
      assert.equal(run.provider.inputTokens, null)
      assert.equal(run.provider.modelLatencyMs, null)
      assert.equal(run.provider.cost, null)
      assert.ok(Number.isFinite(run.buildMs) && run.buildMs >= 0)
      assert.match(run.artifacts.preview, /Actual editable CAD output/)
      assert.match(run.artifacts.preview, /not model-generated/)
    }
  }
})

test('benchmark geometry checks reject wrong radius and wrong units even with matching entity counts', async () => {
  const task = strategyTasks[1], run = await executeStrategy(task, 'batched-64')
  const sdk = createKJDrawSDK(), document = await sdk.readDocument(run.artifacts.kjd, { format: 'KJD' })
  assert.equal(checkDrawing(document, task.expected).passed, true)
  const circle = document.listEntities().find(entity => entity.type === 'CIRCLE')
  await document.transact('Introduce wrong test radius', tx => tx.updateObject(circle.id, { payload: { radius: circle.payload.radius + 1 } }))
  assert.equal(checkDrawing(document, task.expected).passed, false)
  const wrongUnits = { ...task.expected, units: 'meter' }
  assert.equal(checkDrawing(document, wrongUnits).unitsCorrect, false)
})

test('summaries retain failures and charts label bytes and local timings without pretending they are model measurements', () => {
  const runs = []
  for (const strategy of ['per-entity', 'batched-64']) for (let index = 0; index < 5; index++) runs.push({ taskId: 'fixture', strategy, passed: index !== 0, buildMs: [9, 1, 5, 3, 7][index], totalMs: 10 + index, toolCallJsonBytes: 100, toolCalls: 1 })
  const summary = summarizeRuns(runs, ['fixture'])
  assert.equal(summary[0].strategies['per-entity'].passed, 4)
  assert.equal(summary[0].strategies['per-entity'].buildMedianMs, 5)
  const charts = comparisonCharts({ summary, repetitions: 5, environment: { node: 'test' } })
  assert.equal(Object.keys(charts).length, 3)
  for (const content of Object.values(charts)) { assert.match(content, /NO MODEL CALLS/); assert.match(content, /NOT MEASURED/); assert.match(content, /Same KJDraw core/) }
  assert.match(charts['tool-payload.svg'], /not model tokens/)
  assert.match(charts['local-time.svg'], /not AI inference latency/)
  assert.match(charts['geometry-correctness.svg'], /80%/)
})

test('benchmark artifacts contain raw repeated measurements, hashes and editable outputs without overwriting existing evidence', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'kjdraw-strategy-benchmark-'))
  try {
    const output = join(folder, 'run')
    const report = await runStrategyBenchmark({ output, repetitions: 5, tasks: [strategyTasks[2]] })
    assert.equal(report.runs.length, 10)
    assert.equal(report.runs.filter(run => run.passed).length, 10)
    assert.equal(report.warmupResults.length, 2)
    assert.equal(report.provider.measured, false)
    assert.match(report.source.sdkSourceSha256, /^[a-f0-9]{64}$/)
    assert.equal(report.runs[0].order, 0)
    assert.equal(report.runs[2].strategy, 'batched-64')
    assert.equal((await readdir(output)).length, 12)
    for (const run of report.runs.filter(run => run.repetition === 1)) {
      assert.match(run.sha256.kjd, /^[a-f0-9]{64}$/)
      const document = await createKJDrawSDK().readDocument(await readFile(join(output, run.files.kjd), 'utf8'), { format: 'KJD' })
      assert.equal(checkDrawing(document, strategyTasks[2].expected).passed, true)
    }
    assert.equal(JSON.parse(await readFile(join(output, 'report.json'), 'utf8')).runs.length, 10)
    await assert.rejects(runStrategyBenchmark({ output, repetitions: 5, tasks: [strategyTasks[2]] }), { code: 'EEXIST' })
    await assert.rejects(runStrategyBenchmark({ output: join(folder, 'too-few'), repetitions: 1 }), /5–30/)
  } finally { await rm(folder, { recursive: true, force: true }) }
})
