import { type KJHatchPatternCatalog } from '../hatch-pattern-catalog.js';
import type { ReadonlyDeep } from '../utils.js';
/**
 * Complete user-authorized YTKC legacy PAT resource, not a soil classifier.
 * Names and literal line definitions are preserved; no name-based substitution.
 * See the package NOTICE for provenance and the redistribution authorization.
 */
export declare const KJDRAW_GEOLOGY_HATCH_PATTERN_SOURCE: string;
/** Frozen native OCS line families parsed from all 209 original PAT names. */
export declare const KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG: ReadonlyDeep<KJHatchPatternCatalog>;
export declare const KJDRAW_GEOLOGY_HATCH_PATTERN_PROVENANCE: Readonly<{
    source: "User-supplied YTKC legacy ZWCAD.PAT definitions";
    authorization: "Explicit resource redistribution authorization confirmed by the contributing user on 2026-10-03";
    vendorAuthorizationClaimed: false;
    patternNames: 209;
    lineFamilies: 940;
    sourceSha256: "cf3ce6d51c5fd2b4c51a132fa6c77b8325d7b346e334308d2d34a672e7ebd632";
    literalDefinitionSha256: "76777b218f5f8ae6797c484f269d5b0d63020f5a70587eb4f9e7966ad0b528d2";
}>;
