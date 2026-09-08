import type { KJObjectPayload } from './schema.js';
import type { KJStandardEntityType as KJDeclaredStandardEntityType } from './constants.js';
export type KJPoint3 = [number, number, number];
export declare const KJ_ENTITY_CONTRACT_VERSION: 1;
export type KJNormalizedEntityType = KJDeclaredStandardEntityType;
export interface KJNormalizedVertex extends Record<string, unknown> {
    point: KJPoint3;
    bulge: number;
    startWidth: number;
    endWidth: number;
}
export declare function listStandardEntityTypes(): readonly KJNormalizedEntityType[];
export declare function isStandardEntityType(type: unknown): type is KJNormalizedEntityType;
export declare function normalizeStandardEntityPayload(type: unknown, input?: Record<string, unknown>): KJObjectPayload;
export declare function normalizeLegacyEntityPayload(type: unknown, input?: Record<string, unknown>): KJObjectPayload;
