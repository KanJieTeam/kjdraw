import { KJAgentPlanRegistry } from './agent-plans.js';
import type { KJAgentPlanRecord, KJAgentPlanRegistryOptions } from './agent-plans.js';
import { buildSDKCapabilityManifest } from './capabilities.js';
import { KJCommandRegistry } from './commands.js';
import type { KJCommandArguments, KJCommandDefinition } from './commands.js';
import { KJDocument } from './document.js';
import type { KJDocumentAuthority, KJDocumentConstructorOptions } from './document.js';
import { KJEventBus } from './events.js';
import { KJExtensionRegistry } from './extensions.js';
import type { KJExtensionDefinition, KJExtensionPoint } from './extensions.js';
import { KJFileAdapterRegistry } from './file-adapters.js';
import type { KJFileAdapterDefinition, KJFileAdapterOptions } from './file-adapters.js';
import type { KJCoreSolidBackend } from './kernel/wasm-solid.js';
import type { KJPluginManifest } from './plugin-contract.js';
import type { KJCommandEnvelope, KJCommandReceipt, KJCreateCommandOptions } from './product-contract.js';
import type { KJDocumentOptions, KJDocumentState, KJLegacyScene } from './schema.js';
import { KJSelectionManager } from './selection.js';
import type { KJSelectionSet } from './selection.js';
import type { KJSnapCandidate, KJSnapOptions, KJSnapPointInput } from './snapping.js';
import type { ReadonlyDeep } from './utils.js';
export interface KJDocumentAuthorityProvider {
    readonly authoritative: true;
    open(source: string): KJDocumentAuthority;
}
export interface KJDrawSDKOptions {
    version?: string;
    documentAuthority?: KJDocumentAuthorityProvider | null;
    solidAuthority?: Readonly<KJCoreSolidBackend> | null;
    agentPlans?: KJAgentPlanRegistry;
    agentPlanOptions?: KJAgentPlanRegistryOptions;
    registerDefaultAdapters?: boolean;
}
export interface KJExecuteCommandOptions {
    document?: KJDocument | null;
    author?: unknown;
    expectedRevision?: number;
    commandEnvelope?: Readonly<KJCommandEnvelope> | null;
}
export interface KJCreateSDKCommandEnvelopeOptions extends KJCreateCommandOptions {
    document?: KJDocument | null;
}
export interface KJExecuteCommandEnvelopeOptions extends KJExecuteCommandOptions {
    agentPlanOptions?: {
        ttlMs?: number;
    };
}
export interface KJSnapSDKOptions extends KJSnapOptions {
    document?: KJDocument | null;
}
export interface KJPluginScopeOptions {
    grantedPermissions?: readonly string[];
}
export type KJSDKCommandEnvelopeReceipt<TResult = unknown> = Readonly<KJCommandReceipt<TResult | Readonly<KJAgentPlanRecord> | null>>;
export interface KJDocumentAttachedEvent {
    document: KJDocument;
}
export interface KJDocumentClosedEvent {
    documentId: string;
}
export interface KJDocumentAuthorityReadyEvent {
    authority: KJDocumentAuthorityProvider;
    documentIds: readonly string[];
}
export interface KJSolidAuthorityReadyEvent {
    authority: Readonly<KJCoreSolidBackend>;
}
export interface KJActiveDocumentChangedEvent {
    documentId: string;
}
export interface KJCommandPlannedEvent {
    envelope: Readonly<KJCommandEnvelope>;
    receipt: Readonly<KJCommandReceipt<Readonly<KJAgentPlanRecord> | null>>;
    document: KJDocument;
    plan: Readonly<KJAgentPlanRecord> | null;
}
export interface KJCommandBeforeExecuteEvent {
    envelope: Readonly<KJCommandEnvelope>;
    document: KJDocument;
    beforeRevision: number;
    agentPlan: Readonly<KJAgentPlanRecord> | null;
}
export interface KJCommandCommittedEvent {
    envelope: Readonly<KJCommandEnvelope>;
    receipt: Readonly<KJCommandReceipt<unknown>>;
    document: KJDocument;
}
export interface KJCommandFailedEvent {
    envelope: Readonly<KJCommandEnvelope>;
    document: KJDocument;
    beforeRevision: number;
    afterRevision: number;
    error: unknown;
}
export interface KJDrawSDKEvents {
    'document:attached': KJDocumentAttachedEvent;
    'document:closed': KJDocumentClosedEvent;
    'document:authority-ready': KJDocumentAuthorityReadyEvent;
    'solid:authority-ready': KJSolidAuthorityReadyEvent;
    'document:active-changed': KJActiveDocumentChangedEvent;
    'command:planned': KJCommandPlannedEvent;
    'command:before-execute': KJCommandBeforeExecuteEvent;
    'command:committed': KJCommandCommittedEvent;
    'command:failed': KJCommandFailedEvent;
}
export type KJRegistrationDisposer = () => boolean;
export interface KJPluginScope {
    readonly owner: string;
    readonly manifest: ReadonlyDeep<KJPluginManifest>;
    registerCommand(definition: KJCommandDefinition): KJRegistrationDisposer;
    registerExtension(point: KJExtensionPoint, definition: KJExtensionDefinition): KJRegistrationDisposer;
    registerFileAdapter(definition: KJFileAdapterDefinition): KJRegistrationDisposer;
    executeCommand<TResult = unknown>(id: string, args?: KJCommandArguments, options?: KJExecuteCommandOptions): Promise<TResult>;
    dispose(): void;
}
type KJOpenDocumentInput = string | KJDocumentState | KJLegacyScene | Record<string, unknown>;
export declare class KJDrawSDK {
    readonly version: string;
    readonly events: KJEventBus<KJDrawSDKEvents>;
    readonly extensions: KJExtensionRegistry;
    readonly commands: KJCommandRegistry;
    readonly fileAdapters: KJFileAdapterRegistry;
    readonly documents: Map<string, KJDocument>;
    readonly selections: Map<string, KJSelectionManager>;
    readonly agentPlans: KJAgentPlanRegistry;
    activeDocumentId: string | null;
    documentAuthority: KJDocumentAuthorityProvider | null;
    solidAuthority: Readonly<KJCoreSolidBackend> | null;
    constructor(options?: KJDrawSDKOptions);
    createDocument(options?: KJDocumentOptions & KJDocumentConstructorOptions): KJDocument;
    openDocument(input: KJOpenDocumentInput, options?: KJDocumentConstructorOptions): KJDocument;
    attachDocument(document: KJDocument): KJDocument;
    closeDocument(inputId: string): boolean;
    get activeDocument(): KJDocument | null;
    get activeSelection(): KJSelectionSet | null;
    getSelectionManager(documentId?: string | null): KJSelectionManager | null;
    setDocumentAuthority(authority: KJDocumentAuthorityProvider): KJDocumentAuthorityProvider;
    setSolidAuthority(authority: Readonly<KJCoreSolidBackend>): Readonly<KJCoreSolidBackend>;
    setActiveDocument(inputId: string): KJDocument;
    executeCommand<TResult = unknown>(id: string, args?: KJCommandArguments, options?: KJExecuteCommandOptions): Promise<TResult>;
    executeCommand<TResult = unknown>(envelope: Readonly<KJCommandEnvelope>, options?: KJExecuteCommandEnvelopeOptions): Promise<KJSDKCommandEnvelopeReceipt<TResult>>;
    createCommandEnvelope<TArguments extends Record<string, unknown> = KJCommandArguments>(command: string, args?: TArguments, options?: KJCreateSDKCommandEnvelopeOptions): Readonly<KJCommandEnvelope<TArguments>>;
    executeCommandEnvelope<TResult = unknown>(input: unknown, options?: KJExecuteCommandEnvelopeOptions): Promise<KJSDKCommandEnvelopeReceipt<TResult>>;
    snap(cursor: KJSnapPointInput, options?: KJSnapSDKOptions): readonly Readonly<KJSnapCandidate>[];
    readDocument(source: unknown, options?: KJFileAdapterOptions): Promise<KJDocument>;
    writeDocument<TResult = unknown>(document?: KJDocument | null, options?: KJFileAdapterOptions): Promise<TResult>;
    capabilities(): ReturnType<typeof buildSDKCapabilityManifest>;
    createPluginScope(manifestInput: unknown, { grantedPermissions }?: KJPluginScopeOptions): Readonly<KJPluginScope>;
}
export declare function createKJDrawSDK(options?: KJDrawSDKOptions): KJDrawSDK;
export {};
