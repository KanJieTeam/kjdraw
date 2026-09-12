import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../src/sdk.js'
import { projectDimension, resolveDimensionAnnotationStyle } from '../src/geometry/annotation.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const definition = { dimensionType: 'ROTATED', definitionPoints: [[30, 22, 0], [30, 30, 0], [60, 30, 0]], textPosition: [45, 20, 0], rotation: 0 }
const projection = (document, entity) => projectDimension(entity.payload, document.getObject(entity.payload.styleId)?.payload ?? {})
const close = (a, b) => {
  if (typeof a === 'number') { assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`); return }
  if (a && typeof a === 'object') { assert.deepEqual(Object.keys(a), Object.keys(b)); for (const key of Object.keys(a)) close(a[key], b[key]); return }
  assert.equal(a, b)
}
const write = (sdk, document) => sdk.writeDocument(document, { format: 'DXF', version: '2018' })
const native = (t, dxf) => {
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import sys,io,json,ezdxf
D=ezdxf.read(io.StringIO(sys.stdin.read())); result=[]
for e in D.modelspace().query('DIMENSION'):
 o=e.override(); values={k:o.get(k) for k in ['dimscale','dimtxt','dimasz','dimexo','dimexe']}
 before=[x.dxf.height for x in e.virtual_entities() if x.dxftype()=='TEXT']
 o.render(); after=[x.dxf.char_height for x in e.virtual_entities() if x.dxftype()=='MTEXT']
 result.append({'values':values,'before':before,'after':after,'measurement':e.get_measurement()})
a=D.audit();print(json.dumps({'dimensions':result,'errors':len(a.errors),'fixes':len(a.fixes)}))
`], String(dxf), { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named 'ezdxf'/.test(result.stderr)) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(result.stderr || result.error.message)
    t.skip('ezdxf is required for independent native regeneration'); return null
  }
  assert.equal(result.status, 0, result.stderr)
  const observed = JSON.parse(result.stdout)
  assert.equal(observed.errors, 0); assert.equal(observed.fixes, 0)
  return observed
}

test('unbound, null, partial and scaled shared dimension styles preserve exact projection through native DXF', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const shared = await sdk.executeCommand('DIMSTYLE', { name: 'SCALED', properties: { overallScale: 2, textHeight: 1.5, arrowSize: .8, extensionOffset: .3, extensionBeyond: .6 } })
  const styleBefore = JSON.stringify(document.getObject(shared.id))
  const cases = [
    { textHeight: 2 },
    { styleId: null, textHeight: null },
    { styleId: shared.id, textHeight: 2 },
    { styleId: shared.id, textHeight: null },
    { styleId: shared.id, overallScale: 3, textHeight: 2, arrowSize: .4, extensionOffset: 0, extensionBeyond: .2 },
  ]
  const entities = []
  for (const payload of cases) entities.push(await sdk.executeCommand('CREATE', { type: 'DIMENSION', payload: { ...definition, ...payload } }))
  const before = entities.map(entity => projection(document, document.getObject(entity.id)))
  const serialized = document.serialize(), dxf = await write(sdk, document)
  assert.equal(document.serialize(), serialized)
  assert.equal(JSON.stringify(document.getObject(shared.id)), styleBefore)
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  reopened.listEntities({ type: 'DIMENSION' }).forEach((entity, i) => close(projection(reopened, entity), before[i]))
  assert.deepEqual(resolveDimensionAnnotationStyle(cases[0]), { overallScale: 1, textHeight: 2, arrowSize: 1.4, extensionOffset: .4, extensionBeyond: .7 })
  const observed = native(t, dxf); if (!observed) return
  const expected = [[1,2,1.4,.4,.7],[1,2.5,1.75,.5,.875],[2,2,.8,.3,.6],[2,1.5,.8,.3,.6],[3,2,.4,0,.2]]
  observed.dimensions.forEach((entity, i) => {
    close(Object.values(entity.values), expected[i]); close(entity.before, [before[i].label.height]); close(entity.after, [before[i].label.height]); assert.equal(entity.measurement, 30)
  })
})

test('each imported DSTYLE override edit regenerates native graphics instead of replaying stale raw tags, with one undo and redo', async t => {
  const original = createKJDrawSDK(), document = original.createDocument()
  await original.executeCommand('CREATE', { type: 'DIMENSION', payload: { ...definition, textHeight: 2 } })
  const source = await write(original, document)
  for (const [key, value] of [['overallScale',2], ['arrowSize',.75], ['extensionOffset',.1], ['extensionBeyond',.2]]) {
    const sdk = createKJDrawSDK(), reopened = await sdk.readDocument(source, { format: 'DXF' })
    sdk.setActiveDocument(reopened.id)
    const dimension = reopened.listEntities({ type: 'DIMENSION' })[0]
    const before = projection(reopened, dimension), sharedBefore = JSON.stringify(reopened.getObject(dimension.payload.styleId))
    await reopened.transact('Change native annotation override', tx => tx.updateObject(dimension.id, { payload: { [key]: value } }))
    const expected = projection(reopened, reopened.getObject(dimension.id))
    assert.notDeepEqual(expected, before)
    const edited = await write(sdk, reopened), again = await createKJDrawSDK().readDocument(edited, { format: 'DXF' })
    const updated = again.listEntities({ type: 'DIMENSION' })[0]
    assert.equal(updated.payload[key], value); close(projection(again, updated), expected)
    assert.equal(JSON.stringify(reopened.getObject(dimension.payload.styleId)), sharedBefore)
    await sdk.executeCommand('UNDO'); close(projection(reopened, reopened.getObject(dimension.id)), before)
    await sdk.executeCommand('REDO'); close(projection(reopened, reopened.getObject(dimension.id)), expected)
    const observed = native(t, edited); if (!observed) return
    close(observed.dimensions[0].before, [expected.label.height]); close(observed.dimensions[0].after, [expected.label.height])
    assert.equal(observed.dimensions[0].values[{overallScale:'dimscale',arrowSize:'dimasz',extensionOffset:'dimexo',extensionBeyond:'dimexe'}[key]], value)
  }
})

test('malformed and duplicate known native DSTYLE lengths are rejected', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  await sdk.executeCommand('CREATE', { type: 'DIMENSION', payload: { ...definition, textHeight: 2 } })
  const source = String(await write(sdk, document))
  for (const code of [40,41,42,44]) {
    const pattern = new RegExp(`1070\\r?\\n${code}\\r?\\n1040\\r?\\n([^\\r\\n]+)`)
    assert.ok(pattern.test(source))
    for (const replacement of [`1070\n${code}\n1040\nNaN`, `1070\n${code}\n1070\n1`, `1070\n${code}\n1040\n1\n1070\n${code}\n1040\n2`]) {
      await assert.rejects(createKJDrawSDK().readDocument(source.replace(pattern, replacement), { format: 'DXF' }), error => /override/.test(error.cause?.message ?? error.message))
    }
  }
})


test('external angular picture overshoot uses its original DSTYLE arrow size and overall scale, while contradictory sectors still fail', async t => {
  const generated = spawnSync(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import io,json,math,ezdxf
result=[]
for shared,arrow,scale,sweep in [(0.01,0.8,2,90),(8,0.01,0.5,90),(0.01,0.8,2,270)]:
 d=ezdxf.new('R2018');d.dimstyles.get('Standard').dxf.dimasz=shared
 o=d.modelspace().add_angular_dim_3p(base=(math.sqrt(200),math.sqrt(200)),center=(0,0),p1=(10,0),p2=(0,10),override={'dimasz':arrow,'dimscale':scale,'dimtxt':2})
 o.render();e=o.dimension;b=d.blocks[e.dxf.geometry]
 # A native picture may extend its arc slightly beyond the measured rays
 # for the arrow graphics. Keep a known 0.08-radian overshoot on both ends.
 b.delete_all_entities();b.add_arc((0,0),20,-math.degrees(.08),sweep+math.degrees(.08));b.add_text(str(sweep),dxfattribs={'height':2*scale,'insert':(15,15)})
 a=d.audit();assert not a.errors and not a.fixes
 out=io.StringIO();d.write(out);result.append(out.getvalue())
print(json.dumps(result))
`], { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (generated.error?.code === 'ENOENT' || /No module named 'ezdxf'/.test(generated.stderr)) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(generated.stderr || generated.error.message)
    t.skip('ezdxf required'); return
  }
  assert.equal(generated.status, 0, generated.stderr)
  for (const [index, source] of JSON.parse(generated.stdout).entries()) {
    const sdk = createKJDrawSDK(), document = await sdk.readDocument(source, { format: 'DXF' })
    const dimension = document.listEntities({ type: 'DIMENSION' })[0]
    assert.equal(dimension.payload.overallScale, index === 1 ? .5 : 2)
    assert.equal(dimension.payload.arrowSize, index === 1 ? .01 : .8)
    await write(sdk, document) // Untouched opaque pictures remain round-trippable.
    await sdk.executeCommand('MOVE', { ids: [dimension.id], dx: 1, dy: 2 })
    assert.notDeepEqual(document.getObject(dimension.id).payload.definitionPoints, dimension.payload.definitionPoints)
    if (index === 0) {
      const regenerated = await write(sdk, document)
      const observed = native(t, regenerated); if (!observed) return
      close(observed.dimensions[0].measurement, 90)
      assert.equal(observed.dimensions[0].values.dimscale, 2)
      assert.equal(observed.dimensions[0].values.dimasz, .8)
    } else {
      await assert.rejects(write(sdk, document), error => /original picture and definition sector/.test(error.cause?.message ?? error.message))
    }
  }
})
