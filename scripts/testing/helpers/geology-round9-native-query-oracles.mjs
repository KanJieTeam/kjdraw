import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { buildPublicScenarioFixture, fixtureStateSignature, scenarioFixtureInputBindings } from './geology-scenario-fixtures.mjs'
import { KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'

// Additive native selftest/oracle surface. Never dispatches a model or interprets prose.
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const readTools = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name))
const prerequisites = Object.freeze(['fixture:synthetic-dxf-model-v1', 'document:current-revision-known',
  'fixture:synthetic-public-data-only', 'conversation:existing-same-document-context', 'conversation:prior-request-not-approved'])
export const ROUND9_NATIVE_QUERY_DESCRIPTORS = Object.freeze(['cad-query.model-extents', 'cad-query.label-neighborhood'].map(intent =>
  Object.freeze({ intent, id: `${intent}-native-round9-v1`, kind: 'read-only', fixtureId: 'synthetic-dxf-model-v1',
    fixtureBranch: 'round9-independent-model-paper-native-dxf', supportedPrerequisites: prerequisites,
    checks: Object.freeze(corpus.scenarios.find(item => item.expected.intent === intent).expected.checks) })))
const descriptors = new Map(ROUND9_NATIVE_QUERY_DESCRIPTORS.map(item => [item.intent, item]))
export const ROUND9_NATIVE_QUERY_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(item => !item.sequence && descriptors.has(item.expected.intent)).map(item => item.id))

// Only an explicit fixture caller may opt in. This is not the product's meaning
// of "near", and cannot retrospectively make the original six questions ready.
export const ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT = Object.freeze({ version: 'public-neighborhood-caller-v1',
  provenance: 'public-synthetic-caller-declaration', radius: 10, units: 'millimeter',
  metric: 'shortest-distance-from-text-anchor-to-native-xy-curve', boundary: 'inclusive', ownerScope: 'same-model-owner' })
function declaredPolicy(policy) {
  if (policy === undefined) return null
  assert.ok(policy && typeof policy === 'object' && !Array.isArray(policy), 'Neighborhood policy must be explicitly declared plain data')
  assert.ok([Object.prototype, null].includes(Object.getPrototypeOf(policy)), 'Neighborhood policy must be plain data')
  assert.deepEqual(Reflect.ownKeys(policy).sort(), Object.keys(ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT).sort(), 'Closed neighborhood caller contract')
  for (const field of Reflect.ownKeys(policy)) {
    const descriptor = Object.getOwnPropertyDescriptor(policy, field)
    assert.ok(descriptor.enumerable && 'value' in descriptor, 'No hidden fields or policy accessors')
  }
  for (const [field, value] of Object.entries(ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT)) if (field !== 'radius') assert.equal(policy[field], value, `Unsupported caller policy ${field}`)
  assert.ok(Number.isFinite(policy.radius) && policy.radius > 0 && policy.radius <= 10000, 'Caller radius must be finite, positive and bounded in millimeters')
  return clone(policy)
}
function resolve(value) {
  if (typeof value !== 'string') return value
  const scenario = corpus.scenarios.find(item => item.id === value)
  assert.ok(scenario, 'Unknown original round9 scenario')
  return scenario
}
export function round9NativeQueryDescriptor(value) {
  if (typeof value === 'string' && descriptors.has(value)) return descriptors.get(value)
  return descriptors.get((typeof value === 'string' ? corpus.scenarios.find(item => item.id === value) : value)?.expected?.intent) ?? null
}
export function assessRound9NativeQueryReadiness(value, { neighborhoodPolicy } = {}) {
  const scenario = resolve(value), descriptor = round9NativeQueryDescriptor(scenario)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', scenarioPassed: null, reason: 'no-round9-native-query-oracle' }
  const unsupportedPrerequisites = scenario.prerequisites.filter(item => !prerequisites.includes(item))
  const policy = descriptor.intent === 'cad-query.label-neighborhood' ? declaredPolicy(neighborhoodPolicy) : null
  return { status: unsupportedPrerequisites.length || descriptor.intent === 'cad-query.label-neighborhood' && !policy ? 'not-ready' : 'runnable',
    ...(descriptor.intent === 'cad-query.label-neighborhood' && !policy ? { reason: 'missing-public-neighborhood-policy', missingFacts: ['radius', 'distance-metric', 'boundary-inclusion', 'owner-scope'] } : {}),
    unsupportedPrerequisites, oracleId: descriptor.id, scenarioPassed: null, modelCalls: 0, executionStatus: 'not-run',
    callerContractVersion: policy?.version ?? 'original-frozen-question-only' }
}
export function round9NativeQueryAnswerFrame(value, options = {}) {
  const descriptor = round9NativeQueryDescriptor(value)
  if (!descriptor) return null
  const header = '"documentId":"actual current document ID","revision":0,"units":"actual drawing units"'
  if (descriptor.intent === 'cad-query.label-neighborhood') {
    const policy = declaredPolicy(options.neighborhoodPolicy)
    if (!policy) return null
    return `Return only one JSON answer instance: {${header},"referenceId":"actual TEXT-A ID","candidates":[{"id":"actual native ID","type":"LINE or CIRCLE"}],"geologicalMeaningAssigned":false} (response grammar only, no answer values. The explicit public caller contract is ${JSON.stringify(policy)}. Use the native TEXT insertion position as the reference anchor. LINE distance is to its finite XY segment; CIRCLE distance is to its XY circumference, not center or filled disk. Radius includes its boundary; only entities in the same MODEL owner are eligible. Include every eligible LINE/CIRCLE and no other type or owner. Treat these only as geometric candidates, never borehole facts. Read the actual anchor and geometry with complete query pagination. Array row order is not scored.)`
  }
  const scenario = typeof value === 'string' && descriptors.has(value) ? null : resolve(value)
  const paper = scenario?.language === 'en' ? ',"paperSpaces":[{"spaceId":"actual nonempty paper owner ID","min":[0,0,0],"max":[0,0,0]}]' : ''
  return `Return only one JSON answer instance: {${header},"model":{"spaceId":"actual model owner ID","min":[0,0,0],"max":[0,0,0]},"excludedPaperSpaceIds":["actual paper owner ID"]${paper}} (response grammar only; zeroes are placeholders. Compute true complete native model extents, never header caches, paper bounds or viewport projections. Include all actual paper owner IDs as exclusions. For the original English request also report each nonempty paper owner's extents separately in paperSpaces; do not mix them into model. Read native model geometry and complete layout inventory; traverse every required geometry page. Bounds are drawing-unit XYZ minima/maxima. No industry meaning is inferred.)`
}
export function round9NativeQueryInputBindings(fixture) { return scenarioFixtureInputBindings(fixture) }

const vertices = record => record.payload.vertices.map(vertex => Array.isArray(vertex) ? vertex : vertex.point)
const union = boxes => ({ min: [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis]))),
  max: [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis]))) })
function pointsBox(points) { return union(points.map(point => ({ min: [point[0], point[1], point[2] ?? 0], max: [point[0], point[1], point[2] ?? 0] }))) }
function independentBox(record) {
  const p = record.payload
  if (record.type === 'LINE') return pointsBox([p.start, p.end])
  if (record.type === 'CIRCLE') return { min: [p.center[0] - p.radius, p.center[1] - p.radius, p.center[2] ?? 0], max: [p.center[0] + p.radius, p.center[1] + p.radius, p.center[2] ?? 0] }
  if (record.type === 'LWPOLYLINE') return pointsBox(vertices(record))
  if (['TEXT', 'MTEXT'].includes(record.type)) {
    // Conservative enclosure, not engine glyph extents. This fixture's very
    // large explicit model rectangle strictly encloses these small zero-rotation
    // strings, so exact model minima/maxima are determined by native vertices.
    assert.equal(p.rotation ?? 0, 0)
    const reserve = Math.max([...p.text].length * p.height * 4, p.width ?? 0, p.height * 4)
    return { min: [p.position[0] - reserve, p.position[1] - reserve, p.position[2] ?? 0], max: [p.position[0] + reserve, p.position[1] + reserve, p.position[2] ?? 0] }
  }
  throw new Error('No independent round9 primitive oracle for this type')
}
function modelExtents(fixture) {
  const baseline = fixture.oracleBaselineDocument, modelId = baseline.spaces.modelSpaceId
  const outer = baseline.getObject(fixture.identityAliases['MODEL-GUIDE'].nativeId), box = independentBox(outer)
  for (const record of baseline.listEntities().filter(item => item.ownerId === modelId)) {
    const inner = independentBox(record)
    assert.ok(inner.min.every((number, axis) => number >= box.min[axis]) && inner.max.every((number, axis) => number <= box.max[axis]), 'Explicit native model rectangle must independently enclose every other fixture primitive')
  }
  return { spaceId: modelId, ...box }
}
export async function buildRound9NativeQueryFixture(value, options = {}) {
  const scenario = resolve(value), descriptor = round9NativeQueryDescriptor(scenario)
  assert.equal(assessRound9NativeQueryReadiness(scenario, options).status, 'runnable', 'A missing neighborhood definition cannot be invented by a fixture')
  const policy = descriptor.intent === 'cad-query.label-neighborhood' ? declaredPolicy(options.neighborhoodPolicy) : null
  const base = await buildPublicScenarioFixture('synthetic-dxf-model-v1')
  try {
    const original = base.document, additions = []
    await original.transact('Declare independent public model/paper native geometry', tx => {
      const layerId = original.getObject(base.identityAliases['TEXT-A'].nativeId).payload.layerId
      const add = (alias, type, payload, ownerId) => { tx.createEntity(type, { ...payload, layerId }, { id: `round9-${alias}`, ...(ownerId ? { ownerId } : {}) }); additions.push(alias) }
      add('MODEL-GUIDE', 'LWPOLYLINE', { vertices: [[-1000, -800], [1400, -800], [1400, 1200], [-1000, 1200]], closed: true })
      const sheet = tx.createLayout({ name: 'Public separate paper frame' }), paperId = sheet.payload.blockRecordId
      add('PAPER-FRAME', 'LWPOLYLINE', { vertices: [[5000, 5000], [7000, 5000], [7000, 6000], [5000, 6000]], closed: true }, paperId)
      if (policy) {
        // Neutral aliases do not disclose which objects satisfy the query.
        add('LINE-C', 'LINE', { start: [1, 12, 0], end: [3, 12, 0] })
        add('CIRCLE-B', 'CIRCLE', { center: [16, 2, 0], radius: 4 })
        add('LINE-D', 'LINE', { start: [1, 12.01, 0], end: [3, 12.01, 0] })
        add('LINE-E', 'LINE', { start: [20, 2, 0], end: [30, 2, 0] })
        add('CIRCLE-C', 'CIRCLE', { center: [2, 2, 0], radius: 15 })
        add('PAPER-LINE-A', 'LINE', { start: [1, 1, 0], end: [3, 1, 0] }, paperId)
        add('PAPER-CIRCLE-A', 'CIRCLE', { center: [2, 2, 0], radius: 1 }, paperId)
      }
    })
    const handles = { ...Object.fromEntries(Object.entries(base.identityAliases).map(([alias, item]) => [alias, item.handle])),
      ...Object.fromEntries(additions.map(alias => [alias, original.getObject(`round9-${alias}`).handle])) }
    const bytes = await base.sdk.writeDocument(original, { format: 'DXF' }), document = await base.sdk.readDocument(bytes, { format: 'DXF' })
    assert.equal(document.validate().valid, true)
    const byHandle = new Map(document.listEntities().map(item => [item.handle, item]))
    const identityAliases = Object.fromEntries(Object.entries(handles).map(([alias, handle]) => {
      const entity = byHandle.get(handle)
      assert.ok(entity, 'An original native handle must survive actual DXF import')
      return [alias, { nativeId: entity.id, handle, type: entity.type }]
    }))
    assert.equal(document.listEntities().length, Object.keys(handles).length)
    if (original.id !== document.id) base.sdk.closeDocument(original.id)
    const fixture = { ...base, document, identityAliases, fixtureBranch: descriptor.fixtureBranch, round9NativeQueryOracleId: descriptor.id,
      artifact: { format: 'DXF', bytes }, initialEntities: clone(document.listEntities()), initialRevision: document.revision,
      initialState: fixtureStateSignature(document), initialHistory: clone(document.history), oracleBaselineDocument: document.fork(),
      initialArtifactBytes: Buffer.from(bytes), neighborhoodPolicy: policy,
      ...(policy ? { suppliedInputs: { neighborhoodQueryContract: clone(policy) } } : {}),
      conversationSeed: scenario.prerequisites.includes('conversation:prior-request-not-approved') ? [{ role: 'user', content:
        `Same public drawing ${document.id}, revision ${document.revision}. For the earlier request, merely consider a possible +1 mm X move of CIRCLE-MANUAL. Do not execute, propose or approve it. Wait for the next complete instruction, which supersedes it.` }]
        : scenario.prerequisites.includes('conversation:existing-same-document-context') ? [{ role: 'user', content:
          `Same public drawing ${document.id}, revision ${document.revision}. No previous discussion executed, proposed or approved a change. Wait for the next complete request.` }] : [],
      scenarioExecuted: false, modelCalls: 0 }
    modelExtents(fixture)
    return fixture
  } catch (error) { base.dispose(); throw error }
}
function distanceToCurve(point, record) {
  const p = record.payload
  if (record.type === 'CIRCLE') return Math.abs(Math.hypot(point[0] - p.center[0], point[1] - p.center[1]) - p.radius)
  const dx = p.end[0] - p.start[0], dy = p.end[1] - p.start[1], squared = dx * dx + dy * dy
  const t = squared ? Math.max(0, Math.min(1, ((point[0] - p.start[0]) * dx + (point[1] - p.start[1]) * dy) / squared)) : 0
  return Math.hypot(point[0] - p.start[0] - t * dx, point[1] - p.start[1] - t * dy)
}
export function expectedRound9NativeQueryAnswer(value, fixture) {
  const scenario = resolve(value), descriptor = round9NativeQueryDescriptor(scenario), baseline = fixture.oracleBaselineDocument
  const header = { documentId: fixture.document.id, revision: fixture.initialRevision, units: baseline.snapshot().header.units }
  if (descriptor.intent === 'cad-query.model-extents') {
    const paperSpaces = baseline.spaces.paperSpaceIds.flatMap(spaceId => {
      const records = baseline.listEntities().filter(item => item.ownerId === spaceId)
      return records.length ? [{ spaceId, ...union(records.map(independentBox)) }] : []
    })
    return { ...header, model: modelExtents(fixture), excludedPaperSpaceIds: [...baseline.spaces.paperSpaceIds],
      ...(scenario.language === 'en' ? { paperSpaces } : {}) }
  }
  assert.ok(fixture.neighborhoodPolicy, 'No neighborhood gold exists without an explicit caller policy')
  const anchor = baseline.getObject(fixture.identityAliases['TEXT-A'].nativeId)
  return { ...header, referenceId: anchor.id, candidates: baseline.listEntities().filter(item =>
    item.ownerId === baseline.spaces.modelSpaceId && ['LINE', 'CIRCLE'].includes(item.type) && distanceToCurve(anchor.payload.position, item) <= fixture.neighborhoodPolicy.radius)
    .map(item => ({ id: item.id, type: item.type })), geologicalMeaningAssigned: false }
}
function normalized(answer) {
  const value = clone(answer)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (['mm', 'millimeter', 'millimetre'].includes(value.units)) value.units = 'millimeter'
  if (Array.isArray(value.excludedPaperSpaceIds)) value.excludedPaperSpaceIds.sort()
  for (const field of ['candidates', 'paperSpaces']) if (Array.isArray(value[field])) value[field].sort((a, b) => String(a?.id ?? a?.spaceId).localeCompare(String(b?.id ?? b?.spaceId)))
  return value
}
const point = vertex => Array.isArray(vertex) ? vertex : vertex.point
function exactGeometryRead(record, entity) {
  const g = entity.geometry
  if (!g || entity.geometryOmittedReason !== null || entity.id !== record.id || entity.ownerId !== record.ownerId || entity.type !== record.type) return false
  if (record.type === 'LINE') return same(g.start, record.payload.start) && same(g.end, record.payload.end)
  if (record.type === 'CIRCLE') return same(g.center, record.payload.center) && g.radius === record.payload.radius
  if (record.type === 'LWPOLYLINE') return Array.isArray(g.vertices) && same(g.vertices.map(point), vertices(record)) && g.closed === record.payload.closed
  return same(g.position, record.payload.position) && g.text === record.payload.text && g.height === record.payload.height
}
function completeTraversal(calls, eligible, modelId) {
  const groups = new Map()
  for (const call of calls) {
    if (!['cad_query_drawing', 'cad_read_drawing', 'cad_read_page'].includes(call.name)) continue
    const filters = call.name === 'cad_query_drawing' ? call.args?.filters : {}
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) continue
    if (!eligible(filters)) continue
    const key = canonicalStringify(filters), list = groups.get(key) ?? []
    if (call.result.value.spaceId !== (filters.spaceId ?? modelId)) continue
    list.push(call); groups.set(key, list)
  }
  for (const list of groups.values()) {
    const byOffset = new Map(list.map(call => [call.args?.offset ?? 0, call]))
    let offset = 0, visited = new Set()
    while (byOffset.has(offset) && !visited.has(offset)) {
      visited.add(offset)
      const next = byOffset.get(offset).result.value.nextOffset
      if (next === null) return true
      if (!Number.isSafeInteger(next) || next <= offset) break
      offset = next
    }
  }
  return false
}
export function evaluateRound9NativeQueryOracle(value, fixture, evidence) {
  const scenario = resolve(value), descriptor = round9NativeQueryDescriptor(scenario)
  if (!fixture || assessRound9NativeQueryReadiness(scenario, { neighborhoodPolicy: fixture.neighborhoodPolicy ?? undefined }).status !== 'runnable' ||
    !evidence || !['fixture-oracle-selftest', 'real-model'].includes(evidence.origin) || !evidence.afterDocument || !Array.isArray(evidence.toolCalls))
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-round9-native-query-evidence-missing' }
  const assertions = [], check = (id, satisfied) => assertions.push({ id, kind: 'native-query-assertion', satisfied: !!satisfied })
  const calls = evidence.toolCalls, baseline = fixture.oracleBaselineDocument, modelId = baseline.spaces.modelSpaceId
  const bound = call => readTools.has(call.name) && call.result?.ok === true && call.result.value?.documentId === fixture.document.id &&
    call.result.value.revision === fixture.initialRevision && (call.name === 'cad_read_drawing' || call.args?.expectedRevision === fixture.initialRevision) &&
    (call.result.value.units === undefined || call.result.value.units === baseline.snapshot().header.units)
  const legal = calls.filter(bound)
  const observed = legal.flatMap(call => call.result.value.entities ?? [])
  const readRecord = record => observed.some(entity => exactGeometryRead(record, entity))
  check('successful-current-native-read-tools-only', calls.length > 0 && calls.every(bound))
  check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id && evidence.afterDocument.revision === fixture.initialRevision)
  check('read-only-state-unchanged', fixtureStateSignature(evidence.afterDocument) === fixture.initialState && same(evidence.afterDocument.history, fixture.initialHistory))
  check('original-dxf-bytes-unchanged', Buffer.from(fixture.artifact.bytes).equals(fixture.initialArtifactBytes))
  check('no-proposal-or-host-approval', !evidence.proposal && !evidence.approval && !evidence.approvalReceipt && !evidence.hostApprovalApplied && fixture.sdk.agentPlans.list().length === 0)
  check('completed-answer-not-runtime-error', !evidence.error && (evidence.executionStatus === undefined || ['message', 'responded'].includes(evidence.executionStatus)))
  const expected = expectedRound9NativeQueryAnswer(scenario, fixture)
  check('exact-independent-native-answer', same(normalized(evidence.answer), normalized(expected)))
  if (evidence.origin === 'real-model') {
    let rawMatches = false
    try { rawMatches = same(JSON.parse(evidence.rawFinalAnswer), evidence.answer) } catch { /* Raw final bytes are not repaired or stripped. */ }
    check('actual-final-model-answer-provenance', rawMatches)
  }
  if (descriptor.intent === 'cad-query.model-extents') {
    const layouts = legal.filter(call => call.name === 'cad_read_layouts')
    const wanted = [modelId, ...baseline.spaces.paperSpaceIds]
    check('complete-native-model-paper-layout-inventory', layouts.some(call => call.result.value.nextOffset === null) &&
      wanted.every(id => layouts.some(call => call.result.value.layouts?.some(layout => layout.spaceId === id && layout.model === (id === modelId)))))
    const modelRecords = baseline.listEntities().filter(item => item.ownerId === modelId)
    check('all-model-native-geometries-read', modelRecords.every(readRecord))
    const unrestricted = spaceId => filters => (filters.spaceId ?? modelId) === spaceId &&
      !['ids', 'types', 'layerIds', 'bounds'].some(field => Object.hasOwn(filters, field))
    check('complete-model-pagination', completeTraversal(legal, unrestricted(modelId), modelId))
    if (scenario.language === 'en') for (const paper of expected.paperSpaces) {
      check(`complete-paper-pagination:${paper.spaceId}`, completeTraversal(legal, unrestricted(paper.spaceId), modelId))
      check(`all-paper-native-geometries-read:${paper.spaceId}`, baseline.listEntities().filter(item => item.ownerId === paper.spaceId).every(readRecord))
    }
    check('model-paper-space-separated', evidence.answer?.model?.spaceId === modelId &&
      Array.isArray(evidence.answer?.excludedPaperSpaceIds) &&
      same([...evidence.answer.excludedPaperSpaceIds].sort(), [...baseline.spaces.paperSpaceIds].sort()))
  } else {
    const anchor = baseline.getObject(fixture.identityAliases['TEXT-A'].nativeId), radius = fixture.neighborhoodPolicy.radius
    const bounds = [anchor.payload.position[0] - radius, anchor.payload.position[1] - radius, anchor.payload.position[0] + radius, anchor.payload.position[1] + radius]
    const eligible = filters => (filters.spaceId ?? modelId) === modelId && !['ids', 'layerIds'].some(field => Object.hasOwn(filters, field)) &&
      (!Object.hasOwn(filters, 'types') || Array.isArray(filters.types) && filters.types.every(type => typeof type === 'string') &&
        same([...new Set(filters.types.map(type => type.toUpperCase()))].sort(), ['CIRCLE', 'LINE'])) &&
      (!Object.hasOwn(filters, 'bounds') || same(filters.bounds, bounds))
    check('public-caller-neighborhood-policy-supplied', same(round9NativeQueryInputBindings(fixture).suppliedInputs?.neighborhoodQueryContract, fixture.neighborhoodPolicy))
    check('actual-native-text-anchor-read', readRecord(anchor))
    check('every-required-native-candidate-read', expected.candidates.every(item => readRecord(baseline.getObject(item.id))))
    check('complete-neighborhood-query-pagination', completeTraversal(legal, eligible, modelId))
    check('spatial-candidates-not-geological-facts', evidence.answer?.geologicalMeaningAssigned === false)
  }
  const baseSatisfied = assertions.every(item => item.satisfied)
  for (const id of descriptor.checks) if (!assertions.some(item => item.id === id)) assertions.push({ id, kind: 'declared-contract-gate', satisfied: baseSatisfied })
  const satisfied = assertions.every(item => item.satisfied)
  return { status: satisfied ? 'satisfied' : 'failed', oracleId: descriptor.id, evidenceOrigin: evidence.origin,
    scenarioExecuted: evidence.origin === 'real-model', scenarioPassed: evidence.origin === 'real-model' ? satisfied : null, assertions }
}
