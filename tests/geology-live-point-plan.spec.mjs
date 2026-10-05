import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runGeologyUserScenarios } from '../scripts/testing/run-geology-user-scenarios.mjs'
import { ROUND7_POINT_PLAN_DESCRIPTORS, round7PointPlanPhysicalGeometryMatches, round7PointPlanDxfPhysicalSemantics,
} from '../scripts/testing/helpers/geology-round7-point-plan-oracles.mjs'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const marker = 'Public synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. '
const call = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const response = (toolCalls = [], content = '') => ({ model: 'fixture-not-a-live-provider', content, toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 23, outputTokens: 8, totalTokens: 31 }, elapsedMs: 1 })

async function runPointPlan(descriptor, mutate = () => {}) {
  const scenario = corpus.scenarios.find(item => item.expected.intent === descriptor.intent && item.id.endsWith('-zh-direct'))
  const requests = [], events = []
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', answerEncoding: 'json-object',
    answerPolicyVersion: 'native-policy-codes-v1', scenarioIds: [scenario.id], maxScenarios: 1, maxRequests: 6,
    onScenarioResult: event => events.push(event), modelCall: async input => {
      requests.push(structuredClone(input))
      assert.equal(Object.hasOwn(input.settings, 'response_format'), false, 'Creation tools do not use final-answer JSON mode')
      const bound = JSON.parse(input.messages.find(message => message.role === 'user').content.split(marker).at(-1))
      const supplied = bound.suppliedInputs.completePointLocationInput.input
      assert.equal(supplied.units, 'meter')
      assert.equal(bound.suppliedInputs.completePointLocationInput.drawingUnits, 'millimeter')
      assert.doesNotMatch(JSON.stringify(bound), /"commandArgs"|"preview"|"engineeringEvidence"|"oracleBaselineDocument"/)
      if (requests.length === 1) return response([
        call('cad_read_drawing', {}, 'read-actual-empty-drawing'),
        call('cad_read_geology_source', { expectedRevision: bound.revision, drawingId: '', maxBytes: 8192 }, 'read-actual-empty-source'),
      ])
      if (requests.length === 2) {
        const reads = input.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))
        assert.equal(reads.length, 2)
        assert.ok(reads.every(result => result.ok && result.value.documentId === bound.documentId && result.value.revision === bound.revision))
        assert.equal(reads[0].value.units, 'millimeter')
        assert.equal(reads[0].value.entities.length, 0)
        assert.deepEqual(reads[1].value.drawingIds, [])
        const args = { ...structuredClone(supplied), expectedRevision: bound.revision }
        mutate(args)
        return response([call('cad_propose_geology_plan', args, 'actual-native-point-plan')])
      }
      return response([], 'The invalid request was rejected; no change was applied.')
    } })
  assert.equal(report.evidenceOrigin, 'fixture-oracle-selftest')
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.passed, 0)
  assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.allSelectedPassed, false)
  return { report, requests, events }
}
for (const descriptor of ROUND7_POINT_PLAN_DESCRIPTORS) test(`real chat host, exact metre source, millimetre layout and approval: ${descriptor.intent}`, async () => {
  const { report, requests, events } = await runPointPlan(descriptor)
  assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify({ row: report.scenarios[0],
    runtimeError: events[0]?.result.error, calls: events[0]?.evidence.toolCalls }))
  assert.equal(report.requests, 2)
  assert.ok(requests.every(request => request.settings.tools.some(tool => tool.function.name === 'cad_propose_geology_plan')))
  const { evidence, fixture } = events[0]
  assert.equal(evidence.stage, 'committed')
  assert.equal(evidence.hostApprovalApplied, true)
  assert.equal(evidence.approvalReceipt.status, 'committed')
  assert.equal(evidence.approvalReceipt.command, 'CREATEBATCH')
  assert.equal(evidence.approvalReceipt.beforeRevision, 0)
  assert.equal(evidence.approvalReceipt.afterRevision, 1)
  assert.equal(evidence.afterDocument.history.undoCount, 1)
  assert.ok(round7PointPlanPhysicalGeometryMatches(evidence.afterDocument,
    fixture.suppliedInputs.completePointLocationInput.input))
  assert.deepEqual(evidence.afterDocument.snapshot().opaquePayloads, {}, 'Plan graphics are not an invented verified geology source recipe')
  const sdk = createKJDrawSDK(), dxf = await sdk.writeDocument(evidence.afterDocument, { format: 'DXF' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF' })
  // JSON omission of an optional undefined alignmentPoint is not a coordinate
  // edit. Compare the complete serialized projection without numeric rounding.
  assert.equal(canonicalStringify(round7PointPlanDxfPhysicalSemantics(reopened)),
    canonicalStringify(round7PointPlanDxfPhysicalSemantics(evidence.afterDocument)))
  assert.ok(round7PointPlanPhysicalGeometryMatches(reopened, fixture.suppliedInputs.completePointLocationInput.input))
  await evidence.afterDocument.undo()
  assert.equal(evidence.afterDocument.listEntities().length, 0)
  await evidence.afterDocument.redo()
  assert.ok(round7PointPlanPhysicalGeometryMatches(evidence.afterDocument, fixture.suppliedInputs.completePointLocationInput.input))
})
for (const [label, mutate] of [
  ['wrong supplied hole center', args => { args.boreholes[0].position[0] += 1 }],
  ['wrong supplied route ordering', args => { args.sectionLines[0].holeIds.reverse() }],
  ['wrong scale', args => { args.scale = 500 }],
]) test(`incorrect caller fact cannot be auto-approved: ${label}`, async () => {
  const { report, events } = await runPointPlan(ROUND7_POINT_PLAN_DESCRIPTORS[0], mutate)
  assert.equal(report.scenarios[0].status, 'failed')
  assert.equal(report.scenarios[0].runtimeStatus, 'proposal')
  assert.equal(events[0].evidence.hostApprovalApplied, false)
  assert.equal(events[0].evidence.afterDocument.revision, 0)
  assert.equal(events[0].evidence.afterDocument.listEntities().length, 0)
})
