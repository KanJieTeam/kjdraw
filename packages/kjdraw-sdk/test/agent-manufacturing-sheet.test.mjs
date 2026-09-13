import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, KJDocument, KJValidationError } from '../src/index.js'
import {
  KJDRAW_MANUFACTURING_SHEET_VERSION,
  buildAgentManufacturingSheet,
} from '../src/agent-manufacturing-sheet.js'

function complexInput(overrides = {}) {
  return {
    version: KJDRAW_MANUFACTURING_SHEET_VERSION,
    expectedRevision: 0,
    units: 'millimeter',
    drawingId: 'PLATE-240-140-A',
    title: 'PARAMETRIC MACHINED MOUNTING PLATE',
    revision: 'B2',
    material: '6061-T6 ALUMINUM',
    quantity: 12,
    length: 240,
    width: 140,
    thickness: 12,
    holePatterns: [
      { rows: 2, columns: 3, origin: [30, 30], spacing: [90, 80], throughDiameter: 10, counterboreDiameter: 18, counterboreDepth: 5 },
      { rows: 1, columns: 2, origin: [70, 70], spacing: [100, 0], throughDiameter: 6.5 },
    ],
    slots: [
      { center: [120, 40], length: 42, width: 12, orientationDegrees: 0 },
      { center: [120, 100], length: 30, width: 10, orientationDegrees: 90 },
    ],
    sheet: { origin: [15, 25], size: [420, 297] },
    textHeight: 3.5,
    ...overrides,
  }
}

async function executeCompiled(sdk, document, compiled) {
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  return compiled
}

test('manufacturing sheet compiler emits deterministic native drawing entities and bounded evidence', () => {
  const document = KJDocument.create({ documentId: 'manufacturing-complex', units: 'millimeter' })
  const first = buildAgentManufacturingSheet(document, complexInput())
  const second = buildAgentManufacturingSheet(document, complexInput())

  assert.deepEqual(first, second)
  assert.equal(first.evidence.skillVersion, '1.0.0')
  assert.equal(first.evidence.expectedRevision, 0)
  assert.equal(first.evidence.parameters.holeCount, 8)
  assert.equal(first.evidence.parameters.slotCount, 2)
  assert.equal(first.evidence.entityCount, first.commandArgs.entities.length)
  assert.ok(first.evidence.entityCount <= 512)
  assert.deepEqual(first.evidence.bounds.min, [15, 25])
  assert.deepEqual(first.evidence.bounds.max, [435, 322])
  assert.equal(new Set(first.commandArgs.entities.map(entity => entity.options.id)).size, first.evidence.entityCount)
  assert.ok(first.commandArgs.entities.filter(entity => entity.type === 'LWPOLYLINE').length >= 4, 'frame, two views and title block are native polylines')
  assert.ok(first.commandArgs.entities.filter(entity => entity.type === 'ARC').length >= 4, 'slots retain native tangent arcs')
  assert.ok(first.commandArgs.entities.some(entity => entity.type === 'DIMENSION' && entity.payload.dimensionType === 'DIAMETER'))
  assert.ok(first.commandArgs.entities.filter(entity => entity.type === 'DIMENSION').every(entity => entity.payload.textHeight === 3.5))
  const centerLayer = first.commandArgs.resources.layers.find(layer => layer.name === 'CENTER')
  assert.ok(centerLayer)
  assert.ok(first.commandArgs.entities.some(entity => entity.type === 'LINE' && entity.payload.layerId === centerLayer.id))
  assert.ok(first.commandArgs.entities.some(entity => entity.type === 'TEXT' && /MACHINING NOTES/.test(entity.payload.text)))
  assert.deepEqual(first.commandArgs.resources.linetypes.map(item => item.pattern), [[], [8, -1, 1, -1], [3, -1]])
})

test('compiled manufacturing sheet executes through CREATEBATCH and reopens through KJD and DXF', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'manufacturing-roundtrip', units: 'millimeter' })
  const initial = buildAgentManufacturingSheet(document, complexInput())
  const compiled = await executeCompiled(sdk, document, initial)

  assert.equal(document.listEntities().length, compiled.evidence.entityCount)
  assert.ok(document.listEntities({ type: 'DIMENSION' }).length >= 8)
  assert.equal(document.getTable('layers').records.some(layer => layer.name === 'CENTER'), true)
  assert.equal(document.revision, 1)

  await sdk.executeCommand('UNDO', {}, { document })
  assert.equal(document.listEntities().length, 0)
  assert.equal(document.getTable('layers').records.some(layer => layer.name === 'CENTER'), false)
  await sdk.executeCommand('REDO', {}, { document })
  assert.equal(document.listEntities().length, compiled.evidence.entityCount)

  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD', version: '1' })
  assert.equal(reopenedKjd.listEntities().length, compiled.evidence.entityCount)
  assert.deepEqual(reopenedKjd.listEntities().map(entity => entity.id), document.listEntities().map(entity => entity.id))

  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  const modelSpaceId = reopenedDxf.snapshot().spaces.modelSpaceId
  assert.equal(reopenedDxf.listEntities({ ownerId: modelSpaceId }).length, compiled.evidence.entityCount)
  assert.equal(reopenedDxf.listEntities({ ownerId: modelSpaceId, type: 'DIMENSION' }).length, document.listEntities({ type: 'DIMENSION' }).length)
  assert.ok(reopenedDxf.listEntities({ ownerId: modelSpaceId, type: 'DIMENSION' }).some(entity => entity.payload.dimensionType === 'DIAMETER'))
  assert.equal(reopenedDxf.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
})

test('manufacturing sheet compiler rejects stale, unsupported, out-of-bounds and oversized inputs', () => {
  const document = KJDocument.create({ documentId: 'manufacturing-invalid', units: 'millimeter' })
  const rejects = (patch, pattern) => assert.throws(
    () => buildAgentManufacturingSheet(document, complexInput(patch)),
    error => error instanceof KJValidationError && pattern.test(error.message),
  )

  rejects({ version: '2.0.0' }, /version/)
  rejects({ expectedRevision: 1 }, /does not match document revision/)
  rejects({ units: 'inch' }, /units/)
  rejects({ surprise: true }, /unsupported field/)
  rejects({ quantity: 1.5 }, /integer/)
  rejects({ holePatterns: [{ rows: 1, columns: 1, origin: [2, 2], spacing: [0, 0], throughDiameter: 10 }] }, /outside the plate/)
  rejects({ holePatterns: [{ rows: 1, columns: 1, origin: [20, 20], spacing: [0, 0], throughDiameter: 10, counterboreDiameter: 18 }] }, /supplied together/)
  rejects({ slots: [{ center: [120, 70], length: 40, width: 10, orientationDegrees: 45 }] }, /0 or 90/)
  rejects({ length: 2_000, width: 1_000 }, /1:1 model-space scale/)
  rejects({
    holePatterns: [{ rows: 8, columns: 16, origin: [10, 10], spacing: [14, 17], throughDiameter: 6, counterboreDiameter: 20, counterboreDepth: 5 }],
    slots: [],
  }, /maximum is 512/)

  const inchDocument = KJDocument.create({ documentId: 'manufacturing-inch', units: 'inch' })
  assert.throws(() => buildAgentManufacturingSheet(inchDocument, complexInput()), /millimeter document/)
})
