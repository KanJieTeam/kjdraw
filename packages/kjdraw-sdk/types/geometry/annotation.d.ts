type Point = readonly [number, number];
export interface KJDimensionArcProjection {
    center: Point;
    radius: number;
    startAngle: number;
    endAngle: number;
}
export interface KJDimensionProjection {
    /** Circular arcs use CCW radians; endAngle is greater than startAngle. */
    arcs: KJDimensionArcProjection[];
    lines: Array<readonly [Point, Point]>;
    arrows: Point[][];
    label: {
        position: Point;
        text: string;
        height: number;
        rotation: number;
    };
    /** Angular dimensions use degrees; other dimensions use drawing length units. */
    measurement: number;
}
/** Project supported native DIMENSION semantics into model-space annotation geometry. */
export declare function projectDimension(payload: Readonly<Record<string, unknown>>, style?: Readonly<Record<string, unknown>>): KJDimensionProjection | null;
export {};
