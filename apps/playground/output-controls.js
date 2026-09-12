import { openDrawingPrintWindow } from '../../packages/kjdraw-sdk/src/print-export.js'
import { exportDrawingSvg } from '../../packages/kjdraw-sdk/src/svg-export.js'
import { captureDrawingView } from '../../packages/kjdraw-sdk/src/drawing-image.js'

const MILLIMETERS = Object.freeze({ millimeter: 1, centimeter: 10, meter: 1000, inch: 25.4, foot: 304.8 })
const positive = (value, name) => { if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw Error(`${name} must be positive`); return value }
const finite = (value, name) => { if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`${name} must be finite`); return value }

export function buildOutputPageSettings(drawing, layoutId, values) {
  const layout = drawing.getObject(layoutId), source = drawing.snapshot()
  if (!layout || !source.spaces.layoutIds.includes(layoutId)) throw Error('Output layout is no longer available')
  const model = layout.payload.blockRecordId === source.spaces.modelSpaceId
  const width = positive(values.width, 'Paper width'), height = positive(values.height, 'Paper height'), margin = finite(values.margin, 'Margin')
  if (width > 10000 || height > 10000 || margin < 0 || 2 * margin >= Math.min(width, height)) throw Error('Paper dimensions and margins leave no printable area')
  const settings = { paperWidth: width, paperHeight: height, paperUnits: 1, rotation: 0, flags: 0, plotType: model ? 4 : 5, scaleNumerator: 1, scaleDenominator: 1, marginLeft: margin, marginRight: margin, marginTop: margin, marginBottom: margin, originX: 0, originY: 0, printerName: '', styleSheet: '', shadeMode: 0 }
  if (model) {
    const unit = MILLIMETERS[source.header.units]
    if (!unit) throw Error('Set a supported drawing unit (mm, cm, m, in or ft) before configuring a physical model scale')
    settings.scaleNumerator = unit
    settings.scaleDenominator = positive(values.denominator, 'Scale denominator')
    settings.windowMinX = finite(values.x0, 'Window minimum X'); settings.windowMinY = finite(values.y0, 'Window minimum Y')
    settings.windowMaxX = finite(values.x1, 'Window maximum X'); settings.windowMaxY = finite(values.y1, 'Window maximum Y')
    const w = values.x1 - values.x0, h = values.y1 - values.y0, scale = unit / settings.scaleDenominator
    if (!(w > 0 && h > 0)) throw Error('Plot window must have positive width and height')
    if (w * scale > width - 2 * margin + 1e-8 || h * scale > height - 2 * margin + 1e-8) throw Error('Plot window does not fit at this scale. Increase paper size or the scale denominator; the scale will not be changed automatically.')
  }
  return settings
}

export function createOutputControls({ getContext, locale, select, request, run, execute, download, message, currentBounds, title }) {
  let lastDocument = null
  const zh = () => locale() === 'zh'
  const selected = () => {
    const context = getContext(), layoutId = select.value
    if (!context.document?.snapshot().spaces.layoutIds.includes(layoutId)) throw Error(zh() ? '请先选择出图布局' : 'Select an output layout first')
    return { ...context, layoutId }
  }
  const sync = () => {
    const drawing = getContext().document
    if (!drawing) return
    const source = drawing.snapshot(), previous = lastDocument === drawing ? select.value : source.spaces.activeLayoutId
    select.replaceChildren()
    for (const id of source.spaces.layoutIds) {
      const layout = drawing.getObject(id), option = document.createElement('option')
      option.value = id; option.textContent = layout.payload.blockRecordId === source.spaces.modelSpaceId ? (zh() ? '模型' : 'Model') : layout.name
      select.append(option)
    }
    select.value = source.spaces.layoutIds.includes(previous) ? previous : source.spaces.layoutIds[0]
    select.setAttribute('aria-label', zh() ? '出图布局' : 'Output layout'); lastDocument = drawing
  }
  const setup = () => run(async () => {
    const context = selected(), drawing = context.document, revision = drawing.revision, layout = drawing.getObject(context.layoutId)
    const model = layout.payload.blockRecordId === drawing.snapshot().spaces.modelSpaceId, settings = layout.payload.dxfPlotSettings ?? {}, bounds = currentBounds()
    const f = (name, label, value, extra = {}) => ({ name, label, value, type: 'number', step: 'any', ...extra })
    const fields = [f('width', zh() ? '纸宽（mm）' : 'Paper width (mm)', settings.paperWidth ?? 420, { min: 1, max: 10000 }), f('height', zh() ? '纸高（mm）' : 'Paper height (mm)', settings.paperHeight ?? 297, { min: 1, max: 10000 }), f('margin', zh() ? '四边页边距（mm）' : 'Margin on every side (mm)', settings.marginLeft ?? 10, { min: 0 })]
    if (model) {
      const unit = MILLIMETERS[drawing.snapshot().header.units]
      if (!unit) throw Error(zh() ? '请先使用 mm、cm、m、in 或 ft 单位的图纸。' : 'Use a drawing with mm, cm, m, in or ft units first.')
      const currentScale = settings.scaleNumerator && settings.scaleDenominator ? settings.scaleNumerator / settings.scaleDenominator * (settings.paperUnits === 0 ? 25.4 : 1) : null
      fields.push(f('denominator', zh() ? '比例 1 : N（输入 N）' : 'Scale 1 : N (enter N)', currentScale ? unit / currentScale : 100, { min: 0.000001 }))
      for (const [name, key, label, fallback] of [['x0', 'windowMinX', 'X min', bounds[0]], ['y0', 'windowMinY', 'Y min', bounds[1]], ['x1', 'windowMaxX', 'X max', bounds[2]], ['y1', 'windowMaxY', 'Y max', bounds[3]]]) fields.push(f(name, `${label} (${drawing.snapshot().header.units})`, settings[key] ?? Number(fallback.toPrecision(8))))
    }
    const values = await request({ title: zh() ? '页面设置' : 'Page setup', description: model ? (zh() ? '设置真实比例和出图窗口。窗口外的对象将被裁剪；不会自动缩放。' : 'Set the physical scale and plot window. Objects outside this window are clipped; no automatic scaling.') : (zh() ? '纸空间按 1:1 输出；模型比例由各视口决定。原有打印机、旋转和外部打印样式设置将替换。' : 'Paper space prints at 1:1; each viewport sets its model scale. Existing printer, rotation and external plot-style settings are replaced.'), fields })
    if (!values) return
    const current = getContext()
    if (current.document !== drawing || current.sdk !== context.sdk || drawing.revision !== revision) throw Error(zh() ? '图纸已改变，请重新设置页面' : 'The drawing changed. Open page setup again.')
    await execute('PAGESETUP', { layoutId: context.layoutId, dxf: buildOutputPageSettings(drawing, context.layoutId, values) })
    message(zh() ? '页面设置已保存，可撤销；请选择 SVG 或打印。' : 'Page setup saved and undoable. Choose SVG or Print.')
  })
  const svg = () => run(async () => {
    const context = selected(), result = exportDrawingSvg(context.document, { layoutId: context.layoutId })
    download(result.svg, 'drawing.svg', result.mimeType)
    message(`${result.paper.widthMm} × ${result.paper.heightMm} mm · SVG${result.report.approximations.length ? (zh() ? ' · 字体采用本机替代，请检查文字' : ' · Local font substitution; check text') : ''}`)
  })
  const png = () => run(async () => {
    const context = selected(), drawing = context.document, source = drawing.snapshot(), layout = drawing.getObject(context.layoutId)
    const spaceId = layout.payload.blockRecordId, model = spaceId === source.spaces.modelSpaceId, settings = layout.payload.dxfPlotSettings ?? {}
    let bounds
    if (model && settings.plotType === 4) bounds = [settings.windowMinX, settings.windowMinY, settings.windowMaxX, settings.windowMaxY]
    else if (!model && Number(settings.paperWidth) > 0 && Number(settings.paperHeight) > 0) bounds = [0, 0, settings.paperWidth, settings.paperHeight]
    else bounds = currentBounds()
    if (!bounds.every(Number.isFinite) || !(bounds[2] > bounds[0] && bounds[3] > bounds[1])) throw Error(zh() ? '当前出图范围无效，请先设置页面或执行全图。' : 'The output extent is invalid. Configure the page or fit the drawing first.')
    const aspect = (bounds[2] - bounds[0]) / (bounds[3] - bounds[1])
    const width = Math.max(1, Math.min(1400, Math.round(aspect >= 1 ? 1400 : 1400 * aspect)))
    const height = Math.max(1, Math.min(1400, Math.round(aspect >= 1 ? 1400 / aspect : 1400)))
    const result = await captureDrawingView(drawing, { spaceId, bounds, width, height, pixelRatio: 1, theme: 'light' })
    const report = result.renderReport
    if (report.unsupported || report.detailCulled || report.hatchDiagnostics?.some(item => item.reason === 'budget' || item.reason === 'unsupported-boundary')) {
      throw Error(zh() ? `PNG 已拒绝：${report.unsupported} 个对象不受支持，${report.detailCulled} 个细节因预算未绘制。` : `PNG refused: ${report.unsupported} unsupported object(s) and ${report.detailCulled} detail(s) omitted by the render budget.`)
    }
    const encoded = result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), binary = atob(encoded), bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    download(bytes, 'drawing.png', result.mimeType)
    const approximation = report.approximated ? (zh() ? ` · ${report.approximated} 个对象采用屏幕近似，请检查` : ` · ${report.approximated} object(s) use screen approximations; inspect the image`) : ''
    message(`${result.pixelWidth} × ${result.pixelHeight} px · PNG${approximation}`)
  })
  const print = () => run(async () => {
    const context = selected()
    await openDrawingPrintWindow(context.document, { layoutId: context.layoutId, title: title(context.document), locale: zh() ? 'zh-CN' : 'en', ownerWindow: window, isCurrent: () => { const current = getContext(); return current.sdk === context.sdk && current.document === context.document && select.value === context.layoutId } })
    message(zh() ? '打印已打开；可在浏览器中选择另存为 PDF。' : 'Print opened. Choose Save as PDF in your browser.')
  })
  return { sync, setup, svg, png, print }
}
