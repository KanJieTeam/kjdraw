export declare const KJ_AGENT_PLAN_BINDING_CANONICALIZATION: 'com.kanjie.kjdraw.canonical-json@1';
export declare const KJ_AGENT_PLAN_BINDING_DOMAIN: 'com.kanjie.kjdraw.agent-plan-binding@1';
export interface KJAgentPlanDocument {
    id: string;
    revision: number;
    fingerprint(): string;
    serialize(options?: {
        pretty?: boolean;
        includeRevisions?: boolean;
    }): string;
}
export interface KJAgentPlanBindingContext {
    phase: 'create' | 'verify';
    planId: string;
    command: string;
    documentId: string;
    expectedRevision: number;
}
/**
 * Host-injected approval binding. A deterministic HMAC provider can implement
 * create/verify with the same secret; a signature provider can sign in create
 * and verify with its public key. Implementations must fail closed.
 */
export interface KJAgentPlanBindingProvider {
    readonly algorithm: string;
    create(canonicalContent: string, context: Readonly<KJAgentPlanBindingContext>): Promise<string>;
    verify(canonicalContent: string, binding: string, context: Readonly<KJAgentPlanBindingContext>): Promise<boolean>;
}
export interface KJAgentPlanRegistryOptions {
    clock?: () => number;
    defaultTtlMs?: number;
    bindingProvider?: KJAgentPlanBindingProvider;
}
export interface KJAgentPlanRecord {
    schema: 'com.kanjie.kjdraw.agent-plan@1';
    planId: string;
    command: string;
    documentId: string;
    expectedRevision: number;
    documentFingerprint: string;
    documentContentDigest: string;
    bindingCanonicalization: typeof KJ_AGENT_PLAN_BINDING_CANONICALIZATION;
    bindingAlgorithm: string;
    binding: string;
    status: 'active' | 'consumed' | 'rejected' | 'expired';
    createdAt: string;
    expiresAt: string;
    consumedAt?: string;
    rejectedAt?: string;
    confirmedBy?: string;
    rejectedBy?: string;
    executionEnvelopeId?: string;
}
export declare function canonicalizeAgentPlanBinding(value: unknown): string;
export declare function createSha256AgentPlanBindingProvider(): KJAgentPlanBindingProvider;
export declare class KJAgentPlanRegistry {
    #private;
    constructor({ clock, defaultTtlMs, bindingProvider, }?: KJAgentPlanRegistryOptions);
    register(input: unknown, document: KJAgentPlanDocument, { ttlMs }?: {
        ttlMs?: number;
    }): Promise<Readonly<KJAgentPlanRecord>>;
    consume(input: unknown, document: KJAgentPlanDocument): Promise<Readonly<KJAgentPlanRecord>>;
    reject(planId: string, rejectedBy: string): Readonly<KJAgentPlanRecord>;
    get(planId: string): Readonly<KJAgentPlanRecord> | null;
    list(): ReadonlyArray<Readonly<KJAgentPlanRecord>>;
    prune(): number;
}
