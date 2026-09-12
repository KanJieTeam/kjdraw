import type { KJDocument } from './document.js';
/** Bounded discovery excludes binding expressions and full geometry from model context. */
export declare function createAgentDesignContext(document: KJDocument, offset: number, limit: number, maxBytes: number): Record<string, unknown>;
