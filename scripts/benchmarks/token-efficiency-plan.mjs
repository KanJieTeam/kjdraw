// Read-only execution budget for the frozen task corpus. No provider calls.
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tokenEfficiencyTaskCorpus } from './token-efficiency-task-corpus.mjs'

const integer = value => Number.isSafeInteger(value) && value > 0

export function tokenEfficiencyPlan({ tasks = tokenEfficiencyTaskCorpus, repetitions = 3, models = 3, arms = 2 } = {}) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.some(task => typeof task?.id !== 'string' || !task.id || !Array.isArray(task.rounds) || !task.rounds.length)) throw new TypeError('A fixed task manifest with nonempty rounds is required')
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new TypeError('Duplicate task ID')
  if (![repetitions, models, arms].every(integer)) throw new TypeError('Positive integer repetitions, models and arms required')
  const rounds = tasks.reduce((total, task) => total + task.rounds.length, 0)
  const plannedRequests = rounds * repetitions * models * arms
  if (!Number.isSafeInteger(plannedRequests)) throw new RangeError('Request budget overflow')
  const categories = Object.fromEntries([...new Set(tasks.map(task => task.category ?? 'unspecified'))].map(category => {
    const selected = tasks.filter(task => (task.category ?? 'unspecified') === category)
    return [category, { tasks: selected.length, rounds: selected.reduce((total, task) => total + task.rounds.length, 0) }]
  }))
  const corpusSha256 = createHash('sha256').update(JSON.stringify(tasks)).digest('hex')
  return Object.freeze({ mode: 'dry-run', taskCount: tasks.length, roundCount: rounds, repetitions,
    models, arms, requestsPerModel: rounds * repetitions * arms, plannedRequests,
    categories, corpusSha256, modelCallsMade: 0,
    note: 'Budget only. This does not prove tool coverage, model validity, token savings, or safe execution of generated code.' })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('This command is dry-run only and takes no live-model arguments')
  process.stdout.write(`${JSON.stringify(tokenEfficiencyPlan(), null, 2)}\n`)
}
