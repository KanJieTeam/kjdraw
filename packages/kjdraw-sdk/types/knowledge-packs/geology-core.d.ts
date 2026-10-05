import { KJKnowledgePackRegistry, type KJKnowledgePack } from '../knowledge-pack.js';
import { type ReadonlyDeep } from '../utils.js';
export declare const KJDRAW_GEOLOGY_KNOWLEDGE_PACK: ReadonlyDeep<KJKnowledgePack>;
/** Register the bundled pack in a caller-owned registry. */
export declare function registerGeologyKnowledgePack(registry?: KJKnowledgePackRegistry): ReadonlyDeep<KJKnowledgePack>;
