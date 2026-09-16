import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { connectWorkspace, isEphemeralNodePath } from '../bin/kjdraw-connect-apply.mjs'
import { createKJDrawSDK } from '../src/sdk.js'

const script = fileURLToPath(new URL('../bin/kjdraw-connect-apply.mjs', import.meta.url))
const publicBin = fileURLToPath(new URL('../bin/kjdraw-connect.mjs', import.meta.url))
const configPaths = ['.kimi-code/mcp.json', '.workbuddy/mcp.json', '.zcode/config.json', '.trae/mcp.json']
const userConfigPaths = ['.kimi-code/mcp.json', '.workbuddy/mcp.json', '.zcode/cli/config.json']
const skillTargets = ['.kimi-code/skills/kjdraw-cad', '.zcode/skills/kjdraw-cad', '.trae/skills/kjdraw-cad']
const skillFiles = ['SKILL.md', 'references/routes.json', 'references/acceptance.md']
const options = root => ({ all: true, workspace: root, blank: '.kjdraw/active.kjd', units: 'millimeter', proposalDir: '.kjdraw/proposals', apply: true })
const hash = value => createHash('sha256').update(value).digest('hex')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-connect-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

async function seeded(root, relative, value) {
  const path = join(root, relative)
  await mkdir(dirname(path), { recursive: true })
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  await writeFile(path, bytes)
  return { path, bytes, sha256: hash(bytes) }
}

test('package exposes a dedicated kjdraw-connect binary', async () => {
  const packageJson = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  assert.equal(packageJson.bin['kjdraw-connect'], './bin/kjdraw-connect.mjs')
})

test('existing package binary delegates only --apply, retaining its zero-write preview', async t => {
  const root = await fixture(t)
  const apply = spawnSync(process.execPath, [publicBin, '--all', '--workspace', root, '--blank', '.kjdraw/active.kjd', '--units', 'meter', '--apply'], { encoding: 'utf8' })
  assert.equal(apply.status, 0, apply.stderr)
  assert.equal(JSON.parse(apply.stdout).drawing, 'created blank')
  const preview = spawnSync(process.execPath, [publicBin, '--all', '--dry-run', '--workspace', root, '--input', '.kjdraw/active.kjd'], { encoding: 'utf8' })
  assert.equal(preview.status, 0, preview.stderr)
  assert.equal(JSON.parse(preview.stdout).writesPerformed, 0)
})

test('preview changes no files; apply initializes a validated blank host drawing and four scoped entries', async t => {
  const root = await fixture(t)
  const run = args => spawnSync(process.execPath, [script, '--all', '--workspace', root, '--blank', '.kjdraw/active.kjd', '--units', 'millimeter', ...args], { encoding: 'utf8' })
  const preview = run([])
  assert.equal(preview.status, 0, preview.stderr)
  assert.equal((await readdir(root)).length, 0)
  const applied = run(['--apply'])
  assert.equal(applied.status, 0, applied.stderr)
  const result = JSON.parse(applied.stdout)
  assert.equal(result.clients.length, 4)
  assert.ok(result.clients.every(client => client.status === 'project-config-candidate-not-GUI-verified'))
  assert.equal(result.configurationEvidence.guiVerified, false)
  assert.equal(result.configurationEvidence.engineInvoked, false)
  assert.equal(result.configurationEvidence.serverEntryName, 'kjdraw')
  assert.equal(result.configurationEvidence.node.clientPathVerified, false)
  assert.match(result.configurationEvidence.node.readableInstallerCandidateSha256, /^[a-f0-9]{64}$/)
  assert.match(result.configurationEvidence.workBuddyGuide, /^https:\/\/www\.workbuddy\.ai\/docs\//)
  assert.equal(result.transientBackupCount, 0)
  assert.equal(result.retainedBackupCount, 0)
  assert.match(result.mcpScriptSha256, /^[a-f0-9]{64}$/)
  assert.match(result.skills.canonicalSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(result.skills.targets.map(target => target.path), skillTargets)
  const drawing = await createKJDrawSDK().readDocument(await readFile(join(root, '.kjdraw/active.kjd'), 'utf8'), { format: 'KJD' })
  assert.equal(drawing.snapshot().header.units, 'millimeter')
  assert.equal(drawing.listEntities().length, 0)
  assert.deepEqual(await readdir(join(root, '.kjdraw/proposals')), [])
  for (const rel of configPaths) {
    const value = JSON.parse(await readFile(join(root, rel), 'utf8'))
    const entry = rel.startsWith('.zcode/') ? value.mcp.servers.kjdraw : value.mcpServers.kjdraw
    assert.equal(entry.command, 'node')
    assert.equal(entry.args[entry.args.indexOf('--input') + 1], '.kjdraw/active.kjd')
    assert.equal(entry.args[entry.args.indexOf('--proposal-dir') + 1], '.kjdraw/proposals')
    if (rel.startsWith('.workbuddy/')) assert.equal(Object.hasOwn(entry, 'type'), false)
  }
  const sourceSkill = fileURLToPath(new URL('../skills/kjdraw-cad/', import.meta.url))
  for (const target of skillTargets) for (const file of skillFiles) {
    assert.deepEqual(await readFile(join(root, target, file)), await readFile(join(sourceSkill, file)))
  }
})

test('user scope writes only verified global config paths and returns TraeCode official import confirmation', async t => {
  const root = await fixture(t)
  const result = await connectWorkspace({ ...options(root), scope: 'user' })
  assert.equal(result.configurationEvidence.scope, 'user')
  assert.equal(result.clients.length, 4)
  assert.deepEqual(result.clients.slice(0, 3).map(client => client.client), ['Kimi Code', 'WorkBuddy', 'ZCode'])
  assert.ok(result.clients.slice(0, 3).every(client => client.status === 'user-config-candidate-not-GUI-verified'))
  const trae = result.clients[3]
  assert.equal(trae.client, 'TraeCode')
  assert.equal(trae.status, 'user-import-confirmation-required')
  assert.match(trae.installUrl, /^trae-cn:\/\/trae\.ai-ide\/mcp-import\?type=stdio&name=kjdraw&config=/)
  const encoded = new URL(trae.installUrl).searchParams.get('config')
  const imported = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  assert.equal(imported.command, 'node')
  assert.ok(imported.args.includes('--workspace'))
  assert.equal(imported.args[imported.args.indexOf('--workspace') + 1], root)
  for (const rel of userConfigPaths) assert.ok((await stat(join(root, rel))).isFile())
  await assert.rejects(readFile(join(root, '.zcode/config.json')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(root, '.trae/mcp.json')), { code: 'ENOENT' })
})

test('canonical project skills are idempotent and a conflicting copy blocks every write', async t => {
  const root = await fixture(t)
  const first = await connectWorkspace(options(root))
  const before = new Map()
  for (const target of skillTargets) for (const file of skillFiles) before.set(`${target}/${file}`, hash(await readFile(join(root, target, file))))
  const second = await connectWorkspace(options(root))
  assert.ok(second.skills.targets.every(target => target.action === 'unchanged'))
  for (const [file, sha256] of before) assert.equal(hash(await readFile(join(root, file))), sha256)

  const conflictRoot = await fixture(t)
  const conflict = join(conflictRoot, '.kimi-code/skills/kjdraw-cad/SKILL.md')
  await mkdir(dirname(conflict), { recursive: true })
  await writeFile(conflict, 'owner-managed skill')
  await assert.rejects(connectWorkspace(options(conflictRoot)), /Existing KJDraw Skill conflicts/)
  assert.equal(await readFile(conflict, 'utf8'), 'owner-managed skill')
  assert.deepEqual(await readdir(conflictRoot), ['.kimi-code'])
})

test('one connect transaction binds a host-hashed geology pack into all four clients without exposing style input to the model', async t => {
  const root = await fixture(t)
  const fields = [
    { start: 5, role: 'layerNumber', label: '层号' }, { start: 20, role: 'layerName', label: '地层名' },
    { start: 59, role: 'baseElevation', label: '底标高' }, { start: 74, role: 'thickness', label: '厚度' },
    { start: 89, role: 'depth', label: '层底深度' }, { start: 101, role: 'pattern', label: '花纹' },
    { start: 119, role: 'description', label: '描述' }, { start: 189, role: 'sample', label: '取样' },
    { start: 209, role: 'spt', label: '标贯' },
  ]
  const pack = { schema: 'kjdraw.knowledge-pack.v1', id: 'connect-geology-test', version: '1.0.0', title: 'MIT synthetic connect layout', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-grid', title: 'MIT-authored test grid', license: 'MIT', contentHash: hash('connect-geology-test-grid') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 300, paperHeight: 340, left: 5, right: 295, fieldGrid: fields, legendMode: 'none' } } }
  const saved = await seeded(root, 'knowledge/geology-column.json', pack)
  const result = await connectWorkspace({ ...options(root), 'geology-column-pack': 'knowledge/geology-column.json', 'geology-column-pack-sha256': saved.sha256 })
  assert.deepEqual(result.configurationEvidence.geologyColumnKnowledge, { id: pack.id, version: pack.version, sha256: saved.sha256, path: 'knowledge/geology-column.json' })
  let entry
  for (const relative of configPaths) {
    const config = JSON.parse(await readFile(join(root, relative), 'utf8'))
    const current = relative.startsWith('.zcode/') ? config.mcp.servers.kjdraw : config.mcpServers.kjdraw
    entry ??= current
    assert.deepEqual(current.args.slice(-4), ['--geology-column-pack', 'knowledge/geology-column.json', '--geology-column-pack-sha256', saved.sha256])
  }
  const drawing = join(root, '.kjdraw/active.kjd'), before = await readFile(drawing)
  const request = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
  const child = spawnSync(process.execPath, entry.args, { encoding: 'utf8', input: `${request(1, 'initialize', { protocolVersion: '2025-11-25' })}\n${request(2, 'tools/call', { name: 'cad_propose_geology_column', arguments: {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', verticalScaleDenominator: 125,
    hole: { id: 'ZK-TEST', collarElevation: 105, depth: 10,
      strata: [{ code: '1', name: '灰黄含砾粉质黏土夹层细砂', top: 0, bottom: 10, lithology: 'clay' }] }
  } })}\n`, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(child.status, 0, child.stderr)
  const responses = child.stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(responses[1].result.structuredContent.value.status, 'awaiting-host-approval')
  assert.deepEqual(responses[1].result.structuredContent.value.engineeringEvidence.knowledgePack, { id: pack.id, version: pack.version, sha256: saved.sha256 })
  assert.deepEqual(await readFile(drawing), before)
  assert.equal(hash(await readFile(saved.path)), saved.sha256)
})

test('official WorkBuddy command/args shape is configured, while a matching legacy type:stdio entry is preserved byte-for-byte', async t => {
  const root = await fixture(t)
  await connectWorkspace(options(root))
  const path = join(root, '.workbuddy/mcp.json')
  const value = JSON.parse(await readFile(path, 'utf8'))
  const officialShape = value.mcpServers.kjdraw
  assert.deepEqual(Object.keys(officialShape), ['command', 'args'])
  value.mcpServers.kjdraw = { type: 'stdio', ...officialShape }
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
  const beforeBytes = await readFile(path), beforeTime = (await stat(path)).mtimeMs
  const result = await connectWorkspace(options(root))
  assert.equal(result.clients.find(client => client.client === 'WorkBuddy').action, 'unchanged')
  assert.deepEqual(await readFile(path), beforeBytes)
  assert.equal((await stat(path)).mtimeMs, beforeTime)
  const conflict = structuredClone(value)
  conflict.mcpServers.kjdraw.args = ['owner-managed-other-server']
  await writeFile(path, `${JSON.stringify(conflict)}\n`)
  const conflictSha = hash(await readFile(path))
  await assert.rejects(connectWorkspace(options(root)), /Existing kjdraw MCP entry conflicts/)
  assert.equal(hash(await readFile(path)), conflictSha)
})

test('duplicate CLI options and absent Node on installer PATH refuse the transaction before any project write', async t => {
  const root = await fixture(t)
  const duplicate = spawnSync(process.execPath, [publicBin, '--all', '--workspace', root, '--workspace', root, '--blank', '.kjdraw/active.kjd', '--units', 'millimeter', '--apply'], { encoding: 'utf8' })
  assert.equal(duplicate.status, 1)
  assert.match(duplicate.stderr, /Duplicate option: --workspace/)
  assert.deepEqual(await readdir(root), [])
  const missingNode = spawnSync(process.execPath, [publicBin, '--all', '--workspace', root, '--blank', '.kjdraw/active.kjd', '--units', 'millimeter', '--apply'], {
    encoding: 'utf8', env: { ...process.env, PATH: root },
  })
  assert.equal(missingNode.status, 1)
  assert.match(missingNode.stderr, /Node executable is not on installer PATH/)
  assert.deepEqual(await readdir(root), [])
  if (process.platform === 'win32') {
    const shadow = join(root, 'shadow')
    await mkdir(shadow)
    await writeFile(join(shadow, 'node.cmd'), 'fixture-only; never execute')
    const wrapper = spawnSync(process.execPath, [publicBin, '--all', '--workspace', root, '--blank', '.kjdraw/active.kjd', '--units', 'millimeter', '--apply'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${shadow};${process.env.PATH}` },
    })
    assert.equal(wrapper.status, 1)
    assert.match(wrapper.stderr, /Node on installer PATH is a wrapper/)
    assert.deepEqual(await readdir(root), ['shadow'])
  }
  await writeFile(join(root, process.platform === 'win32' ? 'node.cmd' : 'node'), 'fixture-only; never execute')
  await assert.rejects(connectWorkspace(options(root)), /Project-local node command could shadow/)
  assert.deepEqual(await readdir(root), process.platform === 'win32' ? ['node.cmd', 'shadow'] : ['node'])
})

test('stable user-managed Node paths are not mistaken for project-local package shims', async t => {
  const root = process.platform === 'win32' ? 'C:/Users/Administrator' : '/home/developer'
  const stable = process.platform === 'win32'
    ? join(root, 'AppData/Local/fnm/node-versions/v24/installation/node.exe')
    : join(root, '.volta/tools/image/node/24/bin/node')
  assert.equal(isEphemeralNodePath(root, stable), false)
  assert.equal(isEphemeralNodePath(root, join(root, 'node_modules/.bin/node')), true)
  assert.equal(isEphemeralNodePath(root, join(root, 'AppData/Local/Temp/runtime/node.exe')), true)
  assert.equal(isEphemeralNodePath(root, join(root, '.npm/_npx/fixture/node')), true)
})

test('precise merge preserves unrelated fields; transient backups never leave fake keys beside configs', async t => {
  const root = await fixture(t)
  const originals = [
    await seeded(root, configPaths[0], { mcpServers: { memory: { command: 'existing', args: [] } }, model: 'untouched' }),
    await seeded(root, configPaths[1], { mcpServers: { calendar: { url: 'https://example.invalid/mcp' } }, auth: { key: 'keep-local' } }),
    await seeded(root, configPaths[2], { mcp: { servers: { browser: { command: 'existing' } } }, models: { selected: 'unchanged' } }),
    await seeded(root, configPaths[3], { mcpServers: { files: { command: 'existing' } }, profile: 'unchanged' }),
  ]
  const before = originals.map(item => JSON.parse(item.bytes.toString('utf8')))
  let witnessedBackups = 0
  const first = await connectWorkspace(options(root), { beforeReplace: async name => {
    if (name !== 'Kimi Code') return
    for (const original of originals) {
      const backups = (await readdir(dirname(original.path))).filter(file => file.includes('.kjdraw-backup-'))
      assert.equal(backups.length, 1)
      assert.equal(hash(await readFile(join(dirname(original.path), backups[0]))), original.sha256)
      witnessedBackups += 1
    }
  } })
  assert.equal(witnessedBackups, 4)
  assert.equal(first.transientBackupCount, 4)
  assert.equal(first.retainedBackupCount, 0)
  const after = []
  const afterTimes = []
  for (let index = 0; index < originals.length; index += 1) {
    const dir = dirname(originals[index].path)
    const backups = (await readdir(dir)).filter(name => name.includes('.kjdraw-backup-'))
    assert.equal(backups.length, 0)
    const value = JSON.parse(await readFile(originals[index].path, 'utf8'))
    const child = originals[index].path.includes('.zcode') ? value.mcp.servers : value.mcpServers
    delete child.kjdraw
    assert.deepEqual(value, before[index])
    after.push(await readFile(originals[index].path))
    afterTimes.push((await stat(originals[index].path)).mtimeMs)
  }
  const second = await connectWorkspace(options(root))
  assert.equal(second.transientBackupCount, 0)
  for (let index = 0; index < originals.length; index += 1) {
    assert.equal(hash(await readFile(originals[index].path)), hash(after[index]))
    assert.equal((await stat(originals[index].path)).mtimeMs, afterTimes[index])
    assert.equal((await readdir(dirname(originals[index].path))).filter(name => name.includes('.kjdraw-backup-')).length, 0)
  }
})

test('installation removes only its own temporary backups and leaves historical recovery files unchanged', async t => {
  const root = await fixture(t)
  const existing = await seeded(root, '.kimi-code/mcp.json', { mcpServers: { owner: { command: 'keep' } }, auth: { key: 'fixture-only-key' } })
  const historical = await seeded(root, '.kimi-code/mcp.json.kjdraw-backup-historical', { unrelated: 'owner-managed recovery' })
  const beforeTime = (await stat(historical.path)).mtimeMs
  const result = await connectWorkspace(options(root))
  assert.equal(result.transientBackupCount, 1)
  assert.equal(result.retainedBackupCount, 0)
  assert.notEqual(hash(await readFile(existing.path)), existing.sha256)
  assert.equal(hash(await readFile(historical.path)), historical.sha256)
  assert.equal((await stat(historical.path)).mtimeMs, beforeTime)
  assert.deepEqual((await readdir(dirname(existing.path))).filter(name => name.includes('.kjdraw-backup-')), ['mcp.json.kjdraw-backup-historical'])
})

test('conflicting kjdraw entry rejects all changes, including blank drawing', async t => {
  const root = await fixture(t)
  const existing = await seeded(root, '.zcode/config.json', { mcp: { servers: { kjdraw: { command: 'user-owned' } } }, model: 'keep' })
  await assert.rejects(connectWorkspace(options(root)), /Existing kjdraw MCP entry conflicts/)
  assert.equal(hash(await readFile(existing.path)), existing.sha256)
  assert.deepEqual(await readdir(root), ['.zcode'])
})

test('ZCode .agents fallback services are not silently shadowed by a new native config', async t => {
  const root = await fixture(t)
  const fallback = await seeded(root, '.agents/mcp.json', { mcpServers: { retained: { command: 'existing' } } })
  await assert.rejects(connectWorkspace(options(root)), /would hide them/)
  assert.equal(hash(await readFile(fallback.path)), fallback.sha256)
  await assert.rejects(readFile(join(root, '.zcode/config.json')), { code: 'ENOENT' })
})

test('mid-commit failure restores original config bytes and removes newly created drawing', async t => {
  const root = await fixture(t)
  const original = await seeded(root, '.kimi-code/mcp.json', { mcpServers: { owner: { command: 'keep' } }, secret: 'never log this' })
  await assert.rejects(connectWorkspace(options(root), { beforeReplace: name => { if (name === 'ZCode') throw new Error('injected commit failure') } }), /injected commit failure/)
  assert.equal(hash(await readFile(original.path)), original.sha256)
  for (const rel of configPaths.slice(1)) await assert.rejects(readFile(join(root, rel)), { code: 'ENOENT' })
  await assert.rejects(readFile(join(root, '.kjdraw/active.kjd')), { code: 'ENOENT' })
  assert.equal((await readdir(dirname(original.path))).filter(name => name.includes('.kjdraw-backup-')).length, 0)
})

test('rollback preserves concurrent owner edits to an installed config and host drawing', async t => {
  const root = await fixture(t)
  const original = await seeded(root, '.kimi-code/mcp.json', { mcpServers: { owner: { command: 'keep' } }, auth: { key: 'fixture-only-key' } })
  const kimi = original.path
  const drawing = join(root, '.kjdraw/active.kjd')
  let ownerConfig, ownerDrawing
  await assert.rejects(connectWorkspace(options(root), { beforeReplace: async name => {
    if (name !== 'ZCode') return
    ownerConfig = Buffer.from('{"ownerEdit":"keep"}\n')
    ownerDrawing = Buffer.concat([await readFile(drawing), Buffer.from('\n')])
    await writeFile(kimi, ownerConfig)
    await writeFile(drawing, ownerDrawing)
    throw new Error('injected concurrent owner edit')
  } }), /rollback preserved concurrently changed files: Kimi Code, host drawing; recovery backups retained for conflicted configurations: \.kimi-code\/mcp\.json\.kjdraw-backup-/)
  assert.deepEqual(await readFile(kimi), ownerConfig)
  assert.deepEqual(await readFile(drawing), ownerDrawing)
  const recovery = (await readdir(dirname(kimi))).filter(name => name.includes('.kjdraw-backup-'))
  assert.equal(recovery.length, 1)
  assert.equal(hash(await readFile(join(dirname(kimi), recovery[0]))), original.sha256)
  await assert.rejects(readFile(join(root, '.workbuddy/mcp.json')), { code: 'ENOENT' })
})

test('rejects configuration symbolic links and traversal without rewriting their targets', async t => {
  const root = await fixture(t)
  const outside = await fixture(t)
  const target = await seeded(outside, 'owner.json', { mcpServers: { owner: { command: 'keep' } } })
  await mkdir(join(root, '.kimi-code'))
  try { await symlink(target.path, join(root, '.kimi-code/mcp.json')) } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return; throw error }
  await assert.rejects(connectWorkspace(options(root)), /symbolic link/)
  assert.equal(hash(await readFile(target.path)), target.sha256)
  await assert.rejects(connectWorkspace({ ...options(root), blank: '../escape.kjd' }), /inside --workspace/)
})

test('existing drawing input must exist; malformed JSON is not silently replaced', async t => {
  const root = await fixture(t)
  await assert.rejects(connectWorkspace({ all: true, apply: true, workspace: root, input: 'missing.kjd' }), /Existing drawing not found/)
  const sdk = createKJDrawSDK()
  await writeFile(join(root, 'existing.kjd'), await sdk.writeDocument(sdk.createDocument({ units: 'meter' }), { format: 'KJD' }))
  await mkdir(join(root, '.workbuddy'))
  await writeFile(join(root, '.workbuddy/mcp.json'), '{ broken JSON')
  await assert.rejects(connectWorkspace({ all: true, apply: true, workspace: root, input: 'existing.kjd' }), /Configuration JSON is invalid/)
  assert.equal(await readFile(join(root, '.workbuddy/mcp.json'), 'utf8'), '{ broken JSON')
})

test('generated MCP arguments initialize, list tools and get distinct session ledgers', async t => {
  const root = await fixture(t)
  await connectWorkspace(options(root))
  const entry = JSON.parse(await readFile(join(root, '.kimi-code/mcp.json'), 'utf8')).mcpServers.kjdraw
  const mcpScript = process.env.KJDRAW_MCP_TEST_BIN ?? entry.args[0]
  const source = await readFile(mcpScript, 'utf8')
  if (!source.includes("'--proposal-dir'")) { t.skip('MCP --proposal-dir implementation has not been merged into this worktree'); return }
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'kjdraw-connect-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map(value => JSON.stringify(value)).join('\n') + '\n'
  const drawingPath = join(root, '.kjdraw/active.kjd')
  const drawingSha = hash(await readFile(drawingPath))
  const launch = () => {
    const child = spawnSync(process.execPath, [mcpScript, ...entry.args.slice(1)], { input, encoding: 'utf8', timeout: 10000 })
    assert.equal(child.status, 0, child.stderr)
    const messages = child.stdout.trim().split('\n').map(line => JSON.parse(line))
    assert.equal(messages.length, 2)
    assert.equal(messages[0].result.protocolVersion, '2025-11-25')
    assert.ok(messages[1].result.tools.some(tool => tool.name === 'cad_read_drawing'))
    return messages[0].result._meta?.['com.kanjie.kjdraw/session']
  }
  const first = launch(), second = launch()
  assert.ok(first && second)
  assert.notDeepEqual(first, second)
  assert.equal(hash(await readFile(drawingPath)), drawingSha)
})
