import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'
import { captureAgentBlockDependencies } from '../src/agent-preview-blocks.js'

async function fixture({ nested=false, sequenceOnly=false, legacy=false }={}) {
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
  await document.transact('Synthetic native attribute association',tx=>{
    const symbol=tx.upsertTableRecord('blockRecords',{id:'symbol',name:'Symbol',payload:{basePoint:[0,0,0]}})
    tx.createEntity('LINE',{start:[0,0],end:[4,0]},{id:'shape',ownerId:symbol.id})
    const outer=nested?tx.upsertTableRecord('blockRecords',{id:'outer',name:'Assembly',payload:{basePoint:[0,0,0]}}):null
    const insert=tx.createEntity('INSERT',{blockRecordId:symbol.id,position:[10,20],scale:[2,2,1],...(legacy?{attributes:{LABEL:'legacy'}}:{})},{id:nested?'nested':'root',...(outer?{ownerId:outer.id}:{})})
    if(!legacy){
      const attributeIds=[]
      if(!sequenceOnly){
        const style=tx.upsertTableRecord('textStyles',{id:'attribute-style',name:'Attribute text',payload:{fontFamily:'sans-serif'}})
        const attribute=tx.createEntity('ATTRIB',{parentInsertId:insert.id,tag:'LABEL',text:'Attached text',position:[20,30],height:2,styleId:style.id},{id:'attribute',ownerId:insert.ownerId})
        attributeIds.push(attribute.id)
      }
      const end=tx.createObject({id:'sequence-end',kind:'custom',type:'SEQEND',ownerId:insert.id,payload:{dxfOwnerMode:'insert'}})
      tx.updateObject(insert.id,{payload:{attributeIds,sequenceEndId:end.id}})
    }
    if(outer)tx.createEntity('INSERT',{blockRecordId:outer.id,position:[100,200]},{id:'root'})
  })
  return {sdk,document,session:new KJAgentToolSession(sdk,document)}
}

for(const [label,options] of [['root',{}],['nested',{nested:true}],['empty native sequence',{sequenceOnly:true}],['nested empty native sequence',{nested:true,sequenceOnly:true}],['legacy values',{legacy:true}]]) {
  test(`AI transform rejects ${label} attributes before any draft, proposal, or history change`,async()=>{
    const {document,session}=await fixture(options),source=document.serialize(),history=structuredClone(document.history),revision=document.revision
    let forks=0;const fork=document.fork.bind(document);document.fork=(...args)=>{forks++;return fork(...args)}
    assert.throws(()=>captureAgentBlockDependencies(document,['root']),/attribute.*separate complete preview/)
    for(const [name,args] of [['cad_propose_move',{dx:3,dy:4}],['cad_propose_rotate',{center:{x:0,y:0},angleDegrees:30}],['cad_propose_scale',{center:{x:0,y:0},factor:2}]]){
      const result=await session.call(name,{expectedRevision:revision,units:'millimeter',ids:['root'],...args})
      assert.equal(result.ok,false,JSON.stringify(result));assert.match(JSON.stringify(result),/attribute.*separate complete preview/)
      assert.equal(result.value,undefined);assert.equal(document.serialize(),source);assert.equal(document.revision,revision);assert.deepEqual(document.history,history)
    }
    assert.equal(forks,0,'refusal happens before executing a detached CAD command')
  })
}

test('current AI surface has no generic delete or arbitrary property-edit tool',()=>{
  assert.ok(!KJDRAW_AGENT_TOOLS.some(tool=>/delete|erase|set.?propert|update.?propert|execute.?command/i.test(tool.name)))
})
