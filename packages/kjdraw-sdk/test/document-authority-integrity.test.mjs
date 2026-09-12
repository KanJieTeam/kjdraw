import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument } from '../src/index.js'

async function fixture() {
  const document=KJDocument.create()
  await document.transact('Original',tx=>{
    tx.createEntity('LINE',{start:[0,0,0],end:[10,0,0]},{id:'line'})
    tx.createEntity('CIRCLE',{center:[30,20,0],radius:4},{id:'untouched'})
  })
  return document
}
function bind(document, transform) {
  let state=document.toJSON(), commits=0, closes=0
  document.bindAuthority({serialize:()=>structuredClone(state),close(){closes++},commit(serialized){
    commits++; state=JSON.parse(serialized); return transform(state)
  }})
  return {get commits(){return commits},get closes(){return closes}}
}

test('authority cannot change untouched geometry, metadata, unknown fields or history while accepting a valid revision',async()=>{
  for (const corrupt of [
    state=>{state.objects.untouched.payload.radius=5},
    state=>{state.metadata.title='Unexpected'},
    state=>{state.unrequested={opaque:'data'}},
    state=>{state.revisions.at(-1).label='Unexpected'},
  ]) {
    const document=await fixture(), before=document.serialize(), history=document.history
    const backend=bind(document,state=>{corrupt(state);return state})
    await assert.rejects(document.transact('Move line',tx=>tx.updateObject('line',{payload:{end:[15,0,0]}})),/mismatched document commit/)
    assert.equal(document.serialize(),before);assert.deepEqual(document.history,history)
    assert.equal(document.hasAuthoritativeBackend,false);assert.equal(backend.closes,1)
    await document.transact('Safe local continuation',tx=>tx.updateObject('line',{payload:{end:[12,0,0]}}))
    assert.equal(backend.commits,1);assert.equal(document.getObject('untouched').payload.radius,4)
  }
})

test('malformed and identity-mismatched authority responses preserve local state and close the uncertain session',async()=>{
  for (const response of [()=>'{broken',state=>({...state,documentId:'other'}),state=>({...state,revision:state.revision+1})]) {
    const document=await fixture(), before=document.serialize(), backend=bind(document,response)
    await assert.rejects(document.transact('Change',tx=>tx.updateObject('line',{name:'New'})))
    assert.equal(document.serialize(),before);assert.equal(document.hasAuthoritativeBackend,false)
    assert.equal(backend.commits,1);assert.equal(backend.closes,1)
  }
})

test('uncertain authority exceptions detach even when backend cleanup throws, without masking the original error',async()=>{
  const document=await fixture(), before=document.serialize()
  document.bindAuthority({serialize:()=>document.toJSON(),commit(){throw new Error('Response lost')},close(){throw new Error('Cleanup failed')}})
  await assert.rejects(document.transact('Change',tx=>tx.updateObject('line',{name:'New'})),error=>error.cause?.message==='Response lost')
  assert.equal(document.serialize(),before);assert.equal(document.hasAuthoritativeBackend,false)
})

test('failed authoritative undo and redo retain the entire local drawing and history',async()=>{
  for (const action of ['undo','redo']) {
    const document=await fixture()
    await document.transact('Name',tx=>tx.updateObject('line',{name:'Changed'}))
    if(action==='redo')await document.undo()
    const before=document.serialize(),history=document.history,backend=bind(document,state=>{
      state.objects.untouched.payload.radius=7;return state
    })
    await assert.rejects(document[action](),/mismatched document commit/)
    assert.equal(document.serialize(),before);assert.deepEqual(document.history,history)
    assert.equal(backend.closes,1);assert.equal(document.hasAuthoritativeBackend,false)
    assert.equal(await document[action](),true);assert.equal(backend.commits,1)
  }
})

test('authority accepts key-order changes and exact Rust defaults but cannot alter explicit optional fields',async()=>{
  const document=await fixture()
  const backend=bind(document,state=>{
    for(const object of Object.values(state.objects)){
      for(const [key,value] of Object.entries({ownerId:null,name:null,payload:{},extension:{},erased:false,source:null}))
        if(!Object.hasOwn(object,key))object[key]=value
    }
    return JSON.stringify(Object.fromEntries(Object.entries(state).reverse()))
  })
  await document.transact('Parser defaults',tx=>tx.updateObject('line',{name:undefined,source:undefined,erased:undefined}))
  assert.equal(document.getObject('line').name,null);assert.equal(document.getObject('line').erased,false)
  assert.equal(document.hasAuthoritativeBackend,true);assert.equal(backend.closes,0)
  document.unbindAuthority()
  const before=document.serialize()
  bind(document,state=>{state.objects.line.name=null;return state})
  await assert.rejects(document.transact('Explicit name',tx=>tx.updateObject('line',{name:'Keep'})),/mismatched document commit/)
  assert.equal(document.serialize(),before)
})

test('an old pending authority response cannot overwrite a replacement authority or its adopted state',async()=>{
  const document=await fixture(), baseline=document.toJSON()
  let release
  const pending=new Promise(resolve=>{release=resolve}), old={closes:0}
  document.bindAuthority({serialize:()=>structuredClone(baseline),close(){old.closes++},async commit(serialized){
    await pending;return serialized
  }})
  const transaction=document.transact('Pending old commit',tx=>tx.updateObject('line',{name:'Obsolete'}))
  await new Promise(resolve=>setTimeout(resolve,0))
  const replacementState=structuredClone(baseline), replacement={closes:0,commits:0}
  replacementState.metadata.title='Replacement session'
  document.bindAuthority({serialize:()=>structuredClone(replacementState),close(){replacement.closes++},commit(serialized){
    replacement.commits++;return serialized
  }})
  release()
  await assert.rejects(transaction,/obsolete document session/)
  assert.equal(document.snapshot().metadata.title,'Replacement session')
  assert.equal(document.getObject('line').name,null)
  assert.equal(document.hasAuthoritativeBackend,true)
  assert.equal(old.closes,1);assert.equal(replacement.closes,0)
  await document.transact('Replacement commit',tx=>tx.updateObject('line',{name:'Current'}))
  assert.equal(replacement.commits,1);assert.equal(document.getObject('line').name,'Current')
  document.unbindAuthority();assert.equal(replacement.closes,1)
})
