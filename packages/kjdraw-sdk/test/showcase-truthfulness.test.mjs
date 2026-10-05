import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import { INDUSTRY_SAMPLES } from '../src/samples.js'

const root = new URL('../../../', import.meta.url)
const withheld = [
  ['borehole-log', 'sample-borehole-log'],
  ['geology-section', 'sample-geology-section'],
  ['geology-plan', 'sample-geology-plan'],
]

test('unverified geology samples remain available internally but are absent from the public Showcase', async () => {
  const manifest = JSON.parse(await readFile(new URL('docs/latest/showcase/catalog.json', root), 'utf8'))
  const gallery = await readFile(new URL('docs/latest/showcase/index.html', root), 'utf8')
  const home = await readFile(new URL('docs/latest/index.html', root), 'utf8')
  const internalSampleIds = new Set(INDUSTRY_SAMPLES.map(sample => sample.id))
  for (const [id, sampleId] of withheld) {
    assert.ok(internalSampleIds.has(sampleId), `${sampleId} must remain available for internal regression`)
    assert.equal(manifest.entries.some(entry => entry.id === id || entry.sampleId === sampleId), false)
    assert.doesNotMatch(gallery, new RegExp(`data-case-id="${id}"`))
    assert.doesNotMatch(home, new RegExp(`showcase/${id}/`))
    await assert.rejects(() => access(new URL(`docs/latest/showcase/${id}/index.html`, root)), { code: 'ENOENT' })
    for (const extension of ['svg', 'kjd', 'dxf', 'source.txt']) {
      await assert.rejects(() => access(new URL(`docs/latest/showcase/assets/${id}.${extension}`, root)), { code: 'ENOENT' })
    }
  }
  assert.equal(manifest.categories.some(category => category.id === 'geology' && category.count === 0), false)
  assert.doesNotMatch(gallery, /技术示意 · 版式未验收|Technical demo · layout unverified|class="showcase-review"/)
  assert.doesNotMatch(gallery, /diagnostics/)
  assert.doesNotMatch(home, /打开真实案例|Open a real case/)
})