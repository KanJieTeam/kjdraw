// Generated from mechanical-flange-core.ts by scripts/build-typescript.mjs. Do not edit directly.
import { validateKnowledgePack } from '../knowledge-pack.js';
import { stableHash } from '../utils.js';
export const KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK = validateKnowledgePack({
    schema: 'kjdraw.knowledge-pack.v1',
    id: 'mechanical-flange-core',
    version: '2.19.0',
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
            contentHash: stableHash('flange-views:concentric-rings:polar-hole-arrays:legacy-square-hole-pitch:source-measured-relative-end-outlines:relative-cutting-plane-marks:arrowheads:side-axis:symmetric-meridian-profile:source-measured-side-outlines:source-relative-cut-face-boundary:multi-boundary-loop-hatch:spline-hatch-edges:parameterized-ansi31:caller-supplied-style-roles:caller-supplied-entity-style-overrides:caller-supplied-annotation-style-resources:semantic-auxiliary-lines:semantic-auxiliary-points:standard-point-display:symbol-text-hatch-solid:empty-symbol-blocks:semantic-native-curves:generic-local-symbols:nested-local-symbols:attributed-local-symbols:complete-attribute-sequences:semantic-feature-control-frames:auxiliary-circles:native-leaders:native-derived-dimensions:entity-local-dimension-overrides:inset-frame:semantic-title-grid:bounded-grid-segments:source-sheet-notes:per-side-frame-styles:bounded-64-style-catalogs:native-structured-wipeout:bounded-1024-auxiliary-lines:bounded-512-auxiliary-curves:bounded-symbol-catalogs:native-ordinate-dimensions:v2.19')
        }
    ],
    ontology: {
        objectKinds: [
            'flange',
            'bore',
            'concentric-ring',
            'polar-hole-pattern',
            'square-hole-pattern',
            'end-view-outline',
            'cutting-plane-mark',
            'side-view-axis',
            'symmetric-meridian-profile',
            'side-view-outline',
            'cut-face',
            'hatch-boundary-loop',
            'hatch-spline-edge',
            'native-dimension',
            'native-leader',
            'feature-control-frame',
            'local-symbol',
            'attribute-definition',
            'attached-attribute',
            'sheet-frame',
            'native-point',
            'title-grid',
            'sheet-note',
            'masking-area'
        ],
        relationKinds: [
            'concentric-with',
            'projects-to',
            'mirrors-across-axis',
            'placed-on'
        ]
    },
    rules: {
        endView: 'concentric rings, bounded polar mounting-hole arrays with count, pitch radius, hole radius and start angle, a backward-compatible four-corner square array, and optional source-measured line, arc or circle outlines relative to the view center',
        sectionMarks: 'bounded source-positioned cutting-plane stems, ticks and optional native arrowheads relative to the end-view center',
        sideView: 'axis plus optional mirrored meridian profiles and source-measured line, arc or circle outlines relative to that axis; repeated stations encode shoulders',
        cutFaces: 'one or more source-measured boundary loops with line, arc or spline edges generate native non-associative solid or patterned hatches in side-relative or absolute coordinates; source DXF tags are never copied',
        styles: 'up to 64 caller-supplied semantic styles map effective layer, color, lineweight and linetype facts; no source application catalogue is embedded',
        entityStyles: 'bounded caller-supplied style keys preserve visible layer, color, lineweight and linetype facts for individual native entities while keeping source application metadata out of the reusable rules',
        annotationStyles: 'up to 64 caller-supplied text styles and 64 dimension styles are atomically created and referenced by semantic keys; the reusable rules retain no private style names or values',
        auxiliaryLines: 'up to 1024 source-measured line segments carry only a semantic role and are emitted as native LINE entities; the full request and atomic entity batch remain independently bounded, and arbitrary private object data is rejected',
        auxiliaryPoints: 'bounded source-measured locations carry only a semantic role and are emitted as native POINT entities under a strictly validated drawing-level PDMODE and PDSIZE',
        auxiliaryCurves: 'up to 512 source-measured arc, ellipse, lightweight-polyline and spline facts carry only geometry and a semantic style role; the full request and atomic entity batch remain independently bounded, and handles, raw tags and application metadata are rejected',
        auxiliarySolids: 'bounded source-measured three- or four-point native filled faces preserve editable arrowheads and markers; handles, raw tags and application metadata are rejected',
        auxiliaryWipeouts: 'bounded native masking areas preserve an explicit image plane and local rectangular or polygon clipping; raw tags, source handles and object identifiers are rejected',
        symbols: 'up to 128 generic definitions, 512 members per definition, 2048 total members and 256 placed instances compile bounded local geometry, text, hatches, filled faces, nested instances and attributes into native blocks; zero-member definitions remain valid, while caller names, handles and application metadata are never retained',
        featureControlFrames: 'geometric characteristic, tolerance-zone and datum semantics compile into editable native TOLERANCE entities; opaque source tags and application-specific object data are rejected',
        sheet: 'outer frame and optional positive-width inset frame accept per-side style keys with a backward-compatible single-style fallback, plus an optional bounded semantic title-grid with full or locally segmented rules',
        notes: 'bounded source-supplied sheet labels and technical notes; visible content is never embedded in this pack',
        dimensions: 'aligned, rotated, radius, diameter, angular and x- or y-axis ordinate dimensions derive measurements from bounded definition points, preserve rotation and bounded entity-local overrides, and never trust supplied measurement values',
        leaders: 'native source-measured leaders retain bounded vertices and drafting flags without private annotation handles',
        nativeEntities: [
            'POINT',
            'CIRCLE',
            'LINE',
            'ARC',
            'TEXT',
            'SOLID',
            'HATCH',
            'INSERT',
            'ATTDEF',
            'ATTRIB',
            'WIPEOUT'
        ]
    }
});
