import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('TypeScript plugin starter passes the public compatibility lifecycle', () => {
  const root = new URL('../../../', import.meta.url)
  const build = spawnSync(process.execPath, ['--no-warnings', 'scripts/build-plugin-starter.mjs', '--check'], { cwd: root, encoding: 'utf8' })
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`)
  const audit = spawnSync(process.execPath, ['scripts/audits/plugin-starter.mjs'], { cwd: root, encoding: 'utf8' })
  assert.equal(audit.status, 0, `${audit.stdout}\n${audit.stderr}`)
  assert.deepEqual(JSON.parse(audit.stdout).lifecycle, ['manifest-valid', 'compatible', 'permission-granted', 'activated', 'transaction-committed', 'disposed'])
})
