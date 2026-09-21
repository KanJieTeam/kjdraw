import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

const line = (id, start, end) => ({ id, styleId: 'source', kind: 'line', start, end })
const hatch = patch => ({
  id: 'fill', styleId: 'source', kind: 'hatch', patternName: 'GENERIC_GRID', solid: false, associative: true,
  patternAngleDegrees: 12.5, patternScale: 2.25,
  patternLines: [{ angleDegrees: 30, base: [0.125, 0.25], offset: [0.75, 1.25], dashes: [1.5, -0.5] }],
  seedPoints: [[2, 1]],
  boundaryLoops: [{ external: true, flags: 7, closed: true,
    vertices: [[0, 0], [4, 0], [4, 2], [0, 2]].map(point => ({ point, bulge: 0 })),
    sourceMemberIds: ['bottom', 'right', 'top', 'left'],
  }], ...patch,
})
const intent = overrides => ({
  version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en', drawingId: 'PUBLIC-HATCH-PLAN', scale: 500,
  boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
  boreholes: [{ id: 'P1', position: [20, 20], collarElevation: 100 }, { id: 'P2', position: [115, 70], collarElevation: 98 }],
  sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
  coordinateGrid: { origin: [0, 0], spacing: 20 },
  baseMapStyles: [{ id: 'source', color: 7, lineweight: 18, pattern: [] }],
  baseMapBlocks: [{ id: 'filled-symbol', basePoint: [0, 0], entities: [
    line('bottom', [0, 0], [4, 0]), line('right', [4, 0], [4, 2]), line('top', [4, 2], [0, 2]), line('left', [0, 2], [0, 0]), hatch(),
  ] }],
  baseMapInserts: [{ id: 'instance', styleId: 'source', blockId: 'filled-symbol', position: [70, 45], scale: [1, 1, 1], rotationDegrees: 0 }],
  ...overrides,
})

const rounded = value => Math.round(value * 1e12) / 1e12
const hatchFacts = document => {
  const entity = document.listEntities({ type: 'HATCH' })[0]
  const loop = entity.payload.boundaryLoops[0]
  return {
    patternName: entity.payload.patternName, solid: entity.payload.solid, associative: entity.payload.associative,
    patternAngle: rounded(entity.payload.patternAngle), patternScale: entity.payload.patternScale,
    patternLines: entity.payload.patternLines.map(value => ({ angle: rounded(value.angle), base: value.base, offset: value.offset, dashes: value.dashes })),
    seedPoints: entity.payload.seedPoints,
    loop: { external: loop.external, flags: loop.flags, closed: loop.closed, vertices: loop.vertices.map(value => ({ point: value.point, bulge: value.bulge ?? 0 })),
      sourceCount: (loop.sourceIds ?? loop.sourceHandles ?? []).length },
  }
}

test('ordinary geology-plan MCP preserves an explicit associative patterned HATCH through approval, KJD, DXF and official audit', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_plan').inputSchema
  assert.ok(schema.properties.baseMapBlocks.items.properties.entities.items.properties.kind.enum.includes('hatch'))
  assert.equal(schema.properties.baseMapBlocks.items.properties.entities.items.properties.boundaryLoops.maxItems, 64)
  const result = await session.call('cad_propose_geology_plan', intent())
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.engineeringEvidence.baseMapHatchCount, 1)
  assert.equal(document.listEntities().length, 0)
  assert.equal((await session.approve(result.value.planId, 'host-reviewer')).ok, true)
  const expected = hatchFacts(document)
  assert.equal(expected.loop.sourceCount, 4)

  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const reopened of [await sdk.readDocument(kjd, { format: 'KJD' }), await sdk.readDocument(dxf, { format: 'DXF' })]) {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
    assert.deepEqual(hatchFacts(reopened), expected)
  }

  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (!python || !pythonPath) return t.diagnostic('official ezdxf unavailable; independent check skipped')
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-hatch-'))
  try {
    const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py')
    await writeFile(dxfPath, dxf)
    await writeFile(auditPath, 'import ezdxf,json,sys\nd=ezdxf.readfile(sys.argv[1]);a=d.audit();rows=[]\nfor b in d.blocks:\n if b.name.startswith("BASEMAP_BLOCK_"):\n  for h in b.query("HATCH"):\n   p=h.paths[0]; rows.append({"associative":h.dxf.associative,"angle":h.dxf.pattern_angle,"scale":h.dxf.pattern_scale,"paths":len(h.paths),"vertices":len(p.vertices),"sources":len(p.source_boundary_objects),"seeds":len(h.seeds)})\nprint(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"rows":rows,"proxies":len(d.modelspace().query("ACAD_PROXY_ENTITY"))}))\n')
    const audit = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } })
    assert.equal(audit.status, 0, audit.stderr)
    assert.deepEqual(JSON.parse(audit.stdout), { errors: 0, fixes: 0, rows: [{ associative: 1, angle: 12.5, scale: 2.25, paths: 1, vertices: 4, sources: 4, seeds: 1 }], proxies: 0 })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('geology-plan associative HATCH rejects incomplete, mismatched and unsafe source facts before proposal', async () => {
  const replaceHatch = value => intent({ baseMapBlocks: [{ id: 'filled-symbol', basePoint: [0, 0], entities: [
    line('bottom', [0, 0], [4, 0]), line('right', [4, 0], [4, 2]), line('top', [4, 2], [0, 2]), line('left', [0, 2], [0, 0]), value,
  ] }] })
  const invalid = [
    replaceHatch(hatch({ associative: false })),
    replaceHatch(hatch({ boundaryLoops: [{ ...hatch().boundaryLoops[0], sourceMemberIds: [] }] })),
    replaceHatch(hatch({ boundaryLoops: [{ ...hatch().boundaryLoops[0], sourceMemberIds: ['bottom', 'right', 'top', 'missing'] }] })),
    replaceHatch(hatch({ boundaryLoops: [{ ...hatch().boundaryLoops[0], sourceMemberIds: ['bottom', 'right', 'top', 'top'] }] })),
    replaceHatch(hatch({ boundaryLoops: [{ ...hatch().boundaryLoops[0], vertices: [{ point: [0, 0], bulge: 0 }, { point: [3, 0], bulge: 0 }, { point: [4, 2], bulge: 0 }, { point: [0, 2], bulge: 0 }] }] })),
    replaceHatch(hatch({ boundaryLoops: [{ ...hatch().boundaryLoops[0], closed: false }] })),
    replaceHatch(hatch({ boundaryLoops: [{ ...hatch().boundaryLoops[0], flags: 1 }] })),
    replaceHatch(hatch({ patternLines: [] })),
    replaceHatch(hatch({ seedPoints: [[Number.NaN, 0]] })),
  ]
  for (const [index, value] of invalid.entries()) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
    const result = await session.call('cad_propose_geology_plan', value)
    assert.equal(result.ok, false, `invalid case ${index}: ${JSON.stringify(result)}`)
    assert.equal(document.listEntities().length, 0)
  }
})
