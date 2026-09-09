import type { KJCommandArguments } from './commands.js';
export type KJModificationId = 'rotate' | 'scale' | 'mirror' | 'array-rect' | 'array-polar' | 'offset' | 'break' | 'explode' | 'trim' | 'extend' | 'chamfer' | 'fillet';
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
export declare const KJ_MODIFICATION_IDS: readonly ["rotate", "scale", "mirror", "array-rect", "array-polar", "offset", "break", "explode", "trim", "extend", "chamfer", "fillet"];
export declare const KJ_MODIFICATION_DEFINITIONS: readonly KJModificationDefinition[];
/** Center of the selected entities' defining points, used as the non-rotating array anchor. */
export declare function getKJModificationSelectionCenter(entities: readonly {
    readonly payload: Readonly<Record<string, unknown>>;
}[]): KJModificationPoint;
export declare function getKJModificationDefinition(id: KJModificationId): KJModificationDefinition;
/** Shared preflight used by hosted and embedded workbenches before collecting points. */
export declare function validateKJModificationSelection(definition: KJModificationDefinition, entities: readonly ({
    readonly id: string;
    readonly type: string;
    readonly kind?: string;
} | null)[], locale?: 'en' | 'zh'): void;
/** Build a core command from UI-neutral form values and ordered canvas picks. */
export declare function buildKJModificationCommand(id: KJModificationId, context: KJModificationBuildContext): KJModificationCommand;
