import assert from 'node:assert/strict'
import test from 'node:test'

import { BrowserKjpFileBinding, KJProjectSession, createKJDrawSDK } from '../src/index.js'

test('project session journals committed envelopes, snapshots, packages and reopens', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'main', title: '主图' })
  const session = KJProjectSession.create({ sdk, id: 'project-local-1', title: '本地工程一', documents: [document], activeDocumentId: 'main' })
  const envelope = sdk.createCommandEnvelope('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [20, 10] } }, {
    document,
    expectedRevision: document.revision,
    origin: { kind: 'ui', owner: 'test' },
  })
  await sdk.executeCommandEnvelope(envelope, { document })
  assert.equal(session.commands.length, 1)
  assert.equal(session.commands[0].receipt.status, 'committed')
  assert.equal(session.state, 'dirty')
  const snapshot = session.createSnapshot('提交前基线', { id: 'baseline' })
  assert.equal(snapshot.documents[0].revision, 1)
  const bytes = await session.package({ modifiedAt: '2026-08-22T10:00:00.000Z' })
  session.markSaved()
  assert.equal(session.state, 'saved')
  assert.equal(session.hasChangedSinceSave(), false)

  const reopenedSdk = createKJDrawSDK()
  const reopened = await KJProjectSession.open(bytes, { sdk: reopenedSdk })
  assert.equal(reopened.id, session.id)
  assert.equal(reopened.activeDocument.listEntities({ type: 'LINE' }).length, 1)
  assert.equal(reopened.commands.length, 1)
  assert.equal(reopened.snapshotLedger[0].label, '提交前基线')
  assert.equal(reopened.state, 'saved')
  session.destroy(); reopened.destroy()
})

test('browser file binding validates before write and reopens the committed local bytes', async () => {
  const sdk = createKJDrawSDK()
  const session = KJProjectSession.create({ sdk, id: 'browser-local', documents: [sdk.createDocument({ documentId: 'model' })] })
  const source = await session.package({ modifiedAt: '2026-08-22T11:00:00.000Z' })
  let stored = new Uint8Array()
  const handle = {
    kind: 'file', name: '全国试用工程.kjp',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFile: async () => ({ arrayBuffer: async () => stored.slice().buffer }),
    createWritable: async () => ({ write: async value => { stored = new Uint8Array(value) }, close: async () => {}, abort: async () => {} }),
  }
  const binding = new BrowserKjpFileBinding(handle)
  const result = await binding.write(source)
  assert.equal(result.manifest.projectId, 'browser-local')
  assert.equal(result.name, '全国试用工程.kjp')
  assert.equal((await binding.read()).project.activeDocument.id, 'model')
  session.destroy()
})

test('browser file binding rejects external changes before overwrite and only rebases after an explicit read', async () => {
  const make = async (id, x) => {
    const sdk = createKJDrawSDK()
    const document = sdk.createDocument({ documentId: 'model' })
    await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [x, 0] } }, { document })
    const session = KJProjectSession.create({ sdk, id, documents: [document] })
    const bytes = await session.package({ modifiedAt: '2026-09-13T03:00:00.000Z' })
    session.destroy()
    return bytes
  }
  const original = await make('original', 10)
  const external = await make('external', 20)
  const desired = await make('desired', 30)
  let stored = original.slice()
  const handle = {
    kind: 'file', name: 'conflict.kjp',
    queryPermission: async () => 'granted',
    getFile: async () => ({ arrayBuffer: async () => stored.slice().buffer }),
    createWritable: async () => ({ write: async value => { stored = new Uint8Array(value).slice() }, close: async () => {} }),
  }
  const binding = new BrowserKjpFileBinding(handle)
  assert.equal((await binding.read()).project.manifest.projectId, 'original')
  stored = external.slice()
  await assert.rejects(binding.write(desired), error => error.code === 'KJFILE_CONFLICT' && error.details.phase === 'before-write')
  assert.equal((await binding.read()).project.manifest.projectId, 'external')
  assert.equal((await binding.write(desired)).manifest.projectId, 'desired')
})

test('browser file binding verifies the exact bytes committed after close', async () => {
  const sdk = createKJDrawSDK()
  const session = KJProjectSession.create({ sdk, id: 'intended', documents: [sdk.createDocument({ documentId: 'model' })] })
  const intended = await session.package({ modifiedAt: '2026-09-13T03:10:00.000Z' })
  const otherSdk = createKJDrawSDK()
  const other = KJProjectSession.create({ sdk: otherSdk, id: 'concurrent', documents: [otherSdk.createDocument({ documentId: 'model' })] })
  const concurrent = await other.package({ modifiedAt: '2026-09-13T03:11:00.000Z' })
  let stored = new Uint8Array()
  const handle = {
    kind: 'file', name: 'race.kjp',
    queryPermission: async () => 'granted',
    getFile: async () => ({ arrayBuffer: async () => stored.slice().buffer }),
    createWritable: async () => ({
      write: async value => { stored = new Uint8Array(value).slice() },
      close: async () => { stored = concurrent.slice() },
    }),
  }
  const binding = new BrowserKjpFileBinding(handle)
  await assert.rejects(binding.write(intended), error => error.code === 'KJFILE_CONFLICT' && error.details.phase === 'after-write')
  assert.equal((await binding.read()).project.manifest.projectId, 'concurrent')
  session.destroy()
  other.destroy()
})
