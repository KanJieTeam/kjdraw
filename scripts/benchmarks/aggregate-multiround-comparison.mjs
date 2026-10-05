// Offline aggregation of a predeclared, paired, multi-round CAD benchmark.
// This module never makes model requests or treats missing evidence as savings.

const defaultArms = ['kjdraw-tool', 'python-ezdxf']
const count = value => Number.isSafeInteger(value) && value >= 0
const milliseconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const sum = values => values.every(count) && Number.isSafeInteger(values.reduce((total, value) => total + value, 0))
  ? values.reduce((total, value) => total + value, 0) : null
const median = values => {
  if (!values.length || !values.every(milliseconds)) return null
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const key = (taskId, arm, repetition, roundIndex) => JSON.stringify([taskId, arm, repetition, roundIndex])
const roundCount = task => Array.isArray(task?.expectedRounds) ? task.expectedRounds.length : task?.expectedRounds

function usageOf(run) {
  const usage = run?.usage
  const inputTokens = count(usage?.inputTokens) ? usage.inputTokens : null
  const outputTokens = count(usage?.outputTokens) ? usage.outputTokens : null
  const totalTokens = count(usage?.totalTokens) ? usage.totalTokens : null
  const complete = inputTokens !== null && outputTokens !== null && totalTokens !== null &&
    inputTokens + outputTokens === totalTokens && count(inputTokens + outputTokens) &&
    (!Array.isArray(usage?.invalidFields) || usage.invalidFields.length === 0)
  return { inputTokens, outputTokens, totalTokens, complete }
}

function roundRecord(run, identity, duplicate) {
  const usage = usageOf(run)
  const validStatus = ['passed', 'geometry-failed', 'failed', 'timeout', 'review-required', 'review-rejected',
    'execution-failed', 'validation-failed', 'validation-error'].includes(run?.status)
  const status = duplicate ? 'duplicate' : run ? validStatus ? run.status : 'invalid' : 'missing'
  const correct = status === 'passed' && run.validation?.passed === true
  const latencyMs = milliseconds(run?.totalMs) ? run.totalMs : null
  return { ...identity, status, correct, validationPassed: typeof run?.validation?.passed === 'boolean' ? run.validation.passed : null,
    usage, latencyMs, timedOut: status === 'timeout' || run?.execution?.reason === 'EXECUTION_TIMEOUT',
    valid: !duplicate && validStatus && correct && usage.complete && latencyMs !== null }
}

function summarize(rounds) {
  const statuses = Object.fromEntries(['passed', 'geometry-failed', 'failed', 'timeout', 'review-required',
    'review-rejected', 'execution-failed', 'validation-failed', 'validation-error', 'missing', 'duplicate', 'invalid'].map(status => [status, 0]))
  for (const round of rounds) statuses[round.status]++
  const attempted = rounds.length - statuses.missing
  const correct = rounds.filter(round => round.correct).length
  const completeUsage = rounds.filter(round => round.usage.complete).length
  const completeLatency = rounds.filter(round => round.latencyMs !== null).length
  return { planned: rounds.length, attempted, correct, accuracy: rounds.length ? correct / rounds.length : null,
    failures: attempted - correct, timeouts: rounds.filter(round => round.timedOut).length,
    statuses, completeUsage, incompleteUsage: rounds.length - completeUsage,
    completeLatency, incompleteLatency: rounds.length - completeLatency,
    inputTokens: sum(rounds.map(round => round.usage.inputTokens)),
    outputTokens: sum(rounds.map(round => round.usage.outputTokens)),
    totalTokens: rounds.every(round => round.usage.complete) ? sum(rounds.map(round => round.usage.totalTokens)) : null,
    totalMs: completeLatency === rounds.length ? rounds.reduce((total, round) => total + round.latencyMs, 0) : null,
    medianRoundMs: median(rounds.map(round => round.latencyMs)),
    valid: rounds.every(round => round.valid) }
}

/**
 * tasks: fixed manifest [{id, expectedRounds}], where expectedRounds is a count
 * or the corpus's acceptance-round array; roundIndex is 1..expectedRounds.length.
 * runs: one record per task, arm, repetition, roundIndex, using the paired runner's
 * status, validation, usage and totalMs fields. Missing/duplicate records are visible.
 */
export function aggregateMultiroundComparison({ tasks, runs, arms = defaultArms, repetitions = 3, evidence = null } = {}) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.some(task => typeof task?.id !== 'string' || !task.id || !Number.isSafeInteger(roundCount(task)) || roundCount(task) < 1) || new Set(tasks.map(task => task.id)).size !== tasks.length) throw new TypeError('tasks must be a nonempty manifest with unique ids and positive expectedRounds')
  if (!Array.isArray(runs)) throw new TypeError('runs must be an array')
  if (!Array.isArray(arms) || arms.length !== 2 || new Set(arms).size !== 2 || arms.some(arm => typeof arm !== 'string' || !arm)) throw new TypeError('arms must name two distinct methods')
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 30) throw new TypeError('repetitions must be an integer from 1 to 30')
  const records = new Map(), unexpectedRuns = []
  for (const run of runs) {
    const task = tasks.find(item => item.id === run?.taskId)
    if (!task || !arms.includes(run.arm) || !Number.isSafeInteger(run.repetition) || run.repetition < 1 || run.repetition > repetitions || !Number.isSafeInteger(run.roundIndex) || run.roundIndex < 1 || run.roundIndex > roundCount(task)) {
      unexpectedRuns.push({ taskId: run?.taskId ?? null, arm: run?.arm ?? null, repetition: run?.repetition ?? null, roundIndex: run?.roundIndex ?? null })
      continue
    }
    const id = key(run.taskId, run.arm, run.repetition, run.roundIndex)
    const entries = records.get(id) ?? []
    entries.push(run); records.set(id, entries)
  }
  const perTask = tasks.map(task => {
    const repetitionsOut = Array.from({ length: repetitions }, (_, index) => {
      const repetition = index + 1
      const roundsByArm = Object.fromEntries(arms.map(arm => [arm, Array.from({ length: roundCount(task) }, (_, offset) => {
        const roundIndex = offset + 1, matches = records.get(key(task.id, arm, repetition, roundIndex)) ?? []
        return roundRecord(matches[0], { taskId: task.id, arm, repetition, roundIndex }, matches.length > 1)
      })]))
      const summaries = Object.fromEntries(arms.map(arm => [arm, summarize(roundsByArm[arm])]))
      const comparable = arms.every(arm => summaries[arm].valid)
      return { repetition, rounds: roundsByArm, summaries, comparable,
        cheaper: comparable ? summaries[arms[0]].totalTokens < summaries[arms[1]].totalTokens : null }
    })
    const perRound = Array.from({ length: roundCount(task) }, (_, index) => {
      const summaries = Object.fromEntries(arms.map(arm => [arm, summarize(repetitionsOut.map(item => item.rounds[arm][index]))]))
      const comparable = arms.every(arm => summaries[arm].valid)
      return { roundIndex: index + 1, arms: summaries, comparable,
        cheaper: comparable ? median(repetitionsOut.map(item => item.rounds[arms[0]][index].usage.totalTokens)) < median(repetitionsOut.map(item => item.rounds[arms[1]][index].usage.totalTokens)) : null }
    })
    const summaries = Object.fromEntries(arms.map(arm => [arm, summarize(repetitionsOut.flatMap(item => item.rounds[arm]))]))
    const comparable = repetitionsOut.every(item => item.comparable)
    const medianCumulativeTokens = Object.fromEntries(arms.map(arm => [arm, comparable ? median(repetitionsOut.map(item => item.summaries[arm].totalTokens)) : null]))
    return { taskId: task.id, category: typeof task.category === 'string' && task.category ? task.category : 'unspecified',
      expectedRounds: roundCount(task), repetitions: repetitionsOut, perRound, summaries, comparable,
      medianCumulativeTokens,
      cheaper: comparable ? medianCumulativeTokens[arms[0]] < medianCumulativeTokens[arms[1]] : null }
  })
  const perArm = Object.fromEntries(arms.map(arm => [arm, summarize(perTask.flatMap(task => task.repetitions.flatMap(item => item.rounds[arm])))]))
  const perCategory = Object.fromEntries([...new Set(perTask.map(task => task.category))].map(category => {
    const selected = perTask.filter(task => task.category === category), cheaperTasks = selected.filter(task => task.cheaper === true).length
    return [category, { plannedTasks: selected.length, comparableTasks: selected.filter(task => task.comparable).length,
      cheaperTasks, cheaperShareOfPlannedTasks: cheaperTasks / selected.length }]
  }))
  const plannedTasks = tasks.length, comparableTasks = perTask.filter(task => task.comparable).length,
    cheaperTasks = perTask.filter(task => task.cheaper === true).length,
    requiredCheaperTasks = Math.ceil(plannedTasks * 0.99)
  const liveEvidenceVerified = evidence?.mode === 'live' && evidence?.verified === true
  const claim99Supported = plannedTasks >= 100 && repetitions >= 3 && unexpectedRuns.length === 0 &&
    liveEvidenceVerified && cheaperTasks >= requiredCheaperTasks
  return { schema: 'com.kanjie.kjdraw.benchmark.multiround-comparison@1', arms, repetitions, plannedTasks,
    publicationReviewRequired: true,
    evidenceNote: 'A caller must independently verify live provider response artifacts, reported usage, frozen task manifest and CAD validation before setting evidence.verified. This arithmetic does not authenticate those records.',
    evidence: { mode: evidence?.mode ?? null, verified: liveEvidenceVerified },
    plannedRoundAttempts: tasks.reduce((total, task) => total + roundCount(task) * repetitions * arms.length, 0),
    unexpectedRuns, perTask, perArm, perCategory,
    paired: { comparableTasks, incomparableTasks: plannedTasks - comparableTasks, cheaperTasks,
      cheaperShareOfPlannedTasks: cheaperTasks / plannedTasks, requiredCheaperTasks,
      claim99Supported, claimRule: 'At least 100 predefined tasks and 3 repetitions per arm. A task wins only if every required round in all repetitions of both arms passes validation with complete provider usage and timing, and the first arm has strictly lower median cumulative total tokens. Invalid and missing tasks remain in the full manifest denominator as non-wins. At least ceil(0.99 * plannedTasks) wins and independently verified live evidence are required.' } }
}
