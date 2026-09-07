import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createWasmGeometryBackend,
  getGeometryBackendStatus,
  intersectCircleCircle2,
  intersectLineCircle2,
  intersectLineLine2,
  KJCORE_WASM_ABI,
  KJCORE_WASM_ABI_MAGIC,
  KJValidationError,
  orientation2,
  registerGeometryBackend,
  requireAuthoritativeGeometryBackend,
  unregisterGeometryBackend,
} from '../src/index.js'

function mockWasmModule() {
  return {
    kjcore_abi_version: () => KJCORE_WASM_ABI,
    kjcore_kernel_version: () => '1.0.0-test',
    orientation_2d: () => 1,
    line_line_intersection_2d: () => new Float64Array([1, 0, 1, 5, 0, 0.5, 0.5]),
    line_circle_intersection_2d: () => new Float64Array([1, 0, 2, -1, 0, 0.25, NaN, 1, 0, 0.75, NaN]),
    circle_circle_intersection_2d: () => new Float64Array([2, 1, 0]),
  }
}

function mockRawWasmExports() {
  let result = []
  const setResult = (values) => { result = values; return values.length }
  return {
    kjcore_abi_magic: () => KJCORE_WASM_ABI_MAGIC,
    kjcore_kernel_version_packed: () => 0x01000000,
    kjcore_last_error: () => 0,
    kjcore_result_len: () => result.length,
    kjcore_result_value: (index) => result[index],
    orientation_2d: () => 1,
    line_line_intersection_2d: () => setResult([1, 0, 1, 5, 0, 0.5, 0.5]),
    line_circle_intersection_2d: () => setResult([1, 0, 2, -1, 0, 0.25, NaN, 1, 0, 0.75, NaN]),
    circle_circle_intersection_2d: () => setResult([2, 1, 0]),
  }
}

test('Rust/WASM geometry bridge is explicit, authoritative and ABI checked', () => {
  unregisterGeometryBackend()
  assert.equal(getGeometryBackendStatus().mode, 'reference')
  assert.throws(() => requireAuthoritativeGeometryBackend(), KJValidationError)
  assert.throws(() => createWasmGeometryBackend({ kjcore_abi_version: () => 'wrong' }), /ABI mismatch/)

  const identity = registerGeometryBackend(createWasmGeometryBackend(mockWasmModule()))
  assert.deepEqual(identity, { id: 'kjcore-rust-wasm', abi: KJCORE_WASM_ABI, version: '1.0.0-test', authoritative: true })
  assert.equal(getGeometryBackendStatus().authoritative, true)
  assert.equal(orientation2([0, 0], [1, 0], [0, 1]), 1)

  const crossing = intersectLineLine2([0, 0], [10, 0], [5, -1], [5, 1])
  assert.deepEqual(crossing, { kind: 'point', points: [[5, 0]], parametersA: [0.5], parametersB: [0.5] })
  const circle = intersectLineCircle2([-2, 0], [2, 0], [0, 0], 1)
  assert.deepEqual(circle.points, [[-1, 0], [1, 0]])
  const overlap = intersectCircleCircle2([0, 0], 1, [0, 0], 1)
  assert.deepEqual(overlap, { kind: 'overlap', points: [], parametersA: [], parametersB: [], infinite: true })

  unregisterGeometryBackend()
  assert.equal(getGeometryBackendStatus().mode, 'reference')
  assert.equal(intersectLineLine2([0, 0], [2, 0], [1, -1], [1, 1]).kind, 'point')
})

test('raw Rust WASM ABI is accepted without generated JavaScript glue', () => {
  unregisterGeometryBackend()
  const identity = registerGeometryBackend(createWasmGeometryBackend({ exports: mockRawWasmExports() }))
  assert.deepEqual(identity, { id: 'kjcore-rust-wasm', abi: KJCORE_WASM_ABI, version: '1.0.0', authoritative: true })
  assert.equal(orientation2([0, 0], [1, 0], [0, 1]), 1)
  assert.deepEqual(intersectLineLine2([0, 0], [10, 0], [5, -1], [5, 1]), {
    kind: 'point', points: [[5, 0]], parametersA: [0.5], parametersB: [0.5],
  })
  unregisterGeometryBackend()
})
