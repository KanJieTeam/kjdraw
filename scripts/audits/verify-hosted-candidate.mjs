import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHostedCandidateEvidence } from './hosted-candidate-evidence.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const argument = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1]
}
const commit = argument('--commit') ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const repository = argument('--repository') ?? process.env.GITHUB_REPOSITORY ?? 'KanJieTeam/kjdraw'
const output = resolve(root, argument('--output') ?? '.cache/release-evidence/hosted-candidate.json')
const fixture = argument('--fixture')

async function github(path) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers: {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kjdraw-hosted-candidate-audit',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  } })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`)
  return response.json()
}

async function liveInput() {
  const encoded = encodeURIComponent(commit)
  const [ciRuns, pagesRuns] = await Promise.all([
    github(`actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${encoded}&per_page=20`),
    github(`actions/workflows/pages.yml/runs?branch=main&event=push&head_sha=${encoded}&per_page=20`),
  ])
  const choose = (runs, name) => runs.workflow_runs?.find(run => run.head_sha === commit && run.head_branch === 'main' && run.event === 'push')
    ?? (() => { throw new Error(`No exact main ${name} workflow run exists for ${commit}`) })()
  const ciRun = choose(ciRuns, 'CI'), pagesRun = choose(pagesRuns, 'Pages')
  const [ciJobs, pagesJobs] = await Promise.all([
    github(`actions/runs/${ciRun.id}/jobs?filter=latest&per_page=100`),
    github(`actions/runs/${pagesRun.id}/jobs?filter=latest&per_page=100`),
  ])
  return { ciRun, pagesRun, ciJobs: ciJobs.jobs, pagesJobs: pagesJobs.jobs }
}

const input = fixture ? JSON.parse(await readFile(resolve(root, fixture), 'utf8')) : await liveInput()
const evidence = buildHostedCandidateEvidence(input, { commit, repository })
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify({ evidence: output, repository, commit, ciRunId: evidence.ci.runId, pagesRunId: evidence.pages.runId, browsers: evidence.ci.browsers.map(row => row.engine) }, null, 2))
