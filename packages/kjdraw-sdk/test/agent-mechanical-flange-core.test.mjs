import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

import { buildAgentMechanicalFlangeCore, createKJDrawSDK, KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK } from '../src/index.js'

const input = expectedRevision => ({
  version: '1.0.0', expectedRevision, units: 'millimeter', drawingId: 'PUBLIC-TEST-FLANGE',
  endView: { center: [90, 150], ringRadii: [12, 28, 40], squareHoles: { pitch: 60, radius: 4 } },
  sideViewAxis: { xRange: [190, 280], symmetricProfiles: [{
    vertices: [{ station: 190, radius: 25 }, { station: 210, radius: 25 }, { station: 210, radius: 40 },
      { station: 250, radius: 40 }, { station: 255, radius: 30 }, { station: 280, radius: 30 }],
    endCaps: 'both',
  }] },
  sheet: { origin: [0, 0], size: [400, 300], inset: 8,
    titleGrid: { origin: [240, 8], size: [152, 35], columns: [0, 20, 60],
      partialColumns: [{ offset: 100, height: 18 }], rows: [{ offset: 12 }, { offset: 24, breaks: [80] }],
      diagonalHeader: { width: 20, drop: 6 } },
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
  assert.equal(a.evidence.entityCount, 37)
  assert.equal(a.commandArgs.entities.filter(e => e.type === 'CIRCLE').length, 7)
  assert.equal(a.commandArgs.entities.filter(e => e.type === 'LINE').length, 30)
  assert.equal(a.evidence.parameters.symmetricProfileCount, 1)
})

test('all ring, hole, projection-axis and grid positions respond to parameters', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const proposal = buildAgentMechanicalFlangeCore(document, input(document.revision))
  const entities = proposal.commandArgs.entities
  const circles = entities.filter(e => e.type === 'CIRCLE').map(e => e.payload)
  assert.deepEqual(circles.slice(0, 3).map(e => e.radius), [12, 28, 40])
  assert.deepEqual(circles.slice(3).map(e => e.center), [[60, 120, 0], [60, 180, 0], [120, 120, 0], [120, 180, 0]])
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[190,150,0]' && JSON.stringify(e.payload.end) === '[280,150,0]'))
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[190,175,0]' && JSON.stringify(e.payload.end) === '[210,175,0]'))
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[190,125,0]' && JSON.stringify(e.payload.end) === '[210,125,0]'))
  assert.ok(entities.some(e => e.type === 'LINE' && JSON.stringify(e.payload.start) === '[190,125,0]' && JSON.stringify(e.payload.end) === '[190,175,0]'))
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document })
  assert.equal(document.listEntities().length, 37)
  const kjd = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  const dxfText = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const dxf = await sdk.readDocument(dxfText, { format: 'DXF' })
  assert.equal(kjd.listEntities().length, 37)
  assert.equal(dxf.listEntities().filter(e => e.type === 'CIRCLE').length, 7)
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); m=d.modelspace(); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"circles":len(m.query("CIRCLE")),"lines":len(m.query("LINE"))}))'],
  dxfText, { encoding: 'utf8', windowsHide: true, env: { ...process.env,
    PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(independent.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(independent.stderr || independent.error?.message)
    t.diagnostic('official ezdxf unavailable; independent check skipped')
  } else {
    assert.equal(independent.status, 0, independent.stderr)
    assert.deepEqual(JSON.parse(independent.stdout), { errors: 0, fixes: 0, circles: 7, lines: 30 })
  }
})

test('flange compiler rejects unsupported source injection and impossible geometry', () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), rawDrawing: 'private' }), /unsupported field/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, ringRadii: [20, 12] } }), /increase strictly/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), endView: { ...input(0).endView, squareHoles: { pitch: 6, radius: 4 } } }), /pitch must exceed/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), expectedRevision: 1 }), /expectedRevision/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sideViewAxis: { xRange: [190, 280], symmetricProfiles: [{ vertices: [{ station: 210, radius: 10 }, { station: 200, radius: 10 }] }] } }), /must not decrease/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sideViewAxis: { xRange: [190, 280], symmetricProfiles: [{ vertices: [{ station: 200, radius: 10 }, { station: 200, radius: 10 }] }] } }), /zero-length/u)
  assert.throws(() => buildAgentMechanicalFlangeCore(document, { ...input(0), sheet: { ...input(0).sheet, titleGrid: { ...input(0).sheet.titleGrid, origin: [0, 0] } } }), /inside the inset frame/u)
})
