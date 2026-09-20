import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const source = fileURLToPath(new URL('../bin/kjdraw-installed-mcp.mjs', import.meta.url))
const sha = '0123456789abcdef0123456789abcdef01234567'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-installed-launcher-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const launcher = join(root, 'bin', 'kjdraw-mcp.mjs')
  const install = join(root, `source-${sha.slice(0, 7)}`)
  const target = join(install, 'packages', 'kjdraw-sdk', 'bin', 'kjdraw-mcp.mjs')
  await mkdir(dirname(launcher), { recursive: true })
  await mkdir(dirname(target), { recursive: true })
  await writeFile(launcher, await readFile(source))
  await writeFile(join(install, '.kjdraw-source-sha'), sha)
  await writeFile(target, 'process.stdout.write(JSON.stringify({argv:process.argv.slice(2)}))\n')
  await writeFile(join(root, 'current.json'), `${JSON.stringify({ schema: 'com.kanjie.kjdraw.install-current@1', sourceSha: sha, installDirectory: install })}\n`)
  return { root, launcher, install, target }
}

test('stable installed launcher resolves an exact immutable source and preserves MCP arguments', async t => {
  const value = await fixture(t)
  const run = spawnSync(process.execPath, [value.launcher, '--workspace', 'fixture', '--input', 'host.kjd'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout).argv, ['--workspace', 'fixture', '--input', 'host.kjd'])
})

test('stable installed launcher rejects a mismatched source marker', async t => {
  const value = await fixture(t)
  await writeFile(join(value.install, '.kjdraw-source-sha'), 'f'.repeat(40))
  const run = spawnSync(process.execPath, [value.launcher], { encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /source marker does not match/u)
})

test('stable installed launcher rejects install directories outside its data root', async t => {
  const value = await fixture(t)
  const outside = await mkdtemp(join(tmpdir(), 'kjdraw-outside-'))
  t.after(async () => { await rm(outside, { recursive: true, force: true }) })
  await writeFile(join(value.root, 'current.json'), `${JSON.stringify({ schema: 'com.kanjie.kjdraw.install-current@1', sourceSha: sha, installDirectory: outside })}\n`)
  const run = spawnSync(process.execPath, [value.launcher], { encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /direct child/u)
})

test('stable installed launcher rejects a symbolic-link MCP entrypoint', { skip: process.platform === 'win32' }, async t => {
  const value = await fixture(t)
  const real = join(value.install, 'real.mjs')
  await writeFile(real, '')
  await rm(value.target)
  await symlink(real, value.target)
  const run = spawnSync(process.execPath, [value.launcher], { encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /entrypoint is missing or unsafe/u)
})