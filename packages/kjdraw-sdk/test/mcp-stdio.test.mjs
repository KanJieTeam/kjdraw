import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

test('published package declares both the CAD CLI and MCP host bins', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(packageJson.bin, { kjdraw: './bin/kjdraw.mjs', 'kjdraw-mcp': './bin/kjdraw-mcp.mjs' })
})
