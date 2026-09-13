import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildModelHoldoutEvidence, MODEL_HOLDOUT_MANIFEST_SCHEMA, MODEL_HOLDOUT_MINIMUM_REPETITIONS } from './model-holdout-evidence.mjs'
import { benchmarkPricing, runPairedModelBenchmark } from '../benchmarks/paired-model-benchmark.mjs'
import { runBehavioralLiveBenchmark } from '../benchmarks/release-holdout-behavioral-runner.mjs'

export const MODEL_HOLDOUT_RUN_CONFIG_SCHEMA = 'com.kanjie.kjdraw.audit.three-model-holdout-run-config@1'
const GENERATION_REQUESTS_PER_REPETITION = 34
const BEHAVIORAL_RUNS_PER_REPETITION = 13
const sha = value => createHash('sha256').update(value).digest('hex')
const fullSha = value => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
const oneLine = (value, label, maximum = 256) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\r\n]/.test(value)) throw new Error(`${label} is invalid`)
  return value.trim()
}
const exactKeys = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key))
  if (unexpected.length) throw new Error(`${label} contains unsupported fields: ${unexpected.join(', ')}`)
}
const safeId = (value, label) => {
  const result = oneLine(value, label, 64)
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(result)) throw new Error(`${label} must be a lowercase filesystem-safe id`)
  return result
}

function normalizeRepository(value) {
  const text = String(value ?? '').trim()
  const match = text.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i)
  return match?.[1] ?? null
}

function validateEndpoint(value) {
  let url
  try { url = new URL(oneLine(value, 'Model endpoint', 1024)) } catch { throw new Error('Model endpoint is invalid') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Model endpoint must be remote HTTPS without credentials, query or fragment')
  return url.href
}

function validateSettings(value = {}) {
  exactKeys(value, ['maxOutputTokens', 'timeoutMs', 'chatTokenParameter', 'toolChoiceMode', 'thinkingMode', 'enableThinking', 'reasoningEffort', 'pricing'], 'Model settings')
  const maxOutputTokens = value.maxOutputTokens ?? 4096, timeoutMs = value.timeoutMs ?? 60000
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 4096 || maxOutputTokens > 32768) throw new Error('maxOutputTokens must be 4096–32768')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 120000) throw new Error('timeoutMs must be 10–120000')
  const chatTokenParameter = value.chatTokenParameter ?? 'max_tokens', toolChoiceMode = value.toolChoiceMode ?? 'forced'
  if (!['max_tokens', 'max_completion_tokens'].includes(chatTokenParameter)) throw new Error('Unsupported chat token parameter')
  if (!['auto', 'forced'].includes(toolChoiceMode)) throw new Error('Unsupported tool choice mode')
  if (value.thinkingMode !== undefined && !['disabled', 'enabled'].includes(value.thinkingMode)) throw new Error('Unsupported thinking mode')
  if (value.enableThinking !== undefined && typeof value.enableThinking !== 'boolean') throw new Error('enableThinking must be boolean')
  if (value.thinkingMode !== undefined && value.enableThinking !== undefined) throw new Error('Choose only one thinking format')
  if (value.reasoningEffort !== undefined && !['low', 'medium', 'high', 'xhigh'].includes(value.reasoningEffort)) throw new Error('Unsupported reasoning effort')
  const pricing = benchmarkPricing(value.pricing)
  return { maxOutputTokens, timeoutMs, chatTokenParameter, toolChoiceMode, pricing, ...(value.thinkingMode !== undefined ? { thinkingMode: value.thinkingMode } : {}), ...(value.enableThinking !== undefined ? { enableThinking: value.enableThinking } : {}), ...(value.reasoningEffort !== undefined ? { reasoningEffort: value.reasoningEffort } : {}) }
}

export function validateModelHoldoutRunConfig(value) {
  exactKeys(value, ['schema', 'candidate', 'repetitions', 'models'], 'Run configuration')
  if (value.schema !== MODEL_HOLDOUT_RUN_CONFIG_SCHEMA) throw new Error('Invalid model holdout run configuration schema')
  exactKeys(value.candidate, ['repository', 'commit', 'package'], 'Candidate')
  exactKeys(value.candidate.package, ['name', 'version'], 'Candidate package')
  const repository = oneLine(value.candidate.repository, 'Candidate repository')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Candidate repository must be owner/name')
  const commit = oneLine(value.candidate.commit, 'Candidate commit', 40)
  if (!fullSha(commit)) throw new Error('Candidate commit must be a full SHA')
  const packageName = oneLine(value.candidate.package.name, 'Candidate package name'), packageVersion = oneLine(value.candidate.package.version, 'Candidate package version')
  const repetitions = value.repetitions ?? MODEL_HOLDOUT_MINIMUM_REPETITIONS
  if (!Number.isSafeInteger(repetitions) || repetitions < MODEL_HOLDOUT_MINIMUM_REPETITIONS || repetitions > 30) throw new Error('Repetitions must be 5–30')
  if (!Array.isArray(value.models) || value.models.length !== 3) throw new Error('Exactly three model configurations are required')
  const ids = new Set(), vendors = new Set(), requestedModels = new Set(), classifications = [], platforms = new Set()
  const models = value.models.map((entry, index) => {
    exactKeys(entry, ['id', 'vendor', 'requestedModel', 'endpoint', 'apiKeyEnv', 'runOn', 'settings'], `Model ${index + 1}`)
    exactKeys(entry.vendor, ['id', 'name', 'classification'], `Model ${index + 1} vendor`)
    exactKeys(entry.runOn, ['platform', 'architecture'], `Model ${index + 1} runOn`)
    const id = safeId(entry.id, `Model ${index + 1} id`), vendorId = safeId(entry.vendor.id, `Model ${id} vendor id`)
    const vendorName = oneLine(entry.vendor.name, `Model ${id} vendor name`, 160), classification = entry.vendor.classification
    if (!['domestic-cn', 'international'].includes(classification)) throw new Error(`Model ${id} has an unsupported vendor classification`)
    const requestedModel = oneLine(entry.requestedModel, `Model ${id} requested model`)
    const apiKeyEnv = oneLine(entry.apiKeyEnv, `Model ${id} API key environment variable`, 128)
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(apiKeyEnv)) throw new Error(`Model ${id} API key environment variable is invalid`)
    const platform = oneLine(entry.runOn.platform, `Model ${id} runtime platform`, 16), architecture = oneLine(entry.runOn.architecture, `Model ${id} runtime architecture`, 32)
    if (!['win32', 'linux', 'darwin'].includes(platform) || !/^[A-Za-z0-9_-]{2,32}$/.test(architecture)) throw new Error(`Model ${id} runtime target is invalid`)
    if (ids.has(id) || vendors.has(vendorId) || requestedModels.has(requestedModel)) throw new Error('Model ids, vendors and requested models must be distinct')
    ids.add(id); vendors.add(vendorId); requestedModels.add(requestedModel); classifications.push(classification); platforms.add(platform)
    return { id, vendor: { id: vendorId, name: vendorName, classification }, requestedModel, endpoint: validateEndpoint(entry.endpoint), apiKeyEnv, runOn: { platform, architecture }, settings: validateSettings(entry.settings) }
  })
  if (classifications.filter(value => value === 'domestic-cn').length < 2 || !classifications.includes('international')) throw new Error('Run configuration requires two domestic Chinese vendors and one international vendor')
  if (platforms.size < 2) throw new Error('Run configuration requires at least two runtime platforms')
  return { schema: value.schema, candidate: { repository, commit: commit.toLowerCase(), package: { name: packageName, version: packageVersion } }, repetitions, models }
}

function command(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error('Unable to resolve exact candidate identity')
  return result.stdout.trim()
}

export async function checkoutCandidateIdentity(root) {
  const sdkPackage = JSON.parse(await readFile(resolve(root, 'packages/kjdraw-sdk/package.json'), 'utf8'))
  const repository = normalizeRepository(command(root, ['remote', 'get-url', 'origin']))
  const commit = command(root, ['rev-parse', 'HEAD']).toLowerCase()
  const dirty = command(root, ['status', '--porcelain', '--untracked-files=all', '--', 'scripts', 'packages', 'package.json'])
  if (dirty) throw new Error('Benchmark source differs from the candidate commit')
  if (!repository || !fullSha(commit)) throw new Error('Unable to resolve exact candidate identity')
  return { repository, commit, package: { name: sdkPackage.name, version: sdkPackage.version } }
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`Invalid JSON artifact: ${path}`)
  }
}

async function writeOnce(path, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`
  await mkdir(dirname(path), { recursive: true })
  try { await writeFile(path, bytes, { flag: 'wx' }) } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    if (await readFile(path, 'utf8') !== bytes) throw new Error(`Existing immutable artifact differs: ${path}`)
  }
  return path
}

async function attempts(parent, phase) {
  try {
    return (await readdir(parent, { withFileTypes: true })).filter(entry => entry.isDirectory() && new RegExp(`^${phase}-attempt-\\d{3}$`).test(entry.name)).map(entry => resolve(parent, entry.name)).sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function reportMatches(report, phase, model, repetitions, runtime) {
  const nodeMatches = runtime.node === undefined ? /^v\d+\.\d+\.\d+$/.test(report?.runtime?.node ?? '') : report?.runtime?.node === runtime.node
  const common = report?.mode === 'live' && report.fixtureWarning === null && report.model === model.requestedModel && report.repetitions === repetitions && nodeMatches && report.runtime?.platform === runtime.platform && report.runtime?.architecture === runtime.architecture && report.consistentReturnedModel === true && report.returnedModels?.length === 1
  if (!common) return false
  if (phase === 'generation') return report.schema === 'com.kanjie.kjdraw.benchmark.paired-model@1' && report.taskSuite === 'release-holdout-generation' && report.status === 'complete' && report.plannedRequests === GENERATION_REQUESTS_PER_REPETITION * repetitions && report.attemptedRequests === report.plannedRequests && report.unexecutedRequests === 0
  return report.schema === 'com.kanjie.kjdraw.benchmark.behavioral-suite@2' && ['complete', 'failed'].includes(report.status) && report.plannedRuns === BEHAVIORAL_RUNS_PER_REPETITION * repetitions && report.attemptedRuns === report.plannedRuns && report.unexecutedRuns === 0
}

async function completedPhase(parent, phase, model, repetitions, runtime) {
  let incomplete = false
  for (const directory of (await attempts(parent, phase)).reverse()) {
    const report = await readJson(resolve(directory, 'report.json'))
    if (reportMatches(report, phase, model, repetitions, runtime)) return { directory, report }
    incomplete = true
  }
  return { directory: null, report: null, incomplete }
}

function runnerEnvironment(model, secret) {
  const settings = model.settings
  return {
    KJDRAW_BENCH_PROTOCOL: 'chat-completions', KJDRAW_BENCH_MODEL: model.requestedModel, KJDRAW_BENCH_ENDPOINT: model.endpoint, KJDRAW_BENCH_API_KEY: secret,
    KJDRAW_BENCH_CHAT_TOKEN_PARAMETER: settings.chatTokenParameter, KJDRAW_BENCH_MAX_OUTPUT_TOKENS: String(settings.maxOutputTokens), KJDRAW_BENCH_TIMEOUT_MS: String(settings.timeoutMs), KJDRAW_BENCH_TOOL_CHOICE: settings.toolChoiceMode,
    ...(settings.thinkingMode !== undefined ? { KJDRAW_BENCH_THINKING: settings.thinkingMode } : {}), ...(settings.enableThinking !== undefined ? { KJDRAW_BENCH_ENABLE_THINKING: String(settings.enableThinking) } : {}), ...(settings.reasoningEffort !== undefined ? { KJDRAW_BENCH_REASONING_EFFORT: settings.reasoningEffort } : {}), ...(settings.pricing ? { KJDRAW_BENCH_PRICING_JSON: JSON.stringify(settings.pricing) } : {}),
  }
}

async function nextAttempt(parent, phase) {
  const existing = await attempts(parent, phase)
  if (existing.length >= 999) throw new Error(`Too many ${phase} attempts`)
  return resolve(parent, `${phase}-attempt-${String(existing.length + 1).padStart(3, '0')}`)
}

async function runPhase({ phase, parent, model, repetitions, runtime, secret, retryIncomplete, runners, ledgerPath }) {
  const found = await completedPhase(parent, phase, model, repetitions, runtime)
  if (found.report) return found
  if (found.incomplete && !retryIncomplete) throw new Error(`Incomplete ${phase} attempt for ${model.id}; rerun with explicit retryIncomplete`)
  const output = await nextAttempt(parent, phase), env = runnerEnvironment(model, secret)
  if (phase === 'generation') {
    await runners.generation({ mode: 'live', protocol: 'chat-completions', model: model.requestedModel, endpoint: model.endpoint, apiKey: secret, repetitions, maxRequests: GENERATION_REQUESTS_PER_REPETITION * repetitions, taskSuite: 'release-holdout-generation', maxOutputTokens: model.settings.maxOutputTokens, exploratory: false, chatTokenParameter: model.settings.chatTokenParameter, toolChoiceMode: model.settings.toolChoiceMode, timeoutMs: model.settings.timeoutMs, output, pricing: model.settings.pricing, ...(model.settings.thinkingMode !== undefined ? { thinkingMode: model.settings.thinkingMode } : {}), ...(model.settings.enableThinking !== undefined ? { enableThinking: model.settings.enableThinking } : {}), ...(model.settings.reasoningEffort !== undefined ? { reasoningEffort: model.settings.reasoningEffort } : {}) })
  } else await runners.behavioral({ repetitions, maxRuns: BEHAVIORAL_RUNS_PER_REPETITION * repetitions, output, humanInterventionLedgerPath: ledgerPath, env })
  const report = await readJson(resolve(output, 'report.json'))
  if (!reportMatches(report, phase, model, repetitions, runtime)) throw new Error(`${phase} runner did not produce a complete report for ${model.id}`)
  return { directory: output, report }
}

function relativeArtifact(base, path) {
  const value = relative(base, path).replaceAll('\\', '/')
  if (!value || value.startsWith('../') || value === '..') throw new Error('Report artifact escapes the evidence workspace')
  return value
}

export async function runThreeModelHoldout(configValue, options = {}) {
  const config = validateModelHoldoutRunConfig(configValue), root = resolve(options.root ?? fileURLToPath(new URL('../../', import.meta.url))), workspace = resolve(options.workspace ?? resolve(root, '.cache/release-evidence/three-model-holdout-run'))
  const identity = options.candidateIdentity ?? await checkoutCandidateIdentity(root)
  if (identity.repository !== config.candidate.repository || identity.commit.toLowerCase() !== config.candidate.commit || identity.package?.name !== config.candidate.package.name || identity.package?.version !== config.candidate.package.version) throw new Error('Run configuration does not match the exact checkout candidate')
  const runtime = options.runtime ?? { node: process.version, platform: process.platform, architecture: process.arch }
  const selected = options.modelId ? config.models.filter(model => model.id === options.modelId) : config.models.filter(model => model.runOn.platform === runtime.platform && model.runOn.architecture === runtime.architecture)
  if (options.modelId && selected.length !== 1) throw new Error('Requested model id is not present in the run configuration')
  if (selected.some(model => model.runOn.platform !== runtime.platform || model.runOn.architecture !== runtime.architecture)) throw new Error('Selected model is assigned to a different runtime platform')
  const runners = { generation: options.runGeneration ?? runPairedModelBenchmark, behavioral: options.runBehavioral ?? runBehavioralLiveBenchmark }
  await mkdir(workspace, { recursive: true })
  const ran = []
  for (const model of selected) {
    const secret = (options.env ?? process.env)[model.apiKeyEnv]
    if (typeof secret !== 'string' || !secret || /[\r\n]/.test(secret)) throw new Error(`Required API key environment variable is unavailable for ${model.id}`)
    const parent = resolve(workspace, 'models', model.id), ledgerPath = resolve(parent, 'human-interventions.json')
    await writeOnce(ledgerPath, { schema: 'com.kanjie.kjdraw.benchmark.human-interventions@1', events: [] })
    await runPhase({ phase: 'generation', parent, model, repetitions: config.repetitions, runtime, secret, retryIncomplete: options.retryIncomplete === true, runners, ledgerPath })
    await runPhase({ phase: 'behavioral', parent, model, repetitions: config.repetitions, runtime, secret, retryIncomplete: options.retryIncomplete === true, runners, ledgerPath })
    ran.push(model.id)
  }
  const models = [], runtimePlatforms = new Set()
  for (const model of config.models) {
    const parent = resolve(workspace, 'models', model.id), generation = await completedPhase(parent, 'generation', model, config.repetitions, { platform: model.runOn.platform, architecture: model.runOn.architecture })
    const expectedRuntime = generation.report?.runtime
    const behavioral = expectedRuntime ? await completedPhase(parent, 'behavioral', model, config.repetitions, expectedRuntime) : { report: null }
    if (!generation.report || !behavioral.report || generation.report.returnedModels[0] !== behavioral.report.returnedModels[0]) continue
    runtimePlatforms.add(expectedRuntime.platform)
    const generationPath = resolve(generation.directory, 'report.json'), behavioralPath = resolve(behavioral.directory, 'report.json')
    models.push({ id: model.id, vendor: model.vendor, requestedModel: model.requestedModel, returnedModel: generation.report.returnedModels[0], runtimeEnvironment: { kind: 'node-sdk', ...expectedRuntime }, generationReport: relativeArtifact(workspace, generationPath), behavioralReport: relativeArtifact(workspace, behavioralPath), generationReportSha256: sha(await readFile(generationPath)), behavioralReportSha256: sha(await readFile(behavioralPath)) })
  }
  if (models.length < 3) return { status: 'pending', ran, completedModels: models.map(model => model.id), remainingModels: config.models.map(model => model.id).filter(id => !models.some(model => model.id === id)) }
  if (runtimePlatforms.size < 2) throw new Error('Completed reports do not cover two real runtime platforms')
  const manifest = { schema: MODEL_HOLDOUT_MANIFEST_SCHEMA, repository: config.candidate.repository, commit: config.candidate.commit, package: config.candidate.package, models }
  const manifestPath = await writeOnce(resolve(workspace, 'three-model-holdout-input.json'), manifest)
  const evidenceBuilder = options.buildEvidence ?? buildModelHoldoutEvidence
  const evidence = await evidenceBuilder(manifest, { baseDirectory: workspace, repository: identity.repository, commit: identity.commit, packageName: identity.package.name, packageVersion: identity.package.version })
  const evidencePath = await writeOnce(resolve(workspace, 'three-model-holdout.json'), evidence)
  return { status: 'complete', ran, completedModels: models.map(model => model.id), manifestPath, evidencePath }
}

function cliValue(args, name, fallback) { const prefix = `--${name}=`; return args.find(argument => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(argument => argument !== '--retry-incomplete' && !/^--(?:config|workspace|model)=.+$/.test(argument))) throw new Error('Options: --config, --workspace, --model, --retry-incomplete')
  const configPath = resolve(cliValue(args, 'config', '.cache/release-evidence/three-model-holdout-run-config.json'))
  const result = await runThreeModelHoldout(JSON.parse(await readFile(configPath, 'utf8')), { workspace: cliValue(args, 'workspace'), modelId: cliValue(args, 'model'), retryIncomplete: args.includes('--retry-incomplete') })
  console.log(JSON.stringify(result))
  if (result.status !== 'complete') process.exitCode = 2
}
