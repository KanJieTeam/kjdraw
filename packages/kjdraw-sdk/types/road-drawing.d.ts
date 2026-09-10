import { type KJRoadDesignInput, type KJRoadDesignResult, type KJRoadPoint } from './road-design.js';
import { type ReadonlyDeep } from './utils.js';
import type { KJObjectPayload } from './schema.js';
export type KJRoadDrawingBounds = [number, number, number, number];
export interface KJRoadDrawingOptions {
    drawingId: string;
    title: string;
    /** Drawing XY units per physical metre. These are diagram transformations, not paper scales. */
    profileScale: {
        horizontal: number;
        vertical: number;
    };
    sectionScale: {
        horizontal: number;
        vertical: number;
    };
    /** Lower-left corner of the profile frame; never translates the true-XY plan. */
    origin?: KJRoadPoint;
    textHeight?: number;
    sectionColumns?: number;
    precision?: number;
    maxEntities?: number;
}
export interface KJRoadDrawingEntity {
    key: string;
    type: 'LINE' | 'LWPOLYLINE' | 'TEXT';
    payload: KJObjectPayload;
    options: {
        id: string;
    };
}
export interface KJRoadDrawingResult {
    units: 'meter';
    calculation: ReadonlyDeep<KJRoadDesignResult>;
    entities: KJRoadDrawingEntity[];
    resources: {
        linetypes: {
            id: string;
            name: string;
            pattern: number[];
        }[];
        layers: {
            id: string;
            name: string;
            color: number;
            linetypeId: string;
            lineweight: number;
        }[];
    };
    frames: {
        key: 'plan' | 'profile-tables' | 'sections';
        bounds: KJRoadDrawingBounds;
    }[];
    bounds: KJRoadDrawingBounds;
    projections: {
        plan: {
            coordinateSystem: 'native-world-XY';
            horizontal: 1;
            vertical: 1;
        };
        profile: {
            horizontal: number;
            vertical: number;
            stationDatum: number;
            elevationDatum: number;
            origin: KJRoadPoint;
        };
        sections: {
            station: number;
            horizontal: number;
            vertical: number;
            offsetDatum: number;
            elevationDatum: number;
            origin: KJRoadPoint;
        }[];
    };
    /** Stable keys support host-managed comparisons; this function does not mutate or associate a document. */
    limitations: readonly string[];
}
/** Compile computed road engineering data into three editable model-space drawing frames.
 * The plan uses the supplied world XY unchanged. Longitudinal/cross-section diagrams use
 * explicit, labelled projections; their stretched lengths must not be read as native dimensions.
 * Ground lines and quantities derive only from computeRoadDesign, with no terrain invention.
 * Resources and IDs are deterministic for a drawingId. A host must reconcile existing IDs on
 * subsequent builds; replaying CREATEBATCH is not an associative-update mechanism.
 */
export declare function buildRoadDrawing(input: KJRoadDesignInput, options: KJRoadDrawingOptions): ReadonlyDeep<KJRoadDrawingResult>;
