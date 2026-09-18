#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createKJDrawSDK } from '../src/sdk.js'
import { validateKnowledgePack } from '../src/knowledge-pack.js'
import { KJDRAW_VERSION } from '../src/version.js'
import { safeConnectError } from './connect-error.mjs'

const PROJECT_CLIENTS = Object.freeze([
  { name: 'Kimi Code', path: '.kimi-code/mcp.json', keys: ['mcpServers'] },
  // Official WorkBuddy MCP guide: project .workbuddy/mcp.json, mcpServers,
  // local command/args entry. Configuration alone does not verify its GUI.
  { name: 'WorkBuddy', path: '.workbuddy/mcp.json', keys: ['mcpServers'], guide: 'https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide' },
  { name: 'ZCode', path: '.zcode/config.json', keys: ['mcp', 'servers'] },
  { name: 'TraeCode', path: '.trae/mcp.json', keys: ['mcpServers'] },
])
const USER_CLIENTS = Object.freeze([
  { name: 'Kimi Code', path: '.kimi-code/mcp.json', keys: ['mcpServers'] },
  { name: 'WorkBuddy', path: '.workbuddy/mcp.json', keys: ['mcpServers'], guide: 'https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide' },
  { name: 'ZCode', path: '.zcode/cli/config.json', keys: ['mcp', 'servers'] },
])
const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_DRAWING_BYTES = 64 * 1024 * 1024
const MAX_KNOWLEDGE_PACK_BYTES = 1024 * 1024
const KIMI_TOOL_PROFILE = 'kimi-safe'
const SKILL_FILES = Object.freeze(['SKILL.md', 'references/routes.json', 'references/acceptance.md'])
const SKILL_TARGETS = Object.freeze([
  { path: '.kimi-code/skills/kjdraw-cad', clients: ['Kimi Code CLI'], activation: 'Start a new Kimi Code CLI session and invoke /skill:kjdraw-cad.' },
  { path: '.zcode/skills/kjdraw-cad', clients: ['ZCode'], activation: 'Open Settings > Skills, refresh, and confirm kjdraw-cad is enabled.' },
  { path: '.trae/skills/kjdraw-cad', clients: ['TraeCode'], activation: 'Restart TraeCode after installation.' },
])

function usage() {
  return `Usage: kjdraw-connect --all --workspace <directory> [--scope project|user] (--input <existing.kjd|drawing.dxf> | --blank <new.kjd> --units millimeter|meter) [--proposal-dir .kjdraw/proposals] [--candidate-dir .kjdraw/results] [--previous-mcp-script <absolute-installed-file>]... [--replace-existing] [--geology-column-pack <relative.json> --geology-column-pack-sha256 <sha256>] [--apply]\n\nWithout --apply this is a read-only preview. --candidate-dir is an explicit host policy that materializes exact proposals as new candidate files without overwriting the input drawing. Each --previous-mcp-script authorizes one exact KJDraw-managed entry migration from an earlier regular file. --replace-existing is an explicit host instruction to replace a conflicting kjdraw entry while preserving the rest of each client configuration.`
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  const options = { apply: false, all: false, proposalDir: '.kjdraw/proposals', scope: 'project' }
  const seen = new Set()
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (seen.has(key) && key !== '--previous-mcp-script') throw new Error(`Duplicate option: ${key}`)
    seen.add(key)
    if (key === '--all' || key === '--apply' || key === '--replace-existing') {
      options[key === '--replace-existing' ? 'replaceExisting' : key.slice(2)] = true
      continue
    }
    if (key === '--previous-mcp-script') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Unknown or incomplete option')
      ;(options.previousMcpScripts ??= []).push(argv[++i])
      continue
    }
    if (!['--workspace', '--scope', '--input', '--blank', '--units', '--proposal-dir', '--candidate-dir', '--previous-mcp-script', '--geology-column-pack', '--geology-column-pack-sha256'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Unknown or incomplete option')
    options[key === '--proposal-dir' ? 'proposalDir' : key === '--candidate-dir' ? 'candidateDir' : key === '--previous-mcp-script' ? 'previousMcpScript' : key.slice(2)] = argv[++i]
  }
  if (!options.all || !options.workspace) throw new Error('--all and --workspace are required')
  if (!['project', 'user'].includes(options.scope)) throw new Error('--scope must be project or user')
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

export function isEphemeralNodePath(root, candidate) {
  const canonical = resolve(candidate)
  const local = inside(root, canonical) ? relative(root, canonical) : canonical
  return /(?:^|[\\/])(?:node_modules|_npx|\.pnpm)(?:[\\/]|$)/iu.test(local)
    || /(?:^|[\\/])\.yarn[\\/]unplugged(?:[\\/]|$)/iu.test(local)
    || /[\\/]AppData[\\/]Local[\\/]Temp[\\/]/iu.test(canonical)
    || /^\/(?:tmp|var\/tmp)\//u.test(canonical)
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
      if (isEphemeralNodePath(root, canonical)) throw new Error('Node on installer PATH is project-local or ephemeral; refusing a persistent MCP entry')
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
export async function inspected(stage, operation) {
  try { return await operation() }
  catch (error) {
    if (typeof error?.code === 'string') throw new Error(`${stage}: ${safeConnectError(error)}`)
    throw error
  }
}

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

function merged(original, keys, entry, legacyStdio = false, acceptedPriorEntries = [], replaceExisting = false) {
  const value = structuredClone(original)
  let target = value
  for (const key of keys) {
    if (!Object.hasOwn(target, key)) target[key] = {}
    if (!object(target[key])) throw new Error(`Configuration ${keys.join('.')} conflicts with MCP object`)
    target = target[key]
  }
  if (Object.hasOwn(target, 'kjdraw')) {
    const existing = target.kjdraw
    const normalized = legacyStdio && object(existing) && existing.type === 'stdio' ? Object.fromEntries(Object.entries(existing).filter(([key]) => key !== 'type')) : existing
    if (isDeepStrictEqual(normalized, entry)) return null
    const candidateIndex = entry.args?.indexOf('--candidate-dir') ?? -1
    const prior = candidateIndex >= 0 ? { ...entry, args: entry.args.toSpliced(candidateIndex, 2) } : null
    if (!replaceExisting && (!prior || !isDeepStrictEqual(normalized, prior)) && !acceptedPriorEntries.some(candidate => isDeepStrictEqual(normalized, candidate))) throw new Error('Existing kjdraw MCP entry conflicts; refusing to overwrite it')
    target.kjdraw = legacyStdio && existing.type === 'stdio' ? { type: 'stdio', ...entry } : entry
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
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

async function skillSource() {
  const root = fileURLToPath(new URL('../skills/kjdraw-cad/', import.meta.url))
  const files = []
  for (const name of SKILL_FILES) {
    const path = join(root, ...name.split('/'))
    const info = await item(path)
    if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_CONFIG_BYTES) throw new Error('Packaged KJDraw Skill is incomplete or unsafe')
    const bytes = await readFile(path)
    files.push({ name, bytes, sha256: sha(bytes) })
  }
  return { files, sha256: sha(Buffer.from(files.map(file => `${file.name}:${file.sha256}`).join('\n'))) }
}

async function directoryFiles(root, directory = root) {
  const names = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Existing KJDraw Skill contains an unsafe file type')
    if (entry.isDirectory()) names.push(...await directoryFiles(root, path))
    else names.push(relative(root, path).split(sep).join('/'))
  }
  return names.sort()
}

async function planSkillTargets(root, source) {
  const plans = []
  for (const target of SKILL_TARGETS) {
    const path = await checkedPath(root, target.path, 'KJDraw Skill', 'directory')
    const existing = await item(path)
    if (!existing) { plans.push({ ...target, path, action: 'add' }); continue }
    const names = await directoryFiles(path)
    if (!isDeepStrictEqual(names, [...SKILL_FILES].sort())) throw new Error(`Existing KJDraw Skill conflicts at ${target.path}; refusing to overwrite it`)
    for (const file of source.files) {
      if (sha(await readFile(join(path, ...file.name.split('/')))) !== file.sha256) throw new Error(`Existing KJDraw Skill conflicts at ${target.path}; refusing to overwrite it`)
    }
    plans.push({ ...target, path, action: 'unchanged' })
  }
  return plans
}

async function stageSkill(root, source) {
  const temporary = join(root, `.kjdraw-skill-stage-${randomUUID()}`)
  await mkdir(temporary, { recursive: false })
  try {
    for (const file of source.files) {
      const path = join(temporary, ...file.name.split('/'))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, file.bytes, { flag: 'wx', mode: 0o600 })
    }
    return temporary
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
    throw error
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
  const scope = options.scope ?? 'project'
  if (!['project', 'user'].includes(scope)) throw new Error('--scope must be project or user')
  const rawRoot = resolve(options.workspace)
  const rootInfo = await inspected('User workspace', () => item(rawRoot))
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('--workspace must be a real directory, not a symbolic link')
  const root = await inspected('User workspace', () => realpath(rawRoot))
  const drawing = await inspected('Host drawing', () => prepareDrawing(root, options))
  const proposals = await inspected('Proposal directory', () => checkedPath(root, options.proposalDir ?? '.kjdraw/proposals', '--proposal-dir', 'directory'))
  const candidates = options.candidateDir ? await inspected('Result directory', () => checkedPath(root, options.candidateDir, '--candidate-dir', 'directory')) : null
  if (candidates && candidates === proposals) throw new Error('--candidate-dir must be different from --proposal-dir')
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
  // Keep the spelling used to launch the installed package in persisted client
  // entries. On macOS, realpath('/var/...') is '/private/var/...'; rewriting the
  // user-visible path on every install makes an otherwise identical entry look
  // different to clients and to the next installer run.
  const mcpPath = fileURLToPath(new URL('./kjdraw-mcp.mjs', import.meta.url))
  if (/[\\/]_npx[\\/]/iu.test(mcpPath) && options.apply) throw new Error('Refusing an ephemeral npm npx cache as a persistent MCP target; install the package locally or globally first')
  const mcpInfo = await inspected('Installed MCP script', () => item(mcpPath))
  if (!mcpInfo?.isFile() || mcpInfo.isSymbolicLink()) throw new Error('KJDraw MCP script is not a regular installed file')
  const canonicalMcpPath = await inspected('Installed MCP script', () => realpath(mcpPath))
  const previousMcpScripts = options.previousMcpScripts ?? (options.previousMcpScript ? [options.previousMcpScript] : [])
  const previousMcpPaths = []
  for (const requested of previousMcpScripts) {
    if (scope !== 'user' || !isAbsolute(requested)) throw new Error('--previous-mcp-script requires user scope and an absolute path')
    const requestedPath = resolve(requested)
    const previousInfo = await item(requestedPath)
    if (!previousInfo?.isFile() || previousInfo.isSymbolicLink()) throw new Error('--previous-mcp-script must be an existing regular file')
    const previousPath = await realpath(requestedPath)
    if (previousPath === canonicalMcpPath) throw new Error('--previous-mcp-script must identify an earlier installed file')
    // Accept only the exact path supplied by the installer and its exact
    // canonical alias. This handles /var versus /private/var without allowing
    // any other existing kjdraw entry to be replaced.
    for (const path of [requestedPath, previousPath]) if (!previousMcpPaths.includes(path)) previousMcpPaths.push(path)
  }
  const sourceSha256 = sha(await inspected('Installed MCP script', () => readFile(mcpPath)))
  const nodeEvidence = await inspected('Node.js runtime', () => nodePathEvidence(root))
  const skill = await inspected('Packaged KJDraw skill', () => skillSource())
  const skillPlans = await inspected('Existing KJDraw skill', () => planSkillTargets(root, skill))
  // 'node' avoids an ephemeral desktop runtime path and TraeCode's no-spaces command rule.
  const entry = { command: 'node', args: [mcpPath, '--workspace', rawRoot, '--input', drawing.name, '--proposal-dir', relative(root, proposals).split(sep).join('/'),
    ...(candidates ? ['--candidate-dir', relative(root, candidates).split(sep).join('/')] : []),
    ...(geologyColumnKnowledge ? ['--geology-column-pack', geologyColumnKnowledge.path, '--geology-column-pack-sha256', geologyColumnKnowledge.sha256] : [])] }
  const entryFor = client => client.name === 'Kimi Code'
    ? { ...entry, args: [...entry.args, '--tool-profile', KIMI_TOOL_PROFILE] }
    : entry
  const workspaceSpellings = rawRoot === root ? [rawRoot] : [rawRoot, root]
  const acceptedScripts = [...new Set([mcpPath, canonicalMcpPath, ...previousMcpPaths])]
  const acceptedPriorEntries = acceptedScripts.flatMap(previousMcpScript => workspaceSpellings.flatMap(workspace => {
    const args = [previousMcpScript, ...entry.args.slice(1)]
    args[args.indexOf('--workspace') + 1] = workspace
    const exact = { ...entry, args }
    const candidateIndex = args.indexOf('--candidate-dir')
    return [exact, ...(candidateIndex >= 0 ? [{ ...exact, args: args.toSpliced(candidateIndex, 2) }] : [])]
  }))
  const acceptedPriorKimiEntries = acceptedPriorEntries.flatMap(candidate => [
    candidate,
    { ...candidate, args: [...candidate.args, '--tool-profile', KIMI_TOOL_PROFILE] },
  ])
  const clients = scope === 'user' ? USER_CLIENTS : PROJECT_CLIENTS
  const plans = []
  for (const client of clients) {
    const path = await inspected(`${client.name} configuration`, () => checkedPath(root, client.path, client.name, 'file'))
    const original = await inspected(`${client.name} configuration`, () => readConfig(path))
    if (client.name === 'ZCode' && !Object.keys(original.value?.mcp?.servers ?? {}).length) {
      const fallbackPath = await checkedPath(root, '.agents/mcp.json', 'ZCode .agents fallback', 'file')
      const fallback = await readConfig(fallbackPath)
      if (Object.keys(fallback.value?.mcpServers ?? {}).length) throw new Error('ZCode .agents/mcp.json has active MCP servers; adding .zcode/config.json would hide them. Merge them in ZCode first')
    }
    const clientEntry = entryFor(client)
    const clientAcceptedPriorEntries = client.name === 'Kimi Code'
      ? [...acceptedPriorKimiEntries, entry]
      : acceptedPriorEntries
    const content = merged(original.value, client.keys, clientEntry, client.name === 'WorkBuddy', clientAcceptedPriorEntries, options.replaceExisting === true)
    plans.push({ ...client, path, original: original.bytes, beforeSha: original.bytes ? sha(original.bytes) : null, content, entry: clientEntry })
  }
  const traeInstallUrl = scope === 'user'
    ? `trae-cn://trae.ai-ide/mcp-import?type=stdio&name=kjdraw&config=${encodeURIComponent(Buffer.from(JSON.stringify(entry)).toString('base64'))}`
    : null
  const changed = plans.filter(plan => plan.content)
  const configurationEvidence = { guiVerified: false, engineInvoked: false, approvalRoute: 'trusted-host-only', conflictPolicy: options.replaceExisting ? 'replace-explicit' : 'refuse-unknown', serverEntryName: 'kjdraw', scope, kimiToolProfile: KIMI_TOOL_PROFILE, workBuddyGuide: clients.find(client => client.name === 'WorkBuddy')?.guide, node: nodeEvidence,
    ...(traeInstallUrl ? { traeInstallUrl, traeGuide: 'https://docs.trae.cn/ide_mcp-server-install-links' } : {}),
    ...(geologyColumnKnowledge ? { geologyColumnKnowledge } : {}) }
  const skillEvidence = { canonicalSha256: skill.sha256, workBuddy: 'MCP connected; WorkBuddy only documents Marketplace Skill installation, so no unverified local Skill path is written.', targets: skillPlans.map(plan => ({ path: relative(root, plan.path).split(sep).join('/'), clients: plan.clients, action: plan.action, activation: plan.activation })) }
  const clientEvidence = () => [
    ...plans.map(plan => ({ client: plan.name, action: plan.content ? (options.apply ? 'added' : 'add') : 'unchanged', status: `${scope}-config-candidate-not-GUI-verified` })),
    ...(traeInstallUrl ? [{ client: 'TraeCode', action: 'confirm-import', status: 'user-import-confirmation-required', installUrl: traeInstallUrl }] : []),
  ]
  if (!options.apply) return { applied: false, clients: clientEvidence(), skills: skillEvidence, drawing: drawing.serialized ? 'create blank' : 'existing', proposalDirectory: 'verified or create', sdkVersion: KJDRAW_VERSION, mcpScriptSha256: sourceSha256, configurationEvidence }
  const created = []
  const staged = []
  const backups = []
  const committed = []
  const retainedBackups = new Set()
  const stagedSkills = []
  const committedSkills = []
  try {
    await ensureProjectDirectory(root, dirname(proposals))
    if (!await item(proposals)) { await mkdir(proposals); created.push({ path: proposals, type: 'directory' }) }
    if (candidates) {
      await ensureProjectDirectory(root, dirname(candidates))
      if (!await item(candidates)) { await mkdir(candidates); created.push({ path: candidates, type: 'directory' }) }
    }
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
    for (const plan of skillPlans.filter(plan => plan.action === 'add')) {
      if (await item(plan.path)) throw new Error(`KJDraw Skill appeared during installation at ${plan.path}`)
      plan.temp = await stageSkill(root, skill)
      stagedSkills.push(plan.temp)
    }
    for (const plan of changed) await verifyUnchanged(plan)
    for (const plan of changed) {
      await hooks.beforeReplace?.(plan.name)
      await verifyUnchanged(plan)
      await rename(plan.temp, plan.path)
      committed.push(plan)
    }
    for (const plan of skillPlans.filter(plan => plan.action === 'add')) {
      let walk = root
      for (const part of relative(root, dirname(plan.path)).split(sep)) {
        walk = resolve(walk, part)
        if (!await item(walk)) { await mkdir(walk); created.push({ path: walk, type: 'directory' }) }
      }
      if (await item(plan.path)) throw new Error(`KJDraw Skill appeared during installation at ${plan.path}`)
      await rename(plan.temp, plan.path)
      committedSkills.push(plan)
    }
    return { applied: true, clients: clientEvidence(), skills: skillEvidence, drawing: drawing.serialized ? 'created blank' : 'existing', backupCount: backups.length, transientBackupCount: backups.length, retainedBackupCount: 0, sdkVersion: KJDRAW_VERSION, mcpScriptSha256: sourceSha256, configurationEvidence }
  } catch (error) {
    const rollbackConflicts = []
    for (const plan of committedSkills.reverse()) {
      try {
        const names = await directoryFiles(plan.path)
        const exact = isDeepStrictEqual(names, [...SKILL_FILES].sort()) && (await Promise.all(skill.files.map(async file => sha(await readFile(join(plan.path, ...file.name.split('/')))) === file.sha256))).every(Boolean)
        if (exact) await rm(plan.path, { recursive: true, force: true })
        else rollbackConflicts.push(plan.clients.join('/'))
      } catch { rollbackConflicts.push(plan.clients.join('/')) }
    }
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
    for (const target of created) if (target.type === 'directory') await rmdir(target.path).catch(error => {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) rollbackConflicts.push(relative(root, target.path).split(sep).join('/'))
    })
    if (rollbackConflicts.length) {
      const recovery = [...retainedBackups].map(path => relative(root, path).split(sep).join('/'))
      throw new Error(`${error.message}; rollback preserved concurrently changed files: ${rollbackConflicts.join(', ')}; recovery backups retained for conflicted configurations: ${recovery.join(', ') || 'none'}`)
    }
    throw error
  } finally {
    const cleanupFailures = []
    for (const path of staged) await unlink(path).catch(error => { if (error.code !== 'ENOENT') cleanupFailures.push(path) })
    for (const path of backups) if (!retainedBackups.has(path)) await unlink(path).catch(error => { if (error.code !== 'ENOENT') cleanupFailures.push(path) })
    for (const path of stagedSkills) await rm(path, { recursive: true, force: true }).catch(() => cleanupFailures.push(path))
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
    process.stderr.write(`kjdraw-connect: ${safeConnectError(error)}\n`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) await main()
