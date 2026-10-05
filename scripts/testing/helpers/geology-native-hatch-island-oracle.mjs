import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { buildPublicScenarioFixture, fixtureStateSignature, scenarioFixtureInputBindings } from './geology-scenario-fixtures.mjs'
import { KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalizeAgentPlanBinding, KJ_AGENT_PLAN_BINDING_DOMAIN, KJ_AGENT_PLAN_BINDING_CANONICALIZATION } from '../../../packages/kjdraw-sdk/src/agent-plans.js'
import { canonicalStringify, deepFreeze } from '../../../packages/kjdraw-sdk/src/utils.js'

// Additive, independent family only. No prompt interpreter, model response,
// forced tool selection, provider call, or unified-preflight admission.
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const intent = 'cad-structure.hatch-with-island', clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const baselines = new WeakMap()
const reads = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name))
const creationTools = new Set(['cad_propose_drawing', 'cad_propose_drawing_annotated', 'cad_propose_drawing_pattern'])
const outer = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0]]
const island = [[5, 5, 0], [10, 5, 0], [10, 10, 0], [5, 10, 0]]

export const NATIVE_HATCH_ISLAND_DESCRIPTOR = deepFreeze({
  id: `${intent}-independent-native-v1`, intent, kind: 'cad', fixtureId: 'synthetic-dxf-model-v1',
  fixtureBranch: 'independent-native-hatch-island-dxf', command: 'CREATEBATCH',
  supportedPrerequisites: ['fixture:synthetic-dxf-model-v1', 'document:current-revision-known',
    'fixture:synthetic-public-data-only', 'conversation:existing-same-document-context', 'conversation:prior-request-not-approved'],
  checks: corpus.scenarios.find(scenario => scenario.expected.intent === intent).expected.checks,
})
export const NATIVE_HATCH_ISLAND_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(scenario =>
  !scenario.sequence && scenario.expected.intent === intent).map(scenario => scenario.id))

function resolve(value) {
  if (typeof value !== 'string') return value
  const scenario = corpus.scenarios.find(item => item.id === value)
  if (!scenario) throw new Error(`Unknown frozen native hatch-island scenario: ${value}`)
  return scenario
}
export function nativeHatchIslandDescriptor(value) {
  if (value === intent) return NATIVE_HATCH_ISLAND_DESCRIPTOR
  const scenario = typeof value === 'string' ? corpus.scenarios.find(item => item.id === value) : value
  return scenario?.expected?.intent === intent ? NATIVE_HATCH_ISLAND_DESCRIPTOR : null
}
export function assessNativeHatchIslandReadiness(value) {
  const scenario = resolve(value), descriptor = nativeHatchIslandDescriptor(scenario)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', reason: 'no-independent-native-hatch-island-oracle', scenarioPassed: null }
  const unsupportedPrerequisites = scenario.prerequisites.filter(item => !descriptor.supportedPrerequisites.includes(item))
  return { status: unsupportedPrerequisites.length ? 'not-ready' : 'runnable', unsupportedPrerequisites,
    oracleId: descriptor.id, admissionScope: 'independent-family-only-not-unified-preflight',
    scenarioPassed: null, modelCalls: 0, executionStatus: 'not-run' }
}
export async function buildNativeHatchIslandFixture(value) {
  const scenario = resolve(value)
  assert.equal(assessNativeHatchIslandReadiness(scenario).status, 'runnable')
  const fixture = await buildPublicScenarioFixture('synthetic-dxf-model-v1', { prerequisites: scenario.prerequisites })
  assert.equal(fixture.artifact.format, 'DXF')
  assert.equal(fixture.document.listEntities({ type: 'HATCH' }).length, 0)
  assert.equal(fixture.document.history.undoCount, 0)
  fixture.fixtureBranch = NATIVE_HATCH_ISLAND_DESCRIPTOR.fixtureBranch
  fixture.nativeHatchIslandOracleId = NATIVE_HATCH_ISLAND_DESCRIPTOR.id
  baselines.set(fixture, { snapshot: clone(fixture.document.snapshot()), history: clone(fixture.document.history),
    bytes: Buffer.from(fixture.artifact.bytes), fingerprint: fixture.document.fingerprint() })
  return fixture
}
export function nativeHatchIslandInputBindings(fixture) { return scenarioFixtureInputBindings(fixture) }

function ringPoints(loop) {
  if (!loop || loop.closed !== true || !Array.isArray(loop.vertices) || loop.vertices.length !== 4 || loop.edges !== undefined) return null
  const points = loop.vertices.map(vertex => {
    if (Array.isArray(vertex)) return vertex
    if (!vertex || ['bulge', 'startWidth', 'endWidth'].some(key => (vertex[key] ?? 0) !== 0)) return null
    return vertex.point
  })
  return points.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)) ? points : null
}
function equivalentRing(points, expected) {
  if (!points) return false
  return [expected, [...expected].reverse()].some(order => order.some((_, shift) =>
    same(points, order.map((__, index) => order[(index + shift) % order.length]))))
}
function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)) / 2
}
function normalizedCommandPayload(payload, layerId) {
  return { ...payload, boundaryLoops: payload.boundaryLoops.map(loop => ({ ...loop,
    vertices: loop.vertices.map(vertex => Array.isArray(vertex)
      ? { point: vertex, bulge: 0, startWidth: 0, endWidth: 0 } : vertex) })), layerId, contractVersion: 1 }
}
export function nativeHatchIslandGeometry(payload) {
  try {
    if (!payload || payload.patternName !== 'ANSI31' || payload.solid !== false ||
      payload.associative === true || (payload.hatchStyle ?? 0) !== 0 ||
      !Number.isFinite(payload.patternScale) || payload.patternScale <= 0 || payload.patternScale > 1e12 ||
      !Number.isFinite(payload.patternAngle) || payload.patternAngle < 0 || payload.patternAngle > Math.PI * 2 ||
      !Array.isArray(payload.boundaryLoops) || payload.boundaryLoops.length !== 2) return null
    const [a, b] = payload.boundaryLoops, ap = ringPoints(a), bp = ringPoints(b)
    if (a.external !== true || b.external !== false || !equivalentRing(ap, outer) || !equivalentRing(bp, island)) return null
    const area = polygonArea(ap) - polygonArea(bp)
    return area === 375 ? { outerArea: 400, islandArea: 25, filledArea: area, loopCount: 2 } : null
  } catch { return null }
}

function committedStatePreserved(document, baseline, hatch) {
  try {
    const actual = clone(document.snapshot()), before = baseline.snapshot
    const newIds = Object.keys(actual.objects).filter(id => !Object.hasOwn(before.objects, id))
    if (!same(newIds, [hatch.id])) return false
    const entity = actual.objects[hatch.id], modelId = before.spaces.modelSpaceId
    if (!entity || entity.kind !== 'entity' || entity.type !== 'HATCH' || entity.erased || entity.ownerId !== modelId ||
      !same(entity.payload, hatch.payload) || entity.handle !== before.header.handseed ||
      actual.header.handseed !== (BigInt(`0x${before.header.handseed}`) + 1n).toString(16).toUpperCase()) return false
    if (!same(actual.objects[modelId].payload.entityIds, [...before.objects[modelId].payload.entityIds, hatch.id])) return false
    delete actual.objects[hatch.id]
    actual.objects[modelId].payload.entityIds = clone(before.objects[modelId].payload.entityIds)
    if (!Array.isArray(actual.revisions) || actual.revisions.length !== before.revisions.length + 1 ||
      actual.revisions.at(-1).source !== 'command:CREATEBATCH' || actual.revisions.at(-1).operationCount !== 1) return false
    actual.revisions.pop()
    actual.revision = before.revision
    actual.header.handseed = before.header.handseed
    actual.metadata.modifiedAt = before.metadata.modifiedAt
    return same(actual, before)
  } catch { return false }
}

export function evaluateNativeHatchIslandOracle(value, fixture, evidence) {
  const scenario = resolve(value), baseline = baselines.get(fixture)
  if (!baseline || assessNativeHatchIslandReadiness(scenario).status !== 'runnable' || !evidence ||
    !['fixture-oracle-selftest', 'real-model'].includes(evidence.origin) || !evidence.afterDocument || !Array.isArray(evidence.toolCalls))
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-independent-native-hatch-island-evidence-missing' }
  const assertions = [], check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  try {
    const proposal = evidence.proposal, calls = evidence.toolCalls, document = evidence.afterDocument
    const revision = baseline.snapshot.revision, units = baseline.snapshot.header.units
    const proposalIndex = calls.findIndex(call => creationTools.has(call.name) && call.result?.ok === true &&
      call.args?.expectedRevision === revision && call.args?.units === units && same(call.result.value, proposal))
    const boundRead = call => reads.has(call.name) && call.result?.ok === true && call.result.value?.documentId === fixture.document.id &&
      call.result.value.revision === revision && (call.name === 'cad_read_drawing' || call.args?.expectedRevision === revision) &&
      (call.result.value.units === undefined || call.result.value.units === units)
    const plan = fixture.sdk.agentPlans.get(proposal?.planId)
    const argumentBinding = plan && proposal && createHash('sha256').update(canonicalizeAgentPlanBinding({
      schema: KJ_AGENT_PLAN_BINDING_DOMAIN, canonicalization: KJ_AGENT_PLAN_BINDING_CANONICALIZATION,
      planId: plan.planId, command: proposal.command, arguments: proposal.arguments,
      document: { id: fixture.document.id, expectedRevision: revision,
        fingerprint: baseline.fingerprint, contentDigest: plan.documentContentDigest },
    })).digest('hex')
    check('current-document-revision-checked', document.id === fixture.document.id &&
      proposal?.documentId === fixture.document.id && proposal.expectedRevision === revision && proposal.units === units &&
      calls.slice(0, proposalIndex).some(boundRead))
    check('actual-native-proposal-tool-evidence', proposalIndex >= 0 && plan?.documentId === fixture.document.id &&
      plan.expectedRevision === revision && plan.documentFingerprint === baseline.fingerprint &&
      plan.bindingAlgorithm === 'SHA-256' && argumentBinding === plan.binding &&
      fixture.sdk.agentPlans.list().length === 1 && calls.every((call, index) => !call.result?.ok || reads.has(call.name) || index === proposalIndex))
    const preview = proposal?.preview, hatch = Array.isArray(preview?.after) && preview.after.length === 1 ? preview.after[0] : null
    const nativeGeometry = hatch?.type === 'HATCH' ? nativeHatchIslandGeometry(hatch.payload) : null
    const layer = hatch && baseline.snapshot.objects[hatch.payload?.layerId]
    const commandHatch = proposal?.arguments?.entities?.length === 1 ? proposal.arguments.entities[0] : null
    check('native-hatch-island-topology', !!nativeGeometry && !!nativeHatchIslandGeometry(commandHatch?.payload) &&
      commandHatch.type === 'HATCH' && commandHatch.options?.id === hatch.id &&
      commandHatch.options?.ownerId === baseline.snapshot.spaces.modelSpaceId &&
      layer?.type === 'LAYER' && layer.payload.visible !== false && !layer.payload.frozen && !layer.payload.locked)
    check('no-custom-pattern-substitution', !!hatch && !Object.hasOwn(hatch.payload, 'patternLines') &&
      !Object.hasOwn(hatch.payload, 'rawTags') && !Object.hasOwn(commandHatch?.payload ?? {}, 'patternLines') &&
      !Object.hasOwn(commandHatch?.payload ?? {}, 'rawTags'))
    check('full-before-after-preview', proposal?.command === 'CREATEBATCH' && proposal.status === 'awaiting-host-approval' &&
      preview?.documentId === fixture.document.id && preview.revision === revision && preview.command === 'CREATEBATCH' &&
      same(preview.before, []) && !!hatch && (!Object.hasOwn(preview, 'resources') || same(preview.resources, [])) &&
      !!commandHatch?.payload && same(hatch.payload, normalizedCommandPayload(commandHatch.payload, hatch.payload?.layerId)))
    check('original-public-dxf-bytes-unchanged', Buffer.from(fixture.artifact.bytes).equals(baseline.bytes))
    check('no-fabricated-source-facts', !Object.hasOwn(proposal?.arguments ?? {}, 'geologySource') &&
      same(document.snapshot().metadata.custom, baseline.snapshot.metadata.custom))
    const phase = evidence.phase ?? (evidence.stage === 'pending-preview' ? 'pending' : evidence.stage)
    if (phase === 'pending') {
      check('no-mutation-during-preview', fixtureStateSignature(document) === canonicalStringify(baseline.snapshot) && same(document.history, baseline.history))
      check('explicit-host-approval-before-commit', plan?.status === 'active' && !evidence.approval && !evidence.approvalReceipt && !evidence.hostApprovalApplied)
    } else if (phase === 'committed') {
      const approval = evidence.approvalReceipt ?? evidence.approval, receipt = approval?.value ?? approval
      check('explicit-host-approval-before-commit', approval?.ok === true && plan?.status === 'consumed' && !!plan.confirmedBy &&
        evidence.approvedPlanId === proposal?.planId && receipt?.status === 'committed' && receipt.command === 'CREATEBATCH' &&
        receipt.beforeRevision === revision && receipt.afterRevision === revision + 1)
      check('one-atomic-native-hatch-commit', document.revision === revision + 1 && document.history.undoCount === 1 &&
        document.history.redoCount === 0 && !!hatch && committedStatePreserved(document, baseline, hatch))
      check('no-mutation-during-preview', evidence.pendingVerdict?.status === 'satisfied' &&
        evidence.pendingVerdict.oracleId === NATIVE_HATCH_ISLAND_DESCRIPTOR.id &&
        evidence.pendingVerdict.assertions?.some(row => row.id === 'no-mutation-during-preview' && row.satisfied === true))
    } else check('supported-evidence-phase', false)
    check('no-success-claim-without-state-or-artifact-evidence', !evidence.error &&
      (evidence.executionStatus === undefined || ['awaiting-approval', 'pending-preview', 'committed'].includes(evidence.executionStatus)) &&
      proposalIndex >= 0 && !!nativeGeometry)
  } catch { check('well-formed-native-evidence', false) }
  // Each frozen check above has a concrete assertion; none is a copied verdict.
  for (const id of NATIVE_HATCH_ISLAND_DESCRIPTOR.checks) if (!assertions.some(row => row.id === id)) check(id, false)
  const passed = assertions.every(row => row.satisfied)
  return { status: passed ? 'satisfied' : 'failed', oracleId: NATIVE_HATCH_ISLAND_DESCRIPTOR.id, evidenceOrigin: evidence.origin,
    admissionScope: 'independent-family-only-not-unified-preflight', scenarioPassed: evidence.origin === 'real-model' ? passed : null,
    scenarioExecuted: evidence.origin === 'real-model', modelCalls: evidence.origin === 'fixture-oracle-selftest' ? 0 : undefined, assertions }
}

// Independent ASCII-DXF tag parser, not engine import or rendering geometry.
function dxfTags(bytes) {
  const lines = Buffer.from(bytes).toString('utf8').replace(/\r/g, '').split('\n')
  if (lines.at(-1) === '') lines.pop()
  assert.equal(lines.length % 2, 0)
  return Array.from({ length: lines.length / 2 }, (_, index) => ({ code: Number(lines[index * 2].trim()), value: lines[index * 2 + 1].trim() }))
}
function entityRecords(bytes) {
  const tags = dxfTags(bytes)
  const start = tags.findIndex((tag, index) => tag.code === 0 && tag.value === 'SECTION' && tags[index + 1]?.code === 2 && tags[index + 1].value === 'ENTITIES')
  assert.ok(start >= 0)
  const records = []; let current = null
  for (const tag of tags.slice(start + 2)) {
    if (tag.code === 0 && tag.value === 'ENDSEC') break
    if (tag.code === 0) { current = []; records.push(current) }
    assert.ok(current)
    current.push(tag)
  }
  return records
}
const tagValue = (record, code) => record.find(tag => tag.code === code)?.value
const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b))
function blockRecordNames(bytes) {
  const records = []; let current = []
  for (const tag of dxfTags(bytes)) {
    if (tag.code === 0) { current = []; records.push(current) }
    current.push(tag)
  }
  return new Map(records.filter(record => record[0]?.value === 'BLOCK_RECORD')
    .map(record => [tagValue(record, 5), tagValue(record, 2)]))
}
function ownerResolvedTags(record, owners) {
  const resolved = record.map(tag => {
    if (tag.code !== 330) return tag
    const ownerName = owners.get(tag.value)
    assert.equal(ownerName, '*MODEL_SPACE', 'Original and exported owner references must both resolve to the actual model BLOCK_RECORD')
    return { code: tag.code, value: ownerName }
  })
  if (!['TEXT', 'MTEXT'].includes(record[0]?.value)) return resolved
  // DXF's omitted text-style field means STANDARD. Import makes that same
  // existing default explicit; a different or duplicate style still fails.
  const styles = resolved.filter(tag => tag.code === 7)
  assert.ok(styles.length <= 1)
  return { tags: resolved.filter(tag => tag.code !== 7), textStyle: styles[0]?.value ?? 'STANDARD' }
}

/** Verifies actual emitted bytes with an independent native tag oracle and
 * then genuinely reopens those same bytes. Does not write an artifact. */
export async function verifyNativeHatchIslandDxf(fixture, { document = fixture.document, bytes } = {}) {
  const baseline = baselines.get(fixture)
  assert.ok(baseline)
  const artifact = bytes ?? await fixture.sdk.writeDocument(document, { format: 'DXF' })
  const original = entityRecords(baseline.bytes), records = entityRecords(artifact)
  const originalOwners = blockRecordNames(baseline.bytes), exportedOwners = blockRecordNames(artifact)
  const byHandle = new Map(records.map(record => [tagValue(record, 5), record]))
  assert.equal(byHandle.size, original.length + 1)
  assert.equal(records.length, byHandle.size)
  // Import reconstructs owner table records even for an untouched re-export.
  // Independently resolve both handle graphs; every other entity field and
  // every actual entity handle must be exactly preserved, without stripping
  // or ignoring owner references.
  for (const record of original) assert.deepEqual(ownerResolvedTags(byHandle.get(tagValue(record, 5)), exportedOwners),
    ownerResolvedTags(record, originalOwners), 'Untargeted original DXF fields and resolved owner identity must stay exact')
  const hatches = document.listEntities({ type: 'HATCH' })
  assert.equal(hatches.length, 1)
  const hatch = hatches[0], record = byHandle.get(hatch.handle), geometry = nativeHatchIslandGeometry(hatch.payload)
  assert.ok(geometry)
  assert.equal(record[0].value, 'HATCH')
  for (const [code, expected] of [[2, 'ANSI31'], [70, '0'], [71, '0'], [91, '2'], [75, '0'], [76, '1'], [78, '1']]) assert.equal(tagValue(record, code), expected)
  assert.equal(tagValue(record, 330), document.getObject(document.spaces.modelSpaceId).handle)
  let cursor = record.findIndex(tag => tag.code === 91) + 1
  const take = code => { const tag = record[cursor++]; assert.equal(tag?.code, code); return Number(tag.value) }
  for (const [index, expected] of [outer, island].entries()) {
    assert.equal(take(92), index === 0 ? 3 : 2)
    assert.equal(take(72), 0)
    assert.equal(take(73), 1)
    assert.equal(take(93), 4)
    const points = Array.from({ length: 4 }, () => [take(10), take(20), 0])
    assert.ok(equivalentRing(points, expected))
    assert.equal(take(97), 0)
  }
  assert.ok(near(Number(tagValue(record, 41)), hatch.payload.patternScale))
  assert.ok(near(Number(tagValue(record, 52)) * Math.PI / 180, hatch.payload.patternAngle))
  const theta = Math.PI / 4 + hatch.payload.patternAngle
  assert.ok(near(Number(tagValue(record, 53)), ((theta * 180 / Math.PI) % 360 + 360) % 360))
  assert.equal(Number(tagValue(record, 43)), 0)
  assert.equal(Number(tagValue(record, 44)), 0)
  assert.ok(near(Number(tagValue(record, 45)), -3.175 * Math.sin(theta) * hatch.payload.patternScale))
  assert.ok(near(Number(tagValue(record, 46)), 3.175 * Math.cos(theta) * hatch.payload.patternScale))
  assert.equal(tagValue(record, 79), '0')
  const reopened = await fixture.sdk.readDocument(artifact, { format: 'DXF' })
  try {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, original.length + 1)
    const actual = reopened.listEntities({ type: 'HATCH' })
    assert.equal(actual.length, 1)
    assert.equal(actual[0].handle, hatch.handle)
    assert.deepEqual(nativeHatchIslandGeometry(actual[0].payload), geometry)
    assert.equal(actual[0].payload.patternLines.length, 1)
    assert.ok(near(actual[0].payload.patternLines[0].angle, ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)))
    return { status: 'satisfied', format: 'DXF', independentParser: 'native-ascii-tag-oracle',
      entityCount: original.length + 1, ...geometry, artifactBytes: Buffer.from(artifact).length, modelCalls: 0 }
  } finally { fixture.sdk.closeDocument(reopened.id) }
}
