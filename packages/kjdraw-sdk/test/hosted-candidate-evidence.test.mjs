import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildHostedCandidateEvidence, isHostedCandidateEvidence, PAGES_VERIFICATION_STEP } from '../../../scripts/audits/hosted-candidate-evidence.mjs'

const commit = '1234567890abcdef1234567890abcdef12345678'
const completed = (extra = {}) => ({ status: 'completed', conclusion: 'success', ...extra })
const fixture = () => ({
  ciRun: completed({ id: 101, head_sha: commit, head_branch: 'main', event: 'push', html_url: 'https://example.test/ci' }),
  pagesRun: completed({ id: 202, head_sha: commit, head_branch: 'main', event: 'push', html_url: 'https://example.test/pages' }),
  ciJobs: ['chromium', 'firefox', 'webkit'].map((engine, index) => completed({ id: 300 + index, name: `Browser / ${engine}`, steps: [completed({ name: `Run ${engine} acceptance` })] })),
  pagesJobs: [completed({ id: 401, name: 'deploy', steps: [completed({ name: 'Deploy' }), completed({ name: PAGES_VERIFICATION_STEP })] })],
})

test('hosted candidate evidence binds all three browser jobs and deployed Pages verification to one main commit', () => {
  const evidence = buildHostedCandidateEvidence(fixture(), { commit, repository: 'KanJieTeam/kjdraw', generatedAt: '2026-09-14T00:00:00.000Z' })
  assert.equal(isHostedCandidateEvidence(evidence, { commit, repository: 'KanJieTeam/kjdraw' }), true)
  assert.equal(isHostedCandidateEvidence(evidence, { commit: 'f'.repeat(40), repository: 'KanJieTeam/kjdraw' }), false)
  assert.deepEqual(evidence.ci.browsers.map(row => row.engine), ['chromium', 'firefox', 'webkit'])
  assert.equal(evidence.pages.verificationConclusion, 'success')
})

test('hosted candidate CLI accepts an offline fixture and writes reviewable JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-hosted-evidence-'))
  const fixturePath = join(directory, 'fixture.json'), outputPath = join(directory, 'evidence.json')
  await writeFile(fixturePath, JSON.stringify(fixture()))
  const run = spawnSync(process.execPath, [
    'scripts/audits/verify-hosted-candidate.mjs', '--fixture', fixturePath, '--output', outputPath,
    '--commit', commit, '--repository', 'KanJieTeam/kjdraw',
  ], { cwd: new URL('../../../', import.meta.url), encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const evidence = JSON.parse(await readFile(outputPath, 'utf8'))
  assert.equal(isHostedCandidateEvidence(evidence, { commit, repository: 'KanJieTeam/kjdraw' }), true)
})

test('hosted candidate evidence rejects a successful run from another commit', () => {
  const input = fixture(); input.pagesRun.head_sha = 'a'.repeat(40)
  assert.throws(() => buildHostedCandidateEvidence(input, { commit, repository: 'KanJieTeam/kjdraw' }), /does not match/)
})

test('hosted candidate evidence rejects a skipped browser engine', () => {
  const input = fixture(); input.ciJobs[1].steps[0] = { name: 'Run firefox acceptance', status: 'completed', conclusion: 'skipped' }
  assert.throws(() => buildHostedCandidateEvidence(input, { commit, repository: 'KanJieTeam/kjdraw' }), /firefox.*skipped/i)
})

test('hosted candidate evidence rejects a failed workflow job or deployed-site verification', () => {
  const failedJob = fixture(); failedJob.ciJobs[2].conclusion = 'failure'
  assert.throws(() => buildHostedCandidateEvidence(failedJob, { commit, repository: 'KanJieTeam/kjdraw' }), /webkit job did not complete successfully/)
  const failedPages = fixture(); failedPages.pagesJobs[0].steps[1].conclusion = 'failure'
  assert.throws(() => buildHostedCandidateEvidence(failedPages, { commit, repository: 'KanJieTeam/kjdraw' }), /deployed workbench.*failure/i)
})
