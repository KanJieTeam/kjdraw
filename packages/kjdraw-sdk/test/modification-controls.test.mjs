import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK } from '../src/index.js'
import {
  KJ_MODIFICATION_DEFINITIONS,
  KJ_MODIFICATION_IDS,
  buildKJModificationCommand,
  getKJInteractiveModificationDefinition,
  getKJModificationDefinition,
  parseKJModificationCommandValues,
  previewKJModification,
  validateKJModificationSelection,
} from '../src/modification-controls.js'

const close = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
}
const closePoint = (actual, expected, epsilon = 1e-9) => {
  close(actual[0], expected[0], epsilon)
  close(actual[1], expected[1], epsilon)
}

async function drawingFixture(name) {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: `modification-controls-${name}`, units: 'millimeter' })
  const create = (type, payload) => sdk.executeCommand('CREATE', { type, payload })
  return { sdk, drawing, create }
}

test('all 19 modification controls build exact arguments accepted by the real SDK', async t => {
  assert.deepEqual(KJ_MODIFICATION_IDS, [
    'rotate', 'scale', 'mirror', 'array-rect', 'array-polar', 'offset',
    'break', 'break-two-point', 'join', 'explode', 'trim', 'extend', 'lengthen', 'stretch',
    'polyline-insert', 'polyline-delete', 'polyline-arc', 'chamfer', 'fillet',
  ])
  assert.equal(KJ_MODIFICATION_DEFINITIONS.length, 19)

  const cases = [
    {
      id: 'rotate',
      arrange: async ({ create }) => {
        const entity = await create('LINE', { start: [0, 0], end: [2, 0] })
        return {
          context: { ids: [entity.id], values: { angleDegrees: 90 }, points: [[0, 0]] },
          expected: { ids: [entity.id], angleDegrees: 90, center: [0, 0] },
        }
      },
    },
    {
      id: 'scale',
      arrange: async ({ create }) => {
        const entity = await create('CIRCLE', { center: [2, 3], radius: 2 })
        return {
          context: { ids: [entity.id], values: { factor: 1.5 }, points: [[2, 3]] },
          expected: { ids: [entity.id], factor: 1.5, center: [2, 3] },
        }
      },
    },
    {
      id: 'mirror',
      arrange: async ({ create }) => {
        const entity = await create('POINT', { position: [2, 3] })
        return {
          context: { ids: [entity.id], values: { eraseSource: false }, points: [[0, 0], [1, 0]] },
          expected: { ids: [entity.id], eraseSource: false, lineStart: [0, 0], lineEnd: [1, 0] },
        }
      },
    },
    {
      id: 'array-rect',
      arrange: async ({ create }) => {
        const entity = await create('POINT', { position: [0, 0] })
        return {
          context: { ids: [entity.id], values: { rows: 2, columns: 3, rowSpacing: 7, columnSpacing: 11 }, points: [] },
          expected: { ids: [entity.id], rows: 2, columns: 3, rowSpacing: 7, columnSpacing: 11 },
        }
      },
    },
    {
      id: 'array-polar',
      arrange: async ({ create }) => {
        const entity = await create('POINT', { position: [10, 0] })
        return {
          context: {
            ids: [entity.id],
            values: { count: 4, angleDegrees: 180, rotateItems: false },
            points: [[0, 0]],
            selectionCenter: [10, 0],
          },
          expected: {
            ids: [entity.id], count: 4, angleDegrees: 180, rotateItems: false,
            center: [0, 0], basePoint: [10, 0],
          },
        }
      },
    },
    {
      id: 'offset',
      arrange: async ({ create }) => {
        const entity = await create('LINE', { start: [0, 0], end: [10, 0] })
        return {
          context: { ids: [entity.id], values: { distance: 2.5 }, points: [[0, 8]] },
          expected: { id: entity.id, distance: 2.5, sidePoint: [0, 8] },
        }
      },
    },
    {
      id: 'break',
      arrange: async ({ create }) => {
        const entity = await create('LINE', { start: [0, 0], end: [10, 0] })
        return {
          context: { ids: [entity.id], values: {}, points: [[4, 0]] },
          expected: { id: entity.id, tolerance: 0.1, point: [4, 0] },
        }
      },
    },
    {
      id: 'break-two-point',
      arrange: async ({ create }) => {
        const entity = await create('CIRCLE', { center: [0, 0], radius: 10 })
        return {
          context: { ids: [entity.id], values: { tolerance: 0.2 }, points: [[10, 0], [0, 10]] },
          expected: { id: entity.id, tolerance: 0.2, firstPoint: [10, 0], secondPoint: [0, 10] },
        }
      },
    },
    {
      id: 'join',
      arrange: async ({ create }) => {
        const first = await create('LINE', { start: [0, 0], end: [5, 0] })
        const second = await create('ARC', { center: [5, 5], radius: 5, startAngle: -Math.PI / 2, endAngle: 0 })
        return {
          context: { ids: [first.id, second.id], values: { tolerance: 0.001 }, points: [] },
          expected: { id: first.id, ids: [first.id, second.id], tolerance: 0.001 },
        }
      },
    },
    {
      id: 'explode',
      arrange: async ({ create }) => {
        const entity = await create('LWPOLYLINE', { vertices: [{ point: [0, 0] }, { point: [4, 0] }, { point: [4, 3] }], closed: false })
        return {
          context: { ids: [entity.id], values: {}, points: [] },
          expected: { id: entity.id },
        }
      },
    },
    {
      id: 'trim',
      arrange: async ({ create }) => {
        const target = await create('LINE', { start: [0, 0], end: [10, 0] })
        const boundary = await create('LINE', { start: [5, -5], end: [5, 5] })
        return {
          context: { ids: [target.id, boundary.id], values: {}, points: [[1, 0]] },
          expected: { id: target.id, boundaryIds: [boundary.id], pickPoint: [1, 0] },
        }
      },
    },
    {
      id: 'extend',
      arrange: async ({ create }) => {
        const target = await create('LINE', { start: [0, 0], end: [3, 0] })
        const boundary = await create('LINE', { start: [5, -5], end: [5, 5] })
        return {
          context: { ids: [target.id, boundary.id], values: {}, points: [[3, 0]] },
          expected: { id: target.id, boundaryIds: [boundary.id], pickPoint: [3, 0] },
        }
      },
    },
    {
      id: 'lengthen',
      arrange: async ({ create }) => {
        const entity = await create('LINE', { start: [0, 0], end: [5, 0] })
        return {
          context: { ids: [entity.id], values: { value: 12 }, points: [[5, 0]] },
          expected: { id: entity.id, mode: 'TOTAL', value: 12, pickPoint: [5, 0] },
        }
      },
    },
    {
      id: 'stretch',
      arrange: async ({ create }) => {
        const entity = await create('LINE', { start: [0, 0], end: [5, 0] })
        return {
          context: { ids: [entity.id], values: { dx: 3, dy: 2 }, points: [[4, -1], [6, 1]] },
          expected: { ids: [entity.id], dx: 3, dy: 2, crossingStart: [4, -1], crossingEnd: [6, 1] },
        }
      },
    },
    {
      id: 'polyline-insert',
      arrange: async ({ create }) => {
        const entity = await create('LWPOLYLINE', { vertices: [{ point: [0, 0] }, { point: [10, 0] }, { point: [10, 5] }], closed: false })
        return {
          context: { ids: [entity.id], values: { tolerance: 0.1 }, points: [[5, 0]] },
          expected: { id: entity.id, operation: 'INSERT', tolerance: 0.1, point: [5, 0] },
        }
      },
    },
    {
      id: 'polyline-delete',
      arrange: async ({ create }) => {
        const entity = await create('POLYLINE', { vertices: [{ point: [0, 0, 2] }, { point: [5, 0, 2] }, { point: [10, 0, 2] }], closed: false })
        return {
          context: { ids: [entity.id], values: { tolerance: 0.1 }, points: [[5, 0]] },
          expected: { id: entity.id, operation: 'DELETE', tolerance: 0.1, point: [5, 0] },
        }
      },
    },
    {
      id: 'polyline-arc',
      arrange: async ({ create }) => {
        const entity = await create('LWPOLYLINE', { vertices: [{ point: [0, 0] }, { point: [10, 0] }, { point: [10, 5] }], closed: false })
        return {
          context: { ids: [entity.id], values: { sweepDegrees: 90, tolerance: 0.1 }, points: [[5, 0]] },
          expected: { id: entity.id, operation: 'SET_BULGE', sweepDegrees: 90, tolerance: 0.1, point: [5, 0] },
        }
      },
    },
    {
      id: 'chamfer',
      arrange: async ({ create }) => {
        const first = await create('LINE', { start: [0, 0], end: [10, 0] })
        const second = await create('LINE', { start: [0, 0], end: [0, 10] })
        return {
          context: { ids: [first.id, second.id], values: { distance1: 2, distance2: 3 }, points: [[8, 0], [0, 8]] },
          expected: { firstId: first.id, secondId: second.id, distance1: 2, distance2: 3, pickPoint1: [8, 0], pickPoint2: [0, 8] },
        }
      },
    },
    {
      id: 'fillet',
      arrange: async ({ create }) => {
        const first = await create('LINE', { start: [0, 0], end: [10, 0] })
        const second = await create('LINE', { start: [0, 0], end: [0, 10] })
        return {
          context: { ids: [first.id, second.id], values: { radius: 2 }, points: [[8, 0], [0, 8]] },
          expected: { firstId: first.id, secondId: second.id, radius: 2, pickPoint1: [8, 0], pickPoint2: [0, 8] },
        }
      },
    },
  ]

  for (const definition of cases) {
    await t.test(definition.id, async () => {
      const fixture = await drawingFixture(definition.id)
      const { context, expected } = await definition.arrange(fixture)
      const built = buildKJModificationCommand(definition.id, context)
      const expectedCommand = definition.id === 'array-rect'
        ? 'ARRAYRECT'
        : definition.id === 'array-polar'
          ? 'ARRAYPOLAR'
          : definition.id.startsWith('polyline-')
            ? 'PEDIT'
            : definition.id.startsWith('break')
              ? 'BREAK'
            : definition.id.toUpperCase()
      assert.equal(built.command, expectedCommand)
      assert.deepEqual(built.arguments, expected)
      const revision = fixture.drawing.revision
      await fixture.sdk.executeCommand(built.command, built.arguments)
      assert.equal(fixture.drawing.revision, revision + 1)
      assert.equal(fixture.drawing.validate().valid, true)
    })
  }
})

test('interactive command aliases use the same validated dialog values in both editors', () => {
  const cases = [
    ['MI', 'mirror', ['ERASE'], { eraseSource: true }],
    ['ARRAYRECTANGULAR', 'array-rect', ['2', '3', '7.5', '11'], { rows: 2, columns: 3, rowSpacing: 7.5, columnSpacing: 11 }],
    ['POLARARRAY', 'array-polar', ['8', '180', 'STATIC'], { count: 8, angleDegrees: 180, rotateItems: false }],
    ['O', 'offset', ['2.5'], { distance: 2.5 }],
    ['CHA', 'chamfer', ['2', '3'], { distance1: 2, distance2: 3 }],
    ['F', 'fillet', ['4'], { radius: 4 }],
  ]
  for (const [command, id, tokens, expected] of cases) {
    const definition = getKJInteractiveModificationDefinition(command)
    assert.equal(definition?.id, id)
    assert.deepEqual(parseKJModificationCommandValues(id, tokens), expected)
  }
  assert.equal(getKJInteractiveModificationDefinition('rotate'), null)
  assert.throws(() => parseKJModificationCommandValues('array-rect', ['2.5']), /must be an integer/)
  assert.throws(() => parseKJModificationCommandValues('fillet', ['0']), /at least/)
  assert.throws(() => parseKJModificationCommandValues('offset', ['2', 'extra']), /at most 1/)
  assert.throws(() => parseKJModificationCommandValues('mirror', ['maybe'], 'zh'), /必须为 true 或 false/)
})

test('point-driven modification previews are exact, bounded and history-free', async () => {
  const { drawing, create } = await drawingFixture('preview')
  const horizontal = await create('LINE', { start: [0, 0], end: [10, 0] })
  const vertical = await create('LINE', { start: [0, 0], end: [0, 10] })
  const point = await create('POINT', { position: [3, 4] })
  const objects = drawing.listObjects()
  const fingerprint = drawing.fingerprint(), revision = drawing.revision, history = drawing.history

  const mirror = previewKJModification('mirror', { ids: [point.id], values: { eraseSource: false }, points: [[0, 0], [1, 0]] }, objects)
  closePoint(mirror.after[0].payload.position, [3, -4]); assert.equal(mirror.before.length, 0)
  const polar = previewKJModification('array-polar', { ids: [point.id], values: { count: 4, angleDegrees: 360, rotateItems: true }, points: [[0, 0]] }, objects)
  assert.equal(polar.after.length, 3); closePoint(polar.after[0].payload.position, [-4, 3])
  const bounded = previewKJModification('array-polar', { ids: [point.id], values: { count: 100000, angleDegrees: 360, rotateItems: true }, points: [[0, 0]] }, objects, { maxEntities: 3 })
  assert.equal(bounded.after.length, 3); assert.equal(bounded.omittedCount, 99996)

  const offset = previewKJModification('offset', { ids: [horizontal.id], values: { distance: 2 }, points: [[0, 5]] }, objects)
  closePoint(offset.after[0].payload.start, [0, 2])
  const chamfer = previewKJModification('chamfer', { ids: [horizontal.id, vertical.id], values: { distance1: 2, distance2: 3 }, points: [[8, 0], [0, 8]] }, objects)
  assert.equal(chamfer.before.length, 2); assert.equal(chamfer.after.length, 3)
  closePoint(chamfer.after[2].payload.start, [2, 0]); closePoint(chamfer.after[2].payload.end, [0, 3])
  const fillet = previewKJModification('fillet', { ids: [horizontal.id, vertical.id], values: { radius: 2 }, points: [[8, 0], [0, 8]] }, objects)
  assert.equal(fillet.before.length, 2); assert.equal(fillet.after[2].type, 'ARC'); close(fillet.after[2].payload.radius, 2)

  assert.equal(drawing.fingerprint(), fingerprint)
  assert.equal(drawing.revision, revision)
  assert.deepEqual(drawing.history, history)
})

test('mirror, arrays, trim and fillet produce real geometry and undo atomically', async t => {
  await t.test('mirror', async () => {
    const { sdk, drawing, create } = await drawingFixture('mirror-undo')
    const source = await create('POINT', { position: [3, 4] })
    const before = drawing.fingerprint()
    const command = buildKJModificationCommand('mirror', {
      ids: [source.id], values: { eraseSource: true }, points: [[0, 0], [1, 0]],
    })
    const copies = await sdk.executeCommand(command.command, command.arguments)
    assert.equal(drawing.getObject(source.id), null)
    closePoint(copies[0].payload.position, [3, -4])
    await sdk.executeCommand('UNDO')
    assert.ok(drawing.getObject(source.id))
    assert.equal(drawing.getObject(copies[0].id), null)
    assert.equal(drawing.fingerprint(), before)
  })

  await t.test('rectangular and polar arrays', async () => {
    const { sdk, drawing, create } = await drawingFixture('array-undo')
    const source = await create('POINT', { position: [10, 0] })
    const beforeRect = drawing.fingerprint()
    const rectangular = buildKJModificationCommand('array-rect', {
      ids: [source.id], values: { rows: 2, columns: 2, rowSpacing: 5, columnSpacing: 7 }, points: [],
    })
    const rectCopies = await sdk.executeCommand(rectangular.command, rectangular.arguments)
    assert.deepEqual(rectCopies.map(entity => entity.payload.position.slice(0, 2)), [[17, 0], [10, 5], [17, 5]])
    await sdk.executeCommand('UNDO')
    assert.ok(rectCopies.every(entity => drawing.getObject(entity.id) === null))
    assert.equal(drawing.fingerprint(), beforeRect)

    const beforePolar = drawing.fingerprint()
    const polar = buildKJModificationCommand('array-polar', {
      ids: [source.id], values: { count: 4, angleDegrees: 360, rotateItems: false },
      points: [[0, 0]], selectionCenter: [10, 0],
    })
    const polarCopies = await sdk.executeCommand(polar.command, polar.arguments)
    assert.equal(polarCopies.length, 3)
    closePoint(polarCopies[0].payload.position, [0, 10])
    closePoint(polarCopies[1].payload.position, [-10, 0])
    closePoint(polarCopies[2].payload.position, [0, -10])
    await sdk.executeCommand('UNDO')
    assert.ok(polarCopies.every(entity => drawing.getObject(entity.id) === null))
    assert.equal(drawing.fingerprint(), beforePolar)
  })

  await t.test('trim', async () => {
    const { sdk, drawing, create } = await drawingFixture('trim-undo')
    const target = await create('LINE', { start: [0, 0], end: [10, 0] })
    const boundary = await create('LINE', { start: [5, -5], end: [5, 5] })
    const before = drawing.fingerprint()
    const command = buildKJModificationCommand('trim', {
      ids: [target.id, boundary.id], points: [[1, 0]],
    })
    await sdk.executeCommand(command.command, command.arguments)
    closePoint(drawing.getObject(target.id).payload.start, [5, 0])
    closePoint(drawing.getObject(target.id).payload.end, [10, 0])
    await sdk.executeCommand('UNDO')
    closePoint(drawing.getObject(target.id).payload.start, [0, 0])
    closePoint(drawing.getObject(target.id).payload.end, [10, 0])
    assert.equal(drawing.fingerprint(), before)
  })

  await t.test('fillet', async () => {
    const { sdk, drawing, create } = await drawingFixture('fillet-undo')
    const first = await create('LINE', { start: [0, 0], end: [10, 0] })
    const second = await create('LINE', { start: [0, 0], end: [0, 10] })
    const before = drawing.fingerprint()
    const command = buildKJModificationCommand('fillet', {
      ids: [first.id, second.id], values: { radius: 2 }, points: [[8, 0], [0, 8]],
    })
    const result = await sdk.executeCommand(command.command, command.arguments)
    assert.equal(result.connector.type, 'ARC')
    closePoint(result.connector.payload.center, [2, 2])
    close(result.connector.payload.radius, 2)
    await sdk.executeCommand('UNDO')
    assert.equal(drawing.getObject(result.connector.id), null)
    closePoint(drawing.getObject(first.id).payload.start, [0, 0])
    closePoint(drawing.getObject(second.id).payload.start, [0, 0])
    assert.equal(drawing.fingerprint(), before)
  })
})

test('invalid form values and impossible geometry do not mutate the drawing', async () => {
  const { sdk, drawing, create } = await drawingFixture('invalid')
  const first = await create('LINE', { start: [0, 0], end: [10, 0] })
  const parallel = await create('LINE', { start: [0, 5], end: [10, 5] })
  const before = drawing.serialize()
  const revision = drawing.revision

  assert.throws(() => buildKJModificationCommand('array-rect', {
    ids: [first.id], values: { rows: 0, columns: 2, rowSpacing: 1, columnSpacing: 1 }, points: [],
  }), /at least 1/)
  assert.throws(() => buildKJModificationCommand('fillet', {
    ids: [first.id, parallel.id], values: { radius: 0 }, points: [[1, 0], [1, 5]],
  }), /at least/)
  assert.throws(() => buildKJModificationCommand('mirror', {
    ids: [first.id], values: {}, points: [[0, 0]],
  }), /requires 2 canvas points/)
  assert.throws(() => buildKJModificationCommand('polyline-insert', {
    ids: [first.id], values: { tolerance: -1 }, points: [[5, 0]],
  }), /at least 0/)
  assert.throws(() => buildKJModificationCommand('polyline-delete', {
    ids: [first.id], values: { tolerance: 0.1 }, points: [],
  }), /requires 1 canvas point/)
  assert.throws(() => buildKJModificationCommand('polyline-arc', {
    ids: [first.id], values: { sweepDegrees: 360, tolerance: 0.1 }, points: [[5, 0]],
  }), /at most 359\.999999/)

  const impossible = buildKJModificationCommand('fillet', {
    ids: [first.id, parallel.id], values: { radius: 2 }, points: [[8, 0], [8, 5]],
  })
  await assert.rejects(sdk.executeCommand(impossible.command, impossible.arguments), KJValidationError)
  assert.equal(drawing.revision, revision)
  assert.equal(drawing.serialize(), before)
})

test('polyline edit controls accept only one LWPOLYLINE or POLYLINE', () => {
  for (const id of ['polyline-insert', 'polyline-delete', 'polyline-arc']) {
    const definition = getKJModificationDefinition(id)
    assert.equal(definition.command, 'PEDIT')
    assert.deepEqual(definition.supportedEntityTypes, ['LWPOLYLINE', 'POLYLINE'])
    assert.doesNotThrow(() => validateKJModificationSelection(definition, [{ id: 'lw', type: 'LWPOLYLINE' }]))
    assert.doesNotThrow(() => validateKJModificationSelection(definition, [{ id: 'p3', type: 'POLYLINE' }]))
    assert.throws(() => validateKJModificationSelection(definition, [{ id: 'line', type: 'LINE' }]), /supports LWPOLYLINE, POLYLINE/)
    assert.throws(() => validateKJModificationSelection(definition, [
      { id: 'lw', type: 'LWPOLYLINE' },
      { id: 'p3', type: 'POLYLINE' },
    ]), /accepts at most 1/)
  }
})

test('array controls reject aggregate entity counts before creating any copies', async () => {
  const { sdk, drawing, create } = await drawingFixture('array-safety-limit')
  const first = await create('POINT', { position: [1, 0] })
  const second = await create('POINT', { position: [2, 0] })
  const ids = [first.id, second.id]
  const before = drawing.serialize()
  const revision = drawing.revision
  const history = { ...drawing.history }

  const rectangular = buildKJModificationCommand('array-rect', {
    ids,
    values: { rows: 1, columns: 50002, rowSpacing: 1, columnSpacing: 1 },
    points: [],
  })
  await assert.rejects(
    sdk.executeCommand(rectangular.command, rectangular.arguments),
    error => error instanceof KJValidationError && /100000 created entity safety limit/.test(error.message),
  )

  const polar = buildKJModificationCommand('array-polar', {
    ids,
    values: { count: 50002, angleDegrees: 360, rotateItems: true },
    points: [[0, 0]],
  })
  await assert.rejects(
    sdk.executeCommand(polar.command, polar.arguments),
    error => error instanceof KJValidationError && /100000 created entity safety limit/.test(error.message),
  )

  assert.equal(drawing.revision, revision)
  assert.equal(drawing.serialize(), before)
  assert.deepEqual(drawing.history, history)
  assert.equal(drawing.listEntities().length, 2)
})
