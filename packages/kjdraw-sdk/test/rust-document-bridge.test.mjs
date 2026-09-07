import assert from 'node:assert/strict'
import test from 'node:test'

import {
  KJCORE_DOCUMENT_MODEL_VERSION,
  KJValidationError,
  canonicalizeKjdWithKJCore,
  openKJCoreDocumentSession,
} from '../src/index.js'

function mockDocumentKernel() {
  const memory = new WebAssembly.Memory({ initial: 2 })
  const encoder = new TextEncoder(), decoder = new TextDecoder()
  let bump = 32, nextHandle = 1, lastError = 0, result = new Uint8Array(), sessions = new Map()
  const setResult = value => { result = encoder.encode(value); return result.length }
  const exports = {
    memory,
    kjcore_abi_magic: () => 0x4b4a4301,
    kjcore_document_model_version: () => 1,
    kjcore_last_error: () => lastError,
    kjcore_alloc_u8: length => { const pointer = bump; bump += Math.max(1, length); return pointer },
    kjcore_free_u8: () => {},
    kjcore_document_open_kjd(pointer, length) {
      try {
        const document = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, pointer, length)))
        if (document.schema !== 'com.kanjie.kjdraw.document' || document.schemaVersion !== 1) { lastError = 102; return -102 }
        const handle = nextHandle++; sessions.set(handle, document); lastError = 0; return handle
      } catch { lastError = 101; return -101 }
    },
    kjcore_document_close(handle) { return sessions.delete(handle) ? 1 : -105 },
    kjcore_document_validate: handle => sessions.has(handle) ? 1 : -105,
    kjcore_document_revision: handle => sessions.get(handle)?.revision ?? Number.NaN,
    kjcore_document_serialize_kjd: handle => sessions.has(handle) ? setResult(JSON.stringify(sessions.get(handle))) : -105,
    kjcore_document_fingerprint: handle => sessions.has(handle) ? setResult('0123456789abcdef') : -105,
    kjcore_document_commit_kjd(handle, pointer, length, expectedRevision) {
      const current = sessions.get(handle)
      if (!current) { lastError = 105; return -105 }
      if (current.revision !== expectedRevision) { lastError = 103; return -103 }
      try {
        const document = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, pointer, length)))
        if (document.documentId !== current.documentId || document.revision !== expectedRevision + 1) { lastError = 106; return -106 }
        sessions.set(handle, document); lastError = 0; return 1
      } catch { lastError = 101; return -101 }
    },
    kjcore_byte_result_len: () => result.length,
    kjcore_byte_result_value: index => result[index] ?? 0xffffffff,
  }
  return { exports }
}

test('Rust document bridge owns validated KJD sessions and canonical writeback', () => {
  const wasm = mockDocumentKernel()
  const source = { schema: 'com.kanjie.kjdraw.document', schemaVersion: 1, documentId: 'bridge', revision: 7 }
  const session = openKJCoreDocumentSession(wasm, source)
  assert.equal(KJCORE_DOCUMENT_MODEL_VERSION, 1)
  assert.equal(session.revision, 7)
  assert.equal(session.validate(), true)
  assert.equal(JSON.parse(session.serialize()).documentId, 'bridge')
  assert.equal(session.fingerprint(), '0123456789abcdef')
  assert.equal(JSON.parse(session.commit({ ...source, revision: 8 }, 7)).revision, 8)
  assert.equal(session.revision, 8)
  assert.equal(session.close(), true)
  assert.equal(session.close(), false)
  assert.throws(() => session.serialize(), KJValidationError)
  assert.equal(JSON.parse(canonicalizeKjdWithKJCore(wasm, source)).revision, 7)
})

test('Rust document bridge refuses bad ABI and invalid KJD before a session exists', () => {
  assert.throws(() => openKJCoreDocumentSession({ exports: { kjcore_abi_magic: () => 0 } }, '{}'), /ABI/)
  assert.throws(() => openKJCoreDocumentSession(mockDocumentKernel(), '{bad'), error => error instanceof KJValidationError && /解析失败/.test(error.message))
})
