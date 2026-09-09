import assert from 'node:assert/strict'
import test from 'node:test'
import { arcSweep, createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
const at = (payload, fraction) => {
  const angle = payload.startAngle + arcSweep(payload) * fraction
  return [payload.center[0] + payload.radius * Math.cos(angle), payload.center[1] + payload.radius * Math.sin(angle), payload.center[2]]
}

test('DXF preserves clockwise minor, major and zero-crossing ARC geometry as native counterclockwise arcs', async () => {
  const adapter = createDXFFileAdapter()
  for (const [startAngle, endAngle, clockwise] of [
    [Math.PI / 2, 0, true], [0, Math.PI / 2, true], [Math.PI / 6, -Math.PI / 6, true], [0, Math.PI / 2, false],
  ]) {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument()
    const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: {
      center: [20, 30, 6], radius: 10, startAngle, endAngle, clockwise, color: 2,
    } })
    const before = drawing.serialize()
    for (const version of ['R12', 'R14', '2000', '2018']) {
      const reopened = await adapter.read(await adapter.write(drawing, { version }))
      const exported = reopened.listEntities()[0]
      assert.equal(exported.type, 'ARC')
      assert.equal(exported.payload.clockwise, false)
      assert.deepEqual(exported.payload.center, [20, 30, 6])
      assert.equal(exported.payload.color, 2)
      near(Math.abs(arcSweep(exported.payload)), Math.abs(arcSweep(arc.payload)))
      // Compare the actual locus, not just two endpoints: a wrong major arc shares endpoints.
      for (const fraction of [0, .25, .5, .75, 1]) {
        const expected = at(arc.payload, fraction)
        const actual = at(exported.payload, clockwise ? 1 - fraction : fraction)
        actual.forEach((value, index) => near(value, expected[index]))
      }
    }
    assert.equal(drawing.serialize(), before)
  }
})
