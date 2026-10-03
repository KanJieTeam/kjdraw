import { KJRevisionConflictError, KJValidationError } from './errors.js'
import { createCommandEditScope } from './edit-policy.js'
import { clone, deepFreeze, stableHash } from './utils.js'
import { previewPlanarBoundaries, type KJPlanarBoundaryRequest, type KJPlanarBoundaryPreview } from './planar-boundaries.js'
import type { KJContourBackendOptions } from './geometry/contour-wasm.js'
import type { KJDocument } from './document.js'
import type { KJCommandEnvelopeContext } from './commands.js'
import type { KJObjectPayload, KJReadonlyObjectRecord } from './schema.js'

export interface KJPlanarBoundaryEditRequest extends KJPlanarBoundaryRequest {
  /** Required digest from the complete, read-only boundary preview. */
  readonly expectedGeometryDigest: string
}
export interface KJPlanarBoundaryApplyOptions extends KJContourBackendOptions {
  readonly author?: unknown
  readonly commandEnvelope?: KJCommandEnvelopeContext | null
}
export interface KJPlanarBoundaryEditResult extends KJPlanarBoundaryPreview {
  readonly resultIds: readonly string[]
  readonly revisionAfter: number
}

const STYLE_KEYS = ['layerId', 'color', 'trueColor', 'linetypeId', 'linetypeName', 'linetypeScale', 'lineweight', 'transparency', 'visible'] as const
function fields(input: unknown, allowed: readonly string[], label: string): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new KJValidationError(`${label} must be a plain data object`)
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !('value' in descriptor)) throw new KJValidationError(`${label} contains an unsupported field or accessor`)
  }
}
function sourceStyle(entity: KJReadonlyObjectRecord, currentLayer: string | null): KJObjectPayload {
  const result = Object.fromEntries(STYLE_KEYS.filter(key => entity.payload[key] !== undefined).map(key => [key, clone(entity.payload[key])]))
  if (result.layerId === undefined && currentLayer !== null) result.layerId = currentLayer
  return result
}

/** Create reviewed native boundaries, retaining every source entity unchanged. */
export async function applyPlanarBoundaryExtraction(document: KJDocument, input: KJPlanarBoundaryEditRequest, options: KJPlanarBoundaryApplyOptions = {}): Promise<KJPlanarBoundaryEditResult> {
  fields(input, ['ids', 'units', 'expectedRevision', 'tolerance', 'expectedGeometryDigest'], 'Boundary edit request')
  if (typeof input.expectedGeometryDigest !== 'string' || !input.expectedGeometryDigest || input.expectedGeometryDigest.length > 128) throw new KJValidationError('Boundary extraction requires the reviewed geometry digest')
  fields(options, ['wasmBytes', 'wasmUrl', 'author', 'commandEnvelope'], 'Boundary apply options')
  const { author, commandEnvelope, ...backendOptions } = options
  if (commandEnvelope != null) fields(commandEnvelope, ['id', 'schema', 'schemaVersion', 'origin'], 'Boundary command envelope')
  const { expectedGeometryDigest, ...request } = input
  const preview = await previewPlanarBoundaries(document, request, backendOptions)
  if (!preview.complete || preview.diagnostics.length || !preview.contours.length) throw new KJValidationError('Boundary extraction is incomplete; resolve the reported geometry before applying', { diagnostics: clone(preview.diagnostics) })
  if (preview.receipt.geometryDigest !== expectedGeometryDigest) throw new KJValidationError('Boundary geometry differs from the reviewed preview')
  if (document.revision !== preview.revisionBefore) throw new KJRevisionConflictError(preview.revisionBefore, document.revision)
  const entities = preview.sourceIds.map(id => document.getObject(id))
  if (entities.some(entity => !entity || entity.kind !== 'entity' || entity.erased) || stableHash(entities) !== preview.sourceDigest) throw new KJValidationError('Boundary sources changed before commit')
  const sources = entities as KJReadonlyObjectRecord[]
  const state = document.toJSON(), ownerId = sources[0]!.ownerId
  const byId = new Map(sources.map(entity => [entity.id, entity]))
  for (const entity of sources) {
    if (entity.ownerId !== ownerId) throw new KJValidationError('Boundary extraction requires one owner')
    const layer = document.getObject(sourceStyle(entity, state.tables.layers.currentId).layerId!)
    if (!layer || layer.type !== 'LAYER' || layer.payload.locked === true || layer.payload.frozen === true || layer.payload.visible === false || entity.payload.visible === false) throw new KJValidationError('Boundary sources require visible, thawed, unlocked layers and entities')
  }
  const styles = preview.contours.map(contour => {
    const style = sourceStyle(byId.get(contour.sourceIds[0]!)!, state.tables.layers.currentId)
    if (!style.layerId || contour.sourceIds.some(id => stableHash(sourceStyle(byId.get(id)!, state.tables.layers.currentId)) !== stableHash(style))) throw new KJValidationError('Each boundary requires a valid layer and compatible source styles')
    return style
  })
  const resultIds = await document.transact('Create reviewed planar boundaries', transaction => {
    if (stableHash(preview.sourceIds.map(id => transaction.getObject(id))) !== preview.sourceDigest) throw new KJValidationError('Boundary sources changed inside the commit')
    const scope = createCommandEditScope(transaction, 'CONTOURBOUNDARIES')
    const ids = preview.contours.map((contour, index) => scope.transaction.createEntity('LWPOLYLINE', {
      ...clone(styles[index]!), closed: true, elevation: 0, normal: [0, 0, 1],
      vertices: contour.vertices.map(vertex => ({ point: vertex.point.map(value => value === 0 ? 0 : value), bulge: vertex.bulge ? vertex.bulge : 0, startWidth: 0, endWidth: 0 })),
    }, { ownerId, source: {
      derivedFromIds: [...contour.sourceIds], boundarySegments: clone(contour.segments),
      boundaryDepth: contour.depth, boundaryHole: contour.hole,
      geometryDigest: preview.receipt.geometryDigest,
    } }).id)
    scope.validate()
    return ids
  }, {
    expectedRevision: preview.revisionBefore, author, source: 'command:CONTOURBOUNDARIES',
    metadata: {
      commandId: 'CONTOURBOUNDARIES', sourceIds: [...preview.sourceIds], geometryReceipt: clone(preview.receipt),
      commandEnvelopeId: commandEnvelope?.id ?? null,
      commandProtocol: commandEnvelope ? `${commandEnvelope.schema}@${commandEnvelope.schemaVersion}` : null,
      commandOrigin: commandEnvelope?.origin ?? null,
    },
  })
  return deepFreeze({ ...preview, resultIds, revisionAfter: preview.revisionBefore + 1 }) as KJPlanarBoundaryEditResult
}
