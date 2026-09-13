import { createHash } from 'node:crypto'

export const manufacturingTaskSuiteVersion = '1.0.0'

const layers = [
  { name: 'OUTLINE', pattern: [], lineweight: 35 },
  { name: 'HIDDEN', pattern: [3, -1], lineweight: 18 },
  { name: 'CENTER', pattern: [8, -1, 1, -1], lineweight: 18 },
  { name: 'DIMENSIONS', pattern: [], lineweight: 18 },
  { name: 'NOTES', pattern: [], lineweight: 18 },
  { name: 'SHEET', pattern: [], lineweight: 25 },
]

const cases = [
  ['fixture-plate-240x140-a3', 'COMPACT FIXTURE PLATE', 'MIC6 CAST ALUMINIUM', 240, 140, 10, 6, 9, 5, 8, 13, 5, 'A3'],
  ['fixture-plate-260x150-a3', 'ASSEMBLY FIXTURE PLATE', '6061-T6 ALUMINIUM', 260, 150, 12, 6, 10, 5.5, 8.5, 14, 6, 'A3'],
  ['fixture-plate-280x160-a3', 'INSPECTION FIXTURE PLATE', '7075-T6 ALUMINIUM', 280, 160, 14, 7, 10, 4.5, 8, 13, 6, 'A3'],
  ['fixture-plate-300x170-a3', 'ROBOT TOOLING PLATE', 'MIC6 CAST ALUMINIUM', 300, 170, 12, 7, 11, 5, 9, 15, 6, 'A3'],
  ['fixture-plate-320x175-a3', 'PRECISION NEST PLATE', 'P20 TOOL STEEL', 320, 175, 16, 7, 12, 6, 10, 16, 8, 'A3'],
  ['fixture-plate-300x180-a2', 'MODULAR FIXTURE PLATE', 'MIC6 CAST ALUMINIUM', 300, 180, 12, 8, 12, 5, 8.5, 14, 7, 'A2'],
  ['fixture-plate-330x190-a2', 'WELDING FIXTURE PLATE', 'S355 STRUCTURAL STEEL', 330, 190, 16, 8, 12, 6, 10, 17, 8, 'A2'],
  ['fixture-plate-350x200-a2', 'CMM INSPECTION PLATE', 'GRANITE COMPOSITE', 350, 200, 20, 8, 11, 5, 10, 18, 9, 'A2'],
  ['fixture-plate-360x210-a2', 'PALLET LOCATING PLATE', '4140 PREHARD STEEL', 360, 210, 18, 9, 12, 6.5, 11, 18, 8, 'A2'],
  ['fixture-plate-380x220-a2', 'TRANSFER LINE PALLET', '7075-T6 ALUMINIUM', 380, 220, 20, 9, 11, 6, 12, 20, 10, 'A2'],
  ['fixture-plate-400x230-a2', 'AUTOMATION BASE PLATE', '6061-T6 ALUMINIUM', 400, 230, 18, 9, 12, 5.5, 10, 17, 8, 'A2'],
  ['fixture-plate-420x240-a2', 'HYDRAULIC TEST PLATE', '316L STAINLESS STEEL', 420, 240, 22, 10, 12, 7, 12, 20, 10, 'A2'],
  ['fixture-plate-440x250-a2', 'VACUUM TOOLING PLATE', 'MIC6 CAST ALUMINIUM', 440, 250, 20, 10, 11, 5, 10, 18, 9, 'A2'],
  ['fixture-plate-460x260-a2', 'LASER WELD FIXTURE', 'S355 STRUCTURAL STEEL', 460, 260, 24, 10, 12, 6, 12, 20, 10, 'A2'],
  ['fixture-plate-480x270-a2', 'MACHINING TOMBSTONE FACE', 'GG25 CAST IRON', 480, 270, 25, 9, 12, 8, 14, 22, 12, 'A2'],
  ['fixture-plate-420x280-a1', 'AEROSPACE DRILL JIG', '7075-T7351 ALUMINIUM', 420, 280, 22, 10, 12, 4.8, 9, 15, 7, 'A1'],
  ['fixture-plate-450x300-a1', 'COMPOSITE TRIM FIXTURE', 'INVAR 36', 450, 300, 20, 10, 11, 5, 10, 16, 8, 'A1'],
  ['fixture-plate-480x320-a1', 'BATTERY MODULE NEST', '6061-T6 ALUMINIUM', 480, 320, 18, 10, 12, 6, 11, 18, 8, 'A1'],
  ['fixture-plate-500x340-a1', 'ENGINE BLOCK DATUM PLATE', 'GG25 CAST IRON', 500, 340, 30, 9, 12, 8, 14, 24, 14, 'A1'],
  ['fixture-plate-520x360-a1', 'CHASSIS GAUGE PLATE', 'S355 STRUCTURAL STEEL', 520, 360, 25, 10, 12, 7, 12, 20, 10, 'A1'],
  ['fixture-plate-540x380-a1', 'RAIL ASSEMBLY FIXTURE', '6061-T6 ALUMINIUM', 540, 380, 24, 10, 11, 6, 12, 20, 10, 'A1'],
  ['fixture-plate-560x400-a1', 'TURBINE CASING FIXTURE', '4140 PREHARD STEEL', 560, 400, 32, 10, 12, 8, 14, 24, 14, 'A1'],
  ['fixture-plate-580x420-a1', 'LARGE CMM DATUM PLATE', 'GRANITE COMPOSITE', 580, 420, 35, 9, 12, 6, 12, 20, 12, 'A1'],
  ['fixture-plate-600x440-a1', 'ROBOT CELL BASE PLATE', 'S355 STRUCTURAL STEEL', 600, 440, 30, 10, 12, 9, 16, 26, 15, 'A1'],
  ['fixture-plate-620x460-a1', 'PRESS TOOL CHANGE PLATE', '42CRMO4 STEEL', 620, 460, 36, 10, 11, 10, 18, 28, 16, 'A1'],
  ['fixture-plate-640x470-a1', 'AIRCRAFT PANEL DRILL JIG', '7075-T7351 ALUMINIUM', 640, 470, 28, 10, 12, 5, 10, 17, 8, 'A1'],
  ['fixture-plate-660x480-a0', 'BODY-IN-WHITE CHECKING PLATE', 'INVAR 36', 660, 480, 30, 9, 12, 6, 12, 20, 10, 'A0'],
  ['fixture-plate-680x490-a0', 'GEARBOX ASSEMBLY PALLET', 'GG25 CAST IRON', 680, 490, 38, 10, 12, 8, 16, 26, 15, 'A0'],
  ['fixture-plate-700x500-a0', 'MARINE VALVE TEST PLATE', '316L STAINLESS STEEL', 700, 500, 40, 10, 11, 10, 18, 30, 18, 'A0'],
  ['fixture-plate-720x510-a0', 'HEAVY MACHINING BASE PLATE', '4140 PREHARD STEEL', 720, 510, 42, 10, 12, 12, 20, 32, 20, 'A0'],
]

const sheetSizes = { A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] }
const standardNames = { A3: 'ISO A3 LANDSCAPE', A2: 'ISO A2 LANDSCAPE', A1: 'ISO A1 LANDSCAPE', A0: 'ISO A0 LANDSCAPE' }
const round = value => Number(value.toFixed(3))
const fmt = value => Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')

export function hashManufacturingSuiteInput(input) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function createInput(row, index) {
  const [id, title, material, length, width, thickness, rows, columns, holeDiameter, mountDiameter, counterboreDiameter, counterboreDepth, sheetName] = row
  const workingOrigin = [50, 45]
  const workingSpacing = [round((length - 100) / (columns - 1)), round((width - 110) / (rows - 1))]
  const verticalSecondSlot = index % 2 === 1
  return {
    version: '1.0.0', expectedRevision: 0, units: 'millimeter', drawingId: `MFG-${String(index + 1).padStart(3, '0')}`,
    title, revision: String.fromCharCode(65 + (index % 4)), material, quantity: 1 + (index % 3), length, width, thickness,
    holePatterns: [
      { rows, columns, origin: workingOrigin, spacing: workingSpacing, throughDiameter: holeDiameter },
      { rows: 2, columns: 2, origin: [18, 18], spacing: [length - 36, width - 36], throughDiameter: mountDiameter, counterboreDiameter, counterboreDepth },
    ],
    slots: [
      { center: [round(length * 0.3), width - 35], length: round(Math.min(54, length * 0.16)), width: 10, orientationDegrees: 0 },
      verticalSecondSlot
        ? { center: [length - 30, round(width * 0.48)], length: round(Math.min(60, width * 0.28)), width: 9, orientationDegrees: 90 }
        : { center: [round(length * 0.7), width - 35], length: round(Math.min(48, length * 0.14)), width: 9, orientationDegrees: 0 },
    ],
    sheet: { origin: [0, 0], size: [...sheetSizes[sheetName]] }, textHeight: sheetName === 'A1' ? 3.5 : 3,
  }
}

function requirementsFromInput(input, sheetName) {
  const margin = Math.max(8, input.textHeight * 2)
  const titleHeight = Math.max(36, input.textHeight * 9)
  const dimensionPad = Math.max(10, input.textHeight * 4)
  const gap = Math.max(12, input.textHeight * 5)
  const viewWidth = input.sheet.size[0] - margin * 2 - dimensionPad
  const viewHeight = input.sheet.size[1] - margin * 2 - titleHeight - gap - dimensionPad * 1.5
  const scale = Math.min(1, viewWidth / input.length, viewHeight / (input.width + input.thickness))
  if (Math.abs(scale - 1) > 1e-12) throw new Error(`Task ${input.drawingId} does not fit ${sheetName} at 1:1`)
  const frontX = margin + dimensionPad + (viewWidth - input.length) / 2
  const frontY = margin + titleHeight + input.textHeight * 2
  const topX = frontX
  const topY = frontY + input.thickness + gap
  const holePatterns = input.holePatterns.map((pattern, index) => ({ id: index === 0 ? 'working-grid' : 'mounting-grid', ...structuredClone(pattern) }))
  const slots = input.slots.map((slot, index) => ({ id: `slot-${index + 1}`, ...structuredClone(slot) }))
  const requiredNotes = [
    input.title, `DRAWING: ${input.drawingId}`, `MATERIAL: ${input.material} QTY: ${input.quantity}`, `REV: ${input.revision}`,
    'UNITS: mm SCALE: 1:1',
    ...holePatterns.flatMap(pattern => [
      pattern.counterboreDiameter == null
        ? `${pattern.rows * pattern.columns}X DIA ${fmt(pattern.throughDiameter)} THRU`
        : `${pattern.rows * pattern.columns}X DIA ${fmt(pattern.throughDiameter)} THRU / C'BORE DIA ${fmt(pattern.counterboreDiameter)} DEPTH ${fmt(pattern.counterboreDepth)}`,
      ...(pattern.columns > 1 ? [`${pattern.columns - 1} SPACES @ ${fmt(pattern.spacing[0])}`] : []),
      ...(pattern.rows > 1 ? [`${pattern.rows - 1} SPACES @ ${fmt(pattern.spacing[1])}`] : []),
    ]),
    ...slots.map((slot, index) => `S${index + 1} SLOT ${fmt(slot.length)} X ${fmt(slot.width)}`),
    'MACHINING NOTES:', '1. ALL DIMENSIONS ARE IN MILLIMETERS.', '2. REMOVE BURRS AND BREAK SHARP EDGES.',
    '3. DO NOT SCALE DRAWING; USE NATIVE DIMENSIONS.', 'TOP VIEW', 'FRONT VIEW',
  ]
  const nativeDimensionCount = 3 + holePatterns.reduce((total, pattern) => total + 1 + Number(pattern.columns > 1) + Number(pattern.rows > 1), 0) + slots.length
  return {
    units: input.units, drawingId: input.drawingId, title: input.title, revision: input.revision, material: input.material,
    quantity: input.quantity, plate: { length: input.length, width: input.width, thickness: input.thickness },
    sheet: { origin: [...input.sheet.origin], size: [...input.sheet.size], standard: standardNames[sheetName] },
    views: { top: { origin: [topX, topY], scale: 1 }, front: { origin: [frontX, frontY], scale: 1, looking: '-Y' } },
    holePatterns, slots, layers: structuredClone(layers), dimensionTextHeight: input.textHeight, nativeDimensionCount, requiredNotes,
  }
}

function promptFrom(input, sheetName) {
  const [working, mounting] = input.holePatterns
  const slots = input.slots.map((slot, index) => `S${index + 1} center (${fmt(slot.center[0])},${fmt(slot.center[1])}), ${fmt(slot.length)} x ${fmt(slot.width)}, orientation ${slot.orientationDegrees} degrees`).join('; ')
  return `Create drawing ${input.drawingId} revision ${input.revision}: ${input.title}; quantity ${input.quantity}; material ${input.material}. Use millimeters on an ISO ${sheetName} landscape sheet ${input.sheet.size[0]} x ${input.sheet.size[1]} at 1:1. Plate ${input.length} x ${input.width} x ${input.thickness}. Working holes: ${working.rows} rows x ${working.columns} columns, origin (${working.origin.join(',')}), spacing (${working.spacing.join(',')}), diameter ${working.throughDiameter} through. Mounting holes: 2 x 2, origin (${mounting.origin.join(',')}), spacing (${mounting.spacing.join(',')}), diameter ${mounting.throughDiameter} through with diameter ${mounting.counterboreDiameter} counterbore depth ${mounting.counterboreDepth}. Slots: ${slots}. Include top and front views, center and hidden lines, native dimensions, title block, feature callouts, and machining notes. Use OUTLINE, HIDDEN, CENTER, DIMENSIONS, NOTES and SHEET layers with by-layer standard styles; keep all geometry editable.`
}

export const manufacturingTaskSuite = cases.map((row, index) => {
  const input = createInput(row, index)
  const sheetName = row.at(-1)
  return Object.freeze({
    id: row[0], version: manufacturingTaskSuiteVersion, prompt: promptFrom(input, sheetName), input,
    inputSha256: hashManufacturingSuiteInput(input), expected: requirementsFromInput(input, sheetName),
  })
})

export const manufacturingTaskSuiteScope = 'Thirty unique, versioned and fully parameterized manufacturing-sheet tasks spanning ISO A3, A2, A1 and A0 layouts, plate sizes, dense hole arrays, counterbores, horizontal and vertical slots, materials, dimensions, layers, notes and editable KJD/DXF output.'
