import type { KJDocument } from './document.js';
import type { KJTransaction } from './transaction.js';
import type { KJObjectRecord } from './schema.js';
import type { ReadonlyDeep } from './utils.js';
import { type KJDrawingValidationCheck, type KJDrawingValidationCheckResult } from './drawing-validation.js';
export declare const KJ_AGENT_TASK_TYPE: 'AI_TASK';
export declare const KJ_AGENT_TASK_CONTRACT_VERSION: 1;
/** Exact persisted tool-contract version understood by atomic task approval. */
export declare const KJDRAW_AGENT_TASK_TOOL_API_VERSION: string;
export type KJAgentTaskStatus = 'draft' | 'ready' | 'running' | 'awaiting_approval' | 'needs_attention' | 'stale' | 'completed' | 'failed' | 'cancelled';
export interface KJAgentTaskActor {
    kind: 'host' | 'agent' | 'system';
    id: string;
}
export interface KJAgentTaskResolution {
    code: string;
    message: string;
    retryable: boolean;
}
export interface KJAgentTaskAssertion {
    path: string;
    operator: 'equals' | 'at_least' | 'at_most' | 'is_true';
    expected: string | number | boolean | null;
}
export interface KJAgentTaskRequirement {
    id: string;
    description: string;
    check: {
        toolName: string;
        assertion: KJAgentTaskAssertion;
        geometryCheck?: KJDrawingValidationCheck;
    };
}
export interface KJAgentTaskStep {
    id: string;
    title: string;
    requirementIds: string[];
}
export interface KJAgentTaskToolBinding {
    apiVersion: string;
    names: string[];
    contractHash: string;
}
export interface KJAgentTaskCapabilityLock {
    id: string;
    version: string;
    contentHash: string;
}
export interface KJAgentTaskDefinition {
    requirements: KJAgentTaskRequirement[];
    steps: KJAgentTaskStep[];
    tools: KJAgentTaskToolBinding;
    capabilities: KJAgentTaskCapabilityLock[];
}
export type KJAgentTaskStepStatus = 'pending' | 'active' | 'passed' | 'failed' | 'skipped';
export interface KJAgentTaskCheckSummary {
    requirementId: string;
    passed: boolean;
    summary: string;
    receiptId?: string;
}
export interface KJAgentTaskStepProgress {
    id: string;
    status: KJAgentTaskStepStatus;
    checks: KJAgentTaskCheckSummary[];
}
export interface KJAgentTaskScopeMember {
    id: string;
    handle: string;
    sha256: string;
}
export interface KJAgentTaskScope {
    members: KJAgentTaskScopeMember[];
    relations: KJAgentTaskScopeMember[];
    sha256: string;
}
export interface KJAgentTaskGeometryReceipt {
    schema: 'com.kanjie.kjdraw.agent-task-geometry-receipt';
    schemaVersion: 1;
    receiptId: string;
    taskId: string;
    taskVersion: number;
    planId: string;
    executionEnvelopeId: string;
    reviewerId: string;
    command: 'CREATEBATCH' | 'MOVE';
    sourceToolName: string;
    beforeRevision: number;
    afterRevision: number;
    at: string;
    units: string;
    toolContractHash: string;
    argumentsDigest: string;
    scopeSha256: string;
    checks: KJDrawingValidationCheckResult[];
    receiptDigest: string;
}
export interface KJAgentTaskEvent {
    version: number;
    from: KJAgentTaskStatus | null;
    to: KJAgentTaskStatus;
    at: string;
    documentRevision: number;
    actor: KJAgentTaskActor;
    reason: string;
}
export interface KJAgentTaskPayload extends Record<string, unknown> {
    contractVersion: typeof KJ_AGENT_TASK_CONTRACT_VERSION;
    taskId: string;
    documentId: string;
    title: string;
    goal: string;
    units: string;
    status: KJAgentTaskStatus;
    taskVersion: number;
    createdAt: string;
    updatedAt: string;
    createdRevision: number;
    observedRevision: number;
    updatedRevision: number;
    scope: KJAgentTaskScope;
    definition: KJAgentTaskDefinition;
    progress: {
        steps: KJAgentTaskStepProgress[];
    };
    receipts: KJAgentTaskGeometryReceipt[];
    resolution: KJAgentTaskResolution | null;
    eventOffset: number;
    events: KJAgentTaskEvent[];
}
export interface KJAgentTaskCreateInput {
    id: string;
    expectedRevision: number;
    title: string;
    goal: string;
    entityIds: string[];
    definition: KJAgentTaskDefinition;
    at: string;
    actor: KJAgentTaskActor;
}
export interface KJAgentTaskTransitionInput {
    id: string;
    expectedRevision: number;
    expectedTaskVersion: number;
    expectedStatus: KJAgentTaskStatus;
    to: KJAgentTaskStatus;
    at: string;
    actor: KJAgentTaskActor;
    reason: string;
    resolution?: KJAgentTaskResolution;
    stepUpdates?: KJAgentTaskStepProgress[];
}
export interface KJAgentTaskRebaseInput {
    id: string;
    expectedRevision: number;
    expectedTaskVersion: number;
    expectedStatus: 'stale' | 'awaiting_approval';
    at: string;
    actor: KJAgentTaskActor;
    reason: string;
}
export interface KJAgentTaskCreateBatchApprovalInput {
    id: string;
    expectedRevision: number;
    expectedTaskVersion: number;
    expectedStatus: 'running';
    expectedScopeSha256: string;
    sourceToolName: string;
    toolApiVersion: string;
    toolContractHash: string;
    argumentsDigest: string;
    capabilityLocks: KJAgentTaskCapabilityLock[];
    planId: string;
    executionEnvelopeId: string;
    reviewerId: string;
    createdEntityIds: string[];
    at: string;
}
export interface KJAgentTaskCreateBatchApprovalResult {
    task: KJObjectRecord;
    receipt: KJAgentTaskGeometryReceipt;
}
export interface KJAgentTaskMoveApprovalInput {
    id: string;
    expectedRevision: number;
    expectedTaskVersion: number;
    expectedStatus: 'running';
    expectedScopeSha256: string;
    sourceToolName: string;
    toolApiVersion: string;
    toolContractHash: string;
    argumentsDigest: string;
    capabilityLocks: KJAgentTaskCapabilityLock[];
    planId: string;
    executionEnvelopeId: string;
    reviewerId: string;
    movedEntityIds: string[];
    at: string;
}
export interface KJAgentTaskMoveApprovalResult {
    task: KJObjectRecord;
    receipt: KJAgentTaskGeometryReceipt;
}
export interface KJAgentTaskView extends KJAgentTaskPayload {
    id: string;
    handle: string;
}
export interface KJAgentTaskInspection {
    task: KJAgentTaskView;
    scopeMatches: boolean;
    unitsMatch: boolean;
    driftedEntityIds: string[];
    recovery: 'rebase-required' | 'replan-after-drift' | 'review-approval-outcome' | 'repropose-after-reopen' | null;
}
/** Create one strict drawing-scoped task and its NOD pointer without changing scoped entities. */
export declare function createAgentTask(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJObjectRecord>;
/** Read strict persisted records. Untrusted malformed records fail closed. */
export declare function readAgentTasks(document: KJDocument, ids?: readonly string[]): ReadonlyArray<ReadonlyDeep<KJAgentTaskView>>;
/** Inspect exact scoped members. Awaiting approvals always require session-level recovery after reopen. */
export declare function inspectAgentTask(document: KJDocument, id: string): Promise<ReadonlyDeep<KJAgentTaskInspection>>;
/** Apply one legal lifecycle transition after revision, task-version and dependency checks. */
export declare function transitionAgentTask(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJObjectRecord>;
/** Complete one reviewed CREATEBATCH and its deterministic checks in the caller's transaction draft. */
export declare function commitAgentTaskCreateBatchApproval(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJAgentTaskCreateBatchApprovalResult>;
/** Complete one reviewed MOVE and its deterministic checks in the caller's transaction draft. */
export declare function commitAgentTaskMoveApproval(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJAgentTaskMoveApprovalResult>;
/** Explicitly accept the current dependency snapshot after stale or ambiguous approval recovery. */
export declare function rebaseAgentTask(document: KJDocument, tx: KJTransaction, input: unknown): Promise<KJObjectRecord>;
