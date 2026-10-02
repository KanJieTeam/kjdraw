import assert from 'node:assert/strict'
import test from 'node:test'
import { createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const fixture = () => [
  0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1032', 0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES',
  ...[undefined, 1, 3, 5].flatMap((flow, index) => [
    0, 'MTEXT', 5, `A${index}`, 8, '0', 10, index * 10, 20, 0,
    40, 2, 1, `ORIGINAL TEXT ${index}`, ...(flow === undefined ? [] : [72, flow]),
  ]),
  ...[0, 1, 128, 129].flatMap((flags, index) => [
    0, 'LWPOLYLINE', 5, `B${index}`, 8, '0', 90, 3, 70, flags,
    10, index * 10, 20, 10, 10, index * 10 + 4, 20, 10, 10, index * 10 + 4, 20, 15,
  ]),
  0, 'CIRCLE', 5, 'C0', 8, '0', 10, 50, 20, 50, 40, 2,
  0, 'ENDSEC', 0, 'EOF', '',
].join('\n')

test('unrelated edits and KJD/DXF reopen preserve MTEXT flow and LWPOLYLINE Plinegen flags', async () => {
  const sdk = createKJDrawSDK()
  let document = await sdk.readDocument(fixture(), { format: 'DXF' })
  await sdk.executeCommand('MOVE', { id: document.listEntities({ type: 'CIRCLE' })[0].id, dx: 2 }, { document })
  for (const format of ['KJD', 'DXF']) {
    document = await sdk.readDocument(await sdk.writeDocument(document, { format }), { format })
    const text = document.listEntities({ type: 'MTEXT' }).toSorted((a, b) => a.handle.localeCompare(b.handle))
    assert.deepEqual(text.map(e => e.payload.flowDirection), [undefined, 1, 3, 5])
    const polylines = document.listEntities({ type: 'LWPOLYLINE' }).toSorted((a, b) => a.handle.localeCompare(b.handle))
    assert.deepEqual(polylines.map(e => e.payload.closed), [false, true, false, true])
    assert.deepEqual(polylines.map(e => Number(e.payload.dxfFlags ?? 0) & 128), [0, 0, 128, 128])
  }
  const closed = document.listEntities({ type: 'LWPOLYLINE' }).find(e => e.handle === 'B3')
  await document.transact('open polyline', tx => tx.updateObject(closed.id, { payload: { closed: false } }))
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  assert.equal(reopened.listEntities({ type: 'LWPOLYLINE' }).find(e => e.handle === 'B3').payload.dxfFlags, 128)
})

test('native MTEXT keeps its default payload and invalid explicit flow fails export', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const created = await sdk.executeCommand('CREATE', { type: 'MTEXT', payload: { position: [0, 0, 0], height: 2, text: 'NATIVE DEFAULT' } }, { document })
  assert.equal(created.payload.flowDirection, undefined)
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  assert.equal(reopened.listEntities({ type: 'MTEXT' })[0].payload.flowDirection, undefined)
  await document.transact('invalid flow', tx => tx.updateObject(created.id, { payload: { flowDirection: 2 } }))
  await assert.rejects(sdk.writeDocument(document, { format: 'DXF' }), error => /flowDirection must be 1, 3, or 5/.test(error.cause?.message ?? error.message))
})

test('LWPOLYLINE rejects malformed and legacy flags before native or R12 conversion', async () => {
  const adapter = createDXFFileAdapter()
  for (const flags of [NaN, Infinity, -1, 0.5, 128.5, 2, 4, 8, 16, 64, 256, 4294967424, '128']) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument()
    await document.transact('invalid lightweight flags', tx => tx.createEntity('LWPOLYLINE', {
      vertices: [[0, 0, 0], [4, 0, 0], [4, 3, 0]], closed: false, dxfFlags: flags,
    }))
    for (const version of ['R12', '2018']) {
      assert.throws(() => adapter.write(document, { version }), /LWPOLYLINE dxfFlags must contain only/, `${String(flags)} ${version}`)
    }
  }
})

test('legacy flat 3D POLYLINE flags remain in the distinct POLYLINE writer', async () => {
  const source = [
    0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1032', 0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES', 0, 'POLYLINE', 5, 'D0', 8, '0', 66, 1, 70, 8,
    10, 0, 20, 0, 30, 0,
    0, 'VERTEX', 5, 'D1', 8, '0', 10, 0, 20, 0, 30, 0, 70, 32,
    0, 'VERTEX', 5, 'D2', 8, '0', 10, 4, 20, 3, 30, 0, 70, 32,
    0, 'SEQEND', 5, 'D3', 8, '0', 0, 'ENDSEC', 0, 'EOF', '',
  ].join('\n')
  const sdk = createKJDrawSDK(), document = await sdk.readDocument(source, { format: 'DXF' })
  assert.equal(document.listEntities({ type: 'POLYLINE' })[0].payload.dxfFlags, 8)
  const output = String(await sdk.writeDocument(document, { format: 'DXF' }))
  assert.doesNotMatch(output, /\r\nLWPOLYLINE\r\n/)
  const reopened = await sdk.readDocument(output, { format: 'DXF' })
  const polyline = reopened.listEntities({ type: 'POLYLINE' })[0]
  assert.equal(polyline.payload.dxfFlags, 8)
  assert.deepEqual(polyline.payload.vertices.map(vertex => vertex.point), [[0, 0, 0], [4, 3, 0]])
})

test('invalid imported LWPOLYLINE flags reject instead of being truncated', async () => {
  for (const flags of [0.5, 8, 256, 4294967424]) {
    const sdk = createKJDrawSDK(), source = fixture().replace('70\n0\n10', `70\n${flags}\n10`)
    await assert.rejects(sdk.readDocument(source, { format: 'DXF' }), error =>
      /LWPOLYLINE dxfFlags must contain only/.test(error.cause?.message ?? error.message))
  }
})

test('independent ezdxf retains source display flags without structural repair', async t => {
  const sdk = createKJDrawSDK(), document = await sdk.readDocument(fixture(), { format: 'DXF' })
  const output = String(await sdk.writeDocument(document, { format: 'DXF' }))
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
d=ezdxf.read(io.StringIO(open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()))
flows=[e.dxf.flow_direction for e in sorted(d.modelspace().query('MTEXT'),key=lambda e:e.dxf.handle)]
flags=[e.dxf.flags for e in sorted(d.modelspace().query('LWPOLYLINE'),key=lambda e:e.dxf.handle)]
a=d.audit()
print(json.dumps({'flows':flows,'flags':flags,'errors':len(a.errors),'fixes':len(a.fixes)}))
`], output, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/iu.test(result.stderr)) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(result.stderr || result.error.message)
    t.skip('Independent ezdxf dependency required'); return
  }
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { flows: [1, 1, 3, 5], flags: [0, 1, 128, 129], errors: 0, fixes: 0 })
})
