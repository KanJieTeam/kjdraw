import type { KJAgentCapabilityCandidatePredicate, KJAgentCapabilityCandidateRule, KJAgentCapabilityEvidenceSource } from './agent-capabilities.js';
import { type ReadonlyDeep } from './utils.js';
type ResolvedRule = ReadonlyDeep<KJAgentCapabilityCandidateRule> & {
    readonly capabilityId: string;
    readonly capabilityVersion: string;
};
export interface KJAgentCapabilityCandidateEvaluationInput {
    candidateRules: readonly ResolvedRule[];
    topology: unknown;
    expectedRevision: number;
    expectedTolerance: number;
    units: string;
    seedIds: readonly string[];
    relatedIds: readonly string[];
    maxBytes: number;
}
export interface KJAgentCapabilityPredicateEvidence {
    predicateIndex: number;
    fact: KJAgentCapabilityCandidatePredicate['fact'];
    operator: KJAgentCapabilityCandidatePredicate['operator'];
    source: ReadonlyDeep<KJAgentCapabilityEvidenceSource>;
    compareTo?: ReadonlyDeep<KJAgentCapabilityEvidenceSource>;
    relation?: string;
    passed: boolean;
    observed?: Readonly<Record<string, unknown>>;
    matchingRelatedIds?: readonly string[];
    nonMatchingIds?: readonly string[];
}
export interface KJAgentCapabilityCandidateEvidence {
    capabilityId: string;
    capabilityVersion: string;
    ruleId: string;
    seedId: string;
    passed: boolean;
    predicates: readonly ReadonlyDeep<KJAgentCapabilityPredicateEvidence>[];
}
export interface KJAgentCapabilityCandidate {
    capabilityId: string;
    capabilityVersion: string;
    ruleId: string;
    candidateKind: string;
    seedIds: readonly [string];
    relatedIds: readonly string[];
    evidenceCodes: readonly string[];
    nonMatchingIds: readonly string[];
    confirmationRequired: boolean;
}
export interface KJAgentCapabilityCandidateEvaluation {
    documentId: string;
    revision: number;
    units: string;
    candidates: readonly ReadonlyDeep<KJAgentCapabilityCandidate>[];
    evidence: readonly ReadonlyDeep<KJAgentCapabilityCandidateEvidence>[];
    nonMatchingIds: readonly string[];
    confirmationRequired: boolean;
    limits: Readonly<{
        maxRules: number;
        maxIds: number;
        maxEvaluations: number;
        evaluations: number;
        maxBytes: number;
    }>;
}
/** Evaluate locked declarative candidate rules against one exact topology query. This function never edits a document. */
export declare function evaluateAgentCapabilityCandidates(input: KJAgentCapabilityCandidateEvaluationInput): ReadonlyDeep<KJAgentCapabilityCandidateEvaluation>;
export {};
