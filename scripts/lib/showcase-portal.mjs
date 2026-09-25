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

const sourceBuilderByCase = Object.freeze({
  'resilient-campus': 'createSample',
  'site-plan': 'buildSitePlan',
  'architecture-floor-plan': 'buildArchitecture',
  'road-profile': 'buildRoadProfile',
  'mechanical-bracket': 'buildMechanical',
  'mechanical-flange': 'buildMechanicalFlange',
  'borehole-log': 'buildBoreholeLog',
  'geology-section': 'buildGeologySectionCompiled',
  'geology-plan': 'buildGeologyPlanCompiled',
  'editable-entities': 'geometrySpecimen',
  'native-dimensions': 'dimensionsSpecimen',
  'bilingual-typography': 'typographySpecimen',
  'a4-print-layout': 'printSpecimen',
  'dxf-import': 'importSpecimen',
  'editing-history': 'editingSpecimen',
  'block-references': 'blocksSpecimen',
})

function caseSourceExcerpt(source, entry) {
  const symbol = sourceBuilderByCase[entry.id]
  invariant(symbol, `Showcase source builder missing for ${entry.id}`)
  const lines = source.split(/\r?\n/)
  const declaration = new RegExp('^(?:export\\s+)?(?:async\\s+)?function\\s+' + symbol + '\\s*\\(')
  const start = lines.findIndex(line => declaration.test(line))
  invariant(start >= 0, `Showcase source builder ${symbol} is missing in ${entry.source}`)
  const end = lines.findIndex((line, index) => index > start && line === '}')
  invariant(end > start, `Showcase source builder ${symbol} has no top-level closing brace`)
  return { symbol, startLine: start + 1, endLine: end + 1, code: lines.slice(start, end + 1).join('\n') + '\n' }
}
const categories = Object.freeze({
  multidisciplinary: { en: 'Multidisciplinary', zh: '多专业' },
  civil: { en: 'Civil & site', zh: '场地与土木' },
  architecture: { en: 'Architecture', zh: '建筑' },
  transportation: { en: 'Transportation', zh: '道路交通' },
  mechanical: { en: 'Mechanical', zh: '机械' },
  geology: { en: 'Geology & surveying', zh: '地质与勘察' },
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
  const hatchPatterns = new Set()
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
    } else if (entity.type === 'HATCH') {
      const patternId = ({ GEO_TOPSOIL: 'topsoil', GEO_LOESS: 'loess', GEO_PALEOSOL: 'paleosol', GEO_SILTY_CLAY: 'silty-clay' })[String(payload.patternName ?? '').toUpperCase()] ?? 'generic'
      hatchPatterns.add(patternId)
      for (const loop of payload.boundaryLoops ?? []) {
        const vertices = (loop.vertices ?? []).map(vertex => pointFrom(vertex?.point ?? vertex)).filter(Boolean)
        if (vertices.length < 3) continue
        const command = vertices.map(vertex => screen(vertex)).map(([x, y], index) => (index ? 'L' : 'M') + fixed(x) + ' ' + fixed(y)).join('')
        path.push('<path d="' + command + 'Z" fill="url(#hatch-' + patternId + ')" stroke="none"/>')
      }    } else if (entity.type === 'TEXT') {
      const [x, y] = screen(payload.position)
      const fontSize = Math.min(Math.max(Number(payload.height || 1) * scale, 4.5), 14)
      path.push(`<text x="${fixed(x)}" y="${fixed(y)}" font-size="${fixed(fontSize)}">${escapeHtml(payload.text ?? '')}</text>`)
    }
  }
  const patterns = {
    topsoil: '<path d="M0 0L10 10M-2 6L2 10M8 -2L12 2"/>',
    loess: '<path d="M3 2v2m7 5v2"/>',
    paleosol: '<path d="M0 4h7m7 0h2M3 11h10"/>',
    'silty-clay': '<path d="M0 5h5m7 0h4M5 12h6"/>',
    generic: '<path d="M0 0L12 12"/>',
  }
  const defs = [...hatchPatterns].map(id => '<pattern id="hatch-' + id + '" patternUnits="userSpaceOnUse" width="16" height="16"><rect width="16" height="16" fill="#1c2c32"/><g fill="none" stroke="#91a99e" stroke-width=".8">' + patterns[id] + '</g></pattern>').join('')
  const title = `${entry.title.en} · ${entry.drawingType.en}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420" role="img" aria-labelledby="title desc" data-preview-theme="cad-dark"><title id="title">${escapeHtml(title)}</title><desc id="desc">Generated from ${entities.length} editable entities in ${escapeHtml(entry.sampleId)}.</desc><defs>${defs}</defs><rect width="720" height="420" fill="#101820"/><g fill="none" stroke="#c7d5d9" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke">${path.join('')}</g><rect x=".5" y=".5" width="719" height="419" rx="11.5" fill="none" stroke="#31414c"/></svg>\n`
}

function normalizeSpecimenPreview(svg) {
  const stableIds = new Map()
  const deterministic = String(svg).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, value => {
    const key = value.toLowerCase()
    if (!stableIds.has(key)) stableIds.set(key, `generated-${stableIds.size + 1}`)
    return stableIds.get(key)
  })
  return deterministic.replace(/(<svg\b[^>]*>)/, '$1<style>svg{background:#101820;color:#c7d5d9}g[data-entity-id]{color:#c7d5d9!important;stroke-width:.8!important}text{font-weight:500}</style>')
}

function normalizeKjdArtifact(kjd) {
  const stableIds = new Map()
  const normalizeId = value => {
    if (typeof value !== 'string') return value
    return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, uuid => {
      const key = uuid.toLowerCase()
      if (!stableIds.has(key)) {
        const sequence = String(stableIds.size + 1).padStart(12, '0')
        stableIds.set(key, `00000000-0000-4000-8000-${sequence}`)
      }
      return stableIds.get(key)
    }).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '2026-01-01T00:00:00.000Z')
  }
  const canonicalize = (value, parentKey = '') => {
    if (Array.isArray(value)) return value.map(item => canonicalize(item, parentKey))
    if (value && typeof value === 'object') {
      let entries = Object.entries(value)
      if (parentKey === 'objects') {
        entries = entries.sort(([, left], [, right]) => String(left?.handle ?? '').localeCompare(String(right?.handle ?? ''), undefined, { numeric: true }) || String(left?.kind ?? '').localeCompare(String(right?.kind ?? '')))
      } else {
        entries = entries.sort(([left], [right]) => left.localeCompare(right))
      }
      return Object.fromEntries(entries.map(([key, item]) => [normalizeId(key), canonicalize(item, key)]))
    }
    return normalizeId(value)
  }
  return JSON.stringify(canonicalize(JSON.parse(String(kjd)))).replace(/(\"digest\":\")([0-9a-f]+)(\")/gi, '$1000000000000000$3')
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
    const visibleSpaceId = entry.kind === 'specimen' && entry.id === 'a4-print-layout' ? document.snapshot().spaces.paperSpaceIds[0] : document.snapshot().spaces.modelSpaceId
    const entities = document.listEntities({ ownerId: visibleSpaceId })
    const entityTypes = Object.fromEntries([...new Set(entities.map(entity => entity.type))].sort().map(type => [type, entities.filter(entity => entity.type === type).length]))
    const rendered = specimen ? exportDrawingSvg(document, { layoutId: specimen.layoutId }) : null
    if (rendered) invariant(rendered.report.diagnostics.length === 0, `${entry.specimenId} SVG preview has diagnostics`)
    const thumbnail = rendered ? normalizeSpecimenPreview(rendered.svg) : renderThumbnail(document, entry)
    const sourceExcerpt = caseSourceExcerpt(await readFile(resolve(repositoryRoot, entry.source), 'utf8'), entry)
    const sourceSnippetPath = `showcase/assets/${entry.id}.source.txt`
    outputs.set(sourceSnippetPath, `// ${entry.source}#L${sourceExcerpt.startLine}-L${sourceExcerpt.endLine}\n// Case builder excerpt. Shared helpers and imports: use the repository source link.\n\n${sourceExcerpt.code}`)
    const thumbnailPath = `showcase/assets/${entry.id}.svg`
    outputs.set(thumbnailPath, thumbnail)
    outputs.set(`showcase/assets/${entry.id}.kjd`, normalizeKjdArtifact(await (specimen?.sdk ?? sdk).writeDocument(document, { format: 'KJD', version: '1' })))
    outputs.set(`showcase/assets/${entry.id}.dxf`, await (specimen?.sdk ?? sdk).writeDocument(document, { format: 'DXF', version: '2018' }))
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
        playground: `https://kanjieteam.github.io/kjdraw/?sample=${encodeURIComponent(entry.sampleId ?? `specimen-${entry.id}`)}`,
        detail: `./${entry.id}/`,
        preview: `./assets/${entry.id}.svg`,
        source: `https://github.com/KanJieTeam/kjdraw/blob/main/${entry.source}#L${sourceExcerpt.startLine}-L${sourceExcerpt.endLine}`, sourceSnippet: `./assets/${entry.id}.source.txt`,
      },
      artifact: {
        path: thumbnailPath,
        svgStatus: rendered?.report.status ?? 'generated-thumbnail',
        renderedEntities: rendered?.report.rendered ?? entities.length,
        diagnostics: rendered?.report.diagnostics.length ?? 0,
        revision: document.revision,
      },
      sourceRange: { symbol: sourceExcerpt.symbol, startLine: sourceExcerpt.startLine, endLine: sourceExcerpt.endLine },
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
  outputs.set('showcase/detail.js', showcaseDetailScript)
  outputs.set('showcase/detail.css', showcaseDetailStyle)
  for (const entry of entries) outputs.set(`showcase/${entry.id}/index.html`, renderShowcaseDetail(entry))
  return { catalogSource, manifest, outputs }
}

function localized(locale, value) {
  return escapeHtml(value?.[locale] ?? value?.en ?? '')
}

const showcaseDetailScript = `const html=document.documentElement,preview=document.getElementById('preview-tab'),sourceTab=document.getElementById('source-tab'),viewport=document.getElementById('viewport'),source=document.getElementById('source')
let locale=localStorage.getItem('kjdraw.docs.language')||(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')
function language(){html.dataset.locale=locale;html.lang=locale==='zh'?'zh-CN':'en';document.getElementById('language').textContent=locale==='zh'?'EN':'中文'}
document.getElementById('language').onclick=()=>{locale=locale==='zh'?'en':'zh';localStorage.setItem('kjdraw.docs.language',locale);language()};language()
function tab(showSource){source.hidden=!showSource;viewport.hidden=showSource;sourceTab.classList.toggle('active',showSource);preview.classList.toggle('active',!showSource);sourceTab.setAttribute('aria-selected',String(showSource));preview.setAttribute('aria-selected',String(!showSource))}
preview.onclick=()=>tab(false)
sourceTab.onclick=async()=>{tab(true);if(source.dataset.loaded)return;try{const sourcePath=document.querySelector('main.wrap').dataset.sourceSnippet;const response=await fetch(new URL(sourcePath,location.href));if(!response.ok)throw Error('Source unavailable');source.textContent=await response.text();source.dataset.loaded='true'}catch{source.textContent=locale==='zh'?'此处无法读取源码，请打开仓库源码链接。':'Source unavailable here. Open the repository source link.'}}
const frame=viewport.querySelector('iframe'),previewStatus=document.getElementById('preview-status'),previewLoading=previewStatus.querySelector('.preview-loading'),previewFailed=previewStatus.querySelector('.preview-failed')
let pollTimer,deadlineTimer,emptyFrameTimer
function clearPreviewTimers(){clearInterval(pollTimer);clearTimeout(deadlineTimer);clearTimeout(emptyFrameTimer)}
function previewFailure(){if(previewStatus.hidden)return;clearPreviewTimers();previewStatus.dataset.state='error';previewLoading.hidden=true;previewFailed.hidden=false}
function previewReady(){clearPreviewTimers();previewStatus.hidden=true}
function checkPreview(){try{const workbench=frame.contentDocument?.querySelector('.workbench');if(workbench?.dataset.demoState==='ready'){previewReady();return}if(workbench?.dataset.lastError)previewFailure()}catch{previewFailure()}}
function watchPreview(){clearPreviewTimers();previewStatus.hidden=false;previewStatus.dataset.state='loading';previewLoading.hidden=false;previewFailed.hidden=true;pollTimer=setInterval(checkPreview,250);deadlineTimer=setTimeout(previewFailure,45000);checkPreview()}
frame.addEventListener('load',()=>{checkPreview();emptyFrameTimer=setTimeout(()=>{try{if(!previewStatus.hidden&&!frame.contentDocument?.querySelector('.workbench'))previewFailure()}catch{previewFailure()}},1500)})
frame.addEventListener('error',previewFailure)
document.getElementById('preview-retry').onclick=()=>{watchPreview();frame.src=frame.src}
watchPreview()
document.getElementById('fullscreen').onclick=()=>document.querySelector('.workspace').requestFullscreen?.()
`

const showcaseDetailStyle = `
:root{font-family:Inter,"Noto Sans SC","Segoe UI",Arial,sans-serif;color:#17212b;background:#fff;font-synthesis:none}
*{box-sizing:border-box}body{margin:0}a{color:inherit;text-decoration:none}button{font:inherit;cursor:pointer}
header.site{height:54px;display:flex;align-items:center;gap:22px;padding:0 24px;border-bottom:1px solid #e7e9ed}
.brand{font-size:17px;font-weight:750;letter-spacing:-.04em}.brand i{display:inline-grid;place-items:center;width:25px;height:25px;margin-right:8px;border-radius:5px;background:#bdf878;color:#163218;font-style:normal}
header.site nav{display:flex;gap:18px;color:#5d6673;font-size:13px}header.site .right{margin-left:auto;display:flex;align-items:center;gap:18px;font-size:13px}
.wrap{max-width:1680px;margin:auto;padding:26px 24px 60px}.crumb{display:flex;gap:8px;color:#727d89;font-size:12px}.crumb a:hover,.links a:hover{color:#2761d8}
.heading{display:flex;align-items:start;gap:24px;margin:19px 0 22px}.heading>div{flex:1}.eyebrow{margin:0 0 7px;color:#42734a;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
h1{margin:0 0 9px;font-size:32px;line-height:1.18;letter-spacing:-.04em}.summary{max-width:780px;margin:0;color:#66717d;font-size:14px;line-height:1.6}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}.meta span{padding:5px 9px;border:1px solid #e4e8ee;border-radius:5px;color:#566272;font-size:11px}
.heading>a{padding:9px 13px;border:1px solid #dce2e8;border-radius:6px;font-size:12px}.heading>a:hover{border-color:#9ebad3}
.workspace{border:1px solid #dfe4e9;border-radius:8px;overflow:hidden;background:#f7f9fa}.workspace-bar,.tabs{display:flex;align-items:center;gap:18px;padding:0 14px;border-bottom:1px solid #e1e5e9;background:#fff}
.workspace-bar{min-height:38px;justify-content:space-between;font-size:12px}.live:before{content:"";display:inline-block;width:6px;height:6px;margin-right:7px;border-radius:50%;background:#26ae54}
.links{display:flex;gap:16px}.tabs{height:38px;gap:5px}.tabs button{height:100%;padding:0 12px;border:0;border-bottom:2px solid transparent;background:transparent;color:#65717e;font-size:12px}.tabs button.active{border-bottom-color:#17212b;color:#17212b;font-weight:650}
.viewport{height:min(72vh,850px);min-height:480px;background:#111920}.viewport iframe{display:block;width:100%;height:100%;border:0}
.viewport{position:relative}.preview-status{position:absolute;z-index:2;inset:0;display:grid;place-items:center;padding:24px;background:#111920;color:#e9f0ed;text-align:center;pointer-events:none}.preview-status[data-state="error"]{pointer-events:auto}.preview-status-content{max-width:420px}.preview-status-dot{display:block;width:7px;height:7px;margin:0 auto 14px;border-radius:50%;background:#bdf878}.preview-status p{margin:0;font-size:14px;line-height:1.6}.preview-failed>div{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:18px}.preview-failed button,.preview-failed a{display:inline-flex;align-items:center;min-height:34px;padding:7px 12px;border:1px solid #84968b;border-radius:5px;background:transparent;color:#e9f0ed;font-size:12px;text-decoration:none}.preview-failed button:hover,.preview-failed a:hover,.preview-failed button:focus-visible,.preview-failed a:focus-visible{border-color:#bdf878;color:#bdf878;outline:0}.source{height:min(72vh,850px);min-height:480px;margin:0;padding:22px;overflow:auto;background:#101722;color:#dbe8ef;font:12px/1.7 Consolas,monospace}
.foot{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:16px 2px;color:#66717d;font-size:12px}.provenance{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.provenance a{color:#245b46;text-decoration:underline;text-underline-offset:3px}.facts{display:flex;flex-wrap:wrap;gap:6px}.facts span{padding:4px 7px;border:1px solid #e2e7ea;border-radius:4px;white-space:nowrap}.facts b{color:#303a46}
[hidden]{display:none!important}html[data-locale="zh"] .en,html:not([data-locale="zh"]) .zh{display:none!important}
@media(max-width:700px){header.site{padding:0 14px}header.site nav{display:none}.wrap{padding:20px 12px 35px}.heading{display:block}.heading>a{display:inline-block;margin-top:14px}h1{font-size:25px}.viewport,.source{height:70vh;min-height:440px}.workspace-bar{gap:7px}.links{gap:8px}}
`

function renderShowcaseDetail(entry) {
  const sample = encodeURIComponent(entry.sampleId ?? `specimen-${entry.id}`)
  const root = '../../../../'
  const workspaceQuery = '?sample=' + sample + '&layout=focus' + (entry.id === 'a4-print-layout' ? '&space=paper' : '')
  const facts = Object.entries(entry.facts.entityTypes).map(([type, count]) => `<span>${escapeHtml(type)} <b>${count}</b></span>`).join('')
  return `<!doctype html>
<html lang="en" data-locale="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(entry.summary.en)}">
  <title>${escapeHtml(entry.title.en)} · KJDraw Showcase</title>
  <link rel="icon" href="../../../../docs/assets/mark.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../detail.css">
</head>
<body>
  <header class="site"><a class="brand" href="${root}"><i>K</i>KJDraw</a><nav><a href="../">Showcase</a><a href="../../quickstart/">Docs</a><a href="../../api/">API</a></nav><div class="right"><a href="https://github.com/KanJieTeam/kjdraw">GitHub</a><button id="language" type="button">中文</button></div></header>
  <main class="wrap" data-source-snippet="../assets/${escapeHtml(entry.id)}.source.txt">
    <div class="crumb"><a href="../">Showcase</a><span>›</span><span class="en">${escapeHtml(entry.categoryTitle.en)}</span><span class="zh">${escapeHtml(entry.categoryTitle.zh)}</span><span>›</span><span class="en">${escapeHtml(entry.title.en)}</span><span class="zh">${escapeHtml(entry.title.zh)}</span></div>
    <div class="heading"><div><p class="eyebrow"><span class="en">${escapeHtml(entry.drawingType.en)}</span><span class="zh">${escapeHtml(entry.drawingType.zh)}</span></p><h1><span class="en">${escapeHtml(entry.title.en)}</span><span class="zh">${escapeHtml(entry.title.zh)}</span></h1><p class="summary"><span class="en">${escapeHtml(entry.summary.en)}</span><span class="zh">${escapeHtml(entry.summary.zh)}</span></p><div class="meta"><span>${entry.facts.editableObjects.toLocaleString()} <span class="en">editable objects</span><span class="zh">可编辑对象</span></span><span>${entry.facts.layers} <span class="en">layers</span><span class="zh">图层</span></span><span>${escapeHtml(entry.facts.units)}</span></div></div><a href="../"><span class="en">Browse examples</span><span class="zh">浏览案例</span> →</a></div>
    <section class="workspace" aria-label="Interactive KJDraw workspace"><div class="workspace-bar"><b class="live"><span class="en">Live workspace</span><span class="zh">实时工作区</span></b><div class="links"><a href="${root}${escapeHtml(workspaceQuery)}" target="_blank" rel="noopener"><span class="en">Open Playground</span><span class="zh">打开工作台</span> ↗</a><a href="../assets/${escapeHtml(entry.id)}.kjd" download>KJD ↓</a><a href="../assets/${escapeHtml(entry.id)}.dxf" download>DXF ↓</a><button id="fullscreen" type="button"><span class="en">Fullscreen</span><span class="zh">全屏</span></button></div></div><div class="tabs" role="tablist"><button id="preview-tab" class="active" type="button" role="tab" aria-selected="true"><span class="en">Interactive drawing</span><span class="zh">交互图纸</span></button><button id="source-tab" type="button" role="tab" aria-selected="false"><span class="en">Source code</span><span class="zh">源码</span></button></div><div class="viewport" id="viewport"><div class="preview-status" id="preview-status" data-state="loading" role="status" aria-live="polite"><div class="preview-status-content"><span class="preview-status-dot" aria-hidden="true"></span><p class="preview-loading"><span class="en">Loading editable workspace…</span><span class="zh">正在载入可编辑工作区…</span></p><div class="preview-failed" hidden><p><span class="en">The workspace did not open.</span><span class="zh">工作区未能打开。</span></p><div><button id="preview-retry" type="button"><span class="en">Retry</span><span class="zh">重试</span></button><a href="${root}${escapeHtml(workspaceQuery)}" target="_blank" rel="noopener"><span class="en">Open full workspace</span><span class="zh">打开完整工作区</span> ↗</a></div></div></div></div><iframe src="${root}${escapeHtml(workspaceQuery)}" title="${escapeHtml(entry.title.en)} editable CAD workspace" loading="eager"></iframe></div><pre class="source" id="source" hidden>Loading source…</pre></section>
    <div class="foot"><div class="provenance"><span class="en">Public synthetic example · not measured project data</span><span class="zh">公开示例图纸 · 非实测项目数据</span><a href="${escapeHtml(entry.links.source)}" target="_blank" rel="noopener"><span class="en">View generating source</span><span class="zh">查看生成源码</span> ↗</a><span><span class="en">Revision</span><span class="zh">版本</span> ${entry.artifact.revision}</span></div><div class="facts" aria-label="Entity types">${facts}</div></div>
  </main>
  <script type="module" src="../detail.js"></script>
</body></html>\n`
}

export function renderShowcasePortal(manifest, locale) {
  const text = locale === 'zh' ? {
    all: '全部案例', search: '搜索图纸、对象或工作流', tag: '全部标签', grid: '网格', list: '列表',
    objects: '可编辑对象', layers: '图层', source: '查看源码', playground: '打开案例', preview: '打开案例', detail: '验证详情', types: '图元事实', empty: '没有匹配的案例。', shown: '个案例',
  } : {
    all: 'All examples', search: 'Search drawings, objects or workflows', tag: 'All tags', grid: 'Grid', list: 'List',
    objects: 'editable objects', layers: 'layers', source: 'Source', playground: 'Open case', preview: 'Open case', detail: 'Verified details', types: 'Entity facts', empty: 'No matching examples.', shown: 'examples',
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
    const thumbnailHref = entry.links.detail
    const entityFacts = Object.entries(entry.facts.entityTypes).map(([type, count]) => `<span><b>${escapeHtml(type)}</b> ${count}</span>`).join('')
    const primary = `<a class="primary" href="${escapeHtml(entry.links.detail)}">${escapeHtml(text.playground)} →</a>`
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
