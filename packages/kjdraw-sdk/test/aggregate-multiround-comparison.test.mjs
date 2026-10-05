import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateMultiroundComparison } from '../../../scripts/benchmarks/aggregate-multiround-comparison.mjs'

const arms = ['kjdraw-tool', 'python-ezdxf']
const manifest = count => Array.from({ length: count }, (_, index) => ({ id: `task-${index + 1}`, expectedRounds: index % 2 ? 3 : 2 }))
function runsFor(tasks, { toolTokens = 10, baselineTokens = 20 } = {}) {
  return tasks.flatMap(task => Array.from({ length: 3 }, (_, index) => index + 1).flatMap(repetition =>
    arms.flatMap(arm => Array.from({ length: task.expectedRounds }, (_, offset) => ({
      taskId: task.id, arm, repetition, roundIndex: offset + 1, status: 'passed',
      validation: { passed: true }, totalMs: arm === arms[0] ? 100 : 200,
      usage: { inputTokens: 5, outputTokens: (arm === arms[0] ? toolTokens : baselineTokens) - 5,
        totalTokens: arm === arms[0] ? toolTokens : baselineTokens, invalidFields: [] },
    })))))
}
const compare = (tasks, runs, evidence = { mode: 'fixture', verified: false }) =>
  aggregateMultiroundComparison({ tasks, runs, arms, repetitions: 3, evidence })
// Synthetic live-shaped inputs exercise only the decision arithmetic; never publish them.
const compareLiveShape = (tasks, runs) => compare(tasks, runs, { mode: 'live', verified: true })

test('reports every predefined task, repetition and round with provider tokens, accuracy and latency', () => {
  const tasks = manifest(2), report = compare(tasks, runsFor(tasks))
  assert.equal(report.plannedRoundAttempts, 30)
  assert.equal(report.perArm[arms[0]].planned, 15)
  assert.equal(report.perArm[arms[0]].accuracy, 1)
  assert.equal(report.perArm[arms[0]].totalTokens, 150)
  assert.equal(report.perArm[arms[1]].totalMs, 3000)
  assert.equal(report.perTask[1].repetitions[0].rounds[arms[0]][2].usage.outputTokens, 5)
  assert.equal(report.perTask[1].perRound[2].arms[arms[0]].planned, 3)
  assert.equal(report.perTask[1].perRound[2].arms[arms[0]].accuracy, 1)
  assert.equal(report.perTask[1].perRound[2].comparable, true)
  assert.equal(report.perTask[1].perRound[2].cheaper, true)
  assert.equal(report.paired.comparableTasks, 2)
  assert.equal(report.paired.cheaperTasks, 2)
  assert.equal(report.paired.claim99Supported, false) // Fewer than 100 tasks.
})

test('99% claim uses all 100 planned tasks and requires complete valid pairs', () => {
  const tasks = manifest(100), runs = runsFor(tasks)
  const first = compareLiveShape(tasks, runs)
  assert.equal(first.paired.requiredCheaperTasks, 99)
  assert.equal(first.paired.claim99Supported, true)
  for (const run of runs.filter(run => run.taskId === 'task-1' && run.arm === arms[0])) {
    run.usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20, invalidFields: [] }
  }
  const tied = compareLiveShape(tasks, runs)
  assert.equal(tied.paired.cheaperTasks, 99)
  assert.equal(tied.paired.claim99Supported, true)
  for (const run of runs.filter(run => run.taskId === 'task-2' && run.arm === arms[0])) {
    run.usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20, invalidFields: [] }
  }
  assert.equal(compareLiveShape(tasks, runs).paired.claim99Supported, false)
  assert.equal(compare(tasks, runsFor(tasks)).paired.claim99Supported, false) // Fixture cannot support a claim.
})

test('99 valid cheaper tasks and one invalid baseline still meet 99/100 using the full denominator', () => {
  const tasks = manifest(100), runs = runsFor(tasks)
  const baseline = runs.find(run => run.taskId === 'task-100' && run.arm === arms[1])
  baseline.status = 'execution-failed'; baseline.validation.passed = false
  const report = compareLiveShape(tasks, runs)
  assert.equal(report.paired.comparableTasks, 99)
  assert.equal(report.paired.incomparableTasks, 1)
  assert.equal(report.paired.cheaperTasks, 99)
  assert.equal(report.paired.cheaperShareOfPlannedTasks, 0.99)
  assert.equal(report.paired.claim99Supported, true)
  assert.equal(report.perTask[99].cheaper, null)
})

test('task decision compares medians of cumulative tokens, not sums across repetitions', () => {
  const tasks = manifest(1), runs = runsFor(tasks)
  for (const run of runs.filter(run => run.arm === arms[0] && run.repetition === 3)) {
    run.usage = { inputTokens: 5, outputTokens: 995, totalTokens: 1000, invalidFields: [] }
  }
  const report = compare(tasks, runs), task = report.perTask[0]
  assert.ok(task.summaries[arms[0]].totalTokens > task.summaries[arms[1]].totalTokens)
  assert.equal(task.medianCumulativeTokens[arms[0]], 20)
  assert.equal(task.medianCumulativeTokens[arms[1]], 40)
  assert.equal(task.cheaper, true)
})

test('failed or timed out baseline is never counted as token savings', () => {
  const tasks = manifest(100), runs = runsFor(tasks)
  const failure = runs.find(run => run.taskId === 'task-1' && run.arm === arms[1])
  failure.status = 'failed'; failure.validation.passed = false
  failure.usage = null
  const timeout = runs.find(run => run.taskId === 'task-2' && run.arm === arms[1])
  timeout.status = 'timeout'; timeout.validation.passed = false; timeout.totalMs = null
  const report = compare(tasks, runs)
  assert.equal(report.perTask[0].summaries[arms[1]].totalTokens, null)
  assert.equal(report.perTask[0].summaries[arms[1]].incompleteUsage, 1)
  assert.equal(report.perTask[1].summaries[arms[1]].statuses.timeout, 1)
  assert.equal(report.perTask[1].perRound[0].arms[arms[1]].accuracy, 2 / 3)
  assert.equal(report.perTask[1].perRound[0].comparable, false)
  assert.equal(report.perTask[1].perRound[0].cheaper, null)
  assert.equal(report.paired.comparableTasks, 98)
  assert.equal(report.paired.cheaperTasks, 98)
  assert.equal(report.paired.claim99Supported, false)
})

test('Python ezdxf review and execution outcomes stay distinct from geometry failure', () => {
  const tasks = manifest(1), runs = runsFor(tasks)
  const baseline = runs.filter(run => run.arm === arms[1])
  baseline[0].status = 'review-required'; baseline[0].validation.passed = false
  baseline[1].status = 'review-rejected'; baseline[1].validation.passed = false
  baseline[2].status = 'execution-failed'; baseline[2].validation.passed = false
  baseline[2].execution = { reason: 'EXECUTION_TIMEOUT' }
  const report = compare(tasks, runs), summary = report.perTask[0].summaries[arms[1]]
  assert.equal(summary.statuses['review-required'], 1)
  assert.equal(summary.statuses['review-rejected'], 1)
  assert.equal(summary.statuses['execution-failed'], 1)
  assert.equal(summary.timeouts, 1)
  assert.equal(summary.failures, 3)
  assert.equal(report.paired.cheaperTasks, 0)
})

test('missing, duplicate, invalid usage and unexpected rounds cannot enter a paired claim', () => {
  const tasks = manifest(100), runs = runsFor(tasks)
  const removed = runs.pop()
  runs[0].usage.totalTokens = 999 // Provider totals must agree with input + output.
  runs.push({ ...runs[1] })
  runs.push({ ...removed, roundIndex: 99 })
  const report = compare(tasks, runs)
  assert.equal(report.perArm[arms[0]].statuses.duplicate, 1)
  assert.equal(report.perArm[arms[1]].statuses.missing, 1)
  assert.equal(report.perArm[arms[0]].incompleteUsage, 1)
  assert.equal(report.unexpectedRuns.length, 1)
  assert.equal(report.paired.claim99Supported, false)
})

test('incomplete token fields remain explicit while complete fields and timing are retained', () => {
  const tasks = manifest(1), runs = runsFor(tasks)
  runs[0].usage.outputTokens = null
  const report = compare(tasks, runs)
  const round = report.perTask[0].repetitions[0].rounds[arms[0]][0]
  assert.equal(round.usage.inputTokens, 5)
  assert.equal(round.usage.outputTokens, null)
  assert.equal(round.latencyMs, 100)
  assert.equal(report.perTask[0].summaries[arms[0]].inputTokens, 30)
  assert.equal(report.perTask[0].summaries[arms[0]].outputTokens, null)
  assert.equal(report.perTask[0].summaries[arms[0]].totalTokens, null)
  assert.equal(report.paired.cheaperTasks, 0)
})

test('rejects malformed plans before aggregation', () => {
  assert.deepEqual(aggregateMultiroundComparison({ tasks: manifest(1), runs: [] }).arms, arms)
  const corpusShaped = [{ id: 'corpus-task', expectedRounds: [{ id: 'create' }, { id: 'edit' }] }]
  assert.equal(compare(corpusShaped, runsFor([{ id: 'corpus-task', expectedRounds: 2 }])).plannedRoundAttempts, 12)
  assert.throws(() => compare([{ id: 'same', expectedRounds: 2 }, { id: 'same', expectedRounds: 3 }], []), /unique ids/)
  assert.throws(() => aggregateMultiroundComparison({ tasks: manifest(1), runs: [], arms: ['same', 'same'] }), /distinct/)
  assert.throws(() => aggregateMultiroundComparison({ tasks: manifest(1), runs: [], repetitions: 0 }), /repetitions/)
})
