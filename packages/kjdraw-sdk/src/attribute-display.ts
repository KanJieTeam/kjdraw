import type { KJDocument } from './document.js'
import type { KJReadonlyObjectRecord } from './schema.js'
import { KJValidationError } from './errors.js'

/** Attached attributes occupy their INSERT's owner space, not its definition space. */
export function isAttachedAttribute(entity: KJReadonlyObjectRecord): boolean {
  return entity.type === 'ATTRIB' && typeof entity.payload.parentInsertId === 'string' && entity.payload.parentInsertId.length > 0
}
export function attributeHidden(entity: KJReadonlyObjectRecord): boolean {
  return (entity.type === 'ATTRIB' || entity.type === 'ATTDEF') && (Number(entity.payload.flags ?? 0) & 1) !== 0
}
export function insertAttributes(document: KJDocument, insert: KJReadonlyObjectRecord): readonly KJReadonlyObjectRecord[] {
  const ids = insert.payload.attributeIds
  if (ids == null) return []
  if (!Array.isArray(ids) || ids.length > 4096 || new Set(ids).size !== ids.length) throw new KJValidationError('Invalid or oversized INSERT attribute list')
  return ids.map(id => {
    const attribute = typeof id === 'string' ? document.getObject(id) : null
    if (!attribute || attribute.erased || attribute.kind !== 'entity' || attribute.type !== 'ATTRIB' || attribute.ownerId !== insert.ownerId || attribute.payload.parentInsertId !== insert.id) throw new KJValidationError('INSERT attribute reference does not belong to the same owner and parent')
    return attribute
  })
}
export function visibleAttribute(document: KJDocument, attribute: KJReadonlyObjectRecord): boolean {
  const layer = document.getObject(String(attribute.payload.layerId ?? ''))?.payload
  return !attributeHidden(attribute) && attribute.payload.visible !== false && layer?.visible !== false && layer?.frozen !== true
}
