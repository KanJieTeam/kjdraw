import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'
import { buildRoadDrawing } from '../src/road-drawing.js'
import { createRoadDrawingRecipe } from '../src/road-drawing-recipe.js'
import { agentPreviewMatchesDocument } from '../src/agent-preview.js'
import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../examples/fixtures/road-design.mjs'

const tool='cad_propose_road_revision'
const records=document=>Object.fromEntries(document.listEntities().map(entity=>[entity.id,entity]))
async function fixture(options={}) {
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'meter'}),input=createRoadDesignFixture(),drawingOptions={...roadDrawingFixtureOptions,...options}
  const drawing=buildRoadDrawing(input,drawingOptions)
  await sdk.executeCommand('CREATEBATCH',{entities:drawing.entities,resources:drawing.resources})
  const recipe=await createRoadDrawingRecipe(document,input,drawingOptions),session=new KJAgentToolSession(sdk,document)
  return {sdk,document,input,drawing,recipe,session,args:{expectedRevision:document.revision,units:'meter',drawingId:drawingOptions.drawingId,leftWidthDelta:.5,rightWidthDelta:.5,elevationDelta:.2}}
}

test('road revision strict tool requires host-verified recipe and explicit nonzero parameter changes',async()=>{
  const definition=KJDRAW_AGENT_TOOLS.find(item=>item.name===tool)
  assert.equal(definition.effect,'propose');assert.deepEqual(definition.inputSchema.required,Object.keys(definition.inputSchema.properties));assert.equal(definition.inputSchema.additionalProperties,false)
  const {document,recipe,session,args}=await fixture(),before=document.serialize()
  assert.equal((await session.call(tool,args)).ok,false)
  const restored=await session.registerRoadDrawingRecipe(recipe)
  assert.ok(Object.isFrozen(restored));assert.equal(restored.revision,document.revision)
  for(const patch of [{leftWidthDelta:0,rightWidthDelta:0,elevationDelta:0},{expectedRevision:0},{units:'millimeter'},{drawingId:'other'},{leftWidthDelta:-100},{elevationDelta:1e12},{leftWidthDelta:Number.MIN_VALUE,rightWidthDelta:0,elevationDelta:0},{calculation:{totalVolume:0}}])assert.equal((await session.call(tool,{...args,...patch})).ok,false,JSON.stringify(patch))
  let getterCalls=0;const malicious={...args};Object.defineProperty(malicious,'leftWidthDelta',{enumerable:true,get(){getterCalls++;return 1}})
  assert.equal((await session.call(tool,malicious)).ok,false);assert.equal(getterCalls,0);assert.equal(document.serialize(),before)
})

test('488-entity revision previews actual changes and volumes without writes, then preserves IDs in one undo and redo',async()=>{
  const {sdk,document,input,drawing,recipe,session,args}=await fixture()
  await sdk.executeCommand('CREATE',{type:'CIRCLE',payload:{center:[10,20],radius:3}})
  args.expectedRevision=document.revision
  const external=document.listEntities({type:'CIRCLE'})[0]
  const registered=await session.registerRoadDrawingRecipe(recipe),before=document.serialize(),beforeRecords=records(document),layers=document.getTable('layers')
  const result=await session.call(tool,args);assert.equal(result.ok,true,JSON.stringify(result))
  const proposal=result.value;assert.equal(proposal.command,'ROAD_DRAWING_UPDATE');assert.equal(proposal.status,'awaiting-host-approval');assert.equal(document.serialize(),before)
  const evidence=proposal.engineeringEvidence
  assert.equal(evidence.entityCount,488);assert.equal(evidence.designParameters.input.pavement.leftWidth,input.pavement.leftWidth+.5)
  assert.equal(evidence.designParameters.input.profile[0].elevation,input.profile[0].elevation+.2)
  assert.deepEqual(evidence.previousTotalVolume,drawing.calculation.totalVolume)
  assert.notDeepEqual(evidence.totalVolume,evidence.previousTotalVolume)
  assert.equal(evidence.changedCounts.updated,proposal.preview.before.length);assert.ok(evidence.changedCounts.updated>0)
  assert.ok(Object.isFrozen(proposal.preview));assert.ok(new TextEncoder().encode(JSON.stringify(result)).length<=1048576)
  const approval=await session.approve(proposal.planId,'host-user');assert.equal(approval.ok,true,JSON.stringify(approval))
  assert.equal(approval.value.status,'committed');assert.equal(document.revision,args.expectedRevision+1);assert.equal(approval.value.beforeRevision,args.expectedRevision)
  assert.ok(agentPreviewMatchesDocument(document,proposal.preview));assert.deepEqual(document.getObject(external.id),external);assert.deepEqual(document.getTable('layers'),layers)
  assert.deepEqual(Object.keys(records(document)),Object.keys(beforeRecords))
  for(const entity of document.listEntities()){assert.equal(entity.handle,beforeRecords[entity.id].handle);assert.equal(entity.ownerId,beforeRecords[entity.id].ownerId)}
  const afterRecords=records(document)
  const second=await session.call(tool,{...args,expectedRevision:document.revision,elevationDelta:.1})
  assert.equal(second.ok,true,JSON.stringify(second));assert.equal(session.reject(second.value.planId,'host-user').ok,true)
  assert.equal((await session.approve(second.value.planId,'host-user')).ok,false)
  await sdk.executeCommand('UNDO');assert.deepEqual(records(document),beforeRecords)
  assert.equal((await session.call(tool,{...args,expectedRevision:document.revision})).ok,false)
  await sdk.executeCommand('REDO');assert.deepEqual(records(document),afterRecords)
  assert.equal((await session.approve(proposal.planId,'host-user')).ok,false)
  for(const format of ['KJD','DXF']){
    const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format}),{format})
    assert.equal(reopened.listEntities().length,489)
  }
  assert.equal(registered.recipe.input.pavement.leftWidth,input.pavement.leftWidth)
})

test('stale registration and pending revisions cannot overwrite intervening edits',async()=>{
  const {sdk,document,recipe,session,args}=await fixture();await session.registerRoadDrawingRecipe(recipe)
  const proposal=await session.call(tool,args);assert.equal(proposal.ok,true)
  await sdk.executeCommand('CREATE',{type:'POINT',payload:{position:[1,2]}})
  const before=document.serialize()
  assert.equal((await session.call(tool,{...args,expectedRevision:document.revision})).ok,false)
  assert.equal((await session.approve(proposal.value.planId,'host-user')).ok,false)
  assert.equal(document.serialize(),before)
  await session.registerRoadDrawingRecipe(recipe)
  assert.equal((await session.call(tool,{...args,expectedRevision:document.revision})).ok,true)
})

test('recipe registration refuses manual geometry/resource changes, external namespace IDs and another document',async()=>{
  const edits=[
    (tx,drawing)=>tx.updateObject(drawing.entities.find(e=>e.key==='plan/alignment').options.id,{payload:{closed:true}}),
    (tx,drawing)=>tx.updateObject(drawing.resources.layers[0].id,{payload:{locked:true}}),
    (tx,drawing)=>tx.createEntity('POINT',{position:[0,0]},{id:`road:${roadDrawingFixtureOptions.drawingId}:external`}),
  ]
  for(const edit of edits){const {document,drawing,recipe,session}=await fixture();await document.transact('manual edit',tx=>edit(tx,drawing));const before=document.serialize();await assert.rejects(session.registerRoadDrawingRecipe(recipe));assert.equal(document.serialize(),before)}
  const {recipe}=await fixture(),sdk=createKJDrawSDK(),document=sdk.createDocument({units:'meter'}),session=new KJAgentToolSession(sdk,document)
  await assert.rejects(session.registerRoadDrawingRecipe(recipe),/different document/)
})

test('over-budget existing namespaces cannot enter agent revision even with a valid core recipe',async()=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'meter'}),input=createRoadDesignFixture()
  const options={...roadDrawingFixtureOptions,maxEntities:2000}
  const source=createRoadDesignFixture();source.sections=Array.from({length:25},(_,index)=>({station:index*25,ground:structuredClone(input.sections[0].ground)}))
  const drawing=buildRoadDrawing(source,options);assert.ok(drawing.entities.length>512)
  await sdk.executeCommand('CREATEBATCH',{entities:drawing.entities,resources:drawing.resources})
  const recipe=await createRoadDrawingRecipe(document,source,options),session=new KJAgentToolSession(sdk,document)
  const before=document.serialize();await assert.rejects(session.registerRoadDrawingRecipe(recipe),/agent budget/);assert.equal(document.serialize(),before)
})

test('road revision approval uses existing plan TTL, binding provider and single-use host confirmation',async()=>{
  let now=1000
  const sdk=createKJDrawSDK({agentPlanOptions:{clock:()=>now,defaultTtlMs:10}}),document=sdk.createDocument({units:'meter'})
  const input=createRoadDesignFixture(),drawing=buildRoadDrawing(input,roadDrawingFixtureOptions)
  await sdk.executeCommand('CREATEBATCH',{entities:drawing.entities,resources:drawing.resources})
  const recipe=await createRoadDrawingRecipe(document,input,roadDrawingFixtureOptions),session=new KJAgentToolSession(sdk,document)
  await session.registerRoadDrawingRecipe(recipe)
  const args={expectedRevision:document.revision,units:'meter',drawingId:roadDrawingFixtureOptions.drawingId,leftWidthDelta:.5,rightWidthDelta:0,elevationDelta:0}
  const proposal=await session.call(tool,args);assert.equal(proposal.ok,true,JSON.stringify(proposal))
  assert.equal(sdk.agentPlans.get(proposal.value.planId).command,'ROAD_DRAWING_UPDATE')
  const before=document.serialize();now+=11
  const expired=await session.approve(proposal.value.planId,'reviewer');assert.equal(expired.ok,false);assert.match(expired.error.message,/expired/)
  assert.equal(document.serialize(),before)
  const next=await session.call(tool,args);assert.equal(next.ok,true)
  const other=new KJAgentToolSession(sdk,document);assert.equal((await other.approve(next.value.planId,'reviewer')).ok,false)
  assert.equal(session.reject(next.value.planId,'reviewer').ok,true)
  assert.equal(sdk.agentPlans.get(next.value.planId).status,'rejected')
})

test('road approval obeys host before-execute veto and emits the standard envelope lifecycle',async()=>{
  const {sdk,document,recipe,session,args}=await fixture();await session.registerRoadDrawingRecipe(recipe)
  const seen=[]
  for(const name of ['planned','before-execute','committed','failed'])sdk.events.on(`command:${name}`,event=>{seen.push([name,event.envelope.command])})
  const proposal=await session.call(tool,args);assert.equal(proposal.ok,true)
  assert.deepEqual(Object.keys(proposal.value.arguments),['previous','next'])
  const before=document.serialize(),stop=sdk.events.on('command:before-execute',()=>{throw new Error('host policy veto')})
  const denied=await session.approve(proposal.value.planId,'reviewer');assert.equal(denied.ok,false);assert.equal(document.serialize(),before)
  assert.deepEqual(seen,[['planned','ROAD_DRAWING_UPDATE'],['before-execute','ROAD_DRAWING_UPDATE']])
  stop();seen.length=0
  const second=await session.call(tool,args);assert.equal(second.ok,true)
  const accepted=await session.approve(second.value.planId,'reviewer');assert.equal(accepted.ok,true)
  assert.deepEqual(seen,[['planned','ROAD_DRAWING_UPDATE'],['before-execute','ROAD_DRAWING_UPDATE'],['committed','ROAD_DRAWING_UPDATE']])
})

test('road approval honors command canExecute and rejects definition replacement after review',async()=>{
  const {sdk,document,recipe,session,args}=await fixture();await session.registerRoadDrawingRecipe(recipe)
  const core=sdk.commands.resolve('ROAD_DRAWING_UPDATE');let called=0
  sdk.commands.register({...core,canExecute:()=>false,execute:(...args)=>{called++;return core.execute(...args)}},{owner:'@kanjieteam/kjdraw',replace:true})
  let failed=0;sdk.events.on('command:failed',()=>failed++)
  const proposal=await session.call(tool,args);assert.equal(proposal.ok,true)
  const before=document.serialize(),denied=await session.approve(proposal.value.planId,'reviewer')
  assert.equal(denied.ok,false);assert.match(denied.error.message,/not available/);assert.equal(called,0);assert.equal(failed,1);assert.equal(document.serialize(),before)
  sdk.commands.register(core,{owner:'@kanjieteam/kjdraw',replace:true})
  const second=await session.call(tool,args);assert.equal(second.ok,true)
  sdk.commands.register({...core,execute:()=>{called++;throw new Error('replacement invoked')}},{owner:'host-replacement',replace:true})
  const replaced=await session.approve(second.value.planId,'reviewer');assert.equal(replaced.ok,false);assert.match(replaced.error.message,/changed since preview/);assert.equal(called,0);assert.equal(document.serialize(),before)
})

test('road core command validates data before cloning and commits one authoritative transaction',async()=>{
  const {sdk,document,input,drawing}=await fixture(),changed=structuredClone(input)
  changed.pavement.leftWidth+=.5
  const next=buildRoadDrawing(changed,roadDrawingFixtureOptions),before=records(document)
  let getterCalls=0;const args={previous:drawing};Object.defineProperty(args,'next',{enumerable:true,get(){getterCalls++;return next}})
  await assert.rejects(sdk.executeCommand('ROAD_DRAWING_UPDATE',args),/accessors/);assert.equal(getterCalls,0);assert.deepEqual(records(document),before)
  await assert.rejects(sdk.executeCommand('ROAD_DRAWING_UPDATE',{previous:drawing,next,extra:1}),/exactly previous and next/)
  const revision=document.revision,receipt=await sdk.executeCommand('ROAD_DRAWING_UPDATE',{previous:drawing,next},{expectedRevision:revision})
  assert.equal(receipt.revision,revision+1);assert.equal(document.revision,revision+1)
  await sdk.executeCommand('UNDO');assert.deepEqual(records(document),before)
})
