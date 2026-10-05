// Generated from planar-boundaries.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJRevisionConflictError, KJValidationError } from './errors.js';
import { joinEntityPayloads } from './editing.js';
import { arcSweep } from './geometry/measure.js';
import { runContourWasm } from './geometry/contour-wasm.js';
import { intersectEntityPair2 } from './snapping.js';
import { clone, deepFreeze, stableHash } from './utils.js';
const TURN = Math.PI * 2;
const STYLE_KEYS = [
    'layerId',
    'color',
    'trueColor',
    'linetypeId',
    'linetypeName',
    'linetypeScale',
    'lineweight',
    'transparency',
    'visible'
];
const fail = (message)=>{
    throw new KJValidationError(`Planar boundaries: ${message}`);
};
const pointKey = (p)=>`${p[0]}:${p[1]}`;
const equal = (a, b)=>a[0] === b[0] && a[1] === b[1];
const distance = (a, b)=>Math.hypot(a[0] - b[0], a[1] - b[1]);
const sortedIds = (paths)=>paths.map((path)=>path.entity.id).sort();
const style = (entity)=>Object.fromEntries(STYLE_KEYS.filter((key)=>entity.payload[key] !== undefined).map((key)=>[
            key,
            clone(entity.payload[key])
        ]));
function dataFields(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![
        Object.prototype,
        null
    ].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain data object`);
    for (const key of Reflect.ownKeys(value)){
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !('value' in descriptor)) fail(`${label} contains an unsupported field or accessor`);
    }
}
function finite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) fail(`${label} must be finite within ±1e9`);
    return value;
}
function point(value) {
    if (!Array.isArray(value) || value.length !== 3 || value[2] !== 0) return fail('sources require native XY points at Z=0');
    return [
        finite(value[0], 'x'),
        finite(value[1], 'y'),
        0
    ];
}
function positiveNext(value) {
    if (value === 0) return 0;
    const buffer = new ArrayBuffer(8), view = new DataView(buffer);
    view.setFloat64(0, value);
    view.setBigUint64(0, view.getBigUint64(0) + 1n);
    return view.getFloat64(0);
}
function residual(a, b) {
    const sum = a + b, split = sum - a;
    return a - (sum - split) + (b - split);
}
function polar(center, radius, angle) {
    const quarter = angle / (Math.PI / 2);
    const cardinal = Number.isInteger(quarter) && Math.abs(quarter) < 1e6;
    const index = (quarter % 4 + 4) % 4;
    return point([
        center[0] + radius * (cardinal ? [
            1,
            0,
            -1,
            0
        ][index] : Math.cos(angle)),
        center[1] + radius * (cardinal ? [
            0,
            1,
            0,
            -1
        ][index] : Math.sin(angle)),
        0
    ]);
}
function arcGeometry(start, end, bulge) {
    const dx = end[0] - start[0], dy = end[1] - start[1], k = (1 / bulge - bulge) / 4;
    const center = [
        start[0] + dx / 2 - dy * k,
        start[1] + dy / 2 + dx * k,
        0
    ];
    return {
        center,
        radius: Math.hypot(dx, dy) * (1 + bulge * bulge) / (4 * Math.abs(bulge)),
        angle: Math.atan2(start[1] - center[1], start[0] - center[0]),
        sweep: 4 * Math.atan(bulge)
    };
}
function localArea(vertices) {
    const origin = vertices[0].point;
    let area = 0;
    for(let i = 0; i < vertices.length; i++){
        const a = vertices[i], b = vertices[(i + 1) % vertices.length];
        const ax = a.point[0] - origin[0], ay = a.point[1] - origin[1], bx = b.point[0] - origin[0], by = b.point[1] - origin[1];
        area += (ax * by - bx * ay) / 2;
        if (a.bulge !== 0) {
            const theta = 4 * Math.atan(a.bulge), radius = Math.hypot(bx - ax, by - ay) * (1 + a.bulge * a.bulge) / (4 * Math.abs(a.bulge));
            const term = Math.abs(theta) < 1e-3 ? theta ** 3 / 6 - theta ** 5 / 120 + theta ** 7 / 5040 : theta - Math.sin(theta);
            area += radius * radius * term / 2;
        }
    }
    return area;
}
function sourcePath(entity, tolerance) {
    const p = entity.payload;
    if (entity.kind !== 'entity' || entity.erased || ![
        'LINE',
        'ARC',
        'CIRCLE',
        'LWPOLYLINE'
    ].includes(entity.type)) fail('sources must be live LINE, ARC, CIRCLE or LWPOLYLINE entities');
    if (p.normal !== undefined && (!Array.isArray(p.normal) || p.normal.length !== 3 || p.normal[0] !== 0 || p.normal[1] !== 0 || p.normal[2] !== 1)) fail('sources require normal [0,0,1]');
    for (const key of [
        'thickness',
        'elevation',
        'constantWidth',
        'width',
        'startWidth',
        'endWidth'
    ])if (p[key] !== undefined && p[key] !== 0) fail(`nonzero ${key} is unsupported`);
    for (const key of [
        'materialId',
        'plotStyleId',
        'parentInsertId'
    ])if (p[key] != null) fail(`${key} is unsupported`);
    if (p.dxfFlags !== undefined && p.dxfFlags !== 0 && p.dxfFlags !== 1) fail('fitted, spline or 3D polyline flags are unsupported');
    let vertices, closed = false, error = 0;
    if (entity.type === 'LINE') vertices = [
        {
            point: point(p.start),
            bulge: 0
        },
        {
            point: point(p.end),
            bulge: 0
        }
    ];
    else if (entity.type === 'LWPOLYLINE') {
        if (!Array.isArray(p.vertices) || p.vertices.length < 2 || p.vertices.length > 4096) return fail('polylines require 2–4096 vertices');
        vertices = p.vertices.map((value)=>{
            if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('polyline vertices require native point/bulge objects');
            const v = value;
            for (const key of [
                'startWidth',
                'endWidth'
            ])if (v[key] !== undefined && v[key] !== 0) fail('polyline widths are unsupported');
            const bulge = v.bulge ?? 0;
            if (typeof bulge !== 'number' || !Number.isFinite(bulge) || Math.abs(bulge) > 1e6) fail('bulges must be finite within ±1e6');
            return {
                point: point(v.point),
                bulge: bulge
            };
        });
        closed = p.closed === true;
    } else {
        const center = point(p.center), radius = finite(p.radius, 'radius');
        if (radius <= 0) fail('radius must be positive');
        if (entity.type === 'CIRCLE') {
            vertices = [
                {
                    point: point([
                        center[0] + radius,
                        center[1],
                        0
                    ]),
                    bulge: 1
                },
                {
                    point: point([
                        center[0] - radius,
                        center[1],
                        0
                    ]),
                    bulge: 1
                }
            ];
            error = positiveNext(Math.max(Math.abs(residual(center[0], radius)), Math.abs(residual(center[0], -radius))));
            closed = true;
        } else {
            const start = finite(p.startAngle, 'start angle'), end = finite(p.endAngle, 'end angle'), sweep = arcSweep({
                startAngle: start,
                endAngle: end,
                clockwise: p.clockwise === true
            });
            if (Math.abs(sweep) <= 1e-15 || Math.abs(sweep) >= TURN - 1e-12) fail('ARC sources require a nondegenerate open circular arc');
            const first = polar(center, radius, start), last = polar(center, radius, end), bulge = Math.tan(sweep / 4);
            vertices = [
                {
                    point: first,
                    bulge
                },
                {
                    point: last,
                    bulge: 0
                }
            ];
            const geometry = arcGeometry(first, last, bulge);
            const dx = last[0] - first[0], dy = last[1] - first[1], k = (1 / bulge - bulge) / 4;
            const exactDx = dx + residual(last[0], -first[0]), exactDy = dy + residual(last[1], -first[1]);
            const localX = first[0] - center[0] + residual(first[0], -center[0]) + exactDx / 2 - exactDy * k;
            const localY = first[1] - center[1] + residual(first[1], -center[1]) + exactDy / 2 + exactDx * k;
            const arithmeticBound = Number.EPSILON * 128 * (radius + Math.abs(exactDx) + Math.abs(exactDy) + Math.abs(exactDx * k) + Math.abs(exactDy * k));
            error = positiveNext(Math.hypot(localX, localY) + Math.abs(geometry.radius - radius) + arithmeticBound);
        }
    }
    if (error > tolerance || tolerance - error < 1e-9) fail('source arc conversion cannot meet the boundary tolerance budget');
    const count = closed ? vertices.length : vertices.length - 1;
    const segments = Array.from({
        length: count
    }, (_, i)=>({
            start: vertices[i].point,
            end: vertices[(i + 1) % vertices.length].point,
            bulge: vertices[i].bulge,
            sourceId: entity.id,
            sourceSegmentIndex: i
        }));
    for (const segment of segments)if (distance(segment.start, segment.end) <= tolerance) fail('source has a zero-length or tolerance-sized segment');
    return {
        entity,
        vertices,
        segments,
        closed,
        error,
        start: vertices[0].point,
        end: closed ? vertices[0].point : vertices.at(-1).point
    };
}
function reverse(ring) {
    const n = ring.vertices.length, vertices = ring.vertices, mappings = ring.segments;
    ring.vertices = Array.from({
        length: n
    }, (_, i)=>({
            point: [
                ...vertices[(n - i) % n].point
            ],
            bulge: -vertices[(n - i - 1 + n) % n].bulge
        }));
    ring.segments = Array.from({
        length: n
    }, (_, i)=>{
        const m = mappings[(n - i - 1 + n) % n];
        return {
            ...m,
            reversed: !m.reversed
        };
    });
    ring.area = -ring.area;
}
function canonical(ring) {
    for (const vertex of ring.vertices){
        vertex.point = vertex.point.map((value)=>value === 0 ? 0 : value);
        if (vertex.bulge === 0) vertex.bulge = 0;
    }
    let start = 0;
    for(let i = 1; i < ring.vertices.length; i++){
        const a = ring.vertices[i], b = ring.vertices[start];
        if (a.point[0] < b.point[0] || a.point[0] === b.point[0] && (a.point[1] < b.point[1] || a.point[1] === b.point[1] && a.bulge < b.bulge)) start = i;
    }
    ring.vertices = [
        ...ring.vertices.slice(start),
        ...ring.vertices.slice(0, start)
    ];
    ring.segments = [
        ...ring.segments.slice(start),
        ...ring.segments.slice(0, start)
    ];
}
function contains(vertices, query) {
    let winding = 0;
    for(let i = 0; i < vertices.length; i++){
        const a = vertices[i], b = vertices[(i + 1) % vertices.length];
        if (a.bulge === 0) {
            const upward = a.point[1] <= query[1] && query[1] < b.point[1], downward = b.point[1] <= query[1] && query[1] < a.point[1];
            if ((upward || downward) && a.point[0] + (query[1] - a.point[1]) * (b.point[0] - a.point[0]) / (b.point[1] - a.point[1]) > query[0]) winding += upward ? 1 : -1;
            continue;
        }
        const g = arcGeometry(a.point, b.point, a.bulge), parameters = [
            0,
            1
        ];
        for(let k = -6; k <= 6; k++){
            const t = (Math.PI / 2 + k * Math.PI - g.angle) / g.sweep;
            if (t > 0 && t < 1) parameters.push(t);
        }
        parameters.sort((x, y)=>x - y);
        for(let j = 1; j < parameters.length; j++){
            const lo = parameters[j - 1], hi = parameters[j], angle0 = g.angle + lo * g.sweep, angle1 = g.angle + hi * g.sweep;
            const y0 = lo === 0 ? a.point[1] : g.center[1] + g.radius * Math.sin(angle0), y1 = hi === 1 ? b.point[1] : g.center[1] + g.radius * Math.sin(angle1);
            const upward = y0 <= query[1] && query[1] < y1, downward = y1 <= query[1] && query[1] < y0;
            if (!upward && !downward) continue;
            const localY = (query[1] - g.center[1]) / g.radius;
            const x = g.center[0] + (Math.cos((angle0 + angle1) / 2) >= 0 ? 1 : -1) * g.radius * Math.sqrt(Math.max(0, 1 - localY * localY));
            if (x > query[0]) winding += upward ? 1 : -1;
        }
    }
    return winding !== 0;
}
function virtual(path) {
    return {
        ...path.entity,
        type: 'LWPOLYLINE',
        payload: {
            vertices: path.vertices,
            closed: path.closed
        }
    };
}
function joined(paths) {
    let vertices;
    if (paths.length === 1) vertices = paths[0].vertices.map((v)=>({
            point: [
                ...v.point
            ],
            bulge: v.bulge
        }));
    else {
        const result = joinEntityPayloads(paths.map(virtual), {
            tolerance: 0,
            primaryId: paths[0].entity.id
        });
        if (!result.closed) return fail('internal connected component is not closed');
        vertices = result.payload.vertices.map((v)=>({
                point: [
                    ...v.point
                ],
                bulge: v.bulge
            }));
    }
    if (vertices.length > 2 && equal(vertices[0].point, vertices.at(-1).point)) vertices.pop();
    const sources = paths.flatMap((path)=>path.segments);
    const segments = vertices.map((v, i)=>{
        const end = vertices[(i + 1) % vertices.length].point;
        const matches = sources.flatMap((s)=>equal(v.point, s.start) && equal(end, s.end) && v.bulge === s.bulge ? [
                {
                    sourceId: s.sourceId,
                    sourceSegmentIndex: s.sourceSegmentIndex,
                    reversed: false
                }
            ] : equal(v.point, s.end) && equal(end, s.start) && v.bulge === -s.bulge ? [
                {
                    sourceId: s.sourceId,
                    sourceSegmentIndex: s.sourceSegmentIndex,
                    reversed: true
                }
            ] : []);
        if (matches.length !== 1) return fail('ambiguous or missing source-to-segment correspondence');
        return matches[0];
    });
    return {
        vertices,
        segments,
        paths,
        area: localArea(vertices),
        depth: 0,
        error: Math.max(...paths.map((path)=>path.error))
    };
}
async function validate(rings, tolerance, options) {
    await runContourWasm({
        operation: 'offset',
        distance: 0,
        tolerance,
        contours: rings.map((ring)=>ring.vertices.map((v)=>[
                    v.point[0],
                    v.point[1],
                    v.bulge
                ]))
    }, options);
}
function nativeRefusal(error) {
    return error instanceof KJValidationError && error.message.startsWith('Contour operation refused:') ? error.message.slice('Contour operation refused:'.length).trim() : null;
}
export async function previewPlanarBoundaries(document, input, options = {}) {
    dataFields(input, [
        'ids',
        'units',
        'expectedRevision',
        'tolerance'
    ], 'request');
    dataFields(options, [
        'wasmBytes',
        'wasmUrl'
    ], 'backend options');
    if (Array.isArray(input.ids)) {
        if (Object.getPrototypeOf(input.ids) !== Array.prototype) fail('ids must be a plain array');
        for (const key of Reflect.ownKeys(input.ids)){
            if (key === 'length') continue;
            const descriptor = Object.getOwnPropertyDescriptor(input.ids, key);
            if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || !descriptor.enumerable || !('value' in descriptor)) fail('ids contain an unsupported field or accessor');
        }
    }
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 256 || input.ids.some((id)=>typeof id !== 'string' || !id.trim()) || new Set(input.ids).size !== input.ids.length) fail('select 1–256 distinct entity IDs');
    const ids = [
        ...input.ids
    ].sort(), tolerance = input.tolerance ?? 1e-7;
    if (!Number.isFinite(tolerance) || tolerance < 1e-9 || tolerance > 1e-2) fail('tolerance must be in [1e-9,1e-2]');
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('expectedRevision must be a nonnegative integer');
    const revision = input.expectedRevision, units = input.units;
    const assertRevision = ()=>{
        if (document.revision !== revision) throw new KJRevisionConflictError(revision, document.revision, {
            documentId: document.id
        });
    };
    assertRevision();
    if (typeof units !== 'string' || !units || units === 'unitless' || document.snapshot().header.units !== units) fail('explicit units must match the drawing');
    const entities = ids.map((id)=>document.getObject(id) ?? fail(`missing live entity ${id}`));
    if (entities.some((entity)=>entity.ownerId !== entities[0].ownerId)) fail('all selected sources must share one drawing space');
    const paths = entities.map((entity)=>sourcePath(entity, tolerance));
    if (paths.reduce((n, path)=>n + path.segments.length, 0) > 4096) fail('selection exceeds 4096 source segments');
    const diagnostics = [], bad = new Set();
    const diagnose = (code, selected, message, points = [])=>{
        const sourceIds = sortedIds(selected);
        diagnostics.push({
            code,
            sourceIds,
            message,
            points: points.map((p)=>[
                    ...p
                ])
        });
        for (const id of sourceIds)bad.add(id);
    };
    const open = paths.filter((path)=>!path.closed), nodes = new Map();
    for (const path of open)for (const endpoint of [
        path.start,
        path.end
    ]){
        const key = pointKey(endpoint), incident = nodes.get(key) ?? [];
        incident.push(path);
        nodes.set(key, incident);
    }
    const endpoints = open.flatMap((path)=>[
            {
                path,
                point: path.start
            },
            {
                path,
                point: path.end
            }
        ]);
    for(let i = 0; i < endpoints.length; i++)for(let j = i + 1; j < endpoints.length; j++){
        const a = endpoints[i], b = endpoints[j];
        if (!equal(a.point, b.point) && distance(a.point, b.point) <= tolerance) diagnose('near-endpoint', [
            ...new Set([
                a.path,
                b.path
            ])
        ], 'Distinct endpoints are within tolerance; no gap was snapped.', [
            a.point,
            b.point
        ]);
    }
    const groups = paths.filter((path)=>path.closed).map((path)=>[
            path
        ]), visited = new Set();
    for (const seed of open){
        if (visited.has(seed)) continue;
        const group = [], pending = [
            seed
        ];
        while(pending.length){
            const path = pending.pop();
            if (visited.has(path)) continue;
            visited.add(path);
            group.push(path);
            for (const endpoint of [
                path.start,
                path.end
            ])pending.push(...(nodes.get(pointKey(endpoint)) ?? []).filter((p)=>!visited.has(p)));
        }
        group.sort((a, b)=>a.entity.id.localeCompare(b.entity.id));
        const branchPoints = [], loosePoints = [];
        for (const key of new Set(group.flatMap((path)=>[
                pointKey(path.start),
                pointKey(path.end)
            ]))){
            const incident = nodes.get(key), p = pointKey(incident[0].start) === key ? incident[0].start : incident[0].end;
            if (incident.length > 2) branchPoints.push(p);
            else if (incident.length === 1) loosePoints.push(p);
        }
        if (branchPoints.length) diagnose('branch', group, 'The connected component has endpoints with degree greater than two.', branchPoints);
        else if (loosePoints.length) diagnose('open-chain', group, 'The connected component has unmatched endpoints.', loosePoints);
        groups.push(group);
    }
    let intersectionWork = 0;
    for(let i = 0; i < paths.length; i++)for(let j = i + 1; j < paths.length; j++){
        const a = paths[i], b = paths[j];
        intersectionWork += a.segments.length * b.segments.length;
        if (intersectionWork > 131072) fail('intersection validation exceeds the 131072 primitive-pair budget');
        const result = intersectEntityPair2(virtual(a), virtual(b));
        const shared = [
            a.start,
            a.end
        ].filter((p)=>[
                b.start,
                b.end
            ].some((q)=>equal(p, q)));
        const unexpected = result.points.filter((p)=>!shared.some((q)=>distance(q, p) <= tolerance));
        if (result.kind === 'overlap' || unexpected.length || (a.closed || b.closed) && result.points.length) diagnose('boundary-intersection', [
            a,
            b
        ], 'Selected source paths cross, overlap or touch outside an ordinary open-path endpoint join.', unexpected.length ? unexpected : result.points);
    }
    const rings = [];
    for (const group of groups){
        if (group.some((path)=>bad.has(path.entity.id))) continue;
        if (group.some((path)=>stableHash(style(path.entity)) !== stableHash(style(group[0].entity)))) {
            diagnose('incompatible-style', group, 'A boundary combines different drawing styles; no style was chosen implicitly.');
            continue;
        }
        let ring;
        try {
            ring = joined(group);
        } catch (error) {
            if (!(error instanceof KJValidationError)) throw error;
            diagnose('self-intersection', group, error.message);
            continue;
        }
        try {
            await validate([
                ring
            ], tolerance - ring.error, options);
        } catch (error) {
            const message = nativeRefusal(error);
            if (message === null) throw error;
            diagnose(/Self-intersect/i.test(message) ? 'self-intersection' : 'precision', group, message);
            continue;
        }
        rings.push(ring);
    }
    if (rings.length > 64) fail('selection produces more than 64 rings');
    for (const ring of rings){
        ring.depth = rings.filter((other)=>other !== ring && contains(other.vertices, ring.vertices[0].point)).length;
        if (ring.area < 0 !== (ring.depth % 2 === 1)) reverse(ring);
        canonical(ring);
    }
    if (rings.length) {
        const conversionError = Math.max(...rings.map((r)=>r.error));
        const relationTolerance = conversionError === 0 ? tolerance : positiveNext(tolerance + 2 * conversionError);
        if (relationTolerance > 1e-2) {
            diagnose('precision', rings.flatMap((r)=>r.paths), 'Source separation tolerance including both conversion errors exceeds the native 1e-2 limit.');
            rings.length = 0;
        } else {
            try {
                await validate(rings, relationTolerance, options);
            } catch (error) {
                const message = nativeRefusal(error);
                if (message === null) throw error;
                diagnose(/boundaries|winding/i.test(message) ? 'boundary-intersection' : 'precision', rings.flatMap((r)=>r.paths), message);
                rings.length = 0;
            }
        }
    }
    assertRevision();
    if (stableHash(ids.map((id)=>document.getObject(id))) !== stableHash(entities)) fail('source records changed during extraction');
    rings.sort((a, b)=>a.depth - b.depth || b.area - a.area || a.vertices[0].point[0] - b.vertices[0].point[0] || a.vertices[0].point[1] - b.vertices[0].point[1] || sortedIds(a.paths).join().localeCompare(sortedIds(b.paths).join()));
    const contours = rings.map((r)=>({
            closed: true,
            vertices: r.vertices,
            segments: r.segments,
            sourceIds: sortedIds(r.paths),
            depth: r.depth,
            hole: r.depth % 2 === 1,
            area: r.area,
            ownerId: r.paths[0].entity.ownerId,
            style: style(r.paths[0].entity),
            sourceBoundaryError: r.error
        }));
    diagnostics.sort((a, b)=>a.code.localeCompare(b.code) || a.sourceIds.join().localeCompare(b.sourceIds.join()));
    const area = contours.reduce((sum, ring)=>sum + ring.area, 0), sourceBoundaryError = Math.max(0, ...contours.map((ring)=>ring.sourceBoundaryError));
    const result = {
        contours,
        diagnostics,
        complete: diagnostics.length === 0 && contours.length > 0,
        area,
        sourceIds: ids,
        sourceDigest: stableHash(entities),
        units,
        revisionBefore: revision,
        receipt: {
            schema: 'kjdraw.planar-boundaries.v1',
            tolerance,
            inputDigest: stableHash({
                ids,
                units,
                expectedRevision: revision,
                tolerance
            }),
            geometryDigest: stableHash({
                contours,
                area,
                diagnostics
            }),
            sourceBoundaryError
        }
    };
    return deepFreeze(result);
}
