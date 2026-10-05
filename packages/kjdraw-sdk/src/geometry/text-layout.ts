import type { KJObjectPayload } from '../schema.js'
import { KJValidationError } from '../errors.js'

type Data = Readonly<Record<string, unknown>>
type Point = readonly [number, number]
type MeasureText = (text: string, height: number, family: string) => number
const number = (value: unknown, fallback = 0): number => value == null ? fallback : typeof value === 'number' && Number.isFinite(value) ? value : NaN
const point = (value: unknown): Point | null => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(v => typeof v === 'number' && Number.isFinite(v)) ? [value[0], value[1]] : null

/** Browser-safe engineering preview stack: neutral Latin glyphs plus installed CJK fallbacks. */
export const KJDRAW_ENGINEERING_FONT_STACK = '"Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei","Microsoft YaHei UI","PingFang SC","Arial","Segoe UI","WenQuanYi Micro Hei",sans-serif'

const LOCAL_FONT_NAME = /^[\p{L}\p{N} _-]{1,80}$/u
const GENERIC_FONT_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'])

function localFontFamilies(value: unknown): string[] {
  const source = String(value ?? '').trim()
  if (!source || source.length > 256) return []
  const families = source.split(',').map(item => item.trim()).filter(Boolean)
  if (!families.length || families.length > 8) return []
  const result: string[] = []
  for (const item of families) {
    const unquoted = item.length >= 2 && ((item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))) ? item.slice(1, -1).trim() : item
    if (!LOCAL_FONT_NAME.test(unquoted)) return []
    const lower = unquoted.toLowerCase()
    result.push(GENERIC_FONT_FAMILIES.has(lower) ? lower : JSON.stringify(unquoted))
  }
  return result
}

/** Safe local font-family mapping; no URL/file loading or embedded font claims. */
export function textFontFamily(style: Data = {}, fallback = KJDRAW_ENGINEERING_FONT_STACK): string {
  const fileSource = style.fontFile == null ? '' : String(style.fontFile)
  const file = fileSource.split(/[\\/]/).at(-1)!.replace(/\.(?:ttf|ttc|otf|shx)$/i, '')
  const known: Record<string, string> = { times: 'Times New Roman', arial: 'Arial', simsun: 'SimSun', simhei: 'SimHei', simplex_: 'Simplex', txt_____: 'Txt', italic__: 'Italic' }
  const fileFamily = known[file.toLowerCase()] ?? (LOCAL_FONT_NAME.test(file) ? file : '')
  const requested = fileFamily ? [JSON.stringify(fileFamily)] : localFontFamilies(style.fontFamily)
  return requested.length ? `${requested.join(',')}, ${fallback}` : fallback
}

/** CAD cap-height coordinates. Optional metrics are supplied by the rendering host;
 * geometry queries use explicitly approximate font-independent label extents. */
export function layoutCadText(payload: Readonly<KJObjectPayload> | Data, style: Data = {}, measure?: (text: string, height: number, family: string) => number) {
  const value = String(payload.text ?? payload.defaultValue ?? payload.value ?? ''), family = textFontFamily(style)
  const fixedHeight = number(style.fixedHeight), height = fixedHeight > 0 ? fixedHeight : number(payload.height, 2.5), widthFactor = number(payload.widthFactor, number(style.widthFactor, 1))
  const attachment = number(payload.attachmentPoint), horizontal = attachment ? (attachment - 1) % 3 : number(payload.horizontalAlignment), vertical = attachment ? (attachment <= 3 ? 3 : attachment <= 6 ? 2 : 0) : number(payload.verticalAlignment), flags = number(payload.generationFlags)
  let position = point(payload.position), rotation = number(payload.rotation), xScale = widthFactor, yScale = 1
  const oblique = number(payload.obliqueAngle, number(style.obliqueAngle)), alignment = point(payload.alignmentPoint)
  if (!position || ![height, widthFactor, horizontal, vertical, flags, rotation, oblique].every(Number.isFinite) || height <= 0 || widthFactor <= 0 || ![0,1,2,3,4,5].includes(horizontal) || ![0,1,2,3].includes(vertical)) throw new KJValidationError('Unsupported CAD text placement')
  const naturalWidth = measure ? measure(value, height, family) : Math.max(height * .4, [...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 1 : .6), 0) * height)
  if (!Number.isFinite(naturalWidth) || naturalWidth < 0) throw new KJValidationError('Invalid CAD text metrics')
  if (horizontal === 3 || horizontal === 5) {
    if (!alignment || naturalWidth <= 0) throw new KJValidationError('Fitted CAD text requires two distinct points')
    const dx = alignment[0] - position[0], dy = alignment[1] - position[1], length = Math.hypot(dx, dy)
    if (length <= 0) throw new KJValidationError('Fitted CAD text requires two distinct points')
    rotation = Math.atan2(dy, dx); xScale = length / naturalWidth
    if (horizontal === 3) yScale = xScale / widthFactor
  } else if (horizontal || vertical) {
    if (!alignment) throw new KJValidationError('Aligned CAD text requires an alignment point')
    position = alignment
  }
  const left = horizontal === 1 || horizontal === 4 ? -naturalWidth / 2 : horizontal === 2 ? -naturalWidth : 0
  const bottom = horizontal === 4 || vertical === 2 ? -height / 2 : vertical === 3 ? -height : 0
  // DXF bit 1 is not a mirror flag; preserve it without guessing a transform.
  if ((flags & 2) !== 0 || payload.mirrored === true) xScale *= -1
  if ((flags & 4) !== 0) yScale *= -1
  const shear = Math.tan(oblique), c = Math.cos(rotation), s = Math.sin(rotation)
  if (!Number.isFinite(shear)) throw new KJValidationError('Invalid text oblique angle')
  const matrix = [c*xScale, s*xScale, (c*shear-s)*yScale, (s*shear+c)*yScale, position[0], position[1]] as const
  const transform = (p: Point): Point => [matrix[0]*p[0]+matrix[2]*p[1]+matrix[4], matrix[1]*p[0]+matrix[3]*p[1]+matrix[5]]
  return { text: value, family, height, left, bottom, width: naturalWidth, matrix, corners: [[left,bottom],[left+naturalWidth,bottom],[left+naturalWidth,bottom+height],[left,bottom+height]].map(p=>transform(p as [number,number])) }
}

type MTextRun = { text: string; family: string }

/** Bounded local TrueType font scopes, not a general rich-MTEXT interpreter.
 * Never load a font file or remove unsupported controls to make a preview pass. */
function localMTextParagraphs(value: string, baseFamily: string): MTextRun[][] {
  if (value.length > 65_536) throw new KJValidationError('MTEXT exceeds the 65536 character layout budget')
  const paragraphs: MTextRun[][] = [[]], scopes: string[] = []
  let family = baseFamily, pending: string[] = [], runCount = 0
  const unsupported = (reason: string): never => { throw new KJValidationError(`Rich MTEXT formatting is not supported: ${reason}`) }
  const flush = () => {
    if (!pending.length) return
    const text = pending.join(''), row = paragraphs.at(-1)!, previous = row.at(-1)
    pending = []
    if (previous?.family === family) previous.text += text
    else {
      if (++runCount > 4096) throw new KJValidationError('MTEXT exceeds the 4096 font run layout budget')
      row.push({ text, family })
    }
  }
  const paragraph = () => {
    flush()
    if (paragraphs.length >= 4096) throw new KJValidationError('MTEXT exceeds the 4096 line layout budget')
    paragraphs.push([])
  }
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (char === '{') {
      flush()
      if (scopes.length >= 8) unsupported('font scopes exceed eight levels')
      scopes.push(family)
    } else if (char === '}') {
      flush()
      if (!scopes.length) unsupported('unbalanced font scope')
      family = scopes.pop()!
    } else if (char === '\\') {
      const control = value[++index]
      if (control === '\\' || control === '{' || control === '}') pending.push(control)
      else if (control === 'P') paragraph()
      else if (control === 'f') {
        flush()
        const end = value.indexOf(';', index + 1)
        if (end < 0) unsupported('unterminated local font control')
        const name = value.slice(index + 1, end).trim()
        if (!LOCAL_FONT_NAME.test(name)) unsupported('only a local TrueType family name is supported')
        family = textFontFamily({ fontFamily: name }, baseFamily)
        index = end
      } else unsupported('unknown control or unsupported font attributes')
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && value[index + 1] === '\n') index++
      paragraph()
    } else {
      if (char === '\u0000') unsupported('NUL is not displayable text')
      pending.push(char)
    }
  }
  flush()
  if (scopes.length) unsupported('unclosed font scope')
  return paragraphs
}

/** Deterministic plain and bounded local-font MTEXT layout. Preserves the raw
 * source while sharing positioned font runs with Canvas and vector output. */
export function layoutCadMText(payload: Readonly<KJObjectPayload> | Data, style: Data = {}, measure?: MeasureText) {
  const family = textFontFamily(style), fixedHeight = number(style.fixedHeight)
  const height = fixedHeight > 0 ? fixedHeight : number(payload.height, 2.5)
  const widthFactor = number(payload.widthFactor, number(style.widthFactor, 1)), rotation = number(payload.rotation)
  const oblique = number(payload.obliqueAngle, number(style.obliqueAngle)), attachment = number(payload.attachmentPoint, 1)
  const spacing = number(payload.lineSpacingFactor, number(payload.lineSpacing, 1.2)), position = point(payload.position)
  const referenceWidth = payload.width == null ? null : number(payload.width)
  if (!position || ![height,widthFactor,rotation,oblique,attachment,spacing,referenceWidth ?? 1].every(Number.isFinite) || height <= 0 || widthFactor <= 0 || !Number.isInteger(attachment) || attachment < 1 || attachment > 9 || spacing < .25 || spacing > 4 || referenceWidth != null && referenceWidth <= 0) throw new KJValidationError('Unsupported CAD multiline text placement')
  const shear = Math.tan(oblique)
  if (!Number.isFinite(shear)) throw new KJValidationError('Invalid text oblique angle')
  const metric = (value: string, runFamily = family): number => {
    const result = measure ? measure(value, height, runFamily) : Math.max(value ? height * .4 : 0, [...value].reduce((sum, char) => sum + (char.codePointAt(0)! > 255 ? 1 : .6), 0) * height)
    if (!Number.isFinite(result) || result < 0) throw new KJValidationError('Invalid CAD text metrics')
    return result
  }
  const limit = referenceWidth == null ? Infinity : referenceWidth / widthFactor
  const rows: MTextRun[][] = []
  const pushRow = (row: MTextRun[]) => {
    if (rows.length >= 4096) throw new KJValidationError('MTEXT exceeds the 4096 line layout budget')
    rows.push(row)
  }
  for (const paragraph of localMTextParagraphs(String(payload.text ?? ''), family)) {
    if (!paragraph.length || limit === Infinity) { pushRow(paragraph); continue }
    let line: MTextRun[] = [], lineWidth = 0
    for (const run of paragraph) for (const char of run.text) {
      const charWidth = metric(char, run.family)
      if (line.length && lineWidth + charWidth > limit) {
        pushRow(line); line = []; lineWidth = 0
        if (char === ' ') continue
      }
      const previous = line.at(-1)
      if (previous?.family === run.family) previous.text += char
      else line.push({ text: char, family: run.family })
      lineWidth += charWidth
    }
    pushRow(line)
  }
  const runWidths = rows.map(row => row.map(run => metric(run.text, run.family)))
  const widths = runWidths.map(values => values.reduce((sum, value) => sum + value, 0)), contentWidth = Math.max(0, ...widths), boxWidth = referenceWidth == null ? contentWidth : limit
  if (!widths.every(Number.isFinite)) throw new KJValidationError('Invalid aggregate CAD text metrics')
  const advance = height * spacing, boxHeight = height + (rows.length - 1) * advance
  const column = (attachment - 1) % 3, band = Math.floor((attachment - 1) / 3)
  const left = column === 0 ? 0 : column === 1 ? -boxWidth / 2 : -boxWidth
  const top = band === 0 ? 0 : band === 1 ? boxHeight / 2 : boxHeight
  const lines = rows.map((row, index) => {
    const lineLeft = column === 0 ? left : column === 1 ? -widths[index]! / 2 : -widths[index]!
    let cursor = lineLeft
    const runs = row.map((run, runIndex) => {
      const width = runWidths[index]![runIndex]!, positioned = { ...run, width, left: cursor }
      cursor += width
      return positioned
    })
    return { text: row.map(run => run.text).join(''), width: widths[index]!, left: lineLeft, baseline: top - height - index * advance, runs }
  })
  const flags = number(payload.generationFlags), xScale = widthFactor * ((flags & 2) !== 0 || payload.mirrored === true ? -1 : 1), yScale = (flags & 4) !== 0 ? -1 : 1
  const c = Math.cos(rotation), s = Math.sin(rotation)
  const matrix = [c*xScale, s*xScale, (c*shear-s)*yScale, (s*shear+c)*yScale, position[0], position[1]] as const
  const transform = (p: Point): Point => [matrix[0]*p[0]+matrix[2]*p[1]+matrix[4], matrix[1]*p[0]+matrix[3]*p[1]+matrix[5]]
  const bottom = top - boxHeight
  const corners: Point[] = [[left,bottom],[left+boxWidth,bottom],[left+boxWidth,top],[left,top]]
  return { text: String(payload.text ?? ''), family, height, width: boxWidth, lineAdvance: advance, lines, matrix, corners: corners.map(transform) }
}
