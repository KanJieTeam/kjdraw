// Paired, sequential CAD benchmark orchestration. The scorer receives acceptance
// data only after each model response; neither model request contains expectedRounds.
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { projectCompactCadTools, routeCompactCadTools } from '../../packages/kjdraw-sdk/src/agent-compact-tool-surface.js'
import { buildCadSkillJsonContract, parseCadSkillJsonResponse } from '../../packages/kjdraw-sdk/src/agent-skill-json.js'
import { aggregateMultiroundComparison } from './aggregate-multiround-comparison.mjs'
import { callBenchmarkModel } from './token-provider-transport.mjs'
import { createTokenKjdrawArm, executeTokenKjdrawRound } from './token-kjdraw-arm.mjs'
import { buildDeclarativeEzdxfRequest, compileDeclarativeEzdxfRound, supportedDeclarativeEzdxfTask } from './declarative-ezdxf-baseline.mjs'
import { featureHandlesFromKJDrawDocument, scoreTokenEfficiencyRound, scoreTokenEfficiencySeed } from './token-efficiency-scorer.mjs'
import { tokenEfficiencyPlan } from './token-efficiency-plan.mjs'
import { tokenEfficiencyTaskCorpus } from './token-efficiency-task-corpus.mjs'

const arms = ['kjdraw-tool', 'declarative-ezdxf']
export const kjdrawCompactSystemMessage = 'Use the supplied CAD proposal tools. For edits, put stable feature IDs in ids; the host resolves IDs, revision and millimeter units. Only report success after approval.'
export const kjdrawToolNamesForTask = (task, roundIndex = 1) => routeCompactCadTools({
  prompt: task.rounds[roundIndex - 1].prompt, hasEditableSeed: Boolean(task.seed),
})
const failureCode = error => typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,64}$/.test(error.code) ? error.code : 'BENCHMARK_STEP_FAILED'
const fixedReason = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,64}$/.test(value) ? value : null
const stopOnProviderFailure = code => typeof code === 'string' &&
  (code.startsWith('PROVIDER_') || ['TRANSPORT_FAILURE', 'MISSING_API_KEY', 'RESPONSE_TOO_LARGE', 'INCOMPLETE_PROVIDER_USAGE',
    'AUTH_FAILURE', 'PAYMENT_REQUIRED', 'RATE_LIMIT', 'ARTIFACT_PERSISTENCE_FAILED'].includes(code))
const artifactSecrets = () => ['KJDRAW_DEEPSEEK_API_KEY', 'KJDRAW_QWEN_API_KEY', 'KJDRAW_GLM_API_KEY']
  .map(name => process.env[name]).filter(value => typeof value === 'string' && value.length >= 4)
function redactArtifact(value, secrets) {
  if (typeof value === 'string') return secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value)
  if (Array.isArray(value)) return value.map(item => redactArtifact(item, secrets))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactArtifact(item, secrets)]))
  return value
}
async function saveArtifact(saveModelArtifacts, context, response) {
  if (!saveModelArtifacts) return
  try {
    await saveModelArtifacts(redactArtifact({ ...context, response: {
      content: response.content ?? null, toolCalls: response.toolCalls ?? [], usage: response.usage ?? null,
      elapsedMs: response.elapsedMs ?? null, model: response.model ?? null,
    } }, artifactSecrets()))
  } catch { throw Object.assign(new Error('ARTIFACT_PERSISTENCE_FAILED'), { code: 'ARTIFACT_PERSISTENCE_FAILED' }) }
}
function probeLocalEzdxf() {
  const python = process.env.KJDRAW_PYTHON ?? 'python', path = process.env.KJDRAW_EZDXF_PATH
  if (path && !isAbsolute(path)) throw new Error('INVALID_EZDXF_RUNTIME_PATH')
  const code = `${path ? `import sys;sys.path.insert(0,${JSON.stringify(path)});` : ''}import ezdxf;print(ezdxf.__version__)`
  const result = spawnSync(python, ['-I', '-c', code], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024, windowsHide: true })
  if (result.status !== 0 || result.error || !/^\d+(?:\.\d+){1,3}\s*$/.test(result.stdout)) throw new Error('INDEPENDENT_VALIDATOR_UNAVAILABLE')
}
const baseRecord = (task, arm, repetition, roundIndex) => ({ taskId: task.id, arm, repetition, roundIndex,
  status: 'failed', validation: { passed: false, reasons: [] }, usage: null,
  transportLatencyMs: null, totalMs: null, returnedModel: null, failure: null, toolCallCount: 0,
  loadedTools: [], review: { kind: 'none', approved: false }, unexecuted: false })

function sharedPrompt(task, roundIndex) {
  const seed = roundIndex === 1 && task.seed ? `Initial editable drawing features (feature IDs are stable): ${JSON.stringify(task.seed)}\n` : ''
  return `${seed}${task.rounds[roundIndex - 1].prompt}`
}

function kjdrawMessages(state, task, roundIndex, history, prompt, interfaceMode) {
  const names = kjdrawToolNamesForTask(task, roundIndex)
  if (interfaceMode === 'skill-json') return { names, tools: [], messages: [
    { role: 'system', content: buildCadSkillJsonContract({ definitions: state.session.definitions, names }) },
    ...history, { role: 'user', content: prompt },
  ] }
  const tools = projectCompactCadTools({ definitions: state.session.definitions, names, hostOwnsRevisionAndUnits: true })
  return { names, messages: [{ role: 'system', content: kjdrawCompactSystemMessage }, ...history, { role: 'user', content: prompt }], tools }
}

async function scoreKjdrawSeed(task, state, scoreSeed) {
  if (!task.seed) return { passed: true, reasons: [] }
  const handles = featureHandlesFromKJDrawDocument({ document: state.document, featureIds: state.featureIds })
  return scoreSeed({ task, dxf: state.seedArtifacts.dxf, featureHandles: handles })
}

async function runKjdrawRound({ task, repetition, roundIndex, state, history, modelCall, scoreRound, provider, model, settings, timeoutMs, mode, interfaceMode, reviewProposal, saveModelArtifacts }) {
  const record = baseRecord(task, arms[0], repetition, roundIndex), started = performance.now(), prompt = sharedPrompt(task, roundIndex)
  try {
    const request = kjdrawMessages(state, task, roundIndex, history, prompt, interfaceMode)
    record.loadedTools = request.names
    const response = await modelCall({ provider, model, messages: request.messages,
      settings: interfaceMode === 'skill-json' ? settings : { ...settings, tools: request.tools, tool_choice: 'auto' }, timeoutMs,
      arm: arms[0], taskId: task.id, repetition, roundIndex })
    record.usage = response.usage ?? null; record.transportLatencyMs = response.elapsedMs ?? null
    record.returnedModel = response.model ?? null
    await saveArtifact(saveModelArtifacts, { taskId: task.id, arm: arms[0], repetition, roundIndex, interfaceMode }, response)
    if (response.finishReason === 'length') throw Object.assign(new Error('INCOMPLETE_MODEL_OUTPUT'), { code: 'INCOMPLETE_MODEL_OUTPUT' })
    let calls
    if (interfaceMode === 'skill-json') {
      if (Array.isArray(response.toolCalls) && response.toolCalls.length) throw Object.assign(new Error('UNEXPECTED_FUNCTION_TOOL_CALL'), { code: 'UNEXPECTED_FUNCTION_TOOL_CALL' })
      try { calls = parseCadSkillJsonResponse({ content: response.content, names: request.names }) }
      catch (error) {
        if (typeof response.content === 'string') record.argumentDiagnostic = { bytes: Buffer.byteLength(response.content), sha256: createHash('sha256').update(response.content).digest('hex') }
        throw error
      }
    } else {
      const rawCalls = response.toolCalls
      if (!Array.isArray(rawCalls) || !rawCalls.length || rawCalls.length > 8) throw Object.assign(new Error('MODEL_TOOL_CALLS_REQUIRED'), { code: 'MODEL_TOOL_CALLS_REQUIRED' })
      calls = rawCalls.map(call => {
        if (call?.type !== 'function' || typeof call.id !== 'string' || !call.id || !request.names.includes(call.function?.name) || typeof call.function.arguments !== 'string') throw Object.assign(new Error('INVALID_TOOL_CALL'), { code: 'INVALID_TOOL_CALL' })
        let args
        try { args = JSON.parse(call.function.arguments) } catch {
          record.argumentDiagnostic = { bytes: Buffer.byteLength(call.function.arguments), sha256: createHash('sha256').update(call.function.arguments).digest('hex') }
          throw Object.assign(new Error('INVALID_TOOL_ARGUMENTS'), { code: 'INVALID_TOOL_ARGUMENTS' })
        }
        return { tool: call.function.name, args, id: call.id }
      })
    }
    const replies = []
    for (const call of calls) {
      const applied = await executeTokenKjdrawRound({ state, roundIndex, toolName: call.tool, parameters: call.args, syntheticFixture: mode !== 'live' })
      record.toolCallCount++
      if (mode === 'live' && applied.status === 'awaiting-review') {
        const decision = await reviewProposal({ taskId: task.id, repetition, roundIndex, toolName: call.tool,
          arguments: applied.arguments, planId: applied.proposalPlanId })
        if (decision?.approved !== true || typeof decision.reviewerId !== 'string' || !decision.reviewerId || !['human', 'external-security-gate'].includes(decision.kind)) throw Object.assign(new Error('REVIEW_REQUIRED'), { code: 'REVIEW_REQUIRED' })
        const approved = await state.session.approve(applied.proposalPlanId, decision.reviewerId)
        if (!approved.ok) throw Object.assign(new Error('APPROVAL_FAILED'), { code: 'APPROVAL_FAILED' })
        record.review = { kind: decision.kind, approved: true, reviewerId: decision.reviewerId }
      } else if (applied.status === 'applied') record.review = { kind: mode === 'pilot' ? 'synthetic-pilot' : 'synthetic-fixture', approved: true, reviewerId: 'synthetic-benchmark-fixture' }
      else throw Object.assign(new Error('TOOL_PROPOSAL_FAILED'), { code: 'TOOL_PROPOSAL_FAILED' })
      if (interfaceMode !== 'skill-json') replies.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ status: 'applied', revision: state.document.revision, toolName: call.tool }) })
    }
    const dxf = await state.sdk.writeDocument(state.document, { format: 'DXF', version: '2018' })
    const handles = task.seed ? featureHandlesFromKJDrawDocument({ document: state.document, featureIds: state.featureIds }) : undefined
    const previousFeatureHandles = task.seed ? state.previousFeatureHandles : undefined
    record.validation = await scoreRound({ task, roundIndex: roundIndex - 1, dxf, featureHandles: handles, previousFeatureHandles })
    record.status = record.validation.passed ? 'passed' : 'geometry-failed'
    record.dxf = dxf
    if (task.seed) state.previousFeatureHandles = handles
    if (interfaceMode === 'skill-json') history.push({ role: 'user', content: prompt }, { role: 'assistant', content: response.content },
      { role: 'user', content: `Approved and applied ${calls.length} CAD call(s); current revision ${state.document.revision}.` })
    else history.push({ role: 'user', content: prompt }, { role: 'assistant', content: response.content ?? null, tool_calls: response.toolCalls }, ...replies)
  } catch (error) { record.failure = failureCode(error); record.status = record.failure.includes('TIMEOUT') ? 'timeout' : 'failed' }
  record.totalMs = performance.now() - started
  return record
}

async function runBaselineRound({ task, repetition, roundIndex, previous, history, modelCall, compileBaseline, scoreRound, provider, model, settings, timeoutMs, saveModelArtifacts }) {
  const record = baseRecord(task, arms[1], repetition, roundIndex), started = performance.now(), prompt = sharedPrompt(task, roundIndex)
  try {
    const request = buildDeclarativeEzdxfRequest({ model, userPrompt: prompt, settings, priorMessages: history, taskCategory: task.category })
    const response = await modelCall({ provider, model, messages: request.messages, settings, timeoutMs,
      arm: arms[1], taskId: task.id, repetition, roundIndex })
    record.usage = response.usage ?? null; record.transportLatencyMs = response.elapsedMs ?? null
    record.returnedModel = response.model ?? null
    await saveArtifact(saveModelArtifacts, { taskId: task.id, arm: arms[1], repetition, roundIndex }, response)
    const compiled = await compileBaseline({ task, roundIndex, content: response.content, ...(previous ? { previous } : {}) })
    if (!compiled.passed) {
      record.compilerReason = fixedReason(compiled.reason)
      throw Object.assign(new Error('BASELINE_COMPILATION_FAILED'), { code: 'BASELINE_COMPILATION_FAILED' })
    }
    record.validation = await scoreRound({ task, roundIndex: roundIndex - 1, dxf: compiled.dxf,
      featureHandles: compiled.features ?? undefined,
      previousFeatureHandles: roundIndex === 1 ? compiled.beforeFeatures ?? undefined : previous?.features ?? undefined })
    record.status = record.validation.passed ? 'passed' : 'geometry-failed'
    record.dxf = compiled.dxf
    record.featureIdentity = compiled.featureIdentity ?? null
    history.push({ role: 'user', content: prompt }, { role: 'assistant', content: response.content })
    return { record, next: compiled }
  } catch (error) { record.failure = failureCode(error); record.status = record.failure.includes('TIMEOUT') ? 'timeout' : 'failed' }
  finally { record.totalMs = performance.now() - started }
  return { record, next: null }
}

export async function runTokenEfficiencyBenchmark({ tasks, provider, model, settings = { temperature: 0, max_tokens: 4096 },
  repetitions = 3, timeoutMs = 60000, maxRequests, mode = 'fixture', interfaceMode = 'function-tools', reviewProposal,
  modelCall, compileBaseline = compileDeclarativeEzdxfRound, scoreRound = scoreTokenEfficiencyRound,
  scoreSeed = scoreTokenEfficiencySeed, createKjdraw = createTokenKjdrawArm,
  validatorProbe = probeLocalEzdxf, onRound, saveModelArtifacts, unitRepetition = null, protocolRepetitions = null } = {}) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.some(task => !supportedDeclarativeEzdxfTask(task))) throw new Error('SUPPORTED_TOKEN_TASKS_REQUIRED')
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('DUPLICATE_TASK_ID')
  if (!['fixture', 'pilot', 'live'].includes(mode) || !['function-tools', 'skill-json'].includes(interfaceMode) ||
    !['deepseek', 'qwen', 'glm'].includes(provider) || typeof model !== 'string' || !model ||
    !Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 30 ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new Error('INVALID_BENCHMARK_PLAN')
  const checkpointUnit = unitRepetition !== null
  if (checkpointUnit && (repetitions !== 1 || !Number.isSafeInteger(unitRepetition) || unitRepetition < 1 ||
    !Number.isSafeInteger(protocolRepetitions) || protocolRepetitions < 3 || unitRepetition > protocolRepetitions)) throw new Error('INVALID_CHECKPOINT_UNIT')
  if (mode === 'live' && repetitions < 3 && !checkpointUnit) throw new Error('LIVE_REPETITIONS_BELOW_PROTOCOL')
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
    ['model', 'messages', 'stream', 'tools', 'tool_choice', 'authorization', 'apiKey', 'api_key'].some(key => Object.hasOwn(settings, key))) throw new Error('INVALID_BENCHMARK_SETTINGS')
  const plannedRequests = tasks.reduce((total, task) => total + task.rounds.length, 0) * repetitions * 2
  if (!Number.isSafeInteger(maxRequests ?? plannedRequests) || (maxRequests ?? plannedRequests) < plannedRequests || (maxRequests ?? plannedRequests) > 3000) throw new Error('REQUEST_BUDGET_EXCEEDED')
  if (mode === 'fixture' && typeof modelCall !== 'function') throw new Error('FIXTURE_MODEL_REQUIRED')
  if (mode === 'live' && typeof reviewProposal !== 'function') throw new Error('EXPLICIT_REVIEW_CALLBACK_REQUIRED')
  if (onRound !== undefined && typeof onRound !== 'function') throw new Error('INVALID_ROUND_CALLBACK')
  if (saveModelArtifacts !== undefined && typeof saveModelArtifacts !== 'function') throw new Error('INVALID_ARTIFACT_CALLBACK')
  for (const task of tasks) for (let roundIndex = 1; roundIndex <= task.rounds.length; roundIndex++) kjdrawToolNamesForTask(task, roundIndex)
  if (mode !== 'fixture') {
    try { await validatorProbe() } catch { throw new Error('INDEPENDENT_VALIDATOR_UNAVAILABLE') }
  }
  modelCall ??= callBenchmarkModel
  const runs = []
  let stopReason = null, servedModel = null
  const recordRound = async record => { record.interfaceMode = interfaceMode; runs.push(record); if (onRound) await onRound(structuredClone(record)) }
  for (const task of tasks) for (let repetitionIndex = 1; repetitionIndex <= repetitions; repetitionIndex++) {
    const repetition = checkpointUnit ? unitRepetition : repetitionIndex
    for (const arm of repetition % 2 ? arms : [...arms].reverse()) {
      const history = [], state = !stopReason && arm === arms[0] ? await createKjdraw({ seed: task.seed, mode: mode === 'pilot' ? 'fixture' : mode }) : null
      let previous = null, seedScore = { passed: true }
      if (state && task.seed) {
        try { seedScore = await scoreKjdrawSeed(task, state, scoreSeed); state.previousFeatureHandles = featureHandlesFromKJDrawDocument({ document: state.document, featureIds: state.featureIds }) }
        catch { seedScore = { passed: false, reasons: ['SEED_VALIDATION_ERROR'] } }
      }
      let interrupted = !seedScore.passed
      for (let roundIndex = 1; roundIndex <= task.rounds.length; roundIndex++) {
        if (stopReason || interrupted) {
          const record = baseRecord(task, arm, repetition, roundIndex)
          record.failure = stopReason ? stopReason.startsWith('RETURNED_MODEL_') ? 'UNEXECUTED_AFTER_MODEL_MISMATCH' : 'UNEXECUTED_AFTER_PROVIDER_STOP'
            : roundIndex === 1 && !seedScore.passed ? 'SEED_INVALID' : 'UNEXECUTED_AFTER_PRIOR_FAILURE'
          record.unexecuted = true; await recordRound(record); continue
        }
        const result = arm === arms[0]
          ? await runKjdrawRound({ task, repetition, roundIndex, state, history, modelCall, scoreRound, provider, model, settings, timeoutMs, mode, interfaceMode, reviewProposal, saveModelArtifacts })
          : await runBaselineRound({ task, repetition, roundIndex, previous, history, modelCall, compileBaseline, scoreRound, provider, model, settings, timeoutMs, saveModelArtifacts })
        const record = arm === arms[0] ? result : result.record
        await recordRound(record)
        if (arm === arms[1]) previous = result.next
        if (stopOnProviderFailure(record.failure)) stopReason = record.failure
        if (!stopReason && !record.unexecuted && record.returnedModel !== null) {
          if (servedModel !== null && record.returnedModel !== servedModel) stopReason = 'RETURNED_MODEL_INCONSISTENT'
          else servedModel = record.returnedModel
        }
        if (record.status !== 'passed') interrupted = true
      }
    }
  }
  const aggregate = aggregateMultiroundComparison({ tasks, runs: checkpointUnit ? runs.map(run => ({ ...run, repetition: 1 })) : runs, arms, repetitions, evidence: { mode, verified: false } })
  const returnedModels = [...new Set(runs.map(run => run.returnedModel).filter(Boolean))]
  const consistentReturnedModel = returnedModels.length === 1 && runs.filter(run => !run.unexecuted && run.returnedModel !== null).every(run => run.returnedModel === returnedModels[0])
  return { schema: 'com.kanjie.kjdraw.benchmark.token-efficiency-run@3',
    kjdrawToolSurface: interfaceMode === 'skill-json' ? 'public-prompt-skill-json-v2' : 'public-prompt-compact-v2',
    interfaceMode, mode, provider, requestedModel: model,
    returnedModels, consistentReturnedModel,
    claimBlockedReasons: [...(mode !== 'live' ? ['NOT_LIVE_EVIDENCE'] : []), ...(consistentReturnedModel ? [] : ['INCONSISTENT_RETURNED_MODEL']), ...(stopReason ? [stopReason] : [])],
    toolRouting: Object.fromEntries(tasks.map(task => [task.id, task.rounds.map((_, index) => kjdrawToolNamesForTask(task, index + 1))])),
    stopReason, plannedRequests, attemptedRequests: runs.filter(run => !run.unexecuted).length,
    unexecutedRequests: runs.filter(run => run.unexecuted).length, runs, aggregate }
}

// One recoverable scheduler unit. The checkpoint owns the three-repetition
// protocol and full denominator; this result alone is never publishable.
export async function runTokenEfficiencyUnit({ task, repetition, protocolRepetitions = 3, ...options } = {}) {
  const result = await runTokenEfficiencyBenchmark({ ...options, tasks: [task], repetitions: 1,
    unitRepetition: repetition, protocolRepetitions })
  return { runs: result.runs, stopReason: result.stopReason, consistentReturnedModel: result.consistentReturnedModel }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('CLI is dry-run only; use the exported runner with explicit review for live calls')
  process.stdout.write(`${JSON.stringify({ ...tokenEfficiencyPlan({ tasks: tokenEfficiencyTaskCorpus, models: 1 }), runnerScope: 'simple-one-shot, multi-round-edit and complex-one-shot; this CLI makes no provider calls' }, null, 2)}\n`)
}
