import test from 'node:test'
import assert from 'node:assert/strict'
import { KJDRAW_CHAT_TOOL_NAMES, getKJDrawChatCapabilityForRequest, getKJDrawChatToolNames, getKJDrawChatToolNamesForRequest } from '../../../apps/playground/agent-chat.js'
import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../examples/fixtures/road-design.mjs'
import { buildRoadDrawing } from '../src/road-drawing.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { runKJAgentTask } from '../src/agent-runner.js'
import { KJAgentCapabilityRegistry } from '../src/agent-capabilities.js'
import { compileGeologyColumn } from '../src/geology-engineering.js'
import { readGeologyDrawingRecipe } from '../src/geology-drawing-update.js'

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

test('native geometry properties and caller revision frames cannot hide their edit tools behind text routing', async () => {
  const { document } = fixture()
  await document.transact('Native geometry', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0] }))
  for (const request of [
    'Set polyline width to 2. Public input: read native data at the current revision.',
    '把多段线的宽度设为2。Public synthetic task input: current revision.',
    'Set segment bulge to 0.25; preserve the note text and every other object.',
    '修改顶点坐标，不改变其余文字。',
    'Update LWPOLYLINE width and inspect its label field.',
  ]) {
    const selected = getKJDrawChatToolNamesForRequest(document, request)
    assert.ok(selected.includes('cad_propose_polyline_edit'), request)
    assert.ok(selected.includes('cad_read_drawing'), request)
  }
  assert.deepEqual(getKJDrawChatToolNamesForRequest(document,
    'Replace the project-name text; read native data at the current revision.'),
  ['cad_find_text', 'cad_query_drawing', 'cad_propose_text_edit'])
})

test('workbench exposes useful tools and creates ordinary geometry through pattern arrays=[]', async () => {
  const { session, document } = fixture()
  assert.ok(Object.isFrozen(KJDRAW_CHAT_TOOL_NAMES))
  assert.equal(KJDRAW_CHAT_TOOL_NAMES.length, 38)
  for (const name of ['cad_read_history', 'cad_propose_undo', 'cad_propose_redo']) assert.ok(KJDRAW_CHAT_TOOL_NAMES.includes(name))
  assert.ok(KJDRAW_CHAT_TOOL_NAMES.includes('cad_query_topology'))
  assert.ok(KJDRAW_CHAT_TOOL_NAMES.includes('cad_query_impact'))
  for (const [name, effect] of [['cad_read_hatch_patterns', 'read'], ['cad_propose_hatch_pattern', 'propose']]) {
    assert.equal(KJDRAW_CHAT_TOOL_NAMES.filter(item => item === name).length, 1)
    assert.equal(session.definitions.find(tool => tool.name === name)?.effect, effect)
  }
  assert.deepEqual(KJDRAW_CHAT_TOOL_NAMES.filter(name => name.startsWith('cad_propose_')), ['cad_propose_undo', 'cad_propose_redo', 'cad_propose_component_insert', 'cad_propose_design_bind', 'cad_propose_design_update', 'cad_propose_hatch_pattern', 'cad_propose_move', 'cad_propose_relayer', 'cad_propose_structural_edit', 'cad_propose_text_edit', 'cad_propose_set_circle_radius', 'cad_propose_copy', 'cad_propose_rotate', 'cad_propose_scale', 'cad_propose_offset', 'cad_propose_stretch', 'cad_propose_lengthen', 'cad_propose_polyline_edit', 'cad_propose_drawing_pattern', 'cad_propose_drawing_annotated', 'cad_propose_manufacturing_sheet', 'cad_propose_architecture_plan', 'cad_propose_cartesian_chart', 'cad_propose_geology_revision'])
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
  assert.equal(getKJDrawChatToolNamesForRequest(document,'Draw a plate outline.'),getKJDrawChatToolNames(document))
  await document.transact('existing geometry',tx=>tx.createEntity('LINE',{start:[0,0,0],end:[1,0,0]}))
  assert.equal(getKJDrawChatToolNamesForRequest(document,'Create a manufacturing drawing for a fixture plate.'),KJDRAW_CHAT_TOOL_NAMES)
})

test('explicit chart requests use one high-level compiler instead of per-entity generation', async () => {
  for (const prompt of ['Create a grouped bar chart with a target line.', '绘制季度产量柱状图和目标折线图。']) {
    const {document,session}=fixture(), toolNames=getKJDrawChatToolNamesForRequest(document,prompt)
    assert.deepEqual(toolNames,['cad_propose_cartesian_chart'])
    const capability=getKJDrawChatCapabilityForRequest(document,prompt)
    assert.equal(capability.descriptor.id,'builtin.cartesian-chart')
    const input={version:'1.0.0',expectedRevision:0,units:'millimeter',drawingId:'CHART-ROUTED',title:'QUARTERLY OUTPUT',categories:['Q1','Q2','Q3','Q4'],series:[{id:'actual',name:'Actual',kind:'bar',values:[82,96,91,108]},{id:'target',name:'Target',kind:'line',values:[90,90,100,100]}],showValues:true}
    const result=await runKJAgentTask({session,prompt,toolNames,capabilities:{registry:capability.registry,lock:capability.lock},model:modelCall('cad_propose_cartesian_chart',input,(tools,instructions)=>{assert.deepEqual(tools.map(tool=>tool.name),toolNames);assert.match(instructions,/Capability builtin\.cartesian-chart@1\.0\.0/);assert.match(instructions,/Do not emit axes, bars, points or text individually/)})})
    assert.equal(result.status,'awaiting-approval')
    const proposal=result.outputs[0].result.value
    assert.equal(proposal.engineeringEvidence.skillId,'cartesian-chart')
    assert.equal(document.listEntities().length,0)
    assert.equal((await session.approve(proposal.planId,'chart-reviewer')).ok,true)
    assert.ok(document.listEntities().length>20)
  }
  const {document}=fixture()
  await document.transact('existing geometry',tx=>tx.createEntity('LINE',{start:[0,0,0],end:[1,0,0]}))
  assert.equal(getKJDrawChatToolNamesForRequest(document,'绘制柱状图。'),KJDRAW_CHAT_TOOL_NAMES)
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

test('explicit title-block text edits on an existing drawing load only read and text-edit schemas', async () => {
  const { document } = fixture()
  await document.transact('existing text', tx => tx.createEntity('TEXT', { text: 'REV: A', position: [0, 0, 0], height: 3 }))
  const names = getKJDrawChatToolNamesForRequest(document, 'Change revision A to B in the existing title-block text.')
  assert.deepEqual(names, ['cad_find_text', 'cad_query_drawing', 'cad_propose_text_edit'])
})

test('read-only text inspection keeps discovery tools instead of forcing an edit proposal', async () => {
  const { document } = fixture()
  await document.transact('Inspection fixture', tx => tx.createEntity('TEXT', { text: 'ZK03', position: [0, 0, 0], height: 3 }))
  for (const prompt of [
    'Read the complete stored text. Do not change the drawing.',
    'Inspect this label without editing anything.',
    '先读一下孔号文字和图层，别改图。',
    '只读检查标题栏字段，不修改图纸。',
  ]) {
    const names = getKJDrawChatToolNamesForRequest(document, prompt)
    assert.ok(names.includes('cad_find_text'))
    assert.ok(names.includes('cad_query_drawing'))
    assert.ok(names.includes('cad_read_drawing'))
    assert.ok(names.every(name => !name.startsWith('cad_propose_')))
    assert.ok(names.length < KJDRAW_CHAT_TOOL_NAMES.length)
  }
})

test('workbench circle radius tool produces a reviewable exact native edit', async () => {
  const { document, session } = fixture()
  await document.transact('Radius fixture', tx => tx.createEntity('CIRCLE', { center: [2, 3, 0], radius: 4 }, { id: 'radius-target' }))
  const before = document.getObject('radius-target')
  const result = await runKJAgentTask({ session, prompt: 'Set the existing circle radius to 6 mm.', toolNames: KJDRAW_CHAT_TOOL_NAMES,
    model: modelCall('cad_propose_set_circle_radius', { expectedRevision: document.revision, units: 'millimeter', id: 'radius-target', radius: 6 }) })
  assert.equal(result.status, 'awaiting-approval')
  assert.deepEqual(document.getObject('radius-target'), before)
  assert.equal((await session.approve(result.proposalIds[0], 'radius-reviewer')).ok, true)
  assert.deepEqual(document.getObject('radius-target'), { ...before, payload: { ...before.payload, radius: 6 } })
  for (const prompt of ['Set the radius to 6 and preserve the label and revision field.', '将圆半径设为6毫米，修订字段不改。']) {
    assert.equal(getKJDrawChatToolNamesForRequest(document, prompt), KJDRAW_CHAT_TOOL_NAMES)
  }
})

test('single label translation loads read, query and move schemas without a host selection', async () => {
  const { document } = fixture()
  await document.transact('existing labels', tx => tx.createEntity('TEXT', { text: 'TOP VIEW', position: [0, 0, 0], height: 3 }))
  const names = getKJDrawChatToolNamesForRequest(document, 'Move the existing TOP VIEW label up by exactly 2 millimeters. Keep geometry unchanged.')
  assert.deepEqual(names, ['cad_find_text', 'cad_query_drawing', 'cad_propose_move'])
})

test('annotation-only policies avoid whole-page reads without narrowing compound edits', async () => {
  const { document, session } = fixture()
  await document.transact('existing labels', tx => tx.createEntity('TEXT', { text: 'ZK03', position: [0, 0, 0], height: 3 }))
  for (const prompt of [
    '把孔号标注“ZK03”改成“ZK03-A”。仅修改这个文字对象，不调整孔的几何或数据。',
    '把孔号标注“ZK03”沿 X 移动 2、沿 Y 移动 0，只移动这一个文字对象。',
  ]) {
    const names = getKJDrawChatToolNamesForRequest(document, prompt)
    assert.equal(names.includes('cad_read_drawing'), false)
    assert.ok(names.includes('cad_find_text'))
    assert.ok(names.includes('cad_query_drawing'))
    assert.equal(names.length, 3)
    const result = await runKJAgentTask({ session, prompt, toolNames: names,
      model: modelCall('cad_read_drawing', { expectedRevision: document.revision }),
    })
    assert.equal(result.error.code, 'KJAGENT_TOOL_NOT_ALLOWED')
    assert.equal(result.toolCalls, 0)
  }
  for (const prompt of [
    'Change the text label and rotate its leader.',
    'Move the label and copy the adjacent circle.',
    '修改文字并添加一个孔。',
  ]) assert.equal(getKJDrawChatToolNamesForRequest(document, prompt), KJDRAW_CHAT_TOOL_NAMES)
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
  assert.ok(Object.isFrozen(names)); assert.equal(names.length,KJDRAW_CHAT_TOOL_NAMES.length+1)
  assert.equal(names.includes('cad_propose_geology_column'),false)
  assert.equal(names.includes('cad_propose_geology_section'),false)
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
  assert.ok(Object.isFrozen(toolNames)); assert.deepEqual(toolNames,[...KJDRAW_CHAT_TOOL_NAMES.filter(name=>!['cad_propose_manufacturing_sheet','cad_propose_architecture_plan','cad_propose_cartesian_chart','cad_read_geology_source','cad_propose_geology_revision'].includes(name)),'cad_propose_site_plan','cad_propose_road_drawing'])
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
  const blankPolicy=getKJDrawChatToolNames(document)
  assert.equal(blankPolicy.includes('cad_propose_road_drawing'),false)
  const result=await runKJAgentTask({session,prompt:'Request a road in an incompatible document.',toolNames:getKJDrawChatToolNames(document),
    model:modelCall('cad_propose_road_drawing',{...createRoadDesignFixture(),...roadDrawingFixtureOptions,expectedRevision:0})})
  assert.equal(result.status,'failed');assert.equal(result.error.code,'KJAGENT_TOOL_NOT_ALLOWED');assert.equal(result.toolCalls,0)
  assert.equal(document.revision,0)
  await document.transact('host chooses meter document units',tx=>tx.setHeader('units','meter'))
  assert.ok(getKJDrawChatToolNames(document).includes('cad_propose_road_drawing'))
  await document.transact('host restores millimeter units',tx=>tx.setHeader('units','millimeter'))
  assert.equal(getKJDrawChatToolNames(document),blankPolicy)
})

async function retainedSourcePolicyFixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const source = { kind: 'column', input: { expectedRevision: 0, units: 'millimeter', locale: 'en', hole: {
    id: 'PUBLIC-POLICY-A', collarElevation: 106.5, depth: 18,
    strata: [
      { intervalId: 'I-FILL', code: '1', name: 'Fill', lithology: 'fill', top: 0, bottom: 3 },
      { intervalId: 'I-CLAY', code: '2', name: 'Clay', lithology: 'clay', top: 3, bottom: 10 },
      { intervalId: 'I-SAND', code: '3', name: 'Sand', lithology: 'sand', top: 10, bottom: 18 },
    ],
  } } }
  const compiled = compileGeologyColumn(source.input)
  await sdk.executeCommand('CREATEBATCH', { ...structuredClone(compiled.commandArgs), geologySource: source }, { document })
  await document.transact('Manual policy context', tx => {
    tx.createEntity('TEXT', { text: 'REV: A', position: [220, 220, 0], height: 3 }, { id: 'manual-policy-label' })
    tx.createEntity('CIRCLE', { center: [220, 230, 0], radius: 3 }, { id: 'manual-policy-circle' })
  })
  const recipe = readGeologyDrawingRecipe(document, compiled.evidence.rootObjectId)
  assert.deepEqual(recipe.source, source)
  return { sdk, document, drawingId: recipe.drawingId }
}

test('actual retained source keeps source tools alongside every narrowed CAD mutation policy', async () => {
  const { sdk, document } = await retainedSourcePolicyFixture()
  try {
    const before = document.serialize()
    for (const [prompt, selectedIds, requiredCadTools] of [
      ['Set I-CLAY description to Brownish yellow, plastic with descriptionSource=interval. Read native data at the current revision before acting.', [], ['cad_find_text', 'cad_query_drawing', 'cad_propose_text_edit']],
      ['Set I-SAND patternVisibility to boundary-only, removing its fill but retaining its name and boundaries. Read native data at the current revision before acting.', [], ['cad_find_text', 'cad_query_drawing', 'cad_propose_text_edit']],
      ['Change the manual label from REV: A to REV: B.', [], ['cad_find_text', 'cad_query_drawing', 'cad_propose_text_edit']],
      ['Move the manual label up by exactly 2 millimeters.', [], ['cad_find_text', 'cad_query_drawing', 'cad_propose_move']],
      ['Move the selected object 5 mm right.', ['manual-policy-circle'], ['cad_propose_move']],
      ['Change the label without modifying any other source fields.', [], []],
    ]) {
      const names = getKJDrawChatToolNamesForRequest(document, prompt, selectedIds)
      assert.ok(Object.isFrozen(names), prompt)
      assert.equal(new Set(names).size, names.length, prompt)
      for (const name of [...requiredCadTools, 'cad_read_geology_source', 'cad_propose_geology_revision']) assert.ok(names.includes(name), `${prompt}: ${name}`)
    }
    assert.equal(document.serialize(), before, 'routing never mutates the recipe or executes a request')
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
})

test('explicit read-only retained-source requests expose source reads without a source mutation policy', async () => {
  const { sdk, document } = await retainedSourcePolicyFixture()
  try {
    for (const prompt of [
      'Read I-CLAY descriptionSource and I-SAND patternVisibility. Do not change the drawing.',
      'Inspect the stored source fields without editing anything.',
      'Read-only: what source facts are stored at the current revision?',
      '只读查看孔口高程和地层源记录，别改图。',
    ]) {
      const names = getKJDrawChatToolNamesForRequest(document, prompt)
      assert.ok(names.includes('cad_read_geology_source'), prompt)
      assert.equal(names.some(name => name.startsWith('cad_propose_')), false, prompt)
      assert.ok(names.includes('cad_query_drawing'), 'read discovery remains available')
    }
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
})

test('geometry-only DXF labels do not supply a retained source recipe or expand a narrowed policy', async () => {
  const { sdk, document, drawingId } = await retainedSourcePolicyFixture()
  try {
    const imported = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
    assert.equal(Object.keys(imported.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:')), false)
    const prompt = 'Set I-CLAY descriptionSource to interval. Read native data at the current revision before acting.'
    const names = getKJDrawChatToolNamesForRequest(imported, prompt)
    assert.deepEqual(names, ['cad_find_text', 'cad_query_drawing', 'cad_propose_text_edit'])
    const session = new KJAgentToolSession(sdk, imported), before = imported.serialize()
    const read = await session.call('cad_read_geology_source', { expectedRevision: imported.revision, drawingId, maxBytes: 262144 })
    assert.equal(read.ok, false, 'a visible drawing label is not a source recipe')
    const proposed = await session.call('cad_propose_geology_revision', { expectedRevision: imported.revision, units: 'millimeter', drawingId,
      updates: [{ holeId: 'PUBLIC-POLICY-A', collarElevation: 107 }] })
    assert.equal(proposed.ok, false)
    assert.equal(imported.serialize(), before)
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
})
