import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { selectEntitiesInBox, selectEntitiesByFence } from '../src/selection-geometry.js'
import { layoutCadText } from '../src/geometry/text-layout.js'
import { insertAttributes } from '../src/attribute-display.js'
import { exportDrawingSvg } from '../src/svg-export.js'

export async function attributedFixture() {
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
  await document.transact('positioned native attributes',tx=>{
    const symbol=tx.upsertTableRecord('blockRecords',{id:'symbol',name:'Instrument',payload:{basePoint:[0,0,0]}})
    tx.createEntity('CIRCLE',{center:[0,0],radius:2},{id:'shape',ownerId:symbol.id})
    tx.createEntity('ATTDEF',{position:[0,4],tag:'TAG',text:'PLACEHOLDER',height:2,flags:0},{id:'definition',ownerId:symbol.id})
    tx.createEntity('INSERT',{blockRecordId:symbol.id,position:[20,30],scale:[3,3,1],rotation:Math.PI/2},{id:'root'})
    tx.createEntity('ATTRIB',{position:[100,50],alignmentPoint:[100,50],horizontalAlignment:1,verticalAlignment:2,text:'AB',tag:'TAG',height:10,widthFactor:.7,parentInsertId:'root'},{id:'attribute'})
    tx.createEntity('ATTRIB',{position:[-500,-500],text:'SECRET',tag:'HIDDEN',height:10,flags:1,parentInsertId:'root'},{id:'hidden'})
    tx.createObject({id:'root-end',kind:'custom',type:'SEQEND',ownerId:'root',payload:{dxfOwnerMode:'insert'}})
    tx.updateObject('root',{payload:{attributeIds:['attribute','hidden'],sequenceEndId:'root-end'}})
    const outer=tx.upsertTableRecord('blockRecords',{id:'outer',name:'Outer',payload:{basePoint:[5,8,0]}})
    tx.createEntity('INSERT',{blockRecordId:symbol.id,position:[12,16],rotation:Math.PI/2,scale:[3,3,1]},{id:'nested',ownerId:outer.id})
    tx.createEntity('ATTRIB',{position:[50,20],text:'NESTED',tag:'TAG',height:4,parentInsertId:'nested'},{id:'nested-attribute',ownerId:outer.id})
    tx.createObject({id:'nested-end',kind:'custom',type:'SEQEND',ownerId:'nested',payload:{dxfOwnerMode:'insert'}})
    tx.updateObject('nested',{payload:{attributeIds:['nested-attribute'],sequenceEndId:'nested-end'}})
    tx.createEntity('INSERT',{blockRecordId:outer.id,position:[250,40],scale:[2,2,1]},{id:'outer-insert'})
  })
  return {sdk,document}
}

test('native attribute bounds use owner coordinates and nested ancestor matrix exactly once; selecting text returns INSERT',async()=>{
 const {document}=await attributedFixture(),before=document.serialize()
 assert.deepEqual(insertAttributes(document,document.getObject('root')).map(e=>e.id),['attribute','hidden'])
 assert.deepEqual(selectEntitiesInBox(document,[98,49],[102,51],'crossing'),['root'])
 assert.deepEqual(selectEntitiesByFence(document,[[95,50],[105,50]]),['root'])
 assert.deepEqual(selectEntitiesInBox(document,[342,66],[345,68],'crossing'),['outer-insert'])
 assert.deepEqual(selectEntitiesInBox(document,[-510,-510],[-450,-450],'crossing'),[])
 assert.deepEqual(selectEntitiesInBox(document,[-10,-10],[400,100],'window'),['root','outer-insert'])
 assert.equal(document.serialize(),before)
})

test('parent visibility and attribute own layer visibility suppress selection without leaking independent attribute IDs',async()=>{
 const {document}=await attributedFixture()
 await document.transact('hide parent',tx=>tx.updateObject('root',{payload:{visible:false}}))
 assert.deepEqual(selectEntitiesInBox(document,[90,40],[110,60],'crossing'),[])
 await document.transact('hide attribute layer',tx=>{
  const layer=tx.upsertTableRecord('layers',{name:'Hidden attributes',payload:{visible:false}})
  tx.updateObject('root',{payload:{visible:true}});tx.updateObject('attribute',{payload:{layerId:layer.id}})
 })
 assert.deepEqual(selectEntitiesInBox(document,[90,40],[110,60],'crossing'),[])
})

test('shared text placement retains width, alignment, explicit reflection and fitted geometry independent of font choice',()=>{
 const source={position:[0,0],alignmentPoint:[100,50],text:'AB',height:10,widthFactor:.7,horizontalAlignment:1,verticalAlignment:2}
 assert.deepEqual(layoutCadText(source).corners,[[95.8,45],[104.2,45],[104.2,55],[95.8,55]])
 assert.deepEqual(layoutCadText({...source,generationFlags:1}).corners,layoutCadText(source).corners)
 assert.deepEqual(layoutCadText({...source,generationFlags:2}).corners,[[104.2,45],[95.8,45],[95.8,55],[104.2,55]])
 assert.deepEqual(layoutCadText({...source,generationFlags:4}).corners,[[95.8,55],[104.2,55],[104.2,45],[95.8,45]])
 assert.ok(Math.abs(layoutCadText({...source,obliqueAngle:Math.PI/4}).corners[2][0]-109.2)<1e-10)
 const fit=layoutCadText({...source,position:[10,20],alignmentPoint:[30,20],horizontalAlignment:5,verticalAlignment:0})
 assert.deepEqual(fit.corners,[[10,20],[30,20],[30,30],[10,30]])
 assert.throws(()=>layoutCadText({...source,horizontalAlignment:5,alignmentPoint:[0,0]}))
})

test('SVG expands positioned native attributes once, retains width, excludes hidden and placeholder values, and never mutates source',async()=>{
 const {sdk,document}=await attributedFixture(),layoutId=document.snapshot().spaces.layoutIds[0]
 await sdk.executeCommand('PLOTSETUP',{layoutId,dxf:{paperWidth:420,paperHeight:297,paperUnits:1,plotType:4,flags:0,windowMinX:0,windowMinY:0,windowMaxX:400,windowMaxY:200,scaleNumerator:1,scaleDenominator:1}},{document})
 const before=document.serialize(),result=exportDrawingSvg(document,{layoutId})
 assert.equal(result.report.diagnostics.length,0);assert.equal(result.report.status,'approximate')
 assert.equal((result.svg.match(/data-entity-id="attribute"/g)??[]).length,1)
 assert.equal((result.svg.match(/data-entity-id="nested-attribute"/g)??[]).length,1)
 assert.ok(result.svg.includes('matrix(0.7 0 0 -1 0 0)'))
 assert.ok(!result.svg.includes('>SECRET<'));assert.ok(!result.svg.includes('>PLACEHOLDER<'))
 assert.equal(document.serialize(),before)
})

test('SVG explicitly transforms oblique and mirrored text instead of dropping those source parameters',async()=>{
 const {sdk,document}=await attributedFixture(),layoutId=document.snapshot().spaces.layoutIds[0]
 await sdk.executeCommand('PLOTSETUP',{layoutId,dxf:{paperWidth:420,paperHeight:297,paperUnits:1,plotType:4,flags:0,windowMinX:0,windowMinY:0,windowMaxX:400,windowMaxY:200,scaleNumerator:1,scaleDenominator:1}},{document})
 await document.transact('native text display parameters',tx=>tx.updateObject('attribute',{payload:{generationFlags:6,obliqueAngle:Math.PI/4}}))
 const result=exportDrawingSvg(document,{layoutId})
 assert.equal(result.report.diagnostics.length,0)
 assert.match(result.svg,/matrix\(-0\.7 0 0\.9999999999999999 1 0 0\)/)
})
