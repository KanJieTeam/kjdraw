import type { KJDocument } from './document.js';
import type { KJRoadDesignInput } from './road-design.js';
import { type KJRoadDrawingOptions, type KJRoadDrawingResult } from './road-drawing.js';
import { type ReadonlyDeep } from './utils.js';
export declare const KJDRAW_ROAD_RECIPE_SCHEMA = "com.kanjie.kjdraw.road-drawing-recipe";
export interface KJRoadDrawingRecipe {
    schema: typeof KJDRAW_ROAD_RECIPE_SCHEMA;
    schemaVersion: 1;
    /** Exact compiler contract. Unknown versions require an explicit future migration. */
    compilerVersion: 1;
    documentId: string;
    input: KJRoadDesignInput;
    options: KJRoadDrawingOptions;
}
export interface KJRestoredRoadDrawingRecipe {
    recipe: ReadonlyDeep<KJRoadDrawingRecipe>;
    drawing: ReadonlyDeep<KJRoadDrawingResult>;
    documentId: string;
    /** The source revision actually validated, suitable for the next explicit update. */
    revision: number;
}
/**
 * Recompile a persisted road recipe and validate all generated objects on a detached fork.
 * The source document, its history, project metadata and files are never modified.
 * This verifies consistency, not authorship, engineering certification or permission to edit.
 */
export declare function restoreRoadDrawingRecipe(document: KJDocument, input: unknown): Promise<ReadonlyDeep<KJRestoredRoadDrawingRecipe>>;
/**
 * Create a validated, immutable recipe after an approved road drawing exists in the document.
 * The host explicitly stores it in project metadata and marks that project dirty before saving.
 * Parameters alone do not change geometry; later changes still require explicit revision apply.
 */
export declare function createRoadDrawingRecipe(document: KJDocument, input: ReadonlyDeep<KJRoadDesignInput>, options: ReadonlyDeep<KJRoadDrawingOptions>): Promise<ReadonlyDeep<KJRoadDrawingRecipe>>;
