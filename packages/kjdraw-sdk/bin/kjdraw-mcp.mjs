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
import { assertPortableMcpInputSchema, KJDRAW_MCP_SCHEMA_PROFILE, portableMcpInputSchema } from '../src/mcp-schema-compat.js'

const SERVER_NAME = '@kanjieteam/kjdraw-mcp'
const PROTOCOL_VERSION = '2025-11-25'
const SUPPORTED_PROTOCOLS = new Set([PROTOCOL_VERSION, '2025-06-18'])
const MAX_DRAWING_BYTES = 64 * 1024 * 1024
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024
const MAX_INLINE_SVG_BYTES = 768 * 1024
const MAX_KNOWLEDGE_PACK_BYTES = 1024 * 1024
const KIMI_SAFE_TOOL_NAMES = new Set([
  'cad_read_drawing',
  'cad_read_page',
  'cad_measure_distance',
  'cad_propose_lines',
  'cad_propose_circles',
  'cad_propose_move',
  'cad_propose_offset',
  'cad_propose_polyline_edit',
  'cad_propose_text_edit',
  'cad_propose_drawing_compact',
  'cad_propose_manufacturing_sheet',
  'cad_propose_architecture_plan',
  'cad_propose_cartesian_chart',
  'cad_propose_geology_column',
  'cad_propose_geology_section',
  'cad_propose_geology_section_example',
  'cad_propose_geology_plan',
  'cad_propose_road_drawing',
  'cad_propose_site_plan',
])

function usage() {
  return `Usage:\n  kjdraw-mcp --workspace <directory> --input <drawing.kjd|drawing.dxf> --proposals <pending.json> [--tool-profile <full|kimi-safe>]\n  kjdraw-mcp --workspace <directory> --input <drawing.kjd|drawing.dxf> --proposal-dir <existing-relative-directory> [--candidate-dir <existing-relative-directory>] [--tool-profile <full|kimi-safe>]\n  kjdraw-mcp --workspace <directory> --blank <new-drawing.kjd> --units <millimeter|meter> --proposals <pending.json> [--tool-profile <full|kimi-safe>]\n  kjdraw-mcp --workspace <directory> --blank <new-drawing.kjd> --units <millimeter|meter> --proposal-dir <existing-relative-directory> [--candidate-dir <existing-relative-directory>] [--tool-profile <full|kimi-safe>]\n  kjdraw-mcp --check-tool-schemas\n\nOptional host-only geology style binding:\n  --geology-column-pack <existing-relative.json> --geology-column-pack-sha256 <64-lowercase-hex>\n  --geology-section-pack <existing-relative.json> --geology-section-pack-sha256 <64-lowercase-hex>\n\n--tool-profile defaults to full. kimi-safe exposes the core read, drafting, geology, architecture, manufacturing and chart tools through a bounded schema set for older Kimi Work runtimes. --proposals is the legacy one-file mode. --proposal-dir creates one exclusive ledger per stdio session. When the host also supplies --candidate-dir, exact CREATEBATCH proposals are materialized into new KJD/DXF/SVG candidate files there; the input drawing is never overwritten. The model cannot choose either path or approve writes to the input.`
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  if (argv.includes('--version') || argv.includes('-v')) return { version: true }
  if (argv.length === 1 && argv[0] === '--check-tool-schemas') return { checkToolSchemas: true }
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1]
    if (!['--workspace', '--input', '--blank', '--units', '--proposals', '--proposal-dir', '--candidate-dir', '--geology-column-pack', '--geology-column-pack-sha256', '--geology-section-pack', '--geology-section-pack-sha256', '--tool-profile'].includes(key) || !value || Object.hasOwn(values, key.slice(2))) throw new Error(`Unknown, duplicate or incomplete argument: ${key ?? ''}`)
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
  if (Boolean(values['geology-section-pack']) !== Boolean(values['geology-section-pack-sha256'])) throw new Error('--geology-section-pack and --geology-section-pack-sha256 must be supplied together')
  if (values['geology-section-pack-sha256'] && !/^[a-f0-9]{64}$/u.test(values['geology-section-pack-sha256'])) throw new Error('--geology-section-pack-sha256 must be 64 lowercase hexadecimal characters')
  values['tool-profile'] ??= 'full'
  if (!['full', 'kimi-safe'].includes(values['tool-profile'])) throw new Error('--tool-profile must be full or kimi-safe')
  return values
}

function profileDefinitions(definitions, profile = 'full') {
  if (profile === 'full') return definitions
  const selected = definitions.filter(tool => KIMI_SAFE_TOOL_NAMES.has(tool.name))
  for (const required of ['cad_read_drawing', 'cad_read_page', 'cad_measure_distance', 'cad_propose_drawing_compact']) {
    if (!selected.some(tool => tool.name === required)) throw new Error(`Kimi-safe tool profile is missing ${required}`)
  }
  return selected
}

function checkToolSchemas() {
  const unitProfiles = ['millimeter', 'meter'].map(units => {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units })
    const definitions = new KJAgentToolSession(sdk, document).definitions
    let byteLength = 0
    for (const tool of definitions) {
      const schema = portableMcpInputSchema(tool.inputSchema)
      assertPortableMcpInputSchema(schema, `${tool.name}.inputSchema`)
      byteLength += Buffer.byteLength(JSON.stringify(schema), 'utf8')
    }
    const kimiSafeDefinitions = profileDefinitions(definitions, 'kimi-safe')
    const kimiSafeSchemaByteLength = kimiSafeDefinitions.reduce((total, tool) => total + Buffer.byteLength(JSON.stringify(portableMcpInputSchema(tool.inputSchema)), 'utf8'), 0)
    return { units, toolCount: definitions.length, schemaByteLength: byteLength, kimiSafeToolCount: kimiSafeDefinitions.length, kimiSafeSchemaByteLength }
  })
  return { ok: true, profile: KJDRAW_MCP_SCHEMA_PROFILE, unitProfiles }
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

async function toolResponse(id, result, isError = false, host = null) {
  const candidate = !isError && host ? result?.value?.candidate : null
  const resources = candidate ? [
    candidate.preview?.path ? { key: 'preview', path: candidate.preview.path, name: 'KJDraw interactive preview', title: 'KJDraw drawing preview (zoom and pan)', description: 'Open the reviewable drawing preview with fit, zoom and pan controls.', mimeType: 'text/html' } : null,
    candidate.svg?.path ? { key: 'svg', path: candidate.svg.path, name: 'KJDraw SVG preview', title: 'KJDraw drawing preview', description: 'Reviewable drawing preview generated from the exact candidate.', mimeType: 'image/svg+xml' } : null,
    candidate.kjd ? { key: 'kjd', path: candidate.kjd, name: 'KJDraw editable drawing', title: 'KJDraw editable KJD candidate', description: 'Editable native KJDraw candidate; the attached source drawing was not overwritten.', mimeType: 'application/vnd.kanjie.kjdraw+json' } : null,
    candidate.dxf ? { key: 'dxf', path: candidate.dxf, name: 'KJDraw DXF drawing', title: 'KJDraw DXF candidate', description: 'Interchange DXF reopened and validated by KJDraw.', mimeType: 'application/dxf' } : null,
  ].filter(Boolean).map(resource => {
    const uri = pathToFileURL(resolve(host.workspace, resource.path)).href
    void host.resources.delete(uri)
    return {
      type: 'resource_link', uri,
      name: resource.name, title: resource.title, description: resource.description, mimeType: resource.mimeType,
      annotations: { audience: ['user'], priority: ['text/html', 'image/svg+xml'].includes(resource.mimeType) ? 1 : 0.8 },
    }
  }) : []
  let inlinePreview = []
  if (candidate?.svg?.path && host) {
    try {
      const svgPath = await resolveRegularFileWithoutLinks(host.workspace, candidate.svg.path, 'Candidate SVG preview')
      const metadata = await stat(svgPath)
      if (metadata.size <= MAX_INLINE_SVG_BYTES) inlinePreview = [{
        type: 'image', data: (await readFile(svgPath)).toString('base64'), mimeType: 'image/svg+xml',
        annotations: { audience: ['user'], priority: 1 },
      }]
    } catch {}
  }
  send({
    jsonrpc: '2.0', id,
    result: {
      // Inline the exact SVG before links so hosts that block custom URI
      // schemes can still render the candidate. Resource-aware hosts retain
      // the interactive HTML, SVG, KJD and DXF links that follow.
      content: [...inlinePreview, ...resources, { type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      ...(isError ? { isError: true } : {})
    }
  })
}

const COMPACT_ENGINEERING_PROPOSALS = new Set(['cad_propose_geology_column', 'cad_propose_geology_section', 'cad_propose_geology_section_example', 'cad_propose_geology_plan'])
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

function interactiveSvgPreview(svg, title = 'KJDraw 工程图候选') {
  const pageTitle = String(title).replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
  const embeddedSvg = JSON.stringify(svg).replaceAll('<', '\\u003c')
  const embeddedTitle = JSON.stringify(title).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${pageTitle}</title>
<style>
:root{font:12px system-ui,-apple-system,"Segoe UI",sans-serif;background:#071117;color:#d9e3e8;--line:#263640;--muted:#82929c;--accent:#a7f35c;--dark:#071117;--dark-2:#0d1820;--paper:#fffefa}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;grid-template-rows:58px 1fr 34px;background:#071117;color:#d9e3e8}
button{height:30px;border:1px solid transparent;border-radius:5px;background:transparent;color:inherit;padding:0 9px;cursor:pointer;font:inherit;transition:background .15s,border-color .15s,color .15s}button:hover{background:rgba(110,167,194,.12)}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button.on{background:rgba(110,167,194,.18);color:#4f91af;border-color:rgba(110,167,194,.38)}
.appbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 18px;border-bottom:1px solid var(--line);background:rgba(8,18,24,.98);box-shadow:0 8px 24px rgba(0,0,0,.18)}.identity{min-width:0;display:flex;align-items:center;gap:11px}.doc-mark{width:29px;height:29px;border:0;border-radius:7px;display:grid;place-items:center;background:var(--accent);color:#10200b;font-size:14px;font-weight:900;letter-spacing:-.08em}.doc-copy{min-width:0}.doc-copy strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:650;color:#f1f6f8}.doc-copy span{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:11px}.ready{color:var(--accent)}.app-actions{display:flex;align-items:center;gap:4px;color:#aab8bf}.app-actions button{font-size:11px}.divider{width:1px;height:20px;background:var(--line);margin:0 5px}
.preview-shell{min-height:0;position:relative;padding:12px 14px 10px;background:#071117}.canvas-shell{position:relative;height:100%;min-height:420px;overflow:hidden;border:1px solid #24343e;border-radius:8px;background:#071117;box-shadow:inset 0 0 0 1px rgba(255,255,255,.015),0 10px 34px rgba(0,0,0,.24);touch-action:none;cursor:grab}.canvas-shell.dragging{cursor:grabbing}.canvas-shell.plot{background:#e2e6e8}.canvas-head{position:absolute;z-index:4;top:13px;left:15px;display:flex;align-items:center;gap:8px;color:#d8e4e8;font-size:11px;pointer-events:none}.canvas-head:before{content:"";width:5px;height:5px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px rgba(167,243,92,.7)}.plot .canvas-head{color:#4d606a}.canvas-head strong{font-weight:600}.canvas-head span{opacity:.66}.canvas-grid{position:absolute;inset:0;opacity:.22;background-image:radial-gradient(circle,#36505e 1px,transparent 1.2px);background-size:28px 28px;pointer-events:none}.plot .canvas-grid{opacity:.48;background-image:linear-gradient(#bbc5c9 1px,transparent 1px),linear-gradient(90deg,#bbc5c9 1px,transparent 1px)}
.sheet{position:absolute;inset:38px 34px 34px;overflow:hidden;background:#151b20;border:1px solid #344047;box-shadow:0 14px 34px rgba(0,0,0,.18)}.plot .sheet{background:var(--paper);border-color:#c5ced2;box-shadow:0 14px 34px rgba(47,60,68,.16)}#drawing{width:100%;height:100%;display:block}#drawing>svg{width:100%;height:100%;display:block}.cad .sheet{inset:0;border:0;box-shadow:none}.cad #drawing>svg{filter:invert(1) hue-rotate(180deg) contrast(.9) saturate(.75)}.plot #drawing>svg{filter:none}
.crosshair{position:absolute;inset:0;pointer-events:none;display:none}.canvas-shell:hover .crosshair{display:block}.crosshair:before,.crosshair:after{content:"";position:absolute;background:#8ab4c8;opacity:.24}.crosshair:before{left:var(--mx,50%);top:0;width:1px;height:100%}.crosshair:after{top:var(--my,50%);left:0;height:1px;width:100%}.select-box{position:absolute;border:1px solid #9adf64;background:rgba(126,196,85,.12);display:none;pointer-events:none}
.floating-tools{position:absolute;z-index:5;top:42px;left:15px;display:flex;align-items:center;gap:4px;padding:4px;border:1px solid rgba(143,172,185,.2);border-radius:7px;background:rgba(11,22,29,.9);box-shadow:0 6px 22px rgba(0,0,0,.25);backdrop-filter:blur(10px);color:#e6eef1}.plot .floating-tools{border-color:#cbd5d9;background:rgba(255,255,255,.92);color:#455861;box-shadow:0 5px 18px rgba(45,59,68,.12)}.floating-tools button{height:28px;padding:0 8px;font-size:11px}.floating-tools button.icon{width:29px;padding:0;font-size:15px}.floating-tools .readout{min-width:48px;text-align:center;color:inherit;font-variant-numeric:tabular-nums}.display{display:flex;gap:2px;padding-left:3px;margin-left:2px;border-left:1px solid rgba(128,150,159,.3)}.display button{font-size:10px}.hint{position:absolute;z-index:4;left:16px;bottom:11px;color:rgba(207,221,227,.58);font-size:10px;pointer-events:none}.plot .hint{color:#718088}.inspector{position:absolute;z-index:6;right:15px;bottom:15px;width:250px;max-height:55%;overflow:auto;padding:13px 14px;border:1px solid #31444f;border-radius:8px;background:rgba(12,24,31,.96);color:#dce7eb;box-shadow:0 12px 28px rgba(0,0,0,.28);backdrop-filter:blur(10px)}.inspector[hidden]{display:none}.inspector button{float:right;width:24px;height:24px;padding:0;border:1px solid #3a4d58;border-radius:4px;color:#9aabb4}.inspector strong{display:block;margin-bottom:10px;font-size:12px;font-weight:600}.inspector dl{display:grid;grid-template-columns:82px minmax(0,1fr);gap:7px 10px;margin:0;font-size:11px}.inspector dt{color:#83949d}.inspector dd{margin:0;overflow-wrap:anywhere;color:#d6e0e4}.statusbar{display:flex;align-items:center;gap:18px;padding:0 18px;border-top:1px solid var(--line);background:#09141b;color:#73858f;font-size:10px}.statusbar .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9aaab2}.statusbar span{white-space:nowrap}.kbd{border:1px solid #2c3c45;border-radius:3px;padding:1px 5px;color:#81929b;background:#0d1920}
@media(max-width:780px){body{grid-template-rows:auto 1fr 34px}.appbar{padding:9px 12px;align-items:flex-start}.app-actions{flex-wrap:wrap;justify-content:flex-end}.preview-shell{padding:8px}.canvas-shell{min-height:360px}.sheet{inset:38px 12px 30px}.floating-tools{left:10px;right:10px;top:42px;overflow:auto;white-space:nowrap}.hint{left:11px}.inspector{right:10px;bottom:10px;width:min(250px,calc(100% - 20px))}.statusbar{gap:8px;padding:0 10px;overflow:auto}}
</style></head><body>
<header class="appbar"><div class="identity"><div class="doc-mark">KJ</div><div class="doc-copy"><strong id="title"></strong><span><span class="ready">预览就绪</span><span>原图未改动</span></span></div></div><nav class="app-actions" aria-label="图纸预览操作"><span>工程图预览</span><span class="divider"></span><button id="fitTop" type="button">全图</button><button id="resetTop" type="button">100%</button></nav></header>
<main class="preview-shell"><section id="viewport" class="canvas-shell cad" aria-label="KJDraw 图纸预览"><div class="canvas-head"><strong>模型空间</strong><span>·</span><span id="canvasMode">深色审图</span></div><div id="gridLayer" class="canvas-grid"></div><div class="sheet"><div id="drawing"></div></div><div class="crosshair"></div><div id="box" class="select-box"></div><nav class="floating-tools" aria-label="图纸操作"><div class="tool-group"><button class="on" title="选择和查看" type="button">选择</button><button id="windowZoom" title="框选放大" type="button">框选</button></div><span class="divider"></span><div class="tool-group"><button id="minus" class="icon" type="button" aria-label="缩小">−</button><span id="zoom" class="readout">100%</span><button id="plus" class="icon" type="button" aria-label="放大">＋</button><button id="fit" type="button">全图</button></div><div class="display"><button id="modeCad" class="on" type="button">深色</button><button id="modePlot" type="button">图纸</button></div><button id="grid" class="on" type="button">网格</button></nav><div class="hint">滚轮缩放 · 拖动平移 · 点击图元查看属性</div><aside id="props" class="inspector" hidden><button id="closeProps" type="button" aria-label="关闭属性">×</button><strong>对象属性</strong><div id="propsBody"></div></aside></section></main>
<footer class="statusbar"><span class="grow" id="statusTitle"></span><span id="entityCount">0 个对象</span><span id="coords">X 0.000 · Y 0.000</span><span id="zoomMetric">100%</span><span><span class="kbd">滚轮</span> 缩放</span></footer>
<script>
const svgText=${embeddedSvg}, title=${embeddedTitle};
const viewport=document.getElementById('viewport'), drawing=document.getElementById('drawing'), box=document.getElementById('box');
drawing.innerHTML=svgText; const svg=drawing.firstElementChild; document.getElementById('title').textContent=title; document.getElementById('statusTitle').textContent=title;
let view=null, base=null, drag=null, mode='cad', windowZoom=false, boxStart=null;
function readBase(){const b=svg.viewBox.baseVal;return{x:b.x,y:b.y,width:b.width,height:b.height}}
function updateMetrics(){const percent=Math.round(base.width/view.width*100)+'%';document.getElementById('zoom').textContent=percent;document.getElementById('zoomMetric').textContent=percent;document.getElementById('canvasMode').textContent=mode==='plot'?'图纸模式':'深色审图'}
function setView(next){view={...next};svg.setAttribute('viewBox',[view.x,view.y,view.width,view.height].join(' '));updateMetrics()}
function fit(){if(!base)return;setView(base)}
function zoomAt(factor,cx=(view.x+view.width/2),cy=(view.y+view.height/2)){const width=view.width/factor,height=view.height/factor;setView({x:cx-(cx-view.x)/factor,y:cy-(cy-view.y)/factor,width,height})}
function pointerPoint(e){const r=svg.getBoundingClientRect();return{x:view.x+(e.clientX-r.left)/r.width*view.width,y:view.y+(e.clientY-r.top)/r.height*view.height}}
function screenBox(a,b){const left=Math.min(a.x,b.x),top=Math.min(a.y,b.y);Object.assign(box.style,{display:'block',left:left+'px',top:top+'px',width:Math.abs(a.x-b.x)+'px',height:Math.abs(a.y-b.y)+'px'})}
function setMode(next){mode=next;viewport.classList.toggle('cad',next==='cad');viewport.classList.toggle('plot',next==='plot');document.getElementById('modeCad').classList.toggle('on',next==='cad');document.getElementById('modePlot').classList.toggle('on',next==='plot');updateMetrics()}
function inspectElement(target){const entity=target?.closest?.('[data-entity-type]');if(!entity)return;const attrs=[...entity.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name.replace(/^data-/,''),a.value]);document.getElementById('propsBody').innerHTML='<dl>'+attrs.map(([k,v])=>'<dt>'+k+'</dt><dd>'+String(v).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</dd>').join('')+'</dl>';document.getElementById('props').hidden=false}
document.getElementById('fit').onclick=fit;document.getElementById('fitTop').onclick=fit;document.getElementById('resetTop').onclick=fit;document.getElementById('plus').onclick=()=>zoomAt(1.25);document.getElementById('minus').onclick=()=>zoomAt(.8);document.getElementById('modeCad').onclick=()=>setMode('cad');document.getElementById('modePlot').onclick=()=>setMode('plot');document.getElementById('grid').onclick=event=>{event.currentTarget.classList.toggle('on');document.getElementById('gridLayer').style.display=event.currentTarget.classList.contains('on')?'block':'none'};document.getElementById('windowZoom').onclick=event=>{windowZoom=!windowZoom;event.currentTarget.classList.toggle('on',windowZoom)};document.getElementById('closeProps').onclick=()=>{document.getElementById('props').hidden=true};
for(const controls of document.querySelectorAll('.floating-tools,.inspector'))controls.addEventListener('pointerdown',event=>event.stopPropagation());
viewport.addEventListener('wheel',e=>{e.preventDefault();const p=pointerPoint(e);zoomAt(Math.exp(-e.deltaY*.001),p.x,p.y)},{passive:false});
viewport.addEventListener('pointerdown',e=>{const local={x:e.offsetX,y:e.offsetY};if(windowZoom){boxStart=local;screenBox(local,local)}else{drag={x:e.clientX,y:e.clientY,view:{...view}};viewport.classList.add('dragging')}viewport.setPointerCapture(e.pointerId)});
viewport.addEventListener('pointermove',e=>{const p=pointerPoint(e);viewport.style.setProperty('--mx',e.offsetX+'px');viewport.style.setProperty('--my',e.offsetY+'px');document.getElementById('coords').textContent='X '+p.x.toFixed(3)+' | Y '+p.y.toFixed(3);if(boxStart){screenBox(boxStart,{x:e.offsetX,y:e.offsetY});return}if(!drag)return;const r=svg.getBoundingClientRect();const dx=(e.clientX-drag.x)/r.width*drag.view.width,dy=(e.clientY-drag.y)/r.height*drag.view.height;setView({x:drag.view.x-dx,y:drag.view.y-dy,width:drag.view.width,height:drag.view.height})});
viewport.addEventListener('pointerup',e=>{if(boxStart){const a=pointerPoint({clientX:e.clientX-(e.offsetX-boxStart.x),clientY:e.clientY-(e.offsetY-boxStart.y)}),b=pointerPoint(e);if(Math.abs(e.offsetX-boxStart.x)>8&&Math.abs(e.offsetY-boxStart.y)>8)setView({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});boxStart=null;box.style.display='none'}else if(Math.abs((drag?.x??e.clientX)-e.clientX)+Math.abs((drag?.y??e.clientY)-e.clientY)<4)inspectElement(e.target);drag=null;viewport.classList.remove('dragging');viewport.releasePointerCapture(e.pointerId)});
svg.addEventListener('click',e=>inspectElement(e.target));base=readBase();document.getElementById('entityCount').textContent=svg.querySelectorAll('[data-entity-type]').length;fit();
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
  if (options.blank || options['proposal-dir'] || options['candidate-dir'] || options['geology-column-pack'] || options['geology-section-pack']) {
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
  let geologySectionKnowledge
  if (options['geology-section-pack']) {
    const packPath = await resolveRegularFileWithoutLinks(workspace, options['geology-section-pack'], '--geology-section-pack')
    const metadata = await stat(packPath)
    if (metadata.size > MAX_KNOWLEDGE_PACK_BYTES) throw new Error(`--geology-section-pack must be no larger than ${MAX_KNOWLEDGE_PACK_BYTES} bytes`)
    const bytes = await readFile(packPath)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== options['geology-section-pack-sha256']) throw new Error('--geology-section-pack bytes do not match the host-supplied SHA-256')
    let pack
    try { pack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    catch { throw new Error('--geology-section-pack must be strict UTF-8 JSON') }
    geologySectionKnowledge = { pack, sha256, path: relative(workspace, packPath).split(sep).join('/'), byteLength: bytes.byteLength }
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
  const session = new KJAgentToolSession(sdk, document, {
    ...(geologyColumnKnowledge ? { geologyColumnKnowledge } : {}),
    ...(geologySectionKnowledge ? { geologySectionKnowledge } : {}),
  })
  const geologyColumnKnowledgeDescriptor = session.geologyColumnKnowledge
  const geologySectionKnowledgeDescriptor = session.geologySectionKnowledge
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
    ...(geologyColumnKnowledgeDescriptor || geologySectionKnowledgeDescriptor ? { knowledge: {
      ...(geologyColumnKnowledgeDescriptor ? { geologyColumn: { ...geologyColumnKnowledgeDescriptor,
        path: geologyColumnKnowledge.path, byteLength: geologyColumnKnowledge.byteLength } } : {}),
      ...(geologySectionKnowledgeDescriptor ? { geologySection: { ...geologySectionKnowledgeDescriptor,
        path: geologySectionKnowledge.path, byteLength: geologySectionKnowledge.byteLength } } : {}),
    } } : {}),
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
  return { workspace, sdk, document, session, sourceFingerprint, proposals, ledger, sessionReceipt, candidateDir, toolProfile: options['tool-profile'], resources: new Map() }
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
  if (args.checkToolSchemas) { process.stdout.write(`${JSON.stringify(checkToolSchemas())}\n`); return }

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
        if (!notification) send({ jsonrpc: '2.0', id: request.id, result: { tools: profileDefinitions(host.session.definitions, host.toolProfile).map(tool => {
          const inputSchema = portableMcpInputSchema(tool.inputSchema)
          assertPortableMcpInputSchema(inputSchema, `${tool.name}.inputSchema`)
          return {
            name: tool.name,
            description: tool.description,
            inputSchema,
            annotations: {
              readOnlyHint: tool.effect === 'read',
              destructiveHint: false,
              idempotentHint: tool.effect === 'read',
              openWorldHint: false
            }
          }
        }) } })
        continue
      }
      if (request.method === 'resources/list') {
        if (!notification) send({ jsonrpc: '2.0', id: request.id, result: { resources: [...host.resources].map(([uri, resource]) => ({
          uri, name: resource.name, title: resource.title, description: resource.description, mimeType: resource.mimeType,
        })) } })
        continue
      }
      if (request.method === 'resources/read') {
        if (notification) continue
        const uri = request.params?.uri
        const resource = typeof uri === 'string' ? host.resources.get(uri) : null
        if (!resource) { rpcError(request.id, -32602, 'Unknown candidate resource'); continue }
        const resourcePath = await resolveRegularFileWithoutLinks(host.workspace, resource.path, 'Candidate resource')
        const metadata = await stat(resourcePath)
        if (metadata.size > MAX_DRAWING_BYTES) throw new Error(`Candidate resource must be no larger than ${MAX_DRAWING_BYTES} bytes`)
        const bytes = await readFile(resourcePath)
        let text
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
        catch { throw new Error('Candidate resource must be strict UTF-8 text') }
        send({ jsonrpc: '2.0', id: request.id, result: { contents: [{ uri, mimeType: resource.mimeType, text }] } })
        continue
      }
      if (request.method === 'tools/call') {
        if (notification) continue
        const name = request.params?.name, input = request.params?.arguments ?? {}
        const definition = profileDefinitions(host.session.definitions, host.toolProfile).find(tool => tool.name === name)
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
            await toolResponse(request.id, modelVisibleProposal(name, result, host, delivery), false, host)
            continue
          }
        }
        await toolResponse(request.id, modelVisibleProposal(name, result, host), !result.ok)
        continue
      }
      if (!notification) rpcError(request.id, -32601, 'Method not found')
    } catch (error) {
      if (!notification) rpcError(request.id, -32603, 'Internal error', { message: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
}

await main()
