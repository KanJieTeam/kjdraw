const fields = ['collarElevation', 'depth', 'station', 'initialWaterDepth', 'stableWaterDepth', 'strata', 'observations', 'groundwaterObservations']
function display(value, field) {
  if (value === undefined) return '—'
  if (field === 'strata' && Array.isArray(value)) return value.map(layer => layer && typeof layer === 'object' ? `${layer.intervalId ?? layer.code} · ${layer.name} · ${layer.top}–${layer.bottom} m` : String(layer)).join('\n')
  if (Array.isArray(value)) return value.map(item => JSON.stringify(item)).join('\n') || '—'
  return typeof value === 'number' ? `${value} m` : String(value)
}
/** Display source differences, never infer source data or authorize a change. */
export function geologySourceChanges(evidence) {
  const before = evidence?.beforeSource?.facts, after = evidence?.afterSource?.facts
  if (!before || !after) return []
  const previous = before.hole ? [before.hole] : Array.isArray(before.holes) ? before.holes : []
  const next = after.hole ? [after.hole] : Array.isArray(after.holes) ? after.holes : []
  return next.flatMap(hole => {
    if (!hole || typeof hole !== 'object') return []
    const original = previous.find(item => item?.id === hole.id)
    if (!original) return []
    return fields.filter(field => JSON.stringify(original[field]) !== JSON.stringify(hole[field]))
      .map(field => ({ holeId: hole.id, field, before: display(original[field], field), after: display(hole[field], field) }))
  })
}
