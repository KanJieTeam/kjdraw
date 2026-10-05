import type { KJGeologyObservation } from './geology-engineering.js';
import { type ReadonlyDeep } from './utils.js';
/** Exact identity in the source snapshot, not a fuzzy label or future depth. */
export interface KJGeologyObservationTarget {
    kind: KJGeologyObservation['kind'];
    id: string;
    expectedDepth: number;
}
export type KJGeologyObservationClearField = 'displayLabel' | 'sampleMarker' | 'rangeTop' | 'rangeBottom';
export interface KJGeologyObservationChange {
    target: KJGeologyObservationTarget;
    set?: Partial<Pick<KJGeologyObservation, 'depth' | 'value' | 'displayLabel' | 'sampleMarker' | 'rangeTop' | 'rangeBottom'>>;
    clearFields?: readonly KJGeologyObservationClearField[];
}
/** Additive tool input. Existing observations arrays remain full replacements. */
export interface KJGeologyObservationChanges {
    add?: readonly KJGeologyObservation[];
    update?: readonly KJGeologyObservationChange[];
    remove?: readonly KJGeologyObservationTarget[];
}
/** Called only after the closed agent schema validates every field. Resolves
 * all targets against one immutable source snapshot, then lets the existing
 * source compiler enforce depth, range, layout and measurement invariants.
 * Nothing here infers missing records, moves range endpoints or converts units.
 */
export declare function applyGeologyObservationChanges(before: ReadonlyDeep<readonly KJGeologyObservation[]> | undefined, changes: KJGeologyObservationChanges): KJGeologyObservation[];
