import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createAgentHatchPatternCatalog } from '../packages/kjdraw-sdk/src/agent-hatch-pattern.js'
import { createEraseImpact } from '../packages/kjdraw-sdk/src/erase-impact.js'
import { createAgentGeometryPreview } from '../packages/kjdraw-sdk/src/agent-preview.js'
import { displayedEntityBounds } from '../packages/kjdraw-sdk/src/selection-geometry.js'

// Read-only feasibility proof, not model acceptance and not a request rewrite.
// The input is the already-published original public synthetic DXF. No private
// facts/drawings are read; no fixture export, model call or host approval occurs.
const publicDxf = new URL('../docs/media/ai-geology-live-20261003/synthetic-geology-section.dxf', import.meta.url)
const counts = records => Object.fromEntries([...new Set(records.map(record => record.type))].map(type => [type, records.filter(record => record.type === type).length]))
const xy = (x, y) => ({ x, y })
async function fixture(t) {
  const bytes = await readFile(publicDxf), sdk = createKJDrawSDK(), document = await sdk.readDocument(bytes, { format: 'DXF' })
  t.after(async () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id); assert.deepEqual(await readFile(publicDxf), bytes) })
  const all = document.listEntities(), handles = (first, last) => all.filter(record => { const handle = Number.parseInt(record.handle, 16); return handle >= first && handle <= last })
  const column = handles(0x52, 0x75), bands = handles(0x172, 0x189), leftHatches = column.filter(record => record.type === 'HATCH')
  assert.equal(all.length, 542)
  assert.deepEqual(counts(column), { LINE: 11, LWPOLYLINE: 4, TEXT: 15, HATCH: 6 })
  assert.equal(column.find(record => record.type === 'TEXT' && record.payload.text === 'SYN-01').payload.position[0], 52)
  assert.deepEqual(counts(bands), { HATCH: 6, LINE: 12, TEXT: 6 })
  const rightHatches = all.filter(record => record.type === 'HATCH').filter(record => {
    const box = displayedEntityBounds(document, record)
    return Math.abs(box[0] - 86.4) < 1e-9 && Math.abs(box[2] - 89.6) < 1e-9
  })
  assert.equal(rightHatches.length, 6)
  const left = leftHatches.map(record => displayedEntityBounds(document, record)), right = rightHatches.map(record => displayedEntityBounds(document, record))
  const leftLevels = [left[0][3], ...left.map(box => box[1])], rightLevels = [right[0][3], ...right.map(box => box[1])]
  const layerId = document.getTable('layers').records.find(record => record.name === 'GEO_BOUNDARY').id,
    textLayerId = document.getTable('layers').records.find(record => record.name === 'GEO_TEXT').id,
    bank = createAgentHatchPatternCatalog(document, sdk.hatchPatternCatalogs).entries
  const line = (x1, y1, x2, y2) => ({ start: xy(x1, y1), end: xy(x2, y2), layerId })
  // Reuse publicly visible native horizon coordinates for this feasibility
  // example only. Labels explicitly say simulation, never measured/source data.
  const creations = {
    hatches: leftHatches.map(record => ({
      loops: record.payload.boundaryLoops.map(loop => ({ vertices: loop.vertices.map(vertex => { const point = vertex.point ?? vertex; return xy(point[0], point[1]) }) })),
      patternId: bank.find(entry => entry.name === record.payload.patternName).patternId,
      patternScale: record.payload.patternScale, patternAngleDegrees: record.payload.patternAngle * 180 / Math.PI, layerId: record.payload.layerId,
    })),
    polylines: [{ vertices: [xy(50.4, 90), xy(53.6, 90), xy(53.6, 240), xy(50.4, 240)], closed: true, layerId }],
    lines: [...leftLevels.slice(1, -1).map(y => line(50.4, y, 53.6, y)), ...leftLevels.map((y, index) => line(53.6, y, 86.4, rightLevels[index]))],
    texts: [{ text: 'SIM-01（模拟）', position: xy(48, 250), height: 1.5, rotationDegrees: 0, layerId: textLayerId },
      ...left.map((box, index) => ({ text: '模拟层' + (index + 1), position: xy(55, (box[1] + box[3]) / 2), height: 1.35, rotationDegrees: 0, layerId: textLayerId }))],
  }
  const args = eraseRecords => ({ expectedRevision: document.revision, units: 'millimeter', eraseIds: eraseRecords.map(record => record.id), tolerance: .001, maxBytes: 262144, creations })
  const native = []
  const append = (type, payload) => native.push({ id: 'public-feasibility-' + native.length, type, payload })
  for (const item of creations.hatches) append('HATCH', { ...structuredClone(bank.find(entry => entry.patternId === item.patternId).pattern),
    patternScale: item.patternScale, patternAngle: item.patternAngleDegrees * Math.PI / 180, layerId: item.layerId,
    boundaryLoops: item.loops.map((loop, index) => ({ external: index === 0, closed: true, vertices: loop.vertices.map(point => [point.x, point.y, 0]) })) })
  for (const item of creations.polylines) append('LWPOLYLINE', { vertices: item.vertices.map(point => [point.x, point.y, 0]), closed: item.closed, layerId: item.layerId })
  for (const item of creations.lines) append('LINE', { start: [item.start.x, item.start.y, 0], end: [item.end.x, item.end.y, 0], layerId: item.layerId })
  for (const item of creations.texts) append('TEXT', { text: item.text, position: [item.position.x, item.position.y, 0], height: item.height, rotation: 0, layerId: item.layerId })
  return { sdk, document, column, bands, creations, args, native, session: new KJAgentToolSession(sdk, document) }
}
const impact = (fixture, records) => createEraseImpact(fixture.document, { expectedRevision: fixture.document.revision, units: 'millimeter', operation: 'erase',
  ids: records.map(record => record.id), tolerance: .001, maxBytes: 262144 })

test('actual public SYN-01 erase effects are 36 native column records or 60 including obsolete six-band graphics; no hidden ownership or source recipe', async t => {
  const f = await fixture(t), before = f.document.snapshot()
  for (const records of [f.column, [...f.column, ...f.bands]]) {
    const result = impact(f, records)
    assert.equal(result.canErase, true); assert.equal(result.effectiveEraseIds.length, records.length)
    assert.deepEqual(new Set(result.effectiveEraseIds), new Set(records.map(record => record.id)))
    assert.deepEqual(result.blockers, []); assert.deepEqual(result.groups, []); assert.deepEqual(result.selectionSets, [])
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 262144)
  }
  assert.deepEqual(Object.fromEntries(Object.entries(f.creations).map(([key, values]) => [key, values.length])), { hatches: 6, polylines: 1, lines: 12, texts: 7 })
  assert.equal(f.native.length, 26); assert.equal(f.column.length + f.native.length, 62)
  assert.equal(f.column.length + f.bands.length + f.native.length, 86)
  assert.equal(Object.keys(f.document.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:')), false)
  assert.equal(f.document.snapshot(), before); assert.deepEqual(f.sdk.agentPlans.list(), [])
})

test('current 16-creation guard falsely rejects the readable 26-entity six-layer example even when its exact footprint is 62 records', async t => {
  const f = await fixture(t), before = f.document.snapshot(), result = await f.session.call('cad_propose_structural_edit', f.args(f.column))
  assert.equal(result.ok, false); assert.match(result.error.message, /at most 16 creations plus reconnections/)
  assert.equal(f.document.snapshot(), before); assert.deepEqual(f.sdk.agentPlans.list(), [])
})

test('current 64-record guard independently rejects a 76-record bounded core probe; the complete six-layer redraw actually needs 86', async t => {
  const f = await fixture(t), before = f.document.snapshot(), eraseIds = [...f.column, ...f.bands].map(record => record.id)
  const preview = await createAgentGeometryPreview(f.document, 'STRUCTURALEDIT', { eraseIds, reconnections: [] })
  assert.equal(preview.before.length, 60); assert.equal(preview.after.length, 0)
  // A diagnostic 16-creation subset isolates the second guard. This subset is
  // never proposed/approved as a completed request and does not trim its scope.
  await assert.rejects(createAgentGeometryPreview(f.document, 'STRUCTURALEDIT', { eraseIds, reconnections: [], creations: f.native.slice(0, 16) }), /64 total/)
  assert.equal(eraseIds.length + f.native.length, 86)
  assert.equal(f.document.snapshot(), before); assert.deepEqual(f.sdk.agentPlans.list(), [])
})
