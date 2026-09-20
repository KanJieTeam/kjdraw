import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { compileGeologyColumn, createKJDrawSDK, validateKnowledgePack } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const fieldGrid = [
  { start: 5, role: 'layerNumber', label: 'No' }, { start: 15, role: 'layerName', label: 'Name' },
  { start: 35, role: 'baseElevation', label: 'Base' }, { start: 50, role: 'thickness', label: 'Thick' },
  { start: 65, role: 'depth', label: 'Depth' }, { start: 80, role: 'pattern', label: 'Pattern' },
  { start: 100, role: 'description', label: 'Description' }, { start: 160, role: 'sample', label: 'Sample' },
]
const layout = width => ({ paperWidth: 190, paperHeight: 290, left: 5, right: 185, fieldGrid,
  footerReserve: 20, legendMode: 'none', verticalScaleDenominators: [100], descriptionTextStyle: {
    fieldRole: 'description', anchor: 'declared-major-group-boundary', height: 2.5,
    ...(width == null ? {} : { width }),
  } })
const pack = width => validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: `description-width-${width ?? 'legacy'}`, version: '1.0.0',
  title: 'MIT synthetic description width fixture', domain: 'geology',
  license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
  sources: [{ id: 'synthetic-description-width', title: 'MIT-authored description width fixture', license: 'MIT',
    contentHash: crypto.createHash('sha256').update('synthetic description mtext width').digest('hex') }],
  ontology: { objectKinds: ['borehole-log'], relationKinds: [] }, rules: { 'geology-column-layout': layout(width) } })
const hole = { id: 'BH-1', collarElevation: 100, depth: 5, strata: [{ intervalId: 'a', groupId: '1', groupRole: 'principal',
  code: '1', name: 'Layer', top: 0, bottom: 5, lithology: 'silt', description: 'Synthetic paragraph for physical width validation.',
  descriptionPlacement: { boundaryRole: 'top', offsetMm: -1 } }] }
const compile = width => compileGeologyColumn({ hole, verticalScaleDenominator: 100, expectedRevision: 0, columnStylePack: pack(width) })
const counts = source => Object.fromEntries([...new Set(source.map(entity => entity.type))].sort()
  .map(type => [type, source.filter(entity => entity.type === type).length]))

test('source-backed description width preserves an exact native MTEXT paragraph width', async t => {
  const compiled = compile(58), description = compiled.commandArgs.entities.find(entity => entity.type === 'MTEXT')
  assert.ok(description)
  assert.deepEqual(description.payload.position.slice(0, 2), [102, 223])
  assert.equal(description.payload.height, 2.5)
  assert.equal(description.payload.width, 58)
  assert.equal(compile().commandArgs.entities.find(entity => entity.type === 'MTEXT').payload.width, 56,
    'style packs without a source width preserve the inferred legacy width')
  assert.throws(() => compile(61), /description text width is outside its physical field/u)
  assert.throws(() => compile(4), /description text width is outside its physical field/u)

  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const format of ['KJD', 'DXF']) {
    const bytes = format === 'DXF' ? dxf : await sdk.writeDocument(document, { format: 'KJD', version: '1' })
    const reopened = await sdk.readDocument(bytes, { format })
    assert.equal(reopened.validate().valid, true)
    assert.deepEqual(counts(reopened.listEntities()), counts(compiled.commandArgs.entities))
    assert.equal(reopened.listEntities({ type: 'MTEXT' })[0].payload.width, 58)
  }
  const official = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,ezdxf; d=ezdxf.read(io.StringIO(open(__import__("os").environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); m=d.modelspace(); e=list(m.query("MTEXT"))[0]; print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"width":e.dxf.width}))'],
  dxf, { encoding: 'utf8', windowsHide: true, env: { ...process.env,
    PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (official.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(official.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(official.stderr || official.error?.message)
    t.diagnostic('official ezdxf unavailable; independent check skipped')
  } else {
    assert.equal(official.status, 0, official.stderr)
    assert.deepEqual(JSON.parse(official.stdout), { errors: 0, fixes: 0, width: 58 })
  }
})
