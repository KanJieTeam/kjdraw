// A separately versioned read-only experiment, not a rescore of old V5 runs.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runSourceDriftInspectionV6Scenarios, SOURCE_DRIFT_INSPECTION_V6_PROTOCOL,
  SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS } from './helpers/geology-source-drift-inspection-v6-oracles.mjs'

const args = process.argv.slice(2), options = new Map()
const flags = new Set(['--run', '--help', '--provider', '--model', '--repeats', '--output-dir'])
for (let index = 0; index < args.length; index++) {
  const flag = args[index]
  if (!flags.has(flag) || options.has(flag)) throw new Error('Unknown or duplicate option')
  if (flag === '--run' || flag === '--help') { options.set(flag, true); continue }
  const value = args[++index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`)
  options.set(flag, value)
}
const repetition = options.get('--repeats') ?? '5'
if (!/^[1-9]\d*$/u.test(repetition) || Number(repetition) > 20) throw new Error('--repeats must be 1..20')
const entrySha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')
const selection = { provider: options.get('--provider') ?? 'deepseek', requestedModel: options.get('--model') ?? 'deepseek-chat',
  repeats: Number(repetition), scenarioIds: SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS, maxRequestsPerRepeat: 60,
  entrySha256, protocol: SOURCE_DRIFT_INSPECTION_V6_PROTOCOL }
if (!options.has('--run') || options.has('--help')) {
  console.log(JSON.stringify({ mode: 'dry-run', modelCalls: 0, ...selection,
    usage: 'Use the existing provider environment key, never a CLI key argument. Paid run: node scripts/testing/run-geology-source-drift-inspection.mjs --run --repeats 5 --output-dir .cache/geology-source-drift-new. New V6 verdicts and unchanged V5 verdicts are retained together; no archived failure is replaced.' }, null, 2))
} else {
  const destination = options.get('--output-dir')
  if (!destination) throw new Error('--run requires a NEW --output-dir')
  const folder = resolve(destination)
  await mkdir(folder)
  const archive = (name, value) => writeFile(resolve(folder, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  await archive('selection.json', selection)
  const reports = []
  for (let repeat = 1; repeat <= selection.repeats; repeat++) {
    const report = await runSourceDriftInspectionV6Scenarios({ provider: selection.provider, model: selection.requestedModel,
      maxRequests: selection.maxRequestsPerRepeat,
      onProgress: row => console.log(JSON.stringify({ repeat, ...row })),
      onModelResponse: row => archive(`provider-${repeat}-${row.request}.json`, row),
      onScenarioResult: ({ scenario, result, evidence, oracle, legacyOracle }) => archive(
        `pending-${repeat}-${selection.scenarioIds.indexOf(scenario.id)}.json`, { id: scenario.id, status: result.status,
          text: result.text, oracle, legacyOracle, toolCalls: evidence.toolCalls }),
    })
    await archive(`repeat-${repeat}.json`, report)
    reports.push(report)
    if (report.haltReason) break
  }
  const total = field => reports.reduce((count, row) => count + row[field], 0)
  const summary = { ...selection, executedRepeats: reports.length, executed: total('executed'),
    passed: total('passed'), failed: total('failed'), requests: total('requests'),
    sameSurface: reports.length > 0 && reports.every(row => row.executionSurfaceSha256 === reports[0].executionSurfaceSha256),
    executionSurfaceSha256: reports[0]?.executionSurfaceSha256 ?? null,
    returnedModels: [...new Set(reports.flatMap(row => row.returnedModels))],
    haltReason: reports.find(row => row.haltReason)?.haltReason ?? null,
    legacyV5SameExecutionSummary: { passed: reports.reduce((n, row) => n + row.legacyV5SameExecutionSummary.passed, 0),
      failed: reports.reduce((n, row) => n + row.legacyV5SameExecutionSummary.failed, 0) },
    failures: reports.flatMap((row, index) => row.scenarios.filter(scenario => scenario.passed === false)
      .map(scenario => ({ repeat: index + 1, id: scenario.id, reason: scenario.reason,
        failedChecks: scenario.assertions.filter(check => !check.satisfied).map(check => check.id) }))),
    allSelectedPassed: reports.length === selection.repeats && reports.every(row => row.allSelectedPassed) }
  await archive('summary.json', summary)
  console.log(JSON.stringify(summary))
  if (!summary.allSelectedPassed || !summary.sameSurface || summary.executed !== selection.scenarioIds.length * selection.repeats)
    process.exitCode = 1
}
