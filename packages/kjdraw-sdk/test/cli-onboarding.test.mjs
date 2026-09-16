import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const cli = fileURLToPath(new URL('../bin/kjdraw.mjs', import.meta.url))
const packageFile = fileURLToPath(new URL('../package.json', import.meta.url))
const configs = ['.kimi-code/mcp.json', '.workbuddy/mcp.json', '.zcode/cli/config.json']
const skills = ['.kimi-code/skills/kjdraw-cad/SKILL.md', '.zcode/skills/kjdraw-cad/SKILL.md', '.trae/skills/kjdraw-cad/SKILL.md']

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, KJDRAW_USER_HOME: cwd } })
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-cli-onboard-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function fingerprint(root) {
  const names = (await readdir(root, { recursive: true })).sort()
  const files = []
  for (const name of names) {
    const path = join(root, name)
    const info = await stat(path)
    if (info.isFile()) files.push([name.replaceAll('\\', '/'), createHash('sha256').update(await readFile(path)).digest('hex'), info.mtimeMs])
  }
  return { names: names.map(name => name.replaceAll('\\', '/')), files }
}

test('package keeps the existing public binaries and exposes kjdraw as the primary CLI', async () => {
  const packageJson = JSON.parse(await readFile(packageFile, 'utf8'))
  assert.deepEqual(packageJson.bin, {
    kjdraw: './bin/kjdraw.mjs',
    'kjdraw-mcp': './bin/kjdraw-mcp.mjs',
    'kjdraw-connect': './bin/kjdraw-connect.mjs',
    'kjdraw-review': './bin/kjdraw-review.mjs',
  })
})

test('kjdraw doctor is read-only and reports missing onboarding without claiming GUI or model verification', async t => {
  const root = await fixture(t)
  const before = await fingerprint(root)
  const response = run(root, ['doctor'])
  assert.equal(response.status, 1, response.stderr)
  const report = JSON.parse(response.stdout)
  assert.equal(report.command, 'doctor')
  assert.equal(report.ok, false)
  assert.equal(report.verification.writesPerformed, 0)
  assert.equal(report.verification.guiVerified, false)
  assert.equal(report.verification.realModelVerified, false)
  assert.equal(report.checks.find(check => check.id === 'node').status, 'ok')
  assert.equal(report.checks.find(check => check.id === 'mcp-script').status, 'ok')
  assert.equal(report.checks.find(check => check.id === 'host-drawing').status, 'missing')
  assert.ok(report.checks.filter(check => check.id === 'client-config').every(check => check.status === 'missing'))
  assert.equal(report.checks.find(check => check.client === 'WorkBuddy' && check.id === 'client-skill').status, 'manual-installation-required')
  assert.deepEqual(await fingerprint(root), before)
})

test('kjdraw onboard connects the current user home, is idempotent, and doctor verifies only local files', async t => {
  const root = await fixture(t)
  const first = run(root, ['onboard'])
  assert.equal(first.status, 0, first.stderr)
  const receipt = JSON.parse(first.stdout)
  assert.equal(receipt.command, 'onboard')
  assert.equal(receipt.applied, true)
  assert.equal(receipt.drawing, 'created blank')
  assert.equal(receipt.clients.length, 4)
  assert.equal(receipt.verification.userConfigurationInstalled, true)
  assert.equal(receipt.verification.guiVerified, false)
  assert.equal(receipt.verification.realModelVerified, false)
  for (const path of [...configs, ...skills, '.kjdraw/host.kjd', '.kjdraw/trae-install-url.txt']) assert.ok((await stat(join(root, path))).isFile())
  assert.match(await readFile(join(root, '.kjdraw/trae-install-url.txt'), 'utf8'), /^trae-cn:\/\/trae\.ai-ide\/mcp-import\?/)

  const afterFirst = await fingerprint(root)
  const second = run(root, ['onboard'])
  assert.equal(second.status, 0, second.stderr)
  assert.equal(JSON.parse(second.stdout).drawing, 'existing')
  assert.deepEqual(await fingerprint(root), afterFirst)

  const doctor = run(root, ['doctor'])
  assert.equal(doctor.status, 0, doctor.stderr)
  const report = JSON.parse(doctor.stdout)
  assert.equal(report.ok, true)
  assert.equal(report.verification.writesPerformed, 0)
  assert.equal(report.verification.guiVerified, false)
  assert.equal(report.verification.realModelVerified, false)
  assert.ok(report.checks.filter(check => check.id === 'client-config' && check.client !== 'TraeCode').every(check => check.status === 'ok'))
  assert.equal(report.checks.find(check => check.client === 'TraeCode' && check.id === 'client-config').status, 'confirmation-required')
  assert.ok(report.checks.filter(check => check.id === 'client-skill' && check.client !== 'WorkBuddy').every(check => check.status === 'ok'))
  assert.deepEqual(await fingerprint(root), afterFirst)

  const config = join(root, '.zcode/cli/config.json')
  const value = JSON.parse(await readFile(config, 'utf8'))
  value.mcp.servers.kjdraw.args[value.mcp.servers.kjdraw.args.indexOf('--input') + 1] = '.kjdraw/other.kjd'
  await writeFile(config, `${JSON.stringify(value, null, 2)}\n`)
  const beforeMismatch = await fingerprint(root)
  const mismatch = run(root, ['doctor'])
  assert.equal(mismatch.status, 1, mismatch.stderr)
  const mismatchReport = JSON.parse(mismatch.stdout)
  assert.equal(mismatchReport.checks.find(check => check.client === 'ZCode' && check.id === 'client-config').status, 'mismatched-kjdraw-entry')
  assert.deepEqual(await fingerprint(root), beforeMismatch)
})

test('onboard and doctor reject unexpected arguments before user-home changes', async t => {
  const root = await fixture(t)
  for (const command of ['onboard', 'doctor']) {
    const response = run(root, [command, '--workspace', root])
    assert.equal(response.status, 1)
    assert.match(response.stderr, new RegExp(`${command} takes no arguments`))
    assert.deepEqual(await readdir(root), [])
  }
})
