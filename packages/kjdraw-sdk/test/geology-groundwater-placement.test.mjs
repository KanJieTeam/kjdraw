import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { compileGeologyColumn, createKJDrawSDK, validateKnowledgePack } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const placement = (offset, height, horizontalAlignment) => ({ offset, height, textWidthFactor: .8,
  horizontalAlignment, verticalAlignment: 'middle' })
const fieldGrid = [
  { start: 5, role: 'layerNumber', label: 'No' }, { start: 15, role: 'layerName', label: 'Name' },
  { start: 35, role: 'baseElevation', label: 'Base' }, { start: 50, role: 'thickness', label: 'Thick' },
  { start: 65, role: 'depth', label: 'Depth' }, { start: 80, role: 'pattern', label: 'Pattern' },
  { start: 100, role: 'description', label: 'Description' },
]
const pack = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'groundwater-placement-test', version: '1.0.0',
  title: 'MIT synthetic groundwater placement fixture', domain: 'geology',
  license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
  sources: [{ id: 'synthetic-groundwater-placement', title: 'MIT-authored groundwater placement fixture', license: 'MIT',
    contentHash: crypto.createHash('sha256').update('synthetic groundwater independent placements').digest('hex') }],
  ontology: { objectKinds: ['borehole-log'], relationKinds: [] }, rules: { 'geology-column-layout': {
    paperWidth: 190, paperHeight: 290, left: 5, right: 185, fieldGrid, footerReserve: 20, legendMode: 'none',
    verticalScaleDenominators: [100], groundwaterAnnotationStyle: {
      fieldRole: 'pattern', textHeight: 2, markerHeight: 2.5, textWidthFactor: .8, gap: .6,
      valueOffset: 3, markerOffset: 0, dateOffset: -3, guide: 'field-top-to-reading', placements: {
        depth: placement([6, 2], 2, 'right'), elevation: placement([8, 2], 2, 'left'),
        marker: placement([7, .5], 2.5, 'center'), observedOn: placement([10, -3], 2, 'center'),
      },
    },
  } } })
const hole = { id: 'BH-1', collarElevation: 100, depth: 5,
  strata: [{ intervalId: 'a', groupId: '1', groupRole: 'principal', code: '1', name: 'Layer', top: 0, bottom: 5, lithology: 'silt' }],
  groundwaterObservations: [{ depth: 1.5, elevation: 98.5, observedOn: '2030-4-5', marker: 'filled-down-triangle' }] }
const counts = source => Object.fromEntries([...new Set(source.map(entity => entity.type))].sort()
  .map(type => [type, source.filter(entity => entity.type === type).length]))

test('source-backed groundwater facts preserve independent role placements without changing topology', async t => {
  const input = { hole, verticalScaleDenominator: 100, expectedRevision: 0, columnStylePack: pack }
  const compiled = compileGeologyColumn(input), entities = compiled.commandArgs.entities
  const guide = entities.find(entity => entity.type === 'LWPOLYLINE' && !entity.payload.closed && entity.payload.vertices.length === 3 &&
    entity.payload.vertices[0][0] === 80 && entity.payload.vertices[2][0] === 100)
  assert.ok(guide, 'source-backed groundwater guide')
  const readingY = guide.payload.vertices[1][1]
  const texts = entities.filter(entity => entity.type === 'TEXT')
  for (const [value, x, y, height, horizontalAlignment] of [
    ['1.50', 86, readingY + 2, 2, 2], ['98.50', 88, readingY + 2, 2, 0],
    ['▼', 87, readingY + .5, 2.5, 1], ['2030-4-5', 90, readingY - 3, 2, 1],
  ]) assert.ok(texts.some(entity => {
    const point = entity.payload.alignmentPoint ?? entity.payload.position
    return entity.payload.text === value && point[0] === x && point[1] === y && entity.payload.height === height &&
      entity.payload.widthFactor === .8 && (entity.payload.horizontalAlignment ?? 0) === horizontalAlignment &&
      entity.payload.verticalAlignment === 2
  }), `${value} independent placement`)

  const legacy = structuredClone(input)
  delete legacy.columnStylePack.rules['geology-column-layout'].groundwaterAnnotationStyle.placements
  const legacyCompiled = compileGeologyColumn(legacy)
  assert.deepEqual(counts(legacyCompiled.commandArgs.entities), counts(entities), 'opt-in placements change no entity topology')
  assert.ok(legacyCompiled.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text === '1.50' &&
    entity.payload.horizontalAlignment === 1 && (entity.payload.verticalAlignment ?? 0) === 0), 'legacy automatic layout remains unchanged')

  const incomplete = structuredClone(input)
  delete incomplete.columnStylePack.rules['geology-column-layout'].groundwaterAnnotationStyle.placements.observedOn
  assert.throws(() => compileGeologyColumn(incomplete), /exact depth, elevation, marker and observedOn roles/u)
  const mismatchedMetrics = structuredClone(input)
  mismatchedMetrics.columnStylePack.rules['geology-column-layout'].groundwaterAnnotationStyle.placements.marker.height = 3
  assert.throws(() => compileGeologyColumn(mismatchedMetrics), /must match the declared text metrics/u)
  const outside = structuredClone(input)
  outside.columnStylePack.rules['geology-column-layout'].groundwaterAnnotationStyle.placements.depth.offset[0] = 21
  assert.throws(() => compileGeologyColumn(outside), /outside its physical lane/u)

  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const format of ['KJD', 'DXF']) {
    const bytes = format === 'DXF' ? dxf : await sdk.writeDocument(document, { format: 'KJD', version: '1' })
    const reopened = await sdk.readDocument(bytes, { format })
    assert.equal(reopened.validate().valid, true)
    assert.deepEqual(counts(reopened.listEntities()), counts(entities))
    for (const [value, x, y] of [['1.50', 86, readingY + 2], ['98.50', 88, readingY + 2],
      ['▼', 87, readingY + .5], ['2030-4-5', 90, readingY - 3]]) {
      const entity = reopened.listEntities({ type: 'TEXT' }).find(item => item.payload.text === value)
      const point = entity.payload.alignmentPoint ?? entity.payload.position
      assert.ok(Math.abs(point[0] - x) < 1e-6 && Math.abs(point[1] - y) < 1e-6, `${format} ${value}`)
    }
  }
  const official = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,ezdxf; d=ezdxf.read(io.StringIO(open(__import__("os").environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); m=d.modelspace(); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"entities":len(m)}))'],
  dxf, { encoding: 'utf8', windowsHide: true, env: { ...process.env,
    PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (official.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(official.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(official.stderr || official.error?.message)
    t.diagnostic('official ezdxf unavailable; independent check skipped')
  } else {
    assert.equal(official.status, 0, official.stderr)
    assert.deepEqual(JSON.parse(official.stdout), { errors: 0, fixes: 0, entities: entities.length })
  }
})
