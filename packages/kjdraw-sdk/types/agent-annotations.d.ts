import type { KJDocument } from './document.js';
import type { KJObjectPayload } from './schema.js';
import { type ReadonlyDeep } from './utils.js';
export interface KJAnnotationPoint {
    x: number;
    y: number;
}
export interface KJAnnotationReference {
    source: 'document' | 'proposal';
    id: string;
}
export interface KJAnnotationPointReference extends KJAnnotationReference {
    feature: 'start' | 'end' | 'center' | 'vertex' | 'left' | 'right' | 'top' | 'bottom';
    /** Required only for vertex references; zero based. */
    vertexIndex?: number;
}
export interface KJAgentTextAnnotation {
    text: string;
    position: KJAnnotationPoint;
    height: number;
    rotationDegrees: number;
}
export type KJAgentDimensionAnnotation = {
    type: 'ALIGNED';
    from: KJAnnotationPointReference;
    to: KJAnnotationPointReference;
    position: KJAnnotationPoint;
    height: number;
} | {
    type: 'ROTATED';
    from: KJAnnotationPointReference;
    to: KJAnnotationPointReference;
    position: KJAnnotationPoint;
    height: number;
    rotationDegrees: number;
} | {
    type: 'RADIUS';
    source: KJAnnotationReference;
    directionDegrees: number;
    position: KJAnnotationPoint;
    height: number;
} | {
    type: 'DIAMETER';
    source: KJAnnotationReference;
    directionDegrees: number;
    position: KJAnnotationPoint;
    height: number;
} | {
    type: 'ANGULAR_3_POINT';
    center: KJAnnotationPointReference;
    first: KJAnnotationPointReference;
    second: KJAnnotationPointReference;
    position: KJAnnotationPoint;
    height: number;
};
export interface KJAgentAnnotationInput {
    expectedRevision: number;
    units: string;
    texts: readonly KJAgentTextAnnotation[];
    dimensions: readonly KJAgentDimensionAnnotation[];
}
export interface KJAnnotationEntitySpec {
    type: string;
    payload: KJObjectPayload;
    options: {
        id: string;
        ownerId: string;
    };
}
export interface KJAgentAnnotationOptions {
    /** Trusted host mapping of semantic proposal references to the actual base entities being proposed. */
    baseEntities?: Readonly<Record<string, ReadonlyDeep<KJAnnotationEntitySpec>>>;
}
/** Compile revision-bound native annotations with persistent native point associations. */
export declare function buildAgentAnnotationEntities(document: KJDocument, input: KJAgentAnnotationInput, options?: KJAgentAnnotationOptions): readonly ReadonlyDeep<KJAnnotationEntitySpec>[];
