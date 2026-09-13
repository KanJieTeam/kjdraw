import test from 'node:test'
import assert from 'node:assert/strict'

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
