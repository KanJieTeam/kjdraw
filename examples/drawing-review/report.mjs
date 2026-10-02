import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createKJDrawSDK, exportDrawingSvg } from '../../packages/kjdraw-sdk/src/index.js'
import { captureDrawing, checkDrawing, compareDrawings, normalizeOptions } from './analysis.mjs'

const html = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
export function csvCell(value) {
  let text = String(value ?? '')
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export async function readDrawing(file, options) {
  const format = path.extname(file).slice(1).toUpperCase()
  if (!['DXF', 'KJD'].includes(format)) throw new Error('Input must be ASCII DXF or KJD; convert DWG locally before review')
  const info = await stat(file)
  if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('Input must be a regular file within the 64 MiB host read limit')
  const buffer = await readFile(file)
  if (buffer.length > 64 * 1024 * 1024) throw new Error('Input exceeds the 64 MiB host read limit')
  const sdk = createKJDrawSDK()
  // DXF adapter owns decoding; passing bytes preserves legacy code-page handling.
  const document = await sdk.readDocument(format === 'KJD' ? buffer.toString('utf8') : buffer, { format, maxBytes: 64 * 1024 * 1024, maxEntities: options.maxEntities })
  return { sdk, document, source: { name: path.basename(file), format, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') } }
}

function coordinateHintWindow(entities) {
  const points = []
  const visit = (value, key = '') => {
    if (Array.isArray(value)) {
      if (/^(start|end|center|position|alignmentPoint|textPosition|point|vertices|definitionPoints|controlPoints|fitPoints)$/u.test(key) && value.length >= 2 && value.length <= 3 && value.every(Number.isFinite)) points.push(value)
      else for (const child of value) visit(child, key)
    } else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) visit(child, name)
  }
  for (const entity of entities) {
    visit(entity.payload)
    const { center, radius } = entity.payload
    if (Array.isArray(center) && center.slice(0, 2).every(Number.isFinite) && Number.isFinite(radius)) points.push([center[0] - radius, center[1] - radius], [center[0] + radius, center[1] + radius])
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of points) { minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]); maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]) }
  if (!points.length) return [-10, -10, 100, 100]
  const margin = Math.max(maxX - minX, maxY - minY, 1) * 0.12
  return [minX - margin, minY - margin, maxX + margin, maxY + margin]
}

async function previewDrawing(opened, options) {
  const original = opened.document, preview = original.fork(), layouts = original.spaces.layoutIds.map(id => original.getObject(id))
    .filter(layout => options.scope === 'all' || options.scope === 'model' && layout.payload.blockRecordId === original.spaces.modelSpaceId || options.scope === `layout:${layout.name}`)
  const result = []
  for (const layout of layouts) {
    const owner = layout.payload.blockRecordId, entities = original.listEntities({ ownerId: owner })
    const window = options.window ?? coordinateHintWindow(entities)
    try {
      // A detached preview receives host-selected plotting settings; the source,
      // its original plot setup, units, revision and object graph stay unchanged.
      await opened.sdk.executeCommand('PLOTSETUP', { layoutId: layout.id, dxf: {
        paperWidth: 420, paperHeight: 297, paperUnits: 1, marginLeft: 8, marginRight: 8, marginTop: 8, marginBottom: 8,
        windowMinX: window[0], windowMinY: window[1], windowMaxX: window[2], windowMaxY: window[3],
        plotType: 4, flags: 20, standardScaleType: 0, originX: 0, originY: 0,
        styleSheet: '', printerName: '', shadeMode: 0, rotation: 0,
      } }, { document: preview })
      const output = exportDrawingSvg(preview, { layoutId: layout.id, allowPartial: true, maxEntities: options.maxEntities })
      result.push({ layoutName: layout.name, ownerId: owner, window, windowPolicy: options.window ? 'caller-explicit' : 'coordinate-hints-only',
        windowWarning: options.window ? null : 'Automatic window uses stored coordinate hints, not a certified drawing extent. INSERT expansion, text bounds and projected paper viewports may be clipped. Supply --window for a reviewed extent.',
        report: output.report, svg: output.svg })
    } catch (error) {
      result.push({ layoutName: layout.name, ownerId: owner, window, windowPolicy: options.window ? 'caller-explicit' : 'coordinate-hints-only', report: { status: 'unavailable', reason: error.message }, svg: null })
    }
  }
  return result
}

export async function reviewDrawingFiles({ before, after, ...inputOptions }) {
  const options = normalizeOptions(inputOptions)
  if (!before) throw new Error('A before input is required')
  const openedBefore = await readDrawing(before, options), capturedBefore = captureDrawing(openedBefore.document, options)
  const fingerprintBefore = openedBefore.document.fingerprint(), revisionBefore = openedBefore.document.revision
  const openedAfter = after ? await readDrawing(after, options) : null
  const capturedAfter = openedAfter && captureDrawing(openedAfter.document, options)
  const fingerprintAfter = openedAfter?.document.fingerprint(), revisionAfter = openedAfter?.document.revision
  const drawings = [{ side: 'before', source: openedBefore.source, documentId: capturedBefore.documentId, revision: capturedBefore.revision,
    declaredUnits: capturedBefore.declaredUnits, assertedUnits: options.units,
    unitWarning: capturedBefore.declaredUnits !== options.units ? 'Caller units disagree with the imported header. Coordinates are not converted.' : null,
    coverage: capturedBefore.coverage, validation: capturedBefore.validation, checks: checkDrawing(capturedBefore, options), previews: await previewDrawing(openedBefore, options) }]
  if (openedAfter) drawings.push({ side: 'after', source: openedAfter.source, documentId: capturedAfter.documentId, revision: capturedAfter.revision,
    declaredUnits: capturedAfter.declaredUnits, assertedUnits: options.units,
    unitWarning: capturedAfter.declaredUnits !== options.units ? 'Caller units disagree with the imported header. Coordinates are not converted.' : null,
    coverage: capturedAfter.coverage, validation: capturedAfter.validation, checks: checkDrawing(capturedAfter, options), previews: await previewDrawing(openedAfter, options) })
  if (openedBefore.document.fingerprint() !== fingerprintBefore || openedBefore.document.revision !== revisionBefore || openedAfter && (openedAfter.document.fingerprint() !== fingerprintAfter || openedAfter.document.revision !== revisionAfter)) throw new Error('Read-only review unexpectedly mutated an input document')
  return { schema: 'kjdraw-example-drawing-review@1', mode: 'read-only', options,
    limitations: ['Findings are observations, not repair approvals or manufacturing certification.', 'Semantic diff excludes runtime IDs, handles, source/raw DXF tags and opaque document/binary data.', 'Resources are reviewed globally; entity checks obey the selected scope/layers. Preview includes owner context, including layers excluded from checks.', 'No DWG conversion, automatic repair or model invocation occurs in this example.'],
    drawings, comparison: capturedAfter ? compareDrawings(capturedBefore, capturedAfter, options) : null }
}

export function reportRows(report) {
  const rows = []
  for (const drawing of report.drawings) {
    for (const finding of drawing.checks.findings) rows.push({ status: finding.code, side: drawing.side, message: finding.message, targets: [{ side: drawing.side, ids: finding.entities.map(entity => entity.id) }], entities: finding.entities })
    for (const entity of drawing.coverage.unsupported) rows.push({ status: 'unsupported', side: drawing.side, message: entity.reason, targets: [{ side: drawing.side, ids: [entity.id] }], entities: [entity] })
  }
  if (report.comparison) {
    for (const pair of report.comparison.pairs.filter(pair => pair.status === 'modified')) rows.push({ status: 'modified', side: 'both', message: `${pair.matchedBy}: ${pair.fields.join(', ')}`,
      targets: [{ side: 'before', ids: [pair.before.id] }, { side: 'after', ids: [pair.after.id] }], entities: [pair.before, pair.after] })
    for (const [side, entities] of [['before', report.comparison.unmatchedBefore], ['after', report.comparison.unmatchedAfter]]) for (const entity of entities) rows.push({ status: 'unmatched', side,
      message: 'No safe correspondence found; this may be an addition/removal or an unpaired edit.', targets: [{ side, ids: [entity.id] }], entities: [entity] })
    for (const group of report.comparison.ambiguous) rows.push({ status: 'ambiguous', side: 'both', message: `${group.matchedBy}: ${group.reason}`,
      targets: [{ side: 'before', ids: group.before.map(entity => entity.id) }, { side: 'after', ids: group.after.map(entity => entity.id) }], entities: [...group.before, ...group.after] })
    for (const resource of report.comparison.resources) rows.push({ status: `resource-${resource.status}`, side: 'both', message: `${resource.logicalKey}: ${(resource.fields ?? []).join(', ')}${resource.reason ?? ''}`, targets: [], entities: [] })
  }
  return rows
}

export function renderCsv(report) {
  return [['status', 'side', 'message', 'entity_ids', 'handles', 'owners', 'layers'], ...reportRows(report).map(row => [row.status, row.side, row.message,
    row.entities.map(entity => entity.id).join(';'), row.entities.map(entity => entity.handle).join(';'), row.entities.map(entity => entity.owner).join(';'), row.entities.map(entity => entity.layer).join(';')])]
    .map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

function inlineSvg(svg, prefix) {
  // SVG definitions have document-wide IDs in inline HTML. Keep A/B windows,
  // hatch patterns and viewport clips independent without changing CAD IDs.
  const ids = new Map([...svg.matchAll(/\sid="([^"]+)"/gu)].map(match => [match[1], `${prefix}-${match[1]}`]))
  return svg.replace(/^<\?xml[^?]*\?>\s*/u, '')
    .replace(/\sid="([^"]+)"/gu, (_, id) => ` id="${ids.get(id)}"`)
    .replace(/url\(#([^)]*)\)/gu, (value, id) => ids.has(id) ? `url(#${ids.get(id)})` : value)
}

const SCRIPT = `const rows=JSON.parse(document.getElementById('review-data').textContent);
const selected=[];const views=new Map();document.querySelectorAll('svg').forEach(svg=>views.set(svg,svg.getAttribute('viewBox')));
function clear(){for(const el of selected)el.classList.remove('selected');selected.length=0;document.querySelectorAll('.focus-marker').forEach(el=>el.remove());for(const [svg,view] of views)svg.setAttribute('viewBox',view);}
function focus(row){clear();let first=null;const matched=new Set();const groupsBySvg=new Map();
for(const target of row.targets){const targetIds=new Set(target.ids);for(const panel of document.querySelectorAll('[data-side]')){if(panel.dataset.side!==target.side)continue;
for(const el of panel.querySelectorAll('[data-entity-id]')){if(!targetIds.has(el.getAttribute('data-entity-id'))||matched.has(el))continue;matched.add(el);el.classList.add('selected');selected.push(el);if(!first)first=el;const svg=el.ownerSVGElement;if(svg){const groups=groupsBySvg.get(svg)||[];groups.push(el);groupsBySvg.set(svg,groups);}}}}
const found=selected.length;
document.getElementById('focus-status').textContent=found?'Highlighted '+found+' rendered groups.':'No rendered group in the selected previews; check coverage, hidden layers and preview window.';
for(const [svg,groups] of groupsBySvg){let minimumX=Infinity,minimumY=Infinity,maximumX=-Infinity,maximumY=-Infinity;const zeroPoints=[];
for(const el of groups){try{const box=el.getBBox();const transform=svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
const corners=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(p=>new DOMPoint(...p).matrixTransform(transform));
if(!corners.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)))continue;
const x=Math.min(...corners.map(p=>p.x)),y=Math.min(...corners.map(p=>p.y)),right=Math.max(...corners.map(p=>p.x)),bottom=Math.max(...corners.map(p=>p.y));
minimumX=Math.min(minimumX,x);minimumY=Math.min(minimumY,y);maximumX=Math.max(maximumX,right);maximumY=Math.max(maximumY,bottom);if(right===x&&bottom===y)zeroPoints.push([x,y]);}catch{}}
if(Number.isFinite(minimumX+minimumY+maximumX+maximumY)){const w=maximumX-minimumX,h=maximumY-minimumY,margin=Math.max(w,h,5)*0.4;svg.setAttribute('viewBox',[minimumX-margin,minimumY-margin,w+2*margin,h+2*margin].join(' '));
for(const [x,y] of zeroPoints){const marker=document.createElementNS('http://www.w3.org/2000/svg','circle');marker.classList.add('focus-marker');marker.setAttribute('cx',x);marker.setAttribute('cy',y);marker.setAttribute('r','1');marker.setAttribute('fill','#ef7c00');svg.append(marker);}}}
if(first)first.closest('.preview').scrollIntoView({block:'nearest'});}
document.querySelectorAll('[data-row]').forEach(button=>button.addEventListener('click',()=>focus(rows[Number(button.dataset.row)])));
document.getElementById('reset').addEventListener('click',()=>{clear();document.getElementById('focus-status').textContent='Preview reset.';});
document.getElementById('filter').addEventListener('input',event=>{const term=event.target.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(term));});`

export function renderHtml(report) {
  const rows = reportRows(report), hash = createHash('sha256').update(SCRIPT).digest('base64')
  const decodeAttribute = value => value.replace(/&(amp|lt|gt|quot|apos);/gu, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name])
  const rendered = new Map(report.drawings.map(drawing => [drawing.side, new Set(drawing.previews.flatMap(preview => [...(preview.svg ?? '').matchAll(/data-entity-id="([^"]*)"/gu)].map(match => decodeAttribute(match[1]))))]))
  const canLocate = row => row.targets.some(target => target.ids.some(id => rendered.get(target.side)?.has(id)))
  const unitWarnings = report.drawings.filter(drawing => drawing.unitWarning)
  const unitBanner = unitWarnings.length ? `<aside class="policy" role="status"><strong>Unit mismatch</strong><p>${unitWarnings.map(drawing => `${html(drawing.side)}: declared ${html(drawing.declaredUnits)}, caller asserted ${html(drawing.assertedUnits)}.`).join(' ')}</p><p>Stored coordinate comparison only; no unit conversion is performed and no physical equivalence is claimed.</p></aside>` : ''
  const coverage = report.drawings.map(drawing => `<details class="source-details"><summary>${html(drawing.side)} source: ${html(drawing.source.name)}</summary><p>SHA-256: <code>${html(drawing.source.sha256)}</code></p><p>Imported ${drawing.coverage.totalImportedEntities}; selected ${drawing.coverage.selectedEntities}; excluded ${drawing.coverage.excludedEntities}. Zero-line checked ${drawing.checks.checkedZeroLines}; duplicate checked ${drawing.checks.checkedDuplicates}; findings omitted ${drawing.checks.omittedFindings}. ${html(drawing.unitWarning)}</p><details><summary>Coverage and import validation</summary><pre>${html(JSON.stringify({ coverage: drawing.coverage, validation: drawing.validation }, null, 2))}</pre></details></details>`).join('')
  const previews = report.drawings.map(drawing => `<section data-side="${html(drawing.side)}"><h2>${html(drawing.side)}: ${html(drawing.source.name)}</h2>${drawing.previews.map((preview, index) => `<div class="preview"><h3>${html(preview.layoutName)}</h3><p>${html(preview.windowWarning)} Status: ${html(preview.report.status)}</p><details><summary>SVG coverage</summary><pre>${html(JSON.stringify(preview.report, null, 2))}</pre></details>${preview.svg ? inlineSvg(preview.svg, `${drawing.side}-${index + 1}`) : `<p>${html(preview.report.reason)}</p>`}</div>`).join('')}</section>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'"><title>KJDraw drawing review</title><style>body{font:15px system-ui,sans-serif;margin:24px;background:#f6f7f9;color:#17212d}h1,h2,h3{line-height:1.2}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}section,.preview{background:white;padding:16px;border:1px solid #ccd4df;border-radius:8px;margin:12px 0}.previews{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(380px,100%),1fr));gap:16px}.previews>section{min-width:0}.preview{min-width:0}.source-details{padding:12px;background:white;border:1px solid #ccd4df;margin:12px 0}.preview svg{width:100%;height:auto;min-height:240px;max-height:65vh;background:white}.selected,.selected *{stroke:#ef7c00!important;stroke-width:0.8!important}table{border-collapse:collapse;width:100%;background:white;table-layout:fixed}th:last-child{width:100px}td,th{border:1px solid #d5dce5;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}button,input{font:inherit;padding:7px}button{white-space:nowrap}input{width:260px}li{margin:5px 0}.policy{border-left:4px solid #bf7c00;padding-left:12px}#focus-status{min-height:20px}@media(max-width:600px){body{margin:12px}.previews{display:block}section,.preview{padding:10px}input{max-width:100%;box-sizing:border-box}td,th{font-size:12px;padding:5px}th:last-child{width:62px}button{padding:5px;font-size:12px}h2{overflow-wrap:anywhere}.preview svg{min-height:180px}}</style></head><body><h1>KJDraw drawing review</h1><p>Read-only · ${html(report.options.scope)} · asserted units ${html(report.options.units)} · identity ${html(report.options.identity)}</p>${unitBanner}<p class="policy">Review observations require human interpretation. No input is modified.</p>${report.comparison ? `<p>Matched unchanged ${report.comparison.counts.unchanged}; modified ${report.comparison.counts.modified}; unmatched before ${report.comparison.counts.unmatchedBefore}; unmatched after ${report.comparison.counts.unmatchedAfter}; ambiguity groups ${report.comparison.counts.ambiguousGroups}.</p><p>${html(report.comparison.interpretation)}</p>` : ''}<div class="previews">${previews}</div><h2>Findings and changes</h2><label>Filter <input id="filter" type="search" placeholder="code, layer, handle or change"></label> <button id="reset" type="button">Reset previews</button><p id="focus-status" aria-live="polite">Click Locate to highlight rendered objects in the SDK previews. Hidden, unsupported or absent groups cannot be located here.</p><table><thead><tr><th>Status / side</th><th>Observation</th><th>Objects</th><th>Locate</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td>${html(row.status)} / ${html(row.side)}</td><td>${html(row.message)}</td><td>${row.entities.map(entity => `${html(entity.type)} · handle ${html(entity.handle)} · ${html(entity.owner)} · ${html(entity.layer)}`).join('<br>')}</td><td>${canLocate(row) ? `<button type="button" data-row="${index}">Locate</button>` : row.targets.length ? 'Not rendered in these previews' : 'Resource record'}</td></tr>`).join('')}</tbody></table>${rows.length ? '' : '<p>No findings within the implemented checks. See coverage before drawing conclusions.</p>'}<h2>Source and coverage details</h2>${coverage}<details><summary>Interpretation and technical limits</summary><ul>${report.limitations.map(limit => `<li>${html(limit)}</li>`).join('')}</ul></details><script id="review-data" type="application/json">${json(rows)}</script><script>${SCRIPT}</script></body></html>`
}

export async function writeReviewReport(report, outputDirectory) {
  const page = renderHtml(report)
  if (Buffer.byteLength(page, 'utf8') > 32 * 1024 * 1024) throw new Error('HTML report exceeds the 32 MiB host output limit; narrow the scope or findings budget')
  await mkdir(outputDirectory, { recursive: true })
  // Stable filenames are generated by the host, never from untrusted CAD names.
  for (const drawing of report.drawings) for (const [index, preview] of drawing.previews.entries()) {
    if (preview.svg) { preview.file = `${drawing.side}-${index + 1}.svg`; await writeFile(path.join(outputDirectory, preview.file), preview.svg, 'utf8') }
  }
  await writeFile(path.join(outputDirectory, 'report.html'), page, 'utf8')
  await writeFile(path.join(outputDirectory, 'findings.csv'), renderCsv(report), 'utf8')
  const detached = structuredClone(report)
  for (const drawing of detached.drawings) for (const preview of drawing.previews) delete preview.svg
  await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify(detached, null, 2) + '\n', 'utf8')
  return path.resolve(outputDirectory, 'report.html')
}
