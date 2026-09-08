import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repositoryRoot = new URL('../../../', import.meta.url)

async function json(path) {
  return JSON.parse(await readFile(new URL(path, repositoryRoot), 'utf8'))
}

test('generated API reference covers every package export with stable deep links', async () => {
  const packageJson = await json('packages/kjdraw-sdk/package.json')
  const reference = await json('docs/latest/api/api-reference.json')
  const search = await json('docs/latest/api/search-index.json')
  const html = await readFile(new URL('docs/latest/api/index.html', repositoryRoot), 'utf8')

  assert.equal(reference.schema, 'com.kanjie.kjdraw.api-reference@1')
  assert.equal(reference.package, packageJson.name)
  assert.equal(reference.version, packageJson.version)
  assert.match(reference.sourceDigest, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(reference.modules.map(module => module.exportPath), Object.keys(packageJson.exports))

  const anchors = []
  for (const module of reference.modules) {
    assert.ok(module.symbols.length > 0, `${module.exportPath} must expose documented symbols`)
    assert.match(html, new RegExp(`id=["']${module.anchor}["']`))
    for (const symbol of module.symbols) {
      assert.match(symbol.name, /^[A-Za-z_$][\w$]*$|^default$/)
      assert.ok(symbol.declaration.startsWith('export '), `${module.exportPath}/${symbol.name} must preserve its declaration`)
      assert.match(symbol.anchor, /^[a-z0-9-]+$/)
      assert.match(html, new RegExp(`id=["']${symbol.anchor}["']`), `${symbol.anchor} must be a deep-link target`)
      anchors.push(symbol.anchor)
    }
  }
  assert.equal(new Set(anchors).size, anchors.length, 'API deep-link anchors must be globally unique')

  assert.equal(search.schema, 'com.kanjie.kjdraw.api-search-index@1')
  assert.equal(search.sourceDigest, reference.sourceDigest)
  assert.equal(search.entries.length, anchors.length)
  assert.deepEqual(new Set(search.entries.map(entry => entry.anchor)), new Set(anchors))
  for (const entry of search.entries) {
    assert.equal(entry.href, `./api/#${entry.anchor}`)
    assert.ok(`${entry.name} ${entry.kind} ${entry.module} ${entry.summary}`.toLowerCase().includes(entry.name.toLowerCase()))
  }
})

test('guide search loads the generated API index and exposes a visible reference route', async () => {
  const home = await readFile(new URL('docs/latest/index.html', repositoryRoot), 'utf8')
  const app = await readFile(new URL('docs/latest/app.js', repositoryRoot), 'utf8')
  assert.match(home, /href="\.\/api\/"/)
  assert.match(home, /id="docs-version"/)
  assert.match(app, /fetch\('\.\/api\/search-index\.json'\)/)
  assert.match(app, /entry\.href/)
})

test('generated API documentation has no declaration drift', () => {
  const result = spawnSync(process.execPath, ['scripts/build-api-docs.mjs', '--check'], {
    cwd: new URL('.', repositoryRoot),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
