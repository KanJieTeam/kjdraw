// Original manufacturing-drawing benchmark contract. No model calls or task-specific CAD tools.
// Reference entities are test fixtures, never model answers or structural certification.
const p = (x, y) => [x, y, 0]
const line = (id, layer, a, b) => ({ id, layer, type: 'LINE', payload: { start: p(...a), end: p(...b) } })
const circle = (id, x, y, radius) => ({ id, layer: 'OUTLINE', type: 'CIRCLE', payload: { center: p(x, y), radius } })
const rectangle = (id, layer, x, y, w, h) => ({ id, layer, type: 'LWPOLYLINE', payload: { vertices: [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h)], closed: true } })
const arc = (id, x, y, startAngle, endAngle) => ({ id, layer: 'OUTLINE', type: 'ARC', payload: { center: p(x, y), radius: 4.5, startAngle, endAngle, clockwise: false } })
const dimension = (id, kind, a, b, position, value, feature) => ({ id, kind, anchors: [p(...a), p(...b)], position: p(...position), value, feature, display: 'automatic', tolerance: 1e-6 })
const rotated = (id, a, b, position, value, feature, rotationDegrees) => ({ ...dimension(id, 'ROTATED', a, b, position, value, feature), rotationDegrees })
const note = (id, text, x, y, height = 3) => ({ id, text, position: p(x, y), height })

export const engineeringDrawingScope = 'A fully specified original installation-plate manufacturing drawing with two aligned views, native dimensions, counterbores, a through slot and machining notes. This is not a load-rated design or a claim of structural/manufacturing approval. Geometry, dimension evidence and information completeness can be checked numerically; visual readability and external DXF interoperability require separate acceptance.'

export function engineeringDrawingRequirements(revision = 'A') {
  if (!['A', 'B'].includes(revision)) throw new Error('Unknown engineering drawing revision')
  const right = revision === 'A' ? 160 : 150
  const geometry = [rectangle('top-outline', 'OUTLINE', 0, 0, 180, 100), rectangle('front-outline', 'OUTLINE', 0, -45, 180, 12), rectangle('sheet-frame', 'SHEET', -45, -125, 420, 297)]
  for (const [column, x] of [[0, 20], [1, right]]) {
    for (const [row, y] of [[0, 20], [1, 80]]) {
      geometry.push(circle(`through-${column}-${row}`, x, y, 3.3), circle(`counterbore-${column}-${row}`, x, y, 5.5))
      geometry.push(line(`axis-x-${column}-${row}`, 'CENTER', [x - 8, y], [x + 8, y]), line(`axis-y-${column}-${row}`, 'CENTER', [x, y - 8], [x, y + 8]))
    }
    // Looking along -Y, the two rows coincide; draw each front projection only once.
    for (const sign of [-1, 1]) {
      geometry.push(line(`front-through-${column}-${sign}`, 'HIDDEN', [x + sign * 3.3, -45], [x + sign * 3.3, -39]))
      geometry.push(line(`front-counterbore-${column}-${sign}`, 'HIDDEN', [x + sign * 5.5, -39], [x + sign * 5.5, -33]))
      geometry.push(line(`front-step-${column}-${sign}`, 'HIDDEN', [x + sign * 3.3, -39], [x + sign * 5.5, -39]))
    }
    geometry.push(line(`front-axis-${column}`, 'CENTER', [x, -48], [x, -30]))
  }
  geometry.push(line('slot-bottom', 'OUTLINE', [80, 45.5], [100, 45.5]), line('slot-top', 'OUTLINE', [100, 54.5], [80, 54.5]), arc('slot-right', 100, 50, 1.5 * Math.PI, 0.5 * Math.PI), arc('slot-left', 80, 50, 0.5 * Math.PI, 1.5 * Math.PI))
  geometry.push(line('slot-axis', 'CENTER', [70, 50], [110, 50]), line('front-slot-left', 'HIDDEN', [75.5, -45], [75.5, -33]), line('front-slot-right', 'HIDDEN', [104.5, -45], [104.5, -33]))
  const dimensions = [
    dimension('overall-length', 'ALIGNED', [0, 100], [180, 100], [90, 140], 180, 'top-outline'),
    dimension('overall-width', 'ALIGNED', [180, 0], [180, 100], [195, 50], 100, 'top-outline'),
    dimension('plate-thickness', 'ALIGNED', [180, -45], [180, -33], [195, -39], 12, 'front-outline'),
    rotated('hole-left-x', [0, 0], [20, 20], [10, -12], 20, 'through-0-0', 0),
    rotated('hole-right-x', [0, 0], [right, 20], [right / 2, -23], right, 'through-1-0', 0),
    rotated('hole-low-y', [0, 0], [20, 20], [-12, 10], 20, 'through-0-0', 90),
    rotated('hole-high-y', [0, 0], [20, 80], [-22, 40], 80, 'through-0-1', 90),
    rotated('slot-left-center-x', [0, 100], [80, 50], [40, 122], 80, 'slot-left', 0),
    rotated('slot-center-y', [0, 0], [80, 50], [-32, 25], 50, 'slot-left', 90),
    dimension('slot-width', 'ALIGNED', [100, 45.5], [100, 54.5], [116, 50], 9, 'slot-right'),
    dimension('slot-overall-length', 'ALIGNED', [75.5, 50], [104.5, 50], [90, 68], 29, 'slot-left+slot-right'),
    dimension('through-diameter', 'DIAMETER', [16.7, 20], [23.3, 20], [43, 9], 6.6, 'through-0-0'),
    dimension('counterbore-diameter', 'DIAMETER', [14.5, 20], [25.5, 20], [43, 31], 11, 'counterbore-0-0'),
    dimension('counterbore-depth', 'ALIGNED', [25.5, -39], [25.5, -33], [40, -36], 6, 'front-counterbore-0-1'),
  ]
  const notes = [
    note('top-label', 'TOP VIEW', 0, 155, 4), note('front-label', 'FRONT VIEW - LOOKING ALONG -Y', 0, -61, 3),
    note('part-title', 'MP-01 INSTALLATION PLATE', 215, 150, 4),
    note('revision', `REV ${revision}`, 215, 138), note('material', 'MATERIAL: 6061-T6 ALUMINIUM', 215, 126),
    note('quantity', 'QUANTITY: 1', 215, 114), note('units-scale', 'ALL DIMENSIONS mm; SCALE 1:1', 215, 102),
    note('through-callout', '4X THRU DIA 6.6 +0.2/-0', 215, 86),
    note('counterbore-callout', '4X COUNTERBORE DIA 11 +0.2/-0', 215, 74),
    note('depth-callout', 'COUNTERBORE DEPTH 6 +0.1/-0 FROM TOP', 215, 62),
    note('slot-callout', 'THRU SLOT: WIDTH 9; OVERALL LENGTH 29', 215, 50),
    note('general-tolerance', 'UNLESS SPECIFIED: LINEAR +/-0.2', 215, 34),
    note('position-tolerance', 'HOLE CENTER X AND Y: +/-0.05', 215, 22),
    note('deburr', 'DEBURR; BREAK SHARP EDGES C0.2', 215, 10),
    note('finish', 'NO COATING; MACHINED SURFACES', 215, -2),
    note('authority', 'BENCHMARK DESIGN; NOT LOAD RATED', 215, -18),
  ]
  return {
    units: 'millimeter', revision, drawingId: 'MP-01', geometryTolerance: 1e-6,
    design: { length: 180, width: 100, thickness: 12, holeX: [20, right], holeY: [20, 80], throughDiameter: 6.6, counterboreDiameter: 11, counterboreDepth: 6, slotCenters: [[80, 50], [100, 50]], slotRadius: 4.5 },
    views: [{ id: 'top', mapping: '(x,y,z=12) -> (x,y)' }, { id: 'front', mapping: '(x,y,z) -> (x,z-45), looking along -Y; coincident projected edges drawn once' }],
    layers: [
      { name: 'OUTLINE', pattern: [], lineweight: 35 }, { name: 'HIDDEN', pattern: [3, -1], lineweight: 18 },
      { name: 'CENTER', pattern: [8, -1, 1, -1], lineweight: 18 }, { name: 'DIMENSIONS', pattern: [], lineweight: 18 },
      { name: 'NOTES', pattern: [], lineweight: 18 }, { name: 'SHEET', pattern: [], lineweight: 25 },
    ],
    geometry, dimensions, notes,
    independentChecks: ['two-view geometry and projection consistency', 'hole and counterbore centers/diameters/depth', 'through-slot shape and projection', 'native dimension anchors and geometric measurement, not display text alone', 'required machining/material/tolerance/revision notes', 'hidden/center line conventions and layer separation', 'revision B updates both views and the hole-X dimension while preserving all other requirements'],
    deferredChecks: ['visual legibility, annotation collisions and print/read scale', 'independent DXF parse, units and zero-repair audit', 'structural suitability and manufacturing-process approval'],
  }
}

const initial = engineeringDrawingRequirements('A')
const noteInstructions = initial.notes.map(item => `"${item.text}" at (${item.position[0]},${item.position[1]}), height ${item.height}`).join('; ')
const dimInstructions = initial.dimensions.map(item => `${item.id}: ${item.kind}${item.kind === 'ROTATED' ? ` angle ${item.rotationDegrees} degrees` : ''}, endpoints (${item.anchors[0].slice(0, 2)}) and (${item.anchors[1].slice(0, 2)}), value ${item.value}, text/placement (${item.position.slice(0, 2)})`).join('; ')
export const engineeringDrawingTasks = [{
  id: 'installation-plate-two-view', scope: engineeringDrawingScope,
  prompt: `Prepare an editable manufacturing drawing for original part MP-01, revision A, quantity 1, material 6061-T6 aluminium. This is a supplied benchmark design, not a load-rated or structurally certified design. Use millimeters and 1:1 geometry. The plate is 180 long (X), 100 wide (Y), 12 thick (Z). Its plan spans X=0..180,Y=0..100; bottom Z=0, top Z=12. Four through holes have diameter 6.6 at (20,20),(160,20),(160,80),(20,80). At the top face each has a concentric diameter-11 counterbore, depth 6, so its floor is Z=6. The through slot has radius-4.5 end centers (80,50) and (100,50), width 9 and overall length 29. There are no other machined features.
Show two aligned orthographic views: top in original XY, and front looking along -Y, mapped (X,Z) to drawing (X,Z-45). Top outline corners are (0,0),(180,0),(180,100),(0,100); front outline corners (0,-45),(180,-45),(180,-33),(0,-33). Show all hole/counterbore circles in top view. The slot has horizontal tangents at Y=45.5 and 54.5 between X=80 and 100, plus the outer end semicircles. In front view the two hole rows coincide: draw each projected feature once. For each X=20 and 160, hidden through-hole walls are X+/-3.3 from drawing Y=-45 to -39; counterbore walls are X+/-5.5 from -39 to -33; show floor shoulders connecting these walls at -39. Hidden slot boundaries are X=75.5 and 104.5 from -45 to -33. Hole center crosses extend 8 each way in top view; front hole axes extend Y=-48..-30; slot centerline spans (70,50)..(110,50).
Use OUTLINE continuous lineweight 0.35 mm, HIDDEN dash pattern [3,-1] lineweight 0.18 mm, CENTER pattern [8,-1,1,-1] lineweight 0.18 mm, DIMENSIONS and NOTES continuous 0.18 mm, and SHEET continuous 0.25 mm. Draw a 420 by 297 border at (-45,-125)..(375,172). Use native, automatically measured DIMENSION objects, not numbers drawn over unrelated geometry. All required dimensions: ${dimInstructions}. Closed outlines may use straight polylines or equivalent connected lines. Dimension units are millimeters; dimension/annotation text is at least 3 high.
Place these exact notes (spacing/case variations are acceptable): ${noteInstructions}. The specified manufacturing tolerances are notes, not permission to change nominal model geometry. Keep all objects editable. Do not add unrequested holes, fillets, chamfers modeled as extra edges, structural claims or a 3D solid.`,
  requirements: initial,
  modification: { id: 'move-right-hole-column', prompt: 'Create revision B: move the right column of both through holes and concentric counterbores from X=160 to X=150, keeping Y=20 and 80. Update the front projection, center marks/axes, and the right-hole X dimension from 160 to 150. Change REV A to REV B. Preserve the plate, left column, slot, all diameters/depths, tolerances, material and other dimensions.', requirements: engineeringDrawingRequirements('B') },
}]

/** Reference only, for validator/tool conformance tests; never put these entities into model input. */
export function referenceEngineeringDrawingEntities(revision = 'A') {
  const requirements = engineeringDrawingRequirements(revision)
  return [
    ...requirements.geometry.map(({ type, payload, layer }) => ({ type, payload: structuredClone(payload), layerName: layer })),
    ...requirements.dimensions.map(item => ({ type: 'DIMENSION', layerName: 'DIMENSIONS', payload: { dimensionType: item.kind, definitionPoints: item.kind === 'DIAMETER' ? item.anchors : [item.position, ...item.anchors], textPosition: item.position, measurement: item.value, textHeight: 3, rotation: (item.rotationDegrees ?? 0) * Math.PI / 180 } })),
    ...requirements.notes.map(item => ({ type: 'TEXT', layerName: 'NOTES', payload: { text: item.text, position: item.position, height: item.height, rotation: 0 } })),
  ]
}

/** Independent arithmetic checks on actual CAD dimension evidence, not cached measurement or prose.
 * Entity IDs are intentionally not used: callers bind evidence to requirements by anchor geometry.
 * This small checker is not the future DXF/visual validator; missing dimensions remain failures.
 */
export function validateEngineeringDimensions(entities, requirements = initial) {
  const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= requirements.geometryTolerance
  const pointNear = (a, b) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((v, i) => near(v, b[i]))
  const remaining = entities.filter(entity => entity.type === 'DIMENSION').slice()
  const checks = requirements.dimensions.map(item => {
    const index = remaining.findIndex(({ payload }) => {
      const anchors = payload.dimensionType === 'DIAMETER' ? payload.definitionPoints?.slice(0, 2) : payload.definitionPoints?.slice(1, 3)
      return payload.dimensionType === item.kind && anchors?.length === 2 && ((pointNear(anchors[0], item.anchors[0]) && pointNear(anchors[1], item.anchors[1])) || (pointNear(anchors[1], item.anchors[0]) && pointNear(anchors[0], item.anchors[1])))
    })
    if (index < 0) return { id: item.id, passed: false, reason: 'missing-native-dimension-with-required-anchors' }
    const { payload } = remaining.splice(index, 1)[0]
    const points = item.kind === 'DIAMETER' ? payload.definitionPoints.slice(0, 2) : payload.definitionPoints.slice(1, 3)
    const dx = points[1][0] - points[0][0], dy = points[1][1] - points[0][1]
    const actual = item.kind === 'ROTATED' ? Math.abs(dx * Math.cos(payload.rotation ?? 0) + dy * Math.sin(payload.rotation ?? 0)) : Math.hypot(dx, dy, points[1][2] - points[0][2])
    const automatic = payload.textOverride === undefined || payload.textOverride === null || payload.textOverride === '' || payload.textOverride === '<>'
    return { id: item.id, actual, expected: item.value, passed: automatic && near(actual, item.value) && (payload.measurement == null || near(payload.measurement, actual)), reason: automatic ? 'geometry-and-cache-check' : 'nonautomatic-dimension-text' }
  })
  return { passed: checks.every(check => check.passed) && remaining.length === 0, checks, extraDimensions: remaining.length }
}

/** Test-only input for the generic annotated tool. Layer resources/styles are supplied separately
 * by the host conformance harness; this geometry/annotation fixture alone is not full acceptance.
 */
export function referenceAnnotatedInput(revision = 'A', expectedRevision = 0) {
  const r = engineeringDrawingRequirements(revision), groups = { lines: [], circles: [], arcs: [], polylines: [] }, refs = new Map()
  for (const entity of r.geometry) {
    const { payload } = entity
    const group = { LINE: 'lines', CIRCLE: 'circles', ARC: 'arcs', LWPOLYLINE: 'polylines' }[entity.type]
    refs.set(entity.id, `${group}:${groups[group].length}`)
    groups[group].push(entity.type === 'LINE' ? [...payload.start.slice(0, 2), ...payload.end.slice(0, 2)] : entity.type === 'CIRCLE' ? [...payload.center.slice(0, 2), payload.radius] : entity.type === 'ARC' ? [...payload.center.slice(0, 2), payload.radius, payload.startAngle * 180 / Math.PI, payload.endAngle * 180 / Math.PI] : { points: payload.vertices.map(v => v.slice(0, 2)), closed: payload.closed })
  }
  const findPoint = point => {
    const same = value => value.every((v, i) => Math.abs(v - point[i]) < 1e-6)
    for (const entity of r.geometry) {
      const source = { source: 'proposal', id: refs.get(entity.id) }, payload = entity.payload
      if (entity.type === 'LINE') {
        for (const feature of ['start', 'end']) if (same(payload[feature])) return { ...source, feature }
      } else if (entity.type === 'LWPOLYLINE') {
        const vertexIndex = payload.vertices.findIndex(same)
        if (vertexIndex >= 0) return { ...source, feature: 'vertex', vertexIndex }
      } else {
        if (same(payload.center)) return { ...source, feature: 'center' }
        for (const [feature, dx, dy] of [['left', -1, 0], ['right', 1, 0], ['bottom', 0, -1], ['top', 0, 1]]) {
          if (!same([payload.center[0] + dx * payload.radius, payload.center[1] + dy * payload.radius, 0])) continue
          if (entity.type === 'ARC') {
            const turn = 2 * Math.PI, angle = (Math.atan2(dy, dx) + turn) % turn
            if ((angle - payload.startAngle + turn) % turn > (payload.endAngle - payload.startAngle + turn) % turn + 1e-12) continue
          }
          return { ...source, feature }
        }
      }
    }
    throw new Error(`Reference fixture has no real geometry anchor at ${point}`)
  }
  const input = { expectedRevision, units: r.units, ...groups, arrays: [], texts: r.notes.map(n => ({ text: n.text, position: { x: n.position[0], y: n.position[1] }, height: n.height, rotationDegrees: 0 })), alignedDimensions: [], rotatedDimensions: [], radiusDimensions: [], diameterDimensions: [] }
  for (const d of r.dimensions) {
    const placement = { position: { x: d.position[0], y: d.position[1] }, height: 3 }
    if (d.kind === 'DIAMETER') input.diameterDimensions.push({ source: { source: 'proposal', id: refs.get(d.feature) }, directionDegrees: 0, ...placement })
    else input[d.kind === 'ROTATED' ? 'rotatedDimensions' : 'alignedDimensions'].push({ from: findPoint(d.anchors[0]), to: findPoint(d.anchors[1]), ...placement, ...(d.kind === 'ROTATED' ? { rotationDegrees: d.rotationDegrees } : {}) })
  }
  input.styles = r.layers.map(layer => ({ name: layer.name, sources: [
    ...r.geometry.filter(entity => entity.layer === layer.name).map(entity => refs.get(entity.id)),
    ...(layer.name === 'NOTES' ? input.texts.map((_, i) => `texts:${i}`) : []),
    ...(layer.name === 'DIMENSIONS' ? ['alignedDimensions', 'rotatedDimensions', 'radiusDimensions', 'diameterDimensions'].flatMap(group => input[group].map((_, i) => `${group}:${i}`)) : []),
  ], pattern: [...layer.pattern], color: 7, lineweight: layer.lineweight }))
  return input
}
