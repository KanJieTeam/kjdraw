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
/**
 * Expects the caller's model-space primitive entities. It does not copy,
 * convert, or infer annotations, side views, material, or title blocks.
 */
export declare function detectMechanicalBearingSeatEndView(entities: readonly KJMechanicalTopologyEntity[]): KJMechanicalBearingSeatDetection;
