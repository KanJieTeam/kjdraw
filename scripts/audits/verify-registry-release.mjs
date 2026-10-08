import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)

/** Compare registry metadata and downloaded bytes with the already attested
 * release bundle. This does not manufacture CI, user or provenance evidence. */
export function verifyRegistryRelease({ manifest, tarballName, expectedBytes, metadata, distTags, downloadedBytes }) {
  assert.equal(manifest.schema, 'com.kanjie.kjdraw.release-artifacts@1')
  assert.equal(manifest.package.name, '@kanjieteam/kjdraw')
  assert.match(manifest.source.commit, /^[a-f0-9]{40}$/)
  assert.equal(manifest.artifacts.length, 1)
  assert.equal(manifest.artifacts[0].name, tarballName)
  const expectedSha = digest(expectedBytes)
  assert.equal(manifest.artifacts[0].sha256, expectedSha, 'Release bytes differ from the source-bound manifest')
  assert.equal(metadata.name, manifest.package.name)
  assert.equal(metadata.version, manifest.package.version)
  if (metadata.gitHead !== undefined) assert.equal(metadata.gitHead, manifest.source.commit, 'Registry gitHead names another commit')
  const tag = manifest.package.version.includes('-') ? 'next' : 'latest'
  assert.equal(distTags[tag], manifest.package.version, 'Registry distribution tag points elsewhere')
  assert.equal(metadata.dist.integrity, 'sha512-' + digest(expectedBytes, 'sha512', 'base64'), 'Registry integrity differs from GitHub release bytes')
  assert.equal(metadata.dist.shasum, digest(expectedBytes, 'sha1'), 'Registry checksum differs from GitHub release bytes')
  assert.ok(metadata.dist.attestations?.provenance?.predicateType, 'Registry provenance is missing')
  assert.equal(digest(downloadedBytes), expectedSha, 'Downloaded registry tarball differs from the attested release')
  assert.equal(downloadedBytes.length, expectedBytes.length)
  return { ok: true, package: metadata.name, version: metadata.version, tag, sourceCommit: manifest.source.commit,
    sha256: expectedSha, provenancePredicate: metadata.dist.attestations.provenance.predicateType }
}

async function fetchBytes(url, maximum) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' } })
  assert.ok(response.ok, 'Registry request failed with HTTP ' + response.status)
  const reader = response.body.getReader(), chunks = []; let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      assert.ok(length <= maximum, 'Registry response exceeds its byte budget')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks)
}

export async function verifyLiveRegistryRelease(directory) {
  const pkg = JSON.parse(await readFile(resolve(root, 'packages/kjdraw-sdk/package.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(resolve(directory, `kjdraw-sdk-${pkg.version}.release.json`), 'utf8'))
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  assert.equal(manifest.source.commit, head, 'Release manifest does not name this checkout')
  assert.equal(manifest.package.version, pkg.version)
  assert.equal(manifest.package.name, pkg.name)
  const tarballName = `kanjieteam-kjdraw-${pkg.version}.tgz`
  const expectedBytes = await readFile(resolve(directory, tarballName))
  assert.ok(expectedBytes.length <= 64 * 1024 * 1024, 'Release tarball exceeds its byte budget')
  const base = 'https://registry.npmjs.org/@kanjieteam%2Fkjdraw'
  const metadata = JSON.parse(await fetchBytes(`${base}/${encodeURIComponent(pkg.version)}`, 512 * 1024))
  const registry = JSON.parse(await fetchBytes(base, 4 * 1024 * 1024))
  const url = new URL(metadata.dist.tarball)
  assert.ok(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' && !url.username && !url.password && !url.search && !url.hash
    && decodeURIComponent(url.pathname).startsWith('/@kanjieteam/kjdraw/-/'), 'Registry tarball URL is outside the fixed package source')
  const downloadedBytes = await fetchBytes(url.href, expectedBytes.length)
  return verifyRegistryRelease({ manifest, tarballName, expectedBytes, metadata, distTags: registry['dist-tags'], downloadedBytes })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/audits/verify-registry-release.mjs <verified-release-directory>')
  console.log(JSON.stringify(await verifyLiveRegistryRelease(resolve(process.argv[2])), null, 2))
}
