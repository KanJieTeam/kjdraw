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

test('host-bound section knowledge is reachable through the ordinary proposal tool without model-supplied layout facts', async () => {
  const pack = {
    schema: 'kjdraw.knowledge-pack.v1', id: 'synthetic-host-section-layout', version: '1.0.0', title: 'Synthetic host section layout',
    domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-layout', title: 'Synthetic layout', license: 'MIT', contentHash: sha('synthetic-section-layout') }],
    ontology: { objectKinds: ['section'], relationKinds: [] }, rules: { 'geology-section-layout': {
      paperWidth: 420, paperHeight: 297, outerMargins: { left: 5, right: 5, bottom: 5, top: 5 },
      innerMargins: { left: 12, right: 12, bottom: 12, top: 12 },
      frameStyle: { outer: { primitive: 'closed-polyline', startCorner: 'bottom-left', winding: 'counter-clockwise', constantWidth: 0 }, inner: { primitive: 'closed-polyline', startCorner: 'bottom-left', winding: 'counter-clockwise', constantWidth: 0 } },
      sectionTextStyle: {
        elevationTick: { offset: [-12, -0.5], height: 2, textWidthFactor: 1, horizontalAlignment: 2, verticalAlignment: 0 },
        holeIdentifier: { offset: [0, 10], height: 3, textWidthFactor: 1, horizontalAlignment: 4, verticalAlignment: 0 },
        collarElevation: { offset: [0, 5], height: 3, textWidthFactor: 1, horizontalAlignment: 4, verticalAlignment: 0 },
        intervalBottom: { offset: [2, -1], height: 2.2, textWidthFactor: 1, horizontalAlignment: 0, verticalAlignment: 0, format: 'depth-elevation', precision: 2 },
        station: { offset: [0, 5], height: 3, textWidthFactor: 1, horizontalAlignment: 4, verticalAlignment: 0, mode: 'adjacent-spacing-between-holes', precision: 1 },
        holeDepth: { offset: [0, -12], height: 2, textWidthFactor: 1, horizontalAlignment: 0, verticalAlignment: 0, visibility: 'omitted', precision: 2 },
        stationLabel: { offset: [-8, 4], height: 2.5, textWidthFactor: 1, horizontalAlignment: 0, verticalAlignment: 0, visibility: 'shown' },
      },
      sectionHatchPresentation: {
        boreholeColumn: { patternScale: 0.75, patternAngle: 0.25 }, stratigraphicBand: { patternScale: 1.25, patternAngle: 0 },
      },
      elevationTickSequence: { startElevation: 81, step: 2, minimumElevation: 81, maximumElevation: 89 },
      sourceBackedBands: [{ sourceHoleId: 'SYN-01', sourceIntervalId: 'SYN-01-a', points: [
        [0, 102.25], [12, 101.8], [12, 104.8], [0, 105.25],
      ] }],
      boreholeProfileStyle: { primitive: 'centerline', guideEndOffset: -2, bottomTickOffsets: [0, 1.5],
        collarBarHalfWidth: 9, collarBarYOffset: 1.5 },
      elevationScaleRailStyle: { primitive: 'solid-cell-per-tick', xOffsets: [-12, -10], tickCellYOffset: [-4, 0] },
      sourceBackedPatternSymbols: [{ primitive: 'triangle-lines', points: [[2, 90], [2.4, 90], [2.2, 90.25]] }],
      footerFrameStyle: { left: 12, right: 408, bottom: 12, top: 22, guideY: 12, primitive: 'line-segments', cellMode: 'none' },
      headingTextStyle: { title: { anchorX: 210, height: 6, textWidthFactor: 1, horizontalAlignment: 4, verticalAlignment: 0 }, scale: { anchorX: 210, height: 3, textWidthFactor: 1, horizontalAlignment: 4, verticalAlignment: 0 } },
      sectionReferenceStyle: { start: { offset: [150, 268], height: 4, textWidthFactor: 1, horizontalAlignment: 'right', verticalAlignment: 'baseline' }, end: { offset: [270, 268], height: 4, textWidthFactor: 1, horizontalAlignment: 'left', verticalAlignment: 'baseline' } },
      observationSymbolStyle: { sample: { centerOffset: [-4, 0], radius: 0.7, fill: 'solid' }, spt: { topRightOffset: [-7, 0], width: 10, height: 3, labelPlacement: { offset: [-12, -1.5], height: 2, textWidthFactor: 1, horizontalAlignment: 'center', verticalAlignment: 'baseline' } } },
      plotLeft: 30, plotRight: 390, plotBottom: 35, plotTop: 245, titleY: 275, scaleY: 262, footerHeight: 10, boreholeWidth: 3, elevationTickStep: 2,
      footerGrid: [{ start: 12, key: 'projectName', label: 'Project' }, { start: 140, key: 'organization', label: 'Organization' }, { start: 260, key: 'drawingNumber', label: 'Drawing' }],
    } },
  }
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const digest = sha(JSON.stringify(pack)), session = new KJAgentToolSession(sdk, document, { geologySectionKnowledge: { pack, sha256: digest } })
  const request = intent()
  request.sectionReference = { start: 'A', end: "A'" }
  request.holes[0].observations = [{ kind: 'sample', id: 'S1', depth: 4 }, { kind: 'spt', id: 'N1', depth: 8, value: 12 }]
  const proposal = accepted(await session.call('cad_propose_geology_section', request))
  assert.deepEqual(session.geologySectionKnowledge, { id: pack.id, version: pack.version, sha256: digest })
  assert.deepEqual(proposal.engineeringEvidence.knowledgePack, { id: pack.id, version: pack.version, sha256: digest })
  assert.equal(proposal.arguments.entities.some(entity => entity.type === 'TEXT' && entity.payload.text === '3.00-102.25'), true)
  const roleHatches = proposal.arguments.entities.filter(entity => entity.type === 'HATCH' && entity.payload.solid !== true)
  assert.equal(roleHatches.some(entity => entity.payload.patternScale === 0.75 && entity.payload.patternAngle === 0.25), true)
  assert.equal(roleHatches.some(entity => entity.payload.patternScale === 1.25 && entity.payload.patternAngle === 0), true)
  assert.equal(proposal.engineeringEvidence.parameters.elevationTickCount, 5)
  assert.equal(proposal.engineeringEvidence.parameters.sourceBackedBandCount, 1)
  assert.equal(proposal.engineeringEvidence.parameters.boreholeProfileElementCount, 8)
  assert.equal(proposal.engineeringEvidence.parameters.elevationScaleSolidCount, 5)
  assert.equal(proposal.engineeringEvidence.parameters.sourceBackedPatternSymbolCount, 1)
  assert.equal(proposal.engineeringEvidence.parameters.sourceBackedPatternEntityCount, 3)
  assert.equal(proposal.arguments.entities.filter(entity => entity.type === 'SOLID').length, 5)
  assert.equal(proposal.arguments.entities.filter(entity => entity.type === 'TEXT' &&
    ['81', '83', '85', '87', '89'].includes(entity.payload.text)).length, 5)
  assert.equal(roleHatches.length, 10)
  const footerEdges = [
    [[12, 12, 0], [408, 12, 0]], [[408, 12, 0], [408, 22, 0]],
    [[408, 22, 0], [12, 22, 0]], [[12, 22, 0], [12, 12, 0]],
  ]
  assert.equal(proposal.arguments.entities.filter(entity => entity.type === 'LINE' && footerEdges.some(([start, end]) =>
    JSON.stringify(entity.payload.start) === JSON.stringify(start) && JSON.stringify(entity.payload.end) === JSON.stringify(end))).length, 4)
  assert.equal(proposal.arguments.entities.filter(entity => entity.type === 'CIRCLE').length, 1)
  assert.equal(proposal.arguments.entities.filter(entity => entity.type === 'LWPOLYLINE' && !entity.payload.closed && entity.payload.vertices.length === 2 &&
    entity.payload.vertices[0][0] === entity.payload.vertices[1][0]).length, 2)
  assert.equal(proposal.arguments.entities.filter(entity => entity.type === 'TEXT' && [request.sectionReference.start, request.sectionReference.end].includes(entity.payload.text)).length, 2)
  assert.equal(Object.hasOwn(session.definitions.find(tool => tool.name === 'cad_propose_geology_section').inputSchema.properties, 'sectionStylePack'), false)
})

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
