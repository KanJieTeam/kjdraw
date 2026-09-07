import { KJRegistrationError, KJValidationError } from './errors.js'
import {
  entityArea2,
  entityLength2,
  distance2,
  dot2,
  reflectionAcrossLine3,
  rotationAround3,
  scaleAround3,
  transformEntityPayload,
  transformPoint3,
  translation3,
  vec2,
  subtract2,
} from './geometry/index.js'
import { clone, deepFreeze, stableHash } from './utils.js'
import { editEntityGrip } from './grips.js'
import { intersectEntityPair2, nearestPointOnEntity2 } from './snapping.js'
import { KJ_SNAP_MODES } from './snapping.js'
import {
  breakEntityPayloads,
  chamferLinePair,
  explodeEntity,
  extendLinePayload,
  filletLinePair,
  offsetEntityPayload,
  trimLinePayload,
} from './editing.js'

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
  BREAK: { domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE', 'ARC'] },
  EXPLODE: { domain: 'topology', precision: 'exact', supportedEntityTypes: ['LWPOLYLINE', 'POLYLINE', 'REVISION_CLOUD', 'WIPEOUT'] },
  TRIM: { domain: 'topology', precision: 'exact', targetEntityTypes: ['LINE'], boundaryEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'] },
  EXTEND: { domain: 'topology', precision: 'exact', targetEntityTypes: ['LINE'], boundaryEntityTypes: ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'] },
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
  SNAPSETTINGS: { domain: 'drafting-settings', snapModes: KJ_SNAP_MODES },
  BLOCKCREATE: { domain: 'block', precision: 'exact', supportedEntityTypes: AFFINE_ENTITY_TYPES },
  BLOCKINSERT: { domain: 'block', entityType: 'INSERT' },
  XREFATTACH: { domain: 'external-reference', authority: 'local-file-or-project-asset', remoteUrls: false },
  XREFRELOAD: { domain: 'external-reference', authority: 'local-file-or-project-asset' },
  XREFDETACH: { domain: 'external-reference' },
  GROUP: { domain: 'group', persistence: 'document-dictionary' },
  HATCH: { domain: 'entity', entityType: 'HATCH', boundaryModes: ['polyline', 'line-arc-edges'] },
  LINETYPE: { domain: 'table', table: 'linetypes', operations: ['create', 'update'] },
  TEXTSTYLE: { domain: 'table', table: 'textStyles', operations: ['create', 'update'] },
  DIMSTYLE: { domain: 'table', table: 'dimensionStyles', operations: ['create', 'update'] },
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
  #commands = new Map()

  register(definition, { owner = 'application', replace = false } = {}) {
    const id = String(definition?.id ?? '').trim().toUpperCase()
    if (!id || typeof definition?.execute !== 'function') throw new KJRegistrationError('Command requires id and execute')
    if (this.#commands.has(id) && !replace) throw new KJRegistrationError(`Command already registered: ${id}`)
    const command = deepFreeze({
      title: id,
      transactional: true,
      aliases: [],
      capabilities: {},
      ...definition,
      id,
      aliases: (definition.aliases ?? []).map(value => String(value).toUpperCase()),
      capabilities: clone(definition.capabilities ?? KJ_CORE_COMMAND_CAPABILITIES[id] ?? {}),
      owner: String(owner),
    })
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

  resolve(id) { return this.#commands.get(String(id).trim().toUpperCase()) ?? null }
  list() { return [...new Set(this.#commands.values())] }

  removeOwner(owner) {
    const targets = new Set([...this.#commands.values()].filter(command => command.owner === owner))
    for (const [key, command] of this.#commands) if (targets.has(command)) this.#commands.delete(key)
    return targets.size
  }

  async execute(id, context = {}, args = {}) {
    const command = this.resolve(id)
    if (!command) throw new KJValidationError(`Unknown command: ${id}`)
    if (command.canExecute && !await command.canExecute(context, clone(args))) throw new KJValidationError(`Command is not available: ${command.id}`)
    if (command.transactional === false) return command.execute({ ...context, transaction: null }, clone(args))
    if (!context.document) throw new KJValidationError(`Command ${command.id} requires a document`)
    return context.document.transact(command.title ?? command.id, transaction => (
      command.execute({ ...context, transaction }, clone(args))
    ), {
      author: context.author,
      source: `command:${command.id}`,
      expectedRevision: context.expectedRevision,
      metadata: {
        commandId: command.id,
        commandEnvelopeId: context.commandEnvelope?.id ?? null,
        commandProtocol: context.commandEnvelope ? `${context.commandEnvelope.schema}@${context.commandEnvelope.schemaVersion}` : null,
        commandOrigin: context.commandEnvelope?.origin ?? null,
      },
    })
  }
}

export function registerCoreCommands(registry) {
  const disposers = []
  disposers.push(registry.register({
    id: 'UNDO', aliases: ['U'], title: 'Undo', transactional: false,
    execute: ({ document, expectedRevision }, args) => document.undo({ author: args.author, source: 'command:UNDO', expectedRevision }),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'REDO', title: 'Redo', transactional: false,
    execute: ({ document, expectedRevision }, args) => document.redo({ author: args.author, source: 'command:REDO', expectedRevision }),
  }, { owner: '@kanjie/kjdraw-sdk' }))
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
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'SELECTIONSAVE', title: 'Save named selection', transactional: false,
    execute: ({ sdk, document }, args) => {
      const manager = sdk.getSelectionManager(document.id)
      if (!manager) throw new KJValidationError('Selection manager is unavailable')
      return manager.saveNamed(args.name, { ids: args.ids ?? manager.active.ids, description: args.description })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'SELECTIONRESTORE', title: 'Restore named selection', transactional: false,
    execute: ({ sdk, document }, args) => {
      const manager = sdk.getSelectionManager(document.id)
      if (!manager) throw new KJValidationError('Selection manager is unavailable')
      return manager.loadNamed(args.name, { append: Boolean(args.append) }).ids
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'CREATE', title: 'Create entity',
    execute: ({ transaction }, args) => transaction.createEntity(args.type, args.payload, args.options),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'CREATEBATCH', title: 'Create entity batch',
    execute: (context, args) => createEntityBatch(context, args),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'ERASE', aliases: ['DELETE'], title: 'Erase objects',
    execute: ({ transaction }, args) => (args.ids ?? [args.id]).filter(Boolean).map(id => transaction.eraseObject(id)),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'RESTORE', title: 'Restore objects',
    execute: ({ transaction }, args) => (args.ids ?? [args.id]).filter(Boolean).map(id => transaction.restoreObject(id)),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'PROPERTIES', title: 'Update object properties',
    execute: ({ transaction }, args) => transaction.updateObject(args.id, args.patch),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'SETVAR', title: 'Set system variable',
    execute: ({ transaction }, args) => transaction.setSystemVariable(args.name, args.value),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'ORTHO', title: 'Set orthogonal drafting mode',
    execute: ({ transaction }, args) => transaction.setSystemVariable('ORTHOMODE', args.enabled === false || Number(args.enabled) === 0 ? 0 : 1),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'SNAPSETTINGS', title: 'Set object snap modes',
    execute: ({ transaction }, args) => {
      const modes = [...new Set((args.modes ?? []).map(value => String(value).toLowerCase()))]
      for (const mode of modes) if (!KJ_SNAP_MODES.includes(mode)) throw new KJValidationError(`Unsupported snap mode: ${mode}`)
      const radius = Number(args.radius ?? 12)
      if (!(radius > 0) || !Number.isFinite(radius)) throw new KJValidationError('Snap radius must be a positive finite number')
      transaction.setSystemVariable('OSMODE', modes)
      transaction.setSystemVariable('APERTURE', radius)
      return { modes, radius }
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'LAYERNEW', title: 'Create layer',
    execute: ({ document, transaction }, args) => transaction.upsertTableRecord('layers', {
      name: args.name,
      type: 'LAYER',
      payload: {
        color: args.color ?? 7,
        linetypeId: args.linetypeId ?? document.snapshot().tables.linetypes.currentId,
        lineweight: args.lineweight ?? -1,
        visible: args.visible !== false,
        frozen: Boolean(args.frozen),
        locked: Boolean(args.locked),
        plottable: args.plottable !== false,
      },
    }),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'LAYERCURRENT', title: 'Set current layer',
    execute: ({ document, transaction }, args) => transaction.setCurrentTableRecord('layers', resolveTableRecord(document, 'layers', args.id ?? args.name).id),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'LAYERUPDATE', title: 'Update layer',
    execute: ({ document, transaction }, args) => {
      const record = resolveTableRecord(document, 'layers', args.id ?? args.name)
      return transaction.updateObject(record.id, { name: args.newName ?? record.name, payload: { ...args.patch } })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'LAYERDELETE', title: 'Delete layer',
    execute: ({ document, transaction }, args) => transaction.removeTableRecord('layers', resolveTableRecord(document, 'layers', args.id ?? args.name).id),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'BLOCKCREATE', aliases: ['BLOCK', 'B'], title: 'Create block definition',
    execute: (context, args) => createBlockDefinition(context, args),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'BLOCKINSERT', aliases: ['INSERT'], title: 'Insert block reference',
    execute: ({ document, transaction }, args) => {
      const record = resolveTableRecord(document, 'blockRecords', args.blockRecordId ?? args.id ?? args.name)
      if (record.payload?.isSpace) throw new KJValidationError('Model and paper spaces cannot be inserted as blocks')
      return transaction.createEntity('INSERT', {
        blockRecordId: record.id,
        position: args.position ?? [0, 0, 0],
        scale: args.scale ?? 1,
        rotation: args.rotation ?? 0,
        attributes: args.attributes ?? {},
        layerId: args.layerId,
      }, { ownerId: args.ownerId })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
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
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'XREFRELOAD', title: 'Update local external reference status',
    execute: ({ document, transaction }, args) => {
      const id = String(args.id ?? '')
      const current = document.snapshot().resources.externalReferences?.[id]
      if (!current) throw new KJValidationError(`External reference does not exist: ${id}`)
      return transaction.putResource('externalReferences', id, {
        ...current, sha256: args.sha256 == null ? current.sha256 : String(args.sha256).toLowerCase(),
        status: String(args.status ?? 'loaded').toLowerCase(), checkedAt: args.checkedAt ?? null,
      })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'XREFDETACH', aliases: ['XDETACH'], title: 'Detach external reference',
    execute: ({ transaction }, args) => transaction.removeResource('externalReferences', String(args.id ?? '')),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'GROUP', aliases: ['G'], title: 'Create object group',
    execute: ({ document, transaction }, args) => createObjectGroup(document, transaction, args),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'HATCH', aliases: ['H'], title: 'Create hatch',
    execute: ({ transaction }, args) => transaction.createEntity('HATCH', {
      boundaryLoops: args.boundaryLoops,
      patternName: args.patternName ?? 'SOLID',
      patternScale: args.patternScale ?? 1,
      patternAngle: args.patternAngle ?? 0,
      solid: args.solid,
      layerId: args.layerId,
    }, { ownerId: args.ownerId }),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'LINETYPE', aliases: ['LT'], title: 'Create or update linetype',
    execute: ({ transaction }, args) => transaction.upsertTableRecord('linetypes', { name: args.name, type: 'LINETYPE', payload: { description: args.description ?? '', pattern: clone(args.pattern ?? []) } }),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'TEXTSTYLE', aliases: ['STYLE'], title: 'Create or update text style',
    execute: ({ transaction }, args) => transaction.upsertTableRecord('textStyles', { name: args.name, type: 'TEXT_STYLE', payload: { fontFamily: String(args.fontFamily ?? 'sans-serif'), fontFile: args.fontFile ?? null, bigFontFile: args.bigFontFile ?? null, fixedHeight: Number(args.fixedHeight ?? 0), widthFactor: Number(args.widthFactor ?? 1), obliqueAngle: Number(args.obliqueAngle ?? 0) } }),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'DIMSTYLE', aliases: ['D'], title: 'Create or update dimension style',
    execute: ({ transaction }, args) => transaction.upsertTableRecord('dimensionStyles', { name: args.name, type: 'DIM_STYLE', payload: clone(args.properties ?? args.payload ?? {}) }),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'UCS', title: 'Create, update or activate UCS',
    execute: ({ document, transaction }, args) => {
      if (String(args.operation ?? 'upsert').toLowerCase() === 'set-current') return transaction.setCurrentTableRecord('ucs', resolveTableRecord(document, 'ucs', args.id ?? args.name).id)
      return transaction.upsertTableRecord('ucs', { name: args.name, type: 'UCS', payload: { origin: args.origin ?? [0, 0, 0], xAxis: args.xAxis ?? [1, 0, 0], yAxis: args.yAxis ?? [0, 1, 0] } })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
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
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'VIEWPORT', aliases: ['MVIEW'], title: 'Create paper-space viewport',
    execute: ({ document, transaction }, args) => {
      const operation = String(args.operation ?? 'create').toLowerCase()
      if (operation === 'update') {
        const viewport = requiredEntity(document, args.id)
        if (viewport.type !== 'VIEWPORT') throw new KJValidationError(`Entity is not a viewport: ${args.id}`)
        return transaction.updateObject(viewport.id, { payload: clone(args.patch ?? {}) })
      }
      const layout = resolveLayout(document, args.layoutId ?? args.layoutName ?? document.snapshot().spaces.activeLayoutId)
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
      }, { ownerId })
      transaction.updateObject(layout.id, { payload: { viewportIds: [...(layout.payload.viewportIds ?? []), viewport.id] } })
      return viewport
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'PLOTSETUP', aliases: ['PAGESETUP'], title: 'Configure layout plotting',
    execute: ({ document, transaction }, args) => {
      const layout = resolveLayout(document, args.layoutId ?? args.layoutName ?? document.snapshot().spaces.activeLayoutId)
      const settings = normalizePlotSettings(args.settings ?? args)
      if (settings.plotStyleId && !document.snapshot().resources.plotStyles?.[settings.plotStyleId]) throw new KJValidationError(`Plot style does not exist: ${settings.plotStyleId}`)
      return transaction.updateObject(layout.id, { payload: { plotSettings: settings } })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'PLOTSTYLE', title: 'Create or update plot style',
    execute: ({ transaction }, args) => {
      const id = String(args.id ?? args.name ?? '').trim()
      if (!id) throw new KJValidationError('Plot style id is required')
      return transaction.putResource('plotStyles', id, { id, name: String(args.name ?? id), mode: String(args.mode ?? 'color-dependent'), mappings: clone(args.mappings ?? {}) })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'SEARCH', aliases: ['FIND'], title: 'Search drawing information', transactional: false,
    execute: ({ document }, args) => searchDocument(document, args),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'COMPARE', aliases: ['DWGCOMPARE'], title: 'Compare drawings by CAD handle', transactional: false,
    execute: ({ document }, args) => compareDocuments(document, args.otherDocument ?? args.other),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  for (const [id,method,title] of [
    ['SOLIDBOX','box','Create authoritative box'],['SOLIDCYLINDER','cylinder','Create authoritative cylinder'],
    ['SOLIDCONE','cone','Create authoritative cone'],['SOLIDSPHERE','sphere','Create authoritative sphere'],
    ['SOLIDSWEEP','sweep','Sweep authoritative solid'],['SOLIDLOFT','loft','Loft authoritative solid'],
  ]) disposers.push(registry.register({ id, title, execute:(context,args)=>createAuthoritativeSolid(context,args,method) }, { owner:'@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id:'SOLIDTRANSFORM',title:'Transform authoritative solid',
    execute:({sdk,document,transaction},args)=>{
      const entity=requiredSolidEntity(document,args.id),source=openSolid(sdk,entity),result=source.transform(args.matrix)
      try{return transaction.updateObject(entity.id,{payload:solidPayload(result,{layerId:entity.payload.layerId})})}finally{result.close();source.close()}
    },
  },{owner:'@kanjie/kjdraw-sdk'}))
  disposers.push(registry.register({
    id:'SOLIDBOOLEAN',title:'Boolean authoritative solids',
    execute:({sdk,document,transaction},args)=>{
      const first=requiredSolidEntity(document,args.firstId),second=requiredSolidEntity(document,args.secondId),a=openSolid(sdk,first),b=openSolid(sdk,second),result=a.boolean(b,args.operation??'union')
      try{const created=transaction.createEntity('SOLID3D',solidPayload(result,{layerId:args.layerId??first.payload.layerId}),{ownerId:args.ownerId??first.ownerId});if(args.eraseSources!==false){transaction.eraseObject(first.id);transaction.eraseObject(second.id)}return created}finally{result.close();a.close();b.close()}
    },
  },{owner:'@kanjie/kjdraw-sdk'}))
  disposers.push(registry.register({
    id:'SOLIDVALIDATE',title:'Validate authoritative solid',transactional:false,
    execute:({sdk,document},args)=>{const entity=requiredSolidEntity(document,args.id),solid=openSolid(sdk,entity);try{solid.validate();return solid.serialize().validation}finally{solid.close()}},
  },{owner:'@kanjie/kjdraw-sdk'}))
  disposers.push(registry.register({
    id:'SOLIDVOLUME',title:'Measure authoritative solid volume',transactional:false,
    execute:({sdk,document},args)=>{const entity=requiredSolidEntity(document,args.id),solid=openSolid(sdk,entity);try{return{id:entity.id,volume:solid.volume,kernelAuthority:'kjcore-rust-wasm'}}finally{solid.close()}},
  },{owner:'@kanjie/kjdraw-sdk'}))
  disposers.push(registry.register({
    id: 'MOVE', aliases: ['M'], title: 'Move objects',
    execute: (context, args) => transformExisting(context, args, moveMatrix(args)),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'ROTATE', aliases: ['RO'], title: 'Rotate objects',
    execute: (context, args) => transformExisting(context, args, rotationAround3(commandAngle(args), vec2(args.center ?? args.basePoint ?? [0, 0]))),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'SCALE', aliases: ['SC'], title: 'Scale objects',
    execute: (context, args) => {
      const factor = Number(args.factor)
      if (!Number.isFinite(factor) || factor === 0) throw new KJValidationError('Scale factor must be a finite non-zero number')
      return transformExisting(context, args, scaleAround3(factor, factor, vec2(args.center ?? args.basePoint ?? [0, 0])))
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'COPY', aliases: ['CO', 'CP'], title: 'Copy objects',
    execute: (context, args) => copyEntities(context, args, moveMatrix(args)),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'MIRROR', aliases: ['MI'], title: 'Mirror objects',
    execute: (context, args) => {
      const matrix = reflectionAcrossLine3(args.lineStart ?? args.start, args.lineEnd ?? args.end)
      const copies = copyEntities(context, args, matrix)
      if (args.eraseSource) for (const id of entityIds(args)) context.transaction.eraseObject(id)
      return copies
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'ARRAYRECT', aliases: ['ARRAYRECTANGULAR'], title: 'Rectangular array',
    execute: (context, args) => rectangularArray(context, args),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'ARRAYPOLAR', aliases: ['POLARARRAY'], title: 'Polar array',
    execute: (context, args) => polarArray(context, args),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'OFFSET', aliases: ['O'], title: 'Offset entity',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id)
      return createDerived(transaction, entity, entity.type, { ...offsetEntityPayload(entity, args.distance, args), ...clone(args.payloadPatch ?? {}) })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'BREAK', aliases: ['BR'], title: 'Break entity',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id), pieces = breakEntityPayloads(entity, args)
      transaction.eraseObject(entity.id)
      return pieces.map(piece => createDerived(transaction, entity, piece.type, piece.payload))
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'EXPLODE', aliases: ['X'], title: 'Explode entity',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id), pieces = explodeEntity(entity)
      transaction.eraseObject(entity.id)
      return pieces.map(piece => createDerived(transaction, entity, piece.type, piece.payload))
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'TRIM', aliases: ['TR'], title: 'Trim line',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id), boundaries = requiredBoundaries(document, args.boundaryIds)
      return transaction.updateObject(entity.id, { payload: trimLinePayload(entity, boundaries, args.pickPoint) })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'EXTEND', aliases: ['EX'], title: 'Extend line',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id), boundaries = requiredBoundaries(document, args.boundaryIds)
      return transaction.updateObject(entity.id, { payload: extendLinePayload(entity, boundaries, args.pickPoint) })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'CHAMFER', aliases: ['CHA'], title: 'Chamfer lines',
    execute: (context, args) => editLinePair(context, args, chamferLinePair),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'FILLET', aliases: ['F'], title: 'Fillet lines',
    execute: (context, args) => editLinePair(context, args, filletLinePair),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'GRIPEDIT', title: 'Edit entity grip',
    execute: ({ document, transaction }, args) => {
      const entity = requiredEntity(document, args.id)
      return transaction.updateObject(entity.id, { payload: editEntityGrip(entity, args.gripId, args.point) })
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'LENGTH', aliases: ['LISTLENGTH'], title: 'Measure entity length', transactional: false,
    execute: ({ document }, args) => entityIds(args).map(id => ({ id, ...entityLength2(requiredEntity(document, id)) })),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'AREA', title: 'Measure entity area', transactional: false,
    execute: ({ document }, args) => entityIds(args).map(id => ({ id, ...entityArea2(requiredEntity(document, id)) })),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'NEAREST', title: 'Nearest point on entity', transactional: false,
    execute: ({ document }, args) => ({ id: String(args.id), ...nearestPointOnEntity2(requiredEntity(document, args.id), args.point) }),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'INTERSECT', aliases: ['INTERSECTION'], title: 'Intersect entities', transactional: false,
    execute: ({ document }, args) => ({
      firstId: String(args.firstId), secondId: String(args.secondId),
      ...intersectEntityPair2(requiredEntity(document, args.firstId), requiredEntity(document, args.secondId)),
    }),
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'DISTANCE', aliases: ['DI', 'DIST'], title: 'Measure distance', transactional: false,
    execute: ({ document }, args) => {
      const point = vec2(args.point ?? args.firstPoint, 'point')
      if (args.id != null) return { mode: 'point-entity', id: String(args.id), ...nearestPointOnEntity2(requiredEntity(document, args.id), point) }
      const second = vec2(args.secondPoint, 'secondPoint')
      return { mode: 'point-point', firstPoint: point, secondPoint: second, distance: distance2(point, second) }
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  disposers.push(registry.register({
    id: 'ANGLE', aliases: ['ANG'], title: 'Measure angle', transactional: false,
    execute: (_context, args) => {
      const first = args.vertex == null ? vec2(args.firstVector, 'firstVector') : subtract2(vec2(args.firstPoint, 'firstPoint'), vec2(args.vertex, 'vertex'))
      const second = args.vertex == null ? vec2(args.secondVector, 'secondVector') : subtract2(vec2(args.secondPoint, 'secondPoint'), vec2(args.vertex, 'vertex'))
      const firstLength = Math.hypot(...first), secondLength = Math.hypot(...second)
      if (firstLength <= 1e-15 || secondLength <= 1e-15) throw new KJValidationError('Angle vectors must be non-zero')
      const radians = Math.acos(Math.max(-1, Math.min(1, dot2(first, second) / (firstLength * secondLength))))
      return { radians, degrees: radians * 180 / Math.PI }
    },
  }, { owner: '@kanjie/kjdraw-sdk' }))
  return () => disposers.reverse().forEach(dispose => dispose())
}

function entityIds(args = {}) {
  const ids = args.ids ?? (args.id == null ? [] : [args.id])
  if (!Array.isArray(ids) || !ids.length) throw new KJValidationError('Command requires at least one entity id')
  return [...new Set(ids.map(String))]
}

function solidAuthority(sdk){const authority=sdk?.solidAuthority;if(!authority||authority.authoritative!==true||typeof authority.openMesh!=='function')throw new KJValidationError('KJCore Rust 三维权威内核未就绪');return authority}
function solidPayload(session,extra={}){const value=session.serialize();if(value?.validation?.valid!==true)throw new KJValidationError('KJCore returned an invalid solid');return{...value,...clone(extra),kernelAuthority:'kjcore-rust-wasm',solidModelVersion:1}}
function createAuthoritativeSolid({sdk,transaction},args,method){const authority=solidAuthority(sdk),factory=authority[method];if(typeof factory!=='function')throw new KJValidationError(`KJCore solid operation is unavailable: ${method}`);const session=factory(args);try{return transaction.createEntity('SOLID3D',solidPayload(session,{layerId:args.layerId}),{ownerId:args.ownerId})}finally{session.close()}}
function requiredSolidEntity(document,id){const entity=requiredEntity(document,id);if(entity.type!=='SOLID3D')throw new KJValidationError(`Entity is not an authoritative SOLID3D: ${id}`);return entity}
function openSolid(sdk,entity){return solidAuthority(sdk).openMesh({vertices:entity.payload.vertices,triangles:entity.payload.triangles})}

function vec3(value, label) {
  if (!Array.isArray(value) || value.length < 2) throw new KJValidationError(`${label} must be a 2D or 3D point`)
  const result = [Number(value[0]), Number(value[1]), Number(value[2] ?? 0)]
  if (!result.every(Number.isFinite)) throw new KJValidationError(`${label} must contain finite coordinates`)
  return result
}

function normalizeXrefScale(value = 1) {
  const result = Array.isArray(value) ? vec3(value.length === 2 ? [...value, 1] : value, 'scale') : [Number(value), Number(value), Number(value)]
  if (!result.every(component => Number.isFinite(component) && component !== 0)) throw new KJValidationError('External reference scale must be finite and non-zero')
  return result
}

function normalizeExternalReferenceSource(value = {}) {
  const source = typeof value === 'string' ? { kind: 'local-file', path: value } : clone(value)
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

function normalizePlotSettings(value = {}) {
  const device = String(value.device ?? 'pdf').toLowerCase()
  if (!['pdf', 'printer', 'png'].includes(device)) throw new KJValidationError(`Unsupported plot device: ${device}`)
  const area = String(value.area ?? 'layout').toLowerCase()
  if (!['layout', 'display', 'extents', 'window'].includes(area)) throw new KJValidationError(`Unsupported plot area: ${area}`)
  const rotation = Number(value.rotation ?? 0)
  if (![0, 90, 180, 270].includes(rotation)) throw new KJValidationError('Plot rotation must be 0, 90, 180 or 270 degrees')
  const scale = value.scale === 'fit' || value.fit === true ? { mode: 'fit' } : { mode: 'custom', numerator: Number(value.numerator ?? 1), denominator: Number(value.denominator ?? 1) }
  if (scale.mode === 'custom' && (![scale.numerator, scale.denominator].every(number => Number.isFinite(number) && number > 0))) throw new KJValidationError('Custom plot scale must use positive finite values')
  const window = area === 'window' ? [vec3(value.window?.[0], 'plot window start'), vec3(value.window?.[1], 'plot window end')] : null
  return { device, media: String(value.media ?? 'ISO_A4'), area, window, scale, centered: value.centered !== false, rotation, plotStyleId: value.plotStyleId == null ? null : String(value.plotStyleId), lineweights: value.lineweights !== false, outputQualityDpi: Number(value.outputQualityDpi ?? 600) }
}

function createEntityBatch({ document, transaction }, args = {}) {
  const specs = args.entities
  if (!Array.isArray(specs) || !specs.length) throw new KJValidationError('CREATEBATCH requires at least one entity')
  if (specs.length > 100000) throw new KJValidationError('CREATEBATCH exceeds the 100000 entity safety limit')
  const layerIds = new Map(document.getTable('layers').records.map(record => [String(record.name).toUpperCase(), record.id]))
  const created = []
  for (const spec of specs) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new KJValidationError('CREATEBATCH entity specs must be objects')
    const layerName = String(spec.layerName ?? '0').trim() || '0'
    const layerKey = layerName.toUpperCase()
    let layerId = spec.payload?.layerId ?? layerIds.get(layerKey)
    if (!layerId) {
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
    created.push(transaction.createEntity(spec.type, { ...clone(spec.payload ?? {}), layerId }, spec.options ?? {}))
  }
  return created
}

function requiredEntity(document, id) {
  const entity = document?.getObject(id)
  if (!entity || entity.kind !== 'entity') throw new KJValidationError(`Entity does not exist: ${id}`)
  return entity
}

function resolveTableRecord(document, tableName, value) {
  const table = document?.getTable(tableName)
  const key = String(value ?? '').toUpperCase()
  const record = table?.records.find(item => item.id === String(value) || String(item.name).toUpperCase() === key)
  if (!record) throw new KJValidationError(`${tableName} record does not exist: ${value}`)
  return record
}

function resolveLayout(document, value) {
  const key = String(value ?? '').toUpperCase()
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.id === String(value) || String(record?.name).toUpperCase() === key)
  if (!layout) throw new KJValidationError(`Layout does not exist: ${value}`)
  return layout
}

function createBlockDefinition({ document, transaction }, args) {
  const name = String(args.name ?? '').trim()
  if (!name) throw new KJValidationError('Block name is required')
  if (document.getTable('blockRecords')?.records.some(record => String(record.name).toUpperCase() === name.toUpperCase())) throw new KJValidationError(`Block already exists: ${name}`)
  const entities = entityIds(args).map(id => requiredEntity(document, id))
  const ownerId = String(args.ownerId ?? entities[0].ownerId)
  if (entities.some(entity => entity.ownerId !== ownerId)) throw new KJValidationError('Block source entities must share one owner')
  const basePoint = vec2(args.basePoint ?? [0, 0])
  const block = transaction.upsertTableRecord('blockRecords', {
    name, type: 'BLOCK_RECORD', payload: { entityIds: [], isSpace: false, basePoint: [0, 0, 0], description: args.description ?? null },
  })
  const localMatrix = translation3(-basePoint[0], -basePoint[1])
  if (args.keepSource) {
    for (const entity of entities) transaction.createEntity(entity.type, transformEntityPayload(entity.type, entity.payload, localMatrix), {
      ownerId: block.id, name: entity.name, extension: entity.extension, source: { blockSourceId: entity.id, blockSourceHandle: entity.handle },
    })
    return { block, insert: null }
  }
  for (const entity of entities) {
    transaction.updateObject(entity.id, { payload: transformEntityPayload(entity.type, entity.payload, localMatrix) })
    transaction.reparentObject(entity.id, block.id)
  }
  const insert = transaction.createEntity('INSERT', {
    blockRecordId: block.id, position: [basePoint[0], basePoint[1], Number(args.basePoint?.[2] ?? 0)], scale: [1, 1, 1], rotation: 0, attributes: {},
  }, { ownerId })
  return { block, insert }
}

function createObjectGroup(document, transaction, args) {
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

function searchDocument(document, args = {}) {
  const query = String(args.query ?? '').trim().toLocaleLowerCase()
  if (!query) throw new KJValidationError('Search query is required')
  const kinds = args.kinds?.length ? new Set(args.kinds.map(String)) : null
  const types = args.types?.length ? new Set(args.types.map(value => String(value).toUpperCase())) : null
  const limit = Number(args.limit ?? 1000)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) throw new KJValidationError('Search limit must be an integer from 1 to 100000')
  const matches = []
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

function compareDocuments(current, otherInput) {
  const snapshot = otherInput?.snapshot?.() ?? otherInput?.toJSON?.() ?? otherInput
  if (!snapshot?.objects || typeof snapshot.objects !== 'object') throw new KJValidationError('COMPARE requires another KJDocument or document state')
  const left = new Map(current.listObjects({ includeErased: true }).map(object => [object.handle, object]))
  const right = new Map(Object.values(snapshot.objects).map(object => [String(object.handle).toUpperCase(), object]))
  const added = [], removed = [], changed = [], unchanged = []
  const comparable = object => {
    const value = clone(object)
    delete value.id
    delete value.source
    return value
  }
  for (const handle of [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => parseInt(a, 16) - parseInt(b, 16))) {
    const before = left.get(handle), after = right.get(handle)
    if (!before) added.push({ handle, type: after.type, afterId: after.id })
    else if (!after) removed.push({ handle, type: before.type, beforeId: before.id })
    else if (stableHash(comparable(before)) !== stableHash(comparable(after))) changed.push({ handle, beforeId: before.id, afterId: after.id, beforeType: before.type, afterType: after.type })
    else unchanged.push({ handle, type: before.type, beforeId: before.id, afterId: after.id })
  }
  return deepFreeze({ identical: !added.length && !removed.length && !changed.length, added, removed, changed, unchanged, counts: { added: added.length, removed: removed.length, changed: changed.length, unchanged: unchanged.length } })
}

function moveMatrix(args) {
  if (args.from != null || args.to != null) {
    const from = vec2(args.from ?? [0, 0]), to = vec2(args.to ?? [0, 0])
    return translation3(to[0] - from[0], to[1] - from[1])
  }
  const dx = Number(args.dx ?? 0), dy = Number(args.dy ?? 0)
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new KJValidationError('Move displacement must be finite')
  return translation3(dx, dy)
}

function commandAngle(args) {
  const value = args.angleDegrees == null ? Number(args.angle ?? 0) : Number(args.angleDegrees) * Math.PI / 180
  if (!Number.isFinite(value)) throw new KJValidationError('Rotation angle must be finite')
  return value
}

function transformExisting({ document, transaction }, args, matrix) {
  return entityIds(args).map(id => {
    const entity = requiredEntity(document, id)
    return transaction.updateObject(id, { payload: transformEntityPayload(entity.type, entity.payload, matrix) })
  })
}

function copyEntities({ document, transaction }, args, matrix) {
  return entityIds(args).map(id => {
    const entity = requiredEntity(document, id)
    return transaction.createEntity(entity.type, { ...transformEntityPayload(entity.type, entity.payload, matrix), ...clone(args.payloadPatch ?? {}) }, {
      ownerId: args.ownerId ?? entity.ownerId,
      name: entity.name,
      extension: entity.extension,
      source: { copiedFromId: entity.id, copiedFromHandle: entity.handle },
    })
  })
}

function createDerived(transaction, source, type, payload) {
  return transaction.createEntity(type, payload, {
    ownerId: source.ownerId, name: source.name,
    extension: source.extension, source: { derivedFromId: source.id, derivedFromHandle: source.handle },
  })
}

function requiredBoundaries(document, ids) {
  if (!Array.isArray(ids) || !ids.length) throw new KJValidationError('Boundary entity ids are required')
  return ids.map(id => requiredEntity(document, id))
}

function editLinePair({ document, transaction }, args, operation) {
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

function rectangularArray(context, args) {
  const rows = Number(args.rows ?? 1), columns = Number(args.columns ?? 1)
  const rowSpacing = Number(args.rowSpacing ?? 0), columnSpacing = Number(args.columnSpacing ?? 0)
  if (![rows, columns].every(Number.isInteger) || rows < 1 || columns < 1) throw new KJValidationError('Array rows and columns must be positive integers')
  if (rows * columns > 100000) throw new KJValidationError('Array exceeds the 100000 instance safety limit')
  if (![rowSpacing, columnSpacing].every(Number.isFinite)) throw new KJValidationError('Array spacing must be finite')
  const created = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (row === 0 && column === 0 && args.includeSource !== false) continue
      created.push(...copyEntities(context, args, translation3(column * columnSpacing, row * rowSpacing)))
    }
  }
  return created
}

function polarArray(context, args) {
  const count = Number(args.count ?? args.items)
  if (!Number.isInteger(count) || count < 2 || count > 100000) throw new KJValidationError('Polar array count must be an integer from 2 to 100000')
  const center = vec2(args.center)
  const fillAngle = args.angleDegrees == null ? Number(args.angle ?? Math.PI * 2) : Number(args.angleDegrees) * Math.PI / 180
  if (!Number.isFinite(fillAngle) || Math.abs(fillAngle) <= 1e-15) throw new KJValidationError('Polar array fill angle must be finite and non-zero')
  const fullCircle = Math.abs(Math.abs(fillAngle) - Math.PI * 2) <= 1e-10
  const step = fillAngle / (fullCircle ? count : count - 1), created = []
  for (let index = 1; index < count; index += 1) {
    const rotation = rotationAround3(step * index, center)
    let matrix = rotation
    if (args.rotateItems === false) {
      const basePoint = vec2(args.basePoint)
      const rotated = transformPoint3(rotation, basePoint)
      matrix = translation3(rotated[0] - basePoint[0], rotated[1] - basePoint[1])
    }
    created.push(...copyEntities(context, args, matrix))
  }
  return created
}
