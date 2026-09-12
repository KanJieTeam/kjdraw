import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

async function authoredFixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'block-authoring', units: 'millimeter' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [20, 0, 0] } }, { document })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [10, 8, 0], radius: 3 } }, { document })
  const group = await sdk.executeCommand('GROUP', { name: 'assembly-selection', ids: [line.id, circle.id] }, { document })
  const inner = await sdk.executeCommand('BLOCKCREATE', {
    name: 'INNER_TAGGED', ids: [line.id], basePoint: [0, 0],
    attributeDefinitions: [{ tag: 'MARK', prompt: 'Part mark', defaultValue: 'A-001', position: [2, 2, 0], height: 2 }],
  }, { document })
  await sdk.executeCommand('BLOCKINSTANCEUPDATE', { id: inner.insert.id, attributeValues: { mark: 'A-009' } }, { document })
  const outer = await sdk.executeCommand('BLOCKCREATE', { name: 'OUTER_ASSEMBLY', ids: [inner.insert.id, circle.id], basePoint: [0, 0] }, { document })
  return { sdk, document, line, circle, group, inner, outer }
}

test('generic block authoring keeps nested attributed inserts, group membership, and scope boundaries', async () => {
  const { sdk, document, group, inner, outer } = await authoredFixture()
  assert.deepEqual(document.getObject(group.id).payload.memberIds, [outer.insert.id])
  const outerMembers = document.listEntities({ ownerId: outer.block.id })
  const nested = outerMembers.find(entity => entity.type === 'INSERT')
  assert.ok(nested)
  assert.equal(nested.payload.blockRecordId, inner.block.id)
  assert.equal(nested.payload.attributeIds.length, 1)
  assert.equal(document.getObject(nested.payload.attributeIds[0]).payload.text, 'A-009')
  const attdef = document.listEntities({ ownerId: inner.block.id, type: 'ATTDEF' })[0]
  await sdk.executeCommand('BLOCKDEFINITIONUPDATE', { blockRecordId: inner.block.id, id: attdef.id, patch: { payload: { text: 'FUTURE-DEFAULT' } } }, { document })
  assert.equal(document.getObject(nested.payload.attributeIds[0]).payload.text, 'A-009', 'definition default does not overwrite an existing instance value')
  const next = await sdk.executeCommand('BLOCKINSERT', { blockRecordId: inner.block.id, position: [50, 0], attributeValues: { MARK: 'B-100' } }, { document })
  assert.equal(document.getObject(next.payload.attributeIds[0]).payload.text, 'B-100')
  const beforeNested = document.getObject(nested.id).payload.position
  await sdk.executeCommand('BLOCKDEFINITIONUPDATE', { blockRecordId: outer.block.id, id: nested.id, patch: { payload: { position: [5, 6, 0], rotation: Math.PI / 2, scale: [2, 2, 2] } } }, { document })
  assert.deepEqual(document.getObject(nested.id).payload.position, [5, 6, 0])
  assert.ok(Math.abs(document.getObject(nested.id).payload.rotation-Math.PI/2)<1e-9)
  assert.deepEqual(document.getObject(nested.id).payload.scale, [2, 2, 2])
  const movedAttribute=document.getObject(nested.payload.attributeIds[0])
  assert.ok(Math.abs(movedAttribute.payload.position[0]-1)<1e-9&&Math.abs(movedAttribute.payload.position[1]-10)<1e-9)
  await sdk.executeCommand('UNDO', {}, { document })
  assert.deepEqual(document.getObject(nested.id).payload.position, beforeNested)
  await sdk.executeCommand('REDO', {}, { document })
  assert.deepEqual(document.getObject(nested.id).payload.position, [5, 6, 0])
  assert.equal(document.validate().valid, true)
})

test('block create is atomic across protection, cycle, depth, budgets, and cancellation-style no-op', async () => {
  {
    const sdk = createKJDrawSDK(), document = sdk.createDocument(), line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [1, 0] } }, { document })
    await document.transact('protect', tx => { const locked = tx.upsertTableRecord('layers', { name: 'LOCKED', payload: { locked: true, visible: true } }); tx.updateObject(line.id, { payload: { layerId: locked.id } }) })
    const before = document.serialize()
    await assert.rejects(sdk.executeCommand('BLOCKCREATE', { name: 'BLOCKED', id: line.id }, { document }), /locked|writable/)
    assert.equal(document.serialize(), before)
  }
  {
    const sdk = createKJDrawSDK(), document = sdk.createDocument()
    await document.transact('cyclic source', tx => {
      const a = tx.upsertTableRecord('blockRecords', { id: 'cycle-a', name: 'CYCLE_A', payload: { entityIds: [], isSpace: false } })
      const b = tx.upsertTableRecord('blockRecords', { id: 'cycle-b', name: 'CYCLE_B', payload: { entityIds: [], isSpace: false } })
      tx.createEntity('INSERT', { blockRecordId: b.id, position: [0, 0] }, { ownerId: a.id })
      tx.createEntity('INSERT', { blockRecordId: a.id, position: [0, 0] }, { ownerId: b.id })
    })
    const before = document.serialize()
    await assert.rejects(sdk.executeCommand('BLOCKINSERT', { blockRecordId: 'cycle-a' }, { document }), /cycle/)
    assert.equal(document.serialize(), before)
  }
  {
    const sdk = createKJDrawSDK(), document = sdk.createDocument()
    await document.transact('deep source', tx => {
      let previous = null
      for (let index = 0; index < 4; index++) {
        const block = tx.upsertTableRecord('blockRecords', { id: `depth-${index}`, name: `DEPTH_${index}`, payload: { entityIds: [], isSpace: false } })
        if (previous) tx.createEntity('INSERT', { blockRecordId: previous.id, position: [0, 0] }, { ownerId: block.id })
        else tx.createEntity('LINE', { start: [0, 0], end: [1, 0] }, { ownerId: block.id })
        previous = block
      }
    })
    const before = document.serialize()
    await assert.rejects(sdk.executeCommand('BLOCKINSERT', { blockRecordId: 'depth-3', maxBlockDepth: 3 }, { document }), /maxBlockDepth/)
    assert.equal(document.serialize(), before)
    await assert.rejects(sdk.executeCommand('BLOCKINSERT', { blockRecordId: 'depth-3', maxExpandedEntities: 2 }, { document }), /maxExpandedEntities/)
    assert.equal(document.serialize(), before)
  }
})

test('nested native blocks and instance attributes survive KJD, DXF, and independent ezdxf audit', async t => {
  const { sdk, document } = await authoredFixture()
  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const kjdReopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  assert.equal(kjdReopened.validate().valid, true)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const inner = reopened.getTable('blockRecords').records.find(record => record.name === 'INNER_TAGGED')
  const outer = reopened.getTable('blockRecords').records.find(record => record.name === 'OUTER_ASSEMBLY')
  assert.ok(inner && outer)
  const nested = reopened.listEntities({ ownerId: outer.id, type: 'INSERT' })[0]
  assert.equal(nested.payload.blockRecordId, inner.id)
  assert.equal(reopened.getObject(nested.payload.attributeIds[0]).payload.text, 'A-009')
  assert.equal(reopened.validate().valid, true)
  const script = String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));inner=d.blocks.get('INNER_TAGGED');outer=d.blocks.get('OUTER_ASSEMBLY')
assert len(list(inner.query('ATTDEF[tag=="MARK"]')))==1
nested=list(outer.query('INSERT[name=="INNER_TAGGED"]'));assert len(nested)==1 and nested[0].get_attrib_text('MARK')=='A-009'
roots=list(d.modelspace().query('INSERT[name=="OUTER_ASSEMBLY"]'));assert len(roots)==1
audit=d.audit();assert not audit.errors and not audit.fixes
print(json.dumps({'nested':len(nested),'roots':len(roots),'auditErrors':len(audit.errors)}))
`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named 'ezdxf'/.test(result.stderr)) { if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(result.stderr || result.error.message); t.skip('ezdxf required'); return }
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { nested: 1, roots: 1, auditErrors: 0 })
})
