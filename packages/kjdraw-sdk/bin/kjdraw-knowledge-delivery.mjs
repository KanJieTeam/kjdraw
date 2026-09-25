import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { validateKnowledgePack } from '../src/knowledge-pack.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../src/knowledge-packs/geology-core.js'

export const GEOLOGY_MANIFEST_URL = 'https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/knowledge/geology/manifest.json'
const ORIGIN = 'https://raw.githubusercontent.com'
const ROOT = '/KanJieTeam/kjdraw/main/knowledge/geology/'
const MAX_MANIFEST = 16 * 1024
const MAX_PACK = 1024 * 1024
const TIMEOUT_MS = 2500
const HEX = /^[a-f0-9]{64}$/u
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const ROLES = { column: 'geology-column-layout', section: 'geology-section-layout' }

function officialUrl(raw) {
  const url = new URL(raw)
  if (url.origin !== ORIGIN || !url.pathname.startsWith(ROOT) || url.pathname.includes('..') ||
      !url.pathname.endsWith('.json') || url.search || url.hash || url.username || url.password) throw new Error('Knowledge URL must be an official HTTPS JSON resource')
  return url.href
}

function parseManifest(bytes, manifestUrl) {
  if (bytes.byteLength > MAX_MANIFEST) throw new Error('Knowledge manifest exceeds size limit')
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (manifest?.schema !== 'kjdraw.knowledge-delivery.v1' || !manifest.packs ||
      Object.keys(manifest.packs).length !== 2 || Object.keys(manifest.packs).some(key => !Object.hasOwn(ROLES, key))) throw new Error('Invalid knowledge manifest')
  const packs = {}
  for (const [role, row] of Object.entries(manifest.packs)) {
    if (typeof row?.id !== 'string' || !STABLE_VERSION.test(row?.version ?? '') || !HEX.test(row?.sha256 ?? '')) throw new Error('Invalid knowledge pack descriptor')
    if (compareVersion(row.version, KJDRAW_GEOLOGY_KNOWLEDGE_PACK.version) < 0) throw new Error('Knowledge manifest is older than bundled geology knowledge')
    const url = officialUrl(row.url)
    if (new URL(url).origin !== new URL(manifestUrl).origin) throw new Error('Knowledge pack origin differs from manifest')
    packs[role] = { id: row.id, version: row.version, sha256: row.sha256, url }
  }
  return packs
}

async function boundedFetch(url, limit, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual', cache: 'no-store' })
  if (!response.ok || response.status !== 200 || response.redirected) throw new Error('Knowledge download failed')
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Knowledge download exceeds size limit')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Knowledge download has no body')
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('Knowledge download exceeds size limit')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks, size)
}

function compareVersion(left, right) {
  if (!STABLE_VERSION.test(left) || !STABLE_VERSION.test(right)) throw new Error('Knowledge version is invalid')
  const a = left.split('.').map(BigInt)
  const b = right.split('.').map(BigInt)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  return 0
}

function decodePack(bytes, descriptor, role) {
  if (bytes.byteLength > MAX_PACK || createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) throw new Error('Knowledge SHA-256 mismatch')
  const pack = validateKnowledgePack(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (pack.id !== descriptor.id || pack.version !== descriptor.version || pack.domain !== 'geology' ||
      !pack.license.redistributable || !pack.rules?.[ROLES[role]]) throw new Error('Knowledge pack identity or geology rule mismatch')
  return { pack, sha256: descriptor.sha256, url: descriptor.url, byteLength: bytes.byteLength }
}

async function assertSafeCachePath(path) {
  let current = resolve(path)
  while (true) {
    try {
      const entry = await lstat(current)
      // macOS exposes /var and /tmp through fixed, system-owned links to /private.
      // Other links (including user-controlled parents and the cache root) are unsafe.
      const macSystemLink = process.platform === 'darwin' && current !== resolve(path) &&
        ((current === '/var' && await realpath(current) === '/private/var') ||
         (current === '/tmp' && await realpath(current) === '/private/tmp'))
      if ((!entry.isDirectory() && !macSystemLink) || (entry.isSymbolicLink() && !macSystemLink))
        throw new Error('Knowledge cache path is unsafe')
    } catch (error) { if (error?.code !== 'ENOENT') throw error }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

async function safeCacheFile(path, max) {
  try {
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > max) return null
    return await readFile(path)
  } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

async function atomicFile(path, bytes) {
  const stage = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  await writeFile(stage, bytes, { flag: 'wx', mode: 0o600 })
  await rename(stage, path)
}

/** Host-only, data-only updater. No drawing bytes or model input enter the network request. */
export async function loadGeologyKnowledge({ cacheRoot, fetcher = fetch, manifestUrl = GEOLOGY_MANIFEST_URL,
  enabled = process.env.KJDRAW_KNOWLEDGE_UPDATES === 'on' } = {}) {
  if (!enabled) return { source: 'disabled', packs: {}, notice: 'Knowledge updates disabled by KJDRAW_KNOWLEDGE_UPDATES=off' }
  officialUrl(manifestUrl)
  if (!cacheRoot) throw new Error('Knowledge cache root is required')
  try { await assertSafeCachePath(cacheRoot) }
  catch { return { source: 'bundled', packs: {}, notice: 'Knowledge cache path is unsafe; using bundled defaults' } }
  const cachedManifestPath = join(cacheRoot, 'manifest.json')
  let cached = {}
  try {
    const manifestBytes = await safeCacheFile(cachedManifestPath, MAX_MANIFEST)
    if (manifestBytes) {
      const descriptors = parseManifest(manifestBytes, manifestUrl)
      for (const [role, descriptor] of Object.entries(descriptors)) {
        const bytes = await safeCacheFile(join(cacheRoot, `${role}-${descriptor.sha256}.json`), MAX_PACK)
        if (bytes) cached[role] = decodePack(bytes, descriptor, role)
      }
      if (Object.keys(cached).length !== Object.keys(ROLES).length) cached = {}
    }
  } catch { cached = {} }
  try {
    const manifestBytes = await boundedFetch(manifestUrl, MAX_MANIFEST, fetcher)
    const descriptors = parseManifest(manifestBytes, manifestUrl)
    const fresh = {}
    const downloads = new Map()
    for (const [role, descriptor] of Object.entries(descriptors)) {
      if (!downloads.has(descriptor.url)) downloads.set(descriptor.url, await boundedFetch(descriptor.url, MAX_PACK, fetcher))
      const bytes = downloads.get(descriptor.url)
      fresh[role] = { ...decodePack(bytes, descriptor, role), bytes }
      if (cached[role] && (compareVersion(descriptor.version, cached[role].pack.version) < 0 ||
          (descriptor.version === cached[role].pack.version && descriptor.sha256 !== cached[role].sha256)))
        throw new Error('Knowledge manifest would downgrade or silently rewrite a published version')
    }
    await assertSafeCachePath(cacheRoot)
    await mkdir(cacheRoot, { recursive: true })
    const cacheInfo = await lstat(cacheRoot)
    if (!cacheInfo.isDirectory() || cacheInfo.isSymbolicLink()) throw new Error('Knowledge cache is unsafe')
    for (const [role, item] of Object.entries(fresh)) await atomicFile(join(cacheRoot, `${role}-${item.sha256}.json`), item.bytes)
    await atomicFile(cachedManifestPath, manifestBytes)
    return { source: 'remote', packs: Object.fromEntries(Object.entries(fresh).map(([role, { bytes, ...item }]) => [role, item])) }
  } catch (error) {
    return { source: Object.keys(cached).length ? 'cache' : 'bundled', packs: cached,
      notice: `Knowledge update unavailable; using ${Object.keys(cached).length ? 'verified cache' : 'bundled defaults'} (${error instanceof Error ? error.message : 'unknown error'})` }
  }
}
