// Recoverable, single-writer checkpoint for paired token experiments. This
// module does not call a provider; the trusted caller supplies executeUnit.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'
import { aggregateMultiroundComparison } from './aggregate-multiround-comparison.mjs'

const schema = 'com.kanjie.kjdraw.benchmark.token-checkpoint@2'
const arms = ['kjdraw-tool', 'declarative-ezdxf']
const hash = value => createHash('sha256').update(value).digest('hex')
const jsonHash = value => hash(JSON.stringify(value))
const safeName = value => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const finiteMs = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const failureCode = error => [error?.code, error?.message].find(value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,64}$/.test(value)) ?? 'UNIT_EXECUTION_FAILED'
const providerStop = code => code.startsWith('PROVIDER_') || ['MODEL_VERSION_DRIFT', 'MISSING_API_KEY',
  'TRANSPORT_FAILURE', 'RESPONSE_TOO_LARGE', 'INCOMPLETE_PROVIDER_USAGE', 'ARTIFACT_PERSISTENCE_FAILED'].includes(code)
const unitKey = (task, modelIndex, repetition) => hash(JSON.stringify([task.id, modelIndex, repetition])).slice(0, 32)
const expectedSlots = task => task.rounds.flatMap((_, index) => arms.map(arm => `${arm}:${index + 1}`))
const responseArtifactName = (arm, roundIndex) => `round-${roundIndex}-${arm}.response.json`
const secretValues = () => ['KJDRAW_DEEPSEEK_API_KEY', 'KJDRAW_QWEN_API_KEY', 'KJDRAW_GLM_API_KEY']
  .map(name => process.env[name]).filter(value => typeof value === 'string' && value.length >= 4)
const secretField = key => /^(?:api[_-]?key|authorization|headers|secret|password)$/i.test(key)
function redactModelResponse(value, secrets, depth = 0) {
  if (depth > 20) throw new Error('INVALID_MODEL_RESPONSE_ARTIFACT')
  if (typeof value === 'string') return secrets.reduce((result, secret) => result.replaceAll(secret, '[REDACTED]'), value)
  if (Array.isArray(value)) return value.map(item => redactModelResponse(item, secrets, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !secretField(key)).map(([key, item]) => [key, redactModelResponse(item, secrets, depth + 1)]))
  if (value === null || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') return value
  throw new Error('INVALID_MODEL_RESPONSE_ARTIFACT')
}

function sanitizeModelArtifacts(result, task, repetition, outputs) {
  if (result.modelArtifacts === undefined) return [] // Older trusted executor; CLI always supplies this field.
  if (!Array.isArray(result.modelArtifacts)) throw new Error('INVALID_MODEL_RESPONSE_ARTIFACT')
  const secrets = secretValues(), slots = new Set(), artifacts = result.modelArtifacts.map(item => {
    if (item?.taskId !== task.id || item.repetition !== repetition || !arms.includes(item.arm) ||
      !Number.isSafeInteger(item.roundIndex) || item.roundIndex < 1 || item.roundIndex > task.rounds.length ||
      !['function-tools', 'skill-json'].includes(item.interfaceMode) || !item.response || typeof item.response !== 'object' ||
      Array.isArray(item.response)) throw new Error('INVALID_MODEL_RESPONSE_ARTIFACT')
    const slot = `${item.arm}:${item.roundIndex}`
    if (slots.has(slot)) throw new Error('DUPLICATE_MODEL_RESPONSE_ARTIFACT')
    slots.add(slot)
    const response = redactModelResponse({ content: item.response.content ?? null, toolCalls: item.response.toolCalls ?? [],
      usage: item.response.usage ?? null, elapsedMs: item.response.elapsedMs ?? null, model: item.response.model ?? null }, secrets)
    if (typeof response.content !== 'string' && response.content !== null || !Array.isArray(response.toolCalls) ||
      response.usage !== null && (typeof response.usage !== 'object' || Array.isArray(response.usage)) ||
      response.elapsedMs !== null && !finiteMs(response.elapsedMs) ||
      response.model !== null && typeof response.model !== 'string') throw new Error('INVALID_MODEL_RESPONSE_ARTIFACT')
    const raw = Buffer.from(JSON.stringify({ taskId: task.id, arm: item.arm, repetition, roundIndex: item.roundIndex,
      interfaceMode: item.interfaceMode, response }))
    if (raw.length > 4 * 1024 * 1024) throw new Error('MODEL_RESPONSE_ARTIFACT_TOO_LARGE')
    return { slot, name: responseArtifactName(item.arm, item.roundIndex), raw }
  })
  for (const { record } of outputs) if (!record.unexecuted && record.usage !== null && !slots.has(`${record.arm}:${record.roundIndex}`)) throw new Error('MISSING_MODEL_RESPONSE_ARTIFACT')
  return artifacts
}

export function tokenCheckpointPlan({ tasks, models, repetitions = 3, executionMode = 'fixture', executionContextSha256 = null } = {}) {
  if (!Array.isArray(tasks) || !tasks.length || new Set(tasks.map(task => task?.id)).size !== tasks.length ||
    tasks.some(task => !safeName(task?.id) || !Array.isArray(task.rounds) || !task.rounds.length || !Array.isArray(task.expectedRounds) || task.expectedRounds.length !== task.rounds.length)) throw new TypeError('Provide fixed tasks with distinct IDs and complete rounds')
  if (!Array.isArray(models) || !models.length || models.some(model => !safeName(model?.provider) || !safeName(model?.model) || !model.settings || typeof model.settings !== 'object' || Array.isArray(model.settings))) throw new TypeError('Provide explicit models and settings')
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 30) throw new TypeError('Choose 1–30 repetitions')
  if (!['fixture', 'pilot', 'live'].includes(executionMode) || executionContextSha256 !== null && !/^[0-9a-f]{64}$/.test(executionContextSha256)) throw new TypeError('Invalid execution mode or pinned context')
  if (executionMode === 'live' && repetitions < 3) throw new TypeError('Live protocol requires at least three repetitions')
  const corpusSha256 = jsonHash(tasks), modelPlan = models.map(({ provider, model, settings }) => ({ provider, model, settingsSha256: jsonHash(settings) }))
  const tasksPlan = tasks.map(task => ({ id: task.id, version: task.version ?? null, rounds: task.rounds.length, acceptanceSha256: task.acceptanceSha256 ?? null }))
  const plan = { schema, mode: 'dry-run', executionMode, executionContextSha256, corpusSha256, tasks: tasksPlan, models: modelPlan, repetitions,
    plannedUnits: tasks.length * models.length * repetitions,
    plannedRoundAttempts: tasks.reduce((total, task) => total + task.rounds.length, 0) * models.length * repetitions * arms.length }
  return { ...plan, planSha256: jsonHash(plan) }
}

function sanitizeRun(run, task, repetition) {
  if (!run || !arms.includes(run.arm) || !Number.isSafeInteger(run.roundIndex) || run.roundIndex < 1 || run.roundIndex > task.rounds.length ||
    run.taskId !== task.id || run.repetition !== repetition || typeof run.status !== 'string' || !/^[a-z-]{2,40}$/.test(run.status) ||
    typeof run.validation?.passed !== 'boolean') throw new Error('INCOMPLETE_UNIT')
  const usage = run.usage && typeof run.usage === 'object' ? {
    inputTokens: count(run.usage.inputTokens) ? run.usage.inputTokens : null,
    outputTokens: count(run.usage.outputTokens) ? run.usage.outputTokens : null,
    totalTokens: count(run.usage.totalTokens) ? run.usage.totalTokens : null,
    cacheReadInputTokens: count(run.usage.cacheReadInputTokens) ? run.usage.cacheReadInputTokens : null,
    reasoningOutputTokens: count(run.usage.reasoningOutputTokens) ? run.usage.reasoningOutputTokens : null,
  } : null
  const reasons = Array.isArray(run.validation.reasons) ? run.validation.reasons : []
  if (reasons.some(reason => typeof reason !== 'string' || !/^[A-Z][A-Z0-9_]{1,80}$/.test(reason))) throw new Error('INVALID_VALIDATION_REASONS')
  const returnedModel = run.returnedModel == null ? null : run.returnedModel
  if (returnedModel !== null && !safeName(returnedModel)) throw new Error('INVALID_RETURNED_MODEL')
  const record = { taskId: task.id, arm: run.arm, repetition, roundIndex: run.roundIndex,
    status: run.status, validation: { passed: run.validation.passed, reasons }, usage,
    totalMs: finiteMs(run.totalMs) ? run.totalMs : null,
    transportLatencyMs: finiteMs(run.transportLatencyMs) ? run.transportLatencyMs : null,
    returnedModel, failure: /^[A-Z][A-Z0-9_]{2,64}$/.test(run.failure ?? '') ? run.failure : null,
    toolCallCount: count(run.toolCallCount) ? run.toolCallCount : null,
    unexecuted: run.unexecuted === true,
    review: { kind: safeName(run.review?.kind) ? run.review.kind : 'none', approved: run.review?.approved === true },
  }
  return { record, dxf: typeof run.dxf === 'string' && run.dxf ? run.dxf : null }
}

function acceptedUnit(result, task, repetition, returnedModel) {
  if (!Array.isArray(result?.runs) || result.runs.length !== expectedSlots(task).length) throw new Error('INCOMPLETE_UNIT')
  const outputs = result.runs.map(run => sanitizeRun(run, task, repetition))
  const slots = outputs.map(({ record }) => `${record.arm}:${record.roundIndex}`)
  if (new Set(slots).size !== slots.length || expectedSlots(task).some(slot => !slots.includes(slot))) throw new Error('INCOMPLETE_UNIT')
  const fatal = outputs.map(({ record }) => record.failure).find(code => code && providerStop(code))
  if (fatal) throw Object.assign(new Error(fatal), { code: fatal })
  const versions = [...new Set(outputs.filter(({ record }) => !record.unexecuted).map(({ record }) => record.returnedModel))]
  if (versions.length !== 1 || versions[0] === null || returnedModel && versions[0] !== returnedModel) throw Object.assign(new Error('MODEL_VERSION_DRIFT'), { code: 'MODEL_VERSION_DRIFT' })
  return { outputs, returnedModel: versions[0], modelArtifacts: sanitizeModelArtifacts(result, task, repetition, outputs) }
}

async function committed(unitFolder, key, planSha256, task, modelIndex, repetition) {
  let files
  try { files = await readdir(unitFolder) } catch { return { evidence: null, invalid: 0 } }
  let invalid = 0, valid = []
  for (const file of files.filter(name => /^commit-[0-9a-f-]{36}\.json$/.test(name))) {
    try {
      const commit = JSON.parse(await readFile(join(unitFolder, file), 'utf8'))
      if (commit.schema !== schema || commit.unitKey !== key || commit.planSha256 !== planSha256 || !/^[0-9a-f-]{36}$/.test(commit.attemptId) || !/^[0-9a-f]{64}$/.test(commit.evidenceSha256)) throw Error('INVALID_COMMIT')
      const attemptFolder = join(unitFolder, `attempt-${commit.attemptId}`)
      const raw = await readFile(join(attemptFolder, 'evidence.json'))
      if (hash(raw) !== commit.evidenceSha256) throw Error('EVIDENCE_HASH_MISMATCH')
      const evidence = JSON.parse(raw)
      if (evidence.schema !== schema || evidence.unitKey !== key || evidence.planSha256 !== planSha256 ||
        evidence.taskId !== task.id || evidence.modelIndex !== modelIndex || evidence.repetition !== repetition ||
        !Array.isArray(evidence.runs) || evidence.runs.length !== expectedSlots(task).length ||
        new Set(evidence.runs.map(run => `${run.arm}:${run.roundIndex}`)).size !== expectedSlots(task).length ||
        expectedSlots(task).some(slot => !evidence.runs.some(run => `${run.arm}:${run.roundIndex}` === slot))) throw Error('INVALID_EVIDENCE')
      if (!Array.isArray(evidence.artifacts) || new Set(evidence.artifacts.map(item => item.name)).size !== evidence.artifacts.length) throw Error('INVALID_ARTIFACT')
      const artifactNames = new Set(evidence.artifacts.map(item => item.name))
      for (const run of evidence.runs) {
        for (const name of [run.dxfArtifact, run.modelResponseArtifact]) if (name !== null && !artifactNames.has(name)) throw Error('MISSING_REFERENCED_ARTIFACT')
      }
      for (const artifact of evidence.artifacts) {
        if (!/^round-\d+-(kjdraw-tool|declarative-ezdxf)(?:\.dxf|\.response\.json)$/.test(artifact.name) || !/^[0-9a-f]{64}$/.test(artifact.sha256)) throw Error('INVALID_ARTIFACT')
        if (hash(await readFile(join(attemptFolder, artifact.name))) !== artifact.sha256) throw Error('ARTIFACT_HASH_MISMATCH')
      }
      valid.push(evidence)
    } catch { invalid++ }
  }
  if (valid.length > 1) throw new Error('DUPLICATE_VALID_CHECKPOINT')
  return { evidence: valid[0] ?? null, invalid }
}

async function saveUnit(unitFolder, planSha256, key, task, modelIndex, repetition, accepted) {
  const attemptId = randomUUID(), attemptFolder = join(unitFolder, `attempt-${attemptId}`)
  await mkdir(attemptFolder, { recursive: false })
  const artifacts = [], runs = []
  for (const { record, dxf } of accepted.outputs) {
    if (dxf) {
      const name = `round-${record.roundIndex}-${record.arm}.dxf`
      const bytes = Buffer.from(dxf)
      await writeFile(join(attemptFolder, name), bytes, { flag: 'wx' })
      artifacts.push({ name, sha256: hash(bytes), bytes: bytes.length })
      runs.push({ ...record, dxfArtifact: name, modelResponseArtifact: null })
    } else runs.push({ ...record, dxfArtifact: null, modelResponseArtifact: null })
  }
  for (const artifact of accepted.modelArtifacts) {
    await writeFile(join(attemptFolder, artifact.name), artifact.raw, { flag: 'wx' })
    artifacts.push({ name: artifact.name, sha256: hash(artifact.raw), bytes: artifact.raw.length })
    const record = runs.find(run => `${run.arm}:${run.roundIndex}` === artifact.slot)
    if (!record) throw new Error('INVALID_MODEL_RESPONSE_ARTIFACT')
    record.modelResponseArtifact = artifact.name
  }
  const evidence = { schema, planSha256, unitKey: key, taskId: task.id, modelIndex, repetition,
    returnedModel: accepted.returnedModel, runs, artifacts }
  const raw = Buffer.from(JSON.stringify(evidence))
  await writeFile(join(attemptFolder, 'evidence.json'), raw, { flag: 'wx' })
  const commit = { schema, planSha256, unitKey: key, attemptId, evidenceSha256: hash(raw) }
  const temporary = join(unitFolder, `.commit-${attemptId}.tmp`), destination = join(unitFolder, `commit-${attemptId}.json`)
  await writeFile(temporary, JSON.stringify(commit), { flag: 'wx' })
  await rename(temporary, destination)
  return evidence
}

export async function runCheckpointedTokenBenchmark({ tasks, models, repetitions = 3, executionMode = 'fixture', executionContextSha256 = null, output, executeUnit, dryRun = true } = {}) {
  const plan = tokenCheckpointPlan({ tasks, models, repetitions, executionMode, executionContextSha256 })
  if (dryRun) return { ...plan, remainingUnits: plan.plannedUnits, attemptedUnits: 0, note: 'Dry run: no files or provider calls' }
  if (typeof output !== 'string' || !output.trim() || parse(resolve(output)).root === resolve(output) || typeof executeUnit !== 'function') throw new TypeError('Explicit non-root output and executeUnit required')
  const root = resolve(output), planFile = join(root, 'plan.json')
  await mkdir(root, { recursive: true })
  try { await writeFile(planFile, JSON.stringify(plan), { flag: 'wx' }) }
  catch (error) { if (error?.code !== 'EEXIST') throw error; const prior = JSON.parse(await readFile(planFile, 'utf8')); if (JSON.stringify(prior) !== JSON.stringify(plan)) throw new Error('CHECKPOINT_PLAN_MISMATCH') }
  const unitsFolder = join(root, 'units'); await mkdir(unitsFolder, { recursive: true })
  const collected = [], returnedByModel = new Map(), summary = { ...plan, mode: 'checkpoint', resumedUnits: 0, executedUnits: 0, invalidCommits: 0, stopped: false, stopReason: null }
  outer: for (const task of tasks) for (let modelIndex = 0; modelIndex < models.length; modelIndex++) for (let repetition = 1; repetition <= repetitions; repetition++) {
    const key = unitKey(task, modelIndex, repetition), folder = join(unitsFolder, key)
    await mkdir(folder, { recursive: true })
    const found = await committed(folder, key, plan.planSha256, task, modelIndex, repetition)
    summary.invalidCommits += found.invalid
    let evidence = found.evidence
    if (evidence) summary.resumedUnits++
    else {
      let accepted
      try { accepted = acceptedUnit(await executeUnit({ task, model: models[modelIndex], modelIndex, repetition }), task, repetition, returnedByModel.get(modelIndex)) }
      catch (error) { summary.stopped = true; summary.stopReason = failureCode(error); break outer }
      evidence = await saveUnit(folder, plan.planSha256, key, task, modelIndex, repetition, accepted)
      summary.executedUnits++
    }
    const priorVersion = returnedByModel.get(modelIndex)
    if (priorVersion && priorVersion !== evidence.returnedModel) { summary.stopped = true; summary.stopReason = 'MODEL_VERSION_DRIFT'; break outer }
    returnedByModel.set(modelIndex, evidence.returnedModel)
    collected.push(evidence)
  }
  summary.completeUnits = collected.length
  summary.remainingUnits = plan.plannedUnits - collected.length
  summary.aggregates = models.map((model, modelIndex) => aggregateMultiroundComparison({ tasks,
    runs: collected.filter(item => item.modelIndex === modelIndex).flatMap(item => item.runs), arms, repetitions,
    evidence: { mode: 'live', verified: false } }))
  return summary
}
