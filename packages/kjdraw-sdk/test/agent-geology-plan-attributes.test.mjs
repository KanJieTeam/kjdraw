import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

const attribute = (id, patch = {}) => ({
  id, styleId: 'source', textStyleId: 'source-text', tag: 'CODE', text: 'A-01', position: [70, 45, 0], height: 0.5,
  rotationDegrees: 225, widthFactor: 0.8, obliqueAngleDegrees: -180, horizontalAlignment: 0, verticalAlignment: 0,
  generationFlags: 4, flags: 9, lockPosition: false, extrusion: [0, 0, 1], ...patch,
})

const intent = overrides => ({
  version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en', drawingId: 'PUBLIC-ATTRIBUTE-PLAN', scale: 500,
  boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
  boreholes: [{ id: 'P1', position: [20, 20], collarElevation: 100 }, { id: 'P2', position: [115, 70], collarElevation: 98 }],
  sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
  coordinateGrid: { origin: [0, 0], spacing: 20 },
  baseMapStyles: [{ id: 'source', color: 7, lineweight: 18, pattern: [] }],
  baseMapTextStyles: [{ id: 'source-text', fontFamily: 'sans-serif', fixedHeight: 0, widthFactor: 0.8, obliqueAngleDegrees: 0, dxfFlags: 0, generationFlags: 0, lastHeight: 0.5 }],
  baseMapBlocks: [{ id: 'label-symbol', basePoint: [0, 0], entities: [
    { id: 'axis', styleId: 'source', kind: 'line', start: [-2, 0], end: [2, 0] },
    { ...attribute('definition', { kind: 'attributeDefinition', text: '----', position: [0, 0, 0], rotationDegrees: 0, obliqueAngleDegrees: 0, generationFlags: 0 }), prompt: '' },
  ] }],
  baseMapInserts: [{ id: 'instance', styleId: 'source', blockId: 'label-symbol', position: [-70, 45], scale: [1.2, 0.8, -1], rotationDegrees: 315,
    extrusion: [0, 0, -1], attributes: [attribute('value')] }],
  ...overrides,
})

const signature = document => {
  const insert = document.listEntities({ type: 'INSERT' }).find(entity => Array.isArray(entity.payload.attributeIds) && entity.payload.attributeIds.length > 0)
  const attached = document.listEntities({ type: 'ATTRIB' }).filter(entity => entity.payload.parentInsertId === insert.id)
  const definition = document.listEntities({ type: 'ATTDEF' })[0]
  const sequenceEnd = document.getObject(insert.payload.sequenceEndId)
  return {
    insert: { position: insert.payload.position, scale: insert.payload.scale, rotation: insert.payload.rotation, extrusion: insert.payload.extrusion, attributeCount: insert.payload.attributeIds.length },
    attached: attached.map(entity => ({ parentMatches: entity.payload.parentInsertId === insert.id, tag: entity.payload.tag, text: entity.payload.text, position: entity.payload.position,
      height: entity.payload.height, rotation: entity.payload.rotation, widthFactor: entity.payload.widthFactor, obliqueAngle: entity.payload.obliqueAngle,
      horizontalAlignment: entity.payload.horizontalAlignment, verticalAlignment: entity.payload.verticalAlignment, generationFlags: entity.payload.generationFlags,
      flags: entity.payload.flags, lockPosition: entity.payload.lockPosition, extrusion: entity.payload.extrusion })),
    definition: { tag: definition.payload.tag, text: definition.payload.text, prompt: definition.payload.prompt, flags: definition.payload.flags },
    sequenceEnd: { type: sequenceEnd.type, ownerMatches: sequenceEnd.ownerId === insert.id, dxfOwnerMode: sequenceEnd.payload.dxfOwnerMode },
  }
}

test('ordinary geology-plan MCP preserves complete source-backed ATTDEF and attached ATTRIB sequences through approval, KJD, DXF and official audit', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const schema = session.definitions.find(tool => tool.name === 'cad_propose_geology_plan').inputSchema
  assert.equal(schema.properties.baseMapTextStyles.maxItems, 64)
  assert.equal(schema.properties.baseMapInserts.items.properties.attributes.maxItems, 64)
  assert.ok(schema.properties.baseMapBlocks.items.properties.entities.items.properties.kind.enum.includes('attributeDefinition'))

  const result = await session.call('cad_propose_geology_plan', intent())
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.engineeringEvidence.baseMapTextStyleCount, 1)
  assert.equal(result.value.engineeringEvidence.baseMapAttributeDefinitionCount, 1)
  assert.equal(result.value.engineeringEvidence.baseMapAttributeCount, 1)
  assert.equal(document.listEntities().length, 0)
  assert.equal((await session.approve(result.value.planId, 'host-reviewer')).ok, true)
  const expected = signature(document)
  assert.equal(expected.attached.length, 1)
  assert.equal(expected.attached[0].text, 'A-01')
  assert.equal(expected.sequenceEnd.type, 'SEQEND')
  assert.deepEqual(expected.insert.extrusion, [0, 0, -1])

  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const reopened of [await sdk.readDocument(kjd, { format: 'KJD' }), await sdk.readDocument(dxf, { format: 'DXF' })]) {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
    assert.deepEqual(signature(reopened), expected)
  }

  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (!python || !pythonPath) return t.diagnostic('official ezdxf unavailable; independent check skipped')
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-attributes-'))
  try {
    const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py')
    await writeFile(dxfPath, dxf)
    await writeFile(auditPath, 'import ezdxf,json,sys\nd=ezdxf.readfile(sys.argv[1]);a=d.audit();m=d.modelspace();rows=[]\nfor i in m.query("INSERT"):\n if i.attribs: rows.append({"extrusion":list(i.dxf.extrusion),"attributes":[{"tag":x.dxf.tag,"text":x.dxf.text,"flags":x.dxf.flags,"height":x.dxf.height,"rotation":x.dxf.rotation,"width":x.dxf.width,"oblique":x.dxf.oblique,"generation":x.dxf.text_generation_flag,"extrusion":list(x.dxf.extrusion)} for x in i.attribs]})\nprint(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"rows":rows,"attdefs":sum(len(b.query("ATTDEF")) for b in d.blocks if b.name.startswith("BASEMAP_BLOCK_")),"proxies":len(m.query("ACAD_PROXY_ENTITY"))}))\n')
    const audit = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } })
    assert.equal(audit.status, 0, audit.stderr)
    const report = JSON.parse(audit.stdout)
    assert.equal(report.errors, 0); assert.equal(report.fixes, 0); assert.equal(report.proxies, 0); assert.equal(report.attdefs, 1)
    assert.deepEqual(report.rows[0].extrusion, [0, 0, -1])
    assert.deepEqual(report.rows[0].attributes.map(value => [value.tag, value.text, value.flags, value.generation]), [['CODE', 'A-01', 9, 4]])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('geology-plan attached attributes fail closed on incomplete, unmatched, nested, nonplanar or unused source facts', async () => {
  const invalid = [
    intent({ baseMapInserts: [{ ...intent().baseMapInserts[0], attributes: [attribute('bad', { tag: 'OTHER' })] }] }),
    intent({ baseMapBlocks: [{ id: 'label-symbol', basePoint: [0, 0], entities: [{ ...intent().baseMapInserts[0], id: 'nested' }] }] }),
    intent({ baseMapInserts: [{ ...intent().baseMapInserts[0], extrusion: [1, 0, 0] }] }),
    intent({ baseMapInserts: [{ ...intent().baseMapInserts[0], attributes: [attribute('bad', { position: [500, 500, 0] })] }] }),
    intent({ baseMapTextStyles: [...intent().baseMapTextStyles, { id: 'unused' }] }),
  ]
  for (const value of invalid) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
    const result = await session.call('cad_propose_geology_plan', value)
    assert.equal(result.ok, false)
    assert.equal(document.listEntities().length, 0)
  }
})
