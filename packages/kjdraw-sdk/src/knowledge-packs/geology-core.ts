import {
  KJKnowledgePackRegistry,
  KJDRAW_KNOWLEDGE_PACK_SCHEMA,
  validateKnowledgePack,
  type KJKnowledgePack,
} from '../knowledge-pack.js'
import { stableHash, type ReadonlyDeep } from '../utils.js'

/**
 * Public, sanitized geology semantics. This pack describes intent vocabulary
 * and drawing rules only; it contains no private drawings, survey data, or
 * renderer-specific hatch geometry.
 */
const provenance = {
  id: 'kjdraw-geology-semantics',
  title: 'KJDraw public geology semantic contract',
  license: 'Apache-2.0',
  scope: 'sanitized-domain-semantics-v1',
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
                    cases: { fill: 'CROSS', clay: 'ANSI31', silt: 'ANSI31', sand: 'ANSI37', gravel: 'CROSS', rock: 'ANSI31', 'weathered-rock': 'CROSS' },
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
      clay: 'fine-dot',
      silt: 'fine-dash',
      sand: 'granular-dot',
      gravel: 'coarse-grain',
      rock: 'inclined-bed',
      weatheredRock: 'broken-inclined-bed',
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
