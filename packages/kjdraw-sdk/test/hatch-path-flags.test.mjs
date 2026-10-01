import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/index.js'

test('DXF rebuild preserves distinct external and outermost HATCH boundary flags', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Hatch flag fixture', tx => {
    for (const [index, flags] of [3, 6, 22, 23].entries()) tx.createEntity('HATCH', {
      patternName: 'SOLID', solid: true,
      boundaryLoops: [{ flags, external: Boolean(flags & 17), closed: true,
        vertices: [[index * 10, 0], [index * 10 + 8, 0], [index * 10 + 8, 8], [index * 10, 8]],
      }],
    }, { id: 'hatch-' + index })
  })
  const kjd = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  const reopened = await sdk.readDocument(await sdk.writeDocument(kjd, { format: 'DXF' }), { format: 'DXF' })
  assert.deepEqual(reopened.listEntities().map(entity => entity.payload.boundaryLoops[0].flags), [3, 6, 22, 23])
  assert.deepEqual(reopened.listEntities().map(entity => entity.payload.boundaryLoops[0].external), [true, false, true, true])
  const hatch = reopened.listEntities()[2]
  await reopened.transact('Explicit island classification', tx => tx.updateObject(hatch.id, {
    payload: { boundaryLoops: [{ ...hatch.payload.boundaryLoops[0], external: false }] },
  }))
  const island = await sdk.readDocument(await sdk.writeDocument(reopened, { format: 'DXF' }), { format: 'DXF' })
  const actual = island.listEntities().find(entity => entity.handle === hatch.handle).payload.boundaryLoops[0]
  assert.equal(actual.flags, 6)
  assert.equal(actual.external, false)
})
