import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { buildAgentAnnotationEntities as compile } from '../src/agent-annotations.js'
import { projectDimension } from '../src/geometry/annotation.js'
import { createKJModelAdapter } from '../src/model-adapters.js'
import { runKJAgentTask } from '../src/agent-runner.js'

const tool = 'cad_propose_drawing_annotated'
const ref = (id, feature, source = 'proposal', vertexIndex) => ({ source, id, feature, ...(vertexIndex === undefined ? {} : { vertexIndex }) })
const empty = () => ({ expectedRevision: 0, units: 'millimeter', lines: [], circles: [], arcs: [], polylines: [], arrays: [], styles: [], texts: [], alignedDimensions: [], rotatedDimensions: [], radiusDimensions: [], diameterDimensions: [] })
const angle = (position = { x: 4, y: 4 }) => ({ center: ref('lines:0', 'start'), first: ref('lines:0', 'end'), second: ref('lines:1', 'end'), position, height: 1 })
const drawing = () => ({ ...empty(), lines: [[0, 0, 10, 0], [0, 0, 0, 10]], angularDimensions: [angle(), angle({ x: -7, y: -7 })] })
const fixture = () => { const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }); return { sdk, document, session: new KJAgentToolSession(sdk, document) } }
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const measures = document => document.listEntities({ type: 'DIMENSION', ownerId: document.snapshot().spaces.modelSpaceId }).map(entity => projectDimension(entity.payload).measurement).sort((a, b) => a - b)

test('three-point angles measure actual referenced rays and select minor/reflex sectors without numeric labels', async () => {
  const { sdk, document, session } = fixture(), before = document.serialize(), input = drawing()
  input.styles = [{ name: 'Angular_Dimensions', sources: ['angularDimensions:0', 'angularDimensions:1'], pattern: [], color: 2, lineweight: 18 }]
  const plan = value(await session.call(tool, input))
  assert.equal(document.serialize(), before)
  const dimensions = plan.preview.after.filter(entity => entity.type === 'DIMENSION')
  assert.deepEqual(dimensions.map(entity => projectDimension(entity.payload).measurement), [90, 270])
  assert.deepEqual(dimensions.map(entity => projectDimension(entity.payload).label.text), ['90°', '270°'])
  for (const entity of dimensions) {
    assert.equal(entity.payload.dimensionType, 'ANGULAR_3_POINT')
    assert.equal(entity.payload.measurement, null); assert.equal(entity.payload.textOverride, null)
    assert.equal(entity.payload.definitionPoints.length, 4)
    assert.equal(plan.arguments.entities.find(item => item.options.id === entity.id).options.ownerId, document.snapshot().spaces.modelSpaceId)
    assert.equal(projectDimension(entity.payload).arcs.length, 1)
    assert.ok(Object.isFrozen(entity.payload.definitionPoints[0]))
  }
  assert.deepEqual(dimensions[0].payload.definitionPoints, [[4, 4, 0], [10, 0, 0], [0, 10, 0], [0, 0, 0]])
  assert.equal((await session.call('approve', { planId: plan.planId })).ok, false)
  const receipt = value(await session.approve(plan.planId, 'native-angle-reviewer'))
  assert.equal(receipt.afterRevision - receipt.beforeRevision, 1)
  for (const expected of plan.preview.after) assert.deepEqual(document.getObject(expected.id).payload, expected.payload)
  const approved = document.listEntities().map(entity => JSON.stringify(entity))
  assert.ok(dimensions.every(entity => document.getObject(document.getObject(entity.id).payload.layerId).name === 'Angular_Dimensions'))
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    assert.deepEqual(measures(reopened), [90, 270])
    assert.deepEqual(reopened.listEntities({ type: 'DIMENSION', ownerId: reopened.snapshot().spaces.modelSpaceId }).map(entity => entity.payload.dimensionType), ['ANGULAR_3_POINT', 'ANGULAR_3_POINT'])
  }
  await document.undo(); assert.equal(document.listEntities().length, 0); assert.equal(document.getTable('layers').records.some(layer => layer.name === 'Angular_Dimensions'), false)
  await document.redo(); assert.deepEqual(document.listEntities().map(entity => JSON.stringify(entity)), approved)
})

test('legacy annotated calls omit angularDimensions; supplied angular groups remain strictly validated', async () => {
  const { document, session } = fixture()
  const legacy = { ...empty(), texts: [{ text: 'Existing client', position: { x: 0, y: 0 }, height: 1, rotationDegrees: 0 }] }
  assert.equal(value(await session.call(tool, legacy)).preview.after.length, 1)
  const cases = []
  for (const key of ['center', 'first', 'second', 'position', 'height']) { const input = drawing(); delete input.angularDimensions[0][key]; cases.push(input) }
  for (const key of ['measurement', 'textOverride', 'angleDegrees', 'type', 'rotationDegrees']) { const input = drawing(); input.angularDimensions[0][key] = 90; cases.push(input) }
  for (const bad of [null, {}, '90', [null]]) cases.push({ ...drawing(), angularDimensions: bad })
  const unknown = drawing(); unknown.angularDimensions[0].first.extra = 'ignored'; cases.push(unknown)
  const before = document.serialize()
  for (const input of cases) { assert.equal((await session.call(tool, input)).ok, false, JSON.stringify(input)); assert.equal(document.serialize(), before) }
})

test('degenerate, missing, out-of-plane, foreign-owner and invalid angular references reject without editing', async () => {
  const { document, session } = fixture(), cases = []
  let input = drawing(); input.angularDimensions[0].first = input.angularDimensions[0].center; cases.push(input)
  input = drawing(); input.angularDimensions[0].second = input.angularDimensions[0].first; cases.push(input)
  for (const position of [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }]) { input = drawing(); input.angularDimensions[0].position = position; cases.push(input) }
  input = drawing(); input.angularDimensions[0].center.id = 'lines:9'; cases.push(input)
  input = drawing(); input.angularDimensions[0].first.feature = 'center'; cases.push(input)
  input = drawing(); input.angularDimensions[0].center = { x: 0, y: 0 }; cases.push(input)
  input = drawing(); input.angularDimensions[0].height = 1e7; cases.push(input)
  input = drawing(); input.angularDimensions[0].position = { x: 1e12 + 1, y: 1 }; cases.push(input)
  input = drawing(); input.angularDimensions[0].position = { x: 1e12, y: 1e12 }; cases.push(input)
  await document.transact('Invalid reference fixtures', tx => {
    tx.createEntity('LINE', { start: [0, 0, 1], end: [0, 10, 1] }, { id: 'raised' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [0, 10, 0], normal: [0, 1, 0] }, { id: 'tilted' })
    const layout = tx.createLayout({ name: 'Paper' })
    tx.createEntity('LINE', { start: [0, 0], end: [0, 10] }, { id: 'paper', ownerId: layout.payload.blockRecordId })
    const block = tx.upsertTableRecord('blockRecords', { name: 'Other space', payload: { basePoint: [0, 0, 0], entityIds: [] } })
    tx.createEntity('LINE', { start: [0, 0], end: [0, 10] }, { id: 'block', ownerId: block.id })
  })
  for (const id of ['raised', 'tilted', 'paper', 'block', 'not-found']) { input = drawing(); input.angularDimensions[0].second = ref(id, 'end', 'document'); cases.push(input) }
  const before = document.serialize()
  for (const input of cases) { input.expectedRevision = document.revision; const result = await session.call(tool, input); assert.equal(result.ok, false, JSON.stringify(input)); assert.equal(document.serialize(), before) }
})

test('document references, polyline vertices and arc endpoints resolve real angular anchors', async () => {
  const { document, session } = fixture()
  await document.transact('Real anchors', tx => {
    tx.createEntity('LWPOLYLINE', { vertices: [[3, 2], [13, 2], [3, 12]], closed: true }, { id: 'triangle' })
    tx.createEntity('ARC', { center: [3, 2], radius: 10, startAngle: 0, endAngle: Math.PI / 2 }, { id: 'arc' })
  })
  const input = { ...empty(), expectedRevision: document.revision, angularDimensions: [{ center: ref('triangle', 'vertex', 'document', 0), first: ref('arc', 'start', 'document'), second: ref('arc', 'end', 'document'), position: { x: 7, y: 6 }, height: 1 }] }
  const before = document.serialize(), plan = value(await session.call(tool, input))
  assert.equal(plan.preview.after.length, 1); assert.equal(projectDimension(plan.preview.after[0].payload).measurement, 90)
  assert.equal(document.serialize(), before)
  input.angularDimensions[0].first.feature = 'bottom'
  assert.equal((await session.call(tool, input)).ok, false, 'cannot anchor outside actual arc sweep')
})

test('protected entity and layer references reject in both direct compiler and reviewed tool', async () => {
  for (const property of ['visible', 'locked', 'frozen']) for (const target of ['entity', 'layer']) {
    const { document, session } = fixture()
    await document.transact('Protected geometry', tx => {
      const flag = { [property]: property !== 'visible' }
      const layerId = target === 'layer' ? tx.upsertTableRecord('layers', { name: 'Protected', payload: flag }).id : undefined
      tx.createEntity('LINE', { start: [0, 0], end: [0, 10], ...(target === 'entity' ? flag : { layerId }) }, { id: 'protected' })
      tx.createEntity('LINE', { start: [0, 0], end: [10, 0] }, { id: 'horizontal' })
    })
    const item = { ...angle(), center: ref('horizontal', 'start', 'document'), first: ref('horizontal', 'end', 'document'), second: ref('protected', 'end', 'document') }
    const before = document.serialize()
    assert.throws(() => compile(document, { expectedRevision: document.revision, units: 'millimeter', texts: [], dimensions: [{ ...item, type: 'ANGULAR_3_POINT' }] }), /visible|protected/)
    assert.equal((await session.call(tool, { ...empty(), expectedRevision: document.revision, angularDimensions: [item] })).ok, false)
    assert.equal(document.serialize(), before)
  }
})

test('angle annotations share total annotation/entity budgets and cannot bypass revision, unit or approval isolation', async () => {
  const { document, session } = fixture(), cases = []
  let input = drawing(); input.angularDimensions = Array.from({ length: 64 }, () => angle()); input.texts = [{ text: 'one too many', position: { x: 1, y: 1 }, height: 1, rotationDegrees: 0 }]; cases.push(input)
  input = drawing(); input.arrays = [{ sources: ['lines:0'], rows: 1, columns: 511, dx: 20, dy: 0 }]; cases.push(input)
  input = drawing(); input.expectedRevision = 10; cases.push(input)
  input = drawing(); input.units = 'meter'; cases.push(input)
  const before = document.serialize()
  for (const input of cases) { assert.equal((await session.call(tool, input)).ok, false); assert.equal(document.serialize(), before) }
  const plan = value(await session.call(tool, drawing()))
  const other = fixture(); assert.equal((await other.session.approve(plan.planId, 'reviewer')).ok, false)
  await document.transact('Concurrent edit', tx => tx.createEntity('CIRCLE', { center: [100, 100], radius: 1 }))
  assert.equal((await session.approve(plan.planId, 'reviewer')).ok, false); assert.equal(document.listEntities({ type: 'DIMENSION' }).length, 0)
})

const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
function wire(protocol, args) {
  const id = 'angle-call'
  if (protocol === 'responses') return { status: 'completed', output: [{ type: 'function_call', id, call_id: id, name: tool, arguments: JSON.stringify(args) }] }
  if (protocol === 'chat-completions') return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', id, function: { name: tool, arguments: JSON.stringify(args) } }] } }] }
  if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: tool, input: args }] }
  return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { id, name: tool, args } }] } }] }
}
for (const protocol of protocols) test(protocol + ': optional angular schema preserves old calls and rejects invalid model arguments', async () => {
  for (const mode of ['angular', 'legacy', 'invalid']) {
    const { document, session } = fixture(), before = document.serialize()
    const input = mode === 'legacy' ? { ...empty(), texts: [{ text: 'Legacy note', position: { x: 0, y: 0 }, height: 1, rotationDegrees: 0 }] } : drawing()
    if (mode === 'invalid') input.angularDimensions[0].textOverride = '999°'
    const model = createKJModelAdapter({ protocol, model: 'offline-angle-protocol-fixture', request: async ({ body }) => {
      const defs = protocol === 'gemini-generate-content' ? body.tools[0].functionDeclarations : body.tools
      assert.equal(defs.length, 1)
      const def = defs[0], schema = def.function?.parameters ?? def.parameters ?? def.input_schema ?? def.parametersJsonSchema
      assert.equal(schema.required.includes('angularDimensions'), false)
      assert.equal(schema.required.includes('alignedDimensions'), true)
      const item = schema.properties.angularDimensions.items
      assert.deepEqual(item.required, ['center', 'first', 'second', 'position', 'height'])
      assert.equal(item.additionalProperties, false)
      assert.deepEqual(item.properties.center.required, ['source', 'id', 'feature'])
      return wire(protocol, input)
    } })
    const run = await runKJAgentTask({ session, model, prompt: 'Dimension both angular sectors from the actual rays.', toolNames: [tool], maxTurns: 1 })
    assert.equal(document.serialize(), before)
    assert.equal(run.status, mode === 'invalid' ? 'limit-reached' : 'awaiting-approval', JSON.stringify(run))
    assert.equal(run.outputs[0].result.ok, mode !== 'invalid')
    if (mode === 'angular') assert.deepEqual(run.outputs[0].result.value.preview.after.filter(entity => entity.type === 'DIMENSION').map(entity => projectDimension(entity.payload).measurement), [90, 270])
  }
})

