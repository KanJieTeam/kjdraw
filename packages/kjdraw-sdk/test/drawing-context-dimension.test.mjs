import test from 'node:test'
import assert from 'node:assert/strict'
import {createKJDrawSDK} from '../src/sdk.js'
import {KJAgentToolSession} from '../src/agent-tools.js'
import {createDrawingContext} from '../src/drawing-context.js'

const value=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value}
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8')
async function fixture(units='millimeter'){
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units})
  const style=await document.transact('non-standard style',tx=>tx.upsertTableRecord('dimensionStyles',{name:'DETAIL',type:'DIM_STYLE',payload:{overallScale:2,textHeight:3,arrowSize:.4,extensionOffset:.1,extensionBeyond:.3,decimalPlaces:3,angularDecimalPlaces:2,angularUnits:0,privateNotes:'style-private'}}))
  const add=(payload,options={})=>document.transact('native dimension',tx=>tx.createEntity('DIMENSION',{dimensionType:'ALIGNED',definitionPoints:[[0,2],[0,0],[10.123456,0]],styleId:style.id,...payload},options))
  return{sdk,document,style,add,session:new KJAgentToolSession(sdk,document)}
}

test('read tool exposes actual native measurement and effective bound style while labeling stale cache explicitly',async()=>{
  const {document,style,add,session}=await fixture()
  const styled=await add({measurement:999}),small=await add({textHeight:.04,overallScale:.5,arrowSize:.008,extensionOffset:.003,extensionBeyond:.009,precision:4,textOverride:'L <> mm',measurement:null,blockName:'*D12'})
  const source=document.serialize(),history=document.history
  const result=value(await session.call('cad_read_drawing',{})),entries=new Map(result.entities.map(e=>[e.id,e]))
  const a=entries.get(styled.id).geometry,b=entries.get(small.id).geometry
  assert.equal(a.cachedMeasurement,999);assert.equal(Object.hasOwn(a,'measurement'),false)
  assert.equal(a.annotation.measurement,10.123456);assert.equal(a.annotation.measurementUnit,'millimeter');assert.equal(a.annotation.label.text,'10.123')
  assert.equal(a.annotation.label.height,6);assert.equal(a.annotation.effectiveStyle.textHeight,3);assert.equal(a.annotation.effectiveStyle.overallScale,2)
  assert.equal(a.annotation.effectiveStyle.styleName,'DETAIL');assert.equal(a.annotation.effectiveStyle.binding,'style-id');assert.equal(a.annotation.effectiveStyle.styleId,style.id)
  assert.equal(b.annotation.label.text,'L 10.1235 mm');assert.equal(b.annotation.label.height,.02)
  assert.equal(b.annotation.effectiveStyle.textHeight,.04);assert.equal(b.annotation.effectiveStyle.arrowSize,.008)
  assert.equal(b.annotation.effectiveStyle.extensionOffset,.003);assert.equal(b.annotation.effectiveStyle.extensionBeyond,.009)
  assert.equal(b.annotation.effectiveStyle.lengthsAreUnscaled,true);assert.equal(b.annotation.effectiveStyle.lengthUnits,'owner-coordinate-units')
  assert.equal(b.precision,4);assert.equal(b.annotation.formatInputs.entityPrecision,4);assert.equal(b.annotation.formatInputs.styleDecimalPlaces,3)
  assert.deepEqual(b.definitionPoints,small.payload.definitionPoints);assert.equal(b.blockName,'*D12');assert.equal(b.styleId,style.id)
  assert.equal(b.annotation.measurementBasis,'native-definition-points');assert.equal(b.annotation.associativity,'not-evaluated')
  assert.equal(b.annotation.coordinateSpace,'model-xy');assert.equal(entries.get(small.id).ownerId,document.snapshot().spaces.modelSpaceId)
  assert.doesNotMatch(JSON.stringify(result),/style-private/)
  assert.equal(document.serialize(),source);assert.deepEqual(document.history,history)
  assert.throws(()=>{b.annotation.label.text='changed'},TypeError)
})

test('angular and reflex dimensions expose degrees and current labels independently of drawing units and cached values',async()=>{
  const {document,add,session}=await fixture('meter')
  const right=await add({dimensionType:'ANGULAR',definitionPoints:[[0,10],[0,0],[10,0],[0,0],[5,5]],precision:1,measurement:12})
  const reflex=await add({dimensionType:'ANGULAR_3_POINT',definitionPoints:[[-5,-5],[10,0],[0,10],[0,0]],precision:-1,linearPrecision:3,measurement:1})
  const entries=value(await session.call('cad_read_drawing',{})).entities
  for(const [entity,expected] of [[right,90],[reflex,270]]){
    const geometry=entries.find(e=>e.id===entity.id).geometry
    assert.equal(geometry.annotation.status,'projected');assert.equal(geometry.annotation.measurement,expected)
    assert.equal(geometry.annotation.measurementUnit,'degrees');assert.equal(geometry.annotation.label.text,expected+'°')
    assert.equal(geometry.cachedMeasurement,entity.payload.measurement)
  }
  assert.equal(document.snapshot().header.units,'meter')
})

test('paper and block measurements retain exact owner identity and unknown local length units without INSERT expansion',async()=>{
  const {document,add,session}=await fixture('meter')
  const paperOwner=document.snapshot().spaces.paperSpaceIds[0]
  const paper=await add({}, {ownerId:paperOwner})
  const block=await document.transact('block',tx=>tx.upsertTableRecord('blockRecords',{name:'DETAIL_BLOCK',type:'BLOCK_RECORD',payload:{isSpace:false,basePoint:[0,0,0]}}))
  const local=await add({}, {ownerId:block.id})
  await document.transact('instance',tx=>tx.createEntity('INSERT',{blockRecordId:block.id,position:[100,200],scale:[100,100,1]}))
  for(const [ownerId,entity,coordinateSpace] of [[paperOwner,paper,'paper-xy'],[block.id,local,'block-local']]){
    const result=value(await session.call('cad_query_drawing',{expectedRevision:document.revision,filters:{spaceId:ownerId,types:['DIMENSION']},offset:0,layerOffset:0,limit:10,maxLayers:0,maxBytes:8192}))
    assert.equal(result.spaceId,ownerId);assert.deepEqual(result.entities.map(e=>e.id),[entity.id])
    const row=result.entities[0];assert.equal(row.ownerId,ownerId)
    assert.equal(row.geometry.annotation.coordinateSpace,coordinateSpace);assert.equal(row.geometry.annotation.measurementUnit,'unknown')
    assert.equal(row.geometry.annotation.measurement,10.123456)
  }
  assert.equal(value(await session.call('cad_read_drawing',{})).entities.some(e=>[paper.id,local.id].includes(e.id)),false)
})

test('unsupported native dimensions keep definitions and cached data but never invent projected measurements',async()=>{
  const {document,add,session}=await fixture()
  const dimensions=[]
  dimensions.push(await add({dimensionType:'ORDINATE',measurement:123}))
  dimensions.push(await add({definitionPoints:[[0,2,0],[0,0,0],[3,4,8]],measurement:999}))
  dimensions.push(await add({normal:[0,1,0],measurement:88}))
  dimensions.push(await add({textPosition:[5,2,1],measurement:55}))
  dimensions.push(await add({dimensionType:'ANGULAR_3_POINT',definitionPoints:[[5,5],[10,0],[0,10],[0,0]],angularUnits:1,measurement:999}))
  dimensions.push(await add({dimensionType:'ANGULAR',definitionPoints:[[0,10],[0,0],[10,0],[0,0]],incompleteAngularDefinition:true,measurement:90}))
  const source=document.serialize(),result=value(await session.call('cad_read_drawing',{}))
  for(const entity of dimensions){
    const geometry=result.entities.find(e=>e.id===entity.id).geometry
    assert.equal(geometry.annotation.status,'unsupported');assert.equal(geometry.annotation.measurement,null);assert.equal(geometry.annotation.label,null)
    assert.equal(geometry.annotation.effectiveStyle,null);assert.ok(geometry.annotation.reason)
    assert.equal(geometry.cachedMeasurement,entity.payload.measurement);assert.deepEqual(geometry.definitionPoints,entity.payload.definitionPoints)
  }
  assert.equal(document.serialize(),source)
})

test('annotation shares the original geometry and response budgets atomically and preserves pagination and revision checks',async()=>{
  const {document,add,session}=await fixture()
  const huge=await add({textOverride:'中'.repeat(1800)})
  for(let i=0;i<6;i++)await add({precision:i})
  const source=document.serialize()
  const oversized=createDrawingContext(document,{ids:[huge.id],maxLayers:0})
  assert.equal(oversized.entities[0].geometry,null);assert.equal(oversized.entities[0].geometryOmittedReason,'geometry-budget')
  assert.equal(oversized.truncated,true);assert.equal(oversized.limits.maxGeometryBytes,8192)
  let offset=0,seen=[]
  do{
    const result=value(await session.call('cad_query_drawing',{expectedRevision:document.revision,filters:{types:['DIMENSION']},offset,layerOffset:0,limit:2,maxLayers:0,maxBytes:1800}))
    assert.ok(bytes(result)<=1800)
    for(const row of result.entities){
      seen.push(row.id)
      if(row.geometry){assert.ok(bytes(row.geometry)<=8192);assert.ok(row.geometry.annotation);assert.equal(row.geometry.annotation.status,'projected')}
      else assert.ok(['geometry-budget','response-budget'].includes(row.geometryOmittedReason))
    }
    offset=result.nextOffset
  }while(offset!==null)
  assert.equal(seen.length,7);assert.equal(new Set(seen).size,7);assert.equal(document.serialize(),source)
  const revision=document.revision;await add({})
  const stale=await session.call('cad_query_drawing',{expectedRevision:revision,filters:{types:['DIMENSION']},offset:1,layerOffset:0,limit:2,maxLayers:0,maxBytes:1800})
  assert.equal(stale.ok,false);assert.equal(stale.error.code,'KJDOCUMENT_REVISION_CONFLICT')
})
