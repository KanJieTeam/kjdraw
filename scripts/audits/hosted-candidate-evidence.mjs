export const HOSTED_CANDIDATE_SCHEMA = 'com.kanjie.kjdraw.audit.hosted-candidate@1'
export const REQUIRED_BROWSER_ENGINES = Object.freeze(['chromium', 'firefox', 'webkit'])
export const PAGES_VERIFICATION_STEP = 'Verify the deployed workbench and documentation match this commit'

const completedSuccessfully = value => value?.status === 'completed' && value?.conclusion === 'success'

function assertRun(run, label, commit) {
  if (!run || typeof run !== 'object') throw new Error(`${label} workflow run is missing`)
  if (run.head_sha !== commit) throw new Error(`${label} workflow commit ${run.head_sha ?? '<missing>'} does not match ${commit}`)
  if (run.event !== 'push' || run.head_branch !== 'main') throw new Error(`${label} workflow must be an exact main push`)
  if (!completedSuccessfully(run)) throw new Error(`${label} workflow did not complete successfully`)
  if (!Number.isSafeInteger(run.id) || run.id <= 0) throw new Error(`${label} workflow run id is invalid`)
}

function successfulStep(job, name, label) {
  const step = job?.steps?.find(candidate => candidate.name === name)
  if (!step) throw new Error(`${label} is missing step: ${name}`)
  if (!completedSuccessfully(step)) throw new Error(`${label} step ${name} was ${step.status ?? 'missing'}/${step.conclusion ?? 'missing'}`)
  return step
}

export function buildHostedCandidateEvidence(input, options) {
  const commit = String(options?.commit ?? '')
  const repository = String(options?.repository ?? '')
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('Candidate commit must be a full 40-character SHA')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GitHub repository must be owner/name')
  assertRun(input?.ciRun, 'CI', commit)
  assertRun(input?.pagesRun, 'Pages', commit)

  const browsers = REQUIRED_BROWSER_ENGINES.map(engine => {
    const name = `Browser / ${engine}`
    const matches = input.ciJobs?.filter(job => job.name === name) ?? []
    if (matches.length !== 1) throw new Error(`CI must contain exactly one ${name} job`)
    const job = matches[0]
    if (!completedSuccessfully(job)) throw new Error(`${name} job did not complete successfully`)
    const step = successfulStep(job, `Run ${engine} acceptance`, name)
    return { engine, jobId: job.id, jobName: job.name, conclusion: job.conclusion, stepName: step.name, stepConclusion: step.conclusion, executed: true }
  })

  const pageJobs = input.pagesJobs?.filter(job => job.name === 'deploy') ?? []
  if (pageJobs.length !== 1) throw new Error('Pages must contain exactly one deploy job')
  const pageJob = pageJobs[0]
  if (!completedSuccessfully(pageJob)) throw new Error('Pages deploy job did not complete successfully')
  successfulStep(pageJob, 'Deploy', 'Pages deploy')
  const verification = successfulStep(pageJob, PAGES_VERIFICATION_STEP, 'Pages deploy')

  return {
    schema: HOSTED_CANDIDATE_SCHEMA,
    repository,
    commit,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ci: { runId: input.ciRun.id, url: input.ciRun.html_url ?? null, conclusion: input.ciRun.conclusion, browsers },
    pages: { runId: input.pagesRun.id, url: input.pagesRun.html_url ?? null, jobId: pageJob.id, conclusion: pageJob.conclusion, verificationStep: verification.name, verificationConclusion: verification.conclusion },
  }
}

export function isHostedCandidateEvidence(value, { commit, repository } = {}) {
  return value?.schema === HOSTED_CANDIDATE_SCHEMA
    && value.commit === commit
    && (!repository || value.repository === repository)
    && value.ci?.conclusion === 'success'
    && value.ci?.browsers?.length === REQUIRED_BROWSER_ENGINES.length
    && new Set(value.ci.browsers.map(row => row.engine)).size === REQUIRED_BROWSER_ENGINES.length
    && REQUIRED_BROWSER_ENGINES.every(engine => {
      const row = value.ci?.browsers?.find(candidate => candidate.engine === engine)
      return row?.executed === true && row?.conclusion === 'success' && row?.stepConclusion === 'success' && row?.stepName === `Run ${engine} acceptance`
    })
    && value.pages?.conclusion === 'success'
    && Number.isSafeInteger(value.ci?.runId) && value.ci.runId > 0
    && Number.isSafeInteger(value.pages?.runId) && value.pages.runId > 0
    && Number.isSafeInteger(value.pages?.jobId) && value.pages.jobId > 0
    && value.pages?.verificationStep === PAGES_VERIFICATION_STEP
    && value.pages?.verificationConclusion === 'success'
}
