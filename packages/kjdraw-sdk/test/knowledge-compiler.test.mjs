import assert from 'node:assert/strict'
import test from 'node:test'

import {
  KJDRAW_GEOLOGY_KNOWLEDGE_PACK,
  KJDRAW_SEMANTIC_IR_SCHEMA,
  compileKnowledgeDrawing,
  createKJDrawSDK,
} from '../src/index.js'

function geologyIntent(overrides = {}) {
  const intent = {
    schema: KJDRAW_SEMANTIC_IR_SCHEMA,
    packId: 'geology.core',
    packVersion: '1.0.0',
    drawing: { kind: 'borehole-column', title: 'ZK-01 borehole column', units: 'meter' },
    objects: [
      { id: 'hole:zk-01', kind: 'borehole', properties: { name: 'ZK-01', depth: 18, verticalScale: 1 } },
      { id: 'layer:lower', kind: 'stratum', properties: { top: 6.5, bottom: 18, lithology: 'sand' } },
      { id: 'layer:upper', kind: 'stratum', properties: { top: 0, bottom: 6.5, lithology: 'clay' } },
    ],
    relations: [
      { kind: 'contains-stratum', from: 'hole:zk-01', to: 'layer:lower' },
      { kind: 'contains-stratum', from: 'hole:zk-01', to: 'layer:upper' },
    ],
  }
  return { ...intent, ...overrides }
}

function compile(intent = geologyIntent()) {
  return compileKnowledgeDrawing({
    pack: KJDRAW_GEOLOGY_KNOWLEDGE_PACK,
    intent,
    templateId: 'borehole-column',
    rootObjectId: 'hole:zk-01',
    expectedRevision: 0,
  })
}

test('generic knowledge compiler expands geology intent deterministically from pack data', () => {
  const first = compile(), second = compile()
  assert.deepEqual(first, second)
  assert.equal(first.evidence.packId, 'geology.core')
  assert.equal(first.evidence.templateId, 'borehole-column')
  assert.equal(first.evidence.entityCount, 8)
  assert.equal(new Set(first.commandArgs.entities.map(entity => entity.options.id)).size, 8)
  assert.deepEqual(first.commandArgs.resources.layers.map(layer => layer.name), ['GEOLOGY_BOUNDARY', 'GEOLOGY_HATCH', 'GEOLOGY_TEXT'])
  assert.deepEqual(first.commandArgs.entities.filter(entity => entity.type === 'HATCH').map(entity => entity.payload.patternName), ['ANSI31', 'ANSI37'])
  assert.deepEqual(first.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text), ['ZK-01  DEPTH 18 m', 'clay  0-6.5 m', 'sand  6.5-18 m'])
  const boundaries = first.commandArgs.entities.filter(entity => entity.type === 'LWPOLYLINE')
  assert.deepEqual(boundaries.map(entity => entity.payload.vertices[0][1]), [-6.5, -18])
  assert.ok(Object.isFrozen(first))
})

test('compiled pack program executes as one CREATEBATCH and survives undo, redo, KJD and DXF reopen', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'geology-pack-compile', units: 'meter' })
  const compiled = compile()
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  assert.equal(document.revision, 1)
  assert.equal(document.listEntities().length, 8)
  assert.equal(document.listEntities({ type: 'HATCH' }).length, 2)
  assert.equal(document.getTable('layers').records.filter(layer => layer.name.startsWith('GEOLOGY_')).length, 3)

  await sdk.executeCommand('UNDO', {}, { document })
  assert.equal(document.listEntities().length, 0)
  await sdk.executeCommand('REDO', {}, { document })
  assert.equal(document.listEntities().length, 8)

  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD', version: '1' })
  assert.deepEqual(reopenedKjd.listEntities().map(entity => entity.id), document.listEntities().map(entity => entity.id))

  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopenedDxf.listEntities({ type: 'HATCH' }).length, 2)
  assert.equal(reopenedDxf.listEntities({ type: 'TEXT' }).length, 3)
  assert.equal(reopenedDxf.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
})

test('generic compiler rejects discontinuous strata, unknown lithology and executable fields', () => {
  const gap = geologyIntent()
  gap.objects[2].properties.top = 1
  assert.throws(() => compile(gap), /gap or overlap/)

  const unknown = geologyIntent()
  unknown.objects[2].properties.lithology = 'invented-layer'
  assert.throws(() => compile(unknown), /lookup has no case/)

  const duplicate = geologyIntent()
  duplicate.relations.push({ ...duplicate.relations[0] })
  assert.throws(() => compile(duplicate), /duplicate relation/)

  const unsafePack = structuredClone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  unsafePack.templates['borehole-column'].program.steps[0].emit[0].execute = 'arbitrary-code'
  assert.throws(() => compileKnowledgeDrawing({ pack: unsafePack, intent: geologyIntent(), templateId: 'borehole-column', rootObjectId: 'hole:zk-01', expectedRevision: 0 }), /unsupported field/)
})
