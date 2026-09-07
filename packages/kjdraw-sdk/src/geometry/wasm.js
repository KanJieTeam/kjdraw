import { KJValidationError } from '../errors.js'
import { recordGeometryBackendFailure, registerGeometryBackend } from './backend.js'

const EXPECTED_ABI = 'kanjie.kjcore.wasm.v1'
const EXPECTED_ABI_MAGIC = 0x4b4a4301
const ORIENTATION_ERROR = -2147483648
const DOMAIN_CODES = Object.freeze({ line: 0, ray: 1, segment: 2 })
const ERROR_MESSAGES = Object.freeze({
  1: 'non-finite coordinate',
  2: 'degenerate direction',
  3: 'invalid radius',
  4: 'invalid tolerance',
  5: 'invalid coordinate buffer or line domain',
  6: 'invalid curve definition',
})

function toleranceValues(options = {}) {
  const tolerance = options.tolerance ?? {}
  return [Number(tolerance.absolute ?? 1e-9), Number(tolerance.relative ?? 1e-12), Number(tolerance.angular ?? 1e-10)]
}

function point(value, label) {
  if (!Array.isArray(value) || value.length < 2 || ![value[0], value[1]].every(Number.isFinite)) throw new KJValidationError(`${label} must be a finite 2D point`)
  return [Number(value[0]), Number(value[1])]
}

function domainCode(value) {
  const code = DOMAIN_CODES[value]
  if (code === undefined) throw new KJValidationError(`Unknown line domain: ${value}`)
  return code
}

function decodeIntersection(buffer) {
  const values = Array.from(buffer ?? [])
  if (values.length < 3) throw new KJValidationError('KJCore returned an invalid intersection buffer')
  const kinds = ['none', 'point', 'overlap']
  const kind = kinds[values[0]]
  const count = Math.trunc(values[2])
  if (!kind || count < 0 || values.length !== 3 + count * 4) throw new KJValidationError('KJCore returned an incompatible intersection ABI')
  const points = [], parametersA = [], parametersB = []
  for (let index = 0; index < count; index += 1) {
    const offset = 3 + index * 4
    points.push([values[offset], values[offset + 1]])
    if (Number.isFinite(values[offset + 2])) parametersA.push(values[offset + 2])
    if (Number.isFinite(values[offset + 3])) parametersB.push(values[offset + 3])
  }
  return { kind, points, parametersA, parametersB, ...(values[1] === 1 ? { infinite: true } : {}) }
}

function packedVersion(value) {
  const packed = Number(value) >>> 0
  return `${packed >>> 24}.${(packed >>> 12) & 0xfff}.${packed & 0xfff}`
}

function rawFailure(exports, operation, returnCode) {
  const code = Math.abs(Number(returnCode) || Number(exports.kjcore_last_error?.()) || 0)
  const reason = ERROR_MESSAGES[code] ?? `error ${code || 'unknown'}`
  return new KJValidationError(`KJCore ${operation} failed: ${reason}`)
}

function readRawIntersection(exports, operation, returnCode) {
  if (!Number.isInteger(returnCode) || returnCode < 0) throw rawFailure(exports, operation, returnCode)
  const length = Number(exports.kjcore_result_len?.())
  if (length !== returnCode || length < 3 || length > 11) throw new KJValidationError(`KJCore ${operation} returned an incompatible result length`)
  return decodeIntersection(Array.from({ length }, (_, index) => exports.kjcore_result_value(index)))
}

function withRawCoordinates(exports, vertices, operation) {
  if (typeof exports.kjcore_alloc_f64 !== 'function' || typeof exports.kjcore_free_f64 !== 'function' || !exports.memory) {
    throw new KJValidationError(`KJCore ${operation} memory ABI is missing`)
  }
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

function rawPolylineMetric(exports, vertices, operation, callback) {
  const allocation = withRawCoordinates(exports, vertices, operation)
  try {
    const value = callback(allocation.pointer, allocation.length)
    if (!Number.isFinite(value)) throw rawFailure(exports, operation, exports.kjcore_last_error?.())
    return value
  } finally {
    exports.kjcore_free_f64(allocation.pointer, allocation.length)
  }
}

function withRawNumbers(exports, values, operation) {
  values = (values ?? []).map(Number)
  if (values.some(value => !Number.isFinite(value))) throw new KJValidationError(`KJCore ${operation} received a non-finite buffer value`)
  if (!values.length) return { pointer: 0, length: 0 }
  const pointer = exports.kjcore_alloc_f64(values.length)
  try {
    new Float64Array(exports.memory.buffer, pointer, values.length).set(values)
    return { pointer, length: values.length }
  } catch (error) {
    exports.kjcore_free_f64(pointer, values.length)
    throw error
  }
}

function freeRawNumbers(exports, allocation) {
  if (allocation?.length) exports.kjcore_free_f64(allocation.pointer, allocation.length)
}

function createRawBackend(source) {
  const exports = source?.exports ?? source
  if (!exports || typeof exports.kjcore_abi_magic !== 'function') throw new KJValidationError('KJCore raw WASM exports are missing')
  const magic = Number(exports.kjcore_abi_magic()) >>> 0
  if (magic !== EXPECTED_ABI_MAGIC) throw new KJValidationError(`KJCore WASM ABI mismatch: expected 0x${EXPECTED_ABI_MAGIC.toString(16)}, received 0x${magic.toString(16)}`)
  const version = packedVersion(exports.kjcore_kernel_version_packed?.() ?? 0)
  return {
    id: 'kjcore-rust-wasm', abi: EXPECTED_ABI, version, authoritative: true,
    orientation2(a, b, c) {
      a = point(a, 'a'); b = point(b, 'b'); c = point(c, 'c')
      const value = exports.orientation_2d(a[0], a[1], b[0], b[1], c[0], c[1])
      if (value === ORIENTATION_ERROR) throw rawFailure(exports, 'orientation2', exports.kjcore_last_error?.())
      return value
    },
    intersectLineLine2(a0, a1, b0, b1, options = {}) {
      a0 = point(a0, 'a0'); a1 = point(a1, 'a1'); b0 = point(b0, 'b0'); b1 = point(b1, 'b1')
      const [absolute, relative, angular] = toleranceValues(options)
      const result = exports.line_line_intersection_2d(
        ...a0, ...a1, ...b0, ...b1,
        domainCode(options.modeA ?? 'segment'), domainCode(options.modeB ?? 'segment'), absolute, relative, angular,
      )
      return readRawIntersection(exports, 'intersectLineLine2', result)
    },
    intersectLineCircle2(start, end, center, radius, options = {}) {
      start = point(start, 'start'); end = point(end, 'end'); center = point(center, 'center')
      const [absolute, relative, angular] = toleranceValues(options)
      const result = exports.line_circle_intersection_2d(
        ...start, ...end, ...center, Number(radius), domainCode(options.mode ?? 'segment'), absolute, relative, angular,
      )
      return readRawIntersection(exports, 'intersectLineCircle2', result)
    },
    intersectCircleCircle2(centerA, radiusA, centerB, radiusB, options = {}) {
      centerA = point(centerA, 'centerA'); centerB = point(centerB, 'centerB')
      const [absolute, relative, angular] = toleranceValues(options)
      const result = exports.circle_circle_intersection_2d(...centerA, Number(radiusA), ...centerB, Number(radiusB), absolute, relative, angular)
      return readRawIntersection(exports, 'intersectCircleCircle2', result)
    },
    polylineLength2(vertices, options = {}) {
      return rawPolylineMetric(exports, vertices, 'polylineLength2', (pointer, length) => exports.polyline_length_2d(pointer, length, options.closed ? 1 : 0))
    },
    polylineArea2(vertices) {
      return rawPolylineMetric(exports, vertices, 'polylineArea2', (pointer, length) => exports.polyline_signed_area_2d(pointer, length))
    },
    ...(typeof exports.ellipse_arc_length_2d === 'function' ? {
      ellipseArcLength2(major, minor, start, end, options = {}) {
        const value = exports.ellipse_arc_length_2d(Number(major), Number(minor), Number(start), Number(end), Number(options.tolerance ?? 1e-9))
        if (!Number.isFinite(value)) throw rawFailure(exports, 'ellipseArcLength2', exports.kjcore_last_error?.())
        return value
      },
    } : {}),
    ...(typeof exports.rational_bspline_length_2d === 'function' ? {
      splineLength2(controlPoints, options = {}) {
        const coordinates = withRawCoordinates(exports, controlPoints, 'splineLength2')
        const knots = withRawNumbers(exports, options.knots, 'splineLength2')
        const weights = withRawNumbers(exports, options.weights, 'splineLength2')
        try {
          const value = exports.rational_bspline_length_2d(
            coordinates.pointer, coordinates.length, Number(options.degree),
            knots.pointer, knots.length, weights.pointer, weights.length, Number(options.tolerance ?? 1e-8),
          )
          if (!Number.isFinite(value)) throw rawFailure(exports, 'splineLength2', exports.kjcore_last_error?.())
          return value
        } finally {
          exports.kjcore_free_f64(coordinates.pointer, coordinates.length)
          freeRawNumbers(exports, knots)
          freeRawNumbers(exports, weights)
        }
      },
    } : {}),
  }
}

// Compatibility adapter for a wasm-bindgen module. Kept so integrators can
// move from the preview ABI without breaking, but new builds use createRawBackend.
function createBindgenBackend(wasmModule) {
  const abi = wasmModule.kjcore_abi_version?.()
  if (abi !== EXPECTED_ABI) throw new KJValidationError(`KJCore WASM ABI mismatch: expected ${EXPECTED_ABI}, received ${abi ?? 'missing'}`)
  const version = wasmModule.kjcore_kernel_version?.() ?? 'unknown'
  return {
    id: 'kjcore-rust-wasm', abi, version, authoritative: true,
    orientation2(a, b, c) {
      a = point(a, 'a'); b = point(b, 'b'); c = point(c, 'c')
      return wasmModule.orientation_2d(a[0], a[1], b[0], b[1], c[0], c[1])
    },
    intersectLineLine2(a0, a1, b0, b1, options = {}) {
      a0 = point(a0, 'a0'); a1 = point(a1, 'a1'); b0 = point(b0, 'b0'); b1 = point(b1, 'b1')
      const [absolute, relative, angular] = toleranceValues(options)
      return decodeIntersection(wasmModule.line_line_intersection_2d(
        ...a0, ...a1, ...b0, ...b1,
        domainCode(options.modeA ?? 'segment'), domainCode(options.modeB ?? 'segment'), absolute, relative, angular,
      ))
    },
    intersectLineCircle2(start, end, center, radius, options = {}) {
      start = point(start, 'start'); end = point(end, 'end'); center = point(center, 'center')
      const [absolute, relative, angular] = toleranceValues(options)
      return decodeIntersection(wasmModule.line_circle_intersection_2d(
        ...start, ...end, ...center, Number(radius), domainCode(options.mode ?? 'segment'), absolute, relative, angular,
      ))
    },
    intersectCircleCircle2(centerA, radiusA, centerB, radiusB, options = {}) {
      centerA = point(centerA, 'centerA'); centerB = point(centerB, 'centerB')
      const [absolute, relative, angular] = toleranceValues(options)
      return decodeIntersection(wasmModule.circle_circle_intersection_2d(...centerA, Number(radiusA), ...centerB, Number(radiusB), absolute, relative, angular))
    },
    ...(typeof wasmModule.polyline_length_2d === 'function' ? {
      polylineLength2(vertices, options = {}) {
        return wasmModule.polyline_length_2d(vertices.flatMap((value, index) => point(value, `vertices[${index}]`)), Boolean(options.closed))
      },
    } : {}),
    ...(typeof wasmModule.polyline_signed_area_2d === 'function' ? {
      polylineArea2(vertices) {
        return wasmModule.polyline_signed_area_2d(vertices.flatMap((value, index) => point(value, `vertices[${index}]`)))
      },
    } : {}),
    ...(typeof wasmModule.ellipse_arc_length_2d === 'function' ? {
      ellipseArcLength2(major, minor, start, end, options = {}) {
        return wasmModule.ellipse_arc_length_2d(Number(major), Number(minor), Number(start), Number(end), Number(options.tolerance ?? 1e-9))
      },
    } : {}),
    ...(typeof wasmModule.rational_bspline_length_2d === 'function' ? {
      splineLength2(controlPoints, options = {}) {
        return wasmModule.rational_bspline_length_2d(
          controlPoints.flatMap((value, index) => point(value, `controlPoints[${index}]`)),
          Number(options.degree), options.knots ?? [], options.weights ?? [], Number(options.tolerance ?? 1e-8),
        )
      },
    } : {}),
  }
}

export function createWasmGeometryBackend(wasmModuleOrInstance) {
  return typeof (wasmModuleOrInstance?.exports ?? wasmModuleOrInstance)?.kjcore_abi_magic === 'function'
    ? createRawBackend(wasmModuleOrInstance)
    : createBindgenBackend(wasmModuleOrInstance)
}

export async function instantiateKJCoreWasm(wasmUrl = '/kjcore/kjcore.wasm', imports = {}) {
  const response = await fetch(wasmUrl)
  if (!response.ok) throw new KJValidationError(`KJCore WASM request failed: HTTP ${response.status}`)
  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try { return await WebAssembly.instantiateStreaming(response.clone(), imports) }
    catch { /* Servers without application/wasm MIME fall back to ArrayBuffer. */ }
  }
  return WebAssembly.instantiate(await response.arrayBuffer(), imports)
}

export async function initializeKJCoreWasm({ wasmUrl = '/kjcore/kjcore.wasm', moduleUrl, imports = {}, strict = true } = {}) {
  try {
    let source
    if (moduleUrl) {
      source = await import(/* @vite-ignore */ moduleUrl)
      if (typeof source.default === 'function') await source.default(wasmUrl)
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
