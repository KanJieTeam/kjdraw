// Generated from snapping.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { add2, arcSweep, closestPointOnCircle2, closestPointOnSegment2, distance2, intersectCircleCircle2, intersectLineCircle2, intersectLineLine2, lengthSquared2, lerp2, midpoint2, multiply2, perpendicular2, projectParameter2, subtract2, vec2 } from './geometry/index.js';
import { normalizeSplineDefinition, splinePoint2 } from './geometry/curves.js';
export const KJ_SNAP_MODES = Object.freeze([
    'endpoint',
    'midpoint',
    'center',
    'quadrant',
    'insertion',
    'node',
    'nearest',
    'intersection',
    'perpendicular',
    'tangent'
]);
export const KJ_DEFAULT_SNAP_MODES = Object.freeze([
    'endpoint',
    'midpoint',
    'center',
    'quadrant',
    'intersection',
    'perpendicular',
    'tangent',
    'nearest'
]);
export const KJ_DEFAULT_SNAP_APERTURE = 10;
export function getDocumentSnapSettings(document) {
    if (!document?.snapshot) throw new KJValidationError('Snap settings require a KJDocument');
    const variables = document.snapshot().header.systemVariables;
    const configuredModes = variables.OSMODE;
    if (configuredModes !== undefined && !Array.isArray(configuredModes)) throw new KJValidationError('OSMODE must be an array of snap modes');
    const rawModes = configuredModes === undefined ? KJ_DEFAULT_SNAP_MODES : configuredModes;
    const modes = [
        ...new Set(rawModes.map((value)=>String(value).toLowerCase()))
    ];
    for (const mode of modes)if (!KJ_SNAP_MODES.includes(mode)) throw new KJValidationError(`Unsupported snap mode: ${mode}`);
    const aperture = Number(variables.APERTURE ?? KJ_DEFAULT_SNAP_APERTURE);
    if (!(aperture > 0) || !Number.isFinite(aperture)) throw new KJValidationError('APERTURE must be a positive finite number');
    return Object.freeze({
        modes: Object.freeze(modes),
        aperture
    });
}
const TURN = Math.PI * 2;
const point3 = (point)=>{
    const record = point;
    const value = Array.isArray(point) ? point : [
        record.x,
        record.y,
        record.z ?? 0
    ];
    return [
        Number(value[0]),
        Number(value[1]),
        Number(value[2] ?? 0)
    ];
};
const pointAt = (center, radius, angle)=>{
    const value = point3(center);
    return [
        value[0] + radius * Math.cos(angle),
        value[1] + radius * Math.sin(angle),
        value[2]
    ];
};
function ellipsePointAt(payload, parameter) {
    const center = point3(payload.center), major = point3(payload.majorAxis), ratio = Number(payload.ratio);
    if (![
        ...center,
        ...major,
        ratio,
        parameter
    ].every(Number.isFinite) || Math.hypot(major[0], major[1]) <= 1e-12 || ratio <= 0 || ratio > 1) throw new KJValidationError('ELLIPSE snap geometry is invalid');
    const x = Math.cos(parameter), y = Math.sin(parameter) * ratio;
    return [
        center[0] + major[0] * x - major[1] * y,
        center[1] + major[1] * x + major[0] * y,
        center[2]
    ];
}
function ellipseParameters(payload) {
    const start = Number(payload.startParameter ?? 0), end = Number(payload.endParameter ?? TURN), span = end - start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || span <= 1e-12 || span > TURN + 1e-10) throw new KJValidationError('ELLIPSE snap parameters are invalid');
    return {
        start,
        span: Math.min(span, TURN),
        full: Math.abs(span - TURN) <= 1e-10
    };
}
function parameterOnEllipse(parameter, start, span, epsilon = 1e-10) {
    return positiveTurn(parameter - start) <= span + epsilon;
}
function nearestOnEllipse(cursor, payload) {
    const ellipse = ellipseParameters(payload), samples = Math.max(16, Math.ceil(32 * ellipse.span / TURN));
    const distanceAt = (offset)=>distance2(cursor, ellipsePointAt(payload, ellipse.start + offset));
    let bestIndex = 0, bestDistance = distanceAt(0);
    for(let index = 1; index <= samples; index += 1){
        const distance = distanceAt(ellipse.span * index / samples);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    }
    let lower = ellipse.span * Math.max(0, bestIndex - 1) / samples;
    let upper = ellipse.span * Math.min(samples, bestIndex + 1) / samples;
    const ratio = (Math.sqrt(5) - 1) / 2;
    let left = upper - (upper - lower) * ratio, right = lower + (upper - lower) * ratio;
    let leftDistance = distanceAt(left), rightDistance = distanceAt(right);
    for(let iteration = 0; iteration < 36; iteration += 1){
        if (leftDistance <= rightDistance) {
            upper = right;
            right = left;
            rightDistance = leftDistance;
            left = upper - (upper - lower) * ratio;
            leftDistance = distanceAt(left);
        } else {
            lower = left;
            left = right;
            leftDistance = rightDistance;
            right = lower + (upper - lower) * ratio;
            rightDistance = distanceAt(right);
        }
    }
    const candidates = [
        0,
        ellipse.span,
        (lower + upper) / 2
    ].map((offset)=>({
            offset,
            point: ellipsePointAt(payload, ellipse.start + offset),
            distance: distanceAt(offset)
        })).sort((a, b)=>a.distance - b.distance);
    const best = candidates[0];
    return {
        point: best.point,
        distance: best.distance,
        parameter: ellipse.start + best.offset
    };
}
function ellipseBoxDistance(cursor, payload) {
    const point = point3(cursor), center = point3(payload.center), major = point3(payload.majorAxis), ratio = Number(payload.ratio);
    const extentX = Math.hypot(major[0], major[1] * ratio), extentY = Math.hypot(major[1], major[0] * ratio);
    return Math.hypot(Math.max(0, Math.abs(point[0] - center[0]) - extentX), Math.max(0, Math.abs(point[1] - center[1]) - extentY));
}
function splineGeometry(payload) {
    const definition = normalizeSplineDefinition(payload), controls = payload.controlPoints ?? [];
    const zDefinition = normalizeSplineDefinition({
        degree: definition.degree,
        knots: definition.knots,
        weights: definition.weights,
        controlPoints: controls.map((point)=>[
                point3(point)[2],
                0
            ])
    });
    return {
        definition,
        zDefinition,
        start: definition.knots[definition.degree],
        end: definition.knots[definition.controlPoints.length]
    };
}
function splinePointAt3(geometry, parameter) {
    const point = splinePoint2(geometry.definition, parameter), z = splinePoint2(geometry.zDefinition, parameter)[0];
    return [
        point[0],
        point[1],
        z
    ];
}
function nearestOnSpline(cursor, payload) {
    const geometry = splineGeometry(payload), knots = [
        ...new Set(geometry.definition.knots.filter((value)=>value >= geometry.start && value <= geometry.end))
    ];
    const distanceAt = (parameter)=>distance2(cursor, splinePointAt3(geometry, parameter));
    const candidates = [];
    const add = (parameter)=>{
        candidates.push({
            parameter,
            distance: distanceAt(parameter)
        });
    };
    for(let span = 1; span < knots.length; span += 1){
        const start = knots[span - 1], end = knots[span];
        if (!(end > start)) continue;
        const samples = 8, values = Array.from({
            length: samples + 1
        }, (_, index)=>{
            const parameter = start + (end - start) * index / samples;
            return {
                parameter,
                distance: distanceAt(parameter)
            };
        });
        add(start);
        add(end);
        for(let index = 0; index <= samples; index += 1){
            const current = values[index], previous = values[index - 1], next = values[index + 1];
            if (previous && current.distance > previous.distance || next && current.distance > next.distance) continue;
            let lower = values[Math.max(0, index - 1)].parameter, upper = values[Math.min(samples, index + 1)].parameter;
            const ratio = (Math.sqrt(5) - 1) / 2;
            let left = upper - (upper - lower) * ratio, right = lower + (upper - lower) * ratio;
            let leftDistance = distanceAt(left), rightDistance = distanceAt(right);
            for(let iteration = 0; iteration < 40; iteration += 1){
                if (leftDistance <= rightDistance) {
                    upper = right;
                    right = left;
                    rightDistance = leftDistance;
                    left = upper - (upper - lower) * ratio;
                    leftDistance = distanceAt(left);
                } else {
                    lower = left;
                    left = right;
                    leftDistance = rightDistance;
                    right = lower + (upper - lower) * ratio;
                    rightDistance = distanceAt(right);
                }
            }
            add((lower + upper) / 2);
        }
    }
    const best = candidates.sort((a, b)=>a.distance - b.distance)[0];
    if (!best) throw new KJValidationError('SPLINE snap domain is empty');
    return {
        point: splinePointAt3(geometry, best.parameter),
        distance: best.distance,
        parameter: best.parameter
    };
}
function splineBoxDistance(cursor, payload) {
    const point = point3(cursor), controls = (payload.controlPoints ?? []).map(point3);
    if (!controls.length) return Infinity;
    const minimumX = Math.min(...controls.map((value)=>value[0])), maximumX = Math.max(...controls.map((value)=>value[0]));
    const minimumY = Math.min(...controls.map((value)=>value[1])), maximumY = Math.max(...controls.map((value)=>value[1]));
    return Math.hypot(Math.max(0, minimumX - point[0], point[0] - maximumX), Math.max(0, minimumY - point[1], point[1] - maximumY));
}
function ellipseLocalCoordinates(payload, input) {
    const center = point3(payload.center), major = point3(payload.majorAxis), ratio = Number(payload.ratio);
    const minor = [
        -major[1] * ratio,
        major[0] * ratio,
        0
    ], determinant = major[0] * minor[1] - major[1] * minor[0];
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-20) throw new KJValidationError('ELLIPSE snap geometry is invalid');
    const value = point3(input), dx = value[0] - center[0], dy = value[1] - center[1];
    return [
        (dx * minor[1] - dy * minor[0]) / determinant,
        (major[0] * dy - major[1] * dx) / determinant
    ];
}
function ellipseTangentCandidates(entity, cursor, reference, payload) {
    const local = ellipseLocalCoordinates(payload, reference), squared = local[0] * local[0] + local[1] * local[1];
    if (squared <= 1 + 1e-12 * Math.max(1, squared)) return [];
    const parameters = ellipseParameters(payload), centerAngle = Math.atan2(local[1], local[0]), offset = Math.acos(1 / Math.sqrt(squared));
    return [
        centerAngle + offset,
        centerAngle - offset
    ].flatMap((parameter)=>{
        if (!parameters.full && !parameterOnEllipse(parameter, parameters.start, parameters.span)) return [];
        const point = ellipsePointAt(payload, parameter);
        return [
            {
                mode: 'tangent',
                point,
                entityIds: [
                    entity.id
                ],
                distance: distance2(cursor, point),
                parameter
            }
        ];
    });
}
function ellipseParameterRoots(payload, evaluate, derivative) {
    const domain = ellipseParameters(payload), start = domain.start, end = start + domain.span;
    const samples = Math.max(64, Math.ceil(128 * domain.span / TURN)), roots = [];
    const normalize = (parameter)=>domain.full ? start + positiveTurn(parameter - start) : Math.max(start, Math.min(end, parameter));
    const add = (parameter)=>{
        parameter = normalize(parameter);
        if (Math.abs(evaluate(parameter)) > 1e-9) return;
        if (!roots.some((value)=>Math.min(positiveTurn(value - parameter), positiveTurn(parameter - value)) <= 1e-7)) roots.push(parameter);
    };
    const sampled = [
        {
            parameter: start,
            value: evaluate(start)
        }
    ];
    let previousParameter = start, previousValue = sampled[0].value;
    add(start);
    for(let index = 1; index <= samples; index += 1){
        const parameter = start + domain.span * index / samples, value = evaluate(parameter);
        sampled.push({
            parameter,
            value
        });
        if (value === 0) add(parameter);
        else if (previousValue !== 0 && value * previousValue < 0) {
            let lower = previousParameter, upper = parameter, lowerValue = previousValue;
            for(let iteration = 0; iteration < 52; iteration += 1){
                const middle = (lower + upper) / 2, middleValue = evaluate(middle);
                if (lowerValue * middleValue <= 0) upper = middle;
                else {
                    lower = middle;
                    lowerValue = middleValue;
                }
            }
            add((lower + upper) / 2);
        }
        previousParameter = parameter;
        previousValue = value;
    }
    const lastIndex = domain.full ? samples - 1 : samples;
    for(let index = 0; index <= lastIndex; index += 1){
        const current = sampled[index], previous = index > 0 ? sampled[index - 1] : domain.full ? sampled[samples - 1] : null;
        const next = index < samples ? sampled[index + 1] : null;
        if (previous && Math.abs(current.value) > Math.abs(previous.value) || next && Math.abs(current.value) > Math.abs(next.value)) continue;
        let parameter = current.parameter;
        for(let iteration = 0; iteration < 40; iteration += 1){
            const slope = derivative(parameter);
            if (Math.abs(slope) <= 1e-14) break;
            const next = normalize(parameter - evaluate(parameter) / slope);
            if (Math.abs(next - parameter) <= 1e-13) {
                parameter = next;
                break;
            }
            parameter = next;
        }
        add(parameter);
    }
    return roots.sort((a, b)=>a - b);
}
function ellipseNormalParameters(payload, reference) {
    const local = ellipseLocalCoordinates(payload, reference), ratioSquared = Number(payload.ratio) ** 2;
    if (Math.abs(ratioSquared - 1) <= 1e-14 && local[0] * local[0] + local[1] * local[1] <= 1e-24) return [];
    return ellipseParameterRoots(payload, (parameter)=>{
        const sine = Math.sin(parameter), cosine = Math.cos(parameter);
        return (ratioSquared - 1) * sine * cosine + local[0] * sine - ratioSquared * local[1] * cosine;
    }, (parameter)=>{
        const sine = Math.sin(parameter), cosine = Math.cos(parameter);
        return (ratioSquared - 1) * (cosine * cosine - sine * sine) + local[0] * cosine + ratioSquared * local[1] * sine;
    });
}
function ellipsePerpendicularCandidates(entity, cursor, reference, payload) {
    return ellipseNormalParameters(payload, reference).map((parameter)=>{
        const point = ellipsePointAt(payload, parameter);
        return {
            mode: 'perpendicular',
            point,
            entityIds: [
                entity.id
            ],
            distance: distance2(cursor, point),
            parameter
        };
    });
}
function positiveTurn(value) {
    value %= TURN;
    return value < 0 ? value + TURN : value;
}
function angleOnArc(angle, arc, epsilon = 1e-10) {
    const sweep = arc.sweep;
    return sweep >= 0 ? positiveTurn(angle - arc.startAngle) <= sweep + epsilon : positiveTurn(arc.startAngle - angle) <= -sweep + epsilon;
}
function bulgeArc(startInput, endInput, bulgeInput, entityId, segmentIndex) {
    const start = point3(startInput), end = point3(endInput), bulge = Number(bulgeInput ?? 0);
    if (!Number.isFinite(bulge) || Math.abs(bulge) <= 1e-15) return null;
    const chordVector = subtract2(end, start);
    const chord = Math.sqrt(lengthSquared2(chordVector));
    if (chord <= 1e-15) return null;
    const unit = multiply2(chordVector, 1 / chord);
    const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge);
    const center2 = add2(midpoint2(start, end), multiply2(perpendicular2(unit), centerOffset));
    const center = [
        center2[0],
        center2[1],
        (start[2] + end[2]) / 2
    ];
    const sweep = 4 * Math.atan(bulge);
    return {
        kind: 'arc',
        center,
        radius: distance2(center, start),
        startAngle: Math.atan2(start[1] - center[1], start[0] - center[0]),
        sweep,
        entityId,
        segmentIndex
    };
}
function vertexPoint(vertex) {
    return Array.isArray(vertex) || !('point' in vertex) ? vertex : vertex.point;
}
function primitiveSegments(entity) {
    const payload = entity.payload, id = entity.id;
    switch(entity.type){
        case 'LINE':
            return [
                {
                    kind: 'line',
                    start: payload.start,
                    end: payload.end,
                    mode: 'segment',
                    entityId: id
                }
            ];
        case 'RAY':
            return [
                {
                    kind: 'line',
                    start: payload.origin,
                    end: add2(payload.origin, payload.direction),
                    mode: 'ray',
                    entityId: id
                }
            ];
        case 'XLINE':
            return [
                {
                    kind: 'line',
                    start: payload.origin,
                    end: add2(payload.origin, payload.direction),
                    mode: 'line',
                    entityId: id
                }
            ];
        case 'CIRCLE':
            return [
                {
                    kind: 'circle',
                    center: payload.center,
                    radius: payload.radius,
                    entityId: id
                }
            ];
        case 'ARC':
            return [
                {
                    kind: 'arc',
                    center: payload.center,
                    radius: payload.radius,
                    startAngle: payload.startAngle,
                    sweep: arcSweep(payload),
                    entityId: id
                }
            ];
        case 'LWPOLYLINE':
        case 'POLYLINE':
            {
                const vertices = payload.vertices ?? [], count = payload.closed ? vertices.length : vertices.length - 1;
                const result = [];
                for(let index = 0; index < count; index += 1){
                    const vertex = vertices[index], next = vertices[(index + 1) % vertices.length];
                    const start = vertexPoint(vertex), end = vertexPoint(next);
                    const bulge = Array.isArray(vertex) ? undefined : vertex.bulge;
                    result.push(bulgeArc(start, end, bulge, id, index) ?? {
                        kind: 'line',
                        start,
                        end,
                        mode: 'segment',
                        entityId: id,
                        segmentIndex: index
                    });
                }
                return result;
            }
        case 'SOLID':
        case 'TRACE':
            {
                const vertices = payload.vertices ?? [], result = [];
                for(let index = 0; index < vertices.length; index += 1)result.push({
                    kind: 'line',
                    start: vertexPoint(vertices[index]),
                    end: vertexPoint(vertices[(index + 1) % vertices.length]),
                    mode: 'segment',
                    entityId: id,
                    segmentIndex: index
                });
                return result;
            }
        default:
            return [];
    }
}
function arcEndpoints(arc) {
    return [
        pointAt(arc.center, arc.radius, arc.startAngle),
        pointAt(arc.center, arc.radius, arc.startAngle + arc.sweep)
    ];
}
function nearestOnLine(cursor, primitive) {
    if (primitive.mode === 'segment') return closestPointOnSegment2(cursor, primitive.start, primitive.end);
    const direction = subtract2(primitive.end, primitive.start);
    let parameter = projectParameter2(cursor, primitive.start, direction);
    if (primitive.mode === 'ray') parameter = Math.max(0, parameter);
    const point = add2(primitive.start, multiply2(direction, parameter));
    return {
        point,
        parameter,
        distance: distance2(cursor, point)
    };
}
function nearestOnPrimitive(cursor, primitive) {
    if (primitive.kind === 'line') return nearestOnLine(cursor, primitive);
    const radial = closestPointOnCircle2(cursor, primitive.center, primitive.radius);
    if (primitive.kind === 'circle' || angleOnArc(radial.angle, primitive)) return radial;
    const nearest = arcEndpoints(primitive).map((point)=>({
            point,
            distance: distance2(cursor, point)
        })).sort((a, b)=>a.distance - b.distance)[0];
    if (!nearest) throw new KJValidationError('Arc has no endpoints');
    return nearest;
}
function acceptsLineParameter(primitive, parameter, epsilon = 1e-12) {
    return primitive.mode === 'line' || primitive.mode === 'ray' && parameter >= -epsilon || primitive.mode === 'segment' && parameter >= -epsilon && parameter <= 1 + epsilon;
}
function perpendicularCandidates(entity, cursor, reference) {
    const result = [];
    for (const primitive of primitiveSegments(entity)){
        if (primitive.kind === 'line') {
            const direction = subtract2(primitive.end, primitive.start);
            if (lengthSquared2(direction) <= 1e-24) continue;
            const parameter = projectParameter2(reference, primitive.start, direction);
            if (!acceptsLineParameter(primitive, parameter)) continue;
            const point = point3(add2(primitive.start, multiply2(direction, parameter)));
            result.push({
                mode: 'perpendicular',
                point,
                entityIds: [
                    entity.id
                ],
                distance: distance2(cursor, point),
                ...primitive.segmentIndex === undefined ? {} : {
                    segmentIndex: primitive.segmentIndex
                },
                parameter
            });
            continue;
        }
        const center = point3(primitive.center), fromCenter = subtract2(reference, center), squaredDistance = lengthSquared2(fromCenter);
        if (squaredDistance <= 1e-24) continue;
        const scale = primitive.radius / Math.sqrt(squaredDistance);
        for (const sign of [
            1,
            -1
        ]){
            const point = point3(add2(center, multiply2(fromCenter, scale * sign)));
            if (!accepts(primitive, point)) continue;
            result.push({
                mode: 'perpendicular',
                point,
                entityIds: [
                    entity.id
                ],
                distance: distance2(cursor, point),
                ...primitive.segmentIndex === undefined ? {} : {
                    segmentIndex: primitive.segmentIndex
                },
                angle: Math.atan2(point[1] - center[1], point[0] - center[0])
            });
        }
    }
    return result;
}
function tangentCandidates(entity, cursor, reference) {
    const result = [];
    for (const primitive of primitiveSegments(entity)){
        if (primitive.kind === 'line') continue;
        const center = point3(primitive.center), fromCenter = subtract2(reference, center), squaredDistance = lengthSquared2(fromCenter);
        const radiusSquared = primitive.radius * primitive.radius;
        const tolerance = 1e-12 * Math.max(1, squaredDistance, radiusSquared);
        if (squaredDistance <= radiusSquared + tolerance) continue;
        const along = radiusSquared / squaredDistance;
        const across = primitive.radius * Math.sqrt(squaredDistance - radiusSquared) / squaredDistance;
        const normal = perpendicular2(fromCenter);
        for (const sign of [
            1,
            -1
        ]){
            const point = point3(add2(center, add2(multiply2(fromCenter, along), multiply2(normal, across * sign))));
            if (!accepts(primitive, point)) continue;
            result.push({
                mode: 'tangent',
                point,
                entityIds: [
                    entity.id
                ],
                distance: distance2(cursor, point),
                ...primitive.segmentIndex === undefined ? {} : {
                    segmentIndex: primitive.segmentIndex
                },
                angle: Math.atan2(point[1] - center[1], point[0] - center[0])
            });
        }
    }
    return result;
}
function baseCandidates(entity, modes, cursor, reference, radius) {
    const payload = entity.payload, result = [];
    const add = (mode, point, detail = {})=>{
        result.push({
            mode,
            point: point3(point),
            entityIds: [
                entity.id
            ],
            ...detail
        });
    };
    const primitives = primitiveSegments(entity);
    if (modes.has('endpoint')) {
        if ([
            'LINE'
        ].includes(entity.type)) {
            add('endpoint', payload.start, {
                role: 'start'
            });
            add('endpoint', payload.end, {
                role: 'end'
            });
        }
        if ([
            'RAY',
            'XLINE'
        ].includes(entity.type)) add('endpoint', payload.origin, {
            role: 'origin'
        });
        if (entity.type === 'ARC') {
            const primitive = primitives[0];
            if (primitive?.kind === 'arc') {
                const [start, end] = arcEndpoints(primitive);
                add('endpoint', start, {
                    role: 'start'
                });
                add('endpoint', end, {
                    role: 'end'
                });
            }
        }
        if (entity.type === 'ELLIPSE' && ellipseBoxDistance(cursor, payload) <= radius) {
            const ellipse = ellipseParameters(payload);
            if (!ellipse.full) {
                add('endpoint', ellipsePointAt(payload, ellipse.start), {
                    role: 'start',
                    parameter: ellipse.start
                });
                add('endpoint', ellipsePointAt(payload, ellipse.start + ellipse.span), {
                    role: 'end',
                    parameter: ellipse.start + ellipse.span
                });
            }
        }
        if ([
            'LWPOLYLINE',
            'POLYLINE'
        ].includes(entity.type)) for (const [index, vertex] of (payload.vertices ?? []).entries())add('endpoint', vertexPoint(vertex), {
            vertexIndex: index
        });
        if ([
            'SOLID',
            'TRACE'
        ].includes(entity.type)) for (const [index, point] of (payload.vertices ?? []).entries())add('endpoint', vertexPoint(point), {
            vertexIndex: index
        });
        if (entity.type === 'SPLINE' && payload.closed !== true && payload.periodic !== true && splineBoxDistance(cursor, payload) <= radius) {
            const geometry = splineGeometry(payload);
            add('endpoint', splinePointAt3(geometry, geometry.start), {
                role: 'start',
                parameter: geometry.start
            });
            add('endpoint', splinePointAt3(geometry, geometry.end), {
                role: 'end',
                parameter: geometry.end
            });
        }
    }
    if (modes.has('midpoint')) for (const primitive of primitives.filter((value)=>value.kind !== 'circle')){
        const point = primitive.kind === 'line' ? midpoint2(primitive.start, primitive.end) : pointAt(primitive.center, primitive.radius, primitive.startAngle + primitive.sweep / 2);
        add('midpoint', point, {
            segmentIndex: primitive.segmentIndex
        });
    }
    if (modes.has('midpoint') && entity.type === 'ELLIPSE') {
        const ellipse = ellipseParameters(payload);
        if (!ellipse.full) add('midpoint', ellipsePointAt(payload, ellipse.start + ellipse.span / 2), {
            parameter: ellipse.start + ellipse.span / 2
        });
    }
    if (modes.has('midpoint') && entity.type === 'SPLINE' && splineBoxDistance(cursor, payload) <= radius) {
        const geometry = splineGeometry(payload), parameter = (geometry.start + geometry.end) / 2;
        add('midpoint', splinePointAt3(geometry, parameter), {
            parameter
        });
    }
    if (modes.has('center') && [
        'CIRCLE',
        'ARC',
        'ELLIPSE'
    ].includes(entity.type)) add('center', payload.center);
    if (modes.has('quadrant') && [
        'CIRCLE',
        'ARC'
    ].includes(entity.type)) for (const angle of [
        0,
        Math.PI / 2,
        Math.PI,
        Math.PI * 1.5
    ]){
        const primitive = primitives[0];
        if (primitive?.kind === 'circle' || primitive?.kind === 'arc' && angleOnArc(angle, primitive)) add('quadrant', pointAt(payload.center, payload.radius, angle), {
            angle
        });
    }
    if (modes.has('quadrant') && entity.type === 'ELLIPSE') {
        const ellipse = ellipseParameters(payload);
        for (const parameter of [
            0,
            Math.PI / 2,
            Math.PI,
            Math.PI * 1.5
        ]){
            if (ellipse.full || parameterOnEllipse(parameter, ellipse.start, ellipse.span)) add('quadrant', ellipsePointAt(payload, parameter), {
                parameter
            });
        }
    }
    if (modes.has('insertion') && [
        'INSERT',
        'TEXT',
        'MTEXT',
        'ATTDEF',
        'ATTRIB',
        'IMAGE',
        'TABLE'
    ].includes(entity.type)) add('insertion', payload.position);
    if (modes.has('node') && entity.type === 'POINT') add('node', payload.position);
    if (reference && modes.has('perpendicular')) {
        if (entity.type === 'ELLIPSE') {
            if (ellipseBoxDistance(cursor, payload) <= radius) result.push(...ellipsePerpendicularCandidates(entity, cursor, reference, payload));
        } else result.push(...perpendicularCandidates(entity, cursor, reference));
    }
    if (reference && modes.has('tangent')) {
        if (entity.type === 'ELLIPSE') {
            if (ellipseBoxDistance(cursor, payload) <= radius) result.push(...ellipseTangentCandidates(entity, cursor, reference, payload));
        } else result.push(...tangentCandidates(entity, cursor, reference));
    }
    if (modes.has('nearest')) {
        if (entity.type === 'ELLIPSE') {
            const nearest = nearestOnEllipse(cursor, payload);
            add('nearest', nearest.point, {
                parameter: nearest.parameter
            });
        } else if (entity.type === 'SPLINE') {
            if (splineBoxDistance(cursor, payload) <= radius) {
                const nearest = nearestOnSpline(cursor, payload);
                add('nearest', nearest.point, {
                    parameter: nearest.parameter
                });
            }
        } else {
            const nearest = primitives.map((primitive)=>({
                    ...nearestOnPrimitive(cursor, primitive),
                    primitive
                })).sort((a, b)=>a.distance - b.distance)[0];
            if (nearest) add('nearest', nearest.point, {
                segmentIndex: nearest.primitive.segmentIndex,
                parameter: nearest.parameter
            });
        }
    }
    return result;
}
function accepts(primitive, point) {
    if (primitive.kind !== 'arc') return true;
    const center = point3(primitive.center), value = point3(point);
    return angleOnArc(Math.atan2(value[1] - center[1], value[0] - center[0]), primitive);
}
function ellipseLineIntersection(ellipse, line) {
    const payload = ellipse.payload, center = point3(payload.center), major = point3(payload.majorAxis), ratio = Number(payload.ratio);
    const minor = [
        -major[1] * ratio,
        major[0] * ratio,
        0
    ], determinant = major[0] * minor[1] - major[1] * minor[0];
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-20) return {
        kind: 'none',
        points: []
    };
    const start = ellipseLocalCoordinates(payload, line.start), end = ellipseLocalCoordinates(payload, line.end);
    const result = intersectLineCircle2(start, end, [
        0,
        0
    ], 1, {
        mode: line.mode
    });
    const parameters = ellipseParameters(payload);
    return {
        ...result,
        points: result.points.filter((unit)=>{
            const parameter = Math.atan2(Number(unit[1]), Number(unit[0]));
            return parameters.full || parameterOnEllipse(parameter, parameters.start, parameters.span);
        }).map((unit)=>[
                center[0] + major[0] * Number(unit[0]) + minor[0] * Number(unit[1]),
                center[1] + major[1] * Number(unit[0]) + minor[1] * Number(unit[1]),
                center[2]
            ])
    };
}
function ellipseCircleIntersection(ellipse, circle) {
    const payload = ellipse.payload, center = point3(payload.center), major = point3(payload.majorAxis), ratio = Number(payload.ratio);
    const circleCenter = point3(circle.center), radius = Number(circle.radius), majorLength = Math.hypot(major[0], major[1]);
    const scale = Math.max(1, majorLength * majorLength, radius * radius, lengthSquared2(subtract2(center, circleCenter)));
    const tolerance = 1e-10 * Math.sqrt(scale);
    if (Math.abs(ratio - 1) <= 1e-12 && distance2(center, circleCenter) <= tolerance && Math.abs(majorLength - radius) <= tolerance) return {
        kind: 'overlap',
        points: [],
        infinite: true
    };
    const derivativeAt = (parameter)=>{
        const sine = Math.sin(parameter), cosine = Math.cos(parameter);
        return [
            -major[0] * sine - major[1] * ratio * cosine,
            -major[1] * sine + major[0] * ratio * cosine
        ];
    };
    const evaluate = (parameter)=>{
        const point = ellipsePointAt(payload, parameter), dx = point[0] - circleCenter[0], dy = point[1] - circleCenter[1];
        return (dx * dx + dy * dy - radius * radius) / scale;
    };
    const derivative = (parameter)=>{
        const point = ellipsePointAt(payload, parameter), tangent = derivativeAt(parameter);
        return 2 * ((point[0] - circleCenter[0]) * tangent[0] + (point[1] - circleCenter[1]) * tangent[1]) / scale;
    };
    const points = ellipseParameterRoots(payload, evaluate, derivative).map((parameter)=>ellipsePointAt(payload, parameter)).filter((point)=>accepts(circle, point));
    return {
        kind: points.length ? 'point' : 'none',
        points
    };
}
function ellipseBasis(payload) {
    const center = point3(payload.center), major = point3(payload.majorAxis), ratio = Number(payload.ratio);
    return {
        center,
        major,
        minor: [
            -major[1] * ratio,
            major[0] * ratio,
            0
        ]
    };
}
function coincidentEllipseOffset(first, second) {
    const left = ellipseBasis(first), right = ellipseBasis(second);
    const scale = Math.max(1, Math.hypot(left.major[0], left.major[1]), Math.hypot(right.major[0], right.major[1]));
    if (distance2(left.center, right.center) > 1e-10 * scale) return null;
    const localMajor = ellipseLocalCoordinates(first, add2(left.center, right.major)), cosine = localMajor[0], sine = localMajor[1];
    if (Math.abs(cosine * cosine + sine * sine - 1) > 1e-9) return null;
    const predictedMajor = add2(multiply2(left.major, cosine), multiply2(left.minor, sine));
    const predictedMinor = add2(multiply2(left.major, -sine), multiply2(left.minor, cosine));
    if (distance2(predictedMajor, right.major) > 1e-9 * scale || distance2(predictedMinor, right.minor) > 1e-9 * scale) return null;
    return Math.atan2(sine, cosine);
}
function circularIntervals(start, span) {
    if (span >= TURN - 1e-10) return [
        [
            0,
            TURN
        ]
    ];
    start = positiveTurn(start);
    const end = start + span;
    return end <= TURN ? [
        [
            start,
            end
        ]
    ] : [
        [
            start,
            TURN
        ],
        [
            0,
            end - TURN
        ]
    ];
}
function coincidentEllipseIntersection(first, second, offset) {
    const left = ellipseParameters(first), right = ellipseParameters(second), rightStart = right.start + offset;
    const leftIntervals = circularIntervals(left.start, left.span), rightIntervals = circularIntervals(rightStart, right.span);
    for (const a of leftIntervals)for (const b of rightIntervals)if (Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 1e-10) return {
        kind: 'overlap',
        points: [],
        infinite: true
    };
    const points = [];
    for (const parameter of [
        left.start,
        left.start + left.span,
        rightStart,
        rightStart + right.span
    ]){
        if (!(left.full || parameterOnEllipse(parameter, left.start, left.span)) || !(right.full || parameterOnEllipse(parameter, rightStart, right.span))) continue;
        const point = ellipsePointAt(first, parameter);
        if (!points.some((value)=>distance2(value, point) <= 1e-9)) points.push(point);
    }
    return {
        kind: points.length ? 'point' : 'none',
        points
    };
}
function ellipseEllipseIntersection(first, second) {
    const coincidentOffset = coincidentEllipseOffset(first.payload, second.payload);
    if (coincidentOffset !== null) return coincidentEllipseIntersection(first.payload, second.payload, coincidentOffset);
    const secondDomain = ellipseParameters(second.payload), secondCenter = point3(second.payload.center);
    const derivativeAt = (parameter)=>{
        const basis = ellipseBasis(first.payload), sine = Math.sin(parameter), cosine = Math.cos(parameter);
        return [
            -basis.major[0] * sine + basis.minor[0] * cosine,
            -basis.major[1] * sine + basis.minor[1] * cosine
        ];
    };
    const evaluate = (parameter)=>{
        const local = ellipseLocalCoordinates(second.payload, ellipsePointAt(first.payload, parameter));
        return local[0] * local[0] + local[1] * local[1] - 1;
    };
    const derivative = (parameter)=>{
        const point = ellipsePointAt(first.payload, parameter), local = ellipseLocalCoordinates(second.payload, point);
        const tangent = derivativeAt(parameter), localTangent = ellipseLocalCoordinates(second.payload, add2(secondCenter, tangent));
        return 2 * (local[0] * localTangent[0] + local[1] * localTangent[1]);
    };
    const points = ellipseParameterRoots(first.payload, evaluate, derivative).flatMap((parameter)=>{
        const point = ellipsePointAt(first.payload, parameter), local = ellipseLocalCoordinates(second.payload, point), secondParameter = Math.atan2(local[1], local[0]);
        return secondDomain.full || parameterOnEllipse(secondParameter, secondDomain.start, secondDomain.span) ? [
            point
        ] : [];
    });
    return {
        kind: points.length ? 'point' : 'none',
        points
    };
}
function intersectionPrimitiveDistance(cursor, primitive) {
    return primitive.kind === 'ellipse' ? nearestOnEllipse(cursor, primitive.payload).distance : nearestOnPrimitive(cursor, primitive).distance;
}
function intersectionPrimitiveBounds(primitive) {
    if (primitive.kind === 'ellipse') {
        const payload = primitive.payload, center = point3(payload.center), major = point3(payload.majorAxis), ratio = Number(payload.ratio);
        const extentX = Math.hypot(major[0], major[1] * ratio), extentY = Math.hypot(major[1], major[0] * ratio);
        return [
            center[0] - extentX,
            center[1] - extentY,
            center[0] + extentX,
            center[1] + extentY
        ];
    }
    if (primitive.kind === 'circle' || primitive.kind === 'arc') {
        const center = point3(primitive.center);
        return [
            center[0] - primitive.radius,
            center[1] - primitive.radius,
            center[0] + primitive.radius,
            center[1] + primitive.radius
        ];
    }
    if (primitive.mode !== 'segment') return null;
    const start = point3(primitive.start), end = point3(primitive.end);
    return [
        Math.min(start[0], end[0]),
        Math.min(start[1], end[1]),
        Math.max(start[0], end[0]),
        Math.max(start[1], end[1])
    ];
}
function finiteBoundsOverlap(first, second) {
    const a = intersectionPrimitiveBounds(first), b = intersectionPrimitiveBounds(second);
    return !a || !b || a[0] <= b[2] + 1e-10 && a[2] + 1e-10 >= b[0] && a[1] <= b[3] + 1e-10 && a[3] + 1e-10 >= b[1];
}
function primitiveIntersection(a, b) {
    let result;
    if (a.kind === 'ellipse' || b.kind === 'ellipse') {
        const ellipse = a.kind === 'ellipse' ? a : b.kind === 'ellipse' ? b : null;
        const line = a.kind === 'line' ? a : b.kind === 'line' ? b : null;
        const circle = a.kind === 'circle' || a.kind === 'arc' ? a : b.kind === 'circle' || b.kind === 'arc' ? b : null;
        if (ellipse && line) return ellipseLineIntersection(ellipse, line);
        if (ellipse && circle) return ellipseCircleIntersection(ellipse, circle);
        return a.kind === 'ellipse' && b.kind === 'ellipse' ? ellipseEllipseIntersection(a, b) : {
            kind: 'unsupported',
            points: []
        };
    } else if (a.kind === 'line' && b.kind === 'line') result = intersectLineLine2(a.start, a.end, b.start, b.end, {
        modeA: a.mode,
        modeB: b.mode
    });
    else if (a.kind === 'line' && (b.kind === 'circle' || b.kind === 'arc')) result = intersectLineCircle2(a.start, a.end, b.center, b.radius, {
        mode: a.mode
    });
    else if (b.kind === 'line' && (a.kind === 'circle' || a.kind === 'arc')) result = intersectLineCircle2(b.start, b.end, a.center, a.radius, {
        mode: b.mode
    });
    else {
        const left = a, right = b;
        result = intersectCircleCircle2(left.center, left.radius, right.center, right.radius);
    }
    return {
        ...result,
        points: (result.points ?? []).filter((point)=>accepts(a, point) && accepts(b, point))
    };
}
function intersectionCandidates(entities, cursor, maxPairs) {
    const primitives = [];
    for (const entity of entities){
        if (entity.type === 'ELLIPSE') primitives.push({
            kind: 'ellipse',
            payload: entity.payload,
            entityId: entity.id
        });
        else primitives.push(...primitiveSegments(entity));
    }
    const ordered = primitives.map((primitive, order)=>({
            primitive,
            order,
            distance: intersectionPrimitiveDistance(cursor, primitive)
        })).sort((a, b)=>a.distance - b.distance || a.order - b.order).map((value)=>value.primitive);
    const result = [];
    let pairs = 0;
    pairSearch: for(let left = 0; left < ordered.length; left += 1)for(let right = left + 1; right < ordered.length; right += 1){
        const a = ordered[left], b = ordered[right];
        if (a.entityId === b.entityId) continue;
        if (!finiteBoundsOverlap(a, b)) continue;
        if (pairs >= maxPairs) break pairSearch;
        pairs += 1;
        for (const point of primitiveIntersection(a, b).points)result.push({
            mode: 'intersection',
            point: point3(point),
            entityIds: [
                a.entityId,
                b.entityId
            ],
            distance: distance2(cursor, point)
        });
    }
    return result;
}
export function findSnapCandidates(document, cursorInput, options = {}) {
    if (!document?.listEntities) throw new KJValidationError('Snapping requires a KJDocument');
    const cursor = vec2(cursorInput, 'cursor');
    const radius = Number(options.radius ?? Infinity);
    if (!(radius > 0)) throw new KJValidationError('Snap radius must be positive');
    const modes = new Set((options.modes ?? KJ_SNAP_MODES).map((value)=>String(value).toLowerCase()));
    for (const mode of modes)if (!KJ_SNAP_MODES.includes(mode)) throw new KJValidationError(`Unsupported snap mode: ${mode}`);
    const reference = options.referencePoint === undefined ? null : vec2(options.referencePoint, 'referencePoint');
    const state = document.snapshot(), spaceId = options.spaceId === undefined ? state.spaces.modelSpaceId : String(options.spaceId);
    if (!spaceId) throw new KJValidationError('Snap spaceId must be a non-empty string');
    const allowed = options.entityIds ? new Set(options.entityIds.map(String)) : null;
    const layers = new Map(document.getTable('layers')?.records.map((layer)=>[
            layer.id,
            layer.payload
        ]) ?? []);
    const entities = document.listEntities({
        ownerId: spaceId
    }).filter((entity)=>{
        if (allowed && !allowed.has(entity.id) || entity.payload.visible === false) return false;
        const layer = layers.get(String(entity.payload.layerId ?? ''));
        return layer?.visible !== false && layer?.frozen !== true;
    });
    let candidates = entities.flatMap((entity)=>baseCandidates(entity, modes, cursor, reference, radius)).map((candidate)=>({
            ...candidate,
            distance: candidate.distance ?? distance2(cursor, candidate.point)
        }));
    if (modes.has('intersection')) {
        const maxIntersectionPairs = Number(options.maxIntersectionPairs ?? 10000);
        if (!Number.isSafeInteger(maxIntersectionPairs) || maxIntersectionPairs <= 0) throw new KJValidationError('maxIntersectionPairs must be a positive safe integer');
        candidates.push(...intersectionCandidates(entities, cursor, maxIntersectionPairs).map((candidate)=>({
                ...candidate,
                distance: candidate.distance ?? distance2(cursor, candidate.point)
            })));
    }
    candidates = candidates.filter((candidate)=>candidate.distance <= radius);
    if (candidates.some((candidate)=>candidate.mode !== 'nearest')) candidates = candidates.filter((candidate)=>candidate.mode !== 'nearest');
    candidates.sort((a, b)=>a.distance - b.distance || KJ_SNAP_MODES.indexOf(a.mode) - KJ_SNAP_MODES.indexOf(b.mode));
    const unique = [];
    for (const candidate of candidates){
        const duplicate = unique.some((value)=>value.mode === candidate.mode && distance2(value.point, candidate.point) <= 1e-9 && value.entityIds.join('|') === candidate.entityIds.join('|'));
        if (!duplicate) unique.push(Object.freeze({
            ...candidate,
            point: Object.freeze(candidate.point),
            entityIds: Object.freeze(candidate.entityIds)
        }));
    }
    return Object.freeze(unique);
}
export function findBestSnap(document, cursor, options = {}) {
    return findSnapCandidates(document, cursor, options)[0] ?? null;
}
export function nearestPointOnEntity2(entity, pointInput) {
    const point = vec2(pointInput, 'point');
    if (entity?.type === 'ELLIPSE') {
        const nearest = nearestOnEllipse(point, entity.payload);
        return Object.freeze({
            point: Object.freeze(point3(nearest.point)),
            distance: nearest.distance,
            parameter: nearest.parameter ?? null,
            segmentIndex: null
        });
    }
    if (entity?.type === 'SPLINE') {
        const nearest = nearestOnSpline(point, entity.payload);
        return Object.freeze({
            point: Object.freeze(point3(nearest.point)),
            distance: nearest.distance,
            parameter: nearest.parameter ?? null,
            segmentIndex: null
        });
    }
    const candidates = primitiveSegments(entity).map((primitive)=>({
            ...nearestOnPrimitive(point, primitive),
            primitive
        }));
    candidates.sort((a, b)=>a.distance - b.distance);
    const nearest = candidates[0];
    if (!nearest) throw new KJValidationError(`Nearest-point query is not implemented for ${entity?.type ?? 'unknown entity'}`);
    return Object.freeze({
        point: Object.freeze(point3(nearest.point)),
        distance: nearest.distance,
        parameter: nearest.parameter ?? null,
        segmentIndex: nearest.primitive.segmentIndex ?? null
    });
}
export function intersectEntityPair2(first, second) {
    if (!first || !second || first.id === second.id) throw new KJValidationError('Intersection query requires two different entities');
    const primitives = (entity)=>entity.type === 'ELLIPSE' ? [
            {
                kind: 'ellipse',
                payload: entity.payload,
                entityId: entity.id
            }
        ] : primitiveSegments(entity);
    const left = primitives(first), right = primitives(second);
    if (!left.length || !right.length) throw new KJValidationError(`Intersection query is not implemented for ${first.type}/${second.type}`);
    const points = [];
    let overlap = false, infinite = false;
    for (const a of left)for (const b of right){
        const result = primitiveIntersection(a, b);
        overlap ||= result.kind === 'overlap';
        infinite ||= Boolean(result.infinite);
        for (const point of result.points)if (!points.some((candidate)=>distance2(candidate, point) <= 1e-9)) points.push(point3(point));
    }
    return Object.freeze({
        kind: overlap ? 'overlap' : points.length ? 'point' : 'none',
        points: Object.freeze(points.map((point)=>Object.freeze(point))),
        infinite
    });
}
