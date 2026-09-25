// Original, fictional geological drawings. No customer drawing, survey, or third-party template is embedded.
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/index.js'
import { compileGeologyColumn, compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { buildAgentGeologyPlan } from '../packages/kjdraw-sdk/src/agent-geology-plan.js'

const HOLE_IDS = ['ZK01', 'ZK02', 'ZK03', 'ZK04', 'ZK05']
const COLLARS = [300, 300.35, 299.85, 300.25, 299.7]
const STRATUM_DEFINITIONS = [
  ['1', 'Topsoil', 'cultivated-soil'],
  ['2', 'Collapsible loess', 'loess-collapsible'],
  ['3', 'Loess', 'loess'],
  ['4', 'Paleosol', 'paleosol'],
  ['5', 'Loess-like soil', 'loess-like'],
  ['6', 'Silty clay', 'silty-clay'],
]
// Boundaries vary between boreholes; every row terminates at the same stated 30 m depth.
const DEPTH_BOUNDARIES = [
  [0, 0.8, 4.0, 10.8, 14.4, 22.0, 30],
  [0, 0.7, 3.7, 10.2, 15.0, 22.7, 30],
  [0, 0.9, 4.4, 11.5, 14.8, 22.2, 30],
  [0, 0.8, 4.1, 10.9, 15.5, 23.0, 30],
  [0, 1.0, 4.6, 11.2, 16.1, 23.6, 30],
]

export const GEOLOGY_SAMPLE_FACTS = Object.freeze({
  boreholeIds: Object.freeze([...HOLE_IDS]),
  collarElevations: Object.freeze([...COLLARS]),
  depthBoundaries: Object.freeze(DEPTH_BOUNDARIES.map(row => Object.freeze([...row]))),
  stableWaterDepth: 18.4,
  depthMeters: 30,
  horizontalScaleDenominator: 500,
  sectionVerticalScaleDenominator: 200,
  sourceKind: 'original-synthetic',
})

function strataFor(index) {
  const id = HOLE_IDS[index]
  const bounds = DEPTH_BOUNDARIES[index]
  return STRATUM_DEFINITIONS.map(([code, name, lithology], i) => ({
    intervalId: `${id}-L${i + 1}`, code, name, lithology,
    top: bounds[i], bottom: bounds[i + 1],
  }))
}

function borehole(index) {
  return {
    id: HOLE_IDS[index], station: index * 25, collarElevation: COLLARS[index], depth: 30,
    strata: strataFor(index),
    ...(index === 2 ? { stableWaterDepth: GEOLOGY_SAMPLE_FACTS.stableWaterDepth } : {}),
  }
}

function hatchBounds(entity) {
  const points = entity.payload.boundaryLoops?.flatMap(loop => loop.vertices?.map(vertex => vertex.point) ?? []) ?? []
  if (!points.length) throw new Error('Borehole log has an empty hatch boundary')
  return {
    minX: Math.min(...points.map(point => point[0])), maxX: Math.max(...points.map(point => point[0])),
    minY: Math.min(...points.map(point => point[1])), maxY: Math.max(...points.map(point => point[1])),
  }
}

async function annotateStableWater(document, hole) {
  // Derive the marker from compiled body hatches, not an unrelated illustration scale.
  const bodyCells = document.listEntities({ type: 'HATCH' }).map(hatchBounds)
    .filter(bounds => bounds.maxX - bounds.minX >= 20 && bounds.maxY - bounds.minY >= 4)
  if (bodyCells.length !== hole.strata.length) throw new Error('Borehole body cells do not match its strata')
  const topY = Math.max(...bodyCells.map(cell => cell.maxY))
  const bottomY = Math.min(...bodyCells.map(cell => cell.minY))
  const millimetresPerMetre = (topY - bottomY) / hole.depth
  const waterY = topY - hole.stableWaterDepth * millimetresPerMetre
  const leftX = Math.min(...bodyCells.map(cell => cell.minX))
  const rightX = Math.max(...bodyCells.map(cell => cell.maxX))
  if (!(waterY > bottomY && waterY < topY)) throw new Error('Stable water marker falls outside the column')
  await document.transact('Locate synthetic stable water level at stated depth', tx => {
    const linetypeId = tx.upsertTableRecord('linetypes', {
      name: 'GEO_WATER_CONTINUOUS', type: 'LINETYPE', payload: { patternSegments: [] },
    }).id
    const layerId = tx.upsertTableRecord('layers', {
      name: 'GEO_WATER', type: 'LAYER',
      payload: { color: 4, trueColor: 0x54dce6, linetypeId, visible: true, plottable: true },
    }).id
    const line = (start, end, id) => tx.createEntity('LINE', { start: [...start, 0], end: [...end, 0], layerId }, { id })
    line([leftX, waterY], [rightX, waterY], 'geology-log-stable-water-rule')
    line([leftX - 3, waterY + 2], [leftX, waterY], 'geology-log-stable-water-marker-left')
    line([leftX + 3, waterY + 2], [leftX, waterY], 'geology-log-stable-water-marker-right')
    tx.createEntity('TEXT', {
      position: [132, waterY, 0],
      text: 'SWL ' + hole.stableWaterDepth.toFixed(2) + ' m / EL ' + (hole.collarElevation - hole.stableWaterDepth).toFixed(2) + ' m',
      height: 1.7, layerId,
    }, { id: 'geology-log-stable-water-label' })
  })
  return { waterY, topY, bottomY, millimetresPerMetre }
}
async function createDocument(id, title, units = 'millimeter') {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({
    documentId: `public-curated-${id}`, title, units,
    tags: ['example', 'geology'],
    metadata: { synthetic: true, measuredData: false, sourceKind: 'original-synthetic' },
  })
  return { sdk, document }
}

async function setPaper(sdk, document, paperWidth, paperHeight) {
  const layoutId = document.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PAGESETUP', { layoutId, dxf: {
    paperWidth, paperHeight, paperUnits: 1, plotType: 4,
    windowMinX: 0, windowMinY: 0, windowMaxX: paperWidth, windowMaxY: paperHeight,
    flags: 0, scaleNumerator: 1, scaleDenominator: 1,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
  } }, { document })
}
async function finish(id, title, sdk, document, facts, layoutName) {
  const layoutId = layoutName
    ? document.snapshot().spaces.layoutIds.find(candidate => document.getObject(candidate)?.name === layoutName)
    : document.snapshot().spaces.layoutIds[0]
  if (!layoutId) throw new Error(`${id}: compiled drawing has no layout`)
  return { id, title, category: 'geology', sdk, document, layoutId,
    facts: { ...facts, illustrative: true, measuredData: false } }
}

export async function boreholeLogSheet() {
  const id = 'borehole-log-sheet', title = 'Borehole log'
  const { sdk, document } = await createDocument(id, title)
  const hole = borehole(2)
  const compiled = compileGeologyColumn({
    locale: 'en', hole, expectedRevision: document.revision,
    title: 'BOREHOLE LOG / SYNTHETIC, NOT MEASURED',
  })
  await sdk.executeCommand('CREATEBATCH', structuredClone(compiled.commandArgs), { document })
  const waterGeometry = await annotateStableWater(document, hole)
  await setPaper(sdk, document, 210, 297)
  return finish(id, title, sdk, document, {
    boreholeIds: [hole.id], depthMeters: hole.depth, stableWaterDepth: hole.stableWaterDepth,
    collarElevation: hole.collarElevation, stratumCount: hole.strata.length,
    verticalScaleDenominator: compiled.parameters?.verticalScaleDenominator,
    hatchCount: document.listEntities({ type: 'HATCH' }).length,
    ...waterGeometry,
  })
}

export async function geologicalSectionSheet() {
  const id = 'geological-section-sheet', title = 'Geological section'
  const { sdk, document } = await createDocument(id, title)
  const holes = HOLE_IDS.map((_, i) => borehole(i))
  const correlations = []
  for (let i = 0; i < holes.length - 1; i++) for (let j = 0; j < STRATUM_DEFINITIONS.length; j++) {
    correlations.push({
      fromHoleId: holes[i].id, toHoleId: holes[i + 1].id,
      fromIntervalId: `${holes[i].id}-L${j + 1}`,
      toIntervalId: `${holes[i + 1].id}-L${j + 1}`,
    })
  }
  const compiled = compileGeologySection({
    locale: 'en', holes, correlations, sourceFactMode: 'illustrative',
    horizontalScaleDenominator: GEOLOGY_SAMPLE_FACTS.horizontalScaleDenominator,
    verticalScaleDenominator: GEOLOGY_SAMPLE_FACTS.sectionVerticalScaleDenominator,
    datumElevation: 265, surfaceRule: 'straight-between-supplied-collars',
    expectedRevision: document.revision,
    title: 'GEOLOGICAL SECTION A-A / SYNTHETIC, NOT MEASURED',
  })
  await sdk.executeCommand('CREATEBATCH', structuredClone(compiled.commandArgs), { document })
  await setPaper(sdk, document, 420, 297)
  return finish(id, title, sdk, document, {
    boreholeIds: [...HOLE_IDS], depthMeters: 30, horizontalScaleDenominator: 500,
    verticalScaleDenominator: 200, hatchCount: document.listEntities({ type: 'HATCH' }).length,
    correlationCount: correlations.length,
  })
}

export async function investigationPointPlanSheet() {
  const id = 'investigation-point-plan', title = 'Investigation-point plan'
  const { sdk, document } = await createDocument(id, title, 'meter')
  const input = {
    version: '1.0.0', expectedRevision: document.revision, units: 'meter', locale: 'en',
    drawingId: 'GEO-PLAN-01',
    title: 'INVESTIGATION-POINT PLAN / SYNTHETIC, NOT MEASURED',
    scale: 500,
    boundary: [[970, 972], [1116, 970], [1130, 1005], [1114, 1047], [977, 1048], [962, 1012]],
    boreholes: HOLE_IDS.map((holeId, i) => ({
      id: holeId, position: [1000 + i * 25, 1000], collarElevation: COLLARS[i], depth: 30, kind: 'borehole',
    })),
    sectionLines: [{ id: 'SECTION-A', holeIds: [...HOLE_IDS], label: 'A-A\u2032', endpointLabels: ['A', 'A\u2032'] }],
    coordinateGrid: { origin: [960, 960], spacing: 20 }, northAngleDegrees: 0,
    buildingFootprints: [
      { id: 'NORTH-BLOCK-1', outline: [[990, 1020], [1030, 1020], [1030, 1039], [990, 1039]] },
      { id: 'NORTH-BLOCK-2', outline: [[1052, 1020], [1097, 1020], [1097, 1038], [1052, 1038]] },
    ],
    roadPaths: [
      { id: 'SOUTH-ACCESS-EDGE', start: [981, 985], segments: [
        { kind: 'line', end: [1030, 985] },
        { kind: 'line', end: [1080, 984] },
        { kind: 'line', end: [1110, 986] },
      ] },
      { id: 'NORTH-ACCESS-EDGE', start: [981, 991], segments: [
        { kind: 'line', end: [1030, 991] },
        { kind: 'line', end: [1080, 990] },
        { kind: 'line', end: [1110, 992] },
      ] },
    ],
  }
  const compiled = buildAgentGeologyPlan(document, input)
  await sdk.executeCommand('CREATEBATCH', structuredClone(compiled.commandArgs), { document })
  const paperSpaceId = compiled.commandArgs.layout.blockRecordId
  await document.transact('Complete the editable A3 paper frame', tx => {
    const linetypeId = tx.upsertTableRecord('linetypes', {
      name: 'GEO_FRAME_CONTINUOUS', type: 'LINETYPE', payload: { patternSegments: [] },
    }).id
    const layerId = tx.upsertTableRecord('layers', {
      name: 'GEO_SHEET_FRAME', type: 'LAYER',
      payload: { color: 7, trueColor: 0xc7d5d9, linetypeId, visible: true, plottable: true },
    }).id
    tx.createEntity('LWPOLYLINE', {
      vertices: [[15, 30, 0], [390, 30, 0], [390, 260, 0], [15, 260, 0]],
      closed: true, layerId,
    }, { id: 'geology-plan-paper-frame', ownerId: paperSpaceId })
  })
  await setPaper(sdk, document, 420, 297)
  return finish(id, title, sdk, document, {
    boreholeIds: [...HOLE_IDS], depthMeters: 30, scaleDenominator: 500,
    buildingFootprintCount: input.buildingFootprints.length,
    roadPathCount: input.roadPaths.length, coordinateGridSpacingMeters: 20,
  }, compiled.commandArgs.layout.name)
}

export async function buildCuratedGeologySheetDocuments() {
  return Promise.all([boreholeLogSheet(), geologicalSectionSheet(), investigationPointPlanSheet()])
}
