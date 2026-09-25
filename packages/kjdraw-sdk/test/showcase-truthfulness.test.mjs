import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)

test('synthetic geology examples disclose unverified engineering layouts before preview', async () => {
  const manifest = JSON.parse(await readFile(new URL('docs/latest/showcase/catalog.json', root), 'utf8'))
  const gallery = await readFile(new URL('docs/latest/showcase/index.html', root), 'utf8')
  for (const id of ['borehole-log', 'geology-section', 'geology-plan']) {
    const entry = manifest.entries.find(candidate => candidate.id === id)
    assert.equal(entry?.reviewStatus, 'layout-unverified', `${id} must not be presented as a validated engineering layout`)
    const detail = await readFile(new URL(`docs/latest/showcase/${id}/index.html`, root), 'utf8')
    assert.match(detail, /技术示意 — 工程版式尚未验收/)
    assert.match(detail, /不应作为工程出图模板/)
  }
  assert.equal((gallery.match(/class="showcase-review"/g) ?? []).length, 6)
  assert.match(gallery, /技术示意 · 版式未验收/)
  const home = await readFile(new URL('docs/latest/index.html', root), 'utf8')
  assert.doesNotMatch(home, /打开真实案例|Open a real case/)
})
