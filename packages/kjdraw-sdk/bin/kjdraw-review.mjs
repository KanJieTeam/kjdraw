#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createKJDrawSDK } from '../src/sdk.js'
import { agentPreviewMatchesDocument, createAgentGeometryPreview } from '../src/agent-preview.js'

const MAX_LEDGER_BYTES = 16 * 1024 * 1024
const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const SHA = /^[a-f0-9]{64}$/u

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function fail(message) { throw new Error(message) }
function inside(root, path) {
  const part = relative(root, path)
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}
function relativeName(name, label) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || /^[A-Za-z]:/u.test(name) || name.split(/[\\/]+/u).some(part => !part || part === '.' || part === '..')) fail(`${label} must be an unambiguous project-relative path`)
  return name
}
async function entry(path) {
  try { return await lstat(path) } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}
async function checkedPath(root, name, label, mode) {
  relativeName(name, label)
  const path = resolve(root, name)
  if (!inside(root, path) || path === root) fail(`${label} escapes the project`)
  let walk = root
  for (const part of relative(root, path).split(sep)) {
    walk = resolve(walk, part)
    const info = await entry(walk)
    if (info?.isSymbolicLink()) fail(`${label} traverses a symbolic link`)
    if (walk !== path && (!info || !info.isDirectory())) fail(`${label} parent must already be a real directory`)
    if (walk === path && (mode === 'existing' ? !info?.isFile() : info !== null)) fail(`${label} must ${mode === 'existing' ? 'be a regular file' : 'not exist yet'}`)
  }
  return path
}
async function sourceState(path, expected) {
  const info = await entry(path)
  if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_SOURCE_BYTES) fail('Source drawing is no longer a bounded regular file')
  const bytes = await readFile(path)
  if (bytes.length !== expected.byteLength || sha(bytes) !== expected.sha256) fail('Source drawing bytes changed since the MCP proposal')
  return bytes
}
function counts(document) {
  const values = {}
  for (const entity of document.listEntities()) values[entity.type] = (values[entity.type] ?? 0) + 1
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))
}
function fingerprint(document) { return sha(JSON.stringify(document.serialize())) }
function exactProposal(ledger, sequence) {
  if (ledger?.schema !== 'com.kanjie.kjdraw.mcp-pending-proposals@1' || !ledger.source || !Array.isArray(ledger.proposals)) fail('Unsupported proposal ledger')
  const source = ledger.source
  if (!SHA.test(source.sha256) || !SHA.test(source.fingerprint) || !Number.isSafeInteger(source.byteLength) || source.byteLength > MAX_SOURCE_BYTES || !Number.isSafeInteger(source.revision) || typeof source.documentId !== 'string' || !source.documentId) fail('Ledger lacks a valid source byte and document identity lock')
  if (source.format !== 'KJD' && source.format !== 'DXF') fail('Ledger source format is not a CAD document')
  const item = ledger.proposals[sequence - 1]
  if (!item || item.sequence !== sequence || item.sourceRevision !== source.revision || item.sourceFingerprint !== source.fingerprint || typeof item.tool !== 'string' || !item.tool.startsWith('cad_propose_')) fail('Selected proposal is not bound to this source and sequence')
  const value = item.result
  if (!value || value.command !== 'CREATEBATCH' || value.status !== 'awaiting-host-approval' || value.documentId !== source.documentId || value.expectedRevision !== source.revision || value.units !== source.units || typeof value.planId !== 'string' || !value.planId || !value.arguments || !Array.isArray(value.arguments.entities) || !value.preview) fail('Selected proposal is not an exact CREATEBATCH preview')
  if (value.preview.documentId !== source.documentId || value.preview.revision !== source.revision || value.preview.command !== 'CREATEBATCH') fail('Reviewed preview belongs to another drawing or command')
  if (Object.keys(value.arguments).some(key => !['entities', 'resources'].includes(key))) fail('CREATEBATCH has unexpected native arguments')
  return { source, item, value }
}
async function stagedLink(path, bytes, created, stages) {
  const stage = `${path}.kjdraw-stage-${randomUUID()}`
  await writeFile(stage, bytes, { flag: 'wx', mode: 0o600 })
  stages.push(stage)
  await link(stage, path)
  created.push({ path, sha256: sha(bytes) })
}
async function cleanupOwn(created, stages) {
  for (const item of created.reverse()) {
    const info = await entry(item.path)
    if (info?.isFile() && !info.isSymbolicLink() && sha(await readFile(item.path)) === item.sha256) await unlink(item.path)
  }
  for (const path of stages) await unlink(path).catch(error => { if (error?.code !== 'ENOENT') throw error })
}
async function withExclusiveClaim(ledgerPath, sequence, oldPlanId, proposalSha, ledgerSha, sourceSha, candidatePath, work) {
  const identitySha = sha(JSON.stringify({ ledgerPath, sequence, oldPlanId, sourceSha }))
  const path = `${ledgerPath}.kjdraw-review-${identitySha}.claim.json`
  const bytes = Buffer.from(`${JSON.stringify({ schema: 'com.kanjie.kjdraw.host-review-claim@1', sequence,
    oldPlanId, identitySha256: identitySha, proposalSha256: proposalSha, ledgerSha256: ledgerSha,
    sourceSha256: sourceSha, candidatePath, nonce: randomUUID() })}\n`)
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }) }
  catch (error) { if (error?.code === 'EEXIST') fail('This exact proposal has already been claimed or consumed'); throw error }
  let succeeded = false
  try {
    const result = await work({ path, sha256: sha(bytes) })
    succeeded = true
    return result
  } finally {
    if (!succeeded) {
      const info = await entry(path)
      if (info?.isFile() && !info.isSymbolicLink() && sha(await readFile(path)) === sha(bytes)) await unlink(path)
    }
  }
}

/** Host-side core. This is deliberately not an MCP tool or package export. */
export async function reviewLedger(options, confirm) {
  if (!Number.isSafeInteger(options.sequence) || options.sequence < 1 || options.sequence > 128) fail('--sequence must be 1–128')
  if (!isAbsolute(options.workspace)) fail('--workspace must be an explicit absolute directory')
  const rootInfo = await entry(options.workspace)
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) fail('--workspace must be a real directory')
  const root = await realpath(options.workspace)
  const ledgerPath = await checkedPath(root, options.ledger, '--ledger', 'existing')
  if (extname(ledgerPath).toLowerCase() !== '.json') fail('--ledger must be JSON')
  if (extname(options.candidate).toLowerCase() !== '.kjd') fail('--candidate must be a new KJD path')
  const candidatePath = await checkedPath(root, options.candidate, '--candidate', 'vacant')
  const stem = candidatePath.slice(0, -4)
  const dxfPath = await checkedPath(root, `${relative(root, stem)}.dxf`, 'candidate DXF', 'vacant')
  const receiptPath = await checkedPath(root, `${relative(root, stem)}.review.json`, 'review receipt', 'vacant')
  const ledgerInfo = await stat(ledgerPath)
  if (ledgerInfo.size > MAX_LEDGER_BYTES) fail('Proposal ledger exceeds the 16 MiB review bound')
  const ledgerBytes = await readFile(ledgerPath)
  if (ledgerBytes.length > MAX_LEDGER_BYTES) fail('Proposal ledger grew during review')
  let ledger
  try { ledger = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(ledgerBytes)) }
  catch { fail('Proposal ledger is not strict UTF-8 JSON') }
  const { source, item, value } = exactProposal(ledger, options.sequence)
  const sourcePath = await checkedPath(root, source.path, 'ledger source', 'existing')
  if ([candidatePath, dxfPath, receiptPath, ledgerPath].includes(sourcePath)) fail('Candidate may not alias source or ledger')
  const sourceBytes = await sourceState(sourcePath, source)
  const sdk = createKJDrawSDK()
  const document = await sdk.readDocument(new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes), { format: source.format })
  if (!document.validate().valid || document.id !== source.documentId || document.revision !== source.revision || document.snapshot().header.units !== source.units || fingerprint(document) !== source.fingerprint) fail('Ledger document identity or fingerprint disagrees with independently reopened source')
  const nativeArgs = value.arguments
  const recomputed = await createAgentGeometryPreview(document, 'CREATEBATCH', nativeArgs, { maxCreatedEntities: 512 })
  if (!isDeepStrictEqual(recomputed, value.preview)) fail('Native preview disagrees with the ledger; arguments or preview may be forged')
  const previewSha = sha(JSON.stringify(recomputed))
  const proposalSha = sha(JSON.stringify(item))
  return withExclusiveClaim(ledgerPath, options.sequence, value.planId, proposalSha, sha(ledgerBytes), source.sha256, relative(root, candidatePath), async claim => {
  const summary = { product: 'KJDraw', command: 'CREATEBATCH', source: source.path, sourceSha256: source.sha256,
    ledger: options.ledger, sequence: options.sequence, oldPlanId: value.planId, proposalSha256: proposalSha,
    previewSha256: previewSha, createdEntityCount: recomputed.after.length,
    candidate: relative(root, candidatePath).split(sep).join('/'), preview: recomputed }
  const confirmation = typeof confirm === 'function' ? await confirm(summary) : false
  if (confirmation !== true && confirmation !== 'tty') fail('Host did not confirm this exact reviewed proposal')
  if (sha(await readFile(ledgerPath)) !== sha(ledgerBytes)) fail('Proposal ledger changed during host review')
  await sourceState(sourcePath, source)
  const definition = sdk.commands.resolve('CREATEBATCH')
  if (!definition || definition.owner !== '@kanjieteam/kjdraw' || definition.transactional === false) fail('Native CREATEBATCH command is not the built-in transactional implementation')
  const planned = sdk.createCommandEnvelope('CREATEBATCH', nativeArgs, { document, mode: 'plan', origin: 'ai', expectedRevision: source.revision })
  await sdk.executeCommandEnvelope(planned, { document })
  const execution = sdk.createCommandEnvelope('CREATEBATCH', nativeArgs, { document, origin: 'ai', expectedRevision: source.revision,
    confirmation: { status: 'confirmed', planId: planned.id, confirmedBy: String(options.reviewer ?? 'interactive-local-reviewer') } })
  const committed = await sdk.executeCommandEnvelope(execution, { document, expectedCommandDefinition: definition })
  if (committed.status !== 'committed' || document.revision !== source.revision + 1 || !document.validate().valid || !agentPreviewMatchesDocument(document, recomputed)) fail('Approved candidate did not match the reviewed native preview in one valid transaction')
  const committedRevision = document.revision
  const kjdBytes = await sdk.writeDocument(document, { format: 'KJD' })
  const dxfBytes = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const kjd = await createKJDrawSDK().readDocument(kjdBytes, { format: 'KJD' })
  const dxf = await createKJDrawSDK().readDocument(dxfBytes, { format: 'DXF' })
  if (!kjd.validate().valid || kjd.id !== document.id || kjd.revision !== document.revision || fingerprint(kjd) !== fingerprint(document) || !agentPreviewMatchesDocument(kjd, recomputed)) fail('Candidate KJD did not independently reopen with exact document state')
  if (!dxf.validate().valid || !isDeepStrictEqual(counts(dxf), counts(document))) fail('Candidate DXF did not independently reopen with the same editable native entity types')
  await document.undo()
  if (!document.validate().valid || document.listEntities().length !== kjd.listEntities().length - recomputed.after.length) fail('Live approved transaction undo did not remove exactly the reviewed creation batch')
  await document.redo()
  if (!document.validate().valid || !agentPreviewMatchesDocument(document, recomputed)) fail('Live approved transaction redo did not restore the exact reviewed creation batch')
  await sourceState(sourcePath, source)
  const receipt = { schema: 'com.kanjie.kjdraw.host-review@1', product: 'KJDraw', hostConfirmed: confirmation === 'tty',
    confirmationMethod: confirmation === 'tty' ? 'interactive-tty-challenge' : 'internal-test-fixture',
    hostAuthentication: 'No cryptographic operator authentication', noInputOverwrite: true,
    ledger: { path: options.ledger, sha256: sha(ledgerBytes), sequence: options.sequence, oldPlanId: value.planId, proposalSha256: proposalSha },
    exclusiveClaim: { path: relative(root, claim.path).split(sep).join('/'), sha256: claim.sha256, retainedAsConsumedMarker: true },
    source: { path: source.path, sha256: source.sha256, fingerprint: source.fingerprint, documentId: source.documentId, revision: source.revision },
    execution: { command: 'CREATEBATCH', nativeArgumentsSha256: sha(JSON.stringify(nativeArgs)), previewSha256: previewSha,
      newHostPlanId: planned.id, beforeRevision: source.revision, afterRevision: committedRevision,
      createdEntityCount: recomputed.after.length, liveUndoRedoVerified: true, reopenUndoHistory: false, candidateValid: true },
    candidates: { kjd: { path: relative(root, candidatePath).split(sep).join('/'), sha256: sha(kjdBytes), bytes: Buffer.byteLength(kjdBytes), exactKjdReopen: true },
      dxf: { path: relative(root, dxfPath).split(sep).join('/'), sha256: sha(dxfBytes), bytes: Buffer.byteLength(dxfBytes), nativeTypesMatchOnReopen: true } },
    risks: ['A shell-capable agent can forge a TTY, change a self-consistent plan ID, or delete a workspace claim; this CLI does not authenticate a physical person or defeat a malicious project writer.',
      'KJD independently reopens exact saved geometry, but this format does not restore the previous session undo stack.',
      'The source drawing is never overwritten; another process can change it after the final byte check, so the receipt binds the reviewed source SHA.'] }
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)
  const created = [], stages = []
  try {
    await sourceState(sourcePath, source)
    if (sha(await readFile(ledgerPath)) !== sha(ledgerBytes)) fail('Proposal ledger changed before candidate creation')
    await stagedLink(candidatePath, kjdBytes, created, stages)
    await stagedLink(dxfPath, dxfBytes, created, stages)
    await stagedLink(receiptPath, receiptBytes, created, stages)
    await sourceState(sourcePath, source)
    if (sha(await readFile(ledgerPath)) !== sha(ledgerBytes)) fail('Proposal ledger changed after candidate creation')
    return receipt
  } catch (error) {
    await cleanupOwn(created, stages)
    throw error
  } finally {
    for (const path of stages) await unlink(path).catch(error => { if (error?.code !== 'ENOENT') throw error })
  }
  })
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  const value = { approve: false }
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (key === '--approve' && !value.approve) { value.approve = true; continue }
    if (!['--workspace', '--ledger', '--sequence', '--candidate', '--reviewer'].includes(key) || !argv[index + 1] || Object.hasOwn(value, key.slice(2))) fail('Unknown, duplicate or incomplete review option')
    value[key.slice(2)] = argv[++index]
  }
  if (!value.approve || !value.workspace || !value.ledger || !value.sequence || !value.candidate) fail('Explicit --approve, --workspace, --ledger, --sequence and --candidate are required')
  value.sequence = Number(value.sequence)
  return value
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write('KJDraw host review (CREATEBATCH only)\nUsage: kjdraw-review --workspace <absolute-project> --ledger <relative-session.json> --sequence <1-128> --candidate <new-relative.kjd> --approve [--reviewer <local-label>]\nRequires an interactive TTY challenge. Never overwrites the input drawing. No MCP tool can call this as part of the KJDraw server.\n')
    return
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail('Interactive host TTY is required; no non-interactive --approve shortcut exists')
  const receipt = await reviewLedger(options, async summary => {
    const challenge = randomUUID().slice(0, 8)
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    try { return (await prompt.question(`Type KJDRAW ${challenge} to create only the new candidate files: `)).trim() === `KJDRAW ${challenge}` ? 'tty' : false }
    finally { prompt.close() }
  })
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) main().catch(error => {
  process.stderr.write(`kjdraw-review: ${error instanceof Error ? error.message : 'Host review failed'}\n`)
  process.exitCode = 1
})
