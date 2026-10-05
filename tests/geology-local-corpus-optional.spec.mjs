import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const directory = process.env.KJDRAW_GEOLOGY_DXF_DIR
const dxfGeometry = payload => JSON.parse(JSON.stringify(payload, (key, value) => {
  // DXF re-import rebuilds document resource IDs and raw tag formatting.
  if (key === 'rawTags' || key === 'contractVersion' || /Ids?$/.test(key)) return undefined
  return typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value
}))

// User-owned project files stay local; CI runs synthetic fixtures separately.
test('local geological section corpus survives KJD and DXF reopen with native hatches', {
  skip: !directory,
}, async t => {
  const files = (await readdir(directory)).filter(name => /\.dxf$/i.test(name)).sort((a, b) => Number.parseInt(a) - Number.parseInt(b))
  assert.ok(files.length > 0, 'the local corpus must contain at least one DXF')
  for (const name of files) {
    await t.test(name, async () => {
      const source = new Uint8Array(await readFile(join(directory, name)))
      const sdk = createKJDrawSDK()
      const original = await sdk.readDocument(source, { format: 'DXF' })
      assert.equal(original.validate().valid, true)
      const sourceEntities = original.listEntities()
      const countTypes = entities => Object.fromEntries(
        [...new Set(entities.map(entity => entity.type))].sort().map(type => [
          type, entities.filter(entity => entity.type === type).length,
        ]),
      )
      const expectedTypes = countTypes(sourceEntities)
      assert.ok(expectedTypes.HATCH > 0, 'native strata hatch must remain visible')
      assert.ok(expectedTypes.TEXT > 0, 'borehole and layer labels must remain visible')
      for (const format of ['KJD', 'DXF']) {
        const exported = await sdk.writeDocument(original, { format })
        const reopened = await createKJDrawSDK().readDocument(exported, { format })
        assert.equal(reopened.validate().valid, true)
        assert.deepEqual(countTypes(reopened.listEntities()), expectedTypes,
          format + ' must preserve visible native entity types and counts')
        if (format === 'KJD') {
          const reopenedById = new Map(reopened.listEntities().map(entity => [entity.id, entity]))
          for (const entity of sourceEntities) {
            const actual = reopenedById.get(entity.id)
            assert.ok(actual, name + ': KJD must preserve entity identity ' + entity.id)
            assert.equal(canonicalStringify(actual), canonicalStringify(entity),
              name + ': KJD must preserve full entity semantics for ' + entity.id)
          }
        } else {
          const reopenedByHandle = new Map(reopened.listEntities().map(entity => [entity.handle, entity]))
          for (const entity of sourceEntities) {
            const actual = reopenedByHandle.get(entity.handle)
            assert.ok(actual, name + ': DXF must preserve handle ' + entity.handle)
            assert.equal(actual.type, entity.type, name + ': DXF must preserve type for ' + entity.handle)
            assert.equal(canonicalStringify(dxfGeometry(actual.payload)), canonicalStringify(dxfGeometry(entity.payload)),
              name + ': DXF must preserve geometric fields, labels and hatch data for ' + entity.handle)
          }
        }
      }
    })
  }
})
