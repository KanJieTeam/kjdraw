/** Layout changes presentation only: documents and command history stay mounted. */
export const KJDRAW_LAYOUTS = ['classic', 'compact', 'focus'] as const
export type KJWorkbenchLayout = typeof KJDRAW_LAYOUTS[number]

export function normalizeWorkbenchLayout(value: unknown): KJWorkbenchLayout {
  if (value === undefined || value === null) return 'classic'
  if (KJDRAW_LAYOUTS.includes(value as KJWorkbenchLayout)) return value as KJWorkbenchLayout
  throw new TypeError(`Unknown KJDraw layout: ${String(value)}. Use classic, compact or focus.`)
}
