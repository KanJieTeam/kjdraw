// Generated from print-export.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJRevisionConflictError, KJValidationError } from './errors.js';
import { exportDrawingSvg } from './svg-export.js';
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
        styles: 'This browser could not apply the physical paper size. The drawing was not printed.'
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
        styles: '当前浏览器无法应用实际纸张尺寸，未执行打印。'
    }
};
function validateOptions(value, windowOptions = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![
        Object.prototype,
        null
    ].includes(Object.getPrototypeOf(value))) throw new KJValidationError('Print options must be plain data');
    const allowed = new Set([
        'layoutId',
        'maxEntities',
        'title',
        'locale',
        ...windowOptions ? [
            'ownerWindow',
            'isCurrent'
        ] : []
    ]);
    for (const key of Reflect.ownKeys(value)){
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || !allowed.has(key) || !('value' in descriptor)) throw new KJValidationError('Unknown or accessor print option');
    }
    const options = value;
    if (typeof options.layoutId !== 'string' || !options.layoutId) throw new KJValidationError('Print layoutId is required');
    if (options.title !== undefined && (typeof options.title !== 'string' || options.title.length > 256 || /[\u0000-\u001f\u007f]/u.test(options.title))) throw new KJValidationError('Print title must contain at most 256 printable characters');
    if (options.locale !== undefined && options.locale !== 'en' && options.locale !== 'zh-CN') throw new KJValidationError('Unsupported print locale');
    if (options.isCurrent !== undefined && typeof options.isCurrent !== 'function') throw new KJValidationError('Print identity guard must be a function');
}
const escapeHtml = (text)=>text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function printCss(paper) {
    const { widthMm: w, heightMm: h } = paper;
    return `@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0}body{background:#eee;color:#111;font-family:sans-serif;print-color-adjust:exact;-webkit-print-color-adjust:exact}.kj-print-note{box-sizing:border-box;max-width:${w}mm;padding:16px;line-height:1.5}.kj-print-note p{margin:0 0 8px}.kj-print-sheet{width:${w}mm;height:${h}mm;background:white;overflow:hidden}.kj-print-sheet text{font-family:"Noto Sans CJK SC","Microsoft YaHei","PingFang SC",sans-serif}.kj-print-sheet>svg{display:block;width:${w}mm;height:${h}mm;overflow:hidden}@media print{html,body{width:${w}mm;height:${h}mm;background:white}.kj-print-note{display:none}.kj-print-sheet{break-inside:avoid;break-after:avoid}}`;
}
export function createDrawingPrintHtml(document, options) {
    validateOptions(options);
    const locale = options.locale ?? 'en', text = copy[locale];
    const exported = exportDrawingSvg(document, {
        layoutId: options.layoutId,
        ...options.maxEntities === undefined ? {} : {
            maxEntities: options.maxEntities
        }
    });
    const { svg, mimeType: _svgType, ...drawing } = exported;
    const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'; object-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(options.title ?? text.title)}</title><style>${printCss(drawing.paper)}</style></head><body><aside class="kj-print-note" role="note"><p>${text.settings}</p>${drawing.report.approximations.length ? `<p>${text.fonts}</p>` : ''}<p>${drawing.paper.widthMm} × ${drawing.paper.heightMm} mm · REV ${drawing.revision}</p></aside><main class="kj-print-sheet">${svg}</main></body></html>`;
    if (new TextEncoder().encode(html).length > 8_400_000) throw new KJValidationError('Print HTML exceeds the output budget');
    if (document.revision !== drawing.revision) throw new KJRevisionConflictError(drawing.revision, document.revision);
    return Object.freeze({
        ...drawing,
        mimeType: 'text/html',
        html
    });
}
export async function openDrawingPrintWindow(document, options) {
    validateOptions(options, true);
    const { ownerWindow, isCurrent, ...exportOptions } = options, text = copy[options.locale ?? 'en'];
    const owner = ownerWindow ?? globalThis.window;
    if (!owner || typeof owner.open !== 'function') throw new KJValidationError(text.unavailable);
    if (isCurrent && !isCurrent()) throw new KJValidationError(text.stale);
    const output = createDrawingPrintHtml(document, exportOptions);
    const popup = owner.open('about:blank', '_blank');
    if (!popup) throw new KJValidationError(text.blocked);
    let timer;
    try {
        popup.opener = null;
        popup.document.open();
        popup.document.write(output.html);
        popup.document.close();
        const Sheet = popup.CSSStyleSheet;
        if (Sheet && 'adoptedStyleSheets' in popup.document) {
            const sheet = new Sheet();
            sheet.replaceSync(printCss(output.paper));
            popup.document.adoptedStyleSheets = [
                sheet
            ];
        }
        const sheet = popup.document.querySelector('.kj-print-sheet');
        const width = sheet?.getBoundingClientRect().width, height = sheet?.getBoundingClientRect().height;
        if (width === undefined || height === undefined || Math.abs(width - output.paper.widthMm * 96 / 25.4) > .1 || Math.abs(height - output.paper.heightMm * 96 / 25.4) > .1) throw new KJValidationError(text.styles);
        const start = Date.now();
        await Promise.race([
            popup.document.fonts.ready,
            new Promise((_resolve, reject)=>{
                timer = owner.setInterval(()=>{
                    if (popup.closed) reject(new KJValidationError(text.closed));
                    else if (Date.now() - start >= 10000) reject(new KJValidationError(text.fontTimeout));
                }, 100);
            })
        ]);
        if (popup.closed) throw new KJValidationError(text.closed);
        if (document.revision !== output.revision || isCurrent && !isCurrent()) throw new KJValidationError(text.stale);
        popup.focus();
        popup.print();
        return output;
    } catch (error) {
        popup.close();
        throw error;
    } finally{
        if (timer !== undefined) owner.clearInterval(timer);
    }
}
