import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK } from '../src/index.js'

test('layer commands create, activate, update and safely delete real table records', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'layers' })
  const layer0 = document.getTable('layers').currentId
  const first = await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [0, 0] } })
  assert.equal(first.payload.layerId, layer0)

  const survey = await sdk.executeCommand('LAYERNEW', { name: 'SURVEY', color: 3, lineweight: 25 })
  await sdk.executeCommand('LAYERCURRENT', { name: 'survey' })
  const second = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [2, 0] } })
  assert.equal(second.payload.layerId, survey.id)
  await sdk.executeCommand('LAYERUPDATE', { id: survey.id, newName: 'SURVEY-CONTROL', patch: { locked: true } })
  assert.equal(document.getObject(survey.id).name, 'SURVEY-CONTROL')
  assert.equal(document.getObject(survey.id).payload.locked, true)

  await assert.rejects(sdk.executeCommand('LAYERDELETE', { id: survey.id }), KJValidationError)
  await sdk.executeCommand('LAYERCURRENT', { id: layer0 })
  await assert.rejects(sdk.executeCommand('LAYERDELETE', { id: survey.id }), KJValidationError)
  await assert.rejects(sdk.executeCommand('PROPERTIES', { id: second.id, patch: { payload: { layerId: layer0 } } }), /layer .* is locked/)
  await sdk.executeCommand('LAYERUPDATE', { id: survey.id, patch: { locked: false } })
  await sdk.executeCommand('PROPERTIES', { id: second.id, patch: { payload: { layerId: layer0 } } })
  await sdk.executeCommand('LAYERDELETE', { id: survey.id })
  assert.equal(document.getObject(survey.id), null)
  assert.equal(document.getTable('layers').records.length, 1)
  assert.equal(document.validate().valid, true)
})
