#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// This adapter prepares existing affine relations. It neither executes CAD nor
// authenticates a supplied JSON file or infers the original designer's intent.
const LIMIT = 1e12
const EPSILON = 1e-8 // The native DESIGNCREATE initial-value comparison.
const SIMPLE_TYPES = new Set(['CIRCLE', 'LINE', 'ARC', 'POINT', 'LWPOLYLINE', 'POLYLINE', 'TEXT', 'MTEXT'])
const fail = message => { throw new Error(`Hole revision: ${message}`) }
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LIMIT

function fields(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) {
    fail(`${label} must contain exactly ${expected.join(', ')}`)
  }
  return value
}
function identity(value, label, maxLength = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) fail(`invalid ${label}`)
  return value
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`invalid ${label}`)
}
function parameter(value, name) {
  fields(value, ['value', 'min', 'max'], `${name} parameter`)
  if (![value.value, value.min, value.max].every(finite) || value.min <= (name === 'diameter' ? 2e-12 : 1e-12) ||
      value.min > value.max || value.value < value.min || value.value > value.max) fail(`invalid ${name} value/range`)
  return { name, value: value.value, min: value.min, max: value.max }
}
function circle(row, context, layers) {
  if (row.type !== 'CIRCLE' || row.ownerId !== context.spaceId || row.visible !== true || row.editable !== true) {
    fail(`target ${row.id} must be a visible editable native model-space CIRCLE`)
  }
  if (row.layerId !== null) {
    const layer = layers.get(row.layerId)
    if (!layer || layer.visible !== true || layer.editable !== true || layer.frozen !== false || layer.locked !== false) {
      fail(`target ${row.id} has a missing or protected layer`)
    }
  }
  const geometry = row.geometry
  if (!geometry || row.geometryOmittedReason !== null || !Array.isArray(geometry.center) ||
      geometry.center.length !== 3 || !geometry.center.every(finite) || !finite(geometry.radius) || geometry.radius <= 1e-12) {
    fail(`target ${row.id} requires complete finite circle geometry`)
  }
  for (const key of ['normal', 'extrusionDirection', 'extrusion']) {
    const direction = geometry[key]
    if (direction != null && (!Array.isArray(direction) || direction.length !== 3 ||
        direction[0] !== 0 || direction[1] !== 0 || direction[2] !== 1)) fail(`target ${row.id} requires default +Z orientation`)
  }
  if (geometry.thickness != null && geometry.thickness !== 0) fail(`target ${row.id} must have no thickness`)
  if (![geometry.center[0] - geometry.radius, geometry.center[0] + geometry.radius,
    geometry.center[1] - geometry.radius, geometry.center[1] + geometry.radius].every(finite)) fail('circle exceeds the native coordinate budget')
  return geometry
}
const expression = (constant, parameter, coefficient) => ({
  constant, terms: parameter === undefined ? [] : [{ parameter, coefficient }],
})

/** Prepare cad_propose_design_bind arguments from a complete native read and
 * separately confirmed intent. The caller must verify query provenance and
 * no thickness/dependent annotations; the bounded drawing projection alone
 * does not expose all references or thickness. The native proposal rechecks
 * current source geometry, protected objects, orientation and thickness. */
export function prepareBind(input) {
  fields(input, ['queryArguments', 'queryResult', 'name', 'confirmed', 'parameters'], 'input')
  const query = fields(input.queryArguments,
    ['expectedRevision', 'filters', 'offset', 'layerOffset', 'limit', 'maxLayers', 'maxBytes'], 'queryArguments')
  fields(query.filters, ['includeHidden'], 'query filters')
  if (query.filters.includeHidden !== true || query.offset !== 0 || query.layerOffset !== 0) {
    fail('requires an unfiltered first model-space page including hidden entities')
  }
  integer(query.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'query revision')
  integer(query.limit, 1, 200, 'query entity limit')
  integer(query.maxLayers, 1, 100, 'query layer limit')
  integer(query.maxBytes, 1024, 262144, 'query byte budget')
  if (input.queryResult?.ok !== true || input.queryResult.tool !== 'cad_query_drawing' || !input.queryResult.value) {
    fail('requires the successful cad_query_drawing CLI JSON result')
  }
  const context = input.queryResult.value
  const confirmed = fields(input.confirmed, ['documentId', 'revision', 'units', 'modelSpaceId',
    'fixedHoleId', 'movingHoleId', 'relation', 'circlesHaveNoThickness', 'noDependentAnnotations'], 'confirmed')
  for (const key of ['documentId', 'units', 'modelSpaceId', 'fixedHoleId', 'movingHoleId']) identity(confirmed[key], key)
  integer(confirmed.revision, 0, Number.MAX_SAFE_INTEGER, 'confirmed revision')
  if (confirmed.documentId !== context.documentId || confirmed.revision !== context.revision ||
      confirmed.revision !== query.expectedRevision || confirmed.units !== context.units || confirmed.modelSpaceId !== context.spaceId) {
    fail('confirmed document, revision, units or model space disagrees with the native query')
  }
  if (!['millimeter', 'meter'].includes(confirmed.units)) fail('only explicit millimeter or meter drawing units are supported')
  if (confirmed.fixedHoleId === confirmed.movingHoleId) fail('two distinct explicitly selected hole IDs are required')
  if (confirmed.relation !== 'fixed-first-existing-xy-direction' || confirmed.circlesHaveNoThickness !== true ||
      confirmed.noDependentAnnotations !== true) fail('caller must confirm the exact relation, no thickness and no dependent annotations')
  if (context.truncated !== false || context.nextOffset !== null || context.nextLayerOffset !== null ||
      !Array.isArray(context.truncationReasons) || context.truncationReasons.length || context.spatialQuery !== undefined ||
      !Array.isArray(context.entities) || !context.entities.length || context.entities.length > query.limit || !Array.isArray(context.layers) ||
      context.layers.length > query.maxLayers || ['limit', 'maxLayers', 'maxBytes'].some(key => context.limits?.[key] !== query[key])) {
    fail('requires one complete untruncated native model-space query; narrow the supported input instead of using a partial page')
  }
  const entities = new Map(), counts = new Map(), layers = new Map()
  for (const row of context.layers) {
    identity(row.id, 'layer ID')
    if (layers.has(row.id)) fail('duplicate native layer ID')
    layers.set(row.id, row)
  }
  for (const row of context.entities) {
    identity(row.id, 'entity ID')
    if (entities.has(row.id)) fail('duplicate native entity ID')
    if (row.ownerId !== context.spaceId || row.geometry === null || row.geometryOmittedReason !== null || !row.geometry) {
      fail('native entity ownership or geometry is incomplete')
    }
    // The first release deliberately excludes annotation and structural entities
    // altogether. Their absence in this projection is not a universal proof of
    // absence of references elsewhere in an arbitrary imported DXF.
    if (!SIMPLE_TYPES.has(row.type)) fail(`unsupported model-space content ${row.type}; annotations, INSERTs and HATCHes require a separate workflow`)
    entities.set(row.id, row)
    counts.set(row.type, (counts.get(row.type) ?? 0) + 1)
  }
  const reported = context.pageEntityCounts
  if (!reported || typeof reported !== 'object' || Array.isArray(reported) || Object.keys(reported).length !== counts.size ||
      [...counts].some(([type, count]) => reported[type] !== count)) fail('native page entity counts disagree')
  const fixed = entities.get(confirmed.fixedHoleId), moving = entities.get(confirmed.movingHoleId)
  if (!fixed || !moving) fail('both explicitly selected IDs must exist in the native query')
  const a = circle(fixed, context, layers), b = circle(moving, context, layers)
  if (a.center[2] !== b.center[2] || Math.abs(a.radius - b.radius) > EPSILON) fail('two holes require the same Z and initial radius')
  const dx = b.center[0] - a.center[0], dy = b.center[1] - a.center[1], spacing = Math.hypot(dx, dy)
  if (!finite(spacing) || spacing <= 1e-12) fail('initial XY spacing must be finite and nonzero')
  fields(input.parameters, ['diameter', 'spacing'], 'parameters')
  const parameters = ['diameter', 'spacing'].map(name => parameter(input.parameters[name], name))
  if (Math.abs(input.parameters.diameter.value / 2 - a.radius) > EPSILON ||
      Math.abs(input.parameters.diameter.value / 2 - b.radius) > EPSILON ||
      Math.abs(input.parameters.spacing.value - spacing) > EPSILON) fail('confirmed initial diameter or spacing does not match native geometry')
  const name = identity(input.name, 'design name', 128).trim()
  return {
    expectedRevision: context.revision, units: context.units, name,
    definition: {
      parameters,
      derived: [{ name: 'radius', expression: expression(0, 'diameter', .5) }],
      bindings: [
        ...[fixed.id, moving.id].map(entityId => ({ entityId, path: 'radius', expression: expression(0, 'radius', 1) })),
        ...[0, 1].map(axis => ({ entityId: fixed.id, path: `center.${axis}`, expression: expression(a.center[axis]) })),
        ...[dx / spacing, dy / spacing].map((coefficient, axis) => ({ entityId: moving.id,
          path: `center.${axis}`, expression: expression(a.center[axis], 'spacing', coefficient) })),
      ],
      // No guessed clearance, manufacturing tolerance, material or design rule.
      requirements: [],
    },
  }
}

async function main(argv) {
  if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--output' || !argv[1] || !argv[3]) {
    fail('usage: node prepare-bind.mjs --input request.json --output bind-args.json')
  }
  const inputPath = resolve(argv[1]), outputPath = resolve(argv[3])
  if (inputPath === outputPath) fail('output must be a new file distinct from the input')
  const info = await stat(inputPath)
  if (!info.isFile() || info.size > 1024 * 1024) fail('input must be a regular JSON file of at most 1 MiB')
  const args = prepareBind(JSON.parse(await readFile(inputPath, 'utf8')))
  await writeFile(outputPath, `${JSON.stringify(args, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ tool: 'cad_propose_design_bind', output: outputPath, expectedRevision: args.expectedRevision, units: args.units }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
