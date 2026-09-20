// Generated from mechanical-flange-core.ts by scripts/build-typescript.mjs. Do not edit directly.
import { validateKnowledgePack } from '../knowledge-pack.js';
import { stableHash } from '../utils.js';
export const KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK = validateKnowledgePack({
    schema: 'kjdraw.knowledge-pack.v1',
    id: 'mechanical-flange-core',
    version: '2.11.0',
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
            contentHash: stableHash('flange-views:concentric-rings:polar-hole-arrays:legacy-square-hole-pitch:source-measured-relative-end-outlines:relative-cutting-plane-marks:arrowheads:side-axis:symmetric-meridian-profile:source-measured-side-outlines:source-relative-cut-face-boundary:parameterized-ansi31:caller-supplied-style-roles:caller-supplied-entity-style-overrides:caller-supplied-annotation-style-resources:semantic-auxiliary-lines:semantic-native-curves:generic-local-symbols:nested-local-symbols:attributed-local-symbols:complete-attribute-sequences:semantic-feature-control-frames:auxiliary-circles:native-leaders:native-derived-dimensions:entity-local-dimension-overrides:inset-frame:semantic-title-grid:bounded-grid-segments:source-sheet-notes:v2.11')
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
            'native-dimension',
            'native-leader',
            'feature-control-frame',
            'local-symbol',
            'attribute-definition',
            'attached-attribute',
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
        endView: 'concentric rings, bounded polar mounting-hole arrays with count, pitch radius, hole radius and start angle, a backward-compatible four-corner square array, and optional source-measured line, arc or circle outlines relative to the view center',
        sectionMarks: 'bounded source-positioned cutting-plane stems, ticks and optional native arrowheads relative to the end-view center',
        sideView: 'axis plus optional mirrored meridian profiles and source-measured line, arc or circle outlines relative to that axis; repeated stations encode shoulders',
        cutFaces: 'source-measured bounded line and arc paths relative to the side-view axis generate native non-associative ANSI31 hatch with parametric angle, spacing and origin; source DXF tags are never copied',
        styles: 'caller-supplied semantic roles map effective layer, color, lineweight and linetype facts; no source application catalogue is embedded',
        entityStyles: 'bounded caller-supplied style keys preserve visible layer, color, lineweight and linetype facts for individual native entities while keeping source application metadata out of the reusable rules',
        annotationStyles: 'bounded caller-supplied text and dimension style resources are atomically created and referenced by semantic keys; the reusable rules retain no private style names or values',
        auxiliaryLines: 'bounded source-measured line segments carry only a semantic role and are emitted as native LINE entities; arbitrary private object data is rejected',
        auxiliaryCurves: 'bounded source-measured arc, ellipse, lightweight-polyline and spline facts carry only geometry and a semantic style role; handles, raw tags and application metadata are rejected',
        auxiliarySolids: 'bounded source-measured three- or four-point native filled faces preserve editable arrowheads and markers; handles, raw tags and application metadata are rejected',
        symbols: 'bounded local geometry, multiline text, nested instances and attribute definitions compile into generic native block definitions; instance attribute values compile as complete editable ATTRIB and SEQEND ownership sequences while caller block names, handles and application metadata are never retained',
        featureControlFrames: 'geometric characteristic, tolerance-zone and datum semantics compile into editable native TOLERANCE entities; opaque source tags and application-specific object data are rejected',
        sheet: 'outer frame, optional positive-width inset frame and optional bounded semantic title-grid with full or locally segmented rules',
        notes: 'bounded source-supplied sheet labels and technical notes; visible content is never embedded in this pack',
        dimensions: 'native dimensions derive measurements from bounded definition points, preserve bounded entity-local text-height and arrow-size overrides, and never trust supplied measurement values',
        leaders: 'native source-measured leaders retain bounded vertices and drafting flags without private annotation handles',
        nativeEntities: [
            'CIRCLE',
            'LINE',
            'ARC',
            'HATCH',
            'INSERT',
            'ATTDEF',
            'ATTRIB'
        ]
    }
});
