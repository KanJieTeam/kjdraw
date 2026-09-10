import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJCommandRegistry, registerCoreCommands } from '../src/commands.js'

function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  return { sdk, document }
}
function input() {
  return {
    resources: {
      linetypes: [{ id: 'type-center', name: 'CENTER', pattern: [8, -1, 1, -1] }, { id: 'type-hidden', name: 'HIDDEN', pattern: [3, -1] }],
      layers: [{ id: 'layer-axis', name: 'C-AXIS', color: 1, linetypeId: 'type-center', lineweight: 25 }, { id: 'layer-hidden', name: 'C-HIDDEN', color: 3, linetypeId: 'type-hidden', lineweight: 13 }],
    },
    entities: [
      { type: 'LINE', payload: { start: [0, 0, 0], end: [80, 0, 0], layerId: 'layer-axis', lineweight: -1 }, options: { id: 'axis-line' } },
      { type: 'CIRCLE', payload: { center: [20, 20, 0], radius: 8, layerId: 'layer-hidden', linetypeId: 'type-center', lineweight: 35 }, options: { id: 'part-circle' } },
      { type: 'LINE', payload: { start: [0, 5, 0], end: [80, 5, 0] }, layerName: 'C-HIDDEN', options: { id: 'hidden-line' } },
    ],
  }
}

test('explicit batch resources are stable across fork preview and commit, survive KJD/DXF, and undo together', async () => {
  const { sdk, document } = fixture(), source = document.serialize(), args = input(), original = structuredClone(args)
  const draft = document.fork(), commands = new KJCommandRegistry(); registerCoreCommands(commands)
  const preview = await commands.execute('CREATEBATCH', { document: draft }, args)
  assert.equal(document.serialize(), source)
  const created = await sdk.executeCommand('CREATEBATCH', args)
  assert.deepEqual(args, original)
  assert.equal(created.length, 3)
  assert.equal(document.revision, 1)
  for (const id of ['type-center', 'type-hidden', 'layer-axis', 'layer-hidden', ...created.map(item => item.id)]) assert.deepEqual(document.getObject(id).payload, draft.getObject(id).payload)
  assert.deepEqual(created.map(item => item.id), preview.map(item => item.id))
  assert.equal(document.getObject('type-center').payload.totalPatternLength, 11)
  assert.equal(document.getObject('type-hidden').payload.totalPatternLength, 4)
  assert.equal(document.getObject('hidden-line').payload.layerId, 'layer-hidden')
  assert.equal(document.validate().valid, true)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    const center = reopened.getTable('linetypes').records.find(item => item.name === 'CENTER')
    const hidden = reopened.getTable('linetypes').records.find(item => item.name === 'HIDDEN')
    assert.deepEqual(center.payload.pattern, [8, -1, 1, -1])
    assert.deepEqual(hidden.payload.pattern, [3, -1])
    const layer = reopened.getTable('layers').records.find(item => item.name === 'C-HIDDEN')
    assert.equal(layer.payload.color, 3)
    assert.equal(layer.payload.lineweight, 13)
    assert.equal(layer.payload.linetypeId, hidden.id)
    const circle = reopened.listEntities({ type: 'CIRCLE' })[0]
    assert.equal(circle.payload.layerId, layer.id)
    assert.equal(circle.payload.linetypeId, center.id)
    assert.equal(circle.payload.lineweight, 35)
  }
  await sdk.executeCommand('UNDO')
  assert.equal(document.listEntities().length, 0)
  for (const id of ['type-center', 'type-hidden', 'layer-axis', 'layer-hidden']) assert.equal(document.getObject(id), null)
  assert.equal(document.getTable('layers').records.length, 1)
  assert.equal(document.getTable('linetypes').records.length, 1)
  await sdk.executeCommand('REDO')
  for (const id of ['type-center', 'type-hidden', 'layer-axis', 'layer-hidden']) assert.deepEqual(document.getObject(id).payload, draft.getObject(id).payload)
})

test('resource batches can reference existing linetypes, accept empty groups, and leave legacy implicit layers unchanged', async () => {
  const { sdk, document } = fixture(), continuous = document.getTable('linetypes').currentId
  await sdk.executeCommand('CREATEBATCH', { resources: { linetypes: [], layers: [{ id: 'new-layer', name: 'NEW', color: 7, linetypeId: continuous, lineweight: -1 }] }, entities: [{ type: 'POINT', payload: { position: [1, 2, 0], layerId: 'new-layer' } }] })
  await sdk.executeCommand('CREATEBATCH', { resources: { linetypes: [], layers: [] }, entities: [{ type: 'POINT', payload: { position: [2, 3, 0], layerId: 'new-layer', linetypeId: continuous } }] })
  await sdk.executeCommand('CREATEBATCH', { entities: [{ type: 'POINT', payload: { position: [3, 4, 0] }, layerName: 'LEGACY', layer: { color: 2 } }] })
  assert.equal(document.listEntities().length, 3)
  assert.equal(document.getTable('layers').records.find(item => item.name === 'LEGACY').payload.color, 2)
})

test('an empty resource pattern is a true continuous linetype through SDK and independent DXF tags', async () => {
  const { sdk, document } = fixture()
  const args = { resources: {
    linetypes: [{ id: 'solid-type', name: 'ROAD-SOLID', pattern: [] }],
    layers: [{ id: 'road-layer', name: 'ROAD-EDGE', color: 7, linetypeId: 'solid-type', lineweight: 25 }],
  }, entities: [{ type: 'LINE', payload: { start: [0,0,0], end: [25,0,0], layerId: 'road-layer' }, options: { id: 'road-line' } }] }
  await sdk.executeCommand('CREATEBATCH', args)
  assert.deepEqual(document.getObject('solid-type').payload.pattern, [])
  assert.equal(document.getObject('solid-type').payload.totalPatternLength, 0)
  let dxf
  for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(document, { format })
    if (format === 'DXF') dxf = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)
    const reopened = await createKJDrawSDK().readDocument(bytes, { format })
    const type = reopened.getTable('linetypes').records.find(item => item.name === 'ROAD-SOLID')
    const layer = reopened.getTable('layers').records.find(item => item.name === 'ROAD-EDGE')
    assert.deepEqual(type.payload.pattern, [])
    assert.equal(type.payload.totalPatternLength, 0)
    assert.equal(layer.payload.linetypeId, type.id)
    assert.equal(reopened.listEntities({type:'LINE'})[0].payload.layerId, layer.id)
  }
  // Read standard DXF tags independently of the SDK parser: no giant dash approximation.
  const lines = dxf.trimEnd().split(/\r?\n/), records = []
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim()), value = lines[i+1].trim()
    if (code === 0) records.push([])
    records.at(-1)?.push([code,value])
  }
  const type = records.find(record => record[0][1] === 'LTYPE' && record.some(([code,value]) => code === 2 && value === 'ROAD-SOLID'))
  assert.ok(type)
  assert.equal(Number(type.find(([code]) => code === 73)[1]), 0)
  assert.equal(Number(type.find(([code]) => code === 40)[1]), 0)
  assert.equal(type.some(([code]) => code === 49), false)
  const layer = records.find(record => record[0][1] === 'LAYER' && record.some(([code,value]) => code === 2 && value === 'ROAD-EDGE'))
  assert.equal(layer.find(([code]) => code === 6)[1], 'ROAD-SOLID')
  await sdk.executeCommand('UNDO')
  assert.equal(document.getObject('solid-type'), null); assert.equal(document.listEntities().length, 0)
  await sdk.executeCommand('REDO')
  assert.deepEqual(document.getObject('solid-type').payload.pattern, [])
})

test('duplicate identity, name collisions, wrong-table references and invalid entity properties roll back all resources', async () => {
  const { sdk, document } = fixture(), source = document.serialize(), layer0 = document.getTable('layers').currentId
  const cases = [
    args => { args.resources.linetypes[0].id = layer0 },
    args => { args.resources.linetypes[0].name = 'continuous' },
    args => { args.resources.layers[0].name = '0' },
    args => { args.resources.layers[1].name = 'c-axis' },
    args => { args.resources.linetypes[1].name = 'center' },
    args => { args.resources.layers[0].id = args.resources.linetypes[0].id },
    args => { args.resources.layers[0].linetypeId = layer0 },
    args => { args.resources.layers[0].linetypeId = 'missing' },
    args => { args.entities[0].payload.layerId = 'type-center' },
    args => { args.entities[1].payload.linetypeId = 'layer-axis' },
    args => { args.entities[1].payload.linetypeId = 'missing' },
    args => { args.entities[0].payload.lineweight = 17 },
    args => { args.entities[1].options.id = 'type-center' },
    args => { args.entities[1].payload.radius = -2 },
    args => { args.entities[2].layerName = 'UNDECLARED' },
    args => { args.resources.layers[0].lineweight = 17 },
    args => { args.resources.layers[0].lineweight = .25 },
    args => { args.resources.layers[0].color = 256 },
    args => { args.resources.layers[0].color = 0 },
    args => { args.resources.linetypes[0].name = 'BYLAYER' },
    args => { args.resources.layers[0].name = ' BAD' },
  ]
  for (const modify of cases) {
    const args = input(); modify(args)
    await assert.rejects(sdk.executeCommand('CREATEBATCH', args))
    assert.equal(document.serialize(), source)
  }
})

test('linetype patterns require finite alternating dash/gap pairs and bounded table groups', async () => {
  const { sdk, document } = fixture(), source = document.serialize()
  for (const pattern of [[1], [1, -1, 1], [0, -1], [-1, 1], [1, 1], [1, -1, -1, 1], [Infinity, -1], [1, NaN], [1e13, -1], Array.from({ length: 34 }, (_, i) => i % 2 ? -1 : 1)]) {
    const args = input(); args.resources.linetypes[0].pattern = pattern
    await assert.rejects(sdk.executeCommand('CREATEBATCH', args))
    assert.equal(document.serialize(), source)
  }
  for (const resources of [null, {}, { linetypes: [] }, { linetypes: [], layers: [], code: 'DELETE' }, { linetypes: Array.from({ length: 17 }, (_, i) => ({ id: `type-${i}`, name: `TYPE${i}`, pattern: [1, -1] })), layers: [] }]) {
    await assert.rejects(sdk.executeCommand('CREATEBATCH', { ...input(), resources }))
    assert.equal(document.serialize(), source)
  }
  const exact = { ...input(), entities: [{ type: 'POINT', payload: { position: [0, 0, 0], layerId: 'layer-15' } }], resources: {
    linetypes: Array.from({ length: 16 }, (_, i) => ({ id: `type-${i}`, name: `TYPE${i}`, pattern: [1, -1] })),
    layers: Array.from({ length: 16 }, (_, i) => ({ id: `layer-${i}`, name: `LAYER${i}`, color: i + 1, linetypeId: `type-${i}`, lineweight: 25 })),
  } }
  await sdk.executeCommand('CREATEBATCH', exact)
  assert.equal(document.getTable('layers').records.length, 17)
  assert.equal(document.getTable('linetypes').records.length, 17)
})

test('malicious resources and entity data are rejected before cloning can execute or erase them', async () => {
  const { sdk, document } = fixture(), source = document.serialize()
  let invoked = 0
  const cases = []
  const root = input(); Object.defineProperty(root, 'resources', { enumerable: true, get() { invoked++; return {} } }); cases.push(root)
  const record = input(); Object.defineProperty(record.resources.layers[0], 'color', { enumerable: true, get() { invoked++; return 3 } }); cases.push(record)
  const segment = input(); Object.defineProperty(segment.resources.linetypes[0].pattern, '0', { enumerable: true, get() { invoked++; return 8 } }); cases.push(segment)
  const entity = input(); Object.defineProperty(entity.entities[0].payload, 'layerId', { enumerable: true, get() { invoked++; return 'layer-axis' } }); cases.push(entity)
  const sparse = input(); delete sparse.resources.linetypes[0].pattern[1]; cases.push(sparse)
  const extra = input(); extra.resources.linetypes[0].pattern.extra = 1; cases.push(extra)
  const hidden = input(); Object.defineProperty(hidden.resources.layers[0], 'color', { value: 3, enumerable: false }); cases.push(hidden)
  const prototype = input(); Object.setPrototypeOf(prototype.resources.layers[0], { unexpected: true }); cases.push(prototype)
  const code = input(); code.resources.layers[0].code = () => 'DELETE'; cases.push(code)
  for (const args of cases) {
    await assert.rejects(sdk.executeCommand('CREATEBATCH', args))
    assert.equal(document.serialize(), source)
  }
  assert.equal(invoked, 0)
})
