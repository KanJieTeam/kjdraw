// Generated from dxf-adapter.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJDocument } from './document.js';
import { KJValidationError } from './errors.js';
import { defineFileAdapter } from './file-adapters.js';
import { projectDimension, resolveDimensionAnnotationStyle } from './geometry/annotation.js';
import { normalizeSplineDefinition, splinePoint2 } from './geometry/curves.js';
import { hatchPatternLines } from './geometry/hatch.js';
import { normalizeStandardEntityPayload } from './standard-entities.js';
import { normalizeDimensionAssociations } from './dimension-associations.js';
import { normalizeName } from './utils.js';
import { PLOT_SETTING_FIELDS, validatePlotSettings } from './plot-settings.js';
import { validateDxfLayoutGeometry } from './layout-geometry.js';
function readDimensionAssociationHandles(record) {
    const starts = record.tags.map((tag, index)=>tag.code === 1001 && tag.value === 'KJDRAW' ? index : -1).filter((index)=>index >= 0);
    if (!starts.length) return null;
    if (starts.length !== 1) throw new KJValidationError('Duplicate KJDRAW DIMENSION association XDATA');
    let index = starts[0] + 1;
    if (record.tags[index]?.code !== 1000 || record.tags[index]?.value !== 'DIMASSOC1') throw new KJValidationError('Unsupported KJDRAW DIMENSION association XDATA');
    const chunks = [];
    while(record.tags[++index]?.code === 1000){
        chunks.push(record.tags[index].value);
        if (chunks.length > 20) throw new KJValidationError('KJDRAW DIMENSION association XDATA exceeds its chunk budget');
    }
    if (!chunks.length) throw new KJValidationError('KJDRAW DIMENSION association XDATA is empty');
    let parsed;
    try {
        parsed = JSON.parse(chunks.join(''));
    } catch  {
        throw new KJValidationError('Malformed KJDRAW DIMENSION association XDATA');
    }
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 4) throw new KJValidationError('KJDRAW DIMENSION association XDATA requires 1-4 references');
    return parsed.map((candidate, offset)=>{
        if (!Array.isArray(candidate) || candidate.length < 3 || candidate.length > 5) throw new KJValidationError(`Malformed KJDRAW DIMENSION association ${offset}`);
        const [definitionPointIndex, entityHandle, feature, parameter] = candidate;
        if (typeof entityHandle !== 'string' || !/^[0-9A-F]+$/.test(entityHandle)) throw new KJValidationError(`Invalid KJDRAW DIMENSION association handle ${offset}`);
        const normalized = normalizeDimensionAssociations([
            {
                definitionPointIndex,
                entityId: 'pending',
                feature,
                ...feature === 'vertex' ? {
                    vertexIndex: parameter
                } : {},
                ...feature === 'curve' ? {
                    angle: parameter
                } : {}
            }
        ])[0];
        const { entityId: _pending, ...association } = normalized;
        return {
            ...association,
            entityHandle
        };
    });
}
function readDimensionOverrides(record) {
    const result = {};
    let acad = false;
    for(let index = 0; index < record.tags.length; index++){
        const tag = record.tags[index];
        if (tag.code === 1001) {
            acad = tag.value === 'ACAD';
            continue;
        }
        if (!acad || tag.code !== 1000 || tag.value !== 'DSTYLE' || record.tags[index + 1]?.code !== 1002 || record.tags[index + 1]?.value !== '{') continue;
        index += 2;
        while(index < record.tags.length){
            const key = record.tags[index], value = record.tags[index + 1];
            if (key.code === 1002 && key.value === '}') break;
            if (key.code !== 1070 || !value) throw new KJValidationError('Malformed DIMENSION DSTYLE override');
            const code = Number(key.value), number = Number(value.value);
            const lengthProperty = {
                40: 'overallScale',
                41: 'arrowSize',
                42: 'extensionOffset',
                44: 'extensionBeyond'
            }[code];
            if (lengthProperty) {
                if (value.code !== 1040 || !value.value.trim() || !Number.isFinite(number) || result[lengthProperty] !== undefined) throw new KJValidationError('Invalid or duplicate DIMENSION annotation style override');
                result[lengthProperty] = number;
            }
            const precisionCode = [
                2,
                5
            ].includes(Number(first(record, 70, '0')) & 7) ? 179 : 271;
            if (code === 140 || code === precisionCode) {
                if (!value.value.trim() || !Number.isFinite(number) || (code === 140 ? value.code !== 1040 || number <= 0 : value.code !== 1070 || !Number.isInteger(number) || number < (code === 179 ? -1 : 0) || number > 8)) throw new KJValidationError('Invalid DIMENSION text height or precision override');
                const property = code === 140 ? 'textHeight' : 'precision';
                if (result[property] !== undefined) throw new KJValidationError('Duplicate DIMENSION DSTYLE override');
                result[property] = number;
            }
            if (precisionCode === 179 && code === 271) {
                if (value.code !== 1070 || !Number.isInteger(number) || number < 0 || number > 8 || result.linearPrecision !== undefined) throw new KJValidationError('Invalid DIMENSION inherited linear precision override');
                result.linearPrecision = number;
            }
            if (code === 275) {
                if (value.code !== 1070 || !Number.isInteger(number) || number < 0 || number > 3 || result.angularUnits !== undefined) throw new KJValidationError('Invalid DIMENSION angular units override');
                result.angularUnits = number;
            }
            index += 2;
        }
    }
    return result;
}
function readPlotSettings(record) {
    const start = record.tags.findIndex((tag)=>tag.code === 100 && tag.value === 'AcDbPlotSettings');
    if (start < 0) return undefined;
    const end = record.tags.findIndex((tag, index)=>index > start && tag.code === 100);
    const tags = record.tags.slice(start + 1, end < 0 ? undefined : end);
    const result = {};
    for (const [key, [code, kind]] of Object.entries(PLOT_SETTING_FIELDS)){
        const matches = tags.filter((tag)=>tag.code === code);
        if (matches.length > 1) throw new KJValidationError(`Duplicate DXF plot setting: ${key}`);
        const tag = matches[0];
        if (tag) result[key] = kind === 'string' ? tag.value : tag.value.trim() ? Number(tag.value) : NaN;
    }
    validatePlotSettings(result);
    return Object.keys(result).length ? result : undefined;
}
function dxfPayload(record) {
    return record.payload ?? {};
}
function dxfEntity(record) {
    return {
        type: record.type,
        handle: record.handle,
        ownerId: record.ownerId,
        payload: dxfPayload(record)
    };
}
function dxfNamedRecord(record) {
    return {
        id: record.id,
        name: String(record.name ?? ''),
        type: record.type,
        handle: record.handle,
        payload: dxfPayload(record)
    };
}
function vertexPoint(vertex) {
    if (Array.isArray(vertex)) return [
        Number(vertex[0]),
        Number(vertex[1]),
        Number(vertex[2] ?? 0)
    ];
    return vertex.point;
}
function documentTableRecords(document, name) {
    const table = document.getTable(name);
    if (!table) throw new KJValidationError(`KJDocument table is unavailable: ${name}`);
    return table.records;
}
const PRODUCT_VERSIONS = Object.freeze([
    'R14',
    '2000',
    '2004',
    '2010',
    '2013',
    '2018',
    '2024'
]);
const VERSIONS = Object.freeze([
    'R12',
    ...PRODUCT_VERSIONS
]);
const ACADVER = Object.freeze({
    R12: 'AC1009',
    R14: 'AC1014',
    2000: 'AC1015',
    2004: 'AC1018',
    2010: 'AC1024',
    2013: 'AC1027',
    2018: 'AC1032',
    2024: 'AC1032'
});
const VERSION_BY_CODE = Object.freeze({
    AC1009: 'R12',
    AC1014: 'R14',
    AC1015: '2000',
    AC1018: '2004',
    AC1024: '2010',
    AC1027: '2013',
    AC1032: '2018'
});
const READ_TYPES = Object.freeze([
    'LINE',
    'XLINE',
    'RAY',
    'POINT',
    'CIRCLE',
    'ARC',
    'LWPOLYLINE',
    'POLYLINE',
    'ELLIPSE',
    'SPLINE',
    'TEXT',
    'MTEXT',
    'ATTDEF',
    'ATTRIB',
    'INSERT',
    'HATCH',
    'LEADER',
    'DIMENSION',
    'SOLID',
    'VIEWPORT',
    'WIPEOUT',
    'PROXY_ENTITY'
]);
const WRITE_TYPES = new Set([
    'LINE',
    'XLINE',
    'RAY',
    'POINT',
    'CIRCLE',
    'ARC',
    'LWPOLYLINE',
    'POLYLINE',
    'ELLIPSE',
    'SPLINE',
    'TEXT',
    'MTEXT',
    'ATTDEF',
    'ATTRIB',
    'INSERT',
    'HATCH',
    'LEADER',
    'DIMENSION',
    'SOLID',
    'VIEWPORT',
    'WIPEOUT',
    'PROXY_ENTITY'
]);
const DIMENSION_TYPE_BY_CODE = Object.freeze({
    0: 'ROTATED',
    1: 'ALIGNED',
    2: 'ANGULAR',
    3: 'DIAMETER',
    4: 'RADIUS',
    5: 'ANGULAR_3_POINT',
    6: 'ORDINATE'
});
const DIMENSION_CODE_BY_TYPE = Object.freeze(Object.fromEntries(Object.entries(DIMENSION_TYPE_BY_CODE).map(([code, type])=>[
        type,
        Number(code)
    ])));
const VERSION_RANK = Object.freeze({
    R12: 0,
    R14: 1,
    2000: 2,
    2004: 3,
    2010: 4,
    2013: 5,
    2018: 6,
    2024: 6
});
const MIN_ENTITY_VERSION = Object.freeze({
    ELLIPSE: 'R14',
    SPLINE: 'R14',
    MTEXT: 'R14',
    LEADER: 'R14',
    HATCH: 'R14',
    WIPEOUT: '2000',
    XLINE: '2000',
    RAY: '2000',
    VIEWPORT: 'R14'
});
const CODE_PAGE_LABELS = Object.freeze({
    'ANSI_936': 'gb18030',
    'ANSI_950': 'big5',
    'ANSI_932': 'shift_jis',
    'ANSI_949': 'euc-kr',
    'ANSI_1252': 'windows-1252',
    'UTF-8': 'utf-8',
    'UTF8': 'utf-8'
});
export const DXF_DEFAULT_READ_LIMITS = Object.freeze({
    maxBytes: 64 * 1024 ** 2,
    maxTags: 4_000_000,
    maxEntities: 250_000
});
function abortDXF(options) {
    if (options.signal?.aborted) throw new KJValidationError('DXF read aborted');
}
function reportDXF(options, phase, completed, unit, total) {
    options.onProgress?.(Object.freeze({
        phase,
        completed,
        ...total === undefined ? {} : {
            total
        },
        unit
    }));
    abortDXF(options);
}
const yieldDXF = ()=>new Promise((resolve)=>setTimeout(resolve, 0));
function readLimits(options = {}) {
    const source = 'limits' in options && options.limits ? options.limits : options;
    const limits = {
        maxBytes: Math.max(1, Number(source.maxBytes ?? DXF_DEFAULT_READ_LIMITS.maxBytes)),
        maxTags: Math.max(1, Number(source.maxTags ?? DXF_DEFAULT_READ_LIMITS.maxTags)),
        maxEntities: Math.max(1, Number(source.maxEntities ?? DXF_DEFAULT_READ_LIMITS.maxEntities))
    };
    if (!Object.values(limits).every(Number.isFinite)) throw new KJValidationError('DXF read limits must be finite positive numbers');
    return limits;
}
function assertSourceSize(size, limits) {
    if (size !== undefined && Number.isFinite(size) && size > limits.maxBytes) throw new KJValidationError(`DXF source exceeds the ${limits.maxBytes} byte read limit`);
}
function decodeBytes(bytes) {
    const probe = new TextDecoder('windows-1252').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
    const version = probe.match(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d+)/i);
    if (version && Number(version[1]) >= 1021) {
        try {
            return new TextDecoder('utf-8', {
                fatal: true
            }).decode(bytes);
        } catch  {
            throw new KJValidationError('Modern DXF requires valid UTF-8 bytes; decode a nonstandard source explicitly before importing');
        }
    }
    const match = probe.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([^\r\n]+)/i);
    const codePage = normalizeName(match?.[1] ?? 'UTF-8');
    const label = CODE_PAGE_LABELS[codePage] ?? 'utf-8';
    try {
        return new TextDecoder(label).decode(bytes);
    } catch  {
        return new TextDecoder().decode(bytes);
    }
}
async function sourceText(source, options = {}) {
    const limits = readLimits(options);
    const readOptions = options;
    abortDXF(readOptions);
    if (typeof source === 'string') {
        const size = new TextEncoder().encode(source).byteLength;
        assertSourceSize(size, limits);
        reportDXF(readOptions, 'source', size, 'bytes', size);
        return source;
    }
    if (source instanceof Uint8Array) {
        assertSourceSize(source.byteLength, limits);
        reportDXF(readOptions, 'source', source.byteLength, 'bytes', source.byteLength);
        return decodeBytes(source);
    }
    if (source instanceof ArrayBuffer) {
        assertSourceSize(source.byteLength, limits);
        reportDXF(readOptions, 'source', source.byteLength, 'bytes', source.byteLength);
        return decodeBytes(new Uint8Array(source));
    }
    if (source !== null && typeof source === 'object' && 'stream' in source && typeof source.stream === 'function') {
        const streamed = source;
        assertSourceSize(streamed.size, limits);
        const reader = streamed.stream().getReader(), chunks = [];
        let completed = 0, reported = -1;
        try {
            while(true){
                abortDXF(readOptions);
                const next = await reader.read();
                if (next.done) break;
                const chunk = next.value;
                completed += chunk.byteLength;
                assertSourceSize(completed, limits);
                chunks.push(chunk);
                if (completed - reported >= 1024 * 1024 || completed === streamed.size) {
                    reportDXF(readOptions, 'source', completed, 'bytes', streamed.size);
                    reported = completed;
                }
            }
        } catch (error) {
            await reader.cancel().catch(()=>undefined);
            throw error;
        }
        const bytes = new Uint8Array(completed);
        let offset = 0;
        for (const chunk of chunks){
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        if (reported !== completed) reportDXF(readOptions, 'source', completed, 'bytes', streamed.size ?? completed);
        return decodeBytes(bytes);
    }
    if (source !== null && typeof source === 'object' && 'arrayBuffer' in source && typeof source.arrayBuffer === 'function') {
        const sized = source;
        assertSourceSize(sized.size, limits);
        const bytes = new Uint8Array(await sized.arrayBuffer());
        abortDXF(readOptions);
        assertSourceSize(bytes.byteLength, limits);
        reportDXF(readOptions, 'source', bytes.byteLength, 'bytes', sized.size ?? bytes.byteLength);
        return decodeBytes(bytes);
    }
    if (source !== null && typeof source === 'object' && 'text' in source && typeof source.text === 'function') {
        const sized = source;
        assertSourceSize(sized.size, limits);
        const text = await sized.text();
        abortDXF(readOptions);
        assertSourceSize(new TextEncoder().encode(text).byteLength, limits);
        reportDXF(readOptions, 'source', sized.size ?? text.length, 'bytes', sized.size);
        return text;
    }
    throw new KJValidationError('DXF source must be text, bytes, or Blob/File');
}
async function tagsFromText(text, options = {}) {
    const limits = readLimits(options);
    const tags = [];
    let cursor = text.charCodeAt(0) === 0xFEFF ? 1 : 0, lineNumber = 1, lastYield = cursor;
    const line = ()=>{
        if (cursor >= text.length) return null;
        const end = text.indexOf('\n', cursor), value = text.slice(cursor, end < 0 ? text.length : end);
        cursor = end < 0 ? text.length : end + 1;
        return value.endsWith('\r') ? value.slice(0, -1) : value;
    };
    while(cursor < text.length){
        const codeLine = line(), valueLine = line();
        if (codeLine === null || valueLine === null) break;
        const code = Number(codeLine.trim());
        if (!Number.isInteger(code)) throw new KJValidationError(`Invalid DXF group code at line ${lineNumber}`);
        if (tags.length >= limits.maxTags) throw new KJValidationError(`DXF tag count exceeds the ${limits.maxTags} read limit`);
        tags.push({
            code,
            value: code === 1 || code === 3 ? valueLine : valueLine.trimEnd()
        });
        lineNumber += 2;
        if (cursor - lastYield >= 256 * 1024) {
            reportDXF(options, 'parse', tags.length, 'tags');
            await yieldDXF();
            abortDXF(options);
            lastYield = cursor;
        }
    }
    reportDXF(options, 'parse', tags.length, 'tags', tags.length);
    return tags;
}
function section(tags, name) {
    const normalizedName = normalizeName(name);
    for(let index = 0; index < tags.length - 1; index += 1){
        if (tags[index].code === 0 && normalizeName(tags[index].value) === 'SECTION' && tags[index + 1].code === 2 && normalizeName(tags[index + 1].value) === normalizedName) {
            const end = tags.findIndex((tag, position)=>position > index + 1 && tag.code === 0 && normalizeName(tag.value) === 'ENDSEC');
            return tags.slice(index + 2, end < 0 ? tags.length : end);
        }
    }
    return [];
}
function records(tags) {
    const output = [];
    let current = null;
    for (const tag of tags){
        if (tag.code === 0) {
            if (current) output.push(current);
            current = {
                type: normalizeName(tag.value),
                tags: []
            };
        } else if (current) current.tags.push(tag);
    }
    if (current) output.push(current);
    return output;
}
function recordOwner(record) {
    let depth = 0;
    for (const tag of record.tags){
        if (tag.code === 102) {
            if (String(tag.value).startsWith('{')) depth++;
            else if (tag.value === '}') depth = Math.max(0, depth - 1);
        } else if (tag.code === 330 && depth === 0) return String(tag.value).trim().toUpperCase();
    }
    return '';
}
function isSpaceBlock(name) {
    return /^[*$](MODEL_SPACE|PAPER_SPACE(?:_?\d+)?)$/.test(normalizeName(name));
}
function collapseLegacyPolylines(source) {
    const output = [];
    for(let index = 0; index < source.length; index += 1){
        const record = source[index];
        if (record.type !== 'POLYLINE') {
            output.push(record);
            continue;
        }
        const vertices = [];
        let cursor = index + 1;
        while(cursor < source.length && source[cursor].type === 'VERTEX'){
            vertices.push(source[cursor]);
            cursor += 1;
        }
        const sequenceEnd = source[cursor]?.type === 'SEQEND' ? source[cursor] : null;
        output.push({
            ...record,
            vertices,
            sequenceEnd
        });
        index = sequenceEnd ? cursor : cursor - 1;
    }
    return output;
}
function collapseInsertAttributes(source) {
    const output = [];
    for(let index = 0; index < source.length; index++){
        const record = source[index];
        if (record.type !== 'INSERT' || number(record, 66) !== 1) {
            output.push(record);
            continue;
        }
        const attributes = [];
        const insertHandle = String(first(record, 5, '')).toUpperCase(), spaceHandle = recordOwner(record);
        let cursor = index + 1;
        while(source[cursor]?.type === 'ATTRIB')attributes.push(source[cursor++]);
        const sequenceEnd = source[cursor];
        if (sequenceEnd?.type !== 'SEQEND') throw new KJValidationError('DXF INSERT attribute sequence is missing SEQEND');
        for (const child of [
            ...attributes,
            sequenceEnd
        ]){
            const owner = recordOwner(child);
            if (owner && owner !== insertHandle && owner !== spaceHandle) throw new KJValidationError('DXF INSERT attribute sequence references a different owner');
            if (values(child, 67).length && number(child, 67) !== number(record, 67)) throw new KJValidationError('DXF INSERT attribute sequence has a conflicting space hint');
            if (first(child, 410) && first(record, 410) && normalizeName(first(child, 410)) !== normalizeName(first(record, 410))) throw new KJValidationError('DXF INSERT attribute sequence has a conflicting layout hint');
            if (child.type === 'ATTRIB' && child.tags.some((tag)=>tag.code === 100 && tag.value === 'AcDbMText')) throw new KJValidationError('Embedded multiline DXF ATTRIB is not supported; import stopped to preserve its content');
        }
        output.push({
            ...record,
            attributes,
            sequenceEnd
        });
        index = cursor;
    }
    return output;
}
function entityRecords(tags) {
    return collapseInsertAttributes(collapseLegacyPolylines(records(tags)));
}
function blockDefinitions(tags) {
    const source = records(tags);
    const output = [];
    for(let index = 0; index < source.length; index += 1){
        if (source[index].type !== 'BLOCK') continue;
        const header = source[index];
        const inner = [];
        index += 1;
        while(index < source.length && source[index].type !== 'ENDBLK')inner.push(source[index++]);
        const name = String(first(header, 2, first(header, 3, ''))).trim();
        if (name) output.push({
            name,
            header,
            basePoint: point(header),
            flags: number(header, 70, 0),
            records: collapseInsertAttributes(collapseLegacyPolylines(inner))
        });
    }
    return output;
}
function values(record, code) {
    return record.tags.filter((tag)=>tag.code === code).map((tag)=>tag.value);
}
function first(record, code, fallback = null) {
    return values(record, code)[0] ?? fallback;
}
function number(record, code, fallback = 0) {
    const value = Number(first(record, code, fallback));
    if (!Number.isFinite(value)) throw new KJValidationError(`Invalid DXF numeric group ${code} in ${record.type}`);
    return value;
}
function point(record, xCode = 10, yCode = 20, zCode = 30) {
    return [
        number(record, xCode),
        number(record, yCode),
        number(record, zCode)
    ];
}
function readLayoutGeometry(record) {
    const hasLimits = [
        10,
        20,
        11,
        21
    ].map((code)=>values(record, code).length > 0);
    if (hasLimits.some(Boolean) && !hasLimits.every(Boolean)) throw new KJValidationError('DXF AcDbLayout has incomplete limits');
    const limits = hasLimits.every(Boolean) ? {
        minimum: [
            number(record, 10),
            number(record, 20)
        ],
        maximum: [
            number(record, 11),
            number(record, 21)
        ]
    } : null;
    const hasExtents = [
        14,
        24,
        15,
        25
    ].map((code)=>values(record, code).length > 0);
    if (hasExtents.some(Boolean) && !hasExtents.every(Boolean)) throw new KJValidationError('DXF AcDbLayout has incomplete extents');
    const rawMinimum = hasExtents.every(Boolean) ? point(record, 14, 24, 34) : null;
    const rawMaximum = hasExtents.every(Boolean) ? point(record, 15, 25, 35) : null;
    const unset = rawMinimum !== null && rawMaximum !== null && rawMinimum.slice(0, 2).every((value)=>value >= 1e19) && rawMaximum.slice(0, 2).every((value)=>value <= -1e19);
    const extents = rawMinimum && rawMaximum && !unset ? {
        minimum: rawMinimum,
        maximum: rawMaximum
    } : null;
    const geometry = {
        limits,
        extents
    };
    validateDxfLayoutGeometry(geometry);
    return geometry;
}
function repeatedPoints(record, xCode = 10, yCode = 20, zCode = 30) {
    const result = [];
    for(let index = 0; index < record.tags.length; index += 1){
        if (record.tags[index].code !== xCode) continue;
        const value = [
            Number(record.tags[index].value),
            0,
            0
        ];
        for(let cursor = index + 1; cursor < record.tags.length && record.tags[cursor].code !== xCode; cursor += 1){
            if (record.tags[cursor].code === yCode) value[1] = Number(record.tags[cursor].value);
            else if (record.tags[cursor].code === zCode) value[2] = Number(record.tags[cursor].value);
        }
        if (!value.every(Number.isFinite)) throw new KJValidationError(`Invalid repeated point ${xCode}/${yCode}/${zCode} in ${record.type}`);
        result.push(value);
    }
    return result;
}
function optionalPoint(record, xCode, yCode, zCode) {
    return values(record, xCode).length ? point(record, xCode, yCode, zCode) : null;
}
function polylineVertices(record) {
    const vertices = [];
    for(let index = 0; index < record.tags.length; index += 1){
        if (record.tags[index].code !== 10) continue;
        const vertex = {
            point: [
                Number(record.tags[index].value),
                0,
                0
            ],
            bulge: 0,
            startWidth: 0,
            endWidth: 0
        };
        for(let cursor = index + 1; cursor < record.tags.length && record.tags[cursor].code !== 10; cursor += 1){
            const tag = record.tags[cursor];
            if (tag.code === 20) vertex.point[1] = Number(tag.value);
            else if (tag.code === 30) vertex.point[2] = Number(tag.value);
            else if (tag.code === 42) vertex.bulge = Number(tag.value);
            else if (tag.code === 40) vertex.startWidth = Number(tag.value);
            else if (tag.code === 41) vertex.endWidth = Number(tag.value);
        }
        if (!vertex.point.every(Number.isFinite) || ![
            vertex.bulge,
            vertex.startWidth,
            vertex.endWidth
        ].every(Number.isFinite)) throw new KJValidationError('Invalid LWPOLYLINE vertex');
        vertices.push(vertex);
    }
    return vertices;
}
function legacyPolylineVertices(record) {
    const defaultStartWidth = number(record, 40, 0);
    const defaultEndWidth = number(record, 41, 0);
    return (record.vertices ?? []).map((vertex, index)=>{
        const value = {
            point: point(vertex),
            bulge: number(vertex, 42, 0),
            startWidth: number(vertex, 40, defaultStartWidth),
            endWidth: number(vertex, 41, defaultEndWidth),
            dxfFlags: number(vertex, 70, 0)
        };
        if (!value.point.every(Number.isFinite)) throw new KJValidationError(`Invalid POLYLINE vertex ${index}`);
        return value;
    });
}
function hatchBoundaryLoops(record) {
    const tags = record.tags;
    const loops = [];
    let cursor = tags.findIndex((tag)=>tag.code === 91);
    const loopCount = cursor < 0 ? 0 : Number(tags[cursor].value);
    cursor += 1;
    for(let loopIndex = 0; loopIndex < loopCount; loopIndex += 1){
        while(cursor < tags.length && tags[cursor].code !== 92)cursor += 1;
        if (cursor >= tags.length) break;
        const flags = Number(tags[cursor++].value);
        const external = Boolean(flags & 1 || flags & 16);
        if (flags & 2) {
            let closed = true, vertexCount = 0;
            while(cursor < tags.length && tags[cursor].code !== 93){
                if (tags[cursor].code === 73) closed = Number(tags[cursor].value) !== 0;
                cursor += 1;
            }
            if (tags[cursor]?.code === 93) vertexCount = Number(tags[cursor++].value);
            const vertices = [];
            while(cursor < tags.length && vertices.length < vertexCount){
                if (tags[cursor].code !== 10) {
                    cursor += 1;
                    continue;
                }
                const vertex = {
                    point: [
                        Number(tags[cursor++].value),
                        0,
                        0
                    ],
                    bulge: 0,
                    startWidth: 0,
                    endWidth: 0
                };
                while(cursor < tags.length && tags[cursor].code !== 10 && tags[cursor].code !== 97 && tags[cursor].code !== 92){
                    if (tags[cursor].code === 20) vertex.point[1] = Number(tags[cursor].value);
                    else if (tags[cursor].code === 42) vertex.bulge = Number(tags[cursor].value);
                    cursor += 1;
                }
                vertices.push(vertex);
            }
            loops.push({
                external,
                flags,
                closed,
                vertices
            });
        } else {
            while(cursor < tags.length && tags[cursor].code !== 93)cursor += 1;
            const edgeCount = tags[cursor]?.code === 93 ? Number(tags[cursor++].value) : 0;
            const edges = [];
            for(let edgeIndex = 0; edgeIndex < edgeCount && cursor < tags.length; edgeIndex += 1){
                while(cursor < tags.length && tags[cursor].code !== 72)cursor += 1;
                if (cursor >= tags.length) break;
                const edgeType = Number(tags[cursor++].value);
                if (edgeType === 1) {
                    const edge = {
                        type: 'LINE',
                        start: [
                            0,
                            0,
                            0
                        ],
                        end: [
                            0,
                            0,
                            0
                        ]
                    };
                    while(cursor < tags.length && ![
                        72,
                        92,
                        97
                    ].includes(tags[cursor].code)){
                        const tag = tags[cursor++];
                        if (tag.code === 10) edge.start[0] = Number(tag.value);
                        else if (tag.code === 20) edge.start[1] = Number(tag.value);
                        else if (tag.code === 11) edge.end[0] = Number(tag.value);
                        else if (tag.code === 21) edge.end[1] = Number(tag.value);
                    }
                    edges.push(edge);
                } else if (edgeType === 2) {
                    const edge = {
                        type: 'ARC',
                        center: [
                            0,
                            0,
                            0
                        ],
                        radius: 0,
                        startAngle: 0,
                        endAngle: 0,
                        counterClockwise: true
                    };
                    while(cursor < tags.length && ![
                        72,
                        92,
                        97
                    ].includes(tags[cursor].code)){
                        const tag = tags[cursor++];
                        if (tag.code === 10) edge.center[0] = Number(tag.value);
                        else if (tag.code === 20) edge.center[1] = Number(tag.value);
                        else if (tag.code === 40) edge.radius = Number(tag.value);
                        else if (tag.code === 50) edge.startAngle = Number(tag.value) * Math.PI / 180;
                        else if (tag.code === 51) edge.endAngle = Number(tag.value) * Math.PI / 180;
                        else if (tag.code === 73) edge.counterClockwise = Number(tag.value) !== 0;
                    }
                    edges.push(edge);
                } else if (edgeType === 3) {
                    const edge = {
                        type: 'ELLIPSE',
                        center: [
                            0,
                            0,
                            0
                        ],
                        majorAxis: [
                            0,
                            0,
                            0
                        ],
                        ratio: 0,
                        startAngle: 0,
                        endAngle: 0,
                        counterClockwise: true
                    };
                    while(cursor < tags.length && ![
                        72,
                        92,
                        97
                    ].includes(tags[cursor].code)){
                        const tag = tags[cursor++];
                        if (tag.code === 10) edge.center[0] = Number(tag.value);
                        else if (tag.code === 20) edge.center[1] = Number(tag.value);
                        else if (tag.code === 11) edge.majorAxis[0] = Number(tag.value);
                        else if (tag.code === 21) edge.majorAxis[1] = Number(tag.value);
                        else if (tag.code === 40) edge.ratio = Number(tag.value);
                        else if (tag.code === 50) edge.startAngle = Number(tag.value) * Math.PI / 180;
                        else if (tag.code === 51) edge.endAngle = Number(tag.value) * Math.PI / 180;
                        else if (tag.code === 73) edge.counterClockwise = Number(tag.value) !== 0;
                    }
                    edges.push(edge);
                } else if (edgeType === 4) {
                    const edge = {
                        type: 'SPLINE',
                        degree: 0,
                        periodic: false,
                        controlPoints: [],
                        knots: [],
                        weights: [],
                        fitPoints: []
                    };
                    let rational = false, knotCount = 0, controlCount = 0;
                    while(cursor < tags.length && ![
                        72,
                        92
                    ].includes(tags[cursor].code)){
                        const tag = tags[cursor];
                        if (tag.code === 94) {
                            edge.degree = Number(tag.value);
                            cursor++;
                        } else if (tag.code === 73) {
                            rational = Number(tag.value) !== 0;
                            cursor++;
                        } else if (tag.code === 74) {
                            edge.periodic = Number(tag.value) !== 0;
                            cursor++;
                        } else if (tag.code === 95) {
                            knotCount = Number(tag.value);
                            cursor++;
                            break;
                        } else cursor++;
                    }
                    while(cursor < tags.length && tags[cursor].code !== 96)cursor++;
                    if (tags[cursor]?.code === 96) {
                        controlCount = Number(tags[cursor++].value);
                    }
                    while(cursor < tags.length && edge.knots.length < knotCount){
                        if (tags[cursor].code === 40) edge.knots.push(Number(tags[cursor].value));
                        cursor++;
                    }
                    while(cursor < tags.length && edge.controlPoints.length < controlCount){
                        if (tags[cursor].code !== 10) {
                            cursor++;
                            continue;
                        }
                        const control = [
                            Number(tags[cursor++].value),
                            0,
                            0
                        ];
                        let weight;
                        while(cursor < tags.length && tags[cursor].code !== 10 && tags[cursor].code !== 97 && ![
                            72,
                            92
                        ].includes(tags[cursor].code)){
                            const tag = tags[cursor++];
                            if (tag.code === 20) control[1] = Number(tag.value);
                            else if (tag.code === 42) weight = Number(tag.value);
                        }
                        edge.controlPoints.push(control);
                        if (rational) edge.weights.push(Number(weight));
                    }
                    if (tags[cursor]?.code === 97 && !(Number(tags[cursor].value) > 0 && tags[cursor + 1]?.code === 330)) {
                        const fitCount = Number(tags[cursor++].value);
                        while(cursor < tags.length && edge.fitPoints.length < fitCount){
                            if (tags[cursor].code !== 11) {
                                cursor++;
                                continue;
                            }
                            const fit = [
                                Number(tags[cursor++].value),
                                0,
                                0
                            ];
                            while(cursor < tags.length && tags[cursor].code !== 11 && ![
                                12,
                                13,
                                72,
                                92,
                                97
                            ].includes(tags[cursor].code)){
                                const tag = tags[cursor++];
                                if (tag.code === 21) fit[1] = Number(tag.value);
                            }
                            edge.fitPoints.push(fit);
                        }
                    }
                    const tangent = (xCode, yCode)=>{
                        if (tags[cursor]?.code !== xCode) return undefined;
                        const value = [
                            Number(tags[cursor++].value),
                            0,
                            0
                        ];
                        if (tags[cursor]?.code === yCode) value[1] = Number(tags[cursor++].value);
                        return value;
                    };
                    const startTangent = tangent(12, 22), endTangent = tangent(13, 23);
                    if (startTangent) edge.startTangent = startTangent;
                    if (endTangent) edge.endTangent = endTangent;
                    edges.push(edge);
                } else {
                    const rawTags = [];
                    while(cursor < tags.length && ![
                        72,
                        92,
                        97
                    ].includes(tags[cursor].code))rawTags.push(tags[cursor++]);
                    edges.push({
                        type: 'UNKNOWN',
                        dxfEdgeType: edgeType,
                        rawTags
                    });
                }
            }
            loops.push({
                external,
                flags,
                edges
            });
        }
        if (tags[cursor]?.code === 97) {
            const sourceCount = Number(tags[cursor++].value);
            cursor += Math.min(sourceCount, tags.slice(cursor).filter((tag)=>tag.code === 330).length);
        }
    }
    if (!loops.length) throw new KJValidationError('DXF HATCH contains no boundary loops');
    return loops;
}
function entityPayload(record, blockIds, resources = {}) {
    switch(record.type){
        case 'LINE':
            return {
                type: 'LINE',
                payload: {
                    start: point(record),
                    end: point(record, 11, 21, 31)
                }
            };
        case 'XLINE':
        case 'RAY':
            return {
                type: record.type,
                payload: {
                    origin: point(record),
                    direction: point(record, 11, 21, 31)
                }
            };
        case 'POINT':
            return {
                type: 'POINT',
                payload: {
                    position: point(record)
                }
            };
        case 'CIRCLE':
            return {
                type: 'CIRCLE',
                payload: {
                    center: point(record),
                    radius: number(record, 40)
                }
            };
        case 'ARC':
            return {
                type: 'ARC',
                payload: {
                    center: point(record),
                    radius: number(record, 40),
                    startAngle: number(record, 50) * Math.PI / 180,
                    endAngle: number(record, 51) * Math.PI / 180
                }
            };
        case 'LWPOLYLINE':
            return {
                type: 'LWPOLYLINE',
                payload: {
                    vertices: polylineVertices(record),
                    closed: (number(record, 70, 0) & 1) === 1,
                    elevation: number(record, 38, 0)
                }
            };
        case 'POLYLINE':
            return {
                type: 'POLYLINE',
                payload: {
                    vertices: legacyPolylineVertices(record),
                    closed: (number(record, 70, 0) & 1) === 1,
                    elevation: number(record, 30, 0),
                    dxfFlags: number(record, 70, 0)
                }
            };
        case 'ELLIPSE':
            return {
                type: 'ELLIPSE',
                payload: {
                    center: point(record),
                    majorAxis: point(record, 11, 21, 31),
                    ratio: number(record, 40),
                    startParameter: number(record, 41, 0),
                    endParameter: number(record, 42, Math.PI * 2)
                }
            };
        case 'SPLINE':
            {
                const weights = values(record, 41).map(Number);
                return {
                    type: 'SPLINE',
                    payload: {
                        degree: number(record, 71),
                        knots: values(record, 40).map(Number),
                        weights: weights.length ? weights : undefined,
                        controlPoints: repeatedPoints(record),
                        fitPoints: repeatedPoints(record, 11, 21, 31),
                        closed: (number(record, 70, 0) & 1) === 1,
                        periodic: (number(record, 70, 0) & 2) === 2
                    }
                };
            }
        case 'TEXT':
            return {
                type: 'TEXT',
                payload: {
                    ...readSingleLineText(record, resources),
                    verticalAlignment: number(record, 73, 0)
                }
            };
        case 'MTEXT':
            return {
                type: 'MTEXT',
                payload: {
                    position: point(record),
                    text: values(record, 3).join('') + first(record, 1, ''),
                    height: number(record, 40, 2.5),
                    rotation: number(record, 50, 0) * Math.PI / 180,
                    attachmentPoint: number(record, 71, 1),
                    ...values(record, 41).length ? {
                        width: number(record, 41)
                    } : {},
                    styleId: resources.textStyleIds?.get(normalizeName(first(record, 7, 'STANDARD'))) ?? null
                }
            };
        case 'ATTDEF':
        case 'ATTRIB':
            {
                if (record.tags.some((tag)=>tag.code === 100 && tag.value === 'AcDbMText')) throw new KJValidationError('Embedded multiline DXF attributes require an MTEXT-aware adapter');
                const attribute = recordSubclass(record, record.type === 'ATTDEF' ? 'AcDbAttributeDefinition' : 'AcDbAttribute');
                const extra = attribute === record ? [] : attribute.tags.filter((tag)=>![
                        2,
                        3,
                        70,
                        73,
                        74,
                        280
                    ].includes(tag.code));
                return {
                    type: record.type,
                    payload: {
                        ...readSingleLineText(record, resources),
                        verticalAlignment: number(attribute, 74, 0),
                        tag: first(attribute, 2, ''),
                        prompt: first(attribute, 3, ''),
                        flags: number(attribute, 70, 0),
                        lockPosition: Number(values(attribute, 280).at(-1) ?? 0) === 1,
                        ...extra.length ? {
                            dxfAttributeExtraTags: extra
                        } : {}
                    }
                };
            }
        case 'INSERT':
            return {
                type: 'INSERT',
                payload: {
                    blockRecordId: blockIds.get(normalizeName(first(record, 2))),
                    position: point(record),
                    scale: [
                        number(record, 41, 1),
                        number(record, 42, 1),
                        number(record, 43, 1)
                    ],
                    rotation: number(record, 50, 0) * Math.PI / 180
                }
            };
        case 'HATCH':
            return {
                type: 'HATCH',
                payload: {
                    boundaryLoops: hatchBoundaryLoops(record),
                    patternName: first(record, 2, 'SOLID'),
                    solid: number(record, 70, 0) === 1,
                    associative: number(record, 71, 0) === 1,
                    patternAngle: number(record, 52, 0) * Math.PI / 180,
                    patternScale: number(record, 41, 1),
                    rawTags: record.tags
                }
            };
        case 'LEADER':
            return {
                type: 'LEADER',
                payload: {
                    vertices: repeatedPoints(record),
                    annotationHandle: first(record, 340) || null,
                    arrowEnabled: number(record, 71, 1) !== 0,
                    pathType: number(record, 72, 0),
                    annotationType: number(record, 73, 3),
                    hookLineDirection: number(record, 74, 0),
                    hookLineEnabled: number(record, 75, 0) !== 0,
                    ...values(record, 40).length ? {
                        textHeight: number(record, 40)
                    } : {},
                    ...values(record, 41).length ? {
                        textWidth: number(record, 41)
                    } : {},
                    ...optionalPoint(record, 211, 221, 231) ? {
                        horizontalDirection: optionalPoint(record, 211, 221, 231)
                    } : {},
                    ...optionalPoint(record, 212, 222, 232) ? {
                        blockOffset: optionalPoint(record, 212, 222, 232)
                    } : {},
                    ...optionalPoint(record, 213, 223, 233) ? {
                        annotationOffset: optionalPoint(record, 213, 223, 233)
                    } : {}
                }
            };
        case 'DIMENSION':
            {
                const dxfDimensionType = number(record, 70, 0);
                const subtype = dxfDimensionType & 7;
                const incompleteAngularDefinition = [
                    2,
                    5
                ].includes(subtype) && (subtype === 2 ? [
                    10,
                    13,
                    14,
                    15,
                    16
                ] : [
                    10,
                    13,
                    14,
                    15
                ]).some((code)=>!optionalPoint(record, code, code + 10, code + 20));
                const definitionPoints = [
                    optionalPoint(record, 10, 20, 30),
                    optionalPoint(record, 13, 23, 33),
                    optionalPoint(record, 14, 24, 34),
                    optionalPoint(record, 15, 25, 35),
                    optionalPoint(record, 16, 26, 36)
                ].filter((value)=>Boolean(value));
                const styleName = first(record, 3, 'STANDARD');
                return {
                    type: 'DIMENSION',
                    payload: {
                        dimensionType: DIMENSION_TYPE_BY_CODE[dxfDimensionType & 7] ?? 'ROTATED',
                        ...incompleteAngularDefinition ? {
                            incompleteAngularDefinition: true
                        } : {},
                        ...readDimensionOverrides(record),
                        dxfDimensionType,
                        definitionPoints,
                        textPosition: optionalPoint(record, 11, 21, 31),
                        textOverride: first(record, 1),
                        styleName,
                        styleId: resources.dimensionStyleIds?.get(normalizeName(styleName)) ?? null,
                        blockName: first(record, 2),
                        measurement: values(record, 42).length ? number(record, 42) : null,
                        rotation: number(record, 50, 0) * Math.PI / 180,
                        rawTags: record.tags
                    }
                };
            }
        case 'SOLID':
            return {
                type: 'SOLID',
                payload: {
                    vertices: [
                        point(record),
                        point(record, 11, 21, 31),
                        point(record, 12, 22, 32),
                        point(record, 13, 23, 33)
                    ]
                }
            };
        case 'VIEWPORT':
            return {
                type: 'VIEWPORT',
                payload: {
                    center: point(record),
                    width: number(record, 40),
                    height: number(record, 41),
                    viewCenter: point(record, 12, 22, 32),
                    viewHeight: number(record, 45),
                    twistAngle: number(record, 51, 0) * Math.PI / 180,
                    viewTarget: optionalPoint(record, 17, 27, 37) ?? [
                        0,
                        0,
                        0
                    ],
                    viewDirection: optionalPoint(record, 16, 26, 36) ?? [
                        0,
                        0,
                        1
                    ],
                    status: number(record, 68, 0),
                    viewportId: number(record, 69, 2),
                    flags: number(record, 90, 0),
                    lensLength: number(record, 42, 50),
                    frontClipDistance: number(record, 43, 0),
                    backClipDistance: number(record, 44, 0),
                    rawTags: record.tags
                }
            };
        case 'WIPEOUT':
            {
                const position = point(record), u = point(record, 11, 21, 31), v = point(record, 12, 22, 32);
                const vertices = repeatedPoints(record, 14, 24, 34).map(([x, y])=>[
                        position[0] + u[0] * x + v[0] * y,
                        position[1] + u[1] * x + v[1] * y,
                        position[2] + u[2] * x + v[2] * y
                    ]);
                return {
                    type: 'WIPEOUT',
                    payload: {
                        vertices,
                        closed: true,
                        position,
                        uVector: u,
                        vVector: v,
                        rawTags: record.tags
                    }
                };
            }
        default:
            return {
                type: 'PROXY_ENTITY',
                payload: {
                    originalType: record.type,
                    rawTags: record.tags
                }
            };
    }
}
function entityDrawingProperties(record, resources) {
    const payload = {};
    for (const [code, key] of [
        [
            62,
            'color'
        ],
        [
            420,
            'trueColor'
        ],
        [
            48,
            'linetypeScale'
        ],
        [
            370,
            'lineweight'
        ],
        [
            39,
            'thickness'
        ]
    ]){
        if (values(record, code).length) payload[key] = number(record, code);
    }
    if (values(record, 60).length) payload.visible = number(record, 60) === 0;
    if (values(record, 6).length) {
        const name = first(record, 6, 'BYLAYER');
        payload.linetypeName = name;
        const id = resources.linetypeIds?.get(normalizeName(name));
        if (id) payload.linetypeId = id;
    }
    if ([
        210,
        220,
        230
    ].some((code)=>values(record, code).length)) payload.normal = [
        number(record, 210),
        number(record, 220),
        number(record, 230, 1)
    ];
    return payload;
}
function dxfVersion(tags) {
    const index = tags.findIndex((tag)=>tag.code === 9 && normalizeName(tag.value) === '$ACADVER');
    const code = index >= 0 ? tags.slice(index + 1).find((tag)=>tag.code === 1)?.value : null;
    return VERSION_BY_CODE[normalizeName(code)] ?? 'UNKNOWN';
}
function dxfCodePage(tags) {
    const index = tags.findIndex((tag)=>tag.code === 9 && normalizeName(tag.value) === '$DWGCODEPAGE');
    return index >= 0 ? String(tags.slice(index + 1).find((tag)=>tag.code === 3)?.value ?? 'UTF-8').trim() : 'UTF-8';
}
const DXF_UNIT_NAMES = [
    'unitless',
    'inch',
    'foot',
    'mile',
    'millimeter',
    'centimeter',
    'meter',
    'kilometer',
    'microinch',
    'mil',
    'yard',
    'angstrom',
    'nanometer',
    'micron',
    'decimeter',
    'decameter',
    'hectometer',
    'gigameter',
    'astronomical-unit',
    'light-year',
    'parsec',
    'us-survey-foot',
    'us-survey-inch',
    'us-survey-yard',
    'us-survey-mile'
];
const DXF_UNIT_ALIASES = {
    mm: 'millimeter',
    cm: 'centimeter',
    m: 'meter',
    km: 'kilometer',
    in: 'inch',
    inches: 'inch',
    ft: 'foot',
    feet: 'foot',
    yd: 'yard',
    millimeters: 'millimeter',
    millimetres: 'millimeter',
    millimetre: 'millimeter',
    meters: 'meter',
    metres: 'meter',
    metre: 'meter'
};
function dxfHeaderInteger(tags, name) {
    const header = section(tags, 'HEADER');
    const index = header.findIndex((tag)=>tag.code === 9 && normalizeName(tag.value) === name);
    if (index < 0) return undefined;
    const value = header[index + 1];
    if (!value || value.code !== 70 || !/^\s*\d+\s*$/.test(String(value.value))) throw new KJValidationError(`Invalid DXF ${name} header value`);
    return Number(value.value);
}
function dxfHeaderNumber(tags, name, fallback) {
    const header = section(tags, 'HEADER');
    const index = header.findIndex((tag)=>tag.code === 9 && normalizeName(tag.value) === name);
    if (index < 0) return fallback;
    const value = header[index + 1];
    if (!value || value.code !== 40 || !String(value.value).trim()) throw new KJValidationError(`Invalid DXF ${name} header value`);
    const result = Number(value.value);
    if (!Number.isFinite(result) || result <= 0) throw new KJValidationError(`Invalid DXF ${name} header value`);
    return result;
}
function dxfHeaderText(tags, name) {
    const header = section(tags, 'HEADER');
    const index = header.findIndex((tag)=>tag.code === 9 && normalizeName(tag.value) === name);
    if (index < 0) return undefined;
    const value = header[index + 1];
    if (!value || value.code !== 7 || !String(value.value).trim()) throw new KJValidationError(`Invalid DXF ${name} header value`);
    return String(value.value).trim();
}
function dxfDrawingUnits(tags) {
    const code = dxfHeaderInteger(tags, '$INSUNITS') ?? 0;
    const units = DXF_UNIT_NAMES[code];
    if (!units) throw new KJValidationError(`Unsupported DXF insertion unit code: ${code}`);
    const measurement = dxfHeaderInteger(tags, '$MEASUREMENT');
    if (measurement !== undefined && measurement !== 0 && measurement !== 1) throw new KJValidationError('Invalid DXF $MEASUREMENT value');
    return {
        units,
        measurement: measurement === 0 ? 'imperial' : 'metric'
    };
}
function dxfUnitCode(units) {
    const name = units.trim().toLowerCase();
    const code = DXF_UNIT_NAMES.indexOf(DXF_UNIT_ALIASES[name] ?? name);
    if (code < 0) throw new KJValidationError(`Cannot export unrecognized drawing units to DXF: ${units}`);
    return code;
}
function importResourceTables(transaction, tableRecords, document) {
    const linetypeIds = new Map(documentTableRecords(document, 'linetypes').map((record)=>[
            normalizeName(record.name),
            record.id
        ]));
    const textStyleIds = new Map(documentTableRecords(document, 'textStyles').map((record)=>[
            normalizeName(record.name),
            record.id
        ]));
    const dimensionStyleIds = new Map(documentTableRecords(document, 'dimensionStyles').map((record)=>[
            normalizeName(record.name),
            record.id
        ]));
    for (const record of tableRecords.filter((value)=>value.type === 'LTYPE')){
        const name = String(first(record, 2, 'CONTINUOUS')).trim() || 'CONTINUOUS';
        const imported = transaction.upsertTableRecord('linetypes', {
            name,
            type: 'LINETYPE',
            payload: {
                description: first(record, 3, ''),
                pattern: values(record, 49).map(Number),
                totalPatternLength: number(record, 40, 0),
                dxfFlags: number(record, 70, 0)
            }
        });
        linetypeIds.set(normalizeName(name), imported.id);
    }
    for (const record of tableRecords.filter((value)=>value.type === 'STYLE')){
        const name = String(first(record, 2, 'STANDARD')).trim() || 'STANDARD';
        const imported = transaction.upsertTableRecord('textStyles', {
            name,
            type: 'TEXT_STYLE',
            payload: {
                fontFamily: first(record, 3, 'sans-serif'),
                fontFile: first(record, 3, null),
                bigFontFile: first(record, 4, null),
                fixedHeight: number(record, 40, 0),
                widthFactor: number(record, 41, 1),
                obliqueAngle: number(record, 50, 0) * Math.PI / 180,
                dxfFlags: number(record, 70, 0),
                generationFlags: number(record, 71, 0)
            }
        });
        textStyleIds.set(normalizeName(name), imported.id);
    }
    for (const record of tableRecords.filter((value)=>value.type === 'DIMSTYLE')){
        const name = String(first(record, 2, 'STANDARD')).trim() || 'STANDARD';
        const imported = transaction.upsertTableRecord('dimensionStyles', {
            name,
            type: 'DIM_STYLE',
            payload: {
                overallScale: number(record, 40, 1),
                arrowSize: number(record, 41, 2.5),
                extensionOffset: number(record, 42, 0.625),
                baselineSpacing: number(record, 43, 3.75),
                extensionBeyond: number(record, 44, 1.25),
                rounding: number(record, 45, 0),
                textHeight: number(record, 140, 2.5),
                ...values(record, 271).length ? {
                    decimalPlaces: number(record, 271)
                } : {},
                ...values(record, 179).length ? {
                    angularDecimalPlaces: number(record, 179)
                } : {},
                ...values(record, 275).length ? {
                    angularUnits: number(record, 275)
                } : {},
                centerMarkSize: number(record, 141, 2.5),
                textGap: number(record, 147, 0.625),
                dxfFlags: number(record, 70, 0)
            }
        });
        dimensionStyleIds.set(normalizeName(name), imported.id);
    }
    for (const record of tableRecords.filter((value)=>value.type === 'UCS')){
        const name = String(first(record, 2, '')).trim();
        if (name) transaction.upsertTableRecord('ucs', {
            name,
            type: 'UCS',
            payload: {
                origin: point(record),
                xAxis: point(record, 11, 21, 31),
                yAxis: point(record, 12, 22, 32),
                dxfFlags: number(record, 70, 0)
            }
        });
    }
    for (const record of tableRecords.filter((value)=>value.type === 'VIEW')){
        const name = String(first(record, 2, '')).trim();
        if (name) transaction.upsertTableRecord('views', {
            name,
            type: 'VIEW',
            payload: {
                center: point(record),
                height: number(record, 40, 1),
                width: number(record, 41, 1),
                direction: point(record, 11, 21, 31),
                target: point(record, 12, 22, 32),
                twistAngle: number(record, 50, 0) * Math.PI / 180,
                viewMode: number(record, 71, 0),
                renderMode: number(record, 281, 0),
                ucsAssociated: number(record, 72, 0),
                dxfFlags: number(record, 70, 0)
            }
        });
    }
    return {
        linetypeIds,
        textStyleIds,
        dimensionStyleIds
    };
}
async function readDXF(source, options = {}) {
    const limits = readLimits(options);
    abortDXF(options);
    const tags = await tagsFromText(await sourceText(source, options), options);
    if (!section(tags, 'ENTITIES').length && !tags.some((tag)=>tag.code === 0 && normalizeName(tag.value) === 'SECTION')) throw new KJValidationError('DXF has no valid SECTION structure');
    const version = dxfVersion(tags);
    const currentTextStyleName = dxfHeaderText(tags, '$TEXTSTYLE');
    const document = KJDocument.create({
        sourceFormat: 'DXF',
        sourceVersion: version,
        codePage: dxfCodePage(tags),
        ...dxfDrawingUnits(tags),
        systemVariables: {
            LTSCALE: dxfHeaderNumber(tags, '$LTSCALE', 1)
        },
        title: 'Imported DXF'
    });
    await document.transact('Import ASCII DXF', async (transaction)=>{
        const tableRecords = records(section(tags, 'TABLES'));
        const resources = importResourceTables(transaction, tableRecords, document);
        if (currentTextStyleName) {
            const currentTextStyleId = resources.textStyleIds.get(normalizeName(currentTextStyleName));
            if (!currentTextStyleId) throw new KJValidationError(`DXF current text style does not exist: ${currentTextStyleName}`);
            transaction.setCurrentTableRecord('textStyles', currentTextStyleId);
        }
        const defaultLayerId = document.snapshot().tables.layers.currentId;
        if (!defaultLayerId) throw new KJValidationError('DXF import requires the default layer');
        const layerIds = new Map([
            [
                '0',
                defaultLayerId
            ]
        ]);
        const layerHandleIds = new Map();
        for (const record of tableRecords.filter((record)=>record.type === 'LAYER')){
            const name = String(first(record, 2, '0')).trim() || '0';
            const color = number(record, 62, 7);
            const linetypeName = first(record, 6, 'CONTINUOUS');
            const layer = transaction.upsertTableRecord('layers', {
                name,
                type: 'LAYER',
                payload: {
                    color: Math.abs(color),
                    linetypeName,
                    linetypeId: resources.linetypeIds.get(normalizeName(linetypeName)) ?? null,
                    lineweight: number(record, 370, -1),
                    visible: color >= 0,
                    frozen: (number(record, 70, 0) & 1) === 1,
                    locked: (number(record, 70, 0) & 4) === 4,
                    plottable: number(record, 290, 1) !== 0
                }
            });
            layerIds.set(normalizeName(name), layer.id);
            const sourceHandle = String(first(record, 5, '')).toUpperCase();
            if (sourceHandle) layerHandleIds.set(sourceHandle, layer.id);
        }
        const definitions = blockDefinitions(section(tags, 'BLOCKS'));
        const sourceEntityRecords = entityRecords(section(tags, 'ENTITIES'));
        const allSourceRecords = [
            ...sourceEntityRecords,
            ...definitions.flatMap((definition)=>definition.records)
        ].flatMap((record)=>[
                record,
                ...record.attributes ?? [],
                ...record.attributes && record.sequenceEnd ? [
                    record.sequenceEnd
                ] : []
            ]);
        if (allSourceRecords.length > limits.maxEntities) throw new KJValidationError(`DXF entity count exceeds the ${limits.maxEntities} read limit`);
        abortDXF(options);
        const importTotal = sourceEntityRecords.length + definitions.reduce((total, definition)=>total + definition.records.length, 0);
        let importCompleted = 0;
        const importCheckpoint = async ()=>{
            importCompleted += 1;
            if (importCompleted % 512 === 0) {
                reportDXF(options, 'import', importCompleted, 'entities', importTotal);
                await yieldDXF();
                abortDXF(options);
            }
        };
        reportDXF(options, 'import', 0, 'entities', importTotal);
        const blockNames = new Set([
            ...definitions.map((definition)=>normalizeName(definition.name)),
            ...allSourceRecords.filter((record)=>record.type === 'INSERT').map((record)=>normalizeName(first(record, 2))).filter(Boolean)
        ]);
        const blockIds = new Map();
        for (const block of documentTableRecords(document, 'blockRecords'))blockIds.set(normalizeName(block.name), block.id);
        for (const name of blockNames){
            if (isSpaceBlock(name)) continue;
            const definition = definitions.find((value)=>normalizeName(value.name) === name);
            const block = transaction.upsertTableRecord('blockRecords', {
                name: definition?.name ?? name,
                type: 'BLOCK_RECORD',
                payload: {
                    entityIds: [],
                    isSpace: name.startsWith('*MODEL_SPACE') || name.startsWith('*PAPER_SPACE'),
                    basePoint: definition?.basePoint ?? [
                        0,
                        0,
                        0
                    ],
                    dxfFlags: definition?.flags ?? 0,
                    importedPlaceholder: !definition
                }
            });
            blockIds.set(name, block.id);
        }
        const modelSpaceId = document.spaces.modelSpaceId;
        const paperSpaceIds = new Map();
        const defaultPaperLayoutId = document.spaces.layoutIds.find((id)=>document.getObject(id)?.name !== 'Model');
        const defaultPaperLayout = defaultPaperLayoutId ? document.getObject(defaultPaperLayoutId) : null;
        const sourceLayouts = records(section(tags, 'OBJECTS')).filter((record)=>record.type === 'LAYOUT').map((record)=>{
            const marker = record.tags.findIndex((tag)=>tag.code === 100 && tag.value === 'AcDbLayout');
            const layout = {
                ...record,
                tags: marker < 0 ? record.tags : record.tags.slice(marker + 1)
            };
            return {
                name: String(first(layout, 1) ?? '').trim(),
                handle: String(first(record, 5) ?? '').toUpperCase(),
                blockHandle: recordOwner(layout),
                order: number(layout, 71, 0),
                plotSettings: readPlotSettings(record),
                geometry: readLayoutGeometry(layout)
            };
        }).filter((layout)=>layout.name).sort((a, b)=>a.order - b.order);
        const layoutNames = new Set(), layoutOwners = new Set();
        for (const layout of sourceLayouts){
            const key = normalizeName(layout.name);
            if (layoutNames.has(key) || layout.blockHandle && layoutOwners.has(layout.blockHandle)) throw new KJValidationError('DXF contains duplicate layout names or block ownership');
            layoutNames.add(key);
            if (layout.blockHandle) layoutOwners.add(layout.blockHandle);
        }
        const ensurePaperSpace = (layoutName, order)=>{
            const key = normalizeName(layoutName);
            const existing = paperSpaceIds.get(key);
            if (existing) return existing;
            const layout = paperSpaceIds.size === 0 && defaultPaperLayout ? defaultPaperLayout : transaction.createLayout({
                name: layoutName
            });
            transaction.updateObject(layout.id, {
                name: layoutName,
                ...order === undefined ? {} : {
                    payload: {
                        tabOrder: order
                    }
                }
            });
            if (typeof layout.payload.blockRecordId !== 'string') throw new KJValidationError('DXF paper-space layout has no block record');
            paperSpaceIds.set(key, layout.payload.blockRecordId);
            return layout.payload.blockRecordId;
        };
        for (const layout of sourceLayouts)if (normalizeName(layout.name) !== 'MODEL') ensurePaperSpace(layout.name, layout.order);
        for (const layout of sourceLayouts){
            const id = transaction._draft().spaces.layoutIds.find((id)=>normalizeName(transaction.getObject(id)?.name) === normalizeName(layout.name));
            if (!id) throw new KJValidationError('DXF page configuration has no layout');
            transaction.updateObject(id, {
                payload: {
                    ...layout.plotSettings ? {
                        dxfPlotSettings: layout.plotSettings
                    } : {},
                    dxfLayoutGeometry: layout.geometry
                }
            });
        }
        const sourceLayoutByBlock = new Map(sourceLayouts.map((layout)=>[
                layout.blockHandle,
                layout.name
            ]));
        const sourceLayoutByHandle = new Map(sourceLayouts.map((layout)=>[
                layout.handle,
                layout.name
            ]));
        const ownerSpaces = new Map();
        for (const layout of sourceLayouts)if (layout.blockHandle) ownerSpaces.set(layout.blockHandle, normalizeName(layout.name) === 'MODEL' ? modelSpaceId : paperSpaceIds.get(normalizeName(layout.name)));
        for (const record of tableRecords.filter((record)=>record.type === 'BLOCK_RECORD')){
            const name = normalizeName(first(record, 2)), handle = String(first(record, 5) ?? '').toUpperCase();
            const layoutName = sourceLayoutByBlock.get(handle) ?? sourceLayoutByHandle.get(String(first(record, 340) ?? '').toUpperCase());
            const hint = sourceEntityRecords.find((entity)=>recordOwner(entity) === handle && first(entity, 410));
            const ownerId = isSpaceBlock(name) && name.includes('MODEL_SPACE') ? modelSpaceId : layoutName ? ensurePaperSpace(layoutName) : isSpaceBlock(name) ? ensurePaperSpace(String(hint ? first(hint, 410) : name.replace(/^[*$]PAPER_SPACE/, 'Layout') || 'Layout1').replace(/^Layout$/, 'Layout1')) : blockIds.get(name);
            if (ownerId) {
                blockIds.set(name, ownerId);
                ownerSpaces.set(handle, ownerId);
            }
        }
        for (const definition of definitions)if (isSpaceBlock(definition.name)) {
            const name = normalizeName(definition.name), handle = recordOwner(definition.header);
            const ownerId = ownerSpaces.get(handle) ?? blockIds.get(name) ?? (name.includes('MODEL_SPACE') ? modelSpaceId : ensurePaperSpace(name.replace(/^[*$]PAPER_SPACE/, 'Layout').replace(/^Layout$/, 'Layout1')));
            blockIds.set(name, ownerId);
            if (handle) ownerSpaces.set(handle, ownerId);
        }
        for (const record of sourceEntityRecords)if (first(record, 410) && normalizeName(first(record, 410)) !== 'MODEL' && !ownerSpaces.has(recordOwner(record))) ensurePaperSpace(String(first(record, 410)));
        const occupiedHandles = new Set(Object.values(transaction._draft().objects).map((object)=>object.handle));
        const entityHandleIds = new Map();
        const viewportReferences = [];
        const leaderReferences = [];
        const dimensionReferences = [];
        const importRecord = (record, index, ownerId, scope, parentInsertId)=>{
            const layerName = normalizeName(first(record, 8, '0'));
            const layerId = layerIds.get(layerName) ?? defaultLayerId;
            const converted = entityPayload(record, blockIds, resources);
            const dimensionAssociations = record.type === 'DIMENSION' ? readDimensionAssociationHandles(record) : null;
            const sourceHandle = String(first(record, 5, '')).toUpperCase();
            const handleAvailable = /^[0-9A-F]+$/.test(sourceHandle) && !occupiedHandles.has(sourceHandle);
            let created;
            try {
                created = transaction.createEntity(converted.type, {
                    ...converted.payload,
                    ...entityDrawingProperties(record, resources),
                    layerId,
                    ...parentInsertId ? {
                        parentInsertId
                    } : {}
                }, {
                    ...ownerId === undefined ? {} : {
                        ownerId
                    },
                    ...handleAvailable ? {
                        handle: sourceHandle
                    } : {},
                    source: {
                        format: 'DXF',
                        scope,
                        entityIndex: index,
                        originalHandle: sourceHandle || null
                    }
                });
                occupiedHandles.add(created.handle);
                if (sourceHandle) entityHandleIds.set(sourceHandle, entityHandleIds.has(sourceHandle) ? '' : created.id);
                if (created.type === 'VIEWPORT') viewportReferences.push({
                    id: created.id,
                    record
                });
                if (created.type === 'DIMENSION' && dimensionAssociations) dimensionReferences.push({
                    id: created.id,
                    associations: dimensionAssociations
                });
                if (created.type === 'LEADER' && converted.payload.annotationHandle) leaderReferences.push({
                    id: created.id,
                    annotationHandle: String(converted.payload.annotationHandle).toUpperCase()
                });
            } catch (error) {
                if (record.attributes || parentInsertId) throw error;
                created = transaction.createEntity('PROXY_ENTITY', {
                    originalType: record.type,
                    rawTags: record.tags,
                    importError: error instanceof Error ? error.message : String(error),
                    layerId
                }, {
                    ...ownerId === undefined ? {} : {
                        ownerId
                    },
                    source: {
                        format: 'DXF',
                        scope,
                        entityIndex: index,
                        originalHandle: sourceHandle || null
                    }
                });
                occupiedHandles.add(created.handle);
                if (sourceHandle) entityHandleIds.set(sourceHandle, entityHandleIds.has(sourceHandle) ? '' : created.id);
            }
            if (record.attributes && record.sequenceEnd) {
                const attributes = record.attributes.map((attribute, childIndex)=>importRecord(attribute, childIndex, ownerId, `${scope}:attributes`, created.id));
                const end = record.sequenceEnd, sourceEndHandle = String(first(end, 5, '')).toUpperCase();
                const endHandleAvailable = /^[0-9A-F]+$/.test(sourceEndHandle) && !occupiedHandles.has(sourceEndHandle);
                const sequenceEnd = transaction.createObject({
                    kind: 'custom',
                    type: 'SEQEND',
                    ownerId: created.id,
                    ...endHandleAvailable ? {
                        handle: sourceEndHandle
                    } : {},
                    payload: {
                        layerId: layerIds.get(normalizeName(first(end, 8, '0'))) ?? defaultLayerId,
                        dxfOwnerMode: recordOwner(end) && recordOwner(end) === recordOwner(record) ? 'space' : 'insert'
                    },
                    source: {
                        format: 'DXF',
                        scope: `${scope}:attributes`,
                        originalHandle: sourceEndHandle || null
                    }
                });
                occupiedHandles.add(sequenceEnd.handle);
                created = transaction.updateObject(created.id, {
                    payload: {
                        attributeIds: attributes.map((attribute)=>attribute.id),
                        sequenceEndId: sequenceEnd.id
                    }
                });
            }
            return created;
        };
        const importedSpaceHandles = new Map();
        const importSpaceRecord = (record, index, ownerId, scope)=>{
            const handle = String(first(record, 5) ?? '').toUpperCase();
            if (handle) {
                const previous = importedSpaceHandles.get(handle), serialized = JSON.stringify(record);
                if (previous && previous.scope !== scope) {
                    if (previous.ownerId === ownerId && previous.record === serialized) return;
                    throw new KJValidationError('DXF contains conflicting duplicate space entity handles');
                }
                importedSpaceHandles.set(handle, {
                    ownerId,
                    record: serialized,
                    scope
                });
            }
            importRecord(record, index, ownerId, scope);
        };
        for (const definition of definitions){
            const ownerId = blockIds.get(normalizeName(definition.name));
            for(let index = 0; index < definition.records.length; index += 1){
                const record = definition.records[index];
                if (isSpaceBlock(definition.name)) importSpaceRecord(record, index, ownerId, `block:${definition.name}`);
                else importRecord(record, index, ownerId, `block:${definition.name}`);
                await importCheckpoint();
            }
        }
        for(let index = 0; index < sourceEntityRecords.length; index += 1){
            const record = sourceEntityRecords[index];
            const layoutName = String(first(record, 410, 'Layout1')).trim() || 'Layout1';
            const paperSpace = number(record, 67, 0) === 1 || first(record, 410) && normalizeName(first(record, 410)) !== 'MODEL';
            const fallbackPaperSpaceId = typeof defaultPaperLayout?.payload.blockRecordId === 'string' ? defaultPaperLayout.payload.blockRecordId : modelSpaceId;
            const sourceOwner = recordOwner(record);
            if (sourceOwner && !ownerSpaces.has(sourceOwner) && !first(record, 410) && !values(record, 67).length) throw new KJValidationError('DXF entity references an unknown owner without a space hint');
            const ownerId = ownerSpaces.get(sourceOwner) ?? (paperSpace ? paperSpaceIds.get(normalizeName(layoutName)) ?? fallbackPaperSpaceId : modelSpaceId);
            importSpaceRecord(record, index, ownerId, paperSpace ? `paper-space:${layoutName}` : 'model-space');
            await importCheckpoint();
        }
        for (const { id, associations } of dimensionReferences){
            const resolved = associations.map(({ entityHandle, ...association })=>{
                const entityId = entityHandleIds.get(entityHandle);
                if (!entityId) throw new KJValidationError(`DXF DIMENSION association references an unavailable or duplicate handle: ${entityHandle}`);
                return {
                    ...association,
                    entityId
                };
            });
            transaction.updateObject(id, {
                payload: {
                    dimensionAssociations: resolved
                }
            });
        }
        for (const { id, annotationHandle } of leaderReferences){
            const annotationId = entityHandleIds.get(annotationHandle), annotation = annotationId ? transaction.getObject(annotationId) : null;
            if (!annotation || annotation.kind !== 'entity' || annotation.type !== 'MTEXT') {
                transaction.updateObject(id, {
                    payload: {
                        unresolvedLeaderAnnotation: annotationHandle
                    }
                });
                continue;
            }
            const leader = transaction.getObject(id);
            if (leader.ownerId !== annotation.ownerId) {
                transaction.updateObject(id, {
                    payload: {
                        unresolvedLeaderAnnotation: `${annotationHandle}:wrong-owner`
                    }
                });
                continue;
            }
            transaction.updateObject(id, {
                payload: {
                    annotationId: annotation.id,
                    annotationHandle: null,
                    textPosition: annotation.payload.position
                }
            });
        }
        for (const { id, record } of viewportReferences){
            const unresolved = [], frozenLayerIds = [];
            for (const handle of values(record, 331).map((value)=>String(value).toUpperCase())){
                const layerId = layerHandleIds.get(handle);
                if (!layerId) unresolved.push(`frozen-layer:${handle}`);
                else if (!frozenLayerIds.includes(layerId)) frozenLayerIds.push(layerId);
            }
            const clipHandle = String(first(record, 340, '')).toUpperCase();
            let clippingBoundaryId = null;
            if (clipHandle && clipHandle !== '0') {
                clippingBoundaryId = entityHandleIds.get(clipHandle) || null;
                if (!clippingBoundaryId) unresolved.push(`clipping-boundary:${clipHandle}`);
            }
            const current = transaction._draft().objects[id];
            if (clippingBoundaryId && transaction._draft().objects[clippingBoundaryId]?.ownerId !== current.ownerId) unresolved.push('clipping-boundary:wrong-owner');
            transaction.updateObject(id, {
                payload: {
                    frozenLayerIds,
                    clippingBoundaryId,
                    ...unresolved.length ? {
                        unresolvedViewportReferences: unresolved
                    } : {}
                }
            });
        }
        reportDXF(options, 'import', importCompleted, 'entities', importTotal);
    }, {
        source: 'adapter:dxf-ascii'
    });
    return document;
}
function decodeDxfTextSymbols(text) {
    return text.replace(/%%([cdp])/gi, (_, code)=>({
            c: 'Ø',
            d: '°',
            p: '±'
        })[code.toLowerCase()]);
}
function readDxfText(record) {
    const dxfText = String(first(record, 1, '')), text = decodeDxfTextSymbols(dxfText);
    return text === dxfText ? {
        text
    } : {
        text,
        dxfText
    };
}
function recordSubclass(record, name) {
    const start = record.tags.findIndex((tag)=>tag.code === 100 && tag.value === name);
    if (start < 0) return record;
    const next = record.tags.findIndex((tag, index)=>index > start && tag.code === 100);
    return {
        type: record.type,
        tags: record.tags.slice(start + 1, next < 0 ? undefined : next)
    };
}
function readSingleLineText(source, resources) {
    const record = recordSubclass(source, 'AcDbText');
    const alignmentPoint = optionalPoint(record, 11, 21, 31);
    return {
        position: point(record),
        ...alignmentPoint ? {
            alignmentPoint
        } : {},
        ...readDxfText(record),
        height: number(record, 40, 2.5),
        rotation: number(record, 50) * Math.PI / 180,
        horizontalAlignment: number(record, 72),
        ...values(record, 41).length ? {
            widthFactor: number(record, 41)
        } : {},
        ...values(record, 51).length ? {
            obliqueAngle: number(record, 51) * Math.PI / 180
        } : {},
        ...values(record, 71).length ? {
            generationFlags: number(record, 71)
        } : {},
        styleId: resources.textStyleIds?.get(normalizeName(first(record, 7, 'STANDARD'))) ?? null
    };
}
function writeDxfText(payload) {
    return typeof payload.dxfText === 'string' && decodeDxfTextSymbols(payload.dxfText) === payload.text ? payload.dxfText : payload.text;
}
function emit(output, code, value) {
    output.push(String(code), String(value));
}
function emitPoint(output, pointValue, base = 10) {
    emit(output, base, pointValue[0]);
    emit(output, base + 10, pointValue[1]);
    emit(output, base + 20, pointValue[2] ?? 0);
}
function isSubclassDXF(version) {
    return version !== 'R12';
}
function createHandleAllocator(handles) {
    let next = handles.reduce((maximum, handle)=>{
        if (!/^[0-9A-F]+$/i.test(handle)) return maximum;
        const numeric = BigInt(`0x${handle}`);
        return numeric > maximum ? numeric : maximum;
    }, 0n) + 1n;
    return ()=>{
        const handle = next.toString(16).toUpperCase();
        next += 1n;
        return handle;
    };
}
const NATIVE_DIMENSION_SUBTYPES = new Set([
    0,
    1,
    2,
    3,
    4,
    5
]);
function nativeDimensionCode(payload) {
    const namedType = normalizeName(payload.dimensionType);
    const mapped = namedType === 'LINEAR' ? 0 : DIMENSION_CODE_BY_TYPE[namedType];
    const value = payload.dxfDimensionType == null ? mapped : Number(payload.dxfDimensionType);
    if (!Number.isInteger(value) || value < 0 || !NATIVE_DIMENSION_SUBTYPES.has(value & 7)) {
        throw new KJValidationError(`DXF export requires a valid ALIGNED, ROTATED, ANGULAR, ANGULAR_3_POINT, RADIUS, or DIAMETER dimension; received ${payload.dimensionType ?? payload.dxfDimensionType ?? 'unknown'}`);
    }
    return value;
}
function assertNativeDimensionIsXY(payload, handle) {
    const points = [
        ...payload.definitionPoints ?? [],
        ...payload.textPosition ? [
            payload.textPosition
        ] : []
    ];
    if (points.some((value)=>Math.abs(Number(value[2] ?? 0)) > 1e-12)) {
        throw new KJValidationError(`DXF native dimension ${handle} is outside the supported XY plane`);
    }
    for (const key of [
        'normal',
        'extrusionDirection'
    ]){
        const value = payload[key];
        if (!Array.isArray(value)) continue;
        const normal = [
            Number(value[0] ?? 0),
            Number(value[1] ?? 0),
            Number(value[2] ?? 1)
        ];
        if (!normal.every(Number.isFinite) || Math.abs(normal[0]) > 1e-12 || Math.abs(normal[1]) > 1e-12 || Math.abs(normal[2] - 1) > 1e-12) {
            throw new KJValidationError(`DXF native dimension ${handle} uses an unsupported tilted OCS`);
        }
    }
}
function pointsMatch(firstValue, secondValue) {
    if (!firstValue || !secondValue) return firstValue == null && secondValue == null;
    return [
        0,
        1,
        2
    ].every((index)=>Math.abs(Number(firstValue[index] ?? 0) - Number(secondValue[index] ?? 0)) <= 1e-9);
}
function dimensionRawTagsMatchPayload(payload, dimensionStyles) {
    if (!payload.rawTags?.length) return false;
    const raw = entityPayload({
        type: 'DIMENSION',
        tags: [
            ...payload.rawTags
        ]
    }, new Map()).payload;
    const points = payload.definitionPoints ?? [];
    const rawPoints = raw.definitionPoints ?? [];
    if (points.length !== rawPoints.length || points.some((value, index)=>!pointsMatch(value, rawPoints[index]))) return false;
    if (!pointsMatch(payload.textPosition, raw.textPosition)) return false;
    const angleDelta = Math.atan2(Math.sin(Number(payload.rotation ?? 0) - Number(raw.rotation ?? 0)), Math.cos(Number(payload.rotation ?? 0) - Number(raw.rotation ?? 0)));
    if (Math.abs(angleDelta) > 1e-9) return false;
    const currentStyleName = (payload.styleId ? dimensionStyles.find((record)=>record.id === payload.styleId)?.name : undefined) ?? payload.styleName ?? 'STANDARD';
    if (normalizeName(currentStyleName) !== normalizeName(raw.styleName ?? 'STANDARD')) return false;
    if ((payload.textOverride ?? null) !== (raw.textOverride ?? null)) return false;
    if ((payload.angularUnits ?? null) !== (raw.angularUnits ?? null) || (payload.linearPrecision ?? null) !== (raw.linearPrecision ?? null)) return false;
    if ([
        'textHeight',
        'precision',
        'overallScale',
        'arrowSize',
        'extensionOffset',
        'extensionBeyond'
    ].some((key)=>(payload[key] ?? null) !== (raw[key] ?? null))) return false;
    if (normalizeName(payload.blockName) !== normalizeName(raw.blockName)) return false;
    if (Number(payload.dxfDimensionType ?? DIMENSION_CODE_BY_TYPE[normalizeName(payload.dimensionType)] ?? 0) !== Number(raw.dxfDimensionType ?? 0)) return false;
    return true;
}
function assertAngularPictureSector(document, block, payload, style) {
    const raw = entityPayload({
        type: 'DIMENSION',
        tags: [
            ...payload.rawTags
        ]
    }, new Map()).payload;
    const original = projectDimension(raw, style), expected = original?.arcs[0];
    const fail = ()=>{
        throw new KJValidationError('Cannot regenerate imported angular DIMENSION: original picture and definition sector are inconsistent or ambiguous');
    };
    if (!expected) return fail();
    const turn = Math.PI * 2, positive = (angle)=>(angle % turn + turn) % turn;
    const candidates = document.listEntities({
        ownerId: block.id
    }).filter((entity)=>{
        const p = entity.payload;
        return entity.type === 'ARC' && Array.isArray(p.center) && Math.hypot(Number(p.center[0]) - expected.center[0], Number(p.center[1]) - expected.center[1]) <= 1e-7 * Math.max(1, expected.radius) && Math.abs(Number(p.radius) - expected.radius) <= 1e-7 * Math.max(1, expected.radius);
    });
    if (!candidates.length) return fail();
    const originalStyle = resolveDimensionAnnotationStyle(raw, style);
    const margin = Math.min(.25, Math.max(1e-8, originalStyle.arrowSize * originalStyle.overallScale / expected.radius * 1.5));
    const span = expected.endAngle - expected.startAngle;
    for (const entity of candidates){
        const p = entity.payload, start = Number(p.startAngle), end = Number(p.endAngle);
        const sweep = positive(end - start), offset = positive(start - expected.startAngle + margin);
        if (![
            start,
            end,
            sweep,
            offset
        ].every(Number.isFinite) || sweep < 1e-12 || offset + sweep > span + 2 * margin + 1e-8) return fail();
    }
}
function angularExportPoints(payload, projection, subtype) {
    if (subtype !== 2 && subtype !== 5) return undefined;
    const p = payload.definitionPoints, arc = projection.arcs[0], direction = [
        Math.cos(arc.startAngle),
        Math.sin(arc.startAngle)
    ];
    if (subtype === 5) {
        const ray = [
            p[1][0] - p[3][0],
            p[1][1] - p[3][1]
        ], norm = Math.hypot(...ray);
        return (ray[0] * direction[0] + ray[1] * direction[1]) / norm > 1 - 1e-9 ? p : [
            p[0],
            p[2],
            p[1],
            ...p.slice(3)
        ];
    }
    let first = [
        p[1],
        p[2]
    ], second = [
        p[3],
        p[0]
    ];
    const aligned = (line, angle)=>{
        const d = [
            line[1][0] - line[0][0],
            line[1][1] - line[0][1]
        ];
        return (d[0] * Math.cos(angle) + d[1] * Math.sin(angle)) / Math.hypot(...d);
    };
    if (Math.abs(aligned(first, arc.startAngle)) < 1 - 1e-9) [first, second] = [
        second,
        first
    ];
    if (aligned(first, arc.startAngle) < 0) first = [
        first[1],
        first[0]
    ];
    if (aligned(second, arc.endAngle) < 0) second = [
        second[1],
        second[0]
    ];
    return [
        second[1],
        first[0],
        first[1],
        second[0],
        p[4]
    ];
}
function buildDimensionExportBlocks(document, entities, sourceBlocks, dimensionStyles, context) {
    const sourceBlocksByName = new Map(sourceBlocks.map((block)=>[
            normalizeName(block.name),
            block
        ]));
    const populatedSourceBlocks = new Set(sourceBlocks.filter((block)=>!block.payload?.isSpace && !block.payload?.importedPlaceholder && document.listEntities({
            ownerId: block.id
        }).length > 0).map((block)=>block.id));
    const usedNames = new Set(sourceBlocks.map((block)=>normalizeName(block.name)));
    const dimensions = new Map();
    const blocks = [];
    let sequence = 1;
    const allocateName = ()=>{
        while(usedNames.has(normalizeName(`*D${sequence}`)))sequence += 1;
        const name = `*D${sequence}`;
        sequence += 1;
        usedNames.add(normalizeName(name));
        return name;
    };
    for (const entity of entities){
        if (entity.type !== 'DIMENSION') continue;
        const payload = entity.payload ?? {};
        if (VERSION_RANK[context.version] < VERSION_RANK['2000'] && payload.precision != null) throw new KJValidationError('Explicit dimension precision requires DXF 2000 or newer');
        const referencedBlock = payload.blockName ? sourceBlocksByName.get(normalizeName(payload.blockName)) : undefined;
        if (payload.rawTags?.length && referencedBlock && populatedSourceBlocks.has(referencedBlock.id) && dimensionRawTagsMatchPayload(payload, dimensionStyles)) {
            dimensions.set(entity.handle, {
                blockName: referencedBlock.name,
                preserveRaw: true
            });
            continue;
        }
        const dimensionCode = nativeDimensionCode(payload);
        const subtype = dimensionCode & 7;
        const dimensionType = DIMENSION_TYPE_BY_CODE[subtype];
        assertNativeDimensionIsXY(payload, entity.handle);
        const style = (payload.styleId ? dimensionStyles.find((record)=>record.id === payload.styleId) : undefined)?.payload ?? {};
        if (VERSION_RANK[context.version] < VERSION_RANK['2000'] && (payload.precision != null || style.decimalPlaces != null)) throw new KJValidationError('Explicit dimension precision requires DXF 2000 or newer');
        if ([
            2,
            5
        ].includes(subtype) && Number(payload.angularUnits ?? style.angularUnits ?? 0) !== 0) throw new KJValidationError('Angular DIMENSION regeneration currently supports decimal degrees only');
        const angularPrecision = Number(style.angularDecimalPlaces) >= 0 ? style.angularDecimalPlaces : style.decimalPlaces;
        const precision = [
            2,
            5
        ].includes(subtype) ? Number(payload.precision) === -1 ? payload.linearPrecision ?? style.decimalPlaces : payload.precision ?? angularPrecision : payload.precision ?? style.decimalPlaces;
        const projection = projectDimension({
            ...payload,
            dimensionType
        }, style);
        if (!projection) throw new KJValidationError(`DXF ${dimensionType} dimension ${entity.handle} has incomplete, non-finite, or degenerate definition points`);
        if ([
            2,
            5
        ].includes(subtype) && payload.rawTags?.length && referencedBlock && populatedSourceBlocks.has(referencedBlock.id)) assertAngularPictureSector(document, referencedBlock, payload, style);
        let pictureText = projection.label.text;
        if (subtype === 3) {
            const measured = projectDimension({
                ...payload,
                dimensionType,
                textOverride: null
            }, style).label.text;
            const encoded = `%%c${measured.slice(1)}`;
            pictureText = payload.textOverride == null || payload.textOverride === '' ? encoded : String(payload.textOverride).replaceAll('<>', encoded);
        }
        const blockName = allocateName();
        const blockHandle = context.allocateHandle();
        const geometry = [
            ...projection.lines.map(([start, end])=>({
                    type: 'LINE',
                    handle: context.allocateHandle(),
                    payload: {
                        start: [
                            start[0],
                            start[1],
                            0
                        ],
                        end: [
                            end[0],
                            end[1],
                            0
                        ]
                    }
                })),
            ...projection.arcs.map((arc)=>({
                    type: 'ARC',
                    handle: context.allocateHandle(),
                    payload: {
                        center: [
                            arc.center[0],
                            arc.center[1],
                            0
                        ],
                        radius: arc.radius,
                        startAngle: arc.startAngle,
                        endAngle: arc.endAngle
                    }
                })),
            ...projection.arrows.map(([tip, rearA, rearB])=>({
                    type: 'SOLID',
                    handle: context.allocateHandle(),
                    payload: {
                        vertices: [
                            [
                                tip[0],
                                tip[1],
                                0
                            ],
                            [
                                rearA[0],
                                rearA[1],
                                0
                            ],
                            [
                                rearB[0],
                                rearB[1],
                                0
                            ],
                            [
                                rearB[0],
                                rearB[1],
                                0
                            ]
                        ]
                    }
                })),
            {
                type: 'TEXT',
                handle: context.allocateHandle(),
                payload: {
                    position: [
                        projection.label.position[0],
                        projection.label.position[1],
                        0
                    ],
                    text: pictureText,
                    height: projection.label.height,
                    rotation: projection.label.rotation,
                    alignmentPoint: [
                        projection.label.position[0],
                        projection.label.position[1],
                        0
                    ],
                    horizontalAlignment: 1,
                    verticalAlignment: 1
                }
            }
        ];
        const record = {
            id: `dxf-export-dimension-${blockHandle}`,
            name: blockName,
            type: 'BLOCK_RECORD',
            handle: blockHandle,
            payload: {
                dxfFlags: 1,
                basePoint: [
                    0,
                    0,
                    0
                ],
                isSpace: false
            }
        };
        blocks.push({
            record,
            entities: geometry
        });
        dimensions.set(entity.handle, {
            blockName,
            preserveRaw: false,
            measurement: projection.measurement,
            ...[
                2,
                5
            ].includes(subtype) ? {
                definitionPoints: angularExportPoints(payload, projection, subtype)
            } : {},
            ...resolveDimensionAnnotationStyle(payload, style),
            precision: Math.max(0, Math.min(8, Math.trunc(Number.isFinite(Number(precision)) && precision != null ? Number(precision) : 2))),
            textPosition: [
                projection.label.position[0],
                projection.label.position[1],
                0
            ]
        });
    }
    return {
        blocks,
        dimensions
    };
}
function emitSubclass(output, version, name) {
    if (isSubclassDXF(version)) emit(output, 100, name);
}
function emitEntityHeader(output, type, handle, layerName, ownerHandle, space, version, payload, linetypeNames) {
    emit(output, 0, type);
    emit(output, 5, handle);
    if (isSubclassDXF(version) && ownerHandle) emit(output, 330, ownerHandle);
    emitSubclass(output, version, 'AcDbEntity');
    emit(output, 8, layerName);
    emitSpaceOwnership(output, space, version);
    if (payload) emitEntityDrawingProperties(output, payload, version, linetypeNames);
}
function emitEntityDrawingProperties(output, payload, version, linetypeNames) {
    if (payload.color != null) {
        const text = String(payload.color).toUpperCase();
        const color = text === 'BYLAYER' ? 256 : text === 'BYBLOCK' ? 0 : Number(payload.color);
        if (!Number.isInteger(color) || color < -256 || color > 256) throw new KJValidationError('DXF entity color must be an ACI index, BYLAYER or BYBLOCK; use trueColor for RGB');
        emit(output, 62, color);
    }
    if (payload.trueColor != null) {
        if (!Number.isInteger(payload.trueColor) || payload.trueColor < 0 || payload.trueColor > 0xffffff) throw new KJValidationError('DXF trueColor must be a 24-bit RGB integer');
        if (VERSION_RANK[version] < VERSION_RANK['2004']) throw new KJValidationError(`DXF ${version} cannot preserve entity trueColor; minimum target is 2004`);
        emit(output, 420, payload.trueColor);
    }
    if (payload.linetypeId != null || payload.linetypeName != null) {
        const name = payload.linetypeId == null ? payload.linetypeName : linetypeNames?.get(payload.linetypeId);
        if (!name) throw new KJValidationError(`DXF entity references an unavailable linetype: ${payload.linetypeId}`);
        emit(output, 6, name);
    }
    if (payload.linetypeScale != null) {
        if (!Number.isFinite(payload.linetypeScale) || payload.linetypeScale <= 0) throw new KJValidationError('DXF entity linetypeScale must be positive and finite');
        emit(output, 48, payload.linetypeScale);
    }
    if (payload.lineweight != null) {
        if (!Number.isInteger(payload.lineweight)) throw new KJValidationError('DXF entity lineweight must be an integer');
        if (VERSION_RANK[version] < VERSION_RANK['2000']) {
            if (payload.lineweight !== -1) throw new KJValidationError(`DXF ${version} cannot preserve entity lineweight; minimum target is 2000`);
        } else emit(output, 370, payload.lineweight);
    }
    if (payload.visible != null) emit(output, 60, payload.visible ? 0 : 1);
}
function emitEntityExtrusion(output, payload) {
    if (payload.thickness != null) {
        if (!Number.isFinite(payload.thickness)) throw new KJValidationError('DXF entity thickness must be finite');
        emit(output, 39, payload.thickness);
    }
    if (payload.normal != null) {
        if (!payload.normal.every(Number.isFinite)) throw new KJValidationError('DXF entity normal must be finite');
        emitPoint(output, payload.normal, 210);
    }
}
function emitLegacyPolyline(output, entity, layerName, ownerHandle, space, context) {
    const { version } = context;
    const p = entity.payload ?? {};
    emitEntityHeader(output, 'POLYLINE', entity.handle, layerName, ownerHandle, space, version, p, context.linetypeNames);
    emitSubclass(output, version, 'AcDb2dPolyline');
    emitPoint(output, [
        0,
        0,
        p.elevation ?? 0
    ]);
    emit(output, 70, Number(p.dxfFlags ?? 0) & ~1 | (p.closed ? 1 : 0));
    emitEntityExtrusion(output, p);
    for (const vertex of p.vertices ?? []){
        const pointValue = vertexPoint(vertex);
        const details = Array.isArray(vertex) ? null : vertex;
        emitEntityHeader(output, 'VERTEX', context.allocateHandle(), layerName, ownerHandle, space, version);
        emitSubclass(output, version, 'AcDbVertex');
        emitSubclass(output, version, 'AcDb2dVertex');
        emitPoint(output, pointValue);
        if (details?.startWidth) emit(output, 40, details.startWidth);
        if (details?.endWidth) emit(output, 41, details.endWidth);
        if (details?.bulge) emit(output, 42, details.bulge);
        if (details?.dxfFlags) emit(output, 70, details.dxfFlags);
    }
    emitEntityHeader(output, 'SEQEND', context.allocateHandle(), layerName, ownerHandle, space, version);
}
function emitSpaceOwnership(output, space, version) {
    if (!space?.paper) return;
    emit(output, 67, 1);
    if (VERSION_RANK[version] >= VERSION_RANK['2000']) emit(output, 410, space.layoutName ?? 'Layout1');
}
function nativeHatchPatternLines(payload) {
    return hatchPatternLines(payload).map((line)=>({
            angleDegrees: (line.angle * 180 / Math.PI % 360 + 360) % 360,
            base: line.base,
            offset: line.offset,
            dashes: line.dashes
        }));
}
function hasUnchangedHatchGeometry(payload) {
    if (!payload.rawTags?.length) return false;
    const imported = entityPayload({
        type: 'HATCH',
        tags: [
            ...payload.rawTags
        ]
    }, new Map()).payload;
    const normalized = normalizeStandardEntityPayload('HATCH', imported);
    const state = (value)=>JSON.stringify([
            normalizeName(value.patternName),
            Boolean(value.solid),
            Boolean(value.associative),
            Number(value.patternScale ?? 1),
            Number(value.patternAngle ?? 0),
            value.boundaryLoops,
            value.patternLines,
            value.patternDefinitionAngle,
            value.patternDefinitionScale
        ]);
    return state(payload) === state(normalized);
}
function emitHatch(output, entity, layerName, ownerHandle, space, context) {
    const { version } = context;
    const p = entity.payload ?? {};
    if (hasUnchangedHatchGeometry(p)) {
        const properties = {
            ...entityDrawingProperties({
                type: 'HATCH',
                tags: [
                    ...p.rawTags
                ]
            }, {}),
            ...p
        };
        emitEntityHeader(output, 'HATCH', entity.handle, layerName, ownerHandle, space, version, properties, context.linetypeNames);
        emitSubclass(output, version, 'AcDbHatch');
        for (const tag of p.rawTags){
            if ([
                5,
                6,
                8,
                48,
                60,
                62,
                67,
                330,
                370,
                410,
                420
            ].includes(tag.code) || tag.code === 100) continue;
            else emit(output, tag.code, tag.value);
        }
        return;
    }
    if (p.rawTags?.length) {
        const record = {
            type: 'HATCH',
            tags: [
                ...p.rawTags
            ]
        };
        if (number(record, 30) !== 0 || number(record, 210) !== 0 || number(record, 220) !== 0 || number(record, 230, 1) !== 1) {
            throw new KJValidationError('Edited non-planar DXF HATCH geometry requires an OCS-aware adapter');
        }
    }
    const requireXY = (value)=>{
        if (value.some((component)=>!Number.isFinite(component)) || (value[2] ?? 0) !== 0) throw new KJValidationError('Native DXF HATCH geometry must use finite XY points at Z=0');
    };
    for (const loop of p.boundaryLoops ?? []){
        for (const vertex of loop.vertices ?? [])requireXY(vertexPoint(vertex));
        for (const edge of loop.edges ?? []){
            if (edge.type === 'LINE') {
                requireXY(edge.start);
                requireXY(edge.end);
            } else if (edge.type === 'ARC') {
                requireXY(edge.center);
                if (!Number.isFinite(edge.radius) || edge.radius <= 0 || !Number.isFinite(edge.startAngle) || !Number.isFinite(edge.endAngle)) throw new KJValidationError('Native DXF HATCH arc edges require a positive radius and finite angles');
            } else if (edge.type === 'ELLIPSE') {
                requireXY(edge.center);
                requireXY(edge.majorAxis);
                if (Math.hypot(edge.majorAxis[0], edge.majorAxis[1]) <= 1e-15 || !Number.isFinite(edge.ratio) || edge.ratio <= 0 || edge.ratio > 1 || !Number.isFinite(edge.startAngle) || !Number.isFinite(edge.endAngle)) throw new KJValidationError('Native DXF HATCH ellipse edges require a non-zero XY major axis, ratio in (0,1], and finite angles');
            } else if (edge.type === 'SPLINE') {
                if (!Number.isInteger(edge.degree) || edge.degree < 1 || edge.degree > 10 || edge.controlPoints.length < edge.degree + 1 || edge.controlPoints.length > 4096 || edge.knots.length !== edge.controlPoints.length + edge.degree + 1 || edge.knots.some((value, index)=>!Number.isFinite(value) || index > 0 && value < edge.knots[index - 1]) || edge.weights.length && edge.weights.length !== edge.controlPoints.length || edge.weights.some((value)=>!Number.isFinite(value) || value <= 0)) throw new KJValidationError('Native DXF HATCH spline edge has an invalid degree, knot, control-point or weight contract');
                for (const value of [
                    ...edge.controlPoints,
                    ...edge.fitPoints
                ])requireXY(value);
                if (edge.startTangent) requireXY(edge.startTangent);
                if (edge.endTangent) requireXY(edge.endTangent);
            } else throw new KJValidationError(`Native DXF HATCH edge type ${edge.type} is not supported; use LINE, ARC, ELLIPSE or SPLINE boundaries`);
        }
    }
    emitEntityHeader(output, 'HATCH', entity.handle, layerName, ownerHandle, space, version, p, context.linetypeNames);
    emitSubclass(output, version, 'AcDbHatch');
    emitPoint(output, [
        0,
        0,
        0
    ]);
    emit(output, 2, p.patternName ?? 'SOLID');
    emit(output, 70, p.solid ? 1 : 0);
    emit(output, 71, p.associative ? 1 : 0);
    emit(output, 91, p.boundaryLoops?.length ?? 0);
    for (const loop of p.boundaryLoops ?? []){
        const pathFlags = Number(loop.flags ?? 0) & ~1 | (loop.external === false ? 0 : 1);
        if (loop.vertices?.length) {
            emit(output, 92, pathFlags | 2);
            emit(output, 72, loop.vertices.some((vertex)=>Number(vertex.bulge)) ? 1 : 0);
            emit(output, 73, loop.closed === false ? 0 : 1);
            emit(output, 93, loop.vertices.length);
            for (const vertex of loop.vertices){
                const value = vertexPoint(vertex);
                emit(output, 10, value[0]);
                emit(output, 20, value[1]);
                if (vertex.bulge) emit(output, 42, vertex.bulge);
            }
        } else {
            emit(output, 92, pathFlags & ~2);
            emit(output, 93, loop.edges?.length ?? 0);
            for (const edge of loop.edges ?? []){
                if (edge.type === 'LINE') {
                    emit(output, 72, 1);
                    emit(output, 10, edge.start[0]);
                    emit(output, 20, edge.start[1]);
                    emit(output, 11, edge.end[0]);
                    emit(output, 21, edge.end[1]);
                } else if (edge.type === 'ARC') {
                    emit(output, 72, 2);
                    emit(output, 10, edge.center[0]);
                    emit(output, 20, edge.center[1]);
                    emit(output, 40, edge.radius);
                    emit(output, 50, edge.startAngle * 180 / Math.PI);
                    emit(output, 51, edge.endAngle * 180 / Math.PI);
                    emit(output, 73, edge.counterClockwise === false ? 0 : 1);
                } else if (edge.type === 'ELLIPSE') {
                    emit(output, 72, 3);
                    emit(output, 10, edge.center[0]);
                    emit(output, 20, edge.center[1]);
                    emit(output, 11, edge.majorAxis[0]);
                    emit(output, 21, edge.majorAxis[1]);
                    emit(output, 40, edge.ratio);
                    emit(output, 50, edge.startAngle * 180 / Math.PI);
                    emit(output, 51, edge.endAngle * 180 / Math.PI);
                    emit(output, 73, edge.counterClockwise === false ? 0 : 1);
                } else if (edge.type === 'SPLINE') {
                    emit(output, 72, 4);
                    emit(output, 94, edge.degree);
                    emit(output, 73, edge.weights.length ? 1 : 0);
                    emit(output, 74, edge.periodic ? 1 : 0);
                    emit(output, 95, edge.knots.length);
                    emit(output, 96, edge.controlPoints.length);
                    for (const knot of edge.knots)emit(output, 40, knot);
                    for (const [index, control] of edge.controlPoints.entries()){
                        emit(output, 10, control[0]);
                        emit(output, 20, control[1]);
                        if (edge.weights.length) emit(output, 42, edge.weights[index]);
                    }
                    emit(output, 97, edge.fitPoints.length);
                    for (const fit of edge.fitPoints){
                        emit(output, 11, fit[0]);
                        emit(output, 21, fit[1]);
                    }
                    if (edge.startTangent) {
                        emit(output, 12, edge.startTangent[0]);
                        emit(output, 22, edge.startTangent[1]);
                    }
                    if (edge.endTangent) {
                        emit(output, 13, edge.endTangent[0]);
                        emit(output, 23, edge.endTangent[1]);
                    }
                } else throw new KJValidationError(`DXF HATCH writer does not support ${edge.type} boundary edges`);
            }
        }
        emit(output, 97, 0);
    }
    emit(output, 75, 0);
    emit(output, 76, 1);
    if (!p.solid) {
        const lines = nativeHatchPatternLines(p);
        emit(output, 52, (p.patternAngle ?? 0) * 180 / Math.PI);
        emit(output, 41, p.patternScale ?? 1);
        emit(output, 77, 0);
        emit(output, 78, lines.length);
        for (const line of lines){
            emit(output, 53, line.angleDegrees);
            emit(output, 43, line.base[0]);
            emit(output, 44, line.base[1]);
            emit(output, 45, line.offset[0]);
            emit(output, 46, line.offset[1]);
            emit(output, 79, line.dashes.length);
            for (const dash of line.dashes)emit(output, 49, dash);
        }
    }
}
function validateViewportBoundary(boundary) {
    const p = dxfPayload(boundary);
    if (boundary.type === 'CIRCLE') return;
    if (boundary.type === 'LWPOLYLINE' || boundary.type === 'POLYLINE') {
        if (p.closed !== true) throw new KJValidationError('VIEWPORT clipping polyline must be explicitly closed');
        if (boundary.type === 'POLYLINE' && Number(p.dxfFlags ?? 0) & (8 | 16 | 64)) throw new KJValidationError('VIEWPORT clipping boundary requires a 2D polyline');
        return;
    }
    if (boundary.type === 'ELLIPSE') {
        const span = Number(p.endParameter ?? Math.PI * 2) - Number(p.startParameter ?? 0);
        if (Math.abs(span - Math.PI * 2) > 1e-12) throw new KJValidationError('VIEWPORT clipping ellipse must be complete; elliptic arcs are not supported');
        return;
    }
    if (boundary.type === 'SPLINE') {
        if (p.closed !== true) throw new KJValidationError('VIEWPORT clipping spline must be explicitly closed');
        if (!p.knots?.length) throw new KJValidationError('VIEWPORT clipping spline requires explicit native knots');
        if ((p.controlPoints?.length ?? 0) > 16384 || (p.degree ?? 0) > 64) throw new KJValidationError('VIEWPORT clipping spline exceeds the closure validation budget');
        const spline = normalizeSplineDefinition(p);
        const start = spline.knots[spline.degree], end = spline.knots[spline.controlPoints.length];
        const xyStart = splinePoint2(spline, start), xyEnd = splinePoint2(spline, end);
        const yz = {
            ...spline,
            controlPoints: p.controlPoints.map((point)=>[
                    point[1],
                    point[2]
                ])
        };
        const yzStart = splinePoint2(yz, start), yzEnd = splinePoint2(yz, end);
        if (Math.hypot(xyEnd[0] - xyStart[0], xyEnd[1] - xyStart[1], yzEnd[1] - yzStart[1]) > 1e-9) throw new KJValidationError('VIEWPORT clipping spline endpoints are not closed');
        return;
    }
    throw new KJValidationError(`VIEWPORT clipping boundary type ${boundary.type} is unsupported; requires a verified closed native curve`);
}
function emitRawEntity(output, entity, layerName, ownerHandle, space, context) {
    const { version } = context;
    const properties = {
        ...entityDrawingProperties({
            type: entity.type,
            tags: [
                ...entity.payload?.rawTags ?? []
            ]
        }, {}),
        ...entity.payload
    };
    emitEntityHeader(output, entity.type, entity.handle, layerName, ownerHandle, space, version, properties, context.linetypeNames);
    for (const tag of entity.payload?.rawTags ?? []){
        if ([
            5,
            6,
            8,
            48,
            60,
            62,
            67,
            330,
            370,
            410,
            420
        ].includes(tag.code)) continue;
        else if (tag.code === 100 && (!isSubclassDXF(version) || normalizeName(tag.value) === 'ACDBENTITY')) continue;
        else emit(output, tag.code, tag.value);
    }
}
function emitTable(output, name, records, context, tableHandle, emitRecord) {
    emit(output, 0, 'TABLE');
    emit(output, 2, name);
    if (isSubclassDXF(context.version)) {
        emit(output, 5, tableHandle);
        emit(output, 330, '0');
        emit(output, 100, 'AcDbSymbolTable');
    }
    emit(output, 70, records.length);
    if (isSubclassDXF(context.version) && name === 'DIMSTYLE') emit(output, 100, 'AcDbDimStyleTable');
    for (const record of records)emitRecord(record, tableHandle, context.version);
    emit(output, 0, 'ENDTAB');
}
function emitSymbolTableRecordHeader(output, type, record, ownerHandle, version, subclass) {
    emit(output, 0, type);
    emit(output, type === 'DIMSTYLE' && isSubclassDXF(version) ? 105 : 5, record.handle);
    if (isSubclassDXF(version)) {
        emit(output, 330, ownerHandle);
        emit(output, 100, 'AcDbSymbolTableRecord');
        emit(output, 100, subclass);
    }
}
function emitLinetypeTable(output, records, context, tableHandle) {
    emitTable(output, 'LTYPE', records, context, tableHandle, (record, ownerHandle, version)=>{
        const pattern = record.payload?.pattern ?? [];
        emitSymbolTableRecordHeader(output, 'LTYPE', record, ownerHandle, version, 'AcDbLinetypeTableRecord');
        emit(output, 2, record.name);
        emit(output, 70, record.payload?.dxfFlags ?? 0);
        emit(output, 3, record.payload?.description ?? '');
        emit(output, 72, 65);
        emit(output, 73, pattern.length);
        emit(output, 40, record.payload?.totalPatternLength ?? pattern.reduce((sum, value)=>sum + Math.abs(Number(value)), 0));
        for (const value of pattern){
            emit(output, 49, value);
            emit(output, 74, 0);
        }
    });
}
function emitTextStyleTable(output, records, context, tableHandle) {
    emitTable(output, 'STYLE', records, context, tableHandle, (record, ownerHandle, version)=>{
        const payload = record.payload ?? {};
        emitSymbolTableRecordHeader(output, 'STYLE', record, ownerHandle, version, 'AcDbTextStyleTableRecord');
        emit(output, 2, record.name);
        emit(output, 70, payload.dxfFlags ?? 0);
        emit(output, 40, payload.fixedHeight ?? 0);
        emit(output, 41, payload.widthFactor ?? 1);
        emit(output, 50, (payload.obliqueAngle ?? 0) * 180 / Math.PI);
        emit(output, 71, payload.generationFlags ?? 0);
        emit(output, 42, payload.lastHeight ?? 2.5);
        emit(output, 3, payload.fontFile ?? payload.fontFamily ?? 'txt');
        emit(output, 4, payload.bigFontFile ?? '');
    });
}
function emitDimensionStyleTable(output, records, context, tableHandle) {
    emitTable(output, 'DIMSTYLE', records, context, tableHandle, (record, ownerHandle, version)=>{
        const payload = record.payload ?? {};
        emitSymbolTableRecordHeader(output, 'DIMSTYLE', record, ownerHandle, version, 'AcDbDimStyleTableRecord');
        if (payload.decimalPlaces != null && (VERSION_RANK[version] < VERSION_RANK['2000'] || !Number.isInteger(payload.decimalPlaces) || Number(payload.decimalPlaces) < 0 || Number(payload.decimalPlaces) > 8)) throw new KJValidationError('Dimension style decimalPlaces requires an integer 0–8 and DXF 2000 or newer');
        if (payload.decimalPlaces != null) emit(output, 271, payload.decimalPlaces);
        for (const [field, code, min, max] of [
            [
                'angularDecimalPlaces',
                179,
                -1,
                8
            ],
            [
                'angularUnits',
                275,
                0,
                3
            ]
        ]){
            const value = payload[field];
            if (value == null) continue;
            if (VERSION_RANK[version] < VERSION_RANK['2000'] || !Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new KJValidationError(`Dimension style ${field} requires a valid native value and DXF 2000 or newer`);
            emit(output, code, value);
        }
        emit(output, 2, record.name);
        emit(output, 70, payload.dxfFlags ?? 0);
        emit(output, 40, payload.overallScale ?? 1);
        emit(output, 41, payload.arrowSize ?? 2.5);
        emit(output, 42, payload.extensionOffset ?? 0.625);
        emit(output, 43, payload.baselineSpacing ?? 3.75);
        emit(output, 44, payload.extensionBeyond ?? 1.25);
        if (payload.rounding) emit(output, 45, payload.rounding);
        emit(output, 140, payload.textHeight ?? 2.5);
        emit(output, 141, payload.centerMarkSize ?? 2.5);
        emit(output, 147, payload.textGap ?? 0.625);
    });
}
function emitUcsTable(output, records, context, tableHandle) {
    emitTable(output, 'UCS', records, context, tableHandle, (record, ownerHandle, version)=>{
        const payload = record.payload ?? {};
        emitSymbolTableRecordHeader(output, 'UCS', record, ownerHandle, version, 'AcDbUCSTableRecord');
        emit(output, 2, record.name);
        emit(output, 70, payload.dxfFlags ?? 0);
        emitPoint(output, payload.origin ?? [
            0,
            0,
            0
        ]);
        emitPoint(output, payload.xAxis ?? [
            1,
            0,
            0
        ], 11);
        emitPoint(output, payload.yAxis ?? [
            0,
            1,
            0
        ], 12);
    });
}
function emitViewTable(output, records, context, tableHandle) {
    emitTable(output, 'VIEW', records, context, tableHandle, (record, ownerHandle, version)=>{
        const payload = record.payload ?? {};
        emitSymbolTableRecordHeader(output, 'VIEW', record, ownerHandle, version, 'AcDbViewTableRecord');
        emit(output, 2, record.name);
        emit(output, 70, payload.dxfFlags ?? 0);
        emitPoint(output, payload.center ?? [
            0,
            0,
            0
        ]);
        emit(output, 40, payload.height ?? 1);
        emit(output, 41, payload.width ?? 1);
        emitPoint(output, payload.direction ?? [
            0,
            0,
            1
        ], 11);
        emitPoint(output, payload.target ?? [
            0,
            0,
            0
        ], 12);
        emit(output, 50, (payload.twistAngle ?? 0) * 180 / Math.PI);
        emit(output, 71, payload.viewMode ?? 0);
        if (VERSION_RANK[version] >= VERSION_RANK['2000']) {
            emit(output, 281, payload.renderMode ?? 0);
            emit(output, 72, payload.ucsAssociated ?? 0);
        }
    });
}
function emitBlockRecordTable(output, records, context, tableHandle, layoutHandles) {
    emitTable(output, 'BLOCK_RECORD', records, context, tableHandle, (record, ownerHandle, version)=>{
        emitSymbolTableRecordHeader(output, 'BLOCK_RECORD', record, ownerHandle, version, 'AcDbBlockTableRecord');
        emit(output, 2, record.name);
        emit(output, 70, record.payload?.dxfFlags ?? 0);
        emit(output, 280, 1);
        emit(output, 281, 0);
        if (layoutHandles.has(record.id)) emit(output, 340, layoutHandles.get(record.id));
    });
}
function emitEntity(output, entity, layerName, ownerHandle, context, blockNames = new Map(), space = null, resources = {}) {
    const { version } = context;
    const p = entity.payload ?? {};
    const entityVertices = p.vertices ?? [];
    if (!WRITE_TYPES.has(entity.type)) throw new KJValidationError(`ASCII DXF writer does not support ${entity.type}; export stopped to prevent data loss`);
    if (entity.type === 'POLYLINE' || version === 'R12' && entity.type === 'LWPOLYLINE') {
        emitLegacyPolyline(output, entity, layerName, ownerHandle, space, context);
        return;
    }
    if (entity.type === 'HATCH') {
        emitHatch(output, entity, layerName, ownerHandle, space, context);
        return;
    }
    if (entity.type === 'WIPEOUT' && p.rawTags?.length) {
        emitRawEntity(output, entity, layerName, ownerHandle, space, context);
        return;
    }
    if (entity.type === 'DIMENSION' && p.rawTags?.length && resources.dimensions?.get(entity.handle)?.preserveRaw) {
        emitRawEntity(output, entity, layerName, ownerHandle, space, context);
        return;
    }
    if (entity.type === 'PROXY_ENTITY') {
        emitRawEntity(output, {
            ...entity,
            type: p.originalType ?? 'PROXY_ENTITY'
        }, layerName, ownerHandle, space, context);
        return;
    }
    emitEntityHeader(output, entity.type, entity.handle, layerName, ownerHandle, space, version, p, context.linetypeNames);
    if (entity.type === 'LINE') {
        emitSubclass(output, version, 'AcDbLine');
        emitPoint(output, p.start);
        emitPoint(output, p.end, 11);
    } else if (entity.type === 'XLINE' || entity.type === 'RAY') {
        const direction = p.direction, magnitude = Math.max(...direction.map(Math.abs));
        const scaled = direction.map((value)=>value / magnitude), length = Math.hypot(...scaled);
        if (!(length > 0) || !Number.isFinite(length)) throw new KJValidationError(`${entity.type} requires a finite nonzero direction`);
        emitSubclass(output, version, entity.type === 'XLINE' ? 'AcDbXline' : 'AcDbRay');
        emitPoint(output, p.origin);
        emitPoint(output, scaled.map((value)=>value / length), 11);
    } else if (entity.type === 'POINT') {
        emitSubclass(output, version, 'AcDbPoint');
        emitPoint(output, p.position);
    } else if (entity.type === 'CIRCLE') {
        emitSubclass(output, version, 'AcDbCircle');
        emitPoint(output, p.center);
        emit(output, 40, p.radius);
    } else if (entity.type === 'ARC') {
        emitSubclass(output, version, 'AcDbCircle');
        emitPoint(output, p.center);
        emit(output, 40, p.radius);
        emitSubclass(output, version, 'AcDbArc');
        const startAngle = p.clockwise ? p.endAngle : p.startAngle;
        const endAngle = p.clockwise ? p.startAngle : p.endAngle;
        emit(output, 50, Number(startAngle) * 180 / Math.PI);
        emit(output, 51, Number(endAngle) * 180 / Math.PI);
    } else if (entity.type === 'ELLIPSE') {
        emitSubclass(output, version, 'AcDbEllipse');
        emitPoint(output, p.center);
        emitPoint(output, p.majorAxis, 11);
        emit(output, 40, p.ratio);
        emit(output, 41, p.startParameter);
        emit(output, 42, p.endParameter);
    } else if (entity.type === 'SPLINE') {
        emitSubclass(output, version, 'AcDbSpline');
        const flags = (p.closed ? 1 : 0) | (p.periodic ? 2 : 0) | (p.weights?.length ? 4 : 0);
        emit(output, 70, flags);
        emit(output, 71, p.degree);
        emit(output, 72, p.knots?.length ?? 0);
        emit(output, 73, p.controlPoints?.length ?? 0);
        emit(output, 74, p.fitPoints?.length ?? 0);
        for (const knot of p.knots ?? [])emit(output, 40, knot);
        for (const weight of p.weights ?? [])emit(output, 41, weight);
        for (const value of p.controlPoints ?? [])emitPoint(output, value);
        for (const value of p.fitPoints ?? [])emitPoint(output, value, 11);
    } else if ([
        'LWPOLYLINE',
        'POLYLINE'
    ].includes(entity.type)) {
        emitSubclass(output, version, 'AcDbPolyline');
        emit(output, 90, entityVertices.length);
        emit(output, 70, p.closed ? 1 : 0);
        emit(output, 38, p.elevation ?? 0);
        for (const vertex of entityVertices){
            const pointValue = vertexPoint(vertex);
            const details = Array.isArray(vertex) ? null : vertex;
            emit(output, 10, pointValue[0]);
            emit(output, 20, pointValue[1]);
            if (details?.bulge) emit(output, 42, details.bulge);
            if (details?.startWidth) emit(output, 40, details.startWidth);
            if (details?.endWidth) emit(output, 41, details.endWidth);
        }
    } else if (entity.type === 'MTEXT') {
        emitSubclass(output, version, 'AcDbMText');
        emitPoint(output, p.position);
        emit(output, 40, p.height);
        emit(output, 1, p.text);
        emit(output, 71, p.attachmentPoint ?? 1);
        if (p.width != null) emit(output, 41, p.width);
        if (p.styleId) emit(output, 7, resources.textStyleNames?.get(p.styleId) ?? 'STANDARD');
        if (p.rotation) emit(output, 50, p.rotation * 180 / Math.PI);
    } else if (entity.type === 'TEXT') {
        emitSingleLineText(output, p, version, resources);
        emitSubclass(output, version, 'AcDbText');
        if (p.verticalAlignment) emit(output, 73, p.verticalAlignment);
    } else if (entity.type === 'ATTDEF' || entity.type === 'ATTRIB') {
        emitSingleLineText(output, p, version, resources);
        emitSubclass(output, version, entity.type === 'ATTDEF' ? 'AcDbAttributeDefinition' : 'AcDbAttribute');
        if (entity.type === 'ATTDEF') emit(output, 3, p.prompt);
        emit(output, 2, p.tag);
        emit(output, 70, p.flags ?? 0);
        if (p.verticalAlignment) emit(output, 74, p.verticalAlignment);
        if (p.lockPosition) emit(output, 280, 1);
        if (p.dxfAttributeExtraTags != null) {
            if (!Array.isArray(p.dxfAttributeExtraTags)) throw new KJValidationError('Invalid opaque attribute subclass tags');
            for (const tag of p.dxfAttributeExtraTags){
                if (![
                    71,
                    72
                ].includes(tag.code) || typeof tag.value !== 'string' || !/^\s*[+-]?\d+\s*$/.test(tag.value)) throw new KJValidationError('Unsupported attribute subclass metadata cannot be exported without loss');
                emit(output, tag.code, tag.value);
            }
        }
    } else if (entity.type === 'INSERT') {
        const blockName = p.blockRecordId ? blockNames.get(p.blockRecordId) : undefined;
        if (!blockName) throw new KJValidationError(`DXF INSERT references an unavailable block record: ${p.blockRecordId}`);
        emitSubclass(output, version, 'AcDbBlockReference');
        if (p.sequenceEndId) emit(output, 66, 1);
        emit(output, 2, blockName);
        emitPoint(output, p.position);
        emit(output, 41, p.scale?.[0] ?? 1);
        emit(output, 42, p.scale?.[1] ?? 1);
        emit(output, 43, p.scale?.[2] ?? 1);
        if (p.rotation) emit(output, 50, p.rotation * 180 / Math.PI);
    } else if (entity.type === 'SOLID') {
        emitSubclass(output, version, 'AcDbTrace');
        entityVertices.forEach((value, index)=>emitPoint(output, vertexPoint(value), 10 + index));
    } else if (entity.type === 'LEADER') {
        if (p.unresolvedLeaderAnnotation) throw new KJValidationError(`DXF LEADER has an unresolved annotation reference: ${p.unresolvedLeaderAnnotation}`);
        const annotation = p.annotationId ? resources.objects?.get(String(p.annotationId)) : null;
        if (p.annotationId && (!annotation || annotation.erased || annotation.kind !== 'entity' || annotation.type !== 'MTEXT' || annotation.ownerId !== entity.ownerId)) throw new KJValidationError('DXF LEADER annotation must reference live MTEXT in the same owner space');
        emitSubclass(output, version, 'AcDbLeader');
        emit(output, 3, 'STANDARD');
        emit(output, 71, p.arrowEnabled === false ? 0 : 1);
        emit(output, 72, p.pathType ?? 0);
        emit(output, 73, annotation ? 0 : p.annotationType ?? 3);
        emit(output, 74, p.hookLineDirection ?? 0);
        emit(output, 75, p.hookLineEnabled === true ? 1 : 0);
        if (annotation?.payload.height != null) emit(output, 40, annotation.payload.height);
        if (annotation?.payload.width != null) emit(output, 41, annotation.payload.width);
        emit(output, 76, entityVertices.length);
        for (const value of entityVertices)emitPoint(output, vertexPoint(value));
        emitPoint(output, p.horizontalDirection ?? [
            1,
            0,
            0
        ], 211);
        if (p.blockOffset) emitPoint(output, p.blockOffset, 212);
        if (p.annotationOffset) emitPoint(output, p.annotationOffset, 213);
        if (annotation) emit(output, 340, annotation.handle);
    } else if (entity.type === 'DIMENSION') {
        if (!p.definitionPoints?.length) throw new KJValidationError('DXF DIMENSION requires at least one definition point');
        const dimension = resources.dimensions?.get(entity.handle);
        if (!dimension || dimension.preserveRaw) throw new KJValidationError(`DXF DIMENSION ${entity.handle} has no export geometry block`);
        const dimensionCode = nativeDimensionCode(p);
        emitSubclass(output, version, 'AcDbDimension');
        emit(output, 2, dimension.blockName);
        const definitionPoints = dimension.definitionPoints ?? p.definitionPoints;
        emitPoint(output, definitionPoints[0]);
        emitPoint(output, dimension.textPosition ?? p.textPosition ?? p.definitionPoints[0], 11);
        emit(output, 3, (p.styleId ? resources.dimensionStyleNames?.get(p.styleId) : undefined) ?? p.styleName ?? 'STANDARD');
        emit(output, 70, isSubclassDXF(version) ? dimensionCode | 32 : dimensionCode);
        if (p.textOverride != null) emit(output, 1, p.textOverride);
        if (dimension.measurement != null && ![
            2,
            5
        ].includes(dimensionCode & 7)) emit(output, 42, dimension.measurement);
        const subtype = dimensionCode & 7;
        const subclass = [
            'AcDbAlignedDimension',
            'AcDbAlignedDimension',
            'AcDb2LineAngularDimension',
            'AcDbDiametricDimension',
            'AcDbRadialDimension',
            'AcDb3PointAngularDimension',
            'AcDbOrdinateDimension'
        ][subtype];
        if (subclass) emitSubclass(output, version, subclass);
        const codes = subtype === 3 || subtype === 4 ? [
            15
        ] : [
            13,
            14,
            15,
            16
        ];
        definitionPoints.slice(1, codes.length + 1).forEach((value, index)=>emitPoint(output, value, codes[index]));
        const alignedStart = p.definitionPoints[1], alignedEnd = p.definitionPoints[2];
        const dimensionRotation = subtype === 1 && alignedStart && alignedEnd ? Math.atan2(Number(alignedEnd[1]) - Number(alignedStart[1]), Number(alignedEnd[0]) - Number(alignedStart[0])) : Number(p.rotation ?? 0);
        if (dimensionRotation && [
            0,
            1
        ].includes(subtype)) emit(output, 50, dimensionRotation * 180 / Math.PI);
        if (subtype === 0) emitSubclass(output, version, 'AcDbRotatedDimension');
    } else if (entity.type === 'VIEWPORT') {
        if (p.unresolvedViewportReferences?.length) throw new KJValidationError('Cannot export VIEWPORT with unresolved source references');
        if (p.viewCenter?.[2]) throw new KJValidationError('VIEWPORT viewCenter must be a two-dimensional DCS point');
        emitSubclass(output, version, 'AcDbViewport');
        emitPoint(output, p.center);
        emit(output, 40, p.width);
        emit(output, 41, p.height);
        emit(output, 68, p.status ?? 1);
        emit(output, 69, resources.viewportIds?.get(entity.handle) ?? p.viewportId ?? 2);
        emit(output, 12, p.viewCenter[0]);
        emit(output, 22, p.viewCenter[1]);
        emitPoint(output, p.viewDirection ?? [
            0,
            0,
            1
        ], 16);
        emitPoint(output, p.viewTarget ?? [
            0,
            0,
            0
        ], 17);
        emit(output, 42, p.lensLength ?? 50);
        emit(output, 43, p.frontClipDistance ?? 0);
        emit(output, 44, p.backClipDistance ?? 0);
        emit(output, 45, p.viewHeight);
        emit(output, 51, (p.twistAngle ?? 0) * 180 / Math.PI);
        emit(output, 90, p.flags ?? 0);
        for (const id of p.frozenLayerIds ?? []){
            const layer = resources.objects?.get(id);
            if (!layer || layer.type !== 'LAYER' || layer.erased) throw new KJValidationError('VIEWPORT frozen layer reference is missing or is not a layer');
            emit(output, 331, layer.handle);
        }
        if (p.clippingBoundaryId) {
            const boundary = resources.objects?.get(p.clippingBoundaryId);
            if (!boundary || boundary.kind !== 'entity' || boundary.erased || boundary.ownerId !== entity.ownerId) throw new KJValidationError('VIEWPORT clipping boundary must reference an existing entity in the same space');
            validateViewportBoundary(boundary);
            emit(output, 340, boundary.handle);
        } else if (Number(p.flags ?? 0) & 65536) throw new KJValidationError('Nonrectangular VIEWPORT requires a clipping boundary');
        const canonical = new Set([
            5,
            6,
            8,
            48,
            60,
            62,
            67,
            330,
            370,
            410,
            420,
            100,
            10,
            20,
            30,
            40,
            41,
            68,
            69,
            12,
            22,
            32,
            16,
            26,
            36,
            17,
            27,
            37,
            42,
            43,
            44,
            45,
            51,
            90,
            331,
            340,
            210,
            220,
            230
        ]);
        for (const tag of p.rawTags ?? []){
            if (canonical.has(tag.code)) continue;
            if (tag.code === 102 || tag.code >= 1000 || (tag.code >= 320 && tag.code <= 369 || tag.code >= 390 && tag.code <= 399 || tag.code === 480 || tag.code === 481) && tag.value !== '0') throw new KJValidationError('Cannot safely export unsupported VIEWPORT raw reference or XDATA');
            emit(output, tag.code, tag.value);
        }
    }
    emitEntityExtrusion(output, p);
    const dimensionStyle = entity.type === 'DIMENSION' ? resources.dimensions?.get(entity.handle) : undefined;
    if (dimensionStyle && !dimensionStyle.preserveRaw) {
        emit(output, 1001, 'ACAD');
        emit(output, 1000, 'DSTYLE');
        emit(output, 1002, '{');
        emit(output, 1070, 140);
        emit(output, 1040, dimensionStyle.textHeight);
        for (const [code, value] of [
            [
                40,
                dimensionStyle.overallScale
            ],
            [
                41,
                dimensionStyle.arrowSize
            ],
            [
                42,
                dimensionStyle.extensionOffset
            ],
            [
                44,
                dimensionStyle.extensionBeyond
            ]
        ]){
            emit(output, 1070, code);
            emit(output, 1040, value);
        }
        emit(output, 1070, 144);
        emit(output, 1040, 1);
        emit(output, 1070, 78);
        emit(output, 1070, 8);
        if (VERSION_RANK[version] >= VERSION_RANK['2000']) {
            const angular = [
                2,
                5
            ].includes(nativeDimensionCode(p) & 7);
            emit(output, 1070, angular ? 179 : 271);
            emit(output, 1070, dimensionStyle.precision);
            if (angular) {
                emit(output, 1070, 275);
                emit(output, 1070, 0);
                emit(output, 1070, 79);
                emit(output, 1070, 2);
            }
            emit(output, 1070, 277);
            emit(output, 1070, 2);
            emit(output, 1070, 278);
            emit(output, 1070, 46);
        }
        emit(output, 1002, '}');
    }
    if (entity.type === 'DIMENSION' && p.dimensionAssociations != null) {
        const associations = normalizeDimensionAssociations(p.dimensionAssociations);
        const encoded = JSON.stringify(associations.map((association)=>{
            const source = resources.objects?.get(association.entityId);
            if (!source || source.kind !== 'entity' || source.erased || source.ownerId !== entity.ownerId) throw new KJValidationError(`DXF DIMENSION ${entity.handle} has an unavailable association source: ${association.entityId}`);
            return [
                association.definitionPointIndex,
                source.handle,
                association.feature,
                ...association.feature === 'vertex' ? [
                    association.vertexIndex
                ] : association.feature === 'curve' ? [
                    association.angle
                ] : []
            ];
        }));
        emit(output, 1001, 'KJDRAW');
        emit(output, 1000, 'DIMASSOC1');
        for(let offset = 0; offset < encoded.length; offset += 250)emit(output, 1000, encoded.slice(offset, offset + 250));
    }
}
function emitSingleLineText(output, p, version, resources) {
    emitSubclass(output, version, 'AcDbText');
    emitPoint(output, p.position);
    emit(output, 40, p.height);
    emit(output, 1, writeDxfText(p));
    if (p.styleId) emit(output, 7, resources.textStyleNames?.get(p.styleId) ?? 'STANDARD');
    if (p.rotation) emit(output, 50, p.rotation * 180 / Math.PI);
    if (p.widthFactor != null) emit(output, 41, p.widthFactor);
    if (p.obliqueAngle) emit(output, 51, p.obliqueAngle * 180 / Math.PI);
    if (p.generationFlags) emit(output, 71, p.generationFlags);
    if (p.horizontalAlignment) emit(output, 72, p.horizontalAlignment);
    if (p.alignmentPoint) emitPoint(output, p.alignmentPoint, 11);
}
function isDxfVersion(value) {
    return VERSIONS.includes(value);
}
function writeDXF(document, options = {}) {
    if (!(document instanceof KJDocument)) throw new KJValidationError('DXF writer requires a KJDocument');
    const versionText = String(options.version ?? '2018').toUpperCase();
    if (!isDxfVersion(versionText)) throw new KJValidationError(`Unsupported ASCII DXF version: ${versionText}`);
    const version = versionText;
    const output = [];
    const layers = documentTableRecords(document, 'layers').map(dxfNamedRecord);
    const layerNames = new Map(layers.map((layer)=>[
            layer.id,
            layer.name
        ]));
    const state = document.toJSON({
        includeRevisions: false
    });
    if (Object.values(state.objects).some((record)=>!record.erased && record.kind === 'custom' && record.type === 'DESIGN_RELATIONS') && options.designRelations !== 'flatten') {
        throw new KJValidationError('DXF cannot preserve KJDraw design relations; save KJD/KJP, or explicitly use designRelations: "flatten" to export editable geometry without parameter relations');
    }
    if (Object.values(state.objects).some((record)=>!record.erased && record.kind === 'custom' && record.type === 'AI_TASK') && options.aiTasks !== 'omit') {
        throw new KJValidationError('DXF cannot preserve KJDraw AI tasks; save KJD/KJP, or explicitly use aiTasks: "omit" to export geometry without task state');
    }
    const layouts = state.spaces.layoutIds.map((id)=>state.objects[id]).filter((layout)=>!layout.erased);
    const layoutHandles = new Map(layouts.map((layout)=>[
            String(layout.payload.blockRecordId),
            layout.handle
        ]));
    const context = {
        version,
        allocateHandle: createHandleAllocator(Object.values(state.objects).map((record)=>record.handle)),
        linetypeNames: new Map(documentTableRecords(document, 'linetypes').map((record)=>[
                record.id,
                String(record.name)
            ]))
    };
    const tableHandles = new Map([
        'LTYPE',
        'STYLE',
        'DIMSTYLE',
        'UCS',
        'VIEW',
        'LAYER',
        'BLOCK_RECORD',
        'APPID'
    ].map((name)=>[
            name,
            context.allocateHandle()
        ]));
    const sourceBlocks = documentTableRecords(document, 'blockRecords').map(dxfNamedRecord);
    const linetypes = documentTableRecords(document, 'linetypes').map(dxfNamedRecord);
    const textStyles = documentTableRecords(document, 'textStyles').map(dxfNamedRecord);
    const dimensionStyles = documentTableRecords(document, 'dimensionStyles').map(dxfNamedRecord);
    const ucsRecords = documentTableRecords(document, 'ucs').map(dxfNamedRecord);
    const views = documentTableRecords(document, 'views').map(dxfNamedRecord);
    const allEntities = document.listEntities().map(dxfEntity);
    const hasDimensionAssociations = allEntities.some((entity)=>entity.type === 'DIMENSION' && entity.payload?.dimensionAssociations != null);
    const viewportIds = new Map(), usedViewportIds = new Map();
    for (const entity of allEntities.filter((entity)=>entity.type === 'VIEWPORT')){
        const owner = String(entity.ownerId), used = usedViewportIds.get(owner) ?? new Set();
        usedViewportIds.set(owner, used);
        const id = entity.payload?.viewportId;
        if (id !== undefined) {
            if (id > 0 && used.has(id)) throw new KJValidationError('Conflicting explicit VIEWPORT IDs in the same space');
            if (id > 0) used.add(id);
            viewportIds.set(entity.handle, id);
        }
    }
    for (const entity of allEntities.filter((entity)=>entity.type === 'VIEWPORT' && !viewportIds.has(entity.handle))){
        const used = usedViewportIds.get(String(entity.ownerId));
        let id = 2;
        while(used.has(id))id += 1;
        if (id > 32767) throw new KJValidationError('VIEWPORT ID space exhausted');
        used.add(id);
        viewportIds.set(entity.handle, id);
    }
    const dimensionExports = buildDimensionExportBlocks(document, allEntities, sourceBlocks, dimensionStyles, context);
    const syntheticBlocks = new Map(dimensionExports.blocks.map((block)=>[
            block.record.id,
            block
        ]));
    const blocks = [
        ...sourceBlocks,
        ...dimensionExports.blocks.map((block)=>block.record)
    ];
    const blockNames = new Map(blocks.map((block)=>[
            block.id,
            block.name
        ]));
    const resources = {
        objects: new Map(Object.values(state.objects).map((record)=>[
                record.id,
                record
            ])),
        textStyleNames: new Map(textStyles.map((record)=>[
                record.id,
                record.name
            ])),
        dimensionStyleNames: new Map(dimensionStyles.map((record)=>[
                record.id,
                record.name
            ])),
        dimensions: dimensionExports.dimensions,
        viewportIds
    };
    const linetypeNames = new Map(linetypes.map((record)=>[
            record.id,
            record.name
        ]));
    const emitSpaceEntity = (sourceEntity, ownerHandle, space)=>{
        if (sourceEntity.type === 'ATTRIB' && sourceEntity.payload.parentInsertId) return;
        const entity = dxfEntity(sourceEntity), layerName = layerNames.get(entity.payload?.layerId ?? '') ?? '0';
        emitEntity(output, entity, layerName, ownerHandle, context, blockNames, space, resources);
        if (sourceEntity.type !== 'INSERT') return;
        const attributeIds = sourceEntity.payload.attributeIds;
        const endId = sourceEntity.payload.sequenceEndId;
        if (!endId && (!Array.isArray(attributeIds) || !attributeIds.length)) return;
        if (!Array.isArray(attributeIds) || typeof endId !== 'string') throw new KJValidationError('DXF INSERT has an incomplete attribute sequence');
        for (const id of attributeIds){
            const attribute = state.objects[String(id)];
            if (!attribute || attribute.type !== 'ATTRIB' || attribute.payload.parentInsertId !== sourceEntity.id || attribute.ownerId !== sourceEntity.ownerId) throw new KJValidationError('DXF INSERT has an invalid attached attribute');
            if (attribute.erased) continue;
            emitEntity(output, dxfEntity(attribute), layerNames.get(attribute.payload.layerId ?? '') ?? '0', sourceEntity.handle, context, blockNames, space, resources);
        }
        const end = state.objects[endId];
        if (!end || end.erased || end.type !== 'SEQEND' || end.ownerId !== sourceEntity.id || ![
            'insert',
            'space'
        ].includes(String(end.payload.dxfOwnerMode))) throw new KJValidationError('DXF INSERT has an invalid SEQEND');
        emitEntityHeader(output, 'SEQEND', end.handle, layerNames.get(end.payload.layerId ?? '') ?? layerName, end.payload.dxfOwnerMode === 'space' ? ownerHandle : sourceEntity.handle, space, version);
    };
    for (const entity of allEntities){
        const minimum = MIN_ENTITY_VERSION[entity.type];
        if (minimum && VERSION_RANK[version] < VERSION_RANK[minimum]) throw new KJValidationError(`DXF ${version} cannot represent ${entity.type} without data loss; minimum target is ${minimum}`);
        const sourceVersion = state.header.sourceVersion;
        const sourceCode = isDxfVersion(sourceVersion) ? ACADVER[sourceVersion] : undefined;
        if (entity.type === 'PROXY_ENTITY' && sourceVersion !== 'UNKNOWN' && sourceCode !== ACADVER[version]) throw new KJValidationError(`Opaque ${entity.payload?.originalType ?? 'DXF'} data can only be preserved at its source format code ${sourceCode ?? sourceVersion}`);
    }
    if (VERSION_RANK[version] < VERSION_RANK['2000'] && state.spaces.paperSpaceIds.length > 1) throw new KJValidationError(`DXF ${version} cannot preserve multiple named paper spaces without layout metadata`);
    if (VERSION_RANK[version] < VERSION_RANK['2000'] && layouts.some((layout)=>layout.payload.dxfPlotSettings && Object.keys(layout.payload.dxfPlotSettings).length)) throw new KJValidationError(`DXF ${version} cannot preserve layout plot settings; minimum target is 2000`);
    emit(output, 0, 'SECTION');
    emit(output, 2, 'HEADER');
    emit(output, 9, '$ACADVER');
    emit(output, 1, ACADVER[version]);
    emit(output, 9, '$DWGCODEPAGE');
    emit(output, 3, 'UTF-8');
    emit(output, 9, '$HANDSEED');
    emit(output, 5, '0');
    const handleSeedValueIndex = output.length - 1;
    const linetypeScale = Number(state.header.systemVariables.LTSCALE ?? 1);
    if (!Number.isFinite(linetypeScale) || linetypeScale <= 0) throw new KJValidationError('Cannot export invalid LTSCALE');
    emit(output, 9, '$LTSCALE');
    emit(output, 40, linetypeScale);
    const currentTextStyleId = state.tables.textStyles.currentId;
    const currentTextStyle = currentTextStyleId ? state.objects[currentTextStyleId] : undefined;
    if (!currentTextStyle || !state.tables.textStyles.recordIds.includes(currentTextStyle.id)) throw new KJValidationError('Cannot export an unresolved current text style');
    emit(output, 9, '$TEXTSTYLE');
    emit(output, 7, currentTextStyle.name ?? 'STANDARD');
    if (VERSION_RANK[version] >= VERSION_RANK['2000']) {
        emit(output, 9, '$INSUNITS');
        emit(output, 70, dxfUnitCode(state.header.units));
        if (![
            'metric',
            'imperial',
            'english'
        ].includes(state.header.measurement)) throw new KJValidationError('Cannot export unrecognized DXF measurement system');
        emit(output, 9, '$MEASUREMENT');
        emit(output, 70, state.header.measurement === 'metric' ? 1 : 0);
    }
    emit(output, 0, 'ENDSEC');
    emit(output, 0, 'SECTION');
    emit(output, 2, 'TABLES');
    emitLinetypeTable(output, linetypes, context, tableHandles.get('LTYPE'));
    emitTextStyleTable(output, textStyles, context, tableHandles.get('STYLE'));
    emitDimensionStyleTable(output, dimensionStyles, context, tableHandles.get('DIMSTYLE'));
    const applicationRecords = [
        ...dimensionExports.dimensions.size ? [
            {
                id: 'dxf-acad-appid',
                type: 'APPID',
                name: 'ACAD',
                handle: context.allocateHandle(),
                payload: {}
            }
        ] : [],
        ...hasDimensionAssociations ? [
            {
                id: 'dxf-kjdraw-appid',
                type: 'APPID',
                name: 'KJDRAW',
                handle: context.allocateHandle(),
                payload: {}
            }
        ] : []
    ];
    if (applicationRecords.length) emitTable(output, 'APPID', applicationRecords, context, tableHandles.get('APPID'), (record, ownerHandle, version)=>{
        emitSymbolTableRecordHeader(output, 'APPID', record, ownerHandle, version, 'AcDbRegAppTableRecord');
        emit(output, 2, 'ACAD');
        emit(output, 70, 0);
    });
    emitUcsTable(output, ucsRecords, context, tableHandles.get('UCS'));
    emitViewTable(output, views, context, tableHandles.get('VIEW'));
    emitTable(output, 'LAYER', layers, context, tableHandles.get('LAYER'), (layer, ownerHandle, tableVersion)=>{
        const payload = layer.payload ?? {};
        const flags = (payload.frozen ? 1 : 0) | (payload.locked ? 4 : 0);
        const color = Math.abs(Number(payload.color ?? 7));
        emitSymbolTableRecordHeader(output, 'LAYER', layer, ownerHandle, tableVersion, 'AcDbLayerTableRecord');
        emit(output, 2, layer.name);
        emit(output, 70, flags);
        emit(output, 62, payload.visible === false ? -color : color);
        emit(output, 6, (payload.linetypeId ? linetypeNames.get(payload.linetypeId) : undefined) ?? payload.linetypeName ?? 'CONTINUOUS');
        if (version !== 'R12') {
            emit(output, 290, payload.plottable === false ? 0 : 1);
            emit(output, 370, payload.lineweight ?? -1);
        }
    });
    if (isSubclassDXF(version)) emitBlockRecordTable(output, blocks, context, tableHandles.get('BLOCK_RECORD'), VERSION_RANK[version] >= VERSION_RANK['2000'] ? layoutHandles : new Map());
    emit(output, 0, 'ENDSEC');
    emit(output, 0, 'SECTION');
    emit(output, 2, 'BLOCKS');
    for (const block of blocks){
        emitEntityHeader(output, 'BLOCK', context.allocateHandle(), '0', block.handle, null, version);
        emitSubclass(output, version, 'AcDbBlockBegin');
        emit(output, 2, block.name);
        emit(output, 70, block.payload?.dxfFlags ?? 0);
        emitPoint(output, block.payload?.basePoint ?? [
            0,
            0,
            0
        ]);
        emit(output, 3, block.name);
        emit(output, 1, '');
        const synthetic = syntheticBlocks.get(block.id);
        if (synthetic) {
            for (const entity of synthetic.entities)emitEntity(output, entity, '0', block.handle, context, blockNames, null, resources);
        } else if (!block.payload?.isSpace || state.spaces.paperSpaceIds.includes(block.id) && block.id !== state.spaces.paperSpaceIds[0]) {
            const layout = layouts.find((layout)=>layout.payload.blockRecordId === block.id);
            const space = layout ? {
                paper: true,
                layoutName: String(layout.name)
            } : null;
            for (const sourceEntity of document.listEntities({
                ownerId: block.id
            })){
                emitSpaceEntity(sourceEntity, block.handle, space);
            }
        }
        emitEntityHeader(output, 'ENDBLK', context.allocateHandle(), '0', block.handle, null, version);
        emitSubclass(output, version, 'AcDbBlockEnd');
    }
    emit(output, 0, 'ENDSEC');
    emit(output, 0, 'SECTION');
    emit(output, 2, 'ENTITIES');
    for (const sourceEntity of document.listEntities({
        ownerId: state.spaces.modelSpaceId
    })){
        const ownerHandle = state.objects[state.spaces.modelSpaceId]?.handle ?? null;
        emitSpaceEntity(sourceEntity, ownerHandle, null);
    }
    const layoutsByBlock = new Map(state.spaces.layoutIds.flatMap((id)=>{
        const layout = state.objects[id];
        const blockRecordId = layout?.payload?.blockRecordId;
        return layout && typeof blockRecordId === 'string' ? [
            [
                blockRecordId,
                String(layout.name ?? 'Layout1')
            ]
        ] : [];
    }));
    for (const paperSpaceId of state.spaces.paperSpaceIds){
        if (VERSION_RANK[version] >= VERSION_RANK['2000'] && paperSpaceId !== state.spaces.paperSpaceIds[0]) continue;
        const space = {
            paper: true,
            layoutName: layoutsByBlock.get(paperSpaceId) ?? 'Layout1'
        };
        for (const sourceEntity of document.listEntities({
            ownerId: paperSpaceId
        })){
            const ownerHandle = state.objects[paperSpaceId]?.handle ?? null;
            emitSpaceEntity(sourceEntity, ownerHandle, space);
        }
    }
    emit(output, 0, 'ENDSEC');
    if (VERSION_RANK[version] >= VERSION_RANK['2000']) {
        const rootHandle = context.allocateHandle(), dictionaryHandle = context.allocateHandle();
        emit(output, 0, 'SECTION');
        emit(output, 2, 'OBJECTS');
        emit(output, 0, 'DICTIONARY');
        emit(output, 5, rootHandle);
        emit(output, 330, '0');
        emit(output, 100, 'AcDbDictionary');
        emit(output, 281, 1);
        emit(output, 3, 'ACAD_LAYOUT');
        emit(output, 350, dictionaryHandle);
        emit(output, 0, 'DICTIONARY');
        emit(output, 5, dictionaryHandle);
        emit(output, 330, rootHandle);
        emit(output, 100, 'AcDbDictionary');
        emit(output, 280, 1);
        emit(output, 281, 1);
        for (const layout of layouts){
            emit(output, 3, layout.name);
            emit(output, 350, layout.handle);
        }
        for (const [index, layout] of layouts.entries()){
            emit(output, 0, 'LAYOUT');
            emit(output, 5, layout.handle);
            emit(output, 102, '{ACAD_REACTORS');
            emit(output, 330, dictionaryHandle);
            emit(output, 102, '}');
            emit(output, 330, dictionaryHandle);
            emit(output, 100, 'AcDbPlotSettings');
            if (layout.payload.dxfPlotSettings !== undefined) {
                validatePlotSettings(layout.payload.dxfPlotSettings);
                for (const [key, [code]] of Object.entries(PLOT_SETTING_FIELDS)){
                    const value = layout.payload.dxfPlotSettings[key];
                    if (value !== undefined) emit(output, code, value);
                }
            }
            emit(output, 100, 'AcDbLayout');
            emit(output, 1, layout.name);
            emit(output, 70, 1);
            emit(output, 71, layout.payload.tabOrder ?? index);
            const geometry = layout.payload.dxfLayoutGeometry;
            if (geometry !== undefined) validateDxfLayoutGeometry(geometry);
            if (geometry?.limits) {
                emit(output, 10, geometry.limits.minimum[0]);
                emit(output, 20, geometry.limits.minimum[1]);
                emit(output, 11, geometry.limits.maximum[0]);
                emit(output, 21, geometry.limits.maximum[1]);
            }
            emitPoint(output, [
                0,
                0,
                0
            ], 12);
            emitPoint(output, geometry?.extents?.minimum ?? [
                1e20,
                1e20,
                1e20
            ], 14);
            emitPoint(output, geometry?.extents?.maximum ?? [
                -1e20,
                -1e20,
                -1e20
            ], 15);
            emitPoint(output, [
                0,
                0,
                0
            ], 13);
            emitPoint(output, [
                1,
                0,
                0
            ], 16);
            emitPoint(output, [
                0,
                1,
                0
            ], 17);
            emit(output, 330, state.objects[String(layout.payload.blockRecordId)].handle);
        }
        emit(output, 0, 'ENDSEC');
    }
    emit(output, 0, 'EOF');
    output[handleSeedValueIndex] = context.allocateHandle();
    return `${output.join('\r\n')}\r\n`;
}
export function createDXFFileAdapter(options = {}) {
    return defineFileAdapter({
        id: options.id ?? 'kanjie.dxf.ascii',
        vendor: 'Kanjie',
        priority: Number(options.priority ?? 500),
        formats: {
            DXF: {
                read: PRODUCT_VERSIONS,
                write: PRODUCT_VERSIONS,
                notes: [
                    'ASCII DXF core subset with public corpus and bidirectional ezdxf 1.4.4 interoperability evidence',
                    'R12 is accepted only through the explicit legacy adapter path and is not in the KJDraw 1.0 support matrix'
                ]
            }
        },
        capabilities: {
            certification: 'cross-implementation-subset',
            encoding: 'ascii',
            legacyMigrationVersions: [
                'R12'
            ],
            entityRead: READ_TYPES,
            entityWrite: [
                ...WRITE_TYPES
            ],
            unknownEntities: 'proxy-raw-tags',
            blocks: 'definitions-and-nested-inserts',
            spaces: 'model-and-paper-ownership',
            tables: [
                'LAYER',
                'LTYPE',
                'STYLE',
                'DIMSTYLE',
                'UCS',
                'VIEW'
            ],
            limitations: [
                'binary DXF',
                'layout object metadata',
                'not Autodesk certified'
            ]
        },
        preservation: {
            handles: 'best-effort',
            ownership: 'model-and-paper-space',
            opaqueObjects: 'raw-entity-tags',
            resources: 'standard-table-records'
        },
        sniff: async (source, readOptions = {})=>{
            try {
                const text = await sourceText(source, readOptions);
                return /\bSECTION\b/.test(text.slice(0, 4096)) && /\bHEADER\b|\bENTITIES\b/.test(text.slice(0, 16384));
            } catch  {
                return false;
            }
        },
        read: (source, readOptions = {})=>readDXF(source, readOptions),
        write: writeDXF
    });
}
