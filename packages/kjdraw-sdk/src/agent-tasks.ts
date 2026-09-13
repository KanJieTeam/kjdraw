import { KJValidationError } from './errors.js'
import { canonicalStringify, clone, deepFreeze, normalizeName, stableHash } from './utils.js'
import type { KJDocument } from './document.js'
import type { KJTransaction } from './transaction.js'
import type { KJObjectRecord, KJReadonlyObjectRecord } from './schema.js'
import type { ReadonlyDeep } from './utils.js'
import { validateDrawingGeometryTransaction, type KJDrawingValidationCheck, type KJDrawingValidationCheckResult } from './drawing-validation.js'
import { KJDRAW_AGENT_CAPABILITY_TOOL_API_VERSION } from './agent-capabilities.js'

export const KJ_AGENT_TASK_TYPE = 'AI_TASK' as const
export const KJ_AGENT_TASK_CONTRACT_VERSION = 1 as const
/** Exact persisted tool-contract version understood by atomic task approval. */
export const KJDRAW_AGENT_TASK_TOOL_API_VERSION = String(KJDRAW_AGENT_CAPABILITY_TOOL_API_VERSION)

export type KJAgentTaskStatus =
  | 'draft' | 'ready' | 'running' | 'awaiting_approval' | 'needs_attention'
  | 'stale' | 'completed' | 'failed' | 'cancelled'

export interface KJAgentTaskActor { kind: 'host' | 'agent' | 'system'; id: string }
export interface KJAgentTaskResolution { code: string; message: string; retryable: boolean }
export interface KJAgentTaskAssertion { path: string; operator: 'equals' | 'at_least' | 'at_most' | 'is_true'; expected: string | number | boolean | null }
export interface KJAgentTaskRequirement { id: string; description: string; check: { toolName: string; assertion: KJAgentTaskAssertion; geometryCheck?: KJDrawingValidationCheck } }
export interface KJAgentTaskStep { id: string; title: string; requirementIds: string[] }
export interface KJAgentTaskToolBinding { apiVersion: string; names: string[]; contractHash: string }
export interface KJAgentTaskCapabilityLock { id: string; version: string; contentHash: string }
export interface KJAgentTaskDefinition { requirements: KJAgentTaskRequirement[]; steps: KJAgentTaskStep[]; tools: KJAgentTaskToolBinding; capabilities: KJAgentTaskCapabilityLock[] }
export type KJAgentTaskStepStatus = 'pending' | 'active' | 'passed' | 'failed' | 'skipped'
export interface KJAgentTaskCheckSummary { requirementId: string; passed: boolean; summary: string; receiptId?: string }
export interface KJAgentTaskStepProgress { id: string; status: KJAgentTaskStepStatus; checks: KJAgentTaskCheckSummary[] }
export interface KJAgentTaskScopeMember { id: string; handle: string; sha256: string }
export interface KJAgentTaskScope { members: KJAgentTaskScopeMember[]; relations: KJAgentTaskScopeMember[]; sha256: string }
export interface KJAgentTaskGeometryReceipt {
  schema: 'com.kanjie.kjdraw.agent-task-geometry-receipt'
  schemaVersion: 1
  receiptId: string
  taskId: string
  taskVersion: number
  planId: string
  executionEnvelopeId: string
  reviewerId: string
  command: 'CREATEBATCH' | 'MOVE' | 'ROTATE' | 'SCALE' | 'LENGTHEN' | 'STRETCH' | 'PEDIT'
  sourceToolName: string
  beforeRevision: number
  afterRevision: number
  at: string
  units: string
  toolContractHash: string
  argumentsDigest: string
  scopeSha256: string
  checks: KJDrawingValidationCheckResult[]
  receiptDigest: string
}
export interface KJAgentTaskEvent {
  version: number
  from: KJAgentTaskStatus | null
  to: KJAgentTaskStatus
  at: string
  documentRevision: number
  actor: KJAgentTaskActor
  reason: string
}
export interface KJAgentTaskPayload extends Record<string, unknown> {
  contractVersion: typeof KJ_AGENT_TASK_CONTRACT_VERSION
  taskId: string
  documentId: string
  title: string
  goal: string
  units: string
  status: KJAgentTaskStatus
  taskVersion: number
  createdAt: string
  updatedAt: string
  createdRevision: number
  observedRevision: number
  updatedRevision: number
  scope: KJAgentTaskScope
  definition: KJAgentTaskDefinition
  progress: { steps: KJAgentTaskStepProgress[] }
  receipts: KJAgentTaskGeometryReceipt[]
  resolution: KJAgentTaskResolution | null
  eventOffset: number
  events: KJAgentTaskEvent[]
}
export interface KJAgentTaskCreateInput {
  id: string
  expectedRevision: number
  title: string
  goal: string
  entityIds: string[]
  definition: KJAgentTaskDefinition
  at: string
  actor: KJAgentTaskActor
}
export interface KJAgentTaskTransitionInput {
  id: string
  expectedRevision: number
  expectedTaskVersion: number
  expectedStatus: KJAgentTaskStatus
  to: KJAgentTaskStatus
  at: string
  actor: KJAgentTaskActor
  reason: string
  resolution?: KJAgentTaskResolution
  stepUpdates?: KJAgentTaskStepProgress[]
}
export interface KJAgentTaskRebaseInput {
  id: string
  expectedRevision: number
  expectedTaskVersion: number
  expectedStatus: 'stale' | 'awaiting_approval'
  at: string
  actor: KJAgentTaskActor
  reason: string
}
export interface KJAgentTaskCreateBatchApprovalInput {
  id: string
  expectedRevision: number
  expectedTaskVersion: number
  expectedStatus: 'running'
  expectedScopeSha256: string
  sourceToolName: string
  toolApiVersion: string
  toolContractHash: string
  argumentsDigest: string
  capabilityLocks: KJAgentTaskCapabilityLock[]
  planId: string
  executionEnvelopeId: string
  reviewerId: string
  createdEntityIds: string[]
  at: string
}
export interface KJAgentTaskCreateBatchApprovalResult { task: KJObjectRecord; receipt: KJAgentTaskGeometryReceipt }
export interface KJAgentTaskMoveApprovalInput {
  id: string
  expectedRevision: number
  expectedTaskVersion: number
  expectedStatus: 'running'
  expectedScopeSha256: string
  sourceToolName: string
  toolApiVersion: string
  toolContractHash: string
  argumentsDigest: string
  capabilityLocks: KJAgentTaskCapabilityLock[]
  planId: string
  executionEnvelopeId: string
  reviewerId: string
  movedEntityIds: string[]
  at: string
}
export interface KJAgentTaskMoveApprovalResult { task: KJObjectRecord; receipt: KJAgentTaskGeometryReceipt }
export interface KJAgentTaskRotateApprovalInput {
  id: string
  expectedRevision: number
  expectedTaskVersion: number
  expectedStatus: 'running'
  expectedScopeSha256: string
  sourceToolName: string
  toolApiVersion: string
  toolContractHash: string
  argumentsDigest: string
  capabilityLocks: KJAgentTaskCapabilityLock[]
  planId: string
  executionEnvelopeId: string
  reviewerId: string
  rotatedEntityIds: string[]
  at: string
}
export interface KJAgentTaskRotateApprovalResult { task: KJObjectRecord; receipt: KJAgentTaskGeometryReceipt }
export interface KJAgentTaskScaleApprovalInput {
  id: string
  expectedRevision: number
  expectedTaskVersion: number
  expectedStatus: 'running'
  expectedScopeSha256: string
  sourceToolName: string
  toolApiVersion: string
  toolContractHash: string
  argumentsDigest: string
  capabilityLocks: KJAgentTaskCapabilityLock[]
  planId: string
  executionEnvelopeId: string
  reviewerId: string
  scaledEntityIds: string[]
  at: string
}
export interface KJAgentTaskScaleApprovalResult { task: KJObjectRecord; receipt: KJAgentTaskGeometryReceipt }
export interface KJAgentTaskLengthenApprovalInput {
  id: string
  expectedRevision: number
  expectedTaskVersion: number
  expectedStatus: 'running'
  expectedScopeSha256: string
  sourceToolName: string
  toolApiVersion: string
  toolContractHash: string
  argumentsDigest: string
  capabilityLocks: KJAgentTaskCapabilityLock[]
  planId: string
  executionEnvelopeId: string
  reviewerId: string
  lengthenedEntityIds: string[]
  at: string
}
export interface KJAgentTaskLengthenApprovalResult { task: KJObjectRecord; receipt: KJAgentTaskGeometryReceipt }
export interface KJAgentTaskStretchApprovalInput {
  id: string
  expectedRevision: number
  expectedTaskVersion: number
  expectedStatus: 'running'
  expectedScopeSha256: string
  sourceToolName: string
  toolApiVersion: string
  toolContractHash: string
  argumentsDigest: string
  capabilityLocks: KJAgentTaskCapabilityLock[]
  planId: string
  executionEnvelopeId: string
  reviewerId: string
  stretchedEntityIds: string[]
  at: string
}
export interface KJAgentTaskStretchApprovalResult { task: KJObjectRecord; receipt: KJAgentTaskGeometryReceipt }
export interface KJAgentTaskPolylineEditApprovalInput {
  id: string
  expectedRevision: number
  expectedTaskVersion: number
  expectedStatus: 'running'
  expectedScopeSha256: string
  sourceToolName: string
  toolApiVersion: string
  toolContractHash: string
  argumentsDigest: string
  capabilityLocks: KJAgentTaskCapabilityLock[]
  planId: string
  executionEnvelopeId: string
  reviewerId: string
  editedEntityIds: string[]
  at: string
}
export interface KJAgentTaskPolylineEditApprovalResult { task: KJObjectRecord; receipt: KJAgentTaskGeometryReceipt }
export interface KJAgentTaskView extends KJAgentTaskPayload { id: string; handle: string }
export interface KJAgentTaskInspection {
  task: KJAgentTaskView
  scopeMatches: boolean
  unitsMatch: boolean
  driftedEntityIds: string[]
  recovery: 'rebase-required' | 'replan-after-drift' | 'review-approval-outcome' | 'repropose-after-reopen' | null
}

const MAX_SCOPE_ENTITIES = 512
const MAX_SCOPE_BYTES = 4 * 1024 * 1024
const MAX_RECORD_BYTES = 256 * 1024
const MAX_EVENTS = 128
const SHA256 = /^[0-9a-f]{64}$/
const CONTENT_HASH = /^(?:[0-9a-f]{16}|[0-9a-f]{64})$/
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const CODE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/
const STATUSES: readonly KJAgentTaskStatus[] = ['draft', 'ready', 'running', 'awaiting_approval', 'needs_attention', 'stale', 'completed', 'failed', 'cancelled']
const TERMINAL = new Set<KJAgentTaskStatus>(['completed', 'failed', 'cancelled'])
const TRANSITIONS: Readonly<Record<KJAgentTaskStatus, readonly KJAgentTaskStatus[]>> = Object.freeze({
  draft: ['ready', 'cancelled', 'stale'],
  ready: ['running', 'cancelled', 'stale'],
  running: ['running', 'awaiting_approval', 'needs_attention', 'completed', 'failed', 'cancelled', 'stale'],
  awaiting_approval: ['running', 'needs_attention', 'completed', 'failed', 'cancelled', 'stale'],
  needs_attention: ['running', 'failed', 'cancelled', 'stale'],
  stale: [],
  completed: [], failed: [], cancelled: [],
})
const PAYLOAD_FIELDS = ['contractVersion', 'taskId', 'documentId', 'title', 'goal', 'units', 'status', 'taskVersion', 'createdAt', 'updatedAt', 'createdRevision', 'observedRevision', 'updatedRevision', 'scope', 'definition', 'progress', 'resolution', 'eventOffset', 'events']
const PAYLOAD_FIELDS_WITH_RECEIPTS = [...PAYLOAD_FIELDS, 'receipts']
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function fail(message: string): never { throw new KJValidationError(`AI task: ${message}`) }
function plain(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`)
  if (Object.getOwnPropertySymbols(value).length) fail(`${label} cannot contain symbol fields`)
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Object.keys(descriptors)
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key) || UNSAFE_KEYS.has(key))) fail(`${label} has unexpected or missing fields`)
  if (keys.some(key => !descriptors[key]!.enumerable || !Object.hasOwn(descriptors[key]!, 'value'))) fail(`${label} cannot contain accessors or hidden fields`)
  return value as Record<string, unknown>
}
function optionalPlain(value: unknown, fields: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`)
  if (Object.getOwnPropertySymbols(value).length) fail(`${label} cannot contain symbol fields`)
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Object.keys(descriptors)
  if (keys.some(key => !fields.includes(key) || UNSAFE_KEYS.has(key)) || required.some(key => !keys.includes(key))) fail(`${label} has unexpected or missing fields`)
  if (keys.some(key => !descriptors[key]!.enumerable || !Object.hasOwn(descriptors[key]!, 'value'))) fail(`${label} cannot contain accessors or hidden fields`)
  return value as Record<string, unknown>
}
function array(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum || Object.getOwnPropertySymbols(value).length) fail(`${label} must contain ${minimum}–${maximum} items`)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)]
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${label} cannot be sparse or contain accessors`)
  }
  if (Object.keys(descriptors).some(key => key !== 'length' && (!/^\d+$/.test(key) || Number(key) >= value.length))) fail(`${label} has unexpected fields`)
  return value
}
function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(`${label} must be a safe integer of at least ${minimum}`)
  return Number(value)
}
function text(value: unknown, label: string, maximum: number, nonempty = true): string {
  if (typeof value !== 'string' || value.length > maximum || (nonempty && !value.trim())) fail(`${label} must be ${nonempty ? 'a non-empty ' : ''}string of at most ${maximum} characters`)
  return value
}
function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 32)
  const parsed = Date.parse(result)
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(result) || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) fail(`${label} must be an exact UTC ISO timestamp`)
  return result
}
function taskStatus(value: unknown, label = 'status'): KJAgentTaskStatus {
  if (!STATUSES.includes(value as KJAgentTaskStatus)) fail(`${label} is invalid`)
  return value as KJAgentTaskStatus
}
function actor(value: unknown): KJAgentTaskActor {
  const row = plain(value, ['kind', 'id'], 'actor')
  if (!['host', 'agent', 'system'].includes(String(row.kind))) fail('actor kind is invalid')
  return { kind: row.kind as KJAgentTaskActor['kind'], id: text(row.id, 'actor id', 128) }
}
function resolution(value: unknown): KJAgentTaskResolution {
  const row = plain(value, ['code', 'message', 'retryable'], 'resolution')
  if (typeof row.code !== 'string' || !CODE.test(row.code)) fail('resolution code is invalid')
  if (typeof row.retryable !== 'boolean') fail('resolution retryable must be boolean')
  return { code: row.code, message: text(row.message, 'resolution message', 2048), retryable: row.retryable }
}
function identifier(value: unknown, label: string): string {
  const result = text(value, label, 128)
  if (!CODE.test(result) || UNSAFE_KEYS.has(result.toLowerCase())) fail(`${label} is invalid`)
  return result
}
function assertion(value: unknown): KJAgentTaskAssertion {
  const row = plain(value, ['path', 'operator', 'expected'], 'assertion')
  const path = text(row.path, 'assertion path', 256)
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+){0,15}$/.test(path) || path.split('.').some(part => UNSAFE_KEYS.has(part.toLowerCase()))) fail('assertion path is invalid')
  if (!['equals', 'at_least', 'at_most', 'is_true'].includes(String(row.operator))) fail('assertion operator is invalid')
  const expected = row.expected
  if (!(expected === null || typeof expected === 'string' && expected.length <= 512 || typeof expected === 'boolean' || typeof expected === 'number' && Number.isFinite(expected) && Math.abs(expected) <= 1e12)) fail('assertion expected value is invalid')
  if (row.operator === 'is_true' && expected !== true || ['at_least', 'at_most'].includes(String(row.operator)) && typeof expected !== 'number') fail('assertion operator and expected value do not match')
  return { path, operator: row.operator as KJAgentTaskAssertion['operator'], expected }
}
function geometryReference(value: unknown): { objectId: string; feature: 'start' | 'end' | 'center' | 'origin' | 'vertex'; vertexIndex?: number } {
  const row = optionalPlain(value, ['objectId', 'feature', 'vertexIndex'], ['objectId', 'feature'], 'geometry point reference')
  const objectId = text(row.objectId, 'geometry object ID', 256)
  if (!['start', 'end', 'center', 'origin', 'vertex'].includes(String(row.feature))) fail('geometry point feature is invalid')
  if (row.feature === 'vertex') return { objectId, feature: 'vertex', vertexIndex: integer(row.vertexIndex, 'geometry vertex index') }
  if (row.vertexIndex !== undefined) fail('geometry vertexIndex is valid only with feature vertex')
  return { objectId, feature: row.feature as 'start' | 'end' | 'center' | 'origin' }
}
function geometryNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12) fail(`${label} must be between 0 and 1e12`)
  return value
}
function geometryCheck(value: unknown, requirementId: string): KJDrawingValidationCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('geometry check must be a plain object')
  const kind = String((value as Record<string, unknown>).kind)
  const fields = kind === 'point-distance' ? ['id', 'kind', 'from', 'to', 'expected', 'tolerance'] : kind === 'polyline-segment-bulge' ? ['id', 'kind', 'objectId', 'segmentIndex', 'expected', 'tolerance'] : ['id', 'kind', 'objectId', 'expected', 'tolerance']
  const row = plain(value, fields, 'geometry check')
  if (identifier(row.id, 'geometry check id') !== requirementId) fail('geometry check ID must equal its requirement ID')
  const tolerance = geometryNumber(row.tolerance, 'geometry tolerance')
  if (kind === 'point-distance') return { id: requirementId, kind, from: geometryReference(row.from), to: geometryReference(row.to), expected: geometryNumber(row.expected, 'geometry expected value'), tolerance }
  const objectId = text(row.objectId, 'geometry object ID', 256)
  if (['line-length', 'circle-radius', 'ellipse-major-radius', 'ellipse-minor-radius', 'spline-length', 'dimension-measurement'].includes(kind)) return { id: requirementId, kind: kind as 'line-length' | 'circle-radius' | 'ellipse-major-radius' | 'ellipse-minor-radius' | 'spline-length' | 'dimension-measurement', objectId, expected: geometryNumber(row.expected, 'geometry expected value'), tolerance }
  if (kind === 'polyline-closed') {
    if (typeof row.expected !== 'boolean' || tolerance !== 0) fail('polyline closure requires a boolean expected value and zero tolerance')
    return { id: requirementId, kind, objectId, expected: row.expected, tolerance: 0 }
  }
  if (kind === 'polyline-vertex-count') {
    const expected = integer(row.expected, 'polyline expected vertex count', 2)
    if (tolerance !== 0) fail('polyline vertex count requires zero tolerance')
    return { id: requirementId, kind, objectId, expected, tolerance: 0 }
  }
  if (kind === 'polyline-segment-bulge') {
    if (typeof row.expected !== 'number' || !Number.isFinite(row.expected) || Math.abs(row.expected) > 32) fail('polyline expected bulge must be finite within ±32')
    return { id: requirementId, kind, objectId, segmentIndex: integer(row.segmentIndex, 'polyline segment index'), expected: row.expected, tolerance }
  }
  return fail('geometry check kind is invalid')
}
function taskDefinition(value: unknown): KJAgentTaskDefinition {
  const row = plain(value, ['requirements', 'steps', 'tools', 'capabilities'], 'task definition')
  const requirementIds = new Set<string>()
  const requirements = array(row.requirements, 'requirements', 1, 64).map(item => {
    const requirement = plain(item, ['id', 'description', 'check'], 'requirement'), id = identifier(requirement.id, 'requirement id')
    if (requirementIds.has(id)) fail('requirement IDs must be unique')
    requirementIds.add(id)
    const check = optionalPlain(requirement.check, ['toolName', 'assertion', 'geometryCheck'], ['toolName', 'assertion'], 'requirement check')
    const parsed = { toolName: identifier(check.toolName, 'check tool name'), assertion: assertion(check.assertion), ...(check.geometryCheck === undefined ? {} : { geometryCheck: geometryCheck(check.geometryCheck, id) }) }
    return { id, description: text(requirement.description, 'requirement description', 1024), check: parsed }
  })
  const stepIds = new Set<string>()
  const steps = array(row.steps, 'steps', 1, 64).map(item => {
    const step = plain(item, ['id', 'title', 'requirementIds'], 'step'), id = identifier(step.id, 'step id')
    if (stepIds.has(id)) fail('step IDs must be unique')
    stepIds.add(id)
    const ids = array(step.requirementIds, 'step requirement IDs', 1, 64).map(value => identifier(value, 'step requirement id'))
    if (new Set(ids).size !== ids.length || ids.some(value => !requirementIds.has(value))) fail('step requirement IDs must be unique existing requirements')
    return { id, title: text(step.title, 'step title', 512), requirementIds: ids }
  })
  const covered = new Set(steps.flatMap(step => step.requirementIds))
  if (requirements.some(requirement => !covered.has(requirement.id))) fail('every requirement must belong to a step')
  const toolsRow = plain(row.tools, ['apiVersion', 'names', 'contractHash'], 'tool binding')
  const names = array(toolsRow.names, 'tool names', 1, 64).map(value => identifier(value, 'tool name'))
  if (new Set(names).size !== names.length || typeof toolsRow.contractHash !== 'string' || !CONTENT_HASH.test(toolsRow.contractHash)) fail('tool binding names or contract hash are invalid')
  const tools = { apiVersion: text(toolsRow.apiVersion, 'tool API version', 64), names, contractHash: toolsRow.contractHash }
  const capabilityIds = new Set<string>()
  if (requirements.some(requirement => !names.includes(requirement.check.toolName))) fail('every requirement check tool must be locked by the task')
  const capabilities = array(row.capabilities, 'capability locks', 0, 32).map(item => {
    const capability = plain(item, ['id', 'version', 'contentHash'], 'capability lock'), id = identifier(capability.id, 'capability id')
    if (capabilityIds.has(id) || typeof capability.contentHash !== 'string' || !CONTENT_HASH.test(capability.contentHash)) fail('capability lock ID or hash is invalid')
    capabilityIds.add(id)
    return { id, version: text(capability.version, 'capability version', 64), contentHash: capability.contentHash }
  })
  return { requirements, steps, tools, capabilities }
}
function stepProgress(value: unknown, definition: KJAgentTaskDefinition): KJAgentTaskStepProgress {
  const row = plain(value, ['id', 'status', 'checks'], 'step progress'), id = identifier(row.id, 'step progress id')
  const step = definition.steps.find(item => item.id === id)
  if (!step || !['pending', 'active', 'passed', 'failed', 'skipped'].includes(String(row.status))) fail('step progress ID or status is invalid')
  const checks = array(row.checks, 'check summaries', 0, step.requirementIds.length).map(item => {
    const check = optionalPlain(item, ['requirementId', 'passed', 'summary', 'receiptId'], ['requirementId', 'passed', 'summary'], 'check summary'), requirementId = identifier(check.requirementId, 'check requirement id')
    if (!step.requirementIds.includes(requirementId) || typeof check.passed !== 'boolean') fail('check summary requirement or result is invalid')
    return { requirementId, passed: check.passed, summary: text(check.summary, 'check summary', 512, false), ...(check.receiptId === undefined ? {} : { receiptId: identifier(check.receiptId, 'check receipt id') }) }
  })
  if (new Set(checks.map(check => check.requirementId)).size !== checks.length) fail('check summaries must have unique requirement IDs')
  if (row.status === 'passed' && (checks.length !== step.requirementIds.length || checks.some(check => !check.passed))) fail('passed step requires every assigned check to pass')
  return { id, status: row.status as KJAgentTaskStepStatus, checks }
}
function progress(value: unknown, definition: KJAgentTaskDefinition): { steps: KJAgentTaskStepProgress[] } {
  const row = plain(value, ['steps'], 'task progress')
  const steps = array(row.steps, 'step progress', definition.steps.length, definition.steps.length).map(item => stepProgress(item, definition))
  if (new Set(steps.map(step => step.id)).size !== steps.length || definition.steps.some(step => !steps.some(item => item.id === step.id))) fail('progress must cover every task step exactly once')
  return { steps }
}
function receiptCheck(value: unknown): KJDrawingValidationCheckResult {
  const row = plain(value, ['id', 'kind', 'actual', 'expected', 'error', 'tolerance', 'passed', 'references'], 'receipt geometry check')
  const id = identifier(row.id, 'receipt check id'), kind = String(row.kind)
  if (!['line-length', 'circle-radius', 'ellipse-major-radius', 'ellipse-minor-radius', 'spline-length', 'dimension-measurement', 'point-distance', 'polyline-closed', 'polyline-vertex-count', 'polyline-segment-bulge'].includes(kind)) fail('receipt geometry check kind is invalid')
  if (typeof row.passed !== 'boolean') fail('receipt geometry check result is invalid')
  const actual = row.actual, expected = row.expected
  if (!(typeof actual === 'boolean' || typeof actual === 'number' && Number.isFinite(actual)) || !(typeof expected === 'boolean' || typeof expected === 'number' && Number.isFinite(expected))) fail('receipt geometry values are invalid')
  const error = geometryNumber(row.error, 'receipt geometry error'), tolerance = geometryNumber(row.tolerance, 'receipt geometry tolerance')
  const references = array(row.references, 'receipt geometry references', 1, 2).map(item => {
    const ref = optionalPlain(item, ['objectId', 'ownerId', 'feature', 'vertexIndex', 'segmentIndex'], ['objectId', 'ownerId'], 'receipt geometry reference')
    const feature = ref.feature
    if (feature !== undefined && !['start', 'end', 'center', 'origin', 'vertex'].includes(String(feature))) fail('receipt geometry feature is invalid')
    if (feature === 'vertex' && ref.vertexIndex === undefined || feature !== 'vertex' && ref.vertexIndex !== undefined) fail('receipt geometry vertex reference is invalid')
    if (kind === 'polyline-segment-bulge' ? ref.segmentIndex === undefined : ref.segmentIndex !== undefined) fail('receipt geometry segment reference is invalid')
    return {
      objectId: text(ref.objectId, 'receipt object ID', 256), ownerId: text(ref.ownerId, 'receipt owner ID', 256),
      ...(feature === undefined ? {} : { feature: feature as 'start' | 'end' | 'center' | 'origin' | 'vertex' }),
      ...(ref.vertexIndex === undefined ? {} : { vertexIndex: integer(ref.vertexIndex, 'receipt vertex index') }),
      ...(ref.segmentIndex === undefined ? {} : { segmentIndex: integer(ref.segmentIndex, 'receipt segment index') }),
    }
  })
  const computedError = typeof actual === 'boolean' && typeof expected === 'boolean' ? actual === expected ? 0 : 1
    : typeof actual === 'number' && typeof expected === 'number' ? Math.abs(actual - expected) : NaN
  if (!Number.isFinite(computedError) || error !== computedError || row.passed !== (error <= tolerance)) fail('receipt geometry evidence is internally inconsistent')
  if (kind === 'point-distance' ? references.length !== 2 || references.some(reference => !reference.feature) : references.length !== 1 || references.some(reference => reference.feature)) fail('receipt geometry references do not match the check kind')
  if (kind === 'polyline-closed' && (typeof actual !== 'boolean' || typeof expected !== 'boolean' || tolerance !== 0) || kind !== 'polyline-closed' && (typeof actual !== 'number' || typeof expected !== 'number') || kind === 'polyline-vertex-count' && (!Number.isSafeInteger(actual) || !Number.isSafeInteger(expected) || tolerance !== 0)) fail('receipt geometry value types do not match the check kind')
  return { id, kind: kind as KJDrawingValidationCheck['kind'], actual, expected, error, tolerance, passed: row.passed, references }
}
function geometryReceipt(value: unknown): KJAgentTaskGeometryReceipt {
  const row = plain(value, ['schema', 'schemaVersion', 'receiptId', 'taskId', 'taskVersion', 'planId', 'executionEnvelopeId', 'reviewerId', 'command', 'sourceToolName', 'beforeRevision', 'afterRevision', 'at', 'units', 'toolContractHash', 'argumentsDigest', 'scopeSha256', 'checks', 'receiptDigest'], 'geometry receipt')
  if (row.schema !== 'com.kanjie.kjdraw.agent-task-geometry-receipt' || row.schemaVersion !== 1 || !['CREATEBATCH', 'MOVE', 'ROTATE', 'SCALE', 'LENGTHEN', 'STRETCH', 'PEDIT'].includes(String(row.command))) fail('geometry receipt contract is invalid')
  if (typeof row.toolContractHash !== 'string' || !CONTENT_HASH.test(row.toolContractHash) || typeof row.argumentsDigest !== 'string' || !CONTENT_HASH.test(row.argumentsDigest) || typeof row.scopeSha256 !== 'string' || !SHA256.test(row.scopeSha256) || typeof row.receiptDigest !== 'string' || !CONTENT_HASH.test(row.receiptDigest)) fail('geometry receipt hashes are invalid')
  const checks = array(row.checks, 'receipt checks', 1, 64).map(receiptCheck)
  if (new Set(checks.map(check => check.id)).size !== checks.length || checks.some(check => !check.passed)) fail('geometry receipt requires unique passing checks')
  const result: KJAgentTaskGeometryReceipt = {
    schema: row.schema, schemaVersion: 1, receiptId: identifier(row.receiptId, 'receipt id'), taskId: text(row.taskId, 'receipt task id', 128), taskVersion: integer(row.taskVersion, 'receipt task version', 1),
    planId: text(row.planId, 'receipt plan id', 256), executionEnvelopeId: text(row.executionEnvelopeId, 'receipt execution envelope id', 256), reviewerId: text(row.reviewerId, 'receipt reviewer id', 256), command: row.command as 'CREATEBATCH' | 'MOVE' | 'ROTATE' | 'SCALE' | 'LENGTHEN' | 'STRETCH' | 'PEDIT', sourceToolName: identifier(row.sourceToolName, 'receipt source tool'),
    beforeRevision: integer(row.beforeRevision, 'receipt before revision'), afterRevision: integer(row.afterRevision, 'receipt after revision', 1), at: timestamp(row.at, 'receipt timestamp'), units: text(row.units, 'receipt units', 64), toolContractHash: row.toolContractHash, argumentsDigest: row.argumentsDigest, scopeSha256: row.scopeSha256, checks, receiptDigest: row.receiptDigest,
  }
  if (result.command === 'MOVE' && result.sourceToolName !== 'cad_propose_move') fail('MOVE receipt source tool is invalid')
  if (result.command === 'ROTATE' && result.sourceToolName !== 'cad_propose_rotate') fail('ROTATE receipt source tool is invalid')
  if (result.command === 'SCALE' && result.sourceToolName !== 'cad_propose_scale') fail('SCALE receipt source tool is invalid')
  if (result.command === 'LENGTHEN' && result.sourceToolName !== 'cad_propose_lengthen') fail('LENGTHEN receipt source tool is invalid')
  if (result.command === 'STRETCH' && result.sourceToolName !== 'cad_propose_stretch') fail('STRETCH receipt source tool is invalid')
  if (result.command === 'PEDIT' && result.sourceToolName !== 'cad_propose_polyline_edit') fail('PEDIT receipt source tool is invalid')
  if (result.afterRevision !== result.beforeRevision + 1) fail('geometry receipt must bind one atomic document revision')
  const { receiptId: _receiptId, receiptDigest: _receiptDigest, ...digestInput } = result
  if (result.receiptId !== `receipt:${result.receiptDigest}` || stableHash(digestInput) !== result.receiptDigest) fail('geometry receipt digest is invalid')
  return result
}
function key(id: string): string { return normalizeName(`KJDRAW_AI_TASK:${id}`) }
function validTaskId(value: string): boolean { return TASK_ID.test(value) && !UNSAFE_KEYS.has(normalizeName(value).toLowerCase()) }
function jsonBytes(value: unknown): number { return new TextEncoder().encode(canonicalStringify(value) ?? '').length }
async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) fail('SHA-256 requires the Web Crypto API')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function scopeFrom(get: (id: string) => KJReadonlyObjectRecord | KJObjectRecord | null, objects: readonly (KJReadonlyObjectRecord | KJObjectRecord)[], inputIds: readonly string[]): Promise<KJAgentTaskScope> {
  const ids = array(inputIds, 'scope', 0, MAX_SCOPE_ENTITIES) as string[]
  if (ids.some(id => typeof id !== 'string' || !id || id.length > 256) || new Set(ids).size !== ids.length) fail(`scope requires 0–${MAX_SCOPE_ENTITIES} unique entity IDs`)
  const members: KJAgentTaskScopeMember[] = []
  let bytes = 0
  for (const id of ids) {
    const entity = get(id)
    if (!entity || entity.erased || entity.kind !== 'entity') fail(`scope entity is missing or erased: ${id}`)
    const canonical = canonicalStringify(entity)
    if (canonical === undefined) fail(`scope entity cannot be canonicalized: ${id}`)
    bytes += new TextEncoder().encode(canonical).length
    if (bytes > MAX_SCOPE_BYTES) fail('scope entity snapshots exceed the 4 MiB budget')
    members.push({ id, handle: entity.handle, sha256: await sha256(canonical) })
  }
  const selected = new Set(ids), relations: KJAgentTaskScopeMember[] = []
  for (const record of objects) {
    if (record.erased || record.kind !== 'custom' || record.type !== 'DESIGN_RELATIONS') continue
    const bindings = (record.payload.definition as { bindings?: unknown } | null)?.bindings
    if (!Array.isArray(bindings) || !bindings.some(binding => binding && typeof binding === 'object' && selected.has(String((binding as { entityId?: unknown }).entityId)))) continue
    const canonical = canonicalStringify(record)
    if (canonical === undefined) fail(`design relation cannot be canonicalized: ${record.id}`)
    bytes += new TextEncoder().encode(canonical).length
    if (bytes > MAX_SCOPE_BYTES) fail('scope entity snapshots exceed the 4 MiB budget')
    relations.push({ id: record.id, handle: record.handle, sha256: await sha256(canonical) })
  }
  relations.sort((left, right) => left.id.localeCompare(right.id))
  return { members, relations, sha256: await sha256(canonicalStringify({ members, relations })!) }
}
function scope(value: unknown): KJAgentTaskScope {
  const row = plain(value, ['members', 'relations', 'sha256'], 'scope')
  const parseMembers = (input: unknown, label: string, minimum: number, maximum: number) => array(input, label, minimum, maximum).map(item => {
    const member = plain(item, ['id', 'handle', 'sha256'], 'scope member')
    const id = text(member.id, 'scope entity id', 256)
    const handle = text(member.handle, 'scope entity handle', 64)
    if (!/^[0-9A-F]+$/.test(handle) || typeof member.sha256 !== 'string' || !SHA256.test(member.sha256)) fail('scope member handle or digest is invalid')
    return { id, handle, sha256: member.sha256 }
  })
  const members = parseMembers(row.members, 'scope members', 0, MAX_SCOPE_ENTITIES)
  const relations = parseMembers(row.relations, 'scope relations', 0, MAX_SCOPE_ENTITIES)
  if (new Set(members.map(member => member.id)).size !== members.length || new Set(relations.map(member => member.id)).size !== relations.length || typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) fail('scope IDs or digest are invalid')
  return { members, relations, sha256: row.sha256 }
}
function event(value: unknown): KJAgentTaskEvent {
  const row = plain(value, ['version', 'from', 'to', 'at', 'documentRevision', 'actor', 'reason'], 'event')
  const from = row.from === null ? null : taskStatus(row.from, 'event from status')
  return { version: integer(row.version, 'event version', 1), from, to: taskStatus(row.to, 'event to status'), at: timestamp(row.at, 'event timestamp'), documentRevision: integer(row.documentRevision, 'event document revision'), actor: actor(row.actor), reason: text(row.reason, 'event reason', 2048) }
}
function payload(value: unknown, currentRevision: number): KJAgentTaskPayload {
  const row = optionalPlain(value, PAYLOAD_FIELDS_WITH_RECEIPTS, PAYLOAD_FIELDS, 'task payload')
  if (row.contractVersion !== KJ_AGENT_TASK_CONTRACT_VERSION) fail('unsupported contract version')
  const taskId = text(row.taskId, 'task id', 128)
  if (!validTaskId(taskId)) fail('task id is invalid')
  const status = taskStatus(row.status), taskVersion = integer(row.taskVersion, 'task version', 1)
  const createdRevision = integer(row.createdRevision, 'created revision', 1), observedRevision = integer(row.observedRevision, 'observed revision'), updatedRevision = integer(row.updatedRevision, 'updated revision', 1)
  if (createdRevision > updatedRevision || observedRevision > updatedRevision || updatedRevision > currentRevision) fail('task revision binding is invalid')
  const createdAt = timestamp(row.createdAt, 'created timestamp'), updatedAt = timestamp(row.updatedAt, 'updated timestamp')
  if (Date.parse(updatedAt) < Date.parse(createdAt)) fail('task timestamps are out of order')
  const events = array(row.events, 'task events', 1, MAX_EVENTS).map(event), eventOffset = integer(row.eventOffset, 'event offset')
  for (let index = 0; index < events.length; index++) {
    const item = events[index]!, expectedVersion = eventOffset + index + 1
    if (item.version !== expectedVersion || index > 0 && item.from !== events[index - 1]!.to) fail('task event chain is invalid')
  }
  const last = events.at(-1)!
  if (last.version !== taskVersion || last.to !== status || last.documentRevision !== updatedRevision || last.at !== updatedAt) fail('task state does not match its latest event')
  const resolved = row.resolution === null ? null : resolution(row.resolution)
  if (['completed', 'failed', 'needs_attention'].includes(status) !== Boolean(resolved)) fail('task resolution does not match its status')
  const definition = taskDefinition(row.definition), taskProgress = progress(row.progress, definition)
  const receipts = row.receipts === undefined ? [] : array(row.receipts, 'geometry receipts', 0, 16).map(geometryReceipt)
  if (new Set(receipts.map(receipt => receipt.receiptId)).size !== receipts.length || receipts.some(receipt => receipt.taskId !== taskId || receipt.taskVersion > taskVersion || receipt.afterRevision > currentRevision || !definition.tools.names.includes(receipt.sourceToolName))) fail('geometry receipt binding is invalid')
  const parsedScope = scope(row.scope), units = text(row.units, 'units', 64)
  const completionReceipt = receipts.find(receipt => receipt.taskVersion === taskVersion && receipt.afterRevision === updatedRevision && receipt.at === updatedAt && receipt.units === units && receipt.scopeSha256 === parsedScope.sha256 && receipt.toolContractHash === definition.tools.contractHash)
  if (observedRevision === updatedRevision && !(status === 'completed' && completionReceipt)) fail('same-revision observation requires the current atomic completion receipt')
  if (status === 'completed' && (!completionReceipt || taskProgress.steps.some(step => step.status !== 'passed') || definition.requirements.some(requirement => !taskProgress.steps.some(step => step.checks.some(check => check.requirementId === requirement.id && check.passed && check.receiptId === completionReceipt.receiptId && completionReceipt.checks.some(result => result.id === requirement.id && result.passed)))))) fail('completed task requires all steps and requirements to have the current trusted passing receipt')
  const result: KJAgentTaskPayload = { contractVersion: 1, taskId, documentId: text(row.documentId, 'document id', 256), title: text(row.title, 'title', 256), goal: text(row.goal, 'goal', 8192), units, status, taskVersion, createdAt, updatedAt, createdRevision, observedRevision, updatedRevision, scope: parsedScope, definition, progress: taskProgress, receipts, resolution: resolved, eventOffset, events }
  if (jsonBytes(result) > MAX_RECORD_BYTES) fail('task record exceeds the 256 KiB budget')
  return result
}
function inputRevision(document: KJDocument, tx: KJTransaction, value: unknown): number {
  const expected = integer(value, 'expected revision')
  if (expected !== document.revision || expected !== tx._draft().revision) fail(`revision conflict: expected ${expected}, actual ${document.revision}`)
  return expected
}
function taskRecord(document: KJDocument, tx: KJTransaction | null, id: string): { record: KJObjectRecord | KJReadonlyObjectRecord; task: KJAgentTaskPayload } {
  if (!validTaskId(id)) fail('task id is invalid')
  const state = tx?._draft() ?? document.snapshot(), record = tx ? tx.getObject(id) : document.getObject(id)
  if (!record || record.erased || record.kind !== 'custom' || record.type !== KJ_AGENT_TASK_TYPE || record.ownerId !== state.namedObjectsDictionaryId) fail('live drawing-scoped task does not exist')
  const dictionary = state.objects[state.namedObjectsDictionaryId]
  if (dictionary?.kind !== 'dictionary' || dictionary.payload.entries?.[key(id)] !== id) fail('task dictionary binding is missing or invalid')
  const task = payload(record.payload, state.revision)
  if (task.taskId !== id || task.documentId !== state.documentId || record.name !== task.title) fail('task identity, name or document binding is invalid')
  return { record, task }
}
function append(current: KJAgentTaskPayload, item: KJAgentTaskEvent): Pick<KJAgentTaskPayload, 'events' | 'eventOffset'> {
  const events = [...current.events, item]
  let eventOffset = current.eventOffset
  if (events.length > MAX_EVENTS) { events.shift(); eventOffset++ }
  return { events, eventOffset }
}
async function drift(document: KJDocument, task: ReadonlyDeep<KJAgentTaskPayload>, tx: KJTransaction | null = null): Promise<{ current: KJAgentTaskScope | null; driftedEntityIds: string[]; unitsMatch: boolean }> {
  const expected = new Map(task.scope.members.map(member => [member.id, member]))
  const driftedEntityIds: string[] = []
  const state = tx?._draft() ?? document.snapshot(), get = (id: string) => tx ? tx.getObject(id) : document.getObject(id)
  for (const saved of task.scope.members) {
    const entity = get(saved.id)
    if (!entity || entity.erased || entity.kind !== 'entity') { driftedEntityIds.push(saved.id); continue }
    const digest = await sha256(canonicalStringify(entity)!)
    if (expected.get(saved.id)?.handle !== entity.handle || expected.get(saved.id)?.sha256 !== digest) driftedEntityIds.push(saved.id)
  }
  let current: KJAgentTaskScope | null = null
  try { current = await scopeFrom(get, Object.values(state.objects), task.scope.members.map(member => member.id)) } catch { current = null }
  if (current && current.sha256 !== task.scope.sha256 && !driftedEntityIds.length) driftedEntityIds.push(...task.scope.members.map(member => member.id))
  const unitsMatch = state.header.units === task.units
  return { current, driftedEntityIds, unitsMatch }
}

/** Create one strict drawing-scoped task and its NOD pointer without changing scoped entities. */
export async function createAgentTask(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJObjectRecord> {
  const row = plain(input, ['id', 'expectedRevision', 'title', 'goal', 'entityIds', 'definition', 'at', 'actor'], 'create input')
  const expectedRevision = inputRevision(document, tx, row.expectedRevision), id = text(row.id, 'task id', 128)
  if (!validTaskId(id)) fail('task id is invalid')
  const state = tx._draft(), dictionaryId = state.namedObjectsDictionaryId
  if (state.objects[id] || Object.hasOwn(state.objects[dictionaryId]!.payload.entries ?? {}, key(id))) fail('task id already exists')
  const at = timestamp(row.at, 'created timestamp'), taskActor = actor(row.actor), taskScope = await scopeFrom(value => tx.getObject(value), Object.values(state.objects), row.entityIds as string[]), definition = taskDefinition(row.definition)
  if (document.revision !== expectedRevision || tx._draft().revision !== expectedRevision) fail('drawing changed while creating the task')
  const committedRevision = expectedRevision + 1
  const created: KJAgentTaskPayload = {
    contractVersion: 1, taskId: id, documentId: state.documentId, title: text(row.title, 'title', 256), goal: text(row.goal, 'goal', 8192), units: text(state.header.units, 'units', 64),
    status: 'draft', taskVersion: 1, createdAt: at, updatedAt: at, createdRevision: committedRevision, observedRevision: expectedRevision, updatedRevision: committedRevision,
    scope: taskScope, definition, progress: { steps: definition.steps.map(step => ({ id: step.id, status: 'pending', checks: [] })) }, receipts: [], resolution: null, eventOffset: 0,
    events: [{ version: 1, from: null, to: 'draft', at, documentRevision: committedRevision, actor: taskActor, reason: 'created' }],
  }
  payload(created, committedRevision)
  const record = tx.createObject({ id, kind: 'custom', type: KJ_AGENT_TASK_TYPE, ownerId: dictionaryId, name: created.title, payload: created })
  tx.addDictionaryEntry(dictionaryId, key(id), id)
  return record
}

/** Read strict persisted records. Untrusted malformed records fail closed. */
export function readAgentTasks(document: KJDocument, ids?: readonly string[]): ReadonlyArray<ReadonlyDeep<KJAgentTaskView>> {
  const queryIds = ids == null ? null : array(ids, 'task query IDs', 0, 256) as string[]
  if (queryIds && (queryIds.some(id => typeof id !== 'string') || new Set(queryIds).size !== queryIds.length)) fail('task query IDs are invalid')
  const selected = queryIds == null ? Object.values(document.snapshot().objects).filter(record => !record.erased && record.kind === 'custom' && record.type === KJ_AGENT_TASK_TYPE).map(record => record.id) : [...queryIds]
  return selected.map(id => {
    const { record, task } = taskRecord(document, null, id)
    return deepFreeze({ id: record.id, handle: record.handle, ...clone(task) }) as ReadonlyDeep<KJAgentTaskView>
  })
}

/** Inspect exact scoped members. Awaiting approvals always require session-level recovery after reopen. */
export async function inspectAgentTask(document: KJDocument, id: string): Promise<ReadonlyDeep<KJAgentTaskInspection>> {
  const task = readAgentTasks(document, [id])[0]
  if (!task) fail('task does not exist')
  const result = await drift(document, task), scopeMatches = result.unitsMatch && result.driftedEntityIds.length === 0
  const recovery: KJAgentTaskInspection['recovery'] = !scopeMatches
    ? task.status === 'awaiting_approval' ? 'review-approval-outcome' : 'replan-after-drift'
    : task.status === 'stale' ? 'rebase-required'
      : task.status === 'awaiting_approval' ? 'repropose-after-reopen' : null
  return deepFreeze({ task, scopeMatches, unitsMatch: result.unitsMatch, driftedEntityIds: result.driftedEntityIds, recovery }) as ReadonlyDeep<KJAgentTaskInspection>
}

/** Apply one legal lifecycle transition after revision, task-version and dependency checks. */
export async function transitionAgentTask(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJObjectRecord> {
  const row = optionalPlain(input, ['id', 'expectedRevision', 'expectedTaskVersion', 'expectedStatus', 'to', 'at', 'actor', 'reason', 'resolution', 'stepUpdates'], ['id', 'expectedRevision', 'expectedTaskVersion', 'expectedStatus', 'to', 'at', 'actor', 'reason'], 'transition input')
  const expectedRevision = inputRevision(document, tx, row.expectedRevision), id = text(row.id, 'task id', 128)
  const { record, task } = taskRecord(document, tx, id)
  const expectedVersion = integer(row.expectedTaskVersion, 'expected task version', 1), expectedStatus = taskStatus(row.expectedStatus, 'expected status'), to = taskStatus(row.to, 'next status')
  if (task.taskVersion !== expectedVersion || task.status !== expectedStatus) fail('task version or status conflict')
  if (TERMINAL.has(task.status) || !TRANSITIONS[task.status].includes(to)) fail(`illegal lifecycle transition ${task.status} -> ${to}`)
  if (to === 'completed') fail('completed status requires a trusted geometry-check receipt API')
  const checkedResolution = row.resolution === undefined ? null : resolution(row.resolution)
  if (['completed', 'failed', 'needs_attention'].includes(to) !== Boolean(checkedResolution)) fail('resolution is required exactly for completed, failed or needs_attention')
  let nextProgress = clone(task.progress)
  if (row.stepUpdates !== undefined) {
    const updates = array(row.stepUpdates, 'step updates', 1, task.definition.steps.length).map(item => stepProgress(item, task.definition))
    if (updates.some(update => update.status === 'passed' || update.checks.some(check => check.passed))) fail('passed checks require a trusted geometry-check receipt API')
    if (new Set(updates.map(item => item.id)).size !== updates.length) fail('step updates must have unique IDs')
    const stepTransitions: Readonly<Record<KJAgentTaskStepStatus, readonly KJAgentTaskStepStatus[]>> = {
      pending: ['active', 'passed', 'failed', 'skipped'], active: ['passed', 'failed', 'skipped'], failed: ['active', 'passed', 'skipped'], passed: [], skipped: ['active', 'passed'],
    }
    for (const update of updates) {
      const previous = nextProgress.steps.find(item => item.id === update.id)!
      if (!stepTransitions[previous.status].includes(update.status)) fail(`illegal step transition ${previous.status} -> ${update.status}`)
    }
    const byId = new Map(updates.map(item => [item.id, item]))
    nextProgress = { steps: nextProgress.steps.map(item => byId.get(item.id) ?? item) }
  }
  if (to === task.status && row.stepUpdates === undefined) fail('same-status transition requires a step update')
  const currentDrift = await drift(document, task, tx)
  if ((!currentDrift.unitsMatch || currentDrift.driftedEntityIds.length) && to !== 'stale') fail(`task scope drifted${currentDrift.unitsMatch ? `: ${currentDrift.driftedEntityIds.join(', ')}` : ': drawing units changed'}`)
  if (document.revision !== expectedRevision || tx._draft().revision !== expectedRevision) fail('drawing changed while transitioning the task')
  const at = timestamp(row.at, 'transition timestamp')
  if (Date.parse(at) < Date.parse(task.updatedAt)) fail('transition timestamp precedes the task')
  const version = task.taskVersion + 1, updatedRevision = expectedRevision + 1
  const nextEvent: KJAgentTaskEvent = { version, from: task.status, to, at, documentRevision: updatedRevision, actor: actor(row.actor), reason: text(row.reason, 'transition reason', 2048) }
  const next: KJAgentTaskPayload = { ...task, status: to, taskVersion: version, updatedAt: at, observedRevision: expectedRevision, updatedRevision, progress: nextProgress, resolution: checkedResolution, ...append(task, nextEvent) }
  payload(next, updatedRevision)
  return tx.updateObject(record.id, { payload: next })
}

function resolveCreatedReference(value: string, createdEntityIds: readonly string[]): string {
  const match = /^created:(0|[1-9]\d{0,2})$/.exec(value)
  if (!match) return value
  const resolved = createdEntityIds[Number(match[1])]
  if (!resolved) fail(`geometry check created reference is outside this reviewed batch: ${value}`)
  return resolved
}

function resolveGeometryCheck(check: KJDrawingValidationCheck, createdEntityIds: readonly string[]): KJDrawingValidationCheck {
  if (check.kind === 'point-distance') return {
    ...check,
    from: { ...check.from, objectId: resolveCreatedReference(check.from.objectId, createdEntityIds) },
    to: { ...check.to, objectId: resolveCreatedReference(check.to.objectId, createdEntityIds) },
  }
  return { ...check, objectId: resolveCreatedReference(check.objectId, createdEntityIds) }
}

function geometryCheckObjectIds(check: KJDrawingValidationCheck): string[] {
  return check.kind === 'point-distance' ? [check.from.objectId, check.to.objectId] : [check.objectId]
}

/** Complete one reviewed CREATEBATCH and its deterministic checks in the caller's transaction draft. */
export async function commitAgentTaskCreateBatchApproval(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJAgentTaskCreateBatchApprovalResult> {
  const row = plain(input, ['id', 'expectedRevision', 'expectedTaskVersion', 'expectedStatus', 'expectedScopeSha256', 'sourceToolName', 'toolApiVersion', 'toolContractHash', 'argumentsDigest', 'capabilityLocks', 'planId', 'executionEnvelopeId', 'reviewerId', 'createdEntityIds', 'at'], 'CREATEBATCH approval input')
  const expectedRevision = inputRevision(document, tx, row.expectedRevision), id = text(row.id, 'task id', 128)
  const { record, task } = taskRecord(document, tx, id)
  const expectedTaskVersion = integer(row.expectedTaskVersion, 'expected task version', 1)
  if (row.expectedStatus !== 'running' || task.status !== 'running' || task.taskVersion !== expectedTaskVersion) fail('task version or status conflict')
  if (typeof row.expectedScopeSha256 !== 'string' || !SHA256.test(row.expectedScopeSha256) || task.scope.sha256 !== row.expectedScopeSha256) fail('task scope lock conflict')
  const sourceToolName = identifier(row.sourceToolName, 'source tool name')
  if (!task.definition.tools.names.includes(sourceToolName)) fail('source tool is outside the task tool lock')
  if (row.toolApiVersion !== KJDRAW_AGENT_TASK_TOOL_API_VERSION || task.definition.tools.apiVersion !== KJDRAW_AGENT_TASK_TOOL_API_VERSION) fail('unsupported persistent task tool API version')
  if (typeof row.toolContractHash !== 'string' || row.toolContractHash !== task.definition.tools.contractHash) fail('task tool contract conflict')
  if (typeof row.argumentsDigest !== 'string' || !CONTENT_HASH.test(row.argumentsDigest)) fail('reviewed arguments digest is invalid')
  const capabilityLocks = array(row.capabilityLocks, 'approval capability locks', 0, 32).map(item => {
    const lock = plain(item, ['id', 'version', 'contentHash'], 'approval capability lock')
    if (typeof lock.contentHash !== 'string' || !CONTENT_HASH.test(lock.contentHash)) fail('approval capability lock hash is invalid')
    return { id: identifier(lock.id, 'approval capability id'), version: text(lock.version, 'approval capability version', 64), contentHash: lock.contentHash }
  })
  if (canonicalStringify(capabilityLocks) !== canonicalStringify(task.definition.capabilities)) fail('task capability lock conflict')
  const createdEntityIds = array(row.createdEntityIds, 'created entity IDs', 1, MAX_SCOPE_ENTITIES).map(value => text(value, 'created entity ID', 256))
  if (new Set(createdEntityIds).size !== createdEntityIds.length) fail('created entity IDs must be unique')
  for (const entityId of createdEntityIds) {
    if (document.getObject(entityId)) fail(`CREATEBATCH result was not newly created: ${entityId}`)
    const entity = tx.getObject(entityId)
    if (!entity || entity.erased || entity.kind !== 'entity') fail(`CREATEBATCH result is missing from the transaction draft: ${entityId}`)
  }
  if (tx._draft().header.units !== task.units) fail('drawing units changed during task approval')
  const currentDrift = await drift(document, task, tx)
  if (!currentDrift.unitsMatch || currentDrift.driftedEntityIds.length) fail(`task scope drifted${currentDrift.unitsMatch ? `: ${currentDrift.driftedEntityIds.join(', ')}` : ': drawing units changed'}`)
  const requirements = task.definition.requirements.map(requirement => {
    if (requirement.check.toolName !== 'cad_check_geometry' || !requirement.check.geometryCheck || requirement.check.assertion.path !== 'passed' || requirement.check.assertion.operator !== 'is_true' || requirement.check.assertion.expected !== true) fail('trusted completion requires deterministic cad_check_geometry requirements with passed is_true assertions')
    return resolveGeometryCheck(requirement.check.geometryCheck, createdEntityIds)
  })
  const afterRevision = expectedRevision + 1
  const validation = validateDrawingGeometryTransaction(document, tx, { expectedRevision: afterRevision, units: task.units, checks: requirements })
  if (!validation.passed) fail('reviewed CREATEBATCH does not satisfy every deterministic geometry requirement')
  const nextScope = await scopeFrom(value => tx.getObject(value), Object.values(tx._draft().objects), [...task.scope.members.map(member => member.id), ...createdEntityIds])
  const at = timestamp(row.at, 'approval timestamp')
  if (Date.parse(at) < Date.parse(task.updatedAt)) fail('approval timestamp precedes the task')
  const taskVersion = task.taskVersion + 1
  const receiptBase = {
    schema: 'com.kanjie.kjdraw.agent-task-geometry-receipt' as const,
    schemaVersion: 1 as const,
    taskId: task.taskId,
    taskVersion,
    planId: text(row.planId, 'plan id', 256),
    executionEnvelopeId: text(row.executionEnvelopeId, 'execution envelope id', 256),
    reviewerId: text(row.reviewerId, 'reviewer id', 256),
    command: 'CREATEBATCH' as const,
    sourceToolName,
    beforeRevision: expectedRevision,
    afterRevision,
    at,
    units: task.units,
    toolContractHash: row.toolContractHash,
    argumentsDigest: row.argumentsDigest,
    scopeSha256: nextScope.sha256,
    checks: validation.checks.map(check => clone(check)) as KJDrawingValidationCheckResult[],
  }
  const receiptDigest = stableHash(receiptBase)
  const receipt: KJAgentTaskGeometryReceipt = { ...receiptBase, receiptId: `receipt:${receiptDigest}`, receiptDigest }
  const checks = new Map(receipt.checks.map(check => [check.id, check]))
  const nextProgress = { steps: task.definition.steps.map(step => ({
    id: step.id,
    status: 'passed' as const,
    checks: step.requirementIds.map(requirementId => {
      const check = checks.get(requirementId)!
      return { requirementId, passed: true, summary: `${check.kind}: ${String(check.actual)} (expected ${String(check.expected)}, tolerance ${check.tolerance})`, receiptId: receipt.receiptId }
    }),
  })) }
  const eventItem: KJAgentTaskEvent = { version: taskVersion, from: task.status, to: 'completed', at, documentRevision: afterRevision, actor: { kind: 'host', id: receipt.reviewerId }, reason: 'reviewed CREATEBATCH committed with deterministic geometry checks' }
  const next: KJAgentTaskPayload = {
    ...task,
    status: 'completed', taskVersion, updatedAt: at, observedRevision: afterRevision, updatedRevision: afterRevision,
    scope: nextScope, progress: nextProgress, receipts: [...task.receipts, receipt].slice(-16),
    resolution: { code: 'geometry.verified', message: 'Reviewed geometry passed every deterministic task requirement.', retryable: false },
    ...append(task, eventItem),
  }
  payload(next, afterRevision)
  return { task: tx.updateObject(record.id, { payload: next }), receipt }
}

async function commitAgentTaskTransformApproval(document: KJDocument, tx: KJTransaction, input: unknown, command: 'MOVE' | 'ROTATE' | 'SCALE' | 'LENGTHEN' | 'STRETCH' | 'PEDIT'): Promise<KJAgentTaskMoveApprovalResult> {
  const entityIdsField = command === 'MOVE' ? 'movedEntityIds' : command === 'ROTATE' ? 'rotatedEntityIds' : command === 'SCALE' ? 'scaledEntityIds' : command === 'LENGTHEN' ? 'lengthenedEntityIds' : command === 'STRETCH' ? 'stretchedEntityIds' : 'editedEntityIds'
  const expectedSourceTool = command === 'MOVE' ? 'cad_propose_move' : command === 'ROTATE' ? 'cad_propose_rotate' : command === 'SCALE' ? 'cad_propose_scale' : command === 'LENGTHEN' ? 'cad_propose_lengthen' : command === 'STRETCH' ? 'cad_propose_stretch' : 'cad_propose_polyline_edit'
  const row = plain(input, ['id', 'expectedRevision', 'expectedTaskVersion', 'expectedStatus', 'expectedScopeSha256', 'sourceToolName', 'toolApiVersion', 'toolContractHash', 'argumentsDigest', 'capabilityLocks', 'planId', 'executionEnvelopeId', 'reviewerId', entityIdsField, 'at'], `${command} approval input`)
  const expectedRevision = inputRevision(document, tx, row.expectedRevision), id = text(row.id, 'task id', 128)
  const { record, task } = taskRecord(document, tx, id)
  const expectedTaskVersion = integer(row.expectedTaskVersion, 'expected task version', 1)
  if (row.expectedStatus !== 'running' || task.status !== 'running' || task.taskVersion !== expectedTaskVersion) fail('task version or status conflict')
  if (typeof row.expectedScopeSha256 !== 'string' || !SHA256.test(row.expectedScopeSha256) || task.scope.sha256 !== row.expectedScopeSha256) fail('task scope lock conflict')
  const sourceToolName = identifier(row.sourceToolName, 'source tool name')
  if (sourceToolName !== expectedSourceTool || !task.definition.tools.names.includes(sourceToolName)) fail(`${command} source tool is outside the task tool lock`)
  if (row.toolApiVersion !== KJDRAW_AGENT_TASK_TOOL_API_VERSION || task.definition.tools.apiVersion !== KJDRAW_AGENT_TASK_TOOL_API_VERSION) fail('unsupported persistent task tool API version')
  if (typeof row.toolContractHash !== 'string' || row.toolContractHash !== task.definition.tools.contractHash) fail('task tool contract conflict')
  if (typeof row.argumentsDigest !== 'string' || !CONTENT_HASH.test(row.argumentsDigest)) fail('reviewed arguments digest is invalid')
  const capabilityLocks = array(row.capabilityLocks, 'approval capability locks', 0, 32).map(item => {
    const lock = plain(item, ['id', 'version', 'contentHash'], 'approval capability lock')
    if (typeof lock.contentHash !== 'string' || !CONTENT_HASH.test(lock.contentHash)) fail('approval capability lock hash is invalid')
    return { id: identifier(lock.id, 'approval capability id'), version: text(lock.version, 'approval capability version', 64), contentHash: lock.contentHash }
  })
  if (canonicalStringify(capabilityLocks) !== canonicalStringify(task.definition.capabilities)) fail('task capability lock conflict')
  const transformedEntityIds = array(row[entityIdsField], `${command} entity IDs`, 1, command === 'LENGTHEN' || command === 'PEDIT' ? 1 : 64).map(value => text(value, `${command} entity ID`, 256))
  if (new Set(transformedEntityIds).size !== transformedEntityIds.length) fail(`${command} entity IDs must be unique`)
  const scopedIds = task.scope.members.map(member => member.id)
  if (transformedEntityIds.some(id => !scopedIds.includes(id))) fail(`${command} cannot target entities outside the persisted task scope`)
  if (tx._draft().header.units !== task.units) fail('drawing units changed during task approval')
  const currentDrift = await drift(document, task)
  if (!currentDrift.unitsMatch || currentDrift.driftedEntityIds.length) fail(`task scope drifted${currentDrift.unitsMatch ? `: ${currentDrift.driftedEntityIds.join(', ')}` : ': drawing units changed'}`)
  const beforeEntities = Object.values(document.snapshot().objects).filter(object => !object.erased && object.kind === 'entity')
  // Read transaction records through getObject() so comparison uses detached
  // plain values. Draft views are recursive read-only proxies and may contain
  // frozen extension records supplied by an authoritative document backend.
  const transactionObjects = Object.keys(tx._draft().objects).map(id => tx.getObject(id)!)
  const afterEntities = transactionObjects.filter(object => !object.erased && object.kind === 'entity')
  const beforeIds = beforeEntities.map(object => object.id).sort(), afterIds = afterEntities.map(object => object.id).sort()
  if (canonicalStringify(beforeIds) !== canonicalStringify(afterIds)) fail(`${command} cannot create, erase or replace entities`)
  const beforeById = new Map(beforeEntities.map(object => [object.id, object]))
  const changedIds = afterEntities.filter(object => canonicalStringify(beforeById.get(object.id)) !== canonicalStringify(object)).map(object => object.id).sort()
  const expectedChangedIds = [...transformedEntityIds].sort()
  if (canonicalStringify(changedIds) !== canonicalStringify(expectedChangedIds)) fail(`${command} must change exactly the reviewed in-scope entities`)
  for (const member of task.scope.members) if (tx.getObject(member.id)?.handle !== member.handle) fail(`${command} must preserve every scoped entity identity and handle`)
  const requirements = task.definition.requirements.map(requirement => {
    if (requirement.check.toolName !== 'cad_check_geometry' || !requirement.check.geometryCheck || requirement.check.assertion.path !== 'passed' || requirement.check.assertion.operator !== 'is_true' || requirement.check.assertion.expected !== true) fail('trusted completion requires deterministic cad_check_geometry requirements with passed is_true assertions')
    const referencedIds = geometryCheckObjectIds(requirement.check.geometryCheck)
    if (referencedIds.some(id => id.startsWith('created:'))) fail(`${command} geometry checks cannot reference created entities`)
    if (referencedIds.some(id => !scopedIds.includes(id))) fail(`${command} geometry checks must reference only the persisted task scope`)
    return clone(requirement.check.geometryCheck)
  })
  const afterRevision = expectedRevision + 1
  const validation = validateDrawingGeometryTransaction(document, tx, { expectedRevision: afterRevision, units: task.units, checks: requirements })
  if (!validation.passed) fail(`reviewed ${command} does not satisfy every deterministic geometry requirement`)
  const nextScope = await scopeFrom(value => tx.getObject(value), transactionObjects, scopedIds)
  const at = timestamp(row.at, 'approval timestamp')
  if (Date.parse(at) < Date.parse(task.updatedAt)) fail('approval timestamp precedes the task')
  const taskVersion = task.taskVersion + 1
  const receiptBase = {
    schema: 'com.kanjie.kjdraw.agent-task-geometry-receipt' as const, schemaVersion: 1 as const,
    taskId: task.taskId, taskVersion, planId: text(row.planId, 'plan id', 256), executionEnvelopeId: text(row.executionEnvelopeId, 'execution envelope id', 256),
    reviewerId: text(row.reviewerId, 'reviewer id', 256), command, sourceToolName,
    beforeRevision: expectedRevision, afterRevision, at, units: task.units, toolContractHash: row.toolContractHash,
    argumentsDigest: row.argumentsDigest, scopeSha256: nextScope.sha256,
    checks: validation.checks.map(check => clone(check)) as KJDrawingValidationCheckResult[],
  }
  const receiptDigest = stableHash(receiptBase)
  const receipt: KJAgentTaskGeometryReceipt = { ...receiptBase, receiptId: `receipt:${receiptDigest}`, receiptDigest }
  const checks = new Map(receipt.checks.map(check => [check.id, check]))
  const nextProgress = { steps: task.definition.steps.map(step => ({ id: step.id, status: 'passed' as const, checks: step.requirementIds.map(requirementId => {
    const check = checks.get(requirementId)!
    return { requirementId, passed: true, summary: `${check.kind}: ${String(check.actual)} (expected ${String(check.expected)}, tolerance ${check.tolerance})`, receiptId: receipt.receiptId }
  }) })) }
  const eventItem: KJAgentTaskEvent = { version: taskVersion, from: task.status, to: 'completed', at, documentRevision: afterRevision, actor: { kind: 'host', id: receipt.reviewerId }, reason: `reviewed ${command} committed with deterministic geometry checks` }
  const next: KJAgentTaskPayload = {
    ...task, status: 'completed', taskVersion, updatedAt: at, observedRevision: afterRevision, updatedRevision: afterRevision,
    scope: nextScope, progress: nextProgress, receipts: [...task.receipts, receipt].slice(-16),
    resolution: { code: 'geometry.verified', message: 'Reviewed geometry passed every deterministic task requirement.', retryable: false },
    ...append(task, eventItem),
  }
  payload(next, afterRevision)
  return { task: tx.updateObject(record.id, { payload: next }), receipt }
}

/** Complete one reviewed MOVE and its deterministic checks in the caller's transaction draft. */
export async function commitAgentTaskMoveApproval(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJAgentTaskMoveApprovalResult> {
  return commitAgentTaskTransformApproval(document, tx, input, 'MOVE')
}

/** Complete one reviewed ROTATE and its deterministic checks in the caller's transaction draft. */
export async function commitAgentTaskRotateApproval(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJAgentTaskRotateApprovalResult> {
  return commitAgentTaskTransformApproval(document, tx, input, 'ROTATE')
}

/** Complete one reviewed SCALE and its deterministic checks in the caller's transaction draft. */
export async function commitAgentTaskScaleApproval(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJAgentTaskScaleApprovalResult> {
  return commitAgentTaskTransformApproval(document, tx, input, 'SCALE')
}

/** Complete one reviewed LENGTHEN and its deterministic checks in the caller's transaction draft. */
export async function commitAgentTaskLengthenApproval(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJAgentTaskLengthenApprovalResult> {
  return commitAgentTaskTransformApproval(document, tx, input, 'LENGTHEN')
}

/** Complete one reviewed STRETCH and its deterministic checks in the caller's transaction draft. */
export async function commitAgentTaskStretchApproval(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJAgentTaskStretchApprovalResult> {
  return commitAgentTaskTransformApproval(document, tx, input, 'STRETCH')
}

/** Complete one reviewed PEDIT and its deterministic checks in the caller's transaction draft. */
export async function commitAgentTaskPolylineEditApproval(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJAgentTaskPolylineEditApprovalResult> {
  return commitAgentTaskTransformApproval(document, tx, input, 'PEDIT')
}

/** Explicitly accept the current dependency snapshot after stale or ambiguous approval recovery. */
export async function rebaseAgentTask(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJObjectRecord> {
  const row = plain(input, ['id', 'expectedRevision', 'expectedTaskVersion', 'expectedStatus', 'at', 'actor', 'reason'], 'rebase input')
  const expectedRevision = inputRevision(document, tx, row.expectedRevision), id = text(row.id, 'task id', 128)
  const { record, task } = taskRecord(document, tx, id)
  const expectedVersion = integer(row.expectedTaskVersion, 'expected task version', 1)
  if (!['stale', 'awaiting_approval'].includes(String(row.expectedStatus)) || task.status !== row.expectedStatus || task.taskVersion !== expectedVersion) fail('rebase requires the exact stale or awaiting-approval task version')
  if (tx._draft().header.units !== task.units) fail('drawing units changed; create a new task instead of rebasing numeric intent')
  const nextScope = await scopeFrom(value => tx.getObject(value), Object.values(tx._draft().objects), task.scope.members.map(member => member.id))
  if (document.revision !== expectedRevision || tx._draft().revision !== expectedRevision) fail('drawing changed while rebasing the task')
  const at = timestamp(row.at, 'rebase timestamp')
  if (Date.parse(at) < Date.parse(task.updatedAt)) fail('rebase timestamp precedes the task')
  const to: KJAgentTaskStatus = task.status === 'stale' ? 'ready' : 'running'
  const version = task.taskVersion + 1, updatedRevision = expectedRevision + 1
  const nextEvent: KJAgentTaskEvent = { version, from: task.status, to, at, documentRevision: updatedRevision, actor: actor(row.actor), reason: text(row.reason, 'rebase reason', 2048) }
  const next: KJAgentTaskPayload = { ...task, scope: nextScope, status: to, taskVersion: version, updatedAt: at, observedRevision: expectedRevision, updatedRevision, progress: { steps: task.progress.steps.map(step => ({ id: step.id, status: 'pending', checks: [] })) }, resolution: null, ...append(task, nextEvent) }
  payload(next, updatedRevision)
  return tx.updateObject(record.id, { payload: next })
}
