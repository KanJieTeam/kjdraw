import { type ReadonlyDeep } from './utils.js';
import type { KJAgentToolDefinition } from './agent-tools.js';
export declare const KJDRAW_AGENT_CAPABILITY_SCHEMA = "com.kanjie.kjdraw.agent-capability";
/** Version 1 remains the default constant for source compatibility. */
export declare const KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION = 1;
export declare const KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION_V2 = 2;
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
export interface KJAgentCapabilityManifestBase {
    schema: typeof KJDRAW_AGENT_CAPABILITY_SCHEMA;
    id: string;
    name: string;
    version: string;
    toolApiVersion: number;
    /** Domain guidance explicitly trusted by the host; it grants no tools or approval rights. */
    instructions: string;
    requiredToolNames: string[];
    requirements: KJAgentCapabilityRequirement[];
}
export interface KJAgentCapabilityCandidatePredicate {
    fact: 'native-reference' | 'geometry-relation' | 'repeat-group' | 'spatial-cluster' | 'property';
    source: KJAgentCapabilityEvidenceSource;
    operator: 'exists' | 'equals' | 'at_least' | 'at_most' | 'all_resolved' | 'same_as' | 'within';
    compareTo?: KJAgentCapabilityEvidenceSource;
    relation?: string;
    value?: string | number | boolean | null;
}
export interface KJAgentCapabilityEvidenceSource {
    toolName: 'cad_query_topology';
    scope: 'seed' | 'related';
    path: 'entities[].ownerId' | 'entities[].layer.id' | 'entities[].nativeReferences.hatch.loops[].boundarySources' | 'entities[].nativeReferences.insert.blockRecordId' | 'entities[].nativeReferences.insert.typeCountSignature' | 'entities[].nativeReferences.insert.repeat.sameDefinitionInstanceCount' | 'entities[].nativeReferences.displayExtent.bounds';
}
export interface KJAgentCapabilityCandidateRule {
    id: string;
    candidateKind: string;
    seed: {
        entityTypes: string[];
    };
    predicates: KJAgentCapabilityCandidatePredicate[];
    evidenceCodes: string[];
    /** A declaration for downstream proposal/acceptance logic; it grants no mutation permission. */
    nonMatchPolicy?: 'preserve';
    confirmation: 'always' | 'when-ambiguous';
}
export type KJAgentCapabilityTemplatePlaceholder = '$candidate.seedIds' | '$candidate.relatedIds' | '$candidate.nonMatchingIds' | '$document.revision' | '$document.units';
/** JSON template data validated recursively against the selected tool schema at registration. */
export type KJAgentCapabilityTemplateValue = string | number | boolean | null | readonly unknown[] | Readonly<Record<string, unknown>>;
export interface KJAgentCapabilityAcceptanceAssertion {
    path: string;
    operator: 'equals' | 'at_least' | 'at_most' | 'is_true';
    expected: string | number | boolean | null;
}
export interface KJAgentCapabilityAcceptanceTemplate {
    id: string;
    description: string;
    toolName: string;
    input: Record<string, KJAgentCapabilityTemplateValue>;
    assertions: KJAgentCapabilityAcceptanceAssertion[];
}
export interface KJAgentCapabilityManifestV1 extends KJAgentCapabilityManifestBase {
    schemaVersion: typeof KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION;
}
export interface KJAgentCapabilityManifestV2 extends KJAgentCapabilityManifestBase {
    schemaVersion: typeof KJDRAW_AGENT_CAPABILITY_SCHEMA_VERSION_V2;
    candidateRules: KJAgentCapabilityCandidateRule[];
    acceptanceTemplates: KJAgentCapabilityAcceptanceTemplate[];
}
export type KJAgentCapabilityManifest = KJAgentCapabilityManifestV1 | KJAgentCapabilityManifestV2;
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
    readonly candidateRules: readonly (ReadonlyDeep<KJAgentCapabilityCandidateRule> & {
        readonly capabilityId: string;
        readonly capabilityVersion: string;
    })[];
    readonly acceptanceTemplates: readonly (ReadonlyDeep<KJAgentCapabilityAcceptanceTemplate> & {
        readonly capabilityId: string;
        readonly capabilityVersion: string;
    })[];
}
/** Validate and detach untrusted JSON data. Hosts must separately decide whether to trust its guidance. */
export declare function validateAgentCapabilityManifest(input: unknown, { toolDefinitions }?: {
    toolDefinitions?: readonly KJAgentToolDefinition[];
}): ReadonlyDeep<KJAgentCapabilityManifest>;
/** An in-memory data registry. Version selection and project-lock persistence belong to the host. */
export declare class KJAgentCapabilityRegistry {
    #private;
    constructor({ toolApiVersion, toolDefinitions }?: {
        toolApiVersion?: number;
        toolDefinitions?: readonly KJAgentToolDefinition[];
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
