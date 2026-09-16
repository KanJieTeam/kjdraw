import { type ReadonlyDeep } from './utils.js';
export type KJKnowledgeExpression = string | number | boolean | {
    get: string;
} | {
    op: 'add' | 'subtract' | 'multiply' | 'divide' | 'negate';
    args: KJKnowledgeExpression[];
} | {
    concat: KJKnowledgeExpression[];
} | {
    lookup: {
        value: KJKnowledgeExpression;
        cases: Record<string, KJKnowledgeExpression>;
        fallback?: KJKnowledgeExpression;
    };
};
export type KJKnowledgePointExpression = [KJKnowledgeExpression, KJKnowledgeExpression];
export type KJKnowledgeEmitOperation = {
    primitive: 'line';
    layer: string;
    start: KJKnowledgePointExpression;
    end: KJKnowledgePointExpression;
} | {
    primitive: 'polyline';
    layer: string;
    points: KJKnowledgePointExpression[];
    closed: boolean;
} | {
    primitive: 'rectangle';
    layer: string;
    origin: KJKnowledgePointExpression;
    size: KJKnowledgePointExpression;
} | {
    primitive: 'hatch-rectangle';
    layer: string;
    origin: KJKnowledgePointExpression;
    size: KJKnowledgePointExpression;
    patternName: KJKnowledgeExpression;
    patternScale: KJKnowledgeExpression;
    patternAngleDegrees: KJKnowledgeExpression;
} | {
    primitive: 'text';
    layer: string;
    position: KJKnowledgePointExpression;
    value: KJKnowledgeExpression;
    height: KJKnowledgeExpression;
    rotationDegrees?: KJKnowledgeExpression;
};
export interface KJKnowledgeProgramStep {
    select?: {
        relationKind: string;
        direction?: 'outgoing' | 'incoming';
        objectKind?: string;
        sortBy?: string;
    };
    continuity?: {
        startPath: string;
        endPath: string;
        first: KJKnowledgeExpression;
        final: KJKnowledgeExpression;
        tolerance?: number;
    };
    emit: KJKnowledgeEmitOperation[];
}
export interface KJKnowledgeDrawingProgram {
    version: '1.0.0';
    rootKind: string;
    layers: {
        name: string;
        color: number;
        lineweight: number;
    }[];
    steps: KJKnowledgeProgramStep[];
}
export interface KJKnowledgeCompileInput {
    pack: unknown;
    intent: unknown;
    templateId: string;
    rootObjectId: string;
    expectedRevision: number;
}
export interface KJKnowledgeCompileResult {
    commandArgs: {
        entities: {
            type: string;
            payload: Record<string, unknown>;
            options: {
                id: string;
            };
        }[];
        resources: {
            linetypes: {
                id: string;
                name: string;
                pattern: number[];
            }[];
            layers: {
                id: string;
                name: string;
                color: number;
                linetypeId: string;
                lineweight: number;
            }[];
        };
    };
    evidence: {
        packId: string;
        packVersion: string;
        packHash: string;
        intentHash: string;
        templateId: string;
        rootObjectId: string;
        expectedRevision: number;
        entityCount: number;
        /** Deterministic compiler decisions derived from explicit facts and versioned rules. */
        parameters?: Record<string, string | number | boolean>;
    };
}
export declare function compileKnowledgeDrawing(source: KJKnowledgeCompileInput): ReadonlyDeep<KJKnowledgeCompileResult>;
