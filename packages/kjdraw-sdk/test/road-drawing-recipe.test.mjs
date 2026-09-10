import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJProjectSession } from '../src/project-session.js'
import { buildRoadDrawing } from '../src/road-drawing.js'
import { applyRoadDrawingRevision } from '../src/road-drawing-update.js'
import { createRoadDrawingRecipe, restoreRoadDrawingRecipe, KJDRAW_ROAD_RECIPE_SCHEMA } from '../src/road-drawing-recipe.js'
import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../examples/fixtures/road-design.mjs'

async function fixture() {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({documentId:'road-recipe-document',units:'meter'})
  const input=createRoadDesignFixture(), options=structuredClone(roadDrawingFixtureOptions), drawing=buildRoadDrawing(input,options)
  const project=KJProjectSession.create({sdk,id:'road-recipe-project',documents:[document],metadata:{externalProjectNote:'Preserve this host metadata'}})
  await sdk.executeCommand('CREATEBATCH',{resources:drawing.resources,entities:drawing.entities})
  await document.transact('unrelated user point',tx=>tx.createEntity('POINT',{position:[11,22,0]},{id:'external-user-point'}))
  return {sdk,document,project,input,options,drawing}
}

test('a recipe survives KJP reopen, drives same-document parameter updates, and survives a second save/reopen',async()=>{
  const {document,project,input,options}=await fixture(), original=document.serialize(), history=document.history
  const recipe=await createRoadDrawingRecipe(document,input,options)
  assert.equal(recipe.schema,KJDRAW_ROAD_RECIPE_SCHEMA);assert.equal(recipe.schemaVersion,1);assert.equal(recipe.compilerVersion,1)
  assert.equal(recipe.documentId,document.id);assert.ok(Object.isFrozen(recipe.input.sections[0].ground[0]))
  assert.equal(document.serialize(),original);assert.deepEqual(document.history,history)
  assert.equal(project.metadata.roadDrawingRecipes,undefined)
  // Persistence is an explicit host decision, separate from document geometry/history.
  project.metadata.roadDrawingRecipes={[options.drawingId]:recipe};project.markDirty('road-recipe')
  const bytes=await project.package(), unchangedBytes=bytes.slice(), openedSDK=createKJDrawSDK()
  const opened=await KJProjectSession.open(bytes,{sdk:openedSDK}), target=opened.activeDocument
  const restored=await restoreRoadDrawingRecipe(target,opened.metadata.roadDrawingRecipes[options.drawingId])
  assert.equal(restored.documentId,target.id);assert.equal(restored.revision,target.revision)
  assert.deepEqual(restored.recipe,recipe)
  assert.equal(opened.metadata.externalProjectNote,'Preserve this host metadata')
  const external=target.getObject('external-user-point'), before=new Map(target.listEntities().map(entity=>[entity.id,entity.handle]))
  const modified=structuredClone(restored.recipe.input)
  modified.pavement.leftWidth+=.75;modified.profile.forEach(point=>{point.elevation+=1.25})
  const next=buildRoadDrawing(modified,restored.recipe.options)
  const receipt=await applyRoadDrawingRevision(target,restored.drawing,next,{expectedRevision:restored.revision})
  assert.ok(receipt.updatedIds.length>0)
  for(const entity of next.entities) if(before.has(entity.options.id)) assert.equal(target.getObject(entity.options.id).handle,before.get(entity.options.id))
  assert.deepEqual(target.getObject('external-user-point'),external)
  const volume=next.entities.find(entity=>entity.key==='profile/volume-table/row/total/cell/4')
  assert.equal(target.getObject(volume.options.id).payload.text,next.calculation.totalVolume.fill.toFixed(3))
  await assert.rejects(restoreRoadDrawingRecipe(target,recipe),/was changed/)
  const updatedRecipe=await createRoadDrawingRecipe(target,modified,restored.recipe.options)
  opened.metadata.roadDrawingRecipes[options.drawingId]=updatedRecipe;opened.markDirty('updated-road-recipe')
  const updatedBytes=await opened.package()
  const twice=await KJProjectSession.open(updatedBytes,{sdk:createKJDrawSDK()})
  const restoredAgain=await restoreRoadDrawingRecipe(twice.activeDocument,twice.metadata.roadDrawingRecipes[options.drawingId])
  assert.deepEqual(restoredAgain.recipe.input,modified)
  assert.deepEqual(restoredAgain.drawing.calculation.totalVolume,next.calculation.totalVolume)
  assert.deepEqual(twice.activeDocument.getObject('external-user-point'),external)
  assert.equal(twice.activeDocument.listEntities().length,next.entities.length+1)
  assert.deepEqual(bytes,unchangedBytes)
  // Metadata is not secretly changed by Undo. A mismatching recipe is explicitly detectable.
  await openedSDK.executeCommand('UNDO')
  await assert.rejects(restoreRoadDrawingRecipe(target,updatedRecipe),/was changed/)
  assert.deepEqual(opened.metadata.roadDrawingRecipes[options.drawingId],updatedRecipe)
  await restoreRoadDrawingRecipe(target,recipe)
  await openedSDK.executeCommand('REDO')
  await restoreRoadDrawingRecipe(target,updatedRecipe)
  project.destroy();opened.destroy();twice.destroy()
})

test('recipe creation requires an existing matching drawing and never inserts geometry or mutates host parameters',async()=>{
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'meter'}), input=createRoadDesignFixture(), options=structuredClone(roadDrawingFixtureOptions), before=document.serialize()
  const originalInput=structuredClone(input), originalOptions=structuredClone(options)
  await assert.rejects(createRoadDrawingRecipe(document,input,options),/resource was changed, removed or moved/)
  assert.equal(document.serialize(),before)
  assert.deepEqual(input,originalInput);assert.deepEqual(options,originalOptions)
  assert.equal(Object.isFrozen(input),false);assert.equal(Object.isFrozen(options),false)
})

test('restore is read-only for source geometry, history, metadata and events even when external geometry changed',async()=>{
  const {document,project,input,options}=await fixture(), recipe=await createRoadDrawingRecipe(document,input,options)
  await document.transact('edit unrelated geometry',tx=>tx.updateObject('external-user-point',{payload:{position:[33,44,0]}}))
  const before=document.serialize(), history=document.history, metadata=structuredClone(project.metadata)
  let changes=0;const off=document.on('document:change',()=>{changes++})
  const restored=await restoreRoadDrawingRecipe(document,JSON.parse(JSON.stringify(recipe)))
  assert.equal(restored.revision,document.revision)
  assert.equal(document.serialize(),before);assert.deepEqual(document.history,history);assert.deepEqual(project.metadata,metadata)
  assert.equal(changes,0);off();project.destroy()
})

test('manual geometry/resource edits, protected layers and namespace collisions refuse restoration',async()=>{
  const edits=[
    tx=>tx.updateObject('road:access-road-study:profile/volume-table/row/total/cell/4',{payload:{text:'Manual quantity override'}}),
    tx=>tx.updateObject('road:access-road-study:layer:DESIGN',{payload:{locked:true}}),
    tx=>tx.updateObject('road:access-road-study:layer:GROUND',{payload:{visible:false}}),
    tx=>tx.updateObject('road:access-road-study:linetype:ground',{payload:{pattern:[8,-2],totalPatternLength:10}}),
    tx=>tx.createEntity('POINT',{position:[0,0,0]},{id:'road:access-road-study:unexpected-collision'}),
    tx=>tx.eraseObject('road:access-road-study:plan/alignment'),
  ]
  for(const edit of edits) {
    const {document,project,input,options}=await fixture(), recipe=await createRoadDrawingRecipe(document,input,options)
    await document.transact('manual modification',edit)
    const before=document.serialize(), history=document.history
    await assert.rejects(restoreRoadDrawingRecipe(document,recipe))
    assert.equal(document.serialize(),before);assert.deepEqual(document.history,history);project.destroy()
  }
})

test('wrong recipe versions, document binding, units and parameter snapshots are rejected',async()=>{
  const {document,project,input,options}=await fixture(), recipe=await createRoadDrawingRecipe(document,input,options), before=document.serialize()
  const mutations=[r=>{r.schema='another'},r=>{r.schemaVersion=2},r=>{r.compilerVersion=2},r=>{r.documentId='another-document'},r=>{r.input.units='millimeter'},r=>{r.options.drawingId='another-road'},r=>{r.input.pavement.leftWidth+=1},r=>{r.unknown=true}]
  for(const mutate of mutations) {
    const candidate=structuredClone(recipe);mutate(candidate)
    await assert.rejects(restoreRoadDrawingRecipe(document,candidate))
    assert.equal(document.serialize(),before)
  }
  await document.transact('changed document units',tx=>tx.setHeader('units','millimeter'))
  const changed=document.serialize()
  await assert.rejects(restoreRoadDrawingRecipe(document,recipe),/units must be meter/)
  assert.equal(document.serialize(),changed);project.destroy()
})

test('finite JSON recipe budget rejects accessors, conversion hooks, cycles, sparse arrays and oversized UTF8',async()=>{
  const {document,project,input,options}=await fixture(), recipe=await createRoadDrawingRecipe(document,input,options), before=document.serialize()
  let invoked=0
  const cases=[]
  const getter=structuredClone(recipe);Object.defineProperty(getter.input,'alignment',{enumerable:true,get(){invoked++;return []}});cases.push(getter)
  const hook=structuredClone(recipe);hook.toJSON=()=>{invoked++;return recipe};cases.push(hook)
  const sparse=structuredClone(recipe);delete sparse.input.alignment[0];cases.push(sparse)
  const extra=structuredClone(recipe);extra.input.alignment.extra=0;cases.push(extra)
  const nonfinite=structuredClone(recipe);nonfinite.input.alignment[0][0]=Infinity;cases.push(nonfinite)
  const cycle=structuredClone(recipe);cycle.input.alignment.push(cycle);cases.push(cycle)
  const oversized=structuredClone(recipe);oversized.options.title='界'.repeat(360000);cases.push(oversized)
  const hidden=structuredClone(recipe);Object.defineProperty(hidden,'schema',{value:recipe.schema,enumerable:false});cases.push(hidden)
  for(const candidate of cases) {
    await assert.rejects(restoreRoadDrawingRecipe(document,candidate))
    assert.equal(document.serialize(),before)
  }
  assert.equal(invoked,0);project.destroy()
})

test('source edits during detached consistency validation invalidate the restore result',async()=>{
  const {document,project,input,options}=await fixture(), recipe=await createRoadDrawingRecipe(document,input,options), revision=document.revision
  const originalFork=document.fork.bind(document)
  document.fork=()=>{
    const branch=originalFork(), transact=branch.transact.bind(branch)
    branch.transact=async(...args)=>{
      await document.transact('concurrent host edit',tx=>tx.updateObject('external-user-point',{payload:{position:[99,88,0]}}))
      return transact(...args)
    }
    return branch
  }
  await assert.rejects(restoreRoadDrawingRecipe(document,recipe),error=>error.code==='KJDOCUMENT_REVISION_CONFLICT'&&error.expected===revision&&error.actual===revision+1)
  assert.deepEqual(document.getObject('external-user-point').payload.position,[99,88,0])
  assert.equal(document.revision,revision+1);project.destroy()
})
