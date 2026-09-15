import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'

function intent(expectedRevision = 0) {
  return {
    version: '1.0.0', expectedRevision, units: 'millimeter', verticalScaleDenominator: 125,
    projectName: 'Synthetic engineering log',
    hole: {
      id: 'TEST-BH-01', collarElevation: 105.25, depth: 16, stableWaterDepth: 5.2,
      strata: [
        { intervalId: 'a', code: '1', name: 'Made ground', top: 0, bottom: 3, lithology: 'fill' },
        { intervalId: 'b', code: '2', name: 'Silty clay', top: 3, bottom: 9, lithology: 'clay' },
        { intervalId: 'c', code: '3', name: 'Medium sand', top: 9, bottom: 16, lithology: 'sand' },
      ],
      observations: [
        { kind: 'sample', id: 'S1', depth: 4.1, displayLabel: 'S1' },
        { kind: 'spt', id: 'N1', depth: 11, value: 19 },
      ],
    },
  }
}

function accepted(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const sha = value => createHash('sha256').update(value).digest('hex')

test('versioned geology facts compile to a host-only CREATEBATCH proposal, then one editable transaction and KJD/DXF reopen', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_column')
  assert.equal(schema.effect, 'propose')
  assert.deepEqual(schema.inputSchema.properties.units.enum, ['millimeter'])
  assert.equal(schema.inputSchema.required.includes('verticalScaleDenominator'), false)
  assert.equal(session.definitions.some(tool => /approve|save|execute/.test(tool.name)), false)
  const before = document.serialize(), proposal = accepted(await session.call('cad_propose_geology_column', intent()))
  assert.equal(proposal.command, 'CREATEBATCH')
  assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.engineeringEvidence.templateId, 'borehole-column-engineering')
  assert.equal(proposal.engineeringEvidence.packId, 'geology.core')
  assert.ok(proposal.engineeringEvidence.entityCount > 35)
  assert.equal(document.serialize(), before)
  assert.equal(document.revision, 0)
  const { verticalScaleDenominator: _ignored, ...automaticIntent } = intent()
  const automatic = accepted(await session.call('cad_propose_geology_column', automaticIntent))
  assert.equal(automatic.engineeringEvidence.parameters.verticalScaleSource, 'style-standard')
  assert.equal(document.revision, 0)
  const receipt = accepted(await session.approve(proposal.planId, 'synthetic-host-reviewer'))
  assert.equal(receipt.command, 'CREATEBATCH')
  assert.equal(receipt.beforeRevision, 0)
  assert.equal(receipt.afterRevision, 1)
  assert.equal(document.listEntities().length, proposal.engineeringEvidence.entityCount)
  assert.equal(document.listEntities({ type: 'HATCH' }).length, 6)
  assert.equal(document.getTable('layers').records.filter(layer => layer.name.startsWith('GEO_')).length, 5)
  assert.equal((await session.approve(proposal.planId, 'synthetic-host-reviewer')).ok, false, 'A plan is never replayed')
  await document.undo()
  assert.equal(document.listEntities().length, 0)
  await document.redo()
  assert.equal(document.listEntities().length, proposal.engineeringEvidence.entityCount)
  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedKjd = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  const reopenedDxf = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  for (const reopened of [reopenedKjd, reopenedDxf]) {
    assert.equal(reopened.listEntities().length, proposal.engineeringEvidence.entityCount)
    assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 6)
    assert.equal(reopened.validate().valid, true)
  }
})

test('MIT synthetic style renders an appendix document fact only when explicitly supplied and preserves atomic roundtrips', async () => {
  const pack = {
    schema: 'kjdraw.knowledge-pack.v1', id: 'synthetic-appendix-header', version: '1.0.0',
    title: 'MIT synthetic appendix header', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-layout', title: 'Original synthetic appendix header grid', license: 'MIT',
      contentHash: sha('synthetic appendix header grid 260x340') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255,
      columns: [20, 40, 60, 82, 100, 145], headerDepth: 56, footerReserve: 30,
      headerGrid: { rows: [
        [{ role: 'projectName', label: 'PROJECT' }, { role: 'holeId', label: 'HOLE' }],
        [{ role: 'documentFact', key: 'appendixNumber', label: 'APPENDIX' }],
      ] } } },
  }
  const input = { ...intent(), documentFacts: [{ key: 'appendixNumber', value: 'APP-A-07' }] }
  const packBefore = JSON.stringify(pack), inputBefore = JSON.stringify(input)
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document, { geologyColumnKnowledge: { pack, sha256: sha(JSON.stringify(pack)) } })
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_column').inputSchema.properties.documentFacts
  assert.equal(schema.maxItems, 8)
  assert.equal(schema.items.additionalProperties, false)
  assert.deepEqual(schema.items.required, ['key', 'value'])

  const missing = await session.call('cad_propose_geology_column', intent())
  assert.equal(missing.ok, false)
  assert.match(missing.error.message, /declared header fact appendixNumber is missing/u)
  assert.equal(document.listEntities().length, 0)
  for (const documentFacts of [
    [{ key: 'appendixNumber', value: 'A' }, { key: 'AppendixNumber', value: 'B' }],
    [{ key: 'appendix-number', value: 'A' }],
    [{ key: 'appendixNumber', value: 'A\nB' }],
    [{ key: 'unrequestedFact', value: 'A' }],
  ]) {
    const rejected = await session.call('cad_propose_geology_column', { ...intent(), documentFacts })
    assert.equal(rejected.ok, false)
  }

  const proposal = accepted(await session.call('cad_propose_geology_column', input))
  assert.equal(proposal.command, 'CREATEBATCH')
  const proposedTexts = proposal.arguments.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.equal(proposedTexts.filter(value => value === 'APP-A-07').length, 1)
  assert.equal(document.listEntities().length, 0)
  accepted(await session.approve(proposal.planId, 'synthetic-host-reviewer'))
  const visibleAppendix = drawing => drawing.listEntities({ type: 'TEXT' }).filter(entity => entity.payload.text === 'APP-A-07').length
  assert.equal(visibleAppendix(document), 1)
  await document.undo()
  assert.equal(document.listEntities().length, 0)
  await document.redo()
  assert.equal(visibleAppendix(document), 1)

  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const [bytes, format] of [[kjd, 'KJD'], [dxf, 'DXF']]) {
    const reopened = await createKJDrawSDK().readDocument(bytes, { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(visibleAppendix(reopened), 1)
  }
  assert.equal(JSON.stringify(pack), packBefore)
  assert.equal(JSON.stringify(input), inputBefore)
})

test('wrong version, unlicensed pattern request, missing engineering facts and host rejection never change the drawing', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const before = document.serialize()
  for (const bad of [
    { ...intent(), version: '2.0.0' },
    { ...intent(), pageHeightMillimeters: 500 },
    { ...intent(), hole: { ...intent().hole, strata: intent().hole.strata.map((layer, index) => index ? layer : { ...layer, patternKey: 'purchased-private-pattern' }) } },
    { ...intent(), hole: { ...intent().hole, strata: intent().hole.strata.slice(0, 2) } },
  ]) assert.equal((await session.call('cad_propose_geology_column', bad)).ok, false)
  assert.equal(document.serialize(), before)
  const plan = accepted(await session.call('cad_propose_geology_column', intent()))
  assert.equal(accepted(session.reject(plan.planId, 'synthetic-host-reviewer')).status, 'rejected')
  assert.equal((await session.approve(plan.planId, 'synthetic-host-reviewer')).ok, false)
  assert.equal(document.serialize(), before)
  const meterSdk = createKJDrawSDK(), meterDrawing = meterSdk.createDocument({ units: 'meter' })
  assert.equal(new KJAgentToolSession(meterSdk, meterDrawing).definitions.some(tool => tool.name === 'cad_propose_geology_column'), false)
})

test('MCP stdio lists and calls geology intent as a pending ledger entry without approving or changing its source KJD', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-mcp-geology-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'pending'))
  const sdk = createKJDrawSDK(), source = await sdk.writeDocument(sdk.createDocument({ units: 'millimeter' }), { format: 'KJD' })
  const inputPath = join(root, 'blank.kjd')
  await writeFile(inputPath, source)
  const sourceSha = sha(await readFile(inputPath))
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cad_propose_geology_column', arguments: intent() } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'cad_approve', arguments: { planId: 'forbidden' } } },
  ]
  const mcp = fileURLToPath(new URL('../bin/kjdraw-mcp.mjs', import.meta.url))
  const launched = spawnSync(process.execPath, [mcp, '--workspace', root, '--input', 'blank.kjd', '--proposal-dir', 'pending'], {
    input: `${messages.map(message => JSON.stringify(message)).join('\n')}\n`, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(launched.status, 0, launched.stderr)
  const replies = launched.stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(replies.map(reply => reply.id), [1, 2, 3, 4])
  assert.ok(replies[1].result.tools.some(tool => tool.name === 'cad_propose_geology_column' && tool.annotations.readOnlyHint === false))
  const proposal = accepted(replies[2].result.structuredContent)
  assert.equal(proposal.command, 'CREATEBATCH')
  assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.product, 'KJDraw')
  assert.equal(proposal.responseKind, 'compact-engineering-proposal@1')
  assert.equal(Object.hasOwn(proposal, 'arguments'), false)
  assert.equal(Object.hasOwn(proposal, 'preview'), false)
  assert.ok(proposal.nativeGeometry.entityCount > 35)
  assert.ok(Buffer.byteLength(JSON.stringify(replies[2].result.structuredContent)) < 2048)
  assert.equal(replies[3].error.code, -32602)
  const ledgers = await readdir(join(root, 'pending'))
  assert.equal(ledgers.length, 1)
  const ledger = JSON.parse(await readFile(join(root, 'pending', ledgers[0]), 'utf8'))
  assert.equal(ledger.proposals.length, 1)
  assert.equal(ledger.proposals[0].tool, 'cad_propose_geology_column')
  assert.equal(ledger.proposals[0].result.planId, proposal.planId)
  assert.equal(ledger.proposals[0].result.arguments.entities.length, proposal.nativeGeometry.entityCount)
  assert.equal(ledger.proposals[0].result.preview.after.length, proposal.nativeGeometry.entityCount)
  assert.ok(Buffer.byteLength(JSON.stringify(ledger.proposals[0].result)) >
    Buffer.byteLength(JSON.stringify(replies[2].result.structuredContent)) * 8,
  'the host keeps the full plan while the model receives less than one eighth of its serialized bytes')
  assert.equal(sha(await readFile(inputPath)), sourceSha)
})
