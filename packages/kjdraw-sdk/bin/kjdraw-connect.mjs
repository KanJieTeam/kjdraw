#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJDRAW_VERSION } from '../src/version.js'

const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_DRAWING_BYTES = 64 * 1024 * 1024
const DEFAULT_PROPOSALS = 'kjdraw-pending.json'
const MCP_BIN = fileURLToPath(new URL('./kjdraw-mcp.mjs', import.meta.url))
// This is the public docs/assets/mark.svg asset verbatim. Keep it package-local:
// npm packages include bin/ but not the repository-level docs/assets/ directory.
const BRAND_MARK = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#bcf878"/><g fill="none" stroke="#17251b" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter"><path d="M17 16v32M47 16 23 32l24 16M36 23v18"/></g><circle cx="23" cy="32" r="4" fill="#17251b"/></svg>'

const adapters = Object.freeze([
  { id: 'kimi-code', file: '.kimi-code/mcp.json', key: ['mcpServers'], note: 'Project trust and a new session are required.' },
  { id: 'zcode', file: '.zcode/config.json', key: ['mcp', 'servers'], note: 'The native .zcode config takes priority over .agents/mcp.json.' },
  { id: 'traecode', file: '.trae/mcp.json', key: ['mcpServers'], note: 'Project-level MCP must be enabled and trusted in TraeCode settings.' },
])

function hash(value) { return createHash('sha256').update(value).digest('hex') }
function jsonHash(value) { return hash(JSON.stringify(value)) }
function fail(message) { throw new Error(message) }
function htmlText(value) { return String(value).replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]) }

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  if (argv.includes('--smoke-circle')) {
    if (argv.length !== 3 || argv[0] !== '--smoke-circle' || argv[1] !== '--workspace' || !argv[2]) fail('Smoke mode requires only --smoke-circle --workspace <explicit directory>')
    return { smokeCircle: true, workspace: argv[2] }
  }
  const values = Object.create(null)
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--all' || key === '--dry-run') {
      if (values[key]) fail(`Duplicate option: ${key}`)
      values[key] = true
      continue
    }
    if (!['--workspace', '--input', '--proposals'].includes(key) || !argv[i + 1] || Object.hasOwn(values, key)) fail(`Unknown, duplicate or incomplete option: ${key}`)
    values[key] = argv[++i]
  }
  if (!values['--all'] || !values['--dry-run']) fail('This release supports only --all --dry-run; no configuration is ever written')
  if (!values['--workspace'] || !values['--input']) fail('Supply explicit --workspace and --input')
  return { workspace: values['--workspace'], input: values['--input'], proposals: values['--proposals'] ?? DEFAULT_PROPOSALS }
}

function relativeFile(value, label) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.split(/[\\/]+/u).some(part => !part || part === '.' || part === '..') || /^[A-Za-z]:/u.test(value)) fail(`${label} must be an unambiguous relative path inside --workspace`)
  return value
}

function inside(root, candidate) {
  const part = relative(root, candidate)
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
}

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

async function existingInput(workspace, name) {
  relativeFile(name, '--input')
  const candidate = await realpath(resolve(workspace, name))
  if (!inside(workspace, candidate)) fail('--input resolves outside --workspace')
  const suffix = extname(candidate).toLowerCase()
  if (!['.kjd', '.dxf'].includes(suffix)) fail('--input must be an existing .kjd or .dxf drawing')
  const metadata = await stat(candidate)
  if (!metadata.isFile() || metadata.size > MAX_DRAWING_BYTES) fail('--input must be a file no larger than 64 MiB')
  return { suffix, byteLength: metadata.size, pathHash: hash(candidate) }
}

async function pendingStatus(workspace, name) {
  relativeFile(name, '--proposals')
  const candidate = resolve(workspace, name)
  const parent = await realpath(dirname(candidate))
  if (!inside(workspace, parent) || !inside(workspace, candidate)) fail('--proposals resolves outside --workspace')
  const canonicalCandidate = resolve(parent, basename(candidate))
  try {
    await lstat(candidate)
    return { exists: true, pathHash: hash(canonicalCandidate), canonicalPath: canonicalCandidate }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { exists: false, pathHash: hash(canonicalCandidate), canonicalPath: canonicalCandidate }
  }
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}

function containerFor(config, key) {
  let current = config
  for (const field of key) {
    if (!Object.hasOwn(current, field)) current[field] = {}
    if (!plainObject(current[field])) fail('Official MCP configuration container has an incompatible shape')
    current = current[field]
  }
  return current
}

async function adapterPlan(workspace, adapter, desired) {
  const path = join(workspace, adapter.file)
  let fileHash = null, config = {}, exists = false
  const parent = dirname(path)
  try {
    const parentEntry = await lstat(parent)
    if (parentEntry.isSymbolicLink() || !parentEntry.isDirectory()) return { adapter: adapter.id, configFile: adapter.file, status: 'unsafe-config-parent', note: adapter.note }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isFile()) return { adapter: adapter.id, configFile: adapter.file, status: 'unsafe-config-target', note: adapter.note }
    if (entry.size > MAX_CONFIG_BYTES) return { adapter: adapter.id, configFile: adapter.file, status: 'oversized-config', note: adapter.note }
    const bytes = await readFile(path)
    exists = true
    fileHash = hash(bytes)
    try { config = JSON.parse(bytes.toString('utf8')) }
    catch { return { adapter: adapter.id, configFile: adapter.file, status: 'invalid-json', existingFileHash: fileHash, note: adapter.note } }
    if (!plainObject(config)) return { adapter: adapter.id, configFile: adapter.file, status: 'invalid-schema', existingFileHash: fileHash, note: adapter.note }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  let servers
  try { servers = containerFor(config, adapter.key) }
  catch { return { adapter: adapter.id, configFile: adapter.file, status: 'invalid-schema', existingFileHash: fileHash, note: adapter.note } }
  const existing = Object.hasOwn(servers, 'kjdraw') ? servers.kjdraw : undefined
  const existingEntryHash = existing === undefined ? null : jsonHash(existing)
  const desiredEntryHash = jsonHash(desired)
  const operation = existing === undefined ? 'add' : existingEntryHash === desiredEntryHash ? 'unchanged' : 'conflict'
  if (operation === 'add') servers.kjdraw = desired
  const targetHash = operation === 'conflict' ? null : operation === 'unchanged' ? fileHash : hash(`${JSON.stringify(config, null, 2)}\n`)
  return {
    adapter: adapter.id, configFile: adapter.file, status: operation,
    existingFileHash: fileHash, existingEntryHash, desiredEntryHash, targetHash,
    change: operation === 'add' ? { op: 'add', pointer: `/${adapter.key.join('/')}/kjdraw`, entryHash: desiredEntryHash } : null,
    configExists: exists, note: adapter.note,
  }
}

async function dryRun(args) {
  if (!isAbsolute(args.workspace)) fail('--workspace must be an explicit absolute directory')
  const workspaceEntry = await lstat(args.workspace)
  if (workspaceEntry.isSymbolicLink() || !workspaceEntry.isDirectory()) fail('--workspace must be a real directory, not a symbolic link')
  const workspace = await realpath(args.workspace)
  const input = await existingInput(workspace, args.input)
  const pending = await pendingStatus(workspace, args.proposals)
  if (samePath(await realpath(resolve(workspace, args.input)), pending.canonicalPath)) fail('--proposals must not be the input drawing')
  const desired = {
    command: process.execPath,
    args: [MCP_BIN, '--workspace', workspace, '--input', args.input, '--proposals', args.proposals],
  }
  const plans = []
  for (const adapter of adapters) {
    const plan = await adapterPlan(workspace, adapter, desired)
    if (adapter.id === 'traecode' && process.execPath.includes(' ')) plan.status = 'unsupported-command-path'
    plans.push(plan)
  }
  plans.push({ adapter: 'workbuddy', status: 'manual-verification-required', configFile: null, note: 'No verified local config schema; HTTP/live integration must be checked on the target installation.' })
  const body = {
    schema: 'com.kanjie.kjdraw.connect-dry-run@1', product: 'KJDraw', version: KJDRAW_VERSION,
    engineInvoked: false, writesPerformed: 0,
    source: { format: input.suffix.slice(1).toUpperCase(), byteLength: input.byteLength, pathHash: input.pathHash },
    proposalLedger: { pathHash: pending.pathHash, exists: pending.exists, startupStatus: pending.exists ? 'blocked-existing-ledger' : 'first-start-only-static-ledger', note: 'A static ledger path cannot support repeated MCP startups; connection is not yet release-ready.' },
    adapters: plans,
  }
  return { ...body, planHash: jsonHash(body) }
}

function oneCircle(document, label) {
  const entities = document.listEntities()
  if (entities.length !== 1 || entities[0].type !== 'CIRCLE' || entities[0].payload?.radius !== 5) fail(`${label} did not retain exactly one radius-5 circle`)
  if (document.validate().valid !== true) fail(`${label} validation failed`)
  return { count: entities.length, radius: entities[0].payload.radius, valid: true }
}

async function smokeCircle(args) {
  if (!isAbsolute(args.workspace)) fail('--workspace must be an explicit absolute directory')
  const workspaceEntry = await lstat(args.workspace)
  if (workspaceEntry.isSymbolicLink() || !workspaceEntry.isDirectory()) fail('--workspace must be a real directory, not a symbolic link')
  const workspace = await realpath(args.workspace)
  const artifactDirectory = await mkdtemp(join(workspace, 'kjdraw-smoke-'))
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `kjdraw-smoke-${Date.now()}`, units: 'millimeter' })
  await document.transact('KJDraw smoke circle', transaction => {
    transaction.createEntity('CIRCLE', { center: [10, 10, 0], radius: 5 }, { id: 'smoke-circle' })
  })
  const afterTransaction = oneCircle(document, 'Transaction')
  await document.undo()
  if (document.listEntities().length !== 0) fail('Undo did not remove the circle')
  await document.redo()
  oneCircle(document, 'Redo')
  const artifacts = []
  for (const format of ['KJD', 'DXF']) {
    const extension = format.toLowerCase()
    const name = `circle.${extension}`
    const bytes = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const path = join(artifactDirectory, name)
    await writeFile(path, bytes, { flag: 'wx' })
    const diskBytes = await readFile(path)
    const reopened = await createKJDrawSDK().readDocument(diskBytes, { format })
    const verified = oneCircle(reopened, `${format} disk reopen`)
    artifacts.push({ format, file: name, byteLength: diskBytes.length, sha256: hash(diskBytes), diskReopen: verified })
  }
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }
  const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cad_read_drawing', arguments: {} } }
  const rpc = spawnSync(process.execPath, [MCP_BIN, '--workspace', artifactDirectory, '--input', 'circle.kjd', '--proposals', 'smoke-ledger.json'], {
    input: `${JSON.stringify(initialize)}\n${JSON.stringify(call)}\n`, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  })
  if (rpc.status !== 0 || rpc.stderr || !rpc.stdout.trim()) fail('The KJDraw MCP read tool did not complete')
  const responses = rpc.stdout.trim().split('\n').map(line => JSON.parse(line))
  const response = responses[1]
  const value = response.result?.structuredContent?.value
  if (responses.length !== 2 || responses[0].id !== 1 || responses[0].result?.serverInfo?.name !== '@kanjieteam/kjdraw-mcp' || response.id !== 2 || !value || value.entities?.length !== 1 || value.entities[0]?.type !== 'CIRCLE') fail('The KJDraw MCP read tool did not return the saved circle')
  const ledgerBytes = await readFile(join(artifactDirectory, 'smoke-ledger.json'))
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>KJDraw engine smoke receipt</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#17251b;color:#f6f8f1;margin:0;padding:32px}main{max-width:800px;margin:auto}.brand{display:flex;align-items:center;gap:16px}h1{margin:0}h2{margin-top:32px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #5d7565}code{overflow-wrap:anywhere;color:#bcf878}.notice{background:#314b38;padding:12px;border-radius:8px}</style></head><body><main><div class="brand">${BRAND_MARK}<div><h1>KJDraw engine smoke</h1><p>Version ${htmlText(KJDRAW_VERSION)}</p></div></div><p class="notice">Local fixture only. No real model was invoked; this receipt does not prove complex engineering drawing quality.</p><h2>Executed checks</h2><table><tr><th>Check</th><th>Observed result</th></tr><tr><td>SDK</td><td>createKJDrawSDK; one transaction; one CIRCLE with radius 5 mm</td></tr><tr><td>Undo / redo</td><td>Circle removed, then restored and validated</td></tr><tr><td>MCP</td><td>${htmlText(responses[0].result.serverInfo.name)} process; initialize RPC; one tools/call cad_read_drawing; saved circle returned</td></tr><tr><td>KJD / DXF</td><td>Both written to disk and independently reopened; one radius-5 circle, valid document</td></tr></table><h2>On-disk artifact hashes</h2><table><tr><th>File</th><th>SHA-256</th><th>Bytes</th></tr>${artifacts.map(item => `<tr><td>${htmlText(item.file)}</td><td><code>${htmlText(item.sha256)}</code></td><td>${item.byteLength}</td></tr>`).join('')}<tr><td>smoke-ledger.json</td><td><code>${htmlText(hash(ledgerBytes))}</code></td><td>${ledgerBytes.length}</td></tr></table></main></body></html>\n`
  const htmlBytes = Buffer.from(html)
  await writeFile(join(artifactDirectory, 'receipt.html'), htmlBytes, { flag: 'wx' })
  return {
    schema: 'com.kanjie.kjdraw.smoke-circle@1', product: 'KJDraw', version: KJDRAW_VERSION,
    fixtureOnly: true, realModelInvoked: false, engineInvoked: true,
    artifactDirectory: basename(artifactDirectory),
    sdk: { entrypoint: 'createKJDrawSDK', transactionCount: 1, afterTransaction, undoRemovedEntity: true, redoRestoredEntity: true },
    mcp: { processInvoked: true, serverName: responses[0].result.serverInfo.name, toolCalls: 1, tool: 'cad_read_drawing', savedEntityCount: value.entities.length, ledgerSha256: hash(ledgerBytes) },
    artifacts, htmlReceipt: { file: 'receipt.html', sha256: hash(htmlBytes) },
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--apply')) {
    const { runApplyCli } = await import('./kjdraw-connect-apply.mjs')
    await runApplyCli(argv)
    return
  }
  const args = parseArgs(argv)
  if (args.help) {
    process.stdout.write('KJDraw connect (project-scoped MCP installer, read-only preview and fixture smoke)\nUsage: node kjdraw-connect.mjs --all --apply --workspace <project> (--input <existing.kjd|.dxf> | --blank <new.kjd> --units millimeter|meter) [--geology-column-pack <relative.json> --geology-column-pack-sha256 <sha256>]\n       node kjdraw-connect.mjs --all --dry-run --workspace <absolute-dir> --input <relative.kjd|.dxf> [--proposals <relative.json>]\n       node kjdraw-connect.mjs --smoke-circle --workspace <explicit-dir>\nWithout --apply, no real configuration is written. Smoke artifacts are local fixtures, not real-model evidence. Static proposal ledgers are one-start-only.\n')
    return
  }
  process.stdout.write(`${JSON.stringify(args.smokeCircle ? await smokeCircle(args) : await dryRun(args), null, 2)}\n`)
}

main().catch(error => {
  const safe = error instanceof Error && !('code' in error) ? error.message : 'Unable to inspect the requested drawing or configuration safely'
  process.stderr.write(`KJDraw connect: ${safe}\n`)
  process.exitCode = 1
})
