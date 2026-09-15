import { type KJKnowledgePack, type KJKnowledgePackSource } from './knowledge-pack.js';
import { type ReadonlyDeep } from './utils.js';
export interface KJHatchPatternCatalogLine {
    angle: number;
    base: readonly [number, number];
    offset: readonly [number, number];
    dashes: readonly number[];
}
export interface KJHatchPatternCatalogEntry {
    name: string;
    description: string;
    lines: KJHatchPatternCatalogLine[];
}
export interface KJHatchPatternCatalog {
    version: '1.0.0';
    contentHash: string;
    patterns: KJHatchPatternCatalogEntry[];
}
export interface KJHatchPatternKnowledgePackInput {
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
    patSource: string;
    selectedPatterns: string[];
    mappings: Record<string, string>;
}
/** Parse the data subset of AutoCAD PAT files without evaluating code or retaining file paths. */
export declare function parseAutoCADPat(source: string): ReadonlyDeep<KJHatchPatternCatalog>;
/** Build a native HATCH payload fragment from one parsed pattern. */
export declare function hatchPatternFromCatalog(source: ReadonlyDeep<KJHatchPatternCatalog>, name: string, options?: {
    scale?: number;
    angleDegrees?: number;
}): Readonly<Record<string, unknown>>;
/** Build a bounded, license-declared knowledge pack from explicitly selected PAT definitions. */
export declare function buildHatchPatternKnowledgePack(input: KJHatchPatternKnowledgePackInput): ReadonlyDeep<KJKnowledgePack>;
/** Resolve a semantic hatch key from a pack built by buildHatchPatternKnowledgePack. */
export declare function hatchPatternFromKnowledgePack(packSource: unknown, semanticKey: string, options?: {
    scale?: number;
    angleDegrees?: number;
}): Readonly<Record<string, unknown>>;
