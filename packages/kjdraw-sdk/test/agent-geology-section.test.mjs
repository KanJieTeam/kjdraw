import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'

const sha = value => createHash('sha256').update(value).digest('hex')
function accepted(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
function interval(intervalId, code, name, top, bottom, lithology) {
  return { intervalId, code, name, top, bottom, lithology }
}
function hole(id, station, collarElevation) {
  return { id, station, collarElevation, depth: 16, strata: [
    interval(`${id}-a`, '1', 'Made ground', 0, 3, 'fill'),
    interval(`${id}-b`, '2', 'Silty clay', 3, 9, 'clay'),
    interval(`${id}-c`, '3', 'Medium sand', 9, 16, 'sand'),
  ] }
}
function intent(expectedRevision = 0) {
  const holes = [hole('SYN-01', 0, 105.25), hole('SYN-02', 12, 104.8)]
  return {
    version: '1.0.0', expectedRevision, units: 'millimeter', holes,
    correlations: ['a', 'b', 'c'].map(suffix => ({
      fromHoleId: holes[0].id, toHoleId: holes[1].id,
      fromIntervalId: `${holes[0].id}-${suffix}`, toIntervalId: `${holes[1].id}-${suffix}`,
    })),
    horizontalScaleDenominator: 200, verticalScaleDenominator: 125,
    datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', title: 'Synthetic geological section',
  }
}

test('explicit correlated strata become a review-only A3 section proposal; host approval is one undoable transaction with KJD/DXF reopen', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_section')
  assert.equal(schema.effect, 'propose')
  assert.deepEqual(schema.inputSchema.properties.units.enum, ['millimeter'])
  assert.equal(schema.inputSchema.properties.correlations.minItems, 0)
  assert.deepEqual(schema.inputSchema.properties.manualConnections.items.properties.kind.enum, ['continuity', 'pinchout', 'lens', 'manualBoundary'])
  const before = document.serialize(), proposal = accepted(await session.call('cad_propose_geology_section', intent()))
  assert.equal(proposal.command, 'CREATEBATCH')
  assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.engineeringEvidence.templateId, 'geology-section-engineering')
  assert.ok(proposal.engineeringEvidence.entityCount > 35)
  assert.equal(document.serialize(), before)
  assert.equal(document.revision, 0)
  const receipt = accepted(await session.approve(proposal.planId, 'synthetic-host-reviewer'))
  assert.equal(receipt.command, 'CREATEBATCH')
  assert.equal(receipt.beforeRevision, 0)
  assert.equal(receipt.afterRevision, 1)
  assert.equal(document.listEntities().length, proposal.engineeringEvidence.entityCount)
  assert.equal(document.listEntities({ type: 'HATCH' }).length, 9)
  assert.equal((await session.approve(proposal.planId, 'synthetic-host-reviewer')).ok, false)
  await document.undo()
  assert.equal(document.listEntities().length, 0)
  await document.redo()
  assert.equal(document.listEntities().length, proposal.engineeringEvidence.entityCount)
  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const reopened of [
    await createKJDrawSDK().readDocument(kjd, { format: 'KJD' }),
    await createKJDrawSDK().readDocument(dxf, { format: 'DXF' }),
  ]) {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, proposal.engineeringEvidence.entityCount)
    assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 9)
  }
})

test('manual pinchout and lens boundaries are available through the reviewed Agent tool', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const request = { ...intent(), correlations: [], manualConnections: [
    { fromHoleId: 'SYN-01', toHoleId: 'SYN-02', fromDepth: 3, toDepth: 4, kind: 'pinchout', layerCode: '1' },
    { fromHoleId: 'SYN-01', toHoleId: 'SYN-02', fromDepth: 9, toDepth: 10, kind: 'lens', layerCode: '2' },
  ] }
  const proposal = accepted(await session.call('cad_propose_geology_section', request))
  const boundaries = proposal.arguments.entities.filter(entity => entity.type === 'LINE' && entity.payload.semanticRole === 'source-manual-connection')
  assert.deepEqual(boundaries.map(entity => entity.payload.connectionKind), ['pinchout', 'lens'])
  const receipt = accepted(await session.approve(proposal.planId, 'synthetic-host-reviewer'))
  assert.equal(receipt.afterRevision, 1)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  assert.equal(reopened.listEntities({ type: 'LINE' }).length, document.listEntities({ type: 'LINE' }).length)
})
test('reversed, incompatible, ambiguous or invented correlations fail without a plan or any changed source geometry', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const before = document.serialize()
  const base = intent()
  const reversed = structuredClone(base)
  reversed.correlations[0] = { fromHoleId: 'SYN-02', toHoleId: 'SYN-01', fromIntervalId: 'SYN-02-a', toIntervalId: 'SYN-01-a' }
  const incompatible = structuredClone(base)
  incompatible.holes[1].strata[1].lithology = 'sand'
  const ambiguous = structuredClone(base)
  ambiguous.holes[0].strata[2].code = '2'
  ambiguous.correlations[1] = { fromHoleId: 'SYN-01', toHoleId: 'SYN-02', fromStratumCode: '2', toStratumCode: '2' }
  const invented = structuredClone(base)
  invented.correlations[0].toIntervalId = 'not-a-real-interval'
  const noEvidence = { ...base, correlations: [] }
  const privatePattern = structuredClone(base)
  privatePattern.holes[0].strata[0].patternKey = 'unlicensed-pattern'
  for (const invalid of [reversed, incompatible, ambiguous, invented, noEvidence, privatePattern]) {
    const result = await session.call('cad_propose_geology_section', invalid)
    assert.equal(result.ok, false)
    assert.equal(document.serialize(), before)
  }
  const proposed = accepted(await session.call('cad_propose_geology_section', base))
  assert.equal(accepted(session.reject(proposed.planId, 'synthetic-host-reviewer')).status, 'rejected')
  assert.equal((await session.approve(proposed.planId, 'synthetic-host-reviewer')).ok, false)
  assert.equal(document.serialize(), before)
  const meterSdk = createKJDrawSDK(), meterDocument = meterSdk.createDocument({ units: 'meter' })
  assert.equal(new KJAgentToolSession(meterSdk, meterDocument).definitions.some(tool => tool.name === 'cad_propose_geology_section'), false)
})

test('professional section layout renders only supplied title-block, water, sample and SPT facts', async () => {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'millimeter'}), session=new KJAgentToolSession(sdk,document)
  const request=intent()
  request.locale='zh-CN';request.projectName='黄土场地工程勘察'
  request.documentFacts=[{key:'organization',value:'测试勘察院'},{key:'drawingNumber',value:'PM-01'}]
  request.holes[0].stableWaterDepth=5.2
  request.holes[0].observations=[{kind:'sample',id:'S1',depth:4,displayLabel:'原状样'},{kind:'spt',id:'N1',depth:11,value:18}]
  const proposal=accepted(await session.call('cad_propose_geology_section',request))
  const visible=proposal.arguments.entities.filter(entity=>entity.type==='TEXT').map(entity=>String(entity.payload.text))
  for(const expected of ['黄土场地工程勘察','测试勘察院','PM-01','水位 5.20','原状样','N=18','水平比例尺']) assert.ok(visible.some(value=>value.includes(expected)),expected)
  assert.equal(proposal.engineeringEvidence.parameters.styleRule,'geology-section-layout')
  const undeclared=await session.call('cad_propose_geology_section',{...intent(),documentFacts:[{key:'inventedApproval',value:'not allowed'}]})
  assert.equal(undeclared.ok,false);assert.match(undeclared.error.message,/not declared by the section style/u)
})

test('existing geometry is protected and a dense 24-hole section above proposal budget fails closed', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const holes = Array.from({ length: 24 }, (_, i) => hole(`SYN-${i + 1}`, i, 105))
  const correlations = []
  for (let i = 0; i < holes.length - 1; i++) {
    for (const suffix of ['a', 'b', 'c']) correlations.push({
      fromHoleId: holes[i].id, toHoleId: holes[i + 1].id,
      fromIntervalId: `${holes[i].id}-${suffix}`, toIntervalId: `${holes[i + 1].id}-${suffix}`,
    })
  }
  const dense = { ...intent(), holes, correlations }
  const before = document.serialize()
  const tooLarge = await session.call('cad_propose_geology_section', dense)
  assert.equal(tooLarge.ok, false)
  assert.match(tooLarge.error.message, /bounded Agent proposal budget/u)
  assert.equal(document.serialize(), before)
  const first = accepted(await session.call('cad_propose_geology_section', intent()))
  accepted(await session.approve(first.planId, 'synthetic-host-reviewer'))
  const existing = document.serialize()
  const overwrite = await session.call('cad_propose_geology_section', intent(1))
  assert.equal(overwrite.ok, false)
  assert.match(overwrite.error.message, /blank drawing/u)
  assert.equal(document.serialize(), existing)
})

test('MCP stdio exposes the section tool as proposal-only and writes one ledger without changing its input KJD', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-mcp-section-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'pending'))
  const sdk = createKJDrawSDK(), source = await sdk.writeDocument(sdk.createDocument({ units: 'millimeter' }), { format: 'KJD' })
  await writeFile(join(root, 'blank.kjd'), source)
  const beforeSha = sha(await readFile(join(root, 'blank.kjd')))
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cad_propose_geology_section', arguments: intent() } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'cad_approve', arguments: { planId: 'forbidden' } } },
  ]
  const mcp = fileURLToPath(new URL('../bin/kjdraw-mcp.mjs', import.meta.url))
  const child = spawnSync(process.execPath, [mcp, '--workspace', root, '--input', 'blank.kjd', '--proposal-dir', 'pending'], {
    input: `${requests.map(request => JSON.stringify(request)).join('\n')}\n`, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(child.status, 0, child.stderr)
  const replies = child.stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(replies.map(reply => reply.id), [1, 2, 3, 4])
  assert.ok(replies[1].result.tools.some(tool => tool.name === 'cad_propose_geology_section' && tool.annotations.readOnlyHint === false))
  const proposal = accepted(replies[2].result.structuredContent)
  assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.responseKind, 'compact-engineering-proposal@1')
  assert.equal(Object.hasOwn(proposal, 'arguments'), false)
  assert.equal(Object.hasOwn(proposal, 'preview'), false)
  assert.ok(Buffer.byteLength(JSON.stringify(replies[2].result.structuredContent)) < 2048)
  assert.equal(replies[3].error.code, -32602)
  const ledgers = await readdir(join(root, 'pending'))
  assert.equal(ledgers.length, 1)
  const ledger = JSON.parse(await readFile(join(root, 'pending', ledgers[0]), 'utf8'))
  assert.equal(ledger.proposals.length, 1)
  assert.equal(ledger.proposals[0].tool, 'cad_propose_geology_section')
  assert.equal(ledger.proposals[0].result.planId, proposal.planId)
  assert.equal(ledger.proposals[0].result.arguments.entities.length, proposal.nativeGeometry.entityCount)
  assert.ok(Buffer.byteLength(JSON.stringify(ledger.proposals[0].result)) >
    Buffer.byteLength(JSON.stringify(replies[2].result.structuredContent)) * 8)
  assert.equal(sha(await readFile(join(root, 'blank.kjd'))), beforeSha)
})
