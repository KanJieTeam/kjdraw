import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createSample } from '../../../examples/sample.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { createIndustrySamples } from '../src/samples.js'

const repositoryRoot = new URL('../../../', import.meta.url)

test('Showcase manifest is generated from every public sample and its facts remain exact', async () => {
  const manifest = JSON.parse(await readFile(new URL('docs/latest/showcase/catalog.json', repositoryRoot), 'utf8'))
  assert.equal(manifest.schema, 'com.kanjie.kjdraw.showcase@1')
  assert.equal(manifest.entries.length, 16)
  assert.equal(manifest.entries.find(entry => entry.id === 'borehole-log').title.zh, '柱状图')
  assert.equal(manifest.entries.find(entry => entry.id === 'geology-section').title.zh, '剖面图')
  assert.equal(manifest.entries.find(entry => entry.id === 'geology-plan').title.zh, '平面图')
  assert.match(manifest.entries.find(entry => entry.id === 'borehole-log').summary.zh, /30 米.*岩性分层/)
  assert.match(manifest.entries.find(entry => entry.id === 'geology-section').summary.zh, /五孔.*剖面/)
  assert.equal(manifest.entries.filter(entry => entry.kind === 'sample').length, 9)
  assert.equal(manifest.entries.filter(entry => entry.kind === 'specimen').length, 7)
  assert.equal(manifest.categories.reduce((sum, category) => sum + category.count, 0), manifest.entries.length)

  const sdk = createKJDrawSDK()
  const drawings = [await createSample(sdk), ...await createIndustrySamples(sdk)]
  const sampleEntries = manifest.entries.filter(entry => entry.kind === 'sample')
  assert.deepEqual(new Set(sampleEntries.map(entry => entry.sampleId)), new Set(drawings.map(drawing => drawing.id)))
  for (const entry of sampleEntries) {
    const drawing = drawings.find(candidate => candidate.id === entry.sampleId)
    const entities = drawing.listEntities({ ownerId: drawing.snapshot().spaces.modelSpaceId })
    assert.equal(entry.facts.editableObjects, entities.length, `${entry.sampleId} object count drifted`)
    assert.equal(entry.facts.layers, drawing.getTable('layers').records.length, `${entry.sampleId} layer count drifted`)
    assert.equal(entry.facts.units, drawing.snapshot().header.units)
    assert.equal(Object.values(entry.facts.entityTypes).reduce((sum, count) => sum + count, 0), entities.length)
    assert.match(entry.links.source, /^https:\/\/github\.com\/KanJieTeam\/kjdraw\/blob\/main\/(?:examples|packages)\//)
    assert.equal(entry.links.playground, `https://kanjieteam.github.io/kjdraw/?sample=${entry.sampleId}`)
    const thumbnail = await readFile(new URL(`docs/latest/showcase/assets/${entry.id}.svg`, repositoryRoot), 'utf8')
    assert.match(thumbnail, /^<svg[^>]+role="img"/)
    assert.match(thumbnail, new RegExp(`Generated from ${entities.length} editable entities`))
    assert.equal(createHash('sha256').update(thumbnail).digest('hex'), entry.thumbnailSha256)
    assert.ok((thumbnail.match(/<(?:path|circle|text)\b/g) ?? []).length > 5, `${entry.id} thumbnail must contain real generated geometry`)
  }
  const sectionThumbnail = await readFile(new URL('docs/latest/showcase/assets/geology-section.svg', repositoryRoot), 'utf8')
  assert.match(sectionThumbnail, /hatch-loess/)
  for (const entry of manifest.entries.filter(row => row.kind === 'specimen')) {
    assert.match(entry.links.preview, /^\.\/assets\/[a-z0-9-]+\.svg$/)
    assert.equal(entry.artifact.diagnostics, 0)
    assert.ok(entry.artifact.renderedEntities > 0)
    assert.ok(entry.facts.editableObjects > 0)
    assert.equal(Object.values(entry.facts.entityTypes).reduce((sum, count) => sum + count, 0), entry.facts.editableObjects)
    const thumbnail = await readFile(new URL(`docs/latest/showcase/assets/${entry.id}.svg`, repositoryRoot), 'utf8')
    assert.match(thumbnail, /<svg\b/)
    assert.equal(createHash('sha256').update(thumbnail).digest('hex'), entry.thumbnailSha256)
  }
})

test('Showcase page exposes searchable cards, filters, view switching and manifest links in both locales', async () => {
  const html = await readFile(new URL('docs/latest/showcase/index.html', repositoryRoot), 'utf8')
  const app = await readFile(new URL('docs/latest/app.js', repositoryRoot), 'utf8')
  assert.equal((html.match(/class="showcase-portal"/g) ?? []).length, 2)
  assert.equal((html.match(/class="showcase-card"/g) ?? []).length, 32)
  assert.equal((html.match(/class="showcase-thumb"/g) ?? []).length, 32)
  assert.match(html, /class="showcase-query"/)
  assert.match(html, /class="showcase-tag-filter"/)
  assert.match(html, /data-view="grid"/)
  assert.match(html, /data-view="list"/)
  assert.match(html, /\.\/catalog\.json/)
  assert.match(app, /initializeShowcase/)
  assert.match(app, /matchesCategory/)
  assert.match(app, /matchesTag/)
  assert.match(app, /matchesQuery/)
})
