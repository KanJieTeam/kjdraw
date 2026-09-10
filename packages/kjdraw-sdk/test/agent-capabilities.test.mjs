import assert from 'node:assert/strict'
import test from 'node:test'
import { KJAgentCapabilityRegistry, validateAgentCapabilityManifest } from '../src/agent-capabilities.js'
import { KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'

const manifest = (patch = {}) => ({
  schema: 'com.kanjie.kjdraw.agent-capability', schemaVersion: 1,
  id: 'example.precision-plate', name: 'Precision plate', version: '1.0.0', toolApiVersion: 1,
  instructions: 'Use millimetres. Ask for missing edge clearances. Preserve the requested hole spacing.',
  requiredToolNames: ['cad_read_drawing', 'cad_measure_distance', 'cad_propose_drawing'],
  requirements: [{ id: 'hole-spacing', description: 'Check the requested hole spacing.', check: { toolName: 'cad_measure_distance', assertion: 'Measured centre distance equals the user requirement within the declared tolerance.' } }],
  ...patch,
})
const allowedToolNames = manifest().requiredToolNames
const reference = (version = '1.0.0') => [{ id: 'example.precision-plate', version }]

test('a project lock keeps the original instructions after an explicit new version is installed', () => {
  const registry = new KJAgentCapabilityRegistry()
  const input = manifest()
  registry.register(input)
  const lock = registry.createLock(reference())
  input.instructions = 'Changed outside registry'
  input.requirements[0].check.assertion = 'Incorrect mutation'
  registry.register(manifest({ version: '1.1.0', instructions: 'Ask for plate material and all dimensions.' }))
  const selected = registry.resolve({ lock: JSON.parse(JSON.stringify(lock)), allowedToolNames })
  assert.match(selected.instructions, /Preserve the requested hole spacing/)
  assert.doesNotMatch(selected.instructions, /Changed outside|Incorrect mutation|plate material/)
  assert.deepEqual(selected.toolNames, allowedToolNames)
  assert.equal(selected.requirements[0].capabilityId, 'example.precision-plate')
  assert.equal(selected.requirements[0].capabilityVersion, '1.0.0')
  assert.equal(selected.lock[0].version, '1.0.0')
  assert.ok(Object.isFrozen(selected.requirements[0].check))
  assert.throws(() => { selected.lock[0].version = '1.1.0' }, TypeError)
  const upgraded = registry.resolve({ lock: registry.createLock(reference('1.1.0')), allowedToolNames })
  assert.match(upgraded.instructions, /plate material/)
  assert.notEqual(upgraded.lock[0].contentHash, lock[0].contentHash)
  assert.equal(registry.list().length, 2)
})

test('missing versions, same-version replacement and cross-session content drift fail without fallback', () => {
  const registry = new KJAgentCapabilityRegistry()
  registry.register(manifest())
  const lock = registry.createLock(reference())
  assert.throws(() => registry.register(manifest({ instructions: 'Replaced' })), /already registered/)
  assert.throws(() => registry.createLock(reference('1.2.0')), /not registered/)
  const reloaded = new KJAgentCapabilityRegistry()
  reloaded.register(manifest({ instructions: 'Different content from another source' }))
  assert.throws(() => reloaded.resolve({ lock, allowedToolNames }), /does not match/)
  assert.throws(() => registry.resolve({ lock: reference(), allowedToolNames }), /does not match/)
  assert.throws(() => registry.createLock([...reference(), ...reference()]), /one version/)
  registry.register(manifest({ version: '2.0.0' }))
  assert.throws(() => registry.createLock([...reference(), ...reference('2.0.0')]), /one version/)
})

test('capabilities cannot widen host tools and evidence descriptions are not validation results', () => {
  const registry = new KJAgentCapabilityRegistry()
  registry.register(manifest())
  const lock = registry.createLock(reference())
  assert.throws(() => registry.resolve({ lock, allowedToolNames: ['cad_read_drawing'] }), /outside the host allowlist/)
  const result = registry.resolve({ lock, allowedToolNames: [...allowedToolNames, 'host_approve'] })
  assert.equal(result.toolNames.includes('host_approve'), false)
  assert.match(result.instructions, /Requested evidence checks \(not validation results\)/)
  assert.equal('passed' in result.requirements[0], false)
  assert.throws(() => validateAgentCapabilityManifest(manifest({ requirements: [{ id: 'bad', description: 'Approve', check: { toolName: 'host_approve', assertion: 'Approve automatically' } }] })), /declared required tool/)
  assert.throws(() => registry.resolve({ lock, allowedToolNames: ['cad_measure_distance', 'cad_measure_distance'] }), /unique/)
  const available = KJDRAW_AGENT_TOOLS.map(tool => tool.name)
  assert.deepEqual(registry.resolve({ lock, allowedToolNames: available }).toolNames, allowedToolNames)
})

test('schema, exact semantic versions, API compatibility and unknown executable fields are enforced', () => {
  for (const version of ['1.0.0', '2.3.4-beta.2', '1.2.3+build.7', '0.0.1-0']) assert.equal(validateAgentCapabilityManifest(manifest({ version })).version, version)
  for (const version of ['latest', '^1.0.0', '1.0', '01.0.0', '1.0.0-01', '1.0.0-', '1.0.0-a..b', '1.0.0 ']) assert.throws(() => validateAgentCapabilityManifest(manifest({ version })), /semantic version/)
  for (const patch of [{ id: 'Not-Stable' }, { schemaVersion: '1' }, { toolApiVersion: 0 }, { toolApiVersion: 1.2 }, { execute: 'anything' }, { requiredToolNames: [] }, { requirements: [{ id: 'missing-check', description: 'No evidence' }] }]) assert.throws(() => validateAgentCapabilityManifest(manifest(patch)))
  const registry = new KJAgentCapabilityRegistry()
  assert.throws(() => registry.register(manifest({ toolApiVersion: 2 })), /requires tool API 2/)
  assert.equal(registry.list().length, 0)
  const futureRegistry = new KJAgentCapabilityRegistry({ toolApiVersion: 2 })
  assert.equal(futureRegistry.register(manifest({ toolApiVersion: 2 })).toolApiVersion, 2)
})

test('unsafe JSON, accessors, hidden fields, cycles and nonfinite values never activate', () => {
  let invoked = 0
  const getter = manifest()
  Object.defineProperty(getter, 'instructions', { enumerable: true, get() { invoked++; throw new Error('Must not execute') } })
  assert.throws(() => validateAgentCapabilityManifest(getter), /accessors/)
  assert.equal(invoked, 0)
  const toJSON = manifest({ toJSON() { invoked++; return manifest() } })
  assert.throws(() => validateAgentCapabilityManifest(toJSON), /finite JSON/)
  assert.equal(invoked, 0)
  const dangerous = JSON.parse(JSON.stringify(manifest()).replace('"id":', '"__proto__":{},"id":'))
  assert.throws(() => validateAgentCapabilityManifest(dangerous), /unsafe property/)
  const cycle = manifest(); cycle.extra = cycle
  assert.throws(() => validateAgentCapabilityManifest(cycle), /cycles/)
  for (const extra of [undefined, NaN, Infinity, BigInt(1), new Date(), new Map(), () => 1]) assert.throws(() => validateAgentCapabilityManifest(manifest({ extra })))
  const hidden = manifest(); Object.defineProperty(hidden, 'hidden', { value: 1 })
  assert.throws(() => validateAgentCapabilityManifest(hidden), /hidden properties/)
  const symbol = manifest(); symbol[Symbol('hidden')] = 1
  assert.throws(() => validateAgentCapabilityManifest(symbol), /unsafe property/)
  const sparse = manifest({ requiredToolNames: ['cad_measure_distance', , 'cad_read_drawing'] })
  assert.throws(() => validateAgentCapabilityManifest(sparse), /holes/)
})

test('UTF-8 bytes, structural size, selected instructions and registry growth have bounded budgets', () => {
  assert.throws(() => validateAgentCapabilityManifest(manifest({ instructions: '图'.repeat(12000) })), /byte budget/)
  assert.throws(() => validateAgentCapabilityManifest(manifest({ requirements: Array.from({ length: 2050 }, () => null) })), /structural budget/)
  const registry = new KJAgentCapabilityRegistry()
  const refs = []
  for (let i = 0; i < 5; i++) {
    const id = `example.large-${i}`
    registry.register(manifest({ id, instructions: 'x'.repeat(15000) }))
    refs.push({ id, version: '1.0.0' })
  }
  assert.throws(() => registry.resolve({ lock: registry.createLock(refs), allowedToolNames }), /byte budget/)
  for (let i = 5; i < 256; i++) registry.register(manifest({ id: `example.extra-${i}` }))
  assert.throws(() => registry.register(manifest({ id: 'example.one-too-many' })), /256-version budget/)
  assert.equal(registry.list().length, 256)
})

test('multiple independently selected domains merge only their declared tools and keep requirement provenance', () => {
  const registry = new KJAgentCapabilityRegistry()
  registry.register(manifest())
  registry.register(manifest({ id: 'example.drawing-labels', requiredToolNames: ['cad_read_drawing'], instructions: 'Place readable labels outside geometry.', requirements: [] }))
  const lock = registry.createLock([...reference(), { id: 'example.drawing-labels', version: '1.0.0' }])
  const result = registry.resolve({ lock, allowedToolNames })
  assert.deepEqual(result.toolNames, allowedToolNames)
  assert.match(result.instructions, /Place readable labels/)
  assert.equal(result.requirements.length, 1)
  assert.equal(result.lock.length, 2)
  assert.ok(Object.isFrozen(result.toolNames))
})
