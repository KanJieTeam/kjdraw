import type { KJDocument } from './document.js';
import type { KJGeologyColumnInput, KJGeologySectionInput } from './geology-engineering.js';
import type { KJKnowledgeCompileResult } from './knowledge-compiler.js';
import type { KJObjectRecord } from './schema.js';
import { type ReadonlyDeep } from './utils.js';
export type KJGeologyDrawingSource = {
    kind: 'column';
    input: KJGeologyColumnInput;
} | {
    kind: 'section';
    input: KJGeologySectionInput;
};
/** Host-owned source facts, not facts inferred from imported CAD annotations. */
export interface KJGeologyDrawingRecipe {
    schema: 'com.kanjie.kjdraw.geology-drawing-recipe';
    version: 1;
    compilerVersion: 1;
    documentId: string;
    drawingId: string;
    source: KJGeologyDrawingSource;
    entityIds: string[];
    resourceRoot: string;
    textStyleId: string;
}
export interface KJGeologyDrawingRevisionOptions {
    expectedRevision: number;
}
/** Read-only diagnostic, never approval or authority to overwrite manual edits. */
export interface KJGeologyDrawingInspection {
    documentId: string;
    revision: number;
    drawingId: string;
    recipe: ReadonlyDeep<KJGeologyDrawingRecipe>;
    sourceGeometryConsistent: boolean;
    conflicts: {
        kind: 'resource' | 'entity';
        id: string;
        reason: 'missing' | 'owner-membership' | 'record-changed';
    }[];
    conflictTypes: {
        id: string;
        generatedType: string;
        actualType: string | null;
    }[];
}
export interface KJGeologyDrawingRevision {
    recipe: ReadonlyDeep<KJGeologyDrawingRecipe>;
    previousRevision: number;
    revision: number;
    createdIds: string[];
    removedIds: string[];
    unchangedIds: string[];
    before: KJObjectRecord[];
    after: KJObjectRecord[];
    evidence: ReadonlyDeep<KJKnowledgeCompileResult['evidence']>;
}
/** Bind supplied source facts to an existing, exactly matching compiler drawing. */
export declare function createGeologyDrawingRecipe(document: KJDocument, source: KJGeologyDrawingSource): ReadonlyDeep<KJGeologyDrawingRecipe>;
/** Explicit host registration. The source data travels with KJD and undo history. */
export declare function registerGeologyDrawingRecipe(document: KJDocument, source: KJGeologyDrawingSource, options: KJGeologyDrawingRevisionOptions): Promise<ReadonlyDeep<KJGeologyDrawingRecipe>>;
export declare function readGeologyDrawingRecipe(document: KJDocument, drawingId: string): ReadonlyDeep<KJGeologyDrawingRecipe>;
/** Inspect all generated conflicts without treating unrelated manual CAD as source.
 * Malformed/foreign recipes still reject. Revision preparation retains its strict
 * validator and rejects drift even after this read-only diagnostic succeeds. */
export declare function inspectGeologyDrawingRecipe(document: KJDocument, drawingId: string, options: KJGeologyDrawingRevisionOptions): ReadonlyDeep<KJGeologyDrawingInspection>;
/** Compile a data revision without changing the document or approving anything. */
export declare function prepareGeologyDrawingRevision(document: KJDocument, previous: ReadonlyDeep<KJGeologyDrawingRecipe>, next: KJGeologyDrawingSource, options: KJGeologyDrawingRevisionOptions): ReadonlyDeep<KJGeologyDrawingRevision>;
/** One source-and-geometry transaction, including native HATCH and undo history. */
export declare function applyGeologyDrawingRevision(document: KJDocument, previous: ReadonlyDeep<KJGeologyDrawingRecipe>, next: KJGeologyDrawingSource, options: KJGeologyDrawingRevisionOptions): Promise<ReadonlyDeep<KJGeologyDrawingRevision>>;
