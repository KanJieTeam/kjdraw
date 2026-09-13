import type { KJDocument } from './document.js'
import { KJValidationError } from './errors.js'
import type { KJDxfPlotSettings } from './plot-settings.js'
import { normalizeName } from './utils.js'

type Point2 = readonly [number, number]

export type KJResolvedPlotSource =
  | Readonly<{ kind: 'layout' }>
  | Readonly<{ kind: 'window' | 'view'; minimum: Point2; maximum: Point2; width: number; height: number }>

function finitePoint(value: unknown, label: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length < 2) throw new KJValidationError(`${label} must be an XY or XYZ point`)
  const point = [Number(value[0]), Number(value[1]), Number(value[2] ?? 0)] as const
  if (!point.every(Number.isFinite)) throw new KJValidationError(`${label} must contain finite coordinates`)
  return point
}

/** Resolve only plot sources whose coordinates are explicit and persistent.
 * Layout mode is intentionally unbounded: its visible range depends on the
 * physical page. Named views are accepted only for an unambiguous planar WCS
 * top view; perspective, clipping, UCS and twist require a different matrix. */
export function resolveDxfPlotSource(document: KJDocument, settings: KJDxfPlotSettings, isModel: boolean): KJResolvedPlotSource {
  const plotType = Number(settings.plotType ?? (isModel ? -1 : 5))
  if (plotType === 5) {
    if (isModel) throw new KJValidationError('Layout plot area is available only in paper space')
    return Object.freeze({ kind:'layout' })
  }
  if (plotType === 4) {
    const minimum = [Number(settings.windowMinX), Number(settings.windowMinY)] as const
    const maximum = [Number(settings.windowMaxX), Number(settings.windowMaxY)] as const
    const width = maximum[0] - minimum[0], height = maximum[1] - minimum[1]
    if (![...minimum, ...maximum].every(Number.isFinite) || !(width > 0) || !(height > 0)) throw new KJValidationError('Plot window must have four finite coordinates and positive dimensions')
    return Object.freeze({ kind:'window', minimum, maximum, width, height })
  }
  if (plotType !== 3) throw new KJValidationError('Select a paper layout, explicit window or named view for strict output')
  const name = String(settings.viewName ?? '').trim()
  if (!name) throw new KJValidationError('Named-view plotting requires a view name')
  const key = normalizeName(name)
  const matches = document.getTable('views')?.records.filter(record => normalizeName(record.name) === key) ?? []
  if (matches.length !== 1) throw new KJValidationError(matches.length ? `Named view is ambiguous: ${name}` : `Named view does not exist: ${name}`)
  const payload = matches[0]!.payload
  const center = finitePoint(payload.center, `Named view ${name} center`), target = finitePoint(payload.target ?? [0,0,0], `Named view ${name} target`)
  const direction = finitePoint(payload.direction ?? [0,0,1], `Named view ${name} direction`)
  const directionLength = Math.hypot(...direction), width = Number(payload.width), height = Number(payload.height)
  if (!(width > 0) || !(height > 0) || ![width,height].every(Number.isFinite)) throw new KJValidationError(`Named view ${name} must have finite positive width and height`)
  if (!(directionLength > 0) || Math.hypot(direction[0], direction[1]) > directionLength * 1e-12 || direction[2] <= 0) throw new KJValidationError(`Named view ${name} is not a WCS top view`)
  const twist = Number(payload.twistAngle ?? 0), viewMode = Number(payload.viewMode ?? 0), renderMode = Number(payload.renderMode ?? 0), ucsAssociated = Number(payload.ucsAssociated ?? 0)
  if (![twist,viewMode,renderMode,ucsAssociated].every(Number.isFinite)) throw new KJValidationError(`Named view ${name} has invalid projection metadata`)
  if (Math.abs(twist) > 1e-12) throw new KJValidationError(`Named view ${name} twist is unsupported by strict output`)
  if (viewMode !== 0) throw new KJValidationError(`Named view ${name} perspective or clipping mode is unsupported by strict output`)
  if (renderMode !== 0) throw new KJValidationError(`Named view ${name} render mode is unsupported by strict output`)
  if (ucsAssociated !== 0) throw new KJValidationError(`Named view ${name} uses a local UCS that strict output cannot resolve`)
  const x = center[0] + target[0], y = center[1] + target[1]
  const minimum = [x - width / 2, y - height / 2] as const, maximum = [x + width / 2, y + height / 2] as const
  if (![...minimum,...maximum].every(Number.isFinite)) throw new KJValidationError(`Named view ${name} range exceeds finite drawing coordinates`)
  return Object.freeze({ kind:'view', minimum, maximum, width, height })
}
