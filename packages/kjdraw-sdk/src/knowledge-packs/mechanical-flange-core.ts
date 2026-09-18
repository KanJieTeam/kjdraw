import { validateKnowledgePack } from '../knowledge-pack.js'
import { stableHash } from '../utils.js'

/** Source-neutral rules for a parameterized orthographic flange-view core. */
export const KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK = validateKnowledgePack({
  schema: 'kjdraw.knowledge-pack.v1',
  id: 'mechanical-flange-core',
  version: '1.6.0',
  title: 'Parameterized flange orthographic-view and sheet-grid rules',
  domain: 'mechanical-manufacturing',
  license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
  sources: [{
    id: 'kjdraw-authored-flange-rules-v1',
    title: 'KJDraw authored flange geometry and layout rules',
    license: 'MIT',
    contentHash: stableHash('flange-views:concentric-rings:square-hole-pitch:source-measured-relative-end-outlines:relative-cutting-plane-marks:side-axis:symmetric-meridian-profile:native-derived-dimensions:inset-frame:semantic-title-grid:bounded-grid-segments:source-sheet-notes:v1.6'),
  }],
  ontology: {
    objectKinds: ['flange', 'bore', 'concentric-ring', 'square-hole-pattern', 'end-view-outline', 'cutting-plane-mark', 'side-view-axis', 'symmetric-meridian-profile', 'native-dimension', 'sheet-frame', 'title-grid', 'sheet-note'],
    relationKinds: ['concentric-with', 'projects-to', 'mirrors-across-axis', 'placed-on'],
  },
  rules: {
    endView: 'concentric rings, a four-corner square mounting-hole array and optional source-measured line or arc outlines relative to the view center',
    sectionMarks: 'bounded source-positioned cutting-plane stems and ticks relative to the end-view center',
    sideView: 'axis plus optional source-measured meridian profiles mirrored across that axis; repeated stations encode shoulders',
    sheet: 'outer frame, inset frame and optional bounded semantic title-grid with full or locally segmented rules',
    notes: 'bounded source-supplied sheet labels and technical notes; visible content is never embedded in this pack',
    dimensions: 'native dimensions derive measurements from bounded definition points and never trust supplied measurement values',
    nativeEntities: ['CIRCLE', 'LINE'],
  },
})
