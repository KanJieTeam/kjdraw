import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK } from '../src/sdk.js'

const line = (id, start, end, layerId = 'source-layer') => ({ id, type: 'LINE', points: [[...start, 0], [...end, 0]], layerId })

async function connectedFixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: `structural-${Math.random()}`, units: 'millimeter' })
  await document.transact('Connected lines', tx => {
    tx.upsertTableRecord('layers', { id: 'source-layer', name: 'SOURCE', payload: { visible: true, frozen: false, locked: false } })
    tx.upsertTableRecord('layers', { id: 'target-layer', name: 'TARGET', payload: { visible: true, frozen: false, locked: false } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0], layerId: 'source-layer' }, { id: 'left' })
    tx.createEntity('LINE', { start: [10, 0, 0], end: [20, 0, 0], layerId: 'source-layer' }, { id: 'bridge' })
    tx.createEntity('LINE', { start: [20, 0, 0], end: [30, 0, 0], layerId: 'source-layer' }, { id: 'right' })
  })
  await sdk.getSelectionManager(document.id).saveNamed('Section chain', { ids: ['left', 'bridge', 'right'] })
  return { sdk, document }
}

test('STRUCTURALEDIT erases, relayers and reconnects exact native geometry in one undoable transaction', async () => {
  const { sdk, document } = await connectedFixture(), before = document.snapshot().objects, revision = document.revision
  const result = await sdk.executeCommand('STRUCTURALEDIT', {
    eraseIds: ['bridge'],
    reconnections: [line('replacement', [10, 0], [20, 0], 'target-layer')],
    relayer: { ids: ['left', 'right'], layerId: 'target-layer' },
  }, { document })
  assert.equal(result.semanticInference, 'none')
  assert.deepEqual(result.effectiveEraseIds, ['bridge'])
  assert.equal(document.revision, revision + 1)
  assert.equal(document.getObject('bridge'), null)
  assert.deepEqual(document.getObject('replacement').payload.start, [10, 0, 0])
  assert.deepEqual(document.getObject('replacement').payload.end, [20, 0, 0])
  assert.equal(document.getObject('replacement').payload.layerId, 'target-layer')
  assert.equal(document.getObject('left').payload.layerId, 'target-layer')
  assert.equal(document.getObject('right').payload.layerId, 'target-layer')
  assert.deepEqual(sdk.getSelectionManager(document.id).listNamed()[0].memberIds, ['left', 'right'])

  await document.undo()
  assert.deepEqual(document.snapshot().objects, before)
  await document.redo()
  assert.equal(document.getObject('bridge'), null)
  assert.ok(document.getObject('replacement'))
  assert.equal(document.getObject('left').payload.layerId, 'target-layer')
})

test('STRUCTURALEDIT preserves geological HATCH payloads and never expands erased INSERT definitions', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Native geology records', tx => {
    tx.upsertTableRecord('layers', { id: 'geology-old', name: 'GEOLOGY OLD', payload: {} })
    tx.upsertTableRecord('layers', { id: 'geology-new', name: 'GEOLOGY NEW', payload: {} })
    tx.createEntity('HATCH', {
      solid: false, associative: false, patternName: 'CUSTOM_STRATUM', patternScale: 2, patternAngle: .25, layerId: 'geology-old',
      boundaryLoops: [{ external: true, vertices: [[0, 0], [8, 0], [8, 4], [0, 4]] }],
      patternLines: [{ angle: .1, base: [0, 0], offset: [0, 1], dashes: [2, -1] }], rawTags: [{ code: 78, value: 1 }], custom: { geologicalPattern: 'sandstone' },
    }, { id: 'stratum-pattern' })
    const definition = tx.upsertTableRecord('blockRecords', { id: 'symbol-definition', name: 'SYMBOL', payload: { basePoint: [0, 0, 0], entityIds: [] } })
    tx.createEntity('LINE', { start: [-1, 0, 0], end: [1, 0, 0], layerId: 'geology-old' }, { id: 'definition-member', ownerId: definition.id })
    const insert = tx.createEntity('INSERT', { blockRecordId: definition.id, position: [5, 2, 0], scale: [1, 1, 1], rotation: 0, attributeIds: [], sequenceEndId: null, layerId: 'geology-old' }, { id: 'borehole-symbol' })
    tx.createEntity('ATTRIB', { parentInsertId: insert.id, tag: 'CODE', text: 'BH-03', position: [5, 2, 0], height: 1, layerId: 'geology-old' }, { id: 'borehole-code', ownerId: insert.ownerId })
    tx.createObject({ id: 'borehole-end', kind: 'custom', type: 'SEQEND', ownerId: insert.id, payload: { dxfOwnerMode: 'insert', layerId: 'geology-old' } })
    tx.updateObject(insert.id, { payload: { attributeIds: ['borehole-code'], sequenceEndId: 'borehole-end' } })
  })
  const hatchBefore = structuredClone(document.getObject('stratum-pattern').payload)
  const result = await sdk.executeCommand('STRUCTURALEDIT', {
    eraseIds: ['borehole-symbol'],
    reconnections: [{ id: 'new-boundary', type: 'LWPOLYLINE', points: [[0, 0, 0], [4, 1, 0], [8, 0, 0]], layerId: 'geology-new' }],
    relayer: { ids: ['stratum-pattern'], layerId: 'geology-new' },
  }, { document })
  assert.equal(result.semanticInference, 'none')
  assert.deepEqual(result.effectiveEraseIds, ['borehole-code', 'borehole-end', 'borehole-symbol'])
  for (const id of result.effectiveEraseIds) assert.equal(document.getObject(id), null)
  assert.ok(document.getObject('definition-member'))
  assert.ok(document.getObject('symbol-definition'))
  const hatchAfter = structuredClone(document.getObject('stratum-pattern').payload)
  assert.equal(hatchAfter.layerId, 'geology-new')
  delete hatchBefore.layerId; delete hatchAfter.layerId
  assert.deepEqual(hatchAfter, hatchBefore)
  assert.deepEqual(document.getObject('new-boundary').payload.vertices.map(vertex => vertex.point), [[0, 0, 0], [4, 1, 0], [8, 0, 0]])
  assert.equal(document.getObject('new-boundary').payload.closed, false)
})

test('STRUCTURALEDIT validates the complete exact operation before any mutation', async () => {
  const { sdk, document } = await connectedFixture()
  await document.transact('Associative hatch and limits', tx => {
    const bridge = tx.getObject('bridge')
    tx.createEntity('HATCH', { associative: true, solid: true, patternName: 'SOLID', boundaryLoops: [{ external: true, sourceHandles: [bridge.handle], vertices: [[10, -1], [20, -1], [20, 1], [10, 1]] }] }, { id: 'bridge-hatch' })
    tx.upsertTableRecord('layers', { id: 'locked-layer', name: 'LOCKED', payload: { locked: true } })
    for (let index = 0; index < 63; index++) tx.createEntity('LINE', { start: [index, 10, 0], end: [index + .5, 10, 0] }, { id: `bulk-${index}` })
  })
  const base = { eraseIds: ['left'], reconnections: [] }
  const cases = [
    { eraseIds: ['bridge'], reconnections: [] },
    { ...base, relayer: { ids: ['left'], layerId: 'target-layer' } },
    { ...base, reconnections: [{ id: 'bad-type', type: 'HATCH', points: [[0, 0, 0], [1, 0, 0]], layerId: 'target-layer' }] },
    { ...base, reconnections: Array.from({ length: 17 }, (_, index) => line(`many-${index}`, [index, 0], [index + .5, 0], 'target-layer')) },
    { ...base, reconnections: [{ id: 'too-many-points', type: 'LWPOLYLINE', points: Array.from({ length: 65 }, (_, index) => [index, 0, 0]), layerId: 'target-layer' }] },
    { ...base, reconnections: [line('locked-reconnect', [0, 0], [1, 0], 'locked-layer')] },
    { eraseIds: ['left', ...Array.from({ length: 63 }, (_, index) => `bulk-${index}`)], reconnections: [line('sixty-five', [0, 0], [1, 0], 'target-layer')] },
    { eraseIds: ['left', 'left'], reconnections: [] },
    { ...base, reconnections: [line('left', [0, 0], [1, 0], 'target-layer')] },
    { ...base, reconnections: [], extra: true },
  ]
  for (const input of cases) {
    const before = document.serialize(), revision = document.revision
    await assert.rejects(sdk.executeCommand('STRUCTURALEDIT', input, { document }))
    assert.equal(document.serialize(), before)
    assert.equal(document.revision, revision)
  }
})

test('STRUCTURALEDIT never edits block-definition or paper-space geometry through an incomplete preview', async () => {
  const { sdk, document } = await connectedFixture()
  let paperSpaceId
  await document.transact('Non-model geometry', tx => {
    const definition = tx.upsertTableRecord('blockRecords', { id: 'shared-definition', name: 'SHARED', payload: { basePoint: [0, 0, 0], entityIds: [] } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [2, 0, 0], layerId: 'source-layer' }, { id: 'definition-line', ownerId: definition.id })
    tx.createEntity('INSERT', { blockRecordId: definition.id, position: [50, 0, 0], scale: [1, 1, 1], rotation: 0, attributeIds: [], sequenceEndId: null, layerId: 'source-layer' }, { id: 'shared-instance' })
    paperSpaceId = tx.createLayout({ id: 'paper-layout', blockRecordId: 'paper-space', name: 'Paper' }).payload.blockRecordId
    tx.createEntity('LINE', { start: [0, 0, 0], end: [5, 0, 0], layerId: 'source-layer' }, { id: 'paper-line', ownerId: paperSpaceId })
  })
  for (const eraseIds of [['definition-line'], ['paper-line']]) {
    const before = document.serialize(), revision = document.revision
    await assert.rejects(sdk.executeCommand('STRUCTURALEDIT', { eraseIds, reconnections: [] }, { document }), /limited to model-space/)
    assert.equal(document.serialize(), before)
    assert.equal(document.revision, revision)
  }
})

test('STRUCTURALEDIT publishes its exact bounded atomic capability', () => {
  const capability = createKJDrawSDK().capabilities().commands.find(command => command.id === 'STRUCTURALEDIT')
  assert.deepEqual(capability.capabilities, {
    domain: 'topology', precision: 'exact', operations: ['erase', 'reconnect', 'relayer'], atomic: true, stableIdentity: true,
    maximumChangedEntities: 64, maximumReconnections: 16, reconnectEntityTypes: ['LINE', 'LWPOLYLINE'], semanticInference: 'none',
  })
})
