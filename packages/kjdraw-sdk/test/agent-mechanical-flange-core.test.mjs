import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

import { buildAgentMechanicalFlangeCore, createKJDrawSDK, KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK } from '../src/index.js'

const input = expectedRevision => ({
  version: '1.0.0', expectedRevision, units: 'millimeter', drawingId: 'PUBLIC-TEST-FLANGE',
  endView: { center: [90, 150], ringRadii: [12, 28, 40], squareHoles: { pitch: 60, radius: 4 }, outlineSegments: [
    { kind: 'line', startOffset: [-45, -30], endOffset: [-45, 30] },
    { kind: 'arc', centerOffset: [0, 0], radius: 45, startAngle: 0, endAngle: Math.PI / 2 },
    { kind: 'circle', centerOffset: [0, 18], radius: 2 },
  ], cuttingPlaneMarks: [{ anchorOffset: [0, 48], stemVector: [0, -3], tickVector: [6, 0], arrowhead: { length: 3.5, width: 1.12 } }] },
  sideViewAxis: { xRange: [190, 280], axisDirection: 'reverse', symmetricProfiles: [{
    vertices: [{ station: 190, radius: 25 }, { station: 210, radius: 25 }, { station: 210, radius: 40 },
      { station: 250, radius: 40 }, { station: 255, radius: 30 }, { station: 280, radius: 30 }],
    endCaps: 'both',
  }], outlineSegments: [
    { kind: 'line', start: { station: 200, offset: 45 }, end: { station: 270, offset: 38 } },
    { kind: 'arc', center: { station: 220, offset: -30 }, radius: 5, startAngle: 0, endAngle: Math.PI },
    { kind: 'circle', center: { station: 205, offset: 32 }, radius: 3 },
  ] },
  dimensions: [
    { kind: 'rotated', definitionPoints: [[90, 92], [50, 110], [130, 110]], textPosition: [90, 92], rotation: 0 },
    { kind: 'diameter', definitionPoints: [[78, 150], [102, 150]], textPosition: [125, 165], textOverride: '4X DIA <>' },
  ],
  leaders: [{ vertices: [[80, 100], [70, 90], [65, 90]], arrowEnabled: true, pathType: 0, annotationType: 3, textHeight: 7, textWidth: 14 }],
  sheet: { origin: [0, 0], size: [400, 300], inset: 8,
    titleGrid: { origin: [240, 8], size: [152, 35], columns: [0, 20, 60],
      partialColumns: [{ offset: 100, height: 18 }], rows: [{ offset: 12 }, { offset: 24, breaks: [80] }],
      horizontalSegments: [{ offset: 18, start: 100, end: 152 }],
      verticalSegments: [{ offset: 120, start: 12, end: 24 }],
      diagonalHeader: { width: 20, drop: 6 } },
    notes: [
      { kind: 'single-line', text: 'PART ID', position: [250, 25], height: 3 },
      { kind: 'multiline', text: 'REMOVE BURRS\nBREAK SHARP EDGES', position: [20, 40], height: 2.5, width: 80, attachmentPoint: 8 },
    ],
  },
})

test('flange knowledge pack and compiler are source-neutral and deterministic', () => {
  const pack = KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK
  assert.equal(pack.id, 'mechanical-flange-core')
  assert.equal(JSON.stringify(pack).includes('rawDrawing'), false)
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  const a = buildAgentMechanicalFlangeCore(document, input(document.revision))
  const b = buildAgentMechanicalFlangeCore(document, input(document.revision))
  assert.deepEqual(a, b)
  assert.equal(a.evidence.entityCount, 53)
  assert.equal(a.commandArgs.entities.filter(e => e.type === 'CIRCLE').length, 9)
  assert.equal(a.commandArgs.entities.filter(e => e.type === 'LINE').length, 36)
  assert.equal(a.commandArgs.entities.filter(e => e.type === 'ARC').length, 2)
  assert.equal(a.commandArgs.entities.filter(e => e.type === 'SOLID').length, 1)
  assert.equal(a.commandArgs.entities.filter(e => e.type === 'LEADER').length, 1)
  assert.equal(a.commandArgs.entities.find(e => e.type === 'LEADER').payload.textHeight, 7)
  assert.equal(a.commandArgs.entities.find(e => e.type === 'LEADER').payload.textWidth, 14)
  assert.equal(a.evidence.parameters.outlineSegmentCount, 3)
  assert.equal(a.evidence.parameters.cuttingPlaneMarkCount, 1)
  assert.equal(a.evidence.parameters.symmetricProfileCount, 1)
  assert.equal(a.evidence.parameters.sideOutlineSegmentCount, 3)
  assert.equal(a.evidence.parameters.noteCount, 2)
  assert.equal(a.evidence.parameters.dimensionCount, 2)
  assert.equal(a.evidence.parameters.leaderCount, 1)
  assert.equal(a.commandArgs.entities.filter(e => e.type === 'TEXT').length, 1)
  assert.equal(a.commandArgs.entities.filter(e => e.type === 'MTEXT').length, 1)
  assert.equal(a.commandArgs.entities.find(e => e.type === 'MTEXT').payload.attachmentPoint, 8)
})

test('complete entity draw order preserves overlap stacking through KJD and DXF', async () => {
  const sdk = createKJDrawSDK(), baselineDocument = sdk.createDocument({ units: 'millimeter' })
  const baseline = buildAgentMechanicalFlangeCore(baselineDocument, input(baselineDocument.revision))
  const order = [...baseline.commandArgs.entities.keys()].reverse()
  const document = sdk.createDocument({ units: 'millimeter' })
  const proposal = buildAgentMechanicalFlangeCore(document, { ...input(document.revision), entityDrawOrder: order })
  const fingerprints = entities => entities.map(entity => JSON.stringify([entity.type, entity.payload]))
  assert.deepEqual(fingerprints(proposal.commandArgs.entities), fingerprints(baseline.commandArgs.entities).reverse())
  assert.deepEqual(proposal.commandArgs.entities.map(entity => entity.options.id), baseline.commandArgs.entities.map(entity => entity.options.id))
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  assert.deepEqual(document.listEntities().map(entity => entity.id), proposal.commandArgs.entities.map(entity => entity.options.id))
  const kjd = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  const dxf = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.deepEqual(kjd.listEntities().map(entity => entity.id), proposal.commandArgs.entities.map(entity => entity.options.id))
  assert.deepEqual(dxf.listEntities().filter(entity => entity.ownerId === dxf.snapshot().spaces.modelSpaceId).map(entity => entity.type), proposal.commandArgs.entities.map(entity => entity.type))
  assert.throws(() => buildAgentMechanicalFlangeCore(baselineDocument, { ...input(0), entityDrawOrder: [0] }), /complete entity permutation/u)
  const duplicate = [...order]; duplicate[0] = duplicate[1]
  assert.throws(() => buildAgentMechanicalFlangeCore(baselineDocument, { ...input(0), entityDrawOrder: duplicate }), /unique indexes/u)
  const outOfRange = [...order]; outOfRange[0] = order.length
  assert.throws(() => buildAgentMechanicalFlangeCore(baselineDocument, { ...input(0), entityDrawOrder: outOfRange }), /complete entity permutation/u)
})

test('sheet-note attachment points are bounded to multiline MTEXT', () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  const base = input(document.revision)
  const note = { text: 'ALIGN', position: [20, 40], height: 2.5 }
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...base, sheet: { ...base.sheet, notes: [{ ...note, kind: 'single-line', attachmentPoint: 5 }] } }), /attachmentPoint is only valid/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...base, sheet: { ...base.sheet, notes: [{ ...note, kind: 'multiline', attachmentPoint: 5.5 }] } }), /attachmentPoint is only valid/u)
})

test('outer frame offsets preserve measured borders without shifting inset geometry', () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' }), base = input(document.revision)
  const proposal = buildAgentMechanicalFlangeCore(document, { ...base, sheet: { ...base.sheet, outerFrameOffset: [0.125, -0.25] } })
  const lines = proposal.commandArgs.entities.filter(entity => entity.type === 'LINE')
  const hasLine = (start, end) => lines.some(entity => JSON.stringify(entity.payload.start) === JSON.stringify([...start, 0]) && JSON.stringify(entity.payload.end) === JSON.stringify([...end, 0]))
  assert.equal(hasLine([0.125, -0.25], [400.125, -0.25]), true)
  assert.equal(hasLine([8, 8], [392, 8]), true)
  assert.equal(hasLine([8.125, 7.75], [392.125, 7.75]), false)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...base, sheet: { ...base.sheet, outerFrameOffset: [1.001, 0] } }), /within one drawing unit/u)
})

test('symmetric profile line directions preserve independent dash phases', () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' }), base = input(0)
  const proposal = buildAgentMechanicalFlangeCore(document, { ...base, sideViewAxis: { xRange: [190, 280], symmetricProfiles: [{
    vertices: [{ station: 190, radius: 10 }, { station: 200, radius: 12 }, { station: 210, radius: 8 }],
    segmentDirections: [{ upper: 'reverse' }, { lower: 'reverse' }], endCaps: 'both', startCapDirection: 'reverse', endCapDirection: 'reverse',
  }] } })
  const lines = proposal.commandArgs.entities.filter(entity => entity.type === 'LINE').map(entity => [entity.payload.start, entity.payload.end])
  for (const expected of [
    [[200, 162, 0], [190, 160, 0]], [[190, 140, 0], [200, 138, 0]],
    [[200, 162, 0], [210, 158, 0]], [[210, 142, 0], [200, 138, 0]],
    [[190, 160, 0], [190, 140, 0]], [[210, 158, 0], [210, 142, 0]],
  ]) assert.ok(lines.some(value => JSON.stringify(value) === JSON.stringify(expected)), JSON.stringify(expected))
})

test('independent projection axes support vertical stations and intentionally hidden axes', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), base = input(0)
  const sideViewAxis = { stationRange: [30, 70], orientation: 'vertical', axisCoordinate: 320, axisDirection: 'reverse', symmetricProfiles: [{
    vertices: [{ station: 30, radius: 10 }, { station: 40, radius: 12 }], endCaps: 'both',
  }], outlineSegments: [{ kind: 'line', start: { station: 50, offset: 5 }, end: { station: 60, offset: 6 } }], sectionHatches: [{ solid: true, edges: [
    { kind: 'line', start: { station: 45, offset: 2 }, end: { station: 45, offset: 6 } },
    { kind: 'line', start: { station: 45, offset: 6 }, end: { station: 55, offset: 6 } },
    { kind: 'line', start: { station: 55, offset: 6 }, end: { station: 55, offset: 2 } },
    { kind: 'line', start: { station: 55, offset: 2 }, end: { station: 45, offset: 2 } },
  ] }] }
  const proposal = buildAgentMechanicalFlangeCore(document, { ...base, sideViewAxis })
  const lines = proposal.commandArgs.entities.filter(entity => entity.type === 'LINE')
  const hasLine = (start, end) => lines.some(entity => JSON.stringify([entity.payload.start, entity.payload.end]) === JSON.stringify([[...start, 0], [...end, 0]]))
  assert.equal(hasLine([320, 70], [320, 30]), true)
  assert.equal(hasLine([330, 30], [332, 40]), true)
  assert.equal(hasLine([310, 30], [308, 40]), true)
  assert.equal(hasLine([310, 30], [330, 30]), true)
  assert.equal(hasLine([325, 50], [326, 60]), true)
  const hatch = proposal.commandArgs.entities.find(entity => entity.type === 'HATCH')
  assert.deepEqual(hatch.payload.boundaryLoops[0].edges[0], { type: 'LINE', start: [322, 45, 0], end: [326, 45, 0] })
  assert.equal(proposal.evidence.parameters.sideViewOrientation, 'vertical')
  assert.equal(proposal.evidence.parameters.sideViewAxisVisible, true)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const kjd = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  const dxf = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.equal(kjd.listEntities({ type: 'HATCH' }).length, 1)
  assert.equal(dxf.listEntities({ type: 'HATCH' }).length, 1)
  const hidden = buildAgentMechanicalFlangeCore(sdk.createDocument({ units: 'millimeter' }), { ...base, sideViewAxis: { ...sideViewAxis, axisVisible: false } })
  assert.equal(hidden.evidence.parameters.sideViewAxisVisible, false)
  assert.equal(hidden.commandArgs.entities.filter(entity => entity.type === 'LINE').some(entity => JSON.stringify([entity.payload.start, entity.payload.end]) === JSON.stringify([[320, 70, 0], [320, 30, 0]])), false)
  assert.throws(() => buildAgentMechanicalFlangeCore(sdk.createDocument({ units: 'millimeter' }), { ...base, sideViewAxis: { ...sideViewAxis, xRange: [30, 70] } }), /exactly one/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(sdk.createDocument({ units: 'millimeter' }), { ...base, sideViewAxis: { ...sideViewAxis, stationRange: undefined } }), /exactly one/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(sdk.createDocument({ units: 'millimeter' }), { ...base, sideViewAxis: { ...sideViewAxis, orientation: 'diagonal' } }), /orientation is invalid/u)
})

test('all ring, hole, projection-axis and grid positions respond to parameters', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const proposal = buildAgentMechanicalFlangeCore(document, input(document.revision))
  const entities = proposal.commandArgs.entities
  const circles = entities.filter(e => e.type === 'CIRCLE').map(e => e.payload)
  assert.deepEqual(circles.slice(0, 3).map(e => e.radius), [12, 28, 40])
  assert.deepEqual(circles.slice(3, 7).map(e => e.center), [[60, 120, 0], [60, 180, 0], [120, 120, 0], [120, 180, 0]])
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[280,150,0]' && JSON.stringify(e.payload.end) === '[190,150,0]'))
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[190,175,0]' && JSON.stringify(e.payload.end) === '[210,175,0]'))
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[190,125,0]' && JSON.stringify(e.payload.end) === '[210,125,0]'))
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[190,125,0]' && JSON.stringify(e.payload.end) === '[190,175,0]'))
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[340,26,0]' && JSON.stringify(e.payload.end) === '[392,26,0]'))
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[360,20,0]' && JSON.stringify(e.payload.end) === '[360,32,0]'))
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  assert.equal(document.listEntities().length, 53)
  const kjd = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  const dxfText = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const dxf = await sdk.readDocument(dxfText, { format: 'DXF' })
  assert.equal(kjd.listEntities().length, 53)
  assert.equal(dxf.listEntities().filter(e => e.type === 'CIRCLE').length, 9)
  assert.equal(dxf.listEntities().filter(e => e.type === 'DIMENSION').length, 2)
  assert.equal(dxf.listEntities({ type: 'LEADER' })[0].payload.textHeight, 7)
  assert.equal(dxf.listEntities({ type: 'LEADER' })[0].payload.textWidth, 14)
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); m=d.modelspace(); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"circles":len(m.query("CIRCLE")),"arcs":len(m.query("ARC")),"lines":len(m.query("LINE")),"solids":len(m.query("SOLID")),"leaders":len(m.query("LEADER")),"dimensions":len(m.query("DIMENSION"))}))'],
  dxfText, { encoding: 'utf8', windowsHide: true, env: { ...process.env,
    PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(independent.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(independent.stderr || independent.error?.message)
    t.diagnostic('official ezdxf unavailable; independent check skipped')
  } else {
    assert.equal(independent.status, 0, independent.stderr)
    assert.deepEqual(JSON.parse(independent.stdout), { errors: 0, fixes: 0, circles: 9, arcs: 2, lines: 36, solids: 1, leaders: 1, dimensions: 2 })
  }
})

test('end-view hole patterns support arbitrary bounded polar arrays without a legacy square array',()=>{
  const document=createKJDrawSDK().createDocument({units:'millimeter'}),source=input(document.revision)
  const proposal=buildAgentMechanicalFlangeCore(document,{...source,endView:{...source.endView,squareHoles:undefined,holePatterns:[{count:8,pitchRadius:30,holeRadius:2,startAngle:Math.PI/8}]}})
  const holes=proposal.commandArgs.entities.filter(entity=>entity.type==='CIRCLE'&&entity.payload.radius===2&&Math.abs(Math.hypot(entity.payload.center[0]-90,entity.payload.center[1]-150)-30)<1e-9)
  assert.equal(holes.length,8);assert.equal(proposal.evidence.parameters.holePatternCount,1);assert.equal(proposal.evidence.parameters.holeCount,8)
  for(let index=0;index<holes.length;index++){
    const angle=Math.PI/8+index*Math.PI/4,center=holes[index].payload.center
    assert.ok(Math.abs(center[0]-(90+Math.cos(angle)*30))<1e-9);assert.ok(Math.abs(center[1]-(150+Math.sin(angle)*30))<1e-9)
  }
  const noInset=buildAgentMechanicalFlangeCore(document,{...source,sheet:{...source.sheet,inset:0},endView:{...source.endView,squareHoles:undefined,holePatterns:[{count:8,pitchRadius:30,holeRadius:2,startAngle:Math.PI/8}]}})
  assert.equal(noInset.commandArgs.entities.length,proposal.commandArgs.entities.length-4)
  assert.throws(()=>buildAgentMechanicalFlangeCore(document,{...source,endView:{...source.endView,squareHoles:undefined,holePatterns:[{count:8.5,pitchRadius:30,holeRadius:2}]}}),/count must be an integer/u)
  assert.throws(()=>buildAgentMechanicalFlangeCore(document,{...source,endView:{...source.endView,squareHoles:undefined,holePatterns:[{count:4,pitchRadius:2,holeRadius:2}]}}),/must exceed/u)
})

test('single-ring end views remain native and bounded across KJD and DXF', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), source = input(document.revision)
  const proposal = buildAgentMechanicalFlangeCore(document, { ...source, endView: { ...source.endView, ringRadii: [40] } })
  assert.equal(proposal.evidence.parameters.ringCount, 1)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const centeredRings = drawing => drawing.listEntities({ type: 'CIRCLE' }).filter(entity =>
    Math.abs(entity.payload.center[0] - 90) < 1e-9 && Math.abs(entity.payload.center[1] - 150) < 1e-9)
  assert.equal(centeredRings(document).length, 1)
  const kjd = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  const dxfText = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const dxf = await sdk.readDocument(dxfText, { format: 'DXF' })
  assert.equal(centeredRings(kjd).length, 1)
  assert.equal(centeredRings(dxf).length, 1)
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); m=d.modelspace(); c=[e for e in m.query("CIRCLE") if abs(e.dxf.center.x-90)<1e-9 and abs(e.dxf.center.y-150)<1e-9]; print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"centeredRings":len(c)}))'],
  dxfText, { encoding: 'utf8', windowsHide: true, env: { ...process.env,
    PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(independent.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(independent.stderr || independent.error?.message)
    t.diagnostic('official ezdxf unavailable; independent check skipped')
  } else {
    assert.equal(independent.status, 0, independent.stderr)
    assert.deepEqual(JSON.parse(independent.stdout), { errors: 0, fixes: 0, centeredRings: 1 })
  }
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...source, expectedRevision: document.revision,
    endView: { ...source.endView, ringRadii: [] } }), /requires at least one radius/u)
})

test('flange compiler rejects unsupported source injection and impossible geometry', () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), rawDrawing: 'private' }), /unsupported field/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, ringRadii: [20, 12] } }), /increase strictly/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, squareHoles: { pitch: 6, radius: 4 } } }), /pitch must exceed/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, outlineSegments: [{ kind: 'line', startOffset: [0, 0], endOffset: [0, 0] }] } }), /zero length/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, outlineSegments: [{ kind: 'arc', centerOffset: [0, 0], radius: 10, startAngle: 1, endAngle: 1 }] } }), /sweep must not be zero/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, cuttingPlaneMarks: [{ anchorOffset: [0, 50], stemVector: [0, 0], tickVector: [5, 0] }] } }), /vectors must not have zero length/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), expectedRevision: 1 }), /expectedRevision/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sideViewAxis: { ...input(0).sideViewAxis, axisDirection: 'sideways' } }), /axisDirection is invalid/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sideViewAxis: { ...input(0).sideViewAxis, symmetricProfiles: [{ vertices: [{ station: 190, radius: 10 }, { station: 200, radius: 10 }], segmentDirections: [] }] } }), /segmentDirections must match/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sideViewAxis: { ...input(0).sideViewAxis, symmetricProfiles: [{ vertices: [{ station: 190, radius: 10 }, { station: 200, radius: 10 }], segmentDirections: [{ upper: 'sideways' }] }] } }), /segmentDirections.*upper is invalid/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sideViewAxis: { xRange: [190, 280], symmetricProfiles: [{ vertices: [{ station: 210, radius: 10 }, { station: 200, radius: 10 }] }] } }), /must not decrease/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sideViewAxis: { xRange: [190, 280], symmetricProfiles: [{ vertices: [{ station: 200, radius: 10 }, { station: 200, radius: 10 }] }] } }), /zero-length/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sideViewAxis: { ...input(0).sideViewAxis, outlineSegments: [{ kind: 'line', start: { station: 180, offset: 0 }, end: { station: 200, offset: 0 } }] } }), /must be finite/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sheet: { ...input(0).sheet, notes: [{ kind: 'single-line', text: 'OFF SHEET', position: [500, 10], height: 3 }] } }), /position must lie on the sheet/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sheet: { ...input(0).sheet, notes: [{ kind: 'single-line', text: 'NO WIDTH', position: [20, 20], height: 3, width: 10 }] } }), /only valid for multiline/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), dimensions: [{ kind: 'diameter', definitionPoints: [[1, 1], [2, 2], [3, 3]] }] }), /must contain 2 points/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), dimensions: [{ kind: 'radius', definitionPoints: [[1, 1], [1, 1]] }] }), /projectable native dimension/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sheet: { ...input(0).sheet, titleGrid: { ...input(0).sheet.titleGrid, origin: [0, 0] } } }), /inside the inset frame/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sheet: { ...input(0).sheet, titleGrid: { ...input(0).sheet.titleGrid, horizontalSegments: [{ offset: 10, start: 20, end: 10 }] } } }), /start must be less than end/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sheet: { ...input(0).sheet, titleGrid: { ...input(0).sheet.titleGrid, verticalSegments: [{ offset: 200, start: 0, end: 10 }] } } }), /must be finite/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sheet: { ...input(0).sheet, outerFrameSides: ['left', 'left'] } }), /unique frame sides/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), styleProfile: { geometry: { color: 2.5 } } }), /integer ACI/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), styleProfile: { center: { linetypePattern: [1, 2] } } }), /linetypePattern is invalid/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), auxiliaryLines: [{ start: [1, 1], end: [2, 2], role: 'unknown' }] }), /role is invalid/u)
})

test('source-relative cut faces compile solid, shorthand and multi-family native hatches', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const face = { lineAngle: Math.PI / 4, lineSpacing: 3.175, edges: [
    { kind: 'line', start: { station: 200, offset: 10 }, end: { station: 220, offset: 10 } },
    { kind: 'arc', center: { station: 220, offset: 5 }, radius: 5, startAngle: Math.PI / 2, endAngle: -Math.PI / 2, counterClockwise: false },
    { kind: 'line', start: { station: 220, offset: 0 }, end: { station: 200, offset: 0 } },
    { kind: 'line', start: { station: 200, offset: 0 }, end: { station: 200, offset: 10 } },
  ] }
  const rectangle = (start, end) => [
    { kind: 'line', start: { station: start, offset: 10 }, end: { station: end, offset: 10 } },
    { kind: 'line', start: { station: end, offset: 10 }, end: { station: end, offset: 0 } },
    { kind: 'line', start: { station: end, offset: 0 }, end: { station: start, offset: 0 } },
    { kind: 'line', start: { station: start, offset: 0 }, end: { station: start, offset: 10 } },
  ]
  const solidFace = { solid: true, edges: rectangle(230, 240) }
  const doubleFace = { patternName: 'ANSI32', patternLines: [
    { angle: Math.PI / 4, base: [0, 0], offset: [-6.73519431372059, 6.73519431372059] },
    { angle: Math.PI / 4, base: [4.49012954248039, 0], offset: [-6.73519431372059, 6.73519431372059] },
  ], edges: rectangle(250, 270) }
  const absoluteFace = { solid: true, edges: [
    { kind: 'line', start: [20, 80], end: [30, 80] }, { kind: 'line', start: [30, 80], end: [30, 70] },
    { kind: 'line', start: [30, 70], end: [20, 70] }, { kind: 'line', start: [20, 70], end: [20, 80] },
  ] }
  const source = { ...input(document.revision), auxiliaryHatches: [absoluteFace], sideViewAxis: { ...input(document.revision).sideViewAxis, sectionHatches: [face, solidFace, doubleFace] } }
  const proposal = buildAgentMechanicalFlangeCore(document, source), hatches = proposal.commandArgs.entities.filter(entity => entity.type === 'HATCH')
  assert.equal(proposal.evidence.parameters.sectionHatchCount, 3)
  assert.equal(proposal.evidence.parameters.auxiliaryHatchCount, 1)
  assert.equal(proposal.evidence.entityCount, 57)
  assert.deepEqual(hatches[0].payload.boundaryLoops[0].edges[0], { type: 'LINE', start: [200, 160, 0], end: [220, 160, 0] })
  assert.deepEqual(hatches[0].payload.boundaryLoops[0].edges[1].center, [220, 155, 0])
  assert.ok(Math.abs(hatches[0].payload.patternLines[0].offset[0] + 3.175 / Math.sqrt(2)) < 1e-12)
  assert.deepEqual([hatches[1].payload.patternName, hatches[1].payload.solid, hatches[1].payload.patternLines], ['SOLID', true, []])
  assert.deepEqual([hatches[2].payload.patternName, hatches[2].payload.solid, hatches[2].payload.patternLines.length], ['ANSI32', false, 2])
  assert.deepEqual(hatches[3].payload.boundaryLoops[0].edges[0], { type: 'LINE', start: [20, 80, 0], end: [30, 80, 0] })
  assert.equal(JSON.stringify(hatches).includes('rawTags'), false)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const kjd = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  const dxfText = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const dxf = await sdk.readDocument(dxfText, { format: 'DXF' })
  const facts = drawing => drawing.listEntities({ type: 'HATCH' }).map(entity => ({
    patternName: entity.payload.patternName, solid: entity.payload.solid, patternLines: entity.payload.patternLines ?? [],
    edgeCount: entity.payload.boundaryLoops[0].edges.length,
  }))
  assert.deepEqual(facts(kjd), facts(document))
  assert.deepEqual(facts(dxf).map(item => [item.patternName, item.solid, item.patternLines.length, item.edgeCount]), [
    ['ANSI31', false, 1, 4], ['SOLID', true, 0, 4], ['ANSI32', false, 2, 4], ['SOLID', true, 0, 4],
  ])
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); h=list(d.modelspace().query("HATCH")); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"hatches":len(h),"names":[x.dxf.pattern_name for x in h],"solid":[x.dxf.solid_fill for x in h],"lines":[len(x.pattern.lines) if x.pattern else 0 for x in h],"edges":[len(x.paths[0].edges) for x in h]}))'],
  dxfText, { encoding: 'utf8', windowsHide: true, env: { ...process.env,
    PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  assert.equal(independent.status, 0, independent.stderr)
  assert.deepEqual(JSON.parse(independent.stdout), { errors: 0, fixes: 0, hatches: 4,
    names: ['ANSI31', 'SOLID', 'ANSI32', 'SOLID'], solid: [0, 1, 0, 1], lines: [1, 0, 2, 0], edges: [4, 4, 4, 4] })
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...source, expectedRevision: document.revision,
    sideViewAxis: { ...source.sideViewAxis, sectionHatches: [{ ...face, rawTags: [] }] } }), /unsupported field/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...source, expectedRevision: document.revision,
    sideViewAxis: { ...source.sideViewAxis, sectionHatches: [{ ...solidFace, lineAngle: 0 }] } }), /solid fills must not define/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...source, expectedRevision: document.revision,
    sideViewAxis: { ...source.sideViewAxis, sectionHatches: [{ ...doubleFace, lineSpacing: 1 }] } }), /cannot be combined/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...source, expectedRevision: document.revision,
    sideViewAxis: { ...source.sideViewAxis, sectionHatches: [{ ...doubleFace, patternLines: [{ angle: 0, base: [0, 0], offset: [0, 0] }] }] } }), /offset must not be zero/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...source, expectedRevision: document.revision,
    auxiliaryHatches: Array.from({ length: 65 }, () => absoluteFace) }), /exceed their budget/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...source, expectedRevision: document.revision,
    auxiliaryHatches: [{ ...absoluteFace, edges: [{ kind: 'line', start: [20, 80], end: [20, 80] }, ...absoluteFace.edges.slice(1)] }] }), /zero length/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...source, expectedRevision: document.revision,
    sideViewAxis: { ...source.sideViewAxis, sectionHatches: [{ ...face, edges: [{ ...face.edges[0], start: { station: 185, offset: 10 } }, ...face.edges.slice(1)] }] } }), /must be finite/u)
})
test('caller-supplied semantic style roles preserve effective CAD display facts without private catalogues', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const proposal = buildAgentMechanicalFlangeCore(document, {
    ...input(document.revision),
    styleProfile: {
      geometry: { layerName: 'MODEL_GEOMETRY', color: 7, lineweight: 35, linetypeName: 'CONTINUOUS', linetypePattern: [] },
      hatch: { layerName: 'MODEL_HATCH', color: 7, lineweight: 18, linetypeName: 'CONTINUOUS', linetypePattern: [] },
      frame: { layerName: 'SHEET_FRAME', color: 7, lineweight: 25, linetypeName: 'CONTINUOUS', linetypePattern: [] },
      grid: { layerName: 'SHEET_GRID', color: 7, lineweight: 18, linetypeName: 'CONTINUOUS', linetypePattern: [] },
      center: { layerName: 'CENTERLINES', color: 3, lineweight: 18, linetypeName: 'CENTER', linetypePattern: [8, -1, 1, -1] },
      notes: { layerName: 'ANNOTATION', color: 7, lineweight: 18, linetypeName: 'CONTINUOUS', linetypePattern: [] },
      dimensions: { layerName: 'DIMENSIONS', color: 2, lineweight: 18, linetypeName: 'CONTINUOUS', linetypePattern: [] },
    },
  })
  const circle = proposal.commandArgs.entities.find(entity => entity.type === 'CIRCLE')
  assert.equal(circle.payload.color, 7)
  assert.equal(circle.payload.lineweight, 35)
  assert.equal(circle.payload.linetypeName, 'CONTINUOUS')
  assert.ok(proposal.commandArgs.resources.linetypes.filter(item => item.name === 'CONTINUOUS').length <= 1)
  assert.equal(proposal.commandArgs.resources.layers.some(item => item.name === 'MODEL_GEOMETRY'), true)
  assert.equal(JSON.stringify(proposal).includes('privateCatalog'), false)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  const reopenedCircle = reopened.listEntities({ type: 'CIRCLE' }).find(entity => entity.payload.radius === 12)
  assert.equal(reopenedCircle.payload.color, 7)
  assert.equal(reopenedCircle.payload.lineweight, 35)
})

test('caller-supplied entity style keys preserve mixed native display facts and merge case-insensitive table names', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), source = input(document.revision)
  const proposal = buildAgentMechanicalFlangeCore(document, {
    ...source,
    styleProfile: { custom: [
      { key: 'fine', layerName: 'PUBLIC_FINE', color: 3, lineweight: 18, linetypeName: 'PUBLIC_DASH', linetypePattern: [2, -1], linetypeScale: .5 },
      { key: 'bold', layerName: 'PUBLIC_BOLD', color: 1, lineweight: 35, linetypeName: 'public_dash', linetypePattern: [2, -1] },
    ] },
    endView: {
      ...source.endView,
      ringStyleKeys: ['fine', 'bold', null],
      outlineSegments: source.endView.outlineSegments.map((segment, index) => index === 0 ? { ...segment, styleKey: 'bold' } : segment),
      cuttingPlaneMarks: source.endView.cuttingPlaneMarks.map(mark => ({ ...mark, stemStyleKey: 'fine', tickStyleKey: 'bold', arrowheadStyleKey: 'fine' })),
    },
    sideViewAxis: { ...source.sideViewAxis, axisStyleKey: 'fine', symmetricProfiles: source.sideViewAxis.symmetricProfiles.map(profile => ({ ...profile, styleKey: 'bold', startCapStyleKey: 'fine', endCapStyleKey: 'fine' })) },
    auxiliaryLines: [{ start: [10, 60], end: [30, 60], role: 'geometry', styleKey: 'fine' }],
    auxiliaryCurves: [{ kind: 'arc', center: [40, 60], radius: 5, startAngle: 0, endAngle: Math.PI, role: 'geometry', styleKey: 'bold' }],
    leaders: source.leaders.map(leader => ({ ...leader, styleKey: 'bold' })),
    sheet: {
      ...source.sheet,
      outerFrameStyleKey: 'bold', insetFrameStyleKey: 'fine', outerFrameSides: ['bottom', 'top', 'left'],
      titleGrid: { ...source.sheet.titleGrid, topStyleKey: 'bold', columns: [{ offset: 0, styleKey: 'fine' }, ...source.sheet.titleGrid.columns.slice(1)] },
      notes: source.sheet.notes.map(note => ({ ...note, entityStyleKey: 'bold' })),
    },
  })
  const layers = new Map(proposal.commandArgs.resources.layers.map(layer => [layer.name, layer.id]))
  assert.equal(proposal.evidence.parameters.entityStyleCount, 2)
  assert.equal(proposal.commandArgs.resources.linetypes.filter(item => item.name.toUpperCase() === 'PUBLIC_DASH').length, 1)
  const publicDashId = proposal.commandArgs.resources.linetypes.find(item => item.name.toUpperCase() === 'PUBLIC_DASH').id
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'CIRCLE' && entity.payload.radius === 12).payload.layerId, layers.get('PUBLIC_FINE'))
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'CIRCLE' && entity.payload.radius === 12).payload.linetypeId, publicDashId)
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'CIRCLE' && entity.payload.radius === 12).payload.linetypeScale, .5)
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'CIRCLE' && entity.payload.radius === 28).payload.layerId, layers.get('PUBLIC_BOLD'))
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'LINE' && JSON.stringify(entity.payload.start) === '[45,120,0]').payload.layerId, layers.get('PUBLIC_BOLD'))
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'LINE' && JSON.stringify(entity.payload.start) === '[90,198,0]').payload.layerId, layers.get('PUBLIC_FINE'))
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'SOLID').payload.layerId, layers.get('PUBLIC_FINE'))
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'LINE' && JSON.stringify(entity.payload.start) === '[280,150,0]').payload.layerId, layers.get('PUBLIC_FINE'))
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'LINE' && JSON.stringify(entity.payload.start) === '[190,125,0]' && JSON.stringify(entity.payload.end) === '[190,175,0]').payload.layerId, layers.get('PUBLIC_FINE'))
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'LINE' && JSON.stringify(entity.payload.start) === '[10,60,0]').payload.layerId, layers.get('PUBLIC_FINE'))
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'ARC' && JSON.stringify(entity.payload.center) === '[40,60,0]').payload.layerId, layers.get('PUBLIC_BOLD'))
  assert.ok(proposal.commandArgs.entities.filter(entity => ['TEXT', 'MTEXT'].includes(entity.type)).every(entity => entity.payload.layerId === layers.get('PUBLIC_BOLD')))
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'LEADER').payload.layerId, layers.get('PUBLIC_BOLD'))
  assert.equal(proposal.commandArgs.entities.some(entity => entity.type === 'LINE' && JSON.stringify(entity.payload.start) === '[400,0,0]' && JSON.stringify(entity.payload.end) === '[400,300,0]'), false)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...source, leaders: [{ ...source.leaders[0], styleKey: 'missing' }] }), /must reference input.styleProfile.custom/u)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.equal(reopened.getTable('linetypes').records.filter(item => item.name.toUpperCase() === 'PUBLIC_DASH').length, 1)
  assert.equal(reopened.listEntities({ type: 'LEADER' })[0].payload.color, 1)
})

test('caller-supplied annotation style resources stay generic and bind each native annotation', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), source = input(document.revision)
  const proposal = buildAgentMechanicalFlangeCore(document, { ...source,
    styleResources: {
      textStyles: [{ key: 'narrow-note', name: 'PUBLIC-NOTE-STYLE', fontFamily: 'TXT', fontFile: 'TXT', bigFontFile: '', fixedHeight: 0, widthFactor: .7, obliqueAngle: 0, dxfFlags: 0, generationFlags: 0 }],
      dimensionStyles: [{ key: 'precision-dimension', name: 'PUBLIC-DIM-STYLE', overallScale: 1, arrowSize: 3, extensionOffset: .625, baselineSpacing: 3.75, extensionBeyond: 0, rounding: 1e-9, textHeight: 3, decimalPlaces: 2, centerMarkSize: 2.5, textGap: .75, dxfFlags: 0 }],
    },
    sheet: { ...source.sheet, notes: source.sheet.notes.map(note => ({ ...note, styleKey: 'narrow-note' })) },
    dimensions: source.dimensions.map(dimension => ({ ...dimension, styleKey: 'precision-dimension' })),
    featureControlFrames: [{ position: [120, 80], role: 'dimensions', styleKey: 'precision-dimension', rows: [{ characteristic: 'position', tolerance: '0.1', datumReferences: [{ label: 'A' }] }] }],
  })
  assert.equal(proposal.commandArgs.resources.textStyles.length, 1)
  assert.equal(proposal.commandArgs.resources.dimensionStyles.length, 1)
  assert.equal(proposal.evidence.parameters.textStyleCount, 1)
  assert.equal(proposal.evidence.parameters.dimensionStyleCount, 1)
  const textStyleId = proposal.commandArgs.resources.textStyles[0].id
  const dimensionStyleId = proposal.commandArgs.resources.dimensionStyles[0].id
  for (const entity of proposal.commandArgs.entities.filter(entity => ['TEXT', 'MTEXT'].includes(entity.type))) assert.equal(entity.payload.styleId, textStyleId)
  for (const entity of proposal.commandArgs.entities.filter(entity => ['DIMENSION', 'TOLERANCE'].includes(entity.type))) assert.equal(entity.payload.styleId, dimensionStyleId)
  assert.equal(JSON.stringify(proposal).includes('privateCatalog'), false)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  const reopenedTextStyle = reopened.getTable('textStyles').records.find(record => record.name === 'PUBLIC-NOTE-STYLE')
  const reopenedDimensionStyle = reopened.getTable('dimensionStyles').records.find(record => record.name === 'PUBLIC-DIM-STYLE')
  assert.equal(reopenedTextStyle.payload.widthFactor, .7)
  assert.equal(reopenedDimensionStyle.payload.decimalPlaces, 2)
  assert.ok(reopened.listEntities({ type: 'MTEXT' }).every(entity => entity.payload.styleId === reopenedTextStyle.id))
  assert.ok(reopened.listEntities({ type: 'DIMENSION' }).every(entity => entity.payload.styleId === reopenedDimensionStyle.id))
  assert.equal(reopened.listEntities({ type: 'TOLERANCE' })[0].payload.styleId, reopenedDimensionStyle.id)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(document.revision), dimensions: [{ ...input(document.revision).dimensions[0], styleKey: 'missing' }] }), /must reference input.styleResources/u)
})

test('conflicting built-in text style names receive deterministic non-destructive aliases', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), source = input(document.revision)
  const styledNotes = source.sheet.notes.map(note => ({ ...note, styleKey: 'source-standard' }))
  const request = { ...source,
    styleResources: { textStyles: [{ key: 'source-standard', name: 'Standard', fontFamily: 'TXT', fontFile: 'TXT', bigFontFile: '', fixedHeight: 0, widthFactor: .65, obliqueAngle: 0, dxfFlags: 0, generationFlags: 0 }], dimensionStyles: [] },
    sheet: { ...source.sheet, notes: styledNotes },
  }
  const first = buildAgentMechanicalFlangeCore(document, request), second = buildAgentMechanicalFlangeCore(document, request)
  assert.deepEqual(first, second)
  assert.equal(first.commandArgs.resources.textStyles.length, 1)
  assert.match(first.commandArgs.resources.textStyles[0].name, /^KJ_TEXT_/u)
  assert.notEqual(first.commandArgs.resources.textStyles[0].name.toUpperCase(), 'STANDARD')
  await sdk.executeCommand('CREATEBATCH', first.commandArgs, { document })
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  const generatedStyle = reopened.getTable('textStyles').records.find(record => record.name === first.commandArgs.resources.textStyles[0].name)
  assert.equal(generatedStyle.payload.fontFamily, 'TXT')
  assert.equal(generatedStyle.payload.widthFactor, .65)
  assert.ok(reopened.listEntities({ type: 'MTEXT' }).every(entity => entity.payload.styleId === generatedStyle.id))
})

test('bounded semantic auxiliary lines compile as native LINE entities', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const proposal = buildAgentMechanicalFlangeCore(document, { ...input(document.revision), auxiliaryLines: [
    { start: [10, 12], end: [34, 12], role: 'hidden' },
    { start: [10, 14], end: [34, 14], role: 'center' },
  ] })
  const lines = proposal.commandArgs.entities.filter(entity => entity.type === 'LINE')
  assert.equal(lines.length, 38)
  assert.deepEqual(lines.find(line => JSON.stringify(line.payload.start) === '[10,12,0]').payload.end, [34, 12, 0])
  assert.equal(proposal.evidence.parameters.auxiliaryLineCount, 2)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const dxf = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.ok(dxf.listEntities({ type: 'LINE' }).some(line => JSON.stringify(line.payload.start) === '[10,12,0]' && JSON.stringify(line.payload.end) === '[34,12,0]'))
})

test('bounded semantic auxiliary curves compile as native editable CAD entities', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const proposal = buildAgentMechanicalFlangeCore(document, { ...input(document.revision), auxiliaryCurves: [
    { kind: 'arc', center: [20, 20], radius: 5, startAngle: 0, endAngle: Math.PI / 2, role: 'geometry' },
    { kind: 'ellipse', center: [40, 20], majorAxis: [8, 2], ratio: .25, startParameter: 0, endParameter: Math.PI, role: 'geometry' },
    { kind: 'polyline', vertices: [{ point: [50, 10] }, { point: [55, 12], bulge: .2 }, { point: [60, 10] }], role: 'hidden' },
    { kind: 'spline', degree: 2, controlPoints: [[70, 10], [75, 14], [80, 10]], knots: [0, 0, 0, 1, 1, 1], role: 'geometry' },
  ] })
  assert.equal(proposal.evidence.parameters.auxiliaryCurveCount, 4)
  assert.deepEqual(proposal.commandArgs.entities.filter(entity => ['ELLIPSE', 'LWPOLYLINE', 'SPLINE'].includes(entity.type)).map(entity => entity.type), ['ELLIPSE', 'LWPOLYLINE', 'SPLINE'])
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const dxf = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  for (const type of ['ELLIPSE', 'LWPOLYLINE', 'SPLINE']) assert.equal(dxf.listEntities({ type }).length, 1)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(document.revision), auxiliaryCurves: [{ kind: 'spline', degree: 2, controlPoints: [[0, 0], [1, 1], [2, 0]], knots: [0, 0, 1], role: 'geometry' }] }), /knots length/u)
})

test('auxiliary curve budget supports complex public drawings and remains fail-closed', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const auxiliaryCurves = Array.from({ length: 256 }, (_, index) => ({
    kind: 'arc', center: [(index % 32) * 5, Math.floor(index / 32) * 5], radius: 1,
    startAngle: 0, endAngle: Math.PI, role: 'geometry',
  }))
  const startedAt = performance.now()
  const proposal = buildAgentMechanicalFlangeCore(document, { ...input(document.revision), auxiliaryCurves })
  const elapsedMs = performance.now() - startedAt
  assert.equal(proposal.evidence.parameters.auxiliaryCurveCount, 256)
  assert.ok(proposal.commandArgs.entities.length < 1_024)
  assert.ok(Buffer.byteLength(JSON.stringify(proposal.commandArgs), 'utf8') < 512 * 1_024)
  assert.ok(elapsedMs < 5_000)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const [kjd, dxf] = await Promise.all([
    sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' }),
    sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' }),
  ])
  assert.ok(kjd.listEntities({ type: 'ARC' }).length >= 256)
  assert.ok(dxf.listEntities({ type: 'ARC' }).length >= 256)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(document.revision), auxiliaryCurves: [...auxiliaryCurves, auxiliaryCurves[0]] }), /256-curve budget/u)
})

test('generic local symbols compile as editable native blocks without source block metadata', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const symbols = { definitions: [{ key: 'local-callout', basePoint: [0, 0], members: [
    { kind: 'line', start: [0, 0], end: [8, 0], role: 'notes', entityStyleKey: 'by-block' },
    { kind: 'circle', center: [10, 0], radius: 2, role: 'notes', entityStyleKey: 'by-block' },
    { kind: 'arc', center: [15, 0], radius: 3, startAngle: 0, endAngle: Math.PI, role: 'notes', entityStyleKey: 'by-block' },
    { kind: 'multiline-text', text: 'REF', position: [9, 1], height: 1.5, attachmentPoint: 5, role: 'notes', entityStyleKey: 'by-block' },
  ] }], instances: [{ symbolKey: 'local-callout', position: [30, 40], scale: [1, 1], rotation: Math.PI / 6, role: 'notes' }] }
  const symbolInput = { ...input(document.revision), symbols,
    styleProfile: { custom: [{ key: 'by-block', layerName: '0', color: 0, lineweight: 0, linetypeName: 'Continuous', linetypePattern: [] }] } }
  const proposal = buildAgentMechanicalFlangeCore(document, symbolInput)
  assert.equal(proposal.evidence.parameters.symbolDefinitionCount, 1)
  assert.equal(proposal.evidence.parameters.symbolInstanceCount, 1)
  assert.equal(proposal.commandArgs.resources.blocks.length, 1)
  assert.equal(proposal.commandArgs.resources.blocks[0].entities.length, 4)
  assert.ok(proposal.commandArgs.resources.blocks[0].entities.every(entity => entity.payload.color === 0 && entity.payload.lineweight === 0))
  assert.ok(proposal.commandArgs.resources.layers.every(layer => layer.color >= 1 && layer.color <= 255))
  assert.equal(JSON.stringify(proposal).includes('local-callout'), false)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  assert.equal(document.listEntities({ type: 'INSERT' }).length, 1)
  const dxf = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.equal(dxf.listEntities({ type: 'INSERT' }).length, 1)
  assert.equal(dxf.getTable('blockRecords').records.filter(record => record.name?.startsWith('KJ_FLANGE_SYMBOL_')).length, 1)
  const blockRecord = dxf.getTable('blockRecords').records.find(record => record.name?.startsWith('KJ_FLANGE_SYMBOL_'))
  assert.ok(dxf.listEntities().filter(entity => entity.ownerId === blockRecord.id).every(entity => entity.payload.color === 0 && entity.payload.lineweight === 0))
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...symbolInput, expectedRevision: document.revision, symbols: { definitions: [{ ...symbols.definitions[0], rawTags: [] }], instances: symbols.instances } }), /unsupported field/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...symbolInput, expectedRevision: document.revision, symbols: { definitions: symbols.definitions, instances: [{ ...symbols.instances[0], symbolKey: 'missing' }] } }), /reference a definition/u)
})

test('local symbol member draw order survives three-digit KJD roundtrips', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const expectedStations = Array.from({ length: 101 }, (_, index) => index)
  const members = expectedStations.map(station => ({ kind: 'line', start: [station, 0], end: [station, 1], role: 'geometry' }))
  const symbols = {
    definitions: [{ key: 'large-local-symbol', basePoint: [0, 0], members }],
    instances: [{ symbolKey: 'large-local-symbol', position: [0, 0], role: 'geometry' }],
  }
  const proposal = buildAgentMechanicalFlangeCore(document, { ...input(document.revision), symbols })
  const block = proposal.commandArgs.resources.blocks[0]
  assert.match(block.entities[0].options.id, /-member-001$/u)
  assert.match(block.entities[100].options.id, /-member-101$/u)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const kjd = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  const record = kjd.getObject(block.id)
  const roundtripped = kjd.listEntities().filter(entity => entity.ownerId === block.id)
  assert.deepEqual(roundtripped.map(entity => entity.id), record.payload.entityIds)
  assert.deepEqual(roundtripped.map(entity => entity.payload.start[0]), expectedStations)
})

test('generic local symbols preserve nested block topology without attached entities', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const symbols = { definitions: [
    { key: 'child', basePoint: [0, 0], members: [{ kind: 'circle', center: [0, 0], radius: 2, role: 'geometry' }] },
    { key: 'parent', basePoint: [0, 0], members: [
      { kind: 'instance', symbolKey: 'child', position: [8, 0], scale: [1.5, 1], rotation: Math.PI / 8, role: 'geometry' },
      { kind: 'line', start: [0, 0], end: [8, 0], role: 'geometry' },
    ] },
  ], instances: [{ symbolKey: 'parent', position: [30, 40], scale: [1, 1], rotation: 0, role: 'geometry' }] }
  const proposal = buildAgentMechanicalFlangeCore(document, { ...input(document.revision), symbols })
  assert.equal(proposal.commandArgs.resources.blocks.length, 2)
  assert.equal(proposal.commandArgs.resources.blocks.find(block => block.name.includes('02')).entities.filter(entity => entity.type === 'INSERT').length, 1)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  assert.equal(document.listEntities({ type: 'INSERT' }).length, 2)
  const dxf = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.equal(dxf.listEntities({ type: 'INSERT' }).length, 2)
  assert.equal(dxf.listEntities({ type: 'CIRCLE' }).length, 10)
})

test('generic local symbols compile editable attribute definitions and complete native instance sequences', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const attribute = { text: 'P-100', tag: 'PART', prompt: 'Part number', position: [31, 42], alignmentPoint: [31, 42], height: 2.5,
    widthFactor: .8, horizontalAlignment: 1, verticalAlignment: 2, generationFlags: 1, flags: 0, role: 'notes' }
  const symbols = { definitions: [{ key: 'tagged-symbol', basePoint: [0, 0], members: [
    { kind: 'line', start: [0, 0], end: [10, 0], role: 'notes' },
    { kind: 'attribute-definition', ...attribute, text: 'DEFAULT', position: [1, 2], alignmentPoint: [1, 2] },
  ] }], instances: [{ symbolKey: 'tagged-symbol', position: [30, 40], scale: [1, 1], rotation: 0, role: 'notes', attributes: [attribute] }] }
  const proposal = buildAgentMechanicalFlangeCore(document, { ...input(document.revision), symbols })
  const block = proposal.commandArgs.resources.blocks[0], insert = proposal.commandArgs.entities.find(entity => entity.type === 'INSERT' && entity.attributeSequence)
  assert.equal(block.entities.filter(entity => entity.type === 'ATTDEF').length, 1)
  assert.equal(proposal.evidence.parameters.symbolAttributeCount, 2)
  assert.equal(insert.attributeSequence.attributes.length, 1); assert.equal(insert.attributeSequence.attributes[0].payload.text, 'P-100')
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const currentInsert = document.listEntities({ type: 'INSERT' }).find(entity => entity.payload.attributeIds.length)
  assert.equal(document.getObject(currentInsert.payload.attributeIds[0]).payload.text, 'P-100')
  assert.equal(document.getObject(currentInsert.payload.sequenceEndId).type, 'SEQEND')
  const dxfText = await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), dxf = await sdk.readDocument(dxfText, { format: 'DXF' })
  const reopened = dxf.listEntities({ type: 'INSERT' }).find(entity => entity.payload.attributeIds.length)
  assert.equal(dxf.getObject(reopened.payload.attributeIds[0]).payload.tag, 'PART'); assert.ok(dxf.getObject(reopened.payload.sequenceEndId))
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); ins=[e for e in d.modelspace().query("INSERT") if len(e.attribs)][0]; print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"values":[x.dxf.text for x in ins.attribs],"tags":[x.dxf.tag for x in ins.attribs],"hasSeqend":ins.seqend is not None}))'],
  dxfText, { encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(independent.stderr || '')) t.diagnostic('official ezdxf unavailable; independent check skipped')
  else { assert.equal(independent.status, 0, independent.stderr); assert.deepEqual(JSON.parse(independent.stdout), { errors: 0, fixes: 0, values: ['P-100'], tags: ['PART'], hasSeqend: true }) }
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(document.revision), symbols: { ...symbols, instances: [{ ...symbols.instances[0], attributes: [{ ...attribute, tag: 'PART', rawTags: [] }] }] } }), /unsupported field/u)
})

test('semantic feature-control frames compile as native TOLERANCE without opaque tags', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const featureControlFrames = [{ position: [120, 80], role: 'dimensions', rows: [
    { characteristic: 'concentricity', tolerance: '0.02', datumReferences: [{ label: 'A' }] },
    { characteristic: 'perpendicularity', tolerance: '0.03', diameterZone: true, materialCondition: 'maximum', datumReferences: [{ label: 'B', materialCondition: 'least' }] },
  ] }]
  const proposal = buildAgentMechanicalFlangeCore(document, { ...input(document.revision), featureControlFrames })
  const tolerance = proposal.commandArgs.entities.find(entity => entity.type === 'TOLERANCE')
  assert.equal(proposal.evidence.parameters.featureControlFrameCount, 1)
  assert.equal(tolerance.payload.text, String.raw`{\Fgdt;r}%%v0.02%%vA%%v%%v%%v%%v^J{\Fgdt;b}%%v{\Fgdt;n}0.03{\Fgdt;m}%%vB{\Fgdt;l}%%v%%v%%v%%v^J`)
  assert.equal(JSON.stringify(tolerance).includes('rawTags'), false)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const dxf = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.equal(dxf.listEntities({ type: 'TOLERANCE' }).length, 1)
  assert.equal(dxf.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(document.revision), featureControlFrames: [{ ...featureControlFrames[0], rawTags: [] }] }), /unsupported field/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(document.revision), featureControlFrames: [{ ...featureControlFrames[0], rows: [{ characteristic: 'unknown', tolerance: '0.1' }] }] }), /characteristic is invalid/u)
})

test('feature-control datum slots preserve intentional empty cells', () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const proposal = buildAgentMechanicalFlangeCore(document, { ...input(document.revision), featureControlFrames: [{ position: [120, 80], role: 'dimensions', rows: [{ characteristic: 'concentricity', tolerance: '0.03', datumReferences: [{ label: 'A', slot: 1 }, { label: 'B', slot: 2 }] }] }] })
  const tolerance = proposal.commandArgs.entities.find(entity => entity.type === 'TOLERANCE')
  assert.equal(tolerance.payload.text, String.raw`{\Fgdt;r}%%v0.03%%v%%vA%%vB%%v%%v^J`)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(document.revision), featureControlFrames: [{ position: [120, 80], role: 'dimensions', rows: [{ characteristic: 'concentricity', tolerance: '0.03', datumReferences: [{ label: 'A', slot: 4 }] }] }] }), /slot must be an integer from 0 to 3/u)
})
