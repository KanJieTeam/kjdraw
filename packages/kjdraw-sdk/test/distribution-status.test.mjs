import assert from 'node:assert/strict'
import test from 'node:test'
import { assessDistribution, fetchDistribution } from '../../../scripts/audits/distribution-status.mjs'

const pkg = { name: '@kanjieteam/kjdraw', version: '1.0.0-rc.3' }
const registry = (tags = { next: pkg.version }, versions = { [pkg.version]: pkg }) => ({ name: pkg.name, 'dist-tags': tags, versions })

test('distribution distinguishes source candidate from an older npm channel', () => {
  const report = assessDistribution(pkg, registry({ latest: '0.7.1-preview.1', next: '1.0.0-rc.2' }, {}))
  assert.equal(report.versionAligned, false)
  assert.equal(report.sourcePublished, false)
  assert.equal(report.expectedTag, 'next')
  assert.equal(report.channelVersion, '1.0.0-rc.2')
  assert.deepEqual(report.findings.map(row => row.code), ['SOURCE_VERSION_UNPUBLISHED', 'CHANNEL_VERSION_MISMATCH'])
})

test('an existing candidate must also be the intended channel target', () => {
  const report = assessDistribution(pkg, registry({ next: '1.0.0-rc.2' }))
  assert.equal(report.sourcePublished, true)
  assert.equal(report.versionAligned, false)
  assert.deepEqual(report.findings.map(row => row.code), ['CHANNEL_VERSION_MISMATCH'])
})

test('candidate and stable channels are checked separately without moving tags', () => {
  const before = registry({ next: pkg.version, latest: '0.7.1-preview.1' })
  const snapshot = structuredClone(before)
  assert.equal(assessDistribution(pkg, before).versionAligned, true)
  assert.deepEqual(before, snapshot)
  const stable = { ...pkg, version: '1.0.0' }
  assert.equal(assessDistribution(stable, registry({ latest: stable.version }, { [stable.version]: stable })).expectedTag, 'latest')
  assert.equal(assessDistribution(stable, registry({ latest: stable.version }, { [stable.version]: stable })).versionAligned, true)
})

test('missing tag or nonexistent tag target never passes distribution alignment', () => {
  assert.equal(assessDistribution(pkg, registry({})).channelVersion, null)
  assert.equal(assessDistribution(pkg, registry({ next: pkg.version }, {})).versionAligned, false)
})

test('malformed or unrelated registry records fail instead of inventing publication state', () => {
  for (const value of [null, [], {}, { ...registry(), name: 'other' }, registry({ next: 3 }), registry(undefined, { [pkg.version]: null }), registry(undefined, { [pkg.version]: 0 }), registry(undefined, { [pkg.version]: { ...pkg, version: 'bad' } })]) {
    assert.throws(() => assessDistribution(pkg, value))
  }
})

test('public registry inspection uses no credentials and propagates outages as unknown', async () => {
  const result = await fetchDistribution(pkg, async (url, options) => {
    assert.equal(url, 'https://registry.npmjs.org/%40kanjieteam%2Fkjdraw')
    assert.deepEqual(options.headers, { Accept: 'application/json' })
    assert.ok(options.signal instanceof AbortSignal)
    return { ok: true, json: async () => registry() }
  })
  assert.equal(result.versionAligned, true)
  await assert.rejects(fetchDistribution(pkg, async () => ({ ok: false, status: 503 })), /HTTP 503/)
  await assert.rejects(fetchDistribution(pkg, async () => { throw new Error('offline') }), /offline/)
})
