// Generated from agent-compact-tool-surface.ts by scripts/build-typescript.mjs. Do not edit directly.
const descriptions = Object.freeze({
    cad_propose_drawing_basic: 'Propose one editable 2D drawing from lines, circles, arcs and polylines. Coordinates are millimeters; approval is required.',
    cad_propose_manufacturing_sheet: 'Propose an editable manufacturing sheet with orthographic views, holes and native dimensions from the supplied design parameters. Approval is required.',
    cad_propose_move: 'Move selected existing entities by dx and dy. Pass stable feature IDs in ids; approval is required.',
    cad_propose_scale: 'Scale selected existing entities around center by factor. Pass stable feature IDs in ids; approval is required.',
    cad_propose_stretch: 'STRETCH only LINE or 2D POLYLINE defining vertices inside/on the crossing window by dx and dy. Use a narrow window around endpoints to change one edge; enclosing every vertex moves the whole shape. ARC/CIRCLE cannot STRETCH: use MOVE for rigid translation. Pass stable feature IDs in ids; approval is required.'
});
export function routeCompactCadTools({ prompt, hasEditableSeed = false }) {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('INVALID_CAD_TOOL_ROUTE_PROMPT');
    if (!hasEditableSeed) return /ISO A[0-4] landscape sheet/i.test(prompt) && /dimension text/i.test(prompt) ? [
        'cad_propose_manufacturing_sheet'
    ] : [
        'cad_propose_drawing_basic'
    ];
    if (/^\s*Extend only the rounded slot\b/i.test(prompt)) return [
        'cad_propose_stretch',
        'cad_propose_move'
    ];
    if (/^\s*Move\b/i.test(prompt)) return [
        'cad_propose_move'
    ];
    if (/^\s*(?:Change only .*\bdiameter\b|Engineering correction: set .*\bradius\b)/i.test(prompt)) return [
        'cad_propose_scale'
    ];
    if (/^\s*Set the boundary .*\bedge\b/i.test(prompt)) return [
        'cad_propose_stretch'
    ];
    throw new Error('UNSUPPORTED_CAD_EDIT_INTENT');
}
export function projectCompactCadTools({ definitions, names, hostOwnsRevisionAndUnits = false }) {
    if (!Array.isArray(definitions) || !Array.isArray(names) || !names.length || new Set(names).size !== names.length) throw new Error('INVALID_COMPACT_TOOL_SELECTION');
    return names.map((name)=>{
        const definition = definitions.find((tool)=>tool.name === name);
        if (!definition || !Object.hasOwn(descriptions, name)) throw new Error('UNSUPPORTED_COMPACT_CAD_TOOL');
        const schema = structuredClone(definition.inputSchema);
        if (hostOwnsRevisionAndUnits) {
            delete schema.properties?.expectedRevision;
            delete schema.properties?.units;
            if (Array.isArray(schema.required)) schema.required = schema.required.filter((field)=>field !== 'expectedRevision' && field !== 'units');
        }
        return {
            type: 'function',
            function: {
                name,
                description: descriptions[name],
                parameters: schema
            }
        };
    });
}
