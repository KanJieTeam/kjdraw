import type { KJGeologySectionInput } from './geology-engineering.js';
import type { ReadonlyDeep } from './utils.js';
/** Exact source interval identities, never legacy codes, indices or labels. */
export interface KJGeologyIntervalLink {
    fromHoleId: string;
    toHoleId: string;
    fromIntervalId: string;
    toIntervalId: string;
}
export interface KJGeologyUncorrelatedOccurrence {
    holeId: string;
    adjacentHoleId: string;
    intervalId: string;
}
export interface KJGeologySectionLinkChanges {
    correlations?: {
        add?: readonly KJGeologyIntervalLink[];
        remove?: readonly KJGeologyIntervalLink[];
    };
    uncorrelatedOccurrences?: {
        add?: readonly KJGeologyUncorrelatedOccurrence[];
        remove?: readonly KJGeologyUncorrelatedOccurrence[];
    };
}
/** Add/remove resolves against ONE immutable BEFORE source. Surviving native
 * declarations retain order and every unrequested field; additions append in
 * caller order. Both endpoints must have explicitly complete final coverage.
 * The existing drawing compiler remains authoritative for strata compatibility,
 * branching/crossing, layout, HATCH, resource and geometry validation.
 */
export declare function applyGeologySectionLinkChanges(before: ReadonlyDeep<KJGeologySectionInput>, changes: KJGeologySectionLinkChanges): KJGeologySectionInput;
