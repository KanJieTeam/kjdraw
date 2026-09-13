import assert from 'node:assert/strict'
import test from 'node:test'
import { createDXFFileAdapter } from '../src/dxf-adapter.js'
import { KJDocument } from '../src/document.js'
import { createKJDrawSDK } from '../src/sdk.js'

function entityTags(source,type){
  const rows=String(source).trim().split(/\r?\n/),tags=[]
  for(let index=0;index+1<rows.length;index+=2)tags.push({code:Number(rows[index].trim()),value:rows[index+1].trim()})
  const start=tags.findIndex((tag,index)=>tag.code===0&&tag.value===type&&tags[index+1]?.code===5)
  assert.notEqual(start,-1,`${type} entity is missing`)
  const end=tags.findIndex((tag,index)=>index>start&&tag.code===0)
  return tags.slice(start,end<0?undefined:end)
}

function values(tags,code){return tags.filter(tag=>tag.code===code).map(tag=>Number(tag.value))}
function closeTo(actual,expected,tolerance=1e-9){assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`)}

async function nativeHatch(patternName,{patternAngle=0,patternScale=1}={}){
  const adapter=createDXFFileAdapter(),drawing=KJDocument.create({documentId:`hatch-${patternName.toLowerCase()}`,units:'millimeter'})
  await drawing.transact('Create native hatch',transaction=>transaction.createEntity('HATCH',{
    patternName,patternAngle,patternScale,solid:patternName==='SOLID',
    boundaryLoops:[
      {external:true,vertices:[[0,0],[20,0],[20,20],[0,20]],closed:true},
      {external:false,vertices:[[5,5],[5,15],[15,15],[15,5]],closed:true},
    ],
  }))
  const artifact=await adapter.write(drawing,{version:'2018'})
  return {adapter,drawing,artifact,tags:entityTags(artifact,'HATCH')}
}

test('ANSI31 exports one transformed ISO pattern line with complete DXF tags',async()=>{
  const patternAngle=Math.PI/6,patternScale=2,{tags}=await nativeHatch('ANSI31',{patternAngle,patternScale})
  assert.deepEqual(values(tags,78),[1]);assert.deepEqual(values(tags,79),[0]);assert.deepEqual(values(tags,53),[75])
  assert.deepEqual(values(tags,43),[0]);assert.deepEqual(values(tags,44),[0]);closeTo(values(tags,52)[0],30);assert.deepEqual(values(tags,41),[2])
  const spacing=3.175*patternScale,angle=75*Math.PI/180
  closeTo(values(tags,45)[0],-Math.sin(angle)*spacing);closeTo(values(tags,46)[0],Math.cos(angle)*spacing)
})

test('ANSI37 exports crossed 45/135-degree families and SOLID emits no pattern definitions',async()=>{
  const crossed=await nativeHatch('ANSI37')
  assert.deepEqual(values(crossed.tags,78),[2]);assert.deepEqual(values(crossed.tags,53),[45,135]);assert.deepEqual(values(crossed.tags,79),[0,0])
  assert.equal(values(crossed.tags,45).length,2);assert.equal(values(crossed.tags,46).length,2)
  const solid=await nativeHatch('SOLID')
  assert.deepEqual(values(solid.tags,70),[1]);assert.deepEqual(values(solid.tags,78),[]);assert.deepEqual(values(solid.tags,53),[])
})

test('omitting hatch pattern settings creates a real SOLID hatch that exports and reopens',async()=>{
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'default-solid-hatch'})
  await drawing.transact('Create default hatch',tx=>tx.createEntity('HATCH',{boundaryLoops:[{vertices:[[0,0],[8,0],[8,6],[0,6]]}]},{id:'default-solid'}))
  const hatch=drawing.getObject('default-solid')
  assert.equal(hatch.payload.patternName,'SOLID');assert.equal(hatch.payload.solid,true)
  const source=await sdk.writeDocument(drawing,{format:'DXF',version:'2018'}),tags=entityTags(source,'HATCH')
  assert.deepEqual(values(tags,70),[1]);assert.deepEqual(values(tags,78),[])
  const reopened=await createKJDrawSDK().readDocument(source,{format:'DXF'}),restored=reopened.listEntities({type:'HATCH'})[0]
  assert.equal(restored.payload.patternName,'SOLID');assert.equal(restored.payload.solid,true)
})

test('ambiguous and empty hatch loop representations reject before creating geometry',async()=>{
  const drawing=KJDocument.create({documentId:'invalid-hatch-loop'}),before=drawing.serialize()
  for(const loop of [
    {vertices:[[0,0],[8,0],[0,6]],edges:[{type:'LINE',start:[0,0],end:[8,0]}]},
    {vertices:[],edges:[]},
    {},
  ]){
    await assert.rejects(drawing.transact('Invalid hatch',tx=>tx.createEntity('HATCH',{boundaryLoops:[loop]})),/exactly one non-empty vertices or edges boundary/)
    assert.equal(drawing.serialize(),before)
  }
})

test('native pattern export reopens with pattern settings and outer/hole boundary roles intact',async()=>{
  const {adapter,artifact}=await nativeHatch('ANSI31',{patternAngle:-Math.PI/8,patternScale:1.5})
  const reopened=await adapter.read(artifact),hatch=reopened.listEntities({type:'HATCH'})[0]
  assert.equal(hatch.payload.patternName,'ANSI31');assert.equal(hatch.payload.solid,false);closeTo(hatch.payload.patternAngle,-Math.PI/8);assert.equal(hatch.payload.patternScale,1.5)
  assert.deepEqual(hatch.payload.boundaryLoops.map(loop=>loop.external),[true,false])
  assert.deepEqual(hatch.payload.boundaryLoops.map(loop=>loop.vertices.length),[4,4])
  assert.equal(hatch.payload.rawTags.filter(tag=>tag.code===53).length,1)
  assert.equal(hatch.payload.rawTags.filter(tag=>tag.code===79).length,1)
  const preserved=await adapter.write(reopened,{version:'2018'}),preservedTags=entityTags(preserved,'HATCH')
  assert.equal(values(preservedTags,53).length,1);assert.deepEqual(values(preservedTags,79),[0])
  const reopenedAgain=await adapter.read(preserved)
  assert.deepEqual(reopenedAgain.listEntities({type:'HATCH'})[0].payload.boundaryLoops.map(loop=>loop.external),[true,false])
})

test('unknown native pattern names fail instead of exporting an empty pattern definition',async()=>{
  await assert.rejects(nativeHatch('NOT-A-PATTERN'),/supports native pattern data for ANSI31 and ANSI37/)
})

test('editing an imported hatch exports current geometry instead of stale raw DXF tags',async()=>{
  const {adapter,artifact}=await nativeHatch('ANSI31')
  const drawing=await adapter.read(artifact),sdk=createKJDrawSDK();sdk.attachDocument(drawing)
  const hatch=drawing.listEntities({type:'HATCH'})[0]
  await sdk.executeCommand('MOVE',{ids:[hatch.id],dx:12,dy:-7},{document:drawing})
  assert.deepEqual(drawing.getObject(hatch.id).payload.boundaryLoops[0].vertices[0].point,[12,-7,0])
  const moved=await adapter.read(await adapter.write(drawing,{version:'2018'}))
  assert.deepEqual(moved.listEntities({type:'HATCH'})[0].payload.boundaryLoops.map(loop=>loop.vertices[0].point),[[12,-7,0],[17,-2,0]])
  await sdk.executeCommand('UNDO',{}, {document:drawing})
  const undone=await adapter.read(await adapter.write(drawing,{version:'2018'}))
  assert.deepEqual(undone.listEntities({type:'HATCH'})[0].payload.boundaryLoops.map(loop=>loop.vertices[0].point),[[0,0,0],[5,5,0]])
  await drawing.transact('Edit imported pattern',transaction=>transaction.updateObject(hatch.id,{payload:{patternScale:3,patternAngle:Math.PI/2}}))
  const edited=await adapter.read(await adapter.write(drawing,{version:'2018'}))
  const result=edited.listEntities({type:'HATCH'})[0]
  assert.equal(result.payload.patternScale,3);closeTo(result.payload.patternAngle,Math.PI/2)
  assert.deepEqual(values(entityTags(await adapter.write(drawing,{version:'2018'}),'HATCH'),53),[135])
})

test('native hatch export rejects non-planar boundaries instead of flattening them',async()=>{
  const drawing=KJDocument.create({documentId:'non-planar-hatch'})
  await drawing.transact('Non-planar boundary',transaction=>transaction.createEntity('HATCH',{
    patternName:'SOLID',solid:true,boundaryLoops:[{vertices:[[0,0,5],[20,0,5],[20,20,5]]}],
  }))
  assert.throws(()=>createDXFFileAdapter().write(drawing,{version:'2018'}),/finite XY points at Z=0/)
})
