// Generated from agent-mechanical-flange-core.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { projectDimension } from './geometry/annotation.js';
import { normalizeHatchSplineEdge } from './geometry/hatch-boundary.js';
import { KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK } from './knowledge-packs/mechanical-flange-core.js';
import { stableHash } from './utils.js';
export const KJDRAW_MECHANICAL_FLANGE_CORE_VERSION = '1.0.0';
const MAX_AUXILIARY_LINES = 1024;
const MAX_AUXILIARY_CURVES = 512;
const MIN_AUXILIARY_ARC_RADIUS = 1e-9;
const MAX_SYMBOL_DEFINITIONS = 128;
const MAX_SYMBOL_MEMBERS_PER_DEFINITION = 512;
const MAX_SYMBOL_MEMBERS_TOTAL = 2048;
const MAX_SYMBOL_INSTANCES = 256;
const finite = (value, label, min, max)=>{
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new KJValidationError(`${label} must be finite from ${min} to ${max}`);
    return value;
};
const plain = (value, label)=>{
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![
        Object.prototype,
        null
    ].includes(Object.getPrototypeOf(value))) throw new KJValidationError(`${label} must be a plain object`);
    return value;
};
const exact = (value, keys, label)=>{
    const extra = Object.keys(value).find((key)=>!keys.includes(key));
    if (extra) throw new KJValidationError(`${label} contains unsupported field: ${extra}`);
};
const point = (value, label)=>{
    if (!Array.isArray(value) || value.length !== 2) throw new KJValidationError(`${label} must contain two coordinates`);
    return [
        finite(value[0], `${label}[0]`, -1_000_000, 1_000_000),
        finite(value[1], `${label}[1]`, -1_000_000, 1_000_000)
    ];
};
const point2Or3 = (value, label)=>{
    if (!Array.isArray(value) || ![
        2,
        3
    ].includes(value.length)) throw new KJValidationError(`${label} must contain two or three coordinates`);
    const result = [
        finite(value[0], `${label}[0]`, -1_000_000, 1_000_000),
        finite(value[1], `${label}[1]`, -1_000_000, 1_000_000)
    ];
    if (value.length === 3) result.push(finite(value[2], `${label}[2]`, -1_000_000, 1_000_000));
    return result;
};
const increasing = (value, label, maxCount, min, max)=>{
    if (!Array.isArray(value) || value.length > maxCount) throw new KJValidationError(`${label} exceeds its item budget`);
    const result = value.map((item, index)=>finite(item, `${label}[${index}]`, min, max));
    if (result.some((item, index)=>index > 0 && item <= result[index - 1])) throw new KJValidationError(`${label} must increase strictly`);
    return result;
};
function validate(document, source) {
    if (!document || typeof document.id !== 'string' || !Number.isSafeInteger(document.revision) || typeof document.snapshot !== 'function') throw new KJValidationError('Flange compiler requires a KJDraw document');
    const input = plain(source, 'input');
    exact(input, [
        'version',
        'expectedRevision',
        'units',
        'drawingId',
        'entityDrawOrder',
        'endView',
        'sideViewAxis',
        'dimensions',
        'leaders',
        'featureControlFrames',
        'auxiliaryLines',
        'auxiliaryPoints',
        'pointDisplay',
        'auxiliarySolids',
        'auxiliaryWipeouts',
        'auxiliaryCurves',
        'auxiliaryHatches',
        'symbols',
        'styleResources',
        'styleProfile',
        'sheet'
    ], 'input');
    if (input.version !== KJDRAW_MECHANICAL_FLANGE_CORE_VERSION) throw new KJValidationError(`input.version must be ${KJDRAW_MECHANICAL_FLANGE_CORE_VERSION}`);
    if (input.entityDrawOrder != null && (!Array.isArray(input.entityDrawOrder) || input.entityDrawOrder.length > 10_000)) throw new KJValidationError('input.entityDrawOrder must be an array within its item budget');
    const entityDrawOrder = input.entityDrawOrder == null ? null : input.entityDrawOrder.map((value, index)=>{
        const order = finite(value, 'input.entityDrawOrder[' + index + ']', 0, 9_999);
        if (!Number.isSafeInteger(order)) throw new KJValidationError('input.entityDrawOrder[' + index + '] must be an integer');
        return order;
    });
    if (entityDrawOrder != null && new Set(entityDrawOrder).size !== entityDrawOrder.length) throw new KJValidationError('input.entityDrawOrder must contain unique indexes');
    if (input.units !== 'millimeter' || document.snapshot().header?.units !== 'millimeter') throw new KJValidationError('Flange compiler requires millimeter units');
    const expectedRevision = finite(input.expectedRevision, 'input.expectedRevision', 0, Number.MAX_SAFE_INTEGER);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== document.revision) throw new KJValidationError('input.expectedRevision must match the document revision');
    if (typeof input.drawingId !== 'string' || !input.drawingId.trim() || input.drawingId.length > 96 || /[\u0000-\u001f\u007f]/u.test(input.drawingId)) throw new KJValidationError('input.drawingId must be printable text');
    const resourceSource = input.styleResources == null ? {
        textStyles: [],
        dimensionStyles: []
    } : plain(input.styleResources, 'input.styleResources');
    exact(resourceSource, [
        'textStyles',
        'dimensionStyles'
    ], 'input.styleResources');
    if (!Array.isArray(resourceSource.textStyles) || resourceSource.textStyles.length > 64 || !Array.isArray(resourceSource.dimensionStyles) || resourceSource.dimensionStyles.length > 64) throw new KJValidationError('input.styleResources allow at most 64 records per table');
    const resourceKey = (value, label)=>{
        if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 96 || /[\u0000-\u001f\u007f]/u.test(value)) throw new KJValidationError(`${label} must be bounded printable text`);
        return value;
    };
    const resourceName = (value, label)=>{
        if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 128 || /[\u0000-\u001f\u007f<>/\\":;?*|=]/u.test(value)) throw new KJValidationError(`${label} must be a bounded table name`);
        return value;
    };
    const optionalNumber = (value, label, min, max, integer = false)=>{
        if (value == null) return undefined;
        const result = finite(value, label, min, max);
        if (integer && !Number.isInteger(result)) throw new KJValidationError(`${label} must be an integer`);
        return result;
    };
    const optionalResourceText = (value, label)=>{
        if (value == null) return value;
        if (typeof value !== 'string' || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) throw new KJValidationError(`${label} must be bounded printable text or null`);
        return value;
    };
    const textStyleKeys = new Set(), textStyleNames = new Set();
    const textStyles = resourceSource.textStyles.map((value, index)=>{
        const label = `input.styleResources.textStyles[${index}]`, style = plain(value, label);
        exact(style, [
            'key',
            'name',
            'fontFamily',
            'fontFile',
            'bigFontFile',
            'fixedHeight',
            'widthFactor',
            'obliqueAngle',
            'dxfFlags',
            'generationFlags',
            'lastHeight'
        ], label);
        const key = resourceKey(style.key, `${label}.key`), name = resourceName(style.name, `${label}.name`), normalizedName = name.toUpperCase();
        if (textStyleKeys.has(key) || textStyleNames.has(normalizedName)) throw new KJValidationError(`${label} key and name must be unique`);
        textStyleKeys.add(key);
        textStyleNames.add(normalizedName);
        return {
            key,
            name,
            fontFamily: optionalResourceText(style.fontFamily, `${label}.fontFamily`),
            fontFile: optionalResourceText(style.fontFile, `${label}.fontFile`),
            bigFontFile: optionalResourceText(style.bigFontFile, `${label}.bigFontFile`),
            fixedHeight: optionalNumber(style.fixedHeight, `${label}.fixedHeight`, 0, 1e12),
            widthFactor: optionalNumber(style.widthFactor, `${label}.widthFactor`, 1e-12, 1e12),
            obliqueAngle: optionalNumber(style.obliqueAngle, `${label}.obliqueAngle`, -Math.PI * 2, Math.PI * 2),
            dxfFlags: optionalNumber(style.dxfFlags, `${label}.dxfFlags`, 0, 65535, true),
            generationFlags: optionalNumber(style.generationFlags, `${label}.generationFlags`, 0, 65535, true),
            lastHeight: optionalNumber(style.lastHeight, `${label}.lastHeight`, 0, 1e12)
        };
    });
    const dimensionStyleKeys = new Set(), dimensionStyleNames = new Set();
    const dimensionStyles = resourceSource.dimensionStyles.map((value, index)=>{
        const label = `input.styleResources.dimensionStyles[${index}]`, style = plain(value, label);
        exact(style, [
            'key',
            'name',
            'overallScale',
            'arrowSize',
            'extensionOffset',
            'baselineSpacing',
            'extensionBeyond',
            'rounding',
            'textHeight',
            'decimalPlaces',
            'angularDecimalPlaces',
            'angularUnits',
            'centerMarkSize',
            'textGap',
            'dxfFlags'
        ], label);
        const key = resourceKey(style.key, `${label}.key`), name = resourceName(style.name, `${label}.name`), normalizedName = name.toUpperCase();
        if (dimensionStyleKeys.has(key) || dimensionStyleNames.has(normalizedName)) throw new KJValidationError(`${label} key and name must be unique`);
        dimensionStyleKeys.add(key);
        dimensionStyleNames.add(normalizedName);
        return {
            key,
            name,
            overallScale: optionalNumber(style.overallScale, `${label}.overallScale`, 1e-12, 1e12),
            arrowSize: optionalNumber(style.arrowSize, `${label}.arrowSize`, 0, 1e12),
            extensionOffset: optionalNumber(style.extensionOffset, `${label}.extensionOffset`, 0, 1e12),
            baselineSpacing: optionalNumber(style.baselineSpacing, `${label}.baselineSpacing`, 0, 1e12),
            extensionBeyond: optionalNumber(style.extensionBeyond, `${label}.extensionBeyond`, 0, 1e12),
            rounding: optionalNumber(style.rounding, `${label}.rounding`, 0, 1e12),
            textHeight: optionalNumber(style.textHeight, `${label}.textHeight`, 1e-12, 1e12),
            decimalPlaces: optionalNumber(style.decimalPlaces, `${label}.decimalPlaces`, 0, 8, true),
            angularDecimalPlaces: optionalNumber(style.angularDecimalPlaces, `${label}.angularDecimalPlaces`, -1, 8, true),
            angularUnits: optionalNumber(style.angularUnits, `${label}.angularUnits`, 0, 3, true),
            centerMarkSize: optionalNumber(style.centerMarkSize, `${label}.centerMarkSize`, -1e12, 1e12),
            textGap: optionalNumber(style.textGap, `${label}.textGap`, 0, 1e12),
            dxfFlags: optionalNumber(style.dxfFlags, `${label}.dxfFlags`, 0, 65535, true)
        };
    });
    const annotationStyleKey = (value, keys, label)=>{
        if (value == null) return undefined;
        const key = resourceKey(value, label);
        if (!keys.has(key)) throw new KJValidationError(`${label} must reference input.styleResources`);
        return key;
    };
    const styleProfile = input.styleProfile == null ? {} : plain(input.styleProfile, 'input.styleProfile');
    exact(styleProfile, [
        'frame',
        'grid',
        'geometry',
        'center',
        'notes',
        'dimensions',
        'hatch',
        'hidden',
        'custom'
    ], 'input.styleProfile');
    if (styleProfile.custom != null && (!Array.isArray(styleProfile.custom) || styleProfile.custom.length > 64)) throw new KJValidationError('input.styleProfile.custom must contain at most 64 items');
    const customStyleSource = styleProfile.custom ?? [];
    const entityStyleKeys = new Set();
    for (const [index, value] of customStyleSource.entries()){
        const label = `input.styleProfile.custom[${index}]`, style = plain(value, label);
        exact(style, [
            'key',
            'layerName',
            'color',
            'lineweight',
            'linetypeName',
            'linetypePattern',
            'linetypeScale'
        ], label);
        const key = resourceKey(style.key, `${label}.key`);
        if (entityStyleKeys.has(key)) throw new KJValidationError(`${label}.key must be unique`);
        entityStyleKeys.add(key);
    }
    const entityStyleKey = (value, label)=>{
        if (value == null) return undefined;
        const key = resourceKey(value, label);
        if (!entityStyleKeys.has(key)) throw new KJValidationError(`${label} must reference input.styleProfile.custom`);
        return key;
    };
    const end = plain(input.endView, 'input.endView');
    exact(end, [
        'center',
        'ringRadii',
        'ringStyleKeys',
        'squareHoles',
        'holePatterns',
        'outlineSegments',
        'cuttingPlaneMarks'
    ], 'input.endView');
    const center = point(end.center, 'input.endView.center');
    const ringRadii = increasing(end.ringRadii, 'input.endView.ringRadii', 16, 0.1, 100_000);
    if (ringRadii.length < 1) throw new KJValidationError('input.endView.ringRadii requires at least one radius');
    if (end.ringStyleKeys != null && (!Array.isArray(end.ringStyleKeys) || end.ringStyleKeys.length !== ringRadii.length)) throw new KJValidationError('input.endView.ringStyleKeys must match ringRadii');
    const ringStyleKeys = end.ringStyleKeys == null ? ringRadii.map(()=>undefined) : end.ringStyleKeys.map((value, index)=>entityStyleKey(value, `input.endView.ringStyleKeys[${index}]`));
    let pitch, radius;
    const holePatterns = [];
    if (end.squareHoles != null) {
        const holes = plain(end.squareHoles, 'input.endView.squareHoles');
        exact(holes, [
            'pitch',
            'radius'
        ], 'input.endView.squareHoles');
        pitch = finite(holes.pitch, 'input.endView.squareHoles.pitch', 0.1, 100_000);
        radius = finite(holes.radius, 'input.endView.squareHoles.radius', 0.1, 100_000);
        if (pitch <= radius * 2) throw new KJValidationError('square-hole pitch must exceed the hole diameter');
    }
    if (end.holePatterns != null && (!Array.isArray(end.holePatterns) || end.holePatterns.length > 16)) throw new KJValidationError('input.endView.holePatterns must contain at most 16 patterns');
    for (const [index, value] of (end.holePatterns ?? []).entries()){
        const label = `input.endView.holePatterns[${index}]`, pattern = plain(value, label);
        exact(pattern, [
            'count',
            'pitchRadius',
            'holeRadius',
            'startAngle',
            'styleKey'
        ], label);
        const count = finite(pattern.count, `${label}.count`, 1, 128);
        if (!Number.isInteger(count)) throw new KJValidationError(`${label}.count must be an integer`);
        const pitchRadius = finite(pattern.pitchRadius, `${label}.pitchRadius`, 0.1, 100_000), holeRadius = finite(pattern.holeRadius, `${label}.holeRadius`, 0.000_001, 100_000);
        if (pitchRadius <= holeRadius) throw new KJValidationError(`${label}.pitchRadius must exceed holeRadius`);
        const startAngle = pattern.startAngle == null ? 0 : finite(pattern.startAngle, `${label}.startAngle`, -Math.PI * 4, Math.PI * 4);
        const styleKey = entityStyleKey(pattern.styleKey, `${label}.styleKey`);
        holePatterns.push({
            count,
            pitchRadius,
            holeRadius,
            startAngle,
            ...styleKey == null ? {} : {
                styleKey
            }
        });
    }
    if (holePatterns.reduce((sum, pattern)=>sum + pattern.count, 0) > 256) throw new KJValidationError('input.endView.holePatterns exceed the 256-hole budget');
    if (end.outlineSegments != null && !Array.isArray(end.outlineSegments)) throw new KJValidationError('input.endView.outlineSegments must be an array');
    if (end.outlineSegments?.length && end.outlineSegments.length > 128) throw new KJValidationError('input.endView.outlineSegments exceed their budget');
    const outlineSegments = (end.outlineSegments ?? []).map((value, index)=>{
        const segment = plain(value, `input.endView.outlineSegments[${index}]`);
        const styleKey = entityStyleKey(segment.styleKey, `input.endView.outlineSegments[${index}].styleKey`);
        if (segment.kind === 'line') {
            exact(segment, [
                'kind',
                'startOffset',
                'endOffset',
                'styleKey'
            ], `input.endView.outlineSegments[${index}]`);
            const startOffset = point(segment.startOffset, `input.endView.outlineSegments[${index}].startOffset`);
            const endOffset = point(segment.endOffset, `input.endView.outlineSegments[${index}].endOffset`);
            if (startOffset[0] === endOffset[0] && startOffset[1] === endOffset[1]) throw new KJValidationError(`input.endView.outlineSegments[${index}] must not have zero length`);
            return {
                kind: 'line',
                startOffset,
                endOffset,
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        }
        if (segment.kind === 'arc') {
            exact(segment, [
                'kind',
                'centerOffset',
                'radius',
                'startAngle',
                'endAngle',
                'styleKey'
            ], `input.endView.outlineSegments[${index}]`);
            const centerOffset = point(segment.centerOffset, `input.endView.outlineSegments[${index}].centerOffset`);
            const arcRadius = finite(segment.radius, `input.endView.outlineSegments[${index}].radius`, 0.1, 100_000);
            const startAngle = finite(segment.startAngle, `input.endView.outlineSegments[${index}].startAngle`, -Math.PI * 4, Math.PI * 4);
            const endAngle = finite(segment.endAngle, `input.endView.outlineSegments[${index}].endAngle`, -Math.PI * 4, Math.PI * 4);
            if (startAngle === endAngle) throw new KJValidationError(`input.endView.outlineSegments[${index}] arc sweep must not be zero`);
            return {
                kind: 'arc',
                centerOffset,
                radius: arcRadius,
                startAngle,
                endAngle,
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        }
        if (segment.kind === 'circle') {
            exact(segment, [
                'kind',
                'centerOffset',
                'radius',
                'styleKey'
            ], `input.endView.outlineSegments[${index}]`);
            return {
                kind: 'circle',
                centerOffset: point(segment.centerOffset, `input.endView.outlineSegments[${index}].centerOffset`),
                radius: finite(segment.radius, `input.endView.outlineSegments[${index}].radius`, 0.1, 100_000),
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        }
        throw new KJValidationError(`input.endView.outlineSegments[${index}].kind is invalid`);
    });
    if (end.cuttingPlaneMarks != null && !Array.isArray(end.cuttingPlaneMarks)) throw new KJValidationError('input.endView.cuttingPlaneMarks must be an array');
    if (end.cuttingPlaneMarks?.length && end.cuttingPlaneMarks.length > 16) throw new KJValidationError('input.endView.cuttingPlaneMarks exceed their budget');
    const cuttingPlaneMarks = (end.cuttingPlaneMarks ?? []).map((value, index)=>{
        const mark = plain(value, `input.endView.cuttingPlaneMarks[${index}]`);
        exact(mark, [
            'anchorOffset',
            'stemVector',
            'tickVector',
            'arrowhead',
            'stemStyleKey',
            'tickStyleKey',
            'arrowheadStyleKey'
        ], `input.endView.cuttingPlaneMarks[${index}]`);
        const anchorOffset = point(mark.anchorOffset, `input.endView.cuttingPlaneMarks[${index}].anchorOffset`);
        const stemVector = point(mark.stemVector, `input.endView.cuttingPlaneMarks[${index}].stemVector`);
        const tickVector = point(mark.tickVector, `input.endView.cuttingPlaneMarks[${index}].tickVector`);
        if (stemVector[0] === 0 && stemVector[1] === 0 || tickVector[0] === 0 && tickVector[1] === 0) throw new KJValidationError(`input.endView.cuttingPlaneMarks[${index}] vectors must not have zero length`);
        const arrow = mark.arrowhead == null ? null : plain(mark.arrowhead, `input.endView.cuttingPlaneMarks[${index}].arrowhead`);
        if (arrow) exact(arrow, [
            'length',
            'width'
        ], `input.endView.cuttingPlaneMarks[${index}].arrowhead`);
        const stemStyleKey = entityStyleKey(mark.stemStyleKey, `input.endView.cuttingPlaneMarks[${index}].stemStyleKey`), tickStyleKey = entityStyleKey(mark.tickStyleKey, `input.endView.cuttingPlaneMarks[${index}].tickStyleKey`), arrowheadStyleKey = entityStyleKey(mark.arrowheadStyleKey, `input.endView.cuttingPlaneMarks[${index}].arrowheadStyleKey`);
        return {
            anchorOffset,
            stemVector,
            tickVector,
            ...arrow ? {
                arrowhead: {
                    length: finite(arrow.length, `input.endView.cuttingPlaneMarks[${index}].arrowhead.length`, 0.1, 100_000),
                    width: finite(arrow.width, `input.endView.cuttingPlaneMarks[${index}].arrowhead.width`, 0.1, 100_000)
                }
            } : {},
            ...stemStyleKey == null ? {} : {
                stemStyleKey
            },
            ...tickStyleKey == null ? {} : {
                tickStyleKey
            },
            ...arrowheadStyleKey == null ? {} : {
                arrowheadStyleKey
            }
        };
    });
    const side = input.sideViewAxis == null ? null : plain(input.sideViewAxis, 'input.sideViewAxis');
    if (side) exact(side, [
        'xRange',
        'stationRange',
        'orientation',
        'axisCoordinate',
        'axisVisible',
        'axisDirection',
        'axisStyleKey',
        'symmetricProfiles',
        'outlineSegments',
        'sectionHatches'
    ], 'input.sideViewAxis');
    if (side && side.xRange == null === (side.stationRange == null)) throw new KJValidationError('input.sideViewAxis requires exactly one of xRange or stationRange');
    const rangeKey = side?.stationRange == null ? 'xRange' : 'stationRange';
    const xRange = side ? point(side[rangeKey], 'input.sideViewAxis.' + rangeKey) : null;
    const orientation = side?.orientation ?? 'horizontal';
    if (![
        'horizontal',
        'vertical'
    ].includes(orientation)) throw new KJValidationError('input.sideViewAxis.orientation is invalid');
    const axisCoordinate = side ? finite(side.axisCoordinate ?? (orientation === 'horizontal' ? center[1] : center[0]), 'input.sideViewAxis.axisCoordinate', -1_000_000, 1_000_000) : null;
    if (side?.axisVisible != null && typeof side.axisVisible !== 'boolean') throw new KJValidationError('input.sideViewAxis.axisVisible must be boolean');
    const axisVisible = side != null && side.axisVisible !== false;
    const axisDirection = side?.axisDirection ?? 'forward';
    if (![
        'forward',
        'reverse'
    ].includes(axisDirection)) throw new KJValidationError('input.sideViewAxis.axisDirection is invalid');
    const axisStyleKey = side == null ? undefined : entityStyleKey(side.axisStyleKey, 'input.sideViewAxis.axisStyleKey');
    if (xRange && xRange[0] >= xRange[1]) throw new KJValidationError('input.sideViewAxis.' + rangeKey + ' must increase');
    if (side?.symmetricProfiles != null && !Array.isArray(side.symmetricProfiles)) throw new KJValidationError('input.sideViewAxis.symmetricProfiles must be an array');
    if (side?.symmetricProfiles?.length && side.symmetricProfiles.length > 64) throw new KJValidationError('input.sideViewAxis.symmetricProfiles exceed their budget');
    const symmetricProfiles = (side?.symmetricProfiles ?? []).map((value, profileIndex)=>{
        const profile = plain(value, `input.sideViewAxis.symmetricProfiles[${profileIndex}]`);
        exact(profile, [
            'vertices',
            'endCaps',
            'segmentDirections',
            'startCapDirection',
            'endCapDirection',
            'styleKey',
            'startCapStyleKey',
            'endCapStyleKey'
        ], `input.sideViewAxis.symmetricProfiles[${profileIndex}]`);
        if (!Array.isArray(profile.vertices) || profile.vertices.length < 2 || profile.vertices.length > 64) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices must contain 2 to 64 points`);
        const vertices = profile.vertices.map((vertexValue, vertexIndex)=>{
            const vertex = plain(vertexValue, `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}]`);
            exact(vertex, [
                'station',
                'radius'
            ], `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}]`);
            const station = finite(vertex.station, `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}].station`, xRange[0], xRange[1]);
            const radius = finite(vertex.radius, `input.sideViewAxis.symmetricProfiles[${profileIndex}].vertices[${vertexIndex}].radius`, 0.1, 100_000);
            return {
                station,
                radius
            };
        });
        for(let index = 1; index < vertices.length; index++){
            const previous = vertices[index - 1], current = vertices[index];
            if (current.station < previous.station) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}] stations must not decrease`);
            if (current.station === previous.station && current.radius === previous.radius) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}] contains a zero-length segment`);
        }
        const direction = (value, label)=>{
            if (value == null) return 'forward';
            if (value !== 'forward' && value !== 'reverse') throw new KJValidationError(label + ' is invalid');
            return value;
        };
        if (profile.segmentDirections != null && (!Array.isArray(profile.segmentDirections) || profile.segmentDirections.length !== vertices.length - 1)) throw new KJValidationError('input.sideViewAxis.symmetricProfiles[' + profileIndex + '].segmentDirections must match the segment count');
        const segmentDirections = (profile.segmentDirections ?? Array.from({
            length: vertices.length - 1
        }, ()=>({}))).map((value, index)=>{
            const label = 'input.sideViewAxis.symmetricProfiles[' + profileIndex + '].segmentDirections[' + index + ']', entry = plain(value, label);
            exact(entry, [
                'upper',
                'lower'
            ], label);
            return {
                upper: direction(entry.upper, label + '.upper'),
                lower: direction(entry.lower, label + '.lower')
            };
        });
        const startCapDirection = direction(profile.startCapDirection, 'input.sideViewAxis.symmetricProfiles[' + profileIndex + '].startCapDirection');
        const endCapDirection = direction(profile.endCapDirection, 'input.sideViewAxis.symmetricProfiles[' + profileIndex + '].endCapDirection');
        const endCaps = profile.endCaps ?? 'none';
        if (![
            'none',
            'start',
            'end',
            'both'
        ].includes(endCaps)) throw new KJValidationError(`input.sideViewAxis.symmetricProfiles[${profileIndex}].endCaps is invalid`);
        const styleKey = entityStyleKey(profile.styleKey, `input.sideViewAxis.symmetricProfiles[${profileIndex}].styleKey`);
        const startCapStyleKey = entityStyleKey(profile.startCapStyleKey, `input.sideViewAxis.symmetricProfiles[${profileIndex}].startCapStyleKey`);
        const endCapStyleKey = entityStyleKey(profile.endCapStyleKey, `input.sideViewAxis.symmetricProfiles[${profileIndex}].endCapStyleKey`);
        return {
            vertices,
            endCaps,
            segmentDirections,
            startCapDirection,
            endCapDirection,
            ...styleKey == null ? {} : {
                styleKey
            },
            ...startCapStyleKey == null ? {} : {
                startCapStyleKey
            },
            ...endCapStyleKey == null ? {} : {
                endCapStyleKey
            }
        };
    });
    if (side?.outlineSegments != null && !Array.isArray(side.outlineSegments)) throw new KJValidationError('input.sideViewAxis.outlineSegments must be an array');
    if (side?.outlineSegments?.length && side.outlineSegments.length > 128) throw new KJValidationError('input.sideViewAxis.outlineSegments exceed their budget');
    const sideOutlineSegments = (side?.outlineSegments ?? []).map((value, index)=>{
        const segment = plain(value, `input.sideViewAxis.outlineSegments[${index}]`);
        const styleKey = entityStyleKey(segment.styleKey, `input.sideViewAxis.outlineSegments[${index}].styleKey`);
        const stationOffset = (pointValue, label)=>{
            const value = plain(pointValue, label);
            exact(value, [
                'station',
                'offset'
            ], label);
            return {
                station: finite(value.station, `${label}.station`, xRange[0], xRange[1]),
                offset: finite(value.offset, `${label}.offset`, -100_000, 100_000)
            };
        };
        if (segment.kind === 'line') {
            exact(segment, [
                'kind',
                'start',
                'end',
                'styleKey'
            ], `input.sideViewAxis.outlineSegments[${index}]`);
            const start = stationOffset(segment.start, `input.sideViewAxis.outlineSegments[${index}].start`);
            const end = stationOffset(segment.end, `input.sideViewAxis.outlineSegments[${index}].end`);
            if (start.station === end.station && start.offset === end.offset) throw new KJValidationError(`input.sideViewAxis.outlineSegments[${index}] must not have zero length`);
            return {
                kind: 'line',
                start,
                end,
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        }
        if (segment.kind === 'arc') {
            exact(segment, [
                'kind',
                'center',
                'radius',
                'startAngle',
                'endAngle',
                'styleKey'
            ], `input.sideViewAxis.outlineSegments[${index}]`);
            const arcCenter = stationOffset(segment.center, `input.sideViewAxis.outlineSegments[${index}].center`);
            const arcRadius = finite(segment.radius, `input.sideViewAxis.outlineSegments[${index}].radius`, 0.1, 100_000);
            const startAngle = finite(segment.startAngle, `input.sideViewAxis.outlineSegments[${index}].startAngle`, -Math.PI * 4, Math.PI * 4);
            const endAngle = finite(segment.endAngle, `input.sideViewAxis.outlineSegments[${index}].endAngle`, -Math.PI * 4, Math.PI * 4);
            if (startAngle === endAngle) throw new KJValidationError(`input.sideViewAxis.outlineSegments[${index}] arc sweep must not be zero`);
            return {
                kind: 'arc',
                center: arcCenter,
                radius: arcRadius,
                startAngle,
                endAngle,
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        }
        if (segment.kind === 'circle') {
            exact(segment, [
                'kind',
                'center',
                'radius',
                'styleKey'
            ], `input.sideViewAxis.outlineSegments[${index}]`);
            return {
                kind: 'circle',
                center: stationOffset(segment.center, `input.sideViewAxis.outlineSegments[${index}].center`),
                radius: finite(segment.radius, `input.sideViewAxis.outlineSegments[${index}].radius`, 0.1, 100_000),
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        }
        throw new KJValidationError(`input.sideViewAxis.outlineSegments[${index}].kind is invalid`);
    });
    if (side?.sectionHatches != null && !Array.isArray(side.sectionHatches)) throw new KJValidationError('input.sideViewAxis.sectionHatches must be an array');
    if (side?.sectionHatches?.length && side.sectionHatches.length > 32) throw new KJValidationError('input.sideViewAxis.sectionHatches exceed their budget');
    const sectionHatches = (side?.sectionHatches ?? []).map((value, hatchIndex)=>{
        const label = `input.sideViewAxis.sectionHatches[${hatchIndex}]`, hatch = plain(value, label);
        exact(hatch, [
            'edges',
            'boundaryLoops',
            'solid',
            'patternName',
            'lineAngle',
            'lineSpacing',
            'patternOrigin',
            'patternLines',
            'styleKey'
        ], label);
        const hasEdges = hatch.edges != null, hasBoundaryLoops = hatch.boundaryLoops != null;
        if (hasEdges === hasBoundaryLoops) throw new KJValidationError(`${label} requires exactly one of edges or boundaryLoops`);
        const loopSource = hasEdges ? [
            {
                edges: hatch.edges,
                external: false,
                flags: 0
            }
        ] : hatch.boundaryLoops;
        if (!Array.isArray(loopSource) || loopSource.length < 1 || loopSource.length > 32) throw new KJValidationError(`${label}.boundaryLoops must contain 1 to 32 loops`);
        const localPoint = (value, label)=>{
            const coordinate = plain(value, label);
            exact(coordinate, [
                'station',
                'offset'
            ], label);
            return {
                station: finite(coordinate.station, `${label}.station`, xRange[0], xRange[1]),
                offset: finite(coordinate.offset, `${label}.offset`, -100_000, 100_000)
            };
        };
        let totalEdges = 0, splinePoints = 0;
        const boundaryLoops = loopSource.map((value, loopIndex)=>{
            const loopLabel = `${label}.boundaryLoops[${loopIndex}]`, loop = plain(value, loopLabel);
            exact(loop, [
                'edges',
                'external',
                'flags'
            ], loopLabel);
            if (loop.external != null && typeof loop.external !== 'boolean') throw new KJValidationError(`${loopLabel}.external must be boolean`);
            const flags = loop.flags == null ? 0 : finite(loop.flags, `${loopLabel}.flags`, 0, 65535);
            if (!Number.isInteger(flags)) throw new KJValidationError(`${loopLabel}.flags must be an integer`);
            if (!Array.isArray(loop.edges) || loop.edges.length < 1 || loop.edges.length > 128) throw new KJValidationError(`${loopLabel}.edges must contain 1 to 128 edges`);
            totalEdges += loop.edges.length;
            const edges = loop.edges.map((value, edgeIndex)=>{
                const edgeLabel = `${loopLabel}.edges[${edgeIndex}]`, edge = plain(value, edgeLabel);
                if (edge.kind === 'line') {
                    exact(edge, [
                        'kind',
                        'start',
                        'end'
                    ], edgeLabel);
                    const start = localPoint(edge.start, `${edgeLabel}.start`), end = localPoint(edge.end, `${edgeLabel}.end`);
                    if (start.station === end.station && start.offset === end.offset) throw new KJValidationError(`${edgeLabel} must not have zero length`);
                    return {
                        kind: 'line',
                        start,
                        end
                    };
                }
                if (edge.kind === 'arc') {
                    exact(edge, [
                        'kind',
                        'center',
                        'radius',
                        'startAngle',
                        'endAngle',
                        'counterClockwise'
                    ], edgeLabel);
                    if (edge.counterClockwise != null && typeof edge.counterClockwise !== 'boolean') throw new KJValidationError(`${edgeLabel}.counterClockwise must be boolean`);
                    const startAngle = finite(edge.startAngle, `${edgeLabel}.startAngle`, -Math.PI * 4, Math.PI * 4);
                    const endAngle = finite(edge.endAngle, `${edgeLabel}.endAngle`, -Math.PI * 4, Math.PI * 4);
                    if (startAngle === endAngle) throw new KJValidationError(`${edgeLabel} arc sweep must not be zero`);
                    return {
                        kind: 'arc',
                        center: localPoint(edge.center, `${edgeLabel}.center`),
                        radius: finite(edge.radius, `${edgeLabel}.radius`, 0.1, 100_000),
                        startAngle,
                        endAngle,
                        counterClockwise: edge.counterClockwise !== false
                    };
                }
                if (edge.kind === 'spline') {
                    exact(edge, [
                        'kind',
                        'degree',
                        'controlPoints',
                        'knots',
                        'weights',
                        'fitPoints',
                        'periodic',
                        'startTangent',
                        'endTangent'
                    ], edgeLabel);
                    if (!Array.isArray(edge.controlPoints)) throw new KJValidationError(`${edgeLabel}.controlPoints must be an array`);
                    if (edge.knots != null && !Array.isArray(edge.knots)) throw new KJValidationError(`${edgeLabel}.knots must be an array`);
                    if (edge.weights != null && !Array.isArray(edge.weights)) throw new KJValidationError(`${edgeLabel}.weights must be an array`);
                    if (edge.fitPoints != null && !Array.isArray(edge.fitPoints)) throw new KJValidationError(`${edgeLabel}.fitPoints must be an array`);
                    if (edge.periodic != null && typeof edge.periodic !== 'boolean') throw new KJValidationError(`${edgeLabel}.periodic must be boolean`);
                    const controlPoints = edge.controlPoints.map((pointValue, pointIndex)=>localPoint(pointValue, `${edgeLabel}.controlPoints[${pointIndex}]`));
                    const fitPoints = (edge.fitPoints ?? []).map((pointValue, pointIndex)=>localPoint(pointValue, `${edgeLabel}.fitPoints[${pointIndex}]`));
                    const startTangent = edge.startTangent == null ? undefined : point(edge.startTangent, `${edgeLabel}.startTangent`);
                    const endTangent = edge.endTangent == null ? undefined : point(edge.endTangent, `${edgeLabel}.endTangent`);
                    const degree = finite(edge.degree, `${edgeLabel}.degree`, 1, 10);
                    if (!Number.isInteger(degree)) throw new KJValidationError(`${edgeLabel}.degree must be an integer`);
                    const normalized = normalizeHatchSplineEdge({
                        type: 'SPLINE',
                        degree,
                        controlPoints: controlPoints.map((point)=>[
                                point.station,
                                point.offset,
                                0
                            ]),
                        knots: edge.knots,
                        weights: edge.weights,
                        fitPoints: fitPoints.map((point)=>[
                                point.station,
                                point.offset,
                                0
                            ]),
                        periodic: edge.periodic === true,
                        ...startTangent == null ? {} : {
                            startTangent: [
                                ...startTangent,
                                0
                            ]
                        },
                        ...endTangent == null ? {} : {
                            endTangent: [
                                ...endTangent,
                                0
                            ]
                        }
                    }, edgeLabel);
                    splinePoints += normalized.controlPoints.length + normalized.fitPoints.length;
                    return {
                        kind: 'spline',
                        degree: normalized.degree,
                        controlPoints,
                        knots: [
                            ...normalized.knots
                        ],
                        weights: [
                            ...normalized.weights
                        ],
                        fitPoints,
                        periodic: normalized.periodic,
                        ...startTangent == null ? {} : {
                            startTangent
                        },
                        ...endTangent == null ? {} : {
                            endTangent
                        }
                    };
                }
                throw new KJValidationError(`${edgeLabel}.kind is invalid`);
            });
            return {
                external: loop.external === true,
                flags,
                edges
            };
        });
        if (totalEdges > 256) throw new KJValidationError(`${label}.boundaryLoops exceed the 256-edge budget`);
        if (splinePoints > 4096) throw new KJValidationError(`${label}.boundaryLoops exceed the 4096-spline-point budget`);
        if (hatch.solid != null && typeof hatch.solid !== 'boolean') throw new KJValidationError(`${label}.solid must be boolean`);
        const solid = hatch.solid === true;
        const patternName = hatch.patternName == null ? solid ? 'SOLID' : 'ANSI31' : resourceKey(hatch.patternName, `${label}.patternName`);
        if (solid && (hatch.lineAngle != null || hatch.lineSpacing != null || hatch.patternOrigin != null || hatch.patternLines != null)) throw new KJValidationError(`${label} solid fills must not define pattern lines`);
        if (!solid && hatch.patternLines != null && (hatch.lineAngle != null || hatch.lineSpacing != null || hatch.patternOrigin != null)) throw new KJValidationError(`${label} explicit patternLines cannot be combined with the one-family shorthand`);
        if (!solid && hatch.patternLines == null && (hatch.lineAngle == null || hatch.lineSpacing == null)) throw new KJValidationError(`${label} patterned fills require patternLines or lineAngle and lineSpacing`);
        if (hatch.patternLines != null && (!Array.isArray(hatch.patternLines) || hatch.patternLines.length < 1 || hatch.patternLines.length > 16)) throw new KJValidationError(`${label}.patternLines must contain 1 to 16 line families`);
        const patternLines = solid ? [] : hatch.patternLines == null ? (()=>{
            const lineAngle = finite(hatch.lineAngle, `${label}.lineAngle`, -Math.PI * 2, Math.PI * 2);
            const lineSpacing = finite(hatch.lineSpacing, `${label}.lineSpacing`, 0.01, 100_000);
            const patternOrigin = hatch.patternOrigin == null ? [
                0,
                0
            ] : point(hatch.patternOrigin, `${label}.patternOrigin`);
            return [
                {
                    angle: lineAngle,
                    base: patternOrigin,
                    offset: [
                        -Math.sin(lineAngle) * lineSpacing,
                        Math.cos(lineAngle) * lineSpacing
                    ],
                    dashes: []
                }
            ];
        })() : hatch.patternLines.map((value, patternIndex)=>{
            const lineLabel = `${label}.patternLines[${patternIndex}]`, patternLine = plain(value, lineLabel);
            exact(patternLine, [
                'angle',
                'base',
                'offset',
                'dashes'
            ], lineLabel);
            const angle = finite(patternLine.angle, `${lineLabel}.angle`, -Math.PI * 2, Math.PI * 2);
            const base = point(patternLine.base, `${lineLabel}.base`), offset = point(patternLine.offset, `${lineLabel}.offset`);
            if (offset[0] === 0 && offset[1] === 0) throw new KJValidationError(`${lineLabel}.offset must not be zero`);
            if (patternLine.dashes != null && (!Array.isArray(patternLine.dashes) || patternLine.dashes.length > 32)) throw new KJValidationError(`${lineLabel}.dashes must be an array with at most 32 items`);
            const dashes = (patternLine.dashes ?? []).map((dash, dashIndex)=>finite(dash, `${lineLabel}.dashes[${dashIndex}]`, -100_000, 100_000));
            return {
                angle,
                base,
                offset,
                dashes
            };
        });
        const styleKey = entityStyleKey(hatch.styleKey, `${label}.styleKey`);
        return {
            boundaryLoops,
            solid,
            patternName,
            patternLines,
            ...styleKey == null ? {} : {
                styleKey
            }
        };
    });
    const sheet = plain(input.sheet, 'input.sheet');
    exact(sheet, [
        'origin',
        'size',
        'inset',
        'outerFrameOffset',
        'outerFrameStyleKey',
        'insetFrameStyleKey',
        'outerFrameSideStyleKeys',
        'insetFrameSideStyleKeys',
        'outerFrameSides',
        'insetFrameSides',
        'titleGrid',
        'notes'
    ], 'input.sheet');
    const sheetOrigin = point(sheet.origin, 'input.sheet.origin'), sheetSize = point(sheet.size, 'input.sheet.size');
    if (sheetSize[0] < 100 || sheetSize[1] < 100) throw new KJValidationError('input.sheet.size is too small');
    const inset = finite(sheet.inset, 'input.sheet.inset', 0, Math.min(...sheetSize) / 2 - 1);
    const outerFrameOffset = sheet.outerFrameOffset == null ? [
        0,
        0
    ] : point(sheet.outerFrameOffset, 'input.sheet.outerFrameOffset');
    if (outerFrameOffset.some((value)=>Math.abs(value) > 1)) throw new KJValidationError('input.sheet.outerFrameOffset must stay within one drawing unit');
    const outerFrameStyleKey = entityStyleKey(sheet.outerFrameStyleKey, 'input.sheet.outerFrameStyleKey'), insetFrameStyleKey = entityStyleKey(sheet.insetFrameStyleKey, 'input.sheet.insetFrameStyleKey');
    const frameSideStyleKeys = (value, label)=>{
        if (value == null) return {};
        const source = plain(value, label);
        exact(source, [
            'bottom',
            'right',
            'top',
            'left'
        ], label);
        const result = {};
        for (const side of [
            'bottom',
            'right',
            'top',
            'left'
        ])if (Object.hasOwn(source, side)) {
            const styleKey = entityStyleKey(source[side], `${label}.${side}`);
            if (styleKey == null) throw new KJValidationError(`${label}.${side} must be a style key`);
            result[side] = styleKey;
        }
        return result;
    };
    const outerFrameSideStyleKeys = frameSideStyleKeys(sheet.outerFrameSideStyleKeys, 'input.sheet.outerFrameSideStyleKeys');
    const insetFrameSideStyleKeys = frameSideStyleKeys(sheet.insetFrameSideStyleKeys, 'input.sheet.insetFrameSideStyleKeys');
    const frameSides = (value, label)=>{
        if (value == null) return [
            'bottom',
            'right',
            'top',
            'left'
        ];
        if (!Array.isArray(value) || value.length > 4 || value.some((side)=>![
                'bottom',
                'right',
                'top',
                'left'
            ].includes(side)) || new Set(value).size !== value.length) throw new KJValidationError(`${label} must contain unique frame sides`);
        return [
            ...value
        ];
    };
    const outerFrameSides = frameSides(sheet.outerFrameSides, 'input.sheet.outerFrameSides'), insetFrameSides = frameSides(sheet.insetFrameSides, 'input.sheet.insetFrameSides');
    const grid = sheet.titleGrid == null ? null : plain(sheet.titleGrid, 'input.sheet.titleGrid');
    if (grid) exact(grid, [
        'origin',
        'size',
        'columns',
        'partialColumns',
        'rows',
        'horizontalSegments',
        'verticalSegments',
        'topStyleKey',
        'diagonalHeader'
    ], 'input.sheet.titleGrid');
    let titleGrid = null;
    if (grid) {
        const origin = point(grid.origin, 'input.sheet.titleGrid.origin'), size = point(grid.size, 'input.sheet.titleGrid.size');
        if (size[0] <= 0 || size[1] <= 0 || origin[0] < sheetOrigin[0] + inset || origin[1] < sheetOrigin[1] + inset || origin[0] + size[0] > sheetOrigin[0] + sheetSize[0] - inset || origin[1] + size[1] > sheetOrigin[1] + sheetSize[1] - inset) throw new KJValidationError('title grid must lie inside the inset frame');
        if (!Array.isArray(grid.columns) || grid.columns.length > 32) throw new KJValidationError('input.sheet.titleGrid.columns exceeds its item budget');
        const columns = grid.columns.map((value, index)=>{
            if (typeof value === 'number') return value;
            const entry = plain(value, `input.sheet.titleGrid.columns[${index}]`);
            exact(entry, [
                'offset',
                'styleKey'
            ], `input.sheet.titleGrid.columns[${index}]`);
            const styleKey = entityStyleKey(entry.styleKey, `input.sheet.titleGrid.columns[${index}].styleKey`);
            return {
                offset: finite(entry.offset, `input.sheet.titleGrid.columns[${index}].offset`, 0, size[0]),
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        });
        const columnOffsets = columns.map((value)=>typeof value === 'number' ? value : value.offset);
        if (columnOffsets.some((value, index)=>index > 0 && value <= columnOffsets[index - 1])) throw new KJValidationError('input.sheet.titleGrid.columns must increase strictly');
        if (!Array.isArray(grid.rows) || grid.rows.length > 16) throw new KJValidationError('title grid rows exceed their budget');
        const rows = grid.rows.map((value, index)=>{
            const entry = plain(value, `input.sheet.titleGrid.rows[${index}]`);
            exact(entry, [
                'offset',
                'breaks',
                'styleKey'
            ], `input.sheet.titleGrid.rows[${index}]`);
            const styleKey = entityStyleKey(entry.styleKey, `input.sheet.titleGrid.rows[${index}].styleKey`);
            return {
                offset: finite(entry.offset, `input.sheet.titleGrid.rows[${index}].offset`, 0, size[1]),
                breaks: increasing(entry.breaks ?? [], `input.sheet.titleGrid.rows[${index}].breaks`, 16, 0, size[0]),
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        });
        if (rows.some((row, index)=>index > 0 && row.offset <= rows[index - 1].offset)) throw new KJValidationError('title grid row offsets must increase');
        if (!Array.isArray(grid.partialColumns) && grid.partialColumns != null) throw new KJValidationError('title grid partialColumns must be an array');
        if (grid.partialColumns?.length && grid.partialColumns.length > 16) throw new KJValidationError('title grid partialColumns exceed their budget');
        const partialColumns = (grid.partialColumns ?? []).map((value, index)=>{
            const entry = plain(value, `input.sheet.titleGrid.partialColumns[${index}]`);
            exact(entry, [
                'offset',
                'height',
                'styleKey'
            ], `input.sheet.titleGrid.partialColumns[${index}]`);
            const styleKey = entityStyleKey(entry.styleKey, `input.sheet.titleGrid.partialColumns[${index}].styleKey`);
            return {
                offset: finite(entry.offset, `input.sheet.titleGrid.partialColumns[${index}].offset`, 0, size[0]),
                height: finite(entry.height, `input.sheet.titleGrid.partialColumns[${index}].height`, 0, size[1]),
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        });
        const segments = (value, label, offsetMax, spanMax)=>{
            if (value != null && !Array.isArray(value)) throw new KJValidationError(`${label} must be an array`);
            if (value?.length && value.length > 64) throw new KJValidationError(`${label} exceed their budget`);
            return (value ?? []).map((segmentValue, index)=>{
                const entry = plain(segmentValue, `${label}[${index}]`);
                exact(entry, [
                    'offset',
                    'start',
                    'end',
                    'styleKey'
                ], `${label}[${index}]`);
                const styleKey = entityStyleKey(entry.styleKey, `${label}[${index}].styleKey`);
                const segment = {
                    offset: finite(entry.offset, `${label}[${index}].offset`, 0, offsetMax),
                    start: finite(entry.start, `${label}[${index}].start`, 0, spanMax),
                    end: finite(entry.end, `${label}[${index}].end`, 0, spanMax),
                    ...styleKey == null ? {} : {
                        styleKey
                    }
                };
                if (segment.start >= segment.end) throw new KJValidationError(`${label}[${index}] start must be less than end`);
                return segment;
            });
        };
        const horizontalSegments = segments(grid.horizontalSegments, 'input.sheet.titleGrid.horizontalSegments', size[1], size[0]);
        const verticalSegments = segments(grid.verticalSegments, 'input.sheet.titleGrid.verticalSegments', size[0], size[1]);
        const diagonal = grid.diagonalHeader == null ? null : plain(grid.diagonalHeader, 'input.sheet.titleGrid.diagonalHeader');
        if (diagonal) exact(diagonal, [
            'width',
            'drop',
            'styleKey'
        ], 'input.sheet.titleGrid.diagonalHeader');
        const topStyleKey = entityStyleKey(grid.topStyleKey, 'input.sheet.titleGrid.topStyleKey');
        const diagonalStyleKey = diagonal == null ? undefined : entityStyleKey(diagonal.styleKey, 'input.sheet.titleGrid.diagonalHeader.styleKey');
        titleGrid = {
            origin,
            size,
            columns,
            rows,
            partialColumns,
            horizontalSegments,
            verticalSegments,
            ...topStyleKey == null ? {} : {
                topStyleKey
            },
            ...diagonal ? {
                diagonalHeader: {
                    width: finite(diagonal.width, 'input.sheet.titleGrid.diagonalHeader.width', 0, size[0]),
                    drop: finite(diagonal.drop, 'input.sheet.titleGrid.diagonalHeader.drop', 0, size[1]),
                    ...diagonalStyleKey == null ? {} : {
                        styleKey: diagonalStyleKey
                    }
                }
            } : {}
        };
    }
    if (sheet.notes != null && !Array.isArray(sheet.notes)) throw new KJValidationError('input.sheet.notes must be an array');
    if (sheet.notes?.length && sheet.notes.length > 128) throw new KJValidationError('input.sheet.notes exceed their budget');
    let noteCharacters = 0;
    const notes = (sheet.notes ?? []).map((value, index)=>{
        const note = plain(value, `input.sheet.notes[${index}]`);
        exact(note, [
            'kind',
            'text',
            'position',
            'height',
            'rotation',
            'width',
            'attachmentPoint',
            'styleKey',
            'entityStyleKey'
        ], `input.sheet.notes[${index}]`);
        if (note.kind !== 'single-line' && note.kind !== 'multiline') throw new KJValidationError(`input.sheet.notes[${index}].kind is invalid`);
        if (typeof note.text !== 'string' || !note.text || note.text.length > 512 || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(note.text)) throw new KJValidationError(`input.sheet.notes[${index}].text must be bounded visible text`);
        if (note.kind === 'single-line' && /[\r\n]/u.test(note.text)) throw new KJValidationError(`input.sheet.notes[${index}].text must stay on one line`);
        const text = note.kind === 'multiline' ? note.text.replace(/\r\n?|\n/gu, '\\P') : note.text;
        noteCharacters += text.length;
        if (noteCharacters > 8_192) throw new KJValidationError('input.sheet.notes exceed the text budget');
        const position = point(note.position, `input.sheet.notes[${index}].position`);
        if (position[0] < sheetOrigin[0] || position[0] > sheetOrigin[0] + sheetSize[0] || position[1] < sheetOrigin[1] || position[1] > sheetOrigin[1] + sheetSize[1]) throw new KJValidationError(`input.sheet.notes[${index}].position must lie on the sheet`);
        const height = finite(note.height, `input.sheet.notes[${index}].height`, 0.1, Math.min(...sheetSize) / 4);
        const rotation = note.rotation == null ? 0 : finite(note.rotation, `input.sheet.notes[${index}].rotation`, -Math.PI * 2, Math.PI * 2);
        const width = note.width == null ? undefined : finite(note.width, `input.sheet.notes[${index}].width`, 0.1, sheetSize[0]);
        const attachmentPoint = note.attachmentPoint == null ? undefined : finite(note.attachmentPoint, 'input.sheet.notes[' + index + '].attachmentPoint', 1, 9);
        if (note.kind === 'single-line' && width != null) throw new KJValidationError(`input.sheet.notes[${index}].width is only valid for multiline text`);
        if (attachmentPoint != null && (note.kind !== 'multiline' || !Number.isInteger(attachmentPoint))) throw new KJValidationError('input.sheet.notes[' + index + '].attachmentPoint is only valid as an integer for multiline text');
        const styleKey = annotationStyleKey(note.styleKey, textStyleKeys, `input.sheet.notes[${index}].styleKey`);
        const noteEntityStyleKey = entityStyleKey(note.entityStyleKey, `input.sheet.notes[${index}].entityStyleKey`);
        return {
            kind: note.kind,
            text,
            position,
            height,
            rotation,
            ...width == null ? {} : {
                width
            },
            ...attachmentPoint == null ? {} : {
                attachmentPoint
            },
            ...styleKey == null ? {} : {
                styleKey
            },
            ...noteEntityStyleKey == null ? {} : {
                entityStyleKey: noteEntityStyleKey
            }
        };
    });
    if (input.dimensions != null && !Array.isArray(input.dimensions)) throw new KJValidationError('input.dimensions must be an array');
    if (input.dimensions?.length && input.dimensions.length > 128) throw new KJValidationError('input.dimensions exceed their budget');
    const dimensions = (input.dimensions ?? []).map((value, index)=>{
        const dimension = plain(value, `input.dimensions[${index}]`);
        exact(dimension, [
            'kind',
            'axis',
            'definitionPoints',
            'textPosition',
            'textOverride',
            'rotation',
            'textHeight',
            'arrowSize',
            'styleKey'
        ], `input.dimensions[${index}]`);
        if (![
            'aligned',
            'rotated',
            'diameter',
            'radius',
            'angular',
            'ordinate'
        ].includes(dimension.kind)) throw new KJValidationError(`input.dimensions[${index}].kind is invalid`);
        const axis = dimension.axis;
        if (dimension.kind === 'ordinate' && ![
            'x',
            'y'
        ].includes(axis)) throw new KJValidationError(`input.dimensions[${index}].axis must be x or y for an ordinate dimension`);
        if (dimension.kind !== 'ordinate' && axis != null) throw new KJValidationError(`input.dimensions[${index}].axis is only valid for ordinate dimensions`);
        const requiredPoints = dimension.kind === 'angular' ? 5 : [
            'diameter',
            'radius'
        ].includes(dimension.kind) ? 2 : 3;
        if (!Array.isArray(dimension.definitionPoints) || dimension.definitionPoints.length !== requiredPoints) throw new KJValidationError(`input.dimensions[${index}].definitionPoints must contain ${requiredPoints} points`);
        const definitionPoints = dimension.definitionPoints.map((value, pointIndex)=>point(value, `input.dimensions[${index}].definitionPoints[${pointIndex}]`));
        const textPosition = dimension.textPosition == null ? undefined : point(dimension.textPosition, `input.dimensions[${index}].textPosition`);
        const textOverride = dimension.textOverride == null ? undefined : dimension.textOverride;
        if (textOverride != null && (typeof textOverride !== 'string' || textOverride.length > 128 || /[\r\n\u0000-\u001f\u007f]/u.test(textOverride))) throw new KJValidationError(`input.dimensions[${index}].textOverride must be bounded single-line text`);
        const rotation = dimension.rotation == null ? 0 : finite(dimension.rotation, `input.dimensions[${index}].rotation`, -Math.PI * 2, Math.PI * 2);
        const textHeight = dimension.textHeight == null ? undefined : finite(dimension.textHeight, `input.dimensions[${index}].textHeight`, 1e-12, 1e12);
        const arrowSize = dimension.arrowSize == null ? undefined : finite(dimension.arrowSize, `input.dimensions[${index}].arrowSize`, 0, 1e12);
        const dimensionType = String(dimension.kind).toUpperCase();
        const dxfDimensionType = dimension.kind === 'ordinate' ? axis === 'x' ? 70 : 6 : undefined;
        const payload = {
            dimensionType,
            definitionPoints: definitionPoints.map(([x, y])=>[
                    x,
                    y,
                    0
                ]),
            ...textPosition == null ? {} : {
                textPosition: [
                    ...textPosition,
                    0
                ]
            },
            textOverride: textOverride ?? null,
            rotation,
            ...dxfDimensionType == null ? {} : {
                dxfDimensionType
            },
            ...textHeight == null ? {} : {
                textHeight
            },
            ...arrowSize == null ? {} : {
                arrowSize
            }
        };
        if (!projectDimension(payload)) throw new KJValidationError(`input.dimensions[${index}] does not define a projectable native dimension`);
        const styleKey = annotationStyleKey(dimension.styleKey, dimensionStyleKeys, `input.dimensions[${index}].styleKey`);
        return {
            kind: dimension.kind,
            ...axis == null ? {} : {
                axis: axis
            },
            definitionPoints,
            ...textPosition == null ? {} : {
                textPosition
            },
            ...textOverride == null ? {} : {
                textOverride
            },
            rotation,
            ...textHeight == null ? {} : {
                textHeight
            },
            ...arrowSize == null ? {} : {
                arrowSize
            },
            ...styleKey == null ? {} : {
                styleKey
            }
        };
    });
    if (input.leaders != null && !Array.isArray(input.leaders)) throw new KJValidationError('input.leaders must be an array');
    if (input.leaders?.length && input.leaders.length > 64) throw new KJValidationError('input.leaders exceed their budget');
    const leaders = (input.leaders ?? []).map((value, index)=>{
        const leader = plain(value, `input.leaders[${index}]`);
        exact(leader, [
            'vertices',
            'arrowEnabled',
            'pathType',
            'annotationType',
            'hookLineDirection',
            'hookLineEnabled',
            'textHeight',
            'textWidth',
            'styleKey'
        ], `input.leaders[${index}]`);
        if (!Array.isArray(leader.vertices) || leader.vertices.length < 2 || leader.vertices.length > 64) throw new KJValidationError(`input.leaders[${index}].vertices must contain 2 to 64 points`);
        const vertices = leader.vertices.map((value, pointIndex)=>point(value, `input.leaders[${index}].vertices[${pointIndex}]`));
        const integer = (value, label, max)=>value == null ? 0 : finite(value, label, 0, max);
        const styleKey = entityStyleKey(leader.styleKey, `input.leaders[${index}].styleKey`);
        const textHeight = leader.textHeight == null ? undefined : finite(leader.textHeight, `input.leaders[${index}].textHeight`, 0, 1e9);
        const textWidth = leader.textWidth == null ? undefined : finite(leader.textWidth, `input.leaders[${index}].textWidth`, 0, 1e9);
        return {
            vertices,
            arrowEnabled: leader.arrowEnabled == null ? true : leader.arrowEnabled === true,
            pathType: integer(leader.pathType, `input.leaders[${index}].pathType`, 1),
            annotationType: integer(leader.annotationType, `input.leaders[${index}].annotationType`, 3),
            hookLineDirection: integer(leader.hookLineDirection, `input.leaders[${index}].hookLineDirection`, 1),
            hookLineEnabled: leader.hookLineEnabled === true,
            ...textHeight == null ? {} : {
                textHeight
            },
            ...textWidth == null ? {} : {
                textWidth
            },
            ...styleKey == null ? {} : {
                styleKey
            }
        };
    });
    if (input.featureControlFrames != null && !Array.isArray(input.featureControlFrames)) throw new KJValidationError('input.featureControlFrames must be an array');
    if (input.featureControlFrames?.length && input.featureControlFrames.length > 32) throw new KJValidationError('input.featureControlFrames exceed their budget');
    const characteristics = [
        'position',
        'concentricity',
        'symmetry',
        'parallelism',
        'perpendicularity',
        'angularity',
        'cylindricity',
        'flatness',
        'circularity',
        'straightness',
        'surface-profile',
        'line-profile',
        'circular-runout',
        'total-runout'
    ];
    const conditions = [
        'maximum',
        'least',
        'regardless'
    ];
    const materialCondition = (value, label)=>{
        if (value == null) return undefined;
        if (!conditions.includes(value)) throw new KJValidationError(`${label} is invalid`);
        return value;
    };
    const featureControlFrames = (input.featureControlFrames ?? []).map((value, index)=>{
        const label = `input.featureControlFrames[${index}]`, frame = plain(value, label);
        exact(frame, [
            'position',
            'rows',
            'xAxisDirection',
            'styleKey',
            'role'
        ], label);
        if (frame.role !== 'dimensions' && frame.role !== 'notes') throw new KJValidationError(`${label}.role is invalid`);
        if (!Array.isArray(frame.rows) || !frame.rows.length || frame.rows.length > 4) throw new KJValidationError(`${label}.rows must contain 1 to 4 items`);
        const rows = frame.rows.map((rowValue, rowIndex)=>{
            const rowLabel = `${label}.rows[${rowIndex}]`, row = plain(rowValue, rowLabel);
            exact(row, [
                'characteristic',
                'tolerance',
                'diameterZone',
                'materialCondition',
                'datumReferences'
            ], rowLabel);
            if (!characteristics.includes(row.characteristic)) throw new KJValidationError(`${rowLabel}.characteristic is invalid`);
            if (typeof row.tolerance !== 'string' || !/^[0-9A-Za-z.+\- ]{1,32}$/u.test(row.tolerance)) throw new KJValidationError(`${rowLabel}.tolerance must be bounded frame text`);
            if (row.diameterZone != null && typeof row.diameterZone !== 'boolean') throw new KJValidationError(`${rowLabel}.diameterZone must be boolean`);
            if (row.datumReferences != null && !Array.isArray(row.datumReferences)) throw new KJValidationError(`${rowLabel}.datumReferences must be an array`);
            if (row.datumReferences?.length && row.datumReferences.length > 4) throw new KJValidationError(`${rowLabel}.datumReferences exceed their budget`);
            const datumReferences = (row.datumReferences ?? []).map((datumValue, datumIndex)=>{
                const datumLabel = `${rowLabel}.datumReferences[${datumIndex}]`, datum = plain(datumValue, datumLabel);
                exact(datum, [
                    'label',
                    'materialCondition',
                    'slot'
                ], datumLabel);
                if (typeof datum.label !== 'string' || !/^[A-Z0-9]{1,8}$/u.test(datum.label)) throw new KJValidationError(`${datumLabel}.label must be 1 to 8 uppercase letters or digits`);
                const slot = datum.slot;
                if (slot != null && (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 3)) throw new KJValidationError(`${datumLabel}.slot must be an integer from 0 to 3`);
                const condition = materialCondition(datum.materialCondition, `${datumLabel}.materialCondition`);
                return {
                    label: datum.label,
                    ...condition == null ? {} : {
                        materialCondition: condition
                    },
                    ...typeof slot === 'number' ? {
                        slot
                    } : {}
                };
            });
            const condition = materialCondition(row.materialCondition, `${rowLabel}.materialCondition`);
            const usedSlots = new Set();
            for (const datum of datumReferences){
                if (datum.slot == null) continue;
                if (usedSlots.has(datum.slot)) throw new KJValidationError(`${rowLabel}.datumReferences slots must be unique`);
                usedSlots.add(datum.slot);
            }
            return {
                characteristic: row.characteristic,
                tolerance: row.tolerance,
                diameterZone: row.diameterZone === true,
                ...condition == null ? {} : {
                    materialCondition: condition
                },
                datumReferences
            };
        });
        const xAxisDirection = frame.xAxisDirection == null ? [
            1,
            0
        ] : point(frame.xAxisDirection, `${label}.xAxisDirection`);
        if (Math.hypot(...xAxisDirection) <= 1e-12) throw new KJValidationError(`${label}.xAxisDirection must not be zero`);
        const styleKey = annotationStyleKey(frame.styleKey, dimensionStyleKeys, `${label}.styleKey`);
        return {
            position: point(frame.position, `${label}.position`),
            rows,
            xAxisDirection,
            ...styleKey == null ? {} : {
                styleKey
            },
            role: frame.role
        };
    });
    const validateAbsoluteHatch = (value, label)=>{
        const hatch = plain(value, label);
        exact(hatch, [
            'edges',
            'boundaryLoops',
            'solid',
            'patternName',
            'lineAngle',
            'lineSpacing',
            'patternOrigin',
            'patternLines',
            'styleKey'
        ], label);
        const hasEdges = hatch.edges != null, hasBoundaryLoops = hatch.boundaryLoops != null;
        if (hasEdges === hasBoundaryLoops) throw new KJValidationError(`${label} requires exactly one of edges or boundaryLoops`);
        const loopSource = hasEdges ? [
            {
                edges: hatch.edges,
                external: false,
                flags: 0
            }
        ] : hatch.boundaryLoops;
        if (!Array.isArray(loopSource) || loopSource.length < 1 || loopSource.length > 32) throw new KJValidationError(`${label}.boundaryLoops must contain 1 to 32 loops`);
        let totalEdges = 0, splinePoints = 0;
        const boundaryLoops = loopSource.map((value, loopIndex)=>{
            const loopLabel = `${label}.boundaryLoops[${loopIndex}]`, loop = plain(value, loopLabel);
            exact(loop, [
                'edges',
                'external',
                'flags'
            ], loopLabel);
            if (loop.external != null && typeof loop.external !== 'boolean') throw new KJValidationError(`${loopLabel}.external must be boolean`);
            const flags = loop.flags == null ? 0 : finite(loop.flags, `${loopLabel}.flags`, 0, 65535);
            if (!Number.isInteger(flags)) throw new KJValidationError(`${loopLabel}.flags must be an integer`);
            if (!Array.isArray(loop.edges) || loop.edges.length < 1 || loop.edges.length > 128) throw new KJValidationError(`${loopLabel}.edges must contain 1 to 128 edges`);
            totalEdges += loop.edges.length;
            const edges = loop.edges.map((value, edgeIndex)=>{
                const edgeLabel = `${loopLabel}.edges[${edgeIndex}]`, edge = plain(value, edgeLabel);
                if (edge.kind === 'line') {
                    exact(edge, [
                        'kind',
                        'start',
                        'end'
                    ], edgeLabel);
                    const start = point(edge.start, `${edgeLabel}.start`), end = point(edge.end, `${edgeLabel}.end`);
                    if (start[0] === end[0] && start[1] === end[1]) throw new KJValidationError(`${edgeLabel} must not have zero length`);
                    return {
                        kind: 'line',
                        start,
                        end
                    };
                }
                if (edge.kind === 'arc') {
                    exact(edge, [
                        'kind',
                        'center',
                        'radius',
                        'startAngle',
                        'endAngle',
                        'counterClockwise'
                    ], edgeLabel);
                    if (edge.counterClockwise != null && typeof edge.counterClockwise !== 'boolean') throw new KJValidationError(`${edgeLabel}.counterClockwise must be boolean`);
                    const startAngle = finite(edge.startAngle, `${edgeLabel}.startAngle`, -Math.PI * 4, Math.PI * 4), endAngle = finite(edge.endAngle, `${edgeLabel}.endAngle`, -Math.PI * 4, Math.PI * 4);
                    if (startAngle === endAngle) throw new KJValidationError(`${edgeLabel} arc sweep must not be zero`);
                    return {
                        kind: 'arc',
                        center: point(edge.center, `${edgeLabel}.center`),
                        radius: finite(edge.radius, `${edgeLabel}.radius`, 0.1, 100_000),
                        startAngle,
                        endAngle,
                        counterClockwise: edge.counterClockwise !== false
                    };
                }
                if (edge.kind === 'spline') {
                    exact(edge, [
                        'kind',
                        'degree',
                        'controlPoints',
                        'knots',
                        'weights',
                        'fitPoints',
                        'periodic',
                        'startTangent',
                        'endTangent'
                    ], edgeLabel);
                    if (!Array.isArray(edge.controlPoints)) throw new KJValidationError(`${edgeLabel}.controlPoints must be an array`);
                    if (edge.knots != null && !Array.isArray(edge.knots)) throw new KJValidationError(`${edgeLabel}.knots must be an array`);
                    if (edge.weights != null && !Array.isArray(edge.weights)) throw new KJValidationError(`${edgeLabel}.weights must be an array`);
                    if (edge.fitPoints != null && !Array.isArray(edge.fitPoints)) throw new KJValidationError(`${edgeLabel}.fitPoints must be an array`);
                    if (edge.periodic != null && typeof edge.periodic !== 'boolean') throw new KJValidationError(`${edgeLabel}.periodic must be boolean`);
                    const controlPoints = edge.controlPoints.map((pointValue, pointIndex)=>point(pointValue, `${edgeLabel}.controlPoints[${pointIndex}]`));
                    const fitPoints = (edge.fitPoints ?? []).map((pointValue, pointIndex)=>point(pointValue, `${edgeLabel}.fitPoints[${pointIndex}]`));
                    const startTangent = edge.startTangent == null ? undefined : point(edge.startTangent, `${edgeLabel}.startTangent`);
                    const endTangent = edge.endTangent == null ? undefined : point(edge.endTangent, `${edgeLabel}.endTangent`);
                    const degree = finite(edge.degree, `${edgeLabel}.degree`, 1, 10);
                    if (!Number.isInteger(degree)) throw new KJValidationError(`${edgeLabel}.degree must be an integer`);
                    const normalized = normalizeHatchSplineEdge({
                        type: 'SPLINE',
                        degree,
                        controlPoints: controlPoints.map((value)=>[
                                ...value,
                                0
                            ]),
                        knots: edge.knots,
                        weights: edge.weights,
                        fitPoints: fitPoints.map((value)=>[
                                ...value,
                                0
                            ]),
                        periodic: edge.periodic === true,
                        ...startTangent == null ? {} : {
                            startTangent: [
                                ...startTangent,
                                0
                            ]
                        },
                        ...endTangent == null ? {} : {
                            endTangent: [
                                ...endTangent,
                                0
                            ]
                        }
                    }, edgeLabel);
                    splinePoints += normalized.controlPoints.length + normalized.fitPoints.length;
                    return {
                        kind: 'spline',
                        degree: normalized.degree,
                        controlPoints,
                        knots: [
                            ...normalized.knots
                        ],
                        weights: [
                            ...normalized.weights
                        ],
                        fitPoints,
                        periodic: normalized.periodic,
                        ...startTangent == null ? {} : {
                            startTangent
                        },
                        ...endTangent == null ? {} : {
                            endTangent
                        }
                    };
                }
                throw new KJValidationError(`${edgeLabel}.kind is invalid`);
            });
            return {
                external: loop.external === true,
                flags,
                edges
            };
        });
        if (totalEdges > 256) throw new KJValidationError(`${label}.boundaryLoops exceed the 256-edge budget`);
        if (splinePoints > 4096) throw new KJValidationError(`${label}.boundaryLoops exceed the 4096-spline-point budget`);
        if (hatch.solid != null && typeof hatch.solid !== 'boolean') throw new KJValidationError(`${label}.solid must be boolean`);
        const solid = hatch.solid === true;
        const patternName = hatch.patternName == null ? solid ? 'SOLID' : 'ANSI31' : resourceKey(hatch.patternName, `${label}.patternName`);
        if (solid && (hatch.lineAngle != null || hatch.lineSpacing != null || hatch.patternOrigin != null || hatch.patternLines != null)) throw new KJValidationError(`${label} solid fills must not define pattern lines`);
        if (!solid && hatch.patternLines != null && (hatch.lineAngle != null || hatch.lineSpacing != null || hatch.patternOrigin != null)) throw new KJValidationError(`${label} explicit patternLines cannot be combined with the one-family shorthand`);
        if (!solid && hatch.patternLines == null && (hatch.lineAngle == null || hatch.lineSpacing == null)) throw new KJValidationError(`${label} patterned fills require patternLines or lineAngle and lineSpacing`);
        if (hatch.patternLines != null && (!Array.isArray(hatch.patternLines) || hatch.patternLines.length < 1 || hatch.patternLines.length > 16)) throw new KJValidationError(`${label}.patternLines must contain 1 to 16 line families`);
        const patternLines = solid ? [] : hatch.patternLines == null ? (()=>{
            const lineAngle = finite(hatch.lineAngle, `${label}.lineAngle`, -Math.PI * 2, Math.PI * 2), lineSpacing = finite(hatch.lineSpacing, `${label}.lineSpacing`, 0.01, 100_000);
            const patternOrigin = hatch.patternOrigin == null ? [
                0,
                0
            ] : point(hatch.patternOrigin, `${label}.patternOrigin`);
            return [
                {
                    angle: lineAngle,
                    base: patternOrigin,
                    offset: [
                        -Math.sin(lineAngle) * lineSpacing,
                        Math.cos(lineAngle) * lineSpacing
                    ],
                    dashes: []
                }
            ];
        })() : hatch.patternLines.map((value, patternIndex)=>{
            const lineLabel = `${label}.patternLines[${patternIndex}]`, patternLine = plain(value, lineLabel);
            exact(patternLine, [
                'angle',
                'base',
                'offset',
                'dashes'
            ], lineLabel);
            const angle = finite(patternLine.angle, `${lineLabel}.angle`, -Math.PI * 2, Math.PI * 2), base = point(patternLine.base, `${lineLabel}.base`), offset = point(patternLine.offset, `${lineLabel}.offset`);
            if (offset[0] === 0 && offset[1] === 0) throw new KJValidationError(`${lineLabel}.offset must not be zero`);
            if (patternLine.dashes != null && (!Array.isArray(patternLine.dashes) || patternLine.dashes.length > 32)) throw new KJValidationError(`${lineLabel}.dashes must be an array with at most 32 items`);
            return {
                angle,
                base,
                offset,
                dashes: (patternLine.dashes ?? []).map((dash, dashIndex)=>finite(dash, `${lineLabel}.dashes[${dashIndex}]`, -100_000, 100_000))
            };
        });
        const styleKey = entityStyleKey(hatch.styleKey, `${label}.styleKey`);
        return {
            boundaryLoops,
            solid,
            patternName,
            patternLines,
            ...styleKey == null ? {} : {
                styleKey
            }
        };
    };
    if (input.auxiliaryHatches != null && !Array.isArray(input.auxiliaryHatches)) throw new KJValidationError('input.auxiliaryHatches must be an array');
    if (input.auxiliaryHatches?.length && input.auxiliaryHatches.length > 64) throw new KJValidationError('input.auxiliaryHatches exceed their budget');
    const auxiliaryHatches = (input.auxiliaryHatches ?? []).map((value, hatchIndex)=>validateAbsoluteHatch(value, `input.auxiliaryHatches[${hatchIndex}]`));
    let pointDisplay = null;
    if (input.pointDisplay != null) {
        const display = plain(input.pointDisplay, 'input.pointDisplay');
        exact(display, [
            'mode',
            'size'
        ], 'input.pointDisplay');
        const mode = finite(display.mode, 'input.pointDisplay.mode', 0, 100);
        if (!Number.isInteger(mode) || (mode & 31) > 4 || ![
            0,
            32,
            64,
            96
        ].includes(mode & ~31)) throw new KJValidationError('input.pointDisplay.mode must be a legal PDMODE combination');
        pointDisplay = {
            mode,
            size: finite(display.size, 'input.pointDisplay.size', -100, 1_000_000)
        };
    }
    if (input.auxiliaryPoints != null && !Array.isArray(input.auxiliaryPoints)) throw new KJValidationError('input.auxiliaryPoints must be an array');
    if (input.auxiliaryPoints?.length && input.auxiliaryPoints.length > 256) throw new KJValidationError('input.auxiliaryPoints exceed their 256-point budget');
    const auxiliaryPoints = (input.auxiliaryPoints ?? []).map((value, index)=>{
        const label = `input.auxiliaryPoints[${index}]`, item = plain(value, label);
        exact(item, [
            'position',
            'role',
            'styleKey'
        ], label);
        if (![
            'geometry',
            'center',
            'hidden',
            'notes',
            'grid',
            'frame'
        ].includes(item.role)) throw new KJValidationError(`${label}.role is invalid`);
        const styleKey = entityStyleKey(item.styleKey, `${label}.styleKey`);
        return {
            position: point(item.position, `${label}.position`),
            role: item.role,
            ...styleKey == null ? {} : {
                styleKey
            }
        };
    });
    if (input.auxiliaryLines != null && !Array.isArray(input.auxiliaryLines)) throw new KJValidationError('input.auxiliaryLines must be an array');
    if (input.auxiliaryLines?.length && input.auxiliaryLines.length > MAX_AUXILIARY_LINES) throw new KJValidationError(`input.auxiliaryLines exceed their ${MAX_AUXILIARY_LINES}-line budget`);
    const auxiliaryLines = (input.auxiliaryLines ?? []).map((value, index)=>{
        const label = `input.auxiliaryLines[${index}]`, line = plain(value, label);
        exact(line, [
            'start',
            'end',
            'role',
            'styleKey'
        ], label);
        if (![
            'geometry',
            'center',
            'hidden',
            'notes',
            'grid',
            'frame'
        ].includes(line.role)) throw new KJValidationError(`${label}.role is invalid`);
        const start = point(line.start, `${label}.start`), end = point(line.end, `${label}.end`);
        if (start[0] === end[0] && start[1] === end[1]) throw new KJValidationError(`${label} must not have zero length`);
        const styleKey = entityStyleKey(line.styleKey, `${label}.styleKey`);
        return {
            start,
            end,
            role: line.role,
            ...styleKey == null ? {} : {
                styleKey
            }
        };
    });
    if (input.auxiliarySolids != null && !Array.isArray(input.auxiliarySolids)) throw new KJValidationError('input.auxiliarySolids must be an array');
    if (input.auxiliarySolids?.length && input.auxiliarySolids.length > 64) throw new KJValidationError('input.auxiliarySolids exceed their 64-solid budget');
    const auxiliarySolids = (input.auxiliarySolids ?? []).map((value, index)=>{
        const label = `input.auxiliarySolids[${index}]`, solid = plain(value, label);
        exact(solid, [
            'vertices',
            'role',
            'styleKey'
        ], label);
        if (![
            'geometry',
            'center',
            'hidden',
            'notes',
            'grid',
            'frame'
        ].includes(solid.role)) throw new KJValidationError(`${label}.role is invalid`);
        if (!Array.isArray(solid.vertices) || solid.vertices.length < 3 || solid.vertices.length > 4) throw new KJValidationError(`${label}.vertices must contain 3 or 4 points`);
        const vertices = solid.vertices.map((value, vertexIndex)=>point(value, `${label}.vertices[${vertexIndex}]`));
        let nondegenerate = false;
        for(let a = 0; a < vertices.length; a++)for(let b = a + 1; b < vertices.length; b++)for(let c = b + 1; c < vertices.length; c++){
            const ab = [
                vertices[b][0] - vertices[a][0],
                vertices[b][1] - vertices[a][1]
            ], ac = [
                vertices[c][0] - vertices[a][0],
                vertices[c][1] - vertices[a][1]
            ];
            if (Math.abs(ab[0] * ac[1] - ab[1] * ac[0]) > 1e-12) nondegenerate = true;
        }
        if (!nondegenerate) throw new KJValidationError(`${label}.vertices must span a nonzero area`);
        const styleKey = entityStyleKey(solid.styleKey, `${label}.styleKey`);
        return {
            vertices,
            role: solid.role,
            ...styleKey == null ? {} : {
                styleKey
            }
        };
    });
    if (input.auxiliaryWipeouts != null && !Array.isArray(input.auxiliaryWipeouts)) throw new KJValidationError('input.auxiliaryWipeouts must be an array');
    if (input.auxiliaryWipeouts?.length && input.auxiliaryWipeouts.length > 64) throw new KJValidationError('input.auxiliaryWipeouts exceed their 64-wipeout budget');
    const auxiliaryWipeouts = (input.auxiliaryWipeouts ?? []).map((value, index)=>{
        const label = `input.auxiliaryWipeouts[${index}]`, wipeout = plain(value, label);
        exact(wipeout, [
            'position',
            'uVector',
            'vVector',
            'clipBoundary',
            'boundaryType',
            'role',
            'styleKey'
        ], label);
        if (![
            'geometry',
            'center',
            'hidden',
            'notes',
            'grid',
            'frame'
        ].includes(wipeout.role)) throw new KJValidationError(`${label}.role is invalid`);
        const position = point(wipeout.position, `${label}.position`), uVector = point(wipeout.uVector, `${label}.uVector`), vVector = point(wipeout.vVector, `${label}.vVector`);
        if (Math.abs(uVector[0] * vVector[1] - uVector[1] * vVector[0]) <= 1e-12) throw new KJValidationError(`${label}.uVector and vVector must span a nonzero plane`);
        if (!Array.isArray(wipeout.clipBoundary) || wipeout.clipBoundary.length < 2 || wipeout.clipBoundary.length > 128) throw new KJValidationError(`${label}.clipBoundary must contain 2 to 128 points`);
        const clipBoundary = wipeout.clipBoundary.map((value, pointIndex)=>point(value, `${label}.clipBoundary[${pointIndex}]`));
        const boundaryType = finite(wipeout.boundaryType, `${label}.boundaryType`, 1, 2);
        if (!Number.isInteger(boundaryType)) throw new KJValidationError(`${label}.boundaryType must be 1 or 2`);
        if (boundaryType === 1 && clipBoundary.length !== 2) throw new KJValidationError(`${label} rectangular clipBoundary must contain exactly 2 points`);
        if (boundaryType === 2 && clipBoundary.length < 3) throw new KJValidationError(`${label} polygonal clipBoundary must contain at least 3 points`);
        const area = boundaryType === 1 ? Math.abs((clipBoundary[1][0] - clipBoundary[0][0]) * (clipBoundary[1][1] - clipBoundary[0][1])) : Math.abs(clipBoundary.reduce((sum, value, pointIndex)=>{
            const next = clipBoundary[(pointIndex + 1) % clipBoundary.length];
            return sum + value[0] * next[1] - next[0] * value[1];
        }, 0));
        if (area <= 1e-12) throw new KJValidationError(`${label}.clipBoundary must span a nonzero area`);
        const styleKey = entityStyleKey(wipeout.styleKey, `${label}.styleKey`);
        return {
            position,
            uVector,
            vVector,
            clipBoundary,
            boundaryType: boundaryType,
            role: wipeout.role,
            ...styleKey == null ? {} : {
                styleKey
            }
        };
    });
    if (input.auxiliaryCurves != null && !Array.isArray(input.auxiliaryCurves)) throw new KJValidationError('input.auxiliaryCurves must be an array');
    if (input.auxiliaryCurves?.length && input.auxiliaryCurves.length > MAX_AUXILIARY_CURVES) throw new KJValidationError(`input.auxiliaryCurves exceed their ${MAX_AUXILIARY_CURVES}-curve budget`);
    const auxiliaryCurves = (input.auxiliaryCurves ?? []).map((value, index)=>{
        const label = `input.auxiliaryCurves[${index}]`, curve = plain(value, label);
        if (![
            'geometry',
            'center',
            'hidden',
            'notes',
            'grid',
            'frame'
        ].includes(curve.role)) throw new KJValidationError(`${label}.role is invalid`);
        const role = curve.role;
        const styleKey = entityStyleKey(curve.styleKey, `${label}.styleKey`);
        if (curve.kind === 'arc') {
            exact(curve, [
                'kind',
                'center',
                'radius',
                'startAngle',
                'endAngle',
                'clockwise',
                'role',
                'styleKey'
            ], label);
            const startAngle = finite(curve.startAngle, `${label}.startAngle`, -Math.PI * 4, Math.PI * 4), endAngle = finite(curve.endAngle, `${label}.endAngle`, -Math.PI * 4, Math.PI * 4);
            if (startAngle === endAngle) throw new KJValidationError(`${label} arc sweep must not be zero`);
            if (curve.clockwise != null && typeof curve.clockwise !== 'boolean') throw new KJValidationError(`${label}.clockwise must be boolean`);
            return {
                kind: 'arc',
                center: point(curve.center, `${label}.center`),
                radius: finite(curve.radius, `${label}.radius`, MIN_AUXILIARY_ARC_RADIUS, 100_000),
                startAngle,
                endAngle,
                clockwise: curve.clockwise === true,
                role,
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        }
        if (curve.kind === 'ellipse') {
            exact(curve, [
                'kind',
                'center',
                'majorAxis',
                'ratio',
                'startParameter',
                'endParameter',
                'role',
                'styleKey'
            ], label);
            const majorAxis = point(curve.majorAxis, `${label}.majorAxis`);
            if (Math.hypot(...majorAxis) <= 1e-12) throw new KJValidationError(`${label}.majorAxis must not be zero`);
            return {
                kind: 'ellipse',
                center: point(curve.center, `${label}.center`),
                majorAxis,
                ratio: finite(curve.ratio, `${label}.ratio`, 1e-9, 1),
                startParameter: finite(curve.startParameter, `${label}.startParameter`, -Math.PI * 4, Math.PI * 4),
                endParameter: finite(curve.endParameter, `${label}.endParameter`, -Math.PI * 4, Math.PI * 4),
                role,
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        }
        if (curve.kind === 'polyline') {
            exact(curve, [
                'kind',
                'vertices',
                'closed',
                'role',
                'styleKey'
            ], label);
            if (!Array.isArray(curve.vertices) || curve.vertices.length < 2 || curve.vertices.length > 4096) throw new KJValidationError(`${label}.vertices must contain 2 to 4096 points`);
            const vertices = curve.vertices.map((value, vertexIndex)=>{
                const vertexLabel = `${label}.vertices[${vertexIndex}]`, vertex = plain(value, vertexLabel);
                exact(vertex, [
                    'point',
                    'bulge',
                    'startWidth',
                    'endWidth'
                ], vertexLabel);
                return {
                    point: point(vertex.point, `${vertexLabel}.point`),
                    bulge: finite(vertex.bulge ?? 0, `${vertexLabel}.bulge`, -1e6, 1e6),
                    startWidth: finite(vertex.startWidth ?? 0, `${vertexLabel}.startWidth`, 0, 1e6),
                    endWidth: finite(vertex.endWidth ?? 0, `${vertexLabel}.endWidth`, 0, 1e6)
                };
            });
            return {
                kind: 'polyline',
                vertices,
                closed: curve.closed === true,
                role,
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        }
        if (curve.kind === 'spline') {
            exact(curve, [
                'kind',
                'degree',
                'controlPoints',
                'knots',
                'fitPoints',
                'weights',
                'closed',
                'periodic',
                'role',
                'styleKey'
            ], label);
            const degree = finite(curve.degree, `${label}.degree`, 1, 10);
            if (!Number.isInteger(degree)) throw new KJValidationError(`${label}.degree must be an integer`);
            if (!Array.isArray(curve.controlPoints) || curve.controlPoints.length < degree + 1 || curve.controlPoints.length > 4096) throw new KJValidationError(`${label}.controlPoints are invalid`);
            const controlPoints = curve.controlPoints.map((value, pointIndex)=>point(value, `${label}.controlPoints[${pointIndex}]`));
            if (!Array.isArray(curve.knots) || curve.knots.length !== controlPoints.length + degree + 1) throw new KJValidationError(`${label}.knots length is invalid`);
            const knots = curve.knots.map((value, knotIndex)=>finite(value, `${label}.knots[${knotIndex}]`, -1e12, 1e12));
            if (knots.some((value, knotIndex)=>knotIndex > 0 && value < knots[knotIndex - 1])) throw new KJValidationError(`${label}.knots must not decrease`);
            const fitPoints = curve.fitPoints == null ? [] : Array.isArray(curve.fitPoints) ? curve.fitPoints.map((value, pointIndex)=>point(value, `${label}.fitPoints[${pointIndex}]`)) : (()=>{
                throw new KJValidationError(`${label}.fitPoints must be an array`);
            })();
            const weights = curve.weights == null ? [] : Array.isArray(curve.weights) ? curve.weights.map((value, weightIndex)=>finite(value, `${label}.weights[${weightIndex}]`, 1e-12, 1e12)) : (()=>{
                throw new KJValidationError(`${label}.weights must be an array`);
            })();
            if (weights.length && weights.length !== controlPoints.length) throw new KJValidationError(`${label}.weights length is invalid`);
            return {
                kind: 'spline',
                degree,
                controlPoints,
                knots,
                fitPoints,
                weights,
                closed: curve.closed === true,
                periodic: curve.periodic === true,
                role,
                ...styleKey == null ? {} : {
                    styleKey
                }
            };
        }
        throw new KJValidationError(`${label}.kind is invalid`);
    });
    const symbolSource = input.symbols == null ? {
        definitions: [],
        instances: []
    } : plain(input.symbols, 'input.symbols');
    exact(symbolSource, [
        'definitions',
        'instances'
    ], 'input.symbols');
    if (!Array.isArray(symbolSource.definitions) || symbolSource.definitions.length > MAX_SYMBOL_DEFINITIONS) throw new KJValidationError(`input.symbols.definitions must contain at most ${MAX_SYMBOL_DEFINITIONS} items`);
    if (!Array.isArray(symbolSource.instances) || symbolSource.instances.length > MAX_SYMBOL_INSTANCES) throw new KJValidationError(`input.symbols.instances must contain at most ${MAX_SYMBOL_INSTANCES} items`);
    const symbolKeys = new Set();
    let symbolMemberCount = 0, symbolTextCharacters = 0;
    const symbolRole = (value, label)=>{
        if (![
            'geometry',
            'center',
            'hidden',
            'notes',
            'grid',
            'frame'
        ].includes(value)) throw new KJValidationError(`${label} is invalid`);
        return value;
    };
    let symbolAttributeCount = 0;
    const symbolAttribute = (value, label, member = false)=>{
        const attribute = plain(value, label);
        exact(attribute, [
            ...member ? [
                'kind'
            ] : [],
            'text',
            'tag',
            'prompt',
            'position',
            'alignmentPoint',
            'height',
            'rotation',
            'widthFactor',
            'obliqueAngle',
            'horizontalAlignment',
            'verticalAlignment',
            'generationFlags',
            'flags',
            'lockPosition',
            'styleKey',
            'role',
            'entityStyleKey'
        ], label);
        if (typeof attribute.text !== 'string' || attribute.text.length > 512 || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(attribute.text)) throw new KJValidationError(`${label}.text must be bounded visible text`);
        if (typeof attribute.tag !== 'string' || !attribute.tag.trim() || attribute.tag !== attribute.tag.trim() || attribute.tag.length > 64 || /[\u0000-\u001f\u007f]/u.test(attribute.tag)) throw new KJValidationError(`${label}.tag must be bounded printable text`);
        if (attribute.prompt != null && (typeof attribute.prompt !== 'string' || attribute.prompt.length > 256 || /[\u0000-\u001f\u007f]/u.test(attribute.prompt))) throw new KJValidationError(`${label}.prompt must be bounded printable text`);
        if (attribute.lockPosition != null && typeof attribute.lockPosition !== 'boolean') throw new KJValidationError(`${label}.lockPosition must be boolean`);
        symbolTextCharacters += attribute.text.length + (typeof attribute.prompt === 'string' ? attribute.prompt.length : 0);
        if (symbolTextCharacters > 8_192) throw new KJValidationError('input.symbols exceed the text budget');
        if (++symbolAttributeCount > 256) throw new KJValidationError('input.symbols exceed the attribute budget');
        const integer = (source, field, min, max)=>{
            if (source == null) return undefined;
            const result = finite(source, `${label}.${field}`, min, max);
            if (!Number.isInteger(result)) throw new KJValidationError(`${label}.${field} must be an integer`);
            return result;
        };
        const styleKey = annotationStyleKey(attribute.styleKey, textStyleKeys, `${label}.styleKey`);
        const entityStyleKeyValue = entityStyleKey(attribute.entityStyleKey, `${label}.entityStyleKey`);
        const horizontalAlignment = integer(attribute.horizontalAlignment, 'horizontalAlignment', 0, 5);
        const verticalAlignment = integer(attribute.verticalAlignment, 'verticalAlignment', 0, 4);
        const generationFlags = integer(attribute.generationFlags, 'generationFlags', 0, 65535);
        const flags = integer(attribute.flags, 'flags', 0, 65535);
        return {
            text: attribute.text,
            tag: attribute.tag,
            ...attribute.prompt == null ? {} : {
                prompt: attribute.prompt
            },
            position: point(attribute.position, `${label}.position`),
            ...attribute.alignmentPoint == null ? {} : {
                alignmentPoint: point(attribute.alignmentPoint, `${label}.alignmentPoint`)
            },
            height: finite(attribute.height, `${label}.height`, 0.000_001, 100_000),
            ...attribute.rotation == null ? {} : {
                rotation: finite(attribute.rotation, `${label}.rotation`, -Math.PI * 4, Math.PI * 4)
            },
            ...attribute.widthFactor == null ? {} : {
                widthFactor: finite(attribute.widthFactor, `${label}.widthFactor`, 0.000_001, 1_000_000)
            },
            ...attribute.obliqueAngle == null ? {} : {
                obliqueAngle: finite(attribute.obliqueAngle, `${label}.obliqueAngle`, -Math.PI * 2, Math.PI * 2)
            },
            ...horizontalAlignment == null ? {} : {
                horizontalAlignment
            },
            ...verticalAlignment == null ? {} : {
                verticalAlignment
            },
            ...generationFlags == null ? {} : {
                generationFlags
            },
            ...flags == null ? {} : {
                flags
            },
            ...attribute.lockPosition == null ? {} : {
                lockPosition: attribute.lockPosition
            },
            ...styleKey == null ? {} : {
                styleKey
            },
            role: symbolRole(attribute.role, `${label}.role`),
            ...entityStyleKeyValue == null ? {} : {
                entityStyleKey: entityStyleKeyValue
            }
        };
    };
    const symbolDefinitions = symbolSource.definitions.map((value, index)=>{
        const label = `input.symbols.definitions[${index}]`, definition = plain(value, label);
        exact(definition, [
            'key',
            'basePoint',
            'members'
        ], label);
        if (typeof definition.key !== 'string' || !definition.key.trim() || definition.key !== definition.key.trim() || definition.key.length > 96 || /[\u0000-\u001f\u007f]/u.test(definition.key)) throw new KJValidationError(`${label}.key must be bounded printable text`);
        if (symbolKeys.has(definition.key)) throw new KJValidationError(`${label}.key must be unique`);
        symbolKeys.add(definition.key);
        if (!Array.isArray(definition.members) || definition.members.length > MAX_SYMBOL_MEMBERS_PER_DEFINITION) throw new KJValidationError(`${label}.members must contain at most ${MAX_SYMBOL_MEMBERS_PER_DEFINITION} items`);
        symbolMemberCount += definition.members.length;
        if (symbolMemberCount > MAX_SYMBOL_MEMBERS_TOTAL) throw new KJValidationError(`input.symbols exceed the ${MAX_SYMBOL_MEMBERS_TOTAL} total-member budget`);
        const members = definition.members.map((memberValue, memberIndex)=>{
            const memberLabel = `${label}.members[${memberIndex}]`, member = plain(memberValue, memberLabel), role = symbolRole(member.role, `${memberLabel}.role`);
            const entityStyleKeyValue = entityStyleKey(member.entityStyleKey, `${memberLabel}.entityStyleKey`);
            if (member.kind === 'line') {
                exact(member, [
                    'kind',
                    'start',
                    'end',
                    'role',
                    'entityStyleKey'
                ], memberLabel);
                const start = point(member.start, `${memberLabel}.start`), end = point(member.end, `${memberLabel}.end`);
                if (start[0] === end[0] && start[1] === end[1]) throw new KJValidationError(`${memberLabel} must not have zero length`);
                return {
                    kind: 'line',
                    start,
                    end,
                    role,
                    ...entityStyleKeyValue == null ? {} : {
                        entityStyleKey: entityStyleKeyValue
                    }
                };
            }
            if (member.kind === 'circle') {
                exact(member, [
                    'kind',
                    'center',
                    'radius',
                    'role',
                    'entityStyleKey'
                ], memberLabel);
                return {
                    kind: 'circle',
                    center: point(member.center, `${memberLabel}.center`),
                    radius: finite(member.radius, `${memberLabel}.radius`, 0.000_001, 100_000),
                    role,
                    ...entityStyleKeyValue == null ? {} : {
                        entityStyleKey: entityStyleKeyValue
                    }
                };
            }
            if (member.kind === 'arc') {
                exact(member, [
                    'kind',
                    'center',
                    'radius',
                    'startAngle',
                    'endAngle',
                    'clockwise',
                    'role',
                    'entityStyleKey'
                ], memberLabel);
                const startAngle = finite(member.startAngle, `${memberLabel}.startAngle`, -Math.PI * 4, Math.PI * 4), endAngle = finite(member.endAngle, `${memberLabel}.endAngle`, -Math.PI * 4, Math.PI * 4);
                if (startAngle === endAngle) throw new KJValidationError(`${memberLabel} arc sweep must not be zero`);
                if (member.clockwise != null && typeof member.clockwise !== 'boolean') throw new KJValidationError(`${memberLabel}.clockwise must be boolean`);
                return {
                    kind: 'arc',
                    center: point(member.center, `${memberLabel}.center`),
                    radius: finite(member.radius, `${memberLabel}.radius`, 0.000_001, 100_000),
                    startAngle,
                    endAngle,
                    clockwise: member.clockwise === true,
                    role,
                    ...entityStyleKeyValue == null ? {} : {
                        entityStyleKey: entityStyleKeyValue
                    }
                };
            }
            if (member.kind === 'single-line-text') {
                exact(member, [
                    'kind',
                    'text',
                    'position',
                    'alignmentPoint',
                    'height',
                    'rotation',
                    'widthFactor',
                    'obliqueAngle',
                    'horizontalAlignment',
                    'verticalAlignment',
                    'generationFlags',
                    'styleKey',
                    'role',
                    'entityStyleKey'
                ], memberLabel);
                if (typeof member.text !== 'string' || !member.text || member.text.length > 512 || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(member.text)) throw new KJValidationError(`${memberLabel}.text must be bounded visible text`);
                symbolTextCharacters += member.text.length;
                if (symbolTextCharacters > 8_192) throw new KJValidationError('input.symbols exceed the text budget');
                const integer = (value, field, min, max)=>{
                    if (value == null) return undefined;
                    const result = finite(value, `${memberLabel}.${field}`, min, max);
                    if (!Number.isInteger(result)) throw new KJValidationError(`${memberLabel}.${field} must be an integer`);
                    return result;
                };
                const styleKey = annotationStyleKey(member.styleKey, textStyleKeys, `${memberLabel}.styleKey`);
                const horizontalAlignment = integer(member.horizontalAlignment, 'horizontalAlignment', 0, 5), verticalAlignment = integer(member.verticalAlignment, 'verticalAlignment', 0, 4);
                const generationFlags = integer(member.generationFlags, 'generationFlags', 0, 65535);
                return {
                    kind: 'single-line-text',
                    text: member.text,
                    position: point(member.position, `${memberLabel}.position`),
                    ...member.alignmentPoint == null ? {} : {
                        alignmentPoint: point(member.alignmentPoint, `${memberLabel}.alignmentPoint`)
                    },
                    height: finite(member.height, `${memberLabel}.height`, 0.000_001, 100_000),
                    rotation: member.rotation == null ? 0 : finite(member.rotation, `${memberLabel}.rotation`, -Math.PI * 4, Math.PI * 4),
                    ...member.widthFactor == null ? {} : {
                        widthFactor: finite(member.widthFactor, `${memberLabel}.widthFactor`, 0.000_001, 1_000_000)
                    },
                    ...member.obliqueAngle == null ? {} : {
                        obliqueAngle: finite(member.obliqueAngle, `${memberLabel}.obliqueAngle`, -Math.PI * 2, Math.PI * 2)
                    },
                    ...horizontalAlignment == null ? {} : {
                        horizontalAlignment
                    },
                    ...verticalAlignment == null ? {} : {
                        verticalAlignment
                    },
                    ...generationFlags == null ? {} : {
                        generationFlags
                    },
                    ...styleKey == null ? {} : {
                        styleKey
                    },
                    role,
                    ...entityStyleKeyValue == null ? {} : {
                        entityStyleKey: entityStyleKeyValue
                    }
                };
            }
            if (member.kind === 'hatch') {
                exact(member, [
                    'kind',
                    'edges',
                    'boundaryLoops',
                    'solid',
                    'patternName',
                    'lineAngle',
                    'lineSpacing',
                    'patternOrigin',
                    'patternLines',
                    'role',
                    'entityStyleKey'
                ], memberLabel);
                const { kind: _kind, role: _role, entityStyleKey: _entityStyleKey, ...hatchSource } = member;
                const { styleKey: _styleKey, ...hatch } = validateAbsoluteHatch(hatchSource, memberLabel);
                return {
                    kind: 'hatch',
                    ...hatch,
                    role,
                    ...entityStyleKeyValue == null ? {} : {
                        entityStyleKey: entityStyleKeyValue
                    }
                };
            }
            if (member.kind === 'solid') {
                exact(member, [
                    'kind',
                    'vertices',
                    'role',
                    'entityStyleKey'
                ], memberLabel);
                if (!Array.isArray(member.vertices) || member.vertices.length < 3 || member.vertices.length > 4) throw new KJValidationError(`${memberLabel}.vertices must contain 3 or 4 points`);
                const vertices = member.vertices.map((value, vertexIndex)=>point(value, `${memberLabel}.vertices[${vertexIndex}]`));
                let nondegenerate = false;
                for(let a = 0; a < vertices.length; a++)for(let b = a + 1; b < vertices.length; b++)for(let c = b + 1; c < vertices.length; c++){
                    const ab = [
                        vertices[b][0] - vertices[a][0],
                        vertices[b][1] - vertices[a][1]
                    ], ac = [
                        vertices[c][0] - vertices[a][0],
                        vertices[c][1] - vertices[a][1]
                    ];
                    if (Math.abs(ab[0] * ac[1] - ab[1] * ac[0]) > 1e-12) nondegenerate = true;
                }
                if (!nondegenerate) throw new KJValidationError(`${memberLabel}.vertices must span a nonzero area`);
                return {
                    kind: 'solid',
                    vertices,
                    role,
                    ...entityStyleKeyValue == null ? {} : {
                        entityStyleKey: entityStyleKeyValue
                    }
                };
            }
            if (member.kind === 'multiline-text') {
                exact(member, [
                    'kind',
                    'text',
                    'position',
                    'height',
                    'rotation',
                    'width',
                    'attachmentPoint',
                    'styleKey',
                    'role',
                    'entityStyleKey'
                ], memberLabel);
                if (typeof member.text !== 'string' || !member.text || member.text.length > 512 || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(member.text)) throw new KJValidationError(`${memberLabel}.text must be bounded visible text`);
                symbolTextCharacters += member.text.length;
                if (symbolTextCharacters > 8_192) throw new KJValidationError('input.symbols exceed the text budget');
                const attachmentPoint = member.attachmentPoint == null ? 1 : finite(member.attachmentPoint, `${memberLabel}.attachmentPoint`, 1, 9);
                if (!Number.isInteger(attachmentPoint)) throw new KJValidationError(`${memberLabel}.attachmentPoint must be an integer`);
                const styleKey = annotationStyleKey(member.styleKey, textStyleKeys, `${memberLabel}.styleKey`);
                return {
                    kind: 'multiline-text',
                    text: member.text,
                    position: point(member.position, `${memberLabel}.position`),
                    height: finite(member.height, `${memberLabel}.height`, 0.000_001, 100_000),
                    rotation: member.rotation == null ? 0 : finite(member.rotation, `${memberLabel}.rotation`, -Math.PI * 4, Math.PI * 4),
                    ...member.width == null ? {} : {
                        width: finite(member.width, `${memberLabel}.width`, 0.000_001, 1_000_000)
                    },
                    attachmentPoint,
                    ...styleKey == null ? {} : {
                        styleKey
                    },
                    role,
                    ...entityStyleKeyValue == null ? {} : {
                        entityStyleKey: entityStyleKeyValue
                    }
                };
            }
            if (member.kind === 'attribute-definition') return {
                kind: 'attribute-definition',
                ...symbolAttribute(member, memberLabel, true)
            };
            if (member.kind === 'instance') {
                exact(member, [
                    'kind',
                    'symbolKey',
                    'position',
                    'scale',
                    'rotation',
                    'role',
                    'entityStyleKey'
                ], memberLabel);
                if (typeof member.symbolKey !== 'string' || !member.symbolKey.trim() || member.symbolKey.length > 96 || /[\u0000-\u001f\u007f]/u.test(member.symbolKey)) throw new KJValidationError(`${memberLabel}.symbolKey must be bounded printable text`);
                const scaleSource = member.scale ?? [
                    1,
                    1
                ];
                if (!Array.isArray(scaleSource) || scaleSource.length !== 2) throw new KJValidationError(`${memberLabel}.scale must contain two coordinates`);
                const scale = [
                    finite(scaleSource[0], `${memberLabel}.scale[0]`, 0.000_001, 1_000_000),
                    finite(scaleSource[1], `${memberLabel}.scale[1]`, 0.000_001, 1_000_000)
                ];
                return {
                    kind: 'instance',
                    symbolKey: member.symbolKey,
                    position: point2Or3(member.position, `${memberLabel}.position`),
                    scale,
                    rotation: member.rotation == null ? 0 : finite(member.rotation, `${memberLabel}.rotation`, -Math.PI * 4, Math.PI * 4),
                    role,
                    ...entityStyleKeyValue == null ? {} : {
                        entityStyleKey: entityStyleKeyValue
                    }
                };
            }
            throw new KJValidationError(`${memberLabel}.kind is invalid`);
        });
        return {
            key: definition.key,
            basePoint: point(definition.basePoint, `${label}.basePoint`),
            members
        };
    });
    const symbolInstances = symbolSource.instances.map((value, index)=>{
        const label = `input.symbols.instances[${index}]`, instance = plain(value, label);
        exact(instance, [
            'symbolKey',
            'position',
            'scale',
            'rotation',
            'role',
            'styleKey',
            'attributes'
        ], label);
        if (typeof instance.symbolKey !== 'string' || !symbolKeys.has(instance.symbolKey)) throw new KJValidationError(`${label}.symbolKey must reference a definition`);
        const scaleSource = instance.scale ?? [
            1,
            1
        ];
        if (!Array.isArray(scaleSource) || scaleSource.length !== 2) throw new KJValidationError(`${label}.scale must contain two coordinates`);
        const scale = [
            finite(scaleSource[0], `${label}.scale[0]`, 0.000_001, 1_000_000),
            finite(scaleSource[1], `${label}.scale[1]`, 0.000_001, 1_000_000)
        ];
        const styleKey = entityStyleKey(instance.styleKey, `${label}.styleKey`);
        if (instance.attributes != null && (!Array.isArray(instance.attributes) || instance.attributes.length > 64)) throw new KJValidationError(`${label}.attributes must contain at most 64 items`);
        const attributes = (instance.attributes ?? []).map((attribute, attributeIndex)=>symbolAttribute(attribute, `${label}.attributes[${attributeIndex}]`));
        if (new Set(attributes.map((attribute)=>attribute.tag.toUpperCase())).size !== attributes.length) throw new KJValidationError(`${label}.attributes must use unique tags`);
        return {
            symbolKey: instance.symbolKey,
            position: point2Or3(instance.position, `${label}.position`),
            scale,
            rotation: instance.rotation == null ? 0 : finite(instance.rotation, `${label}.rotation`, -Math.PI * 4, Math.PI * 4),
            role: symbolRole(instance.role, `${label}.role`),
            ...styleKey == null ? {} : {
                styleKey
            },
            ...attributes.length ? {
                attributes
            } : {}
        };
    });
    for (const definition of symbolDefinitions)for (const member of definition.members)if (member.kind === 'instance' && !symbolKeys.has(member.symbolKey)) throw new KJValidationError(`input.symbols.definitions[${definition.key}].members instance must reference a definition`);
    const styleRole = (value, label)=>{
        if (value == null) return {};
        const role = plain(value, label);
        exact(role, [
            'layerName',
            'color',
            'lineweight',
            'linetypeName',
            'linetypePattern',
            'linetypeScale'
        ], label);
        if (role.layerName != null && (typeof role.layerName !== 'string' || !/^[^\u0000-\u001f\u007f]{1,64}$/u.test(role.layerName))) throw new KJValidationError(`${label}.layerName must be bounded printable text`);
        if (role.linetypeName != null && (typeof role.linetypeName !== 'string' || !/^[^\u0000-\u001f\u007f]{1,64}$/u.test(role.linetypeName))) throw new KJValidationError(`${label}.linetypeName must be bounded printable text`);
        const color = role.color == null ? undefined : finite(role.color, `${label}.color`, 0, 255);
        if (color != null && !Number.isInteger(color)) throw new KJValidationError(`${label}.color must be an integer ACI color, including 0 for ByBlock`);
        const lineweight = role.lineweight == null ? undefined : finite(role.lineweight, `${label}.lineweight`, -3, 211);
        const supportedLineweights = new Set([
            -3,
            -2,
            -1,
            0,
            5,
            9,
            13,
            15,
            18,
            20,
            25,
            30,
            35,
            40,
            50,
            53,
            60,
            70,
            80,
            90,
            100,
            106,
            120,
            140,
            158,
            200,
            211
        ]);
        if (lineweight != null && !supportedLineweights.has(lineweight)) throw new KJValidationError(`${label}.lineweight is not a supported CAD lineweight`);
        if (role.linetypePattern != null && (!Array.isArray(role.linetypePattern) || role.linetypePattern.length > 32 || role.linetypePattern.length % 2 !== 0 || role.linetypePattern.some((item, index)=>typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 1_000 || index % 2 === 0 && item <= 0 || index % 2 === 1 && item >= 0))) throw new KJValidationError(`${label}.linetypePattern is invalid`);
        const linetypeScale = role.linetypeScale == null ? undefined : finite(role.linetypeScale, `${label}.linetypeScale`, 1e-9, 1e9);
        return {
            ...role.layerName == null ? {} : {
                layerName: role.layerName
            },
            ...color == null ? {} : {
                color
            },
            ...lineweight == null ? {} : {
                lineweight
            },
            ...role.linetypeName == null ? {} : {
                linetypeName: role.linetypeName
            },
            ...role.linetypePattern == null ? {} : {
                linetypePattern: [
                    ...role.linetypePattern
                ]
            },
            ...linetypeScale == null ? {} : {
                linetypeScale
            }
        };
    };
    const styles = {};
    for (const role of [
        'frame',
        'grid',
        'geometry',
        'center',
        'notes',
        'dimensions',
        'hatch',
        'hidden'
    ])styles[role] = styleRole(styleProfile[role], `input.styleProfile.${role}`);
    const customStyles = customStyleSource.map((value, index)=>{
        const source = plain(value, `input.styleProfile.custom[${index}]`), { key, ...definition } = source;
        return {
            key: String(key),
            definition: styleRole(definition, `input.styleProfile.custom[${index}]`)
        };
    });
    return {
        expectedRevision,
        drawingId: input.drawingId.trim(),
        entityDrawOrder,
        center,
        ringRadii,
        ringStyleKeys,
        pitch,
        radius,
        holePatterns,
        outlineSegments,
        cuttingPlaneMarks,
        sideOutlineSegments,
        xRange,
        orientation,
        axisCoordinate,
        axisVisible,
        axisDirection,
        axisStyleKey,
        symmetricProfiles,
        sectionHatches,
        dimensions,
        leaders,
        featureControlFrames,
        auxiliaryLines,
        auxiliaryPoints,
        pointDisplay,
        auxiliarySolids,
        auxiliaryWipeouts,
        auxiliaryCurves,
        auxiliaryHatches,
        symbolDefinitions,
        symbolInstances,
        symbolAttributeCount,
        textStyles,
        dimensionStyles,
        styles,
        customStyles,
        sheetOrigin,
        sheetSize,
        inset,
        outerFrameOffset,
        outerFrameStyleKey,
        insetFrameStyleKey,
        outerFrameSideStyleKeys,
        insetFrameSideStyleKeys,
        outerFrameSides,
        insetFrameSides,
        titleGrid,
        notes
    };
}
export function buildAgentMechanicalFlangeCore(document, source) {
    const input = validate(document, source), prefix = `flange-${stableHash({
        id: input.drawingId,
        version: KJDRAW_MECHANICAL_FLANGE_CORE_VERSION
    }).slice(0, 12)}`;
    const compact = (value)=>Object.fromEntries(Object.entries(value).filter(([, item])=>item !== undefined));
    const textStyleByKey = new Map(), textStyleResources = [];
    const dimensionStyleByKey = new Map(), dimensionStyleResources = [];
    const payloadMatches = (existing, requested)=>Object.entries(requested).every(([key, value])=>JSON.stringify(existing?.[key]) === JSON.stringify(value));
    const reservedTextStyleNames = new Set(document.getTable?.('textStyles')?.records.map((record)=>String(record.name).toUpperCase()) ?? []);
    for (const [index, style] of input.textStyles.entries()){
        const existing = document.getTable?.('textStyles')?.records.find((record)=>String(record.name).toUpperCase() === style.name.toUpperCase());
        const payload = compact({
            fontFamily: style.fontFamily,
            fontFile: style.fontFile,
            bigFontFile: style.bigFontFile,
            fixedHeight: style.fixedHeight,
            widthFactor: style.widthFactor,
            obliqueAngle: style.obliqueAngle,
            dxfFlags: style.dxfFlags,
            generationFlags: style.generationFlags,
            lastHeight: style.lastHeight
        });
        let reusable = existing != null && payloadMatches(existing.payload, payload) ? existing : undefined;
        let name = style.name;
        if (existing && !reusable) {
            name = `KJ_TEXT_${String(index + 1).padStart(2, '0')}_${stableHash(payload).slice(0, 12).toUpperCase()}`;
            const alias = document.getTable?.('textStyles')?.records.find((record)=>String(record.name).toUpperCase() === name.toUpperCase());
            if (alias && !payloadMatches(alias.payload, payload)) throw new KJValidationError('generated text style alias conflicts with an existing resource');
            reusable = alias;
        }
        const id = reusable?.id ?? `${prefix}-text-style-${String(index + 1).padStart(2, '0')}`;
        if (!reusable && reservedTextStyleNames.has(name.toUpperCase())) throw new KJValidationError('generated text style alias conflicts with an existing resource');
        reservedTextStyleNames.add(name.toUpperCase());
        textStyleByKey.set(style.key, {
            id,
            name
        });
        if (!reusable) textStyleResources.push({
            id,
            name,
            payload
        });
    }
    for (const [index, style] of input.dimensionStyles.entries()){
        const existing = document.getTable?.('dimensionStyles')?.records.find((record)=>String(record.name).toUpperCase() === style.name.toUpperCase());
        const id = existing?.id ?? `${prefix}-dimension-style-${String(index + 1).padStart(2, '0')}`;
        dimensionStyleByKey.set(style.key, {
            id,
            name: style.name
        });
        if (!existing) dimensionStyleResources.push({
            id,
            name: style.name,
            payload: compact({
                overallScale: style.overallScale,
                arrowSize: style.arrowSize,
                extensionOffset: style.extensionOffset,
                baselineSpacing: style.baselineSpacing,
                extensionBeyond: style.extensionBeyond,
                rounding: style.rounding,
                textHeight: style.textHeight,
                decimalPlaces: style.decimalPlaces,
                angularDecimalPlaces: style.angularDecimalPlaces,
                angularUnits: style.angularUnits,
                centerMarkSize: style.centerMarkSize,
                textGap: style.textGap,
                dxfFlags: style.dxfFlags
            })
        });
    }
    const role = (name, defaults)=>({
            ...defaults,
            ...input.styles[name] ?? {},
            pattern: input.styles[name]?.linetypePattern ?? defaults.pattern
        });
    const roles = {
        frame: role('frame', {
            layerName: 'FLANGE_FRAME',
            color: 7,
            lineweight: 25,
            pattern: []
        }),
        grid: role('grid', {
            layerName: 'FLANGE_GRID',
            color: 7,
            lineweight: 18,
            pattern: []
        }),
        geometry: role('geometry', {
            layerName: 'FLANGE_GEOMETRY',
            color: 7,
            lineweight: 35,
            pattern: []
        }),
        center: role('center', {
            layerName: 'FLANGE_CENTER',
            color: 7,
            lineweight: 18,
            pattern: [
                8,
                -1,
                1,
                -1
            ]
        }),
        notes: role('notes', {
            layerName: 'FLANGE_NOTES',
            color: 7,
            lineweight: 18,
            pattern: []
        }),
        dimensions: role('dimensions', {
            layerName: 'FLANGE_DIMENSIONS',
            color: 2,
            lineweight: 18,
            pattern: []
        }),
        hatch: role('hatch', {
            layerName: 'FLANGE_HATCH',
            color: 7,
            lineweight: 18,
            pattern: []
        }),
        hidden: role('hidden', {
            layerName: 'FLANGE_HIDDEN',
            color: 8,
            lineweight: 18,
            pattern: [
                3,
                -1
            ]
        })
    };
    const customRoleByKey = new Map();
    for (const [index, custom] of input.customStyles.entries()){
        const name = `custom-${String(index + 1).padStart(2, '0')}`, fallback = roles.geometry;
        customRoleByKey.set(custom.key, name);
        roles[name] = {
            ...fallback,
            ...custom.definition,
            pattern: custom.definition.linetypePattern ?? fallback.pattern
        };
    }
    const styleNameFor = (key, fallback)=>key == null ? fallback : customRoleByKey.get(key);
    const roleIds = {}, layers = [], layerByName = new Map();
    const linetypeIds = {}, linetypes = [];
    const linetypeByName = new Map(document.getTable?.('linetypes')?.records.map((record)=>[
            String(record.name).toUpperCase(),
            record.id
        ]) ?? []);
    for (const name of Object.keys(roles)){
        const definition = roles[name];
        const linetypeName = definition.linetypeName ?? `FLANGE_${String(name).toUpperCase()}`;
        const normalizedLinetypeName = linetypeName.toUpperCase();
        let id = linetypeByName.get(normalizedLinetypeName);
        if (!id) {
            id = `${prefix}-${name}-linetype`;
            linetypes.push({
                id,
                name: linetypeName,
                pattern: definition.pattern
            });
            linetypeByName.set(normalizedLinetypeName, id);
        }
        linetypeIds[name] = id;
        const layerName = definition.layerName, existingLayer = document.getTable?.('layers')?.records.find((record)=>String(record.name).toUpperCase() === layerName.toUpperCase()), pendingLayer = layerByName.get(layerName.toUpperCase());
        roleIds[name] = existingLayer?.id ?? pendingLayer ?? `${prefix}-${name}`;
        if (!existingLayer && !pendingLayer) {
            layerByName.set(layerName.toUpperCase(), roleIds[name]);
            layers.push({
                id: roleIds[name],
                name: layerName,
                color: definition.color === 0 ? 7 : definition.color,
                linetypeId: id,
                lineweight: definition.lineweight
            });
        }
    }
    const entities = [], p3 = (x, y, z = 0)=>[
            x,
            y,
            z
        ];
    const roleByLayer = new Map(Object.keys(roles).map((name)=>[
            roleIds[name],
            roles[name]
        ]));
    const stylePayload = (payload, styleName)=>{
        const resolvedStyleName = styleName ?? Object.keys(roles).find((name)=>roleIds[name] === payload.layerId);
        const style = resolvedStyleName == null ? roleByLayer.get(payload.layerId) : roles[resolvedStyleName];
        return style == null ? payload : {
            ...payload,
            color: style.color,
            lineweight: style.lineweight,
            ...resolvedStyleName == null ? {} : {
                linetypeId: linetypeIds[resolvedStyleName]
            },
            ...style.linetypeName == null ? {} : {
                linetypeName: style.linetypeName
            },
            ...style.linetypeScale == null ? {} : {
                linetypeScale: style.linetypeScale
            }
        };
    };
    const emit = (type, payload, styleName)=>{
        entities.push({
            type,
            payload: stylePayload(payload, styleName),
            options: {
                id: `${prefix}-${String(entities.length + 1).padStart(4, '0')}`
            }
        });
    };
    const line = (a, b, layerId = roleIds.grid, styleName = 'grid')=>emit('LINE', {
            start: p3(...a),
            end: p3(...b),
            layerId
        }, styleName);
    const styled = (key, fallback)=>{
        const name = styleNameFor(key, fallback);
        return {
            name,
            layerId: roleIds[name]
        };
    };
    const rectangle = (origin, size)=>{
        const [x, y] = origin, [w, h] = size;
        line([
            x,
            y
        ], [
            x + w,
            y
        ]);
        line([
            x + w,
            y
        ], [
            x + w,
            y + h
        ]);
        line([
            x + w,
            y + h
        ], [
            x,
            y + h
        ]);
        line([
            x,
            y + h
        ], [
            x,
            y
        ]);
    };
    const [cx, cy] = input.center;
    for (const [index, ringRadius] of input.ringRadii.entries()){
        const style = styled(input.ringStyleKeys[index], 'geometry');
        emit('CIRCLE', {
            center: p3(cx, cy),
            radius: ringRadius,
            layerId: style.layerId
        }, style.name);
    }
    if (input.pitch != null && input.radius != null) {
        const halfPitch = input.pitch / 2;
        for (const dx of [
            -1,
            1
        ])for (const dy of [
            -1,
            1
        ])emit('CIRCLE', {
            center: p3(cx + dx * halfPitch, cy + dy * halfPitch),
            radius: input.radius,
            layerId: roleIds.geometry
        }, 'geometry');
    }
    for (const pattern of input.holePatterns){
        const style = styled(pattern.styleKey, 'geometry');
        for(let index = 0; index < pattern.count; index++){
            const angle = (pattern.startAngle ?? 0) + index * Math.PI * 2 / pattern.count;
            emit('CIRCLE', {
                center: p3(cx + Math.cos(angle) * pattern.pitchRadius, cy + Math.sin(angle) * pattern.pitchRadius),
                radius: pattern.holeRadius,
                layerId: style.layerId
            }, style.name);
        }
    }
    for (const segment of input.outlineSegments){
        const style = styled(segment.styleKey, 'geometry');
        if (segment.kind === 'line') line([
            cx + segment.startOffset[0],
            cy + segment.startOffset[1]
        ], [
            cx + segment.endOffset[0],
            cy + segment.endOffset[1]
        ], style.layerId, style.name);
        else if (segment.kind === 'arc') emit('ARC', {
            center: p3(cx + segment.centerOffset[0], cy + segment.centerOffset[1]),
            radius: segment.radius,
            startAngle: segment.startAngle,
            endAngle: segment.endAngle,
            layerId: style.layerId
        }, style.name);
        else emit('CIRCLE', {
            center: p3(cx + segment.centerOffset[0], cy + segment.centerOffset[1]),
            radius: segment.radius,
            layerId: style.layerId
        }, style.name);
    }
    for (const mark of input.cuttingPlaneMarks){
        const anchor = [
            cx + mark.anchorOffset[0],
            cy + mark.anchorOffset[1]
        ];
        const stemStyle = styled(mark.stemStyleKey, 'notes'), tickStyle = styled(mark.tickStyleKey, 'notes');
        line(anchor, [
            anchor[0] + mark.stemVector[0],
            anchor[1] + mark.stemVector[1]
        ], stemStyle.layerId, stemStyle.name);
        line(anchor, [
            anchor[0] + mark.tickVector[0],
            anchor[1] + mark.tickVector[1]
        ], tickStyle.layerId, tickStyle.name);
        if (mark.arrowhead) {
            const tip = [
                anchor[0] + mark.tickVector[0],
                anchor[1] + mark.tickVector[1]
            ], norm = Math.hypot(mark.tickVector[0], mark.tickVector[1]);
            const unit = [
                mark.tickVector[0] / norm,
                mark.tickVector[1] / norm
            ], perpendicular = [
                -unit[1],
                unit[0]
            ];
            const base = [
                tip[0] - unit[0] * mark.arrowhead.length,
                tip[1] - unit[1] * mark.arrowhead.length
            ];
            const half = mark.arrowhead.width / 2;
            const a = [
                base[0] + perpendicular[0] * half,
                base[1] + perpendicular[1] * half
            ];
            const b = [
                base[0] - perpendicular[0] * half,
                base[1] - perpendicular[1] * half
            ];
            const arrowStyle = styled(mark.arrowheadStyleKey, 'notes');
            emit('SOLID', {
                vertices: [
                    p3(...tip),
                    p3(...a),
                    p3(...b),
                    p3(...b)
                ],
                layerId: arrowStyle.layerId
            }, arrowStyle.name);
        }
    }
    const frameRectangle = (origin, size, sides, fallbackStyleKey, sideStyleKeys)=>{
        const [x, y] = origin, [w, h] = size;
        const edge = (side, start, end)=>{
            if (!sides.includes(side)) return;
            const style = styled(sideStyleKeys[side] ?? fallbackStyleKey, 'frame');
            line(start, end, style.layerId, style.name);
        };
        edge('bottom', [
            x,
            y
        ], [
            x + w,
            y
        ]);
        edge('right', [
            x + w,
            y
        ], [
            x + w,
            y + h
        ]);
        edge('top', [
            x + w,
            y + h
        ], [
            x,
            y + h
        ]);
        edge('left', [
            x,
            y + h
        ], [
            x,
            y
        ]);
    };
    frameRectangle([
        input.sheetOrigin[0] + input.outerFrameOffset[0],
        input.sheetOrigin[1] + input.outerFrameOffset[1]
    ], input.sheetSize, input.outerFrameSides, input.outerFrameStyleKey, input.outerFrameSideStyleKeys);
    if (input.inset > 0) frameRectangle([
        input.sheetOrigin[0] + input.inset,
        input.sheetOrigin[1] + input.inset
    ], [
        input.sheetSize[0] - input.inset * 2,
        input.sheetSize[1] - input.inset * 2
    ], input.insetFrameSides, input.insetFrameStyleKey, input.insetFrameSideStyleKeys);
    if (input.titleGrid) {
        const grid = input.titleGrid, [x, y] = grid.origin, [w, h] = grid.size;
        const topStyle = styled(grid.topStyleKey, 'grid');
        line([
            x,
            y + h
        ], [
            x + w,
            y + h
        ], topStyle.layerId, topStyle.name);
        for (const column of grid.columns){
            const offset = typeof column === 'number' ? column : column.offset, style = styled(typeof column === 'number' ? undefined : column.styleKey, 'grid');
            line([
                x + offset,
                y
            ], [
                x + offset,
                y + h
            ], style.layerId, style.name);
        }
        for (const column of grid.partialColumns ?? []){
            const style = styled(column.styleKey, 'grid');
            line([
                x + column.offset,
                y
            ], [
                x + column.offset,
                y + column.height
            ], style.layerId, style.name);
        }
        for (const row of grid.rows){
            const spans = [
                0,
                ...row.breaks ?? [],
                w
            ], style = styled(row.styleKey, 'grid');
            for(let index = 0; index < spans.length - 1; index++)line([
                x + spans[index],
                y + row.offset
            ], [
                x + spans[index + 1],
                y + row.offset
            ], style.layerId, style.name);
        }
        for (const segment of grid.horizontalSegments ?? []){
            const style = styled(segment.styleKey, 'grid');
            line([
                x + segment.start,
                y + segment.offset
            ], [
                x + segment.end,
                y + segment.offset
            ], style.layerId, style.name);
        }
        for (const segment of grid.verticalSegments ?? []){
            const style = styled(segment.styleKey, 'grid');
            line([
                x + segment.offset,
                y + segment.start
            ], [
                x + segment.offset,
                y + segment.end
            ], style.layerId, style.name);
        }
        if (grid.diagonalHeader) {
            const style = styled(grid.diagonalHeader.styleKey, 'grid');
            line([
                x,
                y + h
            ], [
                x + grid.diagonalHeader.width,
                y + h - grid.diagonalHeader.drop
            ], style.layerId, style.name);
        }
    }
    const projectSidePoint = (station, offset)=>input.orientation === 'vertical' ? [
            input.axisCoordinate + offset,
            station
        ] : [
            station,
            input.axisCoordinate + offset
        ];
    const projectSideVector = (station, offset)=>input.orientation === 'vertical' ? [
            offset,
            station
        ] : [
            station,
            offset
        ];
    if (input.xRange && input.axisVisible) {
        const style = styled(input.axisStyleKey, 'center'), [start, end] = input.axisDirection === 'reverse' ? [
            input.xRange[1],
            input.xRange[0]
        ] : input.xRange;
        line(projectSidePoint(start, 0), projectSidePoint(end, 0), style.layerId, style.name);
    }
    const directedProfileLine = (points, direction, layerId, styleName)=>line(direction === 'reverse' ? points[1] : points[0], direction === 'reverse' ? points[0] : points[1], layerId, styleName);
    for (const profile of input.symmetricProfiles){
        const style = styled(profile.styleKey, 'geometry');
        for(let index = 1; index < profile.vertices.length; index++){
            const previous = profile.vertices[index - 1], current = profile.vertices[index];
            const directions = profile.segmentDirections?.[index - 1] ?? {
                upper: 'forward',
                lower: 'forward'
            };
            const upper = [
                projectSidePoint(previous.station, previous.radius),
                projectSidePoint(current.station, current.radius)
            ];
            const lower = [
                projectSidePoint(previous.station, -previous.radius),
                projectSidePoint(current.station, -current.radius)
            ];
            directedProfileLine(upper, directions.upper, style.layerId, style.name);
            directedProfileLine(lower, directions.lower, style.layerId, style.name);
        }
        const start = profile.vertices[0], end = profile.vertices.at(-1);
        if (profile.endCaps === 'start' || profile.endCaps === 'both') {
            const capStyle = styled(profile.startCapStyleKey ?? profile.styleKey, 'geometry'), points = [
                projectSidePoint(start.station, -start.radius),
                projectSidePoint(start.station, start.radius)
            ];
            directedProfileLine(points, profile.startCapDirection, capStyle.layerId, capStyle.name);
        }
        if (profile.endCaps === 'end' || profile.endCaps === 'both') {
            const capStyle = styled(profile.endCapStyleKey ?? profile.styleKey, 'geometry'), points = [
                projectSidePoint(end.station, -end.radius),
                projectSidePoint(end.station, end.radius)
            ];
            directedProfileLine(points, profile.endCapDirection, capStyle.layerId, capStyle.name);
        }
    }
    for (const segment of input.sideOutlineSegments){
        const style = styled(segment.styleKey, 'geometry');
        if (segment.kind === 'line') line(projectSidePoint(segment.start.station, segment.start.offset), projectSidePoint(segment.end.station, segment.end.offset), style.layerId, style.name);
        else if (segment.kind === 'arc') emit('ARC', {
            center: p3(...projectSidePoint(segment.center.station, segment.center.offset)),
            radius: segment.radius,
            startAngle: segment.startAngle,
            endAngle: segment.endAngle,
            layerId: style.layerId
        }, style.name);
        else emit('CIRCLE', {
            center: p3(...projectSidePoint(segment.center.station, segment.center.offset)),
            radius: segment.radius,
            layerId: style.layerId
        }, style.name);
    }
    for (const hatch of input.sectionHatches){
        const style = styled(hatch.styleKey, 'hatch');
        const boundaryLoops = hatch.boundaryLoops.map((loop)=>({
                external: loop.external === true,
                flags: loop.flags ?? 0,
                edges: loop.edges.map((edge)=>edge.kind === 'line' ? {
                        type: 'LINE',
                        start: p3(...projectSidePoint(edge.start.station, edge.start.offset)),
                        end: p3(...projectSidePoint(edge.end.station, edge.end.offset))
                    } : edge.kind === 'arc' ? {
                        type: 'ARC',
                        center: p3(...projectSidePoint(edge.center.station, edge.center.offset)),
                        radius: edge.radius,
                        startAngle: edge.startAngle,
                        endAngle: edge.endAngle,
                        counterClockwise: edge.counterClockwise !== false
                    } : {
                        type: 'SPLINE',
                        degree: edge.degree,
                        controlPoints: edge.controlPoints.map((value)=>p3(...projectSidePoint(value.station, value.offset))),
                        knots: [
                            ...edge.knots ?? []
                        ],
                        weights: [
                            ...edge.weights ?? []
                        ],
                        fitPoints: (edge.fitPoints ?? []).map((value)=>p3(...projectSidePoint(value.station, value.offset))),
                        periodic: edge.periodic === true,
                        ...edge.startTangent == null ? {} : {
                            startTangent: p3(...projectSideVector(...edge.startTangent))
                        },
                        ...edge.endTangent == null ? {} : {
                            endTangent: p3(...projectSideVector(...edge.endTangent))
                        }
                    })
            }));
        emit('HATCH', {
            boundaryLoops,
            patternName: hatch.patternName,
            solid: hatch.solid,
            associative: false,
            patternAngle: 0,
            patternScale: 1,
            patternLines: hatch.patternLines,
            patternDefinitionAngle: 0,
            patternDefinitionScale: 1,
            layerId: style.layerId
        }, style.name);
    }
    for (const hatch of input.auxiliaryHatches){
        const style = styled(hatch.styleKey, 'hatch');
        const boundaryLoops = hatch.boundaryLoops.map((loop)=>({
                external: loop.external === true,
                flags: loop.flags ?? 0,
                edges: loop.edges.map((edge)=>edge.kind === 'line' ? {
                        type: 'LINE',
                        start: p3(...edge.start),
                        end: p3(...edge.end)
                    } : edge.kind === 'arc' ? {
                        type: 'ARC',
                        center: p3(...edge.center),
                        radius: edge.radius,
                        startAngle: edge.startAngle,
                        endAngle: edge.endAngle,
                        counterClockwise: edge.counterClockwise !== false
                    } : {
                        type: 'SPLINE',
                        degree: edge.degree,
                        controlPoints: edge.controlPoints.map((value)=>p3(...value)),
                        knots: [
                            ...edge.knots ?? []
                        ],
                        weights: [
                            ...edge.weights ?? []
                        ],
                        fitPoints: (edge.fitPoints ?? []).map((value)=>p3(...value)),
                        periodic: edge.periodic === true,
                        ...edge.startTangent == null ? {} : {
                            startTangent: p3(...edge.startTangent)
                        },
                        ...edge.endTangent == null ? {} : {
                            endTangent: p3(...edge.endTangent)
                        }
                    })
            }));
        emit('HATCH', {
            boundaryLoops,
            patternName: hatch.patternName,
            solid: hatch.solid,
            associative: false,
            patternAngle: 0,
            patternScale: 1,
            patternLines: hatch.patternLines,
            patternDefinitionAngle: 0,
            patternDefinitionScale: 1,
            layerId: style.layerId
        }, style.name);
    }
    for (const auxiliary of input.auxiliaryPoints){
        const style = styled(auxiliary.styleKey, auxiliary.role);
        emit('POINT', {
            position: p3(...auxiliary.position),
            layerId: style.layerId
        }, style.name);
    }
    for (const auxiliary of input.auxiliaryLines){
        const style = styled(auxiliary.styleKey, auxiliary.role);
        line(auxiliary.start, auxiliary.end, style.layerId, style.name);
    }
    for (const solid of input.auxiliarySolids){
        const style = styled(solid.styleKey, solid.role), vertices = solid.vertices.map((value)=>p3(...value));
        emit('SOLID', {
            vertices: vertices.length === 3 ? [
                ...vertices,
                vertices[2]
            ] : vertices,
            layerId: style.layerId
        }, style.name);
    }
    for (const wipeout of input.auxiliaryWipeouts){
        const style = styled(wipeout.styleKey, wipeout.role);
        emit('WIPEOUT', {
            position: p3(...wipeout.position),
            uVector: p3(...wipeout.uVector),
            vVector: p3(...wipeout.vVector),
            clipBoundary: wipeout.clipBoundary.map((value)=>p3(...value)),
            boundaryType: wipeout.boundaryType,
            flags: 7,
            clipping: true,
            brightness: 50,
            contrast: 50,
            fade: 0,
            clipMode: false,
            layerId: style.layerId
        }, style.name);
    }
    for (const curve of input.auxiliaryCurves){
        const style = styled(curve.styleKey, curve.role);
        if (curve.kind === 'arc') emit('ARC', {
            center: p3(...curve.center),
            radius: curve.radius,
            startAngle: curve.startAngle,
            endAngle: curve.endAngle,
            clockwise: curve.clockwise === true,
            layerId: style.layerId
        }, style.name);
        else if (curve.kind === 'ellipse') emit('ELLIPSE', {
            center: p3(...curve.center),
            majorAxis: p3(...curve.majorAxis),
            ratio: curve.ratio,
            startParameter: curve.startParameter,
            endParameter: curve.endParameter,
            layerId: style.layerId
        }, style.name);
        else if (curve.kind === 'polyline') emit('LWPOLYLINE', {
            vertices: curve.vertices.map((vertex)=>({
                    ...vertex,
                    point: p3(...vertex.point)
                })),
            closed: curve.closed === true,
            elevation: 0,
            layerId: style.layerId
        }, style.name);
        else emit('SPLINE', {
            degree: curve.degree,
            controlPoints: curve.controlPoints.map((value)=>p3(...value)),
            knots: curve.knots,
            ...curve.fitPoints?.length ? {
                fitPoints: curve.fitPoints.map((value)=>p3(...value))
            } : {},
            ...curve.weights?.length ? {
                weights: curve.weights
            } : {},
            closed: curve.closed === true,
            periodic: curve.periodic === true,
            layerId: style.layerId
        }, style.name);
    }
    const symbolBlockByKey = new Map();
    for (const [definitionIndex, definition] of input.symbolDefinitions.entries()){
        const token = stableHash({
            basePoint: definition.basePoint,
            members: definition.members
        }).slice(0, 12);
        symbolBlockByKey.set(definition.key, {
            id: `${prefix}-symbol-${String(definitionIndex + 1).padStart(2, '0')}-${token}`
        });
    }
    const symbolAttributePayload = (attribute)=>{
        const entityStyle = styled(attribute.entityStyleKey, attribute.role), textStyle = attribute.styleKey == null ? null : textStyleByKey.get(attribute.styleKey);
        return stylePayload({
            position: p3(...attribute.position),
            ...attribute.alignmentPoint == null ? {} : {
                alignmentPoint: p3(...attribute.alignmentPoint)
            },
            text: attribute.text,
            tag: attribute.tag,
            prompt: attribute.prompt ?? '',
            flags: attribute.flags ?? 0,
            height: attribute.height,
            rotation: attribute.rotation ?? 0,
            ...attribute.widthFactor == null ? {} : {
                widthFactor: attribute.widthFactor
            },
            ...attribute.obliqueAngle == null ? {} : {
                obliqueAngle: attribute.obliqueAngle
            },
            ...attribute.horizontalAlignment == null ? {} : {
                horizontalAlignment: attribute.horizontalAlignment
            },
            ...attribute.verticalAlignment == null ? {} : {
                verticalAlignment: attribute.verticalAlignment
            },
            ...attribute.generationFlags == null ? {} : {
                generationFlags: attribute.generationFlags
            },
            lockPosition: attribute.lockPosition === true,
            ...textStyle == null ? {} : {
                styleId: textStyle.id
            },
            layerId: entityStyle.layerId
        }, entityStyle.name);
    };
    const blocks = input.symbolDefinitions.map((definition, definitionIndex)=>{
        const token = stableHash({
            basePoint: definition.basePoint,
            members: definition.members
        }).slice(0, 12);
        const id = symbolBlockByKey.get(definition.key).id;
        const members = definition.members.map((member, memberIndex)=>{
            let type, payload;
            const entityStyle = styled(member.entityStyleKey, member.role);
            if (member.kind === 'line') {
                type = 'LINE';
                payload = {
                    start: p3(...member.start),
                    end: p3(...member.end),
                    layerId: entityStyle.layerId
                };
            } else if (member.kind === 'circle') {
                type = 'CIRCLE';
                payload = {
                    center: p3(...member.center),
                    radius: member.radius,
                    layerId: entityStyle.layerId
                };
            } else if (member.kind === 'arc') {
                type = 'ARC';
                payload = {
                    center: p3(...member.center),
                    radius: member.radius,
                    startAngle: member.startAngle,
                    endAngle: member.endAngle,
                    clockwise: member.clockwise === true,
                    layerId: entityStyle.layerId
                };
            } else if (member.kind === 'single-line-text') {
                const style = member.styleKey == null ? null : textStyleByKey.get(member.styleKey);
                type = 'TEXT';
                payload = {
                    position: p3(...member.position),
                    ...member.alignmentPoint == null ? {} : {
                        alignmentPoint: p3(...member.alignmentPoint)
                    },
                    text: member.text,
                    height: member.height,
                    rotation: member.rotation ?? 0,
                    ...member.widthFactor == null ? {} : {
                        widthFactor: member.widthFactor
                    },
                    ...member.obliqueAngle == null ? {} : {
                        obliqueAngle: member.obliqueAngle
                    },
                    ...member.horizontalAlignment == null ? {} : {
                        horizontalAlignment: member.horizontalAlignment
                    },
                    ...member.verticalAlignment == null ? {} : {
                        verticalAlignment: member.verticalAlignment
                    },
                    ...member.generationFlags == null ? {} : {
                        generationFlags: member.generationFlags
                    },
                    ...style == null ? {} : {
                        styleId: style.id
                    },
                    layerId: entityStyle.layerId
                };
            } else if (member.kind === 'hatch') {
                const boundaryLoops = member.boundaryLoops.map((loop)=>({
                        external: loop.external === true,
                        flags: loop.flags ?? 0,
                        edges: loop.edges.map((edge)=>edge.kind === 'line' ? {
                                type: 'LINE',
                                start: p3(...edge.start),
                                end: p3(...edge.end)
                            } : edge.kind === 'arc' ? {
                                type: 'ARC',
                                center: p3(...edge.center),
                                radius: edge.radius,
                                startAngle: edge.startAngle,
                                endAngle: edge.endAngle,
                                counterClockwise: edge.counterClockwise !== false
                            } : {
                                type: 'SPLINE',
                                degree: edge.degree,
                                controlPoints: edge.controlPoints.map((value)=>p3(...value)),
                                knots: [
                                    ...edge.knots ?? []
                                ],
                                weights: [
                                    ...edge.weights ?? []
                                ],
                                fitPoints: (edge.fitPoints ?? []).map((value)=>p3(...value)),
                                periodic: edge.periodic === true,
                                ...edge.startTangent == null ? {} : {
                                    startTangent: p3(...edge.startTangent)
                                },
                                ...edge.endTangent == null ? {} : {
                                    endTangent: p3(...edge.endTangent)
                                }
                            })
                    }));
                type = 'HATCH';
                payload = {
                    boundaryLoops,
                    patternName: member.patternName,
                    solid: member.solid,
                    associative: false,
                    patternAngle: 0,
                    patternScale: 1,
                    patternLines: member.patternLines,
                    patternDefinitionAngle: 0,
                    patternDefinitionScale: 1,
                    layerId: entityStyle.layerId
                };
            } else if (member.kind === 'solid') {
                const vertices = member.vertices.map((value)=>p3(...value));
                type = 'SOLID';
                payload = {
                    vertices: vertices.length === 3 ? [
                        ...vertices,
                        vertices[2]
                    ] : vertices,
                    layerId: entityStyle.layerId
                };
            } else if (member.kind === 'multiline-text') {
                const style = member.styleKey == null ? null : textStyleByKey.get(member.styleKey);
                type = 'MTEXT';
                payload = {
                    position: p3(...member.position),
                    text: member.text,
                    height: member.height,
                    rotation: member.rotation ?? 0,
                    attachmentPoint: member.attachmentPoint ?? 1,
                    ...member.width == null ? {} : {
                        width: member.width
                    },
                    ...style == null ? {} : {
                        styleId: style.id
                    },
                    layerId: entityStyle.layerId
                };
            } else if (member.kind === 'attribute-definition') {
                type = 'ATTDEF';
                payload = symbolAttributePayload(member);
            } else {
                type = 'INSERT';
                payload = {
                    blockRecordId: symbolBlockByKey.get(member.symbolKey).id,
                    position: p3(member.position[0], member.position[1], member.position[2]),
                    scale: [
                        member.scale?.[0] ?? 1,
                        member.scale?.[1] ?? 1,
                        1
                    ],
                    rotation: member.rotation ?? 0,
                    attributes: {},
                    attributeIds: [],
                    sequenceEndId: null,
                    layerId: entityStyle.layerId
                };
            }
            return {
                type,
                payload: stylePayload(payload, entityStyle.name),
                options: {
                    id: `${id}-member-${String(memberIndex + 1).padStart(3, '0')}`
                }
            };
        });
        return {
            id,
            name: `KJ_FLANGE_SYMBOL_${String(definitionIndex + 1).padStart(2, '0')}_${token.toUpperCase()}`,
            basePoint: p3(...definition.basePoint),
            entities: members
        };
    });
    for (const [instanceIndex, instance] of input.symbolInstances.entries()){
        const block = symbolBlockByKey.get(instance.symbolKey), style = styled(instance.styleKey, instance.role);
        const id = `${prefix}-${String(entities.length + 1).padStart(4, '0')}`, attributes = instance.attributes ?? [];
        entities.push({
            type: 'INSERT',
            payload: stylePayload({
                blockRecordId: block.id,
                position: p3(instance.position[0], instance.position[1], instance.position[2]),
                scale: [
                    instance.scale?.[0] ?? 1,
                    instance.scale?.[1] ?? 1,
                    1
                ],
                rotation: instance.rotation ?? 0,
                attributes: {},
                attributeIds: [],
                sequenceEndId: null,
                layerId: style.layerId
            }, style.name),
            options: {
                id
            },
            ...attributes.length ? {
                attributeSequence: {
                    attributes: attributes.map((attribute, attributeIndex)=>({
                            id: `${id}-attribute-${String(attributeIndex + 1).padStart(2, '0')}`,
                            payload: symbolAttributePayload(attribute)
                        })),
                    sequenceEnd: {
                        id: `${id}-sequence-end`,
                        dxfOwnerMode: 'insert',
                        layerId: style.layerId
                    }
                }
            } : {}
        });
    }
    const characteristicCode = {
        position: 'j',
        concentricity: 'r',
        symmetry: 'i',
        parallelism: 'f',
        perpendicularity: 'b',
        angularity: 'a',
        cylindricity: 'g',
        flatness: 'c',
        circularity: 'e',
        straightness: 'u',
        'surface-profile': 'd',
        'line-profile': 'k',
        'circular-runout': 'h',
        'total-runout': 't'
    };
    const conditionCode = {
        maximum: 'm',
        least: 'l',
        regardless: 's'
    };
    const gdt = (code)=>`{\\Fgdt;${code}}`;
    for (const frame of input.featureControlFrames){
        const text = frame.rows.map((row)=>{
            let value = `${gdt(characteristicCode[row.characteristic])}%%v${row.diameterZone ? gdt('n') : ''}${row.tolerance}${row.materialCondition ? gdt(conditionCode[row.materialCondition]) : ''}%%v`;
            const cells = Array(4).fill('');
            let nextSlot = 0;
            for (const datum of row.datumReferences ?? []){
                const slot = datum.slot ?? nextSlot;
                cells[slot] = `${datum.label}${datum.materialCondition ? gdt(conditionCode[datum.materialCondition]) : ''}`;
                nextSlot = Math.max(nextSlot, slot + 1);
            }
            for (const cell of cells)value += `${cell}%%v`;
            return `${value}^J`;
        }).join('');
        const style = frame.styleKey == null ? null : dimensionStyleByKey.get(frame.styleKey);
        emit('TOLERANCE', {
            position: p3(...frame.position),
            text,
            styleName: style?.name ?? 'STANDARD',
            ...style == null ? {} : {
                styleId: style.id
            },
            normal: [
                0,
                0,
                1
            ],
            xAxisDirection: p3(...frame.xAxisDirection ?? [
                1,
                0
            ]),
            layerId: roleIds[frame.role]
        }, frame.role);
    }
    for (const note of input.notes){
        const style = note.styleKey == null ? null : textStyleByKey.get(note.styleKey), entityStyle = styled(note.entityStyleKey, 'notes');
        emit(note.kind === 'single-line' ? 'TEXT' : 'MTEXT', {
            position: p3(...note.position),
            text: note.text,
            height: note.height,
            rotation: note.rotation,
            ...note.width == null ? {} : {
                width: note.width
            },
            ...note.attachmentPoint == null ? {} : {
                attachmentPoint: note.attachmentPoint
            },
            ...style == null ? {} : {
                styleId: style.id
            },
            layerId: entityStyle.layerId
        }, entityStyle.name);
    }
    for (const dimension of input.dimensions){
        const style = dimension.styleKey == null ? null : dimensionStyleByKey.get(dimension.styleKey);
        emit('DIMENSION', {
            dimensionType: dimension.kind.toUpperCase(),
            ...dimension.kind === 'ordinate' ? {
                dxfDimensionType: dimension.axis === 'x' ? 70 : 6
            } : {},
            definitionPoints: dimension.definitionPoints.map(([x, y])=>p3(x, y)),
            ...dimension.textPosition == null ? {} : {
                textPosition: p3(...dimension.textPosition)
            },
            textOverride: dimension.textOverride ?? null,
            rotation: dimension.rotation ?? 0,
            ...dimension.textHeight == null ? {} : {
                textHeight: dimension.textHeight
            },
            ...dimension.arrowSize == null ? {} : {
                arrowSize: dimension.arrowSize
            },
            styleName: style?.name ?? 'STANDARD',
            ...style == null ? {} : {
                styleId: style.id
            },
            layerId: roleIds.dimensions
        }, 'dimensions');
    }
    for (const leader of input.leaders){
        const style = styled(leader.styleKey, 'notes');
        emit('LEADER', {
            vertices: leader.vertices.map(([x, y])=>p3(x, y)),
            annotationId: null,
            ownsAnnotation: false,
            arrowEnabled: leader.arrowEnabled !== false,
            pathType: leader.pathType ?? 0,
            annotationType: leader.annotationType ?? 3,
            hookLineDirection: leader.hookLineDirection ?? 0,
            hookLineEnabled: leader.hookLineEnabled === true,
            ...leader.textHeight == null ? {} : {
                textHeight: leader.textHeight
            },
            ...leader.textWidth == null ? {} : {
                textWidth: leader.textWidth
            },
            layerId: style.layerId
        }, style.name);
    }
    if (input.entityDrawOrder != null && (input.entityDrawOrder.length !== entities.length || input.entityDrawOrder.some((index)=>index >= entities.length))) throw new KJValidationError('input.entityDrawOrder must be a complete entity permutation');
    const orderedEntities = (input.entityDrawOrder == null ? entities : input.entityDrawOrder.map((index)=>entities[index])).map((entity, index)=>{
        const id = prefix + '-' + String(index + 1).padStart(4, '0');
        return {
            ...entity,
            options: {
                ...entity.options,
                id
            },
            ...entity.attributeSequence ? {
                attributeSequence: {
                    attributes: entity.attributeSequence.attributes.map((attribute, attributeIndex)=>({
                            ...attribute,
                            id: id + '-attribute-' + String(attributeIndex + 1).padStart(2, '0')
                        })),
                    sequenceEnd: {
                        ...entity.attributeSequence.sequenceEnd,
                        id: id + '-sequence-end'
                    }
                }
            } : {}
        };
    });
    return {
        commandArgs: {
            entities: orderedEntities,
            ...input.pointDisplay == null ? {} : {
                systemVariables: {
                    PDMODE: input.pointDisplay.mode,
                    PDSIZE: input.pointDisplay.size
                }
            },
            resources: {
                linetypes,
                layers,
                ...textStyleResources.length ? {
                    textStyles: textStyleResources
                } : {},
                ...dimensionStyleResources.length ? {
                    dimensionStyles: dimensionStyleResources
                } : {},
                ...blocks.length ? {
                    blocks
                } : {}
            }
        },
        evidence: {
            knowledgePackId: KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK.id,
            knowledgePackVersion: KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK.version,
            expectedRevision: input.expectedRevision,
            entityCount: orderedEntities.length,
            parameters: {
                ringCount: input.ringRadii.length,
                squareHolePitch: input.pitch,
                squareHoleRadius: input.radius,
                holePatternCount: input.holePatterns.length + (input.pitch == null ? 0 : 1),
                holeCount: input.holePatterns.reduce((sum, pattern)=>sum + pattern.count, input.pitch == null ? 0 : 4),
                titleGrid: input.titleGrid != null,
                sideViewAxis: input.xRange != null,
                sideViewOrientation: input.orientation,
                sideViewAxisVisible: input.axisVisible,
                outlineSegmentCount: input.outlineSegments.length,
                cuttingPlaneMarkCount: input.cuttingPlaneMarks.length,
                symmetricProfileCount: input.symmetricProfiles.length,
                sideOutlineSegmentCount: input.sideOutlineSegments.length,
                sectionHatchCount: input.sectionHatches.length,
                auxiliaryHatchCount: input.auxiliaryHatches.length,
                auxiliaryLineCount: input.auxiliaryLines.length,
                auxiliaryLineBudget: MAX_AUXILIARY_LINES,
                auxiliaryPointCount: input.auxiliaryPoints.length,
                pointDisplay: input.pointDisplay,
                auxiliarySolidCount: input.auxiliarySolids.length,
                auxiliaryWipeoutCount: input.auxiliaryWipeouts.length,
                auxiliaryCurveCount: input.auxiliaryCurves.length,
                auxiliaryCurveBudget: MAX_AUXILIARY_CURVES,
                auxiliaryArcRadiusMinimum: MIN_AUXILIARY_ARC_RADIUS,
                symbolDefinitionCount: input.symbolDefinitions.length,
                symbolDefinitionBudget: MAX_SYMBOL_DEFINITIONS,
                symbolMemberCount: input.symbolDefinitions.reduce((sum, definition)=>sum + definition.members.length, 0),
                symbolMemberBudgetPerDefinition: MAX_SYMBOL_MEMBERS_PER_DEFINITION,
                symbolMemberBudgetTotal: MAX_SYMBOL_MEMBERS_TOTAL,
                symbolInstanceCount: input.symbolInstances.length,
                symbolInstanceBudget: MAX_SYMBOL_INSTANCES,
                symbolAttributeCount: input.symbolAttributeCount,
                featureControlFrameCount: input.featureControlFrames.length,
                entityStyleCount: input.customStyles.length,
                textStyleCount: input.textStyles.length,
                dimensionStyleCount: input.dimensionStyles.length,
                noteCount: input.notes.length,
                dimensionCount: input.dimensions.length,
                ordinateDimensionCount: input.dimensions.filter((dimension)=>dimension.kind === 'ordinate').length,
                leaderCount: input.leaders.length
            },
            limitations: [
                'Flange end-view, symmetric axial-profile, cut-face hatches, native dimension and sheet-grid core only',
                'Local symbols are bounded to editable local blocks and complete attached attribute sequences',
                'Private drawings and labels are not embedded'
            ]
        }
    };
}
