import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const sample = corpus.scenarios.find(row => row.expected.intent === 'source-strata.source-backed-description')
const other = corpus.scenarios.find(row => row.expected.intent === 'cad-query.inventory')
const run = (...args) => spawnSync(process.execPath, ['scripts/testing/rerun-geology-failures.mjs', ...args], { cwd: root, encoding: 'utf8', timeout: 30000 })
async function baselineFixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'kjdraw-failure-rerun-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const baseline = join(folder, 'baseline.json'), raw = JSON.stringify({ scenarios: [
    { id: sample.id, intent: sample.expected.intent, passed: false },
    { id: other.id, intent: other.expected.intent, passed: true },
  ] })
  await writeFile(baseline, raw, { flag: 'wx' })
  return { folder, baseline, raw }
}

test('default failure rerun is zero-call dry-run over original failed IDs, not all tasks or generated questions', async t => {
  const f = await baselineFixture(t)
  const result = run('--baseline', f.baseline)
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.mode, 'dry-run'); assert.equal(plan.modelCalls, 0); assert.equal(plan.repeats, 1)
  assert.deepEqual(plan.scenarioIds, [sample.id]); assert.equal(plan.maxRequestsPerRepeat, 10)
  assert.equal(plan.baselineSha256, createHash('sha256').update(f.raw).digest('hex'))
  assert.equal(plan.answerContractVersion, 'v5'); assert.equal(plan.answerEncoding, 'json-object')
  assert.match(plan.scope, /Never rescoring or overwriting/)
  assert.equal(await readFile(f.baseline, 'utf8'), f.raw)
})

test('unknown flags, malformed repeat budgets, empty intent selections and duplicate options fail before requests', async t => {
  const f = await baselineFixture(t)
  for (const extra of [['--repeats', '0'], ['--repeats', '21'], ['--repeats', '1.5'], ['--repeats', '2', '--repeats', '2'],
    ['--intent', 'nonexistent'], ['--unknown'], ['--output-dir'], ['--run']]) {
    const result = run('--baseline', f.baseline, ...extra)
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '')
  }
  assert.deepEqual(await readdir(f.folder), ['baseline.json'])
})

test('a prior evidence directory cannot be overwritten even with an explicit paid run', async t => {
  const f = await baselineFixture(t)
  const result = run('--baseline', f.baseline, '--run', '--output-dir', f.folder)
  assert.notEqual(result.status, 0); assert.equal(result.stdout, '')
  assert.equal(await readFile(f.baseline, 'utf8'), f.raw); assert.deepEqual(await readdir(f.folder), ['baseline.json'])
})

test('unknown frozen IDs and duplicate failed IDs cannot alter the test selection', async t => {
  const f = await baselineFixture(t)
  for (const scenarios of [
    [{ id: 'INVENTED-CASE', passed: false }],
    [{ id: sample.id, passed: false }, { id: sample.id, passed: false }],
  ]) {
    const path = join(f.folder, `invalid-${scenarios.length}.json`)
    await writeFile(path, JSON.stringify({ scenarios }), { flag: 'wx' })
    const result = run('--baseline', path)
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '')
  }
})
