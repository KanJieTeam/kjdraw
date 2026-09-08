import { KJValidationError } from '../errors.js'

export interface KJToleranceOptions {
  absolute?: number
  relative?: number
  angular?: number
}

export class KJTolerance {
  readonly absolute: number
  readonly relative: number
  readonly angular: number

  constructor({ absolute = 1e-9, relative = 1e-12, angular = 1e-10 }: KJToleranceOptions = {}) {
    this.absolute = positive(absolute, 'absolute tolerance')
    this.relative = positive(relative, 'relative tolerance')
    this.angular = positive(angular, 'angular tolerance')
    Object.freeze(this)
  }

  distanceFor(...values: readonly number[]): number {
    const scale = Math.max(1, ...values.map(value => Math.abs(Number(value) || 0)))
    return Math.max(this.absolute, this.relative * scale)
  }

  equal(a: number, b: number): boolean {
    return Math.abs(a - b) <= this.distanceFor(a, b)
  }

  zero(value: number, scale = 1): boolean {
    return Math.abs(value) <= this.distanceFor(scale)
  }

  angleEqual(a: number, b: number): boolean {
    return Math.abs(normalizeAngle(a - b)) <= this.angular
  }
}

function positive(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new KJValidationError(`${label} must be a positive finite number`)
  }
  return number
}

export function normalizeAngle(value: number): number {
  const turn = Math.PI * 2
  let angle = Number(value) % turn
  if (angle <= -Math.PI) angle += turn
  if (angle > Math.PI) angle -= turn
  return angle
}

export const DEFAULT_TOLERANCE = new KJTolerance()

