import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

const points = [[-5, 0, 0], [-4, 1, 0], [-3, 1.5, 0], [-2, 2, 0], [-1, 2.25, 0], [0, 2.5, 0], [1, 2.25, 0], [2, 2, 0], [3, 1.5, 0], [4, 1, 0], [5, 0, 0], [5, 0, 0]]
const flags = [16, 8, 8, 8, 8, 8, 8, 8, 8, 8, 16, 16]
const fitted = (id, patch = {}) => ({
  id, styleId: 'source', kind: 'legacyPolyline', legacyPoints: points, closed: false, elevation: 0, dxfFlags: 4,
  vertexFlags: flags, bulges: points.map(() => 0), startWidths: points.map(() => 0), endWidths: points.map(() => 0),
  ...patch,
})
const intent = overrides => ({
  version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en', drawingId: 'PUBLIC-FITTED-POLYLINE', scale: 500,
  boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
  boreholes: [{ id: 'P1', position: [20, 20], collarElevation: 100 }, { id: 'P2', position: [115, 70], collarElevation: 98 }],
  sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
  coordinateGrid: { origin: [0, 0], spacing: 20 },
  baseMapStyles: [{ id: 'source', color: 7, lineweight: 18, pattern: [] }],
  baseMapBlocks: [{ id: 'fitted-symbol', basePoint: [0, 0], entities: [fitted('spline-sequence')] }],
  baseMapInserts: [{ id: 'instance', styleId: 'source', blockId: 'fitted-symbol', position: [70, 45], scale: [1, 1, 1], rotationDegrees: 0 }],
  ...overrides,
})
const facts = document => document.listEntities({ type: 'POLYLINE' }).map(entity => ({
  flags: entity.payload.dxfFlags, closed: entity.payload.closed, elevation: entity.payload.elevation,
  points: entity.payload.vertices.map(vertex => vertex.point), vertexFlags: entity.payload.vertices.map(vertex => vertex.dxfFlags),
  bulges: entity.payload.vertices.map(vertex => vertex.bulge), startWidths: entity.payload.vertices.map(vertex => vertex.startWidth), endWidths: entity.payload.vertices.map(vertex => vertex.endWidth),
}))

test('ordinary geology-plan MCP preserves repeated spline control vertices only in an explicit native fitted POLYLINE sequence', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const result = await session.call('cad_propose_geology_plan', intent())
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal((await session.approve(result.value.planId, 'host-reviewer')).ok, true)
  const expected = facts(document)
  assert.equal(expected.length, 1); assert.equal(expected[0].flags, 4); assert.deepEqual(expected[0].vertexFlags, flags); assert.deepEqual(expected[0].points.slice(-2), [[5, 0, 0], [5, 0, 0]])

  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const reopened of [await sdk.readDocument(kjd, { format: 'KJD' }), await sdk.readDocument(dxf, { format: 'DXF' })]) {
    assert.equal(reopened.validate().valid, true); assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0); assert.deepEqual(facts(reopened), expected)
  }

  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (!python || !pythonPath) return t.diagnostic('official ezdxf unavailable; independent check skipped')
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-fitted-zero-'))
  try {
    const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py'); await writeFile(dxfPath, dxf)
    await writeFile(auditPath, 'import ezdxf,json,sys\nd=ezdxf.readfile(sys.argv[1]);a=d.audit();rows=[]\nfor b in d.blocks:\n if b.name.startswith("BASEMAP_BLOCK_"):\n  for e in b.query("POLYLINE"):\n   vs=list(e.vertices);rows.append({"flags":e.dxf.flags,"points":[[float(v.dxf.location.x),float(v.dxf.location.y),float(v.dxf.location.z)] for v in vs],"vertexFlags":[v.dxf.flags for v in vs]})\nprint(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"rows":rows,"proxies":len(d.modelspace().query("ACAD_PROXY_ENTITY"))}))\n')
    const audit = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } }); assert.equal(audit.status, 0, audit.stderr)
    const report = JSON.parse(audit.stdout); assert.equal(report.errors, 0); assert.equal(report.fixes, 0); assert.equal(report.proxies, 0); assert.equal(report.rows.length, 1)
    assert.equal(report.rows[0].flags, 4); assert.deepEqual(report.rows[0].vertexFlags, flags); assert.deepEqual(report.rows[0].points.slice(-2), [[5, 0, 0], [5, 0, 0]])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('geology-plan rejects repeated native POLYLINE vertices outside a typed source-backed spline sequence', async () => {
  const invalidMembers = [
    fitted('bad', { dxfFlags: 0, vertexFlags: points.map(() => 0) }),
    fitted('bad', { dxfFlags: 2, vertexFlags: points.map(() => 1) }),
    fitted('bad', { vertexFlags: [...flags.slice(0, -1), 0] }),
  ]
  const invalid = invalidMembers.map(member => intent({ baseMapBlocks: [{ id: 'fitted-symbol', basePoint: [0, 0], entities: [member] }] }))
  invalid.push(intent({ baseMapLinework: [fitted('bad-model')] }))
  for (const value of invalid) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
    const result = await session.call('cad_propose_geology_plan', value); assert.equal(result.ok, false); assert.equal(document.listEntities().length, 0)
  }
})
