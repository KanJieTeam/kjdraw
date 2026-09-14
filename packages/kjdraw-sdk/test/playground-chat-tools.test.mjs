import test from 'node:test'
import assert from 'node:assert/strict'
import { KJDRAW_CHAT_TOOL_NAMES, getKJDrawChatToolNames, getKJDrawChatToolNamesForRequest } from '../../../apps/playground/agent-chat.js'
import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../examples/fixtures/road-design.mjs'
import { buildRoadDrawing } from '../src/road-drawing.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { runKJAgentTask } from '../src/agent-runner.js'
import { KJAgentCapabilityRegistry } from '../src/agent-capabilities.js'

function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  return { document, session: new KJAgentToolSession(sdk, document) }
}
const circle = { expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 3, y: 4 }, radius: 2 }] }
const modelCall = (name, args, inspect = () => {}) => ({ createConversation({ tools, instructions }) {
  inspect(tools, instructions)
  let sent=false
  return { next: async () => sent ? { text: 'Done.', calls: [] } : (sent=true, { text: '', calls: [{ id: 'call-1', name, arguments: args }] }) }
} })

test('workbench exposes useful tools and creates ordinary geometry through pattern arrays=[]', async () => {
  const { session, document } = fixture()
  assert.ok(Object.isFrozen(KJDRAW_CHAT_TOOL_NAMES))
  assert.equal(KJDRAW_CHAT_TOOL_NAMES.length, 25)
  assert.ok(KJDRAW_CHAT_TOOL_NAMES.includes('cad_query_topology'))
  assert.deepEqual(KJDRAW_CHAT_TOOL_NAMES.filter(name => name.startsWith('cad_propose_')), ['cad_propose_component_insert', 'cad_propose_design_bind', 'cad_propose_design_update', 'cad_propose_move', 'cad_propose_relayer', 'cad_propose_copy', 'cad_propose_rotate', 'cad_propose_scale', 'cad_propose_offset', 'cad_propose_stretch', 'cad_propose_lengthen', 'cad_propose_polyline_edit', 'cad_propose_drawing_pattern', 'cad_propose_drawing_annotated', 'cad_propose_manufacturing_sheet', 'cad_propose_architecture_plan'])
  const args = { expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [[3, 4, 2]], arcs: [], polylines: [], arrays: [] }
  const result = await runKJAgentTask({ session, prompt: 'Draw a line and circle.', toolNames: KJDRAW_CHAT_TOOL_NAMES,
    model: modelCall('cad_propose_drawing_pattern', args, tools => assert.deepEqual(tools.map(item => item.name).sort(), [...KJDRAW_CHAT_TOOL_NAMES].sort())) })
  assert.equal(result.status, 'awaiting-approval')
  assert.equal(document.revision, 0)
  assert.equal(result.outputs[0].result.value.preview.after.length, 2)
  assert.equal((await session.approve(result.proposalIds[0], 'reviewer')).ok, true)
  assert.deepEqual(document.listEntities({ type: 'CIRCLE' })[0].payload.center, [3, 4, 0])
})

test('explicit architecture requests compile a blank drawing through the single semantic schema', async () => {
  for (const prompt of ['Create an architectural floor plan with rooms, walls, doors and windows.', '绘制办公室建筑平面图，包含房间布局和门窗。']) {
    const { document, session } = fixture(), toolNames=getKJDrawChatToolNamesForRequest(document,prompt)
    assert.deepEqual(toolNames,['cad_propose_architecture_plan'])
    const input={version:'1.0.0',expectedRevision:0,units:'millimeter',drawingId:'ARCH-101',title:'TWO ROOM OFFICE',width:10000,depth:8000,wallThickness:200,
      exteriorOpenings:[{wall:'south',offset:1200,width:900,kind:'door'},{wall:'north',offset:3000,width:1500,kind:'window'}],
      partitions:[{id:'P1',axis:'vertical',position:5000,start:200,end:7800,openings:[{offset:3100,width:900,kind:'door'}]}],
      rooms:[{id:'R1',name:'MEETING',bounds:[200,200,4700,7600]},{id:'R2',name:'STUDIO',bounds:[5100,200,4700,7600]}],textHeight:250}
    const result=await runKJAgentTask({session,prompt,toolNames,model:modelCall('cad_propose_architecture_plan',input,tools=>assert.deepEqual(tools.map(tool=>tool.name),toolNames))})
    assert.equal(result.status,'awaiting-approval',JSON.stringify({error:result.error,outputs:result.outputs}))
    const proposal=result.outputs[0].result.value
    assert.equal(proposal.engineeringEvidence.skillId,'architecture-plan')
    assert.equal(document.listEntities().length,0)
    assert.equal((await session.approve(proposal.planId,'architecture-reviewer')).ok,true)
    assert.ok(document.listEntities({type:'INSERT'}).length>=3)
    assert.ok(document.getTable('blockRecords').records.some(record=>record.name.startsWith('KJ_ARCH_DOOR_')))
  }
})

test('explicit site requests compile a blank meter drawing through the single semantic schema', async () => {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'meter'}), session=new KJAgentToolSession(sdk,document)
  const prompt='Create a general site plan with a site boundary, roads, buildings and utilities.'
  const toolNames=getKJDrawChatToolNamesForRequest(document,prompt)
  assert.deepEqual(toolNames,['cad_propose_site_plan'])
  const input={version:'1.0.0',expectedRevision:0,units:'meter',drawingId:'SITE-101',title:'CAMPUS GENERAL SITE PLAN',revision:'A',
    boundary:[[1000,2000],[1260,2000],[1270,2120],[1220,2220],[1000,2200]],roads:[{name:'MAIN ROAD',width:8,centerline:[[990,2020],[1080,2020],[1160,2060],[1280,2060]]}],
    buildings:[{name:'ADMIN',floors:4,footprint:[[1025,2040],[1080,2040],[1080,2080],[1025,2080]]}],
    utilities:[{kind:'water',name:'WATER',diameterMm:200,path:[[1005,2028],[1090,2028],[1240,2070]],nodeIndices:[0,1,2]},{kind:'drainage',name:'STORM',diameterMm:600,path:[[1010,2190],[1080,2160],[1250,2120]],nodeIndices:[0,1,2]}],
    coordinateReference:{position:[1010,2010],easting:385000.125,northing:3452000.75,crs:'EPSG:32650'},northAngleDegrees:-8,scale:500}
  const result=await runKJAgentTask({session,prompt,toolNames,model:modelCall('cad_propose_site_plan',input,tools=>assert.deepEqual(tools.map(tool=>tool.name),toolNames))})
  assert.equal(result.status,'awaiting-approval')
  const proposal=result.outputs[0].result.value
  assert.equal(proposal.engineeringEvidence.skillId,'site-plan')
  assert.equal(document.listEntities().length,0)
  assert.equal((await session.approve(proposal.planId,'site-reviewer')).ok,true)
  assert.ok(document.getTable('layers').records.some(record=>record.name==='SITE_BOUNDARY'))
  assert.ok(document.listEntities().length>20)
})

test('explicit manufacturing requests on an empty millimeter drawing send only the semantic compiler schema', async () => {
  for (const prompt of ['Create a manufacturing drawing for a fixture plate with counterbores.', '绘制夹具板制造工程图，包含沉孔和加工说明。']) {
    const { document, session } = fixture(), toolNames=getKJDrawChatToolNamesForRequest(document,prompt)
    assert.ok(Object.isFrozen(toolNames));assert.deepEqual(toolNames,['cad_propose_manufacturing_sheet'])
    const input={version:'1.0.0',expectedRevision:0,units:'millimeter',drawingId:'ROUTED-1',title:'ROUTED FIXTURE PLATE',revision:'A',material:'ALUMINIUM',quantity:1,length:100,width:60,thickness:8,holePatterns:[],slots:[],sheet:{origin:[0,0],size:[297,210]},textHeight:3}
    const result=await runKJAgentTask({session,prompt,toolNames,model:modelCall('cad_propose_manufacturing_sheet',input,tools=>assert.deepEqual(tools.map(item=>item.name),toolNames))})
    assert.equal(result.status,'awaiting-approval')
  }
  const {document}=fixture()
  assert.equal(getKJDrawChatToolNamesForRequest(document,'Draw a plate outline.'),KJDRAW_CHAT_TOOL_NAMES)
  await document.transact('existing geometry',tx=>tx.createEntity('LINE',{start:[0,0,0],end:[1,0,0]}))
  assert.equal(getKJDrawChatToolNamesForRequest(document,'Create a manufacturing drawing for a fixture plate.'),KJDRAW_CHAT_TOOL_NAMES)
})

test('explicit single MOVE requests use only the move schema when the host supplies exact selected entities', async () => {
  const {document,session}=fixture()
  await document.transact('Selectable geometry',tx=>{
    tx.createEntity('LINE',{start:[0,0,0],end:[20,0,0]},{id:'selected-edge'})
    tx.createEntity('CIRCLE',{center:[10,10,0],radius:3},{id:'selected-hole'})
  })
  const selectedIds=['selected-edge','selected-hole']
  for(const prompt of ['Move the selected objects 5 mm to the right.', '把选中的对象向右移动 5 毫米。', 'Translate the selection by (5, -2).', '将选中对象平移 (5, -2)。']){
    const toolNames=getKJDrawChatToolNamesForRequest(document,prompt,selectedIds)
    assert.ok(Object.isFrozen(toolNames));assert.deepEqual(toolNames,['cad_propose_move'])
  }
  const toolNames=getKJDrawChatToolNamesForRequest(document,'Move the selected objects by dx=5 and dy=-2.',selectedIds)
  const result=await runKJAgentTask({session,prompt:'Move the selected objects by dx=5 and dy=-2.',toolNames,
    model:modelCall('cad_propose_move',{expectedRevision:document.revision,units:'millimeter',ids:selectedIds,dx:5,dy:-2},tools=>assert.deepEqual(tools.map(tool=>tool.name),['cad_propose_move']))})
  assert.equal(result.status,'awaiting-approval')
  assert.equal(document.revision,1)
})

test('MOVE routing stays conservative without exact selection, displacement, or a single edit intent', async () => {
  const {document}=fixture()
  await document.transact('Selectable geometry',tx=>tx.createEntity('LINE',{start:[0,0,0],end:[20,0,0]},{id:'selected-edge'}))
  const full=getKJDrawChatToolNames(document), selected=['selected-edge']
  for(const [prompt,ids] of [
    ['Move the selected object 5 mm right.',[]],
    ['Move the selected object 5 mm right.',['missing']],
    ['Move the selected object 5 mm right.',['selected-edge','selected-edge']],
    ['Move the selected object.',selected],
    ['How can I move the selected object 5 mm right?',selected],
    ["Don't move the selected object 5 mm right.",selected],
    ['Move and rotate the selected object 5 mm right.',selected],
    ['Move or copy the selected object 5 mm right.',selected],
    ['把选中对象向右移动 5 毫米并旋转 10 度。',selected],
    ['如何把选中对象向右移动 5 毫米？',selected],
    ['不要把选中对象向右移动 5 毫米。',selected],
  ])assert.equal(getKJDrawChatToolNamesForRequest(document,prompt,ids),full,prompt)
})

test('workbench policy rejects unexposed legacy creation before dispatch', async () => {
  const { session, document } = fixture()
  for (const name of ['cad_propose_lines', 'cad_propose_circles', 'cad_propose_drawing', 'cad_propose_drawing_compact']) {
    const result = await runKJAgentTask({ session, prompt: 'Draw.', toolNames: KJDRAW_CHAT_TOOL_NAMES, model: modelCall(name, circle) })
    assert.equal(result.status, 'failed')
    assert.equal(result.error.code, 'KJAGENT_TOOL_NOT_ALLOWED')
    assert.equal(result.toolCalls, 0)
    assert.equal(document.revision, 0)
  }
})

test('chat discovers selection sets only in drawings containing them and keeps each run policy fixed', async () => {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'millimeter'}), session=new KJAgentToolSession(sdk,document)
  const emptyPolicy=getKJDrawChatToolNames(document)
  assert.equal(emptyPolicy.includes('cad_read_selection_sets'),false)
  await document.transact('Create a named detail',tx=>tx.createEntity('LINE',{start:[0,0,0],end:[20,0,0]},{id:'detail-edge'}))
  await sdk.getSelectionManager(document.id).saveNamed('Detail',{ids:['detail-edge']})
  const names=getKJDrawChatToolNames(document)
  assert.ok(Object.isFrozen(names)); assert.equal(names.length,emptyPolicy.length+1)
  assert.equal(emptyPolicy.includes('cad_read_selection_sets'),false)
  const result=await runKJAgentTask({session,prompt:'Inspect the named detail.',toolNames:names,model:{createConversation({tools}){
    assert.ok(tools.some(tool=>tool.name==='cad_read_selection_sets'))
    let turn=0
    return {next:async()=>++turn===1?{text:'',calls:[{id:'sets',name:'cad_read_selection_sets',arguments:{expectedRevision:document.revision,offset:0,limit:20,maxBytes:65536}}]}:{text:'Read only.',calls:[]}}
  }}})
  assert.equal(result.outputs[0].result.value.selectionSets[0].name,'Detail')
  assert.equal(document.revision,2)
  for(const units of ['meter','inch']){
    await document.transact('Change units',tx=>tx.setHeader('units',units))
    const policy=getKJDrawChatToolNames(document,['road-fixture'])
    assert.ok(policy.includes('cad_read_selection_sets'))
    assert.equal(policy.includes('cad_propose_road_revision'),units==='meter')
  }
  await document.transact('Restore millimeter units',tx=>tx.setHeader('units','millimeter'))
  const denied=await runKJAgentTask({session,prompt:'Inspect.',toolNames:emptyPolicy,model:modelCall('cad_read_selection_sets',{})})
  assert.equal(denied.error.code,'KJAGENT_TOOL_NOT_ALLOWED'); assert.equal(denied.toolCalls,0)
})

test('SDK omitted and explicit tool policies still support legacy callers independently of workbench defaults', async () => {
  for (const toolNames of [undefined, ['cad_propose_circles']]) {
    const { session } = fixture()
    const result = await runKJAgentTask({ session, prompt: 'Draw a circle.', ...(toolNames ? { toolNames } : {}),
      model: modelCall('cad_propose_circles', circle, tools => {
        assert.deepEqual(tools.map(item => item.name).sort(), (toolNames ?? session.definitions.map(item => item.name)).slice().sort())
      }) })
    assert.equal(result.status, 'awaiting-approval')
  }
})

test('locked legacy capability tools are not replaced by workbench defaults and cannot exceed a host allowlist', async () => {
  const registry = new KJAgentCapabilityRegistry()
  const pack = { schema: 'com.kanjie.kjdraw.agent-capability', schemaVersion: 1, id: 'example.legacy-circle', name: 'Legacy circle', version: '1.0.0', toolApiVersion: 1,
    instructions: 'Use the original circle tool.', requiredToolNames: ['cad_measure_distance', 'cad_propose_circles'],
    requirements: [{ id: 'distance', description: 'Check supplied spacing.', check: { toolName: 'cad_measure_distance', assertion: 'The spacing matches the requested distance.' } }] }
  registry.register(pack)
  const lock = registry.createLock([{ id: pack.id, version: pack.version }])
  registry.register({ ...pack, version: '2.0.0', instructions: 'Use the new pattern tool.', requiredToolNames: ['cad_measure_distance', 'cad_propose_drawing_pattern'] })
  const { session } = fixture(), capabilities = { registry, lock }
  const result = await runKJAgentTask({ session, prompt: 'Draw the circle.', capabilities,
    model: modelCall('cad_propose_circles', circle, (tools, instructions) => {
      assert.deepEqual(tools.map(item => item.name).sort(), [...pack.requiredToolNames].sort())
      assert.match(instructions, /original circle tool/)
      assert.doesNotMatch(instructions, /new pattern tool/)
    }) })
  assert.equal(result.status, 'awaiting-approval')
  let opened = false
  await assert.rejects(runKJAgentTask({ session, prompt: 'Draw.', capabilities, toolNames: ['cad_measure_distance'], model: { createConversation() { opened = true } } }), /outside the host allowlist/)
  assert.equal(opened, false)
})

test('meter workbench exposes the road tool and retains the complete native proposal and all resources', async () => {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'meter'}), session=new KJAgentToolSession(sdk,document)
  const toolNames=getKJDrawChatToolNames(document), input={...createRoadDesignFixture(),...roadDrawingFixtureOptions,expectedRevision:0}
  assert.ok(Object.isFrozen(toolNames)); assert.deepEqual(toolNames,[...KJDRAW_CHAT_TOOL_NAMES.filter(name=>!['cad_propose_manufacturing_sheet','cad_propose_architecture_plan'].includes(name)),'cad_propose_site_plan','cad_propose_road_drawing'])
  const expected=buildRoadDrawing(createRoadDesignFixture(),roadDrawingFixtureOptions), before=document.serialize()
  assert.ok(expected.entities.length>64)
  const result=await runKJAgentTask({session,prompt:'Compile this fully supplied road study for host review.',toolNames,
    model:modelCall('cad_propose_road_drawing',input,tools=>assert.deepEqual(tools.map(tool=>tool.name).sort(),[...toolNames].sort()))})
  assert.equal(result.status,'awaiting-approval')
  const proposal=result.outputs[0].result.value
  assert.equal(document.serialize(),before)
  assert.equal(proposal.preview.after.length,expected.entities.length)
  assert.deepEqual(proposal.preview.after.map(entity=>entity.id),expected.entities.map(entity=>entity.options.id))
  assert.equal(proposal.preview.resources.length,expected.resources.layers.length+expected.resources.linetypes.length)
  assert.deepEqual(proposal.engineeringEvidence.calculation.totalVolume,expected.calculation.totalVolume)
  assert.equal((await session.approve(proposal.planId,'workbench-reviewer')).ok,true)
  assert.equal(document.listEntities().length,expected.entities.length)
  assert.deepEqual(document.getTable('linetypes').records.find(record=>record.name.endsWith('_ROAD_GROUND')).payload.pattern,[3,-1])
  await sdk.executeCommand('UNDO');assert.equal(document.listEntities().length,0)
  assert.equal(document.getTable('layers').records.length,1)
})

test('road advertisement follows current document units and non-meter dispatch is refused', async () => {
  const {document,session}=fixture()
  assert.equal(getKJDrawChatToolNames(document),KJDRAW_CHAT_TOOL_NAMES)
  const result=await runKJAgentTask({session,prompt:'Request a road in an incompatible document.',toolNames:getKJDrawChatToolNames(document),
    model:modelCall('cad_propose_road_drawing',{...createRoadDesignFixture(),...roadDrawingFixtureOptions,expectedRevision:0})})
  assert.equal(result.status,'failed');assert.equal(result.error.code,'KJAGENT_TOOL_NOT_ALLOWED');assert.equal(result.toolCalls,0)
  assert.equal(document.revision,0)
  await document.transact('host chooses meter document units',tx=>tx.setHeader('units','meter'))
  assert.ok(getKJDrawChatToolNames(document).includes('cad_propose_road_drawing'))
  await document.transact('host restores millimeter units',tx=>tx.setHeader('units','millimeter'))
  assert.equal(getKJDrawChatToolNames(document),KJDRAW_CHAT_TOOL_NAMES)
})
