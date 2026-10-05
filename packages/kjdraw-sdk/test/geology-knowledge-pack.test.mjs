import assert from 'node:assert/strict'
import test from 'node:test'

import {
  KJDRAW_GEOLOGY_KNOWLEDGE_PACK,
  KJDRAW_SEMANTIC_IR_SCHEMA,
  KJKnowledgePackRegistry,
  registerGeologyKnowledgePack,
  validateSemanticDrawingIntent,
} from '../src/index.js'

test('bundled geology pack is redistributable semantic data with explicit safety boundaries', () => {
  const pack = KJDRAW_GEOLOGY_KNOWLEDGE_PACK
  assert.equal(pack.id, 'geology.core')
  assert.equal(pack.version, '1.0.0')
  assert.deepEqual(pack.license, {
    spdx: 'Apache-2.0',
    redistributable: true,
    trainingAllowed: true,
  })
  assert.ok(pack.ontology.objectKinds.includes('borehole'))
  assert.ok(pack.ontology.objectKinds.includes('stratum'))
  assert.ok(pack.ontology.relationKinds.includes('correlates-with'))
  assert.equal(pack.rules['data-boundary'].interpretation, 'do-not-invent-strata-or-correlations')
  assert.equal(pack.rules['section-correlation'].boreholeOrder, 'use-declared-sequence-never-nearest-neighbour-order')
  assert.equal(pack.rules['lithology-fill'].priority, 'explicit-pattern-key-before-lithology-class-default')
  assert.equal(pack.rules['lithology-pattern-roles'].weatheredRock, 'broken-inclined-bed')
  assert.equal(pack.rules['lithology-fill'].customPatternData, 'must-be-supplied-by-a-separately-licensed-pack')
  assert.doesNotMatch(JSON.stringify(pack), /rawDrawing|\.dwg|\.dxf|mdb|entities/i)
  assert.ok(Object.isFrozen(pack))
})

test('geology pack validates a borehole-column semantic intent without CAD primitives', () => {
  const intent = validateSemanticDrawingIntent({
    schema: KJDRAW_SEMANTIC_IR_SCHEMA,
    packId: 'geology.core',
    packVersion: '1.0.0',
    drawing: { kind: 'borehole-column', title: 'Exploration hole ZK-01', units: 'meter' },
    objects: [
      { id: 'hole:zk-01', kind: 'borehole', properties: { collarElevation: 103.2, depth: 18 } },
      { id: 'layer:1', kind: 'stratum', properties: { top: 0, bottom: 6.5, lithology: 'fill' } },
      { id: 'layer:2', kind: 'stratum', properties: { top: 6.5, bottom: 18, lithology: 'clay' } },
      { id: 'pattern:clay', kind: 'hatch-pattern', properties: { key: 'clay' } },
    ],
    relations: [
      { kind: 'contains-stratum', from: 'hole:zk-01', to: 'layer:1' },
      { kind: 'contains-stratum', from: 'hole:zk-01', to: 'layer:2' },
      { kind: 'stratigraphic-overlies', from: 'layer:1', to: 'layer:2' },
      { kind: 'uses-hatch-pattern', from: 'layer:2', to: 'pattern:clay' },
    ],
  }, KJDRAW_GEOLOGY_KNOWLEDGE_PACK)

  assert.equal(intent.objects.length, 4)
  assert.equal(intent.relations.length, 4)
  assert.ok(Object.isFrozen(intent))
})

test('geology pack uses the generic registry and rejects undeclared geology guesses', () => {
  const registry = new KJKnowledgePackRegistry()
  const pack = registerGeologyKnowledgePack(registry)
  assert.equal(registry.get('geology.core', '1.0.0'), pack)
  assert.throws(() => validateSemanticDrawingIntent({
    schema: KJDRAW_SEMANTIC_IR_SCHEMA,
    packId: 'geology.core',
    packVersion: '1.0.0',
    drawing: { kind: 'geology-section', title: 'Unverified section', units: 'meter' },
    objects: [
      { id: 'fault:guessed', kind: 'inferred-fault', properties: { confidence: 0.3 } },
    ],
    relations: [],
  }, pack), /not declared by the pack/)
})
