import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, KJValidationError, createKJDrawSDK } from '../src/index.js'
import { buildAgentAnnotationEntities } from '../src/agent-annotations.js'
import { projectDimension } from '../src/geometry/annotation.js'

const ref = (id, feature) => ({ source: 'document', id, ...(feature ? { feature } : {}) })
const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
const measurement = (drawing, id) => projectDimension(drawing.getObject(id).payload, drawing.getObject(String(drawing.getObject(id).payload.styleId ?? ''))?.payload).measurement

async function lineFixture() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'associative-linear', units: 'millimeter' })
  const style = await sdk.executeCommand('DIMSTYLE', { name: 'Engineering', properties: { textHeight: 3, decimalPlaces: 4 } })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0], color: 3, lineweight: 25 } })
  const [spec] = buildAgentAnnotationEntities(drawing, {
    expectedRevision: drawing.revision, units: 'millimeter', texts: [],
    dimensions: [{ type: 'ALIGNED', from: ref(line.id, 'start'), to: ref(line.id, 'end'), position: { x: 5, y: 8 }, height: 3 }],
  })
  const [dimension] = await sdk.executeCommand('CREATEBATCH', { entities: [{ ...spec, payload: { ...spec.payload, styleId: style.id, precision: 4 } }] })
  return { sdk, drawing, line, dimension, style }
}

test('associative linear dimensions update atomically across every 1.0 geometry edit path', async () => {
  const { sdk, drawing, line, dimension, style } = await lineFixture()
  const identity = { id: dimension.id, handle: dimension.handle, styleId: style.id, precision: 4 }
  assert.equal(measurement(drawing, dimension.id), 10)

  await sdk.executeCommand('LENGTHEN', { id: line.id, totalLength: 20, endpoint: 'end' })
  assert.equal(measurement(drawing, dimension.id), 20)
  await sdk.executeCommand('STRETCH', { id: line.id, crossingStart: [19, -1], crossingEnd: [21, 1], dx: 5, dy: 0 })
  assert.equal(measurement(drawing, dimension.id), 25)
  await sdk.executeCommand('PROPERTIES', { id: line.id, patch: { payload: { end: [30, 0, 0] } } })
  assert.equal(measurement(drawing, dimension.id), 30)
  await sdk.executeCommand('MOVE', { id: line.id, dx: 2, dy: 3 })
  assert.deepEqual(drawing.getObject(dimension.id).payload.definitionPoints, [[5, 8, 0], [2, 3, 0], [32, 3, 0]])
  await sdk.executeCommand('ROTATE', { id: line.id, center: [2, 3], angleDegrees: 30 })
  assert.equal(measurement(drawing, dimension.id), 30)
  await sdk.executeCommand('SCALE', { id: line.id, center: [2, 3], factor: 2 })
  close(measurement(drawing, dimension.id), 60)

  const current = drawing.getObject(dimension.id)
  assert.deepEqual({ id: current.id, handle: current.handle, styleId: current.payload.styleId, precision: current.payload.precision }, identity)
  assert.equal(current.payload.textOverride, null)
  const scaled = structuredClone(current.payload.definitionPoints)
  await sdk.executeCommand('UNDO'); close(measurement(drawing, dimension.id), 30)
  await sdk.executeCommand('REDO'); close(measurement(drawing, dimension.id), 60)
  assert.deepEqual(drawing.getObject(dimension.id).payload.definitionPoints, scaled)
})

test('radius, diameter and angular associations survive KJD and export updated native DXF geometry', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'associative-native-types', units: 'millimeter' })
  await drawing.transact('Referenced geometry', tx => {
    tx.createEntity('CIRCLE', { center: [0, 0], radius: 5 }, { id: 'circle' })
    tx.createEntity('CIRCLE', { center: [0, 0], radius: 1 }, { id: 'center' })
    tx.createEntity('LINE', { start: [0, 0], end: [10, 0] }, { id: 'ray-a' })
    tx.createEntity('LINE', { start: [0, 0], end: [0, 10] }, { id: 'ray-b' })
  })
  const specs = buildAgentAnnotationEntities(drawing, {
    expectedRevision: drawing.revision, units: 'millimeter', texts: [], dimensions: [
      { type: 'RADIUS', source: ref('circle'), directionDegrees: 0, position: { x: 8, y: 4 }, height: 2.5 },
      { type: 'DIAMETER', source: ref('circle'), directionDegrees: 90, position: { x: 8, y: 8 }, height: 2.5 },
      { type: 'ANGULAR_3_POINT', center: ref('center', 'center'), first: ref('ray-a', 'end'), second: ref('ray-b', 'end'), position: { x: 4, y: 2 }, height: 2.5 },
    ],
  })
  const dimensions = await sdk.executeCommand('CREATEBATCH', { entities: specs })
  await sdk.executeCommand('PROPERTIES', { id: 'circle', patch: { payload: { radius: 8 } } })
  await sdk.executeCommand('PROPERTIES', { id: 'ray-b', patch: { payload: { end: [10, 10, 0] } } })
  assert.deepEqual(dimensions.map(item => Number(measurement(drawing, item.id).toFixed(8))), [8, 16, 45])

  const serialized = drawing.serialize(), reopened = KJDocument.open(serialized)
  assert.deepEqual(reopened.getObject(dimensions[0].id).payload.dimensionAssociations, drawing.getObject(dimensions[0].id).payload.dimensionAssociations)
  const tampered = JSON.parse(serialized)
  tampered.objects[dimensions[0].id].payload.dimensionAssociations[0].entityId = 'missing-source'
  assert.throws(() => KJDocument.open(tampered), KJValidationError)
  await sdk.executeCommand('SCALE', { id: 'circle', center: [0, 0], factor: 2 }, { document: reopened })
  assert.deepEqual(dimensions.map(item => Number(measurement(reopened, item.id).toFixed(8))), [16, 32, 45])

  const dxf = await sdk.writeDocument(reopened, { format: 'DXF', version: '2018' })
  const dxfReopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const dxfDimensions = dxfReopened.listEntities({ type: 'DIMENSION' })
  assert.deepEqual(dxfDimensions.map(item => Number(projectDimension(item.payload).measurement.toFixed(8))), [16, 32, 45])
  assert.ok(dxfDimensions.slice(0, 2).every(item => Array.isArray(item.payload.dimensionAssociations)))
  const dxfCircle = dxfReopened.listEntities({ type: 'CIRCLE' }).find(item => item.payload.radius === 16)
  assert.ok(dxfCircle)
  await sdk.executeCommand('PROPERTIES', { id: dxfCircle.id, patch: { payload: { radius: 20 } } }, { document: dxfReopened })
  assert.deepEqual(dxfDimensions.slice(0, 2).map(item => Number(measurement(dxfReopened, item.id).toFixed(8))), [20, 40])
})

test('arc endpoint associations follow native LENGTHEN without replacing the dimension', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'associative-arc', units: 'millimeter' })
  const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [0, 0], radius: 10, startAngle: 0, endAngle: Math.PI / 2 } })
  const [spec] = buildAgentAnnotationEntities(drawing, {
    expectedRevision: drawing.revision, units: 'millimeter', texts: [],
    dimensions: [{ type: 'ALIGNED', from: ref(arc.id, 'start'), to: ref(arc.id, 'end'), position: { x: 4, y: 14 }, height: 2.5 }],
  })
  const [dimension] = await sdk.executeCommand('CREATEBATCH', { entities: [spec] })
  const handle = dimension.handle
  close(measurement(drawing, dimension.id), Math.sqrt(200))
  await sdk.executeCommand('LENGTHEN', { id: arc.id, totalLength: 10 * Math.PI, endpoint: 'end' })
  close(measurement(drawing, dimension.id), 20)
  assert.equal(drawing.getObject(dimension.id).handle, handle)
})

test('degenerate sources and protected dimension layers roll back the entire source edit', async () => {
  const { sdk, drawing, line, dimension } = await lineFixture()
  const unchangedOnReject = async (work, predicate) => {
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(work(), predicate)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history); assert.equal(drawing.revision, revision)
  }
  await unchangedOnReject(
    () => sdk.executeCommand('PROPERTIES', { id: line.id, patch: { payload: { end: [0, 0, 0] } } }),
    error => error instanceof KJValidationError && /degenerate/.test(error.message),
  )

  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Protected dimensions' })
  await sdk.executeCommand('PROPERTIES', { id: dimension.id, patch: { payload: { layerId: layer.id } } })
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } })
  await unchangedOnReject(
    () => sdk.executeCommand('MOVE', { id: line.id, dx: 3, dy: 0 }),
    error => error instanceof KJValidationError && error.details?.policy === 'layer-editability' && error.details?.entityId === dimension.id,
  )
})
