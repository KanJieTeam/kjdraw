import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const asset = new URL('../src/assets/kjcontour.wasm', import.meta.url)
const bytes = await readFile(asset)
const module = new WebAssembly.Module(bytes)
const provenance = JSON.parse(await readFile(new URL('kjcontour.provenance.json', asset), 'utf8'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

test('contour WASM is an import-free ABI version 1 artifact with verified provenance', async () => {
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  const instance = new WebAssembly.Instance(module)
  assert.equal(instance.exports.kjcontour_abi_version(), 1)
  assert.equal(provenance.abiVersion, 1)
  assert.equal(provenance.algorithm.version, '0.9.0')
  assert.equal(provenance.sha256, sha256(bytes))
  const embedded = bytes.toString('latin1')
  assert.doesNotMatch(embedded, /[A-Za-z]:[\\/][^\x00-\x1f\x7f]{2,}/,
    'distributed WASM must not contain absolute Windows ASCII paths')
  assert.doesNotMatch(embedded, /[A-Za-z]\x00:\x00[\\/]\x00|\x00[A-Za-z]\x00:\x00[\\/]/,
    'distributed WASM must not contain absolute Windows UTF-16 paths')
  assert.deepEqual(provenance.pathRemapping, { repository: '/kjdraw', cargoHome: '/cargo', rustupHome: '/rustup' })
  assert.ok(Object.hasOwn(provenance.sources, 'scripts/build-contour-wasm.mjs'))
  const licenses = await readFile(new URL('kjcontour-LICENSES.txt', asset))
  assert.equal(provenance.licensesSha256, sha256(licenses))
  assert.match(licenses.toString(), /Copyright \(c\) 2021 Jedidiah Buck McCready/)
  for (const [path, expected] of Object.entries(provenance.sources)) {
    assert.equal(sha256(await readFile(new URL(`../../../${path}`, import.meta.url))), expected, path)
  }
})

test('contour ABI distinguishes empty results and errors and releases owned input buffers', () => {
  const api = new WebAssembly.Instance(module).exports
  const data = new TextEncoder().encode(JSON.stringify({
    operation: 'offset', contours: [[[-5, 0, 1], [5, 0, 1]]], distance: -6, tolerance: 1e-7,
  }))
  const pointer = api.kjcontour_alloc(data.length)
  assert.notEqual(pointer, 0)
  new Uint8Array(api.memory.buffer, pointer, data.length).set(data)
  assert.equal(api.kjcontour_run(pointer, data.length), 0)
  const result = () => JSON.parse(new TextDecoder().decode(new Uint8Array(
    api.memory.buffer, api.kjcontour_result_ptr(), api.kjcontour_result_len(),
  )))
  assert.deepEqual(result(), { contours: [], area: 0 })
  // Incorrect free length must leave the owned allocation intact.
  api.kjcontour_free(pointer, data.length + 1)
  assert.equal(api.kjcontour_run(pointer, data.length), 0)
  api.kjcontour_free(pointer, data.length)
  assert.equal(api.kjcontour_run(pointer, data.length), 1)
  assert.match(result().error, /unowned request buffer/)
  api.kjcontour_free(pointer, data.length)
  assert.equal(api.kjcontour_run(0, 16), 1)
  assert.equal(api.kjcontour_alloc(0), 0)
  assert.equal(api.kjcontour_alloc(4 * 1024 * 1024 + 1), 0)
})

test('contour WASM rejects malformed JSON without trapping', () => {
  const api = new WebAssembly.Instance(module).exports
  const invalid = new TextEncoder().encode('{"operation":"offset",')
  const pointer = api.kjcontour_alloc(invalid.length)
  new Uint8Array(api.memory.buffer, pointer, invalid.length).set(invalid)
  assert.equal(api.kjcontour_run(pointer, invalid.length), 1)
  const output = new TextDecoder().decode(new Uint8Array(
    api.memory.buffer, api.kjcontour_result_ptr(), api.kjcontour_result_len(),
  ))
  assert.match(JSON.parse(output).error, /Invalid contour request/)
  api.kjcontour_free(pointer, invalid.length)
})

test('contour JSON ABI preserves f64 decimals and refuses cumulative frame error', () => {
  const api = new WebAssembly.Instance(module).exports
  const run = request => {
    const bytes = new TextEncoder().encode(JSON.stringify(request))
    const pointer = api.kjcontour_alloc(bytes.length)
    new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes)
    const status = api.kjcontour_run(pointer, bytes.length)
    const result = JSON.parse(new TextDecoder().decode(new Uint8Array(
      api.memory.buffer, api.kjcontour_result_ptr(), api.kjcontour_result_len(),
    )))
    api.kjcontour_free(pointer, bytes.length)
    return { status, result }
  }
  const contour = [[10000002.185602779, 10000002.185602779, 1],
    [9999997.814397221, 9999997.814397221, 1]]
  const unchanged = run({ operation: 'offset', contours: [contour], distance: 0, tolerance: 1e-9 })
  assert.equal(unchanged.status, 0)
  assert.deepEqual(unchanged.result.contours[0].vertices, contour)

  const x = 5e8, ulp = 2 ** -24
  const rounded = run({
    operation: 'offset', distance: 1.00000002985, tolerance: 1e-7,
    contours: [[[x - 1, x + ulp, 1], [x + 1, x + ulp, 1]],
      [[-x + ulp - 1, -x, 1], [-x + ulp + 1, -x, 1]]],
  })
  assert.equal(rounded.status, 1)
  assert.match(rounded.result.error, /Coordinate translation/)
})
