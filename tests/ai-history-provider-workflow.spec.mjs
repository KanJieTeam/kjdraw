import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  createAiHistoryWorkflowSpecification, createPublicAiHistoryDrawing, runAiHistoryProviderWorkflow,
} from '../scripts/benchmarks/ai-history-provider-workflow.mjs'

// Deterministic protocol fixtures exercise the real imported document, pending
// plans, approval, built-in history and DXF. They never represent live execution.
function fixtureModel({ targetText = 'PUBLIC-HISTORY-PROJECT-2026', inverseAt = -1, wrongText = false, prose = false, badUsage = false } = {}) {
  const specification = createAiHistoryWorkflowSpecification(targetText)
  const steps = specification.steps.filter(step => step.command)
  const requests = []
  let round = 0, targetId
  return { requests, async call(input) {
    requests.push(structuredClone(input))
    if (prose) return { model: 'fixture-served-model', content: 'The label has been changed.', finishReason: 'stop', toolCalls: [],
      usage: { inputTokens: 17, outputTokens: 5, totalTokens: 22 } }
    const step = steps[round]
    assert.ok(step)
    const context = input.messages.find(message => message.role === 'user').content
    assert.equal(context.endsWith('Current user request: ' + step.prompt), true, 'immutable original prompt reaches the real runtime unchanged')
    const expectedRevision = Number(context.split('; revision ')[1].split(';')[0])
    const units = context.split('; units ')[1].split('.')[0]
    const last = input.messages.at(-1)
    let name, args
    if (last.role === 'user') {
      if (step.command === 'TEXTEDIT') {
        name = 'cad_find_text'
        args = { expectedRevision, search: round === 0 ? specification.initialText : specification.first, match: 'exact' }
      } else {
        name = 'cad_read_history'
        args = { expectedRevision }
      }
    } else {
      assert.equal(last.role, 'tool')
      const result = JSON.parse(last.content)
      assert.equal(result.ok, true)
      if (step.command === 'TEXTEDIT') {
        assert.equal(result.value.matches.length, 1)
        targetId = result.value.matches[0].id
        name = 'cad_propose_text_edit'
        args = { expectedRevision, units, changes: [{ id: targetId, expectedText: result.value.matches[0].text,
          text: wrongText ? specification.initialText + '-UNREQUESTED' : step.text }] }
      } else if (round === inverseAt) {
        // This is a real but unwanted inverse TEXTEDIT proposal. The harness
        // must reject it despite its target text matching the previous state.
        name = 'cad_propose_text_edit'
        args = { expectedRevision, units, changes: [{ id: targetId, expectedText: specification.first, text: specification.initialText }] }
      } else {
        name = step.command === 'UNDO' ? 'cad_propose_undo' : 'cad_propose_redo'
        const target = result.value.history[step.command === 'UNDO' ? 'undoTarget' : 'redoTarget']
        assert.ok(target?.id, 'copy the current real history identity, including after refresh')
        args = { expectedRevision, units, targetHistoryId: target.id }
      }
      round++
    }
    return { model: 'fixture-served-model', content: '', finishReason: 'tool_calls', elapsedMs: 1,
      usage: { inputTokens: 17, outputTokens: 5, totalTokens: badUsage ? null : 22,
        cacheReadInputTokens: 7, cacheMissInputTokens: 10, reasoningOutputTokens: 0 },
      toolCalls: [{ id: 'fixture-call-' + requests.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    }
  } }
}

test('history provider workflow freezes all natural prompts and defaults to a zero-request dry run', () => {
  const specification = createAiHistoryWorkflowSpecification()
  assert.equal(Object.isFrozen(specification), true)
  assert.equal(Object.isFrozen(specification.steps), true)
  assert.ok(specification.steps.every(Object.isFrozen))
  assert.deepEqual(specification.steps.map(step => step.command), ['TEXTEDIT', 'UNDO', 'REDO', null, 'UNDO', 'REDO', 'TEXTEDIT'])
  for (const step of specification.steps.filter(step => ['UNDO', 'REDO'].includes(step.command))) assert.doesNotMatch(step.prompt, /undo|redo|cad_|撤销|重做/i)
  const result = spawnSync(process.execPath, ['scripts/benchmarks/ai-history-provider-workflow.mjs'], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  const dryRun = JSON.parse(result.stdout)
  assert.equal(dryRun.mode, 'dry-run')
  assert.equal(dryRun.requests, 0)
  assert.equal(dryRun.defaultModel, 'deepseek-chat')
  assert.equal(dryRun.plannedModelRounds, 6)
  assert.equal(Object.hasOwn(dryRun, 'prompts'), false)
})

test('deterministic protocol completes actual cumulative history, refresh and DXF without counting fixtures as model executions', async () => {
  const fixture = fixtureModel(), reviewed = [], progress = []
  const report = await runAiHistoryProviderWorkflow({ fixture: true, modelCall: fixture.call,
    onProgress: event => progress.push(event), onReview: event => { reviewed.push(event); return true } })
  assert.equal(report.passed, true, JSON.stringify(report.steps))
  assert.equal(report.mode, 'fixture')
  assert.equal(report.requests, 12)
  assert.equal(report.fixtureRequests, 12)
  assert.equal(report.executedModelRequests, 0)
  assert.deepEqual(report.returnedModels, ['fixture-served-model'])
  assert.equal(report.completeUsage, true)
  assert.equal(report.verifiedTokens, 264)
  assert.deepEqual(report.engineCounts, { textEdits: 2, undos: 2, redos: 2, localArchiveRefreshes: 1 })
  assert.equal(report.final.entityCount, 6)
  assert.equal(report.final.undoCount, 2)
  assert.equal(report.final.redoCount, 0)
  assert.equal(reviewed.length, 6)
  assert.deepEqual(reviewed.map(event => event.proposal.command), ['TEXTEDIT', 'UNDO', 'REDO', 'UNDO', 'REDO', 'TEXTEDIT'])
  assert.ok(reviewed.every(event => Object.isFrozen(event) && Object.isFrozen(event.proposal)))
  assert.equal(report.steps[3].status, 'restored')
  assert.equal(report.steps[3].requests, 0)
  assert.ok(report.steps.every(step => step.reimport.kjdExact && step.reimport.dxfHandlesExact && step.reimport.dxfPayloadsAtTolerance))
  assert.ok(report.steps.every(step => step.untouchedObjects === report.objectCount - 1))
  assert.ok(progress.some(event => event.phase === 'round-passed'))
  assert.deepEqual(report.transportFailures, [])
  const serialized = JSON.stringify(report)
  for (const forbidden of ['PUBLIC-HISTORY-PROJECT', 'process-transport-only', 'Current user request:', 'Retained public survey note']) assert.equal(serialized.includes(forbidden), false)
  assert.ok(fixture.requests.every(request => request.model === 'deepseek-chat' && request.settings.thinking.type === 'disabled'))
})

test('a real inverse-text pending plan is rejected when the immutable round requires engine undo', async () => {
  const fixture = fixtureModel({ inverseAt: 1 })
  const report = await runAiHistoryProviderWorkflow({ fixture: true, modelCall: fixture.call })
  assert.equal(report.passed, false)
  assert.equal(report.steps[0].passed, true)
  assert.equal(report.steps[1].status, 'proposal')
  assert.equal(report.steps[1].failureStage, 'exact-plan-review')
  assert.equal(report.steps[1].failureCode, 'UNEXPECTED_COMMAND')
  assert.ok(report.steps.slice(2).every(step => step.status === 'unexecuted' && step.requests === 0))
  assert.deepEqual(report.engineCounts, { textEdits: 1, undos: 0, redos: 0, localArchiveRefreshes: 0 })
  assert.equal(report.final.snapshotSha256, report.steps[0].snapshotSha256)
  assert.equal(report.final.undoCount, 1)
  assert.equal(report.executedModelRequests, 0)
})

test('wrong requested label, prose-only claims and host review veto never approve a drawing edit', async () => {
  for (const configuration of [{ wrongText: true }, { prose: true }, {}]) {
    const fixture = fixtureModel(configuration)
    const report = await runAiHistoryProviderWorkflow({ fixture: true, modelCall: fixture.call,
      ...(Object.keys(configuration).length ? {} : { onReview: () => false }) })
    assert.equal(report.passed, false)
    assert.equal(report.steps[0].passed, false)
    assert.ok(report.steps.slice(1).every(step => step.status === 'unexecuted'))
    assert.deepEqual(report.engineCounts, { textEdits: 0, undos: 0, redos: 0, localArchiveRefreshes: 0 })
    assert.equal(report.final.undoCount, 0)
    assert.equal(report.final.redoCount, 0)
    assert.equal(report.executedModelRequests, 0)
  }
})

test('global request budget and unverifiable usage produce individual failures without extra provider execution', async () => {
  const fixture = fixtureModel()
  const limited = await runAiHistoryProviderWorkflow({ fixture: true, modelCall: fixture.call, maxRequests: 2 })
  assert.equal(limited.passed, false)
  assert.equal(limited.requests, 2)
  assert.equal(fixture.requests.length, 2)
  assert.equal(limited.steps[0].passed, true)
  assert.equal(limited.steps[1].passed, false)
  assert.equal(limited.transportFailures[0].code, 'MODEL_REQUEST_BUDGET')
  const invalid = fixtureModel({ badUsage: true })
  const usage = await runAiHistoryProviderWorkflow({ fixture: true, modelCall: invalid.call })
  assert.equal(usage.passed, false)
  assert.equal(usage.requests, 1)
  assert.equal(usage.trace.length, 0)
  assert.equal(usage.completeUsage, false)
  assert.equal(usage.verifiedTokens, null)
  assert.equal(usage.transportFailures[0].code, 'INCOMPLETE_PROVIDER_USAGE')
  assert.equal(usage.engineCounts.textEdits, 0)
})

test('private source reports omit text, prompts and callback error content while retaining measured outcomes', async () => {
  const targetText = 'PRIVATE_PROJECT_LABEL_DO_NOT_PUBLISH'
  const { bytes } = await createPublicAiHistoryDrawing({ targetText })
  const fixture = fixtureModel({ targetText })
  const report = await runAiHistoryProviderWorkflow({ bytes, targetText, sourceKind: 'private-local-dxf', fixture: true, modelCall: fixture.call })
  assert.equal(report.passed, true, JSON.stringify(report.steps))
  assert.equal(report.sourceKind, 'private-local-dxf')
  assert.equal(JSON.stringify(report).includes(targetText), false)
  assert.equal(report.executedModelRequests, 0)
  const errorFixture = fixtureModel({ targetText })
  const rejected = await runAiHistoryProviderWorkflow({ bytes, targetText, sourceKind: 'private-local-dxf', fixture: true,
    modelCall: errorFixture.call, onReview: () => { throw Object.assign(new Error(targetText), { code: targetText }) } })
  assert.equal(rejected.passed, false)
  assert.equal(JSON.stringify(rejected).includes(targetText), false)
  assert.equal(rejected.steps[0].failureCode, 'WORKFLOW_VERIFICATION_FAILED')
  assert.equal(rejected.final.undoCount, 0)
})

test('injected model execution requires explicit fixture mode and invalid CLI never prints supplied paths', async () => {
  await assert.rejects(runAiHistoryProviderWorkflow({ modelCall: async () => {} }), /FIXTURE_MODE_REQUIRED/)
  await assert.rejects(runAiHistoryProviderWorkflow({ provider: 'unrecognized' }), /INVALID_PROVIDER_CONFIG/)
  await assert.rejects(runAiHistoryProviderWorkflow({ maxRequests: 1000 }), /INVALID_BUDGET/)
  const privatePath = 'D:/private-project/not-a-real-customer-drawing.dxf'
  const cli = spawnSync(process.execPath, ['scripts/benchmarks/ai-history-provider-workflow.mjs', '--run', '--drawing', privatePath], { encoding: 'utf8', windowsHide: true })
  assert.equal(cli.status, 1)
  assert.equal(JSON.parse(cli.stdout).failure, 'PRIVATE_TARGET_TEXT_REQUIRED')
  assert.equal(cli.stdout.includes(privatePath), false)
  assert.equal(cli.stderr, '')
})
