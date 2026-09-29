import test from 'node:test'
import assert from 'node:assert/strict'
import { tokenEfficiencyTaskCorpus } from '../../../scripts/benchmarks/token-efficiency-task-corpus.mjs'
import { manufacturingTaskSuite } from '../../../scripts/benchmarks/manufacturing-task-suite.mjs'
import { createKJDrawSDK } from '../src/sdk.js'
import { createHash } from 'node:crypto'
import { createTokenKjdrawArm, executeTokenKjdrawRound } from '../../../scripts/benchmarks/token-kjdraw-arm.mjs'
import { projectCompactCadTools } from '../src/agent-compact-tool-surface.js'
import { buildCadSkillJsonContract, parseCadSkillJsonResponse } from '../src/agent-skill-json.js'
import { kjdrawCompactSystemMessage, kjdrawToolNamesForTask, runTokenEfficiencyBenchmark } from '../../../scripts/benchmarks/token-efficiency-runner.mjs'

const simple = tokenEfficiencyTaskCorpus.find(task => task.category === 'simple-one-shot' && task.family === 'corner-hole-plate')
const edit = tokenEfficiencyTaskCorpus.find(task => task.family === 'hole-move-x')
const sheet = tokenEfficiencyTaskCorpus.find(task => task.category === 'complex-one-shot')
const paired = tokenEfficiencyTaskCorpus.find(task => task.family === 'paired-hole-spacing')
const slot = tokenEfficiencyTaskCorpus.find(task => task.family === 'slot-length')
const boundary = tokenEfficiencyTaskCorpus.find(task => task.family === 'boundary-width')
const sheetSource = manufacturingTaskSuite.find(source => `sheet-${source.id}` === sheet.id)
const basicDrawing = expected => ({
  units: 'millimeter', expectedRevision: 0,
  lines: expected.lines.map(line => [line.start.x, line.start.y, line.end.x, line.end.y]),
  circles: expected.circles.map(circle => [circle.center.x, circle.center.y, circle.radius]),
  arcs: expected.arcs.map(arc => [arc.center.x, arc.center.y, arc.radius, arc.startDegrees, arc.endDegrees]),
  polylines: expected.polylines.map(polyline => ({ points: polyline.vertices.map(point => [point.x, point.y]), closed: polyline.closed })),
})
const usage = { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
function fixtureModel({ arm, taskId, roundIndex, messages, settings }) {
  assert.doesNotMatch(JSON.stringify({ messages, settings }), /expectedRounds|expectedFeatures|validatorKind|acceptanceSha256/)
  if (arm === 'declarative-ezdxf') return { content: '{"schema":"fixture"}', usage, elapsedMs: 4, model: 'fixture-served', toolCalls: [] }
  assert.ok(Array.isArray(settings.tools) && settings.tools.length > 0)
  for (const tool of settings.tools) {
    assert.equal(Object.hasOwn(tool.function.parameters.properties, 'expectedRevision'), false)
    assert.equal(Object.hasOwn(tool.function.parameters.properties, 'units'), false)
    assert.equal(tool.function.parameters.required.includes('expectedRevision'), false)
    assert.equal(tool.function.parameters.required.includes('units'), false)
  }
  if (taskId === paired.id) {
    const dx = roundIndex === 1 ? 3 : 4
    return { content: null, usage, elapsedMs: 5, model: 'fixture-served', toolCalls: [
      { id: `fixture-${roundIndex}-a`, type: 'function', function: { name: 'cad_propose_move', arguments: JSON.stringify({ ids: ['hole-a'], dx, dy: 0, expectedRevision: 1 }) } },
      { id: `fixture-${roundIndex}-b`, type: 'function', function: { name: 'cad_propose_move', arguments: JSON.stringify({ ids: ['hole-b'], dx: -dx, dy: 0, expectedRevision: 1 }) } },
    ] }
  }
  if (taskId === slot.id) {
    const right = roundIndex === 1 ? 70 : 75, dx = roundIndex === 1 ? 5 : 6
    return { content: null, usage, elapsedMs: 5, model: 'fixture-served', toolCalls: [
      { id: `fixture-${roundIndex}-lines`, type: 'function', function: { name: 'cad_propose_stretch', arguments: JSON.stringify({ ids: ['slot-lower', 'slot-upper'], crossingStart: { x: right - 1, y: 20 }, crossingEnd: { x: right + 1, y: 30 }, dx, dy: 0, expectedRevision: 1 }) } },
      { id: `fixture-${roundIndex}-arc`, type: 'function', function: { name: 'cad_propose_move', arguments: JSON.stringify({ ids: ['slot-right'], dx, dy: 0, expectedRevision: 1 }) } },
    ] }
  }
  const name = taskId === simple.id ? 'cad_propose_drawing_basic' : taskId === sheet.id ? 'cad_propose_manufacturing_sheet' : 'cad_propose_move'
  const args = taskId === simple.id ? basicDrawing(simple.expectedRounds[0].expected)
    : taskId === sheet.id ? sheetSource.input : { ids: ['target-hole'], dx: roundIndex % 2 ? 4 : -2, dy: 0 }
  return { content: null, usage, elapsedMs: 5, model: 'fixture-served', toolCalls: [{ id: `fixture-${taskId}-${roundIndex}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
const compileFixture = ({ task, roundIndex, previous }) => ({ passed: true, taskId: task.id, roundIndex,
  arm: 'declarative-ezdxf', units: 'millimeter', dxf: 'SYNTHETIC-DXF-NOT-VALID',
  features: task.seed ? Object.fromEntries(task.seed.features.map((feature, index) => [feature.id, `F${index + 1}`])) : null,
  beforeFeatures: task.seed ? Object.fromEntries(task.seed.features.map((feature, index) => [feature.id, `F${index + 1}`])) : null,
  previous })

test('fixture runner executes one-shot and sequential edit rounds across both arms with no scorer leakage', async () => {
  const report = await runTokenEfficiencyBenchmark({ tasks: [simple, edit], provider: 'deepseek', model: 'fixture-model',
    repetitions: 1, mode: 'fixture', modelCall: fixtureModel, compileBaseline: compileFixture,
    scoreRound: () => ({ passed: true, reasons: [] }), scoreSeed: () => ({ passed: true, reasons: [] }) })
  assert.equal(report.plannedRequests, 22)
  assert.equal(report.attemptedRequests, 22)
  assert.equal(report.unexecutedRequests, 0)
  assert.equal(report.runs.length, 22)
  assert.equal(report.runs.every(run => run.status === 'passed'), true, JSON.stringify(report.runs.filter(run => run.status !== 'passed').map(run => ({ taskId: run.taskId, failure: run.failure }))))
  assert.equal(report.runs.filter(run => run.arm === 'kjdraw-tool').every(run => run.review.kind === 'synthetic-fixture'), true)
  assert.equal(report.runs.filter(run => run.arm === 'declarative-ezdxf').every(run => run.review.kind === 'none'), true)
  assert.equal(report.aggregate.plannedRoundAttempts, 22)
  assert.equal(report.aggregate.paired.claim99Supported, false)
})

test('failed first edit round records timeout and nine unexecuted follow-ups without further model calls', async () => {
  let kjCalls = 0
  const persisted = []
  const modelCall = input => {
    if (input.arm === 'kjdraw-tool') { kjCalls++; const error = new Error('PROVIDER_TIMEOUT'); error.code = 'PROVIDER_TIMEOUT'; throw error }
    return fixtureModel(input)
  }
  const report = await runTokenEfficiencyBenchmark({ tasks: [edit], provider: 'qwen', model: 'fixture-model', repetitions: 1,
    mode: 'fixture', modelCall, compileBaseline: compileFixture,
    scoreRound: () => ({ passed: true, reasons: [] }), scoreSeed: () => ({ passed: true, reasons: [] }),
    onRound: record => { persisted.push(record) } })
  const kj = report.runs.filter(run => run.arm === 'kjdraw-tool')
  assert.equal(kjCalls, 1)
  assert.equal(kj[0].status, 'timeout')
  assert.equal(kj[0].usage, null)
  assert.equal(kj.slice(1).every(run => run.unexecuted && run.failure === 'UNEXECUTED_AFTER_PROVIDER_STOP'), true)
  assert.equal(report.unexecutedRequests, 19)
  assert.equal(report.stopReason, 'PROVIDER_TIMEOUT')
  assert.equal(persisted.length, 20)
  assert.equal(persisted[19].unexecuted, true)
  assert.equal(report.aggregate.paired.cheaperTasks, 0)
})

test('manufacturing sheet uses only the specialized KJDraw tool and one baseline JSON round', async () => {
  const report = await runTokenEfficiencyBenchmark({ tasks: [sheet], provider: 'glm', model: 'fixture-model', repetitions: 1,
    mode: 'fixture', modelCall: fixtureModel, compileBaseline: compileFixture,
    scoreRound: () => ({ passed: true, reasons: [] }) })
  assert.equal(report.plannedRequests, 2)
  assert.equal(report.runs.every(run => run.status === 'passed'), true, JSON.stringify(report.runs.map(run => ({ status: run.status, failure: run.failure }))))
  assert.equal(report.runs.find(run => run.arm === 'kjdraw-tool').toolCallCount, 1)
  assert.equal(report.aggregate.perCategory['complex-one-shot'].plannedTasks, 1)
})

test('paired holes and rounded slot accept two CAD tool calls per edit round with stable identities', async () => {
  const report = await runTokenEfficiencyBenchmark({ tasks: [paired, slot], provider: 'deepseek', model: 'fixture-model', repetitions: 1,
    mode: 'fixture', modelCall: fixtureModel, compileBaseline: compileFixture,
    scoreRound: () => ({ passed: true, reasons: [] }), scoreSeed: () => ({ passed: true, reasons: [] }) })
  const kj = report.runs.filter(run => run.arm === 'kjdraw-tool')
  assert.equal(kj.length, 4)
  assert.equal(kj.every(run => run.status === 'passed' && run.toolCallCount === 2), true, JSON.stringify(kj.map(run => ({ status: run.status, failure: run.failure }))))
  const pairedDxf = kj.find(run => run.taskId === paired.id && run.roundIndex === 2).dxf
  const pairedDrawing = await createKJDrawSDK().readDocument(pairedDxf, { format: 'DXF' })
  assert.deepEqual(pairedDrawing.listEntities({ type: 'CIRCLE' }).map(entity => entity.payload.center[0]).sort((a, b) => a - b), [27, 83])
  const slotDxf = kj.find(run => run.taskId === slot.id && run.roundIndex === 2).dxf
  const slotDrawing = await createKJDrawSDK().readDocument(slotDxf, { format: 'DXF' })
  assert.ok(slotDrawing.listEntities({ type: 'ARC' }).some(entity => entity.payload.center[0] === 81))
  assert.ok(slotDrawing.listEntities({ type: 'LINE' }).some(entity => entity.payload.end[0] === 81))
})

test('pilot mode records synthetic approval explicitly and cannot produce a live claim', async () => {
  const report = await runTokenEfficiencyBenchmark({ tasks: [simple], provider: 'deepseek', model: 'fixture-model', repetitions: 1,
    mode: 'pilot', modelCall: fixtureModel, compileBaseline: compileFixture,
    scoreRound: () => ({ passed: true, reasons: [] }), validatorProbe: () => ({ validator: 'fixture' }) })
  assert.equal(report.mode, 'pilot')
  assert.equal(report.runs.find(run => run.arm === 'kjdraw-tool').review.kind, 'synthetic-pilot')
  assert.equal(report.aggregate.evidence.verified, false)
  assert.equal(report.aggregate.paired.claim99Supported, false)
})

test('returned model drift halts later paid-shaped tasks and blocks a claim', async () => {
  let requests = 0
  const modelCall = input => {
    requests++
    const result = fixtureModel(input)
    return { ...result, model: input.arm === 'declarative-ezdxf' ? 'other-served-model' : result.model }
  }
  const report = await runTokenEfficiencyBenchmark({ tasks: [simple, sheet], provider: 'glm', model: 'fixture-model', repetitions: 1,
    mode: 'fixture', modelCall, compileBaseline: compileFixture, scoreRound: () => ({ passed: true, reasons: [] }) })
  assert.equal(requests, 2)
  assert.equal(report.stopReason, 'RETURNED_MODEL_INCONSISTENT')
  assert.equal(report.consistentReturnedModel, false)
  assert.ok(report.claimBlockedReasons.includes('INCONSISTENT_RETURNED_MODEL'))
  assert.equal(report.runs.filter(run => run.taskId === sheet.id).every(run => run.unexecuted && run.failure === 'UNEXECUTED_AFTER_MODEL_MISMATCH'), true)
})

test('provider rate limit stops every later request and records the unexecuted budget', async () => {
  let requests = 0
  const report = await runTokenEfficiencyBenchmark({ tasks: [simple, sheet], provider: 'qwen', model: 'fixture-model', repetitions: 1,
    mode: 'fixture', modelCall: () => { requests++; const error = new Error('PROVIDER_RATE_LIMIT'); error.code = 'PROVIDER_RATE_LIMIT'; throw error },
    compileBaseline: compileFixture, scoreRound: () => ({ passed: true, reasons: [] }) })
  assert.equal(requests, 1)
  assert.equal(report.stopReason, 'PROVIDER_RATE_LIMIT')
  assert.equal(report.attemptedRequests, 1)
  assert.equal(report.unexecutedRequests, 3)
  assert.equal(report.runs.filter(run => run.unexecuted).every(run => run.failure === 'UNEXECUTED_AFTER_PROVIDER_STOP'), true)
})

test('live run without explicit review callback or fixture run without model mock fails before requests', async () => {
  await assert.rejects(runTokenEfficiencyBenchmark({ tasks: [simple], provider: 'glm', model: 'glm-fixture', mode: 'live', repetitions: 3 }), /EXPLICIT_REVIEW_CALLBACK_REQUIRED/)
  await assert.rejects(runTokenEfficiencyBenchmark({ tasks: [simple], provider: 'glm', model: 'glm-fixture', mode: 'fixture', repetitions: 1 }), /FIXTURE_MODEL_REQUIRED/)
})

test('public prompt routing covers every frozen round without reading family or scorer fields', () => {
  const expected = { 'hole-move-x': ['cad_propose_move'], 'hole-move-y': ['cad_propose_move'],
    'paired-hole-spacing': ['cad_propose_move'], 'hole-diameter': ['cad_propose_scale'],
    'hole-correction': ['cad_propose_scale'], 'boundary-width': ['cad_propose_stretch'],
    'boundary-height': ['cad_propose_stretch'], 'slot-length': ['cad_propose_stretch', 'cad_propose_move'] }
  for (const task of tokenEfficiencyTaskCorpus) for (const [index, round] of task.rounds.entries()) {
    const publicTask = { seed: task.seed, rounds: [{ prompt: round.prompt }] }
    for (const field of ['family', 'category', 'expectedRounds']) Object.defineProperty(publicTask, field, { get() { throw new Error('SCORER_FIELD_READ') } })
    assert.deepEqual(kjdrawToolNamesForTask(publicTask), task.seed ? expected[task.family]
      : task.category === 'complex-one-shot' ? ['cad_propose_manufacturing_sheet'] : ['cad_propose_drawing_basic'], `${task.id} round ${index + 1}`)
  }
  assert.throws(() => kjdrawToolNamesForTask({ seed: { features: [] }, rounds: [{ prompt: 'Invent an unknown edit' }] }), /UNSUPPORTED_CAD_EDIT_INTENT/)
})

test('compact public SDK projection shrinks edit tool metadata without changing SDK schema constraints', async () => {
  const state = await createTokenKjdrawArm({ seed: edit.seed, mode: 'fixture' })
  const names = ['cad_propose_move', 'cad_propose_scale', 'cad_propose_stretch', 'cad_propose_polyline_edit', 'cad_propose_structural_edit']
  const oldTools = names.map(name => {
    const definition = state.session.definitions.find(item => item.name === name)
    const schema = structuredClone(definition.inputSchema)
    delete schema.properties?.expectedRevision; delete schema.properties?.units
    schema.required = schema.required.filter(field => field !== 'expectedRevision' && field !== 'units')
    return { type: 'function', function: { name, description: `${definition.description} The host supplies expectedRevision and units.`, parameters: schema } }
  })
  const projected = projectCompactCadTools({ definitions: state.session.definitions, names: kjdrawToolNamesForTask(edit), hostOwnsRevisionAndUnits: true })
  const oldSystem = 'Use the supplied KJDraw CAD proposal tools to produce the requested editable drawing. For edits, refer to stable feature IDs in ids; the host maps them to native entity IDs. The host supplies current revision and millimeter units when omitted. Do not claim success before the tool result.'
  assert.deepEqual(projected.map(tool => tool.function.name), ['cad_propose_move'])
  assert.equal(JSON.stringify(projected[0].function.parameters), JSON.stringify(oldTools[0].function.parameters))
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) < Buffer.byteLength(JSON.stringify(oldTools)) / 4)
  assert.ok(Buffer.byteLength(kjdrawCompactSystemMessage) < Buffer.byteLength(oldSystem))
  assert.equal(state.session.definitions.find(tool => tool.name === 'cad_propose_move').inputSchema.required.includes('expectedRevision'), true)
})

test('pilot records fixed compiler reason and hashed malformed tool arguments without raw payload', async () => {
  const broken = '{"ids":["target-hole"],"dx":4, secret payload'
  const report = await runTokenEfficiencyBenchmark({ tasks: [edit], provider: 'qwen', model: 'fixture-model', repetitions: 1,
    mode: 'pilot', validatorProbe: () => {}, scoreSeed: () => ({ passed: true }),
    modelCall: input => input.arm === 'kjdraw-tool'
      ? { content: null, toolCalls: [{ id: 'bad', type: 'function', function: { name: 'cad_propose_move', arguments: broken } }], usage, elapsedMs: 1, model: 'fixture-served' }
      : { content: '{}', usage, elapsedMs: 1, model: 'fixture-served' },
    compileBaseline: () => ({ passed: false, reason: 'MISSING_REQUIRED_FEATURE' }) })
  const kj = report.runs.find(run => run.arm === 'kjdraw-tool' && run.roundIndex === 1)
  const baseline = report.runs.find(run => run.arm === 'declarative-ezdxf' && run.roundIndex === 1)
  assert.equal(kj.failure, 'INVALID_TOOL_ARGUMENTS')
  assert.deepEqual(kj.argumentDiagnostic, { bytes: Buffer.byteLength(broken), sha256: createHash('sha256').update(broken).digest('hex') })
  assert.equal(JSON.stringify(report).includes('secret payload'), false)
  assert.equal(baseline.failure, 'BASELINE_COMPILATION_FAILED')
  assert.equal(baseline.compilerReason, 'MISSING_REQUIRED_FEATURE')
  assert.deepEqual(report.toolRouting[edit.id][0], ['cad_propose_move'])
})

test('model artifact callback receives redacted response and persistence failure stops later requests', async () => {
  const prior = process.env.KJDRAW_QWEN_API_KEY
  process.env.KJDRAW_QWEN_API_KEY = 'fixture-secret-value'
  try {
    const artifacts = []
    const report = await runTokenEfficiencyBenchmark({ tasks: [simple], provider: 'qwen', model: 'fixture-model', repetitions: 1,
      mode: 'fixture', modelCall: input => ({ ...fixtureModel(input), content: 'fixture-secret-value' }),
      compileBaseline: compileFixture, scoreRound: () => ({ passed: true }),
      saveModelArtifacts: artifact => { artifacts.push(artifact); throw new Error('disk path and secret must stay private') } })
    assert.equal(report.stopReason, 'ARTIFACT_PERSISTENCE_FAILED')
    assert.equal(report.attemptedRequests, 1)
    assert.equal(report.unexecutedRequests, 1)
    assert.equal(JSON.stringify(artifacts).includes('fixture-secret-value'), false)
    assert.equal(JSON.stringify(artifacts).includes('[REDACTED]'), true)
    assert.equal(JSON.stringify(report).includes('disk path'), false)
  } finally {
    if (prior === undefined) delete process.env.KJDRAW_QWEN_API_KEY
    else process.env.KJDRAW_QWEN_API_KEY = prior
  }
})

const fakeTool = { function: { parameters: { properties: {}, required: [] } } }
function skillJsonFixtureModel(input) {
  if (input.arm === 'declarative-ezdxf') return fixtureModel(input)
  assert.equal(Object.hasOwn(input.settings, 'tools'), false)
  assert.equal(Object.hasOwn(input.settings, 'tool_choice'), false)
  assert.match(input.messages[0].content, /Return only valid JSON/)
  assert.doesNotMatch(JSON.stringify(input.messages), /expectedRounds|expectedFeatures|validatorKind|acceptanceSha256/)
  const toolResult = fixtureModel({ ...input, settings: { ...input.settings, tools: [fakeTool] } })
  const calls = toolResult.toolCalls.map(call => {
    const args = JSON.parse(call.function.arguments)
    delete args.expectedRevision; delete args.units
    return { tool: call.function.name, args }
  })
  return { ...toolResult, content: JSON.stringify({ calls }), toolCalls: [] }
}

test('Skill JSON contract is SDK-derived, bounded, and does not expose host-owned fields', async () => {
  const state = await createTokenKjdrawArm({ mode: 'fixture' })
  const names = ['cad_propose_manufacturing_sheet']
  const contract = buildCadSkillJsonContract({ definitions: state.session.definitions, names })
  assert.match(contract, /"calls":\[\{"tool"/)
  for (const field of ['drawingId!', 'holePatterns?', 'throughDiameter!', 'sheet!', 'size!', 'textHeight!']) assert.ok(contract.includes(field), field)
  assert.match(contract, /Rectangular rows x columns .* belong in holePatterns/)
  assert.match(contract, /boltCirclePatterns is only for holes explicitly arranged around a pitch circle/)
  assert.match(contract, /Check matching brackets and include every requested feature/)
  const basicContract = buildCadSkillJsonContract({ definitions: state.session.definitions, names: ['cad_propose_drawing_basic'] })
  assert.match(basicContract, /Represent each requested hole as a circle/)
  assert.match(basicContract, /a pitch circle or polygon is not a substitute for holes/)
  assert.doesNotMatch(contract, /expectedRevision|units!:/)
  assert.deepEqual(parseCadSkillJsonResponse({ content: '{"calls":[{"tool":"cad_propose_move","args":{"ids":["a"],"dx":2,"dy":0}}]}', names: ['cad_propose_move'] }),
    [{ tool: 'cad_propose_move', args: { ids: ['a'], dx: 2, dy: 0 } }])
  for (const content of ['not json', '{}', '{"calls":[]}', '{"calls":[{"tool":"cad_propose_move","args":[]}]}' ])
    assert.throws(() => parseCadSkillJsonResponse({ content, names: ['cad_propose_move'] }), /INVALID_SKILL_JSON_RESPONSE/)
  assert.throws(() => parseCadSkillJsonResponse({ content: '{"calls":[{"tool":"cad_propose_move","args":{"ids":["a"],"dx":2,"dy":0}}]}]}', names: ['cad_propose_move'] }), /INVALID_SKILL_JSON_RESPONSE/)
  assert.throws(() => parseCadSkillJsonResponse({ content: '{"calls":[{"tool":"cad_propose_scale","args":{}}]}', names: ['cad_propose_move'] }), /DISALLOWED_SKILL_JSON_TOOL/)
})

test('Skill JSON mode executes simple drawing, ten edit rounds, multi-call edits and manufacturing via real SDK', async () => {
  const observed = []
  const report = await runTokenEfficiencyBenchmark({ tasks: [simple, edit, paired, slot, sheet], provider: 'qwen', model: 'fixture-model',
    interfaceMode: 'skill-json', mode: 'fixture', repetitions: 1,
    modelCall: input => { observed.push(input); return skillJsonFixtureModel(input) },
    compileBaseline: compileFixture, scoreRound: () => ({ passed: true, reasons: [] }), scoreSeed: () => ({ passed: true, reasons: [] }) })
  assert.equal(report.interfaceMode, 'skill-json')
  assert.equal(report.kjdrawToolSurface, 'public-prompt-skill-json-v2')
  assert.equal(report.runs.every(run => run.status === 'passed'), true, JSON.stringify(report.runs.filter(run => run.status !== 'passed').map(run => [run.taskId, run.failure])))
  assert.equal(report.runs.filter(run => run.arm === 'kjdraw-tool').every(run => run.review.kind === 'synthetic-fixture'), true)
  assert.equal(report.runs.filter(run => run.taskId === slot.id && run.arm === 'kjdraw-tool').every(run => run.toolCallCount === 2), true)
  assert.equal(report.runs.filter(run => run.taskId === paired.id && run.arm === 'kjdraw-tool').every(run => run.toolCallCount === 2), true)
  const secondEdit = observed.find(input => input.arm === 'kjdraw-tool' && input.taskId === edit.id && input.roundIndex === 2)
  assert.ok(secondEdit.messages.some(message => message.role === 'assistant' && message.content?.includes('"calls"')))
  assert.ok(secondEdit.messages.some(message => message.role === 'user' && message.content?.startsWith('Approved and applied')))
  assert.deepEqual(report.toolRouting[sheet.id][0], ['cad_propose_manufacturing_sheet'])
})

test('Skill JSON malformed output retains usage and hash while disallowed tools never reach SDK', async () => {
  for (const [content, expected] of [['{"calls":', 'INVALID_SKILL_JSON_RESPONSE'],
    ['{"calls":[{"tool":"cad_propose_scale","args":{}}]}', 'DISALLOWED_SKILL_JSON_TOOL']]) {
    const report = await runTokenEfficiencyBenchmark({ tasks: [edit], provider: 'deepseek', model: 'fixture-model', repetitions: 1,
      interfaceMode: 'skill-json', mode: 'fixture', scoreSeed: () => ({ passed: true }),
      modelCall: input => input.arm === 'kjdraw-tool' ? { content, usage, elapsedMs: 3, model: 'fixture-served', toolCalls: [] } : fixtureModel(input),
      compileBaseline: compileFixture, scoreRound: () => ({ passed: true }) })
    const first = report.runs.find(run => run.arm === 'kjdraw-tool' && run.roundIndex === 1)
    assert.equal(first.failure, expected)
    assert.deepEqual(first.usage, usage)
    assert.equal(first.toolCallCount, 0)
    assert.deepEqual(first.argumentDiagnostic, { bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') })
    assert.equal(report.runs.filter(run => run.arm === 'kjdraw-tool').slice(1).every(run => run.unexecuted), true)
  }
})

test('Skill JSON parser does not replace SDK argument validation or synthetic review boundary', async () => {
  const content = '{"calls":[{"tool":"cad_propose_move","args":{"ids":["target-hole"],"dx":"invalid","dy":0}}]}'
  const report = await runTokenEfficiencyBenchmark({ tasks: [edit], provider: 'glm', model: 'fixture-model', repetitions: 1,
    interfaceMode: 'skill-json', mode: 'fixture', scoreSeed: () => ({ passed: true }),
    modelCall: input => input.arm === 'kjdraw-tool' ? { content, usage, elapsedMs: 3, model: 'fixture-served', toolCalls: [] } : fixtureModel(input),
    compileBaseline: compileFixture, scoreRound: () => ({ passed: true }) })
  const first = report.runs.find(run => run.arm === 'kjdraw-tool' && run.roundIndex === 1)
  assert.equal(first.failure, 'TOOL_PROPOSAL_FAILED')
  assert.equal(first.toolCallCount, 1)
  assert.deepEqual(first.review, { kind: 'none', approved: false })
  assert.deepEqual(first.usage, usage)
})

test('STRETCH contract states entity/window limits and real SDK retains exact vertex semantics', async () => {
  const state = await createTokenKjdrawArm({ seed: boundary.seed, mode: 'fixture' })
  const names = kjdrawToolNamesForTask(boundary)
  const contract = buildCadSkillJsonContract({ definitions: state.session.definitions, names })
  assert.deepEqual(names, ['cad_propose_stretch'])
  assert.match(contract, /only LINE or 2D POLYLINE defining vertices inside\/on the crossing window/)
  assert.match(contract, /enclosing every vertex moves the whole shape/)
  assert.match(contract, /ARC\/CIRCLE cannot STRETCH: use MOVE/)
  const full = await executeTokenKjdrawRound({ state, roundIndex: 1, toolName: 'cad_propose_stretch',
    parameters: { ids: ['boundary'], crossingStart: { x: 0, y: 0 }, crossingEnd: { x: 110, y: 65 }, dx: 8, dy: 0 }, syntheticFixture: true })
  assert.equal(full.status, 'applied')
  assert.deepEqual(state.document.getObject(state.featureIds.boundary).payload.vertices.map(vertex => vertex.point[0]), [8, 118, 118, 8])
  const narrow = await createTokenKjdrawArm({ seed: boundary.seed, mode: 'fixture' })
  const targeted = await executeTokenKjdrawRound({ state: narrow, roundIndex: 1, toolName: 'cad_propose_stretch',
    parameters: { ids: ['boundary'], crossingStart: { x: 109, y: -1 }, crossingEnd: { x: 111, y: 66 }, dx: 8, dy: 0 }, syntheticFixture: true })
  assert.equal(targeted.status, 'applied')
  assert.deepEqual(narrow.document.getObject(narrow.featureIds.boundary).payload.vertices.map(vertex => vertex.point[0]), [0, 118, 118, 0])

  const slotState = await createTokenKjdrawArm({ seed: slot.seed, mode: 'fixture' })
  const rejected = await executeTokenKjdrawRound({ state: slotState, roundIndex: 1, toolName: 'cad_propose_stretch',
    parameters: { ids: ['slot-right'], crossingStart: { x: 70, y: 21 }, crossingEnd: { x: 75, y: 29 }, dx: 5, dy: 0 }, syntheticFixture: true })
  assert.equal(rejected.status, 'failed')
  assert.equal(rejected.failure.code, 'KJDOCUMENT_INVALID')
  assert.match(rejected.failure.message, /LINE\/LWPOLYLINE\/POLYLINE/)
})
