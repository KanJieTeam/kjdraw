import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { projectDimension } from '../src/geometry/annotation.js'

const tool='cad_propose_drawing_annotated'
const empty=()=>({ expectedRevision:0,units:'millimeter',lines:[],circles:[],arcs:[],polylines:[],arrays:[],styles:[],texts:[],alignedDimensions:[],rotatedDimensions:[],radiusDimensions:[],diameterDimensions:[] })
const ref=(id,feature,vertexIndex)=>({source:'proposal',id,feature,...(vertexIndex===undefined?{}:{vertexIndex})})
const note=()=>({text:'MP-01 / 6061-T6 / REMOVE BURRS C0.2',position:{x:0,y:-20},height:2.5,rotationDegrees:0})
function fixture(){const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'});return{sdk,document,session:new KJAgentToolSession(sdk,document)}}
function value(result){assert.equal(result.ok,true,JSON.stringify(result));return result.value}
function drawing(){return{...empty(),circles:[[20,20,3.3]],polylines:[{points:[[0,0],[180,0],[180,100],[0,100]],closed:true}],texts:[note()],rotatedDimensions:[{from:ref('polylines:0','vertex',0),to:ref('polylines:0','vertex',1),position:{x:0,y:-10},height:2.5,rotationDegrees:0}],diameterDimensions:[{source:{source:'proposal',id:'circles:0'},directionDegrees:45,position:{x:35,y:35},height:2.5}]}}

test('annotated drawing previews kernel-measured native dimensions and commits as one editable undoable batch',async()=>{
 const {sdk,document,session}=fixture(),before=document.serialize(),input=drawing()
 const plan=value(await session.call(tool,input))
 assert.equal(document.serialize(),before)
 assert.deepEqual(plan.preview.after.map(e=>e.type),['CIRCLE','LWPOLYLINE','TEXT','DIMENSION','DIMENSION'])
 assert.deepEqual(plan.preview.after.filter(e=>e.type==='DIMENSION').map(e=>Number(projectDimension(e.payload).measurement.toFixed(6))),[180,6.6])
 value(await session.approve(plan.planId,'reviewer'))
 for(const expected of plan.preview.after)assert.deepEqual(document.getObject(expected.id).payload,expected.payload)
 for(const format of ['KJD','DXF']){
  const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format}),{format})
  const dimensions=reopened.listEntities().filter(e=>e.type==='DIMENSION')
  assert.equal(dimensions.length,2)
  assert.ok(Math.abs(projectDimension(dimensions.find(e=>e.payload.dimensionType==='ROTATED').payload).measurement-180)<1e-9)
  assert.ok(Math.abs(projectDimension(dimensions.find(e=>e.payload.dimensionType==='DIAMETER').payload).measurement-6.6)<1e-9)
  assert.equal(reopened.listEntities({ownerId:reopened.snapshot().spaces.modelSpaceId}).find(e=>e.type==='TEXT').payload.text,note().text)
 }
 await sdk.executeCommand('UNDO');assert.equal(document.listEntities().length,0)
 await sdk.executeCommand('REDO');assert.equal(document.listEntities().length,5)
})

test('annotations can reference existing geometry with no new geometry and cannot smuggle false measurements',async()=>{
 const {sdk,document,session}=fixture()
 await sdk.executeCommand('CREATEBATCH',{entities:[{type:'LINE',payload:{start:[0,0,0],end:[30,40,0]}}]})
 const id=document.listEntities()[0].id,input={...empty(),expectedRevision:document.revision,alignedDimensions:[{from:{source:'document',id,feature:'start'},to:{source:'document',id,feature:'end'},position:{x:0,y:50},height:2.5}]}
 const source=document.serialize(),plan=value(await session.call(tool,input))
 assert.equal(projectDimension(plan.preview.after[0].payload).measurement,50)
 assert.equal(document.serialize(),source)
 for(const key of ['textOverride','measurement']){
  const bad=structuredClone(input);bad.alignedDimensions[0][key]='999'
  assert.equal((await session.call(tool,bad)).ok,false)
 }
 value(await session.approve(plan.planId,'reviewer'))
 assert.equal(document.listEntities().length,2)
  assert.equal((await session.call(tool,input)).ok,false)
})

test('annotated drawings retain native elliptical arcs and style their array copies', async () => {
  const { document, session } = fixture()
  const input = {
    ...empty(), ellipses: [[10, 20, 8, 6, .4, 15, 300]],
    arrays: [{ sources: ['ellipses:0'], rows: 1, columns: 2, dx: 30, dy: 0 }],
    styles: [{ name: 'ELLIPSE-CENTERLINE', sources: ['ellipses:0'], pattern: [4, -1], color: 4, lineweight: 18 }],
    texts: [note()],
  }
  const proposal = value(await session.call(tool, input))
  assert.equal(document.revision, 0)
  assert.deepEqual(proposal.preview.after.map(item => item.type), ['ELLIPSE', 'ELLIPSE', 'TEXT'])
  assert.deepEqual(proposal.preview.after.filter(item => item.type === 'ELLIPSE').map(item => item.payload.center), [[10, 20, 0], [40, 20, 0]])
  value(await session.approve(proposal.planId, 'reviewer'))
  const ellipses = document.listEntities({ type: 'ELLIPSE' })
  assert.equal(ellipses.length, 2)
  assert.ok(ellipses.every(item => item.payload.layerId === ellipses[0].payload.layerId))
  const layer = document.getObject(ellipses[0].payload.layerId)
  assert.deepEqual(document.getObject(layer.payload.linetypeId).payload.pattern, [4, -1])
})

test('annotated drawings combine styled rational splines, arrays and notes in one approval', async () => {
  const { document, session } = fixture()
  const spline = { degree: 2, controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 12 }, { x: 20, y: 0 }], knots: [0, 0, 0, 1, 1, 1], weights: [1, 0.7, 1] }
  const proposal = value(await session.call(tool, {
    ...empty(), splines: [spline], texts: [note()],
    arrays: [{ sources: ['splines:0'], rows: 2, columns: 1, dx: 0, dy: 30 }],
    styles: [{ name: 'CAM-PROFILE', sources: ['splines:0'], pattern: [], color: 3, lineweight: 35 }],
  }))
  assert.deepEqual(proposal.preview.after.map(item => item.type), ['SPLINE', 'SPLINE', 'TEXT'])
  assert.deepEqual(proposal.preview.after.filter(item => item.type === 'SPLINE').map(item => item.payload.controlPoints[0]), [[0, 0, 0], [0, 30, 0]])
  value(await session.approve(proposal.planId, 'reviewer'))
  const curves = document.listEntities({ type: 'SPLINE' })
  assert.equal(curves.length, 2)
  assert.ok(curves.every(curve => curve.payload.layerId === curves[0].payload.layerId))
  assert.equal(document.getObject(curves[0].payload.layerId).payload.lineweight, 35)
})

test('annotated drawings combine editable hatch islands, styles and notes in one approval', async () => {
  const { document, session } = fixture()
  const hatches = [{ loops: [
    { vertices: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }] },
    { vertices: [{ x: 10, y: 5 }, { x: 20, y: 5 }, { x: 20, y: 15 }, { x: 10, y: 15 }] },
  ], patternName: 'CROSS', patternScale: 1.5, patternAngleDegrees: 15 }]
  const proposal = value(await session.call(tool, {
    ...empty(), hatches, texts: [note()],
    styles: [{ name: 'SECTION', sources: ['hatches:0'], pattern: [], color: 2, lineweight: 25 }],
  }))
  assert.deepEqual(proposal.preview.after.map(item => item.type), ['HATCH', 'TEXT'])
  assert.equal(proposal.preview.after[0].payload.boundaryLoops.length, 2)
  value(await session.approve(proposal.planId, 'reviewer'))
  const hatch = document.listEntities({ type: 'HATCH' })[0]
  assert.equal(hatch.payload.patternName, 'CROSS')
  assert.equal(document.getObject(hatch.payload.layerId).payload.lineweight, 25)
})

test('invalid references, degenerate projected dimensions and total annotation budgets leave the drawing unchanged',async()=>{
 const {document,session}=fixture(),source=document.serialize()
 const cases=[]
 let bad=drawing();bad.diameterDimensions[0].source.id='circles:1';cases.push(bad)
 bad=drawing();bad.rotatedDimensions[0].rotationDegrees=90;cases.push(bad)
 bad=drawing();bad.texts=Array.from({length:64},note);cases.push(bad)
 bad=drawing();bad.texts[0].text='bad\nmultiline';cases.push(bad)
 bad=empty();bad.texts=[note()];bad.arrays=[{sources:['circles:0'],rows:2,columns:2,dx:10,dy:10}];cases.push(bad)
 for(const item of cases){assert.equal((await session.call(tool,item)).ok,false,JSON.stringify(item));assert.equal(document.serialize(),source)}
})


test('reviewed engineering styles have stable resources and exact approval, undo and reopen semantics', async () => {
  const { referenceAnnotatedInput } = await import('../../../scripts/benchmarks/engineering-drawing-tasks.mjs')
  const { sdk, document, session } = fixture(), source = document.serialize()
  const plan = value(await session.call(tool, referenceAnnotatedInput()))
  assert.equal(document.serialize(),source)
  assert.equal(plan.preview.after.length,70)
  assert.equal(plan.preview.resources.length,8)
  value(await session.approve(plan.planId,'reviewer'))
  for(const resource of plan.preview.resources) assert.deepEqual(document.getObject(resource.id).payload,resource.payload)
  const hidden=document.getTable('layers').records.find(item=>item.name==='HIDDEN')
  assert.deepEqual(document.getObject(hidden.payload.linetypeId).payload.pattern,[3,-1])
  for(const format of ['KJD','DXF']){
    const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format}),{format})
    const layer=reopened.getTable('layers').records.find(item=>item.name==='HIDDEN')
    assert.deepEqual(reopened.getObject(layer.payload.linetypeId).payload.pattern,[3,-1])
    assert.equal(reopened.listEntities({ownerId:reopened.snapshot().spaces.modelSpaceId}).length,70)
  }
  await sdk.executeCommand('UNDO')
  assert.equal(document.listEntities().length,0)
  for(const resource of plan.preview.resources)assert.equal(document.getObject(resource.id),null)
  await sdk.executeCommand('REDO')
  assert.equal(document.listEntities().length,70)
  const bad=referenceAnnotatedInput('A',document.revision);bad.styles[0].lineweight=53
  assert.equal((await session.call(tool,bad)).ok,false)
})
