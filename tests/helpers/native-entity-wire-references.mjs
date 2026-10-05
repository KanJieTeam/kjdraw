import assert from 'node:assert/strict'

// Test-only decoder for actual chat-completions wire history. No SDK/gold
// geometry, saved drawing, cross-request cache or recursive reference fallback.
const readTools = new Set(['cad_read_drawing', 'cad_read_page', 'cad_query_drawing'])
const contextKeys = ['documentId', 'revision', 'units', 'spaceId']
const rowKeys = new Set(['id', 'type', 'ownerId', 'layerId', 'visible', 'editable', 'geometry', 'geometryOmittedReason', 'spatialMatch'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = value => typeof value === 'string' && value.length > 0
const cursor = value => value === null || Number.isSafeInteger(value) && value >= 0

function context(value) {
  assert.ok(object(value) && !Object.hasOwn(value, 'status'), 'Reference receipt must be a native page, not a mutation/whole-result reference')
  for (const key of ['documentId', 'units', 'spaceId']) assert.ok(nonempty(value[key]), `Native page is missing ${key}`)
  assert.ok(Number.isSafeInteger(value.revision) && value.revision >= 0, 'Native page revision must be explicit and valid')
  assert.ok(Array.isArray(value.entities) && Array.isArray(value.layers) && object(value.pageEntityCounts), 'Native page must preserve its actual row/layer/count collections')
  assert.equal(typeof value.truncated, 'boolean'); assert.ok(Array.isArray(value.truncationReasons))
  assert.ok(cursor(value.nextOffset) && cursor(value.nextLayerOffset), 'Native page must preserve both continuation cursors')
  assert.ok(object(value.limits) && value.limits.maxGeometryBytes === 8192 && Number.isSafeInteger(value.limits.limit)
    && value.limits.limit >= 0 && value.limits.limit <= 200 && value.entities.length <= value.limits.limit
    && Number.isSafeInteger(value.limits.maxLayers) && value.limits.maxLayers >= 0 && value.limits.maxLayers <= 100
    && value.layers.length <= value.limits.maxLayers && Number.isSafeInteger(value.limits.maxBytes)
    && value.limits.maxBytes >= 1024 && value.limits.maxBytes <= 262144, 'Native page must retain its explicit bounded limits')
  return contextKeys.map(key => value[key])
}

function spatial(row, value) {
  if (Object.hasOwn(value, 'spatialQuery')) {
    const query = value.spatialQuery
    assert.ok(object(query) && Array.isArray(query.bounds) && query.bounds.length === 4 && query.bounds.every(Number.isFinite)
      && query.bounds[0] <= query.bounds[2] && query.bounds[1] <= query.bounds[3] && query.coordinates === 'owner-xy'
      && query.mode === 'crossing' && query.unclassifiedIncluded === true, 'Current spatial query must be explicit')
    assert.ok(Object.hasOwn(row, 'spatialMatch') && ['intersects', 'unclassified'].includes(row.spatialMatch), 'Only the current query classification is valid')
  } else assert.equal(Object.hasOwn(row, 'spatialMatch'), false, 'Absent current query means no spatial classification')
}

function fullRow(row, value, requireGeometry = false) {
  assert.ok(object(row) && !Object.hasOwn(row, 'nativeEntityReference'), 'Anchor must contain a full native row; reference chains are forbidden')
  assert.ok(Object.keys(row).every(key => rowKeys.has(key)), 'Unexpected native row field')
  assert.ok(nonempty(row.id) && nonempty(row.type), 'Native row identity/type must be complete')
  assert.equal(row.ownerId, value.spaceId, 'Native row owner must match its actual page space')
  assert.ok(row.layerId === null || nonempty(row.layerId)); assert.equal(typeof row.visible, 'boolean'); assert.equal(typeof row.editable, 'boolean')
  assert.ok(Object.hasOwn(row, 'geometry') && Object.hasOwn(row, 'geometryOmittedReason'), 'Native geometry/omission fields must be explicit')
  if (requireGeometry) assert.ok(object(row.geometry) && row.geometryOmittedReason === null
    && Buffer.byteLength(JSON.stringify(row.geometry)) <= value.limits.maxGeometryBytes, 'Anchor geometry must be complete and bounded, not omitted')
  spatial(row, value)
}

function counts(value, rows) {
  const expected = Object.create(null), ids = new Set()
  for (const row of rows) {
    assert.ok(nonempty(row.id) && nonempty(row.type) && !ids.has(row.id), 'Native page rows must have distinct identities and explicit types')
    ids.add(row.id); expected[row.type] = (expected[row.type] ?? 0) + 1
  }
  assert.deepEqual(Object.entries(value.pageEntityCounts).sort(), Object.entries(expected).sort(), 'Current page counts must match its actual rows, not an old inventory')
}

/** Return a detached decoded receipt; the real request and its wire stay exact. */
export function resolveChatToolReceipt(body, messageIndex) {
  assert.ok(object(body) && Array.isArray(body.messages), 'Actual chat wire messages are required')
  const messages = body.messages
  const index = messageIndex ?? messages.findLastIndex(message => message.role === 'tool')
  if (index === -1 && messageIndex === undefined) return null
  assert.ok(Number.isSafeInteger(index) && index >= 0 && index < messages.length && messages[index].role === 'tool', 'A current tool receipt index is required')
  const parse = message => {
    assert.equal(typeof message.content, 'string', 'Tool receipts must contain actual JSON wire content')
    const receipt = JSON.parse(message.content)
    assert.ok(object(receipt), 'Tool receipt must be an object')
    return receipt
  }
  const current = parse(messages[index])
  if (!Array.isArray(current.value?.entities) || !current.value.entities.some(row => object(row) && Object.hasOwn(row, 'nativeEntityReference'))) return structuredClone(current)
  assert.equal(current.ok, true, 'Failed receipts cannot carry native references')
  const scope = context(current.value)
  function callFor(receiptIndex) {
    const id = messages[receiptIndex].tool_call_id
    assert.ok(nonempty(id), 'Receipt must retain its actual tool call ID')
    assert.equal(messages.filter(message => message.role === 'tool' && message.tool_call_id === id).length, 1, 'Tool receipt call IDs must be unique')
    const calls = messages.flatMap((message, at) => message.role === 'assistant' && Array.isArray(message.tool_calls)
      ? message.tool_calls.filter(call => call.id === id).map(call => ({ at, call })) : [])
    assert.equal(calls.length, 1, 'The actual matching assistant tool call must be unique')
    assert.ok(calls[0].at < receiptIndex, 'Tool call must precede its receipt')
    assert.equal(calls[0].call.type, 'function'); assert.ok(readTools.has(calls[0].call.function?.name), 'Only native read calls may provide references')
    return calls[0]
  }
  const currentCall = callFor(index)
  const entities = current.value.entities.map(row => {
    if (!Object.hasOwn(row, 'nativeEntityReference')) { fullRow(row, current.value); return structuredClone(row) }
    assert.ok(Object.keys(row).every(key => ['id', 'nativeEntityReference', 'spatialMatch'].includes(key)), 'Reference wrappers cannot inject native fields')
    assert.ok(nonempty(row.id)); spatial(row, current.value)
    const ref = row.nativeEntityReference
    assert.ok(object(ref) && Object.keys(ref).sort().join(',') === 'originalEntityIndex,originalToolCallId', 'Reference must retain exactly its original call ID and entity index')
    assert.ok(typeof ref.originalToolCallId === 'string' && /^[a-zA-Z0-9_.:-]{1,256}$/.test(ref.originalToolCallId), 'Original tool call ID is invalid')
    assert.ok(Number.isSafeInteger(ref.originalEntityIndex) && ref.originalEntityIndex >= 0, 'Original entity index must be a nonnegative integer')
    const anchors = messages.map((message, at) => ({ message, at })).filter(item => item.message.role === 'tool' && item.message.tool_call_id === ref.originalToolCallId)
    assert.equal(anchors.length, 1, 'Reference must resolve one real retained receipt in this request')
    const anchor = anchors[0]
    assert.ok(anchor.at < index, 'Future/self references are forbidden')
    const anchorCall = callFor(anchor.at)
    assert.ok(anchorCall.at < currentCall.at, 'Same-batch references are forbidden')
    const original = parse(anchor.message)
    assert.equal(original.ok, true, 'Anchor must be a successful native read')
    assert.deepEqual(context(original.value), scope, 'Anchor document/revision/units/space must match the current receipt')
    assert.ok(original.value.entities.every(entity => object(entity) && !Object.hasOwn(entity, 'nativeEntityReference')), 'Anchor must be a retained complete receipt, not a reference chain')
    for (let at = anchor.at + 1; at < index; at++) if (messages[at].role === 'tool') {
      const intermediate = parse(messages[at])
      if (intermediate.ok === true && Array.isArray(intermediate.value?.entities))
        assert.deepEqual(context(intermediate.value), scope, 'References cannot survive an intervening native context change')
    }
    counts(original.value, original.value.entities)
    const entity = original.value.entities[ref.originalEntityIndex]
    assert.ok(entity, 'Original entity index is outside the actual anchor page')
    fullRow(entity, original.value, true)
    assert.equal(entity.id, row.id, 'Original entity index and current ID must identify the same native row')
    const restored = structuredClone(entity)
    delete restored.spatialMatch
    if (Object.hasOwn(row, 'spatialMatch')) restored.spatialMatch = row.spatialMatch
    return restored
  })
  counts(current.value, entities)
  return { ...structuredClone(current), value: { ...structuredClone(current.value), entities } }
}
