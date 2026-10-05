import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'
import { nativeHatchPattern } from '../../../packages/kjdraw-sdk/src/agent-hatch-pattern.js'
import { hatchPatternLines } from '../../../packages/kjdraw-sdk/src/geometry/hatch.js'
import { KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG } from '../../../packages/kjdraw-sdk/src/knowledge-packs/geology-patterns.js'

// Original public graphics, not a measured project or a geological source table.
// Model requests receive none of this oracle's IDs, answers or expected families.
export const NATIVE_HATCH_DEMO_PROVENANCE = Object.freeze({
  schema: 'com.kanjie.kjdraw.public-native-hatch-demo@1', synthetic: true,
  measuredData: false, license: 'Apache-2.0',
  source: 'original synthetic 10-by-3 and 10-by-2 rectangles with islands',
  patternSource: 'explicitly authorized public bundled 209-pattern catalog',
  initialCreation: 'trusted-host-fixture-not-model-creation',
  approval: 'automated-host-review-harness-not-human-acceptance',
  scope: 'native imported DXF pattern editing; no inferred geological facts',
})
export const NATIVE_HATCH_DEMO_ROUNDS = Object.freeze([
  { id: 'substitute', prompt: '素填土改为杂填土', name: '杂填土', scale: 0.5, degrees: 0 },
  { id: 'scale-angle', prompt: '杂填土的花纹比例改为0.75，角度改为30度。', name: '杂填土', scale: 0.75, degrees: 30 },
  { id: 'cancel', prompt: '杂填土改为黄土', name: '黄土', scale: 0.75, degrees: 30, reject: true },
  { id: 'loess', prompt: '杂填土改为黄土', name: '黄土', scale: 0.75, degrees: 30 },
  { id: 'gravel', prompt: '黄土改为卵石', name: '卵石', scale: 0.75, degrees: 30 },
  { id: 'clay', prompt: '卵石改为粉质粘土', name: '粉质粘土', scale: 0.75, degrees: 30 },
  { id: 'restore', prompt: '粉质粘土改为素填土', name: '素填土', scale: 0.75, degrees: 30 },
  { id: 'final', prompt: '素填土改为杂填土，花纹比例设为0.5，角度设为0度。', name: '杂填土', scale: 0.5, degrees: 0 },
].map(Object.freeze))
export const NATIVE_HATCH_PATTERN_FIELDS = Object.freeze([
  'patternName', 'solid', 'patternLines', 'patternDefinitionAngle',
  'patternDefinitionScale', 'patternScale', 'patternAngle',
])
const patternFields = new Set(NATIVE_HATCH_PATTERN_FIELDS)
const record = (...tags) => `${tags.join('\n')}\n`
function tagPairs(text) {
  const lines = text.trimEnd().split('\n')
  assert.equal(lines.length % 2, 0)
  return Array.from({ length: lines.length / 2 }, (_, index) => ({ code: Number(lines[index * 2]), value: lines[index * 2 + 1] }))
}

export function publicNativeHatchPattern(name) {
  const pattern = KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG.patterns.find(item => item.name === name)
  assert.ok(pattern, `Public catalog requires the exact literal name ${name}`)
  return pattern
}

export async function createPublicNativeHatchFixture() {
  const sdk = createKJDrawSDK(), source = sdk.createDocument({
    documentId: 'public-native-hatch-two-rectangles', units: 'millimeter',
    title: 'Original public synthetic native hatch sheet',
  })
  const pattern = publicNativeHatchPattern('素填土')
  const shapes = [
    { id: 'public-hatch-a', style: 1, outer: [[0, 0], [10, 0], [10, 3], [0, 3]], island: [[4.5, 1], [5.5, 1], [5.5, 2], [4.5, 2]] },
    { id: 'public-hatch-b', style: 2, outer: [[0, 5], [10, 5], [10, 7], [0, 7]], island: [[4.5, 5.75], [5.5, 5.75], [5.5, 6.25], [4.5, 6.25]] },
  ]
  await source.transact('Compile original public native geometry', tx => {
    for (const shape of shapes) {
      const loops = [shape.outer, shape.island].map((vertices, index) => ({
        flags: index ? 18 : 3, external: true, closed: true, vertices,
        sourceBoundaryIds: [`${shape.id}-${index ? 'island' : 'outer'}`],
      }))
      tx.createEntity('HATCH', { patternName: pattern.name, solid: false, associative: true,
        hatchStyle: shape.style, patternScale: 0.5, patternAngle: 0,
        patternDefinitionScale: 1, patternDefinitionAngle: 0,
        patternLines: structuredClone(pattern.lines), boundaryLoops: loops,
      }, { id: shape.id })
      for (const loop of loops) tx.createEntity('LWPOLYLINE', {
        closed: true, vertices: loop.vertices, dxfReactorIds: [shape.id],
      }, { id: loop.sourceBoundaryIds[0] })
    }
    tx.createEntity('LINE', { start: [-1, -1, 0], end: [11, -1, 0] }, { id: 'public-untouched-line' })
    tx.createEntity('TEXT', { text: 'ORIGINAL PUBLIC SYNTHETIC NOTE — KEEP UNCHANGED',
      position: [0, -2, 0], alignmentPoint: [0, -2, 0], height: 0.5 }, { id: 'public-untouched-note' })
  })
  // Native legal extension dictionary/XDATA and paper metadata are intentionally
  // present. This public fixture follows the independent association fixtures,
  // not any private drawing. No destination pattern is placed in the DXF.
  const hatch = source.getObject('public-hatch-a'), boundary = source.getObject('public-hatch-a-outer')
  const layout = source.getObject(source.spaces.layoutIds[1])
  const viewport = record(0, 'VIEWPORT', 5, 'F01', 102, '{ACAD_REACTORS', 330, 'F02', 102, '}',
    330, source.getObject(layout.payload.blockRecordId).handle, 100, 'AcDbEntity', 8, '0', 67, 1, 410, 'Layout1',
    100, 'AcDbViewport', 10, 50, 20, 50, 30, 0, 40, 90, 41, 80, 68, 1, 69, 2,
    12, 0, 22, 0, 16, 0, 26, 0, 36, 1, 17, 0, 27, 0, 37, 0, 45, 80, 90, 0)
  const metadataObjects = record(0, 'DICTIONARY', 5, 'F02', 330, hatch.handle, 100, 'AcDbDictionary', 281, 1,
    3, 'SYNTHETIC_DATA', 360, 'F03') + record(0, 'XRECORD', 5, 'F03', 330, 'F02',
    100, 'AcDbXrecord', 280, 1, 1, 'original public synthetic metadata')
  const appid = record(0, 'TABLE', 2, 'APPID', 5, 'F10', 330, 0, 100, 'AcDbSymbolTable', 70, 1,
    0, 'APPID', 5, 'F11', 330, 'F10', 100, 'AcDbSymbolTableRecord', 100, 'AcDbRegAppTableRecord',
    2, 'PUBLIC_NATIVE_HATCH', 70, 0, 0, 'ENDTAB')
  const xdata = record(1001, 'PUBLIC_NATIVE_HATCH', 1000, 'original public synthetic metadata',
    1002, '{', 1070, 17, 1040, 2.5, 1010, 1.5, 1020, 2.5, 1030, 0,
    1004, '0AFF', 1005, boundary.handle, 1005, 'F03', 1002, '}')
  let dxf = String(await sdk.writeDocument(source, { format: 'DXF' })).replaceAll('\r\n', '\n')
  dxf = dxf.replace(record(0, 'HATCH', 5, hatch.handle), record(0, 'HATCH', 5, hatch.handle,
    102, '{ACAD_XDICTIONARY', 360, 'F02', 102, '}'))
  const tags = tagPairs(dxf)
  const start = tags.findIndex((tag, index) => tag.code === 0 && tag.value === 'HATCH' && tags[index + 1]?.value === hatch.handle)
  const end = tags.findIndex((tag, index) => index > start && tag.code === 0)
  assert.ok(start >= 0 && end > start, 'Exact first public HATCH record required')
  const enriched = tags.slice(start, end)
  const subclass = enriched.findIndex(tag => tag.code === 100 && tag.value === 'AcDbHatch')
  assert.ok(subclass > 0)
  enriched.splice(subclass, 0, ...tagPairs(record(430, 'PUBLIC$SYNTHETIC', 440, 33554560, 284, 2)))
  const seed = enriched.findIndex(tag => tag.code === 98)
  if (seed >= 0) {
    assert.equal(enriched[seed].value, '0')
    enriched.splice(seed, 1, ...tagPairs(record(47, 0.125, 98, 1, 10, 1, 20, 1)))
  } else enriched.push(...tagPairs(record(47, 0.125, 98, 1, 10, 1, 20, 1)))
  tags.splice(start, end - start, ...enriched, ...tagPairs(xdata))
  dxf = tags.map(tag => `${tag.code}\n${tag.value}\n`).join('')
  dxf = dxf.replace('0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n', `${appid}0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n`)
    .replace('0\nENDSEC\n0\nSECTION\n2\nOBJECTS\n', `${viewport}0\nENDSEC\n0\nSECTION\n2\nOBJECTS\n`)
    .replace('0\nENDSEC\n0\nEOF\n', `${metadataObjects}0\nENDSEC\n0\nEOF\n`)
  const document = await sdk.readDocument(dxf, { format: 'DXF' })
  assert.equal(document.validate().valid, true)
  assert.equal(document.listEntities({ type: 'HATCH' }).length, 2)
  assert.ok(document.listEntities({ type: 'HATCH' }).every(item => item.payload.patternName === '素填土'))
  assert.ok(!dxf.includes('杂填土'), 'Destination must not be a donor in the source DXF')
  assertNativeHatchAssociations(document)
  return { sdk, document, dxf, provenance: NATIVE_HATCH_DEMO_PROVENANCE }
}

export function assertNativeHatchAssociations(document) {
  for (const hatch of document.listEntities({ type: 'HATCH' })) {
    assert.equal(hatch.payload.associative, true)
    assert.equal(hatch.payload.boundaryLoops.length, 2)
    for (const loop of hatch.payload.boundaryLoops) {
      assert.equal(loop.sourceBoundaryIds.length, 1)
      const boundary = document.getObject(loop.sourceBoundaryIds[0])
      assert.ok(boundary && !boundary.erased)
      assert.equal(boundary.ownerId, hatch.ownerId)
      assert.deepEqual(loop.sourceBoundaryHandles, [boundary.handle])
      assert.deepEqual(boundary.payload.dxfReactorIds, [hatch.id])
    }
  }
}

const withoutPattern = payload => Object.fromEntries(Object.entries(payload).filter(([key]) => !patternFields.has(key)))
function near(actual, expected, label) {
  if (typeof expected === 'number') assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), label)
  else if (Array.isArray(expected)) { assert.equal(actual.length, expected.length, label); expected.forEach((item, index) => near(actual[index], item, label)) }
  else if (expected && typeof expected === 'object') { assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), label); for (const key of Object.keys(expected)) near(actual[key], expected[key], label) }
  else assert.equal(actual, expected, label)
}
export function assertNativeHatchChange(before, after, expected) {
  const hatches = before.listEntities({ type: 'HATCH' }), ids = new Set(hatches.map(item => item.id))
  assert.equal(ids.size, 2)
  assert.deepEqual(after.listEntities().map(item => item.id).sort(), before.listEntities().map(item => item.id).sort())
  const beforeState = before.snapshot(), afterState = after.snapshot()
  for (const field of Object.keys(beforeState).filter(field => !['objects', 'opaquePayloads', 'metadata', 'revision', 'revisions'].includes(field)))
    assert.deepEqual(afterState[field], beforeState[field], `Unrequested document ${field} must remain exact`)
  assert.deepEqual({ ...afterState.metadata, modifiedAt: null }, { ...beforeState.metadata, modifiedAt: null },
    'Document metadata must remain exact apart from expected transaction modification time')
  assert.deepEqual(Object.keys(afterState.objects).sort(), Object.keys(beforeState.objects).sort())
  assert.deepEqual(afterState.opaquePayloads, beforeState.opaquePayloads, 'All source metadata graphs must remain exact')
  for (const [id, object] of Object.entries(beforeState.objects)) {
    const actual = afterState.objects[id]
    if (!ids.has(id)) assert.deepEqual(actual, object, `Unrequested object ${object.type} must remain exact`)
    else {
      assert.deepEqual({ ...actual, payload: withoutPattern(actual.payload) }, { ...object, payload: withoutPattern(object.payload) }, 'Native metadata, handle, owner, islands and boundaries must remain exact')
      const pattern = nativeHatchPattern(actual.payload)
      near(pattern, { patternName: expected.name, solid: false, patternLines: publicNativeHatchPattern(expected.name).lines,
        patternDefinitionAngle: 0, patternDefinitionScale: 1, patternScale: expected.scale, patternAngle: expected.degrees * Math.PI / 180 }, 'Complete catalog line families, scale and angle must match, not only the name')
    }
  }
  assertNativeHatchAssociations(after)
  assert.equal(after.validate().valid, true)
  assert.notEqual(after.fingerprint(), before.fingerprint(), 'Approved change must affect real native geometry')
  return { targets: ids.size, untouchedObjects: Object.keys(beforeState.objects).length - ids.size,
    retainedHatchStyles: hatches.map(item => item.payload.hatchStyle ?? 0), boundaryLoops: 4,
    unrequestedDocumentMetadataExact: true }
}

function references(value, document) {
  if (typeof value === 'string') {
    const object = document.getObject(value)
    return object ? ['table-record', 'block-record'].includes(object.kind)
      ? { kind: object.kind, type: object.type, name: object.name } : object.handle : value
  }
  if (Array.isArray(value)) return value.map(item => references(item, document))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, references(item, document)]))
  return value
}
function semanticEntity(entity, document) {
  const { rawTags, ...originalPayload } = entity.payload
  // DXF stores transformed line families, while a pending native edit can keep
  // the untransformed catalog definition. Compare effective geometry, retaining
  // the actual name/solid/scale/angle, not representation-only definition flags.
  const payload = entity.type === 'HATCH' ? { ...withoutPattern(originalPayload),
    patternName: originalPayload.patternName, solid: originalPayload.solid,
    patternScale: originalPayload.patternScale, patternAngle: originalPayload.patternAngle,
    effectivePatternLines: hatchPatternLines(originalPayload) } : originalPayload
  const metadata = (rawTags ?? []).filter(tag => tag.code >= 1000 || [430, 440, 284, 47, 77, 98, 360].includes(tag.code))
  return { type: entity.type, handle: entity.handle, owner: references(entity.ownerId, document),
    payload: references(payload, document), metadata }
}
export function assertNativeHatchDxf(before, reopened) {
  assert.equal(reopened.validate().valid, true)
  assert.equal(reopened.listEntities().length, before.listEntities().length)
  const byHandle = new Map(reopened.listEntities().map(item => [item.handle, item]))
  for (const item of before.listEntities()) {
    const actual = byHandle.get(item.handle)
    assert.ok(actual, 'Every native entity handle must survive DXF reopening')
    near(semanticEntity(actual, reopened), semanticEntity(item, before), `DXF native closure for ${item.type}`)
  }
  assertNativeHatchAssociations(reopened)
  return { entities: byHandle.size, hatches: 2, boundaryLoops: 4 }
}

export function assertNativeHatchModelReads(outputs, document) {
  const ids = document.listEntities({ type: 'HATCH' }).map(item => item.id).sort()
  assert.equal(ids.length, 2)
  const reads = outputs.filter(call => call.result?.ok)
  const catalogs = reads.filter(call => call.name === 'cad_read_hatch_patterns')
  const matchesDrawing = value => value?.documentId === document.id && value.revision === document.revision
  const matchesIds = actualIds => actualIds.length === ids.length && actualIds.every((id, index) => id === ids[index])
  const nativeCatalogRead = catalogs.some(call => {
    if (!matchesDrawing(call.result.value)) return false
    const patterns = call.result.value?.patterns ?? []
    const actualIds = [...new Set(patterns.filter(pattern => pattern.source === 'drawing'
      && pattern.entityIdsTruncated === false).flatMap(pattern => pattern.entityIds ?? []))].sort()
    return matchesIds(actualIds)
  })
  const nativeQueryRead = reads.some(call => {
    if (!['cad_query_drawing', 'cad_read_drawing', 'cad_read_page'].includes(call.name) || !matchesDrawing(call.result.value)) return false
    const actualIds = [...new Set((call.result.value.entities ?? []).filter(entity => entity.type === 'HATCH').map(entity => entity.id))].sort()
    return matchesIds(actualIds)
  })
  assert.ok(nativeCatalogRead || nativeQueryRead,
    'Model must actually inspect the native drawing, including exact native pattern-target discovery')
  assert.ok(catalogs.length, 'Model must itself inspect actual pattern resources')
  assert.ok(reads.some(call => call.name === 'cad_propose_hatch_pattern'), 'Real tool proposal required')
  return { nativeCatalogRead, nativeQueryRead, revision: document.revision, actualReadTools: reads.map(call => call.name) }
}

export async function proposePublicNativeHatch(sdk, document, expected) {
  const session = new KJAgentToolSession(sdk, document)
  const query = await session.call('cad_query_drawing', { expectedRevision: document.revision,
    filters: { types: ['HATCH'] }, offset: 0, layerOffset: 0, limit: 64, maxLayers: 64, maxBytes: 262144 })
  assert.equal(query.ok, true, canonicalStringify(query))
  const catalog = await session.call('cad_read_hatch_patterns', { expectedRevision: document.revision, search: expected.name, limit: 64, maxBytes: 262144 })
  assert.equal(catalog.ok, true, 'Default SDK/session catalog must supply the public missing destination')
  const pattern = catalog.value.patterns.find(item => item.name === expected.name && item.source === 'catalog')
    ?? catalog.value.patterns.find(item => item.name === expected.name)
  assert.ok(pattern, `Default catalog must include ${expected.name}`)
  const proposal = await session.call('cad_propose_hatch_pattern', { expectedRevision: document.revision,
    units: document.snapshot().header.units, ids: document.listEntities({ type: 'HATCH' }).map(item => item.id),
    patternId: pattern.patternId, patternScale: expected.scale, patternAngleDegrees: expected.degrees })
  assert.equal(proposal.ok, true, canonicalStringify(proposal))
  return { session, proposal: proposal.value }
}
