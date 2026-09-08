import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repositoryRoot = new URL('../../../', import.meta.url)

async function json(path) {
  return JSON.parse(await readFile(new URL(path, repositoryRoot), 'utf8'))
}

test('complete API reference covers every package export with stable deep links', async () => {
  const packageJson = await json('packages/kjdraw-sdk/package.json')
  const reference = await json('docs/latest/api/reference/api-reference.json')
  const compatibilityCopy = await json('docs/latest/api/api-reference.json')
  const search = await json('docs/latest/api/search-index.json')
  const html = await readFile(new URL('docs/latest/api/reference/index.html', repositoryRoot), 'utf8')

  assert.equal(reference.schema, 'com.kanjie.kjdraw.api-reference@1')
  assert.equal(reference.package, packageJson.name)
  assert.equal(reference.version, packageJson.version)
  assert.match(reference.sourceDigest, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(compatibilityCopy, reference, 'the old JSON route must remain compatible')
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
    assert.equal(entry.href, `./api/reference/#${entry.anchor}`)
    assert.ok(`${entry.name} ${entry.kind} ${entry.module} ${entry.summary}`.toLowerCase().includes(entry.name.toLowerCase()))
  }
})

test('Editor API is task-oriented, bilingual and deep-linkable', async () => {
  const packageJson = await json('packages/kjdraw-sdk/package.json')
  const guide = await json('docs/latest/api/editor-api.json')
  const html = await readFile(new URL('docs/latest/api/index.html', repositoryRoot), 'utf8')
  const app = await readFile(new URL('docs/latest/api/app.js', repositoryRoot), 'utf8')

  assert.equal(guide.schema, 'com.kanjie.kjdraw.editor-api-guide@1')
  assert.equal(guide.package, packageJson.name)
  assert.equal(guide.version, packageJson.version)
  assert.match(guide.sourceDigest, /^sha256:[a-f0-9]{64}$/)
  const installTarget = guide.distribution?.version === packageJson.version && guide.distribution?.channel === 'github-release'
    ? `https://github.com/KanJieTeam/kjdraw/releases/download/v${packageJson.version}/kanjieteam-kjdraw-${packageJson.version}.tgz`
    : `${packageJson.name}@${packageJson.version}`
  assert.ok(html.includes(`data-copy-value="npm install ${installTarget}"`), 'the install command must select the available distribution of the documented version')
  assert.match(html, /createKJDrawEditor/)
  assert.match(html, /@kanjieteam\/kjdraw\/react/)
  assert.match(html, /@kanjieteam\/kjdraw\/vue/)
  assert.match(html, /href="\.\/reference\/"/)
  assert.doesNotMatch(html, /class="api-symbol"/, 'the Editor API homepage must not be a declaration stream')

  for (const id of ['overview', 'quickstart', 'options', 'properties', 'methods', 'events', 'frameworks', 'advanced']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} must be a deep-link target`)
  }
  for (const [collection, prefix] of [['options', 'option'], ['properties', 'property'], ['methods', 'method'], ['events', 'event']]) {
    for (const entry of guide[collection]) {
      assert.ok(entry.en && entry.zh, `${collection}.${entry.name} must be bilingual`)
      const anchor = `${prefix}-${entry.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
      assert.match(html, new RegExp(`id=["']${anchor}["']`), `${anchor} must be a deep-link target`)
    }
  }

  const names = collection => new Set(guide[collection].map(entry => entry.name))
  for (const name of ['document', 'locale', 'theme', 'readonly', 'toolbar', 'onChange', 'onError']) assert.ok(names('options').has(name))
  for (const name of ['open', 'save', 'fit', 'undo', 'redo', 'execute', 'setDocument', 'setSelection', 'getSelection', 'setOptions', 'on', 'dispose']) assert.ok(names('methods').has(name))
  for (const name of ['ready', 'change', 'selectionchange', 'documentchange', 'error', 'dispose']) assert.ok(names('events').has(name))

  assert.match(app, /legacyAnchors/)
  assert.match(app, /\.\/reference\//)
  assert.match(app, /search-index\.json/)
  assert.match(app, /href\.replace/)
})

test('guide search loads the generated reference index and exposes Editor API', async () => {
  const home = await readFile(new URL('docs/latest/index.html', repositoryRoot), 'utf8')
  const app = await readFile(new URL('docs/latest/app.js', repositoryRoot), 'utf8')
  assert.match(home, /href="\.\/api\/"/)
  assert.match(home, /id="docs-version"/)
  assert.match(app, /api\/search-index\.json/)
  assert.match(app, /entry\.href/)
})

test('generated API documentation has no source drift', () => {
  for (const script of ['docs/latest/api/app.js', 'docs/latest/api/reference/app.js']) {
    const syntax = spawnSync(process.execPath, ['--check', script], {
      cwd: new URL('.', repositoryRoot),
      encoding: 'utf8',
    })
    assert.equal(syntax.status, 0, `${script}\n${syntax.stdout}\n${syntax.stderr}`)
  }
  const result = spawnSync(process.execPath, ['scripts/build-api-docs.mjs', '--check'], {
    cwd: new URL('.', repositoryRoot),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
