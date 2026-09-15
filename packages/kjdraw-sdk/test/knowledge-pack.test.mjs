import test from 'node:test'
import assert from 'node:assert/strict'
import { KJKnowledgePackRegistry, KJDRAW_KNOWLEDGE_PACK_SCHEMA, KJDRAW_SEMANTIC_IR_SCHEMA, validateKnowledgePack, validateSemanticDrawingIntent } from '../src/knowledge-pack.js'

const pack = () => ({
  schema: KJDRAW_KNOWLEDGE_PACK_SCHEMA, id: 'geology.core', version: '1.0.0', title: 'Engineering geology', domain: 'geology',
  license: { spdx: 'MIT', redistributable: true, trainingAllowed: false }, sources: [{ id: 'kanjie-derived', title: 'Derived semantic rules', license: 'internal', contentHash: '0123456789abcdef' }],
  ontology: { objectKinds: ['borehole', 'stratum', 'legend'], relationKinds: ['contains', 'correlates'] },
  rules: { hatch: { clay: 'ANSI37' } },
})
const intent = () => ({
  schema: KJDRAW_SEMANTIC_IR_SCHEMA, packId: 'geology.core', packVersion: '1.0.0', drawing: { kind: 'section', title: 'Test section', units: 'millimeter' },
  objects: [{ id: 'hole-1', kind: 'borehole', properties: { station: 0 } }, { id: 'stratum-1', kind: 'stratum', properties: { code: 'A', topDepth: 0, bottomDepth: 2 } }, { id: 'legend-1', kind: 'legend', properties: {} }],
  relations: [{ kind: 'contains', from: 'hole-1', to: 'stratum-1' }],
})

test('knowledge pack validation is strict, immutable and content-addressable', () => {
  const registry = new KJKnowledgePackRegistry(), registered = registry.register(pack())
  assert.ok(Object.isFrozen(registered)); assert.equal(registry.get('geology.core', '1.0.0').id, 'geology.core'); assert.equal(registry.contentHash(), registry.contentHash())
  assert.throws(() => registry.register(pack()), /already registered/)
  assert.throws(() => registry.register({ ...pack(), id: 'private.pack', license: { ...pack().license, redistributable: false } }), /not redistributable/)
  assert.throws(() => validateKnowledgePack({ ...pack(), rawDrawing: 'binary' }), /rawDrawing/)
})

test('semantic IR validates against the selected pack and forbids undeclared kinds or dangling relations', () => {
  const knowledge = validateKnowledgePack(pack()), result = validateSemanticDrawingIntent(intent(), knowledge)
  assert.ok(Object.isFrozen(result)); assert.equal(result.objects.length, 3)
  assert.throws(() => validateSemanticDrawingIntent({ ...intent(), objects: [{ id: 'x', kind: 'unknown', properties: {} }], relations: [] }, knowledge), /not declared/)
  assert.throws(() => validateSemanticDrawingIntent({ ...intent(), relations: [{ kind: 'contains', from: 'hole-1', to: 'missing' }] }, knowledge), /unknown object/)
})

test('knowledge pack accepts bounded declarative programs but rejects excessive nesting', () => {
  const allowed = pack()
  allowed.templates = { sample: { program: { op: { op: { op: { value: 1 } } } } } }
  assert.equal(validateKnowledgePack(allowed).templates.sample.program.op.op.op.value, 1)

  const excessive = pack()
  let cursor = excessive
  for (let index = 0; index < 30; index += 1) {
    cursor.rules = { nested: {} }
    cursor = cursor.rules.nested
  }
  assert.throws(() => validateKnowledgePack(excessive), /exceeds the data budget/)
})
