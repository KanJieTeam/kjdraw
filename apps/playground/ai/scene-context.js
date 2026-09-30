import { displayedEntityBounds } from '../../../packages/kjdraw-sdk/src/selection-geometry.js'

const floorLabel = /^\s*\d{1,3}\s*(?:F|层)\s*$/i
const deleteIntent = /删除|删掉|移除|擦除|清除|\b(?:delete|erase|remove)\b/i
const topIntent = /顶部|最上方|上方|上面|\btop\b/i
const countThree = /三|\b3\b|\bthree\b/i
const leftIntent = /左侧|左边|从左|靠左|\bleft\b/i
const rightIntent = /右侧|右边|从右|靠右|\bright\b/i

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

export function describeBuildingCandidates(document, limit = 16) {
  const candidates = inspectBuildingCandidates(document)
  if (!candidates.length) return ''
  const summary = candidates.slice(0,limit).map(candidate => ({
    label: candidate.labels.join('/'),
    center: candidate.center.map(value => Number(value.toFixed(2))),
    bounds: candidate.bounds.map(value => Number(value.toFixed(2))),
    containedObjects: candidate.ids.length,
  }))
  return 'Spatial building candidates inferred from floor labels inside closed outlines; these are not confirmed ownership groups. '
    + 'Do not erase by label alone. Use CAD read/query/impact tools and request clarification if candidates overlap or the count is ambiguous: '
    + JSON.stringify(summary)
}

/** Resolve a narrow, unambiguous "top three buildings" request without a model guessing IDs. */
export function resolveTopBuildingRemoval(document, request) {
  if (!deleteIntent.test(request) || !topIntent.test(request) || !countThree.test(request) || !/楼|栋|建筑|building/i.test(request)) return null
  const english = !/[\u3400-\u9fff]/.test(request)
  const all = inspectBuildingCandidates(document)
  if (all.length < 3) return { status: 'clarify', text: english
    ? 'I could not reliably identify three separate top-row building outlines. The drawing was not changed. Please specify their labels.'
    : '图纸中未能可靠识别顶部三栋楼的独立轮廓，未修改图纸。请提供楼栋名称或编号。' }
  const top = all[0].bounds[3]
  const heights = all.map(item => item.bounds[3] - item.bounds[1]).sort((a,b) => a-b)
  const rowTolerance = Math.max(3, heights[Math.floor(heights.length/2)] * 0.25)
  const row = all.filter(item => top - item.bounds[3] <= rowTolerance).sort((a,b) => a.center[0] - b.center[0])
  if (row.length < 3) return { status: 'clarify', text: english
    ? 'Fewer than three buildings could be identified in the top row. The drawing was not changed. Please specify building labels.'
    : '顶部同一排不足三栋可识别的楼，未修改图纸。请说明要修改的楼栋名称。' }
  const fromLeft = leftIntent.test(request)
  const fromRight = rightIntent.test(request)
  if (row.length > 3 && fromLeft === fromRight) {
    const labels = row.map((item,index) => String(index + 1) + '. ' + item.labels.join('/') )
    return { status: 'clarify', text: english
      ? 'I found ' + row.length + ' top-row building candidates (left to right: ' + labels.join(', ') +
        '), not exactly three. Say “delete the leftmost three top buildings” or name the buildings. The drawing was not changed.'
      : '顶部同一排识别到 ' + row.length + ' 栋候选（从左到右：' + labels.join('、') +
        '），不是恰好三栋。请说“删顶部从左数三栋”或指出具体楼栋；图纸未修改。' }
  }
  const selected = fromRight ? row.slice(-3) : row.slice(0,3)
  const ids = [...new Set(selected.flatMap(item => item.ids))]
  if (ids.length < 3 || ids.length > 64) return { status: 'clarify', text: english
    ? 'The candidates contain ' + ids.length + ' objects, outside the safe single-proposal range. The drawing was not changed. Narrow the target buildings.'
    : '候选楼栋涉及 ' + ids.length + ' 个对象，超出安全自动提案范围；图纸未修改。请进一步限定楼栋。' }
  return { status: 'proposal', ids, buildings: selected.map(item => ({
    label: item.labels.join('/'), bounds: item.bounds, containedObjects: item.ids.length,
  })) }
}
