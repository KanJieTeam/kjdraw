import { type ReadonlyDeep } from './utils.js';
export type KJRoadPoint = readonly [number, number];
export interface KJRoadDesignInput {
    units: 'meter';
    startStation: number;
    alignment: readonly KJRoadPoint[];
    profile: readonly {
        station: number;
        elevation: number;
    }[];
    /** Offsets increase toward the left when looking along increasing station. */
    sections: readonly {
        station: number;
        ground: readonly KJRoadPoint[];
    }[];
    /** Crossfall is signed outward rise/run on each side; negative values form a crown. */
    pavement: {
        leftWidth: number;
        rightWidth: number;
        leftCrossfall: number;
        rightCrossfall: number;
    };
    slopes: {
        cutHtoV: number;
        fillHtoV: number;
    };
}
export interface KJRoadAlignmentSegment {
    startStation: number;
    endStation: number;
    start: KJRoadPoint;
    end: KJRoadPoint;
    length: number;
    tangent: KJRoadPoint;
}
export interface KJRoadSectionResult {
    station: number;
    center: KJRoadPoint;
    tangent: KJRoadPoint;
    designElevation: number;
    groundCenterElevation: number;
    longitudinalGrade: number;
    ground: KJRoadPoint[];
    pavement: KJRoadPoint[];
    design: KJRoadPoint[];
    worldDesign: [number, number, number][];
    daylight: {
        left: {
            point: KJRoadPoint;
            mode: 'cut' | 'fill' | 'none';
        };
        right: {
            point: KJRoadPoint;
            mode: 'cut' | 'fill' | 'none';
        };
    };
    areas: {
        cut: number;
        fill: number;
    };
    strips: {
        fromOffset: number;
        toOffset: number;
        cutArea: number;
        fillArea: number;
    }[];
}
export interface KJRoadDesignResult {
    units: 'meter';
    areaUnits: 'square-meter';
    volumeUnits: 'cubic-meter';
    startStation: number;
    endStation: number;
    length: number;
    alignment: KJRoadAlignmentSegment[];
    grades: {
        fromStation: number;
        toStation: number;
        fromElevation: number;
        toElevation: number;
        grade: number;
    }[];
    sections: KJRoadSectionResult[];
    volumeMethod: 'average-end-area';
    volumeRange: KJRoadPoint;
    intervals: {
        fromStation: number;
        toStation: number;
        length: number;
        cutVolume: number;
        fillVolume: number;
    }[];
    totalVolume: {
        cut: number;
        fill: number;
    };
    limitations: readonly string[];
}
/** Piecewise-linear native engineering calculation, not a road-standard or survey certification.
 * Each side must have one discrete daylight intersection over the supplied outward ground extent.
 * Profile/alignment knots use their outgoing slope/tangent, except at the terminal point.
 * End-area volumes are approximations: https://highways.dot.gov/federal-lands/pddm/dpg/earthwork-design
 * There is no cross-section interpolation, terrain extrapolation, road structure deduction,
 * shrink/swell factor, horizontal/vertical curve, overlap or curvature-volume correction.
 * The supplied pavement surface is also the earthwork comparison surface.
 */
export declare function computeRoadDesign(input: KJRoadDesignInput): ReadonlyDeep<KJRoadDesignResult>;
