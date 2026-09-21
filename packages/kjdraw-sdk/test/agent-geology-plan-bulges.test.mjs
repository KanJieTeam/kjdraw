import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

const intent = overrides => ({
  version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en', drawingId: 'PUBLIC-CURVED-PLAN', scale: 500,
  boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
  boreholes: [{ id: 'P1', position: [20, 20], collarElevation: 100 }, { id: 'P2', position: [115, 70], collarElevation: 98 }],
  sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
  coordinateGrid: { origin: [0, 0], spacing: 20 },
  baseMapStyles: [{ id: 'source', color: 7, lineweight: 18, pattern: [] }],
  baseMapLinework: [{ id: 'curved-boundary', styleId: 'source', kind: 'polyline', points: [[30, 30], [50, 30], [50, 50]], bulges: [0.5, -0.25, 0], closed: false }],
  baseMapBlocks: [{ id: 'curved-symbol', basePoint: [0, 0], entities: [
    { id: 'curved-member', styleId: 'source', kind: 'polyline', points: [[-2, 0], [0, 2], [2, 0]], bulges: [0.25, -0.5, 0], closed: false },
    { id: 'closed-two-point-member', styleId: 'source', kind: 'polyline', points: [[-3, -2], [3, -2]], bulges: [1, 1], closed: true },
  ] }],
  baseMapInserts: [{ id: 'symbol-instance', styleId: 'source', blockId: 'curved-symbol', position: [90, 45], scale: [1, 1, 1], rotationDegrees: 0 }],
  ...overrides,
})

const bulges = entity => entity.payload.vertices.map(vertex => vertex.bulge ?? 0)
const sourcePolylines = document => document.listEntities({ type: 'LWPOLYLINE' }).filter(entity => entity.payload.vertices.some(vertex => Math.abs(vertex.bulge ?? 0) > 0))

test('ordinary geology-plan MCP preserves explicit source-backed bulges through approval, KJD, DXF and official audit', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const definition = session.definitions.find(tool => tool.name === 'cad_propose_geology_plan')
  assert.deepEqual(definition.inputSchema.properties.baseMapLinework.items.properties.bulges.items, { type: 'number', minimum: -1_000_000, maximum: 1_000_000 })
  assert.deepEqual(definition.inputSchema.properties.baseMapBlocks.items.properties.entities.items.properties.bulges.items, { type: 'number', minimum: -1_000_000, maximum: 1_000_000 })
  const result = await session.call('cad_propose_geology_plan', intent())
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(document.listEntities().length, 0)
  assert.equal((await session.approve(result.value.planId, 'host-reviewer')).ok, true)
  assert.deepEqual(sourcePolylines(document).map(bulges).sort(), [[0.25, -0.5, 0], [0.5, -0.25, 0], [1, 1]].sort())

  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const reopened of [await sdk.readDocument(kjd, { format: 'KJD' }), await sdk.readDocument(dxf, { format: 'DXF' })]) {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
    assert.deepEqual(sourcePolylines(reopened).map(bulges).sort(), [[0.25, -0.5, 0], [0.5, -0.25, 0], [1, 1]].sort())
  }

  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (!python || !pythonPath) return t.diagnostic('official ezdxf unavailable; independent check skipped')
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-bulges-'))
  try {
    const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py')
    await writeFile(dxfPath, dxf)
    await writeFile(auditPath, 'import ezdxf,json,sys\nd=ezdxf.readfile(sys.argv[1]);a=d.audit();values=[]\nfor e in d.modelspace().query("LWPOLYLINE"): values += [p[4] for p in e.get_points("xyseb") if abs(p[4])>0]\nfor b in d.blocks:\n if b.name.startswith("BASEMAP_BLOCK_"):\n  for e in b.query("LWPOLYLINE"): values += [p[4] for p in e.get_points("xyseb") if abs(p[4])>0]\nprint(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"bulges":sorted(values),"proxies":len(d.modelspace().query("ACAD_PROXY_ENTITY"))}))\n')
    const audit = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } })
    assert.equal(audit.status, 0, audit.stderr)
    assert.deepEqual(JSON.parse(audit.stdout), { errors: 0, fixes: 0, bulges: [-0.5, -0.25, 0.25, 0.5, 1, 1], proxies: 0 })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('geology-plan bulges reject mismatched, non-finite, out-of-range and viewport-escaping facts before proposal', async () => {
  const invalid = [
    intent({ baseMapLinework: [{ id: 'bad', styleId: 'source', kind: 'polyline', points: [[30, 30], [50, 30]], bulges: [0.5] }] }),
    intent({ baseMapBlocks: [{ id: 'curved-symbol', basePoint: [0, 0], entities: [{ id: 'bad', styleId: 'source', kind: 'polyline', points: [[0, 0], [1, 0]], bulges: [Number.NaN, 0] }] }] }),
    intent({ baseMapBlocks: [{ id: 'curved-symbol', basePoint: [0, 0], entities: [{ id: 'bad', styleId: 'source', kind: 'polyline', points: [[0, 0], [1, 0]], bulges: [1_000_001, 0] }] }] }),
    intent({ baseMapLinework: [{ id: 'bad', styleId: 'source', kind: 'polyline', points: [[0, 0], [140, 0]], bulges: [2, 0] }] }),
    intent({ baseMapBlocks: [{ id: 'curved-symbol', basePoint: [0, 0], entities: [{ id: 'bad', styleId: 'source', kind: 'polyline', points: [[0, 0], [1, 0]], closed: true }] }] }),
    intent({ baseMapBlocks: [{ id: 'curved-symbol', basePoint: [0, 0], entities: [{ id: 'bad', styleId: 'source', kind: 'polyline', points: [[0, 0], [1, 0]], bulges: [0, 0], closed: true }] }] }),
  ]
  for (const value of invalid) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
    const result = await session.call('cad_propose_geology_plan', value)
    assert.equal(result.ok, false)
    assert.equal(document.listEntities().length, 0)
  }
})
