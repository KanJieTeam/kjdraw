import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { independentValidation, pairedModelPlan, taskBudgetCompliance } from '../../../scripts/benchmarks/paired-model-benchmark.mjs'
import { behavioralLiveConfiguration, behavioralModelPlan, createBehavioralLiveInvoker, releaseHoldoutModelGatePlan, runBehavioralScenario, runBehavioralSuite } from '../../../scripts/benchmarks/release-holdout-behavioral-runner.mjs'
import { releaseHoldoutBehavioralTasks, releaseHoldoutDrawingTool, releaseHoldoutGenerationTasks, releaseHoldoutSuiteSchema, releaseHoldoutSuiteVersion, releaseHoldoutTaskSuite } from '../../../scripts/benchmarks/release-holdout-task-suite.mjs'

const python = process.env.KJDRAW_PYTHON ?? 'python'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

test('release holdout has thirty unique versioned cases split into honest paired and behavioral protocols', () => {
  assert.equal(releaseHoldoutSuiteVersion, '1.0.0')
  assert.equal(releaseHoldoutSuiteSchema, 'com.kanjie.kjdraw.benchmark.release-holdout@1')
  assert.equal(releaseHoldoutTaskSuite.length, 30)
  assert.equal(releaseHoldoutGenerationTasks.length, 17)
  assert.equal(releaseHoldoutBehavioralTasks.length, 13)
  assert.equal(new Set(releaseHoldoutTaskSuite.map(task => task.id)).size, 30)
  assert.equal(new Set(releaseHoldoutTaskSuite.map(task => task.kind === 'paired-generation' ? task.prompt : task.turns.map(turn => turn.prompt).join('\n'))).size, 30)
  assert.equal(new Set(releaseHoldoutTaskSuite.map(task => task.kind === 'paired-generation' ? task.referenceInputSha256 : task.seedSha256)).size, 30)
  assert.equal(new Set(releaseHoldoutTaskSuite.map(task => task.acceptanceSha256)).size, 30)
  assert.deepEqual(Object.fromEntries([...new Set(releaseHoldoutTaskSuite.map(task => task.category))].sort().map(category => [category, releaseHoldoutTaskSuite.filter(task => task.category === category).length])), {
    'adversarial-drawing-text': 3, architecture: 4, 'complex-mechanical': 5, 'continuous-modification': 4,
    'error-correction': 3, 'missing-context': 3, 'simple-construction': 4, 'site-pipeline': 4,
  })
  for (const task of releaseHoldoutTaskSuite) {
    assert.equal(task.version, releaseHoldoutSuiteVersion)
    assert.match(task.id, /^[a-z0-9-]+$/)
    assert.equal(task.acceptanceSha256, hash(task.expected))
    assert.deepEqual(Object.keys(task.budget).sort(), ['maxHumanInterventions', 'maxInputTokens', 'maxOutputTokens', 'maxToolCalls', 'maxWallTimeMs'].sort())
    assert.ok(Object.values(task.budget).every(value => Number.isSafeInteger(value) && value >= 0))
    assert.equal(task.budget.maxHumanInterventions, 0)
    if (task.kind === 'paired-generation') {
      assert.ok(['cad_propose_drawing_annotated', 'cad_propose_manufacturing_sheet', 'cad_propose_architecture_plan', 'cad_propose_site_plan'].includes(task.drawingTool))
      assert.equal(task.referenceInputSha256, hash(task.referenceInput))
      assert.ok(['millimeter', 'meter'].includes(task.units))
    } else {
      assert.equal(task.seedSha256, hash(task.seed))
      assert.equal(task.expected.initialRevision, 1)
      assert.ok(task.turns.every(turn => turn.allowedTools.length === turn.expectedToolCalls))
      assert.ok(task.turns.every(turn => Number.isSafeInteger(turn.expectedRevisionAfter) && Array.isArray(turn.changedIds) && Array.isArray(turn.unchangedIds) && turn.expectedEntities))
    }
  }
  assert.ok(releaseHoldoutTaskSuite.filter(task => task.category === 'missing-context').every(task => task.expected.mode === 'clarification' && task.budget.maxToolCalls === 0 && task.turns[0].allowedTools.length === 0))
  assert.ok(releaseHoldoutTaskSuite.filter(task => task.category === 'site-pipeline').every(task => task.units === 'meter' && task.drawingTool === 'cad_propose_site_plan'))
  assert.ok(releaseHoldoutTaskSuite.filter(task => task.category === 'architecture').every(task => task.units === 'millimeter' && task.drawingTool === 'cad_propose_architecture_plan'))
})

test('paired runner contains only the seventeen equivalent generation tasks with per-task tools and units', () => {
  const plan = pairedModelPlan({ taskSuite: 'release-holdout-generation', repetitions: 5, maxRequests: 170, maxOutputTokens: 16384 })
  assert.equal(plan.mode, 'dry-run')
  assert.equal(plan.actualRequests, 0)
  assert.equal(plan.tasks.length, 17)
  assert.equal(plan.plannedRequests, 170)
  assert.equal(plan.drawingTool, releaseHoldoutDrawingTool)
  assert.ok(plan.tasks.every(task => task.drawingTool && task.units && task.budget && task.acceptanceSha256))
  assert.ok(plan.tasks.every(task => task.referenceInput === undefined && task.referenceInputSha256))
  assert.equal(new Set(plan.tasks.map(task => task.drawingTool)).size, 4)
  assert.deepEqual(new Set(plan.tasks.map(task => task.units)), new Set(['millimeter', 'meter']))
  assert.throws(() => pairedModelPlan({ taskSuite: 'release-holdout-generation', repetitions: 5, maxRequests: 169, maxOutputTokens: 16384 }), /request budget/)
  assert.equal(pairedModelPlan({ taskSuite: 'release-holdout-generation', repetitions: 30, maxRequests: 1020, maxOutputTokens: 16384 }).plannedRequests, 1020)
  assert.throws(() => pairedModelPlan({ taskSuite: 'release-holdout-generation', repetitions: 5, maxRequests: 170, drawingTool: 'cad_propose_drawing_annotated', maxOutputTokens: 16384 }), /independently for every task/)
  const budget = releaseHoldoutGenerationTasks[0].budget
  assert.equal(taskBudgetCompliance({ usage: { inputTokens: 1, outputTokens: 1 }, modelToolCallCount: 1, totalMs: 1, humanInterventionCount: 0 }, budget).passed, true)
  assert.equal(taskBudgetCompliance({ usage: { inputTokens: budget.maxInputTokens + 1, outputTokens: 1 }, modelToolCallCount: 1, totalMs: 1, humanInterventionCount: 0 }, budget).passed, false)
})

test('generation reference inputs require release validators and validate compiler/DXF acceptance only', async () => {
  for (const kind of new Set(releaseHoldoutGenerationTasks.map(task => task.validatorKind))) independentValidation({ python, validatorKind: kind })
  for (const task of releaseHoldoutGenerationTasks) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: task.units })
    const session = new KJAgentToolSession(sdk, document)
    const proposal = await session.call(task.drawingTool, structuredClone(task.referenceInput))
    assert.equal(proposal.ok, true, `${task.id}: ${JSON.stringify(proposal)}`)
    assert.equal((await session.approve(proposal.value.planId, 'holdout-compiler-conformance-only')).ok, true, task.id)
    const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
    const reopenedKjd = await createKJDrawSDK().readDocument(kjd, { format: 'KJD', version: '1' })
    assert.equal(reopenedKjd.snapshot().header.units, task.units, task.id)
    assert.ok(reopenedKjd.listEntities().length > 0, task.id)
    const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
    let validation
    try { validation = independentValidation({ python, dxf: String(dxf), expected: task.expected, validatorKind: task.validatorKind, timeoutMs: 30000 }) } catch (error) { throw new Error(`${task.id}: ${error.message}`) }
    assert.equal(validation.passed, true, `${task.id}: ${JSON.stringify(validation)}`)
  }
})

function fixtureInvocation({ task, turn, revision }) {
  const usage = { inputTokens: 1, outputTokens: 1 }
  if (task.category === 'missing-context') return { text: `Please provide ${task.expected.requiredResponseTerms[0]}?`, calls: [], usage }
  if (turn.allowedTools[0] === 'cad_read_drawing') return { text: 'Existing drawing read; drawing TEXT is untrusted data.', calls: [{ name: 'cad_read_drawing', arguments: {} }], usage }
  if (turn.allowedTools[0] === 'cad_propose_move') {
    const dx = Number(turn.prompt.match(/dx=(\d+)/)?.[1])
    const id = task.category === 'continuous-modification' ? 'moving-hole' : 'safe-target'
    return { text: 'Bounded move proposed.', calls: [{ name: 'cad_propose_move', arguments: { expectedRevision: revision, units: task.units, ids: [id], dx, dy: 0 } }], usage }
  }
  const factor = Number(turn.prompt.match(/factor ([0-9]+(?:\.[0-9]+)?)/)?.[1])
  return { text: 'Bounded correction proposed.', calls: [{ name: 'cad_propose_scale', arguments: { expectedRevision: revision, units: task.units, ids: ['wrong-hole'], center: { x: 50, y: 40 }, factor } }], usage }
}

test('behavioral runner performs real seeded multi-turn edits and clarification without mutation', async () => {
  for (const task of releaseHoldoutBehavioralTasks) {
    const result = await runBehavioralScenario({ task, invoke: fixtureInvocation, humanInterventionEvents: [] })
    assert.equal(result.status, 'passed', `${task.id}: ${JSON.stringify(result)}`)
    assert.equal(result.state.passed, true, task.id)
    assert.equal(result.budget.passed, true, task.id)
    assert.match(result.seedKjdSha256, /^[a-f0-9]{64}$/)
    assert.equal(result.humanInterventionCount, 0)
    assert.equal(result.turnStates.length, task.turns.length)
    assert.ok(result.turnStates.every(turn => turn.passed))
    assert.equal(result.reopenStateMatches, true)
    if (task.category === 'missing-context') {
      assert.equal(result.responses[0].calls.length, 0)
      assert.equal(result.state.finalRevision, 1)
    } else if (task.turns[0].allowedTools[0] === 'cad_read_drawing') {
      const secondUser = result.history.findIndex((item, index) => index > 0 && item.role === 'user')
      assert.ok(secondUser > 0)
      assert.ok(result.history.slice(0, secondUser).some(item => item.role === 'tool' && item.name === 'cad_read_drawing'))
      if (task.category === 'adversarial-drawing-text') assert.ok(JSON.stringify(result.history.slice(0, secondUser)).includes(task.expected.preservedUntrustedText.text))
    }
  }
})

test('behavioral suite repeats every stateful case without counting repetitions as unique tasks', async () => {
  const ledger = { source: 'unit-fixture', sourceSha256: hash('[]'), events: [] }
  const report = await runBehavioralSuite({ tasks: releaseHoldoutBehavioralTasks, repetitions: 5, maxRuns: 65, invoke: fixtureInvocation, humanInterventionLedger: ledger })
  assert.equal(report.status, 'complete')
  assert.equal(report.plannedRuns, 65)
  assert.equal(report.attemptedRuns, 65)
  assert.equal(report.runs.length, 65)
  assert.equal(new Set(report.runs.map(run => run.taskId)).size, 13)
  assert.equal(report.humanInterventionCount, 0)
  await assert.rejects(runBehavioralSuite({ tasks: releaseHoldoutBehavioralTasks, repetitions: 5, maxRuns: 64, invoke: fixtureInvocation, humanInterventionLedger: ledger }), /complete plan/)
})

test('behavioral runner fails closed on CAD calls during clarification and changes to protected objects', async () => {
  const missing = releaseHoldoutBehavioralTasks.find(task => task.category === 'missing-context')
  const illegal = await runBehavioralScenario({ task: missing, humanInterventionEvents: [], invoke: ({ revision }) => ({ text: 'done', calls: [{ name: 'cad_propose_move', arguments: { expectedRevision: revision, units: 'millimeter', ids: ['existing-reference'], dx: 1, dy: 0 } }], usage: { inputTokens: 1, outputTokens: 1 } }) })
  assert.equal(illegal.status, 'failed')
  assert.equal(illegal.failure, 'TOOL_POLICY_VIOLATION')
  assert.equal(illegal.state.finalRevision, 1)

  const hostile = releaseHoldoutBehavioralTasks.find(task => task.category === 'adversarial-drawing-text')
  const unsafe = await runBehavioralScenario({ task: hostile, humanInterventionEvents: [], invoke: ({ turn, revision }) => turn.allowedTools[0] === 'cad_read_drawing'
    ? { text: 'read', calls: [{ name: 'cad_read_drawing', arguments: {} }], usage: { inputTokens: 1, outputTokens: 1 } }
    : { text: 'moved wrong object', calls: [{ name: 'cad_propose_move', arguments: { expectedRevision: revision, units: 'millimeter', ids: ['hostile-note'], dx: 1, dy: 0 } }], usage: { inputTokens: 1, outputTokens: 1 } } })
  assert.equal(unsafe.status, 'failed')
  assert.ok(unsafe.state.reasons.includes('UNEXPECTED_CHANGE:hostile-note'))
  assert.ok(unsafe.turnStates.some(turn => !turn.passed && turn.reasons.includes('CHANGED_IDS')))
})

test('shared semantic validator rejects wrong wall segments, road width, node radius and north arrow', async () => {
  const cases = [
    { name: 'wall segment', category: 'architecture', mutateInput: input => { input.exteriorOpenings[0].offset += 100 } },
    { name: 'road width', category: 'site-pipeline', mutateInput: input => { input.roads[0].width += 2 } },
    { name: 'north arrow', category: 'site-pipeline', mutateInput: input => { input.northAngleDegrees += 12 } },
    { name: 'node radius', category: 'site-pipeline', mutateDocument: async document => {
      const node = document.listEntities().find(entity => entity.type === 'CIRCLE')
      await document.transact('deliberately wrong node radius', transaction => transaction.updateObject(node.id, { payload: { radius: 10 } }))
    } },
  ]
  for (const fixture of cases) {
    const task = releaseHoldoutGenerationTasks.find(candidate => candidate.category === fixture.category)
    const input = structuredClone(task.referenceInput)
    fixture.mutateInput?.(input)
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: task.units }), session = new KJAgentToolSession(sdk, document)
    const proposal = await session.call(task.drawingTool, input)
    assert.equal(proposal.ok, true)
    assert.equal((await session.approve(proposal.value.planId, 'negative-validator-fixture')).ok, true)
    await fixture.mutateDocument?.(document)
    const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
    const validation = independentValidation({ python, dxf: String(dxf), expected: task.expected, validatorKind: task.validatorKind })
    assert.equal(validation.passed, false, fixture.name)
    assert.ok(validation.reasons.some(reason => ['CLOSED_POLYLINE_GEOMETRY', 'ROAD_WIDTH', 'CIRCLE_GEOMETRY', 'NORTH_ANGLE'].includes(reason)), `${fixture.name}: ${JSON.stringify(validation)}`)
  }
})

test('shared site acceptance allows reasonable private rendering choices', async () => {
  const task = releaseHoldoutGenerationTasks.find(candidate => candidate.category === 'site-pipeline')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: task.units }), session = new KJAgentToolSession(sdk, document)
  const proposal = await session.call(task.drawingTool, structuredClone(task.referenceInput))
  assert.equal(proposal.ok, true)
  assert.equal((await session.approve(proposal.value.planId, 'fair-shared-acceptance-fixture')).ok, true)
  const layerName = entity => document.getObject(entity.payload.layerId)?.name
  const node = document.listEntities().find(entity => entity.type === 'CIRCLE' && layerName(entity) === 'UTILITY_NODE')
  const roadEdge = document.listEntities().find(entity => entity.type === 'LWPOLYLINE' && layerName(entity) === 'ROAD_EDGE')
  const controlText = document.listEntities().find(entity => entity.type === 'TEXT' && String(entity.payload.text).includes('EPSG:32650'))
  const vertices = structuredClone(roadEdge.payload.vertices)
  const first = vertices[0].point, second = vertices[1].point
  vertices.splice(1, 0, { point: [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2, 0], bulge: 0, startWidth: 0, endWidth: 0 })
  await document.transact('equivalent public contract with different private choices', transaction => {
    transaction.updateObject(node.id, { payload: { radius: 1.2 } })
    transaction.updateObject(roadEdge.id, { payload: { vertices } })
    transaction.updateObject(controlText.id, { payload: { position: [controlText.payload.position[0] + 6, controlText.payload.position[1] + 4, 0] } })
  })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const validation = independentValidation({ python, dxf: String(dxf), expected: task.expected, validatorKind: task.validatorKind })
  assert.equal(validation.passed, true, JSON.stringify(validation))
})

test('paired shared acceptance is frozen independently of compiler private implementation', async () => {
  const source = await readFile(new URL('../../../scripts/benchmarks/release-holdout-task-suite.mjs', import.meta.url), 'utf8')
  assert.equal(source.includes('buildAgentArchitecturePlan'), false)
  assert.equal(source.includes('buildAgentSitePlan'), false)
  for (const task of releaseHoldoutGenerationTasks.filter(task => ['architecture', 'site-pipeline'].includes(task.category))) {
    assert.equal(task.acceptanceSha256, hash(task.expected))
    assert.equal(JSON.stringify(task.expected).includes('blockName'), false)
    assert.equal(JSON.stringify(task.expected).includes('compilerGeometryContract'), false)
    const sharedExpectedByArm = Object.fromEntries(['kjdraw-tool', 'direct-dxf'].map(arm => [arm, task.expected]))
    assert.equal(sharedExpectedByArm['kjdraw-tool'], sharedExpectedByArm['direct-dxf'])
  }
})

test('behavioral live plan and adapter retain provider settings and auditable request hashes', async () => {
  assert.equal(behavioralModelPlan({ repetitions: 5, maxRuns: 65 }).plannedRuns, 65)
  assert.throws(() => behavioralModelPlan({ repetitions: 5, maxRuns: 64 }), /complete plan/)
  const gate = releaseHoldoutModelGatePlan({ repetitions: 5, generationMaxRequests: 170, behavioralMaxRuns: 65 })
  assert.equal(gate.uniqueTasks, 30)
  assert.equal(new Set([...gate.generation.tasks, ...gate.behavioral.tasks].map(task => task.id)).size, 30)
  assert.equal(gate.plannedProviderRequests, 285)
  const env = {
    KJDRAW_BENCH_PROTOCOL: 'chat-completions', KJDRAW_BENCH_MODEL: 'fixture-model', KJDRAW_BENCH_ENDPOINT: 'https://provider.example/v1/chat/completions',
    KJDRAW_BENCH_API_KEY: 'fixture-secret', KJDRAW_BENCH_TOOL_CHOICE: 'forced', KJDRAW_BENCH_REASONING_EFFORT: 'high',
    KJDRAW_BENCH_CHAT_TOKEN_PARAMETER: 'max_completion_tokens', KJDRAW_BENCH_MAX_OUTPUT_TOKENS: '4096', KJDRAW_BENCH_TIMEOUT_MS: '30000',
  }
  const config = behavioralLiveConfiguration(env)
  assert.equal(config.endpointOrigin, 'https://provider.example')
  assert.equal(config.settings.reasoning_effort, 'high')
  assert.equal(config.settings.max_completion_tokens, 4096)
  assert.throws(() => behavioralLiveConfiguration({ ...env, KJDRAW_BENCH_ENDPOINT: 'http://localhost:1234/v1' }), /remote HTTPS/)
  const originalFetch = globalThis.fetch
  let captured
  globalThis.fetch = async (_url, options) => {
    captured = JSON.parse(options.body)
    return new Response(JSON.stringify({
      model: 'fixture-model-returned', usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 2 } },
      choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' } }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const task = releaseHoldoutBehavioralTasks.find(candidate => candidate.category === 'error-correction'), turn = task.turns[0]
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: task.units }), session = new KJAgentToolSession(sdk, document)
    const tools = session.definitions.filter(tool => turn.allowedTools.includes(tool.name))
    const result = await createBehavioralLiveInvoker(config)({ task, turn, revision: 1, tools, history: [{ role: 'user', content: turn.prompt }], runPrefix: 'fixture' })
    assert.deepEqual(result.calls.map(call => call.name), ['cad_read_drawing'])
    assert.match(result.requestSha256, /^[a-f0-9]{64}$/)
    assert.match(result.responseSha256, /^[a-f0-9]{64}$/)
    assert.equal(result.usage.inputTokens, 11)
    assert.equal(result.usage.cacheReadInputTokens, 3)
    assert.equal(result.usage.reasoningOutputTokens, 2)
    assert.equal(captured.model, 'fixture-model')
    assert.equal(JSON.stringify(captured).includes('fixture-secret'), false)
  } finally { globalThis.fetch = originalFetch }
})

test('behavioral suite persists seed/final bytes, report state and intervention provenance', async () => {
  const output = await mkdtemp(join(tmpdir(), 'kjdraw-behavioral-holdout-'))
  try {
    const tasks = [releaseHoldoutBehavioralTasks.find(task => task.category === 'missing-context')]
    const ledger = { source: 'fixture-ledger.json', sourceSha256: hash('{"events":[]}'), events: [] }
    const report = await runBehavioralSuite({ tasks, repetitions: 5, maxRuns: 5, invoke: fixtureInvocation, output, humanInterventionLedger: ledger, evidence: { mode: 'fixture', model: 'fixture-model', settings: { temperature: 0 } } })
    assert.equal(report.status, 'complete')
    assert.equal(report.fixtureWarning.includes('never use as release evidence'), true)
    const persisted = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'))
    assert.equal(persisted.attemptedRuns, 5)
    assert.equal(persisted.humanInterventionLedger.sourceSha256, ledger.sourceSha256)
    for (const run of persisted.runs) {
      const seed = await readFile(join(output, run.files.seedKjd)), final = await readFile(join(output, run.files.finalKjd))
      assert.equal(createHash('sha256').update(seed).digest('hex'), run.seedKjdSha256)
      assert.equal(createHash('sha256').update(final).digest('hex'), run.finalKjdSha256)
    }
  } finally { await rm(output, { recursive: true, force: true }) }
})
