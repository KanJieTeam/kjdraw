import test from 'node:test'
import assert from 'node:assert/strict'
import { KJDRAW_CHAT_TOOL_NAMES, getKJDrawChatToolNames } from '../../../apps/playground/agent-chat.js'
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
  return { next: async () => ({ text: '', calls: [{ id: 'call-1', name, arguments: args }] }) }
} })

test('workbench exposes fourteen useful tools and creates ordinary geometry through pattern arrays=[]', async () => {
  const { session, document } = fixture()
  assert.ok(Object.isFrozen(KJDRAW_CHAT_TOOL_NAMES))
  assert.equal(KJDRAW_CHAT_TOOL_NAMES.length, 14)
  assert.deepEqual(KJDRAW_CHAT_TOOL_NAMES.filter(name => name.startsWith('cad_propose_')), ['cad_propose_move', 'cad_propose_rotate', 'cad_propose_scale', 'cad_propose_stretch', 'cad_propose_lengthen', 'cad_propose_polyline_edit', 'cad_propose_drawing_pattern', 'cad_propose_drawing_annotated'])
  const args = { expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [[3, 4, 2]], arcs: [], polylines: [], arrays: [] }
  const result = await runKJAgentTask({ session, prompt: 'Draw a line and circle.', toolNames: KJDRAW_CHAT_TOOL_NAMES,
    model: modelCall('cad_propose_drawing_pattern', args, tools => assert.deepEqual(tools.map(item => item.name).sort(), [...KJDRAW_CHAT_TOOL_NAMES].sort())) })
  assert.equal(result.status, 'awaiting-approval')
  assert.equal(document.revision, 0)
  assert.equal(result.outputs[0].result.value.preview.after.length, 2)
  assert.equal((await session.approve(result.proposalIds[0], 'reviewer')).ok, true)
  assert.deepEqual(document.listEntities({ type: 'CIRCLE' })[0].payload.center, [3, 4, 0])
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
  assert.ok(Object.isFrozen(toolNames)); assert.deepEqual(toolNames,[...KJDRAW_CHAT_TOOL_NAMES,'cad_propose_road_drawing'])
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
