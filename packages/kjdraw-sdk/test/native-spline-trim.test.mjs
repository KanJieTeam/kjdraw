import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { breakEntityPayloads, createKJDrawSDK, trimEntityPayloads } from '../src/index.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'

const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} within ${tolerance}`)
const pointNear = (a, b, tolerance = 1e-7) => a.forEach((value, index) => near(value, b[index], tolerance))
const domain = payload => [payload.knots[payload.degree], payload.knots[payload.controlPoints.length]]
const entity = payload => ({ type: 'SPLINE', payload })
const vertical = x => ({ type: 'LINE', payload: { start: [x, -20, 0], end: [x, 20, 0] } })
const arch = { degree: 2, controlPoints: [[0, 0, 0], [5, 10, 0], [10, 0, 0]], knots: [0, 0, 0, 1, 1, 1], color: 3, lineweight: 25, closed: false, periodic: false, custom: { role: 'synthetic-native-test' } }
const circleArc = { degree: 2, controlPoints: [[5, 0, 0], [5, 5, 0], [0, 5, 0]], weights: [1, Math.SQRT1_2, 1], knots: [0, 0, 0, 1, 1, 1], closed: false, periodic: false }

// Independent Cox/de Boor reference: recursive basis functions, rather than
// the implementation's homogeneous knot insertion or SDK spline evaluator.
function reference(payload, u) {
  const p = payload.degree, controls = payload.controlPoints, knots = payload.knots
  const end = domain(payload)[1]
  const basis = (i, degree) => {
    if (!degree) return (knots[i] <= u && u < knots[i + 1]) || (u === end && i === controls.length - 1) ? 1 : 0
    const a = knots[i + degree] - knots[i], b = knots[i + degree + 1] - knots[i + 1]
    return (a ? (u - knots[i]) / a * basis(i, degree - 1) : 0) + (b ? (knots[i + degree + 1] - u) / b * basis(i + 1, degree - 1) : 0)
  }
  const numerator = [0, 0, 0]
  let weight = 0
  controls.forEach((point, i) => {
    const contribution = basis(i, p) * (payload.weights?.[i] ?? 1)
    weight += contribution
    point.forEach((value, axis) => numerator[axis] += value * contribution)
  })
  return numerator.map(value => value / weight)
}
function compareInterval(source, output, tolerance = 1e-7) {
  const [start, end] = domain(output)
  assert.equal(output.degree, source.degree)
  assert.equal(output.knots.length, output.controlPoints.length + output.degree + 1)
  assert.equal(output.type, undefined)
  for (let sample = 0; sample <= 100; sample++) {
    const u = sample === 100 ? end : sample === 0 ? start : start + (end - start) * sample / 100
    pointNear(reference(output, u), reference(source, u), tolerance)
  }
}

test('native SPLINE BREAK preserves cubic Bezier subintervals and native non-unit knot domains', () => {
  const source = { ...arch, degree: 3, controlPoints: [[0, 0, 0], [2, 6, 0], [8, 6, 0], [10, 0, 0]], knots: [2, 2, 2, 2, 6, 6, 6, 6] }
  const before = JSON.stringify(source)
  for (const parameters of [[3, 5], [5, 3]]) {
    const pieces = breakEntityPayloads(entity(source), { parameters })
    assert.deepEqual(pieces.map(piece => domain(piece.payload)), [[2, 3], [5, 6]])
    pieces.forEach(piece => {
      assert.equal(piece.type, 'SPLINE'); compareInterval(source, piece.payload, 1e-11)
      assert.deepEqual(piece.payload.custom, source.custom); assert.equal(piece.payload.color, 3)
      assert.equal(piece.payload.weights, undefined)
    })
    for (const piece of pieces) for (let sample = 0; sample <= 10; sample++) {
      const [a, b] = domain(piece.payload), u = a + (b - a) * sample / 10, t = (u - 2) / 4, s = 1 - t
      pointNear(reference(piece.payload, u), [6 * s * s * t + 24 * s * t * t + 10 * t ** 3, 18 * s * t, 0], 1e-11)
    }
  }
  assert.equal(JSON.stringify(source), before)
})

test('rational quadratic point BREAK preserves an analytic circular arc without tessellation', () => {
  const cuts = breakEntityPayloads(entity(circleArc), { point: [5 / Math.SQRT2, 5 / Math.SQRT2, 0] })
  assert.equal(cuts.length, 2)
  cuts.forEach(({ payload }) => {
    assert.equal(payload.degree, 2); assert.equal(payload.weights.length, payload.controlPoints.length)
    compareInterval(circleArc, payload, 1e-10)
    for (let i = 0; i <= 40; i++) {
      const [a, b] = domain(payload), value = reference(payload, a + (b - a) * i / 40)
      near(Math.hypot(value[0], value[1]), 5, 1e-11)
    }
  })
  near(domain(cuts[0].payload)[1], .5, 1e-8)
})

test('multiple interior knots and nonuniform positive weights remain native through consecutive edits', () => {
  const source = { ...arch, controlPoints: [[0, 0, 0], [2, 4, 0], [5, 3, 0], [8, -2, 0], [10, 0, 0]], weights: [1, 2, .8, 1.5, 1], knots: [0, 0, 0, .5, .5, 1, 1, 1] }
  const split = breakEntityPayloads(entity(source), { parameter: .5 })
  assert.deepEqual(split.map(piece => domain(piece.payload)), [[0, .5], [.5, 1]])
  assert.deepEqual(split[0].payload.weights, [1, 2, .8]); assert.deepEqual(split[1].payload.weights, [.8, 1.5, 1])
  split.forEach(piece => compareInterval(source, piece.payload, 1e-11))
  const again = breakEntityPayloads(split[1], { parameter: .75 })
  again.forEach(piece => compareInterval(source, piece.payload, 1e-11))
})

test('native spline subintervals match an independent basis for 30 nonuniform rational and reversed fixtures', () => {
  let seed = 0x51a7cafe
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  for (let fixture = 0; fixture < 30; fixture++) {
    const degree = fixture % 5 + 1, count = degree + 5
    const source = { degree, controlPoints: Array.from({ length: count }, (_, i) => [i + random(), (random() - .5) * 8, 0]),
      knots: [...Array(degree + 1).fill(-3), -1, 1, degree > 1 ? 1 : 3, 5, ...Array(degree + 1).fill(7)],
      ...(fixture % 2 ? { weights: Array.from({ length: count }, () => .5 + random() * 1.5) } : {}) }
    const pieces = breakEntityPayloads(entity(source), { parameters: [.2, 3.8] })
    pieces.forEach(piece => compareInterval(source, piece.payload, 2e-11))
    const reverse = { ...source, controlPoints: [...source.controlPoints].reverse(), knots: [...source.knots].reverse().map(value => 4 - value),
      ...(source.weights ? { weights: [...source.weights].reverse() } : {}) }
    const reversed = breakEntityPayloads(entity(reverse), { parameter: .2 })
    reversed.forEach(piece => {
      compareInterval(reverse, piece.payload, 2e-11)
      const [a, b] = domain(piece.payload)
      for (let sample = 0; sample <= 20; sample++) { const u = sample === 20 ? b : sample === 0 ? a : a + (b - a) * sample / 20; pointNear(reference(piece.payload, u), reference(source, 4 - u), 2e-11) }
    })
  }
})

test('TRIM retains both unpicked native spline intervals for finite and infinite line boundaries', () => {
  for (const type of ['LINE', 'RAY', 'XLINE']) {
    const boundaries = [3, 7].map(x => type === 'LINE' ? vertical(x) : ({ type, payload: { origin: [x, -20, 0], direction: [0, 1, 0] } }))
    const pieces = trimEntityPayloads(entity(arch), boundaries, [5, 5, 0])
    assert.equal(pieces.length, 2)
    pointNear(domain(pieces[0].payload), [0, .3], 1e-8); pointNear(domain(pieces[1].payload), [.7, 1], 1e-8)
    pieces.forEach(piece => compareInterval(arch, piece.payload, 1e-10))
    assert.deepEqual(pieces[0].payload.custom, arch.custom)
  }
})

test('SPLINE TRIM uses native circle, arc, ellipse and spline boundary intersections', () => {
  const straight = { degree: 1, controlPoints: [[-10, 0, 0], [10, 0, 0]], knots: [0, 0, 1, 1] }
  const boundaries = [
    [{ type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 4 } }],
    [{ type: 'ARC', payload: { center: [0, 0, 0], radius: 4, startAngle: 0, endAngle: Math.PI, clockwise: false } }],
    [{ type: 'ELLIPSE', payload: { center: [0, 0, 0], majorAxis: [4, 0, 0], ratio: .5, startParameter: 0, endParameter: 2 * Math.PI } }],
    [-4, 4].map(x => entity({ degree: 1, controlPoints: [[x, -10, 0], [x, 10, 0]], knots: [0, 0, 1, 1] })),
  ]
  for (const cutters of boundaries) {
    const pieces = trimEntityPayloads(entity(straight), cutters, [0, 0, 0])
    assert.equal(pieces.length, 2)
    pointNear(domain(pieces[0].payload), [0, .3], 1e-8); pointNear(domain(pieces[1].payload), [.7, 1], 1e-8)
    pieces.forEach(piece => compareInterval(straight, piece.payload, 1e-10))
  }
})

test('rational circular SPLINE trim keeps exact conic subintervals and finite boundary domains', () => {
  const pieces = trimEntityPayloads(entity(circleArc), [vertical(4), { type: 'LINE', payload: { start: [-20, 4, 0], end: [20, 4, 0] } }], [5 / Math.SQRT2, 5 / Math.SQRT2, 0])
  assert.equal(pieces.length, 2)
  pointNear(reference(pieces[0].payload, domain(pieces[0].payload)[1]), [4, 3, 0])
  pointNear(reference(pieces[1].payload, domain(pieces[1].payload)[0]), [3, 4, 0])
  pieces.forEach(piece => {
    compareInterval(circleArc, piece.payload, 1e-10)
    const [a, b] = domain(piece.payload)
    for (let sample = 0; sample <= 80; sample++) {
      const u = sample === 80 ? b : a + (b - a) * sample / 80, value = reference(piece.payload, u)
      near(Math.hypot(value[0], value[1]), 5, 1e-10)
    }
  })
  for (const boundary of [
    { type: 'LINE', payload: { start: [3, 10, 0], end: [3, 20, 0] } },
    { type: 'RAY', payload: { origin: [3, 10, 0], direction: [0, 1, 0] } },
  ]) {
    const retained = trimEntityPayloads(entity(arch), [boundary, vertical(7)], [1, 1.8, 0])
    assert.equal(retained.length, 1); pointNear(domain(retained[0].payload), [.7, 1], 1e-8)
  }
  const straight = { degree: 1, controlPoints: [[-10, 1, 0], [10, 1, 0]], knots: [0, 0, 1, 1] }
  assert.throws(() => trimEntityPayloads(entity(straight), [{ type: 'ARC', payload: { center: [0, 0, 0], radius: 4, startAngle: Math.PI, endAngle: 2 * Math.PI } }], [0, 1, 0]), /no reliable trim intersection/)
})

test('point ambiguity requires explicit native parameters and TRIM pick parameters select a branch', () => {
  const crossing = { degree: 1, controlPoints: [[0, 0, 0], [4, 4, 0], [0, 4, 0], [4, 0, 0]], knots: [0, 0, 1, 2, 3, 3] }
  assert.throws(() => breakEntityPayloads(entity(crossing), { point: [2, 2, 0] }), /unique spline parameter/)
  const broken = breakEntityPayloads(entity(crossing), { parameter: .5 })
  broken.forEach(piece => compareInterval(crossing, piece.payload, 1e-11))
  assert.throws(() => trimEntityPayloads(entity(crossing), [vertical(1)], [2, 2, 0]), /unique spline parameter/)
  const trimmed = trimEntityPayloads(entity(crossing), [vertical(1)], [2, 2, 0], { pickParameter: .5 })
  pointNear(domain(trimmed[0].payload), [0, .25], 1e-8); pointNear(domain(trimmed[1].payload), [1.75, 3], 1e-8)
  assert.throws(() => trimEntityPayloads(entity(crossing), [vertical(1)], [2, 2, 0], { pickParameter: 1.5 }), /does not match/)
  const bothBranches = trimEntityPayloads(entity(crossing), [vertical(2)], [1, 1, 0])
  assert.equal(bothBranches.length, 1); pointNear(domain(bothBranches[0].payload), [.5, 3], 1e-8)
  const explicitBranches = breakEntityPayloads(entity(crossing), { parameters: [.5, 2.5] })
  explicitBranches.forEach(piece => compareInterval(crossing, piece.payload, 1e-11))
})

test('invalid, endpoint, fitted, periodic and unresolved definitions refuse without altering input', () => {
  const fixtures = [
    { ...arch, periodic: true }, { ...arch, closed: true }, { ...arch, fitPoints: [[0, 0, 0], [10, 0, 0]] },
    { degree: 2, fitPoints: [[0, 0, 0], [5, 5, 0], [10, 0, 0]] }, { ...arch, weights: [1, 0, 1] },
    { ...arch, weights: [1, 1e-9, 1] }, { ...arch, weights: [1e-320, 1e-320, 1e-320] },
    { ...arch, degree: 2.5 }, { ...arch, knots: [0, 0, .1, 1, 1, 1] },
    { ...arch, normal: [0, 0, -1] }, { ...arch, controlPoints: [[0, 0, 1], [5, 10, 1], [10, 0, 1]] },
    { ...arch, controlPoints: [[9e8, 0, 0], [9e8 + 5, 10, 0], [9e8 + 10, 0, 0]] },
    { ...arch, controlPoints: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] },
  ]
  fixtures.forEach(payload => {
    const before = JSON.stringify(payload)
    assert.throws(() => breakEntityPayloads(entity(payload), { parameter: .5 }), /Native SPLINE edit/)
    assert.equal(JSON.stringify(payload), before)
  })
  for (const options of [{ parameter: 0 }, { parameter: 1 }, { parameter: NaN }, { parameters: [.5, .5] }, { parameters: 'bad' }, { parameters: new Array(1) }, { points: 'bad' }, { points: [[5, 5]], point: [5, 5] }, { point: [0, 0, 0] }, { point: [5, 9, 0] }, { point: [5, 5, 1] }]) {
    assert.throws(() => breakEntityPayloads(entity(arch), options), /Native SPLINE edit/)
  }
  assert.throws(() => trimEntityPayloads(entity(arch), [vertical(3)], [3, 4.2, 0]), /cutting boundary/)
  assert.throws(() => trimEntityPayloads(entity(arch), [{ type: 'XLINE', payload: { origin: [0, 5, 0], direction: [1, 0, 0] } }], [2, 3.2, 0]), /tangent|uncertain/)
  const corner = { degree: 1, controlPoints: [[0, 1, 0], [1, 0, 0], [2, 1, 0]], knots: [0, 0, .5, 1, 1] }
  assert.throws(() => trimEntityPayloads(entity(corner), [{ type: 'XLINE', payload: { origin: [0, 0, 0], direction: [1, 0, 0] } }], [.5, .5, 0]), /corner contact/)
  assert.throws(() => trimEntityPayloads(entity(arch), [{ type: 'LINE', payload: { start: [3, -10, 1], end: [3, 10, 1] } }], [5, 5, 0]), /XY plane/)
  assert.throws(() => trimEntityPayloads(entity(arch), [{ type: 'CIRCLE', payload: { center: [1e9, 0, 0], radius: 1e9 } }], [5, 5, 0]), /boundary coordinate precision/)
  for (const boundaries of [null, new Array(1), [null], [vertical(3), { type: 'ARC', payload: { center: [0, 0, 0], radius: 1 } }]]) {
    assert.throws(() => trimEntityPayloads(entity(arch), boundaries, [5, 5, 0]), /Native SPLINE edit/)
  }
})

test('absolute homogeneous weight bounds preserve supported scales and refuse underflow atomically', async () => {
  for (const weight of [1e-12, 1e12]) {
    const source = { ...arch, weights: [weight, weight, weight] }
    for (const piece of breakEntityPayloads(entity(source), { parameter: .37 })) compareInterval(source, piece.payload, 1e-11)
  }
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const source = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { ...arch, weights: [1e-320, 1e-320, 1e-320] } })
  const cutter = await sdk.executeCommand('CREATE', { type: 'LINE', payload: vertical(3).payload })
  const before = drawing.serialize(), revision = drawing.revision
  await assert.rejects(sdk.executeCommand('BREAK', { id: source.id, parameter: .37 }), /weights must be between/)
  await assert.rejects(sdk.executeCommand('TRIM', { id: source.id, boundaryIds: [cutter.id], pickPoint: [5, 5, 0] }), /weights must be between/)
  assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
})

test('native spline command arguments remain scoped and do not open standard Agent BREAK/TRIM permissions', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: arch })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [10, 0, 0] } })
  const cutter = await sdk.executeCommand('CREATE', { type: 'LINE', payload: vertical(3).payload })
  const before = drawing.serialize(), revision = drawing.revision
  for (const [command, args] of [
    ['BREAK', { id: line.id, point: [5, 0, 0], parameter: .5 }],
    ['TRIM', { id: line.id, boundaryIds: [cutter.id], pickPoint: [1, 0, 0], pickParameter: .1 }],
    ['TRIM', { id: line.id, boundaryIds: [cutter.id], pickPoint: [1, 0, 0], tolerance: 1e-7 }],
    ['BREAK', { id: spline.id, parameter: .5, unrecognized: true }],
    ['TRIM', { id: spline.id, boundaryIds: [cutter.id], pickPoint: [1, 1.8, 0], unrecognized: true }],
  ]) {
    await assert.rejects(sdk.executeCommand(command, args), /only for SPLINE|unsupported command arguments/)
    assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
  }
  for (const command of ['BREAK', 'TRIM']) await assert.rejects(createAgentGeometryPreview(drawing, command, { id: spline.id, parameter: .5 }), /supported|preview/i)
  assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
})

test('protected layers and failed TRIM retain all records, source provenance, history and redo', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'native-spline-protection' })
  const source = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { ...arch, layerId: layer.id }, options: { source: { format: 'synthetic', originalHandle: 'FA1', receipt: { owned: true } }, extension: { xData: { TEST: [{ code: 1000, value: 'native-source' }] } } } })
  const cutters = await Promise.all([3, 7].map(x => sdk.executeCommand('CREATE', { type: 'LINE', payload: vertical(x).payload })))
  for (const patch of [{ locked: true }, { locked: false, frozen: true }, { frozen: false, visible: false }]) {
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch })
    const before = drawing.serialize(), revision = drawing.revision, objects = records(drawing)
    await assert.rejects(sdk.executeCommand('BREAK', { id: source.id, parameter: .5 }), /locked|frozen|hidden/)
    await assert.rejects(sdk.executeCommand('TRIM', { id: source.id, boundaryIds: cutters.map(value => value.id), pickPoint: [5, 5, 0] }), /locked|frozen|hidden/)
    assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision); assert.deepEqual(records(drawing), objects)
  }
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { visible: true, locked: false, frozen: false } })
  const before = records(drawing), revision = drawing.revision
  await sdk.executeCommand('TRIM', { id: source.id, boundaryIds: cutters.map(value => value.id), pickPoint: [5, 5, 0] })
  assert.equal(drawing.revision, revision + 1)
  const primary = drawing.getObject(source.id)
  assert.deepEqual(primary.source, source.source); assert.deepEqual(primary.extension, source.extension)
  assert.equal(primary.ownerId, source.ownerId); assert.equal(primary.handle, source.handle)
  const after = records(drawing)
  await sdk.executeCommand('UNDO'); assert.deepEqual(records(drawing), before)
  const undo = drawing.serialize(), undoRevision = drawing.revision
  await assert.rejects(sdk.executeCommand('TRIM', { id: source.id, boundaryIds: cutters.map(value => value.id), pickPoint: [3, 4.2, 0] }), /cutting boundary/)
  assert.equal(drawing.serialize(), undo); assert.equal(drawing.revision, undoRevision)
  await sdk.executeCommand('REDO'); assert.deepEqual(records(drawing), after)
})

const records = drawing => Object.fromEntries(drawing.listObjects({ includeErased: true }).map(object => [object.id, object]))
test('SPLINE commands are one transaction with stable source, memberships, undo/redo and failure atomicity', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const source = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: arch })
  const group = await sdk.executeCommand('GROUP', { name: 'native-spline-test', ids: [source.id] })
  const before = records(drawing), revision = drawing.revision
  const pieces = await sdk.executeCommand('BREAK', { id: source.id, parameter: .5 })
  assert.equal(drawing.revision, revision + 1); assert.equal(pieces[0].id, source.id); assert.equal(pieces[0].handle, source.handle)
  assert.equal(pieces[1].source.derivedFromId, source.id)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, pieces.map(piece => piece.id))
  pieces.forEach(piece => { compareInterval(arch, piece.payload); assert.deepEqual(piece.payload.custom, arch.custom) })
  const after = records(drawing)
  await sdk.executeCommand('UNDO'); assert.deepEqual(records(drawing), before)
  await sdk.executeCommand('REDO'); assert.deepEqual(records(drawing), after)
  const atomic = drawing.serialize(), atomicRevision = drawing.revision
  for (const parameter of [0, .5, NaN]) {
    await assert.rejects(sdk.executeCommand('BREAK', { id: source.id, parameter }), /Native SPLINE edit/)
    assert.equal(drawing.serialize(), atomic); assert.equal(drawing.revision, atomicRevision)
  }
  const cutters = await Promise.all([7, 9].map(x => sdk.executeCommand('CREATE', { type: 'LINE', payload: vertical(x).payload })))
  const trimRevision = drawing.revision
  await sdk.executeCommand('TRIM', { id: pieces[1].id, boundaryIds: cutters.map(cutter => cutter.id), pickPoint: [8, 3.2, 0] })
  assert.equal(drawing.revision, trimRevision + 1)
  assert.equal(drawing.listEntities({ type: 'SPLINE' }).length, 3)
})

test('incompatible dimension references and self-cutting boundaries cannot mutate native spline state', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const source = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: arch })
  const cutters = await Promise.all([3, 7].map(x => sdk.executeCommand('CREATE', { type: 'LINE', payload: vertical(x).payload })))
  const before = drawing.serialize(), objects = records(drawing), revision = drawing.revision
  // The document schema already forbids dimension curve references to SPLINE.
  // Preserve that protection rather than inventing an association migration.
  await assert.rejects(drawing.transact('Synthetic unsupported reference', tx => tx.createEntity('DIMENSION', {
    dimensionType: 'ALIGNED', definitionPoints: [[0, 0, 0], [10, 0, 0], [5, 3, 0]],
    dimensionAssociations: [{ definitionPointIndex: 0, entityId: source.id, feature: 'curve', angle: .5 }],
  })), /validation issue/)
  assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision); assert.deepEqual(records(drawing), objects)
  await assert.rejects(sdk.executeCommand('TRIM', { id: source.id, boundaryIds: [source.id, cutters[0].id], pickPoint: [5, 5, 0] }), /itself|target|boundar/i)
  assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision); assert.deepEqual(records(drawing), objects)
})

test('native rational SPLINE fragments save and reopen in KJD/DXF and can be cut again', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const source = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: circleArc })
  await sdk.executeCommand('BREAK', { id: source.id, parameter: .5 })
  for (const format of ['KJD', 'DXF']) {
    const fresh = createKJDrawSDK(), saved = await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await fresh.readDocument(saved, { format })
    const splines = reopened.listEntities({ type: 'SPLINE' })
    assert.equal(splines.length, 2)
    splines.forEach(spline => compareInterval(circleArc, spline.payload, 1e-10))
    const leading = splines.find(spline => domain(spline.payload)[0] === 0)
    const twice = await fresh.executeCommand('BREAK', { id: leading.id, parameter: .25 }, { document: reopened })
    assert.equal(reopened.listEntities({ type: 'SPLINE' }).length, 3)
    twice.forEach(spline => compareInterval(circleArc, spline.payload, 1e-10))
  }
})

test('independent ezdxf must audit and evaluate native rational spline outputs without skips', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const source = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: circleArc })
  const pieces = await sdk.executeCommand('BREAK', { id: source.id, parameters: [.25, .75] })
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const python = process.env.KJDRAW_PYTHON
  assert.ok(python, 'KJDRAW_PYTHON with ezdxf is mandatory; this test must not skip')
  const result = spawnSyncWithFileStdin(python, ['-c', `import io,json,os,sys,ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH'); data=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(data)); a=d.audit(); values=[]
for e in d.modelspace().query('SPLINE'):
 c=e.construction_tool(); k=list(e.knots); ck=list(c.knots()); start=ck[e.dxf.degree]; end=ck[len(e.control_points)]
 values.append({'degree':e.dxf.degree,'knots':k,'weights':list(e.weights),'points':[list(c.point(start+(end-start)*i/30)) for i in range(31)]})
print(json.dumps({'version':ezdxf.__version__,'errors':len(a.errors),'fixes':len(a.fixes),'splines':values}))`], dxf, { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  const evidence = JSON.parse(result.stdout)
  assert.equal(evidence.errors, 0); assert.equal(evidence.fixes, 0); assert.equal(evidence.splines.length, 2)
  evidence.splines.forEach((spline, index) => {
    assert.equal(spline.degree, 2); assert.deepEqual(spline.knots, pieces[index].payload.knots)
    const [a, b] = domain(pieces[index].payload)
    spline.points.forEach((value, i) => {
      pointNear(value, reference(circleArc, a + (b - a) * i / 30), 1e-10)
      near(Math.hypot(value[0], value[1]), 5, 1e-10)
    })
  })
})
