import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK } from '../src/index.js'

test('ordinary commits defer whole-document fingerprints until a caller requests one', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'lazy-fingerprint' })
  const initial = document.fingerprint()
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [1, 1] } })
  assert.equal(document.snapshot().revisions.at(-1).fingerprint, undefined)
  const changed = document.fingerprint()
  assert.notEqual(changed, initial)
  assert.equal(document.fingerprint(), changed)
  const immutable = document.getObject(line.id), spaces = document.spaces, metadata = document.metadata
  assert.ok(Object.isFrozen(immutable) && Object.isFrozen(immutable.payload) && Object.isFrozen(spaces) && Object.isFrozen(spaces.layoutIds) && Object.isFrozen(metadata))
  assert.throws(() => { immutable.payload.start[0] = 99 }, TypeError)
  assert.throws(() => { spaces.layoutIds.push('foreign') }, TypeError)

  await sdk.executeCommand('MOVE', { id: line.id, dx: 2, dy: 0 })
  assert.deepEqual(immutable.payload.start, [0, 0, 0])
  assert.deepEqual(document.getObject(line.id).payload.start, [2, 0, 0])
  assert.equal(document.snapshot().revisions.at(-1).fingerprint, undefined)
  const moved = document.fingerprint()
  assert.notEqual(moved, changed)
  await sdk.executeCommand('UNDO')
  assert.equal(document.snapshot().revisions.at(-1).fingerprint, undefined)
  assert.equal(document.fingerprint(), changed)
  await sdk.executeCommand('REDO')
  assert.equal(document.fingerprint(), moved)

  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.equal(reopened.fingerprint(), moved)
})
