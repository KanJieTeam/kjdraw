import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const run = (...args) => spawnSync(process.execPath, ['scripts/testing/run-geology-stability.mjs', ...args], {
  cwd: root, encoding: 'utf8', timeout: 30_000,
})

test('public stability entry defaults to a zero-call dry run with twelve unique fixed cases', () => {
  for (const args of [[], ['--help'], ['--run', '--help']]) {
    const result = run(...args)
    assert.equal(result.status, 0, result.stderr)
    const plan = JSON.parse(result.stdout)
    assert.equal(plan.mode, 'dry-run'); assert.equal(plan.modelCalls, 0)
    assert.equal(plan.repeats, 5); assert.equal(plan.scenarioIds.length, 12)
    assert.equal(new Set(plan.scenarioIds).size, 12)
    assert.equal(plan.answerContractVersion, 'v5'); assert.equal(plan.answerEncoding, 'json-object')
    assert.match(plan.scope, /not independent human acceptance/)
  }
})

test('public stability entry rejects invalid budgets, duplicate options and missing output before model calls', () => {
  for (const args of [['--repeats', '0'], ['--repeats', '21'], ['--repeats', '1.5'],
    ['--repeats', '1', '--repeats', '2'], ['--provider'], ['--unknown'], ['--run']]) {
    const result = run(...args)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  }
})

test('public stability entry refuses an existing archive without touching its evidence', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'kjdraw-stability-entry-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await writeFile(join(folder, 'summary.json'), 'prior evidence\n', { flag: 'wx' })
  const result = run('--run', '--repeats', '1', '--output-dir', folder)
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.deepEqual(await readdir(folder), ['summary.json'])
  assert.equal(await readFile(join(folder, 'summary.json'), 'utf8'), 'prior evidence\n')
})
