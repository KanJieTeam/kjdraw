import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

// Version alignment is not an artifact-integrity or stable-release approval.
export function assessDistribution(packageInfo, registry) {
  if (!isRecord(packageInfo) || typeof packageInfo.name !== 'string' || typeof packageInfo.version !== 'string') {
    throw new Error('A package name and source version are required')
  }
  if (!isRecord(registry) || registry.name !== packageInfo.name || !isRecord(registry.versions) || !isRecord(registry['dist-tags'])) {
    throw new Error('Registry response does not describe the expected package')
  }
  const expectedTag = packageInfo.version.includes('-') ? 'next' : 'latest'
  const tags = registry['dist-tags']
  if (Object.values(tags).some(value => typeof value !== 'string')) throw new Error('Invalid registry distribution tags')
  const sourcePublished = Object.hasOwn(registry.versions, packageInfo.version)
  const sourceEntry = registry.versions[packageInfo.version]
  if (sourcePublished && (!isRecord(sourceEntry) || sourceEntry.version !== packageInfo.version || sourceEntry.name !== packageInfo.name)) {
    throw new Error('Registry version record does not match the requested package')
  }
  const channelVersion = tags[expectedTag] ?? null
  const findings = []
  if (!sourcePublished) findings.push({ code: 'SOURCE_VERSION_UNPUBLISHED', version: packageInfo.version })
  if (channelVersion !== packageInfo.version) findings.push({ code: 'CHANNEL_VERSION_MISMATCH', tag: expectedTag, actual: channelVersion, expected: packageInfo.version })
  return {
    schema: 'com.kanjie.kjdraw.distribution-status@1',
    package: packageInfo.name,
    sourceVersion: packageInfo.version,
    expectedTag,
    channelVersion,
    sourcePublished,
    versionAligned: findings.length === 0,
    findings,
    boundary: 'Checks public registry versions and tags only; does not verify package contents, provenance, deployment or stable readiness.',
  }
}

export async function fetchDistribution(packageInfo, fetchImpl = fetch) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageInfo.name)}`
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Public registry request failed (HTTP ${response.status})`)
  return assessDistribution(packageInfo, await response.json())
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.some(arg => arg !== '--require-current')) throw new Error('Usage: node scripts/audits/distribution-status.mjs [--require-current]')
    const pkg = JSON.parse(await readFile(new URL('../../packages/kjdraw-sdk/package.json', import.meta.url), 'utf8'))
    const report = await fetchDistribution(pkg)
    console.log(JSON.stringify({ ...report, checkedAt: new Date().toISOString() }, null, 2))
    if (args.includes('--require-current') && !report.versionAligned) process.exitCode = 1
  } catch (error) {
    // An unavailable/malformed response must never become "not published" or "passed".
    console.error(JSON.stringify({ status: 'unknown', error: error.message }))
    process.exitCode = 2
  }
}
