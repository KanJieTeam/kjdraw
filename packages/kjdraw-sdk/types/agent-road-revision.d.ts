import type { KJDocument } from './document.js';
import type { KJRoadDesignInput } from './road-design.js';
import { type KJRoadDrawingResult } from './road-drawing.js';
import { type KJRoadDrawingRecipe, type KJRestoredRoadDrawingRecipe } from './road-drawing-recipe.js';
import type { KJAgentGeometryPreview } from './agent-preview.js';
import { type ReadonlyDeep } from './utils.js';
export interface KJAgentRoadRevisionInput {
    expectedRevision: number;
    units: 'meter';
    drawingId: string;
    leftWidthDelta: number;
    rightWidthDelta: number;
    /** Uniform additive offset to all design profile elevations, in meters. */
    elevationDelta: number;
}
export interface KJAgentRoadRevisionProposal {
    previous: ReadonlyDeep<KJRoadDrawingResult>;
    next: ReadonlyDeep<KJRoadDrawingResult>;
    recipe: ReadonlyDeep<KJRoadDrawingRecipe>;
    preview: KJAgentGeometryPreview;
    evidence: {
        drawingId: string;
        units: 'meter';
        expectedRevision: number;
        entityCount: number;
        designParameters: {
            input: KJRoadDesignInput;
            options: KJRoadDrawingRecipe['options'];
        };
        previousDesignParameters: {
            input: KJRoadDesignInput;
            options: KJRoadDrawingRecipe['options'];
        };
        changes: KJAgentRoadRevisionInput;
        changedCounts: {
            updated: number;
            created: number;
            removed: number;
            unchanged: number;
        };
        previousTotalVolume: KJRoadDrawingResult['calculation']['totalVolume'];
        totalVolume: KJRoadDrawingResult['calculation']['totalVolume'];
        calculation: KJRoadDrawingResult['calculation'];
        frames: KJRoadDrawingResult['frames'];
        bounds: KJRoadDrawingResult['bounds'];
        projections: KJRoadDrawingResult['projections'];
        limitations: readonly string[];
    };
}
/** Host recipe must already have been restored at this exact document revision. The
 * detached revalidation below also rejects manual edits and forged compiled output. */
export declare function buildAgentRoadRevision(document: KJDocument, input: KJAgentRoadRevisionInput, registered: ReadonlyDeep<KJRestoredRoadDrawingRecipe>): Promise<ReadonlyDeep<KJAgentRoadRevisionProposal>>;
