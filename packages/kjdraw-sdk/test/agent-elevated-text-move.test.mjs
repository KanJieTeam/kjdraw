import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { canonicalStringify } from '../src/utils.js'

async function fixture(z, extra = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  let target, untouched
  await document.transact('Synthetic elevated native annotations', transaction => {
    target = transaction.createEntity('TEXT', { text: 'Synthetic borehole label', height: 2,
      position: [10, 20, z], alignmentPoint: [30, 20, z], horizontalAlignment: 3,
      normal: [0, 0, 1], ...extra })
    untouched = transaction.createEntity('CIRCLE', { center: [5, 5, 0], radius: 3 })
  })
  await document.clearHistory({ expectedRevision: document.revision })
  return { sdk, document, target, untouched, session: new KJAgentToolSession(sdk, document) }
}

for (const z of [12.5, 25, 50, -1704.5]) {
  test('reviewed native TEXT XY MOVE preserves elevation ' + z + ', anchors, history and DXF reopening', async () => {
    const { sdk, document, target, untouched, session } = await fixture(z)
    const before = document.snapshot().objects, original = structuredClone(document.getObject(target.id))
    const serialized = document.serialize(), history = document.history
    const result = await session.call('cad_propose_move', { expectedRevision: document.revision,
      units: 'millimeter', ids: [target.id], dx: 2, dy: -3 })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    assert.equal(document.serialize(), serialized, 'proposal cannot edit the drawing')
    assert.deepEqual(document.history, history, 'proposal cannot change real history')
    assert.deepEqual(result.value.preview.before.map(entity => entity.id), [target.id])
    assert.deepEqual(result.value.preview.after.map(entity => entity.id), [target.id])
    const receipt = await session.approve(result.value.planId, 'synthetic-elevation-review')
    assert.equal(receipt.ok, true, JSON.stringify(receipt.error))
    assert.equal(receipt.value.status, 'committed')
    const expected = structuredClone(original)
    expected.payload.position = [12, 17, z]
    expected.payload.alignmentPoint = [32, 17, z]
    assert.equal(canonicalStringify(document.getObject(target.id)), canonicalStringify(expected))
    assert.deepEqual(document.getObject(untouched.id), before[untouched.id])
    const after = document.snapshot().objects
    assert.equal(await document.undo(), true)
    assert.deepEqual(document.snapshot().objects, before)
    assert.equal(await document.redo(), true)
    assert.deepEqual(document.snapshot().objects, after)
    assert.equal((await session.approve(result.value.planId, 'synthetic-elevation-review')).ok, false)
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
    const restored = reopened.listEntities({ type: 'TEXT' }).find(entity => entity.handle === target.handle)
    assert.ok(restored)
    assert.deepEqual(restored.payload.position, expected.payload.position)
    assert.deepEqual(restored.payload.alignmentPoint, expected.payload.alignmentPoint)
    assert.equal(restored.payload.text, original.payload.text)
    assert.equal(restored.payload.horizontalAlignment, original.payload.horizontalAlignment)
    assert.equal(reopened.validate().valid, true)
  })
}

test('elevated TEXT MOVE does not authorize tilted OCS or inconsistent text-anchor elevation', async () => {
  for (const extra of [{ normal: [0, 0, -1] }, { normal: [1, 0, 0] }, { alignmentPoint: [30, 20, 6] }]) {
    const { document, target, session } = await fixture(5, extra)
    const serialized = document.serialize(), history = document.history
    const result = await session.call('cad_propose_move', { expectedRevision: document.revision,
      units: 'millimeter', ids: [target.id], dx: 1, dy: 0 })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'KJDOCUMENT_INVALID')
    assert.equal(document.serialize(), serialized)
    assert.deepEqual(document.history, history)
  }
})

test('elevated native TEXT MOVE does not expand COPY, ROTATE or SCALE geometry support', async () => {
  const { document, target, session } = await fixture(5)
  const serialized = document.serialize()
  for (const [tool, args] of [
    ['cad_propose_copy', { dx: 1, dy: 0 }],
    ['cad_propose_rotate', { center: { x: 0, y: 0 }, angleDegrees: 45 }],
    ['cad_propose_scale', { center: { x: 0, y: 0 }, factor: 2 }],
  ]) {
    const result = await session.call(tool, { expectedRevision: document.revision,
      units: 'millimeter', ids: [target.id], ...args })
    assert.equal(result.ok, false, tool)
    assert.equal(document.serialize(), serialized)
  }
})

test('elevated TEXT MOVE enforces its coordinate budget both before and after displacement', async () => {
  for (const [z, extra] of [[1e12 + 1, {}], [5, {
    position: [1e12 - 20, 20, 5], alignmentPoint: [1e12, 20, 5],
  }]]) {
    const { document, target, session } = await fixture(z, extra)
    const serialized = document.serialize(), history = document.history
    const result = await session.call('cad_propose_move', { expectedRevision: document.revision,
      units: 'millimeter', ids: [target.id], dx: 1, dy: 0 })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'KJDOCUMENT_INVALID')
    assert.equal(document.serialize(), serialized)
    assert.deepEqual(document.history, history)
  }
})

test('elevated native TEXT MOVE does not authorize elevated native DIMENSION projections', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  let target
  await document.transact('Public elevated dimension guard fixture', transaction => {
    target = transaction.createEntity('DIMENSION', { dimensionType: 'ALIGNED',
      definitionPoints: [[0, 10, 5], [0, 0, 5], [20, 0, 5]], text: '<>' })
  })
  const serialized = document.serialize()
  const result = await new KJAgentToolSession(sdk, document).call('cad_propose_move', {
    expectedRevision: document.revision, units: 'millimeter', ids: [target.id], dx: 1, dy: 0,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'KJDOCUMENT_INVALID')
  assert.equal(document.serialize(), serialized)
})

test('ten reviewed edits of imported elevated TEXT retain anchors, untouched objects and actual undo/redo across DXF checks', async () => {
  const source = await fixture(25)
  const sdk = createKJDrawSDK()
  const document = await sdk.readDocument(await source.sdk.writeDocument(source.document, { format: 'DXF' }), { format: 'DXF' })
  const target = document.listEntities({ type: 'TEXT' }).find(entity => entity.handle === source.target.handle)
  assert.ok(target)
  const session = new KJAgentToolSession(sdk, document)
  const originalObjects = document.snapshot().objects
  const value = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value }
  for (let round = 1; round <= 10; round++) {
    const original = structuredClone(document.getObject(target.id))
    const before = document.snapshot().objects, expected = structuredClone(original)
    const editText = round % 2 === 1
    const tool = editText ? 'cad_propose_text_edit' : 'cad_propose_move'
    const args = editText
      ? { changes: [{ id: target.id, expectedText: original.payload.text, text: 'Synthetic label revision ' + round }] }
      : { ids: [target.id], dx: 2, dy: -3 }
    if (editText) expected.payload.text = 'Synthetic label revision ' + round
    else for (const name of ['position', 'alignmentPoint']) {
      expected.payload[name][0] += 2
      expected.payload[name][1] -= 3
    }
    const proposal = value(await session.call(tool, { expectedRevision: document.revision, units: 'millimeter', ...args }))
    assert.deepEqual(document.snapshot().objects, before, 'round ' + round + ': preview is read-only')
    assert.equal(value(await session.approve(proposal.planId, 'ten-round-synthetic-review')).status, 'committed')
    assert.equal(canonicalStringify(document.getObject(target.id)), canonicalStringify(expected))
    for (const [id, record] of Object.entries(originalObjects)) if (id !== target.id) {
      assert.deepEqual(document.getObject(id), record, 'round ' + round + ': untouched native record changed')
    }
    const after = document.snapshot().objects
    for (const [kind, records] of [['undo', before], ['redo', after]]) {
      const read = value(await session.call('cad_read_history', { expectedRevision: document.revision }))
      const historyProposal = value(await session.call('cad_propose_' + kind, { expectedRevision: document.revision,
        units: read.units, targetHistoryId: read.history[kind + 'Target'].id }))
      assert.equal(value(await session.approve(historyProposal.planId, 'ten-round-synthetic-review')).status, 'committed')
      assert.deepEqual(document.snapshot().objects, records, 'round ' + round + ': ' + kind + ' must restore the whole native object graph')
    }
    const restored = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
    const reopened = restored.listEntities({ type: 'TEXT' }).find(entity => entity.handle === target.handle)
    assert.ok(reopened, 'round ' + round + ': native handle must survive DXF reopening')
    assert.deepEqual(reopened.payload.position, expected.payload.position)
    assert.deepEqual(reopened.payload.alignmentPoint, expected.payload.alignmentPoint)
    assert.equal(reopened.payload.text, expected.payload.text)
    assert.equal(restored.validate().valid, true)
    assert.equal(restored.snapshot().header.units, 'millimeter')
    assert.equal(restored.history.canUndo, false, 'DXF reopening must not invent historical changes')
  }
})
