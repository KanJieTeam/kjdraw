import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { buildHatchPatternKnowledgePack, compileGeologyColumn, createKJDrawSDK, validateKnowledgePack } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const patSource = `; MIT synthetic phase fixture
*PHASE_TEST, shifted phase pattern
0, 1.25, 2.5, 0, 4, 2, -2
90, 0.5, 1.5, 5, 0, 1, -4
`
const hatchInput = { id: 'hatch-phase-test', version: '1.0.0', title: 'MIT synthetic hatch phase', domain: 'geology',
  license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
  sources: [{ id: 'synthetic-phase', title: 'MIT-authored hatch phase fixture', license: 'MIT',
    contentHash: crypto.createHash('sha256').update(patSource).digest('hex') }],
  patSource, selectedPatterns: ['PHASE_TEST'], mappings: { phase: 'PHASE_TEST' } }
const fieldGrid = [
  { start: 5, role: 'layerNumber', label: 'No' }, { start: 15, role: 'layerName', label: 'Name' },
  { start: 35, role: 'baseElevation', label: 'Base' }, { start: 50, role: 'thickness', label: 'Thick' },
  { start: 65, role: 'depth', label: 'Depth' }, { start: 80, role: 'pattern', label: 'Pattern' },
  { start: 100, role: 'description', label: 'Description' },
]
const layoutPack = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'phase-layout-test', version: '1.0.0',
  title: 'MIT synthetic phase layout', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
  sources: [{ id: 'synthetic-layout', title: 'MIT-authored phase layout', license: 'MIT', contentHash: 'a'.repeat(64) }],
  ontology: { objectKinds: ['borehole-log'], relationKinds: [] }, rules: { 'geology-column-layout': {
    paperWidth: 190, paperHeight: 290, left: 5, right: 185, fieldGrid, footerReserve: 20, legendMode: 'none',
    verticalScaleDenominators: [100],
  } } })
const counts = source => Object.fromEntries([...new Set(source.map(entity => entity.type))].sort()
  .map(type => [type, source.filter(entity => entity.type === type).length]))

test('PAT knowledge compilation preserves a source-backed base phase after coordinate normalization', async t => {
  const hatchPack = buildHatchPatternKnowledgePack({ ...hatchInput, patternBaseOffset: [3, -4] })
  const legacyPack = buildHatchPatternKnowledgePack(hatchInput)
  const patternFrom = pack => pack.rules['hatch-pattern-catalog'].patterns[0].lines
  assert.deepEqual(patternFrom(hatchPack).map(line => line.base), [[4.25, -1.5], [3.5, -2.5]])
  assert.deepEqual(patternFrom(legacyPack).map(line => line.base), [[1.25, 2.5], [.5, 1.5]])
  assert.throws(() => buildHatchPatternKnowledgePack({ ...hatchInput, patternBaseOffset: [1] }), /two bounded finite coordinates/u)
  assert.throws(() => buildHatchPatternKnowledgePack({ ...hatchInput, patternBaseOffset: [1e12, 0] }), /translated pattern base/u)

  const compiled = compileGeologyColumn({ hole: { id: 'BH-1', collarElevation: 100, depth: 5,
    strata: [{ intervalId: 'a', groupId: '1', groupRole: 'principal', code: '1', name: 'Layer', top: 0, bottom: 5,
      lithology: 'silt', patternKey: 'phase' }] }, verticalScaleDenominator: 100, expectedRevision: 0,
  columnStylePack: layoutPack, hatchPack })
  const entities = compiled.commandArgs.entities, hatch = entities.find(entity => entity.type === 'HATCH')
  assert.deepEqual(hatch.payload.patternLines.map(line => line.base), [[4.25, -1.5], [3.5, -2.5]])
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const format of ['KJD', 'DXF']) {
    const bytes = format === 'DXF' ? dxf : await sdk.writeDocument(document, { format: 'KJD', version: '1' })
    const reopened = await sdk.readDocument(bytes, { format })
    assert.equal(reopened.validate().valid, true)
    assert.deepEqual(counts(reopened.listEntities()), counts(entities))
    assert.deepEqual(reopened.listEntities({ type: 'HATCH' })[0].payload.patternLines.map(line => line.base),
      [[4.25, -1.5], [3.5, -2.5]])
  }
  const official = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,ezdxf; d=ezdxf.read(io.StringIO(open(__import__("os").environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"entities":len(d.modelspace())}))'],
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
