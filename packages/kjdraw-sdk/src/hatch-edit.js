// Generated from hatch-edit.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
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
function insidePolygon(point, polygon) {
    if (polygon.some((a, index)=>onSegment(a, polygon[(index + 1) % polygon.length], point))) return false;
    let inside = false;
    for(let i = 0, j = polygon.length - 1; i < polygon.length; j = i++){
        const a = polygon[i], b = polygon[j];
        if (a[1] > point[1] !== b[1] > point[1] && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}
function polygonsIntersect(first, second) {
    return first.some((a, index)=>second.some((c, other)=>segmentsIntersect(a, first[(index + 1) % first.length], c, second[(other + 1) % second.length])));
}
function polygonLoop(loop) {
    if (Array.isArray(loop.vertices) && loop.vertices.length >= 3) {
        const result = [];
        for (const [index, vertex] of loop.vertices.entries()){
            const record = vertex;
            if (!Array.isArray(vertex) && Number(record?.bulge ?? 0) !== 0) return null;
            try {
                result.push(point(vertex, index));
            } catch  {
                return null;
            }
        }
        return result;
    }
    if (!Array.isArray(loop.edges) || loop.edges.length < 3) return null;
    const result = [];
    try {
        for (const [index, value] of loop.edges.entries()){
            const edge = value;
            if (String(edge.type).toUpperCase() !== 'LINE') return null;
            const start = point(edge.start, index), end = point(edge.end, index);
            if (index && !same(start, point(loop.edges[index - 1].end, index - 1))) return null;
            result.push(start);
            if (index === loop.edges.length - 1 && !same(end, result[0])) return null;
        }
    } catch  {
        return null;
    }
    return result;
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
    const polygon = polygonLoop(candidate);
    if (!polygon) return fail('new island must be a straight closed polygon');
    const outerPolygons = loops.filter((loop)=>loop.external !== false).map(polygonLoop).filter((value)=>Boolean(value));
    if (!outerPolygons.some((outer)=>polygon.every((vertex)=>insidePolygon(vertex, outer)) && !polygonsIntersect(polygon, outer))) return fail('island must lie strictly inside a polygonal outer boundary');
    for (const [index, loop] of loops.entries()){
        if (index === ignoredIndex || loop.external !== false) continue;
        const other = polygonLoop(loop);
        if (!other) return fail('existing non-polygon island cannot be safely combined with polygon editing');
        if (polygonsIntersect(polygon, other) || insidePolygon(polygon[0], other) || insidePolygon(other[0], polygon)) return fail('island boundaries must not overlap or contain each other');
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
        const candidate = normalizedIsland(input.vertices);
        validateIslandPlacement(loops, candidate);
        loops.push(candidate);
    } else if (input.operation === 'replace-island') {
        const index = islandIndex(loops, input.loopIndex), candidate = normalizedIsland(input.vertices);
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
