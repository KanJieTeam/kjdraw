#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KJDRAW_VERSION } from '../src/version.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { createKjpPackage, openKjpPackage } from '../src/project-package.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { portableMcpInputSchema } from '../src/mcp-schema-compat.js'

const HELP = `KJDraw ${KJDRAW_VERSION}

Headless CAD document tools

Usage:
  kjdraw onboard               Install KJDraw for the current user
  kjdraw doctor                Inspect the current user's installation
  kjdraw inspect <drawing.kjd|drawing.dxf|project.kjp>
  kjdraw validate <drawing.kjd|drawing.dxf|project.kjp>
  kjdraw convert <input> <output.kjd|output.dxf|output.kjp> [--dxf-version 2018]
  kjdraw agent tools [tool-name] [--units millimeter|meter]  List tools or inspect one input schema
  kjdraw agent call <tool-name> --input <drawing.kjd|drawing.dxf> [--args-file <request.json>] [--workspace <directory>] [--summary]
  kjdraw agent call <tool-name> --blank <new-drawing.kjd> --units <millimeter|meter> [--args-file <request.json>] [--workspace <directory>] [--summary]
  kjdraw --version

Agent calls run locally and only create review proposals. --summary keeps the full proposal in the review ledger while returning a small receipt to the agent. Approve separately with kjdraw-review in an interactive terminal.
No drawing data is uploaded by the CLI.`

const SOURCE_LIMITS = Object.freeze({ '.kjd': 64 * 1024 ** 2, '.dxf': 64 * 1024 ** 2, '.kjp': 512 * 1024 ** 2 })
const CONFIG_LIMIT = 1024 * 1024
const AGENT_ARGUMENT_LIMIT = 4 * 1024 * 1024
const MCP_SCRIPT = fileURLToPath(new URL('./kjdraw-mcp.mjs', import.meta.url))
const CONFIGS = Object.freeze([
  { client: 'Kimi Code', path: '.kimi-code/mcp.json', keys: ['mcpServers'] },
  { client: 'WorkBuddy', path: '.workbuddy/mcp.json', keys: ['mcpServers'] },
  { client: 'ZCode', path: '.zcode/cli/config.json', keys: ['mcp', 'servers'] },
  { client: 'Claude Code', path: '.claude.json', keys: ['mcpServers'] },
  { client: 'Cursor', path: '.cursor/mcp.json', keys: ['mcpServers'] },
])
const SKILLS = Object.freeze([
  { client: 'Kimi Code CLI', path: '.kimi-code/skills/kjdraw-cad' },
  { client: 'ZCode', path: '.zcode/skills/kjdraw-cad' },
  { client: 'TraeCode', path: '.trae/skills/kjdraw-cad' },
  { client: 'Codex', path: '.codex/skills/kjdraw-cad' },
  { client: 'Claude Code', path: '.claude/skills/kjdraw-cad' },
  { client: 'Cursor', path: '.cursor/skills/kjdraw-cad' },
])
const SKILL_FILES = Object.freeze(['SKILL.md', 'references/routes.json', 'references/acceptance.md'])

function hash(value) { return createHash('sha256').update(value).digest('hex') }
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

async function item(path) {
  try { return await lstat(path) } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

function inside(root, candidate) {
  const part = relative(root, candidate)
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
}

async function userRoot() {
  const requested = resolve(process.env.KJDRAW_USER_HOME || homedir())
  const info = await item(requested)
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('Current user home must be a real directory, not a symbolic link')
  return realpath(requested)
}

async function projectPath(root, relativePath) {
  const path = join(root, ...relativePath.split('/'))
  if (!inside(root, path) || path === root) return { path, safe: false }
  let current = root
  const parts = relative(root, path).split(sep)
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index])
    const info = await item(current)
    if (info?.isSymbolicLink()) return { path, safe: false }
    if (index < parts.length - 1 && info && !info.isDirectory()) return { path, safe: false }
    if (!info) break
  }
  return { path, safe: true }
}

async function onboard(args) {
  if (args.length) throw new Error('onboard takes no arguments')
  const workspace = await userRoot()
  const host = join(workspace, '.kjdraw', 'host.kjd')
  const hostInfo = await item(host)
  const { connectWorkspace } = await import('./kjdraw-connect-apply.mjs')
  const result = await connectWorkspace({
    all: true,
    apply: true,
    scope: 'user',
    workspace,
    proposalDir: '.kjdraw/proposals',
    candidateDir: '.kjdraw/results',
    ...(hostInfo ? { input: '.kjdraw/host.kjd' } : { blank: '.kjdraw/host.kjd', units: 'millimeter' }),
  })
  const trae = result.clients.find(client => client.client === 'TraeCode')
  if (trae?.installUrl) {
    const path = join(workspace, '.kjdraw', 'trae-install-url.txt')
    const current = await item(path)
    if (current && (!current.isFile() || current.isSymbolicLink())) throw new Error('TraeCode import link path is unsafe')
    if (!current || await readFile(path, 'utf8') !== trae.installUrl) await writeFile(path, trae.installUrl, { mode: 0o600 })
  }
  return {
    command: 'onboard',
    ...result,
    verification: {
      userConfigurationInstalled: true,
      guiVerified: false,
      realModelVerified: false,
      next: 'Restart Kimi Code, WorkBuddy, ZCode, Claude Code, or Cursor. Confirm the TraeCode import link. Configure Codex MCP with its official CLI, then verify kjdraw in a new session.',
    },
  }
}

async function readJsonCheck(path, keys, desired, safe) {
  if (!safe) return { status: 'unsafe-path' }
  const info = await item(path)
  if (!info) return { status: 'missing' }
  if (!info.isFile() || info.isSymbolicLink()) return { status: 'unsafe-file-type' }
  if (info.size > CONFIG_LIMIT) return { status: 'oversized' }
  let value
  try { value = JSON.parse(await readFile(path, 'utf8')) } catch { return { status: 'invalid-json' } }
  let container = value
  for (const key of keys) {
    if (!plainObject(container?.[key])) return { status: 'incompatible-shape' }
    container = container[key]
  }
  const entry = container.kjdraw
  if (!plainObject(entry)) return { status: 'missing-kjdraw-entry' }
  if (entry.command !== 'node' || !Array.isArray(entry.args) || entry.args.some(value => typeof value !== 'string')) return { status: 'mismatched-kjdraw-entry' }
  const expected = [MCP_SCRIPT, '--workspace', desired.workspace, '--input', '.kjdraw/host.kjd', '--proposal-dir', '.kjdraw/proposals', '--candidate-dir', '.kjdraw/results',
    ...(desired.client === 'Kimi Code' ? ['--tool-profile', 'kimi-safe'] : [])]
  const normalized = entry.args.length ? [resolve(entry.args[0]), ...entry.args.slice(1)] : []
  const matches = JSON.stringify(normalized) === JSON.stringify(expected)
  return { status: matches ? 'ok' : 'mismatched-kjdraw-entry' }
}

async function directoryFiles(root, directory = root) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) return null
    if (entry.isDirectory()) {
      const children = await directoryFiles(root, path)
      if (!children) return null
      files.push(...children)
    } else files.push(relative(root, path).split(sep).join('/'))
  }
  return files.sort()
}

async function skillCheck(workspace, target, source) {
  const checked = await projectPath(workspace, target.path)
  const path = checked.path
  if (!checked.safe) return { client: target.client, path: target.path, status: 'unsafe-path' }
  const info = await item(path)
  if (!info) return { client: target.client, path: target.path, status: 'missing' }
  if (!info.isDirectory() || info.isSymbolicLink()) return { client: target.client, path: target.path, status: 'unsafe-file-type' }
  const files = await directoryFiles(path)
  if (!files || JSON.stringify(files) !== JSON.stringify([...SKILL_FILES].sort())) return { client: target.client, path: target.path, status: 'mismatched' }
  for (const name of SKILL_FILES) {
    const bytes = await readFile(join(path, ...name.split('/')))
    if (hash(bytes) !== source.get(name)) return { client: target.client, path: target.path, status: 'mismatched' }
  }
  return { client: target.client, path: target.path, status: 'ok' }
}

async function doctor(args) {
  if (args.length) throw new Error('doctor takes no arguments')
  const workspace = await userRoot()
  const checks = []
  const major = Number.parseInt(process.versions.node.split('.')[0], 10)
  checks.push({ id: 'node', status: major >= 22 ? 'ok' : 'unsupported', version: process.versions.node, required: '>=22' })

  const mcpInfo = await item(MCP_SCRIPT)
  checks.push({
    id: 'mcp-script',
    path: MCP_SCRIPT,
    status: mcpInfo?.isFile() && !mcpInfo.isSymbolicLink() ? 'ok' : mcpInfo ? 'unsafe-file-type' : 'missing',
    ...(mcpInfo?.isFile() && !mcpInfo.isSymbolicLink() ? { sha256: hash(await readFile(MCP_SCRIPT)) } : {}),
  })

  const checkedHost = await projectPath(workspace, '.kjdraw/host.kjd')
  const hostPath = checkedHost.path
  const hostInfo = await item(hostPath)
  let host = { id: 'host-drawing', path: '.kjdraw/host.kjd', status: hostInfo ? 'invalid' : 'missing' }
  if (!checkedHost.safe) host.status = 'unsafe-path'
  else if (hostInfo?.isFile() && !hostInfo.isSymbolicLink() && hostInfo.size <= SOURCE_LIMITS['.kjd']) {
    try {
      const document = await createKJDrawSDK().readDocument(await readFile(hostPath, 'utf8'), { format: 'KJD' })
      host = { ...host, status: 'ok', revision: document.revision, entities: document.listEntities({ includeErased: true }).length }
    } catch {}
  } else if (hostInfo && (!hostInfo.isFile() || hostInfo.isSymbolicLink())) host.status = 'unsafe-file-type'
  else if (hostInfo?.size > SOURCE_LIMITS['.kjd']) host.status = 'oversized'
  checks.push(host)

  for (const config of CONFIGS) {
    const checked = await projectPath(workspace, config.path)
    checks.push({ id: 'client-config', client: config.client, path: config.path, ...await readJsonCheck(checked.path, config.keys, { workspace, client: config.client }, checked.safe) })
  }
  const traeImport = await projectPath(workspace, '.kjdraw/trae-install-url.txt')
  const traeInfo = await item(traeImport.path)
  let traeStatus = 'missing'
  if (traeImport.safe && traeInfo?.isFile() && !traeInfo.isSymbolicLink() && traeInfo.size <= CONFIG_LIMIT) {
    const value = await readFile(traeImport.path, 'utf8')
    traeStatus = value.startsWith('trae-cn://trae.ai-ide/mcp-import?') ? 'confirmation-required' : 'invalid'
  } else if (!traeImport.safe) traeStatus = 'unsafe-path'
  else if (traeInfo) traeStatus = 'unsafe-file-type'
  checks.push({ id: 'client-config', client: 'TraeCode', path: '.kjdraw/trae-install-url.txt', status: traeStatus })

  const source = new Map()
  const sourceRoot = fileURLToPath(new URL('../skills/kjdraw-cad/', import.meta.url))
  for (const name of SKILL_FILES) source.set(name, hash(await readFile(join(sourceRoot, ...name.split('/')))))
  for (const target of SKILLS) checks.push({ id: 'client-skill', ...await skillCheck(workspace, target, source) })
  checks.push({
    id: 'client-skill', client: 'WorkBuddy', status: 'manual-installation-required',
    note: 'WorkBuddy does not document a local Skill discovery path that KJDraw can write safely.',
  })

  const ok = checks.every(check => check.status === 'ok' || check.status === 'manual-installation-required' || check.status === 'confirmation-required')
  return {
    command: 'doctor', ok, sdkVersion: KJDRAW_VERSION, userHome: workspace, checks,
    verification: {
      filesInspected: true,
      writesPerformed: 0,
      guiVerified: false,
      realModelVerified: false,
      note: 'File checks do not prove that any GUI loaded MCP or that any model invoked a KJDraw tool.',
    },
  }
}

function extension(path) {
  const value = extname(path).toLowerCase()
  if (!Object.hasOwn(SOURCE_LIMITS, value)) throw new Error(`Unsupported CAD file extension: ${value || '<none>'}`)
  return value
}

async function readBounded(path) {
  const absolute = resolve(path)
  const suffix = extension(absolute)
  const info = await stat(absolute)
  const maximum = SOURCE_LIMITS[suffix]
  if (!info.isFile()) throw new Error(`Input is not a file: ${absolute}`)
  if (info.size > maximum) throw new Error(`Input exceeds the ${Math.round(maximum / 1024 ** 2)} MiB ${suffix.slice(1).toUpperCase()} limit`)
  return { absolute, suffix, bytes: new Uint8Array(await readFile(absolute)) }
}

function decodeText(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

async function openInput(path) {
  const source = await readBounded(path)
  if (source.suffix === '.kjp') {
    const project = await openKjpPackage(source.bytes)
    return { ...source, document: project.activeDocument, project }
  }
  const sdk = createKJDrawSDK()
  const format = source.suffix === '.dxf' ? 'DXF' : 'KJD'
  const document = await sdk.readDocument(decodeText(source.bytes), { format })
  return { ...source, document, project: null }
}

function frequencies(values) {
  const output = {}
  for (const value of values) output[value] = (output[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

function summary(opened) {
  const document = opened.document
  const snapshot = document.snapshot()
  const objects = document.listObjects({ includeErased: true })
  const entities = document.listEntities({ includeErased: true })
  return {
    valid: true,
    sdkVersion: KJDRAW_VERSION,
    source: opened.absolute,
    format: opened.suffix.slice(1).toUpperCase(),
    bytes: opened.bytes.byteLength,
    project: opened.project ? {
      id: opened.project.manifest.projectId,
      title: opened.project.manifest.title,
      drawings: opened.project.drawings.size,
      activeDrawing: opened.project.manifest.activeDrawing,
    } : null,
    document: {
      id: document.id,
      title: snapshot.title,
      revision: document.revision,
      schemaVersion: document.schemaVersion,
      units: snapshot.header.units,
      objects: objects.length,
      entities: entities.length,
      objectKinds: frequencies(objects.map(object => object.kind)),
      entityTypes: frequencies(entities.map(entity => entity.type)),
      layers: document.getTable('layers').records.length,
      fingerprint: document.fingerprint(),
    },
  }
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value`)
  return value
}

async function convert(input, output, args) {
  const opened = await openInput(input)
  const outputPath = resolve(output)
  const suffix = extension(outputPath)
  let value
  if (suffix === '.kjp') {
    value = await createKjpPackage({
      projectId: opened.project?.manifest.projectId ?? `${opened.document.id}-project`,
      title: opened.project?.manifest.title ?? opened.document.snapshot().title ?? 'KJDraw project',
      activeDrawing: opened.document.id,
      drawings: { [opened.document.id]: opened.document },
      writerVersion: KJDRAW_VERSION,
    })
  } else {
    const sdk = createKJDrawSDK()
    sdk.attachDocument(opened.document)
    value = await sdk.writeDocument(opened.document, suffix === '.dxf'
      ? { format: 'DXF', version: optionValue(args, '--dxf-version', '2018') }
      : { format: 'KJD' })
  }
  await writeFile(outputPath, value)
  return { ...summary(opened), output: outputPath, outputFormat: suffix.slice(1).toUpperCase() }
}

function agentOptions(args) {
  const values = {}
  for (let index = 0; index < args.length;) {
    const key = args[index], value = args[index + 1]
    if (key === '--summary') {
      if (values.summary) throw new Error('Duplicate agent option: --summary')
      values.summary = true
      index += 1
      continue
    }
    if (!['--workspace', '--input', '--blank', '--units', '--args-file'].includes(key) || !value || value.startsWith('--') || Object.hasOwn(values, key.slice(2))) {
      throw new Error(`Unknown, duplicate or incomplete agent option: ${key ?? ''}`)
    }
    values[key.slice(2)] = value
    index += 2
  }
  if (Boolean(values.input) === Boolean(values.blank)) throw new Error('agent call requires exactly one of --input or --blank')
  if (values.blank && !['millimeter', 'meter'].includes(values.units)) throw new Error('--blank requires --units millimeter or meter')
  if (values.input && values.units) throw new Error('--units is only allowed with --blank')
  return values
}

function summarizeAgentProposal(output, host, tool) {
  if (!output.ok || output.value?.status !== 'awaiting-host-approval') return output
  const proposal = host.ledger.proposals.at(-1)
  if (!proposal || proposal.tool !== tool || proposal.result?.planId !== output.value.planId) throw new Error('Cannot summarize a proposal missing from the host review ledger')
  const full = proposal.result
  const candidateEntities = full.arguments?.entities ?? full.preview?.after
  const entities = Array.isArray(candidateEntities) ? candidateEntities : []
  const entityTypes = {}
  for (const entity of entities) entityTypes[entity.type] = (entityTypes[entity.type] ?? 0) + 1
  return { ok: true, value: {
    product: 'KJDraw', responseKind: 'compact-agent-proposal@1',
    planId: full.planId, documentId: full.documentId,
    expectedRevision: full.expectedRevision, units: full.units,
    command: full.command, status: full.status,
    nativeGeometry: { proposedEntityCount: entities.length, entityTypes },
    hostReview: {
      ledgerPath: host.ledger.session.ledgerPath,
      proposalSequence: proposal.sequence,
      sourceFingerprint: host.sourceFingerprint,
      fullResultSha256: hash(JSON.stringify(full)),
      fullResultStoredOnlyInHostLedger: true,
      sourceOverwritten: false, approvalAndCadSaveRequired: true,
    },
  } }
}

async function ensureAgentProposalDir(workspace) {
  const rootInfo = await item(workspace)
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Agent workspace must be a real directory')
  const root = await realpath(workspace)
  let current = root
  for (const part of ['.kjdraw', 'proposals']) {
    current = join(current, part)
    const info = await item(current)
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Agent proposal directory must not traverse a symbolic link or file')
    if (!info) await mkdir(current, { mode: 0o700 })
  }
  return '.kjdraw/proposals'
}

async function agentArguments(workspace, relativePath) {
  if (!relativePath) return {}
  if (isAbsolute(relativePath) || /^[A-Za-z]:/u.test(relativePath) || relativePath.split(/[\\/]+/u).some(part => !part || part === '.' || part === '..')) {
    throw new Error('--args-file must be an unambiguous path inside the workspace')
  }
  const checked = await projectPath(workspace, relativePath.split('\\').join('/'))
  if (!checked.safe) throw new Error('--args-file must not traverse a symbolic link')
  const info = await item(checked.path)
  if (!info?.isFile() || info.isSymbolicLink() || info.size > AGENT_ARGUMENT_LIMIT) throw new Error('--args-file must be a regular JSON file no larger than 4 MiB')
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(checked.path)))
  if (!plainObject(value)) throw new Error('--args-file must contain one JSON object')
  return value
}

async function agent(args) {
  const [action, tool, ...rest] = args
  if (action === 'tools') {
    const hasName = tool && !tool.startsWith('--')
    const options = hasName ? rest : args.slice(1)
    if (options.length && (options.length !== 2 || options[0] !== '--units' || !['millimeter', 'meter'].includes(options[1]))) {
      throw new Error('agent tools accepts only an optional tool name and --units millimeter|meter')
    }
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: options[1] ?? 'millimeter' })
    const definitions = new KJAgentToolSession(sdk, document).definitions
    if (!hasName) return { command: 'agent tools', units: options[1] ?? 'millimeter', tools: definitions.map(({ name, description }) => ({ name, description })) }
    const match = definitions.find(item => item.name === tool)
    if (!match) throw new Error(`Unknown KJDraw agent tool: ${tool}`)
    return { command: 'agent tools', units: options[1] ?? 'millimeter', tool: { name: match.name, description: match.description, inputSchema: portableMcpInputSchema(match.inputSchema) } }
  }
  if (action !== 'call' || !tool?.startsWith('cad_')) throw new Error('Use agent tools [name] or agent call <cad-tool-name>')
  const options = agentOptions(rest)
  const toolSdk = createKJDrawSDK(), toolDocument = toolSdk.createDocument({ units: options.units ?? 'millimeter' })
  if (!new KJAgentToolSession(toolSdk, toolDocument).definitions.some(definition => definition.name === tool)) throw new Error(`Unknown KJDraw agent tool: ${tool}`)
  const requestedWorkspace = resolve(options.workspace ?? process.cwd())
  const workspaceInfo = await item(requestedWorkspace)
  if (!workspaceInfo?.isDirectory() || workspaceInfo.isSymbolicLink()) throw new Error('Agent workspace must be a real directory')
  const workspace = await realpath(requestedWorkspace)
  const input = await agentArguments(workspace, options['args-file'])
  const proposalDir = await ensureAgentProposalDir(workspace)
  const { openAgentHost, callAgentHost } = await import('./kjdraw-mcp.mjs')
  const host = await openAgentHost({ workspace, 'proposal-dir': proposalDir, 'tool-profile': 'full',
    ...(options.input ? { input: options.input } : { blank: options.blank, units: options.units }) })
  const response = await callAgentHost(host, tool, input)
  const visible = options.summary ? summarizeAgentProposal(response.output, host, tool) : response.output
  const output = { command: 'agent call', tool, ledger: host.ledger.session.ledgerPath, ...visible }
  if (response.isError) process.exitCode = 1
  return output
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return
  }
  if (args[0] === '--version' || args[0] === '-V') {
    console.log(KJDRAW_VERSION)
    return
  }
  const [command, input, output] = args
  if (command === 'onboard') {
    console.log(JSON.stringify(await onboard(args.slice(1)), null, 2))
    return
  }
  if (command === 'doctor') {
    const result = await doctor(args.slice(1))
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
    return
  }
  if (command === 'agent') {
    console.log(JSON.stringify(await agent(args.slice(1)), null, 2))
    return
  }
  if (command === 'inspect' || command === 'validate') {
    if (!input) throw new Error(`${command} requires an input file`)
    console.log(JSON.stringify(summary(await openInput(input)), null, 2))
    return
  }
  if (command === 'convert') {
    if (!input || !output) throw new Error('convert requires input and output files')
    console.log(JSON.stringify(await convert(input, output, args), null, 2))
    return
  }
  throw new Error(`Unknown command: ${String(command)}\n\n${HELP}`)
}

main().catch(error => {
  console.error(`KJDraw: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
