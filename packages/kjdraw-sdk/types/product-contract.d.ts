import { type KJClockConstructor } from './utils.js';
export declare const KJ_COMMAND_SCHEMA = "com.kanjie.kjdraw.command";
export declare const KJ_COMMAND_SCHEMA_VERSION = 1;
export declare const KJ_COMMAND_ORIGINS: readonly ["ui", "sdk", "plugin", "ai", "system", "migration", "recovery", "test"];
export declare const KJ_COMMAND_MODES: readonly ["plan", "execute"];
export type KJCommandOriginKind = typeof KJ_COMMAND_ORIGINS[number];
export type KJCommandMode = typeof KJ_COMMAND_MODES[number];
export type KJCommandConfirmationStatus = 'not-required' | 'pending' | 'confirmed' | 'rejected';
export interface KJCommandOrigin {
    kind: KJCommandOriginKind;
    owner?: string;
    [key: string]: unknown;
}
export interface KJCommandConfirmation {
    status: KJCommandConfirmationStatus;
    planId?: string;
    confirmedBy?: string;
    rejectedBy?: string;
    [key: string]: unknown;
}
export interface KJCommandEnvelope<TArguments extends Record<string, unknown> = Record<string, unknown>> {
    schema: typeof KJ_COMMAND_SCHEMA;
    schemaVersion: typeof KJ_COMMAND_SCHEMA_VERSION;
    id: string;
    command: string;
    documentId: string;
    expectedRevision: number | null;
    mode: KJCommandMode;
    arguments: TArguments;
    origin: KJCommandOrigin;
    confirmation: KJCommandConfirmation;
    createdAt: string;
    metadata: Record<string, unknown>;
    [key: string]: unknown;
}
export interface KJCreateCommandOptions {
    id?: string;
    documentId?: string;
    expectedRevision?: number | null;
    mode?: KJCommandMode;
    origin?: KJCommandOriginKind | Partial<KJCommandOrigin>;
    confirmation?: Partial<KJCommandConfirmation>;
    createdAt?: string;
    clock?: KJClockConstructor;
    metadata?: Record<string, unknown>;
}
export interface KJCommandReceipt<TResult = unknown> {
    schema: 'com.kanjie.kjdraw.command-receipt';
    schemaVersion: 1;
    commandEnvelopeId: string;
    command: string;
    documentId: string;
    status: string;
    beforeRevision: number;
    afterRevision: number;
    result: TResult | null;
}
export interface KJCommandReceiptOptions<TResult = unknown> {
    status?: string;
    beforeRevision?: number;
    afterRevision?: number;
    result?: TResult | null;
}
/** Public release matrix. R12 remains an import-migration implementation detail. */
export declare const KJDRAW_CAD_VERSION_MATRIX: readonly [{
    readonly label: 'R14';
    readonly code: 'AC1014';
}, {
    readonly label: '2000';
    readonly code: 'AC1015';
}, {
    readonly label: '2004';
    readonly code: 'AC1018';
}, {
    readonly label: '2010';
    readonly code: 'AC1024';
}, {
    readonly label: '2013';
    readonly code: 'AC1027';
}, {
    readonly label: '2018';
    readonly code: 'AC1032';
}, {
    readonly label: '2024';
    readonly code: 'AC1032';
}];
/** Machine-readable KJDraw 1.0 boundary used by hosts, plugins and release QA. */
export declare const KJDRAW_1_0_PRODUCT_CONTRACT: {
    readonly id: 'com.kanjie.kjdraw.product@1';
    readonly deployment: 'provider-neutral';
    readonly deploymentModes: readonly ["browser-local", "desktop-local", "self-hosted", "cloud-assisted", "hybrid"];
    readonly defaultDeployment: 'browser-local';
    readonly projectAuthority: 'host-selected-provider';
    readonly providerContracts: readonly ["project-store", "compute", "scene"];
    readonly authorities: {
        readonly geometry: 'kjcore-rust';
        readonly topology: 'kjcore-rust';
        readonly spatialIndex: 'kjcore-rust';
        readonly fileIntermediateModel: 'kjcore-rust';
        readonly workbench: 'typescript-sdk-client';
        readonly renderer: 'read-only-projection';
    };
    readonly projectFile: {
        readonly extension: '.kjp';
        readonly mediaType: 'application/vnd.kanjie.kjdraw-project+zip';
        readonly schema: 'com.kanjie.kjdraw.project@1';
        readonly container: 'zip64';
        readonly requiredEntries: readonly ["manifest.json", "drawings/", "history/commands.ndjson"];
        readonly optionalEntries: readonly ["assets/", "snapshots/", "recovery/", "diagnostics/"];
        readonly durability: 'write-temp-fsync-atomic-replace';
    };
    readonly documentFile: {
        readonly extension: '.kjd';
        readonly mediaType: 'application/vnd.kanjie.kjdraw-document+json';
        readonly schema: 'com.kanjie.kjdraw.document@1';
    };
    readonly commandProtocol: "com.kanjie.kjdraw.command@1";
    readonly cadVersions: readonly [{
        readonly label: 'R14';
        readonly code: 'AC1014';
    }, {
        readonly label: '2000';
        readonly code: 'AC1015';
    }, {
        readonly label: '2004';
        readonly code: 'AC1018';
    }, {
        readonly label: '2010';
        readonly code: 'AC1024';
    }, {
        readonly label: '2013';
        readonly code: 'AC1027';
    }, {
        readonly label: '2018';
        readonly code: 'AC1032';
    }, {
        readonly label: '2024';
        readonly code: 'AC1032';
    }];
    readonly domainExtensions: {
        readonly included: false;
        readonly policy: 'separate-packages';
    };
    readonly extensionRule: 'official-and-third-party-capabilities-use-the-same-public-sdk';
};
export declare function validateCommandEnvelope(input: unknown): Readonly<KJCommandEnvelope>;
export declare function createCommandEnvelope<TArguments extends Record<string, unknown> = Record<string, unknown>>(command: string, args?: TArguments, options?: KJCreateCommandOptions): Readonly<KJCommandEnvelope<TArguments>>;
export declare function createCommandReceipt<TResult = unknown>(envelope: KJCommandEnvelope, { status, beforeRevision, afterRevision, result }?: KJCommandReceiptOptions<TResult>): Readonly<KJCommandReceipt<TResult>>;
