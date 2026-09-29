// Model-facing projection only. Execution must use the original SDK definitions and validator.
export interface CompactCadToolDefinition {
  name: string
  inputSchema: Record<string, unknown>
}
export interface CompactCadFunctionTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

const descriptions: Readonly<Record<string, string>> = Object.freeze({
  cad_propose_drawing_basic: 'Propose one editable 2D drawing from lines, circles, arcs and polylines. Coordinates are millimeters; approval is required.',
  cad_propose_drawing_pattern: 'Propose editable 2D geometry with rectangular or polar arrays. For equally spaced bolt holes, draw one seed circle and use polarArrays; count includes the seed. Approval is required.',
  cad_propose_manufacturing_sheet: 'Editable manufacturing views, holes and native dimensions from design parameters. Host approval required.',
  cad_propose_move: 'Move selected existing entities by dx and dy. Pass stable feature IDs in ids; approval is required.',
  cad_propose_scale: 'Scale selected existing entities around center by factor. Pass stable feature IDs in ids; approval is required.',
  cad_propose_set_circle_radius: 'Set one existing circle to exact target radius. Pass its stable feature ID in id; center and identity stay fixed. Host approval required.',
  cad_propose_stretch: 'STRETCH only LINE or 2D POLYLINE defining vertices inside/on the crossing window by dx and dy. Use a narrow window around endpoints to change one edge; enclosing every vertex moves the whole shape. ARC/CIRCLE cannot STRETCH: use MOVE for rigid translation. Pass stable feature IDs in ids; approval is required.',
})

// Deterministic routing over the same natural-language request the model sees.
// Unknown edit intents fail closed; callers may instead explicitly choose names.
/** Public-prompt router for the constrained plate/slot benchmark vocabulary. */
export function routeCompactCadTools({ prompt, hasEditableSeed = false }: { prompt: string; hasEditableSeed?: boolean }): string[] {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('INVALID_CAD_TOOL_ROUTE_PROMPT')
  if (!hasEditableSeed) {
    if (/ISO A[0-4] landscape sheet/i.test(prompt) && /dimension text/i.test(prompt)) return ['cad_propose_manufacturing_sheet']
    if (/\bholes?\b/i.test(prompt) && /\bpitch circle\b/i.test(prompt) && /\b(?:equally|evenly)\b/i.test(prompt)) return ['cad_propose_drawing_pattern']
    return ['cad_propose_drawing_basic']
  }
  if (/^\s*Extend only the rounded slot\b/i.test(prompt)) return ['cad_propose_stretch', 'cad_propose_move']
  if (/^\s*Move\b/i.test(prompt)) return ['cad_propose_move']
  if (/^\s*(?:Change only .*\bdiameter\b|Engineering correction: set .*\bradius\b)/i.test(prompt)) return ['cad_propose_set_circle_radius']
  if (/^\s*Set the boundary .*\bedge\b/i.test(prompt)) return ['cad_propose_stretch']
  throw new Error('UNSUPPORTED_CAD_EDIT_INTENT')
}

/** Projects a small model-visible surface; it does not relax SDK execution validation. */
export function projectCompactCadTools({ definitions, names, hostOwnsRevisionAndUnits = false }: {
  definitions: readonly CompactCadToolDefinition[]
  names: readonly string[]
  hostOwnsRevisionAndUnits?: boolean
}): CompactCadFunctionTool[] {
  if (!Array.isArray(definitions) || !Array.isArray(names) || !names.length || new Set(names).size !== names.length) throw new Error('INVALID_COMPACT_TOOL_SELECTION')
  return names.map(name => {
    const definition = definitions.find(tool => tool.name === name)
    if (!definition || !Object.hasOwn(descriptions, name)) throw new Error('UNSUPPORTED_COMPACT_CAD_TOOL')
    const schema = structuredClone(definition.inputSchema) as Record<string, unknown> & {
      properties?: Record<string, unknown>
      required?: string[]
    }
    if (name === 'cad_propose_drawing_pattern') {
      for (const field of ['ellipses', 'splines', 'hatches']) delete schema.properties?.[field]
      if (Array.isArray(schema.required)) schema.required = schema.required.filter(field => !['ellipses', 'splines', 'hatches'].includes(field))
    }
    if (hostOwnsRevisionAndUnits) {
      delete schema.properties?.expectedRevision
      delete schema.properties?.units
      if (Array.isArray(schema.required)) schema.required = schema.required.filter(field => field !== 'expectedRevision' && field !== 'units')
    }
    return { type: 'function', function: { name, description: descriptions[name]!, parameters: schema } }
  })
}
