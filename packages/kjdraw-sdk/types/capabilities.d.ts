import type { KJFileAdapterCapability } from './file-adapters.js';
export interface KJCapabilityCommand {
    id: string;
    title?: string;
    aliases?: readonly string[];
    transactional?: boolean;
    owner?: string;
    capabilities?: Record<string, unknown>;
}
export interface KJCapabilitySDK {
    version: unknown;
    activeDocument?: {
        schemaVersion?: number;
    } | null;
    commands: {
        list(): readonly KJCapabilityCommand[];
        resolve(id: unknown): unknown;
    };
    fileAdapters: {
        capabilityMatrix(): KJFileAdapterCapability[];
    };
}
export interface KJFormatReadinessRequirement {
    format: string;
    operation: 'read' | 'write';
    versions: readonly string[];
    certification?: string;
}
export interface KJSDKReadinessProfile {
    id: string;
    requiredCommands?: readonly string[];
    requiredEntityTypes?: readonly string[];
    requiredFormats?: readonly KJFormatReadinessRequirement[];
    authoritativeGeometry?: boolean;
}
export interface KJReadinessFinding {
    severity: 'error';
    code: 'COMMAND_MISSING' | 'ENTITY_TYPE_MISSING' | 'FORMAT_VERSION_MISSING' | 'AUTHORITATIVE_GEOMETRY_UNAVAILABLE';
    capability: string;
    versions?: readonly string[];
}
export interface KJCommandBinding {
    id?: unknown;
    binding?: {
        kind?: unknown;
        command?: unknown;
        action?: unknown;
    } | null;
}
export interface KJCommandBindingFinding {
    id: string | null;
    code: 'command-id-missing' | 'binding-missing' | 'sdk-command-missing' | 'host-action-missing';
    message: string;
}
export declare const KJDRAW_1_0_READINESS_PROFILE: Readonly<KJSDKReadinessProfile>;
/** Release gate used by CI and product surfaces. It reports gaps; it never upgrades
 * roadmap intentions into supported capabilities. */
export declare function auditSDKReadiness(sdk: KJCapabilitySDK, profile?: KJSDKReadinessProfile): Readonly<{
    profileId: string;
    passed: boolean;
    status: "blocked" | "passed";
    findings: readonly KJReadinessFinding[];
    manifest: Readonly<{
        product: "KJDraw SDK";
        sdkVersion: string;
        documentSchemaVersion: number;
        geometry: Readonly<{
            mode: 'native' | 'reference';
            authoritative: boolean;
            backend: import("./geometry/backend.js").KJGeometryBackendIdentity;
            operations: readonly string[];
            lastFailure: import("./geometry/backend.js").KJGeometryBackendFailure | null;
        }>;
        commands: readonly Readonly<{
            id: string;
            title: string | undefined;
            aliases: readonly string[];
            transactional: boolean;
            owner: string | undefined;
            capabilities: Readonly<Record<string, unknown>>;
        }>[];
        commandIds: readonly string[];
        entityTypes: readonly ("ARC" | "ATTDEF" | "ATTRIB" | "CIRCLE" | "DIMENSION" | "ELLIPSE" | "HATCH" | "IMAGE" | "INSERT" | "LEADER" | "LINE" | "LWPOLYLINE" | "MLEADER" | "MTEXT" | "POINT" | "POLYLINE" | "PROXY_ENTITY" | "RAY" | "REVISION_CLOUD" | "SOLID" | "SOLID3D" | "SPLINE" | "TABLE" | "TEXT" | "TRACE" | "VIEWPORT" | "WIPEOUT" | "XLINE")[];
        fileAdapters: readonly KJFileAdapterCapability[];
    }>;
}>;
/**
 * Returns a machine-readable contract for hosts, plugin loaders and product QA.
 * The manifest only reports executable registrations; roadmap items never appear
 * as supported capabilities.
 */
export declare function buildSDKCapabilityManifest(sdk: KJCapabilitySDK): Readonly<{
    product: "KJDraw SDK";
    sdkVersion: string;
    documentSchemaVersion: number;
    geometry: Readonly<{
        mode: 'native' | 'reference';
        authoritative: boolean;
        backend: import("./geometry/backend.js").KJGeometryBackendIdentity;
        operations: readonly string[];
        lastFailure: import("./geometry/backend.js").KJGeometryBackendFailure | null;
    }>;
    commands: readonly Readonly<{
        id: string;
        title: string | undefined;
        aliases: readonly string[];
        transactional: boolean;
        owner: string | undefined;
        capabilities: Readonly<Record<string, unknown>>;
    }>[];
    commandIds: readonly string[];
    entityTypes: readonly ("ARC" | "ATTDEF" | "ATTRIB" | "CIRCLE" | "DIMENSION" | "ELLIPSE" | "HATCH" | "IMAGE" | "INSERT" | "LEADER" | "LINE" | "LWPOLYLINE" | "MLEADER" | "MTEXT" | "POINT" | "POLYLINE" | "PROXY_ENTITY" | "RAY" | "REVISION_CLOUD" | "SOLID" | "SOLID3D" | "SPLINE" | "TABLE" | "TEXT" | "TRACE" | "VIEWPORT" | "WIPEOUT" | "XLINE")[];
    fileAdapters: readonly KJFileAdapterCapability[];
}>;
/**
 * Product-shell gate: every visible command must declare whether it is backed by
 * the public SDK or is an explicit host-only operation. Missing SDK commands are
 * rejected during startup instead of becoming inert toolbar buttons.
 */
export declare function auditCommandBindings(sdk: KJCapabilitySDK, bindings?: readonly KJCommandBinding[]): Readonly<{
    passed: boolean;
    findings: readonly KJCommandBindingFinding[];
}>;
export declare function assertCommandBindings(sdk: KJCapabilitySDK, bindings?: readonly KJCommandBinding[]): Readonly<{
    passed: boolean;
    findings: readonly KJCommandBindingFinding[];
}>;
