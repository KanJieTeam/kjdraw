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
  leaders: [{ vertices: [[80, 100], [70, 90], [65, 90]], arrowEnabled: true, pathType: 0, annotationType: 3 }],
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
    { kind: 'line', start: [0, 0], end: [8, 0], role: 'notes' },
    { kind: 'circle', center: [10, 0], radius: 2, role: 'notes' },
    { kind: 'arc', center: [15, 0], radius: 3, startAngle: 0, endAngle: Math.PI, role: 'notes' },
    { kind: 'multiline-text', text: 'REF', position: [9, 1], height: 1.5, attachmentPoint: 5, role: 'notes' },
  ] }], instances: [{ symbolKey: 'local-callout', position: [30, 40], scale: [1, 1], rotation: Math.PI / 6, role: 'notes' }] }
  const proposal = buildAgentMechanicalFlangeCore(document, { ...input(document.revision), symbols })
  assert.equal(proposal.evidence.parameters.symbolDefinitionCount, 1)
  assert.equal(proposal.evidence.parameters.symbolInstanceCount, 1)
  assert.equal(proposal.commandArgs.resources.blocks.length, 1)
  assert.equal(proposal.commandArgs.resources.blocks[0].entities.length, 4)
  assert.equal(JSON.stringify(proposal).includes('local-callout'), false)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  assert.equal(document.listEntities({ type: 'INSERT' }).length, 1)
  const dxf = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.equal(dxf.listEntities({ type: 'INSERT' }).length, 1)
  assert.equal(dxf.getTable('blockRecords').records.filter(record => record.name?.startsWith('KJ_FLANGE_SYMBOL_')).length, 1)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(document.revision), symbols: { definitions: [{ ...symbols.definitions[0], rawTags: [] }], instances: symbols.instances } }), /unsupported field/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(document.revision), symbols: { definitions: symbols.definitions, instances: [{ ...symbols.instances[0], symbolKey: 'missing' }] } }), /reference a definition/u)
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
