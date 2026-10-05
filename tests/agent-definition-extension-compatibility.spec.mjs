import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { projectPriorAgentDefinitions } from './helpers/prior-agent-definition-compatibility.mjs'

const hash = value => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const previousHash = '2cc7ebef693b7012c0fd3be88f8eb2e9db9668853369a35a2e46fe409d8e44ef'
test('compatibility projection never mutates the live definition table or removes actual optional support', () => {
  const before = canonicalStringify(KJDRAW_AGENT_TOOLS)
  const projected = projectPriorAgentDefinitions(KJDRAW_AGENT_TOOLS)
  assert.equal(hash(projected), previousHash)
  assert.equal(canonicalStringify(KJDRAW_AGENT_TOOLS), before)
  const live = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_geology_revision')
  assert.deepEqual(live.inputSchema.properties.updates.items.properties.stratumChanges.properties.update.items.properties.set.properties.patternVisibility,
    { type: 'string', enum: ['filled', 'boundary-only'] })
})

test('compatibility projection rejects undocumented extension changes rather than masking them', () => {
  for (const alter of [
    definitions => definitions.find(tool => tool.name === 'cad_propose_geology_revision').inputSchema.properties.updates.items.properties.stratumChanges.properties.update.items.properties.set.properties.patternVisibility.enum.push('hidden'),
    definitions => definitions.find(tool => tool.name === 'cad_propose_geology_revision').inputSchema.properties.updates.items.properties.stratumChanges.properties.update.items.properties.set.required.push('patternVisibility'),
    definitions => definitions.find(tool => tool.name === 'cad_propose_geology_column').inputSchema.properties.projectName.description = 'Invent a project',
  ]) {
    const definitions = structuredClone(KJDRAW_AGENT_TOOLS)
    alter(definitions)
    assert.throws(() => projectPriorAgentDefinitions(definitions), assert.AssertionError)
  }
})

test('pre-extension hash still detects unrelated numeric bounds, types and required-field changes', () => {
  const definitions = structuredClone(KJDRAW_AGENT_TOOLS)
  definitions.find(tool => tool.name === 'cad_propose_geology_column').inputSchema.properties.projectName.maxLength = 65
  assert.notEqual(hash(projectPriorAgentDefinitions(definitions)), previousHash)
})
