import { KJDocument } from './document.js';
import type { KJFileAdapterOptions } from './file-adapters.js';
import type { KJDocumentState } from './schema.js';
export type KJRoundTripSeverity = 'error' | 'warning';
export interface KJRoundTripFinding {
    severity: KJRoundTripSeverity;
    code: string;
    path: string;
    expected: unknown;
    actual: unknown;
}
export interface KJDocumentSummary {
    schemaVersion: number;
    documentId: string;
    objectCount: number;
    erasedObjectCount: number;
    entityCount: number;
    objectKinds: Record<string, number>;
    entityTypes: Record<string, number>;
    tableCounts: Record<string, number>;
    layoutCount: number;
    paperSpaceCount: number;
    resourceCounts: Record<string, number>;
    opaquePayloadCount: number;
    handleCount: number;
    ownerEdgeCount: number;
}
export interface KJRoundTripOptions extends KJFileAdapterOptions {
    strictHandles?: boolean;
}
export interface KJRoundTripAudit {
    passed: boolean;
    status: 'passed' | 'warning' | 'failed';
    errors: number;
    warnings: number;
    format: string;
    adapterId: string | null;
    expected: KJDocumentSummary;
    actual: KJDocumentSummary;
    findings: KJRoundTripFinding[];
}
export interface KJRoundTripRegistry {
    write(document: unknown, options: KJFileAdapterOptions): Promise<unknown>;
    read(source: unknown, options: KJFileAdapterOptions): Promise<unknown>;
}
export interface KJRoundTripExecution {
    artifact: unknown;
    document: KJDocument;
    audit: KJRoundTripAudit;
}
type KJOpenInput = Parameters<typeof KJDocument.open>[0];
export declare function summarizeDocument(input: KJDocument | KJDocumentState): KJDocumentSummary;
export declare function auditRoundTrip(sourceInput: KJDocument | KJOpenInput, resultInput: KJDocument | KJOpenInput, options?: KJRoundTripOptions): KJRoundTripAudit;
export declare function executeRoundTrip(registry: KJRoundTripRegistry, document: KJDocument, options?: KJRoundTripOptions): Promise<KJRoundTripExecution>;
export {};
