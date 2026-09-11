import type { KJDocument } from './document.js';
import type { KJReadonlyObjectRecord } from './schema.js';
/** Attached attributes occupy their INSERT's owner space, not its definition space. */
export declare function isAttachedAttribute(entity: KJReadonlyObjectRecord): boolean;
export declare function attributeHidden(entity: KJReadonlyObjectRecord): boolean;
export declare function insertAttributes(document: KJDocument, insert: KJReadonlyObjectRecord): readonly KJReadonlyObjectRecord[];
export declare function visibleAttribute(document: KJDocument, attribute: KJReadonlyObjectRecord): boolean;
