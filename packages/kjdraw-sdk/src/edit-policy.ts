import { KJValidationError } from './errors.js'
import type { KJObjectPayload, KJObjectSpec } from './schema.js'
import type { KJObjectPatch, KJTransaction } from './transaction.js'

const ENTITY_WRITES = new Set<PropertyKey>([
  'eraseObject', 'restoreObject', 'reparentObject', 'setXData', 'putOpaquePayload',
])

/**
 * User-facing commands honor layer editing state. The underlying document
 * transaction API deliberately remains available to importers and migrations,
 * which must be able to reconstruct drawings containing protected layers.
 * This is an editing policy, not an authorization or plugin security boundary.
 */
export function createCommandEditScope(transaction: KJTransaction, commandId: string): {
  transaction: KJTransaction
  validate(): void
} {
  let rejection: KJValidationError | null = null
  const methods = new Map<PropertyKey, unknown>()

  const assertLayerWritable = (layerId: unknown, entityId: string | null): void => {
    const effectiveLayerId = String(layerId ?? transaction._draft().tables.layers.currentId ?? '')
    const layer = transaction.getObject(effectiveLayerId)
    // Referential integrity and malformed layer records remain the document
    // validator's responsibility; do not invent an alternative layer here.
    if (!layer || layer.type !== 'LAYER') return
    const reason = layer.payload.locked === true ? 'locked'
      : layer.payload.frozen === true ? 'frozen'
        : layer.payload.visible === false ? 'hidden' : null
    if (!reason) return
    const error = new KJValidationError(
      `${commandId}: layer "${layer.name ?? layer.id}" is ${reason}; unlock, thaw or show it before editing`,
      { policy: 'layer-editability', commandId, layerId: layer.id, layerName: layer.name, entityId, reason },
    )
    rejection ??= error
    throw error
  }

  const assertEntityWritable = (id: unknown): ReturnType<KJTransaction['getObject']> => {
    const entity = transaction.getObject(String(id))
    if (entity?.kind === 'entity') assertLayerWritable(entity.payload.layerId, entity.id)
    return entity
  }

  const guarded = new Proxy(transaction, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      if (methods.has(property)) return methods.get(property)
      const method = (...args: unknown[]): unknown => {
        if (rejection) throw rejection
        if (property === 'createEntity') {
          const payload = args[1] as KJObjectPayload | undefined
          assertLayerWritable(payload?.layerId, null)
        } else if (property === 'createObject') {
          const spec = args[0] as KJObjectSpec | undefined
          if (spec?.kind === 'entity') assertLayerWritable(spec.payload?.layerId, spec.id ?? null)
        } else if (property === 'updateObject') {
          const entity = assertEntityWritable(args[0])
          const patch = args[1] as KJObjectPatch | undefined
          if (entity?.kind === 'entity' && patch?.payload && 'layerId' in patch.payload) {
            assertLayerWritable(patch.payload.layerId, entity.id)
          }
        } else if (ENTITY_WRITES.has(property)) {
          assertEntityWritable(args[0])
        }
        return Reflect.apply(value, target, args)
      }
      methods.set(property, method)
      return method
    },
  })
  return {
    transaction: guarded,
    // A custom command cannot swallow a protection error and commit only the
    // earlier members of what was requested as one transaction.
    validate() { if (rejection) throw rejection },
  }
}
