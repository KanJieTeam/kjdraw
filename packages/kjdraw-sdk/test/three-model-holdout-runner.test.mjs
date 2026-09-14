import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { MODEL_HOLDOUT_RUN_CONFIG_SCHEMA, runThreeModelHoldout, validateModelHoldoutRunConfig } from '../../../scripts/audits/run-three-model-holdout.mjs'

const candidate = { repository: 'KanJieTeam/kjdraw', commit: 'a'.repeat(40), package: { name: '@kanjieteam/kjdraw', version: '1.0.0-rc.3' } }
const model = (id, vendor, classification, requestedModel, platform, apiKeyEnv) => ({ id, vendor: { id: vendor, name: vendor, classification }, requestedModel, endpoint: `https://${vendor}.example/v1/chat/completions`, apiKeyEnv, runOn: { platform, architecture: 'x64' }, settings: { maxOutputTokens: 4096, timeoutMs: 60000 } })
const configuration = () => ({
  schema: MODEL_HOLDOUT_RUN_CONFIG_SCHEMA, candidate, repetitions: 5,
  models: [model('cn-a', 'vendor-cn-a', 'domestic-cn', 'model-cn-a', 'win32', 'MODEL_CN_A_KEY'), model('cn-b', 'vendor-cn-b', 'domestic-cn', 'model-cn-b', 'linux', 'MODEL_CN_B_KEY'), model('global-c', 'vendor-global-c', 'international', 'model-global-c', 'linux', 'MODEL_GLOBAL_C_KEY')],
})
const identity = structuredClone(candidate)

async function fakeReports(secretLog, failFirstGeneration = false, behavioralStatus = 'complete') {
  let failed = false
  const generation = async options => {
    secretLog.push(options.apiKey)
    const runtime = options.model === 'model-cn-a' ? { node: 'v22.19.0', platform: 'win32', architecture: 'x64' } : { node: 'v22.20.0', platform: 'linux', architecture: 'x64' }
    await import('node:fs/promises').then(({ mkdir }) => mkdir(options.output, { recursive: true }))
    if (failFirstGeneration && !failed) {
      failed = true
      await writeFile(resolve(options.output, 'report.json'), JSON.stringify({ mode: 'live', model: options.model, status: 'stopped', runtime }))
      return
    }
    await writeFile(resolve(options.output, 'report.json'), JSON.stringify({ schema: 'com.kanjie.kjdraw.benchmark.paired-model@1', mode: 'live', fixtureWarning: null, model: options.model, taskSuite: 'release-holdout-generation', status: 'complete', repetitions: options.repetitions, plannedRequests: options.maxRequests, attemptedRequests: options.maxRequests, unexecutedRequests: 0, runtime, consistentReturnedModel: true, returnedModels: [`${options.model}-returned`] }))
  }
  const behavioral = async options => {
    secretLog.push(options.env.KJDRAW_BENCH_API_KEY)
    const modelName = options.env.KJDRAW_BENCH_MODEL, runtime = modelName === 'model-cn-a' ? { node: 'v22.19.0', platform: 'win32', architecture: 'x64' } : { node: 'v22.20.0', platform: 'linux', architecture: 'x64' }
    await import('node:fs/promises').then(({ mkdir }) => mkdir(options.output, { recursive: true }))
    await writeFile(resolve(options.output, 'report.json'), JSON.stringify({ schema: 'com.kanjie.kjdraw.benchmark.behavioral-suite@2', mode: 'live', fixtureWarning: null, model: modelName, status: behavioralStatus, repetitions: options.repetitions, plannedRuns: options.maxRuns, attemptedRuns: options.maxRuns, unexecutedRuns: 0, runtime, consistentReturnedModel: true, returnedModels: [`${modelName}-returned`] }))
  }
  return { generation, behavioral }
}

test('run configuration contains metadata and environment variable names only', () => {
  assert.equal(validateModelHoldoutRunConfig(configuration()).models.length, 3)
  const compatible = configuration(); compatible.models[0].settings = { maxOutputTokens: 16384, timeoutMs: 120000, chatTokenParameter: 'max_completion_tokens', toolChoiceMode: 'required', temperature: null, stream: true, reasoningEffort: 'max' }
  assert.deepEqual(validateModelHoldoutRunConfig(compatible).models[0].settings, { maxOutputTokens: 16384, timeoutMs: 120000, chatTokenParameter: 'max_completion_tokens', toolChoiceMode: 'required', temperature: null, stream: true, reasoningEffort: 'max', pricing: null })
  const weak = configuration(); weak.models[2].vendor.classification = 'domestic-cn'
  assert.throws(() => validateModelHoldoutRunConfig(weak), /international vendor/)
  const onePlatform = configuration(); onePlatform.models[1].runOn.platform = 'win32'; onePlatform.models[2].runOn.platform = 'win32'
  assert.throws(() => validateModelHoldoutRunConfig(onePlatform), /two runtime platforms/)
  const embeddedSecret = configuration(); embeddedSecret.models[0].apiKey = 'secret'
  assert.throws(() => validateModelHoldoutRunConfig(embeddedSecret), /unsupported fields/)
})

test('orchestrator resumes completed phases across two runtimes and writes bound evidence input', async t => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'kjdraw-three-model-run-')); t.after(() => rm(workspace, { recursive: true, force: true }))
  const secrets = [], runners = await fakeReports(secrets), env = { MODEL_CN_A_KEY: 'secret-a', MODEL_CN_B_KEY: 'secret-b', MODEL_GLOBAL_C_KEY: 'secret-c' }
  const first = await runThreeModelHoldout(configuration(), { workspace, candidateIdentity: identity, runtime: { node: 'v22.19.0', platform: 'win32', architecture: 'x64' }, env, runGeneration: runners.generation, runBehavioral: runners.behavioral })
  assert.deepEqual(first, { status: 'pending', ran: ['cn-a'], completedModels: ['cn-a'], remainingModels: ['cn-b', 'global-c'] })
  let built = null
  const second = await runThreeModelHoldout(configuration(), { workspace, candidateIdentity: identity, runtime: { node: 'v22.20.0', platform: 'linux', architecture: 'x64' }, env, runGeneration: runners.generation, runBehavioral: runners.behavioral, buildEvidence: async manifest => { built = manifest; return { valid: true, commit: manifest.commit } } })
  assert.equal(second.status, 'complete')
  assert.deepEqual(second.ran, ['cn-b', 'global-c'])
  assert.equal(built.models.length, 3)
  assert.deepEqual(new Set(built.models.map(entry => entry.runtimeEnvironment.platform)), new Set(['win32', 'linux']))
  assert.equal(built.models.every(entry => /^[0-9a-f]{64}$/.test(entry.generationReportSha256) && /^[0-9a-f]{64}$/.test(entry.behavioralReportSha256)), true)
  assert.deepEqual(secrets, ['secret-a', 'secret-a', 'secret-b', 'secret-b', 'secret-c', 'secret-c'])
  const files = await readdir(workspace, { recursive: true }), contents = await Promise.all(files.filter(name => name.endsWith('.json')).map(name => readFile(resolve(workspace, name), 'utf8')))
  assert.equal(contents.some(text => /secret-[abc]/.test(text)), false)
  const ledger = JSON.parse(await readFile(resolve(workspace, 'models/cn-a/human-interventions.json'), 'utf8'))
  assert.deepEqual(ledger.events, [])
})

test('orchestrator fails closed on missing keys and interrupted attempts require explicit retry', async t => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'kjdraw-three-model-retry-')); t.after(() => rm(workspace, { recursive: true, force: true }))
  const secrets = [], runners = await fakeReports(secrets, true), env = { MODEL_CN_A_KEY: 'secret-a' }
  const options = { workspace, candidateIdentity: identity, runtime: { node: 'v22.19.0', platform: 'win32', architecture: 'x64' }, modelId: 'cn-a', env, runGeneration: runners.generation, runBehavioral: runners.behavioral }
  await assert.rejects(runThreeModelHoldout(configuration(), options), /did not produce a complete report/)
  await assert.rejects(runThreeModelHoldout(configuration(), options), /explicit retryIncomplete/)
  const recovered = await runThreeModelHoldout(configuration(), { ...options, retryIncomplete: true })
  assert.equal(recovered.status, 'pending')
  assert.deepEqual((await readdir(resolve(workspace, 'models/cn-a'))).filter(name => name.startsWith('generation-attempt-')), ['generation-attempt-001', 'generation-attempt-002'])
  const missing = { ...options, workspace: await mkdtemp(resolve(tmpdir(), 'kjdraw-three-model-missing-')), env: {} }
  t.after(() => rm(missing.workspace, { recursive: true, force: true }))
  await assert.rejects(runThreeModelHoldout(configuration(), missing), /environment variable is unavailable/)
})

test('orchestrator rejects configuration for another candidate and another assigned runtime', async t => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'kjdraw-three-model-identity-')); t.after(() => rm(workspace, { recursive: true, force: true }))
  await assert.rejects(runThreeModelHoldout(configuration(), { workspace, candidateIdentity: { ...identity, commit: 'b'.repeat(40) } }), /exact checkout candidate/)
  await assert.rejects(runThreeModelHoldout(configuration(), { workspace, candidateIdentity: identity, runtime: { node: 'v22.19.0', platform: 'linux', architecture: 'x64' }, modelId: 'cn-a', env: { MODEL_CN_A_KEY: 'secret-a' } }), /different runtime platform/)
})

test('orchestrator preserves complete failed behavioral reports for the 95 percent evidence decision', async t => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'kjdraw-three-model-threshold-')); t.after(() => rm(workspace, { recursive: true, force: true }))
  const secrets = [], runners = await fakeReports(secrets, false, 'failed'), env = { MODEL_CN_A_KEY: 'secret-a', MODEL_CN_B_KEY: 'secret-b', MODEL_GLOBAL_C_KEY: 'secret-c' }
  await runThreeModelHoldout(configuration(), { workspace, candidateIdentity: identity, runtime: { node: 'v22.19.0', platform: 'win32', architecture: 'x64' }, env, runGeneration: runners.generation, runBehavioral: runners.behavioral })
  let built = false
  const result = await runThreeModelHoldout(configuration(), { workspace, candidateIdentity: identity, runtime: { node: 'v22.20.0', platform: 'linux', architecture: 'x64' }, env, runGeneration: runners.generation, runBehavioral: runners.behavioral, buildEvidence: async () => { built = true; return { valid: true } } })
  assert.equal(result.status, 'complete')
  assert.equal(built, true)
  assert.equal((await readdir(resolve(workspace, 'models/cn-a'))).filter(name => name.startsWith('behavioral-attempt-')).length, 1)
})
