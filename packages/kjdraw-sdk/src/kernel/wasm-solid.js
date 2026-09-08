// Generated from wasm-solid.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from '../errors.js';
const EXPECTED_ABI_MAGIC = 0x4b4a4301;
const EXPECTED_SOLID_MODEL_VERSION = 1;
const SOLID_ERRORS = Object.freeze({
    201: '三维参数无效',
    202: '三维网格无效',
    203: '该布尔运算超出当前精确基本体范围',
    204: '三维运算结果为空'
});
function isRecord(value) {
    return value !== null && typeof value === 'object';
}
function rawExports(source) {
    if (!isRecord(source)) return {};
    const nested = source.exports;
    return isRecord(nested) ? nested : source;
}
function lastError(exports) {
    return Number(exports.kjcore_last_error?.() ?? 0);
}
function fail(exports, operation, result) {
    const code = Math.abs(Number(result) || lastError(exports));
    return new KJValidationError(`KJCore ${operation} 失败：${SOLID_ERRORS[code] ?? `错误 ${code || 'unknown'}`}`, {
        code,
        operation
    });
}
function assertSolidAbi(source) {
    const candidate = rawExports(source);
    if (typeof candidate.kjcore_abi_magic !== 'function' || Number(candidate.kjcore_abi_magic()) >>> 0 !== EXPECTED_ABI_MAGIC) {
        throw new KJValidationError('KJCore 三维 WASM ABI 不兼容');
    }
    if (typeof candidate.kjcore_solid_model_version !== 'function' || Number(candidate.kjcore_solid_model_version()) !== EXPECTED_SOLID_MODEL_VERSION) {
        throw new KJValidationError('KJCore 三维模型版本不兼容');
    }
    for (const name of [
        'kjcore_alloc_f64',
        'kjcore_free_f64',
        'kjcore_solid_open_mesh',
        'kjcore_solid_box',
        'kjcore_solid_cylinder',
        'kjcore_solid_cone',
        'kjcore_solid_sphere',
        'kjcore_solid_sweep',
        'kjcore_solid_loft',
        'kjcore_solid_transform',
        'kjcore_solid_boolean',
        'kjcore_solid_validate',
        'kjcore_solid_volume',
        'kjcore_solid_serialize_json',
        'kjcore_solid_close',
        'kjcore_byte_result_len',
        'kjcore_byte_result_value'
    ])if (typeof candidate[name] !== 'function') throw new KJValidationError(`KJCore 三维 ABI 缺失 ${name}`);
    if (!isRecord(candidate.memory) || !('buffer' in candidate.memory)) throw new KJValidationError('KJCore 三维 ABI 缺失共享内存');
    return candidate;
}
function point3(value, label) {
    const record = value;
    const row = Array.isArray(value) ? value : [
        record?.x,
        record?.y,
        record?.z
    ];
    if (row.length < 3 || ![
        row[0],
        row[1],
        row[2]
    ].every(Number.isFinite)) throw new KJValidationError(`${label} 必须是有限三维点`);
    return [
        Number(row[0]),
        Number(row[1]),
        Number(row[2])
    ];
}
function flatPoints(points, label = 'points') {
    if (!Array.isArray(points) || points.length < 3) throw new KJValidationError(`${label} 至少需要三个三维点`);
    const output = [];
    for(let index = 0; index < points.length; index += 1)output.push(...point3(points[index], `${label}[${index}]`));
    return output;
}
function withF64(exports, values, callback) {
    const source = Float64Array.from(values);
    const pointer = Number(exports.kjcore_alloc_f64(source.length));
    if (source.length && !pointer) throw new KJValidationError('KJCore 无法分配三维输入缓冲区');
    try {
        new Float64Array(exports.memory.buffer, pointer, source.length).set(source);
        return callback(pointer, source.length);
    } finally{
        exports.kjcore_free_f64(pointer, source.length);
    }
}
function readBytes(exports, operation, result) {
    if (!Number.isInteger(result) || result < 0) throw fail(exports, operation, result);
    const length = Number(exports.kjcore_byte_result_len());
    if (length !== result) throw new KJValidationError(`KJCore ${operation} 返回长度不兼容`);
    const bytes = new Uint8Array(length);
    for(let index = 0; index < length; index += 1){
        const value = Number(exports.kjcore_byte_result_value(index));
        if (!Number.isInteger(value) || value < 0 || value > 255) throw new KJValidationError(`KJCore ${operation} 返回无效字节`);
        bytes[index] = value;
    }
    return new TextDecoder('utf-8', {
        fatal: true
    }).decode(bytes);
}
export class KJCoreSolidSession {
    #exports;
    #handle;
    constructor(exports, handle){
        this.#exports = exports;
        this.#handle = handle;
    }
    get closed() {
        return this.#handle === 0;
    }
    validate() {
        this.#assertOpen();
        const result = Number(this.#exports.kjcore_solid_validate(this.#handle));
        if (result !== 1) throw fail(this.#exports, 'solid_validate', result);
        return true;
    }
    get volume() {
        this.#assertOpen();
        const value = Number(this.#exports.kjcore_solid_volume(this.#handle));
        if (!Number.isFinite(value) || value <= 0) throw fail(this.#exports, 'solid_volume', lastError(this.#exports));
        return value;
    }
    serialize() {
        this.#assertOpen();
        return JSON.parse(readBytes(this.#exports, 'solid_serialize_json', Number(this.#exports.kjcore_solid_serialize_json(this.#handle))));
    }
    transform(matrix) {
        this.#assertOpen();
        const values = Array.from(matrix ?? [], Number);
        if (values.length !== 16 || !values.every(Number.isFinite)) throw new KJValidationError('三维变换必须是有限 4×4 矩阵');
        return withF64(this.#exports, values, (pointer, length)=>session(this.#exports, Number(this.#exports.kjcore_solid_transform(this.#handle, pointer, length)), 'solid_transform'));
    }
    boolean(other, operation = 'union') {
        this.#assertOpen();
        if (!(other instanceof KJCoreSolidSession) || other.closed) throw new KJValidationError('布尔运算需要两个打开的 KJCore 三维会话');
        const codes = {
            union: 0,
            intersection: 1,
            difference: 2
        };
        const normalized = String(operation).toLowerCase();
        if (!(normalized in codes)) throw new KJValidationError(`未知三维布尔运算：${operation}`);
        const code = codes[normalized];
        return session(this.#exports, Number(this.#exports.kjcore_solid_boolean(this.#handle, other.#handle, code)), 'solid_boolean');
    }
    close() {
        if (this.closed) return false;
        const handle = this.#handle;
        this.#handle = 0;
        const result = Number(this.#exports.kjcore_solid_close(handle));
        if (result !== 1) throw fail(this.#exports, 'solid_close', result);
        return true;
    }
    #assertOpen() {
        if (this.closed) throw new KJValidationError('KJCore 三维会话已经关闭');
    }
}
function session(exports, handle, operation) {
    if (!Number.isInteger(handle) || handle <= 0) throw fail(exports, operation, handle);
    return new KJCoreSolidSession(exports, handle);
}
export function createKJCoreSolidBackend(wasmModuleOrInstance) {
    const exports = assertSolidAbi(wasmModuleOrInstance);
    const primitive = (name, args)=>{
        const operation = exports[name];
        if (typeof operation !== 'function') throw new KJValidationError(`KJCore 三维 ABI 缺失 ${String(name)}`);
        return session(exports, Number(operation(...args)), String(name));
    };
    return Object.freeze({
        id: 'kanjie.kjcore.solid-wasm',
        authoritative: true,
        modelVersion: EXPECTED_SOLID_MODEL_VERSION,
        openMesh (mesh) {
            const vertices = flatPoints(mesh?.vertices, 'vertices');
            const triangles = (mesh?.triangles ?? []).flatMap((row, index)=>{
                if (!Array.isArray(row) || row.length !== 3 || !row.every((value)=>Number.isInteger(value) && value >= 0)) {
                    throw new KJValidationError(`triangles[${index}] 必须包含三个无符号整数`);
                }
                return [
                    ...row
                ];
            });
            return withF64(exports, vertices, (vertexPointer, vertexCount)=>withF64(exports, triangles, (trianglePointer, triangleCount)=>session(exports, Number(exports.kjcore_solid_open_mesh(vertexPointer, vertexCount, trianglePointer, triangleCount)), 'solid_open_mesh')));
        },
        box ({ center = [
            0,
            0,
            0
        ], size } = {}) {
            return primitive('kjcore_solid_box', [
                ...point3(center, 'center'),
                ...point3(size, 'size')
            ]);
        },
        cylinder ({ center = [
            0,
            0,
            0
        ], radius, height, segments = 32 } = {}) {
            return primitive('kjcore_solid_cylinder', [
                ...point3(center, 'center'),
                Number(radius),
                Number(height),
                Number(segments)
            ]);
        },
        cone ({ center = [
            0,
            0,
            0
        ], bottomRadius, topRadius = 0, height, segments = 32 } = {}) {
            return primitive('kjcore_solid_cone', [
                ...point3(center, 'center'),
                Number(bottomRadius),
                Number(topRadius),
                Number(height),
                Number(segments)
            ]);
        },
        sphere ({ center = [
            0,
            0,
            0
        ], radius, segments = 32 } = {}) {
            return primitive('kjcore_solid_sphere', [
                ...point3(center, 'center'),
                Number(radius),
                Number(segments)
            ]);
        },
        sweep ({ profile, vector } = {}) {
            const values = flatPoints(profile, 'profile');
            const direction = point3(vector, 'vector');
            return withF64(exports, values, (pointer, length)=>session(exports, Number(exports.kjcore_solid_sweep(pointer, length, ...direction)), 'solid_sweep'));
        },
        loft ({ bottom, top } = {}) {
            const first = flatPoints(bottom, 'bottom');
            const second = flatPoints(top, 'top');
            return withF64(exports, first, (firstPointer, firstLength)=>withF64(exports, second, (secondPointer, secondLength)=>session(exports, Number(exports.kjcore_solid_loft(firstPointer, firstLength, secondPointer, secondLength)), 'solid_loft')));
        }
    });
}
export const KJCORE_SOLID_MODEL_VERSION = EXPECTED_SOLID_MODEL_VERSION;
