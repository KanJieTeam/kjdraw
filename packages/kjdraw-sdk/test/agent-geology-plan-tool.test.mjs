import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

const sha = value => createHash('sha256').update(value).digest('hex')
const accepted = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }

function intent(patch = {}) {
  return {
    version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'zh-CN',
    drawingId: 'SURVEY-PLAN-TOOL-001', title: '勘探点平面位置图', revision: 'A', scale: 500,
    boundary: [[385000, 3452000], [385140, 3452000], [385140, 3452090], [385000, 3452090]],
    boreholes: [
      { id: 'ZK01', position: [385020, 3452020], collarElevation: 421.35, depth: 30 },
      { id: 'ZK02', position: [385070, 3452035], collarElevation: 420.82, depth: 28.5 },
      { id: 'ZK03', position: [385115, 3452070], collarElevation: 419.96, depth: 32 },
    ],
    sectionLines: [
      { id: 'section-1', holeIds: ['ZK01', 'ZK02', 'ZK03'], label: "1—1′", endpointLabels: ['1', "1′"], markerClearance: [4, 3], endpointTailLengths: [3, 3], endpointLabelPositions: [[385010, 3452010], [385125, 3452080]] },
      { id: 'section-2', holeIds: ['ZK01', 'ZK03'], label: "2—2′", endpointLabels: ['2', "2′"] },
    ],
    coordinateCallouts: [{
      id: 'control-1', point: [385000, 3452000], elbow: [384990, 3451990], landingEnd: [384980, 3451990],
      xLabelPosition: [384981, 3451992], yLabelPosition: [384981, 3451987], precision: 3, textHeight: 1.8,
    }],
    dimensions: [{ id: 'dimension-a', dimensionLinePoint: [385025, 3452004], firstExtensionOrigin: [385010, 3452010], secondExtensionOrigin: [385040, 3452010], textPosition: [385025, 3452004], displayValue: 30, precision: 2, unitSuffix: 'M' }],
    buildingFootprints: [{ id: 'building-a', outline: [[385010, 3452010], [385035, 3452015], [385030, 3452030], [385005, 3452025]] }],
    roadPaths: [{ id: 'road-edge-a', start: [385010, 3452050], segments: [{ kind: 'line', end: [385030, 3452050] }, { kind: 'arc', center: [385030, 3452060], end: [385040, 3452060], clockwise: false }] }],
    northAngleDegrees: -6,
    ...patch,
  }
}

test('geology plan tool is metre-only proposal schema and host approval is one undoable transaction', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const definition = session.definitions.find(tool => tool.name === 'cad_propose_geology_plan')
  assert.equal(definition.effect, 'propose')
  assert.deepEqual(definition.inputSchema.properties.units.enum, ['meter'])
  assert.deepEqual(definition.inputSchema.properties.scale.enum, [50, 100, 200, 500, 1000, 2000])
  assert.equal(definition.inputSchema.properties.boreholes.maxItems, 128)
  assert.equal(definition.inputSchema.properties.sectionLines.items.properties.holeIds.minItems, 2)
  assert.deepEqual(definition.inputSchema.properties.sectionLines.items.required, ['id', 'holeIds', 'label'])
  assert.equal(definition.inputSchema.properties.sectionLines.items.properties.endpointLabels.minItems, 2)
  assert.equal(definition.inputSchema.properties.sectionLines.items.properties.endpointLabels.maxItems, 2)
  assert.equal(definition.inputSchema.properties.sectionLines.items.properties.markerClearance.items.exclusiveMinimum, 0)
  assert.equal(definition.inputSchema.properties.sectionLines.items.properties.endpointTailLengths.items.minimum, 0)
  assert.equal(definition.inputSchema.properties.sectionLines.items.properties.endpointLabelPositions.items.minItems, 2)
  assert.ok(!definition.inputSchema.required.includes('coordinateGrid'))
  assert.equal(definition.inputSchema.properties.coordinateCallouts.maxItems, 64)
  assert.deepEqual(definition.inputSchema.properties.coordinateCallouts.items.required, ['id', 'point', 'elbow', 'landingEnd', 'xLabelPosition', 'yLabelPosition'])
  assert.ok(!definition.inputSchema.required.includes('coordinateCallouts'))
  assert.equal(definition.inputSchema.properties.dimensions.maxItems, 64)
  assert.deepEqual(definition.inputSchema.properties.dimensions.items.required, ['id', 'dimensionLinePoint', 'firstExtensionOrigin', 'secondExtensionOrigin', 'displayValue'])
  assert.deepEqual(definition.inputSchema.properties.dimensions.items.properties.unitSuffix.enum, ['none', 'm', 'M'])
  assert.ok(!definition.inputSchema.required.includes('dimensions'))
  assert.equal(definition.inputSchema.properties.buildingFootprints.maxItems, 128)
  assert.equal(definition.inputSchema.properties.buildingFootprints.items.properties.outline.minItems, 3)
  assert.equal(definition.inputSchema.properties.buildingFootprints.items.properties.outline.maxItems, 65)
  assert.ok(!definition.inputSchema.required.includes('buildingFootprints'))
  assert.equal(definition.inputSchema.properties.roadPaths.maxItems, 128)
  assert.deepEqual(definition.inputSchema.properties.roadPaths.items.required, ['id', 'start', 'segments'])
  assert.deepEqual(definition.inputSchema.properties.roadPaths.items.properties.segments.items.required, ['kind', 'end'])
  assert.ok(!definition.inputSchema.required.includes('roadPaths'))
  const millimeterSdk = createKJDrawSDK(), millimeterDocument = millimeterSdk.createDocument({ units: 'millimeter' })
  assert.equal(new KJAgentToolSession(millimeterSdk, millimeterDocument).definitions.some(tool => tool.name === 'cad_propose_geology_plan'), false)

  const before = document.serialize(), proposal = accepted(await session.call('cad_propose_geology_plan', intent()))
  assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.command, 'CREATEBATCH')
  assert.equal(proposal.engineeringEvidence.skillId, 'geology-plan')
  assert.equal(proposal.engineeringEvidence.boreholeCount, 3)
  assert.equal(proposal.engineeringEvidence.sectionLineCount, 2)
  assert.equal(proposal.engineeringEvidence.gridLineCount, 0)
  assert.equal(proposal.engineeringEvidence.coordinateCalloutCount, 1)
  assert.equal(proposal.engineeringEvidence.coordinateConvention, 'engineering X=northing, Y=easting')
  assert.equal(proposal.engineeringEvidence.alignedDimensionCount, 1)
  assert.equal(proposal.engineeringEvidence.buildingFootprintCount, 1)
  assert.deepEqual(proposal.engineeringEvidence.externalBaseMapDependencies, ['terrain', 'landscaping', 'other-context'])
  assert.equal(proposal.engineeringEvidence.roadPathCount, 1)
  assert.equal(proposal.engineeringEvidence.roadSegmentCount, 2)
  assert.deepEqual(proposal.engineeringEvidence.sectionReferences[0].markerClearance, [4, 3])
  assert.deepEqual(proposal.engineeringEvidence.sectionReferences[0].endpointTailLengths, [3, 3])
  assert.deepEqual(proposal.engineeringEvidence.sectionReferences[0].endpointLabelPositions, [[385010, 3452010], [385125, 3452080]])
  assert.equal(proposal.engineeringEvidence.sectionReferences[0].segmentCount, 4)
  assert.equal(document.serialize(), before)
  assert.equal(document.revision, 0)
  const receipt = accepted(await session.approve(proposal.planId, 'host-reviewer'))
  assert.equal(receipt.beforeRevision, 0)
  assert.equal(receipt.afterRevision, 1)
  assert.equal(document.listEntities().length, proposal.engineeringEvidence.entityCount)
  assert.equal(document.listEntities().filter(entity => entity.payload.semanticRole === 'building-footprint').length, 1)
  assert.equal(document.listEntities().filter(entity => entity.payload.semanticRole === 'road-path-segment').length, 2)
  assert.equal(document.listEntities().filter(entity => entity.payload.semanticRole === 'coordinate-callout-leader').length, 2)
  assert.deepEqual(document.listEntities().filter(entity => entity.payload.semanticRole === 'coordinate-callout-label').map(entity => entity.payload.text), ['X=3452000.000', 'Y=385000.000'])
  assert.deepEqual(document.listEntities().filter(entity => entity.payload.semanticRole === 'site-dimension').map(entity => entity.payload.textOverride), ['30.00M'])
  assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
  await document.undo(); assert.equal(document.listEntities().length, 0)
  await document.redo(); assert.equal(document.listEntities().length, proposal.engineeringEvidence.entityCount)

  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const reopened of [await sdk.readDocument(kjd, { format: 'KJD' }), await sdk.readDocument(dxf, { format: 'DXF' })]) {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  }
  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (python && pythonPath) {
    const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-tool-'))
    try {
      const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py')
      await writeFile(dxfPath, dxf)
      await writeFile(auditPath, 'import ezdxf,json,sys\nd=ezdxf.readfile(sys.argv[1]);a=d.audit();m=d.modelspace();print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"circles":len(m.query("CIRCLE")),"arcs":len(m.query("ARC")),"closed":sum(1 for e in m.query("LWPOLYLINE") if e.closed),"dimensions":len(m.query("DIMENSION")),"dimensionText":[e.dxf.text for e in m.query("DIMENSION")],"coordinateLeaders":sum(1 for e in m.query("LINE") if e.dxf.layer=="COORDINATES"),"coordinateLabels":sum(1 for e in m.query("TEXT") if e.dxf.text.startswith(("X=","Y="))),"viewports":len(d.query("VIEWPORT"))}))\n')
      const result = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } })
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout), { errors: 0, fixes: 0, circles: 3, arcs: 1, closed: 3, dimensions: 1, dimensionText: ['30.00M'], coordinateLeaders: 2, coordinateLabels: 2, viewports: 1 })
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('geology plan tool fails closed before a plan on stale, broken or nonblank requests', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const before = document.serialize()
  for (const invalid of [
    intent({ expectedRevision: 1 }),
    intent({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'missing'], label: 'X—X′' }] }),
    intent({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', endpointTailLengths: [-1, 2] }] }),
    intent({ scale: 333 }),
    intent({ buildingFootprints: [{ id: 'bad', outline: [[385010, 3452010], [385030, 3452030], [385010, 3452030], [385030, 3452010]] }] }),
    intent({ roadPaths: [{ id: 'bad-road', start: [385010, 3452050], segments: [{ kind: 'arc', center: [385020, 3452050], end: [385020, 3452070] }] }] }),
    intent({ coordinateGrid: { origin: [385000, 3452000], spacing: 20 } }),
    intent({ dimensions: [{ id: 'bad-dimension', dimensionLinePoint: [385020, 3452010], firstExtensionOrigin: [385010, 3452010], secondExtensionOrigin: [385030, 3452010], textPosition: [385020, 3452010], displayValue: 20 }] }),
    { ...intent(), surprise: true },
  ]) {
    const result = await session.call('cad_propose_geology_plan', invalid)
    assert.equal(result.ok, false)
    assert.equal(document.serialize(), before)
  }
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [0, 0, 0] } }, { document })
  const existing = document.serialize(), result = await session.call('cad_propose_geology_plan', intent({ expectedRevision: 1 }))
  assert.equal(result.ok, false)
  assert.match(result.error.message, /blank document/u)
  assert.equal(document.serialize(), existing)
})

test('MCP exposes geology plan as proposal-only, writes one private ledger and never edits input KJD', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-mcp-geology-plan-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'pending'))
  const sdk = createKJDrawSDK(), source = await sdk.writeDocument(sdk.createDocument({ units: 'meter' }), { format: 'KJD' })
  await writeFile(join(root, 'blank.kjd'), source)
  const beforeSha = sha(await readFile(join(root, 'blank.kjd')))
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cad_propose_geology_plan', arguments: intent() } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'cad_approve', arguments: { planId: 'forbidden' } } },
  ]
  const mcp = fileURLToPath(new URL('../bin/kjdraw-mcp.mjs', import.meta.url))
  const child = spawnSync(process.execPath, [mcp, '--workspace', root, '--input', 'blank.kjd', '--proposal-dir', 'pending'], {
    input: `${requests.map(request => JSON.stringify(request)).join('\n')}\n`, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(child.status, 0, child.stderr)
  const replies = child.stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(replies.map(reply => reply.id), [1, 2, 3, 4])
  assert.ok(replies[1].result.tools.some(tool => tool.name === 'cad_propose_geology_plan' && tool.annotations.readOnlyHint === false))
  const proposal = accepted(replies[2].result.structuredContent)
  assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.responseKind, 'compact-engineering-proposal@1')
  assert.equal(Object.hasOwn(proposal, 'arguments'), false)
  assert.equal(Object.hasOwn(proposal, 'preview'), false)
  assert.equal(replies[3].error.code, -32602)
  const ledgers = await readdir(join(root, 'pending'))
  assert.equal(ledgers.length, 1)
  const ledger = JSON.parse(await readFile(join(root, 'pending', ledgers[0]), 'utf8'))
  assert.equal(ledger.proposals[0].tool, 'cad_propose_geology_plan')
  assert.equal(ledger.proposals[0].result.planId, proposal.planId)
  assert.equal(ledger.proposals[0].result.arguments.entities.length, proposal.nativeGeometry.entityCount)
  assert.equal(sha(await readFile(join(root, 'blank.kjd'))), beforeSha)
})
