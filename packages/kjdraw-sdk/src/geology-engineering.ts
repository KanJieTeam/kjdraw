import { KJValidationError } from './errors.js'
import { stableHash, deepFreeze, type ReadonlyDeep } from './utils.js'
import type { KJKnowledgeCompileResult } from './knowledge-compiler.js'
import { validateKnowledgePack, type KJKnowledgePack } from './knowledge-pack.js'
import { hatchPatternFromKnowledgePack } from './hatch-pattern-catalog.js'
import { layoutCadMText } from './geometry/text-layout.js'

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
  top: number
  bottom: number
  lithology: 'fill' | 'clay' | 'silt' | 'sand' | 'gravel' | 'rock' | 'weathered-rock'
  /** Semantic pattern role in a licensed pack, e.g. fine-sand versus medium-sand. */
  patternKey?: string
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
  /** Measured stable groundwater depth; never inferred from another hole. */
  stableWaterDepth?: number
  station?: number
  strata: KJGeologyStratum[]
  observations?: KJGeologyObservation[]
}
export interface KJGeologyObservation {
  kind: 'sample' | 'spt'
  id: string
  depth: number
  value?: number
  /** Short visible text; id remains the exact stable observation identity. */
  displayLabel?: string
  /** Direct numeric laboratory facts keyed by a host-selected, versioned field grid. */
  measurements?: Record<string, number>
  /** Exact source-supplied interval for a sampled specimen; never inferred from the point depth. */
  rangeTop?: number
  rangeBottom?: number
}
export interface KJGeologyColumnInput {
  hole: KJGeologyBorehole
  projectName?: string
  verticalScaleDenominator: number
  /** Physical long-log sheet or ordinary A4 sheet, in millimetres. */
  pageHeightMillimeters?: 297 | 841
  /** Host-selected, versioned physical table geometry; independent of model text. */
  columnStylePack?: KJKnowledgePack
  /** Optional licensed, versioned pattern knowledge; no purchased pattern is built into KJDraw. */
  hatchPack?: KJKnowledgePack
  expectedRevision: number
  title?: string
}
export interface KJGeologySectionInput {
  holes: KJGeologyBorehole[]
  /** Only explicitly correlated layers are drawn between holes. */
  correlations: { fromHoleId: string; toHoleId: string; fromStratumCode?: string; toStratumCode?: string; fromIntervalId?: string; toIntervalId?: string }[]
  horizontalScaleDenominator: number
  verticalScaleDenominator: number
  datumElevation: number
  surfaceRule: 'straight-between-supplied-collars'
  hatchPack?: KJKnowledgePack
  expectedRevision: number
  title?: string
}

const pattern: Record<KJGeologyStratum['lithology'], string> = {
  fill: 'CROSS', clay: 'ANSI31', silt: 'ANSI31', sand: 'ANSI37', gravel: 'CROSS',
  rock: 'ANSI31', 'weathered-rock': 'CROSS',
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

interface ColumnLayout {
  paperWidth: number
  paperHeight: number
  left: number
  right: number
  columns: [number, number, number, number, number] | [number, number, number, number, number, number]
  observationColumns?: [number, number]
  headerDepth: number
  footerReserve: number
  sptDisplayCap?: number
  titleHeight?: number
  labels: Record<string, string>
  displayAliases?: { codes: Record<string, string>; names: Record<string, string> }
  headerGrid?: { rows: { role: HeaderRole; label: string }[][] }
  fieldGrid?: { start: number; role: FieldRole; label: string; key?: string; decimals?: number }[]
  legendMode?: 'footer' | 'none'
  textFlow?: { firstGroupBorrowMm: number; firstGroupUnruled: boolean; firstBaselineMm: number; labelPitchMm: number; labelHeightMm: number; paragraphGapMm: number }
}

type HeaderRole = 'projectName' | 'holeId' | 'collarElevation' | 'depth' | 'x' | 'y' | 'startDate' | 'endDate' | 'stableWaterDepth' | 'verticalScale'
const headerRoles = new Set<HeaderRole>(['projectName', 'holeId', 'collarElevation', 'depth', 'x', 'y', 'startDate', 'endDate', 'stableWaterDepth', 'verticalScale'])
type FieldRole = 'layerNumber' | 'layerName' | 'baseElevation' | 'thickness' | 'depth' | 'pattern' | 'description' | 'sample' | 'spt' | 'measurement'
const fieldRoles = new Set<FieldRole>(['layerNumber', 'layerName', 'baseElevation', 'thickness', 'depth', 'pattern', 'description', 'sample', 'spt', 'measurement'])
const requiredFieldRoles: FieldRole[] = ['layerNumber', 'layerName', 'baseElevation', 'thickness', 'depth', 'pattern', 'description', 'sample', 'spt']

const defaultColumnLabels: Record<string, string> = {
  hole: 'HOLE', collar: 'COLLAR', depth: 'DEPTH', verticalScale: 'VERTICAL SCALE', datum: 'DATUM: collar elevation',
  project: 'PROJECT', x: 'X', y: 'Y', startDate: 'START', endDate: 'END',
  depthColumn: 'DEPTH m', thicknessColumn: 'THICKNESS m', elevationColumn: 'ELEV. m', codeColumn: 'CODE', hatchColumn: 'LITHOLOGY',
  stratumColumn: 'STRATUM', descriptionColumn: 'DESCRIPTION', sampleColumn: 'SAMPLE', sptColumn: 'SPT N',
  legend: 'LITHOLOGY LEGEND', footer: 'Depth positive downward; elevations from supplied collar. Verify against drilling log.',
  fill: 'fill', clay: 'clay', silt: 'silt', sand: 'sand', gravel: 'gravel', rock: 'rock', 'weathered-rock': 'weathered-rock',
}

function columnLayout(input: KJGeologyColumnInput): ColumnLayout {
  if (!input.columnStylePack) {
    const height = input.pageHeightMillimeters ?? 297
    if (height !== 297 && height !== 841) throw new KJValidationError('Geology: column page height must be 297 or 841 mm')
    return { paperWidth: 210, paperHeight: height, left: 15, right: 195, columns: [32, 51, 67, 92, 147],
      headerDepth: 56, footerReserve: 57, labels: defaultColumnLabels }
  }
  if (input.pageHeightMillimeters != null) throw new KJValidationError('Geology: a style pack and direct page height cannot be mixed')
  const pack = validateKnowledgePack(input.columnStylePack)
  const rule = pack.rules?.['geology-column-layout']
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new KJValidationError('Geology: style pack has no geology-column-layout rule')
  const value = rule as Record<string, unknown>
  const isFieldGrid = value.fieldGrid != null
  const expectedKeys = [isFieldGrid ? 'fieldGrid' : 'columns', 'left', 'paperHeight', 'paperWidth', 'right']
  const keys = Object.keys(value).sort()
  if (keys.some(key => ![...expectedKeys, 'labels', 'observationColumns', 'displayAliases', 'headerDepth', 'footerReserve', 'headerGrid', 'sptDisplayCap', 'legendMode', 'titleHeight', 'textFlow'].includes(key)) || expectedKeys.some(key => !keys.includes(key))) throw new KJValidationError('Geology: style pack layout must declare five geometry fields and optional labels/observation columns')
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
  const footerReserve = value.footerReserve == null ? 57 : numeric(value.footerReserve, 'style footer reserve')
  if (headerDepth < 40 || headerDepth > 90 || footerReserve < 30 || footerReserve > 120) throw new KJValidationError('Geology: style header or footer reserve is unreadable')
  const sptDisplayCap = value.sptDisplayCap == null ? undefined : numeric(value.sptDisplayCap, 'style SPT display cap')
  if (sptDisplayCap != null && (!Number.isSafeInteger(sptDisplayCap) || sptDisplayCap < 1 || sptDisplayCap > 1000)) throw new KJValidationError('Geology: SPT display cap must be an integer from 1 to 1000')
  let labels = defaultColumnLabels
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
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || Object.keys(supplied).join(',') !== 'rows') throw new KJValidationError('Geology: header grid must declare rows only')
    const rows = (supplied as Record<string, unknown>).rows
    if (!Array.isArray(rows) || rows.length < 2 || rows.length > 4 || (headerDepth - 27) / rows.length < 7) throw new KJValidationError('Geology: header grid rows do not fit the declared sheet')
    const seen = new Set<HeaderRole>()
    headerGrid = { rows: rows.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length < 1 || row.length > 4 || (right - left) / row.length < 45) throw new KJValidationError(`Geology: header grid row ${rowIndex + 1} is unreadable`)
      return row.map((raw, cellIndex) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'label,role') throw new KJValidationError(`Geology: header grid cell ${rowIndex + 1}/${cellIndex + 1} needs a role and label`)
        const cell = raw as Record<string, unknown>
        if (typeof cell.role !== 'string' || !headerRoles.has(cell.role as HeaderRole)) throw new KJValidationError('Geology: undeclared header fact role')
        const role = cell.role as HeaderRole
        if (seen.has(role)) throw new KJValidationError('Geology: duplicate header fact role')
        seen.add(role)
        return { role, label: bounded(cell.label, 'header fact label', 24) }
      })
    }) }
  }
  let fieldGrid: ColumnLayout['fieldGrid']
  if (isFieldGrid) {
    if (!Array.isArray(value.fieldGrid) || value.fieldGrid.length < 9 || value.fieldGrid.length > 24) throw new KJValidationError('Geology: field grid needs 9–24 declared physical columns')
    const roles = new Set<FieldRole>(), measurementKeys = new Set<string>()
    fieldGrid = value.fieldGrid.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: field grid column must be a declared object')
      const cell = raw as Record<string, unknown>
      const role = cell.role as FieldRole
      const schema = role === 'measurement' ? (cell.decimals == null ? 'key,label,role,start' : 'decimals,key,label,role,start') : 'label,role,start'
      if (!fieldRoles.has(role) || Object.keys(cell).sort().join(',') !== schema) throw new KJValidationError('Geology: field grid column needs an exact role schema')
      const start = numeric(cell.start, `field grid start ${index + 1}`), label = bounded(cell.label, `field grid label ${index + 1}`, 32)
      if (role !== 'measurement' && roles.has(role)) throw new KJValidationError(`Geology: duplicate field role ${role}`)
      roles.add(role)
      if (role === 'measurement') {
        const key = bounded(cell.key, 'measurement key', 24)
        if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/u.test(key) || measurementKeys.has(key)) throw new KJValidationError('Geology: measurement keys must be unique safe names')
        measurementKeys.add(key)
        const decimals = cell.decimals == null ? 2 : numeric(cell.decimals, 'measurement display decimals')
        if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 4) throw new KJValidationError('Geology: measurement decimals must be 0–4')
        return { start, role, label, key, decimals }
      }
      return { start, role, label }
    })
    if (requiredFieldRoles.some(role => !roles.has(role)) || Math.abs(fieldGrid[0]!.start - left) > 1e-6) throw new KJValidationError('Geology: field grid misses a core role or left margin')
    for (const [index, field] of fieldGrid.entries()) {
      const width = (fieldGrid[index + 1]?.start ?? right) - field.start
      const minimum = field.role === 'description' ? 35 : field.role === 'layerName' ? 15 :
        field.role === 'measurement' ? 7.5 : ['spt', 'sample', 'pattern'].includes(field.role) ? 12 : 10
      if (width < minimum || field.start < left || field.start >= right) throw new KJValidationError(`Geology: field ${field.role} is out of bounds or unreadable`)
    }
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
  const legendMode = value.legendMode == null ? 'footer' : value.legendMode
  if (legendMode !== 'footer' && legendMode !== 'none' || legendMode === 'none' && !fieldGrid) throw new KJValidationError('Geology: undeclared or inappropriate legend mode')
  return { paperWidth, paperHeight, left, right, columns, headerDepth, footerReserve, legendMode, titleHeight, ...(sptDisplayCap == null ? {} : { sptDisplayCap }),
    ...(observationColumns ? { observationColumns } : {}), labels,
    ...(displayAliases ? { displayAliases } : {}), ...(headerGrid ? { headerGrid } : {}), ...(fieldGrid ? { fieldGrid } : {}), ...(textFlow ? { textFlow } : {}) }
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
        if (prior && (prior.code !== layer.code || prior.name !== layer.name || prior.lithology !== layer.lithology || prior.patternKey !== layer.patternKey)) throw new KJValidationError('Geology: repeated principal intervals disagree on the major group identity')
        principals.set(groupId, layer)
      }
    } else if (layer.groupId != null || layer.groupRole != null) throw new KJValidationError('Geology: incomplete source group hierarchy')
    if (layer.intervalId != null) {
      const id = bounded(layer.intervalId, 'interval id', 64)
      if (intervalIds.has(id)) throw new KJValidationError(`Geology: repeated interval id ${id}`)
      intervalIds.add(id)
    }
    bounded(layer.name, 'stratum name')
    if (layer.description != null) bounded(layer.description, 'stratum description', 96)
    if (layer.descriptionSource != null && (!layer.description || !['interval', 'layer-definition'].includes(layer.descriptionSource))) throw new KJValidationError('Geology: description source requires exact interval or layer-definition provenance')
    const top = numeric(layer.top, 'stratum top'), bottom = numeric(layer.bottom, 'stratum bottom')
    if (Math.abs(top - previous) > 1e-6 || bottom <= top || bottom > hole.depth + 1e-6) throw new KJValidationError(`Geology: gap, overlap or invalid depth at ${code}`)
    if (!Object.hasOwn(pattern, layer.lithology)) throw new KJValidationError(`Geology: undeclared lithology at ${code}`)
    if (layer.patternKey != null) bounded(layer.patternKey, 'pattern key', 96)
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

function patternDefinitions(pack: KJKnowledgePack | undefined, strata: KJGeologyStratum[]): Record<string, Record<string, unknown>> {
  if (!pack) {
    if (strata.some(layer => layer.patternKey != null)) throw new KJValidationError('Geology: a declared pattern key requires a licensed hatch pack')
    return {}
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
  const text = (layer: number, x: number, y: number, value: string, height = 2.6, centered = false) => add('TEXT', layer, {
    position: [x, y, 0], text: value, height,
    ...(centered ? { horizontalAlignment: 1, alignmentPoint: [x, y, 0] } : {}),
  })
  const mtext = (layer: number, x: number, y: number, value: string, height: number, width: number) => add('MTEXT', layer, {
    position: [x, y, 0], text: value, height, width, attachmentPoint: 1,
  })
  const poly = (layer: number, points: [number, number][], closed = false) => add('LWPOLYLINE', layer, { vertices: points.map(([x, y]) => [x, y, 0]), closed })
  const rect = (layer: number, x1: number, y1: number, x2: number, y2: number) => poly(layer, [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], true)
  const hatch = (points: [number, number][], layer: Pick<KJGeologyStratum, 'lithology' | 'patternKey'>) => add('HATCH', 2, {
    boundaryLoops: [{ external: true, closed: true, vertices: points.map(([x, y]) => [x, y, 0]) }],
    patternName: pattern[layer.lithology], solid: false, patternScale: 0.6, patternAngle: 0,
    ...(hatches[layer.patternKey ?? layer.lithology] ?? {}),
  })
  const finish = (): ReadonlyDeep<KJKnowledgeCompileResult> => deepFreeze({
    commandArgs: { entities, resources: { linetypes: [{ id: linetypeId, name: `GEO_${stableHash(prefix).toUpperCase()}_CONT`, pattern: [] }], layers } },
    evidence: { packId: 'geology.core', packVersion: '1.0.0', packHash: stableHash({ pattern, hatches }), intentHash: stableHash(input), templateId, rootObjectId: prefix, expectedRevision, entityCount: entities.length },
  })
  return { line, text, mtext, poly, rect, hatch, finish }
}

export function compileGeologyColumn(input: KJGeologyColumnInput): ReadonlyDeep<KJKnowledgeCompileResult> {
  const { hole } = input, strata = checkHole(hole)
  const layout = columnLayout(input)
  const { paperHeight: pageHeight, paperWidth: pageWidth, left, right, columns, observationColumns,
    headerDepth, footerReserve, labels, displayAliases, headerGrid, fieldGrid, sptDisplayCap, titleHeight, textFlow } = layout
  const gridField = (role: FieldRole) => fieldGrid?.find(field => field.role === role)
  const gridEnd = (field: NonNullable<ColumnLayout['fieldGrid']>[number]): number => fieldGrid?.[fieldGrid.indexOf(field) + 1]?.start ?? right
  const depthX = gridField('depth')?.start ?? columns[0]
  const thicknessX = columns.length === 6 ? columns[1] : null
  const elevationX = columns.length === 6 ? columns[2] : columns[1]
  const codeX = columns.length === 6 ? columns[3] : columns[2]
  const hatchX = columns.length === 6 ? columns[4] : columns[3]
  const descriptionX = gridField('description')?.start ?? columns.at(-1)!
  const scale = 1000 / positive(input.verticalScaleDenominator, 'vertical scale denominator')
  const top = pageHeight - headerDepth - 10, bottom = top - hole.depth * scale
  if (scale < 0.1 || scale > 100 || bottom < footerReserve) throw new KJValidationError('Geology: column does not fit the declared physical sheet at this vertical scale')
  const g = drawingBuilder(input, 'borehole-column-engineering', input.expectedRevision, patternDefinitions(input.hatchPack, strata))
  const observations = hole.observations ?? []
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
    let previousY = top + 1
    for (const layer of strata) {
      const boundaryY = top - layer.bottom * scale
      const anchorY = boundaryY + 0.4
      const visibleY = Math.min(anchorY, previousY - 2.3, top - 2)
      if (anchorY - visibleY > 4.5 || visibleY < bottom + 0.4)
        throw new KJValidationError(`Geology: layer ${layer.code} depth labels cannot be separated readably at this scale`)
      depthLabelY.set(layer, visibleY)
      previousY = visibleY
    }
  }
  g.rect(0, 5, 5, pageWidth - 5, pageHeight - 5)
  g.text(3, pageWidth / 2, pageHeight - 18, bounded(input.title ?? 'ENGINEERING BOREHOLE LOG', 'title'), titleHeight ?? 5, true)
  if (headerGrid) {
    const facts: Record<HeaderRole, string | undefined> = {
      projectName: input.projectName ? bounded(input.projectName, 'project name', 96) : undefined,
      holeId: hole.id, collarElevation: metres(hole.collarElevation), depth: metres(hole.depth),
      x: hole.x == null ? undefined : metres(hole.x), y: hole.y == null ? undefined : metres(hole.y),
      startDate: hole.startDate, endDate: hole.endDate,
      stableWaterDepth: hole.stableWaterDepth == null ? undefined : metres(hole.stableWaterDepth),
      verticalScale: `1:${metres(input.verticalScaleDenominator)}`,
    }
    const headerTop = pageHeight - 24, headerBottom = pageHeight - headerDepth + 3
    const rowHeight = (headerTop - headerBottom) / headerGrid.rows.length
    g.rect(0, left, headerBottom, right, headerTop)
    for (const [rowIndex, row] of headerGrid.rows.entries()) {
      const rowTop = headerTop - rowIndex * rowHeight, rowBottom = rowTop - rowHeight
      if (rowIndex) g.line(0, left, rowTop, right, rowTop)
      const width = (right - left) / row.length
      for (const [cellIndex, cell] of row.entries()) {
        const cellLeft = left + cellIndex * width, valueX = cellLeft + Math.min(25, width * 0.35)
        if (cellIndex) g.line(0, cellLeft, rowBottom, cellLeft, rowTop)
        g.line(0, valueX, rowBottom, valueX, rowTop)
        const value = facts[cell.role]
        if (value == null) throw new KJValidationError(`Geology: declared header fact ${cell.role} is missing; refusing to invent a value`)
        const estimated = (text: string): number => [...text].reduce((sum, character) => sum + (/^[\x20-\x7e]$/u.test(character) ? 1.15 : 2.1), 0)
        if (estimated(cell.label) > valueX - cellLeft - 3 || estimated(value) > cellLeft + width - valueX - 3)
          throw new KJValidationError(`Geology: header fact ${cell.role} does not fit the declared cell`)
        g.text(3, cellLeft + 2, rowTop - rowHeight * 0.69, cell.label, 2.2)
        g.text(3, valueX + 2, rowTop - rowHeight * 0.69, value, 2.2)
      }
    }
  } else {
    if (input.projectName) g.text(3, left + 2, pageHeight - 27, `${labels.project} ${bounded(input.projectName, 'project name', 96)}`, 2.5)
    g.text(3, left + 2, pageHeight - 36, `${labels.hole} ${hole.id}   ${labels.collar} ${metres(hole.collarElevation)} m   ${labels.depth} ${metres(hole.depth)} m`, 3)
    const location = [hole.x != null ? `${labels.x} ${metres(hole.x)}` : '', hole.y != null ? `${labels.y} ${metres(hole.y)}` : '',
      hole.startDate ? `${labels.startDate} ${hole.startDate}` : '', hole.endDate ? `${labels.endDate} ${hole.endDate}` : ''].filter(Boolean).join('   ')
    if (location) g.text(3, left + 2, pageHeight - 43, location, 2.3)
    g.text(3, left + 2, pageHeight - 50, `${labels.verticalScale} 1:${metres(input.verticalScaleDenominator)}   ${labels.datum}`, 2.6)
  }
  const renderLegend = (): void => {
    const distinct = [...new Map(strata.map(layer => [layer.patternKey ?? layer.lithology, layer])).values()]
    if (distinct.length > 5) throw new KJValidationError('Geology: A4 legend supports at most five lithology classes')
    const legendY = Math.min(34, bottom - 6, footerReserve - 4)
    g.text(3, left, legendY, labels.legend!, 2.8)
    for (const [index, layer] of distinct.entries()) {
      const x = left + index * Math.min(37, (right - left - 10) / distinct.length)
      g.rect(0, x, legendY - 12, x + 10, legendY - 4)
      g.hatch([[x, legendY - 12], [x + 10, legendY - 12], [x + 10, legendY - 4], [x, legendY - 4]], layer)
      g.text(3, x + 11, legendY - 10, layer.patternKey ? displayAliases?.names[layer.name] ?? layer.name : labels[layer.lithology]!, 2)
    }
    g.text(3, left, Math.min(12, legendY - 18), labels.footer!, 2.2)
  }
  if (fieldGrid) {
    const field = (role: FieldRole) => fieldGrid.find(item => item.role === role)!
    const fieldWidth = (item: typeof fieldGrid[number]) => gridEnd(item) - item.start
    const estimatedWidth = (value: string, height: number) => [...value].reduce((sum, character) =>
      sum + (/^[\x20-\x7e]$/u.test(character) ? height * 0.64 : height), 0)
    const bandLines: { x1: number; x2: number; y: number }[] = []
    const textBoxes: { role: FieldRole; left: number; right: number; bottom: number; top: number }[] = []
    const emitFieldText = (item: typeof fieldGrid[number], y: number, value: string, height = 1.8): void => {
      const width = estimatedWidth(value, height), x = item.start + 1.2
      if (width > fieldWidth(item) - 2.4) throw new KJValidationError(`Geology: ${item.role} text does not fit its declared field`)
      g.text(3, x, y, value, height)
      textBoxes.push({ role: item.role, left: x - 0.25, right: x + width + 0.25, bottom: y - 0.25, top: y + height + 0.25 })
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
          previousDescriptionBottom = anchorY - occupied
          return
        }
      }
      throw new KJValidationError(`Geology: ${identity} description collides with another text lane or exceeds source-declared borrow`)
    }
    g.rect(0, left, bottom, right, pageHeight - headerDepth)
    for (const item of fieldGrid) {
      if (item.start !== left) g.line(0, item.start, bottom, item.start, pageHeight - headerDepth)
      emitFieldText(item, pageHeight - headerDepth - 6, item.label, 1.5)
    }
    g.line(0, left, top, right, top)
    const patternField = field('pattern'), depthField = field('depth')
    const writeCore = (id: string, groupTop: number, groupBottom: number, principal: KJGeologyStratum): void => {
      const yTop = top - groupTop * scale, yBottom = top - groupBottom * scale
      const coreIndex = renderedCoreCount++
      const mid = (yTop + yBottom) / 2
      let labelY = yTop - Math.max(1.8, (yTop - yBottom) / 2)
      let labelHeight = 1.8
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
      for (const role of ['layerNumber', 'layerName', 'baseElevation', 'thickness'] as const)
        emitFieldText(field(role), textFlow && coreIndex < 2 ? labelY : yTop - yBottom < 2 ? labelY : mid, values[role]!, labelHeight)
      if (principal.description && (grouped || principal.descriptionSource !== 'layer-definition' ||
        definitionAnchors.get(`${principal.code}\u0000${principal.description}`) === principal))
        writeGridDescription(principal.description, yTop, yBottom, coreIndex, `major group ${id}`)
    }
    for (const layer of strata) {
      const yTop = top - layer.top * scale, yBottom = top - layer.bottom * scale
      if (yTop - yBottom < (grouped ? 0.4 : 1.4)) throw new KJValidationError(`Geology: layer ${layer.code} is too thin for readable geometry at this scale`)
      const major = !grouped || groups.some(group => Math.abs(group.bottom - layer.bottom) < 1e-6)
      if (major && !(textFlow?.firstGroupUnruled && Math.abs(layer.bottom - firstGroupBottom) < 1e-6))
        bandLines.push({ x1: left, x2: right, y: yBottom })
      else if (major) for (const role of ['depth', 'pattern'] as const) {
        const item = field(role)
        bandLines.push({ x1: item.start, x2: gridEnd(item), y: yBottom })
      }
      else for (const role of ['depth', 'pattern'] as const) {
        const item = field(role)
        bandLines.push({ x1: item.start, x2: gridEnd(item), y: yBottom })
      }
      g.hatch([[patternField.start, yBottom], [gridEnd(patternField), yBottom],
        [gridEnd(patternField), yTop], [patternField.start, yTop]], layer)
      const depthY = depthLabelY.get(layer) ?? yBottom + 0.4
      if (Math.abs(depthY - (yBottom + 0.4)) > 0.6) g.line(1, gridEnd(depthField) - 5, yBottom, gridEnd(depthField) - 1, depthY)
      emitFieldText(depthField, depthY, metres(layer.bottom), grouped ? 1.5 : Math.min(2.1, (yTop - yBottom) * 0.55))
      if (!grouped) writeCore(layer.code, layer.top, layer.bottom, layer)
    }
    if (grouped) for (const group of groups) writeCore(group.id, group.top, group.bottom, group.principal)
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
        if (value != null) emitFieldText(cell, y, value, 1.5)
        if (cell.role === 'sample' && item.kind === 'sample' && item.rangeTop != null && item.rangeBottom != null) {
          const rangeTopY = top - item.rangeTop * scale, rangeBottomY = top - item.rangeBottom * scale
          const rangeTextY = rangeBottomY - 2.2, rangeText = `${metres(item.rangeTop)}–${metres(item.rangeBottom)}`
          if (rangeTextY < bottom + 0.4 || textBoxes.some(box => box.role === 'sample' &&
            rangeTextY - 0.25 <= box.top && rangeTextY + 1.75 >= box.bottom))
            throw new KJValidationError(`Geology: sampled range ${item.id} cannot be labelled without colliding in its source lane`)
          emitFieldText(cell, rangeTextY, rangeText, 1.5)
          bandLines.push({ x1: cell.start, x2: gridEnd(cell), y: rangeTopY },
            { x1: cell.start, x2: gridEnd(cell), y: rangeBottomY })
        }
      }
    }
    for (const line of bandLines) {
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
    return g.finish()
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
    g.hatch([[codeX, yBottom], [hatchX, yBottom], [hatchX, yTop], [codeX, yTop]], layer)
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
  return g.finish()
}

export function compileGeologySection(input: KJGeologySectionInput): ReadonlyDeep<KJKnowledgeCompileResult> {
  if (input.surfaceRule !== 'straight-between-supplied-collars') throw new KJValidationError('Geology: an explicit surface connection rule is required')
  if (!Array.isArray(input.holes) || input.holes.length < 2 || input.holes.length > 24) throw new KJValidationError('Geology: section requires 2–24 holes')
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
  const x = (hole: KJGeologyBorehole) => 53 + (hole.station! - holes[0]!.station!) * hs
  const y = (hole: KJGeologyBorehole, depth: number) => 48 + (hole.collarElevation - depth - datum) * vs
  if (x(holes.at(-1)!) > 390 || holes.some(hole => y(hole, 0) > 256 || y(hole, hole.depth) < 48)) throw new KJValidationError('Geology: section does not fit A3 at the declared scales and datum')
  const g = drawingBuilder(input, 'geology-section-engineering', input.expectedRevision, patternDefinitions(input.hatchPack, [...byId.values()].flatMap(value => value.strata)))
  g.rect(0, 5, 5, 415, 292)
  g.text(3, 133, 279, bounded(input.title ?? 'ENGINEERING GEOLOGICAL SECTION', 'title'), 5)
  g.text(3, 16, 266, `HORIZONTAL 1:${metres(input.horizontalScaleDenominator)}  VERTICAL 1:${metres(input.verticalScaleDenominator)}  DATUM ${metres(datum)} m`, 3)
  g.line(4, 41, 48, 41, 257)
  g.line(4, 41, 48, 396, 48)
  const surface = holes.map(hole => [x(hole), y(hole, 0)] as [number, number])
  g.poly(1, surface)
  for (const hole of holes) {
    const center = x(hole), top = y(hole, 0), bottom = y(hole, hole.depth)
    g.line(4, center, 48, center, top)
    g.rect(1, center - 2, bottom, center + 2, top)
    g.text(3, center - 4, top + 5, hole.id, 2.7)
    g.text(3, center - 7, 36, `STA ${metres(hole.station!)}`, 2.2)
    g.text(3, center - 7, 29, `H ${metres(hole.collarElevation)}`, 2.2)
    for (const layer of byId.get(hole.id)!.strata) {
      const a = y(hole, layer.top), b = y(hole, layer.bottom)
      g.line(1, center - 3, b, center + 3, b)
      g.hatch([[center - 2, b], [center + 2, b], [center + 2, a], [center - 2, a]], layer)
    }
  }
  if (!Array.isArray(input.correlations) || input.correlations.length > 200) throw new KJValidationError('Geology: invalid correlation list')
  const unique = new Set<string>()
  for (const link of input.correlations) {
    const left = byId.get(bounded(link.fromHoleId, 'correlation hole')), right = byId.get(bounded(link.toHoleId, 'correlation hole'))
    if (!left || !right || x(left.hole) >= x(right.hole)) throw new KJValidationError('Geology: correlation must follow declared station order')
    if (Boolean(link.fromIntervalId) === Boolean(link.fromStratumCode) || Boolean(link.toIntervalId) === Boolean(link.toStratumCode)) throw new KJValidationError('Geology: correlation must use exact interval ids or unambiguous layer codes')
    const candidatesA = left.strata.filter(layer => link.fromIntervalId ? layer.intervalId === link.fromIntervalId : layer.code === link.fromStratumCode)
    const candidatesB = right.strata.filter(layer => link.toIntervalId ? layer.intervalId === link.toIntervalId : layer.code === link.toStratumCode)
    if (candidatesA.length !== 1 || candidatesB.length !== 1) throw new KJValidationError('Geology: correlation must identify one unambiguous interval per hole')
    const a = candidatesA[0]!, b = candidatesB[0]!
    if (a.lithology !== b.lithology) throw new KJValidationError('Geology: correlation needs declared compatible strata')
    const key = `${left.hole.id}:${a.intervalId ?? `${a.code}@${a.top}-${a.bottom}`}|${right.hole.id}:${b.intervalId ?? `${b.code}@${b.top}-${b.bottom}`}`
    if (unique.has(key)) throw new KJValidationError('Geology: duplicate correlation')
    unique.add(key)
    const xl = x(left.hole), xr = x(right.hole)
    const topL = y(left.hole, a.top), topR = y(right.hole, b.top), bottomL = y(left.hole, a.bottom), bottomR = y(right.hole, b.bottom)
    g.hatch([[xl, bottomL], [xr, bottomR], [xr, topR], [xl, topL]], a)
    g.line(1, xl, bottomL, xr, bottomR)
    g.line(1, xl, topL, xr, topR)
    g.text(3, (xl + xr) / 2 - 5, (topL + topR + bottomL + bottomR) / 4, `${a.code} ${a.name}`, 2.3)
  }
  g.text(3, 16, 13, 'Only supplied strata/correlations are shown. Uncorrelated regions are intentionally blank.', 2.3)
  return g.finish()
}
