// Generated from agent-drawing.ts by scripts/build-typescript.mjs. Do not edit directly.
import { createId } from './ids.js';
import { KJValidationError } from './errors.js';
import { normalizeSplineDefinition } from './geometry/curves.js';
const xyz = (point)=>[
        point.x,
        point.y,
        0
    ];
const same = (a, b)=>a.x === b.x && a.y === b.y;
export function buildAgentDrawingEntities(input, ownerId) {
    const ellipses = input.ellipses ?? [];
    const splines = input.splines ?? [];
    const total = input.lines.length + input.circles.length + input.arcs.length + ellipses.length + splines.length + input.polylines.length;
    if (total < 1 || total > 64) throw new KJValidationError('A drawing proposal requires 1–64 total entities across all groups');
    if (splines.reduce((sum, spline)=>sum + spline.controlPoints.length, 0) > 1024) throw new KJValidationError('A drawing proposal supports at most 1024 spline control points');
    const entity = (type, payload)=>({
            type,
            payload,
            options: {
                id: createId('entity'),
                ownerId
            }
        });
    return [
        ...input.lines.map((line)=>{
            if (same(line.start, line.end)) throw new KJValidationError('A line requires distinct endpoints');
            return entity('LINE', {
                start: xyz(line.start),
                end: xyz(line.end)
            });
        }),
        ...input.circles.map((circle)=>entity('CIRCLE', {
                center: xyz(circle.center),
                radius: circle.radius
            })),
        ...input.arcs.map((arc)=>{
            if ((arc.endDegrees - arc.startDegrees) % 360 === 0) throw new KJValidationError('An arc requires a nonzero sweep smaller than a full circle; use circles for full circles');
            return entity('ARC', {
                center: xyz(arc.center),
                radius: arc.radius,
                startAngle: arc.startDegrees * Math.PI / 180,
                endAngle: arc.endDegrees * Math.PI / 180,
                clockwise: false
            });
        }),
        ...ellipses.map((ellipse)=>{
            if (same(ellipse.majorAxis, {
                x: 0,
                y: 0
            }) || ellipse.ratio <= 0 || ellipse.ratio > 1) throw new KJValidationError('An ellipse requires a nonzero major axis and a ratio greater than 0 and at most 1');
            if (ellipse.startDegrees === ellipse.endDegrees) throw new KJValidationError('An elliptical arc requires a nonzero sweep; use 0 and 360 for a full ellipse');
            return entity('ELLIPSE', {
                center: xyz(ellipse.center),
                majorAxis: xyz(ellipse.majorAxis),
                ratio: ellipse.ratio,
                startParameter: ellipse.startDegrees * Math.PI / 180,
                endParameter: ellipse.endDegrees * Math.PI / 180
            });
        }),
        ...splines.map((spline)=>{
            const normalized = normalizeSplineDefinition({
                degree: spline.degree,
                controlPoints: spline.controlPoints.map((point)=>[
                        point.x,
                        point.y
                    ]),
                ...spline.knots ? {
                    knots: spline.knots
                } : {},
                ...spline.weights ? {
                    weights: spline.weights
                } : {}
            });
            return entity('SPLINE', {
                degree: normalized.degree,
                controlPoints: normalized.controlPoints.map((point)=>[
                        point[0],
                        point[1],
                        0
                    ]),
                knots: normalized.knots,
                ...normalized.weights.length ? {
                    weights: normalized.weights
                } : {},
                closed: false,
                periodic: false
            });
        }),
        ...input.polylines.map((polyline)=>{
            const points = polyline.vertices;
            if (polyline.closed && points.length < 3) throw new KJValidationError('A closed polyline requires at least three vertices');
            if (points.some((point, index)=>index > 0 && same(point, points[index - 1])) || polyline.closed && same(points[0], points[points.length - 1])) throw new KJValidationError('Polyline vertices must not create zero-length segments; closed polylines close automatically');
            return entity('LWPOLYLINE', {
                vertices: points.map(xyz),
                closed: polyline.closed
            });
        })
    ];
}
