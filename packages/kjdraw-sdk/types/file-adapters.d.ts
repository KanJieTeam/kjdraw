export type KJFileOperation = 'read' | 'write';
export interface KJFileFormatDescriptor {
    read: string[];
    write: string[];
    notes: string[];
}
export interface KJFileFormatDescriptorInput {
    read?: readonly (string | number)[];
    write?: readonly (string | number)[];
    notes?: readonly unknown[];
}
export type KJFileFormatMap = Record<string, KJFileFormatDescriptor>;
export type KJFileFormatMapInput = Record<string, KJFileFormatDescriptorInput>;
export interface KJFileAdapterContext extends Record<string, unknown> {
    format?: string;
    version?: string | number | null;
    adapter?: Readonly<KJFileAdapter>;
    adapterId?: string | null;
}
export interface KJFileAdapterOptions extends Record<string, unknown> {
    format?: string;
    version?: string | number | null;
    adapterId?: string | null;
    /** Cancels cooperative file readers before they commit a document. */
    signal?: AbortSignal;
    /** Bounded host progress without exposing file contents. */
    onProgress?: (progress: Readonly<KJFileReadProgress>) => void;
}
export interface KJFileReadProgress {
    phase: 'source' | 'parse' | 'import';
    completed: number;
    total?: number;
    unit: 'bytes' | 'tags' | 'entities';
}
export interface KJFileAdapter<TRead = unknown, TWrite = unknown> {
    id: string;
    priority: number;
    vendor: string | null;
    formats: KJFileFormatMap;
    capabilities: Record<string, unknown>;
    preservation: Record<string, unknown>;
    sniff?: (source: unknown, options: KJFileAdapterOptions) => boolean | Promise<boolean>;
    read?: (source: unknown, options: KJFileAdapterContext) => TRead | Promise<TRead>;
    write?: (document: unknown, options: KJFileAdapterContext) => TWrite | Promise<TWrite>;
}
export interface KJFileAdapterDefinition<TRead = unknown, TWrite = unknown> extends Record<string, unknown> {
    id?: string;
    priority?: number;
    vendor?: string | null;
    formats?: KJFileFormatMapInput;
    capabilities?: Record<string, unknown>;
    preservation?: Record<string, unknown>;
    sniff?: (source: unknown, options: KJFileAdapterOptions) => boolean | Promise<boolean>;
    read?: (source: unknown, options: KJFileAdapterContext) => TRead | Promise<TRead>;
    write?: (document: unknown, options: KJFileAdapterContext) => TWrite | Promise<TWrite>;
}
export interface KJFileAdapterCapability {
    id: string;
    vendor: string | null;
    formats: KJFileFormatMap;
    capabilities: Record<string, unknown>;
    preservation: Record<string, unknown>;
}
export declare function defineFileAdapter<TRead = unknown, TWrite = unknown>(definition?: KJFileAdapterDefinition<TRead, TWrite>): Readonly<KJFileAdapter<TRead, TWrite>>;
export declare class KJFileAdapterRegistry {
    #private;
    register(definition: KJFileAdapterDefinition, { replace }?: {
        replace?: boolean;
    }): () => boolean;
    get(id: string): Readonly<KJFileAdapter> | null;
    list(): ReadonlyArray<Readonly<KJFileAdapter>>;
    find({ format, version, operation, adapterId }?: KJFileAdapterOptions & {
        operation?: KJFileOperation;
    }): Readonly<KJFileAdapter> | null;
    read(source: unknown, inputOptions?: KJFileAdapterOptions): Promise<unknown>;
    write(document: unknown, options?: KJFileAdapterOptions): Promise<unknown>;
    capabilityMatrix(): KJFileAdapterCapability[];
}
