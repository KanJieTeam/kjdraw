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
  const defaultPointLabels = entities.filter(entity => entity.type === 'TEXT' && entity.payload.sourceId === 'ZK01')
  assert.deepEqual(defaultPointLabels.map(entity => [entity.payload.semanticRole, entity.payload.text, entity.payload.position, entity.payload.height, entity.payload.rotation, Object.hasOwn(entity.payload, 'sourceBacked')]), [
    ['investigation-point-label', 'ZK01', [385021.375, 3452020.3125, 0], 1.25, 0, false],
    ['investigation-point-facts', 'H=421.35  D=30', [385021.375, 3452018.75, 0], 0.95, 0, false],
  ])
  const labels = entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['ZK01', 'H=421.35  D=30', 'E 385000', 'N 3452000', '比例 1:500', '北']) assert.ok(labels.some(value => String(value).includes(expected)), expected)
  assert.equal(new Set(entities.map(entity => entity.options.id)).size, entities.length)
})

test('geology plan preserves supplied investigation-point label positions, precision and degree rotation through KJD and DXF', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'geology-plan-source-labels', units: 'meter' })
  const source = intent()
  source.boreholes[0] = {
    ...source.boreholes[0],
    labelLayout: {
      idPosition: [385015.25, 3452025.75],
      collarElevationPosition: [385015.5, 3452018.25],
      depthPosition: [385015.5, 3452015.75],
      textHeight: 1.35,
      rotationDegrees: 30,
      precision: 3,
    },
  }
  const compiled = buildAgentGeologyPlan(document, source)
  const labels = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT' && entity.payload.sourceId === 'ZK01')
  assert.deepEqual(labels.map(entity => [entity.payload.semanticRole, entity.payload.text, entity.payload.position, entity.payload.height, entity.payload.rotation, entity.payload.sourceBacked]), [
    ['investigation-point-label', 'ZK01', [385015.25, 3452025.75, 0], 1.35, Math.PI / 6, true],
    ['investigation-point-collar-elevation', '421.350', [385015.5, 3452018.25, 0], 1.35, Math.PI / 6, true],
    ['investigation-point-depth', '30.000', [385015.5, 3452015.75, 0], 1.35, Math.PI / 6, true],
  ])
  assert.equal(labels.some(entity => entity.payload.semanticRole === 'investigation-point-facts'), false)
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD' })
  const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF' })
  const texts = ['ZK01', '421.350', '30.000']
  for (const reopened of [reopenedKjd, reopenedDxf]) {
    assert.equal(reopened.validate().valid, true)
    const reopenedLabels = reopened.listEntities({ type: 'TEXT' }).filter(entity => texts.includes(entity.payload.text))
    assert.equal(reopenedLabels.length, 3)
    for (const entity of reopenedLabels) assert.ok(Math.abs(entity.payload.rotation - Math.PI / 6) <= 1e-12)
  }
  const python = process.env.KJDRAW_PYTHON, pythonPath = process.env.KJDRAW_EZDXF_PATH
  if (!python || !pythonPath) return
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-geology-plan-labels-'))
  try {
    const dxfPath = join(root, 'plan.dxf'), auditPath = join(root, 'audit.py')
    await writeFile(dxfPath, dxf)
    await writeFile(auditPath, 'import ezdxf, json, sys\ndoc=ezdxf.readfile(sys.argv[1]); audit=doc.audit(); texts=[e.dxf.text for e in doc.modelspace().query("TEXT")]; print(json.dumps({"errors":len(audit.errors),"fixes":len(audit.fixes),"labels":sum(value in texts for value in ["ZK01","421.350","30.000"])}))\n')
    const result = spawnSync(python, [auditPath, dxfPath], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: pythonPath } })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { errors: 0, fixes: 0, labels: 3 })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('geology plan compiles explicit point callouts with engineering X northing and Y easting without inventing a grid', () => {
  const document = KJDocument.create({ documentId: 'geology-plan-coordinate-callouts', units: 'meter' })
  const source = intent()
  delete source.coordinateGrid
  source.coordinateCallouts = [{
    id: 'control-1', point: [385000, 3452000], elbow: [384990, 3451990], landingEnd: [384980, 3451990],
    xLabelPosition: [384981, 3451992], yLabelPosition: [384981, 3451987], precision: 3, textHeight: 1.8,
  }]
  const compiled = buildAgentGeologyPlan(document, source)
  const leaders = compiled.commandArgs.entities.filter(entity => entity.payload.semanticRole === 'coordinate-callout-leader')
  const labels = compiled.commandArgs.entities.filter(entity => entity.payload.semanticRole === 'coordinate-callout-label')
  assert.deepEqual(leaders.map(entity => [entity.type, entity.payload.segmentRole, entity.payload.start, entity.payload.end]), [
    ['LINE', 'point-to-elbow', [385000, 3452000, 0], [384990, 3451990, 0]],
    ['LINE', 'elbow-to-landing', [384990, 3451990, 0], [384980, 3451990, 0]],
  ])
  assert.deepEqual(labels.map(entity => [entity.payload.coordinateAxis, entity.payload.text, entity.payload.position, entity.payload.height]), [
    ['X', 'X=3452000.000', [384981, 3451992, 0], 1.8],
    ['Y', 'Y=385000.000', [384981, 3451987, 0], 1.8],
  ])
  assert.equal(compiled.commandArgs.entities.some(entity => String(entity.payload.semanticRole).startsWith('coordinate-grid-')), false)
  assert.equal(compiled.evidence.gridLineCount, 0)
  assert.equal(compiled.evidence.coordinateCalloutCount, 1)
  assert.equal(compiled.evidence.coordinateConvention, 'engineering X=northing, Y=easting')
})

test('geology plan compiles supplied aligned dimension facts without inferring measurements or arbitrary text', () => {
  const document = KJDocument.create({ documentId: 'geology-plan-dimensions', units: 'meter' })
  const compiled = buildAgentGeologyPlan(document, intent({ dimensions: [
    { id: 'dimension-a', dimensionLinePoint: [385025, 3452004], firstExtensionOrigin: [385010, 3452010], secondExtensionOrigin: [385040, 3452010], textPosition: [385025, 3452004], displayValue: 30, precision: 2, unitSuffix: 'M' },
    { id: 'dimension-b', dimensionLinePoint: [385050, 3452025], firstExtensionOrigin: [385050, 3452010], secondExtensionOrigin: [385080, 3452010], displayValue: 24.5, precision: 1 },
  ] }))
  const dimensions = compiled.commandArgs.entities.filter(entity => entity.payload.semanticRole === 'site-dimension')
  assert.deepEqual(dimensions.map(entity => [entity.type, entity.payload.sourceId, entity.payload.definitionPoints, entity.payload.textPosition, entity.payload.textOverride, entity.payload.sourceBacked]), [
    ['DIMENSION', 'dimension-a', [[385025, 3452004, 0], [385010, 3452010, 0], [385040, 3452010, 0]], [385025, 3452004, 0], '30.00M', true],
    ['DIMENSION', 'dimension-b', [[385050, 3452025, 0], [385050, 3452010, 0], [385080, 3452010, 0]], [385050, 3452025, 0], '24.5', true],
  ])
  assert.equal(compiled.evidence.alignedDimensionCount, 2)
  assert.ok(compiled.evidence.limitations.some(value => value.includes('does not infer measurements')))
})

test('geology plan compiles only explicitly supplied closed building footprints as source-backed context', () => {
  const document = KJDocument.create({ documentId: 'geology-plan-buildings', units: 'meter' })
  const compiled = buildAgentGeologyPlan(document, intent({
    buildingFootprints: [
      { id: 'building-a', outline: [[385010, 3452010], [385035, 3452015], [385030, 3452030], [385005, 3452025], [385010, 3452010]] },
      { id: 'building-b', outline: [[385090, 3452040], [385115, 3452040], [385115, 3452060], [385090, 3452060]] },
    ],
  }))
  const footprints = compiled.commandArgs.entities.filter(entity => entity.payload.semanticRole === 'building-footprint')
  assert.deepEqual(footprints.map(entity => [entity.payload.sourceId, entity.payload.closed, entity.payload.sourceBacked]), [
    ['building-a', true, true], ['building-b', true, true],
  ])
  assert.deepEqual(footprints[0].payload.vertices, [[385010, 3452010, 0], [385035, 3452015, 0], [385030, 3452030, 0], [385005, 3452025, 0]])
  assert.equal(compiled.evidence.buildingFootprintCount, 2)
  assert.deepEqual(compiled.evidence.externalBaseMapDependencies, ['roads', 'terrain', 'landscaping', 'other-context'])
  assert.ok(compiled.evidence.limitations.some(value => value.includes('never inferred')))
})
test('geology plan compiles only explicit continuous source-backed road line and arc facts', () => {
  const document = KJDocument.create({ documentId: 'geology-plan-roads', units: 'meter' })
  const compiled = buildAgentGeologyPlan(document, intent({
    roadPaths: [{
      id: 'road-edge-a', start: [385010, 3452050],
      segments: [
        { kind: 'line', end: [385030, 3452050] },
        { kind: 'arc', center: [385030, 3452060], end: [385040, 3452060], clockwise: false },
      ],
    }],
  }))
  const roads = compiled.commandArgs.entities.filter(entity => entity.payload.semanticRole === 'road-path-segment')
  assert.deepEqual(roads.map(entity => [entity.type, entity.payload.segmentKind, entity.payload.segmentIndex, entity.payload.sourceBacked]), [
    ['LINE', 'line', 0, true], ['ARC', 'arc', 1, true],
  ])
  assert.deepEqual([roads[0].payload.start, roads[0].payload.end], [[385010, 3452050, 0], [385030, 3452050, 0]])
  assert.deepEqual([roads[1].payload.center, roads[1].payload.radius, roads[1].payload.clockwise], [[385030, 3452060, 0], 10, false])
  assert.ok(Math.abs(roads[1].payload.startAngle - Math.PI * 1.5) <= 1e-12)
  assert.ok(Math.abs(roads[1].payload.endAngle) <= 1e-12)
  assert.equal(compiled.evidence.roadPathCount, 1)
  assert.equal(compiled.evidence.roadSegmentCount, 2)
  assert.deepEqual(compiled.evidence.externalBaseMapDependencies, ['terrain', 'landscaping', 'other-context'])
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
  rejects({ boreholes: [{ ...intent().boreholes[0], labelLayout: { idPosition: [385020, 3452020], collarElevationPosition: [385020, 3452018] } }, ...intent().boreholes.slice(1)] }, /depthPosition is required/)
  rejects({ boreholes: [{ id: 'ZK01', position: [385020, 3452020], collarElevation: 421.35, labelLayout: { idPosition: [385020, 3452020], collarElevationPosition: [385020, 3452018], depthPosition: [385020, 3452016] } }, ...intent().boreholes.slice(1)] }, /requires a supplied depth/)
  rejects({ boreholes: [{ ...intent().boreholes[0], labelLayout: { idPosition: [0, 0], collarElevationPosition: [385020, 3452018], depthPosition: [385020, 3452016] } }, ...intent().boreholes.slice(1)] }, /declared model viewport/)
  rejects({ boreholes: [{ ...intent().boreholes[0], labelLayout: { idPosition: [385020, 3452020], collarElevationPosition: [385020, 3452018], depthPosition: [385020, 3452016], precision: 7 } }, ...intent().boreholes.slice(1)] }, /finite number from 0 to 6/)
  rejects({ boreholes: [{ ...intent().boreholes[0], labelLayout: { idPosition: [385020, 3452020], collarElevationPosition: [385020, 3452018], depthPosition: [385020, 3452016], invented: true } }, ...intent().boreholes.slice(1)] }, /unsupported field/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'missing'], label: 'X—X′' }] }, /unknown borehole/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK01'], label: 'X—X′' }] }, /must not repeat/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', endpointLabels: ['X'] }] }, /exactly 2 labels/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', markerClearance: [4] }] }, /exactly two values/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', markerClearance: [30, 30] }] }, /leaves no visible segment/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', endpointTailLengths: [-1, 2] }] }, /finite number from 0/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', endpointLabelPositions: [[385010, 3452010]] }] }, /exactly 2 points/)
  rejects({ sectionLines: [{ id: 'bad', holeIds: ['ZK01', 'ZK02'], label: 'X—X′', endpointLabelPositions: [[0, 0], [385050, 3452040]] }] }, /declared model viewport/)
  rejects({ buildingFootprints: [{ id: 'bad', outline: [[385010, 3452010], [385030, 3452030], [385010, 3452030], [385030, 3452010]] }] }, /self-intersect|positive area/)
  rejects({ buildingFootprints: [{ id: 'outside', outline: [[384990, 3452010], [385010, 3452010], [385010, 3452030], [384990, 3452030]] }] }, /inside the boundary/)
  rejects({ buildingFootprints: [{ id: 'same', outline: [[385010, 3452010], [385030, 3452010], [385030, 3452030], [385010, 3452030]] }, { id: 'same', outline: [[385040, 3452040], [385060, 3452040], [385060, 3452060], [385040, 3452060]] }] }, /duplicate id/)
  rejects({ roadPaths: [{ id: 'bad-radius', start: [385010, 3452050], segments: [{ kind: 'arc', center: [385020, 3452050], end: [385020, 3452070] }] }] }, /share one positive radius/)
  rejects({ roadPaths: [{ id: 'zero', start: [385010, 3452050], segments: [{ kind: 'line', end: [385010, 3452050] }] }] }, /positive length/)
  rejects({ roadPaths: [{ id: 'closure', start: [385010, 3452050], segments: [{ kind: 'line', end: [385030, 3452050] }], closed: true }] }, /closed flag/)
  rejects({ coordinateGrid: { origin: [385000, 3452000], spacing: 1 } }, /more than 80 grid lines/)
  rejects({ coordinateGrid: undefined }, /exactly one coordinate strategy/)
  rejects({ coordinateCallouts: [{ id: 'both', point: [385000, 3452000], elbow: [384990, 3451990], landingEnd: [384980, 3451990], xLabelPosition: [384981, 3451992], yLabelPosition: [384981, 3451987] }] }, /exactly one coordinate strategy/)
  rejects({ coordinateGrid: undefined, coordinateCallouts: [{ id: 'zero', point: [385000, 3452000], elbow: [385000, 3452000], landingEnd: [384980, 3451990], xLabelPosition: [384981, 3451992], yLabelPosition: [384981, 3451987] }] }, /positive length/)
  rejects({ coordinateGrid: undefined, coordinateCallouts: [{ id: 'outside', point: [385000, 3452000], elbow: [0, 0], landingEnd: [384980, 3451990], xLabelPosition: [384981, 3451992], yLabelPosition: [384981, 3451987] }] }, /declared model viewport/)
  rejects({ dimensions: [{ id: 'zero', dimensionLinePoint: [385020, 3452010], firstExtensionOrigin: [385010, 3452010], secondExtensionOrigin: [385010, 3452010], textPosition: [385020, 3452010], displayValue: 1 }] }, /must be distinct/)
  rejects({ dimensions: [{ id: 'collinear', dimensionLinePoint: [385020, 3452010], firstExtensionOrigin: [385010, 3452010], secondExtensionOrigin: [385030, 3452010], textPosition: [385020, 3452010], displayValue: 20 }] }, /must be offset/)
  rejects({ dimensions: [{ id: 'outside', dimensionLinePoint: [0, 0], firstExtensionOrigin: [385010, 3452010], secondExtensionOrigin: [385030, 3452010], textPosition: [385020, 3452005], displayValue: 20 }] }, /declared model viewport/)
  rejects({ dimensions: [{ id: 'bad-value', dimensionLinePoint: [385020, 3452005], firstExtensionOrigin: [385010, 3452010], secondExtensionOrigin: [385030, 3452010], textPosition: [385020, 3452005], displayValue: -1 }] }, /finite number from/)
  rejects({ dimensions: [{ id: 'bad-suffix', dimensionLinePoint: [385020, 3452005], firstExtensionOrigin: [385010, 3452010], secondExtensionOrigin: [385030, 3452010], textPosition: [385020, 3452005], displayValue: 20, unitSuffix: 'mm' }] }, /none, m or M/)
  rejects({ dimensions: [{ id: 'same', dimensionLinePoint: [385020, 3452005], firstExtensionOrigin: [385010, 3452010], secondExtensionOrigin: [385030, 3452010], textPosition: [385020, 3452005], displayValue: 20 }, { id: 'same', dimensionLinePoint: [385050, 3452005], firstExtensionOrigin: [385040, 3452010], secondExtensionOrigin: [385060, 3452010], textPosition: [385050, 3452005], displayValue: 20 }] }, /duplicate id/)
  rejects({ boundary: [[385000, 3452000], [385300, 3452000], [385300, 3452200], [385000, 3452200]] }, /does not fit ISO A3/)
  assert.throws(() => buildAgentGeologyPlan(KJDocument.create({ units: 'millimeter' }), intent()), /meter units/)
  const sdk = createKJDrawSDK(), nonBlank = sdk.createDocument({ units: 'meter' })
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [0, 0, 0] } }, { document: nonBlank })
  assert.throws(() => buildAgentGeologyPlan(nonBlank, intent({ expectedRevision: 1 })), /blank document/)
})
