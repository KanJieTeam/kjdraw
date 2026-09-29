// Descriptive scorer for the preregistered three-arm, ten-round CAD study.
// Independent validators produce the checks; this module never authenticates
// a model response, a drawing, a human review, or the evidence archive.
export const CORRECTNESS_ARMS = Object.freeze(['kjdraw', 'direct-dxf', 'declarative-ezdxf'])
const checkNames = Object.freeze(['geometry', 'untouched', 'reviewed', 'reopened'])
const integer = (value) => Number.isSafeInteger(value) && value >= 0
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const key = (task, model, arm, repetition, round) =>
  JSON.stringify([task, model, arm, repetition, round])

function scoreRound(run, round) {
  if (!run) return { passed: false, reason: 'missing', tokens: null, elapsedMs: null }
  const required =
    round === 4
      ? [...checkNames, 'undoRedo']
      : round === 5
        ? [...checkNames, 'dxfCheckpoint']
        : checkNames
  const failed = required.find((name) => run.checks?.[name] !== true)
  const reason =
    run.status !== 'passed'
      ? String(run.status ?? 'invalid-status')
      : failed
        ? `failed-${failed}`
        : typeof run.evidencePath !== 'string' || !run.evidencePath
          ? 'missing-evidence-path'
          : null
  const usage = run.usage
  const tokens =
    integer(usage?.inputTokens) &&
    integer(usage?.outputTokens) &&
    integer(usage.inputTokens + usage.outputTokens)
      ? usage.inputTokens + usage.outputTokens
      : null
  return {
    passed: reason === null,
    reason,
    tokens,
    elapsedMs: finite(run.elapsedMs) ? run.elapsedMs : null,
  }
}

function summarizeTrials(trials) {
  const successful = trials.filter((trial) => trial.passed).length
  return {
    planned: trials.length,
    successful,
    successRate: trials.length ? successful / trials.length : null,
    firstFailures: Object.fromEntries(
      trials
        .filter((trial) => !trial.passed)
        .map((trial) => [`${trial.taskId}/${trial.repetition}`, trial.firstFailure]),
    ),
  }
}

export function aggregateMultiroundCorrectness({ tasks, models, runs, repetitions = 5 } = {}) {
  if (
    !Array.isArray(tasks) ||
    !tasks.length ||
    tasks.some(
      (task) =>
        typeof task?.id !== 'string' ||
        !task.id ||
        typeof task.family !== 'string' ||
        !task.family ||
        task.rounds !== 10,
    ) ||
    new Set(tasks.map((task) => task.id)).size !== tasks.length
  )
    throw new TypeError('tasks need unique ids, families and exactly ten rounds')
  if (
    !Array.isArray(models) ||
    !models.length ||
    models.some((model) => typeof model !== 'string' || !model) ||
    new Set(models).size !== models.length
  )
    throw new TypeError('models need unique pinned ids')
  if (!Array.isArray(runs)) throw new TypeError('runs must be an array')
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 30)
    throw new TypeError('repetitions must be 1–30')

  const expectedTasks = new Set(tasks.map((task) => task.id))
  const expectedModels = new Set(models)
  const seen = new Map(),
    unexpected = []
  for (const run of runs) {
    if (
      !expectedTasks.has(run?.taskId) ||
      !expectedModels.has(run?.modelId) ||
      !CORRECTNESS_ARMS.includes(run?.arm) ||
      !Number.isSafeInteger(run?.repetition) ||
      run.repetition < 1 ||
      run.repetition > repetitions ||
      !Number.isSafeInteger(run?.roundIndex) ||
      run.roundIndex < 1 ||
      run.roundIndex > 10
    ) {
      unexpected.push({
        taskId: run?.taskId ?? null,
        modelId: run?.modelId ?? null,
        arm: run?.arm ?? null,
        repetition: run?.repetition ?? null,
        roundIndex: run?.roundIndex ?? null,
      })
      continue
    }
    const id = key(run.taskId, run.modelId, run.arm, run.repetition, run.roundIndex)
    seen.set(id, [...(seen.get(id) ?? []), run])
  }

  const trials = []
  for (const task of tasks)
    for (const modelId of models)
      for (const arm of CORRECTNESS_ARMS) {
        for (let repetition = 1; repetition <= repetitions; repetition++) {
          const rounds = []
          for (let roundIndex = 1; roundIndex <= 10; roundIndex++) {
            const matching = seen.get(key(task.id, modelId, arm, repetition, roundIndex)) ?? []
            const scored =
              matching.length > 1
                ? { passed: false, reason: 'duplicate', tokens: null, elapsedMs: null }
                : scoreRound(matching[0], roundIndex)
            rounds.push({ roundIndex, ...scored })
          }
          const first = rounds.find((round) => !round.passed)
          const tokens = rounds.every((round) => round.tokens !== null)
            ? rounds.reduce((total, round) => total + round.tokens, 0)
            : null
          const elapsedMs = rounds.every((round) => round.elapsedMs !== null)
            ? rounds.reduce((total, round) => total + round.elapsedMs, 0)
            : null
          trials.push({
            taskId: task.id,
            family: task.family,
            modelId,
            arm,
            repetition,
            passed: !first,
            firstFailure: first ? { roundIndex: first.roundIndex, reason: first.reason } : null,
            tokens,
            elapsedMs,
            rounds,
          })
        }
      }
  const byModel = Object.fromEntries(
    models.map((model) => [
      model,
      Object.fromEntries(
        CORRECTNESS_ARMS.map((arm) => [
          arm,
          summarizeTrials(trials.filter((trial) => trial.modelId === model && trial.arm === arm)),
        ]),
      ),
    ]),
  )
  const byFamily = Object.fromEntries(
    [...new Set(tasks.map((task) => task.family))].map((family) => [
      family,
      Object.fromEntries(
        CORRECTNESS_ARMS.map((arm) => [
          arm,
          summarizeTrials(trials.filter((trial) => trial.family === family && trial.arm === arm)),
        ]),
      ),
    ]),
  )
  return {
    schema: 'com.kanjie.kjdraw.benchmark.multiround-correctness@1',
    status: 'descriptive-only',
    evidenceBoundary:
      'Checks and evidence paths are supplied by callers; this scorer does not verify raw drawings, model requests, or reviewer identity.',
    tasks: tasks.length,
    models,
    arms: CORRECTNESS_ARMS,
    repetitions,
    plannedTrials: tasks.length * models.length * CORRECTNESS_ARMS.length * repetitions,
    unexpected,
    byModel,
    byFamily,
    trials,
  }
}
