import { KJValidationError } from '../errors.js'

type Point = readonly [number, number]
export interface KJHatchPatternLine { angle: number; base: Point; offset: Point; dashes: readonly number[] }
const rotate = (p: Point, angle: number, scale = 1): Point => [(p[0] * Math.cos(angle) - p[1] * Math.sin(angle)) * scale, (p[0] * Math.sin(angle) + p[1] * Math.cos(angle)) * scale]
const fail = (): never => { throw new KJValidationError('Invalid or unsupported HATCH pattern line data') }
const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : fail()
const point = (value: unknown): Point => Array.isArray(value) && value.length >= 2 ? [finite(value[0]), finite(value[1])] : fail()

/** Actual OCS line families, with global scale/angle already applied exactly once. */
export function hatchPatternLines(payload: Readonly<Record<string, unknown>>): readonly KJHatchPatternLine[] {
  const angle = finite(payload.patternAngle ?? 0), scale = finite(payload.patternScale ?? 1)
  if (scale <= 0) fail()
  let referenceAngle = angle, referenceScale = scale
  let lines: KJHatchPatternLine[]
  if (Array.isArray(payload.patternLines)) {
    if (!payload.patternLines.length || payload.patternLines.length > 4096) fail()
    lines = payload.patternLines.map(value => {
      if (!value || typeof value !== 'object') return fail()
      const line = value as Record<string, unknown>
      if (!Array.isArray(line.dashes) || line.dashes.length > 128) return fail()
      return { angle: finite(line.angle), base: point(line.base), offset: point(line.offset), dashes: line.dashes.map(finite) }
    })
    referenceAngle = finite(payload.patternDefinitionAngle ?? angle)
    referenceScale = finite(payload.patternDefinitionScale ?? scale)
  } else if (Array.isArray(payload.rawTags)) {
    const tags = payload.rawTags as Array<{ code: number; value: unknown }>
    const start = tags.findIndex(t => t.code === 78)
    if (start < 0) return fail()
    const count = Number(tags[start]!.value)
    if (!Number.isSafeInteger(count) || count < 1 || count > 4096) return fail()
    referenceAngle = Number(tags.find(t => t.code === 52)?.value ?? 0) * Math.PI / 180
    referenceScale = Number(tags.find(t => t.code === 41)?.value ?? 1)
    let cursor = start + 1
    const take = (code: number): number => {
      const tag = tags[cursor++]
      return tag?.code === code ? finite(Number(tag.value)) : fail()
    }
    lines = []
    for (let i = 0; i < count; i++) {
      const a = take(53) * Math.PI / 180, base: Point = [take(43), take(44)], offset: Point = [take(45), take(46)]
      const dashCount = take(79)
      if (!Number.isSafeInteger(dashCount) || dashCount < 0 || dashCount > 128) return fail()
      const dashes = Array.from({ length: dashCount }, () => take(49))
      lines.push({ angle: a, base, offset, dashes })
    }
  } else {
    const name = String(payload.patternName ?? 'ANSI31').toUpperCase()
    if (!['ANSI31', 'ANSI37', 'CROSS'].includes(name)) throw new KJValidationError('DXF HATCH writer supports native pattern data for ANSI31 and ANSI37; supply explicit patternLines for other patterns')
    const angles = name === 'ANSI31' ? [Math.PI / 4] : [Math.PI / 4, Math.PI * 3 / 4]
    lines = angles.map(a => ({ angle: a + angle, base: [0, 0], offset: rotate([0, 3.175], a + angle, scale), dashes: [] }))
  }
  if (!Number.isFinite(referenceAngle) || !Number.isFinite(referenceScale) || referenceScale <= 0) return fail()
  const delta = angle - referenceAngle, factor = scale / referenceScale
  return lines.map(line => ({ angle: line.angle + delta, base: rotate(line.base, delta, factor), offset: rotate(line.offset, delta, factor), dashes: line.dashes.map(d => d * factor) }))
}

export interface KJHatchStrokes {
  segments: Array<readonly [Point, Point]>
  dots: Point[]
  limited: boolean
  work: number
}

/** Clip line families to a visible rectangle while retaining each row's dash origin.
 * Bound row and primitive work; never enlarge spacing or substitute a pattern. */
export function hatchStrokes(lines: readonly KJHatchPatternLine[], bounds: readonly [number, number, number, number], budget = 20000): KJHatchStrokes {
  const result: KJHatchStrokes = { segments: [], dots: [], limited: false, work: 0 }
  const [x0, y0, x1, y1] = bounds
  if (x0 > x1 || y0 > y1) return result
  if (![...bounds, budget].every(Number.isFinite) || budget < 1) return fail()
  const consume = (): boolean => { if (result.work >= budget) { result.limited = true; return false } result.work++; return true }
  const corners: Point[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  for (const line of lines) {
    const u: Point = [Math.cos(line.angle), Math.sin(line.angle)], n: Point = [-u[1], u[0]]
    const spacing = line.offset[0] * n[0] + line.offset[1] * n[1]
    if (!Number.isFinite(spacing)) return fail()
    const cycle = line.dashes.reduce((sum, d) => sum + Math.abs(d), 0)
    if (line.dashes.length && cycle <= 1e-12) return fail()
    const collinear = Math.abs(spacing) < 1e-12
    if (collinear && line.dashes.length) {
      const shift = (line.offset[0] * u[0] + line.offset[1] * u[1]) / cycle
      if (Math.abs(shift - Math.round(shift)) > 1e-9) return fail()
    }
    // Parallel translations of an infinite continuous line (or whole dash cycles)
    // describe the same locus. Draw it once rather than dividing by zero.
    const projected = collinear ? [0] : corners.map(p => ((p[0] - line.base[0]) * n[0] + (p[1] - line.base[1]) * n[1]) / spacing)
    const first = Math.ceil(Math.min(...projected) - 1e-9), last = Math.floor(Math.max(...projected) + 1e-9)
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) { result.limited = true; return result }
    for (let row = first; row <= last; row++) {
      if (!consume()) return result
      const origin: Point = [line.base[0] + row * line.offset[0], line.base[1] + row * line.offset[1]]
      let lo = -Infinity, hi = Infinity, outside = false
      for (const [axis, min, max] of [[0, x0, x1], [1, y0, y1]] as const) {
        if (Math.abs(u[axis]) < 1e-12) { if (origin[axis] < min - 1e-9 || origin[axis] > max + 1e-9) outside = true }
        else { const a = (min - origin[axis]) / u[axis], b = (max - origin[axis]) / u[axis]; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)) }
      }
      if (outside || lo > hi) continue
      const at = (t: number): Point => [origin[0] + u[0] * t, origin[1] + u[1] * t]
      if (!line.dashes.length) { result.segments.push([at(lo), at(hi)]); continue }
      const start = Math.floor(lo / cycle), end = Math.floor(hi / cycle)
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { result.limited = true; return result }
      for (let repeat = start; repeat <= end; repeat++) {
        let t = repeat * cycle
        for (const dash of line.dashes) {
          if (!consume()) return result
          const next = t + Math.abs(dash)
          if (dash === 0 && t >= lo - 1e-9 && t <= hi + 1e-9) result.dots.push(at(t))
          else if (dash > 0 && next > lo && t < hi) result.segments.push([at(Math.max(lo, t)), at(Math.min(hi, next))])
          t = next
        }
      }
    }
  }
  return result
}
