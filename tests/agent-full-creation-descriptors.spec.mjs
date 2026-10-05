import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS, KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { nativeHatchIslandGeometry } from '../scripts/testing/helpers/geology-native-hatch-island-oracle.mjs'
import { projectPriorAgentDefinitions } from './helpers/prior-agent-definition-compatibility.mjs'

const hash = value => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const creationNames = ['cad_propose_drawing_pattern', 'cad_propose_drawing_annotated']
function fixture(t, units = 'millimeter') {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units })
  t.after(() => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
const input = document => ({ expectedRevision: document.revision, units: document.snapshot().header.units,
  lines: [], circles: [], arcs: [], polylines: [], arrays: [], hatches: [{ patternName: 'ANSI31', patternScale: 1,
    patternAngleDegrees: 0, loops: [
      { vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] },
      { vertices: [{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 10 }, { x: 5, y: 10 }] },
    ] }] })

test('full-bound descriptions do not change any unbound global or scalar-v1 effective wire bytes', t => {
  const { sdk, document } = fixture(t)
  assert.equal(KJDRAW_AGENT_TOOLS.length, 57)
  const priorDefinitions = projectPriorAgentDefinitions(KJDRAW_AGENT_TOOLS)
  assert.equal(hash(priorDefinitions), '2cc7ebef693b7012c0fd3be88f8eb2e9db9668853369a35a2e46fe409d8e44ef')
  const previous = priorDefinitions.filter(tool => !['cad_query_curve_bounds', 'cad_query_curve_neighborhood',
    'cad_read_hatch_patterns', 'cad_propose_hatch_pattern', 'cad_propose_geology_revision'].includes(tool.name))
  assert.equal(hash(previous), 'e53379d183b3a5acc75156020ab6807cf835955e10421195264944d58b012611')
  const scalar = new KJAgentToolSession(sdk, document, { toolProfile: 'geology-scalars-v1' })
  assert.deepEqual(scalar.definitions.map(tool => tool.name), KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES)
  assert.equal(hash(scalar.definitions), '30326cf01cd7e970ca6073ddbe0cd7a665262adb1f8f39e51bb7af68883ffd2f')
  const wire = scalar.definitions.map(tool => ({ type: 'function', function: {
    name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
  assert.equal(hash(wire), 'db26706498552e8fc1f7417de5924ef64f0e286226b84beb8efa0134f3e34689')
  assert.equal(hash(KJDRAW_AGENT_TOOLS.find(tool => tool.name === creationNames[0])), 'd6433c97c3aab5f636bae0ef037725730099d0cccc6da1d227c5b8ed3ff04e95')
  assert.equal(hash(KJDRAW_AGENT_TOOLS.find(tool => tool.name === creationNames[1])), '076e24bfb42f0c759318b91c81087a95c3773b0c1ce6fba6a50dd8952d7dc07d')
})

for (const units of ['millimeter', 'meter']) test(`full ${units} descriptions are generic truthful guidance only, with unchanged bound schema and document`, t => {
  const { sdk, document, session } = fixture(t, units), before = document.serialize(), history = structuredClone(document.history)
  const globalBefore = canonicalStringify(KJDRAW_AGENT_TOOLS)
  const definitions = session.definitions, pattern = definitions.find(tool => tool.name === creationNames[0]),
    annotated = definitions.find(tool => tool.name === creationNames[1])
  assert.match(pattern.description, /one HATCH alone/)
  assert.match(pattern.description, /loops\[0\].*outer boundary.*later loops.*empty islands/)
  assert.match(pattern.description, /No separate LINE or LWPOLYLINE is needed/)
  assert.match(pattern.description, /no TEXT.*annotation is required/)
  assert.match(pattern.description, /not geological measurements/)
  assert.match(annotated.description, /at least one actual text, dimension or leader annotation/)
  assert.match(annotated.description, /geometry-only.*cad_propose_drawing_pattern can/s)
  assert.match(annotated.description, /Do not invent a note, label, dimension or leader/)
  for (const tool of [pattern, annotated]) {
    const unbound = KJDRAW_AGENT_TOOLS.find(item => item.name === tool.name), expected = structuredClone(unbound.inputSchema)
    // The unbound table reuses text schemas elsewhere; unit binding replaces
    // this one property rather than mutating its shared clone aliases.
    expected.properties.units = { ...expected.properties.units, enum: [units] }
    assert.deepEqual(tool.inputSchema, expected)
    assert.equal(tool.effect, unbound.effect)
    assert.ok(Object.isFrozen(tool)); assert.ok(Object.isFrozen(tool.inputSchema))
    assert.doesNotMatch(JSON.stringify(tool.inputSchema), /"default"|"375"/)
  }
  assert.equal(document.serialize(), before); assert.deepEqual(document.history, history); assert.deepEqual(sdk.agentPlans.list(), [])
  assert.equal(canonicalStringify(KJDRAW_AGENT_TOOLS), globalBefore)
})

test('actual full pattern dispatch creates one closed native HATCH with empty island and no linework or annotation', async t => {
  const { sdk, document, session } = fixture(t), before = document.fingerprint()
  const result = await session.call('cad_propose_drawing_pattern', input(document))
  assert.equal(result.ok, true, JSON.stringify(result))
  const proposal = result.value
  assert.equal(proposal.command, 'CREATEBATCH'); assert.equal(proposal.status, 'awaiting-host-approval')
  assert.deepEqual(proposal.preview.after.map(entity => entity.type), ['HATCH'])
  assert.deepEqual(proposal.arguments.entities.map(entity => entity.type), ['HATCH'])
  assert.deepEqual(nativeHatchIslandGeometry(proposal.preview.after[0].payload), { outerArea: 400, islandArea: 25, filledArea: 375, loopCount: 2 })
  assert.equal(document.fingerprint(), before); assert.equal(document.history.undoCount, 0)
  const approved = await session.approve(proposal.planId, 'public-descriptor-conformance-test')
  assert.equal(approved.ok, true); assert.deepEqual(document.listEntities().map(entity => entity.type), ['HATCH'])
  assert.equal(document.history.undoCount, 1)
  await sdk.executeCommand('UNDO', {}, { document })
  assert.equal(document.fingerprint(), before)
})

test('actual annotated dispatch rejects an annotation-free hatch rather than fabricating the advertised required annotation', async t => {
  const { sdk, document, session } = fixture(t), before = document.serialize()
  const result = await session.call('cad_propose_drawing_annotated', { ...input(document), styles: [], texts: [],
    alignedDimensions: [], rotatedDimensions: [], radiusDimensions: [], diameterDimensions: [] })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'KJDOCUMENT_INVALID')
  assert.match(result.error.message, /1–64.*annotations/)
  assert.equal(document.serialize(), before); assert.equal(document.history.undoCount, 0); assert.deepEqual(sdk.agentPlans.list(), [])
})
