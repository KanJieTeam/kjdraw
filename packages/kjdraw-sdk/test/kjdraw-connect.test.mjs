import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../src/sdk.js'

const executable = fileURLToPath(new URL('../bin/kjdraw-connect.mjs', import.meta.url))
const mcpBin = fileURLToPath(new URL('../bin/kjdraw-mcp.mjs', import.meta.url))
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const sha = value => createHash('sha256').update(value).digest('hex')

async function fixture(t) {
  const workspace = await mkdtemp(join(repository, 'kjdraw-connect-test-'))
  t.after(async () => {
    assert.ok(workspace.startsWith(join(repository, 'kjdraw-connect-test-')))
    await rm(workspace, { recursive: true, force: true })
  })
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'connect-test-only', units: 'millimeter' })
  await document.transact('test-circle', transaction => {
    transaction.createEntity('CIRCLE', { center: [10, 10], radius: 5 }, { id: 'fixture-circle' })
  })
  await writeFile(join(workspace, 'fixture.kjd'), await sdk.writeDocument(document, { format: 'KJD' }))
  return workspace
}

function invoke(workspace, input = 'fixture.kjd', extra = []) {
  return spawnSync(process.execPath, [executable, '--all', '--dry-run', '--workspace', workspace, '--input', input, ...extra], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  })
}

function run(workspace, input = 'fixture.kjd', extra = []) {
  const child = invoke(workspace, input, extra)
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stderr, '')
  return { child, receipt: JSON.parse(child.stdout) }
}

async function linkDirectory(real, alias) {
  try {
    await symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error?.code)) throw error
    const junction = spawnSync('cmd.exe', ['/d', '/s', '/c', `mklink /J "${alias}" "${real}"`], { encoding: 'utf8' })
    assert.equal(junction.status, 0, 'Controlled fixture junction creation failed')
  }
}

test('KJDraw connect builds deterministic, branded, zero-write plans for three official project schemas', async t => {
  const workspace = await fixture(t)
  const before = await readFile(join(workspace, 'fixture.kjd'))
  const first = run(workspace).receipt
  const second = run(workspace).receipt
  assert.equal(first.product, 'KJDraw')
  assert.equal(first.engineInvoked, false)
  assert.equal(first.writesPerformed, 0)
  assert.equal(first.planHash, second.planHash)
  assert.equal(first.source.format, 'KJD')
  assert.equal(first.proposalLedger.exists, false)
  assert.equal(first.proposalLedger.startupStatus, 'first-start-only-static-ledger')
  assert.deepEqual(first.adapters.map(row => row.adapter), ['kimi-code', 'zcode', 'traecode', 'workbuddy'])
  assert.deepEqual(first.adapters.map(row => row.status), ['add', 'add', 'add', 'manual-verification-required'])
  assert.deepEqual(first.adapters.slice(0, 3).map(row => row.configFile), ['.kimi-code/mcp.json', '.zcode/config.json', '.trae/mcp.json'])
  for (const adapter of first.adapters.slice(0, 3)) {
    assert.match(adapter.desiredEntryHash, /^[0-9a-f]{64}$/u)
    assert.match(adapter.targetHash, /^[0-9a-f]{64}$/u)
    await assert.rejects(readFile(join(workspace, adapter.configFile)), /ENOENT/u)
  }
  await assert.rejects(readFile(join(workspace, 'kjdraw-pending.json')), /ENOENT/u)
  assert.deepEqual(await readFile(join(workspace, 'fixture.kjd')), before)
})

test('existing unrelated MCP settings are planned without printing or changing private contents', async t => {
  const workspace = await fixture(t)
  const cases = [
    ['.kimi-code/mcp.json', { mcpServers: { other: { command: 'dummy', env: { TOKEN: 'TEST_SECRET_NEVER_PRINT' } } } }],
    ['.zcode/config.json', { mcp: { servers: { other: { command: 'dummy', env: { TOKEN: 'TEST_SECRET_NEVER_PRINT' } } } } }],
    ['.trae/mcp.json', { mcpServers: { other: { command: 'dummy', env: { TOKEN: 'TEST_SECRET_NEVER_PRINT' } } } }],
  ]
  const originals = new Map()
  for (const [relativeFile, config] of cases) {
    const file = join(workspace, relativeFile)
    await mkdir(dirname(file), { recursive: true })
    const bytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`)
    await writeFile(file, bytes)
    originals.set(file, bytes)
  }
  const { child, receipt } = run(workspace)
  assert.equal(child.stdout.includes('TEST_SECRET_NEVER_PRINT'), false)
  assert.equal(child.stdout.includes('"TOKEN"'), false)
  assert.equal(child.stdout.includes('"other"'), false)
  assert.deepEqual(receipt.adapters.slice(0, 3).map(row => row.status), ['add', 'add', 'add'])
  for (const [file, bytes] of originals) assert.deepEqual(await readFile(file), bytes)
})

test('an exact existing KJDraw entry is unchanged; an unrelated entry conflict is never overwritten', async t => {
  const workspace = await fixture(t)
  const desired = { command: process.execPath, args: [mcpBin, '--workspace', workspace, '--input', 'fixture.kjd', '--proposals', 'kjdraw-pending.json'] }
  const unchangedFile = join(workspace, '.kimi-code', 'mcp.json')
  const conflictFile = join(workspace, '.zcode', 'config.json')
  await mkdir(dirname(unchangedFile), { recursive: true })
  await mkdir(dirname(conflictFile), { recursive: true })
  const unchanged = Buffer.from(JSON.stringify({ mcpServers: { kjdraw: desired } }))
  const conflict = Buffer.from(JSON.stringify({ mcp: { servers: { kjdraw: { command: 'other-cad', env: { TOKEN: 'TEST_SECRET_NEVER_PRINT' } } } } }))
  await writeFile(unchangedFile, unchanged)
  await writeFile(conflictFile, conflict)
  const { child, receipt } = run(workspace)
  assert.equal(child.stdout.includes('TEST_SECRET_NEVER_PRINT'), false)
  const [kimi, zcode] = receipt.adapters
  assert.equal(kimi.status, 'unchanged')
  assert.equal(kimi.existingFileHash, sha(unchanged))
  assert.equal(kimi.targetHash, sha(unchanged))
  assert.equal(zcode.status, 'conflict')
  assert.equal(zcode.targetHash, null)
  assert.equal(zcode.existingFileHash, sha(conflict))
  assert.deepEqual(await readFile(unchangedFile), unchanged)
  assert.deepEqual(await readFile(conflictFile), conflict)
})

test('invalid schema and invalid JSON are status-only; existing static ledger is explicitly blocked', async t => {
  const workspace = await fixture(t)
  await mkdir(join(workspace, '.kimi-code'))
  await mkdir(join(workspace, '.zcode'))
  await writeFile(join(workspace, '.kimi-code', 'mcp.json'), '{not json, TEST_SECRET_NEVER_PRINT}')
  await writeFile(join(workspace, '.zcode', 'config.json'), JSON.stringify({ mcp: { servers: [] } }))
  await writeFile(join(workspace, 'kjdraw-pending.json'), '{}')
  const { child, receipt } = run(workspace)
  assert.equal(child.stdout.includes('TEST_SECRET_NEVER_PRINT'), false)
  assert.equal(receipt.adapters[0].status, 'invalid-json')
  assert.equal(receipt.adapters[1].status, 'invalid-schema')
  assert.equal(receipt.proposalLedger.startupStatus, 'blocked-existing-ledger')
  assert.equal(receipt.proposalLedger.exists, true)
  assert.match(receipt.proposalLedger.note, /repeated MCP startups/u)
})

test('linked official config directory is blocked without reading its contents', async t => {
  const workspace = await fixture(t)
  const real = join(workspace, 'controlled-config-source')
  await mkdir(real)
  await writeFile(join(real, 'mcp.json'), '{TEST_SECRET_NEVER_PRINT}')
  await linkDirectory(real, join(workspace, '.kimi-code'))
  const { child, receipt } = run(workspace)
  assert.equal(receipt.adapters[0].status, 'unsafe-config-parent')
  assert.equal(child.stdout.includes('TEST_SECRET_NEVER_PRINT'), false)
})

test('only explicit host-owned drawing paths are accepted; apply and model-selected paths are unavailable', async t => {
  const workspace = await fixture(t)
  const attempts = [
    invoke(workspace, '../outside.kjd'),
    invoke(workspace, join(workspace, 'fixture.kjd')),
    invoke(workspace, 'missing.kjd'),
    invoke(workspace, 'fixture.kjd', ['--proposals', '../outside.json']),
    invoke(workspace, 'fixture.kjd', ['--proposals', 'fixture.kjd']),
    invoke(workspace, 'fixture.kjd', ['--apply']),
  ]
  for (const child of attempts) {
    assert.equal(child.status, 1)
    assert.equal(child.stdout, '')
    assert.equal(child.stderr.includes(workspace), false)
  }
  await assert.rejects(readFile(join(workspace, 'kjdraw-pending.json')), /ENOENT/u)
})

test('KJDraw smoke receipt reflects real SDK transaction, undo/redo, disk reopen and MCP read, not a model claim', async t => {
  const workspace = await fixture(t)
  const child = spawnSync(process.execPath, [executable, '--smoke-circle', '--workspace', workspace], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stderr, '')
  const receipt = JSON.parse(child.stdout)
  assert.equal(receipt.product, 'KJDraw')
  assert.equal(receipt.fixtureOnly, true)
  assert.equal(receipt.realModelInvoked, false)
  assert.equal(receipt.engineInvoked, true)
  assert.equal(receipt.sdk.entrypoint, 'createKJDrawSDK')
  assert.equal(receipt.sdk.transactionCount, 1)
  assert.equal(receipt.sdk.afterTransaction.radius, 5)
  assert.equal(receipt.sdk.undoRemovedEntity, true)
  assert.equal(receipt.sdk.redoRestoredEntity, true)
  assert.equal(receipt.mcp.tool, 'cad_read_drawing')
  assert.equal(receipt.mcp.toolCalls, 1)
  assert.equal(receipt.mcp.savedEntityCount, 1)
  assert.match(receipt.artifactDirectory, /^kjdraw-smoke-/u)
  const directory = join(workspace, receipt.artifactDirectory)
  const sdk = createKJDrawSDK()
  for (const artifact of receipt.artifacts) {
    const bytes = await readFile(join(directory, artifact.file))
    assert.equal(sha(bytes), artifact.sha256)
    assert.equal(bytes.length, artifact.byteLength)
    const reopened = await sdk.readDocument(bytes, { format: artifact.format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, 1)
    assert.equal(reopened.listEntities()[0].payload.radius, 5)
  }
  assert.equal(sha(await readFile(join(directory, 'smoke-ledger.json'))), receipt.mcp.ledgerSha256)
  const htmlBytes = await readFile(join(directory, receipt.htmlReceipt.file))
  const html = htmlBytes.toString('utf8')
  const publicMark = (await readFile(join(repository, 'docs', 'assets', 'mark.svg'), 'utf8')).trim()
  assert.equal(receipt.htmlReceipt.file, 'receipt.html')
  assert.equal(sha(htmlBytes), receipt.htmlReceipt.sha256)
  assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u)
  assert.equal(html.includes(publicMark), true)
  assert.match(html, /KJDraw engine smoke/u)
  assert.match(html, /cad_read_drawing/u)
  assert.match(html, /Undo \/ redo/u)
  assert.match(html, /Both written to disk and independently reopened/u)
  assert.equal(html.includes(workspace), false)
  assert.equal(html.includes('TEST_SECRET_NEVER_PRINT'), false)
})

test('npm package copy-only fixture executes smoke without repository docs/assets', async t => {
  const workspace = await fixture(t)
  const packageRoot = await mkdtemp(join(repository, 'kjdraw-connect-pack-copy-'))
  t.after(async () => {
    assert.ok(packageRoot.startsWith(join(repository, 'kjdraw-connect-pack-copy-')))
    await rm(packageRoot, { recursive: true, force: true })
  })
  const sourcePackage = join(repository, 'packages', 'kjdraw-sdk')
  await cp(join(sourcePackage, 'package.json'), join(packageRoot, 'package.json'))
  const copiedManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(copiedManifest.bin['kjdraw-connect'], './bin/kjdraw-connect.mjs')
  await cp(join(sourcePackage, 'src'), join(packageRoot, 'src'), { recursive: true })
  await cp(join(sourcePackage, 'bin'), join(packageRoot, 'bin'), { recursive: true })
  await assert.rejects(readFile(join(packageRoot, 'docs', 'assets', 'mark.svg')), /ENOENT/u)
  const child = spawnSync(process.execPath, [join(packageRoot, 'bin', 'kjdraw-connect.mjs'), '--smoke-circle', '--workspace', workspace], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  assert.equal(child.status, 0, child.stderr)
  const receipt = JSON.parse(child.stdout)
  assert.equal(receipt.engineInvoked, true)
  assert.equal(receipt.mcp.savedEntityCount, 1)
  const html = await readFile(join(workspace, receipt.artifactDirectory, receipt.htmlReceipt.file), 'utf8')
  assert.match(html, /KJDraw engine smoke/u)
  assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u)
})
