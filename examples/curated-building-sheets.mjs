import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/index.js'

const p = (x, y) => [x, y, 0]

async function createSheet(id, title, discipline, draw, facts) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `public-curated-${id}`, title, units: 'millimeter' })
  await document.transact(`Draw ${title}`, tx => {
    const linetypeId = tx.upsertTableRecord('linetypes', { name: 'KJD-CONTINUOUS', type: 'LINETYPE', payload: { patternSegments: [] } }).id
    const layers = Object.fromEntries([
      ['frame', 8, 0x60758a], ['outline', 7, 0xdce8f4], ['detail', 8, 0x8495a8], ['accent', 4, 0x37d8ee],
      ['planting', 3, 0x79c99a], ['annotation', 7, 0xdce8f4], ['highlight', 2, 0xf0c779],
     ].map(([name, color, trueColor]) => [name, tx.upsertTableRecord('layers', {
      name: `KJD_${name.toUpperCase()}`, type: 'LAYER', payload: { color, trueColor, linetypeId, visible: true, plottable: true },
    }).id]))
    const dim = tx.upsertTableRecord('dimensionStyles', {
      name: 'KJD-CURATED', payload: { textHeight: 2.6, arrowSize: 2.2, extensionOffset: 0.6,
        extensionBeyond: 1, decimalPlaces: 0 },
    })
    let serial = 0
    const add = (type, payload, layer = 'outline') => tx.createEntity(type,
      { ...payload, layerId: layers[layer] }, { id: `${id}-${++serial}` })
    const line = (x1, y1, x2, y2, layer) => add('LINE', { start: p(x1, y1), end: p(x2, y2) }, layer)
    const poly = (points, layer, closed = false) => add('LWPOLYLINE',
      { vertices: points.map(([x, y]) => p(x, y)), closed }, layer)
    const rect = (x1, y1, x2, y2, layer) => poly([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], layer, true)
    const circle = (x, y, radius, layer) => add('CIRCLE', { center: p(x, y), radius }, layer)
    const arc = (x, y, radius, startAngle, endAngle, layer) => add('ARC',
      { center: p(x, y), radius, startAngle, endAngle }, layer)
    const text = (x, y, value, height = 2.6, layer = 'annotation') => add('TEXT',
      { position: p(x, y), text: value, height }, layer)
    const hatch = (vertices, pattern = 'ANSI31', scale = 2.8, layer = 'detail') => add('HATCH',
      { boundaryLoops: [{ external: true, vertices: vertices.map(([x, y]) => p(x, y)) }],
        patternName: pattern, patternScale: scale }, layer)
    const aligned = (x1, y1, x2, y2, labelX, labelY) => add('DIMENSION', {
      dimensionType: 'ALIGNED', definitionPoints: [p(labelX, labelY), p(x1, y1), p(x2, y2)],
      styleId: dim.id,
    }, 'annotation')
    rect(5, 5, 292, 205, 'frame')
    rect(9, 9, 288, 201, 'frame')
    line(9, 36, 288, 36, 'frame')
    line(183, 9, 183, 36, 'frame')
    line(249, 9, 249, 36, 'frame')
    line(183, 21, 288, 21, 'frame')
    text(15, 24, 'KJDRAW / EDITABLE ENGINEERING EXAMPLES', 3.1, 'accent')
    text(15, 14, title.toUpperCase(), 5, 'annotation')
    text(187, 26, 'DISCIPLINE', 2, 'detail')
    text(187, 15, discipline.toUpperCase(), 3.2)
    text(253, 26, 'SHEET', 2, 'detail')
    text(253, 15, '01 / 01', 3.2)
    text(187, 12, 'CONCEPT EXAMPLE / EDITABLE GEOMETRY', 1.9, 'detail')
    draw({ add, line, poly, rect, circle, arc, text, hatch, aligned })
  })
  const layoutId = document.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PLOTSETUP', { layoutId, dxf: {
    paperWidth: 297, paperHeight: 210, paperUnits: 1, plotType: 4, flags: 0,
    windowMinX: 0, windowMinY: 0, windowMaxX: 297, windowMaxY: 210,
    scaleNumerator: 1, scaleDenominator: 1,
  } }, { document })
  return { id, title, category: discipline, sdk, document, layoutId, facts }
}

async function compactOfficePlanSheet() {
  return createSheet('compact-office-plan', 'Compact office floor plan', 'architecture',
    ({ line, rect, circle, arc, text, aligned, hatch }) => {
      text(15, 190, 'FLOOR PLAN / FOUR FUNCTIONAL ZONES', 4, 'accent')
      text(15, 183, 'CONCEPT PLAN / NTS / NOT FOR CONSTRUCTION', 2.6, 'detail')
      line(52, 51, 108, 51); line(128, 51, 234, 51); line(52, 51, 52, 175); line(52, 175, 234, 175); line(234, 175, 234, 51)
      line(55, 54, 108, 54, 'detail'); line(128, 54, 231, 54, 'detail'); line(55, 54, 55, 172, 'detail'); line(55, 172, 231, 172, 'detail'); line(231, 172, 231, 54, 'detail')
      // Glazing: double lines interrupt the otherwise solid perimeter.
      for (const [left, right] of [[75, 111], [163, 211]]) {
        line(left, 172, right, 172, 'accent')
        line(left, 175, right, 175, 'accent')
        line((left + right) / 2, 172, (left + right) / 2, 175, 'accent')
      }
      line(55, 116, 129, 116)
      line(145, 116, 184, 116); line(200, 116, 231, 116)
      line(55, 119, 129, 119, 'detail')
      line(145, 119, 184, 119, 'detail'); line(200, 119, 231, 119, 'detail')
      line(139, 54, 139, 99)
      line(139, 116, 139, 172)
      line(142, 54, 142, 99, 'detail')
      line(142, 116, 142, 172, 'detail')
      line(99, 54, 99, 116)
      line(102, 54, 102, 116, 'detail')
      // Door leaves and swing arcs.
      line(108, 54, 108, 74, 'accent')
      arc(108, 54, 20, 0, Math.PI / 2, 'detail')
      line(184, 116, 184, 100, 'accent')
      arc(184, 116, 16, Math.PI * 1.5, Math.PI * 2, 'detail')
      line(129, 116, 129, 100, 'accent')
      arc(129, 116, 16, Math.PI * 1.5, Math.PI * 2, 'detail')
      line(139, 99, 122, 99, 'accent')
      arc(139, 99, 17, Math.PI, Math.PI * 1.5, 'detail')
      line(99, 76, 84, 76, 'accent')
      arc(99, 76, 15, Math.PI, Math.PI * 1.5, 'detail')
      // Meeting table, chairs, display.
      rect(72, 137, 119, 153, 'accent')
      for (const x of [79, 94, 109]) { circle(x, 132, 3, 'detail'); circle(x, 158, 3, 'detail') }
      line(58, 155, 58, 169, 'highlight')
      text(69, 164, '01  MEETING', 2.4)
      // Four individual workstations with visually distinct desk and monitor symbols.
      for (const [x, y] of [[157, 139], [194, 139], [157, 81], [194, 81]]) {
        rect(x, y, x + 25, y + 10, 'accent')
        rect(x + 8, y + 5, x + 17, y + 9, 'detail')
        circle(x + 12.5, y - 5, 3, 'detail')
      }
      text(157, 162, '02  OPEN WORKSPACE', 2.4)
      // Pantry cabinetry / sink / shared reception bench.
      rect(61, 59, 92, 67, 'accent')
      rect(61, 82, 92, 87, 'detail')
      circle(82, 63, 2.8, 'detail')
      rect(112, 84, 132, 94, 'accent')
      text(60, 101, '03  PANTRY', 2.4)
      text(108, 101, '04  ENTRY', 2.4)

      text(15, 48, 'Furniture and partitions are editable CAD objects.', 2.2, 'detail')
    }, { rooms: 4, workstations: 4, notToScale: true, concept: true })
}

async function doorWindowElevationsSheet() {
  return createSheet('door-window-elevations', 'Door and window elevations', 'architecture',
    ({ line, rect, circle, arc, text, aligned, hatch }) => {
      text(15, 190, 'OPENING TYPES / ELEVATION + SCHEDULE', 4, 'accent')
      text(15, 184, 'SYMBOLIC ELEVATIONS / NTS. NOMINAL SIZES ARE LISTED BELOW.', 2.2, 'detail')
      const panels = [
        { x: 20, label: 'D01 / SINGLE LEAF', width: 40, kind: 'door' },
        { x: 90, label: 'D02 / DOUBLE LEAF', width: 48, kind: 'double' },
        { x: 164, label: 'W01 / FIXED', width: 44, kind: 'fixed' },
        { x: 233, label: 'W02 / CASEMENT', width: 42, kind: 'casement' },
      ]
      for (const item of panels) {
        const { x, label, width, kind } = item
        rect(x - 7, 92, x + width + 7, 177, 'detail')
        text(x - 4, 165, label, 2.1, 'annotation')
        rect(x, 112, x + width, 152)
        rect(x + 2, 114, x + width - 2, 150, 'accent')
        if (kind === 'door') {
          line(x + width - 5, 132, x + width - 5, 135, 'highlight')
          circle(x + width - 5, 133, 0.8, 'highlight')
          line(x + 4, 116, x + width - 4, 148, 'detail')
        } else if (kind === 'double') {
          line(x + width / 2, 114, x + width / 2, 150, 'accent')
          line(x + width / 2 - 4, 130, x + width / 2 - 4, 135, 'highlight')
          line(x + width / 2 + 4, 130, x + width / 2 + 4, 135, 'highlight')
        } else if (kind === 'fixed') {
          line(x + 4, 116, x + width - 4, 148, 'detail')
          line(x + 4, 148, x + width - 4, 116, 'detail')
        } else {
          line(x + width / 2, 114, x + width / 2, 150, 'accent')
          line(x + 3, 116, x + width / 2 - 2, 148, 'detail')
          line(x + width / 2 + 2, 148, x + width - 3, 116, 'detail')
        }
        text(x + 2, 102, 'SCHEMATIC / NTS', 1.9, 'detail')
        line(x - 8, 88, x + width + 8, 88, 'detail')
      }
      text(18, 78, 'TAG', 2.3, 'accent')
      text(70, 78, 'DESCRIPTION', 2.3, 'accent')
      text(202, 78, 'NOMINAL SIZE', 2.3, 'accent')
      line(15, 73, 281, 73, 'detail')
      const rows = [
        ['D01', 'Single leaf flush door', '900 x 2100'],
        ['D02', 'Double leaf entry door', '1500 x 2100'],
        ['W01', 'Fixed glazing', '1200 x 1200'],
        ['W02', 'Operable casement', '1200 x 1200'],
      ]
      rows.forEach(([tag, desc, size], i) => {
        const y = 66 - i * 7
        text(18, y, tag, 2.6)
        text(70, y, desc, 2.6)
        text(202, y, size, 2.6)
        line(15, y - 2, 281, y - 2, 'detail')
      })
      hatch([[17, 92], [22, 92], [22, 96], [17, 96]], 'ANSI31', 1.5)
      circle(279, 190, 3, 'highlight')
      arc(279, 190, 4.5, 0, Math.PI, 'detail')
    }, { openingTypes: 4, scheduleRows: 4, concept: true })
}

async function retailPowerOneLineSheet() {
  return createSheet('retail-power-one-line', 'Small retail power one-line', 'electrical',
    ({ line, rect, circle, poly, text }) => {
      text(15, 190, 'ELECTRICAL SINGLE-LINE / LOAD GROUPS', 4, 'accent')
      text(15, 182, 'Concept topology, not a wiring or protection design.', 2.4, 'detail')
      text(25, 166, 'UTILITY SUPPLY', 2.3)
      circle(37, 147, 9, 'accent')
      text(32, 146, 'AC', 3.4, 'accent')
      line(46, 147, 66, 147)
      rect(66, 141, 79, 153, 'highlight')
      line(68, 143, 77, 151, 'highlight')
      text(64, 157, 'MAIN', 2.2)
      line(79, 147, 101, 147)
      rect(101, 134, 135, 160, 'accent')
      text(108, 148, 'DB-01', 3.5, 'accent')
      text(105, 139, 'PANEL', 2.2)
      line(135, 147, 145, 147)
      line(145, 147, 145, 67)
      // Each protected branch leaves the panel bus and terminates at its load symbol.
      const circuits = [
        { y: 130, tag: 'C01', label: 'LIGHTING', load: 'LED x 12', symbol: 'light' },
        { y: 109, tag: 'C02', label: 'SOCKETS', load: 'GENERAL', symbol: 'socket' },
        { y: 88, tag: 'C03', label: 'SIGNAGE', load: 'SIGN x 1', symbol: 'sign' },
        { y: 67, tag: 'C04', label: 'HVAC', load: 'FCU x 2', symbol: 'motor' },
      ]
      for (const circuit of circuits) {
        const y = circuit.y
        line(145, y, 164, y)
        circle(145, y, 1.8, 'highlight')
        rect(164, y - 4, 173, y + 4, 'highlight')
        line(166, y - 2, 171, y + 2, 'highlight')
        line(173, y, 204, y)
        if (circuit.symbol === 'light') {
          circle(210, y, 5, 'accent')
          line(206, y - 4, 214, y + 4, 'accent')
          line(206, y + 4, 214, y - 4, 'accent')
        } else if (circuit.symbol === 'socket') {
          circle(210, y, 5, 'accent')
          line(208, y - 1, 208, y + 2, 'accent')
          line(212, y - 1, 212, y + 2, 'accent')
        } else if (circuit.symbol === 'sign') {
          rect(204, y - 4, 216, y + 4, 'accent')
          text(206, y - 1, 'S', 3, 'accent')
        } else {
          circle(210, y, 6, 'accent')
          text(207, y - 1, 'M', 3, 'accent')
        }
        text(24, y + 1, circuit.tag, 3, 'highlight')
        text(49, y + 1, circuit.label, 3)
        text(119, y + 1, circuit.load, 2.5, 'detail')
      }
      poly([[19, 45], [278, 45], [278, 175]], 'detail')
      text(20, 40, 'Editable lines, symbols, labels and layer-separated circuit groups.', 2.1, 'detail')
    }, { circuits: 4, panelCount: 1, concept: true })
}

async function courtyardCirculationSheet() {
  return createSheet('courtyard-circulation-plan', 'Courtyard circulation plan', 'site',
    ({ line, rect, circle, poly, text, hatch, aligned }) => {
      text(15, 190, 'SITE DIAGRAM / WALKWAY + LANDSCAPE', 4, 'accent')
      text(15, 183, 'CONCEPT SITE PLAN / NTS / NOT FOR CONSTRUCTION', 2.2, 'detail')
      rect(28, 47, 267, 180, 'detail')
      line(28, 165, 267, 165, 'detail')
      text(33, 169, 'NORTH PROPERTY EDGE', 2.1, 'detail')
      // Building and entry terrace.
      rect(44, 103, 96, 151)
      rect(48, 107, 92, 147, 'detail')
      line(60, 103, 76, 103, 'accent')
      text(55, 126, 'BUILDING', 3.2)
      rect(54, 88, 88, 103, 'accent')
      // A clear branching paved walkway, with an explicitly editable hatch.
      const path = [[70, 88], [89, 83], [121, 84], [145, 105], [170, 105], [196, 78], [225, 78], [245, 91]]
      const lower = path.map(([x, y]) => [x, y - 7])
      poly(path, 'accent')
      poly(lower, 'accent')
      hatch([...path, ...lower.reverse()], 'ANSI31', 4.5, 'detail')
      line(145, 105, 145, 134, 'accent')
      line(152, 105, 152, 134, 'accent')
      rect(137, 134, 160, 151, 'accent')
      text(140, 141, 'PLAZA', 2.5)
      // Plant beds are bounded separately from tree canopy symbols.
      const beds = [
        [[105, 125], [130, 124], [128, 151], [110, 155]],
        [[171, 118], [199, 110], [215, 140], [190, 151]],
        [[209, 52], [252, 52], [252, 68], [214, 68]],
      ]
      for (const vertices of beds) {
        poly(vertices, 'planting', true)
        hatch(vertices, 'ANSI31', 3.4, 'planting')
      }
      for (const [x, y, r] of [
        [116, 138, 6], [187, 133, 7], [202, 127, 5], [229, 59, 5], [243, 59, 5],
        [110, 62, 7], [127, 61, 6], [167, 59, 7], [178, 64, 5], [242, 143, 7],
      ]) {
        circle(x, y, r, 'planting')
        circle(x, y, 1, 'planting')
        line(x - r * .7, y, x + r * .7, y, 'detail')
      }
      // Seating and wayfinding make the diagram readable at thumbnail scale.
      for (const [x, y] of [[175, 99], [211, 97]]) {
        rect(x, y, x + 15, y + 3, 'highlight')
        line(x + 2, y - 2, x + 2, y, 'detail')
        line(x + 13, y - 2, x + 13, y, 'detail')
      }
      line(256, 150, 256, 164, 'highlight')
      poly([[252, 157], [256, 165], [260, 157]], 'highlight', true)
      text(251, 148, 'N', 3, 'highlight')
      text(33, 56, 'PEDESTRIAN ROUTE', 2.3, 'accent')
    }, { trees: 10, plantingBeds: 3, pathCount: 2, notToScale: true, concept: true })
}

export async function buildCuratedBuildingSheetDocuments() {
  return Promise.all([
    compactOfficePlanSheet(), doorWindowElevationsSheet(),
    retailPowerOneLineSheet(), courtyardCirculationSheet(),
  ])
}
