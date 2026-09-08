import type { KJDrawSDK } from './sdk.js';
import type { KJDocument } from './document.js';
export interface KJDrawSample {
    readonly id: string;
    readonly title: string;
    readonly titleZh: string;
    readonly discipline: string;
}
export declare const INDUSTRY_SAMPLES: readonly KJDrawSample[];
/** Build one editable industry drawing in the supplied SDK. */
export declare function createIndustrySample(sdk: KJDrawSDK, id: string): Promise<KJDocument>;
/** Build the complete collection of original industry drawings. */
export declare function createIndustrySamples(sdk: KJDrawSDK): Promise<KJDocument[]>;
