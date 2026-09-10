import test from 'node:test'
import assert from 'node:assert/strict'
import { engineeringDrawingTasks, engineeringDrawingRequirements, referenceEngineeringDrawingEntities, referenceAnnotatedInput, validateEngineeringDimensions } from '../../../scripts/benchmarks/engineering-drawing-tasks.mjs'
import { createKJDrawSDK } from '../src/sdk.js'

test('installation plate has coherent two-view machining, dimensions and explicit completeness constraints', () => {
  const task = engineeringDrawingTasks[0], r = task.requirements
  assert.equal(r.views.length, 2)
  assert.equal(r.dimensions.length, 14)
  assert.equal(r.notes.length, 16)
  assert.equal(r.design.thickness - r.design.counterboreDepth, 6)
  assert.equal(r.design.slotCenters[1][0] - r.design.slotCenters[0][0] + 2 * r.design.slotRadius, 29)
  assert.equal(r.geometry.filter(entity => entity.type === 'CIRCLE').length, 8)
  assert.equal(r.geometry.filter(entity => entity.id.startsWith('front-counterbore')).length, 4)
  assert.equal(r.geometry.filter(entity => entity.id.startsWith('front-through')).length, 4)
  assert.equal(new Set(r.geometry.map(entity => entity.id)).size, r.geometry.length)
  assert.deepEqual(r.layers.find(layer => layer.name === 'HIDDEN').pattern, [3, -1])
  assert.match(task.prompt, /not a load-rated/)
  assert.match(r.notes.find(note => note.id === 'position-tolerance').text, /0.05/)
  assert.ok(r.deferredChecks.some(check => check.includes('visual')))
})

test('revision B propagates right-column machining and projections without changing unrelated design', () => {
  const a = engineeringDrawingRequirements('A'), b = engineeringDrawingRequirements('B')
  assert.deepEqual(a.design.holeX, [20, 160]); assert.deepEqual(b.design.holeX, [20, 150])
  for (const name of ['through-1-0', 'through-1-1', 'counterbore-1-0', 'counterbore-1-1']) {
    const before = a.geometry.find(e => e.id === name), after = b.geometry.find(e => e.id === name)
    assert.equal(after.payload.center[0], before.payload.center[0] - 10)
    assert.deepEqual(after.payload.center.slice(1), before.payload.center.slice(1))
    assert.equal(after.payload.radius, before.payload.radius)
  }
  for (const name of ['front-through-1--1', 'front-counterbore-1-1', 'front-step-1-1', 'front-axis-1']) {
    const before = a.geometry.find(e => e.id === name), after = b.geometry.find(e => e.id === name)
    assert.equal(after.payload.start[0], before.payload.start[0] - 10)
    assert.equal(after.payload.end[0], before.payload.end[0] - 10)
  }
  for (const shape of a.geometry.filter(e => /^(slot|top-outline|front-outline|through-0|counterbore-0)/.test(e.id))) assert.deepEqual(b.geometry.find(e => e.id === shape.id), shape)
  assert.equal(b.dimensions.find(d => d.id === 'hole-right-x').value, 150)
  assert.equal(b.notes.find(n => n.id === 'revision').text, 'REV B')
  assert.throws(() => engineeringDrawingRequirements('C'))
})

test('native dimension evidence rejects stale values, fake display text, missing anchors and incomplete update', () => {
  const source = referenceEngineeringDrawingEntities()
  assert.equal(validateEngineeringDimensions(source).passed, true)
  const dimensions = source.filter(e => e.type === 'DIMENSION')
  for (const mutation of [
    e => { e.payload.measurement = 999 },
    e => { e.payload.textOverride = '180' },
    e => { e.payload.definitionPoints[2][0] += 1 },
  ]) {
    const wrong = structuredClone(source); mutation(wrong.find(e => e.type === 'DIMENSION'))
    assert.equal(validateEngineeringDimensions(wrong).passed, false)
  }
  assert.equal(validateEngineeringDimensions(source.filter(e => e !== dimensions[0])).passed, false)
  assert.equal(validateEngineeringDimensions(source, engineeringDrawingRequirements('B')).passed, false)
  assert.equal(validateEngineeringDimensions(referenceEngineeringDrawingEntities('B'), engineeringDrawingRequirements('B')).passed, true)
})

test('reference drawing is editable SDK geometry with real native dimensions through KJD and DXF reopening', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const specs = referenceEngineeringDrawingEntities()
  await sdk.executeCommand('CREATEBATCH', { entities: specs })
  assert.equal(document.listEntities().length, specs.length)
  assert.equal(validateEngineeringDimensions(document.listEntities()).passed, true)
  const before = document.serialize()
  for (const format of ['KJD', 'DXF']) {
    const raw = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await createKJDrawSDK().readDocument(raw, { format })
    const ownerId = reopened.snapshot().spaces.modelSpaceId
    const entities = reopened.listEntities({ ownerId })
    const result = validateEngineeringDimensions(entities)
    assert.equal(result.passed, true, `${format}: ${JSON.stringify(result)}`)
    assert.equal(entities.filter(e => e.type === 'TEXT').length, 16)
    assert.equal(entities.filter(e => e.type === 'CIRCLE').length, 8)
  }
  assert.equal(document.serialize(), before)
})

test('generic annotated reference uses real semantic geometry references and measured coordinate dimensions', () => {
  for (const revision of ['A', 'B']) {
    const input = referenceAnnotatedInput(revision, 7)
    assert.equal(input.expectedRevision, 7)
    assert.equal(input.texts.length, 16)
    assert.equal(input.alignedDimensions.length, 6)
    assert.equal(input.rotatedDimensions.length, 6)
    assert.equal(input.diameterDimensions.length, 2)
    assert.equal(input.styles.length, 6)
    const styledSources = input.styles.flatMap(style => style.sources)
    assert.equal(styledSources.length, 70)
    assert.equal(new Set(styledSources).size, 70)
    assert.equal(input.lines.length + input.circles.length + input.arcs.length + input.polylines.length, engineeringDrawingRequirements(revision).geometry.length)
    for (const dimension of [...input.alignedDimensions, ...input.rotatedDimensions, ...input.diameterDimensions]) {
      for (const ref of dimension.source ? [dimension.source] : [dimension.from, dimension.to]) {
        const [group, index] = ref.id.split(':')
        assert.equal(ref.source, 'proposal')
        assert.ok(input[group][Number(index)])
        assert.equal(Object.hasOwn(ref, 'vertexIndex'), ref.feature === 'vertex')
      }
      assert.equal(Object.hasOwn(dimension, 'measurement'), false)
    }
    const slotLength = input.alignedDimensions.find(d => d.position.x === 90 && d.position.y === 68)
    assert.equal(slotLength.from.feature, 'left')
    assert.equal(slotLength.to.feature, 'right')
  }
})
