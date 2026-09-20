// Generated from agent-geology-plan.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { stableHash } from './utils.js';
export const KJDRAW_GEOLOGY_PLAN_VERSION = '1.0.0';
const INPUT_KEYS = [
    'version',
    'expectedRevision',
    'units',
    'locale',
    'drawingId',
    'title',
    'revision',
    'scale',
    'boundary',
    'boreholes',
    'sectionLines',
    'coordinateGrid',
    'northAngleDegrees'
];
const BOREHOLE_KEYS = [
    'id',
    'position',
    'collarElevation',
    'depth',
    'kind'
];
const SECTION_KEYS = [
    'id',
    'holeIds',
    'label',
    'endpointLabels'
];
const GRID_KEYS = [
    'origin',
    'spacing'
];
const SCALES = new Set([
    50,
    100,
    200,
    500,
    1000,
    2000
]);
const KINDS = new Set([
    'borehole',
    'test-pit',
    'in-situ-test'
]);
const EPSILON = 1e-9;
const MAX_ENTITIES = 512;
function plain(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KJValidationError(`${label} must be an object`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new KJValidationError(`${label} must be a plain object`);
    return value;
}
function exactKeys(value, allowed, label) {
    const unsupported = Object.keys(value).find((key)=>!allowed.includes(key));
    if (unsupported) throw new KJValidationError(`${label} contains unsupported field: ${unsupported}`);
}
function finite(value, label, minimum = -100_000_000, maximum = 100_000_000) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new KJValidationError(`${label} must be a finite number from ${minimum} to ${maximum}`);
    return value;
}
function integer(value, label, minimum, maximum) {
    const result = finite(value, label, minimum, maximum);
    if (!Number.isSafeInteger(result)) throw new KJValidationError(`${label} must be an integer`);
    return result;
}
function text(value, label, maximum = 80) {
    if (typeof value !== 'string') throw new KJValidationError(`${label} must be a string`);
    const result = value.trim();
    if (!result || [
        ...result
    ].length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) throw new KJValidationError(`${label} must contain 1-${maximum} printable characters`);
    return result;
}
function point(value, label) {
    if (!Array.isArray(value) || value.length !== 2) throw new KJValidationError(`${label} must contain exactly two coordinates`);
    return [
        finite(value[0], `${label}[0]`),
        finite(value[1], `${label}[1]`)
    ];
}
function cross(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(p, a, b) {
    return Math.abs(cross(a, b, p)) <= EPSILON && p[0] >= Math.min(a[0], b[0]) - EPSILON && p[0] <= Math.max(a[0], b[0]) + EPSILON && p[1] >= Math.min(a[1], b[1]) - EPSILON && p[1] <= Math.max(a[1], b[1]) + EPSILON;
}
function intersects(a, b, c, d) {
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    if ((abC > EPSILON && abD < -EPSILON || abC < -EPSILON && abD > EPSILON) && (cdA > EPSILON && cdB < -EPSILON || cdA < -EPSILON && cdB > EPSILON)) return true;
    return Math.abs(abC) <= EPSILON && onSegment(c, a, b) || Math.abs(abD) <= EPSILON && onSegment(d, a, b) || Math.abs(cdA) <= EPSILON && onSegment(a, c, d) || Math.abs(cdB) <= EPSILON && onSegment(b, c, d);
}
function polygonArea(points) {
    let twice = 0;
    for(let index = 0; index < points.length; index += 1){
        const current = points[index], next = points[(index + 1) % points.length];
        twice += current[0] * next[1] - next[0] * current[1];
    }
    return Math.abs(twice) / 2;
}
function validatePolygon(points) {
    if (polygonArea(points) <= EPSILON) throw new KJValidationError('input.boundary must enclose a positive area');
    for(let index = 0; index < points.length; index += 1){
        const next = (index + 1) % points.length;
        if (Math.hypot(points[index][0] - points[next][0], points[index][1] - points[next][1]) <= EPSILON) throw new KJValidationError('input.boundary contains a zero-length edge');
        for(let other = index + 1; other < points.length; other += 1){
            const otherNext = (other + 1) % points.length;
            if (other === index || other === next || otherNext === index) continue;
            if (intersects(points[index], points[next], points[other], points[otherNext])) throw new KJValidationError('input.boundary must not self-intersect');
        }
    }
}
function inside(pointValue, polygon) {
    let result = false;
    for(let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1){
        const a = polygon[previous], b = polygon[index];
        if (onSegment(pointValue, a, b)) return true;
        if (a[1] > pointValue[1] !== b[1] > pointValue[1] && pointValue[0] < (b[0] - a[0]) * (pointValue[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
}
function format(value, decimals = 2) {
    return value.toFixed(decimals).replace(/\.0+$/u, '').replace(/(\.\d*?)0+$/u, '$1');
}
function validateInput(document, source) {
    if (!document || typeof document.id !== 'string' || !Number.isInteger(document.revision) || typeof document.snapshot !== 'function') throw new KJValidationError('Geology plan compiler requires a KJDraw document');
    const input = plain(source, 'input');
    exactKeys(input, INPUT_KEYS, 'input');
    if (input.version !== KJDRAW_GEOLOGY_PLAN_VERSION) throw new KJValidationError(`input.version must be ${KJDRAW_GEOLOGY_PLAN_VERSION}`);
    if (input.units !== 'meter' || document.snapshot()?.header?.units !== 'meter') throw new KJValidationError('Geology plan compiler requires meter units');
    const expectedRevision = integer(input.expectedRevision, 'input.expectedRevision', 0, Number.MAX_SAFE_INTEGER);
    if (expectedRevision !== document.revision) throw new KJValidationError(`input.expectedRevision ${expectedRevision} does not match document revision ${document.revision}`);
    if (Object.values(document.snapshot()?.objects ?? {}).some((value)=>value && typeof value === 'object' && value.kind === 'entity')) throw new KJValidationError('Geology plan compiler requires a blank document');
    const scale = finite(input.scale, 'input.scale');
    if (!SCALES.has(scale)) throw new KJValidationError('input.scale must be one of 50, 100, 200, 500, 1000 or 2000');
    if (!Array.isArray(input.boundary) || input.boundary.length < 3 || input.boundary.length > 128) throw new KJValidationError('input.boundary must contain 3-128 points');
    const boundary = input.boundary.map((value, index)=>point(value, `input.boundary[${index}]`));
    validatePolygon(boundary);
    if (!Array.isArray(input.boreholes) || input.boreholes.length < 2 || input.boreholes.length > 128) throw new KJValidationError('input.boreholes must contain 2-128 points');
    const boreholes = input.boreholes.map((raw, index)=>{
        const value = plain(raw, `input.boreholes[${index}]`);
        exactKeys(value, BOREHOLE_KEYS, `input.boreholes[${index}]`);
        const position = point(value.position, `input.boreholes[${index}].position`);
        if (!inside(position, boundary)) throw new KJValidationError(`input.boreholes[${index}].position must lie inside the boundary`);
        const kind = value.kind == null ? 'borehole' : text(value.kind, `input.boreholes[${index}].kind`, 20);
        if (!KINDS.has(kind)) throw new KJValidationError(`input.boreholes[${index}].kind is unsupported`);
        return {
            id: text(value.id, `input.boreholes[${index}].id`, 40),
            position,
            collarElevation: finite(value.collarElevation, `input.boreholes[${index}].collarElevation`),
            depth: value.depth == null ? undefined : finite(value.depth, `input.boreholes[${index}].depth`, 0.01, 10_000),
            kind
        };
    });
    const holesById = new Map();
    for (const hole of boreholes){
        if (holesById.has(hole.id)) throw new KJValidationError(`input.boreholes contains duplicate id ${hole.id}`);
        holesById.set(hole.id, hole);
    }
    if (!Array.isArray(input.sectionLines) || input.sectionLines.length < 1 || input.sectionLines.length > 32) throw new KJValidationError('input.sectionLines must contain 1-32 referenced lines');
    const sectionIds = new Set();
    const sectionLines = input.sectionLines.map((raw, index)=>{
        const value = plain(raw, `input.sectionLines[${index}]`);
        exactKeys(value, SECTION_KEYS, `input.sectionLines[${index}]`);
        const id = text(value.id, `input.sectionLines[${index}].id`, 40);
        if (sectionIds.has(id)) throw new KJValidationError(`input.sectionLines contains duplicate id ${id}`);
        sectionIds.add(id);
        if (!Array.isArray(value.holeIds) || value.holeIds.length < 2 || value.holeIds.length > 24) throw new KJValidationError(`input.sectionLines[${index}].holeIds must contain 2-24 ids`);
        const holeIds = value.holeIds.map((holeId, holeIndex)=>text(holeId, `input.sectionLines[${index}].holeIds[${holeIndex}]`, 40));
        if (new Set(holeIds).size !== holeIds.length) throw new KJValidationError(`input.sectionLines[${index}].holeIds must not repeat a point`);
        for (const holeId of holeIds)if (!holesById.has(holeId)) throw new KJValidationError(`input.sectionLines[${index}] references unknown borehole ${holeId}`);
        let endpointLabels;
        if (value.endpointLabels !== undefined) {
            if (!Array.isArray(value.endpointLabels) || value.endpointLabels.length !== 2) throw new KJValidationError(`input.sectionLines[${index}].endpointLabels must contain exactly 2 labels`);
            endpointLabels = [
                text(value.endpointLabels[0], `input.sectionLines[${index}].endpointLabels[0]`, 24),
                text(value.endpointLabels[1], `input.sectionLines[${index}].endpointLabels[1]`, 24)
            ];
        }
        return {
            id,
            holeIds,
            label: text(value.label, `input.sectionLines[${index}].label`, 48),
            endpointLabels
        };
    });
    const grid = plain(input.coordinateGrid, 'input.coordinateGrid');
    exactKeys(grid, GRID_KEYS, 'input.coordinateGrid');
    const coordinateGrid = {
        origin: point(grid.origin, 'input.coordinateGrid.origin'),
        spacing: finite(grid.spacing, 'input.coordinateGrid.spacing', 0.1, 1_000_000)
    };
    const northAngleDegrees = finite(input.northAngleDegrees ?? 0, 'input.northAngleDegrees', -360, 360);
    const locale = input.locale == null ? [
        ...boreholes.map((value)=>value.id),
        ...sectionLines.map((value)=>value.label),
        input.title
    ].some((value)=>/[\u3400-\u9fff]/u.test(String(value ?? ''))) ? 'zh-CN' : 'en' : input.locale === 'zh-CN' || input.locale === 'en' ? input.locale : (()=>{
        throw new KJValidationError('input.locale must be zh-CN or en');
    })();
    return {
        expectedRevision,
        scale,
        boundary,
        boreholes,
        holesById,
        sectionLines,
        coordinateGrid,
        northAngleDegrees,
        locale,
        drawingId: text(input.drawingId, 'input.drawingId', 64),
        title: input.title == null ? undefined : text(input.title, 'input.title', 96),
        revision: input.revision == null ? undefined : text(input.revision, 'input.revision', 32)
    };
}
export function buildAgentGeologyPlan(document, source) {
    const input = validateInput(document, source);
    const minimum = [
        Math.min(...input.boundary.map((value)=>value[0])),
        Math.min(...input.boundary.map((value)=>value[1]))
    ];
    const maximum = [
        Math.max(...input.boundary.map((value)=>value[0])),
        Math.max(...input.boundary.map((value)=>value[1]))
    ];
    const width = maximum[0] - minimum[0], height = maximum[1] - minimum[1];
    const groundWidth = 390 * input.scale / 1000, groundHeight = 250 * input.scale / 1000;
    const margin = Math.max(input.coordinateGrid.spacing * 0.12, 4 * input.scale / 1000);
    if (width + margin * 2 > groundWidth + EPSILON || height + margin * 2 > groundHeight + EPSILON) throw new KJValidationError('input.boundary does not fit ISO A3 landscape at the declared scale');
    const firstGridX = input.coordinateGrid.origin[0] + Math.ceil((minimum[0] - input.coordinateGrid.origin[0]) / input.coordinateGrid.spacing) * input.coordinateGrid.spacing;
    const firstGridY = input.coordinateGrid.origin[1] + Math.ceil((minimum[1] - input.coordinateGrid.origin[1]) / input.coordinateGrid.spacing) * input.coordinateGrid.spacing;
    const gridXs = [], gridYs = [];
    for(let value = firstGridX; value <= maximum[0] + EPSILON; value += input.coordinateGrid.spacing)gridXs.push(value);
    for(let value = firstGridY; value <= maximum[1] + EPSILON; value += input.coordinateGrid.spacing)gridYs.push(value);
    if (gridXs.length + gridYs.length > 80) throw new KJValidationError('input.coordinateGrid expands to more than 80 grid lines; increase spacing');
    const prefix = `geoplan-${stableHash({
        drawingId: input.drawingId,
        version: source.version
    }).slice(0, 12)}`;
    const linetypes = {
        continuous: `${prefix}-lt-continuous`,
        grid: `${prefix}-lt-grid`,
        section: `${prefix}-lt-section`
    };
    const layers = {
        BOUNDARY: {
            id: `${prefix}-layer-boundary`,
            color: 7,
            linetypeId: linetypes.continuous,
            lineweight: 50
        },
        GRID: {
            id: `${prefix}-layer-grid`,
            color: 8,
            linetypeId: linetypes.grid,
            lineweight: 13
        },
        POINTS: {
            id: `${prefix}-layer-points`,
            color: 1,
            linetypeId: linetypes.continuous,
            lineweight: 35
        },
        SECTIONS: {
            id: `${prefix}-layer-sections`,
            color: 2,
            linetypeId: linetypes.section,
            lineweight: 35
        },
        ANNOTATION: {
            id: `${prefix}-layer-annotation`,
            color: 7,
            linetypeId: linetypes.continuous,
            lineweight: 18
        }
    };
    const entities = [], p3 = (value)=>[
            value[0],
            value[1],
            0
        ];
    const add = (type, layer, payload)=>entities.push({
            type,
            payload: {
                ...payload,
                layerId: layers[layer].id
            },
            options: {
                id: `${prefix}-${String(entities.length + 1).padStart(4, '0')}`
            }
        });
    const addText = (position, value, textHeight, layer = 'ANNOTATION', rotation = 0, extra = {})=>add('TEXT', layer, {
            position: p3(position),
            text: value,
            height: textHeight,
            rotation,
            ...extra
        });
    const textHeight = 2.5 * input.scale / 1000, markerRadius = 2.2 * input.scale / 1000;
    add('LWPOLYLINE', 'BOUNDARY', {
        vertices: input.boundary.map(p3),
        closed: true,
        semanticRole: 'survey-boundary'
    });
    for (const x of gridXs){
        add('LINE', 'GRID', {
            start: [
                x,
                minimum[1],
                0
            ],
            end: [
                x,
                maximum[1],
                0
            ],
            semanticRole: 'coordinate-grid-easting',
            coordinate: x
        });
        addText([
            x,
            minimum[1] - textHeight * 1.4
        ], `E ${format(x, 3)}`, textHeight * 0.72);
    }
    for (const y of gridYs){
        add('LINE', 'GRID', {
            start: [
                minimum[0],
                y,
                0
            ],
            end: [
                maximum[0],
                y,
                0
            ],
            semanticRole: 'coordinate-grid-northing',
            coordinate: y
        });
        addText([
            minimum[0] - textHeight * 4.2,
            y
        ], `N ${format(y, 3)}`, textHeight * 0.72);
    }
    for (const hole of input.boreholes){
        add('CIRCLE', 'POINTS', {
            center: p3(hole.position),
            radius: markerRadius,
            semanticRole: 'investigation-point',
            sourceId: hole.id,
            pointKind: hole.kind
        });
        add('LINE', 'POINTS', {
            start: [
                hole.position[0] - markerRadius,
                hole.position[1],
                0
            ],
            end: [
                hole.position[0] + markerRadius,
                hole.position[1],
                0
            ],
            semanticRole: 'investigation-point-cross',
            sourceId: hole.id
        });
        add('LINE', 'POINTS', {
            start: [
                hole.position[0],
                hole.position[1] - markerRadius,
                0
            ],
            end: [
                hole.position[0],
                hole.position[1] + markerRadius,
                0
            ],
            semanticRole: 'investigation-point-cross',
            sourceId: hole.id
        });
        addText([
            hole.position[0] + markerRadius * 1.25,
            hole.position[1] + textHeight * 0.25
        ], hole.id, textHeight, 'ANNOTATION', 0, {
            semanticRole: 'investigation-point-label',
            sourceId: hole.id
        });
        const facts = hole.depth == null ? `H=${format(hole.collarElevation, 2)}` : `H=${format(hole.collarElevation, 2)}  D=${format(hole.depth, 2)}`;
        addText([
            hole.position[0] + markerRadius * 1.25,
            hole.position[1] - textHeight
        ], facts, textHeight * 0.76, 'ANNOTATION', 0, {
            semanticRole: 'investigation-point-facts',
            sourceId: hole.id
        });
    }
    for (const section of input.sectionLines){
        const positions = section.holeIds.map((id)=>input.holesById.get(id).position);
        add('LWPOLYLINE', 'SECTIONS', {
            vertices: positions.map(p3),
            closed: false,
            semanticRole: 'section-line',
            sourceId: section.id,
            referencedHoleIds: section.holeIds
        });
        const start = positions[0], end = positions.at(-1);
        const angle = Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;
        const [startLabel, endLabel] = section.endpointLabels ?? [
            section.label,
            section.label
        ];
        addText([
            start[0],
            start[1] + textHeight * 1.35
        ], startLabel, textHeight, 'SECTIONS', angle, {
            semanticRole: 'section-reference',
            sourceId: section.id,
            endpoint: 'start'
        });
        addText([
            end[0],
            end[1] + textHeight * 1.35
        ], endLabel, textHeight, 'SECTIONS', angle, {
            semanticRole: 'section-reference',
            sourceId: section.id,
            endpoint: 'end'
        });
    }
    const arrowLength = 12 * input.scale / 1000, angle = (90 + input.northAngleDegrees) * Math.PI / 180;
    const arrowBase = [
        maximum[0] - margin * 1.4,
        maximum[1] - margin * 1.4
    ];
    const arrowTip = [
        arrowBase[0] + Math.cos(angle) * arrowLength,
        arrowBase[1] + Math.sin(angle) * arrowLength
    ];
    add('LINE', 'ANNOTATION', {
        start: p3(arrowBase),
        end: p3(arrowTip),
        semanticRole: 'north-arrow'
    });
    const wing = arrowLength * 0.28;
    const arrowHead = [
        arrowTip,
        [
            arrowTip[0] - Math.cos(angle - 0.45) * wing,
            arrowTip[1] - Math.sin(angle - 0.45) * wing
        ],
        [
            arrowTip[0] - Math.cos(angle + 0.45) * wing,
            arrowTip[1] - Math.sin(angle + 0.45) * wing
        ]
    ];
    add('LWPOLYLINE', 'ANNOTATION', {
        vertices: arrowHead.map(p3),
        closed: true,
        semanticRole: 'north-arrow-head'
    });
    addText([
        arrowTip[0],
        arrowTip[1] + textHeight
    ], input.locale === 'zh-CN' ? '北' : 'N', textHeight * 1.15);
    const title = input.title ?? (input.locale === 'zh-CN' ? '勘探点平面位置图' : 'INVESTIGATION POINT LOCATION PLAN');
    addText([
        minimum[0],
        maximum[1] + textHeight * 2.4
    ], title, textHeight * 1.25);
    addText([
        minimum[0],
        maximum[1] + textHeight * 0.8
    ], input.locale === 'zh-CN' ? `图号 ${input.drawingId}${input.revision ? `  版本 ${input.revision}` : ''}  比例 1:${input.scale}` : `DRAWING ${input.drawingId}${input.revision ? `  REV ${input.revision}` : ''}  SCALE 1:${input.scale}`, textHeight * 0.82);
    if (entities.length + 1 > MAX_ENTITIES) throw new KJValidationError(`Geology plan expands to ${entities.length + 1} entities; maximum is ${MAX_ENTITIES}`);
    const center = [
        (minimum[0] + maximum[0]) / 2,
        (minimum[1] + maximum[1]) / 2
    ];
    const layoutName = `KJ_GEO_PLAN_${prefix.slice(8, 20).toUpperCase()}_A3`;
    const layout = {
        id: `${prefix}-layout`,
        blockRecordId: `${prefix}-paper-space`,
        name: layoutName,
        dxfPlotSettings: {
            paperWidth: 420,
            paperHeight: 297,
            marginLeft: 15,
            marginBottom: 25,
            marginRight: 15,
            marginTop: 12,
            originX: 0,
            originY: 0,
            scaleNumerator: 1,
            scaleDenominator: 1,
            flags: 0,
            paperUnits: 1,
            rotation: 0,
            plotType: 5
        },
        viewport: {
            id: `${prefix}-viewport`,
            center: [
                210,
                155,
                0
            ],
            width: 390,
            height: 250,
            viewCenter: [
                ...center,
                0
            ],
            viewHeight: groundHeight,
            twistAngle: 0,
            modelUnits: 'meter',
            scaleDenominator: input.scale
        }
    };
    return {
        commandArgs: {
            entities,
            resources: {
                linetypes: [
                    {
                        id: linetypes.continuous,
                        name: `KJ_${prefix.slice(8, 20)}_CONT`,
                        pattern: []
                    },
                    {
                        id: linetypes.grid,
                        name: `KJ_${prefix.slice(8, 20)}_GRID`,
                        pattern: [
                            1.5,
                            -1.5
                        ]
                    },
                    {
                        id: linetypes.section,
                        name: `KJ_${prefix.slice(8, 20)}_SECTION`,
                        pattern: [
                            6,
                            -2,
                            1,
                            -2
                        ]
                    }
                ],
                layers: Object.entries(layers).map(([name, definition])=>({
                        name,
                        ...definition
                    }))
            },
            layout
        },
        outputConfig: {
            layoutName,
            paper: {
                standard: 'ISO A3',
                orientation: 'landscape',
                widthMm: 420,
                heightMm: 297
            },
            scaleNumerator: 1,
            scaleDenominator: input.scale,
            modelUnits: 'meter',
            viewport: {
                center,
                width: groundWidth,
                height: groundHeight
            }
        },
        evidence: {
            drawingId: input.drawingId,
            skillId: 'geology-plan',
            skillVersion: KJDRAW_GEOLOGY_PLAN_VERSION,
            expectedRevision: input.expectedRevision,
            units: 'meter',
            modelEntityCount: entities.length,
            entityCount: entities.length + 1,
            boreholeCount: input.boreholes.length,
            sectionLineCount: input.sectionLines.length,
            sectionReferences: input.sectionLines.map((value)=>({
                    id: value.id,
                    label: value.label,
                    holeIds: [
                        ...value.holeIds
                    ],
                    endpointLabels: value.endpointLabels ? [
                        ...value.endpointLabels
                    ] : [
                        value.label,
                        value.label
                    ]
                })),
            gridLineCount: gridXs.length + gridYs.length,
            coordinateBounds: {
                minimum,
                maximum
            },
            scaleDenominator: input.scale,
            northAngleDegrees: input.northAngleDegrees,
            limitations: [
                'Version 1.0.0 compiles one supplied boundary and one A3 landscape view',
                'Investigation-point coordinates, elevations, depths and section references are supplied facts and are never inferred'
            ]
        }
    };
}
