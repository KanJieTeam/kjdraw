import { KJValidationError } from './errors.js'
import { clone, normalizeName } from './utils.js'
import { length2, vec2 } from './geometry/vector2.js'

export const KJ_ENTITY_CONTRACT_VERSION = 1

const STANDARD = new Set([
  'LINE', 'RAY', 'XLINE', 'POINT', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE',
  'ELLIPSE', 'SPLINE', 'TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB', 'INSERT', 'IMAGE', 'HATCH', 'LEADER',
  'MLEADER', 'DIMENSION', 'VIEWPORT', 'WIPEOUT', 'REVISION_CLOUD',
  'SOLID', 'TRACE', 'TABLE', 'PROXY_ENTITY',
  'SOLID3D',
])

export function listStandardEntityTypes() { return Object.freeze([...STANDARD]) }

function finite(value, label) {
  value = Number(value)
  if (!Number.isFinite(value)) throw new KJValidationError(`${label} must be finite`)
  return value
}

function positive(value, label, { allowZero = false } = {}) {
  value = finite(value, label)
  if (allowZero ? value < 0 : value <= 0) throw new KJValidationError(`${label} must be ${allowZero ? 'non-negative' : 'positive'}`)
  return value
}

function positiveInteger(value, label) {
  value = Number(value)
  if (!Number.isInteger(value) || value < 1) throw new KJValidationError(`${label} must be a positive integer`)
  return value
}

function point3(value, label) {
  const [x, y] = vec2(value, label)
  const z = Array.isArray(value) ? finite(value[2] ?? 0, `${label}.z`) : finite(value?.z ?? 0, `${label}.z`)
  return [x, y, z]
}

function vector3(value, label) {
  const result = point3(value, label)
  if (length2(result) <= 1e-15 && Math.abs(result[2]) <= 1e-15) throw new KJValidationError(`${label} cannot be zero`)
  return result
}

function base(payload) {
  return { ...clone(payload), contractVersion: KJ_ENTITY_CONTRACT_VERSION }
}

function normalizeVertex(vertex, index) {
  if (Array.isArray(vertex)) return { point: point3(vertex, `vertices[${index}]`), bulge: 0, startWidth: 0, endWidth: 0 }
  return {
    ...clone(vertex),
    point: point3(vertex?.point, `vertices[${index}].point`),
    bulge: finite(vertex?.bulge ?? 0, `vertices[${index}].bulge`),
    startWidth: positive(vertex?.startWidth ?? 0, `vertices[${index}].startWidth`, { allowZero: true }),
    endWidth: positive(vertex?.endWidth ?? 0, `vertices[${index}].endWidth`, { allowZero: true }),
  }
}

function normalizePolyline(payload) {
  const source = payload.vertices ?? payload.points
  if (!Array.isArray(source) || source.length < 2) throw new KJValidationError('Polyline requires at least two vertices')
  return { ...base(payload), vertices: source.map(normalizeVertex), closed: Boolean(payload.closed), elevation: finite(payload.elevation ?? 0, 'elevation') }
}

function normalizeHatch(payload) {
  if (!Array.isArray(payload.boundaryLoops) || !payload.boundaryLoops.length) throw new KJValidationError('Hatch requires at least one boundary loop')
  const loops = payload.boundaryLoops.map((loop, loopIndex) => {
    const value = { ...clone(loop), external: loop.external !== false }
    if (loop.vertices) value.vertices = loop.vertices.map((vertex, index) => normalizeVertex(vertex, `${loopIndex}.${index}`))
    if (!value.vertices?.length && !Array.isArray(loop.edges)) throw new KJValidationError(`Hatch loop ${loopIndex} requires vertices or edges`)
    return value
  })
  return { ...base(payload), boundaryLoops: loops, patternName: String(payload.patternName ?? 'SOLID'), patternScale: positive(payload.patternScale ?? 1, 'patternScale'), patternAngle: finite(payload.patternAngle ?? 0, 'patternAngle'), solid: Boolean(payload.solid ?? normalizeName(payload.patternName) === 'SOLID') }
}

export function isStandardEntityType(type) { return STANDARD.has(normalizeName(type)) }

export function normalizeStandardEntityPayload(type, payload = {}) {
  type = normalizeName(type)
  if (!STANDARD.has(type)) return clone(payload)
  switch (type) {
    case 'LINE': {
      const value = { ...base(payload), start: point3(payload.start, 'start'), end: point3(payload.end, 'end') }
      const degenerate = length2([value.end[0] - value.start[0], value.end[1] - value.start[1]]) <= 1e-15 && Math.abs(value.end[2] - value.start[2]) <= 1e-15
      return { ...value, degenerate }
    }
    case 'RAY':
    case 'XLINE': return { ...base(payload), origin: point3(payload.origin, 'origin'), direction: vector3(payload.direction, 'direction') }
    case 'POINT': return { ...base(payload), position: point3(payload.position, 'position') }
    case 'CIRCLE': return { ...base(payload), center: point3(payload.center, 'center'), radius: positive(payload.radius, 'radius'), normal: vector3(payload.normal ?? [0, 0, 1], 'normal') }
    case 'ARC': return { ...base(payload), center: point3(payload.center, 'center'), radius: positive(payload.radius, 'radius'), startAngle: finite(payload.startAngle, 'startAngle'), endAngle: finite(payload.endAngle, 'endAngle'), clockwise: Boolean(payload.clockwise), normal: vector3(payload.normal ?? [0, 0, 1], 'normal') }
    case 'LWPOLYLINE':
    case 'POLYLINE': return normalizePolyline(payload)
    case 'ELLIPSE': {
      const ratio = positive(payload.ratio, 'ratio')
      if (ratio > 1) throw new KJValidationError('Ellipse ratio cannot exceed 1')
      return { ...base(payload), center: point3(payload.center, 'center'), majorAxis: vector3(payload.majorAxis, 'majorAxis'), ratio, startParameter: finite(payload.startParameter ?? 0, 'startParameter'), endParameter: finite(payload.endParameter ?? Math.PI * 2, 'endParameter') }
    }
    case 'SPLINE': {
      const degree = Math.trunc(positive(payload.degree, 'degree'))
      const controlPoints = (payload.controlPoints ?? []).map((point, index) => point3(point, `controlPoints[${index}]`))
      if (controlPoints.length < degree + 1) throw new KJValidationError('Spline requires at least degree + 1 control points')
      const weights = payload.weights?.map((value, index) => positive(value, `weights[${index}]`))
      if (weights && weights.length !== controlPoints.length) throw new KJValidationError('Spline weights must match control points')
      const knots = payload.knots?.map((value, index) => finite(value, `knots[${index}]`))
      if (knots && knots.length !== controlPoints.length + degree + 1) throw new KJValidationError('Spline knot vector length must equal control points + degree + 1')
      if (knots?.some((value, index) => index > 0 && value < knots[index - 1])) throw new KJValidationError('Spline knots must be non-decreasing')
      if (knots && !(knots[controlPoints.length] > knots[degree])) throw new KJValidationError('Spline knot domain is empty')
      return { ...base(payload), degree, controlPoints, fitPoints: payload.fitPoints?.map((point, index) => point3(point, `fitPoints[${index}]`)), knots, weights, closed: Boolean(payload.closed), periodic: Boolean(payload.periodic) }
    }
    case 'TEXT':
    case 'MTEXT': return { ...base(payload), position: point3(payload.position, 'position'), alignmentPoint: payload.alignmentPoint && point3(payload.alignmentPoint, 'alignmentPoint'), text: String(payload.text ?? ''), height: positive(payload.height ?? 2.5, 'height'), rotation: finite(payload.rotation ?? 0, 'rotation'), styleId: payload.styleId == null ? null : String(payload.styleId) }
    case 'ATTDEF':
    case 'ATTRIB': return { ...base(payload), position: point3(payload.position, 'position'), alignmentPoint: payload.alignmentPoint && point3(payload.alignmentPoint, 'alignmentPoint'), text: String(payload.text ?? ''), tag: String(payload.tag ?? ''), prompt: String(payload.prompt ?? ''), flags: Math.trunc(finite(payload.flags ?? 0, 'flags')), height: positive(payload.height ?? 2.5, 'height'), rotation: finite(payload.rotation ?? 0, 'rotation'), styleId: payload.styleId == null ? null : String(payload.styleId), lockPosition: Boolean(payload.lockPosition) }
    case 'INSERT': {
      if (!payload.blockRecordId) throw new KJValidationError('Block insert requires blockRecordId')
      const scale = Array.isArray(payload.scale) ? payload.scale.map((value, index) => finite(value, `scale[${index}]`)) : [finite(payload.scale ?? 1, 'scale'), finite(payload.scale ?? 1, 'scale'), finite(payload.scale ?? 1, 'scale')]
      if (scale.length !== 3 || scale.some(value => Math.abs(value) <= 1e-15)) throw new KJValidationError('Block insert scale must contain three non-zero values')
      return { ...base(payload), blockRecordId: String(payload.blockRecordId), position: point3(payload.position ?? [0, 0, 0], 'position'), scale, rotation: finite(payload.rotation ?? 0, 'rotation'), attributes: clone(payload.attributes ?? {}) }
    }
    case 'IMAGE': return { ...base(payload), imageResourceId: String(payload.imageResourceId ?? ''), position: point3(payload.position, 'position'), uVector: vector3(payload.uVector, 'uVector'), vVector: vector3(payload.vVector, 'vVector'), clipBoundary: payload.clipBoundary?.map((point, index) => point3(point, `clipBoundary[${index}]`)) }
    case 'HATCH': return normalizeHatch(payload)
    case 'LEADER':
    case 'MLEADER': return { ...base(payload), vertices: (payload.vertices ?? []).map((point, index) => point3(point, `vertices[${index}]`)), textPosition: payload.textPosition && point3(payload.textPosition, 'textPosition'), annotationId: payload.annotationId == null ? null : String(payload.annotationId) }
    case 'DIMENSION': return { ...base(payload), dimensionType: normalizeName(payload.dimensionType ?? 'ALIGNED'), definitionPoints: (payload.definitionPoints ?? []).map((point, index) => point3(point, `definitionPoints[${index}]`)), textPosition: payload.textPosition && point3(payload.textPosition, 'textPosition'), textOverride: payload.textOverride == null ? null : String(payload.textOverride), styleId: payload.styleId == null ? null : String(payload.styleId), styleName: String(payload.styleName ?? 'STANDARD'), blockName: payload.blockName == null ? null : String(payload.blockName), measurement: payload.measurement == null ? null : finite(payload.measurement, 'measurement'), dxfDimensionType: payload.dxfDimensionType == null ? null : Math.trunc(finite(payload.dxfDimensionType, 'dxfDimensionType')), rotation: finite(payload.rotation ?? 0, 'rotation') }
    case 'VIEWPORT': return { ...base(payload), center: point3(payload.center, 'center'), width: positive(payload.width, 'width'), height: positive(payload.height, 'height'), viewCenter: point3(payload.viewCenter ?? [0, 0, 0], 'viewCenter'), viewHeight: positive(payload.viewHeight, 'viewHeight'), twistAngle: finite(payload.twistAngle ?? 0, 'twistAngle'), frozenLayerIds: [...(payload.frozenLayerIds ?? [])].map(String) }
    case 'WIPEOUT':
    case 'REVISION_CLOUD': return normalizePolyline({ ...payload, closed: true })
    case 'SOLID':
    case 'TRACE': {
      const vertices = (payload.vertices ?? payload.points ?? []).map((point, index) => point3(point, `vertices[${index}]`))
      if (vertices.length < 3 || vertices.length > 4) throw new KJValidationError(`${type} requires three or four vertices`)
      return { ...base(payload), vertices }
    }
    case 'SOLID3D': {
      if (payload.kernelAuthority !== 'kjcore-rust-wasm' || Number(payload.solidModelVersion) !== 1) throw new KJValidationError('SOLID3D requires the KJCore Rust WASM authority')
      const vertices=(payload.vertices??[]).map((point,index)=>point3(point,`vertices[${index}]`))
      if(vertices.length<4)throw new KJValidationError('SOLID3D requires at least four vertices')
      const triangles=(payload.triangles??[]).map((triangle,index)=>{if(!Array.isArray(triangle)||triangle.length!==3||!triangle.every(value=>Number.isInteger(value)&&value>=0&&value<vertices.length))throw new KJValidationError(`triangles[${index}] must contain three valid vertex indices`);if(new Set(triangle).size!==3)throw new KJValidationError(`triangles[${index}] is degenerate`);return triangle.map(Number)})
      if(triangles.length<4)throw new KJValidationError('SOLID3D requires at least four triangles')
      const validation=clone(payload.validation??{})
      if(validation.valid!==true||validation.finite!==true||validation.orientation!=='outward'||Number(validation.volume)<=0||Number(validation.boundaryEdges)!==0||Number(validation.nonManifoldEdges)!==0||Number(validation.inconsistentEdges)!==0||Number(validation.degenerateTriangles)!==0)throw new KJValidationError('SOLID3D must carry a successful KJCore topology validation')
      return{...base(payload),kernelAuthority:'kjcore-rust-wasm',solidModelVersion:1,construction:String(payload.construction??'solid'),vertices,triangles,validation}
    }
    case 'TABLE': {
      const rows = positiveInteger(payload.rows, 'rows'), columns = positiveInteger(payload.columns, 'columns')
      const cells = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => clone(payload.cells?.[row]?.[column] ?? { text: '' })))
      const rowHeights = Array.from({ length: rows }, (_, index) => positive(payload.rowHeights?.[index] ?? payload.rowHeight ?? 8, `rowHeights[${index}]`))
      const columnWidths = Array.from({ length: columns }, (_, index) => positive(payload.columnWidths?.[index] ?? payload.columnWidth ?? 25, `columnWidths[${index}]`))
      return { ...base(payload), position: point3(payload.position ?? [0, 0, 0], 'position'), rows, columns, cells, rowHeights, columnWidths, styleId: payload.styleId == null ? null : String(payload.styleId) }
    }
    case 'PROXY_ENTITY': return { ...base(payload), originalType: normalizeName(payload.originalType ?? 'UNKNOWN'), proxyClass: payload.proxyClass == null ? null : String(payload.proxyClass), rawTags: clone(payload.rawTags ?? []), rawData: clone(payload.rawData ?? null), importError: payload.importError == null ? null : String(payload.importError) }
    default: return base(payload)
  }
}

export function normalizeLegacyEntityPayload(type, payload = {}) {
  type = normalizeName(type)
  if (type === 'LINE' && payload.start == null && payload.x1 != null) return normalizeStandardEntityPayload(type, { ...payload, start: [payload.x1, payload.y1, payload.z1 ?? 0], end: [payload.x2, payload.y2, payload.z2 ?? 0] })
  if (['CIRCLE', 'ARC'].includes(type) && payload.center == null && payload.x != null) return normalizeStandardEntityPayload(type, { ...payload, center: [payload.x, payload.y, payload.z ?? 0], startAngle: payload.startAngle ?? 0, endAngle: payload.endAngle ?? Math.PI * 2 })
  if (['LWPOLYLINE', 'POLYLINE'].includes(type) && payload.vertices == null && payload.points) return normalizeStandardEntityPayload(type, { ...payload, vertices: payload.points })
  if (['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].includes(type) && payload.position == null && payload.x != null) return normalizeStandardEntityPayload(type, { ...payload, position: [payload.x, payload.y, payload.z ?? 0] })
  return normalizeStandardEntityPayload(type, payload)
}
