import { type KJDimensionPointAssociation } from './dimension-associations.js';
import type { KJStandardEntityType } from './constants.js';
import type { KJObjectPayload, KJObjectSpec } from './schema.js';
export type KJDraftPoint = readonly [number, number];
export type KJDraftPointReference = Omit<KJDimensionPointAssociation, 'definitionPointIndex'>;
export type KJDraftTool = 'line' | 'polyline' | 'circle' | 'arc' | 'ellipse' | 'rectangle' | 'polygon' | 'point' | 'ray' | 'xline' | 'spline' | 'hatch' | 'dimension';
export type KJDraftCircleMode = 'center-radius' | '2-point' | '3-point';
export type KJDraftArcMode = 'center-start-end' | '3-point';
export type KJDraftEllipseMode = 'full' | 'arc';
export type KJDraftDimensionType = 'ALIGNED' | 'ROTATED' | 'RADIUS' | 'DIAMETER' | 'ANGULAR_3_POINT';
export type KJDraftStatus = 'collecting' | 'complete' | 'cancelled';
export type KJDraftPointRole = 'start' | 'end' | 'vertex' | 'position' | 'origin' | 'directionPoint' | 'center' | 'radiusPoint' | 'diameterPoint1' | 'diameterPoint2' | 'throughPoint' | 'majorAxisPoint' | 'minorAxisPoint' | 'ellipseArcStart' | 'ellipseArcEnd' | 'firstCorner' | 'oppositeCorner' | 'controlPoint' | 'boundaryPoint' | 'extensionOrigin1' | 'extensionOrigin2' | 'placement' | 'oppositePoint' | 'pointOnCircle' | 'angleVertex' | 'firstRayPoint' | 'secondRayPoint' | 'angularPlacement';
export interface KJDraftEntitySpec {
    type: KJStandardEntityType;
    payload: KJObjectPayload;
    options?: KJObjectSpec;
}
export interface KJDraftingOptions {
    circleMode?: KJDraftCircleMode;
    arcMode?: KJDraftArcMode;
    ellipseMode?: KJDraftEllipseMode;
    sides?: number;
    splineDegree?: number;
    dimensionType?: KJDraftDimensionType;
    rotation?: number;
    textPosition?: KJDraftPoint;
    textOverride?: string | null;
    textHeight?: number;
    styleName?: string;
    patternName?: string;
    patternScale?: number;
    patternAngle?: number;
    solid?: boolean;
    payload?: KJObjectPayload;
    entityOptions?: KJObjectSpec;
    tolerance?: number;
}
export interface KJDraftState {
    tool: KJDraftTool;
    status: KJDraftStatus;
    points: readonly KJDraftPoint[];
    minimumPoints: number;
    maximumPoints: number | null;
    nextPoint: KJDraftPointRole | null;
    canFinish: boolean;
    canClose: boolean;
}
/** Constrain a pointer-derived point to the dominant axis through an exact base point. */
export declare function constrainOrthogonalDraftPoint(value: KJDraftPoint, base: KJDraftPoint): KJDraftPoint;
/** Parse CAD coordinates. Polar angles use degrees and increase counter-clockwise. */
export declare function parseDraftCoordinate(input: string, relativeBase?: KJDraftPoint): KJDraftPoint;
export declare class KJDraftingSession {
    #private;
    readonly tool: KJDraftTool;
    constructor(tool: KJDraftTool, options?: KJDraftingOptions);
    get points(): readonly KJDraftPoint[];
    get pointReferences(): readonly (Readonly<KJDraftPointReference> | null)[];
    get state(): KJDraftState;
    addPoint(value: KJDraftPoint, reference?: KJDraftPointReference | null): KJDraftEntitySpec | null;
    addCoordinate(input: string, relativeBase?: KJDraftPoint | undefined): KJDraftEntitySpec | null;
    preview(cursor?: KJDraftPoint): KJDraftEntitySpec | null;
    finish(): KJDraftEntitySpec;
    close(): KJDraftEntitySpec;
    undoPoint(): KJDraftPoint | null;
    cancel(): void;
}
export declare function createDraftingSession(tool: KJDraftTool, options?: KJDraftingOptions): KJDraftingSession;
