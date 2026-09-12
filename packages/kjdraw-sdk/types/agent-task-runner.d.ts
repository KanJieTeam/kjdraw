import { KJAgentCapabilityRegistry } from './agent-capabilities.js';
import { type KJAgentRunOptions, type KJAgentRunResult } from './agent-runner.js';
import { type KJAgentTaskToolBinding } from './agent-tasks.js';
import type { KJAgentToolDefinition, KJAgentToolSession } from './agent-tools.js';
import type { KJDocument } from './document.js';
import { type ReadonlyDeep } from './utils.js';
/** Exact persisted tool-contract version understood by this runtime. */
export declare const KJDRAW_AGENT_TASK_TOOL_API_VERSION: string;
export interface KJPersistedAgentTaskRunOptions extends Omit<KJAgentRunOptions, 'session' | 'prompt' | 'toolNames' | 'capabilities'> {
    document: KJDocument;
    session: KJAgentToolSession;
    taskId: string;
    expectedRevision: number;
    expectedTaskVersion: number;
    expectedStatus: 'ready' | 'running';
    /** Optional host restriction. Every name must already be locked by the task. */
    toolNames?: readonly string[];
    /** Required when the persisted task locks one or more trusted capabilities. */
    capabilityRegistry?: KJAgentCapabilityRegistry;
}
export interface KJPersistedAgentTaskRunResult extends KJAgentRunResult {
    readonly task: {
        readonly id: string;
        readonly version: number;
        readonly status: 'ready' | 'running';
        readonly documentId: string;
        readonly revision: number;
    };
}
/**
 * Create the only supported persisted tool binding. The stable hash covers every
 * model-visible contract field, with names sorted so caller order has no meaning.
 */
export declare function createAgentTaskToolBinding(definitions: readonly KJAgentToolDefinition[], toolNames?: readonly string[]): KJAgentTaskToolBinding;
/**
 * Run one exact persisted task without changing its record or document revision.
 * Lifecycle checkpoints remain explicit host transactions before a run or after
 * a reviewed approval receipt; an in-memory proposal is never persisted here.
 */
export declare function runPersistedKJAgentTask(options: KJPersistedAgentTaskRunOptions): Promise<ReadonlyDeep<KJPersistedAgentTaskRunResult>>;
