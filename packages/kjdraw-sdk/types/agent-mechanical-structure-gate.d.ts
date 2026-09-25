import type { KJDocument } from './document.js';
/** Count-only, source-neutral structure comparison for regenerated mechanical sheets.
 * Model entities, geometry and pixels must be audited separately. */
export declare function auditMechanicalSheetStructure(source: KJDocument, candidate: KJDocument): {
    passed: boolean;
    layouts: {
        source: number;
        candidate: number;
        missing: number;
        extra: number;
        plotFields: number;
        paperEntityTypes: number;
        viewportFields: number;
    };
    layers: {
        source: number;
        candidate: number;
        missing: number;
        extra: number;
        fields: number;
    };
};
