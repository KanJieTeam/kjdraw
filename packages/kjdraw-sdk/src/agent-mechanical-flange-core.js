// Generated from agent-mechanical-flange-core.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { projectDimension } from './geometry/annotation.js';
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
        'dimensions',
        'leaders',
        'auxiliaryLines',
        'auxiliaryCurves',
        'symbols',
        'styleProfile',
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
        'squareHoles',
        'outlineSegments',
        'cuttingPlaneMarks'
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
    if (end.outlineSegments != null && !Array.isArray(end.outlineSegments)) throw new KJValidationError('input.endView.outlineSegments must be an array');
    if (end.outlineSegments?.length && end.outlineSegments.length > 128) throw new KJValidationError('input.endView.outlineSegments exceed their budget');
    const outlineSegments = (end.outlineSegments ?? []).map((value, index)=>{
        const segment = plain(value, `input.endView.outlineSegments[${index}]`);
        if (segment.kind === 'line') {
            exact(segment, [
                'kind',
                'startOffset',
                'endOffset'
            ], `input.endView.outlineSegments[${index}]`);
            const startOffset = point(segment.startOffset, `input.endView.outlineSegments[${index}].startOffset`);
            const endOffset = point(segment.endOffset, `input.endView.outlineSegments[${index}].endOffset`);
            if (startOffset[0] === endOffset[0] && startOffset[1] === endOffset[1]) throw new KJValidationError(`input.endView.outlineSegments[${index}] must not have zero length`);
            return {
                kind: 'line',
                startOffset,
                endOffset
            };
        }
        if (segment.kind === 'arc') {
            exact(segment, [
                'kind',
                'centerOffset',
                'radius',
                'startAngle',
                'endAngle'
            ], `input.endView.outlineSegments[${index}]`);
            const centerOffset = point(segment.centerOffset, `input.endView.outlineSegments[${index}].centerOffset`);
            const arcRadius = finite(segment.radius, `input.endView.outlineSegments[${index}].radius`, 0.1, 100_000);
            const startAngle = finite(segment.startAngle, `input.endView.outlineSegments[${index}].startAngle`, -Math.PI * 4, Math.PI * 4);
            const endAngle = finite(segment.endAngle, `input.endView.outlineSegments[${index}].endAngle`, -Math.PI * 4, Math.PI * 4);
            if (startAngle === endAngle) throw new KJValidationError(`input.endView.outlineSegments[${index}] arc sweep must not be zero`);
            return {
                kind: 'arc',
                centerOffset,
                radius: arcRadius,
                startAngle,
                endAngle
            };
        }
        if (segment.kind === 'circle') {
            exact(segment, [
                'kind',
                'centerOffset',
                'radius'
            ], `input.endView.outlineSegments[${index}]`);
            return {
                kind: 'circle',
                centerOffset: point(segment.centerOffset, `input.endView.outlineSegments[${index}].centerOffset`),
                radius: finite(segment.radius, `input.endView.outlineSegments[${index}].radius`, 0.1, 100_000)
            };
        }
        throw new KJValidationError(`input.endView.outlineSegments[${index}].kind is invalid`);
    });
    if (end.cuttingPlaneMarks != null && !Array.isArray(end.cuttingPlaneMarks)) throw new KJValidationError('input.endView.cuttingPlaneMarks must be an array');
    if (end.cuttingPlaneMarks?.length && end.cuttingPlaneMarks.length > 16) throw new KJValidationError('input.endView.cuttingPlaneMarks exceed their budget');
    const cuttingPlaneMarks = (end.cuttingPlaneMarks ?? []).map((value, index)=>{
        const mark = plain(value, `input.endView.cuttingPlaneMarks[${index}]`);
        exact(mark, [
            'anchorOffset',
            'stemVector',
            'tickVector',
            'arrowhead'
        ], `input.endView.cuttingPlaneMarks[${index}]`);
        const anchorOffset = point(mark.anchorOffset, `input.endView.cuttingPlaneMarks[${index}].anchorOffset`);
        const stemVector = point(mark.stemVector, `input.endView.cuttingPlaneMarks[${index}].stemVector`);
        const tickVector = point(mark.tickVector, `input.endView.cuttingPlaneMarks[${index}].tickVector`);
        if (stemVector[0] === 0 && stemVector[1] === 0 || tickVector[0] === 0 && tickVector[1] === 0) throw new KJValidationError(`input.endView.cuttingPlaneMarks[${index}] vectors must not have zero length`);
        const arrow = mark.arrowhead == null ? null : plain(mark.arrowhead, `input.endView.cuttingPlaneMarks[${index}].arrowhead`);
        if (arrow) exact(arrow, [
            'length',
            'width'
        ], `input.endView.cuttingPlaneMarks[${index}].arrowhead`);
        return {
            anchorOffset,
            stemVector,
            tickVector,
            ...arrow ? {
                arrowhead: {
                    length: finite(arrow.length, `input.endView.cuttingPlaneMarks[${index}].arrowhead.length`, 0.1, 100_000),
                    width: finite(arrow.width, `input.endView.cuttingPlaneMarks[${index}].arrowhead.width`, 0.1, 100_000)
                }
            } : {}
        };
    });
    const side = input.sideViewAxis == null ? null : plain(input.sideViewAxis, 'input.sideViewAxis');
    if (side) exact(side, [
        'xRange',
        'symmetricProfiles',
        'outlineSegments',
        'sectionHatches'
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
    if (side?.outlineSegments != null && !Array.isArray(side.outlineSegments)) throw new KJValidationError('input.sideViewAxis.outlineSegments must be an array');
    if (side?.outlineSegments?.length && side.outlineSegments.length > 128) throw new KJValidationError('input.sideViewAxis.outlineSegments exceed their budget');
    const sideOutlineSegments = (side?.outlineSegments ?? []).map((value, index)=>{
        const segment = plain(value, `input.sideViewAxis.outlineSegments[${index}]`);
        const stationOffset = (pointValue, label)=>{
            const value = plain(pointValue, label);
            exact(value, [
                'station',
                'offset'
            ], label);
            return {
                station: finite(value.station, `${label}.station`, xRange[0], xRange[1]),
                offset: finite(value.offset, `${label}.offset`, -100_000, 100_000)
            };
        };
        if (segment.kind === 'line') {
            exact(segment, [
                'kind',
                'start',
                'end'
            ], `input.sideViewAxis.outlineSegments[${index}]`);
            const start = stationOffset(segment.start, `input.sideViewAxis.outlineSegments[${index}].start`);
            const end = stationOffset(segment.end, `input.sideViewAxis.outlineSegments[${index}].end`);
            if (start.station === end.station && start.offset === end.offset) throw new KJValidationError(`input.sideViewAxis.outlineSegments[${index}] must not have zero length`);
            return {
                kind: 'line',
                start,
                end
            };
        }
        if (segment.kind === 'arc') {
            exact(segment, [
                'kind',
                'center',
                'radius',
                'startAngle',
                'endAngle'
            ], `input.sideViewAxis.outlineSegments[${index}]`);
            const arcCenter = stationOffset(segment.center, `input.sideViewAxis.outlineSegments[${index}].center`);
            const arcRadius = finite(segment.radius, `input.sideViewAxis.outlineSegments[${index}].radius`, 0.1, 100_000);
            const startAngle = finite(segment.startAngle, `input.sideViewAxis.outlineSegments[${index}].startAngle`, -Math.PI * 4, Math.PI * 4);
            const endAngle = finite(segment.endAngle, `input.sideViewAxis.outlineSegments[${index}].endAngle`, -Math.PI * 4, Math.PI * 4);
            if (startAngle === endAngle) throw new KJValidationError(`input.sideViewAxis.outlineSegments[${index}] arc sweep must not be zero`);
            return {
                kind: 'arc',
                center: arcCenter,
                radius: arcRadius,
                startAngle,
                endAngle
            };
        }
        if (segment.kind === 'circle') {
            exact(segment, [
                'kind',
                'center',
                'radius'
            ], `input.sideViewAxis.outlineSegments[${index}]`);
            return {
                kind: 'circle',
                center: stationOffset(segment.center, `input.sideViewAxis.outlineSegments[${index}].center`),
                radius: finite(segment.radius, `input.sideViewAxis.outlineSegments[${index}].radius`, 0.1, 100_000)
            };
        }
        throw new KJValidationError(`input.sideViewAxis.outlineSegments[${index}].kind is invalid`);
    });
    if (side?.sectionHatches != null && !Array.isArray(side.sectionHatches)) throw new KJValidationError('input.sideViewAxis.sectionHatches must be an array');
    if (side?.sectionHatches?.length && side.sectionHatches.length > 32) throw new KJValidationError('input.sideViewAxis.sectionHatches exceed their budget');
    const sectionHatches = (side?.sectionHatches ?? []).map((value, hatchIndex)=>{
        const label = `input.sideViewAxis.sectionHatches[${hatchIndex}]`, hatch = plain(value, label);
        exact(hatch, [
            'edges',
            'lineAngle',
            'lineSpacing',
            'patternOrigin'
        ], label);
        if (!Array.isArray(hatch.edges) || hatch.edges.length < 3 || hatch.edges.length > 128) throw new KJValidationError(`${label}.edges must contain 3 to 128 edges`);
        const localPoint = (value, label)=>{
            const coordinate = plain(value, label);
            exact(coordinate, [
                'station',
                'offset'
            ], label);
            return {
                station: finite(coordinate.station, `${label}.station`, xRange[0], xRange[1]),
                offset: finite(coordinate.offset, `${label}.offset`, -100_000, 100_000)
            };
        };
        const edges = hatch.edges.map((value, edgeIndex)=>{
            const labelEdge = `${label}.edges[${edgeIndex}]`, edge = plain(value, labelEdge);
            if (edge.kind === 'line') {
                exact(edge, [
                    'kind',
                    'start',
                    'end'
                ], labelEdge);
                const start = localPoint(edge.start, `${labelEdge}.start`), end = localPoint(edge.end, `${labelEdge}.end`);
                if (start.station === end.station && start.offset === end.offset) throw new KJValidationError(`${labelEdge} must not have zero length`);
                return {
                    kind: 'line',
                    start,
                    end
                };
            }
            if (edge.kind === 'arc') {
                exact(edge, [
                    'kind',
                    'center',
                    'radius',
                    'startAngle',
                    'endAngle',
                    'counterClockwise'
                ], labelEdge);
                if (edge.counterClockwise != null && typeof edge.counterClockwise !== 'boolean') throw new KJValidationError(`${labelEdge}.counterClockwise must be boolean`);
                const startAngle = finite(edge.startAngle, `${labelEdge}.startAngle`, -Math.PI * 4, Math.PI * 4);
                const endAngle = finite(edge.endAngle, `${labelEdge}.endAngle`, -Math.PI * 4, Math.PI * 4);
                if (startAngle === endAngle) throw new KJValidationError(`${labelEdge} arc sweep must not be zero`);
                return {
                    kind: 'arc',
                    center: localPoint(edge.center, `${labelEdge}.center`),
                    radius: finite(edge.radius, `${labelEdge}.radius`, 0.1, 100_000),
                    startAngle,
                    endAngle,
                    counterClockwise: edge.counterClockwise !== false
                };
            }
            throw new KJValidationError(`${labelEdge}.kind is invalid`);
        });
        const lineAngle = finite(hatch.lineAngle, `${label}.lineAngle`, -Math.PI * 2, Math.PI * 2);
        const lineSpacing = finite(hatch.lineSpacing, `${label}.lineSpacing`, 0.01, 100_000);
        const patternOrigin = hatch.patternOrigin == null ? [
            0,
            0
        ] : point(hatch.patternOrigin, `${label}.patternOrigin`);
        return {
            edges,
            lineAngle,
            lineSpacing,
            patternOrigin
        };
    });
    const sheet = plain(input.sheet, 'input.sheet');
    exact(sheet, [
        'origin',
        'size',
        'inset',
        'titleGrid',
        'notes'
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
        'horizontalSegments',
        'verticalSegments',
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
        const segments = (value, label, offsetMax, spanMax)=>{
            if (value != null && !Array.isArray(value)) throw new KJValidationError(`${label} must be an array`);
            if (value?.length && value.length > 64) throw new KJValidationError(`${label} exceed their budget`);
            return (value ?? []).map((segmentValue, index)=>{
                const entry = plain(segmentValue, `${label}[${index}]`);
                exact(entry, [
                    'offset',
                    'start',
                    'end'
                ], `${label}[${index}]`);
                const segment = {
                    offset: finite(entry.offset, `${label}[${index}].offset`, 0, offsetMax),
                    start: finite(entry.start, `${label}[${index}].start`, 0, spanMax),
                    end: finite(entry.end, `${label}[${index}].end`, 0, spanMax)
                };
                if (segment.start >= segment.end) throw new KJValidationError(`${label}[${index}] start must be less than end`);
                return segment;
            });
        };
        const horizontalSegments = segments(grid.horizontalSegments, 'input.sheet.titleGrid.horizontalSegments', size[1], size[0]);
        const verticalSegments = segments(grid.verticalSegments, 'input.sheet.titleGrid.verticalSegments', size[0], size[1]);
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
            horizontalSegments,
            verticalSegments,
            ...diagonal ? {
                diagonalHeader: {
                    width: finite(diagonal.width, 'input.sheet.titleGrid.diagonalHeader.width', 0, size[0]),
                    drop: finite(diagonal.drop, 'input.sheet.titleGrid.diagonalHeader.drop', 0, size[1])
                }
            } : {}
        };
    }
    if (sheet.notes != null && !Array.isArray(sheet.notes)) throw new KJValidationError('input.sheet.notes must be an array');
    if (sheet.notes?.length && sheet.notes.length > 128) throw new KJValidationError('input.sheet.notes exceed their budget');
    let noteCharacters = 0;
    const notes = (sheet.notes ?? []).map((value, index)=>{
        const note = plain(value, `input.sheet.notes[${index}]`);
        exact(note, [
            'kind',
            'text',
            'position',
            'height',
            'rotation',
            'width'
        ], `input.sheet.notes[${index}]`);
        if (note.kind !== 'single-line' && note.kind !== 'multiline') throw new KJValidationError(`input.sheet.notes[${index}].kind is invalid`);
        if (typeof note.text !== 'string' || !note.text || note.text.length > 512 || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(note.text)) throw new KJValidationError(`input.sheet.notes[${index}].text must be bounded visible text`);
        if (note.kind === 'single-line' && /[\r\n]/u.test(note.text)) throw new KJValidationError(`input.sheet.notes[${index}].text must stay on one line`);
        const text = note.kind === 'multiline' ? note.text.replace(/\r\n?|\n/gu, '\\P') : note.text;
        noteCharacters += text.length;
        if (noteCharacters > 8_192) throw new KJValidationError('input.sheet.notes exceed the text budget');
        const position = point(note.position, `input.sheet.notes[${index}].position`);
        if (position[0] < sheetOrigin[0] || position[0] > sheetOrigin[0] + sheetSize[0] || position[1] < sheetOrigin[1] || position[1] > sheetOrigin[1] + sheetSize[1]) throw new KJValidationError(`input.sheet.notes[${index}].position must lie on the sheet`);
        const height = finite(note.height, `input.sheet.notes[${index}].height`, 0.1, Math.min(...sheetSize) / 4);
        const rotation = note.rotation == null ? 0 : finite(note.rotation, `input.sheet.notes[${index}].rotation`, -Math.PI * 2, Math.PI * 2);
        const width = note.width == null ? undefined : finite(note.width, `input.sheet.notes[${index}].width`, 0.1, sheetSize[0]);
        if (note.kind === 'single-line' && width != null) throw new KJValidationError(`input.sheet.notes[${index}].width is only valid for multiline text`);
        return {
            kind: note.kind,
            text,
            position,
            height,
            rotation,
            ...width == null ? {} : {
                width
            }
        };
    });
    if (input.dimensions != null && !Array.isArray(input.dimensions)) throw new KJValidationError('input.dimensions must be an array');
    if (input.dimensions?.length && input.dimensions.length > 128) throw new KJValidationError('input.dimensions exceed their budget');
    const dimensions = (input.dimensions ?? []).map((value, index)=>{
        const dimension = plain(value, `input.dimensions[${index}]`);
        exact(dimension, [
            'kind',
            'definitionPoints',
            'textPosition',
            'textOverride',
            'rotation'
        ], `input.dimensions[${index}]`);
        if (![
            'aligned',
            'rotated',
            'diameter',
            'radius',
            'angular'
        ].includes(dimension.kind)) throw new KJValidationError(`input.dimensions[${index}].kind is invalid`);
        const requiredPoints = dimension.kind === 'angular' ? 5 : [
            'diameter',
            'radius'
        ].includes(dimension.kind) ? 2 : 3;
        if (!Array.isArray(dimension.definitionPoints) || dimension.definitionPoints.length !== requiredPoints) throw new KJValidationError(`input.dimensions[${index}].definitionPoints must contain ${requiredPoints} points`);
        const definitionPoints = dimension.definitionPoints.map((value, pointIndex)=>point(value, `input.dimensions[${index}].definitionPoints[${pointIndex}]`));
        const textPosition = dimension.textPosition == null ? undefined : point(dimension.textPosition, `input.dimensions[${index}].textPosition`);
        const textOverride = dimension.textOverride == null ? undefined : dimension.textOverride;
        if (textOverride != null && (typeof textOverride !== 'string' || textOverride.length > 128 || /[\r\n\u0000-\u001f\u007f]/u.test(textOverride))) throw new KJValidationError(`input.dimensions[${index}].textOverride must be bounded single-line text`);
        const rotation = dimension.rotation == null ? 0 : finite(dimension.rotation, `input.dimensions[${index}].rotation`, -Math.PI * 2, Math.PI * 2);
        const dimensionType = String(dimension.kind).toUpperCase();
        const payload = {
            dimensionType,
            definitionPoints: definitionPoints.map(([x, y])=>[
                    x,
                    y,
                    0
                ]),
            ...textPosition == null ? {} : {
                textPosition: [
                    ...textPosition,
                    0
                ]
            },
            textOverride: textOverride ?? null,
            rotation
        };
        if (!projectDimension(payload)) throw new KJValidationError(`input.dimensions[${index}] does not define a projectable native dimension`);
        return {
            kind: dimension.kind,
            definitionPoints,
            ...textPosition == null ? {} : {
                textPosition
            },
            ...textOverride == null ? {} : {
                textOverride
            },
            rotation
        };
    });
    if (input.leaders != null && !Array.isArray(input.leaders)) throw new KJValidationError('input.leaders must be an array');
    if (input.leaders?.length && input.leaders.length > 64) throw new KJValidationError('input.leaders exceed their budget');
    const leaders = (input.leaders ?? []).map((value, index)=>{
        const leader = plain(value, `input.leaders[${index}]`);
        exact(leader, [
            'vertices',
            'arrowEnabled',
            'pathType',
            'annotationType',
            'hookLineDirection',
            'hookLineEnabled'
        ], `input.leaders[${index}]`);
        if (!Array.isArray(leader.vertices) || leader.vertices.length < 2 || leader.vertices.length > 64) throw new KJValidationError(`input.leaders[${index}].vertices must contain 2 to 64 points`);
        const vertices = leader.vertices.map((value, pointIndex)=>point(value, `input.leaders[${index}].vertices[${pointIndex}]`));
        const integer = (value, label, max)=>value == null ? 0 : finite(value, label, 0, max);
        return {
            vertices,
            arrowEnabled: leader.arrowEnabled == null ? true : leader.arrowEnabled === true,
            pathType: integer(leader.pathType, `input.leaders[${index}].pathType`, 1),
            annotationType: integer(leader.annotationType, `input.leaders[${index}].annotationType`, 3),
            hookLineDirection: integer(leader.hookLineDirection, `input.leaders[${index}].hookLineDirection`, 1),
            hookLineEnabled: leader.hookLineEnabled === true
        };
    });
    if (input.auxiliaryLines != null && !Array.isArray(input.auxiliaryLines)) throw new KJValidationError('input.auxiliaryLines must be an array');
    if (input.auxiliaryLines?.length && input.auxiliaryLines.length > 256) throw new KJValidationError('input.auxiliaryLines exceed their budget');
    const auxiliaryLines = (input.auxiliaryLines ?? []).map((value, index)=>{
        const label = `input.auxiliaryLines[${index}]`, line = plain(value, label);
        exact(line, [
            'start',
            'end',
            'role'
        ], label);
        if (![
            'geometry',
            'center',
            'hidden',
            'notes',
            'grid',
            'frame'
        ].includes(line.role)) throw new KJValidationError(`${label}.role is invalid`);
        const start = point(line.start, `${label}.start`), end = point(line.end, `${label}.end`);
        if (start[0] === end[0] && start[1] === end[1]) throw new KJValidationError(`${label} must not have zero length`);
        return {
            start,
            end,
            role: line.role
        };
    });
    if (input.auxiliaryCurves != null && !Array.isArray(input.auxiliaryCurves)) throw new KJValidationError('input.auxiliaryCurves must be an array');
    if (input.auxiliaryCurves?.length && input.auxiliaryCurves.length > 128) throw new KJValidationError('input.auxiliaryCurves exceed their budget');
    const auxiliaryCurves = (input.auxiliaryCurves ?? []).map((value, index)=>{
        const label = `input.auxiliaryCurves[${index}]`, curve = plain(value, label);
        if (![
            'geometry',
            'center',
            'hidden',
            'notes',
            'grid',
            'frame'
        ].includes(curve.role)) throw new KJValidationError(`${label}.role is invalid`);
        const role = curve.role;
        if (curve.kind === 'arc') {
            exact(curve, [
                'kind',
                'center',
                'radius',
                'startAngle',
                'endAngle',
                'clockwise',
                'role'
            ], label);
            const startAngle = finite(curve.startAngle, `${label}.startAngle`, -Math.PI * 4, Math.PI * 4), endAngle = finite(curve.endAngle, `${label}.endAngle`, -Math.PI * 4, Math.PI * 4);
            if (startAngle === endAngle) throw new KJValidationError(`${label} arc sweep must not be zero`);
            if (curve.clockwise != null && typeof curve.clockwise !== 'boolean') throw new KJValidationError(`${label}.clockwise must be boolean`);
            return {
                kind: 'arc',
                center: point(curve.center, `${label}.center`),
                radius: finite(curve.radius, `${label}.radius`, 0.1, 100_000),
                startAngle,
                endAngle,
                clockwise: curve.clockwise === true,
                role
            };
        }
        if (curve.kind === 'ellipse') {
            exact(curve, [
                'kind',
                'center',
                'majorAxis',
                'ratio',
                'startParameter',
                'endParameter',
                'role'
            ], label);
            const majorAxis = point(curve.majorAxis, `${label}.majorAxis`);
            if (Math.hypot(...majorAxis) <= 1e-12) throw new KJValidationError(`${label}.majorAxis must not be zero`);
            return {
                kind: 'ellipse',
                center: point(curve.center, `${label}.center`),
                majorAxis,
                ratio: finite(curve.ratio, `${label}.ratio`, 1e-9, 1),
                startParameter: finite(curve.startParameter, `${label}.startParameter`, -Math.PI * 4, Math.PI * 4),
                endParameter: finite(curve.endParameter, `${label}.endParameter`, -Math.PI * 4, Math.PI * 4),
                role
            };
        }
        if (curve.kind === 'polyline') {
            exact(curve, [
                'kind',
                'vertices',
                'closed',
                'role'
            ], label);
            if (!Array.isArray(curve.vertices) || curve.vertices.length < 2 || curve.vertices.length > 4096) throw new KJValidationError(`${label}.vertices must contain 2 to 4096 points`);
            const vertices = curve.vertices.map((value, vertexIndex)=>{
                const vertexLabel = `${label}.vertices[${vertexIndex}]`, vertex = plain(value, vertexLabel);
                exact(vertex, [
                    'point',
                    'bulge',
                    'startWidth',
                    'endWidth'
                ], vertexLabel);
                return {
                    point: point(vertex.point, `${vertexLabel}.point`),
                    bulge: finite(vertex.bulge ?? 0, `${vertexLabel}.bulge`, -1e6, 1e6),
                    startWidth: finite(vertex.startWidth ?? 0, `${vertexLabel}.startWidth`, 0, 1e6),
                    endWidth: finite(vertex.endWidth ?? 0, `${vertexLabel}.endWidth`, 0, 1e6)
                };
            });
            return {
                kind: 'polyline',
                vertices,
                closed: curve.closed === true,
                role
            };
        }
        if (curve.kind === 'spline') {
            exact(curve, [
                'kind',
                'degree',
                'controlPoints',
                'knots',
                'fitPoints',
                'weights',
                'closed',
                'periodic',
                'role'
            ], label);
            const degree = finite(curve.degree, `${label}.degree`, 1, 10);
            if (!Number.isInteger(degree)) throw new KJValidationError(`${label}.degree must be an integer`);
            if (!Array.isArray(curve.controlPoints) || curve.controlPoints.length < degree + 1 || curve.controlPoints.length > 4096) throw new KJValidationError(`${label}.controlPoints are invalid`);
            const controlPoints = curve.controlPoints.map((value, pointIndex)=>point(value, `${label}.controlPoints[${pointIndex}]`));
            if (!Array.isArray(curve.knots) || curve.knots.length !== controlPoints.length + degree + 1) throw new KJValidationError(`${label}.knots length is invalid`);
            const knots = curve.knots.map((value, knotIndex)=>finite(value, `${label}.knots[${knotIndex}]`, -1e12, 1e12));
            if (knots.some((value, knotIndex)=>knotIndex > 0 && value < knots[knotIndex - 1])) throw new KJValidationError(`${label}.knots must not decrease`);
            const fitPoints = curve.fitPoints == null ? [] : Array.isArray(curve.fitPoints) ? curve.fitPoints.map((value, pointIndex)=>point(value, `${label}.fitPoints[${pointIndex}]`)) : (()=>{
                throw new KJValidationError(`${label}.fitPoints must be an array`);
            })();
            const weights = curve.weights == null ? [] : Array.isArray(curve.weights) ? curve.weights.map((value, weightIndex)=>finite(value, `${label}.weights[${weightIndex}]`, 1e-12, 1e12)) : (()=>{
                throw new KJValidationError(`${label}.weights must be an array`);
            })();
            if (weights.length && weights.length !== controlPoints.length) throw new KJValidationError(`${label}.weights length is invalid`);
            return {
                kind: 'spline',
                degree,
                controlPoints,
                knots,
                fitPoints,
                weights,
                closed: curve.closed === true,
                periodic: curve.periodic === true,
                role
            };
        }
        throw new KJValidationError(`${label}.kind is invalid`);
    });
    const symbolSource = input.symbols == null ? {
        definitions: [],
        instances: []
    } : plain(input.symbols, 'input.symbols');
    exact(symbolSource, [
        'definitions',
        'instances'
    ], 'input.symbols');
    if (!Array.isArray(symbolSource.definitions) || symbolSource.definitions.length > 16) throw new KJValidationError('input.symbols.definitions must contain at most 16 items');
    if (!Array.isArray(symbolSource.instances) || symbolSource.instances.length > 64) throw new KJValidationError('input.symbols.instances must contain at most 64 items');
    const symbolKeys = new Set();
    let symbolMemberCount = 0, symbolTextCharacters = 0;
    const symbolRole = (value, label)=>{
        if (![
            'geometry',
            'center',
            'hidden',
            'notes',
            'grid',
            'frame'
        ].includes(value)) throw new KJValidationError(`${label} is invalid`);
        return value;
    };
    const symbolDefinitions = symbolSource.definitions.map((value, index)=>{
        const label = `input.symbols.definitions[${index}]`, definition = plain(value, label);
        exact(definition, [
            'key',
            'basePoint',
            'members'
        ], label);
        if (typeof definition.key !== 'string' || !definition.key.trim() || definition.key !== definition.key.trim() || definition.key.length > 96 || /[\u0000-\u001f\u007f]/u.test(definition.key)) throw new KJValidationError(`${label}.key must be bounded printable text`);
        if (symbolKeys.has(definition.key)) throw new KJValidationError(`${label}.key must be unique`);
        symbolKeys.add(definition.key);
        if (!Array.isArray(definition.members) || !definition.members.length || definition.members.length > 64) throw new KJValidationError(`${label}.members must contain 1 to 64 items`);
        symbolMemberCount += definition.members.length;
        if (symbolMemberCount > 512) throw new KJValidationError('input.symbols exceed the member budget');
        const members = definition.members.map((memberValue, memberIndex)=>{
            const memberLabel = `${label}.members[${memberIndex}]`, member = plain(memberValue, memberLabel), role = symbolRole(member.role, `${memberLabel}.role`);
            if (member.kind === 'line') {
                exact(member, [
                    'kind',
                    'start',
                    'end',
                    'role'
                ], memberLabel);
                const start = point(member.start, `${memberLabel}.start`), end = point(member.end, `${memberLabel}.end`);
                if (start[0] === end[0] && start[1] === end[1]) throw new KJValidationError(`${memberLabel} must not have zero length`);
                return {
                    kind: 'line',
                    start,
                    end,
                    role
                };
            }
            if (member.kind === 'circle') {
                exact(member, [
                    'kind',
                    'center',
                    'radius',
                    'role'
                ], memberLabel);
                return {
                    kind: 'circle',
                    center: point(member.center, `${memberLabel}.center`),
                    radius: finite(member.radius, `${memberLabel}.radius`, 0.000_001, 100_000),
                    role
                };
            }
            if (member.kind === 'arc') {
                exact(member, [
                    'kind',
                    'center',
                    'radius',
                    'startAngle',
                    'endAngle',
                    'clockwise',
                    'role'
                ], memberLabel);
                const startAngle = finite(member.startAngle, `${memberLabel}.startAngle`, -Math.PI * 4, Math.PI * 4), endAngle = finite(member.endAngle, `${memberLabel}.endAngle`, -Math.PI * 4, Math.PI * 4);
                if (startAngle === endAngle) throw new KJValidationError(`${memberLabel} arc sweep must not be zero`);
                if (member.clockwise != null && typeof member.clockwise !== 'boolean') throw new KJValidationError(`${memberLabel}.clockwise must be boolean`);
                return {
                    kind: 'arc',
                    center: point(member.center, `${memberLabel}.center`),
                    radius: finite(member.radius, `${memberLabel}.radius`, 0.000_001, 100_000),
                    startAngle,
                    endAngle,
                    clockwise: member.clockwise === true,
                    role
                };
            }
            if (member.kind === 'multiline-text') {
                exact(member, [
                    'kind',
                    'text',
                    'position',
                    'height',
                    'rotation',
                    'width',
                    'attachmentPoint',
                    'role'
                ], memberLabel);
                if (typeof member.text !== 'string' || !member.text || member.text.length > 512 || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(member.text)) throw new KJValidationError(`${memberLabel}.text must be bounded visible text`);
                symbolTextCharacters += member.text.length;
                if (symbolTextCharacters > 8_192) throw new KJValidationError('input.symbols exceed the text budget');
                const attachmentPoint = member.attachmentPoint == null ? 1 : finite(member.attachmentPoint, `${memberLabel}.attachmentPoint`, 1, 9);
                if (!Number.isInteger(attachmentPoint)) throw new KJValidationError(`${memberLabel}.attachmentPoint must be an integer`);
                return {
                    kind: 'multiline-text',
                    text: member.text,
                    position: point(member.position, `${memberLabel}.position`),
                    height: finite(member.height, `${memberLabel}.height`, 0.000_001, 100_000),
                    rotation: member.rotation == null ? 0 : finite(member.rotation, `${memberLabel}.rotation`, -Math.PI * 4, Math.PI * 4),
                    ...member.width == null ? {} : {
                        width: finite(member.width, `${memberLabel}.width`, 0.000_001, 1_000_000)
                    },
                    attachmentPoint,
                    role
                };
            }
            throw new KJValidationError(`${memberLabel}.kind is invalid`);
        });
        return {
            key: definition.key,
            basePoint: point(definition.basePoint, `${label}.basePoint`),
            members
        };
    });
    const symbolInstances = symbolSource.instances.map((value, index)=>{
        const label = `input.symbols.instances[${index}]`, instance = plain(value, label);
        exact(instance, [
            'symbolKey',
            'position',
            'scale',
            'rotation',
            'role'
        ], label);
        if (typeof instance.symbolKey !== 'string' || !symbolKeys.has(instance.symbolKey)) throw new KJValidationError(`${label}.symbolKey must reference a definition`);
        const scaleSource = instance.scale ?? [
            1,
            1
        ];
        if (!Array.isArray(scaleSource) || scaleSource.length !== 2) throw new KJValidationError(`${label}.scale must contain two coordinates`);
        const scale = [
            finite(scaleSource[0], `${label}.scale[0]`, 0.000_001, 1_000_000),
            finite(scaleSource[1], `${label}.scale[1]`, 0.000_001, 1_000_000)
        ];
        return {
            symbolKey: instance.symbolKey,
            position: point(instance.position, `${label}.position`),
            scale,
            rotation: instance.rotation == null ? 0 : finite(instance.rotation, `${label}.rotation`, -Math.PI * 4, Math.PI * 4),
            role: symbolRole(instance.role, `${label}.role`)
        };
    });
    const styleProfile = input.styleProfile == null ? {} : plain(input.styleProfile, 'input.styleProfile');
    if (styleProfile) exact(styleProfile, [
        'frame',
        'grid',
        'geometry',
        'center',
        'notes',
        'dimensions',
        'hatch',
        'hidden'
    ], 'input.styleProfile');
    const styleRole = (value, label)=>{
        if (value == null) return {};
        const role = plain(value, label);
        exact(role, [
            'layerName',
            'color',
            'lineweight',
            'linetypeName',
            'linetypePattern'
        ], label);
        if (role.layerName != null && (typeof role.layerName !== 'string' || !/^[^\u0000-\u001f\u007f]{1,64}$/u.test(role.layerName))) throw new KJValidationError(`${label}.layerName must be bounded printable text`);
        if (role.linetypeName != null && (typeof role.linetypeName !== 'string' || !/^[^\u0000-\u001f\u007f]{1,64}$/u.test(role.linetypeName))) throw new KJValidationError(`${label}.linetypeName must be bounded printable text`);
        const color = role.color == null ? undefined : finite(role.color, `${label}.color`, 1, 255);
        if (color != null && !Number.isInteger(color)) throw new KJValidationError(`${label}.color must be an integer ACI color`);
        const lineweight = role.lineweight == null ? undefined : finite(role.lineweight, `${label}.lineweight`, -3, 211);
        const supportedLineweights = new Set([
            -3,
            -2,
            -1,
            0,
            5,
            9,
            13,
            15,
            18,
            20,
            25,
            30,
            35,
            40,
            50,
            53,
            60,
            70,
            80,
            90,
            100,
            106,
            120,
            140,
            158,
            200,
            211
        ]);
        if (lineweight != null && !supportedLineweights.has(lineweight)) throw new KJValidationError(`${label}.lineweight is not a supported CAD lineweight`);
        if (role.linetypePattern != null && (!Array.isArray(role.linetypePattern) || role.linetypePattern.length > 32 || role.linetypePattern.length % 2 !== 0 || role.linetypePattern.some((item, index)=>typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 1_000 || index % 2 === 0 && item <= 0 || index % 2 === 1 && item >= 0))) throw new KJValidationError(`${label}.linetypePattern is invalid`);
        return {
            ...role.layerName == null ? {} : {
                layerName: role.layerName
            },
            ...color == null ? {} : {
                color
            },
            ...lineweight == null ? {} : {
                lineweight
            },
            ...role.linetypeName == null ? {} : {
                linetypeName: role.linetypeName
            },
            ...role.linetypePattern == null ? {} : {
                linetypePattern: [
                    ...role.linetypePattern
                ]
            }
        };
    };
    const styles = {};
    for (const role of [
        'frame',
        'grid',
        'geometry',
        'center',
        'notes',
        'dimensions',
        'hatch',
        'hidden'
    ])styles[role] = styleRole(styleProfile[role], `input.styleProfile.${role}`);
    return {
        expectedRevision,
        drawingId: input.drawingId.trim(),
        center,
        ringRadii,
        pitch,
        radius,
        outlineSegments,
        cuttingPlaneMarks,
        sideOutlineSegments,
        xRange,
        symmetricProfiles,
        sectionHatches,
        dimensions,
        leaders,
        auxiliaryLines,
        auxiliaryCurves,
        symbolDefinitions,
        symbolInstances,
        styles,
        sheetOrigin,
        sheetSize,
        inset,
        titleGrid,
        notes
    };
}
export function buildAgentMechanicalFlangeCore(document, source) {
    const input = validate(document, source), prefix = `flange-${stableHash({
        id: input.drawingId,
        version: KJDRAW_MECHANICAL_FLANGE_CORE_VERSION
    }).slice(0, 12)}`;
    const role = (name, defaults)=>({
            ...defaults,
            ...input.styles[name] ?? {},
            pattern: input.styles[name]?.linetypePattern ?? defaults.pattern
        });
    const roles = {
        frame: role('frame', {
            layerName: 'FLANGE_FRAME',
            color: 7,
            lineweight: 25,
            pattern: []
        }),
        grid: role('grid', {
            layerName: 'FLANGE_GRID',
            color: 7,
            lineweight: 18,
            pattern: []
        }),
        geometry: role('geometry', {
            layerName: 'FLANGE_GEOMETRY',
            color: 7,
            lineweight: 35,
            pattern: []
        }),
        center: role('center', {
            layerName: 'FLANGE_CENTER',
            color: 7,
            lineweight: 18,
            pattern: [
                8,
                -1,
                1,
                -1
            ]
        }),
        notes: role('notes', {
            layerName: 'FLANGE_NOTES',
            color: 7,
            lineweight: 18,
            pattern: []
        }),
        dimensions: role('dimensions', {
            layerName: 'FLANGE_DIMENSIONS',
            color: 2,
            lineweight: 18,
            pattern: []
        }),
        hatch: role('hatch', {
            layerName: 'FLANGE_HATCH',
            color: 7,
            lineweight: 18,
            pattern: []
        }),
        hidden: role('hidden', {
            layerName: 'FLANGE_HIDDEN',
            color: 8,
            lineweight: 18,
            pattern: [
                3,
                -1
            ]
        })
    };
    const roleIds = {}, layers = [], layerByName = new Map();
    const linetypeIds = {}, linetypes = [], linetypeByKey = new Map();
    for (const name of Object.keys(roles)){
        const definition = roles[name], key = JSON.stringify([
            definition.linetypeName ?? `FLANGE_${String(name).toUpperCase()}`,
            definition.pattern
        ]);
        const linetypeName = definition.linetypeName ?? `FLANGE_${String(name).toUpperCase()}`;
        let id = linetypeByKey.get(key) ?? document.getTable?.('linetypes')?.records.find((record)=>String(record.name).toUpperCase() === linetypeName.toUpperCase())?.id;
        if (!id) {
            id = `${prefix}-${name}-linetype`;
            linetypes.push({
                id,
                name: linetypeName,
                pattern: definition.pattern
            });
        }
        linetypeByKey.set(key, id);
        linetypeIds[name] = id;
        const layerName = definition.layerName, existingLayer = document.getTable?.('layers')?.records.find((record)=>String(record.name).toUpperCase() === layerName.toUpperCase()), pendingLayer = layerByName.get(layerName.toUpperCase());
        roleIds[name] = existingLayer?.id ?? pendingLayer ?? `${prefix}-${name}`;
        if (!existingLayer && !pendingLayer) {
            layerByName.set(layerName.toUpperCase(), roleIds[name]);
            layers.push({
                id: roleIds[name],
                name: layerName,
                color: definition.color,
                linetypeId: id,
                lineweight: definition.lineweight
            });
        }
    }
    const entities = [], p3 = (x, y)=>[
            x,
            y,
            0
        ];
    const roleByLayer = new Map(Object.keys(roles).map((name)=>[
            roleIds[name],
            roles[name]
        ]));
    const stylePayload = (payload, styleName)=>{
        const style = styleName == null ? roleByLayer.get(payload.layerId) : roles[styleName];
        return style == null ? payload : {
            ...payload,
            color: style.color,
            lineweight: style.lineweight,
            ...style.linetypeName == null ? {} : {
                linetypeName: style.linetypeName
            }
        };
    };
    const emit = (type, payload, styleName)=>{
        entities.push({
            type,
            payload: stylePayload(payload, styleName),
            options: {
                id: `${prefix}-${String(entities.length + 1).padStart(4, '0')}`
            }
        });
    };
    const line = (a, b, layerId = roleIds.grid, styleName = 'grid')=>emit('LINE', {
            start: p3(...a),
            end: p3(...b),
            layerId
        }, styleName);
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
        layerId: roleIds.geometry
    }, 'geometry');
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
        layerId: roleIds.geometry
    }, 'geometry');
    for (const segment of input.outlineSegments){
        if (segment.kind === 'line') line([
            cx + segment.startOffset[0],
            cy + segment.startOffset[1]
        ], [
            cx + segment.endOffset[0],
            cy + segment.endOffset[1]
        ], roleIds.geometry, 'geometry');
        else if (segment.kind === 'arc') emit('ARC', {
            center: p3(cx + segment.centerOffset[0], cy + segment.centerOffset[1]),
            radius: segment.radius,
            startAngle: segment.startAngle,
            endAngle: segment.endAngle,
            layerId: roleIds.geometry
        }, 'geometry');
        else emit('CIRCLE', {
            center: p3(cx + segment.centerOffset[0], cy + segment.centerOffset[1]),
            radius: segment.radius,
            layerId: roleIds.geometry
        }, 'geometry');
    }
    for (const mark of input.cuttingPlaneMarks){
        const anchor = [
            cx + mark.anchorOffset[0],
            cy + mark.anchorOffset[1]
        ];
        line(anchor, [
            anchor[0] + mark.stemVector[0],
            anchor[1] + mark.stemVector[1]
        ], roleIds.notes, 'notes');
        line(anchor, [
            anchor[0] + mark.tickVector[0],
            anchor[1] + mark.tickVector[1]
        ], roleIds.notes, 'notes');
        if (mark.arrowhead) {
            const tip = [
                anchor[0] + mark.tickVector[0],
                anchor[1] + mark.tickVector[1]
            ], norm = Math.hypot(mark.tickVector[0], mark.tickVector[1]);
            const unit = [
                mark.tickVector[0] / norm,
                mark.tickVector[1] / norm
            ], perpendicular = [
                -unit[1],
                unit[0]
            ];
            const base = [
                tip[0] - unit[0] * mark.arrowhead.length,
                tip[1] - unit[1] * mark.arrowhead.length
            ];
            const half = mark.arrowhead.width / 2;
            const a = [
                base[0] + perpendicular[0] * half,
                base[1] + perpendicular[1] * half
            ];
            const b = [
                base[0] - perpendicular[0] * half,
                base[1] - perpendicular[1] * half
            ];
            emit('SOLID', {
                vertices: [
                    p3(...tip),
                    p3(...a),
                    p3(...b),
                    p3(...b)
                ],
                layerId: roleIds.notes
            }, 'notes');
        }
    }
    const frameLine = (a, b)=>line(a, b, roleIds.frame, 'frame');
    const frameRectangle = (origin, size)=>{
        const [x, y] = origin, [w, h] = size;
        frameLine([
            x,
            y
        ], [
            x + w,
            y
        ]);
        frameLine([
            x + w,
            y
        ], [
            x + w,
            y + h
        ]);
        frameLine([
            x + w,
            y + h
        ], [
            x,
            y + h
        ]);
        frameLine([
            x,
            y + h
        ], [
            x,
            y
        ]);
    };
    frameRectangle(input.sheetOrigin, input.sheetSize);
    frameRectangle([
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
        ], roleIds.grid);
        for (const offset of grid.columns)line([
            x + offset,
            y
        ], [
            x + offset,
            y + h
        ], roleIds.grid);
        for (const column of grid.partialColumns ?? [])line([
            x + column.offset,
            y
        ], [
            x + column.offset,
            y + column.height
        ], roleIds.grid);
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
            ], roleIds.grid);
        }
        for (const segment of grid.horizontalSegments ?? [])line([
            x + segment.start,
            y + segment.offset
        ], [
            x + segment.end,
            y + segment.offset
        ], roleIds.grid);
        for (const segment of grid.verticalSegments ?? [])line([
            x + segment.offset,
            y + segment.start
        ], [
            x + segment.offset,
            y + segment.end
        ], roleIds.grid);
        if (grid.diagonalHeader) line([
            x,
            y + h
        ], [
            x + grid.diagonalHeader.width,
            y + h - grid.diagonalHeader.drop
        ], roleIds.grid);
    }
    if (input.xRange) line([
        input.xRange[0],
        cy
    ], [
        input.xRange[1],
        cy
    ], roleIds.center, 'center');
    for (const profile of input.symmetricProfiles){
        for(let index = 1; index < profile.vertices.length; index++){
            const previous = profile.vertices[index - 1], current = profile.vertices[index];
            line([
                previous.station,
                cy + previous.radius
            ], [
                current.station,
                cy + current.radius
            ], roleIds.geometry, 'geometry');
            line([
                previous.station,
                cy - previous.radius
            ], [
                current.station,
                cy - current.radius
            ], roleIds.geometry, 'geometry');
        }
        const start = profile.vertices[0], end = profile.vertices.at(-1);
        if (profile.endCaps === 'start' || profile.endCaps === 'both') line([
            start.station,
            cy - start.radius
        ], [
            start.station,
            cy + start.radius
        ], roleIds.geometry, 'geometry');
        if (profile.endCaps === 'end' || profile.endCaps === 'both') line([
            end.station,
            cy - end.radius
        ], [
            end.station,
            cy + end.radius
        ], roleIds.geometry, 'geometry');
    }
    for (const segment of input.sideOutlineSegments){
        if (segment.kind === 'line') line([
            segment.start.station,
            cy + segment.start.offset
        ], [
            segment.end.station,
            cy + segment.end.offset
        ], roleIds.geometry, 'geometry');
        else if (segment.kind === 'arc') emit('ARC', {
            center: p3(segment.center.station, cy + segment.center.offset),
            radius: segment.radius,
            startAngle: segment.startAngle,
            endAngle: segment.endAngle,
            layerId: roleIds.geometry
        }, 'geometry');
        else emit('CIRCLE', {
            center: p3(segment.center.station, cy + segment.center.offset),
            radius: segment.radius,
            layerId: roleIds.geometry
        }, 'geometry');
    }
    for (const hatch of input.sectionHatches)emit('HATCH', {
        boundaryLoops: [
            {
                external: false,
                flags: 0,
                edges: hatch.edges.map((edge)=>edge.kind === 'line' ? {
                        type: 'LINE',
                        start: p3(edge.start.station, cy + edge.start.offset),
                        end: p3(edge.end.station, cy + edge.end.offset)
                    } : {
                        type: 'ARC',
                        center: p3(edge.center.station, cy + edge.center.offset),
                        radius: edge.radius,
                        startAngle: edge.startAngle,
                        endAngle: edge.endAngle,
                        counterClockwise: edge.counterClockwise !== false
                    })
            }
        ],
        patternName: 'ANSI31',
        solid: false,
        associative: false,
        patternAngle: 0,
        patternScale: 1,
        patternLines: [
            {
                angle: hatch.lineAngle,
                base: hatch.patternOrigin,
                offset: [
                    -Math.sin(hatch.lineAngle) * hatch.lineSpacing,
                    Math.cos(hatch.lineAngle) * hatch.lineSpacing
                ],
                dashes: []
            }
        ],
        patternDefinitionAngle: 0,
        patternDefinitionScale: 1,
        layerId: roleIds.hatch
    }, 'hatch');
    for (const auxiliary of input.auxiliaryLines)line(auxiliary.start, auxiliary.end, roleIds[auxiliary.role], auxiliary.role);
    for (const curve of input.auxiliaryCurves){
        if (curve.kind === 'arc') emit('ARC', {
            center: p3(...curve.center),
            radius: curve.radius,
            startAngle: curve.startAngle,
            endAngle: curve.endAngle,
            clockwise: curve.clockwise === true,
            layerId: roleIds[curve.role]
        }, curve.role);
        else if (curve.kind === 'ellipse') emit('ELLIPSE', {
            center: p3(...curve.center),
            majorAxis: p3(...curve.majorAxis),
            ratio: curve.ratio,
            startParameter: curve.startParameter,
            endParameter: curve.endParameter,
            layerId: roleIds[curve.role]
        }, curve.role);
        else if (curve.kind === 'polyline') emit('LWPOLYLINE', {
            vertices: curve.vertices.map((vertex)=>({
                    ...vertex,
                    point: p3(...vertex.point)
                })),
            closed: curve.closed === true,
            elevation: 0,
            layerId: roleIds[curve.role]
        }, curve.role);
        else emit('SPLINE', {
            degree: curve.degree,
            controlPoints: curve.controlPoints.map((value)=>p3(...value)),
            knots: curve.knots,
            ...curve.fitPoints?.length ? {
                fitPoints: curve.fitPoints.map((value)=>p3(...value))
            } : {},
            ...curve.weights?.length ? {
                weights: curve.weights
            } : {},
            closed: curve.closed === true,
            periodic: curve.periodic === true,
            layerId: roleIds[curve.role]
        }, curve.role);
    }
    const symbolBlockByKey = new Map();
    const blocks = input.symbolDefinitions.map((definition, definitionIndex)=>{
        const token = stableHash({
            basePoint: definition.basePoint,
            members: definition.members
        }).slice(0, 12);
        const id = `${prefix}-symbol-${String(definitionIndex + 1).padStart(2, '0')}-${token}`;
        symbolBlockByKey.set(definition.key, {
            id
        });
        const members = definition.members.map((member, memberIndex)=>{
            let type, payload;
            if (member.kind === 'line') {
                type = 'LINE';
                payload = {
                    start: p3(...member.start),
                    end: p3(...member.end),
                    layerId: roleIds[member.role]
                };
            } else if (member.kind === 'circle') {
                type = 'CIRCLE';
                payload = {
                    center: p3(...member.center),
                    radius: member.radius,
                    layerId: roleIds[member.role]
                };
            } else if (member.kind === 'arc') {
                type = 'ARC';
                payload = {
                    center: p3(...member.center),
                    radius: member.radius,
                    startAngle: member.startAngle,
                    endAngle: member.endAngle,
                    clockwise: member.clockwise === true,
                    layerId: roleIds[member.role]
                };
            } else {
                type = 'MTEXT';
                payload = {
                    position: p3(...member.position),
                    text: member.text,
                    height: member.height,
                    rotation: member.rotation ?? 0,
                    attachmentPoint: member.attachmentPoint ?? 1,
                    ...member.width == null ? {} : {
                        width: member.width
                    },
                    layerId: roleIds[member.role]
                };
            }
            return {
                type,
                payload: stylePayload(payload, member.role),
                options: {
                    id: `${id}-member-${String(memberIndex + 1).padStart(2, '0')}`
                }
            };
        });
        return {
            id,
            name: `KJ_FLANGE_SYMBOL_${String(definitionIndex + 1).padStart(2, '0')}_${token.toUpperCase()}`,
            basePoint: p3(...definition.basePoint),
            entities: members
        };
    });
    for (const instance of input.symbolInstances){
        const block = symbolBlockByKey.get(instance.symbolKey);
        emit('INSERT', {
            blockRecordId: block.id,
            position: p3(...instance.position),
            scale: [
                instance.scale?.[0] ?? 1,
                instance.scale?.[1] ?? 1,
                1
            ],
            rotation: instance.rotation ?? 0,
            attributes: {},
            attributeIds: [],
            sequenceEndId: null,
            layerId: roleIds[instance.role]
        }, instance.role);
    }
    for (const note of input.notes)emit(note.kind === 'single-line' ? 'TEXT' : 'MTEXT', {
        position: p3(...note.position),
        text: note.text,
        height: note.height,
        rotation: note.rotation,
        ...note.width == null ? {} : {
            width: note.width
        },
        layerId: roleIds.notes
    }, 'notes');
    for (const dimension of input.dimensions)emit('DIMENSION', {
        dimensionType: dimension.kind.toUpperCase(),
        definitionPoints: dimension.definitionPoints.map(([x, y])=>p3(x, y)),
        ...dimension.textPosition == null ? {} : {
            textPosition: p3(...dimension.textPosition)
        },
        textOverride: dimension.textOverride ?? null,
        rotation: dimension.rotation ?? 0,
        styleName: 'STANDARD',
        layerId: roleIds.dimensions
    }, 'dimensions');
    for (const leader of input.leaders)emit('LEADER', {
        vertices: leader.vertices.map(([x, y])=>p3(x, y)),
        annotationId: null,
        ownsAnnotation: false,
        arrowEnabled: leader.arrowEnabled !== false,
        pathType: leader.pathType ?? 0,
        annotationType: leader.annotationType ?? 3,
        hookLineDirection: leader.hookLineDirection ?? 0,
        hookLineEnabled: leader.hookLineEnabled === true,
        layerId: roleIds.notes
    }, 'notes');
    return {
        commandArgs: {
            entities,
            resources: {
                linetypes,
                layers,
                ...blocks.length ? {
                    blocks
                } : {}
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
                outlineSegmentCount: input.outlineSegments.length,
                cuttingPlaneMarkCount: input.cuttingPlaneMarks.length,
                symmetricProfileCount: input.symmetricProfiles.length,
                sideOutlineSegmentCount: input.sideOutlineSegments.length,
                sectionHatchCount: input.sectionHatches.length,
                auxiliaryLineCount: input.auxiliaryLines.length,
                auxiliaryCurveCount: input.auxiliaryCurves.length,
                symbolDefinitionCount: input.symbolDefinitions.length,
                symbolInstanceCount: input.symbolInstances.length,
                noteCount: input.notes.length,
                dimensionCount: input.dimensions.length,
                leaderCount: input.leaders.length
            },
            limitations: [
                'Flange end-view, symmetric axial-profile, cut-face hatches, native dimension and sheet-grid core only',
                'Local symbols do not generate attributes or nested blocks',
                'Private drawings and labels are not embedded'
            ]
        }
    };
}
