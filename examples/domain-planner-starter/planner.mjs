// Pure domain facts -> bounded CAD intent. No SDK internals or model prompt.
export function planBoltCircle({ center, pitchDiameter, holeDiameter, count }) {
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    center.some((value) => !Number.isFinite(value))
  ) {
    throw new TypeError('center must be two finite coordinates')
  }
  if (!Number.isInteger(count) || count < 3 || count > 24) {
    throw new RangeError('count must be an integer from 3 to 24')
  }
  if (
    !Number.isFinite(pitchDiameter) ||
    pitchDiameter <= 0 ||
    !Number.isFinite(holeDiameter) ||
    holeDiameter <= 0
  ) {
    throw new RangeError('diameters must be positive finite drawing units')
  }
  const pitchRadius = pitchDiameter / 2
  const minimumCenterSpacing = pitchDiameter * Math.sin(Math.PI / count)
  if (holeDiameter >= minimumCenterSpacing) {
    throw new RangeError('holes must not touch or overlap')
  }
  return Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count
    return {
      center: [
        center[0] + pitchRadius * Math.cos(angle),
        center[1] + pitchRadius * Math.sin(angle),
        0,
      ],
      radius: holeDiameter / 2,
    }
  })
}
