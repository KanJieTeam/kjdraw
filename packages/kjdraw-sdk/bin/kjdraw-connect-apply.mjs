#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createKJDrawSDK } from '../src/sdk.js'
import { validateKnowledgePack } from '../src/knowledge-pack.js'
import { KJDRAW_VERSION } from '../src/version.js'

const CLIENTS = Object.freeze([
  { name: 'Kimi Code', path: '.kimi-code/mcp.json', keys: ['mcpServers'] },
  // Official WorkBuddy MCP guide: project .workbuddy/mcp.json, mcpServers,
  // local command/args entry. Configuration alone does not verify its GUI.
  { name: 'WorkBuddy', path: '.workbuddy/mcp.json', keys: ['mcpServers'], guide: 'https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide' },
  { name: 'ZCode', path: '.zcode/config.json', keys: ['mcp', 'servers'] },
  { name: 'TraeCode', path: '.trae/mcp.json', keys: ['mcpServers'] },
])
const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_DRAWING_BYTES = 64 * 1024 * 1024
const MAX_KNOWLEDGE_PACK_BYTES = 1024 * 1024

function usage() {
  return `Usage: kjdraw-connect --all --workspace <project> (--input <existing.kjd|drawing.dxf> | --blank <new.kjd> --units millimeter|meter) [--proposal-dir .kjdraw/proposals] [--geology-column-pack <relative.json> --geology-column-pack-sha256 <sha256>] [--apply]\n\nWithout --apply this is a read-only preview. Only project-level Kimi Code, WorkBuddy, ZCode and TraeCode MCP entries named kjdraw are managed. Host review is required for every pending proposal.`
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  const options = { apply: false, all: false, proposalDir: '.kjdraw/proposals' }
  const seen = new Set()
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`)
    seen.add(key)
    if (key === '--all' || key === '--apply') { options[key.slice(2)] = true; continue }
    if (!['--workspace', '--input', '--blank', '--units', '--proposal-dir', '--geology-column-pack', '--geology-column-pack-sha256'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Unknown or incomplete option')
    options[key === '--proposal-dir' ? 'proposalDir' : key.slice(2)] = argv[++i]
  }
  if (!options.all || !options.workspace) throw new Error('--all and --workspace are required')
  if (Boolean(options.input) === Boolean(options.blank)) throw new Error('Choose exactly one of --input or --blank')
  if (options.blank && !['millimeter', 'meter'].includes(options.units)) throw new Error('--blank requires --units millimeter|meter')
  if (options.input && options.units) throw new Error('--units is only for --blank')
  if (Boolean(options['geology-column-pack']) !== Boolean(options['geology-column-pack-sha256'])) throw new Error('Geology column pack path and SHA-256 must be supplied together')
  if (options['geology-column-pack-sha256'] && !/^[a-f0-9]{64}$/u.test(options['geology-column-pack-sha256'])) throw new Error('Geology column pack SHA-256 must be lowercase hexadecimal')
  return options
}

function assertRelative(value, label) {
  if (!value || isAbsolute(value) || value.split(/[\\/]+/u).includes('..')) throw new Error(`${label} must remain inside --workspace`)
}

function inside(root, candidate) {
  const part = relative(root, candidate)
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
}

async function item(path) {
  try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

async function nodePathEvidence(root) {
  // A bare "node" in a client config follows that client's PATH. We can only
  // preflight this installer's PATH, and must not execute a project-local shim.
  for (const name of process.platform === 'win32' ? ['node.exe', 'node.cmd', 'node.bat', 'node.com'] : ['node']) {
    if (await item(join(root, name))) throw new Error('Project-local node command could shadow KJDraw MCP; use a project without a root node shim')
  }
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue
    for (const name of process.platform === 'win32' ? ['node.com', 'node.exe', 'node.bat', 'node.cmd'] : ['node']) {
      const executable = join(directory, name)
      let info
      try { info = await item(executable) }
      catch (error) {
        // The installer may be sandboxed away from a system PATH directory.
        // It cannot attest that candidate; keep searching readable candidates.
        if (['EPERM', 'EACCES'].includes(error.code)) continue
        throw error
      }
      if (!info) continue
      if (name !== (process.platform === 'win32' ? 'node.exe' : 'node') || !info.isFile() || info.isSymbolicLink()) throw new Error('Node on installer PATH is a wrapper or not a regular executable')
      const canonical = await realpath(executable)
      if (inside(root, canonical) || /[\\/]_npx[\\/]/iu.test(canonical)) throw new Error('Node on installer PATH is project-local or ephemeral; refusing a persistent MCP entry')
      return { command: 'node', readableInstallerCandidateSha256: sha(Buffer.from(canonical)), clientPathVerified: false }
    }
  }
  throw new Error('Node executable is not on installer PATH; install a persistent Node.js before connecting clients')
}

async function checkedPath(root, value, label, finalType) {
  assertRelative(value, label)
  const path = resolve(root, value)
  if (!inside(root, path) || path === root) throw new Error(`${label} must be a project child path`)
  let walk = root
  for (const part of relative(root, path).split(sep)) {
    walk = resolve(walk, part)
    const info = await item(walk)
    if (info?.isSymbolicLink()) throw new Error(`${label} contains a symbolic link`)
    if (walk !== path && info && !info.isDirectory()) throw new Error(`${label} has a non-directory ancestor`)
    if (walk === path && info && (finalType === 'file' ? !info.isFile() : !info.isDirectory())) throw new Error(`${label} has an unexpected file type`)
  }
  return path
}

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

async function readConfig(path) {
  const info = await item(path)
  if (!info) return { bytes: null, value: {} }
  if (!info.isFile() || info.size > MAX_CONFIG_BYTES) throw new Error('Configuration is not a bounded regular file')
  const bytes = await readFile(path)
  if (bytes.byteLength > MAX_CONFIG_BYTES) throw new Error('Configuration grew beyond the limit')
  let value
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('Configuration JSON is invalid; no changes made') }
  if (!object(value)) throw new Error('Configuration root must be an object')
  return { bytes, value }
}

function merged(original, keys, entry, legacyStdio = false) {
  const value = structuredClone(original)
  let target = value
  for (const key of keys) {
    if (!Object.hasOwn(target, key)) target[key] = {}
    if (!object(target[key])) throw new Error(`Configuration ${keys.join('.')} conflicts with MCP object`)
    target = target[key]
  }
  if (Object.hasOwn(target, 'kjdraw')) {
    if (!isDeepStrictEqual(target.kjdraw, entry) && !(legacyStdio && isDeepStrictEqual(target.kjdraw, { type: 'stdio', ...entry }))) throw new Error('Existing kjdraw MCP entry conflicts; refusing to overwrite it')
    return null
  }
  target.kjdraw = entry
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function stage(path, bytes) {
  const temporary = `${path}.kjdraw-stage-${randomUUID()}`
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
  return temporary
}

async function ensureProjectDirectory(root, target) {
  const rel = relative(root, target)
  let walk = root
  for (const part of rel.split(sep)) {
    walk = resolve(walk, part)
    const existing = await item(walk)
    if (existing?.isSymbolicLink() || (existing && !existing.isDirectory())) throw new Error('Project path changed or contains a symbolic link')
    if (!existing) await mkdir(walk)
  }
}

async function verifyUnchanged(plan) {
  const current = await item(plan.path)
  if (plan.original === null) {
    if (current) throw new Error('Configuration appeared during installation')
  } else {
    if (!current?.isFile() || current.isSymbolicLink() || current.size > MAX_CONFIG_BYTES) throw new Error('Configuration changed during installation')
    if (sha(await readFile(plan.path)) !== plan.beforeSha) throw new Error('Configuration changed during installation')
  }
}

async function prepareDrawing(root, options) {
  const name = options.input ?? options.blank
  if (!['.kjd', '.dxf'].includes(extname(name).toLowerCase()) || (options.blank && extname(name).toLowerCase() !== '.kjd')) throw new Error('Drawing must be .kjd or .dxf; blank drawing must be .kjd')
  const path = await checkedPath(root, name, 'drawing', 'file')
  const info = await item(path)
  if (options.input && !info) throw new Error('Existing drawing not found')
  if (info && info.size > MAX_DRAWING_BYTES) throw new Error('Drawing exceeds 64 MiB')
  let serialized = null
  if (!info && options.blank) {
    try {
      const sdk = createKJDrawSDK()
      const drawing = sdk.createDocument({ units: options.units, title: 'KJDraw blank drawing' })
      serialized = await sdk.writeDocument(drawing, { format: 'KJD' })
      const reopened = await createKJDrawSDK().readDocument(serialized, { format: 'KJD' })
      if (reopened.snapshot().header.units !== options.units || reopened.listEntities().length !== 0) throw new Error('Blank host drawing failed roundtrip validation')
    } catch { throw new Error('Blank host drawing failed roundtrip validation') }
  } else {
    let doc
    try {
      const sdk = createKJDrawSDK()
      const raw = await readFile(path)
      doc = await sdk.readDocument(raw.toString('utf8'), { format: extname(path).toLowerCase() === '.dxf' ? 'DXF' : 'KJD' })
    } catch { throw new Error('Drawing could not be read or validated') }
    if (options.blank && doc.snapshot().header.units !== options.units) throw new Error('Existing blank target has different units')
  }
  return { path, name, serialized }
}

export async function connectWorkspace(options, hooks = {}) {
  const rawRoot = resolve(options.workspace)
  const rootInfo = await item(rawRoot)
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('--workspace must be a real directory, not a symbolic link')
  const root = await realpath(rawRoot)
  const drawing = await prepareDrawing(root, options)
  const proposals = await checkedPath(root, options.proposalDir ?? '.kjdraw/proposals', '--proposal-dir', 'directory')
  let geologyColumnKnowledge
  if (options['geology-column-pack']) {
    const path = await checkedPath(root, options['geology-column-pack'], '--geology-column-pack', 'file')
    const info = await item(path)
    if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_KNOWLEDGE_PACK_BYTES) throw new Error('Geology column pack must be an existing regular JSON file no larger than 1 MiB')
    const bytes = await readFile(path)
    if (sha(bytes) !== options['geology-column-pack-sha256']) throw new Error('Geology column pack bytes do not match the host-supplied SHA-256')
    let source
    try { source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    catch { throw new Error('Geology column pack must be strict UTF-8 JSON') }
    const pack = validateKnowledgePack(source)
    if (pack.domain !== 'geology' || !pack.rules?.['geology-column-layout']) throw new Error('Geology column pack must declare the geology domain and geology-column-layout rule')
    geologyColumnKnowledge = { id: pack.id, version: pack.version, sha256: sha(bytes), path: relative(root, path).split(sep).join('/') }
  }
  const mcpPath = fileURLToPath(new URL('./kjdraw-mcp.mjs', import.meta.url))
  if (/[\\/]_npx[\\/]/iu.test(mcpPath) && options.apply) throw new Error('Refusing an ephemeral npm npx cache as a persistent MCP target; install the package locally or globally first')
  const mcpInfo = await item(mcpPath)
  if (!mcpInfo?.isFile() || mcpInfo.isSymbolicLink()) throw new Error('KJDraw MCP script is not a regular installed file')
  const sourceSha256 = sha(await readFile(mcpPath))
  const nodeEvidence = await nodePathEvidence(root)
  // 'node' avoids an ephemeral desktop runtime path and TraeCode's no-spaces command rule.
  const entry = { command: 'node', args: [mcpPath, '--workspace', root, '--input', drawing.name, '--proposal-dir', relative(root, proposals).split(sep).join('/'),
    ...(geologyColumnKnowledge ? ['--geology-column-pack', geologyColumnKnowledge.path, '--geology-column-pack-sha256', geologyColumnKnowledge.sha256] : [])] }
  const plans = []
  for (const client of CLIENTS) {
    const path = await checkedPath(root, client.path, client.name, 'file')
    const original = await readConfig(path)
    if (client.name === 'ZCode' && !Object.keys(original.value?.mcp?.servers ?? {}).length) {
      const fallbackPath = await checkedPath(root, '.agents/mcp.json', 'ZCode .agents fallback', 'file')
      const fallback = await readConfig(fallbackPath)
      if (Object.keys(fallback.value?.mcpServers ?? {}).length) throw new Error('ZCode .agents/mcp.json has active MCP servers; adding .zcode/config.json would hide them. Merge them in ZCode first')
    }
    const content = merged(original.value, client.keys, entry, client.name === 'WorkBuddy')
    plans.push({ ...client, path, original: original.bytes, beforeSha: original.bytes ? sha(original.bytes) : null, content })
  }
  const changed = plans.filter(plan => plan.content)
  const configurationEvidence = { guiVerified: false, engineInvoked: false, approvalRoute: 'trusted-host-only', serverEntryName: 'kjdraw', workBuddyGuide: CLIENTS[1].guide, node: nodeEvidence,
    ...(geologyColumnKnowledge ? { geologyColumnKnowledge } : {}) }
  if (!options.apply) return { applied: false, clients: plans.map(plan => ({ client: plan.name, action: plan.content ? 'add' : 'unchanged', status: 'project-config-candidate-not-GUI-verified' })), drawing: drawing.serialized ? 'create blank' : 'existing', proposalDirectory: 'verified or create', sdkVersion: KJDRAW_VERSION, mcpScriptSha256: sourceSha256, configurationEvidence }
  const created = []
  const staged = []
  const backups = []
  const committed = []
  const retainedBackups = new Set()
  try {
    await ensureProjectDirectory(root, dirname(proposals))
    if (!await item(proposals)) { await mkdir(proposals); created.push({ path: proposals, type: 'directory' }) }
    if (drawing.serialized !== null) {
      await ensureProjectDirectory(root, dirname(drawing.path))
      if (await item(drawing.path)) throw new Error('Blank drawing appeared during installation')
      await writeFile(drawing.path, drawing.serialized, { flag: 'wx', mode: 0o600 })
      created.push({ path: drawing.path, type: 'file' })
    }
    for (const plan of changed) {
      await ensureProjectDirectory(root, dirname(plan.path))
      await verifyUnchanged(plan)
      plan.temp = await stage(plan.path, plan.content)
      staged.push(plan.temp)
      if (plan.original !== null) {
        plan.backup = `${plan.path}.kjdraw-backup-${randomUUID()}`
        await writeFile(plan.backup, plan.original, { flag: 'wx', mode: 0o600 })
        backups.push(plan.backup)
      }
    }
    for (const plan of changed) await verifyUnchanged(plan)
    for (const plan of changed) {
      await hooks.beforeReplace?.(plan.name)
      await verifyUnchanged(plan)
      await rename(plan.temp, plan.path)
      committed.push(plan)
    }
    return { applied: true, clients: plans.map(plan => ({ client: plan.name, action: plan.content ? 'added' : 'unchanged', status: 'project-config-candidate-not-GUI-verified' })), drawing: drawing.serialized ? 'created blank' : 'existing', backupCount: backups.length, transientBackupCount: backups.length, retainedBackupCount: 0, sdkVersion: KJDRAW_VERSION, mcpScriptSha256: sourceSha256, configurationEvidence }
  } catch (error) {
    const rollbackConflicts = []
    for (const plan of committed.reverse()) {
      const current = await item(plan.path)
      if (!current?.isFile() || current.isSymbolicLink() || sha(await readFile(plan.path)) !== sha(plan.content)) {
        rollbackConflicts.push(plan.name)
        if (plan.backup) retainedBackups.add(plan.backup)
        continue
      }
      if (plan.original === null) await unlink(plan.path).catch(() => {})
      else {
        const restore = await stage(plan.path, plan.original)
        try { await rename(restore, plan.path) } finally { await unlink(restore).catch(() => {}) }
      }
    }
    for (const target of created.reverse()) if (target.type === 'file') {
      const current = await item(target.path)
      if (current?.isFile() && !current.isSymbolicLink() && sha(await readFile(target.path)) === sha(drawing.serialized))
        await unlink(target.path).catch(() => {})
      else if (current) rollbackConflicts.push('host drawing')
    }
    if (rollbackConflicts.length) {
      const recovery = [...retainedBackups].map(path => relative(root, path).split(sep).join('/'))
      throw new Error(`${error.message}; rollback preserved concurrently changed files: ${rollbackConflicts.join(', ')}; recovery backups retained for conflicted configurations: ${recovery.join(', ') || 'none'}`)
    }
    throw error
  } finally {
    const cleanupFailures = []
    for (const path of staged) await unlink(path).catch(error => { if (error.code !== 'ENOENT') cleanupFailures.push(path) })
    for (const path of backups) if (!retainedBackups.has(path)) await unlink(path).catch(error => { if (error.code !== 'ENOENT') cleanupFailures.push(path) })
    if (cleanupFailures.length) throw new Error(`Connect may have changed project files; temporary copies could not be removed: ${cleanupFailures.map(path => relative(root, path).split(sep).join('/')).join(', ')}`)
  }
}

export async function runApplyCli(argv) {
  const options = parseArgs(argv)
  if (options.help) { process.stdout.write(`${usage()}\n`); return }
  const result = await connectWorkspace(options)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

async function main() {
  try {
    await runApplyCli(process.argv.slice(2))
  } catch (error) {
    const safe = error instanceof Error && !('code' in error) ? error.message : 'Unable to inspect the requested project safely'
    process.stderr.write(`kjdraw-connect: ${safe}\n`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) await main()
