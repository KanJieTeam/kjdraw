// Generated from geology-core.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJKnowledgePackRegistry, KJDRAW_KNOWLEDGE_PACK_SCHEMA, validateKnowledgePack } from '../knowledge-pack.js';
import { stableHash } from '../utils.js';
const provenance = {
    id: 'kjdraw-geology-semantics',
    title: 'KJDraw public geology semantic contract',
    license: 'Apache-2.0',
    scope: 'sanitized-domain-semantics-v1'
};
export const KJDRAW_GEOLOGY_KNOWLEDGE_PACK = validateKnowledgePack({
    schema: KJDRAW_KNOWLEDGE_PACK_SCHEMA,
    id: 'geology.core',
    version: '1.0.0',
    title: 'KJDraw geology columns and sections',
    domain: 'geology',
    license: {
        spdx: 'Apache-2.0',
        redistributable: true,
        trainingAllowed: true
    },
    sources: [
        {
            ...provenance,
            contentHash: stableHash(provenance)
        }
    ],
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
            'geology-annotation'
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
            'uses-hatch-pattern'
        ]
    },
    templates: {
        'borehole-column': {
            required: [
                'borehole.depth',
                'stratum.top',
                'stratum.bottom',
                'stratum.lithology'
            ],
            optional: [
                'borehole.collarElevation',
                'sample.interval',
                'groundwater.elevation',
                'elevation-marker.value'
            ],
            outputs: [
                'column',
                'depth-scale',
                'lithology-fill',
                'legend',
                'labels'
            ]
        },
        'geology-section': {
            required: [
                'section.profile',
                'borehole-sequence.items',
                'stratum.correlations'
            ],
            optional: [
                'section.horizontalScale',
                'section.verticalScale',
                'elevation-marker.value',
                'groundwater.elevation'
            ],
            outputs: [
                'section-boundary',
                'correlation-lines',
                'lithology-fill',
                'legend',
                'labels'
            ]
        },
        'lithology-legend': {
            required: [
                'lithology.code',
                'hatch-pattern.key'
            ],
            outputs: [
                'legend-swatch',
                'legend-label'
            ]
        }
    },
    rules: {
        'data-boundary': {
            missing: 'preserve-unknown-and-request-clarification',
            interpolation: 'forbidden-without-explicit-rule',
            interpretation: 'do-not-invent-strata-or-correlations'
        },
        'depth-and-elevation': {
            depthDirection: 'downward-positive-from-borehole-collar',
            interval: 'stratum-top-is-previous-bottom-and-final-bottom-must-equal-borehole-depth',
            elevation: 'use-supplied-datum-and-units',
            scale: 'horizontal-and-vertical-scales-are-independent-and-must-be-explicit'
        },
        'lithology-fill': {
            mapping: 'lithology-code-to-pattern-key',
            priority: 'explicit-pattern-key-before-lithology-class-default',
            fallback: 'boundary-only-with-visible-unknown-marker',
            customPatternData: 'must-be-supplied-by-a-separately-licensed-pack'
        },
        'lithology-pattern-roles': {
            fill: 'irregular-mixed-grain',
            clay: 'fine-dot',
            silt: 'fine-dash',
            sand: 'granular-dot',
            gravel: 'coarse-grain',
            rock: 'inclined-bed',
            weatheredRock: 'broken-inclined-bed',
            unknown: 'unfilled-with-unknown-marker'
        },
        'section-correlation': {
            boreholeOrder: 'use-declared-sequence-never-nearest-neighbour-order',
            relation: 'only-draw-declared-correlations',
            discontinuity: 'show-explicit-break-or-termination',
            overlap: 'reject-ambiguous-or-self-crossing-profile'
        }
    }
});
export function registerGeologyKnowledgePack(registry = new KJKnowledgePackRegistry()) {
    return registry.register(KJDRAW_GEOLOGY_KNOWLEDGE_PACK);
}
