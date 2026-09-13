import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const packageRoot = resolve(repositoryRoot, 'packages/kjdraw-sdk')
const releaseDirectory = process.argv[2] ? resolve(process.argv[2]) : null
assert.ok(releaseDirectory && process.argv.length === 3, 'Usage: node scripts/audits/verify-release-artifacts.mjs <release-directory>')

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim()
const git = (args, encoding = null) => execFileSync('git', args, { cwd: repositoryRoot, encoding, windowsHide: true, maxBuffer: 128 * 1024 * 1024 })
const sdkPackage = JSON.parse(git(['show', `${checkoutCommit}:packages/kjdraw-sdk/package.json`], 'utf8'))

function parseOctal(field, label) {
  const text = field.toString('ascii').replaceAll('\0', '').trim()
  assert.match(text, /^[0-7]+$/, `Invalid tar ${label}`)
  const value = Number.parseInt(text, 8)
  assert.ok(Number.isSafeInteger(value) && value >= 0, `Invalid tar ${label}`)
  return value
}

function headerChecksum(header) {
  const copy = Buffer.from(header)
  copy.fill(0x20, 148, 156)
  return copy.reduce((total, value) => total + value, 0)
}

function parsePax(payload) {
  const values = {}
  let offset = 0
  while (offset < payload.length) {
    const separator = payload.indexOf(0x20, offset)
    assert.ok(separator > offset, 'Invalid PAX record length')
    const length = Number(payload.subarray(offset, separator).toString('ascii'))
    assert.ok(Number.isSafeInteger(length) && length > separator - offset + 2 && offset + length <= payload.length, 'Invalid PAX record')
    const record = payload.subarray(separator + 1, offset + length - 1).toString('utf8')
    const equals = record.indexOf('=')
    assert.ok(equals > 0, 'Invalid PAX record value')
    values[record.slice(0, equals)] = record.slice(equals + 1)
    offset += length
  }
  return values
}

function parseTarball(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 })
  const entries = new Map()
  let offset = 0, pendingPath = null, zeroBlocks = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    offset += 512
    if (header.every(value => value === 0)) {
      zeroBlocks++
      if (zeroBlocks === 2) break
      continue
    }
    assert.equal(zeroBlocks, 0, 'Nonzero tar header follows an end marker')
    const expectedChecksum = parseOctal(header.subarray(148, 156), 'header checksum')
    assert.equal(headerChecksum(header), expectedChecksum, 'Tar header checksum mismatch')
    const size = parseOctal(header.subarray(124, 136), 'entry size')
    assert.ok(offset + size <= tar.length, 'Truncated tar entry')
    const payload = tar.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512
    const type = String.fromCharCode(header[156] || 0)
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '')
    const headerName = prefix ? `${prefix}/${rawName}` : rawName
    if (type === 'x' || type === 'g') {
      const pax = parsePax(payload)
      if (type === 'x' && pax.path) pendingPath = pax.path
      continue
    }
    if (type === 'L') {
      pendingPath = payload.toString('utf8').replace(/\0.*$/s, '')
      continue
    }
    const name = pendingPath ?? headerName
    pendingPath = null
    assert.ok(name && !name.includes('\\'), `Invalid tar path: ${name}`)
    const normalized = posix.normalize(name)
    assert.equal(normalized, name.replace(/^\.\//, ''), `Non-canonical tar path: ${name}`)
    assert.ok(normalized.startsWith('package/') && !normalized.includes('/../') && !posix.isAbsolute(normalized), `Tar path escapes package root: ${name}`)
    assert.ok(type === '0' || type === '\0' || type === '5', `Tar links and special entries are forbidden: ${name} (${JSON.stringify(type)})`)
    if (type === '5') continue
    assert.equal(entries.has(normalized), false, `Duplicate tar entry: ${normalized}`)
    entries.set(normalized, Buffer.from(payload))
  }
  assert.ok(zeroBlocks >= 2, 'Tar archive has no complete end marker')
  return entries
}

function exportTargets(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(exportTargets)
}

function isDeclaredPackageFile(relative) {
  return relative === 'package.json' || sdkPackage.files.some(entry => relative === entry || relative.startsWith(`${entry}/`))
}

function readCommittedBlobs(paths) {
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: repositoryRoot,
    input: `${paths.map(path => `${checkoutCommit}:${path}`).join('\n')}\n`,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  })
  const blobs = new Map()
  let offset = 0
  for (const path of paths) {
    const lineEnd = output.indexOf(0x0a, offset)
    assert.ok(lineEnd > offset, `Missing Git blob header: ${path}`)
    const [object, type, sizeText] = output.subarray(offset, lineEnd).toString('ascii').split(' ')
    const size = Number(sizeText)
    assert.match(object, /^[a-f0-9]{40,64}$/)
    assert.equal(type, 'blob', `Git object is not a file: ${path}`)
    assert.ok(Number.isSafeInteger(size) && size >= 0 && lineEnd + 1 + size < output.length, `Invalid Git blob size: ${path}`)
    offset = lineEnd + 1
    blobs.set(path, Buffer.from(output.subarray(offset, offset + size)))
    offset += size
    assert.equal(output[offset], 0x0a, `Missing Git blob separator: ${path}`)
    offset++
  }
  assert.equal(offset, output.length, 'Unexpected trailing Git blob data')
  return blobs
}

const files = (await readdir(releaseDirectory, { withFileTypes: true }))
assert.equal(files.every(entry => entry.isFile()), true, 'Release directory may only contain regular files')
const names = files.map(entry => entry.name).sort()
const checksumName = 'SHA256SUMS'
assert.ok(names.includes(checksumName), 'Missing SHA256SUMS')
const checksumText = await readFile(resolve(releaseDirectory, checksumName), 'utf8')
assert.ok(checksumText.endsWith('\n') && !checksumText.includes('\r'), 'SHA256SUMS must be LF-terminated')
const checksums = new Map()
for (const line of checksumText.trimEnd().split('\n')) {
  const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9@._+-]+)$/)
  assert.ok(match, `Invalid SHA256SUMS line: ${line}`)
  assert.equal(checksums.has(match[2]), false, `Duplicate checksum entry: ${match[2]}`)
  checksums.set(match[2], match[1])
}
assert.deepEqual([...checksums.keys()].sort(), names.filter(name => name !== checksumName), 'SHA256SUMS must cover every release file exactly once')
for (const [name, digest] of checksums) assert.equal(sha256(await readFile(resolve(releaseDirectory, name))), digest, `Checksum mismatch: ${name}`)

const manifestName = `kjdraw-sdk-${sdkPackage.version}.release.json`
const sbomName = `kjdraw-sdk-${sdkPackage.version}.spdx.json`
const manifest = JSON.parse(await readFile(resolve(releaseDirectory, manifestName), 'utf8'))
assert.equal(manifest.schema, 'com.kanjie.kjdraw.release-artifacts@1')
assert.deepEqual(manifest.package, { name: sdkPackage.name, version: sdkPackage.version, license: 'Apache-2.0' })
assert.equal(manifest.source.repository, sdkPackage.repository.url)
assert.equal(manifest.source.commit, checkoutCommit, 'Release manifest source commit differs from checkout')
assert.match(manifest.source.committedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
assert.match(manifest.provenanceBoundary, /GitHub artifact attestation and npm provenance must still be verified/)
assert.deepEqual(manifest.sbom, { name: sbomName, sha256: checksums.get(sbomName), format: 'SPDX-2.3' })

const tarballs = names.filter(name => name.endsWith('.tgz'))
assert.equal(tarballs.length, 1, 'Release bundle must contain exactly one npm tarball')
const tarballName = tarballs[0]
const expectedTarballName = `${sdkPackage.name.replace(/^@/, '').replace('/', '-')}-${sdkPackage.version}.tgz`
assert.equal(tarballName, expectedTarballName, 'Unexpected npm tarball filename')
assert.deepEqual(manifest.artifacts, [{ name: tarballName, sha256: checksums.get(tarballName) }])

const tarEntries = parseTarball(await readFile(resolve(releaseDirectory, tarballName)))
for (const required of ['package/package.json', 'package/LICENSE', 'package/NOTICE', 'package/README.md']) assert.ok(tarEntries.has(required), `Packed SDK is missing ${required}`)
const sourcePrefix = 'packages/kjdraw-sdk/'
const committedPaths = git(['ls-tree', '-r', '--name-only', checkoutCommit, '--', sourcePrefix], 'utf8').trimEnd().split('\n').filter(Boolean)
const declaredPaths = committedPaths
  .map(sourcePath => [sourcePath.slice(sourcePrefix.length), sourcePath])
  .filter(([relative]) => isDeclaredPackageFile(relative))
const committedBlobs = readCommittedBlobs(declaredPaths.map(([, sourcePath]) => sourcePath))
const expectedEntries = new Map(declaredPaths.map(([relative, sourcePath]) => [`package/${relative}`, committedBlobs.get(sourcePath)]))
assert.deepEqual([...tarEntries.keys()].sort(), [...expectedEntries.keys()].sort(), 'Packed SDK file set differs from the package files in the release checkout')
const packedPackage = JSON.parse(tarEntries.get('package/package.json').toString('utf8'))
for (const field of ['name', 'version', 'license', 'repository', 'engines', 'exports', 'bin']) assert.deepEqual(packedPackage[field], sdkPackage[field], `Packed package field differs: ${field}`)
assert.deepEqual(packedPackage.dependencies ?? {}, {}, 'Published SDK must have zero runtime dependencies')
for (const target of [...exportTargets(packedPackage.exports), ...Object.values(packedPackage.bin ?? {})]) {
  const path = `package/${String(target).replace(/^\.\//, '')}`
  assert.ok(tarEntries.has(path), `Packed entry target is missing: ${target}`)
}
for (const [name, bytes] of tarEntries) {
  const relative = name.slice('package/'.length)
  const sourcePath = resolve(packageRoot, ...relative.split('/'))
  assert.ok(sourcePath.startsWith(`${packageRoot}/`) || sourcePath.startsWith(`${packageRoot}\\`), `Packed path escapes SDK source: ${name}`)
  const sourceBytes = expectedEntries.get(name)
  assert.ok(sourceBytes, `Packed path is outside the declared package files in ${checkoutCommit}: ${name}`)
  if (relative === 'package.json') {
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), JSON.parse(sourceBytes.toString('utf8')), 'Packed package.json differs from the release checkout')
  } else {
    assert.equal(bytes.equals(sourceBytes), true, `Packed bytes differ from source commit ${checkoutCommit}: ${relative}`)
  }
}

const sbom = JSON.parse(await readFile(resolve(releaseDirectory, sbomName), 'utf8'))
assert.equal(sbom.spdxVersion, 'SPDX-2.3')
assert.equal(sbom.dataLicense, 'CC0-1.0')
assert.equal(sbom.creationInfo.created, manifest.source.committedAt)
assert.deepEqual(sbom.packages?.map(item => ({ name: item.name, version: item.versionInfo, license: item.licenseDeclared })), [{ name: sdkPackage.name, version: sdkPackage.version, license: 'Apache-2.0' }])
assert.deepEqual(sbom.packages[0].checksums, [{ algorithm: 'SHA256', checksumValue: checksums.get(tarballName) }])
assert.ok(sbom.documentNamespace.endsWith(`/${checksums.get(tarballName)}`))

console.log(JSON.stringify({
  ok: true,
  package: `${sdkPackage.name}@${sdkPackage.version}`,
  sourceCommit: checkoutCommit,
  tarball: tarballName,
  packedFiles: tarEntries.size,
  checksumEntries: checksums.size,
  sbom: sbomName,
  manifest: manifestName,
  boundary: 'Local release bytes are structurally checked and bound to the checkout. Hosted attestation and npm provenance remain candidate-run evidence.',
}, null, 2))
