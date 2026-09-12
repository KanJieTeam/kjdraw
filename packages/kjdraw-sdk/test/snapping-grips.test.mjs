import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK, findBestSnap, getDocumentSnapSettings, getEntityGrips } from '../src/index.js'

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
const closePoint = (actual, expected, epsilon = 1e-9) => { close(actual[0], expected[0], epsilon); close(actual[1], expected[1], epsilon) }

test('object snapping resolves endpoints, midpoints, nearest points and intersections', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'snapping' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-5, 0], end: [5, 0] } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0], radius: 3 } })
  const endpoint = findBestSnap(document, [-4.9, 0.1], { radius: 1, modes: ['endpoint'] })
  assert.equal(endpoint.entityIds[0], line.id)
  closePoint(endpoint.point, [-5, 0])
  const midpoint = findBestSnap(document, [0.1, 0.1], { radius: 1, modes: ['midpoint'] })
  closePoint(midpoint.point, [0, 0])
  const nearest = findBestSnap(document, [2, 1], { radius: 2, modes: ['nearest'], entityIds: [line.id] })
  closePoint(nearest.point, [2, 0])
  const intersections = sdk.snap([3.1, 0.1], { radius: 1, modes: ['intersection'] })
  assert.equal(intersections[0].mode, 'intersection')
  assert.deepEqual(new Set(intersections[0].entityIds), new Set([line.id, circle.id]))
  closePoint(intersections[0].point, [3, 0])
})

test('arc and bulge-polyline snaps respect their actual curved domains', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'curved-snapping' })
  const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [0, 0], radius: 4, startAngle: 0, endAngle: Math.PI / 2 } })
  const polyline = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [{ point: [-1, 0], bulge: 1 }, { point: [1, 0] }], closed: false } })
  const quadrants = sdk.snap([0, 4], { radius: 10, modes: ['quadrant'], entityIds: [arc.id] })
  assert.equal(quadrants.length, 2)
  assert.ok(quadrants.every(candidate => candidate.point[0] >= -1e-9 && candidate.point[1] >= -1e-9))
  const bulgeMid = sdk.snap([0, -1], { radius: 0.1, modes: ['midpoint'], entityIds: [polyline.id] })[0]
  closePoint(bulgeMid.point, [0, -1])
})

test('circle and arc quadrant snaps keep exact coordinates, sweep boundaries and radius limits', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'quadrant-boundaries' })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [10, -5, 0], radius: 5 } })
  const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [-10, 5, 0], radius: 4, startAngle: 0, endAngle: Math.PI / 2 } })
  const circlePoints = sdk.snap([10, -5], { radius: 6, modes: ['quadrant'], entityIds: [circle.id] })
  for (const expected of [[15, -5], [10, 0], [5, -5], [10, -10]]) assert.ok(circlePoints.some(candidate => Math.hypot(candidate.point[0] - expected[0], candidate.point[1] - expected[1]) < 1e-9))
  assert.ok(circlePoints.every(candidate => candidate.mode === 'quadrant' && candidate.entityIds[0] === circle.id))
  const arcPoints = sdk.snap([-10, 5], { radius: 5, modes: ['quadrant'], entityIds: [arc.id] })
  assert.equal(arcPoints.length, 2); closePoint(arcPoints[0].point, [-6, 5]); closePoint(arcPoints[1].point, [-10, 9])
  assert.equal(sdk.snap([15.02, -5], { radius: 0.01, modes: ['quadrant'], entityIds: [circle.id] }).length, 0)
  closePoint(sdk.snap([15.02, -5], { radius: 0.03, modes: ['quadrant'], entityIds: [circle.id] })[0].point, [15, -5])
  assert.throws(() => sdk.snap([0, 0], { radius: 0, modes: ['quadrant'] }), /radius must be positive/)
})

test('exact snaps outrank nearest while nearest remains an explicit fallback', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'snap-priority' })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0], radius: 10 } })
  const exact = sdk.snap([10, 0.2], { radius: 1, modes: ['quadrant', 'nearest'], entityIds: [circle.id] })
  assert.deepEqual(exact.map(candidate => candidate.mode), ['quadrant'])
  closePoint(exact[0].point, [10, 0])
  const fallback = sdk.snap([10, 0.2], { radius: 1, modes: ['nearest'], entityIds: [circle.id] })
  assert.equal(fallback[0].mode, 'nearest')
  assert.equal(sdk.snap([10, 0.2], { radius: 1, modes: [], entityIds: [circle.id] }).length, 0)
  assert.doesNotThrow(() => sdk.snap([10, 0.2], { radius: 1, modes: ['quadrant'], maxIntersectionPairs: 0 }))
})

test('perpendicular and tangent snaps use the construction reference and exact curve domains', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'relationship-snaps' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [30, 0], radius: 10 } })
  const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [0, 30], radius: 10, startAngle: 0, endAngle: Math.PI } })

  const foot = sdk.snap([4.2, 0.2], { radius: 1, modes: ['perpendicular', 'nearest'], entityIds: [line.id], referencePoint: [4, 8] })
  assert.deepEqual(foot.map(candidate => candidate.mode), ['perpendicular'])
  closePoint(foot[0].point, [4, 0])
  assert.equal(sdk.snap([20, 0], { radius: 30, modes: ['perpendicular'], entityIds: [line.id], referencePoint: [20, 8] }).length, 0)

  const circleFeet = sdk.snap([40, 0], { radius: 25, modes: ['perpendicular'], entityIds: [circle.id], referencePoint: [50, 0] })
  assert.equal(circleFeet.length, 2)
  closePoint(circleFeet[0].point, [40, 0])
  closePoint(circleFeet[1].point, [20, 0])

  const tangent = sdk.snap([35, 8.7], { radius: 1, modes: ['tangent', 'nearest'], entityIds: [circle.id], referencePoint: [50, 0] })
  assert.deepEqual(tangent.map(candidate => candidate.mode), ['tangent'])
  closePoint(tangent[0].point, [35, Math.sqrt(75)])
  const radius = [tangent[0].point[0] - 30, tangent[0].point[1]], construction = [50 - tangent[0].point[0], -tangent[0].point[1]]
  close(radius[0] * construction[0] + radius[1] * construction[1], 0)

  const arcTangents = sdk.snap([5, 38.7], { radius: 2, modes: ['tangent'], entityIds: [arc.id], referencePoint: [20, 30] })
  assert.equal(arcTangents.length, 1)
  closePoint(arcTangents[0].point, [5, 30 + Math.sqrt(75)])
  assert.equal(sdk.snap([40, 0], { radius: 30, modes: ['tangent'], entityIds: [circle.id], referencePoint: [30, 0] }).length, 0)
  assert.equal(sdk.snap([4, 0], { radius: 2, modes: ['perpendicular'], entityIds: [line.id] }).length, 0)
  assert.throws(() => sdk.snap([4, 0], { modes: ['perpendicular'], referencePoint: [Number.NaN, 0] }), /referencePoint/)
})

test('snap references exclude hidden, frozen and other-space geometry while locked layers remain usable', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'snap-visibility' })
  const locked = await sdk.executeCommand('LAYERNEW', { name: 'Locked', locked: true })
  const hidden = await sdk.executeCommand('LAYERNEW', { name: 'Hidden', visible: false })
  const frozen = await sdk.executeCommand('LAYERNEW', { name: 'Frozen', frozen: true })
  let ids
  await document.transact('References', tx => {
    ids = {
      locked: tx.createEntity('LINE', { start: [-5, 0], end: [5, 0], layerId: locked.id }).id,
      hidden: tx.createEntity('LINE', { start: [-5, 10], end: [5, 10], layerId: hidden.id }).id,
      frozen: tx.createEntity('LINE', { start: [-5, 20], end: [5, 20], layerId: frozen.id }).id,
      invisible: tx.createEntity('LINE', { start: [-5, 30], end: [5, 30], visible: false }).id,
      paper: tx.createEntity('LINE', { start: [-5, 40], end: [5, 40] }, { ownerId: document.snapshot().spaces.paperSpaceIds[0] }).id,
    }
  })
  assert.equal(sdk.snap([0, 0.2], { radius: 1, modes: ['nearest'] })[0].entityIds[0], ids.locked)
  for (const y of [10, 20, 30, 40]) assert.equal(sdk.snap([0, y], { radius: 1, modes: ['nearest'] }).length, 0)
  const paper = sdk.snap([0, 40], { radius: 1, modes: ['nearest'], spaceId: document.snapshot().spaces.paperSpaceIds[0] })[0]
  assert.equal(paper.entityIds[0], ids.paper)
})

test('intersection pair budget searches nearby primitives before distant drawing content', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'snap-budget' })
  for (let index = 0; index < 20; index += 1) await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [1000 + index * 10, 1000], end: [1000 + index * 10, 1010] } })
  const horizontal = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-10, 0], end: [10, 0] } })
  const vertical = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, -10], end: [0, 10] } })
  const hit = sdk.snap([0.1, 0.1], { radius: 1, modes: ['intersection'], maxIntersectionPairs: 1 })[0]
  assert.equal(hit.mode, 'intersection')
  assert.deepEqual(new Set(hit.entityIds), new Set([horizontal.id, vertical.id]))
  closePoint(hit.point, [0, 0])
  assert.throws(() => sdk.snap([0, 0], { modes: ['intersection'], maxIntersectionPairs: 0 }), /positive safe integer/)
})

test('document snap settings default, persist through KJD and participate in undo-redo', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'snap-settings' })
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'perpendicular', 'tangent', 'nearest'], aperture: 10 })
  await sdk.executeCommand('SNAPSETTINGS', { modes: ['quadrant', 'nearest'], radius: 17 })
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['quadrant', 'nearest'], aperture: 17 })
  await sdk.executeCommand('UNDO')
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'perpendicular', 'tangent', 'nearest'], aperture: 10 })
  await sdk.executeCommand('REDO')
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['quadrant', 'nearest'], aperture: 17 })
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(getDocumentSnapSettings(reopened), { modes: ['quadrant', 'nearest'], aperture: 17 })
  await sdk.executeCommand('SNAPSETTINGS', { modes: [], radius: 6 })
  assert.deepEqual(getDocumentSnapSettings(document), { modes: [], aperture: 6 })
})

test('standard grips expose stable roles and GRIPEDIT commits real geometry changes', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'grips' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [20, 0], radius: 2 } })
  assert.deepEqual(getEntityGrips(document.getObject(line.id)).map(grip => grip.id), ['start', 'mid', 'end'])
  await sdk.executeCommand('GRIPEDIT', { id: line.id, gripId: 'end', point: [12, 4] })
  closePoint(document.getObject(line.id).payload.end, [12, 4])
  await sdk.executeCommand('GRIPEDIT', { id: line.id, gripId: 'mid', point: [10, 5] })
  closePoint(document.getObject(line.id).payload.start, [4, 3])
  closePoint(document.getObject(line.id).payload.end, [16, 7])
  await sdk.executeCommand('GRIPEDIT', { id: circle.id, gripId: 'quadrant:0', point: [25, 0] })
  close(document.getObject(circle.id).payload.radius, 5)
})

test('invalid grip edits roll back and preserve the prior revision payload', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'grip-rollback' })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0], radius: 2 } })
  const before = document.serialize()
  await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: circle.id, gripId: 'quadrant:0', point: [0, 0] }), KJValidationError)
  assert.equal(document.serialize(), before)
})
