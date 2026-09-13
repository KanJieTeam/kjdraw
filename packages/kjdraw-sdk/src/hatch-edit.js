// Generated from hatch-edit.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { intersectCircleCircle2, intersectLineCircle2, intersectLineLine2 } from './geometry/intersections.js';
import { closedHatchSplineConic, normalizeHatchSplineEdge } from './geometry/hatch-boundary.js';
const TAU = Math.PI * 2;
function fail(message) {
    throw new KJValidationError(`HATCHEDIT: ${message}`);
}
function point(value, index) {
    const source = Array.isArray(value) ? value : value && typeof value === 'object' ? value.point : null;
    if (!Array.isArray(source) || source.length < 2 || source.length > 3) return fail(`island vertex ${index} must contain finite x,y coordinates`);
    const result = [
        Number(source[0]),
        Number(source[1]),
        Number(source[2] ?? 0)
    ];
    if (!result.every(Number.isFinite) || result[2] !== 0) return fail(`island vertex ${index} must be finite XY at Z=0`);
    return result;
}
const cross = (a, b, c)=>(b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (a, b)=>a[0] === b[0] && a[1] === b[1];
const distance = (a, b)=>Math.hypot(a[0] - b[0], a[1] - b[1]);
const normalizeAngle = (value)=>(value % TAU + TAU) % TAU;
const directedSweep = (edge)=>{
    const raw = edge.counterClockwise ? edge.endAngle - edge.startAngle : edge.startAngle - edge.endAngle;
    if (Math.abs(raw) >= TAU - 1e-12) return TAU;
    return normalizeAngle(raw);
};
const ellipsePoint = (edge, atEnd = false)=>{
    const angle = atEnd ? edge.endAngle : edge.startAngle, ux = edge.majorAxis[0], uy = edge.majorAxis[1];
    return [
        edge.center[0] + ux * Math.cos(angle) - uy * edge.ratio * Math.sin(angle),
        edge.center[1] + uy * Math.cos(angle) + ux * edge.ratio * Math.sin(angle),
        0
    ];
};
const arcPoint = (edge, atEnd = false)=>{
    const angle = atEnd ? edge.endAngle : edge.startAngle;
    return [
        edge.center[0] + edge.radius * Math.cos(angle),
        edge.center[1] + edge.radius * Math.sin(angle),
        0
    ];
};
const arcPointAt = (edge, progress)=>{
    const angle = edge.startAngle + (edge.counterClockwise ? progress : -progress);
    return [
        edge.center[0] + edge.radius * Math.cos(angle),
        edge.center[1] + edge.radius * Math.sin(angle),
        0
    ];
};
const edgeStart = (edge)=>edge.type === 'LINE' ? edge.start : edge.type === 'ARC' ? arcPoint(edge) : ellipsePoint(edge);
const edgeEnd = (edge)=>edge.type === 'LINE' ? edge.end : edge.type === 'ARC' ? arcPoint(edge, true) : ellipsePoint(edge, true);
const between = (a, b, c)=>c >= Math.min(a, b) - 1e-10 && c <= Math.max(a, b) + 1e-10;
const onSegment = (a, b, p)=>Math.abs(cross(a, b, p)) <= 1e-10 && between(a[0], b[0], p[0]) && between(a[1], b[1], p[1]);
function segmentsIntersect(a, b, c, d) {
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    if ((abC > 1e-10 && abD < -1e-10 || abC < -1e-10 && abD > 1e-10) && (cdA > 1e-10 && cdB < -1e-10 || cdA < -1e-10 && cdB > 1e-10)) return true;
    return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
function polygonArea(points) {
    return points.reduce((sum, a, index)=>{
        const b = points[(index + 1) % points.length];
        return sum + a[0] * b[1] - b[0] * a[1];
    }, 0) / 2;
}
function parseEdge(value, index) {
    const edge = value;
    const type = String(edge?.type ?? '').toUpperCase();
    if (type === 'LINE') {
        const start = point(edge.start, index), end = point(edge.end, index);
        if (same(start, end)) return fail('LINE boundary edges must not be degenerate');
        return {
            type: 'LINE',
            start,
            end
        };
    }
    if (type === 'ARC') {
        const center = point(edge.center, index), radius = Number(edge.radius), startAngle = Number(edge.startAngle), endAngle = Number(edge.endAngle);
        if (!(radius > 0) || ![
            radius,
            startAngle,
            endAngle
        ].every(Number.isFinite)) return fail('ARC boundary edges require a positive radius and finite angles');
        const result = {
            type: 'ARC',
            center,
            radius,
            startAngle,
            endAngle,
            counterClockwise: edge.counterClockwise !== false
        };
        if (directedSweep(result) <= 1e-12) return fail('ARC boundary edges must have a non-zero sweep; use a CIRCLE source for a full circle');
        return result;
    }
    if (type === 'ELLIPSE') {
        const center = point(edge.center, index), majorAxis = point(edge.majorAxis, index), ratio = Number(edge.ratio), startAngle = Number(edge.startAngle ?? 0), endAngle = Number(edge.endAngle ?? TAU);
        if (Math.hypot(majorAxis[0], majorAxis[1]) <= 1e-15 || majorAxis[2] !== 0 || !(ratio > 0 && ratio <= 1) || ![
            ratio,
            startAngle,
            endAngle
        ].every(Number.isFinite)) return fail('ELLIPSE boundary edges require a non-zero XY major axis, ratio in (0,1], and finite angles');
        const result = {
            type: 'ELLIPSE',
            center,
            majorAxis,
            ratio,
            startAngle,
            endAngle,
            counterClockwise: edge.counterClockwise !== false
        };
        if (directedSweep(result) < TAU - 1e-12) return fail('open ELLIPSE arcs cannot form a boundary by themselves; join a rigorously closed supported boundary first');
        return result;
    }
    if (type === 'SPLINE') {
        const conic = closedHatchSplineConic(edge);
        if (!conic) return fail('SPLINE hatch boundaries require the exact closed rational-quadratic conic contract');
        return {
            type: 'ELLIPSE',
            ...conic,
            startAngle: 0,
            endAngle: TAU
        };
    }
    return fail('exact hatch island boundaries support only LINE, ARC, full ELLIPSE and verified closed SPLINE edges');
}
function exactLoopEdges(loop) {
    if (Array.isArray(loop.vertices)) {
        const vertices = [];
        for (const [index, value] of loop.vertices.entries()){
            const vertex = value;
            if (!Array.isArray(value) && Number(vertex.bulge ?? 0) !== 0) return fail('bulge and SPLINE hatch boundaries cannot be validated for exact curve-island editing');
            vertices.push(point(value, index));
        }
        if (vertices.length < 3) return fail('polygon hatch boundaries require at least three vertices');
        return vertices.map((start, index)=>({
                type: 'LINE',
                start,
                end: vertices[(index + 1) % vertices.length]
            }));
    }
    if (!Array.isArray(loop.edges) || !loop.edges.length) return fail('hatch boundary loop has no exact LINE/ARC geometry');
    return loop.edges.map(parseEdge);
}
function arcContains(edge, value, includeEnd = true) {
    const radial = Math.hypot(value[0] - edge.center[0], value[1] - edge.center[1]);
    if (Math.abs(radial - edge.radius) > 1e-8 * Math.max(1, edge.radius)) return false;
    const angle = Math.atan2(value[1] - edge.center[1], value[0] - edge.center[0]), sweep = directedSweep(edge);
    if (sweep >= TAU - 1e-12) return true;
    const progress = normalizeAngle(edge.counterClockwise ? angle - edge.startAngle : edge.startAngle - angle);
    return progress <= sweep + (includeEnd ? 1e-10 : -1e-10);
}
function lineEllipseIntersections(line, ellipse) {
    const ux = ellipse.majorAxis[0], uy = ellipse.majorAxis[1], scale = ux * ux + uy * uy, ratio = ellipse.ratio;
    const local = (p)=>{
        const x = p[0] - ellipse.center[0], y = p[1] - ellipse.center[1];
        return [
            (x * ux + y * uy) / scale,
            (-x * uy + y * ux) / (scale * ratio)
        ];
    };
    const a = local(line.start), b = local(line.end), dx = b[0] - a[0], dy = b[1] - a[1], qa = dx * dx + dy * dy, qb = 2 * (a[0] * dx + a[1] * dy), qc = a[0] * a[0] + a[1] * a[1] - 1, disc = qb * qb - 4 * qa * qc;
    if (!(qa > 0) || disc < -1e-12) return [];
    const root = Math.sqrt(Math.max(0, disc)), values = [
        (-qb - root) / (2 * qa),
        (-qb + root) / (2 * qa)
    ];
    return values.filter((t, index)=>t >= -1e-10 && t <= 1 + 1e-10 && values.findIndex((v)=>Math.abs(v - t) <= 1e-10) === index).map((t)=>[
            line.start[0] + (line.end[0] - line.start[0]) * t,
            line.start[1] + (line.end[1] - line.start[1]) * t,
            0
        ]);
}
function edgeIntersections(first, second) {
    if (first.type === 'ELLIPSE' || second.type === 'ELLIPSE') {
        if (first.type === 'LINE' && second.type === 'ELLIPSE') return {
            overlap: false,
            points: lineEllipseIntersections(first, second)
        };
        if (first.type === 'ELLIPSE' && second.type === 'LINE') return {
            overlap: false,
            points: lineEllipseIntersections(second, first)
        };
        return fail('exact ELLIPSE boundary validation currently supports intersections with LINE edges; ARC/ELLIPSE combinations are refused');
    }
    let result;
    if (first.type === 'LINE' && second.type === 'LINE') result = intersectLineLine2(first.start, first.end, second.start, second.end);
    else if (first.type === 'LINE' && second.type === 'ARC') result = intersectLineCircle2(first.start, first.end, second.center, second.radius, {
        mode: 'segment'
    });
    else if (first.type === 'ARC' && second.type === 'LINE') result = intersectLineCircle2(second.start, second.end, first.center, first.radius, {
        mode: 'segment'
    });
    else {
        const a = first, b = second;
        result = intersectCircleCircle2(a.center, a.radius, b.center, b.radius);
        if (result.kind === 'overlap') {
            const overlap = arcContains(b, arcPointAt(a, directedSweep(a) / 2), false) || arcContains(a, arcPointAt(b, directedSweep(b) / 2), false);
            const endpoints = [
                edgeStart(a),
                edgeEnd(a),
                edgeStart(b),
                edgeEnd(b)
            ].filter((value)=>arcContains(a, value) && arcContains(b, value));
            return {
                overlap,
                points: endpoints.filter((value, index)=>endpoints.findIndex((candidate)=>distance(candidate, value) <= 1e-8 * Math.max(1, a.radius, b.radius)) === index)
            };
        }
    }
    const points = result.points.filter((value)=>(first.type === 'LINE' || arcContains(first, value)) && (second.type === 'LINE' || arcContains(second, value))).map((value)=>[
            value[0],
            value[1],
            0
        ]);
    return {
        overlap: result.kind === 'overlap',
        points: points.filter((value, index)=>points.findIndex((candidate)=>distance(candidate, value) <= 1e-8 * Math.max(1, distance(candidate, [
                    0,
                    0,
                    0
                ]))) === index)
    };
}
function reverseEdge(edge) {
    return edge.type === 'LINE' ? {
        type: 'LINE',
        start: edge.end,
        end: edge.start
    } : {
        ...edge,
        startAngle: edge.endAngle,
        endAngle: edge.startAngle,
        counterClockwise: !edge.counterClockwise
    };
}
function loopScale(edges) {
    const values = edges.flatMap((edge)=>edge.type === 'LINE' ? [
            ...edge.start,
            ...edge.end
        ] : edge.type === 'ARC' ? [
            ...edge.center,
            edge.radius
        ] : [
            ...edge.center,
            ...edge.majorAxis,
            edge.ratio
        ]);
    return Math.max(1, ...values.map(Math.abs));
}
function validateClosedLoop(edges) {
    if (!edges.length || edges.length > 128) return fail('exact hatch island boundary requires 1–128 LINE/ARC edges');
    const tolerance = 1e-8 * loopScale(edges);
    for(let index = 0; index < edges.length; index++)if (distance(edgeEnd(edges[index]), edgeStart(edges[(index + 1) % edges.length])) > tolerance) return fail('selected exact boundary is not closed end-to-end');
    if (edges.length === 1) {
        const only = edges[0];
        if (only.type === 'LINE' || directedSweep(only) < TAU - 1e-12) return fail('a one-edge island must be a full CIRCLE or ELLIPSE boundary');
        return;
    }
    for(let i = 0; i < edges.length; i++)for(let j = i + 1; j < edges.length; j++){
        const adjacent = j === i + 1 || i === 0 && j === edges.length - 1, intersection = edgeIntersections(edges[i], edges[j]);
        if (intersection.overlap) return fail('selected LINE/ARC boundary overlaps itself');
        if (!intersection.points.length) continue;
        const shared = j === i + 1 ? [
            edgeEnd(edges[i])
        ] : i === 0 && j === edges.length - 1 ? [
            edgeStart(edges[i])
        ] : [];
        if (edges.length === 2) shared.push(edgeStart(edges[i]));
        if (!adjacent || intersection.points.some((value)=>!shared.some((point)=>distance(value, point) <= tolerance))) return fail('selected LINE/ARC boundary self-intersects');
    }
    let area = 0;
    for (const edge of edges){
        if (edge.type === 'LINE') area += (edge.start[0] * edge.end[1] - edge.end[0] * edge.start[1]) / 2;
        else if (edge.type === 'ARC') {
            const signed = (edge.counterClockwise ? 1 : -1) * directedSweep(edge);
            area += (edge.radius * (edge.center[0] * (Math.sin(edge.endAngle) - Math.sin(edge.startAngle)) - edge.center[1] * (Math.cos(edge.endAngle) - Math.cos(edge.startAngle))) + edge.radius * edge.radius * signed) / 2;
        } else area += (edge.counterClockwise ? 1 : -1) * Math.PI * Math.hypot(edge.majorAxis[0], edge.majorAxis[1]) ** 2 * edge.ratio;
    }
    if (Math.abs(area) <= 1e-12 * loopScale(edges) ** 2) return fail('selected exact boundary encloses zero area');
}
function pointInExactLoop(value, edges) {
    if (edges.length === 1 && edges[0]?.type === 'ELLIPSE') {
        const edge = edges[0], ux = edge.majorAxis[0], uy = edge.majorAxis[1], scale = ux * ux + uy * uy, x = value[0] - edge.center[0], y = value[1] - edge.center[1];
        const a = (x * ux + y * uy) / scale, b = (-x * uy + y * ux) / (scale * edge.ratio), q = a * a + b * b;
        return q < 1 - 1e-10;
    }
    let inside = false;
    for (const edge of edges){
        if (edge.type === 'LINE') {
            if (onSegment(edge.start, edge.end, value)) return false;
            if (edge.start[1] > value[1] !== edge.end[1] > value[1] && value[0] < (edge.end[0] - edge.start[0]) * (value[1] - edge.start[1]) / (edge.end[1] - edge.start[1]) + edge.start[0]) inside = !inside;
            continue;
        }
        if (edge.type === 'ELLIPSE') return fail('mixed ELLIPSE boundary chains are not supported for exact point classification');
        if (arcContains(edge, value)) return false;
        const dy = value[1] - edge.center[1];
        if (Math.abs(dy) >= edge.radius) continue;
        const dx = Math.sqrt(Math.max(0, edge.radius * edge.radius - dy * dy));
        for (const x of [
            edge.center[0] - dx,
            edge.center[0] + dx
        ]){
            if (x <= value[0]) continue;
            const angle = Math.atan2(dy, x - edge.center[0]), sweep = directedSweep(edge), progress = normalizeAngle(edge.counterClockwise ? angle - edge.startAngle : edge.startAngle - angle);
            if (progress < sweep - 1e-10 && Math.abs(Math.cos(angle)) > 1e-10) inside = !inside;
        }
    }
    return inside;
}
function exactLoopsIntersect(first, second) {
    return first.some((a)=>second.some((b)=>{
            const result = edgeIntersections(a, b);
            return result.overlap || result.points.length > 0;
        }));
}
function sourceIsland(document, value) {
    if (!Array.isArray(value) || !value.length || value.length > 128) return fail('sourceIds must contain one full ELLIPSE/CIRCLE or 1–128 LINE/ARC entities');
    const ids = value.map(String);
    if (new Set(ids).size !== ids.length) return fail('sourceIds must not contain duplicates');
    const entities = ids.map((id)=>{
        const entity = document.getObject(id);
        if (!entity || entity.kind !== 'entity' || entity.erased) return fail('every sourceId must identify a live boundary entity');
        return entity;
    });
    if (entities.length === 1 && entities[0].type === 'CIRCLE') {
        const payload = entities[0].payload, center = point(payload.center, 0), radius = Number(payload.radius), normal = payload.normal;
        if (!(radius > 0) || !Number.isFinite(radius) || normal && (!Array.isArray(normal) || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) return fail('CIRCLE source must be a finite XY circle with +Z normal');
        return {
            external: false,
            closed: true,
            edges: [
                {
                    type: 'ARC',
                    center,
                    radius,
                    startAngle: 0,
                    endAngle: TAU,
                    counterClockwise: true
                }
            ]
        };
    }
    if (entities.length === 1 && entities[0].type === 'ELLIPSE') {
        const payload = entities[0].payload, center = point(payload.center, 0), majorAxis = point(payload.majorAxis, 0), ratio = Number(payload.ratio), startAngle = Number(payload.startParameter ?? 0), endAngle = Number(payload.endParameter ?? TAU);
        if (center[2] !== 0 || majorAxis[2] !== 0 || Math.hypot(majorAxis[0], majorAxis[1]) <= 1e-15 || !(ratio > 0 && ratio <= 1) || ![
            ratio,
            startAngle,
            endAngle
        ].every(Number.isFinite)) return fail('ELLIPSE source must be a finite non-degenerate XY ellipse');
        const edge = {
            type: 'ELLIPSE',
            center,
            majorAxis,
            ratio,
            startAngle,
            endAngle,
            counterClockwise: true
        };
        if (directedSweep(edge) < TAU - 1e-12) return fail('open ELLIPSE arc sources are not closed hatch boundaries');
        return {
            external: false,
            closed: true,
            edges: [
                {
                    ...edge,
                    startAngle: 0,
                    endAngle: TAU
                }
            ]
        };
    }
    if (entities.length === 1 && entities[0].type === 'SPLINE') {
        const payload = entities[0].payload;
        if (payload.closed !== true) return fail('SPLINE source must be explicitly closed');
        let edge;
        try {
            edge = normalizeHatchSplineEdge(payload, 'HATCHEDIT SPLINE source');
        } catch (error) {
            return fail(error instanceof Error ? error.message : 'SPLINE source is invalid');
        }
        if (!closedHatchSplineConic(edge)) return fail('SPLINE source must be a verified closed rational-quadratic conic without fit points');
        return {
            external: false,
            closed: true,
            edges: [
                edge
            ]
        };
    }
    if (entities.some((entity)=>entity.type === 'CIRCLE' || entity.type === 'ELLIPSE' || entity.type === 'SPLINE')) return fail('a CIRCLE, ELLIPSE or SPLINE source must be selected by itself');
    const unordered = entities.map((entity, index)=>{
        const payload = entity.payload, normal = payload.normal;
        if (normal && (!Array.isArray(normal) || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) return fail('boundary sources must use the model XY plane with +Z normal');
        if (entity.type === 'LINE') return parseEdge({
            type: 'LINE',
            start: payload.start,
            end: payload.end
        }, index);
        if (entity.type === 'ARC') return parseEdge({
            type: 'ARC',
            center: payload.center,
            radius: payload.radius,
            startAngle: payload.startAngle,
            endAngle: payload.endAngle,
            counterClockwise: payload.clockwise !== true
        }, index);
        return fail('sourceIds support only a full CIRCLE/ELLIPSE, verified closed SPLINE, or a closed chain of LINE/ARC entities');
    });
    const tolerance = 1e-8 * loopScale(unordered), ordered = [
        unordered.shift()
    ];
    while(unordered.length){
        const end = edgeEnd(ordered.at(-1)), matches = unordered.flatMap((edge, index)=>[
                [
                    index,
                    false,
                    distance(end, edgeStart(edge))
                ],
                [
                    index,
                    true,
                    distance(end, edgeEnd(edge))
                ]
            ]).filter((match)=>match[2] <= tolerance);
        if (matches.length !== 1) return fail(matches.length ? 'selected LINE/ARC boundary has an ambiguous branch' : 'selected LINE/ARC boundary is open or disconnected');
        const [index, reversed] = matches[0], next = unordered.splice(index, 1)[0];
        ordered.push(reversed ? reverseEdge(next) : next);
    }
    validateClosedLoop(ordered);
    return {
        external: false,
        closed: true,
        edges: ordered
    };
}
function normalizedIsland(vertices) {
    if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length > 4096) return fail('a closed polygon island requires 3–4096 vertices');
    const points = vertices.map(point);
    if (points.some((value, index)=>same(value, points[(index + 1) % points.length]))) return fail('island has duplicate consecutive vertices');
    const xs = points.map((value)=>value[0]), ys = points.map((value)=>value[1]), scale = Math.max(1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (Math.abs(polygonArea(points)) <= 1e-12 * scale * scale) return fail('island polygon is degenerate');
    for(let i = 0; i < points.length; i++)for(let j = i + 1; j < points.length; j++){
        if (j === i + 1 || i === 0 && j === points.length - 1) continue;
        if (segmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return fail('island polygon self-intersects');
    }
    return {
        external: false,
        closed: true,
        vertices: points
    };
}
function islandIndex(loops, value) {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= loops.length || loops[index]?.external !== false) return fail('loopIndex must identify an existing inner island boundary');
    return index;
}
function validateIslandPlacement(loops, candidate, ignoredIndex = -1) {
    const candidateEdges = exactLoopEdges(candidate);
    validateClosedLoop(candidateEdges);
    const outerLoops = loops.filter((loop)=>loop.external !== false).map(exactLoopEdges);
    if (!outerLoops.some((outer)=>!exactLoopsIntersect(candidateEdges, outer) && pointInExactLoop(edgeStart(candidateEdges[0]), outer))) return fail('island must lie strictly inside an exact closed outer boundary');
    for (const [index, loop] of loops.entries()){
        if (index === ignoredIndex || loop.external !== false) continue;
        const other = exactLoopEdges(loop);
        validateClosedLoop(other);
        if (exactLoopsIntersect(candidateEdges, other) || pointInExactLoop(edgeStart(candidateEdges[0]), other) || pointInExactLoop(edgeStart(other[0]), candidateEdges)) return fail('island boundaries must not intersect, overlap or contain each other');
    }
}
export function editHatch(document, transaction, id, input) {
    const hatch = document.getObject(String(id));
    if (!hatch || hatch.kind !== 'entity' || hatch.type !== 'HATCH' || hatch.erased) return fail('requires a live HATCH id');
    if (![
        'update-pattern',
        'add-island',
        'replace-island',
        'remove-island'
    ].includes(input.operation)) return fail('operation is unsupported');
    const loops = [
        ...hatch.payload.boundaryLoops ?? []
    ];
    if (!loops.length) return fail('hatch has no boundary loops');
    if (loops.length > 128) return fail('hatch boundary editing supports at most 128 loops');
    if (input.patternScale != null) {
        const scale = Number(input.patternScale);
        if (!Number.isFinite(scale) || scale <= 0) return fail('patternScale must be a positive finite number');
    }
    if (input.patternAngle != null && !Number.isFinite(Number(input.patternAngle))) return fail('patternAngle must be finite radians');
    if (input.operation === 'add-island') {
        if (loops.length >= 128) return fail('hatch already has 128 boundary loops');
        if (input.sourceIds != null && input.vertices != null) return fail('use either sourceIds or vertices for one island edit');
        const candidate = input.sourceIds != null ? sourceIsland(document, input.sourceIds) : normalizedIsland(input.vertices);
        validateIslandPlacement(loops, candidate);
        loops.push(candidate);
    } else if (input.operation === 'replace-island') {
        if (input.sourceIds != null && input.vertices != null) return fail('use either sourceIds or vertices for one island edit');
        const index = islandIndex(loops, input.loopIndex), candidate = input.sourceIds != null ? sourceIsland(document, input.sourceIds) : normalizedIsland(input.vertices);
        validateIslandPlacement(loops, candidate, index);
        loops[index] = candidate;
    } else if (input.operation === 'remove-island') loops.splice(islandIndex(loops, input.loopIndex), 1);
    const patch = {
        boundaryLoops: loops
    };
    if (input.patternScale != null) patch.patternScale = Number(input.patternScale);
    if (input.patternAngle != null) patch.patternAngle = Number(input.patternAngle);
    return transaction.updateObject(hatch.id, {
        payload: patch
    });
}
