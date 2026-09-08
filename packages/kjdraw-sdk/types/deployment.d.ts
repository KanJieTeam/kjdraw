export type KJDeploymentMode = 'browser-local' | 'desktop-local' | 'self-hosted' | 'cloud-assisted' | 'hybrid';
export type KJProviderType = 'project-store' | 'compute' | 'scene';
export interface KJDeploymentProvider {
    id: string;
    locality?: string;
    [key: string]: unknown;
}
export interface KJProjectStoreProvider extends KJDeploymentProvider {
    loadProject(projectId: string, options?: Record<string, unknown>): Promise<unknown>;
    saveProject(projectId: string, project: unknown, options?: Record<string, unknown>): Promise<unknown>;
}
export interface KJComputeProvider extends KJDeploymentProvider {
    execute(operation: string, input: unknown, options?: Record<string, unknown>): Promise<unknown>;
}
export interface KJSceneProvider extends KJDeploymentProvider {
    openScene(sceneId: string, options?: Record<string, unknown>): Promise<unknown>;
    queryViewport(viewport: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}
export interface KJDeploymentProfile {
    schema: 'com.kanjie.kjdraw.deployment-profile@1';
    mode: KJDeploymentMode;
    projectAuthority: string;
    providers: Partial<Record<KJProviderType, string>>;
}
export interface KJDeploymentProfileOptions {
    mode?: KJDeploymentMode;
    projectAuthority?: string;
    providers?: Partial<Record<KJProviderType, string>>;
}
export declare const KJ_DEPLOYMENT_MODES: readonly KJDeploymentMode[];
export declare const KJ_PROVIDER_TYPES: {
    readonly PROJECT_STORE: 'project-store';
    readonly COMPUTE: 'compute';
    readonly SCENE: 'scene';
};
/** Host-owned registry for optional local or remote deployment services.
 * KJDraw never performs network access merely because a provider is registered. */
export declare class KJDeploymentRegistry {
    #private;
    register(type: KJProviderType, provider: KJDeploymentProvider, { replace }?: {
        replace?: boolean;
    }): () => boolean;
    get(type: KJProviderType, id: string): Readonly<KJDeploymentProvider> | null;
    list(type?: KJProviderType): ReadonlyArray<Readonly<KJDeploymentProvider>>;
}
export declare function createDeploymentProfile(options?: KJDeploymentProfileOptions): Readonly<KJDeploymentProfile>;
export declare function validateDeploymentProfile(profile: KJDeploymentProfileOptions, registry: KJDeploymentRegistry): Readonly<KJDeploymentProfile>;
