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
    assert.equal(plan.suite, 'core'); assert.equal(plan.maxRequestsPerRepeat, 120)
    assert.equal(new Set(plan.scenarioIds).size, 12)
    assert.equal(plan.answerContractVersion, 'v5'); assert.equal(plan.answerEncoding, 'json-object')
    assert.match(plan.scope, /not independent human acceptance/)
  }
})

test('public stability entry rejects invalid budgets, duplicate options and missing output before model calls', () => {
  for (const args of [['--repeats', '0'], ['--repeats', '21'], ['--repeats', '1.5'],
    ['--repeats', '1', '--repeats', '2'], ['--suite', 'unknown'], ['--suite', 'core', '--suite', 'natural-language'], ['--provider'], ['--unknown'], ['--run']]) {
    const result = run(...args)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  }
})

test('public natural-language suite selects 24 existing frozen runnable variants without a model call', async () => {
  const result = run('--suite', 'natural-language')
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.modelCalls, 0); assert.equal(plan.suite, 'natural-language')
  assert.equal(plan.scenarioIds.length, 24); assert.equal(new Set(plan.scenarioIds).size, 24)
  assert.equal(plan.maxRequestsPerRepeat, 240)
  const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
  const { assessScenarioReadiness } = await import('../scripts/testing/preflight-geology-user-scenarios.mjs')
  for (const id of plan.scenarioIds) {
    const scenario = corpus.scenarios.find(row => row.id === id)
    assert.ok(scenario, `Existing frozen question ${id} is required`)
    assert.equal(assessScenarioReadiness(scenario).status, 'runnable', id)
    assert.ok(['zh-CN', 'en'].includes(scenario.language))
  }
})

test('broad suite selects every currently runnable frozen question, discloses excluded questions and never calls a model in dry run', async () => {
  const result = run('--suite', 'all-runnable', '--repeats', '1')
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.mode, 'dry-run'); assert.equal(plan.modelCalls, 0)
  assert.equal(plan.suite, 'all-runnable'); assert.equal(plan.repeats, 1)
  const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
  const { assessScenarioReadiness } = await import('../scripts/testing/preflight-geology-user-scenarios.mjs')
  const expected = corpus.scenarios.filter(row => assessScenarioReadiness(row).status === 'runnable').map(row => row.id)
  assert.deepEqual(plan.scenarioIds, expected)
  assert.equal(plan.corpusQuestions, corpus.scenarios.length)
  assert.equal(plan.notReadyQuestions, corpus.scenarios.length - expected.length)
  assert.equal(new Set(plan.scenarioIds).size, expected.length)
  assert.equal(plan.maxRequestsPerRepeat, Math.min(2000, expected.length * 10))
  assert.match(plan.readinessNote, /never counted as passes/)
})

test('native identity suite selects all six frozen variants without altering prompts or calling a model', async () => {
  const result = run('--suite', 'native-identity')
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.mode, 'dry-run'); assert.equal(plan.modelCalls, 0)
  assert.equal(plan.suite, 'native-identity'); assert.equal(plan.repeats, 5)
  assert.equal(plan.maxRequestsPerRepeat, 60)
  assert.equal(plan.answerContractVersion, 'v5'); assert.equal(plan.answerEncoding, 'json-object')
  const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
  const expected = corpus.scenarios.filter(row => row.id.startsWith('GUS1-cad-query.native-object-')).map(row => row.id)
  assert.equal(expected.length, 6)
  assert.deepEqual(plan.scenarioIds, expected)
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
