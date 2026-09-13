import { KJRegistrationError, KJValidationError } from './errors.js'
import { validatePlotSettings } from './plot-settings.js'
import { createCommandEditScope } from './edit-policy.js'
import { applyRoadDrawingRevision } from './road-drawing-update.js'
import { createDesignRelations, updateDesignRelations } from './design-relations.js'
import { editHatch } from './hatch-edit.js'
import { insertCatalogComponent, searchComponentCatalog } from './component-library.js'
import type { KJRoadDrawingResult } from './road-drawing.js'
import {
  entityArea2,
  entityLength2,
  distance2,
  dot2,
  invert3,
  multiply3,
  reflectionAcrossLine3,
  rotationAround3,
  scaleAround3,
  transformEntityPayload,
  transformPoint3,
  translation3,
  vec2,
  subtract2,
} from './geometry/index.js'
import { clone, deepFreeze, normalizeName, stableHash } from './utils.js'
import type { ReadonlyDeep } from './utils.js'
import { editEntityGrip } from './grips.js'
import type { KJPointInput } from './grips.js'
import { migrateBreakDimensionAssociations, migrateCircleBreakDimensionAssociations, migratePolylineDimensionAssociations, normalizeDimensionAssociations, refreshAssociativeDimensions, requireAssociativeDimensionSourceIdentity } from './dimension-associations.js'
import { intersectEntityPair2, nearestPointOnEntity2 } from './snapping.js'
import { KJ_SNAP_MODES } from './snapping.js'
import type { KJDocument, KJDocumentHistoryOptions, KJDocumentTransactionOptions } from './document.js'
import type { KJSelectionManager } from './selection.js'
import { selectEntitiesByProperty } from './selection.js'
import type { KJSelectionProperty, KJSelectionPropertyOperator } from './selection.js'
import type { KJObjectPatch, KJTableRecordInput, KJTransaction } from './transaction.js'
import type {
  KJObjectPayload,
  KJObjectRecord,
  KJObjectSpec,
  KJReadonlyObjectRecord,
} from './schema.js'
import type { KJTableName } from './constants.js'
import type { AffineMatrix3, AffineMatrix3Input, Point3 } from './geometry/index.js'
import {
  breakEntityPayloads,
  chamferLinePair,
  editPolylinePayload,
  explodeEntity,
  extendEntityPayload,
  filletLinePair,
  joinEntityPayloads,
  lengthenEntityPayload,
  offsetEntityPayload,
  resolvePolylineEditLocation,
  stretchEntityPayload,
  trimEntityPayloads,
} from './editing.js'
import type { KJLinePairEditResult, KJLinePairOptions } from './editing.js'

export interface KJCommandEnvelopeContext {
  readonly id?: unknown
  readonly schema?: unknown
  readonly schemaVersion?: unknown
  readonly origin?: unknown
}

export interface KJSolidSerialization extends Record<string, unknown> {
  validation?: { readonly valid?: boolean }
}

export interface KJSolidSession {
  readonly volume: number
  serialize(): KJSolidSerialization
  transform(matrix: unknown): KJSolidSession
  boolean(other: KJSolidSession, operation: unknown): KJSolidSession
  validate(): unknown
  close(): void
}

export interface KJSolidAuthority extends Record<string, unknown> {
  readonly authoritative: true
  openMesh(input: { vertices: unknown; triangles: unknown }): KJSolidSession
}

export interface KJCommandSDKContext {
  readonly solidAuthority?: unknown
  getSelectionManager(documentId?: string | null): KJSelectionManager | null
}

export interface KJCommandContext {
  readonly sdk: KJCommandSDKContext
  readonly document: KJDocument
  readonly transaction: KJTransaction
  readonly author?: unknown
  readonly expectedRevision?: number
  readonly commandEnvelope?: KJCommandEnvelopeContext | null
  readonly events?: unknown
  readonly extensions?: unknown
  /** Registry definition reviewed by a caller before an asynchronous execution boundary. */
  readonly expectedDefinition?: KJRegisteredCommand
}

export type KJCommandInputContext = Partial<KJCommandContext>

export interface KJEntityBatchSpec extends Record<string, unknown> {
  type?: string
  payload?: KJObjectPayload
  options?: KJObjectSpec
  layerName?: string
  layer?: {
    color?: unknown
    visible?: unknown
    frozen?: unknown
    locked?: unknown
    plottable?: unknown
  }
}

export interface KJEntityBatchResources {
  linetypes: { id: string; name: string; pattern: number[] }[]
  layers: { id: string; name: string; color: number; linetypeId: string; lineweight: number }[]
}

export interface KJBlockAttributeDefinitionInput {
  readonly tag: string
  readonly prompt?: string
  readonly defaultValue?: string | number | boolean
  readonly position?: KJPointInput
  readonly height?: number
  readonly rotation?: number
  readonly flags?: number
  readonly layerId?: string
}

/**
 * Extensible command argument bag. Known core fields are typed for editor and
 * framework consumers; third-party commands may add names through the index
 * signature without weakening the SDK through an untyped escape hatch.
 */
export interface KJCommandArguments extends Record<string, unknown> {
  resources?: KJEntityBatchResources
  id?: string
  ids?: readonly string[]
  firstId?: string
  secondId?: string
  boundaryIds?: readonly string[]
  ownerId?: string | null
  layerId?: string
  layoutId?: string
  layoutName?: string
  blockRecordId?: string
  name?: string
  newName?: string | null
  type?: string
  operation?: string
  operator?: string
  mode?: string
  query?: string
  property?: string
  status?: string
  referenceType?: string
  componentId?: string
  version?: string
  locale?: string
  category?: string
  cursor?: string | number
  gripId?: string
  sha256?: string | null
  checkedAt?: unknown
  author?: unknown
  value?: unknown
  source?: unknown
  other?: unknown
  otherDocument?: unknown
  payload?: KJObjectPayload
  patch?: KJObjectPatch
  properties?: KJObjectPayload
  options?: KJObjectSpec
  payloadPatch?: KJObjectPayload
  connectorPayloadPatch?: KJObjectPayload
  entities?: readonly KJEntityBatchSpec[]
  modes?: readonly string[]
  kinds?: readonly string[]
  types?: readonly string[]
  boundaryLoops?: unknown
  vertices?: readonly KJPointInput[]
  sourceIds?: readonly string[]
  loopIndex?: unknown
  attributes?: unknown
  attributeValues?: Readonly<Record<string, unknown>>
  attributeDefinitions?: readonly KJBlockAttributeDefinitionInput[]
  mappings?: unknown
  pattern?: unknown
  settings?: Record<string, unknown>
  parameters?: unknown
  position?: unknown
  insertionPoint?: unknown
  center?: KJPointInput
  basePoint?: KJPointInput
  from?: KJPointInput
  to?: KJPointInput
  start?: KJPointInput
  end?: KJPointInput
  lineStart?: KJPointInput
  lineEnd?: KJPointInput
  point?: KJPointInput
  firstPoint?: KJPointInput
  secondPoint?: KJPointInput
  firstVector?: KJPointInput
  secondVector?: KJPointInput
  vertex?: KJPointInput
  pickPoint?: KJPointInput
  sidePoint?: KJPointInput
  points?: readonly KJPointInput[]
  origin?: unknown
  xAxis?: unknown
  yAxis?: unknown
  viewCenter?: unknown
  frozenLayerIds?: readonly string[]
  matrix?: unknown
  scale?: unknown
  factor?: unknown
  angle?: unknown
  angleDegrees?: unknown
  rotation?: unknown
  radius?: unknown
  distance?: unknown
  tolerance?: unknown
  segmentIndex?: unknown
  vertexIndex?: unknown
  bulge?: unknown
  sweepDegrees?: unknown
  distance1?: unknown
  distance2?: unknown
  dx?: unknown
  dy?: unknown
  rows?: unknown
  columns?: unknown
  rowSpacing?: unknown
  columnSpacing?: unknown
  count?: unknown
  items?: unknown
  width?: unknown
  height?: unknown
  viewHeight?: unknown
  twistAngle?: unknown
  patternScale?: unknown
  patternAngle?: unknown
  color?: unknown
  lineweight?: unknown
  linetypeId?: unknown
  fontFamily?: unknown
  fontFile?: unknown
  bigFontFile?: unknown
  fixedHeight?: unknown
  widthFactor?: unknown
  obliqueAngle?: unknown
  current?: unknown
  description?: unknown
  patternName?: unknown
  enabled?: unknown
  visible?: unknown
  frozen?: unknown
  locked?: unknown
  plottable?: unknown
  solid?: unknown
  append?: unknown
  keepSource?: unknown
  eraseSource?: unknown
  eraseSources?: unknown
  includeErased?: unknown
  includeSource?: unknown
  rotateItems?: unknown
  selectable?: unknown
  side?: unknown
  limit?: unknown
  maxDefinitionEntities?: unknown
  maxBlockDepth?: unknown
  maxExpandedEntities?: unknown
}

export interface KJCommandDefinition {
  readonly id: string
  readonly title?: string
  readonly aliases?: readonly string[]
  readonly transactional?: boolean
  readonly capabilities?: Record<string, unknown>
  readonly execute: (context: KJCommandContext, args: KJCommandArguments) => unknown | Promise<unknown>
  readonly canExecute?: (context: KJCommandInputContext, args: KJCommandArguments) => boolean | Promise<boolean>
}

export interface KJRegisteredCommand extends KJCommandDefinition {
  readonly owner: string
  readonly aliases: readonly string[]
  readonly capabilities: ReadonlyDeep<Record<string, unknown>>
}

const AFFINE_ENTITY_TYPES = Object.freeze([
  'LINE', 'RAY', 'XLINE', 'POINT', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE',
  'WIPEOUT', 'REVISION_CLOUD', 'SPLINE', 'ELLIPSE', 'TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB', 'INSERT',
  'IMAGE', 'HATCH', 'LEADER', 'MLEADER', 'DIMENSION', 'VIEWPORT',
  'SOLID', 'TRACE', 'TABLE',
])

/**
 * Exact, machine-readable scope of the built-in command implementations.
 * A command being registered never implies that it supports every entity type.
 */
export const KJ_CORE_COMMAND_CAPABILITIES = deepFreeze({
  UNDO: { domain: 'history' },
  REDO: { domain: 'history' },
  SELECT: { domain: 'selection', operations: ['replace', 'add', 'remove', 'clear'] },
  SELECTIONSAVE: { domain: 'selection', persistence: 'document-dictionary' },
  SELECTIONRESTORE: { domain: 'selection', persistence: 'document-dictionary' },
  CREATE: { domain: 'entity', supportedEntityTypes: '*' },
  CREATEBATCH: { domain: 'entity', supportedEntityTypes: '*', atomic: true, maximumEntities: 100000 },
  ROAD_DRAWING_UPDATE: { domain: 'road-drawing', atomic: true, stableIds: true, requiresUnmodifiedPrevious: true },
  ERASE: { domain: 'object', supportedObjectKinds: '*' },
  RESTORE: { domain: 'object', supportedObjectKinds: '*' },
  PROPERTIES: { domain: 'object', supportedObjectKinds: '*' },
  SETVAR: { domain: 'document' },
  LAYERNEW: { domain: 'layer' },
  LAYERCURRENT: { domain: 'layer' },
  LAYERUPDATE: { domain: 'layer' },
  LAYERDELETE: { domain: 'layer', guard: 'referential-integrity' },
  MOVE: { domain: 'geometry', precision: 'exact', supportedEntityTypes: AFFINE_ENTITY_TYPES },
  ROTATE: { domain: 'geometry', precision: 'exact', supportedEntityTypes: AFFINE_ENTITY_TYPES },
  SCALE: { domain: 'geometry', precision: 'exact-uniform', supportedEntityTypes: AFFINE_ENTITY_TYPES },
  COPY: { domain: 'geometry', precision: 'exact', supportedEntityTypes: AFFINE_ENTITY_TYPES },
  MIRROR: { domain: 'geometry', precision: 'exact', supportedEntityTypes: AFFINE_ENTITY_TYPES },
  ARRAYRECT: { domain: 'geometry', precision: 'exact', supportedEntityTypes: AFFINE_ENTITY_TYPES },
  ARRAYPOLAR: { domain: 'geometry', precision: 'exact', supportedEntityTypes: AFFINE_ENTITY_TYPES },
  OFFSET: { domain: 'geometry', precision: 'exact', supportedEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'] },
  BREAK: { domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE'], deterministicPieces: true },
  JOIN: { domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE', 'ARC', 'LWPOLYLINE', 'POLYLINE'], maximumEntities: 4096 },
  EXPLODE: { domain: 'topology', precision: 'exact', supportedEntityTypes: ['LWPOLYLINE', 'POLYLINE', 'REVISION_CLOUD', 'WIPEOUT'] },
  TRIM: { domain: 'topology', precision: 'exact', targetEntityTypes: ['LINE', 'ARC', 'CIRCLE', 'ELLIPSE'], boundaryEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'] },
  EXTEND: { domain: 'topology', precision: 'exact', targetEntityTypes: ['LINE', 'ARC'], boundaryEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'] },
  LENGTHEN: { domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE', 'ARC'], modes: ['TOTAL', 'DELTA', 'PERCENT', 'DYNAMIC'], stableIdentity: true },
  STRETCH: { domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE', 'LWPOLYLINE', 'POLYLINE'], selection: 'crossing-window', maximumEntities: 4096, stableIdentity: true },
  PEDIT: { domain: 'topology', precision: 'exact', supportedEntityTypes: ['LWPOLYLINE', 'POLYLINE'], operations: ['INSERT', 'DELETE', 'SET_BULGE', 'SET_WIDTH'], stableIdentity: true },
  CHAMFER: { domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE'] },
  FILLET: { domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE'] },
  GRIPEDIT: { domain: 'geometry', precision: 'exact', supportedEntityTypes: AFFINE_ENTITY_TYPES },
  LENGTH: { domain: 'measurement', exactEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'ELLIPSE', 'SOLID', 'TRACE'], approximateEntityTypes: ['SPLINE'] },
  AREA: { domain: 'measurement', exactEntityTypes: ['CIRCLE', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE', 'SOLID', 'TRACE'] },
  DISTANCE: { domain: 'measurement', precision: 'exact', modes: ['point-point', 'point-entity'], supportedEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE'] },
  ANGLE: { domain: 'measurement', precision: 'exact', modes: ['vectors', 'three-points'] },
  INTERSECT: { domain: 'geometry-query', precision: 'exact', supportedEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE'] },
  NEAREST: { domain: 'geometry-query', precision: 'exact', supportedEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE'] },
  ORTHO: { domain: 'drafting-settings', systemVariable: 'ORTHOMODE' },
  POLAR: { domain: 'drafting-settings', systemVariables: ['POLARMODE', 'POLARANG'] },
  SNAPSETTINGS: { domain: 'drafting-settings', snapModes: KJ_SNAP_MODES },
  BLOCKCREATE: { domain: 'block', precision: 'exact', supportedEntityTypes: AFFINE_ENTITY_TYPES },
  BLOCKINSERT: { domain: 'block', entityType: 'INSERT' },
  COMPONENTSEARCH: { domain: 'component-library', operation: 'search', catalog: 'readonly', pagination: 'cursor', maximumResults: 50 },
  COMPONENTINSERT: { domain: 'component-library', operation: 'insert', entityType: 'INSERT', definitionType: 'BLOCK_RECORD', atomic: true, maximumDefinitionEntities: 64 },
  BLOCKINSTANCEUPDATE: { domain: 'block', scope: 'single-instance', entityType: 'INSERT', stableIdentity: true },
  BLOCKDEFINITIONUPDATE: { domain: 'block', scope: 'shared-definition', stableIdentity: true },
  XREFATTACH: { domain: 'external-reference', authority: 'local-file-or-project-asset', remoteUrls: false },
  XREFRELOAD: { domain: 'external-reference', authority: 'local-file-or-project-asset' },
  XREFDETACH: { domain: 'external-reference' },
  GROUP: { domain: 'group', persistence: 'document-dictionary' },
  DESIGNCREATE: { domain: 'design-relations', persistence: 'document-dictionary', atomic: true, maximumEntities: 64 },
  DESIGNUPDATE: { domain: 'design-relations', atomic: true, stableIdentity: true, requiresUnmodifiedGeometry: true },
  HATCH: { domain: 'entity', entityType: 'HATCH', boundaryModes: ['polyline', 'line-arc-edges'] },
  HATCHEDIT: { domain: 'entity', entityType: 'HATCH', operations: ['update-pattern', 'add-island', 'replace-island', 'remove-island'], stableIdentity: true },
  LEADER: { domain: 'annotation', entityType: 'LEADER', annotationType: 'MTEXT', atomic: true, maximumVertices: 4096 },
  LEADEREDIT: { domain: 'annotation', entityType: 'LEADER', annotationType: 'MTEXT', atomic: true, stableIdentity: true },
  LINETYPE: { domain: 'table', table: 'linetypes', operations: ['create', 'update'] },
  TEXTSTYLE: { domain: 'table', table: 'textStyles', operations: ['create', 'update', 'set-current'] },
  DIMSTYLE: { domain: 'table', table: 'dimensionStyles', operations: ['create', 'update', 'set-current'] },
  UCS: { domain: 'table', table: 'ucs', operations: ['create', 'update', 'set-current'] },
  LAYOUT: { domain: 'layout', operations: ['create', 'set-current', 'update'] },
  VIEWPORT: { domain: 'layout', entityType: 'VIEWPORT', operations: ['create', 'update'] },
  PLOTSETUP: { domain: 'plot', persistence: 'layout', devices: ['pdf', 'printer', 'png'] },
  PLOTSTYLE: { domain: 'plot', persistence: 'document-resource' },
  SEARCH: { domain: 'document-query', fields: ['id', 'handle', 'kind', 'type', 'name', 'payload', 'xdata'] },
  COMPARE: { domain: 'document-query', identity: 'cad-handle', classifications: ['added', 'removed', 'changed', 'unchanged'] },
  SOLIDBOX: { domain: 'solid3d', authority: 'kjcore-rust-wasm', operation: 'primitive' },
  SOLIDCYLINDER: { domain: 'solid3d', authority: 'kjcore-rust-wasm', operation: 'primitive' },
  SOLIDCONE: { domain: 'solid3d', authority: 'kjcore-rust-wasm', operation: 'primitive' },
  SOLIDSPHERE: { domain: 'solid3d', authority: 'kjcore-rust-wasm', operation: 'primitive' },
  SOLIDSWEEP: { domain: 'solid3d', authority: 'kjcore-rust-wasm', operation: 'sweep', profile: 'convex' },
  SOLIDLOFT: { domain: 'solid3d', authority: 'kjcore-rust-wasm', operation: 'loft', profile: 'matched-convex' },
  SOLIDTRANSFORM: { domain: 'solid3d', authority: 'kjcore-rust-wasm', operation: 'matrix4' },
  SOLIDBOOLEAN: { domain: 'solid3d', authority: 'kjcore-rust-wasm', operations: ['union', 'intersection', 'difference'], exactScope: 'axis-aligned-box' },
  SOLIDVALIDATE: { domain: 'solid3d-analysis', authority: 'kjcore-rust-wasm', checks: ['finite', 'degenerate-triangles', 'boundary-edges', 'non-manifold-edges', 'edge-orientation', 'signed-volume'] },
  SOLIDVOLUME: { domain: 'solid3d-analysis', authority: 'kjcore-rust-wasm', precision: 'exact-mesh' },
})

export class KJCommandRegistry {
  #commands = new Map<string, KJRegisteredCommand>()

  register(definition: KJCommandDefinition, { owner = 'application', replace = false }: { owner?: string; replace?: boolean } = {}): () => boolean {
    const id = String(definition?.id ?? '').trim().toUpperCase()
    if (!id || typeof definition?.execute !== 'function') throw new KJRegistrationError('Command requires id and execute')
    if (this.#commands.has(id) && !replace) throw new KJRegistrationError(`Command already registered: ${id}`)
    const commandBase = {
      title: id,
      transactional: true,
      aliases: [],
      capabilities: {},
      ...definition,
    }
    const command = deepFreeze({
      ...commandBase,
      id,
      aliases: (definition.aliases ?? []).map(value => String(value).toUpperCase()),
      capabilities: clone(definition.capabilities ?? (KJ_CORE_COMMAND_CAPABILITIES as Readonly<Record<string, unknown>>)[id] ?? {}),
      owner: String(owner),
    }) as KJRegisteredCommand
    const keys = [id, ...command.aliases]
    const conflict = keys.find(key => this.#commands.has(key) && !replace)
    if (conflict) throw new KJRegistrationError(`Command or alias already registered: ${conflict}`)
    for (const key of keys) this.#commands.set(key, command)
    return () => {
      let removed = false
      for (const [key, value] of this.#commands) if (value === command) { this.#commands.delete(key); removed = true }
      return removed
    }
  }

  resolve(id: unknown): KJRegisteredCommand | null { return this.#commands.get(String(id).trim().toUpperCase()) ?? null }
  list(): KJRegisteredCommand[] { return [...new Set(this.#commands.values())] }

  removeOwner(owner: unknown): number {
    const targets = new Set([...this.#commands.values()].filter(command => command.owner === owner))
    for (const [key, command] of this.#commands) if (targets.has(command)) this.#commands.delete(key)
    return targets.size
  }

  async execute(id: unknown, context: KJCommandInputContext = {}, args: KJCommandArguments = {}): Promise<unknown> {
    const command = this.resolve(id)
    if (!command) throw new KJValidationError(`Unknown command: ${id}`)
    if (context.expectedDefinition && command !== context.expectedDefinition) throw new KJValidationError(`Command changed before execution: ${command.id}`)
    // Explicit resource batches are a strict data boundary. Check before clone can
    // invoke accessors or normalize unusual object/array properties away.
    if (command.id === 'CREATEBATCH' && command.owner === '@kanjieteam/kjdraw' && Object.hasOwn(args, 'resources')) validateCommandData(args)
    if (command.id === 'ROAD_DRAWING_UPDATE' && command.owner === '@kanjieteam/kjdraw') validateCommandData(args, 'ROAD_DRAWING_UPDATE')
    if (command.transactional === false) {
      if (command.canExecute && !await command.canExecute(context, clone(args))) throw new KJValidationError(`Command is not available: ${command.id}`)
      return command.execute({ ...context, transaction: null } as unknown as KJCommandContext, clone(args))
    }
    if (!context.document) throw new KJValidationError(`Command ${command.id} requires a document`)
    return context.document.transact(command.title ?? command.id, async transaction => {
      return this.executeRegisteredInTransaction(command, { ...context, transaction } as KJCommandContext, args)
    }, {
      author: context.author,
      source: `command:${command.id}`,
      expectedRevision: context.expectedRevision,
      metadata: {
        commandId: command.id,
        ...(['TRIM', 'EXTEND'].includes(command.id) ? { commandArgumentsDigest: stableHash(args) } : {}),
        commandEnvelopeId: context.commandEnvelope?.id ?? null,
        commandProtocol: context.commandEnvelope ? `${context.commandEnvelope.schema}@${context.commandEnvelope.schemaVersion}` : null,
        commandOrigin: context.commandEnvelope?.origin ?? null,
      },
    } as KJDocumentTransactionOptions)
  }

  /**
   * Trusted orchestration hook for composing one already-resolved transactional
   * command with other document-owned records in the caller's transaction.
   * It deliberately accepts an exact registered definition rather than a model
   * supplied command name, and preserves the normal edit-scope enforcement.
   */
  async executeRegisteredInTransaction(command: KJRegisteredCommand, context: KJCommandContext, args: KJCommandArguments = {}): Promise<unknown> {
    if (!command || this.resolve(command.id) !== command) throw new KJValidationError('Command changed before transactional composition')
    if (command.transactional === false) throw new KJValidationError(`Command cannot be composed transactionally: ${command.id}`)
    if (!context.document || !context.transaction) throw new KJValidationError(`Command ${command.id} requires a document transaction`)
    if (command.id === 'CREATEBATCH' && command.owner === '@kanjieteam/kjdraw' && Object.hasOwn(args, 'resources')) validateCommandData(args)
    if (command.id === 'ROAD_DRAWING_UPDATE' && command.owner === '@kanjieteam/kjdraw') validateCommandData(args, 'ROAD_DRAWING_UPDATE')
    if (command.canExecute && !await command.canExecute(context, clone(args))) throw new KJValidationError(`Command is not available: ${command.id}`)
    const scope = createCommandEditScope(context.transaction, command.id)
    const result = await command.execute({ ...context, transaction: scope.transaction }, clone(args))
    scope.validate()
    return result
  }
}

export function registerCoreCommands(registry: KJCommandRegistry): () => void {
  const disposers: Array<() => boolean> = []
  disposers.push(registry.register({
    id: 'ROAD_DRAWING_UPDATE', title: 'Update road drawing', transactional: false,
    execute: ({ document, expectedRevision }, args) => {
      if (!document) throw new KJValidationError('ROAD_DRAWING_UPDATE requires a document')
      if (Object.keys(args).length !== 2 || !Object.hasOwn(args, 'previous') || !Object.hasOwn(args, 'next')) throw new KJValidationError('ROAD_DRAWING_UPDATE requires exactly previous and next compiled drawings')
      return applyRoadDrawingRevision(document, args.previous as KJRoadDrawingResult, args.next as KJRoadDrawingResult, { expectedRevision: expectedRevision ?? document.revision })
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'UNDO', aliases: ['U'], title: 'Undo', transactional: false,
    execute: ({ document, expectedRevision }, args) => document.undo({ author: args.author, source: 'command:UNDO', expectedRevision } as KJDocumentHistoryOptions),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'REDO', title: 'Redo', transactional: false,
    execute: ({ document, expectedRevision }, args) => document.redo({ author: args.author, source: 'command:REDO', expectedRevision } as KJDocumentHistoryOptions),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'SELECT', title: 'Update selection', transactional: false,
    execute: ({ sdk, document }, args) => {
      const selection = sdk.getSelectionManager(document.id)?.active
      if (!selection) throw new KJValidationError('Selection manager is unavailable')
      const ids = args.ids ?? (args.id == null ? [] : [args.id])
      const operation = String(args.operation ?? 'replace').toLowerCase()
      if (operation === 'replace') selection.replace(ids)
      else if (operation === 'add') selection.add(ids)
      else if (operation === 'remove') selection.remove(ids)
      else if (operation === 'clear') selection.clear()
      else throw new KJValidationError(`Unknown selection operation: ${operation}`)
      return selection.ids
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'SELECTBYPROPERTY', aliases: ['QSELECT'], title: 'Select entities by property', transactional: false,
    execute: ({ sdk, document }, args) => {
      const selection = sdk.getSelectionManager(document.id)?.active
      if (!selection) throw new KJValidationError('Selection manager is unavailable')
      const ids = selectEntitiesByProperty(document, {
        property: args.property as KJSelectionProperty,
        value: args.value as string | number,
        ...(args.operator == null ? {} : { operator: args.operator as KJSelectionPropertyOperator }),
      })
      const operation = String(args.operation ?? 'replace').toLowerCase()
      if (operation === 'replace') selection.replace(ids)
      else if (operation === 'add') selection.add(ids)
      else if (operation === 'remove') selection.remove(ids)
      else throw new KJValidationError(`Unknown selection operation: ${operation}`)
      return selection.ids
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'SELECTIONSAVE', title: 'Save named selection', transactional: false,
    execute: ({ sdk, document }, args) => {
      const manager = sdk.getSelectionManager(document.id)
      if (!manager) throw new KJValidationError('Selection manager is unavailable')
      return manager.saveNamed(args.name!, { ids: args.ids ?? manager.active.ids, description: args.description })
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'SELECTIONRESTORE', title: 'Restore named selection', transactional: false,
    execute: ({ sdk, document }, args) => {
      const manager = sdk.getSelectionManager(document.id)
      if (!manager) throw new KJValidationError('Selection manager is unavailable')
      return manager.loadNamed(args.name!, { append: Boolean(args.append) }).ids
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'CREATE', title: 'Create entity',
    execute: ({ document, transaction }, args) => {
      const type = normalizeName(args.type)
      const payload = { ...(args.payload ?? {}) }
      const currentTextStyleId = document.getTable('textStyles')?.currentId
      if (['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].includes(type) && payload.styleId === undefined && currentTextStyleId) payload.styleId = currentTextStyleId
      const currentDimensionStyleId = document.getTable('dimensionStyles')?.currentId
      if (type === 'DIMENSION' && payload.styleId === undefined && currentDimensionStyleId) {
        payload.styleId = currentDimensionStyleId
        payload.styleName = document.getObject(currentDimensionStyleId)?.name ?? 'STANDARD'
      }
      return transaction.createEntity(type, payload, args.options)
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'CREATEBATCH', title: 'Create entity batch',
    execute: (context, args) => createEntityBatch(context, args),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'ERASE', aliases: ['DELETE'], title: 'Erase objects',
    execute: ({ document, transaction }, args) => compoundRootIds(document, (args.ids ?? [args.id]).filter(Boolean).map(String)).map(id => transaction.eraseObject(id)),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'RESTORE', title: 'Restore objects',
    execute: ({ document, transaction }, args) => compoundRootIds(document, (args.ids ?? [args.id]).filter(Boolean).map(String)).map(id => transaction.restoreObject(id)),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'PROPERTIES', title: 'Update object properties',
    execute: ({ document, transaction }, args) => {
      validateDrawingPropertiesPatch(document, args.patch)
      if (args.ids == null) {
        assertGenericPropertyBoundary(document, args.id, args.patch)
        const updated = transaction.updateObject(args.id!, args.patch)
        refreshAssociativeDimensions(transaction, [updated.id])
        return updated
      }
      if (args.id != null) throw new KJValidationError('PROPERTIES accepts either id or ids, not both')
      if (!Array.isArray(args.ids) || !args.ids.length) throw new KJValidationError('Batch PROPERTIES requires at least one entity id')
      if (args.ids.length > 4096) throw new KJValidationError('Batch PROPERTIES supports at most 4096 entities')
      if (!args.patch || !Object.keys(args.patch).length) throw new KJValidationError('Batch PROPERTIES requires a non-empty patch')
      const ids = [...new Set(args.ids.map(String))]
      for (const id of ids) {
        const object = document.getObject(id)
        if (!object || object.kind !== 'entity') throw new KJValidationError(`Batch PROPERTIES entity does not exist: ${id}`)
        assertGenericPropertyBoundary(document, id, args.patch)
      }
      const updated = ids.map(id => transaction.updateObject(id, args.patch))
      refreshAssociativeDimensions(transaction, ids)
      return updated
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'SETVAR', title: 'Set system variable',
    execute: ({ transaction }, args) => transaction.setSystemVariable(args.name!, args.value),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'ORTHO', title: 'Set orthogonal drafting mode',
    execute: ({ transaction }, args) => {
      const enabled = !(args.enabled === false || Number(args.enabled) === 0)
      transaction.setSystemVariable('ORTHOMODE', enabled ? 1 : 0)
      if (enabled) transaction.setSystemVariable('POLARMODE', 0)
      return { enabled }
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'POLAR', title: 'Set polar tracking mode',
    execute: ({ document, transaction }, args) => {
      const enabled = !(args.enabled === false || Number(args.enabled) === 0)
      const angleIncrement = Number(args.angleIncrement ?? document.snapshot().header.systemVariables.POLARANG ?? 45)
      if (!(angleIncrement > 0) || angleIncrement > 180 || !Number.isFinite(angleIncrement)) throw new KJValidationError('POLAR angleIncrement must be a finite number greater than 0 and at most 180 degrees')
      transaction.setSystemVariable('POLARMODE', enabled ? 1 : 0)
      transaction.setSystemVariable('POLARANG', angleIncrement)
      if (enabled) transaction.setSystemVariable('ORTHOMODE', 0)
      return { enabled, angleIncrement }
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'SNAPSETTINGS', title: 'Set object snap modes',
    execute: ({ transaction }, args) => {
      const modes = [...new Set((args.modes ?? []).map(value => String(value).toLowerCase()))]
      for (const mode of modes) if (!(KJ_SNAP_MODES as readonly string[]).includes(mode)) throw new KJValidationError(`Unsupported snap mode: ${mode}`)
      const radius = Number(args.radius ?? 12)
      if (!(radius > 0) || !Number.isFinite(radius)) throw new KJValidationError('Snap radius must be a positive finite number')
      transaction.setSystemVariable('OSMODE', modes)
      transaction.setSystemVariable('APERTURE', radius)
      return { modes, radius }
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'LAYERNEW', title: 'Create layer',
    execute: ({ document, transaction }, args) => {
      const name = normalizeLayerName(args.name)
      if (findTableRecord(document, 'layers', name)) throw new KJValidationError(`Layer already exists: ${name}`)
      const layer = transaction.upsertTableRecord('layers', {
        name,
        type: 'LAYER',
        payload: normalizeLayerPatch(document, {
          color: args.color ?? 7,
          trueColor: args.trueColor ?? null,
          linetypeId: args.linetypeId ?? document.snapshot().tables.linetypes.currentId,
          lineweight: args.lineweight ?? -1,
          visible: args.visible !== false,
          frozen: Boolean(args.frozen),
          locked: Boolean(args.locked),
          plottable: args.plottable !== false,
        }),
      })
      if (args.current === true) transaction.setCurrentTableRecord('layers', layer.id)
      return layer
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'LAYERCURRENT', title: 'Set current layer',
    execute: ({ document, transaction }, args) => transaction.setCurrentTableRecord('layers', resolveTableRecord(document, 'layers', args.id ?? args.name).id),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'LAYERUPDATE', title: 'Update layer',
    execute: ({ document, transaction }, args) => {
      const record = resolveTableRecord(document, 'layers', args.id ?? args.name)
      const name = args.newName == null ? String(record.name ?? '') : normalizeLayerName(args.newName)
      if (String(record.name).toUpperCase() === '0' && name.toUpperCase() !== '0') throw new KJValidationError('Layer 0 cannot be renamed')
      const duplicate = findTableRecord(document, 'layers', name)
      if (duplicate && duplicate.id !== record.id) throw new KJValidationError(`Layer already exists: ${name}`)
      const patch = normalizeLayerPatch(document, args.patch?.payload ?? args.patch ?? {})
      const updated = transaction.updateObject(record.id, { name, payload: patch })
      if (args.current === true) transaction.setCurrentTableRecord('layers', record.id)
      return updated
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'LAYERDELETE', title: 'Delete layer',
    execute: ({ document, transaction }, args) => transaction.removeTableRecord('layers', resolveTableRecord(document, 'layers', args.id ?? args.name).id),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'BLOCKCREATE', aliases: ['BLOCK', 'B'], title: 'Create block definition',
    execute: (context, args) => createBlockDefinition(context, args),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'BLOCKINSERT', aliases: ['INSERT'], title: 'Insert block reference',
    execute: ({ document, transaction }, args) => {
      const record = resolveTableRecord(document, 'blockRecords', args.blockRecordId ?? args.id ?? args.name)
      if (record.payload?.isSpace) throw new KJValidationError('Model and paper spaces cannot be inserted as blocks')
      if (args.attributes != null) throw new KJValidationError('BLOCKINSERT uses attributeValues for native instance attributes')
      const result = createNativeBlockInsert(transaction, record.id, args)
      assertBlockGraph(transaction, record.id, args)
      return result.instance
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'COMPONENTSEARCH', title: 'Search component library', transactional: false,
    execute: (_context, args) => searchComponentCatalog({ query: args.query, category: args.category, locale: args.locale, limit: args.limit, cursor: args.cursor }),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'COMPONENTINSERT', title: 'Insert library component',
    execute: ({ document, transaction }, args) => insertCatalogComponent(document, transaction, {
      componentId: args.componentId, version: args.version, units: args.units, parameters: args.parameters,
      position: args.position, scale: args.scale, rotation: args.rotation, layerId: args.layerId,
      ownerId: args.ownerId, maxDefinitionEntities: args.maxDefinitionEntities, identity: args.identity,
    }),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'BLOCKINSTANCEUPDATE', title: 'Update one block instance',
    execute: (context, args) => updateBlockInstance(context, args),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'BLOCKDEFINITIONUPDATE', title: 'Update shared block definition',
    execute: (context, args) => updateBlockDefinition(context, args),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'XREFATTACH', aliases: ['XATTACH'], title: 'Attach local external reference',
    execute: ({ transaction }, args) => {
      const id = String(args.id ?? args.name ?? '').trim()
      if (!id) throw new KJValidationError('External reference id is required')
      const source = normalizeExternalReferenceSource(args.source ?? args)
      return transaction.putResource('externalReferences', id, {
        id, name: String(args.name ?? id), source, referenceType: String(args.referenceType ?? 'overlay').toLowerCase(),
        insertionPoint: vec3(args.insertionPoint ?? [0, 0, 0], 'insertionPoint'),
        scale: normalizeXrefScale(args.scale), rotation: Number(args.rotation ?? 0),
        sha256: args.sha256 == null ? null : String(args.sha256).toLowerCase(), status: 'unresolved',
      })
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'XREFRELOAD', title: 'Update local external reference status',
    execute: ({ document, transaction }, args) => {
      const id = String(args.id ?? '')
      const current = document.snapshot().resources.externalReferences?.[id] as Readonly<Record<string, unknown>> | undefined
      if (!current) throw new KJValidationError(`External reference does not exist: ${id}`)
      return transaction.putResource('externalReferences', id, {
        ...current, sha256: args.sha256 == null ? current.sha256 : String(args.sha256).toLowerCase(),
        status: String(args.status ?? 'loaded').toLowerCase(), checkedAt: args.checkedAt ?? null,
      })
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'XREFDETACH', aliases: ['XDETACH'], title: 'Detach external reference',
    execute: ({ transaction }, args) => transaction.removeResource('externalReferences', String(args.id ?? '')),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'DESIGNCREATE', title: 'Bind design parameters to existing geometry',
    execute: ({ document, transaction }, args) => createDesignRelations(document, transaction, args.name!, args.definition, args.id),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'DESIGNUPDATE', title: 'Update design parameters and dependent geometry',
    execute: ({ document, transaction }, args) => updateDesignRelations(document, transaction, args.id!, args.parameters),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'GROUP', aliases: ['G'], title: 'Create object group',
    execute: ({ document, transaction }, args) => createObjectGroup(document, transaction, args),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'HATCH', aliases: ['H'], title: 'Create hatch',
    execute: ({ transaction }, args) => transaction.createEntity('HATCH', {
      boundaryLoops: args.boundaryLoops,
      patternName: args.patternName ?? 'SOLID',
      patternScale: args.patternScale ?? 1,
      patternAngle: args.patternAngle ?? 0,
      solid: args.solid,
      layerId: args.layerId,
    } as KJObjectPayload, { ownerId: args.ownerId } as KJObjectSpec),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'HATCHEDIT', title: 'Edit hatch boundary islands and pattern',
    execute: ({ document, transaction }, args) => editHatch(document, transaction, args.id, {
      operation: String(args.operation ?? '').toLowerCase() as 'update-pattern' | 'add-island' | 'replace-island' | 'remove-island',
      loopIndex: args.loopIndex,
      vertices: args.vertices,
      sourceIds: args.sourceIds,
      patternScale: args.patternScale,
      patternAngle: args.patternAngle,
    }),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'LEADER', aliases: ['LE'], title: 'Create leader annotation',
    execute: ({ document, transaction }, args) => createLeaderAnnotation(document, transaction, args),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'LEADEREDIT', title: 'Edit leader annotation',
    execute: ({ document, transaction }, args) => editLeaderAnnotation(document, transaction, args),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'LINETYPE', aliases: ['LT'], title: 'Create or update linetype',
    execute: ({ transaction }, args) => transaction.upsertTableRecord('linetypes', { name: args.name, type: 'LINETYPE', payload: { description: args.description ?? '', pattern: clone(args.pattern ?? []) } } as KJTableRecordInput),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'TEXTSTYLE', aliases: ['STYLE'], title: 'Create or update text style',
    execute: ({ document, transaction }, args) => {
      const operation = String(args.operation ?? 'upsert').toLowerCase()
      if (operation === 'set-current') return transaction.setCurrentTableRecord('textStyles', resolveTableRecord(document, 'textStyles', args.id ?? args.name).id)
      if (!['upsert', 'create', 'update'].includes(operation)) throw new KJValidationError(`Unsupported text style operation: ${operation}`)
      const source = clone(args.properties ?? args.payload ?? {}) as KJObjectPayload
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw new KJValidationError('Text style properties must be an object')
      for (const key of ['fontFamily', 'fontFile', 'bigFontFile', 'fixedHeight', 'widthFactor', 'obliqueAngle'] as const) if (Object.hasOwn(args, key)) source[key] = args[key]
      const boundedText = (key: 'fontFamily' | 'fontFile' | 'bigFontFile', maximum: number): void => {
        if (!Object.hasOwn(source, key)) return
        const value = source[key] == null ? '' : String(source[key]).trim()
        if (key !== 'fontFamily' && !value) { source[key] = null; return }
        if (!value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new KJValidationError(`Text style ${key} must be bounded printable text`)
        if (key !== 'fontFamily' && /^(?:data|https?):/i.test(value)) throw new KJValidationError(`Text style ${key} must be a local font reference, not embedded or remote data`)
        source[key] = value
      }
      boundedText('fontFamily', 256); boundedText('fontFile', 512); boundedText('bigFontFile', 512)
      for (const key of ['fixedHeight', 'widthFactor', 'obliqueAngle'] as const) {
        if (!Object.hasOwn(source, key)) continue
        const value = Number(source[key])
        if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new KJValidationError(`Text style ${key} is outside its supported range`)
        source[key] = value
      }
      if (source.fixedHeight !== undefined && Number(source.fixedHeight) < 0) throw new KJValidationError('Text style fixed height must be non-negative')
      if (source.widthFactor !== undefined && Number(source.widthFactor) <= 0) throw new KJValidationError('Text style width factor must be positive')
      if (source.obliqueAngle !== undefined && Math.abs(Number(source.obliqueAngle)) >= Math.PI / 2) throw new KJValidationError('Text style oblique angle must be less than 90 degrees')
      const table = document.getTable('textStyles')
      if (!table) throw new KJValidationError('Text style table is unavailable')
      const requestedName = String(args.newName ?? args.name ?? '').trim()
      let record: KJObjectRecord
      if (operation === 'update') {
        const target = resolveTableRecord(document, 'textStyles', args.id ?? args.name)
        const name = requestedName || target.name || ''
        if (table.records.some(item => item.id !== target.id && normalizeName(item.name) === normalizeName(name))) throw new KJValidationError(`Text style name already exists: ${name}`)
        record = transaction.updateObject(target.id, { name, payload: { ...(clone(target.payload) as KJObjectPayload), ...source } })
      } else {
        if (!requestedName) throw new KJValidationError('Text style name is required')
        const existing = table.records.find(item => normalizeName(item.name) === normalizeName(requestedName))
        if (operation === 'create' && existing) throw new KJValidationError(`Text style name already exists: ${requestedName}`)
        const defaults: KJObjectPayload = { fontFamily: 'sans-serif', fontFile: null, bigFontFile: null, fixedHeight: 0, widthFactor: 1, obliqueAngle: 0 }
        record = transaction.upsertTableRecord('textStyles', { name: requestedName, type: 'TEXT_STYLE', payload: { ...defaults, ...(existing ? clone(existing.payload) as KJObjectPayload : {}), ...source } } as KJTableRecordInput)
      }
      return args.current === true ? transaction.setCurrentTableRecord('textStyles', record.id) : record
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'DIMSTYLE', aliases: ['D'], title: 'Create or update dimension style',
    execute: ({ document, transaction }, args) => {
      const operation = String(args.operation ?? 'upsert').toLowerCase()
      if (operation === 'set-current') return transaction.setCurrentTableRecord('dimensionStyles', resolveTableRecord(document, 'dimensionStyles', args.id ?? args.name).id)
      if (!['upsert', 'create', 'update'].includes(operation)) throw new KJValidationError(`Unsupported dimension style operation: ${operation}`)
      const source = clone(args.properties ?? args.payload ?? {}) as KJObjectPayload
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw new KJValidationError('Dimension style properties must be an object')
      if (Object.hasOwn(source, 'precision')) {
        if (Object.hasOwn(source, 'decimalPlaces') && Number(source.precision) !== Number(source.decimalPlaces)) throw new KJValidationError('Dimension style precision conflicts with decimalPlaces')
        source.decimalPlaces = source.precision
        delete source.precision
      }
      const numeric = (key: string, minimum: number, inclusive: boolean): void => {
        if (!Object.hasOwn(source, key)) return
        const value = Number(source[key])
        if (!Number.isFinite(value) || value > 1e12 || (inclusive ? value < minimum : value <= minimum)) throw new KJValidationError(`Dimension style ${key} is outside its supported range`)
        source[key] = value
      }
      numeric('overallScale', 0, false); numeric('textHeight', 0, false); numeric('arrowSize', 0, false)
      numeric('extensionOffset', 0, true); numeric('extensionBeyond', 0, true)
      if (Object.hasOwn(source, 'decimalPlaces')) {
        const precision = Number(source.decimalPlaces)
        if (!Number.isInteger(precision) || precision < 0 || precision > 8) throw new KJValidationError('Dimension style precision must be an integer from 0 to 8')
        source.decimalPlaces = precision
      }
      const table = document.getTable('dimensionStyles')
      if (!table) throw new KJValidationError('Dimension style table is unavailable')
      const requestedName = String(args.newName ?? args.name ?? '').trim()
      let record: KJObjectRecord
      if (operation === 'update') {
        const target = resolveTableRecord(document, 'dimensionStyles', args.id ?? args.name)
        const name = requestedName || target.name || ''
        const conflict = table.records.find(item => item.id !== target.id && normalizeName(item.name) === normalizeName(name))
        if (conflict) throw new KJValidationError(`Dimension style name already exists: ${name}`)
        record = transaction.updateObject(target.id, { name, payload: { ...(clone(target.payload) as KJObjectPayload), ...source } })
      } else {
        if (!requestedName) throw new KJValidationError('Dimension style name is required')
        const existing = table.records.find(item => normalizeName(item.name) === normalizeName(requestedName))
        if (operation === 'create' && existing) throw new KJValidationError(`Dimension style name already exists: ${requestedName}`)
        record = transaction.upsertTableRecord('dimensionStyles', { name: requestedName, type: 'DIM_STYLE', payload: existing ? { ...(clone(existing.payload) as KJObjectPayload), ...source } : source } as KJTableRecordInput)
      }
      return args.current === true ? transaction.setCurrentTableRecord('dimensionStyles', record.id) : record
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'UCS', title: 'Create, update or activate UCS',
    execute: ({ document, transaction }, args) => {
      if (String(args.operation ?? 'upsert').toLowerCase() === 'set-current') return transaction.setCurrentTableRecord('ucs', resolveTableRecord(document, 'ucs', args.id ?? args.name).id)
      return transaction.upsertTableRecord('ucs', { name: args.name, type: 'UCS', payload: { origin: args.origin ?? [0, 0, 0], xAxis: args.xAxis ?? [1, 0, 0], yAxis: args.yAxis ?? [0, 1, 0] } } as KJTableRecordInput)
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'LAYOUT', title: 'Create or activate layout',
    execute: ({ document, transaction }, args) => {
      const operation = String(args.operation ?? 'create').toLowerCase()
      if (operation === 'create') return transaction.createLayout(args)
      if (operation === 'set-current') return transaction.setActiveLayout(resolveLayout(document, args.id ?? args.name).id)
      if (operation === 'update') {
        const layout = resolveLayout(document, args.id ?? args.name)
        return transaction.updateObject(layout.id, { name: args.newName ?? layout.name, payload: clone(args.patch ?? {}) })
      }
      throw new KJValidationError(`Unsupported layout operation: ${operation}`)
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'VIEWPORT', aliases: ['MVIEW'], title: 'Create paper-space viewport',
    execute: ({ document, transaction }, args) => {
      const operation = String(args.operation ?? 'create').toLowerCase()
      if (operation === 'update') {
        const viewport = requiredEntity(document, args.id)
        if (viewport.type !== 'VIEWPORT') throw new KJValidationError(`Entity is not a viewport: ${args.id}`)
        return transaction.updateObject(viewport.id, { payload: clone(args.patch ?? {}) })
      }
      const layout = resolveLayout(document, args.layoutId ?? args.layoutName ?? document.spaces.activeLayoutId)
      const ownerId = args.ownerId ?? layout.payload.blockRecordId
      const viewport = transaction.createEntity('VIEWPORT', {
        center: args.center,
        width: args.width,
        height: args.height,
        viewCenter: args.viewCenter ?? [0, 0, 0],
        viewHeight: args.viewHeight,
        twistAngle: args.twistAngle ?? 0,
        frozenLayerIds: args.frozenLayerIds ?? [],
        layerId: args.layerId,
      } as KJObjectPayload, { ownerId } as KJObjectSpec)
      transaction.updateObject(layout.id, { payload: { viewportIds: [...(layout.payload.viewportIds ?? []), viewport.id] } })
      return viewport
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'PLOTSETUP', aliases: ['PAGESETUP'], title: 'Configure layout plotting',
    execute: ({ document, transaction }, args) => {
      const layout = resolveLayout(document, args.layoutId ?? args.layoutName ?? document.spaces.activeLayoutId)
      if (args.dxf !== undefined) {
        validatePlotSettings(args.dxf)
        if (args.settings !== undefined) throw new KJValidationError('PLOTSETUP cannot mix dxf and native settings')
        const settings = { ...layout.payload.dxfPlotSettings, ...args.dxf }
        const changed = Object.keys(args.dxf)
        if (settings.plotType === 4 && changed.some(key => ['plotType', 'windowMinX', 'windowMinY', 'windowMaxX', 'windowMaxY'].includes(key))) {
          const { windowMinX: x0, windowMinY: y0, windowMaxX: x1, windowMaxY: y1 } = settings
          if (![x0, y0, x1, y1].every(value => typeof value === 'number' && Number.isFinite(value)) || !(x1! > x0! && y1! > y0!)) throw new KJValidationError('Plot window requires four finite coordinates and positive width and height')
        }
        if (settings.plotType === 3 && changed.some(key => key === 'plotType' || key === 'viewName') && !settings.viewName?.trim()) throw new KJValidationError('Named-view plotting requires a view name')
        return transaction.updateObject(layout.id, { payload: { dxfPlotSettings: settings } })
      }
      const settings = normalizePlotSettings(args.settings ?? args)
      if (settings.plotStyleId && !document.snapshot().resources.plotStyles?.[settings.plotStyleId]) throw new KJValidationError(`Plot style does not exist: ${settings.plotStyleId}`)
      return transaction.updateObject(layout.id, { payload: { plotSettings: settings } })
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'PLOTSTYLE', title: 'Create or update plot style',
    execute: ({ transaction }, args) => {
      const id = String(args.id ?? args.name ?? '').trim()
      if (!id) throw new KJValidationError('Plot style id is required')
      return transaction.putResource('plotStyles', id, { id, name: String(args.name ?? id), mode: String(args.mode ?? 'color-dependent'), mappings: clone(args.mappings ?? {}) })
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'SEARCH', aliases: ['FIND'], title: 'Search drawing information', transactional: false,
    execute: ({ document }, args) => searchDocument(document, args),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'COMPARE', aliases: ['DWGCOMPARE'], title: 'Compare drawings by CAD handle', transactional: false,
    execute: ({ document }, args) => compareDocuments(document, args.otherDocument ?? args.other),
  }, { owner: '@kanjieteam/kjdraw' }))
  for (const [id,method,title] of [
    ['SOLIDBOX','box','Create authoritative box'],['SOLIDCYLINDER','cylinder','Create authoritative cylinder'],
    ['SOLIDCONE','cone','Create authoritative cone'],['SOLIDSPHERE','sphere','Create authoritative sphere'],
    ['SOLIDSWEEP','sweep','Sweep authoritative solid'],['SOLIDLOFT','loft','Loft authoritative solid'],
  ] as const) disposers.push(registry.register({ id, title, execute:(context,args)=>createAuthoritativeSolid(context,args,method) }, { owner:'@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id:'SOLIDTRANSFORM',title:'Transform authoritative solid',
    execute:({sdk,document,transaction},args)=>{
      const entity=requiredSolidEntity(document,args.id),source=openSolid(sdk,entity),result=source.transform(args.matrix)
      try{return transaction.updateObject(entity.id,{payload:solidPayload(result,{layerId:entity.payload.layerId} as KJObjectPayload)})}finally{result.close();source.close()}
    },
  },{owner:'@kanjieteam/kjdraw'}))
  disposers.push(registry.register({
    id:'SOLIDBOOLEAN',title:'Boolean authoritative solids',
    execute:({sdk,document,transaction},args)=>{
      const first=requiredSolidEntity(document,args.firstId),second=requiredSolidEntity(document,args.secondId),a=openSolid(sdk,first),b=openSolid(sdk,second),result=a.boolean(b,args.operation??'union')
      try{const created=transaction.createEntity('SOLID3D',solidPayload(result,{layerId:args.layerId??first.payload.layerId} as KJObjectPayload),{ownerId:args.ownerId??first.ownerId});if(args.eraseSources!==false){transaction.eraseObject(first.id);transaction.eraseObject(second.id)}return created}finally{result.close();a.close();b.close()}
    },
  },{owner:'@kanjieteam/kjdraw'}))
  disposers.push(registry.register({
    id:'SOLIDVALIDATE',title:'Validate authoritative solid',transactional:false,
    execute:({sdk,document},args)=>{const entity=requiredSolidEntity(document,args.id),solid=openSolid(sdk,entity);try{solid.validate();return solid.serialize().validation}finally{solid.close()}},
  },{owner:'@kanjieteam/kjdraw'}))
  disposers.push(registry.register({
    id:'SOLIDVOLUME',title:'Measure authoritative solid volume',transactional:false,
    execute:({sdk,document},args)=>{const entity=requiredSolidEntity(document,args.id),solid=openSolid(sdk,entity);try{return{id:entity.id,volume:solid.volume,kernelAuthority:'kjcore-rust-wasm'}}finally{solid.close()}},
  },{owner:'@kanjieteam/kjdraw'}))
  disposers.push(registry.register({
    id: 'MOVE', aliases: ['M'], title: 'Move objects',
    execute: (context, args) => transformExisting(context, args, moveMatrix(args)),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'ROTATE', aliases: ['RO'], title: 'Rotate objects',
    execute: (context, args) => transformExisting(context, args, rotationAround3(commandAngle(args), vec2(args.center ?? args.basePoint ?? [0, 0]))),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'SCALE', aliases: ['SC'], title: 'Scale objects',
    execute: (context, args) => {
      const factor = Number(args.factor)
      if (!Number.isFinite(factor) || factor === 0) throw new KJValidationError('Scale factor must be a finite non-zero number')
      return transformExisting(context, args, scaleAround3(factor, factor, vec2(args.center ?? args.basePoint ?? [0, 0])))
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'COPY', aliases: ['CO', 'CP'], title: 'Copy objects',
    execute: (context, args) => copyEntities(context, args, moveMatrix(args), 'COPY'),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'MIRROR', aliases: ['MI'], title: 'Mirror objects',
    execute: (context, args) => {
      rejectAttachedReorganization(context.document, args, 'MIRROR')
      const matrix = reflectionAcrossLine3((args.lineStart ?? args.start)!, (args.lineEnd ?? args.end)!)
      const ids = entityIds(args)
      if (args.eraseSource) requireSelectedAssociativeDimensions(context.document, ids, 'MIRROR')
      const copies = copyEntities(context, args, matrix, 'MIRROR')
      if (args.eraseSource) {
        const replacements = new Map(copies.flatMap(copy => {
          const copiedFromId = (copy.source as { copiedFromId?: unknown } | null)?.copiedFromId
          return copiedFromId == null ? [] : [[String(copiedFromId), copy.id] as const]
        }))
        for (const id of ids) context.transaction.eraseObject(id)
        replaceCopiedMemberships(context.transaction, replacements)
      }
      return copies
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'ARRAYRECT', aliases: ['ARRAYRECTANGULAR'], title: 'Rectangular array',
    execute: (context, args) => rectangularArray(context, args),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'ARRAYPOLAR', aliases: ['POLARARRAY'], title: 'Polar array',
    execute: (context, args) => polarArray(context, args),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'OFFSET', aliases: ['O'], title: 'Offset entity',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id)
      return createDerived(transaction, entity, entity.type, { ...offsetEntityPayload(entity, args.distance, args), ...clone(args.payloadPatch ?? {}) })
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'BREAK', aliases: ['BR'], title: 'Break entity',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id), pieces = breakEntityPayloads(entity, args)
      if (pieces.length !== 2) throw new KJValidationError('BREAK requires two deterministic native pieces')
      if (pieces.every(piece => piece.type === entity.type)) {
        const leading = transaction.updateObject(entity.id, { payload: pieces[0]!.payload })
        const trailing = createDerived(transaction, entity, pieces[1]!.type, pieces[1]!.payload)
        let polylineVertexMap: Map<number, { entityId: string; vertexIndex: number }> | undefined
        if (['LWPOLYLINE', 'POLYLINE'].includes(entity.type)) {
          const rawPoints = (args.points ?? [args.firstPoint ?? args.point, args.secondPoint].filter(value => value != null)) as readonly unknown[]
          const firstSegment = resolvePolylineEditLocation(entity, { operation: 'INSERT', point: rawPoints[0] }).segmentIndex!
          const vertices = entity.payload.vertices as readonly unknown[]
          polylineVertexMap = new Map()
          if (entity.payload.closed === true) {
            const secondSegment = resolvePolylineEditLocation(entity, { operation: 'INSERT', point: rawPoints[1] }).segmentIndex!
            let sourceIndex = (firstSegment + 1) % vertices.length, targetIndex = 1
            while (true) {
              polylineVertexMap.set(sourceIndex, { entityId: leading.id, vertexIndex: targetIndex++ })
              if (sourceIndex === secondSegment) break
              sourceIndex = (sourceIndex + 1) % vertices.length
            }
            sourceIndex = (secondSegment + 1) % vertices.length; targetIndex = 1
            while (!polylineVertexMap.has(sourceIndex)) {
              polylineVertexMap.set(sourceIndex, { entityId: trailing.id, vertexIndex: targetIndex++ })
              sourceIndex = (sourceIndex + 1) % vertices.length
            }
          } else {
            for (let index = 0; index < vertices.length; index += 1) polylineVertexMap.set(index,
              index <= firstSegment ? { entityId: leading.id, vertexIndex: index } : { entityId: trailing.id, vertexIndex: index - firstSegment })
          }
        }
        migrateBreakDimensionAssociations(transaction, entity.id, trailing.id, polylineVertexMap)
        refreshAssociativeDimensions(transaction, [leading.id, trailing.id])
        replaceEntityMemberships(transaction, [entity.id], [leading.id, trailing.id])
        return [leading, trailing]
      }
      transaction.eraseObject(entity.id)
      const derived = pieces.map(piece => createDerived(transaction, entity, piece.type, piece.payload))
      migrateCircleBreakDimensionAssociations(transaction, entity.id, derived)
      refreshAssociativeDimensions(transaction, derived.map(piece => piece.id))
      replaceEntityMemberships(transaction, [entity.id], derived.map(piece => piece.id))
      return derived
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'JOIN', aliases: ['J'], title: 'Join entities',
    execute: ({ document, transaction }, args) => {
      const rawIds = args.ids ?? (args.id == null ? [] : [args.id])
      if (!Array.isArray(rawIds) || rawIds.length < 2) throw new KJValidationError('JOIN requires at least two entity ids')
      const ids = rawIds.map(String)
      if (new Set(ids).size !== ids.length) throw new KJValidationError('JOIN entity ids must be unique')
      const primaryId = String(args.id ?? ids[0])
      if (!ids.includes(primaryId)) throw new KJValidationError('JOIN primary entity must be included in ids')
      const entities = ids.map(id => requiredEntity(document, id))
      if (entities.some(entity => entity.ownerId !== entities[0]!.ownerId)) throw new KJValidationError('JOIN entities must share one drawing space')
      rejectAttachedReorganization(document, { ids }, 'JOIN')
      const result = joinEntityPayloads(entities, { tolerance: args.tolerance, primaryId })
      for (const entity of entities) requireAssociativeDimensionSourceIdentity(transaction, entity.id, 'JOIN')
      const primary = entities.find(entity => entity.id === primaryId)!
      let joined: KJObjectRecord
      if (result.type === primary.type) joined = transaction.updateObject(primary.id, { payload: result.payload })
      else joined = createDerived(transaction, primary, result.type, result.payload)
      for (const entity of entities) if (entity.id !== joined.id) transaction.eraseObject(entity.id)
      replaceEntityMemberships(transaction, ids, [joined.id])
      return joined
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'EXPLODE', aliases: ['X'], title: 'Explode entity',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id), pieces = explodeEntity(entity)
      requireAssociativeDimensionSourceIdentity(transaction, entity.id, 'EXPLODE')
      transaction.eraseObject(entity.id)
      const derived = pieces.map(piece => createDerived(transaction, entity, piece.type, piece.payload))
      replaceEntityMemberships(transaction, [entity.id], derived.map(piece => piece.id))
      return derived
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'TRIM', aliases: ['TR'], title: 'Trim entity',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id), boundaries = requiredBoundaries(document, args.boundaryIds, entity.id)
      const pieces = trimEntityPayloads(entity, boundaries, args.pickPoint)
      const first = pieces[0]
      if (!first) throw new KJValidationError('Trim must retain a non-empty entity')
      if (pieces.length !== 1 || first.type !== entity.type || entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') requireAssociativeDimensionSourceIdentity(transaction, entity.id, 'TRIM')
      let primary: KJObjectRecord
      if (first.type === entity.type) primary = transaction.updateObject(entity.id, { payload: first.payload })
      else {
        // Entity types are immutable. A trimmed circle produces a derived ARC;
        // one transaction restores the original circle on Undo.
        transaction.eraseObject(entity.id)
        primary = createDerived(transaction, entity, first.type, first.payload)
      }
      const retainedIds = [primary.id]
      for (const piece of pieces.slice(1)) retainedIds.push(createDerived(transaction, entity, piece.type, piece.payload).id)
      replaceEntityMemberships(transaction, [entity.id], retainedIds)
      if (primary.id === entity.id) refreshAssociativeDimensions(transaction, [entity.id])
      return primary
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'EXTEND', aliases: ['EX'], title: 'Extend entity',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id), boundaries = requiredBoundaries(document, args.boundaryIds, entity.id)
      const updated = transaction.updateObject(entity.id, { payload: extendEntityPayload(entity, boundaries, args.pickPoint) })
      refreshAssociativeDimensions(transaction, [entity.id])
      return updated
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'LENGTHEN', aliases: ['LEN'], title: 'Lengthen entity',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id)
      const updated = transaction.updateObject(entity.id, { payload: lengthenEntityPayload(entity, args) })
      refreshAssociativeDimensions(transaction, [entity.id])
      return updated
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'STRETCH', aliases: ['S'], title: 'Stretch vertices',
    execute: ({ document, transaction }, args) => {
      const ids = entityIds(args)
      if (ids.length > 4096) throw new KJValidationError('STRETCH supports at most 4096 entities per operation')
      const updates = ids.map(id => {
        const entity = requiredEntity(document, id)
        return { entity, payload: stretchEntityPayload(entity, args) }
      }).filter(value => value.payload != null)
      if (!updates.length) throw new KJValidationError('STRETCH crossing window contains no editable vertices')
      const changed = updates.map(value => transaction.updateObject(value.entity.id, { payload: value.payload! }))
      refreshAssociativeDimensions(transaction, changed.map(entity => entity.id))
      return changed
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'PEDIT', aliases: ['PE', 'POLYLINEEDIT'], title: 'Edit polyline topology',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id)
      const location = resolvePolylineEditLocation(entity, args)
      const payload = editPolylinePayload(entity, args)
      const operation = normalizeName(args.operation)
      const updated = transaction.updateObject(entity.id, { payload })
      if (operation === 'INSERT') migratePolylineDimensionAssociations(transaction, entity.id, { operation, vertexIndex: location.segmentIndex! + 1 })
      if (operation === 'DELETE') migratePolylineDimensionAssociations(transaction, entity.id, { operation, vertexIndex: location.vertexIndex! })
      refreshAssociativeDimensions(transaction, [entity.id])
      return updated
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'CHAMFER', aliases: ['CHA'], title: 'Chamfer lines',
    execute: (context, args) => editLinePair(context, args, chamferLinePair),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'FILLET', aliases: ['F'], title: 'Fillet lines',
    execute: (context, args) => editLinePair(context, args, filletLinePair),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'GRIPEDIT', title: 'Edit entity grip',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id)
      const payload = editEntityGrip(entity, args.gripId!, args.point!)
      if (entity.type === 'LEADER' && args.gripId === 'text' && entity.payload.annotationId) {
        const annotation = requiredEntity(document, entity.payload.annotationId)
        if (annotation.type !== 'MTEXT') throw new KJValidationError('LEADER annotation must reference MTEXT for native editing')
        transaction.updateObject(annotation.id, { payload: { position: payload.textPosition } })
      }
      const updated = transaction.updateObject(entity.id, { payload })
      refreshAssociativeDimensions(transaction, [entity.id])
      return updated
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'LENGTH', aliases: ['LISTLENGTH'], title: 'Measure entity length', transactional: false,
    execute: ({ document }, args) => entityIds(args).map(id => ({ id, ...entityLength2(requiredEntity(document, id)) })),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'AREA', title: 'Measure entity area', transactional: false,
    execute: ({ document }, args) => entityIds(args).map(id => ({ id, ...entityArea2(requiredEntity(document, id)) })),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'NEAREST', title: 'Nearest point on entity', transactional: false,
    execute: ({ document }, args) => ({ id: String(args.id), ...nearestPointOnEntity2(requiredEntity(document, args.id), args.point!) }),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'INTERSECT', aliases: ['INTERSECTION'], title: 'Intersect entities', transactional: false,
    execute: ({ document }, args) => ({
      firstId: String(args.firstId), secondId: String(args.secondId),
      ...intersectEntityPair2(requiredEntity(document, args.firstId), requiredEntity(document, args.secondId)),
    }),
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'DISTANCE', aliases: ['DI', 'DIST'], title: 'Measure distance', transactional: false,
    execute: ({ document }, args) => {
      const point = vec2((args.point ?? args.firstPoint)!, 'point')
      if (args.id != null) return { mode: 'point-entity', id: String(args.id), ...nearestPointOnEntity2(requiredEntity(document, args.id), point) }
      const second = vec2(args.secondPoint!, 'secondPoint')
      return { mode: 'point-point', firstPoint: point, secondPoint: second, distance: distance2(point, second) }
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  disposers.push(registry.register({
    id: 'ANGLE', aliases: ['ANG'], title: 'Measure angle', transactional: false,
    execute: (_context, args) => {
      const first = args.vertex == null ? vec2(args.firstVector!, 'firstVector') : subtract2(vec2(args.firstPoint!, 'firstPoint'), vec2(args.vertex, 'vertex'))
      const second = args.vertex == null ? vec2(args.secondVector!, 'secondVector') : subtract2(vec2(args.secondPoint!, 'secondPoint'), vec2(args.vertex, 'vertex'))
      const firstLength = Math.hypot(...first), secondLength = Math.hypot(...second)
      if (firstLength <= 1e-15 || secondLength <= 1e-15) throw new KJValidationError('Angle vectors must be non-zero')
      const radians = Math.acos(Math.max(-1, Math.min(1, dot2(first, second) / (firstLength * secondLength))))
      return { radians, degrees: radians * 180 / Math.PI }
    },
  }, { owner: '@kanjieteam/kjdraw' }))
  return () => disposers.reverse().forEach(dispose => dispose())
}

function entityIds(args: KJCommandArguments = {}): string[] {
  const ids = args.ids ?? (args.id == null ? [] : [args.id])
  if (!Array.isArray(ids) || !ids.length) throw new KJValidationError('Command requires at least one entity id')
  return [...new Set(ids.map(String))]
}

function solidAuthority(sdk: KJCommandSDKContext): KJSolidAuthority {
  const authority = sdk?.solidAuthority as Partial<KJSolidAuthority> | null | undefined
  if (!authority || authority.authoritative !== true || typeof authority.openMesh !== 'function') throw new KJValidationError('KJCore Rust 三维权威内核未就绪')
  return authority as KJSolidAuthority
}

function solidPayload(session: KJSolidSession, extra: KJObjectPayload = {}): KJObjectPayload {
  const value = session.serialize()
  if (value?.validation?.valid !== true) throw new KJValidationError('KJCore returned an invalid solid')
  return { ...value, ...clone(extra), kernelAuthority: 'kjcore-rust-wasm', solidModelVersion: 1 }
}

function createAuthoritativeSolid({ sdk, transaction }: KJCommandContext, args: KJCommandArguments, method: string): KJObjectRecord {
  const authority = solidAuthority(sdk), factory = authority[method]
  if (typeof factory !== 'function') throw new KJValidationError(`KJCore solid operation is unavailable: ${method}`)
  const session = (factory as (input: KJCommandArguments) => KJSolidSession)(args)
  try {
    return transaction.createEntity('SOLID3D', solidPayload(session, args.layerId == null ? {} : { layerId: args.layerId }), args.ownerId === undefined ? {} : { ownerId: args.ownerId })
  } finally { session.close() }
}

function requiredSolidEntity(document: KJDocument, id: unknown): KJReadonlyObjectRecord {
  const entity = requiredEntity(document, id)
  if (entity.type !== 'SOLID3D') throw new KJValidationError(`Entity is not an authoritative SOLID3D: ${String(id)}`)
  return entity
}

function openSolid(sdk: KJCommandSDKContext, entity: KJReadonlyObjectRecord): KJSolidSession {
  return solidAuthority(sdk).openMesh({ vertices: entity.payload.vertices, triangles: entity.payload.triangles })
}

function vec3(value: unknown, label: string): Point3 {
  if (!Array.isArray(value) || value.length < 2) throw new KJValidationError(`${label} must be a 2D or 3D point`)
  const result: Point3 = [Number(value[0]), Number(value[1]), Number(value[2] ?? 0)]
  if (!result.every(Number.isFinite)) throw new KJValidationError(`${label} must contain finite coordinates`)
  return result
}

function normalizeXrefScale(value: unknown = 1): Point3 {
  const result: Point3 = Array.isArray(value) ? vec3(value.length === 2 ? [...value, 1] : value, 'scale') : [Number(value), Number(value), Number(value)]
  if (!result.every(component => Number.isFinite(component) && component !== 0)) throw new KJValidationError('External reference scale must be finite and non-zero')
  return result
}

function normalizeExternalReferenceSource(value: unknown = {}): { kind: string; path: string } {
  const source = (typeof value === 'string' ? { kind: 'local-file', path: value } : clone(value)) as Record<string, unknown> | null | undefined
  const kind = String(source?.kind ?? (source?.assetPath ? 'project-asset' : 'local-file')).toLowerCase()
  const path = String(source?.path ?? source?.assetPath ?? '').replace(/\\/g, '/').trim()
  if (!path) throw new KJValidationError('External reference local path or project asset path is required')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) throw new KJValidationError('External references cannot use remote URLs')
  if (kind === 'project-asset') {
    const parts = path.split('/')
    if (!path.startsWith('assets/xrefs/') || parts.some(part => !part || part === '.' || part === '..')) throw new KJValidationError('Project external references must use a safe assets/xrefs/ path')
  } else if (kind !== 'local-file') throw new KJValidationError(`Unsupported external reference source: ${kind}`)
  return { kind, path }
}

interface KJPlotSettingsInput extends Record<string, unknown> {
  device?: unknown
  area?: unknown
  rotation?: unknown
  scale?: unknown
  fit?: unknown
  numerator?: unknown
  denominator?: unknown
  window?: readonly unknown[]
  media?: unknown
  centered?: unknown
  plotStyleId?: unknown
  lineweights?: unknown
  outputQualityDpi?: unknown
}

interface KJPlotSettings extends Record<string, unknown> {
  device: string
  media: string
  area: string
  window: readonly [Point3, Point3] | null
  scale: { mode: 'fit' } | { mode: 'custom'; numerator: number; denominator: number }
  centered: boolean
  rotation: number
  plotStyleId: string | null
  lineweights: boolean
  outputQualityDpi: number
}

function normalizePlotSettings(value: KJPlotSettingsInput = {}): KJPlotSettings {
  const device = String(value.device ?? 'pdf').toLowerCase()
  if (!['pdf', 'printer', 'png'].includes(device)) throw new KJValidationError(`Unsupported plot device: ${device}`)
  const area = String(value.area ?? 'layout').toLowerCase()
  if (!['layout', 'display', 'extents', 'window'].includes(area)) throw new KJValidationError(`Unsupported plot area: ${area}`)
  const rotation = Number(value.rotation ?? 0)
  if (![0, 90, 180, 270].includes(rotation)) throw new KJValidationError('Plot rotation must be 0, 90, 180 or 270 degrees')
  const scale: KJPlotSettings['scale'] = value.scale === 'fit' || value.fit === true ? { mode: 'fit' } : { mode: 'custom', numerator: Number(value.numerator ?? 1), denominator: Number(value.denominator ?? 1) }
  if (scale.mode === 'custom' && (![scale.numerator, scale.denominator].every(number => Number.isFinite(number) && number > 0))) throw new KJValidationError('Custom plot scale must use positive finite values')
  const window: KJPlotSettings['window'] = area === 'window' ? [vec3(value.window?.[0], 'plot window start'), vec3(value.window?.[1], 'plot window end')] : null
  return { device, media: String(value.media ?? 'ISO_A4'), area, window, scale, centered: value.centered !== false, rotation, plotStyleId: value.plotStyleId == null ? null : String(value.plotStyleId), lineweights: value.lineweights !== false, outputQualityDpi: Number(value.outputQualityDpi ?? 600) }
}

const BATCH_LINEWEIGHTS = new Set([-3, -2, -1, 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211])

function validateCommandData(input: unknown, label = 'CREATEBATCH resources'): void {
  let nodes = 0
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 1000000 || depth > 32) throw new KJValidationError(`${label} exceeds the data traversal budget`)
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number' && Number.isFinite(value)) return
    if (!value || typeof value !== 'object') throw new KJValidationError(`${label} requires finite JSON data`)
    const array = Array.isArray(value)
    if (array ? Object.getPrototypeOf(value) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new KJValidationError(`${label} requires plain data objects and arrays`)
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !('value' in descriptor) || !descriptor.enumerable) throw new KJValidationError(`${label} rejects accessors and hidden or unsafe fields`)
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= (value as unknown[]).length)) throw new KJValidationError(`${label} arrays reject custom properties`)
      visit(descriptor.value, depth + 1)
    }
    if (array) for (let index = 0; index < (value as unknown[]).length; index++) if (!Object.hasOwn(value, index)) throw new KJValidationError(`${label} arrays must be dense`)
  }
  visit(input, 0)
}

function compoundRootIds(document: KJDocument, ids: readonly string[]): string[] {
  const selected = new Set(ids)
  for (const id of [...selected]) {
    const object = document.getObject(id, { includeErased: true })
    if (object?.type === 'LEADER' && object.payload.ownsAnnotation === true && object.payload.annotationId) selected.add(String(object.payload.annotationId))
    for (const leader of document.listObjects({ includeErased: true })) if (leader.type === 'LEADER' && leader.payload.ownsAnnotation === true && leader.payload.annotationId === id) selected.add(leader.id)
  }
  return [...selected].filter(id => {
    const object = document.getObject(id, { includeErased: true })
    const parent = object?.payload.parentInsertId ?? (object?.type === 'SEQEND' ? object.ownerId : null)
    return !parent || !selected.has(parent)
  })
}

function leaderPoints(value: unknown): Point3[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4096) throw new KJValidationError('LEADER requires 2 to 4096 vertices')
  const points = value.map((point, index) => vec3(point, `vertices[${index}]`))
  if (points.some((point, index) => index > 0 && Math.hypot(point[0] - points[index - 1]![0], point[1] - points[index - 1]![1], point[2] - points[index - 1]![2]) <= 1e-12)) throw new KJValidationError('LEADER consecutive vertices must be distinct')
  return points
}

function leaderText(value: unknown): string {
  const text = String(value ?? '')
  if (!text.trim() || text.length > 16384 || /\u0000/.test(text)) throw new KJValidationError('LEADER annotation text must be nonempty bounded Unicode text')
  return text
}

function leaderTextStyle(document: KJDocument, value: unknown): string {
  const table = document.getTable('textStyles')
  const id = value == null ? table?.currentId : String(value)
  if (!id || !table?.records.some(record => record.id === id)) throw new KJValidationError('LEADER text style must reference the text style table')
  return id
}

function createLeaderAnnotation(document: KJDocument, transaction: KJTransaction, args: KJCommandArguments): { leader: KJObjectRecord; annotation: KJObjectRecord } {
  const vertices = leaderPoints(args.vertices)
  const textPosition = vec3(args.textPosition ?? vertices.at(-1), 'textPosition')
  const text = leaderText(args.text)
  const height = Number(args.textHeight ?? args.height ?? 2.5)
  if (!Number.isFinite(height) || !(height > 0) || height > 1e12) throw new KJValidationError('LEADER text height must be positive and finite')
  const width = args.width == null ? null : Number(args.width)
  if (width !== null && (!Number.isFinite(width) || !(width > 0) || width > 1e12)) throw new KJValidationError('LEADER text width must be positive and finite')
  const styleId = leaderTextStyle(document, args.styleId)
  const ownerId = args.ownerId
  const annotation = transaction.createEntity('MTEXT', {
    position: textPosition, text, height, rotation: Number(args.rotation ?? 0), attachmentPoint: Number(args.attachmentPoint ?? 7),
    styleId, ...(width === null ? {} : { width }), ...(args.layerId == null ? {} : { layerId: args.layerId }),
  }, { ...(ownerId == null ? {} : { ownerId }) } as KJObjectSpec)
  const leader = transaction.createEntity('LEADER', {
    vertices, textPosition, annotationId: annotation.id, ownsAnnotation: true, arrowEnabled: args.arrowEnabled !== false,
    annotationType: 0, pathType: 0, ...(args.layerId == null ? {} : { layerId: args.layerId }),
  }, { ownerId: annotation.ownerId })
  return { leader, annotation }
}

function editLeaderAnnotation(document: KJDocument, transaction: KJTransaction, args: KJCommandArguments): { leader: KJObjectRecord; annotation: KJObjectRecord } {
  const source = requiredEntity(document, args.id)
  if (source.type !== 'LEADER') throw new KJValidationError('LEADEREDIT requires a LEADER entity')
  if (source.payload.unresolvedLeaderAnnotation) throw new KJValidationError('LEADEREDIT cannot edit an unresolved DXF annotation reference')
  const annotation = source.payload.annotationId ? requiredEntity(document, source.payload.annotationId) : null
  if (annotation && (annotation.type !== 'MTEXT' || annotation.ownerId !== source.ownerId)) throw new KJValidationError('LEADER annotation must reference MTEXT in the same drawing space')
  const vertices = args.vertices == null ? leaderPoints(source.payload.vertices) : leaderPoints(args.vertices)
  const textPosition = args.textPosition == null ? vec3(source.payload.textPosition ?? annotation?.payload.position ?? vertices.at(-1), 'textPosition') : vec3(args.textPosition, 'textPosition')
  const text = args.text == null ? leaderText(annotation?.payload.text ?? source.payload.text) : leaderText(args.text)
  const height = Number(args.textHeight ?? args.height ?? annotation?.payload.height ?? source.payload.textHeight ?? 2.5)
  if (!Number.isFinite(height) || !(height > 0) || height > 1e12) throw new KJValidationError('LEADER text height must be positive and finite')
  const styleId = leaderTextStyle(document, args.styleId ?? annotation?.payload.styleId ?? source.payload.styleId)
  const layerId = args.layerId ?? source.payload.layerId
  const updatedAnnotation = annotation
    ? transaction.updateObject(annotation.id, { payload: { position: textPosition, text, height, styleId, ...(layerId == null ? {} : { layerId }) } })
    : transaction.createEntity('MTEXT', { position: textPosition, text, height, rotation: 0, attachmentPoint: 7, styleId, ...(layerId == null ? {} : { layerId }) }, { ownerId: source.ownerId })
  const updatedLeader = transaction.updateObject(source.id, { payload: { vertices, textPosition, annotationId: updatedAnnotation.id, ownsAnnotation: annotation ? source.payload.ownsAnnotation : true, annotationType: 0, arrowEnabled: args.arrowEnabled ?? source.payload.arrowEnabled ?? true, ...(layerId == null ? {} : { layerId }) } })
  return { leader: updatedLeader, annotation: updatedAnnotation }
}

function createBatchResources(document: KJDocument, transaction: KJTransaction, resources: KJEntityBatchResources): void {
  const fields = (value: unknown, expected: string[]): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) throw new KJValidationError('CREATEBATCH resource fields do not match the declared format')
  }
  fields(resources, ['linetypes', 'layers'])
  for (const group of [resources.linetypes, resources.layers]) if (!Array.isArray(group) || group.length > 16) throw new KJValidationError('CREATEBATCH resources allow at most 16 records per table')
  const ids = new Set<string>(), linetypes = new Map(document.getTable('linetypes')!.records.filter(item => !item.erased).map(item => [item.id, item.name!]))
  const validateIdentity = (value: { id: string; name: string }, names: Set<string>): void => {
    if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 256 || value.id !== value.id.trim() || /[\u0000-\u001f\u007f]/.test(value.id) || ['__proto__', 'constructor', 'prototype'].includes(value.id)) throw new KJValidationError('CREATEBATCH resource IDs must be bounded nonempty data strings')
    if (ids.has(value.id) || Object.hasOwn(document.snapshot().objects, value.id)) throw new KJValidationError('CREATEBATCH resource IDs must be new and globally unique')
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 128 || value.name !== value.name.trim() || /[\u0000-\u001f\u007f<>/\\":;?*|=]/.test(value.name)) throw new KJValidationError('CREATEBATCH resource names must be bounded table names')
    const name = normalizeName(value.name)
    if (names.has(name)) throw new KJValidationError('CREATEBATCH resources cannot overwrite an existing table name')
    ids.add(value.id); names.add(name)
  }
  const typeNames = new Set(document.getTable('linetypes')!.records.map(item => normalizeName(String(item.name))))
  for (const type of resources.linetypes) {
    fields(type, ['id', 'name', 'pattern']); validateIdentity(type, typeNames)
    if (['BYLAYER', 'BYBLOCK'].includes(normalizeName(type.name))) throw new KJValidationError('CREATEBATCH resource linetype names cannot shadow inheritance keywords')
    if (!Array.isArray(type.pattern) || type.pattern.length > 32 || type.pattern.length % 2 !== 0 || type.pattern.some((segment, index) => typeof segment !== 'number' || !Number.isFinite(segment) || Math.abs(segment) > 1e12 || (index % 2 === 0 ? segment <= 0 : segment >= 0))) throw new KJValidationError('CREATEBATCH linetype patterns must be empty for continuous lines or contain alternating positive dashes and negative gaps')
    const length = type.pattern.reduce((sum, segment) => sum + Math.abs(segment), 0)
    if ((type.pattern.length > 0 && !(length > 0)) || !Number.isFinite(length)) throw new KJValidationError('CREATEBATCH nonempty linetype length must be finite and positive')
    linetypes.set(type.id, type.name)
  }
  const layerNames = new Set(document.getTable('layers')!.records.map(item => normalizeName(String(item.name))))
  for (const layer of resources.layers) {
    fields(layer, ['id', 'name', 'color', 'linetypeId', 'lineweight']); validateIdentity(layer, layerNames)
    if (!Number.isInteger(layer.color) || layer.color < 1 || layer.color > 255) throw new KJValidationError('CREATEBATCH layer color must be an ACI integer from 1 to 255')
    if (!BATCH_LINEWEIGHTS.has(layer.lineweight)) throw new KJValidationError('CREATEBATCH layer lineweight must be a supported DXF hundredth-millimetre value')
    if (typeof layer.linetypeId !== 'string' || !linetypes.has(layer.linetypeId)) throw new KJValidationError('CREATEBATCH layer linetypeId must reference the linetype table')
  }
  for (const type of resources.linetypes) transaction.upsertTableRecord('linetypes', { id: type.id, name: type.name, type: 'LINETYPE', payload: { description: '', pattern: clone(type.pattern), totalPatternLength: type.pattern.reduce((sum, segment) => sum + Math.abs(segment), 0), dxfFlags: 0 } })
  for (const layer of resources.layers) transaction.upsertTableRecord('layers', { id: layer.id, name: layer.name, type: 'LAYER', payload: { color: layer.color, linetypeId: layer.linetypeId, linetypeName: linetypes.get(layer.linetypeId), lineweight: layer.lineweight, visible: true, frozen: false, locked: false, plottable: true } })
}

function createEntityBatch({ document, transaction }: KJCommandContext, args: KJCommandArguments = {}): KJObjectRecord[] {
  const specs = args.entities
  if (!Array.isArray(specs) || !specs.length) throw new KJValidationError('CREATEBATCH requires at least one entity')
  if (specs.length > 100000) throw new KJValidationError('CREATEBATCH exceeds the 100000 entity safety limit')
  if (Object.hasOwn(args, 'resources')) {
    createBatchResources(document, transaction, args.resources!)
    const tableIds = (table: 'layers' | 'linetypes') => new Set([...document.getTable(table)!.records.filter(item => !item.erased).map(item => item.id), ...args.resources![table].map(item => item.id)])
    const layers = tableIds('layers'), linetypes = tableIds('linetypes')
    for (const spec of specs) {
      if (spec?.payload?.layerId !== undefined && !layers.has(spec.payload.layerId as string)) throw new KJValidationError('CREATEBATCH entity layerId must reference the layer table')
      if (spec?.payload?.linetypeId !== undefined && !linetypes.has(spec.payload.linetypeId as string)) throw new KJValidationError('CREATEBATCH entity linetypeId must reference the linetype table')
      if (spec?.payload?.lineweight !== undefined && !BATCH_LINEWEIGHTS.has(spec.payload.lineweight as number)) throw new KJValidationError('CREATEBATCH entity lineweight must be a supported DXF hundredth-millimetre value')
    }
  }
  const layerIds = new Map(document.getTable('layers')!.records.map(record => [String(record.name).toUpperCase(), record.id]))
  const currentDimensionStyleId = document.getTable('dimensionStyles')?.currentId
  const currentDimensionStyleName = currentDimensionStyleId ? document.getObject(currentDimensionStyleId)?.name ?? 'STANDARD' : 'STANDARD'
  const currentTextStyleId = document.getTable('textStyles')?.currentId
  for (const layer of args.resources?.layers ?? []) layerIds.set(layer.name.toUpperCase(), layer.id)
  const created: KJObjectRecord[] = []
  for (const spec of specs) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new KJValidationError('CREATEBATCH entity specs must be objects')
    const layerName = String(spec.layerName ?? '0').trim() || '0'
    const layerKey = layerName.toUpperCase()
    let layerId = spec.payload?.layerId ?? layerIds.get(layerKey)
    if (!layerId) {
      if (Object.hasOwn(args, 'resources')) throw new KJValidationError('CREATEBATCH resource batches require an existing or explicitly declared layer')
      const layer = transaction.upsertTableRecord('layers', {
        name: layerName,
        type: 'LAYER',
        payload: {
          color: spec.layer?.color ?? 7,
          visible: spec.layer?.visible !== false,
          frozen: Boolean(spec.layer?.frozen),
          locked: Boolean(spec.layer?.locked),
          plottable: spec.layer?.plottable !== false,
        },
      })
      layerId = layer.id
      layerIds.set(layerKey, layerId)
    }
    const payload = { ...clone(spec.payload ?? {}), layerId }
    if (normalizeName(spec.type) === 'DIMENSION' && payload.styleId === undefined && currentDimensionStyleId) {
      payload.styleId = currentDimensionStyleId
      payload.styleName = currentDimensionStyleName
    }
    if (['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].includes(normalizeName(spec.type)) && payload.styleId === undefined && currentTextStyleId) payload.styleId = currentTextStyleId
    created.push(transaction.createEntity(spec.type!, payload, spec.options ?? {}))
  }
  return created
}

function requiredEntity(document: KJDocument, id: unknown): KJReadonlyObjectRecord {
  const entity = document?.getObject(String(id))
  if (!entity || entity.kind !== 'entity') throw new KJValidationError(`Entity does not exist: ${id}`)
  return entity
}

const BLOCK_RELATION_FIELDS = new Set(['blockRecordId', 'attributeIds', 'sequenceEndId', 'parentInsertId'])

function payloadPatch(value: KJObjectPatch | undefined, command: string): KJObjectPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KJValidationError(`${command} requires patch.payload`)
  const patchKeys = Object.keys(value)
  if (patchKeys.length !== 1 || patchKeys[0] !== 'payload') throw new KJValidationError(`${command} accepts only patch.payload`)
  const payload = value.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.keys(payload).length) throw new KJValidationError(`${command} requires a non-empty patch.payload`)
  if (Object.keys(payload).length > 64) throw new KJValidationError(`${command} patch.payload supports at most 64 fields`)
  for (const field of Object.keys(payload)) if (BLOCK_RELATION_FIELDS.has(field)) {
    throw new KJValidationError(`${command} cannot change structural field ${field}`)
  }
  return clone(payload)
}

function assertGenericPropertyBoundary(document: KJDocument, id: unknown, patch: KJObjectPatch | undefined): void {
  const entity = document.getObject(String(id))
  if (!entity || entity.kind !== 'entity' || !patch?.payload) return
  const owner = document.getObject(String(entity.ownerId ?? ''))
  if (owner?.kind === 'block-record' && owner.payload.isSpace !== true) {
    throw new KJValidationError('PROPERTIES cannot modify block definition members; use BLOCKDEFINITIONUPDATE with the explicit definition id')
  }
  if (entity.type === 'INSERT') for (const field of Object.keys(patch.payload)) if (BLOCK_RELATION_FIELDS.has(field)) {
    throw new KJValidationError(`PROPERTIES cannot change INSERT structural field ${field}; use the explicit block commands`)
  }
}

function updateBlockInstance(
  { document, transaction }: KJCommandContext,
  args: KJCommandArguments,
): { instance: KJObjectRecord; attributes: readonly KJObjectRecord[] } {
  const instance = requiredEntity(document, args.id)
  if (instance.type !== 'INSERT') throw new KJValidationError('BLOCKINSTANCEUPDATE requires an INSERT id')
  const owner = document.getObject(String(instance.ownerId ?? ''))
  if (owner?.kind === 'block-record' && owner.payload.isSpace !== true) {
    throw new KJValidationError('BLOCKINSTANCEUPDATE cannot edit a nested INSERT stored in a shared definition; use BLOCKDEFINITIONUPDATE')
  }
  const patch = args.patch == null ? null : payloadPatch(args.patch, 'BLOCKINSTANCEUPDATE')
  const values = args.attributeValues
  if (patch == null && values == null) throw new KJValidationError('BLOCKINSTANCEUPDATE requires patch.payload or attributeValues')
  if (patch && Object.hasOwn(patch, 'attributes') && (instance.payload.attributeIds?.length || instance.payload.sequenceEndId)) {
    throw new KJValidationError('BLOCKINSTANCEUPDATE edits native attached values through attributeValues; payload.attributes is legacy-only')
  }
  if (values != null && (typeof values !== 'object' || Array.isArray(values))) throw new KJValidationError('BLOCKINSTANCEUPDATE attributeValues must be an object keyed by attribute tag')
  const entries = Object.entries(values ?? {})
  if (entries.length > 256) throw new KJValidationError('BLOCKINSTANCEUPDATE supports at most 256 attribute values')
  if (patch == null && !entries.length) throw new KJValidationError('BLOCKINSTANCEUPDATE attributeValues must not be empty')
  const changedAttributes: KJObjectRecord[] = []
  if (entries.length) {
    const attached = (instance.payload.attributeIds ?? []).map(id => requiredEntity(document, id))
    if (attached.length) {
      const byTag = new Map<string, KJReadonlyObjectRecord>()
      for (const attribute of attached) {
        if (attribute.type !== 'ATTRIB' || attribute.payload.parentInsertId !== instance.id) throw new KJValidationError('BLOCKINSTANCEUPDATE found an invalid attached attribute relationship')
        const tag = String(attribute.payload.tag ?? '').trim().toUpperCase()
        if (!tag || byTag.has(tag)) throw new KJValidationError('BLOCKINSTANCEUPDATE requires unique non-empty native attribute tags')
        byTag.set(tag, attribute)
      }
      const seen = new Set<string>()
      for (const [inputTag, value] of entries) {
        const tag = inputTag.trim().toUpperCase()
        if (!tag || seen.has(tag)) throw new KJValidationError('BLOCKINSTANCEUPDATE attribute tags must be unique and non-empty')
        seen.add(tag)
        const attribute = byTag.get(tag)
        if (!attribute) throw new KJValidationError(`BLOCKINSTANCEUPDATE attribute tag does not exist: ${inputTag}`)
        if (value != null && !['string', 'number', 'boolean'].includes(typeof value)) throw new KJValidationError(`BLOCKINSTANCEUPDATE attribute value must be scalar: ${inputTag}`)
      }
      for (const [inputTag, value] of entries) {
        const attribute = byTag.get(inputTag.trim().toUpperCase())!
        changedAttributes.push(transaction.updateObject(attribute.id, { payload: { text: String(value ?? '') } }))
      }
    } else {
      const legacy = instance.payload.attributes
      const next = legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? clone(legacy as KJObjectPayload) : {}
      for (const [tag, value] of entries) {
        if (!tag.trim() || value != null && !['string', 'number', 'boolean'].includes(typeof value)) throw new KJValidationError('BLOCKINSTANCEUPDATE legacy attribute values require non-empty tags and scalar values')
        next[tag] = String(value ?? '')
      }
      if (patch) patch.attributes = next
      else return { instance: transaction.updateObject(instance.id, { payload: { attributes: next } }), attributes: [] }
    }
  }
  return {
    instance: patch ? transaction.updateObject(instance.id, { payload: patch }) : transaction.getObject(instance.id)!,
    attributes: changedAttributes,
  }
}

function updateBlockDefinition(
  { document, transaction }: KJCommandContext,
  args: KJCommandArguments,
): { block: KJReadonlyObjectRecord; entity: KJObjectRecord } {
  const block = resolveTableRecord(document, 'blockRecords', args.blockRecordId)
  if (block.payload.isSpace === true) throw new KJValidationError('BLOCKDEFINITIONUPDATE cannot edit model or paper spaces')
  if (block.payload.importedPlaceholder === true) throw new KJValidationError('BLOCKDEFINITIONUPDATE requires a complete local block definition')
  const entity = requiredEntity(document, args.id)
  if (entity.ownerId !== block.id || !(block.payload.entityIds ?? []).includes(entity.id)) {
    throw new KJValidationError('BLOCKDEFINITIONUPDATE entity must be a direct member of the explicit block definition')
  }
  const patch = payloadPatch(args.patch, 'BLOCKDEFINITIONUPDATE')
  if (entity.type === 'INSERT' && Object.hasOwn(patch, 'attributes') && (entity.payload.attributeIds?.length || entity.payload.sequenceEndId)) {
    throw new KJValidationError('BLOCKDEFINITIONUPDATE cannot replace native attached attributes')
  }
  if (entity.type === 'INSERT' && (entity.payload.attributeIds?.length || entity.payload.sequenceEndId) && ['position', 'rotation', 'scale'].some(field => Object.hasOwn(patch, field))) {
    const position = vec3(patch.position ?? entity.payload.position, 'INSERT position')
    const rotation = Number(patch.rotation ?? entity.payload.rotation ?? 0)
    if (!Number.isFinite(rotation)) throw new KJValidationError('INSERT rotation must be finite')
    const scale = (value: unknown, label: string): Point3 => {
      const result = Array.isArray(value) ? vec3(value, label) : [Number(value ?? 1), Number(value ?? 1), Number(value ?? 1)] as Point3
      if (!result.every(component => Number.isFinite(component) && Math.abs(component) > 1e-15)) throw new KJValidationError(`${label} must contain three finite non-zero values`)
      return result
    }
    const previousPosition = vec3(entity.payload.position, 'current INSERT position'), previousScale = scale(entity.payload.scale, 'current INSERT scale'), nextScale = scale(patch.scale ?? entity.payload.scale, 'INSERT scale')
    const ratios = nextScale.map((component, index) => component / previousScale[index]!)
    if (ratios.some(ratio => ratio <= 0) || ratios.some(ratio => Math.abs(ratio - ratios[0]!) > 1e-9 * Math.max(1, Math.abs(ratio), Math.abs(ratios[0]!)))) {
      throw new KJValidationError('Attributed nested INSERT scale changes must use one positive uniform factor')
    }
    const matrix = (point: Point3, factors: Point3, angle: number): AffineMatrix3 => {
      const cosine = Math.cos(angle), sine = Math.sin(angle)
      return [factors[0] * cosine, factors[0] * sine, -factors[1] * sine, factors[1] * cosine, point[0], point[1]]
    }
    transaction.transformEntity(entity.id, multiply3(matrix(position, nextScale, rotation), invert3(matrix(previousPosition, previousScale, Number(entity.payload.rotation ?? 0)))))
    delete patch.position; delete patch.rotation; delete patch.scale
    return { block, entity: Object.keys(patch).length ? transaction.updateObject(entity.id, { payload: patch }) : transaction.getObject(entity.id)! }
  }
  return { block, entity: transaction.updateObject(entity.id, { payload: patch }) }
}

function validateDrawingPropertiesPatch(document: KJDocument, patch: KJObjectPatch | undefined): void {
  const payload = patch?.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  if (Object.hasOwn(payload, 'linetypeScale')) {
    const value = payload.linetypeScale
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new KJValidationError('linetypeScale must be positive and finite')
  }
  if (Object.hasOwn(payload, 'linetypeId') && payload.linetypeId != null) resolveTableRecord(document, 'linetypes', payload.linetypeId)
}

function resolveTableRecord(document: KJDocument, tableName: KJTableName, value: unknown): KJReadonlyObjectRecord {
  const table = document?.getTable(tableName)
  const key = String(value ?? '').toUpperCase()
  const record = table?.records.find(item => item.id === String(value) || String(item.name).toUpperCase() === key)
  if (!record) throw new KJValidationError(`${tableName} record does not exist: ${value}`)
  return record
}

function findTableRecord(document: KJDocument, tableName: KJTableName, value: unknown): KJReadonlyObjectRecord | null {
  const key = String(value ?? '').toUpperCase()
  return document.getTable(tableName)?.records.find(item => item.id === String(value) || String(item.name).toUpperCase() === key) ?? null
}

const KJ_LAYER_LINEWEIGHTS = new Set([-3, -2, -1, 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211])
const KJ_LAYER_PATCH_KEYS = new Set(['color', 'trueColor', 'linetypeId', 'linetypeName', 'lineweight', 'visible', 'frozen', 'locked', 'plottable'])

function normalizeLayerName(value: unknown): string {
  const name = String(value ?? '').trim()
  if (!name) throw new KJValidationError('Layer name is required')
  if (name.length > 255 || /[\u0000-\u001f]/u.test(name) || [...'<>/\\":;?*|=,'].some(character => name.includes(character))) throw new KJValidationError(`Invalid layer name: ${name}`)
  return name
}

function normalizeLayerPatch(document: KJDocument, value: unknown): KJObjectPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KJValidationError('Layer properties must be an object')
  const source = value as Record<string, unknown>, patch: KJObjectPayload = {}
  for (const key of Object.keys(source)) if (!KJ_LAYER_PATCH_KEYS.has(key)) throw new KJValidationError(`Unsupported layer property: ${key}`)
  if (Object.hasOwn(source, 'color')) {
    const color = Number(source.color)
    if (!Number.isInteger(color) || color < 1 || color > 255) throw new KJValidationError('Layer color must be an integer from 1 to 255')
    patch.color = color
  }
  if (Object.hasOwn(source, 'trueColor')) {
    if (source.trueColor == null) patch.trueColor = null
    else {
      const trueColor = Number(source.trueColor)
      if (!Number.isInteger(trueColor) || trueColor < 0 || trueColor > 0xffffff) throw new KJValidationError('Layer true color must be an integer from 0 to 16777215')
      patch.trueColor = trueColor
    }
  }
  if (Object.hasOwn(source, 'linetypeId') || Object.hasOwn(source, 'linetypeName')) {
    const candidate = source.linetypeId ?? source.linetypeName
    const linetype = resolveTableRecord(document, 'linetypes', candidate)
    patch.linetypeId = linetype.id
    patch.linetypeName = linetype.name
  }
  if (Object.hasOwn(source, 'lineweight')) {
    const lineweight = Number(source.lineweight)
    if (!Number.isInteger(lineweight) || !KJ_LAYER_LINEWEIGHTS.has(lineweight)) throw new KJValidationError(`Unsupported layer lineweight: ${source.lineweight}`)
    patch.lineweight = lineweight
  }
  for (const key of ['visible', 'frozen', 'locked', 'plottable'] as const) {
    if (Object.hasOwn(source, key)) {
      if (typeof source[key] !== 'boolean') throw new KJValidationError(`Layer ${key} must be boolean`)
      patch[key] = source[key]
    }
  }
  return patch
}

function resolveLayout(document: KJDocument, value: unknown): KJReadonlyObjectRecord {
  const key = String(value ?? '').toUpperCase()
  const layout = document.spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.id === String(value) || String(record?.name).toUpperCase() === key)
  if (!layout) throw new KJValidationError(`Layout does not exist: ${value}`)
  return layout
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  const result = value == null ? fallback : Number(value)
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new KJValidationError(`${label} must be an integer from ${minimum} to ${maximum}`)
  return result
}

function assertBlockGraph(transaction: KJTransaction, rootBlockId: string, args: KJCommandArguments): void {
  const state = transaction._draft()
  const maximumDepth = boundedInteger(args.maxBlockDepth, 16, 1, 64, 'maxBlockDepth')
  const maximumEntities = boundedInteger(args.maxExpandedEntities, 8192, 1, 100000, 'maxExpandedEntities')
  let expandedEntities = 0
  const visit = (blockId: string, path: readonly string[], depth: number): void => {
    if (depth > maximumDepth) throw new KJValidationError(`Block nesting exceeds maxBlockDepth ${maximumDepth}`)
    if (path.includes(blockId)) throw new KJValidationError(`Block nesting cycle detected: ${[...path, blockId].join(' -> ')}`)
    const block = state.objects[blockId]
    if (!block || block.kind !== 'block-record' || block.payload.isSpace === true) throw new KJValidationError(`Nested block definition does not exist: ${blockId}`)
    const nextPath = [...path, blockId]
    for (const id of block.payload.entityIds ?? []) {
      const entity = state.objects[id]
      if (!entity || entity.kind !== 'entity' || entity.ownerId !== blockId || entity.erased) continue
      if (++expandedEntities > maximumEntities) throw new KJValidationError(`Expanded block content exceeds maxExpandedEntities ${maximumEntities}`)
      if (entity.type === 'INSERT') visit(String(entity.payload.blockRecordId ?? ''), nextPath, depth + 1)
    }
  }
  visit(rootBlockId, [], 1)
}

function blockAttributeDefinitions(args: KJCommandArguments): readonly KJBlockAttributeDefinitionInput[] {
  const values = args.attributeDefinitions ?? []
  if (!Array.isArray(values)) throw new KJValidationError('attributeDefinitions must be an array')
  if (values.length > 64) throw new KJValidationError('A block supports at most 64 attribute definitions')
  const tags = new Set<string>()
  return values.map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new KJValidationError(`attributeDefinitions[${index}] must be an object`)
    const tag = String(source.tag ?? '').trim()
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(tag)) throw new KJValidationError(`Invalid block attribute tag: ${tag || '<empty>'}`)
    const key = tag.toUpperCase()
    if (tags.has(key)) throw new KJValidationError(`Duplicate block attribute tag: ${tag}`)
    tags.add(key)
    const prompt = String(source.prompt ?? tag)
    if (prompt.length > 256) throw new KJValidationError(`Block attribute prompt is too long: ${tag}`)
    const defaultValue = source.defaultValue
    if (defaultValue != null && !['string', 'number', 'boolean'].includes(typeof defaultValue)) throw new KJValidationError(`Block attribute default must be scalar: ${tag}`)
    return { ...source, tag, prompt, defaultValue: defaultValue == null ? '' : defaultValue }
  })
}

function scalarAttributeValues(value: unknown): Map<string, string> {
  if (value == null) return new Map()
  if (typeof value !== 'object' || Array.isArray(value)) throw new KJValidationError('attributeValues must be an object keyed by attribute tag')
  const result = new Map<string, string>()
  for (const [inputTag, inputValue] of Object.entries(value as Readonly<Record<string, unknown>>)) {
    const tag = inputTag.trim().toUpperCase()
    if (!tag || result.has(tag)) throw new KJValidationError('attributeValues tags must be unique and non-empty')
    if (inputValue != null && !['string', 'number', 'boolean'].includes(typeof inputValue)) throw new KJValidationError(`Block attribute value must be scalar: ${inputTag}`)
    result.set(tag, String(inputValue ?? ''))
  }
  if (result.size > 64) throw new KJValidationError('A block insertion supports at most 64 attribute values')
  return result
}

function createNativeBlockInsert(transaction: KJTransaction, blockRecordId: string, args: KJCommandArguments): { instance: KJObjectRecord; attributes: readonly KJObjectRecord[] } {
  const state = transaction._draft(), block = state.objects[blockRecordId]
  if (!block || block.kind !== 'block-record' || block.payload.isSpace === true) throw new KJValidationError(`Block definition does not exist: ${blockRecordId}`)
  const position = vec3(args.position ?? [0, 0, 0], 'position')
  const scale = Array.isArray(args.scale) ? vec3(args.scale, 'scale') : [Number(args.scale ?? 1), Number(args.scale ?? 1), Number(args.scale ?? 1)] as Point3
  if (!scale.every(value => Number.isFinite(value) && Math.abs(value) > 1e-15)) throw new KJValidationError('Block insert scale must contain three finite non-zero values')
  const rotation = Number(args.rotation ?? 0)
  if (!Number.isFinite(rotation)) throw new KJValidationError('Block insert rotation must be finite')
  const instance = transaction.createEntity('INSERT', { blockRecordId, position, scale, rotation, attributes: {}, attributeIds: [], sequenceEndId: null, ...(args.layerId == null ? {} : { layerId: args.layerId }) }, { ownerId: args.ownerId } as KJObjectSpec)
  const definitions = (block.payload.entityIds ?? []).flatMap(id => {
    const entity = transaction.getObject(id)
    return entity?.kind === 'entity' && entity.type === 'ATTDEF' && !entity.erased ? [entity] : []
  })
  const byTag = new Map<string, (typeof definitions)[number]>()
  for (const definition of definitions) {
    const tag = String(definition.payload.tag ?? '').trim().toUpperCase()
    if (!tag || byTag.has(tag)) throw new KJValidationError('Block definition requires unique non-empty ATTDEF tags')
    byTag.set(tag, definition)
  }
  const values = scalarAttributeValues(args.attributeValues)
  for (const tag of values.keys()) if (!byTag.has(tag)) throw new KJValidationError(`Block attribute tag does not exist: ${tag}`)
  if (!definitions.length) return { instance, attributes: [] }
  const cosine = Math.cos(rotation), sine = Math.sin(rotation)
  const matrix: AffineMatrix3 = [scale[0] * cosine, scale[0] * sine, -scale[1] * sine, scale[1] * cosine, position[0], position[1]]
  const attributes = definitions.map(definition => transaction.createEntity('ATTRIB', {
    ...transformEntityPayload('ATTDEF', definition.payload, matrix),
    text: values.get(String(definition.payload.tag).trim().toUpperCase()) ?? String(definition.payload.text ?? ''),
    parentInsertId: instance.id,
  }, { ownerId: instance.ownerId }))
  const sequence = transaction.createObject({ kind: 'custom', type: 'SEQEND', ownerId: instance.id, payload: { dxfOwnerMode: 'insert', ...(instance.payload.layerId == null ? {} : { layerId: instance.payload.layerId }) } })
  const updated = transaction.updateObject(instance.id, { payload: { attributeIds: attributes.map(attribute => attribute.id), sequenceEndId: sequence.id } })
  return { instance: updated, attributes }
}

function createBlockDefinition({ document, transaction }: KJCommandContext, args: KJCommandArguments): { block: KJObjectRecord; insert: KJObjectRecord | null; attributeDefinitions: readonly KJObjectRecord[]; attributes: readonly KJObjectRecord[] } {
  const name = String(args.name ?? '').trim()
  if (!name) throw new KJValidationError('Block name is required')
  if (document.getTable('blockRecords')?.records.some(record => String(record.name).toUpperCase() === name.toUpperCase())) throw new KJValidationError(`Block already exists: ${name}`)
  const entities = entityIds(args).map(id => requiredEntity(document, id))
  const ownerId = String(args.ownerId ?? entities[0]!.ownerId)
  if (entities.some(entity => entity.ownerId !== ownerId)) throw new KJValidationError('Block source entities must share one owner')
  const basePoint = vec2(args.basePoint ?? [0, 0])
  const block = transaction.upsertTableRecord('blockRecords', {
    name, type: 'BLOCK_RECORD', payload: { entityIds: [], isSpace: false, basePoint: [0, 0, 0], description: args.description ?? null },
  })
  const localMatrix = translation3(-basePoint[0], -basePoint[1])
  const attributeDefinitions = blockAttributeDefinitions(args).map(definition => transaction.createEntity('ATTDEF', {
    position: definition.position ?? [0, 0, 0], text: String(definition.defaultValue ?? ''), tag: definition.tag, prompt: String(definition.prompt ?? definition.tag),
    height: definition.height ?? 2.5, rotation: definition.rotation ?? 0, flags: definition.flags ?? 0, ...(definition.layerId == null ? {} : { layerId: definition.layerId }),
  }, { ownerId: block.id }))
  if (args.keepSource) {
    if (entities.some(entity => entity.type === 'INSERT' && (entity.payload.attributeIds?.length || entity.payload.sequenceEndId))) throw new KJValidationError('BLOCKCREATE keepSource does not support attributed INSERT sources')
    for (const entity of entities) transaction.createEntity(entity.type, transformEntityPayload(entity.type, entity.payload, localMatrix), {
      ownerId: block.id, name: entity.name, extension: entity.extension as unknown as NonNullable<KJObjectSpec['extension']>, source: { blockSourceId: entity.id, blockSourceHandle: entity.handle },
    })
    assertBlockGraph(transaction, block.id, args)
    return { block: transaction.getObject(block.id)!, insert: null, attributeDefinitions, attributes: [] }
  }
  for (const entity of entities) {
    if (entity.payload.parentInsertId) throw new KJValidationError('BLOCKCREATE requires selecting the parent INSERT instead of an attached ATTRIB')
    if (entity.type === 'INSERT' && (entity.payload.attributeIds?.length || entity.payload.sequenceEndId)) transaction.transformEntity(entity.id, localMatrix)
    else transaction.updateObject(entity.id, { payload: transformEntityPayload(entity.type, entity.payload, localMatrix) })
    transaction.reparentObject(entity.id, block.id)
  }
  const created = createNativeBlockInsert(transaction, block.id, { ...args, ownerId, position: [basePoint[0], basePoint[1], Number((args.basePoint as readonly unknown[] | undefined)?.[2] ?? 0)], scale: 1, rotation: 0 })
  replaceEntityMemberships(transaction, entities.map(entity => entity.id), [created.instance.id])
  assertBlockGraph(transaction, block.id, args)
  const owner = transaction.getObject(ownerId)
  if (owner?.kind === 'block-record' && owner.payload.isSpace !== true) assertBlockGraph(transaction, owner.id, args)
  return { block: transaction.getObject(block.id)!, insert: created.instance, attributeDefinitions, attributes: created.attributes }
}

function createObjectGroup(document: KJDocument, transaction: KJTransaction, args: KJCommandArguments): KJObjectRecord {
  const name = String(args.name ?? '').trim()
  if (!name) throw new KJValidationError('Group name is required')
  const memberIds = entityIds(args).map(id => requiredEntity(document, id).id)
  const existing = document.listObjects({ kind: 'group' }).find(group => String(group.name).toUpperCase() === name.toUpperCase())
  if (existing) throw new KJValidationError(`Group already exists: ${name}`)
  const group = transaction.createObject({
    kind: 'group', type: 'GROUP', ownerId: document.snapshot().namedObjectsDictionaryId,
    name, payload: { memberIds, selectable: args.selectable !== false, description: args.description ?? null },
  })
  transaction.addDictionaryEntry(document.snapshot().namedObjectsDictionaryId, `KJDRAW_GROUP:${name}`, group.id)
  return group
}

function searchDocument(document: KJDocument, args: KJCommandArguments = {}) {
  const query = String(args.query ?? '').trim().toLocaleLowerCase()
  if (!query) throw new KJValidationError('Search query is required')
  const kinds = args.kinds?.length ? new Set(args.kinds.map(String)) : null
  const types = args.types?.length ? new Set(args.types.map(value => String(value).toUpperCase())) : null
  const limit = Number(args.limit ?? 1000)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) throw new KJValidationError('Search limit must be an integer from 1 to 100000')
  const matches: Array<Readonly<{ id: string; handle: string; kind: string; type: string; name: string | null; matchedFields: readonly string[] }>> = []
  for (const object of document.listObjects({ includeErased: Boolean(args.includeErased) })) {
    if (kinds && !kinds.has(object.kind)) continue
    if (types && !types.has(object.type)) continue
    const fields = {
      id: object.id, handle: object.handle, kind: object.kind, type: object.type,
      name: object.name ?? '', payload: JSON.stringify(object.payload ?? {}),
      xdata: JSON.stringify(object.extension?.xdata ?? {}),
    }
    const matchedFields = Object.entries(fields).filter(([, value]) => String(value).toLocaleLowerCase().includes(query)).map(([name]) => name)
    if (matchedFields.length) matches.push(Object.freeze({ id: object.id, handle: object.handle, kind: object.kind, type: object.type, name: object.name, matchedFields: Object.freeze(matchedFields) }))
    if (matches.length >= limit) break
  }
  return Object.freeze({ query, count: matches.length, truncated: matches.length === limit, matches: Object.freeze(matches) })
}

interface KJComparableObject {
  readonly id: string
  readonly handle: string
  readonly type: string
  readonly source?: unknown
  readonly [property: string]: unknown
}

function compareDocuments(current: KJDocument, otherInput: unknown) {
  const source = otherInput as { snapshot?: () => unknown; toJSON?: () => unknown } | null | undefined
  const snapshot = source?.snapshot?.() ?? source?.toJSON?.() ?? otherInput
  if (!snapshot || typeof snapshot !== 'object' || !('objects' in snapshot) || !snapshot.objects || typeof snapshot.objects !== 'object') throw new KJValidationError('COMPARE requires another KJDocument or document state')
  const left = new Map(current.listObjects({ includeErased: true }).map(object => [object.handle, object]))
  const right = new Map<string, KJComparableObject>(Object.values(snapshot.objects).map(object => {
    const comparableObject = object as KJComparableObject
    return [String(comparableObject.handle).toUpperCase(), comparableObject]
  }))
  const added: Array<{ handle: string; type: string; afterId: string }> = []
  const removed: Array<{ handle: string; type: string; beforeId: string }> = []
  const changed: Array<{ handle: string; beforeId: string; afterId: string; beforeType: string; afterType: string }> = []
  const unchanged: Array<{ handle: string; type: string; beforeId: string; afterId: string }> = []
  const comparable = (object: KJComparableObject | KJReadonlyObjectRecord): Record<string, unknown> => {
    const value = clone(object) as Record<string, unknown>
    delete value.id
    delete value.source
    return value
  }
  for (const handle of [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => parseInt(a, 16) - parseInt(b, 16))) {
    const before = left.get(handle), after = right.get(handle)
    if (!before) added.push({ handle, type: after!.type, afterId: after!.id })
    else if (!after) removed.push({ handle, type: before.type, beforeId: before.id })
    else if (stableHash(comparable(before)) !== stableHash(comparable(after))) changed.push({ handle, beforeId: before.id, afterId: after.id, beforeType: before.type, afterType: after.type })
    else unchanged.push({ handle, type: before.type, beforeId: before.id, afterId: after.id })
  }
  return deepFreeze({ identical: !added.length && !removed.length && !changed.length, added, removed, changed, unchanged, counts: { added: added.length, removed: removed.length, changed: changed.length, unchanged: unchanged.length } })
}

function moveMatrix(args: KJCommandArguments): AffineMatrix3 {
  if (args.from != null || args.to != null) {
    const from = vec2(args.from ?? [0, 0]), to = vec2(args.to ?? [0, 0])
    return translation3(to[0] - from[0], to[1] - from[1])
  }
  const dx = Number(args.dx ?? 0), dy = Number(args.dy ?? 0)
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new KJValidationError('Move displacement must be finite')
  return translation3(dx, dy)
}

function commandAngle(args: KJCommandArguments): number {
  const value = args.angleDegrees == null ? Number(args.angle ?? 0) : Number(args.angleDegrees) * Math.PI / 180
  if (!Number.isFinite(value)) throw new KJValidationError('Rotation angle must be finite')
  return value
}

function transformExisting({ document, transaction }: KJCommandContext, args: KJCommandArguments, matrix: AffineMatrix3Input): KJObjectRecord[] {
  const selected = new Set(entityIds(args))
  const transformed = [...selected].filter(id => {
    const entity = requiredEntity(document, id)
    return !entity.payload.parentInsertId || !selected.has(entity.payload.parentInsertId)
  }).flatMap(id => transaction.transformEntity(id, matrix))
  refreshAssociativeDimensions(transaction, transformed.map(entity => entity.id))
  return transformed
}

function requireSelectedAssociativeDimensions(document: KJDocument, selectedIds: readonly string[], command: string): void {
  const selected = new Set(selectedIds)
  for (const dimension of document.listEntities({ type: 'DIMENSION' })) {
    if (!Array.isArray(dimension.payload.dimensionAssociations) || selected.has(dimension.id)) continue
    const associations = normalizeDimensionAssociations(dimension.payload.dimensionAssociations)
    if (associations.some(association => selected.has(association.entityId))) {
      throw new KJValidationError(`${command} must include dimension ${dimension.id} when erasing one of its referenced sources`)
    }
  }
}

function copyEntities({ document, transaction }: KJCommandContext, args: KJCommandArguments, matrix: AffineMatrix3Input, command: string): KJObjectRecord[] {
  const selected = new Set(entityIds(args))
  const sourceIds = [...selected].filter(id => {
    const entity = requiredEntity(document, id)
    return !entity.payload.parentInsertId || !selected.has(entity.payload.parentInsertId)
  })
  const copiedSourceIds = new Set(sourceIds)
  for (const id of sourceIds) {
    const dimension = requiredEntity(document, id)
    if (dimension.type !== 'DIMENSION' || !Array.isArray(dimension.payload.dimensionAssociations)) continue
    const missing = normalizeDimensionAssociations(dimension.payload.dimensionAssociations).find(association => !copiedSourceIds.has(association.entityId))
    if (missing) throw new KJValidationError(`${command} cannot copy associated dimension ${dimension.id} without source ${missing.entityId}`)
  }
  const copies = sourceIds.map(id => {
    const entity = requiredEntity(document, id)
    if (entity.payload.parentInsertId) throw new KJValidationError('Copy attached attributes through their INSERT')
    const attributed = entity.type === 'INSERT' && Boolean(entity.payload.attributeIds?.length || entity.payload.sequenceEndId)
    if (attributed && args.payloadPatch && Object.keys(args.payloadPatch).length) throw new KJValidationError('Attributed INSERT copy does not support payloadPatch')
    const children = attributed ? (entity.payload.attributeIds ?? []).map(childId => requiredEntity(document, childId)) : []
    if (attributed) for (const source of [entity, ...children]) {
      const layer = source.payload.layerId ? document.getObject(source.payload.layerId) : null
      if (layer && (layer.payload.locked === true || layer.payload.frozen === true || layer.payload.visible === false)) throw new KJValidationError('Copy requires writable layers for the INSERT and every attached attribute')
    }
    const copied = transaction.createEntity(entity.type, { ...transformEntityPayload(entity.type, entity.payload, matrix), ...clone(args.payloadPatch ?? {}), ...(attributed ? { attributeIds: [], sequenceEndId: null } : {}) }, {
      ownerId: args.ownerId ?? entity.ownerId,
      name: entity.name,
      extension: entity.extension as unknown as NonNullable<KJObjectSpec['extension']>,
      source: { copiedFromId: entity.id, copiedFromHandle: entity.handle },
    })
    if (!attributed) return copied
    const attributeIds = children.map(child => transaction.createEntity('ATTRIB', { ...transformEntityPayload('ATTRIB', child.payload, matrix), parentInsertId: copied.id }, {
      ownerId: copied.ownerId, name: child.name, extension: clone(child.extension) as NonNullable<KJObjectSpec['extension']>, source: { copiedFromId: child.id, copiedFromHandle: child.handle },
    }).id)
    const end = entity.payload.sequenceEndId ? document.getObject(entity.payload.sequenceEndId) : null
    if (!end) throw new KJValidationError('Attributed INSERT sequence end is missing')
    const sequence = transaction.createObject({ kind: 'custom', type: 'SEQEND', ownerId: copied.id, payload: clone(end.payload) as KJObjectPayload, extension: clone(end.extension) as NonNullable<KJObjectSpec['extension']>, source: { copiedFromId: end.id, copiedFromHandle: end.handle } })
    return transaction.updateObject(copied.id, { payload: { attributeIds, sequenceEndId: sequence.id } })
  })
  const replacements = new Map(sourceIds.map((id, index) => [id, copies[index]!.id]))
  const retargeted = copies.map((copy, index) => {
    const source = requiredEntity(document, sourceIds[index]!)
    if (source.type !== 'DIMENSION' || !Array.isArray(source.payload.dimensionAssociations)) return copy
    const dimensionAssociations = normalizeDimensionAssociations(source.payload.dimensionAssociations).map(association => ({
      ...association, entityId: replacements.get(association.entityId)!,
    }))
    return transaction.updateObject(copy.id, { payload: { dimensionAssociations } })
  })
  refreshAssociativeDimensions(transaction, retargeted.filter(object => object.type !== 'DIMENSION').map(object => object.id))
  return retargeted.map(object => transaction.getObject(object.id)!)
}

function rejectAttachedReorganization(document: KJDocument, args: KJCommandArguments, command: string): void {
  for (const id of entityIds(args)) {
    const entity = requiredEntity(document, id)
    if (entity.payload.parentInsertId || (entity.type === 'INSERT' && (entity.payload.attributeIds?.length || entity.payload.sequenceEndId))) throw new KJValidationError(`${command} does not yet support attached attribute sequences`)
  }
}

function createDerived(transaction: KJTransaction, source: KJReadonlyObjectRecord, type: string, payload: KJObjectPayload): KJObjectRecord {
  return transaction.createEntity(type, payload, {
    ownerId: source.ownerId, name: source.name,
    extension: source.extension as unknown as NonNullable<KJObjectSpec['extension']>, source: { derivedFromId: source.id, derivedFromHandle: source.handle },
  })
}

function replaceEntityMemberships(transaction: KJTransaction, sourceIds: readonly string[], retainedIds: readonly string[]): void {
  const sources = new Set(sourceIds)
  for (const group of Object.values(transaction._draft().objects)) {
    if (group.erased || group.kind !== 'group' || !['GROUP', 'SELECTION_SET'].includes(group.type)) continue
    const members = group.payload.memberIds
    if (!Array.isArray(members) || !members.some(id => sources.has(id))) continue
    const memberIds = [...new Set(members.flatMap(id => sources.has(id) ? [...retainedIds] : [id]))]
    if (memberIds.length === members.length && memberIds.every((id, index) => id === members[index])) continue
    transaction.updateObject(group.id, { payload: { memberIds } })
  }
}

function replaceCopiedMemberships(transaction: KJTransaction, replacements: ReadonlyMap<string, string>): void {
  for (const group of Object.values(transaction._draft().objects)) {
    if (group.erased || group.kind !== 'group' || !['GROUP', 'SELECTION_SET'].includes(group.type)) continue
    const members = group.payload.memberIds
    if (!Array.isArray(members) || !members.some(id => replacements.has(id))) continue
    const memberIds = [...new Set(members.map(id => replacements.get(id) ?? id))]
    transaction.updateObject(group.id, { payload: { memberIds } })
  }
}

function requiredBoundaries(document: KJDocument, ids: readonly string[] | undefined, targetId?: string): KJReadonlyObjectRecord[] {
  if (!Array.isArray(ids) || !ids.length) throw new KJValidationError('Boundary entity ids are required')
  if (targetId && ids.includes(targetId)) throw new KJValidationError('The target cannot also be a cutting boundary')
  return ids.map(id => requiredEntity(document, id))
}

function editLinePair(
  { document, transaction }: KJCommandContext,
  args: KJCommandArguments,
  operation: (first: KJReadonlyObjectRecord, second: KJReadonlyObjectRecord, options: KJLinePairOptions) => KJLinePairEditResult,
) {
  const first = requiredEntity(document, args.firstId), second = requiredEntity(document, args.secondId)
  if (first.id === second.id) throw new KJValidationError('Line pair operation requires two different entities')
  const result = operation(first, second, args)
  const updatedFirst = transaction.updateObject(first.id, { payload: result.first })
  const updatedSecond = transaction.updateObject(second.id, { payload: result.second })
  let connector = null
  if (result.connector.type !== 'LINE' || Math.hypot(result.connector.payload.end[0] - result.connector.payload.start[0], result.connector.payload.end[1] - result.connector.payload.start[1]) > 1e-12) {
    connector = createDerived(transaction, first, result.connector.type, { ...result.connector.payload, ...clone(args.connectorPayloadPatch ?? {}) })
  }
  return { first: updatedFirst, second: updatedSecond, connector }
}

const MAX_ARRAY_ENTITY_CREATIONS = 100000

function assertArrayCreationLimit(args: KJCommandArguments, copyPositionCount: number): void {
  const selectedEntityCount = entityIds(args).length
  if (copyPositionCount > Math.floor(MAX_ARRAY_ENTITY_CREATIONS / selectedEntityCount)) {
    throw new KJValidationError(`Array exceeds the ${MAX_ARRAY_ENTITY_CREATIONS} created entity safety limit`)
  }
}

function rectangularArray(context: KJCommandContext, args: KJCommandArguments): KJObjectRecord[] {
  rejectAttachedReorganization(context.document, args, 'ARRAYRECT')
  const rows = Number(args.rows ?? 1), columns = Number(args.columns ?? 1)
  const rowSpacing = Number(args.rowSpacing ?? 0), columnSpacing = Number(args.columnSpacing ?? 0)
  if (![rows, columns].every(Number.isInteger) || rows < 1 || columns < 1) throw new KJValidationError('Array rows and columns must be positive integers')
  if (rows * columns > 100000) throw new KJValidationError('Array exceeds the 100000 instance safety limit')
  if (![rowSpacing, columnSpacing].every(Number.isFinite)) throw new KJValidationError('Array spacing must be finite')
  const copyPositionCount = rows * columns - (args.includeSource !== false ? 1 : 0)
  assertArrayCreationLimit(args, copyPositionCount)
  const created: KJObjectRecord[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (row === 0 && column === 0 && args.includeSource !== false) continue
      created.push(...copyEntities(context, args, translation3(column * columnSpacing, row * rowSpacing), 'ARRAYRECT'))
    }
  }
  return created
}

function polarArray(context: KJCommandContext, args: KJCommandArguments): KJObjectRecord[] {
  rejectAttachedReorganization(context.document, args, 'ARRAYPOLAR')
  const count = Number(args.count ?? args.items)
  if (!Number.isInteger(count) || count < 2 || count > 100000) throw new KJValidationError('Polar array count must be an integer from 2 to 100000')
  const center = vec2(args.center!)
  const fillAngle = args.angleDegrees == null ? Number(args.angle ?? Math.PI * 2) : Number(args.angleDegrees) * Math.PI / 180
  if (!Number.isFinite(fillAngle) || Math.abs(fillAngle) <= 1e-15) throw new KJValidationError('Polar array fill angle must be finite and non-zero')
  assertArrayCreationLimit(args, count - 1)
  const fullCircle = Math.abs(Math.abs(fillAngle) - Math.PI * 2) <= 1e-10
  const step = fillAngle / (fullCircle ? count : count - 1), created: KJObjectRecord[] = []
  for (let index = 1; index < count; index += 1) {
    const rotation = rotationAround3(step * index, center)
    let matrix = rotation
    if (args.rotateItems === false) {
      const basePoint = vec2(args.basePoint!)
      const rotated = transformPoint3(rotation, basePoint)
      matrix = translation3(rotated[0] - basePoint[0], rotated[1] - basePoint[1])
    }
    created.push(...copyEntities(context, args, matrix, 'ARRAYPOLAR'))
  }
  return created
}
