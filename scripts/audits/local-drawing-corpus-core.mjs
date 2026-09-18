import { createHash, createHmac } from 'node:crypto'

import { displayedEntityBounds } from '../../packages/kjdraw-sdk/src/selection-geometry.js'

export const KJDRAW_LOCAL_CORPUS_SCHEMA = 'com.kanjie.kjdraw.local-drawing-corpus-manifest@2'
export const KJDRAW_CANONICAL_FEATURE_SCHEMA = 'com.kanjie.kjdraw.canonical-feature-summary@2'
export const KJDRAW_FEATURE_COMPARISON_SCHEMA = 'com.kanjie.kjdraw.feature-comparison@2'

const textTypes = new Set(['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF'])
const referenceKeys = new Set(['layerId', 'lineTypeId', 'styleId', 'dimensionStyleId', 'blockRecordId'])
const finite = value => typeof value === 'number' && Number.isFinite(value)
const stableCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => stableCompare(left, right))
    .map(([key, item]) => [key, canonicalize(item)]))
  if (finite(value)) return Object.is(value, -0) ? 0 : value
  return value
}

export const canonicalJson = value => `${JSON.stringify(canonicalize(value), null, 2)}\n`
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonicalize(value))).digest('hex')
const privateDigest = (value, salt, domain) => createHmac('sha256', salt).update(`${domain}\0${typeof value === 'string' ? value : JSON.stringify(canonicalize(value))}`).digest('hex')

export function validateCorpusSalt(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 1024 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('KJDRAW_CORPUS_SALT must contain 16-1024 printable characters')
  }
  return value
}

export function anonymousFileId(bytes, salt, corpusId) {
  validateCorpusSalt(salt)
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error('Anonymous file IDs require nonempty source bytes')
  if (typeof corpusId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(corpusId)) throw new Error('corpusId must be a stable lowercase identifier')
  const hmac = createHmac('sha256', salt)
  hmac.update(`${KJDRAW_LOCAL_CORPUS_SCHEMA}\0${corpusId}\0`)
  hmac.update(bytes)
  return `cad-${hmac.digest('hex').slice(0, 32)}`
}

export function classifyDrawingHint(value) {
  const hint = String(value ?? '').normalize('NFKC').toLowerCase()
  if (/柱状图|钻孔柱状|borehole[ _-]*column|geolog(?:y|ical)[ _-]*column/u.test(hint)) return 'geology-column'
  if (/剖面图|地质剖面|section|profile/u.test(hint)) return 'geology-section'
  if (/勘探点.*平面|平面位置|勘察平面|geolog(?:y|ical)[ _-]*plan/u.test(hint)) return 'geology-plan'
  if (/机械|零件|螺丝|螺钉|齿轮|链轮|公差|machin|part|bolt|gear/u.test(hint)) return 'manufacturing'
  if (/施工现场|施工总平|现场平面布置|site[ _-]*plan|construction[ _-]*site/u.test(hint)) return 'construction-site-plan'
  if (/建筑|办公楼|楼层|architecture|building/u.test(hint)) return 'architecture'
  return 'unclassified-cad'
}

function rounded(value, tolerance) {
  if (!finite(value)) return null
  const result = Math.round(value / tolerance) * tolerance
  return Number((Object.is(result, -0) ? 0 : result).toPrecision(15))
}

function point(value, tolerance) {
  if (!Array.isArray(value) || value.length < 2 || !finite(value[0]) || !finite(value[1])) return null
  return [rounded(value[0], tolerance), rounded(value[1], tolerance), rounded(value[2] ?? 0, tolerance)]
}

function hatchValue(value, tolerance) {
  if (finite(value)) return rounded(value, tolerance)
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.map(item => hatchValue(item, tolerance))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['sourceHandles', 'sourceBoundaryObjects'].includes(key))
    .map(([key, item]) => [key, key === 'rawTags' ? digest(item) : hatchValue(item, tolerance)]))
  return String(value)
}

function geometryOf(entity, tolerance) {
  const source = entity.payload ?? {}
  const pick = (...keys) => Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => {
    const value = source[key]
    if (finite(value)) return [key, rounded(value, tolerance)]
    const p = point(value, tolerance)
    return [key, p ?? value]
  }))
  if (entity.type === 'LINE') return pick('start', 'end')
  if (entity.type === 'RAY' || entity.type === 'XLINE') return pick('origin', 'direction')
  if (entity.type === 'POINT') return pick('position')
  if (entity.type === 'CIRCLE') return pick('center', 'radius')
  if (entity.type === 'ARC') return pick('center', 'radius', 'startAngle', 'endAngle')
  if (entity.type === 'ELLIPSE') return pick('center', 'majorAxis', 'ratio', 'startParameter', 'endParameter')
  if (entity.type === 'INSERT') return pick('position', 'scale', 'rotation', 'blockRecordId')
  if (entity.type === 'TEXT' || entity.type === 'ATTRIB' || entity.type === 'ATTDEF') return pick(
    'position', 'alignmentPoint', 'height', 'rotation', 'widthFactor', 'obliqueAngle', 'generationFlags',
    'horizontalAlignment', 'verticalAlignment', 'normal', 'extrusionDirection', 'thickness')
  if (entity.type === 'MTEXT') return pick(
    'position', 'height', 'width', 'rotation', 'direction', 'attachmentPoint', 'lineSpacingStyle',
    'lineSpacingFactor', 'backgroundFill', 'backgroundScale', 'normal', 'extrusionDirection')
  if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') return {
    closed: source.closed === true,
    vertices: Array.isArray(source.vertices) ? source.vertices.map(vertex => {
      const raw = vertex && typeof vertex === 'object' && !Array.isArray(vertex) ? vertex : { point: vertex }
      return { point: point(raw.point, tolerance), ...(finite(raw.bulge) ? { bulge: rounded(raw.bulge, tolerance) } : {}) }
    }) : null,
  }
  if (entity.type === 'HATCH') return {
    solid: source.solid === true, associative: source.associative === true,
    patternName: String(source.patternName ?? ''), patternScale: finite(source.patternScale) ? rounded(source.patternScale, tolerance) : null,
    patternAngle: finite(source.patternAngle) ? rounded(source.patternAngle, tolerance) : null,
    patternLines: Array.isArray(source.patternLines) ? hatchValue(source.patternLines, tolerance) : null,
    boundaryLoops: Array.isArray(source.boundaryLoops) ? hatchValue(source.boundaryLoops, tolerance) : null,
  }
  if (entity.type === 'DIMENSION') return pick('dimensionType', 'definitionPoints', 'measurement', 'textOverride')
  return null
}

function styleOf(document, entity, salt) {
  const source = entity.payload ?? {}, result = {}
  for (const key of ['color', 'lineweight', 'linetypeScale', 'visible']) if (source[key] !== undefined) result[key] = source[key]
  for (const key of referenceKeys) if (typeof source[key] === 'string') {
    const target = document.getObject(source[key])
    result[key] = target ? {
      identity: `${target.kind}:${target.type}:${target.name ?? ''}`,
      payloadDigest: privateDigest(target.payload ?? {}, salt, 'kjdraw-corpus-resource'),
    } : 'unresolved'
  }
  return result
}

function textOf(entity, salt) {
  if (!textTypes.has(entity.type)) return null
  const raw = String(entity.payload?.text ?? entity.payload?.defaultValue ?? '')
  return {
    length: [...raw].length,
    lineCount: raw ? raw.split(/\\P|\r?\n/u).length : 0,
    containsCjk: /[\u3400-\u9fff]/u.test(raw),
    digest: createHmac('sha256', salt).update(`kjdraw-corpus-text\0${raw}`).digest('hex'),
    height: finite(entity.payload?.height) ? entity.payload.height : null,
    rotation: finite(entity.payload?.rotation) ? entity.payload.rotation : null,
  }
}

function primitive(entity) {
  const payload = entity.payload ?? {}
  if (entity.type === 'LINE') {
    const start = point(payload.start, 1e-12), end = point(payload.end, 1e-12)
    if (!start || !end) return null
    const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy)
    return length > 0 ? { kind: 'line', start, end, dx, dy, length } : null
  }
  if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
    const center = point(payload.center, 1e-12)
    return center && finite(payload.radius) && payload.radius > 0 ? { kind: 'circle', center, radius: payload.radius } : null
  }
  return null
}

function relationCounts(entities, tolerance) {
  const primitives = entities.map((entity, index) => ({ index, value: primitive(entity) })).filter(item => item.value)
  const counts = { connected: 0, parallel: 0, perpendicular: 0, collinear: 0, concentric: 0, equalLength: 0, equalRadius: 0 }
  let comparisons = 0
  if (primitives.length > 256) return { counts, comparisons, omitted: primitives.length - 256, reason: 'primitive-budget' }
  const close = (left, right) => Math.abs(left - right) <= tolerance
  const samePoint = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1]) <= tolerance
  for (let leftIndex = 0; leftIndex < primitives.length; leftIndex++) for (let rightIndex = leftIndex + 1; rightIndex < primitives.length; rightIndex++) {
    comparisons += 1
    const left = primitives[leftIndex].value, right = primitives[rightIndex].value
    if (left.kind === 'line' && right.kind === 'line') {
      if ([left.start, left.end].some(a => [right.start, right.end].some(b => samePoint(a, b)))) counts.connected += 1
      const cross = left.dx * right.dy - left.dy * right.dx
      const dot = left.dx * right.dx + left.dy * right.dy
      const scale = left.length * right.length
      if (Math.abs(cross) <= tolerance * Math.max(1, scale)) {
        counts.parallel += 1
        const offsetCross = (right.start[0] - left.start[0]) * left.dy - (right.start[1] - left.start[1]) * left.dx
        if (Math.abs(offsetCross) <= tolerance * Math.max(1, left.length)) counts.collinear += 1
      }
      if (Math.abs(dot) <= tolerance * Math.max(1, scale)) counts.perpendicular += 1
      if (close(left.length, right.length)) counts.equalLength += 1
    } else if (left.kind === 'circle' && right.kind === 'circle') {
      if (samePoint(left.center, right.center)) counts.concentric += 1
      if (close(left.radius, right.radius)) counts.equalRadius += 1
    }
  }
  return { counts, comparisons, omitted: 0, reason: null }
}

function count(values) {
  const result = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => stableCompare(left, right)))
}

function overallBounds(document, entities) {
  const bounds = entities.map(entity => displayedEntityBounds(document, entity)).filter(Boolean)
  if (!bounds.length) return null
  const merged = bounds.reduce((result, value) => [Math.min(result[0], value[0]), Math.min(result[1], value[1]), Math.max(result[2], value[2]), Math.max(result[3], value[3])])
  return { width: merged[2] - merged[0], height: merged[3] - merged[1] }
}

const plotNumericKeys = [
  'paperWidth', 'paperHeight', 'paperUnits', 'rotation', 'plotType', 'flags',
  'scaleNumerator', 'scaleDenominator', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom',
  'originX', 'originY', 'windowMinX', 'windowMinY', 'windowMaxX', 'windowMaxY',
]
const plotPrivateTextKeys = ['pageSetupName', 'printerName', 'paperName', 'viewName']

function plotLayoutOf(layout, salt, tolerance) {
  const payload = layout.payload ?? {}, raw = payload.dxfPlotSettings
  const settings = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  const numeric = settings ? Object.fromEntries(plotNumericKeys
    .filter(key => settings[key] !== undefined)
    .map(key => [key, finite(settings[key]) ? rounded(settings[key], tolerance) : 'invalid'])) : null
  const privateText = settings ? Object.fromEntries(plotPrivateTextKeys
    .filter(key => settings[key] !== undefined)
    .map(key => [key, typeof settings[key] === 'string'
      ? privateDigest(settings[key], salt, `kjdraw-corpus-plot-${key}`)
      : 'invalid'])) : null
  const paper = payload.paper && typeof payload.paper === 'object' && !Array.isArray(payload.paper)
    ? Object.fromEntries(Object.entries(payload.paper).map(([key, value]) => [key, finite(value) ? rounded(value, tolerance) : value]))
    : payload.paper ?? null
  const geometry = payload.dxfLayoutGeometry && typeof payload.dxfLayoutGeometry === 'object' && !Array.isArray(payload.dxfLayoutGeometry)
    ? privateDigest(payload.dxfLayoutGeometry, salt, 'kjdraw-corpus-layout-geometry')
    : null
  return {
    nameDigest: privateDigest(layout.name ?? '', salt, 'kjdraw-corpus-layout-name'),
    paper,
    plotSettings: settings ? { numeric, privateText } : null,
    layoutGeometryDigest: geometry,
    viewportCount: Array.isArray(payload.viewportIds) ? payload.viewportIds.length : 0,
  }
}

export function createCanonicalFeatureSummary(document, { salt, geometryTolerance = 1e-6 } = {}) {
  validateCorpusSalt(salt)
  if (!finite(geometryTolerance) || geometryTolerance <= 0 || geometryTolerance > 1e6) throw new Error('geometryTolerance must be finite, positive and at most 1000000')
  const entities = [...document.listEntities()].sort((left, right) => stableCompare(left.ownerId ?? '', right.ownerId ?? '') || stableCompare(left.handle ?? '', right.handle ?? '') || stableCompare(left.id, right.id))
  const nodes = entities.map(entity => {
    const owner = document.getObject(entity.ownerId), geometry = geometryOf(entity, geometryTolerance), style = styleOf(document, entity, salt), text = textOf(entity, salt)
    const bounds = displayedEntityBounds(document, entity)
    return {
      type: entity.type,
      owner: owner ? `${owner.kind}:${owner.type}:${owner.name ?? ''}` : 'unresolved',
      geometryDigest: geometry === null ? null : privateDigest(geometry, salt, 'kjdraw-corpus-geometry'),
      styleDigest: privateDigest(style, salt, 'kjdraw-corpus-style'),
      textDigest: text?.digest ?? null,
      boundsSize: bounds ? [rounded(bounds[2] - bounds[0], geometryTolerance), rounded(bounds[3] - bounds[1], geometryTolerance)] : null,
      text: text ? { ...text, digest: undefined } : null,
    }
  })
  const snapshot = document.snapshot(), bounds = overallBounds(document, entities)
  const relations = relationCounts(entities, geometryTolerance)
  const layouts = (snapshot.spaces?.layoutIds ?? []).map(id => snapshot.objects[id]).filter(Boolean).map(layout => ({
    model: layout.payload?.model === true || layout.name === 'Model',
    tabOrder: finite(layout.payload?.tabOrder) ? layout.payload.tabOrder : null,
    entityCount: entities.filter(entity => entity.ownerId === layout.payload?.blockRecordId).length,
    ...plotLayoutOf(layout, salt, geometryTolerance),
  })).sort((left, right) => Number(right.model) - Number(left.model) || (left.tabOrder ?? 0) - (right.tabOrder ?? 0) || stableCompare(left.nameDigest, right.nameDigest))
  const summary = {
    schema: KJDRAW_CANONICAL_FEATURE_SCHEMA,
    geometryTolerance,
    units: snapshot.header?.units ?? null,
    sourceVersion: snapshot.header?.sourceVersion ?? null,
    bounds: bounds ? { width: rounded(bounds.width, geometryTolerance), height: rounded(bounds.height, geometryTolerance) } : null,
    layouts,
    counts: {
      entities: entities.length,
      entityTypes: count(entities.map(entity => entity.type)),
      layers: document.getTable('layers')?.records.length ?? 0,
      blocks: document.listObjects({ type: 'BLOCK_RECORD' }).length,
      text: entities.filter(entity => textTypes.has(entity.type)).length,
      hatches: entities.filter(entity => entity.type === 'HATCH').length,
      dimensions: entities.filter(entity => entity.type === 'DIMENSION').length,
      viewports: entities.filter(entity => entity.type === 'VIEWPORT').length,
      proxies: entities.filter(entity => entity.type === 'PROXY_ENTITY').length,
    },
    fingerprints: {
      geometry: count(nodes.map(node => `${node.type}:${node.geometryDigest ?? 'unsupported'}`)),
      style: count(nodes.map(node => `${node.type}:${node.styleDigest}`)),
      text: count(nodes.filter(node => node.textDigest).map(node => `${node.type}:${node.textDigest}`)),
      bounds: count(nodes.map(node => `${node.type}:${privateDigest(node.boundsSize, salt, 'kjdraw-corpus-bounds')}`)),
    },
    relations,
    dependencies: {
      textStyles: document.getTable('textStyles')?.records.length ?? 0,
      unresolvedResourceReferences: nodes.filter(node => node.owner === 'unresolved').length,
      externalReferences: 'not-resolved',
      fonts: 'not-resolved',
    },
  }
  return canonicalize({ ...summary, digest: digest(summary) })
}

function compareMap(expected, actual, category, differences) {
  const keys = [...new Set([...Object.keys(expected ?? {}), ...Object.keys(actual ?? {})])].sort(stableCompare)
  for (const key of keys) {
    const left = expected?.[key] ?? 0, right = actual?.[key] ?? 0
    if (left !== right) differences.push({ category, keyDigest: digest(key), expected: left, actual: right, delta: right - left })
  }
}

export function compareCanonicalFeatureSummaries(expected, actual, { boundsTolerance = 0 } = {}) {
  if (expected?.schema !== KJDRAW_CANONICAL_FEATURE_SCHEMA || actual?.schema !== KJDRAW_CANONICAL_FEATURE_SCHEMA) throw new Error('Feature comparison requires canonical feature summaries')
  if (!finite(boundsTolerance) || boundsTolerance < 0) throw new Error('boundsTolerance must be finite and nonnegative')
  const differences = []
  const exact = (category, key, left, right) => { if (JSON.stringify(left) !== JSON.stringify(right)) differences.push({ category, key, expected: left, actual: right }) }
  exact('semantic', 'units', expected.units, actual.units)
  exact('layout', 'layouts', expected.layouts, actual.layouts)
  for (const key of ['entities', 'layers', 'blocks', 'text', 'hatches', 'dimensions', 'viewports', 'proxies']) exact('structure', key, expected.counts[key], actual.counts[key])
  compareMap(expected.counts.entityTypes, actual.counts.entityTypes, 'structure', differences)
  compareMap(expected.fingerprints.geometry, actual.fingerprints.geometry, 'geometry', differences)
  compareMap(expected.fingerprints.style, actual.fingerprints.style, 'style', differences)
  compareMap(expected.fingerprints.text, actual.fingerprints.text, 'text', differences)
  compareMap(expected.fingerprints.bounds, actual.fingerprints.bounds, 'geometry', differences)
  compareMap(expected.relations.counts, actual.relations.counts, 'topology', differences)
  if (expected.bounds === null || actual.bounds === null) exact('geometry', 'bounds', expected.bounds, actual.bounds)
  else for (const key of ['width', 'height']) if (Math.abs(expected.bounds[key] - actual.bounds[key]) > boundsTolerance) differences.push({ category: 'geometry', key: `bounds.${key}`, expected: expected.bounds[key], actual: actual.bounds[key], tolerance: boundsTolerance })
  const categoryCounts = count(differences.map(item => item.category))
  return canonicalize({
    schema: KJDRAW_FEATURE_COMPARISON_SCHEMA,
    passed: differences.length === 0,
    expectedDigest: expected.digest,
    actualDigest: actual.digest,
    categoryCounts,
    differences,
  })
}

export function dwgHeaderVersion(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 6) return null
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 6))
  return /^AC10\d{2}$/u.test(header) ? header : null
}

export function safeFailureReason(error, privateValues = []) {
  let text = error instanceof Error ? error.message : String(error)
  for (const value of privateValues.filter(Boolean).sort((left, right) => String(right).length - String(left).length)) text = text.replaceAll(String(value), '[private]')
  text = text.replace(/[A-Za-z]:[\\/][^\r\n:]+/gu, '[private-path]')
  return text.slice(0, 512)
}
