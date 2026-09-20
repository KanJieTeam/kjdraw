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
    'coordinateCallouts',
    'dimensions',
    'buildingFootprints',
    'roadPaths',
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
    'endpointLabels',
    'markerClearance',
    'endpointTailLengths',
    'endpointLabelPositions'
];
const GRID_KEYS = [
    'origin',
    'spacing'
];
const COORDINATE_CALLOUT_KEYS = [
    'id',
    'point',
    'elbow',
    'landingEnd',
    'xLabelPosition',
    'yLabelPosition',
    'precision',
    'textHeight'
];
const DIMENSION_KEYS = [
    'id',
    'dimensionLinePoint',
    'firstExtensionOrigin',
    'secondExtensionOrigin',
    'textPosition',
    'displayValue',
    'precision',
    'unitSuffix'
];
const BUILDING_KEYS = [
    'id',
    'outline'
];
const ROAD_PATH_KEYS = [
    'id',
    'start',
    'segments',
    'closed'
];
const ROAD_LINE_KEYS = [
    'kind',
    'end'
];
const ROAD_ARC_KEYS = [
    'kind',
    'center',
    'end',
    'clockwise'
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
function pair(value, label, minimum, maximum) {
    if (!Array.isArray(value) || value.length !== 2) throw new KJValidationError(`${label} must contain exactly two values`);
    return [
        finite(value[0], `${label}[0]`, minimum, maximum),
        finite(value[1], `${label}[1]`, minimum, maximum)
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
function validatePolygon(points, label = 'input.boundary') {
    if (polygonArea(points) <= EPSILON) throw new KJValidationError(`${label} must enclose a positive area`);
    for(let index = 0; index < points.length; index += 1){
        const next = (index + 1) % points.length;
        if (Math.hypot(points[index][0] - points[next][0], points[index][1] - points[next][1]) <= EPSILON) throw new KJValidationError(`${label} contains a zero-length edge`);
        for(let other = index + 1; other < points.length; other += 1){
            const otherNext = (other + 1) % points.length;
            if (other === index || other === next || otherNext === index) continue;
            if (intersects(points[index], points[next], points[other], points[otherNext])) throw new KJValidationError(`${label} must not self-intersect`);
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
function normalizedAngle(value) {
    const result = value % (Math.PI * 2);
    return result < 0 ? result + Math.PI * 2 : result;
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
    const boundaryMinimum = [
        Math.min(...boundary.map((value)=>value[0])),
        Math.min(...boundary.map((value)=>value[1]))
    ];
    const boundaryMaximum = [
        Math.max(...boundary.map((value)=>value[0])),
        Math.max(...boundary.map((value)=>value[1]))
    ];
    const modelViewportCenter = [
        (boundaryMinimum[0] + boundaryMaximum[0]) / 2,
        (boundaryMinimum[1] + boundaryMaximum[1]) / 2
    ];
    const modelViewportWidth = 390 * scale / 1000, modelViewportHeight = 250 * scale / 1000;
    const insideModelViewport = (value)=>value[0] >= modelViewportCenter[0] - modelViewportWidth / 2 - EPSILON && value[0] <= modelViewportCenter[0] + modelViewportWidth / 2 + EPSILON && value[1] >= modelViewportCenter[1] - modelViewportHeight / 2 - EPSILON && value[1] <= modelViewportCenter[1] + modelViewportHeight / 2 + EPSILON;
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
        const markerClearance = value.markerClearance === undefined ? undefined : pair(value.markerClearance, `input.sectionLines[${index}].markerClearance`, 0.001, 1_000_000);
        const endpointTailLengths = value.endpointTailLengths === undefined ? undefined : pair(value.endpointTailLengths, `input.sectionLines[${index}].endpointTailLengths`, 0, 1_000_000);
        let endpointLabelPositions;
        if (value.endpointLabelPositions !== undefined) {
            if (!Array.isArray(value.endpointLabelPositions) || value.endpointLabelPositions.length !== 2) throw new KJValidationError(`input.sectionLines[${index}].endpointLabelPositions must contain exactly 2 points`);
            endpointLabelPositions = [
                point(value.endpointLabelPositions[0], `input.sectionLines[${index}].endpointLabelPositions[0]`),
                point(value.endpointLabelPositions[1], `input.sectionLines[${index}].endpointLabelPositions[1]`)
            ];
        }
        return {
            id,
            holeIds,
            label: text(value.label, `input.sectionLines[${index}].label`, 48),
            endpointLabels,
            markerClearance,
            endpointTailLengths,
            endpointLabelPositions
        };
    });
    let coordinateGrid;
    if (input.coordinateGrid !== undefined) {
        const grid = plain(input.coordinateGrid, 'input.coordinateGrid');
        exactKeys(grid, GRID_KEYS, 'input.coordinateGrid');
        coordinateGrid = {
            origin: point(grid.origin, 'input.coordinateGrid.origin'),
            spacing: finite(grid.spacing, 'input.coordinateGrid.spacing', 0.1, 1_000_000)
        };
    }
    if (input.coordinateCallouts !== undefined && (!Array.isArray(input.coordinateCallouts) || input.coordinateCallouts.length > 64)) throw new KJValidationError('input.coordinateCallouts must contain at most 64 supplied callouts');
    const coordinateCalloutIds = new Set();
    const coordinateCallouts = (input.coordinateCallouts ?? []).map((raw, index)=>{
        const value = plain(raw, `input.coordinateCallouts[${index}]`);
        exactKeys(value, COORDINATE_CALLOUT_KEYS, `input.coordinateCallouts[${index}]`);
        const id = text(value.id, `input.coordinateCallouts[${index}].id`, 40);
        if (coordinateCalloutIds.has(id)) throw new KJValidationError(`input.coordinateCallouts contains duplicate id ${id}`);
        coordinateCalloutIds.add(id);
        const callout = {
            id,
            point: point(value.point, `input.coordinateCallouts[${index}].point`),
            elbow: point(value.elbow, `input.coordinateCallouts[${index}].elbow`),
            landingEnd: point(value.landingEnd, `input.coordinateCallouts[${index}].landingEnd`),
            xLabelPosition: point(value.xLabelPosition, `input.coordinateCallouts[${index}].xLabelPosition`),
            yLabelPosition: point(value.yLabelPosition, `input.coordinateCallouts[${index}].yLabelPosition`),
            precision: value.precision == null ? 3 : integer(value.precision, `input.coordinateCallouts[${index}].precision`, 0, 6),
            textHeight: value.textHeight == null ? 2.5 * scale / 1000 : finite(value.textHeight, `input.coordinateCallouts[${index}].textHeight`, 0.01, 1_000)
        };
        if (![
            callout.point,
            callout.elbow,
            callout.landingEnd,
            callout.xLabelPosition,
            callout.yLabelPosition
        ].every(insideModelViewport)) throw new KJValidationError(`input.coordinateCallouts[${index}] geometry must lie inside the declared model viewport`);
        if (Math.hypot(callout.elbow[0] - callout.point[0], callout.elbow[1] - callout.point[1]) <= EPSILON) throw new KJValidationError(`input.coordinateCallouts[${index}] point-to-elbow leader must have positive length`);
        if (Math.hypot(callout.landingEnd[0] - callout.elbow[0], callout.landingEnd[1] - callout.elbow[1]) <= EPSILON) throw new KJValidationError(`input.coordinateCallouts[${index}] elbow-to-landing leader must have positive length`);
        return callout;
    });
    if (Boolean(coordinateGrid) === coordinateCallouts.length > 0) throw new KJValidationError('input must supply exactly one coordinate strategy: coordinateGrid or coordinateCallouts');
    if (input.dimensions !== undefined && (!Array.isArray(input.dimensions) || input.dimensions.length > 64)) throw new KJValidationError('input.dimensions must contain at most 64 supplied aligned dimensions');
    const dimensionIds = new Set();
    const dimensions = (input.dimensions ?? []).map((raw, index)=>{
        const value = plain(raw, `input.dimensions[${index}]`);
        exactKeys(value, DIMENSION_KEYS, `input.dimensions[${index}]`);
        const id = text(value.id, `input.dimensions[${index}].id`, 40);
        if (dimensionIds.has(id)) throw new KJValidationError(`input.dimensions contains duplicate id ${id}`);
        dimensionIds.add(id);
        const dimensionLinePoint = point(value.dimensionLinePoint, `input.dimensions[${index}].dimensionLinePoint`);
        const firstExtensionOrigin = point(value.firstExtensionOrigin, `input.dimensions[${index}].firstExtensionOrigin`);
        const secondExtensionOrigin = point(value.secondExtensionOrigin, `input.dimensions[${index}].secondExtensionOrigin`);
        const textPosition = value.textPosition == null ? dimensionLinePoint : point(value.textPosition, `input.dimensions[${index}].textPosition`);
        if (![
            dimensionLinePoint,
            firstExtensionOrigin,
            secondExtensionOrigin,
            textPosition
        ].every(insideModelViewport)) throw new KJValidationError(`input.dimensions[${index}] geometry must lie inside the declared model viewport`);
        const measuredLength = Math.hypot(secondExtensionOrigin[0] - firstExtensionOrigin[0], secondExtensionOrigin[1] - firstExtensionOrigin[1]);
        if (measuredLength <= EPSILON) throw new KJValidationError(`input.dimensions[${index}] extension origins must be distinct`);
        const dimensionLineOffset = Math.abs((secondExtensionOrigin[0] - firstExtensionOrigin[0]) * (firstExtensionOrigin[1] - dimensionLinePoint[1]) - (firstExtensionOrigin[0] - dimensionLinePoint[0]) * (secondExtensionOrigin[1] - firstExtensionOrigin[1])) / measuredLength;
        if (dimensionLineOffset <= EPSILON) throw new KJValidationError(`input.dimensions[${index}].dimensionLinePoint must be offset from the measured line`);
        const displayValue = finite(value.displayValue, `input.dimensions[${index}].displayValue`, 0.000001, 100_000_000);
        const precision = value.precision == null ? 2 : integer(value.precision, `input.dimensions[${index}].precision`, 0, 6);
        const unitSuffix = value.unitSuffix == null ? 'none' : value.unitSuffix;
        if (unitSuffix !== 'none' && unitSuffix !== 'm' && unitSuffix !== 'M') throw new KJValidationError(`input.dimensions[${index}].unitSuffix must be none, m or M`);
        return {
            id,
            dimensionLinePoint,
            firstExtensionOrigin,
            secondExtensionOrigin,
            textPosition,
            displayValue,
            precision,
            unitSuffix
        };
    });
    if (input.buildingFootprints !== undefined && (!Array.isArray(input.buildingFootprints) || input.buildingFootprints.length > 128)) throw new KJValidationError('input.buildingFootprints must contain at most 128 supplied outlines');
    const buildingIds = new Set();
    const buildingFootprints = (input.buildingFootprints ?? []).map((raw, index)=>{
        const value = plain(raw, `input.buildingFootprints[${index}]`);
        exactKeys(value, BUILDING_KEYS, `input.buildingFootprints[${index}]`);
        const id = text(value.id, `input.buildingFootprints[${index}].id`, 40);
        if (buildingIds.has(id)) throw new KJValidationError(`input.buildingFootprints contains duplicate id ${id}`);
        buildingIds.add(id);
        if (!Array.isArray(value.outline) || value.outline.length < 3 || value.outline.length > 65) throw new KJValidationError(`input.buildingFootprints[${index}].outline must contain 3-65 supplied points`);
        const suppliedOutline = value.outline.map((rawPoint, pointIndex)=>point(rawPoint, `input.buildingFootprints[${index}].outline[${pointIndex}]`));
        const firstOutlinePoint = suppliedOutline[0], lastOutlinePoint = suppliedOutline.at(-1);
        const outline = suppliedOutline.length > 3 && Math.hypot(firstOutlinePoint[0] - lastOutlinePoint[0], firstOutlinePoint[1] - lastOutlinePoint[1]) <= EPSILON ? suppliedOutline.slice(0, -1) : suppliedOutline;
        if (outline.length < 3 || outline.length > 64) throw new KJValidationError(`input.buildingFootprints[${index}].outline must normalize to 3-64 vertices`);
        validatePolygon(outline, `input.buildingFootprints[${index}].outline`);
        if (!outline.every((outlinePoint)=>inside(outlinePoint, boundary))) throw new KJValidationError(`input.buildingFootprints[${index}].outline must lie inside the boundary`);
        return {
            id,
            outline
        };
    });
    if (input.roadPaths !== undefined && (!Array.isArray(input.roadPaths) || input.roadPaths.length > 128)) throw new KJValidationError('input.roadPaths must contain at most 128 supplied paths');
    const roadIds = new Set();
    let roadSegmentCount = 0;
    const roadPaths = (input.roadPaths ?? []).map((raw, pathIndex)=>{
        const value = plain(raw, `input.roadPaths[${pathIndex}]`);
        exactKeys(value, ROAD_PATH_KEYS, `input.roadPaths[${pathIndex}]`);
        const id = text(value.id, `input.roadPaths[${pathIndex}].id`, 40);
        if (roadIds.has(id)) throw new KJValidationError(`input.roadPaths contains duplicate id ${id}`);
        roadIds.add(id);
        const start = point(value.start, `input.roadPaths[${pathIndex}].start`);
        if (!insideModelViewport(start)) throw new KJValidationError(`input.roadPaths[${pathIndex}].start must lie inside the declared model viewport`);
        if (!Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > 64) throw new KJValidationError(`input.roadPaths[${pathIndex}].segments must contain 1-64 continuous segments`);
        const closed = value.closed == null ? false : value.closed;
        if (typeof closed !== 'boolean') throw new KJValidationError(`input.roadPaths[${pathIndex}].closed must be boolean`);
        let current = start;
        const segments = value.segments.map((rawSegment, segmentIndex)=>{
            const label = `input.roadPaths[${pathIndex}].segments[${segmentIndex}]`;
            const segment = plain(rawSegment, label);
            if (segment.kind !== 'line' && segment.kind !== 'arc') throw new KJValidationError(`${label}.kind must be line or arc`);
            exactKeys(segment, segment.kind === 'line' ? ROAD_LINE_KEYS : ROAD_ARC_KEYS, label);
            const end = point(segment.end, `${label}.end`);
            if (!insideModelViewport(end)) throw new KJValidationError(`${label}.end must lie inside the declared model viewport`);
            const segmentStart = current;
            current = end;
            roadSegmentCount += 1;
            if (segment.kind === 'line') {
                if (Math.hypot(end[0] - segmentStart[0], end[1] - segmentStart[1]) <= EPSILON) throw new KJValidationError(`${label} must have positive length`);
                for(let sample = 1; sample < 10; sample += 1){
                    const ratio = sample / 10;
                    if (!insideModelViewport([
                        segmentStart[0] + (end[0] - segmentStart[0]) * ratio,
                        segmentStart[1] + (end[1] - segmentStart[1]) * ratio
                    ])) throw new KJValidationError(`${label} must remain inside the declared model viewport`);
                }
                return {
                    kind: 'line',
                    end
                };
            }
            const center = point(segment.center, `${label}.center`);
            const clockwise = segment.clockwise == null ? false : segment.clockwise;
            if (typeof clockwise !== 'boolean') throw new KJValidationError(`${label}.clockwise must be boolean`);
            const startRadius = Math.hypot(segmentStart[0] - center[0], segmentStart[1] - center[1]);
            const endRadius = Math.hypot(end[0] - center[0], end[1] - center[1]);
            if (startRadius <= EPSILON || Math.abs(startRadius - endRadius) > Math.max(1e-6, startRadius * 1e-6)) throw new KJValidationError(`${label} start and end must share one positive radius`);
            const startAngle = normalizedAngle(Math.atan2(segmentStart[1] - center[1], segmentStart[0] - center[0]));
            const endAngle = normalizedAngle(Math.atan2(end[1] - center[1], end[0] - center[0]));
            const sweep = normalizedAngle(clockwise ? startAngle - endAngle : endAngle - startAngle);
            if (sweep <= 1e-9) throw new KJValidationError(`${label} must have a nonzero partial sweep`);
            const sampleCount = Math.max(2, Math.ceil(sweep / (Math.PI / 18)));
            for(let sample = 1; sample < sampleCount; sample += 1){
                const angle = startAngle + (clockwise ? -1 : 1) * sweep * sample / sampleCount;
                if (!insideModelViewport([
                    center[0] + Math.cos(angle) * startRadius,
                    center[1] + Math.sin(angle) * startRadius
                ])) throw new KJValidationError(`${label} must remain inside the declared model viewport`);
            }
            return {
                kind: 'arc',
                center,
                end,
                clockwise,
                radius: startRadius,
                startAngle,
                endAngle
            };
        });
        const closes = Math.hypot(current[0] - start[0], current[1] - start[1]) <= 1e-6;
        if (closed !== closes) throw new KJValidationError(`input.roadPaths[${pathIndex}] closed flag must match its final endpoint`);
        return {
            id,
            start,
            segments,
            closed
        };
    });
    if (roadSegmentCount > 256) throw new KJValidationError('input.roadPaths expands to more than 256 road segments');
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
        coordinateCallouts,
        dimensions,
        buildingFootprints,
        roadPaths,
        roadSegmentCount,
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
    const center = [
        (minimum[0] + maximum[0]) / 2,
        (minimum[1] + maximum[1]) / 2
    ];
    const insideViewport = (value)=>value[0] >= center[0] - groundWidth / 2 - EPSILON && value[0] <= center[0] + groundWidth / 2 + EPSILON && value[1] >= center[1] - groundHeight / 2 - EPSILON && value[1] <= center[1] + groundHeight / 2 + EPSILON;
    const margin = Math.max((input.coordinateGrid?.spacing ?? 0) * 0.12, 4 * input.scale / 1000);
    if (width + margin * 2 > groundWidth + EPSILON || height + margin * 2 > groundHeight + EPSILON) throw new KJValidationError('input.boundary does not fit ISO A3 landscape at the declared scale');
    const gridXs = [], gridYs = [];
    if (input.coordinateGrid) {
        const firstGridX = input.coordinateGrid.origin[0] + Math.ceil((minimum[0] - input.coordinateGrid.origin[0]) / input.coordinateGrid.spacing) * input.coordinateGrid.spacing;
        const firstGridY = input.coordinateGrid.origin[1] + Math.ceil((minimum[1] - input.coordinateGrid.origin[1]) / input.coordinateGrid.spacing) * input.coordinateGrid.spacing;
        for(let value = firstGridX; value <= maximum[0] + EPSILON; value += input.coordinateGrid.spacing)gridXs.push(value);
        for(let value = firstGridY; value <= maximum[1] + EPSILON; value += input.coordinateGrid.spacing)gridYs.push(value);
    }
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
        BUILDINGS: {
            id: `${prefix}-layer-buildings`,
            color: 8,
            linetypeId: linetypes.continuous,
            lineweight: 25
        },
        ROADS: {
            id: `${prefix}-layer-roads`,
            color: 3,
            linetypeId: linetypes.continuous,
            lineweight: 25
        },
        GRID: {
            id: `${prefix}-layer-grid`,
            color: 8,
            linetypeId: linetypes.grid,
            lineweight: 13
        },
        COORDINATES: {
            id: `${prefix}-layer-coordinates`,
            color: 2,
            linetypeId: linetypes.continuous,
            lineweight: 18
        },
        DIMENSIONS: {
            id: `${prefix}-layer-dimensions`,
            color: 3,
            linetypeId: linetypes.continuous,
            lineweight: 18
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
    for (const footprint of input.buildingFootprints)add('LWPOLYLINE', 'BUILDINGS', {
        vertices: footprint.outline.map(p3),
        closed: true,
        semanticRole: 'building-footprint',
        sourceId: footprint.id,
        sourceBacked: true
    });
    for (const path of input.roadPaths){
        let current = path.start;
        path.segments.forEach((segment, segmentIndex)=>{
            if (segment.kind === 'line') add('LINE', 'ROADS', {
                start: p3(current),
                end: p3(segment.end),
                semanticRole: 'road-path-segment',
                segmentKind: 'line',
                segmentIndex,
                sourceId: path.id,
                sourceBacked: true
            });
            else add('ARC', 'ROADS', {
                center: p3(segment.center),
                radius: segment.radius,
                startAngle: segment.startAngle,
                endAngle: segment.endAngle,
                clockwise: segment.clockwise,
                semanticRole: 'road-path-segment',
                segmentKind: 'arc',
                segmentIndex,
                sourceId: path.id,
                sourceBacked: true
            });
            current = segment.end;
        });
    }
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
    for (const callout of input.coordinateCallouts){
        add('LINE', 'COORDINATES', {
            start: p3(callout.point),
            end: p3(callout.elbow),
            semanticRole: 'coordinate-callout-leader',
            segmentRole: 'point-to-elbow',
            sourceId: callout.id,
            sourceBacked: true
        });
        add('LINE', 'COORDINATES', {
            start: p3(callout.elbow),
            end: p3(callout.landingEnd),
            semanticRole: 'coordinate-callout-leader',
            segmentRole: 'elbow-to-landing',
            sourceId: callout.id,
            sourceBacked: true
        });
        addText(callout.xLabelPosition, `X=${callout.point[1].toFixed(callout.precision)}`, callout.textHeight, 'COORDINATES', 0, {
            semanticRole: 'coordinate-callout-label',
            coordinateAxis: 'X',
            coordinateValue: callout.point[1],
            coordinateConvention: 'X=northing',
            sourceId: callout.id,
            sourceBacked: true
        });
        addText(callout.yLabelPosition, `Y=${callout.point[0].toFixed(callout.precision)}`, callout.textHeight, 'COORDINATES', 0, {
            semanticRole: 'coordinate-callout-label',
            coordinateAxis: 'Y',
            coordinateValue: callout.point[0],
            coordinateConvention: 'Y=easting',
            sourceId: callout.id,
            sourceBacked: true
        });
    }
    for (const dimension of input.dimensions)add('DIMENSION', 'DIMENSIONS', {
        dimensionType: 'ALIGNED',
        definitionPoints: [
            dimension.dimensionLinePoint,
            dimension.firstExtensionOrigin,
            dimension.secondExtensionOrigin
        ].map(p3),
        textPosition: p3(dimension.textPosition),
        textOverride: `${dimension.displayValue.toFixed(dimension.precision)}${dimension.unitSuffix === 'none' ? '' : dimension.unitSuffix}`,
        textHeight,
        precision: dimension.precision,
        styleName: 'STANDARD',
        semanticRole: 'site-dimension',
        sourceId: dimension.id,
        sourceBacked: true
    });
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
    const sectionSegmentCounts = new Map();
    for (const section of input.sectionLines){
        const positions = section.holeIds.map((id)=>input.holesById.get(id).position);
        const start = positions[0], end = positions.at(-1);
        const angle = Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;
        let sectionSegmentCount = 1;
        if (section.markerClearance || section.endpointTailLengths?.some((value)=>value > 0)) {
            sectionSegmentCount = 0;
            const clearance = section.markerClearance ?? [
                0,
                0
            ];
            const tails = section.endpointTailLengths ?? [
                0,
                0
            ];
            const directions = [], distances = [];
            for(let index = 0; index < positions.length - 1; index += 1){
                const first = positions[index], second = positions[index + 1];
                const distance = Math.hypot(second[0] - first[0], second[1] - first[1]);
                if (distance <= EPSILON) throw new KJValidationError(`input.sectionLines ${section.id} contains coincident point positions`);
                directions.push([
                    (second[0] - first[0]) / distance,
                    (second[1] - first[1]) / distance
                ]);
                distances.push(distance);
            }
            const clearanceDistance = (direction)=>section.markerClearance ? Math.min(Math.abs(direction[0]) <= EPSILON ? Infinity : clearance[0] / Math.abs(direction[0]), Math.abs(direction[1]) <= EPSILON ? Infinity : clearance[1] / Math.abs(direction[1])) : 0;
            for(let index = 0; index < directions.length; index += 1){
                const direction = directions[index], firstDistance = clearanceDistance(direction), secondDistance = clearanceDistance(direction);
                if (firstDistance + secondDistance >= distances[index] - EPSILON) throw new KJValidationError(`input.sectionLines ${section.id} markerClearance leaves no visible segment between ${section.holeIds[index]} and ${section.holeIds[index + 1]}`);
                const first = positions[index], second = positions[index + 1];
                const vertices = [
                    [
                        first[0] + direction[0] * firstDistance,
                        first[1] + direction[1] * firstDistance
                    ],
                    [
                        second[0] - direction[0] * secondDistance,
                        second[1] - direction[1] * secondDistance
                    ]
                ];
                add('LWPOLYLINE', 'SECTIONS', {
                    vertices: vertices.map(p3),
                    closed: false,
                    semanticRole: 'section-line',
                    segmentRole: 'between-points',
                    segmentIndex: index,
                    sourceId: section.id,
                    referencedHoleIds: [
                        section.holeIds[index],
                        section.holeIds[index + 1]
                    ]
                });
                sectionSegmentCount += 1;
            }
            const startDirection = directions[0], endDirection = directions.at(-1);
            const startClearance = clearanceDistance(startDirection), endClearance = clearanceDistance(endDirection);
            if (tails[0] > 0) {
                const vertices = [
                    [
                        start[0] - startDirection[0] * (startClearance + tails[0]),
                        start[1] - startDirection[1] * (startClearance + tails[0])
                    ],
                    [
                        start[0] - startDirection[0] * startClearance,
                        start[1] - startDirection[1] * startClearance
                    ]
                ];
                if (!vertices.every(insideViewport)) throw new KJValidationError(`input.sectionLines ${section.id} start tail must lie inside the declared model viewport`);
                add('LWPOLYLINE', 'SECTIONS', {
                    vertices: vertices.map(p3),
                    closed: false,
                    semanticRole: 'section-line',
                    segmentRole: 'start-tail',
                    sourceId: section.id,
                    referencedHoleIds: [
                        section.holeIds[0]
                    ]
                });
                sectionSegmentCount += 1;
            }
            if (tails[1] > 0) {
                const vertices = [
                    [
                        end[0] + endDirection[0] * endClearance,
                        end[1] + endDirection[1] * endClearance
                    ],
                    [
                        end[0] + endDirection[0] * (endClearance + tails[1]),
                        end[1] + endDirection[1] * (endClearance + tails[1])
                    ]
                ];
                if (!vertices.every(insideViewport)) throw new KJValidationError(`input.sectionLines ${section.id} end tail must lie inside the declared model viewport`);
                add('LWPOLYLINE', 'SECTIONS', {
                    vertices: vertices.map(p3),
                    closed: false,
                    semanticRole: 'section-line',
                    segmentRole: 'end-tail',
                    sourceId: section.id,
                    referencedHoleIds: [
                        section.holeIds.at(-1)
                    ]
                });
                sectionSegmentCount += 1;
            }
        } else add('LWPOLYLINE', 'SECTIONS', {
            vertices: positions.map(p3),
            closed: false,
            semanticRole: 'section-line',
            sourceId: section.id,
            referencedHoleIds: section.holeIds
        });
        sectionSegmentCounts.set(section.id, sectionSegmentCount);
        const [startLabel, endLabel] = section.endpointLabels ?? [
            section.label,
            section.label
        ];
        const defaultLabelPositions = [
            [
                start[0],
                start[1] + textHeight * 1.35
            ],
            [
                end[0],
                end[1] + textHeight * 1.35
            ]
        ];
        const [startLabelPosition, endLabelPosition] = section.endpointLabelPositions ?? defaultLabelPositions;
        if (![
            startLabelPosition,
            endLabelPosition
        ].every(insideViewport)) throw new KJValidationError(`input.sectionLines ${section.id} endpointLabelPositions must lie inside the declared model viewport`);
        addText(startLabelPosition, startLabel, textHeight, 'SECTIONS', angle, {
            semanticRole: 'section-reference',
            sourceId: section.id,
            endpoint: 'start'
        });
        addText(endLabelPosition, endLabel, textHeight, 'SECTIONS', angle, {
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
            alignedDimensionCount: input.dimensions.length,
            buildingFootprintCount: input.buildingFootprints.length,
            roadPathCount: input.roadPaths.length,
            roadSegmentCount: input.roadSegmentCount,
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
                    ],
                    markerClearance: value.markerClearance ? [
                        ...value.markerClearance
                    ] : undefined,
                    endpointTailLengths: value.endpointTailLengths ? [
                        ...value.endpointTailLengths
                    ] : undefined,
                    endpointLabelPositions: value.endpointLabelPositions ? value.endpointLabelPositions.map((position)=>[
                            ...position
                        ]) : undefined,
                    segmentCount: sectionSegmentCounts.get(value.id)
                })),
            gridLineCount: gridXs.length + gridYs.length,
            coordinateCalloutCount: input.coordinateCallouts.length,
            coordinateConvention: 'engineering X=northing, Y=easting',
            coordinateBounds: {
                minimum,
                maximum
            },
            scaleDenominator: input.scale,
            northAngleDegrees: input.northAngleDegrees,
            externalBaseMapDependencies: input.roadPaths.length ? [
                'terrain',
                'landscaping',
                'other-context'
            ] : [
                'roads',
                'terrain',
                'landscaping',
                'other-context'
            ],
            limitations: [
                'Version 1.0.0 compiles one supplied boundary and one A3 landscape view',
                'Investigation-point coordinates, elevations, depths and section references are supplied facts and are never inferred',
                'Coordinate graphics are compiled only from an explicit grid or explicit point callouts; engineering X is northing and Y is easting, and label placement is never inferred',
                'Aligned dimensions are compiled only from supplied definition points, numeric display values and bounded unit suffixes; KJDraw does not infer measurements or arbitrary dimension text',
                'Building footprints are compiled only from supplied closed outlines and are never inferred',
                'Road paths are compiled only from supplied continuous line and arc facts; widths and centerlines are never inferred',
                'Unsupplied roads, terrain, landscaping and other base-map context remain external source-backed dependencies and are never inferred'
            ]
        }
    };
}
