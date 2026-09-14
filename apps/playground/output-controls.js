import { openDrawingPrintPreview } from '../../packages/kjdraw-sdk/src/print-export.js'
import { exportDrawingSvg } from '../../packages/kjdraw-sdk/src/svg-export.js'
import { exportDrawingPng } from '../../packages/kjdraw-sdk/src/drawing-image.js'
import { displayedEntityBounds } from '../../packages/kjdraw-sdk/src/selection-geometry.js'

const MILLIMETERS = Object.freeze({ millimeter: 1, centimeter: 10, meter: 1000, inch: 25.4, foot: 304.8 })
export const OUTPUT_PAPER_PRESETS = Object.freeze({
  A0: Object.freeze([841, 1189]),
  A1: Object.freeze([594, 841]),
  A2: Object.freeze([420, 594]),
  A3: Object.freeze([297, 420]),
  A4: Object.freeze([210, 297]),
})
const positive = (value, name) => { if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw Error(`${name} must be positive`); return value }
const finite = (value, name) => { if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`${name} must be finite`); return value }

/** Resolve the bounded geometry that strict model-space output will actually
 * plot. Camera bounds are intentionally excluded: zooming and panning are view
 * operations and must not move a first-time SVG, PNG or print output. */
export function resolveOutputModelBounds(drawing, layoutId) {
  const source = drawing.snapshot(), layout = drawing.getObject(layoutId)
  if (!layout || !source.spaces.layoutIds.includes(layoutId) || layout.payload.blockRecordId !== source.spaces.modelSpaceId) throw Error('Output bounds require a model layout')
  const layers = new Map(drawing.getTable('layers')?.records.map(layer => [layer.id, layer.payload]) ?? [])
  const cache = new WeakMap()
  let minimumX = Infinity, minimumY = Infinity, maximumX = -Infinity, maximumY = -Infinity
  for (const entity of drawing.listEntities({ ownerId: source.spaces.modelSpaceId })) {
    const layer = layers.get(String(entity.payload.layerId ?? ''))
    if (entity.payload.visible === false || layer?.visible === false || layer?.frozen === true || layer?.plottable === false) continue
    const bounds = displayedEntityBounds(drawing, entity, cache)
    if (!bounds) continue
    minimumX = Math.min(minimumX, bounds[0]); minimumY = Math.min(minimumY, bounds[1])
    maximumX = Math.max(maximumX, bounds[2]); maximumY = Math.max(maximumY, bounds[3])
  }
  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) throw Error('No bounded visible model geometry is available for automatic output')
  const reference = Math.max(maximumX - minimumX, maximumY - minimumY, 1), epsilon = reference * 1e-6
  if (!(maximumX > minimumX)) { minimumX -= epsilon; maximumX += epsilon }
  if (!(maximumY > minimumY)) { minimumY -= epsilon; maximumY += epsilon }
  return Object.freeze([minimumX, minimumY, maximumX, maximumY])
}

export function outputPaperSize(preset, orientation = 'portrait') {
  const size = OUTPUT_PAPER_PRESETS[String(preset).toUpperCase()]
  if (!size) return null
  if (orientation !== 'portrait' && orientation !== 'landscape') throw Error('Paper orientation must be portrait or landscape')
  return orientation === 'portrait' ? { width: size[0], height: size[1] } : { width: size[1], height: size[0] }
}

export function detectOutputPaper(width, height) {
  for (const preset of Object.keys(OUTPUT_PAPER_PRESETS)) {
    const portrait = outputPaperSize(preset, 'portrait')
    if (width === portrait.width && height === portrait.height) return { preset, orientation: 'portrait' }
    if (width === portrait.height && height === portrait.width) return { preset, orientation: 'landscape' }
  }
  return { preset: 'custom', orientation: width > height ? 'landscape' : 'portrait' }
}

function outputPageSettingsError(error, chinese) {
  const text = error?.message ?? String(error)
  if (!chinese) return text
  if (text.includes('leave no printable area')) return '纸张尺寸和页边距没有留下可打印区域。'
  if (text.includes('positive width and height')) return '出图窗口必须具有正的宽度和高度。'
  if (text.includes('does not fit at this scale')) return '固定比例下放不进可打印区域。可直接选择“适合纸张并居中”出图。'
  if (text.includes('must be positive')) return '纸张尺寸和比例分母必须大于 0。'
  if (text.includes('must be finite')) return '页面设置必须填写有效数字。'
  return text
}

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
    settings.windowMinX = finite(values.x0, 'Window minimum X'); settings.windowMinY = finite(values.y0, 'Window minimum Y')
    settings.windowMaxX = finite(values.x1, 'Window maximum X'); settings.windowMaxY = finite(values.y1, 'Window maximum Y')
    const w = values.x1 - values.x0, h = values.y1 - values.y0
    if (!(w > 0 && h > 0)) throw Error('Plot window must have positive width and height')
    if (values.scaleMode === 'fit') {
      settings.flags = 20
      settings.standardScaleType = 0
    } else {
      settings.scaleNumerator = unit
      settings.scaleDenominator = positive(values.denominator, 'Scale denominator')
      const scale = unit / settings.scaleDenominator
      if (w * scale > width - 2 * margin + 1e-8 || h * scale > height - 2 * margin + 1e-8) throw Error('Plot window does not fit at this scale. Increase paper size or the scale denominator, or choose Fit to paper.')
    }
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
  const configure = async (context, nextAction = null) => {
    const drawing = context.document, revision = drawing.revision, layout = drawing.getObject(context.layoutId)
    const model = layout.payload.blockRecordId === drawing.snapshot().spaces.modelSpaceId, settings = layout.payload.dxfPlotSettings ?? {}
    const bounds = model ? (() => { try { return resolveOutputModelBounds(drawing, context.layoutId) } catch { return currentBounds() } })() : currentBounds()
    const f = (name, label, value, extra = {}) => ({ name, label, value, type: 'number', step: 'any', ...extra })
    const initialWidth = settings.paperWidth ?? 420, initialHeight = settings.paperHeight ?? 297
    const detectedPaper = detectOutputPaper(initialWidth, initialHeight)
    let previousPreset = detectedPaper.preset
    let customSize = detectedPaper.preset === 'custom' ? { width: initialWidth, height: initialHeight } : null
    const applyPaper = ({ get, set }) => {
      const preset = get('paperPreset'), orientation = get('paperOrientation')
      if (previousPreset === 'custom' && preset !== 'custom') customSize = { width: Number(get('width')), height: Number(get('height')) }
      if (preset === 'custom') {
        if (previousPreset !== 'custom' && customSize) { set('width', customSize.width); set('height', customSize.height) }
      } else {
        const size = outputPaperSize(preset, orientation)
        set('width', size.width); set('height', size.height)
      }
      previousPreset = preset
    }
    const fields = [
      { name: 'paperPreset', label: zh() ? '纸张预设' : 'Paper preset', value: detectedPaper.preset, options: [['A0', 'ISO A0'], ['A1', 'ISO A1'], ['A2', 'ISO A2'], ['A3', 'ISO A3'], ['A4', 'ISO A4'], ['custom', zh() ? '自定义' : 'Custom']], onChange: applyPaper },
      { name: 'paperOrientation', label: zh() ? '方向' : 'Orientation', value: detectedPaper.orientation, options: [['portrait', zh() ? '纵向' : 'Portrait'], ['landscape', zh() ? '横向' : 'Landscape']], onChange: applyPaper },
      f('width', zh() ? '纸宽（mm）' : 'Paper width (mm)', initialWidth, { min: 1, max: 10000 }),
      f('height', zh() ? '纸高（mm）' : 'Paper height (mm)', initialHeight, { min: 1, max: 10000 }),
      f('margin', zh() ? '四边页边距（mm）' : 'Margin on every side (mm)', settings.marginLeft ?? 10, { min: 0 }),
    ]
    if (model) {
      const unit = MILLIMETERS[drawing.snapshot().header.units]
      if (!unit) throw Error(zh() ? '请先使用 mm、cm、m、in 或 ft 单位的图纸。' : 'Use a drawing with mm, cm, m, in or ft units first.')
      const currentScale = settings.scaleNumerator && settings.scaleDenominator ? settings.scaleNumerator / settings.scaleDenominator * (settings.paperUnits === 0 ? 25.4 : 1) : null
      let initialScaleMode = (settings.flags & 16) !== 0 && settings.standardScaleType === 0 ? 'fit' : settings.flags === undefined ? 'fit' : 'custom'
      if (initialScaleMode === 'custom') {
        try {
          buildOutputPageSettings(drawing, context.layoutId, {
            width: initialWidth, height: initialHeight, margin: settings.marginLeft ?? 10,
            scaleMode: 'custom', denominator: currentScale ? unit / currentScale : 100,
            x0: settings.windowMinX ?? bounds[0], y0: settings.windowMinY ?? bounds[1],
            x1: settings.windowMaxX ?? bounds[2], y1: settings.windowMaxY ?? bounds[3],
          })
        } catch { initialScaleMode = 'fit' }
      }
      fields.push({ name: 'scaleMode', label: zh() ? '缩放方式' : 'Scale mode', value: initialScaleMode, options: [['fit', zh() ? '适合纸张并居中（推荐）' : 'Fit to paper and center (recommended)'], ['custom', zh() ? '固定比例 1 : N' : 'Fixed scale 1 : N']], onChange: ({ get, setDisabled }) => setDisabled('denominator', get('scaleMode') === 'fit') })
      fields.push(f('denominator', zh() ? '固定比例分母 N' : 'Fixed-scale denominator N', currentScale ? unit / currentScale : 100, { min: 0.000001, disabled: initialScaleMode === 'fit' }))
      for (const [name, key, label, fallback] of [['x0', 'windowMinX', 'X min', bounds[0]], ['y0', 'windowMinY', 'Y min', bounds[1]], ['x1', 'windowMaxX', 'X max', bounds[2]], ['y1', 'windowMaxY', 'Y max', bounds[3]]]) fields.push(f(name, `${label} (${drawing.snapshot().header.units})`, settings[key] ?? Number(fallback.toPrecision(8))))
    }
    const values = await request({ title: zh() ? '页面设置' : 'Page setup', description: model ? (zh() ? '默认适合纸张并居中，可直接出图。只有必须按工程比例出图时才选择固定比例。' : 'Fit to paper and center is the default. Choose a fixed engineering scale only when the deliverable requires it.') : (zh() ? '纸空间按 1:1 输出；模型比例由各视口决定。原有打印机、旋转和外部打印样式设置将替换。' : 'Paper space prints at 1:1; each viewport sets its model scale. Existing printer, rotation and external plot-style settings are replaced.'), fields, validate: candidate => { try { buildOutputPageSettings(drawing, context.layoutId, candidate); return '' } catch (error) { return outputPageSettingsError(error, zh()) } } })
    if (!values) return
    const current = getContext()
    if (current.document !== drawing || current.sdk !== context.sdk || drawing.revision !== revision) throw Error(zh() ? '图纸已改变，请重新设置页面' : 'The drawing changed. Open page setup again.')
    await execute('PAGESETUP', { layoutId: context.layoutId, dxf: buildOutputPageSettings(drawing, context.layoutId, values) })
    message(nextAction
      ? (zh() ? `页面设置已保存，可撤销；请再次点击 ${nextAction} 出图。` : `Page setup saved and undoable. Choose ${nextAction} again to create the output.`)
      : (zh() ? '页面设置已保存，可撤销；请选择 SVG、PNG 或打印。' : 'Page setup saved and undoable. Choose SVG, PNG or Print.'))
    return true
  }
  const setup = () => run(() => configure(selected()))
  const ready = async context => {
    if (context.document.getObject(context.layoutId)?.payload.dxfPlotSettings) return true
    const layout = context.document.getObject(context.layoutId), model = layout?.payload.blockRecordId === context.document.snapshot().spaces.modelSpaceId
    const bounds = model ? (() => { try { return resolveOutputModelBounds(context.document, context.layoutId) } catch { return currentBounds() } })() : currentBounds()
    const paper = { width: 420, height: 297, margin: 10 }
    await execute('PAGESETUP', { layoutId: context.layoutId, dxf: buildOutputPageSettings(context.document, context.layoutId, { ...paper, scaleMode: 'fit', denominator: 100, x0: bounds[0], y0: bounds[1], x1: bounds[2], y1: bounds[3] }) })
    message(zh() ? '已自动适合 A3 横向纸张并居中，可在页面设置中改为固定比例。' : 'Automatically fitted and centered on A3 landscape. Use Page setup for a fixed scale.')
    return true
  }
  const svg = () => run(async () => {
    const context = selected()
    if (!await ready(context, 'SVG')) return
    const result = exportDrawingSvg(context.document, { layoutId: context.layoutId })
    download(result.svg, 'drawing.svg', result.mimeType)
    message(`${result.paper.widthMm} × ${result.paper.heightMm} mm · SVG${result.report.approximations.length ? (zh() ? ' · 字体采用本机替代，请检查文字' : ' · Local font substitution; check text') : ''}`)
  })
  const png = () => run(async () => {
    const context = selected()
    if (!await ready(context, 'PNG')) return
    const result = await exportDrawingPng(context.document, { layoutId: context.layoutId, maxEdge: 1400, theme: 'light' })
    const report = result.renderReport
    const encoded = result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), binary = atob(encoded), bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    download(bytes, 'drawing.png', result.mimeType)
    const approximation = report.approximated ? (zh() ? ` · ${report.approximated} 个对象采用屏幕近似，请检查` : ` · ${report.approximated} object(s) use screen approximations; inspect the image`) : ''
    message(`${result.pixelWidth} × ${result.pixelHeight} px · PNG${approximation}`)
  })
  const print = () => run(async () => {
    const context = selected()
    if (!await ready(context, zh() ? '打印 / PDF' : 'Print / PDF')) return
    await openDrawingPrintPreview(context.document, { layoutId: context.layoutId, title: title(context.document), locale: zh() ? 'zh-CN' : 'en', ownerWindow: window, isCurrent: () => { const current = getContext(); return current.sdk === context.sdk && current.document === context.document && select.value === context.layoutId } })
    message(zh() ? '打印预览已打开；核对纸张和比例后，可打印或保存 PDF。' : 'Print preview opened. Review the paper and scale, then print or save PDF.')
  })
  return { sync, setup, svg, png, print }
}
