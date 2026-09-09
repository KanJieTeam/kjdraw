// Generated from agent-drawing.ts by scripts/build-typescript.mjs. Do not edit directly.
import { createId } from './ids.js';
import { KJValidationError } from './errors.js';
const xyz = (point)=>[
        point.x,
        point.y,
        0
    ];
const same = (a, b)=>a.x === b.x && a.y === b.y;
export function buildAgentDrawingEntities(input, ownerId) {
    const total = input.lines.length + input.circles.length + input.arcs.length + input.polylines.length;
    if (total < 1 || total > 64) throw new KJValidationError('A drawing proposal requires 1–64 total entities across all groups');
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
