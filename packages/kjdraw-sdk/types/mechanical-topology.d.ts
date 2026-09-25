/**
 * Recognize an end-view *topology*, not a complete manufacturing drawing.
 * This intentionally abstains when dimensions or ownership are ambiguous;
 * recognition alone is never evidence of generative or 1:1 coverage.
 */
export interface KJMechanicalTopologyEntity {
    type: string;
    payload: Readonly<Record<string, unknown>>;
}
export interface KJMechanicalBearingSeatEndView {
    center: readonly [number, number];
    crownRadius: number;
    housingDiameter: number;
    boreDiameter: number;
    mountingHoleDiameter: number;
    mountingHoleSpacing: number;
}
export interface KJMechanicalBearingSeatDetection {
    status: 'match' | 'none' | 'ambiguous';
    candidates: readonly KJMechanicalBearingSeatEndView[];
}
/** A four-hole square pattern is a reusable feature, not a flange or a full sheet. */
export interface KJMechanicalFourHoleBoltCircle {
    center: readonly [number, number];
    pitchDiameter: number;
    holeDiameter: number;
    holeCenters: readonly (readonly [number, number])[];
}
export interface KJMechanicalFourHoleBoltCircleDetection {
    status: 'match' | 'none' | 'ambiguous';
    candidates: readonly KJMechanicalFourHoleBoltCircle[];
}
/**
 * Expects the caller's model-space primitive entities. It does not copy,
 * convert, or infer annotations, side views, material, or title blocks.
 */
export declare function detectMechanicalBearingSeatEndView(entities: readonly KJMechanicalTopologyEntity[]): KJMechanicalBearingSeatDetection;
/**
 * Finds exact square four-hole circle groups in a noisy model-space view.
 * An opposite pair fixes the centre and pitch radius; the perpendicular pair
 * must have the same radius and lie at the two rotated positions. Source
 * annotations, styles, construction circles and sheet ownership are not
 * inferred. The bounded search abstains on very dense drawings.
 */
export declare function detectMechanicalFourHoleBoltCircle(entities: readonly KJMechanicalTopologyEntity[]): KJMechanicalFourHoleBoltCircleDetection;
