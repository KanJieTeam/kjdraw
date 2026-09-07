import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createKJCoreDocumentAuthority, createKJCoreSolidBackend, createKJDrawSDK, KJDocument } from '../src/index.js'

const artifactUrl=new URL('../../../web/public/kjcore/kjcore.wasm',import.meta.url)
async function authorities(){const bytes=await readFile(artifactUrl),{instance}=await WebAssembly.instantiate(bytes,{});return{documentAuthority:createKJCoreDocumentAuthority(instance),solidAuthority:createKJCoreSolidBackend(instance)}}

test('SOLID3D commands commit Rust-authored primitives, transforms, analysis and undo',async()=>{
  const auth=await authorities(),sdk=createKJDrawSDK(auth),document=sdk.createDocument({documentId:'solid-command'})
  const box=await sdk.executeCommand('SOLIDBOX',{center:[0,0,0],size:[2,3,4]})
  assert.equal(box.type,'SOLID3D');assert.equal(box.payload.kernelAuthority,'kjcore-rust-wasm');assert.equal(box.payload.validation.valid,true)
  assert.deepEqual(await sdk.executeCommand('SOLIDVOLUME',{id:box.id}),{id:box.id,volume:24,kernelAuthority:'kjcore-rust-wasm'})
  assert.equal((await sdk.executeCommand('SOLIDVALIDATE',{id:box.id})).valid,true)
  await sdk.executeCommand('SOLIDTRANSFORM',{id:box.id,matrix:[1,0,0,5,0,1,0,0,0,0,1,0,0,0,0,1]})
  assert.equal(document.getObject(box.id).payload.vertices.some(point=>point[0]>=4),true)
  await sdk.executeCommand('UNDO')
  assert.equal(document.getObject(box.id).payload.vertices.some(point=>point[0]>=4),false)
  const canonical=document.serialize(),reopened=KJDocument.open(canonical)
  assert.equal(reopened.getObject(box.id).payload.validation.valid,true)
  assert.equal(auth.documentAuthority.open(canonical).validate(),true)
})

test('SOLIDBOOLEAN is atomic, exact for AABBs and refuses unsupported topology',async()=>{
  const auth=await authorities(),sdk=createKJDrawSDK(auth),document=sdk.createDocument({documentId:'solid-boolean'})
  const first=await sdk.executeCommand('SOLIDBOX',{center:[0,0,0],size:[4,4,4]})
  const second=await sdk.executeCommand('SOLIDBOX',{center:[1,0,0],size:[4,2,2]})
  const result=await sdk.executeCommand('SOLIDBOOLEAN',{firstId:first.id,secondId:second.id,operation:'difference'})
  assert.ok(Math.abs((await sdk.executeCommand('SOLIDVOLUME',{id:result.id})).volume-52)<1e-8)
  const erased=document.listObjects({includeErased:true});assert.equal(erased.find(row=>row.id===first.id).erased,true);assert.equal(erased.find(row=>row.id===second.id).erased,true)
  const sphere=await sdk.executeCommand('SOLIDSPHERE',{center:[0,0,0],radius:1,segments:24})
  const before=document.revision
  await assert.rejects(()=>sdk.executeCommand('SOLIDBOOLEAN',{firstId:result.id,secondId:sphere.id,operation:'union'}),/超出当前精确基本体范围/)
  assert.equal(document.revision,before);assert.equal(document.getObject(result.id).erased,false);assert.equal(document.getObject(sphere.id).erased,false)
})

test('Rust KJD authority rejects a forged non-manifold SOLID3D payload',async()=>{
  const auth=await authorities(),sdk=createKJDrawSDK(auth),document=sdk.createDocument({documentId:'solid-forgery'})
  const box=await sdk.executeCommand('SOLIDBOX',{center:[0,0,0],size:[2,2,2]})
  const forged=document.toJSON();forged.objects[box.id].payload.triangles.pop()
  assert.throws(()=>auth.documentAuthority.open(forged),/对象图校验失败/)
})
