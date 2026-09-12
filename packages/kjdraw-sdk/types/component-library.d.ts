import type { KJDocument } from './document.js';
import type { KJReadonlyObjectRecord } from './schema.js';
import type { KJTransaction } from './transaction.js';
export declare const KJDRAW_COMPONENT_CATALOG_VERSION = "1.0.0";
export declare const KJDRAW_COMPONENT_SEARCH_MAX_LIMIT = 50;
export declare const KJDRAW_COMPONENT_DEFINITION_MAX_ENTITIES = 64;
export type KJComponentCategory = 'mechanical' | 'architecture' | 'electrical';
export type KJComponentLocale = 'en' | 'zh-CN';
export interface KJComponentLocalizedText {
    readonly en: string;
    readonly zh: string;
}
export interface KJComponentLicense {
    readonly spdx: 'Apache-2.0';
    readonly source: string;
    readonly sourceUrl: string;
}
export interface KJComponentParameterDefinition {
    readonly name: string;
    readonly label: KJComponentLocalizedText;
    readonly default: number;
    readonly minimum: number;
    readonly maximum: number;
    readonly integer?: boolean;
    readonly unit: 'millimeter' | 'count' | 'degree';
}
export interface KJComponentCatalogEntry {
    readonly id: string;
    readonly version: string;
    readonly category: KJComponentCategory;
    readonly title: KJComponentLocalizedText;
    readonly description: KJComponentLocalizedText;
    readonly keywords: {
        readonly en: readonly string[];
        readonly zh: readonly string[];
    };
    readonly nativeUnits: 'millimeter';
    readonly license: KJComponentLicense;
    readonly parameters: readonly KJComponentParameterDefinition[];
}
export interface KJComponentSearchInput {
    query?: unknown;
    category?: unknown;
    locale?: unknown;
    limit?: unknown;
    cursor?: unknown;
}
export interface KJComponentSearchResult {
    readonly catalogVersion: string;
    readonly query: string;
    readonly category: KJComponentCategory | null;
    readonly locale: KJComponentLocale;
    readonly total: number;
    readonly limit: number;
    readonly cursor: string | null;
    readonly nextCursor: string | null;
    readonly items: readonly KJComponentCatalogEntry[];
}
export interface KJComponentInsertInput {
    componentId?: unknown;
    version?: unknown;
    units?: unknown;
    parameters?: unknown;
    position?: unknown;
    scale?: unknown;
    rotation?: unknown;
    layerId?: unknown;
    ownerId?: unknown;
    maxDefinitionEntities?: unknown;
    identity?: unknown;
}
export interface KJComponentInsertIdentity {
    readonly definitionId: string;
    readonly memberIds: readonly string[];
    readonly insertId: string;
}
export interface KJComponentInsertResult {
    readonly catalogVersion: string;
    readonly component: KJComponentCatalogEntry;
    readonly parameters: Readonly<Record<string, number>>;
    readonly units: string;
    readonly definitionId: string;
    readonly definitionName: string;
    readonly definitionReused: boolean;
    readonly definitionEntityCount: number;
    readonly insert: KJReadonlyObjectRecord;
}
export declare function listComponentCatalog(): readonly KJComponentCatalogEntry[];
export declare function searchComponentCatalog(input?: KJComponentSearchInput): KJComponentSearchResult;
/** Allocate one stable internal identity before an AI proposal is previewed and approved. */
export declare function createCatalogComponentInsertIdentity(document: KJDocument, input: KJComponentInsertInput): KJComponentInsertIdentity;
/** Insert one catalog item through native BLOCK_RECORD members and INSERT in the caller's transaction. */
export declare function insertCatalogComponent(_document: KJDocument, transaction: KJTransaction, input: KJComponentInsertInput): KJComponentInsertResult;
