import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { getEntityGrips } from '../src/grips.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const pointAt = parameter => [10 * Math.cos(parameter), 5 * Math.sin(parameter), 3]

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'ellipse-arc-grip-edit', units: 'millimeter' })
  const arc = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: { center: [0, 0, 3], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI } }, { document })
  return { sdk, document, arc }
}

test('elliptical arc endpoint grips edit the native parameter sweep with one undoable transaction', async () => {
  const { sdk, document, arc } = await fixture()
  const grips = getEntityGrips(document.getObject(arc.id))
  assert.deepEqual(grips.map(grip => grip.id), ['center', 'major:positive', 'major:negative', 'minor:positive', 'minor:negative', 'start-parameter', 'end-parameter'])
  assert.deepEqual(grips.at(-2).point, [10, 0, 3]); close(grips.at(-1).point[0], -10); close(grips.at(-1).point[1], 0)
  const before = document.snapshot().objects[arc.id].payload
  await sdk.executeCommand('GRIPEDIT', { id: arc.id, gripId: 'start-parameter', point: pointAt(Math.PI / 4) }, { document })
  close(document.getObject(arc.id).payload.startParameter, Math.PI / 4)
  assert.equal(document.getObject(arc.id).payload.endParameter, Math.PI)
  assert.deepEqual(document.getObject(arc.id).payload.center, [0, 0, 3]); assert.deepEqual(document.getObject(arc.id).payload.majorAxis, [10, 0, 0])
  const changed = document.getObject(arc.id).payload
  await sdk.executeCommand('UNDO', {}, { document }); assert.deepEqual(document.getObject(arc.id).payload, before)
  await sdk.executeCommand('REDO', {}, { document }); assert.deepEqual(document.getObject(arc.id).payload, changed)

  const invalidBefore = document.serialize()
  await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: arc.id, gripId: 'end-parameter', point: [0, 0, 3] }, { document }), /center/)
  assert.equal(document.serialize(), invalidBefore)
  await sdk.executeCommand('LAYERUPDATE', { id: arc.payload.layerId, patch: { locked: true } }, { document })
  const protectedBefore = document.serialize()
  await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: arc.id, gripId: 'end-parameter', point: pointAt(Math.PI * 1.5) }, { document }), /locked|writable/)
  assert.equal(document.serialize(), protectedBefore)

  const full = await document.transact('full ellipse', transaction => transaction.createEntity('ELLIPSE', { center: [30, 0, 0], majorAxis: [8, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2 }))
  assert.equal(getEntityGrips(full).some(grip => grip.id.endsWith('parameter')), false)
})

test('edited elliptical arc endpoints survive KJD, DXF and independent ezdxf reopen', async t => {
  const { sdk, document, arc } = await fixture()
  await sdk.executeCommand('GRIPEDIT', { id: arc.id, gripId: 'start-parameter', point: pointAt(Math.PI / 4) }, { document })
  await sdk.executeCommand('GRIPEDIT', { id: arc.id, gripId: 'end-parameter', point: pointAt(Math.PI * 1.5) }, { document })
  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), kjdReopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  const kjdArc = kjdReopened.listEntities({ type: 'ELLIPSE' })[0]; close(kjdArc.payload.startParameter, Math.PI / 4); close(kjdArc.payload.endParameter, Math.PI * 1.5)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), dxfReopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const dxfArc = dxfReopened.listEntities({ type: 'ELLIPSE' })[0]; close(dxfArc.payload.startParameter, Math.PI / 4); close(dxfArc.payload.endParameter, Math.PI * 1.5)
  assert.equal(dxfReopened.validate().valid, true)
  const script = String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));items=list(d.modelspace().query('ELLIPSE'));assert len(items)==1
e=items[0];audit=d.audit();assert not audit.errors and not audit.fixes
print(json.dumps({'start':e.dxf.start_param,'end':e.dxf.end_param,'ratio':e.dxf.ratio,'auditErrors':len(audit.errors)}))
`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named 'ezdxf'/.test(result.stderr)) {
    if (process.env.KJDRAW_REQUIRE_DXF_INTEGRATION === '1') assert.fail(result.stderr || result.error.message)
    t.skip('ezdxf required'); return
  }
  assert.equal(result.status, 0, result.stderr)
  const audited = JSON.parse(result.stdout); close(audited.start, Math.PI / 4); close(audited.end, Math.PI * 1.5); close(audited.ratio, .5); assert.equal(audited.auditErrors, 0)
})
