import {
  KJD_SCHEMA,
  KJD_SCHEMA_VERSION,
  KJ_OBJECT_KINDS,
  KJ_SPACE_NAMES,
  KJ_TABLE_NAMES,
} from './constants.js'
import type { KJObjectKind, KJTableName } from './constants.js'
import { KJValidationError } from './errors.js'
import { validateDxfLayoutGeometry } from './layout-geometry.js'
import { createId } from './ids.js'
import { isStandardEntityType, normalizeLegacyEntityPayload, normalizeStandardEntityPayload } from './standard-entities.js'
import {
  assertPlainObject,
  clone,
  fromHexHandle,
  normalizeName,
  nowIso,
  toHexHandle,
} from './utils.js'
import type { ReadonlyDeep } from './utils.js'
import { validatePlotSettings } from './plot-settings.js'
import type { KJDxfPlotSettings } from './plot-settings.js'
export type { KJDxfPlotSettings } from './plot-settings.js'

export interface KJObjectExtension {
  xdata: Record<string, unknown>
  xrecordIds: string[]
  reactorIds: string[]
  hyperlinks: unknown[]
}

export interface KJObjectPayload extends Record<string, unknown> {
  layerId?: string
  contractVersion?: number
  entityIds?: string[]
  blockRecordId?: string
  viewportIds?: string[]
  entries?: Record<string, string | string[]>
  memberIds?: string[]
  dxfPlotSettings?: KJDxfPlotSettings
  attributeIds?: string[]
  parentInsertId?: string | null
  sequenceEndId?: string | null
}

export interface KJObjectRecord<TPayload extends KJObjectPayload = KJObjectPayload> {
  id: string
  handle: string
  kind: KJObjectKind
  type: string
  ownerId: string | null
  name: string | null
  payload: TPayload
  extension: KJObjectExtension
  erased: boolean
  source: unknown
}

/** Convenience view for entity records returned by CREATE and listEntities(). */
export type KJEntity<TPayload extends KJObjectPayload = KJObjectPayload> = KJObjectRecord<TPayload> & {
  kind: 'entity'
}

export type KJReadonlyObjectRecord<TPayload extends KJObjectPayload = KJObjectPayload> = ReadonlyDeep<KJObjectRecord<TPayload>>

export interface KJObjectSpec<TPayload extends KJObjectPayload = KJObjectPayload> {
  id?: string
  handle?: string
  kind?: KJObjectKind
  type?: string
  ownerId?: string | null
  name?: string | null
  payload?: TPayload
  extension?: Partial<KJObjectExtension>
  erased?: boolean
  source?: unknown
}

export interface KJTableState {
  recordIds: string[]
  currentId: string | null
}

export type KJDocumentTables = Record<KJTableName, KJTableState>

export interface KJDocumentHeader extends Record<string, unknown> {
  authoringVersion: string
  sourceFormat: string
  sourceVersion: string
  units: string
  measurement: string
  codePage: string
  handseed: string
  extents: unknown
  limits: unknown
  systemVariables: Record<string, unknown>
}

export interface KJDocumentSpaces {
  modelSpaceId: string
  paperSpaceIds: string[]
  layoutIds: string[]
  activeLayoutId: string
}

export type KJResourceCollectionName =
  | 'fonts'
  | 'images'
  | 'hatches'
  | 'materials'
  | 'binaries'
  | 'externalReferences'
  | 'plotStyles'

export type KJResourceCollection = Record<string, unknown>
export type KJDocumentResources = Record<KJResourceCollectionName, KJResourceCollection>

export interface KJRevisionRecord extends Record<string, unknown> {
  revision: number
  kind: string
  label: string
  at: string
  author: unknown
  source: string
  operationCount: number
  operations: unknown[]
  fingerprint?: string
  targetRevision?: number
}

export interface KJDocumentMetadata extends Record<string, unknown> {
  title: string
  createdAt: string
  modifiedAt: string | null
  createdBy: unknown
  tags: unknown[]
  custom: Record<string, unknown>
}

export interface KJDocumentState {
  schema: string
  schemaVersion: number
  documentId: string
  revision: number
  header: KJDocumentHeader
  tables: KJDocumentTables
  spaces: KJDocumentSpaces
  namedObjectsDictionaryId: string
  objects: Record<string, KJObjectRecord>
  resources: KJDocumentResources
  opaquePayloads: Record<string, unknown>
  revisions: KJRevisionRecord[]
  metadata: KJDocumentMetadata
}

export interface KJDocumentOptions {
  documentId?: string
  id?: string
  createdAt?: string
  authoringVersion?: string
  sourceFormat?: string
  sourceVersion?: string
  units?: string
  measurement?: string
  codePage?: string
  extents?: unknown
  limits?: unknown
  systemVariables?: Record<string, unknown>
  title?: string
  createdBy?: unknown
  tags?: unknown[]
  metadata?: Record<string, unknown>
}

export interface KJValidationIssue {
  path: string
  message: string
}

export interface KJValidationResult {
  valid: boolean
  issues: KJValidationIssue[]
}

export interface KJLegacyLayer extends Record<string, unknown> {
  id?: string
  name?: string
}

export interface KJLegacyEntity extends Record<string, unknown> {
  id?: string
  entityId?: string
  type?: string
  layer?: string
}

export interface KJLegacyScene extends Record<string, unknown> {
  id?: string
  title?: string
  layers?: KJLegacyLayer[]
  entities?: KJLegacyEntity[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function extensionData(value: Partial<KJObjectExtension> = {}): KJObjectExtension {
  return {
    xdata: clone(value.xdata ?? {}),
    xrecordIds: [...(value.xrecordIds ?? [])],
    reactorIds: [...(value.reactorIds ?? [])],
    hyperlinks: clone(value.hyperlinks ?? []),
  }
}

export function createObjectRecord<TPayload extends KJObjectPayload = KJObjectPayload>({
  id = createId('obj'),
  handle,
  kind,
  type,
  ownerId = null,
  name = null,
  payload = {} as TPayload,
  extension = {},
  erased = false,
  source = null,
}: KJObjectSpec<TPayload> = {}): KJObjectRecord<TPayload> {
  return {
    id: String(id),
    handle: String(handle ?? '').toUpperCase(),
    kind: String(kind ?? '') as KJObjectKind,
    type: normalizeName(type),
    ownerId: ownerId == null ? null : String(ownerId),
    name: name == null ? null : String(name),
    payload: clone(payload ?? {} as TPayload),
    extension: extensionData(extension),
    erased: Boolean(erased),
    source: source == null ? null : clone(source),
  }
}

function table(recordIds: string[], currentId: string | null = null): KJTableState {
  return { recordIds: [...recordIds], currentId }
}

export function allocateHandle(state: KJDocumentState): string {
  const next = fromHexHandle(state.header.handseed)
  state.header.handseed = toHexHandle(next + 1n)
  return toHexHandle(next)
}

export function createEmptyDocumentState(options: KJDocumentOptions = {}): KJDocumentState {
  const documentId = String(options.documentId ?? options.id ?? createId('drawing'))
  const createdAt = options.createdAt ?? nowIso()
  const objects: Record<string, KJObjectRecord> = {}
  let nextHandle = 1n
  const add = (spec: KJObjectSpec): string => {
    const object = createObjectRecord({ ...spec, handle: toHexHandle(nextHandle++) })
    objects[object.id] = object
    return object.id
  }

  const nodId = add({ id: createId('dict'), kind: 'dictionary', type: 'DICTIONARY', name: 'NAMED_OBJECTS', payload: { entries: {} } })
  const continuousId = add({ id: createId('linetype'), kind: 'table-record', type: 'LINETYPE', name: 'CONTINUOUS', payload: { description: 'Solid line', pattern: [], totalPatternLength: 0, dxfFlags: 0 } })
  const textStyleId = add({ id: createId('textstyle'), kind: 'table-record', type: 'TEXT_STYLE', name: 'STANDARD', payload: { fontFamily: 'sans-serif', fontFile: 'sans-serif', bigFontFile: '', fixedHeight: 0, widthFactor: 1, obliqueAngle: 0, dxfFlags: 0, generationFlags: 0 } })
  const dimensionStyleId = add({ id: createId('dimstyle'), kind: 'table-record', type: 'DIM_STYLE', name: 'STANDARD', payload: { overallScale: 1, arrowSize: 2.5, extensionOffset: 0.625, baselineSpacing: 3.75, extensionBeyond: 1.25, rounding: 0, textHeight: 2.5, centerMarkSize: 2.5, textGap: 0.625, dxfFlags: 0 } })
  const layerId = add({ id: createId('layer'), kind: 'table-record', type: 'LAYER', name: '0', payload: { color: 7, linetypeId: continuousId, linetypeName: 'CONTINUOUS', lineweight: -1, visible: true, frozen: false, locked: false, plottable: true } })
  const modelSpaceId = add({ id: createId('block'), kind: 'block-record', type: 'BLOCK_RECORD', name: KJ_SPACE_NAMES.MODEL, payload: { entityIds: [], isSpace: true } })
  const paperSpaceId = add({ id: createId('block'), kind: 'block-record', type: 'BLOCK_RECORD', name: KJ_SPACE_NAMES.PAPER, payload: { entityIds: [], isSpace: true } })
  const modelLayoutId = add({ id: createId('layout'), kind: 'layout', type: 'LAYOUT', ownerId: nodId, name: 'Model', payload: { blockRecordId: modelSpaceId, tabOrder: 0, paper: null, dxfLayoutGeometry: { limits:null, extents:null }, viewportIds: [] } })
  const paperLayoutId = add({ id: createId('layout'), kind: 'layout', type: 'LAYOUT', ownerId: nodId, name: 'Layout1', payload: { blockRecordId: paperSpaceId, tabOrder: 1, paper: { width: 420, height: 297, unit: 'mm' }, dxfLayoutGeometry: { limits:{ minimum:[0,0], maximum:[420,297] }, extents:null }, viewportIds: [] } })
  const entries = objects[nodId]!.payload.entries ??= {}
  entries.ACAD_LAYOUT = [modelLayoutId, paperLayoutId]

  return {
    schema: KJD_SCHEMA,
    schemaVersion: KJD_SCHEMA_VERSION,
    documentId,
    revision: 0,
    header: {
      authoringVersion: String(options.authoringVersion ?? 'KJDraw/0.1'),
      sourceFormat: options.sourceFormat ?? 'KJD',
      sourceVersion: options.sourceVersion ?? '1',
      units: options.units ?? 'millimeter',
      measurement: options.measurement ?? 'metric',
      codePage: options.codePage ?? 'UTF-8',
      handseed: toHexHandle(nextHandle),
      extents: options.extents ?? null,
      limits: options.limits ?? null,
      systemVariables: clone(options.systemVariables ?? {}),
    },
    tables: {
      layers: table([layerId], layerId),
      linetypes: table([continuousId], continuousId),
      textStyles: table([textStyleId], textStyleId),
      dimensionStyles: table([dimensionStyleId], dimensionStyleId),
      ucs: table([]),
      views: table([]),
      blockRecords: table([modelSpaceId, paperSpaceId], modelSpaceId),
    },
    spaces: {
      modelSpaceId,
      paperSpaceIds: [paperSpaceId],
      layoutIds: [modelLayoutId, paperLayoutId],
      activeLayoutId: modelLayoutId,
    },
    namedObjectsDictionaryId: nodId,
    objects,
    resources: { fonts: {}, images: {}, hatches: {}, materials: {}, binaries: {}, externalReferences: {}, plotStyles: {} },
    opaquePayloads: {},
    revisions: [],
    metadata: {
      title: options.title ?? 'Untitled',
      createdAt,
      modifiedAt: createdAt,
      createdBy: options.createdBy ?? null,
      tags: [...(options.tags ?? [])],
      custom: clone(options.metadata ?? {}),
    },
  }
}

function validateObjectGraph(state: KJDocumentState, issues: KJValidationIssue[], previousState?: KJDocumentState): void {
  const handles = new Map<string, string>()
  let greatestHandle = 0n
  for (const [id, object] of Object.entries(state.objects)) {
    if (!object || object.id !== id) issues.push({ path: `objects.${id}.id`, message: 'Object key and id must match' })
    if (!(KJ_OBJECT_KINDS as readonly string[]).includes(object?.kind)) issues.push({ path: `objects.${id}.kind`, message: `Unsupported object kind: ${object?.kind}` })
    if (!object?.type) issues.push({ path: `objects.${id}.type`, message: 'Object type is required' })
    try {
      const handle = fromHexHandle(object?.handle)
      greatestHandle = handle > greatestHandle ? handle : greatestHandle
      if (handles.has(object.handle)) issues.push({ path: `objects.${id}.handle`, message: `Duplicate handle shared with ${handles.get(object.handle)}` })
      handles.set(object.handle, id)
    } catch (error) {
      issues.push({ path: `objects.${id}.handle`, message: errorMessage(error) })
    }
    if (previousState?.objects[id] === object) continue
    if (object?.ownerId != null && !state.objects[object.ownerId]) issues.push({ path: `objects.${id}.ownerId`, message: `Missing owner: ${object.ownerId}` })
    if (object?.ownerId === id) issues.push({ path: `objects.${id}.ownerId`, message: 'Object cannot own itself' })
    if (object?.kind === 'entity' && state.objects[object.ownerId ?? '']?.kind !== 'block-record') issues.push({ path: `objects.${id}.ownerId`, message: 'Entity owner must be a block record' })
    if (object?.kind === 'entity' && object.payload?.layerId != null && !state.tables.layers.recordIds.includes(object.payload.layerId)) issues.push({ path: `objects.${id}.payload.layerId`, message: `Entity layer is not registered: ${object.payload.layerId}` })
    if (object?.kind === 'entity' && ['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].includes(object.type) && object.payload?.styleId != null && !state.tables.textStyles.recordIds.includes(String(object.payload.styleId))) issues.push({ path: `objects.${id}.payload.styleId`, message: `Text style is not registered: ${object.payload.styleId}` })
    if (object?.kind === 'entity' && object.type === 'DIMENSION' && Array.isArray(object.payload?.dimensionAssociations)) {
      for (const [index, candidate] of object.payload.dimensionAssociations.entries()) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
        const association = candidate as Record<string, unknown>, source = typeof association.entityId === 'string' ? state.objects[association.entityId] : null
        const associationPath = `objects.${id}.payload.dimensionAssociations.${index}`
        if (!source || source.kind !== 'entity' || source.id === id) issues.push({ path: `${associationPath}.entityId`, message: `Dimension association source is missing or invalid: ${association.entityId}` })
        else {
          if (source.ownerId !== object.ownerId) issues.push({ path: `${associationPath}.entityId`, message: 'Dimension association source must share its drawing space' })
          const feature = String(association.feature)
          const expected = feature === 'vertex' ? ['LWPOLYLINE'] : ['start', 'end'].includes(feature) ? ['LINE', 'ARC'] : ['CIRCLE', 'ARC']
          if (!expected.includes(source.type)) issues.push({ path: `${associationPath}.feature`, message: `Dimension association ${feature} is incompatible with ${source.type}` })
        }
      }
    }
    if (object?.kind === 'entity' && isStandardEntityType(object.type)) {
      if (object.payload?.contractVersion !== 1) issues.push({ path: `objects.${id}.payload.contractVersion`, message: 'Standard entity payload is not canonical' })
      try { normalizeStandardEntityPayload(object.type, object.payload) }
      catch (error) { issues.push({ path: `objects.${id}.payload`, message: errorMessage(error) }) }
    }
    if (object?.kind === 'layout' && object.payload?.dxfPlotSettings !== undefined) {
      try { validatePlotSettings(object.payload.dxfPlotSettings) }
      catch (error) { issues.push({ path: `objects.${id}.payload.dxfPlotSettings`, message: errorMessage(error) }) }
    }
    if (object?.kind === 'entity' && object.type === 'INSERT' && state.objects[object.payload?.blockRecordId ?? '']?.kind !== 'block-record') {
      issues.push({ path: `objects.${id}.payload.blockRecordId`, message: `Block definition is missing: ${object.payload?.blockRecordId}` })
    }
  }

  // Compound links must be checked even when either endpoint is unchanged in
  // the structural-sharing snapshot. Native ATTRIB ownership is represented
  // explicitly; its KJD space owner remains a block record.
  for (const object of Object.values(state.objects)) {
    const path = `objects.${object.id}.payload`
    if (object.kind === 'entity' && object.type === 'INSERT') {
      const ids = object.payload.attributeIds ?? []
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
        issues.push({ path: `${path}.attributeIds`, message: 'INSERT attribute references must be unique ids' })
        continue
      }
      for (const id of ids) {
        const child = state.objects[id]
        if (!child || child.kind !== 'entity' || child.type !== 'ATTRIB' || child.payload.parentInsertId !== object.id || child.ownerId !== object.ownerId || child.erased !== object.erased) issues.push({ path: `${path}.attributeIds`, message: `Invalid attached ATTRIB relationship: ${id}` })
      }
      const sequenceId = object.payload.sequenceEndId
      if (ids.length && !sequenceId) issues.push({ path: `${path}.sequenceEndId`, message: 'Attached ATTRIB sequence requires SEQEND' })
      if (sequenceId != null) {
        const end = typeof sequenceId === 'string' ? state.objects[sequenceId] : undefined
        if (!end || end.kind !== 'custom' || end.type !== 'SEQEND' || end.ownerId !== object.id || end.erased !== object.erased) issues.push({ path: `${path}.sequenceEndId`, message: 'INSERT sequence end is missing or belongs to another insert' })
      }
    }
    if (object.kind === 'entity' && object.type === 'ATTRIB' && object.payload.parentInsertId != null) {
      const parent = state.objects[object.payload.parentInsertId]
      if (!parent || parent.kind !== 'entity' || parent.type !== 'INSERT' || parent.ownerId !== object.ownerId || parent.erased !== object.erased || !Array.isArray(parent.payload.attributeIds) || parent.payload.attributeIds.filter(id => id === object.id).length !== 1) issues.push({ path: `${path}.parentInsertId`, message: 'Attached ATTRIB requires a unique reciprocal INSERT reference in the same space' })
    }
    if (object.type === 'SEQEND') {
      const parent = object.ownerId ? state.objects[object.ownerId] : null
      if (object.kind !== 'custom' || !parent || parent.kind !== 'entity' || parent.type !== 'INSERT' || parent.payload.sequenceEndId !== object.id || parent.erased !== object.erased) issues.push({ path, message: 'SEQEND requires a reciprocal INSERT owner' })
      if (!['insert', 'space'].includes(String(object.payload.dxfOwnerMode))) issues.push({ path: `${path}.dxfOwnerMode`, message: 'SEQEND native owner mode must be insert or space' })
      if (object.payload.layerId != null && !state.tables.layers.recordIds.includes(object.payload.layerId)) issues.push({ path: `${path}.layerId`, message: 'SEQEND layer is not registered' })
    }
  }

  for (const id of Object.keys(state.objects)) {
    if (previousState?.objects[id] === state.objects[id]) continue
    const visited = new Set([id])
    let ownerId = state.objects[id]?.ownerId
    while (ownerId) {
      if (visited.has(ownerId)) { issues.push({ path: `objects.${id}.ownerId`, message: 'Ownership cycle detected' }); break }
      visited.add(ownerId)
      ownerId = state.objects[ownerId]?.ownerId
    }
  }

  try {
    if (fromHexHandle(state.header.handseed) <= greatestHandle) issues.push({ path: 'header.handseed', message: 'HANDSEED must be greater than every allocated handle' })
  } catch (error) {
    issues.push({ path: 'header.handseed', message: errorMessage(error) })
  }
  const linetypeScale = state.header.systemVariables?.LTSCALE ?? 1
  if (typeof linetypeScale !== 'number' || !Number.isFinite(linetypeScale) || linetypeScale <= 0) issues.push({ path: 'header.systemVariables.LTSCALE', message: 'LTSCALE must be positive and finite' })
}

function validateTables(state: KJDocumentState, issues: KJValidationIssue[]): void {
  for (const tableName of KJ_TABLE_NAMES) {
    const value = state.tables[tableName]
    if (!value) { issues.push({ path: `tables.${tableName}`, message: 'Required table is missing' }); continue }
    const names = new Map<string, string>()
    for (const id of value.recordIds ?? []) {
      const record = state.objects[id]
      if (!record) { issues.push({ path: `tables.${tableName}.recordIds`, message: `Missing table record: ${id}` }); continue }
      if (!['table-record', 'block-record'].includes(record.kind)) issues.push({ path: `tables.${tableName}.recordIds`, message: `${id} is not a table record` })
      const key = normalizeName(record.name)
      if (names.has(key)) issues.push({ path: `tables.${tableName}.recordIds`, message: `Duplicate record name: ${record.name}` })
      names.set(key, id)
    }
    if (value.currentId != null && !value.recordIds.includes(value.currentId)) issues.push({ path: `tables.${tableName}.currentId`, message: 'Current record is not in the table' })
  }
}

function validateSpaces(state: KJDocumentState, issues: KJValidationIssue[], previousState?: KJDocumentState): void {
  const blockIds = [state.spaces.modelSpaceId, ...(state.spaces.paperSpaceIds ?? [])]
  for (const id of blockIds) if (state.objects[id]?.kind !== 'block-record') issues.push({ path: 'spaces', message: `Space does not reference a block record: ${id}` })
  for (const id of state.spaces.layoutIds ?? []) if (state.objects[id]?.kind !== 'layout') issues.push({ path: 'spaces.layoutIds', message: `Layout is missing: ${id}` })
  if (!(state.spaces.layoutIds ?? []).includes(state.spaces.activeLayoutId)) issues.push({ path: 'spaces.activeLayoutId', message: 'Active layout is not registered' })
  if (state.objects[state.namedObjectsDictionaryId]?.kind !== 'dictionary') issues.push({ path: 'namedObjectsDictionaryId', message: 'Named objects dictionary is missing' })

  for (const object of Object.values(state.objects)) {
    if (previousState?.objects[object.id] === object) continue
    if (object.kind === 'block-record') {
      for (const entityId of object.payload?.entityIds ?? []) {
        const entity = state.objects[entityId]
        if (entity?.kind !== 'entity' || entity.ownerId !== object.id) issues.push({ path: `objects.${object.id}.payload.entityIds`, message: `Invalid owned entity: ${entityId}` })
      }
    }
    if (object.kind === 'layout') {
      if (state.objects[object.payload?.blockRecordId ?? '']?.kind !== 'block-record') issues.push({ path: `objects.${object.id}.payload.blockRecordId`, message: 'Layout block record is missing' })
      for (const viewportId of object.payload?.viewportIds ?? []) if (state.objects[viewportId]?.type !== 'VIEWPORT') issues.push({ path: `objects.${object.id}.payload.viewportIds`, message: `Invalid viewport: ${viewportId}` })
      if (object.payload?.dxfLayoutGeometry !== undefined) try { validateDxfLayoutGeometry(object.payload.dxfLayoutGeometry) } catch (error) { issues.push({ path: `objects.${object.id}.payload.dxfLayoutGeometry`, message: errorMessage(error) }) }
    }
    if (object.kind === 'dictionary') {
      for (const referenced of Object.values(object.payload?.entries ?? {}).flat()) {
        if (!state.objects[referenced]) issues.push({ path: `objects.${object.id}.payload.entries`, message: `Dictionary target is missing: ${referenced}` })
      }
    }
    if (object.kind === 'group') {
      for (const memberId of object.payload?.memberIds ?? []) if (!state.objects[memberId]) issues.push({ path: `objects.${object.id}.payload.memberIds`, message: `Group member is missing: ${memberId}` })
    }
  }
}

export function validateDocumentState(
  input: unknown,
  { throwOnError = true, previousState }: { throwOnError?: boolean; previousState?: KJDocumentState } = {},
): KJValidationResult {
  const state = assertPlainObject(input, 'KJDocument') as unknown as KJDocumentState
  const issues: KJValidationIssue[] = []
  if (state.schema !== KJD_SCHEMA) issues.push({ path: 'schema', message: `Expected ${KJD_SCHEMA}` })
  if (state.schemaVersion !== KJD_SCHEMA_VERSION) issues.push({ path: 'schemaVersion', message: `Unsupported schema version: ${state.schemaVersion}` })
  if (!state.documentId) issues.push({ path: 'documentId', message: 'Document id is required' })
  if (!Number.isInteger(state.revision) || state.revision < 0) issues.push({ path: 'revision', message: 'Revision must be a non-negative integer' })
  for (const path of ['header', 'tables', 'spaces', 'objects', 'resources', 'metadata'] as const) {
    if (!state[path] || typeof state[path] !== 'object' || Array.isArray(state[path])) issues.push({ path, message: 'Object is required' })
  }
  if (!issues.length) {
    validateObjectGraph(state, issues, previousState)
    validateTables(state, issues)
    validateSpaces(state, issues, previousState)
  }
  if (issues.length && throwOnError) throw new KJValidationError(`KJDocument has ${issues.length} validation issue(s)`, issues)
  return { valid: !issues.length, issues }
}

export function migrateDocumentState(input: unknown): KJDocumentState {
  const state = clone(typeof input === 'string' ? JSON.parse(input) : input) as Partial<KJDocumentState> & KJLegacyScene
  if (state?.schema === KJD_SCHEMA && state.schemaVersion === KJD_SCHEMA_VERSION) return normalizeCurrentEntityContracts(state as KJDocumentState)
  if (state && !state.schema && (Array.isArray(state.entities) || Array.isArray(state.layers))) return importLegacyScene(state)
  throw new KJValidationError(`No migration path for schema ${state?.schema ?? 'unknown'} version ${state?.schemaVersion ?? 'unknown'}`)
}

function normalizeCurrentEntityContracts(state: KJDocumentState): KJDocumentState {
  state.resources ??= {} as KJDocumentResources
  for (const collection of ['fonts', 'images', 'hatches', 'materials', 'binaries', 'externalReferences', 'plotStyles'] as const) state.resources[collection] ??= {}
  for (const object of Object.values(state.objects ?? {})) {
    if (object?.kind !== 'entity' || !isStandardEntityType(object.type) || object.payload?.contractVersion === 1) continue
    const originalType = object.type, originalPayload = clone(object.payload)
    try { object.payload = normalizeLegacyEntityPayload(object.type, object.payload) }
    catch (error) {
      object.type = 'PROXY_ENTITY'
      object.payload = normalizeStandardEntityPayload('PROXY_ENTITY', { originalType, originalPayload, importError: errorMessage(error) })
    }
  }
  return state
}

export function importLegacyScene(legacy: KJLegacyScene = {}): KJDocumentState {
  const state = createEmptyDocumentState({ ...(legacy.id === undefined ? {} : { documentId: legacy.id }), title: legacy.title ?? legacy.id ?? 'Imported drawing', sourceFormat: 'KJDraw legacy scene' })
  const layerIds = new Map<string, string | null>([['0', state.tables.layers.currentId]])
  for (const layer of legacy.layers ?? []) {
    const name = String(layer.name ?? layer.id ?? '').trim()
    if (!name || normalizeName(name) === '0') continue
    const id = createId('layer')
    const layerPayload: KJObjectPayload = { ...clone(layer), name: undefined, id: undefined }
    state.objects[id] = createObjectRecord({ id, handle: allocateHandle(state), kind: 'table-record', type: 'LAYER', name, payload: layerPayload })
    state.tables.layers.recordIds.push(id)
    layerIds.set(normalizeName(name), id)
  }
  for (const source of legacy.entities ?? []) {
    const id = String(source.entityId ?? source.id ?? createId('entity'))
    const layerName = normalizeName(source.layer ?? '0')
    const payload = clone(source)
    delete payload.entityId
    delete payload.id
    delete payload.type
    let type = normalizeName(source.type ?? 'PROXY_ENTITY')
    let normalizedPayload: KJObjectPayload
    try { normalizedPayload = normalizeLegacyEntityPayload(type, { ...payload, layerId: layerIds.get(layerName) ?? state.tables.layers.currentId ?? undefined }) }
    catch (error) {
      normalizedPayload = normalizeStandardEntityPayload('PROXY_ENTITY', { originalType: type, originalPayload: payload, importError: errorMessage(error), layerId: layerIds.get(layerName) ?? state.tables.layers.currentId ?? undefined })
      type = 'PROXY_ENTITY'
    }
    state.objects[id] = createObjectRecord({ id, handle: allocateHandle(state), kind: 'entity', type, ownerId: state.spaces.modelSpaceId, payload: normalizedPayload, source: { legacyEntityId: id } })
    const modelSpace = state.objects[state.spaces.modelSpaceId]!
    modelSpace.payload.entityIds ??= []
    modelSpace.payload.entityIds.push(id)
  }
  validateDocumentState(state)
  return state
}
