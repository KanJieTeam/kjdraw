import type { KJHatchPatternLine } from './hatch.js';
export type KJHatchCoveragePoint = readonly [number, number];
export type KJHatchCoverageReason = 'budget' | 'numeric-range' | 'numeric-boundary' | 'unsupported-dots' | 'unsupported-collinear-phase';
export interface KJHatchCoverageSample {
    /** null means unknown; it must not be rendered as a known empty or solid sample. */
    readonly covered: boolean | null;
    readonly limited: boolean;
    readonly work: number;
    readonly reason?: KJHatchCoverageReason;
}
export interface KJHatchStrokeCoverage {
    /** Point and stroke width share the pattern's coordinate system. Budget counts families and candidate dash cycles. */
    sample(point: KJHatchCoveragePoint, budget?: number): KJHatchCoverageSample;
}
/** Compile exact dash-lattice membership for finite-width, flat/butt-capped strokes.
 * This is a point sampler, not a vector simplification or an antialiasing algorithm.
 * Original row offsets and dash periods are retained by an integer change of basis.
 * Numerically uncertain boundaries, dots and unsupported collinear phases remain explicit.
 * No pixel buffer or document state is allocated or modified. */
export declare function createHatchStrokeCoverage(lines: readonly KJHatchPatternLine[], strokeWidth: number): KJHatchStrokeCoverage;
