import { KJValidationError } from './errors.js'
import type { KJDxfPlotSettings } from './plot-settings.js'

export interface KJDxfLayoutRange2 {
  minimum: readonly [number, number]
  maximum: readonly [number, number]
}

export interface KJDxfLayoutRange3 {
  minimum: readonly [number, number, number]
  maximum: readonly [number, number, number]
}

/** Native AcDbLayout limits and extents. Null extents are emitted as the
 * official unset sentinels instead of invented zero-size geometry. */
export interface KJDxfLayoutGeometry {
  limits: KJDxfLayoutRange2 | null
  extents: KJDxfLayoutRange3 | null
}

function point(value: unknown, dimensions: 2 | 3, label: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== dimensions) throw new KJValidationError(`${label} must contain exactly ${dimensions} coordinates`)
  const result = value.map(Number)
  if (!result.every(Number.isFinite)) throw new KJValidationError(`${label} must contain finite coordinates`)
  return result
}

export function validateDxfLayoutGeometry(value: unknown): asserts value is KJDxfLayoutGeometry {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new KJValidationError('Layout dxfLayoutGeometry must be a plain object')
  const geometry = value as Record<string, unknown>
  for (const key of Object.keys(geometry)) if (key !== 'limits' && key !== 'extents') throw new KJValidationError(`Unknown layout geometry field: ${key}`)
  if (!Object.hasOwn(geometry, 'limits') || !Object.hasOwn(geometry, 'extents')) throw new KJValidationError('Layout geometry requires explicit limits and extents states')
  if (geometry.limits !== null) {
    if (!geometry.limits || typeof geometry.limits !== 'object' || Array.isArray(geometry.limits) || ![Object.prototype, null].includes(Object.getPrototypeOf(geometry.limits))) throw new KJValidationError('Layout limits must be a plain range or null')
    const limits = geometry.limits as Record<string, unknown>, minimum = point(limits.minimum, 2, 'Layout limits minimum'), maximum = point(limits.maximum, 2, 'Layout limits maximum')
    if (Object.keys(limits).some(key => key !== 'minimum' && key !== 'maximum')) throw new KJValidationError('Layout limits contain an unknown field')
    if (!(maximum[0]! > minimum[0]! && maximum[1]! > minimum[1]!)) throw new KJValidationError('Layout limits require positive width and height')
  }
  if (geometry.extents !== null) {
    if (!geometry.extents || typeof geometry.extents !== 'object' || Array.isArray(geometry.extents) || ![Object.prototype, null].includes(Object.getPrototypeOf(geometry.extents))) throw new KJValidationError('Layout extents must be a plain range or null')
    const extents = geometry.extents as Record<string, unknown>, minimum = point(extents.minimum, 3, 'Layout extents minimum'), maximum = point(extents.maximum, 3, 'Layout extents maximum')
    if (Object.keys(extents).some(key => key !== 'minimum' && key !== 'maximum')) throw new KJValidationError('Layout extents contain an unknown field')
    if (maximum.some((coordinate, index) => coordinate < minimum[index]!)) throw new KJValidationError('Layout extents maximum cannot precede its minimum')
  }
}

/** Match ezdxf/AcDbLayout paper-limit semantics. DXF paper sizes, margins and
 * plot origins are stored in millimeters; limits use the selected paper unit. */
export function paperLimitsFromPlotSettings(settings: KJDxfPlotSettings): KJDxfLayoutRange2 {
  const width = Number(settings.paperWidth), height = Number(settings.paperHeight)
  const unitMillimeters = Number(settings.paperUnits ?? 1) === 0 ? 25.4 : 1
  const shiftX = (Number(settings.marginLeft ?? 0) + Number(settings.originX ?? 0)) / unitMillimeters
  const shiftY = (Number(settings.marginBottom ?? 0) + Number(settings.originY ?? 0)) / unitMillimeters
  const minimum = [shiftX === 0 ? 0 : -shiftX, shiftY === 0 ? 0 : -shiftY] as const
  const maximum = [width / unitMillimeters - shiftX, height / unitMillimeters - shiftY] as const
  const value = { minimum, maximum }
  validateDxfLayoutGeometry({ limits:value, extents:null })
  return Object.freeze(value)
}
