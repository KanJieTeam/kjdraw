import { type CSSProperties } from 'react';
import { createKJDrawEditor, type KJDrawEditor, type KJDrawEditorOptions } from './editor.js';
export type { KJDrawEditor, KJDrawEditorEvents, KJDrawEditorOptions, KJDrawEditorSaveOptions, KJDrawEditorSelectionEvent, KJWorkbenchLayout, } from './editor.js';
export interface KJDrawProps extends KJDrawEditorOptions {
    /** Class applied to the editor host element. */
    className?: string;
    /** CSS applied to the editor host element. Give it a height for the canvas. */
    style?: CSSProperties;
    /** Optional host element id. */
    id?: string;
}
/** A lifecycle-safe KJDraw editor component for React. */
export declare const KJDraw: import("react").ForwardRefExoticComponent<KJDrawProps & import("react").RefAttributes<KJDrawEditor>>;
export { createKJDrawEditor };
