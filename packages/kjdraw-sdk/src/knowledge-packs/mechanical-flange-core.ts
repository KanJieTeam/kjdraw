import { validateKnowledgePack } from '../knowledge-pack.js'
import { stableHash } from '../utils.js'

/** Source-neutral rules for a parameterized orthographic flange-view core. */
export const KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK = validateKnowledgePack({
  schema: 'kjdraw.knowledge-pack.v1',
  id: 'mechanical-flange-core',
  version: '1.1.0',
  title: 'Parameterized flange orthographic-view and sheet-grid rules',
  domain: 'mechanical-manufacturing',
  license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
  sources: [{
    id: 'kjdraw-authored-flange-rules-v1',
    title: 'KJDraw authored flange geometry and layout rules',
    license: 'MIT',
    contentHash: stableHash('flange-views:concentric-rings:square-hole-pitch:side-axis:symmetric-meridian-profile:inset-frame:semantic-title-grid:v1.1'),
  }],
  ontology: {
    objectKinds: ['flange', 'bore', 'concentric-ring', 'square-hole-pattern', 'side-view-axis', 'symmetric-meridian-profile', 'sheet-frame', 'title-grid'],
    relationKinds: ['concentric-with', 'projects-to', 'mirrors-across-axis', 'placed-on'],
  },
  rules: {
    endView: 'concentric rings plus a four-corner square mounting-hole array',
    sideView: 'axis plus optional source-measured meridian profiles mirrored across that axis; repeated stations encode shoulders',
    sheet: 'outer frame, inset frame and optional bounded semantic title-grid',
    nativeEntities: ['CIRCLE', 'LINE'],
  },
})
