import {
  KJKnowledgePackRegistry,
  KJDRAW_KNOWLEDGE_PACK_SCHEMA,
  validateKnowledgePack,
  type KJKnowledgePack,
} from '../knowledge-pack.js'
import { stableHash, type ReadonlyDeep } from '../utils.js'

/**
 * Public, sanitized geology semantics. This pack describes intent vocabulary
 * and drawing rules only; it contains no private drawings or survey data.
 * The small hatch catalog below is original redistributable data, not copied
 * from the private reference corpus.
 */
const provenance = {
  id: 'kjdraw-geology-semantics',
  title: 'KJDraw public geology semantic contract',
  license: 'Apache-2.0',
  scope: 'sanitized-domain-semantics-v1',
} as const

const openHatchPatterns = [
  { name: 'GEO_FILL', description: 'Irregular crossed fill', lines: [
    { angle: Math.PI / 4, base: [0, 0], offset: [0, 4], dashes: [5, -3] },
    { angle: -Math.PI / 4, base: [1, 0], offset: [0, 7], dashes: [2, -5] },
  ] },
  { name: 'GEO_TOPSOIL', description: 'Sparse organic topsoil marks', lines: [
    { angle: 0, base: [0, 0], offset: [0, 4], dashes: [0, -2, 0, -7] },
    { angle: Math.PI / 2, base: [1, 0], offset: [7, 0], dashes: [1, -8] },
  ] },
  { name: 'GEO_FINE_SOIL', description: 'Fine soil dots', lines: [
    { angle: 0, base: [0, 0], offset: [0, 3], dashes: [0, -3] },
  ] },
  { name: 'GEO_SILTY_CLAY', description: 'Short horizontal strokes with sparse dots', lines: [
    { angle: 0, base: [0, 0], offset: [0, 3], dashes: [2, -3] },
    { angle: Math.PI / 2, base: [0, 0], offset: [6, 0], dashes: [0, -6] },
  ] },
  { name: 'GEO_SILT', description: 'Fine broken horizontal strokes', lines: [
    { angle: 0, base: [0, 0], offset: [0, 2.5], dashes: [1.2, -2.3] },
  ] },
  { name: 'GEO_SAND', description: 'Dense granular dots', lines: [
    { angle: 0, base: [0, 0], offset: [0, 2.2], dashes: [0, -2.2] },
    { angle: 0, base: [1.1, 1.1], offset: [0, 4.4], dashes: [0, -4.4] },
  ] },
  { name: 'GEO_GRAVEL', description: 'Coarse crossed grains', lines: [
    { angle: Math.PI / 4, base: [0, 0], offset: [0, 6], dashes: [1.5, -4.5] },
    { angle: -Math.PI / 4, base: [2, 0], offset: [0, 6], dashes: [1.5, -4.5] },
  ] },
  { name: 'GEO_ROCK', description: 'Inclined bedding', lines: [
    { angle: Math.PI / 6, base: [0, 0], offset: [0, 3.5], dashes: [] },
  ] },
  { name: 'GEO_WEATHERED_ROCK', description: 'Broken inclined bedding', lines: [
    { angle: Math.PI / 6, base: [0, 0], offset: [0, 3.5], dashes: [5, -2] },
    { angle: -Math.PI / 6, base: [0, 0], offset: [0, 8], dashes: [1.5, -6.5] },
  ] },
  { name: 'GEO_LOESS', description: 'Vertical pore marks and fine dots', lines: [
    { angle: Math.PI / 2, base: [0, 0], offset: [3, 0], dashes: [1, -3] },
    { angle: 0, base: [0, 0], offset: [0, 5], dashes: [0, -5] },
  ] },
  { name: 'GEO_COLLAPSIBLE_LOESS', description: 'Pore marks with collapse markers', lines: [
    { angle: Math.PI / 2, base: [0, 0], offset: [3, 0], dashes: [2, -2] },
    { angle: 0, base: [1.5, 0], offset: [0, 6], dashes: [0, -3, 0, -9] },
  ] },
  { name: 'GEO_LOESS_LIKE', description: 'Sparse pore marks', lines: [
    { angle: Math.PI / 2, base: [0, 0], offset: [4, 0], dashes: [1, -5] },
    { angle: 0, base: [2, 0], offset: [0, 7], dashes: [0, -7] },
  ] },
  { name: 'GEO_PALEOSOL', description: 'Soil horizon dash and dot bands', lines: [
    { angle: 0, base: [0, 0], offset: [0, 3.5], dashes: [4, -2, 0, -2] },
  ] },
  { name: 'GEO_NODULE', description: 'Widely spaced nodule points', lines: [
    { angle: 0, base: [0, 0], offset: [0, 5], dashes: [0, -2, 0, -8] },
    { angle: Math.PI / 2, base: [2.5, 0], offset: [8, 0], dashes: [0, -3, 0, -12] },
  ] },
] as const

const openHatchMappings = {
  fill: 'GEO_FILL', 'cultivated-soil': 'GEO_TOPSOIL', clay: 'GEO_FINE_SOIL', 'silty-clay': 'GEO_SILTY_CLAY',
  silt: 'GEO_SILT', sand: 'GEO_SAND', gravel: 'GEO_GRAVEL', rock: 'GEO_ROCK', 'weathered-rock': 'GEO_WEATHERED_ROCK',
  loess: 'GEO_LOESS', 'loess-collapsible': 'GEO_COLLAPSIBLE_LOESS', 'loess-like': 'GEO_LOESS_LIKE',
  paleosol: 'GEO_PALEOSOL', 'calcareous-nodule': 'GEO_NODULE',
} as const

export const KJDRAW_GEOLOGY_KNOWLEDGE_PACK: ReadonlyDeep<KJKnowledgePack> = validateKnowledgePack({
  schema: KJDRAW_KNOWLEDGE_PACK_SCHEMA,
  id: 'geology.core',
  version: '1.0.0',
  title: 'KJDraw geology columns and sections',
  domain: 'geology',
  license: { spdx: 'Apache-2.0', redistributable: true, trainingAllowed: true },
  sources: [{ ...provenance, contentHash: stableHash(provenance) }],
  ontology: {
    objectKinds: [
      'borehole',
      'borehole-sequence',
      'stratum',
      'sublayer',
      'sample',
      'groundwater',
      'geology-section',
      'section-profile',
      'elevation-marker',
      'lithology-legend',
      'hatch-pattern',
      'geology-annotation',
    ],
    relationKinds: [
      'contains-stratum',
      'contains-sublayer',
      'hosted-by-stratum',
      'orders-borehole',
      'stratigraphic-overlies',
      'stratigraphic-underlies',
      'correlates-with',
      'sampled-from',
      'water-level-in',
      'projects-to-section',
      'annotates',
      'uses-hatch-pattern',
    ],
  },
  templates: {
    'borehole-column': {
      required: ['borehole.depth', 'borehole.verticalScale', 'stratum.top', 'stratum.bottom', 'stratum.lithology'],
      optional: ['borehole.collarElevation', 'sample.interval', 'groundwater.elevation', 'elevation-marker.value'],
      outputs: ['column', 'depth-scale', 'lithology-fill', 'legend', 'labels'],
      program: {
        version: '1.0.0',
        rootKind: 'borehole',
        layers: [
          { name: 'GEOLOGY_BOUNDARY', color: 7, lineweight: 35 },
          { name: 'GEOLOGY_HATCH', color: 8, lineweight: 18 },
          { name: 'GEOLOGY_TEXT', color: 2, lineweight: 18 },
        ],
        steps: [
          {
            emit: [
              {
                primitive: 'line', layer: 'GEOLOGY_BOUNDARY', start: [0, 0],
                end: [0, { op: 'negate', args: [{ op: 'multiply', args: [{ get: 'root.properties.depth' }, { get: 'root.properties.verticalScale' }] }] }],
              },
              {
                primitive: 'text', layer: 'GEOLOGY_TEXT', position: [0, 1], height: 0.6,
                value: { concat: [{ get: 'root.properties.name' }, '  DEPTH ', { get: 'root.properties.depth' }, ' m'] },
              },
            ],
          },
          {
            select: { relationKind: 'contains-stratum', direction: 'outgoing', objectKind: 'stratum', sortBy: 'properties.top' },
            continuity: { startPath: 'properties.top', endPath: 'properties.bottom', first: 0, final: { get: 'root.properties.depth' }, tolerance: 1e-9 },
            emit: [
              {
                primitive: 'rectangle', layer: 'GEOLOGY_BOUNDARY',
                origin: [0, { op: 'subtract', args: [0, { op: 'multiply', args: [{ get: 'item.properties.bottom' }, { get: 'root.properties.verticalScale' }] }] }],
                size: [6, { op: 'multiply', args: [{ op: 'subtract', args: [{ get: 'item.properties.bottom' }, { get: 'item.properties.top' }] }, { get: 'root.properties.verticalScale' }] }],
              },
              {
                primitive: 'hatch-rectangle', layer: 'GEOLOGY_HATCH',
                origin: [0, { op: 'subtract', args: [0, { op: 'multiply', args: [{ get: 'item.properties.bottom' }, { get: 'root.properties.verticalScale' }] }] }],
                size: [6, { op: 'multiply', args: [{ op: 'subtract', args: [{ get: 'item.properties.bottom' }, { get: 'item.properties.top' }] }, { get: 'root.properties.verticalScale' }] }],
                patternName: {
                  lookup: {
                    value: { get: 'item.properties.lithology' },
                    cases: { fill: 'CROSS', 'cultivated-soil': 'ANSI37', clay: 'ANSI31', 'silty-clay': 'ANSI37', silt: 'ANSI31', sand: 'ANSI37', gravel: 'CROSS', rock: 'ANSI31', 'weathered-rock': 'CROSS', loess: 'ANSI37', 'loess-collapsible': 'CROSS', 'loess-like': 'ANSI31', paleosol: 'CROSS', 'calcareous-nodule': 'ANSI37' },
                  },
                },
                patternScale: 0.4,
                patternAngleDegrees: 0,
              },
              {
                primitive: 'text', layer: 'GEOLOGY_TEXT',
                position: [8, { op: 'negate', args: [{ op: 'multiply', args: [{ op: 'divide', args: [{ op: 'add', args: [{ get: 'item.properties.top' }, { get: 'item.properties.bottom' }] }, 2] }, { get: 'root.properties.verticalScale' }] }] }],
                height: 0.45,
                value: { concat: [{ get: 'item.properties.lithology' }, '  ', { get: 'item.properties.top' }, '-', { get: 'item.properties.bottom' }, ' m'] },
              },
            ],
          },
        ],
      },
    },
    'geology-section': {
      required: ['section.profile', 'borehole-sequence.items', 'stratum.correlations'],
      optional: ['section.horizontalScale', 'section.verticalScale', 'elevation-marker.value', 'groundwater.elevation'],
      outputs: ['section-boundary', 'correlation-lines', 'lithology-fill', 'legend', 'labels'],
    },
    'lithology-legend': {
      required: ['lithology.code', 'hatch-pattern.key'],
      outputs: ['legend-swatch', 'legend-label'],
    },
  },
  rules: {
    'hatch-pattern-catalog': {
      version: '1.0.0', contentHash: stableHash(openHatchPatterns), patterns: openHatchPatterns, mappings: openHatchMappings,
    },
    'geology-column-layout': {
      paperWidth: 210,
      paperHeight: 297,
      left: 15,
      right: 195,
      headerDepth: 52,
      headerRowHeight: 5,
      fieldHeaderHeight: 12,
      footerReserve: 15,
      titleHeight: 6,
      verticalScaleDenominators: [10, 20, 25, 50, 100, 150, 200, 250, 500, 1000, 2000, 5000],
      legendMode: 'none',
      layerNumberStyle: 'circle',
      textFlow: {
        firstGroupBorrowMm: 8,
        firstGroupUnruled: true,
        firstBaselineMm: 2.2,
        labelPitchMm: 2.8,
        labelHeightMm: 1.5,
        paragraphGapMm: 0.8,
      },
      headerGrid: {
        rows: [
          [{ role: 'projectName', label: '工程名称', optional: true }, { role: 'holeId', label: '勘探点编号' }],
          [{ role: 'x', label: 'X坐标(m)', optional: true }, { role: 'y', label: 'Y坐标(m)', optional: true },
            { role: 'collarElevation', label: '孔口标高(m)' }],
          [{ role: 'startDate', label: '开孔日期', optional: true }, { role: 'endDate', label: '终孔日期', optional: true },
            { role: 'stableWaterDepth', label: '稳定水位(m)', optional: true }],
        ],
      },
      footerGrid: {
        height: 10,
        cells: [
          { start: 15, key: 'organization', label: '勘察单位' },
          { start: 55, key: 'preparedBy', label: '编制' },
          { start: 80, key: 'checkedBy', label: '校核' },
          { start: 105, key: 'approvedBy', label: '审核' },
          { start: 130, key: 'issueDate', label: '制图日期' },
          { start: 160, key: 'drawingNumber', label: '图号' },
        ],
      },
      fieldGrid: [
        { start: 15, role: 'layerNumber', label: '地层', subLabel: '编号' },
        { start: 25, role: 'layerName', label: '地层', subLabel: '名称' },
        { start: 43, role: 'baseElevation', label: '高程', subLabel: '(m)' },
        { start: 55, role: 'thickness', label: '厚度', subLabel: '(m)' },
        { start: 65, role: 'depth', label: '深度', subLabel: '(m)' },
        { start: 75, role: 'pattern', label: '柱状图图例', subLabel: '1:{verticalScale}' },
        { start: 95, role: 'description', label: '地  层  描  述' },
        { start: 145, role: 'sample', label: '取样', subLabel: '编号' },
        { start: 170, role: 'spt', label: '标贯', subLabel: 'N(击)' },
      ],
    },
    'geology-section-layout': {
      paperWidth: 420,
      paperHeight: 297,
      outerMargin: 5,
      innerMargin: 12,
      plotLeft: 34,
      plotRight: 400,
      plotBottom: 43,
      plotTop: 246,
      titleY: 277,
      scaleY: 268,
      footerHeight: 10,
      boreholeWidth: 3.2,
      elevationTickStep: 2,
      footerGrid: [
        { start: 12, key: 'projectName', label: '工程名称' },
        { start: 180, key: 'organization', label: '勘察单位' },
        { start: 254, key: 'preparedBy', label: '编制' },
        { start: 288, key: 'checkedBy', label: '校核' },
        { start: 322, key: 'approvedBy', label: '审核' },
        { start: 356, key: 'drawingNumber', label: '图号' },
      ],
    },
    'data-boundary': {
      missing: 'preserve-unknown-and-request-clarification',
      interpolation: 'forbidden-without-explicit-rule',
      interpretation: 'do-not-invent-strata-or-correlations',
    },
    'depth-and-elevation': {
      depthDirection: 'downward-positive-from-borehole-collar',
      interval: 'stratum-top-is-previous-bottom-and-final-bottom-must-equal-borehole-depth',
      elevation: 'use-supplied-datum-and-units',
      scale: 'horizontal-and-vertical-scales-are-independent-and-must-be-explicit',
    },
    'lithology-fill': {
      mapping: 'lithology-code-to-pattern-key',
      priority: 'explicit-pattern-key-before-lithology-class-default',
      fallback: 'boundary-only-with-visible-unknown-marker',
      customPatternData: 'must-be-supplied-by-a-separately-licensed-pack',
    },
    'lithology-pattern-roles': {
      fill: 'irregular-mixed-grain',
      cultivatedSoil: 'organic-topsoil',
      clay: 'fine-dot',
      siltyClay: 'fine-dot-and-short-line',
      silt: 'fine-dash',
      sand: 'granular-dot',
      gravel: 'coarse-grain',
      rock: 'inclined-bed',
      weatheredRock: 'broken-inclined-bed',
      loess: 'dot-and-short-vertical-line',
      collapsibleLoess: 'dot-short-line-and-collapse-marker',
      loessLike: 'fine-dot-and-short-vertical-line',
      paleosol: 'dot-dash-soil-horizon',
      calcareousNodule: 'nodule-and-dot',
      unknown: 'unfilled-with-unknown-marker',
    },
    'section-correlation': {
      boreholeOrder: 'use-declared-sequence-never-nearest-neighbour-order',
      relation: 'only-draw-declared-correlations',
      discontinuity: 'show-explicit-break-or-termination',
      overlap: 'reject-ambiguous-or-self-crossing-profile',
    },
  },
})

/** Register the bundled pack in a caller-owned registry. */
export function registerGeologyKnowledgePack(
  registry: KJKnowledgePackRegistry = new KJKnowledgePackRegistry(),
): ReadonlyDeep<KJKnowledgePack> {
  return registry.register(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
}
