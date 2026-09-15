import { KJValidationError } from './errors.js'
import {
  validateKnowledgePack,
  validateSemanticDrawingIntent,
  type KJKnowledgePack,
  type KJSemanticDrawingIntent,
} from './knowledge-pack.js'
import { deepFreeze, stableHash, type ReadonlyDeep } from './utils.js'

export type KJKnowledgeExpression =
  | string | number | boolean
  | { get: string }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide' | 'negate'; args: KJKnowledgeExpression[] }
  | { concat: KJKnowledgeExpression[] }
  | { lookup: { value: KJKnowledgeExpression; cases: Record<string, KJKnowledgeExpression>; fallback?: KJKnowledgeExpression } }

export type KJKnowledgePointExpression = [KJKnowledgeExpression, KJKnowledgeExpression]
export type KJKnowledgeEmitOperation =
  | { primitive: 'line'; layer: string; start: KJKnowledgePointExpression; end: KJKnowledgePointExpression }
  | { primitive: 'polyline'; layer: string; points: KJKnowledgePointExpression[]; closed: boolean }
  | { primitive: 'rectangle'; layer: string; origin: KJKnowledgePointExpression; size: KJKnowledgePointExpression }
  | { primitive: 'hatch-rectangle'; layer: string; origin: KJKnowledgePointExpression; size: KJKnowledgePointExpression; patternName: KJKnowledgeExpression; patternScale: KJKnowledgeExpression; patternAngleDegrees: KJKnowledgeExpression }
  | { primitive: 'text'; layer: string; position: KJKnowledgePointExpression; value: KJKnowledgeExpression; height: KJKnowledgeExpression; rotationDegrees?: KJKnowledgeExpression }

export interface KJKnowledgeProgramStep {
  select?: { relationKind: string; direction?: 'outgoing' | 'incoming'; objectKind?: string; sortBy?: string }
  continuity?: { startPath: string; endPath: string; first: KJKnowledgeExpression; final: KJKnowledgeExpression; tolerance?: number }
  emit: KJKnowledgeEmitOperation[]
}

export interface KJKnowledgeDrawingProgram {
  version: '1.0.0'
  rootKind: string
  layers: { name: string; color: number; lineweight: number }[]
  steps: KJKnowledgeProgramStep[]
}

export interface KJKnowledgeCompileInput {
  pack: unknown
  intent: unknown
  templateId: string
  rootObjectId: string
  expectedRevision: number
}

export interface KJKnowledgeCompileResult {
  commandArgs: {
    entities: { type: string; payload: Record<string, unknown>; options: { id: string } }[]
    resources: {
      linetypes: { id: string; name: string; pattern: number[] }[]
      layers: { id: string; name: string; color: number; linetypeId: string; lineweight: number }[]
    }
  }
  evidence: {
    packId: string
    packVersion: string
    packHash: string
    intentHash: string
    templateId: string
    rootObjectId: string
    expectedRevision: number
    entityCount: number
    /** Deterministic compiler decisions derived from explicit facts and versioned rules. */
    parameters?: Record<string, string | number | boolean>
  }
}

type FrozenIntent = ReadonlyDeep<KJSemanticDrawingIntent>
type SemanticObject = FrozenIntent['objects'][number]
type EvaluationContext = { root: SemanticObject; item: SemanticObject; drawing: FrozenIntent['drawing'] }

const lineweights = new Set([-3, -2, -1, 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211])
const safeKey = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const fail = (message: string): never => { throw new KJValidationError(`Knowledge compiler: ${message}`) }

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, maximum = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must be bounded printable text`)
  return (value as string).trim()
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) fail(`${label} must be a bounded finite number`)
  return value as number
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = Object.keys(value)
  if (keys.some(key => !allowed.includes(key))) fail(`${label} contains an unsupported field`)
}

function getPath(context: EvaluationContext, source: unknown): unknown {
  const path = text(source, 'expression.get', 192)
  const parts = path.split('.')
  if (parts.length < 2 || parts.length > 10 || parts.some(part => !safeKey.test(part) || ['__proto__', 'prototype', 'constructor'].includes(part))) fail(`expression.get path is not allowed: ${path}`)
  let current: unknown = context[parts[0] as keyof EvaluationContext]
  if (current === undefined) fail(`expression.get root is not allowed: ${parts[0]}`)
  for (const part of parts.slice(1)) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, part)) fail(`expression.get path is missing: ${path}`)
    current = (current as Record<string, unknown>)[part]
  }
  if (current != null && typeof current === 'object') fail(`expression.get must resolve to a scalar: ${path}`)
  return current
}

function evaluate(source: unknown, context: EvaluationContext, depth = 0, budget = { count: 0 }): string | number | boolean {
  if (++budget.count > 4096 || depth > 12) fail('expression exceeds the evaluation budget')
  if (typeof source === 'string' || typeof source === 'boolean') return source
  if (typeof source === 'number') return finite(source, 'expression')
  const expression = record(source, 'expression')
  if (Object.hasOwn(expression, 'get')) {
    exact(expression, ['get'], 'get expression')
    const result = getPath(context, expression.get)
    if (!['string', 'number', 'boolean'].includes(typeof result)) fail('expression.get must resolve to a string, number or boolean')
    return typeof result === 'number' ? finite(result, 'expression.get result') : result as string | boolean
  }
  if (Object.hasOwn(expression, 'op')) {
    exact(expression, ['op', 'args'], 'numeric expression')
    const op = expression.op
    if (!['add', 'subtract', 'multiply', 'divide', 'negate'].includes(String(op))) fail(`numeric operation is not supported: ${String(op)}`)
    if (!Array.isArray(expression.args) || expression.args.length < 1 || expression.args.length > 16) fail('numeric expression args must contain 1-16 values')
    const values = (expression.args as unknown[]).map((value: unknown) => finite(evaluate(value, context, depth + 1, budget), 'numeric expression argument'))
    if (op === 'negate') {
      if (values.length !== 1) fail('negate requires exactly one argument')
      return finite(-values[0]!, 'numeric expression result')
    }
    if (values.length !== 2) fail(`${String(op)} requires exactly two arguments`)
    if (op === 'divide' && values[1] === 0) fail('division by zero is not allowed')
    const result = op === 'add' ? values[0]! + values[1]! : op === 'subtract' ? values[0]! - values[1]! : op === 'multiply' ? values[0]! * values[1]! : values[0]! / values[1]!
    return finite(result, 'numeric expression result')
  }
  if (Object.hasOwn(expression, 'concat')) {
    exact(expression, ['concat'], 'concat expression')
    if (!Array.isArray(expression.concat) || expression.concat.length < 1 || expression.concat.length > 32) fail('concat requires 1-32 values')
    const result = (expression.concat as unknown[]).map((value: unknown) => String(evaluate(value, context, depth + 1, budget))).join('')
    return text(result, 'concat result', 512)
  }
  if (Object.hasOwn(expression, 'lookup')) {
    exact(expression, ['lookup'], 'lookup expression')
    const lookup = record(expression.lookup, 'lookup')
    exact(lookup, ['value', 'cases', 'fallback'], 'lookup')
    if (!Object.hasOwn(lookup, 'value') || !Object.hasOwn(lookup, 'cases')) fail('lookup requires value and cases')
    const cases = record(lookup.cases, 'lookup.cases')
    if (Object.keys(cases).length > 128 || Object.keys(cases).some(key => !safeKey.test(key))) fail('lookup.cases contains invalid keys')
    const key = String(evaluate(lookup.value, context, depth + 1, budget))
    if (!Object.hasOwn(cases, key) && !Object.hasOwn(lookup, 'fallback')) fail(`lookup has no case for: ${key}`)
    return evaluate(Object.hasOwn(cases, key) ? cases[key] : lookup.fallback, context, depth + 1, budget)
  }
  return fail('expression must use get, op, concat or lookup')
}

function numberExpression(value: unknown, context: EvaluationContext, label: string): number {
  return finite(evaluate(value, context), label)
}

function point(value: unknown, context: EvaluationContext, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} must contain two expressions`)
  const values = value as unknown[]
  return [numberExpression(values[0], context, `${label}.x`), numberExpression(values[1], context, `${label}.y`), 0]
}

function selectItems(step: Record<string, unknown>, intent: FrozenIntent, context: EvaluationContext): SemanticObject[] {
  if (step.select == null) return [context.root]
  const select = record(step.select, 'step.select')
  exact(select, ['relationKind', 'direction', 'objectKind', 'sortBy'], 'step.select')
  const relationKind = text(select.relationKind, 'step.select.relationKind', 96)
  const direction = select.direction == null ? 'outgoing' : select.direction
  if (direction !== 'outgoing' && direction !== 'incoming') fail('step.select.direction must be outgoing or incoming')
  const objectKind = select.objectKind == null ? undefined : text(select.objectKind, 'step.select.objectKind', 96)
  const byId = new Map(intent.objects.map(item => [item.id, item] as const))
  const selected: SemanticObject[] = []
  const selectedIds = new Set<string>()
  for (const relation of intent.relations) {
    if (relation.kind !== relationKind || (direction === 'outgoing' ? relation.from : relation.to) !== context.root.id) continue
    const item = byId.get(direction === 'outgoing' ? relation.to : relation.from)
    if (item && (!objectKind || item.kind === objectKind)) {
      if (selectedIds.has(item.id)) fail(`step.select contains a duplicate relation to ${item.id}`)
      selectedIds.add(item.id)
      selected.push(item)
    }
  }
  if (select.sortBy != null) {
    const sortBy = text(select.sortBy, 'step.select.sortBy', 160)
    selected.sort((left, right) => {
      const a = getPath({ ...context, item: left }, `item.${sortBy}`), b = getPath({ ...context, item: right }, `item.${sortBy}`)
      if (typeof a !== 'number' || typeof b !== 'number') fail('step.select.sortBy must resolve to numbers')
      return (a as number) - (b as number) || left.id.localeCompare(right.id)
    })
  }
  return selected
}

function validateContinuity(source: unknown, items: readonly SemanticObject[], context: EvaluationContext): void {
  const continuity = record(source, 'step.continuity')
  exact(continuity, ['startPath', 'endPath', 'first', 'final', 'tolerance'], 'step.continuity')
  if (!items.length) fail('step.continuity requires at least one selected object')
  const startPath = text(continuity.startPath, 'step.continuity.startPath', 160)
  const endPath = text(continuity.endPath, 'step.continuity.endPath', 160)
  const first = numberExpression(continuity.first, context, 'step.continuity.first')
  const final = numberExpression(continuity.final, context, 'step.continuity.final')
  const tolerance = continuity.tolerance == null ? 1e-9 : finite(continuity.tolerance, 'step.continuity.tolerance')
  if (tolerance < 0 || tolerance > 1) fail('step.continuity.tolerance must be between 0 and 1')
  let expected = first
  for (const item of items) {
    const itemContext = { ...context, item }
    const start = finite(getPath(itemContext, `item.${startPath}`), 'step.continuity start')
    const end = finite(getPath(itemContext, `item.${endPath}`), 'step.continuity end')
    if (Math.abs(start - expected) > tolerance) fail(`step.continuity has a gap or overlap before ${item.id}`)
    if (end - start <= tolerance) fail(`step.continuity interval is not positive for ${item.id}`)
    expected = end
  }
  if (Math.abs(expected - final) > tolerance) fail('step.continuity final value does not match')
}

export function compileKnowledgeDrawing(source: KJKnowledgeCompileInput): ReadonlyDeep<KJKnowledgeCompileResult> {
  const pack = validateKnowledgePack(source.pack)
  const intent = validateSemanticDrawingIntent(source.intent, pack)
  const templateId = text(source.templateId, 'input.templateId', 96)
  const rootObjectId = text(source.rootObjectId, 'input.rootObjectId', 128)
  if (!Number.isSafeInteger(source.expectedRevision) || source.expectedRevision < 0) fail('input.expectedRevision must be a nonnegative safe integer')
  const root = intent.objects.find(item => item.id === rootObjectId)
  if (!root) throw new KJValidationError(`Knowledge compiler: root object does not exist: ${rootObjectId}`)
  const template = record(pack.templates?.[templateId], `pack.templates.${templateId}`)
  const program = record(template.program, `pack.templates.${templateId}.program`)
  exact(program, ['version', 'rootKind', 'layers', 'steps'], 'program')
  if (program.version !== '1.0.0') fail('program.version must be 1.0.0')
  if (root.kind !== text(program.rootKind, 'program.rootKind', 96)) fail('root object kind does not match the program')
  if (!Array.isArray(program.layers) || program.layers.length < 1 || program.layers.length > 16) fail('program.layers must contain 1-16 layers')
  if (!Array.isArray(program.steps) || program.steps.length < 1 || program.steps.length > 128) fail('program.steps must contain 1-128 steps')

  const prefix = `kp-${stableHash({ pack: `${pack.id}@${pack.version}`, templateId, rootObjectId, intent })}`
  const linetypeId = `${prefix}-continuous`
  const programLayers = program.layers as unknown[]
  const programSteps = program.steps as unknown[]
  const layers = programLayers.map((raw: unknown, index: number) => {
    const layer = record(raw, `program.layers[${index}]`)
    exact(layer, ['name', 'color', 'lineweight'], `program.layers[${index}]`)
    const name = text(layer.name, `program.layers[${index}].name`, 128)
    if (!Number.isInteger(layer.color) || Number(layer.color) < 1 || Number(layer.color) > 255) fail(`program.layers[${index}].color must be an ACI value`)
    if (!lineweights.has(Number(layer.lineweight))) fail(`program.layers[${index}].lineweight is not supported`)
    return { id: `${prefix}-layer-${index + 1}`, name, color: Number(layer.color), linetypeId, lineweight: Number(layer.lineweight) }
  })
  if (new Set(layers.map(layer => layer.name.toUpperCase())).size !== layers.length) fail('program layer names must be unique')
  const layerIds = new Map(layers.map(layer => [layer.name, layer.id] as const))
  const entities: KJKnowledgeCompileResult['commandArgs']['entities'] = []
  const baseContext: EvaluationContext = { root, item: root, drawing: intent.drawing }
  const add = (type: string, layerName: unknown, payload: Record<string, unknown>) => {
    const layerId = layerIds.get(text(layerName, 'emit.layer', 128))
    if (!layerId) fail(`emit.layer is not declared: ${String(layerName)}`)
    if (entities.length >= 8192) fail('program expands beyond the 8192 entity budget')
    entities.push({ type, payload: { ...payload, layerId }, options: { id: `${prefix}-entity-${String(entities.length + 1).padStart(5, '0')}` } })
  }

  for (const [stepIndex, rawStep] of programSteps.entries()) {
    const step = record(rawStep, `program.steps[${stepIndex}]`)
    exact(step, ['select', 'continuity', 'emit'], `program.steps[${stepIndex}]`)
    if (!Array.isArray(step.emit) || step.emit.length < 1 || step.emit.length > 64) fail(`program.steps[${stepIndex}].emit must contain 1-64 operations`)
    const emissions = step.emit as unknown[]
    const items = selectItems(step, intent, baseContext)
    if (step.continuity != null) validateContinuity(step.continuity, items, baseContext)
    for (const item of items) for (const [emitIndex, rawEmit] of emissions.entries()) {
      const emit = record(rawEmit, `program.steps[${stepIndex}].emit[${emitIndex}]`)
      const primitive = text(emit.primitive, 'emit.primitive', 32), context = { ...baseContext, item }
      if (primitive === 'line') {
        exact(emit, ['primitive', 'layer', 'start', 'end'], 'line emit')
        const start = point(emit.start, context, 'line.start'), end = point(emit.end, context, 'line.end')
        if (start[0] === end[0] && start[1] === end[1]) fail('line endpoints must be distinct')
        add('LINE', emit.layer, { start, end })
      } else if (primitive === 'polyline') {
        exact(emit, ['primitive', 'layer', 'points', 'closed'], 'polyline emit')
        if (!Array.isArray(emit.points) || emit.points.length < 2 || emit.points.length > 512 || typeof emit.closed !== 'boolean') fail('polyline requires 2-512 points and a closed flag')
        const vertices = (emit.points as unknown[]).map((value: unknown, index: number) => point(value, context, `polyline.points[${index}]`))
        if (emit.closed && vertices.length < 3) fail('closed polyline requires at least three points')
        add('LWPOLYLINE', emit.layer, { vertices, closed: emit.closed })
      } else if (primitive === 'rectangle' || primitive === 'hatch-rectangle') {
        exact(emit, primitive === 'rectangle' ? ['primitive', 'layer', 'origin', 'size'] : ['primitive', 'layer', 'origin', 'size', 'patternName', 'patternScale', 'patternAngleDegrees'], `${primitive} emit`)
        const origin = point(emit.origin, context, `${primitive}.origin`), size = point(emit.size, context, `${primitive}.size`)
        if (size[0] <= 0 || size[1] <= 0) fail(`${primitive}.size must be positive`)
        const vertices = [[origin[0], origin[1], 0], [origin[0] + size[0], origin[1], 0], [origin[0] + size[0], origin[1] + size[1], 0], [origin[0], origin[1] + size[1], 0]]
        if (primitive === 'rectangle') add('LWPOLYLINE', emit.layer, { vertices, closed: true })
        else {
          const patternName = String(evaluate(emit.patternName, context)).toUpperCase()
          if (!['SOLID', 'ANSI31', 'ANSI37', 'CROSS'].includes(patternName)) fail(`hatch pattern is not supported: ${patternName}`)
          const patternScale = numberExpression(emit.patternScale, context, 'hatch.patternScale'), patternAngle = numberExpression(emit.patternAngleDegrees, context, 'hatch.patternAngleDegrees')
          if (patternScale <= 0) fail('hatch.patternScale must be positive')
          add('HATCH', emit.layer, { boundaryLoops: [{ external: true, closed: true, vertices }], patternName, solid: patternName === 'SOLID', patternScale, patternAngle: patternAngle * Math.PI / 180 })
        }
      } else if (primitive === 'text') {
        exact(emit, ['primitive', 'layer', 'position', 'value', 'height', 'rotationDegrees'], 'text emit')
        const position = point(emit.position, context, 'text.position'), value = evaluate(emit.value, context), height = numberExpression(emit.height, context, 'text.height')
        if (typeof value !== 'string' || height <= 0) fail('text requires a string value and positive height')
        const rotation = emit.rotationDegrees == null ? 0 : numberExpression(emit.rotationDegrees, context, 'text.rotationDegrees') * Math.PI / 180
        add('TEXT', emit.layer, { position, text: text(value, 'text.value', 512), height, rotation })
      } else fail(`emit primitive is not supported: ${primitive}`)
    }
  }
  if (!entities.length) fail('program emitted no entities')
  return deepFreeze({
    commandArgs: { entities, resources: { linetypes: [{ id: linetypeId, name: `KP_${stableHash(prefix).toUpperCase()}_CONT`, pattern: [] }], layers } },
    evidence: { packId: pack.id, packVersion: pack.version, packHash: stableHash(pack), intentHash: stableHash(intent), templateId, rootObjectId, expectedRevision: source.expectedRevision, entityCount: entities.length },
  })
}
