#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { link, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { KJDRAW_VERSION } from '../src/version.js'

const SERVER_NAME = '@kanjieteam/kjdraw-mcp'
const PROTOCOL_VERSION = '2025-11-25'
const SUPPORTED_PROTOCOLS = new Set([PROTOCOL_VERSION, '2025-06-18'])
const MAX_DRAWING_BYTES = 64 * 1024 * 1024
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024

function usage() {
  return `Usage: kjdraw-mcp --workspace <directory> --input <drawing.kjd|drawing.dxf> --proposals <pending.json>\n\nThe host, not the model, chooses all paths. Tool calls can inspect the drawing or create pending proposals; this process never approves a proposal or saves a CAD file.`
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  if (argv.includes('--version') || argv.includes('-v')) return { version: true }
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1]
    if (!['--workspace', '--input', '--proposals'].includes(key) || !value) throw new Error(`Unknown or incomplete argument: ${key ?? ''}`)
    values[key.slice(2)] = value
  }
  for (const key of ['workspace', 'input', 'proposals']) if (!values[key]) throw new Error(`Missing required --${key}`)
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

async function openHost(options) {
  const workspace = await realpath(options.workspace)
  if (!(await stat(workspace)).isDirectory()) throw new Error('--workspace must be a directory')
  const input = await resolveExistingInside(workspace, options.input, '--input')
  const proposals = await resolveOutputInside(workspace, options.proposals)
  if (input === proposals) throw new Error('--proposals must not overwrite --input')
  const format = extname(input).toLowerCase() === '.kjd' ? 'KJD' : extname(input).toLowerCase() === '.dxf' ? 'DXF' : null
  if (!format) throw new Error('--input must be a .kjd or .dxf drawing')
  const metadata = await stat(input)
  if (!metadata.isFile() || metadata.size > MAX_DRAWING_BYTES) throw new Error(`Drawing must be a file no larger than ${MAX_DRAWING_BYTES} bytes`)
  const sourceBytes = await readFile(input)
  const source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes)
  const sdk = createKJDrawSDK()
  const document = await sdk.readDocument(source, { format })
  const session = new KJAgentToolSession(sdk, document)
  const sourceFingerprint = fingerprint(document)
  const ledger = {
    schema: 'com.kanjie.kjdraw.mcp-pending-proposals@1',
    source: {
      path: relative(workspace, input).split(sep).join('/'),
      format,
      byteLength: sourceBytes.byteLength,
      documentId: document.id,
      revision: document.revision,
      units: document.snapshot().header.units,
      fingerprint: sourceFingerprint
    },
    proposals: []
  }
  await exclusiveAtomicJsonCreate(proposals, ledger)
  return { document, session, sourceFingerprint, proposals, ledger }
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
        toolResponse(request.id, result, !result.ok)
        continue
      }
      if (!notification) rpcError(request.id, -32601, 'Method not found')
    } catch (error) {
      if (!notification) rpcError(request.id, -32603, 'Internal error', { message: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
}

await main()
