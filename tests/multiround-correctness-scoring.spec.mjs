import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateMultiroundCorrectness,
  CORRECTNESS_ARMS,
} from '../scripts/benchmarks/aggregate-multiround-correctness.mjs'

const tasks = [{ id: 'plate-01', family: 'mechanical', rounds: 10 }]
const models = ['test-model-pinned']
const fullRuns = () =>
  CORRECTNESS_ARMS.flatMap((arm) =>
    Array.from({ length: 10 }, (_, offset) => ({
      taskId: 'plate-01',
      modelId: models[0],
      arm,
      repetition: 1,
      roundIndex: offset + 1,
      status: 'passed',
      evidencePath: `evidence/${arm}/${offset + 1}.json`,
      checks: {
        geometry: true,
        untouched: true,
        reviewed: true,
        reopened: true,
        undoRedo: offset === 3,
        dxfCheckpoint: offset === 4,
      },
    })),
  )

test('ten-round correctness is independent of missing token or timing data', () => {
  const report = aggregateMultiroundCorrectness({ tasks, models, runs: fullRuns(), repetitions: 1 })
  assert.equal(report.plannedTrials, 3)
  for (const arm of CORRECTNESS_ARMS) {
    assert.equal(report.byModel[models[0]][arm].successful, 1)
    assert.equal(report.trials.find((trial) => trial.arm === arm).tokens, null)
  }
  assert.equal(report.status, 'descriptive-only')
})

test('unintended edits, reopen failure, missing checkpoints and missing rounds fail the whole trial', () => {
  const runs = fullRuns()
  runs.find((run) => run.arm === 'kjdraw' && run.roundIndex === 8).checks.untouched = false
  runs.find((run) => run.arm === 'direct-dxf' && run.roundIndex === 5).checks.dxfCheckpoint = false
  runs.splice(
    runs.findIndex((run) => run.arm === 'declarative-ezdxf' && run.roundIndex === 10),
    1,
  )
  const report = aggregateMultiroundCorrectness({ tasks, models, runs, repetitions: 1 })
  assert.equal(report.byFamily.mechanical.kjdraw.successful, 0)
  assert.deepEqual(
    report.trials.map((trial) => trial.firstFailure),
    [
      { roundIndex: 8, reason: 'failed-untouched' },
      { roundIndex: 5, reason: 'failed-dxfCheckpoint' },
      { roundIndex: 10, reason: 'missing' },
    ],
  )
})

test('duplicate and unrecognized records cannot improve scores', () => {
  const runs = fullRuns()
  runs.push({ ...runs[0] }, { ...runs[0], arm: 'unregistered' })
  const report = aggregateMultiroundCorrectness({ tasks, models, runs, repetitions: 1 })
  assert.equal(report.unexpected.length, 1)
  assert.deepEqual(report.trials[0].firstFailure, { roundIndex: 1, reason: 'duplicate' })
  assert.throws(
    () => aggregateMultiroundCorrectness({ tasks: [{ ...tasks[0], rounds: 9 }], models, runs }),
    /exactly ten rounds/u,
  )
})
