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
  sideViewAxis: { xRange: [190, 280], symmetricProfiles: [{
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
      { kind: 'multiline', text: 'REMOVE BURRS\nBREAK SHARP EDGES', position: [20, 40], height: 2.5, width: 80 },
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
})

test('all ring, hole, projection-axis and grid positions respond to parameters', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const proposal = buildAgentMechanicalFlangeCore(document, input(document.revision))
  const entities = proposal.commandArgs.entities
  const circles = entities.filter(e => e.type === 'CIRCLE').map(e => e.payload)
  assert.deepEqual(circles.slice(0, 3).map(e => e.radius), [12, 28, 40])
  assert.deepEqual(circles.slice(3, 7).map(e => e.center), [[60, 120, 0], [60, 180, 0], [120, 120, 0], [120, 180, 0]])
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[190,150,0]' && JSON.stringify(e.payload.end) === '[280,150,0]'))
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

test('flange compiler rejects unsupported source injection and impossible geometry', () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), rawDrawing: 'private' }), /unsupported field/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, ringRadii: [20, 12] } }), /increase strictly/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, squareHoles: { pitch: 6, radius: 4 } } }), /pitch must exceed/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, outlineSegments: [{ kind: 'line', startOffset: [0, 0], endOffset: [0, 0] }] } }), /zero length/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, outlineSegments: [{ kind: 'arc', centerOffset: [0, 0], radius: 10, startAngle: 1, endAngle: 1 }] } }), /sweep must not be zero/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, cuttingPlaneMarks: [{ anchorOffset: [0, 50], stemVector: [0, 0], tickVector: [5, 0] }] } }), /vectors must not have zero length/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), expectedRevision: 1 }), /expectedRevision/u)
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

test('source-relative cut faces compile into native patterned hatches with bounded edge paths', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const face = { lineAngle: Math.PI / 4, lineSpacing: 3.175, edges: [
    { kind: 'line', start: { station: 200, offset: 10 }, end: { station: 220, offset: 10 } },
    { kind: 'arc', center: { station: 220, offset: 5 }, radius: 5, startAngle: Math.PI / 2, endAngle: -Math.PI / 2, counterClockwise: false },
    { kind: 'line', start: { station: 220, offset: 0 }, end: { station: 200, offset: 0 } },
    { kind: 'line', start: { station: 200, offset: 0 }, end: { station: 200, offset: 10 } },
  ] }
  const source = { ...input(document.revision), sideViewAxis: { ...input(document.revision).sideViewAxis, sectionHatches: [face] } }
  const proposal = buildAgentMechanicalFlangeCore(document, source)
  const hatch = proposal.commandArgs.entities.find(entity => entity.type === 'HATCH')
  assert.equal(proposal.evidence.parameters.sectionHatchCount, 1)
  assert.equal(proposal.evidence.entityCount, 54)
  assert.deepEqual(hatch.payload.boundaryLoops[0].edges[0], { type: 'LINE', start: [200, 160, 0], end: [220, 160, 0] })
  assert.deepEqual(hatch.payload.boundaryLoops[0].edges[1].center, [220, 155, 0])
  assert.ok(Math.abs(hatch.payload.patternLines[0].offset[0] + 3.175 / Math.sqrt(2)) < 1e-12)
  assert.equal(JSON.stringify(hatch).includes('rawTags'), false)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF' })
  assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 1)
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); h=d.modelspace().query("HATCH"); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"hatches":len(h),"edges":len(h[0].paths[0].edges)}))'],
  dxf, { encoding: 'utf8', windowsHide: true, env: { ...process.env,
    PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  assert.equal(independent.status, 0, independent.stderr)
  assert.deepEqual(JSON.parse(independent.stdout), { errors: 0, fixes: 0, hatches: 1, edges: 4 })
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...source, expectedRevision: document.revision,
    sideViewAxis: { ...source.sideViewAxis, sectionHatches: [{ ...face, rawTags: [] }] } }), /unsupported field/u)
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
  assert.equal(proposal.commandArgs.entities.find(entity => entity.type === 'LINE' && JSON.stringify(entity.payload.start) === '[190,150,0]').payload.layerId, layers.get('PUBLIC_FINE'))
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
