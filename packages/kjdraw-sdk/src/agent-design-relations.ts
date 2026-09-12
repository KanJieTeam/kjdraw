import type { KJDocument } from './document.js'
import { readDesignRelations } from './design-relations.js'
import { KJValidationError } from './errors.js'

/** Bounded discovery excludes binding expressions and full geometry from model context. */
export function createAgentDesignContext(document: KJDocument, offset: number, limit: number, maxBytes: number): Record<string, unknown> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 262144) throw new KJValidationError('Invalid design context page or byte budget')
  const records = Object.values(document.snapshot().objects).filter(record => !record.erased && record.kind === 'custom' && record.type === 'DESIGN_RELATIONS')
  const result: Record<string, unknown> = { documentId: document.id, revision: document.revision, units: document.snapshot().header.units, designs: [], total: records.length, nextOffset: null, truncatedByBytes: false, firstRowTooLarge: false }
  const rows = result.designs as Record<string, unknown>[]
  let consumed = offset
  for (const record of records.slice(offset, offset + limit)) {
    const design = readDesignRelations(document, [record.id])[0]!
    const row = { id: design.id, name: design.name, units: design.units, parameters: design.definition.parameters,
      derived: Object.fromEntries(design.definition.derived.map(parameter => [parameter.name, design.values[parameter.name]])),
      entityIds: design.entityIds, driftedEntityIds: design.driftedEntityIds }
    rows.push(row); result.nextOffset = consumed + 1 < records.length ? consumed + 1 : null
    if (new TextEncoder().encode(JSON.stringify({ ok: true, value: result })).length > maxBytes) {
      rows.pop(); result.nextOffset = consumed; result.truncatedByBytes = true; result.firstRowTooLarge = rows.length === 0; break
    }
    consumed++
  }
  if (new TextEncoder().encode(JSON.stringify({ ok: true, value: result })).length > maxBytes) throw new KJValidationError('Design context metadata exceeds the byte budget')
  return result
}
