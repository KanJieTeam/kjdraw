/** Layout changes presentation only: documents and command history stay mounted. */
export declare const KJDRAW_LAYOUTS: readonly ['classic', 'compact', 'focus'];
export type KJWorkbenchLayout = typeof KJDRAW_LAYOUTS[number];
export declare function normalizeWorkbenchLayout(value: unknown): KJWorkbenchLayout;
