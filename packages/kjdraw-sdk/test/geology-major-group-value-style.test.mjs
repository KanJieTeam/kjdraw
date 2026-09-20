import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { compileGeologyColumn, createKJDrawSDK, validateKnowledgePack } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const placement = (offset, height, textWidthFactor = .8) => ({
  offset, height, textWidthFactor, horizontalAlignment: 'center', verticalAlignment: 'middle',
})
const fieldGrid = [
  { start: 5, role: 'layerNumber', label: 'No' }, { start: 15, role: 'layerName', label: 'Name' },
  { start: 33, role: 'baseElevation', label: 'Base' }, { start: 45, role: 'thickness', label: 'Thick' },
  { start: 55, role: 'depth', label: 'Depth' }, { start: 65, role: 'pattern', label: 'Pattern' },
  { start: 85, role: 'description', label: 'Description' },
]
const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-major-group-values-test', version: '1.0.0',
  title: 'MIT synthetic major group placement', domain: 'geology',
  license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
  sources: [{ id: 'synthetic-major-values', title: 'MIT-authored physical placement fixture', license: 'MIT',
    contentHash: crypto.createHash('sha256').update('synthetic major-group midpoint placements').digest('hex') }],
  ontology: { objectKinds: ['borehole-log'], relationKinds: [] }, rules: { 'geology-column-layout': {
    paperWidth: 190, paperHeight: 290, left: 5, right: 185, headerDepth: 40, headerRowHeight: 5,
    fieldHeaderHeight: 12, footerReserve: 15, titleHeight: 10, verticalScaleDenominators: [100],
    fieldGrid, legendMode: 'none', layerNumberStyle: 'circle', majorGroupValueStyle: {
      anchor: 'major-group-midpoint', layerNumber: placement([5, 0], 4), layerName: placement([9, 3], 3, 1),
      topBoundary: { layerName: placement([9, 2.25], 3, 1) }, baseElevation: placement([6, 0], 3), thickness: placement([5, 0], 3), layerNumberCircleRadius: 3,
    },
  } } })
const hole = { id: 'BH-1', collarElevation: 120.5, depth: 12, strata: [
  { intervalId: 'a', groupId: '1', groupRole: 'principal', code: '1', name: 'Alpha', top: 0, bottom: 1, lithology: 'fill' },
  { intervalId: 'b', groupId: '2', groupRole: 'principal', code: '2', name: 'Beta', top: 1, bottom: 3, lithology: 'silt' },
  { intervalId: 'c', groupId: '3', groupRole: 'principal', code: '3', name: 'Gamma', top: 3, bottom: 6, lithology: 'gravel' },
  { intervalId: 'd', groupId: '4', groupRole: 'principal', code: '4', name: 'Delta', top: 6, bottom: 12, lithology: 'rock' },
] }

test('source-backed major group values preserve midpoint anchors, text attributes and circle radii', async t => {
  const input = { hole, verticalScaleDenominator: 100, expectedRevision: 0, columnStylePack: style }
  const compiled = compileGeologyColumn(input), entities = compiled.commandArgs.entities
  const texts = entities.filter(entity => entity.type === 'TEXT'), circles = entities.filter(entity => entity.type === 'CIRCLE')
  for (const [value, x, y, height, widthFactor] of [
    ['1', 10, 233, 4, .8], ['2', 10, 218, 4, .8], ['3', 10, 193, 4, .8], ['4', 10, 148, 4, .8],
    ['Alpha', 24, 235.25, 3, 1], ['Beta', 24, 221, 3, 1], ['Gamma', 24, 196, 3, 1], ['Delta', 24, 151, 3, 1],
    ['119.50', 39, 233, 3, .8], ['1.00', 50, 233, 3, .8], ['117.50', 39, 218, 3, .8], ['2.00', 50, 218, 3, .8],
    ['114.50', 39, 193, 3, .8], ['3.00', 50, 193, 3, .8], ['108.50', 39, 148, 3, .8], ['6.00', 50, 148, 3, .8],  ]) assert.ok(texts.some(entity => entity.payload.text === value && entity.payload.position[0] === x &&
    entity.payload.position[1] === y && entity.payload.height === height && entity.payload.widthFactor === widthFactor &&
    entity.payload.horizontalAlignment === 1 && entity.payload.verticalAlignment === 2), `${value} physical placement`)
  assert.deepEqual(circles.map(entity => [entity.payload.center[0], entity.payload.center[1], entity.payload.radius]),
    [[10, 233, 3], [10, 218, 3], [10, 193, 3], [10, 148, 3]])

  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF' }), reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD' })
  assert.equal(reopened.validate().valid, true); assert.equal(reopenedKjd.validate().valid, true)
  const counts = source => Object.fromEntries([...new Set(source.map(entity => entity.type))].sort()
    .map(type => [type, source.filter(entity => entity.type === type).length]))
  assert.deepEqual(counts(reopened.listEntities()), counts(reopenedKjd.listEntities()))
  assert.deepEqual(reopened.listEntities({ type: 'CIRCLE' }).map(entity => entity.payload.radius), [3, 3, 3, 3])

  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,ezdxf; d=ezdxf.read(io.StringIO(open(__import__("os").environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); m=d.modelspace(); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"radii":[e.dxf.radius for e in m.query("CIRCLE")]}))'],
  dxf, { encoding: 'utf8', windowsHide: true, env: { ...process.env,
    PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(independent.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(independent.stderr || independent.error?.message)
    t.diagnostic('official ezdxf unavailable; independent check skipped')
  } else {
    assert.equal(independent.status, 0, independent.stderr)
    assert.deepEqual(JSON.parse(independent.stdout), { errors: 0, fixes: 0, radii: [3, 3, 3, 3] })
  }

  const legacy = structuredClone(input)
  delete legacy.columnStylePack.rules['geology-column-layout'].majorGroupValueStyle
  const legacyCompiled = compileGeologyColumn(legacy)
  assert.ok(legacyCompiled.commandArgs.entities.some(entity => entity.type === 'CIRCLE' && entity.payload.radius === 1.9),
    'templates without the opt-in preserve the existing automatic layout')
  const incompleteTopBoundary = structuredClone(input)
  delete incompleteTopBoundary.columnStylePack.rules['geology-column-layout'].majorGroupValueStyle.topBoundary.layerName
  assert.throws(() => compileGeologyColumn(incompleteTopBoundary), /top-boundary style needs an exact layer-name placement/u)
  const incomplete = structuredClone(input)
  delete incomplete.columnStylePack.rules['geology-column-layout'].majorGroupValueStyle.thickness
  assert.throws(() => compileGeologyColumn(incomplete), /major group value style needs an exact source-backed schema/u)
  const oversized = structuredClone(input)
  oversized.columnStylePack.rules['geology-column-layout'].majorGroupValueStyle.layerNumberCircleRadius = 6
  assert.throws(() => compileGeologyColumn(oversized), /circle radius is outside its physical lane/u)
})
