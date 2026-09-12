import { type KJHatchCoverageReason } from './geometry/hatch-coverage.js';
import { type KJEntityGrip } from './grips.js';
import { type KJBoxSelectionMode } from './selection-geometry.js';
import type { KJDocument } from './document.js';
import type { KJReadonlyObjectRecord } from './schema.js';
export type KJCanvasTheme = 'dark' | 'light';
export interface KJCanvasRendererOptions {
    document?: KJDocument | null;
    spaceId?: string | null;
    theme?: KJCanvasTheme;
    grid?: boolean;
    pixelRatio?: number;
    padding?: number;
    background?: string;
    selectionColor?: string;
    showLineweights?: boolean;
    sceneProvider?: KJCanvasSceneProvider | null;
}
export interface KJCanvasSceneQuery {
    document: KJDocument;
    spaceId: string;
    bounds?: readonly [number, number, number, number];
}
/** Replaceable scene-query seam for spatial indexes, workers or streamed tiles. */
export interface KJCanvasSceneProvider {
    listEntities(query: KJCanvasSceneQuery): ReadonlyArray<KJReadonlyObjectRecord>;
    hitCandidates?(query: KJCanvasSceneQuery & {
        point: Point2;
        radius: number;
    }): ReadonlyArray<KJReadonlyObjectRecord>;
}
export interface KJCanvasCamera {
    centerX: number;
    centerY: number;
    scale: number;
}
export interface KJCanvasRenderReport {
    viewportDiagnostics?: readonly KJCanvasViewportDiagnostic[];
    hatchDiagnostics?: readonly {
        entityId: string;
        reason: 'budget' | 'unsupported-pattern' | 'unsupported-boundary';
        samplingReason?: KJHatchCoverageReason | 'pixel-budget' | 'canvas-unavailable';
    }[];
    total: number;
    culled: number;
    detailCulled: number;
    overviewEntities: number;
    overviewPixels: number;
    rendered: number;
    approximated: number;
    hidden: number;
    unsupported: number;
    approximateTypes: readonly string[];
    unsupportedTypes: readonly string[];
    width: number;
    height: number;
    scale: number;
}
export interface KJCanvasViewportDiagnostic {
    entityId: string;
    rendered: number;
    hidden: number;
    approximated: number;
    unsupported: number;
    reason?: 'invalid-view' | 'unsupported-view' | 'not-paper-space' | 'budget';
}
export interface KJCanvasHit {
    entity: KJReadonlyObjectRecord;
    distance: number;
    point: readonly [number, number, number];
}
export interface KJCanvasSelectionOptions {
    includeLocked?: boolean;
}
export interface KJCanvasBoxSelectionOptions extends KJCanvasSelectionOptions {
    mode?: KJBoxSelectionMode;
}
export interface KJCanvasPreviewEntity {
    type: string;
    payload: Readonly<Record<string, unknown>>;
}
export interface KJCanvasPreviewResource {
    readonly id: string;
    readonly payload: Readonly<Record<string, unknown>>;
}
type Point2 = readonly [number, number];
/** AutoCAD Color Index projection including the 24 hue ramps and gray tail. */
export declare function aciColor(input: unknown, theme?: KJCanvasTheme): string;
/**
 * Dependency-free Canvas 2D projection for KJDocument.
 *
 * The renderer never owns or mutates drawing truth. Applications can replace it
 * with WebGL/WebGPU while keeping the exact same document and command contract.
 */
export declare class KJCanvasRenderer {
    #private;
    readonly canvas: HTMLCanvasElement;
    readonly context: CanvasRenderingContext2D;
    readonly camera: KJCanvasCamera;
    constructor(canvas: HTMLCanvasElement, options?: KJCanvasRendererOptions);
    get document(): KJDocument | null;
    get spaceId(): string | null;
    get theme(): KJCanvasTheme;
    get grid(): boolean;
    get selection(): readonly string[];
    get report(): Readonly<KJCanvasRenderReport>;
    setDocument(document: KJDocument | null): this;
    setTheme(theme: KJCanvasTheme): this;
    setGrid(enabled: boolean): this;
    setSelection(ids?: readonly string[]): this;
    setSpace(spaceId: string | null): this;
    setSceneProvider(provider: KJCanvasSceneProvider | null): this;
    resize(width?: number, height?: number): this;
    worldToScreen(input: Point2): Point2;
    screenToWorld(input: Point2): Point2;
    panBy(screenDx: number, screenDy: number): this;
    zoomAt(factor: number, screenPoint?: Point2): this;
    fit(): this;
    hitTest(screenPoint: Point2, tolerancePixels?: number, options?: KJCanvasSelectionOptions): KJCanvasHit | null;
    /** Screen-coordinate box query. Left to right defaults to window; right to left to crossing. */
    selectBox(first: Point2, second: Point2, options?: KJCanvasBoxSelectionOptions): readonly string[];
    selectFence(points: readonly Point2[], options?: KJCanvasSelectionOptions): readonly string[];
    selectAll(options?: KJCanvasSelectionOptions): readonly string[];
    /** Returns editable model-space handles without changing selection or document history. */
    getGrips(ids?: readonly string[]): readonly KJEntityGrip[];
    hitGrip(screenPoint: Point2, tolerancePixels?: number): KJEntityGrip | null;
    /** Optional handle overlay; render() clears it, leaving inspect/read-only hosts in control. */
    drawGrips(hoverId?: string): this;
    render(): Readonly<KJCanvasRenderReport>;
    drawPreview(entities: readonly KJCanvasPreviewEntity[], color?: string, offset?: Point2, resources?: readonly KJCanvasPreviewResource[]): this;
    dispose(): void;
}
export {};
