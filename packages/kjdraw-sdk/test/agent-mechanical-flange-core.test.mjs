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
})
