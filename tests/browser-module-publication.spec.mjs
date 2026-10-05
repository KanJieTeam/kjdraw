import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditBrowserModuleGraph } from '../scripts/audits/verify-browser-module-graph.mjs'

test('all delivered browser entry points have a complete parseable relative module graph', async () => {
  const report = await auditBrowserModuleGraph()
  assert.ok(report.entryPointCount > 1)
  assert.ok(report.moduleCount > report.entryPointCount, 'dependencies must be recursively inspected, not just top-level entries')
  assert.deepEqual(report.parseErrors, [])
  assert.deepEqual(report.missing, [], 'a missing dependency prevents the entire browser entry from initializing')
})

test('the publication membership contract rejects an omitted AI Markdown module even when it exists in a dirty worktree', async () => {
  const full = await auditBrowserModuleGraph({ entryPoints: ['apps/playground/ai/ai.js'] })
  assert.deepEqual(full.missing, [])
  const { readdir } = await import('node:fs/promises')
  const root = fileURLToPath(new URL('../', import.meta.url))
  const enumerate = async directory => (await readdir(join(root, directory), { withFileTypes: true })).flatMap(entry =>
    entry.isFile() ? [`${directory}/${entry.name}`] : [])
  const delivered = new Set()
  const visit = async directory => {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(`${directory}/${entry.name}`)
      else if (entry.isFile()) delivered.add(`${directory}/${entry.name}`)
    }
  }
  await visit('apps/playground')
  await visit('packages/kjdraw-sdk/src')
  await visit('examples')
  delivered.delete('apps/playground/ai/message-markdown.js')
  const omitted = await auditBrowserModuleGraph({ entryPoints: ['apps/playground/ai/ai.js'], publishedPaths: delivered })
  assert.deepEqual(omitted.parseErrors, [])
  assert.deepEqual(omitted.missing, [{ importer: 'apps/playground/ai/ai.js', specifier: './message-markdown.js',
    target: 'apps/playground/ai/message-markdown.js', reason: 'not-in-published-tree' }])
  assert.equal((await enumerate('apps/playground/ai')).includes('apps/playground/ai/message-markdown.js'), true)
})

test('missing entry point is a failure, never an empty successful graph', async () => {
  const report = await auditBrowserModuleGraph({ entryPoints: ['apps/playground/ai/missing-publication-test-entry.js'] })
  assert.deepEqual(report.missing, [{ importer: null, specifier: 'apps/playground/ai/missing-publication-test-entry.js',
    target: 'apps/playground/ai/missing-publication-test-entry.js', reason: 'entry-not-delivered' }])
})

test('default publication audit still rejects missing product entry points when no scripts can be enumerated', async () => {
  const report = await auditBrowserModuleGraph({ root: fileURLToPath(new URL('./fixtures/', import.meta.url)) })
  assert.equal(report.entryPointCount, 3)
  assert.equal(report.missing.length, 3)
  assert.ok(report.missing.every(item => item.reason === 'entry-not-delivered'))
})
