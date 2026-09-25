import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/index.js'

const p = (x, y) => [x, y, 0]

function sheet(tx, key, heading, subtitle) {
  const layer = {}
  const linetypeId = tx.upsertTableRecord('linetypes', { name: `${key}-CONTINUOUS`, type: 'LINETYPE', payload: { patternSegments: [] } }).id
  for (const [name, color] of [['FRAME', 8], ['OUTLINE', 9], ['DETAIL', 3], ['ANNOTATION', 9], ['HATCH', 9]]) {
    layer[name] = tx.upsertTableRecord('layers', { name: `${key}-${name}`, type: 'LAYER', payload: { color, linetypeId, visible: true, frozen: false, locked: false, plottable: true } }).id
  }
  const add = (type, payload, id, name = 'OUTLINE') => tx.createEntity(type, { ...payload, layerId: layer[name] }, { id: `${key}-${id}` })
  const line = (x1, y1, x2, y2, id, name) => add('LINE', { start: p(x1, y1), end: p(x2, y2) }, id, name)
  const rect = (x1, y1, x2, y2, id, name) => add('LWPOLYLINE', { vertices: [p(x1, y1), p(x2, y1), p(x2, y2), p(x1, y2)], closed: true }, id, name)
  const text = (x, y, value, size, id, name = 'ANNOTATION') => add('TEXT', { position: p(x, y), text: value, height: size }, id, name)
  const circle = (x, y, r, id, name = 'OUTLINE') => add('CIRCLE', { center: p(x, y), radius: r }, id, name)
  rect(0, 0, 277, 190, 'outer', 'FRAME')
  rect(5, 5, 272, 185, 'inner', 'FRAME')
  line(5, 25, 272, 25, 'title-rule', 'FRAME')
  line(176, 5, 176, 25, 'title-column', 'FRAME')
  line(240, 5, 240, 25, 'revision-column', 'FRAME')
  text(10, 13, heading, 6, 'title')
  text(10, 7, subtitle, 2.6, 'subtitle')
  text(181, 16, 'KJDRAW / ENGINEERING EXAMPLES', 2.6, 'brand')
  text(181, 9, 'Editable CAD - illustrative', 2.4, 'status')
  text(245, 16, 'A4 / 1:1', 2.5, 'format')
  text(245, 9, 'REV 01', 2.5, 'revision')
  return { add, line, rect, text, circle }
}

async function finish(document, sdk, id, title, category, facts) {
  const layoutId = document.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PLOTSETUP', { layoutId, dxf: {
    paperWidth: 297, paperHeight: 210, paperUnits: 1, plotType: 4, flags: 0,
    windowMinX: -10, windowMinY: -10, windowMaxX: 287, windowMaxY: 200,
    scaleNumerator: 1, scaleDenominator: 1,
  } }, { document })
  return { id, title, category, sdk, document, layoutId, facts }
}

export async function drainageNetworkSheet() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'curated-drainage-network', title: 'Site drainage network', units: 'millimeter' })
  await document.transact('Draw editable site drainage plan', tx => {
    const d = sheet(tx, 'DRAIN', 'SITE DRAINAGE NETWORK', 'Inspection chambers / flow direction / pipe schedule')
    d.text(16, 173, 'PLAN  /  DIAGRAMMATIC', 4.2, 'view-label')
    d.rect(16, 48, 192, 160, 'site-boundary', 'DETAIL')
    d.rect(26, 58, 104, 103, 'building-a')
    d.rect(116, 108, 177, 148, 'building-b')
    d.text(49, 79, 'BUILDING A', 3.8, 'building-a-label')
    d.text(132, 126, 'BUILDING B', 3.8, 'building-b-label')
    const chambers = [[34, 120], [80, 120], [110, 120], [110, 76], [154, 76], [181, 76]]
    for (let i = 0; i < chambers.length; i++) {
      const [x, y] = chambers[i]
      d.circle(x, y, 4, `chamber-${i + 1}`, 'DETAIL')
      d.circle(x, y, 1, `chamber-core-${i + 1}`, 'DETAIL')
      d.text(x - 5, y + 7, `IC-${String(i + 1).padStart(2, '0')}`, 2.6, `chamber-label-${i + 1}`)
    }
    const segments = [[34,120,80,120], [80,120,110,120], [110,120,110,76], [110,76,154,76], [154,76,181,76]]
    for (let i = 0; i < segments.length; i++) {
      const [x1,y1,x2,y2] = segments[i]
      d.line(x1,y1,x2,y2,`pipe-${i + 1}`,'DETAIL')
      if (y1 === y2) {
        const mid = (x1 + x2) / 2
        d.line(mid - 3, y1 + 1.5, mid, y1, `flow-a-${i}`,'ANNOTATION')
        d.line(mid - 3, y1 - 1.5, mid, y1, `flow-b-${i}`,'ANNOTATION')
      } else {
        d.line(x1 - 1.5, 96, x1, 93, 'flow-down-a','ANNOTATION')
        d.line(x1 + 1.5, 96, x1, 93, 'flow-down-b','ANNOTATION')
      }
    }
    d.line(34,120,34,150,'inlet-a','DETAIL')
    d.line(181,76,205,76,'outfall','DETAIL')
    d.circle(208,76,3,'outfall-symbol','DETAIL')
    d.text(202,67,'OUTFALL','2.5','outfall-label')
    d.text(35,111,'DN300 / 1:180',2.4,'pipe-note-1')
    d.text(119,67,'DN375 / 1:220',2.4,'pipe-note-2')
    d.rect(199,112,257,160,'legend-box','FRAME')
    d.text(204,149,'LEGEND',3.8,'legend-heading')
    d.circle(208,137,3,'legend-chamber','DETAIL')
    d.text(216,135,'INSPECTION CHAMBER',2.5,'legend-chamber-label')
    d.line(204,124,214,124,'legend-pipe','DETAIL')
    d.text(216,122,'GRAVITY PIPE',2.5,'legend-pipe-label')
    d.text(199,99,'NOTES',3.3,'notes-heading')
    d.text(199,92,'01  Flow arrows follow pipe fall.',2.4,'notes-1')
    d.text(199,86,'02  Coordinates are illustrative.',2.4,'notes-2')
    d.text(199,80,'03  Verify levels on site.',2.4,'notes-3')
    d.text(20,39,'FLOW SCHEMATIC - CHAMBER LOCATIONS ILLUSTRATIVE',2.5,'schematic-note')
  })
  return finish(document, sdk, 'drainage-network', 'Site drainage network', 'civil', { chamberCount: 6, pipeCount: 5, illustrative: true })
}

export async function retainingWallSheet() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'curated-retaining-wall', title: 'Retaining wall section', units: 'millimeter' })
  await document.transact('Draw editable retaining wall construction detail', tx => {
    const d = sheet(tx, 'WALL', 'RETAINING WALL SECTION', 'Footing / drainage / backfill / construction notes')
    d.text(17, 173, 'SECTION A-A  /  1:50', 4.2, 'view-label')
    d.line(18,52,130,52,'ground-line','DETAIL')
    d.line(129,52,129,151,'backfill-top','DETAIL')
    d.line(129,151,184,151,'backfill-grade','DETAIL')
    d.rect(47,42,154,55,'footing')
    d.rect(101,55,119,151,'stem')
    d.rect(91,151,129,156,'cap')
    d.add('HATCH', { boundaryLoops: [{ vertices: [p(49,44),p(152,44),p(152,53),p(49,53)] }], patternName: 'ANSI31', patternScale: 3 }, 'footing-hatch','HATCH')
    d.add('HATCH', { boundaryLoops: [{ vertices: [p(103,57),p(117,57),p(117,149),p(103,149)] }], patternName: 'ANSI31', patternScale: 3 }, 'stem-hatch','HATCH')
    for (let y = 62; y < 141; y += 13) {
      d.line(133,y,176,y + 9,`backfill-stratum-${y}`,'DETAIL')
      d.line(147,y - 1,155,y + 7,`backfill-tick-${y}`,'DETAIL')
    }
    d.circle(126,66,4,'weep-hole','DETAIL')
    d.line(119,66,122,66,'weep-sleeve','DETAIL')
    d.rect(122,57,149,64,'drain-gravel','DETAIL')
    d.add('HATCH', { boundaryLoops: [{ vertices: [p(123,58),p(148,58),p(148,63),p(123,63)] }], patternName: 'CROSS', patternScale: 2.5 }, 'gravel-hatch','HATCH')
    d.line(27,55,27,151,'height-dim','ANNOTATION')
    d.line(24,55,35,55,'height-foot','ANNOTATION')
    d.line(24,151,35,151,'height-head','ANNOTATION')
    d.text(17,105,'4.8 m',3.2,'height-label')
    d.line(47,33,154,33,'footing-dim','ANNOTATION')
    d.line(47,30,47,38,'footing-dim-left','ANNOTATION')
    d.line(154,30,154,38,'footing-dim-right','ANNOTATION')
    d.text(93,28,'5.4 m',3.1,'footing-width')
    d.line(119,113,193,128,'backfill-leader','ANNOTATION')
    d.text(194,128,'COMPACTED BACKFILL',2.9,'backfill-label')
    d.line(126,66,193,76,'drain-leader','ANNOTATION')
    d.text(194,75,'WEEP HOLE + FILTER',2.9,'drain-label')
    d.rect(186,43,259,60,'note-box','FRAME')
    d.text(191,52,'CONCRETE C30',3.1,'material-label')
    d.text(191,46,'Example detail - design check required',2.2,'material-note')
  })
  return finish(document, sdk, 'retaining-wall', 'Retaining wall section', 'civil', { hatchCount: 3, drainageDetail: true, illustrative: true })
}

export async function utilityTrenchSheet() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'curated-utility-trench', title: 'Shared utility trench', units: 'millimeter' })
  await document.transact('Draw editable shared utility trench detail', tx => {
    const d = sheet(tx, 'TRENCH', 'SHARED UTILITY TRENCH', 'Typical cross-section / duct banks / clearances')
    d.text(17, 173, 'TYPICAL SECTION  /  NOT TO SCALE', 4.2, 'view-label')
    d.line(22,145,247,145,'surface','OUTLINE')
    d.line(54,145,54,58,'excavation-left','DETAIL')
    d.line(212,145,212,58,'excavation-right','DETAIL')
    d.line(54,58,212,58,'excavation-bottom','DETAIL')
    d.rect(61,61,205,73,'bedding','DETAIL')
    d.add('HATCH', { boundaryLoops: [{ vertices: [p(62,62),p(204,62),p(204,72),p(62,72)] }], patternName: 'CROSS', patternScale: 2.8 }, 'bedding-hatch','HATCH')
    for (let i = 0; i < 5; i++) {
      const x = 82 + i * 26
      d.circle(x,91,8,`duct-${i + 1}`)
      d.circle(x,91,4,`duct-core-${i + 1}`,'DETAIL')
    }
    d.rect(67,80,197,102,'duct-bank','OUTLINE')
    d.rect(77,112,191,122,'warning-tape','DETAIL')
    d.text(90,115,'WARNING  -  BURIED SERVICES',2.3,'warning-label')
    for (let i = 0; i < 7; i++) d.line(60 + i * 22,73,78 + i * 22,80,`granular-${i}`,'HATCH')
    d.line(45,58,45,145,'depth-dim','ANNOTATION')
    d.line(41,58,52,58,'depth-dim-foot','ANNOTATION')
    d.line(41,145,52,145,'depth-dim-head','ANNOTATION')
    d.text(24,109,'MIN 1.2 m',2.8,'depth-note')
    d.line(54,44,212,44,'width-dim','ANNOTATION')
    d.line(54,40,54,50,'width-left','ANNOTATION')
    d.line(212,40,212,50,'width-right','ANNOTATION')
    d.text(124,39,'1.6 m',3,'width-note')
    d.line(197,91,223,101,'duct-leader','ANNOTATION')
    d.text(224,101,'5 x Ø110 DUCT',2.7,'duct-note')
    d.line(176,67,220,69,'bedding-leader','ANNOTATION')
    d.text(222,68,'SAND BED',2.7,'bedding-note')
    d.text(20,28,'TYPICAL GEOMETRY ONLY - SET DEPTH AND SEPARATION BY LOCAL STANDARD',2.25,'qualification')
  })
  return finish(document, sdk, 'utility-trench', 'Shared utility trench', 'civil', { ductCount: 5, illustrative: true })
}

export async function buildCuratedCivilSheetDocuments() {
  return Promise.all([drainageNetworkSheet(), retainingWallSheet(), utilityTrenchSheet()])
}
