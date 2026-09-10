import test from 'node:test'
import assert from 'node:assert/strict'
import { createHatchStrokeCoverage } from '../src/geometry/hatch-coverage.js'

function pattern(angle, cycle, residual, spacing, dashes, base = [0, 0]) {
  const u = [Math.cos(angle), Math.sin(angle)], n = [-u[1], u[0]]
  return { angle, base, offset: [u[0] * (cycle + residual) + n[0] * spacing, u[1] * (cycle + residual) + n[1] * spacing], dashes }
}
// Independent small oracle enumerates original rows without reducing the offset.
function brute(line, point, width) {
  const u = [Math.cos(line.angle), Math.sin(line.angle)], n = [-u[1], u[0]]
  const dx = point[0] - line.base[0], dy = point[1] - line.base[1]
  const x = dx * u[0] + dy * u[1], y = dx * n[0] + dy * n[1]
  const along = line.offset[0] * u[0] + line.offset[1] * u[1], spacing = line.offset[0] * n[0] + line.offset[1] * n[1]
  const a = (y - width / 2) / spacing, b = (y + width / 2) / spacing
  const cycle = line.dashes.reduce((sum, dash) => sum + Math.abs(dash), 0)
  let rows = 0
  for (let row = Math.ceil(Math.min(a, b)); row <= Math.floor(Math.max(a, b)); row++) {
    rows++
    const local = x - row * along, phase = local - Math.floor(local / cycle) * cycle
    let cursor = 0
    for (const dash of line.dashes) { if (dash > 0 && phase >= cursor && phase <= cursor + dash) return { covered: true, rows }; cursor += Math.abs(dash) }
  }
  return { covered: false, rows }
}

test('reduced lattice stroke samples agree with original-row enumeration and preserve dash gaps', () => {
  const lines = [pattern(0, 8, -1 / 65536, 1 / 32768, [3, -5]), pattern(Math.PI / 7, 8, 1 / 8192, -1 / 4096, [1, -2, 2, -3], [5, -7]), pattern(-Math.PI / 5, 8, -1 / 16384, -1 / 8192, [2, -6]), pattern(0, 8, 0, 1 / 32768, [3, -5])]
  let seed = 27, ink = 0, gaps = 0
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 }
  for (const line of lines) {
    const sampler = createHatchStrokeCoverage([line], 1 / 32)
    for (let i = 0; i < 500; i++) {
      const point = [(random() - .5) * 128, (random() - .5) * 128]
      const result = sampler.sample(point, 8), expected = brute(line, point, 1 / 32)
      assert.equal(result.limited, false)
      assert.equal(result.covered, expected.covered)
      assert.ok(result.work <= 3)
      if (result.covered) ink++; else gaps++
    }
  }
  assert.ok(ink > 500 && gaps > 500)
})

test('millions of original rows have bounded candidate work without becoming a solid fill', () => {
  const line = pattern(0, 8, -1 / 8388608, 1 / 16777216, [3, -5])
  const sampler = createHatchStrokeCoverage([line], 1 / 32)
  let originalRows = 0, ink = 0, gaps = 0
  for (let i = 0; i < 24; i++) {
    const point = [i * .337 + .123, i * .113 + .031]
    const expected = brute(line, point, 1 / 32), actual = sampler.sample(point, 8)
    assert.equal(actual.limited, false)
    assert.equal(actual.covered, expected.covered)
    assert.ok(actual.work <= 3)
    originalRows += expected.rows
    if (actual.covered) ink++; else gaps++
  }
  assert.ok(originalRows > 5_000_000)
  assert.ok(ink > 0 && gaps > 0)
})

test('coverage uses the union of families, snapshots input and handles continuous lines', () => {
  const horizontal = { angle: 0, base: [0, 0], offset: [0, 4], dashes: [] }
  const vertical = { angle: Math.PI / 2, base: [0, 0], offset: [4, 0], dashes: [] }
  const lines = [horizontal, vertical]
  const before = structuredClone(lines)
  const sampler = createHatchStrokeCoverage(lines, 1)
  assert.deepEqual(lines, before)
  assert.equal(Object.isFrozen(sampler), true)
  assert.equal(sampler.sample([1, .2]).covered, true)
  assert.equal(sampler.sample([.2, 1]).covered, true)
  assert.equal(sampler.sample([2, 2]).covered, false)
  horizontal.offset[1] = 1; vertical.base[0] = 2; lines.length = 0
  assert.equal(sampler.sample([2, 2]).covered, false)
  const collinear = createHatchStrokeCoverage([{ angle: 0, base: [0, 0], offset: [3, 0], dashes: [] }], 1)
  assert.equal(collinear.sample([999, .1]).covered, true)
  assert.equal(collinear.sample([0, 2]).covered, false)
  const dashed = createHatchStrokeCoverage([{ angle: 0, base: [0, 0], offset: [8, 0], dashes: [3, -5] }], 1)
  assert.equal(dashed.sample([1, .1]).covered, true)
  assert.equal(dashed.sample([4, .1]).covered, false)
})

test('unresolved dots, collinear phases, floating boundaries and unsafe ranges stay explicit', () => {
  const dots = { angle: 0, base: [0, 0], offset: [0, 1], dashes: [0, -1] }
  assert.equal(createHatchStrokeCoverage([dots], 1).sample([0, 0]).reason, 'unsupported-dots')
  const solid = { angle: 0, base: [0, 0], offset: [0, 1], dashes: [] }
  assert.equal(createHatchStrokeCoverage([dots, solid], 1).sample([0, 0]).covered, true)
  const collinear = { angle: 0, base: [0, 0], offset: [1, 0], dashes: [3, -5] }
  assert.equal(createHatchStrokeCoverage([collinear], 1).sample([0, 0]).reason, 'unsupported-collinear-phase')
  const line = { angle: 0, base: [0, 0], offset: [0, 4], dashes: [3, -5] }
  assert.equal(createHatchStrokeCoverage([line], 1).sample([0, .1]).reason, 'numeric-boundary')
  const tiny = { ...line, offset: [8, 1e-30] }
  const result = createHatchStrokeCoverage([tiny], 1).sample([1, 1])
  assert.deepEqual({ covered: result.covered, limited: result.limited, reason: result.reason }, { covered: null, limited: true, reason: 'numeric-range' })
})

test('candidate and family work budgets stop without fabricating a result', () => {
  const line = pattern(0, 8, 3, 1 / 16777216, [3, -5])
  const result = createHatchStrokeCoverage([line], 1 / 32).sample([.123, .321], 1)
  assert.deepEqual(result, { covered: null, limited: true, work: 1, reason: 'budget' })
  const offscreen = { angle: 0, base: [0, 0], offset: [0, 4], dashes: [] }
  assert.equal(createHatchStrokeCoverage([offscreen, offscreen], 1).sample([2, 2], 1).reason, 'budget')
  assert.deepEqual(createHatchStrokeCoverage([], 1).sample([0, 0]), { covered: false, limited: false, work: 0 })
  assert.equal(createHatchStrokeCoverage([{ ...offscreen, dashes: [-2] }], 1).sample([0, 0]).covered, false)
})

test('invalid pattern data, points and widths are rejected at the API boundary', () => {
  const line = { angle: 0, base: [0, 0], offset: [0, 4], dashes: [3, -5] }
  for (const width of [0, -1, NaN, Infinity]) assert.throws(() => createHatchStrokeCoverage([line], width), /Invalid HATCH/)
  for (const invalid of [{ ...line, angle: NaN }, { ...line, base: [0, Infinity] }, { ...line, dashes: [0, 0] }, { ...line, dashes: [Infinity] }, { ...line, offset: [Number.MAX_VALUE, Number.MAX_VALUE], angle: Math.PI / 4 }]) assert.throws(() => createHatchStrokeCoverage([invalid], 1), /Invalid HATCH/)
  const sampler = createHatchStrokeCoverage([line], 1)
  for (const point of [[NaN, 0], [0, Infinity], [], null]) assert.throws(() => sampler.sample(point), /Invalid HATCH/)
  for (const budget of [0, -1, .5, Infinity]) assert.throws(() => sampler.sample([0, 0], budget), /Invalid HATCH/)
})
