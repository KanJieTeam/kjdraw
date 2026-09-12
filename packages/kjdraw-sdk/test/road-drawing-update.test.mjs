import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRoadDrawing } from '../src/road-drawing.js'
import { applyRoadDrawingRevision } from '../src/road-drawing-update.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { normalizeStandardEntityPayload } from '../src/standard-entities.js'

function input() {
  return { units:'meter', startStation:0, alignment:[[300,500],[900,500]], profile:[{station:0,elevation:10},{station:600,elevation:16}],
    sections:Array.from({length:7},(_,i)=>({station:i*100,ground:[[-30,8+i],[0,8+i],[30,8+i]]})),
    pavement:{leftWidth:4,rightWidth:4,leftCrossfall:-.02,rightCrossfall:-.02}, slopes:{cutHtoV:1,fillHtoV:1.5} }
}
const options = () => ({drawingId:'road-update',title:'600 m access route',profileScale:{horizontal:1,vertical:8},sectionScale:{horizontal:2,vertical:3}})
const find = (drawing,key) => drawing.entities.find(entity=>entity.key===key)
const payloads = drawing => Object.fromEntries(drawing.listEntities().map(entity=>[entity.id,{handle:entity.handle,ownerId:entity.ownerId,type:entity.type,payload:entity.payload}]))
async function fixture() {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'meter'}), source=input(), previous=buildRoadDrawing(source,options())
  await sdk.executeCommand('CREATEBATCH',{resources:previous.resources,entities:previous.entities})
  return {sdk,document,source,previous}
}

test('600 m road rebuild changes widths, elevations and quantities while preserving native identities in one undo', async()=>{
  const {sdk,document,source,previous}=await fixture()
  const before=payloads(document), resources=document.getTable('layers'), expectedRevision=document.revision
  source.pavement.leftWidth=5; source.profile[1].elevation=17
  const next=buildRoadDrawing(source,options()), receipt=await applyRoadDrawingRevision(document,previous,next,{expectedRevision})
  assert.equal(document.revision,expectedRevision+1)
  assert.equal(receipt.revision,document.revision); assert.equal(receipt.drawingId,'road-update')
  assert.ok(receipt.updatedIds.length>0); assert.ok(receipt.unchangedIds.length>0)
  assert.deepEqual(receipt.createdIds,[]); assert.deepEqual(receipt.removedIds,[])
  assert.deepEqual(Object.keys(payloads(document)),Object.keys(before))
  for(const entity of next.entities) {
    const actual=document.getObject(entity.options.id)
    assert.equal(actual.handle,before[actual.id].handle); assert.equal(actual.ownerId,before[actual.id].ownerId)
    const expectedPayload=entity.type==='TEXT'?{...entity.payload,styleId:document.getTable('textStyles').currentId}:entity.payload
    assert.deepEqual(actual.payload,normalizeStandardEntityPayload(entity.type,expectedPayload))
  }
  const edge=find(next,'plan/span/0/left-pavement-edge')
  assert.deepEqual(document.getObject(edge.options.id).payload.start,[300,505,0])
  assert.equal(document.getObject(find(next,'profile/station-table/row/600/cell/1').options.id).payload.text,'17.000')
  const volume=find(next,'profile/volume-table/row/total/cell/4')
  assert.equal(document.getObject(volume.options.id).payload.text,next.calculation.totalVolume.fill.toFixed(3))
  assert.notEqual(volume.payload.text,find(previous,volume.key).payload.text)
  assert.deepEqual(document.getTable('layers'),resources)
  const after=payloads(document)
  await sdk.executeCommand('UNDO'); assert.deepEqual(payloads(document),before)
  await sdk.executeCommand('REDO'); assert.deepEqual(payloads(document),after)
  for(const format of ['KJD','DXF']) {
    const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format}),{format})
    assert.equal(reopened.listEntities().length,next.entities.length)
    assert.ok(reopened.listEntities({type:'TEXT'}).some(entity=>entity.payload.text===volume.payload.text))
  }
})

test('removing and readding a station reconciles rows and geometry while preserving unrelated objects and resources', async()=>{
  const {sdk,document,source,previous}=await fixture()
  await sdk.executeCommand('CREATEBATCH',{resources:{linetypes:[],layers:[{id:'external-layer',name:'EXTERNAL',color:2,linetypeId:document.getTable('linetypes').currentId,lineweight:25}]},entities:[{type:'CIRCLE',payload:{center:[100,200,0],radius:3,layerId:'external-layer'},options:{id:'external-circle'}}]})
  const external=document.getObject('external-circle'), layer=document.getObject('external-layer'), before=payloads(document)
  source.sections=source.sections.filter(section=>section.station!==300)
  const next=buildRoadDrawing(source,options()), receipt=await applyRoadDrawingRevision(document,previous,next,{expectedRevision:document.revision})
  assert.ok(receipt.removedIds.includes(find(previous,'sections/station/300/design').options.id))
  assert.ok(receipt.createdIds.includes(find(next,'profile/volume-table/row/200-400/cell/0').options.id))
  for(const id of receipt.removedIds) assert.equal(document.getObject(id),null)
  assert.deepEqual(document.getObject('external-circle'),external); assert.deepEqual(document.getObject('external-layer'),layer)
  const after=payloads(document)
  await sdk.executeCommand('UNDO'); assert.deepEqual(payloads(document),before)
  await sdk.executeCommand('REDO'); assert.deepEqual(payloads(document),after)
  await applyRoadDrawingRevision(document,next,previous,{expectedRevision:document.revision})
  assert.deepEqual(new Set(document.listEntities().map(entity=>entity.id)),new Set(Object.keys(before)))
  assert.deepEqual(document.getObject('external-circle'),external)
})

test('manual geometry, metadata, layer protection, resource or owner edits are never overwritten', async()=>{
  const edits=[
    (tx,prev)=>tx.updateObject(find(prev,'plan/alignment').options.id,{payload:{vertices:[[300,500,0],[901,500,0]]}}),
    (tx,prev)=>tx.updateObject(find(prev,'plan/alignment').options.id,{extension:{xdata:{APP:[{code:1000,value:'user note'}]}}}),
    tx=>tx.updateObject('road:road-update:layer:DESIGN',{payload:{locked:true}}),
    tx=>tx.updateObject('road:road-update:layer:GROUND',{payload:{visible:false}}),
    tx=>tx.updateObject('road:road-update:layer:AXIS',{payload:{frozen:true}}),
    tx=>tx.updateObject('road:road-update:linetype:ground',{payload:{pattern:[4,-1],totalPatternLength:5}}),
    (tx,prev)=>{const block=tx.upsertTableRecord('blockRecords',{name:'USER-BLOCK',payload:{entityIds:[]}});tx.reparentObject(find(prev,'plan/alignment').options.id,block.id)},
  ]
  for(const edit of edits) {
    const {document,source,previous}=await fixture()
    await document.transact('manual user change',tx=>edit(tx,previous))
    source.pavement.leftWidth=5
    const before=document.serialize()
    await assert.rejects(applyRoadDrawingRevision(document,previous,buildRoadDrawing(source,options()),{expectedRevision:document.revision}),/was changed, removed or moved/)
    assert.equal(document.serialize(),before)
  }
})

test('wrong revisions, units, drawing identities and occupied new IDs reject atomically', async()=>{
  const {document,source,previous}=await fixture()
  source.sections=source.sections.filter(section=>section.station!==300)
  const next=buildRoadDrawing(source,options())
  let before=document.serialize()
  await assert.rejects(applyRoadDrawingRevision(document,previous,next,{expectedRevision:0}),/revision conflict/)
  await assert.rejects(applyRoadDrawingRevision(document,previous,buildRoadDrawing(source,{...options(),drawingId:'another'}),{expectedRevision:document.revision}),/drawingId must match/)
  assert.equal(document.serialize(),before)
  const collision=find(next,'profile/volume-table/row/200-400/cell/0').options.id
  await document.transact('unrelated occupied ID',tx=>tx.createEntity('POINT',{position:[0,0,0]},{id:collision}))
  before=document.serialize()
  await assert.rejects(applyRoadDrawingRevision(document,previous,next,{expectedRevision:document.revision}),/collides/)
  assert.equal(document.serialize(),before)
  await document.transact('user changed units',tx=>tx.setHeader('units','millimeter'))
  before=document.serialize()
  await assert.rejects(applyRoadDrawingRevision(document,previous,next,{expectedRevision:document.revision}),/units/)
  assert.equal(document.serialize(),before)
})

test('external references to removed road entities prevent orphaning while failure leaves every object intact', async()=>{
  const {document,source,previous}=await fixture(), removed=find(previous,'sections/station/300/design').options.id
  await document.transact('external reference',tx=>tx.createEntity('LEADER',{vertices:[[0,0,0],[1,1,0]],annotationId:removed},{id:'external-reference'}))
  source.sections=source.sections.filter(section=>section.station!==300)
  const before=document.serialize()
  await assert.rejects(applyRoadDrawingRevision(document,previous,buildRoadDrawing(source,options()),{expectedRevision:document.revision}),/another object refers/)
  assert.equal(document.serialize(),before)
})

test('invalid generated data and accessors are rejected before executing or changing the document', async()=>{
  const {document,previous}=await fixture(), before=document.serialize()
  const mutations=[
    next=>{next.entities[0].payload.layerId='outside'},
    next=>{next.entities[0].options.ownerId='outside'},
    next=>{next.entities[0].options.id='outside'},
    next=>{next.entities.push(next.entities[0])},
    next=>{next.entities[0].type='CIRCLE'},
    next=>{next.entities[0].payload.vertices[0][0]=Infinity},
    next=>{next.resources.layers[0].linetypeId='outside'},
    next=>{next.resources.linetypes[0].pattern=[1e12,-1]},
    next=>{next.entities[0].payload.code=()=>{throw new Error('executed')}},
  ]
  for(const mutate of mutations) {
    const next=structuredClone(previous); mutate(next)
    await assert.rejects(applyRoadDrawingRevision(document,previous,next,{expectedRevision:document.revision}))
    assert.equal(document.serialize(),before)
  }
  let invoked=0
  const next=structuredClone(previous)
  Object.defineProperty(next.entities[0],'payload',{enumerable:true,get(){invoked++;return {}}})
  await assert.rejects(applyRoadDrawingRevision(document,previous,next,{expectedRevision:document.revision}),/accessors/)
  assert.equal(invoked,0);assert.equal(document.serialize(),before)
})

test('a queued concurrent document edit invalidates the expected revision before applying any update', async()=>{
  const {document,source,previous}=await fixture(), revision=document.revision
  let release
  const gate=new Promise(resolve=>{release=resolve})
  const edit=document.transact('concurrent edit',async tx=>{await gate;tx.createEntity('POINT',{position:[1,2,0]},{id:'concurrent-point'})})
  source.pavement.leftWidth=5
  const update=applyRoadDrawingRevision(document,previous,buildRoadDrawing(source,options()),{expectedRevision:revision})
  release();await edit
  const before=document.serialize()
  await assert.rejects(update,/revision conflict/)
  assert.equal(document.serialize(),before)
})
