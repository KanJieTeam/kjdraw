import test from 'node:test'
import assert from 'node:assert/strict'
import { KJDRAW_LAYOUTS, normalizeWorkbenchLayout } from '../src/layout.js'

test('layout options share an explicit default and reject unsupported values', () => {
  assert.deepEqual(KJDRAW_LAYOUTS, ['classic', 'compact', 'focus'])
  assert.equal(normalizeWorkbenchLayout(undefined), 'classic')
  assert.equal(normalizeWorkbenchLayout(null), 'classic')
  for (const layout of KJDRAW_LAYOUTS) assert.equal(normalizeWorkbenchLayout(layout), layout)
  for (const invalid of ['', 'Compact', 'custom', {}, [], 0, false]) {
    assert.throws(() => normalizeWorkbenchLayout(invalid), TypeError)
  }
})
