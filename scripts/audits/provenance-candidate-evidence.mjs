export const PROVENANCE_CANDIDATE_SCHEMA = 'com.kanjie.kjdraw.audit.provenance-candidate@1'
export const PROVENANCE_JOB = 'verify-candidate'
export const PROVENANCE_STEPS = Object.freeze([
  'Bind this audit to the exact current main checks',
  'Build and verify candidate release artifacts without publishing',
  'Attest the verified candidate artifacts',
  'Record exact-main audit evidence',
  'Upload candidate provenance audit',
])

const successful = value => value?.status === 'completed' && value?.conclusion === 'success'

export function buildProvenanceCandidateEvidence(input, options) {
  const commit = String(options?.commit ?? ''), repository = String(options?.repository ?? '')
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('Candidate commit must be a full SHA')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Repository must be owner/name')
  const run = input?.run
  if (!run || run.head_sha !== commit || run.event !== 'push' || run.head_branch !== 'main' || !successful(run) || !Number.isSafeInteger(run.id) || run.id <= 0) throw new Error('Provenance workflow must be a successful exact-main push')
  const matches = input?.jobs?.filter(job => job.name === PROVENANCE_JOB) ?? []
  if (matches.length !== 1 || !successful(matches[0]) || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0) throw new Error('Provenance workflow requires one successful verify-candidate job')
  const job = matches[0]
  const steps = PROVENANCE_STEPS.map(name => {
    const found = job.steps?.filter(step => step.name === name) ?? []
    if (found.length !== 1 || !successful(found[0])) throw new Error(`Provenance step did not execute successfully: ${name}`)
    return { name, conclusion: 'success' }
  })
  return {
    schema: PROVENANCE_CANDIDATE_SCHEMA,
    repository,
    commit,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    run: { id: run.id, url: run.html_url ?? null, event: 'push', branch: 'main', conclusion: 'success' },
    job: { id: job.id, name: PROVENANCE_JOB, conclusion: 'success', steps },
  }
}

export function isProvenanceCandidateEvidence(value, { commit, repository } = {}) {
  return value?.schema === PROVENANCE_CANDIDATE_SCHEMA
    && value.commit === commit
    && (!repository || value.repository === repository)
    && Number.isSafeInteger(value.run?.id) && value.run.id > 0
    && value.run?.event === 'push' && value.run?.branch === 'main' && value.run?.conclusion === 'success'
    && Number.isSafeInteger(value.job?.id) && value.job.id > 0
    && value.job?.name === PROVENANCE_JOB && value.job?.conclusion === 'success'
    && value.job?.steps?.length === PROVENANCE_STEPS.length
    && PROVENANCE_STEPS.every(name => value.job.steps.filter(step => step?.name === name && step?.conclusion === 'success').length === 1)
}
