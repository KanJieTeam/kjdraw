import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { nativeEntity, nativeValue } from './helpers/private-native-corpus-oracle.mjs'

async function fixture() {
  const document = createKJDrawSDK().createDocument()
  let entity
  await document.transact('Public synthetic oracle fixture', transaction => {
    entity = transaction.createEntity('TEXT', { text: 'Literal mixed-case content', height: 2,
      position: [10, 20, 0], obliqueAngle: 0 })
  })
  return { document, entity: document.getObject(entity.id) }
}

test('native DXF oracle normalizes only resource-name case and native TEXT zero oblique default', async () => {
  const { document, entity } = await fixture()
  const upper = { ...entity, payload: { ...entity.payload, linetypeName: 'CONTINUOUS' } }
  const lower = { ...entity, payload: { ...entity.payload, linetypeName: 'Continuous' } }
  delete lower.payload.obliqueAngle
  assert.deepEqual(nativeEntity(document, upper), nativeEntity(document, lower))
  assert.equal(nativeEntity(document, lower).payload.text, 'Literal mixed-case content')
})

test('native DXF oracle detects real text, geometry, nonzero oblique angle and resource changes', async () => {
  const { document, entity } = await fixture()
  for (const patch of [{ text: 'Different content' }, { position: [11, 20, 0] },
    { obliqueAngle: 0.2 }, { linetypeName: 'DASHED' }]) {
    assert.notDeepEqual(nativeEntity(document, { ...entity, payload: { ...entity.payload, ...patch } }),
      nativeEntity(document, entity))
  }
})

test('native DXF oracle retains numeric viewport indices exactly, without weakening actual graph references', async () => {
  const { document } = await fixture()
  assert.equal(nativeValue(1, document, 'viewportId'), 1)
  assert.equal(nativeValue(2, document, 'viewportId'), 2)
  assert.notEqual(nativeValue(1, document, 'viewportId'), nativeValue(2, document, 'viewportId'))
  assert.throws(() => nativeValue('missing-native-identity', document, 'layerId'),
    { code: 'DXF_NATIVE_REFERENCE_MISSING' })
  assert.throws(() => nativeValue('missing-native-identity', document, 'viewportId'),
    { code: 'DXF_NATIVE_REFERENCE_MISSING' })
  assert.throws(() => nativeValue(['missing-native-identity'], document, 'reactorIds'),
    { code: 'DXF_NATIVE_REFERENCE_MISSING' })
})
