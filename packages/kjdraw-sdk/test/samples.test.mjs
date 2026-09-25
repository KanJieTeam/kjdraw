import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/core.js'
import { INDUSTRY_SAMPLES, createIndustrySample, createIndustrySamples } from '../src/samples.js'

test('industry collection contains editable, valid layered drawings that survive KJD and DXF', async () => {
  const sdk = createKJDrawSDK()
  const drawings = await createIndustrySamples(sdk)
  assert.equal(drawings.length, INDUSTRY_SAMPLES.length)
  assert.ok(new Set(INDUSTRY_SAMPLES.map(sample => sample.discipline)).size >= 5)
  for (const drawing of drawings) {
    assert.equal(drawing.validate().valid, true)
    assert.ok(drawing.listEntities().length >= (drawing.id === 'sample-geology-plan' ? 50 : drawing.id === 'sample-mechanical-flange' ? 75 : 100))
    assert.ok(drawing.snapshot().tables.layers.recordIds.length >= 8)
    const snapshot = drawing.fingerprint()
    const kjd = await sdk.writeDocument(drawing, { format: 'KJD' })
    const reopened = await sdk.readDocument(kjd, { format: 'KJD' })
    assert.equal(reopened.fingerprint(), snapshot)
    const dxf = await sdk.writeDocument(drawing, { format: 'DXF' })
    const imported = await sdk.readDocument(dxf, { format: 'DXF' })
    assert.equal(imported.validate().valid, true)
    assert.equal(imported.listEntities().length, drawing.listEntities().length)
  }
})

test('sample creation never overwrites an existing drawing, and architectural dimensions use model units', async () => {
  const sdk = createKJDrawSDK()
  const first = await createIndustrySample(sdk, 'sample-architecture')
  const second = await createIndustrySample(sdk, 'sample-architecture')
  assert.notEqual(first.id, second.id)
  assert.equal(sdk.documents.get(first.id), first)
  const wall = first.listEntities().find(entity => entity.type === 'LWPOLYLINE' && entity.payload.vertices?.[0]?.point?.[0] === 2200)
  assert.ok(wall)
  const xs = wall.payload.vertices.map(vertex => vertex.point[0])
  assert.equal(Math.max(...xs) - Math.min(...xs), 19800)
  await assert.rejects(createIndustrySample(sdk, 'missing'), /Unknown KJDraw sample/)
})

test('mechanical flange dimensions agree with editable geometry', async () => {
  const sdk = createKJDrawSDK()
  const drawing = await createIndustrySample(sdk, 'sample-mechanical-flange')
  const circles = drawing.listEntities().filter(entity => entity.type === 'CIRCLE')
  const centered = radius => circles.find(entity => entity.payload.radius === radius && entity.payload.center[0] === 92 && entity.payload.center[1] === 109)
  assert.ok(centered(60), 'Ø120 outside radius')
  assert.ok(centered(20), 'Ø40 bore radius')
  assert.ok(centered(45), 'Ø90 pitch circle radius')
  const holes = circles.filter(entity => entity.payload.radius === 5)
  assert.equal(holes.length, 6, 'six Ø10 through holes')
  for (const hole of holes) assert.ok(Math.abs(Math.hypot(hole.payload.center[0] - 92, hole.payload.center[1] - 109) - 45) < 1e-9)
  const text = drawing.listEntities().filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text).join(' ')
  assert.match(text, /Ø120/)
  assert.match(text, /Ø40 BORE/)
  assert.match(text, /6 × Ø10 THRU  ·  PCD Ø90/)
  assert.match(text, /SECTION B—B  ·  1:1/)
})
test('public geology section and investigation plan use native domain compilers', async () => {
  const sdk = createKJDrawSDK()
  const section = await createIndustrySample(sdk, 'sample-geology-section')
  assert.equal(section.snapshot().header.units, 'millimeter')
  assert.ok(section.listEntities({ type: 'HATCH' }).length >= 20, 'stratigraphic cells retain native lithology hatches')
  assert.ok(section.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternName.includes('LOESS')))
  assert.ok(section.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text.includes('NOT MEASURED')))
  const plan = await createIndustrySample(sdk, 'sample-geology-plan')
  assert.equal(plan.snapshot().header.units, 'meter')
  assert.equal(plan.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  assert.ok(plan.listEntities({ type: 'CIRCLE' }).length >= 5, 'the plan retains five editable investigation markers')
  assert.ok(plan.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text.includes('ZK01')))
  for (const drawing of [section, plan]) for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await sdk.readDocument(bytes, { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, drawing.listEntities().length)
    assert.equal(reopened.listEntities({ type: 'HATCH' }).length, drawing.listEntities({ type: 'HATCH' }).length)
  }
})