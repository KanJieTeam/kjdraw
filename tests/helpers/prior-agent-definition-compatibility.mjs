import assert from 'node:assert/strict'

// Preserve the existing pre-extension hashes rather than replacing them with
// whatever the current implementation happens to produce. This projection is
// test-only: no model, approval or benchmark receives rewritten definitions.
// Every intentional addition is asserted before removing only that addition.
const oldContract = 'For selected existing stratum name/lithology/description/code edits, use updates[].stratumChanges.update with target:{intervalId,expectedTop,expectedBottom} from the same BEFORE source and set containing only requested changed fields. Preserve every unrequested field and interval, including pattern/group/notation/provenance and optional-field presence. No additions, deletions, ID or boundary changes, inferred links or duplicate targets. Never combine stratumChanges with a complete strata replacement. '
const newContract = 'For selected existing stratum name/lithology/description/code or patternVisibility edits, use updates[].stratumChanges.update with target:{intervalId,expectedTop,expectedBottom} from the same BEFORE source and set containing only requested changed fields. patternVisibility=filled restores the stored pattern; boundary-only hides its fill while retaining boundaries and source classification. This display change never reclassifies soil or replaces a pattern definition. Preserve every unrequested field and interval, including pattern/group/notation/provenance and optional-field presence. No additions, deletions, ID or boundary changes, inferred links or duplicate targets. Never combine stratumChanges with a complete strata replacement. '
const oldSetDescription = 'Nonempty requested changed fields only: name, lithology, description or code. Every other source field stays exact; no clearing, identities, depths, pattern patches or implicit changes.'
const newSetDescription = 'Nonempty requested changed fields only: name, lithology, description, code or patternVisibility (filled/boundary-only). Every other source field stays exact; no clearing, identities, depths, pattern definition patches or implicit changes.'

export function projectPriorAgentDefinitions(definitions) {
  return definitions.map(definition => {
    const tool = structuredClone(definition)
    if (tool.name === 'cad_propose_geology_revision') {
      const delta = tool.inputSchema.properties.updates.items.properties.stratumChanges
      assert.equal(delta.description, newContract)
      assert.ok(tool.description.includes(newContract))
      const set = delta.properties.update.items.properties.set
      assert.deepEqual(Object.keys(set.properties), ['name', 'lithology', 'description', 'code', 'patternVisibility'])
      assert.deepEqual(set.properties.patternVisibility, { type: 'string', enum: ['filled', 'boundary-only'] })
      assert.equal(set.description, newSetDescription)
      assert.equal(set.additionalProperties, false)
      assert.equal(set.required.includes('patternVisibility'), false)
      delete set.properties.patternVisibility
      set.description = oldSetDescription
      delta.description = oldContract
      tool.description = tool.description.replace(newContract, oldContract)
    }
    const descriptions = tool.name === 'cad_propose_geology_column'
      ? {
        projectName: 'Exact caller-declared project name only. Omit when not supplied; do not invent a test project name.',
        title: 'Exact caller-declared drawing title only. Omit when not supplied; the compiler selects its standard title.',
      }
      : tool.name === 'cad_propose_geology_plan'
        ? {
          title: 'Exact caller-declared drawing title only. Omit when not supplied; keep any supplied title verbatim.',
          revision: 'Optional caller-declared printed title-block revision, NOT expectedRevision or the host document revision. Omit when the caller has not supplied a printed revision.',
        } : {}
    for (const [field, description] of Object.entries(descriptions)) {
      assert.equal(tool.inputSchema.properties[field].description, description)
      delete tool.inputSchema.properties[field].description
    }
    return tool
  })
}
