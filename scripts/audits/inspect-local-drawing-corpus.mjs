import { createHash } from 'node:crypto'
import { opendir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, relative, resolve } from 'node:path'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { displayedEntityBounds } from '../../packages/kjdraw-sdk/src/selection-geometry.js'

function argumentsOf(argv) {
  const options = { root: '', output: '', limit: Number.POSITIVE_INFINITY }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index], value = argv[index + 1]
    if (name === '--root' && value) { options.root = value; index += 1 }
    else if (name === '--output' && value) { options.output = value; index += 1 }
    else if (name === '--limit' && value && Number.isSafeInteger(Number(value)) && Number(value) > 0) { options.limit = Number(value); index += 1 }
    else throw new Error(`Unknown or incomplete argument: ${name}`)
  }
  if (!options.root) throw new Error('Usage: node scripts/audits/inspect-local-drawing-corpus.mjs --root <drawing-directory> [--output report.json] [--limit N]')
  return options
}

async function walk(directory, files = []) {
  const handle = await opendir(directory)
  for await (const entry of handle) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await walk(path, files)
    else if (entry.isFile() && ['.dxf', '.dwg'].includes(extname(entry.name).toLowerCase())) files.push(path)
  }
  return files
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const kindOf = path => /柱状图/u.test(path) ? 'geology-column-template'
  : /剖面图/u.test(path) ? 'geology-section-template'
    : /平面图/u.test(path) ? 'geology-plan-template'
      : 'unclassified-cad'

function drawingBounds(document, entities) {
  const bounds = entities.map(entity => displayedEntityBounds(document, entity)).filter(Boolean)
  if (!bounds.length) return null
  return bounds.reduce((result, item) => [
    Math.min(result[0], item[0]), Math.min(result[1], item[1]),
    Math.max(result[2], item[2]), Math.max(result[3], item[3]),
  ])
}

function summarizeDrawing(document) {
  const entities = document.listEntities()
  const entityTypes = Object.fromEntries([...new Set(entities.map(entity => entity.type))].sort().map(type => [type, entities.filter(entity => entity.type === type).length]))
  const textEntities = entities.filter(entity => entity.type === 'TEXT' || entity.type === 'MTEXT')
  const visibleText = textEntities.map(entity => String(entity.payload.text ?? ''))
  const snapshot = document.snapshot()
  return {
    units: snapshot.header?.units ?? null,
    entityCount: entities.length,
    entityTypes,
    proxyEntityCount: entityTypes.PROXY_ENTITY ?? 0,
    layerCount: document.getTable('layers')?.records.length ?? 0,
    blockDefinitionCount: document.listObjects({ type: 'BLOCK_RECORD' }).length,
    layoutCount: snapshot.spaces?.layoutIds?.length ?? 0,
    textCount: textEntities.length,
    chineseTextCount: visibleText.filter(text => /[\u3400-\u9fff]/u.test(text)).length,
    bounds: drawingBounds(document, entities),
  }
}

const options = argumentsOf(process.argv.slice(2))
const root = resolve(options.root)
const sourceFiles = (await walk(root)).sort((left, right) => left.localeCompare(right)).slice(0, options.limit)
const sdk = createKJDrawSDK()
const files = []
for (const path of sourceFiles) {
  const bytes = await readFile(path), format = extname(path).slice(1).toUpperCase()
  const entry = { path: relative(root, path).replaceAll('\\', '/'), format, kind: kindOf(path), byteLength: bytes.length, sha256: digest(bytes) }
  if (format === 'DWG') files.push({ ...entry, status: 'opaque-source', reason: 'DWG requires an explicitly configured host converter; no geometry was guessed.' })
  else {
    try {
      const drawing = await sdk.readDocument(bytes, { format: 'DXF' })
      files.push({ ...entry, status: 'parsed', ...summarizeDrawing(drawing) })
    } catch (error) {
      files.push({ ...entry, status: 'rejected', reason: error instanceof Error ? error.message : String(error) })
    }
  }
}
const totals = {
  files: files.length,
  parsed: files.filter(file => file.status === 'parsed').length,
  opaqueSources: files.filter(file => file.status === 'opaque-source').length,
  rejected: files.filter(file => file.status === 'rejected').length,
  entities: files.reduce((sum, file) => sum + (file.entityCount ?? 0), 0),
  proxies: files.reduce((sum, file) => sum + (file.proxyEntityCount ?? 0), 0),
  byKind: Object.fromEntries([...new Set(files.map(file => file.kind))].sort().map(kind => [kind, files.filter(file => file.kind === kind).length])),
}
const report = { schema: 'com.kanjie.kjdraw.local-drawing-corpus-audit@1', generatedAt: new Date().toISOString(), rootName: basename(root), totals, files }
const json = `${JSON.stringify(report, null, 2)}\n`
if (options.output) await writeFile(resolve(options.output), json, { flag: 'wx' })
process.stdout.write(json)
if (totals.rejected) process.exitCode = 1
