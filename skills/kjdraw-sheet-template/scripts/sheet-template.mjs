import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

// Original template resources; no CAD engine, approval authority or file writer.
export async function loadSheetResources() {
  const [template, rules] = await Promise.all([
    readFile(new URL('../assets/a4-landscape.json', import.meta.url), 'utf8'),
    readFile(new URL('../references/layer-rules.json', import.meta.url), 'utf8'),
  ])
  return { template: JSON.parse(template), rules: JSON.parse(rules) }
}

function fail(message) { throw new TypeError(message) }
function plain(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be plain data`)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') ||
      keys && !keys.includes(key)) fail(`${label} contains an unsupported field`)
  }
  return value
}
function number(value, label, minimum = -1e9, maximum = 1e9) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} is outside the finite supported range`)
  return value
}
function point(value, label) {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} requires two coordinates`)
  return value.map((item, axis) => number(item, `${label}[${axis}]`))
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > 128 || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} requires bounded single-line text`)
  return value
}
function inside(p, box) { return p[0] >= box[0] && p[1] >= box[1] && p[0] <= box[2] && p[1] <= box[3] }
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Compile resource-defined model-space drafting geometry, without changing a document. */
export function planSheetTemplate(document, input, resources) {
  plain(input, 'input', ['version', 'templateId', 'sheetId', 'expectedRevision', 'units', 'origin', 'size', 'fields', 'symbols'])
  plain(resources, 'resources', ['template', 'rules'])
  const { template, rules } = resources
  plain(template, 'template'); plain(rules, 'rules')
  if (input.version !== '1.0.0' || template.version !== '1.0.0' || rules.version !== '1.0.0' || input.templateId !== template.id) fail('Explicit supported template/version required')
  if (input.units !== 'millimeter' || template.units !== input.units || document.snapshot().header.units !== input.units) fail('Template and drawing units must be explicit millimeter; no rescaling')
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== document.revision) fail('Current expectedRevision required')
  if (document.listEntities().length) fail('This template requires a blank drawing; existing geometry is not replaced')
  if (typeof input.sheetId !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(input.sheetId)) fail('sheetId requires 1-48 letters, digits, underscores or hyphens')
  const origin = point(input.origin, 'origin'), size = point(input.size ?? template.nominalSize, 'size')
  const minimum = point(template.minimumSize, 'minimumSize'), maximum = point(template.maximumSize, 'maximumSize')
  size.forEach((value, axis) => number(value, 'size', minimum[axis], maximum[axis]))
  const margin = number(template.frameMargin, 'frameMargin', 0.1, 100)
  const frame = [origin[0] + margin, origin[1] + margin, origin[0] + size[0] - margin, origin[1] + size[1] - margin]
  if (frame[0] >= frame[2] || frame[1] >= frame[3]) fail('Frame has no positive interior')
  frame.forEach(value => number(value, 'frame coordinate'))
  const title = plain(template.titleBlock, 'titleBlock'), titleSize = point(title.size, 'titleBlock.size')
  titleSize.forEach(value => number(value, 'titleBlock.size', 1, 1000))
  const titleOrigin = [frame[2] - titleSize[0], frame[1]], titleBox = [...titleOrigin, frame[2], frame[1] + titleSize[1]]
  if (!inside(titleOrigin, frame) || !inside(titleBox.slice(2), frame)) fail('Title block does not fit the frame')
  if (!Array.isArray(rules.layers) || rules.layers.length !== 4) fail('Four template layer roles required')
  const roles = new Map(), layerNames = new Set()
  const styles = rules.layers.map(rule => {
    plain(rule, 'layer', ['role', 'name', 'color', 'lineweight'])
    if (!['frame', 'title', 'text', 'symbol'].includes(rule.role) || roles.has(rule.role)) fail('Unique supported layer role required')
    const name = text(rule.name, 'layer name')
    if (name !== name.trim() || /[<>/\\":;?*|=]/.test(name) || layerNames.has(name.toUpperCase()) ||
      document.getTable('layers').records.some(layer => layer.name?.toUpperCase() === name.toUpperCase())) fail('Template layer names must be new and unique')
    layerNames.add(name.toUpperCase())
    const sources = []
    roles.set(rule.role, sources)
    return { name, sources, color: rule.color, lineweight: rule.lineweight, pattern: [] }
  })
  const entities = []
  function add(type, payload, role) {
    entities.push({ type, payload, role })
  }
  add('LWPOLYLINE', { vertices: [[frame[0], frame[1]], [frame[2], frame[1]], [frame[2], frame[3]], [frame[0], frame[3]]], closed: true }, 'frame')
  const localTitleBox = [0, 0, ...titleSize], atTitle = p => [titleOrigin[0] + p[0], titleOrigin[1] + p[1], 0]
  if (!Array.isArray(title.lines) || title.lines.length > 32) fail('Bounded title grid required')
  for (const line of title.lines) {
    if (!Array.isArray(line) || line.length !== 4) fail('Title grid requires four coordinates per line')
    const start = point(line.slice(0, 2), 'grid start'), end = point(line.slice(2), 'grid end')
    if (!inside(start, localTitleBox) || !inside(end, localTitleBox) || start.every((value, axis) => value === end[axis])) fail('Title grid line is outside its block or empty')
    add('LINE', { start: atTitle(start), end: atTitle(end) }, 'title')
  }
  if (!Array.isArray(title.fields) || title.fields.length < 1 || title.fields.length > 8) fail('Bounded title fields required')
  const keys = title.fields.map(field => field.key)
  if (new Set(keys).size !== keys.length) fail('Unique title field keys required')
  plain(input.fields, 'fields', keys)
  function addFieldText(value, position, height, cell, label) {
    value = text(value, label); position = point(position, label); height = number(height, 'text height', 0.5, 20)
    // Conservative character-width fit only; the native preview still requires review.
    if (!inside(position, cell) || position[0] + [...value].length * height > cell[2] - 1 || position[1] + height > cell[3] - 1) fail(`${label} does not fit its declared cell`)
    add('TEXT', { text: value, position: atTitle(position), height, rotation: 0 }, 'text')
  }
  for (const field of title.fields) {
    plain(field, 'field', ['key', 'label', 'cell', 'labelAt', 'valueAt'])
    if (!Array.isArray(field.cell) || field.cell.length !== 4 || !field.cell.every(Number.isFinite) ||
      field.cell[0] >= field.cell[2] || field.cell[1] >= field.cell[3] || !inside(field.cell.slice(0, 2), localTitleBox) || !inside(field.cell.slice(2), localTitleBox)) fail('Field cell must fit its title block')
    addFieldText(field.label, field.labelAt, title.labelHeight, field.cell, 'field label')
    addFieldText(input.fields[field.key], field.valueAt, title.valueHeight, field.cell, `fields.${field.key}`)
  }
  const symbols = input.symbols ?? []
  if (!Array.isArray(symbols) || symbols.length > 16 || !Array.isArray(rules.allowedSymbols)) fail('Bounded declared symbols required')
  for (const request of symbols) {
    plain(request, 'symbol', ['name', 'position'])
    if (!rules.allowedSymbols.includes(request.name) || !Object.hasOwn(template.symbols, request.name)) fail('Unsupported symbol')
    const symbol = template.symbols[request.name], position = point(request.position, 'symbol position')
    if (symbol.closed !== true || !Array.isArray(symbol.vertices) || symbol.vertices.length < 3 || symbol.vertices.length > 16) fail('Supported closed symbol vertices required')
    const vertices = symbol.vertices.map(vertex => point(vertex, 'symbol vertex').map((coordinate, axis) => coordinate + position[axis]))
    const symbolBox = [Math.min(...vertices.map(p => p[0])), Math.min(...vertices.map(p => p[1])), Math.max(...vertices.map(p => p[0])), Math.max(...vertices.map(p => p[1]))]
    if (vertices.some(vertex => !inside(vertex, frame)) || !(symbolBox[2] < titleBox[0] || symbolBox[0] > titleBox[2] || symbolBox[3] < titleBox[1] || symbolBox[1] > titleBox[3])) fail('Symbol is outside the frame or overlaps the title block')
    add('LWPOLYLINE', { vertices, closed: true }, 'symbol')
  }
  const args = { expectedRevision: input.expectedRevision, units: input.units,
    lines: [], circles: [], arcs: [], polylines: [], arrays: [], styles, texts: [],
    alignedDimensions: [], rotatedDimensions: [], radiusDimensions: [], diameterDimensions: [] }
  for (const entity of entities) {
    const { type, payload, role } = entity
    const group = type === 'LINE' ? 'lines' : type === 'TEXT' ? 'texts' : 'polylines'
    roles.get(role).push(`${group}:${args[group].length}`)
    if (type === 'LINE') args.lines.push([...payload.start.slice(0, 2), ...payload.end.slice(0, 2)])
    else if (type === 'TEXT') args.texts.push({ text: payload.text, position: { x: payload.position[0], y: payload.position[1] }, height: payload.height, rotationDegrees: 0 })
    else args.polylines.push({ points: payload.vertices, closed: payload.closed })
  }
  return {
    toolName: 'cad_propose_drawing_annotated', arguments: args,
    evidence: { sheetId: input.sheetId, templateId: template.id, rulesId: rules.id, units: input.units, origin, size, frame, titleBox,
      entityCount: entities.length, symbolCount: symbols.length, resourceDigests: { template: digest(template), rules: digest(rules) },
      digestScope: 'JSON.stringify of parsed resource data', certification: 'original-example-conventions-not-a-certified-standard' },
  }
}

/** Uses an existing public SDK tool session; returns a proposal, never approval or files. */
export async function proposeSheetTemplate(session, document, input, resources) {
  if (!session || typeof session.call !== 'function' || typeof session.isBoundTo !== 'function' || !session.isBoundTo(document)) fail('A native KJAgentToolSession bound to the selected document is required')
  const plan = planSheetTemplate(document, input, resources ?? await loadSheetResources())
  const result = await session.call(plan.toolName, plan.arguments)
  if (!result.ok) {
    const error = new Error(result.error.message)
    error.code = result.error.code
    throw error
  }
  return { status: result.value.status, proposal: result.value, evidence: plan.evidence }
}
