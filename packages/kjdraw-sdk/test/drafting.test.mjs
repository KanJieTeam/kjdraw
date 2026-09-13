import test from 'node:test'
import assert from 'node:assert/strict'
import { circleTangentToLines, circleTangentToReferences, constrainOrthogonalDraftPoint, constrainPolarDraftPoint, createDraftingSession, isDraftPointInput, parseDraftCoordinate, parseDraftPointInput } from '../src/drafting.js'
import { createKJDrawSDK } from '../src/index.js'
import { projectDimension } from '../src/geometry/annotation.js'

const closeTo=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`)

test('CAD coordinate parser accepts absolute, relative Cartesian and relative polar input',()=>{
  assert.deepEqual(parseDraftCoordinate('12.5, -3'),[12.5,-3])
  assert.deepEqual(parseDraftCoordinate('@2,3',[10,20]),[12,23])
  const polar=parseDraftCoordinate('@10<30',[1,2]);closeTo(polar[0],1+5*Math.sqrt(3));closeTo(polar[1],7)
  assert.throws(()=>parseDraftCoordinate('@1,2'),/relativeBase/)
  assert.throws(()=>parseDraftCoordinate('Infinity,0'),/finite/)
  assert.throws(()=>parseDraftCoordinate('@-2<45',[0,0]),/non-negative/)
})

test('direct distance and angle input shares exact drafting state and keeps invalid input retryable',()=>{
  assert.equal(isDraftPointInput('25'),true);assert.equal(isDraftPointInput('25<30'),true);assert.equal(isDraftPointInput('<90'),true);assert.equal(isDraftPointInput('FINISH'),false)
  assert.deepEqual(parseDraftPointInput('5',[0,0],[3,4]),[3,4])
  let point=parseDraftPointInput('10<30',[2,3]);closeTo(point[0],2+5*Math.sqrt(3));closeTo(point[1],8)
  point=parseDraftPointInput('<90',[1,2],[4,6]);closeTo(point[0],1);closeTo(point[1],7)
  assert.deepEqual(parseDraftPointInput('12,8',[99,99],[100,100]),[12,8])
  assert.deepEqual(parseDraftPointInput('@2,-3',[10,20],[100,100]),[12,17])
  assert.throws(()=>parseDraftPointInput('5',[0,0],[0,0]),/Move the pointer/)
  assert.throws(()=>parseDraftPointInput('<45',[0,0]),/pointer distance/)
  assert.throws(()=>parseDraftPointInput('-2<45',[0,0]),/non-negative/)

  const draft=createDraftingSession('polyline');draft.addInput('0,0')
  assert.throws(()=>draft.addInput('5',[0,0]),/Move the pointer/)
  assert.deepEqual(draft.state.points,[[0,0]])
  draft.addInput('10<0');draft.addInput('<90',[10,10]);assert.deepEqual(draft.state.points,[[0,0],[10,0],[10,10]])
  assert.deepEqual(draft.undoPoint(),[10,10]);assert.equal(draft.state.canFinish,true)
  draft.addInput('10<90');const result=draft.close();assert.equal(result.payload.closed,true);assert.deepEqual(result.payload.vertices.map(vertex=>vertex.point),[[0,0,0],[10,0,0],[10,10,0]])
})

test('orthogonal pointer constraint uses the dominant axis without changing explicit coordinate parsing', async () => {
  assert.deepEqual(constrainOrthogonalDraftPoint([14, 8], [2, 3]), [14, 3])
  assert.deepEqual(constrainOrthogonalDraftPoint([-1, 20], [2, 3]), [2, 20])
  assert.deepEqual(constrainOrthogonalDraftPoint([8, 9], [2, 3]), [8, 3])
  assert.throws(() => constrainOrthogonalDraftPoint([Infinity, 0], [0, 0]), /finite/)
  assert.deepEqual(parseDraftCoordinate('@6,4', [2, 3]), [8, 7])

  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'ortho-roundtrip', units: 'millimeter' })
  await sdk.executeCommand('ORTHO', { enabled: true }, { document: drawing })
  const bytes = await sdk.writeDocument(drawing, { format: 'KJD' })
  const reopened = await createKJDrawSDK().readDocument(bytes, { format: 'KJD' })
  assert.equal(reopened.snapshot().header.systemVariables.ORTHOMODE, 1)
  await drawing.undo()
  assert.equal(Number(drawing.snapshot().header.systemVariables.ORTHOMODE ?? 0), 0)
  await drawing.redo()
  assert.equal(drawing.snapshot().header.systemVariables.ORTHOMODE, 1)
})

test('polar tracking projects pointer input to the nearest configured ray and persists atomically', async () => {
  const tracked = constrainPolarDraftPoint([30, 20], [0, 0], 45)
  closeTo(tracked[0], 25); closeTo(tracked[1], 25)
  assert.deepEqual(constrainPolarDraftPoint([14, 8], [2, 3], 90), [14, 3])
  assert.deepEqual(constrainPolarDraftPoint([2, 3], [2, 3], 30), [2, 3])
  assert.throws(() => constrainPolarDraftPoint([1, 1], [0, 0], 0), /positive/)
  assert.throws(() => constrainPolarDraftPoint([1, 1], [0, 0], 181), /at most 180/)

  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'polar-roundtrip', units: 'millimeter' })
  await sdk.executeCommand('ORTHO', { enabled: true }, { document: drawing })
  const beforeInvalid = drawing.revision
  await assert.rejects(() => sdk.executeCommand('POLAR', { enabled: true, angleIncrement: 0 }, { document: drawing }), /greater than 0/)
  assert.equal(drawing.revision, beforeInvalid)
  await sdk.executeCommand('POLAR', { enabled: true, angleIncrement: 30 }, { document: drawing })
  assert.equal(drawing.snapshot().header.systemVariables.POLARMODE, 1)
  assert.equal(drawing.snapshot().header.systemVariables.POLARANG, 30)
  assert.equal(drawing.snapshot().header.systemVariables.ORTHOMODE, 0)
  const bytes = await sdk.writeDocument(drawing, { format: 'KJD' })
  const reopened = await createKJDrawSDK().readDocument(bytes, { format: 'KJD' })
  assert.equal(reopened.snapshot().header.systemVariables.POLARMODE, 1)
  assert.equal(reopened.snapshot().header.systemVariables.POLARANG, 30)
  await drawing.undo()
  assert.equal(Number(drawing.snapshot().header.systemVariables.POLARMODE ?? 0), 0)
  assert.equal(drawing.snapshot().header.systemVariables.ORTHOMODE, 1)
  await drawing.redo()
  assert.equal(drawing.snapshot().header.systemVariables.POLARMODE, 1)
  await sdk.executeCommand('ORTHO', { enabled: true }, { document: drawing })
  assert.equal(drawing.snapshot().header.systemVariables.POLARMODE, 0)
})

test('unbounded tools preview a finite direction guide until the second point is confirmed',()=>{
  for (const tool of ['xline','ray']) {
    const draft=createDraftingSession(tool)
    assert.equal(draft.preview(),null)
    assert.equal(draft.addPoint([20,30]),null)
    assert.equal(draft.preview([20,30]).type,'POINT')
    const preview=draft.preview([80,60])
    assert.deepEqual(preview,{type:'LINE',payload:{start:[20,30,0],end:[80,60,0]}})
    assert.deepEqual(draft.points,[[20,30]])
    assert.equal(draft.state.status,'collecting')
    assert.equal(draft.addPoint([80,60]).type,tool.toUpperCase())
    const cancelled=createDraftingSession(tool);cancelled.addPoint([0,0]);cancelled.cancel()
    assert.equal(cancelled.preview([50,60]),null)
  }
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

test('TTR circle solves one finite-segment tangent result selected by a solution point', async () => {
  const horizontal = { start: [-100, 0], end: [100, 0] }, vertical = { start: [0, -100], end: [0, 100] }
  const solved = circleTangentToLines(horizontal, vertical, 10, [20, 30])
  assert.deepEqual(solved.center, [10, 10]); assert.equal(solved.radius, 10)
  closeTo(solved.tangentPoints[0][0], 10); closeTo(solved.tangentPoints[0][1], 0)
  closeTo(solved.tangentPoints[1][0], 0); closeTo(solved.tangentPoints[1][1], 10)
  const draft = createDraftingSession('circle', { circleMode: 'tangent-tangent-radius', circleTangentLines: [horizontal, vertical], circleRadius: 10 })
  assert.equal(draft.state.nextPoint, 'solutionPoint'); assert.equal(draft.state.minimumPoints, 1); assert.equal(draft.state.maximumPoints, 1)
  const preview = draft.preview([-30, -25]); assert.deepEqual(preview.payload.center, [-10, -10, 0])
  const result = draft.addPoint([-30, -25]); assert.deepEqual(result, { type: 'CIRCLE', payload: { center: [-10, -10, 0], radius: 10 } })
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'ttr-roundtrip', units: 'millimeter' })
  await sdk.executeCommand('CREATE', result, { document: drawing })
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format }), { format })
    const circle = reopened.listEntities({ type: 'CIRCLE' })[0]
    assert.deepEqual(circle.payload.center, [-10,-10,0]); assert.equal(circle.payload.radius, 10)
  }
})

test('TTR circle solves line-circle, circle-circle and bounded arc references', () => {
  const line = { type: 'LINE', start: [-100, 0], end: [100, 0] }, circle = { type: 'CIRCLE', center: [0, 15], radius: 5 }
  let solved = circleTangentToReferences(line, circle, 5, [0, 5])
  closeTo(solved.center[0], 0); closeTo(solved.center[1], 5)
  closeTo(solved.tangentPoints[0][1], 0); closeTo(solved.tangentPoints[1][1], 10)

  solved = circleTangentToReferences({ type: 'CIRCLE', center: [-12, 0], radius: 4 }, { type: 'CIRCLE', center: [12, 0], radius: 4 }, 8, [0, 0])
  closeTo(solved.center[0], 0); closeTo(solved.center[1], 0); closeTo(solved.tangentPoints[0][0], -8); closeTo(solved.tangentPoints[1][0], 8)

  const upperArc = { type: 'ARC', center: [0, 15], radius: 5, startAngle: 0, endAngle: Math.PI }
  assert.throws(() => circleTangentToReferences(line, upperArc, 5, [0, 5]), /reference domains/)
  const lowerArc = { ...upperArc, startAngle: Math.PI, endAngle: Math.PI * 2 }
  solved = circleTangentToReferences(line, lowerArc, 5, [0, 5]); closeTo(solved.center[1], 5)

  const draft = createDraftingSession('circle', { circleMode: 'tangent-tangent-radius', circleTangentReferences: [line, circle], circleRadius: 5 })
  assert.deepEqual(draft.addPoint([0, 5])?.payload, { center: [0, 5, 0], radius: 5 })
})

test('TTR circle fails closed for parallel, segment-exterior, ambiguous and invalid inputs', () => {
  const horizontal = { start: [-100, 0], end: [100, 0] }, vertical = { start: [0, -100], end: [0, 100] }
  assert.throws(() => circleTangentToLines(horizontal, { start: [-100, 20], end: [100, 20] }, 5, [0, 0]), /parallel/)
  assert.throws(() => circleTangentToLines({ start: [0,0], end: [5,0] }, { start: [0,0], end: [0,5] }, 10, [10,10]), /finite line segments/)
  assert.throws(() => circleTangentToLines(horizontal, vertical, 10, [0, 0]), /ambiguous/)
  for (const options of [
    { circleMode: 'tangent-tangent-radius', circleTangentLines: [horizontal], circleRadius: 10 },
    { circleMode: 'tangent-tangent-radius', circleTangentLines: [horizontal, vertical], circleRadius: 0 },
    { circleMode: 'tangent-tangent-radius', circleTangentLines: [horizontal, vertical], circleRadius: 1e12 + 1 },
  ]) assert.throws(() => createDraftingSession('circle', options))
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

test('dimension drafts preserve referenced snap features through point ordering, undo and validation retry',()=>{
  const lineStart={entityId:'line-a',feature:'start'},lineEnd={entityId:'line-a',feature:'end'}
  for(const type of ['ALIGNED','ROTATED']){
    const draft=createDraftingSession('dimension',{dimensionType:type,rotation:0})
    draft.addPoint([0,0],lineStart);draft.addPoint([10,0],lineEnd)
    assert.deepEqual(draft.pointReferences,[lineStart,lineEnd])
    const spec=draft.addPoint([5,4],{entityId:'ignored-placement',feature:'center'})
    assert.deepEqual(spec.payload.dimensionAssociations,[
      {definitionPointIndex:1,...lineStart},{definitionPointIndex:2,...lineEnd},
    ])
  }

  const angular=createDraftingSession('dimension',{dimensionType:'ANGULAR_3_POINT'})
  angular.addPoint([0,0],lineStart);angular.addPoint([10,0],lineEnd)
  angular.addPoint([0,10],{entityId:'line-b',feature:'end'})
  assert.deepEqual(angular.undoPoint(),[0,10]);assert.deepEqual(angular.pointReferences,[lineStart,lineEnd])
  angular.addPoint([0,10],{entityId:'line-b',feature:'end'})
  assert.throws(()=>angular.addPoint([6,0],{entityId:'ignored-placement',feature:'center'}),/ambiguous/)
  assert.equal(angular.points.length,3);assert.equal(angular.pointReferences.length,3)
  const angularSpec=angular.addPoint([6,6])
  assert.deepEqual(angularSpec.payload.dimensionAssociations,[
    {definitionPointIndex:3,...lineStart},{definitionPointIndex:1,...lineEnd},
    {definitionPointIndex:2,entityId:'line-b',feature:'end'},
  ])

  const radius=createDraftingSession('dimension',{dimensionType:'RADIUS'})
  radius.addPoint([0,0],{entityId:'circle',feature:'center'})
  assert.deepEqual(radius.addPoint([5,0],{entityId:'circle',feature:'curve',angle:0}).payload.dimensionAssociations,[
    {definitionPointIndex:0,entityId:'circle',feature:'center'},
    {definitionPointIndex:1,entityId:'circle',feature:'curve',angle:0},
  ])
  const mismatched=createDraftingSession('dimension',{dimensionType:'DIAMETER'})
  mismatched.addPoint([-5,0],{entityId:'circle-a',feature:'curve',angle:Math.PI})
  assert.equal(mismatched.addPoint([5,0],{entityId:'circle-b',feature:'curve',angle:0}).payload.dimensionAssociations,undefined)
  const cancelled=createDraftingSession('dimension');cancelled.addPoint([0,0],lineStart);cancelled.cancel();assert.deepEqual(cancelled.pointReferences,[])
  assert.throws(()=>createDraftingSession('line').addPoint([0,0],lineStart),/only supported by dimensions/)
})

test('drafted associative dimensions update atomically and survive history plus KJD/DXF reopen',async()=>{
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'drafted-associations',units:'millimeter'})
  await drawing.transact('Sources',tx=>{
    tx.createEntity('LINE',{start:[0,0,0],end:[10,0,0]},{id:'line-source'})
    tx.createEntity('CIRCLE',{center:[20,0,0],radius:5},{id:'circle-source'})
  })
  const aligned=createDraftingSession('dimension',{dimensionType:'ALIGNED'})
  aligned.addPoint([0,0],{entityId:'line-source',feature:'start'})
  aligned.addPoint([10,0],{entityId:'line-source',feature:'end'})
  const alignedSpec=aligned.addPoint([5,4])
  const radius=createDraftingSession('dimension',{dimensionType:'RADIUS'})
  radius.addPoint([20,0],{entityId:'circle-source',feature:'center'})
  const radiusSpec=radius.addPoint([25,0],{entityId:'circle-source',feature:'curve',angle:0})
  const [linearDimension,radiusDimension]=await sdk.executeCommand('CREATEBATCH',{entities:[alignedSpec,radiusSpec]},{document:drawing})
  const identity=[linearDimension.id,linearDimension.handle]
  await sdk.executeCommand('LENGTHEN',{id:'line-source',totalLength:18,endpoint:'end'},{document:drawing})
  await sdk.executeCommand('PROPERTIES',{id:'circle-source',patch:{payload:{radius:8}}},{document:drawing})
  assert.equal(projectDimension(drawing.getObject(linearDimension.id).payload).measurement,18)
  assert.equal(projectDimension(drawing.getObject(radiusDimension.id).payload).measurement,8)
  assert.deepEqual([drawing.getObject(linearDimension.id).id,drawing.getObject(linearDimension.id).handle],identity)
  await sdk.executeCommand('UNDO',{}, {document:drawing});assert.equal(projectDimension(drawing.getObject(radiusDimension.id).payload).measurement,5)
  await sdk.executeCommand('REDO',{}, {document:drawing});assert.equal(projectDimension(drawing.getObject(radiusDimension.id).payload).measurement,8)
  for(const format of ['KJD','DXF']){
    const content=await sdk.writeDocument(drawing,{format}),copySdk=createKJDrawSDK(),copy=await copySdk.readDocument(content,{format})
    const dimensions=copy.listEntities({type:'DIMENSION'})
    assert.equal(dimensions.length,2);assert.ok(dimensions.every(entity=>Array.isArray(entity.payload.dimensionAssociations)))
    const reopenedLinear=dimensions.find(entity=>entity.payload.dimensionType==='ALIGNED')
    const sourceId=reopenedLinear.payload.dimensionAssociations.find(item=>item.feature==='end').entityId
    await copySdk.executeCommand('LENGTHEN',{id:sourceId,totalLength:24,endpoint:'end'},{document:copy})
    assert.equal(projectDimension(copy.getObject(reopenedLinear.id).payload).measurement,24)
  }
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
