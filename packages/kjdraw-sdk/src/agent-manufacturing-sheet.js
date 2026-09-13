// Generated from agent-manufacturing-sheet.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { stableHash } from './utils.js';
export const KJDRAW_MANUFACTURING_SHEET_VERSION = '1.0.0';
const INPUT_KEYS = [
    'version',
    'expectedRevision',
    'units',
    'drawingId',
    'title',
    'revision',
    'material',
    'quantity',
    'length',
    'width',
    'thickness',
    'holePatterns',
    'slots',
    'sheet',
    'textHeight'
];
const HOLE_KEYS = [
    'rows',
    'columns',
    'origin',
    'spacing',
    'throughDiameter',
    'counterboreDiameter',
    'counterboreDepth'
];
const SLOT_KEYS = [
    'center',
    'length',
    'width',
    'orientationDegrees'
];
const SHEET_KEYS = [
    'origin',
    'size'
];
const MAX_ENTITY_COUNT = 512;
function plain(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KJValidationError(`${label} must be an object`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new KJValidationError(`${label} must be a plain object`);
    return value;
}
function exactKeys(value, allowed, label) {
    const unknown = Object.keys(value).filter((key)=>!allowed.includes(key));
    if (unknown.length) throw new KJValidationError(`${label} contains unsupported field: ${unknown[0]}`);
}
function boundedString(value, label, maximum) {
    if (typeof value !== 'string') throw new KJValidationError(`${label} must be a string`);
    const result = value.trim();
    if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new KJValidationError(`${label} must contain 1-${maximum} printable characters`);
    return result;
}
function boundedNumber(value, label, minimum, maximum) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new KJValidationError(`${label} must be a finite number from ${minimum} to ${maximum}`);
    }
    return value;
}
function boundedInteger(value, label, minimum, maximum) {
    const result = boundedNumber(value, label, minimum, maximum);
    if (!Number.isInteger(result)) throw new KJValidationError(`${label} must be an integer`);
    return result;
}
function point2(value, label, minimum = -1_000_000, maximum = 1_000_000) {
    if (!Array.isArray(value) || value.length !== 2) throw new KJValidationError(`${label} must contain exactly two coordinates`);
    return [
        boundedNumber(value[0], `${label}[0]`, minimum, maximum),
        boundedNumber(value[1], `${label}[1]`, minimum, maximum)
    ];
}
function formatMillimeters(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
function validateInput(document, source) {
    if (!document || typeof document.id !== 'string' || !Number.isInteger(document.revision) || typeof document.snapshot !== 'function') {
        throw new KJValidationError('Manufacturing sheet compiler requires a KJDraw document');
    }
    const input = plain(source, 'input');
    exactKeys(input, INPUT_KEYS, 'input');
    if (input.version !== KJDRAW_MANUFACTURING_SHEET_VERSION) throw new KJValidationError(`input.version must be ${KJDRAW_MANUFACTURING_SHEET_VERSION}`);
    if (input.units !== 'millimeter') throw new KJValidationError('input.units must be millimeter');
    const expectedRevision = boundedInteger(input.expectedRevision, 'input.expectedRevision', 0, Number.MAX_SAFE_INTEGER);
    if (expectedRevision !== document.revision) throw new KJValidationError(`input.expectedRevision ${expectedRevision} does not match document revision ${document.revision}`);
    if (document.snapshot()?.header?.units !== 'millimeter') throw new KJValidationError('Manufacturing sheet compiler requires a millimeter document');
    const length = boundedNumber(input.length, 'input.length', 0.01, 100_000);
    const width = boundedNumber(input.width, 'input.width', 0.01, 100_000);
    const thickness = boundedNumber(input.thickness, 'input.thickness', 0.01, 10_000);
    const textHeight = boundedNumber(input.textHeight, 'input.textHeight', 1, 20);
    const sheetSource = plain(input.sheet, 'input.sheet');
    exactKeys(sheetSource, SHEET_KEYS, 'input.sheet');
    const sheetOrigin = point2(sheetSource.origin, 'input.sheet.origin');
    const sheetSize = point2(sheetSource.size, 'input.sheet.size', 80, 2_000);
    if (sheetSize[0] < textHeight * 20 || sheetSize[1] < textHeight * 16) throw new KJValidationError('input.sheet.size is too small for the selected textHeight');
    const holeSource = input.holePatterns ?? [];
    if (!Array.isArray(holeSource) || holeSource.length > 32) throw new KJValidationError('input.holePatterns must contain at most 32 patterns');
    let holeCount = 0;
    const holePatterns = holeSource.map((source, index)=>{
        const hole = plain(source, `input.holePatterns[${index}]`);
        exactKeys(hole, HOLE_KEYS, `input.holePatterns[${index}]`);
        const rows = boundedInteger(hole.rows, `input.holePatterns[${index}].rows`, 1, 64);
        const columns = boundedInteger(hole.columns, `input.holePatterns[${index}].columns`, 1, 64);
        holeCount += rows * columns;
        if (holeCount > 128) throw new KJValidationError('input.holePatterns expands to more than 128 holes');
        const origin = point2(hole.origin, `input.holePatterns[${index}].origin`, 0, 100_000);
        const spacing = point2(hole.spacing, `input.holePatterns[${index}].spacing`, 0, 100_000);
        if (columns > 1 && spacing[0] <= 0) throw new KJValidationError(`input.holePatterns[${index}].spacing[0] must be positive for multiple columns`);
        if (rows > 1 && spacing[1] <= 0) throw new KJValidationError(`input.holePatterns[${index}].spacing[1] must be positive for multiple rows`);
        const throughDiameter = boundedNumber(hole.throughDiameter, `input.holePatterns[${index}].throughDiameter`, 0.01, Math.min(length, width));
        const hasCounterboreDiameter = hole.counterboreDiameter != null;
        const hasCounterboreDepth = hole.counterboreDepth != null;
        if (hasCounterboreDiameter !== hasCounterboreDepth) throw new KJValidationError(`input.holePatterns[${index}] counterboreDiameter and counterboreDepth must be supplied together`);
        const counterboreDiameter = hasCounterboreDiameter ? boundedNumber(hole.counterboreDiameter, `input.holePatterns[${index}].counterboreDiameter`, throughDiameter, Math.min(length, width)) : undefined;
        if (counterboreDiameter != null && counterboreDiameter <= throughDiameter) throw new KJValidationError(`input.holePatterns[${index}].counterboreDiameter must exceed throughDiameter`);
        const counterboreDepth = hasCounterboreDepth ? boundedNumber(hole.counterboreDepth, `input.holePatterns[${index}].counterboreDepth`, 0.01, thickness) : undefined;
        if (counterboreDepth != null && counterboreDepth >= thickness) throw new KJValidationError(`input.holePatterns[${index}].counterboreDepth must be less than thickness`);
        const featureRadius = (counterboreDiameter ?? throughDiameter) / 2;
        const lastX = origin[0] + (columns - 1) * spacing[0];
        const lastY = origin[1] + (rows - 1) * spacing[1];
        if (origin[0] - featureRadius < 0 || origin[1] - featureRadius < 0 || lastX + featureRadius > length || lastY + featureRadius > width) {
            throw new KJValidationError(`input.holePatterns[${index}] lies outside the plate`);
        }
        return {
            rows,
            columns,
            origin,
            spacing,
            throughDiameter,
            counterboreDiameter,
            counterboreDepth
        };
    });
    const slotSource = input.slots ?? [];
    if (!Array.isArray(slotSource) || slotSource.length > 64) throw new KJValidationError('input.slots must contain at most 64 slots');
    const slots = slotSource.map((source, index)=>{
        const slot = plain(source, `input.slots[${index}]`);
        exactKeys(slot, SLOT_KEYS, `input.slots[${index}]`);
        const center = point2(slot.center, `input.slots[${index}].center`, 0, 100_000);
        const slotLength = boundedNumber(slot.length, `input.slots[${index}].length`, 0.01, Math.max(length, width));
        const slotWidth = boundedNumber(slot.width, `input.slots[${index}].width`, 0.01, slotLength);
        if (slotLength <= slotWidth) throw new KJValidationError(`input.slots[${index}].length must exceed width`);
        if (slot.orientationDegrees !== 0 && slot.orientationDegrees !== 90) throw new KJValidationError(`input.slots[${index}].orientationDegrees must be 0 or 90`);
        const xRadius = slot.orientationDegrees === 0 ? slotLength / 2 : slotWidth / 2;
        const yRadius = slot.orientationDegrees === 0 ? slotWidth / 2 : slotLength / 2;
        if (center[0] - xRadius < 0 || center[0] + xRadius > length || center[1] - yRadius < 0 || center[1] + yRadius > width) {
            throw new KJValidationError(`input.slots[${index}] lies outside the plate`);
        }
        return {
            center,
            length: slotLength,
            width: slotWidth,
            orientationDegrees: slot.orientationDegrees
        };
    });
    return {
        version: input.version,
        expectedRevision,
        units: input.units,
        drawingId: boundedString(input.drawingId, 'input.drawingId', 96),
        title: boundedString(input.title, 'input.title', 160),
        revision: boundedString(input.revision, 'input.revision', 32),
        material: boundedString(input.material, 'input.material', 96),
        quantity: boundedInteger(input.quantity, 'input.quantity', 1, 1_000_000),
        length,
        width,
        thickness,
        holePatterns,
        slots,
        sheet: {
            origin: sheetOrigin,
            size: sheetSize
        },
        textHeight
    };
}
function boundsForEntities(entities) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const accept = (value)=>{
        if (!Array.isArray(value) || value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) return;
        minX = Math.min(minX, value[0]);
        minY = Math.min(minY, value[1]);
        maxX = Math.max(maxX, value[0]);
        maxY = Math.max(maxY, value[1]);
    };
    for (const entity of entities){
        const payload = entity.payload;
        for (const key of [
            'start',
            'end',
            'center',
            'position',
            'textPosition'
        ])accept(payload[key]);
        for (const point of payload.definitionPoints ?? [])accept(point);
        for (const vertex of payload.vertices ?? [])accept(vertex?.point ?? vertex);
        if (entity.type === 'CIRCLE' && Array.isArray(payload.center)) {
            minX = Math.min(minX, payload.center[0] - payload.radius);
            minY = Math.min(minY, payload.center[1] - payload.radius);
            maxX = Math.max(maxX, payload.center[0] + payload.radius);
            maxY = Math.max(maxY, payload.center[1] + payload.radius);
        }
    }
    return {
        min: [
            minX,
            minY
        ],
        max: [
            maxX,
            maxY
        ],
        width: maxX - minX,
        height: maxY - minY
    };
}
export function buildAgentManufacturingSheet(document, source) {
    const input = validateInput(document, source);
    const [sheetX, sheetY] = input.sheet.origin, [sheetWidth, sheetHeight] = input.sheet.size;
    const margin = Math.max(8, input.textHeight * 2);
    const titleHeight = Math.max(36, input.textHeight * 9);
    const dimensionPad = Math.max(10, input.textHeight * 4);
    const gap = Math.max(12, input.textHeight * 5);
    const drawingWidth = sheetWidth - margin * 2;
    const drawingHeight = sheetHeight - margin * 2 - titleHeight;
    const viewWidth = drawingWidth - dimensionPad;
    const viewHeight = drawingHeight - gap - dimensionPad * 1.5;
    if (viewWidth <= 0 || viewHeight <= 0) throw new KJValidationError('input.sheet.size leaves no room for manufacturing views');
    const scale = Math.min(1, viewWidth / input.length, viewHeight / (input.width + input.thickness));
    if (!Number.isFinite(scale) || scale <= 0) throw new KJValidationError('Unable to fit manufacturing views on the sheet');
    if (scale < 1 - 1e-12) throw new KJValidationError('Manufacturing views must fit the selected sheet at 1:1 model-space scale');
    const frontX = sheetX + margin + dimensionPad + (viewWidth - input.length * scale) / 2;
    const frontY = sheetY + margin + titleHeight + input.textHeight * 2;
    const topX = frontX;
    const topY = frontY + input.thickness * scale + gap;
    const idPrefix = `mfg-${stableHash({
        drawingId: input.drawingId,
        version: input.version
    }).slice(0, 12)}`;
    const entities = [];
    const linetypeIds = {
        continuous: `${idPrefix}-lt-continuous`,
        center: `${idPrefix}-lt-center`,
        hidden: `${idPrefix}-lt-hidden`
    };
    const layerDefinitions = {
        OUTLINE: {
            id: `${idPrefix}-layer-object`,
            color: 7,
            linetypeId: linetypeIds.continuous,
            lineweight: 35
        },
        CENTER: {
            id: `${idPrefix}-layer-center`,
            color: 3,
            linetypeId: linetypeIds.center,
            lineweight: 18
        },
        HIDDEN: {
            id: `${idPrefix}-layer-hidden`,
            color: 8,
            linetypeId: linetypeIds.hidden,
            lineweight: 18
        },
        DIMENSIONS: {
            id: `${idPrefix}-layer-dim`,
            color: 2,
            linetypeId: linetypeIds.continuous,
            lineweight: 18
        },
        SHEET: {
            id: `${idPrefix}-layer-frame`,
            color: 7,
            linetypeId: linetypeIds.continuous,
            lineweight: 25
        },
        NOTES: {
            id: `${idPrefix}-layer-text`,
            color: 7,
            linetypeId: linetypeIds.continuous,
            lineweight: 18
        }
    };
    const add = (type, layerName, payload)=>{
        const id = `${idPrefix}-${String(entities.length + 1).padStart(4, '0')}`;
        entities.push({
            type,
            payload: {
                ...payload,
                layerId: layerDefinitions[layerName].id
            },
            options: {
                id
            }
        });
    };
    const p3 = (x, y)=>[
            x,
            y,
            0
        ];
    const rectangle = (x, y, width, height, layer)=>add('LWPOLYLINE', layer, {
            vertices: [
                p3(x, y),
                p3(x + width, y),
                p3(x + width, y + height),
                p3(x, y + height)
            ],
            closed: true
        });
    const line = (x1, y1, x2, y2, layer)=>add('LINE', layer, {
            start: p3(x1, y1),
            end: p3(x2, y2)
        });
    const arc = (x, y, radius, startAngle, endAngle, layer)=>add('ARC', layer, {
            center: p3(x, y),
            radius,
            startAngle,
            endAngle,
            clockwise: false
        });
    const text = (x, y, value, height = input.textHeight)=>add('TEXT', 'NOTES', {
            position: p3(x, y),
            text: value,
            height
        });
    const dimension = (definitionPoints, textPosition, dimensionType = 'ALIGNED')=>add('DIMENSION', 'DIMENSIONS', {
            dimensionType,
            definitionPoints: dimensionType === 'ALIGNED' ? [
                textPosition,
                ...definitionPoints
            ] : definitionPoints,
            textPosition,
            textOverride: null,
            styleName: 'STANDARD'
        });
    rectangle(sheetX, sheetY, sheetWidth, sheetHeight, 'SHEET');
    rectangle(topX, topY, input.length * scale, input.width * scale, 'OUTLINE');
    rectangle(frontX, frontY, input.length * scale, input.thickness * scale, 'OUTLINE');
    text(topX, topY + input.width * scale + input.textHeight * 1.4, 'TOP VIEW');
    text(frontX, frontY + input.thickness * scale + input.textHeight * 1.4, 'FRONT VIEW');
    line(topX - input.textHeight, topY + input.width * scale / 2, topX + input.length * scale + input.textHeight, topY + input.width * scale / 2, 'CENTER');
    line(topX + input.length * scale / 2, topY - input.textHeight, topX + input.length * scale / 2, topY + input.width * scale + input.textHeight, 'CENTER');
    line(frontX - input.textHeight, frontY + input.thickness * scale / 2, frontX + input.length * scale + input.textHeight, frontY + input.thickness * scale / 2, 'CENTER');
    dimension([
        p3(topX, topY),
        p3(topX + input.length, topY)
    ], p3(topX + input.length / 2, topY - dimensionPad / 2));
    dimension([
        p3(topX, topY),
        p3(topX, topY + input.width)
    ], p3(topX - dimensionPad / 2, topY + input.width / 2));
    dimension([
        p3(frontX, frontY),
        p3(frontX, frontY + input.thickness)
    ], p3(frontX - dimensionPad / 2, frontY + input.thickness / 2));
    input.holePatterns.forEach((pattern, patternIndex)=>{
        let firstCenter = null;
        const projectedColumns = new Set();
        for(let row = 0; row < pattern.rows; row += 1)for(let column = 0; column < pattern.columns; column += 1){
            const plateX = pattern.origin[0] + column * pattern.spacing[0];
            const x = topX + plateX * scale;
            const y = topY + (pattern.origin[1] + row * pattern.spacing[1]) * scale;
            const center = p3(x, y);
            firstCenter ??= center;
            add('CIRCLE', 'OUTLINE', {
                center,
                radius: pattern.throughDiameter * scale / 2
            });
            if (pattern.counterboreDiameter != null) add('CIRCLE', 'OUTLINE', {
                center,
                radius: pattern.counterboreDiameter * scale / 2
            });
            const centerSize = Math.max(input.textHeight, pattern.throughDiameter * scale * 0.75);
            line(x - centerSize, y, x + centerSize, y, 'CENTER');
            line(x, y - centerSize, x, y + centerSize, 'CENTER');
            const projectionKey = formatMillimeters(plateX);
            if (!projectedColumns.has(projectionKey)) {
                projectedColumns.add(projectionKey);
                const projectedX = frontX + plateX * scale;
                const throughRadius = pattern.throughDiameter * scale / 2;
                const throughTop = frontY + (input.thickness - (pattern.counterboreDepth ?? 0)) * scale;
                line(projectedX - throughRadius, frontY, projectedX - throughRadius, throughTop, 'HIDDEN');
                line(projectedX + throughRadius, frontY, projectedX + throughRadius, throughTop, 'HIDDEN');
                line(projectedX, frontY - input.textHeight, projectedX, frontY + input.thickness * scale + input.textHeight, 'CENTER');
                if (pattern.counterboreDiameter != null && pattern.counterboreDepth != null) {
                    const counterboreRadius = pattern.counterboreDiameter * scale / 2;
                    const counterboreBottom = frontY + (input.thickness - pattern.counterboreDepth) * scale;
                    line(projectedX - counterboreRadius, counterboreBottom, projectedX - counterboreRadius, frontY + input.thickness * scale, 'HIDDEN');
                    line(projectedX + counterboreRadius, counterboreBottom, projectedX + counterboreRadius, frontY + input.thickness * scale, 'HIDDEN');
                    line(projectedX - counterboreRadius, counterboreBottom, projectedX - throughRadius, counterboreBottom, 'HIDDEN');
                    line(projectedX + throughRadius, counterboreBottom, projectedX + counterboreRadius, counterboreBottom, 'HIDDEN');
                }
            }
        }
        if (firstCenter) {
            const diameterText = pattern.counterboreDiameter == null ? `${pattern.rows * pattern.columns}X DIA ${formatMillimeters(pattern.throughDiameter)} THRU` : `${pattern.rows * pattern.columns}X DIA ${formatMillimeters(pattern.throughDiameter)} THRU / C'BORE DIA ${formatMillimeters(pattern.counterboreDiameter)} DEPTH ${formatMillimeters(pattern.counterboreDepth)}`;
            const radius = pattern.throughDiameter / 2;
            dimension([
                p3(firstCenter[0] - radius, firstCenter[1]),
                p3(firstCenter[0] + radius, firstCenter[1])
            ], p3(firstCenter[0] + dimensionPad, firstCenter[1] + dimensionPad / 2), 'DIAMETER');
            text(firstCenter[0] + dimensionPad, firstCenter[1] + dimensionPad, diameterText);
            if (pattern.columns > 1) {
                dimension([
                    p3(topX + pattern.origin[0], topY + pattern.origin[1]),
                    p3(topX + pattern.origin[0] + pattern.spacing[0], topY + pattern.origin[1])
                ], p3(topX + pattern.origin[0] + pattern.spacing[0] / 2, topY + pattern.origin[1] - dimensionPad / 2));
                text(topX + pattern.origin[0], topY + pattern.origin[1] - dimensionPad, `${pattern.columns - 1} SPACES @ ${formatMillimeters(pattern.spacing[0])}`);
            }
            if (pattern.rows > 1) {
                dimension([
                    p3(topX + pattern.origin[0], topY + pattern.origin[1]),
                    p3(topX + pattern.origin[0], topY + pattern.origin[1] + pattern.spacing[1])
                ], p3(topX + pattern.origin[0] - dimensionPad / 2, topY + pattern.origin[1] + pattern.spacing[1] / 2));
                text(topX + pattern.origin[0] + input.textHeight, topY + pattern.origin[1] + pattern.spacing[1] / 2, `${pattern.rows - 1} SPACES @ ${formatMillimeters(pattern.spacing[1])}`);
            }
        }
    });
    input.slots.forEach((slot, index)=>{
        const cx = topX + slot.center[0] * scale, cy = topY + slot.center[1] * scale;
        const halfStraight = (slot.length - slot.width) * scale / 2, radius = slot.width * scale / 2;
        const halfLength = slot.length * scale / 2;
        if (slot.orientationDegrees === 0) {
            line(cx - halfStraight, cy + radius, cx + halfStraight, cy + radius, 'OUTLINE');
            line(cx + halfStraight, cy - radius, cx - halfStraight, cy - radius, 'OUTLINE');
            arc(cx + halfStraight, cy, radius, 1.5 * Math.PI, 0.5 * Math.PI, 'OUTLINE');
            arc(cx - halfStraight, cy, radius, 0.5 * Math.PI, 1.5 * Math.PI, 'OUTLINE');
            line(cx - halfLength - input.textHeight, cy, cx + halfLength + input.textHeight, cy, 'CENTER');
            line(cx, cy - radius - input.textHeight, cx, cy + radius + input.textHeight, 'CENTER');
            dimension([
                p3(cx - halfLength, cy),
                p3(cx + halfLength, cy)
            ], p3(cx, cy + radius + dimensionPad / 2));
        } else {
            line(cx - radius, cy - halfStraight, cx - radius, cy + halfStraight, 'OUTLINE');
            line(cx + radius, cy + halfStraight, cx + radius, cy - halfStraight, 'OUTLINE');
            arc(cx, cy + halfStraight, radius, 0, Math.PI, 'OUTLINE');
            arc(cx, cy - halfStraight, radius, Math.PI, 2 * Math.PI, 'OUTLINE');
            line(cx, cy - halfLength - input.textHeight, cx, cy + halfLength + input.textHeight, 'CENTER');
            line(cx - radius - input.textHeight, cy, cx + radius + input.textHeight, cy, 'CENTER');
            dimension([
                p3(cx, cy - halfLength),
                p3(cx, cy + halfLength)
            ], p3(cx + radius + dimensionPad / 2, cy));
        }
        const projectedHalfWidth = slot.orientationDegrees === 0 ? halfLength : radius;
        line(frontX + slot.center[0] - projectedHalfWidth, frontY, frontX + slot.center[0] - projectedHalfWidth, frontY + input.thickness, 'HIDDEN');
        line(frontX + slot.center[0] + projectedHalfWidth, frontY, frontX + slot.center[0] + projectedHalfWidth, frontY + input.thickness, 'HIDDEN');
        text(cx + radius + input.textHeight, cy + radius + input.textHeight, `S${index + 1} SLOT ${formatMillimeters(slot.length)} X ${formatMillimeters(slot.width)}`);
    });
    const titleY = sheetY + margin;
    const titleX = sheetX + margin;
    const titleWidth = sheetWidth - margin * 2;
    rectangle(titleX, titleY, titleWidth, titleHeight, 'SHEET');
    const titleSplit = titleX + titleWidth * 0.62;
    line(titleSplit, titleY, titleSplit, titleY + titleHeight, 'SHEET');
    line(titleSplit, titleY + titleHeight / 2, titleX + titleWidth, titleY + titleHeight / 2, 'SHEET');
    text(titleX + input.textHeight, titleY + titleHeight - input.textHeight * 2, input.title, input.textHeight * 1.25);
    text(titleX + input.textHeight, titleY + titleHeight - input.textHeight * 4, `DRAWING: ${input.drawingId}`);
    text(titleX + input.textHeight, titleY + titleHeight - input.textHeight * 6, `MATERIAL: ${input.material}   QTY: ${input.quantity}`);
    text(titleSplit + input.textHeight, titleY + titleHeight - input.textHeight * 2, `REV: ${input.revision}`);
    text(titleSplit + input.textHeight, titleY + titleHeight / 2 - input.textHeight * 2, `UNITS: mm   SCALE: 1:${formatMillimeters(1 / scale)}`);
    const notes = [
        'MACHINING NOTES:',
        '1. ALL DIMENSIONS ARE IN MILLIMETERS.',
        '2. REMOVE BURRS AND BREAK SHARP EDGES.',
        '3. DO NOT SCALE DRAWING; USE NATIVE DIMENSIONS.'
    ];
    const notesX = sheetX + margin;
    const notesTop = sheetY + sheetHeight - margin - input.textHeight;
    notes.forEach((note, index)=>text(notesX, notesTop - index * input.textHeight * 1.5, note));
    if (entities.length > MAX_ENTITY_COUNT) throw new KJValidationError(`Manufacturing sheet expands to ${entities.length} entities; maximum is ${MAX_ENTITY_COUNT}`);
    const bounds = boundsForEntities(entities);
    const sheetBounds = {
        min: [
            sheetX,
            sheetY
        ],
        max: [
            sheetX + sheetWidth,
            sheetY + sheetHeight
        ]
    };
    const epsilon = 1e-7;
    if (bounds.min[0] < sheetBounds.min[0] - epsilon || bounds.min[1] < sheetBounds.min[1] - epsilon || bounds.max[0] > sheetBounds.max[0] + epsilon || bounds.max[1] > sheetBounds.max[1] + epsilon) {
        throw new KJValidationError('Generated manufacturing annotations exceed the sheet bounds');
    }
    const resources = {
        linetypes: [
            {
                id: linetypeIds.continuous,
                name: `KJ_${idPrefix.slice(4, 16)}_CONT`,
                pattern: []
            },
            {
                id: linetypeIds.center,
                name: `KJ_${idPrefix.slice(4, 16)}_CENTER`,
                pattern: [
                    8,
                    -1,
                    1,
                    -1
                ]
            },
            {
                id: linetypeIds.hidden,
                name: `KJ_${idPrefix.slice(4, 16)}_HIDDEN`,
                pattern: [
                    3,
                    -1
                ]
            }
        ],
        layers: Object.entries(layerDefinitions).map(([name, definition])=>({
                name,
                ...definition
            }))
    };
    return {
        commandArgs: {
            entities,
            resources
        },
        evidence: {
            drawingId: input.drawingId,
            skillId: 'manufacturing-sheet',
            skillVersion: KJDRAW_MANUFACTURING_SHEET_VERSION,
            units: input.units,
            expectedRevision: input.expectedRevision,
            entityCount: entities.length,
            bounds,
            parameters: {
                title: input.title,
                revision: input.revision,
                material: input.material,
                quantity: input.quantity,
                length: input.length,
                width: input.width,
                thickness: input.thickness,
                holePatternCount: input.holePatterns.length,
                holeCount: input.holePatterns.reduce((total, pattern)=>total + pattern.rows * pattern.columns, 0),
                slotCount: input.slots.length,
                sheet: input.sheet,
                textHeight: input.textHeight,
                viewScale: scale
            },
            limitations: [
                'Rectangular hole arrays only',
                'Slot orientations are limited to 0 or 90 degrees',
                'Views are orthographic and may be scaled to fit the selected sheet'
            ]
        }
    };
}
