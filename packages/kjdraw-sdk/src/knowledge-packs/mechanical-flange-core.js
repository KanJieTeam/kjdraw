// Generated from mechanical-flange-core.ts by scripts/build-typescript.mjs. Do not edit directly.
import { validateKnowledgePack } from '../knowledge-pack.js';
import { stableHash } from '../utils.js';
export const KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK = validateKnowledgePack({
    schema: 'kjdraw.knowledge-pack.v1',
    id: 'mechanical-flange-core',
    version: '1.0.0',
    title: 'Parameterized flange end view and sheet-grid rules',
    domain: 'mechanical-manufacturing',
    license: {
        spdx: 'MIT',
        redistributable: true,
        trainingAllowed: true
    },
    sources: [
        {
            id: 'kjdraw-authored-flange-rules-v1',
            title: 'KJDraw authored flange geometry and layout rules',
            license: 'MIT',
            contentHash: stableHash('flange-end-view:concentric-rings:square-hole-pitch:side-axis:inset-frame:semantic-title-grid:v1')
        }
    ],
    ontology: {
        objectKinds: [
            'flange',
            'bore',
            'concentric-ring',
            'square-hole-pattern',
            'side-view-axis',
            'sheet-frame',
            'title-grid'
        ],
        relationKinds: [
            'concentric-with',
            'projects-to',
            'placed-on'
        ]
    },
    rules: {
        endView: 'concentric rings plus a four-corner square mounting-hole array',
        sideView: 'axis placement only; stepped thickness and contour require a separately proven topology',
        sheet: 'outer frame, inset frame and optional bounded semantic title-grid',
        nativeEntities: [
            'CIRCLE',
            'LINE'
        ]
    }
});
