// Original synthetic example; units are millimeters. This is drawing geometry,
// not a verified mechanical design or a provider-generated answer.
export function mountingProfile(expectedRevision = 0) {
  return {
    expectedRevision, units: 'millimeter',
    lines: [
      { start: { x: 50, y: 25 }, end: { x: 70, y: 25 } },
      { start: { x: 70, y: 35 }, end: { x: 50, y: 35 } },
    ],
    circles: [[10, 10], [110, 10], [110, 50], [10, 50]].map(([x, y]) => ({ center: { x, y }, radius: 3 })),
    arcs: [
      { center: { x: 70, y: 30 }, radius: 5, startDegrees: 270, endDegrees: 90 },
      { center: { x: 50, y: 30 }, radius: 5, startDegrees: 90, endDegrees: 270 },
    ],
    polylines: [{ vertices: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 0, y: 60 }], closed: true }],
  }
}
