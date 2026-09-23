import { KJValidationError } from './errors.js'
import { stableHash, deepFreeze, type ReadonlyDeep } from './utils.js'
import type { KJKnowledgeCompileResult } from './knowledge-compiler.js'
import { validateKnowledgePack, type KJKnowledgePack } from './knowledge-pack.js'
import { hatchPatternFromKnowledgePack } from './hatch-pattern-catalog.js'
import { layoutCadMText } from './geometry/text-layout.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from './knowledge-packs/geology-core.js'
import { compileGeologySectionTopology, type KJSectionTopologyResult } from './geology-section-topology.js'

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
  /** Optional source-measured paragraph anchor for this principal stratum.
   * The boundary role is explicit; the compiler never derives it from layer thickness. */
  descriptionPlacement?: { boundaryRole: 'top' | 'bottom' | 'midpoint'; offsetMm: number }
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
export type KJGeologySampleRangeBaselineStyle = {
  boundaries: ('top' | 'bottom')[]
  continuity: 'collision-safe' | 'continuous'
} & ({ insetMm: number } | { fieldRole: 'sample'; startInsetMm: number; endInsetMm: number })
/** Source-backed visible formatting for a measured sample interval. The
 * interval itself still comes only from rangeTop/rangeBottom observation facts. */
export interface KJGeologySampleRangeTextFormat {
  fieldRole: 'sample'
  prefix: string
  separator: string
  suffix: string
  decimals: number
  trailingZeros: 'preserve' | 'trim'
  anchor?: 'range-top' | 'range-midpoint' | 'range-bottom'
  placement?: KJGeologyFieldHeaderTextPlacement
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
  /** Source-measured delta from the field-right/exact-depth guide endpoint, in millimetres. */
  guideEndpointOffset?: [number, number]
  placements?: {
    depth: KJGeologyFieldHeaderTextPlacement
    elevation: KJGeologyFieldHeaderTextPlacement
    marker: KJGeologyFieldHeaderTextPlacement
    observedOn: KJGeologyFieldHeaderTextPlacement
  }
}
/** Optional source-backed linework attached to one title-margin fact. */
export interface KJGeologyTitleMarginDecoration {
  kind: 'top-edge-elbow-underline'
  elbowOffset: [number, number]
  horizontalEnd: 'frame-right'
}
/** Exact main-title placement measured from the physical frame's upper-left. */
export interface KJGeologyTitleTextStyle {
  anchor: 'frame-left-top'
  placement: KJGeologyFieldHeaderTextPlacement
  rotationDegrees: number
}
/** One source-backed local CAD text style for a column template. Font files are
 * referenced by safe local names only; KJDraw never embeds or downloads them. */
export interface KJGeologyDefaultTextStyle {
  name: string
  fontFamily: string
  fontFile: string
  bigFontFile: string
  fixedHeight: number
  widthFactor: number
  obliqueAngleDegrees: number
  dxfFlags: number
  generationFlags: number
}
/** Optional source-backed local CAD text styles for semantic column roles. */
export interface KJGeologyRoleTextStyles {
  layerName?: KJGeologyDefaultTextStyle
  patternLabel?: KJGeologyDefaultTextStyle
}
type KJGeologyRoleTextStyleRole = keyof KJGeologyRoleTextStyles
/** Exact source-backed placement for one physical field-header line. Offsets
 * are millimetres from the field's lower-left corner. */
export interface KJGeologyFieldHeaderTextPlacement {
  offset: [number, number]
  height: number
  textWidthFactor: number
  horizontalAlignment: 'left' | 'center' | 'right'
  verticalAlignment: 'baseline' | 'middle'
}
type KJGeologySectionTextPlacement = Omit<KJGeologyFieldHeaderTextPlacement, 'horizontalAlignment'> &
  { horizontalAlignment: 'left' | 'center' | 'right' | 'middle' }
/** A field header may contain one main line and, only when the field declares
 * a sublabel, one independently placed sub line. */
export interface KJGeologyFieldHeaderTextStyle {
  main: KJGeologyFieldHeaderTextPlacement
  sub?: KJGeologyFieldHeaderTextPlacement
}
/** Independent source-backed placements for one table-header fact's label and
 * value. Each offset is measured from its own physical lane's lower-left. */
export interface KJGeologyHeaderFactTextStyle {
  label: KJGeologyFieldHeaderTextPlacement
  value: KJGeologyFieldHeaderTextPlacement
}
/** Independent source-backed placements for one footer fact's label and
 * value. The value offset starts at an internal divider when one is declared. */
export interface KJGeologyFooterFactTextStyle {
  label: KJGeologyFieldHeaderTextPlacement
  value: KJGeologyFieldHeaderTextPlacement
}
/** Source-backed placement for a sampled point's visible label and marker.
 * Offsets are millimetres from the sample field's lower-left at the selected
 * measured depth anchor. */
export interface KJGeologySampleAnnotationStyle {
  depthAnchor: 'observation-depth' | 'range-top' | 'range-bottom'
  label: KJGeologyFieldHeaderTextPlacement
  marker: KJGeologyFieldHeaderTextPlacement
}
/** Source-backed depth-lane placements relative to each real interval's
 * bottom boundary. Lens placement is explicit and never inferred by thickness. */
export interface KJGeologyIntervalDepthTextStyle {
  fieldRole: 'depth'
  principal: KJGeologyFieldHeaderTextPlacement
  lens: KJGeologyFieldHeaderTextPlacement
}
/** Source-backed placement for the four visible values that identify one
 * major stratum group. Offsets are measured from the group's geometric
 * midpoint and the lower-left corner of each declared physical field. */
export interface KJGeologyMajorGroupValueStyle {
  anchor: 'major-group-midpoint'
  layerNumber: KJGeologyFieldHeaderTextPlacement
  layerName: KJGeologyFieldHeaderTextPlacement
  baseElevation: KJGeologyFieldHeaderTextPlacement
  thickness: KJGeologyFieldHeaderTextPlacement
  /** Optional semantic override for the group touching the body top boundary. */
  topBoundary?: { layerName: KJGeologyFieldHeaderTextPlacement }
  /** Physical radius used only with the explicit circular layer-number style. */
  layerNumberCircleRadius?: number
}
/** Exact placements for the symbol and optional qualifiers of one
 * stratigraphic notation, relative to a major group's geometric midpoint. */
export interface KJGeologyStratigraphicNotationPlacementSet {
  symbol: KJGeologyFieldHeaderTextPlacement
  superscript: KJGeologyFieldHeaderTextPlacement
  subscript: KJGeologyFieldHeaderTextPlacement
}
/** Source-backed stratigraphic notation style. Top-boundary placement is a
 * geometric role, not an interval index or a thickness heuristic. */
export interface KJGeologyStratigraphicNotationStyle {
  symbolHeight: number
  qualifierHeight: number
  placement?: {
    fieldRole: 'layerName'
    anchor: 'major-group-midpoint'
    principal: KJGeologyStratigraphicNotationPlacementSet
    topBoundary: KJGeologyStratigraphicNotationPlacementSet
  }
}
/** Source-backed paragraph placement enabled only for descriptions carrying
 * an explicit major-group boundary role and offset. */
export interface KJGeologyDescriptionTextStyle {
  fieldRole: 'description'
  anchor: 'declared-major-group-boundary'
  height: number
  /** Optional source-declared MTEXT paragraph width in physical millimetres. */
  width?: number
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

/** Explicit visible identifiers for the two ends of a geological section.
 * Values come from the caller; the compiler never infers an identifier. */
export interface KJGeologySectionReference {
  start: string
  end: string
}

/** Source-backed native geometry for measured observations in a section.
 * Every coordinate is a bounded millimetre offset from the supplied borehole
 * and observation depth. */
export interface KJGeologySectionObservationSymbolStyle {
  sample: {
    centerOffset: [number, number]
    radius: number
    fill: 'solid' | 'none'
    labelPlacement?: KJGeologyFieldHeaderTextPlacement
  }
  spt: {
    topRightOffset: [number, number]
    width: number
    height: number
    labelPlacement: KJGeologySectionTextPlacement
    labelOverrides?: { holeId: string; observationId: string;
      placement: KJGeologySectionTextPlacement }[]
  }
  groundwater?: {
    insertOffset: [number, number]
    lineSegments: [[number, number], [number, number]][]
    markerPolygon: [number, number][]
    fill: 'solid' | 'none'
    labelPlacement?: KJGeologyFieldHeaderTextPlacement
    labelFormat?: 'role-depth' | 'depth-elevation'
    labelPrecision?: 0 | 1 | 2 | 3 | 4
    labelOverrides?: { holeId: string; observationRole: 'stable-water'; depth: number; elevation: number;
      placement: KJGeologyFieldHeaderTextPlacement }[]
  }
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
  /** Explicit opt-in for source-declared group topology. The default keeps the
   * existing caller-supplied correlation contract unchanged. */
  correlationMode?: 'explicit-correlations' | 'source-group-topology'
  /** Explicit source-backed boundaries are rendered before inferred correlations. */
  manualConnections?: KJGeologySectionConnection[]
  /** Exact source-backed identifiers shown at the two ends of the section. */
  sectionReference?: KJGeologySectionReference
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

type SectionFrameCorner = 'bottom-left' | 'bottom-right' | 'top-right' | 'top-left'
type SectionFrameWinding = 'clockwise' | 'counter-clockwise'
type SectionFrameRule =
  | { primitive: 'line-segments'; startCorner: SectionFrameCorner; winding: SectionFrameWinding }
  | { primitive: 'closed-polyline'; startCorner: SectionFrameCorner; winding: SectionFrameWinding; constantWidth: number }

type SectionHeadingTextRule = { anchorX: number; height: number; textWidthFactor: number;
  horizontalAlignment: 0 | 1 | 2 | 4; verticalAlignment: 0 | 1 | 2 | 3 }

type SectionTextPlacementRule = { offset: [number, number]; height: number; textWidthFactor: number;
  horizontalAlignment: 0 | 1 | 2 | 4; verticalAlignment: 0 | 1 | 2 | 3 }
type SectionHoleIdentifierLabelOverride = {
  holeId: string
  placement: SectionTextPlacementRule
}
type SectionHoleEndDateLabelOverride = {
  holeId: string
  endDate: string
  placement: SectionTextPlacementRule
}
type SectionCollarElevationLabelOverride = {
  holeId: string
  elevation: number
  placement?: SectionTextPlacementRule
}
type SectionIntervalBottomLabelOverride = {
  holeId: string
  intervalId: string
  depth: number
  elevation: number
  placement?: SectionTextPlacementRule
}
type SectionTextStyle = {
  elevationTick: SectionTextPlacementRule
  holeIdentifier: SectionTextPlacementRule & { labelOverrides?: SectionHoleIdentifierLabelOverride[] }
  holeEndDate?: SectionTextPlacementRule & { format: 'date-only' | 'as-supplied'; labelOverrides?: SectionHoleEndDateLabelOverride[] }
  collarElevation: SectionTextPlacementRule & { labelOverrides?: SectionCollarElevationLabelOverride[] }
  intervalBottom: SectionTextPlacementRule & { format: 'depth' | 'depth-elevation'; precision: 0 | 1 | 2 | 3 | 4;
    labelOverrides?: SectionIntervalBottomLabelOverride[] }
  station: SectionTextPlacementRule & { mode: 'cumulative-at-hole' | 'adjacent-spacing-between-holes'; precision: 0 | 1 | 2 | 3 | 4 }
  holeDepth: SectionTextPlacementRule & { visibility: 'shown' | 'omitted'; precision: 0 | 1 | 2 | 3 | 4 }
  stationLabel: SectionTextPlacementRule & { visibility: 'shown' | 'omitted' }
}
type SectionHatchPresentation = {
  boreholeColumn: { patternScale: number; patternAngle: number }
  stratigraphicBand: { patternScale: number; patternAngle: number }
}
type SectionElevationTickSequence = { startElevation: number; step: number; minimumElevation: number; maximumElevation: number }
type SectionSourceBackedBand = { sourceHoleId: string; sourceIntervalId: string; points: [number, number][] }
type SectionBoreholeProfileStyle = {
  primitive: 'centerline'
  guideEndOffset: number
  bottomTickOffsets: [number, number]
  collarBarHalfWidth: number
  collarBarYOffset: number
}
type SectionElevationScaleRailStyle = {
  primitive: 'solid-cell-per-tick'
  xOffsets: [number, number]
  tickCellYOffset: [number, number]
}
type SectionSourceBackedPatternSymbol = { primitive: 'triangle-lines'; points: [[number, number], [number, number], [number, number]] }
type SectionSourceBackedBoundaryPolyline = { primitive: 'open-polyline' | 'closed-polyline'; points: [number, number][] }
type SectionStratigraphicGroupLabelStyle = {
  code: Omit<SectionTextPlacementRule, 'horizontalAlignment'> & { fitEndOffset: [number, number] }
  symbol: SectionTextPlacementRule
  subscript: SectionTextPlacementRule
  superscript: SectionTextPlacementRule
}
type SectionSourceBackedStratigraphicGroupLabel = {
  sourceHoleId: string
  sourceIntervalId: string
  /** Explicit source anchor expressed in section station/elevation coordinates. */
  anchor: [number, number]
}

interface SectionLayout {
  paperWidth: number
  paperHeight: number
  drawingOrigin: [number, number]
  outerMargins: { left: number; right: number; bottom: number; top: number }
  innerMargins: { left: number; right: number; bottom: number; top: number }
  frameStyle: { outer: SectionFrameRule; inner: SectionFrameRule }
  headingTextStyle?: { title: SectionHeadingTextRule; scale: SectionHeadingTextRule }
  sectionTextStyle?: SectionTextStyle
  sectionHatchPresentation?: SectionHatchPresentation
  elevationTickSequence?: SectionElevationTickSequence
  sourceBackedBands?: SectionSourceBackedBand[]
  boreholeProfileStyle?: SectionBoreholeProfileStyle
  elevationScaleRailStyle?: SectionElevationScaleRailStyle
  sourceBackedPatternSymbols?: SectionSourceBackedPatternSymbol[]
  sourceBackedBoundaryPolylines?: SectionSourceBackedBoundaryPolyline[]
  stratigraphicGroupLabelStyle?: SectionStratigraphicGroupLabelStyle
  sourceBackedStratigraphicGroupLabels?: SectionSourceBackedStratigraphicGroupLabel[]
  plotLeft: number
  sectionReferenceStyle?: { start: KJGeologyFieldHeaderTextPlacement; end: KJGeologyFieldHeaderTextPlacement }
  observationSymbolStyle?: KJGeologySectionObservationSymbolStyle
  plotRight: number
  plotBottom: number
  footerFrameStyle?: { left: number; right: number; bottom: number; top: number; guideY: number;
    primitive: 'line-segments' | 'closed-polyline'; cellMode: 'declared-grid' | 'none' }
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
const sourceTextPlacement = (raw: unknown, label: string, minimumHeight = 1.2, maximumHeight = 5): KJGeologyFieldHeaderTextPlacement => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== 'height,horizontalAlignment,offset,textWidthFactor,verticalAlignment')
    throw new KJValidationError(`Geology: ${label} needs an exact source-backed placement schema`)
  const rule = raw as Record<string, unknown>
  if (!Array.isArray(rule.offset) || rule.offset.length !== 2)
    throw new KJValidationError(`Geology: ${label} offset must contain two millimetre coordinates`)
  const offset = rule.offset.map((coordinate, index) => numeric(coordinate, `${label} offset ${index + 1}`)) as [number, number]
  const height = numeric(rule.height, `${label} height`)
  const textWidthFactor = numeric(rule.textWidthFactor, `${label} width factor`)
  if (!['left', 'center', 'right'].includes(rule.horizontalAlignment as string) ||
    !['baseline', 'middle'].includes(rule.verticalAlignment as string) ||
    height < minimumHeight || height > maximumHeight || textWidthFactor < 0.5 || textWidthFactor > 1.5)
    throw new KJValidationError(`Geology: ${label} placement is unreadable`)
  return { offset, height, textWidthFactor,
    horizontalAlignment: rule.horizontalAlignment as KJGeologyFieldHeaderTextPlacement['horizontalAlignment'],
    verticalAlignment: rule.verticalAlignment as KJGeologyFieldHeaderTextPlacement['verticalAlignment'] }
}
const sourceSectionTextPlacement = (raw: unknown, label: string): KJGeologySectionTextPlacement => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) &&
    (raw as Record<string, unknown>).horizontalAlignment === 'middle') {
    const parsed = sourceTextPlacement({ ...(raw as Record<string, unknown>), horizontalAlignment: 'center' }, label)
    return { ...parsed, horizontalAlignment: 'middle' }
  }
  return sourceTextPlacement(raw, label)
}
type SectionSptLabelOverride = NonNullable<KJGeologySectionObservationSymbolStyle['spt']['labelOverrides']>[number]
type SectionGroundwaterLabelOverride = NonNullable<NonNullable<KJGeologySectionObservationSymbolStyle['groundwater']>['labelOverrides']>[number]
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
  fieldGrid?: { start: number; role: FieldRole; label: string; subLabel?: string; key?: string; decimals?: number; textWidthFactor?: number; headerTextStyle?: KJGeologyFieldHeaderTextStyle }[]
  legendMode?: 'footer' | 'none'
  layerNumberStyle: 'plain' | 'circle'
  textFlow?: { firstGroupBorrowMm: number; firstGroupUnruled: boolean; firstBaselineMm: number; labelPitchMm: number; labelHeightMm: number; paragraphGapMm: number }
  textHeights?: { headerFact: number; fieldHeader: number; fieldSubHeader: number; majorValue: number; intervalDepth: number; observation: number }
  intervalDepthTextStyle?: KJGeologyIntervalDepthTextStyle
  majorGroupValueStyle?: KJGeologyMajorGroupValueStyle
  titleTextStyle?: KJGeologyTitleTextStyle
  defaultTextStyle?: KJGeologyDefaultTextStyle
  roleTextStyles?: KJGeologyRoleTextStyles
  stratigraphicNotationStyle?: KJGeologyStratigraphicNotationStyle
  descriptionTextStyle?: KJGeologyDescriptionTextStyle
  sampleMarkerStyle?: { height: number; gap: number; baselineOffset: number }
  sampleAnnotationStyle?: KJGeologySampleAnnotationStyle
  sampleRangeBaselineStyle?: KJGeologySampleRangeBaselineStyle
  sampleRangeTextFormat?: KJGeologySampleRangeTextFormat
  groundwaterAnnotationStyle?: KJGeologyGroundwaterAnnotationStyle
  patternLabelStyle?: { height: number; textWidthFactor: number; minimumBandHeight: number }
  titleMarginFacts?: TitleMarginFactPlacement[]
  frameStyle?: { topMargin: number; bottomMargin: number; constantWidth: number }
  descriptionBoundaryStyle?: { inset: number; clearance: number }
  descriptionPlacements?: { groupId: string; boundaryRole: 'top' | 'bottom' | 'midpoint'; offsetMm: number;
    precedingBoundaryClearanceMm?: { left: number; right: number } }[]
  hatchLayerStyle?: { color: number; lineweight: number }
  formTopology?: { containers: 'outer-frame-separators'; headerDividers: 'merge-adjacent-collinear'; patternCells: 'closed-outline' }
  verticalScaleDenominators: number[]
  sourceTemplate?: { sourceId: string; sourceSha256: string; verticalScaleDenominator: number; innerGridWidthMillimeters: number; fieldRoles: string[]; footerLabels: string[]; gridLineHandles: string[] }
}

type HeaderRole = 'projectName' | 'holeId' | 'collarElevation' | 'depth' | 'x' | 'y' | 'startDate' | 'endDate' | 'initialWaterDepth' | 'stableWaterDepth' | 'verticalScale'
type HeaderCellGeometry = { start?: number; valueStart?: number; textStyle?: KJGeologyHeaderFactTextStyle; preserveBlankValue?: boolean }
type HeaderCell = ({ role: HeaderRole; label: string; optional?: boolean } | { role: 'documentFact'; key: string; label: string; optional?: boolean }) & HeaderCellGeometry
type FooterCell = { start: number; key: string; label: string; internalDivider?: number; textStyle?: KJGeologyFooterFactTextStyle }
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
    if (geologyLocale(input) === 'zh-CN')
      return columnLayout({ ...input, columnStylePack: KJDRAW_GEOLOGY_KNOWLEDGE_PACK })
    const height = input.pageHeightMillimeters ?? 297
    if (height !== 297 && height !== 841) throw new KJValidationError('Geology: column page height must be 297 or 841 mm')
    return { paperWidth: 210, paperHeight: height, left: 15, right: 195, columns: [32, 51, 67, 92, 147],
      headerDepth: 56, headerRowHeight: 7, fieldHeaderHeight: 10, footerReserve: 57, layerNumberStyle: 'plain', labels: geologyLocale(input) === 'zh-CN' ? chineseColumnLabels : defaultColumnLabels,
      verticalScaleDenominators: [...defaultColumnVerticalScales] }
  }
  const pack = validateKnowledgePack(input.columnStylePack)
  const rule = pack.rules?.['geology-column-layout']
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new KJValidationError('Geology: style pack has no geology-column-layout rule')
  const value = rule as Record<string, unknown>
  const isFieldGrid = value.fieldGrid != null
  const expectedKeys = [isFieldGrid ? 'fieldGrid' : 'columns', 'left', 'paperHeight', 'paperWidth', 'right']
  const keys = Object.keys(value).sort()
  if (keys.some(key => ![...expectedKeys, 'labels', 'observationColumns', 'displayAliases', 'headerDepth', 'headerRowHeight', 'fieldHeaderHeight', 'footerReserve', 'headerGrid', 'footerGrid', 'sptDisplayCap', 'legendMode', 'layerNumberStyle', 'titleHeight', 'titleTextStyle', 'textFlow', 'textHeights', 'intervalDepthTextStyle', 'majorGroupValueStyle', 'defaultTextStyle', 'roleTextStyles', 'stratigraphicNotationStyle', 'descriptionTextStyle', 'sampleMarkerStyle', 'sampleAnnotationStyle', 'sampleRangeBaselineStyle', 'sampleRangeTextFormat', 'groundwaterAnnotationStyle', 'patternLabelStyle', 'titleMarginFacts', 'frameStyle', 'descriptionBoundaryStyle', 'descriptionPlacements', 'hatchLayerStyle', 'formTopology', 'verticalScaleDenominators', 'sourceTemplate', 'pageHeightOptions'].includes(key)) || expectedKeys.some(key => !keys.includes(key))) throw new KJValidationError('Geology: style pack layout must declare five geometry fields and optional labels/observation columns')
  const paperWidth = numeric(value.paperWidth, 'style paper width'), declaredPaperHeight = numeric(value.paperHeight, 'style paper height')
  let pageHeightOption: { pageHeightMillimeters: 297 | 841; fieldTextWidthFactors?: Partial<Record<Exclude<FieldRole, 'measurement'>, number>> } | undefined
  if (value.pageHeightOptions != null) {
    if (!Array.isArray(value.pageHeightOptions) || value.pageHeightOptions.length < 1 || value.pageHeightOptions.length > 2)
      throw new KJValidationError('Geology: style page height options must declare one or two bounded sheets')
    const seenHeights = new Set<number>()
    const options = value.pageHeightOptions.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: style page height option must be a declared object')
      const option = raw as Record<string, unknown>, hasFactors = option.fieldTextWidthFactors != null
      if (Object.keys(option).sort().join(',') !== ['pageHeightMillimeters', ...(hasFactors ? ['fieldTextWidthFactors'] : [])].sort().join(','))
        throw new KJValidationError('Geology: style page height option has an undeclared field')
      const height = numeric(option.pageHeightMillimeters, `style page height option ${index + 1}`)
      if ((height !== 297 && height !== 841) || seenHeights.has(height)) throw new KJValidationError('Geology: style page heights must be unique 297 or 841 mm values')
      seenHeights.add(height)
      let fieldTextWidthFactors: Partial<Record<Exclude<FieldRole, 'measurement'>, number>> | undefined
      if (hasFactors) {
        if (!isFieldGrid || !option.fieldTextWidthFactors || typeof option.fieldTextWidthFactors !== 'object' || Array.isArray(option.fieldTextWidthFactors))
          throw new KJValidationError('Geology: long-sheet field width factors need a declared field grid')
        const supplied = option.fieldTextWidthFactors as Record<string, unknown>, roles = Object.keys(supplied)
        if (!roles.length || roles.length > fieldRoles.size - 1 || roles.some(role => role === 'measurement' || !fieldRoles.has(role as FieldRole)))
          throw new KJValidationError('Geology: long-sheet field width factors contain an undeclared role')
        fieldTextWidthFactors = Object.fromEntries(roles.map(role => {
          const factor = numeric(supplied[role], `${role} long-sheet text width factor`)
          if (factor < 0.5 || factor > 1.5) throw new KJValidationError('Geology: long-sheet text width factor must be 0.5–1.5')
          return [role, factor]
        }))
      }
      return { pageHeightMillimeters: height as 297 | 841, ...(fieldTextWidthFactors ? { fieldTextWidthFactors } : {}) }
    })
    if (!seenHeights.has(declaredPaperHeight)) throw new KJValidationError('Geology: style page height options must include the declared default height')
    const selectedHeight = input.pageHeightMillimeters ?? declaredPaperHeight
    pageHeightOption = options.find(option => option.pageHeightMillimeters === selectedHeight)
    if (!pageHeightOption) throw new KJValidationError('Geology: requested page height is not declared by the host style pack')
  } else if (input.pageHeightMillimeters != null) throw new KJValidationError('Geology: requested page height is not declared by the host style pack')
  const paperHeight = pageHeightOption?.pageHeightMillimeters ?? declaredPaperHeight
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
        const preserveBlankValue = cell.preserveBlankValue == null ? undefined : cell.preserveBlankValue
        if (preserveBlankValue != null && typeof preserveBlankValue !== 'boolean') throw new KJValidationError('Geology: header blank-value preservation flag must be boolean')
        const hasGeometry = cell.start != null || cell.valueStart != null
        if (physical !== hasGeometry || hasGeometry && (cell.start == null || cell.valueStart == null))
          throw new KJValidationError('Geology: a physical header row must declare start and valueStart for every cell')
        if (cell.textStyle != null && !physical) throw new KJValidationError('Geology: header fact text style needs a physical source cell')
        const geometry = !physical ? {} : {
          start: numeric(cell.start, `header grid start ${rowIndex + 1}/${cellIndex + 1}`),
          valueStart: numeric(cell.valueStart, `header grid value start ${rowIndex + 1}/${cellIndex + 1}`),
        }
        let textStyle: KJGeologyHeaderFactTextStyle | undefined
        if (cell.textStyle != null) {
          if (!cell.textStyle || typeof cell.textStyle !== 'object' || Array.isArray(cell.textStyle) ||
            Object.keys(cell.textStyle).sort().join(',') !== 'label,value')
            throw new KJValidationError('Geology: header fact text style must declare exact label and value placements')
          const supplied = cell.textStyle as Record<string, unknown>
          textStyle = { label: sourceTextPlacement(supplied.label, `header fact ${rowIndex + 1}/${cellIndex + 1} label`),
            value: sourceTextPlacement(supplied.value, `header fact ${rowIndex + 1}/${cellIndex + 1} value`) }
        }
        if (preserveBlankValue === true && (optional !== true || !physical || !textStyle))
          throw new KJValidationError('Geology: blank header values need an optional physical source cell with exact text placement')
        const commonKeys = ['label', 'role', ...(optional == null ? [] : ['optional']),
          ...(preserveBlankValue == null ? [] : ['preserveBlankValue']),
          ...(physical ? ['start', 'valueStart'] : []), ...(textStyle ? ['textStyle'] : [])]
        if (cell.role === 'documentFact') {
          if (Object.keys(cell).sort().join(',') !== [...commonKeys, 'key'].sort().join(',')) throw new KJValidationError(`Geology: header grid cell ${rowIndex + 1}/${cellIndex + 1} needs a document fact key, role and label`)
          const key = stableDocumentFactKey(cell.key), canonical = key.toLowerCase()
          if (documentKeys.has(canonical)) throw new KJValidationError('Geology: duplicate document fact key')
          documentKeys.add(canonical)
          return { role: 'documentFact' as const, key, label: bounded(cell.label, 'header fact label', 24), ...(optional == null ? {} : { optional }), ...geometry,
            ...(textStyle ? { textStyle } : {}), ...(preserveBlankValue == null ? {} : { preserveBlankValue }) }
        }
        if (Object.keys(cell).sort().join(',') !== commonKeys.sort().join(',') || typeof cell.role !== 'string' || !headerRoles.has(cell.role as HeaderRole)) throw new KJValidationError('Geology: undeclared header fact role')
        const role = cell.role as HeaderRole
        if (seen.has(role)) throw new KJValidationError('Geology: duplicate header fact role')
        seen.add(role)
        return { role, label: bounded(cell.label, 'header fact label', 24), ...(optional == null ? {} : { optional }), ...geometry,
          ...(textStyle ? { textStyle } : {}), ...(preserveBlankValue == null ? {} : { preserveBlankValue }) }
      })
      if (physical) for (const [cellIndex, cell] of parsed.entries()) {
        const end = parsed[cellIndex + 1]?.start ?? right
        if (cell.start! < left || cellIndex === 0 && Math.abs(cell.start! - left) > 1e-6 || end - cell.start! < 30 ||
          cell.valueStart! - cell.start! < 10 || end - cell.valueStart! < 10)
          throw new KJValidationError(`Geology: physical header cell ${rowIndex + 1}/${cellIndex + 1} is out of bounds or unreadable`)
        if (cell.textStyle) for (const [placement, laneWidth] of [[cell.textStyle.label, cell.valueStart! - cell.start!],
          [cell.textStyle.value, end - cell.valueStart!]] as [KJGeologyFieldHeaderTextPlacement, number][]) {
          if (placement.offset[0] < 0 || placement.offset[0] > laneWidth || placement.offset[1] < 0 || placement.offset[1] > headerRowHeight)
            throw new KJValidationError(`Geology: physical header cell ${rowIndex + 1}/${cellIndex + 1} text placement is outside its lane`)
        }
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
      const schema = ['label', 'role', 'start',
        ...(cell.subLabel == null ? [] : ['subLabel']),
        ...(cell.textWidthFactor == null ? [] : ['textWidthFactor']),
        ...(cell.headerTextStyle == null ? [] : ['headerTextStyle']),
        ...(role === 'measurement' ? ['key', ...(cell.decimals == null ? [] : ['decimals'])] : [])].sort().join(',')
      if (!fieldRoles.has(role) || Object.keys(cell).sort().join(',') !== schema) throw new KJValidationError('Geology: field grid column needs an exact role schema')
      const start = numeric(cell.start, `field grid start ${index + 1}`), label = bounded(cell.label, `field grid label ${index + 1}`, 32)
      const subLabel = cell.subLabel == null ? undefined : bounded(cell.subLabel, `field grid sublabel ${index + 1}`, 24)
      const textWidthFactor = cell.textWidthFactor == null ? undefined : numeric(cell.textWidthFactor, `field grid text width factor ${index + 1}`)
      let headerTextStyle: KJGeologyFieldHeaderTextStyle | undefined
      if (cell.headerTextStyle != null) {
        if (!cell.headerTextStyle || typeof cell.headerTextStyle !== 'object' || Array.isArray(cell.headerTextStyle))
          throw new KJValidationError('Geology: field header text style must be an object')
        const supplied = cell.headerTextStyle as Record<string, unknown>
        if (Object.keys(supplied).sort().join(',') !== (subLabel ? 'main,sub' : 'main'))
          throw new KJValidationError('Geology: field header text style must declare main and exactly match the field sublabel')
        headerTextStyle = { main: sourceTextPlacement(supplied.main, `field ${index + 1} main header`),
          ...(subLabel ? { sub: sourceTextPlacement(supplied.sub, `field ${index + 1} sub header`) } : {}) }
      }
      if (textWidthFactor != null && (textWidthFactor < 0.5 || textWidthFactor > 1.5)) throw new KJValidationError('Geology: field grid text width factor must be 0.5–1.5')
      if (role !== 'measurement' && roles.has(role)) throw new KJValidationError(`Geology: duplicate field role ${role}`)
      roles.add(role)
      if (role === 'measurement') {
        const key = bounded(cell.key, 'measurement key', 24)
        if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/u.test(key) || measurementKeys.has(key)) throw new KJValidationError('Geology: measurement keys must be unique safe names')
        measurementKeys.add(key)
        const decimals = cell.decimals == null ? 2 : numeric(cell.decimals, 'measurement display decimals')
        if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 4) throw new KJValidationError('Geology: measurement decimals must be 0–4')
        return { start, role, label, ...(subLabel ? { subLabel } : {}), ...(textWidthFactor == null ? {} : { textWidthFactor }),
          ...(headerTextStyle ? { headerTextStyle } : {}), key, decimals }
      }
      return { start, role, label, ...(subLabel ? { subLabel } : {}), ...(textWidthFactor == null ? {} : { textWidthFactor }),
        ...(headerTextStyle ? { headerTextStyle } : {}) }
    })
    if (requiredFieldRoles.some(role => !roles.has(role)) || Math.abs(fieldGrid[0]!.start - left) > 1e-6) throw new KJValidationError('Geology: field grid misses a core role or left margin')
    for (const [index, field] of fieldGrid.entries()) {
      const width = (fieldGrid[index + 1]?.start ?? right) - field.start
      const minimum = field.role === 'description' ? 35 : field.role === 'layerName' ? 15 :
        field.role === 'measurement' ? 7.5 : ['spt', 'pattern'].includes(field.role) ? 12 : 10
      if (width < minimum || field.start < left || field.start >= right) throw new KJValidationError(`Geology: field ${field.role} is out of bounds or unreadable`)
      for (const placement of field.headerTextStyle ? [field.headerTextStyle.main, field.headerTextStyle.sub].filter(Boolean) as KJGeologyFieldHeaderTextPlacement[] : []) {
        if (placement.offset[0] < 0 || placement.offset[0] > width || placement.offset[1] < 0 || placement.offset[1] > fieldHeaderHeight)
          throw new KJValidationError(`Geology: field ${field.role} header placement is outside its physical cell`)
      }
    }
    if (pageHeightOption?.fieldTextWidthFactors) {
      for (const role of Object.keys(pageHeightOption.fieldTextWidthFactors))
        if (!fieldGrid.some(field => field.role === role)) throw new KJValidationError(`Geology: long-sheet field role ${role} is not declared by the style pack`)
      fieldGrid = fieldGrid.map(field => {
        const factor = field.role === 'measurement' ? undefined : pageHeightOption!.fieldTextWidthFactors![field.role]
        return factor == null ? field : { ...field, textWidthFactor: factor }
      })
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
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new KJValidationError('Geology: footer cell needs an exact key, label, start and optional internal divider')
      const cell = raw as Record<string, unknown>, start = numeric(cell.start, `footer cell start ${index + 1}`)
      const schema = ['key', 'label', 'start', ...(cell.internalDivider == null ? [] : ['internalDivider']),
        ...(cell.textStyle == null ? [] : ['textStyle'])].sort().join(',')
      if (Object.keys(cell).sort().join(',') !== schema)
        throw new KJValidationError('Geology: footer cell needs an exact key, label, start and optional internal divider/text style')
      const key = stableDocumentFactKey(cell.key, 'footer fact key'), label = bounded(cell.label, 'footer fact label', 16)
      const internalDivider = cell.internalDivider == null ? undefined : numeric(cell.internalDivider, `footer cell internal divider ${index + 1}`)
      let textStyle: KJGeologyFooterFactTextStyle | undefined
      if (cell.textStyle != null) {
        if (!cell.textStyle || typeof cell.textStyle !== 'object' || Array.isArray(cell.textStyle) ||
          Object.keys(cell.textStyle).sort().join(',') !== 'label,value')
          throw new KJValidationError('Geology: footer fact text style must declare exact label and value placements')
        const supplied = cell.textStyle as Record<string, unknown>
        textStyle = { label: sourceTextPlacement(supplied.label, `footer fact ${index + 1} label`),
          value: sourceTextPlacement(supplied.value, `footer fact ${index + 1} value`) }
      }
      if (keys.has(key.toLowerCase())) throw new KJValidationError('Geology: duplicate footer fact key')
      keys.add(key.toLowerCase())
      return { start, key, label, ...(internalDivider == null ? {} : { internalDivider }), ...(textStyle ? { textStyle } : {}) }
    })
    for (const [index, cell] of parsed.entries()) {
      const end = parsed[index + 1]?.start ?? right
      if (cell.start < left || end - cell.start < 20 || index && cell.start <= parsed[index - 1]!.start ||
        cell.internalDivider != null && (cell.internalDivider - cell.start < 4 || end - cell.internalDivider < 4))
        throw new KJValidationError('Geology: footer cell is out of bounds or unreadable')
      if (cell.textStyle) for (const [placement, laneWidth] of [[cell.textStyle.label, (cell.internalDivider ?? end) - cell.start],
        [cell.textStyle.value, end - (cell.internalDivider ?? cell.start)]] as [KJGeologyFieldHeaderTextPlacement, number][]) {
        if (placement.offset[0] < 0 || placement.offset[0] > laneWidth || placement.offset[1] < 0 || placement.offset[1] > height)
          throw new KJValidationError('Geology: footer fact text placement is outside its physical lane')
      }
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
  let intervalDepthTextStyle: ColumnLayout['intervalDepthTextStyle']
  if (value.intervalDepthTextStyle != null) {
    if (!isFieldGrid || !value.intervalDepthTextStyle || typeof value.intervalDepthTextStyle !== 'object' || Array.isArray(value.intervalDepthTextStyle) ||
      Object.keys(value.intervalDepthTextStyle).sort().join(',') !== 'fieldRole,lens,principal')
      throw new KJValidationError('Geology: interval depth text style needs an exact declarative field-grid schema')
    const rule = value.intervalDepthTextStyle as Record<string, unknown>
    if (rule.fieldRole !== 'depth') throw new KJValidationError('Geology: interval depth text needs the declared depth field')
    const principal = sourceTextPlacement(rule.principal, 'principal interval depth')
    const lens = sourceTextPlacement(rule.lens, 'lens interval depth')
    const depthIndex = fieldGrid!.findIndex(field => field.role === 'depth')
    const depthWidth = depthIndex < 0 ? 0 : (fieldGrid![depthIndex + 1]?.start ?? right) - fieldGrid![depthIndex]!.start
    if (depthIndex < 0 || [principal, lens].some(placement =>
      placement.offset[0] < 0 || placement.offset[0] > depthWidth || placement.offset[1] < -5 || placement.offset[1] > 10))
      throw new KJValidationError('Geology: interval depth text placement is outside its physical lane')
    intervalDepthTextStyle = { fieldRole: 'depth', principal, lens }
  }
  let majorGroupValueStyle: ColumnLayout['majorGroupValueStyle']
  if (value.majorGroupValueStyle != null) {
    if (!isFieldGrid || !value.majorGroupValueStyle || typeof value.majorGroupValueStyle !== 'object' || Array.isArray(value.majorGroupValueStyle))
      throw new KJValidationError('Geology: major group value style needs a declarative field grid')
    const rule = value.majorGroupValueStyle as Record<string, unknown>
    const expected = ['anchor', 'baseElevation', 'layerName', 'layerNumber', 'thickness',
      ...(rule.layerNumberCircleRadius == null ? [] : ['layerNumberCircleRadius']),
      ...(rule.topBoundary == null ? [] : ['topBoundary'])].sort().join(',')
    if (Object.keys(rule).sort().join(',') !== expected || rule.anchor !== 'major-group-midpoint')
      throw new KJValidationError('Geology: major group value style needs an exact source-backed schema')
    const roles = ['layerNumber', 'layerName', 'baseElevation', 'thickness'] as const
    const placements = Object.fromEntries(roles.map(role => [role,
      sourceTextPlacement(rule[role], `major group ${role}`)])) as Pick<KJGeologyMajorGroupValueStyle,
        'layerNumber' | 'layerName' | 'baseElevation' | 'thickness'>
    for (const role of roles) {
      const fieldIndex = fieldGrid!.findIndex(field => field.role === role)
      const width = fieldIndex < 0 ? 0 : (fieldGrid![fieldIndex + 1]?.start ?? right) - fieldGrid![fieldIndex]!.start
      const placement = placements[role]
      if (fieldIndex < 0 || placement.offset[0] < 0 || placement.offset[0] > width ||
        placement.offset[1] < -50 || placement.offset[1] > 50)
        throw new KJValidationError(`Geology: major group ${role} placement is outside its physical lane`)
    }
    let topBoundary: KJGeologyMajorGroupValueStyle['topBoundary']
    if (rule.topBoundary != null) {
      if (!rule.topBoundary || typeof rule.topBoundary !== 'object' || Array.isArray(rule.topBoundary) ||
        Object.keys(rule.topBoundary).sort().join(',') !== 'layerName')
        throw new KJValidationError('Geology: major group top-boundary style needs an exact layer-name placement')
      const topRule = rule.topBoundary as Record<string, unknown>
      const layerName = sourceTextPlacement(topRule.layerName, 'top-boundary major group layerName')
      const nameIndex = fieldGrid!.findIndex(field => field.role === 'layerName')
      const nameWidth = (fieldGrid![nameIndex + 1]?.start ?? right) - fieldGrid![nameIndex]!.start
      if (layerName.offset[0] < 0 || layerName.offset[0] > nameWidth || layerName.offset[1] < -50 || layerName.offset[1] > 50)
        throw new KJValidationError('Geology: top-boundary major group layerName placement is outside its physical lane')
      topBoundary = { layerName }
    }
    const layerNumberCircleRadius = rule.layerNumberCircleRadius == null ? undefined :
      numeric(rule.layerNumberCircleRadius, 'major group layer number circle radius')
    const numberIndex = fieldGrid!.findIndex(field => field.role === 'layerNumber')
    const numberWidth = (fieldGrid![numberIndex + 1]?.start ?? right) - fieldGrid![numberIndex]!.start
    if (layerNumberCircleRadius != null && (layerNumberCircleRadius < 1 || layerNumberCircleRadius > 10 ||
      layerNumberCircleRadius > numberWidth / 2 - .2))
      throw new KJValidationError('Geology: major group layer number circle radius is outside its physical lane')
    majorGroupValueStyle = { anchor: 'major-group-midpoint', ...placements, ...(topBoundary ? { topBoundary } : {}),
      ...(layerNumberCircleRadius == null ? {} : { layerNumberCircleRadius }) }
  }
  let titleTextStyle: ColumnLayout['titleTextStyle']
  if (value.titleTextStyle != null) {
    if (!isFieldGrid || !headerGrid || !value.titleTextStyle || typeof value.titleTextStyle !== 'object' || Array.isArray(value.titleTextStyle) ||
      Object.keys(value.titleTextStyle).sort().join(',') !== 'anchor,placement,rotationDegrees')
      throw new KJValidationError('Geology: title text style needs an exact physical-header schema')
    const rule = value.titleTextStyle as Record<string, unknown>
    if (rule.anchor !== 'frame-left-top') throw new KJValidationError('Geology: title text style needs the physical frame upper-left anchor')
    const placement = sourceTextPlacement(rule.placement, 'main title', 3, 12)
    const rotationDegrees = numeric(rule.rotationDegrees, 'main title rotation')
    if (Math.abs(placement.height - titleHeight) > 1e-9 || placement.offset[0] < 0 || placement.offset[0] > right - left ||
      placement.offset[1] < -50 || placement.offset[1] > 0 || rotationDegrees !== 0)
      throw new KJValidationError('Geology: title text style is outside the readable title band')
    titleTextStyle = { anchor: 'frame-left-top', placement, rotationDegrees }
  }
  const sourceLocalTextStyle = (raw: unknown, label: string): KJGeologyDefaultTextStyle => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).sort().join(',') !== 'bigFontFile,dxfFlags,fixedHeight,fontFamily,fontFile,generationFlags,name,obliqueAngleDegrees,widthFactor')
      throw new KJValidationError(`Geology: ${label} text style needs an exact declarative field-grid schema`)
    const rule = raw as Record<string, unknown>
    const safeName = (raw: unknown, label: string, empty = false): string => {
      if (typeof raw !== 'string' || raw.length > 128 || !empty && !raw.length || /[\\/:\u0000-\u001f\u007f]/u.test(raw) || /^(?:data|https?)/iu.test(raw))
        throw new KJValidationError(`Geology: invalid ${label}`)
      return raw
    }
    const name = safeName(rule.name, `${label} text style name`)
    const fontFamily = safeName(rule.fontFamily, `${label} text font family`)
    const fontFile = safeName(rule.fontFile, `${label} text font file`)
    const bigFontFile = safeName(rule.bigFontFile, `${label} text big-font file`, true)
    const fixedHeight = numeric(rule.fixedHeight, `${label} text fixed height`)
    const widthFactor = numeric(rule.widthFactor, `${label} text width factor`)
    const obliqueAngleDegrees = numeric(rule.obliqueAngleDegrees, `${label} text oblique angle`)
    const dxfFlags = numeric(rule.dxfFlags, `${label} text DXF flags`)
    const generationFlags = numeric(rule.generationFlags, `${label} text generation flags`)
    if (fixedHeight !== 0 || widthFactor < 0.5 || widthFactor > 1.5 || obliqueAngleDegrees < -45 || obliqueAngleDegrees > 45 ||
      !Number.isSafeInteger(dxfFlags) || dxfFlags < 0 || dxfFlags > 255 || !Number.isSafeInteger(generationFlags) || generationFlags < 0 || generationFlags > 7)
      throw new KJValidationError(`Geology: ${label} text style is unreadable or unsafe`)
    return { name, fontFamily, fontFile, bigFontFile, fixedHeight, widthFactor, obliqueAngleDegrees, dxfFlags, generationFlags }
  }
  let defaultTextStyle: ColumnLayout['defaultTextStyle']
  if (value.defaultTextStyle != null) {
    if (!isFieldGrid) throw new KJValidationError('Geology: default text style needs an exact declarative field-grid schema')
    defaultTextStyle = sourceLocalTextStyle(value.defaultTextStyle, 'default')
  }
  let roleTextStyles: ColumnLayout['roleTextStyles']
  if (value.roleTextStyles != null) {
    if (!isFieldGrid || !value.roleTextStyles || typeof value.roleTextStyles !== 'object' || Array.isArray(value.roleTextStyles))
      throw new KJValidationError('Geology: role text styles need a declarative field-grid object')
    const roles = Object.keys(value.roleTextStyles)
    if (!roles.length || roles.some(role => !['layerName', 'patternLabel'].includes(role)))
      throw new KJValidationError('Geology: role text styles need at least one supported semantic role')
    const raw = value.roleTextStyles as Record<string, unknown>
    roleTextStyles = Object.fromEntries(roles.map(role => [role, sourceLocalTextStyle(raw[role], `${role} role`)])) as KJGeologyRoleTextStyles
  }
  const styleNames = [defaultTextStyle, ...Object.values(roleTextStyles ?? {})].filter((item): item is KJGeologyDefaultTextStyle => item != null)
    .map(item => item.name.toLocaleLowerCase('en-US'))
  if (new Set(styleNames).size !== styleNames.length) throw new KJValidationError('Geology: text style names must be unique')
  let stratigraphicNotationStyle: ColumnLayout['stratigraphicNotationStyle']
  if (value.stratigraphicNotationStyle != null) {
    if (!isFieldGrid || !value.stratigraphicNotationStyle || typeof value.stratigraphicNotationStyle !== 'object' || Array.isArray(value.stratigraphicNotationStyle) ||
      !['qualifierHeight,symbolHeight', 'placement,qualifierHeight,symbolHeight'].includes(Object.keys(value.stratigraphicNotationStyle).sort().join(',')))
      throw new KJValidationError('Geology: stratigraphic notation style needs an exact declarative field-grid schema')
    const rule = value.stratigraphicNotationStyle as Record<string, unknown>
    const symbolHeight = numeric(rule.symbolHeight, 'stratigraphic notation symbol height')
    const qualifierHeight = numeric(rule.qualifierHeight, 'stratigraphic notation qualifier height')
    if (symbolHeight < 1.5 || symbolHeight > 5 || qualifierHeight < 1 || qualifierHeight > symbolHeight)
      throw new KJValidationError('Geology: stratigraphic notation text heights are unreadable')
    let placement: KJGeologyStratigraphicNotationStyle['placement']
    if (rule.placement != null) {
      if (!rule.placement || typeof rule.placement !== 'object' || Array.isArray(rule.placement) ||
        Object.keys(rule.placement).sort().join(',') !== 'anchor,fieldRole,principal,topBoundary')
        throw new KJValidationError('Geology: stratigraphic notation placement needs an exact semantic schema')
      const supplied = rule.placement as Record<string, unknown>
      if (supplied.fieldRole !== 'layerName' || supplied.anchor !== 'major-group-midpoint')
        throw new KJValidationError('Geology: stratigraphic notation placement needs the layer-name field and major-group midpoint')
      const parseSet = (raw: unknown, label: string): KJGeologyStratigraphicNotationPlacementSet => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'subscript,superscript,symbol')
          throw new KJValidationError(`Geology: ${label} needs exact symbol and qualifier placements`)
        const set = raw as Record<string, unknown>
        const parsed = { symbol: sourceTextPlacement(set.symbol, `${label} symbol`),
          superscript: sourceTextPlacement(set.superscript, `${label} superscript`, 1),
          subscript: sourceTextPlacement(set.subscript, `${label} subscript`, 1) }
        if (Math.abs(parsed.symbol.height - symbolHeight) > 1e-9 ||
          Math.abs(parsed.superscript.height - qualifierHeight) > 1e-9 || Math.abs(parsed.subscript.height - qualifierHeight) > 1e-9)
          throw new KJValidationError('Geology: stratigraphic notation placement heights must match its declared text heights')
        return parsed
      }
      const principal = parseSet(supplied.principal, 'principal stratigraphic notation')
      const topBoundary = parseSet(supplied.topBoundary, 'top-boundary stratigraphic notation')
      const layerName = fieldGrid?.find(item => item.role === 'layerName')!
      const layerWidth = (fieldGrid?.[fieldGrid.indexOf(layerName) + 1]?.start ?? right) - layerName.start
      for (const item of [principal.symbol, principal.superscript, principal.subscript,
        topBoundary.symbol, topBoundary.superscript, topBoundary.subscript]) {
        if (item.offset[0] < 0 || item.offset[0] > layerWidth || item.offset[1] < -15 || item.offset[1] > 15)
          throw new KJValidationError('Geology: stratigraphic notation placement is outside its source-backed lane')
      }
      placement = { fieldRole: 'layerName', anchor: 'major-group-midpoint', principal, topBoundary }
    }
    stratigraphicNotationStyle = { symbolHeight, qualifierHeight, ...(placement ? { placement } : {}) }
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
  let sampleAnnotationStyle: ColumnLayout['sampleAnnotationStyle']
  if (value.sampleAnnotationStyle != null) {
    if (!isFieldGrid || !value.sampleAnnotationStyle || typeof value.sampleAnnotationStyle !== 'object' || Array.isArray(value.sampleAnnotationStyle) ||
      Object.keys(value.sampleAnnotationStyle).sort().join(',') !== 'depthAnchor,label,marker')
      throw new KJValidationError('Geology: sample annotation style needs an exact declarative field-grid schema')
    const rule = value.sampleAnnotationStyle as Record<string, unknown>
    if (!['observation-depth', 'range-top', 'range-bottom'].includes(rule.depthAnchor as string))
      throw new KJValidationError('Geology: sample annotation depth anchor is unsupported')
    const label = sourceTextPlacement(rule.label, 'sample annotation label')
    const marker = sourceTextPlacement(rule.marker, 'sample annotation marker', 0.8)
    const sampleIndex = fieldGrid!.findIndex(field => field.role === 'sample')
    const sampleWidth = sampleIndex < 0 ? 0 : (fieldGrid![sampleIndex + 1]?.start ?? right) - fieldGrid![sampleIndex]!.start
    if (sampleIndex < 0 || [label, marker].some(placement =>
      placement.offset[0] < 0 || placement.offset[0] > sampleWidth || placement.offset[1] < -10 || placement.offset[1] > 10))
      throw new KJValidationError('Geology: sample annotation placement is outside its physical lane')
    sampleAnnotationStyle = { depthAnchor: rule.depthAnchor as KJGeologySampleAnnotationStyle['depthAnchor'], label, marker }
  }
  let sampleRangeBaselineStyle: ColumnLayout['sampleRangeBaselineStyle']
  if (value.sampleRangeBaselineStyle != null) {
    const baselineKeys = value.sampleRangeBaselineStyle && typeof value.sampleRangeBaselineStyle === 'object' && !Array.isArray(value.sampleRangeBaselineStyle)
      ? Object.keys(value.sampleRangeBaselineStyle).sort().join(',') : ''
    if (!isFieldGrid || !value.sampleRangeBaselineStyle || typeof value.sampleRangeBaselineStyle !== 'object' || Array.isArray(value.sampleRangeBaselineStyle) ||
      !['boundaries,continuity,insetMm', 'boundaries,continuity,endInsetMm,fieldRole,startInsetMm'].includes(baselineKeys))
      throw new KJValidationError('Geology: sample range baselines need an exact declarative field-grid schema')
    const rule = value.sampleRangeBaselineStyle as Record<string, unknown>
    if (!Array.isArray(rule.boundaries) || rule.boundaries.length < 1 || rule.boundaries.length > 2 ||
      rule.boundaries.some(boundary => boundary !== 'top' && boundary !== 'bottom') || new Set(rule.boundaries).size !== rule.boundaries.length)
      throw new KJValidationError('Geology: sample range baseline boundaries must contain unique top/bottom roles')
    if (rule.continuity !== 'collision-safe' && rule.continuity !== 'continuous')
      throw new KJValidationError('Geology: sample range baseline continuity must be collision-safe or continuous')
    const sampleIndex = fieldGrid!.findIndex(field => field.role === 'sample')
    const sampleWidth = sampleIndex < 0 ? 0 : (fieldGrid![sampleIndex + 1]?.start ?? right) - fieldGrid![sampleIndex]!.start
    const asymmetric = baselineKeys.includes('startInsetMm')
    if (asymmetric && rule.fieldRole !== 'sample') throw new KJValidationError('Geology: asymmetric sample range baseline needs the declared sample field')
    const startInsetMm = numeric(asymmetric ? rule.startInsetMm : rule.insetMm, 'sample range baseline start inset')
    const endInsetMm = numeric(asymmetric ? rule.endInsetMm : rule.insetMm, 'sample range baseline end inset')
    if (sampleIndex < 0 || startInsetMm < 0 || endInsetMm < 0 || sampleWidth - startInsetMm - endInsetMm < 0.4)
      throw new KJValidationError('Geology: sample range baseline inset leaves no visible source lane')
    sampleRangeBaselineStyle = { boundaries: rule.boundaries as ('top' | 'bottom')[],
      continuity: rule.continuity, ...(asymmetric
        ? { fieldRole: 'sample' as const, startInsetMm, endInsetMm }
        : { insetMm: startInsetMm }) }
  }
  let sampleRangeTextFormat: ColumnLayout['sampleRangeTextFormat']
  if (value.sampleRangeTextFormat != null) {
    const formatKeys = value.sampleRangeTextFormat && typeof value.sampleRangeTextFormat === 'object' && !Array.isArray(value.sampleRangeTextFormat)
      ? Object.keys(value.sampleRangeTextFormat).sort().join(',') : ''
    if (!isFieldGrid || !value.sampleRangeTextFormat || typeof value.sampleRangeTextFormat !== 'object' || Array.isArray(value.sampleRangeTextFormat) ||
      !['decimals,fieldRole,prefix,separator,suffix,trailingZeros',
        'anchor,decimals,fieldRole,placement,prefix,separator,suffix,trailingZeros'].includes(formatKeys))
      throw new KJValidationError('Geology: sample range text format needs an exact declarative field-grid schema')
    const rule = value.sampleRangeTextFormat as Record<string, unknown>
    const textPart = (raw: unknown, label: string, maximum: number, allowEmpty: boolean): string => {
      if (typeof raw !== 'string' || !allowEmpty && !raw.length || Array.from(raw).length > maximum || /[\u0000-\u001f\u007f]/u.test(raw))
        throw new KJValidationError(`Geology: invalid sample range ${label}`)
      return raw
    }
    const prefix = textPart(rule.prefix, 'prefix', 12, true)
    const separator = textPart(rule.separator, 'separator', 4, false)
    const suffix = textPart(rule.suffix, 'suffix', 12, true)
    const decimals = numeric(rule.decimals, 'sample range decimals')
    if (rule.fieldRole !== 'sample' || !Number.isInteger(decimals) || decimals < 0 || decimals > 4 ||
      rule.trailingZeros !== 'preserve' && rule.trailingZeros !== 'trim' || !fieldGrid!.some(field => field.role === 'sample'))
      throw new KJValidationError('Geology: sample range text format is unreadable')
    let anchor: KJGeologySampleRangeTextFormat['anchor']
    let placement: KJGeologyFieldHeaderTextPlacement | undefined
    if (formatKeys.startsWith('anchor,')) {
      if (rule.anchor !== 'range-top' && rule.anchor !== 'range-midpoint' && rule.anchor !== 'range-bottom')
        throw new KJValidationError('Geology: sample range text anchor must be the measured interval top, midpoint or bottom')
      anchor = rule.anchor
      placement = sourceTextPlacement(rule.placement, 'sample range text')
      const sampleIndex = fieldGrid!.findIndex(field => field.role === 'sample')
      const sampleWidth = (fieldGrid![sampleIndex + 1]?.start ?? right) - fieldGrid![sampleIndex]!.start
      if (placement.offset[0] < 0 || placement.offset[0] > sampleWidth || placement.offset[1] < -10 || placement.offset[1] > 10)
        throw new KJValidationError('Geology: sample range text placement is outside its physical lane')
    }
    sampleRangeTextFormat = { fieldRole: 'sample', prefix, separator, suffix, decimals,
      trailingZeros: rule.trailingZeros as 'preserve' | 'trim', ...(placement ? { anchor: anchor!, placement } : {}) }
  }
  let groundwaterAnnotationStyle: ColumnLayout['groundwaterAnnotationStyle']
  if (value.groundwaterAnnotationStyle != null) {
    const groundwaterStyleKeys = Object.keys(value.groundwaterAnnotationStyle).sort().join(',')
    if (!isFieldGrid || !value.groundwaterAnnotationStyle || typeof value.groundwaterAnnotationStyle !== 'object' || Array.isArray(value.groundwaterAnnotationStyle) ||
      !['dateOffset,fieldRole,gap,markerHeight,markerOffset,textHeight,textWidthFactor,valueOffset',
        'dateOffset,fieldRole,gap,guide,markerHeight,markerOffset,textHeight,textWidthFactor,valueOffset',
        'dateOffset,fieldRole,gap,guide,guideEndpointOffset,markerHeight,markerOffset,textHeight,textWidthFactor,valueOffset',
        'dateOffset,fieldRole,gap,markerHeight,markerOffset,placements,textHeight,textWidthFactor,valueOffset',
        'dateOffset,fieldRole,gap,guide,markerHeight,markerOffset,placements,textHeight,textWidthFactor,valueOffset',
        'dateOffset,fieldRole,gap,guide,guideEndpointOffset,markerHeight,markerOffset,placements,textHeight,textWidthFactor,valueOffset'].includes(groundwaterStyleKeys))
      throw new KJValidationError('Geology: groundwater annotation style needs an exact declarative field-grid schema')
    const rule = value.groundwaterAnnotationStyle as Record<string, unknown>
    if (rule.fieldRole !== 'pattern') throw new KJValidationError('Geology: groundwater annotations need a declared pattern field')
    if (rule.guide != null && rule.guide !== 'field-top-to-reading')
      throw new KJValidationError('Geology: unsupported groundwater annotation guide')
    let guideEndpointOffset: [number, number] | undefined
    if (rule.guideEndpointOffset != null) {
      if (rule.guide !== 'field-top-to-reading' || !Array.isArray(rule.guideEndpointOffset) || rule.guideEndpointOffset.length !== 2)
        throw new KJValidationError('Geology: groundwater guide endpoint offset needs a declared guide and two coordinates')
      guideEndpointOffset = rule.guideEndpointOffset.map((coordinate, index) =>
        numeric(coordinate, `groundwater guide endpoint offset ${index + 1}`)) as [number, number]
      if (guideEndpointOffset.some(coordinate => coordinate < -2 || coordinate > 2))
        throw new KJValidationError('Geology: groundwater guide endpoint offset is outside its physical lane')
    }
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
    let placements: KJGeologyGroundwaterAnnotationStyle['placements']
    if (rule.placements != null) {
      if (!rule.placements || typeof rule.placements !== 'object' || Array.isArray(rule.placements) ||
        Object.keys(rule.placements).sort().join(',') !== 'depth,elevation,marker,observedOn')
        throw new KJValidationError('Geology: groundwater placements need exact depth, elevation, marker and observedOn roles')
      const supplied = rule.placements as Record<string, unknown>
      placements = { depth: sourceTextPlacement(supplied.depth, 'groundwater depth'),
        elevation: sourceTextPlacement(supplied.elevation, 'groundwater elevation'),
        marker: sourceTextPlacement(supplied.marker, 'groundwater marker', 0.8),
        observedOn: sourceTextPlacement(supplied.observedOn, 'groundwater observedOn') }
      const patternIndex = fieldGrid!.findIndex(field => field.role === 'pattern')
      const patternWidth = patternIndex < 0 ? 0 : (fieldGrid![patternIndex + 1]?.start ?? right) - fieldGrid![patternIndex]!.start
      if (patternIndex < 0 || Object.values(placements).some(placement => placement.offset[0] < 0 || placement.offset[0] > patternWidth ||
        placement.offset[1] < -10 || placement.offset[1] > 10))
        throw new KJValidationError('Geology: groundwater placement is outside its physical lane')
      if ([placements.depth, placements.elevation, placements.observedOn].some(placement => placement.height !== textHeight ||
        placement.textWidthFactor !== textWidthFactor) || placements.marker.height !== markerHeight || placements.marker.textWidthFactor !== textWidthFactor)
        throw new KJValidationError('Geology: groundwater placements must match the declared text metrics')
    }
    groundwaterAnnotationStyle = { fieldRole: 'pattern', textHeight, markerHeight, textWidthFactor, gap, valueOffset, markerOffset, dateOffset,
      ...(placements ? { placements } : {}),
      ...(guideEndpointOffset ? { guideEndpointOffset } : {}),
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
  let descriptionTextStyle: ColumnLayout['descriptionTextStyle']
  if (value.descriptionTextStyle != null) {
    if (!isFieldGrid || !value.descriptionTextStyle || typeof value.descriptionTextStyle !== 'object' || Array.isArray(value.descriptionTextStyle) ||
      !['anchor,fieldRole,height', 'anchor,fieldRole,height,width'].includes(Object.keys(value.descriptionTextStyle).sort().join(',')))
      throw new KJValidationError('Geology: description text style needs an exact declarative field-grid schema')
    const rule = value.descriptionTextStyle as Record<string, unknown>
    const height = numeric(rule.height, 'description text height')
    if (rule.fieldRole !== 'description' || rule.anchor !== 'declared-major-group-boundary' || height < 1.5 || height > 5)
      throw new KJValidationError('Geology: description text style needs the description field and declared group boundary anchors')
    const width = rule.width == null ? undefined : numeric(rule.width, 'description text width')
    const descriptionIndex = fieldGrid!.findIndex(field => field.role === 'description')
    const descriptionWidth = descriptionIndex < 0 ? 0 : (fieldGrid![descriptionIndex + 1]?.start ?? right) - fieldGrid![descriptionIndex]!.start
    if (width != null && (width < height * 2 || width > descriptionWidth))
      throw new KJValidationError('Geology: description text width is outside its physical field')
    descriptionTextStyle = { fieldRole: 'description', anchor: 'declared-major-group-boundary', height,
      ...(width == null ? {} : { width }) }
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
  let descriptionPlacements: ColumnLayout['descriptionPlacements']
  if (value.descriptionPlacements != null) {
    if (!isFieldGrid || !descriptionTextStyle || !Array.isArray(value.descriptionPlacements) ||
      value.descriptionPlacements.length < 1 || value.descriptionPlacements.length > 80)
      throw new KJValidationError('Geology: description placements need a bounded field-grid knowledge rule')
    descriptionPlacements = value.descriptionPlacements.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new KJValidationError(`Geology: description placement rule ${index + 1} must be an object`)
      const item = raw as Record<string, unknown>
      if (!['boundaryRole,groupId,offsetMm', 'boundaryRole,groupId,offsetMm,precedingBoundaryClearanceMm']
        .includes(Object.keys(item).sort().join(',')) || !['top', 'bottom', 'midpoint'].includes(String(item.boundaryRole)))
        throw new KJValidationError('Geology: description placement rules need an exact group-boundary schema')
      const groupId = bounded(item.groupId, 'description placement group ID', 24)
      const offsetMm = numeric(item.offsetMm, 'description placement offset')
      if (offsetMm < -50 || offsetMm > 50)
        throw new KJValidationError('Geology: description placement offset is outside the readable body')
      let precedingBoundaryClearanceMm: { left: number; right: number } | undefined
      if (item.precedingBoundaryClearanceMm != null) {
        const clearance = item.precedingBoundaryClearanceMm
        if (!clearance || typeof clearance !== 'object' || Array.isArray(clearance) ||
          Object.keys(clearance).sort().join(',') !== 'left,right')
          throw new KJValidationError('Geology: preceding description boundary clearance needs exact left and right measurements')
        const record = clearance as Record<string, unknown>
        const left = numeric(record.left, 'left preceding description boundary clearance')
        const right = numeric(record.right, 'right preceding description boundary clearance')
        if (!descriptionBoundaryStyle || left < 0.2 || left > 5 || right < 0.2 || right > 5)
          throw new KJValidationError('Geology: preceding description boundary clearance is unreadable')
        precedingBoundaryClearanceMm = { left, right }
      }
      return { groupId, boundaryRole: item.boundaryRole as 'top' | 'bottom' | 'midpoint', offsetMm,
        ...(precedingBoundaryClearanceMm ? { precedingBoundaryClearanceMm } : {}) }
    })
    if (new Set(descriptionPlacements.map(item => item.groupId)).size !== descriptionPlacements.length)
      throw new KJValidationError('Geology: description placement group IDs must be unique')
  }
  let hatchLayerStyle: ColumnLayout['hatchLayerStyle']
  if (value.hatchLayerStyle != null) {
    if (!value.hatchLayerStyle || typeof value.hatchLayerStyle !== 'object' || Array.isArray(value.hatchLayerStyle) ||
      Object.keys(value.hatchLayerStyle).sort().join(',') !== 'color,lineweight')
      throw new KJValidationError('Geology: hatch layer style needs an exact declarative schema')
    const rule = value.hatchLayerStyle as Record<string, unknown>
    const color = numeric(rule.color, 'hatch layer color'), lineweight = numeric(rule.lineweight, 'hatch layer lineweight')
    const lineweights = new Set([-3, -2, -1, 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211])
    if (!Number.isSafeInteger(color) || color < 1 || color > 255 || !Number.isSafeInteger(lineweight) || !lineweights.has(lineweight))
      throw new KJValidationError('Geology: hatch layer style is outside supported CAD values')
    hatchLayerStyle = { color, lineweight }
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
    ...(displayAliases ? { displayAliases } : {}), ...(headerGrid ? { headerGrid } : {}), ...(footerGrid ? { footerGrid } : {}), ...(fieldGrid ? { fieldGrid } : {}), ...(textFlow ? { textFlow } : {}), ...(textHeights ? { textHeights } : {}), ...(intervalDepthTextStyle ? { intervalDepthTextStyle } : {}), ...(majorGroupValueStyle ? { majorGroupValueStyle } : {}), ...(titleTextStyle ? { titleTextStyle } : {}), ...(defaultTextStyle ? { defaultTextStyle } : {}), ...(roleTextStyles ? { roleTextStyles } : {}),
    ...(stratigraphicNotationStyle ? { stratigraphicNotationStyle } : {}), ...(sampleMarkerStyle ? { sampleMarkerStyle } : {}),
    ...(sampleAnnotationStyle ? { sampleAnnotationStyle } : {}),
    ...(sampleRangeBaselineStyle ? { sampleRangeBaselineStyle } : {}),
    ...(sampleRangeTextFormat ? { sampleRangeTextFormat } : {}),
    ...(groundwaterAnnotationStyle ? { groundwaterAnnotationStyle } : {}), ...(patternLabelStyle ? { patternLabelStyle } : {}),
    ...(titleMarginFacts ? { titleMarginFacts } : {}),
    ...(frameStyle ? { frameStyle } : {}), ...(descriptionTextStyle ? { descriptionTextStyle } : {}),
    ...(descriptionBoundaryStyle ? { descriptionBoundaryStyle } : {}),
    ...(descriptionPlacements ? { descriptionPlacements } : {}),
    ...(hatchLayerStyle ? { hatchLayerStyle } : {}),
    ...(formTopology ? { formTopology } : {}),
    ...(sourceTemplate ? { sourceTemplate } : {}) }
}

function sectionLayout(input: KJGeologySectionInput): SectionLayout {
  const pack = validateKnowledgePack(input.sectionStylePack ?? KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  const raw = pack.rules?.['geology-section-layout']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError('Geology: bundled section layout is missing')
  const value = raw as Record<string, unknown>
  const scalarKeys = ['paperWidth', 'paperHeight', 'plotLeft', 'plotRight', 'plotBottom', 'plotTop', 'titleY', 'scaleY', 'footerHeight', 'boreholeWidth', 'elevationTickStep'] as const
  const hasOuterMargins = value.outerMargins != null, hasInnerMargins = value.innerMargins != null
  const expectedKeys = [...scalarKeys, 'footerGrid', hasOuterMargins ? 'outerMargins' : 'outerMargin',
    hasInnerMargins ? 'innerMargins' : 'innerMargin', ...(value.drawingOrigin == null ? [] : ['drawingOrigin']), ...(value.frameStyle == null ? [] : ['frameStyle']),
    ...(value.sectionTextStyle == null ? [] : ['sectionTextStyle']),
    ...(value.sectionHatchPresentation == null ? [] : ['sectionHatchPresentation']),
    ...(value.elevationTickSequence == null ? [] : ['elevationTickSequence']),
    ...(value.sourceBackedBands == null ? [] : ['sourceBackedBands']),
    ...(value.boreholeProfileStyle == null ? [] : ['boreholeProfileStyle']),
    ...(value.elevationScaleRailStyle == null ? [] : ['elevationScaleRailStyle']),
    ...(value.sourceBackedPatternSymbols == null ? [] : ['sourceBackedPatternSymbols']),
    ...(value.sourceBackedBoundaryPolylines == null ? [] : ['sourceBackedBoundaryPolylines']),
    ...(value.stratigraphicGroupLabelStyle == null ? [] : ['stratigraphicGroupLabelStyle']),
    ...(value.sourceBackedStratigraphicGroupLabels == null ? [] : ['sourceBackedStratigraphicGroupLabels']),
    ...(value.headingTextStyle == null ? [] : ['headingTextStyle']), ...(value.footerFrameStyle == null ? [] : ['footerFrameStyle']), ...(value.sectionReferenceStyle == null ? [] : ['sectionReferenceStyle']), ...(value.observationSymbolStyle == null ? [] : ['observationSymbolStyle'])]
  if (Object.keys(value).sort().join(',') !== expectedKeys.sort().join(',')) throw new KJValidationError('Geology: section layout has an undeclared field')
  const scalars = Object.fromEntries(scalarKeys.map(key => [key, numeric(value[key], `section ${key}`)])) as unknown as Omit<SectionLayout, 'footerGrid' | 'drawingOrigin' | 'outerMargins' | 'innerMargins' | 'frameStyle' | 'headingTextStyle'>
  const parseHeadingTextRule = (raw: unknown, label: string): SectionHeadingTextRule => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'anchorX,height,horizontalAlignment,textWidthFactor,verticalAlignment')
      throw new KJValidationError(`Geology: section ${label} heading style needs an exact placement schema`)
    const rule = raw as Record<string, unknown>, anchorX = numeric(rule.anchorX, `section ${label} heading anchor X`)
    const height = numeric(rule.height, `section ${label} heading height`)
    const textWidthFactor = numeric(rule.textWidthFactor, `section ${label} heading text width factor`)
    if (height < 0.5 || height > 12 || textWidthFactor < 0.2 || textWidthFactor > 2 ||
      ![0, 1, 2, 4].includes(rule.horizontalAlignment as number) || ![0, 1, 2, 3].includes(rule.verticalAlignment as number))
      throw new KJValidationError(`Geology: section ${label} heading style is out of bounds`)
    return { anchorX, height, textWidthFactor, horizontalAlignment: rule.horizontalAlignment as SectionHeadingTextRule['horizontalAlignment'],
      verticalAlignment: rule.verticalAlignment as SectionHeadingTextRule['verticalAlignment'] }
  }
  let headingTextStyle: SectionLayout['headingTextStyle']
  if (value.headingTextStyle != null) {
    if (!value.headingTextStyle || typeof value.headingTextStyle !== 'object' || Array.isArray(value.headingTextStyle) || Object.keys(value.headingTextStyle).sort().join(',') !== 'scale,title')
      throw new KJValidationError('Geology: section heading text style needs exact title and scale rules')
    const supplied = value.headingTextStyle as Record<string, unknown>
    headingTextStyle = { title: parseHeadingTextRule(supplied.title, 'title'), scale: parseHeadingTextRule(supplied.scale, 'scale') }
  }
  const placementKeys = ['height', 'horizontalAlignment', 'offset', 'textWidthFactor', 'verticalAlignment']
  const parseSectionTextPlacement = (raw: unknown, label: string, extras: string[] = []): SectionTextPlacementRule => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).sort().join(',') !== [...placementKeys, ...extras].sort().join(','))
      throw new KJValidationError(`Geology: section ${label} text role needs an exact placement schema`)
    const rule = raw as Record<string, unknown>
    if (!Array.isArray(rule.offset) || rule.offset.length !== 2)
      throw new KJValidationError(`Geology: section ${label} text offset needs two millimetre coordinates`)
    const offset = rule.offset.map((value, index) => numeric(value, `section ${label} text offset ${index + 1}`)) as [number, number]
    const height = numeric(rule.height, `section ${label} text height`)
    const textWidthFactor = numeric(rule.textWidthFactor, `section ${label} text width factor`)
    if (offset.some(value => Math.abs(value) > 80) || height < 0.5 || height > 8 || textWidthFactor < 0.2 || textWidthFactor > 2 ||
      ![0, 1, 2, 4].includes(rule.horizontalAlignment as number) || ![0, 1, 2, 3].includes(rule.verticalAlignment as number))
      throw new KJValidationError(`Geology: section ${label} text role is out of bounds`)
    return { offset, height, textWidthFactor, horizontalAlignment: rule.horizontalAlignment as SectionTextPlacementRule['horizontalAlignment'],
      verticalAlignment: rule.verticalAlignment as SectionTextPlacementRule['verticalAlignment'] }
  }
  const precision = (raw: unknown, label: string): 0 | 1 | 2 | 3 | 4 => {
    const value = numeric(raw, `section ${label} precision`)
    if (!Number.isInteger(value) || value < 0 || value > 4) throw new KJValidationError(`Geology: section ${label} precision is out of bounds`)
    return value as 0 | 1 | 2 | 3 | 4
  }
  let stratigraphicGroupLabelStyle: SectionLayout['stratigraphicGroupLabelStyle']
  if (value.stratigraphicGroupLabelStyle != null) {
    if (!value.stratigraphicGroupLabelStyle || typeof value.stratigraphicGroupLabelStyle !== 'object' ||
      Array.isArray(value.stratigraphicGroupLabelStyle) ||
      Object.keys(value.stratigraphicGroupLabelStyle).sort().join(',') !== 'code,subscript,superscript,symbol')
      throw new KJValidationError('Geology: section stratigraphic group label style needs exact code and notation roles')
    const supplied = value.stratigraphicGroupLabelStyle as Record<string, unknown>
    if (!supplied.code || typeof supplied.code !== 'object' || Array.isArray(supplied.code) ||
      Object.keys(supplied.code).sort().join(',') !== 'fitEndOffset,height,offset,textWidthFactor,verticalAlignment')
      throw new KJValidationError('Geology: section stratigraphic group code needs an exact fit placement schema')
    const rawCode = supplied.code as Record<string, unknown>
    const parsedCode = parseSectionTextPlacement({ ...rawCode, horizontalAlignment: 0 }, 'stratigraphic group code', ['fitEndOffset'])
    if (!Array.isArray(rawCode.fitEndOffset) || rawCode.fitEndOffset.length !== 2)
      throw new KJValidationError('Geology: section stratigraphic group code fit endpoint needs two millimetre offsets')
    const fitEndOffset = rawCode.fitEndOffset.map((item, index) => numeric(item,
      `section stratigraphic group code fit endpoint ${index + 1}`)) as [number, number]
    const fitLength = Math.hypot(fitEndOffset[0] - parsedCode.offset[0], fitEndOffset[1] - parsedCode.offset[1])
    if (fitEndOffset.some(item => Math.abs(item) > 80) || fitLength < 0.2 || fitLength > 40)
      throw new KJValidationError('Geology: section stratigraphic group code fit placement is out of bounds')
    stratigraphicGroupLabelStyle = {
      code: { offset: parsedCode.offset, fitEndOffset, height: parsedCode.height,
        textWidthFactor: parsedCode.textWidthFactor, verticalAlignment: parsedCode.verticalAlignment },
      symbol: parseSectionTextPlacement(supplied.symbol, 'stratigraphic group symbol'),
      subscript: parseSectionTextPlacement(supplied.subscript, 'stratigraphic group subscript'),
      superscript: parseSectionTextPlacement(supplied.superscript, 'stratigraphic group superscript'),
    }
  }
  let sourceBackedStratigraphicGroupLabels: SectionLayout['sourceBackedStratigraphicGroupLabels']
  if (value.sourceBackedStratigraphicGroupLabels != null) {
    if (!Array.isArray(value.sourceBackedStratigraphicGroupLabels) || value.sourceBackedStratigraphicGroupLabels.length < 1 ||
      value.sourceBackedStratigraphicGroupLabels.length > 64)
      throw new KJValidationError('Geology: section stratigraphic group labels need 1-64 explicit source facts')
    const identities = new Set<string>()
    sourceBackedStratigraphicGroupLabels = value.sourceBackedStratigraphicGroupLabels.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        Object.keys(raw).sort().join(',') !== 'anchor,sourceHoleId,sourceIntervalId')
        throw new KJValidationError(`Geology: section stratigraphic group label ${index + 1} needs an exact source identity and anchor`)
      const item = raw as Record<string, unknown>
      const sourceHoleId = bounded(item.sourceHoleId, `section stratigraphic group label ${index + 1} hole`, 40)
      const sourceIntervalId = bounded(item.sourceIntervalId, `section stratigraphic group label ${index + 1} interval`, 64)
      if (!Array.isArray(item.anchor) || item.anchor.length !== 2)
        throw new KJValidationError('Geology: section stratigraphic group label anchor needs station and elevation')
      const anchor = item.anchor.map((coordinate, coordinateIndex) => numeric(coordinate,
        `section stratigraphic group label ${index + 1} anchor ${coordinateIndex + 1}`)) as [number, number]
      if (anchor.some(coordinate => Math.abs(coordinate) > 100000))
        throw new KJValidationError('Geology: section stratigraphic group label anchor is out of bounds')
      const identity = `${sourceHoleId}\u0000${sourceIntervalId}`
      if (identities.has(identity)) throw new KJValidationError('Geology: duplicate section stratigraphic group label source fact')
      identities.add(identity)
      return { sourceHoleId, sourceIntervalId, anchor }
    })
  }
  if (Boolean(stratigraphicGroupLabelStyle) !== Boolean(sourceBackedStratigraphicGroupLabels))
    throw new KJValidationError('Geology: section stratigraphic group labels require both host style and source facts')
  let sectionTextStyle: SectionLayout['sectionTextStyle']
  if (value.sectionTextStyle != null) {
    if (!value.sectionTextStyle || typeof value.sectionTextStyle !== 'object' || Array.isArray(value.sectionTextStyle))
      throw new KJValidationError('Geology: section text style needs every declared text role')
    const textStyleKeys = ['collarElevation', 'elevationTick', 'holeDepth', 'holeIdentifier', 'intervalBottom', 'station', 'stationLabel',
      ...((value.sectionTextStyle as Record<string, unknown>).holeEndDate == null ? [] : ['holeEndDate'])]
    if (Object.keys(value.sectionTextStyle).sort().join(',') !== textStyleKeys.sort().join(','))
      throw new KJValidationError('Geology: section text style needs every declared text role')
    const supplied = value.sectionTextStyle as Record<string, unknown>
    const holeIdentifier = supplied.holeIdentifier as Record<string, unknown>
    const holeEndDate = supplied.holeEndDate as Record<string, unknown> | undefined
    const collar = supplied.collarElevation as Record<string, unknown>, interval = supplied.intervalBottom as Record<string, unknown>
    const station = supplied.station as Record<string, unknown>
    const holeDepth = supplied.holeDepth as Record<string, unknown>, stationLabel = supplied.stationLabel as Record<string, unknown>
    const holeIdentifierPlacement = parseSectionTextPlacement(holeIdentifier, 'hole identifier',
      holeIdentifier?.labelOverrides == null ? [] : ['labelOverrides'])
    const holeEndDatePlacement = holeEndDate == null ? undefined : parseSectionTextPlacement(holeEndDate, 'hole end date',
      ['format', ...(holeEndDate.labelOverrides == null ? [] : ['labelOverrides'])])
    const collarPlacement = parseSectionTextPlacement(collar, 'collar elevation',
      collar?.labelOverrides == null ? [] : ['labelOverrides'])
    const intervalPlacement = parseSectionTextPlacement(interval, 'interval bottom', ['format', 'precision',
      ...(interval?.labelOverrides == null ? [] : ['labelOverrides'])])
    const stationPlacement = parseSectionTextPlacement(station, 'station', ['mode', 'precision'])
    const holeDepthPlacement = parseSectionTextPlacement(holeDepth, 'hole depth', ['precision', 'visibility'])
    const stationLabelPlacement = parseSectionTextPlacement(stationLabel, 'station label', ['visibility'])
    if ((holeEndDate != null && !['date-only', 'as-supplied'].includes(holeEndDate.format as string)) ||
      !['depth', 'depth-elevation'].includes(interval.format as string) ||
      !['cumulative-at-hole', 'adjacent-spacing-between-holes'].includes(station.mode as string) ||
      !['shown', 'omitted'].includes(holeDepth.visibility as string) || !['shown', 'omitted'].includes(stationLabel.visibility as string))
      throw new KJValidationError('Geology: section text presentation mode is invalid')
    let holeIdentifierLabelOverrides: SectionHoleIdentifierLabelOverride[] | undefined
    if (holeIdentifier.labelOverrides != null) {
      if (!Array.isArray(holeIdentifier.labelOverrides) || holeIdentifier.labelOverrides.length < 1 || holeIdentifier.labelOverrides.length > 256)
        throw new KJValidationError('Geology: section hole identifier label overrides need bounded source facts')
      const identities = new Set<string>()
      holeIdentifierLabelOverrides = holeIdentifier.labelOverrides.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'holeId,placement')
          throw new KJValidationError(`Geology: section hole identifier label override ${index + 1} needs an exact fact schema`)
        const item = raw as Record<string, unknown>
        const holeId = bounded(item.holeId, `section hole identifier label override ${index + 1} hole id`)
        if (identities.has(holeId)) throw new KJValidationError('Geology: section hole identifier label overrides must be unique')
        identities.add(holeId)
        return { holeId, placement: parseSectionTextPlacement(item.placement, `hole identifier label override ${index + 1}`) }
      })
    }
    let holeEndDateLabelOverrides: SectionHoleEndDateLabelOverride[] | undefined
    if (holeEndDate?.labelOverrides != null) {
      if (!Array.isArray(holeEndDate.labelOverrides) || holeEndDate.labelOverrides.length < 1 || holeEndDate.labelOverrides.length > 256)
        throw new KJValidationError('Geology: section hole end date label overrides need bounded source facts')
      const identities = new Set<string>()
      holeEndDateLabelOverrides = holeEndDate.labelOverrides.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'endDate,holeId,placement')
          throw new KJValidationError(`Geology: section hole end date label override ${index + 1} needs an exact fact schema`)
        const item = raw as Record<string, unknown>
        const holeId = bounded(item.holeId, `section hole end date label override ${index + 1} hole id`)
        if (identities.has(holeId)) throw new KJValidationError('Geology: section hole end date label overrides must be unique')
        identities.add(holeId)
        const endDate = bounded(item.endDate, `section hole end date label override ${index + 1} end date`, 32)
        return { holeId, endDate, placement: parseSectionTextPlacement(item.placement, `hole end date label override ${index + 1}`) }
      })
    }
    let collarLabelOverrides: SectionCollarElevationLabelOverride[] | undefined
    if (collar.labelOverrides != null) {
      if (!Array.isArray(collar.labelOverrides) || collar.labelOverrides.length < 1 || collar.labelOverrides.length > 256)
        throw new KJValidationError('Geology: section collar elevation label overrides need bounded source facts')
      const identities = new Set<string>()
      collarLabelOverrides = collar.labelOverrides.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
          throw new KJValidationError(`Geology: section collar elevation label override ${index + 1} needs an exact fact schema`)
        const item = raw as Record<string, unknown>, hasPlacement = item.placement != null
        const expectedKeys = ['elevation', 'holeId', ...(hasPlacement ? ['placement'] : [])]
        if (Object.keys(item).sort().join(',') !== expectedKeys.sort().join(','))
          throw new KJValidationError(`Geology: section collar elevation label override ${index + 1} needs an exact fact schema`)
        const holeId = bounded(item.holeId, `section collar elevation label override ${index + 1} hole id`)
        if (identities.has(holeId)) throw new KJValidationError('Geology: section collar elevation label overrides must be unique')
        identities.add(holeId)
        const elevation = numeric(item.elevation, `section collar elevation label override ${index + 1} elevation`)
        if (elevation < -10000 || elevation > 10000)
          throw new KJValidationError(`Geology: section collar elevation label override ${index + 1} is out of bounds`)
        return { holeId, elevation,
          ...(hasPlacement ? { placement: parseSectionTextPlacement(item.placement, `collar elevation label override ${index + 1}`) } : {}) }
      })
    }
    let labelOverrides: SectionIntervalBottomLabelOverride[] | undefined
    if (interval.labelOverrides != null) {
      if (interval.format !== 'depth-elevation' || !Array.isArray(interval.labelOverrides) ||
        interval.labelOverrides.length < 1 || interval.labelOverrides.length > 256)
        throw new KJValidationError('Geology: section interval bottom label overrides need bounded depth-elevation facts')
      const identities = new Set<string>()
      labelOverrides = interval.labelOverrides.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
          throw new KJValidationError(`Geology: section interval bottom label override ${index + 1} needs an exact fact schema`)
        const item = raw as Record<string, unknown>, hasPlacement = item.placement != null
        const expectedKeys = ['depth', 'elevation', 'holeId', 'intervalId', ...(hasPlacement ? ['placement'] : [])]
        if (Object.keys(item).sort().join(',') !== expectedKeys.sort().join(','))
          throw new KJValidationError(`Geology: section interval bottom label override ${index + 1} needs an exact fact schema`)
        const holeId = bounded(item.holeId, `section interval bottom label override ${index + 1} hole id`)
        const intervalId = bounded(item.intervalId, `section interval bottom label override ${index + 1} interval id`)
        const identity = `${holeId}\u0000${intervalId}`
        if (identities.has(identity)) throw new KJValidationError('Geology: section interval bottom label overrides must be unique')
        identities.add(identity)
        const depth = numeric(item.depth, `section interval bottom label override ${index + 1} depth`)
        const elevation = numeric(item.elevation, `section interval bottom label override ${index + 1} elevation`)
        if (depth < 0 || depth > 10000 || elevation < -10000 || elevation > 10000)
          throw new KJValidationError(`Geology: section interval bottom label override ${index + 1} is out of bounds`)
        return { holeId, intervalId, depth, elevation,
          ...(hasPlacement ? { placement: parseSectionTextPlacement(item.placement, `interval bottom label override ${index + 1}`) } : {}) }
      })
    }
    sectionTextStyle = {
      elevationTick: parseSectionTextPlacement(supplied.elevationTick, 'elevation tick'),
      holeIdentifier: { ...holeIdentifierPlacement, ...(holeIdentifierLabelOverrides ? { labelOverrides: holeIdentifierLabelOverrides } : {}) },
      ...(holeEndDate && holeEndDatePlacement ? { holeEndDate: { ...holeEndDatePlacement, format: holeEndDate.format as 'date-only' | 'as-supplied',
        ...(holeEndDateLabelOverrides ? { labelOverrides: holeEndDateLabelOverrides } : {}) } } : {}),
      collarElevation: { ...collarPlacement, ...(collarLabelOverrides ? { labelOverrides: collarLabelOverrides } : {}) },
      intervalBottom: { ...intervalPlacement, format: interval.format as 'depth' | 'depth-elevation', precision: precision(interval.precision, 'interval bottom'),
        ...(labelOverrides ? { labelOverrides } : {}) },
      station: { ...stationPlacement, mode: station.mode as 'cumulative-at-hole' | 'adjacent-spacing-between-holes', precision: precision(station.precision, 'station') },
      holeDepth: { ...holeDepthPlacement, visibility: holeDepth.visibility as 'shown' | 'omitted', precision: precision(holeDepth.precision, 'hole depth') },
      stationLabel: { ...stationLabelPlacement, visibility: stationLabel.visibility as 'shown' | 'omitted' },
    }
  }
  const parseHatchPresentation = (raw: unknown, label: string): SectionHatchPresentation['boreholeColumn'] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'patternAngle,patternScale')
      throw new KJValidationError(`Geology: section ${label} hatch presentation needs exact angle and scale`)
    const rule = raw as Record<string, unknown>, patternScale = numeric(rule.patternScale, `section ${label} hatch scale`)
    const patternAngle = numeric(rule.patternAngle, `section ${label} hatch angle`)
    if (patternScale < 0.01 || patternScale > 100 || patternAngle < -360 || patternAngle > 360)
      throw new KJValidationError(`Geology: section ${label} hatch presentation is out of bounds`)
    return { patternScale, patternAngle }
  }
  let sectionHatchPresentation: SectionLayout['sectionHatchPresentation']
  if (value.sectionHatchPresentation != null) {
    if (!value.sectionHatchPresentation || typeof value.sectionHatchPresentation !== 'object' || Array.isArray(value.sectionHatchPresentation) ||
      Object.keys(value.sectionHatchPresentation).sort().join(',') !== 'boreholeColumn,stratigraphicBand')
      throw new KJValidationError('Geology: section hatch presentation needs column and band roles')
    const supplied = value.sectionHatchPresentation as Record<string, unknown>
    sectionHatchPresentation = { boreholeColumn: parseHatchPresentation(supplied.boreholeColumn, 'borehole column'),
      stratigraphicBand: parseHatchPresentation(supplied.stratigraphicBand, 'stratigraphic band') }
  }
  let boreholeProfileStyle: SectionLayout['boreholeProfileStyle']
  if (value.boreholeProfileStyle != null) {
    if (!value.boreholeProfileStyle || typeof value.boreholeProfileStyle !== 'object' || Array.isArray(value.boreholeProfileStyle) ||
      Object.keys(value.boreholeProfileStyle).sort().join(',') !== 'bottomTickOffsets,collarBarHalfWidth,collarBarYOffset,guideEndOffset,primitive')
      throw new KJValidationError('Geology: section borehole profile style needs exact source-backed geometry facts')
    const supplied = value.boreholeProfileStyle as Record<string, unknown>
    if (supplied.primitive !== 'centerline' || !Array.isArray(supplied.bottomTickOffsets) || supplied.bottomTickOffsets.length !== 2)
      throw new KJValidationError('Geology: section borehole profile style geometry is invalid')
    const guideEndOffset = numeric(supplied.guideEndOffset, 'section borehole guide end offset')
    const bottomTickOffsets = supplied.bottomTickOffsets.map((offset, index) =>
      numeric(offset, `section borehole bottom tick offset ${index + 1}`)) as [number, number]
    const collarBarHalfWidth = numeric(supplied.collarBarHalfWidth, 'section borehole collar bar half width')
    const collarBarYOffset = numeric(supplied.collarBarYOffset, 'section borehole collar bar Y offset')
    if (guideEndOffset < -50 || guideEndOffset > -0.1 || bottomTickOffsets.some(offset => Math.abs(offset) > 20) ||
      Math.abs(bottomTickOffsets[1] - bottomTickOffsets[0]) < 0.2 || collarBarHalfWidth < 0.5 || collarBarHalfWidth > 30 ||
      Math.abs(collarBarYOffset) > 10)
      throw new KJValidationError('Geology: section borehole profile style is out of bounds')
    boreholeProfileStyle = { primitive: supplied.primitive, guideEndOffset, bottomTickOffsets, collarBarHalfWidth, collarBarYOffset }
  }
  let elevationScaleRailStyle: SectionLayout['elevationScaleRailStyle']
  if (value.elevationScaleRailStyle != null) {
    if (!value.elevationScaleRailStyle || typeof value.elevationScaleRailStyle !== 'object' || Array.isArray(value.elevationScaleRailStyle) ||
      Object.keys(value.elevationScaleRailStyle).sort().join(',') !== 'primitive,tickCellYOffset,xOffsets')
      throw new KJValidationError('Geology: section elevation scale rail style needs exact source-backed geometry facts')
    const supplied = value.elevationScaleRailStyle as Record<string, unknown>
    if (supplied.primitive !== 'solid-cell-per-tick' || !Array.isArray(supplied.xOffsets) || supplied.xOffsets.length !== 2 ||
      !Array.isArray(supplied.tickCellYOffset) || supplied.tickCellYOffset.length !== 2)
      throw new KJValidationError('Geology: section elevation scale rail geometry is invalid')
    const xOffsets = supplied.xOffsets.map((offset, index) => numeric(offset, `section elevation scale rail X offset ${index + 1}`)) as [number, number]
    const tickCellYOffset = supplied.tickCellYOffset.map((offset, index) => numeric(offset, `section elevation scale rail tick-cell Y offset ${index + 1}`)) as [number, number]
    if (xOffsets.some(offset => Math.abs(offset) > 80) || xOffsets[1] - xOffsets[0] < 0.2 || xOffsets[1] - xOffsets[0] > 10 ||
      tickCellYOffset[0] < -50 || tickCellYOffset[0] > -0.2 || tickCellYOffset[1] !== 0)
      throw new KJValidationError('Geology: section elevation scale rail style is out of bounds')
    elevationScaleRailStyle = { primitive: supplied.primitive, xOffsets, tickCellYOffset }
  }
  let sourceBackedPatternSymbols: SectionLayout['sourceBackedPatternSymbols']
  if (value.sourceBackedPatternSymbols != null) {
    if (!Array.isArray(value.sourceBackedPatternSymbols) || value.sourceBackedPatternSymbols.length < 1 || value.sourceBackedPatternSymbols.length > 256)
      throw new KJValidationError('Geology: section source-backed pattern symbols need 1-256 explicit facts')
    const seenSymbols = new Set<string>()
    sourceBackedPatternSymbols = value.sourceBackedPatternSymbols.map((rawSymbol, symbolIndex) => {
      if (!rawSymbol || typeof rawSymbol !== 'object' || Array.isArray(rawSymbol) || Object.keys(rawSymbol).sort().join(',') !== 'points,primitive')
        throw new KJValidationError('Geology: section source-backed pattern symbol needs an exact primitive and points')
      const symbol = rawSymbol as Record<string, unknown>
      if (symbol.primitive !== 'triangle-lines' || !Array.isArray(symbol.points) || symbol.points.length !== 3)
        throw new KJValidationError('Geology: section source-backed pattern symbol geometry is invalid')
      const points = symbol.points.map((rawPoint, pointIndex) => {
        if (!Array.isArray(rawPoint) || rawPoint.length !== 2)
          throw new KJValidationError('Geology: section source-backed pattern symbol point needs station and elevation')
        return [numeric(rawPoint[0], `section source-backed pattern symbol ${symbolIndex + 1} station ${pointIndex + 1}`),
          numeric(rawPoint[1], `section source-backed pattern symbol ${symbolIndex + 1} elevation ${pointIndex + 1}`)] as [number, number]
      }) as [[number, number], [number, number], [number, number]]
      const area = Math.abs(points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length]!
        return sum + point[0] * next[1] - next[0] * point[1]
      }, 0)) / 2
      const identity = JSON.stringify(points)
      if (area < 1e-8) throw new KJValidationError('Geology: section source-backed pattern symbol is degenerate')
      if (seenSymbols.has(identity)) throw new KJValidationError('Geology: duplicate section source-backed pattern symbol fact')
      seenSymbols.add(identity)
      return { primitive: symbol.primitive, points }
    })
  }
  let sourceBackedBoundaryPolylines: SectionLayout['sourceBackedBoundaryPolylines']
  if (value.sourceBackedBoundaryPolylines != null) {
    if (!Array.isArray(value.sourceBackedBoundaryPolylines) || value.sourceBackedBoundaryPolylines.length < 1 || value.sourceBackedBoundaryPolylines.length > 256)
      throw new KJValidationError('Geology: section source-backed boundary polylines need 1-256 explicit facts')
    const seenBoundaries = new Set<string>()
    sourceBackedBoundaryPolylines = value.sourceBackedBoundaryPolylines.map((rawBoundary, boundaryIndex) => {
      if (!rawBoundary || typeof rawBoundary !== 'object' || Array.isArray(rawBoundary) || Object.keys(rawBoundary).sort().join(',') !== 'points,primitive')
        throw new KJValidationError('Geology: section source-backed boundary polyline needs an exact primitive and points')
      const boundary = rawBoundary as Record<string, unknown>
      const closed = boundary.primitive === 'closed-polyline'
      if (!closed && boundary.primitive !== 'open-polyline' || !Array.isArray(boundary.points) ||
        boundary.points.length < (closed ? 3 : 2) || boundary.points.length > 32)
        throw new KJValidationError('Geology: section source-backed boundary polyline geometry is invalid')
      const points = boundary.points.map((rawPoint, pointIndex) => {
        if (!Array.isArray(rawPoint) || rawPoint.length !== 2)
          throw new KJValidationError('Geology: section source-backed boundary point needs station and elevation')
        return [numeric(rawPoint[0], `section source-backed boundary ${boundaryIndex + 1} station ${pointIndex + 1}`),
          numeric(rawPoint[1], `section source-backed boundary ${boundaryIndex + 1} elevation ${pointIndex + 1}`)] as [number, number]
      })
      const distinct = new Set(points.map(point => JSON.stringify(point)))
      const area = closed ? Math.abs(points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length]!
        return sum + point[0] * next[1] - next[0] * point[1]
      }, 0)) / 2 : 0
      const identity = JSON.stringify([boundary.primitive, points])
      if (distinct.size < (closed ? 3 : 2) || closed && area < 1e-8)
        throw new KJValidationError('Geology: section source-backed boundary polyline is degenerate')
      if (seenBoundaries.has(identity)) throw new KJValidationError('Geology: duplicate section source-backed boundary polyline fact')
      seenBoundaries.add(identity)
      return { primitive: boundary.primitive, points } as SectionSourceBackedBoundaryPolyline
    })
  }
  const legacyFrameRule: SectionFrameRule = { primitive: 'closed-polyline', startCorner: 'bottom-left', winding: 'counter-clockwise', constantWidth: 0 }
  let elevationTickSequence: SectionLayout['elevationTickSequence']
  if (value.elevationTickSequence != null) {
    if (!value.elevationTickSequence || typeof value.elevationTickSequence !== 'object' || Array.isArray(value.elevationTickSequence) ||
      Object.keys(value.elevationTickSequence).sort().join(',') !== 'maximumElevation,minimumElevation,startElevation,step')
      throw new KJValidationError('Geology: section elevation tick sequence needs exact start, step and range facts')
    const supplied = value.elevationTickSequence as Record<string, unknown>
    const startElevation = numeric(supplied.startElevation, 'section elevation tick start')
    const step = numeric(supplied.step, 'section elevation tick step')
    const minimumElevation = numeric(supplied.minimumElevation, 'section elevation tick minimum')
    const maximumElevation = numeric(supplied.maximumElevation, 'section elevation tick maximum')
    const tickCount = Math.floor((maximumElevation - startElevation) / step + 1e-9) + 1
    if (step < 0.1 || step > 100 || minimumElevation > startElevation || startElevation > maximumElevation ||
      maximumElevation - minimumElevation > 1000 || tickCount < 1 || tickCount > 256)
      throw new KJValidationError('Geology: section elevation tick sequence is out of bounds')
    elevationTickSequence = { startElevation, step, minimumElevation, maximumElevation }
  }
  let sourceBackedBands: SectionLayout['sourceBackedBands']
  if (value.sourceBackedBands != null) {
    if (!Array.isArray(value.sourceBackedBands) || value.sourceBackedBands.length < 1 || value.sourceBackedBands.length > 128)
      throw new KJValidationError('Geology: section source-backed bands need 1-128 explicit facts')
    const seenBands = new Set<string>()
    sourceBackedBands = value.sourceBackedBands.map((rawBand, bandIndex) => {
      if (!rawBand || typeof rawBand !== 'object' || Array.isArray(rawBand) || Object.keys(rawBand).sort().join(',') !== 'points,sourceHoleId,sourceIntervalId')
        throw new KJValidationError('Geology: section source-backed band needs an exact source reference and polygon')
      const band = rawBand as Record<string, unknown>
      const sourceHoleId = bounded(band.sourceHoleId, `section source-backed band ${bandIndex + 1} hole`, 40)
      const sourceIntervalId = bounded(band.sourceIntervalId, `section source-backed band ${bandIndex + 1} interval`, 64)
      if (!Array.isArray(band.points) || band.points.length < 3 || band.points.length > 32)
        throw new KJValidationError('Geology: section source-backed band polygon needs 3-32 vertices')
      const points = band.points.map((rawPoint, pointIndex) => {
        if (!Array.isArray(rawPoint) || rawPoint.length !== 2)
          throw new KJValidationError('Geology: section source-backed band vertex needs station and elevation')
        return [numeric(rawPoint[0], `section source-backed band ${bandIndex + 1} station ${pointIndex + 1}`),
          numeric(rawPoint[1], `section source-backed band ${bandIndex + 1} elevation ${pointIndex + 1}`)] as [number, number]
      })
      const area = Math.abs(points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length]!
        return sum + point[0] * next[1] - next[0] * point[1]
      }, 0)) / 2
      if (area < 1e-6 || points.some((point, index) => {
        const next = points[(index + 1) % points.length]!
        return Math.abs(point[0] - next[0]) < 1e-9 && Math.abs(point[1] - next[1]) < 1e-9
      })) throw new KJValidationError('Geology: section source-backed band polygon is degenerate')
      const identity = `${sourceHoleId}\u0000${sourceIntervalId}\u0000${JSON.stringify(points)}`
      if (seenBands.has(identity)) throw new KJValidationError('Geology: duplicate section source-backed band fact')
      seenBands.add(identity)
      return { sourceHoleId, sourceIntervalId, points }
    })
  }
  const parseFrameRule = (raw: unknown, label: string): SectionFrameRule => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KJValidationError(`Geology: section ${label} frame rule must be an object`)
    const rule = raw as Record<string, unknown>
    if (rule.primitive !== 'line-segments' && rule.primitive !== 'closed-polyline') throw new KJValidationError(`Geology: section ${label} frame primitive is invalid`)
    if (!['bottom-left', 'bottom-right', 'top-right', 'top-left'].includes(rule.startCorner as string)) throw new KJValidationError(`Geology: section ${label} frame start corner is invalid`)
    if (rule.winding !== 'clockwise' && rule.winding !== 'counter-clockwise') throw new KJValidationError(`Geology: section ${label} frame winding is invalid`)
    const expected = rule.primitive === 'closed-polyline' ? 'constantWidth,primitive,startCorner,winding' : 'primitive,startCorner,winding'
    if (Object.keys(rule).sort().join(',') !== expected) throw new KJValidationError(`Geology: section ${label} frame rule has an undeclared or missing field`)
    if (rule.primitive === 'line-segments') return { primitive: rule.primitive, startCorner: rule.startCorner as SectionFrameCorner, winding: rule.winding }
    const constantWidth = numeric(rule.constantWidth, `section ${label} frame constant width`)
    if (constantWidth < 0 || constantWidth > 5) throw new KJValidationError(`Geology: section ${label} frame constant width is out of bounds`)
    return { primitive: rule.primitive, startCorner: rule.startCorner as SectionFrameCorner, winding: rule.winding, constantWidth }
  }
  let frameStyle: SectionLayout['frameStyle'] = { outer: { ...legacyFrameRule }, inner: { ...legacyFrameRule } }
  if (value.frameStyle != null) {
    if (!value.frameStyle || typeof value.frameStyle !== 'object' || Array.isArray(value.frameStyle) || Object.keys(value.frameStyle).sort().join(',') !== 'inner,outer')
      throw new KJValidationError('Geology: section frame style needs exact inner and outer rules')
    const supplied = value.frameStyle as Record<string, unknown>
    frameStyle = { outer: parseFrameRule(supplied.outer, 'outer'), inner: parseFrameRule(supplied.inner, 'inner') }
  }
  const parseMargins = (raw: unknown, fallback: unknown, label: string): SectionLayout['outerMargins'] => {
    if (raw == null) {
      const margin = numeric(fallback, `section ${label} margin`)
      return { left: margin, right: margin, bottom: margin, top: margin }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'bottom,left,right,top')
      throw new KJValidationError(`Geology: section ${label} margins need exact left, right, bottom and top values`)
    const supplied = raw as Record<string, unknown>
    return { left: numeric(supplied.left, `section ${label} left margin`), right: numeric(supplied.right, `section ${label} right margin`),
      bottom: numeric(supplied.bottom, `section ${label} bottom margin`), top: numeric(supplied.top, `section ${label} top margin`) }
  }
  const outerMargins = parseMargins(value.outerMargins, value.outerMargin, 'outer')
  const innerMargins = parseMargins(value.innerMargins, value.innerMargin, 'inner')
  let drawingOrigin: [number, number] = [0, 0]
  if (value.drawingOrigin != null) {
    if (!Array.isArray(value.drawingOrigin) || value.drawingOrigin.length !== 2)
      throw new KJValidationError('Geology: section drawing origin needs two coordinates')
    drawingOrigin = [numeric(value.drawingOrigin[0], 'section drawing origin X'), numeric(value.drawingOrigin[1], 'section drawing origin Y')]
  }
  let footerFrameStyle: SectionLayout['footerFrameStyle']
  if (value.footerFrameStyle != null) {
    if (!value.footerFrameStyle || typeof value.footerFrameStyle !== 'object' || Array.isArray(value.footerFrameStyle) ||
      Object.keys(value.footerFrameStyle).sort().join(',') !== 'bottom,cellMode,guideY,left,primitive,right,top')
      throw new KJValidationError('Geology: section footer frame style needs exact bounds, primitive, cell mode and guide Y')
    const supplied = value.footerFrameStyle as Record<string, unknown>
    const left = numeric(supplied.left, 'section footer left'), right = numeric(supplied.right, 'section footer right')
    const bottom = numeric(supplied.bottom, 'section footer bottom'), top = numeric(supplied.top, 'section footer top')
    const guideY = numeric(supplied.guideY, 'section footer guide Y')
    if (!['line-segments', 'closed-polyline'].includes(supplied.primitive as string) || !['declared-grid', 'none'].includes(supplied.cellMode as string) ||
      left < outerMargins.left || right > scalars.paperWidth - outerMargins.right || right - left < 100 ||
      bottom < outerMargins.bottom || top - bottom < 5 || top - bottom > 50 || top > scalars.plotBottom - 8 || guideY < bottom || guideY > top)
      throw new KJValidationError('Geology: section footer frame style is unreadable')
    footerFrameStyle = { left, right, bottom, top, guideY, primitive: supplied.primitive as 'line-segments' | 'closed-polyline', cellMode: supplied.cellMode as 'declared-grid' | 'none' }
  }
  let sectionReferenceStyle: SectionLayout['sectionReferenceStyle']
  if (value.sectionReferenceStyle != null) {
    if (!value.sectionReferenceStyle || typeof value.sectionReferenceStyle !== 'object' || Array.isArray(value.sectionReferenceStyle) || Object.keys(value.sectionReferenceStyle).sort().join(',') !== 'end,start')
      throw new KJValidationError('Geology: section reference style needs exact start and end placements')
    const supplied = value.sectionReferenceStyle as Record<string, unknown>
    sectionReferenceStyle = { start: sourceTextPlacement(supplied.start, 'section reference start'), end: sourceTextPlacement(supplied.end, 'section reference end') }
  }
  const offsetPair = (raw: unknown, label: string): [number, number] => {
    if (!Array.isArray(raw) || raw.length !== 2) throw new KJValidationError(`Geology: ${label} needs two millimetre offsets`)
    const result: [number, number] = [numeric(raw[0], `${label} X`), numeric(raw[1], `${label} Y`)]
    if (result.some(coordinate => Math.abs(coordinate) > 50)) throw new KJValidationError(`Geology: ${label} is outside the bounded symbol area`)
    return result
  }
  let observationSymbolStyle: SectionLayout['observationSymbolStyle']
  if (value.observationSymbolStyle != null) {
    if (!value.observationSymbolStyle || typeof value.observationSymbolStyle !== 'object' || Array.isArray(value.observationSymbolStyle) || !['sample,spt', 'groundwater,sample,spt'].includes(Object.keys(value.observationSymbolStyle).sort().join(',')))
      throw new KJValidationError('Geology: section observation symbol style needs exact sample, SPT and optional groundwater rules')
    const supplied = value.observationSymbolStyle as Record<string, unknown>
    if (!supplied.sample || typeof supplied.sample !== 'object' || Array.isArray(supplied.sample) || !['centerOffset,fill,radius', 'centerOffset,fill,labelPlacement,radius'].includes(Object.keys(supplied.sample).sort().join(',')))
      throw new KJValidationError('Geology: section sample symbol rule is invalid')
    if (!supplied.spt || typeof supplied.spt !== 'object' || Array.isArray(supplied.spt) ||
      !['height,labelPlacement,topRightOffset,width', 'height,labelOverrides,labelPlacement,topRightOffset,width'].includes(Object.keys(supplied.spt).sort().join(',')))
      throw new KJValidationError('Geology: section SPT symbol rule is invalid')
    const sample = supplied.sample as Record<string, unknown>, spt = supplied.spt as Record<string, unknown>
    let groundwater: KJGeologySectionObservationSymbolStyle['groundwater']
    if (supplied.groundwater != null) {
      if (!supplied.groundwater || typeof supplied.groundwater !== 'object' || Array.isArray(supplied.groundwater))
        throw new KJValidationError('Geology: section groundwater symbol rule is invalid')
      const rule = supplied.groundwater as Record<string, unknown>
      const optionalKeys = ['labelFormat', 'labelOverrides', 'labelPlacement', 'labelPrecision'].filter(key => rule[key] != null)
      if (Object.keys(rule).sort().join(',') !== ['fill', 'insertOffset', 'lineSegments', 'markerPolygon', ...optionalKeys].sort().join(','))
        throw new KJValidationError('Geology: section groundwater symbol rule is invalid')
      if (!Array.isArray(rule.lineSegments) || rule.lineSegments.length < 1 || rule.lineSegments.length > 8 ||
        !Array.isArray(rule.markerPolygon) || rule.markerPolygon.length < 3 || rule.markerPolygon.length > 12 ||
        rule.fill !== 'solid' && rule.fill !== 'none') throw new KJValidationError('Geology: section groundwater symbol geometry is unreadable')
      const labelFormat = rule.labelFormat == null ? 'role-depth' : rule.labelFormat
      const labelPrecision = rule.labelPrecision == null ? 2 : precision(rule.labelPrecision, 'stable groundwater label')
      if (!['role-depth', 'depth-elevation'].includes(labelFormat as string) ||
        (rule.labelFormat != null || rule.labelPrecision != null || rule.labelOverrides != null) && rule.labelPlacement == null)
        throw new KJValidationError('Geology: section groundwater label presentation is invalid')
      let groundwaterLabelOverrides: SectionGroundwaterLabelOverride[] | undefined
      if (rule.labelOverrides != null) {
        if (labelFormat !== 'depth-elevation' || !Array.isArray(rule.labelOverrides) ||
          rule.labelOverrides.length < 1 || rule.labelOverrides.length > 128)
          throw new KJValidationError('Geology: section stable groundwater label overrides need bounded depth-elevation facts')
        const identities = new Set<string>()
        groundwaterLabelOverrides = rule.labelOverrides.map((raw, index) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
            Object.keys(raw).sort().join(',') !== 'depth,elevation,holeId,observationRole,placement')
            throw new KJValidationError(`Geology: section stable groundwater label override ${index + 1} needs an exact fact schema`)
          const item = raw as Record<string, unknown>
          const holeId = bounded(item.holeId, `section stable groundwater label override ${index + 1} hole`, 40)
          if (item.observationRole !== 'stable-water')
            throw new KJValidationError('Geology: section groundwater label override needs the stable-water observation role')
          if (identities.has(holeId)) throw new KJValidationError('Geology: duplicate section stable groundwater label override fact')
          identities.add(holeId)
          const depth = numeric(item.depth, `section stable groundwater label override ${index + 1} depth`)
          const elevation = numeric(item.elevation, `section stable groundwater label override ${index + 1} elevation`)
          const placement = sourceTextPlacement(item.placement, `section stable groundwater label override ${index + 1}`)
          if (depth < 0 || depth > 10000 || elevation < -10000 || elevation > 10000 || placement.offset.some(value => Math.abs(value) > 50))
            throw new KJValidationError(`Geology: section stable groundwater label override ${index + 1} is out of bounds`)
          return { holeId, observationRole: 'stable-water' as const, depth, elevation, placement }
        })
      }
      const point = (raw: unknown, label: string): [number, number] => {
        const result = offsetPair(raw, label)
        if (result.some(coordinate => Math.abs(coordinate) > 20)) throw new KJValidationError(`Geology: ${label} is outside the bounded local marker`)
        return result
      }
      groundwater = { insertOffset: offsetPair(rule.insertOffset, 'section groundwater symbol insertion'),
        lineSegments: rule.lineSegments.map((segment, index) => {
          if (!Array.isArray(segment) || segment.length !== 2) throw new KJValidationError('Geology: section groundwater line segment needs two endpoints')
          return [point(segment[0], `section groundwater line ${index + 1} start`), point(segment[1], `section groundwater line ${index + 1} end`)]
        }), markerPolygon: rule.markerPolygon.map((item, index) => point(item, `section groundwater marker vertex ${index + 1}`)), fill: rule.fill,
        ...(rule.labelPlacement == null ? {} : { labelPlacement: sourceTextPlacement(rule.labelPlacement, 'section groundwater label') }),
        ...(rule.labelFormat == null ? {} : { labelFormat: labelFormat as 'role-depth' | 'depth-elevation' }),
        ...(rule.labelPrecision == null ? {} : { labelPrecision }),
        ...(groundwaterLabelOverrides ? { labelOverrides: groundwaterLabelOverrides } : {}) }
    }
    let labelOverrides: SectionSptLabelOverride[] | undefined
    if (spt.labelOverrides != null) {
      if (!Array.isArray(spt.labelOverrides) || spt.labelOverrides.length < 1 || spt.labelOverrides.length > 128)
        throw new KJValidationError('Geology: section SPT label overrides need 1-128 explicit observation facts')
      const seenOverrides = new Set<string>()
      labelOverrides = spt.labelOverrides.map((rawOverride, index) => {
        if (!rawOverride || typeof rawOverride !== 'object' || Array.isArray(rawOverride) ||
          Object.keys(rawOverride).sort().join(',') !== 'holeId,observationId,placement')
          throw new KJValidationError('Geology: section SPT label override needs an exact observation identity and placement')
        const suppliedOverride = rawOverride as Record<string, unknown>
        const holeId = bounded(suppliedOverride.holeId, `section SPT label override ${index + 1} hole`, 40)
        const observationId = bounded(suppliedOverride.observationId, `section SPT label override ${index + 1} observation`, 64)
        const identity = JSON.stringify([holeId, observationId])
        if (seenOverrides.has(identity)) throw new KJValidationError('Geology: duplicate section SPT label override fact')
        seenOverrides.add(identity)
        return { holeId, observationId, placement: sourceSectionTextPlacement(suppliedOverride.placement, `section SPT label override ${index + 1}`) }
      })
    }
    const radius = numeric(sample.radius, 'section sample symbol radius')
    const width = numeric(spt.width, 'section SPT symbol width'), height = numeric(spt.height, 'section SPT symbol height')
    if (sample.fill !== 'solid' && sample.fill !== 'none' || radius < 0.2 || radius > 5 || width < 2 || width > 30 || height < 1 || height > 10)
      throw new KJValidationError('Geology: section observation symbol geometry is unreadable')
    observationSymbolStyle = {
      ...(groundwater ? { groundwater } : {}),
      sample: { centerOffset: offsetPair(sample.centerOffset, 'section sample symbol offset'), radius, fill: sample.fill,
        ...(sample.labelPlacement == null ? {} : { labelPlacement: sourceTextPlacement(sample.labelPlacement, 'section sample label') }) },
      spt: { topRightOffset: offsetPair(spt.topRightOffset, 'section SPT symbol offset'), width, height,
        labelPlacement: sourceSectionTextPlacement(spt.labelPlacement, 'section SPT label'), ...(labelOverrides ? { labelOverrides } : {}) },
    }
  }
  if (scalars.paperWidth < 210 || scalars.paperWidth > 1600 || scalars.paperHeight < 210 || scalars.paperHeight > 1600 ||
    Object.values(outerMargins).some(margin => margin < 0) || !hasOuterMargins && outerMargins.left < 3 ||
    Object.values(innerMargins).some(margin => margin < 0) ||
    innerMargins.left <= outerMargins.left || innerMargins.right <= outerMargins.right ||
    innerMargins.bottom <= outerMargins.bottom || innerMargins.top <= outerMargins.top ||
    innerMargins.left + innerMargins.right >= scalars.paperWidth || innerMargins.bottom + innerMargins.top >= scalars.paperHeight ||
    headingTextStyle && Object.values(headingTextStyle).some(rule => rule.anchorX < innerMargins.left || rule.anchorX > scalars.paperWidth - innerMargins.right) ||
    scalars.plotLeft <= innerMargins.left || scalars.plotRight >= scalars.paperWidth - innerMargins.right || scalars.plotRight - scalars.plotLeft < 250 ||
    scalars.plotBottom < (footerFrameStyle?.top ?? innerMargins.bottom + scalars.footerHeight) + 8 ||
    scalars.plotTop <= scalars.plotBottom + 120 || scalars.titleY <= scalars.plotTop ||
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
    const declaredGrid = footerFrameStyle?.cellMode !== 'none'
    const left = footerFrameStyle?.left ?? innerMargins.left, right = footerFrameStyle?.right ?? scalars.paperWidth - innerMargins.right
    const gridEnd = footerGrid[index + 1]?.start ?? right
    if (declaredGrid && (index === 0 && Math.abs(cell.start - left) > 1e-6 || index && cell.start <= footerGrid[index - 1]!.start || gridEnd - cell.start < 28))
      throw new KJValidationError('Geology: section footer cell is out of bounds or unreadable')
  }
  return { ...scalars, drawingOrigin, outerMargins, innerMargins, frameStyle, ...(headingTextStyle ? { headingTextStyle } : {}), footerGrid,
    ...(sectionTextStyle ? { sectionTextStyle } : {}),
    ...(sectionHatchPresentation ? { sectionHatchPresentation } : {}),
    ...(elevationTickSequence ? { elevationTickSequence } : {}),
    ...(sourceBackedBands ? { sourceBackedBands } : {}),
    ...(boreholeProfileStyle ? { boreholeProfileStyle } : {}),
    ...(elevationScaleRailStyle ? { elevationScaleRailStyle } : {}),
    ...(sourceBackedPatternSymbols ? { sourceBackedPatternSymbols } : {}),
    ...(sourceBackedBoundaryPolylines ? { sourceBackedBoundaryPolylines } : {}),
    ...(stratigraphicGroupLabelStyle ? { stratigraphicGroupLabelStyle } : {}),
    ...(sourceBackedStratigraphicGroupLabels ? { sourceBackedStratigraphicGroupLabels } : {}),
    ...(footerFrameStyle ? { footerFrameStyle } : {}), ...(sectionReferenceStyle ? { sectionReferenceStyle } : {}), ...(observationSymbolStyle ? { observationSymbolStyle } : {}) }
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
          JSON.stringify(prior.stratigraphicNotation) !== JSON.stringify(layer.stratigraphicNotation) ||
          JSON.stringify(prior.descriptionPlacement) !== JSON.stringify(layer.descriptionPlacement)))
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
    if (layer.descriptionPlacement != null) {
      const placement = layer.descriptionPlacement
      if (!placement || typeof placement !== 'object' || Array.isArray(placement) ||
        Object.keys(placement).sort().join(',') !== 'boundaryRole,offsetMm' || !layer.description || layer.groupRole === 'lens' ||
        !['top', 'bottom', 'midpoint'].includes(placement.boundaryRole))
        throw new KJValidationError('Geology: description placement needs a principal description and exact boundary role')
      const offsetMm = numeric(placement.offsetMm, 'description placement offset')
      if (offsetMm < -50 || offsetMm > 50) throw new KJValidationError('Geology: description placement offset is outside the readable body')
    }
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

function drawingBuilder(input: unknown, templateId: string, expectedRevision: number, hatches: Record<string, Record<string, unknown>> = {}, defaultTextStyle?: KJGeologyDefaultTextStyle, roleTextStyles?: KJGeologyRoleTextStyles,
  drawingOrigin: readonly [number, number] = [0, 0], hatchLayerStyle?: ColumnLayout['hatchLayerStyle']) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new KJValidationError('Geology: invalid expected revision')
  const prefix = `geo-${stableHash({ input, templateId })}`
  const linetypeId = `${prefix}-continuous`
  const names = ['GEO_FRAME', 'GEO_BOUNDARY', 'GEO_HATCH', 'GEO_TEXT', 'GEO_GUIDE']
  const layers = names.map((name, index) => ({ id: `${prefix}-layer-${index}`, name,
    color: index === 2 && hatchLayerStyle ? hatchLayerStyle.color : [7, 7, 8, 7, 9][index]!, linetypeId,
    lineweight: index === 2 && hatchLayerStyle ? hatchLayerStyle.lineweight : [35, 35, 18, 18, 9][index]! }))
  const styleResource = (id: string, style: KJGeologyDefaultTextStyle) => ({ id, name: style.name, payload: {
    fontFamily: style.fontFamily, fontFile: style.fontFile, bigFontFile: style.bigFontFile,
    fixedHeight: style.fixedHeight, widthFactor: style.widthFactor, obliqueAngle: style.obliqueAngleDegrees * Math.PI / 180,
    dxfFlags: style.dxfFlags, generationFlags: style.generationFlags,
  } })
  const textStyleId = defaultTextStyle ? `${prefix}-text-style` : undefined
  const roleTextStyleIds = Object.fromEntries(Object.entries(roleTextStyles ?? {}).map(([role]) =>
    [role, `${prefix}-text-style-${role}`])) as Partial<Record<KJGeologyRoleTextStyleRole, string>>
  const textStyles = [
    ...(defaultTextStyle ? [styleResource(textStyleId!, defaultTextStyle)] : []),
    ...Object.entries(roleTextStyles ?? {}).map(([role, style]) => styleResource(roleTextStyleIds[role as KJGeologyRoleTextStyleRole]!, style)),
  ]
  const textStyleFor = (role?: KJGeologyRoleTextStyleRole): string | undefined => role == null ? textStyleId : roleTextStyleIds[role] ?? textStyleId
  const entities: KJKnowledgeCompileResult['commandArgs']['entities'] = []
  const add = (type: string, layer: number, payload: Record<string, unknown>) => {
    if (entities.length >= 8192) throw new KJValidationError('Geology: entity budget exceeded')
    entities.push({ type, payload: { ...payload, layerId: layers[layer]!.id }, options: { id: `${prefix}-entity-${String(entities.length + 1).padStart(5, '0')}` } })
  }
  const shifted = (x: number, y: number): [number, number, number] => [x + drawingOrigin[0], y + drawingOrigin[1], 0]
  const line = (layer: number, x1: number, y1: number, x2: number, y2: number) => add('LINE', layer, { start: shifted(x1, y1), end: shifted(x2, y2) })
  const semanticLine = (layer: number, x1: number, y1: number, x2: number, y2: number, metadata: Record<string, unknown>) => add('LINE', layer, { start: shifted(x1, y1), end: shifted(x2, y2), ...metadata })
  const text = (layer: number, x: number, y: number, value: string, height = 2.6, centered = false, widthFactor?: number, verticalAlignment?: 1 | 2 | 3, styleRole?: KJGeologyRoleTextStyleRole) => add('TEXT', layer, {
    position: shifted(x, y), text: value, height,
    ...(textStyleFor(styleRole) ? { styleId: textStyleFor(styleRole) } : {}),
    ...(widthFactor == null ? {} : { widthFactor }),
    ...(centered ? { horizontalAlignment: 1 } : {}), ...(verticalAlignment == null ? {} : { verticalAlignment }),
    ...(centered || verticalAlignment != null ? { alignmentPoint: shifted(x, y) } : {}),
  })
  const placedText = (layer: number, x: number, y: number, value: string, height: number, widthFactor: number,
    horizontalAlignment: 0 | 1 | 2 | 4, verticalAlignment: 0 | 1 | 2 | 3, rotation: number, styleRole?: KJGeologyRoleTextStyleRole) => add('TEXT', layer, {
    position: shifted(x, y), text: value, height, widthFactor, rotation,
    ...(textStyleFor(styleRole) ? { styleId: textStyleFor(styleRole) } : {}),
    ...(horizontalAlignment === 0 ? {} : { horizontalAlignment }), ...(verticalAlignment === 0 ? {} : { verticalAlignment }),
    ...(horizontalAlignment !== 0 || verticalAlignment !== 0 ? { alignmentPoint: shifted(x, y) } : {}),
  })
  const fitText = (layer: number, x: number, y: number, fitX: number, fitY: number, value: string, height: number,
    widthFactor: number, verticalAlignment: 0 | 1 | 2 | 3) => add('TEXT', layer, {
    position: shifted(x, y), alignmentPoint: shifted(fitX, fitY), text: value, height, widthFactor,
    horizontalAlignment: 5, ...(verticalAlignment === 0 ? {} : { verticalAlignment }), rotation: 0,
  })
  const mtext = (layer: number, x: number, y: number, value: string, height: number, width: number) => add('MTEXT', layer, {
    position: shifted(x, y), text: value, height, width, attachmentPoint: 1, ...(textStyleId ? { styleId: textStyleId } : {}),
  })
  const poly = (layer: number, points: [number, number][], closed = false, constantWidth?: number) => add('LWPOLYLINE', layer, {
    vertices: points.map(([x, y]) => shifted(x, y)), closed, ...(constantWidth == null || constantWidth === 0 ? {} : { constantWidth }),
  })
  const rect = (layer: number, x1: number, y1: number, x2: number, y2: number, constantWidth?: number) =>
    poly(layer, [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], true, constantWidth)
  const circle = (layer: number, x: number, y: number, radius: number) => add('CIRCLE', layer, { center: shifted(x, y), radius })
  const solid = (layer: number, points: [[number, number], [number, number], [number, number], [number, number]]) => add('SOLID', layer, { vertices: points.map(([x, y]) => shifted(x, y)) })
  const circularHatch = (x: number, y: number, radius: number) => add('HATCH', 2, {
    boundaryLoops: [{ external: true, closed: true, edges: [{ type: 'ARC', center: shifted(x, y), radius, startAngle: 0, endAngle: Math.PI * 2, counterClockwise: true }] }],
    patternName: 'SOLID', solid: true, patternScale: 1, patternAngle: 0,
  })
  const solidPolygonHatch = (points: [number, number][]) => add('HATCH', 2, {
    boundaryLoops: [{ external: true, closed: true, vertices: points.map(([x, y]) => shifted(x, y)) }],
    patternName: 'SOLID', solid: true, patternScale: 1, patternAngle: 0,
  })
  const hatch = (points: [number, number][], layer: Pick<KJGeologyStratum, 'lithology' | 'patternKey'>,
    presentation?: { patternScale: number; patternAngle: number }) => add('HATCH', 2, {
    boundaryLoops: [{ external: true, closed: true, vertices: points.map(([x, y]) => shifted(x, y)) }],
    patternName: pattern[layer.lithology], solid: false, patternScale: 0.6, patternAngle: 0,
    ...(hatches[layer.patternKey ?? layer.lithology] ?? {}),
    ...(presentation ?? {}),
  })
  const finish = (parameters?: Record<string, string | number | boolean>): ReadonlyDeep<KJKnowledgeCompileResult> => deepFreeze({
    commandArgs: { entities, resources: { linetypes: [{ id: linetypeId, name: `GEO_${stableHash(prefix).toUpperCase()}_CONT`, pattern: [] }], layers,
      ...(textStyles.length ? { textStyles } : {}) } },
    evidence: { packId: 'geology.core', packVersion: '1.0.0', packHash: stableHash({ pattern, hatches }), intentHash: stableHash(input), templateId, rootObjectId: prefix, expectedRevision, entityCount: entities.length,
      ...(parameters ? { parameters } : {}) },
  })
  return { line, semanticLine, text, placedText, fitText, mtext, poly, rect, circle, solid, circularHatch, solidPolygonHatch, hatch, finish }
}

export function compileGeologyColumn(input: KJGeologyColumnInput): ReadonlyDeep<KJKnowledgeCompileResult> {
  const { hole } = input, strata = checkHole(hole)
  const layout = columnLayout(input)
  const { paperHeight: pageHeight, paperWidth: pageWidth, left, right, columns, observationColumns,
    headerDepth, headerRowHeight, fieldHeaderHeight, footerReserve, labels, displayAliases, headerGrid, footerGrid, fieldGrid, sptDisplayCap, titleHeight, titleTextStyle, textFlow, textHeights, intervalDepthTextStyle, majorGroupValueStyle,
    defaultTextStyle, roleTextStyles, stratigraphicNotationStyle, descriptionTextStyle, sampleMarkerStyle, sampleAnnotationStyle, sampleRangeBaselineStyle, sampleRangeTextFormat, groundwaterAnnotationStyle, patternLabelStyle, titleMarginFacts, frameStyle, descriptionBoundaryStyle, descriptionPlacements, hatchLayerStyle, formTopology,
    layerNumberStyle, sourceTemplate } = layout
  if (strata.some(layer => layer.stratigraphicNotation != null) && !stratigraphicNotationStyle)
    throw new KJValidationError('Geology: stratigraphic notation facts need a declared field-grid notation style')
  if ((strata.some(layer => layer.descriptionPlacement != null) || descriptionPlacements) && !descriptionTextStyle)
    throw new KJValidationError('Geology: description placement facts need a declared field-grid description text style')
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
  const codeAnchorX = columns.length === 6 ? columns[3] : columns[2]
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
  const g = drawingBuilder(input, 'borehole-column-engineering', input.expectedRevision,
    patternDefinitions(input.hatchPack, strata), defaultTextStyle, roleTextStyles, [0, 0], hatchLayerStyle)
  const finishColumn = (): ReadonlyDeep<KJKnowledgeCompileResult> => g.finish({
    verticalScaleDenominator,
    verticalScaleSource: input.verticalScaleDenominator == null ? 'style-standard' : 'explicit',
    pageHeightMillimeters: pageHeight,
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
  const descriptionPlacementRules = new Map(descriptionPlacements?.map(item => [item.groupId, item]) ?? [])
  if (descriptionPlacementRules.size) {
    if (!grouped) throw new KJValidationError('Geology: knowledge-pack description placements require explicit major group IDs')
    for (const rule of descriptionPlacements!) {
      const group = groups.find(item => item.id === rule.groupId)
      if (!group || !group.principal.description)
        throw new KJValidationError(`Geology: description placement group ${rule.groupId} has no supplied principal description`)
      if (group.principal.descriptionPlacement)
        throw new KJValidationError(`Geology: description placement group ${rule.groupId} is declared by both facts and knowledge`)
      if (rule.precedingBoundaryClearanceMm && group === groups[0])
        throw new KJValidationError('Geology: the first description cannot declare a preceding boundary clearance')
    }
  }
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
    const titleValue = bounded(input.title ?? (locale === 'zh-CN' ? '钻孔柱状图' : 'BOREHOLE LOG'), 'title')
    if (titleTextStyle) {
      const placement = titleTextStyle.placement
      const x = left + placement.offset[0], y = frameTop + placement.offset[1]
      const textWidth = [...titleValue].reduce((sum, character) =>
        sum + (/^[\x20-\x7e]$/u.test(character) ? placement.height * 0.64 : placement.height) * placement.textWidthFactor, 0)
      const textLeft = placement.horizontalAlignment === 'left' ? x : placement.horizontalAlignment === 'center' ? x - textWidth / 2 : x - textWidth
      const textBottom = placement.verticalAlignment === 'middle' ? y - placement.height / 2 : y
      if (textLeft < left || textLeft + textWidth > right || textBottom < headerTop || textBottom + placement.height > frameTop)
        throw new KJValidationError('Geology: declared main title does not fit its physical title band')
      const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2
      const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2
      g.placedText(3, x, y, titleValue, placement.height, placement.textWidthFactor,
        horizontalAlignment, verticalAlignment, titleTextStyle.rotationDegrees)
    } else {
      const titleY = headerTop + (frameTop - headerTop - (titleHeight ?? 5)) / 2
      g.text(3, pageWidth / 2, titleY, titleValue, titleHeight ?? 5, true)
    }
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
        const estimated = (text: string, height: number, widthFactor = 1): number => [...text].reduce((sum, character) =>
          sum + (/^[\x20-\x7e]$/u.test(character) ? height * 0.52 : height * 0.95) * widthFactor, 0)
        if (cell.textStyle) {
          const fitsLane = (text: string, placement: KJGeologyFieldHeaderTextPlacement, laneWidth: number): boolean => {
            const textWidth = estimated(text, placement.height, placement.textWidthFactor)
            const leftExtent = placement.horizontalAlignment === 'left' ? placement.offset[0] :
              placement.horizontalAlignment === 'center' ? placement.offset[0] - textWidth / 2 : placement.offset[0] - textWidth
            return leftExtent >= -1e-9 && leftExtent + textWidth <= laneWidth + 1e-9
          }
          if (!fitsLane(cell.label, cell.textStyle.label, valueX - cellLeft) ||
            !fitsLane(visibleValue, cell.textStyle.value, cellLeft + width - valueX))
            throw new KJValidationError(`Geology: header fact ${identity} does not fit its source-backed text lanes`)
          const emitHeaderFact = (originX: number, text: string, placement: KJGeologyFieldHeaderTextPlacement): void => {
            const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2
            const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2
            g.placedText(3, originX + placement.offset[0], rowBottom + placement.offset[1], text, placement.height,
              placement.textWidthFactor, horizontalAlignment, verticalAlignment, 0)
          }
          emitHeaderFact(cellLeft, cell.label, cell.textStyle.label)
          if (visibleValue || cell.preserveBlankValue) emitHeaderFact(valueX, visibleValue, cell.textStyle.value)
        } else {
          if (estimated(cell.label, headerFactHeight) > valueX - cellLeft - 3 ||
            estimated(visibleValue, headerFactHeight) > cellLeft + width - valueX - 3)
            throw new KJValidationError(`Geology: header fact ${identity} does not fit the declared cell`)
          g.text(3, cellLeft + 2, rowTop - rowHeight * 0.69, cell.label, headerFactHeight)
          if (visibleValue) g.text(3, valueX + 2, rowTop - rowHeight * 0.69, visibleValue, headerFactHeight)
        }
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
      const value = documentFacts[cell.key]
      if (cell.textStyle) {
        const fitsLane = (text: string, placement: KJGeologyFieldHeaderTextPlacement, laneWidth: number): boolean => {
          const textWidth = [...text].reduce((sum, character) =>
            sum + (/^[\x20-\x7e]$/u.test(character) ? placement.height * 0.64 : placement.height) * placement.textWidthFactor, 0)
          const leftExtent = placement.horizontalAlignment === 'left' ? placement.offset[0] :
            placement.horizontalAlignment === 'center' ? placement.offset[0] - textWidth / 2 : placement.offset[0] - textWidth
          return leftExtent >= -1e-9 && leftExtent + textWidth <= laneWidth + 1e-9
        }
        const valueOrigin = cell.internalDivider ?? cell.start
        if (!fitsLane(cell.label, cell.textStyle.label, (cell.internalDivider ?? end) - cell.start) ||
          value && !fitsLane(value, cell.textStyle.value, end - valueOrigin))
          throw new KJValidationError(`Geology: footer fact ${cell.key} does not fit its source-backed text lanes`)
        const emitFooterFact = (originX: number, text: string, placement: KJGeologyFieldHeaderTextPlacement): void => {
          const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2
          const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2
          g.placedText(3, originX + placement.offset[0], bottom + placement.offset[1], text, placement.height,
            placement.textWidthFactor, horizontalAlignment, verticalAlignment, 0)
        }
        emitFooterFact(cell.start, cell.label, cell.textStyle.label)
        if (value) emitFooterFact(valueOrigin, value, cell.textStyle.value)
      } else {
        const labelHeight = width < 25 ? 1.4 : 1.55
        g.text(3, cell.start + width / 2, top - labelHeight - 1, cell.label, labelHeight, true)
        if (value) {
          const valueHeight = width < 25 ? 1.3 : 1.45
          const estimated = [...value].reduce((sum, character) => sum + (/^[\x20-\x7e]$/u.test(character) ? valueHeight * 0.64 : valueHeight), 0)
          if (estimated > width - 2) throw new KJValidationError(`Geology: footer fact ${cell.key} does not fit its declared cell`)
          g.text(3, cell.start + width / 2, bottom + 1.2, value, valueHeight, true)
        }
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
    const descriptionBoundaryClearances = new Map<number, { left: number; right: number }>()
    const textBoxes: { role: FieldRole; left: number; right: number; bottom: number; top: number }[] = []
    const emitFieldText = (item: typeof fieldGrid[number], y: number, value: string, height = 1.8): void => {
      const width = estimatedWidth(value, height) * (item.textWidthFactor ?? 1)
      if (width > fieldWidth(item) - 2.4) throw new KJValidationError(`Geology: ${item.role} text does not fit its declared field`)
      const centered = item.role !== 'description'
      const x = centered ? item.start + fieldWidth(item) / 2 : item.start + 1.2
      g.text(3, x, y, value, height, centered, item.textWidthFactor, undefined, item.role === 'layerName' ? 'layerName' : undefined)
      textBoxes.push({ role: item.role, left: x - (centered ? width / 2 : 0) - 0.25,
        right: x + (centered ? width / 2 : width) + 0.25, bottom: y - 0.25, top: y + height + 0.25 })
    }
    const emitPlacedFieldText = (item: typeof fieldGrid[number], anchorY: number, value: string,
      placement: KJGeologyFieldHeaderTextPlacement): void => {
      const textWidth = estimatedWidth(value, placement.height) * placement.textWidthFactor
      const x = item.start + placement.offset[0], y = anchorY + placement.offset[1]
      const left = placement.horizontalAlignment === 'left' ? x :
        placement.horizontalAlignment === 'center' ? x - textWidth / 2 : x - textWidth
      if (left < item.start + 0.2 || left + textWidth > gridEnd(item) - 0.2 || y < bottom || y > top)
        throw new KJValidationError(`Geology: ${item.role} text does not fit its declared source placement`)
      const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2
      const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2
      g.placedText(3, x, y, value, placement.height, placement.textWidthFactor, horizontalAlignment, verticalAlignment, 0,
        item.role === 'layerName' ? 'layerName' : undefined)
      const textBottom = placement.verticalAlignment === 'middle' ? y - placement.height / 2 : y
      textBoxes.push({ role: item.role, left: left - 0.25, right: left + textWidth + 0.25,
        bottom: textBottom - 0.25, top: textBottom + placement.height + 0.25 })
    }
    const emitSampleText = (item: typeof fieldGrid[number], observation: KJGeologyObservation, value: string,
      marker: NonNullable<KJGeologyObservation['sampleMarker']>, height: number): void => {
      const style = sampleMarkerStyle!, factor = item.textWidthFactor ?? 1
      const glyph = marker === 'filled-circle' ? '●' : '○'
      if (sampleAnnotationStyle) {
        const anchorDepth = sampleAnnotationStyle.depthAnchor === 'observation-depth' ? observation.depth :
          sampleAnnotationStyle.depthAnchor === 'range-top' ? observation.rangeTop : observation.rangeBottom
        if (anchorDepth == null) throw new KJValidationError(`Geology: sample ${observation.id} lacks its declared annotation depth anchor`)
        const anchorY = top - anchorDepth * scale
        const emitPlaced = (text: string, placement: KJGeologyFieldHeaderTextPlacement): void => {
          const textWidth = estimatedWidth(text, placement.height) * placement.textWidthFactor
          const x = item.start + placement.offset[0], y = anchorY + placement.offset[1]
          const left = placement.horizontalAlignment === 'left' ? x :
            placement.horizontalAlignment === 'center' ? x - textWidth / 2 : x - textWidth
          if (left < item.start + 0.2 || left + textWidth > gridEnd(item) - 0.2 || y < bottom || y > top)
            throw new KJValidationError('Geology: sampled annotation does not fit its declared source lane')
          const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2
          const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2
          g.placedText(3, x, y, text, placement.height, placement.textWidthFactor, horizontalAlignment, verticalAlignment, 0)
          const textBottom = placement.verticalAlignment === 'middle' ? y - placement.height / 2 : y
          textBoxes.push({ role: item.role, left: left - 0.25, right: left + textWidth + 0.25,
            bottom: textBottom - 0.25, top: textBottom + placement.height + 0.25 })
        }
        emitPlaced(value, sampleAnnotationStyle.label)
        emitPlaced(glyph, sampleAnnotationStyle.marker)
        return
      }
      const y = top - observation.depth * scale
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
      const marker = '▼'
      const guideY = y + (style.guideEndpointOffset?.[1] ?? 0)
      const guideEndX = gridEnd(item) + (style.guideEndpointOffset?.[0] ?? 0)
      if (style.placements) {
        if (style.guide === 'field-top-to-reading')
          g.poly(1, [[item.start, top], [item.start, guideY], [guideEndX, guideY]], false)
        emitPlacedFieldText(item, y, depthText, style.placements.depth)
        emitPlacedFieldText(item, y, elevationText, style.placements.elevation)
        emitPlacedFieldText(item, y, marker, style.placements.marker)
        emitPlacedFieldText(item, y, observation.observedOn, style.placements.observedOn)
        return
      }
      const depthWidth = estimatedWidth(depthText, style.textHeight) * style.textWidthFactor
      const elevationWidth = estimatedWidth(elevationText, style.textHeight) * style.textWidthFactor
      const valuesWidth = depthWidth + style.gap + elevationWidth
      const markerWidth = estimatedWidth(marker, style.markerHeight) * style.textWidthFactor
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
        g.poly(1, [[item.start, top], [item.start, guideY], [guideEndX, guideY]], false)
      g.text(3, depthX, valueY, depthText, style.textHeight, true, style.textWidthFactor)
      g.text(3, elevationX, valueY, elevationText, style.textHeight, true, style.textWidthFactor)
      g.text(3, center, markerY, marker, style.markerHeight, true, style.textWidthFactor)
      g.text(3, center, dateY, observation.observedOn, style.textHeight, true, style.textWidthFactor)
      textBoxes.push(...boxes)
    }
    const emitLayerNumber = (item: typeof fieldGrid[number], y: number, value: string, bandHeight: number): void => {
      const placement = majorGroupValueStyle?.layerNumber
      if (layerNumberStyle !== 'circle') return placement
        ? emitPlacedFieldText(item, y, value, placement)
        : emitFieldText(item, y, value, Math.min(2.1, Math.max(1.4, bandHeight * 0.38)))
      const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.indexOf(value)
      const visible = circled >= 0 ? String(circled + 1) : /^\d{1,2}$/u.test(value) ? value : undefined
      if (!visible) return placement
        ? emitPlacedFieldText(item, y, value, placement)
        : emitFieldText(item, y, value, Math.min(2.1, Math.max(1.4, bandHeight * 0.38)))
      const radius = majorGroupValueStyle?.layerNumberCircleRadius ??
        Math.min(1.9, fieldWidth(item) / 2 - 1, bandHeight / 2 - 0.5)
      if (radius < 1) throw new KJValidationError('Geology: circled layer number does not fit its declared band')
      if (placement) {
        const x = item.start + placement.offset[0], centerY = y + placement.offset[1]
        if (centerY - radius < bottom || centerY + radius > top)
          throw new KJValidationError('Geology: circled layer number exceeds the drawing body')
        g.circle(0, x, centerY, radius)
        emitPlacedFieldText(item, y, visible, placement)
        textBoxes.push({ role: item.role, left: x - radius - .2, right: x + radius + .2,
          bottom: centerY - radius - .2, top: centerY + radius + .2 })
      } else {
        const x = item.start + fieldWidth(item) / 2, height = Math.min(1.8, radius * 0.95)
        g.circle(0, x, y, radius)
        g.text(3, x, y - height * 0.34, visible, height, true)
        textBoxes.push({ role: item.role, left: x - radius - 0.2, right: x + radius + 0.2,
          bottom: y - radius - 0.2, top: y + radius + 0.2 })
      }
    }
    const emitLayerName = (item: typeof fieldGrid[number], layer: KJGeologyStratum, yTop: number, yBottom: number,
      y: number, value: string, height: number): void => {
      const notation = layer.stratigraphicNotation
      const anchorY = (yTop + yBottom) / 2
      const exactNamePlacement = Math.abs(yTop - top) < 1e-9
        ? majorGroupValueStyle?.topBoundary?.layerName ?? majorGroupValueStyle?.layerName
        : majorGroupValueStyle?.layerName
      if (!notation) return exactNamePlacement
        ? emitPlacedFieldText(item, anchorY, value, exactNamePlacement)
        : emitFieldText(item, y, value, height)
      const style = stratigraphicNotationStyle!
      if (exactNamePlacement) emitPlacedFieldText(item, anchorY, value, exactNamePlacement)
      else {
        const nameHeight = Math.min(height, yTop - yBottom - style.symbolHeight - 1)
        if (nameHeight < 1.2) throw new KJValidationError(`Geology: stratigraphic notation for ${layer.code} does not fit its declared band`)
        emitFieldText(item, yTop - nameHeight - 0.2, value, nameHeight)
      }
      if (style.placement) {
        const placements = Math.abs(yTop - top) < 1e-9 ? style.placement.topBoundary : style.placement.principal
        emitPlacedFieldText(item, anchorY, notation.symbol, placements.symbol)
        if (notation.subscript) emitPlacedFieldText(item, anchorY, notation.subscript, placements.subscript)
        if (notation.superscript) emitPlacedFieldText(item, anchorY, notation.superscript, placements.superscript)
        return
      }
      const factor = item.textWidthFactor ?? 1
      const symbolWidth = estimatedWidth(notation.symbol, style.symbolHeight) * factor
      const qualifierWidth = Math.max(...[notation.subscript, notation.superscript].filter((part): part is string => part != null)
        .map(part => estimatedWidth(part, style.qualifierHeight) * factor), 0)
      const qualifierGap = qualifierWidth ? 0.3 : 0
      const width = symbolWidth + qualifierGap + qualifierWidth
      if (width > fieldWidth(item) - 2.4) throw new KJValidationError(`Geology: stratigraphic notation for ${layer.code} does not fit its declared field`)
      const start = item.start + (fieldWidth(item) - width) / 2, symbolX = start + symbolWidth / 2
      const symbolY = yBottom + 0.5
      g.text(3, symbolX, symbolY, notation.symbol, style.symbolHeight, true, item.textWidthFactor, undefined, 'layerName')
      textBoxes.push({ role: item.role, left: start - 0.25, right: start + symbolWidth + 0.25,
        bottom: symbolY - 0.25, top: symbolY + style.symbolHeight + 0.25 })
      const qualifierX = start + symbolWidth + qualifierGap
      if (notation.subscript) {
        const qualifierY = symbolY - style.qualifierHeight * 0.3
        g.text(3, qualifierX, qualifierY, notation.subscript, style.qualifierHeight, false, item.textWidthFactor, undefined, 'layerName')
        textBoxes.push({ role: item.role, left: qualifierX - 0.25, right: qualifierX + qualifierWidth + 0.25,
          bottom: qualifierY - 0.25, top: qualifierY + style.qualifierHeight + 0.25 })
      }
      if (notation.superscript) {
        const qualifierY = symbolY + style.symbolHeight - style.qualifierHeight
        g.text(3, qualifierX, qualifierY, notation.superscript, style.qualifierHeight, false, item.textWidthFactor, undefined, 'layerName')
        textBoxes.push({ role: item.role, left: qualifierX - 0.25, right: qualifierX + qualifierWidth + 0.25,
          bottom: qualifierY - 0.25, top: qualifierY + style.qualifierHeight + 0.25 })
      }
    }
    let previousDescriptionBottom: number | undefined, previousLabelY: number | undefined, renderedCoreCount = 0
    const firstGroupBottom = (grouped ? groups[0]!.bottom : strata[0]!.bottom)
    const nextGroupBottom = grouped ? groups[1]?.bottom : strata[1]?.bottom
    const writeGridDescription = (description: string, yTop: number, yBottom: number, coreIndex: number, identity: string,
      placement?: NonNullable<ColumnLayout['descriptionPlacements']>[number] | KJGeologyStratum['descriptionPlacement']): void => {
      const width = descriptionTextStyle?.width ?? descriptionRight - descriptionX - 4
      if (descriptionTextStyle) {
        if (!placement) throw new KJValidationError(`Geology: ${identity} lacks its declared description boundary placement`)
        const boundaryY = placement.boundaryRole === 'top' ? yTop : placement.boundaryRole === 'bottom' ? yBottom : (yTop + yBottom) / 2
        const anchorY = boundaryY + placement.offsetMm
        const paragraph = layoutCadMText({ position: [descriptionX + 2, anchorY, 0], text: description.trim(),
          height: descriptionTextStyle.height, width, attachmentPoint: 1 })
        const occupied = descriptionTextStyle.height + (paragraph.lines.length - 1) * paragraph.lineAdvance
        if (anchorY > top + 1e-9 || anchorY - occupied < bottom - 1e-9 ||
          previousDescriptionBottom != null && anchorY > previousDescriptionBottom - 0.2)
          throw new KJValidationError(`Geology: ${identity} source description placement collides or exceeds the drawing body`)
        g.mtext(3, descriptionX + 2, anchorY, description.trim(), descriptionTextStyle.height, width)
        descriptionTops.set(coreIndex, anchorY)
        if ('precedingBoundaryClearanceMm' in placement && placement.precedingBoundaryClearanceMm) {
          if (coreIndex === 0) throw new KJValidationError('Geology: the first description cannot declare a preceding boundary clearance')
          descriptionBoundaryClearances.set(coreIndex, placement.precedingBoundaryClearanceMm)
        }
        previousDescriptionBottom = anchorY - occupied
        return
      }
      if (!textFlow) return writeDescription(description, yTop, yTop - yBottom, identity)
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
      if (item.headerTextStyle) {
        const emitFieldHeaderText = (value: string, placement: KJGeologyFieldHeaderTextPlacement): void => {
          const horizontalAlignment = placement.horizontalAlignment === 'left' ? 0 : placement.horizontalAlignment === 'center' ? 1 : 2
          const verticalAlignment = placement.verticalAlignment === 'baseline' ? 0 : 2
          g.placedText(3, item.start + placement.offset[0], top + placement.offset[1], value, placement.height,
            placement.textWidthFactor, horizontalAlignment, verticalAlignment, 0)
        }
        emitFieldHeaderText(item.label, item.headerTextStyle.main)
        if (item.subLabel) emitFieldHeaderText(item.subLabel.replaceAll('{verticalScale}', scaleDenominator(verticalScaleDenominator)), item.headerTextStyle.sub!)
      } else if (item.subLabel) {
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
      let labelY = mid
      let labelHeight = textHeights?.majorValue ?? 2.1
      if (!majorGroupValueStyle) {
        labelY = yTop - Math.max(1.8, (yTop - yBottom) / 2)
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
      }
      const values: Partial<Record<FieldRole, string>> = {
        layerNumber: displayAliases?.codes[principal.code] ?? id,
        layerName: displayAliases?.names[principal.name] ?? principal.name,
        baseElevation: metres(hole.collarElevation - groupBottom), thickness: metres(groupBottom - groupTop),
      }
      const valueY = majorGroupValueStyle ? mid : textFlow && coreIndex < 2 ? labelY : yTop - yBottom < 2 ? labelY : mid
      const numberBandHeight = textFlow && coreIndex === 0
        ? Math.max(yTop - yBottom, textFlow.firstBaselineMm + textFlow.labelHeightMm + 1)
        : yTop - yBottom
      emitLayerNumber(field('layerNumber'), valueY, values.layerNumber!, numberBandHeight)
      emitLayerName(field('layerName'), principal, yTop, yBottom, valueY, values.layerName!, labelHeight)
      for (const role of ['baseElevation', 'thickness'] as const) {
        if (majorGroupValueStyle) emitPlacedFieldText(field(role), mid, values[role]!, majorGroupValueStyle[role])
        else emitFieldText(field(role), valueY, values[role]!, labelHeight)
      }
      if (principal.description && (grouped || principal.descriptionSource !== 'layer-definition' ||
        definitionAnchors.get(`${principal.code}\u0000${principal.description}`) === principal))
        writeGridDescription(principal.description, yTop, yBottom, coreIndex, `major group ${id}`,
          principal.descriptionPlacement ?? descriptionPlacementRules.get(id))
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
        g.text(3, x, y, layer.patternLabel, style.height, true, style.textWidthFactor, 2, 'patternLabel')
        textBoxes.push({ role: 'pattern', left: x - width / 2, right: x + width / 2,
          bottom: y - style.height / 2 + 0.1, top: y + style.height / 2 - 0.1 })
      }
      const depthY = depthLabelY.get(layer) ?? yBottom + 0.4
      if (Math.abs(depthY - (yBottom + 0.4)) > 0.6) g.line(1, gridEnd(depthField) - 5, yBottom, gridEnd(depthField) - 1, depthY)
      const intervalDepthHeight = textHeights?.intervalDepth ?? (grouped ? 1.5 : Math.min(2.1, (yTop - yBottom) * 0.55))
      if (!intervalDepthTextStyle && textHeights && intervalDepthHeight > yTop - yBottom - 0.4) throw new KJValidationError(`Geology: layer ${layer.code} depth text does not fit its declared band`)
      if (intervalDepthTextStyle) emitPlacedFieldText(depthField, yBottom, metres(layer.bottom),
        layer.groupRole === 'lens' ? intervalDepthTextStyle.lens : intervalDepthTextStyle.principal)
      else emitFieldText(depthField, depthY, metres(layer.bottom), intervalDepthHeight)
      if (!grouped) writeCore(layer.code, layer.top, layer.bottom, layer)
    }
    if (grouped) for (const group of groups) writeCore(group.id, group.top, group.bottom, group.principal)
    if (descriptionBoundaryStyle) {
      const descriptionField = field('description'), descriptionEnd = gridEnd(descriptionField)
      for (const [index, boundary] of majorBoundaries.entries()) {
        const nextDescriptionTop = descriptionTops.get(index + 1)
        const sourceClearance = descriptionBoundaryClearances.get(index + 1)
        const leftDescriptionY = nextDescriptionTop == null ? boundary.y :
          Math.min(boundary.y, nextDescriptionTop + (sourceClearance?.left ?? descriptionBoundaryStyle.clearance))
        const rightDescriptionY = nextDescriptionTop == null ? boundary.y :
          Math.min(boundary.y, nextDescriptionTop + (sourceClearance?.right ?? descriptionBoundaryStyle.clearance))
        if (leftDescriptionY < bottom - 1e-9 || leftDescriptionY > boundary.y + 1e-9 ||
          rightDescriptionY < bottom - 1e-9 || rightDescriptionY > boundary.y + 1e-9)
          throw new KJValidationError('Geology: stepped description boundary exceeds the declared body')
        g.poly(1, [[left, boundary.y], [descriptionField.start, boundary.y],
          [descriptionField.start + descriptionBoundaryStyle.inset, leftDescriptionY],
          [descriptionEnd - descriptionBoundaryStyle.inset, rightDescriptionY], [descriptionEnd, boundary.y], [right, boundary.y]])
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
            emitSampleText(cell, item, value, item.sampleMarker, height)
          else emitFieldText(cell, y, value, height)
        }
        if (cell.role === 'sample' && item.kind === 'sample' && item.rangeTop != null && item.rangeBottom != null) {
          const rangeTopY = top - item.rangeTop * scale, rangeBottomY = top - item.rangeBottom * scale
          const rangeEndpoint = (value: number): string => {
            if (!sampleRangeTextFormat) return metres(value)
            const fixed = value.toFixed(sampleRangeTextFormat.decimals)
            return sampleRangeTextFormat.trailingZeros === 'preserve' ? fixed
              : fixed.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '')
          }
          const rangeText = sampleRangeTextFormat
            ? `${sampleRangeTextFormat.prefix}${rangeEndpoint(item.rangeTop)}${sampleRangeTextFormat.separator}${rangeEndpoint(item.rangeBottom)}${sampleRangeTextFormat.suffix}`
            : `${metres(item.rangeTop)}–${metres(item.rangeBottom)}`
          if (sampleRangeTextFormat?.placement) {
            const placement = sampleRangeTextFormat.placement
            const anchorY = sampleRangeTextFormat.anchor === 'range-top' ? rangeTopY
              : sampleRangeTextFormat.anchor === 'range-bottom' ? rangeBottomY : (rangeTopY + rangeBottomY) / 2
            emitPlacedFieldText(cell, anchorY, rangeText, placement)
          } else {
            const rangeTextY = rangeBottomY - 2.2
            if (rangeTextY < bottom + 0.4 || textBoxes.some(box => box.role === 'sample' &&
              rangeTextY - 0.25 <= box.top && rangeTextY + 1.75 >= box.bottom))
              throw new KJValidationError(`Geology: sampled range ${item.id} cannot be labelled without colliding in its source lane`)
            emitFieldText(cell, rangeTextY, rangeText, textHeights?.observation ?? 1.5)
          }
          const baselineStyle = sampleRangeBaselineStyle ?? {
            boundaries: ['top', 'bottom'] as ('top' | 'bottom')[], continuity: 'collision-safe' as const, insetMm: 0,
          }
          const baselineY = { top: rangeTopY, bottom: rangeBottomY }
          const startInsetMm = 'insetMm' in baselineStyle ? baselineStyle.insetMm : baselineStyle.startInsetMm
          const endInsetMm = 'insetMm' in baselineStyle ? baselineStyle.insetMm : baselineStyle.endInsetMm
          for (const boundary of baselineStyle.boundaries) bandLines.push({
            x1: cell.start + startInsetMm, x2: gridEnd(cell) - endInsetMm,
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
    [codeAnchorX + 2, labels.hatchColumn!], [hatchX + 2, labels.stratumColumn!],
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
    if (layer.patternVisibility !== 'boundary-only') g.hatch([[codeAnchorX, yBottom], [hatchX, yBottom], [hatchX, yTop], [codeAnchorX, yTop]], layer)
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
  const correlationMode = input.correlationMode ?? 'explicit-correlations'
  if (correlationMode !== 'explicit-correlations' && correlationMode !== 'source-group-topology')
    throw new KJValidationError('Geology: invalid section correlation mode')
  if (!Array.isArray(input.correlations) || input.correlations.length > 512) throw new KJValidationError('Geology: invalid correlation list')
  const manualConnections = input.manualConnections ?? []
  if (!Array.isArray(manualConnections) || manualConnections.length > 200) throw new KJValidationError('Geology: invalid manual connection list')
  if (correlationMode === 'source-group-topology' && (input.correlations.length || manualConnections.length))
    throw new KJValidationError('Geology: source-group topology conflicts with explicit correlations or manual connections')
  const layout = sectionLayout(input)
  const documentFacts = documentFactRecord(input.documentFacts)
  let sectionReference: KJGeologySectionReference | undefined
  if (input.sectionReference != null) {
    if (!input.sectionReference || typeof input.sectionReference !== 'object' || Array.isArray(input.sectionReference) || Object.keys(input.sectionReference).sort().join(',') !== 'end,start')
      throw new KJValidationError('Geology: section reference needs exact start and end identifiers')
    if (!layout.sectionReferenceStyle) throw new KJValidationError('Geology: section reference needs a declared source-backed placement')
    sectionReference = {
      start: bounded(input.sectionReference.start, 'section reference start', 24),
      end: bounded(input.sectionReference.end, 'section reference end', 24),
    }
  }
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
  const topology: KJSectionTopologyResult | undefined = correlationMode === 'source-group-topology'
    ? compileGeologySectionTopology(holes.map(hole => ({ id: hole.id, station: hole.station!, collarElevation: hole.collarElevation,
        depth: hole.depth, strata: byId.get(hole.id)!.strata })))
    : undefined
  const originX = layout.plotLeft + 18
  const x = (hole: KJGeologyBorehole) => originX + (hole.station! - holes[0]!.station!) * hs
  const y = (hole: KJGeologyBorehole, depth: number) => layout.plotBottom + (hole.collarElevation - depth - datum) * vs
  if (x(holes.at(-1)!) > layout.plotRight - 4 || holes.some(hole => y(hole, 0) > layout.plotTop || y(hole, hole.depth) < layout.plotBottom)) throw new KJValidationError('Geology: section does not fit A3 at the declared scales and datum')
  const g = drawingBuilder(input, 'geology-section-engineering', input.expectedRevision,
    patternDefinitions(input.hatchPack, [...byId.values()].flatMap(value => value.strata)), undefined, undefined, layout.drawingOrigin)
  const emitPlaced = (baseX: number, baseY: number, value: string, placement: KJGeologySectionTextPlacement) =>
    g.placedText(3, baseX + placement.offset[0], baseY + placement.offset[1], value, placement.height, placement.textWidthFactor,
      placement.horizontalAlignment === 'middle' ? 4 : placement.horizontalAlignment === 'center' ? 1 : placement.horizontalAlignment === 'right' ? 2 : 0,
      placement.verticalAlignment === 'middle' ? 2 : 0, 0)

  const emitTextRole = (baseX: number, baseY: number, value: string, placement: SectionTextPlacementRule) =>
    g.placedText(3, baseX + placement.offset[0], baseY + placement.offset[1], value, placement.height, placement.textWidthFactor,
      placement.horizontalAlignment, placement.verticalAlignment, 0)
  const fixed = (value: number, precision: 0 | 1 | 2 | 3 | 4) => value.toFixed(precision)

  const frame = (margins: SectionLayout['outerMargins'], rule: SectionFrameRule) => {
    const left = margins.left, right = layout.paperWidth - margins.right
    const bottom = margins.bottom, top = layout.paperHeight - margins.top
    const corners: Record<SectionFrameCorner, [number, number]> = {
      'bottom-left': [left, bottom], 'bottom-right': [right, bottom], 'top-right': [right, top], 'top-left': [left, top],
    }
    const names: SectionFrameCorner[] = rule.winding === 'clockwise'
      ? ['bottom-left', 'top-left', 'top-right', 'bottom-right']
      : ['bottom-left', 'bottom-right', 'top-right', 'top-left']
    const start = names.indexOf(rule.startCorner), ordered = [...names.slice(start), ...names.slice(0, start)].map(name => corners[name])
    if (rule.primitive === 'line-segments') {
      for (let index = 0; index < ordered.length; index++) {
        const from = ordered[index]!, to = ordered[(index + 1) % ordered.length]!
        g.line(0, from[0], from[1], to[0], to[1])
      }
    } else g.poly(0, ordered, true, rule.constantWidth)
  }
  frame(layout.outerMargins, layout.frameStyle.outer)
  frame(layout.innerMargins, layout.frameStyle.inner)
  const locale = geologyLocale(input)
  const titleValue = bounded(input.title ?? (locale === 'zh-CN' ? '工程地质剖面图' : 'ENGINEERING GEOLOGICAL SECTION'), 'title')
  const scaleValue = locale === 'zh-CN'
    ? `水平比例尺 1:${scaleDenominator(input.horizontalScaleDenominator)}   垂直比例尺 1:${scaleDenominator(input.verticalScaleDenominator)}`
    : `HORIZONTAL 1:${scaleDenominator(input.horizontalScaleDenominator)}   VERTICAL 1:${scaleDenominator(input.verticalScaleDenominator)}`
  if (layout.headingTextStyle) {
    const titleStyle = layout.headingTextStyle.title, scaleStyle = layout.headingTextStyle.scale
    g.placedText(3, titleStyle.anchorX, layout.titleY, titleValue, titleStyle.height, titleStyle.textWidthFactor,
      titleStyle.horizontalAlignment, titleStyle.verticalAlignment, 0)
    g.placedText(3, scaleStyle.anchorX, layout.scaleY, scaleValue, scaleStyle.height, scaleStyle.textWidthFactor,
      scaleStyle.horizontalAlignment, scaleStyle.verticalAlignment, 0)
  } else {
    g.text(3, layout.paperWidth / 2, layout.titleY, titleValue, 5, true)
    g.text(3, layout.paperWidth / 2, layout.scaleY, scaleValue, 2.5, true)
  }
  g.line(1, layout.plotLeft, layout.plotBottom, layout.plotLeft, layout.plotTop)
  g.line(1, layout.plotLeft, layout.plotBottom, layout.plotRight, layout.plotBottom)
  if (sectionReference) {
    const style = layout.sectionReferenceStyle!
    emitPlaced(0, 0, sectionReference.start, style.start)
    emitPlaced(0, 0, sectionReference.end, style.end)
  }
  const maximumElevation = layout.elevationTickSequence?.maximumElevation ?? Math.max(...holes.map(hole => hole.collarElevation))
  const minimumElevation = layout.elevationTickSequence?.minimumElevation ?? datum
  const elevationTickStep = layout.elevationTickSequence?.step ?? layout.elevationTickStep
  const elevationTickStart = layout.elevationTickSequence?.startElevation ?? Math.ceil(datum / elevationTickStep) * elevationTickStep
  let elevationTickCount = 0
  for (let elevation = elevationTickStart; elevation <= maximumElevation + 1e-9; elevation += elevationTickStep) {
    if (elevation < minimumElevation - 1e-9) continue
    const tickY = layout.plotBottom + (elevation - datum) * vs
    if (tickY < layout.innerMargins.bottom - 1e-9 || tickY > layout.plotTop + 1e-9)
      throw new KJValidationError('Geology: source-backed elevation tick sequence leaves the bounded drawing region')
    const scaleRail = layout.elevationScaleRailStyle
    if (scaleRail) {
      const left = layout.plotLeft + scaleRail.xOffsets[0], right = layout.plotLeft + scaleRail.xOffsets[1]
      const bottom = tickY + scaleRail.tickCellYOffset[0], top = tickY + scaleRail.tickCellYOffset[1]
      if (left < layout.innerMargins.left - 1e-9 || right > layout.paperWidth - layout.innerMargins.right + 1e-9 ||
        bottom < layout.innerMargins.bottom - 1e-9 || top > layout.plotTop + 1e-9)
        throw new KJValidationError('Geology: elevation scale rail leaves the bounded drawing region')
      g.line(1, left, tickY, right, tickY)
      g.solid(1, [[left, bottom], [right, bottom], [left, top], [right, top]])
    } else g.line(1, layout.plotLeft - 1.8, tickY, layout.plotLeft + 2.2, tickY)
    const visible = Number.isInteger(elevation) ? elevation.toFixed(0) : metres(elevation)
    if (layout.sectionTextStyle) emitTextRole(layout.plotLeft, tickY, visible, layout.sectionTextStyle.elevationTick)
    else g.text(3, layout.plotLeft - 13, tickY - 0.7, visible, 1.6)
    elevationTickCount++
  }
  const footerBottom = layout.footerFrameStyle?.bottom ?? layout.innerMargins.bottom
  const footerTop = layout.footerFrameStyle?.top ?? footerBottom + layout.footerHeight
  const footerLeft = layout.footerFrameStyle?.left ?? layout.innerMargins.left
  const footerRight = layout.footerFrameStyle?.right ?? layout.paperWidth - layout.innerMargins.right
  if (layout.footerFrameStyle?.primitive === 'line-segments') {
    g.line(0, footerLeft, footerBottom, footerRight, footerBottom)
    g.line(0, footerRight, footerBottom, footerRight, footerTop)
    g.line(0, footerRight, footerTop, footerLeft, footerTop)
    g.line(0, footerLeft, footerTop, footerLeft, footerBottom)
  } else g.rect(0, footerLeft, footerBottom, footerRight, footerTop)
  const footerValues: Record<string, string | undefined> = { projectName: input.projectName, ...documentFacts }
  if (layout.footerFrameStyle?.cellMode !== 'none') {
    for (const [index, cell] of layout.footerGrid.entries()) {
      const end = layout.footerGrid[index + 1]?.start ?? footerRight
      if (index) g.line(0, cell.start, footerBottom, cell.start, footerTop)
      const split = cell.start + Math.min((end - cell.start) * 0.42, 3 + [...cell.label].length * 1.75)
      g.line(1, split, footerBottom, split, footerTop)
      g.text(3, cell.start + 1.2, footerBottom + 2.8, cell.label, 1.6)
      if (footerValues[cell.key]) g.text(3, split + 1.2, footerBottom + 2.8, footerValues[cell.key]!, 1.6)
    }
  }
  const surface = holes.map(hole => [x(hole), y(hole, 0)] as [number, number])
  const sectionText = layout.sectionTextStyle
  if (sectionText?.station.mode === 'adjacent-spacing-between-holes') {
    if (sectionText.stationLabel.visibility === 'shown') emitTextRole(layout.plotLeft, footerBottom,
      locale === 'zh-CN' ? '勘探点间距(m)' : 'POINT SPACING (m)', sectionText.stationLabel)
    for (let index = 1; index < holes.length; index++) {
      const left = holes[index - 1]!, right = holes[index]!
      emitTextRole((x(left) + x(right)) / 2, footerBottom, fixed(right.station! - left.station!, sectionText.station.precision), sectionText.station)
    }
  } else if (sectionText?.stationLabel.visibility === 'shown') emitTextRole(layout.plotLeft, footerBottom,
    locale === 'zh-CN' ? '里程' : 'STATION', sectionText.stationLabel)
  g.poly(1, surface)
  const intervalBottomLabelOverrides = new Map((sectionText?.intervalBottom.labelOverrides ?? []).map(item =>
    [`${item.holeId}\u0000${item.intervalId}`, item]))
  const holeIdentifierLabelOverrides = new Map((sectionText?.holeIdentifier.labelOverrides ?? []).map(item =>
    [item.holeId, item.placement]))
  for (const item of sectionText?.holeIdentifier.labelOverrides ?? []) {
    if (!byId.has(item.holeId))
      throw new KJValidationError('Geology: section hole identifier label override references an unknown supplied hole')
  }
  const holeEndDateRole = sectionText?.holeEndDate
  const visibleHoleEndDate = (raw: string): string => {
    const supplied = bounded(raw, 'section hole end date', 32)
    if (holeEndDateRole?.format === 'as-supplied') return supplied
    const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/u.exec(supplied)
    if (!match) throw new KJValidationError('Geology: section hole end date needs an ISO date for date-only presentation')
    return match[1]!
  }
  const holeEndDateLabelOverrides = new Map((holeEndDateRole?.labelOverrides ?? []).map(item => [item.holeId, item]))
  if (holeEndDateRole) {
    for (const hole of holes) {
      if (hole.endDate == null) throw new KJValidationError('Geology: section hole end date role requires a supplied end date for every hole')
      visibleHoleEndDate(hole.endDate)
    }
  }
  for (const item of holeEndDateRole?.labelOverrides ?? []) {
    const hole = byId.get(item.holeId)?.hole
    if (hole?.endDate == null)
      throw new KJValidationError('Geology: section hole end date label override references an unknown hole or missing supplied end date')
    if (item.endDate !== visibleHoleEndDate(hole.endDate))
      throw new KJValidationError('Geology: section hole end date label override does not match its supplied end date')
  }
  const collarElevationLabelOverrides = new Map((sectionText?.collarElevation.labelOverrides ?? []).map(item =>
    [item.holeId, item]))
  for (const item of sectionText?.collarElevation.labelOverrides ?? []) {
    const supplied = byId.get(item.holeId)?.hole
    if (!supplied)
      throw new KJValidationError('Geology: section collar elevation label override references an unknown supplied hole')
    if (Math.abs(item.elevation - supplied.collarElevation) > 0.005 + 1e-9)
      throw new KJValidationError('Geology: section collar elevation label override does not match its supplied collar')
  }
  for (const item of sectionText?.intervalBottom.labelOverrides ?? []) {
    const supplied = byId.get(item.holeId)
    const interval = supplied?.strata.find(candidate => candidate.intervalId === item.intervalId)
    if (!interval)
      throw new KJValidationError('Geology: section interval bottom label override references an unknown supplied interval')
    const displayTolerance = 0.5 * 10 ** -sectionText!.intervalBottom.precision + 1e-9
    if (Math.abs(item.depth - interval.bottom) > displayTolerance)
      throw new KJValidationError('Geology: section interval bottom label override depth does not match its supplied interval')
  }
  const groundwaterStyle = layout.observationSymbolStyle?.groundwater
  const stableWaterLabelOverrides = new Map((groundwaterStyle?.labelOverrides ?? []).map(item =>
    [`${item.holeId}\u0000${item.observationRole}`, item]))
  for (const item of groundwaterStyle?.labelOverrides ?? []) {
    const hole = byId.get(item.holeId)?.hole
    if (hole?.stableWaterDepth == null)
      throw new KJValidationError('Geology: section stable groundwater label override references an unknown supplied observation')
    const displayTolerance = 0.5 * 10 ** -(groundwaterStyle?.labelPrecision ?? 2) + 1e-9
    if (Math.abs(item.depth - hole.stableWaterDepth) > displayTolerance)
      throw new KJValidationError('Geology: section stable groundwater label override depth does not match its supplied observation')
  }
  const sptLabelOverrides = new Map((layout.observationSymbolStyle?.spt.labelOverrides ?? []).map(item =>
    [`${item.holeId}\u0000${item.observationId}`, item.placement]))
  for (const item of layout.observationSymbolStyle?.spt.labelOverrides ?? []) {
    const hole = holes.find(candidate => candidate.id === item.holeId)
    const observation = hole?.observations?.find(candidate => candidate.id === item.observationId)
    if (!observation || observation.kind !== 'spt')
      throw new KJValidationError('Geology: section SPT label override references an unknown supplied SPT observation')
  }
  for (const hole of holes) {
    const center = x(hole), top = y(hole, 0), bottom = y(hole, hole.depth)
    const half = layout.boreholeWidth / 2
    const profile = layout.boreholeProfileStyle
    if (profile) {
      const guideStart = layout.footerFrameStyle?.guideY ?? footerTop
      const guideEnd = bottom + profile.guideEndOffset
      const tickStart = center + profile.bottomTickOffsets[0], tickEnd = center + profile.bottomTickOffsets[1]
      const collarLeft = center - profile.collarBarHalfWidth, collarRight = center + profile.collarBarHalfWidth
      const collarY = top + profile.collarBarYOffset
      if (guideEnd <= guideStart || guideEnd >= bottom || Math.min(tickStart, tickEnd, collarLeft) < layout.innerMargins.left ||
        Math.max(tickStart, tickEnd, collarRight) > layout.paperWidth - layout.innerMargins.right ||
        collarY < layout.plotBottom || collarY > layout.plotTop)
        throw new KJValidationError(`Geology: borehole profile geometry for ${hole.id} is physically unreadable`)
      g.line(4, center, guideStart, center, guideEnd)
      g.poly(1, [[center, bottom], [center, top]])
      g.line(1, tickStart, bottom, tickEnd, bottom)
      g.line(1, collarLeft, collarY, collarRight, collarY)
    } else {
      g.line(4, center, layout.footerFrameStyle?.guideY ?? footerTop, center, top)
      g.rect(1, center - half, bottom, center + half, top)
      g.line(1, center - 5, top + 4.7, center + 5, top + 4.7)
    }
    if (sectionText) {
      const collarLabelOverride = collarElevationLabelOverrides.get(hole.id)
      emitTextRole(center, top, hole.id, holeIdentifierLabelOverrides.get(hole.id) ?? sectionText.holeIdentifier)
      emitTextRole(center, top, metres(collarLabelOverride?.elevation ?? hole.collarElevation),
        collarLabelOverride?.placement ?? sectionText.collarElevation)
      if (holeEndDateRole && hole.endDate != null) {
        const override = holeEndDateLabelOverrides.get(hole.id)
        emitTextRole(center, top, override?.endDate ?? visibleHoleEndDate(hole.endDate), override?.placement ?? holeEndDateRole)
      }
      if (sectionText.station.mode === 'cumulative-at-hole') emitTextRole(center, layout.plotBottom,
        `${locale === 'zh-CN' ? '里程' : 'STA'} ${fixed(hole.station!, sectionText.station.precision)}`, sectionText.station)
      if (sectionText.holeDepth.visibility === 'shown') emitTextRole(center, layout.plotBottom,
        `${locale === 'zh-CN' ? '孔深' : 'DEPTH'} ${fixed(hole.depth, sectionText.holeDepth.precision)}`, sectionText.holeDepth)
    } else {
      g.text(3, center, top + 6.2, hole.id, 2.1, true)
      g.text(3, center, top + 3.2, metres(hole.collarElevation), 1.5, true)
      g.text(3, center - 9, layout.plotBottom - 8, `${locale === 'zh-CN' ? '里程' : 'STA'} ${metres(hole.station!)}`, 1.7)
      g.text(3, center - 9, layout.plotBottom - 13, `${locale === 'zh-CN' ? '孔深' : 'DEPTH'} ${metres(hole.depth)}`, 1.7)
    }
    for (const layer of byId.get(hole.id)!.strata) {
      const a = y(hole, layer.top), b = y(hole, layer.bottom)
      g.line(1, center - half - 1, b, center + half + 5, b)
      if (layer.patternVisibility !== 'boundary-only') g.hatch([[center - half, b], [center + half, b], [center + half, a], [center - half, a]], layer,
        layout.sectionHatchPresentation?.boreholeColumn)
      if (sectionText) {
        const role = sectionText.intervalBottom
        const override = layer.intervalId == null ? undefined : intervalBottomLabelOverrides.get(`${hole.id}\u0000${layer.intervalId}`)
        const depth = fixed(override?.depth ?? layer.bottom, role.precision)
        const elevation = override?.elevation ?? hole.collarElevation - layer.bottom
        const visible = role.format === 'depth-elevation' ? `${depth}-${fixed(elevation, role.precision)}` : depth
        emitTextRole(center, b, visible, override?.placement ?? role)
      } else g.text(3, center + half + 1.5, b + 0.5, metres(layer.bottom), 1.35)
    }
    if (hole.stableWaterDepth != null) {
      const waterY = y(hole, hole.stableWaterDepth)
      const style = layout.observationSymbolStyle?.groundwater
      if (style) {
        const insertX = center + style.insertOffset[0], insertY = waterY + style.insertOffset[1]
        for (const [[x1, y1], [x2, y2]] of style.lineSegments) g.line(1, insertX + x1, insertY + y1, insertX + x2, insertY + y2)
        const marker = style.markerPolygon.map(([x, y]) => [insertX + x, insertY + y] as [number, number])
        g.poly(1, marker, true)
        if (style.fill === 'solid') g.solidPolygonHatch(marker)
        if (style.labelPlacement) {
          const override = stableWaterLabelOverrides.get(`${hole.id}\u0000stable-water`)
          const precision = style.labelPrecision ?? 2
          const depth = override?.depth ?? hole.stableWaterDepth
          const elevation = override?.elevation ?? hole.collarElevation - hole.stableWaterDepth
          const visible = style.labelFormat === 'depth-elevation' ? `${fixed(depth, precision)}-${fixed(elevation, precision)}` :
            `${locale === 'zh-CN' ? '水位' : 'WL'} ${metres(hole.stableWaterDepth)}`
          emitPlaced(center, waterY, visible, override?.placement ?? style.labelPlacement)
        }
      } else {
        g.line(1, center - 5, waterY, center + 5, waterY)
        g.poly(1, [[center - 2, waterY + 1.2], [center, waterY - 1], [center + 2, waterY + 1.2]])
        g.text(3, center + 6, waterY - 0.7, `${locale === 'zh-CN' ? '水位' : 'WL'} ${metres(hole.stableWaterDepth)}`, 1.5)
      }
    }
    for (const observation of hole.observations ?? []) {
      const observationY = y(hole, observation.depth), markerX = center + half + 5
      const symbolStyle = layout.observationSymbolStyle
      if (symbolStyle) {
        if (observation.kind === 'sample') {
          const style = symbolStyle.sample, symbolX = center + style.centerOffset[0], symbolY = observationY + style.centerOffset[1]
          g.circle(1, symbolX, symbolY, style.radius)
          if (style.fill === 'solid' && observation.sampleMarker !== 'open-circle') g.circularHatch(symbolX, symbolY, style.radius)
          if (style.labelPlacement) emitPlaced(center, observationY, observation.displayLabel ?? observation.id, style.labelPlacement)
        } else {
          const style = symbolStyle.spt, right = center + style.topRightOffset[0], top = observationY + style.topRightOffset[1]
          const left = right - style.width, bottom = top - style.height
          g.line(1, right, top, left, top)
          g.line(1, left, top, left, bottom)
          g.line(1, left, bottom, right, bottom)
          g.line(1, right, bottom, right, top)
          const shown = Number.isInteger(observation.value) ? observation.value!.toString() : metres(observation.value!)
          const placement = sptLabelOverrides.get(`${hole.id}\u0000${observation.id}`) ?? style.labelPlacement
          emitPlaced(center, observationY, observation.displayLabel ?? `N=${shown}`, placement)
        }
        continue
      }
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
    g.hatch([[xl, bottomL], [xr, bottomR], [xr, topR], [xl, topL]], a, layout.sectionHatchPresentation?.stratigraphicBand)
    g.line(1, xl, bottomL, xr, bottomR)
    g.line(1, xl, topL, xr, topR)
    g.text(3, (xl + xr) / 2, (topL + topR + bottomL + bottomR) / 4, a.code, 1.8, true)
  }
  if (topology) {
    const topologyPoint = (point: { station: number; elevation: number }): [number, number] => [
      originX + (point.station - holes[0]!.station!) * hs,
      layout.plotBottom + (point.elevation - datum) * vs,
    ]
    for (const cell of [...topology.mainCells, ...topology.lensCells])
      g.hatch(cell.points.map(topologyPoint), cell.source as KJGeologyStratum, layout.sectionHatchPresentation?.stratigraphicBand)
    for (const boundary of topology.mainBoundaries) {
      const [start, end] = boundary.points.map(topologyPoint) as [[number, number], [number, number]]
      g.semanticLine(1, start[0], start[1], end[0], end[1], {
        semanticRole: 'source-group-boundary', topologyIdentity: boundary.identity, topologyMode: boundary.mode,
      })
    }
  }
  let stratigraphicGroupLabelEntityCount = 0
  const stratigraphicGroups = new Set<string>()
  for (const [labelIndex, label] of (layout.sourceBackedStratigraphicGroupLabels ?? []).entries()) {
    const source = byId.get(label.sourceHoleId)?.strata.find(stratum => stratum.intervalId === label.sourceIntervalId)
    if (!source) throw new KJValidationError(`Geology: section stratigraphic group label ${labelIndex + 1} references an unknown supplied interval`)
    if (source.groupRole !== 'principal' || source.groupId == null || source.stratigraphicNotation == null)
      throw new KJValidationError(`Geology: section stratigraphic group label ${labelIndex + 1} needs a principal interval with supplied notation`)
    if (stratigraphicGroups.has(source.groupId)) throw new KJValidationError('Geology: duplicate section stratigraphic group label group fact')
    stratigraphicGroups.add(source.groupId)
    const signature = JSON.stringify([source.code, source.stratigraphicNotation])
    const peers = [...byId.values()].flatMap(value => value.strata).filter(candidate =>
      candidate.groupRole === 'principal' && candidate.groupId === source.groupId)
    if (!peers.length || peers.some(candidate => JSON.stringify([candidate.code, candidate.stratigraphicNotation]) !== signature))
      throw new KJValidationError('Geology: section stratigraphic group label disagrees with another supplied principal interval')
    const style = layout.stratigraphicGroupLabelStyle!
    const baseX = originX + (label.anchor[0] - holes[0]!.station!) * hs
    const baseY = layout.plotBottom + (label.anchor[1] - datum) * vs
    const points = [style.code.offset, style.code.fitEndOffset, style.symbol.offset,
      ...(source.stratigraphicNotation.subscript == null ? [] : [style.subscript.offset]),
      ...(source.stratigraphicNotation.superscript == null ? [] : [style.superscript.offset])]
      .map(offset => [baseX + offset[0], baseY + offset[1]] as [number, number])
    if (points.some(([px, py]) => px < layout.innerMargins.left - 1e-9 || px > layout.paperWidth - layout.innerMargins.right + 1e-9 ||
      py < layout.plotBottom - 1e-9 || py > layout.plotTop + 1e-9))
      throw new KJValidationError(`Geology: section stratigraphic group label ${labelIndex + 1} leaves the bounded section body`)
    g.fitText(3, baseX + style.code.offset[0], baseY + style.code.offset[1],
      baseX + style.code.fitEndOffset[0], baseY + style.code.fitEndOffset[1], source.code,
      style.code.height, style.code.textWidthFactor, style.code.verticalAlignment)
    emitTextRole(baseX, baseY, source.stratigraphicNotation.symbol, style.symbol)
    stratigraphicGroupLabelEntityCount += 2
    if (source.stratigraphicNotation.subscript != null) {
      emitTextRole(baseX, baseY, source.stratigraphicNotation.subscript, style.subscript)
      stratigraphicGroupLabelEntityCount++
    }
    if (source.stratigraphicNotation.superscript != null) {
      emitTextRole(baseX, baseY, source.stratigraphicNotation.superscript, style.superscript)
      stratigraphicGroupLabelEntityCount++
    }
  }
  g.text(3, layout.innerMargins.left + 2, footerTop + 2.2, locale === 'zh-CN'
    ? topology ? '仅显示源数据声明的地层组拓扑；未证实区域按设计留空。' : '仅显示已提供的地层与对比关系；未对比区域按设计留空。'
    : topology ? 'Only source-declared group topology is shown. Unproven regions remain blank.' : 'Only supplied strata/correlations are shown. Uncorrelated regions are intentionally blank.', 1.5)
  for (const [bandIndex, band] of (layout.sourceBackedBands ?? []).entries()) {
    const source = byId.get(band.sourceHoleId)?.strata.find(stratum => stratum.intervalId === band.sourceIntervalId)
    if (!source) throw new KJValidationError(`Geology: source-backed band ${bandIndex + 1} references an unknown supplied interval`)
    if (source.patternVisibility === 'boundary-only')
      throw new KJValidationError(`Geology: source-backed band ${bandIndex + 1} references a boundary-only interval`)
    const points = band.points.map(([station, elevation]) => [
      originX + (station - holes[0]!.station!) * hs,
      layout.plotBottom + (elevation - datum) * vs,
    ] as [number, number])
    if (points.some(([px, py]) => px < layout.innerMargins.left - 1e-9 || px > layout.paperWidth - layout.innerMargins.right + 1e-9 ||
      py < layout.innerMargins.bottom - 1e-9 || py > layout.plotTop + 1e-9))
      throw new KJValidationError(`Geology: source-backed band ${bandIndex + 1} leaves the bounded drawing region`)
    const physicalArea = Math.abs(points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!
      return sum + point[0] * next[1] - next[0] * point[1]
    }, 0)) / 2
    if (physicalArea < 0.01) throw new KJValidationError(`Geology: source-backed band ${bandIndex + 1} is physically unreadable`)
    g.hatch(points, source, layout.sectionHatchPresentation?.stratigraphicBand)
  }
  for (const [symbolIndex, symbol] of (layout.sourceBackedPatternSymbols ?? []).entries()) {
    const points = symbol.points.map(([station, elevation]) => [
      originX + (station - holes[0]!.station!) * hs,
      layout.plotBottom + (elevation - datum) * vs,
    ] as [number, number]) as [[number, number], [number, number], [number, number]]
    if (points.some(([px, py]) => px < layout.innerMargins.left - 1e-9 || px > layout.paperWidth - layout.innerMargins.right + 1e-9 ||
      py < layout.plotBottom - 1e-9 || py > layout.plotTop + 1e-9))
      throw new KJValidationError(`Geology: source-backed pattern symbol ${symbolIndex + 1} leaves the bounded section body`)
    const area = Math.abs(points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!
      return sum + point[0] * next[1] - next[0] * point[1]
    }, 0)) / 2
    const edgeLengths = points.map((point, index) => Math.hypot(point[0] - points[(index + 1) % points.length]![0], point[1] - points[(index + 1) % points.length]![1]))
    if (area < 0.01 || edgeLengths.some(length => length < 0.2 || length > 20))
      throw new KJValidationError(`Geology: source-backed pattern symbol ${symbolIndex + 1} is physically unreadable`)
    for (let index = 0; index < points.length; index++) {
      const start = points[index]!, end = points[(index + 1) % points.length]!
      g.line(1, start[0], start[1], end[0], end[1])
    }
  }
  for (const [boundaryIndex, boundary] of (layout.sourceBackedBoundaryPolylines ?? []).entries()) {
    const points = boundary.points.map(([station, elevation]) => [
      originX + (station - holes[0]!.station!) * hs,
      layout.plotBottom + (elevation - datum) * vs,
    ] as [number, number])
    if (points.some(([px, py]) => px < layout.innerMargins.left - 1e-9 || px > layout.paperWidth - layout.innerMargins.right + 1e-9 ||
      py < layout.innerMargins.bottom - 1e-9 || py > layout.plotTop + 1e-9))
      throw new KJValidationError(`Geology: source-backed boundary polyline ${boundaryIndex + 1} leaves the bounded section region`)
    const closed = boundary.primitive === 'closed-polyline'
    const length = points.reduce((sum, point, index) => {
      if (!closed && index === points.length - 1) return sum
      const next = points[(index + 1) % points.length]!
      return sum + Math.hypot(point[0] - next[0], point[1] - next[1])
    }, 0)
    if (length < 0.2 || length > 4000)
      throw new KJValidationError(`Geology: source-backed boundary polyline ${boundaryIndex + 1} is physically unreadable`)
    g.poly(1, points, closed)
  }
  return g.finish({ horizontalScaleDenominator: input.horizontalScaleDenominator, verticalScaleDenominator: input.verticalScaleDenominator,
    ...(layout.elevationTickSequence ? { elevationTickCount } : {}),
    ...(layout.elevationScaleRailStyle ? { elevationScaleSolidCount: elevationTickCount } : {}),
    ...(layout.sourceBackedBands ? { sourceBackedBandCount: layout.sourceBackedBands.length } : {}),
    ...(layout.sourceBackedPatternSymbols ? { sourceBackedPatternSymbolCount: layout.sourceBackedPatternSymbols.length,
      sourceBackedPatternEntityCount: layout.sourceBackedPatternSymbols.length * 3 } : {}),
    ...(sectionText?.intervalBottom.labelOverrides ?
      { sourceBackedIntervalBottomLabelOverrideCount: sectionText.intervalBottom.labelOverrides.length } : {}),
    ...(sectionText?.holeIdentifier.labelOverrides ?
      { sourceBackedHoleIdentifierLabelOverrideCount: sectionText.holeIdentifier.labelOverrides.length } : {}),
    ...(sectionText?.holeEndDate?.labelOverrides ?
      { sourceBackedHoleEndDateLabelOverrideCount: sectionText.holeEndDate.labelOverrides.length } : {}),
    ...(sectionText?.collarElevation.labelOverrides ?
      { sourceBackedCollarElevationLabelOverrideCount: sectionText.collarElevation.labelOverrides.length } : {}),
    ...(groundwaterStyle?.labelOverrides ?
      { sourceBackedStableWaterLabelOverrideCount: groundwaterStyle.labelOverrides.length } : {}),
    ...(layout.observationSymbolStyle?.spt.labelOverrides ?
      { sourceBackedSptLabelOverrideCount: layout.observationSymbolStyle.spt.labelOverrides.length } : {}),
    ...(layout.sourceBackedBoundaryPolylines ? { sourceBackedBoundaryPolylineCount: layout.sourceBackedBoundaryPolylines.length } : {}),
    ...(layout.sourceBackedStratigraphicGroupLabels ? {
      sourceBackedStratigraphicGroupLabelCount: layout.sourceBackedStratigraphicGroupLabels.length,
      sourceBackedStratigraphicGroupLabelEntityCount: stratigraphicGroupLabelEntityCount,
    } : {}),
    ...(layout.boreholeProfileStyle ? { boreholeProfileElementCount: holes.length * 4 } : {}),
    datumElevation: datum, styleRule: 'geology-section-layout',
    ...(topology ? { correlationMode, topologyMainCellCount: topology.mainCells.length, topologyLensCellCount: topology.lensCells.length,
      topologyMainBoundaryCount: topology.mainBoundaries.length } : {}) })
}
