import assert from 'node:assert/strict'
import { createKJDrawSDK, KJAgentToolSession, findDrawingText } from '../../packages/kjdraw-sdk/src/index.js'
import { canonicalStringify } from '../../packages/kjdraw-sdk/src/utils.js'

const records = document => document.listEntities().map(entity => structuredClone(entity))
const preservedDxfPayload = payload => JSON.parse(JSON.stringify({ normal: [0, 0, 1], ...payload }, (key, value) => {
  if (key === 'rawTags' || key === 'contractVersion' || /Ids?$/.test(key)) return undefined
  return typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value
}))

export async function checkDrawingReopen(sdk, document) {
  const expected = records(document)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, expected.length)
    const byKey = new Map(reopened.listEntities().map(entity => [format === 'KJD' ? entity.id : entity.handle, entity]))
    for (const entity of expected) {
      const actual = byKey.get(format === 'KJD' ? entity.id : entity.handle)
      assert.ok(actual, format + ': object disappeared')
      if (format === 'KJD') assert.equal(canonicalStringify(actual), canonicalStringify(entity))
      else {
        assert.equal(actual.type, entity.type)
        assert.equal(canonicalStringify(preservedDxfPayload(actual.payload)), canonicalStringify(preservedDxfPayload(entity.payload)))
        for (const key of ['layerId', 'linetypeId', 'styleId', 'blockRecordId']) {
          const expectedName = document.getObject(entity.payload[key])?.name
          const actualName = reopened.getObject(actual.payload[key])?.name
          assert.equal(actualName, expectedName, 'DXF: resource identity changed: ' + key)
        }
      }
    }
  }
}

/** Engine journey, not a natural-language/model benchmark. Works only on in-memory copies. */
export async function runImportedDrawingEditJourney(bytes, { targetText, targetHandle } = {}) {
  let sdk = createKJDrawSDK()
  let document = await sdk.readDocument(bytes, { format: 'DXF' })
  let session = new KJAgentToolSession(sdk, document)
  assert.equal(document.validate().valid, true)
  const candidates = document.listEntities({ ownerId: document.spaces.modelSpaceId })
    .filter(entity => entity.type === 'TEXT' && /^\d{4}$|^ZK[- ]?\d+$/i.test(entity.payload.text))
  const target = targetHandle ? document.listEntities({ type: 'TEXT', ownerId: document.spaces.modelSpaceId }).find(entity => entity.handle === targetHandle) : targetText
    ? findDrawingText(document, { expectedRevision: document.revision, search: targetText, match: 'exact' }).matches[0]
    : candidates[0]
  assert.ok(target, 'No explicit borehole-label candidate; provide targetText rather than guessing')
  const id = target.id
  const initial = structuredClone(document.getObject(id))
  // An explicit host-created review layer is a manual edit, not a model result.
  let reviewLayer
  await document.transact('Prepare local regression review layer', tx => {
    reviewLayer = tx.upsertTableRecord('layers', { name: 'KJDRAW_REGRESSION_REVIEW', payload: { visible: true, locked: false } }).id
  })
  const rounds = []
  const edits = [
    ['text', initial.payload.text + '-A'], ['move', 2, 0], ['move', 0, 1],
    ['layer', reviewLayer], ['text', initial.payload.text + '-B'],
    ['move', -1, 0], ['layer', initial.payload.layerId],
    ['text', initial.payload.text], ['move', -1, -1], ['text', initial.payload.text + '-验收'],
  ]
  for (let round = 0; round < edits.length; round++) {
    const before = records(document)
    const current = structuredClone(document.getObject(id))
    const search = await session.call('cad_find_text', {
      expectedRevision: document.revision, search: current.payload.text, match: 'exact', limit: 100,
    })
    assert.equal(search.ok, true, JSON.stringify(search.error))
    assert.ok(search.value.matches.some(match => match.id === id), 'Target must be rediscovered at the current revision')
    const expected = structuredClone(current)
    const [kind, value, dy] = edits[round]
    const units = document.snapshot().header.units
    let name, args
    if (kind === 'text') {
      name = 'cad_propose_text_edit'
      args = { changes: [{ id, expectedText: current.payload.text, text: value }] }
      expected.payload.text = value
    } else if (kind === 'move') {
      name = 'cad_propose_move'
      args = { ids: [id], dx: value, dy }
      for (const key of ['position', 'alignmentPoint']) if (expected.payload[key]) {
        expected.payload[key][0] += value
        expected.payload[key][1] += dy
      }
    } else {
      name = 'cad_propose_relayer'
      args = { ids: [id], layerId: value, maxBytes: 262144 }
      expected.payload.layerId = value
    }
    const proposal = await session.call(name, { expectedRevision: document.revision, units, ...args })
    assert.equal(proposal.ok, true, JSON.stringify(proposal.error))
    assert.deepEqual(records(document), before, 'Proposal must remain read-only')
    assert.deepEqual(proposal.value.preview.before.map(entity => entity.id), [id], 'Proposal must not expand to unrelated objects')
    const approval = await session.approve(proposal.value.planId, 'isolated-corpus-test')
    assert.equal(approval.ok, true, JSON.stringify(approval.error))
    // Optional fields explicitly set to undefined have the same stored meaning as absent fields.
    // Compare the complete canonical record, retaining geometry, IDs, text and resource references.
    assert.equal(canonicalStringify(document.getObject(id)), canonicalStringify(expected), 'Reviewed modification must match exactly')
    for (const entity of before.filter(entity => entity.id !== id)) assert.deepEqual(document.getObject(entity.id), entity, 'Untouched object changed: ' + entity.type)
    const after = records(document)
    assert.equal(await document.undo(), true)
    assert.deepEqual(records(document), before, 'Undo must restore every entity')
    assert.equal(await document.redo(), true)
    assert.deepEqual(records(document), after, 'Redo must restore the reviewed result')
    await checkDrawingReopen(sdk, document)
    rounds.push({ round: round + 1, operation: name, untouchedEntities: before.length - 1, passed: true })
    if (round === 4) {
      // Continue later rounds on the same identity after a real KJD save/reopen.
      const saved = await sdk.writeDocument(document, { format: 'KJD' })
      sdk = createKJDrawSDK()
      document = await sdk.readDocument(saved, { format: 'KJD' })
      session = new KJAgentToolSession(sdk, document)
      const other = document.listEntities().find(entity => entity.id !== id && entity.type === 'TEXT')
      assert.ok(other)
      const oldRevision = document.revision
      await document.transact('Simulated human annotation', tx => tx.updateObject(other.id, {
        payload: { text: other.payload.text + ' [人工]' },
      }))
      const stale = await session.call('cad_find_text', { expectedRevision: oldRevision, search: expected.payload.text })
      assert.equal(stale.ok, false, 'A manual edit must invalidate the old revision')
    }
  }
  return { entityCount: document.listEntities().length, rounds, naturalLanguageModelCalls: 0 }
}
