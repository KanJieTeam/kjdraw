// Generated from agent-mechanical-flange-core.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK } from './knowledge-packs/mechanical-flange-core.js';
import { stableHash } from './utils.js';
export const KJDRAW_MECHANICAL_FLANGE_CORE_VERSION = '1.0.0';
const finite = (value, label, min, max)=>{
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new KJValidationError(`${label} must be finite from ${min} to ${max}`);
    return value;
};
const plain = (value, label)=>{
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![
        Object.prototype,
        null
    ].includes(Object.getPrototypeOf(value))) throw new KJValidationError(`${label} must be a plain object`);
    return value;
};
const exact = (value, keys, label)=>{
    const extra = Object.keys(value).find((key)=>!keys.includes(key));
    if (extra) throw new KJValidationError(`${label} contains unsupported field: ${extra}`);
};
const point = (value, label)=>{
    if (!Array.isArray(value) || value.length !== 2) throw new KJValidationError(`${label} must contain two coordinates`);
    return [
        finite(value[0], `${label}[0]`, -1_000_000, 1_000_000),
        finite(value[1], `${label}[1]`, -1_000_000, 1_000_000)
    ];
};
const increasing = (value, label, maxCount, min, max)=>{
    if (!Array.isArray(value) || value.length > maxCount) throw new KJValidationError(`${label} exceeds its item budget`);
    const result = value.map((item, index)=>finite(item, `${label}[${index}]`, min, max));
    if (result.some((item, index)=>index > 0 && item <= result[index - 1])) throw new KJValidationError(`${label} must increase strictly`);
    return result;
};
function validate(document, source) {
    if (!document || typeof document.id !== 'string' || !Number.isSafeInteger(document.revision) || typeof document.snapshot !== 'function') throw new KJValidationError('Flange compiler requires a KJDraw document');
    const input = plain(source, 'input');
    exact(input, [
        'version',
        'expectedRevision',
        'units',
        'drawingId',
        'endView',
        'sideViewAxis',
        'sheet'
    ], 'input');
    if (input.version !== KJDRAW_MECHANICAL_FLANGE_CORE_VERSION) throw new KJValidationError(`input.version must be ${KJDRAW_MECHANICAL_FLANGE_CORE_VERSION}`);
    if (input.units !== 'millimeter' || document.snapshot().header?.units !== 'millimeter') throw new KJValidationError('Flange compiler requires millimeter units');
    const expectedRevision = finite(input.expectedRevision, 'input.expectedRevision', 0, Number.MAX_SAFE_INTEGER);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== document.revision) throw new KJValidationError('input.expectedRevision must match the document revision');
    if (typeof input.drawingId !== 'string' || !input.drawingId.trim() || input.drawingId.length > 96 || /[\u0000-\u001f\u007f]/u.test(input.drawingId)) throw new KJValidationError('input.drawingId must be printable text');
    const end = plain(input.endView, 'input.endView');
    exact(end, [
        'center',
        'ringRadii',
        'squareHoles'
    ], 'input.endView');
    const center = point(end.center, 'input.endView.center');
    const ringRadii = increasing(end.ringRadii, 'input.endView.ringRadii', 16, 0.1, 100_000);
    if (ringRadii.length < 2) throw new KJValidationError('input.endView.ringRadii requires at least two radii');
    const holes = plain(end.squareHoles, 'input.endView.squareHoles');
    exact(holes, [
        'pitch',
        'radius'
    ], 'input.endView.squareHoles');
    const pitch = finite(holes.pitch, 'input.endView.squareHoles.pitch', 0.1, 100_000);
    const radius = finite(holes.radius, 'input.endView.squareHoles.radius', 0.1, 100_000);
    if (pitch <= radius * 2) throw new KJValidationError('square-hole pitch must exceed the hole diameter');
    const side = input.sideViewAxis == null ? null : plain(input.sideViewAxis, 'input.sideViewAxis');
    if (side) exact(side, [
        'xRange',
        'symmetricProfiles'
    ], 'input.sideViewAxis');
    const xRange = side ? point(side.xRange, 'input.sideViewAxis.xRange') : null;
    if (xRange && xRange[0] >= xRange[1]) throw new KJValidationError('input.sideViewAxis.xRange must increase');
    if (side?.symmetricProfiles != null && !Array.isArray(side.symmetricProfiles)) throw new KJValidationError('input.sideViewAxis.symmetricProfiles must be an array');
    if (side?.symmetricProfiles?.length && side.symmetricProfiles.length > 64) throw new KJValidationError('input.sideViewAxis.symmetricProfiles exceed their budget');
    const symmetricProfiles = (side?.symmetricProfiles ?? []).map((value, profileIndex)=>{
        const profile = plain(value, `input.sideViewAxis.symmetricProfiles[${profileIndex}]`);
        exact(profile, [
            'vertices',
            'endCaps'
        ], `input.sideViewAxis.symmetricProfiles[${profileIndex}]`);
        if (!Array.isArray(profile.vertices) || profile.vertices.length < 2 || profile.vertices.length > 64) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices must contain 2 to 64 points`);
        const vertices = profile.vertices.map((vertexValue, vertexIndex)=>{
            const vertex = plain(vertexValue, `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}]`);
            exact(vertex, [
                'station',
                'radius'
            ], `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}]`);
            const station = finite(vertex.station, `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}].station`, xRange[0], xRange[1]);
            const radius = finite(vertex.radius, `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}].radius`, 0.1, 100_000);
            return {
                station,
                radius
            };
        });
        for(let index = 1; index < vertices.length; index++){
            const previous = vertices[index - 1], current = vertices[index];
            if (current.station < previous.station) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}] stations must not decrease`);
            if (current.station === previous.station && current.radius === previous.radius) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}] contains a zero-length segment`);
        }
        const endCaps = profile.endCaps ?? 'none';
        if (![
            'none',
            'start',
            'end',
            'both'
        ].includes(endCaps)) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}].endCaps is invalid`);
        return {
            vertices,
            endCaps
        };
    });
    const sheet = plain(input.sheet, 'input.sheet');
    exact(sheet, [
        'origin',
        'size',
        'inset',
        'titleGrid'
    ], 'input.sheet');
    const sheetOrigin = point(sheet.origin, 'input.sheet.origin'), sheetSize = point(sheet.size, 'input.sheet.size');
    if (sheetSize[0] < 100 || sheetSize[1] < 100) throw new KJValidationError('input.sheet.size is too small');
    const inset = finite(sheet.inset, 'input.sheet.inset', 0, Math.min(...sheetSize) / 2 - 1);
    const grid = sheet.titleGrid == null ? null : plain(sheet.titleGrid, 'input.sheet.titleGrid');
    if (grid) exact(grid, [
        'origin',
        'size',
        'columns',
        'partialColumns',
        'rows',
        'diagonalHeader'
    ], 'input.sheet.titleGrid');
    let titleGrid = null;
    if (grid) {
        const origin = point(grid.origin, 'input.sheet.titleGrid.origin'), size = point(grid.size, 'input.sheet.titleGrid.size');
        if (size[0] <= 0 || size[1] <= 0 || origin[0] < sheetOrigin[0] + inset || origin[1] < sheetOrigin[1] + inset || origin[0] + size[0] > sheetOrigin[0] + sheetSize[0] - inset || origin[1] + size[1] > sheetOrigin[1] + sheetSize[1] - inset) throw new KJValidationError('title grid must lie inside the inset frame');
        const columns = increasing(grid.columns, 'input.sheet.titleGrid.columns', 32, 0, size[0]);
        if (!Array.isArray(grid.rows) || grid.rows.length > 16) throw new KJValidationError('title grid rows exceed their budget');
        const rows = grid.rows.map((value, index)=>{
            const entry = plain(value, `input.sheet.titleGrid.rows[${index}]`);
            exact(entry, [
                'offset',
                'breaks'
            ], `input.sheet.titleGrid.rows[${index}]`);
            return {
                offset: finite(entry.offset, `input.sheet.titleGrid.rows[${index}].offset`, 0, size[1]),
                breaks: increasing(entry.breaks ?? [], `input.sheet.titleGrid.rows[${index}].breaks`, 16, 0, size[0])
            };
        });
        if (rows.some((row, index)=>index > 0 && row.offset <= rows[index - 1].offset)) throw new KJValidationError('title grid row offsets must increase');
        if (!Array.isArray(grid.partialColumns) && grid.partialColumns != null) throw new KJValidationError('title grid partialColumns must be an array');
        if (grid.partialColumns?.length && grid.partialColumns.length > 16) throw new KJValidationError('title grid partialColumns exceed their budget');
        const partialColumns = (grid.partialColumns ?? []).map((value, index)=>{
            const entry = plain(value, `input.sheet.titleGrid.partialColumns[${index}]`);
            exact(entry, [
                'offset',
                'height'
            ], `input.sheet.titleGrid.partialColumns[${index}]`);
            return {
                offset: finite(entry.offset, `input.sheet.titleGrid.partialColumns[${index}].offset`, 0, size[0]),
                height: finite(entry.height, `input.sheet.titleGrid.partialColumns[${index}].height`, 0, size[1])
            };
        });
        const diagonal = grid.diagonalHeader == null ? null : plain(grid.diagonalHeader, 'input.sheet.titleGrid.diagonalHeader');
        if (diagonal) exact(diagonal, [
            'width',
            'drop'
        ], 'input.sheet.titleGrid.diagonalHeader');
        titleGrid = {
            origin,
            size,
            columns,
            rows,
            partialColumns,
            ...diagonal ? {
                diagonalHeader: {
                    width: finite(diagonal.width, 'input.sheet.titleGrid.diagonalHeader.width', 0, size[0]),
                    drop: finite(diagonal.drop, 'input.sheet.titleGrid.diagonalHeader.drop', 0, size[1])
                }
            } : {}
        };
    }
    return {
        expectedRevision,
        drawingId: input.drawingId.trim(),
        center,
        ringRadii,
        pitch,
        radius,
        xRange,
        symmetricProfiles,
        sheetOrigin,
        sheetSize,
        inset,
        titleGrid
    };
}
export function buildAgentMechanicalFlangeCore(document, source) {
    const input = validate(document, source), prefix = `flange-${stableHash({
        id: input.drawingId,
        version: KJDRAW_MECHANICAL_FLANGE_CORE_VERSION
    }).slice(0, 12)}`;
    const linetypeId = `${prefix}-continuous`, geometryLayerId = `${prefix}-geometry`, sheetLayerId = `${prefix}-sheet`, centerLayerId = `${prefix}-center`;
    const entities = [], p3 = (x, y)=>[
            x,
            y,
            0
        ];
    const emit = (type, payload)=>entities.push({
            type,
            payload,
            options: {
                id: `${prefix}-${String(entities.length + 1).padStart(4, '0')}`
            }
        });
    const line = (a, b, layerId = sheetLayerId)=>emit('LINE', {
            start: p3(...a),
            end: p3(...b),
            layerId
        });
    const rectangle = (origin, size)=>{
        const [x, y] = origin, [w, h] = size;
        line([
            x,
            y
        ], [
            x + w,
            y
        ]);
        line([
            x + w,
            y
        ], [
            x + w,
            y + h
        ]);
        line([
            x + w,
            y + h
        ], [
            x,
            y + h
        ]);
        line([
            x,
            y + h
        ], [
            x,
            y
        ]);
    };
    const [cx, cy] = input.center;
    for (const ringRadius of input.ringRadii)emit('CIRCLE', {
        center: p3(cx, cy),
        radius: ringRadius,
        layerId: geometryLayerId
    });
    const halfPitch = input.pitch / 2;
    for (const dx of [
        -1,
        1
    ])for (const dy of [
        -1,
        1
    ])emit('CIRCLE', {
        center: p3(cx + dx * halfPitch, cy + dy * halfPitch),
        radius: input.radius,
        layerId: geometryLayerId
    });
    rectangle(input.sheetOrigin, input.sheetSize);
    rectangle([
        input.sheetOrigin[0] + input.inset,
        input.sheetOrigin[1] + input.inset
    ], [
        input.sheetSize[0] - input.inset * 2,
        input.sheetSize[1] - input.inset * 2
    ]);
    if (input.titleGrid) {
        const grid = input.titleGrid, [x, y] = grid.origin, [w, h] = grid.size;
        line([
            x,
            y + h
        ], [
            x + w,
            y + h
        ]);
        for (const offset of grid.columns)line([
            x + offset,
            y
        ], [
            x + offset,
            y + h
        ]);
        for (const column of grid.partialColumns ?? [])line([
            x + column.offset,
            y
        ], [
            x + column.offset,
            y + column.height
        ]);
        for (const row of grid.rows){
            const spans = [
                0,
                ...row.breaks ?? [],
                w
            ];
            for(let index = 0; index < spans.length - 1; index++)line([
                x + spans[index],
                y + row.offset
            ], [
                x + spans[index + 1],
                y + row.offset
            ]);
        }
        if (grid.diagonalHeader) line([
            x,
            y + h
        ], [
            x + grid.diagonalHeader.width,
            y + h - grid.diagonalHeader.drop
        ]);
    }
    if (input.xRange) line([
        input.xRange[0],
        cy
    ], [
        input.xRange[1],
        cy
    ], centerLayerId);
    for (const profile of input.symmetricProfiles){
        for(let index = 1; index < profile.vertices.length; index++){
            const previous = profile.vertices[index - 1], current = profile.vertices[index];
            line([
                previous.station,
                cy + previous.radius
            ], [
                current.station,
                cy + current.radius
            ], geometryLayerId);
            line([
                previous.station,
                cy - previous.radius
            ], [
                current.station,
                cy - current.radius
            ], geometryLayerId);
        }
        const start = profile.vertices[0], end = profile.vertices.at(-1);
        if (profile.endCaps === 'start' || profile.endCaps === 'both') line([
            start.station,
            cy - start.radius
        ], [
            start.station,
            cy + start.radius
        ], geometryLayerId);
        if (profile.endCaps === 'end' || profile.endCaps === 'both') line([
            end.station,
            cy - end.radius
        ], [
            end.station,
            cy + end.radius
        ], geometryLayerId);
    }
    return {
        commandArgs: {
            entities,
            resources: {
                linetypes: [
                    {
                        id: linetypeId,
                        name: `${prefix}_CONT`,
                        pattern: []
                    }
                ],
                layers: [
                    {
                        id: geometryLayerId,
                        name: 'FLANGE_GEOMETRY',
                        color: 7,
                        linetypeId,
                        lineweight: 35
                    },
                    {
                        id: sheetLayerId,
                        name: 'FLANGE_SHEET',
                        color: 7,
                        linetypeId,
                        lineweight: 18
                    },
                    {
                        id: centerLayerId,
                        name: 'FLANGE_CENTER',
                        color: 7,
                        linetypeId,
                        lineweight: 18
                    }
                ]
            }
        },
        evidence: {
            knowledgePackId: KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK.id,
            knowledgePackVersion: KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK.version,
            expectedRevision: input.expectedRevision,
            entityCount: entities.length,
            parameters: {
                ringCount: input.ringRadii.length,
                squareHolePitch: input.pitch,
                squareHoleRadius: input.radius,
                titleGrid: input.titleGrid != null,
                sideViewAxis: input.xRange != null,
                symmetricProfileCount: input.symmetricProfiles.length
            },
            limitations: [
                'Flange end-view, symmetric axial-profile and sheet-grid core only',
                'Does not generate dimensions, attributes or hatches',
                'Private drawings and labels are not embedded'
            ]
        }
    };
}
