import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProvenanceCandidateEvidence } from './provenance-candidate-evidence.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const argument = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1]
}
const commit = argument('--commit') ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
const repository = argument('--repository') ?? process.env.GITHUB_REPOSITORY ?? 'KanJieTeam/kjdraw'
const output = resolve(root, argument('--output') ?? '.cache/release-evidence/provenance-candidate.json')
const fixture = argument('--fixture')

async function github(path) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers: {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kjdraw-provenance-candidate-audit',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  } })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`)
  return response.json()
}

async function liveInput() {
  const encoded = encodeURIComponent(commit)
  const runs = await github(`actions/workflows/release-provenance.yml/runs?branch=main&event=push&head_sha=${encoded}&per_page=20`)
  const run = runs.workflow_runs?.find(row => row.head_sha === commit && row.head_branch === 'main' && row.event === 'push')
  if (!run) throw new Error(`No exact main provenance workflow run exists for ${commit}`)
  const jobs = await github(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`)
  return { run, jobs: jobs.jobs }
}

const input = fixture ? JSON.parse(await readFile(resolve(root, fixture), 'utf8')) : await liveInput()
const evidence = buildProvenanceCandidateEvidence(input, { commit, repository })
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify({ evidence: output, repository, commit, runId: evidence.run.id, jobId: evidence.job.id }, null, 2))
