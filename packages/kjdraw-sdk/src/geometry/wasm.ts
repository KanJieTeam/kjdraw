import { KJValidationError } from '../errors.js'
import {
  recordGeometryBackendFailure,
  registerGeometryBackend,
  type KJGeometryBackend,
  type KJGeometryBackendIdentity,
} from './backend.js'
import type { EllipseArcLengthOptions, SplineBackendOptions } from './curves.js'
import type {
  CircleCircleIntersectionOptions,
  KJIntersectionResult,
  LineCircleIntersectionOptions,
  LineDomain,
  LineLineIntersectionOptions,
  Orientation,
} from './intersections.js'
import type { PolylineMeasureOptions } from './measure.js'
import type { KJToleranceOptions } from './tolerance.js'
import type { Point2, Point2Input } from './vector2.js'

const EXPECTED_ABI = 'kanjie.kjcore.wasm.v1'
const EXPECTED_ABI_MAGIC = 0x4b4a4301
const ORIENTATION_ERROR = -2147483648

const ERROR_MESSAGES: Readonly<Record<number, string>> = Object.freeze({
  1: 'non-finite coordinate',
  2: 'degenerate direction',
  3: 'invalid radius',
  4: 'invalid tolerance',
  5: 'invalid coordinate buffer or line domain',
  6: 'invalid curve definition',
})

type IntersectionBuffer = ArrayLike<number> | Iterable<number>
type NumericWasmFunction = (...values: number[]) => number

interface KJCoreRawExports extends Record<string, unknown> {
  memory: WebAssembly.Memory
  kjcore_abi_magic: () => number
  kjcore_kernel_version_packed?: () => number
  kjcore_last_error?: () => number
  kjcore_result_len?: () => number
  kjcore_result_value: (index: number) => number
  kjcore_alloc_f64: (length: number) => number
  kjcore_free_f64: (pointer: number, length: number) => void
  orientation_2d: NumericWasmFunction
  line_line_intersection_2d: NumericWasmFunction
  line_circle_intersection_2d: NumericWasmFunction
  circle_circle_intersection_2d: NumericWasmFunction
  polyline_length_2d: NumericWasmFunction
  polyline_signed_area_2d: NumericWasmFunction
  ellipse_arc_length_2d?: NumericWasmFunction
  rational_bspline_length_2d?: NumericWasmFunction
}

interface KJCoreBindgenModule extends Record<string, unknown> {
  kjcore_abi_version?: () => unknown
  kjcore_kernel_version?: () => unknown
  orientation_2d: NumericWasmFunction
  line_line_intersection_2d: (...values: number[]) => IntersectionBuffer
  line_circle_intersection_2d: (...values: number[]) => IntersectionBuffer
  circle_circle_intersection_2d: (...values: number[]) => IntersectionBuffer
  polyline_length_2d?: (coordinates: number[], closed: boolean) => number
  polyline_signed_area_2d?: (coordinates: number[]) => number
  ellipse_arc_length_2d?: NumericWasmFunction
  rational_bspline_length_2d?: (
    coordinates: number[],
    degree: number,
    knots: readonly number[],
    weights: readonly number[],
    tolerance: number,
  ) => number
}

export interface WasmToleranceOptions {
  tolerance?: Partial<KJToleranceOptions>
}

export interface KJCoreWasmInitializeOptions {
  wasmUrl?: string | URL
  moduleUrl?: string
  imports?: WebAssembly.Imports
  strict?: boolean
}

interface RawAllocation {
  pointer: number
  length: number
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

function unwrapExports(value: unknown): unknown {
  const record = recordValue(value)
  return record && 'exports' in record ? record.exports : value
}

function toleranceValues(options: WasmToleranceOptions = {}): [number, number, number] {
  const tolerance = options.tolerance ?? {}
  return [
    Number(tolerance.absolute ?? 1e-9),
    Number(tolerance.relative ?? 1e-12),
    Number(tolerance.angular ?? 1e-10),
  ]
}

function point(value: unknown, label: string): Point2 {
  if (
    !Array.isArray(value)
    || value.length < 2
    || ![value[0], value[1]].every(Number.isFinite)
  ) throw new KJValidationError(`${label} must be a finite 2D point`)
  return [Number(value[0]), Number(value[1])]
}

function domainCode(value: LineDomain): number {
  if (value === 'line') return 0
  if (value === 'ray') return 1
  if (value === 'segment') return 2
  throw new KJValidationError(`Unknown line domain: ${String(value)}`)
}

function decodeIntersection(buffer: IntersectionBuffer | null | undefined): KJIntersectionResult {
  const values = buffer == null ? [] : Array.from(buffer)
  if (values.length < 3) throw new KJValidationError('KJCore returned an invalid intersection buffer')
  const kinds = ['none', 'point', 'overlap'] as const
  const kind = kinds[values[0]!]
  const count = Math.trunc(values[2]!)
  if (!kind || count < 0 || values.length !== 3 + count * 4) {
    throw new KJValidationError('KJCore returned an incompatible intersection ABI')
  }
  const points: Point2[] = []
  const parametersA: number[] = []
  const parametersB: number[] = []
  for (let index = 0; index < count; index += 1) {
    const offset = 3 + index * 4
    points.push([values[offset]!, values[offset + 1]!])
    const parameterA = values[offset + 2]
    const parameterB = values[offset + 3]
    if (parameterA !== undefined && Number.isFinite(parameterA)) parametersA.push(parameterA)
    if (parameterB !== undefined && Number.isFinite(parameterB)) parametersB.push(parameterB)
  }
  return {
    kind,
    points,
    parametersA,
    parametersB,
    ...(values[1] === 1 ? { infinite: true } : {}),
  }
}

function packedVersion(value: unknown): string {
  const packed = Number(value) >>> 0
  return `${packed >>> 24}.${(packed >>> 12) & 0xfff}.${packed & 0xfff}`
}

function rawFailure(
  exports: KJCoreRawExports,
  operation: string,
  returnCode: unknown,
): KJValidationError {
  const code = Math.abs(Number(returnCode) || Number(exports.kjcore_last_error?.()) || 0)
  const reason = ERROR_MESSAGES[code] ?? `error ${code || 'unknown'}`
  return new KJValidationError(`KJCore ${operation} failed: ${reason}`)
}

function readRawIntersection(
  exports: KJCoreRawExports,
  operation: string,
  returnCode: number,
): KJIntersectionResult {
  if (!Number.isInteger(returnCode) || returnCode < 0) {
    throw rawFailure(exports, operation, returnCode)
  }
  const length = Number(exports.kjcore_result_len?.())
  if (length !== returnCode || length < 3 || length > 11) {
    throw new KJValidationError(`KJCore ${operation} returned an incompatible result length`)
  }
  return decodeIntersection(Array.from({ length }, (_, index) => exports.kjcore_result_value(index)))
}

function withRawCoordinates(
  exports: KJCoreRawExports,
  vertices: readonly Point2Input[],
  operation: string,
): RawAllocation {
  if (
    typeof exports.kjcore_alloc_f64 !== 'function'
    || typeof exports.kjcore_free_f64 !== 'function'
    || !exports.memory
  ) throw new KJValidationError(`KJCore ${operation} memory ABI is missing`)
  const coordinates = vertices.flatMap((value, index) => point(value, `vertices[${index}]`))
  const pointer = exports.kjcore_alloc_f64(coordinates.length)
  try {
    new Float64Array(exports.memory.buffer, pointer, coordinates.length).set(coordinates)
    return { pointer, length: coordinates.length }
  } catch (error) {
    exports.kjcore_free_f64(pointer, coordinates.length)
    throw error
  }
}

function rawPolylineMetric(
  exports: KJCoreRawExports,
  vertices: readonly Point2Input[],
  operation: string,
  callback: (pointer: number, length: number) => number,
): number {
  const allocation = withRawCoordinates(exports, vertices, operation)
  try {
    const value = callback(allocation.pointer, allocation.length)
    if (!Number.isFinite(value)) throw rawFailure(exports, operation, exports.kjcore_last_error?.())
    return value
  } finally {
    exports.kjcore_free_f64(allocation.pointer, allocation.length)
  }
}

function withRawNumbers(
  exports: KJCoreRawExports,
  values: readonly unknown[] | null | undefined,
  operation: string,
): RawAllocation {
  const numbers = (values ?? []).map(Number)
  if (numbers.some(value => !Number.isFinite(value))) {
    throw new KJValidationError(`KJCore ${operation} received a non-finite buffer value`)
  }
  if (!numbers.length) return { pointer: 0, length: 0 }
  const pointer = exports.kjcore_alloc_f64(numbers.length)
  try {
    new Float64Array(exports.memory.buffer, pointer, numbers.length).set(numbers)
    return { pointer, length: numbers.length }
  } catch (error) {
    exports.kjcore_free_f64(pointer, numbers.length)
    throw error
  }
}

function freeRawNumbers(exports: KJCoreRawExports, allocation: RawAllocation | null | undefined): void {
  if (allocation?.length) exports.kjcore_free_f64(allocation.pointer, allocation.length)
}

/** Casts only after checking the ABI discriminator; individual operations retain runtime validation. */
function createRawBackend(source: unknown): KJGeometryBackend {
  const candidate = unwrapExports(source)
  const record = recordValue(candidate)
  if (!record || typeof record.kjcore_abi_magic !== 'function') {
    throw new KJValidationError('KJCore raw WASM exports are missing')
  }
  const exports = record as KJCoreRawExports
  const magic = Number(exports.kjcore_abi_magic()) >>> 0
  if (magic !== EXPECTED_ABI_MAGIC) {
    throw new KJValidationError(
      `KJCore WASM ABI mismatch: expected 0x${EXPECTED_ABI_MAGIC.toString(16)}, received 0x${magic.toString(16)}`,
    )
  }
  const version = packedVersion(exports.kjcore_kernel_version_packed?.() ?? 0)
  const backend: KJGeometryBackend = {
    id: 'kjcore-rust-wasm',
    abi: EXPECTED_ABI,
    version,
    authoritative: true,
    orientation2(a: Point2Input, b: Point2Input, c: Point2Input): Orientation {
      const resolvedA = point(a, 'a')
      const resolvedB = point(b, 'b')
      const resolvedC = point(c, 'c')
      const value = exports.orientation_2d(...resolvedA, ...resolvedB, ...resolvedC)
      if (value === ORIENTATION_ERROR) {
        throw rawFailure(exports, 'orientation2', exports.kjcore_last_error?.())
      }
      return value as Orientation
    },
    intersectLineLine2(
      a0: Point2Input,
      a1: Point2Input,
      b0: Point2Input,
      b1: Point2Input,
      options: LineLineIntersectionOptions = {},
    ): KJIntersectionResult {
      const resolvedA0 = point(a0, 'a0')
      const resolvedA1 = point(a1, 'a1')
      const resolvedB0 = point(b0, 'b0')
      const resolvedB1 = point(b1, 'b1')
      const [absolute, relative, angular] = toleranceValues(options)
      const result = exports.line_line_intersection_2d(
        ...resolvedA0,
        ...resolvedA1,
        ...resolvedB0,
        ...resolvedB1,
        domainCode(options.modeA ?? 'segment'),
        domainCode(options.modeB ?? 'segment'),
        absolute,
        relative,
        angular,
      )
      return readRawIntersection(exports, 'intersectLineLine2', result)
    },
    intersectLineCircle2(
      start: Point2Input,
      end: Point2Input,
      center: Point2Input,
      radius: number,
      options: LineCircleIntersectionOptions = {},
    ): KJIntersectionResult {
      const resolvedStart = point(start, 'start')
      const resolvedEnd = point(end, 'end')
      const resolvedCenter = point(center, 'center')
      const [absolute, relative, angular] = toleranceValues(options)
      const result = exports.line_circle_intersection_2d(
        ...resolvedStart,
        ...resolvedEnd,
        ...resolvedCenter,
        Number(radius),
        domainCode(options.mode ?? 'segment'),
        absolute,
        relative,
        angular,
      )
      return readRawIntersection(exports, 'intersectLineCircle2', result)
    },
    intersectCircleCircle2(
      centerA: Point2Input,
      radiusA: number,
      centerB: Point2Input,
      radiusB: number,
      options: CircleCircleIntersectionOptions = {},
    ): KJIntersectionResult {
      const resolvedCenterA = point(centerA, 'centerA')
      const resolvedCenterB = point(centerB, 'centerB')
      const [absolute, relative, angular] = toleranceValues(options)
      const result = exports.circle_circle_intersection_2d(
        ...resolvedCenterA,
        Number(radiusA),
        ...resolvedCenterB,
        Number(radiusB),
        absolute,
        relative,
        angular,
      )
      return readRawIntersection(exports, 'intersectCircleCircle2', result)
    },
    polylineLength2(
      vertices: readonly Point2Input[],
      options: PolylineMeasureOptions = {},
    ): number {
      return rawPolylineMetric(
        exports,
        vertices,
        'polylineLength2',
        (pointer, length) => exports.polyline_length_2d(pointer, length, options.closed ? 1 : 0),
      )
    },
    polylineArea2(vertices: readonly Point2Input[]): number {
      return rawPolylineMetric(
        exports,
        vertices,
        'polylineArea2',
        (pointer, length) => exports.polyline_signed_area_2d(pointer, length),
      )
    },
  }

  const ellipseArcLength = exports.ellipse_arc_length_2d
  if (typeof ellipseArcLength === 'function') {
    backend.ellipseArcLength2 = (
      major: number,
      minor: number,
      start: number,
      end: number,
      options: EllipseArcLengthOptions = {},
    ): number => {
      const value = ellipseArcLength(
        Number(major),
        Number(minor),
        Number(start),
        Number(end),
        Number(options.tolerance ?? 1e-9),
      )
      if (!Number.isFinite(value)) {
        throw rawFailure(exports, 'ellipseArcLength2', exports.kjcore_last_error?.())
      }
      return value
    }
  }

  const splineLength = exports.rational_bspline_length_2d
  if (typeof splineLength === 'function') {
    backend.splineLength2 = (
      controlPoints: readonly Point2Input[],
      options: SplineBackendOptions,
    ): number => {
      const coordinates = withRawCoordinates(exports, controlPoints, 'splineLength2')
      const knots = withRawNumbers(exports, options.knots, 'splineLength2')
      const weights = withRawNumbers(exports, options.weights, 'splineLength2')
      try {
        const value = splineLength(
          coordinates.pointer,
          coordinates.length,
          Number(options.degree),
          knots.pointer,
          knots.length,
          weights.pointer,
          weights.length,
          Number(options.tolerance ?? 1e-8),
        )
        if (!Number.isFinite(value)) {
          throw rawFailure(exports, 'splineLength2', exports.kjcore_last_error?.())
        }
        return value
      } finally {
        exports.kjcore_free_f64(coordinates.pointer, coordinates.length)
        freeRawNumbers(exports, knots)
        freeRawNumbers(exports, weights)
      }
    }
  }
  return backend
}

// Compatibility adapter for a wasm-bindgen module. New builds use the raw ABI.
function createBindgenBackend(source: unknown): KJGeometryBackend {
  const wasmModule = source as KJCoreBindgenModule
  const abi = wasmModule.kjcore_abi_version?.()
  if (abi !== EXPECTED_ABI) {
    throw new KJValidationError(
      `KJCore WASM ABI mismatch: expected ${EXPECTED_ABI}, received ${String(abi ?? 'missing')}`,
    )
  }
  const version = wasmModule.kjcore_kernel_version?.() ?? 'unknown'
  const backend: KJGeometryBackend = {
    id: 'kjcore-rust-wasm',
    abi,
    version,
    authoritative: true,
    orientation2(a: Point2Input, b: Point2Input, c: Point2Input): Orientation {
      const resolvedA = point(a, 'a')
      const resolvedB = point(b, 'b')
      const resolvedC = point(c, 'c')
      return wasmModule.orientation_2d(...resolvedA, ...resolvedB, ...resolvedC) as Orientation
    },
    intersectLineLine2(
      a0: Point2Input,
      a1: Point2Input,
      b0: Point2Input,
      b1: Point2Input,
      options: LineLineIntersectionOptions = {},
    ): KJIntersectionResult {
      const resolvedA0 = point(a0, 'a0')
      const resolvedA1 = point(a1, 'a1')
      const resolvedB0 = point(b0, 'b0')
      const resolvedB1 = point(b1, 'b1')
      const [absolute, relative, angular] = toleranceValues(options)
      return decodeIntersection(wasmModule.line_line_intersection_2d(
        ...resolvedA0,
        ...resolvedA1,
        ...resolvedB0,
        ...resolvedB1,
        domainCode(options.modeA ?? 'segment'),
        domainCode(options.modeB ?? 'segment'),
        absolute,
        relative,
        angular,
      ))
    },
    intersectLineCircle2(
      start: Point2Input,
      end: Point2Input,
      center: Point2Input,
      radius: number,
      options: LineCircleIntersectionOptions = {},
    ): KJIntersectionResult {
      const resolvedStart = point(start, 'start')
      const resolvedEnd = point(end, 'end')
      const resolvedCenter = point(center, 'center')
      const [absolute, relative, angular] = toleranceValues(options)
      return decodeIntersection(wasmModule.line_circle_intersection_2d(
        ...resolvedStart,
        ...resolvedEnd,
        ...resolvedCenter,
        Number(radius),
        domainCode(options.mode ?? 'segment'),
        absolute,
        relative,
        angular,
      ))
    },
    intersectCircleCircle2(
      centerA: Point2Input,
      radiusA: number,
      centerB: Point2Input,
      radiusB: number,
      options: CircleCircleIntersectionOptions = {},
    ): KJIntersectionResult {
      const resolvedCenterA = point(centerA, 'centerA')
      const resolvedCenterB = point(centerB, 'centerB')
      const [absolute, relative, angular] = toleranceValues(options)
      return decodeIntersection(wasmModule.circle_circle_intersection_2d(
        ...resolvedCenterA,
        Number(radiusA),
        ...resolvedCenterB,
        Number(radiusB),
        absolute,
        relative,
        angular,
      ))
    },
  }

  const polylineLength = wasmModule.polyline_length_2d
  if (typeof polylineLength === 'function') {
    backend.polylineLength2 = (
      vertices: readonly Point2Input[],
      options: PolylineMeasureOptions = {},
    ): number => polylineLength(
      vertices.flatMap((value, index) => point(value, `vertices[${index}]`)),
      Boolean(options.closed),
    )
  }
  const polylineArea = wasmModule.polyline_signed_area_2d
  if (typeof polylineArea === 'function') {
    backend.polylineArea2 = (vertices: readonly Point2Input[]): number => polylineArea(
      vertices.flatMap((value, index) => point(value, `vertices[${index}]`)),
    )
  }
  const ellipseArcLength = wasmModule.ellipse_arc_length_2d
  if (typeof ellipseArcLength === 'function') {
    backend.ellipseArcLength2 = (
      major: number,
      minor: number,
      start: number,
      end: number,
      options: EllipseArcLengthOptions = {},
    ): number => ellipseArcLength(
      Number(major),
      Number(minor),
      Number(start),
      Number(end),
      Number(options.tolerance ?? 1e-9),
    )
  }
  const splineLength = wasmModule.rational_bspline_length_2d
  if (typeof splineLength === 'function') {
    backend.splineLength2 = (
      controlPoints: readonly Point2Input[],
      options: SplineBackendOptions,
    ): number => splineLength(
      controlPoints.flatMap((value, index) => point(value, `controlPoints[${index}]`)),
      Number(options.degree),
      options.knots ?? [],
      options.weights ?? [],
      Number(options.tolerance ?? 1e-8),
    )
  }
  return backend
}

export function createWasmGeometryBackend(wasmModuleOrInstance: unknown): KJGeometryBackend {
  const candidate = recordValue(unwrapExports(wasmModuleOrInstance))
  return typeof candidate?.kjcore_abi_magic === 'function'
    ? createRawBackend(wasmModuleOrInstance)
    : createBindgenBackend(wasmModuleOrInstance)
}

export async function instantiateKJCoreWasm(
  wasmUrl: string | URL = '/kjcore/kjcore.wasm',
  imports: WebAssembly.Imports = {},
): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
  const response = await fetch(wasmUrl)
  if (!response.ok) throw new KJValidationError(`KJCore WASM request failed: HTTP ${response.status}`)
  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      return await WebAssembly.instantiateStreaming(response.clone(), imports)
    } catch {
      // Servers without application/wasm MIME fall back to ArrayBuffer.
    }
  }
  return WebAssembly.instantiate(await response.arrayBuffer(), imports)
}

export async function initializeKJCoreWasm({
  wasmUrl = '/kjcore/kjcore.wasm',
  moduleUrl,
  imports = {},
  strict = true,
}: KJCoreWasmInitializeOptions = {}): Promise<KJGeometryBackendIdentity | null> {
  try {
    let source: unknown
    if (moduleUrl) {
      const imported = await import(/* @vite-ignore */ moduleUrl) as Record<string, unknown>
      const initializer = imported.default
      if (typeof initializer === 'function') {
        await (initializer as (url: string | URL) => unknown)(wasmUrl)
      }
      source = imported
    } else {
      source = (await instantiateKJCoreWasm(wasmUrl, imports)).instance
    }
    return registerGeometryBackend(createWasmGeometryBackend(source))
  } catch (error) {
    recordGeometryBackendFailure(error)
    if (strict) throw error
    return null
  }
}

export { EXPECTED_ABI as KJCORE_WASM_ABI, EXPECTED_ABI_MAGIC as KJCORE_WASM_ABI_MAGIC }
