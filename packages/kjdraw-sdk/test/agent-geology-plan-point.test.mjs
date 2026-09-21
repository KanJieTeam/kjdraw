import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

const sourcePoint = (id, position) => ({ id, styleId: 'source', kind: 'point', position })
const intent = overrides => ({
  version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en', drawingId: 'PUBLIC-POINT-PLAN', scale: 500,
  boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
  boreholes: [{ id: 'P1', position: [20, 20], collarElevation: 100 }, { id: 'P2', position: [115, 70], collarElevation: 98 }],
  sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
  coordinateGrid: { origin: [0, 0], spacing: 20 },
  baseMapStyles: [{ id: 'source', color: 7, lineweight: 18, pattern: [] }],
  baseMapBlocks: [{ id: 'survey-marker', basePoint: [0, 0], entities: [sourcePoint('location', [1.25, -2.5])] }],
  baseMapInserts: [{ id: 'instance', styleId: 'source', blockId: 'survey-marker', position: [60, 40], scale: [1, 1, 1], rotationDegrees: 0 }],
  ...overrides,
})

const pointFacts = document => document.listEntities({ type: 'POINT' }).map(entity => entity.payload.position).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

test('ordinary geology-plan MCP preserves an explicit source-backed native POINT through approval, KJD, DXF and official audit', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_plan').inputSchema
  const memberSchema = schema.properties.baseMapBlocks.items.properties.entities.items.properties
  assert.ok(memberSchema.kind.enum.includes('point'))
  assert.equal(memberSchema.position.minItems, 2); assert.equal(memberSchema.position.maxItems, 3)
  const result = await session.call('cad_propose_geology_plan', intent())
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.engineeringEvidence.baseMapPointCount, 1)
  assert.equal(document.listEntities().length, 0)
  assert.equal((await session.approve(result.value.planId, 'host-reviewer')).ok, true)
  const expected = pointFacts(document)
  assert.deepEqual(expected, [[1.25, -2.5, 0]])

  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const reopened of [await sdk.readDocument(kjd, { format: 'KJD' }), await sdk.readDocument(dxf, { format: 'DXF' })]) {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
    assert.deepEqual(pointFacts(reopened), expected)
  }

  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (!python || !pythonPath) return t.diagnostic('official ezdxf unavailable; independent check skipped')
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-point-'))
  try {
    const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py')
    await writeFile(dxfPath, dxf)
    await writeFile(auditPath, 'import ezdxf,json,sys\nd=ezdxf.readfile(sys.argv[1]);a=d.audit();rows=[]\nfor b in d.blocks:\n if b.name.startswith("BASEMAP_BLOCK_"):\n  for e in b.query("POINT"): rows.append([float(e.dxf.location.x),float(e.dxf.location.y),float(e.dxf.location.z),float(e.dxf.thickness),[float(v) for v in e.dxf.extrusion]])\nprint(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"rows":rows,"proxies":len(d.modelspace().query("ACAD_PROXY_ENTITY"))}))\n')
    const audit = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } })
    assert.equal(audit.status, 0, audit.stderr)
    const report = JSON.parse(audit.stdout)
    assert.equal(report.errors, 0); assert.equal(report.fixes, 0); assert.equal(report.proxies, 0)
    assert.deepEqual(report.rows, [[1.25, -2.5, 0, 0, [0, 0, 1]]])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('geology-plan native POINT facts fail closed on missing, non-planar, non-finite, unsupported or top-level values', async () => {
  const invalidMembers = [
    { id: 'bad', styleId: 'source', kind: 'point' },
    sourcePoint('bad', [0, 0, 0]),
    sourcePoint('bad', [Number.NaN, 0]),
    { ...sourcePoint('bad', [0, 0]), thickness: 1 },
    { ...sourcePoint('bad', [0, 0]), extrusion: [0, 0, 1] },
  ]
  const invalid = invalidMembers.map(member => intent({ baseMapBlocks: [{ id: 'survey-marker', basePoint: [0, 0], entities: [member] }] }))
  invalid.push(intent({ baseMapLinework: [sourcePoint('bad', [0, 0])] }))
  for (const value of invalid) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
    const result = await session.call('cad_propose_geology_plan', value)
    assert.equal(result.ok, false)
    assert.equal(document.listEntities().length, 0)
  }
})
