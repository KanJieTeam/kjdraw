import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dir = 'packages/kjdraw-sdk/test'
const tests = (await readdir(new URL(`../${dir}/`, import.meta.url))).filter(x => x.endsWith('.test.mjs')).map(x => `${dir}/${x}`)
const reporters = process.env.GITHUB_ACTIONS === 'true'
  ? ['--test-reporter=spec', '--test-reporter=./scripts/github-test-reporter.mjs', '--test-reporter-destination=stdout', '--test-reporter-destination=stdout']
  : []
const result = spawnSync(process.execPath, ['--test', ...reporters, ...tests], { cwd: root, stdio: 'inherit' })
process.exit(result.status ?? 1)
