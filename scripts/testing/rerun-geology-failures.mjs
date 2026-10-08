// New executions only. Original questions, V5 prompts and exact oracle are kept.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runGeologyUserScenarios } from './run-geology-user-scenarios.mjs'
import { FIXTURE_URL } from './generate-geology-user-scenarios.mjs'

const options = new Map(), args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const flag = args[i]
  if (!['--run', '--baseline', '--output-dir', '--intent', '--repeats'].includes(flag) || options.has(flag)) throw new Error('Unknown or duplicate option')
  if (flag === '--run') { options.set(flag, true); continue }
  const value = args[++i]
  if (!value || value.startsWith('--')) throw new Error('Missing option value')
  options.set(flag, value)
}
if (!options.has('--baseline')) throw new Error('--baseline requires the original failed repeat JSON')
const raw = await readFile(resolve(options.get('--baseline')), 'utf8'), baseline = JSON.parse(raw)
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
if (!Array.isArray(baseline.scenarios)) throw new Error('Missing baseline scenario results')
const questions = new Map(corpus.scenarios.map(row => [row.id, row]))
const ids = baseline.scenarios.filter(row => row.passed === false && (!options.has('--intent') || row.intent === options.get('--intent'))).map(row => row.id)
if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !questions.has(id))) throw new Error('No unique frozen failed questions selected')
const repeatsText = options.get('--repeats') ?? '1'
if (!/^[1-9]\d*$/u.test(repeatsText) || Number(repeatsText) > 20) throw new Error('--repeats must be 1..20')
const selection = { version: 'geology-original-v5-failure-rerun-v1', baselineSha256: createHash('sha256').update(raw).digest('hex'),
  entrySha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), scenarioIds: ids,
  repeats: Number(repeatsText), maxRequestsPerRepeat: Math.min(2000, ids.length * 10), answerContractVersion: 'v5', answerEncoding: 'json-object',
  scope: 'Post-repair executions of selected old failures. Not a full-corpus acceptance, held-out or token-savings result. Never rescoring or overwriting previous evidence.' }
if (!options.has('--run')) {
  console.log(JSON.stringify({ mode: 'dry-run', modelCalls: 0, ...selection }))
} else {
  if (!options.has('--output-dir')) throw new Error('--run requires a NEW output directory')
  const folder = resolve(options.get('--output-dir'))
  await mkdir(folder)
  const archive = (name, value) => writeFile(resolve(folder, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  await archive('selection.json', selection)
  const reports = []
  for (let repeat = 1; repeat <= selection.repeats; repeat++) {
    const report = await runGeologyUserScenarios({ provider: 'deepseek', model: 'deepseek-chat', scenarioIds: ids,
      maxScenarios: ids.length, maxRequests: selection.maxRequestsPerRepeat, answerContractVersion: 'v5', answerEncoding: 'json-object',
      onProgress: row => console.log(JSON.stringify({ repeat, ...row })),
      onModelResponse: row => archive(`provider-${repeat}-${row.request}.json`, row),
      onScenarioResult: ({ scenario, result, evidence, oracle }) => archive(`pending-${repeat}-${ids.indexOf(scenario.id)}.json`,
        { id: scenario.id, status: result.status, text: result.text, oracle, toolCalls: evidence.toolCalls, proposal: evidence.proposal }),
    })
    await archive(`repeat-${repeat}.json`, report); reports.push(report)
    if (report.haltReason) break
  }
  const total = key => reports.reduce((sum, row) => sum + row[key], 0)
  const summary = { ...selection, executedRepeats: reports.length, executed: total('executed'), passed: total('passed'), failed: total('failed'), requests: total('requests'),
    sameSurface: reports.length > 0 && reports.every(row => row.executionSurfaceSha256 === reports[0].executionSurfaceSha256),
    executionSurfaceSha256: reports[0]?.executionSurfaceSha256 ?? null, returnedModels: [...new Set(reports.flatMap(row => row.returnedModels))],
    failures: reports.flatMap((report, index) => report.scenarios.filter(row => row.passed === false).map(row => ({ repeat: index + 1, id: row.id, reason: row.reason,
      failedChecks: row.assertions.filter(check => !check.satisfied).map(check => check.id) }))),
    allSelectedPassed: reports.length === selection.repeats && reports.every(row => row.allSelectedPassed) }
  await archive('summary.json', summary); console.log(JSON.stringify(summary))
  if (!summary.allSelectedPassed || !summary.sameSurface) process.exitCode = 1
}
