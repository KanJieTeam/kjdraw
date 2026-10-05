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
    set: Partial<Pick<KJGeologyStratum, 'name' | 'lithology' | 'description' | 'code'>>;
}
/** Existing intervals only. No additions, removals, boundary or identity edits. */
export interface KJGeologyStratumChanges {
    update: readonly KJGeologyStratumChange[];
}
/** Resolve every target against the SAME BEFORE array. Only the four explicit
 * textual/classification fields change; order, identity, measured boundaries,
 * grouping, notation, patterns, provenance and all optional presence remain.
 * The existing source compiler still validates final source/layout/topology.
 */
export declare function applyGeologyStratumChanges(before: ReadonlyDeep<readonly KJGeologyStratum[]>, changes: KJGeologyStratumChanges): KJGeologyStratum[];
