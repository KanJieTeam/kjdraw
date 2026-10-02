import { isDeepStrictEqual } from 'node:util'

// Host-side read-only analysis. Geometry and import remain owned by KJDraw.
const DUPLICATE_TYPES = new Set(['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE'])
export const MAX_NORMALIZATION_NODES = 1000000
const OMIT = new Set(['rawTags', 'contractVersion'])
const GEOMETRY_KEYS = {
  LINE: ['start', 'end', 'normal', 'extrusionDirection', 'thickness'],
  CIRCLE: ['center', 'radius', 'normal', 'extrusionDirection', 'thickness'],
  ARC: ['center', 'radius', 'startAngle', 'endAngle', 'clockwise', 'normal', 'extrusionDirection', 'thickness'],
  LWPOLYLINE: ['vertices', 'closed', 'elevation', 'normal', 'extrusionDirection', 'thickness'],
  POLYLINE: ['vertices', 'closed', 'elevation', 'normal', 'extrusionDirection', 'thickness'],
  TEXT: ['position', 'rotation', 'alignmentPoint', 'horizontalAlignment', 'verticalAlignment'],
  MTEXT: ['position', 'rotation', 'direction', 'attachmentPoint'],
  ATTRIB: ['position', 'rotation', 'tag', 'parentInsertId'],
  ATTDEF: ['position', 'rotation', 'tag'],
  DIMENSION: ['dimensionType', 'definitionPoints', 'rotation', 'normal', 'extrusionDirection'],
  INSERT: ['blockRecordId', 'position', 'scale', 'rotation', 'columns', 'rows', 'columnSpacing', 'rowSpacing'],
  POINT: ['position'],
  ELLIPSE: ['center', 'majorAxis', 'ratio', 'startParameter', 'endParameter'],
  SPLINE: ['controlPoints', 'fitPoints', 'knots', 'weights', 'degree', 'closed'],
  LEADER: ['vertices'],
  HATCH: ['boundaryLoops'],
  SOLID: ['vertices'],
  VIEWPORT: ['center', 'width', 'height'],
}
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
const keyOf = value => JSON.stringify(ordered(value))
const ref = entity => ({ id: entity.id, handle: entity.handle, type: entity.type, owner: entity.owner, layer: entity.layer })
const unknown = reason => ({ $referenceStatus: 'unknown', reason })
const hasUnknown = value => value && typeof value === 'object' && (value.$referenceStatus === 'unknown' || Object.values(value).some(hasUnknown))
const pointer = (base, key) => `${base}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`

// Adapted from scripts/benchmarks/semantic-entity-diff.mjs's JSON-pointer walk;
// cross-file identity and reference normalization are separate host policy here.
export function changedPaths(before, after, path = '') {
  if (isDeepStrictEqual(before, after)) return []
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return [path || '/']
    return before.flatMap((value, index) => changedPaths(value, after[index], pointer(path, index)))
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key =>
      Object.hasOwn(before, key) !== Object.hasOwn(after, key) ? [pointer(path, key)] : changedPaths(before[key], after[key], pointer(path, key)))
  }
  return [path || '/']
}

export function normalizeOptions(options) {
  if (!['millimeter', 'meter', 'inch'].includes(options?.units)) throw new Error('Explicit units must be millimeter, meter or inch')
  if (typeof options.scope !== 'string' || !/^(model|all|layout:.+)$/.test(options.scope)) throw new Error('Explicit scope must be model, all or layout:<name>')
  if (!['semantic', 'same-lineage-handles'].includes(options.identity)) throw new Error('Explicit identity must be semantic or same-lineage-handles')
  if (options.layers !== undefined && (!Array.isArray(options.layers) || !options.layers.length || options.layers.some(name => typeof name !== 'string' || !name))) throw new Error('layers must be a nonempty array of exact layer names')
  const maxEntities = options.maxEntities ?? 50000, maxFindings = options.maxFindings ?? 2000
  if (!Number.isSafeInteger(maxEntities) || maxEntities < 1 || maxEntities > 50000 || !Number.isSafeInteger(maxFindings) || maxFindings < 1 || maxFindings > 10000) throw new Error('Invalid analysis limits')
  if (options.window !== undefined && (!Array.isArray(options.window) || options.window.length !== 4 || !options.window.every(Number.isFinite) || options.window[0] >= options.window[2] || options.window[1] >= options.window[3])) throw new Error('Preview window requires xmin,ymin,xmax,ymax with positive dimensions')
  const maxNormalizationNodes = options.maxNormalizationNodes ?? MAX_NORMALIZATION_NODES
  if (!Number.isSafeInteger(maxNormalizationNodes) || maxNormalizationNodes < 1 || maxNormalizationNodes > MAX_NORMALIZATION_NODES) throw new Error('Native normalization budget must be 1..1000000 nodes per drawing')
  return { ...options, maxEntities, maxFindings, maxNormalizationNodes }
}

function logicalReferences(state, maxNormalizationNodes) {
  const objects = state.objects
  const sharedBudget = { nodes: maxNormalizationNodes, exhausted: false }
  const consume = budget => {
    if (budget.nodes <= 0) { budget.exhausted = true; return false }
    budget.nodes--; return true
  }
  const owners = new Map([[state.spaces.modelSpaceId, 'model']])
  for (const id of state.spaces.layoutIds) {
    const layout = objects[id]
    if (layout?.payload.blockRecordId !== state.spaces.modelSpaceId) owners.set(layout?.payload.blockRecordId, `layout:${layout?.name}`)
  }
  for (const object of Object.values(objects)) if (object.kind === 'block-record' && !owners.has(object.id)) owners.set(object.id, `block:${object.name}`)
  const logicalKey = object => owners.get(object.id) ?? `${object.kind}:${object.type}:${object.name ?? ''}`
  const logicalCounts = new Map()
  for (const object of Object.values(objects).filter(object => !object.erased)) {
    const key = logicalKey(object); logicalCounts.set(key, (logicalCounts.get(key) ?? 0) + 1)
  }
  const identity = (id, seen, depth, budget) => {
    const object = objects[id]
    if (!object || object.erased) return unknown('missing-or-erased-native-reference')
    if (depth > 40 || !consume(budget)) return unknown('reference-expansion-budget')
    const key = logicalKey(object)
    if (logicalCounts.get(key) === 1 && (owners.has(id) || object.kind !== 'entity' && object.name)) return { $ref: key }
    if (seen.has(id)) return unknown('cyclic-native-reference')
    const next = new Set([...seen, id])
    // Unnamed/nonunique records cannot share a name-only identity. Compare their
    // native structural contents; cycles/overflow remain unknown, not equal.
    return { $ref: 'native-structural-content', kind: object.kind, type: object.type, name: object.name,
      owner: object.ownerId === null ? null : owners.get(object.ownerId) ?? identity(object.ownerId, next, depth + 1, budget),
      payload: normalize(object.payload, next, '', depth + 1, budget), extension: normalize(object.extension, next, '', depth + 1, budget) }
  }
  const normalize = (value, seen = new Set(), field = '', depth = 0, budget = sharedBudget) => {
    if (depth > 40 || !consume(budget)) return unknown('native-normalization-budget')
    // Only native reference fields are resolved. Literal text equal to a UUID is text.
    if (typeof value === 'string' && (/(?:Id|Ids)$/.test(field) || field === '@reference')) return identity(value, seen, depth + 1, budget)
    if (Array.isArray(value)) {
      if (value.length > budget.nodes) { budget.nodes = 0; budget.exhausted = true; return unknown('native-normalization-budget') }
      return value.map(item => normalize(item, seen, field, depth + 1, budget))
    }
    if (!value || typeof value !== 'object') return value
    const fields = Object.entries(value).filter(([key]) => !OMIT.has(key))
    if (fields.length > budget.nodes) { budget.nodes = 0; budget.exhausted = true; return unknown('native-normalization-budget') }
    return Object.fromEntries(fields.map(([key, child]) => [key, normalize(child, seen, field === 'entries' ? '@reference' : key, depth + 1, budget)]))
  }
  return { owners, normalize, logicalCounts, sharedBudget }
}

export function captureDrawing(document, inputOptions) {
  const options = normalizeOptions(inputOptions), state = document.snapshot(), all = document.listEntities()
  if (all.length > options.maxEntities) throw new Error(`Entity budget exceeded (${all.length} > ${options.maxEntities}); no partial clean result is produced`)
  const { owners, normalize, logicalCounts, sharedBudget } = logicalReferences(state, options.maxNormalizationNodes)
  const scopeOwners = options.scope === 'all' ? null : new Set([...owners].filter(([, name]) => name === options.scope).map(([id]) => id))
  if (scopeOwners && scopeOwners.size !== 1) throw new Error(`Scope is absent or ambiguous: ${options.scope}`)
  const knownLayers = new Set(document.getTable('layers')?.records.map(layer => layer.name) ?? [])
  if (options.layers?.some(name => !knownLayers.has(name))) throw new Error('Requested layer is absent from the drawing')
  const entities = all.filter(entity => (!scopeOwners || scopeOwners.has(entity.ownerId)) && (!options.layers || options.layers.includes(state.objects[entity.payload.layerId]?.name)))
    .map(entity => {
      const payload = normalize(entity.payload), owner = owners.get(entity.ownerId) ?? 'unresolved-owner'
      const layer = state.objects[entity.payload.layerId]?.name ?? null
      const semantic = { type: entity.type, owner, name: entity.name, payload, extension: normalize(entity.extension) }
      const uncertain = hasUnknown(semantic) || logicalCounts.get(owner) !== 1
      const keys = GEOMETRY_KEYS[entity.type]
      const geometry = keys && { type: entity.type, owner, geometry: Object.fromEntries(keys.filter(key => Object.hasOwn(payload, key)).map(key => [key, payload[key]])) }
      return { id: entity.id, handle: entity.handle, type: entity.type, owner, layer, semantic, geometry, uncertain,
        raw: entity.payload, sourceHandle: entity.source?.format === 'DXF' ? entity.source.originalHandle : entity.handle }
    })
  const ignoredRaw = entities.filter(entity => Object.hasOwn(entity.raw, 'rawTags')).map(ref)
  const unsupported = entities.filter(entity => !entity.geometry || entity.type === 'PROXY_ENTITY' || entity.uncertain).map(entity => ({ ...ref(entity), reason: entity.uncertain ? 'Native references or owner identity are unknown, cyclic, ambiguous or exceed the normalization budget; confident matching/duplicate detection is excluded.' : entity.raw.importError ?? 'Native semantic identity is not supported for this entity type' }))
  const resourceRecords = Object.values(state.objects).filter(object => !object.erased && object.kind !== 'entity')
    .map(object => ({ logicalKey: owners.get(object.id) ?? `${object.kind}:${object.type}:${object.name ?? ''}`,
      semantic: { kind: object.kind, type: object.type, name: object.name, owner: object.ownerId === null ? null : normalize(object.ownerId, new Set([object.id]), 'ownerId'),
        payload: normalize(Object.fromEntries(Object.entries(object.payload).filter(([key]) => !['entityIds', 'viewportIds', 'tabOrder'].includes(key)))), extension: normalize(object.extension) } }))
  return { documentId: document.id, revision: document.revision, declaredUnits: state.header.units,
    assertedUnits: options.units, scope: options.scope, entities, resourceRecords,
    validation: document.validate(), coverage: { totalImportedEntities: all.length, selectedEntities: entities.length, excludedEntities: all.length - entities.length,
      typeCounts: countBy(entities, entity => entity.type), unsupported, ignoredOpaquePayloads: ignoredRaw,
      normalization: { limitNodes: options.maxNormalizationNodes, consumedNodes: options.maxNormalizationNodes - sharedBudget.nodes, exhausted: sharedBudget.exhausted, maxDepth: 40, policy: 'shared per-drawing budget; unknown results excluded from confident matching and duplicate checks' },
      opaqueDocumentPayloadKeys: Object.keys(state.opaquePayloads), resourcesCompared: 'named native records only; external binaries/fonts/opaque payloads are not compared',
      excludedResourceFields: ['entityIds', 'viewportIds', 'tabOrder'], resourceOrdering: 'Stored resource membership lists, member order and layout tab order are not compared; entity ownership is compared separately.',
      geometryChecks: ['exact-zero-length-LINE', 'exact-semantic-duplicate-LINE-CIRCLE-ARC-LWPOLYLINE'],
      unimplementedChecks: ['gaps', 'self-intersection', 'cutting suitability', 'GD&T', 'dimension correctness', 'block-instance expansion', 'font fidelity'] } }
}

function countBy(values, property) {
  const result = {}
  for (const value of values) { const key = property(value); result[key] = (result[key] ?? 0) + 1 }
  return result
}

export function checkDrawing(captured, inputOptions) {
  const options = normalizeOptions(inputOptions), findings = [], groups = new Map()
  let omittedFindings = 0, checkedDuplicates = 0, checkedZeroLines = 0
  const add = finding => findings.length < options.maxFindings ? findings.push(finding) : omittedFindings++
  for (const entity of captured.entities) {
    if (entity.type === 'LINE') {
      checkedZeroLines++
      const { start, end } = entity.raw
      if (Array.isArray(start) && Array.isArray(end) && start.length === end.length && start.every((coordinate, index) => coordinate === end[index])) {
        add({ code: 'zero-length-line', severity: 'warning', message: 'The stored LINE endpoints are exactly equal; intent must be reviewed before removal.', entities: [ref(entity)] })
      }
    }
    if (DUPLICATE_TYPES.has(entity.type) && !entity.uncertain) {
      checkedDuplicates++
      // Layer, style, extension and owner are deliberately part of the duplicate key.
      // Coincident lines with different CAD properties are not declared duplicates.
      const key = keyOf(entity.semantic), group = groups.get(key) ?? []
      group.push(entity); groups.set(key, group)
    }
  }
  for (const group of groups.values()) if (group.length > 1) add({ code: 'exact-duplicate', severity: 'warning',
    message: 'These records have identical normalized native geometry and CAD properties in the same owner. Coincidence alone does not authorize deletion.', entities: group.map(ref) })
  return { findings, checkedZeroLines, checkedDuplicates, omittedFindings, complete: omittedFindings === 0 }
}

const groupBy = (entities, property) => {
  const groups = new Map()
  for (const entity of entities) { const key = property(entity); if (key === null) continue; const group = groups.get(key) ?? []; group.push(entity); groups.set(key, group) }
  return groups
}

export function compareDrawings(before, after, inputOptions) {
  const options = normalizeOptions(inputOptions), pairs = [], ambiguous = [], usedBefore = new Set(), usedAfter = new Set()
  const pairStage = (name, property) => {
    const left = groupBy(before.entities.filter(entity => !entity.uncertain && !usedBefore.has(entity.id)), property)
    const right = groupBy(after.entities.filter(entity => !entity.uncertain && !usedAfter.has(entity.id)), property)
    for (const [key, a] of left) {
      const b = right.get(key)
      if (!b) continue
      if (a.length === 1 && b.length === 1) {
        const fields = changedPaths(a[0].semantic, b[0].semantic)
        pairs.push({ status: fields.length ? 'modified' : 'unchanged', matchedBy: name, before: ref(a[0]), after: ref(b[0]), fields })
        usedBefore.add(a[0].id); usedAfter.add(b[0].id)
      } else ambiguous.push({ matchedBy: name, before: a.map(ref), after: b.map(ref), reason: 'Multiple candidates share this exact key; no arbitrary pairing was performed.' })
    }
  }
  if (options.identity === 'same-lineage-handles') pairStage('same-lineage-source-handle', entity => typeof entity.sourceHandle === 'string' && entity.sourceHandle ? entity.sourceHandle.toUpperCase() : null)
  // The full native semantic key resolves truly unchanged coincident geometry first.
  pairStage('unique-exact-semantic', entity => entity.geometry ? keyOf(entity.semantic) : null)
  pairStage('unique-exact-geometry', entity => entity.geometry ? keyOf(entity.geometry) : null)
  const unresolvedAmbiguities = new Map()
  for (const group of ambiguous) {
    const a = group.before.filter(entity => !usedBefore.has(entity.id)), b = group.after.filter(entity => !usedAfter.has(entity.id))
    if (!a.length || !b.length || a.length === 1 && b.length === 1) continue
    const signature = keyOf([a.map(entity => entity.id).sort(), b.map(entity => entity.id).sort()])
    const prior = unresolvedAmbiguities.get(signature)
    if (prior) prior.candidatePolicies.push(group.matchedBy)
    else unresolvedAmbiguities.set(signature, { ...group, before: a, after: b, candidatePolicies: [group.matchedBy] })
  }
  const resources = compareResources(before.resourceRecords, after.resourceRecords)
  return { identityPolicy: options.identity, pairs,
    unmatchedBefore: before.entities.filter(entity => !usedBefore.has(entity.id)).map(ref),
    unmatchedAfter: after.entities.filter(entity => !usedAfter.has(entity.id)).map(ref),
    ambiguous: [...unresolvedAmbiguities.values()], resources,
    counts: { unchanged: pairs.filter(pair => pair.status === 'unchanged').length, modified: pairs.filter(pair => pair.status === 'modified').length,
      unmatchedBefore: before.entities.length - usedBefore.size, unmatchedAfter: after.entities.length - usedAfter.size, ambiguousGroups: unresolvedAmbiguities.size },
    interpretation: 'Unmatched records may be additions, removals or edits that this identity policy cannot safely pair. No proximity or engineering intent is inferred.' }
}

function compareResources(before, after) {
  const left = groupBy(before, record => record.logicalKey), right = groupBy(after, record => record.logicalKey), result = []
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key) ?? [], b = right.get(key) ?? []
    if (a.length > 1 || b.length > 1) { result.push({ logicalKey: key, status: 'ambiguous', reason: 'Nonunique logical record identity' }); continue }
    if (!a.length || !b.length) { result.push({ logicalKey: key, status: a.length ? 'removed' : 'added' }); continue }
    if (hasUnknown(a[0].semantic) || hasUnknown(b[0].semantic)) { result.push({ logicalKey: key, status: 'unknown', reason: 'Native reference normalization is incomplete' }); continue }
    const fields = changedPaths(a[0].semantic, b[0].semantic)
    if (fields.length) result.push({ logicalKey: key, status: 'modified', fields })
  }
  return result
}
