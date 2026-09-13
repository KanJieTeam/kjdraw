// Generated from editing.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { add2, arcSweep, cross2, distance2, dot2, intersectCircleCircle2, intersectLineCircle2, intersectLineLine2, length2, midpoint2, multiply2, normalize2, perpendicular2, projectParameter2, subtract2, vec2 } from './geometry/index.js';
import { clone, normalizeName } from './utils.js';
const TURN = Math.PI * 2;
function pointInput(value) {
    return value;
}
function payloadOf(entity) {
    return clone(entity?.payload ?? {});
}
function positive(value, label) {
    const result = Number(value);
    if (!Number.isFinite(result) || result <= 0) throw new KJValidationError(`${label} must be a positive finite number`);
    return result;
}
function point3(value) {
    const point = vec2(pointInput(value));
    const source = value;
    return [
        point[0],
        point[1],
        Number(source?.[2] ?? source?.z ?? 0)
    ];
}
function positiveTurn(value) {
    const normalized = value % TURN;
    return normalized < 0 ? normalized + TURN : normalized;
}
function distance3(first, second) {
    return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}
function joinTolerance(value) {
    const tolerance = Number(value ?? 1e-9);
    if (!Number.isFinite(tolerance) || tolerance < 0) throw new KJValidationError('Join tolerance must be a non-negative finite number');
    return tolerance;
}
function positiveXYNormal(payload, label) {
    if (payload.normal == null) return;
    const normal = point3(payload.normal);
    if (Math.abs(normal[0]) > 1e-12 || Math.abs(normal[1]) > 1e-12 || normal[2] <= 0) throw new KJValidationError(`${label} must use a positive XY extrusion normal`);
}
function actualPolylinePoints(payload) {
    const vertices = payload.vertices;
    if (!Array.isArray(vertices) || vertices.length < 2) throw new KJValidationError('JOIN requires polylines with at least two vertices');
    const points = vertices.map((vertex)=>point3(vertex.point ?? vertex));
    const elevation = Number(payload.elevation ?? 0);
    if (!Number.isFinite(elevation)) throw new KJValidationError('Polyline elevation must be finite');
    if (!(Number(payload.dxfFlags ?? 0) & 8) && elevation !== 0 && points.every((point)=>point[2] === 0)) {
        for (const point of points)point[2] = elevation;
    }
    return points;
}
function joinPath(entity, index) {
    const id = String(entity.id ?? `join-source-${index}`), type = normalizeName(entity.type), payload = entity.payload ?? {};
    const segments = [];
    if (type === 'LINE') {
        const start = point3(payload.start), end = point3(payload.end);
        if (distance3(start, end) <= 1e-15) throw new KJValidationError(`JOIN cannot use degenerate entity ${id}`);
        segments.push({
            point: start,
            end,
            bulge: 0,
            startWidth: 0,
            endWidth: 0
        });
    } else if (type === 'ARC') {
        positiveXYNormal(payload, `JOIN ARC ${id}`);
        const center = point3(payload.center), radius = Number(payload.radius), sweep = arcSweep(payload);
        if (!(radius > 0) || !Number.isFinite(radius) || !Number.isFinite(sweep) || Math.abs(sweep) <= 1e-15 || Math.abs(sweep) >= TURN - 1e-12) throw new KJValidationError(`JOIN requires a non-degenerate open ARC: ${id}`);
        const start = polar(center, radius, Number(payload.startAngle)), end = polar(center, radius, Number(payload.startAngle) + sweep);
        segments.push({
            point: start,
            end,
            bulge: Math.tan(sweep / 4),
            startWidth: 0,
            endWidth: 0
        });
    } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
        if (payload.closed) throw new KJValidationError(`JOIN requires open polylines: ${id}`);
        if (Number(payload.dxfFlags ?? 0) & 8) throw new KJValidationError(`JOIN does not flatten 3D polyline ${id}`);
        positiveXYNormal(payload, `JOIN polyline ${id}`);
        const vertices = payload.vertices, points = actualPolylinePoints(payload);
        for(let vertexIndex = 0; vertexIndex < points.length - 1; vertexIndex += 1){
            const vertex = vertices[vertexIndex];
            const start = points[vertexIndex], end = points[vertexIndex + 1];
            if (distance3(start, end) <= 1e-15) throw new KJValidationError(`JOIN cannot use a zero-length polyline segment: ${id}`);
            segments.push({
                point: start,
                end,
                bulge: Number(vertex?.bulge ?? 0),
                startWidth: Number(vertex?.startWidth ?? 0),
                endWidth: Number(vertex?.endWidth ?? 0)
            });
        }
    } else throw new KJValidationError(`JOIN is not implemented for ${type || 'unknown entity'}`);
    for (const segment of segments)if (![
        segment.bulge,
        segment.startWidth,
        segment.endWidth
    ].every(Number.isFinite)) throw new KJValidationError(`JOIN found invalid segment data in ${id}`);
    return {
        id,
        type,
        segments,
        start: segments[0].point,
        end: segments.at(-1).end,
        nodeStart: -1,
        nodeEnd: -1
    };
}
function clusterJoinEndpoints(paths, tolerance) {
    const points = paths.flatMap((path)=>[
            path.start,
            path.end
        ]);
    const parent = points.map((_, index)=>index);
    const find = (index)=>{
        while(parent[index] !== index){
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        return index;
    };
    const unite = (first, second)=>{
        first = find(first);
        second = find(second);
        if (first !== second) parent[second] = first;
    };
    const scale = tolerance > 0 ? tolerance : 1;
    const buckets = new Map();
    const key = (point, dx = 0, dy = 0, dz = 0)=>`${Math.floor(point[0] / scale) + dx}:${Math.floor(point[1] / scale) + dy}:${Math.floor(point[2] / scale) + dz}`;
    for(let index = 0; index < points.length; index += 1){
        const point = points[index];
        if (tolerance === 0) {
            const exact = `${point[0]}:${point[1]}:${point[2]}`, matches = buckets.get(exact);
            if (matches?.length) unite(index, matches[0]);
            else buckets.set(exact, [
                index
            ]);
            continue;
        }
        for(let dx = -1; dx <= 1; dx += 1)for(let dy = -1; dy <= 1; dy += 1)for(let dz = -1; dz <= 1; dz += 1){
            for (const candidate of buckets.get(key(point, dx, dy, dz)) ?? [])if (distance3(point, points[candidate]) <= tolerance) unite(index, candidate);
        }
        const own = key(point), values = buckets.get(own);
        if (values) values.push(index);
        else buckets.set(own, [
            index
        ]);
    }
    const roots = new Map(), nodes = [];
    for(let index = 0; index < points.length; index += 1){
        const root = find(index);
        if (!roots.has(root)) {
            roots.set(root, nodes.length);
            nodes.push(points[root]);
        }
        const path = paths[Math.floor(index / 2)];
        if (index % 2 === 0) path.nodeStart = roots.get(root);
        else path.nodeEnd = roots.get(root);
    }
    return nodes;
}
function reverseJoinSegments(segments) {
    return [
        ...segments
    ].reverse().map((segment)=>({
            point: [
                ...segment.end
            ],
            end: [
                ...segment.point
            ],
            bulge: -segment.bulge,
            startWidth: segment.endWidth,
            endWidth: segment.startWidth
        }));
}
function joinDrawingProperties(payload) {
    const result = {};
    for (const key of [
        'layerId',
        'color',
        'trueColor',
        'linetypeId',
        'linetypeName',
        'linetypeScale',
        'lineweight',
        'transparency',
        'visible',
        'thickness',
        'materialId',
        'plotStyleId'
    ]){
        if (Object.hasOwn(payload, key)) result[key] = clone(payload[key]);
    }
    return result;
}
export function joinEntityPayloads(entities, options = {}) {
    if (!Array.isArray(entities) || entities.length < 2) throw new KJValidationError('JOIN requires at least two entities');
    if (entities.length > 4096) throw new KJValidationError('JOIN supports at most 4096 entities per operation');
    const paths = entities.map(joinPath), ids = paths.map((path)=>path.id);
    if (new Set(ids).size !== ids.length) throw new KJValidationError('JOIN entity ids must be unique');
    const primaryId = String(options.primaryId ?? ids[0]), primaryIndex = ids.indexOf(primaryId);
    if (primaryIndex < 0) throw new KJValidationError('JOIN primary entity must be included in the input');
    const tolerance = joinTolerance(options.tolerance), nodes = clusterJoinEndpoints(paths, tolerance);
    const incident = nodes.map(()=>[]);
    for(let index = 0; index < paths.length; index += 1){
        const path = paths[index];
        incident[path.nodeStart].push(index);
        incident[path.nodeEnd].push(index);
    }
    const activeNodes = incident.map((edges, node)=>({
            edges,
            node
        })).filter((value)=>value.edges.length);
    const endpoints = activeNodes.filter((value)=>value.edges.length === 1);
    if (activeNodes.some((value)=>value.edges.length > 2)) throw new KJValidationError('JOIN cannot resolve branched geometry');
    if (endpoints.length !== 0 && endpoints.length !== 2) throw new KJValidationError('JOIN entities do not form one chain or loop');
    const visited = new Set(), pending = [
        paths[0].nodeStart
    ];
    while(pending.length){
        const node = pending.pop();
        if (visited.has(node)) continue;
        visited.add(node);
        for (const edge of incident[node]){
            const path = paths[edge], next = path.nodeStart === node ? path.nodeEnd : path.nodeStart;
            if (!visited.has(next)) pending.push(next);
        }
    }
    if (activeNodes.some((value)=>!visited.has(value.node))) throw new KJValidationError('JOIN entities are disconnected');
    const closed = endpoints.length === 0;
    let currentNode, firstEdge = null;
    if (closed) {
        firstEdge = primaryIndex;
        currentNode = paths[primaryIndex].nodeStart;
    } else {
        const startSide = new Set(), sidePending = [
            paths[primaryIndex].nodeStart
        ];
        while(sidePending.length){
            const node = sidePending.pop();
            if (startSide.has(node)) continue;
            startSide.add(node);
            for (const edge of incident[node]){
                if (edge === primaryIndex) continue;
                const path = paths[edge], next = path.nodeStart === node ? path.nodeEnd : path.nodeStart;
                if (!startSide.has(next)) sidePending.push(next);
            }
        }
        currentNode = endpoints.find((value)=>startSide.has(value.node)).node;
    }
    const used = new Set(), ordered = [];
    while(used.size < paths.length){
        const candidates = incident[currentNode].filter((edge)=>!used.has(edge));
        const edge = firstEdge ?? candidates[0];
        firstEdge = null;
        if (edge == null || !candidates.includes(edge)) throw new KJValidationError('JOIN entities do not form a continuous path');
        const path = paths[edge], forward = path.nodeStart === currentNode;
        ordered.push({
            path,
            segments: forward ? path.segments.map((segment)=>clone(segment)) : reverseJoinSegments(path.segments)
        });
        used.add(edge);
        currentNode = forward ? path.nodeEnd : path.nodeStart;
    }
    if (closed ? currentNode !== ordered[0].path.nodeStart : incident[currentNode].length !== 1) throw new KJValidationError('JOIN path termination is inconsistent');
    const segments = ordered.flatMap((value)=>value.segments);
    for(let index = 1; index < segments.length; index += 1)segments[index].point = [
        ...segments[index - 1].end
    ];
    if (closed) segments[0].point = [
        ...segments.at(-1).end
    ];
    const plane = segments[0].point[2];
    if (segments.some((segment)=>Math.abs(segment.point[2] - plane) > tolerance || Math.abs(segment.end[2] - plane) > tolerance)) throw new KJValidationError('JOIN requires coplanar geometry in one XY plane');
    const vertices = segments.map((segment)=>({
            point: [
                segment.point[0],
                segment.point[1],
                0
            ],
            bulge: segment.bulge,
            startWidth: segment.startWidth,
            endWidth: segment.endWidth
        }));
    if (!closed) vertices.push({
        point: [
            segments.at(-1).end[0],
            segments.at(-1).end[1],
            0
        ],
        bulge: 0,
        startWidth: 0,
        endWidth: 0
    });
    const primaryPayload = entities[primaryIndex].payload ?? {};
    return {
        type: [
            'LWPOLYLINE',
            'POLYLINE'
        ].includes(normalizeName(entities[primaryIndex].type)) ? normalizeName(entities[primaryIndex].type) : 'LWPOLYLINE',
        payload: {
            ...joinDrawingProperties(primaryPayload),
            vertices,
            closed,
            elevation: plane,
            normal: [
                0,
                0,
                1
            ]
        },
        sourceIds: ordered.map((value)=>value.path.id),
        closed
    };
}
function polar(center, radius, angle) {
    return [
        center[0] + radius * Math.cos(angle),
        center[1] + radius * Math.sin(angle),
        center[2] ?? 0
    ];
}
function lineSide(payload, options) {
    const direction = subtract2(pointInput(payload.end ?? add2(pointInput(payload.origin), pointInput(payload.direction))), pointInput(payload.start ?? payload.origin));
    const origin = pointInput(payload.start ?? payload.origin);
    if (options.sidePoint) return cross2(direction, subtract2(pointInput(options.sidePoint), origin)) >= 0 ? 1 : -1;
    const side = normalizeName(options.side ?? 'LEFT');
    if (![
        'LEFT',
        'RIGHT'
    ].includes(side)) throw new KJValidationError('Linear offset side must be left or right');
    return side === 'LEFT' ? 1 : -1;
}
function radialSide(payload, options) {
    if (options.sidePoint) return distance2(pointInput(options.sidePoint), pointInput(payload.center)) >= Number(payload.radius) ? 1 : -1;
    const side = normalizeName(options.side ?? 'OUTWARD');
    if (![
        'OUTWARD',
        'INWARD'
    ].includes(side)) throw new KJValidationError('Circular offset side must be outward or inward');
    return side === 'OUTWARD' ? 1 : -1;
}
export function offsetEntityPayload(entity, distance, options = {}) {
    const offsetDistance = positive(distance, 'Offset distance');
    const payload = payloadOf(entity), type = normalizeName(entity?.type);
    if ([
        'LINE',
        'RAY',
        'XLINE'
    ].includes(type)) {
        const direction = type === 'LINE' ? subtract2(pointInput(payload.end), pointInput(payload.start)) : pointInput(payload.direction);
        const normal = multiply2(normalize2(perpendicular2(direction)), offsetDistance * lineSide(payload, options));
        const move = (point)=>{
            const value = point3(point);
            return [
                value[0] + normal[0],
                value[1] + normal[1],
                value[2] ?? 0
            ];
        };
        if (type === 'LINE') {
            payload.start = move(payload.start);
            payload.end = move(payload.end);
        } else payload.origin = move(payload.origin);
        return payload;
    }
    if ([
        'CIRCLE',
        'ARC'
    ].includes(type)) {
        const radius = Number(payload.radius) + radialSide(payload, options) * offsetDistance;
        payload.radius = radius;
        if (radius <= 1e-12) throw new KJValidationError('Offset collapses the circular entity');
        return payload;
    }
    throw new KJValidationError(`Exact offset is not implemented for ${type || 'unknown entity'}`);
}
function splitParameters(values) {
    const result = [
        ...new Set(values.map(Number).filter(Number.isFinite).map((value)=>Math.max(0, Math.min(1, value))).filter((value)=>value > 1e-10 && value < 1 - 1e-10))
    ].sort((a, b)=>a - b);
    if (!result.length) throw new KJValidationError('Break point must lie inside the entity');
    return result;
}
function lineBreakParameters(payload, options) {
    const direction = subtract2(pointInput(payload.end), pointInput(payload.start));
    const points = options.points ?? [
        options.firstPoint ?? options.point,
        options.secondPoint
    ].filter(Boolean);
    const tolerance = polylineEditTolerance(options.tolerance);
    const start = point3(payload.start);
    const squared = dot2(direction, direction);
    if (!(squared > 1e-24)) throw new KJValidationError('BREAK requires a non-degenerate line');
    for (const point of points){
        const value = finiteEditPoint(point), parameter = projectParameter2(value, start, direction);
        const projected = add2(start, multiply2(direction, parameter));
        if (distance2(value, projected) > tolerance) throw new KJValidationError('BREAK point must lie on the line within tolerance');
    }
    return splitParameters(points.map((point)=>projectParameter2(pointInput(point), pointInput(payload.start), direction)));
}
function arcParameter(payload, point) {
    const angle = typeof point === 'number' ? point : (()=>{
        const center = point3(payload.center), value = point3(point);
        return Math.atan2(value[1] - center[1], value[0] - center[0]);
    })();
    const sweep = arcSweep(payload);
    const startAngle = Number(payload.startAngle);
    return sweep >= 0 ? positiveTurn(angle - startAngle) / sweep : positiveTurn(startAngle - angle) / -sweep;
}
export function breakEntityPayloads(entity, options = {}) {
    const payload = payloadOf(entity), type = normalizeName(entity?.type);
    const points = options.points ?? [
        options.firstPoint ?? options.point,
        options.secondPoint
    ].filter((value)=>value != null);
    if (type === 'LINE') {
        const parameters = lineBreakParameters(payload, {
            ...options,
            points
        });
        const start = point3(payload.start), end = point3(payload.end);
        const pointAt = (parameter)=>[
                start[0] + (end[0] - start[0]) * parameter,
                start[1] + (end[1] - start[1]) * parameter,
                start[2] + (end[2] - start[2]) * parameter
            ];
        if (parameters.length === 1) {
            const point = pointAt(parameters[0]);
            return [
                {
                    type,
                    payload: {
                        ...payload,
                        start: payload.start,
                        end: point
                    }
                },
                {
                    type,
                    payload: {
                        ...payload,
                        start: point,
                        end: payload.end
                    }
                }
            ];
        }
        return [
            {
                type,
                payload: {
                    ...payload,
                    start: payload.start,
                    end: pointAt(parameters[0])
                }
            },
            {
                type,
                payload: {
                    ...payload,
                    start: pointAt(parameters.at(-1)),
                    end: payload.end
                }
            }
        ];
    }
    if (type === 'ARC') {
        positiveXYNormal(payload, 'BREAK arc');
        const center = finiteEditPoint(payload.center), radius = Number(payload.radius), tolerance = polylineEditTolerance(options.tolerance);
        if (!(radius > 1e-12) || !Number.isFinite(radius)) throw new KJValidationError('BREAK ARC requires a positive finite radius');
        for (const point of points)if (typeof point !== 'number' && Math.abs(distance2(finiteEditPoint(point), center) - radius) > tolerance) {
            throw new KJValidationError('BREAK point must lie on the arc within tolerance');
        }
        const parameters = splitParameters(points.map((point)=>arcParameter(payload, point)));
        const sweep = arcSweep(payload), angleAt = (parameter)=>Number(payload.startAngle) + sweep * parameter;
        if (parameters.length === 1) {
            const angle = angleAt(parameters[0]);
            return [
                {
                    type,
                    payload: {
                        ...payload,
                        endAngle: angle
                    }
                },
                {
                    type,
                    payload: {
                        ...payload,
                        startAngle: angle
                    }
                }
            ];
        }
        return [
            {
                type,
                payload: {
                    ...payload,
                    endAngle: angleAt(parameters[0])
                }
            },
            {
                type,
                payload: {
                    ...payload,
                    startAngle: angleAt(parameters.at(-1))
                }
            }
        ];
    }
    if (type === 'CIRCLE') {
        if (points.length !== 2) throw new KJValidationError('BREAK CIRCLE requires two distinct points on the circumference');
        positiveXYNormal(payload, 'BREAK circle');
        const center = finiteEditPoint(payload.center), radius = Number(payload.radius), tolerance = polylineEditTolerance(options.tolerance);
        if (!(radius > 1e-12) || !Number.isFinite(radius)) throw new KJValidationError('BREAK CIRCLE requires a positive finite radius');
        const angles = points.map((point)=>{
            const value = finiteEditPoint(point);
            if (Math.abs(distance2(value, center) - radius) > tolerance) throw new KJValidationError('BREAK point must lie on the circle circumference within tolerance');
            return Math.atan2(value[1] - center[1], value[0] - center[0]);
        });
        if (Math.abs(Math.sin((angles[1] - angles[0]) / 2)) <= 1e-12) throw new KJValidationError('BREAK CIRCLE points must be distinct');
        const common = {
            ...payload,
            center,
            radius,
            clockwise: false,
            normal: [
                0,
                0,
                1
            ]
        };
        return [
            {
                type: 'ARC',
                payload: {
                    ...common,
                    startAngle: angles[0],
                    endAngle: angles[1]
                }
            },
            {
                type: 'ARC',
                payload: {
                    ...common,
                    startAngle: angles[1],
                    endAngle: angles[0] + TURN
                }
            }
        ];
    }
    if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
        const vertices = editablePolylineVertices(payload);
        assertEditablePolylineTopology(type, payload, vertices);
        positiveXYNormal(payload, 'BREAK polyline');
        const closed = payload.closed === true;
        const elevation = Number(payload.elevation ?? 0), baseZ = vertices[0].point[2];
        if (!Number.isFinite(elevation) || Math.abs(elevation) > POLYLINE_BOUND || vertices.length > POLYLINE_SEGMENT_LIMIT + 1 || vertices.some((vertex)=>vertex.point.some((value)=>Math.abs(value) > POLYLINE_BOUND) || Math.abs(vertex.point[2] - baseZ) > EDIT_PLANE_EPSILON || Math.abs(vertex.bulge) > POLYLINE_BOUND || vertex.startWidth < 0 || vertex.endWidth < 0 || vertex.startWidth > POLYLINE_BOUND || vertex.endWidth > POLYLINE_BOUND)) {
            throw new KJValidationError('BREAK requires a bounded ordinary polyline in one XY plane');
        }
        const segmentCount = closed ? vertices.length : vertices.length - 1;
        for(let index = 0; index < segmentCount; index += 1)if (distance3(vertices[index].point, vertices[(index + 1) % vertices.length].point) <= 1e-12) {
            throw new KJValidationError('BREAK cannot split a polyline with a zero-length segment');
        }
        if (points.length !== (closed ? 2 : 1)) throw new KJValidationError(`BREAK ${closed ? 'closed' : 'open'} polyline requires ${closed ? 'two' : 'one'} point${closed ? 's' : ''} inside distinct segments`);
        const tolerance = polylineEditTolerance(options.tolerance);
        const locate = (point)=>{
            const segmentIndex = pickedPolylineSegment(vertices, point, closed), source = vertices[segmentIndex], next = vertices[(segmentIndex + 1) % vertices.length];
            return {
                segmentIndex,
                source,
                location: pointOnBulgedPolylineSegment(source.point, next.point, source.bulge, finiteEditPoint(point), tolerance)
            };
        };
        if (closed) {
            const first = locate(points[0]), second = locate(points[1]);
            if (first.segmentIndex === second.segmentIndex) throw new KJValidationError('BREAK closed polyline points must lie inside two distinct segments');
            const piece = (from, to)=>{
                const fromSweep = 4 * Math.atan(from.source.bulge), fromWidth = interpolatePolylineWidth(from.source, from.location.parameter);
                const result = [
                    {
                        ...clone(from.source),
                        point: from.location.point,
                        bulge: Math.tan(fromSweep * (1 - from.location.parameter) / 4),
                        startWidth: fromWidth
                    }
                ];
                let index = (from.segmentIndex + 1) % vertices.length;
                while(true){
                    result.push(clone(vertices[index]));
                    if (index === to.segmentIndex) break;
                    index = (index + 1) % vertices.length;
                }
                const toSweep = 4 * Math.atan(to.source.bulge), toWidth = interpolatePolylineWidth(to.source, to.location.parameter);
                result.at(-1).bulge = Math.tan(toSweep * to.location.parameter / 4);
                result.at(-1).endWidth = toWidth;
                result.push({
                    point: to.location.point,
                    bulge: 0,
                    startWidth: toWidth,
                    endWidth: toWidth
                });
                return result;
            };
            return [
                {
                    type,
                    payload: changedPolylinePayload(payload, piece(first, second))
                },
                {
                    type,
                    payload: changedPolylinePayload(payload, piece(second, first))
                }
            ];
        }
        const { segmentIndex, source, location } = locate(points[0]), next = vertices[segmentIndex + 1];
        const sweep = 4 * Math.atan(source.bulge), middleWidth = interpolatePolylineWidth(source, location.parameter);
        const firstEnd = {
            point: location.point,
            bulge: 0,
            startWidth: middleWidth,
            endWidth: middleWidth
        };
        const secondStart = {
            point: location.point,
            bulge: Math.tan(sweep * (1 - location.parameter) / 4),
            startWidth: middleWidth,
            endWidth: source.endWidth
        };
        const leading = vertices.slice(0, segmentIndex + 1).map((vertex)=>clone(vertex));
        leading.at(-1).bulge = Math.tan(sweep * location.parameter / 4);
        leading.at(-1).endWidth = middleWidth;
        leading.push(firstEnd);
        const trailing = [
            secondStart,
            ...vertices.slice(segmentIndex + 1).map((vertex)=>clone(vertex))
        ];
        return [
            {
                type,
                payload: changedPolylinePayload(payload, leading)
            },
            {
                type,
                payload: changedPolylinePayload(payload, trailing)
            }
        ];
    }
    throw new KJValidationError(`Break is not implemented for ${type || 'unknown entity'}`);
}
function bulgeArc(startInput, endInput, bulgeInput) {
    const start = point3(startInput), end = point3(endInput), bulge = Number(bulgeInput ?? 0);
    if (Math.abs(bulge) <= 1e-15) return null;
    if (Math.abs(start[2] - end[2]) > 1e-10) throw new KJValidationError('Explode requires bulge arc endpoints in one XY plane');
    const chordVector = subtract2(end, start), chord = length2(chordVector), unit = normalize2(chordVector);
    const centerOffset = chord * (1 / bulge - bulge) / 4;
    if (!Number.isFinite(centerOffset)) throw new KJValidationError('Bulge arc has unbounded geometry');
    const center2 = add2(midpoint2(start, end), multiply2(perpendicular2(unit), centerOffset));
    const center = [
        center2[0],
        center2[1],
        start[2]
    ];
    const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    return {
        center,
        radius: distance2(center, start),
        startAngle,
        endAngle: startAngle + 4 * Math.atan(bulge),
        clockwise: bulge < 0,
        normal: [
            0,
            0,
            1
        ]
    };
}
export function explodeEntity(entity) {
    const payload = entity?.payload ?? {}, type = normalizeName(entity?.type);
    if (![
        'LWPOLYLINE',
        'POLYLINE',
        'REVISION_CLOUD',
        'WIPEOUT'
    ].includes(type)) throw new KJValidationError(`Explode is not implemented for ${type || 'unknown entity'}`);
    const vertices = payload.vertices ?? [];
    const drawingProperties = {};
    for (const key of [
        'layerId',
        'color',
        'trueColor',
        'linetypeId',
        'linetypeName',
        'linetypeScale',
        'lineweight',
        'transparency',
        'visible',
        'thickness',
        'normal',
        'elevation',
        'materialId',
        'plotStyleId'
    ]){
        if (Object.hasOwn(payload, key)) drawingProperties[key] = clone(payload[key]);
    }
    if (payload.normal != null) {
        const normal = point3(payload.normal);
        if (Math.abs(normal[0]) > 1e-12 || Math.abs(normal[1]) > 1e-12 || normal[2] <= 0) throw new KJValidationError('Explode currently requires a positive XY extrusion normal');
    }
    const points = vertices.map((vertex)=>point3(vertex.point ?? vertex));
    const elevation = Number(payload.elevation ?? 0);
    if (!Number.isFinite(elevation)) throw new KJValidationError('Polyline elevation must be finite');
    const useElevation = [
        'LWPOLYLINE',
        'POLYLINE'
    ].includes(type) && !(Number(payload.dxfFlags ?? 0) & 8) && elevation !== 0 && points.every((point)=>point[2] === 0);
    if (useElevation) for (const point of points)point[2] = elevation;
    const count = payload.closed ? vertices.length : vertices.length - 1;
    const result = [];
    for(let index = 0; index < count; index += 1){
        const vertexRecord = vertices[index];
        const start = points[index], end = points[(index + 1) % points.length];
        const arc = bulgeArc(start, end, vertexRecord.bulge);
        result.push(arc ? {
            type: 'ARC',
            payload: {
                ...clone(drawingProperties),
                ...arc
            }
        } : {
            type: 'LINE',
            payload: {
                ...clone(drawingProperties),
                start,
                end
            }
        });
    }
    return result;
}
function boundaryIntersections(target, boundary, targetMode = 'line') {
    const targetPayload = target.payload ?? {}, boundaryPayload = boundary.payload ?? {};
    if (boundary.type === 'LINE') return intersectLineLine2(pointInput(targetPayload.start), pointInput(targetPayload.end), pointInput(boundaryPayload.start), pointInput(boundaryPayload.end), {
        modeA: targetMode,
        modeB: 'segment'
    }).points;
    if (boundary.type === 'RAY' || boundary.type === 'XLINE') return intersectLineLine2(pointInput(targetPayload.start), pointInput(targetPayload.end), pointInput(boundaryPayload.origin), add2(pointInput(boundaryPayload.origin), pointInput(boundaryPayload.direction)), {
        modeA: targetMode,
        modeB: boundary.type === 'RAY' ? 'ray' : 'line'
    }).points;
    if (boundary.type === 'CIRCLE') return intersectLineCircle2(pointInput(targetPayload.start), pointInput(targetPayload.end), pointInput(boundaryPayload.center), Number(boundaryPayload.radius), {
        mode: targetMode
    }).points;
    if (boundary.type === 'ARC') {
        const points = intersectLineCircle2(pointInput(targetPayload.start), pointInput(targetPayload.end), pointInput(boundaryPayload.center), Number(boundaryPayload.radius), {
            mode: targetMode
        }).points;
        const sweep = arcSweep(boundaryPayload);
        const center = point3(boundaryPayload.center), startAngle = Number(boundaryPayload.startAngle);
        return points.filter((point)=>{
            const angle = Math.atan2(point[1] - center[1], point[0] - center[0]);
            return sweep >= 0 ? positiveTurn(angle - startAngle) <= sweep + 1e-10 : positiveTurn(startAngle - angle) <= -sweep + 1e-10;
        });
    }
    throw new KJValidationError(`Line boundary does not support ${String(boundary.type)}`);
}
function linePointAt(payload, parameter) {
    const start = point3(payload.start), end = point3(payload.end);
    return [
        start[0] + (end[0] - start[0]) * parameter,
        start[1] + (end[1] - start[1]) * parameter,
        start[2] + (end[2] - start[2]) * parameter
    ];
}
export function trimLinePayloads(target, boundaries, pickPoint) {
    if (target?.type !== 'LINE') throw new KJValidationError('Trim currently requires a LINE target');
    const targetPayload = payloadOf(target);
    const direction = subtract2(pointInput(targetPayload.end), pointInput(targetPayload.start));
    const pickParameter = projectParameter2(pointInput(pickPoint), pointInput(targetPayload.start), direction);
    const parameters = boundaries.flatMap((boundary)=>boundaryIntersections(target, boundary, 'segment')).map((point)=>projectParameter2(point, pointInput(targetPayload.start), direction)).filter((value)=>value > 1e-10 && value < 1 - 1e-10).sort((a, b)=>a - b);
    const candidates = parameters.filter((value, index)=>index === 0 || value - parameters[index - 1] > 1e-10);
    if (!candidates.length) throw new KJValidationError('No trim intersection lies on the target segment');
    if (candidates.some((value)=>Math.abs(value - pickParameter) <= 1e-10)) throw new KJValidationError('Pick inside the interval to trim, not exactly on a cutting boundary');
    const lower = candidates.filter((value)=>value < pickParameter).at(-1) ?? 0;
    const upper = candidates.find((value)=>value > pickParameter) ?? 1;
    const pieces = [];
    if (lower > 0) pieces.push({
        ...clone(targetPayload),
        start: linePointAt(targetPayload, 0),
        end: linePointAt(targetPayload, lower)
    });
    if (upper < 1) pieces.push({
        ...clone(targetPayload),
        start: linePointAt(targetPayload, upper),
        end: linePointAt(targetPayload, 1)
    });
    return pieces;
}
export function trimLinePayload(target, boundaries, pickPoint) {
    const pieces = trimLinePayloads(target, boundaries, pickPoint);
    if (pieces.length !== 1) throw new KJValidationError('Trim produces multiple line segments; use trimLinePayloads to preserve both sides');
    return pieces[0];
}
export function extendLinePayload(target, boundaries, pickPoint) {
    if (target?.type !== 'LINE') throw new KJValidationError('Extend currently requires a LINE target');
    const targetPayload = target.payload ?? {};
    const direction = subtract2(pointInput(targetPayload.end), pointInput(targetPayload.start));
    const pickParameter = projectParameter2(pointInput(pickPoint), pointInput(targetPayload.start), direction), extendStart = pickParameter < 0.5;
    const candidates = boundaries.flatMap((boundary)=>boundaryIntersections(target, boundary, 'line')).map((point)=>({
            parameter: projectParameter2(point, pointInput(targetPayload.start), direction)
        })).filter((value)=>extendStart ? value.parameter < -1e-10 : value.parameter > 1 + 1e-10).sort((a, b)=>extendStart ? b.parameter - a.parameter : a.parameter - b.parameter);
    if (!candidates.length) throw new KJValidationError('No boundary is available in the selected extension direction');
    const payload = clone(targetPayload);
    payload[extendStart ? 'start' : 'end'] = linePointAt(targetPayload, candidates[0].parameter);
    return payload;
}
const EDIT_ANGLE_EPSILON = 1e-10;
const EDIT_PLANE_EPSILON = 1e-8;
function finiteEditPoint(value) {
    const point = point3(value);
    if (!point.every(Number.isFinite)) throw new KJValidationError('Editing coordinates must be finite');
    return point;
}
function assertEditingXYPlane(payload) {
    const normal = finiteEditPoint(payload.normal ?? [
        0,
        0,
        1
    ]);
    if (Math.abs(normal[0]) > 1e-12 || Math.abs(normal[1]) > 1e-12 || normal[2] <= 0) {
        throw new KJValidationError('Circular editing requires a positive XY extrusion normal');
    }
}
function circularEditGeometry(entity, boundary = false) {
    const payload = payloadOf(entity), circle = entity.type === 'CIRCLE';
    assertEditingXYPlane(payload);
    const center = finiteEditPoint(payload.center), radius = positive(payload.radius, 'Circular radius');
    const start = circle ? 0 : Number(payload.startAngle), end = circle ? TURN : Number(payload.endAngle);
    if (!Number.isFinite(start) || !Number.isFinite(end) || Math.abs(end - start) > TURN + EDIT_ANGLE_EPSILON) {
        throw new KJValidationError('Circular editing requires finite angles spanning at most one turn');
    }
    const direction = !circle && payload.clockwise ? -1 : 1;
    const span = circle ? TURN : Math.abs(arcSweep(payload));
    if (span <= EDIT_ANGLE_EPSILON || !circle && !boundary && span >= TURN - EDIT_ANGLE_EPSILON) {
        throw new KJValidationError('Arc editing requires a non-empty, less-than-full-circle sweep');
    }
    return {
        payload,
        center,
        radius,
        start,
        span,
        direction,
        circle
    };
}
function circularOffset(geometry, point) {
    const angle = Math.atan2(point[1] - geometry.center[1], point[0] - geometry.center[0]);
    const offset = positiveTurn(geometry.direction * (angle - geometry.start));
    return TURN - offset <= EDIT_ANGLE_EPSILON ? 0 : offset;
}
function circularPickOffset(geometry, pickPoint) {
    const point = finiteEditPoint(pickPoint);
    if (distance2(point, geometry.center) <= Math.max(1e-10, geometry.radius * 1e-12)) {
        throw new KJValidationError('Pick a point on the circular portion, not its center');
    }
    const offset = circularOffset(geometry, point);
    if (!geometry.circle && offset > geometry.span + EDIT_ANGLE_EPSILON) {
        throw new KJValidationError('Pick must lie within the target arc sweep');
    }
    return !geometry.circle && Math.abs(offset - geometry.span) <= EDIT_ANGLE_EPSILON ? geometry.span : offset;
}
function assertSameEditPlane(point, elevation) {
    if (Math.abs(point[2] - elevation) > EDIT_PLANE_EPSILON) {
        throw new KJValidationError('Circular target and boundaries must lie in the same XY plane');
    }
}
function circularBoundaryIntersections(target, boundary) {
    const payload = payloadOf(boundary), type = boundary.type;
    if (type === 'LINE' || type === 'RAY' || type === 'XLINE') {
        const start = finiteEditPoint(type === 'LINE' ? payload.start : payload.origin);
        const direction = type === 'LINE' ? subtract2(pointInput(payload.end), start) : vec2(pointInput(payload.direction));
        assertSameEditPlane(start, target.center[2]);
        if (type === 'LINE') assertSameEditPlane(finiteEditPoint(payload.end), target.center[2]);
        else if (Math.abs(finiteEditPoint(payload.direction)[2]) > EDIT_PLANE_EPSILON) {
            throw new KJValidationError('Circular editing requires boundary directions in the XY plane');
        }
        assertEditingXYPlane(payload);
        const magnitude = Math.hypot(direction[0], direction[1]);
        if (!Number.isFinite(magnitude) || magnitude === 0) throw new KJValidationError('Circular boundary requires a non-zero finite XY direction');
        const unit = [
            direction[0] / magnitude,
            direction[1] / magnitude
        ];
        const relative = subtract2(target.center, start);
        const signedDistance = cross2(unit, relative) / target.radius;
        if (Math.abs(signedDistance) > 1 + EDIT_ANGLE_EPSILON) return [];
        const nearest = [
            unit[1] * signedDistance,
            -unit[0] * signedDistance
        ];
        const intersections = intersectLineCircle2(nearest, add2(nearest, unit), [
            0,
            0
        ], 1, {
            mode: 'line'
        }).points;
        return intersections.filter((point)=>{
            const along = dot2(relative, unit) + dot2(point, unit) * target.radius;
            return type === 'XLINE' || along >= -EDIT_PLANE_EPSILON && (type === 'RAY' || along <= magnitude + EDIT_PLANE_EPSILON);
        }).map((point)=>[
                target.center[0] + point[0] * target.radius,
                target.center[1] + point[1] * target.radius
            ]);
    }
    if (type === 'CIRCLE' || type === 'ARC') {
        const other = circularEditGeometry(boundary, true);
        assertSameEditPlane(other.center, target.center[2]);
        const result = intersectCircleCircle2(target.center, target.radius, other.center, other.radius);
        if (result.kind === 'overlap') throw new KJValidationError('Coincident circular boundaries do not define an unambiguous cut');
        return other.circle ? result.points : result.points.filter((point)=>circularOffset(other, point) <= other.span + EDIT_ANGLE_EPSILON);
    }
    throw new KJValidationError(`Circular boundary does not support ${String(type)}`);
}
function circularCutOffsets(target, boundaries) {
    const offsets = boundaries.flatMap((boundary)=>circularBoundaryIntersections(target, boundary)).map((point)=>circularOffset(target, point)).sort((a, b)=>a - b);
    return offsets.filter((value, index)=>index === 0 || value - offsets[index - 1] > EDIT_ANGLE_EPSILON);
}
function rejectExactCircularCut(pick, cuts) {
    if (cuts.some((cut)=>Math.min(Math.abs(cut - pick), TURN - Math.abs(cut - pick)) <= EDIT_ANGLE_EPSILON)) {
        throw new KJValidationError('Pick inside the interval, not exactly on a cutting boundary');
    }
}
function circularResultPayload(geometry, first, last) {
    const payload = clone(geometry.payload);
    for (const key of [
        'rawTags',
        'rawData',
        'originalType',
        'fullCircle'
    ])delete payload[key];
    return {
        ...payload,
        center: [
            ...geometry.center
        ],
        radius: geometry.radius,
        startAngle: positiveTurn(geometry.start + geometry.direction * first),
        endAngle: positiveTurn(geometry.start + geometry.direction * last),
        clockwise: geometry.direction < 0
    };
}
function ellipseEditGeometry(entity) {
    const payload = payloadOf(entity);
    assertEditingXYPlane(payload);
    const center = finiteEditPoint(payload.center), majorAxis = finiteEditPoint(payload.majorAxis);
    if (Math.abs(majorAxis[2]) > EDIT_PLANE_EPSILON) throw new KJValidationError('Ellipse editing requires a major axis in the XY plane');
    const majorLength = Math.hypot(majorAxis[0], majorAxis[1]);
    if (!Number.isFinite(majorLength) || majorLength <= EDIT_PLANE_EPSILON) throw new KJValidationError('Ellipse editing requires a non-zero finite major axis');
    const ratio = positive(payload.ratio, 'Ellipse ratio');
    if (ratio > 1) throw new KJValidationError('Ellipse ratio cannot exceed 1');
    const start = Number(payload.startParameter ?? 0), end = Number(payload.endParameter ?? TURN), rawSpan = end - start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || rawSpan < -EDIT_ANGLE_EPSILON || rawSpan > TURN + EDIT_ANGLE_EPSILON) {
        throw new KJValidationError('Ellipse editing requires finite increasing parameters spanning at most one turn');
    }
    const full = Math.abs(rawSpan - TURN) <= EDIT_ANGLE_EPSILON;
    if (!full && rawSpan <= EDIT_ANGLE_EPSILON) throw new KJValidationError('Elliptical arc editing requires a non-empty parameter span');
    return {
        payload,
        center,
        majorAxis,
        majorLength,
        ratio,
        start,
        span: full ? TURN : rawSpan,
        full
    };
}
function ellipseUnitPoint(geometry, point) {
    const dx = point[0] - geometry.center[0], dy = point[1] - geometry.center[1];
    const ux = geometry.majorAxis[0] / geometry.majorLength, uy = geometry.majorAxis[1] / geometry.majorLength;
    return [
        (dx * ux + dy * uy) / geometry.majorLength,
        (-dx * uy + dy * ux) / (geometry.majorLength * geometry.ratio)
    ];
}
function ellipseOffset(geometry, unitPoint) {
    const offset = positiveTurn(Math.atan2(unitPoint[1], unitPoint[0]) - geometry.start);
    return TURN - offset <= EDIT_ANGLE_EPSILON ? 0 : offset;
}
function ellipsePickOffset(geometry, pickPoint) {
    const unitPoint = ellipseUnitPoint(geometry, finiteEditPoint(pickPoint));
    if (Math.hypot(unitPoint[0], unitPoint[1]) <= EDIT_PLANE_EPSILON) throw new KJValidationError('Pick a point on the elliptical portion, not its center');
    const offset = ellipseOffset(geometry, unitPoint);
    if (!geometry.full && offset > geometry.span + EDIT_ANGLE_EPSILON) throw new KJValidationError('Pick must lie within the target elliptical arc');
    return !geometry.full && Math.abs(offset - geometry.span) <= EDIT_ANGLE_EPSILON ? geometry.span : offset;
}
function ellipseBoundaryOffsets(target, boundary) {
    const payload = payloadOf(boundary), type = boundary.type;
    if (type !== 'LINE' && type !== 'RAY' && type !== 'XLINE') {
        throw new KJValidationError(`ELLIPSE editing boundaries support LINE, RAY or XLINE, not ${String(type)}`);
    }
    const start = finiteEditPoint(type === 'LINE' ? payload.start : payload.origin);
    const direction = type === 'LINE' ? null : finiteEditPoint(payload.direction);
    const end = type === 'LINE' ? finiteEditPoint(payload.end) : [
        start[0] + direction[0],
        start[1] + direction[1],
        start[2]
    ];
    assertSameEditPlane(start, target.center[2]);
    if (type === 'LINE') assertSameEditPlane(end, target.center[2]);
    else if (Math.abs(finiteEditPoint(payload.direction)[2]) > EDIT_PLANE_EPSILON) {
        throw new KJValidationError('Ellipse editing requires boundary directions in the XY plane');
    }
    assertEditingXYPlane(payload);
    const unitStart = ellipseUnitPoint(target, start), unitEnd = ellipseUnitPoint(target, end);
    if (distance2(unitStart, unitEnd) <= EDIT_PLANE_EPSILON) throw new KJValidationError('Ellipse boundary requires a non-zero finite XY direction');
    const mode = type === 'LINE' ? 'segment' : type === 'RAY' ? 'ray' : 'line';
    return intersectLineCircle2(unitStart, unitEnd, [
        0,
        0
    ], 1, {
        mode
    }).points.map((point)=>ellipseOffset(target, point));
}
function ellipseCutOffsets(target, boundaries) {
    const offsets = boundaries.flatMap((boundary)=>ellipseBoundaryOffsets(target, boundary)).sort((a, b)=>a - b);
    return offsets.filter((value, index)=>index === 0 || value - offsets[index - 1] > EDIT_ANGLE_EPSILON);
}
function ellipseResultPayload(geometry, first, last) {
    const payload = clone(geometry.payload);
    for (const key of [
        'rawTags',
        'rawData',
        'originalType',
        'fullEllipse'
    ])delete payload[key];
    return {
        ...payload,
        center: [
            ...geometry.center
        ],
        majorAxis: [
            ...geometry.majorAxis
        ],
        ratio: geometry.ratio,
        startParameter: geometry.start + first,
        endParameter: geometry.start + last
    };
}
function trimEllipsePayloads(target, boundaries, pickPoint) {
    const geometry = ellipseEditGeometry(target), pick = ellipsePickOffset(geometry, pickPoint);
    const cuts = ellipseCutOffsets(geometry, boundaries);
    rejectExactCircularCut(pick, cuts);
    if (geometry.full) {
        if (cuts.length < 2) throw new KJValidationError('Full ellipse trim requires at least two distinct cutting points');
        const lower = cuts.filter((value)=>value < pick).at(-1) ?? cuts.at(-1) - TURN;
        const upper = cuts.find((value)=>value > pick) ?? cuts[0] + TURN;
        return [
            {
                type: 'ELLIPSE',
                payload: ellipseResultPayload(geometry, upper, lower + TURN)
            }
        ];
    }
    const interior = cuts.filter((value)=>value > EDIT_ANGLE_EPSILON && value < geometry.span - EDIT_ANGLE_EPSILON);
    if (!interior.length) throw new KJValidationError('No trim intersection lies inside the target elliptical arc');
    const lower = interior.filter((value)=>value < pick).at(-1) ?? 0;
    const upper = interior.find((value)=>value > pick) ?? geometry.span;
    const pieces = [];
    if (lower > EDIT_ANGLE_EPSILON) pieces.push({
        type: 'ELLIPSE',
        payload: ellipseResultPayload(geometry, 0, lower)
    });
    if (upper < geometry.span - EDIT_ANGLE_EPSILON) pieces.push({
        type: 'ELLIPSE',
        payload: ellipseResultPayload(geometry, upper, geometry.span)
    });
    return pieces;
}
function extendEllipsePayload(target, boundaries, pickPoint) {
    const geometry = ellipseEditGeometry(target);
    if (geometry.full) throw new KJValidationError('A full ellipse has no endpoint to extend');
    const pick = ellipsePickOffset(geometry, pickPoint);
    if (Math.abs(pick - geometry.span / 2) <= EDIT_ANGLE_EPSILON) throw new KJValidationError('Pick closer to the elliptical arc end to extend, not its midpoint');
    const cuts = ellipseCutOffsets(geometry, boundaries);
    rejectExactCircularCut(pick, cuts);
    const outside = cuts.filter((value)=>value > geometry.span + EDIT_ANGLE_EPSILON && value < TURN - EDIT_ANGLE_EPSILON);
    if (!outside.length) throw new KJValidationError('No boundary is available before the elliptical arc reaches its opposite end');
    return pick < geometry.span / 2 ? ellipseResultPayload(geometry, outside.at(-1) - TURN, geometry.span) : ellipseResultPayload(geometry, 0, outside[0]);
}
function rejectAmbiguousLineBoundaries(target, boundaries, mode) {
    const payload = payloadOf(target);
    for (const boundary of boundaries){
        const other = payloadOf(boundary);
        if (boundary.type === 'CIRCLE' || boundary.type === 'ARC') assertEditingXYPlane(other);
        if (![
            'LINE',
            'RAY',
            'XLINE'
        ].includes(String(boundary.type))) continue;
        const start = boundary.type === 'LINE' ? pointInput(other.start) : pointInput(other.origin);
        const end = boundary.type === 'LINE' ? pointInput(other.end) : add2(start, pointInput(other.direction));
        const result = intersectLineLine2(pointInput(payload.start), pointInput(payload.end), start, end, {
            modeA: mode,
            modeB: boundary.type === 'LINE' ? 'segment' : boundary.type === 'RAY' ? 'ray' : 'line'
        });
        if (result.kind === 'overlap') {
            const direction = subtract2(pointInput(payload.end), pointInput(payload.start));
            const first = projectParameter2(start, pointInput(payload.start), direction);
            const last = projectParameter2(end, pointInput(payload.start), direction);
            const lower = boundary.type === 'XLINE' || boundary.type === 'RAY' && last < first ? -Infinity : Math.min(first, last);
            const upper = boundary.type === 'XLINE' || boundary.type === 'RAY' && last > first ? Infinity : Math.max(first, last);
            const overlapStart = Math.max(mode === 'segment' ? 0 : -Infinity, boundary.type === 'RAY' && last > first ? first : lower);
            const overlapEnd = Math.min(mode === 'segment' ? 1 : Infinity, boundary.type === 'RAY' && last < first ? first : upper);
            if (overlapEnd - overlapStart > EDIT_ANGLE_EPSILON) throw new KJValidationError('Overlapping line boundaries do not define an unambiguous cut');
        }
    }
}
export function trimEntityPayloads(target, boundaries, pickPoint) {
    if (target?.type === 'LINE') {
        rejectAmbiguousLineBoundaries(target, boundaries, 'segment');
        return trimLinePayloads(target, boundaries, pickPoint).map((payload)=>({
                type: 'LINE',
                payload
            }));
    }
    if (target?.type === 'LWPOLYLINE' || target?.type === 'POLYLINE') return trimPolylinePayloads(target, boundaries, pickPoint);
    if (target?.type === 'ELLIPSE') return trimEllipsePayloads(target, boundaries, pickPoint);
    if (target?.type !== 'ARC' && target?.type !== 'CIRCLE') throw new KJValidationError('Trim requires a LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE or POLYLINE target');
    const geometry = circularEditGeometry(target), pick = circularPickOffset(geometry, pickPoint);
    const cuts = circularCutOffsets(geometry, boundaries);
    rejectExactCircularCut(pick, cuts);
    if (geometry.circle) {
        if (cuts.length < 2) throw new KJValidationError('Circle trim requires at least two distinct cutting points');
        const lower = cuts.filter((value)=>value < pick).at(-1) ?? cuts.at(-1) - TURN;
        const upper = cuts.find((value)=>value > pick) ?? cuts[0] + TURN;
        return [
            {
                type: 'ARC',
                payload: circularResultPayload(geometry, upper, lower + TURN)
            }
        ];
    }
    const interior = cuts.filter((value)=>value > EDIT_ANGLE_EPSILON && value < geometry.span - EDIT_ANGLE_EPSILON);
    if (!interior.length) throw new KJValidationError('No trim intersection lies inside the target arc');
    const lower = interior.filter((value)=>value < pick).at(-1) ?? 0;
    const upper = interior.find((value)=>value > pick) ?? geometry.span;
    const pieces = [];
    if (lower > EDIT_ANGLE_EPSILON) pieces.push({
        type: 'ARC',
        payload: circularResultPayload(geometry, 0, lower)
    });
    if (upper < geometry.span - EDIT_ANGLE_EPSILON) pieces.push({
        type: 'ARC',
        payload: circularResultPayload(geometry, upper, geometry.span)
    });
    return pieces;
}
export function extendEntityPayload(target, boundaries, pickPoint) {
    if (target?.type === 'LINE') {
        rejectAmbiguousLineBoundaries(target, boundaries, 'line');
        return extendLinePayload(target, boundaries, pickPoint);
    }
    if (target?.type === 'LWPOLYLINE' || target?.type === 'POLYLINE') return extendPolylinePayload(target, boundaries, pickPoint);
    if (target?.type === 'ELLIPSE') return extendEllipsePayload(target, boundaries, pickPoint);
    if (target?.type !== 'ARC') throw new KJValidationError('Extend requires a LINE, ARC, elliptical arc or open LWPOLYLINE/POLYLINE target');
    const geometry = circularEditGeometry(target), pick = circularPickOffset(geometry, pickPoint);
    if (Math.abs(pick - geometry.span / 2) <= EDIT_ANGLE_EPSILON) throw new KJValidationError('Pick closer to the arc end to extend, not its midpoint');
    const cuts = circularCutOffsets(geometry, boundaries);
    rejectExactCircularCut(pick, cuts);
    const outside = cuts.filter((value)=>value > geometry.span + EDIT_ANGLE_EPSILON && value < TURN - EDIT_ANGLE_EPSILON);
    if (!outside.length) throw new KJValidationError('No boundary is available before the arc reaches its opposite end');
    return pick < geometry.span / 2 ? circularResultPayload(geometry, outside.at(-1) - TURN, geometry.span) : circularResultPayload(geometry, 0, outside[0]);
}
function lengthenEndpoint(options, start, end) {
    if (options.endpoint != null) {
        const endpoint = String(options.endpoint).trim().toLowerCase();
        if (endpoint === 'start' || endpoint === 'end') return endpoint;
        throw new KJValidationError('Lengthen endpoint must be start or end');
    }
    if (options.pickPoint == null) throw new KJValidationError('Lengthen requires endpoint or pickPoint');
    const pick = finiteEditPoint(options.pickPoint);
    const startDistance = distance2(pick, start), endDistance = distance2(pick, end);
    if (Math.abs(startDistance - endDistance) <= Math.max(1e-12, Math.max(startDistance, endDistance) * 1e-12)) throw new KJValidationError('Pick closer to one endpoint to lengthen');
    return startDistance < endDistance ? 'start' : 'end';
}
function lengthenMode(options) {
    const mode = normalizeName(options.mode ?? (options.targetPoint != null || options.point != null ? 'DYNAMIC' : options.delta != null ? 'DELTA' : options.percent != null ? 'PERCENT' : 'TOTAL'));
    if (![
        'TOTAL',
        'DELTA',
        'PERCENT',
        'DYNAMIC'
    ].includes(mode)) throw new KJValidationError('Lengthen mode must be TOTAL, DELTA, PERCENT or DYNAMIC');
    return mode;
}
function numericLengthenTarget(current, options, mode) {
    const raw = mode === 'TOTAL' ? options.totalLength ?? options.value : mode === 'DELTA' ? options.delta ?? options.value : options.percent ?? options.value;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new KJValidationError(`Lengthen ${mode.toLowerCase()} value must be finite`);
    const target = mode === 'TOTAL' ? value : mode === 'DELTA' ? current + value : current * value / 100;
    if (!(target > 1e-12) || !Number.isFinite(target)) throw new KJValidationError('Lengthen result must have positive finite length');
    return target;
}
function lengthenLinePayload(target, options) {
    const payload = payloadOf(target), start = finiteEditPoint(payload.start), end = finiteEditPoint(payload.end);
    const current = distance2(start, end);
    if (!(current > 1e-12)) throw new KJValidationError('Lengthen requires a non-degenerate LINE');
    const endpoint = lengthenEndpoint(options, start, end), fixed = endpoint === 'start' ? end : start, selected = endpoint === 'start' ? start : end;
    const mode = lengthenMode(options);
    let requested;
    if (mode === 'DYNAMIC') {
        const point = finiteEditPoint(options.targetPoint ?? options.point);
        const unit = [
            (selected[0] - fixed[0]) / current,
            (selected[1] - fixed[1]) / current
        ];
        requested = dot2(subtract2(point, fixed), unit);
        if (!(requested > 1e-12)) throw new KJValidationError('Dynamic lengthen point must remain beyond the fixed endpoint');
    } else requested = numericLengthenTarget(current, options, mode);
    const factor = requested / current;
    const next = [
        fixed[0] + (selected[0] - fixed[0]) * factor,
        fixed[1] + (selected[1] - fixed[1]) * factor,
        fixed[2] + (selected[2] - fixed[2]) * factor
    ];
    payload[endpoint] = next;
    return payload;
}
export function lengthenEntityPayload(target, options = {}) {
    if (target?.type === 'LINE') return lengthenLinePayload(target, options);
    if (target?.type !== 'ARC') throw new KJValidationError('Lengthen requires a LINE or ARC target');
    const geometry = circularEditGeometry(target);
    const startPoint = polar(geometry.center, geometry.radius, geometry.start);
    const endPoint = polar(geometry.center, geometry.radius, geometry.start + geometry.direction * geometry.span);
    const endpoint = lengthenEndpoint(options, startPoint, endPoint), mode = lengthenMode(options);
    let targetSpan;
    if (mode === 'DYNAMIC') {
        const point = finiteEditPoint(options.targetPoint ?? options.point);
        if (distance2(point, geometry.center) <= Math.max(1e-10, geometry.radius * 1e-12)) throw new KJValidationError('Dynamic arc lengthen point cannot be its center');
        const offset = circularOffset(geometry, point);
        targetSpan = endpoint === 'end' ? offset : positiveTurn(geometry.span - offset);
    } else targetSpan = numericLengthenTarget(geometry.radius * geometry.span, options, mode) / geometry.radius;
    if (!(targetSpan > EDIT_ANGLE_EPSILON) || targetSpan >= TURN - EDIT_ANGLE_EPSILON) throw new KJValidationError('Lengthened arc must remain non-empty and less than a full circle');
    return endpoint === 'end' ? circularResultPayload(geometry, 0, targetSpan) : circularResultPayload(geometry, geometry.span - targetSpan, geometry.span);
}
function stretchDefinition(options) {
    const first = vec2(pointInput(options.crossingStart ?? options.firstPoint), 'crossingStart');
    const second = vec2(pointInput(options.crossingEnd ?? options.secondPoint), 'crossingEnd');
    if (first[0] === second[0] || first[1] === second[1]) throw new KJValidationError('Stretch crossing window must have positive width and height');
    let dx, dy;
    if (options.from != null || options.to != null) {
        if (options.from == null || options.to == null) throw new KJValidationError('Stretch displacement requires both from and to points');
        const from = vec2(pointInput(options.from), 'from'), to = vec2(pointInput(options.to), 'to');
        dx = to[0] - from[0];
        dy = to[1] - from[1];
    } else {
        dx = Number(options.dx ?? 0);
        dy = Number(options.dy ?? 0);
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new KJValidationError('Stretch displacement must be finite');
    if (dx === 0 && dy === 0) throw new KJValidationError('Stretch displacement must be non-zero');
    return {
        min: [
            Math.min(first[0], second[0]),
            Math.min(first[1], second[1])
        ],
        max: [
            Math.max(first[0], second[0]),
            Math.max(first[1], second[1])
        ],
        dx,
        dy
    };
}
function stretchPoint(value, definition) {
    const point = finiteEditPoint(value), epsilon = 1e-12;
    const affected = point[0] >= definition.min[0] - epsilon && point[0] <= definition.max[0] + epsilon && point[1] >= definition.min[1] - epsilon && point[1] <= definition.max[1] + epsilon;
    return {
        point: affected ? [
            point[0] + definition.dx,
            point[1] + definition.dy,
            point[2]
        ] : point,
        affected
    };
}
export function stretchEntityPayload(target, options = {}) {
    const payload = payloadOf(target), type = normalizeName(target?.type), definition = stretchDefinition(options);
    if (type === 'LINE') {
        const start = stretchPoint(payload.start, definition), end = stretchPoint(payload.end, definition);
        return start.affected || end.affected ? {
            ...payload,
            start: start.point,
            end: end.point
        } : null;
    }
    if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
        const vertices = payload.vertices;
        if (!Array.isArray(vertices) || vertices.length < 2) throw new KJValidationError('Stretch requires a polyline with at least two vertices');
        let affected = false;
        const next = vertices.map((vertex)=>{
            const result = stretchPoint(vertex.point ?? vertex, definition);
            affected ||= result.affected;
            return Array.isArray(vertex) ? result.point : {
                ...clone(vertex),
                point: result.point
            };
        });
        return affected ? {
            ...payload,
            vertices: next
        } : null;
    }
    throw new KJValidationError(`Stretch is not implemented for ${type || 'unknown entity'}`);
}
function polylineEditIndex(value, label, maximumExclusive) {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= maximumExclusive) {
        throw new KJValidationError(`${label} must be an integer from 0 to ${Math.max(0, maximumExclusive - 1)}`);
    }
    return index;
}
function polylineEditTolerance(value) {
    const tolerance = Number(value ?? 1e-8);
    if (!Number.isFinite(tolerance) || tolerance < 0) throw new KJValidationError('Polyline edit tolerance must be a non-negative finite number');
    return tolerance;
}
function editablePolylineVertices(payload) {
    const source = payload.vertices;
    if (!Array.isArray(source) || source.length < 2) throw new KJValidationError('PEDIT requires a polyline with at least two vertices');
    return source.map((value, index)=>{
        const record = Array.isArray(value) ? {} : clone(value);
        const point = finiteEditPoint(value?.point ?? value);
        const bulge = Number(record.bulge ?? 0), startWidth = Number(record.startWidth ?? 0), endWidth = Number(record.endWidth ?? 0);
        if (![
            bulge,
            startWidth,
            endWidth
        ].every(Number.isFinite)) throw new KJValidationError(`PEDIT found invalid segment data at vertex ${index}`);
        return {
            ...record,
            point,
            bulge,
            startWidth,
            endWidth
        };
    });
}
function assertEditablePolylineTopology(type, payload, vertices) {
    const flags = Number(payload.dxfFlags ?? 0);
    if (!Number.isFinite(flags)) throw new KJValidationError('PEDIT requires finite polyline flags');
    if (type === 'POLYLINE' && flags & (2 | 4 | 8 | 16 | 64)) {
        throw new KJValidationError('PEDIT supports ordinary 2D POLYLINE entities, not fitted, 3D, mesh or polyface topology');
    }
    if (type === 'POLYLINE' && vertices.some((vertex)=>Number(vertex.dxfFlags ?? 0) & (16 | 32 | 64 | 128))) {
        throw new KJValidationError('PEDIT supports ordinary 2D POLYLINE vertices, not spline, 3D, mesh or polyface vertices');
    }
}
const POLYLINE_BOUND = 1e12;
const POLYLINE_SEGMENT_LIMIT = 20000;
function editableBoundaryPolyline(target, operation) {
    const type = normalizeName(target.type);
    const payload = payloadOf(target), vertices = editablePolylineVertices(payload);
    assertEditablePolylineTopology(type, payload, vertices);
    positiveXYNormal(payload, `${operation} polyline`);
    const elevation = Number(payload.elevation ?? 0);
    if (!Number.isFinite(elevation) || Math.abs(elevation) > POLYLINE_BOUND) throw new KJValidationError(`${operation} polyline elevation is outside the supported finite range`);
    if (payload.closed === true) throw new KJValidationError(`${operation} currently supports open polylines; closed polylines require an explicit seam`);
    if (vertices.length > POLYLINE_SEGMENT_LIMIT + 1) throw new KJValidationError(`${operation} supports at most ${POLYLINE_SEGMENT_LIMIT} polyline segments`);
    if (vertices.some((vertex)=>vertex.point.some((value)=>Math.abs(value) > POLYLINE_BOUND) || Math.abs(vertex.bulge) > POLYLINE_BOUND || vertex.startWidth < 0 || vertex.endWidth < 0 || vertex.startWidth > POLYLINE_BOUND || vertex.endWidth > POLYLINE_BOUND)) {
        throw new KJValidationError(`${operation} polyline geometry is outside the supported finite range`);
    }
    for(let index = 0; index < vertices.length - 1; index += 1){
        if (distance3(vertices[index].point, vertices[index + 1].point) <= 1e-12) {
            throw new KJValidationError(`${operation} cannot edit a polyline with a zero-length segment`);
        }
    }
    return {
        type: type,
        payload,
        vertices
    };
}
function distanceToPolylineSegment(start, end, bulge, pick) {
    const arc = bulgeArc(start, end, bulge);
    if (!arc) {
        const direction = subtract2(end, start), squared = dot2(direction, direction);
        const parameter = Math.max(0, Math.min(1, dot2(subtract2(pick, start), direction) / squared));
        return distance2(pick, add2(start, multiply2(direction, parameter)));
    }
    const radial = distance2(pick, arc.center);
    if (!(radial > 1e-15)) return arc.radius;
    const angle = Math.atan2(pick[1] - arc.center[1], pick[0] - arc.center[0]);
    const sweep = 4 * Math.atan(bulge), offset = sweep > 0 ? positiveTurn(angle - arc.startAngle) : positiveTurn(arc.startAngle - angle);
    if (offset <= Math.abs(sweep) + EDIT_ANGLE_EPSILON) return Math.abs(radial - arc.radius);
    return Math.min(distance2(pick, start), distance2(pick, end));
}
function pickedPolylineSegment(vertices, pickPoint, closed = false) {
    const pick = finiteEditPoint(pickPoint);
    const segmentCount = polylineSegmentCount(vertices, closed);
    const candidates = vertices.slice(0, segmentCount).map((vertex, index)=>({
            index,
            distance: distanceToPolylineSegment(vertex.point, vertices[(index + 1) % vertices.length].point, vertex.bulge, pick)
        })).sort((left, right)=>left.distance - right.distance || left.index - right.index);
    const first = candidates[0], second = candidates[1];
    if (second && Math.abs(second.distance - first.distance) <= Math.max(1e-10, first.distance * 1e-10)) {
        throw new KJValidationError('Pick inside one polyline segment, not on a shared vertex');
    }
    return first.index;
}
function pickedPolylineVertex(vertices, pickPoint, tolerance) {
    const pick = finiteEditPoint(pickPoint);
    const candidates = vertices.map((vertex, index)=>({
            index,
            distance: distance2(vertex.point, pick)
        })).sort((left, right)=>left.distance - right.distance || left.index - right.index);
    const first = candidates[0], second = candidates[1];
    if (first.distance > Math.max(tolerance, 1e-10)) throw new KJValidationError('PEDIT delete point is outside the selected vertex tolerance');
    if (second && Math.abs(second.distance - first.distance) <= Math.max(1e-10, first.distance * 1e-10)) {
        throw new KJValidationError('PEDIT delete point must identify one unique vertex');
    }
    return first.index;
}
function interpolatePolylineWidth(vertex, parameter) {
    return vertex.startWidth + (vertex.endWidth - vertex.startWidth) * parameter;
}
function polylinePointAt(start, end, parameter) {
    return [
        start[0] + (end[0] - start[0]) * parameter,
        start[1] + (end[1] - start[1]) * parameter,
        start[2] + (end[2] - start[2]) * parameter
    ];
}
function polylineArcPayload(payload, vertices, source, next) {
    if (Math.abs(source.point[2] - next.point[2]) > EDIT_PLANE_EPSILON) throw new KJValidationError('Bulge editing requires segment endpoints in one XY plane');
    const elevation = Number(payload.elevation ?? 0);
    const useElevation = elevation !== 0 && vertices.every((vertex)=>vertex.point[2] === 0);
    const start = [
        source.point[0],
        source.point[1],
        useElevation ? elevation : source.point[2]
    ];
    const end = [
        next.point[0],
        next.point[1],
        useElevation ? elevation : next.point[2]
    ];
    const arc = bulgeArc(start, end, source.bulge);
    if (!arc || ![
        ...arc.center,
        arc.radius,
        arc.startAngle,
        arc.endAngle
    ].every(Number.isFinite)) throw new KJValidationError('Bulge editing requires a bounded non-degenerate circular segment');
    return arc;
}
function pointOnPolylineSegment(payload, vertices, source, next, parameter) {
    if (Math.abs(source.bulge) <= 1e-15) return polylinePointAt(source.point, next.point, parameter);
    const arc = polylineArcPayload(payload, vertices, source, next), sweep = 4 * Math.atan(source.bulge);
    const angle = arc.startAngle + sweep * parameter;
    return [
        arc.center[0] + arc.radius * Math.cos(angle),
        arc.center[1] + arc.radius * Math.sin(angle),
        source.point[2]
    ];
}
function trimPolylineInterval(payload, vertices, source, next, boundaries, pickPoint) {
    if (Math.abs(source.bulge) <= 1e-15) {
        const segment = {
            type: 'LINE',
            payload: {
                start: source.point,
                end: next.point
            }
        };
        rejectAmbiguousLineBoundaries(segment, boundaries, 'segment');
        const retained = trimLinePayloads(segment, boundaries, pickPoint), direction = subtract2(next.point, source.point);
        const parameter = (point)=>projectParameter2(pointInput(point), source.point, direction);
        const first = retained[0], last = retained.at(-1);
        return {
            lower: Math.abs(parameter(first.start)) <= EDIT_ANGLE_EPSILON ? parameter(first.end) : 0,
            upper: Math.abs(parameter(last.end) - 1) <= EDIT_ANGLE_EPSILON ? parameter(last.start) : 1
        };
    }
    const geometry = circularEditGeometry({
        type: 'ARC',
        payload: polylineArcPayload(payload, vertices, source, next)
    });
    const pick = circularPickOffset(geometry, pickPoint), cuts = circularCutOffsets(geometry, boundaries);
    rejectExactCircularCut(pick, cuts);
    const interior = cuts.filter((value)=>value > EDIT_ANGLE_EPSILON && value < geometry.span - EDIT_ANGLE_EPSILON);
    if (!interior.length) throw new KJValidationError('No trim intersection lies inside the selected bulge arc');
    return {
        lower: (interior.filter((value)=>value < pick).at(-1) ?? 0) / geometry.span,
        upper: (interior.find((value)=>value > pick) ?? geometry.span) / geometry.span
    };
}
function changedPolylinePayload(payload, vertices) {
    const result = {
        ...clone(payload),
        vertices: clone(vertices),
        closed: false
    };
    for (const key of [
        'rawTags',
        'rawData',
        'originalType'
    ])delete result[key];
    return result;
}
function trimPolylinePayloads(target, boundaries, pickPoint) {
    const { type, payload, vertices } = editableBoundaryPolyline(target, 'TRIM');
    const segmentIndex = pickedPolylineSegment(vertices, pickPoint), source = vertices[segmentIndex], next = vertices[segmentIndex + 1];
    const { lower, upper } = trimPolylineInterval(payload, vertices, source, next, boundaries, pickPoint);
    const sweep = 4 * Math.atan(source.bulge);
    const pieces = [];
    const upstream = vertices.slice(0, segmentIndex + 1).map((vertex)=>clone(vertex));
    if (lower > EDIT_ANGLE_EPSILON) {
        upstream.at(-1).bulge = Math.tan(sweep * lower / 4);
        upstream.at(-1).endWidth = interpolatePolylineWidth(source, lower);
        upstream.push({
            ...clone(next),
            point: pointOnPolylineSegment(payload, vertices, source, next, lower),
            bulge: 0,
            startWidth: interpolatePolylineWidth(source, lower),
            endWidth: interpolatePolylineWidth(source, lower)
        });
    } else upstream.at(-1).bulge = 0;
    if (upstream.length >= 2) pieces.push(upstream);
    const downstream = vertices.slice(segmentIndex + 1).map((vertex)=>clone(vertex));
    if (upper < 1 - EDIT_ANGLE_EPSILON) downstream.unshift({
        ...clone(source),
        point: pointOnPolylineSegment(payload, vertices, source, next, upper),
        bulge: Math.tan(sweep * (1 - upper) / 4),
        startWidth: interpolatePolylineWidth(source, upper),
        endWidth: source.endWidth
    });
    if (downstream.length >= 2) pieces.push(downstream);
    if (!pieces.length) throw new KJValidationError('TRIM must retain at least one polyline segment');
    return pieces.map((piece)=>({
            type,
            payload: changedPolylinePayload(payload, piece)
        }));
}
function extendPolylinePayload(target, boundaries, pickPoint) {
    const { payload, vertices } = editableBoundaryPolyline(target, 'EXTEND'), pick = finiteEditPoint(pickPoint);
    const startDistance = distance2(pick, vertices[0].point), endDistance = distance2(pick, vertices.at(-1).point);
    if (Math.abs(startDistance - endDistance) <= Math.max(1e-10, Math.max(startDistance, endDistance) * 1e-10)) {
        throw new KJValidationError('Pick closer to one open polyline endpoint to extend');
    }
    const extendStart = startDistance < endDistance, segmentIndex = extendStart ? 0 : vertices.length - 2;
    const source = vertices[segmentIndex], next = vertices[segmentIndex + 1];
    const output = vertices.map((vertex)=>clone(vertex));
    if (Math.abs(source.bulge) <= 1e-15) {
        const segment = {
            type: 'LINE',
            payload: {
                start: source.point,
                end: next.point
            }
        };
        rejectAmbiguousLineBoundaries(segment, boundaries, 'line');
        const extended = extendLinePayload(segment, boundaries, extendStart ? source.point : next.point);
        if (extendStart) output[0].point = finiteEditPoint(extended.start);
        else output.at(-1).point = finiteEditPoint(extended.end);
    } else {
        const arc = polylineArcPayload(payload, vertices, source, next);
        const arcCenter = finiteEditPoint(arc.center), arcRadius = Number(arc.radius);
        const endpoint = (angle)=>[
                arcCenter[0] + arcRadius * Math.cos(angle),
                arcCenter[1] + arcRadius * Math.sin(angle),
                arcCenter[2]
            ];
        const extended = extendEntityPayload({
            type: 'ARC',
            payload: arc
        }, boundaries, endpoint(Number(extendStart ? arc.startAngle : arc.endAngle)));
        const signedSweep = arcSweep(extended), bulge = Math.tan(signedSweep / 4);
        if (!Number.isFinite(bulge)) throw new KJValidationError('EXTEND bulge result is outside the supported finite range');
        output[segmentIndex].bulge = bulge;
        const center = finiteEditPoint(extended.center);
        const angle = Number(extendStart ? extended.startAngle : extended.endAngle);
        const point = [
            center[0] + Number(extended.radius) * Math.cos(angle),
            center[1] + Number(extended.radius) * Math.sin(angle),
            extendStart ? source.point[2] : next.point[2]
        ];
        if (extendStart) output[0].point = point;
        else output.at(-1).point = point;
    }
    return changedPolylinePayload(payload, output);
}
function polylineSegmentCount(vertices, closed) {
    return closed ? vertices.length : vertices.length - 1;
}
function pointOnStraightPolylineSegment(start, end, requested, tolerance) {
    const dx = end[0] - start[0], dy = end[1] - start[1], squared = dx * dx + dy * dy;
    if (!(squared > 1e-24)) throw new KJValidationError('PEDIT cannot insert a vertex on a zero-length segment');
    const parameter = ((requested[0] - start[0]) * dx + (requested[1] - start[1]) * dy) / squared;
    if (!(parameter > 1e-12 && parameter < 1 - 1e-12)) throw new KJValidationError('PEDIT insert point must lie inside the selected segment');
    const point = [
        start[0] + dx * parameter,
        start[1] + dy * parameter,
        start[2] + (end[2] - start[2]) * parameter
    ];
    if (distance2(requested, point) > Math.max(tolerance, Math.sqrt(squared) * 1e-12)) {
        throw new KJValidationError('PEDIT insert point is outside the selected straight segment tolerance');
    }
    return {
        point,
        parameter
    };
}
function pointOnBulgedPolylineSegment(start, end, bulge, requested, tolerance) {
    const arc = bulgeArc(start, end, bulge);
    if (!arc) return pointOnStraightPolylineSegment(start, end, requested, tolerance);
    if (![
        ...arc.center,
        arc.radius,
        arc.startAngle,
        arc.endAngle
    ].every(Number.isFinite)) throw new KJValidationError('PEDIT cannot edit an arc segment with unbounded geometry');
    const radiusTolerance = Math.max(tolerance, arc.radius * 1e-12);
    const radialDistance = distance2(requested, arc.center);
    if (Math.abs(radialDistance - arc.radius) > radiusTolerance) throw new KJValidationError('PEDIT insert point is outside the selected arc segment tolerance');
    const angle = Math.atan2(requested[1] - arc.center[1], requested[0] - arc.center[0]);
    const signedSweep = 4 * Math.atan(bulge), span = Math.abs(signedSweep);
    const offset = signedSweep > 0 ? positiveTurn(angle - arc.startAngle) : positiveTurn(arc.startAngle - angle);
    if (!(offset > 1e-12 && offset < span - 1e-12)) throw new KJValidationError('PEDIT insert point must lie inside the selected arc segment');
    const parameter = offset / span, directedAngle = arc.startAngle + signedSweep * parameter;
    return {
        point: [
            arc.center[0] + arc.radius * Math.cos(directedAngle),
            arc.center[1] + arc.radius * Math.sin(directedAngle),
            start[2]
        ],
        parameter
    };
}
function insertPolylineVertex(payload, vertices, options) {
    const closed = Boolean(payload.closed), segmentCount = polylineSegmentCount(vertices, closed);
    const segmentIndex = options.segmentIndex == null ? pickedPolylineSegment(vertices, options.point, closed) : polylineEditIndex(options.segmentIndex, 'PEDIT segmentIndex', segmentCount);
    const nextIndex = (segmentIndex + 1) % vertices.length;
    const source = vertices[segmentIndex], next = vertices[nextIndex], tolerance = polylineEditTolerance(options.tolerance);
    if (Math.abs(source.bulge) > 1e-15) {
        if (Number(payload.dxfFlags ?? 0) & 8) throw new KJValidationError('PEDIT cannot split a bulge arc in a 3D POLYLINE');
        positiveXYNormal(payload, 'PEDIT polyline');
    }
    const requested = finiteEditPoint(options.point);
    const location = pointOnBulgedPolylineSegment(source.point, next.point, source.bulge, requested, tolerance);
    const originalBulge = source.bulge, originalEndWidth = source.endWidth;
    const middleWidth = source.startWidth + (originalEndWidth - source.startWidth) * location.parameter;
    const signedSweep = 4 * Math.atan(originalBulge);
    source.bulge = Math.tan(signedSweep * location.parameter / 4);
    source.endWidth = middleWidth;
    const inserted = {
        point: location.point,
        bulge: Math.tan(signedSweep * (1 - location.parameter) / 4),
        startWidth: middleWidth,
        endWidth: originalEndWidth
    };
    vertices.splice(segmentIndex + 1, 0, inserted);
    return {
        ...payload,
        vertices
    };
}
function deletePolylineVertex(payload, vertices, options) {
    const closed = Boolean(payload.closed), minimum = 2;
    if (vertices.length <= minimum) throw new KJValidationError(`PEDIT cannot delete a vertex from a ${closed ? 'closed' : 'open'} polyline with ${vertices.length} vertices`);
    const index = options.vertexIndex == null ? pickedPolylineVertex(vertices, options.point, polylineEditTolerance(options.tolerance)) : polylineEditIndex(options.vertexIndex, 'PEDIT vertexIndex', vertices.length);
    if (!closed && index === 0) {
        vertices.shift();
        return {
            ...payload,
            vertices
        };
    }
    if (!closed && index === vertices.length - 1) {
        vertices.pop();
        vertices.at(-1).bulge = 0;
        return {
            ...payload,
            vertices
        };
    }
    const previousIndex = (index - 1 + vertices.length) % vertices.length;
    const previous = vertices[previousIndex], current = vertices[index];
    if (Math.abs(previous.bulge) > 1e-15 || Math.abs(current.bulge) > 1e-15) {
        throw new KJValidationError('PEDIT cannot delete a vertex adjacent to an arc segment without an explicit replacement curve');
    }
    previous.bulge = 0;
    previous.endWidth = current.endWidth;
    vertices.splice(index, 1);
    return {
        ...payload,
        vertices
    };
}
function setPolylineSegmentBulge(payload, vertices, options) {
    const closed = Boolean(payload.closed), segmentCount = polylineSegmentCount(vertices, closed);
    const segmentIndex = options.segmentIndex == null ? pickedPolylineSegment(vertices, options.point, closed) : polylineEditIndex(options.segmentIndex, 'PEDIT segmentIndex', segmentCount);
    if (options.segmentIndex == null) {
        const pick = finiteEditPoint(options.point), source = vertices[segmentIndex], next = vertices[(segmentIndex + 1) % vertices.length];
        if (distanceToPolylineSegment(source.point, next.point, source.bulge, pick) > Math.max(polylineEditTolerance(options.tolerance), 1e-10)) {
            throw new KJValidationError('PEDIT arc point is outside the selected segment tolerance');
        }
    }
    if (options.bulge != null && options.sweepDegrees != null) throw new KJValidationError('PEDIT SET_BULGE accepts bulge or sweepDegrees, not both');
    if (options.bulge == null && options.sweepDegrees == null) throw new KJValidationError('PEDIT SET_BULGE requires bulge or sweepDegrees');
    let bulge;
    if (options.sweepDegrees != null) {
        const sweep = Number(options.sweepDegrees);
        if (!Number.isFinite(sweep) || Math.abs(sweep) >= 360) throw new KJValidationError('PEDIT sweepDegrees must be finite and greater than -360 and less than 360');
        bulge = Math.tan(sweep * Math.PI / 720);
    } else bulge = Number(options.bulge);
    if (!Number.isFinite(bulge)) throw new KJValidationError('PEDIT bulge must be finite');
    if (Math.abs(bulge) > 1e-15) {
        if (Number(payload.dxfFlags ?? 0) & 8) throw new KJValidationError('PEDIT cannot add bulge arcs to a 3D POLYLINE');
        positiveXYNormal(payload, 'PEDIT polyline');
        const start = vertices[segmentIndex].point, end = vertices[(segmentIndex + 1) % vertices.length].point;
        if (distance3(start, end) <= 1e-12) throw new KJValidationError('PEDIT cannot add an arc to a zero-length segment');
        if (Math.abs(start[2] - end[2]) > 1e-10) throw new KJValidationError('PEDIT bulge arc endpoints must lie in one XY plane');
        const arc = bulgeArc(start, end, bulge);
        if (!arc || ![
            ...arc.center,
            arc.radius,
            arc.startAngle,
            arc.endAngle
        ].every(Number.isFinite)) throw new KJValidationError('PEDIT bulge creates unbounded arc geometry');
    }
    vertices[segmentIndex].bulge = Math.abs(bulge) <= 1e-15 ? 0 : bulge;
    return {
        ...payload,
        vertices
    };
}
function setPolylineSegmentWidth(payload, vertices, options) {
    const closed = Boolean(payload.closed), segmentCount = polylineSegmentCount(vertices, closed);
    const segmentIndex = options.segmentIndex == null ? pickedPolylineSegment(vertices, options.point, closed) : polylineEditIndex(options.segmentIndex, 'PEDIT segmentIndex', segmentCount);
    if (options.segmentIndex == null) {
        const pick = finiteEditPoint(options.point), source = vertices[segmentIndex], next = vertices[(segmentIndex + 1) % vertices.length];
        if (distanceToPolylineSegment(source.point, next.point, source.bulge, pick) > Math.max(polylineEditTolerance(options.tolerance), 1e-10)) {
            throw new KJValidationError('PEDIT width point is outside the selected segment tolerance');
        }
    }
    const startWidth = Number(options.startWidth), endWidth = Number(options.endWidth);
    if (![
        startWidth,
        endWidth
    ].every((value)=>Number.isFinite(value) && value >= 0 && value <= POLYLINE_BOUND)) {
        throw new KJValidationError(`PEDIT segment widths must be finite from 0 to ${POLYLINE_BOUND}`);
    }
    vertices[segmentIndex].startWidth = startWidth;
    vertices[segmentIndex].endWidth = endWidth;
    return {
        ...payload,
        vertices
    };
}
export function editPolylinePayload(target, options = {}) {
    const type = normalizeName(target?.type);
    if (type !== 'LWPOLYLINE' && type !== 'POLYLINE') throw new KJValidationError(`PEDIT requires a LWPOLYLINE or POLYLINE target, not ${type || 'unknown entity'}`);
    const payload = payloadOf(target), vertices = editablePolylineVertices(payload);
    assertEditablePolylineTopology(type, payload, vertices);
    const operation = normalizeName(options.operation);
    if (operation === 'INSERT') return insertPolylineVertex(payload, vertices, options);
    if (operation === 'DELETE') return deletePolylineVertex(payload, vertices, options);
    if (operation === 'SET_BULGE' || operation === 'ARC') return setPolylineSegmentBulge(payload, vertices, options);
    if (operation === 'SET_WIDTH' || operation === 'WIDTH') return setPolylineSegmentWidth(payload, vertices, options);
    throw new KJValidationError('PEDIT operation must be INSERT, DELETE, SET_BULGE or SET_WIDTH');
}
export function resolvePolylineEditLocation(target, options = {}) {
    const type = normalizeName(target?.type);
    if (type !== 'LWPOLYLINE' && type !== 'POLYLINE') throw new KJValidationError(`PEDIT requires a LWPOLYLINE or POLYLINE target, not ${type || 'unknown entity'}`);
    const payload = payloadOf(target), vertices = editablePolylineVertices(payload);
    assertEditablePolylineTopology(type, payload, vertices);
    const operation = normalizeName(options.operation);
    if (operation === 'INSERT' || operation === 'SET_BULGE' || operation === 'ARC' || operation === 'SET_WIDTH' || operation === 'WIDTH') {
        const segmentCount = polylineSegmentCount(vertices, Boolean(payload.closed));
        return {
            segmentIndex: options.segmentIndex == null ? pickedPolylineSegment(vertices, options.point, Boolean(payload.closed)) : polylineEditIndex(options.segmentIndex, 'PEDIT segmentIndex', segmentCount)
        };
    }
    if (operation === 'DELETE') return {
        vertexIndex: options.vertexIndex == null ? pickedPolylineVertex(vertices, options.point, polylineEditTolerance(options.tolerance)) : polylineEditIndex(options.vertexIndex, 'PEDIT vertexIndex', vertices.length)
    };
    throw new KJValidationError('PEDIT operation must be INSERT, DELETE, SET_BULGE or SET_WIDTH');
}
function selectedRay(line, intersection, pickPoint) {
    const payload = line.payload ?? {};
    const direction = normalize2(subtract2(pointInput(payload.end), pointInput(payload.start)));
    let sign;
    if (pickPoint) sign = dot2(subtract2(pointInput(pickPoint), intersection), direction) >= 0 ? 1 : -1;
    else sign = distance2(pointInput(payload.end), intersection) >= distance2(pointInput(payload.start), intersection) ? 1 : -1;
    return {
        direction: multiply2(direction, sign),
        keepEnd: sign > 0
    };
}
function trimmedLine(line, tangent, ray) {
    const payload = payloadOf(line);
    payload[ray.keepEnd ? 'start' : 'end'] = point3(tangent);
    return payload;
}
function linePairContext(first, second, options) {
    if (first?.type !== 'LINE' || second?.type !== 'LINE') throw new KJValidationError('Operation requires two LINE entities');
    const firstPayload = first.payload ?? {}, secondPayload = second.payload ?? {};
    const intersectionResult = intersectLineLine2(pointInput(firstPayload.start), pointInput(firstPayload.end), pointInput(secondPayload.start), pointInput(secondPayload.end), {
        modeA: 'line',
        modeB: 'line'
    });
    const intersection = intersectionResult.points[0];
    if (!intersection) throw new KJValidationError('Lines are parallel and do not define a corner');
    return {
        intersection,
        firstRay: selectedRay(first, intersection, options.pickPoint1),
        secondRay: selectedRay(second, intersection, options.pickPoint2)
    };
}
export function chamferLinePair(first, second, options = {}) {
    const distance1 = Number(options.distance1 ?? options.distance ?? 0), distance2Value = Number(options.distance2 ?? options.distance ?? distance1);
    if (![
        distance1,
        distance2Value
    ].every((value)=>Number.isFinite(value) && value >= 0)) throw new KJValidationError('Chamfer distances must be non-negative finite numbers');
    const context = linePairContext(first, second, options);
    const firstPoint = add2(context.intersection, multiply2(context.firstRay.direction, distance1));
    const secondPoint = add2(context.intersection, multiply2(context.secondRay.direction, distance2Value));
    return {
        first: trimmedLine(first, firstPoint, context.firstRay),
        second: trimmedLine(second, secondPoint, context.secondRay),
        connector: {
            type: 'LINE',
            payload: {
                start: point3(firstPoint),
                end: point3(secondPoint)
            }
        }
    };
}
export function filletLinePair(first, second, options = {}) {
    const radius = positive(options.radius, 'Fillet radius'), context = linePairContext(first, second, options);
    const cosine = Math.max(-1, Math.min(1, dot2(context.firstRay.direction, context.secondRay.direction)));
    const angle = Math.acos(cosine);
    if (angle <= 1e-8 || Math.abs(Math.PI - angle) <= 1e-8) throw new KJValidationError('Fillet requires two non-collinear rays');
    const tangentDistance = radius / Math.tan(angle / 2);
    const firstPoint = add2(context.intersection, multiply2(context.firstRay.direction, tangentDistance));
    const secondPoint = add2(context.intersection, multiply2(context.secondRay.direction, tangentDistance));
    const bisector = normalize2(add2(context.firstRay.direction, context.secondRay.direction));
    const center = add2(context.intersection, multiply2(bisector, radius / Math.sin(angle / 2)));
    const startAngle = Math.atan2(firstPoint[1] - center[1], firstPoint[0] - center[0]), endAngle = Math.atan2(secondPoint[1] - center[1], secondPoint[0] - center[0]);
    return {
        first: trimmedLine(first, firstPoint, context.firstRay),
        second: trimmedLine(second, secondPoint, context.secondRay),
        connector: {
            type: 'ARC',
            payload: {
                center: point3(center),
                radius,
                startAngle,
                endAngle,
                clockwise: cross2(subtract2(firstPoint, center), subtract2(secondPoint, center)) < 0,
                normal: [
                    0,
                    0,
                    1
                ]
            }
        }
    };
}
