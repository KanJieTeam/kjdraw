// High-density manufacturing benchmark contract. The semantic requirements below are
// independent of the KJDraw compiler; the compact input is only a fixture for HTTP/tool tests.

export const manufacturingDrawingScope = 'A fully specified A2 manufacturing drawing for a high-density fixture plate: 1:1 top and front views, 96-hole working array, four counterbored mounting holes, two through slots, native dimensions, standard drafting layers and manufacturing notes. The benchmark checks editable DXF semantics and drafting completeness, not structural fitness or process approval.'

export function manufacturingDrawingRequirements() {
  return {
    units: 'millimeter',
    drawingId: 'JIG-300-180-A',
    title: 'HIGH-DENSITY MODULAR FIXTURE PLATE',
    revision: 'A',
    material: 'MIC6 CAST ALUMINIUM TOOLING PLATE',
    quantity: 1,
    plate: { length: 300, width: 180, thickness: 12 },
    sheet: { origin: [0, 0], size: [594, 420], standard: 'ISO A2 LANDSCAPE' },
    views: {
      top: { origin: [153, 77], scale: 1, mapping: '(x,y,z=12) -> (153+x,77+y)' },
      front: { origin: [153, 50], scale: 1, mapping: '(x,y,z) -> (153+x,50+z)', looking: '-Y' },
    },
    holePatterns: [
      { id: 'working-grid', rows: 8, columns: 12, origin: [30, 30], spacing: [22, 17], throughDiameter: 5 },
      { id: 'mounting', rows: 2, columns: 2, origin: [15, 15], spacing: [270, 150], throughDiameter: 8.5, counterboreDiameter: 14, counterboreDepth: 7 },
    ],
    slots: [
      { id: 'left-clamp-slot', center: [75, 165], length: 40, width: 10, orientationDegrees: 0 },
      { id: 'right-clamp-slot', center: [225, 165], length: 40, width: 10, orientationDegrees: 0 },
    ],
    layers: [
      { name: 'OUTLINE', pattern: [], lineweight: 35 },
      { name: 'HIDDEN', pattern: [3, -1], lineweight: 18 },
      { name: 'CENTER', pattern: [8, -1, 1, -1], lineweight: 18 },
      { name: 'DIMENSIONS', pattern: [], lineweight: 18 },
      { name: 'NOTES', pattern: [], lineweight: 18 },
      { name: 'SHEET', pattern: [], lineweight: 25 },
    ],
    dimensionTextHeight: 3,
    nativeDimensionCount: 11,
    requiredNotes: [
      'HIGH-DENSITY MODULAR FIXTURE PLATE',
      'DRAWING: JIG-300-180-A',
      'MATERIAL: MIC6 CAST ALUMINIUM TOOLING PLATE QTY: 1',
      'REV: A',
      'UNITS: mm SCALE: 1:1',
      '96X DIA 5 THRU',
      "4X DIA 8.5 THRU / C'BORE DIA 14 DEPTH 7",
      '11 SPACES @ 22',
      '7 SPACES @ 17',
      '1 SPACES @ 270',
      '1 SPACES @ 150',
      'S1 SLOT 40 X 10',
      'S2 SLOT 40 X 10',
      'MACHINING NOTES:',
      '1. ALL DIMENSIONS ARE IN MILLIMETERS.',
      '2. REMOVE BURRS AND BREAK SHARP EDGES.',
      '3. DO NOT SCALE DRAWING; USE NATIVE DIMENSIONS.',
      'TOP VIEW',
      'FRONT VIEW',
    ],
    independentChecks: [
      'ISO A2 landscape sheet and title block',
      '1:1 top/front view outlines and projection consistency',
      '96-hole working grid centers and diameters',
      'four mounting-hole centers, through diameters, counterbores and projected depth',
      'two closed through-slot profiles and front-view hidden projections',
      'native automatically measured dimensions with real graphics blocks',
      'standard layer separation, lineweights and linetype patterns',
      'title, revision, material, quantity, scale, feature callouts and machining notes',
      'R2013-or-newer millimeter DXF with zero audit errors and zero audit fixes',
    ],
  }
}

const requirements = manufacturingDrawingRequirements()
export const manufacturingDrawingTasks = [{
  id: 'high-density-fixture-plate-a2',
  scope: manufacturingDrawingScope,
  prompt: `Prepare an editable ISO A2 landscape manufacturing drawing for drawing JIG-300-180-A, revision A, quantity 1, titled HIGH-DENSITY MODULAR FIXTURE PLATE, material MIC6 CAST ALUMINIUM TOOLING PLATE. Use millimeters and native 1:1 geometry. The rectangular plate is 300 long (X), 180 wide (Y), and 12 thick (Z).
The working-hole grid contains exactly 8 rows by 12 columns (96 holes), diameter 5 through, first center (30,30), X spacing 22, Y spacing 17. Four mounting holes form a 2 by 2 pattern with first center (15,15), X spacing 270, Y spacing 150; each is diameter 8.5 through with a concentric diameter-14 counterbore from the top, depth 7. Add two horizontal through slots centered at (75,165) and (225,165), each overall length 40 and width 10. Do not add other machined features.
Use an ISO A2 landscape border from (0,0) to (594,420). Show a top view at drawing origin (153,77), mapped (x,y)->(153+x,77+y), and a front view looking along -Y at drawing origin (153,50), mapped (x,z)->(153+x,50+z). Both views are exactly 1:1. Show every hole and counterbore circle in the top view, center marks at every center, correct hidden through/counterbore walls and counterbore shoulders in the front view, and hidden front projections for both slots.
Use these exact layers and by-layer styles: OUTLINE continuous 0.35 mm; HIDDEN pattern [3,-1] 0.18 mm; CENTER pattern [8,-1,1,-1] 0.18 mm; DIMENSIONS continuous 0.18 mm; NOTES continuous 0.18 mm; SHEET continuous 0.25 mm. Include native automatically measured dimensions for plate length, width and thickness; each pattern through diameter and first X/Y pitch; and each slot overall length. Dimension text height is at least 3. Include title block fields for drawing ID, title, revision, material, quantity, units and scale 1:1; working-grid and mounting-hole callouts; both slot callouts; view labels; and machining notes stating millimeter units, burr removal/sharp-edge breaking, and use of native dimensions. Keep all objects editable and return no 3D solids, hatches, blocks, splines or extra geometry.`,
  expected: requirements,
}]

/** Test fixture and canonical compact intent for the KJDraw manufacturing tool. */
export function manufacturingSheetInput(expectedRevision = 0) {
  return {
    version: '1.0.0', expectedRevision, units: requirements.units,
    drawingId: requirements.drawingId, title: requirements.title,
    revision: requirements.revision, material: requirements.material,
    quantity: requirements.quantity,
    length: requirements.plate.length, width: requirements.plate.width, thickness: requirements.plate.thickness,
    holePatterns: requirements.holePatterns.map(({ id, ...pattern }) => structuredClone(pattern)),
    slots: requirements.slots.map(({ id, ...slot }) => structuredClone(slot)),
    sheet: { origin: [...requirements.sheet.origin], size: [...requirements.sheet.size] },
    textHeight: requirements.dimensionTextHeight,
  }
}
