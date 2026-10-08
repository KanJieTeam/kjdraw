import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { verifyRegistryRelease } from '../scripts/audits/verify-registry-release.mjs'

function fixture(version = '1.0.0') {
  const expectedBytes = Buffer.from('Synthetic release bytes, not an npm publication')
  const digest = (algorithm, encoding = 'hex') => createHash(algorithm).update(expectedBytes).digest(encoding)
  const tarballName = `kanjieteam-kjdraw-${version}.tgz`
  const manifest = { schema: 'com.kanjie.kjdraw.release-artifacts@1', package: { name: '@kanjieteam/kjdraw', version },
    source: { commit: 'a'.repeat(40) }, artifacts: [{ name: tarballName, sha256: digest('sha256') }] }
  const metadata = { name: manifest.package.name, version, gitHead: manifest.source.commit,
    dist: { integrity: 'sha512-' + digest('sha512', 'base64'), shasum: digest('sha1'),
      attestations: { provenance: { predicateType: 'https://slsa.dev/provenance/v1' } } } }
  return { manifest, tarballName, expectedBytes, metadata, distTags: { [version.includes('-') ? 'next' : 'latest']: version }, downloadedBytes: Buffer.from(expectedBytes) }
}

test('stable and RC registry verification uses identical release bytes and the correct channel', () => {
  for (const version of ['1.0.0', '1.0.1-rc.1']) {
    const result = verifyRegistryRelease(fixture(version))
    assert.equal(result.ok, true)
    assert.equal(result.tag, version.includes('-') ? 'next' : 'latest')
    assert.equal(result.sourceCommit, 'a'.repeat(40))
  }
})

for (const [name, mutate] of [
  ['wrong manifest hash', value => value.manifest.artifacts[0].sha256 = 'b'.repeat(64)],
  ['wrong commit', value => value.metadata.gitHead = 'b'.repeat(40)],
  ['wrong version', value => value.metadata.version = '0.7.1-preview.1'],
  ['wrong tag', value => value.distTags.latest = '0.7.1-preview.1'],
  ['wrong registry integrity', value => value.metadata.dist.integrity = 'sha512-wrong'],
  ['wrong registry checksum', value => value.metadata.dist.shasum = 'b'.repeat(40)],
  ['missing provenance', value => delete value.metadata.dist.attestations],
  ['different downloaded bytes', value => value.downloadedBytes = Buffer.from('Other bytes')],
  ['different release package', value => value.manifest.package.name = '@other/package'],
]) test('registry alignment rejects ' + name, () => {
  const value = fixture(); mutate(value)
  assert.throws(() => verifyRegistryRelease(value))
})
