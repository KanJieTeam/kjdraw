/** KJDraw Precision: shared visual foundation for hosted and embedded workbenches. */
export const KJDRAW_THEME_CSS = `
:where(.kjdraw-theme, .kjwb) {
  --kj-chrome: #f6f7f9;
  --kj-surface: #ffffff;
  --kj-surface-subtle: #eef1f5;
  --kj-border: #d9dee6;
  --kj-text: #202936;
  --kj-muted: #637083;
  --kj-action: #2863df;
  --kj-action-soft: #eaf1ff;
  --kj-brand: #bdf878;
  --kj-canvas: #090e15;
  --kj-radius: 6px;
  --kj-font: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  --kj-mono: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  font-family: var(--kj-font);
  font-size: 13px;
  color: var(--kj-text);
  color-scheme: light;
}
:where(.kjdraw-theme, .kjwb) .kj-icon {
  display: inline-block; width: 20px; height: 20px; flex-shrink: 0;
  vertical-align: middle; pointer-events: none;
}
:where(.kjdraw-theme, .kjwb) :focus-visible {
  outline: 2px solid var(--kj-action); outline-offset: 2px;
}
`

const paths: Record<string, string> = {
  select: '<path d="m5 3 14 9-7 1-3 7-4-17Z"/>',
  pan: '<path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2Z"/>',
  line: '<path d="m4 20 16-16"/><path d="M3 17v4h4M17 3h4v4"/>',
  polyline: '<path d="M3 18V6h7v12h11V6"/><path d="M2 17h2v2H2zM20 5h2v2h-2z"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  arc: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M2 16h4m12 0h4"/>',
  rectangle: '<rect x="3" y="5" width="18" height="14"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="5"/>',
  text: '<path d="M5 5h14M12 5v15M8 20h8"/>',
  point: '<circle cx="12" cy="12" r="5"/><path d="M12 2v20M2 12h20"/>',
  xline: '<path d="m3 21 18-18M6 12l6 6M2 17l5 5M17 2l5 5"/>',
  measure: '<path d="M3 12h18M6 8l-4 4 4 4m12-8 4 4-4 4M8 10v4m4-4v4m4-4v4"/>',
  area: '<path d="M4 4h16v16H4zM4 16l4 4M4 10l10 10M4 4l16 16M10 4l10 10M16 4l4 4"/>',
  move: '<path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M15 5V3H3v12h2"/>',
  rotate: '<path d="M5 8a8 8 0 1 1-1 7M5 3v5h5"/><path d="M12 9v4l3 2"/>',
  offset: '<path d="M3 8h13M3 16h18M13 4l4 4-4 4m5 0 4 4-4 4"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
  redo: '<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
  delete: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8"/>',
  grid: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
  open: '<path d="M3 19V5h6l2 3h10v3M3 19l3-8h16l-3 8H3Z"/>',
  save: '<path d="M4 3h13l4 4v14H3V3h1Z"/><path d="M7 3v6h10V3M7 21v-8h10v8M14 4v3"/>',
  export: '<path d="M13 3H4v18h16v-9M13 11l8-8m-6 0h6v6"/>',
  camera: '<path d="M3 6h5l2-3h4l2 3h5v14H3Z"/><circle cx="12" cy="13" r="4"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-9 10 9 5 9-5M3 18l9 5 9-5"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M14 3v18m3-13h2m-2 4h2m-2 4h2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0M12 14v3"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  logo: '<path d="M6 4v16M7 12l11-8M7 12l11 8M13 8v8" stroke-width="2.2"/>',
}

/** Trusted SVG artwork; unknown names fall back to the select icon. */
export function kjdrawIcon(name: string): string {
  return `<svg class="kj-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] ?? paths.select}</svg>`
}
