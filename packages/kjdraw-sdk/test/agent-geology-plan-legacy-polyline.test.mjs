import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

const legacy = (id, patch = {}) => ({
  id, styleId: 'source', kind: 'legacyPolyline', legacyPoints: [[-3, 0, 0], [0, 2, 0], [3, 0, 0]], closed: false,
  elevation: 0, dxfFlags: 4, vertexFlags: [8, 16, 8], bulges: [0, 0, 0], startWidths: [0, 0, 0], endWidths: [0, 0, 0],
  ...patch,
})

const intent = overrides => ({
  version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en', drawingId: 'PUBLIC-NATIVE-POLYLINE', scale: 500,
  boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
  boreholes: [{ id: 'P1', position: [20, 20], collarElevation: 100 }, { id: 'P2', position: [115, 70], collarElevation: 98 }],
  sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
  coordinateGrid: { origin: [0, 0], spacing: 20 },
  baseMapStyles: [{ id: 'source', color: 7, lineweight: 18, pattern: [] }],
  baseMapLinework: [legacy('ordinary-model', { legacyPoints: [[30, 30, 0], [50, 30, 0], [50, 50, 0]], dxfFlags: 0, vertexFlags: [0, 0, 0] })],
  baseMapBlocks: [{ id: 'fitted-symbol', basePoint: [0, 0], entities: [
    legacy('spline-member'),
    legacy('curve-member', { legacyPoints: [[-2, -2, 0], [2, -2, 0], [0, 2, 0]], closed: true, dxfFlags: 3, vertexFlags: [0, 1, 0], bulges: [0.125, -0.25, 0] }),
  ] }],
  baseMapInserts: [{ id: 'symbol-instance', styleId: 'source', blockId: 'fitted-symbol', position: [90, 45], scale: [1, 1, 1], rotationDegrees: 0 }],
  ...overrides,
})

const signatures = document => document.listEntities({ type: 'POLYLINE' }).map(entity => ({
  flags: entity.payload.dxfFlags, closed: entity.payload.closed, elevation: entity.payload.elevation,
  points: entity.payload.vertices.map(vertex => vertex.point),
  vertexFlags: entity.payload.vertices.map(vertex => vertex.dxfFlags),
  bulges: entity.payload.vertices.map(vertex => vertex.bulge),
  startWidths: entity.payload.vertices.map(vertex => vertex.startWidth),
  endWidths: entity.payload.vertices.map(vertex => vertex.endWidth),
})).sort((left, right) => left.flags - right.flags)

test('ordinary geology-plan MCP preserves native 2D POLYLINE fitted flags and vertex facts through approval, KJD, DXF and official audit', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_plan').inputSchema
  assert.deepEqual(schema.properties.baseMapLinework.items.properties.kind.enum, ['line', 'arc', 'circle', 'polyline', 'legacyPolyline'])
  assert.equal(schema.properties.baseMapBlocks.items.properties.entities.items.properties.legacyPoints.items.maxItems, 3)
  const result = await session.call('cad_propose_geology_plan', intent())
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(document.listEntities().length, 0)
  assert.equal((await session.approve(result.value.planId, 'host-reviewer')).ok, true)
  const expected = signatures(document)
  assert.deepEqual(expected.map(value => value.flags), [0, 3, 4])
  assert.deepEqual(expected[1].bulges, [0.125, -0.25, 0])
  assert.deepEqual(expected[2].vertexFlags, [8, 16, 8])

  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const reopened of [await sdk.readDocument(kjd, { format: 'KJD' }), await sdk.readDocument(dxf, { format: 'DXF' })]) {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
    assert.deepEqual(signatures(reopened), expected)
  }

  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (!python || !pythonPath) return t.diagnostic('official ezdxf unavailable; independent check skipped')
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-native-polyline-'))
  try {
    const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py')
    await writeFile(dxfPath, dxf)
    await writeFile(auditPath, 'import ezdxf,json,sys\nd=ezdxf.readfile(sys.argv[1]);a=d.audit();rows=[]\nfor space in [d.modelspace()]+[b for b in d.blocks if b.name.startswith("BASEMAP_BLOCK_")]:\n for e in space.query("POLYLINE"):\n  rows.append({"flags":e.dxf.flags,"elevation":e.dxf.elevation.z,"vertexFlags":[v.dxf.flags for v in e.vertices],"bulges":[v.dxf.bulge for v in e.vertices]})\nprint(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"rows":sorted(rows,key=lambda x:x["flags"]),"proxies":len(d.modelspace().query("ACAD_PROXY_ENTITY"))}))\n')
    const audit = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } })
    assert.equal(audit.status, 0, audit.stderr)
    const report = JSON.parse(audit.stdout)
    assert.equal(report.errors, 0); assert.equal(report.fixes, 0); assert.equal(report.proxies, 0)
    assert.deepEqual(report.rows.map(value => value.flags), [0, 3, 4])
    assert.deepEqual(report.rows[1].bulges, [0.125, -0.25, 0])
    assert.deepEqual(report.rows[2].vertexFlags, [8, 16, 8])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('geology-plan native POLYLINE rejects 3D, mesh, polyface, inconsistent and model-space fitted facts before proposal', async () => {
  const invalidMembers = [
    legacy('bad', { dxfFlags: 8 }),
    legacy('bad', { vertexFlags: [8, 32, 8] }),
    legacy('bad', { closed: true, dxfFlags: 4 }),
    legacy('bad', { legacyPoints: [[-3, 0, 0], [0, 2, 1], [3, 0, 0]] }),
  ]
  const invalid = invalidMembers.map(member => intent({ baseMapBlocks: [{ id: 'fitted-symbol', basePoint: [0, 0], entities: [member] }] }))
  invalid.push(intent({ baseMapLinework: [legacy('bad-model')] }))
  for (const value of invalid) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
    const result = await session.call('cad_propose_geology_plan', value)
    assert.equal(result.ok, false)
    assert.equal(document.listEntities().length, 0)
  }
})
