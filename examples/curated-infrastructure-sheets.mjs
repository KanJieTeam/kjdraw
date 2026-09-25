import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/index.js'

const point = (x, y) => [x, y, 0]

function drawing(tx, key, title, strapline) {
  const layers = {}
  const linetypeId = tx.upsertTableRecord('linetypes', {
    name: `${key}-SOLID`, type: 'LINETYPE', payload: { patternSegments: [] },
  }).id
  for (const [name, color] of [['FRAME', 8], ['STRUCTURE', 9], ['CONTEXT', 3], ['ANNO', 9], ['MATERIAL', 9]]) {
    layers[name] = tx.upsertTableRecord('layers', {
      name: `${key}-${name}`, type: 'LAYER',
      payload: { color, linetypeId, visible: true, frozen: false, locked: false, plottable: true },
    }).id
  }
  const add = (type, payload, id, layer = 'STRUCTURE') => tx.createEntity(type, { ...payload, layerId: layers[layer] }, { id: `${key}-${id}` })
  const line = (x1, y1, x2, y2, id, layer) => add('LINE', { start: point(x1, y1), end: point(x2, y2) }, id, layer)
  const rect = (x1, y1, x2, y2, id, layer) => add('LWPOLYLINE', {
    vertices: [point(x1, y1), point(x2, y1), point(x2, y2), point(x1, y2)], closed: true,
  }, id, layer)
  const poly = (vertices, id, layer) => add('LWPOLYLINE', { vertices: vertices.map(([x, y]) => point(x, y)), closed: true }, id, layer)
  const circle = (x, y, r, id, layer) => add('CIRCLE', { center: point(x, y), radius: r }, id, layer)
  const text = (x, y, value, height, id, layer = 'ANNO') => add('TEXT', { position: point(x, y), text: value, height }, id, layer)
  const hatch = (vertices, id, patternName = 'ANSI31', patternScale = 3) => add('HATCH', {
    boundaryLoops: [{ vertices: vertices.map(([x, y]) => point(x, y)) }], patternName, patternScale,
  }, id, 'MATERIAL')
  rect(0, 0, 277, 190, 'paper', 'FRAME')
  rect(5, 5, 272, 185, 'margin', 'FRAME')
  line(5, 25, 272, 25, 'footer-line', 'FRAME')
  line(181, 5, 181, 25, 'footer-break-a', 'FRAME')
  line(241, 5, 241, 25, 'footer-break-b', 'FRAME')
  text(10, 15, title, 5.3, 'drawing-title')
  text(10, 8, strapline, 2.5, 'strapline')
  text(185, 16, 'KJDRAW / INFRASTRUCTURE', 2.5, 'publisher')
  text(185, 9, 'Editable vector example', 2.4, 'editable')
  text(245, 16, 'A4 / NTS', 2.6, 'sheet-size')
  text(245, 9, 'REV A', 2.5, 'revision')
  return { add, line, rect, poly, circle, text, hatch }
}

async function complete(sdk, document, id, title, facts) {
  const layoutId = document.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PLOTSETUP', { layoutId, dxf: {
    paperWidth: 297, paperHeight: 210, paperUnits: 1, plotType: 4, flags: 0,
    windowMinX: -10, windowMinY: -10, windowMaxX: 287, windowMaxY: 200,
    scaleNumerator: 1, scaleDenominator: 1,
  } }, { document })
  return { id, title, category: 'civil', sdk, document, layoutId, facts: { ...facts, illustrative: true } }
}

export async function inspectionChamberDetail() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'curated-inspection-chamber', title: 'Inspection chamber plan and section', units: 'millimeter' })
  await document.transact('Draw inspection chamber plan and section', tx => {
    const d = drawing(tx, 'CHAMBER', 'INSPECTION CHAMBER', 'Plan / section / pipe connections')
    d.text(18, 169, '01  PLAN', 4, 'plan-heading')
    d.circle(75, 108, 42, 'outer-ring')
    d.circle(75, 108, 36, 'inner-ring')
    d.circle(75, 108, 17, 'access-opening', 'CONTEXT')
    d.line(21, 108, 33, 108, 'inlet')
    d.line(33, 100, 40, 100, 'inlet-lower')
    d.line(33, 116, 40, 116, 'inlet-upper')
    d.line(117, 108, 132, 108, 'outlet')
    d.line(111, 100, 132, 100, 'outlet-lower')
    d.line(111, 116, 132, 116, 'outlet-upper')
    d.line(75, 58, 75, 157, 'plan-axis-v', 'CONTEXT')
    d.line(17, 108, 134, 108, 'plan-axis-h', 'CONTEXT')
    for (const [x, y, label] of [[35, 91, 'INLET'], [107, 91, 'OUTLET'], [54, 137, 'ACCESS']]) d.text(x, y, label, 2.8, `plan-label-${label}`)
    d.text(154, 169, '02  SECTION A-A', 4, 'section-heading')
    d.line(151, 141, 253, 141, 'surface', 'CONTEXT')
    d.rect(162, 137, 239, 143, 'cover')
    d.rect(170, 61, 232, 137, 'wall-outer')
    d.rect(179, 70, 223, 132, 'wall-inner')
    d.rect(166, 55, 236, 63, 'base')
    d.hatch([[167,56],[235,56],[235,62],[167,62]], 'base-hatch')
    d.hatch([[171,64],[178,64],[178,130],[171,130]], 'wall-hatch-left')
    d.hatch([[224,64],[231,64],[231,130],[224,130]], 'wall-hatch-right')
    d.line(151, 88, 179, 88, 'pipe-left-top')
    d.line(151, 78, 179, 78, 'pipe-left-bottom')
    d.line(223, 83, 251, 83, 'pipe-right-top')
    d.line(223, 73, 251, 73, 'pipe-right-bottom')
    d.poly([[179,70],[194,64],[207,64],[223,70]], 'channel')
    for (let i = 0; i < 4; i++) d.line(173, 78 + i * 11, 181, 78 + i * 11, `step-${i}`, 'CONTEXT')
    d.line(235, 121, 253, 127, 'cover-leader', 'ANNO')
    d.text(239, 130, 'COVER', 2.7, 'cover-label')
    d.line(226, 58, 253, 48, 'base-leader', 'ANNO')
    d.text(225, 43, 'BASE SLAB', 2.7, 'base-label')
    d.text(18, 38, 'Concept detail only. Set sizes, levels and materials from project design.', 2.6, 'caution')
  })
  return complete(sdk, document, 'inspection-chamber', 'Inspection chamber plan and section', { views: 2, pipeConnections: 2 })
}

export async function roadCrossSection() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'curated-road-cross-section', title: 'Road cross-section', units: 'millimeter' })
  await document.transact('Draw road cross-section and pavement build-up', tx => {
    const d = drawing(tx, 'ROADSEC', 'ROAD CROSS-SECTION', 'Carriageway / verge / pavement layers')
    d.text(18, 170, 'TYPICAL SECTION  /  DIAGRAMMATIC', 4, 'view-heading')
    d.poly([[24,122],[45,122],[62,116],[138,113],[213,116],[232,122],[253,122],[253,117],[232,117],[213,111],[138,108],[62,111],[45,117],[24,117]], 'surface-band')
    d.poly([[45,117],[62,111],[138,108],[213,111],[232,117],[232,107],[213,101],[138,98],[62,101],[45,107]], 'wearing-layer')
    d.poly([[45,107],[62,101],[138,98],[213,101],[232,107],[232,94],[213,88],[138,85],[62,88],[45,94]], 'base-layer')
    d.poly([[45,94],[62,88],[138,85],[213,88],[232,94],[232,80],[213,74],[138,71],[62,74],[45,80]], 'subbase')
    d.hatch([[46,95],[62,89],[138,86],[213,89],[231,95],[231,105],[213,100],[138,97],[62,100],[46,105]], 'base-hatch', 'ANSI31', 4)
    d.hatch([[46,81],[62,75],[138,72],[213,75],[231,81],[231,92],[213,87],[138,84],[62,87],[46,92]], 'subbase-hatch', 'CROSS', 4)
    d.line(24, 80, 45, 80, 'left-ground', 'CONTEXT')
    d.line(232, 80, 253, 80, 'right-ground', 'CONTEXT')
    d.rect(38, 112, 44, 119, 'edge-drain-left', 'CONTEXT')
    d.rect(233, 112, 239, 119, 'edge-drain-right', 'CONTEXT')
    d.line(24, 117, 24, 125, 'verge-limit-left', 'CONTEXT')
    d.line(253, 117, 253, 125, 'verge-limit-right', 'CONTEXT')
    d.line(63, 113, 80, 113, 'edge-line-left', 'CONTEXT')
    d.line(196, 113, 212, 113, 'edge-line-right', 'CONTEXT')
    d.line(100, 111, 109, 111, 'lane-mark-a', 'CONTEXT')
    d.line(168, 111, 177, 111, 'lane-mark-b', 'CONTEXT')
    d.line(34, 124, 34, 132, 'verge-dim-left', 'ANNO')
    d.line(243, 124, 243, 132, 'verge-dim-right', 'ANNO')
    d.line(138, 65, 138, 151, 'road-centerline', 'CONTEXT')
    for (const [x, id] of [[62, 'edge-left'], [213, 'edge-right']]) {
      d.line(x, 121, x, 131, id, 'ANNO')
      d.line(x - 2, 124, x + 2, 124, `${id}-tick`, 'ANNO')
    }
    d.line(62, 135, 213, 135, 'carriage-width', 'ANNO')
    d.text(114, 138, 'CARRIAGEWAY', 3, 'carriageway-label')
    d.line(138, 108, 151, 116, 'fall-a', 'ANNO')
    d.line(138, 108, 125, 116, 'fall-b', 'ANNO')
    d.text(128, 120, 'CROWN', 2.6, 'crown-label')
    d.line(67, 102, 36, 58, 'wear-leader', 'ANNO')
    d.text(18, 53, 'SURFACE COURSE', 2.7, 'wear-label')
    d.line(185, 94, 211, 56, 'base-leader', 'ANNO')
    d.text(211, 51, 'BASE + SUBBASE', 2.7, 'base-label')
    d.rect(18, 35, 255, 45, 'note-box', 'FRAME')
    d.text(23, 38, 'Layer geometry is illustrative; no design thickness or crossfall implied.', 2.6, 'qualification')
  })
  return complete(sdk, document, 'road-cross-section', 'Road cross-section', { pavementLayers: 3, crown: true })
}

export async function boxCulvertSection() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'curated-box-culvert', title: 'Twin-cell box culvert', units: 'millimeter' })
  await document.transact('Draw twin-cell culvert section', tx => {
    const d = drawing(tx, 'CULVERT', 'TWIN-CELL BOX CULVERT', 'Waterway openings / wing walls / base slab')
    d.text(18, 169, 'FRONT ELEVATION  /  NTS', 4, 'view-heading')
    d.line(17, 150, 260, 150, 'ground', 'CONTEXT')
    d.rect(47, 66, 230, 128, 'outer-shell')
    d.rect(55, 73, 133, 120, 'opening-left')
    d.rect(144, 73, 222, 120, 'opening-right')
    d.rect(40, 61, 237, 68, 'base-slab')
    d.rect(41, 128, 236, 134, 'top-slab')
    d.hatch([[48,121],[54,121],[54,127],[48,127]], 'haunch-lu')
    d.hatch([[134,121],[143,121],[143,127],[134,127]], 'haunch-center')
    d.hatch([[223,121],[229,121],[229,127],[223,127]], 'haunch-ru')
    for (let x = 55; x < 221; x += 21) d.line(x, 62, x + 4, 67, `slab-tick-${x}`, 'MATERIAL')
    d.poly([[47,66],[21,73],[21,95],[47,82]], 'wing-left')
    d.poly([[230,66],[256,73],[256,95],[230,82]], 'wing-right')
    d.line(17, 75, 55, 75, 'water-left', 'CONTEXT')
    d.line(55, 75, 133, 75, 'water-cell-1', 'CONTEXT')
    d.line(144, 75, 222, 75, 'water-cell-2', 'CONTEXT')
    d.line(222, 75, 260, 75, 'water-right', 'CONTEXT')
    for (const [x, id] of [[91, 'cell-a'], [182, 'cell-b']]) {
      d.line(x - 5, 91, x + 5, 91, `${id}-flow`, 'CONTEXT')
      d.line(x + 5, 91, x + 1, 94, `${id}-arrow-a`, 'CONTEXT')
      d.line(x + 5, 91, x + 1, 88, `${id}-arrow-b`, 'CONTEXT')
    }
    d.line(47, 48, 230, 48, 'overall-dim', 'ANNO')
    d.line(47, 44, 47, 53, 'overall-dim-l', 'ANNO')
    d.line(230, 44, 230, 53, 'overall-dim-r', 'ANNO')
    d.text(105, 41, 'OVERALL WIDTH / PROJECT DESIGN', 2.6, 'overall-note')
    d.line(243, 66, 243, 134, 'height-dim', 'ANNO')
    d.line(239, 66, 248, 66, 'height-foot', 'ANNO')
    d.line(239, 134, 248, 134, 'height-top', 'ANNO')
    d.text(18, 33, 'Concept only. Hydraulic, structural and foundation design required.', 2.6, 'qualification')
  })
  return complete(sdk, document, 'box-culvert', 'Twin-cell box culvert', { openings: 2, wingWalls: 2 })
}

export async function bridgePierElevation() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'curated-bridge-pier', title: 'Bridge pier elevation', units: 'millimeter' })
  await document.transact('Draw bridge pier and pile group elevation', tx => {
    const d = drawing(tx, 'PIER', 'BRIDGE PIER ELEVATION', 'Cap beam / twin columns / pile foundation')
    d.text(18, 169, 'ELEVATION  /  DIAGRAMMATIC', 4, 'view-heading')
    d.line(17, 139, 260, 139, 'deck-top', 'CONTEXT')
    d.rect(27, 130, 250, 136, 'deck-slab')
    d.rect(39, 119, 238, 129, 'cap-beam')
    d.rect(72, 129, 104, 132, 'bearing-left', 'CONTEXT')
    d.rect(174, 129, 206, 132, 'bearing-right', 'CONTEXT')
    d.rect(79, 62, 96, 119, 'column-left')
    d.rect(181, 62, 198, 119, 'column-right')
    d.rect(51, 50, 225, 63, 'pile-cap')
    d.hatch([[52,51],[224,51],[224,61],[52,61]], 'pile-cap-hatch')
    for (const [x, id] of [[67, 'pile-1'], [113, 'pile-2'], [163, 'pile-3'], [209, 'pile-4']]) {
      d.rect(x - 4, 30, x + 4, 50, id)
      d.line(x - 4, 30, x, 26, `${id}-tip-a`)
      d.line(x, 26, x + 4, 30, `${id}-tip-b`)
    }
    d.line(17, 66, 51, 66, 'ground-left', 'CONTEXT')
    d.line(225, 66, 260, 66, 'ground-right', 'CONTEXT')
    d.line(34, 66, 34, 76, 'ground-marker-left', 'CONTEXT')
    d.line(243, 66, 243, 76, 'ground-marker-right', 'CONTEXT')
    d.line(138, 25, 138, 153, 'pier-centerline', 'CONTEXT')
    d.line(94, 98, 57, 104, 'column-leader', 'ANNO')
    d.text(18, 107, 'PIER COLUMN', 2.8, 'column-label')
    d.line(225, 55, 249, 46, 'cap-leader', 'ANNO')
    d.text(222, 41, 'PILE CAP', 2.8, 'cap-label')
    d.line(210, 38, 248, 33, 'pile-leader', 'ANNO')
    d.text(214, 27, 'PILE GROUP', 2.8, 'pile-label')
    d.text(19, 149, 'DECK', 2.8, 'deck-label')
    d.text(20, 33, 'Example arrangement; pier and pile sizes are not design values.', 2.6, 'qualification')
  })
  return complete(sdk, document, 'bridge-pier', 'Bridge pier elevation', { columns: 2, piles: 4 })
}

export async function buildCuratedInfrastructureSheetDocuments() {
  return Promise.all([
    inspectionChamberDetail(), roadCrossSection(), boxCulvertSection(), bridgePierElevation(),
  ])
}
