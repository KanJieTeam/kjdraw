import { KJCanvasRenderer } from './canvas-renderer.js';
import type { KJDrawSDK, KJSDKCommandEnvelopeReceipt } from './sdk.js';
import { KJDocument } from './document.js';
import type { KJCommandArguments } from './commands.js';
import type { KJFileAdapterOptions } from './file-adapters.js';
import { type KJWorkbenchLayout } from './layout.js';
import { type KJDraftTool } from './drafting.js';
export type { KJWorkbenchLayout } from './layout.js';
export type KJWorkbenchLocale = 'en' | 'zh-CN';
export type KJWorkbenchTheme = 'dark' | 'light';
export type KJWorkbenchTool = 'select' | 'fence' | 'pan' | KJDraftTool | 'text' | 'measure' | 'move' | 'copy';
export interface KJDrawWorkbenchOptions {
    sdk?: KJDrawSDK;
    document?: KJDocument | 'blank' | 'sample' | null;
    locale?: KJWorkbenchLocale;
    theme?: KJWorkbenchTheme;
    readonly?: boolean;
    grid?: boolean;
    showLayers?: boolean;
    showInspector?: boolean;
    toolbar?: boolean;
    layout?: KJWorkbenchLayout;
    title?: string;
    /** Browser-side ceiling checked before a selected file is read into memory. */
    maxFileBytes?: number;
    onChange?: (event: KJDrawWorkbenchChange) => void;
    onError?: (error: unknown) => void;
}
export interface KJDrawWorkbenchChange {
    document: KJDocument;
    revision: number;
    entityCount: number;
}
export interface KJWorkbenchOpenOptions extends KJFileAdapterOptions {
    fileName?: string;
}
export interface KJWorkbenchSaveOptions extends KJFileAdapterOptions {
    fileName?: string;
    download?: boolean;
}
export interface KJWorkbenchSnapshot {
    locale: KJWorkbenchLocale;
    theme: KJWorkbenchTheme;
    layout: KJWorkbenchLayout;
    tool: KJWorkbenchTool;
    documentId: string | null;
    revision: number;
    entityCount: number;
    selectedIds: readonly string[];
    render: ReturnType<KJCanvasRenderer['render']>;
}
/** A framework-neutral reference CAD workbench that can be embedded with one call. */
export declare class KJDrawWorkbench {
    #private;
    readonly container: HTMLElement | ShadowRoot;
    readonly root: HTMLElement;
    readonly sdk: KJDrawSDK;
    readonly renderer: KJCanvasRenderer;
    readonly ready: Promise<this>;
    constructor(container: HTMLElement | ShadowRoot, options?: KJDrawWorkbenchOptions);
    get document(): KJDocument | null;
    get locale(): KJWorkbenchLocale;
    get theme(): KJWorkbenchTheme;
    get layout(): KJWorkbenchLayout;
    get tool(): KJWorkbenchTool;
    /** Change presentation without replacing the drawing or its undo history. */
    setOptions(options: Pick<KJDrawWorkbenchOptions, 'readonly' | 'grid' | 'toolbar' | 'showLayers' | 'showInspector' | 'title' | 'maxFileBytes' | 'layout'>): this;
    setLocale(locale: KJWorkbenchLocale): this;
    snapshot(): Readonly<KJWorkbenchSnapshot>;
    setTheme(theme: KJWorkbenchTheme): this;
    setLayout(value: KJWorkbenchLayout): this;
    setTool(tool: KJWorkbenchTool): this;
    setDocument(document: KJDocument): Promise<this>;
    open(source: unknown, options?: KJWorkbenchOpenOptions): Promise<KJDocument>;
    execute<TResult = unknown>(command: string, args?: KJCommandArguments, options?: {
        expectedRevision?: number;
    }): Promise<KJSDKCommandEnvelopeReceipt<TResult>>;
    save(format?: 'KJD' | 'DXF', options?: KJWorkbenchSaveOptions): Promise<unknown>;
    dispose(): void;
}
export declare function mountKJDrawWorkbench(container: HTMLElement | ShadowRoot, options?: KJDrawWorkbenchOptions): KJDrawWorkbench;
export declare function defineKJDrawWorkbenchElement(tagName?: string): CustomElementConstructor;
