import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
for (const script of ['scripts/build-docs-site.mjs', 'scripts/build-api-docs.mjs']) {
  const generated = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' })
  if (generated.status !== 0) process.exit(generated.status ?? 1)
}
const dir = 'packages/kjdraw-sdk/test'
const tests = (await readdir(new URL(`../${dir}/`, import.meta.url))).filter(x => x.endsWith('.test.mjs')).map(x => `${dir}/${x}`)
const reporters = process.env.GITHUB_ACTIONS === 'true'
  ? ['--test-reporter=spec', '--test-reporter=./scripts/github-test-reporter.mjs', '--test-reporter-destination=stdout', '--test-reporter-destination=stdout']
  : []
const concurrency = process.env.KJDRAW_TEST_CONCURRENCY ? [`--test-concurrency=${process.env.KJDRAW_TEST_CONCURRENCY}`] : []
const result = spawnSync(process.execPath, ['--test', ...concurrency, ...reporters, ...tests], { cwd: root, stdio: 'inherit' })
process.exit(result.status ?? 1)
