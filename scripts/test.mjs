import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dir = 'packages/kjdraw-sdk/test'
const tests = (await readdir(new URL(`../${dir}/`, import.meta.url))).filter(x => x.endsWith('.test.mjs')).map(x => `${dir}/${x}`)
const reporters = process.env.GITHUB_ACTIONS === 'true'
  ? ['--test-reporter=spec', '--test-reporter=./scripts/github-test-reporter.mjs', '--test-reporter-destination=stdout', '--test-reporter-destination=stdout']
  : []
// Independent DXF tests launch Python/ezdxf subprocesses. Keep Linux hosted
// release gates serial so those validators cannot contend for process streams.
const concurrency = process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true' ? ['--test-concurrency=1'] : []
const result = spawnSync(process.execPath, ['--test', ...concurrency, ...reporters, ...tests], { cwd: root, stdio: 'inherit' })
process.exit(result.status ?? 1)
