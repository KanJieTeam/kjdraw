import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const requestedConcurrency = process.env.KJDRAW_TEST_CONCURRENCY?.trim()
const testConcurrency = requestedConcurrency === undefined ? Math.min(4, availableParallelism()) : Number(requestedConcurrency)
if (requestedConcurrency !== undefined && (!/^\d+$/.test(requestedConcurrency) || !Number.isSafeInteger(testConcurrency) || testConcurrency < 1 || testConcurrency > 64)) {
  console.error('KJDRAW_TEST_CONCURRENCY must be an integer from 1 to 64.')
  process.exit(1)
}
for (const script of ['scripts/build-docs-site.mjs', 'scripts/build-api-docs.mjs']) {
  const generated = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' })
  if (generated.status !== 0) process.exit(generated.status ?? 1)
}
const dir = 'packages/kjdraw-sdk/test'
const tests = (await readdir(new URL(`../${dir}/`, import.meta.url))).filter(x => x.endsWith('.test.mjs')).map(x => `${dir}/${x}`)
const integrationTests = (await readdir(new URL('../tests/', import.meta.url)))
  .filter(x => x.endsWith('.spec.mjs')).map(x => `tests/${x}`)
const reporters = process.env.GITHUB_ACTIONS === 'true'
  ? ['--test-reporter=spec', '--test-reporter=./scripts/github-test-reporter.mjs', '--test-reporter-destination=stdout', '--test-reporter-destination=stdout']
  : []
const concurrency = [`--test-concurrency=${testConcurrency}`]
const result = spawnSync(process.execPath, ['--test', ...concurrency, ...reporters, ...tests, ...integrationTests], { cwd: root, stdio: 'inherit' })
process.exit(result.status ?? 1)
