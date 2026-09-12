import { type ReadonlyDeep } from './utils.js';
export declare const KJDRAW_AGENT_CAPABILITY_SCHEMA = "com.kanjie.kjdraw.agent-capability";
export declare const KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION = 1;
export declare const KJDRAW_AGENT_CAPABILITY_TOOL_API_VERSION = 1;
export interface KJAgentCapabilityRequirement {
    id: string;
    description: string;
    /** A requested evidence check, not executable code or a successful validation receipt. */
    check: {
        toolName: string;
        assertion: string;
    };
}
export interface KJAgentCapabilityManifest {
    schema: typeof KJDRAW_AGENT_CAPABILITY_SCHEMA;
    schemaVersion: typeof KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION;
    id: string;
    name: string;
    version: string;
    toolApiVersion: number;
    /** Domain guidance explicitly trusted by the host; it grants no tools or approval rights. */
    instructions: string;
    requiredToolNames: string[];
    requirements: KJAgentCapabilityRequirement[];
}
export interface KJAgentCapabilityReference {
    readonly id: string;
    readonly version: string;
}
export interface KJAgentCapabilityLockEntry extends KJAgentCapabilityReference {
    /** Change detection only: not a cryptographic signature or publisher authentication. */
    readonly contentHash: string;
}
export interface KJResolvedAgentCapabilities {
    readonly lock: readonly KJAgentCapabilityLockEntry[];
    readonly instructions: string;
    readonly toolNames: readonly string[];
    readonly requirements: readonly (ReadonlyDeep<KJAgentCapabilityRequirement> & {
        readonly capabilityId: string;
        readonly capabilityVersion: string;
    })[];
}
/** Validate and detach untrusted JSON data. Hosts must separately decide whether to trust its guidance. */
export declare function validateAgentCapabilityManifest(input: unknown): ReadonlyDeep<KJAgentCapabilityManifest>;
/** An in-memory data registry. Version selection and project-lock persistence belong to the host. */
export declare class KJAgentCapabilityRegistry {
    #private;
    constructor({ toolApiVersion }?: {
        toolApiVersion?: number;
    });
    get toolApiVersion(): number;
    register(input: unknown): ReadonlyDeep<KJAgentCapabilityManifest>;
    list(): readonly ReadonlyDeep<KJAgentCapabilityManifest>[];
    /** Persist this JSON lock with the project; supplying new references is an explicit upgrade. */
    createLock(references: readonly KJAgentCapabilityReference[]): readonly KJAgentCapabilityLockEntry[];
    resolve({ lock, allowedToolNames }: {
        lock: readonly KJAgentCapabilityLockEntry[];
        allowedToolNames: readonly string[];
    }): KJResolvedAgentCapabilities;
}
