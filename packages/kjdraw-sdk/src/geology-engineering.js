// Generated from geology-engineering.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { stableHash, deepFreeze } from './utils.js';
import { validateKnowledgePack } from './knowledge-pack.js';
import { hatchPatternFromKnowledgePack } from './hatch-pattern-catalog.js';
import { layoutCadMText } from './geometry/text-layout.js';
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from './knowledge-packs/geology-core.js';
import { compileGeologySectionTopology } from './geology-section-topology.js';
const pattern = {
    fill: 'CROSS',
    'cultivated-soil': 'ANSI37',
    clay: 'ANSI31',
    'silty-clay': 'ANSI37',
    silt: 'ANSI31',
    sand: 'ANSI37',
    gravel: 'CROSS',
    rock: 'ANSI31',
    'weathered-rock': 'CROSS',
    loess: 'ANSI37',
    'loess-collapsible': 'CROSS',
    'loess-like': 'ANSI31',
    paleosol: 'CROSS',
    'calcareous-nodule': 'ANSI37'
};
const bounded = (value, label, max = 64)=>{
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new KJValidationError(`Geology: invalid ${label}`);
    return value.trim();
};
const numeric = (value, label)=>{
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e6) throw new KJValidationError(`Geology: invalid ${label}`);
    return value;
};
const positive = (value, label)=>{
    const result = numeric(value, label);
    if (result <= 0) throw new KJValidationError(`Geology: ${label} must be positive`);
    return result;
};
const sourceTextPlacement = (raw, label, minimumHeight = 1.2, maximumHeight = 5)=>{
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'height,horizontalAlignment,offset,textWidthFactor,verticalAlignment') throw new KJValidationError(`Geology: ${label} needs an exact source-backed placement schema`);
    const rule = raw;
    if (!Array.isArray(rule.offset) || rule.offset.length !== 2) throw new KJValidationError(`Geology: ${label} offset must contain two millimetre coordinates`);
    const offset = rule.offset.map((coordinate, index)=>numeric(coordinate, `${label} offset ${index + 1}`));
    const height = numeric(rule.height, `${label} height`);
    const textWidthFactor = numeric(rule.textWidthFactor, `${label} width factor`);
    if (![
        'left',
        'center',
        'right'
    ].includes(rule.horizontalAlignment) || ![
        'baseline',
        'middle'
    ].includes(rule.verticalAlignment) || height < minimumHeight || height > maximumHeight || textWidthFactor < 0.5 || textWidthFactor > 1.5) throw new KJValidationError(`Geology: ${label} placement is unreadable`);
    return {
        offset,
        height,
        textWidthFactor,
        horizontalAlignment: rule.horizontalAlignment,
        verticalAlignment: rule.verticalAlignment
    };
};
const projectCoordinate = (value, label)=>{
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) throw new KJValidationError(`Geology: invalid ${label}`);
    return value;
};
const metres = (value)=>value.toFixed(2);
const scaleDenominator = (value)=>Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '');
const headerRoles = new Set([
    'projectName',
    'holeId',
    'collarElevation',
    'depth',
    'x',
    'y',
    'startDate',
    'endDate',
    'initialWaterDepth',
    'stableWaterDepth',
    'verticalScale'
]);
const stableDocumentFactKey = (value, label = 'document fact key')=>{
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,31}$/u.test(value) || [
        'constructor',
        'prototype'
    ].includes(value.toLowerCase())) throw new KJValidationError(`Geology: invalid ${label}`);
    return value;
};
const documentFactRecord = (value)=>{
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value) || ![
        Object.prototype,
        null
    ].includes(Object.getPrototypeOf(value))) throw new KJValidationError('Geology: document facts must be a plain record');
    const result = Object.create(null), seen = new Set();
    const keys = Reflect.ownKeys(value);
    if (keys.length > 8) throw new KJValidationError('Geology: document facts allow at most 8 entries');
    for (const rawKey of keys){
        if (typeof rawKey !== 'string') throw new KJValidationError('Geology: invalid document fact key');
        const descriptor = Object.getOwnPropertyDescriptor(value, rawKey);
        if (!descriptor || !('value' in descriptor)) throw new KJValidationError('Geology: document fact accessors are not accepted');
        const key = stableDocumentFactKey(rawKey), canonical = key.toLowerCase();
        if (seen.has(canonical)) throw new KJValidationError('Geology: duplicate document fact key');
        seen.add(canonical);
        result[key] = bounded(descriptor.value, `document fact ${key}`, 96);
    }
    return result;
};
const fieldRoles = new Set([
    'layerNumber',
    'layerName',
    'baseElevation',
    'thickness',
    'depth',
    'pattern',
    'description',
    'sample',
    'spt',
    'measurement'
]);
const requiredFieldRoles = [
    'layerNumber',
    'layerName',
    'baseElevation',
    'thickness',
    'depth',
    'pattern',
    'description'
];
const defaultColumnVerticalScales = Object.freeze([
    50,
    100,
    150,
    200,
    250,
    500,
    1000,
    2000,
    5000
]);
const defaultColumnLabels = {
    hole: 'HOLE',
    collar: 'COLLAR',
    depth: 'DEPTH',
    verticalScale: 'VERTICAL SCALE',
    datum: 'DATUM: collar elevation',
    project: 'PROJECT',
    x: 'X',
    y: 'Y',
    startDate: 'START',
    endDate: 'END',
    depthColumn: 'DEPTH m',
    thicknessColumn: 'THICKNESS m',
    elevationColumn: 'ELEV. m',
    codeColumn: 'CODE',
    hatchColumn: 'LITHOLOGY',
    stratumColumn: 'STRATUM',
    descriptionColumn: 'DESCRIPTION',
    sampleColumn: 'SAMPLE',
    sptColumn: 'SPT N',
    legend: 'LITHOLOGY LEGEND',
    footer: 'Depth positive downward; elevations from supplied collar. Verify against drilling log.',
    fill: 'fill',
    'cultivated-soil': 'cultivated soil',
    clay: 'clay',
    'silty-clay': 'silty clay',
    silt: 'silt',
    sand: 'sand',
    gravel: 'gravel',
    rock: 'rock',
    'weathered-rock': 'weathered rock',
    loess: 'loess',
    'loess-collapsible': 'collapsible loess',
    'loess-like': 'loess-like soil',
    paleosol: 'paleosol',
    'calcareous-nodule': 'calcareous nodules'
};
const chineseColumnLabels = {
    hole: '钻孔编号',
    collar: '孔口标高',
    depth: '孔深',
    verticalScale: '垂直比例尺',
    datum: '基准：孔口标高',
    project: '工程名称',
    x: 'X坐标',
    y: 'Y坐标',
    startDate: '开孔日期',
    endDate: '终孔日期',
    depthColumn: '深度 m',
    thicknessColumn: '层厚 m',
    elevationColumn: '层底标高 m',
    codeColumn: '层号',
    hatchColumn: '岩土图例',
    stratumColumn: '岩土名称',
    descriptionColumn: '岩土描述',
    sampleColumn: '取样',
    sptColumn: '标贯 N',
    legend: '岩土图例',
    footer: '深度向下为正；标高按给定孔口标高计算。请与钻孔原始记录核对。',
    fill: '填土',
    'cultivated-soil': '耕植土',
    clay: '黏性土',
    'silty-clay': '粉质黏土',
    silt: '粉土',
    sand: '砂土',
    gravel: '碎石土',
    rock: '岩石',
    'weathered-rock': '风化岩',
    loess: '黄土',
    'loess-collapsible': '湿陷性黄土',
    'loess-like': '黄土状土',
    paleosol: '古土壤',
    'calcareous-nodule': '钙质结核层'
};
const hasChinese = (value)=>typeof value === 'string' && /[\u3400-\u9fff]/u.test(value);
function geologyLocale(input) {
    if (input.locale != null && input.locale !== 'zh-CN' && input.locale !== 'en') throw new KJValidationError('Geology: locale must be zh-CN or en');
    if (input.locale) return input.locale;
    if (hasChinese(input.title)) return 'zh-CN';
    if ('projectName' in input && hasChinese(input.projectName)) return 'zh-CN';
    const holes = 'hole' in input ? [
        input.hole
    ] : input.holes;
    return holes.some((hole)=>hole.strata.some((layer)=>hasChinese(layer.name) || hasChinese(layer.description))) ? 'zh-CN' : 'en';
}
function columnLayout(input) {
    if (!input.columnStylePack) {
        if (input.strictSourceTemplate) throw new KJValidationError('Geology: strict source template needs a source-backed style pack');
        if (geologyLocale(input) === 'zh-CN' && input.pageHeightMillimeters == null) return columnLayout({
            ...input,
            columnStylePack: KJDRAW_GEOLOGY_KNOWLEDGE_PACK
        });
        const height = input.pageHeightMillimeters ?? 297;
        if (height !== 297 && height !== 841) throw new KJValidationError('Geology: column page height must be 297 or 841 mm');
        return {
            paperWidth: 210,
            paperHeight: height,
            left: 15,
            right: 195,
            columns: [
                32,
                51,
                67,
                92,
                147
            ],
            headerDepth: 56,
            headerRowHeight: 7,
            fieldHeaderHeight: 10,
            footerReserve: 57,
            layerNumberStyle: 'plain',
            labels: geologyLocale(input) === 'zh-CN' ? chineseColumnLabels : defaultColumnLabels,
            verticalScaleDenominators: [
                ...defaultColumnVerticalScales
            ]
        };
    }
    if (input.pageHeightMillimeters != null) throw new KJValidationError('Geology: a style pack and direct page height cannot be mixed');
    const pack = validateKnowledgePack(input.columnStylePack);
    const rule = pack.rules?.['geology-column-layout'];
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new KJValidationError('Geology: style pack has no geology-column-layout rule');
    const value = rule;
    const isFieldGrid = value.fieldGrid != null;
    const expectedKeys = [
        isFieldGrid ? 'fieldGrid' : 'columns',
        'left',
        'paperHeight',
        'paperWidth',
        'right'
    ];
    const keys = Object.keys(value).sort();
    if (keys.some((key)=>![
            ...expectedKeys,
            'labels',
            'observationColumns',
            'displayAliases',
            'headerDepth',
            'headerRowHeight',
            'fieldHeaderHeight',
            'footerReserve',
            'headerGrid',
            'footerGrid',
            'sptDisplayCap',
            'legendMode',
            'layerNumberStyle',
            'titleHeight',
            'titleTextStyle',
            'textFlow',
            'textHeights',
            'intervalDepthTextStyle',
            'majorGroupValueStyle',
            'defaultTextStyle',
            'stratigraphicNotationStyle',
            'descriptionTextStyle',
            'sampleMarkerStyle',
            'sampleAnnotationStyle',
            'sampleRangeBaselineStyle',
            'sampleRangeTextFormat',
            'groundwaterAnnotationStyle',
            'patternLabelStyle',
            'titleMarginFacts',
            'frameStyle',
            'descriptionBoundaryStyle',
            'formTopology',
            'verticalScaleDenominators',
            'sourceTemplate'
        ].includes(key)) || expectedKeys.some((key)=>!keys.includes(key))) throw new KJValidationError('Geology: style pack layout must declare five geometry fields and optional labels/observation columns');
    const paperWidth = numeric(value.paperWidth, 'style paper width'), paperHeight = numeric(value.paperHeight, 'style paper height');
    const titleHeight = value.titleHeight == null ? 5 : numeric(value.titleHeight, 'title height');
    if (titleHeight < 3 || titleHeight > 12) throw new KJValidationError('Geology: title height must be 3–12 mm');
    const left = numeric(value.left, 'style left'), right = numeric(value.right, 'style right');
    if (paperWidth < 150 || paperWidth > 500 || paperHeight < 250 || paperHeight > 1600 || left < 5 || right > paperWidth - 5 || right - left < 125) throw new KJValidationError('Geology: style paper and table margins are out of bounds');
    let columns = [
        left + 15,
        left + 30,
        left + 45,
        left + 60,
        left + 95
    ];
    if (!isFieldGrid) {
        if (!Array.isArray(value.columns) || ![
            5,
            6
        ].includes(value.columns.length)) throw new KJValidationError('Geology: style columns require five or six boundaries');
        columns = value.columns.map((item, index)=>numeric(item, `style column ${index + 1}`));
        const namedColumnMinimum = value.observationColumns ? 14 : 35;
        if (columns.some((column, index)=>column <= (index ? columns[index - 1] : left) + (index === 0 ? 9 : index === columns.length - 1 ? namedColumnMinimum : index === columns.length - 2 ? 15 : 12)) || right <= columns.at(-1) + 25) throw new KJValidationError('Geology: style columns are not ordered or readable');
    }
    let observationColumns;
    if (value.observationColumns != null) {
        if (isFieldGrid) throw new KJValidationError('Geology: declarative field grid cannot mix legacy observation columns');
        if (!Array.isArray(value.observationColumns) || value.observationColumns.length !== 2) throw new KJValidationError('Geology: sample and SPT boundaries must be declared together');
        observationColumns = value.observationColumns.map((item, index)=>numeric(item, `observation column ${index + 1}`));
        if (observationColumns[0] <= columns.at(-1) + 35 || observationColumns[1] <= observationColumns[0] + 15 || right <= observationColumns[1] + 12) throw new KJValidationError('Geology: description, sample and SPT columns are not readable');
    }
    const headerDepth = value.headerDepth == null ? 56 : numeric(value.headerDepth, 'style header depth');
    const headerRowHeight = value.headerRowHeight == null ? 7 : numeric(value.headerRowHeight, 'header row height');
    const fieldHeaderHeight = value.fieldHeaderHeight == null ? 10 : numeric(value.fieldHeaderHeight, 'field header height');
    const footerReserve = value.footerReserve == null ? 57 : numeric(value.footerReserve, 'style footer reserve');
    if (headerDepth < 40 || headerDepth > 90 || headerRowHeight < 4.5 || headerRowHeight > 10 || fieldHeaderHeight < 8 || fieldHeaderHeight > 18 || footerReserve < 12 || footerReserve > 120) throw new KJValidationError('Geology: style header or footer reserve is unreadable');
    const sptDisplayCap = value.sptDisplayCap == null ? undefined : numeric(value.sptDisplayCap, 'style SPT display cap');
    if (sptDisplayCap != null && (!Number.isSafeInteger(sptDisplayCap) || sptDisplayCap < 1 || sptDisplayCap > 1000)) throw new KJValidationError('Geology: SPT display cap must be an integer from 1 to 1000');
    let labels = geologyLocale(input) === 'zh-CN' ? chineseColumnLabels : defaultColumnLabels;
    if (value.labels != null) {
        if (!value.labels || typeof value.labels !== 'object' || Array.isArray(value.labels)) throw new KJValidationError('Geology: style labels must be a declared object');
        const provided = value.labels;
        if (Object.keys(provided).sort().join(',') !== Object.keys(defaultColumnLabels).sort().join(',')) throw new KJValidationError('Geology: style labels must translate every column and lithology role');
        labels = Object.fromEntries(Object.entries(provided).map(([key, label])=>[
                key,
                bounded(label, `style label ${key}`, key === 'footer' ? 160 : 48)
            ]));
    }
    let displayAliases;
    if (value.displayAliases != null) {
        if (!value.displayAliases || typeof value.displayAliases !== 'object' || Array.isArray(value.displayAliases)) throw new KJValidationError('Geology: display aliases must be a declared object');
        const supplied = value.displayAliases;
        if (Object.keys(supplied).some((key)=>![
                'codes',
                'names'
            ].includes(key))) throw new KJValidationError('Geology: display aliases may only contain codes and names');
        const aliases = (kind)=>{
            const entries = supplied[kind];
            if (entries == null) return {};
            if (typeof entries !== 'object' || Array.isArray(entries)) throw new KJValidationError(`Geology: ${kind} display aliases must be an object`);
            const pairs = Object.entries(entries);
            if (pairs.length > 256) throw new KJValidationError('Geology: too many display aliases');
            return Object.fromEntries(pairs.map(([source, target])=>[
                    bounded(source, `source ${kind} alias`, 64),
                    bounded(target, `visible ${kind} alias`, 64)
                ]));
        };
        displayAliases = {
            codes: aliases('codes'),
            names: aliases('names')
        };
    }
    let headerGrid;
    if (value.headerGrid != null) {
        const supplied = value.headerGrid;
        if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || ![
            'rows',
            'continuousDividers,rows'
        ].includes(Object.keys(supplied).sort().join(','))) throw new KJValidationError('Geology: header grid must declare rows and optional continuous dividers');
        const rows = supplied.rows;
        if (!Array.isArray(rows) || rows.length < 2 || rows.length > 4 || headerRowHeight * rows.length + fieldHeaderHeight + 10 > headerDepth) throw new KJValidationError('Geology: header grid rows do not fit the declared sheet');
        const seen = new Set(), documentKeys = new Set();
        const parsedRows = rows.map((row, rowIndex)=>{
            if (!Array.isArray(row) || row.length < 1 || row.length > 4 || (right - left) / row.length < 45) throw new KJValidationError(`Geology: header grid row ${rowIndex + 1} is unreadable`);
            const physical = row.some((raw)=>raw && typeof raw === 'object' && !Array.isArray(raw) && ('start' in raw || 'valueStart' in raw));
            const parsed = row.map((raw, cellIndex)=>{
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError(`Geology: header grid cell ${rowIndex + 1}/${cellIndex + 1} needs a role and label`);
                const cell = raw;
                const optional = cell.optional == null ? undefined : cell.optional;
                if (optional != null && typeof optional !== 'boolean') throw new KJValidationError('Geology: header fact optional flag must be boolean');
                const hasGeometry = cell.start != null || cell.valueStart != null;
                if (physical !== hasGeometry || hasGeometry && (cell.start == null || cell.valueStart == null)) throw new KJValidationError('Geology: a physical header row must declare start and valueStart for every cell');
                if (cell.textStyle != null && !physical) throw new KJValidationError('Geology: header fact text style needs a physical source cell');
                const geometry = !physical ? {} : {
                    start: numeric(cell.start, `header grid start ${rowIndex + 1}/${cellIndex + 1}`),
                    valueStart: numeric(cell.valueStart, `header grid value start ${rowIndex + 1}/${cellIndex + 1}`)
                };
                let textStyle;
                if (cell.textStyle != null) {
                    if (!cell.textStyle || typeof cell.textStyle !== 'object' || Array.isArray(cell.textStyle) || Object.keys(cell.textStyle).sort().join(',') !== 'label,value') throw new KJValidationError('Geology: header fact text style must declare exact label and value placements');
                    const supplied = cell.textStyle;
                    textStyle = {
                        label: sourceTextPlacement(supplied.label, `header fact ${rowIndex + 1}/${cellIndex + 1} label`),
                        value: sourceTextPlacement(supplied.value, `header fact ${rowIndex + 1}/${cellIndex + 1} value`)
                    };
                }
                const commonKeys = [
                    'label',
                    'role',
                    ...optional == null ? [] : [
                        'optional'
                    ],
                    ...physical ? [
                        'start',
                        'valueStart'
                    ] : [],
                    ...textStyle ? [
                        'textStyle'
                    ] : []
                ];
                if (cell.role === 'documentFact') {
                    if (Object.keys(cell).sort().join(',') !== [
                        ...commonKeys,
                        'key'
                    ].sort().join(',')) throw new KJValidationError(`Geology: header grid cell ${rowIndex + 1}/${cellIndex + 1} needs a document fact key, role and label`);
                    const key = stableDocumentFactKey(cell.key), canonical = key.toLowerCase();
                    if (documentKeys.has(canonical)) throw new KJValidationError('Geology: duplicate document fact key');
                    documentKeys.add(canonical);
                    return {
                        role: 'documentFact',
                        key,
                        label: bounded(cell.label, 'header fact label', 24),
                        ...optional == null ? {} : {
                            optional
                        },
                        ...geometry,
                        ...textStyle ? {
                            textStyle
                        } : {}
                    };
                }
                if (Object.keys(cell).sort().join(',') !== commonKeys.sort().join(',') || typeof cell.role !== 'string' || !headerRoles.has(cell.role)) throw new KJValidationError('Geology: undeclared header fact role');
                const role = cell.role;
                if (seen.has(role)) throw new KJValidationError('Geology: duplicate header fact role');
                seen.add(role);
                return {
                    role,
                    label: bounded(cell.label, 'header fact label', 24),
                    ...optional == null ? {} : {
                        optional
                    },
                    ...geometry,
                    ...textStyle ? {
                        textStyle
                    } : {}
                };
            });
            if (physical) for (const [cellIndex, cell] of parsed.entries()){
                const end = parsed[cellIndex + 1]?.start ?? right;
                if (cell.start < left || cellIndex === 0 && Math.abs(cell.start - left) > 1e-6 || end - cell.start < 30 || cell.valueStart - cell.start < 10 || end - cell.valueStart < 10) throw new KJValidationError(`Geology: physical header cell ${rowIndex + 1}/${cellIndex + 1} is out of bounds or unreadable`);
                if (cell.textStyle) for (const [placement, laneWidth] of [
                    [
                        cell.textStyle.label,
                        cell.valueStart - cell.start
                    ],
                    [
                        cell.textStyle.value,
                        end - cell.valueStart
                    ]
                ]){
                    if (placement.offset[0] < 0 || placement.offset[0] > laneWidth || placement.offset[1] < 0 || placement.offset[1] > headerRowHeight) throw new KJValidationError(`Geology: physical header cell ${rowIndex + 1}/${cellIndex + 1} text placement is outside its lane`);
                }
            }
            return parsed;
        });
        let continuousDividers;
        const rawContinuousDividers = supplied.continuousDividers;
        if (rawContinuousDividers != null) {
            if (!Array.isArray(rawContinuousDividers) || rawContinuousDividers.length < 1 || rawContinuousDividers.length > 8 || !parsedRows.every((row)=>row.every((cell)=>cell.start != null && cell.valueStart != null))) throw new KJValidationError('Geology: continuous header dividers need 1–8 physical source positions');
            continuousDividers = rawContinuousDividers.map((raw, index)=>numeric(raw, `continuous header divider ${index + 1}`));
            if (new Set(continuousDividers).size !== continuousDividers.length) throw new KJValidationError('Geology: continuous header dividers must be unique');
            for (const divider of continuousDividers){
                const rowOccurrences = parsedRows.filter((row)=>row.some((cell, index)=>Math.abs(cell.valueStart - divider) < 1e-9 || index > 0 && Math.abs(cell.start - divider) < 1e-9)).length;
                if (divider <= left || divider >= right || rowOccurrences < 2 || rowOccurrences === parsedRows.length) throw new KJValidationError('Geology: a continuous header divider must bridge an actual source-row gap');
            }
        }
        headerGrid = {
            rows: parsedRows,
            ...continuousDividers ? {
                continuousDividers
            } : {}
        };
    }
    let fieldGrid;
    if (isFieldGrid) {
        if (!Array.isArray(value.fieldGrid) || value.fieldGrid.length < 7 || value.fieldGrid.length > 24) throw new KJValidationError('Geology: field grid needs 7–24 declared physical columns');
        const roles = new Set(), measurementKeys = new Set();
        fieldGrid = value.fieldGrid.map((raw, index)=>{
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: field grid column must be a declared object');
            const cell = raw;
            const role = cell.role;
            const schema = [
                'label',
                'role',
                'start',
                ...cell.subLabel == null ? [] : [
                    'subLabel'
                ],
                ...cell.textWidthFactor == null ? [] : [
                    'textWidthFactor'
                ],
                ...cell.headerTextStyle == null ? [] : [
                    'headerTextStyle'
                ],
                ...role === 'measurement' ? [
                    'key',
                    ...cell.decimals == null ? [] : [
                        'decimals'
                    ]
                ] : []
            ].sort().join(',');
            if (!fieldRoles.has(role) || Object.keys(cell).sort().join(',') !== schema) throw new KJValidationError('Geology: field grid column needs an exact role schema');
            const start = numeric(cell.start, `field grid start ${index + 1}`), label = bounded(cell.label, `field grid label ${index + 1}`, 32);
            const subLabel = cell.subLabel == null ? undefined : bounded(cell.subLabel, `field grid sublabel ${index + 1}`, 24);
            const textWidthFactor = cell.textWidthFactor == null ? undefined : numeric(cell.textWidthFactor, `field grid text width factor ${index + 1}`);
            let headerTextStyle;
            if (cell.headerTextStyle != null) {
                if (!cell.headerTextStyle || typeof cell.headerTextStyle !== 'object' || Array.isArray(cell.headerTextStyle)) throw new KJValidationError('Geology: field header text style must be an object');
                const supplied = cell.headerTextStyle;
                if (Object.keys(supplied).sort().join(',') !== (subLabel ? 'main,sub' : 'main')) throw new KJValidationError('Geology: field header text style must declare main and exactly match the field sublabel');
                headerTextStyle = {
                    main: sourceTextPlacement(supplied.main, `field ${index + 1} main header`),
                    ...subLabel ? {
                        sub: sourceTextPlacement(supplied.sub, `field ${index + 1} sub header`)
                    } : {}
                };
            }
            if (textWidthFactor != null && (textWidthFactor < 0.5 || textWidthFactor > 1.5)) throw new KJValidationError('Geology: field grid text width factor must be 0.5–1.5');
            if (role !== 'measurement' && roles.has(role)) throw new KJValidationError(`Geology: duplicate field role ${role}`);
            roles.add(role);
            if (role === 'measurement') {
                const key = bounded(cell.key, 'measurement key', 24);
                if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/u.test(key) || measurementKeys.has(key)) throw new KJValidationError('Geology: measurement keys must be unique safe names');
                measurementKeys.add(key);
                const decimals = cell.decimals == null ? 2 : numeric(cell.decimals, 'measurement display decimals');
                if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 4) throw new KJValidationError('Geology: measurement decimals must be 0–4');
                return {
                    start,
                    role,
                    label,
                    ...subLabel ? {
                        subLabel
                    } : {},
                    ...textWidthFactor == null ? {} : {
                        textWidthFactor
                    },
                    ...headerTextStyle ? {
                        headerTextStyle
                    } : {},
                    key,
                    decimals
                };
            }
            return {
                start,
                role,
                label,
                ...subLabel ? {
                    subLabel
                } : {},
                ...textWidthFactor == null ? {} : {
                    textWidthFactor
                },
                ...headerTextStyle ? {
                    headerTextStyle
                } : {}
            };
        });
        if (requiredFieldRoles.some((role)=>!roles.has(role)) || Math.abs(fieldGrid[0].start - left) > 1e-6) throw new KJValidationError('Geology: field grid misses a core role or left margin');
        for (const [index, field] of fieldGrid.entries()){
            const width = (fieldGrid[index + 1]?.start ?? right) - field.start;
            const minimum = field.role === 'description' ? 35 : field.role === 'layerName' ? 15 : field.role === 'measurement' ? 7.5 : [
                'spt',
                'pattern'
            ].includes(field.role) ? 12 : 10;
            if (width < minimum || field.start < left || field.start >= right) throw new KJValidationError(`Geology: field ${field.role} is out of bounds or unreadable`);
            for (const placement of field.headerTextStyle ? [
                field.headerTextStyle.main,
                field.headerTextStyle.sub
            ].filter(Boolean) : []){
                if (placement.offset[0] < 0 || placement.offset[0] > width || placement.offset[1] < 0 || placement.offset[1] > fieldHeaderHeight) throw new KJValidationError(`Geology: field ${field.role} header placement is outside its physical cell`);
            }
        }
    }
    let footerGrid;
    if (value.footerGrid != null) {
        const supplied = value.footerGrid;
        if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || Object.keys(supplied).sort().join(',') !== 'cells,height') throw new KJValidationError('Geology: footer grid must declare height and cells');
        const height = numeric(supplied.height, 'footer grid height');
        const cells = supplied.cells;
        if (height < 7 || height > 16 || height + 5 > footerReserve || !Array.isArray(cells) || cells.length < 3 || cells.length > 8) throw new KJValidationError('Geology: footer grid does not fit the declared sheet');
        const keys = new Set();
        const parsed = cells.map((raw, index)=>{
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: footer cell needs an exact key, label, start and optional internal divider');
            const cell = raw, start = numeric(cell.start, `footer cell start ${index + 1}`);
            const schema = [
                'key',
                'label',
                'start',
                ...cell.internalDivider == null ? [] : [
                    'internalDivider'
                ],
                ...cell.textStyle == null ? [] : [
                    'textStyle'
                ]
            ].sort().join(',');
            if (Object.keys(cell).sort().join(',') !== schema) throw new KJValidationError('Geology: footer cell needs an exact key, label, start and optional internal divider/text style');
            const key = stableDocumentFactKey(cell.key, 'footer fact key'), label = bounded(cell.label, 'footer fact label', 16);
            const internalDivider = cell.internalDivider == null ? undefined : numeric(cell.internalDivider, `footer cell internal divider ${index + 1}`);
            let textStyle;
            if (cell.textStyle != null) {
                if (!cell.textStyle || typeof cell.textStyle !== 'object' || Array.isArray(cell.textStyle) || Object.keys(cell.textStyle).sort().join(',') !== 'label,value') throw new KJValidationError('Geology: footer fact text style must declare exact label and value placements');
                const supplied = cell.textStyle;
                textStyle = {
                    label: sourceTextPlacement(supplied.label, `footer fact ${index + 1} label`),
                    value: sourceTextPlacement(supplied.value, `footer fact ${index + 1} value`)
                };
            }
            if (keys.has(key.toLowerCase())) throw new KJValidationError('Geology: duplicate footer fact key');
            keys.add(key.toLowerCase());
            return {
                start,
                key,
                label,
                ...internalDivider == null ? {} : {
                    internalDivider
                },
                ...textStyle ? {
                    textStyle
                } : {}
            };
        });
        for (const [index, cell] of parsed.entries()){
            const end = parsed[index + 1]?.start ?? right;
            if (cell.start < left || end - cell.start < 20 || index && cell.start <= parsed[index - 1].start || cell.internalDivider != null && (cell.internalDivider - cell.start < 4 || end - cell.internalDivider < 4)) throw new KJValidationError('Geology: footer cell is out of bounds or unreadable');
            if (cell.textStyle) for (const [placement, laneWidth] of [
                [
                    cell.textStyle.label,
                    (cell.internalDivider ?? end) - cell.start
                ],
                [
                    cell.textStyle.value,
                    end - (cell.internalDivider ?? cell.start)
                ]
            ]){
                if (placement.offset[0] < 0 || placement.offset[0] > laneWidth || placement.offset[1] < 0 || placement.offset[1] > height) throw new KJValidationError('Geology: footer fact text placement is outside its physical lane');
            }
        }
        if (Math.abs(parsed[0].start - left) > 1e-6) throw new KJValidationError('Geology: footer grid must start at the table margin');
        footerGrid = {
            height,
            cells: parsed
        };
    }
    let textFlow;
    if (value.textFlow != null) {
        if (!isFieldGrid || !value.textFlow || typeof value.textFlow !== 'object' || Array.isArray(value.textFlow)) throw new KJValidationError('Geology: text flow requires a declarative field grid');
        const rule = value.textFlow;
        if (Object.keys(rule).sort().join(',') !== 'firstBaselineMm,firstGroupBorrowMm,firstGroupUnruled,labelHeightMm,labelPitchMm,paragraphGapMm') throw new KJValidationError('Geology: text flow needs an exact versioned lane schema');
        const firstGroupBorrowMm = numeric(rule.firstGroupBorrowMm, 'first group borrow'), firstBaselineMm = numeric(rule.firstBaselineMm, 'first label baseline');
        const labelPitchMm = numeric(rule.labelPitchMm, 'label pitch'), labelHeightMm = numeric(rule.labelHeightMm, 'label height');
        const paragraphGapMm = numeric(rule.paragraphGapMm, 'paragraph gap');
        if (typeof rule.firstGroupUnruled !== 'boolean' || firstGroupBorrowMm < 0 || firstGroupBorrowMm > 20 || labelHeightMm < 1.5 || labelHeightMm > 4 || firstBaselineMm < labelHeightMm + 0.2 || firstBaselineMm > 12 || labelPitchMm < labelHeightMm + 0.5 || labelPitchMm > 15 || paragraphGapMm < 0.5 || paragraphGapMm > 5) throw new KJValidationError('Geology: text flow lane is unreadable or unbounded');
        textFlow = {
            firstGroupBorrowMm,
            firstGroupUnruled: rule.firstGroupUnruled,
            firstBaselineMm,
            labelPitchMm,
            labelHeightMm,
            paragraphGapMm
        };
    }
    let textHeights;
    if (value.textHeights != null) {
        if (!isFieldGrid || !value.textHeights || typeof value.textHeights !== 'object' || Array.isArray(value.textHeights)) throw new KJValidationError('Geology: role text heights require a declarative field grid');
        const rule = value.textHeights;
        const roles = [
            'headerFact',
            'fieldHeader',
            'fieldSubHeader',
            'majorValue',
            'intervalDepth',
            'observation'
        ];
        if (Object.keys(rule).sort().join(',') !== [
            ...roles
        ].sort().join(',')) throw new KJValidationError('Geology: role text heights need an exact versioned schema');
        const parsedTextHeights = Object.fromEntries(roles.map((role)=>[
                role,
                numeric(rule[role], `${role} text height`)
            ]));
        if (Object.values(parsedTextHeights).some((height)=>height < 1.2 || height > 5) || parsedTextHeights.headerFact > headerRowHeight - 1 || parsedTextHeights.fieldHeader + parsedTextHeights.fieldSubHeader + 0.8 > fieldHeaderHeight) throw new KJValidationError('Geology: role text heights do not fit the declared rows');
        textHeights = parsedTextHeights;
    }
    let intervalDepthTextStyle;
    if (value.intervalDepthTextStyle != null) {
        if (!isFieldGrid || !value.intervalDepthTextStyle || typeof value.intervalDepthTextStyle !== 'object' || Array.isArray(value.intervalDepthTextStyle) || Object.keys(value.intervalDepthTextStyle).sort().join(',') !== 'fieldRole,lens,principal') throw new KJValidationError('Geology: interval depth text style needs an exact declarative field-grid schema');
        const rule = value.intervalDepthTextStyle;
        if (rule.fieldRole !== 'depth') throw new KJValidationError('Geology: interval depth text needs the declared depth field');
        const principal = sourceTextPlacement(rule.principal, 'principal interval depth');
        const lens = sourceTextPlacement(rule.lens, 'lens interval depth');
        const depthIndex = fieldGrid.findIndex((field)=>field.role === 'depth');
        const depthWidth = depthIndex < 0 ? 0 : (fieldGrid[depthIndex + 1]?.start ?? right) - fieldGrid[depthIndex].start;
        if (depthIndex < 0 || [
            principal,
            lens
        ].some((placement)=>placement.offset[0] < 0 || placement.offset[0] > depthWidth || placement.offset[1] < -5 || placement.offset[1] > 10)) throw new KJValidationError('Geology: interval depth text placement is outside its physical lane');
        intervalDepthTextStyle = {
            fieldRole: 'depth',
            principal,
            lens
        };
    }
    let majorGroupValueStyle;
    if (value.majorGroupValueStyle != null) {
        if (!isFieldGrid || !value.majorGroupValueStyle || typeof value.majorGroupValueStyle !== 'object' || Array.isArray(value.majorGroupValueStyle)) throw new KJValidationError('Geology: major group value style needs a declarative field grid');
        const rule = value.majorGroupValueStyle;
        const expected = [
            'anchor',
            'baseElevation',
            'layerName',
            'layerNumber',
            'thickness',
            ...rule.layerNumberCircleRadius == null ? [] : [
                'layerNumberCircleRadius'
            ],
            ...rule.topBoundary == null ? [] : [
                'topBoundary'
            ]
        ].sort().join(',');
        if (Object.keys(rule).sort().join(',') !== expected || rule.anchor !== 'major-group-midpoint') throw new KJValidationError('Geology: major group value style needs an exact source-backed schema');
        const roles = [
            'layerNumber',
            'layerName',
            'baseElevation',
            'thickness'
        ];
        const placements = Object.fromEntries(roles.map((role)=>[
                role,
                sourceTextPlacement(rule[role], `major group ${role}`)
            ]));
        for (const role of roles){
            const fieldIndex = fieldGrid.findIndex((field)=>field.role === role);
            const width = fieldIndex < 0 ? 0 : (fieldGrid[fieldIndex + 1]?.start ?? right) - fieldGrid[fieldIndex].start;
            const placement = placements[role];
            if (fieldIndex < 0 || placement.offset[0] < 0 || placement.offset[0] > width || placement.offset[1] < -50 || placement.offset[1] > 50) throw new KJValidationError(`Geology: major group ${role} placement is outside its physical lane`);
        }
        let topBoundary;
        if (rule.topBoundary != null) {
            if (!rule.topBoundary || typeof rule.topBoundary !== 'object' || Array.isArray(rule.topBoundary) || Object.keys(rule.topBoundary).sort().join(',') !== 'layerName') throw new KJValidationError('Geology: major group top-boundary style needs an exact layer-name placement');
            const topRule = rule.topBoundary;
            const layerName = sourceTextPlacement(topRule.layerName, 'top-boundary major group layerName');
            const nameIndex = fieldGrid.findIndex((field)=>field.role === 'layerName');
            const nameWidth = (fieldGrid[nameIndex + 1]?.start ?? right) - fieldGrid[nameIndex].start;
            if (layerName.offset[0] < 0 || layerName.offset[0] > nameWidth || layerName.offset[1] < -50 || layerName.offset[1] > 50) throw new KJValidationError('Geology: top-boundary major group layerName placement is outside its physical lane');
            topBoundary = {
                layerName
            };
        }
        const layerNumberCircleRadius = rule.layerNumberCircleRadius == null ? undefined : numeric(rule.layerNumberCircleRadius, 'major group layer number circle radius');
        const numberIndex = fieldGrid.findIndex((field)=>field.role === 'layerNumber');
        const numberWidth = (fieldGrid[numberIndex + 1]?.start ?? right) - fieldGrid[numberIndex].start;
        if (layerNumberCircleRadius != null && (layerNumberCircleRadius < 1 || layerNumberCircleRadius > 10 || layerNumberCircleRadius > numberWidth / 2 - .2)) throw new KJValidationError('Geology: major group layer number circle radius is outside its physical lane');
        majorGroupValueStyle = {
            anchor: 'major-group-midpoint',
            ...placements,
            ...topBoundary ? {
                topBoundary
            } : {},
            ...layerNumberCircleRadius == null ? {} : {
                layerNumberCircleRadius
            }
        };
    }
    let titleTextStyle;
    if (value.titleTextStyle != null) {
        if (!isFieldGrid || !headerGrid || !value.titleTextStyle || typeof value.titleTextStyle !== 'object' || Array.isArray(value.titleTextStyle) || Object.keys(value.titleTextStyle).sort().join(',') !== 'anchor,placement,rotationDegrees') throw new KJValidationError('Geology: title text style needs an exact physical-header schema');
        const rule = value.titleTextStyle;
        if (rule.anchor !== 'frame-left-top') throw new KJValidationError('Geology: title text style needs the physical frame upper-left anchor');
        const placement = sourceTextPlacement(rule.placement, 'main title', 3, 12);
        const rotationDegrees = numeric(rule.rotationDegrees, 'main title rotation');
        if (Math.abs(placement.height - titleHeight) > 1e-9 || placement.offset[0] < 0 || placement.offset[0] > right - left || placement.offset[1] < -50 || placement.offset[1] > 0 || rotationDegrees !== 0) throw new KJValidationError('Geology: title text style is outside the readable title band');
        titleTextStyle = {
            anchor: 'frame-left-top',
            placement,
            rotationDegrees
        };
    }
    let defaultTextStyle;
    if (value.defaultTextStyle != null) {
        if (!isFieldGrid || !value.defaultTextStyle || typeof value.defaultTextStyle !== 'object' || Array.isArray(value.defaultTextStyle) || Object.keys(value.defaultTextStyle).sort().join(',') !== 'bigFontFile,dxfFlags,fixedHeight,fontFamily,fontFile,generationFlags,name,obliqueAngleDegrees,widthFactor') throw new KJValidationError('Geology: default text style needs an exact declarative field-grid schema');
        const rule = value.defaultTextStyle;
        const safeName = (raw, label, empty = false)=>{
            if (typeof raw !== 'string' || raw.length > 128 || !empty && !raw.length || /[\\/:\u0000-\u001f\u007f]/u.test(raw) || /^(?:data|https?)/iu.test(raw)) throw new KJValidationError(`Geology: invalid ${label}`);
            return raw;
        };
        const name = safeName(rule.name, 'default text style name');
        const fontFamily = safeName(rule.fontFamily, 'default text font family');
        const fontFile = safeName(rule.fontFile, 'default text font file');
        const bigFontFile = safeName(rule.bigFontFile, 'default text big-font file', true);
        const fixedHeight = numeric(rule.fixedHeight, 'default text fixed height');
        const widthFactor = numeric(rule.widthFactor, 'default text width factor');
        const obliqueAngleDegrees = numeric(rule.obliqueAngleDegrees, 'default text oblique angle');
        const dxfFlags = numeric(rule.dxfFlags, 'default text DXF flags');
        const generationFlags = numeric(rule.generationFlags, 'default text generation flags');
        if (fixedHeight !== 0 || widthFactor < 0.5 || widthFactor > 1.5 || obliqueAngleDegrees < -45 || obliqueAngleDegrees > 45 || !Number.isSafeInteger(dxfFlags) || dxfFlags < 0 || dxfFlags > 255 || !Number.isSafeInteger(generationFlags) || generationFlags < 0 || generationFlags > 7) throw new KJValidationError('Geology: default text style is unreadable or unsafe');
        defaultTextStyle = {
            name,
            fontFamily,
            fontFile,
            bigFontFile,
            fixedHeight,
            widthFactor,
            obliqueAngleDegrees,
            dxfFlags,
            generationFlags
        };
    }
    let stratigraphicNotationStyle;
    if (value.stratigraphicNotationStyle != null) {
        if (!isFieldGrid || !value.stratigraphicNotationStyle || typeof value.stratigraphicNotationStyle !== 'object' || Array.isArray(value.stratigraphicNotationStyle) || ![
            'qualifierHeight,symbolHeight',
            'placement,qualifierHeight,symbolHeight'
        ].includes(Object.keys(value.stratigraphicNotationStyle).sort().join(','))) throw new KJValidationError('Geology: stratigraphic notation style needs an exact declarative field-grid schema');
        const rule = value.stratigraphicNotationStyle;
        const symbolHeight = numeric(rule.symbolHeight, 'stratigraphic notation symbol height');
        const qualifierHeight = numeric(rule.qualifierHeight, 'stratigraphic notation qualifier height');
        if (symbolHeight < 1.5 || symbolHeight > 5 || qualifierHeight < 1 || qualifierHeight > symbolHeight) throw new KJValidationError('Geology: stratigraphic notation text heights are unreadable');
        let placement;
        if (rule.placement != null) {
            if (!rule.placement || typeof rule.placement !== 'object' || Array.isArray(rule.placement) || Object.keys(rule.placement).sort().join(',') !== 'anchor,fieldRole,principal,topBoundary') throw new KJValidationError('Geology: stratigraphic notation placement needs an exact semantic schema');
            const supplied = rule.placement;
            if (supplied.fieldRole !== 'layerName' || supplied.anchor !== 'major-group-midpoint') throw new KJValidationError('Geology: stratigraphic notation placement needs the layer-name field and major-group midpoint');
            const parseSet = (raw, label)=>{
                if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'subscript,superscript,symbol') throw new KJValidationError(`Geology: ${label} needs exact symbol and qualifier placements`);
                const set = raw;
                const parsed = {
                    symbol: sourceTextPlacement(set.symbol, `${label} symbol`),
                    superscript: sourceTextPlacement(set.superscript, `${label} superscript`, 1),
                    subscript: sourceTextPlacement(set.subscript, `${label} subscript`, 1)
                };
                if (Math.abs(parsed.symbol.height - symbolHeight) > 1e-9 || Math.abs(parsed.superscript.height - qualifierHeight) > 1e-9 || Math.abs(parsed.subscript.height - qualifierHeight) > 1e-9) throw new KJValidationError('Geology: stratigraphic notation placement heights must match its declared text heights');
                return parsed;
            };
            const principal = parseSet(supplied.principal, 'principal stratigraphic notation');
            const topBoundary = parseSet(supplied.topBoundary, 'top-boundary stratigraphic notation');
            const layerName = fieldGrid?.find((item)=>item.role === 'layerName');
            const layerWidth = (fieldGrid?.[fieldGrid.indexOf(layerName) + 1]?.start ?? right) - layerName.start;
            for (const item of [
                principal.symbol,
                principal.superscript,
                principal.subscript,
                topBoundary.symbol,
                topBoundary.superscript,
                topBoundary.subscript
            ]){
                if (item.offset[0] < 0 || item.offset[0] > layerWidth || item.offset[1] < -15 || item.offset[1] > 15) throw new KJValidationError('Geology: stratigraphic notation placement is outside its source-backed lane');
            }
            placement = {
                fieldRole: 'layerName',
                anchor: 'major-group-midpoint',
                principal,
                topBoundary
            };
        }
        stratigraphicNotationStyle = {
            symbolHeight,
            qualifierHeight,
            ...placement ? {
                placement
            } : {}
        };
    }
    let sampleMarkerStyle;
    if (value.sampleMarkerStyle != null) {
        if (!isFieldGrid || !value.sampleMarkerStyle || typeof value.sampleMarkerStyle !== 'object' || Array.isArray(value.sampleMarkerStyle) || Object.keys(value.sampleMarkerStyle).sort().join(',') !== 'baselineOffset,gap,height') throw new KJValidationError('Geology: sample marker style needs an exact declarative field-grid schema');
        const rule = value.sampleMarkerStyle;
        const height = numeric(rule.height, 'sample marker height'), gap = numeric(rule.gap, 'sample marker gap');
        const baselineOffset = numeric(rule.baselineOffset, 'sample marker baseline offset');
        if (height < 0.8 || height > 4 || gap < 0 || gap > 5 || baselineOffset < -3 || baselineOffset > 3) throw new KJValidationError('Geology: sample marker style is unreadable');
        sampleMarkerStyle = {
            height,
            gap,
            baselineOffset
        };
    }
    let sampleAnnotationStyle;
    if (value.sampleAnnotationStyle != null) {
        if (!isFieldGrid || !value.sampleAnnotationStyle || typeof value.sampleAnnotationStyle !== 'object' || Array.isArray(value.sampleAnnotationStyle) || Object.keys(value.sampleAnnotationStyle).sort().join(',') !== 'depthAnchor,label,marker') throw new KJValidationError('Geology: sample annotation style needs an exact declarative field-grid schema');
        const rule = value.sampleAnnotationStyle;
        if (![
            'observation-depth',
            'range-top',
            'range-bottom'
        ].includes(rule.depthAnchor)) throw new KJValidationError('Geology: sample annotation depth anchor is unsupported');
        const label = sourceTextPlacement(rule.label, 'sample annotation label');
        const marker = sourceTextPlacement(rule.marker, 'sample annotation marker', 0.8);
        const sampleIndex = fieldGrid.findIndex((field)=>field.role === 'sample');
        const sampleWidth = sampleIndex < 0 ? 0 : (fieldGrid[sampleIndex + 1]?.start ?? right) - fieldGrid[sampleIndex].start;
        if (sampleIndex < 0 || [
            label,
            marker
        ].some((placement)=>placement.offset[0] < 0 || placement.offset[0] > sampleWidth || placement.offset[1] < -10 || placement.offset[1] > 10)) throw new KJValidationError('Geology: sample annotation placement is outside its physical lane');
        sampleAnnotationStyle = {
            depthAnchor: rule.depthAnchor,
            label,
            marker
        };
    }
    let sampleRangeBaselineStyle;
    if (value.sampleRangeBaselineStyle != null) {
        const baselineKeys = value.sampleRangeBaselineStyle && typeof value.sampleRangeBaselineStyle === 'object' && !Array.isArray(value.sampleRangeBaselineStyle) ? Object.keys(value.sampleRangeBaselineStyle).sort().join(',') : '';
        if (!isFieldGrid || !value.sampleRangeBaselineStyle || typeof value.sampleRangeBaselineStyle !== 'object' || Array.isArray(value.sampleRangeBaselineStyle) || ![
            'boundaries,continuity,insetMm',
            'boundaries,continuity,endInsetMm,fieldRole,startInsetMm'
        ].includes(baselineKeys)) throw new KJValidationError('Geology: sample range baselines need an exact declarative field-grid schema');
        const rule = value.sampleRangeBaselineStyle;
        if (!Array.isArray(rule.boundaries) || rule.boundaries.length < 1 || rule.boundaries.length > 2 || rule.boundaries.some((boundary)=>boundary !== 'top' && boundary !== 'bottom') || new Set(rule.boundaries).size !== rule.boundaries.length) throw new KJValidationError('Geology: sample range baseline boundaries must contain unique top/bottom roles');
        if (rule.continuity !== 'collision-safe' && rule.continuity !== 'continuous') throw new KJValidationError('Geology: sample range baseline continuity must be collision-safe or continuous');
        const sampleIndex = fieldGrid.findIndex((field)=>field.role === 'sample');
        const sampleWidth = sampleIndex < 0 ? 0 : (fieldGrid[sampleIndex + 1]?.start ?? right) - fieldGrid[sampleIndex].start;
        const asymmetric = baselineKeys.includes('startInsetMm');
        if (asymmetric && rule.fieldRole !== 'sample') throw new KJValidationError('Geology: asymmetric sample range baseline needs the declared sample field');
        const startInsetMm = numeric(asymmetric ? rule.startInsetMm : rule.insetMm, 'sample range baseline start inset');
        const endInsetMm = numeric(asymmetric ? rule.endInsetMm : rule.insetMm, 'sample range baseline end inset');
        if (sampleIndex < 0 || startInsetMm < 0 || endInsetMm < 0 || sampleWidth - startInsetMm - endInsetMm < 0.4) throw new KJValidationError('Geology: sample range baseline inset leaves no visible source lane');
        sampleRangeBaselineStyle = {
            boundaries: rule.boundaries,
            continuity: rule.continuity,
            ...asymmetric ? {
                fieldRole: 'sample',
                startInsetMm,
                endInsetMm
            } : {
                insetMm: startInsetMm
            }
        };
    }
    let sampleRangeTextFormat;
    if (value.sampleRangeTextFormat != null) {
        const formatKeys = value.sampleRangeTextFormat && typeof value.sampleRangeTextFormat === 'object' && !Array.isArray(value.sampleRangeTextFormat) ? Object.keys(value.sampleRangeTextFormat).sort().join(',') : '';
        if (!isFieldGrid || !value.sampleRangeTextFormat || typeof value.sampleRangeTextFormat !== 'object' || Array.isArray(value.sampleRangeTextFormat) || ![
            'decimals,fieldRole,prefix,separator,suffix,trailingZeros',
            'anchor,decimals,fieldRole,placement,prefix,separator,suffix,trailingZeros'
        ].includes(formatKeys)) throw new KJValidationError('Geology: sample range text format needs an exact declarative field-grid schema');
        const rule = value.sampleRangeTextFormat;
        const textPart = (raw, label, maximum, allowEmpty)=>{
            if (typeof raw !== 'string' || !allowEmpty && !raw.length || Array.from(raw).length > maximum || /[\u0000-\u001f\u007f]/u.test(raw)) throw new KJValidationError(`Geology: invalid sample range ${label}`);
            return raw;
        };
        const prefix = textPart(rule.prefix, 'prefix', 12, true);
        const separator = textPart(rule.separator, 'separator', 4, false);
        const suffix = textPart(rule.suffix, 'suffix', 12, true);
        const decimals = numeric(rule.decimals, 'sample range decimals');
        if (rule.fieldRole !== 'sample' || !Number.isInteger(decimals) || decimals < 0 || decimals > 4 || rule.trailingZeros !== 'preserve' && rule.trailingZeros !== 'trim' || !fieldGrid.some((field)=>field.role === 'sample')) throw new KJValidationError('Geology: sample range text format is unreadable');
        let placement;
        if (formatKeys.startsWith('anchor,')) {
            if (rule.anchor !== 'range-midpoint') throw new KJValidationError('Geology: sample range text anchor must be the measured interval midpoint');
            placement = sourceTextPlacement(rule.placement, 'sample range text');
            const sampleIndex = fieldGrid.findIndex((field)=>field.role === 'sample');
            const sampleWidth = (fieldGrid[sampleIndex + 1]?.start ?? right) - fieldGrid[sampleIndex].start;
            if (placement.offset[0] < 0 || placement.offset[0] > sampleWidth || placement.offset[1] < -10 || placement.offset[1] > 10) throw new KJValidationError('Geology: sample range text placement is outside its physical lane');
        }
        sampleRangeTextFormat = {
            fieldRole: 'sample',
            prefix,
            separator,
            suffix,
            decimals,
            trailingZeros: rule.trailingZeros,
            ...placement ? {
                anchor: 'range-midpoint',
                placement
            } : {}
        };
    }
    let groundwaterAnnotationStyle;
    if (value.groundwaterAnnotationStyle != null) {
        const groundwaterStyleKeys = Object.keys(value.groundwaterAnnotationStyle).sort().join(',');
        if (!isFieldGrid || !value.groundwaterAnnotationStyle || typeof value.groundwaterAnnotationStyle !== 'object' || Array.isArray(value.groundwaterAnnotationStyle) || ![
            'dateOffset,fieldRole,gap,markerHeight,markerOffset,textHeight,textWidthFactor,valueOffset',
            'dateOffset,fieldRole,gap,guide,markerHeight,markerOffset,textHeight,textWidthFactor,valueOffset'
        ].includes(groundwaterStyleKeys)) throw new KJValidationError('Geology: groundwater annotation style needs an exact declarative field-grid schema');
        const rule = value.groundwaterAnnotationStyle;
        if (rule.fieldRole !== 'pattern') throw new KJValidationError('Geology: groundwater annotations need a declared pattern field');
        if (rule.guide != null && rule.guide !== 'field-top-to-reading') throw new KJValidationError('Geology: unsupported groundwater annotation guide');
        const textHeight = numeric(rule.textHeight, 'groundwater annotation text height');
        const markerHeight = numeric(rule.markerHeight, 'groundwater annotation marker height');
        const textWidthFactor = numeric(rule.textWidthFactor, 'groundwater annotation text width factor');
        const gap = numeric(rule.gap, 'groundwater annotation value gap');
        const valueOffset = numeric(rule.valueOffset, 'groundwater annotation value offset');
        const markerOffset = numeric(rule.markerOffset, 'groundwater annotation marker offset');
        const dateOffset = numeric(rule.dateOffset, 'groundwater annotation date offset');
        if (textHeight < 0.8 || textHeight > 4 || markerHeight < 0.8 || markerHeight > 5 || textWidthFactor < 0.5 || textWidthFactor > 1 || gap < 0 || gap > 5 || [
            valueOffset,
            markerOffset,
            dateOffset
        ].some((offset)=>offset < -10 || offset > 10) || dateOffset + textHeight + 0.2 > markerOffset || markerOffset + markerHeight + 0.2 > valueOffset) throw new KJValidationError('Geology: groundwater annotation style is unreadable');
        groundwaterAnnotationStyle = {
            fieldRole: 'pattern',
            textHeight,
            markerHeight,
            textWidthFactor,
            gap,
            valueOffset,
            markerOffset,
            dateOffset,
            ...rule.guide === 'field-top-to-reading' ? {
                guide: rule.guide
            } : {}
        };
    }
    let patternLabelStyle;
    if (value.patternLabelStyle != null) {
        if (!isFieldGrid || !value.patternLabelStyle || typeof value.patternLabelStyle !== 'object' || Array.isArray(value.patternLabelStyle) || Object.keys(value.patternLabelStyle).sort().join(',') !== 'height,minimumBandHeight,textWidthFactor') throw new KJValidationError('Geology: pattern label style needs an exact declarative field-grid schema');
        const rule = value.patternLabelStyle;
        const height = numeric(rule.height, 'pattern label height');
        const textWidthFactor = numeric(rule.textWidthFactor, 'pattern label width factor');
        const minimumBandHeight = numeric(rule.minimumBandHeight, 'pattern label minimum band height');
        if (height < 0.8 || height > 4 || textWidthFactor < 0.5 || textWidthFactor > 1 || minimumBandHeight < height || minimumBandHeight > 20) throw new KJValidationError('Geology: pattern label style is unreadable');
        patternLabelStyle = {
            height,
            textWidthFactor,
            minimumBandHeight
        };
    }
    let titleMarginFacts;
    if (value.titleMarginFacts != null) {
        if (!isFieldGrid || !Array.isArray(value.titleMarginFacts) || value.titleMarginFacts.length < 1 || value.titleMarginFacts.length > 8) throw new KJValidationError('Geology: title margin facts require 1–8 declarative field-grid placements');
        const seen = new Set();
        titleMarginFacts = value.titleMarginFacts.map((raw, index)=>{
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError(`Geology: title margin fact ${index + 1} is invalid`);
            const item = raw;
            if (![
                'anchor,edge,height,horizontalAlignment,key,label,offset,rotationDegrees,separator,textWidthFactor,verticalAlignment',
                'anchor,decoration,edge,height,horizontalAlignment,key,label,offset,rotationDegrees,separator,textWidthFactor,verticalAlignment'
            ].includes(Object.keys(item).sort().join(','))) throw new KJValidationError('Geology: title margin fact needs an exact versioned placement schema');
            const key = stableDocumentFactKey(item.key, 'title margin fact key'), canonical = key.toLowerCase();
            if (seen.has(canonical)) throw new KJValidationError('Geology: duplicate title margin fact key');
            seen.add(canonical);
            const label = bounded(item.label, 'title margin fact label', 24);
            if (typeof item.separator !== 'string' || item.separator.length > 4 || /[\u0000-\u001f\u007f]/u.test(item.separator)) throw new KJValidationError('Geology: invalid title margin fact separator');
            if (item.edge !== 'top' || ![
                'left',
                'center',
                'right'
            ].includes(String(item.anchor)) || ![
                'left',
                'center',
                'right'
            ].includes(String(item.horizontalAlignment)) || ![
                'baseline',
                'middle'
            ].includes(String(item.verticalAlignment))) throw new KJValidationError('Geology: unsupported title margin edge or alignment');
            if (!Array.isArray(item.offset) || item.offset.length !== 2) throw new KJValidationError('Geology: title margin fact offset needs two coordinates');
            const offset = item.offset.map((coordinate, coordinateIndex)=>numeric(coordinate, `title margin fact offset ${coordinateIndex + 1}`));
            const height = numeric(item.height, 'title margin fact height');
            const textWidthFactor = numeric(item.textWidthFactor, 'title margin fact width factor');
            const rotationDegrees = numeric(item.rotationDegrees, 'title margin fact rotation');
            if (height < 0.8 || height > 8 || textWidthFactor < 0.4 || textWidthFactor > 1.5 || rotationDegrees < -180 || rotationDegrees > 180) throw new KJValidationError('Geology: title margin fact typography is unreadable');
            let decoration;
            if (item.decoration != null) {
                if (!item.decoration || typeof item.decoration !== 'object' || Array.isArray(item.decoration) || Object.keys(item.decoration).sort().join(',') !== 'elbowOffset,horizontalEnd,kind') throw new KJValidationError('Geology: title margin fact decoration needs an exact source-backed schema');
                const rawDecoration = item.decoration;
                if (rawDecoration.kind !== 'top-edge-elbow-underline' || rawDecoration.horizontalEnd !== 'frame-right' || !Array.isArray(rawDecoration.elbowOffset) || rawDecoration.elbowOffset.length !== 2) throw new KJValidationError('Geology: unsupported title margin fact decoration');
                const elbowOffset = rawDecoration.elbowOffset.map((coordinate, coordinateIndex)=>numeric(coordinate, `title margin decoration offset ${coordinateIndex + 1}`));
                if (elbowOffset.some((coordinate)=>coordinate < -30 || coordinate > 30)) throw new KJValidationError('Geology: title margin fact decoration is outside the readable title band');
                decoration = {
                    kind: rawDecoration.kind,
                    elbowOffset,
                    horizontalEnd: rawDecoration.horizontalEnd
                };
            }
            return {
                key,
                label,
                separator: item.separator,
                edge: 'top',
                anchor: item.anchor,
                offset,
                height,
                textWidthFactor,
                horizontalAlignment: item.horizontalAlignment,
                verticalAlignment: item.verticalAlignment,
                rotationDegrees,
                ...decoration ? {
                    decoration
                } : {}
            };
        });
    }
    let frameStyle;
    if (value.frameStyle != null) {
        if (!isFieldGrid || !value.frameStyle || typeof value.frameStyle !== 'object' || Array.isArray(value.frameStyle) || Object.keys(value.frameStyle).sort().join(',') !== 'bottomMargin,constantWidth,topMargin') throw new KJValidationError('Geology: frame style needs an exact declarative field-grid schema');
        const rule = value.frameStyle;
        const topMargin = numeric(rule.topMargin, 'frame top margin');
        const bottomMargin = numeric(rule.bottomMargin, 'frame bottom margin');
        const constantWidth = numeric(rule.constantWidth, 'frame constant width');
        if (topMargin < 2 || topMargin > 30 || bottomMargin < 2 || bottomMargin > 30 || constantWidth < 0 || constantWidth > 2 || topMargin + bottomMargin > paperHeight - 100) throw new KJValidationError('Geology: frame style is outside the readable sheet');
        frameStyle = {
            topMargin,
            bottomMargin,
            constantWidth
        };
    }
    let descriptionTextStyle;
    if (value.descriptionTextStyle != null) {
        if (!isFieldGrid || !value.descriptionTextStyle || typeof value.descriptionTextStyle !== 'object' || Array.isArray(value.descriptionTextStyle) || Object.keys(value.descriptionTextStyle).sort().join(',') !== 'anchor,fieldRole,height') throw new KJValidationError('Geology: description text style needs an exact declarative field-grid schema');
        const rule = value.descriptionTextStyle;
        const height = numeric(rule.height, 'description text height');
        if (rule.fieldRole !== 'description' || rule.anchor !== 'declared-major-group-boundary' || height < 1.5 || height > 5) throw new KJValidationError('Geology: description text style needs the description field and declared group boundary anchors');
        descriptionTextStyle = {
            fieldRole: 'description',
            anchor: 'declared-major-group-boundary',
            height
        };
    }
    let descriptionBoundaryStyle;
    if (value.descriptionBoundaryStyle != null) {
        if (!isFieldGrid || !textFlow || !value.descriptionBoundaryStyle || typeof value.descriptionBoundaryStyle !== 'object' || Array.isArray(value.descriptionBoundaryStyle) || Object.keys(value.descriptionBoundaryStyle).sort().join(',') !== 'clearance,inset') throw new KJValidationError('Geology: description boundary style needs text flow and an exact field-grid schema');
        const rule = value.descriptionBoundaryStyle;
        const inset = numeric(rule.inset, 'description boundary inset');
        const clearance = numeric(rule.clearance, 'description boundary clearance');
        const description = fieldGrid?.find((item)=>item.role === 'description');
        const descriptionEnd = description == null ? 0 : fieldGrid?.[fieldGrid.indexOf(description) + 1]?.start ?? right;
        if (!description || inset < 0.5 || inset > 10 || inset * 2 > descriptionEnd - description.start - 4 || clearance < 0.2 || clearance > 5) throw new KJValidationError('Geology: description boundary style is unreadable');
        descriptionBoundaryStyle = {
            inset,
            clearance
        };
    }
    let formTopology;
    if (value.formTopology != null) {
        if (!isFieldGrid || !headerGrid || !footerGrid || !value.formTopology || typeof value.formTopology !== 'object' || Array.isArray(value.formTopology) || Object.keys(value.formTopology).sort().join(',') !== 'containers,headerDividers,patternCells') throw new KJValidationError('Geology: form topology needs field, header and footer grids with an exact schema');
        const rule = value.formTopology;
        if (rule.containers !== 'outer-frame-separators' || rule.headerDividers !== 'merge-adjacent-collinear' || rule.patternCells !== 'closed-outline') throw new KJValidationError('Geology: unsupported form topology strategy');
        formTopology = {
            containers: rule.containers,
            headerDividers: rule.headerDividers,
            patternCells: rule.patternCells
        };
    }
    let verticalScaleDenominators = [
        ...defaultColumnVerticalScales
    ];
    if (value.verticalScaleDenominators != null) {
        if (!Array.isArray(value.verticalScaleDenominators) || value.verticalScaleDenominators.length < 1 || value.verticalScaleDenominators.length > 16) throw new KJValidationError('Geology: style vertical scales require 1–16 standard denominators');
        verticalScaleDenominators = value.verticalScaleDenominators.map((item, index)=>numeric(item, `vertical scale denominator ${index + 1}`));
        if (verticalScaleDenominators.some((item)=>!Number.isSafeInteger(item) || item < 10 || item > 100000) || verticalScaleDenominators.some((item, index)=>index > 0 && item <= verticalScaleDenominators[index - 1])) throw new KJValidationError('Geology: style vertical scale denominators must be unique increasing integers from 10 to 100000');
    }
    const legendMode = value.legendMode == null ? 'footer' : value.legendMode;
    if (legendMode !== 'footer' && legendMode !== 'none' || legendMode === 'none' && !fieldGrid) throw new KJValidationError('Geology: undeclared or inappropriate legend mode');
    const layerNumberStyle = value.layerNumberStyle == null ? 'plain' : value.layerNumberStyle;
    if (layerNumberStyle !== 'plain' && layerNumberStyle !== 'circle') throw new KJValidationError('Geology: layer number style must be plain or circle');
    if (footerGrid && legendMode !== 'none') throw new KJValidationError('Geology: a title block cannot overlap the footer legend');
    let sourceTemplate;
    if (input.strictSourceTemplate && value.sourceTemplate == null) throw new KJValidationError('Geology: strict source template needs native vector evidence');
    if (value.sourceTemplate != null) {
        const raw = value.sourceTemplate;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: source template evidence must be a declared object');
        const evidence = raw;
        if (Object.keys(evidence).sort().join(',') !== 'fieldRoles,footerLabels,gridLineHandles,innerGridWidthMillimeters,sourceId,verticalScaleDenominator') throw new KJValidationError('Geology: source template evidence has an unknown or missing field');
        const sourceId = bounded(evidence.sourceId, 'source template ID', 64);
        const source = pack.sources.find((item)=>item.id === sourceId);
        if (!source || !/^[a-f0-9]{64}$/u.test(source.contentHash)) throw new KJValidationError('Geology: source template needs a SHA-256 pack source');
        const sourceScale = numeric(evidence.verticalScaleDenominator, 'source template vertical scale');
        const sourceWidth = numeric(evidence.innerGridWidthMillimeters, 'source template inner grid width');
        if (!Number.isSafeInteger(sourceScale) || sourceScale < 10 || sourceScale > 100000 || Math.abs(sourceWidth - (right - left)) > 0.1) throw new KJValidationError('Geology: source template scale or vector grid width differs from the declared layout');
        const actualRoles = fieldGrid?.map((item)=>item.role === 'measurement' ? `measurement:${item.key}` : item.role);
        if (!actualRoles || !Array.isArray(evidence.fieldRoles) || evidence.fieldRoles.length !== actualRoles.length || evidence.fieldRoles.some((role, index)=>role !== actualRoles[index])) throw new KJValidationError('Geology: physical field roles differ from the source template');
        const actualFooterLabels = footerGrid?.cells.map((cell)=>cell.label) ?? [];
        if (!Array.isArray(evidence.footerLabels) || evidence.footerLabels.length !== actualFooterLabels.length || evidence.footerLabels.some((label, index)=>label !== actualFooterLabels[index])) throw new KJValidationError('Geology: footer labels differ from the source template');
        if (!Array.isArray(evidence.gridLineHandles) || evidence.gridLineHandles.length < 2 || evidence.gridLineHandles.length > 256 || evidence.gridLineHandles.some((handle)=>typeof handle !== 'string' || !/^[A-Fa-f0-9]{1,16}$/u.test(handle))) throw new KJValidationError('Geology: source template needs bounded native grid line handles');
        sourceTemplate = {
            sourceId,
            sourceSha256: source.contentHash,
            verticalScaleDenominator: sourceScale,
            innerGridWidthMillimeters: sourceWidth,
            fieldRoles: actualRoles,
            footerLabels: actualFooterLabels,
            gridLineHandles: evidence.gridLineHandles
        };
    }
    return {
        paperWidth,
        paperHeight,
        left,
        right,
        columns,
        headerDepth,
        headerRowHeight,
        fieldHeaderHeight,
        footerReserve,
        legendMode,
        layerNumberStyle,
        titleHeight,
        verticalScaleDenominators,
        ...sptDisplayCap == null ? {} : {
            sptDisplayCap
        },
        ...observationColumns ? {
            observationColumns
        } : {},
        labels,
        ...displayAliases ? {
            displayAliases
        } : {},
        ...headerGrid ? {
            headerGrid
        } : {},
        ...footerGrid ? {
            footerGrid
        } : {},
        ...fieldGrid ? {
            fieldGrid
        } : {},
        ...textFlow ? {
            textFlow
        } : {},
        ...textHeights ? {
            textHeights
        } : {},
        ...intervalDepthTextStyle ? {
            intervalDepthTextStyle
        } : {},
        ...majorGroupValueStyle ? {
            majorGroupValueStyle
        } : {},
        ...titleTextStyle ? {
            titleTextStyle
        } : {},
        ...defaultTextStyle ? {
            defaultTextStyle
        } : {},
        ...stratigraphicNotationStyle ? {
            stratigraphicNotationStyle
        } : {},
        ...sampleMarkerStyle ? {
            sampleMarkerStyle
        } : {},
        ...sampleAnnotationStyle ? {
            sampleAnnotationStyle
        } : {},
        ...sampleRangeBaselineStyle ? {
            sampleRangeBaselineStyle
        } : {},
        ...sampleRangeTextFormat ? {
            sampleRangeTextFormat
        } : {},
        ...groundwaterAnnotationStyle ? {
            groundwaterAnnotationStyle
        } : {},
        ...patternLabelStyle ? {
            patternLabelStyle
        } : {},
        ...titleMarginFacts ? {
            titleMarginFacts
        } : {},
        ...frameStyle ? {
            frameStyle
        } : {},
        ...descriptionTextStyle ? {
            descriptionTextStyle
        } : {},
        ...descriptionBoundaryStyle ? {
            descriptionBoundaryStyle
        } : {},
        ...formTopology ? {
            formTopology
        } : {},
        ...sourceTemplate ? {
            sourceTemplate
        } : {}
    };
}
function sectionLayout(input) {
    const pack = validateKnowledgePack(input.sectionStylePack ?? KJDRAW_GEOLOGY_KNOWLEDGE_PACK);
    const raw = pack.rules?.['geology-section-layout'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: bundled section layout is missing');
    const value = raw;
    const scalarKeys = [
        'paperWidth',
        'paperHeight',
        'outerMargin',
        'innerMargin',
        'plotLeft',
        'plotRight',
        'plotBottom',
        'plotTop',
        'titleY',
        'scaleY',
        'footerHeight',
        'boreholeWidth',
        'elevationTickStep'
    ];
    if (Object.keys(value).sort().join(',') !== [
        ...scalarKeys,
        'footerGrid'
    ].sort().join(',')) throw new KJValidationError('Geology: section layout has an undeclared field');
    const scalars = Object.fromEntries(scalarKeys.map((key)=>[
            key,
            numeric(value[key], `section ${key}`)
        ]));
    if (scalars.paperWidth < 210 || scalars.paperWidth > 1600 || scalars.paperHeight < 210 || scalars.paperHeight > 1600 || scalars.outerMargin < 3 || scalars.innerMargin <= scalars.outerMargin || scalars.plotLeft <= scalars.innerMargin || scalars.plotRight >= scalars.paperWidth - scalars.innerMargin || scalars.plotRight - scalars.plotLeft < 250 || scalars.plotBottom < scalars.innerMargin + scalars.footerHeight + 8 || scalars.plotTop <= scalars.plotBottom + 120 || scalars.titleY <= scalars.plotTop || scalars.scaleY <= scalars.plotTop || scalars.scaleY >= scalars.titleY || scalars.boreholeWidth < 2 || scalars.boreholeWidth > 8 || scalars.elevationTickStep < 0.5 || scalars.elevationTickStep > 20) throw new KJValidationError('Geology: section layout geometry is unreadable');
    if (!Array.isArray(value.footerGrid) || value.footerGrid.length < 3 || value.footerGrid.length > 8) throw new KJValidationError('Geology: section footer grid is invalid');
    const seen = new Set(), footerGrid = value.footerGrid.map((rawCell, index)=>{
        if (!rawCell || typeof rawCell !== 'object' || Array.isArray(rawCell) || Object.keys(rawCell).sort().join(',') !== 'key,label,start') throw new KJValidationError('Geology: section footer cell needs an exact key, label and start');
        const cell = rawCell, start = numeric(cell.start, `section footer start ${index + 1}`);
        const key = stableDocumentFactKey(cell.key, 'section footer fact key'), label = bounded(cell.label, 'section footer label', 16);
        if (seen.has(key.toLowerCase())) throw new KJValidationError('Geology: duplicate section footer fact key');
        seen.add(key.toLowerCase());
        return {
            start,
            key,
            label
        };
    });
    for (const [index, cell] of footerGrid.entries()){
        const end = footerGrid[index + 1]?.start ?? scalars.paperWidth - scalars.innerMargin;
        if (index === 0 && Math.abs(cell.start - scalars.innerMargin) > 1e-6 || index && cell.start <= footerGrid[index - 1].start || end - cell.start < 28) throw new KJValidationError('Geology: section footer cell is out of bounds or unreadable');
    }
    return {
        ...scalars,
        footerGrid
    };
}
function checkHole(hole) {
    bounded(hole.id, 'hole id');
    numeric(hole.collarElevation, 'collar elevation');
    if (hole.x != null) projectCoordinate(hole.x, 'borehole X coordinate');
    if (hole.y != null) projectCoordinate(hole.y, 'borehole Y coordinate');
    if (hole.startDate != null) bounded(hole.startDate, 'start date', 32);
    if (hole.endDate != null) bounded(hole.endDate, 'end date', 32);
    positive(hole.depth, 'hole depth');
    if (hole.stableWaterDepth != null && (numeric(hole.stableWaterDepth, 'stable groundwater depth') < 0 || hole.stableWaterDepth > hole.depth)) throw new KJValidationError('Geology: stable groundwater depth is outside the hole');
    if (hole.initialWaterDepth != null && (numeric(hole.initialWaterDepth, 'initial groundwater depth') < 0 || hole.initialWaterDepth > hole.depth)) throw new KJValidationError('Geology: initial groundwater depth is outside the hole');
    if (hole.groundwaterObservations != null) {
        if (!Array.isArray(hole.groundwaterObservations) || !hole.groundwaterObservations.length || hole.groundwaterObservations.length > 32) throw new KJValidationError('Geology: groundwater observations require a bounded nonempty list');
        const identities = new Set();
        for (const item of hole.groundwaterObservations){
            if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'depth,elevation,marker,observedOn') throw new KJValidationError('Geology: groundwater observation needs exact depth, elevation, date and marker facts');
            const depth = numeric(item.depth, 'groundwater observation depth');
            const elevation = numeric(item.elevation, 'groundwater observation elevation');
            const observedOn = bounded(item.observedOn, 'groundwater observation date', 64);
            if (item.marker !== 'filled-down-triangle') throw new KJValidationError('Geology: unsupported groundwater observation marker');
            if (depth < 0 || depth > hole.depth) throw new KJValidationError('Geology: groundwater observation depth is outside the hole');
            if (Math.abs(hole.collarElevation - depth - elevation) > 0.011) throw new KJValidationError('Geology: groundwater observation depth and elevation disagree with the supplied collar');
            const identity = `${depth}:${elevation}:${observedOn}:${item.marker}`;
            if (identities.has(identity)) throw new KJValidationError('Geology: repeated groundwater observation identity');
            identities.add(identity);
        }
    }
    if (!Array.isArray(hole.strata) || !hole.strata.length || hole.strata.length > 80) throw new KJValidationError('Geology: 1–80 strata are required');
    const strata = [
        ...hole.strata
    ].sort((a, b)=>a.top - b.top);
    const grouped = strata.some((layer)=>layer.groupId != null || layer.groupRole != null);
    const finishedGroups = new Set();
    let currentGroup = null;
    const principals = new Map();
    const intervalIds = new Set();
    let previous = 0;
    for (const layer of strata){
        const code = bounded(layer.code, 'stratum code', 24);
        if (grouped) {
            const groupId = bounded(layer.groupId, 'source major group id', 24);
            if (layer.groupRole !== 'principal' && layer.groupRole !== 'lens') throw new KJValidationError('Geology: every grouped interval needs a declared principal/lens role');
            if (groupId !== currentGroup) {
                if (currentGroup != null) finishedGroups.add(currentGroup);
                if (finishedGroups.has(groupId)) throw new KJValidationError('Geology: a major group may not reappear after another group');
                currentGroup = groupId;
            }
            if (layer.groupRole === 'principal') {
                const prior = principals.get(groupId);
                if (prior && (prior.code !== layer.code || prior.name !== layer.name || prior.lithology !== layer.lithology || prior.patternKey !== layer.patternKey || JSON.stringify(prior.stratigraphicNotation) !== JSON.stringify(layer.stratigraphicNotation) || JSON.stringify(prior.descriptionPlacement) !== JSON.stringify(layer.descriptionPlacement))) throw new KJValidationError('Geology: repeated principal intervals disagree on the major group identity');
                principals.set(groupId, layer);
            }
        } else if (layer.groupId != null || layer.groupRole != null) throw new KJValidationError('Geology: incomplete source group hierarchy');
        if (layer.intervalId != null) {
            const id = bounded(layer.intervalId, 'interval id', 64);
            if (intervalIds.has(id)) throw new KJValidationError(`Geology: repeated interval id ${id}`);
            intervalIds.add(id);
        }
        bounded(layer.name, 'stratum name');
        if (layer.stratigraphicNotation != null) {
            if (!layer.stratigraphicNotation || typeof layer.stratigraphicNotation !== 'object' || Array.isArray(layer.stratigraphicNotation) || ![
                'symbol',
                'subscript,symbol',
                'superscript,symbol',
                'subscript,superscript,symbol'
            ].includes(Object.keys(layer.stratigraphicNotation).sort().join(','))) throw new KJValidationError('Geology: stratigraphic notation needs an exact symbol/qualifier schema');
            bounded(layer.stratigraphicNotation.symbol, 'stratigraphic notation symbol', 12);
            if (layer.stratigraphicNotation.subscript != null) bounded(layer.stratigraphicNotation.subscript, 'stratigraphic notation subscript', 12);
            if (layer.stratigraphicNotation.superscript != null) bounded(layer.stratigraphicNotation.superscript, 'stratigraphic notation superscript', 12);
        }
        if (layer.description != null) bounded(layer.description, 'stratum description', 512);
        if (layer.descriptionSource != null && (!layer.description || ![
            'interval',
            'layer-definition'
        ].includes(layer.descriptionSource))) throw new KJValidationError('Geology: description source requires exact interval or layer-definition provenance');
        if (layer.descriptionPlacement != null) {
            const placement = layer.descriptionPlacement;
            if (!placement || typeof placement !== 'object' || Array.isArray(placement) || Object.keys(placement).sort().join(',') !== 'boundaryRole,offsetMm' || !layer.description || layer.groupRole === 'lens' || ![
                'top',
                'bottom',
                'midpoint'
            ].includes(placement.boundaryRole)) throw new KJValidationError('Geology: description placement needs a principal description and exact boundary role');
            const offsetMm = numeric(placement.offsetMm, 'description placement offset');
            if (offsetMm < -50 || offsetMm > 50) throw new KJValidationError('Geology: description placement offset is outside the readable body');
        }
        const top = numeric(layer.top, 'stratum top'), bottom = numeric(layer.bottom, 'stratum bottom');
        if (Math.abs(top - previous) > 1e-6 || bottom <= top || bottom > hole.depth + 1e-6) throw new KJValidationError(`Geology: gap, overlap or invalid depth at ${code}`);
        if (!Object.hasOwn(pattern, layer.lithology)) throw new KJValidationError(`Geology: undeclared lithology at ${code}`);
        if (layer.patternKey != null) bounded(layer.patternKey, 'pattern key', 96);
        if (layer.patternVisibility != null && layer.patternVisibility !== 'filled' && layer.patternVisibility !== 'boundary-only') throw new KJValidationError(`Geology: invalid pattern visibility at ${code}`);
        if (layer.patternLabel != null) bounded(layer.patternLabel, 'pattern lane label', 24);
        if (layer.bottomBoundaryLineVisibility != null) {
            const visibility = layer.bottomBoundaryLineVisibility;
            if (!visibility || typeof visibility !== 'object' || Array.isArray(visibility) || Object.keys(visibility).sort().join(',') !== 'depth,pattern' || ![
                'visible',
                'hidden'
            ].includes(visibility.depth) || ![
                'visible',
                'hidden'
            ].includes(visibility.pattern) || visibility.depth === 'visible' && visibility.pattern === 'visible') throw new KJValidationError(`Geology: invalid bottom boundary line visibility at ${code}`);
        }
        previous = bottom;
    }
    if (Math.abs(previous - hole.depth) > 1e-6) throw new KJValidationError('Geology: final layer bottom must equal hole depth');
    if (grouped && [
        ...new Set(strata.map((layer)=>layer.groupId))
    ].some((groupId)=>!principals.has(groupId))) throw new KJValidationError('Geology: every major group must include a principal interval');
    if (hole.observations != null) {
        if (!Array.isArray(hole.observations) || hole.observations.length > 256) throw new KJValidationError('Geology: observations require a bounded list');
        const identities = new Set();
        for (const item of hole.observations){
            if (item.kind !== 'sample' && item.kind !== 'spt') throw new KJValidationError('Geology: unsupported observation kind');
            const id = bounded(item.id, 'observation id', 24), depth = numeric(item.depth, 'observation depth');
            if (item.displayLabel != null) bounded(item.displayLabel, 'observation display label', 24);
            if (item.sampleMarker != null && (item.kind !== 'sample' || item.sampleMarker !== 'filled-circle' && item.sampleMarker !== 'open-circle')) throw new KJValidationError('Geology: sample marker must be a declared marker on a sampled observation');
            if (item.measurements != null) {
                if (item.kind !== 'sample' || !item.measurements || typeof item.measurements !== 'object' || Array.isArray(item.measurements) || Object.keys(item.measurements).length > 16) throw new KJValidationError('Geology: bounded measurement values belong to sampled observations only');
                for (const [key, value] of Object.entries(item.measurements)){
                    if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/u.test(key)) throw new KJValidationError('Geology: invalid sampled measurement key');
                    numeric(value, `sampled measurement ${key}`);
                }
            }
            if (item.rangeTop != null || item.rangeBottom != null) {
                if (item.kind !== 'sample' || item.rangeTop == null || item.rangeBottom == null) throw new KJValidationError('Geology: sampled ranges require both measured endpoints');
                const rangeTop = numeric(item.rangeTop, 'sample range top'), rangeBottom = numeric(item.rangeBottom, 'sample range bottom');
                if (rangeTop < 0 || rangeBottom > hole.depth || rangeBottom <= rangeTop || rangeBottom - rangeTop > 5 || depth < rangeTop - 1e-6 || depth > rangeBottom + 1e-6) throw new KJValidationError('Geology: sampled range is outside its point, hole or bounded interval');
            }
            if (depth < 0 || depth > hole.depth) throw new KJValidationError('Geology: observation depth is outside the hole');
            if (item.kind === 'spt' && (item.value == null || numeric(item.value, 'SPT result') < 0)) throw new KJValidationError('Geology: SPT needs a nonnegative measured result');
            const identity = `${item.kind}:${id}:${depth}`;
            if (identities.has(identity)) throw new KJValidationError('Geology: repeated observation identity');
            identities.add(identity);
        }
    }
    const sampleRanges = (hole.observations ?? []).filter((item)=>item.kind === 'sample' && item.rangeTop != null).sort((a, b)=>a.rangeTop - b.rangeTop);
    for(let index = 1; index < sampleRanges.length; index++)if (sampleRanges[index].rangeTop < sampleRanges[index - 1].rangeBottom - 1e-6) throw new KJValidationError('Geology: sampled intervals overlap in one column lane');
    return strata;
}
function patternDefinitions(pack, strata) {
    if (!pack) {
        if (strata.some((layer)=>layer.patternKey != null)) throw new KJValidationError('Geology: a declared pattern key requires a licensed hatch pack');
        pack = KJDRAW_GEOLOGY_KNOWLEDGE_PACK;
    }
    const definitions = {};
    for (const role of new Set(strata.map((layer)=>layer.patternKey ?? layer.lithology)))definitions[role] = hatchPatternFromKnowledgePack(pack, role);
    return definitions;
}
function drawingBuilder(input, templateId, expectedRevision, hatches = {}, defaultTextStyle) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new KJValidationError('Geology: invalid expected revision');
    const prefix = `geo-${stableHash({
        input,
        templateId
    })}`;
    const linetypeId = `${prefix}-continuous`;
    const names = [
        'GEO_FRAME',
        'GEO_BOUNDARY',
        'GEO_HATCH',
        'GEO_TEXT',
        'GEO_GUIDE'
    ];
    const layers = names.map((name, index)=>({
            id: `${prefix}-layer-${index}`,
            name,
            color: [
                7,
                7,
                8,
                7,
                9
            ][index],
            linetypeId,
            lineweight: [
                35,
                35,
                18,
                18,
                9
            ][index]
        }));
    const textStyleId = defaultTextStyle ? `${prefix}-text-style` : undefined;
    const textStyles = !defaultTextStyle ? [] : [
        {
            id: textStyleId,
            name: defaultTextStyle.name,
            payload: {
                fontFamily: defaultTextStyle.fontFamily,
                fontFile: defaultTextStyle.fontFile,
                bigFontFile: defaultTextStyle.bigFontFile,
                fixedHeight: defaultTextStyle.fixedHeight,
                widthFactor: defaultTextStyle.widthFactor,
                obliqueAngle: defaultTextStyle.obliqueAngleDegrees * Math.PI / 180,
                dxfFlags: defaultTextStyle.dxfFlags,
                generationFlags: defaultTextStyle.generationFlags
            }
        }
    ];
    const entities = [];
    const add = (type, layer, payload)=>{
        if (entities.length >= 8192) throw new KJValidationError('Geology: entity budget exceeded');
        entities.push({
            type,
            payload: {
                ...payload,
                layerId: layers[layer].id
            },
            options: {
                id: `${prefix}-entity-${String(entities.length + 1).padStart(5, '0')}`
            }
        });
    };
    const line = (layer, x1, y1, x2, y2)=>add('LINE', layer, {
            start: [
                x1,
                y1,
                0
            ],
            end: [
                x2,
                y2,
                0
            ]
        });
    const semanticLine = (layer, x1, y1, x2, y2, metadata)=>add('LINE', layer, {
            start: [
                x1,
                y1,
                0
            ],
            end: [
                x2,
                y2,
                0
            ],
            ...metadata
        });
    const text = (layer, x, y, value, height = 2.6, centered = false, widthFactor, verticalAlignment)=>add('TEXT', layer, {
            position: [
                x,
                y,
                0
            ],
            text: value,
            height,
            ...textStyleId ? {
                styleId: textStyleId
            } : {},
            ...widthFactor == null ? {} : {
                widthFactor
            },
            ...centered ? {
                horizontalAlignment: 1
            } : {},
            ...verticalAlignment == null ? {} : {
                verticalAlignment
            },
            ...centered || verticalAlignment != null ? {
                alignmentPoint: [
                    x,
                    y,
                    0
                ]
            } : {}
        });
    const placedText = (layer, x, y, value, height, widthFactor, horizontalAlignment, verticalAlignment, rotation)=>add('TEXT', layer, {
            position: [
                x,
                y,
                0
            ],
            text: value,
            height,
            widthFactor,
            rotation,
            ...textStyleId ? {
                styleId: textStyleId
            } : {},
            ...horizontalAlignment === 0 ? {} : {
                horizontalAlignment
            },
            ...verticalAlignment === 0 ? {} : {
                verticalAlignment
            },
            ...horizontalAlignment !== 0 || verticalAlignment !== 0 ? {
                alignmentPoint: [
                    x,
                    y,
                    0
                ]
            } : {}
        });
    const mtext = (layer, x, y, value, height, width)=>add('MTEXT', layer, {
            position: [
                x,
                y,
                0
            ],
            text: value,
            height,
            width,
            attachmentPoint: 1,
            ...textStyleId ? {
                styleId: textStyleId
            } : {}
        });
    const poly = (layer, points, closed = false, constantWidth)=>add('LWPOLYLINE', layer, {
            vertices: points.map(([x, y])=>[
                    x,
                    y,
                    0
                ]),
            closed,
            ...constantWidth == null || constantWidth === 0 ? {} : {
                constantWidth
            }
        });
    const rect = (layer, x1, y1, x2, y2, constantWidth)=>poly(layer, [
            [
                x1,
                y1
            ],
            [
                x2,
                y1
            ],
            [
                x2,
                y2
            ],
            [
                x1,
                y2
            ]
        ], true, constantWidth);
    const circle = (layer, x, y, radius)=>add('CIRCLE', layer, {
            center: [
                x,
                y,
                0
            ],
            radius
        });
    const hatch = (points, layer)=>add('HATCH', 2, {
            boundaryLoops: [
                {
                    external: true,
                    closed: true,
                    vertices: points.map(([x, y])=>[
                            x,
                            y,
                            0
                        ])
                }
            ],
            patternName: pattern[layer.lithology],
            solid: false,
            patternScale: 0.6,
            patternAngle: 0,
            ...hatches[layer.patternKey ?? layer.lithology] ?? {}
        });
    const finish = (parameters)=>deepFreeze({
            commandArgs: {
                entities,
                resources: {
                    linetypes: [
                        {
                            id: linetypeId,
                            name: `GEO_${stableHash(prefix).toUpperCase()}_CONT`,
                            pattern: []
                        }
                    ],
                    layers,
                    ...textStyles.length ? {
                        textStyles
                    } : {}
                }
            },
            evidence: {
                packId: 'geology.core',
                packVersion: '1.0.0',
                packHash: stableHash({
                    pattern,
                    hatches
                }),
                intentHash: stableHash(input),
                templateId,
                rootObjectId: prefix,
                expectedRevision,
                entityCount: entities.length,
                ...parameters ? {
                    parameters
                } : {}
            }
        });
    return {
        line,
        semanticLine,
        text,
        placedText,
        mtext,
        poly,
        rect,
        circle,
        hatch,
        finish
    };
}
export function compileGeologyColumn(input) {
    const { hole } = input, strata = checkHole(hole);
    const layout = columnLayout(input);
    const { paperHeight: pageHeight, paperWidth: pageWidth, left, right, columns, observationColumns, headerDepth, headerRowHeight, fieldHeaderHeight, footerReserve, labels, displayAliases, headerGrid, footerGrid, fieldGrid, sptDisplayCap, titleHeight, titleTextStyle, textFlow, textHeights, intervalDepthTextStyle, majorGroupValueStyle, defaultTextStyle, stratigraphicNotationStyle, descriptionTextStyle, sampleMarkerStyle, sampleAnnotationStyle, sampleRangeBaselineStyle, sampleRangeTextFormat, groundwaterAnnotationStyle, patternLabelStyle, titleMarginFacts, frameStyle, descriptionBoundaryStyle, formTopology, layerNumberStyle, sourceTemplate } = layout;
    if (strata.some((layer)=>layer.stratigraphicNotation != null) && !stratigraphicNotationStyle) throw new KJValidationError('Geology: stratigraphic notation facts need a declared field-grid notation style');
    if (strata.some((layer)=>layer.descriptionPlacement != null) && !descriptionTextStyle) throw new KJValidationError('Geology: description placement facts need a declared field-grid description text style');
    if (strata.some((layer)=>layer.bottomBoundaryLineVisibility != null) && !fieldGrid) throw new KJValidationError('Geology: bottom boundary line visibility needs a declared physical field grid');
    const documentFacts = documentFactRecord(input.documentFacts);
    const declaredDocumentFactKeys = new Set([
        ...headerGrid?.rows.flat().filter((cell)=>cell.role === 'documentFact').map((cell)=>cell.key) ?? [],
        ...footerGrid?.cells.map((cell)=>cell.key) ?? [],
        ...titleMarginFacts?.map((item)=>item.key) ?? []
    ]);
    for (const key of Object.keys(documentFacts))if (!declaredDocumentFactKeys.has(key)) throw new KJValidationError(`Geology: document fact ${key} is not declared by the style pack`);
    const gridField = (role)=>fieldGrid?.find((field)=>field.role === role);
    const gridEnd = (field)=>fieldGrid?.[fieldGrid.indexOf(field) + 1]?.start ?? right;
    const depthX = gridField('depth')?.start ?? columns[0];
    const thicknessX = columns.length === 6 ? columns[1] : null;
    const elevationX = columns.length === 6 ? columns[2] : columns[1];
    const codeX = columns.length === 6 ? columns[3] : columns[2];
    const hatchX = columns.length === 6 ? columns[4] : columns[3];
    const descriptionX = gridField('description')?.start ?? columns.at(-1);
    const top = pageHeight - headerDepth - fieldHeaderHeight;
    const availableBodyHeight = top - footerReserve;
    const automaticScale = input.verticalScaleDenominator == null ? layout.verticalScaleDenominators.find((denominator)=>hole.depth * 1000 / denominator <= availableBodyHeight + 1e-9) : undefined;
    if (input.verticalScaleDenominator == null && automaticScale == null) throw new KJValidationError('Geology: no declared standard vertical scale fits the borehole on this sheet');
    const verticalScaleDenominator = positive(input.verticalScaleDenominator ?? automaticScale, 'vertical scale denominator');
    if (input.strictSourceTemplate && (input.verticalScaleDenominator == null || !sourceTemplate || verticalScaleDenominator !== sourceTemplate.verticalScaleDenominator)) throw new KJValidationError('Geology: explicit vertical scale differs from the source template');
    const scale = 1000 / verticalScaleDenominator;
    const bottom = top - hole.depth * scale;
    if (scale < 0.1 || scale > 100 || bottom < footerReserve) throw new KJValidationError('Geology: column does not fit the declared physical sheet at this vertical scale');
    const g = drawingBuilder(input, 'borehole-column-engineering', input.expectedRevision, patternDefinitions(input.hatchPack, strata), defaultTextStyle);
    const finishColumn = ()=>g.finish({
            verticalScaleDenominator,
            verticalScaleSource: input.verticalScaleDenominator == null ? 'style-standard' : 'explicit',
            ...sourceTemplate ? {
                sourceTemplateSha256: sourceTemplate.sourceSha256,
                sourceGridWidthMillimeters: sourceTemplate.innerGridWidthMillimeters
            } : {},
            stratumCount: strata.length,
            lithologyCount: new Set(strata.map((layer)=>layer.patternKey ?? layer.lithology)).size
        });
    const observations = hole.observations ?? [];
    if (observations.some((item)=>item.sampleMarker != null) && !sampleMarkerStyle) throw new KJValidationError('Geology: sample marker facts need a declared field-grid marker style');
    if (hole.groundwaterObservations?.length && !groundwaterAnnotationStyle) throw new KJValidationError('Geology: groundwater observation facts need a declared field-grid annotation style');
    if (strata.some((layer)=>layer.patternLabel != null) && !patternLabelStyle) throw new KJValidationError('Geology: pattern label facts need a declared field-grid label style');
    if (fieldGrid && observations.some((item)=>item.kind === 'sample' && !gridField('sample') || item.kind === 'spt' && !gridField('spt'))) throw new KJValidationError('Geology: field grid has no physical field for supplied observations');
    if (observations.length && strata.some((layer)=>layer.description) && !observationColumns && !fieldGrid) throw new KJValidationError('Geology: supplied descriptions and depth-aligned observations need separate declared columns');
    if (observations.length && !observationColumns && !fieldGrid && right - descriptionX < 42) throw new KJValidationError('Geology: style observation columns must have at least 42 mm total width');
    const sampleX = gridField('sample')?.start ?? observationColumns?.[0] ?? descriptionX;
    const sptX = gridField('spt')?.start ?? observationColumns?.[1] ?? descriptionX + 22;
    const descriptionRight = gridField('description') ? gridEnd(gridField('description')) : observationColumns?.[0] ?? right;
    const writeDescription = (description, yTop, bandHeight, identity)=>{
        const width = descriptionRight - descriptionX - 4;
        for (const height of [
            2.5,
            2.3,
            2.1,
            1.9,
            1.7,
            1.5
        ]){
            const layout = layoutCadMText({
                position: [
                    descriptionX + 2,
                    yTop - 0.3,
                    0
                ],
                text: description.trim(),
                height,
                width,
                attachmentPoint: 1
            });
            const occupied = height + (layout.lines.length - 1) * layout.lineAdvance;
            if (occupied <= bandHeight - 0.6) {
                g.mtext(3, descriptionX + 2, yTop - 0.3, description.trim(), height, width);
                return;
            }
        }
        throw new KJValidationError(`Geology: ${identity} description does not fit readably in its declared band`);
    };
    const definitionAnchors = new Map();
    for (const layer of strata)if (layer.descriptionSource === 'layer-definition' && layer.description) {
        const identity = `${layer.code}\u0000${layer.description}`;
        const prior = definitionAnchors.get(identity);
        if (!prior || layer.bottom - layer.top > prior.bottom - prior.top) definitionAnchors.set(identity, layer);
    }
    const grouped = strata[0].groupId != null;
    const groups = [];
    if (grouped) for (const layer of strata){
        const prior = groups.at(-1);
        if (prior && prior.id === layer.groupId) {
            prior.bottom = layer.bottom;
            prior.intervals.push(layer);
        } else groups.push({
            id: layer.groupId,
            top: layer.top,
            bottom: layer.bottom,
            principal: layer,
            intervals: [
                layer
            ]
        });
    }
    for (const group of groups)group.principal = group.intervals.find((layer)=>layer.groupRole === 'principal');
    const depthLabelY = new Map();
    if (grouped) {
        const pitch = 2.3, highest = top - 2, lowest = bottom + 0.4;
        const anchors = strata.map((layer)=>top - layer.bottom * scale + 0.4);
        const visible = [];
        for (const anchor of anchors)visible.push(Math.min(anchor, visible.length ? visible.at(-1) - pitch : highest));
        const shift = Math.max(0, lowest - visible.at(-1));
        for (const [index, layer] of strata.entries()){
            const value = visible[index] + shift;
            if (value > highest + 1e-9 || Math.abs(value - anchors[index]) > 7.6) throw new KJValidationError(`Geology: layer ${layer.code} depth labels cannot be separated readably at this scale`);
            depthLabelY.set(layer, value);
        }
    }
    const locale = geologyLocale(input);
    const formalFrame = Boolean(fieldGrid);
    const frameBottom = frameStyle?.bottomMargin ?? 5;
    const frameTop = pageHeight - (frameStyle?.topMargin ?? (formalFrame ? 15 : 5));
    g.rect(0, formalFrame ? left : 5, frameBottom, formalFrame ? right : pageWidth - 5, frameTop, frameStyle?.constantWidth);
    const formSeparators = new Set();
    const formSeparator = (y)=>{
        const key = y.toFixed(9);
        if (formSeparators.has(key)) return;
        formSeparators.add(key);
        g.line(0, left, y, right, y);
    };
    let titleRegionBottom = pageHeight - headerDepth;
    if (headerGrid) {
        const facts = {
            projectName: input.projectName ? bounded(input.projectName, 'project name', 96) : undefined,
            holeId: hole.id,
            collarElevation: metres(hole.collarElevation),
            depth: metres(hole.depth),
            x: hole.x == null ? undefined : metres(hole.x),
            y: hole.y == null ? undefined : metres(hole.y),
            startDate: hole.startDate,
            endDate: hole.endDate,
            initialWaterDepth: hole.initialWaterDepth == null ? undefined : metres(hole.initialWaterDepth),
            stableWaterDepth: hole.stableWaterDepth == null ? undefined : metres(hole.stableWaterDepth),
            verticalScale: `1:${scaleDenominator(verticalScaleDenominator)}`
        };
        const headerBottom = pageHeight - headerDepth;
        const rowHeight = headerRowHeight;
        const headerTop = headerBottom + rowHeight * headerGrid.rows.length;
        titleRegionBottom = headerTop;
        if (headerTop + (titleHeight ?? 5) + 1 > frameTop) throw new KJValidationError('Geology: declared title does not fit between the header and drawing frame');
        const titleValue = bounded(input.title ?? (locale === 'zh-CN' ? '钻孔柱状图' : 'BOREHOLE LOG'), 'title');
        if (titleTextStyle) {
            const placement = titleTextStyle.placement;
            const x = left + placement.offset[0], y = frameTop + placement.offset[1];
            const textWidth = [
                ...titleValue
            ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/u.test(character) ? placement.height * 0.64 : placement.height) * placement.textWidthFactor, 0);
            const textLeft = placement.horizontalAlignment === 'left' ? x : placement.horizontalAlignment === 'center' ? x - textWidth / 2 : x - textWidth;
            const textBottom = placement.verticalAlignment === 'middle' ? y - placement.height / 2 : y;
            if (textLeft < left || textLeft + textWidth > right || textBottom < headerTop || textBottom + placement.height > frameTop) throw new KJValidationError('Geology: declared main title does not fit its physical title band');
            const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2;
            const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2;
            g.placedText(3, x, y, titleValue, placement.height, placement.textWidthFactor, horizontalAlignment, verticalAlignment, titleTextStyle.rotationDegrees);
        } else {
            const titleY = headerTop + (frameTop - headerTop - (titleHeight ?? 5)) / 2;
            g.text(3, pageWidth / 2, titleY, titleValue, titleHeight ?? 5, true);
        }
        if (formTopology) {
            formSeparator(headerBottom);
            formSeparator(headerTop);
        } else g.rect(0, left, headerBottom, right, headerTop);
        const headerVerticals = [];
        for (const [rowIndex, row] of headerGrid.rows.entries()){
            const rowTop = headerTop - rowIndex * rowHeight, rowBottom = rowTop - rowHeight;
            if (rowIndex) g.line(0, left, rowTop, right, rowTop);
            const equalWidth = (right - left) / row.length;
            for (const [cellIndex, cell] of row.entries()){
                const cellLeft = cell.start ?? left + cellIndex * equalWidth;
                const cellRight = row[cellIndex + 1]?.start ?? right;
                const width = cellRight - cellLeft;
                const valueX = cell.valueStart ?? cellLeft + Math.min(25, width * 0.35);
                if (cellIndex) headerVerticals.push({
                    x: cellLeft,
                    bottom: rowBottom,
                    top: rowTop
                });
                headerVerticals.push({
                    x: valueX,
                    bottom: rowBottom,
                    top: rowTop
                });
                const identity = cell.role === 'documentFact' ? cell.key : cell.role;
                const value = cell.role === 'documentFact' ? documentFacts[cell.key] : facts[cell.role];
                if (value == null && !cell.optional) throw new KJValidationError(`Geology: declared header fact ${identity} is missing; refusing to invent a value`);
                const visibleValue = value ?? '';
                const headerFactHeight = textHeights?.headerFact ?? 2.2;
                const estimated = (text, height, widthFactor = 1)=>[
                        ...text
                    ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/u.test(character) ? height * 0.52 : height * 0.95) * widthFactor, 0);
                if (cell.textStyle) {
                    const fitsLane = (text, placement, laneWidth)=>{
                        const textWidth = estimated(text, placement.height, placement.textWidthFactor);
                        const leftExtent = placement.horizontalAlignment === 'left' ? placement.offset[0] : placement.horizontalAlignment === 'center' ? placement.offset[0] - textWidth / 2 : placement.offset[0] - textWidth;
                        return leftExtent >= -1e-9 && leftExtent + textWidth <= laneWidth + 1e-9;
                    };
                    if (!fitsLane(cell.label, cell.textStyle.label, valueX - cellLeft) || !fitsLane(visibleValue, cell.textStyle.value, cellLeft + width - valueX)) throw new KJValidationError(`Geology: header fact ${identity} does not fit its source-backed text lanes`);
                    const emitHeaderFact = (originX, text, placement)=>{
                        const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2;
                        const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2;
                        g.placedText(3, originX + placement.offset[0], rowBottom + placement.offset[1], text, placement.height, placement.textWidthFactor, horizontalAlignment, verticalAlignment, 0);
                    };
                    emitHeaderFact(cellLeft, cell.label, cell.textStyle.label);
                    if (visibleValue) emitHeaderFact(valueX, visibleValue, cell.textStyle.value);
                } else {
                    if (estimated(cell.label, headerFactHeight) > valueX - cellLeft - 3 || estimated(visibleValue, headerFactHeight) > cellLeft + width - valueX - 3) throw new KJValidationError(`Geology: header fact ${identity} does not fit the declared cell`);
                    g.text(3, cellLeft + 2, rowTop - rowHeight * 0.69, cell.label, headerFactHeight);
                    if (visibleValue) g.text(3, valueX + 2, rowTop - rowHeight * 0.69, visibleValue, headerFactHeight);
                }
            }
        }
        const continuousDividers = headerGrid.continuousDividers ?? [];
        const ordinaryHeaderVerticals = headerVerticals.filter((segment)=>!continuousDividers.some((divider)=>Math.abs(divider - segment.x) < 1e-9));
        if (formTopology) {
            const ordered = ordinaryHeaderVerticals.sort((a, b)=>a.x - b.x || a.bottom - b.bottom || a.top - b.top);
            let active;
            for (const segment of ordered){
                if (active && Math.abs(active.x - segment.x) < 1e-9 && segment.bottom <= active.top + 1e-9) active.top = Math.max(active.top, segment.top);
                else {
                    if (active) g.line(0, active.x, active.bottom, active.x, active.top);
                    active = {
                        ...segment
                    };
                }
            }
            if (active) g.line(0, active.x, active.bottom, active.x, active.top);
        } else for (const segment of ordinaryHeaderVerticals)g.line(0, segment.x, segment.bottom, segment.x, segment.top);
        for (const divider of continuousDividers)g.line(0, divider, headerBottom, divider, headerTop);
    } else {
        g.text(3, pageWidth / 2, pageHeight - 18, bounded(input.title ?? (locale === 'zh-CN' ? '工程地质钻孔柱状图' : 'ENGINEERING BOREHOLE LOG'), 'title'), titleHeight ?? 5, true);
        if (input.projectName) g.text(3, left + 2, pageHeight - 27, `${labels.project} ${bounded(input.projectName, 'project name', 96)}`, 2.5);
        g.text(3, left + 2, pageHeight - 36, `${labels.hole} ${hole.id}   ${labels.collar} ${metres(hole.collarElevation)} m   ${labels.depth} ${metres(hole.depth)} m`, 3);
        const location = [
            hole.x != null ? `${labels.x} ${metres(hole.x)}` : '',
            hole.y != null ? `${labels.y} ${metres(hole.y)}` : '',
            hole.startDate ? `${labels.startDate} ${hole.startDate}` : '',
            hole.endDate ? `${labels.endDate} ${hole.endDate}` : ''
        ].filter(Boolean).join('   ');
        if (location) g.text(3, left + 2, pageHeight - 43, location, 2.3);
        g.text(3, left + 2, pageHeight - 50, `${labels.verticalScale} 1:${scaleDenominator(verticalScaleDenominator)}   ${labels.datum}`, 2.6);
    }
    if (titleMarginFacts) {
        const occupied = [];
        for (const placement of titleMarginFacts){
            const fact = documentFacts[placement.key];
            if (fact == null) continue;
            const value = `${placement.label}${placement.separator}${fact}`;
            const x = (placement.anchor === 'left' ? 0 : placement.anchor === 'center' ? pageWidth / 2 : pageWidth) + placement.offset[0];
            const y = pageHeight + placement.offset[1];
            const width = [
                ...value
            ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/u.test(character) ? placement.height * 0.64 : placement.height), 0) * placement.textWidthFactor;
            const baseLeft = placement.horizontalAlignment === 'left' ? x : placement.horizontalAlignment === 'center' ? x - width / 2 : x - width;
            const baseBottom = placement.verticalAlignment === 'baseline' ? y : y - placement.height / 2;
            const radians = placement.rotationDegrees * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
            const points = [
                [
                    baseLeft,
                    baseBottom
                ],
                [
                    baseLeft + width,
                    baseBottom
                ],
                [
                    baseLeft + width,
                    baseBottom + placement.height
                ],
                [
                    baseLeft,
                    baseBottom + placement.height
                ]
            ].map(([pointX, pointY])=>[
                    x + (pointX - x) * cosine - (pointY - y) * sine,
                    y + (pointX - x) * sine + (pointY - y) * cosine
                ]);
            const bounds = {
                left: Math.min(...points.map((point)=>point[0])),
                right: Math.max(...points.map((point)=>point[0])),
                bottom: Math.min(...points.map((point)=>point[1])),
                top: Math.max(...points.map((point)=>point[1]))
            };
            if (bounds.left < (formalFrame ? left : 5) + 0.5 || bounds.right > (formalFrame ? right : pageWidth - 5) - 0.5 || bounds.bottom < titleRegionBottom + 0.5 || bounds.top > frameTop - 0.5) throw new KJValidationError(`Geology: title margin fact ${placement.key} crosses the title band or drawing frame`);
            if (occupied.some((prior)=>bounds.left < prior.right && bounds.right > prior.left && bounds.bottom < prior.top && bounds.top > prior.bottom)) throw new KJValidationError(`Geology: title margin fact ${placement.key} overlaps another title margin fact`);
            occupied.push(bounds);
            if (placement.decoration) {
                const elbowX = x + placement.decoration.elbowOffset[0], elbowY = y + placement.decoration.elbowOffset[1];
                if (elbowX < (formalFrame ? left : 5) + 0.5 || elbowX >= bounds.left - 0.2 || elbowY < titleRegionBottom + 0.5 || elbowY >= bounds.bottom - 0.2 || elbowY >= frameTop - 0.5) throw new KJValidationError(`Geology: title margin fact ${placement.key} decoration crosses its text or drawing frame`);
                g.poly(0, [
                    [
                        elbowX,
                        frameTop
                    ],
                    [
                        elbowX,
                        elbowY
                    ],
                    [
                        right,
                        elbowY
                    ]
                ], false);
            }
            g.placedText(3, x, y, value, placement.height, placement.textWidthFactor, placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2, placement.verticalAlignment === 'baseline' ? 0 : 2, radians);
        }
    }
    const renderLegend = ()=>{
        const distinct = [
            ...new Map(strata.map((layer)=>[
                    layer.patternKey ?? layer.lithology,
                    layer
                ])).values()
        ];
        const columnsPerRow = Math.min(4, distinct.length), rows = Math.ceil(distinct.length / columnsPerRow);
        const rowPitch = 10, requiredHeight = rows * rowPitch + 11;
        if (requiredHeight > Math.min(bottom - 2, footerReserve - 2)) throw new KJValidationError('Geology: footer legend does not fit the declared sheet; use a larger footer or a field-grid style');
        const legendY = Math.min(bottom - 3, footerReserve - 3);
        g.text(3, left, legendY, labels.legend, 2.8);
        const cellWidth = (right - left) / columnsPerRow;
        for (const [index, layer] of distinct.entries()){
            const column = index % columnsPerRow, row = Math.floor(index / columnsPerRow);
            const x = left + column * cellWidth, y = legendY - 5 - row * rowPitch;
            g.rect(0, x, y - 7, x + 8, y - 1);
            g.hatch([
                [
                    x,
                    y - 7
                ],
                [
                    x + 8,
                    y - 7
                ],
                [
                    x + 8,
                    y - 1
                ],
                [
                    x,
                    y - 1
                ]
            ], layer);
            g.text(3, x + 9, y - 5.7, layer.patternKey ? displayAliases?.names[layer.name] ?? layer.name : labels[layer.lithology], 1.8);
        }
        g.text(3, left, Math.max(2.5, legendY - 7 - rows * rowPitch), labels.footer, 2.2);
    };
    const renderFooterGrid = ()=>{
        if (!footerGrid) return;
        const bottom = frameBottom, top = bottom + footerGrid.height;
        if (formTopology) formSeparator(top);
        else g.rect(0, left, bottom, right, top);
        for (const [index, cell] of footerGrid.cells.entries()){
            const end = footerGrid.cells[index + 1]?.start ?? right;
            if (index) g.line(0, cell.start, bottom, cell.start, top);
            if (cell.internalDivider != null) g.line(0, cell.internalDivider, bottom, cell.internalDivider, top);
            const width = end - cell.start;
            const value = documentFacts[cell.key];
            if (cell.textStyle) {
                const fitsLane = (text, placement, laneWidth)=>{
                    const textWidth = [
                        ...text
                    ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/u.test(character) ? placement.height * 0.64 : placement.height) * placement.textWidthFactor, 0);
                    const leftExtent = placement.horizontalAlignment === 'left' ? placement.offset[0] : placement.horizontalAlignment === 'center' ? placement.offset[0] - textWidth / 2 : placement.offset[0] - textWidth;
                    return leftExtent >= -1e-9 && leftExtent + textWidth <= laneWidth + 1e-9;
                };
                const valueOrigin = cell.internalDivider ?? cell.start;
                if (!fitsLane(cell.label, cell.textStyle.label, (cell.internalDivider ?? end) - cell.start) || value && !fitsLane(value, cell.textStyle.value, end - valueOrigin)) throw new KJValidationError(`Geology: footer fact ${cell.key} does not fit its source-backed text lanes`);
                const emitFooterFact = (originX, text, placement)=>{
                    const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2;
                    const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2;
                    g.placedText(3, originX + placement.offset[0], bottom + placement.offset[1], text, placement.height, placement.textWidthFactor, horizontalAlignment, verticalAlignment, 0);
                };
                emitFooterFact(cell.start, cell.label, cell.textStyle.label);
                if (value) emitFooterFact(valueOrigin, value, cell.textStyle.value);
            } else {
                const labelHeight = width < 25 ? 1.4 : 1.55;
                g.text(3, cell.start + width / 2, top - labelHeight - 1, cell.label, labelHeight, true);
                if (value) {
                    const valueHeight = width < 25 ? 1.3 : 1.45;
                    const estimated = [
                        ...value
                    ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/u.test(character) ? valueHeight * 0.64 : valueHeight), 0);
                    if (estimated > width - 2) throw new KJValidationError(`Geology: footer fact ${cell.key} does not fit its declared cell`);
                    g.text(3, cell.start + width / 2, bottom + 1.2, value, valueHeight, true);
                }
            }
        }
    };
    if (fieldGrid) {
        const field = (role)=>fieldGrid.find((item)=>item.role === role);
        const fieldWidth = (item)=>gridEnd(item) - item.start;
        const estimatedWidth = (value, height)=>[
                ...value
            ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/u.test(character) ? height * 0.64 : height), 0);
        const bandLines = [];
        const majorBoundaries = [];
        const descriptionTops = new Map();
        const textBoxes = [];
        const emitFieldText = (item, y, value, height = 1.8)=>{
            const width = estimatedWidth(value, height) * (item.textWidthFactor ?? 1);
            if (width > fieldWidth(item) - 2.4) throw new KJValidationError(`Geology: ${item.role} text does not fit its declared field`);
            const centered = item.role !== 'description';
            const x = centered ? item.start + fieldWidth(item) / 2 : item.start + 1.2;
            g.text(3, x, y, value, height, centered, item.textWidthFactor);
            textBoxes.push({
                role: item.role,
                left: x - (centered ? width / 2 : 0) - 0.25,
                right: x + (centered ? width / 2 : width) + 0.25,
                bottom: y - 0.25,
                top: y + height + 0.25
            });
        };
        const emitPlacedFieldText = (item, anchorY, value, placement)=>{
            const textWidth = estimatedWidth(value, placement.height) * placement.textWidthFactor;
            const x = item.start + placement.offset[0], y = anchorY + placement.offset[1];
            const left = placement.horizontalAlignment === 'left' ? x : placement.horizontalAlignment === 'center' ? x - textWidth / 2 : x - textWidth;
            if (left < item.start + 0.2 || left + textWidth > gridEnd(item) - 0.2 || y < bottom || y > top) throw new KJValidationError(`Geology: ${item.role} text does not fit its declared source placement`);
            const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2;
            const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2;
            g.placedText(3, x, y, value, placement.height, placement.textWidthFactor, horizontalAlignment, verticalAlignment, 0);
            const textBottom = placement.verticalAlignment === 'middle' ? y - placement.height / 2 : y;
            textBoxes.push({
                role: item.role,
                left: left - 0.25,
                right: left + textWidth + 0.25,
                bottom: textBottom - 0.25,
                top: textBottom + placement.height + 0.25
            });
        };
        const emitSampleText = (item, observation, value, marker, height)=>{
            const style = sampleMarkerStyle, factor = item.textWidthFactor ?? 1;
            const glyph = marker === 'filled-circle' ? '●' : '○';
            if (sampleAnnotationStyle) {
                const anchorDepth = sampleAnnotationStyle.depthAnchor === 'observation-depth' ? observation.depth : sampleAnnotationStyle.depthAnchor === 'range-top' ? observation.rangeTop : observation.rangeBottom;
                if (anchorDepth == null) throw new KJValidationError(`Geology: sample ${observation.id} lacks its declared annotation depth anchor`);
                const anchorY = top - anchorDepth * scale;
                const emitPlaced = (text, placement)=>{
                    const textWidth = estimatedWidth(text, placement.height) * placement.textWidthFactor;
                    const x = item.start + placement.offset[0], y = anchorY + placement.offset[1];
                    const left = placement.horizontalAlignment === 'left' ? x : placement.horizontalAlignment === 'center' ? x - textWidth / 2 : x - textWidth;
                    if (left < item.start + 0.2 || left + textWidth > gridEnd(item) - 0.2 || y < bottom || y > top) throw new KJValidationError('Geology: sampled annotation does not fit its declared source lane');
                    const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2;
                    const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2;
                    g.placedText(3, x, y, text, placement.height, placement.textWidthFactor, horizontalAlignment, verticalAlignment, 0);
                    const textBottom = placement.verticalAlignment === 'middle' ? y - placement.height / 2 : y;
                    textBoxes.push({
                        role: item.role,
                        left: left - 0.25,
                        right: left + textWidth + 0.25,
                        bottom: textBottom - 0.25,
                        top: textBottom + placement.height + 0.25
                    });
                };
                emitPlaced(value, sampleAnnotationStyle.label);
                emitPlaced(glyph, sampleAnnotationStyle.marker);
                return;
            }
            const y = top - observation.depth * scale;
            const labelWidth = estimatedWidth(value, height) * factor;
            const markerWidth = estimatedWidth(glyph, style.height) * factor;
            const width = labelWidth + style.gap + markerWidth;
            if (width > fieldWidth(item) - 2.4) throw new KJValidationError('Geology: sampled marker and label do not fit their declared field');
            const start = item.start + (fieldWidth(item) - width) / 2;
            const labelX = start + labelWidth / 2, markerX = start + labelWidth + style.gap + markerWidth / 2;
            g.text(3, labelX, y, value, height, true, item.textWidthFactor);
            g.text(3, markerX, y + style.baselineOffset, glyph, style.height, true, item.textWidthFactor);
            textBoxes.push({
                role: item.role,
                left: start - 0.25,
                right: start + labelWidth + 0.25,
                bottom: y - 0.25,
                top: y + height + 0.25
            }, {
                role: item.role,
                left: markerX - markerWidth / 2 - 0.25,
                right: markerX + markerWidth / 2 + 0.25,
                bottom: y + style.baselineOffset - 0.25,
                top: y + style.baselineOffset + style.height + 0.25
            });
        };
        const emitGroundwaterAnnotation = (item, y, observation)=>{
            const style = groundwaterAnnotationStyle;
            const depthText = metres(observation.depth), elevationText = metres(observation.elevation);
            const depthWidth = estimatedWidth(depthText, style.textHeight) * style.textWidthFactor;
            const elevationWidth = estimatedWidth(elevationText, style.textHeight) * style.textWidthFactor;
            const valuesWidth = depthWidth + style.gap + elevationWidth;
            const marker = '▼', markerWidth = estimatedWidth(marker, style.markerHeight) * style.textWidthFactor;
            const dateWidth = estimatedWidth(observation.observedOn, style.textHeight) * style.textWidthFactor;
            if (Math.max(valuesWidth, markerWidth, dateWidth) > fieldWidth(item) - 2.4) throw new KJValidationError('Geology: groundwater annotation does not fit its declared field');
            const center = item.start + fieldWidth(item) / 2, valuesStart = center - valuesWidth / 2;
            const depthX = valuesStart + depthWidth / 2;
            const elevationX = valuesStart + depthWidth + style.gap + elevationWidth / 2;
            const valueY = y + style.valueOffset, markerY = y + style.markerOffset, dateY = y + style.dateOffset;
            const boxes = [
                {
                    role: item.role,
                    left: valuesStart - 0.25,
                    right: valuesStart + valuesWidth + 0.25,
                    bottom: valueY - 0.25,
                    top: valueY + style.textHeight + 0.25
                },
                {
                    role: item.role,
                    left: center - markerWidth / 2 - 0.25,
                    right: center + markerWidth / 2 + 0.25,
                    bottom: markerY - 0.25,
                    top: markerY + style.markerHeight + 0.25
                },
                {
                    role: item.role,
                    left: center - dateWidth / 2 - 0.25,
                    right: center + dateWidth / 2 + 0.25,
                    bottom: dateY - 0.25,
                    top: dateY + style.textHeight + 0.25
                }
            ];
            if (boxes.some((box)=>box.bottom < bottom + 0.4 || box.top > top - 0.2) || boxes.some((box)=>textBoxes.some((prior)=>prior.role === item.role && box.left < prior.right && box.right > prior.left && box.bottom < prior.top && box.top > prior.bottom))) throw new KJValidationError('Geology: groundwater annotation collides with its source lane or body boundary');
            if (style.guide === 'field-top-to-reading') g.poly(1, [
                [
                    item.start,
                    top
                ],
                [
                    item.start,
                    y
                ],
                [
                    gridEnd(item),
                    y
                ]
            ], false);
            g.text(3, depthX, valueY, depthText, style.textHeight, true, style.textWidthFactor);
            g.text(3, elevationX, valueY, elevationText, style.textHeight, true, style.textWidthFactor);
            g.text(3, center, markerY, marker, style.markerHeight, true, style.textWidthFactor);
            g.text(3, center, dateY, observation.observedOn, style.textHeight, true, style.textWidthFactor);
            textBoxes.push(...boxes);
        };
        const emitLayerNumber = (item, y, value, bandHeight)=>{
            const placement = majorGroupValueStyle?.layerNumber;
            if (layerNumberStyle !== 'circle') return placement ? emitPlacedFieldText(item, y, value, placement) : emitFieldText(item, y, value, Math.min(2.1, Math.max(1.4, bandHeight * 0.38)));
            const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.indexOf(value);
            const visible = circled >= 0 ? String(circled + 1) : /^\d{1,2}$/u.test(value) ? value : undefined;
            if (!visible) return placement ? emitPlacedFieldText(item, y, value, placement) : emitFieldText(item, y, value, Math.min(2.1, Math.max(1.4, bandHeight * 0.38)));
            const radius = majorGroupValueStyle?.layerNumberCircleRadius ?? Math.min(1.9, fieldWidth(item) / 2 - 1, bandHeight / 2 - 0.5);
            if (radius < 1) throw new KJValidationError('Geology: circled layer number does not fit its declared band');
            if (placement) {
                const x = item.start + placement.offset[0], centerY = y + placement.offset[1];
                if (centerY - radius < bottom || centerY + radius > top) throw new KJValidationError('Geology: circled layer number exceeds the drawing body');
                g.circle(0, x, centerY, radius);
                emitPlacedFieldText(item, y, visible, placement);
                textBoxes.push({
                    role: item.role,
                    left: x - radius - .2,
                    right: x + radius + .2,
                    bottom: centerY - radius - .2,
                    top: centerY + radius + .2
                });
            } else {
                const x = item.start + fieldWidth(item) / 2, height = Math.min(1.8, radius * 0.95);
                g.circle(0, x, y, radius);
                g.text(3, x, y - height * 0.34, visible, height, true);
                textBoxes.push({
                    role: item.role,
                    left: x - radius - 0.2,
                    right: x + radius + 0.2,
                    bottom: y - radius - 0.2,
                    top: y + radius + 0.2
                });
            }
        };
        const emitLayerName = (item, layer, yTop, yBottom, y, value, height)=>{
            const notation = layer.stratigraphicNotation;
            const anchorY = (yTop + yBottom) / 2;
            const exactNamePlacement = Math.abs(yTop - top) < 1e-9 ? majorGroupValueStyle?.topBoundary?.layerName ?? majorGroupValueStyle?.layerName : majorGroupValueStyle?.layerName;
            if (!notation) return exactNamePlacement ? emitPlacedFieldText(item, anchorY, value, exactNamePlacement) : emitFieldText(item, y, value, height);
            const style = stratigraphicNotationStyle;
            if (exactNamePlacement) emitPlacedFieldText(item, anchorY, value, exactNamePlacement);
            else {
                const nameHeight = Math.min(height, yTop - yBottom - style.symbolHeight - 1);
                if (nameHeight < 1.2) throw new KJValidationError(`Geology: stratigraphic notation for ${layer.code} does not fit its declared band`);
                emitFieldText(item, yTop - nameHeight - 0.2, value, nameHeight);
            }
            if (style.placement) {
                const placements = Math.abs(yTop - top) < 1e-9 ? style.placement.topBoundary : style.placement.principal;
                emitPlacedFieldText(item, anchorY, notation.symbol, placements.symbol);
                if (notation.subscript) emitPlacedFieldText(item, anchorY, notation.subscript, placements.subscript);
                if (notation.superscript) emitPlacedFieldText(item, anchorY, notation.superscript, placements.superscript);
                return;
            }
            const factor = item.textWidthFactor ?? 1;
            const symbolWidth = estimatedWidth(notation.symbol, style.symbolHeight) * factor;
            const qualifierWidth = Math.max(...[
                notation.subscript,
                notation.superscript
            ].filter((part)=>part != null).map((part)=>estimatedWidth(part, style.qualifierHeight) * factor), 0);
            const qualifierGap = qualifierWidth ? 0.3 : 0;
            const width = symbolWidth + qualifierGap + qualifierWidth;
            if (width > fieldWidth(item) - 2.4) throw new KJValidationError(`Geology: stratigraphic notation for ${layer.code} does not fit its declared field`);
            const start = item.start + (fieldWidth(item) - width) / 2, symbolX = start + symbolWidth / 2;
            const symbolY = yBottom + 0.5;
            g.text(3, symbolX, symbolY, notation.symbol, style.symbolHeight, true, item.textWidthFactor);
            textBoxes.push({
                role: item.role,
                left: start - 0.25,
                right: start + symbolWidth + 0.25,
                bottom: symbolY - 0.25,
                top: symbolY + style.symbolHeight + 0.25
            });
            const qualifierX = start + symbolWidth + qualifierGap;
            if (notation.subscript) {
                const qualifierY = symbolY - style.qualifierHeight * 0.3;
                g.text(3, qualifierX, qualifierY, notation.subscript, style.qualifierHeight, false, item.textWidthFactor);
                textBoxes.push({
                    role: item.role,
                    left: qualifierX - 0.25,
                    right: qualifierX + qualifierWidth + 0.25,
                    bottom: qualifierY - 0.25,
                    top: qualifierY + style.qualifierHeight + 0.25
                });
            }
            if (notation.superscript) {
                const qualifierY = symbolY + style.symbolHeight - style.qualifierHeight;
                g.text(3, qualifierX, qualifierY, notation.superscript, style.qualifierHeight, false, item.textWidthFactor);
                textBoxes.push({
                    role: item.role,
                    left: qualifierX - 0.25,
                    right: qualifierX + qualifierWidth + 0.25,
                    bottom: qualifierY - 0.25,
                    top: qualifierY + style.qualifierHeight + 0.25
                });
            }
        };
        let previousDescriptionBottom, previousLabelY, renderedCoreCount = 0;
        const firstGroupBottom = grouped ? groups[0].bottom : strata[0].bottom;
        const nextGroupBottom = grouped ? groups[1]?.bottom : strata[1]?.bottom;
        const writeGridDescription = (description, yTop, yBottom, coreIndex, identity, placement)=>{
            const width = descriptionRight - descriptionX - 4;
            if (descriptionTextStyle) {
                if (!placement) throw new KJValidationError(`Geology: ${identity} lacks its declared description boundary placement`);
                const boundaryY = placement.boundaryRole === 'top' ? yTop : placement.boundaryRole === 'bottom' ? yBottom : (yTop + yBottom) / 2;
                const anchorY = boundaryY + placement.offsetMm;
                const paragraph = layoutCadMText({
                    position: [
                        descriptionX + 2,
                        anchorY,
                        0
                    ],
                    text: description.trim(),
                    height: descriptionTextStyle.height,
                    width,
                    attachmentPoint: 1
                });
                const occupied = descriptionTextStyle.height + (paragraph.lines.length - 1) * paragraph.lineAdvance;
                if (anchorY > top + 1e-9 || anchorY - occupied < bottom - 1e-9 || previousDescriptionBottom != null && anchorY > previousDescriptionBottom - 0.2) throw new KJValidationError(`Geology: ${identity} source description placement collides or exceeds the drawing body`);
                g.mtext(3, descriptionX + 2, anchorY, description.trim(), descriptionTextStyle.height, width);
                descriptionTops.set(coreIndex, anchorY);
                previousDescriptionBottom = anchorY - occupied;
                return;
            }
            if (!textFlow) return writeDescription(description, yTop, yTop - yBottom, identity);
            for (const height of [
                2.5,
                2.3,
                2.1,
                1.9,
                1.7,
                1.5
            ]){
                const anchorY = Math.min(yTop - 0.3, previousDescriptionBottom == null ? yTop - 0.3 : previousDescriptionBottom - textFlow.paragraphGapMm);
                const paragraph = layoutCadMText({
                    position: [
                        descriptionX + 2,
                        anchorY,
                        0
                    ],
                    text: description.trim(),
                    height,
                    width,
                    attachmentPoint: 1
                });
                const occupied = height + (paragraph.lines.length - 1) * paragraph.lineAdvance;
                const lowest = coreIndex === 0 ? Math.max(yBottom - textFlow.firstGroupBorrowMm, nextGroupBottom == null ? yBottom : top - nextGroupBottom * scale + 0.4) : yBottom + 0.4;
                if (anchorY - occupied >= lowest) {
                    g.mtext(3, descriptionX + 2, anchorY, description.trim(), height, width);
                    descriptionTops.set(coreIndex, anchorY);
                    previousDescriptionBottom = anchorY - occupied;
                    return;
                }
            }
            throw new KJValidationError(`Geology: ${identity} description collides with another text lane or exceeds source-declared borrow`);
        };
        const formBottom = footerReserve;
        if (formTopology) {
            formSeparator(formBottom);
            formSeparator(pageHeight - headerDepth);
        } else g.rect(0, left, formBottom, right, pageHeight - headerDepth);
        for (const item of fieldGrid){
            if (item.start !== left) g.line(0, item.start, formBottom, item.start, pageHeight - headerDepth);
            const centerX = item.start + fieldWidth(item) / 2;
            if (item.headerTextStyle) {
                const emitFieldHeaderText = (value, placement)=>{
                    const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2;
                    const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2;
                    g.placedText(3, item.start + placement.offset[0], top + placement.offset[1], value, placement.height, placement.textWidthFactor, horizontalAlignment, verticalAlignment, 0);
                };
                emitFieldHeaderText(item.label, item.headerTextStyle.main);
                if (item.subLabel) emitFieldHeaderText(item.subLabel.replaceAll('{verticalScale}', scaleDenominator(verticalScaleDenominator)), item.headerTextStyle.sub);
            } else if (item.subLabel) {
                const subLabel = item.subLabel.replaceAll('{verticalScale}', scaleDenominator(verticalScaleDenominator));
                g.text(3, centerX, pageHeight - headerDepth - fieldHeaderHeight * 0.42, item.label, textHeights?.fieldHeader ?? 1.8, true, item.textWidthFactor);
                g.text(3, centerX, pageHeight - headerDepth - fieldHeaderHeight * 0.78, subLabel, textHeights?.fieldSubHeader ?? 1.6, true, item.textWidthFactor);
            } else g.text(3, centerX, pageHeight - headerDepth - fieldHeaderHeight * 0.62, item.label, textHeights?.fieldHeader ?? 1.8, true, item.textWidthFactor);
        }
        if (formTopology) formSeparator(top);
        else g.line(0, left, top, right, top);
        const patternField = field('pattern'), depthField = field('depth');
        const writeCore = (id, groupTop, groupBottom, principal)=>{
            const yTop = top - groupTop * scale, yBottom = top - groupBottom * scale;
            const coreIndex = renderedCoreCount++;
            const mid = (yTop + yBottom) / 2;
            let labelY = mid;
            let labelHeight = textHeights?.majorValue ?? 2.1;
            if (!majorGroupValueStyle) {
                labelY = yTop - Math.max(1.8, (yTop - yBottom) / 2);
                if (textHeights) labelY = Math.min(labelY, yTop - labelHeight - 0.2);
                if (textFlow && coreIndex < 2) {
                    labelHeight = textFlow.labelHeightMm;
                    labelY = Math.min(yTop - textFlow.firstBaselineMm, previousLabelY == null ? yTop - textFlow.firstBaselineMm : previousLabelY - textFlow.labelPitchMm);
                }
                const lowest = textFlow && coreIndex === 0 ? Math.max(yBottom - textFlow.firstGroupBorrowMm, nextGroupBottom == null ? yBottom : top - nextGroupBottom * scale + 0.4) : yBottom + 0.4;
                if (labelY < lowest || labelY + labelHeight > yTop - 0.2 || previousLabelY != null && previousLabelY - labelY < labelHeight + 0.5) throw new KJValidationError(`Geology: group ${id} core labels collide with a boundary or another text lane`);
                previousLabelY = labelY;
            }
            const values = {
                layerNumber: displayAliases?.codes[principal.code] ?? id,
                layerName: displayAliases?.names[principal.name] ?? principal.name,
                baseElevation: metres(hole.collarElevation - groupBottom),
                thickness: metres(groupBottom - groupTop)
            };
            const valueY = majorGroupValueStyle ? mid : textFlow && coreIndex < 2 ? labelY : yTop - yBottom < 2 ? labelY : mid;
            const numberBandHeight = textFlow && coreIndex === 0 ? Math.max(yTop - yBottom, textFlow.firstBaselineMm + textFlow.labelHeightMm + 1) : yTop - yBottom;
            emitLayerNumber(field('layerNumber'), valueY, values.layerNumber, numberBandHeight);
            emitLayerName(field('layerName'), principal, yTop, yBottom, valueY, values.layerName, labelHeight);
            for (const role of [
                'baseElevation',
                'thickness'
            ]){
                if (majorGroupValueStyle) emitPlacedFieldText(field(role), mid, values[role], majorGroupValueStyle[role]);
                else emitFieldText(field(role), valueY, values[role], labelHeight);
            }
            if (principal.description && (grouped || principal.descriptionSource !== 'layer-definition' || definitionAnchors.get(`${principal.code}\u0000${principal.description}`) === principal)) writeGridDescription(principal.description, yTop, yBottom, coreIndex, `major group ${id}`, principal.descriptionPlacement);
        };
        for (const layer of strata){
            const yTop = top - layer.top * scale, yBottom = top - layer.bottom * scale;
            if (yTop - yBottom < (grouped ? 0.4 : 1.4)) throw new KJValidationError(`Geology: layer ${layer.code} is too thin for readable geometry at this scale`);
            const major = !grouped || groups.some((group)=>Math.abs(group.bottom - layer.bottom) < 1e-6);
            const fieldBoundary = layer.bottomBoundaryLineVisibility;
            const independentBoundaryFields = !major || textFlow?.firstGroupUnruled && Math.abs(layer.bottom - firstGroupBottom) < 1e-6;
            if (fieldBoundary && !independentBoundaryFields) throw new KJValidationError(`Geology: layer ${layer.code} bottom boundary is not independently rendered by field`);
            if (major && descriptionBoundaryStyle) majorBoundaries.push({
                y: yBottom
            });
            else if (major && !(textFlow?.firstGroupUnruled && Math.abs(layer.bottom - firstGroupBottom) < 1e-6)) bandLines.push({
                x1: left,
                x2: right,
                y: yBottom
            });
            else if (major) for (const role of [
                'depth',
                'pattern'
            ]){
                if (fieldBoundary?.[role] === 'hidden') continue;
                const item = field(role);
                bandLines.push({
                    x1: item.start,
                    x2: gridEnd(item),
                    y: yBottom
                });
            }
            else for (const role of [
                'depth',
                'pattern'
            ]){
                if (fieldBoundary?.[role] === 'hidden') continue;
                const item = field(role);
                bandLines.push({
                    x1: item.start,
                    x2: gridEnd(item),
                    y: yBottom
                });
            }
            if (layer.patternVisibility !== 'boundary-only') {
                const patternCell = [
                    [
                        patternField.start,
                        yBottom
                    ],
                    [
                        gridEnd(patternField),
                        yBottom
                    ],
                    [
                        gridEnd(patternField),
                        yTop
                    ],
                    [
                        patternField.start,
                        yTop
                    ]
                ];
                if (formTopology) g.poly(1, patternCell, true);
                g.hatch(patternCell, layer);
            }
            if (layer.patternLabel) {
                const style = patternLabelStyle, bandHeight = yTop - yBottom;
                const width = estimatedWidth(layer.patternLabel, style.height) * style.textWidthFactor;
                if (bandHeight + 1e-9 < style.minimumBandHeight || width > fieldWidth(patternField) - 2.4) throw new KJValidationError(`Geology: pattern label for ${layer.code} does not fit its declared interval`);
                const x = patternField.start + fieldWidth(patternField) / 2, y = (yTop + yBottom) / 2;
                g.text(3, x, y, layer.patternLabel, style.height, true, style.textWidthFactor, 2);
                textBoxes.push({
                    role: 'pattern',
                    left: x - width / 2,
                    right: x + width / 2,
                    bottom: y - style.height / 2 + 0.1,
                    top: y + style.height / 2 - 0.1
                });
            }
            const depthY = depthLabelY.get(layer) ?? yBottom + 0.4;
            if (Math.abs(depthY - (yBottom + 0.4)) > 0.6) g.line(1, gridEnd(depthField) - 5, yBottom, gridEnd(depthField) - 1, depthY);
            const intervalDepthHeight = textHeights?.intervalDepth ?? (grouped ? 1.5 : Math.min(2.1, (yTop - yBottom) * 0.55));
            if (!intervalDepthTextStyle && textHeights && intervalDepthHeight > yTop - yBottom - 0.4) throw new KJValidationError(`Geology: layer ${layer.code} depth text does not fit its declared band`);
            if (intervalDepthTextStyle) emitPlacedFieldText(depthField, yBottom, metres(layer.bottom), layer.groupRole === 'lens' ? intervalDepthTextStyle.lens : intervalDepthTextStyle.principal);
            else emitFieldText(depthField, depthY, metres(layer.bottom), intervalDepthHeight);
            if (!grouped) writeCore(layer.code, layer.top, layer.bottom, layer);
        }
        if (grouped) for (const group of groups)writeCore(group.id, group.top, group.bottom, group.principal);
        if (descriptionBoundaryStyle) {
            const descriptionField = field('description'), descriptionEnd = gridEnd(descriptionField);
            for (const [index, boundary] of majorBoundaries.entries()){
                const nextDescriptionTop = descriptionTops.get(index + 1);
                const descriptionY = nextDescriptionTop == null ? boundary.y : Math.min(boundary.y, nextDescriptionTop + descriptionBoundaryStyle.clearance);
                if (descriptionY < bottom - 1e-9 || descriptionY > boundary.y + 1e-9) throw new KJValidationError('Geology: stepped description boundary exceeds the declared body');
                g.poly(1, [
                    [
                        left,
                        boundary.y
                    ],
                    [
                        descriptionField.start,
                        boundary.y
                    ],
                    [
                        descriptionField.start + descriptionBoundaryStyle.inset,
                        descriptionY
                    ],
                    [
                        descriptionEnd - descriptionBoundaryStyle.inset,
                        descriptionY
                    ],
                    [
                        descriptionEnd,
                        boundary.y
                    ],
                    [
                        right,
                        boundary.y
                    ]
                ]);
            }
        }
        for (const item of observations){
            const y = top - item.depth * scale;
            if (item.kind === 'spt' && sptDisplayCap != null && item.displayLabel != null) throw new KJValidationError('Geology: SPT display cap cannot coexist with a caller-provided display label');
            for (const cell of fieldGrid){
                let value;
                if (cell.role === 'sample' && item.kind === 'sample') value = item.displayLabel ?? item.id;
                if (cell.role === 'spt' && item.kind === 'spt') {
                    const shown = sptDisplayCap == null ? item.value : Math.min(item.value, sptDisplayCap);
                    value = item.displayLabel ?? `N=${Number.isInteger(shown) ? shown.toString() : metres(shown)}`;
                }
                if (cell.role === 'measurement' && item.kind === 'sample' && Object.hasOwn(item.measurements ?? {}, cell.key)) value = item.measurements[cell.key].toFixed(cell.decimals ?? 2);
                if (value != null) {
                    const height = textHeights?.observation ?? 1.5;
                    if (cell.role === 'sample' && item.kind === 'sample' && item.sampleMarker) emitSampleText(cell, item, value, item.sampleMarker, height);
                    else emitFieldText(cell, y, value, height);
                }
                if (cell.role === 'sample' && item.kind === 'sample' && item.rangeTop != null && item.rangeBottom != null) {
                    const rangeTopY = top - item.rangeTop * scale, rangeBottomY = top - item.rangeBottom * scale;
                    const rangeEndpoint = (value)=>{
                        if (!sampleRangeTextFormat) return metres(value);
                        const fixed = value.toFixed(sampleRangeTextFormat.decimals);
                        return sampleRangeTextFormat.trailingZeros === 'preserve' ? fixed : fixed.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
                    };
                    const rangeText = sampleRangeTextFormat ? `${sampleRangeTextFormat.prefix}${rangeEndpoint(item.rangeTop)}${sampleRangeTextFormat.separator}${rangeEndpoint(item.rangeBottom)}${sampleRangeTextFormat.suffix}` : `${metres(item.rangeTop)}–${metres(item.rangeBottom)}`;
                    if (sampleRangeTextFormat?.placement) {
                        const placement = sampleRangeTextFormat.placement, anchorY = (rangeTopY + rangeBottomY) / 2;
                        emitPlacedFieldText(cell, anchorY, rangeText, placement);
                    } else {
                        const rangeTextY = rangeBottomY - 2.2;
                        if (rangeTextY < bottom + 0.4 || textBoxes.some((box)=>box.role === 'sample' && rangeTextY - 0.25 <= box.top && rangeTextY + 1.75 >= box.bottom)) throw new KJValidationError(`Geology: sampled range ${item.id} cannot be labelled without colliding in its source lane`);
                        emitFieldText(cell, rangeTextY, rangeText, textHeights?.observation ?? 1.5);
                    }
                    const baselineStyle = sampleRangeBaselineStyle ?? {
                        boundaries: [
                            'top',
                            'bottom'
                        ],
                        continuity: 'collision-safe',
                        insetMm: 0
                    };
                    const baselineY = {
                        top: rangeTopY,
                        bottom: rangeBottomY
                    };
                    const startInsetMm = 'insetMm' in baselineStyle ? baselineStyle.insetMm : baselineStyle.startInsetMm;
                    const endInsetMm = 'insetMm' in baselineStyle ? baselineStyle.insetMm : baselineStyle.endInsetMm;
                    for (const boundary of baselineStyle.boundaries)bandLines.push({
                        x1: cell.start + startInsetMm,
                        x2: gridEnd(cell) - endInsetMm,
                        y: baselineY[boundary],
                        ...baselineStyle.continuity === 'continuous' ? {
                            continuity: 'continuous'
                        } : {}
                    });
                }
            }
        }
        if (hole.groundwaterObservations) {
            const groundwaterField = field(groundwaterAnnotationStyle.fieldRole);
            for (const item of hole.groundwaterObservations)emitGroundwaterAnnotation(groundwaterField, top - item.depth * scale, item);
        }
        for (const line of bandLines){
            if (line.continuity === 'continuous') {
                g.line(1, line.x1, line.y, line.x2, line.y);
                continue;
            }
            let cursor = line.x1;
            const gaps = textBoxes.filter((box)=>box.bottom <= line.y && line.y <= box.top && box.right > line.x1 && box.left < line.x2).map((box)=>({
                    left: Math.max(line.x1, box.left),
                    right: Math.min(line.x2, box.right)
                })).sort((a, b)=>a.left - b.left);
            for (const gap of gaps){
                if (gap.left - cursor >= 0.4) g.line(1, cursor, line.y, gap.left, line.y);
                cursor = Math.max(cursor, gap.right);
            }
            if (line.x2 - cursor >= 0.4) g.line(1, cursor, line.y, line.x2, line.y);
        }
        if (layout.legendMode === 'footer') renderLegend();
        renderFooterGrid();
        return finishColumn();
    }
    g.rect(0, left, bottom, right, pageHeight - headerDepth);
    for (const x of columns)g.line(0, x, bottom, x, pageHeight - headerDepth);
    if (observations.length) {
        g.line(0, sptX, bottom, sptX, pageHeight - headerDepth);
        if (observationColumns) g.line(0, sampleX, bottom, sampleX, pageHeight - headerDepth);
    }
    const headings = [
        [
            left + 2,
            labels.depthColumn
        ]
    ];
    if (thicknessX != null) headings.push([
        depthX + 2,
        labels.thicknessColumn
    ]);
    headings.push([
        (thicknessX ?? depthX) + 2,
        labels.elevationColumn
    ], [
        elevationX + 2,
        labels.codeColumn
    ], [
        codeX + 2,
        labels.hatchColumn
    ], [
        hatchX + 2,
        labels.stratumColumn
    ], [
        descriptionX + 2,
        observationColumns || !observations.length ? labels.descriptionColumn : labels.sampleColumn
    ]);
    for (const [x, label] of headings)g.text(3, x, pageHeight - headerDepth - 6, label, 2.3);
    if (observations.length) {
        if (observationColumns) g.text(3, sampleX + 2, pageHeight - headerDepth - 6, labels.sampleColumn, 2.3);
        g.text(3, sptX + 2, pageHeight - headerDepth - 6, labels.sptColumn, 2.3);
    }
    g.line(0, left, top, right, top);
    for (const layer of strata){
        const yTop = top - layer.top * scale, yBottom = top - layer.bottom * scale;
        const bandHeight = yTop - yBottom;
        if (bandHeight < (grouped ? 0.4 : 1.4)) throw new KJValidationError(`Geology: layer ${layer.code} is too thin for readable geometry at this scale`);
        const isMajorBoundary = !grouped || groups.some((group)=>Math.abs(group.bottom - layer.bottom) < 1e-6);
        g.line(1, isMajorBoundary ? left : depthX, yBottom, isMajorBoundary ? right : descriptionX, yBottom);
        if (layer.patternVisibility !== 'boundary-only') g.hatch([
            [
                codeX,
                yBottom
            ],
            [
                hatchX,
                yBottom
            ],
            [
                hatchX,
                yTop
            ],
            [
                codeX,
                yTop
            ]
        ], layer);
        const labelHeight = Math.min(2.3, bandHeight * 0.55);
        const depthY = depthLabelY.get(layer) ?? yBottom + 0.4;
        if (grouped && Math.abs(depthY - (yBottom + 0.4)) > 0.6) g.line(1, depthX - 5, yBottom, depthX - 1, depthY);
        g.text(3, left + 2, depthY, metres(layer.bottom), grouped ? 1.6 : labelHeight);
        if (grouped) continue;
        if (thicknessX != null) g.text(3, depthX + 2, yBottom + 0.4, metres(layer.bottom - layer.top), labelHeight);
        g.text(3, (thicknessX ?? depthX) + 2, yBottom + 0.4, metres(hole.collarElevation - layer.bottom), labelHeight);
        g.text(3, elevationX + 2, (yTop + yBottom) / 2, displayAliases?.codes[layer.code] ?? layer.code, labelHeight);
        g.text(3, hatchX + 2, (yTop + yBottom) / 2, displayAliases?.names[layer.name] ?? layer.name, labelHeight);
        if (layer.description && (layer.descriptionSource !== 'layer-definition' || definitionAnchors.get(`${layer.code}\u0000${layer.description}`) === layer)) {
            writeDescription(layer.description, yTop, bandHeight, `layer ${layer.code}`);
        }
    }
    if (grouped) for (const group of groups){
        const yTop = top - group.top * scale, yBottom = top - group.bottom * scale;
        const bandHeight = yTop - yBottom;
        const labelHeight = Math.min(2.3, Math.max(1.5, bandHeight * 0.55));
        const labelY = bandHeight < 4 ? yTop - 2 : (yTop + yBottom) / 2;
        const principal = group.principal;
        if (thicknessX != null) g.text(3, depthX + 2, labelY, metres(group.bottom - group.top), labelHeight);
        g.text(3, (thicknessX ?? depthX) + 2, labelY, metres(hole.collarElevation - group.bottom), labelHeight);
        g.text(3, elevationX + 2, labelY, displayAliases?.codes[principal.code] ?? group.id, labelHeight);
        g.text(3, hatchX + 2, labelY, displayAliases?.names[principal.name] ?? principal.name, labelHeight);
        if (principal.description) writeDescription(principal.description, yTop, bandHeight, `major group ${group.id}`);
    }
    for (const item of observations){
        const y = top - item.depth * scale;
        if (item.kind === 'spt' && sptDisplayCap != null && item.displayLabel != null) throw new KJValidationError('Geology: SPT display cap cannot coexist with a caller-provided display label');
        const shownSPT = item.kind === 'spt' && sptDisplayCap != null ? Math.min(item.value, sptDisplayCap) : item.value;
        const label = item.kind === 'sample' ? item.displayLabel ?? item.id : item.displayLabel ?? `N=${Number.isInteger(shownSPT) ? shownSPT.toString() : metres(shownSPT)}`;
        const columnWidth = item.kind === 'sample' ? sptX - sampleX : right - sptX;
        const estimatedWidth = [
            ...label
        ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/.test(character) ? 1.62 : 1.8), 0);
        if (estimatedWidth > columnWidth - 3) throw new KJValidationError(`Geology: observation ${item.id} label does not fit its declared column`);
        g.text(3, (item.kind === 'sample' ? sampleX : sptX) + 2, y, label, 1.8);
    }
    renderLegend();
    renderFooterGrid();
    return finishColumn();
}
export function compileGeologySection(input) {
    if (input.surfaceRule !== 'straight-between-supplied-collars') throw new KJValidationError('Geology: an explicit surface connection rule is required');
    if (!Array.isArray(input.holes) || input.holes.length < 2 || input.holes.length > 24) throw new KJValidationError('Geology: section requires 2–24 holes');
    if (input.holes.some((hole)=>hole.groundwaterObservations?.length)) throw new KJValidationError('Geology: down-hole groundwater annotation facts belong to column layouts, not section summaries');
    const correlationMode = input.correlationMode ?? 'explicit-correlations';
    if (correlationMode !== 'explicit-correlations' && correlationMode !== 'source-group-topology') throw new KJValidationError('Geology: invalid section correlation mode');
    if (!Array.isArray(input.correlations) || input.correlations.length > 200) throw new KJValidationError('Geology: invalid correlation list');
    const manualConnections = input.manualConnections ?? [];
    if (!Array.isArray(manualConnections) || manualConnections.length > 200) throw new KJValidationError('Geology: invalid manual connection list');
    if (correlationMode === 'source-group-topology' && (input.correlations.length || manualConnections.length)) throw new KJValidationError('Geology: source-group topology conflicts with explicit correlations or manual connections');
    const layout = sectionLayout(input);
    const documentFacts = documentFactRecord(input.documentFacts);
    if (input.projectName != null) bounded(input.projectName, 'project name', 96);
    if (Object.hasOwn(documentFacts, 'projectName')) throw new KJValidationError('Geology: section projectName must use its dedicated field');
    const declaredFacts = new Set(layout.footerGrid.map((cell)=>cell.key).filter((key)=>key !== 'projectName'));
    for (const key of Object.keys(documentFacts))if (!declaredFacts.has(key)) throw new KJValidationError(`Geology: document fact ${key} is not declared by the section style`);
    const holes = [
        ...input.holes
    ].sort((a, b)=>numeric(a.station, 'station') - numeric(b.station, 'station'));
    const hs = 1000 / positive(input.horizontalScaleDenominator, 'horizontal scale denominator');
    const vs = 1000 / positive(input.verticalScaleDenominator, 'vertical scale denominator');
    const datum = numeric(input.datumElevation, 'datum elevation');
    const byId = new Map();
    for (const hole of holes){
        const strata = checkHole(hole);
        if (byId.has(hole.id)) throw new KJValidationError('Geology: duplicate hole id');
        byId.set(hole.id, {
            hole,
            strata
        });
    }
    for(let i = 1; i < holes.length; i++)if (holes[i].station <= holes[i - 1].station) throw new KJValidationError('Geology: stations must be strictly increasing');
    const topology = correlationMode === 'source-group-topology' ? compileGeologySectionTopology(holes.map((hole)=>({
            id: hole.id,
            station: hole.station,
            collarElevation: hole.collarElevation,
            depth: hole.depth,
            strata: byId.get(hole.id).strata
        }))) : undefined;
    const originX = layout.plotLeft + 18;
    const x = (hole)=>originX + (hole.station - holes[0].station) * hs;
    const y = (hole, depth)=>layout.plotBottom + (hole.collarElevation - depth - datum) * vs;
    if (x(holes.at(-1)) > layout.plotRight - 4 || holes.some((hole)=>y(hole, 0) > layout.plotTop || y(hole, hole.depth) < layout.plotBottom)) throw new KJValidationError('Geology: section does not fit A3 at the declared scales and datum');
    const g = drawingBuilder(input, 'geology-section-engineering', input.expectedRevision, patternDefinitions(input.hatchPack, [
        ...byId.values()
    ].flatMap((value)=>value.strata)));
    g.rect(0, layout.outerMargin, layout.outerMargin, layout.paperWidth - layout.outerMargin, layout.paperHeight - layout.outerMargin);
    g.rect(0, layout.innerMargin, layout.innerMargin, layout.paperWidth - layout.innerMargin, layout.paperHeight - layout.innerMargin);
    const locale = geologyLocale(input);
    g.text(3, layout.paperWidth / 2, layout.titleY, bounded(input.title ?? (locale === 'zh-CN' ? '工程地质剖面图' : 'ENGINEERING GEOLOGICAL SECTION'), 'title'), 5, true);
    g.text(3, layout.paperWidth / 2, layout.scaleY, locale === 'zh-CN' ? `水平比例尺 1:${scaleDenominator(input.horizontalScaleDenominator)}   垂直比例尺 1:${scaleDenominator(input.verticalScaleDenominator)}` : `HORIZONTAL 1:${scaleDenominator(input.horizontalScaleDenominator)}   VERTICAL 1:${scaleDenominator(input.verticalScaleDenominator)}`, 2.5, true);
    g.line(1, layout.plotLeft, layout.plotBottom, layout.plotLeft, layout.plotTop);
    g.line(1, layout.plotLeft, layout.plotBottom, layout.plotRight, layout.plotBottom);
    const maximumElevation = Math.max(...holes.map((hole)=>hole.collarElevation));
    for(let elevation = Math.ceil(datum / layout.elevationTickStep) * layout.elevationTickStep; elevation <= maximumElevation + 1e-9; elevation += layout.elevationTickStep){
        const tickY = layout.plotBottom + (elevation - datum) * vs;
        if (tickY > layout.plotTop) break;
        g.line(1, layout.plotLeft - 1.8, tickY, layout.plotLeft + 2.2, tickY);
        g.text(3, layout.plotLeft - 13, tickY - 0.7, Number.isInteger(elevation) ? elevation.toFixed(0) : metres(elevation), 1.6);
    }
    const footerBottom = layout.innerMargin, footerTop = footerBottom + layout.footerHeight;
    g.rect(0, layout.innerMargin, footerBottom, layout.paperWidth - layout.innerMargin, footerTop);
    const footerValues = {
        projectName: input.projectName,
        ...documentFacts
    };
    for (const [index, cell] of layout.footerGrid.entries()){
        const end = layout.footerGrid[index + 1]?.start ?? layout.paperWidth - layout.innerMargin;
        if (index) g.line(0, cell.start, footerBottom, cell.start, footerTop);
        const split = cell.start + Math.min((end - cell.start) * 0.42, 3 + [
            ...cell.label
        ].length * 1.75);
        g.line(1, split, footerBottom, split, footerTop);
        g.text(3, cell.start + 1.2, footerBottom + 2.8, cell.label, 1.6);
        if (footerValues[cell.key]) g.text(3, split + 1.2, footerBottom + 2.8, footerValues[cell.key], 1.6);
    }
    const surface = holes.map((hole)=>[
            x(hole),
            y(hole, 0)
        ]);
    g.poly(1, surface);
    for (const hole of holes){
        const center = x(hole), top = y(hole, 0), bottom = y(hole, hole.depth);
        const half = layout.boreholeWidth / 2;
        g.line(4, center, footerTop, center, top);
        g.rect(1, center - half, bottom, center + half, top);
        g.line(1, center - 5, top + 1.5, center + 5, top + 1.5);
        g.text(3, center, top + 6.2, hole.id, 2.1, true);
        g.text(3, center, top + 3.2, metres(hole.collarElevation), 1.5, true);
        g.text(3, center - 9, layout.plotBottom - 8, `${locale === 'zh-CN' ? '里程' : 'STA'} ${metres(hole.station)}`, 1.7);
        g.text(3, center - 9, layout.plotBottom - 13, `${locale === 'zh-CN' ? '孔深' : 'DEPTH'} ${metres(hole.depth)}`, 1.7);
        for (const layer of byId.get(hole.id).strata){
            const a = y(hole, layer.top), b = y(hole, layer.bottom);
            g.line(1, center - half - 1, b, center + half + 5, b);
            if (layer.patternVisibility !== 'boundary-only') g.hatch([
                [
                    center - half,
                    b
                ],
                [
                    center + half,
                    b
                ],
                [
                    center + half,
                    a
                ],
                [
                    center - half,
                    a
                ]
            ], layer);
            g.text(3, center + half + 1.5, b + 0.5, metres(layer.bottom), 1.35);
        }
        if (hole.stableWaterDepth != null) {
            const waterY = y(hole, hole.stableWaterDepth);
            g.line(1, center - 5, waterY, center + 5, waterY);
            g.poly(1, [
                [
                    center - 2,
                    waterY + 1.2
                ],
                [
                    center,
                    waterY - 1
                ],
                [
                    center + 2,
                    waterY + 1.2
                ]
            ]);
            g.text(3, center + 6, waterY - 0.7, `${locale === 'zh-CN' ? '水位' : 'WL'} ${metres(hole.stableWaterDepth)}`, 1.5);
        }
        for (const observation of hole.observations ?? []){
            const observationY = y(hole, observation.depth), markerX = center + half + 5;
            if (observation.kind === 'sample') {
                g.rect(1, markerX, observationY - 1.2, markerX + 2.2, observationY + 1.2);
                g.text(3, markerX + 3.2, observationY - 0.7, observation.displayLabel ?? observation.id, 1.5);
            } else {
                g.line(1, markerX, observationY, markerX + 2.5, observationY);
                const shown = Number.isInteger(observation.value) ? observation.value.toString() : metres(observation.value);
                g.text(3, markerX + 3.2, observationY - 0.7, observation.displayLabel ?? `N=${shown}`, 1.5);
            }
        }
    }
    const holeOrder = new Map(holes.map((hole, index)=>[
            hole.id,
            index
        ]));
    const manualKeys = new Set();
    const manualPairTopology = new Map();
    for (const connection of manualConnections){
        const left = byId.get(bounded(connection.fromHoleId, 'manual connection hole'));
        const right = byId.get(bounded(connection.toHoleId, 'manual connection hole'));
        if (!left || !right || x(left.hole) >= x(right.hole)) throw new KJValidationError('Geology: manual connection must follow declared station order');
        const leftIndex = holeOrder.get(left.hole.id), rightIndex = holeOrder.get(right.hole.id);
        if (rightIndex !== leftIndex + 1) throw new KJValidationError('Geology: manual connection must join adjacent station-ordered holes');
        const fromDepth = numeric(connection.fromDepth, 'manual connection from depth');
        const toDepth = numeric(connection.toDepth, 'manual connection to depth');
        if (fromDepth < 0 || fromDepth > left.hole.depth || toDepth < 0 || toDepth > right.hole.depth) throw new KJValidationError('Geology: manual connection depth is outside its borehole');
        const kind = connection.kind ?? 'manualBoundary';
        if (![
            'continuity',
            'pinchout',
            'lens',
            'manualBoundary'
        ].includes(kind)) throw new KJValidationError('Geology: invalid manual connection kind');
        const layerCode = connection.layerCode == null ? undefined : bounded(connection.layerCode, 'manual connection layer code');
        const key = `${left.hole.id}:${fromDepth}|${right.hole.id}:${toDepth}|${layerCode ?? ''}|${kind}`;
        if (manualKeys.has(key)) throw new KJValidationError('Geology: duplicate manual connection');
        manualKeys.add(key);
        const pairKey = `${left.hole.id}|${right.hole.id}`, pair = manualPairTopology.get(pairKey) ?? [];
        for (const prior of pair){
            const fromOrder = Math.sign(fromDepth - prior.fromDepth), toOrder = Math.sign(toDepth - prior.toDepth);
            if (fromOrder * toOrder < 0) throw new KJValidationError('Geology: manual connections cross or reverse stratigraphic order');
            const sharedOneSide = fromOrder === 0 !== (toOrder === 0);
            const sourceBackedTermination = [
                kind,
                prior.kind
            ].some((value)=>value === 'pinchout' || value === 'lens');
            if (sharedOneSide && !sourceBackedTermination) throw new KJValidationError('Geology: branching manual connections require an explicit pinchout or lens condition');
        }
        pair.push({
            fromDepth,
            toDepth,
            kind
        });
        manualPairTopology.set(pairKey, pair);
        g.semanticLine(1, x(left.hole), y(left.hole, fromDepth), x(right.hole), y(right.hole, toDepth), {
            semanticRole: 'source-manual-connection',
            connectionKind: kind,
            ...layerCode == null ? {} : {
                sourceLayerCode: layerCode
            }
        });
    }
    const unique = new Set();
    const pairTopology = new Map();
    for (const link of input.correlations){
        const left = byId.get(bounded(link.fromHoleId, 'correlation hole')), right = byId.get(bounded(link.toHoleId, 'correlation hole'));
        if (!left || !right || x(left.hole) >= x(right.hole)) throw new KJValidationError('Geology: correlation must follow declared station order');
        const leftIndex = holeOrder.get(left.hole.id), rightIndex = holeOrder.get(right.hole.id);
        if (rightIndex !== leftIndex + 1) throw new KJValidationError('Geology: correlation must join adjacent station-ordered holes');
        if (Boolean(link.fromIntervalId) === Boolean(link.fromStratumCode) || Boolean(link.toIntervalId) === Boolean(link.toStratumCode)) throw new KJValidationError('Geology: correlation must use exact interval ids or unambiguous layer codes');
        const candidatesA = left.strata.filter((layer)=>link.fromIntervalId ? layer.intervalId === link.fromIntervalId : layer.code === link.fromStratumCode);
        const candidatesB = right.strata.filter((layer)=>link.toIntervalId ? layer.intervalId === link.toIntervalId : layer.code === link.toStratumCode);
        if (candidatesA.length !== 1 || candidatesB.length !== 1) throw new KJValidationError('Geology: correlation must identify one unambiguous interval per hole');
        const a = candidatesA[0], b = candidatesB[0];
        if (a.lithology !== b.lithology) throw new KJValidationError('Geology: correlation needs declared compatible strata');
        const key = `${left.hole.id}:${a.intervalId ?? `${a.code}@${a.top}-${a.bottom}`}|${right.hole.id}:${b.intervalId ?? `${b.code}@${b.top}-${b.bottom}`}`;
        if (unique.has(key)) throw new KJValidationError('Geology: duplicate correlation');
        unique.add(key);
        const pairKey = `${left.hole.id}|${right.hole.id}`, topology = pairTopology.get(pairKey) ?? [];
        for (const prior of topology){
            if (prior.source === a || prior.target === b) throw new KJValidationError('Geology: one interval cannot branch into multiple correlations between a hole pair');
            if (Math.sign(a.top - prior.source.top) !== Math.sign(b.top - prior.target.top)) throw new KJValidationError('Geology: correlations cross or reverse stratigraphic order');
        }
        topology.push({
            source: a,
            target: b
        });
        pairTopology.set(pairKey, topology);
        const xl = x(left.hole), xr = x(right.hole);
        const topL = y(left.hole, a.top), topR = y(right.hole, b.top), bottomL = y(left.hole, a.bottom), bottomR = y(right.hole, b.bottom);
        g.hatch([
            [
                xl,
                bottomL
            ],
            [
                xr,
                bottomR
            ],
            [
                xr,
                topR
            ],
            [
                xl,
                topL
            ]
        ], a);
        g.line(1, xl, bottomL, xr, bottomR);
        g.line(1, xl, topL, xr, topR);
        g.text(3, (xl + xr) / 2, (topL + topR + bottomL + bottomR) / 4, a.code, 1.8, true);
    }
    if (topology) {
        const topologyPoint = (point)=>[
                originX + (point.station - holes[0].station) * hs,
                layout.plotBottom + (point.elevation - datum) * vs
            ];
        for (const cell of [
            ...topology.mainCells,
            ...topology.lensCells
        ])g.hatch(cell.points.map(topologyPoint), cell.source);
        for (const boundary of topology.mainBoundaries){
            const [start, end] = boundary.points.map(topologyPoint);
            g.semanticLine(1, start[0], start[1], end[0], end[1], {
                semanticRole: 'source-group-boundary',
                topologyIdentity: boundary.identity,
                topologyMode: boundary.mode
            });
        }
    }
    g.text(3, layout.innerMargin + 2, footerTop + 2.2, locale === 'zh-CN' ? topology ? '仅显示源数据声明的地层组拓扑；未证实区域按设计留空。' : '仅显示已提供的地层与对比关系；未对比区域按设计留空。' : topology ? 'Only source-declared group topology is shown. Unproven regions remain blank.' : 'Only supplied strata/correlations are shown. Uncorrelated regions are intentionally blank.', 1.5);
    return g.finish({
        horizontalScaleDenominator: input.horizontalScaleDenominator,
        verticalScaleDenominator: input.verticalScaleDenominator,
        datumElevation: datum,
        styleRule: 'geology-section-layout',
        ...topology ? {
            correlationMode,
            topologyMainCellCount: topology.mainCells.length,
            topologyLensCellCount: topology.lensCells.length,
            topologyMainBoundaryCount: topology.mainBoundaries.length
        } : {}
    });
}
