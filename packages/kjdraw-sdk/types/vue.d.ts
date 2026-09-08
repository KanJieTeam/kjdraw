import { type PropType } from 'vue';
import { createKJDrawEditor, type KJDrawEditor, type KJDrawEditorSaveOptions, type KJDrawEditorSelectionEvent } from './editor.js';
import type { KJDocument } from './document.js';
import type { KJDrawSDK, KJSDKCommandEnvelopeReceipt } from './sdk.js';
import type { KJCommandArguments } from './commands.js';
import type { KJDrawWorkbenchChange, KJWorkbenchLayout, KJWorkbenchLocale, KJWorkbenchOpenOptions, KJWorkbenchTheme } from './workbench.js';
export type { KJDrawEditor, KJDrawEditorEvents, KJDrawEditorOptions, KJDrawEditorSaveOptions, KJDrawEditorSelectionEvent, KJWorkbenchLayout, } from './editor.js';
export interface KJDrawExposed {
    readonly instance: KJDrawEditor | null;
    readonly ready: Promise<KJDrawEditor> | null;
    open(source: Blob | string | ArrayBuffer | ArrayBufferView, options?: KJWorkbenchOpenOptions): Promise<KJDocument>;
    save(options?: KJDrawEditorSaveOptions): Promise<string | Uint8Array>;
    fit(): KJDrawEditor;
    undo(): Promise<KJSDKCommandEnvelopeReceipt>;
    redo(): Promise<KJSDKCommandEnvelopeReceipt>;
    execute<TResult = unknown>(command: string, args?: KJCommandArguments): Promise<KJSDKCommandEnvelopeReceipt<TResult>>;
    setDocument(document: KJDocument): Promise<KJDrawEditor>;
    setTheme(theme: KJWorkbenchTheme): KJDrawEditor;
    setLayout(layout: KJWorkbenchLayout): KJDrawEditor;
    setLocale(locale: KJWorkbenchLocale): KJDrawEditor;
    setSelection(ids: readonly string[]): Promise<readonly string[]>;
    getSelection(): readonly string[];
    setOptions(options: Parameters<KJDrawEditor['setOptions']>[0]): KJDrawEditor;
    setTitle(title: string): KJDrawEditor;
    on: KJDrawEditor['on'];
    dispose(): void;
}
/** A lifecycle-safe KJDraw editor component for Vue. */
export declare const KJDraw: import("vue").DefineComponent<import("vue").ExtractPropTypes<{
    document: {
        type: PropType<KJDocument | 'sample' | 'blank' | null>;
        default: string;
    };
    sdk: {
        type: PropType<KJDrawSDK>;
        default: undefined;
    };
    locale: {
        type: PropType<KJWorkbenchLocale>;
        default: string;
    };
    theme: {
        type: PropType<KJWorkbenchTheme>;
        default: string;
    };
    layout: {
        type: PropType<KJWorkbenchLayout>;
        default: string;
    };
    readonly: {
        type: BooleanConstructor;
        default: boolean;
    };
    grid: {
        type: BooleanConstructor;
        default: boolean;
    };
    toolbar: {
        type: BooleanConstructor;
        default: boolean;
    };
    layers: {
        type: BooleanConstructor;
        default: boolean;
    };
    properties: {
        type: BooleanConstructor;
        default: boolean;
    };
    title: {
        type: StringConstructor;
        default: undefined;
    };
    maxFileBytes: {
        type: NumberConstructor;
        default: undefined;
    };
    onReady: {
        type: PropType<(editor: KJDrawEditor) => void>;
        default: undefined;
    };
    onChange: {
        type: PropType<(event: KJDrawWorkbenchChange) => void>;
        default: undefined;
    };
    onSelectionChange: {
        type: PropType<(event: KJDrawEditorSelectionEvent) => void>;
        default: undefined;
    };
    onError: {
        type: PropType<(error: unknown) => void>;
        default: undefined;
    };
}>, () => import("vue").VNode<import("vue").RendererNode, import("vue").RendererElement, {
    [key: string]: any;
}>, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<import("vue").ExtractPropTypes<{
    document: {
        type: PropType<KJDocument | 'sample' | 'blank' | null>;
        default: string;
    };
    sdk: {
        type: PropType<KJDrawSDK>;
        default: undefined;
    };
    locale: {
        type: PropType<KJWorkbenchLocale>;
        default: string;
    };
    theme: {
        type: PropType<KJWorkbenchTheme>;
        default: string;
    };
    layout: {
        type: PropType<KJWorkbenchLayout>;
        default: string;
    };
    readonly: {
        type: BooleanConstructor;
        default: boolean;
    };
    grid: {
        type: BooleanConstructor;
        default: boolean;
    };
    toolbar: {
        type: BooleanConstructor;
        default: boolean;
    };
    layers: {
        type: BooleanConstructor;
        default: boolean;
    };
    properties: {
        type: BooleanConstructor;
        default: boolean;
    };
    title: {
        type: StringConstructor;
        default: undefined;
    };
    maxFileBytes: {
        type: NumberConstructor;
        default: undefined;
    };
    onReady: {
        type: PropType<(editor: KJDrawEditor) => void>;
        default: undefined;
    };
    onChange: {
        type: PropType<(event: KJDrawWorkbenchChange) => void>;
        default: undefined;
    };
    onSelectionChange: {
        type: PropType<(event: KJDrawEditorSelectionEvent) => void>;
        default: undefined;
    };
    onError: {
        type: PropType<(error: unknown) => void>;
        default: undefined;
    };
}>> & Readonly<{}>, {
    document: "blank" | "sample" | KJDocument | null;
    sdk: KJDrawSDK;
    locale: KJWorkbenchLocale;
    theme: KJWorkbenchTheme;
    layout: "classic" | "compact" | "focus";
    readonly: boolean;
    grid: boolean;
    toolbar: boolean;
    layers: boolean;
    properties: boolean;
    title: string;
    maxFileBytes: number;
    onReady: (editor: KJDrawEditor) => void;
    onChange: (event: KJDrawWorkbenchChange) => void;
    onSelectionChange: (event: KJDrawEditorSelectionEvent) => void;
    onError: (error: unknown) => void;
}, {}, {}, {}, string, import("vue").ComponentProvideOptions, true, {}, any>;
export { createKJDrawEditor };
