import type { KJDocument } from './document.js'
import type { KJReadonlyObjectRecord } from './schema.js'
import { KJRevisionConflictError, KJValidationError } from './errors.js'
import { resolvePhysicalPlotPaper, resolvePlotScale, validatePlotSettings } from './plot-settings.js'
import { resolveDxfPlotSource } from './plot-range.js'
import { insertAttributes, isAttachedAttribute } from './attribute-display.js'
import { layoutCadMText, textFontFamily } from './geometry/text-layout.js'
import { aciColor } from './canvas-renderer.js'
import { projectDimension } from './geometry/annotation.js'
import { multiply3, rotation3, scale3, translation3, type AffineMatrix3 } from './geometry/matrix3.js'
import { deepFreeze } from './utils.js'
import { effectiveLinetypeScale } from './linetype-scale.js'
import { closedHatchSplineConic } from './geometry/hatch-boundary.js'

export interface KJSvgExportOptions { layoutId: string; allowPartial?: boolean; maxEntities?: number }
export interface KJSvgDiagnostic { entityId: string; type: string; reason: string }
export interface KJSvgExportReport {
  status: 'complete' | 'approximate' | 'partial'
  rendered: number; hidden: number
  diagnostics: KJSvgDiagnostic[]; approximations: KJSvgDiagnostic[]
  viewports: { entityId: string; millimetersPerModelUnit: number; matrix: AffineMatrix3 }[]
}
export interface KJSvgDrawingExport {
  svg: string; mimeType: 'image/svg+xml'; documentId: string; revision: number; layoutId: string
  paper: { widthMm: number; heightMm: number; millimetersPerDrawingUnit: number }
  plot: {
    /** Physical printable rectangle in a lower-left paper coordinate system. */
    printableAreaMm: { minimum: readonly [number, number]; maximum: readonly [number, number]; width: number; height: number }
    /** Drawing origin measured from the lower-left paper edge. */
    plotOriginMm: readonly [number, number]
    /** Exact source coordinates admitted by the physical page and selected plot range. */
    sourceRange: { kind: 'layout' | 'layout-limits' | 'window' | 'view'; minimum: readonly [number, number]; maximum: readonly [number, number] }
    /** Drawing XY to SVG paper millimeters, whose origin is the page's upper-left corner. */
    drawingToPaperMatrix: AffineMatrix3
  }
  report: KJSvgExportReport
}
type Data = Readonly<Record<string, unknown>>
type Point = readonly [number, number]
const data = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
function fail(reason: string): never { throw new KJValidationError(`SVG export: ${reason}`) }
function numeric(value: unknown, fallback?: number): number {
  if (value == null && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('expected a finite number')
  return value as number
}
function point(value: unknown): Point {
  if (!Array.isArray(value) || value.length < 2) fail('expected an XY point')
  if (numeric(value[2], 0) !== 0) fail('non-XY geometry is unsupported')
  return [numeric(value[0]), numeric(value[1])]
}
function xml(value: unknown): string {
  const text = String(value)
  if (text.length > 1_048_576) fail('text exceeds the 1 MiB character budget')
  for (const char of text) { const n = char.codePointAt(0)!; if (!(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0xD7FF || n >= 0xE000 && n <= 0xFFFD || n >= 0x10000 && n <= 0x10FFFF)) fail('invalid XML character') }
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}
const matrix = (value: readonly number[]) => value.map(v => numeric(v)).join(' ')
const pos = (p: Point) => `${numeric(p[0])} ${numeric(p[1])}`
const TAU = Math.PI * 2
function arcPath(center: Point, radius: number, start: number, end: number, clockwise = false): string {
  if (!(radius > 0)) fail('arc radius must be positive')
  const at = (angle: number): Point => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]
  let sweep = clockwise ? start - end : end - start
  sweep = ((sweep % TAU) + TAU) % TAU || TAU
  const finish = start + (clockwise ? -sweep : sweep), flag = clockwise ? 0 : 1
  const tail = sweep === TAU ? `A ${radius} ${radius} 0 0 ${flag} ${pos(at(start + (clockwise ? -Math.PI : Math.PI)))} A ${radius} ${radius} 0 0 ${flag} ${pos(at(finish))}` : `A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} ${flag} ${pos(at(finish))}`
  return `M ${pos(at(start))} ${tail}`
}
function polyPath(vertices: unknown, closed: boolean): string {
  if (!Array.isArray(vertices) || vertices.length < 2 || vertices.length > 50000) fail('polyline requires 2–50000 vertices')
  const rows = vertices.map(v => ({ p: point(Array.isArray(v) ? v : data(v).point), bulge: numeric(data(v).bulge, 0), startWidth: numeric(data(v).startWidth, 0), endWidth: numeric(data(v).endWidth, 0) }))
  if (rows.some(row => row.startWidth !== 0 || row.endWidth !== 0)) fail('variable-width polyline is unsupported')
  let path = `M ${pos(rows[0]!.p)}`
  for (let i = 0; i < rows.length - (closed ? 0 : 1); i++) {
    const a = rows[i]!, b = rows[(i + 1) % rows.length]!, chord = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1])
    if (!a.bulge) path += ` L ${pos(b.p)}`
    else { if (!chord) fail('degenerate bulge segment'); const radius = chord * (1 + a.bulge * a.bulge) / (4 * Math.abs(a.bulge)); path += ` A ${radius} ${radius} 0 ${Math.abs(a.bulge) > 1 ? 1 : 0} ${a.bulge > 0 ? 1 : 0} ${pos(b.p)}` }
  }
  return path + (closed ? ' Z' : '')
}
function hatchEdgePath(value: unknown): string {
  const loop=data(value),edges=loop.edges
  if(!Array.isArray(edges)||!edges.length||edges.length>4096)fail('hatch edge loop requires 1–4096 edges')
  let path=''
  for(const [index,raw] of edges.entries()){
    const edge=data(raw),type=String(edge.type).toUpperCase()
    if(type==='LINE'){
      const a=point(edge.start),b=point(edge.end);path+=`${index?` L ${pos(a)}`:`M ${pos(a)}`} L ${pos(b)}`;continue
    }
    if(type==='SPLINE'){
      const conic=closedHatchSplineConic(edge)
      if(!conic||edges.length!==1)fail('SVG export supports a SPLINE hatch loop only when it is one verified closed rational-quadratic conic')
      return hatchEdgePath({edges:[{type:'ELLIPSE',...conic,startAngle:0,endAngle:TAU}]})
    }
    const center=point(edge.center),start=numeric(edge.startAngle),end=numeric(edge.endAngle),ccw=edge.counterClockwise!==false
    const rawSweep=ccw?end-start:start-end,sweep=Math.abs(rawSweep)>=TAU-1e-12?TAU:((rawSweep%TAU)+TAU)%TAU
    if(type==='ARC'){
      const radius=numeric(edge.radius);if(!(radius>0))fail('hatch arc radius must be positive')
      const at=(angle:number):Point=>[center[0]+radius*Math.cos(angle),center[1]+radius*Math.sin(angle)],finish=start+(ccw?sweep:-sweep),flag=ccw?1:0
      path+=index?` L ${pos(at(start))}`:`M ${pos(at(start))}`
      path+=sweep===TAU?` A ${radius} ${radius} 0 0 ${flag} ${pos(at(start+(ccw?Math.PI:-Math.PI)))} A ${radius} ${radius} 0 0 ${flag} ${pos(at(finish))}`:` A ${radius} ${radius} 0 ${sweep>Math.PI?1:0} ${flag} ${pos(at(finish))}`
      continue
    }
    if(type==='ELLIPSE'){
      const axis=point(edge.majorAxis),radius=Math.hypot(axis[0],axis[1]),ratio=numeric(edge.ratio);if(!(radius>0&&ratio>0&&ratio<=1))fail('invalid hatch ellipse edge')
      const at=(angle:number):Point=>[center[0]+axis[0]*Math.cos(angle)-axis[1]*ratio*Math.sin(angle),center[1]+axis[1]*Math.cos(angle)+axis[0]*ratio*Math.sin(angle)],finish=start+(ccw?sweep:-sweep),rotation=Math.atan2(axis[1],axis[0])*180/Math.PI,flag=ccw?1:0
      path+=index?` L ${pos(at(start))}`:`M ${pos(at(start))}`
      path+=sweep===TAU?` A ${radius} ${radius*ratio} ${rotation} 0 ${flag} ${pos(at(start+(ccw?Math.PI:-Math.PI)))} A ${radius} ${radius*ratio} ${rotation} 0 ${flag} ${pos(at(finish))}`:` A ${radius} ${radius*ratio} ${rotation} ${sweep>Math.PI?1:0} ${flag} ${pos(at(finish))}`
      continue
    }
    fail(`unsupported hatch edge ${type}`)
  }
  return path+' Z'
}

/** Editable vector output with explicit physical paper units. No raster fallback, network resources or implicit fit-to-paper. */
export function exportDrawingSvg(document: KJDocument, options: KJSvgExportOptions): KJSvgDrawingExport {
  const source = document.snapshot(), revision = document.revision
  if (!options || typeof options.layoutId !== 'string' || typeof options.allowPartial !== 'undefined' && typeof options.allowPartial !== 'boolean') fail('layoutId and valid export options are required')
  const max = options.maxEntities ?? 10000
  if (!Number.isSafeInteger(max) || max < 1 || max > 50000) fail('entity budget must be 1–50000')
  const layout = document.getObject(options.layoutId)
  if (!layout || layout.kind !== 'layout' || !source.spaces.layoutIds.includes(layout.id)) fail('unknown layout')
  const spaceId = String(layout.payload.blockRecordId), isModel = spaceId === source.spaces.modelSpaceId
  if (!isModel && !source.spaces.paperSpaceIds.includes(spaceId)) fail('layout has no valid drawing space')
  const settings = layout.payload.dxfPlotSettings
  if (!settings) fail('configure explicit paper dimensions and a custom scale with PAGESETUP before exporting SVG')
  validatePlotSettings(settings)
  const rawWidth = numeric(settings.paperWidth), rawHeight = numeric(settings.paperHeight)
  if (rawWidth <= 0 || rawHeight <= 0 || rawWidth > 10000 || rawHeight > 10000) fail('paper dimensions must be positive millimeters, at most 10000')
  if (settings.styleSheet || settings.printerName || numeric(settings.shadeMode, 0) !== 0) fail('external plot styles, printer-specific configuration and shaded plotting are unsupported')
  const paperUnits = numeric(settings.paperUnits, 1)
  if (paperUnits !== 0 && paperUnits !== 1) fail('pixel paper units have no supported physical scale')
  const physical = resolvePhysicalPlotPaper(settings)
  const { width, height, left, right, top, bottom } = physical
  if (left + right >= width || top + bottom >= height) fail('margins leave no printable area')
  const printableWidth = width - left - right, printableHeight = height - top - bottom
  let plotSource
  try { plotSource = resolveDxfPlotSource(document, layout.id, settings, isModel) }
  catch (error) { fail(error instanceof Error ? error.message : 'invalid plot source') }
  let x = 0, y = 0, sourceMinimumX = 0, sourceMinimumY = 0, maximumX = 0, maximumY = 0, plotClip = ''
  let plotWidth: number | undefined, plotHeight: number | undefined
  if (plotSource.bounded) {
    x = plotSource.minimum[0]; y = plotSource.minimum[1]
    maximumX = plotSource.maximum[0]; maximumY = plotSource.maximum[1]
    sourceMinimumX = x; sourceMinimumY = y
    plotWidth = plotSource.width; plotHeight = plotSource.height
    plotClip = `<clipPath id="kj-plot-range" clipPathUnits="userSpaceOnUse"><rect x="${x}" y="${y}" width="${plotWidth}" height="${plotHeight}"/></clipPath>`
  }
  let resolved
  try { resolved = resolvePlotScale(settings, { printableWidth, printableHeight, sourceWidth: plotWidth, sourceHeight: plotHeight, isModel }) }
  catch (error) { fail(error instanceof Error ? error.message : 'invalid plot scale') }
  const scale = resolved.millimetersPerDrawingUnit, originX = resolved.originX, originY = resolved.originY
  if (!plotSource.bounded) {
    sourceMinimumX = originX === 0 ? 0 : -originX / scale; sourceMinimumY = originY === 0 ? 0 : -originY / scale
    maximumX = printableWidth / scale - originX / scale; maximumY = printableHeight / scale - originY / scale
  }
  const pageMatrix = multiply3(translation3(left + originX, height - bottom - originY), multiply3(scale3(scale, -scale), translation3(-x, -y)))
  matrix(pageMatrix)
  const report: KJSvgExportReport = { status: 'complete', rendered: 0, hidden: 0, diagnostics: [], approximations: [], viewports: [] }
  const allEntities=document.listEntities(),byOwner=new Map<string,KJReadonlyObjectRecord[]>()
  if(allEntities.length>50000)fail('source entity traversal budget exceeded')
  for(const entity of allEntities){const id=String(entity.ownerId);const list=byOwner.get(id)??[];list.push(entity);byOwner.set(id,list)}
  const owned=(id:string)=>(byOwner.get(id)??[]).filter(entity=>!isAttachedAttribute(entity))
  const definitions = [plotClip], fontIds = new Set<string>()
  let work = 0, characters = 0, sequence = 0
  const count = (value: string): string => { characters += value.length; if (characters > 8_388_608) fail('SVG output exceeds the 8 MiB budget'); return value }
  const diagnostic = (entity: KJReadonlyObjectRecord, reason: string) => { report.diagnostics.push({ entityId: entity.id, type: entity.type, reason }) }
  const layerOf = (entity: KJReadonlyObjectRecord, inherited?: KJReadonlyObjectRecord): KJReadonlyObjectRecord | null => {
    const layer = document.getObject(String(entity.payload.layerId ?? ''))
    if (!layer || layer.type !== 'LAYER') fail('entity layer is unavailable')
    return layer.name === '0' && inherited ? inherited : layer
  }
  const color = (p: Data, layer: Data, inherited?: string): string => {
    const explicit = (value: unknown): string => { if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) return value; if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff) return `#${value.toString(16).padStart(6, '0')}`; return fail('unsupported explicit color') }
    const indexed = (value: unknown): string => { const index=numeric(value,7);if(!Number.isInteger(index)||index<1||index>255)fail('unsupported color index');return index===7?'#000000':aciColor(index,'dark') }
    const layerColor = () => layer.trueColor != null ? explicit(layer.trueColor) : typeof layer.color==='string' ? explicit(layer.color) : indexed(layer.color)
    if (p.trueColor != null) return explicit(p.trueColor)
    if (p.color === 0 || String(p.color).toLowerCase() === 'byblock') return inherited ?? layerColor()
    if (typeof p.color === 'string' && p.color.toLowerCase() !== 'bylayer') return explicit(p.color)
    const own = p.color == null || p.color === 256 || p.color === 'BYLAYER' || p.color === 'bylayer' ? null : numeric(p.color)
    if (own != null) { if (!Number.isInteger(own) || own < 1 || own > 255) fail('unsupported color index'); return indexed(own) }
    return layerColor()
  }
  const text = (entity: KJReadonlyObjectRecord, value: string, position: Point, textHeight: number, angle: number, anchor = 'start', baseline = 'alphabetic', stretch: readonly [number,number,number] = [1,1,0], family = 'Microsoft YaHei,PingFang SC,WenQuanYi Zen Hei,Noto Sans CJK SC,sans-serif'): string => {
    if (!(textHeight > 0)) fail('text height must be positive')
    if (!fontIds.has(entity.id)) { fontIds.add(entity.id); report.approximations.push({ entityId: entity.id, type: entity.type, reason: 'Editable text uses unembedded sans-serif font metrics' }) }
    // Prefer static TrueType CJK fonts: Chromium may emit CFF/variable fonts as
    // Type3 with ambiguous ToUnicode mappings (e.g. 工 becomes the radical ⼯).
    return `<text transform="translate(${pos(position)}) rotate(${angle * 180 / Math.PI}) matrix(${stretch[0]} 0 ${-stretch[2]*stretch[1]} ${-stretch[1]} 0 0)" font-family="${xml(family)}" font-size="${textHeight}" text-anchor="${anchor}" dominant-baseline="${baseline}" fill="currentColor" stroke="none" xml:space="preserve">${xml(value)}</text>`
  }
  const multilineText = (entity: KJReadonlyObjectRecord): string => {
    const style = document.getObject(String(entity.payload.styleId ?? ''))?.payload ?? {}
    const layout = layoutCadMText(entity.payload, style)
    if (!fontIds.has(entity.id)) { fontIds.add(entity.id); report.approximations.push({ entityId: entity.id, type: entity.type, reason: 'Editable text uses unembedded sans-serif font metrics' }) }
    const m = layout.matrix
    const spans = layout.lines.map(line=>`<tspan x="${numeric(line.left)}" y="${numeric(-line.baseline)}">${xml(line.text)}</tspan>`).join('')
    return `<text transform="matrix(${m[0]} ${m[1]} ${-m[2]} ${-m[3]} ${m[4]} ${m[5]})" font-family="${xml(layout.family)}" font-size="${layout.height}" text-anchor="start" fill="currentColor" stroke="none" xml:space="preserve">${spans}</text>`
  }
  const primitive = (entity: KJReadonlyObjectRecord): string => {
    const p = entity.payload
    if (numeric(p.thickness, 0) !== 0 || p.normal && JSON.stringify(p.normal) !== '[0,0,1]' || p.extrusionDirection && JSON.stringify(p.extrusionDirection) !== '[0,0,1]') fail('thickness or non-XY extrusion is unsupported')
    if (entity.type === 'LINE') { const a = point(p.start), b = point(p.end); return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>` }
    if (entity.type === 'POINT') { const a = point(p.position); report.approximations.push({ entityId: entity.id, type: entity.type, reason: 'Point shown as a 0.25 drawing-unit marker' }); return `<circle cx="${a[0]}" cy="${a[1]}" r="0.25"/>` }
    if (entity.type === 'CIRCLE') { const a = point(p.center), r = numeric(p.radius); if (!(r > 0)) fail('circle radius must be positive'); return `<circle cx="${a[0]}" cy="${a[1]}" r="${r}"/>` }
    if (entity.type === 'ARC') return `<path d="${arcPath(point(p.center), numeric(p.radius), numeric(p.startAngle), numeric(p.endAngle), p.clockwise === true)}"/>`
    if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') { if (numeric(p.elevation, 0) || numeric(p.constantWidth, 0) || (numeric(p.dxfFlags,0)&(8|16|64))!==0) fail('polyline elevation/width is unsupported'); return `<path d="${polyPath(p.vertices ?? p.points, p.closed === true)}"/>` }
    if (entity.type === 'SOLID') return `<path d="${polyPath(Array.isArray(p.vertices)&&p.vertices.length===4?[p.vertices[0],p.vertices[1],p.vertices[3],p.vertices[2]]:p.vertices, true)}" fill="currentColor"/>`
    if (entity.type === 'TEXT' || entity.type === 'ATTRIB' || entity.type === 'ATTDEF') {
      const style = document.getObject(String(p.styleId ?? ''))?.payload ?? {}
      const factor = numeric(p.widthFactor ?? style.widthFactor, 1), flags = numeric(p.generationFlags ?? style.generationFlags, 0), shear = Math.tan(numeric(p.obliqueAngle ?? style.obliqueAngle, 0))
      if (!(factor > 0) || !Number.isFinite(shear)) fail('invalid text width or oblique angle')
      const stretch = [factor*((flags&2)!==0||p.mirrored===true?-1:1), (flags&4)!==0?-1:1, shear] as const
      if (/[\r\n]/.test(String(p.text ?? ''))) fail('multiline TEXT requires a supported multiline text layout')
      const horizontal = numeric(p.horizontalAlignment, 0), vertical = numeric(p.verticalAlignment, 0)
      if (![0,1,2].includes(horizontal) || ![0,1,2,3].includes(vertical)) fail('fitted text alignment is unsupported')
      const position = point((horizontal || vertical) && p.alignmentPoint ? p.alignmentPoint : p.position)
      return text(entity, String(p.text ?? p.defaultValue ?? ''), position, numeric(p.height, 2.5), numeric(p.rotation, 0), ['start','middle','end'][horizontal], ['alphabetic','text-after-edge','central','text-before-edge'][vertical], stretch, textFontFamily(style, 'Microsoft YaHei,PingFang SC,WenQuanYi Zen Hei,Noto Sans CJK SC,sans-serif'))
    }
    if (entity.type === 'MTEXT') return multilineText(entity)
    if (entity.type === 'DIMENSION') {
      const projection = projectDimension(p, document.getObject(String(p.styleId ?? ''))?.payload)
      if (!projection) fail('dimension subtype or definition is unsupported')
      const arcs = (projection as typeof projection & { arcs?: { center: Point; radius: number; startAngle: number; endAngle: number }[] }).arcs ?? []
      return projection.lines.map(([a,b])=>`<path d="M ${pos(a)} L ${pos(b)}"/>`).join('') + arcs.map(a=>`<path d="${arcPath(a.center,a.radius,a.startAngle,a.endAngle)}"/>`).join('') + projection.arrows.map(a=>`<polygon points="${a.map(pos).join(' ')}" fill="currentColor"/>`).join('') + text(entity,projection.label.text,projection.label.position,projection.label.height,projection.label.rotation,'middle')
    }
    if (entity.type === 'HATCH' && p.solid === true) {
      if (!Array.isArray(p.boundaryLoops) || !p.boundaryLoops.length) fail('solid hatch has no boundaries')
      return `<path d="${p.boundaryLoops.map(loop=>Array.isArray(data(loop).vertices)?polyPath(data(loop).vertices,true):hatchEdgePath(loop)).join(' ')}" fill="currentColor" fill-rule="evenodd" stroke="none"/>`
    }
    return fail(`unsupported entity ${entity.type}`)
  }
  const render = (entity: KJReadonlyObjectRecord, frozen: ReadonlySet<string>, depth = 0, ancestors: readonly string[] = [], inheritedLayer?: KJReadonlyObjectRecord, inheritedColor?: string, inViewport = false, geometryScale = scale, inheritedLineweight?: unknown, inheritedLinetypeId?: string): string => {
    if (++work > max) fail('entity traversal budget exceeded')
    try {
      const p = entity.payload, layer = layerOf(entity,inheritedLayer)!, lp = layer.payload
      if (p.visible === false || lp.visible === false || lp.frozen === true || lp.plottable === false || frozen.has(layer.id)) { report.hidden++; return '' }
      if((entity.type==='ATTRIB'||entity.type==='ATTDEF')&&(numeric(p.flags,0)&1)!==0){report.hidden++;return ''}
      if(entity.type==='ATTDEF'&&(numeric(p.flags,0)&2)===0)fail('nonconstant attribute definition requires explicit attribute rendering')
      if(p.normal&&JSON.stringify(p.normal)!=='[0,0,1]'||p.extrusionDirection&&JSON.stringify(p.extrusionDirection)!=='[0,0,1]')fail('non-XY extrusion is unsupported')
      const stroke = color(p,lp,inheritedColor)
      const lineweightName=String(p.lineweight??'BYLAYER').toUpperCase()
      let weight=lineweightName==='BYBLOCK'||Number(p.lineweight)===-2?numeric(inheritedLineweight??lp.lineweight,-1):numeric(p.lineweight,-1)
      if(lineweightName==='BYLAYER'||Number(p.lineweight)===-1)weight=numeric(lp.lineweight,-1)
      // SVG user units are transformed with geometry. Dividing by that exact scale
      // keeps the pen width in paper millimeters at every viewport/insert depth.
      const width = numeric((weight >= 0 ? Math.max(.01,weight / 100) : .25) / geometryScale)
      const transparency = numeric(p.transparency ?? lp.transparency,0), opacity = transparency > 1 ? 1 - transparency / 255 : 1 - transparency
      if (opacity < 0 || opacity > 1) fail('unsupported transparency')
      if(entity.type==='INSERT'&&opacity!==1)fail('transparent block inserts are unsupported')
      const ownLineType=document.getObject(String(p.linetypeId??'')),lineTypeName=String(ownLineType?.name??p.linetypeName??(p.linetypeId==null?'BYLAYER':'')).toUpperCase()
      const typeId=String(lineTypeName==='BYBLOCK'?inheritedLinetypeId??lp.linetypeId??'':lineTypeName==='BYLAYER'?lp.linetypeId??'':p.linetypeId??lp.linetypeId??''),lineType=document.getObject(typeId)
      if (!lineType || lineType.type !== 'LINETYPE') fail('linetype reference is unavailable')
      const pattern = lineType.payload.patternSegments ?? lineType.payload.pattern ?? []
      if (!Array.isArray(pattern) || pattern.length > 32 || pattern.length % 2 || pattern.some((v,i)=>typeof v!=='number'||!Number.isFinite(v)||(i%2?v>=0:v<=0))) fail('complex or invalid linetype is unsupported')
      const dashScale = effectiveLinetypeScale(source.header.systemVariables, p)
      let inner: string
      if (entity.type === 'INSERT') {
        const id = String(p.blockRecordId), block = document.getObject(id)
        const attributes = insertAttributes(document, entity)
        if(Object.keys(data(p.attributes)).length&&!attributes.length||owned(entity.id).length)fail('block attributes require positioned native ATTRIB entities')
        if(Array.isArray(p.scale)&&numeric(p.scale[2],1)!==1)fail('non-unit block Z scale is unsupported')
        if (depth >= 12 || ancestors.includes(id)) fail('block nesting or cycle budget exceeded')
        if (!block || block.kind !== 'block-record' || block.payload.isSpace) fail('invalid block reference')
        const a=point(p.position),b=point(block.payload.basePoint??[0,0]),sc=Array.isArray(p.scale)?p.scale:[p.scale??1,p.scale??1]
        const sx=numeric(sc[0]),sy=numeric(sc[1],sx);if(!sx||!sy||Math.abs(sx)!==Math.abs(sy))fail('zero or nonuniform block scale is unsupported')
        const m=multiply3(translation3(...a),multiply3(rotation3(numeric(p.rotation,0)),multiply3(scale3(sx,sy),translation3(-b[0],-b[1]))))
        inner=`<g transform="matrix(${matrix(m)})">${owned(id).filter(child=>child.type!=='ATTDEF'||(numeric(child.payload.flags,0)&2)!==0).map(child=>render(child,frozen,depth+1,[...ancestors,id],layer,stroke,inViewport,geometryScale*Math.abs(sx),weight,typeId)).join('')}</g>` + attributes.map(attribute=>render(attribute,frozen,depth+1,ancestors,layer,stroke,inViewport,geometryScale,weight,typeId)).join('')
      } else if (entity.type === 'VIEWPORT') {
        if (isModel || inViewport) fail('nested/model viewport is unsupported')
        const flags=numeric(p.flags,0)
        if(p.status===0||p.viewportId===1||(flags&0x20000)!==0){report.hidden++;return ''}
        if(p.perspective||p.clipBoundaryId||p.clippingBoundaryId||p.nonRectangularClip||(flags&(0x1|0x2|0x4|0x10|0x10000))!==0||Array.isArray(p.unresolvedViewportReferences)&&p.unresolvedViewportReferences.length||p.viewDirection&&JSON.stringify(p.viewDirection)!=='[0,0,1]')fail('unsupported viewport projection or clip')
        const a=point(p.center),c=point(p.viewCenter),target=point(p.viewTarget??[0,0]),w=numeric(p.width),h=numeric(p.height),vh=numeric(p.viewHeight)
        if(w<=0||h<=0||vh<=0)fail('invalid viewport dimensions')
        const ratio=h/vh,m=multiply3(translation3(a[0]-ratio*c[0],a[1]-ratio*c[1]),multiply3(scale3(ratio),multiply3(rotation3(numeric(p.twistAngle,0)),translation3(-target[0],-target[1]))))
        const clip=`kj-viewport-${++sequence}`
        matrix(m)
        definitions.push(count(`<clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><rect x="${a[0]-w/2}" y="${a[1]-h/2}" width="${w}" height="${h}"/></clipPath>`))
        report.viewports.push({entityId:entity.id,millimetersPerModelUnit:scale*ratio,matrix:m})
        const frozenLayers=new Set(Array.isArray(p.frozenLayerIds)?p.frozenLayerIds.map(String):[])
        inner=`<g clip-path="url(#${clip})"><g transform="matrix(${matrix(m)})">${owned(source.spaces.modelSpaceId).map(child=>render(child,frozenLayers,depth+1,[],undefined,undefined,true,geometryScale*ratio)).join('')}</g></g>`
      } else { inner=count(primitive(entity)); report.rendered++ }
      return count(`<g data-entity-id="${xml(entity.id)}" data-entity-type="${xml(entity.type)}" data-layer-id="${xml(layer.id)}" data-layer-name="${xml(layer.name??'')}" color="${stroke}" stroke="currentColor" stroke-width="${width}" opacity="${entity.type==='VIEWPORT'?1:opacity}" fill="none"${pattern.length?` stroke-dasharray="${pattern.map(v=>numeric(Math.abs(v)*dashScale)).join(' ')}"`:''}>`)+inner+count('</g>')
    } catch(error) { if(error instanceof Error && /budget/.test(error.message))throw error; diagnostic(entity,error instanceof Error?error.message:'invalid geometry');return '' }
  }
  const content=owned(spaceId).map(entity=>render(entity,new Set())).join('')
  report.status=report.diagnostics.length?'partial':report.approximations.length?'approximate':'complete'
  if(document.snapshot()!==source||document.revision!==revision)throw new KJRevisionConflictError(revision,document.revision)
  if(report.diagnostics.length&&!options.allowPartial)throw new KJValidationError('SVG export refused because visible geometry could not be represented',deepFreeze(report))
  const svg=`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" data-kjdraw-status="${report.status}"><title>${xml(layout.name??'Drawing')}</title><desc>${xml(`KJDraw vector drawing. ${report.status}; ${report.diagnostics.length} omitted objects; ${report.approximations.length} font or marker approximations.`)}</desc><metadata>${xml(JSON.stringify(report))}</metadata><defs><clipPath id="kj-paper" clipPathUnits="userSpaceOnUse"><rect x="${left}" y="${top}" width="${width-left-right}" height="${height-top-bottom}"/></clipPath>${definitions.join('')}</defs><g clip-path="url(#kj-paper)"><g data-space-id="${xml(spaceId)}" transform="matrix(${matrix(pageMatrix)})"${plotClip?' clip-path="url(#kj-plot-range)"':''}>${content}</g></g></svg>`
  if(new TextEncoder().encode(svg).length>8_388_608)fail('SVG output exceeds the 8 MiB budget')
  return deepFreeze({svg,mimeType:'image/svg+xml' as const,documentId:document.id,revision,layoutId:layout.id,paper:{widthMm:width,heightMm:height,millimetersPerDrawingUnit:scale},plot:{printableAreaMm:{minimum:[left,bottom],maximum:[width-right,height-top],width:printableWidth,height:printableHeight},plotOriginMm:[left+originX,bottom+originY],sourceRange:{kind:plotSource.kind,minimum:[sourceMinimumX,sourceMinimumY],maximum:[maximumX,maximumY]},drawingToPaperMatrix:pageMatrix},report}) as KJSvgDrawingExport
}
