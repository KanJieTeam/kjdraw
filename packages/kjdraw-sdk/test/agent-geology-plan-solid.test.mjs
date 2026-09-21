import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

const solid = (id, solidVertices) => ({ id, styleId: 'source', kind: 'solid', solidVertices })
const intent = overrides => ({
  version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en', drawingId: 'PUBLIC-SOLID-PLAN', scale: 500,
  boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
  boreholes: [{ id: 'P1', position: [20, 20], collarElevation: 100 }, { id: 'P2', position: [115, 70], collarElevation: 98 }],
  sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
  coordinateGrid: { origin: [0, 0], spacing: 20 },
  baseMapStyles: [{ id: 'source', color: 7, lineweight: 18, pattern: [] }],
  baseMapBlocks: [{ id: 'filled-symbol', basePoint: [0, 0], entities: [
    solid('face-a', [[0, 0], [4, 0], [0.5, 2], [3.5, 2]]),
    solid('face-b', [[-2, -1], [0, -2], [-1.5, 1], [0.5, 0.5]]),
  ] }],
  baseMapInserts: [
    { id: 'instance-a', styleId: 'source', blockId: 'filled-symbol', position: [60, 40], scale: [1, 1, 1], rotationDegrees: 0 },
    { id: 'instance-b', styleId: 'source', blockId: 'filled-symbol', position: [80, 50], scale: [1.5, -0.75, 1], rotationDegrees: 35 },
  ],
  ...overrides,
})

const solidFacts = document => document.listEntities({ type: 'SOLID' }).map(entity => entity.payload.vertices).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

test('ordinary geology-plan MCP preserves explicit source-backed native SOLID faces through approval, KJD, DXF and official audit', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_plan').inputSchema
  const memberSchema = schema.properties.baseMapBlocks.items.properties.entities.items.properties
  assert.ok(memberSchema.kind.enum.includes('solid'))
  assert.equal(memberSchema.solidVertices.minItems, 4); assert.equal(memberSchema.solidVertices.maxItems, 4)
  const result = await session.call('cad_propose_geology_plan', intent())
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.engineeringEvidence.baseMapSolidCount, 2)
  assert.equal(document.listEntities().length, 0)
  assert.equal((await session.approve(result.value.planId, 'host-reviewer')).ok, true)
  const expected = solidFacts(document)
  assert.equal(expected.length, 2)

  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const reopened of [await sdk.readDocument(kjd, { format: 'KJD' }), await sdk.readDocument(dxf, { format: 'DXF' })]) {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
    assert.deepEqual(solidFacts(reopened), expected)
  }

  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (!python || !pythonPath) return t.diagnostic('official ezdxf unavailable; independent check skipped')
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-solid-'))
  try {
    const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py')
    await writeFile(dxfPath, dxf)
    await writeFile(auditPath, 'import ezdxf,json,sys\nd=ezdxf.readfile(sys.argv[1]);a=d.audit();rows=[]\nfor b in d.blocks:\n if b.name.startswith("BASEMAP_BLOCK_"):\n  for e in b.query("SOLID"): rows.append([[float(v.x),float(v.y),float(v.z)] for v in [e.dxf.vtx0,e.dxf.vtx1,e.dxf.vtx2,e.dxf.vtx3]])\nprint(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"rows":rows,"proxies":len(d.modelspace().query("ACAD_PROXY_ENTITY"))}))\n')
    const audit = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } })
    assert.equal(audit.status, 0, audit.stderr)
    const report = JSON.parse(audit.stdout)
    assert.equal(report.errors, 0); assert.equal(report.fixes, 0); assert.equal(report.proxies, 0); assert.equal(report.rows.length, 2)
    assert.deepEqual(report.rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), expected)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('geology-plan native SOLID facts fail closed on wrong cardinality, duplicates, collinearity, non-finite values and top-level use', async () => {
  const invalidMembers = [
    solid('bad', [[0, 0], [1, 0], [0, 1]]),
    solid('bad', [[0, 0], [1, 0], [0, 1], [0, 1]]),
    solid('bad', [[0, 0], [1, 0], [2, 0], [3, 0]]),
    solid('bad', [[0, 0], [1, 0], [0, 1], [Number.NaN, 2]]),
  ]
  const invalid = invalidMembers.map(member => intent({ baseMapBlocks: [{ id: 'filled-symbol', basePoint: [0, 0], entities: [member] }] }))
  invalid.push(intent({ baseMapLinework: [solid('bad', [[0, 0], [1, 0], [0, 1], [1, 1]])] }))
  for (const value of invalid) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
    const result = await session.call('cad_propose_geology_plan', value)
    assert.equal(result.ok, false)
    assert.equal(document.listEntities().length, 0)
  }
})
