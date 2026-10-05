import type { KJGeologyStratum } from './geology-engineering.js';
import type { ReadonlyDeep } from './utils.js';
/** Exact identity and measured boundaries from one immutable BEFORE source. */
export interface KJGeologyStratumTarget {
    intervalId: string;
    expectedTop: number;
    expectedBottom: number;
}
export interface KJGeologyStratumChange {
    target: KJGeologyStratumTarget;
    set: Partial<Pick<KJGeologyStratum, 'name' | 'lithology' | 'description' | 'code' | 'patternVisibility'>>;
}
/** Existing intervals only. No additions, removals, boundary or identity edits. */
export interface KJGeologyStratumChanges {
    update: readonly KJGeologyStratumChange[];
}
/** Resolve every target against the SAME BEFORE array. Only explicitly set
 * textual/classification fields or the filled/boundary-only display mode
 * change; order, identity, measured boundaries, grouping, notation, pattern
 * definitions, provenance and all other optional presence remain.
 * The existing source compiler still validates final source/layout/topology.
 */
export declare function applyGeologyStratumChanges(before: ReadonlyDeep<readonly KJGeologyStratum[]>, changes: KJGeologyStratumChanges): KJGeologyStratum[];
