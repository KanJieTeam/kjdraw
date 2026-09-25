import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { buildProvenanceCandidateEvidence, isProvenanceCandidateEvidence, PROVENANCE_CANDIDATE_SCHEMA, PROVENANCE_STEPS } from '../../../scripts/audits/provenance-candidate-evidence.mjs'

const commit = 'a'.repeat(40), options = { commit, repository: 'KanJieTeam/kjdraw', generatedAt: '2026-09-14T00:00:00.000Z' }
const fixture = () => ({
  run: { id: 101, head_sha: commit, event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', html_url: 'https://github.com/KanJieTeam/kjdraw/actions/runs/101' },
  jobs: [{ id: 202, name: 'verify-candidate', status: 'completed', conclusion: 'success', steps: PROVENANCE_STEPS.map(name => ({ name, status: 'completed', conclusion: 'success' })) }],
})

test('provenance evidence requires every exact-main build, verify, attest and upload step', () => {
  const evidence = buildProvenanceCandidateEvidence(fixture(), options)
  assert.equal(evidence.schema, PROVENANCE_CANDIDATE_SCHEMA)
  assert.equal(isProvenanceCandidateEvidence(evidence, options), true)
  assert.deepEqual(evidence.job.steps.map(step => step.name), PROVENANCE_STEPS)
})

test('provenance evidence rejects another commit, non-push runs, skipped attestations and duplicate jobs', () => {
  const cases = [
    value => { value.run.head_sha = 'b'.repeat(40) },
    value => { value.run.event = 'workflow_dispatch' },
    value => { value.run.conclusion = 'failure' },
    value => { value.jobs[0].steps[2].conclusion = 'skipped' },
    value => { value.jobs.push(structuredClone(value.jobs[0])) },
  ]
  for (const mutate of cases) { const value = fixture(); mutate(value); assert.throws(() => buildProvenanceCandidateEvidence(value, options)) }
  const evidence = buildProvenanceCandidateEvidence(fixture(), options)
  evidence.job.steps.pop()
  assert.equal(isProvenanceCandidateEvidence(evidence, options), false)
})

test('provenance collector records only a successful exact-main fixture', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'kjdraw-provenance-test-'))
  try {
    const fixturePath = join(scratch, 'github.json')
    const outputPath = join(scratch, 'evidence.json')
    await writeFile(fixturePath, JSON.stringify(fixture()))
    const script = resolve('scripts/audits/verify-provenance-candidate.mjs')
    execFileSync(process.execPath, [script, '--fixture', fixturePath, '--commit', commit, '--output', outputPath], { encoding: 'utf8', windowsHide: true })
    const evidence = JSON.parse(await readFile(outputPath, 'utf8'))
    assert.equal(isProvenanceCandidateEvidence(evidence, options), true)
    const invalid = fixture()
    invalid.jobs[0].steps[2].conclusion = 'skipped'
    await writeFile(fixturePath, JSON.stringify(invalid))
    assert.throws(() => execFileSync(process.execPath, [script, '--fixture', fixturePath, '--commit', commit, '--output', outputPath], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})