// Generated from intersections.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from '../errors.js';
import { invokeGeometryBackend } from './backend.js';
import { DEFAULT_TOLERANCE } from './tolerance.js';
import { add2, cross2, distance2, dot2, lengthSquared2, multiply2, subtract2, vec2 } from './vector2.js';
function inDomain(parameter, mode, tolerance) {
    const epsilon = tolerance.distanceFor(parameter);
    if (mode === 'line') return true;
    if (mode === 'ray') return parameter >= -epsilon;
    if (mode === 'segment') return parameter >= -epsilon && parameter <= 1 + epsilon;
    throw new KJValidationError(`Unknown line domain: ${String(mode)}`);
}
const none = ()=>({
        kind: 'none',
        points: [],
        parametersA: [],
        parametersB: []
    });
function intersectLineLineReference2(a0, a1, b0, b1, options = {}) {
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const modeA = options.modeA ?? 'segment';
    const modeB = options.modeB ?? 'segment';
    const startA = vec2(a0);
    const endA = vec2(a1);
    const startB = vec2(b0);
    const endB = vec2(b1);
    const r = subtract2(endA, startA);
    const s = subtract2(endB, startB);
    const rr = lengthSquared2(r);
    const ss = lengthSquared2(s);
    if (tolerance.zero(rr) || tolerance.zero(ss)) {
        throw new KJValidationError('Line intersection requires non-zero directions');
    }
    const denominator = cross2(r, s);
    const offset = subtract2(startB, startA);
    const scale = Math.sqrt(rr * ss);
    if (tolerance.zero(denominator, scale)) {
        if (!tolerance.zero(cross2(offset, r), Math.sqrt(rr) * Math.max(distance2(startA, startB), 1))) {
            return none();
        }
        if (modeA !== 'segment' || modeB !== 'segment') {
            return {
                kind: 'overlap',
                points: [],
                parametersA: [],
                parametersB: [],
                infinite: true
            };
        }
        const axis = Math.abs(r[0]) >= Math.abs(r[1]) ? 0 : 1;
        const t0 = (startB[axis] - startA[axis]) / r[axis];
        const t1 = (endB[axis] - startA[axis]) / r[axis];
        const start = Math.max(0, Math.min(t0, t1));
        const end = Math.min(1, Math.max(t0, t1));
        if (end < start - tolerance.distanceFor(start, end)) return none();
        const points = [
            add2(startA, multiply2(r, start))
        ];
        if (!tolerance.equal(start, end)) points.push(add2(startA, multiply2(r, end)));
        return {
            kind: points.length === 1 ? 'point' : 'overlap',
            points,
            parametersA: points.length === 1 ? [
                start
            ] : [
                start,
                end
            ],
            parametersB: []
        };
    }
    const parameterA = cross2(offset, s) / denominator;
    const parameterB = cross2(offset, r) / denominator;
    if (!inDomain(parameterA, modeA, tolerance) || !inDomain(parameterB, modeB, tolerance)) return none();
    return {
        kind: 'point',
        points: [
            add2(startA, multiply2(r, parameterA))
        ],
        parametersA: [
            parameterA
        ],
        parametersB: [
            parameterB
        ]
    };
}
function intersectLineCircleReference2(start, end, center, radius, options = {}) {
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const mode = options.mode ?? 'segment';
    const resolvedStart = vec2(start);
    const resolvedEnd = vec2(end);
    const resolvedCenter = vec2(center);
    const resolvedRadius = Number(radius);
    if (!Number.isFinite(resolvedRadius) || resolvedRadius < 0) {
        throw new KJValidationError('Circle radius must be non-negative');
    }
    const direction = subtract2(resolvedEnd, resolvedStart);
    const a = lengthSquared2(direction);
    if (tolerance.zero(a)) throw new KJValidationError('Line-circle intersection requires a non-zero line');
    const relative = subtract2(resolvedStart, resolvedCenter);
    const b = 2 * dot2(relative, direction);
    const c = lengthSquared2(relative) - resolvedRadius * resolvedRadius;
    let discriminant = b * b - 4 * a * c;
    const threshold = tolerance.distanceFor(b * b, 4 * a * c);
    if (discriminant < -threshold) return none();
    if (Math.abs(discriminant) <= threshold) discriminant = 0;
    const root = Math.sqrt(Math.max(0, discriminant));
    const candidates = discriminant === 0 ? [
        -b / (2 * a)
    ] : [
        (-b - root) / (2 * a),
        (-b + root) / (2 * a)
    ];
    const parameters = candidates.filter((parameter)=>inDomain(parameter, mode, tolerance)).sort((x, y)=>x - y);
    return parameters.length ? {
        kind: 'point',
        points: parameters.map((parameter)=>add2(resolvedStart, multiply2(direction, parameter))),
        parametersA: parameters,
        parametersB: []
    } : none();
}
function intersectCircleCircleReference2(centerA, radiusA, centerB, radiusB, options = {}) {
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const resolvedCenterA = vec2(centerA);
    const resolvedCenterB = vec2(centerB);
    const resolvedRadiusA = Number(radiusA);
    const resolvedRadiusB = Number(radiusB);
    if (![
        resolvedRadiusA,
        resolvedRadiusB
    ].every((value)=>Number.isFinite(value) && value >= 0)) {
        throw new KJValidationError('Circle radii must be non-negative');
    }
    const difference = subtract2(resolvedCenterB, resolvedCenterA);
    const distance = Math.sqrt(lengthSquared2(difference));
    const epsilon = tolerance.distanceFor(distance, resolvedRadiusA, resolvedRadiusB);
    if (distance <= epsilon && Math.abs(resolvedRadiusA - resolvedRadiusB) <= epsilon) {
        return {
            kind: 'overlap',
            points: [],
            parametersA: [],
            parametersB: [],
            infinite: true
        };
    }
    if (distance > resolvedRadiusA + resolvedRadiusB + epsilon || distance < Math.abs(resolvedRadiusA - resolvedRadiusB) - epsilon || distance <= epsilon) return none();
    const along = (resolvedRadiusA * resolvedRadiusA - resolvedRadiusB * resolvedRadiusB + distance * distance) / (2 * distance);
    let heightSquared = resolvedRadiusA * resolvedRadiusA - along * along;
    if (heightSquared < 0 && Math.abs(heightSquared) <= epsilon * epsilon) heightSquared = 0;
    if (heightSquared < 0) return none();
    const unit = multiply2(difference, 1 / distance);
    const base = add2(resolvedCenterA, multiply2(unit, along));
    if (heightSquared === 0) {
        return {
            kind: 'point',
            points: [
                base
            ],
            parametersA: [],
            parametersB: []
        };
    }
    const normal = [
        -unit[1],
        unit[0]
    ];
    const height = Math.sqrt(heightSquared);
    return {
        kind: 'point',
        points: [
            add2(base, multiply2(normal, height)),
            add2(base, multiply2(normal, -height))
        ],
        parametersA: [],
        parametersB: []
    };
}
function orientationReference2(a, b, c, options = {}) {
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const resolvedA = vec2(a);
    const resolvedB = vec2(b);
    const resolvedC = vec2(c);
    const ab = subtract2(resolvedB, resolvedA);
    const ac = subtract2(resolvedC, resolvedA);
    const determinant = cross2(ab, ac);
    const scale = Math.sqrt(lengthSquared2(ab) * lengthSquared2(ac));
    return tolerance.zero(determinant, scale) ? 0 : determinant > 0 ? 1 : -1;
}
export function orientation2(a, b, c, options = {}) {
    return invokeGeometryBackend('orientation2', [
        a,
        b,
        c,
        options
    ], ()=>orientationReference2(a, b, c, options));
}
export function intersectLineLine2(a0, a1, b0, b1, options = {}) {
    return invokeGeometryBackend('intersectLineLine2', [
        a0,
        a1,
        b0,
        b1,
        options
    ], ()=>intersectLineLineReference2(a0, a1, b0, b1, options));
}
export function intersectLineCircle2(start, end, center, radius, options = {}) {
    return invokeGeometryBackend('intersectLineCircle2', [
        start,
        end,
        center,
        radius,
        options
    ], ()=>intersectLineCircleReference2(start, end, center, radius, options));
}
export function intersectCircleCircle2(centerA, radiusA, centerB, radiusB, options = {}) {
    return invokeGeometryBackend('intersectCircleCircle2', [
        centerA,
        radiusA,
        centerB,
        radiusB,
        options
    ], ()=>intersectCircleCircleReference2(centerA, radiusA, centerB, radiusB, options));
}
export function closestPointOnCircle2(point, center, radius, tolerance = DEFAULT_TOLERANCE) {
    const resolvedPoint = vec2(point);
    const resolvedCenter = vec2(center);
    const resolvedRadius = Number(radius);
    const radial = subtract2(resolvedPoint, resolvedCenter);
    const magnitude = Math.sqrt(lengthSquared2(radial));
    const unit = tolerance.zero(magnitude) ? [
        1,
        0
    ] : multiply2(radial, 1 / magnitude);
    const closest = add2(resolvedCenter, multiply2(unit, resolvedRadius));
    return {
        point: closest,
        distance: distance2(resolvedPoint, closest),
        angle: Math.atan2(unit[1], unit[0])
    };
}
