import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

const sourceBackedBlocks = () => ([
  { id: 'detail', basePoint: [0, 0], entities: [
    { id: 'axis', styleId: 'thin', kind: 'line', start: [-2, 0], end: [2, 0] },
    { id: 'ring', styleId: 'bold', kind: 'circle', center: [0, 0], radius: 1 },
  ] },
  { id: 'assembly', basePoint: [0, 0], entities: [
    { id: 'nested', styleId: 'thin', blockId: 'detail', position: [0, 0], scale: [-1, 2, 1], rotationDegrees: 30 },
    { id: 'guide', styleId: 'thin', kind: 'polyline', points: [[-3, -2], [0, 3], [3, -2]], closed: false },
  ] },
])

const intent = overrides => ({
  version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en', drawingId: 'PUBLIC-BLOCK-PLAN', scale: 500,
  boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
  boreholes: [{ id: 'P1', position: [20, 20], collarElevation: 100 }, { id: 'P2', position: [115, 70], collarElevation: 98 }],
  sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
  coordinateGrid: { origin: [0, 0], spacing: 20 },
  baseMapStyles: [
    { id: 'thin', color: 7, lineweight: 18, pattern: [] },
    { id: 'bold', color: 2, lineweight: 35, pattern: [1, -0.5] },
  ],
  baseMapBlocks: sourceBackedBlocks(),
  baseMapInserts: [
    { id: 'instance-a', styleId: 'thin', blockId: 'assembly', position: [50, 40], scale: [1.5, 0.5, 1], rotationDegrees: 15 },
    { id: 'instance-b', styleId: 'bold', blockId: 'detail', position: [100, 60], scale: [2, 2, 1], rotationDegrees: -20 },
  ],
  ...overrides,
})

test('ordinary geology-plan MCP preserves recursive source-backed blocks and reflected inserts through approval, KJD and DXF', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const definition = session.definitions.find(tool => tool.name === 'cad_propose_geology_plan')
  assert.equal(definition.inputSchema.properties.baseMapBlocks.maxItems, 64)
  assert.equal(definition.inputSchema.properties.baseMapInserts.maxItems, 512)
  const result = await session.call('cad_propose_geology_plan', intent())
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.engineeringEvidence.baseMapBlockCount, 2)
  assert.equal(result.value.engineeringEvidence.baseMapBlockMemberCount, 4)
  assert.equal(result.value.engineeringEvidence.baseMapInsertCount, 2)
  assert.equal(document.listEntities().length, 0)
  const receipt = await session.approve(result.value.planId, 'host-reviewer')
  assert.equal(receipt.ok, true, JSON.stringify(receipt))
  assert.equal(document.listEntities().filter(entity => entity.payload.semanticRole === 'source-backed-base-map-insert').length, 2)
  assert.equal(document.listEntities().filter(entity => entity.payload.semanticRole === 'source-backed-base-map-block-insert').length, 1)
  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const reopened of [await sdk.readDocument(kjd, { format: 'KJD' }), await sdk.readDocument(dxf, { format: 'DXF' })]) {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  }
  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (python && pythonPath) {
    const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-blocks-'))
    try {
      const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py')
      await writeFile(dxfPath, dxf)
      await writeFile(auditPath, 'import ezdxf,json,sys\nd=ezdxf.readfile(sys.argv[1]);a=d.audit();m=d.modelspace();blocks=[b for b in d.blocks if b.name.startswith("BASEMAP_BLOCK_")];print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"modelInserts":len(m.query("INSERT")),"blocks":len(blocks),"nestedInserts":sum(len(b.query("INSERT")) for b in blocks)}))\n')
      const audit = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } })
      assert.equal(audit.status, 0, audit.stderr)
      assert.deepEqual(JSON.parse(audit.stdout), { errors: 0, fixes: 0, modelInserts: 2, blocks: 2, nestedInserts: 1 })
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('geology-plan blocks reject unknown, cyclic, unused, attributed or zero-scale source facts before proposal', async () => {
  const invalid = [
    intent({ baseMapInserts: [{ id: 'bad', styleId: 'thin', blockId: 'missing', position: [50, 40], scale: [1, 1, 1], rotationDegrees: 0 }] }),
    intent({ baseMapBlocks: [{ id: 'cycle', basePoint: [0, 0], entities: [{ id: 'nested', styleId: 'thin', blockId: 'cycle', position: [0, 0], scale: [1, 1, 1], rotationDegrees: 0 }] }], baseMapInserts: [{ id: 'bad', styleId: 'thin', blockId: 'cycle', position: [50, 40], scale: [1, 1, 1], rotationDegrees: 0 }] }),
    intent({ baseMapBlocks: [...sourceBackedBlocks(), { id: 'unused', basePoint: [0, 0], entities: [{ id: 'line', styleId: 'thin', kind: 'line', start: [0, 0], end: [1, 0] }] }] }),
    intent({ baseMapInserts: [{ id: 'bad', styleId: 'thin', blockId: 'detail', position: [50, 40], scale: [1, 0, 1], rotationDegrees: 0 }] }),
    intent({ baseMapInserts: [{ id: 'bad', styleId: 'thin', blockId: 'detail', position: [50, 40], scale: [1, 1, 1], rotationDegrees: 0, attributes: { tag: 'forbidden' } }] }),
  ]
  for (const value of invalid) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
    const result = await session.call('cad_propose_geology_plan', value)
    assert.equal(result.ok, false)
    assert.equal(document.listEntities().length, 0)
  }
})
