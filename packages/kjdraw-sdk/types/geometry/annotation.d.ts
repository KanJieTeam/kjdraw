type Point = readonly [number, number];
export interface KJDimensionProjection {
    lines: Array<readonly [Point, Point]>;
    arrows: Point[][];
    label: {
        position: Point;
        text: string;
        height: number;
        rotation: number;
    };
    measurement: number;
}
/** Project supported native DIMENSION semantics into model-space annotation geometry. */
export declare function projectDimension(payload: Readonly<Record<string, unknown>>, style?: Readonly<Record<string, unknown>>): KJDimensionProjection | null;
export {};
