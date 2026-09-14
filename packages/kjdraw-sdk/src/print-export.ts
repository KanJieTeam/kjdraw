import type { KJDocument } from './document.js'
import { KJRevisionConflictError, KJValidationError } from './errors.js'
import { exportDrawingSvg, type KJSvgDrawingExport } from './svg-export.js'

export interface KJDrawingPrintOptions {
  layoutId: string
  maxEntities?: number
  title?: string
  locale?: 'en' | 'zh-CN'
}

export interface KJDrawingPrintHtml extends Omit<KJSvgDrawingExport, 'svg' | 'mimeType'> {
  html: string
  mimeType: 'text/html'
}

export interface KJDrawingPrintWindowOptions extends KJDrawingPrintOptions {
  /** Window receiving the user gesture; defaults to the current browser window. */
  ownerWindow?: Window
  /** Host identity guard, checked before opening and after fonts are ready. */
  isCurrent?: () => boolean
}

export type KJDrawingPrintPreviewWindowOptions = KJDrawingPrintWindowOptions

const copy = {
  en: {
    title: 'KJDraw drawing',
    settings: 'Print at 100% / actual size, with no browser margins, headers or footers. Choose Save as PDF for a vector PDF. Browser paper dimensions may be rounded; confirm the paper size and scale in the print dialog.',
    fonts: 'Text uses available system fonts. Glyph appearance and spacing may differ from the original CAD font.',
    blocked: 'The print window was blocked. Allow popups for this site and try again.',
    unavailable: 'Printing requires a browser window.',
    closed: 'The print window was closed before printing.',
    stale: 'The drawing changed while preparing to print. Open printing again for the current drawing.',
    fontTimeout: 'Fonts did not become ready in time. The drawing was not printed.',
    styles: 'This browser could not apply the physical paper size. The drawing was not printed.',
    preview: 'Print preview',
    print: 'Print / Save PDF',
    close: 'Close',
    ready: 'Vector preview ready. Review the paper and scale, then print at 100% / actual size.',
    paperSpace: 'Paper space 1:1 · actual size',
    scale: 'Scale',
    drawingUnit: 'drawing unit',
  },
  'zh-CN': {
    title: 'KJDraw 图纸',
    settings: '请按 100%／实际大小打印，关闭浏览器边距、页眉和页脚。选择“另存为 PDF”可生成矢量 PDF。浏览器可能对纸张尺寸取整，请在打印对话框中核对纸张和比例。',
    fonts: '文字使用当前系统可用字体，字形和间距可能与原 CAD 字体不同。',
    blocked: '打印窗口被浏览器拦截。请允许本站弹出窗口后重试。',
    unavailable: '打印需要浏览器窗口。',
    closed: '打印前窗口已关闭。',
    stale: '准备打印时图纸已变化，请重新打开当前图纸的打印。',
    fontTimeout: '字体未能及时加载，未执行打印。',
    styles: '当前浏览器无法应用实际纸张尺寸，未执行打印。',
    preview: '打印预览',
    print: '打印 / 保存 PDF',
    close: '关闭',
    ready: '矢量预览已就绪。请核对纸张和比例，并按 100%／实际大小打印。',
    paperSpace: '纸空间 1:1 · 实际尺寸',
    scale: '比例',
    drawingUnit: '绘图单位',
  },
}

function validateOptions(value: unknown, windowOptions = false): asserts value is KJDrawingPrintWindowOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new KJValidationError('Print options must be plain data')
  const allowed = new Set(['layoutId', 'maxEntities', 'title', 'locale', ...(windowOptions ? ['ownerWindow', 'isCurrent'] : [])])
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== 'string' || !allowed.has(key) || !('value' in descriptor)) throw new KJValidationError('Unknown or accessor print option')
  }
  const options = value as KJDrawingPrintWindowOptions
  if (typeof options.layoutId !== 'string' || !options.layoutId) throw new KJValidationError('Print layoutId is required')
  if (options.title !== undefined && (typeof options.title !== 'string' || options.title.length > 256 || /[\u0000-\u001f\u007f]/u.test(options.title))) throw new KJValidationError('Print title must contain at most 256 printable characters')
  if (options.locale !== undefined && options.locale !== 'en' && options.locale !== 'zh-CN') throw new KJValidationError('Unsupported print locale')
  if (options.isCurrent !== undefined && typeof options.isCurrent !== 'function') throw new KJValidationError('Print identity guard must be a function')
}

const escapeHtml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

// Only dimensions returned by the strict SVG exporter enter CSS. Never accept host/user CSS.
function printCss(paper: KJSvgDrawingExport['paper']): string {
  const { widthMm: w, heightMm: h } = paper
  // Keep the SVG's font-family attributes; overriding them here would make a
  // downloaded SVG and the same drawing's print/PDF resolve different fonts.
  return `@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0}body{background:#e9edf2;color:#182230;font-family:Arial,sans-serif;print-color-adjust:exact;-webkit-print-color-adjust:exact}.kj-print-preview{position:sticky;top:0;z-index:2;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 18px;border-bottom:1px solid #c8d0da;background:#fff;box-shadow:0 2px 12px #1822301f}.kj-print-preview h1{margin:0 0 5px;font-size:17px}.kj-print-meta{display:flex;flex-wrap:wrap;gap:7px 16px;font-size:13px;color:#526070}.kj-print-meta strong{color:#182230}.kj-print-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}.kj-print-actions button{min-height:36px;padding:7px 13px;border:1px solid #9aa8ba;border-radius:5px;background:#fff;color:#182230;font:600 13px Arial,sans-serif;cursor:pointer}.kj-print-actions button:first-child{border-color:#2867c7;background:#2867c7;color:#fff}.kj-print-actions button:disabled{opacity:.55;cursor:wait}.kj-print-status{margin:0;padding:10px 18px;background:#f7f9fb;color:#526070;font-size:12px}.kj-print-note{box-sizing:border-box;max-width:${w}mm;margin:12px auto 0;padding:12px 16px;line-height:1.5;background:#fff;border:1px solid #d7dde5}.kj-print-note p{margin:0 0 8px}.kj-print-sheet{width:${w}mm;height:${h}mm;margin:12px auto 24px;background:white;overflow:hidden;box-shadow:0 4px 22px #1822302e}.kj-print-sheet>svg{display:block;width:${w}mm;height:${h}mm;overflow:hidden}@media print{html,body{width:${w}mm;height:${h}mm;background:white}.kj-print-preview,.kj-print-status,.kj-print-note{display:none}.kj-print-sheet{margin:0;box-shadow:none;break-inside:avoid;break-after:avoid}}`
}

const formatNumber = (value: number): string => Number(value.toPrecision(8)).toLocaleString('en-US', { maximumFractionDigits: 8 })
const millimeters = Object.freeze({ millimeter: 1, centimeter: 10, meter: 1000, inch: 25.4, foot: 304.8 })

function previewScale(document: KJDocument, output: KJDrawingPrintHtml, locale: 'en' | 'zh-CN'): string {
  const text = copy[locale]
  if (output.plot.sourceRange.kind === 'layout') return text.paperSpace
  const unit = String(document.snapshot().header.units ?? ''), unitMillimeters = millimeters[unit as keyof typeof millimeters]
  if (!unitMillimeters) return `${formatNumber(output.paper.millimetersPerDrawingUnit)} mm / ${text.drawingUnit}`
  const denominator = unitMillimeters / output.paper.millimetersPerDrawingUnit
  return `${text.scale} 1:${formatNumber(denominator)} · 1 ${unit} = ${formatNumber(output.paper.millimetersPerDrawingUnit)} mm`
}

function createPreviewOutput(document: KJDocument, output: KJDrawingPrintHtml, options: KJDrawingPrintOptions): KJDrawingPrintHtml {
  const locale = options.locale ?? 'en', text = copy[locale]
  const controls = `<header class="kj-print-preview"><div><h1>${escapeHtml(options.title ?? text.preview)}</h1><div class="kj-print-meta"><strong>${output.paper.widthMm} × ${output.paper.heightMm} mm</strong><span>${escapeHtml(previewScale(document, output, locale))}</span><span>REV ${output.revision}</span><span>${output.report.rendered} vector object${output.report.rendered === 1 ? '' : 's'}</span></div></div><div class="kj-print-actions"><button id="kj-print-action" type="button" disabled>${text.print}</button><button id="kj-print-close" type="button">${text.close}</button></div></header><p class="kj-print-status" role="status">${text.ready}</p>`
  const html = output.html.replace('<body>', `<body>${controls}`)
  if (new TextEncoder().encode(html).length > 8_400_000) throw new KJValidationError('Print HTML exceeds the output budget')
  return Object.freeze({ ...output, html })
}

/** Strict, read-only vector print document. This returns HTML, never PDF bytes. */
export function createDrawingPrintHtml(document: KJDocument, options: KJDrawingPrintOptions): KJDrawingPrintHtml {
  validateOptions(options)
  const locale = options.locale ?? 'en', text = copy[locale]
  const exported = exportDrawingSvg(document, { layoutId: options.layoutId, ...(options.maxEntities === undefined ? {} : { maxEntities: options.maxEntities }) })
  const { svg, mimeType: _svgType, ...drawing } = exported
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'; object-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(options.title ?? text.title)}</title><style>${printCss(drawing.paper)}</style></head><body><aside class="kj-print-note" role="note"><p>${text.settings}</p>${drawing.report.approximations.length ? `<p>${text.fonts}</p>` : ''}<p>${drawing.paper.widthMm} × ${drawing.paper.heightMm} mm · REV ${drawing.revision}</p></aside><main class="kj-print-sheet">${svg}</main></body></html>`
  if (new TextEncoder().encode(html).length > 8_400_000) throw new KJValidationError('Print HTML exceeds the output budget')
  if (document.revision !== drawing.revision) throw new KJRevisionConflictError(drawing.revision, document.revision)
  return Object.freeze({ ...drawing, mimeType: 'text/html', html })
}

async function prepareDrawingPrintWindow(document: KJDocument, options: KJDrawingPrintWindowOptions, preview: boolean): Promise<{ output: KJDrawingPrintHtml, popup: Window, owner: Window, text: typeof copy.en }> {
  validateOptions(options, true)
  const { ownerWindow, isCurrent, ...exportOptions } = options, text = copy[options.locale ?? 'en']
  const owner = ownerWindow ?? globalThis.window
  if (!owner || typeof owner.open !== 'function') throw new KJValidationError(text.unavailable)
  if (isCurrent && !isCurrent()) throw new KJValidationError(text.stale)
  const base = createDrawingPrintHtml(document, exportOptions)
  const output = preview ? createPreviewOutput(document, base, exportOptions) : base
  // This call occurs before any await, preserving the host's real click activation.
  const popup = owner.open('about:blank', '_blank')
  if (!popup) throw new KJValidationError(text.blocked)
  let timer: number | undefined
  try {
    popup.opener = null
    popup.document.open(); popup.document.write(output.html); popup.document.close()
    if (preview) popup.document.querySelector('#kj-print-close')?.addEventListener('click', () => popup.close())
    // about:blank inherits a host CSP which can forbid inline <style>. A trusted
    // CSSOM sheet applies the same finite generated rules without weakening CSP.
    const Sheet = (popup as unknown as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet
    if (Sheet && 'adoptedStyleSheets' in popup.document) {
      const sheet = new Sheet(); sheet.replaceSync(printCss(output.paper)); popup.document.adoptedStyleSheets = [sheet]
    }
    const sheet = popup.document.querySelector<HTMLElement>('.kj-print-sheet')
    const width = sheet?.getBoundingClientRect().width, height = sheet?.getBoundingClientRect().height
    if (width === undefined || height === undefined || Math.abs(width - output.paper.widthMm * 96 / 25.4) > .1 || Math.abs(height - output.paper.heightMm * 96 / 25.4) > .1) throw new KJValidationError(text.styles)
    const start = Date.now()
    await Promise.race([
      popup.document.fonts.ready,
      new Promise<never>((_resolve, reject) => {
        timer = owner.setInterval(() => {
          if (popup.closed) reject(new KJValidationError(text.closed))
          else if (Date.now() - start >= 10000) reject(new KJValidationError(text.fontTimeout))
        }, 100)
      }),
    ])
    if (popup.closed) throw new KJValidationError(text.closed)
    if (document.revision !== output.revision || isCurrent && !isCurrent()) throw new KJValidationError(text.stale)
    return { output, popup, owner, text }
  } catch (error) {
    popup.close()
    throw error
  } finally {
    if (timer !== undefined) owner.clearInterval(timer)
  }
}

/** Open a user-initiated print dialog after verifying the snapshot and local fonts. No automatic PDF download. */
export async function openDrawingPrintWindow(document: KJDocument, options: KJDrawingPrintWindowOptions): Promise<KJDrawingPrintHtml> {
  const { output, popup } = await prepareDrawingPrintWindow(document, options, false)
  popup.focus(); popup.print()
  return output
}

/** Open a safe vector preview. Printing starts only from its explicit Print / Save PDF button. */
export async function openDrawingPrintPreview(document: KJDocument, options: KJDrawingPrintPreviewWindowOptions): Promise<KJDrawingPrintHtml> {
  const { output, popup, text } = await prepareDrawingPrintWindow(document, options, true)
  const button = popup.document.querySelector<HTMLButtonElement>('#kj-print-action')!
  const status = popup.document.querySelector<HTMLElement>('.kj-print-status')!
  button.addEventListener('click', () => {
    if (document.revision !== output.revision || options.isCurrent && !options.isCurrent()) {
      button.disabled = true; status.textContent = text.stale; return
    }
    popup.focus(); popup.print()
  })
  button.disabled = false
  popup.focus()
  return output
}
