import { KJDrawWorkbench } from './workbench.js';
import type { KJDocument } from './document.js';
import type { KJDrawSDK, KJSDKCommandEnvelopeReceipt } from './sdk.js';
import type { KJCommandArguments } from './commands.js';
import type { KJWorkbenchLocale, KJWorkbenchTheme, KJWorkbenchTool, KJWorkbenchOpenOptions, KJDrawWorkbenchChange } from './workbench.js';
import type { KJFileAdapterOptions } from './file-adapters.js';
/** Options for an embedded CAD editor. Give the container a height before mounting. */
export interface KJDrawEditorOptions {
    /** Drawing to open initially. Defaults to the included sample. */
    document?: KJDocument | 'sample' | 'blank' | null;
    /** Reuse an application SDK to share commands and plugins. */
    sdk?: KJDrawSDK;
    /** Workbench language. Default: en. */
    locale?: KJWorkbenchLocale;
    /** Panel and canvas appearance. Default: dark. */
    theme?: KJWorkbenchTheme;
    /** Enable inspection and file export with editing controls disabled. Default: false. */
    readonly?: boolean;
    /** Show the drawing grid. Default: true. */
    grid?: boolean;
    /** Show the ribbon toolbar. Default: true. */
    toolbar?: boolean;
    /** Show the layers panel. Default: true. */
    layers?: boolean;
    /** Show the properties panel. Default: true. */
    properties?: boolean;
    /** Editor title displayed above the drawing. */
    title?: string;
    /** Maximum input file size in bytes. Default: 20 MiB. */
    maxFileBytes?: number;
    onReady?: (editor: KJDrawEditor) => void;
    onChange?: (event: KJDrawWorkbenchChange) => void;
    onSelectionChange?: (event: KJDrawEditorSelectionEvent) => void;
    onError?: (error: unknown) => void;
}
export interface KJDrawEditorSelectionEvent {
    document: KJDocument;
    ids: readonly string[];
}
export interface KJDrawEditorSaveOptions extends KJFileAdapterOptions {
    /** Output format. Default: KJD. */
    format?: 'KJD' | 'DXF';
    fileName?: string;
    /** Trigger a browser download. Default: true. Use false for custom storage. */
    download?: boolean;
}
export interface KJDrawEditorEvents {
    ready: KJDrawEditor;
    change: KJDrawWorkbenchChange;
    selectionchange: KJDrawEditorSelectionEvent;
    documentchange: {
        document: KJDocument;
    };
    error: unknown;
    dispose: undefined;
}
/** A mounted CAD editor. Use ready before reading the initial drawing. */
export declare class KJDrawEditor {
    #private;
    readonly workbench: KJDrawWorkbench;
    readonly ready: Promise<this>;
    constructor(container: string | HTMLElement | ShadowRoot, options?: KJDrawEditorOptions);
    get document(): KJDocument | null;
    get sdk(): KJDrawSDK;
    get element(): HTMLElement;
    get disposed(): boolean;
    get locale(): KJWorkbenchLocale;
    get theme(): KJWorkbenchTheme;
    /** Subscribe to an editor event. The return value unsubscribes the listener. */
    on<Name extends keyof KJDrawEditorEvents>(name: Name, listener: (event: KJDrawEditorEvents[Name]) => void): () => boolean;
    /** Open a File, Blob, text or bytes. Pass format for bytes without a filename. */
    open(source: Blob | string | ArrayBuffer | ArrayBufferView, options?: KJWorkbenchOpenOptions): Promise<KJDocument>;
    /** Save the current drawing, or return its content with download: false. */
    save(options?: KJDrawEditorSaveOptions): Promise<string | Uint8Array>;
    setDocument(drawing: KJDocument): Promise<this>;
    /** Execute an SDK command using the current drawing and its undo history. */
    execute<TResult = unknown>(command: string, args?: KJCommandArguments): Promise<KJSDKCommandEnvelopeReceipt<TResult>>;
    undo(): Promise<KJSDKCommandEnvelopeReceipt>;
    redo(): Promise<KJSDKCommandEnvelopeReceipt>;
    setSelection(ids: readonly string[]): Promise<readonly string[]>;
    getSelection(): readonly string[];
    fit(): this;
    setTheme(theme: KJWorkbenchTheme): this;
    setLocale(locale: KJWorkbenchLocale): this;
    setTool(tool: KJWorkbenchTool): this;
    setTitle(title: string): this;
    /** Update presentation and editing mode while preserving the active drawing. */
    setOptions(options: Pick<KJDrawEditorOptions, 'readonly' | 'grid' | 'toolbar' | 'layers' | 'properties' | 'title' | 'maxFileBytes'>): this;
    /** Unmount the editor and release its listeners and rendering resources. Safe to call twice. */
    dispose(): void;
}
/** Mount an editor into a CSS selector, HTMLElement or ShadowRoot. */
export declare function createKJDrawEditor(container: string | HTMLElement | ShadowRoot, options?: KJDrawEditorOptions): KJDrawEditor;
