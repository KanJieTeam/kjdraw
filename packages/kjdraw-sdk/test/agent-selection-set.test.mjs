import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentTaskToolBinding } from '../src/agent-task-runner.js'
import { createAgentTask, readAgentTasks, transitionAgentTask } from '../src/agent-tasks.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJModelAdapter } from '../src/model-adapters.js'
import { createKJDrawSDK } from '../src/sdk.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const readArgs = document => ({ expectedRevision: document.revision, offset: 0, limit: 20, maxBytes: 65536 })
const moveArgs = (document, change = {}) => ({ expectedRevision: document.revision, units: 'millimeter', selectionSetName: 'FRAME', dx: 5, dy: -2, ...change })
const transformArgs = (document, name, change = {}) => ({ expectedRevision: document.revision, units: 'millimeter', selectionSetName: 'FRAME', center: { x: 0, y: 0 }, ...(name === 'cad_propose_rotate' ? { angleDegrees: 90 } : { factor: 2 }), ...change })

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: `selection-agent-${Math.random()}`, units: 'millimeter' })
  await document.transact('Seed selection geometry', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [20, 0, 0] }, { id: 'edge-a' })
    tx.createEntity('CIRCLE', { center: [10, 10, 0], radius: 3 }, { id: 'hole-a' })
    tx.createEntity('LINE', { start: [100, 0, 0], end: [120, 0, 0] }, { id: 'outside' })
  })
  await sdk.getSelectionManager(document.id).saveNamed('Frame', { ids: ['edge-a', 'hole-a'], description: 'Untrusted drawing label' })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}

test('agent discovers a bounded named selection and moves its exact members through preview/approval/undo/redo/KJD', async () => {
  const { sdk, document, session } = await fixture()
  const context = value(await session.call('cad_read_selection_sets', readArgs(document)))
  assert.equal(context.total, 1)
  assert.deepEqual(context.selectionSets, [{
    id: context.selectionSets[0].id, name: 'Frame', nameOmitted: false, description: 'Untrusted drawing label', descriptionOmitted: false,
    memberCount: 2, memberIds: ['edge-a', 'hole-a'], memberIdsOmitted: false, membershipValid: true,
  }])
  const before = document.serialize(), revision = document.revision, group = document.getObject(context.selectionSets[0].id)
  const rejected = value(await session.call('cad_propose_move', moveArgs(document)))
  assert.equal(document.serialize(), before)
  assert.deepEqual(rejected.arguments.ids, ['edge-a', 'hole-a'])
  assert.deepEqual(rejected.selectionSet, { id: group.id, name: 'Frame', memberIds: ['edge-a', 'hole-a'] })
  value(session.reject(rejected.planId, 'host-reviewer'))
  assert.equal(document.serialize(), before)

  const proposal = value(await session.call('cad_propose_move', moveArgs(document)))
  const receipt = value(await session.approve(proposal.planId, 'host-reviewer'))
  assert.equal(receipt.afterRevision, revision + 1)
  assert.deepEqual(document.getObject('edge-a').payload.start, [5, -2, 0])
  assert.deepEqual(document.getObject('hole-a').payload.center, [15, 8, 0])
  assert.deepEqual(document.getObject('outside').payload.start, [100, 0, 0])
  assert.deepEqual(document.getObject(group.id).payload.memberIds, ['edge-a', 'hole-a'])
  await document.undo()
  assert.deepEqual(document.getObject('edge-a').payload.start, [0, 0, 0])
  assert.deepEqual(document.getObject(group.id), group)
  await document.redo()
  assert.deepEqual(document.getObject('edge-a').payload.start, [5, -2, 0])
  assert.deepEqual(document.getObject(group.id).payload.memberIds, ['edge-a', 'hole-a'])

  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(reopened.getObject('edge-a').payload.start, [5, -2, 0])
  assert.deepEqual(reopened.listObjects({ kind: 'group', type: 'SELECTION_SET' }).map(row => [row.name, row.payload.memberIds]), [['Frame', ['edge-a', 'hole-a']]])
})

for (const [toolName, command] of [['cad_propose_rotate', 'ROTATE'], ['cad_propose_scale', 'SCALE']]) test(`${command} resolves a named block selection and retains complete dependencies, history and KJD`, async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: `selection-${command.toLowerCase()}`, units: 'millimeter' })
  await document.transact('Seed selected block', tx => {
    const block = tx.upsertTableRecord('blockRecords', { id: 'pump-block', name: 'PUMP', payload: { basePoint: [0, 0, 0], entityIds: [] } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [20, 0, 0] }, { id: 'block-edge', ownerId: block.id })
    tx.createEntity('INSERT', { blockRecordId: block.id, position: [10, 5, 0], scale: [1, 1, 1] }, { id: 'pump' })
  })
  const group = await sdk.getSelectionManager(document.id).saveNamed('Frame', { ids: ['pump'] })
  const session = new KJAgentToolSession(sdk, document), before = document.serialize(), original = document.getObject('pump')
  const proposal = value(await session.call(toolName, transformArgs(document, toolName)))
  assert.equal(document.serialize(), before)
  assert.equal(proposal.command, command)
  assert.deepEqual(proposal.arguments.ids, ['pump'])
  assert.deepEqual(proposal.selectionSet, { id: group.id, name: 'Frame', memberIds: ['pump'] })
  assert.deepEqual(proposal.preview.blockDependencies.find(row => row.id === 'block-edge').payload, document.getObject('block-edge').payload)
  value(await session.approve(proposal.planId, 'host-reviewer'))
  const accepted = document.getObject('pump')
  if (command === 'ROTATE') {
    assert.ok(Math.abs(accepted.payload.position[0] + 5) < 1e-9)
    assert.ok(Math.abs(accepted.payload.position[1] - 10) < 1e-9)
    assert.ok(Math.abs(accepted.payload.rotation - Math.PI / 2) < 1e-9)
  } else {
    assert.deepEqual(accepted.payload.position, [20, 10, 0])
    assert.deepEqual(accepted.payload.scale, [2, 2, 2])
  }
  assert.deepEqual(document.getObject(group.id).payload.memberIds, ['pump'])
  await document.undo(); assert.deepEqual(document.getObject('pump'), original)
  await document.redo(); assert.deepEqual(document.getObject('pump'), accepted)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  for (const field of ['blockRecordId', 'position', 'scale', 'rotation']) assert.deepEqual(reopened.getObject('pump').payload[field], accepted.payload[field])
  assert.deepEqual(reopened.getObject(group.id).payload.memberIds, ['pump'])
})

test('selection-set MOVE rejects ambiguous targets, malformed membership, protection and stale approval without moving geometry', async () => {
  const { sdk, document, session } = await fixture()
  const initial = document.serialize()
  for (const change of [
    { selectionSetName: undefined },
    { ids: ['edge-a'] },
    { selectionSetName: 'missing' },
    { selectionSetName: 'x'.repeat(129) },
  ]) {
    const args = moveArgs(document, change)
    if (Object.hasOwn(change, 'selectionSetName') && change.selectionSetName === undefined) delete args.selectionSetName
    assert.equal((await session.call('cad_propose_move', args)).ok, false)
    assert.equal(document.serialize(), initial)
  }

  await document.transact('Malformed and protected selections', tx => {
    const locked = tx.upsertTableRecord('layers', { id: 'locked-layer', name: 'LOCKED', payload: { locked: true } })
    tx.createEntity('LINE', { start: [0, 20, 0], end: [20, 20, 0], layerId: locked.id }, { id: 'locked-edge' })
    tx.createObject({ kind: 'group', type: 'SELECTION_SET', name: 'Repeated', payload: { memberIds: ['edge-a', 'edge-a'] } })
    tx.createObject({ kind: 'group', type: 'SELECTION_SET', name: 'Protected', payload: { memberIds: ['edge-a', 'locked-edge'] } })
    tx.createObject({ kind: 'group', type: 'SELECTION_SET', name: 'Ambiguous', payload: { memberIds: ['edge-a'] } })
    tx.createObject({ kind: 'group', type: 'SELECTION_SET', name: 'ambiguous', payload: { memberIds: ['hole-a'] } })
  })
  const protectedSource = document.serialize()
  for (const selectionSetName of ['Repeated', 'Protected', 'Ambiguous']) {
    assert.equal((await session.call('cad_propose_move', moveArgs(document, { selectionSetName }))).ok, false)
    assert.equal(document.serialize(), protectedSource)
  }
  const context = value(await session.call('cad_read_selection_sets', readArgs(document)))
  assert.equal(context.selectionSets.find(row => row.name === 'Repeated').membershipValid, false)
  for (const toolName of ['cad_propose_rotate', 'cad_propose_scale']) {
    for (const change of [{ selectionSetName: 'missing' }, { selectionSetName: 'Protected' }, { ids: ['edge-a'] }]) {
      assert.equal((await session.call(toolName, transformArgs(document, toolName, change))).ok, false)
      assert.equal(document.serialize(), protectedSource)
    }
    const noTarget = transformArgs(document, toolName); delete noTarget.selectionSetName
    assert.equal((await session.call(toolName, noTarget)).ok, false)
    assert.equal(document.serialize(), protectedSource)
  }

  const proposal = value(await session.call('cad_propose_move', moveArgs(document)))
  await sdk.getSelectionManager(document.id).saveNamed('Frame', { ids: ['edge-a'] })
  const stale = document.serialize()
  assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
  assert.equal(document.serialize(), stale)
  assert.deepEqual(document.getObject('edge-a').payload.start, [0, 0, 0])
})

test('persisted task approval accepts named-set MOVE, ROTATE and SCALE through their atomic receipt paths', async () => {
  for (const [toolName, command, expectedLength] of [['cad_propose_move', 'MOVE', 20], ['cad_propose_rotate', 'ROTATE', 20], ['cad_propose_scale', 'SCALE', 40]]) {
    const { sdk, document, session } = await fixture()
    const tools = createAgentTaskToolBinding(session.definitions, ['cad_check_geometry', toolName])
    const actor = { kind: 'host', id: 'selection-task-host' }
    const definition = {
      requirements: [{ id: 'edge-length', description: 'The transformed edge has its exact required length.', check: { toolName: 'cad_check_geometry', assertion: { path: 'passed', operator: 'is_true', expected: true }, geometryCheck: { id: 'edge-length', kind: 'line-length', objectId: 'edge-a', expected: expectedLength, tolerance: 1e-9 } } }],
      steps: [{ id: 'transform-frame', title: 'Transform the named frame selection', requirementIds: ['edge-length'] }], tools, capabilities: [],
    }
    await document.transact('Create named selection task', tx => createAgentTask(document, tx, { id: 'selection-task', expectedRevision: document.revision, title: `Apply ${command}`, goal: `Apply ${command} to the saved Frame selection.`, entityIds: ['edge-a', 'hole-a'], definition, at: '2026-09-13T08:00:00.000Z', actor }))
    for (const [status, at] of [['ready', '2026-09-13T08:00:01.000Z'], ['running', '2026-09-13T08:00:02.000Z']]) {
      const task = readAgentTasks(document)[0]
      await document.transact(`Task ${status}`, tx => transitionAgentTask(document, tx, { id: task.id, expectedRevision: document.revision, expectedTaskVersion: task.taskVersion, expectedStatus: task.status, to: status, at, actor, reason: `Task ${status}` }))
    }
    const task = readAgentTasks(document)[0], proposal = value(await session.call(toolName, toolName === 'cad_propose_move' ? moveArgs(document) : transformArgs(document, toolName)))
    session.bindTaskProposal(proposal.planId, { taskId: task.taskId, taskVersion: task.taskVersion, taskStatus: 'running', documentRevision: document.revision, units: task.units, scopeSha256: task.scope.sha256, toolApiVersion: task.definition.tools.apiVersion, toolNames: [...task.definition.tools.names], toolContractHash: task.definition.tools.contractHash, capabilityLocks: [] })
    const approved = value(await session.approveTask(proposal.planId, 'host-reviewer', '2026-09-13T08:00:03.000Z'))
    assert.equal(approved.command, command)
    assert.equal(readAgentTasks(document)[0].status, 'completed')
    assert.equal(readAgentTasks(document)[0].receipts[0].sourceToolName, toolName)
    const accepted = document.getObject('edge-a'), length = Math.hypot(...accepted.payload.end.map((coordinate, index) => coordinate - accepted.payload.start[index]))
    assert.ok(Math.abs(length - expectedLength) < 1e-9)
    await document.undo()
    assert.equal(readAgentTasks(document)[0].status, 'running')
    assert.deepEqual(document.getObject('edge-a').payload.start, [0, 0, 0])
    assert.deepEqual(document.getObject('edge-a').payload.end, [20, 0, 0])
    await document.redo()
    assert.equal(readAgentTasks(document)[0].status, 'completed')
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
    assert.equal(readAgentTasks(reopened)[0].receipts[0].sourceToolName, toolName)
    assert.deepEqual(reopened.getObject('edge-a').payload.start, accepted.payload.start)
    assert.deepEqual(reopened.getObject('edge-a').payload.end, accepted.payload.end)
  }
})

test('selection-set read and transform schemas serialize identically across all four model protocols without model claims', async () => {
  const { session } = await fixture(), names = ['cad_read_selection_sets', 'cad_propose_move', 'cad_propose_rotate', 'cad_propose_scale']
  const expected = new Map(session.definitions.filter(tool => names.includes(tool.name)).map(tool => [tool.name, tool.inputSchema]))
  for (const protocol of ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']) {
    let body
    const model = createKJModelAdapter({ protocol, model: 'schema-inspection-only', request: async request => { body = request.body; throw new Error('schema captured') } })
    const conversation = model.createConversation({ instructions: 'Inspect schemas only.', tools: session.definitions.filter(tool => names.includes(tool.name)) })
    await assert.rejects(conversation.next({ kind: 'prompt', text: 'No model execution.' }, new AbortController().signal), /schema captured/)
    const definitions = protocol === 'responses' ? body.tools
      : protocol === 'chat-completions' ? body.tools.map(tool => tool.function)
        : protocol === 'anthropic-messages' ? body.tools.map(tool => ({ ...tool, parameters: tool.input_schema }))
          : body.tools[0].functionDeclarations.map(tool => ({ ...tool, parameters: tool.parametersJsonSchema }))
    for (const name of names) assert.deepEqual(definitions.find(tool => tool.name === name).parameters, expected.get(name), `${protocol} ${name}`)
    for (const [name, required, properties] of [
      ['cad_propose_move', ['expectedRevision', 'units', 'dx', 'dy'], ['dx', 'dy', 'expectedRevision', 'ids', 'selectionSetName', 'units']],
      ['cad_propose_rotate', ['expectedRevision', 'units', 'center', 'angleDegrees'], ['angleDegrees', 'center', 'expectedRevision', 'ids', 'selectionSetName', 'units']],
      ['cad_propose_scale', ['expectedRevision', 'units', 'center', 'factor'], ['center', 'expectedRevision', 'factor', 'ids', 'selectionSetName', 'units']],
    ]) {
      const schema = definitions.find(tool => tool.name === name).parameters
      assert.deepEqual(schema.required, required)
      assert.deepEqual(Object.keys(schema.properties).sort(), properties)
      assert.equal(schema.additionalProperties, false)
    }
  }
})
