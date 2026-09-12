import { KJValidationError } from './errors.js'

type Values = Readonly<Record<string, unknown>>

function positive(value: unknown, name: string): number {
  const result = Number(value)
  if (!Number.isFinite(result) || result <= 0) throw new KJValidationError(`${name} must be positive and finite`)
  return result
}

/** Native CAD linetype length in drawing units. Geometry transforms are applied
 * later by the renderer, exactly like the entity path itself. */
export function effectiveLinetypeScale(systemVariables: Values, payload: Values): number {
  return positive(systemVariables.LTSCALE ?? 1, 'LTSCALE') * positive(payload.linetypeScale ?? 1, 'linetypeScale')
}
