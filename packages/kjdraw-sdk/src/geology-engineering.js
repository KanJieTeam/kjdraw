// Generated from geology-engineering.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { stableHash, deepFreeze } from './utils.js';
import { validateKnowledgePack } from './knowledge-pack.js';
import { hatchPatternFromKnowledgePack } from './hatch-pattern-catalog.js';
const pattern = {
    fill: 'CROSS',
    clay: 'ANSI31',
    silt: 'ANSI31',
    sand: 'ANSI37',
    gravel: 'CROSS',
    rock: 'ANSI31',
    'weathered-rock': 'CROSS'
};
const bounded = (value, label, max = 64)=>{
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new KJValidationError(`Geology: invalid ${label}`);
    return value.trim();
};
const numeric = (value, label)=>{
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e6) throw new KJValidationError(`Geology: invalid ${label}`);
    return value;
};
const positive = (value, label)=>{
    const result = numeric(value, label);
    if (result <= 0) throw new KJValidationError(`Geology: ${label} must be positive`);
    return result;
};
const projectCoordinate = (value, label)=>{
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) throw new KJValidationError(`Geology: invalid ${label}`);
    return value;
};
const metres = (value)=>value.toFixed(2);
const headerRoles = new Set([
    'projectName',
    'holeId',
    'collarElevation',
    'depth',
    'x',
    'y',
    'startDate',
    'endDate',
    'stableWaterDepth',
    'verticalScale'
]);
const defaultColumnLabels = {
    hole: 'HOLE',
    collar: 'COLLAR',
    depth: 'DEPTH',
    verticalScale: 'VERTICAL SCALE',
    datum: 'DATUM: collar elevation',
    project: 'PROJECT',
    x: 'X',
    y: 'Y',
    startDate: 'START',
    endDate: 'END',
    depthColumn: 'DEPTH m',
    thicknessColumn: 'THICKNESS m',
    elevationColumn: 'ELEV. m',
    codeColumn: 'CODE',
    hatchColumn: 'LITHOLOGY',
    stratumColumn: 'STRATUM',
    descriptionColumn: 'DESCRIPTION',
    sampleColumn: 'SAMPLE',
    sptColumn: 'SPT N',
    legend: 'LITHOLOGY LEGEND',
    footer: 'Depth positive downward; elevations from supplied collar. Verify against drilling log.',
    fill: 'fill',
    clay: 'clay',
    silt: 'silt',
    sand: 'sand',
    gravel: 'gravel',
    rock: 'rock',
    'weathered-rock': 'weathered-rock'
};
function columnLayout(input) {
    if (!input.columnStylePack) {
        const height = input.pageHeightMillimeters ?? 297;
        if (height !== 297 && height !== 841) throw new KJValidationError('Geology: column page height must be 297 or 841 mm');
        return {
            paperWidth: 210,
            paperHeight: height,
            left: 15,
            right: 195,
            columns: [
                32,
                51,
                67,
                92,
                147
            ],
            headerDepth: 56,
            footerReserve: 57,
            labels: defaultColumnLabels
        };
    }
    if (input.pageHeightMillimeters != null) throw new KJValidationError('Geology: a style pack and direct page height cannot be mixed');
    const pack = validateKnowledgePack(input.columnStylePack);
    const rule = pack.rules?.['geology-column-layout'];
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new KJValidationError('Geology: style pack has no geology-column-layout rule');
    const value = rule;
    const expectedKeys = [
        'columns',
        'left',
        'paperHeight',
        'paperWidth',
        'right'
    ];
    const keys = Object.keys(value).sort();
    if (keys.some((key)=>![
            ...expectedKeys,
            'labels',
            'observationColumns',
            'displayAliases',
            'headerDepth',
            'footerReserve',
            'headerGrid'
        ].includes(key)) || expectedKeys.some((key)=>!keys.includes(key))) throw new KJValidationError('Geology: style pack layout must declare five geometry fields and optional labels/observation columns');
    const paperWidth = numeric(value.paperWidth, 'style paper width'), paperHeight = numeric(value.paperHeight, 'style paper height');
    const left = numeric(value.left, 'style left'), right = numeric(value.right, 'style right');
    if (paperWidth < 150 || paperWidth > 500 || paperHeight < 250 || paperHeight > 1600 || left < 5 || right > paperWidth - 5 || right - left < 125) throw new KJValidationError('Geology: style paper and table margins are out of bounds');
    if (!Array.isArray(value.columns) || ![
        5,
        6
    ].includes(value.columns.length)) throw new KJValidationError('Geology: style columns require five or six boundaries');
    const columns = value.columns.map((item, index)=>numeric(item, `style column ${index + 1}`));
    const namedColumnMinimum = value.observationColumns ? 14 : 35;
    if (columns.some((column, index)=>column <= (index ? columns[index - 1] : left) + (index === 0 ? 9 : index === columns.length - 1 ? namedColumnMinimum : index === columns.length - 2 ? 15 : 12)) || right <= columns.at(-1) + 25) throw new KJValidationError('Geology: style columns are not ordered or readable');
    let observationColumns;
    if (value.observationColumns != null) {
        if (!Array.isArray(value.observationColumns) || value.observationColumns.length !== 2) throw new KJValidationError('Geology: sample and SPT boundaries must be declared together');
        observationColumns = value.observationColumns.map((item, index)=>numeric(item, `observation column ${index + 1}`));
        if (observationColumns[0] <= columns.at(-1) + 35 || observationColumns[1] <= observationColumns[0] + 15 || right <= observationColumns[1] + 12) throw new KJValidationError('Geology: description, sample and SPT columns are not readable');
    }
    const headerDepth = value.headerDepth == null ? 56 : numeric(value.headerDepth, 'style header depth');
    const footerReserve = value.footerReserve == null ? 57 : numeric(value.footerReserve, 'style footer reserve');
    if (headerDepth < 40 || headerDepth > 90 || footerReserve < 30 || footerReserve > 120) throw new KJValidationError('Geology: style header or footer reserve is unreadable');
    let labels = defaultColumnLabels;
    if (value.labels != null) {
        if (!value.labels || typeof value.labels !== 'object' || Array.isArray(value.labels)) throw new KJValidationError('Geology: style labels must be a declared object');
        const provided = value.labels;
        if (Object.keys(provided).sort().join(',') !== Object.keys(defaultColumnLabels).sort().join(',')) throw new KJValidationError('Geology: style labels must translate every column and lithology role');
        labels = Object.fromEntries(Object.entries(provided).map(([key, label])=>[
                key,
                bounded(label, `style label ${key}`, key === 'footer' ? 160 : 48)
            ]));
    }
    let displayAliases;
    if (value.displayAliases != null) {
        if (!value.displayAliases || typeof value.displayAliases !== 'object' || Array.isArray(value.displayAliases)) throw new KJValidationError('Geology: display aliases must be a declared object');
        const supplied = value.displayAliases;
        if (Object.keys(supplied).some((key)=>![
                'codes',
                'names'
            ].includes(key))) throw new KJValidationError('Geology: display aliases may only contain codes and names');
        const aliases = (kind)=>{
            const entries = supplied[kind];
            if (entries == null) return {};
            if (typeof entries !== 'object' || Array.isArray(entries)) throw new KJValidationError(`Geology: ${kind} display aliases must be an object`);
            const pairs = Object.entries(entries);
            if (pairs.length > 256) throw new KJValidationError('Geology: too many display aliases');
            return Object.fromEntries(pairs.map(([source, target])=>[
                    bounded(source, `source ${kind} alias`, 64),
                    bounded(target, `visible ${kind} alias`, 64)
                ]));
        };
        displayAliases = {
            codes: aliases('codes'),
            names: aliases('names')
        };
    }
    let headerGrid;
    if (value.headerGrid != null) {
        const supplied = value.headerGrid;
        if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || Object.keys(supplied).join(',') !== 'rows') throw new KJValidationError('Geology: header grid must declare rows only');
        const rows = supplied.rows;
        if (!Array.isArray(rows) || rows.length < 2 || rows.length > 4 || (headerDepth - 27) / rows.length < 7) throw new KJValidationError('Geology: header grid rows do not fit the declared sheet');
        const seen = new Set();
        headerGrid = {
            rows: rows.map((row, rowIndex)=>{
                if (!Array.isArray(row) || row.length < 1 || row.length > 4 || (right - left) / row.length < 45) throw new KJValidationError(`Geology: header grid row ${rowIndex + 1} is unreadable`);
                return row.map((raw, cellIndex)=>{
                    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'label,role') throw new KJValidationError(`Geology: header grid cell ${rowIndex + 1}/${cellIndex + 1} needs a role and label`);
                    const cell = raw;
                    if (typeof cell.role !== 'string' || !headerRoles.has(cell.role)) throw new KJValidationError('Geology: undeclared header fact role');
                    const role = cell.role;
                    if (seen.has(role)) throw new KJValidationError('Geology: duplicate header fact role');
                    seen.add(role);
                    return {
                        role,
                        label: bounded(cell.label, 'header fact label', 24)
                    };
                });
            })
        };
    }
    return {
        paperWidth,
        paperHeight,
        left,
        right,
        columns,
        headerDepth,
        footerReserve,
        ...observationColumns ? {
            observationColumns
        } : {},
        labels,
        ...displayAliases ? {
            displayAliases
        } : {},
        ...headerGrid ? {
            headerGrid
        } : {}
    };
}
function checkHole(hole) {
    bounded(hole.id, 'hole id');
    numeric(hole.collarElevation, 'collar elevation');
    if (hole.x != null) projectCoordinate(hole.x, 'borehole X coordinate');
    if (hole.y != null) projectCoordinate(hole.y, 'borehole Y coordinate');
    if (hole.startDate != null) bounded(hole.startDate, 'start date', 32);
    if (hole.endDate != null) bounded(hole.endDate, 'end date', 32);
    positive(hole.depth, 'hole depth');
    if (hole.stableWaterDepth != null && (numeric(hole.stableWaterDepth, 'stable groundwater depth') < 0 || hole.stableWaterDepth > hole.depth)) throw new KJValidationError('Geology: stable groundwater depth is outside the hole');
    if (!Array.isArray(hole.strata) || !hole.strata.length || hole.strata.length > 80) throw new KJValidationError('Geology: 1–80 strata are required');
    const strata = [
        ...hole.strata
    ].sort((a, b)=>a.top - b.top);
    const grouped = strata.some((layer)=>layer.groupId != null || layer.groupRole != null);
    const finishedGroups = new Set();
    let currentGroup = null;
    const principals = new Map();
    const intervalIds = new Set();
    let previous = 0;
    for (const layer of strata){
        const code = bounded(layer.code, 'stratum code', 24);
        if (grouped) {
            const groupId = bounded(layer.groupId, 'source major group id', 24);
            if (layer.groupRole !== 'principal' && layer.groupRole !== 'lens') throw new KJValidationError('Geology: every grouped interval needs a declared principal/lens role');
            if (groupId !== currentGroup) {
                if (currentGroup != null) finishedGroups.add(currentGroup);
                if (finishedGroups.has(groupId)) throw new KJValidationError('Geology: a major group may not reappear after another group');
                currentGroup = groupId;
            }
            if (layer.groupRole === 'principal') {
                const prior = principals.get(groupId);
                if (prior && (prior.code !== layer.code || prior.name !== layer.name || prior.lithology !== layer.lithology || prior.patternKey !== layer.patternKey)) throw new KJValidationError('Geology: repeated principal intervals disagree on the major group identity');
                principals.set(groupId, layer);
            }
        } else if (layer.groupId != null || layer.groupRole != null) throw new KJValidationError('Geology: incomplete source group hierarchy');
        if (layer.intervalId != null) {
            const id = bounded(layer.intervalId, 'interval id', 64);
            if (intervalIds.has(id)) throw new KJValidationError(`Geology: repeated interval id ${id}`);
            intervalIds.add(id);
        }
        bounded(layer.name, 'stratum name');
        if (layer.description != null) bounded(layer.description, 'stratum description', 96);
        if (layer.descriptionSource != null && (!layer.description || ![
            'interval',
            'layer-definition'
        ].includes(layer.descriptionSource))) throw new KJValidationError('Geology: description source requires exact interval or layer-definition provenance');
        const top = numeric(layer.top, 'stratum top'), bottom = numeric(layer.bottom, 'stratum bottom');
        if (Math.abs(top - previous) > 1e-6 || bottom <= top || bottom > hole.depth + 1e-6) throw new KJValidationError(`Geology: gap, overlap or invalid depth at ${code}`);
        if (!Object.hasOwn(pattern, layer.lithology)) throw new KJValidationError(`Geology: undeclared lithology at ${code}`);
        if (layer.patternKey != null) bounded(layer.patternKey, 'pattern key', 96);
        previous = bottom;
    }
    if (Math.abs(previous - hole.depth) > 1e-6) throw new KJValidationError('Geology: final layer bottom must equal hole depth');
    if (grouped && [
        ...new Set(strata.map((layer)=>layer.groupId))
    ].some((groupId)=>!principals.has(groupId))) throw new KJValidationError('Geology: every major group must include a principal interval');
    if (hole.observations != null) {
        if (!Array.isArray(hole.observations) || hole.observations.length > 256) throw new KJValidationError('Geology: observations require a bounded list');
        const identities = new Set();
        for (const item of hole.observations){
            if (item.kind !== 'sample' && item.kind !== 'spt') throw new KJValidationError('Geology: unsupported observation kind');
            const id = bounded(item.id, 'observation id', 24), depth = numeric(item.depth, 'observation depth');
            if (item.displayLabel != null) bounded(item.displayLabel, 'observation display label', 24);
            if (depth < 0 || depth > hole.depth) throw new KJValidationError('Geology: observation depth is outside the hole');
            if (item.kind === 'spt' && (item.value == null || numeric(item.value, 'SPT result') < 0)) throw new KJValidationError('Geology: SPT needs a nonnegative measured result');
            const identity = `${item.kind}:${id}:${depth}`;
            if (identities.has(identity)) throw new KJValidationError('Geology: repeated observation identity');
            identities.add(identity);
        }
    }
    return strata;
}
function patternDefinitions(pack, strata) {
    if (!pack) {
        if (strata.some((layer)=>layer.patternKey != null)) throw new KJValidationError('Geology: a declared pattern key requires a licensed hatch pack');
        return {};
    }
    const definitions = {};
    for (const role of new Set(strata.map((layer)=>layer.patternKey ?? layer.lithology)))definitions[role] = hatchPatternFromKnowledgePack(pack, role);
    return definitions;
}
function drawingBuilder(input, templateId, expectedRevision, hatches = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new KJValidationError('Geology: invalid expected revision');
    const prefix = `geo-${stableHash({
        input,
        templateId
    })}`;
    const linetypeId = `${prefix}-continuous`;
    const names = [
        'GEO_FRAME',
        'GEO_BOUNDARY',
        'GEO_HATCH',
        'GEO_TEXT',
        'GEO_GUIDE'
    ];
    const layers = names.map((name, index)=>({
            id: `${prefix}-layer-${index}`,
            name,
            color: [
                7,
                7,
                8,
                7,
                9
            ][index],
            linetypeId,
            lineweight: [
                35,
                35,
                18,
                18,
                9
            ][index]
        }));
    const entities = [];
    const add = (type, layer, payload)=>{
        if (entities.length >= 8192) throw new KJValidationError('Geology: entity budget exceeded');
        entities.push({
            type,
            payload: {
                ...payload,
                layerId: layers[layer].id
            },
            options: {
                id: `${prefix}-entity-${String(entities.length + 1).padStart(5, '0')}`
            }
        });
    };
    const line = (layer, x1, y1, x2, y2)=>add('LINE', layer, {
            start: [
                x1,
                y1,
                0
            ],
            end: [
                x2,
                y2,
                0
            ]
        });
    const text = (layer, x, y, value, height = 2.6, centered = false)=>add('TEXT', layer, {
            position: [
                x,
                y,
                0
            ],
            text: value,
            height,
            ...centered ? {
                horizontalAlignment: 1,
                alignmentPoint: [
                    x,
                    y,
                    0
                ]
            } : {}
        });
    const poly = (layer, points, closed = false)=>add('LWPOLYLINE', layer, {
            vertices: points.map(([x, y])=>[
                    x,
                    y,
                    0
                ]),
            closed
        });
    const rect = (layer, x1, y1, x2, y2)=>poly(layer, [
            [
                x1,
                y1
            ],
            [
                x2,
                y1
            ],
            [
                x2,
                y2
            ],
            [
                x1,
                y2
            ]
        ], true);
    const hatch = (points, layer)=>add('HATCH', 2, {
            boundaryLoops: [
                {
                    external: true,
                    closed: true,
                    vertices: points.map(([x, y])=>[
                            x,
                            y,
                            0
                        ])
                }
            ],
            patternName: pattern[layer.lithology],
            solid: false,
            patternScale: 0.6,
            patternAngle: 0,
            ...hatches[layer.patternKey ?? layer.lithology] ?? {}
        });
    const finish = ()=>deepFreeze({
            commandArgs: {
                entities,
                resources: {
                    linetypes: [
                        {
                            id: linetypeId,
                            name: `GEO_${stableHash(prefix).toUpperCase()}_CONT`,
                            pattern: []
                        }
                    ],
                    layers
                }
            },
            evidence: {
                packId: 'geology.core',
                packVersion: '1.0.0',
                packHash: stableHash({
                    pattern,
                    hatches
                }),
                intentHash: stableHash(input),
                templateId,
                rootObjectId: prefix,
                expectedRevision,
                entityCount: entities.length
            }
        });
    return {
        line,
        text,
        poly,
        rect,
        hatch,
        finish
    };
}
export function compileGeologyColumn(input) {
    const { hole } = input, strata = checkHole(hole);
    const layout = columnLayout(input);
    const { paperHeight: pageHeight, paperWidth: pageWidth, left, right, columns, observationColumns, headerDepth, footerReserve, labels, displayAliases, headerGrid } = layout;
    const depthX = columns[0];
    const thicknessX = columns.length === 6 ? columns[1] : null;
    const elevationX = columns.length === 6 ? columns[2] : columns[1];
    const codeX = columns.length === 6 ? columns[3] : columns[2];
    const hatchX = columns.length === 6 ? columns[4] : columns[3];
    const descriptionX = columns.at(-1);
    const scale = 1000 / positive(input.verticalScaleDenominator, 'vertical scale denominator');
    const top = pageHeight - headerDepth - 10, bottom = top - hole.depth * scale;
    if (scale < 0.1 || scale > 100 || bottom < footerReserve) throw new KJValidationError('Geology: column does not fit the declared physical sheet at this vertical scale');
    const g = drawingBuilder(input, 'borehole-column-engineering', input.expectedRevision, patternDefinitions(input.hatchPack, strata));
    const observations = hole.observations ?? [];
    if (observations.length && strata.some((layer)=>layer.description) && !observationColumns) throw new KJValidationError('Geology: supplied descriptions and depth-aligned observations need separate declared columns');
    if (observations.length && !observationColumns && right - descriptionX < 42) throw new KJValidationError('Geology: style observation columns must have at least 42 mm total width');
    const sampleX = observationColumns?.[0] ?? descriptionX;
    const sptX = observationColumns?.[1] ?? descriptionX + 22;
    const descriptionRight = observationColumns?.[0] ?? right;
    const definitionAnchors = new Map();
    for (const layer of strata)if (layer.descriptionSource === 'layer-definition' && layer.description) {
        const identity = `${layer.code}\u0000${layer.description}`;
        const prior = definitionAnchors.get(identity);
        if (!prior || layer.bottom - layer.top > prior.bottom - prior.top) definitionAnchors.set(identity, layer);
    }
    const grouped = strata[0].groupId != null;
    const groups = [];
    if (grouped) for (const layer of strata){
        const prior = groups.at(-1);
        if (prior && prior.id === layer.groupId) {
            prior.bottom = layer.bottom;
            prior.intervals.push(layer);
        } else groups.push({
            id: layer.groupId,
            top: layer.top,
            bottom: layer.bottom,
            principal: layer,
            intervals: [
                layer
            ]
        });
    }
    for (const group of groups)group.principal = group.intervals.find((layer)=>layer.groupRole === 'principal');
    const depthLabelY = new Map();
    if (grouped) {
        let previousY = top + 1;
        for (const layer of strata){
            const boundaryY = top - layer.bottom * scale;
            const anchorY = boundaryY + 0.4;
            const visibleY = Math.min(anchorY, previousY - 2.3, top - 2);
            if (anchorY - visibleY > 4.5 || visibleY < bottom + 0.4) throw new KJValidationError(`Geology: layer ${layer.code} depth labels cannot be separated readably at this scale`);
            depthLabelY.set(layer, visibleY);
            previousY = visibleY;
        }
    }
    g.rect(0, 5, 5, pageWidth - 5, pageHeight - 5);
    g.text(3, pageWidth / 2, pageHeight - 18, bounded(input.title ?? 'ENGINEERING BOREHOLE LOG', 'title'), 5, true);
    if (headerGrid) {
        const facts = {
            projectName: input.projectName ? bounded(input.projectName, 'project name', 96) : undefined,
            holeId: hole.id,
            collarElevation: metres(hole.collarElevation),
            depth: metres(hole.depth),
            x: hole.x == null ? undefined : metres(hole.x),
            y: hole.y == null ? undefined : metres(hole.y),
            startDate: hole.startDate,
            endDate: hole.endDate,
            stableWaterDepth: hole.stableWaterDepth == null ? undefined : metres(hole.stableWaterDepth),
            verticalScale: `1:${metres(input.verticalScaleDenominator)}`
        };
        const headerTop = pageHeight - 24, headerBottom = pageHeight - headerDepth + 3;
        const rowHeight = (headerTop - headerBottom) / headerGrid.rows.length;
        g.rect(0, left, headerBottom, right, headerTop);
        for (const [rowIndex, row] of headerGrid.rows.entries()){
            const rowTop = headerTop - rowIndex * rowHeight, rowBottom = rowTop - rowHeight;
            if (rowIndex) g.line(0, left, rowTop, right, rowTop);
            const width = (right - left) / row.length;
            for (const [cellIndex, cell] of row.entries()){
                const cellLeft = left + cellIndex * width, valueX = cellLeft + Math.min(25, width * 0.35);
                if (cellIndex) g.line(0, cellLeft, rowBottom, cellLeft, rowTop);
                g.line(0, valueX, rowBottom, valueX, rowTop);
                const value = facts[cell.role];
                if (value == null) throw new KJValidationError(`Geology: declared header fact ${cell.role} is missing; refusing to invent a value`);
                const estimated = (text)=>[
                        ...text
                    ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/u.test(character) ? 1.15 : 2.1), 0);
                if (estimated(cell.label) > valueX - cellLeft - 3 || estimated(value) > cellLeft + width - valueX - 3) throw new KJValidationError(`Geology: header fact ${cell.role} does not fit the declared cell`);
                g.text(3, cellLeft + 2, rowTop - rowHeight * 0.69, cell.label, 2.2);
                g.text(3, valueX + 2, rowTop - rowHeight * 0.69, value, 2.2);
            }
        }
    } else {
        if (input.projectName) g.text(3, left + 2, pageHeight - 27, `${labels.project} ${bounded(input.projectName, 'project name', 96)}`, 2.5);
        g.text(3, left + 2, pageHeight - 36, `${labels.hole} ${hole.id}   ${labels.collar} ${metres(hole.collarElevation)} m   ${labels.depth} ${metres(hole.depth)} m`, 3);
        const location = [
            hole.x != null ? `${labels.x} ${metres(hole.x)}` : '',
            hole.y != null ? `${labels.y} ${metres(hole.y)}` : '',
            hole.startDate ? `${labels.startDate} ${hole.startDate}` : '',
            hole.endDate ? `${labels.endDate} ${hole.endDate}` : ''
        ].filter(Boolean).join('   ');
        if (location) g.text(3, left + 2, pageHeight - 43, location, 2.3);
        g.text(3, left + 2, pageHeight - 50, `${labels.verticalScale} 1:${metres(input.verticalScaleDenominator)}   ${labels.datum}`, 2.6);
    }
    g.rect(0, left, bottom, right, pageHeight - headerDepth);
    for (const x of columns)g.line(0, x, bottom, x, pageHeight - headerDepth);
    if (observations.length) {
        g.line(0, sptX, bottom, sptX, pageHeight - headerDepth);
        if (observationColumns) g.line(0, sampleX, bottom, sampleX, pageHeight - headerDepth);
    }
    const headings = [
        [
            left + 2,
            labels.depthColumn
        ]
    ];
    if (thicknessX != null) headings.push([
        depthX + 2,
        labels.thicknessColumn
    ]);
    headings.push([
        (thicknessX ?? depthX) + 2,
        labels.elevationColumn
    ], [
        elevationX + 2,
        labels.codeColumn
    ], [
        codeX + 2,
        labels.hatchColumn
    ], [
        hatchX + 2,
        labels.stratumColumn
    ], [
        descriptionX + 2,
        observationColumns || !observations.length ? labels.descriptionColumn : labels.sampleColumn
    ]);
    for (const [x, label] of headings)g.text(3, x, pageHeight - headerDepth - 6, label, 2.3);
    if (observations.length) {
        if (observationColumns) g.text(3, sampleX + 2, pageHeight - headerDepth - 6, labels.sampleColumn, 2.3);
        g.text(3, sptX + 2, pageHeight - headerDepth - 6, labels.sptColumn, 2.3);
    }
    g.line(0, left, top, right, top);
    for (const layer of strata){
        const yTop = top - layer.top * scale, yBottom = top - layer.bottom * scale;
        const bandHeight = yTop - yBottom;
        if (bandHeight < (grouped ? 0.4 : 1.4)) throw new KJValidationError(`Geology: layer ${layer.code} is too thin for readable geometry at this scale`);
        const isMajorBoundary = !grouped || groups.some((group)=>Math.abs(group.bottom - layer.bottom) < 1e-6);
        g.line(1, isMajorBoundary ? left : depthX, yBottom, isMajorBoundary ? right : descriptionX, yBottom);
        g.hatch([
            [
                codeX,
                yBottom
            ],
            [
                hatchX,
                yBottom
            ],
            [
                hatchX,
                yTop
            ],
            [
                codeX,
                yTop
            ]
        ], layer);
        const labelHeight = Math.min(2.3, bandHeight * 0.55);
        const depthY = depthLabelY.get(layer) ?? yBottom + 0.4;
        if (grouped && Math.abs(depthY - (yBottom + 0.4)) > 0.6) g.line(1, depthX - 5, yBottom, depthX - 1, depthY);
        g.text(3, left + 2, depthY, metres(layer.bottom), grouped ? 1.6 : labelHeight);
        if (grouped) continue;
        if (thicknessX != null) g.text(3, depthX + 2, yBottom + 0.4, metres(layer.bottom - layer.top), labelHeight);
        g.text(3, (thicknessX ?? depthX) + 2, yBottom + 0.4, metres(hole.collarElevation - layer.bottom), labelHeight);
        g.text(3, elevationX + 2, (yTop + yBottom) / 2, displayAliases?.codes[layer.code] ?? layer.code, labelHeight);
        g.text(3, hatchX + 2, (yTop + yBottom) / 2, displayAliases?.names[layer.name] ?? layer.name, labelHeight);
        if (layer.description && (layer.descriptionSource !== 'layer-definition' || definitionAnchors.get(`${layer.code}\u0000${layer.description}`) === layer)) {
            const description = layer.description.trim();
            const initialHeight = Math.min(2.2, labelHeight);
            const maxCharacters = Math.max(1, Math.floor((descriptionRight - descriptionX - 4) / (initialHeight * 1.05)));
            const lines = [
                ...description.matchAll(new RegExp(`.{1,${maxCharacters}}`, 'gu'))
            ].map((match)=>match[0]);
            const height = Math.min(initialHeight, (bandHeight - 0.5) / (lines.length * 1.3));
            if (height < 1.5) throw new KJValidationError(`Geology: layer ${layer.code} description does not fit readably in its declared band`);
            for (const [index, line] of lines.entries())g.text(3, descriptionX + 2, yTop - (index + 1) * height * 1.3, line, height);
        }
    }
    if (grouped) for (const group of groups){
        const yTop = top - group.top * scale, yBottom = top - group.bottom * scale;
        const bandHeight = yTop - yBottom;
        const labelHeight = Math.min(2.3, Math.max(1.5, bandHeight * 0.55));
        const labelY = bandHeight < 4 ? yTop - 2 : (yTop + yBottom) / 2;
        const principal = group.principal;
        if (thicknessX != null) g.text(3, depthX + 2, labelY, metres(group.bottom - group.top), labelHeight);
        g.text(3, (thicknessX ?? depthX) + 2, labelY, metres(hole.collarElevation - group.bottom), labelHeight);
        g.text(3, elevationX + 2, labelY, displayAliases?.codes[principal.code] ?? group.id, labelHeight);
        g.text(3, hatchX + 2, labelY, displayAliases?.names[principal.name] ?? principal.name, labelHeight);
        if (principal.description) {
            const maxCharacters = Math.max(1, Math.floor((descriptionRight - descriptionX - 4) / (2.2 * 1.05)));
            const lines = [
                ...principal.description.trim().matchAll(new RegExp(`.{1,${maxCharacters}}`, 'gu'))
            ].map((match)=>match[0]);
            const height = Math.min(2.2, (bandHeight - 0.5) / (lines.length * 1.3));
            if (height < 1.5) throw new KJValidationError(`Geology: major group ${group.id} description does not fit readably in its declared band`);
            for (const [index, line] of lines.entries())g.text(3, descriptionX + 2, yTop - (index + 1) * height * 1.3, line, height);
        }
    }
    for (const item of observations){
        const y = top - item.depth * scale;
        const label = item.kind === 'sample' ? item.displayLabel ?? item.id : item.displayLabel ?? `N=${Number.isInteger(item.value) ? item.value.toString() : metres(item.value)}`;
        const columnWidth = item.kind === 'sample' ? sptX - sampleX : right - sptX;
        const estimatedWidth = [
            ...label
        ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/.test(character) ? 1.62 : 1.8), 0);
        if (estimatedWidth > columnWidth - 3) throw new KJValidationError(`Geology: observation ${item.id} label does not fit its declared column`);
        g.text(3, (item.kind === 'sample' ? sampleX : sptX) + 2, y, label, 1.8);
    }
    const distinct = [
        ...new Map(strata.map((layer)=>[
                layer.patternKey ?? layer.lithology,
                layer
            ])).values()
    ];
    if (distinct.length > 5) throw new KJValidationError('Geology: A4 legend supports at most five lithology classes');
    const legendY = Math.min(34, bottom - 6, footerReserve - 4);
    g.text(3, left, legendY, labels.legend, 2.8);
    for (const [index, layer] of distinct.entries()){
        const x = left + index * Math.min(37, (right - left - 10) / distinct.length);
        g.rect(0, x, legendY - 12, x + 10, legendY - 4);
        g.hatch([
            [
                x,
                legendY - 12
            ],
            [
                x + 10,
                legendY - 12
            ],
            [
                x + 10,
                legendY - 4
            ],
            [
                x,
                legendY - 4
            ]
        ], layer);
        g.text(3, x + 11, legendY - 10, layer.patternKey ? displayAliases?.names[layer.name] ?? layer.name : labels[layer.lithology], 2);
    }
    g.text(3, left, Math.min(12, legendY - 18), labels.footer, 2.2);
    return g.finish();
}
export function compileGeologySection(input) {
    if (input.surfaceRule !== 'straight-between-supplied-collars') throw new KJValidationError('Geology: an explicit surface connection rule is required');
    if (!Array.isArray(input.holes) || input.holes.length < 2 || input.holes.length > 24) throw new KJValidationError('Geology: section requires 2–24 holes');
    const holes = [
        ...input.holes
    ].sort((a, b)=>numeric(a.station, 'station') - numeric(b.station, 'station'));
    const hs = 1000 / positive(input.horizontalScaleDenominator, 'horizontal scale denominator');
    const vs = 1000 / positive(input.verticalScaleDenominator, 'vertical scale denominator');
    const datum = numeric(input.datumElevation, 'datum elevation');
    const byId = new Map();
    for (const hole of holes){
        const strata = checkHole(hole);
        if (byId.has(hole.id)) throw new KJValidationError('Geology: duplicate hole id');
        byId.set(hole.id, {
            hole,
            strata
        });
    }
    for(let i = 1; i < holes.length; i++)if (holes[i].station <= holes[i - 1].station) throw new KJValidationError('Geology: stations must be strictly increasing');
    const x = (hole)=>53 + (hole.station - holes[0].station) * hs;
    const y = (hole, depth)=>48 + (hole.collarElevation - depth - datum) * vs;
    if (x(holes.at(-1)) > 390 || holes.some((hole)=>y(hole, 0) > 256 || y(hole, hole.depth) < 48)) throw new KJValidationError('Geology: section does not fit A3 at the declared scales and datum');
    const g = drawingBuilder(input, 'geology-section-engineering', input.expectedRevision, patternDefinitions(input.hatchPack, [
        ...byId.values()
    ].flatMap((value)=>value.strata)));
    g.rect(0, 5, 5, 415, 292);
    g.text(3, 133, 279, bounded(input.title ?? 'ENGINEERING GEOLOGICAL SECTION', 'title'), 5);
    g.text(3, 16, 266, `HORIZONTAL 1:${metres(input.horizontalScaleDenominator)}  VERTICAL 1:${metres(input.verticalScaleDenominator)}  DATUM ${metres(datum)} m`, 3);
    g.line(4, 41, 48, 41, 257);
    g.line(4, 41, 48, 396, 48);
    const surface = holes.map((hole)=>[
            x(hole),
            y(hole, 0)
        ]);
    g.poly(1, surface);
    for (const hole of holes){
        const center = x(hole), top = y(hole, 0), bottom = y(hole, hole.depth);
        g.line(4, center, 48, center, top);
        g.rect(1, center - 2, bottom, center + 2, top);
        g.text(3, center - 4, top + 5, hole.id, 2.7);
        g.text(3, center - 7, 36, `STA ${metres(hole.station)}`, 2.2);
        g.text(3, center - 7, 29, `H ${metres(hole.collarElevation)}`, 2.2);
        for (const layer of byId.get(hole.id).strata){
            const a = y(hole, layer.top), b = y(hole, layer.bottom);
            g.line(1, center - 3, b, center + 3, b);
            g.hatch([
                [
                    center - 2,
                    b
                ],
                [
                    center + 2,
                    b
                ],
                [
                    center + 2,
                    a
                ],
                [
                    center - 2,
                    a
                ]
            ], layer);
        }
    }
    if (!Array.isArray(input.correlations) || input.correlations.length > 200) throw new KJValidationError('Geology: invalid correlation list');
    const unique = new Set();
    for (const link of input.correlations){
        const left = byId.get(bounded(link.fromHoleId, 'correlation hole')), right = byId.get(bounded(link.toHoleId, 'correlation hole'));
        if (!left || !right || x(left.hole) >= x(right.hole)) throw new KJValidationError('Geology: correlation must follow declared station order');
        if (Boolean(link.fromIntervalId) === Boolean(link.fromStratumCode) || Boolean(link.toIntervalId) === Boolean(link.toStratumCode)) throw new KJValidationError('Geology: correlation must use exact interval ids or unambiguous layer codes');
        const candidatesA = left.strata.filter((layer)=>link.fromIntervalId ? layer.intervalId === link.fromIntervalId : layer.code === link.fromStratumCode);
        const candidatesB = right.strata.filter((layer)=>link.toIntervalId ? layer.intervalId === link.toIntervalId : layer.code === link.toStratumCode);
        if (candidatesA.length !== 1 || candidatesB.length !== 1) throw new KJValidationError('Geology: correlation must identify one unambiguous interval per hole');
        const a = candidatesA[0], b = candidatesB[0];
        if (a.lithology !== b.lithology) throw new KJValidationError('Geology: correlation needs declared compatible strata');
        const key = `${left.hole.id}:${a.intervalId ?? `${a.code}@${a.top}-${a.bottom}`}|${right.hole.id}:${b.intervalId ?? `${b.code}@${b.top}-${b.bottom}`}`;
        if (unique.has(key)) throw new KJValidationError('Geology: duplicate correlation');
        unique.add(key);
        const xl = x(left.hole), xr = x(right.hole);
        const topL = y(left.hole, a.top), topR = y(right.hole, b.top), bottomL = y(left.hole, a.bottom), bottomR = y(right.hole, b.bottom);
        g.hatch([
            [
                xl,
                bottomL
            ],
            [
                xr,
                bottomR
            ],
            [
                xr,
                topR
            ],
            [
                xl,
                topL
            ]
        ], a);
        g.line(1, xl, bottomL, xr, bottomR);
        g.line(1, xl, topL, xr, topR);
        g.text(3, (xl + xr) / 2 - 5, (topL + topR + bottomL + bottomR) / 4, `${a.code} ${a.name}`, 2.3);
    }
    g.text(3, 16, 13, 'Only supplied strata/correlations are shown. Uncorrelated regions are intentionally blank.', 2.3);
    return g.finish();
}
