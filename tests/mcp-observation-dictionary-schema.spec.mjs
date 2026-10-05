import test from 'node:test'
import assert from 'node:assert/strict'
import { KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { assertPortableMcpInputSchema, portableMcpInputSchema } from '../packages/kjdraw-sdk/src/mcp-schema-compat.js'

test('portable geology revision preserves bounded numerical dictionary values instead of publishing an unconstrained object', () => {
  const tool = KJDRAW_AGENT_TOOLS.find(item => item.name === 'cad_propose_geology_revision')
  const original = structuredClone(tool.inputSchema), portable = portableMcpInputSchema(tool.inputSchema)
  const observation = portable.properties.updates.items.properties.observations.items
  assert.equal(observation.properties.measurements.type, 'object')
  assert.deepEqual(observation.properties.measurements.additionalProperties, {
    type: 'number', minimum: -1e6, maximum: 1e6,
  })
  assert.deepEqual(observation.properties.measurements.properties, {})
  assert.deepEqual(observation.properties.measurements.required, [])
  assertPortableMcpInputSchema(portable)
  assert.deepEqual(tool.inputSchema, original, 'portable conversion must not weaken the authoritative runtime schema')
})

test('portable recursive dictionary child retains scalar bounds and converts only known nonportable constraints', () => {
  const original = { type: 'object', properties: {}, required: [], maxProperties: 16,
    propertyNames: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]{0,23}$' },
    additionalProperties: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
  }
  const portable = portableMcpInputSchema(original)
  assert.equal(portable.additionalProperties.type, 'number')
  assert.ok(portable.additionalProperties.minimum > 0)
  assert.equal(portable.additionalProperties.maximum, 100)
  assert.equal(Object.hasOwn(portable, 'propertyNames'), false, 'host runtime keeps safe-key checks outside provider dialect')
  assert.equal(Object.hasOwn(portable, 'maxProperties'), false, 'host runtime keeps cardinality bounds outside provider dialect')
  assertPortableMcpInputSchema(portable)
  assert.equal(original.additionalProperties.exclusiveMinimum, 0)
})

test('portable checker traverses dictionary values and rejects an unsupported hidden child keyword', () => {
  assert.throws(() => assertPortableMcpInputSchema({ type: 'object', properties: {}, required: [],
    additionalProperties: { type: 'number', format: 'made-up-format' },
  }), /additionalProperties.*unsupported MCP schema keyword format/)
})

test('closed object schemas remain closed and every public tool still passes the portable provider contract', () => {
  for (const tool of KJDRAW_AGENT_TOOLS) {
    const portable = portableMcpInputSchema(tool.inputSchema)
    assertPortableMcpInputSchema(portable)
    assert.equal(portable.additionalProperties, false, tool.name)
  }
})
