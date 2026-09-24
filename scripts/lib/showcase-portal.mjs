import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildCadCapabilitySpecimenDocuments } from '../../examples/cad-capability-specimens.mjs'
import { createSample } from '../../examples/sample.js'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { createIndustrySamples, INDUSTRY_SAMPLES } from '../../packages/kjdraw-sdk/src/samples.js'
import { exportDrawingSvg } from '../../packages/kjdraw-sdk/src/svg-export.js'

export const SHOWCASE_CATALOG_SOURCE = 'docs/site/showcase/catalog.json'
export const SHOWCASE_GENERATION_SOURCES = Object.freeze([
  SHOWCASE_CATALOG_SOURCE,
  'examples/cad-capability-specimens.mjs',
  'examples/sample.js',
  'packages/kjdraw-sdk/src/samples.ts',
  'scripts/lib/showcase-portal.mjs',
])

const categories = Object.freeze({
  multidisciplinary: { en: 'Multidisciplinary', zh: '多专业' },
  civil: { en: 'Civil & site', zh: '场地与土木' },
  architecture: { en: 'Architecture', zh: '建筑' },
  transportation: { en: 'Transportation', zh: '道路交通' },
  mechanical: { en: 'Mechanical', zh: '机械' },
  'core-capabilities': { en: 'Core capabilities', zh: '核心能力' },
  'output-interop': { en: 'Output & interop', zh: '出图与交换' },
  editing: { en: 'Editing', zh: '编辑' },
})

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function fixed(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(Number(number.toFixed(4))) : '0'
}

function pointFrom(value) {
  return Array.isArray(value) && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))
    ? [Number(value[0]), Number(value[1])]
    : null
}

function entityPoints(entity) {
  const payload = entity.payload ?? {}
  switch (entity.type) {
    case 'LINE': return [pointFrom(payload.start), pointFrom(payload.end)].filter(Boolean)
    case 'CIRCLE':
    case 'ARC': {
      const center = pointFrom(payload.center)
      const radius = Number(payload.radius)
      return center && Number.isFinite(radius) ? [[center[0] - radius, center[1] - radius], [center[0] + radius, center[1] + radius]] : []
    }
    case 'LWPOLYLINE': return (payload.vertices ?? []).map(vertex => pointFrom(vertex?.point ?? vertex)).filter(Boolean)
    case 'TEXT': return [pointFrom(payload.position)].filter(Boolean)
    default: return []
  }
}

function drawingBounds(entities) {
  const points = entities.flatMap(entityPoints)
  invariant(points.length > 1, 'Showcase drawing has no renderable public geometry')
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  const width = Math.max(maxX - minX, 1), height = Math.max(maxY - minY, 1)
  const padding = Math.max(width, height) * .045
  return { minX: minX - padding, minY: minY - padding, width: width + padding * 2, height: height + padding * 2 }
}

function renderThumbnail(document, entry) {
  const modelSpaceId = document.snapshot().spaces.modelSpaceId
  const entities = document.listEntities({ ownerId: modelSpaceId })
  const bounds = drawingBounds(entities)
  const width = 720, height = 420
  const scale = Math.min(width / bounds.width, height / bounds.height)
  const offsetX = (width - bounds.width * scale) / 2
  const offsetY = (height - bounds.height * scale) / 2
  const screen = value => {
    const point = pointFrom(value) ?? [0, 0]
    return [offsetX + (point[0] - bounds.minX) * scale, height - offsetY - (point[1] - bounds.minY) * scale]
  }
  const path = []
  for (const entity of entities) {
    const payload = entity.payload ?? {}
    if (entity.type === 'LINE') {
      const [x1, y1] = screen(payload.start), [x2, y2] = screen(payload.end)
      path.push(`<path d="M${fixed(x1)} ${fixed(y1)}L${fixed(x2)} ${fixed(y2)}"/>`)
    } else if (entity.type === 'CIRCLE') {
      const [cx, cy] = screen(payload.center), radius = Number(payload.radius) * scale
      path.push(`<circle cx="${fixed(cx)}" cy="${fixed(cy)}" r="${fixed(radius)}"/>`)
    } else if (entity.type === 'ARC') {
      const center = pointFrom(payload.center), radius = Number(payload.radius)
      const start = Number(payload.startAngle), end = Number(payload.endAngle)
      if (!center || !Number.isFinite(radius) || !Number.isFinite(start) || !Number.isFinite(end)) continue
      const a = screen([center[0] + Math.cos(start) * radius, center[1] + Math.sin(start) * radius])
      const b = screen([center[0] + Math.cos(end) * radius, center[1] + Math.sin(end) * radius])
      let span = ((end - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
      if (span === 0) span = Math.PI * 2
      path.push(`<path d="M${fixed(a[0])} ${fixed(a[1])}A${fixed(radius * scale)} ${fixed(radius * scale)} 0 ${span > Math.PI ? 1 : 0} 0 ${fixed(b[0])} ${fixed(b[1])}"/>`)
    } else if (entity.type === 'LWPOLYLINE') {
      const vertices = (payload.vertices ?? []).map(vertex => screen(vertex?.point ?? vertex))
      if (vertices.length < 2) continue
      const command = vertices.map(([x, y], index) => `${index ? 'L' : 'M'}${fixed(x)} ${fixed(y)}`).join('')
      path.push(`<path d="${command}${payload.closed ? 'Z' : ''}"/>`)
    } else if (entity.type === 'TEXT') {
      const [x, y] = screen(payload.position)
      const fontSize = Math.min(Math.max(Number(payload.height || 1) * scale, 4.5), 14)
      path.push(`<text x="${fixed(x)}" y="${fixed(y)}" font-size="${fixed(fontSize)}">${escapeHtml(payload.text ?? '')}</text>`)
    }
  }
  const title = `${entry.title.en} · ${entry.drawingType.en}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420" role="img" aria-labelledby="title desc"><title id="title">${escapeHtml(title)}</title><desc id="desc">Generated from ${entities.length} editable entities in ${escapeHtml(entry.sampleId)}.</desc><rect width="720" height="420" rx="12" fill="#f8fafc"/><g fill="none" stroke="#21324b" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke">${path.join('')}</g><rect x=".5" y=".5" width="719" height="419" rx="11.5" fill="none" stroke="#d9e1ec"/></svg>\n`
}

function normalizeSpecimenPreview(svg) {
  const stableIds = new Map()
  const deterministic = String(svg).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, value => {
    const key = value.toLowerCase()
    if (!stableIds.has(key)) stableIds.set(key, `generated-${stableIds.size + 1}`)
    return stableIds.get(key)
  })
  return deterministic.replace(/(<svg\b[^>]*>)/, '$1<style>g[data-entity-id]{stroke-width:.8!important}text{font-weight:500}</style>')
}

function validateCatalog(catalog) {
  invariant(catalog?.schema === 'com.kanjie.kjdraw.showcase-catalog@1', 'Unexpected Showcase catalog schema')
  invariant(Array.isArray(catalog.entries) && catalog.entries.length > 0, 'Showcase catalog must contain entries')
  const ids = new Set(), referenceIds = new Set()
  for (const entry of catalog.entries) {
    invariant(/^[a-z0-9-]+$/.test(entry.id), `Invalid Showcase entry id: ${entry.id}`)
    invariant(entry.kind === 'sample' || entry.kind === 'specimen', `Invalid Showcase entry kind: ${entry.kind}`)
    const referenceId = entry.kind === 'sample' ? entry.sampleId : entry.specimenId
    invariant(/^[a-z0-9-]+$/.test(referenceId), `Invalid Showcase reference id: ${referenceId}`)
    if (entry.kind === 'sample') invariant(/^sample-[a-z0-9-]+$/.test(entry.sampleId), `Invalid Showcase sample id: ${entry.sampleId}`)
    invariant(!ids.has(entry.id), `Duplicate Showcase entry id: ${entry.id}`)
    invariant(!referenceIds.has(referenceId), `Duplicate Showcase reference id: ${referenceId}`)
    invariant(categories[entry.category], `Unknown Showcase category: ${entry.category}`)
    for (const locale of ['en', 'zh']) {
      invariant(entry.title?.[locale] && entry.drawingType?.[locale] && entry.summary?.[locale], `${entry.id} is missing ${locale} copy`)
      invariant(Array.isArray(entry.tags?.[locale]) && entry.tags[locale].length > 0, `${entry.id} is missing ${locale} tags`)
    }
    if (entry.kind === 'sample') invariant(/^[a-z0-9-]+$/.test(entry.detailAnchor), `${entry.id} has an invalid detail anchor`)
    invariant(/^(?:examples|packages)\/[a-z0-9./-]+\.(?:mjs|js|ts)$/i.test(entry.source), `${entry.id} has an invalid public source path`)
    ids.add(entry.id); referenceIds.add(referenceId)
  }
}

export async function buildShowcasePortal(repositoryRoot) {
  const catalogSource = await readFile(resolve(repositoryRoot, SHOWCASE_CATALOG_SOURCE), 'utf8')
  const catalog = JSON.parse(catalogSource)
  validateCatalog(catalog)
  const sdk = createKJDrawSDK()
  const documents = [await createSample(sdk), ...await createIndustrySamples(sdk)]
  const documentById = new Map(documents.map(document => [document.id, document]))
  const specimens = await buildCadCapabilitySpecimenDocuments()
  const specimenById = new Map(specimens.map(specimen => [specimen.id, specimen]))
  const publicSampleIds = new Set(['sample-resilient-campus', ...INDUSTRY_SAMPLES.map(sample => sample.id)])
  invariant(catalog.entries.filter(entry => entry.kind === 'sample').length === publicSampleIds.size, 'Showcase catalog must cover every public Playground sample exactly once')
  for (const sampleId of publicSampleIds) invariant(catalog.entries.some(entry => entry.sampleId === sampleId), `Showcase catalog is missing ${sampleId}`)
  invariant(catalog.entries.filter(entry => entry.kind === 'specimen').length === specimens.length, 'Showcase catalog must cover every capability specimen exactly once')
  for (const specimen of specimens) invariant(catalog.entries.some(entry => entry.specimenId === specimen.id), `Showcase catalog is missing specimen ${specimen.id}`)

  const outputs = new Map()
  const entries = []
  for (const entry of catalog.entries) {
    const specimen = entry.kind === 'specimen' ? specimenById.get(entry.specimenId) : null
    const document = entry.kind === 'sample' ? documentById.get(entry.sampleId) : specimen?.document
    invariant(document, `Showcase entry references unknown ${entry.kind}: ${entry.sampleId ?? entry.specimenId}`)
    const entities = entry.kind === 'sample' ? document.listEntities({ ownerId: document.snapshot().spaces.modelSpaceId }) : document.listEntities()
    const entityTypes = Object.fromEntries([...new Set(entities.map(entity => entity.type))].sort().map(type => [type, entities.filter(entity => entity.type === type).length]))
    const rendered = specimen ? exportDrawingSvg(document, { layoutId: specimen.layoutId }) : null
    if (rendered) invariant(rendered.report.diagnostics.length === 0, `${entry.specimenId} SVG preview has diagnostics`)
    const thumbnail = rendered ? normalizeSpecimenPreview(rendered.svg) : renderThumbnail(document, entry)
    const thumbnailPath = `showcase/assets/${entry.id}.svg`
    outputs.set(thumbnailPath, thumbnail)
    entries.push({
      ...entry,
      categoryTitle: categories[entry.category],
      facts: {
        ...(specimen?.facts ?? {}),
        editableObjects: entities.length,
        layers: document.getTable('layers').records.length,
        units: document.snapshot().header.units,
        entityTypes,
      },
      links: {
        ...(entry.kind === 'sample' ? { playground: `https://kanjieteam.github.io/kjdraw/?sample=${encodeURIComponent(entry.sampleId)}` } : { preview: `./assets/${entry.id}.svg` }),
        source: `https://github.com/KanJieTeam/kjdraw/blob/main/${entry.source}`,
      },
      artifact: {
        path: thumbnailPath,
        svgStatus: rendered?.report.status ?? 'generated-thumbnail',
        renderedEntities: rendered?.report.rendered ?? entities.length,
        diagnostics: rendered?.report.diagnostics.length ?? 0,
        revision: document.revision,
      },
      thumbnail: `./assets/${entry.id}.svg`,
      thumbnailSha256: createHash('sha256').update(thumbnail).digest('hex'),
    })
  }
  const manifest = {
    schema: 'com.kanjie.kjdraw.showcase@1',
    source: SHOWCASE_CATALOG_SOURCE,
    generatedFrom: ['examples/sample.js', 'packages/kjdraw-sdk/src/samples.ts', 'examples/cad-capability-specimens.mjs'],
    categories: Object.entries(categories).map(([id, title]) => ({ id, title, count: entries.filter(entry => entry.category === id).length })),
    entries,
  }
  outputs.set('showcase/catalog.json', `${JSON.stringify(manifest, null, 2)}\n`)
  return { catalogSource, manifest, outputs }
}

function localized(locale, value) {
  return escapeHtml(value?.[locale] ?? value?.en ?? '')
}

export function renderShowcasePortal(manifest, locale) {
  const text = locale === 'zh' ? {
    all: '全部案例', search: '搜索图纸、对象或工作流', tag: '全部标签', grid: '网格', list: '列表',
    objects: '可编辑对象', layers: '图层', source: '查看源码', playground: '在线体验', preview: '打开预览', detail: '验证详情', types: '图元事实', empty: '没有匹配的案例。', shown: '个案例',
  } : {
    all: 'All examples', search: 'Search drawings, objects or workflows', tag: 'All tags', grid: 'Grid', list: 'List',
    objects: 'editable objects', layers: 'layers', source: 'Source', playground: 'Open Playground', preview: 'Open preview', detail: 'Verified details', types: 'Entity facts', empty: 'No matching examples.', shown: 'examples',
  }
  const tags = [...new Set(manifest.entries.flatMap(entry => entry.tags[locale]))].sort((a, b) => a.localeCompare(b, locale === 'zh' ? 'zh-CN' : 'en'))
  const categoryButtons = [
    `<button type="button" class="showcase-category active" data-category="all" aria-pressed="true"><span>${escapeHtml(text.all)}</span><b>${manifest.entries.length}</b></button>`,
    ...manifest.categories.map(category => `<button type="button" class="showcase-category" data-category="${escapeHtml(category.id)}" aria-pressed="false"><span>${localized(locale, category.title)}</span><b>${category.count}</b></button>`),
  ].join('')
  const cards = manifest.entries.map(entry => {
    const referenceId = entry.sampleId ?? entry.specimenId
    const search = [referenceId, entry.title.en, entry.title.zh, entry.drawingType.en, entry.drawingType.zh, entry.summary.en, entry.summary.zh, ...entry.tags.en, ...entry.tags.zh, ...Object.keys(entry.facts.entityTypes)].join(' ').toLowerCase()
    const tagList = entry.tags[locale].map(tag => `<button type="button" class="showcase-tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')
    const thumbnailHref = entry.links.playground ? `#${locale}-showcase-${entry.detailAnchor}` : entry.links.preview
    const entityFacts = Object.entries(entry.facts.entityTypes).map(([type, count]) => `<span><b>${escapeHtml(type)}</b> ${count}</span>`).join('')
    const primary = entry.links.playground
      ? `<a class="primary" href="${escapeHtml(entry.links.playground)}">${escapeHtml(text.playground)} ↗</a>`
      : `<a class="primary" href="${escapeHtml(entry.links.preview)}">${escapeHtml(text.preview)} ↗</a>`
    return `<article class="showcase-card" data-case-id="${escapeHtml(entry.id)}" data-category="${escapeHtml(entry.category)}" data-tags="${escapeHtml(entry.tags[locale].join('|'))}" data-search="${escapeHtml(search)}">
      <a class="showcase-thumb" href="${escapeHtml(thumbnailHref)}" aria-label="${escapeHtml(text.detail)}: ${localized(locale, entry.title)}"><img src="${escapeHtml(entry.thumbnail)}" alt="${localized(locale, entry.title)} · ${localized(locale, entry.drawingType)}" loading="lazy" width="720" height="420"></a>
      <div class="showcase-card-body"><p class="showcase-discipline">${localized(locale, entry.categoryTitle)}</p><h3>${localized(locale, entry.title)}</h3><p class="showcase-type">${localized(locale, entry.drawingType)}</p><p class="showcase-summary">${localized(locale, entry.summary)}</p>
      <div class="showcase-facts"><span><b>${entry.facts.editableObjects.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</b> ${escapeHtml(text.objects)}</span><span><b>${entry.facts.layers}</b> ${escapeHtml(text.layers)}</span><span>${escapeHtml(entry.facts.units)}</span></div>
      <details class="showcase-details"><summary>${escapeHtml(text.detail)}</summary><p><code>${escapeHtml(referenceId)}</code></p><div><b>${escapeHtml(text.types)}</b>${entityFacts}</div><p>${escapeHtml(entry.artifact.svgStatus)} · ${entry.artifact.renderedEntities} rendered · ${entry.artifact.diagnostics} diagnostics</p></details>
      <div class="showcase-tags">${tagList}</div><div class="showcase-actions"><a href="${escapeHtml(entry.links.source)}">${escapeHtml(text.source)} ↗</a>${primary}</div></div>
    </article>`
  }).join('')
  return `<section class="showcase-portal" data-locale="${locale}" data-count="${manifest.entries.length}">
    <div class="showcase-toolbar"><label><span class="sr-only">${escapeHtml(text.search)}</span><input class="showcase-query" type="search" placeholder="${escapeHtml(text.search)}" autocomplete="off"></label><label><span class="sr-only">${escapeHtml(text.tag)}</span><select class="showcase-tag-filter"><option value="all">${escapeHtml(text.tag)}</option>${tags.map(tag => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('')}</select></label><div class="showcase-view" role="group" aria-label="View"><button type="button" data-view="grid" class="active" aria-pressed="true">▦ ${escapeHtml(text.grid)}</button><button type="button" data-view="list" aria-pressed="false">☷ ${escapeHtml(text.list)}</button></div></div>
    <div class="showcase-layout"><aside class="showcase-categories" aria-label="Categories">${categoryButtons}</aside><div class="showcase-results"><div class="showcase-result-head"><output aria-live="polite"><b>${manifest.entries.length}</b> ${escapeHtml(text.shown)}</output><a href="./catalog.json">JSON manifest ↗</a></div><div class="showcase-grid">${cards}</div><p class="showcase-empty" hidden>${escapeHtml(text.empty)}</p></div></div>
  </section>`
}
