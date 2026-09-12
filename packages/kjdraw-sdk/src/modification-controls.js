// Generated from modification-controls.ts by scripts/build-typescript.mjs. Do not edit directly.
import { chamferLinePair, filletLinePair, offsetEntityPayload } from './editing.js';
import { reflectionAcrossLine3, rotationAround3, transformEntityPayload, transformPoint3, translation3 } from './geometry/index.js';
const commandModificationIds = Object.freeze({
    MIRROR: 'mirror',
    MI: 'mirror',
    ARRAYRECT: 'array-rect',
    ARRAYRECTANGULAR: 'array-rect',
    ARRAYPOLAR: 'array-polar',
    POLARARRAY: 'array-polar',
    OFFSET: 'offset',
    O: 'offset',
    CHAMFER: 'chamfer',
    CHA: 'chamfer',
    FILLET: 'fillet',
    F: 'fillet'
});
const text = (en, zh)=>Object.freeze({
        en,
        zh
    });
const number = (key, en, zh, defaultValue, options = {})=>Object.freeze({
        key,
        label: text(en, zh),
        type: options.type ?? 'number',
        default: defaultValue,
        ...options.min === undefined ? {} : {
            min: options.min
        },
        ...options.max === undefined ? {} : {
            max: options.max
        },
        ...options.step === undefined ? {} : {
            step: options.step
        }
    });
const boolean = (key, en, zh, defaultValue)=>Object.freeze({
        key,
        label: text(en, zh),
        type: 'boolean',
        default: defaultValue
    });
const pick = (key, en, zh)=>Object.freeze({
        key,
        label: text(en, zh)
    });
export const KJ_MODIFICATION_IDS = Object.freeze([
    'rotate',
    'scale',
    'mirror',
    'array-rect',
    'array-polar',
    'offset',
    'break',
    'join',
    'explode',
    'trim',
    'extend',
    'lengthen',
    'stretch',
    'polyline-insert',
    'polyline-delete',
    'polyline-arc',
    'chamfer',
    'fillet'
]);
export const KJ_MODIFICATION_DEFINITIONS = Object.freeze([
    {
        id: 'rotate',
        command: 'ROTATE',
        label: text('Rotate', '旋转'),
        description: text('Rotate the selection around a point.', '绕指定基点旋转选中对象。'),
        minSelection: 1,
        fields: [
            number('angleDegrees', 'Angle (°)', '角度（°）', 90, {
                step: 1
            })
        ],
        pointKeys: [
            pick('center', 'Pick the rotation center', '在画布上指定旋转中心')
        ]
    },
    {
        id: 'scale',
        command: 'SCALE',
        label: text('Scale', '缩放'),
        description: text('Scale the selection uniformly around a point.', '绕指定基点等比缩放选中对象。'),
        minSelection: 1,
        fields: [
            number('factor', 'Scale factor', '缩放比例', 2, {
                step: 0.1
            })
        ],
        pointKeys: [
            pick('center', 'Pick the scale center', '在画布上指定缩放基点')
        ]
    },
    {
        id: 'mirror',
        command: 'MIRROR',
        label: text('Mirror', '镜像'),
        description: text('Mirror the selection across a two-point axis.', '以画布上两点定义的轴镜像选中对象。'),
        minSelection: 1,
        fields: [
            boolean('eraseSource', 'Erase source', '删除源对象', false)
        ],
        pointKeys: [
            pick('lineStart', 'Pick the first axis point', '指定镜像轴第一点'),
            pick('lineEnd', 'Pick the second axis point', '指定镜像轴第二点')
        ]
    },
    {
        id: 'array-rect',
        command: 'ARRAYRECT',
        label: text('Rectangular array', '矩形阵列'),
        description: text('Create rows and columns of the selection.', '按行列间距创建选中对象的矩形阵列。'),
        minSelection: 1,
        fields: [
            number('rows', 'Rows', '行数', 2, {
                type: 'integer',
                min: 1,
                max: 100000,
                step: 1
            }),
            number('columns', 'Columns', '列数', 3, {
                type: 'integer',
                min: 1,
                max: 100000,
                step: 1
            }),
            number('rowSpacing', 'Row spacing', '行间距', 10, {
                step: 1
            }),
            number('columnSpacing', 'Column spacing', '列间距', 10, {
                step: 1
            })
        ],
        pointKeys: []
    },
    {
        id: 'array-polar',
        command: 'ARRAYPOLAR',
        label: text('Polar array', '环形阵列'),
        description: text('Distribute the selection around a center point.', '围绕画布上指定中心阵列选中对象。'),
        minSelection: 1,
        fields: [
            number('count', 'Item count', '项目数', 6, {
                type: 'integer',
                min: 2,
                max: 100000,
                step: 1
            }),
            number('angleDegrees', 'Fill angle (°)', '填充角度（°）', 360, {
                step: 1
            }),
            boolean('rotateItems', 'Rotate items', '旋转阵列项', true)
        ],
        pointKeys: [
            pick('center', 'Pick the array center', '在画布上指定阵列中心')
        ]
    },
    {
        id: 'offset',
        command: 'OFFSET',
        label: text('Offset', '偏移'),
        description: text('Create one exact parallel or concentric entity.', '在指定侧创建一个精确平行或同心对象。'),
        minSelection: 1,
        maxSelection: 1,
        supportedEntityTypes: [
            'LINE',
            'RAY',
            'XLINE',
            'CIRCLE',
            'ARC'
        ],
        fields: [
            number('distance', 'Distance', '偏移距离', 2, {
                min: Number.EPSILON,
                step: 0.1
            })
        ],
        pointKeys: [
            pick('sidePoint', 'Pick the offset side', '在画布上指定偏移侧')
        ]
    },
    {
        id: 'break',
        command: 'BREAK',
        label: text('Break', '打断'),
        description: text('Split one line or arc at a point.', '在指定点打断一条直线或圆弧。'),
        minSelection: 1,
        maxSelection: 1,
        supportedEntityTypes: [
            'LINE',
            'ARC'
        ],
        fields: [],
        pointKeys: [
            pick('point', 'Pick the break point', '在画布上指定打断点')
        ]
    },
    {
        id: 'join',
        command: 'JOIN',
        label: text('Join', '合并'),
        description: text('Join connected lines, arcs and open polylines into one editable path.', '将相连的直线、圆弧和开放多段线合并为一条可编辑路径。'),
        minSelection: 2,
        maxSelection: 4096,
        supportedEntityTypes: [
            'LINE',
            'ARC',
            'LWPOLYLINE',
            'POLYLINE'
        ],
        fields: [
            number('tolerance', 'Endpoint tolerance', '端点容差', 1e-9, {
                min: 0,
                step: 0.001
            })
        ],
        pointKeys: []
    },
    {
        id: 'explode',
        command: 'EXPLODE',
        label: text('Explode', '分解'),
        description: text('Explode one polyline-compatible entity into primitives.', '将一个多段线类对象分解为基础图元。'),
        minSelection: 1,
        maxSelection: 1,
        supportedEntityTypes: [
            'LWPOLYLINE',
            'POLYLINE',
            'REVISION_CLOUD',
            'WIPEOUT'
        ],
        fields: [],
        pointKeys: []
    },
    {
        id: 'trim',
        command: 'TRIM',
        label: text('Trim', '修剪'),
        description: text('Select the line, arc or circle first, then Shift-select the cutting boundaries.', '先选择待修剪的直线、圆弧或圆，再按住 Shift 选择切割边界。'),
        minSelection: 2,
        targetEntityTypes: [
            'LINE',
            'ARC',
            'CIRCLE'
        ],
        boundaryEntityTypes: [
            'LINE',
            'RAY',
            'XLINE',
            'CIRCLE',
            'ARC'
        ],
        fields: [],
        pointKeys: [
            pick('pickPoint', 'Pick the portion of the target to remove', '在目标图形上指定要删除的区段')
        ]
    },
    {
        id: 'extend',
        command: 'EXTEND',
        label: text('Extend', '延伸'),
        description: text('Select the line or arc first, then Shift-select the limiting boundaries.', '先选择待延伸的直线或圆弧，再按住 Shift 选择延伸边界。'),
        minSelection: 2,
        targetEntityTypes: [
            'LINE',
            'ARC'
        ],
        boundaryEntityTypes: [
            'LINE',
            'RAY',
            'XLINE',
            'CIRCLE',
            'ARC'
        ],
        fields: [],
        pointKeys: [
            pick('pickPoint', 'Pick near the end of the target to extend', '在目标图形上靠近要延伸的一端点选')
        ]
    },
    {
        id: 'lengthen',
        command: 'LENGTHEN',
        label: text('Lengthen', '定长'),
        description: text('Set the exact length from the endpoint selected on canvas.', '从画布中指定的端点设置精确长度。'),
        minSelection: 1,
        maxSelection: 1,
        supportedEntityTypes: [
            'LINE',
            'ARC'
        ],
        fields: [
            number('value', 'Target length', '目标长度', 10, {
                min: Number.EPSILON,
                step: 0.1
            })
        ],
        pointKeys: [
            pick('pickPoint', 'Pick the endpoint to change', '选择要修改的端点')
        ]
    },
    {
        id: 'stretch',
        command: 'STRETCH',
        label: text('Stretch', '拉伸'),
        description: text('Move selected vertices inside a crossing window.', '移动交叉窗口内的选中顶点。'),
        minSelection: 1,
        maxSelection: 4096,
        supportedEntityTypes: [
            'LINE',
            'LWPOLYLINE',
            'POLYLINE'
        ],
        fields: [
            number('dx', 'Horizontal displacement', '水平位移', 10, {
                step: 0.1
            }),
            number('dy', 'Vertical displacement', '垂直位移', 0, {
                step: 0.1
            })
        ],
        pointKeys: [
            pick('crossingStart', 'Pick the first crossing-window corner', '指定交叉窗口第一个角点'),
            pick('crossingEnd', 'Pick the opposite crossing-window corner', '指定交叉窗口对角点')
        ]
    },
    {
        id: 'polyline-insert',
        command: 'PEDIT',
        label: text('Insert polyline vertex', '插入多段线顶点'),
        description: text('Insert a vertex on an exact polyline segment.', '在多段线的指定线段上精确插入顶点。'),
        minSelection: 1,
        maxSelection: 1,
        supportedEntityTypes: [
            'LWPOLYLINE',
            'POLYLINE'
        ],
        fields: [
            number('segmentIndex', 'Segment index', '线段索引', 0, {
                type: 'integer',
                min: 0,
                step: 1
            }),
            number('tolerance', 'Snap tolerance', '捕捉容差', 0.1, {
                min: 0,
                step: 0.01
            })
        ],
        pointKeys: [
            pick('point', 'Pick a point on the segment', '在线段上指定插入点')
        ]
    },
    {
        id: 'polyline-delete',
        command: 'PEDIT',
        label: text('Delete polyline vertex', '删除多段线顶点'),
        description: text('Delete one vertex while preserving valid polyline topology.', '删除一个顶点并保持多段线拓扑有效。'),
        minSelection: 1,
        maxSelection: 1,
        supportedEntityTypes: [
            'LWPOLYLINE',
            'POLYLINE'
        ],
        fields: [
            number('vertexIndex', 'Vertex index', '顶点索引', 0, {
                type: 'integer',
                min: 0,
                step: 1
            })
        ],
        pointKeys: []
    },
    {
        id: 'polyline-arc',
        command: 'PEDIT',
        label: text('Edit polyline arc', '编辑多段线圆弧段'),
        description: text('Set the signed sweep angle of one polyline segment.', '设置多段线指定线段的有向圆弧扫角。'),
        minSelection: 1,
        maxSelection: 1,
        supportedEntityTypes: [
            'LWPOLYLINE',
            'POLYLINE'
        ],
        fields: [
            number('segmentIndex', 'Segment index', '线段索引', 0, {
                type: 'integer',
                min: 0,
                step: 1
            }),
            number('sweepDegrees', 'Sweep angle (°)', '扫角（°）', 90, {
                min: -359.999999,
                max: 359.999999,
                step: 1
            })
        ],
        pointKeys: []
    },
    {
        id: 'chamfer',
        command: 'CHAMFER',
        label: text('Chamfer lines', '直线倒角'),
        description: text('Trim two selected LINE entities and add a chamfer.', '修剪两条选中直线并创建倒角。'),
        minSelection: 2,
        maxSelection: 2,
        supportedEntityTypes: [
            'LINE'
        ],
        fields: [
            number('distance1', 'First distance', '第一距离', 2, {
                min: 0,
                step: 0.1
            }),
            number('distance2', 'Second distance', '第二距离', 2, {
                min: 0,
                step: 0.1
            })
        ],
        pointKeys: [
            pick('pickPoint1', 'Pick the side of the first line to keep', '在第一条直线上指定保留侧'),
            pick('pickPoint2', 'Pick the side of the second line to keep', '在第二条直线上指定保留侧')
        ]
    },
    {
        id: 'fillet',
        command: 'FILLET',
        label: text('Fillet lines', '直线圆角'),
        description: text('Trim two selected LINE entities and add a tangent arc.', '修剪两条选中直线并创建相切圆弧。'),
        minSelection: 2,
        maxSelection: 2,
        supportedEntityTypes: [
            'LINE'
        ],
        fields: [
            number('radius', 'Radius', '半径', 2, {
                min: Number.EPSILON,
                step: 0.1
            })
        ],
        pointKeys: [
            pick('pickPoint1', 'Pick the side of the first line to keep', '在第一条直线上指定保留侧'),
            pick('pickPoint2', 'Pick the side of the second line to keep', '在第二条直线上指定保留侧')
        ]
    }
]);
const definitionById = new Map(KJ_MODIFICATION_DEFINITIONS.map((definition)=>[
        definition.id,
        definition
    ]));
export function getKJModificationSelectionCenter(entities) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (value)=>{
        if (value && typeof value === 'object' && !Array.isArray(value) && 'point' in value) value = value.point;
        if (!Array.isArray(value)) return;
        const x = Number(value[0]), y = Number(value[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    };
    for (const { payload } of entities){
        for (const key of [
            'start',
            'end',
            'center',
            'position',
            'insertionPoint',
            'origin'
        ])add(payload[key]);
        for (const key of [
            'vertices',
            'controlPoints',
            'fitPoints',
            'definitionPoints'
        ])if (Array.isArray(payload[key])) for (const point of payload[key])add(point);
        for (const raw of Array.isArray(payload.boundaryLoops) ? payload.boundaryLoops : []){
            const loop = raw;
            for (const point of Array.isArray(loop.vertices) ? loop.vertices : [])add(point);
            for (const rawEdge of Array.isArray(loop.edges) ? loop.edges : []){
                const edge = rawEdge;
                add(edge.start);
                add(edge.end);
                add(edge.center);
            }
        }
    }
    return Number.isFinite(minX) ? [
        (minX + maxX) / 2,
        (minY + maxY) / 2
    ] : [
        0,
        0
    ];
}
export function getKJModificationDefinition(id) {
    const definition = definitionById.get(id);
    if (!definition) throw new RangeError(`Unsupported KJDraw modification: ${String(id)}`);
    return definition;
}
export function getKJInteractiveModificationDefinition(command) {
    const id = commandModificationIds[String(command).trim().toUpperCase()];
    return id ? getKJModificationDefinition(id) : null;
}
export function parseKJModificationCommandValues(id, tokens, locale = 'en') {
    const definition = getKJModificationDefinition(id);
    const fail = (en, zh)=>{
        throw new RangeError(locale === 'zh' ? zh : en);
    };
    if (tokens.length > definition.fields.length) {
        fail(`${definition.command} accepts at most ${definition.fields.length} parameter values`, `${definition.label.zh}最多接受 ${definition.fields.length} 个参数值`);
    }
    const source = {};
    for (const [index, token] of tokens.entries()){
        const field = definition.fields[index];
        if (field.type === 'boolean') {
            const normalized = token.trim().toUpperCase();
            const truthy = [
                '1',
                'TRUE',
                'YES',
                'ON',
                'ERASE',
                'ROTATE'
            ];
            const falsy = [
                '0',
                'FALSE',
                'NO',
                'OFF',
                'KEEP',
                'STATIC'
            ];
            if (!truthy.includes(normalized) && !falsy.includes(normalized)) {
                fail(`${field.label.en} must be true or false`, `${field.label.zh}必须为 true 或 false`);
            }
            source[field.key] = truthy.includes(normalized);
        } else {
            const value = Number(token);
            if (!Number.isFinite(value)) fail(`${field.label.en} must be a finite number`, `${field.label.zh}必须是有限数值`);
            if (field.type === 'integer' && !Number.isInteger(value)) fail(`${field.label.en} must be an integer`, `${field.label.zh}必须是整数`);
            if (field.min !== undefined && value < field.min) fail(`${field.label.en} must be at least ${field.min}`, `${field.label.zh}必须至少为 ${field.min}`);
            if (field.max !== undefined && value > field.max) fail(`${field.label.en} must be at most ${field.max}`, `${field.label.zh}不能超过 ${field.max}`);
            source[field.key] = value;
        }
    }
    return Object.freeze(normalizedValues(definition, source));
}
export function validateKJModificationSelection(definition, entities, locale = 'en') {
    const fail = (en, zh)=>{
        throw new RangeError(locale === 'zh' ? zh : en);
    };
    if (entities.some((entity)=>!entity || entity.kind !== undefined && entity.kind !== 'entity')) fail('Selection contains an unavailable entity', '选择中包含不可用的图元');
    if (new Set(entities.map((entity)=>entity.id)).size !== entities.length) fail('Select each entity only once', '请勿重复选择同一图元');
    if (entities.length < definition.minSelection) fail(`${definition.command} requires at least ${definition.minSelection} selected objects`, `${definition.label.zh}至少需要选择 ${definition.minSelection} 个对象`);
    if (definition.maxSelection !== undefined && entities.length > definition.maxSelection) fail(`${definition.command} accepts at most ${definition.maxSelection} selected objects`, `${definition.label.zh}最多允许选择 ${definition.maxSelection} 个对象`);
    if (definition.supportedEntityTypes && entities.some((entity)=>!definition.supportedEntityTypes.includes(entity.type))) fail(`${definition.command} supports ${definition.supportedEntityTypes.join(', ')}`, `${definition.label.zh}支持的图元：${definition.supportedEntityTypes.join('、')}`);
    if (definition.targetEntityTypes && !definition.targetEntityTypes.includes(entities[0].type)) fail(`Select a ${definition.targetEntityTypes.join(', ')} target first, then Shift-select boundaries`, `请先选择目标图元（${definition.targetEntityTypes.join('、')}），再按住 Shift 选择边界`);
    if (definition.boundaryEntityTypes && entities.slice(1).some((entity)=>!definition.boundaryEntityTypes.includes(entity.type))) fail(`Boundaries must be ${definition.boundaryEntityTypes.join(', ')}`, `边界必须是 ${definition.boundaryEntityTypes.join('、')}`);
}
function normalizedIds(definition, ids) {
    const result = [
        ...new Set(ids.map(String).filter(Boolean))
    ];
    if (result.length < definition.minSelection) throw new RangeError(`${definition.command} requires at least ${definition.minSelection} selected object${definition.minSelection === 1 ? '' : 's'}`);
    if (definition.maxSelection !== undefined && result.length > definition.maxSelection) throw new RangeError(`${definition.command} accepts at most ${definition.maxSelection} selected object${definition.maxSelection === 1 ? '' : 's'}`);
    return result;
}
function normalizedValues(definition, source) {
    const result = {};
    for (const field of definition.fields){
        const raw = source[field.key] ?? field.default;
        if (field.type === 'boolean') {
            result[field.key] = typeof raw === 'string' ? ![
                '',
                '0',
                'false',
                'no',
                'off'
            ].includes(raw.trim().toLowerCase()) : Boolean(raw);
            continue;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new TypeError(`${field.label.en} must be a finite number`);
        if (field.type === 'integer' && !Number.isInteger(value)) throw new RangeError(`${field.label.en} must be an integer`);
        if (field.min !== undefined && value < field.min) throw new RangeError(`${field.label.en} must be at least ${field.min}`);
        if (field.max !== undefined && value > field.max) throw new RangeError(`${field.label.en} must be at most ${field.max}`);
        result[field.key] = value;
    }
    return result;
}
function normalizedPoints(definition, points) {
    if (points.length !== definition.pointKeys.length) throw new RangeError(`${definition.command} requires ${definition.pointKeys.length} canvas point${definition.pointKeys.length === 1 ? '' : 's'}`);
    return points.map((point, index)=>{
        const x = Number(point?.[0]), y = Number(point?.[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError(`${definition.pointKeys[index]?.label.en ?? 'Point'} must contain finite coordinates`);
        return [
            x,
            y
        ];
    });
}
export function buildKJModificationCommand(id, context) {
    const definition = getKJModificationDefinition(id);
    const ids = normalizedIds(definition, context.ids);
    const values = normalizedValues(definition, context.values ?? {});
    const points = normalizedPoints(definition, context.points ?? []);
    const all = {
        ids,
        ...values
    };
    switch(id){
        case 'rotate':
            return {
                command: definition.command,
                arguments: {
                    ...all,
                    center: points[0]
                }
            };
        case 'scale':
            return {
                command: definition.command,
                arguments: {
                    ...all,
                    center: points[0]
                }
            };
        case 'mirror':
            return {
                command: definition.command,
                arguments: {
                    ...all,
                    lineStart: points[0],
                    lineEnd: points[1]
                }
            };
        case 'array-rect':
            return {
                command: definition.command,
                arguments: all
            };
        case 'array-polar':
            return {
                command: definition.command,
                arguments: {
                    ...all,
                    center: points[0],
                    ...values.rotateItems === false ? {
                        basePoint: context.selectionCenter ?? points[0]
                    } : {}
                }
            };
        case 'offset':
            return {
                command: definition.command,
                arguments: {
                    id: ids[0],
                    ...values,
                    sidePoint: points[0]
                }
            };
        case 'break':
            return {
                command: definition.command,
                arguments: {
                    id: ids[0],
                    point: points[0]
                }
            };
        case 'join':
            return {
                command: definition.command,
                arguments: {
                    id: ids[0],
                    ids,
                    ...values
                }
            };
        case 'explode':
            return {
                command: definition.command,
                arguments: {
                    id: ids[0]
                }
            };
        case 'trim':
            return {
                command: definition.command,
                arguments: {
                    id: ids[0],
                    boundaryIds: ids.slice(1),
                    pickPoint: points[0]
                }
            };
        case 'extend':
            return {
                command: definition.command,
                arguments: {
                    id: ids[0],
                    boundaryIds: ids.slice(1),
                    pickPoint: points[0]
                }
            };
        case 'lengthen':
            return {
                command: definition.command,
                arguments: {
                    id: ids[0],
                    mode: 'TOTAL',
                    ...values,
                    pickPoint: points[0]
                }
            };
        case 'stretch':
            return {
                command: definition.command,
                arguments: {
                    ids,
                    ...values,
                    crossingStart: points[0],
                    crossingEnd: points[1]
                }
            };
        case 'polyline-insert':
            return {
                command: definition.command,
                arguments: {
                    id: ids[0],
                    operation: 'INSERT',
                    ...values,
                    point: points[0]
                }
            };
        case 'polyline-delete':
            return {
                command: definition.command,
                arguments: {
                    id: ids[0],
                    operation: 'DELETE',
                    ...values
                }
            };
        case 'polyline-arc':
            return {
                command: definition.command,
                arguments: {
                    id: ids[0],
                    operation: 'SET_BULGE',
                    ...values
                }
            };
        case 'chamfer':
            return {
                command: definition.command,
                arguments: {
                    firstId: ids[0],
                    secondId: ids[1],
                    ...values,
                    pickPoint1: points[0],
                    pickPoint2: points[1]
                }
            };
        case 'fillet':
            return {
                command: definition.command,
                arguments: {
                    firstId: ids[0],
                    secondId: ids[1],
                    ...values,
                    pickPoint1: points[0],
                    pickPoint2: points[1]
                }
            };
    }
}
export function previewKJModification(id, context, entities, options = {}) {
    if (![
        'mirror',
        'array-polar',
        'offset',
        'chamfer',
        'fillet'
    ].includes(id)) return null;
    const maxEntities = options.maxEntities ?? 256;
    if (!Number.isSafeInteger(maxEntities) || maxEntities < 1 || maxEntities > 512) throw new RangeError('Modification preview maxEntities must be an integer from 1 to 512');
    if (context.ids.length > 64) throw new RangeError('Modification preview supports at most 64 selected entities');
    const byId = new Map(entities.map((entity)=>[
            entity.id,
            entity
        ]));
    const selected = context.ids.map((entityId)=>{
        const entity = byId.get(entityId);
        if (!entity || entity.kind !== 'entity' || entity.erased) throw new RangeError(`Modification preview entity is unavailable: ${entityId}`);
        return entity;
    });
    for (const entity of selected){
        const layer = byId.get(String(entity.payload.layerId ?? ''));
        const reason = entity.payload.locked === true || layer?.payload.locked === true ? 'locked' : entity.payload.frozen === true || layer?.payload.frozen === true ? 'frozen' : entity.payload.visible === false || layer?.payload.visible === false ? 'hidden' : null;
        if (reason) throw new RangeError(`Modification preview requires visible editable geometry; ${entity.id} is ${reason}`);
    }
    const request = buildKJModificationCommand(id, context);
    const args = request.arguments;
    const before = [];
    const after = [];
    let total = 0;
    const spec = (entity, payload = entity.payload)=>({
            type: entity.type,
            payload
        });
    const add = (value)=>{
        total += 1;
        if (after.length < maxEntities) after.push(value);
    };
    if (id === 'mirror') {
        const matrix = reflectionAcrossLine3(args.lineStart, args.lineEnd);
        for (const entity of selected)add(spec(entity, transformEntityPayload(entity.type, entity.payload, matrix)));
        if (args.eraseSource === true) before.push(...selected.map((entity)=>spec(entity)));
    } else if (id === 'array-polar') {
        const center = args.center;
        const count = Number(args.count), fillAngle = Number(args.angleDegrees) * Math.PI / 180;
        const fullCircle = Math.abs(Math.abs(fillAngle) - Math.PI * 2) <= 1e-10;
        const step = fillAngle / (fullCircle ? count : count - 1);
        outer: for(let index = 1; index < count; index += 1){
            const rotation = rotationAround3(step * index, center);
            let matrix = rotation;
            if (args.rotateItems === false) {
                const basePoint = args.basePoint;
                const rotated = transformPoint3(rotation, basePoint);
                matrix = translation3(rotated[0] - basePoint[0], rotated[1] - basePoint[1]);
            }
            for (const entity of selected){
                add(spec(entity, transformEntityPayload(entity.type, entity.payload, matrix)));
                if (after.length >= maxEntities) break outer;
            }
        }
        total = (count - 1) * selected.length;
    } else if (id === 'offset') {
        const entity = selected[0];
        add(spec(entity, offsetEntityPayload(entity, args.distance, args)));
    } else {
        const first = selected[0], second = selected[1];
        const result = id === 'chamfer' ? chamferLinePair(first, second, args) : filletLinePair(first, second, args);
        before.push(spec(first), spec(second));
        add(spec(first, result.first));
        add(spec(second, result.second));
        const connector = result.connector;
        if (connector.type !== 'LINE' || Math.hypot(Number(connector.payload.end[0]) - Number(connector.payload.start[0]), Number(connector.payload.end[1]) - Number(connector.payload.start[1])) > 1e-12) add(connector);
    }
    return Object.freeze({
        before: Object.freeze(before),
        after: Object.freeze(after),
        omittedCount: Math.max(0, total - after.length)
    });
}
