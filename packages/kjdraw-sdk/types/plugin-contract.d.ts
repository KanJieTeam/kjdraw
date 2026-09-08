import { type ReadonlyDeep } from './utils.js';
export declare const KJDRAW_PLUGIN_SCHEMA = "com.kanjie.kjdraw.plugin";
export declare const KJDRAW_PLUGIN_SCHEMA_VERSION = 1;
export declare const KJDRAW_PLUGIN_PERMISSIONS: readonly ["commands.register", "commands.execute", "extensions.register", "file-adapters.register", "algorithms.register", "keymaps.register", "workspaces.register", "scene-sources.register", "ribbons.register", "panels.register", "symbols.register"];
export type KJPluginPermission = typeof KJDRAW_PLUGIN_PERMISSIONS[number];
declare const CONTRIBUTION_KINDS: readonly ["commands", "extensions", "fileAdapters", "algorithms", "keymaps", "workspaces", "sceneSources", "ribbons", "panels", "symbols"];
export type KJPluginContributionKind = typeof CONTRIBUTION_KINDS[number];
export interface KJPluginCompatibility extends Record<string, unknown> {
    sdk: string;
    kernel: string;
}
export type KJPluginContributions = Record<KJPluginContributionKind, string[]>;
export interface KJPluginManifest extends Record<string, unknown> {
    schema: typeof KJDRAW_PLUGIN_SCHEMA;
    schemaVersion: typeof KJDRAW_PLUGIN_SCHEMA_VERSION;
    id: string;
    name: string;
    version: string;
    compatibility: KJPluginCompatibility;
    permissions: KJPluginPermission[];
    contributes: KJPluginContributions;
}
export interface KJPluginRuntimeVersions {
    sdkVersion?: string;
    kernelVersion?: string;
}
export interface KJPluginGrant {
    manifest: ReadonlyDeep<KJPluginManifest>;
    permissions: readonly KJPluginPermission[];
}
export declare function satisfiesVersion(version: string, range?: string): boolean;
export declare function validatePluginManifest(input: unknown): ReadonlyDeep<KJPluginManifest>;
export declare function assertPluginCompatibility(manifestInput: unknown, { sdkVersion, kernelVersion }?: KJPluginRuntimeVersions): ReadonlyDeep<KJPluginManifest>;
export declare function createPluginGrant(manifestInput: unknown, grantedPermissions?: readonly string[]): Readonly<KJPluginGrant>;
export declare function assertPluginPermission(grant: KJPluginGrant | null | undefined, permission: KJPluginPermission): void;
export declare function assertPluginContribution(manifest: ReadonlyDeep<KJPluginManifest> | null | undefined, kind: KJPluginContributionKind, inputId: unknown): string;
export {};
