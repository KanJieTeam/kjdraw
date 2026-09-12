import type { KJCommandArguments } from './commands.js';
import type { KJReadonlyObjectRecord } from './schema.js';
export type KJModificationId = 'rotate' | 'scale' | 'mirror' | 'array-rect' | 'array-polar' | 'offset' | 'break' | 'break-two-point' | 'join' | 'explode' | 'trim' | 'extend' | 'lengthen' | 'stretch' | 'polyline-insert' | 'polyline-delete' | 'polyline-arc' | 'polyline-width' | 'chamfer' | 'fillet';
export type KJModificationFieldType = 'number' | 'integer' | 'boolean';
export type KJModificationPoint = readonly [number, number];
export interface KJLocalizedControlText {
    readonly en: string;
    readonly zh: string;
}
export interface KJModificationFieldDefinition {
    readonly key: string;
    readonly label: KJLocalizedControlText;
    readonly type: KJModificationFieldType;
    readonly default: number | boolean;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
}
export interface KJModificationPointDefinition {
    readonly key: string;
    readonly label: KJLocalizedControlText;
}
export interface KJModificationDefinition {
    readonly id: KJModificationId;
    readonly command: string;
    readonly label: KJLocalizedControlText;
    readonly description: KJLocalizedControlText;
    readonly minSelection: number;
    readonly maxSelection?: number;
    /** When present, every selected entity must use one of these types. */
    readonly supportedEntityTypes?: readonly string[];
    /** For boundary-based operations, the first selected entity is the target. */
    readonly targetEntityTypes?: readonly string[];
    readonly boundaryEntityTypes?: readonly string[];
    readonly fields: readonly KJModificationFieldDefinition[];
    readonly pointKeys: readonly KJModificationPointDefinition[];
}
export interface KJModificationBuildContext {
    readonly ids: readonly string[];
    readonly values?: Readonly<Record<string, unknown>>;
    readonly points?: readonly KJModificationPoint[];
    readonly selectionCenter?: KJModificationPoint;
}
export interface KJModificationCommand {
    readonly command: string;
    readonly arguments: KJCommandArguments;
}
export interface KJModificationPreviewEntity {
    readonly type: string;
    readonly payload: Readonly<Record<string, unknown>>;
}
export interface KJModificationPreview {
    /** Existing geometry replaced or erased by the operation. */
    readonly before: readonly KJModificationPreviewEntity[];
    /** Exact resulting geometry, capped by maxEntities. */
    readonly after: readonly KJModificationPreviewEntity[];
    readonly omittedCount: number;
}
export declare const KJ_MODIFICATION_IDS: readonly ["rotate", "scale", "mirror", "array-rect", "array-polar", "offset", "break", "break-two-point", "join", "explode", "trim", "extend", "lengthen", "stretch", "polyline-insert", "polyline-delete", "polyline-arc", "polyline-width", "chamfer", "fillet"];
export declare const KJ_MODIFICATION_DEFINITIONS: readonly KJModificationDefinition[];
/** Center of the selected entities' defining points, used as the non-rotating array anchor. */
export declare function getKJModificationSelectionCenter(entities: readonly {
    readonly payload: Readonly<Record<string, unknown>>;
}[]): KJModificationPoint;
export declare function getKJModificationDefinition(id: KJModificationId): KJModificationDefinition;
/** Resolve modification commands that require the parameter dialog and/or ordered canvas picks. */
export declare function getKJInteractiveModificationDefinition(command: string): KJModificationDefinition | null;
/** Parse optional positional command parameters into the same values used by the modification dialog. */
export declare function parseKJModificationCommandValues(id: KJModificationId, tokens: readonly string[], locale?: 'en' | 'zh'): Readonly<Record<string, number | boolean>>;
/** Shared preflight used by hosted and embedded workbenches before collecting points. */
export declare function validateKJModificationSelection(definition: KJModificationDefinition, entities: readonly ({
    readonly id: string;
    readonly type: string;
    readonly kind?: string;
} | null)[], locale?: 'en' | 'zh'): void;
/** Build a core command from UI-neutral form values and ordered canvas picks. */
export declare function buildKJModificationCommand(id: KJModificationId, context: KJModificationBuildContext): KJModificationCommand;
/**
 * Build a bounded, exact geometry-only preview for point-driven modification controls.
 * This function never owns a document or transaction and cannot change drawing history.
 */
export declare function previewKJModification(id: KJModificationId, context: KJModificationBuildContext, entities: readonly KJReadonlyObjectRecord[], options?: {
    readonly maxEntities?: number;
}): KJModificationPreview | null;
