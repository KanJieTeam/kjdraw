import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { tokenCheckpointPlan, runCheckpointedTokenBenchmark } from '../../../scripts/benchmarks/token-efficiency-checkpoint.mjs'
import { tokenEfficiencyTaskCorpus } from '../../../scripts/benchmarks/token-efficiency-task-corpus.mjs'

const tasks = tokenEfficiencyTaskCorpus.filter(task => task.category === 'simple-one-shot').slice(0, 2)
const models = [{ provider: 'deepseek', model: 'fixture-v1', settings: { temperature: 0, max_tokens: 4096 } }]
const secret = 'private-provider-body-and-key-never-persist'
const fixtureDxf = '0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n'
const fixtureUnit = ({ task, repetition }, returnedModel = 'served-v1') => ({ runs: task.rounds.flatMap((_, index) =>
  ['kjdraw-tool', 'declarative-ezdxf'].map(arm => ({ taskId: task.id, arm, repetition, roundIndex: index + 1,
    status: 'passed', validation: { passed: true, reasons: [] }, usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    totalMs: 4, transportLatencyMs: 2, returnedModel, failure: null, dxf: fixtureDxf,
    rawProviderBody: secret, apiKey: secret,
  }))) })
async function folder(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-token-checkpoint-'))
  t.after(async () => { assert.ok(resolve(directory).startsWith(resolve(tmpdir()))); await rm(directory, { recursive: true, force: true }) })
  return directory
}

test('dry run fixes the full denominator and makes no file or provider changes', async t => {
  const output = join(await folder(t), 'not-created')
  let called = 0
  const plan = await runCheckpointedTokenBenchmark({ tasks, models, repetitions: 3, output, executeUnit: () => { called++ } })
  assert.equal(plan.mode, 'dry-run')
  assert.equal(plan.plannedUnits, 6)
  assert.equal(plan.plannedRoundAttempts, 12)
  assert.equal(plan.remainingUnits, 6)
  assert.equal(called, 0)
  assert.deepEqual(tokenCheckpointPlan({ tasks, models, repetitions: 3 }), tokenCheckpointPlan({ tasks, models, repetitions: 3 }))
  await assert.rejects(readdir(output), { code: 'ENOENT' })
})

test('complete units commit atomically, resume by verified hash, and re-run corrupt artifacts', async t => {
  const output = join(await folder(t), 'checkpoint')
  let calls = 0
  const executeUnit = input => { calls++; return fixtureUnit(input) }
  const options = { tasks: tasks.slice(0, 1), models, repetitions: 1, output, executeUnit, dryRun: false }
  const first = await runCheckpointedTokenBenchmark(options)
  assert.equal(first.executedUnits, 1)
  assert.equal(first.remainingUnits, 0)
  assert.equal(first.aggregates[0].plannedTasks, 1)
  assert.equal(first.aggregates[0].paired.claim99Supported, false)
  const units = await readdir(join(output, 'units'))
  assert.equal(units.length, 1)
  const unitFolder = join(output, 'units', units[0])
  const files = await readdir(unitFolder)
  const commit = JSON.parse(await readFile(join(unitFolder, files.find(name => name.startsWith('commit-'))), 'utf8'))
  const attemptFolder = join(unitFolder, `attempt-${commit.attemptId}`)
  const evidenceRaw = await readFile(join(attemptFolder, 'evidence.json'), 'utf8')
  assert.equal(evidenceRaw.includes(secret), false)
  assert.equal((await readFile(join(output, 'plan.json'), 'utf8')).includes(secret), false)
  const evidence = JSON.parse(evidenceRaw)
  assert.equal(evidence.artifacts.length, 2)
  const resumed = await runCheckpointedTokenBenchmark(options)
  assert.equal(resumed.resumedUnits, 1)
  assert.equal(calls, 1)
  await writeFile(join(attemptFolder, evidence.artifacts[0].name), 'corrupt fixture DXF')
  const repaired = await runCheckpointedTokenBenchmark(options)
  assert.equal(repaired.invalidCommits, 1)
  assert.equal(repaired.executedUnits, 1)
  assert.equal(calls, 2)
  const again = await runCheckpointedTokenBenchmark(options)
  assert.equal(again.resumedUnits, 1)
  assert.equal(calls, 2)
})

test('provider quota and returned-model drift stop while preserving full task denominator', async t => {
  const quotaOutput = join(await folder(t), 'quota')
  let quotaCalls = 0
  const quota = await runCheckpointedTokenBenchmark({ tasks, models, repetitions: 1, output: quotaOutput, dryRun: false,
    executeUnit: () => { quotaCalls++; const error = new Error(secret); error.code = 'PROVIDER_RATE_LIMIT'; throw error } })
  assert.equal(quotaCalls, 1)
  assert.equal(quota.stopped, true)
  assert.equal(quota.stopReason, 'PROVIDER_RATE_LIMIT')
  assert.equal(quota.remainingUnits, 2)
  assert.equal(quota.aggregates[0].plannedTasks, 2)
  assert.equal(JSON.stringify(quota).includes(secret), false)

  const driftOutput = join(await folder(t), 'drift')
  let driftCalls = 0
  const drift = await runCheckpointedTokenBenchmark({ tasks, models, repetitions: 1, output: driftOutput, dryRun: false,
    executeUnit: input => { driftCalls++; return fixtureUnit(input, driftCalls === 1 ? 'served-v1' : 'served-v2') } })
  assert.equal(driftCalls, 2)
  assert.equal(drift.stopped, true)
  assert.equal(drift.stopReason, 'MODEL_VERSION_DRIFT')
  assert.equal(drift.completeUnits, 1)
  assert.equal(drift.remainingUnits, 1)
  assert.equal(drift.aggregates[0].plannedTasks, 2)
})

test('resume rejects a changed corpus or model settings before executing any unit', async t => {
  const output = join(await folder(t), 'mismatch')
  await runCheckpointedTokenBenchmark({ tasks, models, repetitions: 1, output, dryRun: false, executeUnit: fixtureUnit })
  let called = 0
  await assert.rejects(runCheckpointedTokenBenchmark({ tasks, models: [{ ...models[0], settings: { temperature: 1 } }], repetitions: 1, output,
    dryRun: false, executeUnit: () => { called++ } }), /CHECKPOINT_PLAN_MISMATCH/)
  assert.equal(called, 0)
})
