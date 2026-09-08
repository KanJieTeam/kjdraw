// Generated from canvas-renderer.ts by scripts/build-typescript.mjs. Do not edit directly.
import { multiply3, rotation3, scale3, transformEntityPayload, translation3 } from './geometry/index.js';
import { nearestPointOnEntity2 } from './snapping.js';
import { normalizeSplineDefinition, splinePoint2 } from './geometry/curves.js';
import { projectDimension } from './geometry/annotation.js';
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
        output.push(...points(loop.vertices));
    }
    return output;
}
export class KJCanvasRenderer {
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
    #width = 1;
    #height = 1;
    #fittedCamera = null;
    #disposeDocument = null;
    #observer = null;
    #report = Object.freeze({
        total: 0,
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
        if (document) this.#disposeDocument = document.on('document:change', ()=>this.render());
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
        this.#selection.clear();
        this.render();
        return this;
    }
    setSceneProvider(provider) {
        this.#sceneProvider = provider;
        this.render();
        return this;
    }
    resize(width, height) {
        const keepFitted = this.#fittedCamera !== null && this.camera.centerX === this.#fittedCamera.centerX && this.camera.centerY === this.#fittedCamera.centerY && this.camera.scale === this.#fittedCamera.scale;
        const rect = this.canvas.getBoundingClientRect();
        this.#width = Math.max(1, finite(width, rect.width || this.canvas.clientWidth || 1));
        this.#height = Math.max(1, finite(height, rect.height || this.canvas.clientHeight || 1));
        const ratio = this.#pixelRatio ?? Math.max(1, globalThis.devicePixelRatio || 1);
        const targetWidth = Math.max(1, Math.round(this.#width * ratio));
        const targetHeight = Math.max(1, Math.round(this.#height * ratio));
        if (this.canvas.width !== targetWidth) this.canvas.width = targetWidth;
        if (this.canvas.height !== targetHeight) this.canvas.height = targetHeight;
        if (keepFitted && this.#document) return this.fit();
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
        const values = this.#entities().filter((entity)=>{
            const layer = layers.get(String(entity.payload.layerId ?? ''));
            return layer?.visible !== false && layer?.frozen !== true;
        }).flatMap((entity)=>this.#fitPoints(entity));
        if (!values.length) {
            this.camera.centerX = 50;
            this.camera.centerY = 40;
            this.camera.scale = 4;
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
    hitTest(screenPoint, tolerancePixels = 8) {
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
        const candidates = this.#sceneProvider?.hitCandidates?.(query) ?? this.#entities();
        for (const entity of candidates){
            const layer = layers.get(String(entity.payload.layerId ?? ''));
            if (layer?.visible === false || layer?.frozen === true) continue;
            try {
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
    render() {
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
        const entities = this.#entities();
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
            if (layer?.visible === false || layer?.frozen === true) {
                hidden += 1;
                continue;
            }
            const color = this.#selection.has(entity.id) ? this.#selectionColor ?? (this.#theme === 'dark' ? '#b9ff72' : '#0b67e3') : this.#color(entity, layer) ?? palette[colorIndex(layer?.color)];
            if (this.#drawEntity(entity, color, 0)) {
                rendered += 1;
                if (APPROXIMATE_TYPES.has(entity.type)) {
                    approximated += 1;
                    approximateTypes.add(entity.type);
                }
            } else unsupported.add(entity.type);
        }
        this.#report = Object.freeze({
            total: entities.length,
            rendered,
            approximated,
            hidden,
            unsupported: entities.length - rendered - hidden,
            approximateTypes: Object.freeze([
                ...approximateTypes
            ].sort()),
            unsupportedTypes: Object.freeze([
                ...unsupported
            ].sort()),
            width: this.#width,
            height: this.#height,
            scale: this.camera.scale
        });
        return this.#report;
    }
    drawPreview(entities, color = '#77a7ff', offset = [
        0,
        0
    ]) {
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
            }, color, 0);
        }
        return this;
    }
    dispose() {
        this.#disposeDocument?.();
        this.#disposeDocument = null;
        this.#observer?.disconnect();
        this.#observer = null;
        this.#document = null;
        this.#selection.clear();
    }
    #activeSpaceId() {
        const document = this.#document;
        if (!document) return '';
        return this.#spaceId ?? document.snapshot().spaces.modelSpaceId;
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
    #fitPoints(entity, depth = 0) {
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
            if (layer?.visible === false || layer?.frozen === true) continue;
            try {
                output.push(...this.#fitPoints({
                    ...child,
                    payload: transformEntityPayload(child.type, structuredClone(child.payload), matrix)
                }, depth + 1));
            } catch  {
                output.push(position);
            }
        }
        return output.length ? output : [
            position
        ];
    }
    #entities() {
        const document = this.#document;
        if (!document) return [];
        const query = {
            document,
            spaceId: this.#activeSpaceId()
        };
        return this.#sceneProvider?.listEntities(query) ?? document.listEntities({
            ownerId: query.spaceId
        });
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
    #drawEntity(entity, color, depth) {
        if (depth > 12) return false;
        const context = this.context, payload = entity.payload;
        const layer = this.#document?.getObject(String(payload.layerId ?? ''));
        context.save();
        context.strokeStyle = color;
        context.fillStyle = color;
        const rawLineweight = finite(payload.lineweight ?? layer?.payload.lineweight, 0);
        const millimeters = rawLineweight > 5 ? rawLineweight / 100 : rawLineweight;
        context.lineWidth = this.#selection.has(entity.id) ? 2 : this.#showLineweights && millimeters > 0 ? Math.max(0.5, Math.min(8, millimeters * 96 / 25.4)) : 1;
        const transparency = finite(payload.transparency ?? layer?.payload.transparency, 0);
        context.globalAlpha = transparency > 1 ? Math.max(0.05, 1 - transparency / 255) : transparency > 0 ? Math.max(0.05, 1 - transparency) : 1;
        const linetype = this.#document?.getObject(String(payload.linetypeId ?? layer?.payload.linetypeId ?? ''));
        const pattern = Array.isArray(linetype?.payload.patternSegments) ? linetype.payload.patternSegments : Array.isArray(linetype?.payload.pattern) ? linetype.payload.pattern : [];
        const dash = pattern.map((value)=>Math.max(1, Math.abs(finite(value)) * this.camera.scale)).filter((value)=>value > 0);
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
                const length = Math.hypot(direction[0], direction[1]) || 1;
                const span = Math.max(this.#width, this.#height) * 2 / this.camera.scale;
                const delta = [
                    direction[0] / length * span,
                    direction[1] / length * span
                ];
                const start = entity.type === 'XLINE' ? [
                    origin[0] - delta[0],
                    origin[1] - delta[1]
                ] : origin;
                drawn = this.#strokePath([
                    start,
                    [
                        origin[0] + delta[0],
                        origin[1] + delta[1]
                    ]
                ]);
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
            const position = point2(payload.position);
            if (!position) drawn = false;
            else {
                const screen = this.worldToScreen(position);
                context.translate(screen[0], screen[1]);
                context.rotate(-finite(payload.rotation));
                const screenHeight = Math.max(0.01, Math.abs(finite(payload.height, 2.5) * this.camera.scale));
                context.font = `${screenHeight}px ui-monospace, SFMono-Regular, Consolas, monospace`;
                context.textBaseline = 'alphabetic';
                context.fillText(String(payload.text ?? payload.defaultValue ?? ''), 0, 0);
            }
        } else if (entity.type === 'HATCH') {
            const loops = Array.isArray(payload.boundaryLoops) ? payload.boundaryLoops : [];
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
            drawn = paths.length > 0;
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
                else if (![
                    'ANSI31',
                    'ANSI37',
                    'CROSS'
                ].includes(patternName)) {
                    context.stroke();
                    drawn = false;
                } else {
                    context.clip('evenodd');
                    const baseAngle = finite(payload.patternAngle) + Math.PI / 4;
                    const angles = patternName === 'ANSI37' || patternName === 'CROSS' ? [
                        baseAngle,
                        baseAngle + Math.PI / 2
                    ] : [
                        baseAngle
                    ];
                    const all = paths.flat(), spacing = Math.max(.000001, 3.175 * finite(payload.patternScale, 1));
                    for (const angle of angles){
                        const u = [
                            Math.cos(angle),
                            Math.sin(angle)
                        ], n = [
                            -u[1],
                            u[0]
                        ];
                        let minU = Infinity, maxU = -Infinity, minN = Infinity, maxN = -Infinity;
                        for (const p of all){
                            const a = p[0] * u[0] + p[1] * u[1], b = p[0] * n[0] + p[1] * n[1];
                            minU = Math.min(minU, a);
                            maxU = Math.max(maxU, a);
                            minN = Math.min(minN, b);
                            maxN = Math.max(maxN, b);
                        }
                        const increment = spacing * Math.max(1, Math.ceil((maxN - minN) / spacing / 2000));
                        for(let b = Math.floor(minN / increment) * increment; b <= maxN; b += increment)this.#strokePath([
                            [
                                u[0] * minU + n[0] * b,
                                u[1] * minU + n[1] * b
                            ],
                            [
                                u[0] * maxU + n[0] * b,
                                u[1] * maxU + n[1] * b
                            ]
                        ]);
                    }
                }
            }
        } else if (entity.type === 'DIMENSION') {
            const projected = projectDimension(payload, this.#document?.getObject(String(payload.styleId ?? ''))?.payload);
            drawn = projected !== null;
            if (projected) {
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
            const position = point2(payload.textPosition);
            if (position) {
                const screen = this.worldToScreen(position);
                const text = payload.textOverride ?? (payload.measurement == null ? '' : finite(payload.measurement).toFixed(2));
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
            const blockRecordId = String(payload.blockRecordId ?? '');
            const block = this.#document?.getObject(blockRecordId);
            const position = point2(payload.position), base = point2(block?.payload.basePoint) ?? [
                0,
                0
            ];
            if (!block || !position) drawn = false;
            else {
                const inputScale = Array.isArray(payload.scale) ? payload.scale : [
                    payload.scale ?? 1,
                    payload.scale ?? 1
                ];
                const factorX = finite(inputScale[0], 1), factorY = finite(inputScale[1], factorX);
                const matrix = multiply3(translation3(position[0], position[1]), multiply3(rotation3(finite(payload.rotation)), multiply3(scale3(factorX, factorY), translation3(-base[0], -base[1]))));
                const children = this.#document?.listEntities({
                    ownerId: blockRecordId
                }) ?? [];
                drawn = children.length > 0;
                for (const child of children){
                    try {
                        const transformed = {
                            ...child,
                            payload: transformEntityPayload(child.type, structuredClone(child.payload), matrix)
                        };
                        this.#drawEntity(transformed, color, depth + 1);
                    } catch  {
                        drawn = false;
                    }
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
        return drawn;
    }
}
