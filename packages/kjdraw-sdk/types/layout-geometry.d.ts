import type { KJDxfPlotSettings } from './plot-settings.js';
export interface KJDxfLayoutRange2 {
    minimum: readonly [number, number];
    maximum: readonly [number, number];
}
export interface KJDxfLayoutRange3 {
    minimum: readonly [number, number, number];
    maximum: readonly [number, number, number];
}
/** Native AcDbLayout limits and extents. Null extents are emitted as the
 * official unset sentinels instead of invented zero-size geometry. */
export interface KJDxfLayoutGeometry {
    limits: KJDxfLayoutRange2 | null;
    extents: KJDxfLayoutRange3 | null;
}
export declare function validateDxfLayoutGeometry(value: unknown): asserts value is KJDxfLayoutGeometry;
/** Match ezdxf/AcDbLayout paper-limit semantics. DXF paper sizes, margins and
 * plot origins are stored in millimeters; limits use the selected paper unit. */
export declare function paperLimitsFromPlotSettings(settings: KJDxfPlotSettings): KJDxfLayoutRange2;
