import test from 'node:test'
import assert from 'node:assert/strict'
import { createDraftingSession } from '../src/drafting.js'
import { projectDimension } from '../src/geometry/annotation.js'
import { createKJDrawSDK } from '../src/sdk.js'
const begin=()=>createDraftingSession('dimension',{dimensionType:'ANGULAR_3_POINT',textHeight:1})

test('angular draft has four explicit roles and previews both sectors without accepting the cursor',()=>{
 const draft=begin();assert.equal(draft.state.minimumPoints,4);assert.equal(draft.state.maximumPoints,4)
 assert.equal(draft.state.nextPoint,'angleVertex');assert.equal(draft.addCoordinate('10,20'),null)
 assert.equal(draft.state.nextPoint,'firstRayPoint');assert.equal(draft.addCoordinate('@10,0'),null)
 assert.equal(draft.state.nextPoint,'secondRayPoint');assert.equal(draft.addCoordinate('@-10,10'),null)
 assert.equal(draft.state.nextPoint,'angularPlacement');assert.equal(draft.state.canFinish,false)
 const points=draft.points;assert.equal(projectDimension(draft.preview([16,26]).payload).measurement,90)
 assert.equal(projectDimension(draft.preview([4,14]).payload).measurement,270);assert.deepEqual(draft.points,points)
 const result=draft.addCoordinate('4,14');assert.equal(result.type,'DIMENSION');assert.equal(result.payload.dimensionType,'ANGULAR_3_POINT')
 assert.deepEqual(result.payload.definitionPoints,[[4,14,0],[20,20,0],[10,30,0],[10,20,0]])
 assert.equal(result.payload.measurement,270);assert.equal(draft.state.status,'complete');assert.equal(draft.state.nextPoint,null)
})

test('ray guides connect to the vertex and ambiguous placement remains editable without a false arc',()=>{
 const draft=begin();draft.addPoint([0,0]);draft.addPoint([10,0]);const guide=draft.preview([0,10])
 assert.equal(guide.type,'LWPOLYLINE');assert.deepEqual(guide.payload.vertices.map(v=>v.point),[[10,0,0],[0,0,0],[0,10,0]])
 assert.throws(()=>draft.addPoint([0,0]),/degenerate/);assert.equal(draft.points.length,2)
 draft.addPoint([0,10]);assert.throws(()=>draft.addPoint([6,0]),/ambiguous arc placement/);assert.equal(draft.points.length,3)
 assert.equal(draft.preview([6,0]).type,'LWPOLYLINE');assert.equal(draft.state.nextPoint,'angularPlacement')
 assert.deepEqual(draft.undoPoint(),[0,10]);draft.addCoordinate('@10<90',[0,0]);assert.equal(draft.addPoint([6,6]).payload.measurement,90)
})

test('angular cancellation and invalid input never mutate the document or complete a draft',()=>{
 const sdk=createKJDrawSDK(),document=sdk.createDocument(),before=document.serialize(),draft=begin()
 draft.addPoint([0,0]);assert.throws(()=>draft.addPoint([Infinity,0]),/finite/);draft.addPoint([10,0]);draft.addPoint([0,10])
 assert.throws(()=>draft.addPoint([0,0]),/degenerate/);draft.cancel();assert.equal(draft.state.status,'cancelled');assert.equal(draft.preview([6,6]),null);assert.equal(document.serialize(),before)
})

test('confirmed angular draft commits once, undo/redo retains stable identity, KJD and native DXF reopen exact sectors',async()=>{
 for(const location of [[6,6],[-6,-6]]){
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'}),draft=begin()
  draft.addPoint([0,0]);draft.addPoint([10,0]);draft.addPoint([0,10]);const before=document.revision
  const preview=draft.preview(location);assert.equal(document.revision,before);assert.equal(document.listEntities().length,0)
  const spec=draft.addPoint(location);assert.deepEqual(spec,preview);const entity=await sdk.executeCommand('CREATE',spec)
  assert.equal(document.revision,before+1);assert.equal(document.listEntities().length,1)
  await sdk.executeCommand('UNDO');assert.equal(document.listEntities().length,0);await sdk.executeCommand('REDO');assert.equal(document.listEntities()[0].id,entity.id)
  for(const format of ['KJD','DXF']){
   const serialized=await sdk.writeDocument(document,{format}),other=createKJDrawSDK(),reopened=await other.readDocument(serialized,{format})
   const actual=reopened.listEntities({ownerId:reopened.snapshot().spaces.modelSpaceId,type:'DIMENSION'})[0]
   assert.equal(actual.payload.dimensionType,'ANGULAR_3_POINT');assert.equal(projectDimension(actual.payload).measurement,projectDimension(spec.payload).measurement)
   assert.deepEqual(actual.payload.definitionPoints[0],spec.payload.definitionPoints[0]);assert.deepEqual(actual.payload.definitionPoints[3],spec.payload.definitionPoints[3]);assert.deepEqual(actual.payload.definitionPoints.slice(1,3).map(String).sort(),spec.payload.definitionPoints.slice(1,3).map(String).sort());assert.deepEqual(projectDimension(actual.payload).arcs,projectDimension(spec.payload).arcs)
   await other.executeCommand('MOVE',{ids:[actual.id],dx:2,dy:3});await other.writeDocument(reopened,{format:'DXF'})
  }
 }
})
