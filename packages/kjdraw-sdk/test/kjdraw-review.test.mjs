import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../src/sdk.js'
import { reviewLedger } from '../bin/kjdraw-review.mjs'

const mcp = fileURLToPath(new URL('../bin/kjdraw-mcp.mjs', import.meta.url))
const cli = fileURLToPath(new URL('../bin/kjdraw-review.mjs', import.meta.url))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params })

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-host-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ units: 'millimeter', documentId: 'host-review-fixture' })
  const source = Buffer.from(await sdk.writeDocument(document, { format: 'KJD' }))
  await writeFile(join(root, 'source.kjd'), source, { flag: 'wx' })
  const requests = [
    rpc(1, 'initialize', { protocolVersion: '2025-11-25' }),
    rpc(2, 'tools/call', { name: 'cad_propose_circles', arguments: { expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 10, y: 10 }, radius: 5 }] } }),
  ]
  const child = spawnSync(process.execPath, [mcp, '--workspace', root, '--input', 'source.kjd', '--proposals', 'pending.json'], {
    input: `${requests.join('\n')}\n`, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(child.status, 0, child.stderr)
  const responses = child.stdout.trim().split('\n').map(JSON.parse)
  assert.equal(responses[1].result.structuredContent.ok, true, JSON.stringify(responses[1].result.structuredContent))
  const ledger = JSON.parse(await readFile(join(root, 'pending.json'), 'utf8'))
  assert.equal(ledger.source.sha256, digest(source))
  return { root, source, ledger }
}

test('host-only review creates new editable KJD/DXF and evidence without overwriting the MCP source', async t => {
  const { root, source } = await fixture(t)
  const review = await reviewLedger({ workspace: root, ledger: 'pending.json', sequence: 1, candidate: 'candidate.kjd', reviewer: 'fixture-reviewer' }, async () => true)
  assert.equal(review.execution.command, 'CREATEBATCH')
  assert.equal(review.execution.beforeRevision, 0)
  assert.equal(review.execution.afterRevision, 1)
  assert.equal(review.execution.createdEntityCount, 1)
  assert.equal(review.execution.liveUndoRedoVerified, true)
  assert.equal(review.execution.reopenUndoHistory, false)
  assert.equal(review.hostConfirmed, false)
  assert.equal(review.noInputOverwrite, true)
  assert.deepEqual(await readFile(join(root, 'source.kjd')), source)
  const kjd = await createKJDrawSDK().readDocument(await readFile(join(root, 'candidate.kjd')), { format: 'KJD' })
  const dxf = await createKJDrawSDK().readDocument(await readFile(join(root, 'candidate.dxf')), { format: 'DXF' })
  for (const document of [kjd, dxf]) {
    assert.equal(document.validate().valid, true)
    assert.equal(document.listEntities().length, 1)
    assert.equal(document.listEntities()[0].type, 'CIRCLE')
    assert.equal(document.listEntities()[0].payload.radius, 5)
  }
  assert.deepEqual(JSON.parse(await readFile(join(root, 'candidate.review.json'), 'utf8')), review)
  assert.equal((await readdir(root)).filter(name => name.includes('.claim.json')).length, 1)
  await assert.rejects(reviewLedger({ workspace: root, ledger: 'pending.json', sequence: 1, candidate: 'candidate.kjd' }, async () => true), /must not exist yet/u)
  await assert.rejects(reviewLedger({ workspace: root, ledger: 'pending.json', sequence: 1, candidate: 'another-new.kjd' }, async () => true), /already been claimed or consumed/u)
  await assert.rejects(readFile(join(root, 'another-new.kjd')), { code: 'ENOENT' })
  const changedLedger = JSON.parse(await readFile(join(root, 'pending.json'), 'utf8'))
  changedLedger.proposals[0].reviewNote = 'changed without changing the original plan identity'
  await writeFile(join(root, 'pending.json'), JSON.stringify(changedLedger))
  await assert.rejects(reviewLedger({ workspace: root, ledger: 'pending.json', sequence: 1, candidate: 'third-new.kjd' }, async () => true), /already been claimed or consumed/u)
  await assert.rejects(readFile(join(root, 'third-new.kjd')), { code: 'ENOENT' })
})

test('two concurrent reviews of one proposal create only one candidate and one retained claim', async t => {
  const { root, source } = await fixture(t)
  const base = { workspace: root, ledger: 'pending.json', sequence: 1 }
  const results = await Promise.allSettled(['one.kjd', 'two.kjd'].map(candidate =>
    reviewLedger({ ...base, candidate }, async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return true
    })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected' && /already been claimed or consumed/u.test(result.reason.message)).length, 1)
  const files = await readdir(root)
  assert.equal(files.filter(name => name.endsWith('.kjd') && name !== 'source.kjd').length, 1)
  assert.equal(files.filter(name => name.includes('.claim.json')).length, 1)
  assert.deepEqual(await readFile(join(root, 'source.kjd')), source)
})

test('forged preview, changed source bytes, rejected review and non-TTY --approve never create a candidate', async t => {
  const { root, source, ledger } = await fixture(t)
  const options = { workspace: root, ledger: 'pending.json', sequence: 1, candidate: 'denied.kjd' }
  await assert.rejects(reviewLedger(options, async () => false), /Host did not confirm/u)
  await assert.rejects(readFile(join(root, 'denied.kjd')), { code: 'ENOENT' })
  assert.equal((await readdir(root)).filter(name => name.includes('.claim.json')).length, 0)
  const nonInteractive = spawnSync(process.execPath, [cli, '--workspace', root, '--ledger', 'pending.json', '--sequence', '1', '--candidate', 'denied.kjd', '--approve'], { encoding: 'utf8' })
  assert.notEqual(nonInteractive.status, 0)
  assert.match(nonInteractive.stderr, /Interactive host TTY is required/u)
  ledger.proposals[0].result.preview.after[0].payload.radius = 8
  await writeFile(join(root, 'pending.json'), JSON.stringify(ledger))
  await assert.rejects(reviewLedger(options, async () => true), /Native preview disagrees/u)
  ledger.proposals[0].result.preview.after[0].payload.radius = 5
  await writeFile(join(root, 'pending.json'), JSON.stringify(ledger))
  ledger.proposals[0].result.arguments.entities[0].payload.radius = 8
  await writeFile(join(root, 'pending.json'), JSON.stringify(ledger))
  await assert.rejects(reviewLedger(options, async () => true), /Native preview disagrees/u)
  ledger.proposals[0].result.arguments.entities[0].payload.radius = 5
  await writeFile(join(root, 'pending.json'), JSON.stringify(ledger))
  await assert.rejects(reviewLedger({ ...options, candidate: '../escape.kjd' }, async () => true), /project-relative path/u)
  await assert.rejects(reviewLedger(options, async () => {
    await writeFile(join(root, 'source.kjd'), Buffer.concat([source, Buffer.from('\n')]))
    return true
  }), /Source drawing bytes changed/u)
  await writeFile(join(root, 'source.kjd'), source)
  await writeFile(join(root, 'source.kjd'), Buffer.concat([source, Buffer.from('\n')]))
  await assert.rejects(reviewLedger(options, async () => true), /Source drawing bytes changed/u)
  await assert.rejects(readFile(join(root, 'denied.kjd')), { code: 'ENOENT' })
})
