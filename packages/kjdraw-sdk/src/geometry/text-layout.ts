import type { KJObjectPayload } from '../schema.js'
import { KJValidationError } from '../errors.js'

type Data = Readonly<Record<string, unknown>>
type Point = readonly [number, number]
const number = (value: unknown, fallback = 0): number => value == null ? fallback : typeof value === 'number' && Number.isFinite(value) ? value : NaN
const point = (value: unknown): Point | null => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(v => typeof v === 'number' && Number.isFinite(v)) ? [value[0], value[1]] : null

/** Safe local font-family mapping; no URL/file loading or embedded font claims. */
export function textFontFamily(style: Data = {}, fallback = 'ui-monospace, SFMono-Regular, Consolas, monospace'): string {
  const file = String(style.fontFile ?? style.fontFamily ?? '').split(/[\\/]/).at(-1)!.replace(/\.(?:ttf|otf|shx)$/i, '')
  const known: Record<string, string> = { times: 'Times New Roman', arial: 'Arial', simsun: 'SimSun', simhei: 'SimHei', simplex_: 'Simplex', txt_____: 'Txt', italic__: 'Italic' }
  const family = known[file.toLowerCase()] ?? (/^[\p{L}\p{N} _-]{1,80}$/u.test(file) ? file : '')
  return family ? `${JSON.stringify(family)}, ${fallback}` : fallback
}

/** CAD cap-height coordinates. Optional metrics are supplied by the rendering host;
 * geometry queries use explicitly approximate font-independent label extents. */
export function layoutCadText(payload: Readonly<KJObjectPayload> | Data, style: Data = {}, measure?: (text: string, height: number, family: string) => number) {
  const value = String(payload.text ?? payload.defaultValue ?? payload.value ?? ''), family = textFontFamily(style)
  const height = number(payload.height, number(style.fixedHeight, 2.5)), widthFactor = number(payload.widthFactor, number(style.widthFactor, 1))
  const horizontal = number(payload.horizontalAlignment), vertical = number(payload.verticalAlignment), flags = number(payload.generationFlags)
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
