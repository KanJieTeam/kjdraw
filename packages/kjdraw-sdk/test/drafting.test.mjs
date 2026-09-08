import test from 'node:test'
import assert from 'node:assert/strict'
import { createDraftingSession, parseDraftCoordinate } from '../src/drafting.js'
import { createKJDrawSDK } from '../src/index.js'

const closeTo=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`)

test('CAD coordinate parser accepts absolute, relative Cartesian and relative polar input',()=>{
  assert.deepEqual(parseDraftCoordinate('12.5, -3'),[12.5,-3])
  assert.deepEqual(parseDraftCoordinate('@2,3',[10,20]),[12,23])
  const polar=parseDraftCoordinate('@10<30',[1,2]);closeTo(polar[0],1+5*Math.sqrt(3));closeTo(polar[1],7)
  assert.throws(()=>parseDraftCoordinate('@1,2'),/relativeBase/)
  assert.throws(()=>parseDraftCoordinate('Infinity,0'),/finite/)
  assert.throws(()=>parseDraftCoordinate('@-2<45',[0,0]),/non-negative/)
})

test('fixed point tools create native CREATE-ready entity specifications',()=>{
  const line=createDraftingSession('line',{payload:{layerId:'layer-a'}})
  assert.equal(line.state.nextPoint,'start');assert.equal(line.addPoint([0,0]),null);assert.equal(line.state.nextPoint,'end')
  assert.deepEqual(line.addCoordinate('@3,4'),{type:'LINE',payload:{layerId:'layer-a',start:[0,0,0],end:[3,4,0]}})

  const circle2=createDraftingSession('circle',{circleMode:'2-point'});circle2.addPoint([0,0]);const diameter=circle2.addPoint([10,0])
  assert.deepEqual(diameter?.payload.center,[5,0,0]);assert.equal(diameter?.payload.radius,5)
  const circle3=createDraftingSession('circle',{circleMode:'3-point'});circle3.addPoint([1,0]);circle3.addPoint([0,1]);const through=circle3.addPoint([-1,0])
  closeTo(through?.payload.center[0],0);closeTo(through?.payload.center[1],0);closeTo(through?.payload.radius,1)

  const arc=createDraftingSession('arc',{arcMode:'3-point'});arc.addPoint([1,0]);arc.addPoint([0,-1]);const arcSpec=arc.addPoint([-1,0])
  assert.equal(arcSpec?.type,'ARC');closeTo(arcSpec?.payload.radius,1)
  const centerArc=createDraftingSession('arc');centerArc.addPoint([0,0]);centerArc.addPoint([2,0]);assert.equal(centerArc.addPoint([0,2])?.payload.radius,2)

  const ellipse=createDraftingSession('ellipse');ellipse.addPoint([0,0]);ellipse.addPoint([4,0]);const ellipseSpec=ellipse.addPoint([0,2])
  assert.deepEqual(ellipseSpec?.payload.majorAxis,[4,0,0]);assert.equal(ellipseSpec?.payload.ratio,.5)
  const rectangle=createDraftingSession('rectangle');rectangle.addPoint([0,0]);const rectangleSpec=rectangle.addPoint([5,3])
  assert.equal(rectangleSpec?.type,'LWPOLYLINE');assert.equal(rectangleSpec?.payload.closed,true);assert.equal(rectangleSpec?.payload.vertices.length,4)
  const polygon=createDraftingSession('polygon',{sides:5});polygon.addPoint([0,0]);const polygonSpec=polygon.addPoint([2,0])
  assert.equal(polygonSpec?.payload.vertices.length,5);assert.equal(polygonSpec?.payload.closed,true)

  for(const [tool,type] of [['point','POINT'],['ray','RAY'],['xline','XLINE']]){
    const draft=createDraftingSession(tool),spec=tool==='point'?draft.addPoint([2,3]):(draft.addPoint([2,3]),draft.addPoint([5,7]))
    assert.equal(spec?.type,type)
  }
})

test('variable drafts preview, undo, finish, close and cancel without hidden mutation',()=>{
  const polyline=createDraftingSession('polyline')
  polyline.addPoint([0,0]);polyline.addPoint([4,0]);polyline.addPoint([4,3]);assert.equal(polyline.state.canClose,true)
  assert.deepEqual(polyline.undoPoint(),[4,3]);assert.equal(polyline.state.canClose,false);polyline.addPoint([4,3])
  const preview=polyline.preview([0,3]);assert.equal(preview?.type,'LWPOLYLINE');assert.equal(preview?.payload.closed,false);assert.equal(preview?.payload.vertices.length,4)
  const closed=polyline.close();assert.equal(closed.payload.closed,true);assert.equal(closed.payload.vertices.length,3);assert.equal(polyline.state.status,'complete')

  const spline=createDraftingSession('spline',{splineDegree:3})
  for(const point of [[0,0],[2,3],[4,3],[6,0]])spline.addPoint(point)
  const splineSpec=spline.finish();assert.equal(splineSpec.type,'SPLINE');assert.deepEqual(splineSpec.payload.knots,[0,0,0,0,1,1,1,1]);assert.equal(splineSpec.payload.periodic,false)

  const cancelled=createDraftingSession('polyline');cancelled.addPoint([0,0]);cancelled.cancel();assert.equal(cancelled.state.status,'cancelled');assert.equal(cancelled.preview([1,1]),null);assert.throws(()=>cancelled.addPoint([1,1]),/cancelled/)
})

test('hatch and dimension drafts emit native payload contracts',()=>{
  const hatch=createDraftingSession('hatch',{patternName:'ANSI31',patternScale:2,patternAngle:Math.PI/4})
  hatch.addPoint([0,0]);hatch.addPoint([8,0]);hatch.addPoint([8,5]);hatch.addPoint([0,5]);const hatchSpec=hatch.finish()
  assert.equal(hatchSpec.type,'HATCH');assert.equal(hatchSpec.payload.solid,false);assert.equal(hatchSpec.payload.patternName,'ANSI31');assert.equal(hatchSpec.payload.boundaryLoops[0].vertices.length,4)

  const aligned=createDraftingSession('dimension',{dimensionType:'ALIGNED',textHeight:2.5});aligned.addPoint([0,0]);aligned.addPoint([3,4]);const alignedSpec=aligned.addPoint([1,6])
  assert.deepEqual(alignedSpec?.payload.definitionPoints,[[1,6,0],[0,0,0],[3,4,0]]);assert.equal(alignedSpec?.payload.measurement,5);assert.equal(alignedSpec?.payload.textHeight,2.5)
  const rotated=createDraftingSession('dimension',{dimensionType:'ROTATED',rotation:0});rotated.addPoint([1,1]);rotated.addPoint([6,4]);const rotatedSpec=rotated.addPoint([2,7])
  assert.equal(rotatedSpec?.payload.measurement,5);assert.equal(rotatedSpec?.payload.rotation,0)
  const radius=createDraftingSession('dimension',{dimensionType:'RADIUS'});radius.addPoint([0,0]);const radiusSpec=radius.addPoint([0,3])
  assert.deepEqual(radiusSpec?.payload.definitionPoints,[[0,0,0],[0,3,0]]);assert.equal(radiusSpec?.payload.measurement,3)
  const diameter=createDraftingSession('dimension',{dimensionType:'DIAMETER'});diameter.addPoint([-2,0]);const diameterSpec=diameter.addPoint([2,0])
  assert.deepEqual(diameterSpec?.payload.definitionPoints,[[-2,0,0],[2,0,0]]);assert.equal(diameterSpec?.payload.measurement,4)
})

test('draft validation rejects non-finite and degenerate construction geometry',()=>{
  assert.throws(()=>createDraftingSession('polygon',{sides:2}),/3 to 1024/)
  assert.throws(()=>createDraftingSession('line').addPoint([NaN,0]),/finite/)
  const line=createDraftingSession('line');line.addPoint([1,1]);assert.throws(()=>line.addPoint([1,1]),/distinct/)
  const circle=createDraftingSession('circle',{circleMode:'3-point'});circle.addPoint([0,0]);circle.addPoint([1,0]);assert.throws(()=>circle.addPoint([2,0]),/collinear/);assert.equal(circle.points.length,2);assert.equal(circle.addPoint([0,1])?.type,'CIRCLE')
  const rectangle=createDraftingSession('rectangle');rectangle.addPoint([0,0]);assert.throws(()=>rectangle.addPoint([0,5]),/degenerate/)
  const hatch=createDraftingSession('hatch');hatch.addPoint([0,0]);hatch.addPoint([1,0]);hatch.addPoint([2,0]);assert.throws(()=>hatch.finish(),/degenerate/)
})

test('every drafting result is accepted by CREATE and survives a KJD round trip',async()=>{
  const drafts=[]
  const add=(tool,options,points,close=false)=>{const draft=createDraftingSession(tool,options);let result=null;for(const point of points)result=draft.addPoint(point)??result;drafts.push(result??(close?draft.close():draft.finish()))}
  add('line',{},[[0,0],[5,0]]);add('polyline',{},[[0,1],[3,1],[3,3]],true);add('circle',{circleMode:'center-radius'},[[8,2],[10,2]])
  add('arc',{arcMode:'3-point'},[[12,0],[14,2],[16,0]]);add('ellipse',{},[[20,2],[24,2],[20,4]]);add('rectangle',{},[[0,6],[5,10]])
  add('polygon',{sides:6},[[10,8],[12,8]]);add('point',{},[[16,8]]);add('ray',{},[[20,8],[22,9]]);add('xline',{},[[25,8],[25,10]])
  add('spline',{splineDegree:3},[[0,14],[3,17],[6,11],[9,14]]);add('hatch',{patternName:'SOLID'},[[12,12],[17,12],[17,16],[12,16]],true)
  add('dimension',{dimensionType:'ALIGNED'},[[20,12],[26,12],[23,15]])
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'drafting-roundtrip',units:'millimeter'})
  for(const spec of drafts)await sdk.executeCommand('CREATE',spec,{document:drawing})
  assert.equal(drawing.listEntities().length,drafts.length)
  const serialized=await sdk.writeDocument(drawing,{format:'KJD'}),copy=await sdk.readDocument(serialized,{format:'KJD',documentId:'drafting-roundtrip-copy'})
  assert.deepEqual(copy.listEntities().map(entity=>entity.type).sort(),drafts.map(spec=>spec.type).sort())
})
