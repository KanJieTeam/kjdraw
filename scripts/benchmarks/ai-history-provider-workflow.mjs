import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAiChatRuntime } from '../../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { canonicalStringify, deepFreeze, stableHash } from '../../packages/kjdraw-sdk/src/utils.js'
import { callBenchmarkModel } from './token-provider-transport.mjs'

const endpoints = Object.freeze({
  deepseek: 'https://api.deepseek.com/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
})
const defaultLabel = 'PUBLIC-HISTORY-PROJECT-2026'
const internalFailure = Symbol('bounded-workflow-failure')
const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : canonicalStringify(value)).digest('hex')
const requireCheck = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code, [internalFailure]: true }) }
const equal = (left, right) => canonicalStringify(left) === canonicalStringify(right)
const content = state => ({ ...structuredClone(state), revision: 0, revisions: [], metadata: { ...structuredClone(state.metadata), modifiedAt: null } })
const projection = entity => ({ id: entity.id, type: entity.type, payload: entity.payload })
const commandCounts = () => ({ textEdits: 0, undos: 0, redos: 0, localArchiveRefreshes: 0 })
const transportCodes = new Set(['MISSING_API_KEY', 'INVALID_REQUEST', 'INVALID_PROVIDER', 'INVALID_FIXTURE_ENDPOINT', 'INVALID_PROXY',
  'REQUEST_TOO_LARGE', 'RESPONSE_TOO_LARGE', 'PROVIDER_TIMEOUT', 'TRANSPORT_FAILURE', 'PROVIDER_RATE_LIMIT', 'PROVIDER_RESOURCE_UNAVAILABLE',
  'PROVIDER_AUTH_FAILURE', 'PROVIDER_PAYMENT_REQUIRED', 'PROVIDER_TRANSIENT_FAILURE', 'PROVIDER_HTTP_FAILURE', 'INVALID_PROVIDER_JSON',
  'INVALID_PROVIDER_RESPONSE', 'INCOMPLETE_PROVIDER_USAGE', 'PROVIDER_REFLECTED_CREDENTIAL'])

// Every prompt and oracle is frozen before the first model request. No prompt
// interpreter, operation routing, canned reply, retry or inverse edit lives here.
export function createAiHistoryWorkflowSpecification(initialText = defaultLabel) {
  requireCheck(typeof initialText === 'string' && initialText.length > 0 && initialText.length <= 512, 'INVALID_TARGET_TEXT')
  const first = initialText + '-A', second = initialText + '-B'
  return deepFreeze({ version: 'ai-real-history-workflow@1', initialText, first, second, steps: [
    { id: 'first-project-label-edit', command: 'TEXTEDIT', text: first, undoCount: 1, redoCount: 0,
      prompt: `Change the project label ${JSON.stringify(initialText)} to ${JSON.stringify(first)}. Edit that single TEXT object only. Keep its position, identifiers, native geometry, and every other object unchanged.` },
    { id: 'natural-previous-state', command: 'UNDO', text: initialText, undoCount: 0, redoCount: 1,
      prompt: 'Put the drawing back exactly as it was before the last change I approved.' },
    { id: 'natural-approved-state-again', command: 'REDO', text: first, undoCount: 1, redoCount: 0,
      prompt: 'Actually, use that same approved change again. Keep all the other objects as they were.' },
    { id: 'local-archive-refresh', command: null, text: first, undoCount: 1, redoCount: 0 },
    { id: 'natural-previous-state-after-refresh', command: 'UNDO', text: initialText, undoCount: 0, redoCount: 1,
      prompt: 'The page has been reopened. Bring back the state from immediately before the last approved change.' },
    { id: 'natural-approved-state-after-refresh', command: 'REDO', text: first, undoCount: 1, redoCount: 0,
      prompt: 'Use the saved approved result again; I want the revised project label back.' },
    { id: 'second-project-label-edit', command: 'TEXTEDIT', text: second, undoCount: 2, redoCount: 0,
      prompt: `Change the project label ${JSON.stringify(first)} to ${JSON.stringify(second)}. Keep everything else untouched.` },
  ] })
}

export async function createPublicAiHistoryDrawing({ targetText = defaultLabel } = {}) {
  createAiHistoryWorkflowSpecification(targetText)
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-provider-history-fixture', units: 'millimeter' })
  await document.transact('Public synthetic history workflow fixture', tx => {
    tx.createEntity('TEXT', { text: targetText, position: [10, 85, 0], height: 3 }, { id: 'project-label' })
    tx.createEntity('TEXT', { text: 'Retained public survey note', position: [10, 70, 0], height: 2 }, { id: 'retained-label' })
    tx.createEntity('LINE', { start: [10, 20, 0], end: [65, 20, 0] }, { id: 'retained-edge' })
    tx.createEntity('CIRCLE', { center: [125, 65, 0], radius: 14 }, { id: 'retained-circle' })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [160, 0], [160, 100], [0, 100]], closed: true }, { id: 'retained-outline' })
    tx.createEntity('HATCH', { patternName: 'ANSI31', solid: false, patternScale: 2, patternAngle: 30,
      boundaryLoops: [{ flags: 22, external: true, closed: true, vertices: [[75, 20], [105, 20], [105, 45], [75, 45]] }],
    }, { id: 'retained-hatch' })
  })
  return { bytes: new TextEncoder().encode(await sdk.writeDocument(document, { format: 'DXF' })), targetText }
}

function verifiedUsage(usage) {
  requireCheck(usage && ['inputTokens', 'outputTokens', 'totalTokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0), 'INCOMPLETE_PROVIDER_USAGE')
  requireCheck(usage.totalTokens === usage.inputTokens + usage.outputTokens, 'INCOMPLETE_PROVIDER_USAGE')
  const result = {}
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadInputTokens', 'cacheMissInputTokens', 'reasoningOutputTokens']) {
    const value = usage[key] ?? null
    requireCheck(value === null || Number.isSafeInteger(value) && value >= 0, 'INCOMPLETE_PROVIDER_USAGE')
    result[key] = value
  }
  return result
}

function normalizeDxfPayload(payload) {
  return JSON.parse(JSON.stringify({ normal: [0, 0, 1], ...payload }, (key, value) => {
    // DXF reimport creates new internal resource IDs; names and native handles
    // are checked separately. Current KJD objects are always compared exactly.
    if (key === 'rawTags' || key === 'contractVersion' || /Ids?$/.test(key)) return undefined
    return typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value
  }))
}

async function verifyReimports(chat, sdk, document) {
  const kjd = await sdk.readDocument(await chat.exportDocument('KJD'), { format: 'KJD' })
  requireCheck(kjd.validate().valid && equal(kjd.snapshot(), document.snapshot()), 'KJD_REIMPORT_MISMATCH')
  const dxf = await sdk.readDocument(await chat.exportDocument('DXF'), { format: 'DXF' })
  const expected = document.listEntities(), actual = dxf.listEntities()
  requireCheck(dxf.validate().valid && actual.length === expected.length, 'DXF_REIMPORT_MISMATCH')
  const handles = new Map(actual.map(entity => [entity.handle, entity]))
  requireCheck(handles.size === expected.length, 'DXF_HANDLE_MISMATCH')
  for (const entity of expected) {
    const reopened = handles.get(entity.handle)
    requireCheck(reopened && reopened.type === entity.type && equal(normalizeDxfPayload(reopened.payload), normalizeDxfPayload(entity.payload)), 'DXF_PAYLOAD_MISMATCH')
    for (const key of ['layerId', 'linetypeId', 'styleId', 'blockRecordId']) {
      requireCheck(document.getObject(entity.payload[key])?.name === dxf.getObject(reopened.payload[key])?.name, 'DXF_RESOURCE_MISMATCH')
    }
  }
  return { kjdExact: true, dxfHandlesExact: true, dxfPayloadsAtTolerance: true, dxfNumericTolerance: 1e-8 }
}

function reviewActualPlan(plan, step, before, expectedContent, targetId, history) {
  requireCheck(plan.command === step.command, 'UNEXPECTED_COMMAND')
  requireCheck(plan.status === 'awaiting-host-approval' && plan.documentId === before.id && plan.expectedRevision === before.revision, 'INVALID_PENDING_PLAN')
  requireCheck(plan.preview?.documentId === before.id && plan.preview.revision === before.revision && plan.preview.command === step.command, 'INVALID_PREVIEW')
  const beforeEntity = before.getObject(targetId), afterEntity = expectedContent.objects[targetId]
  requireCheck(equal(plan.preview.before, [projection(beforeEntity)]) && equal(plan.preview.after, [projection(afterEntity)]), 'EXACT_PREVIEW_MISMATCH')
  requireCheck(!plan.preview.recordChanges?.length && !plan.preview.designChange, 'UNEXPECTED_RECORD_CHANGE')
  if (step.command === 'TEXTEDIT') {
    requireCheck(equal(plan.arguments?.changes, [{ id: targetId, expectedText: beforeEntity.payload.text, text: step.text }]), 'UNEXPECTED_TEXT_ARGUMENTS')
  } else {
    const target = history[step.command === 'UNDO' ? 'undoTarget' : 'redoTarget']
    requireCheck(target && plan.arguments?.targetHistoryId === target.id && plan.preview.historyChange?.targetHistoryId === target.id, 'HISTORY_IDENTITY_MISMATCH')
    requireCheck(plan.preview.historyChange.targetRevision === target.revision && plan.preview.historyChange.beforeFingerprint === before.fingerprint() &&
      plan.preview.historyChange.afterFingerprint === stableHash(expectedContent), 'HISTORY_SNAPSHOT_MISMATCH')
  }
}

/** Actual provider is the default. An injected modelCall is allowed only with
 * fixture:true and cannot contribute to executedModelRequests or live evidence.
 * Reports omit all model/drawing text, prompts, arguments, identifiers and paths.
 * onReview may veto an already-oracle-checked actual pending plan; it cannot
 * override review checks. It receives private content only in process memory. */
export async function runAiHistoryProviderWorkflow({ provider = 'deepseek', model = 'deepseek-chat', bytes, targetText = defaultLabel,
  sourceKind = 'public-synthetic-dxf', maxRequests = 36, timeoutMs = 45000, roundTimeoutMs = 120000, maxDurationMs = 600000,
  modelCall, fixture = false, onProgress = () => {}, onReview } = {}) {
  requireCheck(Object.hasOwn(endpoints, provider) && typeof model === 'string' && model.length > 0 && model.length <= 256, 'INVALID_PROVIDER_CONFIG')
  for (const [value, minimum, maximum] of [[maxRequests, 1, 48], [timeoutMs, 100, 120000], [roundTimeoutMs, 100, 120000], [maxDurationMs, 100, 900000]]) {
    requireCheck(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'INVALID_BUDGET')
  }
  requireCheck(typeof fixture === 'boolean' && (modelCall === undefined || fixture && typeof modelCall === 'function'), 'FIXTURE_MODE_REQUIRED')
  requireCheck(typeof onProgress === 'function' && (onReview === undefined || typeof onReview === 'function'), 'INVALID_OBSERVER')
  requireCheck(['public-synthetic-dxf', 'private-local-dxf'].includes(sourceKind), 'INVALID_SOURCE_KIND')
  const specification = createAiHistoryWorkflowSpecification(targetText)
  if (bytes === undefined) bytes = (await createPublicAiHistoryDrawing({ targetText })).bytes
  requireCheck(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 20 * 1024 * 1024, 'INVALID_DRAWING_BYTES')
  const sdk = createKJDrawSDK(), source = await sdk.readDocument(bytes, { format: 'DXF' })
  const matches = source.listEntities({ type: 'TEXT', ownerId: source.spaces.modelSpaceId }).filter(entity => entity.payload.text === targetText)
  requireCheck(source.validate().valid && matches.length === 1, 'UNIQUE_NATIVE_TARGET_REQUIRED')
  const mode = fixture || process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT ? 'fixture' : 'real-provider'
  const callModel = modelCall ?? callBenchmarkModel
  const started = performance.now(), deadline = started + maxDurationMs
  const report = { schema: 'kjdraw-ai-history-provider-workflow@1', testedAt: new Date().toISOString(), mode, provider, requestedModel: model,
    sourceKind, sourceSha256: hash(bytes), specificationSha256: hash(specification), promptSha256: specification.steps.filter(step => step.prompt).map(step => hash(step.prompt)),
    scope: 'Cumulative imported-DXF label edits and real history; exact-oracle host approval, not an independent human acceptance score.',
    budgets: { maxRequests, timeoutMs, roundTimeoutMs, maxDurationMs, maxOutputTokens: 4096 },
    plannedSteps: 7, steps: [], trace: [], transportFailures: [], requests: 0, executedModelRequests: 0, fixtureRequests: 0,
    returnedModels: [], engineCounts: commandCounts(), passed: false }
  let activeStep = null, activeDeadline = deadline, chat
  const newRuntime = () => createAiChatRuntime({ provider, model, endpoint: endpoints[provider], protocol: 'chat-completions',
    // This is an inert adapter placeholder. Actual transport alone reads the
    // process credential, and no incoming runtime headers are forwarded.
    apiKey: 'process-transport-only', fetchImpl: async (_url, request) => {
      const requestIndex = report.requests + 1
      try {
        requireCheck(report.requests < maxRequests, 'MODEL_REQUEST_BUDGET')
        requireCheck(!request.signal?.aborted && performance.now() < Math.min(deadline, activeDeadline), 'WORKFLOW_TIMEOUT')
        const body = JSON.parse(request.body), { messages, model: requestedModel, stream: _stream, ...settings } = body
        if (provider === 'deepseek') settings.thinking = { type: 'disabled' }
        else if (provider === 'qwen') settings.enable_thinking = false
        report.requests++
        onProgress({ step: activeStep, phase: 'provider-request', request: requestIndex })
        const response = await callModel({ provider, model: requestedModel, messages, settings,
          timeoutMs: Math.max(100, Math.min(timeoutMs, Math.floor(Math.min(deadline, activeDeadline) - performance.now()))) })
        const usage = verifiedUsage(response.usage)
        requireCheck(typeof response.model === 'string' && response.model.length > 0 && response.model.length <= 256 &&
          (typeof response.content === 'string' || response.content === null) && Array.isArray(response.toolCalls) &&
          ['stop', 'tool_calls', 'length'].includes(response.finishReason), 'INVALID_PROVIDER_RESPONSE')
        const offered = new Set(body.tools?.map(tool => tool.function.name) ?? [])
        const item = { request: requestIndex, step: activeStep, returnedModel: response.model, usage,
          elapsedMs: Number.isFinite(response.elapsedMs) ? Math.round(response.elapsedMs) : null,
          toolCalls: response.toolCalls.map(tool => offered.has(tool.function?.name) ? tool.function.name : 'unrecognized-tool'),
          requestBytes: Buffer.byteLength(request.body) }
        report.trace.push(item)
        if (!report.returnedModels.includes(response.model)) report.returnedModels.push(response.model)
        if (mode === 'real-provider') report.executedModelRequests++
        else report.fixtureRequests++
        onProgress({ step: activeStep, phase: 'provider-response', request: requestIndex, tools: item.toolCalls, tokens: usage.totalTokens })
        return Response.json({ model: response.model, choices: [{ message: { role: 'assistant', content: response.content,
          tool_calls: response.toolCalls }, finish_reason: response.finishReason }], usage: {
          prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens,
          ...(usage.cacheReadInputTokens === null ? {} : { prompt_cache_hit_tokens: usage.cacheReadInputTokens }),
          ...(usage.cacheMissInputTokens === null ? {} : { prompt_cache_miss_tokens: usage.cacheMissInputTokens }),
          ...(usage.reasoningOutputTokens === null ? {} : { completion_tokens_details: { reasoning_tokens: usage.reasoningOutputTokens } }),
        } })
      } catch (error) {
        const code = ['MODEL_REQUEST_BUDGET', 'WORKFLOW_TIMEOUT'].includes(error?.code) || transportCodes.has(error?.code) ? error.code : 'TRANSPORT_FAILURE'
        report.transportFailures.push({ request: requestIndex, step: activeStep, code })
        return Response.json({ error: { code } }, { status: 503 })
      }
    } })
  chat = newRuntime()
  try {
    await chat.importDocument(new File([bytes], 'input.dxf'))
    const initial = await sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    const target = initial.listEntities().find(entity => entity.handle === matches[0].handle)
    requireCheck(target && target.payload.text === targetText && !chat.drawingHistory.canUndo && !chat.drawingHistory.canRedo, 'IMPORT_BASELINE_MISMATCH')
    const targetId = target.id, baselineContent = content(initial.snapshot())
    report.entityCount = initial.listEntities().length
    report.objectCount = Object.keys(initial.snapshot().objects).length
    report.targetIdentitySha256 = hash({ id: target.id, handle: target.handle })
    for (const [index, step] of specification.steps.entries()) {
      activeStep = step.id
      activeDeadline = Math.min(deadline, performance.now() + roundTimeoutMs)
      const entry = { step: index + 1, id: step.id, command: step.command, status: 'unexecuted', passed: false, requests: 0 }
      report.steps.push(entry)
      const beforeRequests = report.requests, stepStarted = performance.now()
      let result, stage = 'current-snapshot'
      try {
        requireCheck(performance.now() < deadline, 'WORKFLOW_TIMEOUT')
        const beforeState = await chat.exportLocalState(), before = await sdk.readDocument(beforeState.drawing, { format: 'KJD' })
        entry.beforeRevision = before.revision
        const expectedContent = structuredClone(baselineContent)
        expectedContent.objects[targetId].payload.text = step.text
        if (step.command === null) {
          stage = 'local-archive-refresh'
          requireCheck(beforeState.drawingHistory && beforeState.drawingHistory.undo.length === 1 && beforeState.drawingHistory.redo.length === 0, 'ARCHIVE_UNAVAILABLE')
          const previousTarget = chat.drawingHistory.undoTarget.id, previous = chat
          chat = newRuntime()
          await chat.restoreLocalState(beforeState)
          previous.destroy()
          requireCheck(!chat.historyRestoreWarning && chat.drawingHistory.undoTarget?.id !== previousTarget, 'ARCHIVE_RESTORE_FAILED')
          requireCheck((await chat.exportLocalState()).drawing === beforeState.drawing && report.requests === beforeRequests, 'REFRESH_CONTENT_MISMATCH')
          report.engineCounts.localArchiveRefreshes++
          entry.status = 'restored'
        } else {
          stage = 'model-response'
          onProgress({ step: activeStep, phase: 'round-start' })
          result = await chat.send(step.prompt, { signal: AbortSignal.timeout(roundTimeoutMs) })
          entry.status = ['proposal', 'message', 'error', 'cancelled'].includes(result.status) ? result.status : 'invalid'
          stage = 'proposal-isolation'
          requireCheck((await chat.exportLocalState()).drawing === beforeState.drawing, 'PROPOSAL_MUTATED_DRAWING')
          stage = 'pending-plan'
          requireCheck(result.status === 'proposal' && result.proposals?.length === 1, 'MODEL_DID_NOT_PROPOSE_ONE_PLAN')
          stage = 'exact-plan-review'
          reviewActualPlan(result.proposal, step, before, expectedContent, targetId, chat.drawingHistory)
          if (onReview) requireCheck(await onReview(deepFreeze({ step: step.id, proposal: structuredClone(result.proposal) })) !== false, 'REVIEW_VETOED')
          stage = 'host-approval'
          requireCheck((await chat.approve(result.proposal.planId)).status === 'applied', 'APPROVAL_FAILED')
          entry.status = 'applied'
        }
        stage = 'committed-snapshot'
        const after = await sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
        requireCheck(equal(content(after.snapshot()), expectedContent), 'FULL_SNAPSHOT_MISMATCH')
        requireCheck(after.getObject(targetId)?.payload.text === step.text && after.getObject(targetId)?.handle === target.handle, 'TARGET_IDENTITY_MISMATCH')
        for (const [id, object] of Object.entries(before.snapshot().objects)) {
          if (id !== targetId) requireCheck(equal(after.getObject(id), object), 'UNTOUCHED_OBJECT_MISMATCH')
        }
        requireCheck(chat.drawingHistory.undoCount === step.undoCount && chat.drawingHistory.redoCount === step.redoCount, 'HISTORY_STACK_MISMATCH')
        if (step.command) {
          requireCheck(after.revision === before.revision + 1, 'REVISION_MISMATCH')
          if (step.command !== 'TEXTEDIT') requireCheck(after.snapshot().revisions.at(-1)?.kind === step.command.toLowerCase() &&
            after.snapshot().revisions.at(-1)?.operationCount === 0, 'BUILTIN_HISTORY_AUDIT_MISMATCH')
        }
        stage = 'save-reimport'
        entry.reimport = await verifyReimports(chat, sdk, after)
        if (step.command === 'TEXTEDIT') report.engineCounts.textEdits++
        else if (step.command === 'UNDO') report.engineCounts.undos++
        else if (step.command === 'REDO') report.engineCounts.redos++
        entry.afterRevision = after.revision
        entry.snapshotSha256 = hash(expectedContent)
        entry.untouchedObjects = report.objectCount - 1
        entry.passed = true
      } catch (error) {
        for (const plan of result?.proposals ?? (result?.proposal ? [result.proposal] : [])) {
          try { chat.reject(plan.planId) } catch { /* No approval or synthetic inverse is attempted. */ }
        }
        entry.failureStage = stage
        entry.failureCode = error?.[internalFailure] ? error.code : 'WORKFLOW_VERIFICATION_FAILED'
        // Preserve cumulative semantics; later steps are explicitly unexecuted.
      }
      entry.requests = report.requests - beforeRequests
      entry.elapsedMs = Math.round(performance.now() - stepStarted)
      onProgress({ step: activeStep, phase: entry.passed ? 'round-passed' : 'round-failed', requests: entry.requests,
        ...(entry.passed ? {} : { code: entry.failureCode, stage: entry.failureStage }) })
      if (!entry.passed) {
        for (const remaining of specification.steps.slice(index + 1)) report.steps.push({ step: report.steps.length + 1,
          id: remaining.id, command: remaining.command, status: 'unexecuted', requests: 0, passed: false })
        break
      }
    }
    const final = await sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    report.final = { revision: final.revision, snapshotSha256: hash(content(final.snapshot())),
      entityCount: final.listEntities().length, objectCount: Object.keys(final.snapshot().objects).length,
      undoCount: chat.drawingHistory.undoCount, redoCount: chat.drawingHistory.redoCount }
    report.passed = report.steps.length === 7 && report.steps.every(step => step.passed)
    report.completeUsage = report.trace.length === report.requests
    report.verifiedTokens = report.completeUsage ? report.trace.reduce((sum, item) => sum + item.usage.totalTokens, 0) : null
    report.elapsedMs = Math.round(performance.now() - started)
    return report
  } finally { chat.destroy() }
}

function parseCli(argv) {
  const options = {}, valued = new Set(['--provider', '--model', '--drawing', '--target-text', '--output', '--max-requests', '--timeout-ms', '--round-timeout-ms', '--max-duration-ms'])
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (key === '--run' || key === '--help') { options[key] = true; continue }
    requireCheck(valued.has(key) && !Object.hasOwn(options, key) && typeof argv[index + 1] === 'string' && !argv[index + 1].startsWith('--'), 'INVALID_CLI_OPTIONS')
    options[key] = argv[++index]
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseCli(process.argv.slice(2))
    if (!options['--run'] || options['--help']) {
      console.log(JSON.stringify({ schema: 'kjdraw-ai-history-provider-workflow@1', mode: 'dry-run', requests: 0,
        plannedModelRounds: 6, plannedLocalArchiveRefreshes: 1, defaultProvider: 'deepseek', defaultModel: 'deepseek-chat',
        run: '--run --provider deepseek --model deepseek-chat --output .cache/NEW-REPORT.json',
        privateSource: '--drawing FILE --target-text EXACT-LABEL (sends drawing query context to the selected provider; does not overwrite source)',
        approval: 'Exact-oracle review of actual pending plans; unexpected commands are rejected.',
      }, null, 2))
    } else {
      requireCheck(!options['--drawing'] || options['--target-text'], 'PRIVATE_TARGET_TEXT_REQUIRED')
      const cacheRoot = resolve(process.cwd(), '.cache')
      const output = resolve(options['--output'] ?? resolve(cacheRoot, 'agent-history-provider-' + Date.now() + '.json'))
      const outputRelative = relative(cacheRoot, output)
      requireCheck(outputRelative && outputRelative !== '..' && !outputRelative.startsWith('..' + sep) && !isAbsolute(outputRelative) && output.endsWith('.json'), 'NEW_CACHE_OUTPUT_REQUIRED')
      let outputExists = false
      try { await lstat(output); outputExists = true } catch (error) { requireCheck(error.code === 'ENOENT', 'REPORT_PRECHECK_FAILED') }
      requireCheck(!outputExists, 'NEW_CACHE_OUTPUT_REQUIRED')
      let bytes
      if (options['--drawing']) {
        try { bytes = new Uint8Array(await readFile(options['--drawing'])) } catch { requireCheck(false, 'INPUT_READ_FAILED') }
      }
      const report = await runAiHistoryProviderWorkflow({ provider: options['--provider'] ?? 'deepseek', model: options['--model'] ?? 'deepseek-chat',
        bytes, targetText: options['--target-text'] ?? defaultLabel, sourceKind: bytes ? 'private-local-dxf' : 'public-synthetic-dxf',
        ...(options['--max-requests'] ? { maxRequests: Number(options['--max-requests']) } : {}),
        ...(options['--timeout-ms'] ? { timeoutMs: Number(options['--timeout-ms']) } : {}),
        ...(options['--round-timeout-ms'] ? { roundTimeoutMs: Number(options['--round-timeout-ms']) } : {}),
        ...(options['--max-duration-ms'] ? { maxDurationMs: Number(options['--max-duration-ms']) } : {}),
      })
      await mkdir(dirname(output), { recursive: true })
      try { await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }) }
      catch { requireCheck(false, 'REPORT_WRITE_FAILED') }
      console.log(JSON.stringify(report, null, 2))
      process.exitCode = report.passed ? 0 : 1
    }
  } catch (error) {
    console.log(JSON.stringify({ schema: 'kjdraw-ai-history-provider-workflow@1', passed: false,
      failure: error?.[internalFailure] ? error.code : 'WORKFLOW_SETUP_FAILED' }))
    process.exitCode = 1
  }
}
