import type { KJDocument } from './document.js';
import type { KJRoadDesignInput } from './road-design.js';
import { type KJRoadDrawingOptions, type KJRoadDrawingResult } from './road-drawing.js';
import { type ReadonlyDeep } from './utils.js';
export interface KJAgentRoadDrawingInput extends KJRoadDesignInput {
    expectedRevision: number;
    drawingId: string;
    title: string;
    profileScale: KJRoadDrawingOptions['profileScale'];
    sectionScale: KJRoadDrawingOptions['sectionScale'];
    textHeight: number;
    sectionColumns: number;
    precision: number;
}
export interface KJAgentRoadDrawingProposal {
    commandArgs: {
        entities: (KJRoadDrawingResult['entities'][number] & {
            options: {
                id: string;
                ownerId: string;
            };
        })[];
        resources: KJRoadDrawingResult['resources'];
    };
    evidence: {
        drawingId: string;
        units: 'meter';
        expectedRevision: number;
        entityCount: number;
        /** Exact validated source parameters for host-managed recovery after approval. */
        designParameters: {
            input: KJRoadDesignInput;
            options: KJRoadDrawingOptions;
        };
        calculation: KJRoadDrawingResult['calculation'];
        frames: ReadonlyDeep<KJRoadDrawingResult['frames']>;
        bounds: ReadonlyDeep<KJRoadDrawingResult['bounds']>;
        projections: ReadonlyDeep<KJRoadDrawingResult['projections']>;
        limitations: readonly string[];
    };
}
/** Pure revision-bound proposal compilation. No commands, document writes, preview approval,
 * terrain inference, network requests, or automatic associative updates are performed here.
 * A trusted host must preview the full CREATEBATCH and require approval before executing it.
 */
export declare function buildAgentRoadDrawing(document: KJDocument, input: KJAgentRoadDrawingInput): ReadonlyDeep<KJAgentRoadDrawingProposal>;
