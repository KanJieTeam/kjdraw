import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const argument = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1]
}
const output = resolve(root, argument('--output') ?? '.cache/release-evidence/three-industry-candidate.json')
const resultPath = join(tmpdir(), `kjdraw-three-industry-${process.pid}-${Date.now()}.json`)
const protectedPaths = ['packages/kjdraw-sdk/src', 'apps/playground', 'tests/browser/three-industry-release-candidate.spec.mjs', 'scripts/audits', 'package.json', 'package-lock.json']
const changed = execFileSync('git', ['status', '--porcelain', '--', ...protectedPaths], { cwd: root, encoding: 'utf8' }).trim()
const cleanCandidateSources = changed.length === 0
if (!cleanCandidateSources && !process.argv.includes('--allow-dirty')) {
  console.error(`Candidate evidence requires committed source files:\n${changed}`)
  process.exit(1)
}

// Candidate evidence must execute against this checkout, never a stale local
// server from another worktree. Playwright's default config reuses an
// existing server outside CI, so force its isolated-server path here.
const env = { ...process.env, CI: 'true', KJDRAW_THREE_INDUSTRY_RESULT: resultPath }
if (!env.KJDRAW_CHROME_PATH) {
  for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', 'C:/Program Files/Google/Chrome/Application/chrome.exe']) {
    try { await access(candidate, constants.X_OK); env.KJDRAW_CHROME_PATH = candidate; break } catch {}
  }
}
const playwright = resolve(root, 'node_modules/@playwright/test/cli.js')
const execution = spawnSync(process.execPath, [playwright, 'test', 'tests/browser/three-industry-release-candidate.spec.mjs', '--project=chromium'], {
  cwd: root,
  env,
  stdio: 'inherit',
})
if (execution.status !== 0) process.exit(execution.status ?? 1)

const details = JSON.parse(await readFile(resultPath, 'utf8'))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const evidence = {
  schema: 'com.kanjie.kjdraw.audit.three-industry-candidate@1',
  commit,
  generatedAt: new Date().toISOString(),
  cleanCandidateSources,
  browser: 'chromium',
  checks: ['blank document', 'semantic compiler', 'public Workbench commit', 'edit', 'undo', 'redo', 'KJD reopen', 'KJP reopen', 'document validation', 'physical SVG', 'complete PNG', 'vector print HTML', 'independent geometry assertions'],
  ...details,
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify({ evidence: output, commit, scenarios: evidence.scenarios.map(row => ({ kind: row.kind, entities: row.entityCount, paperMm: row.paperMm, scale: row.millimetersPerModelUnit })) }, null, 2))
