import { KJValidationError } from '../errors.js'
import type { EllipseArcLengthOptions, SplineBackendOptions } from './curves.js'
import type {
  CircleCircleIntersectionOptions,
  KJIntersectionResult,
  LineCircleIntersectionOptions,
  LineLineIntersectionOptions,
  Orientation,
  OrientationOptions,
} from './intersections.js'
import type { PolylineMeasureOptions } from './measure.js'
import type { Point2Input } from './vector2.js'

export const REQUIRED_GEOMETRY_OPERATIONS = Object.freeze([
  'intersectLineLine2',
  'intersectLineCircle2',
  'intersectCircleCircle2',
  'orientation2',
] as const)

export type RequiredGeometryOperation = typeof REQUIRED_GEOMETRY_OPERATIONS[number]

export interface KJGeometryBackendIdentity {
  readonly id: string
  readonly abi: string
  readonly version: string
  readonly authoritative: boolean
}

export interface KJGeometryBackendFailure {
  readonly message: string
  readonly at: string
}

export interface KJGeometryBackend {
  id?: unknown
  abi?: unknown
  version?: unknown
  authoritative?: boolean
  intersectLineLine2(
    a0: Point2Input,
    a1: Point2Input,
    b0: Point2Input,
    b1: Point2Input,
    options?: LineLineIntersectionOptions,
  ): KJIntersectionResult
  intersectLineCircle2(
    start: Point2Input,
    end: Point2Input,
    center: Point2Input,
    radius: number,
    options?: LineCircleIntersectionOptions,
  ): KJIntersectionResult
  intersectCircleCircle2(
    centerA: Point2Input,
    radiusA: number,
    centerB: Point2Input,
    radiusB: number,
    options?: CircleCircleIntersectionOptions,
  ): KJIntersectionResult
  orientation2(a: Point2Input, b: Point2Input, c: Point2Input, options?: OrientationOptions): Orientation
  polylineLength2?(vertices: readonly Point2Input[], options?: PolylineMeasureOptions): number
  polylineArea2?(vertices: readonly Point2Input[]): number
  ellipseArcLength2?(
    major: number,
    minor: number,
    start: number,
    end: number,
    options?: EllipseArcLengthOptions,
  ): number
  splineLength2?(controlPoints: readonly Point2Input[], options: SplineBackendOptions): number
  [operation: string]: unknown
}

export type RegisteredGeometryBackend = Readonly<KJGeometryBackend & {
  identity: KJGeometryBackendIdentity
}>

export interface KJGeometryBackendStatus {
  readonly mode: 'native' | 'reference'
  readonly authoritative: boolean
  readonly backend: KJGeometryBackendIdentity
  readonly operations: readonly string[]
  readonly lastFailure: KJGeometryBackendFailure | null
}

const REFERENCE_BACKEND_IDENTITY: KJGeometryBackendIdentity = Object.freeze({
  id: 'kjdraw-js-reference',
  abi: 'kanjie.kjcore.reference.v1',
  version: '0.2.0',
  authoritative: false,
})

let activeBackend: RegisteredGeometryBackend | null = null
let lastFailure: KJGeometryBackendFailure | null = null

export function registerGeometryBackend(backend: KJGeometryBackend): KJGeometryBackendIdentity {
  if (!backend || typeof backend !== 'object') throw new KJValidationError('Geometry backend must be an object')
  for (const operation of REQUIRED_GEOMETRY_OPERATIONS) {
    if (typeof backend[operation] !== 'function') {
      throw new KJValidationError(`Geometry backend is missing ${operation}`)
    }
  }
  const identity: KJGeometryBackendIdentity = Object.freeze({
    id: String(backend.id ?? 'unknown'),
    abi: String(backend.abi ?? 'unknown'),
    version: String(backend.version ?? 'unknown'),
    authoritative: backend.authoritative === true,
  })
  activeBackend = Object.freeze({ ...backend, identity })
  lastFailure = null
  return identity
}

export function unregisterGeometryBackend(): void {
  activeBackend = null
}

export function recordGeometryBackendFailure(error: unknown): void {
  lastFailure = Object.freeze({
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
  })
  activeBackend = null
}

export function getGeometryBackendStatus(): KJGeometryBackendStatus {
  return Object.freeze({
    mode: activeBackend ? 'native' : 'reference',
    authoritative: activeBackend?.identity.authoritative === true,
    backend: activeBackend?.identity ?? REFERENCE_BACKEND_IDENTITY,
    operations: Object.freeze(
      activeBackend
        ? Object.keys(activeBackend).filter(key => typeof activeBackend?.[key] === 'function').sort()
        : [],
    ),
    lastFailure,
  })
}

export function requireAuthoritativeGeometryBackend(): KJGeometryBackendIdentity {
  const status = getGeometryBackendStatus()
  if (!status.authoritative) {
    throw new KJValidationError('Authoritative KJCore geometry backend is not available')
  }
  return status.backend
}

/**
 * Invokes an optional backend operation and trusts the registered ABI's result
 * shape. The cast is isolated here so geometry callers remain fully typed.
 */
export function invokeGeometryBackend<Result>(
  operation: string,
  args: readonly unknown[],
  fallback: () => Result,
): Result {
  const implementation = activeBackend?.[operation]
  if (typeof implementation !== 'function') return fallback()
  return (implementation as (...operationArgs: unknown[]) => unknown)(...args) as Result
}

