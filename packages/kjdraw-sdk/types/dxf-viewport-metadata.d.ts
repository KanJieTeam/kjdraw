import type { KJDocumentState } from './schema.js';
import type { ReadonlyDeep } from './utils.js';
export declare const DXF_VIEWPORT_METADATA_KEY = "dxf:viewport-metadata:v1";
export declare const DXF_VIEWPORT_METADATA_UNSUPPORTED_KEY = "dxf:viewport-metadata-unsupported:v1";
interface Tag {
    code: number;
    value: string;
}
interface RecordData {
    type: string;
    tags: readonly Tag[];
}
interface Metadata {
    schema: 'kjdraw.dxf.viewport-metadata.v1';
    sourceVersion: string;
    rootHandle: string | null;
    rootEntries: {
        name: string;
        code: number;
        handle: string;
    }[];
    records: RecordData[];
    entityReferences: {
        handle: string;
        id: string;
    }[];
    viewports: {
        id: string;
        fingerprint: string;
    }[];
}
/** Capture only the complete metadata graph reached by a viewport extension
 * dictionary/reactor. Values are opaque data, never executable or geological facts. */
export declare function captureViewportMetadata(state: ReadonlyDeep<KJDocumentState>, objects: readonly RecordData[], viewports: readonly {
    id: string;
    record: RecordData;
}[]): Metadata | null;
/** Validate stored metadata again after KJD reopen or caller edits. Refuse a
 * stale/erased target rather than writing dangling handles or stripping data. */
export declare function prepareViewportMetadata(state: KJDocumentState): Metadata | null;
export declare function viewportMetadataReferenceMap(state: KJDocumentState, metadata: Metadata, rootHandle: string): ReadonlyMap<string, string>;
export declare function isViewportMetadataReference(code: number): boolean;
export {};
