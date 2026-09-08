// Generated from grips.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { arcSweep, distance2, midpoint2, translation3, transformEntityPayload, vec2 } from './geometry/index.js';
import { clone } from './utils.js';
function point3(value, label = 'grip point') {
    const [x, y] = vec2(value, label);
    const record = value;
    const z = Number(Array.isArray(value) ? value[2] ?? 0 : record.z ?? 0);
    if (!Number.isFinite(z)) throw new KJValidationError(`${label}.z must be finite`);
    return [
        x,
        y,
        z
    ];
}
function polar(center, radius, angle) {
    const value = point3(center);
    return [
        value[0] + radius * Math.cos(angle),
        value[1] + radius * Math.sin(angle),
        value[2]
    ];
}
function vertexPoint(vertex) {
    return Array.isArray(vertex) || !('point' in vertex) ? vertex : vertex.point;
}
export function getEntityGrips(entity) {
    if (!entity || entity.kind !== 'entity') throw new KJValidationError('Grip provider requires an entity');
    const payload = entity.payload, result = [];
    const add = (id, role, point, detail = {})=>{
        result.push(Object.freeze({
            id,
            entityId: entity.id,
            role,
            point: Object.freeze(point3(point)),
            ...detail
        }));
    };
    switch(entity.type){
        case 'LINE':
            add('start', 'endpoint', payload.start);
            add('mid', 'move', midpoint2(payload.start, payload.end));
            add('end', 'endpoint', payload.end);
            break;
        case 'RAY':
        case 'XLINE':
            {
                const origin = point3(payload.origin), direction = point3(payload.direction);
                add('origin', 'move', payload.origin);
                add('direction', 'direction', [
                    origin[0] + direction[0],
                    origin[1] + direction[1],
                    origin[2] + direction[2]
                ]);
                break;
            }
        case 'POINT':
            add('position', 'move', payload.position);
            break;
        case 'CIRCLE':
            add('center', 'move', payload.center);
            for (const [index, angle] of [
                0,
                Math.PI / 2,
                Math.PI,
                Math.PI * 1.5
            ].entries())add(`quadrant:${index}`, 'radius', polar(payload.center, payload.radius, angle), {
                angle
            });
            break;
        case 'ARC':
            {
                const sweep = arcSweep(payload);
                add('center', 'move', payload.center);
                add('start', 'endpoint', polar(payload.center, payload.radius, payload.startAngle));
                add('mid', 'radius', polar(payload.center, payload.radius, payload.startAngle + sweep / 2));
                add('end', 'endpoint', polar(payload.center, payload.radius, payload.startAngle + sweep));
                break;
            }
        case 'LWPOLYLINE':
        case 'POLYLINE':
            {
                const vertices = payload.vertices ?? [];
                for (const [index, vertex] of vertices.entries())add(`vertex:${index}`, 'vertex', vertexPoint(vertex), {
                    vertexIndex: index
                });
                const count = payload.closed ? vertices.length : vertices.length - 1;
                for(let index = 0; index < count; index += 1)add(`segment:${index}`, 'segment', midpoint2(vertexPoint(vertices[index]), vertexPoint(vertices[(index + 1) % vertices.length])), {
                    segmentIndex: index
                });
                break;
            }
        case 'SOLID':
        case 'TRACE':
            for (const [index, point] of payload.vertices.entries())add(`vertex:${index}`, 'vertex', vertexPoint(point), {
                vertexIndex: index
            });
            break;
        case 'ELLIPSE':
            {
                const [mx, my] = vec2(payload.majorAxis), center = point3(payload.center), minor = [
                    -my * payload.ratio,
                    mx * payload.ratio
                ];
                add('center', 'move', center);
                add('major:positive', 'major-radius', [
                    center[0] + mx,
                    center[1] + my,
                    center[2]
                ]);
                add('major:negative', 'major-radius', [
                    center[0] - mx,
                    center[1] - my,
                    center[2]
                ]);
                add('minor:positive', 'minor-radius', [
                    center[0] + minor[0],
                    center[1] + minor[1],
                    center[2]
                ]);
                add('minor:negative', 'minor-radius', [
                    center[0] - minor[0],
                    center[1] - minor[1],
                    center[2]
                ]);
                break;
            }
        case 'SPLINE':
            for (const [index, point] of (payload.controlPoints ?? []).entries())add(`control:${index}`, 'control-point', point, {
                controlPointIndex: index
            });
            for (const [index, point] of (payload.fitPoints ?? []).entries())add(`fit:${index}`, 'fit-point', point, {
                fitPointIndex: index
            });
            break;
        case 'TEXT':
        case 'MTEXT':
        case 'ATTDEF':
        case 'ATTRIB':
            add('position', 'move', payload.position);
            if (payload.alignmentPoint) add('alignment', 'alignment', payload.alignmentPoint);
            break;
        case 'INSERT':
        case 'TABLE':
            add('position', 'move', payload.position);
            break;
        case 'IMAGE':
            {
                const origin = point3(payload.position), u = point3(payload.uVector), v = point3(payload.vVector);
                add('position', 'move', origin);
                add('u', 'image-corner', [
                    origin[0] + u[0],
                    origin[1] + u[1],
                    origin[2] + u[2]
                ]);
                add('v', 'image-corner', [
                    origin[0] + v[0],
                    origin[1] + v[1],
                    origin[2] + v[2]
                ]);
                add('uv', 'image-corner', [
                    origin[0] + u[0] + v[0],
                    origin[1] + u[1] + v[1],
                    origin[2] + u[2] + v[2]
                ]);
                break;
            }
        case 'LEADER':
        case 'MLEADER':
            for (const [index, point] of (payload.vertices ?? []).entries())add(`vertex:${index}`, 'vertex', vertexPoint(point), {
                vertexIndex: index
            });
            if (payload.textPosition) add('text', 'text-position', payload.textPosition);
            break;
        case 'DIMENSION':
            for (const [index, point] of (payload.definitionPoints ?? []).entries())add(`definition:${index}`, 'definition-point', point, {
                definitionPointIndex: index
            });
            if (payload.textPosition) add('text', 'text-position', payload.textPosition);
            break;
    }
    return Object.freeze(result);
}
function updateVertex(vertex, target) {
    return Array.isArray(vertex) ? target : {
        ...clone(vertex),
        point: target
    };
}
export function editEntityGrip(entity, gripId, targetPoint) {
    if (!entity || entity.kind !== 'entity') throw new KJValidationError('Grip edit requires an entity');
    gripId = String(gripId);
    const target = point3(targetPoint), payload = clone(entity.payload);
    const currentGrip = getEntityGrips(entity).find((grip)=>grip.id === gripId);
    if (!currentGrip) throw new KJValidationError(`Grip does not exist on ${entity.type}: ${gripId}`);
    const moveWhole = ()=>transformEntityPayload(entity.type, payload, translation3(target[0] - currentGrip.point[0], target[1] - currentGrip.point[1]));
    switch(entity.type){
        case 'LINE':
            if (gripId === 'mid') return moveWhole();
            payload[gripId] = target;
            return payload;
        case 'RAY':
        case 'XLINE':
            {
                if (gripId === 'origin') return moveWhole();
                const origin = point3(payload.origin);
                payload.direction = [
                    target[0] - origin[0],
                    target[1] - origin[1],
                    target[2] - origin[2]
                ];
                return payload;
            }
        case 'POINT':
            payload.position = target;
            return payload;
        case 'CIRCLE':
            if (gripId === 'center') return moveWhole();
            payload.radius = distance2(payload.center, target);
            return payload;
        case 'ARC':
            {
                if (gripId === 'center') return moveWhole();
                if (gripId === 'mid') {
                    payload.radius = distance2(payload.center, target);
                    return payload;
                }
                const center = point3(payload.center);
                if (gripId === 'start') payload.startAngle = Math.atan2(target[1] - center[1], target[0] - center[0]);
                else payload.endAngle = Math.atan2(target[1] - center[1], target[0] - center[0]);
                return payload;
            }
        case 'LWPOLYLINE':
        case 'POLYLINE':
            {
                const vertices = [
                    ...payload.vertices
                ];
                if (gripId.startsWith('vertex:')) {
                    const index = Number(gripId.split(':')[1]);
                    vertices[index] = updateVertex(vertices[index], target);
                } else {
                    const index = Number(gripId.split(':')[1]), nextIndex = (index + 1) % vertices.length;
                    const dx = target[0] - currentGrip.point[0], dy = target[1] - currentGrip.point[1];
                    for (const vertexIndex of [
                        index,
                        nextIndex
                    ]){
                        const point = point3(vertexPoint(vertices[vertexIndex]));
                        vertices[vertexIndex] = updateVertex(vertices[vertexIndex], [
                            point[0] + dx,
                            point[1] + dy,
                            point[2]
                        ]);
                    }
                }
                payload.vertices = vertices;
                return payload;
            }
        case 'SOLID':
        case 'TRACE':
            {
                const index = Number(gripId.split(':')[1]);
                payload.vertices = [
                    ...payload.vertices
                ];
                payload.vertices[index] = target;
                return payload;
            }
        case 'ELLIPSE':
            {
                if (gripId === 'center') return moveWhole();
                const center = point3(payload.center);
                if (gripId.startsWith('major:')) {
                    const sign = gripId.endsWith('negative') ? -1 : 1;
                    payload.majorAxis = [
                        (target[0] - center[0]) * sign,
                        (target[1] - center[1]) * sign,
                        (target[2] - center[2]) * sign
                    ];
                } else payload.ratio = distance2(center, target) / Math.hypot(...vec2(payload.majorAxis));
                return payload;
            }
        case 'SPLINE':
            {
                const [kind, rawIndex] = gripId.split(':'), key = kind === 'fit' ? 'fitPoints' : 'controlPoints';
                payload[key] = [
                    ...payload[key] ?? []
                ];
                payload[key][Number(rawIndex)] = target;
                return payload;
            }
        case 'TEXT':
        case 'MTEXT':
        case 'ATTDEF':
        case 'ATTRIB':
            payload[gripId === 'alignment' ? 'alignmentPoint' : 'position'] = target;
            return payload;
        case 'INSERT':
        case 'TABLE':
            payload.position = target;
            return payload;
        case 'IMAGE':
            {
                if (gripId === 'position') return moveWhole();
                const origin = point3(payload.position), vector = [
                    target[0] - origin[0],
                    target[1] - origin[1],
                    target[2] - origin[2]
                ];
                if (gripId === 'u') payload.uVector = vector;
                else if (gripId === 'v') payload.vVector = vector;
                else {
                    const v = point3(payload.vVector);
                    payload.uVector = [
                        vector[0] - v[0],
                        vector[1] - v[1],
                        vector[2] - v[2]
                    ];
                }
                return payload;
            }
        case 'LEADER':
        case 'MLEADER':
            if (gripId === 'text') payload.textPosition = target;
            else {
                const index = Number(gripId.split(':')[1]);
                payload.vertices = [
                    ...payload.vertices
                ];
                payload.vertices[index] = target;
            }
            return payload;
        case 'DIMENSION':
            if (gripId === 'text') payload.textPosition = target;
            else {
                const index = Number(gripId.split(':')[1]);
                payload.definitionPoints = [
                    ...payload.definitionPoints ?? []
                ];
                payload.definitionPoints[index] = target;
            }
            return payload;
        default:
            throw new KJValidationError(`Grip editing is not implemented for ${entity.type}`);
    }
}
