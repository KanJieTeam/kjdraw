// Generated from geology-engineering.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
import { stableHash, deepFreeze } from './utils.js';
import { validateKnowledgePack } from './knowledge-pack.js';
import { hatchPatternFromKnowledgePack } from './hatch-pattern-catalog.js';
import { layoutCadMText } from './geometry/text-layout.js';
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from './knowledge-packs/geology-core.js';
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
    'description',
    'sample',
    'spt'
];
const defaultColumnVerticalScales = Object.freeze([
    50,
    100,
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
            'textFlow',
            'verticalScaleDenominators'
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
        if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || Object.keys(supplied).join(',') !== 'rows') throw new KJValidationError('Geology: header grid must declare rows only');
        const rows = supplied.rows;
        if (!Array.isArray(rows) || rows.length < 2 || rows.length > 4 || headerRowHeight * rows.length + fieldHeaderHeight + 10 > headerDepth) throw new KJValidationError('Geology: header grid rows do not fit the declared sheet');
        const seen = new Set(), documentKeys = new Set();
        headerGrid = {
            rows: rows.map((row, rowIndex)=>{
                if (!Array.isArray(row) || row.length < 1 || row.length > 4 || (right - left) / row.length < 45) throw new KJValidationError(`Geology: header grid row ${rowIndex + 1} is unreadable`);
                return row.map((raw, cellIndex)=>{
                    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError(`Geology: header grid cell ${rowIndex + 1}/${cellIndex + 1} needs a role and label`);
                    const cell = raw;
                    const optional = cell.optional == null ? undefined : cell.optional;
                    if (optional != null && typeof optional !== 'boolean') throw new KJValidationError('Geology: header fact optional flag must be boolean');
                    if (cell.role === 'documentFact') {
                        if (![
                            'key,label,role',
                            'key,label,optional,role'
                        ].includes(Object.keys(cell).sort().join(','))) throw new KJValidationError(`Geology: header grid cell ${rowIndex + 1}/${cellIndex + 1} needs a document fact key, role and label`);
                        const key = stableDocumentFactKey(cell.key), canonical = key.toLowerCase();
                        if (documentKeys.has(canonical)) throw new KJValidationError('Geology: duplicate document fact key');
                        documentKeys.add(canonical);
                        return {
                            role: 'documentFact',
                            key,
                            label: bounded(cell.label, 'header fact label', 24),
                            ...optional == null ? {} : {
                                optional
                            }
                        };
                    }
                    if (![
                        'label,role',
                        'label,optional,role'
                    ].includes(Object.keys(cell).sort().join(',')) || typeof cell.role !== 'string' || !headerRoles.has(cell.role)) throw new KJValidationError('Geology: undeclared header fact role');
                    const role = cell.role;
                    if (seen.has(role)) throw new KJValidationError('Geology: duplicate header fact role');
                    seen.add(role);
                    return {
                        role,
                        label: bounded(cell.label, 'header fact label', 24),
                        ...optional == null ? {} : {
                            optional
                        }
                    };
                });
            })
        };
    }
    let fieldGrid;
    if (isFieldGrid) {
        if (!Array.isArray(value.fieldGrid) || value.fieldGrid.length < 9 || value.fieldGrid.length > 24) throw new KJValidationError('Geology: field grid needs 9–24 declared physical columns');
        const roles = new Set(), measurementKeys = new Set();
        fieldGrid = value.fieldGrid.map((raw, index)=>{
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: field grid column must be a declared object');
            const cell = raw;
            const role = cell.role;
            const optionalSubLabel = cell.subLabel == null ? '' : ',subLabel';
            const schema = role === 'measurement' ? cell.decimals == null ? `key,label,role,start${optionalSubLabel}` : `decimals,key,label,role,start${optionalSubLabel}` : `label,role,start${optionalSubLabel}`;
            if (!fieldRoles.has(role) || Object.keys(cell).sort().join(',') !== schema) throw new KJValidationError('Geology: field grid column needs an exact role schema');
            const start = numeric(cell.start, `field grid start ${index + 1}`), label = bounded(cell.label, `field grid label ${index + 1}`, 32);
            const subLabel = cell.subLabel == null ? undefined : bounded(cell.subLabel, `field grid sublabel ${index + 1}`, 24);
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
                } : {}
            };
        });
        if (requiredFieldRoles.some((role)=>!roles.has(role)) || Math.abs(fieldGrid[0].start - left) > 1e-6) throw new KJValidationError('Geology: field grid misses a core role or left margin');
        for (const [index, field] of fieldGrid.entries()){
            const width = (fieldGrid[index + 1]?.start ?? right) - field.start;
            const minimum = field.role === 'description' ? 35 : field.role === 'layerName' ? 15 : field.role === 'measurement' ? 7.5 : [
                'spt',
                'sample',
                'pattern'
            ].includes(field.role) ? 12 : 10;
            if (width < minimum || field.start < left || field.start >= right) throw new KJValidationError(`Geology: field ${field.role} is out of bounds or unreadable`);
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
            if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'key,label,start') throw new KJValidationError('Geology: footer cell needs an exact key, label and start');
            const cell = raw, start = numeric(cell.start, `footer cell start ${index + 1}`);
            const key = stableDocumentFactKey(cell.key, 'footer fact key'), label = bounded(cell.label, 'footer fact label', 16);
            if (keys.has(key.toLowerCase())) throw new KJValidationError('Geology: duplicate footer fact key');
            keys.add(key.toLowerCase());
            return {
                start,
                key,
                label
            };
        });
        for (const [index, cell] of parsed.entries()){
            const end = parsed[index + 1]?.start ?? right;
            if (cell.start < left || end - cell.start < 20 || index && cell.start <= parsed[index - 1].start) throw new KJValidationError('Geology: footer cell is out of bounds or unreadable');
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
        } : {}
    };
}
function sectionLayout() {
    const raw = KJDRAW_GEOLOGY_KNOWLEDGE_PACK.rules?.['geology-section-layout'];
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
    if (scalars.paperWidth !== 420 || scalars.paperHeight !== 297 || scalars.outerMargin < 3 || scalars.innerMargin <= scalars.outerMargin || scalars.plotLeft <= scalars.innerMargin || scalars.plotRight >= scalars.paperWidth - scalars.innerMargin || scalars.plotRight - scalars.plotLeft < 250 || scalars.plotBottom < scalars.innerMargin + scalars.footerHeight + 8 || scalars.plotTop <= scalars.plotBottom + 120 || scalars.titleY <= scalars.plotTop || scalars.scaleY <= scalars.plotTop || scalars.scaleY >= scalars.titleY || scalars.boreholeWidth < 2 || scalars.boreholeWidth > 8 || scalars.elevationTickStep < 0.5 || scalars.elevationTickStep > 20) throw new KJValidationError('Geology: section layout geometry is unreadable');
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
                if (prior && (prior.code !== layer.code || prior.name !== layer.name || prior.lithology !== layer.lithology || prior.patternKey !== layer.patternKey)) throw new KJValidationError('Geology: repeated principal intervals disagree on the major group identity');
                principals.set(groupId, layer);
            }
        } else if (layer.groupId != null || layer.groupRole != null) throw new KJValidationError('Geology: incomplete source group hierarchy');
        if (layer.intervalId != null) {
            const id = bounded(layer.intervalId, 'interval id', 64);
            if (intervalIds.has(id)) throw new KJValidationError(`Geology: repeated interval id ${id}`);
            intervalIds.add(id);
        }
        bounded(layer.name, 'stratum name');
        if (layer.description != null) bounded(layer.description, 'stratum description', 96);
        if (layer.descriptionSource != null && (!layer.description || ![
            'interval',
            'layer-definition'
        ].includes(layer.descriptionSource))) throw new KJValidationError('Geology: description source requires exact interval or layer-definition provenance');
        const top = numeric(layer.top, 'stratum top'), bottom = numeric(layer.bottom, 'stratum bottom');
        if (Math.abs(top - previous) > 1e-6 || bottom <= top || bottom > hole.depth + 1e-6) throw new KJValidationError(`Geology: gap, overlap or invalid depth at ${code}`);
        if (!Object.hasOwn(pattern, layer.lithology)) throw new KJValidationError(`Geology: undeclared lithology at ${code}`);
        if (layer.patternKey != null) bounded(layer.patternKey, 'pattern key', 96);
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
function drawingBuilder(input, templateId, expectedRevision, hatches = {}) {
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
    const text = (layer, x, y, value, height = 2.6, centered = false)=>add('TEXT', layer, {
            position: [
                x,
                y,
                0
            ],
            text: value,
            height,
            ...centered ? {
                horizontalAlignment: 1,
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
            attachmentPoint: 1
        });
    const poly = (layer, points, closed = false)=>add('LWPOLYLINE', layer, {
            vertices: points.map(([x, y])=>[
                    x,
                    y,
                    0
                ]),
            closed
        });
    const rect = (layer, x1, y1, x2, y2)=>poly(layer, [
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
        ], true);
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
                    layers
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
        text,
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
    const { paperHeight: pageHeight, paperWidth: pageWidth, left, right, columns, observationColumns, headerDepth, headerRowHeight, fieldHeaderHeight, footerReserve, labels, displayAliases, headerGrid, footerGrid, fieldGrid, sptDisplayCap, titleHeight, textFlow, layerNumberStyle } = layout;
    const documentFacts = documentFactRecord(input.documentFacts);
    const declaredDocumentFactKeys = new Set([
        ...headerGrid?.rows.flat().filter((cell)=>cell.role === 'documentFact').map((cell)=>cell.key) ?? [],
        ...footerGrid?.cells.map((cell)=>cell.key) ?? []
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
    const scale = 1000 / verticalScaleDenominator;
    const bottom = top - hole.depth * scale;
    if (scale < 0.1 || scale > 100 || bottom < footerReserve) throw new KJValidationError('Geology: column does not fit the declared physical sheet at this vertical scale');
    const g = drawingBuilder(input, 'borehole-column-engineering', input.expectedRevision, patternDefinitions(input.hatchPack, strata));
    const finishColumn = ()=>g.finish({
            verticalScaleDenominator,
            verticalScaleSource: input.verticalScaleDenominator == null ? 'style-standard' : 'explicit'
        });
    const observations = hole.observations ?? [];
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
    const frameTop = formalFrame ? pageHeight - 15 : pageHeight - 5;
    g.rect(0, formalFrame ? left : 5, 5, formalFrame ? right : pageWidth - 5, frameTop);
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
            stableWaterDepth: hole.stableWaterDepth == null ? undefined : metres(hole.stableWaterDepth),
            verticalScale: `1:${scaleDenominator(verticalScaleDenominator)}`
        };
        const headerBottom = pageHeight - headerDepth;
        const rowHeight = headerRowHeight;
        const headerTop = headerBottom + rowHeight * headerGrid.rows.length;
        const titleY = headerTop + (frameTop - headerTop - (titleHeight ?? 5)) / 2;
        g.text(3, pageWidth / 2, titleY, bounded(input.title ?? (locale === 'zh-CN' ? '钻孔柱状图' : 'BOREHOLE LOG'), 'title'), titleHeight ?? 5, true);
        g.rect(0, left, headerBottom, right, headerTop);
        for (const [rowIndex, row] of headerGrid.rows.entries()){
            const rowTop = headerTop - rowIndex * rowHeight, rowBottom = rowTop - rowHeight;
            if (rowIndex) g.line(0, left, rowTop, right, rowTop);
            const width = (right - left) / row.length;
            for (const [cellIndex, cell] of row.entries()){
                const cellLeft = left + cellIndex * width, valueX = cellLeft + Math.min(25, width * 0.35);
                if (cellIndex) g.line(0, cellLeft, rowBottom, cellLeft, rowTop);
                g.line(0, valueX, rowBottom, valueX, rowTop);
                const identity = cell.role === 'documentFact' ? cell.key : cell.role;
                const value = cell.role === 'documentFact' ? documentFacts[cell.key] : facts[cell.role];
                if (value == null && !cell.optional) throw new KJValidationError(`Geology: declared header fact ${identity} is missing; refusing to invent a value`);
                const visibleValue = value ?? '';
                const estimated = (text)=>[
                        ...text
                    ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/u.test(character) ? 1.15 : 2.1), 0);
                if (estimated(cell.label) > valueX - cellLeft - 3 || estimated(visibleValue) > cellLeft + width - valueX - 3) throw new KJValidationError(`Geology: header fact ${identity} does not fit the declared cell`);
                g.text(3, cellLeft + 2, rowTop - rowHeight * 0.69, cell.label, 2.2);
                if (visibleValue) g.text(3, valueX + 2, rowTop - rowHeight * 0.69, visibleValue, 2.2);
            }
        }
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
        const bottom = 5, top = bottom + footerGrid.height;
        g.rect(0, left, bottom, right, top);
        for (const [index, cell] of footerGrid.cells.entries()){
            const end = footerGrid.cells[index + 1]?.start ?? right;
            if (index) g.line(0, cell.start, bottom, cell.start, top);
            const width = end - cell.start;
            const labelHeight = width < 25 ? 1.4 : 1.55;
            g.text(3, cell.start + width / 2, top - labelHeight - 1, cell.label, labelHeight, true);
            const value = documentFacts[cell.key];
            if (value) {
                const valueHeight = width < 25 ? 1.3 : 1.45;
                const estimated = [
                    ...value
                ].reduce((sum, character)=>sum + (/^[\x20-\x7e]$/u.test(character) ? valueHeight * 0.64 : valueHeight), 0);
                if (estimated > width - 2) throw new KJValidationError(`Geology: footer fact ${cell.key} does not fit its declared cell`);
                g.text(3, cell.start + width / 2, bottom + 1.2, value, valueHeight, true);
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
        const textBoxes = [];
        const emitFieldText = (item, y, value, height = 1.8)=>{
            const width = estimatedWidth(value, height);
            if (width > fieldWidth(item) - 2.4) throw new KJValidationError(`Geology: ${item.role} text does not fit its declared field`);
            const centered = item.role !== 'description';
            const x = centered ? item.start + fieldWidth(item) / 2 : item.start + 1.2;
            g.text(3, x, y, value, height, centered);
            textBoxes.push({
                role: item.role,
                left: x - (centered ? width / 2 : 0) - 0.25,
                right: x + (centered ? width / 2 : width) + 0.25,
                bottom: y - 0.25,
                top: y + height + 0.25
            });
        };
        const emitLayerNumber = (item, y, value, bandHeight)=>{
            if (layerNumberStyle !== 'circle') return emitFieldText(item, y, value, Math.min(2.1, Math.max(1.4, bandHeight * 0.38)));
            const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.indexOf(value);
            const visible = circled >= 0 ? String(circled + 1) : /^\d{1,2}$/u.test(value) ? value : undefined;
            if (!visible) return emitFieldText(item, y, value, Math.min(2.1, Math.max(1.4, bandHeight * 0.38)));
            const radius = Math.min(1.9, fieldWidth(item) / 2 - 1, bandHeight / 2 - 0.5);
            if (radius < 1) throw new KJValidationError('Geology: circled layer number does not fit its declared band');
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
        };
        let previousDescriptionBottom, previousLabelY, renderedCoreCount = 0;
        const firstGroupBottom = grouped ? groups[0].bottom : strata[0].bottom;
        const nextGroupBottom = grouped ? groups[1]?.bottom : strata[1]?.bottom;
        const writeGridDescription = (description, yTop, yBottom, coreIndex, identity)=>{
            if (!textFlow) return writeDescription(description, yTop, yTop - yBottom, identity);
            const width = descriptionRight - descriptionX - 4;
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
                    previousDescriptionBottom = anchorY - occupied;
                    return;
                }
            }
            throw new KJValidationError(`Geology: ${identity} description collides with another text lane or exceeds source-declared borrow`);
        };
        const formBottom = footerReserve;
        g.rect(0, left, formBottom, right, pageHeight - headerDepth);
        for (const item of fieldGrid){
            if (item.start !== left) g.line(0, item.start, formBottom, item.start, pageHeight - headerDepth);
            const centerX = item.start + fieldWidth(item) / 2;
            if (item.subLabel) {
                const subLabel = item.subLabel.replaceAll('{verticalScale}', scaleDenominator(verticalScaleDenominator));
                g.text(3, centerX, pageHeight - headerDepth - fieldHeaderHeight * 0.42, item.label, 1.8, true);
                g.text(3, centerX, pageHeight - headerDepth - fieldHeaderHeight * 0.78, subLabel, 1.6, true);
            } else g.text(3, centerX, pageHeight - headerDepth - fieldHeaderHeight * 0.62, item.label, 1.8, true);
        }
        g.line(0, left, top, right, top);
        const patternField = field('pattern'), depthField = field('depth');
        const writeCore = (id, groupTop, groupBottom, principal)=>{
            const yTop = top - groupTop * scale, yBottom = top - groupBottom * scale;
            const coreIndex = renderedCoreCount++;
            const mid = (yTop + yBottom) / 2;
            let labelY = yTop - Math.max(1.8, (yTop - yBottom) / 2);
            let labelHeight = 2.1;
            if (textFlow && coreIndex < 2) {
                labelHeight = textFlow.labelHeightMm;
                labelY = Math.min(yTop - textFlow.firstBaselineMm, previousLabelY == null ? yTop - textFlow.firstBaselineMm : previousLabelY - textFlow.labelPitchMm);
            }
            const lowest = textFlow && coreIndex === 0 ? Math.max(yBottom - textFlow.firstGroupBorrowMm, nextGroupBottom == null ? yBottom : top - nextGroupBottom * scale + 0.4) : yBottom + 0.4;
            if (labelY < lowest || labelY + labelHeight > yTop - 0.2 || previousLabelY != null && previousLabelY - labelY < labelHeight + 0.5) throw new KJValidationError(`Geology: group ${id} core labels collide with a boundary or another text lane`);
            previousLabelY = labelY;
            const values = {
                layerNumber: displayAliases?.codes[principal.code] ?? id,
                layerName: displayAliases?.names[principal.name] ?? principal.name,
                baseElevation: metres(hole.collarElevation - groupBottom),
                thickness: metres(groupBottom - groupTop)
            };
            const valueY = textFlow && coreIndex < 2 ? labelY : yTop - yBottom < 2 ? labelY : mid;
            const numberBandHeight = textFlow && coreIndex === 0 ? Math.max(yTop - yBottom, textFlow.firstBaselineMm + textFlow.labelHeightMm + 1) : yTop - yBottom;
            emitLayerNumber(field('layerNumber'), valueY, values.layerNumber, numberBandHeight);
            for (const role of [
                'layerName',
                'baseElevation',
                'thickness'
            ])emitFieldText(field(role), valueY, values[role], labelHeight);
            if (principal.description && (grouped || principal.descriptionSource !== 'layer-definition' || definitionAnchors.get(`${principal.code}\u0000${principal.description}`) === principal)) writeGridDescription(principal.description, yTop, yBottom, coreIndex, `major group ${id}`);
        };
        for (const layer of strata){
            const yTop = top - layer.top * scale, yBottom = top - layer.bottom * scale;
            if (yTop - yBottom < (grouped ? 0.4 : 1.4)) throw new KJValidationError(`Geology: layer ${layer.code} is too thin for readable geometry at this scale`);
            const major = !grouped || groups.some((group)=>Math.abs(group.bottom - layer.bottom) < 1e-6);
            if (major && !(textFlow?.firstGroupUnruled && Math.abs(layer.bottom - firstGroupBottom) < 1e-6)) bandLines.push({
                x1: left,
                x2: right,
                y: yBottom
            });
            else if (major) for (const role of [
                'depth',
                'pattern'
            ]){
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
                const item = field(role);
                bandLines.push({
                    x1: item.start,
                    x2: gridEnd(item),
                    y: yBottom
                });
            }
            g.hatch([
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
            ], layer);
            const depthY = depthLabelY.get(layer) ?? yBottom + 0.4;
            if (Math.abs(depthY - (yBottom + 0.4)) > 0.6) g.line(1, gridEnd(depthField) - 5, yBottom, gridEnd(depthField) - 1, depthY);
            emitFieldText(depthField, depthY, metres(layer.bottom), grouped ? 1.5 : Math.min(2.1, (yTop - yBottom) * 0.55));
            if (!grouped) writeCore(layer.code, layer.top, layer.bottom, layer);
        }
        if (grouped) for (const group of groups)writeCore(group.id, group.top, group.bottom, group.principal);
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
                if (value != null) emitFieldText(cell, y, value, 1.5);
                if (cell.role === 'sample' && item.kind === 'sample' && item.rangeTop != null && item.rangeBottom != null) {
                    const rangeTopY = top - item.rangeTop * scale, rangeBottomY = top - item.rangeBottom * scale;
                    const rangeTextY = rangeBottomY - 2.2, rangeText = `${metres(item.rangeTop)}–${metres(item.rangeBottom)}`;
                    if (rangeTextY < bottom + 0.4 || textBoxes.some((box)=>box.role === 'sample' && rangeTextY - 0.25 <= box.top && rangeTextY + 1.75 >= box.bottom)) throw new KJValidationError(`Geology: sampled range ${item.id} cannot be labelled without colliding in its source lane`);
                    emitFieldText(cell, rangeTextY, rangeText, 1.5);
                    bandLines.push({
                        x1: cell.start,
                        x2: gridEnd(cell),
                        y: rangeTopY
                    }, {
                        x1: cell.start,
                        x2: gridEnd(cell),
                        y: rangeBottomY
                    });
                }
            }
        }
        for (const line of bandLines){
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
        g.hatch([
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
    const layout = sectionLayout();
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
            g.hatch([
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
    if (!Array.isArray(input.correlations) || input.correlations.length > 200) throw new KJValidationError('Geology: invalid correlation list');
    const unique = new Set();
    const holeOrder = new Map(holes.map((hole, index)=>[
            hole.id,
            index
        ]));
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
    g.text(3, layout.innerMargin + 2, footerTop + 2.2, locale === 'zh-CN' ? '仅显示已提供的地层与对比关系；未对比区域按设计留空。' : 'Only supplied strata/correlations are shown. Uncorrelated regions are intentionally blank.', 1.5);
    return g.finish({
        horizontalScaleDenominator: input.horizontalScaleDenominator,
        verticalScaleDenominator: input.verticalScaleDenominator,
        datumElevation: datum,
        styleRule: 'geology-section-layout'
    });
}
