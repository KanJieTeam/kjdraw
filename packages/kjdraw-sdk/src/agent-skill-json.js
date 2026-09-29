// Generated from agent-skill-json.ts by scripts/build-typescript.mjs. Do not edit directly.
import { projectCompactCadTools } from './agent-compact-tool-surface.js';
const fail = (code)=>{
    const error = new Error(code);
    error.code = code;
    throw error;
};
const plainObject = (value)=>value !== null && typeof value === 'object' && !Array.isArray(value);
const fieldHints = Object.freeze({
    cad_propose_drawing_basic: 'Array order: lines=[x1,y1,x2,y2], circles=[cx,cy,r], arcs=[cx,cy,r,startDegrees,endDegrees], polyline points=[x,y]. Represent each requested hole as a circle; a pitch circle or polygon is not a substitute for holes.',
    cad_propose_manufacturing_sheet: 'Point pairs are [x,y]; sheet.size=[width,height]. Rectangular rows x columns (including a 2 x 2 mounting grid) belong in holePatterns with origin and spacing; boltCirclePatterns is only for holes explicitly arranged around a pitch circle. The SDK generates editable views and native dimensions from these design parameters.'
});
function shape(schema) {
    if (!plainObject(schema)) return fail('UNSUPPORTED_SKILL_JSON_SCHEMA');
    const node = schema;
    if (Array.isArray(node.enum)) return node.enum.map((value)=>JSON.stringify(value)).join('|');
    if (node.type === 'object') {
        if (!plainObject(node.properties)) return fail('UNSUPPORTED_SKILL_JSON_SCHEMA');
        const required = new Set(node.required ?? []);
        return `{${Object.entries(node.properties).map(([name, field])=>`${name}${required.has(name) ? '!' : '?'}:${shape(field)}`).join(',')}}`;
    }
    if (node.type === 'array') {
        const item = shape(node.items);
        const length = node.minItems === node.maxItems ? `[${node.minItems}]` : `[${node.minItems ?? 0}..${node.maxItems ?? '*'}]`;
        return `${item}${length}`;
    }
    if (node.type === 'number' || node.type === 'integer') {
        if (node.exclusiveMinimum === 0) return `${node.type}>0`;
        if (node.minimum !== undefined && node.maximum !== undefined && Math.abs(node.minimum) < 1e9 && Math.abs(node.maximum) < 1e9) return `${node.type}(${node.minimum}..${node.maximum})`;
        return node.type;
    }
    if (node.type === 'string' || node.type === 'boolean') return node.type;
    return fail('UNSUPPORTED_SKILL_JSON_SCHEMA');
}
export function buildCadSkillJsonContract({ definitions, names, hostOwnsRevisionAndUnits = true }) {
    const tools = projectCompactCadTools({
        definitions,
        names,
        hostOwnsRevisionAndUnits
    });
    const operations = tools.map((tool)=>`${tool.function.name}: ${tool.function.description}${fieldHints[tool.function.name] ? ` ${fieldHints[tool.function.name]}` : ''}\nargs=${shape(tool.function.parameters)}`);
    return [
        'Return only valid JSON: {"calls":[{"tool":"one listed name","args":{...}}]}. Make 1 to 8 calls in order; no prose or Markdown. Check matching brackets and include every requested feature.',
        'In args, ! means required and ? optional; use no unlisted fields. Numeric coordinates are millimeters. The host fills current revision/units and maps stable feature IDs in ids to native entity IDs. Every call is validated by the SDK and requires approval before application.',
        ...operations
    ].join('\n');
}
export function parseCadSkillJsonResponse({ content, names, maxCalls = 8 }) {
    if (typeof content !== 'string' || new TextEncoder().encode(content).length > 2 * 1024 * 1024 || !Array.isArray(names) || !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 8) fail('INVALID_SKILL_JSON_RESPONSE');
    let parsed;
    try {
        parsed = JSON.parse(content.trim());
    } catch  {
        fail('INVALID_SKILL_JSON_RESPONSE');
    }
    if (!plainObject(parsed) || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.calls) || parsed.calls.length < 1 || parsed.calls.length > maxCalls) return fail('INVALID_SKILL_JSON_RESPONSE');
    const allowed = new Set(names);
    return parsed.calls.map((call)=>{
        if (!plainObject(call) || Object.keys(call).length !== 2 || typeof call.tool !== 'string' || !plainObject(call.args)) return fail('INVALID_SKILL_JSON_RESPONSE');
        if (!allowed.has(call.tool)) return fail('DISALLOWED_SKILL_JSON_TOOL');
        return {
            tool: call.tool,
            args: call.args
        };
    });
}
