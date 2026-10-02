import assert from 'node:assert/strict'
import test from 'node:test'
import { createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

// Original small fixture derived from the public DXF entity specification.
// No geometry, names, or annotations from a private drawing are included.
const fixture = () => [
  0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1032', 0, 'ENDSEC',
  0, 'SECTION', 2, 'BLOCKS',
  0, 'BLOCK', 5, 'B0', 2, 'ANNOTATION', 70, 0, 10, 0, 20, 0, 30, 0,
  0, 'LINE', 5, 'B1', 8, '0', 10, 0, 20, 0, 11, 2, 21, 0,
  0, 'ENDBLK', 0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES',
  0, 'MTEXT', 5, 'A1', 8, '0', 10, 12, 20, 8, 40, 2, 1, 'ORIGINAL NOTE',
  0, 'TOLERANCE', 5, 'A2', 8, '0', 3, 'STANDARD', 10, 22, 20, 8,
  1, String.raw`{\Fgdt;r}%%v0.02%%vA`, 11, 1, 21, 0, 31, 0,
  0, 'INSERT', 5, 'A3', 8, '0', 2, 'ANNOTATION', 10, 32, 20, 8,
  ...[['C1', 'A1', 0], ['C2', 'A2', 1], ['C3', 'A3', 2], ['C4', '0', 3]].flatMap(([handle, annotation, type], index) => [
    0, 'LEADER', 5, handle, 8, '0', 3, 'STANDARD', 71, 1, 72, 0, 73, type,
    76, 2, 10, index * 10, 20, 0, 30, 0, 10, index * 10 + 10, 20, 8, 30, 0, 340, annotation,
  ]),
  0, 'ENDSEC', 0, 'EOF', '',
].join('\n')

const assertReferences = document => {
  const leaders = document.listEntities({ type: 'LEADER' }).toSorted((a, b) => a.handle.localeCompare(b.handle))
  assert.equal(leaders.length, 4)
  for (const [index, type] of ['MTEXT', 'TOLERANCE', 'INSERT'].entries()) {
    const leader = leaders[index], annotation = document.getObject(leader.payload.annotationId)
    assert.equal(annotation.type, type)
    assert.equal(annotation.ownerId, leader.ownerId)
    assert.equal(leader.payload.annotationType, index)
    assert.equal(leader.payload.unresolvedLeaderAnnotation, undefined)
    assert.deepEqual(leader.payload.textPosition, annotation.payload.position)
  }
  assert.equal(leaders[3].payload.annotationType, 3)
  assert.equal(leaders[3].payload.annotationHandle, null)
  assert.equal(leaders[3].payload.annotationId, null)
  assert.equal(leaders[3].payload.unresolvedLeaderAnnotation, undefined)
}

test('DXF LEADER resolves MTEXT, TOLERANCE, INSERT and null references through KJD and DXF', async () => {
  const sdk = createKJDrawSDK()
  let document = await sdk.readDocument(fixture(), { format: 'DXF' })
  assertReferences(document)
  document = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assertReferences(document)
  document = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  assertReferences(document)
})

test('LEADER annotation references fail closed for wrong type, owner, missing and erased targets', async () => {
  const adapter = createDXFFileAdapter()
  const wrongType = fixture().replace('340\nA1', '340\nB1')
  const wrongTypeDocument = await adapter.read(wrongType)
  assert.match(wrongTypeDocument.listEntities({ type: 'LEADER' })[0].payload.unresolvedLeaderAnnotation, /B1/)
  assert.throws(() => adapter.write(wrongTypeDocument), /unresolved annotation/)
  const missingDocument = await adapter.read(fixture().replace('340\nA1', '340\nDEAD'))
  assert.throws(() => adapter.write(missingDocument), /unresolved annotation/)
  const wrongOwnerDocument = await adapter.read(fixture().replace('340\nA1', '340\nA3').replace('5\nA3\n8\n0', '5\nA3\n8\n0\n67\n1'))
  assert.match(wrongOwnerDocument.listEntities({ type: 'LEADER' })[0].payload.unresolvedLeaderAnnotation, /wrong-owner/)
  assert.throws(() => adapter.write(wrongOwnerDocument), /unresolved annotation/)
  const erasedDocument = await adapter.read(fixture())
  const leader = erasedDocument.listEntities({ type: 'LEADER' })[1]
  await erasedDocument.transact('erase annotation', tx => tx.eraseObject(leader.payload.annotationId))
  assert.throws(() => adapter.write(erasedDocument), /live MTEXT, TOLERANCE, or INSERT/)
})

test('independent ezdxf observes every exported LEADER annotation type and no structural repair', async t => {
  const adapter = createDXFFileAdapter(), output = adapter.write(await adapter.read(fixture()))
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
d=ezdxf.read(io.StringIO(open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()))
leaders=list(d.modelspace().query('LEADER'))
refs=[{'type':e.dxf.annotation_type,'target':d.entitydb[e.dxf.annotation_handle].dxftype() if e.dxf.annotation_handle!='0' else None} for e in leaders]
a=d.audit()
print(json.dumps({'references':refs,'errors':len(a.errors),'fixes':len(a.fixes)}))
`], output, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/iu.test(result.stderr)) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(result.stderr || result.error.message)
    t.skip('Independent ezdxf dependency required'); return
  }
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { references: [
    { type: 0, target: 'MTEXT' }, { type: 1, target: 'TOLERANCE' }, { type: 2, target: 'INSERT' }, { type: 3, target: null },
  ], errors: 0, fixes: 0 })
})
