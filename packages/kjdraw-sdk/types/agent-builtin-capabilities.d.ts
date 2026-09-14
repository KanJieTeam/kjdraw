import { KJAgentCapabilityRegistry, type KJAgentCapabilityManifestV1, type KJAgentCapabilityReference } from './agent-capabilities.js';
import { type ReadonlyDeep } from './utils.js';
export type KJDrawBuiltinCapabilityFamily = 'core-workflow' | 'annotated-drawing' | 'pattern-layout' | 'component-library' | 'parametric-design' | 'manufacturing' | 'architecture' | 'site' | 'road' | 'data-visualization';
export interface KJDrawBuiltinCapabilityDescriptor {
    id: string;
    version: string;
    family: KJDrawBuiltinCapabilityFamily;
    name: {
        en: string;
        zhCN: string;
    };
    summary: {
        en: string;
        zhCN: string;
    };
    units: ('millimeter' | 'meter')[];
    examples: {
        en: string;
        zhCN: string;
    }[];
    /** Descriptive review topics, not executed checks or acceptance receipts. */
    verification: string[];
    manifest: KJAgentCapabilityManifestV1;
}
export declare const KJDRAW_BUILTIN_AGENT_CAPABILITIES: readonly ReadonlyDeep<KJDrawBuiltinCapabilityDescriptor>[];
export declare function createKJDrawBuiltinCapabilityRegistry(): KJAgentCapabilityRegistry;
export declare function matchKJDrawBuiltinCapability(input: {
    prompt: string;
    units: string;
    entityCount: number;
    hasRoadAsset?: boolean;
}): ReadonlyDeep<KJDrawBuiltinCapabilityDescriptor> | null;
export declare function capabilityReference(descriptor: ReadonlyDeep<KJDrawBuiltinCapabilityDescriptor>): KJAgentCapabilityReference;
