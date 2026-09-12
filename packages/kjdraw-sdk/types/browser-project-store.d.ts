import type { KjpOpenResult, KjpSource } from './project-package.js';
type FileSystemPermissionMode = 'read' | 'readwrite';
type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';
export interface KjpBrowserFile {
    arrayBuffer(): Promise<ArrayBuffer>;
}
export interface KjpBrowserWritable {
    write(data: KjpSource): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
}
export interface KjpBrowserFileHandle {
    readonly kind: 'file';
    readonly name: string;
    queryPermission?(options: {
        mode: FileSystemPermissionMode;
    }): Promise<FileSystemPermissionState>;
    requestPermission?(options: {
        mode: FileSystemPermissionMode;
    }): Promise<FileSystemPermissionState>;
    getFile(): Promise<KjpBrowserFile>;
    createWritable(options?: {
        keepExistingData?: boolean;
    }): Promise<KjpBrowserWritable>;
}
export interface BrowserKjpPickerOptions extends Record<string, unknown> {
}
export interface BrowserKjpReadResult {
    data: Uint8Array;
    project: KjpOpenResult;
    name: string;
}
/** Browser binding backed by the File System Access API and OPFS recovery. */
export declare class BrowserKjpFileBinding {
    #private;
    handle: KjpBrowserFileHandle | null;
    constructor(handle?: KjpBrowserFileHandle | null);
    static supported(): boolean;
    static chooseOpen(options?: BrowserKjpPickerOptions): Promise<BrowserKjpReadResult & {
        binding: BrowserKjpFileBinding;
    }>;
    static chooseSave(suggestedName?: string, options?: BrowserKjpPickerOptions): Promise<BrowserKjpFileBinding>;
    get bound(): boolean;
    get name(): string;
    read(): Promise<BrowserKjpReadResult>;
    write(data: KjpSource): Promise<{
        name: string;
        bytes: number;
        manifest: KjpOpenResult['manifest'];
    }>;
    writeRecovery(projectId: unknown, data: KjpSource): Promise<{
        projectId: string;
        bytes: number;
    }>;
    inspectRecovery(projectId: unknown): Promise<{
        available: false;
    } | {
        available: true;
        data: Uint8Array;
        manifest: KjpOpenResult['manifest'];
    }>;
    clearRecovery(projectId: unknown): Promise<boolean>;
}
export {};
