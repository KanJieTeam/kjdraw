// Public, repeatable DEVELOPMENT stability test. Uses only synthetic drawings
// and existing frozen questions/oracles. Not a private-corpus, token-savings or
// independent-user benchmark. Earlier failing archives must never be replaced.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runGeologyUserScenarios } from './run-geology-user-scenarios.mjs'
import { FIXTURE_URL } from './generate-geology-user-scenarios.mjs'
import { assessScenarioReadiness } from './preflight-geology-user-scenarios.mjs'

const coreIds = Object.freeze([
  'GUS1-cad-query.raw-mtext-zh-direct',
  'GUS1-cad-persistence.undo-latest-commit-zh-direct',
  'GUS1-cad-persistence.redo-latest-undo-zh-direct',
  'GUS1-source-water-depth.collar-elevation-revision-zh-direct',
  'GUS1-source-strata.rename-and-reclassify-zh-direct',
  'GUS1-source-strata.split-column-interval-zh-direct',
  'GUS1-source-observation.move-sample-depth-zh-direct',
  'GUS1-source-section.split-with-explicit-correlations-zh-direct',
  'GUS1-source-section.create-supplied-section-zh-direct',
  'GUS1-investigation-point-layout.explicit-section-route-zh-direct',
  'GUS1-geological-presentation.declared-hatch-visibility-zh-direct',
  'GUS1-batch-historical-workflow.historical-dxf-note-revision-zh-direct',
])
const args = process.argv.slice(2)
const allowed = new Set(['--run', '--help', '--provider', '--model', '--repeats', '--output-dir', '--suite'])
const values = new Map()
for (let index = 0; index < args.length; index++) {
  const flag = args[index]
  if (!allowed.has(flag) || values.has(flag)) throw new Error('Unknown or duplicate option')
  if (flag === '--run' || flag === '--help') { values.set(flag, true); continue }
  const value = args[++index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`)
  values.set(flag, value)
}
const provider = values.get('--provider') ?? 'deepseek'
const model = values.get('--model') ?? 'deepseek-chat'
const repetitions = values.get('--repeats') ?? '5'
if (!/^[1-9]\d*$/u.test(repetitions) || Number(repetitions) > 20) throw new Error('--repeats must be 1..20')
const repeats = Number(repetitions)
const suite = values.get('--suite') ?? 'core'
if (!['core', 'natural-language', 'all-runnable', 'native-identity'].includes(suite)) throw new Error('--suite must be core, natural-language, native-identity or all-runnable')
// Existing frozen questions, not generated paraphrases or oracle replacements.
const readyCorpus = ['all-runnable', 'native-identity'].includes(suite)
  ? JSON.parse(await readFile(FIXTURE_URL, 'utf8')).scenarios : null
const ids = suite === 'all-runnable' ? Object.freeze(readyCorpus
  .filter(scenario => assessScenarioReadiness(scenario).status === 'runnable').map(scenario => scenario.id))
  : suite === 'native-identity' ? Object.freeze(readyCorpus
    .filter(scenario => scenario.id.startsWith('GUS1-cad-query.native-object-')
      && assessScenarioReadiness(scenario).status === 'runnable').map(scenario => scenario.id))
  : suite === 'core' ? coreIds : Object.freeze(coreIds.flatMap(id =>
  ['-zh-casual', '-en-direct'].map(suffix => id.replace(/-zh-direct$/u, suffix))))
const protocol = { provider, requestedModel: model, repeats, suite, scenarioIds: ids,
  ...(suite === 'all-runnable' ? { corpusQuestions: readyCorpus.length,
    notReadyQuestions: readyCorpus.length - ids.length,
    readinessNote: 'Not-ready questions are not executed and never counted as passes. A transport halt or exhausted request budget fails the run.' } : {}),
  answerContractVersion: 'v5', answerEncoding: 'json-object', maxRequestsPerRepeat: Math.min(2000, ids.length * 10),
  scope: 'Development stability on fixed public synthetic questions; programmatic exact-oracle review, not independent human acceptance. No token-savings control group or general 100% claim.' }
if (!values.has('--run') || values.has('--help')) {
  console.log(JSON.stringify({ mode: 'dry-run', modelCalls: 0,
    usage: 'Set the existing provider environment key (never a CLI argument), then: node scripts/testing/run-geology-stability.mjs --run --repeats 5 --output-dir .cache/geology-stability-new-run. Add --suite natural-language for 24 fixed colloquial Chinese and English questions, --suite native-identity for all six frozen native-object read variants, or --suite all-runnable --repeats 1 for every currently executable frozen question; default core has 12.',
    ...protocol }, null, 2))
} else {
  const destination = values.get('--output-dir')
  if (!destination) throw new Error('--run requires a NEW --output-dir; existing evidence is never overwritten')
  const folder = resolve(destination)
  await mkdir(folder)
  const archive = (file, value) => writeFile(resolve(folder, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  await archive('selection.json', protocol)
  const reports = []
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const report = await runGeologyUserScenarios({ provider, model, scenarioIds: ids,
      maxScenarios: ids.length, maxRequests: protocol.maxRequestsPerRepeat,
      answerContractVersion: protocol.answerContractVersion, answerEncoding: protocol.answerEncoding,
      onProgress: row => console.log(JSON.stringify({ repeat, ...row })),
      onModelResponse: diagnostic => archive(`provider-${repeat}-${diagnostic.request}.json`, diagnostic),
      onScenarioResult: ({ scenario, result, evidence, oracle }) => archive(
        `pending-${repeat}-${ids.indexOf(scenario.id)}.json`, { id: scenario.id, status: result.status,
          text: result.text, oracle, toolCalls: evidence.toolCalls, proposal: evidence.proposal }),
    })
    await archive(`repeat-${repeat}.json`, report)
    reports.push(report)
    if (report.haltReason) break
  }
  const summary = { ...protocol, executedRepeats: reports.length,
    sameSurface: reports.length > 0 && reports.every(row => row.executionSurfaceSha256 === reports[0].executionSurfaceSha256),
    executed: reports.reduce((n, row) => n + row.executed, 0),
    passed: reports.reduce((n, row) => n + row.passed, 0), failed: reports.reduce((n, row) => n + row.failed, 0),
    requests: reports.reduce((n, row) => n + row.requests, 0),
    returnedModels: [...new Set(reports.flatMap(row => row.returnedModels))],
    failures: reports.flatMap((row, index) => row.scenarios.filter(scenario => scenario.passed === false)
      .map(scenario => ({ repeat: index + 1, id: scenario.id, reason: scenario.reason }))),
    allSelectedPassed: reports.length === repeats && reports.every(row => row.allSelectedPassed),
  }
  await archive('summary.json', summary)
  console.log(JSON.stringify(summary))
  if (!summary.allSelectedPassed || !summary.sameSurface || summary.executed !== ids.length * repeats) process.exitCode = 1
}
