import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { CANDIDATE_VERSION, validatePackedTarball, validatePublishedCandidate } from '../../../scripts/install-kjdraw.mjs'

const core = fileURLToPath(new URL('../../../scripts/install-kjdraw.mjs', import.meta.url))
const powershell = fileURLToPath(new URL('../../../scripts/install-kjdraw.ps1', import.meta.url))
const shell = fileURLToPath(new URL('../../../scripts/install-kjdraw.sh', import.meta.url))
const sha = 'a'.repeat(40)
const integrity = `sha512-${'A'.repeat(86)}==`
const flags = project => ['--project', project, '--blank', '.kjdraw/active.kjd', '--candidate-sha', sha, '--integrity', integrity, '--dry-run']

async function projectFixture(t) {
  const project = await mkdtemp(join(tmpdir(), 'kjdraw-bootstrap-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  return project
}

test('release lock validates exact prerelease version, next tag, public source commit and tarball integrity', () => {
  assert.equal(CANDIDATE_VERSION, '1.0.0-rc.3')
  const metadata = { next: CANDIDATE_VERSION, version: CANDIDATE_VERSION, gitHead: sha, integrity }
  assert.equal(validatePublishedCandidate(metadata, { candidateSha: sha, integrity }), true)
  for (const mismatch of [
    { next: '1.0.0-rc.2' }, { version: '1.0.0-rc.2' },
    { gitHead: 'b'.repeat(40) }, { integrity: `sha512-${'B'.repeat(86)}==` },
  ]) assert.throws(() => validatePublishedCandidate({ ...metadata, ...mismatch }, { candidateSha: sha, integrity }), /no package installed/)
  assert.throws(() => validatePublishedCandidate(metadata, { candidateSha: 'short', integrity }), /release evidence/)
  const tarball = Buffer.from('synthetic candidate fixture, not a published KJDraw package')
  const actualIntegrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  assert.equal(validatePackedTarball(tarball, actualIntegrity), true)
  assert.throws(() => validatePackedTarball(Buffer.concat([tarball, Buffer.from('changed')]), actualIntegrity), /locked release integrity/)
})

test('Windows PowerShell local dry-run either proves the exact candidate or fails closed without project writes', async t => {
  if (process.platform !== 'win32') return t.skip('Windows-only PowerShell bootstrap')
  const project = await projectFixture(t)
  const pwsh = process.env.KJDRAW_PWSH_TEST_BIN ?? 'pwsh'
  const response = spawnSync(pwsh, ['-NoProfile', '-File', powershell, '-Project', project, '-Blank', '.kjdraw/active.kjd', '-CandidateSha', sha, '-Integrity', integrity, '-DryRun'], {
    encoding: 'utf8', timeout: 15000,
  })
  if (response.error?.code === 'ENOENT') return t.skip('PowerShell executable unavailable')
  // Currently rc.3 is ahead of npm next rc.2; once rc.3 is published, this
  // test should still accept a genuine locked zero-write dry-run receipt.
  assert.ok([0, 1].includes(response.status))
  if (response.status === 0) {
    const receipt = JSON.parse(response.stdout)
    assert.equal(receipt.version, CANDIDATE_VERSION)
    assert.equal(receipt.dryRun, true)
    assert.equal(receipt.writesPerformed, 0)
  } else {
    assert.match(response.stderr, /KJDraw installer:/)
    assert.equal(response.stderr.includes(project), false)
  }
  assert.deepEqual(await readdir(project), [])
  const url = spawnSync(process.execPath, [core, ...flags('https://example.invalid/install.sh')], { encoding: 'utf8' })
  assert.equal(url.status, 1)
  assert.match(url.stderr, /explicit absolute local directory, not a URL/)
})

test('shell bootstrap is local-file only and gets an actual sh syntax check on Unix CI', async () => {
  const text = await readFile(shell, 'utf8')
  assert.match(text, /^#!\/bin\/sh\n/u)
  assert.match(text, /not a piped URL/u)
  assert.equal(/curl\s|wget\s|eval\s|npx\s|(?:^|\n)\s*PATH=/u.test(text), false)
  if (process.platform !== 'win32') {
    const syntax = spawnSync('sh', ['-n', shell], { encoding: 'utf8' })
    assert.equal(syntax.status, 0, syntax.stderr)
  }
  const ps = await readFile(powershell, 'utf8')
  assert.equal(/Invoke-WebRequest|Invoke-RestMethod|iwr\s|irm\s|SetEnvironmentVariable|npx\s/u.test(ps), false)
  assert.match(ps, /install-kjdraw\.mjs/u)
})

test('bootstrap validates an optional project geology pack before registry access or installation writes', async t => {
  const project = await projectFixture(t)
  const pack = Buffer.from('{"schema":"fixture-only"}\n')
  await writeFile(join(project, 'geology.json'), pack)
  const mismatch = spawnSync(process.execPath, [core, ...flags(project), '--geology-column-pack', 'geology.json', '--geology-column-pack-sha256', '0'.repeat(64)], { encoding: 'utf8' })
  assert.equal(mismatch.status, 1)
  assert.match(mismatch.stderr, /do not match the host-supplied SHA-256/u)
  assert.deepEqual(await readdir(project), ['geology.json'])
  const incomplete = spawnSync(process.execPath, [core, ...flags(project), '--geology-column-pack', 'geology.json'], { encoding: 'utf8' })
  assert.equal(incomplete.status, 1)
  assert.match(incomplete.stderr, /path and SHA-256 must be supplied together/u)
  assert.deepEqual(await readdir(project), ['geology.json'])
})
