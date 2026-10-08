import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS, SOURCE_DRIFT_INSPECTION_V6_PROTOCOL }
  from '../scripts/testing/helpers/geology-source-drift-inspection-v6-oracles.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const run = (...args) => spawnSync(process.execPath, ['scripts/testing/run-geology-source-drift-inspection.mjs', ...args],
  { cwd: root, encoding: 'utf8', timeout: 30_000 })

test('source drift entry makes zero calls by default and preserves the exact separate protocol and six questions', () => {
  for (const args of [[], ['--help'], ['--run', '--help']]) {
    const result = run(...args)
    assert.equal(result.status, 0, result.stderr)
    const plan = JSON.parse(result.stdout)
    assert.equal(plan.mode, 'dry-run'); assert.equal(plan.modelCalls, 0)
    assert.equal(plan.repeats, 5); assert.equal(plan.maxRequestsPerRepeat, 60)
    assert.deepEqual(plan.scenarioIds, SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS)
    assert.equal(plan.scenarioIds.length, 6)
    assert.deepEqual(plan.protocol, SOURCE_DRIFT_INSPECTION_V6_PROTOCOL)
    assert.match(plan.entrySha256, /^[a-f0-9]{64}$/)
    assert.match(plan.usage, /unchanged V5 verdicts/)
  }
})

test('source drift entry rejects malformed or duplicate budgets and missing archives before any model call', () => {
  for (const args of [['--run'], ['--repeats', '0'], ['--repeats', '21'], ['--repeats', '1.5'],
    ['--repeats', '1', '--repeats', '2'], ['--unknown'], ['--provider']]) {
    const result = run(...args)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  }
})

test('source drift entry never overwrites an earlier evidence directory', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'kjdraw-source-drift-entry-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await writeFile(join(folder, 'summary.json'), 'prior failed evidence\n', { flag: 'wx' })
  const result = run('--run', '--output-dir', folder)
  assert.notEqual(result.status, 0); assert.equal(result.stdout, '')
  assert.deepEqual(await readdir(folder), ['summary.json'])
  assert.equal(await readFile(join(folder, 'summary.json'), 'utf8'), 'prior failed evidence\n')
})
