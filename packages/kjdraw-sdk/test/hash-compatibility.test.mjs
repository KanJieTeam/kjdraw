import test from 'node:test'
import assert from 'node:assert/strict'
import { fnv1a64, stableHash, canonicalStringify, normalizeName } from '../src/utils.js'

function reference(text) {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(String(text))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  return hash.toString(16).padStart(16, '0')
}

test('word arithmetic preserves all persisted FNV-1a64 fingerprints', () => {
  assert.equal(fnv1a64(''), 'cbf29ce484222325')
  assert.equal(fnv1a64('a'), 'af63dc4c8601ec8c')
  assert.equal(fnv1a64('foobar'), '85944171f73967e8')
  for (const input of [undefined, null, true, 0, -1, NaN, '\0', '工程図面 · Δ · 🛠', '\ud800x\udfff', 'a'.repeat(1048576)]) assert.equal(fnv1a64(input), reference(input))
  let seed = 0xcada2026
  for (let length = 0; length < 512; length++) {
    let text = ''
    for (let i = 0; i < length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; text += String.fromCharCode(seed >>> 16) }
    assert.equal(fnv1a64(text), reference(text), `UTF-16 input length ${length}`)
  }
})

test('canonical object ordering and UTF-8 conversion retain fingerprint compatibility', () => {
  for (const value of [{ z: [1, null, '中文'], a: { b: true, a: -0 } }, [], undefined, { points: Array.from({ length: 1024 }, (_, i) => [i, -i, i / 3]) }]) {
    assert.equal(stableHash(value), reference(canonicalStringify(value)))
  }
  assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }))
})

test('ASCII name fast path preserves en-US normalization including Unicode fallback', () => {
  for (const input of [undefined, null, 123, true, '', ' line ', '\tLWPOLYLINE\n', '中文图层', 'straße', 'İıi', 'Σσς', '\u00a0abc\u00a0', '\ud800', Symbol('name')]) {
    assert.equal(normalizeName(input), String(input ?? '').trim().toLocaleUpperCase('en-US'))
  }
  for (let code = 0; code < 65536; code += 17) {
    const text = ` a${String.fromCharCode(code)}z `
    assert.equal(normalizeName(text), text.trim().toLocaleUpperCase('en-US'))
  }
})
