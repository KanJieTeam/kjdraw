#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { KJDRAW_VERSION } from '../src/version.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { displayedEntityBounds } from '../src/selection-geometry.js'

const SERVER_NAME = '@kanjieteam/kjdraw-mcp'
const PROTOCOL_VERSION = '2025-11-25'
const SUPPORTED_PROTOCOLS = new Set([PROTOCOL_VERSION, '2025-06-18'])
const MAX_DRAWING_BYTES = 64 * 1024 * 1024
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024
const MAX_KNOWLEDGE_PACK_BYTES = 1024 * 1024

function usage() {
  return `Usage:\n  kjdraw-mcp --workspace <directory> --input <drawing.kjd|drawing.dxf> --proposals <pending.json>\n  kjdraw-mcp --workspace <directory> --input <drawing.kjd|drawing.dxf> --proposal-dir <existing-relative-directory> [--candidate-dir <existing-relative-directory>]\n  kjdraw-mcp --workspace <directory> --blank <new-drawing.kjd> --units <millimeter|meter> --proposals <pending.json>\n  kjdraw-mcp --workspace <directory> --blank <new-drawing.kjd> --units <millimeter|meter> --proposal-dir <existing-relative-directory> [--candidate-dir <existing-relative-directory>]\n\nOptional host-only geology style binding:\n  --geology-column-pack <existing-relative.json> --geology-column-pack-sha256 <64-lowercase-hex>\n\n--proposals is the legacy one-file mode. --proposal-dir creates one exclusive ledger per stdio session. When the host also supplies --candidate-dir, exact CREATEBATCH proposals are materialized into new KJD/DXF/SVG candidate files there; the input drawing is never overwritten. The model cannot choose either path or approve writes to the input.`
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  if (argv.includes('--version') || argv.includes('-v')) return { version: true }
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1]
    if (!['--workspace', '--input', '--blank', '--units', '--proposals', '--proposal-dir', '--candidate-dir', '--geology-column-pack', '--geology-column-pack-sha256'].includes(key) || !value || Object.hasOwn(values, key.slice(2))) throw new Error(`Unknown, duplicate or incomplete argument: ${key ?? ''}`)
    values[key.slice(2)] = value
  }
  if (!values.workspace) throw new Error('Missing required --workspace')
  if (Boolean(values.proposals) === Boolean(values['proposal-dir'])) throw new Error('Supply exactly one of --proposals or --proposal-dir')
  if (values['candidate-dir'] && !values['proposal-dir']) throw new Error('--candidate-dir requires --proposal-dir')
  if (Boolean(values.input) === Boolean(values.blank)) throw new Error('Supply exactly one of --input or --blank')
  if (values.blank && !['millimeter', 'meter'].includes(values.units)) throw new Error('--blank requires --units millimeter or meter')
  if (values.input && values.units) throw new Error('--units is only allowed with --blank')
  if (Boolean(values['geology-column-pack']) !== Boolean(values['geology-column-pack-sha256'])) throw new Error('--geology-column-pack and --geology-column-pack-sha256 must be supplied together')
  if (values['geology-column-pack-sha256'] && !/^[a-f0-9]{64}$/u.test(values['geology-column-pack-sha256'])) throw new Error('--geology-column-pack-sha256 must be 64 lowercase hexadecimal characters')
  return values
}

function assertRelativePath(value, label) {
  if (isAbsolute(value) || value.split(/[\\/]+/u).includes('..')) throw new Error(`${label} must be a path inside --workspace`)
}

function isInside(root, candidate) {
  const part = relative(root, candidate)
  return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part))
}

async function resolveExistingInside(root, value, label) {
  assertRelativePath(value, label)
  const candidate = await realpath(resolve(root, value))
  if (!isInside(root, candidate)) throw new Error(`${label} resolves outside --workspace`)
  return candidate
}

async function resolveRegularFileWithoutLinks(root, value, label) {
  assertRelativePath(value, label)
  if (!value || /^[A-Za-z]:/u.test(value)) throw new Error(`${label} must be an unambiguous project-relative path`)
  const parts = value.split(/[\\/]+/u)
  if (!parts.length || parts.some(part => !part || part === '.')) throw new Error(`${label} must be an unambiguous project-relative path`)
  let current = root
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link`)
    if (index === parts.length - 1 ? !info.isFile() : !info.isDirectory()) throw new Error(`${label} must name a regular file under real directories`)
  }
  const canonical = await realpath(current)
  if (!isInside(root, canonical) || !samePath(canonical, current)) throw new Error(`${label} resolves outside its real workspace path`)
  return canonical
}

async function resolveOutputInside(root, value) {
  assertRelativePath(value, '--proposals')
  const candidate = resolve(root, value)
  const parent = await realpath(dirname(candidate))
  if (!isInside(root, parent)) throw new Error('--proposals resolves outside --workspace')
  return resolve(parent, basename(candidate))
}

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

async function resolveVacantFileInside(root, value, label) {
  assertRelativePath(value, label)
  const parts = value.split(/[\\/]+/u)
  if (!parts.length || parts.some(part => !part || part === '.')) throw new Error(`${label} must be an unambiguous relative file path`)
  let parent = root
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part)
    const entry = await lstat(parent)
    if (entry.isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link`)
    if (!entry.isDirectory()) throw new Error(`${label} parent must be a directory`)
  }
  const candidate = resolve(parent, parts.at(-1))
  if (!isInside(root, candidate)) throw new Error(`${label} resolves outside --workspace`)
  try {
    await lstat(candidate)
    throw new Error(`${label} target already exists`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return candidate
}

async function resolveSessionLedgerDir(root, value) {
  assertRelativePath(value, '--proposal-dir')
  if (!value || /^[A-Za-z]:/u.test(value)) throw new Error('--proposal-dir must be an unambiguous relative directory')
  const parts = value.split(/[\\/]+/u)
  if (!parts.length || parts.some(part => !part || part === '.')) throw new Error('--proposal-dir must be an unambiguous relative directory')
  let current = root
  for (const part of parts) {
    current = join(current, part)
    const entry = await lstat(current)
    if (entry.isSymbolicLink()) throw new Error('--proposal-dir must not traverse a symbolic link')
    if (!entry.isDirectory()) throw new Error('--proposal-dir must name an existing directory')
  }
  const canonical = await realpath(current)
  if (!isInside(root, canonical) || !samePath(canonical, current)) throw new Error('--proposal-dir resolves outside its real workspace path')
  return canonical
}

function fingerprint(document) {
  return createHash('sha256').update(JSON.stringify(document.serialize())).digest('hex')
}

async function atomicJsonWrite(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

async function exclusiveAtomicJsonCreate(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await link(temporary, path)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

async function exclusiveAtomicFileCreate(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, value, { flag: 'wx' })
    await link(temporary, path)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

async function * boundedMessages(stream) {
  let pieces = [], length = 0, discarding = false
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    let offset = 0
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset)
      const end = newline === -1 ? chunk.length : newline
      const piece = chunk.subarray(offset, end)
      if (!discarding) {
        if (length + piece.length > MAX_MESSAGE_BYTES) {
          pieces = []
          length = 0
          discarding = true
          yield { tooLarge: true }
        } else if (piece.length) {
          pieces.push(piece)
          length += piece.length
        }
      }
      if (newline === -1) break
      if (!discarding) yield { line: Buffer.concat(pieces, length).toString('utf8').replace(/\r$/u, '') }
      pieces = []
      length = 0
      discarding = false
      offset = newline + 1
    }
  }
  if (!discarding && length) yield { line: Buffer.concat(pieces, length).toString('utf8').replace(/\r$/u, '') }
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function rpcError(id, code, message, data) {
  send({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } })
}

function toolResponse(id, result, isError = false, workspace = null) {
  const candidate = !isError && workspace ? result?.value?.candidate : null
  const resources = candidate ? [
    candidate.preview?.path ? { path: candidate.preview.path, name: 'KJDraw interactive preview', title: 'KJDraw drawing preview (zoom and pan)', description: 'Open the reviewable drawing preview with fit, zoom and pan controls.', mimeType: 'text/html' } : null,
    candidate.svg?.path ? { path: candidate.svg.path, name: 'KJDraw SVG preview', title: 'KJDraw drawing preview', description: 'Reviewable drawing preview generated from the exact candidate.', mimeType: 'image/svg+xml' } : null,
    candidate.kjd ? { path: candidate.kjd, name: 'KJDraw editable drawing', title: 'KJDraw editable KJD candidate', description: 'Editable native KJDraw candidate; the attached source drawing was not overwritten.', mimeType: 'application/vnd.kanjie.kjdraw+json' } : null,
    candidate.dxf ? { path: candidate.dxf, name: 'KJDraw DXF drawing', title: 'KJDraw DXF candidate', description: 'Interchange DXF reopened and validated by KJDraw.', mimeType: 'application/dxf' } : null,
  ].filter(Boolean).map(resource => ({
    type: 'resource_link', uri: pathToFileURL(resolve(workspace, resource.path)).href,
    name: resource.name, title: resource.title, description: resource.description, mimeType: resource.mimeType,
    annotations: { audience: ['user'], priority: ['text/html', 'image/svg+xml'].includes(resource.mimeType) ? 1 : 0.8 },
  })) : []
  send({
    jsonrpc: '2.0', id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(result) }, ...resources],
      structuredContent: result,
      ...(isError ? { isError: true } : {})
    }
  })
}

const COMPACT_ENGINEERING_PROPOSALS = new Set(['cad_propose_geology_column', 'cad_propose_geology_section'])
function modelVisibleProposal(name, result, host, delivery = null) {
  if (result.ok && delivery) return { ok: true, value: {
    product: 'KJDraw', responseKind: 'verified-cad-candidate@1', tool: name,
    planId: result.value.planId, command: result.value.command, status: 'candidate-ready',
    documentId: host.document.id, revision: host.document.revision, units: host.document.snapshot().header.units,
    ...(result.value.engineeringEvidence ? { engineeringEvidence: result.value.engineeringEvidence } : {}),
    candidate: delivery,
    hostReceipt: {
      status: 'committed', scope: 'new-candidate-files', sourceOverwritten: false,
      userReviewReady: true, approvalPending: false,
      instruction: 'Present the linked interactive preview first, followed by the SVG and candidate file links. The preview supports fit, zoom and pan. Do not report that candidate generation is waiting for approval. The attached source drawing remains unchanged.',
    },
  } }
  if (!result.ok || !COMPACT_ENGINEERING_PROPOSALS.has(name)) return result
  const full = result.value
  const byType = Object.create(null)
  for (const entity of full.arguments.entities) byType[entity.type] = (byType[entity.type] ?? 0) + 1
  return { ok: true, value: {
    product: 'KJDraw', responseKind: 'compact-engineering-proposal@1',
    planId: full.planId, documentId: full.documentId, expectedRevision: full.expectedRevision,
    units: full.units, command: full.command, status: full.status,
    engineeringEvidence: full.engineeringEvidence,
    nativeGeometry: { entityCount: full.arguments.entities.length, entityTypes: byType,
      resourceCount: full.arguments.resources.layers.length + full.arguments.resources.linetypes.length },
    hostReview: { ledgerPath: host.ledger.session?.ledgerPath ?? null,
      sourceFingerprint: host.sourceFingerprint, completeNativePlanStoredOnlyInHostLedger: true,
      approvalAndCadSaveRequired: true },
  } }
}

function candidateLayouts(document) {
  const modelSpaceId = document.snapshot().spaces.modelSpaceId
  return [...document.listObjects({ kind: 'layout' })].sort((left, right) =>
    Number(left.payload.blockRecordId === modelSpaceId) - Number(right.payload.blockRecordId === modelSpaceId))
}

function candidateModelBounds(document) {
  const modelSpaceId = document.snapshot().spaces.modelSpaceId
  let minimumX = Infinity, minimumY = Infinity, maximumX = -Infinity, maximumY = -Infinity
  for (const entity of document.listEntities()) {
    if (entity.ownerId !== modelSpaceId || entity.erased || entity.payload.visible === false) continue
    let bounds
    try { bounds = displayedEntityBounds(document, entity) }
    catch { continue }
    if (!bounds || bounds.some(value => !Number.isFinite(value))) continue
    minimumX = Math.min(minimumX, bounds[0]); minimumY = Math.min(minimumY, bounds[1])
    maximumX = Math.max(maximumX, bounds[2]); maximumY = Math.max(maximumY, bounds[3])
  }
  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) return null
  const spanX = maximumX - minimumX, spanY = maximumY - minimumY
  const units = document.snapshot().header.units
  const minimumPadding = units === 'meter' ? 0.1 : units === 'inch' ? 0.25 : units === 'foot' ? 0.02 : 5
  const padding = Math.max(spanX, spanY) * 0.04 || minimumPadding
  return {
    minimum: [minimumX - Math.max(padding, minimumPadding), minimumY - Math.max(padding, minimumPadding)],
    maximum: [maximumX + Math.max(padding, minimumPadding), maximumY + Math.max(padding, minimumPadding)],
  }
}

async function candidateSvgPreview(host) {
  for (const layout of candidateLayouts(host.document)) {
    try { return exportDrawingSvg(host.document, { layoutId: layout.id, allowPartial: true }) }
    catch {}
  }
  const bounds = candidateModelBounds(host.document)
  if (!bounds) return null
  const previewDocument = host.document.fork()
  const modelSpaceId = previewDocument.snapshot().spaces.modelSpaceId
  const layout = previewDocument.listObjects({ kind: 'layout' }).find(item => item.payload.blockRecordId === modelSpaceId)
  if (!layout) return null
  const spanX = bounds.maximum[0] - bounds.minimum[0], spanY = bounds.maximum[1] - bounds.minimum[1]
  const landscape = spanX >= spanY
  await host.sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: {
    paperWidth: landscape ? 420 : 297, paperHeight: landscape ? 297 : 420, paperUnits: 1,
    marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10,
    originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 1,
    plotType: 4, rotation: 0, flags: 20, standardScaleType: 0,
    windowMinX: bounds.minimum[0], windowMinY: bounds.minimum[1],
    windowMaxX: bounds.maximum[0], windowMaxY: bounds.maximum[1],
  } }, { document: previewDocument })
  return exportDrawingSvg(previewDocument, { layoutId: layout.id, allowPartial: true })
}

function interactiveSvgPreview(svg, title = 'KJDraw drawing candidate') {
  const embeddedSvg = JSON.stringify(svg).replaceAll('<', '\\u003c')
  const embeddedTitle = JSON.stringify(title).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark;font:13px system-ui,-apple-system,Segoe UI,sans-serif;background:#15191f;color:#e8edf2}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:#15191f}
header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #303943;background:#20262e;flex-wrap:wrap}
header strong{margin-right:auto;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{border:1px solid #4b5663;border-radius:6px;background:#2b333d;color:inherit;padding:6px 10px;cursor:pointer;font:inherit}
button:hover{background:#384451}button:focus-visible{outline:2px solid #83c8ff;outline-offset:2px}
#zoom{min-width:58px;text-align:center;color:#b7c2ce;font-variant-numeric:tabular-nums}
#viewport{position:relative;flex:1;min-height:420px;overflow:hidden;background:#f8fafc;touch-action:none;cursor:grab}
#viewport.dragging{cursor:grabbing}#drawing{width:100%;height:100%;display:block}#drawing>svg{width:100%;height:100%;display:block}
footer{padding:7px 12px;color:#9ba8b6;background:#20262e;border-top:1px solid #303943;font-size:11px}
</style></head><body>
<header><strong id="title"></strong><button id="fit" type="button">Fit</button><button id="minus" type="button">−</button><span id="zoom">100%</span><button id="plus" type="button">+</button><button id="reset" type="button">100%</button></header>
<main id="viewport" aria-label="Interactive KJDraw drawing preview"><div id="drawing"></div></main>
<footer>Scroll to zoom · drag to pan · Fit restores the full drawing</footer>
<script>
const svgText=${embeddedSvg}, title=${embeddedTitle};
const viewport=document.getElementById('viewport'), drawing=document.getElementById('drawing');
drawing.innerHTML=svgText; const svg=drawing.firstElementChild; document.getElementById('title').textContent=title;
let view=null, base=null, drag=null;
function readBase(){const b=svg.viewBox.baseVal;return{x:b.x,y:b.y,width:b.width,height:b.height}}
function setView(next){view={...next};svg.setAttribute('viewBox',[view.x,view.y,view.width,view.height].join(' '));document.getElementById('zoom').textContent=Math.round(base.width/view.width*100)+'%'}
function fit(){if(!base)return;setView(base)}
function zoomAt(factor,cx=(view.x+view.width/2),cy=(view.y+view.height/2)){const width=view.width/factor,height=view.height/factor;setView({x:cx-(cx-view.x)/factor,y:cy-(cy-view.y)/factor,width,height})}
function pointerPoint(e){const r=svg.getBoundingClientRect();return{x:view.x+(e.clientX-r.left)/r.width*view.width,y:view.y+(e.clientY-r.top)/r.height*view.height}}
document.getElementById('fit').onclick=fit;document.getElementById('reset').onclick=fit;document.getElementById('plus').onclick=()=>zoomAt(1.25);document.getElementById('minus').onclick=()=>zoomAt(.8);
viewport.addEventListener('wheel',e=>{e.preventDefault();const p=pointerPoint(e);zoomAt(Math.exp(-e.deltaY*.001),p.x,p.y)},{passive:false});
viewport.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,view:{...view}};viewport.classList.add('dragging');viewport.setPointerCapture(e.pointerId)});
viewport.addEventListener('pointermove',e=>{if(!drag)return;const r=svg.getBoundingClientRect();const dx=(e.clientX-drag.x)/r.width*drag.view.width,dy=(e.clientY-drag.y)/r.height*drag.view.height;setView({x:drag.view.x-dx,y:drag.view.y-dy,width:drag.view.width,height:drag.view.height})});
viewport.addEventListener('pointerup',e=>{drag=null;viewport.classList.remove('dragging');viewport.releasePointerCapture(e.pointerId)});
svg.addEventListener('load',()=>{base=readBase();fit()}); base=readBase(); fit();
</script></body></html>`
}

async function deliverCandidate(host, proposal) {
  if (proposal.result.status !== 'awaiting-host-approval') return null
  const applied = await host.session.approve(proposal.result.planId, 'kjdraw-local-candidate-host')
  if (!applied.ok || applied.value.status !== 'committed') throw new Error('KJDraw could not materialize the exact proposal into a candidate drawing')
  const directory = host.candidateDir
  if (!directory) throw new Error('Candidate delivery was not selected by the host')
  const stem = `candidate-${host.ledger.session?.id ?? randomUUID()}-${proposal.sequence}`
  const kjdPath = join(directory, `${stem}.kjd`), dxfPath = join(directory, `${stem}.dxf`), svgPath = join(directory, `${stem}.svg`), previewPath = join(directory, `${stem}.html`)
  const kjd = await host.sdk.writeDocument(host.document, { format: 'KJD' })
  const dxf = await host.sdk.writeDocument(host.document, { format: 'DXF', version: '2018' })
  const reopenedKjd = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  const reopenedDxf = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const entityCount = host.document.listEntities().length
  if (!reopenedKjd.validate().valid || reopenedKjd.id !== host.document.id || reopenedKjd.revision !== host.document.revision || reopenedKjd.listEntities().length !== entityCount) throw new Error('Candidate KJD failed independent reopen validation')
  if (!reopenedDxf.validate().valid || reopenedDxf.listEntities().length !== entityCount) throw new Error('Candidate DXF failed independent reopen validation')
  await exclusiveAtomicFileCreate(kjdPath, kjd)
  await exclusiveAtomicFileCreate(dxfPath, dxf)
  let svg = null
  const preview = await candidateSvgPreview(host)
  if (preview) {
    await exclusiveAtomicFileCreate(svgPath, preview.svg)
    await exclusiveAtomicFileCreate(previewPath, interactiveSvgPreview(preview.svg))
    svg = {
      path: relative(host.workspace, svgPath).split(sep).join('/'),
      status: preview.report.status,
      rendered: preview.report.rendered,
      diagnosticCount: preview.report.diagnostics.length,
      approximationCount: preview.report.approximations.length,
    }
  }
  host.sourceFingerprint = fingerprint(host.document)
  return {
    kjd: relative(host.workspace, kjdPath).split(sep).join('/'),
    dxf: relative(host.workspace, dxfPath).split(sep).join('/'),
    ...(svg ? { preview: { path: relative(host.workspace, previewPath).split(sep).join('/'), format: 'interactive-svg-html', controls: ['fit', 'zoom', 'pan'] }, svg } : {}),
    entityCount, sourceOverwritten: false, transactionCount: 1,
    kjdReopenValid: true, dxfReopenValid: true,
  }
}

async function openHost(options) {
  if (options.blank || options['proposal-dir'] || options['candidate-dir'] || options['geology-column-pack']) {
    const workspaceEntry = await lstat(options.workspace)
    if (workspaceEntry.isSymbolicLink()) throw new Error('--workspace must not be a symbolic link')
  }
  const workspace = await realpath(options.workspace)
  if (!(await stat(workspace)).isDirectory()) throw new Error('--workspace must be a directory')
  let geologyColumnKnowledge
  if (options['geology-column-pack']) {
    const packPath = await resolveRegularFileWithoutLinks(workspace, options['geology-column-pack'], '--geology-column-pack')
    const metadata = await stat(packPath)
    if (metadata.size > MAX_KNOWLEDGE_PACK_BYTES) throw new Error(`--geology-column-pack must be no larger than ${MAX_KNOWLEDGE_PACK_BYTES} bytes`)
    const bytes = await readFile(packPath)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== options['geology-column-pack-sha256']) throw new Error('--geology-column-pack bytes do not match the host-supplied SHA-256')
    let pack
    try { pack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    catch { throw new Error('--geology-column-pack must be strict UTF-8 JSON') }
    geologyColumnKnowledge = { pack, sha256, path: relative(workspace, packPath).split(sep).join('/'), byteLength: bytes.byteLength }
  }
  const input = options.blank
    ? await resolveVacantFileInside(workspace, options.blank, '--blank')
    : await resolveExistingInside(workspace, options.input, '--input')
  const proposalDir = options['proposal-dir'] ? await resolveSessionLedgerDir(workspace, options['proposal-dir']) : null
  const candidateDir = options['candidate-dir'] ? await resolveSessionLedgerDir(workspace, options['candidate-dir']) : null
  if (candidateDir && samePath(candidateDir, proposalDir)) throw new Error('--candidate-dir must be different from --proposal-dir')
  let sessionId = proposalDir ? randomUUID() : null
  let proposals = proposalDir
    ? join(proposalDir, `mcp-pending-${sessionId}.json`)
    : options.blank
      ? await resolveVacantFileInside(workspace, options.proposals, '--proposals')
      : await resolveOutputInside(workspace, options.proposals)
  if (samePath(input, proposals)) throw new Error('--proposals must not overwrite the drawing')
  const format = options.blank ? 'KJD' : extname(input).toLowerCase() === '.kjd' ? 'KJD' : extname(input).toLowerCase() === '.dxf' ? 'DXF' : null
  if (!format || options.blank && extname(input).toLowerCase() !== '.kjd') throw new Error(options.blank ? '--blank must name a new .kjd drawing' : '--input must be a .kjd or .dxf drawing')
  let sourceBytes, sdk, document
  if (options.blank) {
    const builder = createKJDrawSDK()
    const blank = builder.createDocument({ documentId: `mcp-blank-${randomUUID()}`, units: options.units })
    if (!blank.validate().valid) throw new Error('Blank drawing failed CAD validation before creation')
    const content = await builder.writeDocument(blank, { format: 'KJD' })
    const probeSdk = createKJDrawSDK()
    const probe = await probeSdk.readDocument(content, { format: 'KJD' })
    if (!probe.validate().valid || probe.id !== blank.id || probe.revision !== blank.revision || probe.snapshot().header.units !== options.units || fingerprint(probe) !== fingerprint(blank)) throw new Error('Blank KJD did not round-trip before creation')
    await exclusiveAtomicFileCreate(input, content)
    sourceBytes = await readFile(input)
    sdk = createKJDrawSDK()
    document = await sdk.readDocument(new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes), { format: 'KJD' })
    if (!document.validate().valid || document.id !== probe.id || document.revision !== probe.revision || document.snapshot().header.units !== options.units || fingerprint(document) !== fingerprint(probe)) throw new Error('Created blank KJD failed reopen validation')
  } else {
    const metadata = await stat(input)
    if (!metadata.isFile() || metadata.size > MAX_DRAWING_BYTES) throw new Error(`Drawing must be a file no larger than ${MAX_DRAWING_BYTES} bytes`)
    sourceBytes = await readFile(input)
    const source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes)
    sdk = createKJDrawSDK()
    document = await sdk.readDocument(source, { format })
  }
  const session = new KJAgentToolSession(sdk, document, geologyColumnKnowledge ? { geologyColumnKnowledge } : {})
  const geologyColumnKnowledgeDescriptor = session.geologyColumnKnowledge
  const sourceFingerprint = fingerprint(document)
  const ledger = {
    schema: 'com.kanjie.kjdraw.mcp-pending-proposals@1',
    source: {
      path: relative(workspace, input).split(sep).join('/'),
      format,
      byteLength: sourceBytes.byteLength,
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
      documentId: document.id,
      revision: document.revision,
      units: document.snapshot().header.units,
      fingerprint: sourceFingerprint,
      ...(options.blank ? { createdBlank: true } : {})
    },
    proposals: [],
    ...(geologyColumnKnowledgeDescriptor ? { knowledge: { geologyColumn: { ...geologyColumnKnowledgeDescriptor,
      path: geologyColumnKnowledge.path, byteLength: geologyColumnKnowledge.byteLength } } } : {}),
    ...(sessionId ? { session: { id: sessionId, ledgerPath: relative(workspace, proposals).split(sep).join('/') } } : {})
  }
  if (proposalDir) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await exclusiveAtomicJsonCreate(proposals, ledger); break }
      catch (error) {
        if (error?.code !== 'EEXIST' || attempt === 4) throw error
        sessionId = randomUUID()
        proposals = join(proposalDir, `mcp-pending-${sessionId}.json`)
        ledger.session = { id: sessionId, ledgerPath: relative(workspace, proposals).split(sep).join('/') }
      }
    }
  } else await exclusiveAtomicJsonCreate(proposals, ledger)
  const sessionReceipt = sessionId ? { ledgerPath: ledger.session.ledgerPath, sessionId, sourceFingerprint, sourceRevision: document.revision, sourceDocumentId: document.id } : null
  return { workspace, sdk, document, session, sourceFingerprint, proposals, ledger, sessionReceipt, candidateDir }
}

async function main() {
  let args
  try { args = parseArgs(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`)
    process.exitCode = 2
    return
  }
  if (args.help) { process.stdout.write(`${usage()}\n`); return }
  if (args.version) { process.stdout.write(`${KJDRAW_VERSION}\n`); return }

  let host
  try { host = await openHost(args) } catch (error) {
    process.stderr.write(`kjdraw-mcp: ${error instanceof Error ? error.message : 'Unable to open the host drawing'}\n`)
    process.exitCode = 1
    return
  }

  let initialized = false
  for await (const message of boundedMessages(process.stdin)) {
    if (message.tooLarge) { rpcError(null, -32600, 'JSON-RPC message exceeds the 4 MiB limit'); continue }
    const line = message.line
    if (!line.trim()) continue
    let request
    try { request = JSON.parse(line) } catch { rpcError(null, -32700, 'Parse error'); continue }
    if (!request || Array.isArray(request) || typeof request !== 'object' || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      rpcError(request?.id, -32600, 'Invalid Request')
      continue
    }
    const notification = request.id === undefined
    try {
      if (request.method === 'initialize') {
        if (notification) continue
        const requested = request.params?.protocolVersion
        const protocolVersion = typeof requested === 'string' && SUPPORTED_PROTOCOLS.has(requested) ? requested : PROTOCOL_VERSION
        initialized = true
        send({ jsonrpc: '2.0', id: request.id, result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: KJDRAW_VERSION },
          ...(host.sessionReceipt ? { _meta: { 'com.kanjie.kjdraw/session': host.sessionReceipt } } : {}),
          instructions: 'Inspect the attached drawing and create proposals for host review. No tool approves a proposal or saves a CAD file.'
        } })
        continue
      }
      if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') continue
      if (request.method === 'ping') { if (!notification) send({ jsonrpc: '2.0', id: request.id, result: {} }); continue }
      if (!initialized) { if (!notification) rpcError(request.id, -32002, 'Server is not initialized'); continue }
      if (request.method === 'tools/list') {
        if (!notification) send({ jsonrpc: '2.0', id: request.id, result: { tools: host.session.definitions.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            readOnlyHint: tool.effect === 'read',
            destructiveHint: false,
            idempotentHint: tool.effect === 'read',
            openWorldHint: false
          }
        })) } })
        continue
      }
      if (request.method === 'tools/call') {
        if (notification) continue
        const name = request.params?.name, input = request.params?.arguments ?? {}
        const definition = host.session.definitions.find(tool => tool.name === name)
        if (!definition) { rpcError(request.id, -32602, 'Unknown tool; use a name returned by tools/list'); continue }
        if (!input || Array.isArray(input) || typeof input !== 'object') { rpcError(request.id, -32602, 'Tool arguments must be an object'); continue }
        const beforeRevision = host.document.revision, beforeFingerprint = fingerprint(host.document)
        const result = await host.session.call(name, input)
        if (host.document.revision !== beforeRevision || fingerprint(host.document) !== beforeFingerprint || beforeFingerprint !== host.sourceFingerprint) {
          throw new Error('A tool call changed the host drawing; the result was rejected')
        }
        if (result.ok && definition.effect === 'propose') {
          const proposal = {
            sequence: host.ledger.proposals.length + 1,
            tool: name,
            sourceRevision: beforeRevision,
            sourceFingerprint: beforeFingerprint,
            result: result.value
          }
          host.ledger.proposals.push(proposal)
          await atomicJsonWrite(host.proposals, host.ledger)
          const delivery = host.candidateDir ? await deliverCandidate(host, proposal) : null
          if (delivery) {
            proposal.delivery = delivery
            await atomicJsonWrite(host.proposals, host.ledger)
            toolResponse(request.id, modelVisibleProposal(name, result, host, delivery), false, host.workspace)
            continue
          }
        }
        toolResponse(request.id, modelVisibleProposal(name, result, host), !result.ok)
        continue
      }
      if (!notification) rpcError(request.id, -32601, 'Method not found')
    } catch (error) {
      if (!notification) rpcError(request.id, -32603, 'Internal error', { message: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
}

await main()
