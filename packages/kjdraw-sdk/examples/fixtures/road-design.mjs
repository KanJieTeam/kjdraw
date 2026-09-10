// Original, explicitly tabulated study data. No model output, surveyed site, or construction approval.
// Both alignment spans are exactly 300 m; offsets increase toward the left of increasing station.
const terrainRows = [
  [0,   98.8, 99.1, 99.2, 99.0, 98.9, 98.8, 98.6],
  [50,  99.0, 99.2, 99.3, 99.4, 99.6, 99.7, 99.9],
  [100, 100.1, 100.4, 100.7, 100.9, 101.0, 101.1, 101.4],
  [150, 103.4, 103.2, 103.0, 102.8, 102.6, 102.3, 102.0],
  [200, 104.8, 104.6, 104.3, 104.1, 103.9, 103.7, 103.5],
  [250, 102.9, 103.1, 103.3, 103.5, 103.6, 103.8, 104.0],
  [300, 99.8, 100.0, 100.3, 100.5, 100.7, 100.9, 101.1],
  [350, 99.5, 99.7, 99.9, 100.0, 100.2, 100.4, 100.7],
  [400, 102.0, 102.2, 102.4, 102.5, 102.6, 102.8, 103.0],
  [450, 106.5, 106.2, 106.0, 105.8, 105.6, 105.4, 105.1],
  [500, 105.8, 105.6, 105.4, 105.2, 105.0, 104.8, 104.5],
  [550, 102.1, 102.4, 102.6, 102.8, 103.0, 103.2, 103.5],
  [600, 101.7, 102.0, 102.2, 102.4, 102.6, 102.8, 103.1],
]

/** Fresh serializable input, safe to give to either comparison arm without compiled CAD answers. */
export function createRoadDesignFixture() {
  const offsets = [-25, -12, -5, 0, 5, 12, 25]
  return {
    units: 'meter', startStation: 0,
    alignment: [[450000, 3300000], [450300, 3300000], [450480, 3300240]],
    profile: [{ station: 0, elevation: 100 }, { station: 150, elevation: 102 }, { station: 300, elevation: 101.5 }, { station: 450, elevation: 104 }, { station: 600, elevation: 103.5 }],
    sections: terrainRows.map(([station, ...elevations]) => ({ station, ground: offsets.map((offset, i) => [offset, elevations[i]]) })),
    pavement: { leftWidth: 3.5, rightWidth: 3.5, leftCrossfall: -.025, rightCrossfall: -.025 },
    slopes: { cutHtoV: 1, fillHtoV: 1.5 },
  }
}

/** Model-space diagram settings, not a paper layout or a road-standard design prescription. */
export const roadDrawingFixtureOptions = Object.freeze({
  drawingId: 'access-road-study', title: 'Access road - original tabulated study',
  profileScale: Object.freeze({ horizontal: .5, vertical: 8 }),
  sectionScale: Object.freeze({ horizontal: 2, vertical: 3 }),
  textHeight: 3, sectionColumns: 2, precision: 3,
})
