// Generated from mechanical-flange-core.ts by scripts/build-typescript.mjs. Do not edit directly.
import { validateKnowledgePack } from '../knowledge-pack.js';
import { stableHash } from '../utils.js';
export const KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK = validateKnowledgePack({
    schema: 'kjdraw.knowledge-pack.v1',
    id: 'mechanical-flange-core',
    version: '1.7.0',
    title: 'Parameterized flange orthographic-view and sheet-grid rules',
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
            contentHash: stableHash('flange-views:concentric-rings:square-hole-pitch:source-measured-relative-end-outlines:relative-cutting-plane-marks:side-axis:symmetric-meridian-profile:source-measured-side-outlines:native-derived-dimensions:inset-frame:semantic-title-grid:bounded-grid-segments:source-sheet-notes:v1.7')
        }
    ],
    ontology: {
        objectKinds: [
            'flange',
            'bore',
            'concentric-ring',
            'square-hole-pattern',
            'end-view-outline',
            'cutting-plane-mark',
            'side-view-axis',
            'symmetric-meridian-profile',
            'side-view-outline',
            'native-dimension',
            'sheet-frame',
            'title-grid',
            'sheet-note'
        ],
        relationKinds: [
            'concentric-with',
            'projects-to',
            'mirrors-across-axis',
            'placed-on'
        ]
    },
    rules: {
        endView: 'concentric rings, a four-corner square mounting-hole array and optional source-measured line or arc outlines relative to the view center',
        sectionMarks: 'bounded source-positioned cutting-plane stems and ticks relative to the end-view center',
        sideView: 'axis plus optional mirrored meridian profiles and source-measured line or arc outlines relative to that axis; repeated stations encode shoulders',
        sheet: 'outer frame, inset frame and optional bounded semantic title-grid with full or locally segmented rules',
        notes: 'bounded source-supplied sheet labels and technical notes; visible content is never embedded in this pack',
        dimensions: 'native dimensions derive measurements from bounded definition points and never trust supplied measurement values',
        nativeEntities: [
            'CIRCLE',
            'LINE'
        ]
    }
});
