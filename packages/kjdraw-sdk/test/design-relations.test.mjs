import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, createKJDrawSDK, readDesignRelations, createDesignRelations } from '../src/index.js'
import { projectDimension } from '../src/geometry/annotation.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const expr = (parameter, coefficient = 1, constant = 0) => ({ constant, terms: parameter ? [{ parameter, coefficient }] : [] })
const bind = (entityId, path, parameter, coefficient = 1) => ({ entityId, path, expression: expr(parameter, coefficient) })
const parameter = (name, value, min = 1, max = 1000) => ({ name, value, min, max })
function model() {
  return {
    parameters: [parameter('width', 200), parameter('height', 100), parameter('margin', 20), parameter('diameter', 10)],
    derived: [
      { name: 'right', expression: { constant: 0, terms: [{ parameter: 'width', coefficient: 1 }, { parameter: 'margin', coefficient: -1 }] } },
      { name: 'top', expression: { constant: 0, terms: [{ parameter: 'height', coefficient: 1 }, { parameter: 'margin', coefficient: -1 }] } },
    ],
    bindings: [
      bind('outline', 'vertices.1.0', 'width'), bind('outline', 'vertices.2.0', 'width'),
      bind('outline', 'vertices.2.1', 'height'), bind('outline', 'vertices.3.1', 'height'),
      ...['h0', 'h1', 'h2', 'h3'].flatMap((id, index) => [bind(id, 'center.0', index % 2 ? 'right' : 'margin'), bind(id, 'center.1', index < 2 ? 'margin' : 'top'), bind(id, 'radius', 'diameter', .5)]),
      bind('width-dimension', 'definitionPoints.0.0', 'width', .5), bind('width-dimension', 'definitionPoints.2.0', 'width'),
      bind('datum', 'end.0', 'width'),
    ],
    requirements: ['width', 'height'].map(name => ({ name: `${name}_clearance`, min: 0, max: 1000,
      expression: { constant: 0, terms: [{ parameter: name, coefficient: 1 }, { parameter: 'margin', coefficient: -2 }, { parameter: 'diameter', coefficient: -1 }] } })),
  }
}
async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'design-relations-test', units: 'millimeter' })
  await document.transact('Native plate fixtures', tx => {
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0, 3], [200, 0, 3], [200, 100, 3], [0, 100, 3]].map((point, i) => ({ point, bulge: i === 0 ? .1 : 0, startWidth: 2, endWidth: 3 })), closed: true, elevation: 3, color: 3 }, { id: 'outline' })
    for (let i = 0; i < 4; i++) tx.createEntity('CIRCLE', { center: [i % 2 ? 180 : 20, i < 2 ? 20 : 80, 3], radius: 5, color: 5 }, { id: `h${i}` })
    tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[100, -15, 0], [0, 0, 0], [200, 0, 0]], textHeight: 3 }, { id: 'width-dimension' })
    tx.createEntity('LINE', { start: [0, 50, 3], end: [200, 50, 3], linetypeScale: 2 }, { id: 'datum' })
    tx.createEntity('TEXT', { position: [10, 10, 0], text: 'Independent note', height: 3 }, { id: 'note' })
  })
  const group = await sdk.executeCommand('GROUP', { name: 'Assembly', ids: ['outline', 'h0', 'h1', 'h2', 'h3', 'width-dimension', 'datum'] })
  const design = await sdk.executeCommand('DESIGNCREATE', { name: 'Mounting plate', definition: model() })
  return { sdk, document, design, group }
}

test('named design parameters atomically update native outline, four holes, datum and dimension without replacement', async () => {
  const { sdk, document, design, group } = await fixture()
  const previous = document.toJSON(), revision = document.revision, originals = document.listEntities()
  const view = readDesignRelations(document)[0]
  assert.equal(view.values.right, 180); assert.deepEqual(view.driftedEntityIds, [])
  await sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { width: 320, height: 160, margin: 25, diameter: 16 } })
  assert.equal(document.revision, revision + 1)
  const outline = document.getObject('outline').payload
  assert.deepEqual(outline.vertices.map(v => v.point), [[0, 0, 3], [320, 0, 3], [320, 160, 3], [0, 160, 3]])
  assert.equal(outline.vertices[0].bulge, .1); assert.equal(outline.vertices[0].startWidth, 2); assert.equal(outline.vertices[0].endWidth, 3)
  assert.deepEqual(['h0', 'h1', 'h2', 'h3'].map(id => document.getObject(id).payload.center), [[25, 25, 3], [295, 25, 3], [25, 135, 3], [295, 135, 3]])
  for (const id of ['h0', 'h1', 'h2', 'h3']) assert.equal(document.getObject(id).payload.radius, 8)
  assert.equal(projectDimension(document.getObject('width-dimension').payload).measurement, 320)
  assert.equal(document.getObject('width-dimension').payload.measurement, 320)
  assert.deepEqual(document.getObject('datum').payload.end, [320, 50, 3])
  assert.deepEqual(document.getObject('note'), originals.find(e => e.id === 'note'))
  for (const entity of originals) {
    const current = document.getObject(entity.id)
    for (const key of ['id', 'handle', 'ownerId', 'extension']) assert.deepEqual(current[key], entity[key])
    assert.equal(current.payload.color, entity.payload.color)
  }
  assert.deepEqual(document.getObject(group.id).payload.memberIds, previous.objects[group.id].payload.memberIds)
  const updated = document.toJSON()
  await sdk.executeCommand('UNDO')
  assert.deepEqual(document.getObject('outline'), previous.objects.outline)
  assert.equal(readDesignRelations(document)[0].values.width, 200)
  await sdk.executeCommand('REDO'); assert.deepEqual(document.getObject('outline'), updated.objects.outline)
  assert.deepEqual(readDesignRelations(document)[0].driftedEntityIds, [])
})

test('designs persist in KJD and reopen for further updates; DXF requires explicit flattening and independently preserves geometry', async () => {
  const { sdk, document, design } = await fixture()
  await sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { width: 300 } })
  const reopened = KJDocument.open(document.serialize()), reopenedSDK = createKJDrawSDK()
  reopenedSDK.attachDocument(reopened)
  assert.deepEqual(readDesignRelations(reopened), readDesignRelations(document))
  await reopenedSDK.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { width: 400 } })
  assert.equal(reopened.getObject('h1').payload.center[0], 380)
  await assert.rejects(sdk.writeDocument(document, { format: 'DXF', version: '2018' }), error => /cannot preserve.*design relations/.test(error.cause?.message))
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018', designRelations: 'flatten' })
  const cad = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  assert.deepEqual(cad.listEntities({ type: 'CIRCLE' }).map(e => e.payload.center), [[20, 20, 3], [280, 20, 3], [20, 80, 3], [280, 80, 3]])
  assert.equal(projectDimension(cad.listEntities({ type: 'DIMENSION' })[0].payload).measurement, 300)
  assert.deepEqual(readDesignRelations(cad), [])
  const python = process.env.KJDRAW_PYTHON || 'python'
  const result = spawnSyncWithFileStdin(python, ['-c', 'import sys,io,json,ezdxf,os; p=os.environ.get("KJDRAW_FILE_STDIN_PATH"); source=open(p,encoding="utf-8").read() if p else sys.stdin.read(); d=ezdxf.read(io.StringIO(source)); a=d.audit(); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"circles":len(d.modelspace().query("CIRCLE")),"width":list(d.modelspace().query("DIMENSION"))[0].get_measurement()}))'], dxf, { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { errors: 0, fixes: 0, circles: 4, width: 300 })
})

test('conflicts, missing dependencies, cycles, duplicate writes and unmet requirements reject without changing the drawing', async () => {
  const { sdk, document, design } = await fixture()
  let before = document.serialize()
  await assert.rejects(sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { width: 40 } }), /requirement width_clearance failed: -10 outside \[0, 1000\]/)
  assert.equal(document.serialize(), before)
  const invalidPatches = [{ width: 40 }, { width: 0 }, { width: NaN }, { width: Infinity }, { width: '300' }, { right: 300 }, { unknown: 1 }, {}, { width: 200 }, { margin: 100 }]
  for (const parameters of invalidPatches) {
    const before = document.serialize()
    await assert.rejects(sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters }), /Design relations/)
    assert.equal(document.serialize(), before)
  }
  const badModels = [
    m => m.derived.push({ name: 'loop', expression: expr('loop') }),
    m => { m.bindings[0].expression = expr('missing') },
    m => m.bindings.push(structuredClone(m.bindings[0])),
    m => { m.bindings[0].path = '__proto__.x' },
    m => { m.bindings[0].expression = expr('width', 2) },
    m => { m.parameters[0].name = 'constructor'; m.parameters[1].name = 'constructor' },
  ]
  for (const change of badModels) {
    const definition = model(); change(definition); const before = document.serialize()
    await assert.rejects(sdk.executeCommand('DESIGNCREATE', { name: 'Invalid design', definition }), /Design relations/)
    assert.equal(document.serialize(), before)
  }
  for (const [change, message] of [
    [m => { m.derived[0].expression = expr('missing_width') }, /under-defined derived parameter right: missing parameter missing_width/],
    [m => { m.bindings[0].expression = expr('missing_width') }, /under-defined binding outline.vertices.1.0: missing parameter missing_width/],
    [m => { m.requirements[0].expression = expr('missing_width') }, /under-defined requirement width_clearance: missing parameter missing_width/],
    [m => { m.derived[0].expression = expr('top'); m.derived[1].expression = expr('right') }, /derived parameter dependency cycle: right, top/],
  ]) {
    const definition = model(); change(definition); const unchanged = document.serialize()
    await assert.rejects(sdk.executeCommand('DESIGNCREATE', { name: 'Diagnostic design', definition }), message)
    assert.equal(document.serialize(), unchanged)
  }
  await sdk.executeCommand('MOVE', { ids: ['h0'], dx: 1, dy: 0 })
  assert.deepEqual(readDesignRelations(document)[0].driftedEntityIds, ['h0'])
  before = document.serialize()
  await assert.rejects(sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { width: 300 } }), /geometry conflict at h0/)
  assert.equal(document.serialize(), before)
})

test('style edits remain compatible, while protected layers, erased members and unit changes reject atomically', async () => {
  const { sdk, document, design } = await fixture()
  await sdk.executeCommand('PROPERTIES', { id: 'h0', patch: { payload: { color: 1 } } })
  await sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { width: 300 } })
  assert.equal(document.getObject('h0').payload.color, 1)
  const layerId = document.getObject('h0').payload.layerId
  await sdk.executeCommand('LAYERUPDATE', { id: layerId, patch: { locked: true } })
  let before = document.serialize()
  await assert.rejects(sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { width: 400 } }), /protected|locked/)
  assert.equal(document.serialize(), before)
  await sdk.executeCommand('LAYERUPDATE', { id: layerId, patch: { locked: false } })
  await sdk.executeCommand('ERASE', { ids: ['h2'] })
  before = document.serialize()
  await assert.rejects(sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { width: 400 } }), /missing live/)
  assert.equal(document.serialize(), before)
  await sdk.executeCommand('RESTORE', { ids: ['h2'] })
  await document.transact('Change units', tx => tx.setHeader('units', 'meter'))
  before = document.serialize()
  await assert.rejects(sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { width: 400 } }), /units changed/)
  assert.equal(document.serialize(), before)
})

test('normalized design names and overlapping members cannot be rebound, including within one transaction', async () => {
  const { sdk, document } = await fixture()
  const before = document.serialize()
  await assert.rejects(sdk.executeCommand('DESIGNCREATE', { name: 'MOUNTING PLATE', definition: model() }), /already exists/)
  await assert.rejects(sdk.executeCommand('DESIGNCREATE', { name: 'Other design', definition: model() }), /already belongs/)
  assert.equal(document.serialize(), before)
  const secondSDK = createKJDrawSDK(), second = secondSDK.createDocument({ units: 'millimeter' })
  await second.transact('Line', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { id: 'line' }))
  const definition = { parameters: [parameter('length', 10)], derived: [], bindings: [bind('line', 'end.0', 'length')], requirements: [] }
  const original = second.serialize()
  await assert.rejects(second.transact('Double bind', tx => {
    createDesignRelations(second, tx, 'First', definition)
    createDesignRelations(second, tx, 'Second', definition)
  }), /already belongs/)
  assert.equal(second.serialize(), original)
  await assert.rejects(second.transact('Same normalized name', tx => {
    createDesignRelations(second, tx, 'First', definition)
    createDesignRelations(second, tx, 'FIRST', definition)
  }), /already exists/)
  assert.equal(second.serialize(), original)
})

test('dependent parameters resolve independent of order and invalid final native geometry is rejected', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Line', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { id: 'line' }))
  const definition = { parameters: [parameter('length', 10, 0, 1e12)], derived: [{ name: 'final', expression: expr('intermediate') }, { name: 'intermediate', expression: expr('length') }], bindings: [bind('line', 'end.0', 'final')], requirements: [] }
  const design = await sdk.executeCommand('DESIGNCREATE', { name: 'Line length', definition })
  assert.equal(readDesignRelations(document)[0].values.final, 10)
  const before = document.serialize()
  await assert.rejects(sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { length: 0 } }), /collapses a line/)
  assert.equal(document.serialize(), before)
  await sdk.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { length: 100 } })
  assert.deepEqual(document.getObject('line').payload.end, [100, 0, 0])
})

test('designs enforce displayed coordinate bounds, dimension plane/subtype and original handle identity', async () => {
  const { document, design } = await fixture()
  const tampered = document.toJSON()
  tampered.objects.h0.handle = 'FFF'; tampered.header.handseed = '10000'
  const alteredSDK = createKJDrawSDK(), altered = alteredSDK.openDocument(tampered)
  assert.deepEqual(readDesignRelations(altered)[0].driftedEntityIds, ['h0'])
  const before = altered.serialize()
  await assert.rejects(alteredSDK.executeCommand('DESIGNUPDATE', { id: design.id, parameters: { width: 300 } }), /geometry conflict/)
  assert.equal(altered.serialize(), before)
  for (const extra of [{ dxfDimensionType: 3 }, { dxfDimensionType: 5 }, { extrusionDirection: [0, 1, 0] }, { definitionPoints: [[100, -15, 1], [0, 0, 1], [200, 0, 1]] }]) {
    const sdk = createKJDrawSDK(), cad = sdk.createDocument({ units: 'millimeter' })
    await cad.transact('Invalid native dimension', tx => tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[100, -15, 0], [0, 0, 0], [200, 0, 0]], ...extra }, { id: 'dim' }))
    const definition = { parameters: [parameter('length', 200)], derived: [], bindings: [bind('dim', 'definitionPoints.2.0', 'length')], requirements: [] }
    const unchanged = cad.serialize()
    await assert.rejects(sdk.executeCommand('DESIGNCREATE', { name: 'Invalid dimension', definition }), /subtype|default \+Z|native XY/)
    assert.equal(cad.serialize(), unchanged)
  }
  const sdk = createKJDrawSDK(), cad = sdk.createDocument({ units: 'millimeter' })
  await cad.transact('Circle and valid native dimension', tx => {
    tx.createEntity('CIRCLE', { center: [1e12 - 10, 0, 0], radius: 5 }, { id: 'circle' })
    tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[100, -15, 0], [0, 0, 0], [200, 0, 0]], dxfDimensionType: 33 }, { id: 'dim' })
  })
  const circle = await sdk.executeCommand('DESIGNCREATE', { name: 'Bounded circle', definition: { parameters: [parameter('x', 1e12 - 10, -1e12, 1e12)], derived: [], bindings: [bind('circle', 'center.0', 'x')], requirements: [] } })
  const unchanged = cad.serialize()
  await assert.rejects(sdk.executeCommand('DESIGNUPDATE', { id: circle.id, parameters: { x: 1e12 } }), /coordinate budget/)
  assert.equal(cad.serialize(), unchanged)
  const dim = await sdk.executeCommand('DESIGNCREATE', { name: 'Valid dimension', definition: { parameters: [parameter('length', 200)], derived: [], bindings: [bind('dim', 'definitionPoints.2.0', 'length')], requirements: [] } })
  await sdk.executeCommand('DESIGNUPDATE', { id: dim.id, parameters: { length: 300 } })
  assert.equal(cad.getObject('dim').payload.dxfDimensionType, 33)
})
