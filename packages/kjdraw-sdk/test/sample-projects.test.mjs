import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK, KJProjectSession, openKjpPackage } from '../src/index.js'
import { createSample } from '../../../examples/sample.js'

test('public synthetic sample packs and reopens without private assets',async()=>{
  const sdk=createKJDrawSDK(),document=await createSample(sdk)
  assert.equal(document.listEntities().length,150)
  assert.equal(document.validate().valid,true)
  const session=KJProjectSession.create({sdk,id:'public-synthetic',documents:[document],metadata:{synthetic:true}})
  const project=await openKjpPackage(await session.package())
  assert.equal(project.drawings.size,1)
  assert.equal(project.drawings.get(document.id).fingerprint(),document.fingerprint())
  assert.equal(project.manifest.metadata.synthetic,true)
  assert.equal([...project.entries.keys()].some(path=>path.startsWith('assets/')),false)
  session.destroy()
})

test('sample DXF reopens with core geometry and layers',async()=>{
  const sdk=createKJDrawSDK(),document=await createSample(sdk)
  const dxf=await sdk.writeDocument(document,{format:'DXF',version:'2018'})
  const reopened=await createKJDrawSDK().readDocument(dxf,{format:'DXF'})
  assert.equal(reopened.listEntities().length,document.listEntities().length)
  assert.deepEqual(reopened.getTable('layers').records.map(x=>x.name).sort(),document.getTable('layers').records.map(x=>x.name).sort())
})

test('agent sample move displaces geometry and undo restores it',async()=>{
  const sdk=createKJDrawSDK(),document=await createSample(sdk)
  const entity=document.listEntities({type:'CIRCLE'})[0]
  const plan=sdk.createCommandEnvelope('MOVE',{ids:[entity.id],dx:3,dy:0},{origin:'ai',mode:'plan',expectedRevision:document.revision})
  await sdk.executeCommandEnvelope(plan)
  assert.deepEqual(document.getObject(entity.id).payload.center,entity.payload.center)
  const confirmed=sdk.createCommandEnvelope(plan.command,plan.arguments,{origin:'ai',expectedRevision:plan.expectedRevision,confirmation:{status:'confirmed',planId:plan.id,confirmedBy:'sample-reviewer'}})
  await sdk.executeCommandEnvelope(confirmed)
  assert.equal(document.getObject(entity.id).payload.center[0],entity.payload.center[0]+3)
  await sdk.executeCommand('UNDO')
  assert.deepEqual(document.getObject(entity.id).payload.center,entity.payload.center)
})
