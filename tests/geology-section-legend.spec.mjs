import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { syntheticGeologySectionInput, createSyntheticGeologyDemo, proposeSyntheticGeologyScenario } from '../examples/synthetic-geology-demo.mjs'

const clone = value => structuredClone(value)
const layout = input => input.sectionStylePack.rules['geology-section-layout']
const region = input => layout(input).legendStyle
const inLegend = (input, entity) => {
  const style = region(input), [dx, dy] = layout(input).drawingOrigin ?? [0, 0]
  const point = entity.type === 'TEXT' ? entity.payload.position : entity.payload.boundaryLoops?.[0]?.vertices?.[0]
  return point && point[0] >= style.left + dx && point[0] <= style.right + dx && point[1] >= style.bottom + dy && point[1] <= style.top + dy
}
const legend = input => {
  const result = compileGeologySection(input), all = result.commandArgs.entities
  return { result, all, labels: all.filter(entity => entity.type === 'TEXT' && inLegend(input, entity)),
    hatches: all.filter(entity => entity.type === 'HATCH' && inLegend(input, entity)) }
}
const patternFacts = entity => {
  const { boundaryLoops, ...facts } = entity.payload
  return facts
}
const roomForVariants = input => { region(input).columns = 8; return input }

test('omitting the optional legend preserves the previous public compiler output bytes, IDs and evidence', () => {
  const input = syntheticGeologySectionInput(); delete input.sectionStylePack
  const result = compileGeologySection(input)
  // Captured from the unchanged generated compiler before the legend TS emit.
  assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), '9ea88fb34a94ed288a964cf4fea527dcc763d2200ec7f507f32548146507c1a8')
  assert.equal(result.commandArgs.entities.length, 523)
  assert.equal(Object.hasOwn(result.evidence.parameters, 'sourceLinkedLegendEntryCount'), false)
  const explicitDefault = syntheticGeologySectionInput(); explicitDefault.sectionStylePack = clone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  assert.equal(compileGeologySection(explicitDefault).commandArgs.entities.length, 523)
})

test('explicit source-linked legend emits six exact native names and the actually resolved original hatch payloads', () => {
  for (const locale of ['zh-CN', 'en']) {
    const input = syntheticGeologySectionInput(locale), actual = legend(input)
    assert.deepEqual(actual.labels.map(entity => entity.payload.text), input.holes[0].strata.map(layer => layer.name))
    assert.equal(actual.result.evidence.parameters.sourceLinkedLegendEntryCount, 6)
    assert.equal(actual.result.evidence.parameters.sourceLinkedLegendHatchCount, 6)
    assert.equal(actual.all.length, 541)
    assert.equal(actual.hatches.length, 6)
    for (const entity of actual.hatches) {
      const matching = actual.all.find(other => other.type === 'HATCH' && !inLegend(input, other) && other.payload.patternName === entity.payload.patternName)
      assert.ok(matching, 'legend pattern must actually exist in a supplied borehole')
      assert.deepEqual(patternFacts(entity), patternFacts(matching), 'the complete resolved pattern, not a guessed lithology icon, is shared')
    }
    assert.equal(new Set(actual.all.map(entity => entity.options.id)).size, actual.all.length)
  }
})

test('legend never merges different measured names sharing a lithology or pattern', () => {
  const input = roomForVariants(syntheticGeologySectionInput())
  input.holes[1].strata[0].name = '示例另名填土'
  const actual = legend(input)
  assert.equal(actual.labels.length, 7); assert.equal(actual.hatches.length, 7)
  assert.ok(actual.labels.some(entity => entity.payload.text === '示例另名填土'))
  assert.ok(actual.labels.some(entity => entity.payload.text === '示例填土'))
  assert.equal(actual.hatches.filter(entity => entity.payload.patternName === 'GEO_FILL').length, 2)
})

test('same exact name with different actual patterns remains two distinct legend entries', () => {
  const input = roomForVariants(syntheticGeologySectionInput())
  // Keep real source lithologies and links compatible; only the independently
  // supplied clay interval name happens to match the fill interval name.
  input.holes[1].strata[1].name = input.holes[1].strata[0].name
  const actual = legend(input)
  assert.equal(actual.labels.filter(entity => entity.payload.text === '示例填土').length, 2)
  assert.equal(actual.labels.length, 7); assert.equal(actual.hatches.length, 7)
  assert.equal(actual.hatches.filter(entity => entity.payload.patternName === 'GEO_FINE_SOIL').length, 2)
})

test('explicit licensed pattern override is resolved exactly without guessing from the source name', () => {
  const input = roomForVariants(syntheticGeologySectionInput())
  input.hatchPack = clone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  input.holes[1].strata[0].patternKey = 'sand'
  const actual = legend(input)
  assert.equal(actual.labels.filter(entity => entity.payload.text === '示例填土').length, 2)
  assert.equal(actual.hatches.filter(entity => entity.payload.patternName === 'GEO_SAND').length, 2)
  delete input.hatchPack
  assert.throws(() => compileGeologySection(input), /declared pattern key requires a licensed hatch pack/)
})

test('boundary-only visibility gets an exact label and native unfilled outline, not an invented hatch', () => {
  const input = roomForVariants(syntheticGeologySectionInput())
  input.holes[1].strata[0].patternVisibility = 'boundary-only'
  const actual = legend(input)
  assert.equal(actual.labels.length, 7); assert.equal(actual.hatches.length, 6)
  assert.equal(actual.labels.filter(entity => entity.payload.text === '示例填土').length, 2)
  assert.equal(actual.result.evidence.parameters.sourceLinkedLegendHatchCount, 6)
  const outlineCount = actual.all.filter(entity => entity.type === 'LWPOLYLINE' && entity.payload.closed &&
    entity.payload.vertices.every(([x, y]) => x >= region(input).left && x <= region(input).right && y >= region(input).bottom && y <= region(input).top)).length
  assert.equal(outlineCount, 7)
})

test('declared presentation scale/angle is identical on the source borehole and its legend swatch', () => {
  const input = syntheticGeologySectionInput()
  layout(input).sectionHatchPresentation = { boreholeColumn: { patternScale: 1.1, patternAngle: 22 }, stratigraphicBand: { patternScale: .8, patternAngle: 5 } }
  const actual = legend(input)
  for (const hatch of actual.hatches) {
    assert.equal(hatch.payload.patternScale, 1.1); assert.equal(hatch.payload.patternAngle, 22)
    assert.ok(actual.all.some(entity => entity.type === 'HATCH' && !inLegend(input, entity) &&
      JSON.stringify(patternFacts(entity)) === JSON.stringify(patternFacts(hatch))))
  }
})

test('legend density and exact source names fail closed instead of hiding facts or abbreviating', () => {
  const dense = syntheticGeologySectionInput(); dense.holes[1].strata[0].name = '示例另名填土'
  assert.throws(() => compileGeologySection(dense), /entry\/row density; names must never be omitted/)
  const long = syntheticGeologySectionInput(); for (const hole of long.holes) hole.strata[0].name = '示'.repeat(63)
  assert.throws(() => compileGeologySection(long), /exact source interval name does not fit/)
  const narrow = syntheticGeologySectionInput(); region(narrow).right = 60
  assert.throws(() => compileGeologySection(narrow), /exact source interval name does not fit/)
})

test('legend schema, finite bounds, readability and reserved strip exclude plot/title/footer areas', () => {
  const invalid = [{ left: 11 }, { right: 409 }, { right: 12 }, { bottom: 257.9 }, { bottom: 22 }, { top: 267 },
    { top: 277 }, { top: 258 }, { columns: 0 }, { columns: 17 }, { columns: 1.5 }, { swatchWidth: 1 },
    { swatchWidth: 21 }, { swatchHeight: 1 }, { swatchHeight: 11 }, { textHeight: 1 }, { textHeight: 6 },
    { textWidthFactor: .4 }, { textWidthFactor: 1.6 }, { gap: .4 }, { gap: 4.1 }, { left: Number.NaN }, { top: Infinity }]
  for (const fields of invalid) {
    const input = syntheticGeologySectionInput(); Object.assign(region(input), fields)
    assert.throws(() => compileGeologySection(input), /Geology:.*(legend|finite)/, JSON.stringify(fields))
  }
  const missing = syntheticGeologySectionInput(); delete region(missing).gap
  assert.throws(() => compileGeologySection(missing), /exact declarative placement schema/)
  const extra = syntheticGeologySectionInput(); region(extra).guessLithology = true
  assert.throws(() => compileGeologySection(extra), /exact declarative placement schema/)
})

test('actual preexisting annotation collisions fail closed rather than overlaying title/scale text', () => {
  const input = syntheticGeologySectionInput()
  layout(input).headingTextStyle = {
    title: { anchorX: 210, height: 5, horizontalAlignment: 1, verticalAlignment: 0, textWidthFactor: 1 },
    scale: { anchorX: 210, height: 12, horizontalAlignment: 1, verticalAlignment: 3, textWidthFactor: 1 },
  }
  assert.throws(() => compileGeologySection(input), /legend overlaps existing native geometry or annotation/)
})

test('actual constant-width frame strokes are included in legend collision checks, not only their centerlines', () => {
  const input = syntheticGeologySectionInput()
  const base = { primitive: 'closed-polyline', startCorner: 'bottom-left', winding: 'counter-clockwise', constantWidth: 0 }
  layout(input).frameStyle = { outer: clone(base), inner: { ...base, constantWidth: 5 } }
  // Inner frame centerline x=12 is outside the first swatch x=14, but its
  // actual 5-mm stroke reaches x=14.5 and overlaps the native swatch by 0.5mm.
  assert.equal(region(input).left + region(input).gap, 14)
  assert.equal(layout(input).innerMargin + layout(input).frameStyle.inner.constantWidth / 2, 14.5)
  assert.throws(() => compileGeologySection(input), /legend overlaps existing native geometry or annotation/)
  const withoutLegend = clone(input); delete layout(withoutLegend).legendStyle
  assert.ok(compileGeologySection(withoutLegend).commandArgs.entities.some(entity => entity.type === 'LWPOLYLINE' && entity.payload.constantWidth === 5),
    'legacy drawings with no requested legend still emit the exact declared wide frame')
})

test('native TEXT middle alignment forces vertical centering and cannot overlap the legend as a nominal baseline', () => {
  const input = syntheticGeologySectionInput()
  layout(input).headingTextStyle = {
    title: { anchorX: 210, height: 5, horizontalAlignment: 1, verticalAlignment: 0, textWidthFactor: 1 },
    scale: { anchorX: 210, height: 12, horizontalAlignment: 4, verticalAlignment: 0, textWidthFactor: 1 },
  }
  assert.equal(layout(input).scaleY - layout(input).headingTextStyle.scale.height / 2, 262)
  assert.equal(region(input).top, 264)
  assert.throws(() => compileGeologySection(input), /legend overlaps existing native geometry or annotation/)
  const withoutLegend = clone(input); delete layout(withoutLegend).legendStyle
  const scale = compileGeologySection(withoutLegend).commandArgs.entities.find(entity => entity.type === 'TEXT' && entity.payload.horizontalAlignment === 4)
  assert.equal(scale.payload.height, 12)
  assert.equal(scale.payload.verticalAlignment, undefined, 'the legacy native baseline/middle payload is not rewritten')
})

test('translated drawing origins move native legend and collision region together without changing exact source names', () => {
  const input = syntheticGeologySectionInput(); layout(input).drawingOrigin = [300, -100]
  const actual = legend(input)
  assert.deepEqual(actual.labels.map(entity => entity.payload.text), input.holes[0].strata.map(layer => layer.name))
  assert.equal(actual.hatches.length, 6)
  for (const label of actual.labels) assert.ok(label.payload.position[0] >= 312 && label.payload.position[1] >= 158)
})

test('source-backed lithology/name revision actually regenerates the legend atomically, preserves identity, and survives undo/redo and DXF reopening', async () => {
  const fixture = await createSyntheticGeologyDemo()
  try {
    const before = fixture.document.snapshot(), fingerprint = fixture.document.fingerprint()
    const previous = readGeologyDrawingRecipe(fixture.document, fixture.drawingId)
    const pending = await proposeSyntheticGeologyScenario(fixture, 'lithology-pattern')
    assert.deepEqual(fixture.document.snapshot(), before); assert.equal(fixture.document.fingerprint(), fingerprint)
    const unchanged = pending.unchangedIds.map(id => clone(fixture.document.getObject(id)))
    await pending.approve()
    const current = readGeologyDrawingRecipe(fixture.document, fixture.drawingId)
    assert.equal(current.drawingId, previous.drawingId); assert.equal(current.resourceRoot, previous.resourceRoot)
    assert.equal(current.documentId, previous.documentId)
    for (const object of unchanged) assert.deepEqual(fixture.document.getObject(object.id), object)
    assert.deepEqual(fixture.document.getObject(fixture.manual.id), fixture.manual)
    const text = fixture.document.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
    assert.ok(text.includes('示例耕植土')); assert.equal(text.includes('示例填土'), false)
    assert.ok(fixture.document.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternName === 'GEO_TOPSOIL'))
    const after = fixture.document.snapshot(), afterFingerprint = fixture.document.fingerprint()
    await fixture.document.undo(); assert.deepEqual(fixture.document.snapshot().objects, before.objects); assert.equal(fixture.document.fingerprint(), fingerprint)
    await fixture.document.redo(); assert.deepEqual(fixture.document.snapshot().objects, after.objects); assert.equal(fixture.document.fingerprint(), afterFingerprint)
    const sdk = createKJDrawSDK(), reopened = await sdk.readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' }), { format: 'DXF' })
    try {
      assert.equal(reopened.validate().valid, true)
      assert.equal(reopened.listEntities().length, fixture.document.listEntities().length)
      assert.ok(reopened.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === '示例耕植土'))
      assert.equal(reopened.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === '示例填土'), false)
      assert.ok(reopened.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternName === 'GEO_TOPSOIL'))
      assert.throws(() => readGeologyDrawingRecipe(reopened, fixture.drawingId), /source|recipe|registered|drawing/i)
    } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
  } finally { fixture.dispose() }
})
