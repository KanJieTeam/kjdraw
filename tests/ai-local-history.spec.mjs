import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLocalHistory, saveLocalHistory } from '../apps/playground/ai/local-history.js'

// A small explicit storage control checks the real wrapper's completion
// contract. Native IndexedDB behavior is separately exercised in the browser.
function storageControl(t, { record, automatic = true, openError, operationError } = {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const control = { record: structuredClone(record), transactions: [], closed: 0, opens: [] }
  const database = {
    objectStoreNames: { contains: name => name === 'conversations' },
    close() { control.closed++ },
    transaction(name, mode) {
      assert.equal(name, 'conversations')
      const transaction = { mode, error: null }
      const operation = (kind, value, key) => {
        if (operationError) throw operationError
        assert.equal(key, 'history')
        const request = {}
        const candidate = kind === 'put' ? structuredClone(value) : undefined
        const entry = {
          transaction, request, kind,
          requestSuccess() {
            request.result = kind === 'put' ? key : structuredClone(control.record)
            request.onsuccess?.()
          },
          complete() {
            if (kind === 'put') control.record = candidate
            transaction.oncomplete?.()
          },
          fail(event, error) {
            transaction.error = error
            transaction[event]?.()
          },
        }
        control.transactions.push(entry)
        if (automatic) queueMicrotask(() => { entry.requestSuccess(); entry.complete() })
        return request
      }
      transaction.objectStore = store => {
        assert.equal(store, 'conversations')
        return { get: key => operation('get', undefined, key), put: (value, key) => operation('put', value, key) }
      }
      return transaction
    },
  }
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open(name, version) {
      control.opens.push({ name, version })
      const request = { result: database }
      queueMicrotask(() => {
        if (openError) { request.error = openError; request.onerror?.() }
        else request.onsuccess?.()
      })
      return request
    },
  } })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original)
    else delete globalThis.indexedDB
  })
  return control
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test('local history keeps old version-one sessions without inventing pin or draft fields', async t => {
  const legacy = { version: 1, activeId: 'legacy', sessions: [{ id: 'legacy', title: 'Original conversation', messages: [] }], connection: null }
  const storage = storageControl(t)
  await saveLocalHistory(legacy)
  const loaded = await loadLocalHistory()
  assert.deepEqual(loaded, legacy)
  assert.equal(Object.hasOwn(loaded.sessions[0], 'pinned'), false)
  assert.equal(Object.hasOwn(loaded, 'draft'), false)
  assert.deepEqual(storage.opens, [{ name: 'kjdraw-ai-local', version: 1 }, { name: 'kjdraw-ai-local', version: 1 }])
  assert.equal(storage.closed, 2)
})

test('local history preserves explicit boolean pins and a bounded Unicode draft without changing drawing state', async t => {
  const record = { version: 1, activeId: 'pinned', sessions: [
    { id: 'pinned', pinned: true, draft: '请只修改已明确的目标。\n'.repeat(20), state: { drawing: 'native-drawing-byte-fixture', committed: true }, messages: [] },
    { id: 'ordinary', pinned: false, state: { drawing: 'other-native-drawing-byte-fixture' }, messages: [] },
    { id: 'legacy', messages: [] },
  ], connection: null }
  storageControl(t)
  await saveLocalHistory(record)
  assert.deepEqual(await loadLocalHistory(), record)
})

test('save does not report completion at request success before the transaction completion barrier', async t => {
  const storage = storageControl(t, { automatic: false })
  let settled = false
  const pending = saveLocalHistory({ version: 1, sessions: [{ id: 'pin', pinned: true }] }).then(value => { settled = true; return value })
  await flush()
  assert.equal(storage.transactions[0].transaction.mode, 'readwrite')
  storage.transactions[0].requestSuccess()
  await flush()
  assert.equal(settled, false)
  assert.equal(storage.closed, 0)
  storage.transactions[0].complete()
  assert.equal(await pending, 'history')
  assert.equal(storage.closed, 1)
})

test('load also waits for transaction completion rather than exposing an early request receipt', async t => {
  const record = { version: 1, sessions: [{ id: 'pin', pinned: false }] }
  const storage = storageControl(t, { record, automatic: false })
  let settled = false
  const pending = loadLocalHistory().then(value => { settled = true; return value })
  await flush()
  assert.equal(storage.transactions[0].transaction.mode, 'readonly')
  storage.transactions[0].requestSuccess()
  await flush()
  assert.equal(settled, false)
  storage.transactions[0].complete()
  assert.deepEqual(await pending, record)
  assert.equal(storage.closed, 1)
})

for (const event of ['onabort', 'onerror']) {
  test(`local history rejects ${event} after request success and never admits the uncommitted pin`, async t => {
    const original = { version: 1, sessions: [{ id: 'original', pinned: false }] }
    const storage = storageControl(t, { record: original, automatic: false })
    const error = new Error('Public fixture transaction failed')
    const pending = assert.rejects(saveLocalHistory({ version: 1, sessions: [{ id: 'replacement', pinned: true }] }), value => value === error)
    await flush()
    storage.transactions[0].requestSuccess()
    storage.transactions[0].fail(event, error)
    await pending
    assert.deepEqual(storage.record, original)
    assert.equal(storage.closed, 1)
  })
}

test('database-open failure rejects without starting a write or silently dropping pin data', async t => {
  const error = new Error('Public fixture database unavailable')
  const storage = storageControl(t, { openError: error })
  await assert.rejects(saveLocalHistory({ sessions: [{ pinned: true }] }), value => value === error)
  assert.equal(storage.transactions.length, 0)
  assert.equal(storage.closed, 0)
})

test('synchronous native-store failure rejects and still closes the database', async t => {
  const error = new Error('Public fixture clone failure')
  const storage = storageControl(t, { operationError: error })
  await assert.rejects(saveLocalHistory({ sessions: [{ pinned: true }] }), value => value === error)
  assert.equal(storage.closed, 1)
})
