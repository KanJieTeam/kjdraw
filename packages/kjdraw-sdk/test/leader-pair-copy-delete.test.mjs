import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJValidationError } from '../src/errors.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const execute = (sdk, document, command, args = {}) => sdk.executeCommand(command, args, { document })
const json = value => JSON.parse(JSON.stringify(value))

async function fixture(name) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: name, units: 'millimeter' })
  const style = await execute(sdk, document, 'TEXTSTYLE', { operation: 'create', name: 'PAIR-STYLE', properties: { fontFamily: 'Noto Sans CJK SC', widthFactor: .85 } })
  const pair = await execute(sdk, document, 'LEADER', {
    vertices: [[2, 3, 0], [12, 9, 0], [24, 9, 0]], textPosition: [28, 9, 0], text: '泵组 P-101 Δ', textHeight: 4,
    width: 32, rotation: .1, attachmentPoint: 7, styleId: style.id,
  })
  const group = await execute(sdk, document, 'GROUP', { name: 'Owned annotation', ids: [pair.leader.id, pair.annotation.id] })
  const selection = await execute(sdk, document, 'SELECTIONSAVE', { name: 'Owned annotation selection', ids: [pair.annotation.id, pair.leader.id] })
  return { sdk, document, style, pair, group, selection }
}

function copiedPair(document, sourcePair, copies) {
  const leader = copies.find(entity => entity.source.copiedFromId === sourcePair.leader.id)
  const annotation = copies.find(entity => entity.source.copiedFromId === sourcePair.annotation.id)
  assert.equal(leader.type, 'LEADER'); assert.equal(annotation.type, 'MTEXT')
  assert.equal(leader.payload.annotationId, annotation.id)
  assert.equal(leader.payload.ownsAnnotation, true); assert.equal(leader.payload.annotationType, 0)
  assert.notEqual(leader.payload.annotationId, sourcePair.annotation.id)
  assert.equal(document.getObject(leader.payload.annotationId).id, annotation.id)
  assert.equal(leader.ownerId, sourcePair.leader.ownerId); assert.equal(annotation.ownerId, sourcePair.annotation.ownerId)
  assert.equal(leader.payload.layerId, sourcePair.leader.payload.layerId); assert.equal(annotation.payload.layerId, sourcePair.annotation.payload.layerId)
  assert.equal(annotation.payload.styleId, sourcePair.annotation.payload.styleId)
  return { leader, annotation }
}

for (const selectedMember of ['leader', 'annotation']) test(`COPY of owned ${selectedMember} creates one isolated complete pair and updates persistent memberships`, async () => {
  const { sdk, document, pair, group, selection } = await fixture(`copy-owned-${selectedMember}`)
  const before = document.snapshot().objects
  const copies = await execute(sdk, document, 'COPY', { id: pair[selectedMember].id, dx: 40, dy: -2 })
  assert.equal(copies.length, 2)
  const copied = copiedPair(document, pair, copies)
  assert.deepEqual(document.getObject(group.id).payload.memberIds, [pair.leader.id, copied.leader.id, pair.annotation.id, copied.annotation.id])
  assert.deepEqual(document.getObject(selection.id).payload.memberIds, [pair.annotation.id, copied.annotation.id, pair.leader.id, copied.leader.id])
  const after = document.snapshot().objects
  await execute(sdk, document, 'UNDO'); assert.deepEqual(document.snapshot().objects, before)
  await execute(sdk, document, 'REDO'); assert.deepEqual(document.snapshot().objects, after)

  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), reopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  const reopenedLeader = reopened.getObject(copied.leader.id), reopenedAnnotation = reopened.getObject(copied.annotation.id)
  assert.equal(reopenedLeader.payload.annotationId, reopenedAnnotation.id); assert.equal(reopenedLeader.payload.ownsAnnotation, true)
  assert.equal(reopenedAnnotation.payload.styleId, pair.annotation.payload.styleId)
  assert.deepEqual(reopened.getObject(group.id).payload.memberIds, document.getObject(group.id).payload.memberIds)
  assert.deepEqual(reopened.getObject(selection.id).payload.memberIds, document.getObject(selection.id).payload.memberIds)
})

test('DELETE of either owned member erases the complete pair, cleans memberships, and is one undoable transaction', async () => {
  for (const selectedMember of ['leader', 'annotation']) {
    const { sdk, document, pair, group, selection } = await fixture(`delete-owned-${selectedMember}`)
    const before = document.snapshot().objects, revision = document.revision
    const erased = await execute(sdk, document, 'DELETE', { id: pair[selectedMember].id })
    assert.equal(document.revision, revision + 1); assert.equal(erased.length, 2)
    assert.equal(document.getObject(pair.leader.id), null); assert.equal(document.getObject(pair.annotation.id), null)
    assert.deepEqual(document.getObject(group.id).payload.memberIds, []); assert.deepEqual(document.getObject(selection.id).payload.memberIds, [])
    const after = document.snapshot().objects
    await execute(sdk, document, 'UNDO'); assert.deepEqual(document.snapshot().objects, before)
    await execute(sdk, document, 'REDO'); assert.deepEqual(document.snapshot().objects, after)
    const kjd = await sdk.writeDocument(document, { format: 'KJD' }), reopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
    assert.equal(reopened.getObject(pair.leader.id), null); assert.equal(reopened.getObject(pair.annotation.id), null)
    assert.deepEqual(reopened.getObject(group.id).payload.memberIds, []); assert.deepEqual(reopened.getObject(selection.id).payload.memberIds, [])
  }
})

test('copied owned pairs preserve native DXF annotation handles and pass independent ezdxf audit', async t => {
  const { sdk, document, pair } = await fixture('copy-owned-dxf')
  const copies = await execute(sdk, document, 'COPY', { id: pair.annotation.id, dx: 50, dy: 0 })
  const copied = copiedPair(document, pair, copies)
  const dxf = String(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }))
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const reopenedCopied = reopened.listEntities({ type: 'LEADER' }).find(entity => entity.handle === copied.leader.handle)
  assert.ok(reopenedCopied)
  const reopenedNote = reopened.getObject(reopenedCopied.payload.annotationId)
  assert.equal(reopenedNote.type, 'MTEXT'); assert.equal(reopenedNote.handle, copied.annotation.handle)
  assert.deepEqual(reopenedCopied.payload.textPosition, reopenedNote.payload.position)

  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import sys,io,json,os,ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH'); source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source)); leaders=list(d.modelspace().query('LEADER')); pairs=[]
for leader in leaders:
    note=d.entitydb.get(leader.dxf.annotation_handle)
    pairs.append({'leader':leader.dxf.handle,'annotation':leader.dxf.annotation_handle,'note':note.dxf.handle,'text':note.text})
a=d.audit(); print(json.dumps({'pairs':pairs,'errors':len(a.errors),'fixes':len(a.fixes)},ensure_ascii=False))
`], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(result.stderr)) t.skip('Independent ezdxf dependency required')
  else {
    assert.equal(result.status, 0, result.stderr)
    const observed = JSON.parse(result.stdout)
    assert.equal(observed.pairs.length, 2); assert.ok(observed.pairs.every(item => item.annotation === item.note))
    assert.equal(observed.pairs.filter(item => item.text === '泵组 P-101 Δ').length, 2)
    assert.equal(observed.errors + observed.fixes, 0)
  }
})

async function unsafeFixture(kind) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact(`unsafe ${kind}`, tx => {
    const protectedLayer = ['locked-layer', 'hidden-layer', 'frozen-layer'].includes(kind)
      ? tx.upsertTableRecord('layers', { id: 'protected', name: 'PROTECTED', payload: { visible: kind !== 'hidden-layer', locked: kind === 'locked-layer', frozen: kind === 'frozen-layer' } }) : null
    const otherLayer = kind === 'cross-layer' ? tx.upsertTableRecord('layers', { id: 'other', name: 'OTHER', payload: {} }) : null
    const paperOwner = document.getObject(document.spaces.layoutIds[1]).payload.blockRecordId
    tx.createEntity('MTEXT', { position: [30, 12, 0], text: 'NOTE', height: 3, styleId: document.getTable('textStyles').currentId, ...(kind === 'cross-layer' ? { layerId: otherLayer.id } : {}), ...(protectedLayer ? { layerId: protectedLayer.id } : {}) }, { id: 'note', ...(kind === 'cross-space' ? { ownerId: paperOwner } : {}) })
    tx.createEntity('LEADER', { vertices: [[5, 5, 0], [15, 12, 0]], textPosition: [30, 12, 0], annotationId: kind === 'broken' ? 'missing' : 'note', ownsAnnotation: kind !== 'unowned', annotationType: 0, ...(kind === 'locked-entity' ? { locked: true } : {}), ...(kind === 'hidden-entity' ? { visible: false } : {}), ...(kind === 'frozen-entity' ? { frozen: true } : {}), ...(protectedLayer ? { layerId: protectedLayer.id } : {}) }, { id: 'leader' })
    if (kind === 'ambiguous') tx.createEntity('LEADER', { vertices: [[0, 0, 0], [2, 2, 0]], textPosition: [30, 12, 0], annotationId: 'note', ownsAnnotation: false, annotationType: 0 }, { id: 'other-leader' })
  })
  return { sdk, document }
}

test('COPY and DELETE reject unsafe pair ownership, topology, protection and relocation before mutation', async () => {
  for (const kind of ['unowned', 'broken', 'ambiguous', 'cross-space', 'cross-layer', 'locked-entity', 'hidden-entity', 'frozen-entity', 'locked-layer', 'hidden-layer', 'frozen-layer']) {
    for (const command of ['COPY', 'DELETE']) {
      const { sdk, document } = await unsafeFixture(kind), before = document.serialize(), history = json(document.history), revision = document.revision
      const id = kind === 'ambiguous' ? 'note' : 'leader'
      await assert.rejects(execute(sdk, document, command, { id, dx: 10 }), error => error instanceof KJValidationError && /LEADER|annotation|layer|space|geometry/i.test(error.message), `${kind} ${command}`)
      assert.equal(document.serialize(), before); assert.deepEqual(json(document.history), history); assert.equal(document.revision, revision)
    }
  }
  const { sdk, document, pair } = await fixture('copy-relocation-rejections')
  const otherOwner = document.getObject(document.spaces.layoutIds[1]).payload.blockRecordId
  for (const args of [{ id: pair.leader.id, dx: 1, ownerId: otherOwner }, { id: pair.annotation.id, dx: 1, payloadPatch: { color: 1 } }]) {
    const before = document.serialize(), history = json(document.history)
    await assert.rejects(execute(sdk, document, 'COPY', args), KJValidationError)
    assert.equal(document.serialize(), before); assert.deepEqual(json(document.history), history)
  }
})
