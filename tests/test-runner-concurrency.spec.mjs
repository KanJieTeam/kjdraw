import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const runnerUrl = new URL('../scripts/test.mjs', import.meta.url)
const runnerSource = await readFile(runnerUrl, 'utf8')
const sectionSource = await readFile(new URL('../packages/kjdraw-sdk/test/agent-geology-section.test.mjs', import.meta.url), 'utf8')

// Execute the actual ES module. Only filesystem enumeration, process launching,
// host parallelism and process exit are replaced; no runner code is rewritten.
const harness = String.raw`
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
const cases = JSON.parse(process.argv[1]), url = process.argv[2]
const source = await readFile(new URL(url), 'utf8'), results = []
for (const input of cases) {
  const launches = [], enumerations = [], errors = []
  let exitCode, thrown
  const exit = Symbol('exit')
  const context = vm.createContext({ URL, console: { error: text => errors.push(text) }, process: {
    execPath: '/synthetic/node', env: input.env ?? {}, exit(code) { exitCode = code; throw exit },
  } })
  const modules = {
    'node:fs/promises': { readdir: async directory => {
      enumerations.push(directory.href)
      return directory.href.includes('/packages/kjdraw-sdk/test/')
        ? ['alpha.test.mjs', 'not-a-test.txt', 'beta.test.mjs']
        : ['one.spec.mjs', 'not-a-test.mjs', 'two.spec.mjs']
    } },
    'node:child_process': { spawnSync: (executable, args, options) => {
      launches.push({ executable, args, cwd: options.cwd, stdio: options.stdio })
      return { status: Object.hasOwn(input, 'statuses') ? input.statuses[launches.length - 1] : 0 }
    } },
    'node:os': { availableParallelism: () => input.parallelism },
    'node:url': { fileURLToPath },
  }
  const module = new vm.SourceTextModule(source, { context, identifier: url, initializeImportMeta(meta) { meta.url = url } })
  try {
    await module.link(specifier => {
      const bindings = modules[specifier]
      if (!bindings) throw new Error('Unexpected module import: ' + specifier)
      return new vm.SyntheticModule(Object.keys(bindings), function() {
        for (const [name, value] of Object.entries(bindings)) this.setExport(name, value)
      }, { context })
    })
    await module.evaluate()
  } catch (error) { if (error !== exit) thrown = String(error) }
  results.push({ launches, enumerations, errors, exitCode, thrown })
}
console.log(JSON.stringify(results))
`

function execute(cases) {
  const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-vm-modules', '--input-type=module', '-e', harness, JSON.stringify(cases), runnerUrl.href], { encoding: 'utf8', timeout: 15_000 })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  for (const row of output) assert.equal(row.thrown, undefined)
  return output
}

const parallelisms = [1, 2, 3, 4, 8, 32, 128]
const defaults = execute(parallelisms.map(parallelism => ({ parallelism })))
for (const [index, parallelism] of parallelisms.entries()) {
  test(`default runner concurrency is bounded on a ${parallelism}-way host`, () => {
    const actual = defaults[index]
    assert.equal(actual.exitCode, 0)
    assert.deepEqual(actual.launches.map(launch => launch.args[0]), ['scripts/build-docs-site.mjs', 'scripts/build-api-docs.mjs', '--test'])
    assert.equal(actual.launches[2].args[1], `--test-concurrency=${Math.min(4, parallelism)}`)
    assert.equal(actual.launches[2].args.filter(arg => arg.startsWith('--test-concurrency=')).length, 1)
  })
}

const overrides = ['1', '4', '16', '64', ' 3 ', '02']
const explicit = execute(overrides.map(value => ({ parallelism: 2, env: { KJDRAW_TEST_CONCURRENCY: value } })))
for (const [index, value] of overrides.entries()) {
  test(`explicit decimal concurrency ${JSON.stringify(value)} remains effective`, () => {
    assert.equal(explicit[index].exitCode, 0)
    assert.equal(explicit[index].launches[2].args[1], `--test-concurrency=${Number(value)}`)
  })
}

const invalid = ['', ' ', '0', '-1', '1.5', 'NaN', 'Infinity', '1e2', '0x4', '65', '9007199254740993', '4 --test-skip-pattern=.*']
const rejected = execute(invalid.map(value => ({ parallelism: 32, env: { KJDRAW_TEST_CONCURRENCY: value } })))
for (const [index, value] of invalid.entries()) {
  test(`invalid concurrency ${JSON.stringify(value)} rejects before generation or tests`, () => {
    assert.equal(rejected[index].exitCode, 1)
    assert.deepEqual(rejected[index].launches, [])
    assert.deepEqual(rejected[index].enumerations, [])
    assert.deepEqual(rejected[index].errors, ['KJDRAW_TEST_CONCURRENCY must be an integer from 1 to 64.'])
  })
}

test('CI reporters and the complete enumerated inventory are retained without skip filters', () => {
  const [actual] = execute([{ parallelism: 128, env: { GITHUB_ACTIONS: 'true' } }])
  assert.equal(actual.exitCode, 0)
  assert.deepEqual(actual.launches[2].args, [
    '--test', '--test-concurrency=4', '--test-reporter=spec', '--test-reporter=./scripts/github-test-reporter.mjs',
    '--test-reporter-destination=stdout', '--test-reporter-destination=stdout',
    'packages/kjdraw-sdk/test/alpha.test.mjs', 'packages/kjdraw-sdk/test/beta.test.mjs', 'tests/one.spec.mjs', 'tests/two.spec.mjs',
  ])
  assert.deepEqual(actual.enumerations, [new URL('../packages/kjdraw-sdk/test/', import.meta.url).href, new URL('./', import.meta.url).href])
  for (const launch of actual.launches) {
    assert.equal(launch.executable, '/synthetic/node')
    assert.equal(launch.cwd, fileURLToPath(new URL('../', import.meta.url)))
    assert.equal(launch.stdio, 'inherit')
  }
  assert.ok(!actual.launches[2].args.some(arg => /skip|name-pattern|only/.test(arg)))
})

test('generation failures and actual Node test failures still propagate without retries', () => {
  const results = execute([
    { parallelism: 4, statuses: [9] }, { parallelism: 4, statuses: [0, 7] },
    { parallelism: 4, statuses: [0, 0, 3] }, { parallelism: 4, statuses: [0, 0, null] },
  ])
  assert.deepEqual(results.map(result => result.exitCode), [9, 7, 3, 1])
  assert.deepEqual(results.map(result => result.launches.length), [1, 2, 3, 3])
})

test('section assertion keeps its exact 5000 ms boundary and exposes actual workload diagnostics', () => {
  assert.match(sectionSource, /for \(const holeCount of \[5, 10, 24\]\)/)
  const diagnosticCode = sectionSource.match(/const elapsedMs = performance\.now\(\) - started\r?\n\s*assert\.ok\(elapsedMs < 5000[^\r\n]+/u)?.[0]
  assert.ok(diagnosticCode, 'The actual assertion must retain elapsedMs < 5000')
  const run = elapsedMs => vm.runInNewContext(diagnosticCode, { assert, started: 0, performance: { now: () => elapsedMs }, holeCount: 24, availableParallelism: () => 8 })
  assert.doesNotThrow(() => run(4999.99))
  for (const elapsedMs of [5000, 5000.01, 10_000]) {
    assert.throws(() => run(elapsedMs), error => error.code === 'ERR_ASSERTION' &&
      error.message.includes('holeCount=24') && error.message.includes(`elapsedMs=${elapsedMs.toFixed(2)}`) &&
      error.message.includes('availableParallelism=8') && error.message.includes('unchanged 5000 ms budget'))
  }
  assert.doesNotMatch(runnerSource, /--test-(?:skip|name)-pattern/)
})
