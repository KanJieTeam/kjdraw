import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { build } from 'esbuild'
import { createKJDrawSDK } from '../src/index.js'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const startersRoot = join(repositoryRoot, 'examples', 'starters')
const packageSource = join(repositoryRoot, 'packages', 'kjdraw-sdk', 'src')
const starters = ['node-typescript', 'mcp-client', 'vanilla-browser', 'react-browser', 'vue-browser']

const packageEntryPlugin = {
  name: 'current-kjdraw-package',
  setup(builder) {
    builder.onResolve({ filter: /^@kanjieteam\/kjdraw(?:\/(.+))?$/ }, args => {
      const suffix = args.path.slice('@kanjieteam/kjdraw'.length)
      const entries = { '': 'index.ts', '/react': 'react.ts', '/vue': 'vue.ts' }
      const entry = entries[suffix]
      if (!entry) return { errors: [{ text: `Starter test has no source mapping for ${args.path}` }] }
      return { path: join(packageSource, entry) }
    })
  },
}

test('starter catalogue is copyable and every command points at a maintained project', async () => {
  const catalogue = await readFile(join(startersRoot, 'README.md'), 'utf8')
  for (const name of starters) {
    const directory = join(startersRoot, name)
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    assert.equal(manifest.private, true)
    assert.equal(manifest.type, 'module')
    assert.equal(manifest.dependencies['@kanjieteam/kjdraw'], 'next')
    assert.match(await readFile(join(directory, 'README.md'), 'utf8'), /npm install/u)
    assert.ok(catalogue.includes(`\`${name}\``))
  }
})

test('browser starters bundle against current public Vanilla, React and Vue entries', async t => {
  const output = await mkdtemp(join(tmpdir(), 'kjdraw-browser-starters-'))
  t.after(() => rm(output, { recursive: true, force: true }))
  const entries = [
    ['vanilla-browser', 'src/main.ts'],
    ['react-browser', 'src/main.tsx'],
    ['vue-browser', 'src/main.ts'],
  ]
  for (const [name, source] of entries) {
    const outfile = join(output, `${name}.js`)
    await build({
      entryPoints: [join(startersRoot, name, source)], outfile, bundle: true,
      format: 'esm', platform: 'browser', target: 'es2022',
      plugins: [packageEntryPlugin], logLevel: 'silent',
    })
    assert.ok((await stat(outfile)).size > 100_000, `${name} must bundle the real editor, not a placeholder`)
    assert.match(await readFile(outfile, 'utf8'), /radius: 5/u)
  }
})

test('Node TypeScript starter creates and reopens real KJD and DXF outputs', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'kjdraw-node-starter-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const bundle = join(scratch, 'starter.mjs'), output = join(scratch, 'output')
  await build({
    entryPoints: [join(startersRoot, 'node-typescript', 'src', 'index.ts')],
    outfile: bundle, bundle: true, format: 'esm', platform: 'node', target: 'node22',
    plugins: [packageEntryPlugin], logLevel: 'silent',
  })
  const run = spawnSync(process.execPath, [bundle], {
    cwd: scratch, env: { ...process.env, KJDRAW_STARTER_OUTPUT: output }, encoding: 'utf8',
  })
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
  const receipt = JSON.parse(run.stdout)
  assert.deepEqual(receipt.outputs, ['circle.kjd', 'circle.dxf'])
  assert.equal(receipt.radius, 5)
  const sdk = createKJDrawSDK()
  const [kjd, dxf] = await Promise.all([
    sdk.readDocument(await readFile(join(output, 'circle.kjd')), { format: 'KJD' }),
    sdk.readDocument(await readFile(join(output, 'circle.dxf')), { format: 'DXF' }),
  ])
  assert.equal(kjd.listEntities({ type: 'CIRCLE' })[0].payload.radius, 5)
  assert.equal(dxf.listEntities({ type: 'CIRCLE' })[0].payload.radius, 5)
})

test('MCP TypeScript starter launches the packaged server and receives a review candidate', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'kjdraw-mcp-starter-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const bundle = join(scratch, 'starter.mjs'), workspace = join(scratch, 'workspace')
  await build({
    entryPoints: [join(startersRoot, 'mcp-client', 'src', 'index.ts')],
    outfile: bundle, bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
  })
  const run = spawnSync(process.execPath, [bundle], {
    cwd: scratch,
    env: { ...process.env, KJDRAW_STARTER_OUTPUT: workspace,
      KJDRAW_MCP_SERVER: join(repositoryRoot, 'packages', 'kjdraw-sdk', 'bin', 'kjdraw-mcp.mjs') },
    encoding: 'utf8', timeout: 30_000,
  })
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
  const receipt = JSON.parse(run.stdout)
  assert.equal(receipt.tool, 'cad_propose_circles')
  assert.equal(receipt.status, 'candidate-ready')
  assert.equal(receipt.sourceOverwritten, false)
  assert.equal(existsSync(join(workspace, 'host.kjd')), true)
  const results = await readdir(join(workspace, 'results'))
  assert.ok(results.some(name => name.endsWith('.kjd')))
  assert.ok(results.some(name => name.endsWith('.dxf')))
  assert.ok(results.some(name => name.endsWith('.svg')))
})
