// Generated from hatch-pattern-catalog.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { validateKnowledgePack } from './knowledge-pack.js';
import { deepFreeze, stableHash } from './utils.js';
const fail = (message)=>{
    throw new KJValidationError(`PAT catalog: ${message}`);
};
const boundedName = (value, label, maximum)=>{
    const result = value.trim();
    if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) fail(`${label} must be bounded printable text`);
    return result;
};
const number = (value, label)=>{
    const result = Number(value.trim());
    if (!Number.isFinite(result) || Math.abs(result) > 1e12) fail(`${label} must be a bounded finite number`);
    return result;
};
export function parseAutoCADPat(source) {
    if (typeof source !== 'string' || !source.length || source.length > 5_000_000 || source.includes('\0')) fail('source must contain 1-5,000,000 text characters');
    const patterns = [];
    let current;
    const normalizedSource = source.replace(/^\uFEFF/, '').split('\u001a', 1)[0];
    for (const [lineIndex, rawLine] of normalizedSource.split(/\r?\n/).entries()){
        const line = rawLine.trim();
        if (!line || line.startsWith(';')) continue;
        if (line === '*') {
            current = undefined;
            continue;
        }
        if (line.startsWith('*')) {
            if (patterns.length >= 4096) fail('source contains more than 4096 patterns');
            const comma = line.indexOf(',');
            const name = boundedName(line.slice(1, comma < 0 ? undefined : comma), `line ${lineIndex + 1} pattern name`, 128);
            if (patterns.some((pattern)=>pattern.name.toUpperCase() === name.toUpperCase())) fail(`line ${lineIndex + 1} duplicates pattern ${name}`);
            current = {
                name,
                description: comma < 0 ? '' : line.slice(comma + 1).trim().slice(0, 256),
                lines: []
            };
            if (/[\u0000-\u001f\u007f]/.test(current.description)) fail(`line ${lineIndex + 1} description contains control characters`);
            patterns.push(current);
            continue;
        }
        if (!current) throw new KJValidationError(`PAT catalog: line ${lineIndex + 1} appears before a pattern header`);
        if (current.lines.length >= 4096) fail(`pattern ${current.name} contains more than 4096 line families`);
        const fields = line.split(',');
        if (fields.length < 5 || fields.length > 133) fail(`line ${lineIndex + 1} must contain 5-133 comma-separated numbers`);
        const values = fields.map((value, index)=>number(value, `line ${lineIndex + 1} field ${index + 1}`));
        const dashes = values.slice(5);
        if (dashes.length && dashes.every((value)=>value === 0)) fail(`line ${lineIndex + 1} dash cycle cannot contain only dots`);
        current.lines.push({
            angle: values[0] * Math.PI / 180,
            base: [
                values[1],
                values[2]
            ],
            offset: [
                values[3],
                values[4]
            ],
            dashes
        });
    }
    if (!patterns.length || patterns.some((pattern)=>!pattern.lines.length)) fail('every PAT pattern must contain at least one line family');
    return deepFreeze({
        version: '1.0.0',
        contentHash: stableHash(patterns),
        patterns
    });
}
export function hatchPatternFromCatalog(source, name, options = {}) {
    const pattern = source.patterns.find((item)=>item.name.toUpperCase() === String(name).trim().toUpperCase());
    if (!pattern) throw new KJValidationError(`PAT catalog: pattern does not exist: ${String(name)}`);
    const scale = options.scale ?? 1, angle = (options.angleDegrees ?? 0) * Math.PI / 180;
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1e12 || !Number.isFinite(angle)) fail('pattern scale and angle must be finite, with a positive scale');
    if (!pattern.lines.length || pattern.lines.length > 4096) fail('selected pattern must contain 1-4096 line families');
    const patternLines = pattern.lines.map((line, index)=>{
        const values = [
            line.angle,
            ...line.base,
            ...line.offset,
            ...line.dashes
        ];
        if (line.base.length !== 2 || line.offset.length !== 2 || line.dashes.length > 128 || values.some((value)=>!Number.isFinite(value) || Math.abs(value) > 1e12)) fail(`selected pattern line ${index + 1} is invalid`);
        if (line.dashes.length && line.dashes.every((value)=>value === 0)) fail(`selected pattern line ${index + 1} dash cycle cannot contain only dots`);
        return {
            angle: line.angle,
            base: [
                ...line.base
            ],
            offset: [
                ...line.offset
            ],
            dashes: [
                ...line.dashes
            ]
        };
    });
    return deepFreeze({
        patternName: pattern.name,
        patternLines,
        patternDefinitionAngle: 0,
        patternDefinitionScale: 1,
        patternScale: scale,
        patternAngle: angle
    });
}
export function buildHatchPatternKnowledgePack(input) {
    const catalog = parseAutoCADPat(input.patSource);
    if (!Array.isArray(input.selectedPatterns) || input.selectedPatterns.length < 1 || input.selectedPatterns.length > 64 || new Set(input.selectedPatterns.map((name)=>String(name).trim().toUpperCase())).size !== input.selectedPatterns.length) fail('selectedPatterns must contain 1-64 unique names');
    const selected = input.selectedPatterns.map((name)=>{
        const pattern = catalog.patterns.find((item)=>item.name.toUpperCase() === String(name).trim().toUpperCase());
        if (!pattern) fail(`selected pattern does not exist: ${String(name)}`);
        return pattern;
    });
    if (selected.reduce((sum, pattern)=>sum + pattern.lines.length, 0) > 1024) fail('selected patterns exceed 1024 total line families');
    if (!input.mappings || typeof input.mappings !== 'object' || Array.isArray(input.mappings) || Object.keys(input.mappings).length < 1 || Object.keys(input.mappings).length > 256) fail('mappings must contain 1-256 semantic keys');
    const names = new Set(selected.map((pattern)=>pattern.name.toUpperCase()));
    const mappings = {};
    for (const [key, value] of Object.entries(input.mappings)){
        const semanticKey = boundedName(key, 'mapping key', 96), patternName = boundedName(String(value), `mapping ${key}`, 128);
        if (!names.has(patternName.toUpperCase())) fail(`mapping ${semanticKey} references an unselected pattern`);
        mappings[semanticKey] = selected.find((pattern)=>pattern.name.toUpperCase() === patternName.toUpperCase()).name;
    }
    return validateKnowledgePack({
        schema: 'kjdraw.knowledge-pack.v1',
        id: input.id,
        version: input.version,
        title: input.title,
        domain: input.domain,
        license: input.license,
        sources: input.sources,
        ontology: {
            objectKinds: [
                'hatch-pattern'
            ],
            relationKinds: [
                'uses-hatch-pattern'
            ]
        },
        rules: {
            'hatch-pattern-catalog': {
                version: catalog.version,
                contentHash: stableHash(selected),
                patterns: selected,
                mappings
            }
        }
    });
}
export function hatchPatternFromKnowledgePack(packSource, semanticKey, options = {}) {
    const pack = validateKnowledgePack(packSource);
    const rules = pack.rules?.['hatch-pattern-catalog'];
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) fail('knowledge pack has no hatch-pattern-catalog');
    const source = rules;
    if (!Array.isArray(source.patterns) || !source.mappings || typeof source.mappings !== 'object' || Array.isArray(source.mappings)) fail('knowledge pack hatch catalog is invalid');
    const mapping = source.mappings[boundedName(semanticKey, 'semantic key', 96)];
    if (typeof mapping !== 'string') fail(`semantic mapping does not exist: ${semanticKey}`);
    const patterns = source.patterns;
    return hatchPatternFromCatalog({
        version: '1.0.0',
        contentHash: stableHash(patterns),
        patterns
    }, mapping, options);
}
