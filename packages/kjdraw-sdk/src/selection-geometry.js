// Generated from selection-geometry.ts by scripts/build-typescript.mjs. Do not edit directly.
import { arcSweep, multiply3, rotation3, scale3, transformEntityPayload, translation3 } from './geometry/index.js';
import { normalizeSplineDefinition, splinePoint2 } from './geometry/curves.js';
import { projectDimension } from './geometry/annotation.js';
import { hatchPatternLines } from './geometry/hatch.js';
const TAU = Math.PI * 2;
const point = (value)=>Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every((v)=>Number.isFinite(Number(v))) ? [
        Number(value[0]),
        Number(value[1])
    ] : null;
const finite = (value, fallback = 0)=>value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
const add = (a, b, t = 1)=>[
        a[0] + b[0] * t,
        a[1] + b[1] * t
    ];
const sub = (a, b)=>[
        a[0] - b[0],
        a[1] - b[1]
    ];
const cross = (a, b)=>a[0] * b[1] - a[1] * b[0];
const dot = (a, b)=>a[0] * b[0] + a[1] * b[1];
const mod = (a)=>(a % TAU + TAU) % TAU;
const curveAt = (c, angle)=>add(add(c.center, c.u, Math.cos(angle)), c.v, Math.sin(angle));
const angleOn = (c, angle)=>Math.abs(c.sweep) >= TAU - 1e-10 || mod((angle - c.start) * Math.sign(c.sweep)) <= Math.abs(c.sweep) + 1e-10;
const curveExtrema = (c)=>[
        c.start,
        c.start + c.sweep,
        Math.atan2(c.v[0], c.u[0]),
        Math.atan2(c.v[0], c.u[0]) + Math.PI,
        Math.atan2(c.v[1], c.u[1]),
        Math.atan2(c.v[1], c.u[1]) + Math.PI
    ].filter((a)=>angleOn(c, a)).map((a)=>curveAt(c, a));
function vertex(value) {
    return point(value?.point ?? value);
}
function circle(center, radius, start = 0, sweep = TAU) {
    return {
        kind: 'curve',
        center,
        u: [
            radius,
            0
        ],
        v: [
            0,
            radius
        ],
        start,
        sweep
    };
}
function polyline(vertices, closed) {
    const result = [];
    for(let i = 0; i < vertices.length - (closed ? 0 : 1); i++){
        const a = vertex(vertices[i]), b = vertex(vertices[(i + 1) % vertices.length]);
        if (!a || !b) continue;
        const bulge = finite(vertices[i]?.bulge);
        const delta = sub(b, a), length = Math.hypot(...delta);
        if (Math.abs(bulge) < 1e-12 || length < 1e-12) result.push({
            kind: 'segment',
            a,
            b
        });
        else {
            const offset = (1 - bulge * bulge) / (4 * bulge);
            const center = [
                (a[0] + b[0]) / 2 - delta[1] * offset,
                (a[1] + b[1]) / 2 + delta[0] * offset
            ];
            result.push(circle(center, Math.hypot(...sub(a, center)), Math.atan2(a[1] - center[1], a[0] - center[0]), 4 * Math.atan(bulge)));
        }
    }
    return result;
}
function boundarySamples(parts, edgeLoop = false) {
    const result = [];
    for (const part of parts){
        if (part.kind === 'curve') {
            const count = edgeLoop ? 72 : Math.max(8, Math.ceil(Math.abs(part.sweep) / (Math.PI / 18)));
            for(let step = 0; step <= count; step++)result.push(curveAt(part, part.start + part.sweep * step / count));
        } else if (part.kind === 'point') result.push(part.point);
        else result.push(part.a, part.b);
    }
    return result;
}
function hatchEdges(edges) {
    const result = {
        parts: [],
        fills: [],
        complete: true
    };
    let first = null, previous = null;
    for (const raw of edges){
        const edge = raw, center = point(edge?.center), radius = finite(edge?.radius);
        let part = null;
        if (center && radius > 0) {
            const start = finite(edge.startAngle), end = finite(edge.endAngle), clockwise = edge.clockwise === true || edge.counterClockwise === false;
            const delta = clockwise ? start - end : end - start;
            const sweep = (delta > 0 ? delta : mod(delta) || TAU) * (clockwise ? -1 : 1);
            if (Number.isFinite(sweep)) part = circle(center, radius, start, sweep);
        } else {
            const a = point(edge?.start), b = point(edge?.end);
            if (a && b) part = {
                kind: 'segment',
                a,
                b
            };
        }
        if (!part) {
            result.complete = false;
            continue;
        }
        const a = part.kind === 'curve' ? curveAt(part, part.start) : part.a;
        const b = part.kind === 'curve' ? curveAt(part, part.start + part.sweep) : part.b;
        if (previous && Math.hypot(...sub(previous, a)) > 1e-12) result.parts.push({
            kind: 'segment',
            a: previous,
            b: a
        });
        result.parts.push(part);
        if (first === null) first = a;
        previous = b;
    }
    if (first && previous && Math.hypot(...sub(first, previous)) > 1e-12) result.parts.push({
        kind: 'segment',
        a: previous,
        b: first
    });
    return result;
}
function textBox(position, text, height, rotation, centered = false) {
    const width = Math.max(height * .4, [
        ...text
    ].reduce((sum, char)=>sum + (char.charCodeAt(0) > 255 ? 1 : .6), 0) * height);
    const left = centered ? -width / 2 : 0, u = [
        Math.cos(rotation),
        Math.sin(rotation)
    ], v = [
        -u[1],
        u[0]
    ];
    return [
        [
            left,
            0
        ],
        [
            left + width,
            0
        ],
        [
            left + width,
            height
        ],
        [
            left,
            height
        ]
    ].map((p)=>add(add(position, u, p[0]), v, p[1]));
}
function project(entity, document, depth = 0) {
    const payload = entity.payload, result = {
        parts: [],
        fills: [],
        complete: true
    };
    const path = (values, closed = false, filled = false)=>{
        result.parts.push(...polyline(values, closed));
        if (filled) result.fills.push([
            values.map(vertex).filter((p)=>p !== null)
        ]);
    };
    switch(entity.type){
        case 'LINE':
            {
                const a = point(payload.start), b = point(payload.end);
                if (a && b) result.parts.push({
                    kind: 'segment',
                    a,
                    b
                });
                break;
            }
        case 'RAY':
        case 'XLINE':
            {
                const a = point(payload.origin), direction = point(payload.direction);
                if (a && direction) result.parts.push({
                    kind: entity.type === 'RAY' ? 'ray' : 'line',
                    a,
                    b: add(a, direction)
                });
                break;
            }
        case 'POINT':
            {
                const p = point(payload.position);
                if (p) result.parts.push({
                    kind: 'point',
                    point: p
                });
                break;
            }
        case 'CIRCLE':
        case 'ARC':
            {
                const center = point(payload.center), radius = finite(payload.radius);
                if (center && radius > 0) result.parts.push(circle(center, radius, entity.type === 'ARC' ? finite(payload.startAngle) : 0, entity.type === 'ARC' ? arcSweep(payload) : TAU));
                break;
            }
        case 'ELLIPSE':
            {
                const center = point(payload.center), u = point(payload.majorAxis), ratio = finite(payload.ratio, 1), start = finite(payload.startParameter);
                if (center && u && ratio > 0) result.parts.push({
                    kind: 'curve',
                    center,
                    u,
                    v: [
                        -u[1] * ratio,
                        u[0] * ratio
                    ],
                    start,
                    sweep: mod(finite(payload.endParameter, TAU) - start) || TAU
                });
                break;
            }
        case 'LWPOLYLINE':
        case 'POLYLINE':
            path(Array.isArray(payload.vertices) ? payload.vertices : [], payload.closed === true);
            break;
        case 'SPLINE':
            {
                const definition = normalizeSplineDefinition({
                    degree: finite(payload.degree, 3),
                    controlPoints: (Array.isArray(payload.controlPoints) ? payload.controlPoints : []).map(vertex).filter((p)=>!!p),
                    ...Array.isArray(payload.knots) ? {
                        knots: payload.knots.map(Number)
                    } : {},
                    ...Array.isArray(payload.weights) ? {
                        weights: payload.weights.map(Number)
                    } : {}
                });
                const knots = [
                    ...new Set(definition.knots.slice(definition.degree, definition.controlPoints.length + 1))
                ], samples = [];
                for(let i = 1; i < knots.length; i++)for(let step = i === 1 ? 0 : 1; step <= 24; step++)samples.push(splinePoint2(definition, knots[i - 1] + (knots[i] - knots[i - 1]) * step / 24));
                path(samples, payload.closed === true);
                break;
            }
        case 'HATCH':
            {
                const loops = [];
                for (const loop of Array.isArray(payload.boundaryLoops) ? payload.boundaryLoops : []){
                    const vertexLoop = Array.isArray(loop.vertices);
                    const boundary = vertexLoop ? {
                        parts: polyline(loop.vertices, true),
                        fills: [],
                        complete: true
                    } : hatchEdges(Array.isArray(loop.edges) ? loop.edges : []);
                    const samples = boundarySamples(boundary.parts, !vertexLoop);
                    if (samples.length < 3) {
                        result.complete = false;
                        continue;
                    }
                    result.parts.push(...boundary.parts);
                    loops.push(samples);
                    result.complete = result.complete && boundary.complete;
                }
                const pattern = String(payload.patternName ?? 'ANSI31').toUpperCase();
                if (payload.solid === true || [
                    'SOLID',
                    'ANSI31',
                    'ANSI37',
                    'CROSS'
                ].includes(pattern) || Array.isArray(payload.patternLines) || Array.isArray(payload.rawTags) && payload.rawTags.some((tag)=>tag.code === 78 && Number(tag.value) > 0)) result.fills.push(loops);
                break;
            }
        case 'SOLID':
        case 'TRACE':
        case 'WIPEOUT':
        case 'REVISION_CLOUD':
            path(Array.isArray(payload.vertices) ? payload.vertices : [], true, true);
            break;
        case 'LEADER':
        case 'MLEADER':
            path(Array.isArray(payload.vertices) ? payload.vertices : []);
            break;
        case 'DIMENSION':
            {
                const annotation = projectDimension(payload, document.getObject(String(payload.styleId ?? ''))?.payload);
                if (!annotation) {
                    result.complete = false;
                    break;
                }
                for (const arc of annotation.arcs)result.parts.push(circle(arc.center, arc.radius, arc.startAngle, arc.endAngle - arc.startAngle));
                for (const [a, b] of annotation.lines)result.parts.push({
                    kind: 'segment',
                    a,
                    b
                });
                for (const arrow of annotation.arrows)path(arrow, true, true);
                path(textBox(annotation.label.position, annotation.label.text, annotation.label.height, annotation.label.rotation, true), true, true);
                break;
            }
        case 'TEXT':
        case 'MTEXT':
        case 'ATTDEF':
        case 'ATTRIB':
            {
                const p = point(payload.position);
                if (p) path(textBox(p, String(payload.text ?? payload.value ?? ''), finite(payload.height, 2.5), finite(payload.rotation)), true, true);
                break;
            }
        case 'INSERT':
            {
                if (depth >= 12) {
                    result.complete = false;
                    break;
                }
                const blockId = String(payload.blockRecordId ?? ''), block = document.getObject(blockId), position = point(payload.position), base = point(block?.payload.basePoint) ?? [
                    0,
                    0
                ];
                if (!block || !position) {
                    result.complete = false;
                    break;
                }
                const scales = Array.isArray(payload.scale) ? payload.scale : [
                    payload.scale ?? 1,
                    payload.scale ?? 1
                ];
                const matrix = multiply3(translation3(position[0], position[1]), multiply3(rotation3(finite(payload.rotation)), multiply3(scale3(finite(scales[0], 1), finite(scales[1], 1)), translation3(-base[0], -base[1]))));
                for (const child of document.listEntities({
                    ownerId: blockId
                })){
                    const layer = document.getObject(String(child.payload.layerId ?? ''))?.payload;
                    if (child.payload.visible === false || layer?.visible === false || layer?.frozen === true) continue;
                    try {
                        const projection = project({
                            ...child,
                            payload: transformEntityPayload(child.type, structuredClone(child.payload), matrix)
                        }, document, depth + 1);
                        result.parts.push(...projection.parts);
                        result.fills.push(...projection.fills);
                        result.complete = result.complete && projection.complete;
                    } catch  {
                        result.complete = false;
                    }
                }
                break;
            }
        default:
            result.complete = false;
    }
    return result;
}
function pointOnSegment(p, a, b, epsilon) {
    const v = sub(b, a), length2 = dot(v, v), t = length2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), v) / length2)) : 0;
    return Math.hypot(...sub(p, add(a, v, t))) <= epsilon;
}
function lineIntersects(part, a, b, epsilon) {
    const u = sub(part.b, part.a), v = sub(b, a), offset = sub(a, part.a), denominator = cross(u, v), length = Math.hypot(...u), otherLength = Math.hypot(...v);
    if (length === 0) return pointOnSegment(part.a, a, b, epsilon);
    if (otherLength <= epsilon) {
        const t = dot(offset, u) / dot(u, u);
        return Math.abs(cross(offset, u)) / length <= epsilon && (part.kind === 'line' || t >= -epsilon / length) && (part.kind !== 'segment' || t <= 1 + epsilon / length);
    }
    if (Math.abs(denominator) <= 1e-12 * length * otherLength) {
        if (Math.abs(cross(offset, u)) / length > epsilon) return false;
        const t1 = dot(offset, u) / dot(u, u), t2 = dot(sub(b, part.a), u) / dot(u, u);
        return part.kind === 'line' || Math.max(t1, t2) >= -epsilon / length && (part.kind === 'ray' || Math.min(t1, t2) <= 1 + epsilon / length);
    }
    const t = cross(offset, v) / denominator, s = cross(offset, u) / denominator;
    return s >= -epsilon / otherLength && s <= 1 + epsilon / otherLength && (part.kind === 'line' || t >= -epsilon / length) && (part.kind !== 'segment' || t <= 1 + epsilon / length);
}
function intersects(part, a, b, epsilon) {
    if (part.kind === 'point') return pointOnSegment(part.point, a, b, epsilon);
    if (part.kind !== 'curve') return lineIntersects(part, a, b, epsilon);
    const determinant = cross(part.u, part.v);
    if (Math.abs(determinant) < 1e-20) return false;
    const local = (p)=>{
        const d = sub(p, part.center);
        return [
            cross(d, part.v) / determinant,
            cross(part.u, d) / determinant
        ];
    };
    const start = local(a), end = local(b), direction = sub(end, start), aa = dot(direction, direction), bb = 2 * dot(start, direction), cc = dot(start, start) - 1;
    const unitTolerance = epsilon / Math.max(1e-12, Math.min(Math.hypot(...part.u), Math.hypot(...part.v)));
    if (aa < 1e-24) return Math.abs(Math.hypot(...start) - 1) <= unitTolerance && angleOn(part, Math.atan2(start[1], start[0]));
    const discriminant = bb * bb - 4 * aa * cc;
    if (discriminant < -1e-12 * Math.max(aa, Math.abs(bb * bb), Math.abs(4 * aa * cc))) return false;
    const root = Math.sqrt(Math.max(0, discriminant));
    const parameterTolerance = epsilon / Math.max(1e-12, Math.hypot(...sub(b, a)));
    return [
        (-bb - root) / (2 * aa),
        (-bb + root) / (2 * aa)
    ].some((t)=>t >= -parameterTolerance && t <= 1 + parameterTolerance && angleOn(part, Math.atan2(start[1] + direction[1] * t, start[0] + direction[0] * t)));
}
function insideFills(point, loops) {
    let inside = false;
    for (const loop of loops)for(let i = 0, j = loop.length - 1; i < loop.length; j = i++){
        const a = loop[i], b = loop[j];
        if (a[1] > point[1] !== b[1] > point[1] && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}
function criticalPoints(part) {
    return part.kind === 'curve' ? curveExtrema(part) : part.kind === 'point' ? [
        part.point
    ] : [
        part.a,
        part.b
    ];
}
function insideCurvedLoops(p, loops) {
    let inside = false;
    const startOf = (part)=>part.kind === 'curve' ? curveAt(part, part.start) : part.kind === 'point' ? part.point : part.a;
    for (const parts of loops)for(let index = 0; index < parts.length; index++){
        const part = parts[index], end = startOf(parts[(index + 1) % parts.length]);
        if (part.kind === 'point') continue;
        if (part.kind !== 'curve') {
            const a = part.a;
            if (a[1] > p[1] !== end[1] > p[1] && p[0] < a[0] + (end[0] - a[0]) * (p[1] - a[1]) / (end[1] - a[1])) inside = !inside;
            continue;
        }
        const cuts = [
            0,
            1
        ], sweep = Math.abs(part.sweep);
        for (const angle of [
            Math.PI / 2,
            3 * Math.PI / 2
        ]){
            const t = mod((angle - part.start) * Math.sign(part.sweep)) / sweep;
            if (t > 0 && t < 1) cuts.push(t);
        }
        cuts.sort((a, b)=>a - b);
        for(let i = 1; i < cuts.length; i++){
            const lo = cuts[i - 1], hi = cuts[i];
            const a = curveAt(part, part.start + part.sweep * lo), b = hi === 1 ? end : curveAt(part, part.start + part.sweep * hi);
            if (a[1] > p[1] === b[1] > p[1]) continue;
            const radius = part.u[0], dy = p[1] - part.center[1];
            const side = Math.cos(part.start + part.sweep * (lo + hi) / 2) >= 0 ? 1 : -1;
            const x = part.center[0] + side * Math.sqrt(Math.max(0, (radius - dy) * (radius + dy)));
            if (p[0] < x) inside = !inside;
        }
    }
    return inside;
}
export function classifyEntityInBox(document, entity, bounds) {
    if (!Array.isArray(bounds) || bounds.length !== 4 || [
        ...bounds
    ].some((n)=>typeof n !== 'number' || !Number.isFinite(n)) || bounds[0] > bounds[2] || bounds[1] > bounds[3]) throw new TypeError('Query bounds must be finite ordered XY extents');
    if (![
        'LINE',
        'RAY',
        'XLINE',
        'POINT',
        'CIRCLE',
        'ARC',
        'LWPOLYLINE',
        'POLYLINE',
        'HATCH',
        'DIMENSION'
    ].includes(entity.type)) return 'unclassified';
    for (const normal of [
        entity.payload.normal,
        entity.payload.extrusionDirection
    ]){
        if (normal !== undefined && (!Array.isArray(normal) || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) return 'unclassified';
    }
    if (Array.isArray(entity.payload.vertices) && entity.payload.vertices.length > 4096) return 'unclassified';
    const hatchLoops = [];
    if (entity.type === 'HATCH') {
        const loops = entity.payload.boundaryLoops;
        if (!Array.isArray(loops) || !loops.length || loops.length > 128) return 'unclassified';
        let edges = 0;
        for (const loop of loops){
            if (!loop || typeof loop !== 'object') return 'unclassified';
            if (Array.isArray(loop.vertices)) {
                edges += loop.vertices.length;
                if (edges > 4096) return 'unclassified';
                if (loop.vertices.length < 2 || loop.vertices.some((v)=>!vertex(v) || v?.bulge !== undefined && !Number.isFinite(v.bulge))) return 'unclassified';
                const parts = polyline(loop.vertices, true);
                if (loop.vertices.length < 3 && !parts.some((part)=>part.kind === 'curve')) return 'unclassified';
                hatchLoops.push(parts);
            } else if (Array.isArray(loop.edges)) {
                edges += loop.edges.length;
                if (edges > 4096) return 'unclassified';
                if (!loop.edges.length || loop.edges.some((e)=>!e || (e.type === 'LINE' ? !point(e.start) || !point(e.end) : e.type !== 'ARC' || !point(e.center) || typeof e.radius !== 'number' || e.radius <= 0 || !Number.isFinite(e.radius) || !Number.isFinite(e.startAngle) || !Number.isFinite(e.endAngle)))) return 'unclassified';
                const boundary = hatchEdges(loop.edges);
                if (!boundary.complete) return 'unclassified';
                hatchLoops.push(boundary.parts);
            } else return 'unclassified';
            if (edges > 4096) return 'unclassified';
        }
        if (hatchLoops.some((parts)=>parts.some((part)=>part.kind === 'curve' && (!Number.isFinite(part.sweep) || Math.abs(part.sweep) > TAU + 1e-10 || !Number.isFinite(part.u[0]))))) return 'unclassified';
        if (entity.payload.solid !== true && String(entity.payload.patternName).toUpperCase() !== 'SOLID') {
            try {
                hatchPatternLines(entity.payload);
            } catch  {
                return 'unclassified';
            }
        }
    }
    const [minX, minY, maxX, maxY] = bounds, tolerance = 1e-8;
    const corners = [
        [
            minX,
            minY
        ],
        [
            maxX,
            minY
        ],
        [
            maxX,
            maxY
        ],
        [
            minX,
            maxY
        ]
    ];
    const inside = (p)=>p[0] >= minX - tolerance && p[0] <= maxX + tolerance && p[1] >= minY - tolerance && p[1] <= maxY + tolerance;
    try {
        const projection = hatchLoops.length ? {
            parts: hatchLoops.flat(),
            fills: [],
            complete: true
        } : project(entity, document);
        if (!projection.complete || !projection.parts.length) return 'unclassified';
        const touchesBoundary = projection.parts.some((part)=>criticalPoints(part).some(inside) || corners.some((corner, i)=>intersects(part, corner, corners[(i + 1) % 4], tolerance)));
        const insideFill = hatchLoops.length ? corners.some((corner)=>insideCurvedLoops(corner, hatchLoops)) : projection.fills.some((loops)=>corners.some((corner)=>insideFills(corner, loops)));
        return touchesBoundary || insideFill ? 'intersects' : 'outside';
    } catch  {
        return 'unclassified';
    }
}
export function isEntitySelectable(document, entity, options = {}) {
    if (entity.kind !== 'entity' || entity.erased || entity.ownerId !== (options.spaceId ?? document.snapshot().spaces.modelSpaceId) || entity.payload.visible === false) return false;
    const layer = document.getObject(String(entity.payload.layerId ?? ''))?.payload;
    return layer?.visible !== false && layer?.frozen !== true && (options.includeLocked === true || layer?.locked !== true);
}
function epsilon(options) {
    const value = options.tolerance ?? 1e-8;
    if (!Number.isFinite(value) || value < 0) throw new TypeError('Selection tolerance must be finite and non-negative');
    return value;
}
function checkedPoint(value) {
    const p = point(value);
    if (!p) throw new TypeError('Selection coordinates must be finite XY points');
    return p;
}
export function selectEntitiesInBox(document, first, second, mode = 'window', options = {}) {
    options = {
        ...options,
        spaceId: options.spaceId ?? document.snapshot().spaces.modelSpaceId
    };
    if (mode !== 'window' && mode !== 'crossing') throw new TypeError('Selection mode must be window or crossing');
    const a = checkedPoint(first), b = checkedPoint(second), tolerance = epsilon(options);
    const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]), minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
    const corners = [
        [
            minX,
            minY
        ],
        [
            maxX,
            minY
        ],
        [
            maxX,
            maxY
        ],
        [
            minX,
            maxY
        ]
    ];
    const inside = (p)=>p[0] >= minX - tolerance && p[0] <= maxX + tolerance && p[1] >= minY - tolerance && p[1] <= maxY + tolerance;
    return Object.freeze(document.listEntities({
        ownerId: options.spaceId ?? document.snapshot().spaces.modelSpaceId
    }).filter((entity)=>{
        if (!isEntitySelectable(document, entity, options)) return false;
        try {
            const projection = project(entity, document);
            if (!projection.parts.length) return false;
            if (mode === 'window') return projection.complete && projection.parts.every((part)=>part.kind !== 'ray' && part.kind !== 'line' && criticalPoints(part).every(inside));
            return projection.parts.some((part)=>criticalPoints(part).some(inside) || corners.some((corner, i)=>intersects(part, corner, corners[(i + 1) % 4], tolerance))) || projection.fills.some((loops)=>corners.some((corner)=>insideFills(corner, loops)));
        } catch  {
            return false;
        }
    }).map((entity)=>entity.id));
}
export function selectEntitiesByFence(document, vertices, options = {}) {
    options = {
        ...options,
        spaceId: options.spaceId ?? document.snapshot().spaces.modelSpaceId
    };
    if (vertices.length < 2) throw new TypeError('Selection fence requires at least two points');
    const fence = vertices.map(checkedPoint), tolerance = epsilon(options);
    return Object.freeze(document.listEntities({
        ownerId: options.spaceId ?? document.snapshot().spaces.modelSpaceId
    }).filter((entity)=>{
        if (!isEntitySelectable(document, entity, options)) return false;
        try {
            const projection = project(entity, document);
            return projection.parts.some((part)=>fence.slice(1).some((end, i)=>intersects(part, fence[i], end, tolerance))) || projection.fills.some((loops)=>fence.some((p)=>insideFills(p, loops)));
        } catch  {
            return false;
        }
    }).map((entity)=>entity.id));
}
