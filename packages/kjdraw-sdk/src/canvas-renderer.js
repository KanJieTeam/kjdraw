// Generated from canvas-renderer.ts by scripts/build-typescript.mjs. Do not edit directly.
import { multiply3, rotation3, scale3, transformEntityPayload, translation3 } from './geometry/index.js';
import { nearestPointOnEntity2 } from './snapping.js';
import { normalizeSplineDefinition, splinePoint2 } from './geometry/curves.js';
import { projectDimension } from './geometry/annotation.js';
import { hatchPatternLines, hatchStrokes } from './geometry/hatch.js';
import { createHatchStrokeCoverage } from './geometry/hatch-coverage.js';
import { getEntityGrips } from './grips.js';
import { attributeHidden, insertAttributes, isAttachedAttribute, visibleAttribute } from './attribute-display.js';
import { layoutCadText } from './geometry/text-layout.js';
import { effectiveLinetypeScale } from './linetype-scale.js';
import { displayedEntityBounds, hitTestDisplayedEntity, isEntitySelectable, selectEntitiesInBox, selectEntitiesByFence } from './selection-geometry.js';
const HATCH_RASTER_PIXEL_LIMIT = 1048576;
const HATCH_RASTER_FRAME_WORK = 4000000;
const HATCH_RASTER_CACHE_BYTES = 32 * 1024 * 1024;
const DARK_PALETTE = Object.freeze([
    '#d8e6f3',
    '#ff767d',
    '#f2d46f',
    '#7ce38b',
    '#62d8e8',
    '#75a7ff',
    '#c997ff',
    '#f29fd1',
    '#9fb4c8'
]);
const LIGHT_PALETTE = Object.freeze([
    '#23364a',
    '#c52f3a',
    '#9b7416',
    '#247a39',
    '#147383',
    '#2a5fc4',
    '#7441a4',
    '#9d3d78',
    '#53687d'
]);
const APPROXIMATE_TYPES = new Set([
    'SPLINE',
    'TEXT',
    'MTEXT',
    'ATTDEF',
    'ATTRIB',
    'HATCH',
    'LEADER',
    'MLEADER',
    'DIMENSION',
    'TABLE',
    'IMAGE',
    'SOLID3D'
]);
function hsv(hue, saturation, value) {
    const chroma = value * saturation;
    const section = (hue % 360 + 360) % 360 / 60;
    const second = chroma * (1 - Math.abs(section % 2 - 1));
    const [r1, g1, b1] = section < 1 ? [
        chroma,
        second,
        0
    ] : section < 2 ? [
        second,
        chroma,
        0
    ] : section < 3 ? [
        0,
        chroma,
        second
    ] : section < 4 ? [
        0,
        second,
        chroma
    ] : section < 5 ? [
        second,
        0,
        chroma
    ] : [
        chroma,
        0,
        second
    ];
    const match = value - chroma;
    const valueOf = (component)=>Math.round((component + match) * 255).toString(16).padStart(2, '0');
    return `#${valueOf(r1)}${valueOf(g1)}${valueOf(b1)}`;
}
export function aciColor(input, theme = 'dark') {
    const index = Math.max(0, Math.min(255, Math.trunc(finite(input, 7))));
    const basics = theme === 'dark' ? [
        '#d8e6f3',
        '#ff0000',
        '#ffff00',
        '#00ff00',
        '#00ffff',
        '#0000ff',
        '#ff00ff',
        '#ffffff',
        '#808080',
        '#c0c0c0'
    ] : [
        '#23364a',
        '#ff0000',
        '#b59a00',
        '#008f19',
        '#008f8f',
        '#0000ff',
        '#c000c0',
        '#111111',
        '#808080',
        '#404040'
    ];
    if (index < 10) return basics[index];
    if (index >= 250) return [
        '#333333',
        '#505050',
        '#696969',
        '#828282',
        '#bebebe',
        theme === 'dark' ? '#ffffff' : '#111111'
    ][index - 250];
    const ramp = (index - 10) % 10, hue = Math.floor((index - 10) / 10) * 15;
    const values = [
        1,
        1,
        0.65,
        0.65,
        0.5,
        0.5,
        0.3,
        0.3,
        0.15,
        0.15
    ];
    return hsv(hue, ramp % 2 ? 0.5 : 1, values[ramp]);
}
function explicitColor(input) {
    if (typeof input === 'string' && /^(?:#[0-9a-f]{3,8}|rgb|hsl)/i.test(input.trim())) return input.trim();
    const value = Number(input);
    if (Number.isInteger(value) && value >= 0 && value <= 0xffffff) return `#${value.toString(16).padStart(6, '0')}`;
    return null;
}
function point2(input) {
    if (!Array.isArray(input)) return null;
    const x = Number(input[0]), y = Number(input[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [
        x,
        y
    ] : null;
}
function points(input) {
    if (!Array.isArray(input)) return [];
    return input.map((value)=>point2(value?.point ?? value)).filter((value)=>value !== null);
}
function uniformTransformScale(matrix) {
    const sx = Math.hypot(matrix[0] ?? 1, matrix[1] ?? 0), sy = Math.hypot(matrix[2] ?? 0, matrix[3] ?? 1);
    const dot = (matrix[0] ?? 1) * (matrix[2] ?? 0) + (matrix[1] ?? 0) * (matrix[3] ?? 1);
    const tolerance = 1e-10 * Math.max(sx, sy, 1);
    return sx > 0 && sy > 0 && Math.abs(sx - sy) <= tolerance && Math.abs(dot) <= tolerance * Math.max(sx, sy) ? sx : null;
}
function finite(value, fallback = 0) {
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
}
function splineSamples(payload) {
    const definition = normalizeSplineDefinition({
        degree: finite(payload.degree, 3),
        controlPoints: points(payload.controlPoints),
        ...Array.isArray(payload.knots) ? {
            knots: payload.knots.map(Number)
        } : {},
        ...Array.isArray(payload.weights) ? {
            weights: payload.weights.map(Number)
        } : {}
    });
    const knots = [
        ...new Set(definition.knots.slice(definition.degree, definition.controlPoints.length + 1))
    ];
    const result = [];
    for(let span = 1; span < knots.length; span++){
        const a = knots[span - 1], b = knots[span];
        for(let step = span === 1 ? 0 : 1; step <= 24; step++)result.push(splinePoint2(definition, a + (b - a) * step / 24));
    }
    return result;
}
function colorIndex(value) {
    const index = Math.abs(Math.trunc(finite(value, 7)));
    return index % DARK_PALETTE.length;
}
function normalizeSweep(start, end) {
    let sweep = end - start;
    while(sweep <= 0)sweep += Math.PI * 2;
    return sweep;
}
function bulgeSegment(start, end, bulge) {
    if (Math.abs(bulge) < 1e-10) return [
        start,
        end
    ];
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const chord = Math.hypot(dx, dy);
    if (!(chord > 0)) return [
        start
    ];
    const theta = 4 * Math.atan(bulge);
    const midpoint = [
        (start[0] + end[0]) / 2,
        (start[1] + end[1]) / 2
    ];
    const offset = chord * (1 - bulge * bulge) / (4 * bulge);
    const center = [
        midpoint[0] - dy / chord * offset,
        midpoint[1] + dx / chord * offset
    ];
    const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    const segments = Math.max(8, Math.ceil(Math.abs(theta) / (Math.PI / 18)));
    const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
    return Array.from({
        length: segments + 1
    }, (_, index)=>{
        const angle = startAngle + theta * index / segments;
        return [
            center[0] + Math.cos(angle) * radius,
            center[1] + Math.sin(angle) * radius
        ];
    });
}
function polylineSamples(payload) {
    const vertices = Array.isArray(payload.vertices) ? payload.vertices : [];
    const output = [];
    for(let index = 0; index < vertices.length; index += 1){
        const source = vertices[index];
        const start = point2(source?.point ?? source);
        const nextSource = vertices[(index + 1) % vertices.length];
        const end = point2(nextSource?.point ?? nextSource);
        if (!start) continue;
        if (!end || index === vertices.length - 1 && payload.closed !== true) {
            if (!output.length || output.at(-1) !== start) output.push(start);
            continue;
        }
        const sampled = bulgeSegment(start, end, finite(source?.bulge));
        output.push(...output.length ? sampled.slice(1) : sampled);
    }
    return output;
}
function entityPoints(entity) {
    const payload = entity.payload;
    const output = [];
    if (entity.type === 'VIEWPORT') {
        const center = point2(payload.center), width = finite(payload.width), height = finite(payload.height);
        return center && width > 0 && height > 0 ? [
            [
                center[0] - width / 2,
                center[1] - height / 2
            ],
            [
                center[0] + width / 2,
                center[1] + height / 2
            ]
        ] : [];
    }
    for (const key of [
        'start',
        'end',
        'origin',
        'position',
        'center',
        'textPosition',
        'insertionPoint'
    ]){
        const value = point2(payload[key]);
        if (value) output.push(value);
    }
    output.push(...points(payload.vertices), ...points(payload.controlPoints), ...points(payload.fitPoints), ...points(payload.definitionPoints));
    if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') output.push(...polylineSamples(payload));
    if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
        const center = point2(payload.center), radius = Math.abs(finite(payload.radius));
        if (center && radius) output.push([
            center[0] - radius,
            center[1] - radius
        ], [
            center[0] + radius,
            center[1] + radius
        ]);
    }
    if (entity.type === 'DIMENSION') {
        const projection = projectDimension(payload);
        if (projection) {
            output.push(...projection.lines.flat(), ...projection.arrows.flat(), projection.label.position);
            for (const arc of projection.arcs){
                const angles = [
                    arc.startAngle,
                    arc.endAngle
                ];
                for(let quadrant = Math.ceil(arc.startAngle / (Math.PI / 2)); quadrant * Math.PI / 2 <= arc.endAngle; quadrant++)angles.push(quadrant * Math.PI / 2);
                output.push(...angles.map((angle)=>[
                        arc.center[0] + arc.radius * Math.cos(angle),
                        arc.center[1] + arc.radius * Math.sin(angle)
                    ]));
            }
        }
    }
    if (entity.type === 'ELLIPSE') {
        const center = point2(payload.center), axis = point2(payload.majorAxis);
        if (center && axis) {
            const radius = Math.hypot(axis[0], axis[1]);
            output.push([
                center[0] - radius,
                center[1] - radius
            ], [
                center[0] + radius,
                center[1] + radius
            ]);
        }
    }
    for (const loop of Array.isArray(payload.boundaryLoops) ? payload.boundaryLoops : []){
        if (Array.isArray(loop.vertices)) output.push(...polylineSamples({
            vertices: loop.vertices,
            closed: true
        }));
        for (const edge of Array.isArray(loop.edges) ? loop.edges : []){
            if (edge.type === 'LINE') output.push(...points([
                edge.start,
                edge.end
            ]));
            else if (edge.type === 'ARC') {
                const center = point2(edge.center), radius = Math.abs(finite(edge.radius));
                if (center && radius) output.push([
                    center[0] - radius,
                    center[1] - radius
                ], [
                    center[0] + radius,
                    center[1] + radius
                ]);
            }
        }
    }
    return output;
}
export class KJCanvasRenderer {
    #viewportDiagnostics = [];
    #viewportWorkRemaining = 100000;
    #viewportState = null;
    canvas;
    context;
    camera = {
        centerX: 50,
        centerY: 40,
        scale: 4
    };
    #document = null;
    #spaceId;
    #selection = new Set();
    #theme;
    #grid;
    #pixelRatio;
    #padding;
    #background;
    #selectionColor;
    #showLineweights;
    #sceneProvider;
    #spatialScene = null;
    #boundsCache = new WeakMap();
    #width = 1;
    #height = 1;
    #fittedCamera = null;
    #disposeDocument = null;
    #observer = null;
    #hatchDiagnostics = [];
    #textDrawCount = 0;
    #drawnTextTypes = new Set();
    #hatchWorkRemaining = 100000;
    #hatchSampleWorkRemaining = HATCH_RASTER_FRAME_WORK;
    #hatchSamplePixelsRemaining = HATCH_RASTER_PIXEL_LIMIT;
    #hatchRasterCache = [];
    #report = Object.freeze({
        total: 0,
        culled: 0,
        detailCulled: 0,
        overviewEntities: 0,
        overviewPixels: 0,
        rendered: 0,
        approximated: 0,
        hidden: 0,
        unsupported: 0,
        approximateTypes: Object.freeze([]),
        unsupportedTypes: Object.freeze([]),
        width: 1,
        height: 1,
        scale: 4
    });
    constructor(canvas, options = {}){
        if (!canvas?.getContext) throw new TypeError('KJCanvasRenderer requires an HTMLCanvasElement');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D is unavailable');
        this.canvas = canvas;
        this.context = context;
        this.#spaceId = options.spaceId ?? null;
        this.#theme = options.theme ?? 'dark';
        this.#grid = options.grid ?? true;
        this.#pixelRatio = options.pixelRatio == null ? null : Math.max(1, finite(options.pixelRatio, 1));
        this.#padding = Math.max(0, finite(options.padding, 48));
        this.#background = options.background ?? null;
        this.#selectionColor = options.selectionColor ?? null;
        this.#showLineweights = options.showLineweights ?? false;
        this.#sceneProvider = options.sceneProvider ?? null;
        this.setDocument(options.document ?? null);
        if (typeof ResizeObserver !== 'undefined') {
            this.#observer = new ResizeObserver(()=>this.resize());
            this.#observer.observe(canvas);
        }
        this.resize();
    }
    get document() {
        return this.#document;
    }
    get spaceId() {
        return this.#spaceId;
    }
    get theme() {
        return this.#theme;
    }
    get grid() {
        return this.#grid;
    }
    get selection() {
        return Object.freeze([
            ...this.#selection
        ]);
    }
    get report() {
        return this.#report;
    }
    setDocument(document) {
        this.#disposeDocument?.();
        this.#disposeDocument = null;
        this.#document = document;
        this.#spatialScene = null;
        this.#boundsCache = new WeakMap();
        this.#hatchRasterCache = [];
        if (document) this.#disposeDocument = document.on('document:change', (event)=>{
            this.#spatialScene = null;
            const operations = Array.isArray(event.revision?.operations) ? event.revision.operations : [];
            const active = this.#spaceId ?? document.spaces.modelSpaceId;
            const localUpdates = operations.length > 0 && operations.every((operation)=>{
                const value = operation;
                return value.type === 'object.update' && value.after?.kind === 'entity' && value.after.ownerId === active;
            });
            if (!localUpdates) this.#boundsCache = new WeakMap();
            this.render();
        });
        this.#selection.clear();
        this.render();
        return this;
    }
    setTheme(theme) {
        this.#theme = theme;
        this.render();
        return this;
    }
    setGrid(enabled) {
        this.#grid = Boolean(enabled);
        this.render();
        return this;
    }
    setSelection(ids = []) {
        this.#selection = new Set(ids.map(String));
        this.render();
        return this;
    }
    setSpace(spaceId) {
        this.#spaceId = spaceId;
        this.#spatialScene = null;
        this.#selection.clear();
        this.render();
        return this;
    }
    setSceneProvider(provider) {
        this.#sceneProvider = provider;
        this.#spatialScene = null;
        this.render();
        return this;
    }
    resize(width, height) {
        const keepFitted = this.#fittedCamera !== null && this.camera.centerX === this.#fittedCamera.centerX && this.camera.centerY === this.#fittedCamera.centerY && this.camera.scale === this.#fittedCamera.scale;
        const rect = this.canvas.getBoundingClientRect();
        const nextWidth = Math.max(1, finite(width, rect.width || this.canvas.clientWidth || 1));
        const nextHeight = Math.max(1, finite(height, rect.height || this.canvas.clientHeight || 1));
        const viewportChanged = nextWidth !== this.#width || nextHeight !== this.#height;
        this.#width = nextWidth;
        this.#height = nextHeight;
        const ratio = this.#pixelRatio ?? Math.max(1, globalThis.devicePixelRatio || 1);
        const targetWidth = Math.max(1, Math.round(this.#width * ratio));
        const targetHeight = Math.max(1, Math.round(this.#height * ratio));
        if (this.canvas.width !== targetWidth) this.canvas.width = targetWidth;
        if (this.canvas.height !== targetHeight) this.canvas.height = targetHeight;
        if (keepFitted && viewportChanged && this.#document) return this.fit();
        if (!keepFitted) this.#fittedCamera = null;
        this.render();
        return this;
    }
    worldToScreen(input) {
        return [
            (input[0] - this.camera.centerX) * this.camera.scale + this.#width / 2,
            this.#height / 2 - (input[1] - this.camera.centerY) * this.camera.scale
        ];
    }
    screenToWorld(input) {
        return [
            (input[0] - this.#width / 2) / this.camera.scale + this.camera.centerX,
            (this.#height / 2 - input[1]) / this.camera.scale + this.camera.centerY
        ];
    }
    panBy(screenDx, screenDy) {
        this.#fittedCamera = null;
        this.camera.centerX -= finite(screenDx) / this.camera.scale;
        this.camera.centerY += finite(screenDy) / this.camera.scale;
        this.render();
        return this;
    }
    zoomAt(factor, screenPoint = [
        this.#width / 2,
        this.#height / 2
    ]) {
        this.#fittedCamera = null;
        const before = this.screenToWorld(screenPoint);
        this.camera.scale = Math.min(1e7, Math.max(1e-7, this.camera.scale * Math.max(0.01, finite(factor, 1))));
        const after = this.screenToWorld(screenPoint);
        this.camera.centerX += before[0] - after[0];
        this.camera.centerY += before[1] - after[1];
        this.render();
        return this;
    }
    fit() {
        const document = this.#document;
        if (!document) return this;
        const layers = new Map(document.getTable('layers')?.records.map((layer)=>[
                layer.id,
                layer.payload
            ]) ?? []);
        const unboundedOrigins = [];
        const scene = this.#sceneProvider ? null : this.#defaultScene();
        const source = scene?.entities ?? this.#entities();
        const values = [];
        source.forEach((entity, index)=>{
            const layer = layers.get(String(entity.payload.layerId ?? ''));
            if (entity.payload.visible === false || layer?.visible === false || layer?.frozen === true) return;
            const bounds = scene?.bounds[index];
            if (bounds) values.push([
                bounds[0],
                bounds[1]
            ], [
                bounds[2],
                bounds[3]
            ]);
            else values.push(...this.#fitPoints(entity, 0, unboundedOrigins));
        });
        if (!values.length) {
            this.camera.centerX = unboundedOrigins[0]?.[0] ?? 50;
            this.camera.centerY = unboundedOrigins[0]?.[1] ?? 40;
            if (!unboundedOrigins.length) this.camera.scale = 4;
            this.#fittedCamera = {
                ...this.camera
            };
            return this.render(), this;
        }
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [x, y] of values){
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        this.camera.centerX = (minX + maxX) / 2;
        this.camera.centerY = (minY + maxY) / 2;
        this.camera.scale = Math.max(1e-7, Math.min(Math.max(1, this.#width - this.#padding * 2) / Math.max(1e-9, maxX - minX), Math.max(1, this.#height - this.#padding * 2) / Math.max(1e-9, maxY - minY)));
        this.#fittedCamera = {
            ...this.camera
        };
        this.render();
        return this;
    }
    hitTest(screenPoint, tolerancePixels = 8, options = {}) {
        const document = this.#document;
        if (!document) return null;
        const point = this.screenToWorld(screenPoint);
        const layers = new Map(document.getTable('layers')?.records.map((layer)=>[
                layer.id,
                layer.payload
            ]) ?? []);
        let best = null;
        const radius = tolerancePixels / this.camera.scale;
        const query = {
            document,
            spaceId: this.#activeSpaceId(),
            point,
            radius
        };
        const candidates = this.#sceneProvider?.hitCandidates?.(query) ?? this.#entities([
            point[0] - radius,
            point[1] - radius,
            point[0] + radius,
            point[1] + radius
        ]);
        for (const entity of candidates){
            if (!isEntitySelectable(document, entity, {
                ...options,
                spaceId: query.spaceId
            })) continue;
            const layer = layers.get(String(entity.payload.layerId ?? ''));
            if (layer?.visible === false || layer?.frozen === true) continue;
            try {
                if (entity.type === 'INSERT') {
                    if (hitTestDisplayedEntity(document, entity, point, radius)) best = {
                        entity,
                        distance: 0,
                        point: [
                            point[0],
                            point[1],
                            0
                        ]
                    };
                    continue;
                }
                if (entity.type === 'ELLIPSE') {
                    if (hitTestDisplayedEntity(document, entity, point, radius)) best = {
                        entity,
                        distance: 0,
                        point: [
                            point[0],
                            point[1],
                            0
                        ]
                    };
                    continue;
                }
                if (entity.type === 'SPLINE') {
                    const vertices = splineSamples(entity.payload).map((point)=>({
                            point
                        }));
                    const nearest = nearestPointOnEntity2({
                        ...entity,
                        type: 'LWPOLYLINE',
                        payload: {
                            vertices,
                            closed: entity.payload.closed === true
                        }
                    }, point);
                    if (nearest.distance <= radius && (!best || nearest.distance < best.distance)) best = {
                        entity,
                        distance: nearest.distance,
                        point: nearest.point
                    };
                    continue;
                }
                if (entity.type === 'DIMENSION') {
                    const projected = projectDimension(entity.payload, this.#document?.getObject(String(entity.payload.styleId ?? ''))?.payload);
                    if (projected) {
                        for (const arc of projected.arcs){
                            const nearest = nearestPointOnEntity2({
                                ...entity,
                                type: 'ARC',
                                payload: {
                                    ...arc
                                }
                            }, point);
                            if (nearest.distance <= radius && (!best || nearest.distance < best.distance)) best = {
                                entity,
                                distance: nearest.distance,
                                point: nearest.point
                            };
                        }
                        for (const [start, end] of projected.lines){
                            const nearest = nearestPointOnEntity2({
                                ...entity,
                                type: 'LINE',
                                payload: {
                                    start,
                                    end
                                }
                            }, point);
                            if (nearest.distance <= radius && (!best || nearest.distance < best.distance)) best = {
                                entity,
                                distance: nearest.distance,
                                point: nearest.point
                            };
                        }
                        continue;
                    }
                }
                const nearest = nearestPointOnEntity2(entity, point);
                if (nearest.distance * this.camera.scale <= tolerancePixels && (!best || nearest.distance < best.distance)) {
                    best = {
                        entity,
                        distance: nearest.distance,
                        point: nearest.point
                    };
                }
            } catch  {
                const samples = entityPoints(entity);
                const nearest = samples.map((value)=>({
                        value,
                        distance: Math.hypot(value[0] - point[0], value[1] - point[1])
                    })).sort((a, b)=>a.distance - b.distance)[0];
                if (nearest && nearest.distance * this.camera.scale <= tolerancePixels && (!best || nearest.distance < best.distance)) {
                    best = {
                        entity,
                        distance: nearest.distance,
                        point: [
                            nearest.value[0],
                            nearest.value[1],
                            0
                        ]
                    };
                }
            }
        }
        return best ? Object.freeze({
            ...best,
            point: Object.freeze(best.point)
        }) : null;
    }
    selectBox(first, second, options = {}) {
        if (!this.#document) return Object.freeze([]);
        const a = this.screenToWorld(first), b = this.screenToWorld(second), tolerance = .25 / this.camera.scale;
        const candidates = this.#entities([
            Math.min(a[0], b[0]) - tolerance,
            Math.min(a[1], b[1]) - tolerance,
            Math.max(a[0], b[0]) + tolerance,
            Math.max(a[1], b[1]) + tolerance
        ]);
        return Object.freeze(selectEntitiesInBox(this.#document, a, b, options.mode ?? (second[0] >= first[0] ? 'window' : 'crossing'), {
            ...options,
            spaceId: this.#activeSpaceId(),
            tolerance,
            candidates
        }));
    }
    selectFence(points, options = {}) {
        if (!this.#document) return Object.freeze([]);
        const world = points.map((point)=>this.screenToWorld(point)), tolerance = .25 / this.camera.scale;
        const xs = world.map((point)=>point[0]), ys = world.map((point)=>point[1]);
        const candidates = world.length ? [
            Math.min(...xs) - tolerance,
            Math.min(...ys) - tolerance,
            Math.max(...xs) + tolerance,
            Math.max(...ys) + tolerance
        ] : undefined;
        const entities = this.#entities(candidates);
        return Object.freeze(selectEntitiesByFence(this.#document, world, {
            ...options,
            spaceId: this.#activeSpaceId(),
            tolerance,
            candidates: entities
        }));
    }
    selectAll(options = {}) {
        const document = this.#document;
        if (!document) return Object.freeze([]);
        const query = {
            ...options,
            spaceId: this.#activeSpaceId()
        };
        return Object.freeze(this.#entities().filter((entity)=>isEntitySelectable(document, entity, query)).map((entity)=>entity.id));
    }
    getGrips(ids = [
        ...this.#selection
    ]) {
        const document = this.#document;
        if (!document) return Object.freeze([]);
        const result = [], query = {
            spaceId: this.#activeSpaceId()
        };
        for (const id of ids){
            const entity = document.getObject(id);
            if (!entity || !isEntitySelectable(document, entity, query)) continue;
            try {
                result.push(...getEntityGrips(entity));
            } catch  {}
        }
        return Object.freeze(result);
    }
    hitGrip(screenPoint, tolerancePixels = 7) {
        let best = null, distance = tolerancePixels;
        for (const grip of this.getGrips()){
            const p = this.worldToScreen([
                grip.point[0],
                grip.point[1]
            ]), d = Math.hypot(p[0] - screenPoint[0], p[1] - screenPoint[1]);
            if (d <= distance) {
                best = grip;
                distance = d;
            }
        }
        return best;
    }
    drawGrips(hoverId) {
        const context = this.context;
        context.save();
        context.setLineDash([]);
        context.lineWidth = 1;
        for (const grip of this.getGrips()){
            const [x, y] = this.worldToScreen([
                grip.point[0],
                grip.point[1]
            ]);
            context.fillStyle = hoverId === `${grip.entityId}:${grip.id}` ? '#ffbf69' : '#2863df';
            context.strokeStyle = '#dceaff';
            context.fillRect(x - 3.5, y - 3.5, 7, 7);
            context.strokeRect(x - 3.5, y - 3.5, 7, 7);
        }
        context.restore();
        return this;
    }
    render() {
        this.#viewportDiagnostics = [];
        this.#textDrawCount = 0;
        this.#drawnTextTypes.clear();
        this.#viewportWorkRemaining = 100000;
        this.#hatchDiagnostics = [];
        this.#hatchWorkRemaining = 100000;
        this.#hatchSampleWorkRemaining = HATCH_RASTER_FRAME_WORK;
        this.#hatchSamplePixelsRemaining = HATCH_RASTER_PIXEL_LIMIT;
        const context = this.context;
        const ratio = this.canvas.width / Math.max(1, this.#width);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, this.#width, this.#height);
        context.fillStyle = this.#background ?? (this.#theme === 'dark' ? '#081016' : '#f8fafc');
        context.fillRect(0, 0, this.#width, this.#height);
        if (this.#grid) this.#drawGrid();
        const document = this.#document;
        if (!document) {
            this.#report = Object.freeze({
                total: 0,
                culled: 0,
                detailCulled: 0,
                overviewEntities: 0,
                overviewPixels: 0,
                rendered: 0,
                approximated: 0,
                hidden: 0,
                unsupported: 0,
                approximateTypes: Object.freeze([]),
                unsupportedTypes: Object.freeze([]),
                width: this.#width,
                height: this.#height,
                scale: this.camera.scale
            });
            return this.#report;
        }
        const candidates = this.#entities(this.#visibleBounds());
        const sceneTotal = this.#sceneProvider ? candidates.length : this.#defaultScene().entities.length;
        const entities = [], detailEntities = [];
        for (const entity of candidates){
            if (sceneTotal < 1000 || this.#selection.has(entity.id) || this.#detailVisible(entity)) entities.push(entity);
            else detailEntities.push(entity);
        }
        const detailCulled = detailEntities.length;
        const layers = new Map(document.getTable('layers')?.records.map((layer)=>[
                layer.id,
                layer.payload
            ]) ?? []);
        const palette = this.#theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
        let rendered = 0, approximated = 0, hidden = 0;
        const approximateTypes = new Set();
        const unsupported = new Set();
        for (const entity of entities){
            const layer = layers.get(String(entity.payload.layerId ?? ''));
            if (attributeHidden(entity) || entity.payload.visible === false || layer?.visible === false || layer?.frozen === true) {
                hidden += 1;
                continue;
            }
            const color = this.#selection.has(entity.id) ? this.#selectionColor ?? (this.#theme === 'dark' ? '#b9ff72' : '#0b67e3') : this.#color(entity, layer) ?? palette[colorIndex(layer?.color)];
            const textBefore = this.#textDrawCount;
            if (this.#drawEntity(entity, color, 0, this.#selection.has(entity.id))) {
                rendered += 1;
                if (APPROXIMATE_TYPES.has(entity.type) || this.#textDrawCount > textBefore || entity.type === 'VIEWPORT' && this.#viewportDiagnostics.at(-1)?.approximated) {
                    approximated += 1;
                    approximateTypes.add(entity.type);
                }
            } else unsupported.add(entity.type);
        }
        const overview = this.#drawOverview(detailEntities, layers);
        this.#report = Object.freeze({
            total: sceneTotal,
            culled: Math.max(0, sceneTotal - entities.length),
            detailCulled,
            overviewEntities: overview.entities,
            overviewPixels: overview.pixels,
            rendered,
            approximated,
            hidden,
            unsupported: entities.length - rendered - hidden,
            approximateTypes: Object.freeze([
                ...new Set([
                    ...approximateTypes,
                    ...this.#drawnTextTypes
                ])
            ].sort()),
            unsupportedTypes: Object.freeze([
                ...unsupported
            ].sort()),
            hatchDiagnostics: Object.freeze(this.#hatchDiagnostics.map((item)=>Object.freeze(item))),
            viewportDiagnostics: Object.freeze(this.#viewportDiagnostics.map((item)=>Object.freeze({
                    ...item
                }))),
            width: this.#width,
            height: this.#height,
            scale: this.camera.scale
        });
        return this.#report;
    }
    #previewResources = new Map();
    drawPreview(entities, color = '#77a7ff', offset = [
        0,
        0
    ], resources = []) {
        const previous = this.#previewResources;
        this.#previewResources = new Map(resources.map((item)=>[
                item.id,
                item
            ]));
        try {
            for (const [index, spec] of entities.entries()){
                let payload = structuredClone(spec.payload);
                if (offset[0] || offset[1]) payload = transformEntityPayload(spec.type, payload, translation3(offset[0], offset[1]));
                this.#drawEntity({
                    id: `preview-${index}`,
                    handle: '',
                    kind: 'entity',
                    type: spec.type,
                    ownerId: null,
                    name: null,
                    payload,
                    extension: {
                        xdata: {},
                        xrecordIds: [],
                        reactorIds: [],
                        hyperlinks: []
                    },
                    erased: false,
                    source: null
                }, color, 0, true);
            }
            return this;
        } finally{
            this.#previewResources = previous;
        }
    }
    dispose() {
        this.#disposeDocument?.();
        this.#disposeDocument = null;
        this.#observer?.disconnect();
        this.#observer = null;
        this.#document = null;
        this.#spatialScene = null;
        this.#boundsCache = new WeakMap();
        this.#selection.clear();
        this.#hatchRasterCache = [];
    }
    #activeSpaceId() {
        const document = this.#document;
        if (!document) return '';
        return this.#spaceId ?? document.spaces.modelSpaceId;
    }
    #color(entity, layer) {
        const ownTrueColor = entity.payload.trueColor == null ? null : explicitColor(entity.payload.trueColor);
        if (ownTrueColor) return ownTrueColor;
        const color = entity.payload.color;
        if (typeof color === 'string' && !/^(?:bylayer|byblock)$/i.test(color)) {
            const cssColor = /^(?:#|rgb|hsl)/i.test(color) ? explicitColor(color) : null;
            if (cssColor) return cssColor;
        }
        if (color != null && Number.isFinite(Number(color)) && Number(color) > 0 && Number(color) < 256) return aciColor(color, this.#theme);
        return (layer?.trueColor == null ? null : explicitColor(layer.trueColor)) ?? (typeof layer?.color === 'string' && /^(?:#|rgb|hsl)/i.test(layer.color) ? explicitColor(layer.color) : null) ?? aciColor(layer?.color ?? 7, this.#theme);
    }
    #fitPoints(entity, depth = 0, unboundedOrigins = []) {
        if (entity.type === 'XLINE' || entity.type === 'RAY') {
            const origin = point2(entity.payload.origin);
            if (origin) unboundedOrigins.push(origin);
            return [];
        }
        if (attributeHidden(entity)) return [];
        if ([
            'TEXT',
            'ATTRIB',
            'ATTDEF'
        ].includes(entity.type)) {
            try {
                return layoutCadText(entity.payload, this.#document?.getObject(String(entity.payload.styleId ?? ''))?.payload).corners;
            } catch  {
                return [];
            }
        }
        if (entity.type !== 'INSERT' || depth > 12) return entityPoints(entity);
        const payload = entity.payload;
        const blockId = String(payload.blockRecordId ?? '');
        const block = this.#document?.getObject(blockId);
        const position = point2(payload.position), base = point2(block?.payload.basePoint) ?? [
            0,
            0
        ];
        if (!position || !block) return entityPoints(entity);
        const inputScale = Array.isArray(payload.scale) ? payload.scale : [
            payload.scale ?? 1,
            payload.scale ?? 1
        ];
        const matrix = multiply3(translation3(position[0], position[1]), multiply3(rotation3(finite(payload.rotation)), multiply3(scale3(finite(inputScale[0], 1), finite(inputScale[1], 1)), translation3(-base[0], -base[1]))));
        const output = [];
        for (const child of this.#document?.listEntities({
            ownerId: blockId
        }) ?? []){
            const layer = this.#document?.getObject(String(child.payload.layerId ?? ''))?.payload;
            if (isAttachedAttribute(child) || attributeHidden(child) || child.type === 'ATTDEF' && (Number(child.payload.flags ?? 0) & 2) === 0 || child.payload.visible === false || layer?.visible === false || layer?.frozen === true) continue;
            try {
                const childOrigins = [], transform = (p)=>[
                        matrix[0] * p[0] + matrix[2] * p[1] + matrix[4],
                        matrix[1] * p[0] + matrix[3] * p[1] + matrix[5]
                    ];
                output.push(...this.#fitPoints(child, depth + 1, childOrigins).map(transform));
                unboundedOrigins.push(...childOrigins.map(transform));
            } catch  {
                output.push(position);
            }
        }
        if (this.#document) {
            for (const attribute of insertAttributes(this.#document, entity))if (visibleAttribute(this.#document, attribute)) output.push(...this.#fitPoints(attribute, depth + 1, unboundedOrigins));
        }
        return output;
    }
    #visibleBounds() {
        const lower = this.screenToWorld([
            0,
            this.#height
        ]), upper = this.screenToWorld([
            this.#width,
            0
        ]);
        const margin = 4 / this.camera.scale;
        return [
            lower[0] - margin,
            lower[1] - margin,
            upper[0] + margin,
            upper[1] + margin
        ];
    }
    #detailVisible(entity) {
        if (entity.type === 'POINT' || entity.type === 'RAY' || entity.type === 'XLINE') return true;
        const bounds = this.#boundsCache.get(entity);
        if (!bounds) return true;
        return Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * this.camera.scale >= .1;
    }
    #drawOverview(entities, layers) {
        if (!entities.length) return {
            entities: 0,
            pixels: 0
        };
        const occupied = new Set();
        let visible = 0;
        for (const entity of entities){
            const layer = layers.get(String(entity.payload.layerId ?? ''));
            if (attributeHidden(entity) || entity.payload.visible === false || layer?.visible === false || layer?.frozen === true) continue;
            const bounds = this.#boundsCache.get(entity);
            if (!bounds) continue;
            const screen = this.worldToScreen([
                (bounds[0] + bounds[2]) / 2,
                (bounds[1] + bounds[3]) / 2
            ]);
            const x = Math.floor(screen[0]), y = Math.floor(screen[1]);
            if (x >= 0 && x < this.#width && y >= 0 && y < this.#height) occupied.add(y * Math.ceil(this.#width) + x);
            visible++;
        }
        if (occupied.size) {
            const canvas = this.context;
            canvas.save();
            canvas.fillStyle = this.#theme === 'dark' ? '#9fb4c8' : '#53687d';
            canvas.globalAlpha = .7;
            const stride = Math.ceil(this.#width);
            for (const key of occupied)canvas.fillRect(key % stride, Math.floor(key / stride), 1, 1);
            canvas.restore();
        }
        return {
            entities: visible,
            pixels: occupied.size
        };
    }
    #defaultScene() {
        const document = this.#document;
        if (!document) throw new Error('A document is required for the default canvas scene');
        const spaceId = this.#activeSpaceId();
        if (this.#spatialScene?.document === document && this.#spatialScene.revision === document.revision && this.#spatialScene.spaceId === spaceId) return this.#spatialScene;
        const entities = document.listEntities({
            ownerId: spaceId
        }).filter((entity)=>!isAttachedAttribute(entity));
        const bounds = entities.map((entity)=>{
            const cached = this.#boundsCache.get(entity);
            if (cached !== undefined || this.#boundsCache.has(entity)) return cached ?? null;
            return displayedEntityBounds(document, entity, this.#boundsCache);
        });
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const value of bounds)if (value) {
            minX = Math.min(minX, value[0]);
            minY = Math.min(minY, value[1]);
            maxX = Math.max(maxX, value[2]);
            maxY = Math.max(maxY, value[3]);
        }
        if (!Number.isFinite(minX)) minX = minY = 0, maxX = maxY = 1;
        if (maxX <= minX) maxX = minX + 1;
        if (maxY <= minY) maxY = minY + 1;
        const extent = [
            minX,
            minY,
            maxX,
            maxY
        ];
        const divisions = Math.max(1, Math.min(128, Math.ceil(Math.sqrt(Math.max(1, entities.length) / 8))));
        const cells = new Map();
        const globals = [];
        const cellX = (value)=>Math.max(0, Math.min(divisions - 1, Math.floor((value - minX) / (maxX - minX) * divisions)));
        const cellY = (value)=>Math.max(0, Math.min(divisions - 1, Math.floor((value - minY) / (maxY - minY) * divisions)));
        bounds.forEach((value, index)=>{
            if (!value) {
                globals.push(index);
                return;
            }
            const x0 = cellX(value[0]), x1 = cellX(value[2]), y0 = cellY(value[1]), y1 = cellY(value[3]);
            if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) {
                globals.push(index);
                return;
            }
            for(let y = y0; y <= y1; y++)for(let x = x0; x <= x1; x++){
                const key = y * divisions + x, bucket = cells.get(key);
                if (bucket) bucket.push(index);
                else cells.set(key, [
                    index
                ]);
            }
        });
        const buckets = new Map();
        for (const [key, value] of cells)buckets.set(key, Object.freeze(value));
        this.#spatialScene = {
            document,
            revision: document.revision,
            spaceId,
            entities: Object.freeze(entities),
            bounds: Object.freeze(bounds),
            globals: Object.freeze(globals),
            buckets,
            divisions,
            extent
        };
        return this.#spatialScene;
    }
    #entities(bounds) {
        const document = this.#document;
        if (!document) return [];
        const spaceId = this.#activeSpaceId();
        if (this.#sceneProvider) return this.#sceneProvider.listEntities({
            document,
            spaceId,
            ...bounds ? {
                bounds
            } : {}
        }).filter((entity)=>!isAttachedAttribute(entity));
        const scene = this.#defaultScene();
        if (!bounds) return scene.entities;
        const [minX, minY, maxX, maxY] = scene.extent;
        const intersects = (value)=>value[2] >= bounds[0] && value[0] <= bounds[2] && value[3] >= bounds[1] && value[1] <= bounds[3];
        const selected = new Set(scene.globals);
        if (bounds[2] >= minX && bounds[0] <= maxX && bounds[3] >= minY && bounds[1] <= maxY) {
            const cellX = (value)=>Math.max(0, Math.min(scene.divisions - 1, Math.floor((value - minX) / (maxX - minX) * scene.divisions)));
            const cellY = (value)=>Math.max(0, Math.min(scene.divisions - 1, Math.floor((value - minY) / (maxY - minY) * scene.divisions)));
            const x0 = cellX(bounds[0]), x1 = cellX(bounds[2]), y0 = cellY(bounds[1]), y1 = cellY(bounds[3]);
            for(let y = y0; y <= y1; y++)for(let x = x0; x <= x1; x++)for (const index of scene.buckets.get(y * scene.divisions + x) ?? [])selected.add(index);
        }
        return [
            ...selected
        ].sort((a, b)=>a - b).filter((index)=>scene.bounds[index] === null || intersects(scene.bounds[index])).map((index)=>scene.entities[index]);
    }
    #drawGrid() {
        const context = this.context;
        let spacing = 10;
        while(spacing * this.camera.scale < 20)spacing *= 2;
        while(spacing * this.camera.scale > 80)spacing /= 2;
        const lower = this.screenToWorld([
            0,
            this.#height
        ]), upper = this.screenToWorld([
            this.#width,
            0
        ]);
        context.fillStyle = this.#theme === 'dark' ? '#23303b' : '#d8e0e8';
        for(let x = Math.ceil(lower[0] / spacing) * spacing; x < upper[0]; x += spacing){
            for(let y = Math.ceil(lower[1] / spacing) * spacing; y < upper[1]; y += spacing){
                const screen = this.worldToScreen([
                    x,
                    y
                ]);
                context.fillRect(Math.round(screen[0]), Math.round(screen[1]), 1, 1);
            }
        }
    }
    #strokePath(values, close = false) {
        if (!values.length) return false;
        const context = this.context;
        context.beginPath();
        values.forEach((value, index)=>{
            const screen = this.worldToScreen(value);
            if (index) context.lineTo(screen[0], screen[1]);
            else context.moveTo(screen[0], screen[1]);
        });
        if (close) context.closePath();
        context.stroke();
        return true;
    }
    #denseHatchRaster(payload, lines, bounds, color, create, projection) {
        const ratio = this.canvas.width / Math.max(1, this.#width);
        const topLeft = this.worldToScreen([
            bounds[0],
            bounds[3]
        ]), bottomRight = this.worldToScreen([
            bounds[2],
            bounds[1]
        ]);
        const x = Math.max(0, Math.floor(topLeft[0] * ratio)), y = Math.max(0, Math.floor(topLeft[1] * ratio));
        const width = Math.max(0, Math.min(this.canvas.width, Math.ceil(bottomRight[0] * ratio)) - x);
        const height = Math.max(0, Math.min(this.canvas.height, Math.ceil(bottomRight[1] * ratio)) - y);
        const key = [
            this.camera.centerX,
            this.camera.centerY,
            this.camera.scale,
            this.#width,
            this.#height,
            ratio,
            x,
            y,
            width,
            height,
            this.context.lineWidth,
            color,
            projection?.instanceKey ?? ''
        ].join('|');
        const sourcePayload = projection?.payload ?? payload;
        const index = this.#hatchRasterCache.findIndex((entry)=>entry.payload === sourcePayload && entry.key === key);
        if (index >= 0) {
            const entry = this.#hatchRasterCache.splice(index, 1)[0];
            this.#hatchRasterCache.push(entry);
            return entry.raster;
        }
        if (!create) return null;
        const result = {
            source: null,
            x: x / ratio,
            y: y / ratio,
            width: width / ratio,
            height: height / ratio
        };
        const pixels = width * height;
        if (!pixels) return result;
        if (!Number.isSafeInteger(pixels) || pixels > HATCH_RASTER_PIXEL_LIMIT || pixels > this.#hatchSamplePixelsRemaining) return {
            ...result,
            reason: 'pixel-budget'
        };
        this.#hatchSamplePixelsRemaining -= pixels;
        const source = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : this.canvas.ownerDocument?.createElement('canvas');
        if (!source) return {
            ...result,
            reason: 'canvas-unavailable'
        };
        source.width = width;
        source.height = height;
        const target = source.getContext('2d');
        if (!target) return {
            ...result,
            reason: 'canvas-unavailable'
        };
        const data = target.createImageData(width, height);
        const sampler = createHatchStrokeCoverage(lines, this.context.lineWidth / this.camera.scale);
        let reason;
        sampling: for(let row = 0; row < height; row++){
            for(let column = 0; column < width; column++){
                let covered = 0;
                for (const dy of [
                    .25,
                    .75
                ])for (const dx of [
                    .25,
                    .75
                ]){
                    if (this.#hatchSampleWorkRemaining < 1) {
                        reason = 'budget';
                        break sampling;
                    }
                    const point = this.screenToWorld([
                        (x + column + dx) / ratio,
                        (y + row + dy) / ratio
                    ]);
                    const sample = sampler.sample(point, Math.min(32, this.#hatchSampleWorkRemaining));
                    this.#hatchSampleWorkRemaining -= Math.max(1, sample.work);
                    if (sample.covered === null) {
                        reason = sample.reason ?? 'budget';
                        break sampling;
                    }
                    if (sample.covered) covered++;
                }
                const offset = (row * width + column) * 4;
                data.data[offset] = data.data[offset + 1] = data.data[offset + 2] = 255;
                data.data[offset + 3] = Math.round(255 * covered / 4);
            }
        }
        if (reason) result.reason = reason;
        else {
            target.putImageData(data, 0, 0);
            target.globalCompositeOperation = 'source-in';
            target.fillStyle = color;
            target.fillRect(0, 0, width, height);
            result.source = source;
        }
        if (reason !== 'budget') {
            this.#hatchRasterCache.push({
                payload: sourcePayload,
                key,
                raster: result,
                bytes: result.source ? pixels * 4 : 0
            });
            while(this.#hatchRasterCache.length > 8 || this.#hatchRasterCache.reduce((sum, entry)=>sum + entry.bytes, 0) > HATCH_RASTER_CACHE_BYTES)this.#hatchRasterCache.shift();
        }
        return result;
    }
    #drawEntity(entity, color, depth, overrideColor = false, projection, inherited) {
        if (depth > 12) return false;
        if (attributeHidden(entity)) return true;
        const context = this.context, payload = entity.payload;
        const view = this.#viewportState;
        if (view) {
            if (--this.#viewportWorkRemaining < 0) {
                view.diagnostic.reason = 'budget';
                view.diagnostic.unsupported++;
                return false;
            }
            if (view.frozen.has(String(payload.layerId ?? ''))) {
                view.diagnostic.hidden++;
                return true;
            }
        }
        const layer = this.#previewResources.get(String(payload.layerId ?? '')) ?? this.#document?.getObject(String(payload.layerId ?? ''));
        const layerPayload = layer && 'name' in layer && layer.name === '0' && inherited?.layer || layer?.payload;
        context.save();
        context.strokeStyle = color;
        context.fillStyle = color;
        const lineweight = payload.lineweight;
        const lineweightName = String(lineweight ?? 'BYLAYER').toUpperCase();
        const rawLineweight = finite(lineweightName === 'BYBLOCK' || Number(lineweight) === -2 ? inherited?.lineweight ?? layerPayload?.lineweight : lineweightName === 'BYLAYER' || Number(lineweight) === -1 ? layerPayload?.lineweight : lineweight, 0);
        const millimeters = rawLineweight > 5 ? rawLineweight / 100 : rawLineweight;
        context.lineWidth = this.#selection.has(entity.id) ? 2 : this.#showLineweights && millimeters > 0 ? Math.max(0.5, Math.min(8, millimeters * 96 / 25.4)) : 1;
        const transparency = finite(payload.transparency ?? layer?.payload.transparency, 0);
        context.globalAlpha = transparency > 1 ? Math.max(0.05, 1 - transparency / 255) : transparency > 0 ? Math.max(0.05, 1 - transparency) : 1;
        const ownLinetype = this.#previewResources.get(String(payload.linetypeId ?? '')) ?? this.#document?.getObject(String(payload.linetypeId ?? ''));
        const linetypeName = String(ownLinetype && 'name' in ownLinetype ? ownLinetype.name : payload.linetypeName ?? (payload.linetypeId == null ? 'BYLAYER' : '')).toUpperCase();
        const linetypeId = String(linetypeName === 'BYBLOCK' ? inherited?.linetypeId ?? layerPayload?.linetypeId ?? '' : linetypeName === 'BYLAYER' ? layerPayload?.linetypeId ?? '' : payload.linetypeId ?? layerPayload?.linetypeId ?? '');
        const linetype = this.#previewResources.get(linetypeId) ?? this.#document?.getObject(linetypeId);
        const pattern = Array.isArray(linetype?.payload.patternSegments) ? linetype.payload.patternSegments : Array.isArray(linetype?.payload.pattern) ? linetype.payload.pattern : [];
        const sourcePayload = projection?.payload ?? payload;
        const nativeDashScale = effectiveLinetypeScale(this.#document?.snapshot().header.systemVariables ?? {}, sourcePayload);
        const transformScale = projection?.matrix ? uniformTransformScale(projection.matrix) : view?.scale ?? 1;
        if (pattern.length && transformScale == null) {
            context.restore();
            return false;
        }
        const dash = pattern.map((value)=>Math.abs(finite(value)) * nativeDashScale * this.camera.scale * (transformScale ?? 1)).filter((value)=>value > 0);
        context.setLineDash(dash);
        let drawn = true;
        if (entity.type === 'LINE') drawn = this.#strokePath(points([
            payload.start,
            payload.end
        ]));
        else if (entity.type === 'RAY' || entity.type === 'XLINE') {
            const origin = point2(payload.origin), direction = point2(payload.direction);
            if (!origin || !direction) drawn = false;
            else {
                const length = Math.hypot(direction[0], direction[1]);
                if (!(length > 0)) drawn = false;
                else {
                    const p = this.worldToScreen(origin), u = [
                        direction[0] / length,
                        -direction[1] / length
                    ];
                    let lo = entity.type === 'RAY' ? 0 : -Infinity, hi = Infinity;
                    for (const [axis, extent] of [
                        [
                            0,
                            this.#width
                        ],
                        [
                            1,
                            this.#height
                        ]
                    ]){
                        if (u[axis] === 0) {
                            if (p[axis] < 0 || p[axis] > extent) {
                                lo = 1;
                                hi = 0;
                                break;
                            }
                        } else {
                            const a = -p[axis] / u[axis], b = (extent - p[axis]) / u[axis];
                            lo = Math.max(lo, Math.min(a, b));
                            hi = Math.min(hi, Math.max(a, b));
                        }
                    }
                    if (lo <= hi && Number.isFinite(lo) && Number.isFinite(hi)) {
                        const at = (t)=>[
                                Math.max(0, Math.min(this.#width, p[0] + u[0] * t)),
                                Math.max(0, Math.min(this.#height, p[1] + u[1] * t))
                            ];
                        const a = at(lo), b = at(hi);
                        const dashCycle = dash.reduce((sum, value)=>sum + value, 0) * (dash.length % 2 ? 2 : 1);
                        if (dashCycle > 0) context.lineDashOffset = lo % dashCycle;
                        context.beginPath();
                        context.moveTo(a[0], a[1]);
                        context.lineTo(b[0], b[1]);
                        context.stroke();
                    }
                }
            }
        } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
            const center = point2(payload.center), radius = Math.abs(finite(payload.radius));
            if (!center || !(radius > 0)) drawn = false;
            else {
                const start = entity.type === 'ARC' ? finite(payload.startAngle) : 0;
                const end = finite(payload.endAngle);
                const sweep = entity.type !== 'ARC' ? Math.PI * 2 : payload.clockwise === true ? -normalizeSweep(end, start) : normalizeSweep(start, end);
                const screen = this.worldToScreen(center);
                context.beginPath();
                context.arc(screen[0], screen[1], radius * this.camera.scale, -start, -(start + sweep), sweep > 0);
                context.stroke();
            }
        } else if (entity.type === 'POINT') {
            const value = point2(payload.position);
            if (!value) drawn = false;
            else {
                const screen = this.worldToScreen(value);
                context.beginPath();
                context.moveTo(screen[0] - 4, screen[1]);
                context.lineTo(screen[0] + 4, screen[1]);
                context.moveTo(screen[0], screen[1] - 4);
                context.lineTo(screen[0], screen[1] + 4);
                context.stroke();
            }
        } else if ([
            'LWPOLYLINE',
            'POLYLINE'
        ].includes(entity.type)) drawn = this.#strokePath(polylineSamples(payload), payload.closed === true);
        else if (entity.type === 'ELLIPSE') {
            const center = point2(payload.center), axis = point2(payload.majorAxis);
            if (!center || !axis) drawn = false;
            else {
                const radius = Math.hypot(axis[0], axis[1]), ratio = Math.abs(finite(payload.ratio, 1));
                const rotation = Math.atan2(axis[1], axis[0]), start = finite(payload.startParameter), end = finite(payload.endParameter, Math.PI * 2);
                const sweep = normalizeSweep(start, end);
                const screen = this.worldToScreen(center);
                context.beginPath();
                context.ellipse(screen[0], screen[1], radius * this.camera.scale, radius * ratio * this.camera.scale, -rotation, -start, -(start + sweep), true);
                context.stroke();
            }
        } else if (entity.type === 'SPLINE') {
            try {
                drawn = this.#strokePath(splineSamples(payload), payload.closed === true);
            } catch  {
                drawn = false;
            }
        } else if ([
            'TEXT',
            'MTEXT',
            'ATTDEF',
            'ATTRIB'
        ].includes(entity.type)) {
            try {
                const source = projection?.payload ?? payload, style = this.#document?.getObject(String(source.styleId ?? ''))?.payload;
                const font = (height, family)=>{
                    const desired = Math.max(.01, height * this.camera.scale);
                    context.font = desired + 'px ' + family;
                    const cap = context.measureText('H').actualBoundingBoxAscent;
                    context.font = (cap > 0 ? desired * desired / cap : desired) + 'px ' + family;
                };
                const layout = layoutCadText(source, style, (value, height, family)=>{
                    font(height, family);
                    return context.measureText(value).width / this.camera.scale;
                });
                font(layout.height, layout.family);
                const m = projection?.matrix ? multiply3(projection.matrix, layout.matrix) : layout.matrix;
                const origin = this.worldToScreen([
                    m[4],
                    m[5]
                ]);
                context.transform(m[0], -m[1], -m[2], m[3], origin[0], origin[1]);
                context.textBaseline = 'alphabetic';
                context.textAlign = 'left';
                context.fillText(layout.text, layout.left * this.camera.scale, -layout.bottom * this.camera.scale);
                this.#textDrawCount++;
                this.#drawnTextTypes.add(entity.type);
            } catch  {
                drawn = false;
            }
        } else if (entity.type === 'HATCH') {
            const loops = Array.isArray(payload.boundaryLoops) ? payload.boundaryLoops : [];
            const unsupportedBoundary = loops.some((loop)=>Array.isArray(loop.edges) && loop.edges.some((edge)=>![
                        'LINE',
                        'ARC'
                    ].includes(String(edge.type).toUpperCase())));
            const paths = loops.map((loop)=>{
                const value = loop;
                if (Array.isArray(value.vertices)) return polylineSamples({
                    vertices: value.vertices,
                    closed: true
                });
                const result = [];
                for (const edge of Array.isArray(value.edges) ? value.edges : []){
                    const e = edge, center = point2(e.center);
                    if (center && finite(e.radius) > 0) {
                        const a = finite(e.startAngle), b = finite(e.endAngle), clockwise = e.clockwise === true || e.counterClockwise === false;
                        const sweep = clockwise ? -normalizeSweep(b, a) : normalizeSweep(a, b);
                        for(let step = 0; step <= 72; step++){
                            const angle = a + sweep * step / 72;
                            result.push([
                                center[0] + Math.cos(angle) * finite(e.radius),
                                center[1] + Math.sin(angle) * finite(e.radius)
                            ]);
                        }
                    } else result.push(...points([
                        e.start,
                        e.end
                    ]));
                }
                return result;
            }).filter((path)=>path.length >= 3);
            drawn = paths.length > 0 && !unsupportedBoundary;
            if (unsupportedBoundary) this.#hatchDiagnostics.push({
                entityId: entity.id,
                reason: 'unsupported-boundary'
            });
            if (drawn) {
                context.beginPath();
                for (const path of paths){
                    path.forEach((value, index)=>{
                        const p = this.worldToScreen(value);
                        index ? context.lineTo(p[0], p[1]) : context.moveTo(p[0], p[1]);
                    });
                    context.closePath();
                }
                const patternName = String(payload.patternName ?? 'ANSI31').toUpperCase();
                if (payload.solid === true || patternName === 'SOLID') context.fill('evenodd');
                else {
                    try {
                        const all = paths.flat(), lower = this.screenToWorld([
                            0,
                            this.#height
                        ]), upper = this.screenToWorld([
                            this.#width,
                            0
                        ]);
                        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                        for (const p of all){
                            x0 = Math.min(x0, p[0]);
                            y0 = Math.min(y0, p[1]);
                            x1 = Math.max(x1, p[0]);
                            y1 = Math.max(y1, p[1]);
                        }
                        const bounds = [
                            Math.max(x0, lower[0]),
                            Math.max(y0, lower[1]),
                            Math.min(x1, upper[0]),
                            Math.min(y1, upper[1])
                        ];
                        if (bounds[0] <= bounds[2] && bounds[1] <= bounds[3]) {
                            const lines = hatchPatternLines(payload);
                            let raster = this.#denseHatchRaster(payload, lines, bounds, color, false, projection);
                            const strokes = raster?.source ? {
                                segments: [],
                                dots: [],
                                limited: true,
                                work: 0
                            } : this.#hatchWorkRemaining > 0 ? hatchStrokes(lines, bounds, Math.min(20000, this.#hatchWorkRemaining)) : {
                                segments: [],
                                dots: [],
                                limited: true,
                                work: 0
                            };
                            this.#hatchWorkRemaining -= strokes.work;
                            if (strokes.limited && !raster) raster = this.#denseHatchRaster(payload, lines, bounds, color, true, projection);
                            context.clip('evenodd');
                            context.setLineDash([]);
                            context.lineCap = 'butt';
                            if (raster?.source) {
                                context.imageSmoothingEnabled = false;
                                context.drawImage(raster.source, raster.x, raster.y, raster.width, raster.height);
                            } else {
                                context.beginPath();
                                for (const [a, b] of strokes.segments){
                                    const p = this.worldToScreen(a), q = this.worldToScreen(b);
                                    context.moveTo(p[0], p[1]);
                                    context.lineTo(q[0], q[1]);
                                }
                                context.stroke();
                                context.beginPath();
                                for (const dot of strokes.dots){
                                    const p = this.worldToScreen(dot), radius = Math.max(.75, context.lineWidth / 2);
                                    context.moveTo(p[0] + radius, p[1]);
                                    context.arc(p[0], p[1], radius, 0, Math.PI * 2);
                                }
                                context.fill();
                                if (strokes.limited) this.#hatchDiagnostics.push({
                                    entityId: entity.id,
                                    reason: 'budget',
                                    ...raster?.reason ? {
                                        samplingReason: raster.reason
                                    } : {}
                                });
                            }
                        }
                    } catch  {
                        context.stroke();
                        drawn = false;
                        this.#hatchDiagnostics.push({
                            entityId: entity.id,
                            reason: 'unsupported-pattern'
                        });
                    }
                }
            }
        } else if (entity.type === 'DIMENSION') {
            const projected = projection && 'dimension' in projection ? projection.dimension : projectDimension(payload, this.#document?.getObject(String(payload.styleId ?? ''))?.payload);
            drawn = projected !== null;
            if (projected) {
                if (projection?.dimensionMatrix) {
                    const [a, b, c, d, e, f] = projection.dimensionMatrix;
                    const [x, y] = this.worldToScreen([
                        0,
                        0
                    ]), k = this.camera.scale;
                    context.transform(a, -b, -c, d, k * e + x - a * x + c * y, -k * f + y + b * x - d * y);
                }
                for (const arc of projected.arcs){
                    const screen = this.worldToScreen(arc.center);
                    context.beginPath();
                    context.arc(screen[0], screen[1], arc.radius * this.camera.scale, -arc.startAngle, -arc.endAngle, true);
                    context.stroke();
                }
                for (const segment of projected.lines)this.#strokePath(segment);
                for (const arrow of projected.arrows){
                    this.#strokePath(arrow, true);
                    context.fill();
                }
                const label = projected.label, screen = this.worldToScreen(label.position);
                context.translate(screen[0], screen[1]);
                context.rotate(-label.rotation);
                context.font = `${Math.max(.01, label.height * this.camera.scale)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
                context.textAlign = 'center';
                context.textBaseline = 'bottom';
                context.fillText(label.text, 0, 0);
            }
        } else if ([
            'LEADER',
            'MLEADER'
        ].includes(entity.type)) {
            const values = points(Array.isArray(payload.vertices) && payload.vertices.length ? payload.vertices : payload.definitionPoints);
            drawn = this.#strokePath(values);
            if (drawn && entity.type === 'LEADER' && payload.arrowEnabled !== false && values.length >= 2) {
                const tip = this.worldToScreen(values[0]), next = this.worldToScreen(values[1]), length = Math.hypot(next[0] - tip[0], next[1] - tip[1]);
                if (length > 1e-6) {
                    const size = Math.max(5, Math.min(18, Math.abs(finite(payload.arrowSize, finite(payload.textHeight, 2.5))) * this.camera.scale)), ux = (next[0] - tip[0]) / length, uy = (next[1] - tip[1]) / length, rearX = tip[0] + ux * size, rearY = tip[1] + uy * size, half = size * .36;
                    context.beginPath();
                    context.moveTo(tip[0], tip[1]);
                    context.lineTo(rearX - uy * half, rearY + ux * half);
                    context.lineTo(rearX + uy * half, rearY - ux * half);
                    context.closePath();
                    context.fill();
                }
            }
            const position = point2(payload.textPosition);
            if (position && !payload.annotationId) {
                const screen = this.worldToScreen(position);
                const text = payload.text ?? payload.textOverride ?? (payload.measurement == null ? '' : finite(payload.measurement).toFixed(2)), style = this.#document?.getObject(String(payload.styleId ?? ''))?.payload;
                const height = Math.max(.01, finite(payload.textHeight, 2.5));
                context.font = `${height * this.camera.scale}px ${layoutCadText({
                    position: [
                        0,
                        0
                    ],
                    text: String(text),
                    height
                }, style).family}`;
                context.textAlign = 'left';
                context.textBaseline = 'bottom';
                context.fillText(String(text), screen[0], screen[1]);
            }
        } else if ([
            'SOLID',
            'TRACE',
            'WIPEOUT',
            'REVISION_CLOUD'
        ].includes(entity.type)) {
            const values = points(payload.vertices);
            drawn = this.#strokePath(values, true);
            if (drawn) {
                context.globalAlpha = 0.12;
                context.fill();
                context.globalAlpha = 1;
            }
        } else if (entity.type === 'VIEWPORT') {
            const center = point2(payload.center), width = Math.abs(finite(payload.width)), height = Math.abs(finite(payload.height));
            if (!center || !width || !height) drawn = false;
            else {
                drawn = this.#drawViewport(entity, depth);
                const screen = this.worldToScreen([
                    center[0] - width / 2,
                    center[1] + height / 2
                ]);
                context.strokeRect(screen[0], screen[1], width * this.camera.scale, height * this.camera.scale);
            }
        } else if (entity.type === 'TABLE') {
            const position = point2(payload.position);
            const columnWidths = Array.isArray(payload.columnWidths) ? payload.columnWidths.map((value)=>Math.abs(finite(value))) : [];
            const rowHeights = Array.isArray(payload.rowHeights) ? payload.rowHeights.map((value)=>Math.abs(finite(value))) : [];
            if (!position || !columnWidths.length || !rowHeights.length) drawn = false;
            else {
                const totalWidth = columnWidths.reduce((sum, value)=>sum + value, 0), totalHeight = rowHeights.reduce((sum, value)=>sum + value, 0);
                const topLeft = this.worldToScreen([
                    position[0],
                    position[1]
                ]);
                context.strokeRect(topLeft[0], topLeft[1], totalWidth * this.camera.scale, totalHeight * this.camera.scale);
                let cursor = 0;
                for (const width of columnWidths.slice(0, -1)){
                    cursor += width;
                    const x = topLeft[0] + cursor * this.camera.scale;
                    context.beginPath();
                    context.moveTo(x, topLeft[1]);
                    context.lineTo(x, topLeft[1] + totalHeight * this.camera.scale);
                    context.stroke();
                }
                cursor = 0;
                for (const height of rowHeights.slice(0, -1)){
                    cursor += height;
                    const y = topLeft[1] + cursor * this.camera.scale;
                    context.beginPath();
                    context.moveTo(topLeft[0], y);
                    context.lineTo(topLeft[0] + totalWidth * this.camera.scale, y);
                    context.stroke();
                }
            }
        } else if (entity.type === 'IMAGE') {
            const position = point2(payload.position), width = Math.abs(finite(payload.width, 20)), height = Math.abs(finite(payload.height, 12));
            if (!position) drawn = false;
            else {
                const topLeft = this.worldToScreen([
                    position[0],
                    position[1] + height
                ]);
                context.setLineDash([
                    5,
                    4
                ]);
                context.strokeRect(topLeft[0], topLeft[1], width * this.camera.scale, height * this.camera.scale);
                context.beginPath();
                context.moveTo(topLeft[0], topLeft[1]);
                context.lineTo(topLeft[0] + width * this.camera.scale, topLeft[1] + height * this.camera.scale);
                context.moveTo(topLeft[0] + width * this.camera.scale, topLeft[1]);
                context.lineTo(topLeft[0], topLeft[1] + height * this.camera.scale);
                context.stroke();
            }
        } else if (entity.type === 'INSERT') {
            const source = projection?.payload ?? payload;
            const blockRecordId = String(source.blockRecordId ?? '');
            const block = this.#document?.getObject(blockRecordId);
            const position = point2(source.position), base = point2(block?.payload.basePoint) ?? [
                0,
                0
            ];
            if (!block || !position) drawn = false;
            else {
                const inputScale = Array.isArray(source.scale) ? source.scale : [
                    source.scale ?? 1,
                    source.scale ?? 1
                ];
                const factorX = finite(inputScale[0], 1), factorY = finite(inputScale[1], factorX);
                const localMatrix = multiply3(translation3(position[0], position[1]), multiply3(rotation3(finite(source.rotation)), multiply3(scale3(factorX, factorY), translation3(-base[0], -base[1]))));
                const matrix = projection?.matrix ? multiply3(projection.matrix, localMatrix) : localMatrix;
                const children = (this.#document?.listEntities({
                    ownerId: blockRecordId
                }) ?? []).filter((child)=>!isAttachedAttribute(child) && !(child.type === 'ATTDEF' && (Number(child.payload.flags ?? 0) & 2) === 0));
                drawn = children.length > 0;
                for (const child of children){
                    if (view && this.#viewportWorkRemaining-- <= 0) {
                        view.diagnostic.reason = 'budget';
                        drawn = false;
                        break;
                    }
                    const childLayer = this.#document?.getObject(String(child.payload.layerId ?? ''));
                    if (attributeHidden(child) || child.payload.visible === false || childLayer?.payload.visible === false || childLayer?.payload.frozen === true) continue;
                    try {
                        const transformed = [
                            'INSERT',
                            'DIMENSION',
                            'TEXT',
                            'MTEXT',
                            'ATTRIB',
                            'ATTDEF'
                        ].includes(child.type) ? child : {
                            ...child,
                            payload: transformEntityPayload(child.type, structuredClone(child.payload), matrix)
                        };
                        const byBlock = child.payload.trueColor == null && (child.payload.color === 0 || /^byblock$/i.test(String(child.payload.color)));
                        const effectiveLayer = childLayer?.name === '0' ? layerPayload : childLayer?.payload;
                        const childColor = overrideColor || byBlock ? color : this.#color(child, effectiveLayer);
                        const identity = {
                            payload: child.payload,
                            instanceKey: `${projection?.instanceKey ?? ''};${matrix.join(',')}`,
                            matrix,
                            ...child.type === 'DIMENSION' ? this.#dimensionInView(child, matrix) : {}
                        };
                        if (!this.#drawEntity(transformed, childColor, depth + 1, overrideColor, identity, {
                            layer: effectiveLayer,
                            lineweight: rawLineweight,
                            linetypeId
                        })) drawn = false;
                    } catch  {
                        drawn = false;
                    }
                }
                if (this.#document) try {
                    const attributes = insertAttributes(this.#document, entity);
                    if (!children.length && attributes.length) drawn = true;
                    for (const attribute of attributes){
                        if (!visibleAttribute(this.#document, attribute)) continue;
                        const ownLayer = this.#document.getObject(String(attribute.payload.layerId ?? ''));
                        const effectiveLayer = ownLayer?.name === '0' ? layerPayload : ownLayer?.payload;
                        const byBlock = attribute.payload.trueColor == null && (attribute.payload.color === 0 || /^byblock$/i.test(String(attribute.payload.color)));
                        const attributeColor = overrideColor || byBlock ? color : this.#color(attribute, effectiveLayer);
                        const identity = projection?.matrix ? {
                            payload: attribute.payload,
                            matrix: projection.matrix,
                            instanceKey: projection.instanceKey
                        } : undefined;
                        if (!this.#drawEntity(attribute, attributeColor, depth + 1, overrideColor, identity, {
                            layer: effectiveLayer,
                            lineweight: rawLineweight,
                            linetypeId
                        })) drawn = false;
                    }
                } catch  {
                    drawn = false;
                }
            }
        } else if (entity.type === 'SOLID3D') {
            const values = points(payload.vertices);
            if (values.length < 2) drawn = false;
            else {
                const minX = Math.min(...values.map((value)=>value[0])), maxX = Math.max(...values.map((value)=>value[0]));
                const minY = Math.min(...values.map((value)=>value[1])), maxY = Math.max(...values.map((value)=>value[1]));
                drawn = this.#strokePath([
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
                ], true);
            }
        } else drawn = false;
        context.restore();
        if (view && entity.type !== 'INSERT') {
            if (drawn) {
                view.diagnostic.rendered++;
                if (APPROXIMATE_TYPES.has(entity.type)) view.diagnostic.approximated++;
            } else view.diagnostic.unsupported++;
        }
        return drawn;
    }
    #dimensionInView(entity, matrix) {
        const original = projectDimension(entity.payload, this.#document?.getObject(String(entity.payload.styleId ?? ''))?.payload);
        if (!original) return {
            dimension: null
        };
        const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
        const sx = Math.hypot(matrix[0], matrix[1]), sy = Math.hypot(matrix[2], matrix[3]);
        if (!matrix.every(Number.isFinite) || sx === 0 || sy === 0 || Math.abs(determinant) <= 1e-12 * sx * sy) return {
            dimension: null
        };
        const similarity = determinant > 0 && Math.abs(sx - sy) <= 1e-10 * Math.max(sx, sy) && Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) <= 1e-10 * sx * sy;
        if (!similarity) return {
            dimension: original,
            dimensionMatrix: matrix
        };
        const point = (p)=>[
                matrix[0] * p[0] + matrix[2] * p[1] + matrix[4],
                matrix[1] * p[0] + matrix[3] * p[1] + matrix[5]
            ];
        const angle = Math.atan2(matrix[1], matrix[0]), scale = Math.hypot(matrix[0], matrix[1]);
        const reflected = matrix[0] * matrix[3] - matrix[1] * matrix[2] < 0;
        const arcs = original.arcs.map((arc)=>({
                ...arc,
                center: point(arc.center),
                radius: arc.radius * scale,
                startAngle: reflected ? angle - arc.endAngle : arc.startAngle + angle,
                endAngle: reflected ? angle - arc.startAngle : arc.endAngle + angle
            }));
        return {
            dimension: {
                ...original,
                arcs,
                lines: original.lines.map(([a, b])=>[
                        point(a),
                        point(b)
                    ]),
                arrows: original.arrows.map((arrow)=>arrow.map(point)),
                label: {
                    ...original.label,
                    position: point(original.label.position),
                    height: original.label.height * Math.hypot(matrix[0], matrix[1]),
                    rotation: original.label.rotation + Math.atan2(matrix[1], matrix[0])
                }
            }
        };
    }
    #drawViewport(entity, depth) {
        if (this.#viewportState) return false;
        const diagnostic = {
            entityId: entity.id,
            rendered: 0,
            hidden: 0,
            approximated: 0,
            unsupported: 0
        };
        this.#viewportDiagnostics.push(diagnostic);
        const document = this.#document, p = entity.payload, center = point2(p.center), viewCenter = point2(p.viewCenter);
        const width = finite(p.width), height = finite(p.height), viewHeight = finite(p.viewHeight), twist = finite(p.twistAngle);
        if (!document || entity.ownerId === document.spaces.modelSpaceId || entity.ownerId !== this.#activeSpaceId()) {
            diagnostic.reason = 'not-paper-space';
            return false;
        }
        if (!center || !viewCenter || width <= 0 || height <= 0 || viewHeight <= 0 || !Number.isFinite(height / viewHeight)) {
            diagnostic.reason = 'invalid-view';
            return false;
        }
        const target = p.viewTarget == null ? [
            0,
            0
        ] : point2(p.viewTarget);
        const direction = p.viewDirection;
        const topView = direction == null || Array.isArray(direction) && direction[0] === 0 && direction[1] === 0 && direction[2] === 1;
        const flags = finite(p.flags);
        if (p.status === 0 || (flags & 0x20000) !== 0 || p.viewportId === 1) {
            diagnostic.hidden++;
            return true;
        }
        if (p.perspective === true || p.clipBoundaryId || p.clippingBoundaryId || !target || !topView || p.nonRectangularClip === true || (flags & (0x1 | 0x2 | 0x4 | 0x10 | 0x10000)) !== 0 || Array.isArray(p.unresolvedViewportReferences) && p.unresolvedViewportReferences.length > 0) {
            diagnostic.reason = 'unsupported-view';
            return false;
        }
        const scale = height / viewHeight;
        const matrix = multiply3(translation3(center[0] - scale * viewCenter[0], center[1] - scale * viewCenter[1]), multiply3(scale3(scale), multiply3(rotation3(twist), translation3(-target[0], -target[1]))));
        if (!matrix.every(Number.isFinite)) {
            diagnostic.reason = 'invalid-view';
            return false;
        }
        const context = this.context, corners = [
            [
                center[0] - width / 2,
                center[1] - height / 2
            ],
            [
                center[0] + width / 2,
                center[1] - height / 2
            ],
            [
                center[0] + width / 2,
                center[1] + height / 2
            ],
            [
                center[0] - width / 2,
                center[1] + height / 2
            ]
        ];
        context.save();
        const previous = this.#viewportState;
        this.#viewportState = {
            frozen: new Set(Array.isArray(p.frozenLayerIds) ? p.frozenLayerIds.map(String) : []),
            scale,
            diagnostic
        };
        let complete = true;
        try {
            context.beginPath();
            corners.forEach((point, i)=>{
                const screen = this.worldToScreen(point);
                i ? context.lineTo(...screen) : context.moveTo(...screen);
            });
            context.closePath();
            context.clip();
            const query = {
                document,
                spaceId: document.spaces.modelSpaceId
            };
            for (const model of this.#sceneProvider?.listEntities(query) ?? document.listEntities({
                ownerId: query.spaceId
            })){
                if (this.#viewportWorkRemaining <= 0) {
                    diagnostic.reason = 'budget';
                    complete = false;
                    break;
                }
                this.#viewportWorkRemaining--;
                if (model.ownerId !== query.spaceId || isAttachedAttribute(model)) continue;
                const layer = document.getObject(String(model.payload.layerId ?? ''))?.payload;
                if (model.payload.visible === false || layer?.visible === false || layer?.frozen === true || this.#viewportState.frozen.has(String(model.payload.layerId ?? ''))) {
                    diagnostic.hidden++;
                    continue;
                }
                try {
                    const transformed = {
                        ...model,
                        payload: transformEntityPayload(model.type, structuredClone(model.payload), matrix)
                    };
                    const identity = {
                        payload: model.payload,
                        instanceKey: `viewport:${entity.id};${matrix.join(',')}`,
                        matrix,
                        ...model.type === 'DIMENSION' ? this.#dimensionInView(model, matrix) : {}
                    };
                    const before = diagnostic.unsupported;
                    if (!this.#drawEntity(transformed, this.#color(model, layer), depth + 1, false, identity)) {
                        complete = false;
                        if (diagnostic.unsupported === before) diagnostic.unsupported++;
                    }
                } catch  {
                    diagnostic.unsupported++;
                    complete = false;
                }
            }
        } finally{
            this.#viewportState = previous;
            context.restore();
        }
        return complete;
    }
}
