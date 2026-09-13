import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'

const tool = 'cad_propose_drawing_annotated'
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const json = value => JSON.parse(JSON.stringify(value))
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)
const point = (actual, expected) => expected.forEach((value, index) => near(actual[index], value))
const input = revision => ({
  expectedRevision: revision, units: 'millimeter', lines: [], circles: [], arcs: [], polylines: [], arrays: [], styles: [], texts: [],
  alignedDimensions: [], rotatedDimensions: [], radiusDimensions: [], diameterDimensions: [],
  leaders: [{ vertices: [{ x: 5, y: 5 }, { x: 15, y: 12 }, { x: 28, y: 12 }], textPosition: { x: 30, y: 12 }, text: String.raw`VALVE V-101\PKEEP CLEAR 600`, height: 3, width: 24, rotationDegrees: 0, attachmentPoint: 7, arrowEnabled: true }],
})

async function createdPair() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-leader-transform', units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const proposal = value(await session.call(tool, input(document.revision)))
  value(await session.approve(proposal.planId, 'creation-reviewer'))
  const leader = document.listEntities({ type: 'LEADER' })[0], note = document.getObject(leader.payload.annotationId)
  assert.equal(note.type, 'MTEXT')
  return { sdk, document, session, leader, note }
}

test('AI LEADER and MTEXT remain one atomic pair through repeated move, rotate and scale proposals', async () => {
  const { sdk, document, session, leader, note } = await createdPair(), originalLeader = json(leader), originalNote = json(note)
  const operations = [
    ['move', leader.id, { dx: 5, dy: -2 }],
    ['rotate', note.id, { center: { x: 0, y: 0 }, angleDegrees: 90 }],
    ['scale', leader.id, { center: { x: 0, y: 0 }, factor: 2 }],
  ]
  for (const [command, selectedId, arguments_] of operations) {
    const before = document.serialize(), proposal = value(await session.call(`cad_propose_${command}`, { expectedRevision: document.revision, units: 'millimeter', ids: [selectedId], ...arguments_ }))
    assert.equal(document.serialize(), before, `${command} proposal must be read-only`)
    assert.deepEqual(new Set(proposal.arguments.ids), new Set([leader.id, note.id]))
    assert.deepEqual(new Set(proposal.preview.before.map(entity => entity.id)), new Set([leader.id, note.id]))
    assert.deepEqual(new Set(proposal.preview.after.map(entity => entity.id)), new Set([leader.id, note.id]))
    value(await session.approve(proposal.planId, 'transform-reviewer'))
  }
  const transformedLeader = document.getObject(leader.id), transformedNote = document.getObject(note.id)
  for (const [actual, original] of [[transformedLeader, originalLeader], [transformedNote, originalNote]]) {
    for (const key of ['id', 'handle', 'ownerId']) assert.equal(actual[key], original[key])
    assert.equal(actual.payload.layerId, original.payload.layerId)
  }
  assert.equal(transformedLeader.payload.annotationId, transformedNote.id)
  assert.equal(transformedLeader.payload.ownsAnnotation, true)
  point(transformedLeader.payload.vertices[0], [-6, 20, 0])
  point(transformedLeader.payload.textPosition, [-20, 70, 0])
  point(transformedLeader.payload.horizontalDirection, [0, 1, 0])
  point(transformedNote.payload.position, [-20, 70, 0])
  near(transformedNote.payload.rotation, Math.PI / 2)
  near(transformedNote.payload.height, 6)
  near(transformedNote.payload.width, 48)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    const reopenedLeader = reopened.listEntities({ type: 'LEADER' })[0], reopenedNote = reopened.getObject(reopenedLeader.payload.annotationId)
    assert.equal(reopenedNote.type, 'MTEXT')
    assert.equal(reopenedLeader.ownerId, reopenedNote.ownerId)
    assert.equal(reopenedLeader.payload.layerId, reopenedNote.payload.layerId)
    point(reopenedLeader.payload.vertices[0], [-6, 20, 0])
    point(reopenedLeader.payload.textPosition, [-20, 70, 0])
    point(reopenedLeader.payload.horizontalDirection, [0, 1, 0])
    point(reopenedNote.payload.position, [-20, 70, 0])
    near(reopenedNote.payload.rotation, Math.PI / 2)
    near(reopenedNote.payload.height, 6)
    near(reopenedNote.payload.width, 48)
  }
  for (let index = 0; index < operations.length; index++) await document.undo()
  assert.deepEqual(json(document.getObject(leader.id)), originalLeader)
  assert.deepEqual(json(document.getObject(note.id)), originalNote)
  for (let index = 0; index < operations.length; index++) await document.redo()
  assert.deepEqual(json(document.getObject(leader.id)), json(transformedLeader))
  assert.deepEqual(json(document.getObject(note.id)), json(transformedNote))
})

async function unsafeFixture(kind) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact(`unsafe ${kind}`, tx => {
    const protectedLayer = ['locked-layer', 'hidden-layer', 'frozen-layer'].includes(kind)
      ? tx.upsertTableRecord('layers', { id: 'protected', name: 'PROTECTED', payload: { visible: kind !== 'hidden-layer', locked: kind === 'locked-layer', frozen: kind === 'frozen-layer' } })
      : null
    const otherLayer = kind === 'cross-layer' ? tx.upsertTableRecord('layers', { id: 'other', name: 'OTHER', payload: {} }) : null
    const paperOwner = document.getObject(document.spaces.layoutIds[1]).payload.blockRecordId
    tx.createEntity('MTEXT', { position: kind === 'drifted' ? [31, 12, 0] : [30, 12, 0], text: 'NOTE', height: 3, width: 24, rotation: 0, attachmentPoint: 7, ...(kind === 'hidden-entity' ? { visible: false } : {}), ...(kind === 'frozen-entity' ? { frozen: true } : {}), ...(kind === 'cross-layer' ? { layerId: otherLayer.id } : {}), ...(protectedLayer ? { layerId: protectedLayer.id } : {}) }, { id: 'note', ...(kind === 'cross-space' ? { ownerId: paperOwner } : {}) })
    if (kind !== 'standalone') tx.createEntity('LEADER', { vertices: [[5, 5, 0], [15, 12, 0]], textPosition: [30, 12, 0], annotationId: kind === 'broken' ? 'missing' : 'note', ownsAnnotation: kind !== 'unowned', annotationType: 0, ...(kind === 'locked-entity' ? { locked: true } : {}), ...(protectedLayer ? { layerId: protectedLayer.id } : {}) }, { id: 'leader' })
    if (kind === 'ambiguous') tx.createEntity('LEADER', { vertices: [[0, 0, 0], [3, 3, 0]], textPosition: [30, 12, 0], annotationId: 'note', ownsAnnotation: false, annotationType: 0 }, { id: 'other-leader' })
  })
  return { document, session: new KJAgentToolSession(sdk, document) }
}

test('unowned, broken, ambiguous, cross-space and protected LEADER pairs fail before a plan', async () => {
  for (const kind of ['standalone', 'unowned', 'broken', 'ambiguous', 'drifted', 'cross-space', 'cross-layer', 'locked-entity', 'hidden-entity', 'frozen-entity', 'locked-layer', 'hidden-layer', 'frozen-layer']) {
    const { document, session } = await unsafeFixture(kind), before = document.serialize(), history = json(document.history)
    const selectedId = kind === 'standalone' ? 'note' : kind === 'broken' ? 'leader' : kind === 'ambiguous' ? 'note' : 'leader'
    for (const [command, extra] of [['move', { dx: 1, dy: 2 }], ['rotate', { center: { x: 0, y: 0 }, angleDegrees: 30 }], ['scale', { center: { x: 0, y: 0 }, factor: 2 }]]) {
      const result = await session.call(`cad_propose_${command}`, { expectedRevision: document.revision, units: 'millimeter', ids: [selectedId], ...extra })
      assert.equal(result.ok, false, `${kind} ${command}`)
      assert.match(result.error.message, /LEADER|MTEXT|visible|editable|owner|layer|association/i)
      assert.equal(document.serialize(), before)
      assert.deepEqual(json(document.history), history)
    }
  }
})
