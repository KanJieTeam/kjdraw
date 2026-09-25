import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { GEOLOGY_MANIFEST_URL, loadGeologyKnowledge } from '../bin/kjdraw-knowledge-delivery.mjs'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../src/knowledge-packs/geology-core.js'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const packUrl = 'https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/knowledge/geology/test-pack.json'
const packBytes = Buffer.from(JSON.stringify(KJDRAW_GEOLOGY_KNOWLEDGE_PACK))
const row = { id: 'geology.core', version: '1.0.0', sha256: hash(packBytes), url: packUrl }
const manifest = Buffer.from(JSON.stringify({ schema: 'kjdraw.knowledge-delivery.v1', packs: { column: row, section: row } }))

test('published geology manifest binds the public data bytes and supported rule identities', async () => {
  const directory = fileURLToPath(new URL('../../../knowledge/geology/', import.meta.url))
  const publishedManifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  assert.equal(publishedManifest.schema, 'kjdraw.knowledge-delivery.v1')
  for (const role of ['column', 'section']) {
    const descriptor = publishedManifest.packs[role]
    const publishedBytes = await readFile(join(directory, `geology-core-${descriptor.version}.json`))
    assert.equal(hash(publishedBytes), descriptor.sha256)
    assert.equal(JSON.parse(publishedBytes).id, descriptor.id)
    assert.ok(JSON.parse(publishedBytes).rules[`geology-${role}-layout`])
    assert.equal(descriptor.url, `https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/knowledge/geology/geology-core-${descriptor.version}.json`)
  }
})

function reply(bytes, status = 200) { return new Response(bytes, { status, headers: { 'content-length': String(bytes.byteLength) } }) }
function served({ manifestBytes = manifest, knowledgeBytes = packBytes } = {}) {
  const calls = []
  return { calls, fetcher: async (url, options) => {
    calls.push({ url, options })
    return reply(url === GEOLOGY_MANIFEST_URL ? manifestBytes : knowledgeBytes)
  } }
}

test('installed-client knowledge updater verifies official manifest, exact pack bytes and both geology roles', async t => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'kjdraw-knowledge-delivery-'))
  t.after(() => rm(cacheRoot, { recursive: true, force: true }))
  const network = served()
  const loaded = await loadGeologyKnowledge({ cacheRoot, enabled: true, fetcher: network.fetcher })
  assert.equal(loaded.source, 'remote')
  assert.deepEqual(Object.keys(loaded.packs), ['column', 'section'])
  assert.equal(loaded.packs.column.pack.version, '1.0.0')
  assert.equal(loaded.packs.section.sha256, row.sha256)
  assert.deepEqual(network.calls.map(call => call.url), [GEOLOGY_MANIFEST_URL, packUrl])
  assert.ok(network.calls.every(call => call.options.redirect === 'manual' && call.options.cache === 'no-store'))
  assert.deepEqual(await readFile(join(cacheRoot, 'manifest.json')), manifest)

  const offline = await loadGeologyKnowledge({ cacheRoot, enabled: true, fetcher: async () => { throw new Error('offline') } })
  assert.equal(offline.source, 'cache')
  assert.equal(offline.packs.column.sha256, row.sha256)
  assert.match(offline.notice, /verified cache/u)
})

test('tampered, oversized, redirected and non-official knowledge never replaces verified cache', async t => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'kjdraw-knowledge-reject-'))
  t.after(() => rm(cacheRoot, { recursive: true, force: true }))
  await loadGeologyKnowledge({ cacheRoot, enabled: true, fetcher: served().fetcher })
  const changedBytes = Buffer.from(JSON.stringify({ ...KJDRAW_GEOLOGY_KNOWLEDGE_PACK, title: 'Silent rewrite' }))
  const changedManifest = Buffer.from(JSON.stringify({ schema: 'kjdraw.knowledge-delivery.v1', packs: {
    column: { ...row, sha256: hash(changedBytes) }, section: { ...row, sha256: hash(changedBytes) } } }))
  for (const network of [
    served({ manifestBytes: changedManifest, knowledgeBytes: changedBytes }),
    served({ knowledgeBytes: Buffer.from('{}') }),
    served({ manifestBytes: Buffer.from(JSON.stringify({ schema: 'kjdraw.knowledge-delivery.v1', packs: {} })) }),
    served({ manifestBytes: Buffer.alloc(16 * 1024 + 1, 32) }),
    served({ manifestBytes: Buffer.from(JSON.stringify({ schema: 'kjdraw.knowledge-delivery.v1', packs: {
      column: { ...row, url: 'https://evil.example.org/pack.json' } } })) }),
  ]) {
    const loaded = await loadGeologyKnowledge({ cacheRoot, enabled: true, fetcher: network.fetcher })
    assert.equal(loaded.source, 'cache')
    assert.equal(loaded.packs.column.sha256, row.sha256)
  }
  const redirected = await loadGeologyKnowledge({ cacheRoot, enabled: true, fetcher: async () => reply(Buffer.alloc(0), 302) })
  assert.equal(redirected.source, 'cache')
  assert.deepEqual(await readFile(join(cacheRoot, 'manifest.json')), manifest)
})

test('unsafe cache root is rejected before any read or network request', async t => {
  const base = await mkdtemp(join(tmpdir(), 'kjdraw-knowledge-unsafe-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const file = join(base, 'not-a-directory')
  await writeFile(file, 'private contents')
  let calls = 0
  const fetcher = () => { calls++; throw new Error('must not fetch') }
  const blocked = await loadGeologyKnowledge({ cacheRoot: file, enabled: true, fetcher })
  assert.equal(blocked.source, 'bundled')
  assert.match(blocked.notice, /unsafe/u)
  assert.equal(calls, 0)
  const link = join(base, 'linked-cache')
  try { await symlink(base, link, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) {
    if (!['EPERM', 'EACCES'].includes(error?.code)) throw error
    return
  }
  const linked = await loadGeologyKnowledge({ cacheRoot: link, enabled: true, fetcher })
  assert.equal(linked.source, 'bundled')
  assert.match(linked.notice, /unsafe/u)
  assert.equal(calls, 0)
})

test('disabled updates perform no network or cache access', async () => {
  const result = await loadGeologyKnowledge({ enabled: false, fetcher: () => { throw new Error('must not fetch') } })
  assert.equal(result.source, 'disabled')
  assert.deepEqual(result.packs, {})
})

test('first-start offline fallback stays bundled without creating a cache', async t => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'kjdraw-knowledge-empty-'))
  t.after(() => rm(cacheRoot, { recursive: true, force: true }))
  const result = await loadGeologyKnowledge({ cacheRoot, enabled: true, fetcher: async () => { throw new Error('offline') } })
  assert.equal(result.source, 'bundled')
  assert.deepEqual(result.packs, {})
})
