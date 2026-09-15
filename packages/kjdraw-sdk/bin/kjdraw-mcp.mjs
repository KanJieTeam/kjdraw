#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { KJDRAW_VERSION } from '../src/version.js'

const SERVER_NAME = '@kanjieteam/kjdraw-mcp'
const PROTOCOL_VERSION = '2025-11-25'
const SUPPORTED_PROTOCOLS = new Set([PROTOCOL_VERSION, '2025-06-18'])
const MAX_DRAWING_BYTES = 64 * 1024 * 1024
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024

function usage() {
  return `Usage:\n  kjdraw-mcp --workspace <directory> --input <drawing.kjd|drawing.dxf> --proposals <pending.json>\n  kjdraw-mcp --workspace <directory> --input <drawing.kjd|drawing.dxf> --proposal-dir <existing-relative-directory>\n  kjdraw-mcp --workspace <directory> --blank <new-drawing.kjd> --units <millimeter|meter> --proposals <pending.json>\n  kjdraw-mcp --workspace <directory> --blank <new-drawing.kjd> --units <millimeter|meter> --proposal-dir <existing-relative-directory>\n\n--proposals is the legacy one-file mode. --proposal-dir creates one exclusive ledger per stdio session and exposes its relative path in initialize metadata. The host, not the model, chooses all paths and blank drawing units. Tool calls can inspect the drawing or create pending proposals; this process never approves a proposal or saves a CAD file.`
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  if (argv.includes('--version') || argv.includes('-v')) return { version: true }
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1]
    if (!['--workspace', '--input', '--blank', '--units', '--proposals', '--proposal-dir'].includes(key) || !value || Object.hasOwn(values, key.slice(2))) throw new Error(`Unknown, duplicate or incomplete argument: ${key ?? ''}`)
    values[key.slice(2)] = value
  }
  if (!values.workspace) throw new Error('Missing required --workspace')
  if (Boolean(values.proposals) === Boolean(values['proposal-dir'])) throw new Error('Supply exactly one of --proposals or --proposal-dir')
  if (Boolean(values.input) === Boolean(values.blank)) throw new Error('Supply exactly one of --input or --blank')
  if (values.blank && !['millimeter', 'meter'].includes(values.units)) throw new Error('--blank requires --units millimeter or meter')
  if (values.input && values.units) throw new Error('--units is only allowed with --blank')
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

function toolResponse(id, result, isError = false) {
  send({
    jsonrpc: '2.0', id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      ...(isError ? { isError: true } : {})
    }
  })
}

const COMPACT_ENGINEERING_PROPOSALS = new Set(['cad_propose_geology_column', 'cad_propose_geology_section'])
function modelVisibleProposal(name, result, host) {
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

async function openHost(options) {
  if (options.blank || options['proposal-dir']) {
    const workspaceEntry = await lstat(options.workspace)
    if (workspaceEntry.isSymbolicLink()) throw new Error('--workspace must not be a symbolic link')
  }
  const workspace = await realpath(options.workspace)
  if (!(await stat(workspace)).isDirectory()) throw new Error('--workspace must be a directory')
  const input = options.blank
    ? await resolveVacantFileInside(workspace, options.blank, '--blank')
    : await resolveExistingInside(workspace, options.input, '--input')
  const proposalDir = options['proposal-dir'] ? await resolveSessionLedgerDir(workspace, options['proposal-dir']) : null
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
  const session = new KJAgentToolSession(sdk, document)
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
  return { document, session, sourceFingerprint, proposals, ledger, sessionReceipt }
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
          host.ledger.proposals.push({
            sequence: host.ledger.proposals.length + 1,
            tool: name,
            sourceRevision: beforeRevision,
            sourceFingerprint: beforeFingerprint,
            result: result.value
          })
          await atomicJsonWrite(host.proposals, host.ledger)
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
