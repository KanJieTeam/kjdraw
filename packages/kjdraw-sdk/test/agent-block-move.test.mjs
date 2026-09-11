import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { agentPreviewMatchesDocument, createAgentGeometryPreview } from '../src/agent-preview.js'
import { agentBlockDependenciesMatchDocument, captureAgentBlockDependencies } from '../src/agent-preview-blocks.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const args = document => ({ expectedRevision: document.revision, units: 'millimeter', ids: ['pump'], dx: 25, dy: -12 })

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Reusable pump equipment', tx => {
    const dash = tx.upsertTableRecord('linetypes', { id: 'dash', name: 'Equipment dash', payload: { pattern: [3, -1] } })
    const layer = tx.upsertTableRecord('layers', { id: 'equipment-layer', name: 'Equipment', payload: { color: 3, linetypeId: dash.id } })
    const style = tx.upsertTableRecord('textStyles', { id: 'equipment-text', name: 'Equipment text', payload: { fontFamily: 'sans-serif' } })
    const motor = tx.upsertTableRecord('blockRecords', { id: 'motor', name: 'Motor', payload: { basePoint: [2, 1, 0], entityIds: [] } })
    tx.createEntity('CIRCLE', { center: [2, 1, 0], radius: 3 }, { id: 'motor-circle', ownerId: motor.id })
    tx.createEntity('LINE', { start: [2, 1, 0], end: [6, 1, 0] }, { id: 'motor-shaft', ownerId: motor.id })
    const body = tx.upsertTableRecord('blockRecords', { id: 'body', name: 'Pump assembly', payload: { basePoint: [10, 20, 0], entityIds: [] } })
    tx.createEntity('LWPOLYLINE', { vertices: [[10, 20, 0], [30, 20, 0], [30, 32, 0], [10, 32, 0]], closed: true }, { id: 'body-outline', ownerId: body.id })
    tx.createEntity('TEXT', { position: [11, 23, 0], text: 'P-12', height: 2, styleId: style.id }, { id: 'body-label', ownerId: body.id })
    tx.createEntity('INSERT', { blockRecordId: motor.id, position: [24, 26, 0], scale: [1, 1, 1], rotation: Math.PI / 2 }, { id: 'nested-motor', ownerId: body.id })
    tx.createEntity('INSERT', { blockRecordId: body.id, position: [100, 200, 0], scale: [2, 2, 2], rotation: Math.PI / 6, layerId: layer.id }, { id: 'pump' })
    tx.createEntity('INSERT', { blockRecordId: body.id, position: [400, 500, 0], scale: [1, 1, 1], layerId: layer.id }, { id: 'other-pump' })
  })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}

test('INSERT move carries the complete bounded native dependency graph, preserves definitions and reopens as native DXF blocks', async () => {
  const { sdk, document, session } = await fixture()
  const source = document.serialize(), history = document.history, original = new Map(document.listObjects().map(item => [item.id, item]))
  const other = sdk.createDocument({ units: 'meter' }), otherSource = other.serialize()
  const proposal = value(await session.call('cad_propose_move', args(document)))
  assert.equal(document.serialize(), source)
  assert.deepEqual(document.history, history)
  assert.deepEqual(proposal.preview.before.map(item => item.id), ['pump'])
  assert.deepEqual(proposal.preview.after.map(item => item.id), ['pump'])
  assert.deepEqual(proposal.preview.after[0].payload.position, [125, 188, 0])
  const dependencies = proposal.preview.blockDependencies
  assert.ok(dependencies.length > 8)
  const names = new Set(dependencies.map(item => item.id))
  for (const id of ['body', 'motor', 'body-outline', 'body-label', 'nested-motor', 'motor-circle', 'motor-shaft', 'equipment-layer', 'dash', 'equipment-text']) assert.ok(names.has(id), id)
  assert.ok(!names.has('other-pump') && !names.has('pump'))
  for (const item of dependencies) {
    const actual = document.getObject(item.id)
    assert.deepEqual(item, JSON.parse(JSON.stringify({ id: actual.id, kind: actual.kind, type: actual.type, ownerId: actual.ownerId, name: actual.name, payload: actual.payload })))
    assert.throws(() => { item.payload.color = 9 }, TypeError)
  }
  assert.ok(Buffer.byteLength(JSON.stringify(dependencies)) <= 131072)
  assert.deepEqual(JSON.parse(JSON.stringify(dependencies)), dependencies)
  const receipt = value(await session.approve(proposal.planId, 'reviewer'))
  assert.equal(receipt.afterRevision, receipt.beforeRevision + 1)
  assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
  assert.equal(other.serialize(), otherSource)
  for (const [id, object] of original) if (id !== 'pump') assert.deepEqual(document.getObject(id), object)
  const moved = document.getObject('pump')
  for (const key of ['id', 'handle', 'ownerId', 'extension', 'source']) assert.deepEqual(moved[key], original.get('pump')[key])
  for (const format of ['KJD', 'DXF']) {
    const serialized = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    if (format === 'DXF') { assert.match(serialized, /\nINSERT\r?\n/); assert.match(serialized, /Pump assembly/) }
    const reopened = await createKJDrawSDK().readDocument(serialized, { format })
    const inserts = reopened.listEntities({ ownerId: reopened.snapshot().spaces.modelSpaceId, type: 'INSERT' })
    assert.equal(inserts.length, 2)
    const actual = inserts.find(item => item.handle === moved.handle)
    assert.ok(actual)
    assert.deepEqual(actual.payload.position, [125, 188, 0])
    assert.deepEqual(actual.payload.scale, moved.payload.scale)
    assert.ok(Math.abs(actual.payload.rotation - moved.payload.rotation) < 1e-12)
    const body = reopened.getObject(actual.payload.blockRecordId)
    assert.equal(body.name, 'Pump assembly')
    assert.deepEqual(body.payload.basePoint, [10, 20, 0])
    const nested = reopened.listEntities({ ownerId: body.id, type: 'INSERT' })[0]
    assert.deepEqual(nested.payload.position, [24, 26, 0])
    const motor = reopened.getObject(nested.payload.blockRecordId)
    assert.equal(motor.name, 'Motor')
    assert.deepEqual(reopened.listEntities({ ownerId: motor.id, type: 'CIRCLE' })[0].payload.center, [2, 1, 0])
  }
  await document.undo(); assert.deepEqual(document.getObject('pump'), original.get('pump'))
  await document.redo(); assert.deepEqual(document.getObject('pump'), moved)
  assert.equal((await session.approve(proposal.planId, 'reviewer')).ok, false)
})

test('block move rejects every hidden or locked nested dependency, external references and incomplete rendering cases', async () => {
  const changes = [
    ['root-hidden', 'pump', { visible: false }], ['child-hidden', 'motor-circle', { visible: false }],
    ['locked-layer', 'equipment-layer', { locked: true }], ['frozen-layer', 'equipment-layer', { frozen: true }],
    ['hidden-definition', 'motor', { visible: false }], ['locked-definition', 'motor', { locked: true }],
    ['xref-definition', 'motor', { dxfFlags: 4 }], ['xref-insert', 'pump', { externalReferenceId: 'host-owned-ref' }],
    ['placeholder', 'motor', { importedPlaceholder: true }], ['attributes', 'pump', { attributes: { TAG: 'P-12' } }],
    ['nonuniform', 'pump', { scale: [2, 3, 1] }], ['mirrored', 'pump', { scale: [-1, 1, 1] }],
    ['tilted', 'nested-motor', { normal: [0, 1, 0] }], ['raised', 'motor-circle', { center: [2, 1, 3] }],
    ['wide-polyline', 'body-outline', { vertices: [{ point: [0, 0, 0], startWidth: 2 }, { point: [10, 10, 0] }] }],
    ['oversized-dependency', 'equipment-layer', { description: 'x'.repeat(132000) }],
  ]
  for (const [name, id, patch] of changes) {
    const { document, session } = await fixture()
    await document.transact(name, tx => tx.updateObject(id, { payload: patch }))
    const source = document.serialize()
    const result = await session.call('cad_propose_move', args(document))
    assert.equal(result.ok, false, name)
    assert.match(result.error.message, /Block move preview|visible editable/, name)
    assert.equal(document.serialize(), source, name)
  }
})

test('block preview counts expanded instances before deduplication and rejects cycles and depth excess', async () => {
  for (const [depth, repetitions, cycle, expected] of [[3, 2, false, true], [8, 1, false, true], [9, 1, false, false], [6, 3, false, false], [2, 1, true, false]]) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    await document.transact('bounded graph', tx => {
      const blocks = Array.from({ length: depth }, (_, i) => tx.upsertTableRecord('blockRecords', { id: `b${i}`, name: `Block ${i}`, payload: { entityIds: [] } }))
      for (let i = 0; i < depth; i++) {
        if (i === depth - 1 && !cycle) tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 1 }, { ownerId: blocks[i].id })
        else for (let j = 0; j < repetitions; j++) tx.createEntity('INSERT', { blockRecordId: blocks[(i + 1) % depth].id, position: [j * 4, 0, 0] }, { ownerId: blocks[i].id })
      }
      tx.createEntity('INSERT', { blockRecordId: blocks[0].id, position: [0, 0, 0] }, { id: 'pump' })
    })
    const source = document.serialize(), session = new KJAgentToolSession(sdk, document)
    const result = await session.call('cad_propose_move', args(document))
    assert.equal(result.ok, expected, JSON.stringify({ depth, repetitions, cycle, result: result.ok ? true : result.error }))
    assert.equal(document.serialize(), source)
    if (!expected) await assert.rejects(createAgentGeometryPreview(document, 'MOVE', { ids: ['pump'], dx: 1, dy: 2 }), /Block move preview/)
  }
})

test('definition and style changes invalidate block approval and immutable dependency matching', async () => {
  for (const [id, patch] of [['motor-circle', { radius: 4 }], ['equipment-layer', { color: 2 }], ['motor', { basePoint: [3, 2, 0] }]]) {
    const { document, session } = await fixture()
    const proposal = value(await session.call('cad_propose_move', args(document)))
    assert.equal(agentBlockDependenciesMatchDocument(document, proposal.preview.blockDependencies), true)
    await document.transact('Intervening block change', tx => tx.updateObject(id, { payload: patch }))
    const changed = document.serialize()
    assert.equal(agentBlockDependenciesMatchDocument(document, proposal.preview.blockDependencies), false)
    assert.equal((await session.approve(proposal.planId, 'reviewer')).ok, false)
    assert.equal(document.serialize(), changed)
  }
  const { document, session } = await fixture()
  const source = document.serialize(), proposal = value(await session.call('cad_propose_move', args(document)))
  value(session.reject(proposal.planId, 'reviewer'))
  assert.equal((await session.approve(proposal.planId, 'reviewer')).ok, false)
  assert.equal(document.serialize(), source)
  assert.deepEqual(captureAgentBlockDependencies(document, ['body-label']), undefined)
})

test('empty, unsupported and unprojectable-dimension blocks fail instead of showing incomplete geometry', async () => {
  for (const mode of ['empty', 'unsupported', 'unprojectable-dimension']) {
    const { document, session } = await fixture()
    await document.transact(mode, tx => {
      if (mode === 'empty') for (const id of ['motor-circle', 'motor-shaft']) tx.eraseObject(id)
      else if (mode === 'unsupported') tx.createEntity('UNSUPPORTED_BLOCK_CHILD', { position: [0, 0, 0] }, { ownerId: 'body' })
      else tx.createEntity('DIMENSION', { dimensionType: 'ORDINATE', definitionPoints: [[0, 4, 0], [0, 0, 0], [10, 0, 0]] }, { ownerId: 'body' })
    })
    const source = document.serialize()
    assert.equal((await session.call('cad_propose_move', args(document))).ok, false, mode)
    assert.equal(document.serialize(), source)
  }
})
