import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'

const executable = fileURLToPath(new URL('../bin/kjdraw-mcp.mjs', import.meta.url))
const request = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })

async function drawingFixture(format) {
  const directory = await mkdtemp(join(tmpdir(), `kjdraw-mcp-${format.toLowerCase()}-`))
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `mcp-${format.toLowerCase()}`, units: 'millimeter' })
  await document.transact('fixture', transaction => {
    transaction.createEntity('LINE', { start: [0, 0], end: [100, 0] }, { id: 'edge' })
  })
  const inputName = `drawing.${format.toLowerCase()}`
  await writeFile(join(directory, inputName), await sdk.writeDocument(document, { format }))
  return { directory, inputName, document }
}

function run(directory, inputName, messages, proposals = 'pending.json') {
  const child = spawnSync(process.execPath, [executable, '--workspace', directory, '--input', inputName, '--proposals', proposals], {
    input: `${messages.join('\n')}\n`, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stderr, '')
  return child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function invoke(args, messages = []) {
  return spawnSync(process.execPath, [executable, ...args], {
    input: messages.length ? `${messages.join('\n')}\n` : '', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  })
}

function blankArgs(directory, blank = 'blank.kjd', proposals = 'pending.json', units = 'meter') {
  return ['--workspace', directory, '--blank', blank, '--units', units, '--proposals', proposals]
}

test('MCP host creates and reopens a host-selected blank KJD, while model calls remain proposal-only', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-mcp-blank-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const messages = [
    request(1, 'initialize', { protocolVersion: '2025-11-25' }),
    request(2, 'tools/list', {}),
    request(3, 'tools/call', { name: 'cad_read_drawing', arguments: {} }),
    request(4, 'tools/call', { name: 'cad_propose_lines', arguments: {
      expectedRevision: 0, units: 'meter', lines: [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]
    } }),
    request(5, 'tools/call', { name: 'cad_approve', arguments: { planId: 'forbidden' } }),
    request(6, 'tools/call', { name: 'cad_save', arguments: { path: 'model-chosen.kjd' } })
  ]
  const child = invoke(blankArgs(directory), messages)
  assert.equal(child.status, 0, child.stderr)
  const responses = child.stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(responses.map(row => row.id), [1, 2, 3, 4, 5, 6])
  const listed = responses[1].result.tools.map(tool => tool.name)
  assert.ok(listed.includes('cad_propose_lines'))
  assert.equal(listed.some(name => /approve|save|open|blank/u.test(name)), false)
  assert.equal(responses[2].result.structuredContent.value.revision, 0)
  assert.deepEqual(responses[2].result.structuredContent.value.entities, [])
  assert.equal(responses[3].result.structuredContent.value.status, 'awaiting-host-approval')
  assert.equal(responses[4].error.code, -32602)
  assert.equal(responses[5].error.code, -32602)

  const drawingPath = join(directory, 'blank.kjd')
  const original = await readFile(drawingPath)
  const sdk = createKJDrawSDK()
  const reopened = await sdk.readDocument(original.toString('utf8'), { format: 'KJD' })
  assert.equal(reopened.validate().valid, true)
  assert.equal(reopened.revision, 0)
  assert.equal(reopened.snapshot().header.units, 'meter')
  assert.equal(reopened.listEntities().length, 0)
  assert.deepEqual(await readFile(drawingPath), original)
  await assert.rejects(readFile(join(directory, 'model-chosen.kjd')), /ENOENT/u)
  const ledger = JSON.parse(await readFile(join(directory, 'pending.json'), 'utf8'))
  assert.equal(ledger.source.createdBlank, true)
  assert.equal(ledger.source.path, 'blank.kjd')
  assert.equal(ledger.source.documentId, reopened.id)
  assert.equal(ledger.source.revision, 0)
  assert.equal(ledger.source.units, 'meter')
  assert.equal(ledger.proposals.length, 1)
})

test('MCP blank and existing input modes are mutually exclusive and units are host-only', async t => {
  const fixture = await drawingFixture('KJD')
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))
  const cases = [
    ['--workspace', fixture.directory, '--blank', 'new.kjd', '--proposals', 'pending.json'],
    ['--workspace', fixture.directory, '--input', fixture.inputName, '--blank', 'new.kjd', '--units', 'meter', '--proposals', 'pending.json'],
    ['--workspace', fixture.directory, '--input', fixture.inputName, '--units', 'meter', '--proposals', 'pending.json'],
    ['--workspace', fixture.directory, '--blank', 'new.kjd', '--units', 'feet', '--proposals', 'pending.json'],
    ['--workspace', fixture.directory, '--blank', 'new.kjd', '--blank', 'other.kjd', '--units', 'meter', '--proposals', 'pending.json'],
  ]
  for (const args of cases) {
    const child = invoke(args)
    assert.equal(child.status, 2, child.stderr)
    assert.equal(child.stdout, '')
  }
  await assert.rejects(readFile(join(fixture.directory, 'new.kjd')), /ENOENT/u)
  await assert.rejects(readFile(join(fixture.directory, 'pending.json')), /ENOENT/u)
})

test('MCP blank path and ledger path cannot escape, alias, or overwrite existing files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-mcp-blank-paths-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const existing = Buffer.from('host-owned drawing must remain unchanged')
  await writeFile(join(directory, 'existing.kjd'), existing)
  await writeFile(join(directory, 'pending-existing.json'), existing)
  const cases = [
    { args: blankArgs(directory, '../escape.kjd'), error: /inside --workspace/u },
    { args: blankArgs(directory, join(directory, 'absolute.kjd')), error: /inside --workspace/u },
    { args: blankArgs(directory, 'existing.kjd'), error: /already exists/u },
    { args: blankArgs(directory, 'same.kjd', 'same.kjd'), error: /must not overwrite/u },
    { args: blankArgs(directory, 'unused.kjd', 'pending-existing.json'), error: /already exists/u },
    { args: blankArgs(directory, 'not-a-drawing.dxf'), error: /new \.kjd drawing/u },
  ]
  for (const { args, error } of cases) {
    const child = invoke(args)
    assert.equal(child.status, 1, child.stderr)
    assert.match(child.stderr, error)
    assert.equal(child.stdout, '')
  }
  assert.deepEqual(await readFile(join(directory, 'existing.kjd')), existing)
  assert.deepEqual(await readFile(join(directory, 'pending-existing.json')), existing)
  await assert.rejects(readFile(join(directory, 'unused.kjd')), /ENOENT/u)
  await assert.rejects(readFile(join(directory, 'same.kjd')), /ENOENT/u)
})

test('MCP blank path refuses symbolic-link directories and existing symbolic-link targets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-mcp-blank-link-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'real'))
  const alias = join(directory, 'alias'), real = join(directory, 'real')
  try {
    await symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error
    if (process.platform !== 'win32') { t.skip(`Symlink creation unavailable: ${error.code}`); return }
    // Windows directory junctions do not require Developer Mode. The paths
    // are resolved fixture children; cmd is used only to create this link.
    const junction = spawnSync('cmd.exe', ['/d', '/s', '/c', `mklink /J "${alias}" "${real}"`], { encoding: 'utf8' })
    if (junction.status !== 0) { t.skip(`Junction creation unavailable: ${junction.stderr || junction.stdout}`); return }
  }
  let hasFileLink = true
  try { await symlink(join(real, 'hidden.kjd'), join(directory, 'dangling.kjd'), 'file') }
  catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error
    hasFileLink = false
    t.diagnostic(`File symlink creation unavailable: ${error.code}; directory junction rejection is still exercised`)
  }
  const cases = [
    { args: blankArgs(directory, 'alias/created.kjd'), error: /symbolic link/u },
    { args: blankArgs(directory, 'real/unused.kjd', 'alias/pending.json'), error: /symbolic link/u },
    { args: blankArgs(join(directory, 'alias'), 'root.kjd'), error: /symbolic link/u },
    ...(hasFileLink ? [{ args: blankArgs(directory, 'dangling.kjd'), error: /already exists/u }] : []),
  ]
  for (const { args, error } of cases) {
    const child = invoke(args)
    assert.equal(child.status, 1, child.stderr)
    assert.match(child.stderr, error)
  }
  await assert.rejects(readFile(join(directory, 'real', 'created.kjd')), /ENOENT/u)
  await assert.rejects(readFile(join(directory, 'real', 'unused.kjd')), /ENOENT/u)
})

test('MCP stdio exposes the attached Agent registry and persists proposals without changing KJD', async t => {
  const fixture = await drawingFixture('KJD')
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))
  const inputPath = join(fixture.directory, fixture.inputName)
  const original = await readFile(inputPath)
  const sdk = createKJDrawSDK()
  const expectedDocument = await sdk.readDocument(original, { format: 'KJD' })
  const expectedDefinitions = new KJAgentToolSession(sdk, expectedDocument).definitions

  const responses = run(fixture.directory, fixture.inputName, [
    request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'integration-test', version: '1' } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    request(2, 'tools/list', {}),
    request(3, 'tools/call', { name: 'cad_read_drawing', arguments: {} }),
    request(4, 'tools/call', { name: 'cad_propose_move', arguments: {
      expectedRevision: expectedDocument.revision, units: 'millimeter', ids: ['edge'], dx: 25, dy: 10
    } }),
    request(5, 'tools/call', { name: 'cad_approve', arguments: { planId: 'forbidden' } })
  ])

  assert.deepEqual(responses.map(response => response.id), [1, 2, 3, 4, 5])
  assert.equal(responses[0].result.protocolVersion, '2025-11-25')
  assert.deepEqual(responses[0].result.capabilities, { tools: { listChanged: false } })
  const listed = responses[1].result.tools
  assert.deepEqual(listed.map(tool => tool.name), expectedDefinitions.map(tool => tool.name))
  assert.deepEqual(listed.map(tool => tool.inputSchema), expectedDefinitions.map(tool => tool.inputSchema))
  assert.ok(listed.some(tool => tool.name === 'cad_propose_geology_column' && tool.annotations.readOnlyHint === false))
  assert.ok(listed.some(tool => tool.name === 'cad_propose_geology_section' && tool.annotations.readOnlyHint === false))
  assert.equal(listed.some(tool => /approve|save|open/u.test(tool.name)), false)
  assert.equal(listed.find(tool => tool.name === 'cad_read_drawing').annotations.readOnlyHint, true)
  assert.equal(listed.find(tool => tool.name === 'cad_propose_move').annotations.readOnlyHint, false)

  assert.equal(responses[2].result.structuredContent.ok, true)
  const proposal = responses[3].result.structuredContent
  assert.equal(proposal.ok, true)
  assert.equal(proposal.value.status, 'awaiting-host-approval')
  assert.equal(proposal.value.command, 'MOVE')
  assert.equal(responses[4].error.code, -32602)
  assert.deepEqual(await readFile(inputPath), original)

  const ledger = JSON.parse(await readFile(join(fixture.directory, 'pending.json'), 'utf8'))
  assert.equal(ledger.schema, 'com.kanjie.kjdraw.mcp-pending-proposals@1')
  assert.equal(ledger.source.format, 'KJD')
  assert.equal(ledger.source.revision, expectedDocument.revision)
  assert.match(ledger.source.fingerprint, /^[a-f0-9]{64}$/u)
  assert.equal(ledger.proposals.length, 1)
  assert.equal(ledger.proposals[0].tool, 'cad_propose_move')
  assert.deepEqual(ledger.proposals[0].result, proposal.value)
})

test('MCP stdio loads host-selected DXF and rejects calls before initialization', async t => {
  const fixture = await drawingFixture('DXF')
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))
  const original = await readFile(join(fixture.directory, fixture.inputName))
  const responses = run(fixture.directory, fixture.inputName, [
    request(1, 'tools/list', {}),
    request(2, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'integration-test', version: '1' } }),
    request(3, 'tools/call', { name: 'cad_read_drawing', arguments: {} })
  ])
  assert.equal(responses[0].error.code, -32002)
  assert.equal(responses[1].result.protocolVersion, '2025-06-18')
  assert.equal(responses[2].result.structuredContent.ok, true)
  assert.equal(responses[2].result.structuredContent.value.entities[0].type, 'LINE')
  assert.deepEqual(await readFile(join(fixture.directory, fixture.inputName)), original)
  assert.deepEqual(JSON.parse(await readFile(join(fixture.directory, 'pending.json'), 'utf8')).proposals, [])
})

test('MCP host refuses drawing paths outside the explicit workspace', async t => {
  const fixture = await drawingFixture('KJD')
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))
  const child = spawnSync(process.execPath, [executable, '--workspace', fixture.directory, '--input', '../drawing.kjd', '--proposals', 'pending.json'], {
    input: '', encoding: 'utf8'
  })
  assert.equal(child.status, 1)
  assert.match(child.stderr, /inside --workspace/u)
  assert.equal(child.stdout, '')
})

test('MCP host refuses an existing proposal ledger without changing it', async t => {
  const fixture = await drawingFixture('KJD')
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))
  const pendingPath = join(fixture.directory, 'pending.json')
  const existing = Buffer.from('{"protected":"host-pending-review"}\n')
  await writeFile(pendingPath, existing)
  const child = spawnSync(process.execPath, [executable, '--workspace', fixture.directory, '--input', fixture.inputName, '--proposals', 'pending.json'], {
    input: request(1, 'initialize', { protocolVersion: '2025-11-25' }), encoding: 'utf8'
  })
  assert.equal(child.status, 1)
  assert.match(child.stderr, /EEXIST|already exists/u)
  assert.equal(child.stdout, '')
  assert.deepEqual(await readFile(pendingPath), existing)
})

test('MCP session-ledger directory allows repeated stdio startups on one unchanged drawing', async t => {
  const fixture = await drawingFixture('KJD')
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))
  await mkdir(join(fixture.directory, 'sessions'))
  const inputPath = join(fixture.directory, fixture.inputName)
  const originalDrawing = await readFile(inputPath)
  const args = ['--workspace', fixture.directory, '--input', fixture.inputName, '--proposal-dir', 'sessions']
  const first = invoke(args, [
    request(1, 'initialize', { protocolVersion: '2025-11-25' }),
    request(2, 'tools/list', {}),
    request(3, 'tools/call', { name: 'cad_propose_move', arguments: {
      expectedRevision: fixture.document.revision, units: 'millimeter', ids: ['edge'], dx: 5, dy: 0
    } }),
    request(4, 'tools/call', { name: 'cad_approve', arguments: { planId: 'forbidden' } })
  ])
  assert.equal(first.status, 0, first.stderr)
  const firstResponses = first.stdout.trim().split('\n').map(line => JSON.parse(line))
  const firstMeta = firstResponses[0].result._meta?.['com.kanjie.kjdraw/session']
  assert.ok(firstMeta)
  assert.match(firstMeta.ledgerPath, /^sessions\/mcp-pending-[0-9a-f-]+\.json$/u)
  assert.equal(firstResponses[1].result.tools.some(tool => /approve|save|open/u.test(tool.name)), false)
  assert.equal(firstResponses[2].result.structuredContent.value.status, 'awaiting-host-approval')
  assert.equal(firstResponses[3].error.code, -32602)
  const firstLedgerPath = join(fixture.directory, firstMeta.ledgerPath)
  const firstLedgerBytes = await readFile(firstLedgerPath)
  const firstLedger = JSON.parse(firstLedgerBytes)
  assert.equal(firstLedger.session.id, firstMeta.sessionId)
  assert.equal(firstLedger.session.ledgerPath, firstMeta.ledgerPath)
  assert.equal(firstLedger.source.fingerprint, firstMeta.sourceFingerprint)
  assert.equal(firstLedger.source.revision, firstMeta.sourceRevision)
  assert.equal(firstLedger.source.documentId, firstMeta.sourceDocumentId)
  assert.equal(firstLedger.proposals.length, 1)

  const second = invoke(args, [
    request(1, 'initialize', { protocolVersion: '2025-11-25' }),
    request(2, 'tools/call', { name: 'cad_read_drawing', arguments: {} })
  ])
  assert.equal(second.status, 0, second.stderr)
  const secondResponses = second.stdout.trim().split('\n').map(line => JSON.parse(line))
  const secondMeta = secondResponses[0].result._meta?.['com.kanjie.kjdraw/session']
  assert.ok(secondMeta)
  assert.notEqual(secondMeta.sessionId, firstMeta.sessionId)
  assert.notEqual(secondMeta.ledgerPath, firstMeta.ledgerPath)
  assert.equal(secondMeta.sourceFingerprint, firstMeta.sourceFingerprint)
  assert.equal(secondResponses[1].result.structuredContent.value.entities[0].type, 'LINE')
  const secondLedger = JSON.parse(await readFile(join(fixture.directory, secondMeta.ledgerPath)))
  assert.equal(secondLedger.session.id, secondMeta.sessionId)
  assert.deepEqual(secondLedger.proposals, [])
  assert.deepEqual(await readFile(firstLedgerPath), firstLedgerBytes)
  assert.deepEqual(await readFile(inputPath), originalDrawing)
})

test('MCP session-ledger mode refuses missing, aliased, or model-like host directory choices', async t => {
  const fixture = await drawingFixture('KJD')
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))
  const originalDrawing = await readFile(join(fixture.directory, fixture.inputName))
  const prefix = ['--workspace', fixture.directory, '--input', fixture.inputName]
  const parseFailures = [
    [...prefix],
    [...prefix, '--proposals', 'pending.json', '--proposal-dir', 'sessions'],
  ]
  for (const args of parseFailures) {
    const child = invoke(args)
    assert.equal(child.status, 2, child.stderr)
    assert.equal(child.stdout, '')
  }
  await mkdir(join(fixture.directory, 'real-sessions'))
  const invalid = [
    [...prefix, '--proposal-dir', 'missing-sessions'],
    [...prefix, '--proposal-dir', '../elsewhere'],
    [...prefix, '--proposal-dir', 'drawing.kjd'],
  ]
  for (const args of invalid) {
    const child = invoke(args)
    assert.equal(child.status, 1, child.stderr)
    assert.equal(child.stdout, '')
  }
  const linked = join(fixture.directory, 'linked-sessions')
  const real = join(fixture.directory, 'real-sessions')
  try {
    await symlink(real, linked, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error
    const junction = spawnSync('cmd.exe', ['/d', '/s', '/c', `mklink /J "${linked}" "${real}"`], { encoding: 'utf8' })
    assert.equal(junction.status, 0, 'Controlled fixture junction creation failed')
  }
  const linkedChild = invoke([...prefix, '--proposal-dir', 'linked-sessions'])
  assert.equal(linkedChild.status, 1, linkedChild.stderr)
  assert.match(linkedChild.stderr, /symbolic link/u)
  assert.equal(linkedChild.stdout, '')
  assert.deepEqual(await readFile(join(fixture.directory, fixture.inputName)), originalDrawing)
})

test('MCP host can create a blank KJD with a unique session ledger and host-visible source receipt', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-mcp-blank-session-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'sessions'))
  const child = invoke(['--workspace', directory, '--blank', 'new.kjd', '--units', 'meter', '--proposal-dir', 'sessions'], [
    request(1, 'initialize', { protocolVersion: '2025-11-25' }),
    request(2, 'tools/call', { name: 'cad_read_drawing', arguments: {} })
  ])
  assert.equal(child.status, 0, child.stderr)
  const responses = child.stdout.trim().split('\n').map(line => JSON.parse(line))
  const meta = responses[0].result._meta?.['com.kanjie.kjdraw/session']
  assert.ok(meta)
  assert.match(meta.ledgerPath, /^sessions\/mcp-pending-[0-9a-f-]+\.json$/u)
  assert.equal(responses[1].result.structuredContent.value.revision, 0)
  assert.deepEqual(responses[1].result.structuredContent.value.entities, [])
  const ledger = JSON.parse(await readFile(join(directory, meta.ledgerPath), 'utf8'))
  assert.equal(ledger.session.id, meta.sessionId)
  assert.equal(ledger.source.createdBlank, true)
  assert.equal(ledger.source.path, 'new.kjd')
  assert.equal(ledger.source.units, 'meter')
  assert.equal(ledger.source.fingerprint, meta.sourceFingerprint)
  const reopened = await createKJDrawSDK().readDocument(await readFile(join(directory, 'new.kjd')), { format: 'KJD' })
  assert.equal(reopened.validate().valid, true)
  assert.equal(reopened.revision, 0)
  assert.equal(reopened.snapshot().header.units, 'meter')
})

test('MCP host bounds an oversized frame, discards it, and resumes on the next newline', async t => {
  const fixture = await drawingFixture('KJD')
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))
  const oversized = 'x'.repeat(4 * 1024 * 1024 + 1)
  const responses = run(fixture.directory, fixture.inputName, [
    request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'integration-test', version: '1' } }),
    oversized,
    request(2, 'ping'),
    request(3, 'tools/list', {})
  ])
  assert.deepEqual(responses.map(response => response.id), [1, null, 2, 3])
  assert.equal(responses[1].error.code, -32600)
  assert.match(responses[1].error.message, /4 MiB/u)
  assert.deepEqual(responses[2].result, {})
  assert.ok(responses[3].result.tools.length > 10)
})

test('published package declares CAD CLI, MCP host and connect preview bins', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(packageJson.bin, { kjdraw: './bin/kjdraw.mjs', 'kjdraw-mcp': './bin/kjdraw-mcp.mjs', 'kjdraw-connect': './bin/kjdraw-connect.mjs' })
})
