import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  KJDocument,
  createKJCoreDocumentAuthority,
  createKJCoreSolidBackend,
  createWasmGeometryBackend,
  ellipseArcLength2,
  intersectCircleCircle2,
  intersectLineCircle2,
  intersectLineLine2,
  KJCORE_WASM_ABI,
  orientation2,
  openKJCoreDocumentSession,
  polylineArea2,
  polylineLength2,
  registerGeometryBackend,
  splineLength2,
  unregisterGeometryBackend,
} from '../src/index.js'

const artifactUrl = new URL('../../../web/public/kjcore/kjcore.wasm', import.meta.url)

test('published KJCore WASM artifact executes the authoritative geometry ABI', async () => {
  const bytes = await readFile(artifactUrl)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const identity = registerGeometryBackend(createWasmGeometryBackend(instance))
  try {
    assert.equal(identity.abi, KJCORE_WASM_ABI)
    assert.equal(identity.authoritative, true)
    assert.equal(orientation2([1e12, 1e12], [1e12 + 4, 1e12 + 4], [1e12 + 8, 1e12 + 8.001]), 1)

    const crossing = intersectLineLine2([0, 0], [10, 0], [5, -2], [5, 2])
    assert.deepEqual(crossing, { kind: 'point', points: [[5, 0]], parametersA: [0.5], parametersB: [0.5] })

    const lineCircle = intersectLineCircle2([-2, 0], [2, 0], [0, 0], 1)
    assert.deepEqual(lineCircle.points, [[-1, 0], [1, 0]])

    const overlap = intersectCircleCircle2([0, 0], 2, [0, 0], 2)
    assert.equal(overlap.kind, 'overlap')
    assert.equal(overlap.infinite, true)

    const polyline = [[0, 0], [3, 0], [3, 4]]
    assert.equal(polylineLength2(polyline), 7)
    assert.equal(polylineArea2(polyline), 6)
    assert.ok(ellipseArcLength2({ majorAxis: [2, 0, 0], ratio: 0.5 }) > 9.68)
    const spline = splineLength2({ degree: 2, controlPoints: [[0, 0], [1, 1], [2, 0]] })
    assert.ok(spline > 2 && spline < 3)
  } finally {
    unregisterGeometryBackend()
  }
})

test('published KJCore WASM artifact creates, transforms and validates authoritative solids', async () => {
  const bytes = await readFile(artifactUrl)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const solids = createKJCoreSolidBackend(instance)
  const box = solids.box({ center:[0,0,0], size:[2,3,4] })
  const sweep = solids.sweep({ profile:[[0,0,0],[2,0,0],[2,1,0],[0,1,0]], vector:[0,0,3] })
  const sphere = solids.sphere({ center:[0,0,0], radius:2, segments:24 })
  const moved = box.transform([1,0,0,5, 0,1,0,0, 0,0,1,0, 0,0,0,1])
  try {
    assert.equal(solids.authoritative, true)
    assert.equal(box.validate(), true)
    assert.equal(box.volume, 24)
    assert.equal(sweep.volume, 6)
    assert.ok(sphere.volume > 31 && sphere.volume < 34)
    assert.equal(moved.serialize().validation.valid, true)
    assert.equal(moved.serialize().vertices.some(point => point[0] >= 4), true)
  } finally {
    box.close(); sweep.close(); sphere.close(); moved.close()
  }
})

test('published KJCore WASM artifact performs exact AABB booleans and rejects unsupported meshes', async () => {
  const bytes = await readFile(artifactUrl)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const solids = createKJCoreSolidBackend(instance)
  const first = solids.box({ center:[0,0,0], size:[4,4,4] })
  const second = solids.box({ center:[1,0,0], size:[4,2,2] })
  const intersection = first.boolean(second, 'intersection')
  const difference = first.boolean(second, 'difference')
  const sphere = solids.sphere({ center:[0,0,0], radius:1 })
  try {
    assert.equal(intersection.validate(), true)
    assert.equal(difference.validate(), true)
    assert.ok(Math.abs(intersection.volume - 12) < 1e-8)
    assert.ok(Math.abs(difference.volume - 52) < 1e-8)
    assert.throws(() => first.boolean(sphere, 'union'), /超出当前精确基本体范围/)
  } finally {
    first.close(); second.close(); intersection.close(); difference.close(); sphere.close()
  }
})

test('published KJCore WASM artifact opens, validates and canonically reopens a real KJD document', async () => {
  const bytes = await readFile(artifactUrl)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const document = KJDocument.create({ documentId: 'rust-artifact-roundtrip', title: 'Rust KJD ABI' })
  await document.transact('Create authoritative line', transaction => {
    transaction.createEntity('LINE', { start: [0, 0, 0], end: [18.25, -7.5, 0] })
  }, { at: '2026-08-22T10:00:00.000Z', source: 'artifact-test' })

  const source = document.serialize()
  const session = openKJCoreDocumentSession(instance, source)
  try {
    assert.equal(session.validate(), true)
    assert.equal(session.revision, 1)
    assert.match(session.fingerprint(), /^[0-9a-f]{16}$/)
    const canonical = session.serialize()
    const reopened = KJDocument.open(canonical)
    assert.equal(reopened.id, document.id)
    assert.equal(reopened.revision, document.revision)
    assert.deepEqual(reopened.listEntities(), document.listEntities())

    const secondSession = openKJCoreDocumentSession(instance, canonical)
    try {
      assert.equal(secondSession.validate(), true)
      assert.equal(secondSession.fingerprint(), session.fingerprint())
      assert.equal(secondSession.serialize(), canonical)
    } finally {
      secondSession.close()
    }
  } finally {
    session.close()
  }
  assert.equal(session.closed, true)
})

test('published KJCore WASM artifact authoritatively accepts SDK commits and undo history', async () => {
  const bytes = await readFile(artifactUrl)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const authority = createKJCoreDocumentAuthority(instance)
  const document = KJDocument.create({ documentId: 'rust-authoritative-commit' })
  document.bindAuthority(authority.open(document.serialize()))
  assert.equal(document.hasAuthoritativeBackend, true)

  const entity = await document.transact('Rust accepted circle', transaction => (
    transaction.createEntity('CIRCLE', { center: [4, 5, 0], radius: 2 })
  ), { at: '2026-08-22T11:00:00.000Z', source: 'artifact-test' })
  assert.equal(document.revision, 1)
  assert.equal(document.getObject(entity.id).payload.radius, 2)
  assert.equal(await document.undo({ at: '2026-08-22T11:01:00.000Z' }), true)
  assert.equal(document.revision, 2)
  assert.equal(document.getObject(entity.id), null)
  assert.equal(document.unbindAuthority(), true)
})

test('real Rust authority preserves complete content and supports optional parser defaults with undo and redo', async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(artifactUrl), {})
  const document = KJDocument.create()
  document.bindAuthority(createKJCoreDocumentAuthority(instance).open(document.serialize()))
  const line = await document.transact('Create', tx => tx.createEntity('LINE', { start: [0.1, 2.3, 0], end: [12.7, 8.9, 0] }, {
    name: 'Original', source: { unknown: [1, 'preserved'] }, extension: { xdata: { TEST: [{ code: 1000, value: 'preserved' }] } },
  }))
  await document.transact('Clear optional fields', tx => tx.updateObject(line.id, { name: undefined, source: undefined, erased: undefined }))
  assert.equal(document.hasAuthoritativeBackend, true)
  assert.equal(document.getObject(line.id).name, null)
  assert.equal(document.getObject(line.id).source, null)
  assert.equal(document.getObject(line.id).erased, false)
  assert.deepEqual(document.getObject(line.id).payload.end, [12.7, 8.9, 0])
  assert.deepEqual(document.getObject(line.id).extension, line.extension)
  await document.undo()
  assert.deepEqual(document.getObject(line.id).source, { unknown: [1, 'preserved'] })
  await document.redo()
  assert.equal(document.getObject(line.id).source, null)
  assert.equal(document.hasAuthoritativeBackend, true)
  document.unbindAuthority()
})

test('published KJCore WASM artifact rejects identity, revision and history tampering atomically', async () => {
  const bytes = await readFile(artifactUrl)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const document = KJDocument.create({ documentId: 'rust-rejects-tampering' })
  const session = openKJCoreDocumentSession(instance, document.serialize())
  const candidate = document.toJSON()
  candidate.revision = 1
  assert.throws(() => session.commit(candidate, 0), /操作无效/)
  assert.equal(session.revision, 0)

  candidate.documentId = 'different-document'
  candidate.revisions.push({ revision: 1 })
  assert.throws(() => session.commit(candidate, 0), /操作无效/)
  assert.equal(session.revision, 0)
  assert.throws(() => session.commit(document.serialize(), 3), /修订冲突/)
  assert.equal(session.revision, 0)
  session.close()
})
