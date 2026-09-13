import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'
import { createAgentGeometryPreview, agentPreviewMatchesDocument } from '../src/agent-preview.js'
import { projectDimension } from '../src/geometry/annotation.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)
const nearPoint = (actual, expected) => { assert.equal(actual.length, expected.length); actual.forEach((n, i) => near(n, expected[i])) }
const args = (document, type, changes = {}) => ({ expectedRevision: document.revision, units: 'millimeter', ids: ['edge'], center: { x: 10, y: 20 }, ...(type === 'ROTATE' ? { angleDegrees: 90 } : { factor: 2 }), ...changes })
const tool = type => `cad_propose_${type.toLowerCase()}`
const transformedPoint = (p, type, direction = false) => {
  const cx = direction ? 0 : 10, cy = direction ? 0 : 20
  return type === 'ROTATE' ? [cx - (p[1] - cy), cy + p[0] - cx, p[2]] : [cx + 2 * (p[0] - cx), cy + 2 * (p[1] - cy), p[2]]
}

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Dimensioned assembly', tx => {
    tx.createEntity('LINE', { start: [20, 30, 0], end: [60, 30, 0] }, { id: 'edge' })
    tx.createEntity('CIRCLE', { center: [40, 45, 0], radius: 5 }, { id: 'hole' })
    tx.createEntity('ARC', { center: [55, 45, 0], radius: 7, startAngle: .2, endAngle: 2.1 }, { id: 'arc' })
    tx.createEntity('ELLIPSE', { center: [35, 55, 0], majorAxis: [8, 6, 0], ratio: .35, startParameter: .2, endParameter: 5.8, color: 4 }, { id: 'ellipse' })
    tx.createEntity('LWPOLYLINE', { vertices: [{ point: [20, 30, 0], bulge: .4 }, { point: [40, 50, 0] }, { point: [60, 30, 0] }], closed: true }, { id: 'outline' })
    tx.createEntity('XLINE', { origin: [20, 30, 0], direction: [1, 2, 0] }, { id: 'guide' })
    tx.createEntity('RAY', { origin: [20, 30, 0], direction: [-2, 1, 0] }, { id: 'ray' })
    tx.createEntity('TEXT', { position: [25, 40, 0], alignmentPoint: [35, 40, 0], text: 'PUMP A-12', height: 3, rotation: .25 }, { id: 'note' })
    const style = tx.upsertTableRecord('dimensionStyles', { id: 'style', name: 'Production', payload: { textHeight: 2, decimalPlaces: 3 } })
    for (const [id, dimensionType, definitionPoints] of [
      ['aligned', 'ALIGNED', [[20, 20, 0], [20, 30, 0], [60, 50, 0]]],
      ['rotated', 'ROTATED', [[20, 20, 0], [20, 30, 0], [60, 30, 0]]],
      ['radius', 'RADIUS', [[40, 45, 0], [43, 49, 0]]],
      ['diameter', 'DIAMETER', [[35, 45, 0], [45, 45, 0]]],
      ['angular', 'ANGULAR_3_POINT', [[30, 40, 0], [40, 30, 0], [20, 50, 0], [20, 30, 0]]],
    ]) tx.createEntity('DIMENSION', { dimensionType, definitionPoints, textPosition: [45, 25, 0], styleId: style.id, rotation: 0 }, { id })
    const motor = tx.upsertTableRecord('blockRecords', { id: 'motor', name: 'Motor', payload: { basePoint: [2, 1, 0], entityIds: [] } })
    tx.createEntity('CIRCLE', { center: [2, 1, 0], radius: 3 }, { id: 'motor-circle', ownerId: motor.id })
    const block = tx.upsertTableRecord('blockRecords', { id: 'body', name: 'Pump', payload: { basePoint: [5, 5, 0], entityIds: [] } })
    tx.createEntity('LINE', { start: [5, 5, 0], end: [25, 5, 0] }, { id: 'block-edge', ownerId: block.id })
    tx.createEntity('TEXT', { position: [7, 8, 0], text: 'MOTOR', height: 2 }, { id: 'block-note', ownerId: block.id })
    tx.createEntity('INSERT', { blockRecordId: motor.id, position: [15, 15, 0], rotation: .4 }, { id: 'nested', ownerId: block.id })
    tx.createEntity('INSERT', { blockRecordId: block.id, position: [70, 40, 0], scale: [1, 1, 1], rotation: .2 }, { id: 'pump' })
    tx.createEntity('INSERT', { blockRecordId: block.id, position: [200, 200, 0] }, { id: 'unrelated' })
  })
  return { sdk, document, session: new KJAgentToolSession(sdk, document), ids: ['edge', 'hole', 'arc', 'ellipse', 'outline', 'guide', 'ray', 'note', 'aligned', 'rotated', 'radius', 'diameter', 'angular', 'pump'] }
}

test('MOVE keeps a native elliptical arc editable while preserving its axes, parameters, identity and files',async()=>{
  const {sdk,document,session}=await fixture(),before=document.getObject('ellipse'),source=document.serialize()
  const proposal=value(await session.call('cad_propose_move',{expectedRevision:document.revision,units:'millimeter',ids:['ellipse'],dx:3,dy:-4}))
  assert.equal(document.serialize(),source);assert.deepEqual(proposal.preview.before,[{id:'ellipse',type:'ELLIPSE',payload:before.payload}])
  const preview=proposal.preview.after[0];nearPoint(preview.payload.center,[38,51,0]);nearPoint(preview.payload.majorAxis,[8,6,0])
  for(const field of ['ratio','startParameter','endParameter'])near(preview.payload[field],before.payload[field])
  value(await session.approve(proposal.planId,'reviewer'))
  const moved=document.getObject('ellipse');assert.equal(moved.id,before.id);assert.equal(moved.handle,before.handle);assert.equal(moved.ownerId,before.ownerId)
  for(const format of ['KJD','DXF']){
    const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format,...(format==='DXF'?{version:'2018'}:{})}),{format}),ellipse=reopened.listEntities({type:'ELLIPSE'})[0]
    nearPoint(ellipse.payload.center,[38,51,0]);nearPoint(ellipse.payload.majorAxis,[8,6,0]);near(ellipse.payload.ratio,.35);near(ellipse.payload.startParameter,.2);near(ellipse.payload.endParameter,5.8)
  }
  await document.undo();assert.deepEqual(document.getObject('ellipse'),before)
  await document.redo();assert.deepEqual(document.getObject('ellipse'),moved)
})

for (const type of ['ROTATE', 'SCALE']) test(`${type} previews native geometry, block hierarchy and measured annotations; approval, files and history retain identity`, async () => {
  const { sdk, document, session, ids } = await fixture()
  const source = document.serialize(), history = document.history, before = new Map(document.listObjects().map(item => [item.id, item]))
  const other = sdk.createDocument({ units: 'meter' }), otherSource = other.serialize()
  const proposal = value(await session.call(tool(type), args(document, type, { ids })))
  assert.equal(proposal.command, type); assert.equal(proposal.preview.command, type)
  assert.equal(proposal.preview.before.length, ids.length); assert.equal(proposal.preview.after.length, ids.length)
  assert.equal(document.serialize(), source); assert.deepEqual(document.history, history)
  for (const after of proposal.preview.after) {
    const original = before.get(after.id).payload
    for (const field of ['start', 'end', 'center', 'origin', 'position', 'alignmentPoint', 'textPosition']) if (Array.isArray(original[field])) nearPoint(after.payload[field], transformedPoint(original[field], type))
    if (original.direction) nearPoint(after.payload.direction, transformedPoint(original.direction, type, true))
    if (original.majorAxis) { nearPoint(after.payload.majorAxis, transformedPoint(original.majorAxis, type, true));near(after.payload.ratio,original.ratio);near(after.payload.startParameter,original.startParameter);near(after.payload.endParameter,original.endParameter) }
    if (original.radius) near(after.payload.radius, original.radius * (type === 'SCALE' ? 2 : 1))
    if (after.type === 'ARC') for (const field of ['startAngle', 'endAngle']) {
      const expected = original[field] + (type === 'ROTATE' ? Math.PI / 2 : 0)
      near(Math.cos(after.payload[field]), Math.cos(expected)); near(Math.sin(after.payload[field]), Math.sin(expected))
    }
    if (original.vertices) original.vertices.forEach((vertex, i) => { nearPoint(after.payload.vertices[i].point, transformedPoint(vertex.point, type)); near(after.payload.vertices[i].bulge, vertex.bulge) })
    if (after.type === 'TEXT') { assert.equal(after.payload.text, original.text); near(after.payload.height, original.height * (type === 'SCALE' ? 2 : 1)) }
    if (after.type === 'DIMENSION') {
      original.definitionPoints.forEach((p, i) => nearPoint(after.payload.definitionPoints[i], transformedPoint(p, type)))
      const style = document.getObject(original.styleId).payload, old = projectDimension(original, style), next = projectDimension(after.payload, style)
      assert.ok(old && next); near(next.measurement, old.measurement * (type === 'SCALE' && !original.dimensionType.startsWith('ANGULAR') ? 2 : 1))
      near(next.label.height, old.label.height)
    }
    if (after.type === 'INSERT') { nearPoint(after.payload.scale, original.scale.map(n => n * (type === 'SCALE' ? 2 : 1))); assert.equal(after.payload.blockRecordId, original.blockRecordId) }
    if ('rotation' in original && after.type !== 'DIMENSION') near(Math.sin(after.payload.rotation), Math.sin(original.rotation + (type === 'ROTATE' ? Math.PI / 2 : 0)))
    assert.throws(() => { after.payload.color = 9 }, TypeError)
  }
  assert.ok(proposal.preview.blockDependencies.some(item => item.id === 'nested'))
  assert.equal((await session.call('approve', { planId: proposal.planId })).ok, false)
  const receipt = value(await session.approve(proposal.planId, 'trusted-reviewer'))
  assert.equal(receipt.afterRevision, receipt.beforeRevision + 1); assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
  assert.equal(other.serialize(), otherSource)
  const accepted = new Map(document.listObjects().map(item => [item.id, item]))
  for (const [id, old] of before) {
    if (!ids.includes(id)) assert.deepEqual(document.getObject(id), old)
    else for (const field of ['id', 'handle', 'ownerId', 'extension', 'source']) assert.deepEqual(document.getObject(id)[field], old[field])
  }
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    for (const id of ids) {
      const expected = accepted.get(id), candidates = reopened.listEntities({ ownerId: reopened.snapshot().spaces.modelSpaceId, type: expected.type })
      // DXF import reserves its default resources and remaps conflicting low handles.
      const actual = candidates.find(item => item.handle === expected.handle) ?? (candidates.length === 1 ? candidates[0] : undefined)
      assert.ok(actual, `${format} ${id}`); assert.equal(actual.type, expected.type)
      for (const field of ['start', 'end', 'center', 'origin', 'position', 'alignmentPoint', 'textPosition', 'scale', 'majorAxis']) if (Array.isArray(expected.payload[field])) nearPoint(actual.payload[field], expected.payload[field])
      if (expected.payload.definitionPoints) expected.payload.definitionPoints.forEach((p, i) => nearPoint(actual.payload.definitionPoints[i], p))
      if (expected.type === 'DIMENSION') near(projectDimension(actual.payload).measurement, projectDimension(expected.payload).measurement)
      if (expected.payload.radius) near(actual.payload.radius, expected.payload.radius)
      if (expected.type === 'ELLIPSE') { near(actual.payload.ratio,expected.payload.ratio);near(actual.payload.startParameter,expected.payload.startParameter);near(actual.payload.endParameter,expected.payload.endParameter) }
      if (expected.payload.direction) {
        const divisor = format === 'DXF' ? Math.hypot(...expected.payload.direction) : 1
        nearPoint(actual.payload.direction, expected.payload.direction.map(n => n / divisor))
      }
      if (expected.payload.vertices) {
        assert.equal(actual.payload.vertices.length, expected.payload.vertices.length)
        expected.payload.vertices.forEach((vertex, i) => { nearPoint(actual.payload.vertices[i].point, vertex.point); near(actual.payload.vertices[i].bulge, vertex.bulge) })
        assert.equal(actual.payload.closed, expected.payload.closed)
      }
      for (const field of ['startAngle', 'endAngle', 'rotation']) if (typeof expected.payload[field] === 'number') {
        // Only linear/rotated dimensions use stored rotation; other native types
        // derive their angle from definition points when encoded in DXF.
        if (field === 'rotation' && expected.type === 'DIMENSION' && !['ROTATED', 'LINEAR'].includes(expected.payload.dimensionType)) continue
        near(Math.sin(actual.payload[field]), Math.sin(expected.payload[field])); near(Math.cos(actual.payload[field]), Math.cos(expected.payload[field]))
      }
      if (expected.type === 'TEXT') { assert.equal(actual.payload.text, expected.payload.text); near(actual.payload.height, expected.payload.height) }
      if (expected.type === 'INSERT') { const block = reopened.getObject(actual.payload.blockRecordId); assert.equal(block.name, 'Pump'); nearPoint(block.payload.basePoint, [5, 5, 0]); assert.equal(reopened.listEntities({ ownerId: block.id, type: 'INSERT' }).length, 1) }
    }
  }
  await document.undo(); for (const [id, original] of before) assert.deepEqual(document.getObject(id), original)
  await document.redo(); for (const [id, original] of accepted) assert.deepEqual(document.getObject(id), original)
  assert.equal((await session.approve(proposal.planId, 'reviewer')).ok, false)
})

for (const type of ['ROTATE', 'SCALE']) test(`${type} rejects malformed, protected, nonplanar and overflowing requests before any plan`, async () => {
  const { document, session } = await fixture()
  await document.transact('Unsupported transforms', tx => {
    const locked = tx.upsertTableRecord('layers', { id: 'locked-layer', name: 'Locked', payload: { locked: true } })
    for (const [id, patch, options] of [
      ['locked', { layerId: locked.id }, {}], ['hidden', { visible: false }, {}], ['frozen', { frozen: true }, {}],
      ['raised', { end: [10, 20, 3] }, {}], ['tilted', { normal: [0, 1, 0] }, {}], ['thick', { thickness: 3 }, {}],
      ['paper', {}, { ownerId: document.snapshot().spaces.paperSpaceIds[0] }],
      ['overflow', { start: [1e12 - 1, 1e12 - 1, 0], end: [1e12, 1e12, 0] }, {}],
    ]) tx.createEntity('LINE', { start: [20, 30, 0], end: [60, 30, 0], ...patch }, { id, ...options })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [10, 0]], constantWidth: 5 }, { id: 'wide' })
    tx.createEntity('DIMENSION', { dimensionType: 'ORDINATE', definitionPoints: [[0, 0], [10, 20]] }, { id: 'ordinate' })
  })
  const source = document.serialize(), history = document.history
  const invalid = [
    { units: 'meter' }, { expectedRevision: document.revision - 1 }, { center: undefined }, { center: { x: 0 } }, { center: { x: Infinity, y: 0 } }, { center: { x: 1e13, y: 0 } },
    { ids: [] }, { ids: ['edge', 'edge'] }, { ids: ['missing'] }, { ids: Array(65).fill('edge') }, { confirmation: { status: 'confirmed' } },
    ...['locked', 'hidden', 'frozen', 'raised', 'tilted', 'thick', 'paper', 'wide', 'ordinate'].map(id => ({ ids: ['edge', id] })),
    ...(type === 'ROTATE' ? [0, 360, -360, 361, NaN, '90'].map(angleDegrees => ({ angleDegrees })) : [0, -1, 1, 1e-7, 1e7, Infinity, '2'].map(factor => ({ factor }))),
    { ids: ['overflow'], center: { x: -1e12, y: -1e12 } },
  ]
  for (const change of invalid) { const result = await session.call(tool(type), args(document, type, change)); assert.equal(result.ok, false, JSON.stringify(change)); assert.equal(document.serialize(), source) }
  assert.deepEqual(document.history, history)
  const core = { ids: ['edge'], center: [10, 20], ...(type === 'ROTATE' ? { angleDegrees: 90 } : { factor: 2 }) }
  for (const change of [{ center: undefined }, { ids: ['locked'] }, { ids: ['edge', 'edge'] }, { angle: .5 }]) await assert.rejects(createAgentGeometryPreview(document, type, { ...core, ...change }))
  assert.equal(document.serialize(), source)
})

for (const type of ['ROTATE', 'SCALE']) test(`${type} rejects stale dependencies and substituted commands; rejection remains read-only`, async () => {
  const { sdk, document, session } = await fixture()
  const rejected = value(await session.call(tool(type), args(document, type)))
  const original = document.serialize(); value(session.reject(rejected.planId, 'reviewer'))
  assert.equal((await session.approve(rejected.planId, 'reviewer')).ok, false); assert.equal(document.serialize(), original)
  const stale = value(await session.call(tool(type), args(document, type, { ids: ['pump'] })))
  await document.transact('Edit block child', tx => tx.updateObject('block-edge', { payload: { end: [40, 5, 0] } }))
  const changed = document.serialize()
  assert.equal((await session.approve(stale.planId, 'reviewer')).ok, false); assert.equal(document.serialize(), changed)
  const proposal = value(await session.call(tool(type), args(document, type)))
  let invoked = false
  sdk.commands.register({ id: type, execute: () => { invoked = true } }, { owner: 'host-plugin', replace: true })
  assert.equal((await session.approve(proposal.planId, 'reviewer')).ok, false)
  assert.equal((await session.call(tool(type), args(document, type))).ok, false)
  assert.equal(invoked, false); assert.equal(document.serialize(), changed)
})

test('scaling and rotating a block preserves its local native dimension measurement and definition', async () => {
  const { document, session } = await fixture()
  await document.transact('Block dimension', tx => tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[5, 0], [5, 5], [25, 5]] }, { id: 'block-dim', ownerId: 'body' }))
  const before = document.serialize(), original = document.getObject('block-dim')
  const scale = value(await session.call('cad_propose_scale', args(document, 'SCALE', { ids: ['pump'] })))
  assert.equal(document.serialize(), before)
  assert.deepEqual(scale.preview.blockDependencies.find(item => item.id === 'block-dim').payload, JSON.parse(JSON.stringify(original.payload)))
  value(await session.approve(scale.planId, 'reviewer'))
  assert.deepEqual(document.getObject('block-dim'), original)
  near(projectDimension(document.getObject('block-dim').payload).measurement, 20)
  const rotate = value(await session.call('cad_propose_rotate', args(document, 'ROTATE', { ids: ['pump'] })))
  value(await session.approve(rotate.planId, 'reviewer'))
  assert.deepEqual(document.getObject('block-dim'), original)
  near(projectDimension(document.getObject('block-dim').payload).measurement, 20)
  for (const name of ['cad_propose_rotate', 'cad_propose_scale']) {
    const definition = KJDRAW_AGENT_TOOLS.find(item => item.name === name)
    assert.equal(definition.effect, 'propose'); assert.equal(definition.inputSchema.properties.ids.maxItems, 64)
    assert.ok(definition.inputSchema.required.includes('center')); assert.match(definition.description, /host approval/i)
  }
})

test('clockwise rotation and fractional uniform scaling use the explicit off-origin center', async () => {
  for (const [name, change] of [['cad_propose_rotate', { angleDegrees: -37 }], ['cad_propose_scale', { factor: .125 }]]) {
    const { document, session } = await fixture(), center = { x: -25, y: 17 }
    const proposal = value(await session.call(name, { expectedRevision: document.revision, units: 'millimeter', ids: ['edge'], center, ...change }))
    const a = document.getObject('edge').payload, b = proposal.preview.after[0].payload
    for (const field of ['start', 'end']) {
      const x = a[field][0] - center.x, y = a[field][1] - center.y, angle = -37 * Math.PI / 180
      const expected = 'factor' in change ? [center.x + x * change.factor, center.y + y * change.factor, 0] : [center.x + x * Math.cos(angle) - y * Math.sin(angle), center.y + x * Math.sin(angle) + y * Math.cos(angle), 0]
      nearPoint(b[field], expected)
    }
    value(await session.approve(proposal.planId, 'reviewer')); assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
  }
})

test('transformed block radii and annotation projections cannot exceed the finite geometry budget', async () => {
  const { document, session } = await fixture()
  await document.transact('Bounded original geometry', tx => {
    tx.updateObject('motor-circle', { payload: { radius: 1e11 } })
    tx.updateObject('style', { payload: { arrowSize: 1e20 } })
  })
  const before = document.serialize()
  assert.equal((await session.call('cad_propose_scale', args(document, 'SCALE', { ids: ['pump'], factor: 100 }))).ok, false)
  assert.equal((await session.call('cad_propose_rotate', args(document, 'ROTATE', { ids: ['aligned'] }))).ok, false)
  assert.equal(document.serialize(), before)
})

for (const type of ['ROTATE', 'SCALE']) test(`${type} remains subject to host execution veto and command availability`, async () => {
  const { sdk, document, session } = await fixture(), events = []
  for (const name of ['planned', 'before-execute', 'committed']) sdk.events.on(`command:${name}`, event => events.push([name, event.envelope.command]))
  const proposal = value(await session.call(tool(type), args(document, type))), before = document.serialize()
  const stop = sdk.events.on('command:before-execute', () => { throw new Error('Host policy veto') })
  assert.equal((await session.approve(proposal.planId, 'reviewer')).ok, false); assert.equal(document.serialize(), before)
  assert.deepEqual(events, [['planned', type], ['before-execute', type]])
  stop(); events.length = 0
  const core = sdk.commands.resolve(type); let invoked = 0
  sdk.commands.register({ ...core, canExecute: () => false, execute: (...args) => { invoked++; return core.execute(...args) } }, { owner: '@kanjieteam/kjdraw', replace: true })
  const blocked = value(await session.call(tool(type), args(document, type)))
  assert.equal((await session.approve(blocked.planId, 'reviewer')).ok, false); assert.equal(invoked, 0); assert.equal(document.serialize(), before)
  sdk.commands.register(core, { owner: '@kanjieteam/kjdraw', replace: true }); events.length = 0
  const next = value(await session.call(tool(type), args(document, type))); value(await session.approve(next.planId, 'reviewer'))
  assert.deepEqual(events, [['planned', type], ['before-execute', type], ['committed', type]])
})

async function dimensionedBlockFixture() {
  const result = await fixture()
  await result.document.transact('Mixed native equipment dimensions', tx => {
    tx.updateObject('nested', { payload: { scale: [1.5, 1.5, 1], rotation: Math.PI / 6 } })
    for (const [id, ownerId, dimensionType, definitionPoints] of [
      ['block-aligned', 'body', 'ALIGNED', [[5, 0], [5, 5], [25, 5]]],
      ['block-rotated', 'body', 'ROTATED', [[5, -5], [5, 5], [25, 5]]],
      ['motor-radius', 'motor', 'RADIUS', [[2, 1], [5, 1]]],
      ['motor-diameter', 'motor', 'DIAMETER', [[-1, 1], [5, 1]]],
      ['motor-angular', 'motor', 'ANGULAR_3_POINT', [[4, 3], [5, 1], [2, 4], [2, 1]]],
    ]) tx.createEntity('DIMENSION', { dimensionType, definitionPoints, textHeight: 1.2, ...(ownerId === 'body' ? { styleId: 'style' } : {}), rotation: 0 }, { id, ownerId })
  })
  return result
}

for (const factor of [2, .25]) test(`dimensioned nested INSERT scales by ${factor} without changing local definitions or measurements`, async () => {
  const { sdk, document, session } = await dimensionedBlockFixture()
  const original = new Map(document.listObjects().map(item => [item.id, item])), source = document.serialize(), history = document.history
  const measurements = { 'block-aligned': 20, 'block-rotated': 20, 'motor-radius': 3, 'motor-diameter': 6, 'motor-angular': 90 }
  const proposal = value(await session.call('cad_propose_scale', args(document, 'SCALE', { ids: ['pump'], factor })))
  assert.equal(document.serialize(), source); assert.deepEqual(document.history, history)
  assert.deepEqual(proposal.preview.before.map(item => item.id), ['pump']); assert.deepEqual(proposal.preview.after.map(item => item.id), ['pump'])
  nearPoint(proposal.preview.after[0].payload.scale, [factor, factor, factor])
  nearPoint(proposal.preview.after[0].payload.position, [10 + 60 * factor, 20 + 20 * factor, 0])
  for (const [id, expected] of Object.entries(measurements)) {
    const dependency = proposal.preview.blockDependencies.find(item => item.id === id)
    assert.deepEqual(dependency.payload, JSON.parse(JSON.stringify(original.get(id).payload)))
    near(projectDimension(dependency.payload, document.getObject(dependency.payload.styleId)?.payload).measurement, expected)
  }
  value(await session.approve(proposal.planId, 'reviewer'))
  assert.equal(document.revision, proposal.expectedRevision + 1); assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
  for (const [id, record] of original) if (id !== 'pump') assert.deepEqual(document.getObject(id), record)
  const accepted = document.getObject('pump')
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    for (const [id, expected] of Object.entries(measurements)) {
      const actual = reopened.listEntities({ type: 'DIMENSION' }).find(item => item.handle === original.get(id).handle)
      assert.ok(actual, id); assert.deepEqual(actual.payload.definitionPoints, original.get(id).payload.definitionPoints)
      near(projectDimension(actual.payload, reopened.getObject(actual.payload.styleId)?.payload).measurement, expected)
      assert.equal(reopened.getObject(actual.ownerId).name, original.get(original.get(id).ownerId).name)
    }
    const blockInsert = reopened.listEntities({ ownerId: reopened.snapshot().spaces.modelSpaceId, type: 'INSERT' }).find(item => item.handle === accepted.handle)
    nearPoint(blockInsert.payload.scale, accepted.payload.scale); nearPoint(blockInsert.payload.position, accepted.payload.position)
  }
  await document.undo(); for (const [id, record] of original) assert.deepEqual(document.getObject(id), record)
  await document.redo(); assert.deepEqual(document.getObject('pump'), accepted)
  for (const [id, record] of original) if (id !== 'pump') assert.deepEqual(document.getObject(id), record)
})

test('dimensioned block scaling keeps reflection, anisotropy, protected graphs and display bounds closed', async () => {
  const cases = [
    ['pump', { scale: [-1, 1, 1] }], ['nested', { scale: [1, 2, 1] }], ['nested', { mirrored: true }], ['pump', { mirrored: true }],
    ['motor-angular', { normal: [0, 1, 0] }], ['motor-angular', { visible: false }], ['motor-radius', { locked: true }],
    ['motor-radius', { dimensionType: 'ORDINATE' }], ['motor', { dxfFlags: 4 }], ['style', { arrowSize: 1e12 }],
    ['motor-angular', { textHeight: 1e12 }],
  ]
  for (const [id, payload] of cases) {
    const { document, session } = await dimensionedBlockFixture()
    await document.transact('Unsupported dimensioned block', tx => tx.updateObject(id, { payload }))
    const source = document.serialize(), result = await session.call('cad_propose_scale', args(document, 'SCALE', { ids: ['pump'], factor: 10 }))
    assert.equal(result.ok, false, JSON.stringify([id, payload])); assert.equal(document.serialize(), source)
  }
})
