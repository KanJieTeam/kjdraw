import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('packaged npm quickstart resolves the package export and edits real geometry', () => {
  const result = spawnSync(process.execPath, ['examples/quickstart.mjs'], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const output = JSON.parse(result.stdout)
  assert.equal(output.sdkVersion, '0.7.2-preview.1')
  assert.equal(output.documentId, 'npm-quickstart')
  assert.equal(output.entities, 1)
  assert.deepEqual(output.line.start, [25, 10, 0])
  assert.deepEqual(output.line.end, [125, 10, 0])
})
