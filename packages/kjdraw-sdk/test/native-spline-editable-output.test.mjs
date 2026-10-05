import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { createKJDrawSDK } from '../src/index.js'

const tolerance = 1e-7
const clone = value => JSON.parse(JSON.stringify(value))
const domain = p => [p.knots[p.degree], p.knots[p.controlPoints.length]]
const cubic = knot => ({degree: 3, controlPoints: [[0,0,0],[1,2,0],[2,0,0],[3,2,0],[4,0,0]], knots: [0,0,0,0,knot,1,1,1,1], closed: false, periodic: false, color: 3, custom: {syntheticSource: 'editable-output'}})

// Independent recursive Cox basis, not the SDK evaluator or knot insertion.
function reference(p, u) {
  const end = domain(p)[1]
  const basis = (i, degree) => {
    if (degree === 0) return (p.knots[i] <= u && u < p.knots[i + 1]) || (u === end && i === p.controlPoints.length - 1) ? 1 : 0
    const a = p.knots[i + degree] - p.knots[i], b = p.knots[i + degree + 1] - p.knots[i + 1]
    return (a ? (u - p.knots[i]) / a * basis(i, degree - 1) : 0) + (b ? (p.knots[i + degree + 1] - u) / b * basis(i + 1, degree - 1) : 0)
  }
  let denominator = 0
  const numerator = [0,0,0]
  p.controlPoints.forEach((point, i) => {
    const weight = basis(i, p.degree) * (p.weights?.[i] ?? 1)
    denominator += weight
    point.forEach((value, axis) => numerator[axis] += value * weight)
  })
  assert.ok(denominator > 0)
  return numerator.map(value => value / denominator)
}
function geometry(p) { return {degree: p.degree, controlPoints: clone(p.controlPoints), knots: [...p.knots], ...(p.weights?.length ? {weights: [...p.weights]} : {}), closed: p.closed, periodic: p.periodic} }
function healthy(p) {
  assert.equal(p.closed, false); assert.equal(p.periodic, false)
  assert.equal(p.knots.length, p.controlPoints.length + p.degree + 1)
  const distinct = [...new Set(p.knots)]
  for (let i = 1; i < distinct.length; i++) assert.ok(distinct[i] - distinct[i - 1] > Number.EPSILON * Math.max(1, Math.abs(distinct[i]), Math.abs(distinct[i - 1])) * 128, 'A successful output has an unresolvable distinct knot span')
  p.controlPoints.flat().forEach(value => assert.ok(Number.isFinite(value)))
}
function compare(source, output) {
  healthy(output)
  assert.equal(output.degree, source.degree)
  const [a,b] = domain(output), samples = [...new Set([a, ...Array.from({length:17}, (_,i) => a + (b-a)*(i+1)/18), b, ...output.knots.filter(u => u >= a && u <= b)])]
  for (const u of samples) assert.ok(Math.hypot(...reference(source, u).map((value, axis) => value - reference(output, u)[axis])) <= tolerance)
}
async function fixture(payload, {opaque = false} = {}) {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({units:'millimeter'})
  let source, manual, vendor
  await drawing.transact('Synthetic native source and unrelated content', tx => {
    source = tx.createEntity('SPLINE', payload, {id:'native-source', source:{format:'synthetic', originalHandle:'FA1', retained:{author:'manual'}}, extension:{testOpaqueExtension:{values:[1,'keep',false]}}})
    manual = tx.createEntity('TEXT', {position:[8,3,0], text:'Synthetic manual note', height:1}, {id:'manual-note'})
    if (opaque) vendor = tx.createObject({id:'unrelated-vendor-record',kind:'custom',type:'SYNTHETIC_VENDOR_RECORD',ownerId:drawing.snapshot().namedObjectsDictionaryId,payload:{rawTags:[{code:1,value:'opaque value'},{code:90,value:'7'}],nested:{keep:[true,2,'raw']}},source:{format:'synthetic',retain:true}})
  })
  // Retain a genuine redo branch as part of failure atomicity.
  await drawing.transact('Synthetic redoable manual line', tx => tx.createEntity('LINE', {start:[8,0,0],end:[9,0,0]}, {id:'redo-manual-line'}))
  assert.equal(await drawing.undo(), true)
  assert.equal(drawing.history.redoCount, 1)
  return {sdk, drawing, source:drawing.getObject(source.id), manual:drawing.getObject(manual.id), vendor:vendor && drawing.getObject(vendor.id)}
}
async function atomicRefusal(context, command, args, pattern) {
  const {sdk,drawing} = context, snapshot = drawing.serialize(), revision = drawing.revision, history = clone(drawing.history)
  await assert.rejects(sdk.executeCommand(command, args, {document:drawing,expectedRevision:revision}), pattern)
  assert.equal(drawing.serialize(), snapshot, 'Refusal changed the full native/manual/opaque source snapshot')
  assert.equal(drawing.revision, revision); assert.deepEqual(drawing.history, history)
}
function preservation(context) {
  assert.deepEqual(context.drawing.getObject(context.manual.id), context.manual)
  const retained = context.drawing.getObject(context.source.id)
  for (const key of ['id','handle','ownerId','source','extension']) assert.deepEqual(retained[key], context.source[key])
  assert.deepEqual(retained.payload.custom, context.source.payload.custom)
}
async function diskReopenAndContinue(context, original) {
  const {sdk,drawing} = context, directory = await mkdtemp(join(tmpdir(),'kjdraw-editable-spline-'))
  try {
    for (const format of ['KJD','DXF']) {
      const bytes = await sdk.writeDocument(drawing, {format, ...(format === 'DXF' ? {version:'2018'} : {})}), path = join(directory,'native.'+format.toLowerCase())
      await writeFile(path, bytes)
      const fresh = createKJDrawSDK(), reopened = await fresh.readDocument(await readFile(path), {format}), pieces = reopened.listEntities({type:'SPLINE'})
      assert.ok(pieces.length > 0)
      if (format === 'KJD') assert.deepEqual(JSON.parse(reopened.serialize()), JSON.parse(drawing.serialize()))
      for (const piece of pieces) {
        compare(original, piece.payload)
        // Independent fresh disk read for every piece: no earlier cut changes
        // another target or selects an easier surviving subinterval.
        const childSdk = createKJDrawSDK(), child = await childSdk.readDocument(await readFile(path), {format}), [a,b] = domain(piece.payload), beforeCount = child.listEntities({type:'SPLINE'}).length
        const target = child.listEntities({type:'SPLINE'}).find(entity => entity.handle === piece.handle)
        assert.ok(target, 'Every saved native result handle must exist in the independently reopened document')
        assert.deepEqual(geometry(target.payload), geometry(piece.payload))
        const outputs = await childSdk.executeCommand('BREAK', {id:target.id,parameter:a+(b-a)/2,tolerance}, {document:child,expectedRevision:child.revision})
        assert.equal(outputs.length, 2); assert.equal(child.listEntities({type:'SPLINE'}).length, beforeCount + 1)
        outputs.forEach(output => compare(original, output.payload))
      }
    }
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    await rm(directory,{recursive:true,force:true})
  }
}

for (const [name,knot] of [['above by one ULP',.5+Number.EPSILON/2],['below by one ULP',.5-Number.EPSILON/4],['below by eight epsilon',.5-8*Number.EPSILON]]) {
  test(`explicit BREAK near an existing knot ${name} refuses atomically without snapping`, async () => {
    const context = await fixture(cubic(knot), {opaque:true})
    await atomicRefusal(context,'BREAK',{id:context.source.id,parameter:.5,tolerance}, /Native SPLINE edit: knot spans cannot be resolved reliably/)
    // A silently snapped command would have succeeded and changed the source.
    assert.deepEqual(context.drawing.getObject(context.source.id).payload.knots, cubic(knot).knots)
  })
}
for (const knot of [.5+Number.EPSILON/2,.5-Number.EPSILON/4]) {
  test(`the exact existing knot ${knot} produces healthy native disk-reopened editable pieces`, async () => {
    const context = await fixture(cubic(knot)), before = context.drawing.serialize(), count = context.drawing.history.undoCount
    await context.sdk.executeCommand('BREAK',{id:context.source.id,parameter:knot,tolerance},{document:context.drawing})
    assert.deepEqual(context.drawing.listEntities({type:'SPLINE'}).map(p=>domain(p.payload)).sort((a,b)=>a[0]-b[0]), [[0,knot],[knot,1]])
    assert.equal(context.drawing.history.undoCount,count+1); preservation(context)
    const after = context.drawing.serialize()
    await context.drawing.undo(); assert.deepEqual(JSON.parse(context.drawing.serialize()).objects, JSON.parse(before).objects)
    await context.drawing.redo(); assert.deepEqual(JSON.parse(context.drawing.serialize()).objects, JSON.parse(after).objects)
    await diskReopenAndContinue(context,cubic(knot))
  })
}
test('BREAK rejects a new tolerance-sized Bezier subspan even when all distinct knot gaps exceed 128 ULP', async () => {
  for (const cut of [.5-1e-9,.5+1e-9]) {
    assert.ok(Math.abs(cut-.5)>Number.EPSILON*128)
    const context = await fixture(cubic(.5),{opaque:true})
    await atomicRefusal(context,'BREAK',{id:context.source.id,parameter:cut,tolerance}, /Native SPLINE edit: constant or tolerance-sized knot spans are not reliable edit targets/)
  }
})
test('healthy two-cut BREAK preserves native geometry and every saved result can be cut again at the same tolerance', async () => {
  const context = await fixture(cubic(.5))
  await context.sdk.executeCommand('BREAK',{id:context.source.id,parameters:[.2,.8],tolerance},{document:context.drawing})
  assert.deepEqual(context.drawing.listEntities({type:'SPLINE'}).map(p=>domain(p.payload)).sort((a,b)=>a[0]-b[0]),[[0,.2],[.8,1]])
  preservation(context); await diskReopenAndContinue(context,cubic(.5))
})
test('TRIM near a native knot rejects an on-boundary pick atomically, retaining source, cutters and redo', async () => {
  for (const knot of [.5+Number.EPSILON/2,.5-Number.EPSILON/4]) {
    const context = await fixture(cubic(knot),{opaque:true}); let cutter
    await context.drawing.transact('Synthetic boundary',tx=>{cutter=tx.createEntity('XLINE',{origin:[reference(cubic(knot),.5)[0],0,0],direction:[0,1,0]})})
    await atomicRefusal(context,'TRIM',{id:context.source.id,boundaryIds:[cutter.id],pickPoint:reference(cubic(knot),.5),pickParameter:.5,tolerance}, /pick lies on a cutting boundary/)
  }
})
test('TRIM may certify a near-boundary curve point at its original native knot and keeps editable outputs', async () => {
  for (const knot of [.5+Number.EPSILON/2,.5-Number.EPSILON/4]) {
    const source = cubic(knot), context = await fixture(source); let cutter
    await context.drawing.transact('Synthetic boundary',tx=>{cutter=tx.createEntity('XLINE',{origin:[reference(source,.5)[0],0,0],direction:[0,1,0]})})
    const pick = knot>.5?.25:.75, beforeCutter = clone(context.drawing.getObject(cutter.id))
    await context.sdk.executeCommand('TRIM',{id:context.source.id,boundaryIds:[cutter.id],pickPoint:reference(source,pick),pickParameter:pick,tolerance},{document:context.drawing})
    assert.deepEqual(domain(context.drawing.getObject(context.source.id).payload),knot>.5?[knot,1]:[0,knot])
    assert.deepEqual(context.drawing.getObject(cutter.id),beforeCutter)
    preservation(context); await diskReopenAndContinue(context,source)
  }
})
test('healthy two-boundary TRIM retains both native outside intervals and each disk-reopened result remains editable', async () => {
  const source={degree:2,controlPoints:[[0,0,0],[5,10,0],[10,0,0]],knots:[0,0,0,1,1,1],closed:false,periodic:false},context=await fixture(source);let cutters
  await context.drawing.transact('Synthetic transverse cutters',tx=>{cutters=[3,7].map(x=>tx.createEntity('LINE',{start:[x,-20,0],end:[x,20,0]}))})
  const beforeCutters=cutters.map(c=>clone(context.drawing.getObject(c.id)))
  await context.sdk.executeCommand('TRIM',{id:context.source.id,boundaryIds:cutters.map(c=>c.id),pickPoint:[5,5,0],pickParameter:.5,tolerance},{document:context.drawing})
  const intervals=context.drawing.listEntities({type:'SPLINE'}).map(p=>domain(p.payload)).sort((a,b)=>a[0]-b[0])
  assert.equal(intervals.length,2);assert.equal(intervals[0][0],0);assert.equal(intervals[1][1],1)
  assert.ok(Math.abs(intervals[0][1]-.3)<=1e-7&&Math.abs(intervals[1][0]-.7)<=1e-7)
  cutters.forEach((c,i)=>assert.deepEqual(context.drawing.getObject(c.id),beforeCutters[i]))
  preservation(context);await diskReopenAndContinue(context,source)
})
test('independent ezdxf checks native rational outputs, raw knots and weights with no audit repair', async () => {
  const source={degree:2,controlPoints:[[5,0,0],[5,5,0],[0,5,0]],weights:[1,Math.SQRT1_2,1],knots:[0,0,0,1,1,1],closed:false,periodic:false},context=await fixture(source)
  await context.sdk.executeCommand('BREAK',{id:context.source.id,parameters:[.25,.75],tolerance},{document:context.drawing})
  const expected=context.drawing.listEntities({type:'SPLINE'}).map(p=>({handle:p.handle,...geometry(p.payload)})),dxf=await context.sdk.writeDocument(context.drawing,{format:'DXF',version:'2018'}),python=process.env.KJDRAW_PYTHON
  assert.ok(python,'KJDRAW_PYTHON with ezdxf is mandatory; this regression must not skip')
  const result=spawnSyncWithFileStdin(python,['-c',`import io,json,os,ezdxf
from ezdxf.math import BSpline
d=ezdxf.readfile(os.environ['KJDRAW_FILE_STDIN_PATH'])
expected=json.loads(os.environ['KJDRAW_NATIVE_EXPECTED'])
rows=[]
for s in expected:
 e=d.entitydb[s['handle']]
 assert e.dxftype()=='SPLINE' and e.dxf.degree==s['degree'] and (e.dxf.flags & 3)==0
 assert list(e.knots)==s['knots'] and list(e.weights)==s.get('weights',[]) and [list(p) for p in e.control_points]==s['controlPoints']
 raw=list(e.knots);c=BSpline(e.control_points,order=e.dxf.degree+1,knots=raw,weights=list(e.weights) or None)
 a=raw[e.dxf.degree];b=raw[len(e.control_points)]
 constructed=list(c.knots());ca=constructed[e.dxf.degree];cb=constructed[len(e.control_points)]
 points=[]
 for i in range(19):
  u=a+(b-a)*i/18
  mapped=ca+(u-a)/(b-a)*(cb-ca)
  points.append([u,list(c.point(mapped))])
 rows.append({'handle':e.dxf.handle,'points':points})
a=d.audit();assert len(a.errors)==len(a.fixes)==0
print(json.dumps({'version':ezdxf.__version__,'errors':len(a.errors),'fixes':len(a.fixes),'rows':rows}))`],dxf,{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8',KJDRAW_NATIVE_EXPECTED:JSON.stringify(expected)}})
  assert.equal(result.status,0,result.stderr||result.stdout)
  const oracle=JSON.parse(result.stdout);assert.equal(oracle.rows.length,2);assert.equal(oracle.errors,0);assert.equal(oracle.fixes,0)
  for(const row of oracle.rows)for(const [u,point]of row.points)assert.ok(Math.hypot(...reference(source,u).map((value,i)=>value-point[i]))<=tolerance)
  await diskReopenAndContinue(context,source)
})
