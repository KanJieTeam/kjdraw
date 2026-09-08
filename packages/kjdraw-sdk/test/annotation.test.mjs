import test from 'node:test'
import assert from 'node:assert/strict'
import { projectDimension } from '../src/geometry/annotation.js'
import { createKJDrawSDK } from '../src/index.js'

test('aligned dimensions generate extension lines, two arrows and exact measured text', () => {
  const d = projectDimension({ dimensionType: 'ALIGNED', definitionPoints: [[0, 8], [0, 0], [12, 0]] })
  assert.equal(d.measurement, 12)
  assert.equal(d.lines.length, 3)
  assert.deepEqual(d.lines[2], [[0, 8], [12, 8]])
  assert.equal(d.arrows.length, 2)
  assert.equal(d.label.text, '12')
  assert.equal(projectDimension({ dimensionType: 'ALIGNED', definitionPoints: [[0, 0], [0, 0], [0, 0]] }), null)
})

test('rotated and circular dimensions measure geometry instead of a stale cached value', () => {
  const vertical = projectDimension({ dimensionType: 'ROTATED', rotation: Math.PI / 2, definitionPoints: [[8, 2], [0, 0], [3, 4]], measurement: 900 })
  assert.ok(Math.abs(vertical.measurement - 4) < 1e-10)
  assert.equal(vertical.label.text, '4')
  const radius = projectDimension({ dimensionType: 'RADIUS', definitionPoints: [[0, 0], [3, 4]] })
  assert.equal(radius.label.text, 'R5')
  const diameter = projectDimension({ dimensionType: 'DIAMETER', definitionPoints: [[-3, -4], [3, 4]], textOverride: '<> mm' })
  assert.equal(diameter.measurement, 10)
  assert.equal(diameter.label.text, '⌀10 mm')
})

test('native radius and diameter DXF dimensions write the chord endpoint as group 15', async () => {
  for (const dimensionType of ['RADIUS', 'DIAMETER']) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: `dimension-${dimensionType}` })
    await sdk.executeCommand('CREATE', { type: 'DIMENSION', payload: { dimensionType, definitionPoints: [[0, 0, 0], [3, 4, 0]], textPosition: [6, 8, 0] } })
    const text = String(await sdk.writeDocument(document, { format: 'DXF' }))
    const lines = text.trimEnd().split(/\r?\n/), tags = []
    for (let index = 0; index < lines.length; index += 2) tags.push([Number(lines[index]), lines[index + 1]])
    const begin = tags.findIndex(([code, value]) => code === 0 && value === 'DIMENSION')
    assert.ok(begin >= 0, 'the exported DXF contains a native DIMENSION')
    const block = tags.slice(begin + 1, tags.findIndex(([code], index) => index > begin && code === 0))
    assert.ok(block.some(([code, value]) => code === 15 && value === '3'))
    assert.ok(block.every(([code]) => code !== 13))
    const reopened = await createKJDrawSDK().readDocument(text, { format: 'DXF' })
    const entity = reopened.listEntities({ type: 'DIMENSION' })[0]
    assert.deepEqual(entity.payload.definitionPoints, [[0, 0, 0], [3, 4, 0]])
    assert.equal(projectDimension(entity.payload).measurement, 5)
  }
})
