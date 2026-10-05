import type { KJDocument } from './document.js'

/** Source-neutral structure, block-definition and paper-entity comparison for regenerated mechanical sheets.
 * Model entities, geometry and pixels must be audited separately. */
export function auditMechanicalSheetStructure(source: KJDocument, candidate: KJDocument) {
  const named = (document: KJDocument, ids: readonly string[]) => new Map(ids.map(id => document.getObject(id)).filter(record => record && !record.erased).map(record => [String(record!.name), record!] as const))
  const sourceLayouts = named(source, source.snapshot().spaces.layoutIds), candidateLayouts = named(candidate, candidate.snapshot().spaces.layoutIds)
  const sourceLayers = named(source, source.getTable('layers')!.records.filter(record => !record.erased).map(record => record.id))
  const candidateLayers = named(candidate, candidate.getTable('layers')!.records.filter(record => !record.erased).map(record => record.id))
  const reusableBlocks = (document: KJDocument) => {
    const spaces = new Set([document.spaces.modelSpaceId, ...document.snapshot().spaces.layoutIds.map(id => String(document.getObject(id)?.payload.blockRecordId ?? ''))])
    return named(document, document.getTable('blockRecords')!.records.filter(record => !record.erased && record.payload.isSpace !== true && !spaces.has(record.id)).map(record => record.id))
  }
  const sourceBlocks = reusableBlocks(source), candidateBlocks = reusableBlocks(candidate)
  const fields = (a: Record<string, unknown>, b: Record<string, unknown>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key])).length
  const entityTypes = (document: KJDocument, owner: unknown) => {
    const counts: Record<string, number> = {}
    if (typeof owner === 'string') for (const entity of document.listEntities({ ownerId: owner })) counts[entity.type] = (counts[entity.type] ?? 0) + 1
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
  }
  const normalizeReferences = (document: KJDocument, value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) return value.map(item => normalizeReferences(document, item, key))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => [name, normalizeReferences(document, item, name)]))
    if (typeof value === 'string' && (key === 'layerId' || key === 'linetypeId' || key === 'styleId' || key === 'blockRecordId' || key === 'frozenLayerIds')) {
      const record = document.getObject(value)
      return record?.name == null ? value : `${record.kind}:${record.name}`
    }
    return value
  }
  const ownedEntities = (document: KJDocument, owner: unknown) =>
    typeof owner === 'string'
      ? document.listEntities({ ownerId: owner }).map(entity => JSON.stringify({ type: entity.type, payload: normalizeReferences(document, entity.payload) })).sort()
      : []
  const layouts = { source: sourceLayouts.size, candidate: candidateLayouts.size, missing: 0, extra: 0, plotFields: 0, paperEntityTypes: 0, paperEntitySemantics: 0, viewportFields: 0 }
  const layers = { source: sourceLayers.size, candidate: candidateLayers.size, missing: 0, extra: 0, fields: 0 }
  const blocks = { source: sourceBlocks.size, candidate: candidateBlocks.size, missing: 0, extra: 0, definitionFields: 0, entityTypes: 0, entitySemantics: 0 }
  for (const [name, original] of sourceLayouts) {
    const generated = candidateLayouts.get(name)
    if (!generated) { layouts.missing++; continue }
    layouts.plotFields += fields(original.payload.dxfPlotSettings as Record<string, unknown> ?? {}, generated.payload.dxfPlotSettings as Record<string, unknown> ?? {})
    if (JSON.stringify(entityTypes(source, original.payload.blockRecordId)) !== JSON.stringify(entityTypes(candidate, generated.payload.blockRecordId))) layouts.paperEntityTypes++
    if (JSON.stringify(ownedEntities(source, original.payload.blockRecordId)) !== JSON.stringify(ownedEntities(candidate, generated.payload.blockRecordId))) layouts.paperEntitySemantics++
    const before = Array.isArray(original.payload.viewportIds) ? original.payload.viewportIds : [], after = Array.isArray(generated.payload.viewportIds) ? generated.payload.viewportIds : []
    layouts.viewportFields += Math.abs(before.length - after.length)
    for (let index = 0; index < Math.min(before.length, after.length); index++) layouts.viewportFields += fields(normalizeReferences(source, source.getObject(String(before[index]))?.payload ?? {}) as Record<string, unknown>, normalizeReferences(candidate, candidate.getObject(String(after[index]))?.payload ?? {}) as Record<string, unknown>)
  }
  for (const name of candidateLayouts.keys()) if (!sourceLayouts.has(name)) layouts.extra++
  for (const [name, original] of sourceLayers) {
    const generated = candidateLayers.get(name)
    if (!generated) { layers.missing++; continue }
    layers.fields += fields(normalizeReferences(source, original.payload) as Record<string, unknown>, normalizeReferences(candidate, generated.payload) as Record<string, unknown>)
  }
  for (const name of candidateLayers.keys()) if (!sourceLayers.has(name)) layers.extra++
  const definition = (document: KJDocument, payload: Record<string, unknown>) => normalizeReferences(document, Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'entityIds'))) as Record<string, unknown>
  for (const [name, original] of sourceBlocks) {
    const generated = candidateBlocks.get(name)
    if (!generated) { blocks.missing++; continue }
    blocks.definitionFields += fields(definition(source, original.payload), definition(candidate, generated.payload))
    if (JSON.stringify(entityTypes(source, original.id)) !== JSON.stringify(entityTypes(candidate, generated.id))) blocks.entityTypes++
    if (JSON.stringify(ownedEntities(source, original.id)) !== JSON.stringify(ownedEntities(candidate, generated.id))) blocks.entitySemantics++
  }
  for (const name of candidateBlocks.keys()) if (!sourceBlocks.has(name)) blocks.extra++
  return { passed: layouts.missing + layouts.extra + layouts.plotFields + layouts.paperEntityTypes + layouts.paperEntitySemantics + layouts.viewportFields + layers.missing + layers.extra + layers.fields + blocks.missing + blocks.extra + blocks.definitionFields + blocks.entityTypes + blocks.entitySemantics === 0, layouts, layers, blocks }
}
