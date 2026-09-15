import { type ReadonlyDeep } from './utils.js';
export declare const KJDRAW_KNOWLEDGE_PACK_SCHEMA: 'kjdraw.knowledge-pack.v1';
export declare const KJDRAW_SEMANTIC_IR_SCHEMA: 'kjdraw.semantic-ir.v1';
export interface KJKnowledgePackSource {
    id: string;
    title: string;
    license: string;
    contentHash: string;
    uri?: string;
}
export interface KJKnowledgePack {
    schema: typeof KJDRAW_KNOWLEDGE_PACK_SCHEMA;
    id: string;
    version: string;
    title: string;
    domain: string;
    license: {
        spdx: string;
        redistributable: boolean;
        trainingAllowed: boolean;
    };
    sources: KJKnowledgePackSource[];
    ontology: {
        objectKinds: string[];
        relationKinds: string[];
    };
    templates?: Record<string, unknown>;
    rules?: Record<string, unknown>;
}
export interface KJSemanticDrawingIntent {
    schema: typeof KJDRAW_SEMANTIC_IR_SCHEMA;
    packId: string;
    packVersion: string;
    drawing: {
        kind: string;
        title: string;
        units: 'millimeter' | 'meter';
    };
    objects: {
        id: string;
        kind: string;
        properties: Record<string, unknown>;
    }[];
    relations: {
        kind: string;
        from: string;
        to: string;
        properties?: Record<string, unknown>;
    }[];
}
export declare function validateKnowledgePack(source: unknown): ReadonlyDeep<KJKnowledgePack>;
export declare function validateSemanticDrawingIntent(source: unknown, pack?: ReadonlyDeep<KJKnowledgePack>): ReadonlyDeep<KJSemanticDrawingIntent>;
export declare class KJKnowledgePackRegistry {
    #private;
    register(source: unknown): ReadonlyDeep<KJKnowledgePack>;
    get(id: string, version?: string): ReadonlyDeep<KJKnowledgePack> | undefined;
    list(): readonly ReadonlyDeep<KJKnowledgePack>[];
    contentHash(): string;
}
