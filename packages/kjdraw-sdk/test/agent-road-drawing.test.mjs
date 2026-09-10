import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { buildAgentRoadDrawing } from '../src/agent-road-drawing.js'
import { createAgentGeometryPreview, agentPreviewMatchesDocument } from '../src/agent-preview.js'
import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../examples/fixtures/road-design.mjs'

function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' })
  return { sdk, document, input: { expectedRevision: document.revision, ...createRoadDesignFixture(), ...structuredClone(roadDrawingFixtureOptions) } }
}

test('13-section road compiles without writes and full detached preview matches explicitly executed batch', async () => {
  const { sdk, document, input } = fixture(), before = document.serialize(), original = JSON.stringify(input)
  const proposal = buildAgentRoadDrawing(document, input)
  assert.equal(proposal.evidence.entityCount, 488)
  assert.equal(proposal.evidence.calculation.sections.length, 13)
  assert.equal(proposal.evidence.calculation.length, 600)
  assert.deepEqual(proposal.evidence.designParameters.input,createRoadDesignFixture())
  assert.deepEqual(proposal.evidence.designParameters.options,{...roadDrawingFixtureOptions,maxEntities:512})
  assert.throws(()=>{proposal.evidence.designParameters.input.pavement.leftWidth=99},TypeError)
  assert.equal(document.serialize(), before)
  assert.equal(JSON.stringify(input), original)
  assert.ok(proposal.commandArgs.entities.every(e => e.options.ownerId === document.snapshot().spaces.modelSpaceId))
  const preview = await createAgentGeometryPreview(document, 'CREATEBATCH', proposal.commandArgs, { maxCreatedEntities: 512 })
  assert.equal(preview.after.length, 488)
  assert.equal(preview.resources.length, 8)
  assert.equal(document.serialize(), before)
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs)
  assert.equal(agentPreviewMatchesDocument(document, preview), true)
  const count = document.listEntities().length
  assert.throws(() => buildAgentRoadDrawing(document, { ...input, expectedRevision: document.revision }), /already/)
  assert.equal(document.listEntities().length, count)
  await sdk.executeCommand('UNDO')
  assert.equal(document.listEntities().length, 0)
})

test('another route and explicit settings generate different exact drawing with the same controlled owner', async () => {
  const { sdk, document, input } = fixture()
  Object.assign(input, { drawingId:'short-route', title:'Different local access route', startStation:200, alignment:[[10,20],[70,100]], profile:[{station:200,elevation:2},{station:300,elevation:3}], sections:[200,225,300].map(station=>({station,ground:[[-30,0],[0,.5],[30,1]]})), pavement:{leftWidth:2,rightWidth:3,leftCrossfall:-.02,rightCrossfall:-.03}, profileScale:{horizontal:1,vertical:4}, sectionScale:{horizontal:1,vertical:1} })
  const proposal = buildAgentRoadDrawing(document, input)
  assert.equal(proposal.evidence.calculation.length, 100)
  assert.equal(proposal.evidence.calculation.sections.length, 3)
  assert.equal(proposal.evidence.projections.profile.vertical, 4)
  const preview = await createAgentGeometryPreview(document, 'CREATEBATCH', proposal.commandArgs, {maxCreatedEntities:512})
  await sdk.executeCommand('CREATEBATCH', proposal.commandArgs)
  assert.equal(agentPreviewMatchesDocument(document,preview),true)
})

test('stale revision, wrong units, missing data, unsafe data and over-budget section work reject without mutations', () => {
  const changes = [
    value=>{value.expectedRevision=1},value=>{value.units='millimeter'},value=>{delete value.textHeight},
    value=>{value.drawingId='../unsafe'},value=>{value.title='unsafe\ntext'},value=>{value.profileScale.horizontal=0},
    value=>{value.sections=Array.from({length:65},(_,i)=>({station:i,ground:[[-25,99],[25,99]]}))},
    value=>{value.sections=Array.from({length:32},(_,i)=>({station:i*600/31,ground:[[-25,99],[25,99]]}))},
    value=>{value.sections[0].ground=Array.from({length:4097},(_,i)=>[i,99])},value=>{value.origin=[0,0]},
  ]
  for (const change of changes) {
    const { document,input }=fixture(), before=document.serialize();change(input)
    assert.throws(()=>buildAgentRoadDrawing(document,input))
    assert.equal(document.serialize(),before)
  }
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'millimeter'})
  assert.throws(()=>buildAgentRoadDrawing(document,fixture().input),/meter/)
  let invoked=0;const source=fixture();Object.defineProperty(source.input.sections[0].ground[0],'1',{enumerable:true,get(){invoked++;return 99}})
  assert.throws(()=>buildAgentRoadDrawing(source.document,source.input),/accessors/);assert.equal(invoked,0)
})

test('existing conflicting table names are rejected even with unrelated record IDs', async () => {
  const { document,input }=fixture()
  await document.transact('existing layer', tx=>tx.upsertTableRecord('layers',{name:'ACCESS-ROAD-STUDY_ROAD_DESIGN',type:'LAYER',payload:{color:7}}))
  input.expectedRevision=document.revision
  const before=document.serialize()
  assert.throws(()=>buildAgentRoadDrawing(document,input),/resource IDs or names already exist/)
  assert.equal(document.serialize(),before)
})
