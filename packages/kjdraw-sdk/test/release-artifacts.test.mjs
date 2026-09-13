import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const repositoryRoot = new URL('../../../', import.meta.url)
const repositoryPath = fileURLToPath(repositoryRoot)
const git = (args, encoding = null) => execFileSync('git', args, { cwd: repositoryPath, encoding, windowsHide: true, maxBuffer: 128 * 1024 * 1024 })
const sourceCommit = git(['rev-parse', 'HEAD'], 'utf8').trim()
const packageManifest = JSON.parse(git(['show', `${sourceCommit}:packages/kjdraw-sdk/package.json`], 'utf8'))
const tarballName = `${packageManifest.name.replace(/^@/, '').replace('/', '-')}-${packageManifest.version}.tgz`

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`
}

function tarEntry(name, content = '', type = '0', link = '') {
  const data = Buffer.from(content)
  const header = Buffer.alloc(512)
  let entryName = name
  let prefix = ''
  if (Buffer.byteLength(name) > 100) {
    const split = [...name.matchAll(/\//g)].map(match => match.index).reverse().find(index => Buffer.byteLength(name.slice(0, index)) <= 155 && Buffer.byteLength(name.slice(index + 1)) <= 100)
    assert.notEqual(split, undefined, `Tar path is too long: ${name}`)
    prefix = name.slice(0, split)
    entryName = name.slice(split + 1)
  }
  header.write(entryName, 0, 100, 'utf8')
  header.write(octal(type === '5' ? 0o755 : 0o644, 8), 100, 8, 'ascii')
  header.write(octal(0, 8), 108, 8, 'ascii')
  header.write(octal(0, 8), 116, 8, 'ascii')
  header.write(octal(data.length, 12), 124, 12, 'ascii')
  header.write(octal(0, 12), 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1, 'ascii')
  if (link) header.write(link, 157, 100, 'utf8')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  if (prefix) header.write(prefix, 345, 155, 'utf8')
  const checksum = header.reduce((total, value) => total + value, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)])
}

function isDeclaredPackageFile(relative) {
  return relative === 'package.json' || packageManifest.files.some(entry => relative === entry || relative.startsWith(`${entry}/`))
}

function readCommittedBlobs(paths) {
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: repositoryPath,
    input: `${paths.map(path => `${sourceCommit}:${path}`).join('\n')}\n`,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  })
  const blobs = new Map()
  let offset = 0
  for (const path of paths) {
    const lineEnd = output.indexOf(0x0a, offset)
    assert.ok(lineEnd > offset, `Missing Git blob header: ${path}`)
    const [, type, sizeText] = output.subarray(offset, lineEnd).toString('ascii').split(' ')
    const size = Number(sizeText)
    assert.equal(type, 'blob')
    offset = lineEnd + 1
    blobs.set(path, Buffer.from(output.subarray(offset, offset + size)))
    offset += size
    assert.equal(output[offset], 0x0a)
    offset++
  }
  assert.equal(offset, output.length)
  return blobs
}

async function packageTar(extra = []) {
  const prefix = 'packages/kjdraw-sdk/'
  const paths = git(['ls-tree', '-r', '--name-only', sourceCommit, '--', prefix], 'utf8').trimEnd().split('\n').filter(Boolean)
  const declaredPaths = paths
    .map(sourcePath => [sourcePath.slice(prefix.length), sourcePath])
    .filter(([relative]) => isDeclaredPackageFile(relative))
  const blobs = readCommittedBlobs(declaredPaths.map(([, sourcePath]) => sourcePath))
  const contents = new Map(declaredPaths.map(([relative, sourcePath]) => [`package/${relative}`, blobs.get(sourcePath)]))
  return gzipSync(Buffer.concat([
    ...[...contents].map(([name, content]) => tarEntry(name, content)),
    ...extra,
    Buffer.alloc(1024),
  ]), { mtime: 0 })
}

function run(script, args) {
  return spawnSync(process.execPath, [fileURLToPath(new URL(script, repositoryRoot)), ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
}

test('release artifact bundle is deterministic, source-bound and independently verifies packed paths', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-release-artifacts-'))
  t.after(async () => { await import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true, force: true })) })
  const tarball = join(directory, tarballName)
  await writeFile(tarball, await packageTar())

  const generate = () => run('scripts/release-artifacts.mjs', [tarball])
  const first = generate()
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
  const names = [`kjdraw-sdk-${packageManifest.version}.spdx.json`, `kjdraw-sdk-${packageManifest.version}.release.json`, 'SHA256SUMS']
  const firstMetadata = await Promise.all(names.map(name => readFile(join(directory, name))))
  const second = generate()
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
  const secondMetadata = await Promise.all(names.map(name => readFile(join(directory, name))))
  assert.deepEqual(secondMetadata, firstMetadata, 'release metadata must be reproducible for one source commit and tarball')

  const verified = run('scripts/audits/verify-release-artifacts.mjs', [directory])
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`)
  const report = JSON.parse(verified.stdout)
  assert.equal(report.ok, true)
  assert.equal(report.package, `${packageManifest.name}@${packageManifest.version}`)
  assert.equal(report.tarball, tarballName)
  assert.equal(report.checksumEntries, 3)
  assert.match(report.sourceCommit, /^[a-f0-9]{40}$/)

  await writeFile(tarball, Buffer.concat([await readFile(tarball), Buffer.from('tampered')]))
  const tampered = run('scripts/audits/verify-release-artifacts.mjs', [directory])
  assert.notEqual(tampered.status, 0)
  assert.match(tampered.stderr, /Checksum mismatch/)
})

test('release verifier rejects links even when bundle checksums were freshly generated', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-release-link-'))
  t.after(async () => { await import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true, force: true })) })
  const tarball = join(directory, tarballName)
  await writeFile(tarball, await packageTar([tarEntry('package/src/escape.js', '', '2', '../../outside')]))
  const generated = run('scripts/release-artifacts.mjs', [tarball])
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`)
  const rejected = run('scripts/audits/verify-release-artifacts.mjs', [directory])
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /links and special entries are forbidden/)
})

test('release workflow verifies the bundle before upload and attestation', async () => {
  const workflow = await readFile(new URL('.github/workflows/release.yml', repositoryRoot), 'utf8')
  const generate = workflow.indexOf('node scripts/release-artifacts.mjs')
  const verify = workflow.indexOf('node scripts/audits/verify-release-artifacts.mjs dist/release')
  const upload = workflow.indexOf('gh release upload')
  const attest = workflow.indexOf('uses: actions/attest@')
  assert.ok(generate >= 0 && verify > generate)
  assert.ok(upload > verify)
  assert.ok(attest > verify)
  assert.match(workflow, /subject-checksums: dist\/release\/SHA256SUMS/)
})
