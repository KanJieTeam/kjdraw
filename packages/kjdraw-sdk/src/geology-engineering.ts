import { KJValidationError } from './errors.js'
import { stableHash, deepFreeze, type ReadonlyDeep } from './utils.js'
import type { KJKnowledgeCompileResult } from './knowledge-compiler.js'
import { validateKnowledgePack, type KJKnowledgePack } from './knowledge-pack.js'
import { hatchPatternFromKnowledgePack } from './hatch-pattern-catalog.js'
import { layoutCadMText } from './geometry/text-layout.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from './knowledge-packs/geology-core.js'

/** Engineering facts, not CAD coordinates. Depths/stations/elevations are metres. */
export interface KJGeologyStratum {
  /** Exact interval identity when one layer code appears more than once in a hole. */
  intervalId?: string
  /** Explicit source-backed continuous major group; never inferred from lithology or band thickness. */
  groupId?: string
  /** Principal strata define the major group label; lenses keep exact sublayer geometry. */
  groupRole?: 'principal' | 'lens'
  code: string
  name: string
  /** Source-backed geologic notation displayed with the stratum name; qualifiers are never inferred. */
  stratigraphicNotation?: { symbol: string; subscript?: string; superscript?: string }
  top: number
  bottom: number
  lithology: 'fill' | 'cultivated-soil' | 'clay' | 'silty-clay' | 'silt' | 'sand' | 'gravel' | 'rock' | 'weathered-rock' | 'loess' | 'loess-collapsible' | 'loess-like' | 'paleosol' | 'calcareous-nodule'
  /** Semantic pattern role in a licensed pack, e.g. fine-sand versus medium-sand. */
  patternKey?: string
  /** Source-backed display fact: omit or filled draws the hatch; boundary-only preserves the interval without inventing fill. */
  patternVisibility?: 'filled' | 'boundary-only'
  /** Exact source-visible label printed inside this interval's pattern lane. */
  patternLabel?: string
  /** Exact source visibility of this interval's bottom rule in independently
   * rendered depth/pattern fields. Depth facts and closed fill boundaries remain. */
  bottomBoundaryLineVisibility?: { depth: 'visible' | 'hidden'; pattern: 'visible' | 'hidden' }
  description?: string
  /** Interval text is never merged; a project layer definition may repeat through lenses. */
  descriptionSource?: 'interval' | 'layer-definition'
}
export interface KJGeologyBorehole {
  id: string
  collarElevation: number
  depth: number
  x?: number
  y?: number
  startDate?: string
  endDate?: string
  /** Measured groundwater depth first observed while drilling; distinct from the later stable level. */
  initialWaterDepth?: number
  /** Measured stable groundwater depth; never inferred from another hole. */
  stableWaterDepth?: number
  /** Independent down-hole groundwater readings. These are never copied from summary header values. */
  groundwaterObservations?: KJGeologyGroundwaterObservation[]
  station?: number
  strata: KJGeologyStratum[]
  observations?: KJGeologyObservation[]
}
export interface KJGeologyGroundwaterObservation {
  /** Measured depth below the collar in metres. */
  depth: number
  /** Independently supplied absolute groundwater elevation in metres. */
  elevation: number
  /** Source-recorded observation date or timestamp. */
  observedOn: string
  /** Source-recorded water-level symbol. */
  marker: 'filled-down-triangle'
}
export interface KJGeologyObservation {
  kind: 'sample' | 'spt'
  id: string
  depth: number
  value?: number
  /** Short visible text; id remains the exact stable observation identity. */
  displayLabel?: string
  /** Source-recorded specimen marker; its visible glyph and spacing remain a versioned layout choice. */
  sampleMarker?: 'filled-circle' | 'open-circle'
  /** Direct numeric laboratory facts keyed by a host-selected, versioned field grid. */
  measurements?: Record<string, number>
  /** Exact source-supplied interval for a sampled specimen; never inferred from the point depth. */
  rangeTop?: number
  rangeBottom?: number
}

/** Source-backed rendering facts for measured sample intervals. The default
 * remains two collision-safe endpoint rules; a style pack may request the
 * exact continuous boundary line present in its licensed source template. */
export interface KJGeologySampleRangeBaselineStyle {
  boundaries: ('top' | 'bottom')[]
  continuity: 'collision-safe' | 'continuous'
  insetMm: number
}
/** Source-backed layout for a measured groundwater annotation. The optional
 * guide is emitted only when a licensed source template declares it. */
export interface KJGeologyGroundwaterAnnotationStyle {
  fieldRole: 'pattern'
  textHeight: number
  markerHeight: number
  textWidthFactor: number
  gap: number
  valueOffset: number
  markerOffset: number
  dateOffset: number
  guide?: 'field-top-to-reading'
}
/** Optional source-backed linework attached to one title-margin fact. */
export interface KJGeologyTitleMarginDecoration {
  kind: 'top-edge-elbow-underline'
  elbowOffset: [number, number]
  horizontalEnd: 'frame-right'
}
/** A source-backed cross-hole boundary supplied by an external data adapter.
 *  Depths are measured downwards from each hole collar in metres.  This is
 *  deliberately a neutral input contract: adapters may read MDB/DWG facts,
 *  but the compiler never invents a connection when one is absent.
 */
export interface KJGeologySectionConnection {
  fromHoleId: string
  toHoleId: string
  fromDepth: number
  toDepth: number
  kind?: 'continuity' | 'pinchout' | 'lens' | 'manualBoundary'
  layerCode?: string
}
export interface KJGeologyColumnInput {
  /** Visible generated labels. When omitted, Chinese source text selects zh-CN; otherwise en. */
  locale?: 'zh-CN' | 'en'
  hole: KJGeologyBorehole
  projectName?: string
  /** Exact source-backed document facts requested by a host-selected style pack; never inferred. */
  documentFacts?: Record<string, string>
  /** Explicit source/template fact. Omit to select from the style pack's standard scales. */
  verticalScaleDenominator?: number
  /** Physical long-log sheet or ordinary A4 sheet, in millimetres. */
  pageHeightMillimeters?: 297 | 841
  /** Host-selected, versioned physical table geometry; independent of model text. */
  columnStylePack?: ReadonlyDeep<KJKnowledgePack>
  /** Refuse a source-template mismatch or an unrenderable observation kind. This is a template gate, not 1:1 certification. */
  strictSourceTemplate?: boolean
  /** Optional licensed, versioned pattern knowledge; no purchased pattern is built into KJDraw. */
  hatchPack?: ReadonlyDeep<KJKnowledgePack>
  expectedRevision: number
  title?: string
}
export interface KJGeologySectionInput {
  /** Visible generated labels. When omitted, Chinese source text selects zh-CN; otherwise en. */
  locale?: 'zh-CN' | 'en'
  holes: KJGeologyBorehole[]
  /** Only explicitly correlated layers are drawn between holes. */
  correlations: { fromHoleId: string; toHoleId: string; fromStratumCode?: string; toStratumCode?: string; fromIntervalId?: string; toIntervalId?: string }[]
  /** Explicit source-backed boundaries are rendered before inferred correlations. */
  manualConnections?: KJGeologySectionConnection[]
  horizontalScaleDenominator: number
  verticalScaleDenominator: number
  datumElevation: number
  surfaceRule: 'straight-between-supplied-collars'
  projectName?: string
  /** Exact source-backed title-block facts; absent facts remain blank. */
  documentFacts?: Record<string, string>
  /** Host-selected, versioned physical sheet geometry. Project-specific values stay in the pack. */
  sectionStylePack?: ReadonlyDeep<KJKnowledgePack>
  hatchPack?: ReadonlyDeep<KJKnowledgePack>
  expectedRevision: number
  title?: string
}

interface SectionLayout {
  paperWidth: number
  paperHeight: number
  outerMargin: number
  innerMargin: number
  plotLeft: number
  plotRight: number
  plotBottom: number
  plotTop: number
  titleY: number
  scaleY: number
  footerHeight: number
  boreholeWidth: number
  elevationTickStep: number
  footerGrid: FooterCell[]
}

const pattern: Record<KJGeologyStratum['lithology'], string> = {
  fill: 'CROSS', 'cultivated-soil': 'ANSI37', clay: 'ANSI31', 'silty-clay': 'ANSI37', silt: 'ANSI31', sand: 'ANSI37', gravel: 'CROSS',
  rock: 'ANSI31', 'weathered-rock': 'CROSS', loess: 'ANSI37', 'loess-collapsible': 'CROSS', 'loess-like': 'ANSI31', paleosol: 'CROSS', 'calcareous-nodule': 'ANSI37',
}
const bounded = (value: unknown, label: string, max = 64): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new KJValidationError(`Geology: invalid ${label}`)
  return value.trim()
}
const numeric = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e6) throw new KJValidationError(`Geology: invalid ${label}`)
  return value
}
const positive = (value: unknown, label: string): number => {
  const result = numeric(value, label)
  if (result <= 0) throw new KJValidationError(`Geology: ${label} must be positive`)
  return result
}
const projectCoordinate = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) throw new KJValidationError(`Geology: invalid ${label}`)
  return value
}
const metres = (value: number): string => value.toFixed(2)
const scaleDenominator = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '')

interface ColumnLayout {
  paperWidth: number
  paperHeight: number
  left: number
  right: number
  columns: [number, number, number, number, number] | [number, number, number, number, number, number]
  observationColumns?: [number, number]
  headerDepth: number
  headerRowHeight: number
  fieldHeaderHeight: number
  footerReserve: number
  sptDisplayCap?: number
  titleHeight?: number
  labels: Record<string, string>
  displayAliases?: { codes: Record<string, string>; names: Record<string, string> }
  headerGrid?: { rows: HeaderCell[][]; continuousDividers?: number[] }
  footerGrid?: { height: number; cells: FooterCell[] }
  fieldGrid?: { start: number; role: FieldRole; label: string; subLabel?: string; key?: string; decimals?: number; textWidthFactor?: number }[]
  legendMode?: 'footer' | 'none'
  layerNumberStyle: 'plain' | 'circle'
  textFlow?: { firstGroupBorrowMm: number; firstGroupUnruled: boolean; firstBaselineMm: number; labelPitchMm: number; labelHeightMm: number; paragraphGapMm: number }
  textHeights?: { headerFact: number; fieldHeader: number; fieldSubHeader: number; majorValue: number; intervalDepth: number; observation: number }
  stratigraphicNotationStyle?: { symbolHeight: number; qualifierHeight: number }
  sampleMarkerStyle?: { height: number; gap: number; baselineOffset: number }
  sampleRangeBaselineStyle?: KJGeologySampleRangeBaselineStyle
  groundwaterAnnotationStyle?: KJGeologyGroundwaterAnnotationStyle
  patternLabelStyle?: { height: number; textWidthFactor: number; minimumBandHeight: number }
  titleMarginFacts?: TitleMarginFactPlacement[]
  frameStyle?: { topMargin: number; bottomMargin: number; constantWidth: number }
  descriptionBoundaryStyle?: { inset: number; clearance: number }
  formTopology?: { containers: 'outer-frame-separators'; headerDividers: 'merge-adjacent-collinear'; patternCells: 'closed-outline' }
  verticalScaleDenominators: number[]
  sourceTemplate?: { sourceId: string; sourceSha256: string; verticalScaleDenominator: number; innerGridWidthMillimeters: number; fieldRoles: string[]; footerLabels: string[]; gridLineHandles: string[] }
}

type HeaderRole = 'projectName' | 'holeId' | 'collarElevation' | 'depth' | 'x' | 'y' | 'startDate' | 'endDate' | 'initialWaterDepth' | 'stableWaterDepth' | 'verticalScale'
type HeaderCellGeometry = { start?: number; valueStart?: number }
type HeaderCell = ({ role: HeaderRole; label: string; optional?: boolean } | { role: 'documentFact'; key: string; label: string; optional?: boolean }) & HeaderCellGeometry
type FooterCell = { start: number; key: string; label: string; internalDivider?: number }
type TitleMarginFactPlacement = {
  key: string
  label: string
  separator: string
  edge: 'top'
  anchor: 'left' | 'center' | 'right'
  offset: [number, number]
  height: number
  textWidthFactor: number
  horizontalAlignment: 'left' | 'center' | 'right'
  verticalAlignment: 'baseline' | 'middle'
  rotationDegrees: number
  decoration?: KJGeologyTitleMarginDecoration
}
const headerRoles = new Set<HeaderRole>(['projectName', 'holeId', 'collarElevation', 'depth', 'x', 'y', 'startDate', 'endDate', 'initialWaterDepth', 'stableWaterDepth', 'verticalScale'])
const stableDocumentFactKey = (value: unknown, label = 'document fact key'): string => {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,31}$/u.test(value) || ['constructor', 'prototype'].includes(value.toLowerCase())) throw new KJValidationError(`Geology: invalid ${label}`)
  return value
}
const documentFactRecord = (value: unknown): Record<string, string> => {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new KJValidationError('Geology: document facts must be a plain record')
  const result: Record<string, string> = Object.create(null), seen = new Set<string>()
  const keys = Reflect.ownKeys(value)
  if (keys.length > 8) throw new KJValidationError('Geology: document facts allow at most 8 entries')
  for (const rawKey of keys) {
    if (typeof rawKey !== 'string') throw new KJValidationError('Geology: invalid document fact key')
    const descriptor = Object.getOwnPropertyDescriptor(value, rawKey)
    if (!descriptor || !('value' in descriptor)) throw new KJValidationError('Geology: document fact accessors are not accepted')
    const key = stableDocumentFactKey(rawKey), canonical = key.toLowerCase()
    if (seen.has(canonical)) throw new KJValidationError('Geology: duplicate document fact key')
    seen.add(canonical)
    result[key] = bounded(descriptor.value, `document fact ${key}`, 96)
  }
  return result
}
type FieldRole = 'layerNumber' | 'layerName' | 'baseElevation' | 'thickness' | 'depth' | 'pattern' | 'description' | 'sample' | 'spt' | 'measurement'
const fieldRoles = new Set<FieldRole>(['layerNumber', 'layerName', 'baseElevation', 'thickness', 'depth', 'pattern', 'description', 'sample', 'spt', 'measurement'])
// Observation lanes are physical template choices, not universal geology columns.
// A source sheet may contain samples but no independent SPT lane (or neither).
const requiredFieldRoles: FieldRole[] = ['layerNumber', 'layerName', 'baseElevation', 'thickness', 'depth', 'pattern', 'description']
const defaultColumnVerticalScales = Object.freeze([50, 100, 150, 200, 250, 500, 1000, 2000, 5000])

const defaultColumnLabels: Record<string, string> = {
  hole: 'HOLE', collar: 'COLLAR', depth: 'DEPTH', verticalScale: 'VERTICAL SCALE', datum: 'DATUM: collar elevation',
  project: 'PROJECT', x: 'X', y: 'Y', startDate: 'START', endDate: 'END',
  depthColumn: 'DEPTH m', thicknessColumn: 'THICKNESS m', elevationColumn: 'ELEV. m', codeColumn: 'CODE', hatchColumn: 'LITHOLOGY',
  stratumColumn: 'STRATUM', descriptionColumn: 'DESCRIPTION', sampleColumn: 'SAMPLE', sptColumn: 'SPT N',
  legend: 'LITHOLOGY LEGEND', footer: 'Depth positive downward; elevations from supplied collar. Verify against drilling log.',
  fill: 'fill', 'cultivated-soil': 'cultivated soil', clay: 'clay', 'silty-clay': 'silty clay', silt: 'silt', sand: 'sand', gravel: 'gravel', rock: 'rock', 'weathered-rock': 'weathered rock',
  loess: 'loess', 'loess-collapsible': 'collapsible loess', 'loess-like': 'loess-like soil', paleosol: 'paleosol', 'calcareous-nodule': 'calcareous nodules',
}

const chineseColumnLabels: Record<string, string> = {
  hole: '钻孔编号', collar: '孔口标高', depth: '孔深', verticalScale: '垂直比例尺', datum: '基准：孔口标高',
  project: '工程名称', x: 'X坐标', y: 'Y坐标', startDate: '开孔日期', endDate: '终孔日期',
  depthColumn: '深度 m', thicknessColumn: '层厚 m', elevationColumn: '层底标高 m', codeColumn: '层号', hatchColumn: '岩土图例',
  stratumColumn: '岩土名称', descriptionColumn: '岩土描述', sampleColumn: '取样', sptColumn: '标贯 N',
  legend: '岩土图例', footer: '深度向下为正；标高按给定孔口标高计算。请与钻孔原始记录核对。',
  fill: '填土', 'cultivated-soil': '耕植土', clay: '黏性土', 'silty-clay': '粉质黏土', silt: '粉土', sand: '砂土', gravel: '碎石土', rock: '岩石', 'weathered-rock': '风化岩',
  loess: '黄土', 'loess-collapsible': '湿陷性黄土', 'loess-like': '黄土状土', paleosol: '古土壤', 'calcareous-nodule': '钙质结核层',
}

const hasChinese = (value: unknown): boolean => typeof value === 'string' && /[\u3400-\u9fff]/u.test(value)
function geologyLocale(input: KJGeologyColumnInput | KJGeologySectionInput): 'zh-CN' | 'en' {
  if (input.locale != null && input.locale !== 'zh-CN' && input.locale !== 'en') throw new KJValidationError('Geology: locale must be zh-CN or en')
  if (input.locale) return input.locale
  if (hasChinese(input.title)) return 'zh-CN'
  if ('projectName' in input && hasChinese(input.projectName)) return 'zh-CN'
  const holes = 'hole' in input ? [input.hole] : input.holes
  return holes.some(hole => hole.strata.some(layer => hasChinese(layer.name) || hasChinese(layer.description))) ? 'zh-CN' : 'en'
}

function columnLayout(input: KJGeologyColumnInput): ColumnLayout {
  if (!input.columnStylePack) {
    if (input.strictSourceTemplate) throw new KJValidationError('Geology: strict source template needs a source-backed style pack')
    if (geologyLocale(input) === 'zh-CN' && input.pageHeightMillimeters == null)
      return columnLayout({ ...input, columnStylePack: KJDRAW_GEOLOGY_KNOWLEDGE_PACK })
    const height = input.pageHeightMillimeters ?? 297
    if (height !== 297 && height !== 841) throw new KJValidationError('Geology: column page height must be 297 or 841 mm')
    return { paperWidth: 210, paperHeight: height, left: 15, right: 195, columns: [32, 51, 67, 92, 147],
      headerDepth: 56, headerRowHeight: 7, fieldHeaderHeight: 10, footerReserve: 57, layerNumberStyle: 'plain', labels: geologyLocale(input) === 'zh-CN' ? chineseColumnLabels : defaultColumnLabels,
      verticalScaleDenominators: [...defaultColumnVerticalScales] }
  }
  if (input.pageHeightMillimeters != null) throw new KJValidationError('Geology: a style pack and direct page height cannot be mixed')
  const pack = validateKnowledgePack(input.columnStylePack)
  const rule = pack.rules?.['geology-column-layout']
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new KJValidationError('Geology: style pack has no geology-column-layout rule')
  const value = rule as Record<string, unknown>
  const isFieldGrid = value.fieldGrid != null
  const expectedKeys = [isFieldGrid ? 'fieldGrid' : 'columns', 'left', 'paperHeight', 'paperWidth', 'right']
  const keys = Object.keys(value).sort()
  if (keys.some(key => ![...expectedKeys, 'labels', 'observationColumns', 'displayAliases', 'headerDepth', 'headerRowHeight', 'fieldHeaderHeight', 'footerReserve', 'headerGrid', 'footerGrid', 'sptDisplayCap', 'legendMode', 'layerNumberStyle', 'titleHeight', 'textFlow', 'textHeights', 'stratigraphicNotationStyle', 'sampleMarkerStyle', 'sampleRangeBaselineStyle', 'groundwaterAnnotationStyle', 'patternLabelStyle', 'titleMarginFacts', 'frameStyle', 'descriptionBoundaryStyle', 'formTopology', 'verticalScaleDenominators', 'sourceTemplate'].includes(key)) || expectedKeys.some(key => !keys.includes(key))) throw new KJValidationError('Geology: style pack layout must declare five geometry fields and optional labels/observation columns')
  const paperWidth = numeric(value.paperWidth, 'style paper width'), paperHeight = numeric(value.paperHeight, 'style paper height')
  const titleHeight = value.titleHeight == null ? 5 : numeric(value.titleHeight, 'title height')
  if (titleHeight < 3 || titleHeight > 12) throw new KJValidationError('Geology: title height must be 3–12 mm')
  const left = numeric(value.left, 'style left'), right = numeric(value.right, 'style right')
  if (paperWidth < 150 || paperWidth > 500 || paperHeight < 250 || paperHeight > 1600 || left < 5 || right > paperWidth - 5 || right - left < 125) throw new KJValidationError('Geology: style paper and table margins are out of bounds')
  let columns: ColumnLayout['columns'] = [left + 15, left + 30, left + 45, left + 60, left + 95]
  if (!isFieldGrid) {
    if (!Array.isArray(value.columns) || ![5, 6].includes(value.columns.length)) throw new KJValidationError('Geology: style columns require five or six boundaries')
    columns = value.columns.map((item, index) => numeric(item, `style column ${index + 1}`)) as ColumnLayout['columns']
    const namedColumnMinimum = value.observationColumns ? 14 : 35
    if (columns.some((column, index) => column <= (index ? columns[index - 1]! : left) +
      (index === 0 ? 9 : index === columns.length - 1 ? namedColumnMinimum : index === columns.length - 2 ? 15 : 12))
      || right <= columns.at(-1)! + 25) throw new KJValidationError('Geology: style columns are not ordered or readable')
  }
  let observationColumns: ColumnLayout['observationColumns']
  if (value.observationColumns != null) {
    if (isFieldGrid) throw new KJValidationError('Geology: declarative field grid cannot mix legacy observation columns')
    if (!Array.isArray(value.observationColumns) || value.observationColumns.length !== 2) throw new KJValidationError('Geology: sample and SPT boundaries must be declared together')
    observationColumns = value.observationColumns.map((item, index) => numeric(item, `observation column ${index + 1}`)) as [number, number]
    if (observationColumns[0] <= columns.at(-1)! + 35 || observationColumns[1] <= observationColumns[0] + 15 || right <= observationColumns[1] + 12) throw new KJValidationError('Geology: description, sample and SPT columns are not readable')
  }
  const headerDepth = value.headerDepth == null ? 56 : numeric(value.headerDepth, 'style header depth')
  const headerRowHeight = value.headerRowHeight == null ? 7 : numeric(value.headerRowHeight, 'header row height')
  const fieldHeaderHeight = value.fieldHeaderHeight == null ? 10 : numeric(value.fieldHeaderHeight, 'field header height')
  const footerReserve = value.footerReserve == null ? 57 : numeric(value.footerReserve, 'style footer reserve')
  if (headerDepth < 40 || headerDepth > 90 || headerRowHeight < 4.5 || headerRowHeight > 10 || fieldHeaderHeight < 8 || fieldHeaderHeight > 18 || footerReserve < 12 || footerReserve > 120) throw new KJValidationError('Geology: style header or footer reserve is unreadable')
  const sptDisplayCap = value.sptDisplayCap == null ? undefined : numeric(value.sptDisplayCap, 'style SPT display cap')
  if (sptDisplayCap != null && (!Number.isSafeInteger(sptDisplayCap) || sptDisplayCap < 1 || sptDisplayCap > 1000)) throw new KJValidationError('Geology: SPT display cap must be an integer from 1 to 1000')
  let labels = geologyLocale(input) === 'zh-CN' ? chineseColumnLabels : defaultColumnLabels
  if (value.labels != null) {
    if (!value.labels || typeof value.labels !== 'object' || Array.isArray(value.labels)) throw new KJValidationError('Geology: style labels must be a declared object')
    const provided = value.labels as Record<string, unknown>
    if (Object.keys(provided).sort().join(',') !== Object.keys(defaultColumnLabels).sort().join(',')) throw new KJValidationError('Geology: style labels must translate every column and lithology role')
    labels = Object.fromEntries(Object.entries(provided).map(([key, label]) => [key, bounded(label, `style label ${key}`, key === 'footer' ? 160 : 48)]))
  }
  let displayAliases: ColumnLayout['displayAliases']
  if (value.displayAliases != null) {
    if (!value.displayAliases || typeof value.displayAliases !== 'object' || Array.isArray(value.displayAliases)) throw new KJValidationError('Geology: display aliases must be a declared object')
    const supplied = value.displayAliases as Record<string, unknown>
    if (Object.keys(supplied).some(key => !['codes', 'names'].includes(key))) throw new KJValidationError('Geology: display aliases may only contain codes and names')
    const aliases = (kind: 'codes' | 'names'): Record<string, string> => {
      const entries = supplied[kind]
      if (entries == null) return {}
      if (typeof entries !== 'object' || Array.isArray(entries)) throw new KJValidationError(`Geology: ${kind} display aliases must be an object`)
      const pairs = Object.entries(entries as Record<string, unknown>)
      if (pairs.length > 256) throw new KJValidationError('Geology: too many display aliases')
      return Object.fromEntries(pairs.map(([source, target]) => [bounded(source, `source ${kind} alias`, 64), bounded(target, `visible ${kind} alias`, 64)]))
    }
    displayAliases = { codes: aliases('codes'), names: aliases('names') }
  }
  let headerGrid: ColumnLayout['headerGrid']
  if (value.headerGrid != null) {
    const supplied = value.headerGrid
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) ||
      !['rows', 'continuousDividers,rows'].includes(Object.keys(supplied).sort().join(',')))
      throw new KJValidationError('Geology: header grid must declare rows and optional continuous dividers')
    const rows = (supplied as Record<string, unknown>).rows
    if (!Array.isArray(rows) || rows.length < 2 || rows.length > 4 || headerRowHeight * rows.length + fieldHeaderHeight + 10 > headerDepth) throw new KJValidationError('Geology: header grid rows do not fit the declared sheet')
    const seen = new Set<HeaderRole>(), documentKeys = new Set<string>()
    const parsedRows = rows.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length < 1 || row.length > 4 || (right - left) / row.length < 45) throw new KJValidationError(`Geology: header grid row ${rowIndex + 1} is unreadable`)
      const physical = row.some(raw => raw && typeof raw === 'object' && !Array.isArray(raw) &&
        ('start' in raw || 'valueStart' in raw))
      const parsed = row.map((raw, cellIndex) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError(`Geology: header grid cell ${rowIndex + 1}/${cellIndex + 1} needs a role and label`)
        const cell = raw as Record<string, unknown>
        const optional = cell.optional == null ? undefined : cell.optional
        if (optional != null && typeof optional !== 'boolean') throw new KJValidationError('Geology: header fact optional flag must be boolean')
        const hasGeometry = cell.start != null || cell.valueStart != null
        if (physical !== hasGeometry || hasGeometry && (cell.start == null || cell.valueStart == null))
          throw new KJValidationError('Geology: a physical header row must declare start and valueStart for every cell')
        const geometry = !physical ? {} : {
          start: numeric(cell.start, `header grid start ${rowIndex + 1}/${cellIndex + 1}`),
          valueStart: numeric(cell.valueStart, `header grid value start ${rowIndex + 1}/${cellIndex + 1}`),
        }
        const geometryKeys = physical ? ',start,valueStart' : ''
        if (cell.role === 'documentFact') {
          if (![...['key,label,role', 'key,label,optional,role'].map(schema => `${schema}${geometryKeys}`)].includes(Object.keys(cell).sort().join(','))) throw new KJValidationError(`Geology: header grid cell ${rowIndex + 1}/${cellIndex + 1} needs a document fact key, role and label`)
          const key = stableDocumentFactKey(cell.key), canonical = key.toLowerCase()
          if (documentKeys.has(canonical)) throw new KJValidationError('Geology: duplicate document fact key')
          documentKeys.add(canonical)
          return { role: 'documentFact' as const, key, label: bounded(cell.label, 'header fact label', 24), ...(optional == null ? {} : { optional }), ...geometry }
        }
        if (![...['label,role', 'label,optional,role'].map(schema => `${schema}${geometryKeys}`)].includes(Object.keys(cell).sort().join(',')) || typeof cell.role !== 'string' || !headerRoles.has(cell.role as HeaderRole)) throw new KJValidationError('Geology: undeclared header fact role')
        const role = cell.role as HeaderRole
        if (seen.has(role)) throw new KJValidationError('Geology: duplicate header fact role')
        seen.add(role)
        return { role, label: bounded(cell.label, 'header fact label', 24), ...(optional == null ? {} : { optional }), ...geometry }
      })
      if (physical) for (const [cellIndex, cell] of parsed.entries()) {
        const end = parsed[cellIndex + 1]?.start ?? right
        if (cell.start! < left || cellIndex === 0 && Math.abs(cell.start! - left) > 1e-6 || end - cell.start! < 30 ||
          cell.valueStart! - cell.start! < 10 || end - cell.valueStart! < 10)
          throw new KJValidationError(`Geology: physical header cell ${rowIndex + 1}/${cellIndex + 1} is out of bounds or unreadable`)
      }
      return parsed
    })
    let continuousDividers: number[] | undefined
    const rawContinuousDividers = (supplied as Record<string, unknown>).continuousDividers
    if (rawContinuousDividers != null) {
      if (!Array.isArray(rawContinuousDividers) || rawContinuousDividers.length < 1 || rawContinuousDividers.length > 8 ||
        !parsedRows.every(row => row.every(cell => cell.start != null && cell.valueStart != null)))
        throw new KJValidationError('Geology: continuous header dividers need 1–8 physical source positions')
      continuousDividers = rawContinuousDividers.map((raw, index) => numeric(raw, `continuous header divider ${index + 1}`))
      if (new Set(continuousDividers).size !== continuousDividers.length) throw new KJValidationError('Geology: continuous header dividers must be unique')
      for (const divider of continuousDividers) {
        const rowOccurrences = parsedRows.filter(row => row.some((cell, index) =>
          Math.abs(cell.valueStart! - divider) < 1e-9 || index > 0 && Math.abs(cell.start! - divider) < 1e-9)).length
        if (divider <= left || divider >= right || rowOccurrences < 2 || rowOccurrences === parsedRows.length)
          throw new KJValidationError('Geology: a continuous header divider must bridge an actual source-row gap')
      }
    }
    headerGrid = { rows: parsedRows, ...(continuousDividers ? { continuousDividers } : {}) }
  }
  let fieldGrid: ColumnLayout['fieldGrid']
  if (isFieldGrid) {
    if (!Array.isArray(value.fieldGrid) || value.fieldGrid.length < 7 || value.fieldGrid.length > 24) throw new KJValidationError('Geology: field grid needs 7–24 declared physical columns')
    const roles = new Set<FieldRole>(), measurementKeys = new Set<string>()
    fieldGrid = value.fieldGrid.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: field grid column must be a declared object')
      const cell = raw as Record<string, unknown>
      const role = cell.role as FieldRole
      const optionalSubLabel = cell.subLabel == null ? '' : ',subLabel'
      const optionalWidthFactor = cell.textWidthFactor == null ? '' : ',textWidthFactor'
      const schema = role === 'measurement' ? (cell.decimals == null ? `key,label,role,start${optionalSubLabel}${optionalWidthFactor}` : `decimals,key,label,role,start${optionalSubLabel}${optionalWidthFactor}`) : `label,role,start${optionalSubLabel}${optionalWidthFactor}`
      if (!fieldRoles.has(role) || Object.keys(cell).sort().join(',') !== schema) throw new KJValidationError('Geology: field grid column needs an exact role schema')
      const start = numeric(cell.start, `field grid start ${index + 1}`), label = bounded(cell.label, `field grid label ${index + 1}`, 32)
      const subLabel = cell.subLabel == null ? undefined : bounded(cell.subLabel, `field grid sublabel ${index + 1}`, 24)
      const textWidthFactor = cell.textWidthFactor == null ? undefined : numeric(cell.textWidthFactor, `field grid text width factor ${index + 1}`)
      if (textWidthFactor != null && (textWidthFactor < 0.5 || textWidthFactor > 1.5)) throw new KJValidationError('Geology: field grid text width factor must be 0.5–1.5')
      if (role !== 'measurement' && roles.has(role)) throw new KJValidationError(`Geology: duplicate field role ${role}`)
      roles.add(role)
      if (role === 'measurement') {
        const key = bounded(cell.key, 'measurement key', 24)
        if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/u.test(key) || measurementKeys.has(key)) throw new KJValidationError('Geology: measurement keys must be unique safe names')
        measurementKeys.add(key)
        const decimals = cell.decimals == null ? 2 : numeric(cell.decimals, 'measurement display decimals')
        if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 4) throw new KJValidationError('Geology: measurement decimals must be 0–4')
        return { start, role, label, ...(subLabel ? { subLabel } : {}), ...(textWidthFactor == null ? {} : { textWidthFactor }), key, decimals }
      }
      return { start, role, label, ...(subLabel ? { subLabel } : {}), ...(textWidthFactor == null ? {} : { textWidthFactor }) }
    })
    if (requiredFieldRoles.some(role => !roles.has(role)) || Math.abs(fieldGrid[0]!.start - left) > 1e-6) throw new KJValidationError('Geology: field grid misses a core role or left margin')
    for (const [index, field] of fieldGrid.entries()) {
      const width = (fieldGrid[index + 1]?.start ?? right) - field.start
      const minimum = field.role === 'description' ? 35 : field.role === 'layerName' ? 15 :
        field.role === 'measurement' ? 7.5 : ['spt', 'pattern'].includes(field.role) ? 12 : 10
      if (width < minimum || field.start < left || field.start >= right) throw new KJValidationError(`Geology: field ${field.role} is out of bounds or unreadable`)
    }
  }
  let footerGrid: ColumnLayout['footerGrid']
  if (value.footerGrid != null) {
    const supplied = value.footerGrid
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || Object.keys(supplied).sort().join(',') !== 'cells,height') throw new KJValidationError('Geology: footer grid must declare height and cells')
    const height = numeric((supplied as Record<string, unknown>).height, 'footer grid height')
    const cells = (supplied as Record<string, unknown>).cells
    if (height < 7 || height > 16 || height + 5 > footerReserve || !Array.isArray(cells) || cells.length < 3 || cells.length > 8) throw new KJValidationError('Geology: footer grid does not fit the declared sheet')
    const keys = new Set<string>()
    const parsed = cells.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        !['key,label,start', 'internalDivider,key,label,start'].includes(Object.keys(raw).sort().join(',')))
        throw new KJValidationError('Geology: footer cell needs an exact key, label, start and optional internal divider')
      const cell = raw as Record<string, unknown>, start = numeric(cell.start, `footer cell start ${index + 1}`)
      const key = stableDocumentFactKey(cell.key, 'footer fact key'), label = bounded(cell.label, 'footer fact label', 16)
      const internalDivider = cell.internalDivider == null ? undefined : numeric(cell.internalDivider, `footer cell internal divider ${index + 1}`)
      if (keys.has(key.toLowerCase())) throw new KJValidationError('Geology: duplicate footer fact key')
      keys.add(key.toLowerCase())
      return { start, key, label, ...(internalDivider == null ? {} : { internalDivider }) }
    })
    for (const [index, cell] of parsed.entries()) {
      const end = parsed[index + 1]?.start ?? right
      if (cell.start < left || end - cell.start < 20 || index && cell.start <= parsed[index - 1]!.start ||
        cell.internalDivider != null && (cell.internalDivider - cell.start < 4 || end - cell.internalDivider < 4))
        throw new KJValidationError('Geology: footer cell is out of bounds or unreadable')
    }
    if (Math.abs(parsed[0]!.start - left) > 1e-6) throw new KJValidationError('Geology: footer grid must start at the table margin')
    footerGrid = { height, cells: parsed }
  }
  let textFlow: ColumnLayout['textFlow']
  if (value.textFlow != null) {
    if (!isFieldGrid || !value.textFlow || typeof value.textFlow !== 'object' || Array.isArray(value.textFlow)) throw new KJValidationError('Geology: text flow requires a declarative field grid')
    const rule = value.textFlow as Record<string, unknown>
    if (Object.keys(rule).sort().join(',') !== 'firstBaselineMm,firstGroupBorrowMm,firstGroupUnruled,labelHeightMm,labelPitchMm,paragraphGapMm') throw new KJValidationError('Geology: text flow needs an exact versioned lane schema')
    const firstGroupBorrowMm = numeric(rule.firstGroupBorrowMm, 'first group borrow'), firstBaselineMm = numeric(rule.firstBaselineMm, 'first label baseline')
    const labelPitchMm = numeric(rule.labelPitchMm, 'label pitch'), labelHeightMm = numeric(rule.labelHeightMm, 'label height')
    const paragraphGapMm = numeric(rule.paragraphGapMm, 'paragraph gap')
    if (typeof rule.firstGroupUnruled !== 'boolean' || firstGroupBorrowMm < 0 || firstGroupBorrowMm > 20 ||
      labelHeightMm < 1.5 || labelHeightMm > 4 || firstBaselineMm < labelHeightMm + 0.2 || firstBaselineMm > 12 ||
      labelPitchMm < labelHeightMm + 0.5 || labelPitchMm > 15 || paragraphGapMm < 0.5 || paragraphGapMm > 5)
      throw new KJValidationError('Geology: text flow lane is unreadable or unbounded')
    textFlow = { firstGroupBorrowMm, firstGroupUnruled: rule.firstGroupUnruled, firstBaselineMm, labelPitchMm, labelHeightMm, paragraphGapMm }
  }
  let textHeights: ColumnLayout['textHeights']
  if (value.textHeights != null) {
    if (!isFieldGrid || !value.textHeights || typeof value.textHeights !== 'object' || Array.isArray(value.textHeights))
      throw new KJValidationError('Geology: role text heights require a declarative field grid')
    const rule = value.textHeights as Record<string, unknown>
    const roles = ['headerFact', 'fieldHeader', 'fieldSubHeader', 'majorValue', 'intervalDepth', 'observation'] as const
    if (Object.keys(rule).sort().join(',') !== [...roles].sort().join(','))
      throw new KJValidationError('Geology: role text heights need an exact versioned schema')
    const parsedTextHeights = Object.fromEntries(roles.map(role => [role, numeric(rule[role], `${role} text height`)])) as NonNullable<ColumnLayout['textHeights']>
    if (Object.values(parsedTextHeights).some(height => height < 1.2 || height > 5) ||
      parsedTextHeights.headerFact > headerRowHeight - 1 || parsedTextHeights.fieldHeader + parsedTextHeights.fieldSubHeader + 0.8 > fieldHeaderHeight)
      throw new KJValidationError('Geology: role text heights do not fit the declared rows')
    textHeights = parsedTextHeights
  }
  let stratigraphicNotationStyle: ColumnLayout['stratigraphicNotationStyle']
  if (value.stratigraphicNotationStyle != null) {
    if (!isFieldGrid || !value.stratigraphicNotationStyle || typeof value.stratigraphicNotationStyle !== 'object' || Array.isArray(value.stratigraphicNotationStyle) ||
      Object.keys(value.stratigraphicNotationStyle).sort().join(',') !== 'qualifierHeight,symbolHeight')
      throw new KJValidationError('Geology: stratigraphic notation style needs an exact declarative field-grid schema')
    const rule = value.stratigraphicNotationStyle as Record<string, unknown>
    const symbolHeight = numeric(rule.symbolHeight, 'stratigraphic notation symbol height')
    const qualifierHeight = numeric(rule.qualifierHeight, 'stratigraphic notation qualifier height')
    if (symbolHeight < 1.5 || symbolHeight > 5 || qualifierHeight < 1 || qualifierHeight > symbolHeight)
      throw new KJValidationError('Geology: stratigraphic notation text heights are unreadable')
    stratigraphicNotationStyle = { symbolHeight, qualifierHeight }
  }
  let sampleMarkerStyle: ColumnLayout['sampleMarkerStyle']
  if (value.sampleMarkerStyle != null) {
    if (!isFieldGrid || !value.sampleMarkerStyle || typeof value.sampleMarkerStyle !== 'object' || Array.isArray(value.sampleMarkerStyle) ||
      Object.keys(value.sampleMarkerStyle).sort().join(',') !== 'baselineOffset,gap,height')
      throw new KJValidationError('Geology: sample marker style needs an exact declarative field-grid schema')
    const rule = value.sampleMarkerStyle as Record<string, unknown>
    const height = numeric(rule.height, 'sample marker height'), gap = numeric(rule.gap, 'sample marker gap')
    const baselineOffset = numeric(rule.baselineOffset, 'sample marker baseline offset')
    if (height < 0.8 || height > 4 || gap < 0 || gap > 5 || baselineOffset < -3 || baselineOffset > 3)
      throw new KJValidationError('Geology: sample marker style is unreadable')
    sampleMarkerStyle = { height, gap, baselineOffset }
  }
  let sampleRangeBaselineStyle: ColumnLayout['sampleRangeBaselineStyle']
  if (value.sampleRangeBaselineStyle != null) {
    if (!isFieldGrid || !value.sampleRangeBaselineStyle || typeof value.sampleRangeBaselineStyle !== 'object' || Array.isArray(value.sampleRangeBaselineStyle) ||
      Object.keys(value.sampleRangeBaselineStyle).sort().join(',') !== 'boundaries,continuity,insetMm')
      throw new KJValidationError('Geology: sample range baselines need an exact declarative field-grid schema')
    const rule = value.sampleRangeBaselineStyle as Record<string, unknown>
    if (!Array.isArray(rule.boundaries) || rule.boundaries.length < 1 || rule.boundaries.length > 2 ||
      rule.boundaries.some(boundary => boundary !== 'top' && boundary !== 'bottom') || new Set(rule.boundaries).size !== rule.boundaries.length)
      throw new KJValidationError('Geology: sample range baseline boundaries must contain unique top/bottom roles')
    if (rule.continuity !== 'collision-safe' && rule.continuity !== 'continuous')
      throw new KJValidationError('Geology: sample range baseline continuity must be collision-safe or continuous')
    const insetMm = numeric(rule.insetMm, 'sample range baseline inset')
    const sampleIndex = fieldGrid!.findIndex(field => field.role === 'sample')
    const sampleWidth = sampleIndex < 0 ? 0 : (fieldGrid![sampleIndex + 1]?.start ?? right) - fieldGrid![sampleIndex]!.start
    if (sampleIndex < 0 || insetMm < 0 || sampleWidth - insetMm * 2 < 0.4)
      throw new KJValidationError('Geology: sample range baseline inset leaves no visible source lane')
    sampleRangeBaselineStyle = { boundaries: rule.boundaries as ('top' | 'bottom')[],
      continuity: rule.continuity, insetMm }
  }
  let groundwaterAnnotationStyle: ColumnLayout['groundwaterAnnotationStyle']
  if (value.groundwaterAnnotationStyle != null) {
    const groundwaterStyleKeys = Object.keys(value.groundwaterAnnotationStyle).sort().join(',')
    if (!isFieldGrid || !value.groundwaterAnnotationStyle || typeof value.groundwaterAnnotationStyle !== 'object' || Array.isArray(value.groundwaterAnnotationStyle) ||
      !['dateOffset,fieldRole,gap,markerHeight,markerOffset,textHeight,textWidthFactor,valueOffset',
        'dateOffset,fieldRole,gap,guide,markerHeight,markerOffset,textHeight,textWidthFactor,valueOffset'].includes(groundwaterStyleKeys))
      throw new KJValidationError('Geology: groundwater annotation style needs an exact declarative field-grid schema')
    const rule = value.groundwaterAnnotationStyle as Record<string, unknown>
    if (rule.fieldRole !== 'pattern') throw new KJValidationError('Geology: groundwater annotations need a declared pattern field')
    if (rule.guide != null && rule.guide !== 'field-top-to-reading')
      throw new KJValidationError('Geology: unsupported groundwater annotation guide')
    const textHeight = numeric(rule.textHeight, 'groundwater annotation text height')
    const markerHeight = numeric(rule.markerHeight, 'groundwater annotation marker height')
    const textWidthFactor = numeric(rule.textWidthFactor, 'groundwater annotation text width factor')
    const gap = numeric(rule.gap, 'groundwater annotation value gap')
    const valueOffset = numeric(rule.valueOffset, 'groundwater annotation value offset')
    const markerOffset = numeric(rule.markerOffset, 'groundwater annotation marker offset')
    const dateOffset = numeric(rule.dateOffset, 'groundwater annotation date offset')
    if (textHeight < 0.8 || textHeight > 4 || markerHeight < 0.8 || markerHeight > 5 || textWidthFactor < 0.5 || textWidthFactor > 1 ||
      gap < 0 || gap > 5 || [valueOffset, markerOffset, dateOffset].some(offset => offset < -10 || offset > 10) ||
      dateOffset + textHeight + 0.2 > markerOffset || markerOffset + markerHeight + 0.2 > valueOffset)
      throw new KJValidationError('Geology: groundwater annotation style is unreadable')
    groundwaterAnnotationStyle = { fieldRole: 'pattern', textHeight, markerHeight, textWidthFactor, gap, valueOffset, markerOffset, dateOffset,
      ...(rule.guide === 'field-top-to-reading' ? { guide: rule.guide } : {}) }
  }
  let patternLabelStyle: ColumnLayout['patternLabelStyle']
  if (value.patternLabelStyle != null) {
    if (!isFieldGrid || !value.patternLabelStyle || typeof value.patternLabelStyle !== 'object' || Array.isArray(value.patternLabelStyle) ||
      Object.keys(value.patternLabelStyle).sort().join(',') !== 'height,minimumBandHeight,textWidthFactor')
      throw new KJValidationError('Geology: pattern label style needs an exact declarative field-grid schema')
    const rule = value.patternLabelStyle as Record<string, unknown>
    const height = numeric(rule.height, 'pattern label height')
    const textWidthFactor = numeric(rule.textWidthFactor, 'pattern label width factor')
    const minimumBandHeight = numeric(rule.minimumBandHeight, 'pattern label minimum band height')
    if (height < 0.8 || height > 4 || textWidthFactor < 0.5 || textWidthFactor > 1 || minimumBandHeight < height || minimumBandHeight > 20)
      throw new KJValidationError('Geology: pattern label style is unreadable')
    patternLabelStyle = { height, textWidthFactor, minimumBandHeight }
  }
  let titleMarginFacts: ColumnLayout['titleMarginFacts']
  if (value.titleMarginFacts != null) {
    if (!isFieldGrid || !Array.isArray(value.titleMarginFacts) || value.titleMarginFacts.length < 1 || value.titleMarginFacts.length > 8)
      throw new KJValidationError('Geology: title margin facts require 1–8 declarative field-grid placements')
    const seen = new Set<string>()
    titleMarginFacts = value.titleMarginFacts.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError(`Geology: title margin fact ${index + 1} is invalid`)
      const item = raw as Record<string, unknown>
      if (!['anchor,edge,height,horizontalAlignment,key,label,offset,rotationDegrees,separator,textWidthFactor,verticalAlignment',
        'anchor,decoration,edge,height,horizontalAlignment,key,label,offset,rotationDegrees,separator,textWidthFactor,verticalAlignment']
        .includes(Object.keys(item).sort().join(',')))
        throw new KJValidationError('Geology: title margin fact needs an exact versioned placement schema')
      const key = stableDocumentFactKey(item.key, 'title margin fact key'), canonical = key.toLowerCase()
      if (seen.has(canonical)) throw new KJValidationError('Geology: duplicate title margin fact key')
      seen.add(canonical)
      const label = bounded(item.label, 'title margin fact label', 24)
      if (typeof item.separator !== 'string' || item.separator.length > 4 || /[\u0000-\u001f\u007f]/u.test(item.separator))
        throw new KJValidationError('Geology: invalid title margin fact separator')
      if (item.edge !== 'top' || !['left', 'center', 'right'].includes(String(item.anchor)) ||
        !['left', 'center', 'right'].includes(String(item.horizontalAlignment)) || !['baseline', 'middle'].includes(String(item.verticalAlignment)))
        throw new KJValidationError('Geology: unsupported title margin edge or alignment')
      if (!Array.isArray(item.offset) || item.offset.length !== 2) throw new KJValidationError('Geology: title margin fact offset needs two coordinates')
      const offset = item.offset.map((coordinate, coordinateIndex) => numeric(coordinate, `title margin fact offset ${coordinateIndex + 1}`)) as [number, number]
      const height = numeric(item.height, 'title margin fact height')
      const textWidthFactor = numeric(item.textWidthFactor, 'title margin fact width factor')
      const rotationDegrees = numeric(item.rotationDegrees, 'title margin fact rotation')
      if (height < 0.8 || height > 8 || textWidthFactor < 0.4 || textWidthFactor > 1.5 || rotationDegrees < -180 || rotationDegrees > 180)
        throw new KJValidationError('Geology: title margin fact typography is unreadable')
      let decoration: KJGeologyTitleMarginDecoration | undefined
      if (item.decoration != null) {
        if (!item.decoration || typeof item.decoration !== 'object' || Array.isArray(item.decoration) ||
          Object.keys(item.decoration).sort().join(',') !== 'elbowOffset,horizontalEnd,kind')
          throw new KJValidationError('Geology: title margin fact decoration needs an exact source-backed schema')
        const rawDecoration = item.decoration as Record<string, unknown>
        if (rawDecoration.kind !== 'top-edge-elbow-underline' || rawDecoration.horizontalEnd !== 'frame-right' ||
          !Array.isArray(rawDecoration.elbowOffset) || rawDecoration.elbowOffset.length !== 2)
          throw new KJValidationError('Geology: unsupported title margin fact decoration')
        const elbowOffset = rawDecoration.elbowOffset.map((coordinate, coordinateIndex) =>
          numeric(coordinate, `title margin decoration offset ${coordinateIndex + 1}`)) as [number, number]
        if (elbowOffset.some(coordinate => coordinate < -30 || coordinate > 30))
          throw new KJValidationError('Geology: title margin fact decoration is outside the readable title band')
        decoration = { kind: rawDecoration.kind, elbowOffset, horizontalEnd: rawDecoration.horizontalEnd }
      }
      return { key, label, separator: item.separator, edge: 'top' as const, anchor: item.anchor as TitleMarginFactPlacement['anchor'], offset,
        height, textWidthFactor, horizontalAlignment: item.horizontalAlignment as TitleMarginFactPlacement['horizontalAlignment'],
        verticalAlignment: item.verticalAlignment as TitleMarginFactPlacement['verticalAlignment'], rotationDegrees,
        ...(decoration ? { decoration } : {}) }
    })
  }
  let frameStyle: ColumnLayout['frameStyle']
  if (value.frameStyle != null) {
    if (!isFieldGrid || !value.frameStyle || typeof value.frameStyle !== 'object' || Array.isArray(value.frameStyle) ||
      Object.keys(value.frameStyle).sort().join(',') !== 'bottomMargin,constantWidth,topMargin')
      throw new KJValidationError('Geology: frame style needs an exact declarative field-grid schema')
    const rule = value.frameStyle as Record<string, unknown>
    const topMargin = numeric(rule.topMargin, 'frame top margin')
    const bottomMargin = numeric(rule.bottomMargin, 'frame bottom margin')
    const constantWidth = numeric(rule.constantWidth, 'frame constant width')
    if (topMargin < 2 || topMargin > 30 || bottomMargin < 2 || bottomMargin > 30 || constantWidth < 0 || constantWidth > 2 ||
      topMargin + bottomMargin > paperHeight - 100)
      throw new KJValidationError('Geology: frame style is outside the readable sheet')
    frameStyle = { topMargin, bottomMargin, constantWidth }
  }
  let descriptionBoundaryStyle: ColumnLayout['descriptionBoundaryStyle']
  if (value.descriptionBoundaryStyle != null) {
    if (!isFieldGrid || !textFlow || !value.descriptionBoundaryStyle || typeof value.descriptionBoundaryStyle !== 'object' ||
      Array.isArray(value.descriptionBoundaryStyle) || Object.keys(value.descriptionBoundaryStyle).sort().join(',') !== 'clearance,inset')
      throw new KJValidationError('Geology: description boundary style needs text flow and an exact field-grid schema')
    const rule = value.descriptionBoundaryStyle as Record<string, unknown>
    const inset = numeric(rule.inset, 'description boundary inset')
    const clearance = numeric(rule.clearance, 'description boundary clearance')
    const description = fieldGrid?.find(item => item.role === 'description')
    const descriptionEnd = description == null ? 0 : fieldGrid?.[fieldGrid.indexOf(description) + 1]?.start ?? right
    if (!description || inset < 0.5 || inset > 10 || inset * 2 > descriptionEnd - description.start - 4 || clearance < 0.2 || clearance > 5)
      throw new KJValidationError('Geology: description boundary style is unreadable')
    descriptionBoundaryStyle = { inset, clearance }
  }
  let formTopology: ColumnLayout['formTopology']
  if (value.formTopology != null) {
    if (!isFieldGrid || !headerGrid || !footerGrid || !value.formTopology || typeof value.formTopology !== 'object' ||
      Array.isArray(value.formTopology) || Object.keys(value.formTopology).sort().join(',') !== 'containers,headerDividers,patternCells')
      throw new KJValidationError('Geology: form topology needs field, header and footer grids with an exact schema')
    const rule = value.formTopology as Record<string, unknown>
    if (rule.containers !== 'outer-frame-separators' || rule.headerDividers !== 'merge-adjacent-collinear' ||
      rule.patternCells !== 'closed-outline')
      throw new KJValidationError('Geology: unsupported form topology strategy')
    formTopology = { containers: rule.containers, headerDividers: rule.headerDividers, patternCells: rule.patternCells }
  }
  let verticalScaleDenominators = [...defaultColumnVerticalScales]
  if (value.verticalScaleDenominators != null) {
    if (!Array.isArray(value.verticalScaleDenominators) || value.verticalScaleDenominators.length < 1 || value.verticalScaleDenominators.length > 16)
      throw new KJValidationError('Geology: style vertical scales require 1–16 standard denominators')
    verticalScaleDenominators = value.verticalScaleDenominators.map((item, index) => numeric(item, `vertical scale denominator ${index + 1}`))
    if (verticalScaleDenominators.some(item => !Number.isSafeInteger(item) || item < 10 || item > 100000) ||
      verticalScaleDenominators.some((item, index) => index > 0 && item <= verticalScaleDenominators[index - 1]!))
      throw new KJValidationError('Geology: style vertical scale denominators must be unique increasing integers from 10 to 100000')
  }
  const legendMode = value.legendMode == null ? 'footer' : value.legendMode
  if (legendMode !== 'footer' && legendMode !== 'none' || legendMode === 'none' && !fieldGrid) throw new KJValidationError('Geology: undeclared or inappropriate legend mode')
  const layerNumberStyle = value.layerNumberStyle == null ? 'plain' : value.layerNumberStyle
  if (layerNumberStyle !== 'plain' && layerNumberStyle !== 'circle') throw new KJValidationError('Geology: layer number style must be plain or circle')
  if (footerGrid && legendMode !== 'none') throw new KJValidationError('Geology: a title block cannot overlap the footer legend')
  let sourceTemplate: ColumnLayout['sourceTemplate']
  if (input.strictSourceTemplate && value.sourceTemplate == null) throw new KJValidationError('Geology: strict source template needs native vector evidence')
  if (value.sourceTemplate != null) {
    const raw = value.sourceTemplate
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: source template evidence must be a declared object')
    const evidence = raw as Record<string, unknown>
    if (Object.keys(evidence).sort().join(',') !== 'fieldRoles,footerLabels,gridLineHandles,innerGridWidthMillimeters,sourceId,verticalScaleDenominator')
      throw new KJValidationError('Geology: source template evidence has an unknown or missing field')
    const sourceId = bounded(evidence.sourceId, 'source template ID', 64)
    const source = pack.sources.find(item => item.id === sourceId)
    if (!source || !/^[a-f0-9]{64}$/u.test(source.contentHash)) throw new KJValidationError('Geology: source template needs a SHA-256 pack source')
    const sourceScale = numeric(evidence.verticalScaleDenominator, 'source template vertical scale')
    const sourceWidth = numeric(evidence.innerGridWidthMillimeters, 'source template inner grid width')
    if (!Number.isSafeInteger(sourceScale) || sourceScale < 10 || sourceScale > 100000 || Math.abs(sourceWidth - (right - left)) > 0.1)
      throw new KJValidationError('Geology: source template scale or vector grid width differs from the declared layout')
    const actualRoles = fieldGrid?.map(item => item.role === 'measurement' ? `measurement:${item.key}` : item.role)
    if (!actualRoles || !Array.isArray(evidence.fieldRoles) || evidence.fieldRoles.length !== actualRoles.length ||
      evidence.fieldRoles.some((role, index) => role !== actualRoles[index]))
      throw new KJValidationError('Geology: physical field roles differ from the source template')
    const actualFooterLabels = footerGrid?.cells.map(cell => cell.label) ?? []
    if (!Array.isArray(evidence.footerLabels) || evidence.footerLabels.length !== actualFooterLabels.length ||
      evidence.footerLabels.some((label, index) => label !== actualFooterLabels[index]))
      throw new KJValidationError('Geology: footer labels differ from the source template')
    if (!Array.isArray(evidence.gridLineHandles) || evidence.gridLineHandles.length < 2 || evidence.gridLineHandles.length > 256 ||
      evidence.gridLineHandles.some(handle => typeof handle !== 'string' || !/^[A-Fa-f0-9]{1,16}$/u.test(handle)))
      throw new KJValidationError('Geology: source template needs bounded native grid line handles')
    sourceTemplate = { sourceId, sourceSha256: source.contentHash, verticalScaleDenominator: sourceScale,
      innerGridWidthMillimeters: sourceWidth, fieldRoles: actualRoles, footerLabels: actualFooterLabels,
      gridLineHandles: evidence.gridLineHandles as string[] }
  }
  return { paperWidth, paperHeight, left, right, columns, headerDepth, headerRowHeight, fieldHeaderHeight, footerReserve, legendMode, layerNumberStyle, titleHeight, verticalScaleDenominators, ...(sptDisplayCap == null ? {} : { sptDisplayCap }),
    ...(observationColumns ? { observationColumns } : {}), labels,
    ...(displayAliases ? { displayAliases } : {}), ...(headerGrid ? { headerGrid } : {}), ...(footerGrid ? { footerGrid } : {}), ...(fieldGrid ? { fieldGrid } : {}), ...(textFlow ? { textFlow } : {}), ...(textHeights ? { textHeights } : {}),
    ...(stratigraphicNotationStyle ? { stratigraphicNotationStyle } : {}), ...(sampleMarkerStyle ? { sampleMarkerStyle } : {}),
    ...(sampleRangeBaselineStyle ? { sampleRangeBaselineStyle } : {}),
    ...(groundwaterAnnotationStyle ? { groundwaterAnnotationStyle } : {}), ...(patternLabelStyle ? { patternLabelStyle } : {}),
    ...(titleMarginFacts ? { titleMarginFacts } : {}),
    ...(frameStyle ? { frameStyle } : {}), ...(descriptionBoundaryStyle ? { descriptionBoundaryStyle } : {}),
    ...(formTopology ? { formTopology } : {}),
    ...(sourceTemplate ? { sourceTemplate } : {}) }
}

function sectionLayout(input: KJGeologySectionInput): SectionLayout {
  const pack = validateKnowledgePack(input.sectionStylePack ?? KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  const raw = pack.rules?.['geology-section-layout']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: bundled section layout is missing')
  const value = raw as Record<string, unknown>
  const scalarKeys = ['paperWidth', 'paperHeight', 'outerMargin', 'innerMargin', 'plotLeft', 'plotRight', 'plotBottom', 'plotTop', 'titleY', 'scaleY', 'footerHeight', 'boreholeWidth', 'elevationTickStep'] as const
  if (Object.keys(value).sort().join(',') !== [...scalarKeys, 'footerGrid'].sort().join(',')) throw new KJValidationError('Geology: section layout has an undeclared field')
  const scalars = Object.fromEntries(scalarKeys.map(key => [key, numeric(value[key], `section ${key}`)])) as unknown as Omit<SectionLayout, 'footerGrid'>
  if (scalars.paperWidth < 210 || scalars.paperWidth > 1600 || scalars.paperHeight < 210 || scalars.paperHeight > 1600 ||
    scalars.outerMargin < 3 || scalars.innerMargin <= scalars.outerMargin ||
    scalars.plotLeft <= scalars.innerMargin || scalars.plotRight >= scalars.paperWidth - scalars.innerMargin || scalars.plotRight - scalars.plotLeft < 250 ||
    scalars.plotBottom < scalars.innerMargin + scalars.footerHeight + 8 || scalars.plotTop <= scalars.plotBottom + 120 || scalars.titleY <= scalars.plotTop ||
    scalars.scaleY <= scalars.plotTop || scalars.scaleY >= scalars.titleY || scalars.boreholeWidth < 2 || scalars.boreholeWidth > 8 ||
    scalars.elevationTickStep < 0.5 || scalars.elevationTickStep > 20) throw new KJValidationError('Geology: section layout geometry is unreadable')
  if (!Array.isArray(value.footerGrid) || value.footerGrid.length < 3 || value.footerGrid.length > 8) throw new KJValidationError('Geology: section footer grid is invalid')
  const seen = new Set<string>(), footerGrid = value.footerGrid.map((rawCell, index) => {
    if (!rawCell || typeof rawCell !== 'object' || Array.isArray(rawCell) || Object.keys(rawCell).sort().join(',') !== 'key,label,start') throw new KJValidationError('Geology: section footer cell needs an exact key, label and start')
    const cell = rawCell as Record<string, unknown>, start = numeric(cell.start, `section footer start ${index + 1}`)
    const key = stableDocumentFactKey(cell.key, 'section footer fact key'), label = bounded(cell.label, 'section footer label', 16)
    if (seen.has(key.toLowerCase())) throw new KJValidationError('Geology: duplicate section footer fact key')
    seen.add(key.toLowerCase())
    return { start, key, label }
  })
  for (const [index, cell] of footerGrid.entries()) {
    const end = footerGrid[index + 1]?.start ?? scalars.paperWidth - scalars.innerMargin
    if (index === 0 && Math.abs(cell.start - scalars.innerMargin) > 1e-6 || index && cell.start <= footerGrid[index - 1]!.start || end - cell.start < 28)
      throw new KJValidationError('Geology: section footer cell is out of bounds or unreadable')
  }
  return { ...scalars, footerGrid }
}

function checkHole(hole: KJGeologyBorehole): KJGeologyStratum[] {
  bounded(hole.id, 'hole id')
  numeric(hole.collarElevation, 'collar elevation')
  if (hole.x != null) projectCoordinate(hole.x, 'borehole X coordinate')
  if (hole.y != null) projectCoordinate(hole.y, 'borehole Y coordinate')
  if (hole.startDate != null) bounded(hole.startDate, 'start date', 32)
  if (hole.endDate != null) bounded(hole.endDate, 'end date', 32)
  positive(hole.depth, 'hole depth')
  if (hole.stableWaterDepth != null && (numeric(hole.stableWaterDepth, 'stable groundwater depth') < 0 || hole.stableWaterDepth > hole.depth)) throw new KJValidationError('Geology: stable groundwater depth is outside the hole')
  if (hole.initialWaterDepth != null && (numeric(hole.initialWaterDepth, 'initial groundwater depth') < 0 || hole.initialWaterDepth > hole.depth)) throw new KJValidationError('Geology: initial groundwater depth is outside the hole')
  if (hole.groundwaterObservations != null) {
    if (!Array.isArray(hole.groundwaterObservations) || !hole.groundwaterObservations.length || hole.groundwaterObservations.length > 32)
      throw new KJValidationError('Geology: groundwater observations require a bounded nonempty list')
    const identities = new Set<string>()
    for (const item of hole.groundwaterObservations) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'depth,elevation,marker,observedOn')
        throw new KJValidationError('Geology: groundwater observation needs exact depth, elevation, date and marker facts')
      const depth = numeric(item.depth, 'groundwater observation depth')
      const elevation = numeric(item.elevation, 'groundwater observation elevation')
      const observedOn = bounded(item.observedOn, 'groundwater observation date', 64)
      if (item.marker !== 'filled-down-triangle') throw new KJValidationError('Geology: unsupported groundwater observation marker')
      if (depth < 0 || depth > hole.depth) throw new KJValidationError('Geology: groundwater observation depth is outside the hole')
      if (Math.abs(hole.collarElevation - depth - elevation) > 0.011)
        throw new KJValidationError('Geology: groundwater observation depth and elevation disagree with the supplied collar')
      const identity = `${depth}:${elevation}:${observedOn}:${item.marker}`
      if (identities.has(identity)) throw new KJValidationError('Geology: repeated groundwater observation identity')
      identities.add(identity)
    }
  }
  if (!Array.isArray(hole.strata) || !hole.strata.length || hole.strata.length > 80) throw new KJValidationError('Geology: 1–80 strata are required')
  const strata = [...hole.strata].sort((a, b) => a.top - b.top)
  const grouped = strata.some(layer => layer.groupId != null || layer.groupRole != null)
  const finishedGroups = new Set<string>()
  let currentGroup: string | null = null
  const principals = new Map<string, KJGeologyStratum>()
  const intervalIds = new Set<string>()
  let previous = 0
  for (const layer of strata) {
    const code = bounded(layer.code, 'stratum code', 24)
    if (grouped) {
      const groupId = bounded(layer.groupId, 'source major group id', 24)
      if (layer.groupRole !== 'principal' && layer.groupRole !== 'lens') throw new KJValidationError('Geology: every grouped interval needs a declared principal/lens role')
      if (groupId !== currentGroup) {
        if (currentGroup != null) finishedGroups.add(currentGroup)
        if (finishedGroups.has(groupId)) throw new KJValidationError('Geology: a major group may not reappear after another group')
        currentGroup = groupId
      }
      if (layer.groupRole === 'principal') {
        const prior = principals.get(groupId)
        if (prior && (prior.code !== layer.code || prior.name !== layer.name || prior.lithology !== layer.lithology || prior.patternKey !== layer.patternKey ||
          JSON.stringify(prior.stratigraphicNotation) !== JSON.stringify(layer.stratigraphicNotation)))
          throw new KJValidationError('Geology: repeated principal intervals disagree on the major group identity')
        principals.set(groupId, layer)
      }
    } else if (layer.groupId != null || layer.groupRole != null) throw new KJValidationError('Geology: incomplete source group hierarchy')
    if (layer.intervalId != null) {
      const id = bounded(layer.intervalId, 'interval id', 64)
      if (intervalIds.has(id)) throw new KJValidationError(`Geology: repeated interval id ${id}`)
      intervalIds.add(id)
    }
    bounded(layer.name, 'stratum name')
    if (layer.stratigraphicNotation != null) {
      if (!layer.stratigraphicNotation || typeof layer.stratigraphicNotation !== 'object' || Array.isArray(layer.stratigraphicNotation) ||
        !['symbol', 'subscript,symbol', 'superscript,symbol', 'subscript,superscript,symbol'].includes(Object.keys(layer.stratigraphicNotation).sort().join(',')))
        throw new KJValidationError('Geology: stratigraphic notation needs an exact symbol/qualifier schema')
      bounded(layer.stratigraphicNotation.symbol, 'stratigraphic notation symbol', 12)
      if (layer.stratigraphicNotation.subscript != null) bounded(layer.stratigraphicNotation.subscript, 'stratigraphic notation subscript', 12)
      if (layer.stratigraphicNotation.superscript != null) bounded(layer.stratigraphicNotation.superscript, 'stratigraphic notation superscript', 12)
    }
    if (layer.description != null) bounded(layer.description, 'stratum description', 512)
    if (layer.descriptionSource != null && (!layer.description || !['interval', 'layer-definition'].includes(layer.descriptionSource))) throw new KJValidationError('Geology: description source requires exact interval or layer-definition provenance')
    const top = numeric(layer.top, 'stratum top'), bottom = numeric(layer.bottom, 'stratum bottom')
    if (Math.abs(top - previous) > 1e-6 || bottom <= top || bottom > hole.depth + 1e-6) throw new KJValidationError(`Geology: gap, overlap or invalid depth at ${code}`)
    if (!Object.hasOwn(pattern, layer.lithology)) throw new KJValidationError(`Geology: undeclared lithology at ${code}`)
    if (layer.patternKey != null) bounded(layer.patternKey, 'pattern key', 96)
    if (layer.patternVisibility != null && layer.patternVisibility !== 'filled' && layer.patternVisibility !== 'boundary-only')
      throw new KJValidationError(`Geology: invalid pattern visibility at ${code}`)
    if (layer.patternLabel != null) bounded(layer.patternLabel, 'pattern lane label', 24)
    if (layer.bottomBoundaryLineVisibility != null) {
      const visibility = layer.bottomBoundaryLineVisibility
      if (!visibility || typeof visibility !== 'object' || Array.isArray(visibility) || Object.keys(visibility).sort().join(',') !== 'depth,pattern' ||
        !['visible', 'hidden'].includes(visibility.depth) || !['visible', 'hidden'].includes(visibility.pattern) ||
        visibility.depth === 'visible' && visibility.pattern === 'visible')
        throw new KJValidationError(`Geology: invalid bottom boundary line visibility at ${code}`)
    }
    previous = bottom
  }
  if (Math.abs(previous - hole.depth) > 1e-6) throw new KJValidationError('Geology: final layer bottom must equal hole depth')
  if (grouped && [...new Set(strata.map(layer => layer.groupId!))].some(groupId => !principals.has(groupId))) throw new KJValidationError('Geology: every major group must include a principal interval')
  if (hole.observations != null) {
    if (!Array.isArray(hole.observations) || hole.observations.length > 256) throw new KJValidationError('Geology: observations require a bounded list')
    const identities = new Set<string>()
    for (const item of hole.observations) {
      if (item.kind !== 'sample' && item.kind !== 'spt') throw new KJValidationError('Geology: unsupported observation kind')
      const id = bounded(item.id, 'observation id', 24), depth = numeric(item.depth, 'observation depth')
      if (item.displayLabel != null) bounded(item.displayLabel, 'observation display label', 24)
      if (item.sampleMarker != null && (item.kind !== 'sample' || item.sampleMarker !== 'filled-circle' && item.sampleMarker !== 'open-circle'))
        throw new KJValidationError('Geology: sample marker must be a declared marker on a sampled observation')
      if (item.measurements != null) {
        if (item.kind !== 'sample' || !item.measurements || typeof item.measurements !== 'object' || Array.isArray(item.measurements) || Object.keys(item.measurements).length > 16) throw new KJValidationError('Geology: bounded measurement values belong to sampled observations only')
        for (const [key, value] of Object.entries(item.measurements)) {
          if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/u.test(key)) throw new KJValidationError('Geology: invalid sampled measurement key')
          numeric(value, `sampled measurement ${key}`)
        }
      }
      if (item.rangeTop != null || item.rangeBottom != null) {
        if (item.kind !== 'sample' || item.rangeTop == null || item.rangeBottom == null) throw new KJValidationError('Geology: sampled ranges require both measured endpoints')
        const rangeTop = numeric(item.rangeTop, 'sample range top'), rangeBottom = numeric(item.rangeBottom, 'sample range bottom')
        if (rangeTop < 0 || rangeBottom > hole.depth || rangeBottom <= rangeTop || rangeBottom - rangeTop > 5 ||
          depth < rangeTop - 1e-6 || depth > rangeBottom + 1e-6)
          throw new KJValidationError('Geology: sampled range is outside its point, hole or bounded interval')
      }
      if (depth < 0 || depth > hole.depth) throw new KJValidationError('Geology: observation depth is outside the hole')
      if (item.kind === 'spt' && (item.value == null || numeric(item.value, 'SPT result') < 0)) throw new KJValidationError('Geology: SPT needs a nonnegative measured result')
      const identity = `${item.kind}:${id}:${depth}`
      if (identities.has(identity)) throw new KJValidationError('Geology: repeated observation identity')
      identities.add(identity)
    }
  }
  const sampleRanges = (hole.observations ?? []).filter(item => item.kind === 'sample' && item.rangeTop != null)
    .sort((a, b) => a.rangeTop! - b.rangeTop!)
  for (let index = 1; index < sampleRanges.length; index++)
    if (sampleRanges[index]!.rangeTop! < sampleRanges[index - 1]!.rangeBottom! - 1e-6)
      throw new KJValidationError('Geology: sampled intervals overlap in one column lane')
  return strata
}

function patternDefinitions(pack: ReadonlyDeep<KJKnowledgePack> | undefined, strata: KJGeologyStratum[]): Record<string, Record<string, unknown>> {
  if (!pack) {
    if (strata.some(layer => layer.patternKey != null)) throw new KJValidationError('Geology: a declared pattern key requires a licensed hatch pack')
    pack = KJDRAW_GEOLOGY_KNOWLEDGE_PACK
  }
  const definitions: Record<string, Record<string, unknown>> = {}
  for (const role of new Set(strata.map(layer => layer.patternKey ?? layer.lithology))) definitions[role] = hatchPatternFromKnowledgePack(pack, role)
  return definitions
}

function drawingBuilder(input: unknown, templateId: string, expectedRevision: number, hatches: Record<string, Record<string, unknown>> = {}) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new KJValidationError('Geology: invalid expected revision')
  const prefix = `geo-${stableHash({ input, templateId })}`
  const linetypeId = `${prefix}-continuous`
  const names = ['GEO_FRAME', 'GEO_BOUNDARY', 'GEO_HATCH', 'GEO_TEXT', 'GEO_GUIDE']
  const layers = names.map((name, index) => ({ id: `${prefix}-layer-${index}`, name, color: [7, 7, 8, 7, 9][index]!, linetypeId, lineweight: [35, 35, 18, 18, 9][index]! }))
  const entities: KJKnowledgeCompileResult['commandArgs']['entities'] = []
  const add = (type: string, layer: number, payload: Record<string, unknown>) => {
    if (entities.length >= 8192) throw new KJValidationError('Geology: entity budget exceeded')
    entities.push({ type, payload: { ...payload, layerId: layers[layer]!.id }, options: { id: `${prefix}-entity-${String(entities.length + 1).padStart(5, '0')}` } })
  }
  const line = (layer: number, x1: number, y1: number, x2: number, y2: number) => add('LINE', layer, { start: [x1, y1, 0], end: [x2, y2, 0] })
  const semanticLine = (layer: number, x1: number, y1: number, x2: number, y2: number, metadata: Record<string, unknown>) => add('LINE', layer, { start: [x1, y1, 0], end: [x2, y2, 0], ...metadata })
  const text = (layer: number, x: number, y: number, value: string, height = 2.6, centered = false, widthFactor?: number, verticalAlignment?: 1 | 2 | 3) => add('TEXT', layer, {
    position: [x, y, 0], text: value, height,
    ...(widthFactor == null ? {} : { widthFactor }),
    ...(centered ? { horizontalAlignment: 1 } : {}), ...(verticalAlignment == null ? {} : { verticalAlignment }),
    ...(centered || verticalAlignment != null ? { alignmentPoint: [x, y, 0] } : {}),
  })
  const placedText = (layer: number, x: number, y: number, value: string, height: number, widthFactor: number,
    horizontalAlignment: 0 | 1 | 2, verticalAlignment: 0 | 2, rotation: number) => add('TEXT', layer, {
    position: [x, y, 0], text: value, height, widthFactor, rotation,
    ...(horizontalAlignment === 0 ? {} : { horizontalAlignment }), ...(verticalAlignment === 0 ? {} : { verticalAlignment }),
    ...(horizontalAlignment !== 0 || verticalAlignment !== 0 ? { alignmentPoint: [x, y, 0] } : {}),
  })
  const mtext = (layer: number, x: number, y: number, value: string, height: number, width: number) => add('MTEXT', layer, {
    position: [x, y, 0], text: value, height, width, attachmentPoint: 1,
  })
  const poly = (layer: number, points: [number, number][], closed = false, constantWidth?: number) => add('LWPOLYLINE', layer, {
    vertices: points.map(([x, y]) => [x, y, 0]), closed, ...(constantWidth == null || constantWidth === 0 ? {} : { constantWidth }),
  })
  const rect = (layer: number, x1: number, y1: number, x2: number, y2: number, constantWidth?: number) =>
    poly(layer, [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], true, constantWidth)
  const circle = (layer: number, x: number, y: number, radius: number) => add('CIRCLE', layer, { center: [x, y, 0], radius })
  const hatch = (points: [number, number][], layer: Pick<KJGeologyStratum, 'lithology' | 'patternKey'>) => add('HATCH', 2, {
    boundaryLoops: [{ external: true, closed: true, vertices: points.map(([x, y]) => [x, y, 0]) }],
    patternName: pattern[layer.lithology], solid: false, patternScale: 0.6, patternAngle: 0,
    ...(hatches[layer.patternKey ?? layer.lithology] ?? {}),
  })
  const finish = (parameters?: Record<string, string | number | boolean>): ReadonlyDeep<KJKnowledgeCompileResult> => deepFreeze({
    commandArgs: { entities, resources: { linetypes: [{ id: linetypeId, name: `GEO_${stableHash(prefix).toUpperCase()}_CONT`, pattern: [] }], layers } },
    evidence: { packId: 'geology.core', packVersion: '1.0.0', packHash: stableHash({ pattern, hatches }), intentHash: stableHash(input), templateId, rootObjectId: prefix, expectedRevision, entityCount: entities.length,
      ...(parameters ? { parameters } : {}) },
  })
  return { line, semanticLine, text, placedText, mtext, poly, rect, circle, hatch, finish }
}

export function compileGeologyColumn(input: KJGeologyColumnInput): ReadonlyDeep<KJKnowledgeCompileResult> {
  const { hole } = input, strata = checkHole(hole)
  const layout = columnLayout(input)
  const { paperHeight: pageHeight, paperWidth: pageWidth, left, right, columns, observationColumns,
    headerDepth, headerRowHeight, fieldHeaderHeight, footerReserve, labels, displayAliases, headerGrid, footerGrid, fieldGrid, sptDisplayCap, titleHeight, textFlow, textHeights,
    stratigraphicNotationStyle, sampleMarkerStyle, sampleRangeBaselineStyle, groundwaterAnnotationStyle, patternLabelStyle, titleMarginFacts, frameStyle, descriptionBoundaryStyle, formTopology,
    layerNumberStyle, sourceTemplate } = layout
  if (strata.some(layer => layer.stratigraphicNotation != null) && !stratigraphicNotationStyle)
    throw new KJValidationError('Geology: stratigraphic notation facts need a declared field-grid notation style')
  if (strata.some(layer => layer.bottomBoundaryLineVisibility != null) && !fieldGrid)
    throw new KJValidationError('Geology: bottom boundary line visibility needs a declared physical field grid')
  const documentFacts = documentFactRecord(input.documentFacts)
  const declaredDocumentFactKeys = new Set([...(headerGrid?.rows.flat().filter((cell): cell is Extract<HeaderCell, { role: 'documentFact' }> => cell.role === 'documentFact').map(cell => cell.key) ?? []),
    ...(footerGrid?.cells.map(cell => cell.key) ?? []), ...(titleMarginFacts?.map(item => item.key) ?? [])])
  for (const key of Object.keys(documentFacts)) if (!declaredDocumentFactKeys.has(key)) throw new KJValidationError(`Geology: document fact ${key} is not declared by the style pack`)
  const gridField = (role: FieldRole) => fieldGrid?.find(field => field.role === role)
  const gridEnd = (field: NonNullable<ColumnLayout['fieldGrid']>[number]): number => fieldGrid?.[fieldGrid.indexOf(field) + 1]?.start ?? right
  const depthX = gridField('depth')?.start ?? columns[0]
  const thicknessX = columns.length === 6 ? columns[1] : null
  const elevationX = columns.length === 6 ? columns[2] : columns[1]
  const codeX = columns.length === 6 ? columns[3] : columns[2]
  const hatchX = columns.length === 6 ? columns[4] : columns[3]
  const descriptionX = gridField('description')?.start ?? columns.at(-1)!
  const top = pageHeight - headerDepth - fieldHeaderHeight
  const availableBodyHeight = top - footerReserve
  const automaticScale = input.verticalScaleDenominator == null
    ? layout.verticalScaleDenominators.find(denominator => hole.depth * 1000 / denominator <= availableBodyHeight + 1e-9)
    : undefined
  if (input.verticalScaleDenominator == null && automaticScale == null)
    throw new KJValidationError('Geology: no declared standard vertical scale fits the borehole on this sheet')
  const verticalScaleDenominator = positive(input.verticalScaleDenominator ?? automaticScale!, 'vertical scale denominator')
  if (input.strictSourceTemplate && (input.verticalScaleDenominator == null || !sourceTemplate || verticalScaleDenominator !== sourceTemplate.verticalScaleDenominator))
    throw new KJValidationError('Geology: explicit vertical scale differs from the source template')
  const scale = 1000 / verticalScaleDenominator
  const bottom = top - hole.depth * scale
  if (scale < 0.1 || scale > 100 || bottom < footerReserve) throw new KJValidationError('Geology: column does not fit the declared physical sheet at this vertical scale')
  const g = drawingBuilder(input, 'borehole-column-engineering', input.expectedRevision, patternDefinitions(input.hatchPack, strata))
  const finishColumn = (): ReadonlyDeep<KJKnowledgeCompileResult> => g.finish({
    verticalScaleDenominator,
    verticalScaleSource: input.verticalScaleDenominator == null ? 'style-standard' : 'explicit',
    ...(sourceTemplate ? { sourceTemplateSha256: sourceTemplate.sourceSha256, sourceGridWidthMillimeters: sourceTemplate.innerGridWidthMillimeters } : {}),
    stratumCount: strata.length,
    lithologyCount: new Set(strata.map(layer => layer.patternKey ?? layer.lithology)).size,
  })
  const observations = hole.observations ?? []
  if (observations.some(item => item.sampleMarker != null) && !sampleMarkerStyle)
    throw new KJValidationError('Geology: sample marker facts need a declared field-grid marker style')
  if (hole.groundwaterObservations?.length && !groundwaterAnnotationStyle)
    throw new KJValidationError('Geology: groundwater observation facts need a declared field-grid annotation style')
  if (strata.some(layer => layer.patternLabel != null) && !patternLabelStyle)
    throw new KJValidationError('Geology: pattern label facts need a declared field-grid label style')
  if (fieldGrid && observations.some(item => item.kind === 'sample' && !gridField('sample') || item.kind === 'spt' && !gridField('spt')))
    throw new KJValidationError('Geology: field grid has no physical field for supplied observations')
  if (observations.length && strata.some(layer => layer.description) && !observationColumns && !fieldGrid) throw new KJValidationError('Geology: supplied descriptions and depth-aligned observations need separate declared columns')
  if (observations.length && !observationColumns && !fieldGrid && right - descriptionX < 42) throw new KJValidationError('Geology: style observation columns must have at least 42 mm total width')
  const sampleX = gridField('sample')?.start ?? observationColumns?.[0] ?? descriptionX
  const sptX = gridField('spt')?.start ?? observationColumns?.[1] ?? descriptionX + 22
  const descriptionRight = gridField('description') ? gridEnd(gridField('description')!) : observationColumns?.[0] ?? right
  const writeDescription = (description: string, yTop: number, bandHeight: number, identity: string): void => {
    const width = descriptionRight - descriptionX - 4
    for (const height of [2.5, 2.3, 2.1, 1.9, 1.7, 1.5]) {
      const layout = layoutCadMText({ position: [descriptionX + 2, yTop - 0.3, 0],
        text: description.trim(), height, width, attachmentPoint: 1 })
      const occupied = height + (layout.lines.length - 1) * layout.lineAdvance
      if (occupied <= bandHeight - 0.6) {
        g.mtext(3, descriptionX + 2, yTop - 0.3, description.trim(), height, width)
        return
      }
    }
    throw new KJValidationError(`Geology: ${identity} description does not fit readably in its declared band`)
  }
  const definitionAnchors = new Map<string, KJGeologyStratum>()
  for (const layer of strata) if (layer.descriptionSource === 'layer-definition' && layer.description) {
    const identity = `${layer.code}\u0000${layer.description}`
    const prior = definitionAnchors.get(identity)
    if (!prior || layer.bottom - layer.top > prior.bottom - prior.top) definitionAnchors.set(identity, layer)
  }
  const grouped = strata[0]!.groupId != null
  const groups: { id: string; top: number; bottom: number; principal: KJGeologyStratum; intervals: KJGeologyStratum[] }[] = []
  if (grouped) for (const layer of strata) {
    const prior = groups.at(-1)
    if (prior && prior.id === layer.groupId) { prior.bottom = layer.bottom; prior.intervals.push(layer) }
    else groups.push({ id: layer.groupId!, top: layer.top, bottom: layer.bottom, principal: layer, intervals: [layer] })
  }
  for (const group of groups) group.principal = group.intervals.find(layer => layer.groupRole === 'principal')!
  const depthLabelY = new Map<KJGeologyStratum, number>()
  if (grouped) {
    const pitch = 2.3, highest = top - 2, lowest = bottom + 0.4
    const anchors = strata.map(layer => top - layer.bottom * scale + 0.4)
    const visible: number[] = []
    for (const anchor of anchors) visible.push(Math.min(anchor, visible.length ? visible.at(-1)! - pitch : highest))
    const shift = Math.max(0, lowest - visible.at(-1)!)
    for (const [index, layer] of strata.entries()) {
      const value = visible[index]! + shift
      if (value > highest + 1e-9 || Math.abs(value - anchors[index]!) > 7.6)
        throw new KJValidationError(`Geology: layer ${layer.code} depth labels cannot be separated readably at this scale`)
      depthLabelY.set(layer, value)
    }
  }
  const locale = geologyLocale(input)
  const formalFrame = Boolean(fieldGrid)
  const frameBottom = frameStyle?.bottomMargin ?? 5
  const frameTop = pageHeight - (frameStyle?.topMargin ?? (formalFrame ? 15 : 5))
  g.rect(0, formalFrame ? left : 5, frameBottom, formalFrame ? right : pageWidth - 5, frameTop, frameStyle?.constantWidth)
  const formSeparators = new Set<string>()
  const formSeparator = (y: number): void => {
    const key = y.toFixed(9)
    if (formSeparators.has(key)) return
    formSeparators.add(key)
    g.line(0, left, y, right, y)
  }
  let titleRegionBottom = pageHeight - headerDepth
  if (headerGrid) {
    const facts: Record<HeaderRole, string | undefined> = {
      projectName: input.projectName ? bounded(input.projectName, 'project name', 96) : undefined,
      holeId: hole.id, collarElevation: metres(hole.collarElevation), depth: metres(hole.depth),
      x: hole.x == null ? undefined : metres(hole.x), y: hole.y == null ? undefined : metres(hole.y),
      startDate: hole.startDate, endDate: hole.endDate,
      initialWaterDepth: hole.initialWaterDepth == null ? undefined : metres(hole.initialWaterDepth),
      stableWaterDepth: hole.stableWaterDepth == null ? undefined : metres(hole.stableWaterDepth),
      verticalScale: `1:${scaleDenominator(verticalScaleDenominator)}`,
    }
    const headerBottom = pageHeight - headerDepth
    const rowHeight = headerRowHeight
    const headerTop = headerBottom + rowHeight * headerGrid.rows.length
    titleRegionBottom = headerTop
    if (headerTop + (titleHeight ?? 5) + 1 > frameTop) throw new KJValidationError('Geology: declared title does not fit between the header and drawing frame')
    const titleY = headerTop + (frameTop - headerTop - (titleHeight ?? 5)) / 2
    g.text(3, pageWidth / 2, titleY, bounded(input.title ?? (locale === 'zh-CN' ? '钻孔柱状图' : 'BOREHOLE LOG'), 'title'), titleHeight ?? 5, true)
    if (formTopology) { formSeparator(headerBottom); formSeparator(headerTop) }
    else g.rect(0, left, headerBottom, right, headerTop)
    const headerVerticals: { x: number; bottom: number; top: number }[] = []
    for (const [rowIndex, row] of headerGrid.rows.entries()) {
      const rowTop = headerTop - rowIndex * rowHeight, rowBottom = rowTop - rowHeight
      if (rowIndex) g.line(0, left, rowTop, right, rowTop)
      const equalWidth = (right - left) / row.length
      for (const [cellIndex, cell] of row.entries()) {
        const cellLeft = cell.start ?? left + cellIndex * equalWidth
        const cellRight = row[cellIndex + 1]?.start ?? right
        const width = cellRight - cellLeft
        const valueX = cell.valueStart ?? cellLeft + Math.min(25, width * 0.35)
        if (cellIndex) headerVerticals.push({ x: cellLeft, bottom: rowBottom, top: rowTop })
        headerVerticals.push({ x: valueX, bottom: rowBottom, top: rowTop })
        const identity = cell.role === 'documentFact' ? cell.key : cell.role
        const value = cell.role === 'documentFact' ? documentFacts[cell.key] : facts[cell.role]
        if (value == null && !cell.optional) throw new KJValidationError(`Geology: declared header fact ${identity} is missing; refusing to invent a value`)
        const visibleValue = value ?? ''
        const headerFactHeight = textHeights?.headerFact ?? 2.2
        const estimated = (text: string): number => [...text].reduce((sum, character) =>
          sum + (/^[\x20-\x7e]$/u.test(character) ? headerFactHeight * 0.52 : headerFactHeight * 0.95), 0)
        if (estimated(cell.label) > valueX - cellLeft - 3 || estimated(visibleValue) > cellLeft + width - valueX - 3)
          throw new KJValidationError(`Geology: header fact ${identity} does not fit the declared cell`)
        g.text(3, cellLeft + 2, rowTop - rowHeight * 0.69, cell.label, headerFactHeight)
        if (visibleValue) g.text(3, valueX + 2, rowTop - rowHeight * 0.69, visibleValue, headerFactHeight)
      }
    }
    const continuousDividers = headerGrid.continuousDividers ?? []
    const ordinaryHeaderVerticals = headerVerticals.filter(segment =>
      !continuousDividers.some(divider => Math.abs(divider - segment.x) < 1e-9))
    if (formTopology) {
      const ordered = ordinaryHeaderVerticals.sort((a, b) => a.x - b.x || a.bottom - b.bottom || a.top - b.top)
      let active: typeof ordered[number] | undefined
      for (const segment of ordered) {
        if (active && Math.abs(active.x - segment.x) < 1e-9 && segment.bottom <= active.top + 1e-9)
          active.top = Math.max(active.top, segment.top)
        else {
          if (active) g.line(0, active.x, active.bottom, active.x, active.top)
          active = { ...segment }
        }
      }
      if (active) g.line(0, active.x, active.bottom, active.x, active.top)
    } else for (const segment of ordinaryHeaderVerticals) g.line(0, segment.x, segment.bottom, segment.x, segment.top)
    for (const divider of continuousDividers) g.line(0, divider, headerBottom, divider, headerTop)
  } else {
    g.text(3, pageWidth / 2, pageHeight - 18, bounded(input.title ?? (locale === 'zh-CN' ? '工程地质钻孔柱状图' : 'ENGINEERING BOREHOLE LOG'), 'title'), titleHeight ?? 5, true)
    if (input.projectName) g.text(3, left + 2, pageHeight - 27, `${labels.project} ${bounded(input.projectName, 'project name', 96)}`, 2.5)
    g.text(3, left + 2, pageHeight - 36, `${labels.hole} ${hole.id}   ${labels.collar} ${metres(hole.collarElevation)} m   ${labels.depth} ${metres(hole.depth)} m`, 3)
    const location = [hole.x != null ? `${labels.x} ${metres(hole.x)}` : '', hole.y != null ? `${labels.y} ${metres(hole.y)}` : '',
      hole.startDate ? `${labels.startDate} ${hole.startDate}` : '', hole.endDate ? `${labels.endDate} ${hole.endDate}` : ''].filter(Boolean).join('   ')
    if (location) g.text(3, left + 2, pageHeight - 43, location, 2.3)
    g.text(3, left + 2, pageHeight - 50, `${labels.verticalScale} 1:${scaleDenominator(verticalScaleDenominator)}   ${labels.datum}`, 2.6)
  }
  if (titleMarginFacts) {
    const occupied: { left: number; right: number; bottom: number; top: number }[] = []
    for (const placement of titleMarginFacts) {
      const fact = documentFacts[placement.key]
      if (fact == null) continue
      const value = `${placement.label}${placement.separator}${fact}`
      const x = (placement.anchor === 'left' ? 0 : placement.anchor === 'center' ? pageWidth / 2 : pageWidth) + placement.offset[0]
      const y = pageHeight + placement.offset[1]
      const width = [...value].reduce((sum, character) => sum +
        (/^[\x20-\x7e]$/u.test(character) ? placement.height * 0.64 : placement.height), 0) * placement.textWidthFactor
      const baseLeft = placement.horizontalAlignment === 'left' ? x : placement.horizontalAlignment === 'center' ? x - width / 2 : x - width
      const baseBottom = placement.verticalAlignment === 'baseline' ? y : y - placement.height / 2
      const radians = placement.rotationDegrees * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians)
      const points = [[baseLeft, baseBottom], [baseLeft + width, baseBottom], [baseLeft + width, baseBottom + placement.height], [baseLeft, baseBottom + placement.height]]
        .map(([pointX, pointY]) => [x + (pointX! - x) * cosine - (pointY! - y) * sine,
          y + (pointX! - x) * sine + (pointY! - y) * cosine] as const)
      const bounds = { left: Math.min(...points.map(point => point[0])), right: Math.max(...points.map(point => point[0])),
        bottom: Math.min(...points.map(point => point[1])), top: Math.max(...points.map(point => point[1])) }
      if (bounds.left < (formalFrame ? left : 5) + 0.5 || bounds.right > (formalFrame ? right : pageWidth - 5) - 0.5 ||
        bounds.bottom < titleRegionBottom + 0.5 || bounds.top > frameTop - 0.5)
        throw new KJValidationError(`Geology: title margin fact ${placement.key} crosses the title band or drawing frame`)
      if (occupied.some(prior => bounds.left < prior.right && bounds.right > prior.left && bounds.bottom < prior.top && bounds.top > prior.bottom))
        throw new KJValidationError(`Geology: title margin fact ${placement.key} overlaps another title margin fact`)
      occupied.push(bounds)
      if (placement.decoration) {
        const elbowX = x + placement.decoration.elbowOffset[0], elbowY = y + placement.decoration.elbowOffset[1]
        if (elbowX < (formalFrame ? left : 5) + 0.5 || elbowX >= bounds.left - 0.2 ||
          elbowY < titleRegionBottom + 0.5 || elbowY >= bounds.bottom - 0.2 || elbowY >= frameTop - 0.5)
          throw new KJValidationError(`Geology: title margin fact ${placement.key} decoration crosses its text or drawing frame`)
        g.poly(0, [[elbowX, frameTop], [elbowX, elbowY], [right, elbowY]], false)
      }
      g.placedText(3, x, y, value, placement.height, placement.textWidthFactor,
        placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2,
        placement.verticalAlignment === 'baseline' ? 0 : 2, radians)
    }
  }
  const renderLegend = (): void => {
    const distinct = [...new Map(strata.map(layer => [layer.patternKey ?? layer.lithology, layer])).values()]
    const columnsPerRow = Math.min(4, distinct.length), rows = Math.ceil(distinct.length / columnsPerRow)
    const rowPitch = 10, requiredHeight = rows * rowPitch + 11
    if (requiredHeight > Math.min(bottom - 2, footerReserve - 2))
      throw new KJValidationError('Geology: footer legend does not fit the declared sheet; use a larger footer or a field-grid style')
    const legendY = Math.min(bottom - 3, footerReserve - 3)
    g.text(3, left, legendY, labels.legend!, 2.8)
    const cellWidth = (right - left) / columnsPerRow
    for (const [index, layer] of distinct.entries()) {
      const column = index % columnsPerRow, row = Math.floor(index / columnsPerRow)
      const x = left + column * cellWidth, y = legendY - 5 - row * rowPitch
      g.rect(0, x, y - 7, x + 8, y - 1)
      g.hatch([[x, y - 7], [x + 8, y - 7], [x + 8, y - 1], [x, y - 1]], layer)
      g.text(3, x + 9, y - 5.7, layer.patternKey ? displayAliases?.names[layer.name] ?? layer.name : labels[layer.lithology]!, 1.8)
    }
    g.text(3, left, Math.max(2.5, legendY - 7 - rows * rowPitch), labels.footer!, 2.2)
  }
  const renderFooterGrid = (): void => {
    if (!footerGrid) return
    const bottom = frameBottom, top = bottom + footerGrid.height
    if (formTopology) formSeparator(top)
    else g.rect(0, left, bottom, right, top)
    for (const [index, cell] of footerGrid.cells.entries()) {
      const end = footerGrid.cells[index + 1]?.start ?? right
      if (index) g.line(0, cell.start, bottom, cell.start, top)
      if (cell.internalDivider != null) g.line(0, cell.internalDivider, bottom, cell.internalDivider, top)
      const width = end - cell.start
      const labelHeight = width < 25 ? 1.4 : 1.55
      g.text(3, cell.start + width / 2, top - labelHeight - 1, cell.label, labelHeight, true)
      const value = documentFacts[cell.key]
      if (value) {
        const valueHeight = width < 25 ? 1.3 : 1.45
        const estimated = [...value].reduce((sum, character) => sum + (/^[\x20-\x7e]$/u.test(character) ? valueHeight * 0.64 : valueHeight), 0)
        if (estimated > width - 2) throw new KJValidationError(`Geology: footer fact ${cell.key} does not fit its declared cell`)
        g.text(3, cell.start + width / 2, bottom + 1.2, value, valueHeight, true)
      }
    }
  }
  if (fieldGrid) {
    const field = (role: FieldRole) => fieldGrid.find(item => item.role === role)!
    const fieldWidth = (item: typeof fieldGrid[number]) => gridEnd(item) - item.start
    const estimatedWidth = (value: string, height: number) => [...value].reduce((sum, character) =>
      sum + (/^[\x20-\x7e]$/u.test(character) ? height * 0.64 : height), 0)
    const bandLines: { x1: number; x2: number; y: number; continuity?: 'continuous' }[] = []
    const majorBoundaries: { y: number }[] = []
    const descriptionTops = new Map<number, number>()
    const textBoxes: { role: FieldRole; left: number; right: number; bottom: number; top: number }[] = []
    const emitFieldText = (item: typeof fieldGrid[number], y: number, value: string, height = 1.8): void => {
      const width = estimatedWidth(value, height) * (item.textWidthFactor ?? 1)
      if (width > fieldWidth(item) - 2.4) throw new KJValidationError(`Geology: ${item.role} text does not fit its declared field`)
      const centered = item.role !== 'description'
      const x = centered ? item.start + fieldWidth(item) / 2 : item.start + 1.2
      g.text(3, x, y, value, height, centered, item.textWidthFactor)
      textBoxes.push({ role: item.role, left: x - (centered ? width / 2 : 0) - 0.25,
        right: x + (centered ? width / 2 : width) + 0.25, bottom: y - 0.25, top: y + height + 0.25 })
    }
    const emitSampleText = (item: typeof fieldGrid[number], y: number, value: string,
      marker: NonNullable<KJGeologyObservation['sampleMarker']>, height: number): void => {
      const style = sampleMarkerStyle!, factor = item.textWidthFactor ?? 1
      const glyph = marker === 'filled-circle' ? '●' : '○'
      const labelWidth = estimatedWidth(value, height) * factor
      const markerWidth = estimatedWidth(glyph, style.height) * factor
      const width = labelWidth + style.gap + markerWidth
      if (width > fieldWidth(item) - 2.4) throw new KJValidationError('Geology: sampled marker and label do not fit their declared field')
      const start = item.start + (fieldWidth(item) - width) / 2
      const labelX = start + labelWidth / 2, markerX = start + labelWidth + style.gap + markerWidth / 2
      g.text(3, labelX, y, value, height, true, item.textWidthFactor)
      g.text(3, markerX, y + style.baselineOffset, glyph, style.height, true, item.textWidthFactor)
      textBoxes.push({ role: item.role, left: start - 0.25, right: start + labelWidth + 0.25,
        bottom: y - 0.25, top: y + height + 0.25 },
      { role: item.role, left: markerX - markerWidth / 2 - 0.25, right: markerX + markerWidth / 2 + 0.25,
        bottom: y + style.baselineOffset - 0.25, top: y + style.baselineOffset + style.height + 0.25 })
    }
    const emitGroundwaterAnnotation = (item: typeof fieldGrid[number], y: number,
      observation: KJGeologyGroundwaterObservation): void => {
      const style = groundwaterAnnotationStyle!
      const depthText = metres(observation.depth), elevationText = metres(observation.elevation)
      const depthWidth = estimatedWidth(depthText, style.textHeight) * style.textWidthFactor
      const elevationWidth = estimatedWidth(elevationText, style.textHeight) * style.textWidthFactor
      const valuesWidth = depthWidth + style.gap + elevationWidth
      const marker = '▼', markerWidth = estimatedWidth(marker, style.markerHeight) * style.textWidthFactor
      const dateWidth = estimatedWidth(observation.observedOn, style.textHeight) * style.textWidthFactor
      if (Math.max(valuesWidth, markerWidth, dateWidth) > fieldWidth(item) - 2.4)
        throw new KJValidationError('Geology: groundwater annotation does not fit its declared field')
      const center = item.start + fieldWidth(item) / 2, valuesStart = center - valuesWidth / 2
      const depthX = valuesStart + depthWidth / 2
      const elevationX = valuesStart + depthWidth + style.gap + elevationWidth / 2
      const valueY = y + style.valueOffset, markerY = y + style.markerOffset, dateY = y + style.dateOffset
      const boxes = [
        { role: item.role, left: valuesStart - 0.25, right: valuesStart + valuesWidth + 0.25,
          bottom: valueY - 0.25, top: valueY + style.textHeight + 0.25 },
        { role: item.role, left: center - markerWidth / 2 - 0.25, right: center + markerWidth / 2 + 0.25,
          bottom: markerY - 0.25, top: markerY + style.markerHeight + 0.25 },
        { role: item.role, left: center - dateWidth / 2 - 0.25, right: center + dateWidth / 2 + 0.25,
          bottom: dateY - 0.25, top: dateY + style.textHeight + 0.25 },
      ]
      if (boxes.some(box => box.bottom < bottom + 0.4 || box.top > top - 0.2) || boxes.some(box => textBoxes.some(prior => prior.role === item.role &&
        box.left < prior.right && box.right > prior.left && box.bottom < prior.top && box.top > prior.bottom)))
        throw new KJValidationError('Geology: groundwater annotation collides with its source lane or body boundary')
      if (style.guide === 'field-top-to-reading')
        g.poly(1, [[item.start, top], [item.start, y], [gridEnd(item), y]], false)
      g.text(3, depthX, valueY, depthText, style.textHeight, true, style.textWidthFactor)
      g.text(3, elevationX, valueY, elevationText, style.textHeight, true, style.textWidthFactor)
      g.text(3, center, markerY, marker, style.markerHeight, true, style.textWidthFactor)
      g.text(3, center, dateY, observation.observedOn, style.textHeight, true, style.textWidthFactor)
      textBoxes.push(...boxes)
    }
    const emitLayerNumber = (item: typeof fieldGrid[number], y: number, value: string, bandHeight: number): void => {
      if (layerNumberStyle !== 'circle') return emitFieldText(item, y, value, Math.min(2.1, Math.max(1.4, bandHeight * 0.38)))
      const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.indexOf(value)
      const visible = circled >= 0 ? String(circled + 1) : /^\d{1,2}$/u.test(value) ? value : undefined
      if (!visible) return emitFieldText(item, y, value, Math.min(2.1, Math.max(1.4, bandHeight * 0.38)))
      const radius = Math.min(1.9, fieldWidth(item) / 2 - 1, bandHeight / 2 - 0.5)
      if (radius < 1) throw new KJValidationError('Geology: circled layer number does not fit its declared band')
      const x = item.start + fieldWidth(item) / 2, height = Math.min(1.8, radius * 0.95)
      g.circle(0, x, y, radius)
      g.text(3, x, y - height * 0.34, visible, height, true)
      textBoxes.push({ role: item.role, left: x - radius - 0.2, right: x + radius + 0.2,
        bottom: y - radius - 0.2, top: y + radius + 0.2 })
    }
    const emitLayerName = (item: typeof fieldGrid[number], layer: KJGeologyStratum, yTop: number, yBottom: number,
      y: number, value: string, height: number): void => {
      const notation = layer.stratigraphicNotation
      if (!notation) return emitFieldText(item, y, value, height)
      const style = stratigraphicNotationStyle!
      const nameHeight = Math.min(height, yTop - yBottom - style.symbolHeight - 1)
      if (nameHeight < 1.2) throw new KJValidationError(`Geology: stratigraphic notation for ${layer.code} does not fit its declared band`)
      emitFieldText(item, yTop - nameHeight - 0.2, value, nameHeight)
      const factor = item.textWidthFactor ?? 1
      const symbolWidth = estimatedWidth(notation.symbol, style.symbolHeight) * factor
      const qualifierWidth = Math.max(...[notation.subscript, notation.superscript].filter((part): part is string => part != null)
        .map(part => estimatedWidth(part, style.qualifierHeight) * factor), 0)
      const qualifierGap = qualifierWidth ? 0.3 : 0
      const width = symbolWidth + qualifierGap + qualifierWidth
      if (width > fieldWidth(item) - 2.4) throw new KJValidationError(`Geology: stratigraphic notation for ${layer.code} does not fit its declared field`)
      const start = item.start + (fieldWidth(item) - width) / 2, symbolX = start + symbolWidth / 2
      const symbolY = yBottom + 0.5
      g.text(3, symbolX, symbolY, notation.symbol, style.symbolHeight, true, item.textWidthFactor)
      textBoxes.push({ role: item.role, left: start - 0.25, right: start + symbolWidth + 0.25,
        bottom: symbolY - 0.25, top: symbolY + style.symbolHeight + 0.25 })
      const qualifierX = start + symbolWidth + qualifierGap
      if (notation.subscript) {
        const qualifierY = symbolY - style.qualifierHeight * 0.3
        g.text(3, qualifierX, qualifierY, notation.subscript, style.qualifierHeight, false, item.textWidthFactor)
        textBoxes.push({ role: item.role, left: qualifierX - 0.25, right: qualifierX + qualifierWidth + 0.25,
          bottom: qualifierY - 0.25, top: qualifierY + style.qualifierHeight + 0.25 })
      }
      if (notation.superscript) {
        const qualifierY = symbolY + style.symbolHeight - style.qualifierHeight
        g.text(3, qualifierX, qualifierY, notation.superscript, style.qualifierHeight, false, item.textWidthFactor)
        textBoxes.push({ role: item.role, left: qualifierX - 0.25, right: qualifierX + qualifierWidth + 0.25,
          bottom: qualifierY - 0.25, top: qualifierY + style.qualifierHeight + 0.25 })
      }
    }
    let previousDescriptionBottom: number | undefined, previousLabelY: number | undefined, renderedCoreCount = 0
    const firstGroupBottom = (grouped ? groups[0]!.bottom : strata[0]!.bottom)
    const nextGroupBottom = grouped ? groups[1]?.bottom : strata[1]?.bottom
    const writeGridDescription = (description: string, yTop: number, yBottom: number, coreIndex: number, identity: string): void => {
      if (!textFlow) return writeDescription(description, yTop, yTop - yBottom, identity)
      const width = descriptionRight - descriptionX - 4
      for (const height of [2.5, 2.3, 2.1, 1.9, 1.7, 1.5]) {
        const anchorY = Math.min(yTop - 0.3, previousDescriptionBottom == null ? yTop - 0.3 : previousDescriptionBottom - textFlow.paragraphGapMm)
        const paragraph = layoutCadMText({ position: [descriptionX + 2, anchorY, 0], text: description.trim(), height, width, attachmentPoint: 1 })
        const occupied = height + (paragraph.lines.length - 1) * paragraph.lineAdvance
        const lowest = coreIndex === 0 ? Math.max(yBottom - textFlow.firstGroupBorrowMm,
          nextGroupBottom == null ? yBottom : top - nextGroupBottom * scale + 0.4) : yBottom + 0.4
        if (anchorY - occupied >= lowest) {
          g.mtext(3, descriptionX + 2, anchorY, description.trim(), height, width)
          descriptionTops.set(coreIndex, anchorY)
          previousDescriptionBottom = anchorY - occupied
          return
        }
      }
      throw new KJValidationError(`Geology: ${identity} description collides with another text lane or exceeds source-declared borrow`)
    }
    // The physical form occupies its declared sheet bay even when the measured
    // borehole is shallower than that bay.  Strata remain exactly depth-scaled;
    // only the reusable form grid continues to the footer reserve.
    const formBottom = footerReserve
    if (formTopology) { formSeparator(formBottom); formSeparator(pageHeight - headerDepth) }
    else g.rect(0, left, formBottom, right, pageHeight - headerDepth)
    for (const item of fieldGrid) {
      if (item.start !== left) g.line(0, item.start, formBottom, item.start, pageHeight - headerDepth)
      const centerX = item.start + fieldWidth(item) / 2
      if (item.subLabel) {
        const subLabel = item.subLabel.replaceAll('{verticalScale}', scaleDenominator(verticalScaleDenominator))
        g.text(3, centerX, pageHeight - headerDepth - fieldHeaderHeight * 0.42, item.label, textHeights?.fieldHeader ?? 1.8, true, item.textWidthFactor)
        g.text(3, centerX, pageHeight - headerDepth - fieldHeaderHeight * 0.78, subLabel, textHeights?.fieldSubHeader ?? 1.6, true, item.textWidthFactor)
      } else g.text(3, centerX, pageHeight - headerDepth - fieldHeaderHeight * 0.62, item.label, textHeights?.fieldHeader ?? 1.8, true, item.textWidthFactor)
    }
    if (formTopology) formSeparator(top)
    else g.line(0, left, top, right, top)
    const patternField = field('pattern'), depthField = field('depth')
    const writeCore = (id: string, groupTop: number, groupBottom: number, principal: KJGeologyStratum): void => {
      const yTop = top - groupTop * scale, yBottom = top - groupBottom * scale
      const coreIndex = renderedCoreCount++
      const mid = (yTop + yBottom) / 2
      let labelY = yTop - Math.max(1.8, (yTop - yBottom) / 2)
      let labelHeight = textHeights?.majorValue ?? 2.1
      if (textHeights) labelY = Math.min(labelY, yTop - labelHeight - 0.2)
      if (textFlow && coreIndex < 2) {
        labelHeight = textFlow.labelHeightMm
        labelY = Math.min(yTop - textFlow.firstBaselineMm,
          previousLabelY == null ? yTop - textFlow.firstBaselineMm : previousLabelY - textFlow.labelPitchMm)
      }
      const lowest = textFlow && coreIndex === 0 ? Math.max(yBottom - textFlow.firstGroupBorrowMm,
        nextGroupBottom == null ? yBottom : top - nextGroupBottom * scale + 0.4) : yBottom + 0.4
      if (labelY < lowest || labelY + labelHeight > yTop - 0.2 ||
        previousLabelY != null && previousLabelY - labelY < labelHeight + 0.5)
        throw new KJValidationError(`Geology: group ${id} core labels collide with a boundary or another text lane`)
      previousLabelY = labelY
      const values: Partial<Record<FieldRole, string>> = {
        layerNumber: displayAliases?.codes[principal.code] ?? id,
        layerName: displayAliases?.names[principal.name] ?? principal.name,
        baseElevation: metres(hole.collarElevation - groupBottom), thickness: metres(groupBottom - groupTop),
      }
      const valueY = textFlow && coreIndex < 2 ? labelY : yTop - yBottom < 2 ? labelY : mid
      const numberBandHeight = textFlow && coreIndex === 0
        ? Math.max(yTop - yBottom, textFlow.firstBaselineMm + textFlow.labelHeightMm + 1)
        : yTop - yBottom
      emitLayerNumber(field('layerNumber'), valueY, values.layerNumber!, numberBandHeight)
      emitLayerName(field('layerName'), principal, yTop, yBottom, valueY, values.layerName!, labelHeight)
      for (const role of ['baseElevation', 'thickness'] as const) emitFieldText(field(role), valueY, values[role]!, labelHeight)
      if (principal.description && (grouped || principal.descriptionSource !== 'layer-definition' ||
        definitionAnchors.get(`${principal.code}\u0000${principal.description}`) === principal))
        writeGridDescription(principal.description, yTop, yBottom, coreIndex, `major group ${id}`)
    }
    for (const layer of strata) {
      const yTop = top - layer.top * scale, yBottom = top - layer.bottom * scale
      if (yTop - yBottom < (grouped ? 0.4 : 1.4)) throw new KJValidationError(`Geology: layer ${layer.code} is too thin for readable geometry at this scale`)
      const major = !grouped || groups.some(group => Math.abs(group.bottom - layer.bottom) < 1e-6)
      const fieldBoundary = layer.bottomBoundaryLineVisibility
      const independentBoundaryFields = !major || textFlow?.firstGroupUnruled && Math.abs(layer.bottom - firstGroupBottom) < 1e-6
      if (fieldBoundary && !independentBoundaryFields)
        throw new KJValidationError(`Geology: layer ${layer.code} bottom boundary is not independently rendered by field`)
      if (major && descriptionBoundaryStyle) majorBoundaries.push({ y: yBottom })
      else if (major && !(textFlow?.firstGroupUnruled && Math.abs(layer.bottom - firstGroupBottom) < 1e-6))
        bandLines.push({ x1: left, x2: right, y: yBottom })
      else if (major) for (const role of ['depth', 'pattern'] as const) {
        if (fieldBoundary?.[role] === 'hidden') continue
        const item = field(role)
        bandLines.push({ x1: item.start, x2: gridEnd(item), y: yBottom })
      }
      else for (const role of ['depth', 'pattern'] as const) {
        if (fieldBoundary?.[role] === 'hidden') continue
        const item = field(role)
        bandLines.push({ x1: item.start, x2: gridEnd(item), y: yBottom })
      }
      if (layer.patternVisibility !== 'boundary-only') {
        const patternCell: [number, number][] = [[patternField.start, yBottom], [gridEnd(patternField), yBottom],
          [gridEnd(patternField), yTop], [patternField.start, yTop]]
        if (formTopology) g.poly(1, patternCell, true)
        g.hatch(patternCell, layer)
      }
      if (layer.patternLabel) {
        const style = patternLabelStyle!, bandHeight = yTop - yBottom
        const width = estimatedWidth(layer.patternLabel, style.height) * style.textWidthFactor
        if (bandHeight + 1e-9 < style.minimumBandHeight || width > fieldWidth(patternField) - 2.4)
          throw new KJValidationError(`Geology: pattern label for ${layer.code} does not fit its declared interval`)
        const x = patternField.start + fieldWidth(patternField) / 2, y = (yTop + yBottom) / 2
        g.text(3, x, y, layer.patternLabel, style.height, true, style.textWidthFactor, 2)
        textBoxes.push({ role: 'pattern', left: x - width / 2, right: x + width / 2,
          bottom: y - style.height / 2 + 0.1, top: y + style.height / 2 - 0.1 })
      }
      const depthY = depthLabelY.get(layer) ?? yBottom + 0.4
      if (Math.abs(depthY - (yBottom + 0.4)) > 0.6) g.line(1, gridEnd(depthField) - 5, yBottom, gridEnd(depthField) - 1, depthY)
      const intervalDepthHeight = textHeights?.intervalDepth ?? (grouped ? 1.5 : Math.min(2.1, (yTop - yBottom) * 0.55))
      if (textHeights && intervalDepthHeight > yTop - yBottom - 0.4) throw new KJValidationError(`Geology: layer ${layer.code} depth text does not fit its declared band`)
      emitFieldText(depthField, depthY, metres(layer.bottom), intervalDepthHeight)
      if (!grouped) writeCore(layer.code, layer.top, layer.bottom, layer)
    }
    if (grouped) for (const group of groups) writeCore(group.id, group.top, group.bottom, group.principal)
    if (descriptionBoundaryStyle) {
      const descriptionField = field('description'), descriptionEnd = gridEnd(descriptionField)
      for (const [index, boundary] of majorBoundaries.entries()) {
        const nextDescriptionTop = descriptionTops.get(index + 1)
        const descriptionY = nextDescriptionTop == null ? boundary.y : Math.min(boundary.y, nextDescriptionTop + descriptionBoundaryStyle.clearance)
        if (descriptionY < bottom - 1e-9 || descriptionY > boundary.y + 1e-9)
          throw new KJValidationError('Geology: stepped description boundary exceeds the declared body')
        g.poly(1, [[left, boundary.y], [descriptionField.start, boundary.y],
          [descriptionField.start + descriptionBoundaryStyle.inset, descriptionY],
          [descriptionEnd - descriptionBoundaryStyle.inset, descriptionY], [descriptionEnd, boundary.y], [right, boundary.y]])
      }
    }
    for (const item of observations) {
      const y = top - item.depth * scale
      if (item.kind === 'spt' && sptDisplayCap != null && item.displayLabel != null) throw new KJValidationError('Geology: SPT display cap cannot coexist with a caller-provided display label')
      for (const cell of fieldGrid) {
        let value: string | undefined
        if (cell.role === 'sample' && item.kind === 'sample') value = item.displayLabel ?? item.id
        if (cell.role === 'spt' && item.kind === 'spt') {
          const shown = sptDisplayCap == null ? item.value! : Math.min(item.value!, sptDisplayCap)
          value = item.displayLabel ?? `N=${Number.isInteger(shown) ? shown.toString() : metres(shown)}`
        }
        if (cell.role === 'measurement' && item.kind === 'sample' && Object.hasOwn(item.measurements ?? {}, cell.key!))
          value = item.measurements![cell.key!]!.toFixed(cell.decimals ?? 2)
        if (value != null) {
          const height = textHeights?.observation ?? 1.5
          if (cell.role === 'sample' && item.kind === 'sample' && item.sampleMarker)
            emitSampleText(cell, y, value, item.sampleMarker, height)
          else emitFieldText(cell, y, value, height)
        }
        if (cell.role === 'sample' && item.kind === 'sample' && item.rangeTop != null && item.rangeBottom != null) {
          const rangeTopY = top - item.rangeTop * scale, rangeBottomY = top - item.rangeBottom * scale
          const rangeTextY = rangeBottomY - 2.2, rangeText = `${metres(item.rangeTop)}–${metres(item.rangeBottom)}`
          if (rangeTextY < bottom + 0.4 || textBoxes.some(box => box.role === 'sample' &&
            rangeTextY - 0.25 <= box.top && rangeTextY + 1.75 >= box.bottom))
            throw new KJValidationError(`Geology: sampled range ${item.id} cannot be labelled without colliding in its source lane`)
          emitFieldText(cell, rangeTextY, rangeText, textHeights?.observation ?? 1.5)
          const baselineStyle = sampleRangeBaselineStyle ?? {
            boundaries: ['top', 'bottom'] as ('top' | 'bottom')[], continuity: 'collision-safe' as const, insetMm: 0,
          }
          const baselineY = { top: rangeTopY, bottom: rangeBottomY }
          for (const boundary of baselineStyle.boundaries) bandLines.push({
            x1: cell.start + baselineStyle.insetMm, x2: gridEnd(cell) - baselineStyle.insetMm,
            y: baselineY[boundary], ...(baselineStyle.continuity === 'continuous' ? { continuity: 'continuous' as const } : {}),
          })
        }
      }
    }
    if (hole.groundwaterObservations) {
      const groundwaterField = field(groundwaterAnnotationStyle!.fieldRole)
      for (const item of hole.groundwaterObservations) emitGroundwaterAnnotation(groundwaterField, top - item.depth * scale, item)
    }
    for (const line of bandLines) {
      if (line.continuity === 'continuous') { g.line(1, line.x1, line.y, line.x2, line.y); continue }
      let cursor = line.x1
      const gaps = textBoxes.filter(box => box.bottom <= line.y && line.y <= box.top && box.right > line.x1 && box.left < line.x2)
        .map(box => ({ left: Math.max(line.x1, box.left), right: Math.min(line.x2, box.right) }))
        .sort((a, b) => a.left - b.left)
      for (const gap of gaps) {
        if (gap.left - cursor >= 0.4) g.line(1, cursor, line.y, gap.left, line.y)
        cursor = Math.max(cursor, gap.right)
      }
      if (line.x2 - cursor >= 0.4) g.line(1, cursor, line.y, line.x2, line.y)
    }
    if (layout.legendMode === 'footer') renderLegend()
    renderFooterGrid()
    return finishColumn()
  }
  g.rect(0, left, bottom, right, pageHeight - headerDepth)
  for (const x of columns) g.line(0, x, bottom, x, pageHeight - headerDepth)
  if (observations.length) {
    g.line(0, sptX, bottom, sptX, pageHeight - headerDepth)
    if (observationColumns) g.line(0, sampleX, bottom, sampleX, pageHeight - headerDepth)
  }
  const headings: [number, string][] = [[left + 2, labels.depthColumn!]]
  if (thicknessX != null) headings.push([depthX + 2, labels.thicknessColumn!])
  headings.push([ (thicknessX ?? depthX) + 2, labels.elevationColumn!], [elevationX + 2, labels.codeColumn!],
    [codeX + 2, labels.hatchColumn!], [hatchX + 2, labels.stratumColumn!],
    [descriptionX + 2, observationColumns || !observations.length ? labels.descriptionColumn! : labels.sampleColumn!])
  for (const [x, label] of headings) g.text(3, x, pageHeight - headerDepth - 6, label, 2.3)
  if (observations.length) {
    if (observationColumns) g.text(3, sampleX + 2, pageHeight - headerDepth - 6, labels.sampleColumn!, 2.3)
    g.text(3, sptX + 2, pageHeight - headerDepth - 6, labels.sptColumn!, 2.3)
  }
  g.line(0, left, top, right, top)
  for (const layer of strata) {
    const yTop = top - layer.top * scale, yBottom = top - layer.bottom * scale
    const bandHeight = yTop - yBottom
    if (bandHeight < (grouped ? 0.4 : 1.4)) throw new KJValidationError(`Geology: layer ${layer.code} is too thin for readable geometry at this scale`)
    const isMajorBoundary = !grouped || groups.some(group => Math.abs(group.bottom - layer.bottom) < 1e-6)
    g.line(1, isMajorBoundary ? left : depthX, yBottom, isMajorBoundary ? right : descriptionX, yBottom)
    if (layer.patternVisibility !== 'boundary-only') g.hatch([[codeX, yBottom], [hatchX, yBottom], [hatchX, yTop], [codeX, yTop]], layer)
    const labelHeight = Math.min(2.3, bandHeight * 0.55)
    const depthY = depthLabelY.get(layer) ?? yBottom + 0.4
    if (grouped && Math.abs(depthY - (yBottom + 0.4)) > 0.6) g.line(1, depthX - 5, yBottom, depthX - 1, depthY)
    g.text(3, left + 2, depthY, metres(layer.bottom), grouped ? 1.6 : labelHeight)
    if (grouped) continue
    if (thicknessX != null) g.text(3, depthX + 2, yBottom + 0.4, metres(layer.bottom - layer.top), labelHeight)
    g.text(3, (thicknessX ?? depthX) + 2, yBottom + 0.4, metres(hole.collarElevation - layer.bottom), labelHeight)
    g.text(3, elevationX + 2, (yTop + yBottom) / 2, displayAliases?.codes[layer.code] ?? layer.code, labelHeight)
    g.text(3, hatchX + 2, (yTop + yBottom) / 2, displayAliases?.names[layer.name] ?? layer.name, labelHeight)
    if (layer.description && (layer.descriptionSource !== 'layer-definition' || definitionAnchors.get(`${layer.code}\u0000${layer.description}`) === layer)) {
      writeDescription(layer.description, yTop, bandHeight, `layer ${layer.code}`)
    }
  }
  if (grouped) for (const group of groups) {
    const yTop = top - group.top * scale, yBottom = top - group.bottom * scale
    const bandHeight = yTop - yBottom
    const labelHeight = Math.min(2.3, Math.max(1.5, bandHeight * 0.55))
    const labelY = bandHeight < 4 ? yTop - 2 : (yTop + yBottom) / 2
    const principal = group.principal
    if (thicknessX != null) g.text(3, depthX + 2, labelY, metres(group.bottom - group.top), labelHeight)
    g.text(3, (thicknessX ?? depthX) + 2, labelY, metres(hole.collarElevation - group.bottom), labelHeight)
    g.text(3, elevationX + 2, labelY, displayAliases?.codes[principal.code] ?? group.id, labelHeight)
    g.text(3, hatchX + 2, labelY, displayAliases?.names[principal.name] ?? principal.name, labelHeight)
    if (principal.description) writeDescription(principal.description, yTop, bandHeight, `major group ${group.id}`)
  }
  for (const item of observations) {
    const y = top - item.depth * scale
    if (item.kind === 'spt' && sptDisplayCap != null && item.displayLabel != null) throw new KJValidationError('Geology: SPT display cap cannot coexist with a caller-provided display label')
    const shownSPT = item.kind === 'spt' && sptDisplayCap != null ? Math.min(item.value!, sptDisplayCap) : item.value
    const label = item.kind === 'sample' ? item.displayLabel ?? item.id
      : item.displayLabel ?? `N=${Number.isInteger(shownSPT!) ? shownSPT!.toString() : metres(shownSPT!)}`
    const columnWidth = item.kind === 'sample' ? sptX - sampleX : right - sptX
    const estimatedWidth = [...label].reduce((sum, character) => sum + (/^[\x20-\x7e]$/.test(character) ? 1.62 : 1.8), 0)
    if (estimatedWidth > columnWidth - 3) throw new KJValidationError(`Geology: observation ${item.id} label does not fit its declared column`)
    g.text(3, (item.kind === 'sample' ? sampleX : sptX) + 2, y, label, 1.8)
  }
  renderLegend()
  renderFooterGrid()
  return finishColumn()
}

export function compileGeologySection(input: KJGeologySectionInput): ReadonlyDeep<KJKnowledgeCompileResult> {
  if (input.surfaceRule !== 'straight-between-supplied-collars') throw new KJValidationError('Geology: an explicit surface connection rule is required')
  if (!Array.isArray(input.holes) || input.holes.length < 2 || input.holes.length > 24) throw new KJValidationError('Geology: section requires 2–24 holes')
  if (input.holes.some(hole => hole.groundwaterObservations?.length))
    throw new KJValidationError('Geology: down-hole groundwater annotation facts belong to column layouts, not section summaries')
  const layout = sectionLayout(input)
  const documentFacts = documentFactRecord(input.documentFacts)
  if (input.projectName != null) bounded(input.projectName, 'project name', 96)
  if (Object.hasOwn(documentFacts, 'projectName')) throw new KJValidationError('Geology: section projectName must use its dedicated field')
  const declaredFacts = new Set(layout.footerGrid.map(cell => cell.key).filter(key => key !== 'projectName'))
  for (const key of Object.keys(documentFacts)) if (!declaredFacts.has(key)) throw new KJValidationError(`Geology: document fact ${key} is not declared by the section style`)
  const holes = [...input.holes].sort((a, b) => numeric(a.station, 'station') - numeric(b.station, 'station'))
  const hs = 1000 / positive(input.horizontalScaleDenominator, 'horizontal scale denominator')
  const vs = 1000 / positive(input.verticalScaleDenominator, 'vertical scale denominator')
  const datum = numeric(input.datumElevation, 'datum elevation')
  const byId = new Map<string, { hole: KJGeologyBorehole; strata: KJGeologyStratum[] }>()
  for (const hole of holes) {
    const strata = checkHole(hole)
    if (byId.has(hole.id)) throw new KJValidationError('Geology: duplicate hole id')
    byId.set(hole.id, { hole, strata })
  }
  for (let i = 1; i < holes.length; i++) if (holes[i]!.station! <= holes[i - 1]!.station!) throw new KJValidationError('Geology: stations must be strictly increasing')
  const originX = layout.plotLeft + 18
  const x = (hole: KJGeologyBorehole) => originX + (hole.station! - holes[0]!.station!) * hs
  const y = (hole: KJGeologyBorehole, depth: number) => layout.plotBottom + (hole.collarElevation - depth - datum) * vs
  if (x(holes.at(-1)!) > layout.plotRight - 4 || holes.some(hole => y(hole, 0) > layout.plotTop || y(hole, hole.depth) < layout.plotBottom)) throw new KJValidationError('Geology: section does not fit A3 at the declared scales and datum')
  const g = drawingBuilder(input, 'geology-section-engineering', input.expectedRevision, patternDefinitions(input.hatchPack, [...byId.values()].flatMap(value => value.strata)))
  g.rect(0, layout.outerMargin, layout.outerMargin, layout.paperWidth - layout.outerMargin, layout.paperHeight - layout.outerMargin)
  g.rect(0, layout.innerMargin, layout.innerMargin, layout.paperWidth - layout.innerMargin, layout.paperHeight - layout.innerMargin)
  const locale = geologyLocale(input)
  g.text(3, layout.paperWidth / 2, layout.titleY, bounded(input.title ?? (locale === 'zh-CN' ? '工程地质剖面图' : 'ENGINEERING GEOLOGICAL SECTION'), 'title'), 5, true)
  g.text(3, layout.paperWidth / 2, layout.scaleY, locale === 'zh-CN'
    ? `水平比例尺 1:${scaleDenominator(input.horizontalScaleDenominator)}   垂直比例尺 1:${scaleDenominator(input.verticalScaleDenominator)}`
    : `HORIZONTAL 1:${scaleDenominator(input.horizontalScaleDenominator)}   VERTICAL 1:${scaleDenominator(input.verticalScaleDenominator)}`, 2.5, true)
  g.line(1, layout.plotLeft, layout.plotBottom, layout.plotLeft, layout.plotTop)
  g.line(1, layout.plotLeft, layout.plotBottom, layout.plotRight, layout.plotBottom)
  const maximumElevation = Math.max(...holes.map(hole => hole.collarElevation))
  for (let elevation = Math.ceil(datum / layout.elevationTickStep) * layout.elevationTickStep; elevation <= maximumElevation + 1e-9; elevation += layout.elevationTickStep) {
    const tickY = layout.plotBottom + (elevation - datum) * vs
    if (tickY > layout.plotTop) break
    g.line(1, layout.plotLeft - 1.8, tickY, layout.plotLeft + 2.2, tickY)
    g.text(3, layout.plotLeft - 13, tickY - 0.7, Number.isInteger(elevation) ? elevation.toFixed(0) : metres(elevation), 1.6)
  }
  const footerBottom = layout.innerMargin, footerTop = footerBottom + layout.footerHeight
  g.rect(0, layout.innerMargin, footerBottom, layout.paperWidth - layout.innerMargin, footerTop)
  const footerValues: Record<string, string | undefined> = { projectName: input.projectName, ...documentFacts }
  for (const [index, cell] of layout.footerGrid.entries()) {
    const end = layout.footerGrid[index + 1]?.start ?? layout.paperWidth - layout.innerMargin
    if (index) g.line(0, cell.start, footerBottom, cell.start, footerTop)
    const split = cell.start + Math.min((end - cell.start) * 0.42, 3 + [...cell.label].length * 1.75)
    g.line(1, split, footerBottom, split, footerTop)
    g.text(3, cell.start + 1.2, footerBottom + 2.8, cell.label, 1.6)
    if (footerValues[cell.key]) g.text(3, split + 1.2, footerBottom + 2.8, footerValues[cell.key]!, 1.6)
  }
  const surface = holes.map(hole => [x(hole), y(hole, 0)] as [number, number])
  g.poly(1, surface)
  for (const hole of holes) {
    const center = x(hole), top = y(hole, 0), bottom = y(hole, hole.depth)
    const half = layout.boreholeWidth / 2
    g.line(4, center, footerTop, center, top)
    g.rect(1, center - half, bottom, center + half, top)
    g.line(1, center - 5, top + 1.5, center + 5, top + 1.5)
    g.text(3, center, top + 6.2, hole.id, 2.1, true)
    g.text(3, center, top + 3.2, metres(hole.collarElevation), 1.5, true)
    g.text(3, center - 9, layout.plotBottom - 8, `${locale === 'zh-CN' ? '里程' : 'STA'} ${metres(hole.station!)}`, 1.7)
    g.text(3, center - 9, layout.plotBottom - 13, `${locale === 'zh-CN' ? '孔深' : 'DEPTH'} ${metres(hole.depth)}`, 1.7)
    for (const layer of byId.get(hole.id)!.strata) {
      const a = y(hole, layer.top), b = y(hole, layer.bottom)
      g.line(1, center - half - 1, b, center + half + 5, b)
      if (layer.patternVisibility !== 'boundary-only') g.hatch([[center - half, b], [center + half, b], [center + half, a], [center - half, a]], layer)
      g.text(3, center + half + 1.5, b + 0.5, metres(layer.bottom), 1.35)
    }
    if (hole.stableWaterDepth != null) {
      const waterY = y(hole, hole.stableWaterDepth)
      g.line(1, center - 5, waterY, center + 5, waterY)
      g.poly(1, [[center - 2, waterY + 1.2], [center, waterY - 1], [center + 2, waterY + 1.2]])
      g.text(3, center + 6, waterY - 0.7, `${locale === 'zh-CN' ? '水位' : 'WL'} ${metres(hole.stableWaterDepth)}`, 1.5)
    }
    for (const observation of hole.observations ?? []) {
      const observationY = y(hole, observation.depth), markerX = center + half + 5
      if (observation.kind === 'sample') {
        g.rect(1, markerX, observationY - 1.2, markerX + 2.2, observationY + 1.2)
        g.text(3, markerX + 3.2, observationY - 0.7, observation.displayLabel ?? observation.id, 1.5)
      } else {
        g.line(1, markerX, observationY, markerX + 2.5, observationY)
        const shown = Number.isInteger(observation.value) ? observation.value!.toString() : metres(observation.value!)
        g.text(3, markerX + 3.2, observationY - 0.7, observation.displayLabel ?? `N=${shown}`, 1.5)
      }
    }
  }
  const holeOrder = new Map(holes.map((hole, index) => [hole.id, index]))
  const manualConnections = input.manualConnections ?? []
  if (!Array.isArray(manualConnections) || manualConnections.length > 200) throw new KJValidationError('Geology: invalid manual connection list')
  const manualKeys = new Set<string>()
  const manualPairTopology = new Map<string, { fromDepth: number; toDepth: number; kind: KJGeologySectionConnection['kind'] }[]>()
  for (const connection of manualConnections) {
    const left = byId.get(bounded(connection.fromHoleId, 'manual connection hole'))
    const right = byId.get(bounded(connection.toHoleId, 'manual connection hole'))
    if (!left || !right || x(left.hole) >= x(right.hole)) throw new KJValidationError('Geology: manual connection must follow declared station order')
    const leftIndex = holeOrder.get(left.hole.id)!, rightIndex = holeOrder.get(right.hole.id)!
    if (rightIndex !== leftIndex + 1) throw new KJValidationError('Geology: manual connection must join adjacent station-ordered holes')
    const fromDepth = numeric(connection.fromDepth, 'manual connection from depth')
    const toDepth = numeric(connection.toDepth, 'manual connection to depth')
    if (fromDepth < 0 || fromDepth > left.hole.depth || toDepth < 0 || toDepth > right.hole.depth) throw new KJValidationError('Geology: manual connection depth is outside its borehole')
    const kind = connection.kind ?? 'manualBoundary'
    if (!['continuity', 'pinchout', 'lens', 'manualBoundary'].includes(kind)) throw new KJValidationError('Geology: invalid manual connection kind')
    const layerCode = connection.layerCode == null ? undefined : bounded(connection.layerCode, 'manual connection layer code')
    const key = `${left.hole.id}:${fromDepth}|${right.hole.id}:${toDepth}|${layerCode ?? ''}|${kind}`
    if (manualKeys.has(key)) throw new KJValidationError('Geology: duplicate manual connection')
    manualKeys.add(key)
    const pairKey = `${left.hole.id}|${right.hole.id}`, pair = manualPairTopology.get(pairKey) ?? []
    for (const prior of pair) {
      const fromOrder = Math.sign(fromDepth - prior.fromDepth), toOrder = Math.sign(toDepth - prior.toDepth)
      if (fromOrder * toOrder < 0) throw new KJValidationError('Geology: manual connections cross or reverse stratigraphic order')
      const sharedOneSide = (fromOrder === 0) !== (toOrder === 0)
      const sourceBackedTermination = [kind, prior.kind].some(value => value === 'pinchout' || value === 'lens')
      if (sharedOneSide && !sourceBackedTermination) throw new KJValidationError('Geology: branching manual connections require an explicit pinchout or lens condition')
    }
    pair.push({ fromDepth, toDepth, kind }); manualPairTopology.set(pairKey, pair)
    g.semanticLine(1, x(left.hole), y(left.hole, fromDepth), x(right.hole), y(right.hole, toDepth), {
      semanticRole: 'source-manual-connection', connectionKind: kind, ...(layerCode == null ? {} : { sourceLayerCode: layerCode }),
    })
  }
  if (!Array.isArray(input.correlations) || input.correlations.length > 200) throw new KJValidationError('Geology: invalid correlation list')
  const unique = new Set<string>()
  const pairTopology = new Map<string, { source: KJGeologyStratum; target: KJGeologyStratum }[]>()
  for (const link of input.correlations) {
    const left = byId.get(bounded(link.fromHoleId, 'correlation hole')), right = byId.get(bounded(link.toHoleId, 'correlation hole'))
    if (!left || !right || x(left.hole) >= x(right.hole)) throw new KJValidationError('Geology: correlation must follow declared station order')
    const leftIndex = holeOrder.get(left.hole.id)!, rightIndex = holeOrder.get(right.hole.id)!
    if (rightIndex !== leftIndex + 1) throw new KJValidationError('Geology: correlation must join adjacent station-ordered holes')
    if (Boolean(link.fromIntervalId) === Boolean(link.fromStratumCode) || Boolean(link.toIntervalId) === Boolean(link.toStratumCode)) throw new KJValidationError('Geology: correlation must use exact interval ids or unambiguous layer codes')
    const candidatesA = left.strata.filter(layer => link.fromIntervalId ? layer.intervalId === link.fromIntervalId : layer.code === link.fromStratumCode)
    const candidatesB = right.strata.filter(layer => link.toIntervalId ? layer.intervalId === link.toIntervalId : layer.code === link.toStratumCode)
    if (candidatesA.length !== 1 || candidatesB.length !== 1) throw new KJValidationError('Geology: correlation must identify one unambiguous interval per hole')
    const a = candidatesA[0]!, b = candidatesB[0]!
    if (a.lithology !== b.lithology) throw new KJValidationError('Geology: correlation needs declared compatible strata')
    const key = `${left.hole.id}:${a.intervalId ?? `${a.code}@${a.top}-${a.bottom}`}|${right.hole.id}:${b.intervalId ?? `${b.code}@${b.top}-${b.bottom}`}`
    if (unique.has(key)) throw new KJValidationError('Geology: duplicate correlation')
    unique.add(key)
    const pairKey = `${left.hole.id}|${right.hole.id}`, topology = pairTopology.get(pairKey) ?? []
    for (const prior of topology) {
      if (prior.source === a || prior.target === b) throw new KJValidationError('Geology: one interval cannot branch into multiple correlations between a hole pair')
      if (Math.sign(a.top - prior.source.top) !== Math.sign(b.top - prior.target.top))
        throw new KJValidationError('Geology: correlations cross or reverse stratigraphic order')
    }
    topology.push({ source: a, target: b })
    pairTopology.set(pairKey, topology)
    const xl = x(left.hole), xr = x(right.hole)
    const topL = y(left.hole, a.top), topR = y(right.hole, b.top), bottomL = y(left.hole, a.bottom), bottomR = y(right.hole, b.bottom)
    g.hatch([[xl, bottomL], [xr, bottomR], [xr, topR], [xl, topL]], a)
    g.line(1, xl, bottomL, xr, bottomR)
    g.line(1, xl, topL, xr, topR)
    g.text(3, (xl + xr) / 2, (topL + topR + bottomL + bottomR) / 4, a.code, 1.8, true)
  }
  g.text(3, layout.innerMargin + 2, footerTop + 2.2, locale === 'zh-CN'
    ? '仅显示已提供的地层与对比关系；未对比区域按设计留空。'
    : 'Only supplied strata/correlations are shown. Uncorrelated regions are intentionally blank.', 1.5)
  return g.finish({ horizontalScaleDenominator: input.horizontalScaleDenominator, verticalScaleDenominator: input.verticalScaleDenominator,
    datumElevation: datum, styleRule: 'geology-section-layout' })
}
