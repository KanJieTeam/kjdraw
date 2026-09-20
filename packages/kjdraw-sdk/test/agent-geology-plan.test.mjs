import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildAgentGeologyPlan, createKJDrawSDK, KJDRAW_GEOLOGY_PLAN_VERSION, KJDocument, KJValidationError } from '../src/index.js'

function intent(patch = {}) {
  return {
    version: KJDRAW_GEOLOGY_PLAN_VERSION,
    expectedRevision: 0,
    units: 'meter',
    locale: 'zh-CN',
    drawingId: 'SURVEY-PLAN-001',
    title: '勘探点平面位置图',
    revision: 'A',
    scale: 500,
    boundary: [[385000, 3452000], [385140, 3452000], [385140, 3452090], [385000, 3452090]],
    boreholes: [
      { id: 'ZK01', position: [385020, 3452020], collarElevation: 421.35, depth: 30 },
      { id: 'ZK02', position: [385070, 3452035], collarElevation: 420.82, depth: 28.5 },
      { id: 'ZK03', position: [385115, 3452070], collarElevation: 419.96, depth: 32 },
    ],
    sectionLines: [
      { id: 'section-1', holeIds: ['ZK01', 'ZK02', 'ZK03'], label: "1—1′", endpointLabels: ['1', "1′"] },
      { id: 'section-2', holeIds: ['ZK01', 'ZK03'], label: "2—2′", endpointLabels: ['2', "2′"] },
    ],
    coordinateGrid: { origin: [385000, 3452000], spacing: 20 },
    northAngleDegrees: -6,
    ...patch,
  }
}

test('geology plan compiles true coordinates, investigation points and explicit section references deterministically', () => {
  const document = KJDocument.create({ documentId: 'geology-plan-deterministic', units: 'meter' })
  const first = buildAgentGeologyPlan(document, intent()), second = buildAgentGeologyPlan(document, intent())
  assert.deepEqual(first, second)
  assert.equal(first.evidence.skillId, 'geology-plan')
  assert.equal(first.evidence.boreholeCount, 3)
  assert.equal(first.evidence.sectionLineCount, 2)
  assert.equal(first.evidence.sectionReferences[0].id, 'section-1')
  assert.deepEqual(first.evidence.sectionReferences[0].holeIds, ['ZK01', 'ZK02', 'ZK03'])
  assert.deepEqual(first.evidence.coordinateBounds, { minimum: [385000, 3452000], maximum: [385140, 3452090] })
  assert.equal(first.outputConfig.scaleDenominator, 500)
  assert.equal(first.outputConfig.viewport.width, 195)
  assert.equal(first.outputConfig.viewport.height, 125)

  const entities = first.commandArgs.entities
  assert.equal(entities.filter(entity => entity.payload.semanticRole === 'investigation-point').length, 3)
  assert.equal(entities.filter(entity => entity.payload.semanticRole === 'section-line').length, 2)
  assert.equal(entities.filter(entity => entity.payload.semanticRole === 'section-reference').length, 4)
  const sectionReferences = entities.filter(entity => entity.payload.sourceId === 'section-1' && entity.payload.semanticRole === 'section-reference')
  assert.deepEqual(sectionReferences.map(entity => [entity.payload.endpoint, entity.payload.text]), [['start', '1'], ['end', "1′"]])
  assert.equal(entities.some(entity => entity.payload.semanticRole === 'section-reference' && entity.payload.text === "1—1′"), false)
  assert.equal(entities.filter(entity => entity.payload.semanticRole === 'north-arrow').length, 1)
  assert.equal(entities.filter(entity => entity.payload.semanticRole === 'coordinate-grid-easting').length, 8)
  assert.equal(entities.filter(entity => entity.payload.semanticRole === 'coordinate-grid-northing').length, 5)
  const firstSection = entities.find(entity => entity.payload.sourceId === 'section-1' && entity.payload.semanticRole === 'section-line')
  assert.deepEqual(firstSection.payload.vertices, [[385020, 3452020, 0], [385070, 3452035, 0], [385115, 3452070, 0]])
  const labels = entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['ZK01', 'H=421.35  D=30', 'E 385000', 'N 3452000', '比例 1:500', '北']) assert.ok(labels.some(value => String(value).includes(expected)), expected)
  assert.equal(new Set(entities.map(entity => entity.options.id)).size, entities.length)
})

test('geology plan clips section lines to supplied marker envelopes and preserves supplied tails and label positions', () => {
  const document = KJDocument.create({ documentId: 'geology-plan-section-envelope', units: 'meter' })
  const compiled = buildAgentGeologyPlan(document, intent({
    boundary: [[0, 0], [100, 0], [100, 80], [0, 80]],
    boreholes: [
      { id: 'P1', position: [20, 40], collarElevation: 100, depth: 20 },
      { id: 'P2', position: [50, 40], collarElevation: 99.5, depth: 22 },
      { id: 'P3', position: [80, 40], collarElevation: 99, depth: 24 },
    ],
    sectionLines: [{
      id: 'section-explicit', holeIds: ['P1', 'P2', 'P3'], label: "A—A'", endpointLabels: ['A', "A'"],
      markerClearance: [4, 3], endpointTailLengths: [6, 8], endpointLabelPositions: [[8, 48], [94, 48]],
    }],
    coordinateGrid: { origin: [0, 0], spacing: 20 },
    northAngleDegrees: 0,
  }))
  const segments = compiled.commandArgs.entities.filter(entity => entity.payload.sourceId === 'section-explicit' && entity.payload.semanticRole === 'section-line')
  assert.deepEqual(segments.map(entity => [entity.payload.segmentRole, entity.payload.vertices]), [
    ['between-points', [[24, 40, 0], [46, 40, 0]]],
    ['between-points', [[54, 40, 0], [76, 40, 0]]],
    ['start-tail', [[10, 40, 0], [16, 40, 0]]],
    ['end-tail', [[84, 40, 0], [92, 40, 0]]],
  ])
  const labels = compiled.commandArgs.entities.filter(entity => entity.payload.sourceId === 'section-explicit' && entity.payload.semanticRole === 'section-reference')
  assert.deepEqual(labels.map(entity => [entity.payload.endpoint, entity.payload.position, entity.payload.text]), [
    ['start', [8, 48, 0], 'A'], ['end', [94, 48, 0], "A'"],
  ])
  assert.deepEqual(compiled.evidence.sectionReferences[0].markerClearance, [4, 3])
  assert.deepEqual(compiled.evidence.sectionReferences[0].endpointTailLengths, [6, 8])
  assert.deepEqual(compiled.evidence.sectionReferences[0].endpointLabelPositions, [[8, 48], [94, 48]])
  assert.equal(compiled.evidence.sectionReferences[0].segmentCount, 4)
})
test('geology plan is one atomic CREATEBATCH and survives undo, redo, KJD and DXF reopen', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'geology-plan-roundtrip', units: 'meter' })
  const compiled = buildAgentGeologyPlan(document, intent())
  const created = await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  assert.equal(created.length, compiled.evidence.entityCount)
  assert.equal(document.listEntities().length, compiled.evidence.entityCount)
  assert.equal(document.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(value => value?.name === compiled.outputConfig.layoutName)
  assert.ok(layout)
  assert.equal(layout.payload.dxfPlotSettings.paperWidth, 420)
  assert.equal(layout.payload.dxfPlotSettings.paperHeight, 297)
  const viewport = document.listEntities({ ownerId: layout.payload.blockRecordId, type: 'VIEWPORT' })[0]
  assert.equal(viewport.payload.height / viewport.payload.viewHeight, 2)
  await sdk.executeCommand('UNDO', {}, { document }); assert.equal(document.listEntities().length, 0)
  await sdk.executeCommand('REDO', {}, { document }); assert.equal(document.listEntities().length, compiled.evidence.entityCount)

  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD' })
  const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF' })
  assert.equal(reopenedKjd.validate().valid, true)
  assert.equal(reopenedKjd.listEntities().length, compiled.evidence.entityCount)
  assert.equal(reopenedDxf.validate().valid, true)
  assert.equal(reopenedDxf.listEntities({ ownerId: reopenedDxf.snapshot().spaces.modelSpaceId }).length, compiled.evidence.modelEntityCount)
  assert.equal(reopenedDxf.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  const reopenedSections = reopenedDxf.listEntities({ ownerId: reopenedDxf.snapshot().spaces.modelSpaceId, type: 'LWPOLYLINE' }).filter(entity => entity.payload.vertices.length === 3 && entity.payload.closed !== true)
  assert.ok(reopenedSections.some(entity => JSON.stringify(entity.payload.vertices.map(vertex => vertex.point)) === JSON.stringify([[385020, 3452020, 0], [385070, 3452035, 0], [385115, 3452070, 0]])))

  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (!python || !pythonPath) return
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-'))
  try {
    const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py')
    await writeFile(dxfPath, dxf)
    await writeFile(auditPath, 'import ezdxf, json, sys\ndoc=ezdxf.readfile(sys.argv[1]); audit=doc.audit(); msp=doc.modelspace(); print(json.dumps({"errors":len(audit.errors),"fixes":len(audit.fixes),"points":len(msp.query("CIRCLE")),"sections":len([e for e in msp.query("LWPOLYLINE") if len(e.get_points())==3 and not e.closed])}))\n')
    const result = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { errors: 0, fixes: 0, points: 3, sections: 1 })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('geology plan fails closed on stale revisions, unsafe coordinates and broken section references', async () => {
  const document = KJDocument.create({ documentId: 'geology-plan-invalid', units: 'meter' })
  const rejects = (patch, pattern) => assert.throws(() => buildAgentGeologyPlan(document, intent(patch)), error => error instanceof KJValidationError && pattern.test(error.message))
  rejects({ expectedRevision: 1 }, /does not match/)
  rejects({ scale: 333 }, /must be one of/)
  rejects({ boundary: [[0, 0], [10, 10], [0, 10], [10, 0]] }, /self-intersect|positive area/)
  rejects({ boreholes: [{ ...intent().boreholes[0], position: [0, 0] }, intent().boreholes[1]] }, /inside the boundary/)
  rejects({ boreholes: [intent().boreholes[0], { ...intent().boreholes[1], id: 'ZK01' }] }, /duplicate id/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'missing'], label: 'X—X′' }] }, /unknown borehole/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK01'], label: 'X—X′' }] }, /must not repeat/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', endpointLabels: ['X'] }] }, /exactly 2 labels/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', markerClearance: [4] }] }, /exactly two values/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', markerClearance: [30, 30] }] }, /leaves no visible segment/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', endpointTailLengths: [-1, 2] }] }, /finite number from 0/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', endpointLabelPositions: [[385010, 3452010]] }] }, /exactly 2 points/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', endpointLabelPositions: [[0, 0], [385050, 3452040]] }] }, /declared model viewport/)
  rejects({ coordinateGrid: { origin: [385000, 3452000], spacing: 1 } }, /more than 80 grid lines/)
  rejects({ boundary: [[385000, 3452000], [385300, 3452000], [385300, 3452200], [385000, 3452200]] }, /does not fit ISO A3/)
  assert.throws(() => buildAgentGeologyPlan(KJDocument.create({ units: 'millimeter' }), intent()), /meter units/)
  const sdk = createKJDrawSDK(), nonBlank = sdk.createDocument({ units: 'meter' })
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [0, 0, 0] } }, { document: nonBlank })
  assert.throws(() => buildAgentGeologyPlan(nonBlank, intent({ expectedRevision: 1 })), /blank document/)
})
