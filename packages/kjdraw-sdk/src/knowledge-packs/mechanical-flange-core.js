// Generated from mechanical-flange-core.ts by scripts/build-typescript.mjs. Do not edit directly.
import { validateKnowledgePack } from '../knowledge-pack.js';
import { stableHash } from '../utils.js';
export const KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK = validateKnowledgePack({
    schema: 'kjdraw.knowledge-pack.v1',
    id: 'mechanical-flange-core',
    version: '2.1.0',
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
            contentHash: stableHash('flange-views:concentric-rings:square-hole-pitch:source-measured-relative-end-outlines:relative-cutting-plane-marks:arrowheads:side-axis:symmetric-meridian-profile:source-measured-side-outlines:source-relative-cut-face-boundary:parameterized-ansi31:auxiliary-circles:native-leaders:native-derived-dimensions:inset-frame:semantic-title-grid:bounded-grid-segments:source-sheet-notes:v2.1')
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
            'cut-face',
            'native-dimension',
            'native-leader',
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
        endView: 'concentric rings, a four-corner square mounting-hole array and optional source-measured line, arc or circle outlines relative to the view center',
        sectionMarks: 'bounded source-positioned cutting-plane stems, ticks and optional native arrowheads relative to the end-view center',
        sideView: 'axis plus optional mirrored meridian profiles and source-measured line, arc or circle outlines relative to that axis; repeated stations encode shoulders',
        cutFaces: 'source-measured bounded line and arc paths relative to the side-view axis generate native non-associative ANSI31 hatch with parametric angle, spacing and origin; source DXF tags are never copied',
        sheet: 'outer frame, inset frame and optional bounded semantic title-grid with full or locally segmented rules',
        notes: 'bounded source-supplied sheet labels and technical notes; visible content is never embedded in this pack',
        dimensions: 'native dimensions derive measurements from bounded definition points and never trust supplied measurement values',
        leaders: 'native source-measured leaders retain bounded vertices and drafting flags without private annotation handles',
        nativeEntities: [
            'CIRCLE',
            'LINE',
            'ARC',
            'HATCH'
        ]
    }
});
