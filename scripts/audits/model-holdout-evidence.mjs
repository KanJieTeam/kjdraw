import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { benchmarkPricing, benchmarkRunCost } from '../benchmarks/paired-model-benchmark.mjs'
import { releaseHoldoutBehavioralTasks, releaseHoldoutGenerationTasks } from '../benchmarks/release-holdout-task-suite.mjs'

export const MODEL_HOLDOUT_MANIFEST_SCHEMA = 'com.kanjie.kjdraw.audit.three-model-holdout-input@1'
export const MODEL_HOLDOUT_EVIDENCE_SCHEMA = 'com.kanjie.kjdraw.audit.three-model-holdout@1'
export const MODEL_HOLDOUT_MINIMUM_REPETITIONS = 5
export const MODEL_HOLDOUT_MINIMUM_RATE = 0.95
export const MODEL_HOLDOUT_MINIMUM_RUNTIME_ENVIRONMENTS = 2

const sha = value => createHash('sha256').update(value).digest('hex')
const shaText = value => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const text = (value, label, maximum = 256) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\r\n]/.test(value)) throw new Error(`${label} is invalid`)
  return value.trim()
}
const equalNumber = (actual, expected) => finite(actual) && Math.abs(actual - expected) <= 1e-6
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }

function validateIdentity(value, options) {
  requireValue(value?.schema === MODEL_HOLDOUT_MANIFEST_SCHEMA, 'Invalid model holdout manifest schema')
  const repository = text(value.repository, 'Repository')
  const commit = text(value.commit, 'Candidate commit', 40)
  const packageName = text(value.package?.name, 'Package name')
  const packageVersion = text(value.package?.version, 'Package version')
  requireValue(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'Repository must be owner/name')
  requireValue(/^[0-9a-f]{40}$/i.test(commit), 'Candidate commit must be a full SHA')
  if (options?.repository !== undefined) requireValue(repository === options.repository, 'Model holdout repository does not match the candidate')
  if (options?.commit !== undefined) requireValue(commit === options.commit, 'Model holdout commit does not match the candidate')
  if (options?.packageName !== undefined) requireValue(packageName === options.packageName, 'Model holdout package does not match the candidate')
  if (options?.packageVersion !== undefined) requireValue(packageVersion === options.packageVersion, 'Model holdout version does not match the candidate')
  return { repository, commit, packageName, packageVersion }
}

async function sdkRuntimeSha256() {
  const folder = new URL('../../packages/kjdraw-sdk/src/', import.meta.url), digest = createHash('sha256')
  for (const name of (await readdir(folder, { recursive: true })).map(name => name.replaceAll('\\', '/')).filter(name => name.endsWith('.js')).sort()) {
    digest.update(name); digest.update(await readFile(new URL(name, folder)))
  }
  return digest.digest('hex')
}

async function expectedSources() {
  const files = {
    'paired-model-benchmark.mjs': new URL('../benchmarks/paired-model-benchmark.mjs', import.meta.url),
    'release-holdout-behavioral-runner.mjs': new URL('../benchmarks/release-holdout-behavioral-runner.mjs', import.meta.url),
    'release-holdout-task-suite.mjs': new URL('../benchmarks/release-holdout-task-suite.mjs', import.meta.url),
    'release-holdout-validator.py': new URL('../benchmarks/release-holdout-validator.py', import.meta.url),
    'chat-model-settings.js': new URL('../../apps/playground/chat-model-settings.js', import.meta.url),
    'model-usage.js': new URL('../../packages/kjdraw-sdk/src/model-usage.js', import.meta.url),
  }
  const result = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, url]) => [name, sha(await readFile(url))])))
  result.sdkRuntimeSha256 = await sdkRuntimeSha256()
  return result
}

function validateSource(report, requiredNames, expected, label) {
  for (const name of [...requiredNames, 'model-usage.js', 'sdkRuntimeSha256']) requireValue(report.source?.[name] === expected[name], `${label} source fingerprint mismatch: ${name}`)
}

function validateEndpoint(report, label) {
  let url
  try { url = new URL(report.endpointOrigin) } catch { throw new Error(`${label} endpoint origin is invalid`) }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), `${label} must use a remote HTTPS endpoint`)
  requireValue(url.origin === report.endpointOrigin, `${label} endpoint must contain only an origin`)
}

function validateUsage(usage, label) {
  for (const name of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadInputTokens']) requireValue(count(usage?.[name]), `${label} ${name} is unknown`)
  requireValue(usage.totalTokens === usage.inputTokens + usage.outputTokens, `${label} total token count is inconsistent`)
  requireValue(usage.cacheReadInputTokens <= usage.inputTokens, `${label} cache token count exceeds input tokens`)
  return usage
}

function validatePricingAndCost(usage, pricing, cost, label) {
  if (pricing === null) {
    requireValue(cost === null, `${label} cost must remain unknown without explicit pricing`)
    return
  }
  const expected = benchmarkRunCost(usage, benchmarkPricing(pricing))
  requireValue(expected !== null && cost?.currency === expected.currency && equalNumber(cost.amount, expected.amount), `${label} cost does not match explicit pricing`)
  for (const name of ['uncachedInputTokens', 'cachedInputTokens', 'outputTokens']) requireValue(cost[name] === expected[name], `${label} cost token split is inconsistent`)
  requireValue(JSON.stringify(cost.ratesPerMillion) === JSON.stringify(expected.ratesPerMillion), `${label} cost rates are inconsistent`)
}

async function validateFile(directory, name, expectedSha, label) {
  requireValue(typeof name === 'string' && name && !isAbsolute(name), `${label} artifact path is invalid`)
  const path = resolve(directory, name)
  requireValue(relative(directory, path) && !relative(directory, path).startsWith('..') && !isAbsolute(relative(directory, path)), `${label} artifact escapes its report directory`)
  requireValue(shaText(expectedSha), `${label} artifact hash is invalid`)
  let bytes
  try { bytes = await readFile(path) } catch { throw new Error(`${label} artifact is missing`) }
  requireValue(sha(bytes) === expectedSha.toLowerCase(), `${label} artifact hash mismatch`)
}

function expectedTaskMap(tasks) { return new Map(tasks.map(task => [task.id, task])) }
function validateTaskRows(rows, tasks, label) {
  requireValue(Array.isArray(rows) && rows.length === tasks.length, `${label} must contain the complete task list`)
  const expected = expectedTaskMap(tasks)
  requireValue(new Set(rows.map(row => row.id)).size === rows.length, `${label} contains duplicate tasks`)
  for (const row of rows) {
    const task = expected.get(row.id)
    requireValue(task && row.version === task.version && row.category === task.category && row.acceptanceSha256 === task.acceptanceSha256 && isDeepStrictEqual(row.budget, task.budget), `${label} task identity mismatch: ${row.id ?? 'unknown'}`)
  }
}

function validateRunIdentity(run, task, repetition, requestedModel, returnedModel, label) {
  requireValue(run.taskVersion === task.version && run.taskCategory === task.category && run.acceptanceSha256 === task.acceptanceSha256, `${label} task metadata mismatch`)
  requireValue(run.repetition === repetition, `${label} repetition mismatch`)
  requireValue(run.requestedModel === requestedModel, `${label} requested model mismatch`)
  requireValue(run.returnedModel === returnedModel, `${label} returned model mismatch`)
  requireValue(count(run.humanInterventionCount), `${label} human intervention count is unknown`)
  requireValue(finite(run.totalMs), `${label} total duration is unknown`)
}

async function validateGeneration(report, directory, model, expected) {
  requireValue(report?.schema === 'com.kanjie.kjdraw.benchmark.paired-model@1' && report.mode === 'live' && report.exploratory === false && report.fixtureWarning === null, 'Generation report is not a non-exploratory live run')
  requireValue(report.taskSuite === 'release-holdout-generation' && report.status === 'complete', 'Generation report did not finish the release holdout suite')
  requireValue(report.repetitions >= MODEL_HOLDOUT_MINIMUM_REPETITIONS && count(report.repetitions), 'Generation report needs at least five repetitions')
  const planned = releaseHoldoutGenerationTasks.length * 2 * report.repetitions
  requireValue(report.plannedRequests === planned && report.attemptedRequests === planned && report.unexecutedRequests === 0 && report.runs?.length === planned, 'Generation report is incomplete')
  requireValue(report.model === model.requestedModel && report.consistentReturnedModel === true && JSON.stringify(report.returnedModels) === JSON.stringify([model.returnedModel]), 'Generation model identity is inconsistent')
  validateEndpoint(report, 'Generation report')
  requireValue(typeof report.timingDefinition === 'string' && report.timingDefinition && typeof report.latencyDefinition === 'string' && report.latencyDefinition, 'Generation timing definitions are missing')
  validateTaskRows(report.tasks, releaseHoldoutGenerationTasks, 'Generation report')
  validateSource(report, ['paired-model-benchmark.mjs', 'release-holdout-task-suite.mjs', 'release-holdout-validator.py', 'chat-model-settings.js'], expected, 'Generation report')
  for (const [kind, validatorName] of [['manufacturing', 'ezdxf-manufacturing'], ['release-holdout', 'ezdxf-release-holdout']]) requireValue(report.validator?.[kind]?.validator === validatorName && typeof report.validator[kind].version === 'string', `Generation independent ${kind} validator is missing`)
  const tasks = expectedTaskMap(releaseHoldoutGenerationTasks), seen = new Set(), successful = []
  let interventionTotal = 0, kjdrawInterventionTotal = 0, totalMs = 0, transportMs = 0
  for (const run of report.runs) {
    const task = tasks.get(run.taskId), label = `Generation ${run.taskId ?? 'unknown'}/${run.arm ?? 'unknown'}/${run.repetition ?? 'unknown'}`
    requireValue(task && ['kjdraw-tool', 'direct-dxf'].includes(run.arm), `${label} is unplanned`)
    const key = `${run.taskId}\0${run.arm}\0${run.repetition}`
    requireValue(!seen.has(key), `${label} is duplicated`); seen.add(key)
    validateRunIdentity(run, task, run.repetition, model.requestedModel, model.returnedModel, label)
    requireValue(run.repetition >= 1 && run.repetition <= report.repetitions, `${label} repetition is out of range`)
    requireValue(typeof run.validation?.passed === 'boolean', `${label} lacks independent geometry judgment`)
    requireValue(typeof run.budgetCompliance?.passed === 'boolean', `${label} lacks budget judgment`)
    validateUsage(run.usage, label); validatePricingAndCost(run.usage, report.pricing, run.cost, label)
    requireValue(finite(run.transportLatencyMs), `${label} transport duration is unknown`)
    requireValue(isDeepStrictEqual(run.budget, task.budget) && count(run.modelToolCallCount), `${label} budget inputs are incomplete`)
    const observed = run.budgetCompliance.observed
    requireValue(observed?.inputTokens === run.usage.inputTokens && observed?.outputTokens === run.usage.outputTokens && observed?.toolCalls === run.modelToolCallCount && observed?.wallTimeMs === run.totalMs && observed?.humanInterventions === run.humanInterventionCount, `${label} budget observation is inconsistent`)
    const withinBudget = run.usage.inputTokens <= task.budget.maxInputTokens && run.usage.outputTokens <= task.budget.maxOutputTokens && run.modelToolCallCount <= task.budget.maxToolCalls && run.totalMs <= task.budget.maxWallTimeMs && run.humanInterventionCount <= task.budget.maxHumanInterventions
    requireValue(run.budgetCompliance.passed === withinBudget, `${label} budget decision is inconsistent`)
    requireValue(run.humanInterventionEvidence === 'noninteractive-harness', `${label} human intervention source is missing`)
    await validateFile(directory, run.files?.request, run.requestSha256, `${label} request`)
    await validateFile(directory, run.files?.response, run.responseSha256, `${label} response`)
    await validateFile(directory, run.files?.dxf, run.dxfSha256, `${label} DXF`)
    const passed = run.status === 'passed' && run.validation.passed === true && run.budgetCompliance.passed === true
    if (run.arm === 'kjdraw-tool') {
      successful.push({ task, passed }); kjdrawInterventionTotal += run.humanInterventionCount; totalMs += run.totalMs; transportMs += run.transportLatencyMs
    }
    interventionTotal += run.humanInterventionCount
  }
  requireValue(seen.size === planned, 'Generation report does not cover every task, arm and repetition')
  requireValue(report.humanInterventionCount === interventionTotal, 'Generation intervention aggregate is inconsistent')
  validatePricingAndCostAggregate(report, 'Generation report')
  return { repetitions: report.repetitions, successful, humanInterventionCount: kjdrawInterventionTotal, totalMs, providerLatencyMs: transportMs }
}

function sumUsage(values) {
  return Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadInputTokens'].map(name => [name, values.reduce((sum, value) => sum + value[name], 0)]))
}

function validatePricingAndCostAggregate(report, label) {
  if (report.pricing === null) requireValue(report.cost === null, `${label} aggregate cost must be unknown without explicit pricing`)
  else {
    const costs = report.runs.map(run => run.cost)
    requireValue(costs.every(Boolean) && report.cost?.currency === costs[0].currency && equalNumber(report.cost.amount, costs.reduce((sum, cost) => sum + cost.amount, 0)), `${label} aggregate cost is inconsistent`)
  }
}

async function validateBehavioral(report, directory, model, expected) {
  requireValue(report?.schema === 'com.kanjie.kjdraw.benchmark.behavioral-suite@2' && report.mode === 'live' && report.fixtureWarning === null, 'Behavioral report is not a live run')
  requireValue(['complete', 'failed'].includes(report.status), 'Behavioral report did not reach a terminal state')
  requireValue(report.repetitions >= MODEL_HOLDOUT_MINIMUM_REPETITIONS && count(report.repetitions), 'Behavioral report needs at least five repetitions')
  const planned = releaseHoldoutBehavioralTasks.length * report.repetitions
  requireValue(report.plannedRuns === planned && report.attemptedRuns === planned && report.unexecutedRuns === 0 && report.runs?.length === planned, 'Behavioral report is incomplete')
  requireValue(report.model === model.requestedModel && report.consistentReturnedModel === true && JSON.stringify(report.returnedModels) === JSON.stringify([model.returnedModel]), 'Behavioral model identity is inconsistent')
  validateEndpoint(report, 'Behavioral report')
  requireValue(typeof report.timingDefinition === 'string' && report.timingDefinition && typeof report.latencyDefinition === 'string' && report.latencyDefinition, 'Behavioral timing definitions are missing')
  validateTaskRows(report.tasks, releaseHoldoutBehavioralTasks, 'Behavioral report')
  validateSource(report, ['release-holdout-behavioral-runner.mjs', 'release-holdout-task-suite.mjs', 'paired-model-benchmark.mjs', 'chat-model-settings.js'], expected, 'Behavioral report')
  const tasks = expectedTaskMap(releaseHoldoutBehavioralTasks), seen = new Set(), successful = []
  let interventionTotal = 0, totalMs = 0, providerLatencyMs = 0
  for (const run of report.runs) {
    const task = tasks.get(run.taskId), label = `Behavioral ${run.taskId ?? 'unknown'}/${run.repetition ?? 'unknown'}`
    requireValue(task, `${label} is unplanned`)
    const key = `${run.taskId}\0${run.repetition}`
    requireValue(!seen.has(key), `${label} is duplicated`); seen.add(key)
    requireValue(run.taskVersion === task.version && run.taskCategory === task.category && run.acceptanceSha256 === task.acceptanceSha256 && run.repetition >= 1 && run.repetition <= report.repetitions, `${label} task identity mismatch`)
    requireValue(JSON.stringify(run.requestedModels) === JSON.stringify([model.requestedModel]) && JSON.stringify(run.returnedModels) === JSON.stringify([model.returnedModel]), `${label} model identity mismatch`)
    requireValue(count(run.humanInterventionCount) && finite(run.totalMs) && finite(run.providerLatencyMs), `${label} duration or intervention count is unknown`)
    requireValue(count(run.modelToolCallCount) && Array.isArray(run.humanInterventionEvents) && run.humanInterventionEvents.length === run.humanInterventionCount, `${label} intervention or tool-call evidence is incomplete`)
    requireValue(typeof run.state?.passed === 'boolean' && typeof run.budget?.passed === 'boolean' && typeof run.reopenStateMatches === 'boolean', `${label} lacks independent behavior/save-reopen judgment`)
    requireValue(Array.isArray(run.turnStates) && run.turnStates.length === task.turns.length && run.turnStates.every(turn => typeof turn.passed === 'boolean'), `${label} lacks per-turn behavior judgment`)
    requireValue(Array.isArray(run.responses) && run.responses.length === task.turns.length, `${label} response evidence is incomplete`)
    const responseUsage = []
    for (const [index, response] of run.responses.entries()) {
      const responseLabel = `${label} response ${index + 1}`
      requireValue(response.requestedModel === model.requestedModel && response.returnedModel === model.returnedModel && finite(response.transportLatencyMs), `${responseLabel} identity or duration is invalid`)
      responseUsage.push(validateUsage(response.usage, responseLabel))
      await validateFile(directory, response.files?.request, response.requestSha256, `${responseLabel} request`)
      await validateFile(directory, response.files?.response, response.responseSha256, `${responseLabel} response`)
    }
    const aggregateUsage = sumUsage(responseUsage)
    validateUsage(run.usage, label)
    for (const name of Object.keys(aggregateUsage)) requireValue(run.usage[name] === aggregateUsage[name], `${label} usage aggregate is inconsistent`)
    validatePricingAndCost(run.usage, report.pricing, run.cost, label)
    const observed = run.budget.observed
    requireValue(observed?.inputTokens === run.usage.inputTokens && observed?.outputTokens === run.usage.outputTokens && observed?.toolCalls === run.modelToolCallCount && observed?.wallTimeMs === run.totalMs && observed?.humanInterventions === run.humanInterventionCount, `${label} budget observation is inconsistent`)
    const withinBudget = run.usage.inputTokens <= task.budget.maxInputTokens && run.usage.outputTokens <= task.budget.maxOutputTokens && run.modelToolCallCount <= task.budget.maxToolCalls && run.totalMs <= task.budget.maxWallTimeMs && run.humanInterventionCount <= task.budget.maxHumanInterventions
    requireValue(run.budget.passed === withinBudget, `${label} budget decision is inconsistent`)
    await validateFile(directory, run.files?.seedKjd, run.seedKjdSha256, `${label} seed KJD`)
    await validateFile(directory, run.files?.finalKjd, run.finalKjdSha256, `${label} final KJD`)
    const passed = run.status === 'passed' && run.state.passed === true && run.budget.passed === true && run.reopenStateMatches === true && run.turnStates.every(turn => turn.passed)
    successful.push({ task, passed })
    interventionTotal += run.humanInterventionCount; totalMs += run.totalMs; providerLatencyMs += run.providerLatencyMs
  }
  requireValue(seen.size === planned, 'Behavioral report does not cover every task and repetition')
  requireValue(report.humanInterventionCount === interventionTotal, 'Behavioral intervention aggregate is inconsistent')
  requireValue(report.humanInterventionLedger?.eventCount === interventionTotal && shaText(report.humanInterventionLedger?.sourceSha256), 'Behavioral intervention ledger is inconsistent')
  const aggregateUsage = sumUsage(report.runs.map(run => run.usage))
  for (const name of Object.keys(aggregateUsage)) requireValue(report.usage?.[name] === aggregateUsage[name], `Behavioral report ${name} aggregate is inconsistent`)
  requireValue(equalNumber(report.totalMs, totalMs) && equalNumber(report.providerLatencyMs, providerLatencyMs), 'Behavioral duration aggregates are inconsistent')
  validatePricingAndCostAggregate(report, 'Behavioral report')
  return { repetitions: report.repetitions, successful, humanInterventionCount: interventionTotal, totalMs, providerLatencyMs }
}

function validateRuntimeEnvironment(entry, generation, behavioral, label) {
  const environment = entry.runtimeEnvironment
  requireValue(environment?.kind === 'node-sdk', `${label} runtime kind must identify the node-sdk benchmark entry point`)
  requireValue(['win32', 'linux', 'darwin'].includes(environment.platform), `${label} runtime platform is invalid`)
  requireValue(typeof environment.architecture === 'string' && /^[A-Za-z0-9_-]{2,32}$/.test(environment.architecture), `${label} runtime architecture is invalid`)
  requireValue(typeof environment.node === 'string' && /^v\d+\.\d+\.\d+$/.test(environment.node), `${label} Node runtime is invalid`)
  for (const [name, report] of [['generation', generation], ['behavioral', behavioral]]) {
    requireValue(report.runtime?.node === environment.node && report.runtime?.platform === environment.platform && report.runtime?.architecture === environment.architecture, `${label} ${name} report runtime does not match the declared environment`)
  }
  return { kind: environment.kind, platform: environment.platform, architecture: environment.architecture, node: environment.node }
}

function rate(records) { return records.filter(record => record.passed).length / records.length }
const standardCategories = new Set(['simple-construction', 'complex-mechanical', 'architecture', 'site-pipeline', 'continuous-modification', 'error-correction'])

export async function buildModelHoldoutEvidence(manifest, options = {}) {
  const identity = validateIdentity(manifest, options)
  requireValue(Array.isArray(manifest.models) && manifest.models.length === 3, 'Exactly three model configurations are required')
  const ids = new Set(), vendors = new Set(), requested = new Set(), classifications = [], runtimeTypes = new Set()
  const baseDirectory = options.baseDirectory ? resolve(options.baseDirectory) : process.cwd(), expected = await expectedSources(), summaries = []
  for (const entry of manifest.models) {
    const id = text(entry.id, 'Model configuration id', 96), vendorId = text(entry.vendor?.id, 'Vendor id', 96), vendorName = text(entry.vendor?.name, 'Vendor name', 160)
    const classification = entry.vendor?.classification
    requireValue(['domestic-cn', 'international'].includes(classification), `Model ${id} needs an explicit supported vendor classification`)
    const requestedModel = text(entry.requestedModel, 'Requested model'), returnedModel = text(entry.returnedModel, 'Returned model')
    requireValue(!ids.has(id) && !vendors.has(vendorId) && !requested.has(requestedModel), 'Model configurations, vendors and requested models must be distinct')
    ids.add(id); vendors.add(vendorId); requested.add(requestedModel); classifications.push(classification)
    const generationPath = resolve(baseDirectory, text(entry.generationReport, 'Generation report path', 1024)), behavioralPath = resolve(baseDirectory, text(entry.behavioralReport, 'Behavioral report path', 1024))
    const generationBytes = await readFile(generationPath), behavioralBytes = await readFile(behavioralPath)
    requireValue(shaText(entry.generationReportSha256) && sha(generationBytes) === entry.generationReportSha256.toLowerCase(), `Generation report hash mismatch for ${id}`)
    requireValue(shaText(entry.behavioralReportSha256) && sha(behavioralBytes) === entry.behavioralReportSha256.toLowerCase(), `Behavioral report hash mismatch for ${id}`)
    let generation, behavioral
    try { generation = JSON.parse(generationBytes); behavioral = JSON.parse(behavioralBytes) } catch { throw new Error(`Report JSON is invalid for ${id}`) }
    const runtimeEnvironment = validateRuntimeEnvironment(entry, generation, behavioral, `Model ${id}`)
    runtimeTypes.add(runtimeEnvironment.platform)
    const model = { requestedModel, returnedModel }
    const generationResult = await validateGeneration(generation, dirname(generationPath), model, expected)
    const behavioralResult = await validateBehavioral(behavioral, dirname(behavioralPath), model, expected)
    requireValue(generationResult.repetitions === behavioralResult.repetitions, `Model ${id} reports use different repetition counts`)
    requireValue(JSON.stringify(generation.pricing) === JSON.stringify(behavioral.pricing), `Model ${id} reports use different pricing declarations`)
    const records = [...generationResult.successful, ...behavioralResult.successful], standard = records.filter(record => standardCategories.has(record.task.category))
    const overallRate = rate(records), standardRate = rate(standard)
    requireValue(overallRate >= MODEL_HOLDOUT_MINIMUM_RATE, `Model ${id} overall completion is below 95%`)
    requireValue(standardRate >= MODEL_HOLDOUT_MINIMUM_RATE, `Model ${id} standard-task completion is below 95%`)
    const kjdrawGenerationRuns = generation.runs.filter(run => run.arm === 'kjdraw-tool')
    const cost = generation.pricing === null ? null : {
      currency: generation.pricing.currency,
      amount: Number((kjdrawGenerationRuns.reduce((sum, run) => sum + run.cost.amount, 0) + behavioral.runs.reduce((sum, run) => sum + run.cost.amount, 0)).toFixed(12)),
    }
    summaries.push({
      id, vendor: { id: vendorId, name: vendorName, classification }, requestedModel, returnedModel, runtimeEnvironment,
      repetitions: generationResult.repetitions, taskCount: 30, evaluatedRuns: records.length,
      successfulRuns: records.filter(record => record.passed).length, overallRate,
      standardRuns: standard.length, successfulStandardRuns: standard.filter(record => record.passed).length, standardRate,
      inputTokens: kjdrawGenerationRuns.reduce((sum, run) => sum + run.usage.inputTokens, 0) + behavioral.usage.inputTokens,
      outputTokens: kjdrawGenerationRuns.reduce((sum, run) => sum + run.usage.outputTokens, 0) + behavioral.usage.outputTokens,
      cacheReadInputTokens: kjdrawGenerationRuns.reduce((sum, run) => sum + run.usage.cacheReadInputTokens, 0) + behavioral.usage.cacheReadInputTokens,
      totalMs: generationResult.totalMs + behavioralResult.totalMs, providerLatencyMs: generationResult.providerLatencyMs + behavioralResult.providerLatencyMs,
      humanInterventionCount: generationResult.humanInterventionCount + behavioralResult.humanInterventionCount,
      pricing: generation.pricing, cost,
      reports: { generationSha256: entry.generationReportSha256.toLowerCase(), behavioralSha256: entry.behavioralReportSha256.toLowerCase() },
    })
  }
  requireValue(classifications.filter(value => value === 'domestic-cn').length >= 2, 'Evidence requires at least two domestic Chinese vendors among three distinct vendors')
  requireValue(runtimeTypes.size >= MODEL_HOLDOUT_MINIMUM_RUNTIME_ENVIRONMENTS, 'Evidence requires at least two distinct real runtime platforms')
  const overallRuns = summaries.reduce((sum, model) => sum + model.evaluatedRuns, 0), overallPassed = summaries.reduce((sum, model) => sum + model.successfulRuns, 0)
  const standardRuns = summaries.reduce((sum, model) => sum + model.standardRuns, 0), standardPassed = summaries.reduce((sum, model) => sum + model.successfulStandardRuns, 0)
  requireValue(overallPassed / overallRuns >= MODEL_HOLDOUT_MINIMUM_RATE && standardPassed / standardRuns >= MODEL_HOLDOUT_MINIMUM_RATE, 'Combined completion is below 95%')
  return {
    schema: MODEL_HOLDOUT_EVIDENCE_SCHEMA, mode: 'live', repository: identity.repository, commit: identity.commit,
    package: { name: identity.packageName, version: identity.packageVersion },
    taskSuite: { uniqueTasks: 30, generationTasks: 17, behavioralTasks: 13, minimumRepetitions: MODEL_HOLDOUT_MINIMUM_REPETITIONS, standardCategories: [...standardCategories] },
    vendorCoverage: { domesticChina: classifications.filter(value => value === 'domestic-cn').length, international: classifications.filter(value => value === 'international').length },
    runtimeCoverage: { minimum: MODEL_HOLDOUT_MINIMUM_RUNTIME_ENVIRONMENTS, count: runtimeTypes.size, platforms: [...runtimeTypes].sort() },
    thresholds: { minimumRate: MODEL_HOLDOUT_MINIMUM_RATE, overallRate: overallPassed / overallRuns, standardRate: standardPassed / standardRuns, passed: true },
    models: summaries, manifestSha256: sha(Buffer.from(JSON.stringify(manifest))), verifiedAt: new Date().toISOString(), valid: true,
  }
}

export function isModelHoldoutEvidence(value, { repository, commit, packageName, packageVersion } = {}) {
  if (value?.schema !== MODEL_HOLDOUT_EVIDENCE_SCHEMA || value.mode !== 'live' || value.valid !== true || value.repository !== repository || value.commit !== commit) return false
  if (value.package?.name !== packageName || value.package?.version !== packageVersion || !shaText(value.manifestSha256)) return false
  if (value.taskSuite?.uniqueTasks !== 30 || value.taskSuite?.generationTasks !== 17 || value.taskSuite?.behavioralTasks !== 13 || value.taskSuite?.minimumRepetitions !== 5) return false
  if (value.vendorCoverage?.domesticChina < 2 || value.thresholds?.minimumRate !== 0.95 || value.thresholds?.passed !== true || value.thresholds.overallRate < 0.95 || value.thresholds.standardRate < 0.95) return false
  if (value.runtimeCoverage?.minimum !== 2 || value.runtimeCoverage?.count < 2 || !Array.isArray(value.runtimeCoverage.platforms) || new Set(value.runtimeCoverage.platforms).size !== value.runtimeCoverage.count) return false
  if (!Array.isArray(value.models) || value.models.length !== 3 || new Set(value.models.map(model => model.vendor?.id)).size !== 3 || new Set(value.models.map(model => model.id)).size !== 3 || new Set(value.models.map(model => model.requestedModel)).size !== 3) return false
  const domestic = value.models.filter(model => model.vendor?.classification === 'domestic-cn').length, international = value.models.filter(model => model.vendor?.classification === 'international').length
  if (domestic !== value.vendorCoverage.domesticChina || international !== value.vendorCoverage.international) return false
  const runtimePlatforms = new Set(value.models.map(model => model.runtimeEnvironment?.platform))
  if (runtimePlatforms.size !== value.runtimeCoverage.count || [...runtimePlatforms].some(platform => !value.runtimeCoverage.platforms.includes(platform))) return false
  const modelsValid = value.models.every(model => ['domestic-cn', 'international'].includes(model.vendor?.classification) && model.runtimeEnvironment?.kind === 'node-sdk' && ['win32', 'linux', 'darwin'].includes(model.runtimeEnvironment?.platform) && /^v\d+\.\d+\.\d+$/.test(model.runtimeEnvironment?.node ?? '') && model.taskCount === 30 && model.repetitions >= 5 && model.evaluatedRuns === model.taskCount * model.repetitions && count(model.successfulRuns) && model.successfulRuns <= model.evaluatedRuns && model.overallRate === model.successfulRuns / model.evaluatedRuns && count(model.standardRuns) && count(model.successfulStandardRuns) && model.successfulStandardRuns <= model.standardRuns && model.standardRate === model.successfulStandardRuns / model.standardRuns && model.overallRate >= 0.95 && model.standardRate >= 0.95 && count(model.inputTokens) && count(model.outputTokens) && count(model.cacheReadInputTokens) && finite(model.totalMs) && finite(model.providerLatencyMs) && count(model.humanInterventionCount) && shaText(model.reports?.generationSha256) && shaText(model.reports?.behavioralSha256))
  if (!modelsValid) return false
  const total = value.models.reduce((sum, model) => sum + model.evaluatedRuns, 0), passed = value.models.reduce((sum, model) => sum + model.successfulRuns, 0)
  const standardTotal = value.models.reduce((sum, model) => sum + model.standardRuns, 0), standardPassed = value.models.reduce((sum, model) => sum + model.successfulStandardRuns, 0)
  return value.thresholds.overallRate === passed / total && value.thresholds.standardRate === standardPassed / standardTotal
}

async function writeAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.next`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

function cliValue(args, name, fallback) { const index = args.indexOf(`--${name}`); return index < 0 ? fallback : args[index + 1] }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const manifestPath = resolve(cliValue(args, 'manifest', '.cache/release-evidence/three-model-holdout-input.json'))
  const outputPath = resolve(cliValue(args, 'output', '.cache/release-evidence/three-model-holdout.json'))
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const evidence = await buildModelHoldoutEvidence(manifest, { baseDirectory: dirname(manifestPath) })
  await writeAtomic(outputPath, evidence)
  console.log(JSON.stringify({ valid: true, output: outputPath, models: evidence.models.map(model => model.id), overallRate: evidence.thresholds.overallRate, standardRate: evidence.thresholds.standardRate }))
}
