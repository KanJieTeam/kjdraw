// Generated from layout.ts by scripts/build-typescript.mjs. Do not edit directly.
export const KJDRAW_LAYOUTS = [
    'classic',
    'compact',
    'focus'
];
export function normalizeWorkbenchLayout(value) {
    if (value === undefined || value === null) return 'classic';
    if (KJDRAW_LAYOUTS.includes(value)) return value;
    throw new TypeError(`Unknown KJDraw layout: ${String(value)}. Use classic, compact or focus.`);
}
