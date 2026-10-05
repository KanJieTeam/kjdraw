import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const fixture = direction => [
  0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES',
  0, 'LEADER', 5, 'A1', 100, 'AcDbEntity', 8, '0', 100, 'AcDbLeader',
  3, 'STANDARD', 71, 1, 72, 0, 73, 3, 74, 0, 75, 0, 76, 2,
  10, 1.25, 20, 2.75, 30, 0, 10, 13.5, 20, 8.125, 30, 0,
  ...(direction ? [211, direction[0], 221, direction[1], 231, direction[2]] : []),
  0, 'TEXT', 5, 'A2', 8, '0', 10, 30, 20, 30, 40, 2, 1, 'SYNTHETIC NOTE',
  0, 'ENDSEC', 0, 'EOF', '',
].join('\n')

const json = value => JSON.parse(JSON.stringify(value))

test('unrelated edits never add an absent LEADER horizontal direction or alter an explicit one', async () => {
  for (const direction of [undefined, [1, 0, 0], [0.6, 0.8, 0]]) {
    const sdk = createKJDrawSDK()
    let document = await sdk.readDocument(fixture(direction), { format: 'DXF' })
    const original = document.listEntities({ type: 'LEADER' })[0]
    const originalLayerName = document.getObject(original.payload.layerId).name
    for (let round = 0; round < 10; round++) {
      const leader = document.listEntities({ type: 'LEADER' })[0]
      const before = json(leader)
      const note = document.listEntities({ type: 'TEXT' })[0]
      await sdk.executeCommand('TEXTEDIT', { changes: [{ id: note.id, expectedText: note.payload.text, text: `SYNTHETIC ROUND ${round + 1}` }] }, { document })
      assert.deepEqual(json(document.getObject(leader.id)), before)
      await document.undo()
      assert.deepEqual(json(document.getObject(leader.id)), before)
      await document.redo()
      assert.deepEqual(json(document.getObject(leader.id)), before)
      document = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
      document = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
      const reopened = document.listEntities({ type: 'LEADER' })[0]
      assert.equal(reopened.handle, original.handle)
      // DXF retains resource handles/names, not KJD object UUIDs.
      const { layerId: actualLayerId, ...actualPayload } = json(reopened.payload)
      const { layerId: _originalLayerId, ...originalPayload } = json(original.payload)
      assert.deepEqual(actualPayload, originalPayload)
      assert.equal(document.getObject(actualLayerId).name, originalLayerName)
      assert.deepEqual(reopened.payload.horizontalDirection, direction)
    }
  }
})

test('an omitted LEADER direction keeps CAD default semantics in independent ezdxf', async t => {
  const sdk = createKJDrawSDK()
  const document = await sdk.readDocument(fixture(), { format: 'DXF' })
  const output = String(await sdk.writeDocument(document, { format: 'DXF' }))
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
source=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()
d=ezdxf.read(io.StringIO(source)); leader=list(d.modelspace().query('LEADER'))[0]
audit=d.audit()
print(json.dumps({'direction':list(leader.dxf.horizontal_direction),'vertices':[list(p) for p in leader.vertices],'errors':len(audit.errors),'fixes':len(audit.fixes)}))
`], output, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/iu.test(result.stderr)) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(result.stderr || result.error.message)
    t.skip('Independent ezdxf dependency required')
    return
  }
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    direction: [1, 0, 0], vertices: [[1.25, 2.75, 0], [13.5, 8.125, 0]], errors: 0, fixes: 0,
  })
})
