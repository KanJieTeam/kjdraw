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
// Its existing 5000 ms proposal assertion measures one compiler, not contention
// from unrelated test workers. Keep the complete file and unchanged assertion.
const isolatedTest = `${dir}/agent-geology-section.test.mjs`
const inventory = [...tests, ...integrationTests]
if (inventory.filter(file => file === isolatedTest).length !== 1) {
  console.error(`Timing-sensitive SDK test inventory must include ${isolatedTest} exactly once.`)
  process.exit(1)
}
if (new Set(inventory).size !== inventory.length) {
  console.error('Node test inventory contains duplicate paths.')
  process.exit(1)
}
const remainingTests = inventory.filter(file => file !== isolatedTest)
const reporters = process.env.GITHUB_ACTIONS === 'true'
  ? ['--test-reporter=spec', '--test-reporter=./scripts/github-test-reporter.mjs', '--test-reporter-destination=stdout', '--test-reporter-destination=stdout']
  : []
const concurrency = [`--test-concurrency=${testConcurrency}`]
const isolated = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...reporters, isolatedTest], { cwd: root, stdio: 'inherit' })
// A first-phase failure must remain a failure, but must not omit the other tests.
const result = remainingTests.length
  ? spawnSync(process.execPath, ['--test', ...concurrency, ...reporters, ...remainingTests], { cwd: root, stdio: 'inherit' })
  : { status: 0 }
process.exit(isolated.status !== 0 ? isolated.status ?? 1 : result.status ?? 1)
