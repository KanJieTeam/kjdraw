// Generated from agent-drawing-patterns.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { normalizeSplineDefinition } from './geometry/curves.js';
const ENTITY_LIMIT = 4096;
const POINT_LIMIT = 262144;
const COORDINATE_LIMIT = 1e12;
const reject = (message)=>{
    throw new KJValidationError(message);
};
const coordinate = (value)=>typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT;
const same = (a, b)=>a[0] === b[0] && a[1] === b[1];
function keys(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) reject('Pattern definitions must be objects');
    const actual = Object.keys(value);
    if (actual.length !== expected.length || actual.some((key)=>!expected.includes(key))) reject('Unsupported pattern definition fields');
}
function limit(value, maximum) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) reject('Pattern budget must be a positive integer within the hard limit');
}
export function expandRectangularDrawingPattern(entities, pattern, budget = {}) {
    const maxEntities = budget.maxEntities ?? 64, maxPoints = budget.maxPoints ?? POINT_LIMIT;
    limit(maxEntities, ENTITY_LIMIT);
    limit(maxPoints, POINT_LIMIT);
    keys(pattern, [
        'rows',
        'columns',
        'dx',
        'dy'
    ]);
    const { rows, columns, dx, dy } = pattern;
    if (![
        rows,
        columns
    ].every((value)=>Number.isSafeInteger(value) && value >= 1)) reject('Pattern rows and columns must be positive safe integers');
    if (!coordinate(dx) || !coordinate(dy)) reject('Pattern spacing must be finite and within the coordinate range');
    if (columns > 1 && dx === 0 || rows > 1 && dy === 0) reject('Repeated pattern directions require nonzero spacing');
    if (!Array.isArray(entities) || !entities.length || entities.length > maxEntities) reject('Pattern requires a nonempty bounded entity array');
    if (rows > Math.floor(maxEntities / entities.length / columns)) reject('Pattern exceeds the entity budget');
    const copies = rows * columns, lastX = (columns - 1) * dx, lastY = (rows - 1) * dy;
    if (!Number.isFinite(lastX) || !Number.isFinite(lastY)) reject('Pattern translation is not finite');
    let pointsPerCopy = 0;
    const checkSegment = (a, b)=>{
        if (same(a, b)) reject('Pattern segments require distinct endpoints');
    };
    const checkPoint = (point)=>{
        if (!Array.isArray(point) || point.length !== 3 || !coordinate(point[0]) || !coordinate(point[1]) || point[2] !== 0) reject('Pattern points must be finite native XY triples within the coordinate range');
        if (!coordinate(point[0] + lastX) || !coordinate(point[1] + lastY)) reject('Expanded pattern exceeds the coordinate range');
        pointsPerCopy++;
        if (pointsPerCopy > Math.floor(maxPoints / copies)) reject('Pattern exceeds the point-work budget');
    };
    const checkVector = (vector)=>{
        if (!Array.isArray(vector) || vector.length !== 3 || !coordinate(vector[0]) || !coordinate(vector[1]) || vector[2] !== 0) reject('Pattern vectors must be finite native XY triples within the coordinate range');
        if (vector[0] === 0 && vector[1] === 0) reject('Pattern ellipse major axis must be nonzero');
        pointsPerCopy++;
        if (pointsPerCopy > Math.floor(maxPoints / copies)) reject('Pattern exceeds the point-work budget');
    };
    for (const entity of entities){
        keys(entity, [
            'type',
            'payload'
        ]);
        const payload = entity.payload;
        switch(entity.type){
            case 'LINE':
                {
                    keys(payload, [
                        'start',
                        'end'
                    ]);
                    const { start, end } = entity.payload;
                    checkPoint(start);
                    checkPoint(end);
                    checkSegment(start, end);
                    break;
                }
            case 'CIRCLE':
            case 'ARC':
                {
                    keys(payload, entity.type === 'CIRCLE' ? [
                        'center',
                        'radius'
                    ] : [
                        'center',
                        'radius',
                        'startAngle',
                        'endAngle',
                        'clockwise'
                    ]);
                    checkPoint(entity.payload.center);
                    if (!coordinate(entity.payload.radius) || entity.payload.radius <= 0) reject('Pattern radius must be positive and within the coordinate range');
                    if (entity.type === 'ARC') {
                        const { startAngle, endAngle, clockwise } = entity.payload;
                        if (![
                            startAngle,
                            endAngle
                        ].every((angle)=>Number.isFinite(angle) && angle >= 0 && angle <= Math.PI * 2) || typeof clockwise !== 'boolean' || (endAngle - startAngle) % (Math.PI * 2) === 0) reject('Pattern arcs require bounded radian angles and a nonzero partial sweep');
                    }
                    break;
                }
            case 'ELLIPSE':
                {
                    keys(payload, [
                        'center',
                        'majorAxis',
                        'ratio',
                        'startParameter',
                        'endParameter'
                    ]);
                    const { center, majorAxis, ratio, startParameter, endParameter } = entity.payload;
                    checkPoint(center);
                    checkVector(majorAxis);
                    if (!coordinate(ratio) || ratio <= 0 || ratio > 1) reject('Pattern ellipse ratio must be greater than 0 and at most 1');
                    if (![
                        startParameter,
                        endParameter
                    ].every((parameter)=>Number.isFinite(parameter) && parameter >= 0 && parameter <= Math.PI * 2) || startParameter === endParameter) reject('Pattern ellipses require bounded radian parameters and a nonzero sweep');
                    break;
                }
            case 'SPLINE':
                {
                    keys(payload, entity.payload.weights ? [
                        'degree',
                        'controlPoints',
                        'knots',
                        'weights',
                        'closed',
                        'periodic'
                    ] : [
                        'degree',
                        'controlPoints',
                        'knots',
                        'closed',
                        'periodic'
                    ]);
                    const { degree, controlPoints, knots, weights, closed, periodic } = entity.payload;
                    if (closed !== false || periodic !== false || !Array.isArray(controlPoints) || controlPoints.length > 64) reject('Pattern splines require an open bounded native NURBS definition');
                    controlPoints.forEach(checkPoint);
                    normalizeSplineDefinition({
                        degree,
                        controlPoints,
                        knots,
                        ...weights ? {
                            weights
                        } : {}
                    });
                    break;
                }
            case 'LWPOLYLINE':
                {
                    keys(payload, [
                        'vertices',
                        'closed'
                    ]);
                    const { vertices, closed } = entity.payload;
                    if (typeof closed !== 'boolean' || !Array.isArray(vertices) || vertices.length < (closed ? 3 : 2) || vertices.length > 64) reject('Pattern polylines require 2–64 vertices, or at least 3 when closed');
                    for(let index = 0; index < vertices.length; index++){
                        checkPoint(vertices[index]);
                        if (index > 0) checkSegment(vertices[index], vertices[index - 1]);
                    }
                    if (closed) checkSegment(vertices[0], vertices[vertices.length - 1]);
                    break;
                }
            default:
                reject('Unsupported pattern entity type');
        }
    }
    for(let row = 0; row < rows; row++)for(let column = 0; column < columns; column++){
        const x = column * dx, y = row * dy;
        const distinct = (a, b)=>{
            if (a[0] + x === b[0] + x && a[1] + y === b[1] + y) reject('Pattern translation loses segment precision');
        };
        for (const entity of entities){
            if (entity.type === 'LINE') distinct(entity.payload.start, entity.payload.end);
            else if (entity.type === 'LWPOLYLINE') {
                const { vertices, closed } = entity.payload;
                for(let index = 1; index < vertices.length; index++)distinct(vertices[index - 1], vertices[index]);
                if (closed) distinct(vertices[vertices.length - 1], vertices[0]);
            }
        }
    }
    const expanded = [];
    for(let row = 0; row < rows; row++)for(let column = 0; column < columns; column++){
        const x = column * dx, y = row * dy;
        const translate = (point)=>[
                point[0] + x,
                point[1] + y,
                0
            ];
        for (const entity of entities){
            switch(entity.type){
                case 'LINE':
                    expanded.push({
                        type: 'LINE',
                        payload: {
                            start: translate(entity.payload.start),
                            end: translate(entity.payload.end)
                        }
                    });
                    break;
                case 'CIRCLE':
                    expanded.push({
                        type: 'CIRCLE',
                        payload: {
                            center: translate(entity.payload.center),
                            radius: entity.payload.radius
                        }
                    });
                    break;
                case 'ARC':
                    expanded.push({
                        type: 'ARC',
                        payload: {
                            ...entity.payload,
                            center: translate(entity.payload.center)
                        }
                    });
                    break;
                case 'ELLIPSE':
                    expanded.push({
                        type: 'ELLIPSE',
                        payload: {
                            ...entity.payload,
                            center: translate(entity.payload.center),
                            majorAxis: [
                                ...entity.payload.majorAxis
                            ]
                        }
                    });
                    break;
                case 'SPLINE':
                    expanded.push({
                        type: 'SPLINE',
                        payload: {
                            ...entity.payload,
                            controlPoints: entity.payload.controlPoints.map(translate),
                            knots: [
                                ...entity.payload.knots
                            ],
                            ...entity.payload.weights ? {
                                weights: [
                                    ...entity.payload.weights
                                ]
                            } : {}
                        }
                    });
                    break;
                case 'LWPOLYLINE':
                    expanded.push({
                        type: 'LWPOLYLINE',
                        payload: {
                            vertices: entity.payload.vertices.map(translate),
                            closed: entity.payload.closed
                        }
                    });
                    break;
            }
        }
    }
    return expanded;
}
export function expandPolarDrawingPattern(entities, pattern, budget = {}) {
    const maxEntities = budget.maxEntities ?? 64, maxPoints = budget.maxPoints ?? POINT_LIMIT;
    limit(maxEntities, ENTITY_LIMIT);
    limit(maxPoints, POINT_LIMIT);
    keys(pattern, [
        'center',
        'count',
        'angleDegrees'
    ]);
    const { center, count, angleDegrees } = pattern;
    if (!Number.isSafeInteger(count) || count < 2) reject('Polar pattern count must be a safe integer of at least 2');
    if (typeof angleDegrees !== 'number' || !Number.isFinite(angleDegrees) || angleDegrees === 0 || Math.abs(angleDegrees) > 360) reject('Polar pattern angle must be nonzero and within ±360 degrees');
    if (!Array.isArray(entities) || !entities.length || entities.length > maxEntities) reject('Pattern requires a nonempty bounded entity array');
    if (count > Math.floor(maxEntities / entities.length)) reject('Pattern exceeds the entity budget');
    if (!Array.isArray(center) || center.length !== 3 || !coordinate(center[0]) || !coordinate(center[1]) || center[2] !== 0) reject('Polar pattern center must be a finite native XY triple within the coordinate range');
    const source = expandRectangularDrawingPattern(entities, {
        rows: 1,
        columns: 1,
        dx: 0,
        dy: 0
    }, {
        maxEntities,
        maxPoints
    });
    let pointsPerCopy = 0;
    for (const entity of source){
        if (entity.type === 'LINE') pointsPerCopy += 2;
        else if (entity.type === 'ELLIPSE') pointsPerCopy += 2;
        else if (entity.type === 'SPLINE') pointsPerCopy += entity.payload.controlPoints.length;
        else if (entity.type === 'LWPOLYLINE') pointsPerCopy += entity.payload.vertices.length;
        else pointsPerCopy++;
    }
    if (pointsPerCopy > Math.floor(maxPoints / count)) reject('Pattern exceeds the point-work budget');
    const full = Math.abs(angleDegrees) === 360;
    const step = angleDegrees * Math.PI / 180 / (full ? count : count - 1);
    const rotatePoint = (point, radians)=>{
        const cosine = Math.cos(radians), sine = Math.sin(radians);
        const dx = point[0] - center[0], dy = point[1] - center[1];
        const result = [
            center[0] + dx * cosine - dy * sine,
            center[1] + dx * sine + dy * cosine,
            0
        ];
        if (!coordinate(result[0]) || !coordinate(result[1])) reject('Expanded pattern exceeds the coordinate range');
        return result;
    };
    const rotateVector = (vector, radians)=>{
        const cosine = Math.cos(radians), sine = Math.sin(radians);
        const result = [
            vector[0] * cosine - vector[1] * sine,
            vector[0] * sine + vector[1] * cosine,
            0
        ];
        if (!coordinate(result[0]) || !coordinate(result[1]) || result[0] === 0 && result[1] === 0) reject('Expanded pattern loses ellipse-axis precision');
        return result;
    };
    const normalize = (radians)=>{
        const turn = Math.PI * 2, value = radians % turn;
        return value < 0 ? value + turn : value;
    };
    const expanded = [];
    for(let copy = 0; copy < count; copy++){
        const radians = copy * step;
        if (copy === 0) {
            expanded.push(...source);
            continue;
        }
        for (const entity of source){
            switch(entity.type){
                case 'LINE':
                    {
                        const start = rotatePoint(entity.payload.start, radians), end = rotatePoint(entity.payload.end, radians);
                        if (same(start, end)) reject('Pattern rotation loses segment precision');
                        expanded.push({
                            type: 'LINE',
                            payload: {
                                start,
                                end
                            }
                        });
                        break;
                    }
                case 'CIRCLE':
                    expanded.push({
                        type: 'CIRCLE',
                        payload: {
                            center: rotatePoint(entity.payload.center, radians),
                            radius: entity.payload.radius
                        }
                    });
                    break;
                case 'ARC':
                    expanded.push({
                        type: 'ARC',
                        payload: {
                            ...entity.payload,
                            center: rotatePoint(entity.payload.center, radians),
                            startAngle: normalize(entity.payload.startAngle + radians),
                            endAngle: normalize(entity.payload.endAngle + radians)
                        }
                    });
                    break;
                case 'ELLIPSE':
                    expanded.push({
                        type: 'ELLIPSE',
                        payload: {
                            ...entity.payload,
                            center: rotatePoint(entity.payload.center, radians),
                            majorAxis: rotateVector(entity.payload.majorAxis, radians)
                        }
                    });
                    break;
                case 'SPLINE':
                    expanded.push({
                        type: 'SPLINE',
                        payload: {
                            ...entity.payload,
                            controlPoints: entity.payload.controlPoints.map((point)=>rotatePoint(point, radians)),
                            knots: [
                                ...entity.payload.knots
                            ],
                            ...entity.payload.weights ? {
                                weights: [
                                    ...entity.payload.weights
                                ]
                            } : {}
                        }
                    });
                    break;
                case 'LWPOLYLINE':
                    {
                        const vertices = entity.payload.vertices.map((point)=>rotatePoint(point, radians));
                        for(let index = 1; index < vertices.length; index++)if (same(vertices[index - 1], vertices[index])) reject('Pattern rotation loses segment precision');
                        if (entity.payload.closed && same(vertices.at(-1), vertices[0])) reject('Pattern rotation loses segment precision');
                        expanded.push({
                            type: 'LWPOLYLINE',
                            payload: {
                                vertices,
                                closed: entity.payload.closed
                            }
                        });
                        break;
                    }
            }
        }
    }
    return expanded;
}
