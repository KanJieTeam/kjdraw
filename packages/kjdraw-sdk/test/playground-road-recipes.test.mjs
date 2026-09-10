import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJProjectSession } from '../src/project-session.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { restoreRoadDrawingRecipe } from '../src/road-drawing-recipe.js'
import { persistApprovedRoadRecipe, prepareRoadDrawingContext } from '../../../apps/playground/road-recipes.js'
import { getKJDrawChatToolNames } from '../../../apps/playground/agent-chat.js'
import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../examples/fixtures/road-design.mjs'

async function fixture(){
  const sdk=createKJDrawSDK(), document=sdk.createDocument({documentId:'approved-road',units:'meter'}), project=KJProjectSession.create({sdk,documents:[document],metadata:{hostNote:'retain'}})
  const session=new KJAgentToolSession(sdk,document)
  const proposed=await session.call('cad_propose_road_drawing',{...createRoadDesignFixture(),...roadDrawingFixtureOptions,expectedRevision:0})
  assert.equal(proposed.ok,true)
  const approved=await session.approve(proposed.value.planId,'explicit-host-reviewer');assert.equal(approved.ok,true)
  const context={sdk,document,project}, value={context,proposal:proposed.value,receipt:approved.value}
  return {sdk,document,project,context,value}
}

test('approved road parameters persist explicitly in KJP metadata without a second geometry revision',async()=>{
  const {sdk,document,project,context,value}=await fixture(), before=document.serialize(), history=document.history
  const recipe=await persistApprovedRoadRecipe(value,()=>context)
  assert.equal(document.serialize(),before);assert.deepEqual(document.history,history)
  assert.equal(project.metadata.hostNote,'retain')
  const key=`${document.id}:${roadDrawingFixtureOptions.drawingId}`
  assert.deepEqual(project.metadata.roadDrawingRecipes[key],recipe)
  assert.equal(project.state,'dirty');assert.equal(document.revision,1)
  const reopened=await KJProjectSession.open(await project.package(),{sdk:createKJDrawSDK()})
  const restored=await restoreRoadDrawingRecipe(reopened.activeDocument,reopened.metadata.roadDrawingRecipes[key])
  assert.equal(restored.drawing.entities.length,value.proposal.preview.after.length)
  await sdk.executeCommand('UNDO')
  await assert.rejects(restoreRoadDrawingRecipe(document,project.metadata.roadDrawingRecipes[key]))
  project.destroy();reopened.destroy()
})

test('recipe metadata limit failures leave approved geometry and existing metadata intact',async()=>{
  const {document,project,context,value}=await fixture()
  for(const existing of [Object.fromEntries(Array.from({length:16},(_,i)=>[`prior-${i}`,{}])),{first:'x'.repeat(2_200_000),second:'x'.repeat(2_200_000)}]){
    project.metadata.roadDrawingRecipes=existing
    const metadata=project.metadata, before=document.serialize()
    await assert.rejects(persistApprovedRoadRecipe(value,()=>context),/16 road recipes|4 MiB/)
    assert.equal(project.metadata,metadata);assert.equal(project.metadata.roadDrawingRecipes,existing)
    assert.equal(document.serialize(),before);assert.equal(document.revision,1)
  }
  project.destroy()
})

test('post-approval bookkeeping requires the current project, document, and applied revision',async()=>{
  const {document,project,context,value}=await fixture(), metadata=structuredClone(project.metadata)
  await assert.rejects(persistApprovedRoadRecipe(value,()=>({...context,project:{}})),/binding changed/)
  await assert.rejects(persistApprovedRoadRecipe({...value,receipt:{...value.receipt,status:'planned'}},()=>context),/applied revision/)
  assert.deepEqual(project.metadata,metadata)
  await document.transact('later manual edit',tx=>tx.createEntity('POINT',{position:[0,0,0]}))
  const before=document.serialize()
  await assert.rejects(persistApprovedRoadRecipe(value,()=>context),/applied revision/)
  assert.equal(document.serialize(),before);assert.deepEqual(project.metadata,metadata);project.destroy()
})

test('a project switch during recipe verification prevents writes to either project',async()=>{
  const {document,project,context,value}=await fixture(), metadata=structuredClone(project.metadata), originalFork=document.fork.bind(document)
  let current=context
  document.fork=()=>{const branch=originalFork();current={...context,project:{}};return branch}
  const before=document.serialize()
  await assert.rejects(persistApprovedRoadRecipe(value,()=>current),/binding changed/)
  assert.equal(document.serialize(),before);assert.deepEqual(project.metadata,metadata);project.destroy()
})

test('metadata accessors do not execute and non-road proposals skip parameter bookkeeping',async()=>{
  const {document,project,context,value}=await fixture(), before=document.serialize()
  let invoked=0
  Object.defineProperty(project.metadata,'roadDrawingRecipes',{enumerable:true,get(){invoked++;return {}}})
  await assert.rejects(persistApprovedRoadRecipe(value,()=>context),/store must be data/)
  assert.equal(invoked,0);assert.equal(document.serialize(),before)
  assert.equal(await persistApprovedRoadRecipe({proposal:{}},()=>{throw new Error('unused')}),null)
  project.destroy()
})

test('reopened KJP supplies bounded local road context, revises the same drawing and persists the new recipe',async()=>{
  const initial=await fixture()
  await persistApprovedRoadRecipe(initial.value,()=>initial.context)
  const project=await KJProjectSession.open(await initial.project.package(),{sdk:createKJDrawSDK()})
  const {sdk}=project,document=project.activeDocument,context={project,sdk,document}
  await sdk.executeCommand('CREATE',{type:'POINT',payload:{position:[-10,-10,0]}},{document})
  const external=document.listEntities({type:'POINT'})[0]
  const session=new KJAgentToolSession(sdk,document), before=document.serialize(), history=document.history
  const prepared=await prepareRoadDrawingContext(context,()=>context,session)
  assert.deepEqual(prepared.drawingIds,[roadDrawingFixtureOptions.drawingId]);assert.equal(prepared.unavailableCount,0)
  assert.ok(getKJDrawChatToolNames(document,prepared.drawingIds).includes('cad_propose_road_revision'))
  assert.match(prepared.contextText,/explicit drawingId/)
  assert.doesNotMatch(prepared.contextText,/3300000|ground|alignment|hostNote/)
  assert.ok(new TextEncoder().encode(prepared.contextText).length<12000)
  assert.equal(document.serialize(),before);assert.deepEqual(document.history,history)
  const proposal=await session.call('cad_propose_road_revision',{expectedRevision:document.revision,units:'meter',drawingId:prepared.drawingIds[0],leftWidthDelta:.5,rightWidthDelta:.5,elevationDelta:.25})
  assert.equal(proposal.ok,true,JSON.stringify(proposal))
  assert.equal(document.serialize(),before)
  assert.ok(proposal.value.preview.before.length>64);assert.ok(proposal.value.preview.after.length>64)
  const receipt=await session.approve(proposal.value.planId,'explicit-user-approval')
  assert.equal(receipt.ok,true,JSON.stringify(receipt))
  await persistApprovedRoadRecipe({context,proposal:proposal.value,receipt:receipt.value},()=>context)
  const key=`${document.id}:${roadDrawingFixtureOptions.drawingId}`,recipe=project.metadata.roadDrawingRecipes[key]
  assert.equal(recipe.input.pavement.leftWidth,4);assert.equal(recipe.input.profile[0].elevation,100.25)
  assert.deepEqual(document.getObject(external.id),external)
  const next=await KJProjectSession.open(await project.package(),{sdk:createKJDrawSDK()})
  const restored=await restoreRoadDrawingRecipe(next.activeDocument,next.metadata.roadDrawingRecipes[key])
  assert.equal(restored.recipe.input.pavement.rightWidth,4)
  assert.deepEqual(next.activeDocument.getObject(external.id),external)
  await sdk.executeCommand('UNDO',{}, {document})
  const undone=await prepareRoadDrawingContext(context,()=>context,new KJAgentToolSession(sdk,document))
  assert.deepEqual(undone.drawingIds,[]);assert.equal(undone.unavailableCount,1)
  assert.ok(!getKJDrawChatToolNames(document,undone.drawingIds).includes('cad_propose_road_revision'))
  await sdk.executeCommand('REDO',{}, {document})
  assert.deepEqual((await prepareRoadDrawingContext(context,()=>context,new KJAgentToolSession(sdk,document))).drawingIds,prepared.drawingIds)
  initial.project.destroy();project.destroy();next.destroy()
})

test('multiple saved road identities remain explicit and revision bookkeeping preserves the other recipe',async()=>{
  const {document,project,context,value,sdk}=await fixture()
  await persistApprovedRoadRecipe(value,()=>context)
  const firstKey=`${document.id}:${roadDrawingFixtureOptions.drawingId}`,firstRecipe=project.metadata.roadDrawingRecipes[firstKey]
  const create=new KJAgentToolSession(sdk,document),drawingId='other-study'
  const proposed=await create.call('cad_propose_road_drawing',{...createRoadDesignFixture(),...roadDrawingFixtureOptions,drawingId,expectedRevision:document.revision})
  assert.equal(proposed.ok,true,JSON.stringify(proposed))
  const approved=await create.approve(proposed.value.planId,'explicit-user')
  assert.equal(approved.ok,true)
  await persistApprovedRoadRecipe({context,proposal:proposed.value,receipt:approved.value},()=>context)
  const session=new KJAgentToolSession(sdk,document)
  const prepared=await prepareRoadDrawingContext(context,()=>context,session)
  assert.deepEqual(prepared.drawingIds,[roadDrawingFixtureOptions.drawingId,drawingId])
  assert.match(prepared.contextText,/ambiguous/)
  const revision=await session.call('cad_propose_road_revision',{expectedRevision:document.revision,units:'meter',drawingId,leftWidthDelta:.25,rightWidthDelta:0,elevationDelta:0})
  assert.equal(revision.ok,true,JSON.stringify(revision))
  const receipt=await session.approve(revision.value.planId,'explicit-user')
  assert.equal(receipt.ok,true)
  await persistApprovedRoadRecipe({context,proposal:revision.value,receipt:receipt.value},()=>context)
  assert.deepEqual(project.metadata.roadDrawingRecipes[firstKey],firstRecipe)
  assert.equal(project.metadata.roadDrawingRecipes[`${document.id}:${drawingId}`].input.pavement.leftWidth,3.75)
  await restoreRoadDrawingRecipe(document,firstRecipe)
  project.destroy()
})

test('road model context excludes wrong identities and edited recipes, rejects races and never invokes metadata getters',async()=>{
  const {document,project,context,value,sdk}=await fixture()
  await persistApprovedRoadRecipe(value,()=>context)
  const key=`${document.id}:${roadDrawingFixtureOptions.drawingId}`,recipe=project.metadata.roadDrawingRecipes[key]
  const before=document.serialize()
  project.metadata.roadDrawingRecipes={wrongKey:recipe,other:{...recipe,documentId:'other-document'}}
  const ignored=await prepareRoadDrawingContext(context,()=>context,new KJAgentToolSession(sdk,document))
  assert.deepEqual(ignored.drawingIds,[]);assert.equal(ignored.unavailableCount,1)
  let invoked=0
  Object.defineProperty(project.metadata,'roadDrawingRecipes',{configurable:true,enumerable:true,get(){invoked++;return {}}})
  assert.equal((await prepareRoadDrawingContext(context,()=>context,{})).unavailableCount,1)
  assert.equal(invoked,0);assert.equal(document.serialize(),before)
  Object.defineProperty(project.metadata,'roadDrawingRecipes',{configurable:true,enumerable:true,writable:true,value:{[key]:recipe}})
  const originalFork=document.fork.bind(document)
  let current=context
  document.fork=()=>{const fork=originalFork();current={...context,project:{}};return fork}
  await assert.rejects(prepareRoadDrawingContext(context,()=>current,new KJAgentToolSession(sdk,document)),/binding changed/)
  document.fork=originalFork
  const entity=document.listEntities({type:'LINE'})[0]
  await sdk.executeCommand('MOVE',{ids:[entity.id],dx:1,dy:0},{document})
  assert.deepEqual((await prepareRoadDrawingContext(context,()=>context,new KJAgentToolSession(sdk,document))).drawingIds,[])
  project.destroy()
})
