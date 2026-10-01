import { displayedEntityBounds } from '../../../packages/kjdraw-sdk/src/selection-geometry.js'

const floorLabel = /^\s*\d{1,3}\s*(?:F|层)\s*$/i

const center = bounds => [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
const area = bounds => (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
const inside = (inner, outer, tolerance = 0) =>
  inner[0] >= outer[0] - tolerance && inner[1] >= outer[1] - tolerance &&
  inner[2] <= outer[2] + tolerance && inner[3] <= outer[3] + tolerance

/**
 * Spatial hints, never semantic authority. A floor label inside a closed outline
 * gives the host a reviewable candidate; it does not establish ownership.
 */
export function inspectBuildingCandidates(document) {
  const entities = document.listEntities({ ownerId: document.spaces.modelSpaceId })
  const bounded = entities.map(entity => ({ entity, bounds: displayedEntityBounds(document, entity) }))
    .filter(item => item.bounds && item.bounds.every(Number.isFinite))
  const outlines = bounded.filter(({ entity, bounds }) =>
    entity.type === 'LWPOLYLINE' && entity.payload.closed === true &&
    entity.payload.vertices.length >= 4 && bounds[2] - bounds[0] >= 6 &&
    bounds[3] - bounds[1] >= 5 && area(bounds) >= 60)
  const candidates = new Map()
  for (const { entity: label, bounds: textBounds } of bounded) {
    if (label.type !== 'TEXT' || !floorLabel.test(String(label.payload.text ?? ''))) continue
    const [x,y] = center(textBounds)
    const matching = outlines.filter(({ bounds }) =>
      x >= bounds[0] - 2 && x <= bounds[2] + 2 &&
      y >= bounds[1] - 2 && y <= bounds[3] + 2).sort((a,b) => area(a.bounds) - area(b.bounds))
    const outline = matching[0]
    if (!outline) continue
    const key = outline.bounds.map(value => Math.round(value * 10)).join(':')
    const existing = candidates.get(key)
    if (existing) { existing.labels.push(String(label.payload.text).trim()); continue }
    const ids = bounded.filter(item => inside(item.bounds, outline.bounds, 0.025)).map(item => item.entity.id)
    // A sheet border or site boundary may contain floor text but is not one building.
    if (ids.length > 64) continue
    candidates.set(key, {
      bounds: outline.bounds, center: center(outline.bounds),
      labels: [String(label.payload.text).trim()],
      ids, outlineColor: outline.entity.payload.color ?? null,
    })
  }
  return [...candidates.values()].sort((a,b) => b.bounds[3] - a.bounds[3] || a.center[0] - b.center[0])
}

// A tall outline can share the upper edge of a row while its center is much
// lower. Expose edge alignment as geometry evidence, never as a semantic row
// selector or permission to erase. The scale-relative band is anchored at an
// extreme edge: close neighbors cannot chain into a much wider band.
function extremeEdgeBands(candidates) {
  if (!candidates.length) return null
  const spanMedian = axis => {
    const spans = candidates.map(candidate => candidate.bounds[axis + 2] - candidate.bounds[axis])
      .filter(span => Number.isFinite(span) && span > 0).sort((a,b) => a - b)
    const middle = Math.floor(spans.length / 2)
    return spans.length % 2 ? spans[middle] : (spans[middle - 1] + spans[middle]) / 2
  }
  const band = (edge, direction, axis) => {
    const anchor = direction === 'maximum'
      ? Math.max(...candidates.map(candidate => candidate.bounds[edge]))
      : Math.min(...candidates.map(candidate => candidate.bounds[edge]))
    const tolerance = spanMedian(axis) * 0.12
    return { edge: ['minX', 'minY', 'maxX', 'maxY'][edge], anchor, tolerance,
      indices: candidates.flatMap((candidate, index) =>
        Math.abs(candidate.bounds[edge] - anchor) <= tolerance ? [index] : []) }
  }
  return {
    top: band(3, 'maximum', 1), bottom: band(1, 'minimum', 1),
    left: band(0, 'minimum', 0), right: band(2, 'maximum', 0),
    rule: 'Within 12% of the median outline span of the extreme edge; geometric hint only, not a confirmed row or ownership group.',
  }
}

export function describeBuildingCandidates(document, limit = 32) {
  const candidates = inspectBuildingCandidates(document)
  if (!candidates.length) return ''
  const boundedLimit = Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, 32) : 32
  const summary = candidates.slice(0,boundedLimit).map((candidate, index) => ({
    index,
    label: candidate.labels.join('/'),
    center: candidate.center.map(value => Number(value.toFixed(2))),
    bounds: candidate.bounds.map(value => Number(value.toFixed(2))),
    containedObjects: candidate.ids.length,
  }))
  return 'Spatial building candidates inferred from floor labels inside closed outlines; these are not confirmed ownership groups. '
    + 'These indices are only spatial hints, not entity IDs. Call cad_query_spatial_candidates for exact member IDs, '
    + 'then cad_query_impact before any structural edit. The model must choose targets from the user request; '
    + 'ask for clarification only if the target is genuinely ambiguous. Candidate centers and bounds use native drawing coordinates: '
    + JSON.stringify({ total: candidates.length, returned: summary.length, truncated: summary.length < candidates.length,
      indexOrder: 'Descending maxY, then ascending centerX. This is not left-to-right row order.',
      coordinateAxes: 'Increasing X is right; increasing Y is up. Centers and upper/lower edges are distinct evidence.',
      extremeEdgeBands: extremeEdgeBands(candidates), candidates: summary })
}

/** Read-only spatial index exposed to the model. It never chooses an action or edits. */
export function queryBuildingCandidates(document, { expectedRevision, indices } = {}) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== document.revision) {
    return { ok: false, error: { code: 'CAD_STALE_REVISION', message: 'Read the current drawing revision and retry.' } }
  }
  if (!Array.isArray(indices) || indices.length < 1 || indices.length > 8 ||
      indices.some(index => !Number.isSafeInteger(index) || index < 0) ||
      new Set(indices).size !== indices.length) {
    return { ok: false, error: { code: 'CAD_INVALID_QUERY', message: 'Supply 1–8 unique nonnegative candidate indices.' } }
  }
  const all = inspectBuildingCandidates(document)
  if (indices.some(index => index >= all.length)) {
    return { ok: false, error: { code: 'CAD_INVALID_QUERY', message: 'Candidate index is outside the current spatial index.' } }
  }
  return { ok: true, value: {
    expectedRevision, total: all.length, returned: indices.length,
    completeInventory: indices.length === all.length,
    extremeEdgeBands: extremeEdgeBands(all), candidates: indices.map(index => {
      const candidate = all[index]
      return {
        index, label: candidate.labels.join('/'), center: candidate.center,
        bounds: candidate.bounds, memberIds: candidate.ids,
        note: 'Floor-label/outline proximity is a candidate only; inspect and review member geometry.',
      }
    }),
  } }
}
