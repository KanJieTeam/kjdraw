import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKJDrawSDK } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { buildCuratedMechanicalSheetDocuments, buildCuratedMechanicalSheets } from '../../../examples/curated-mechanical-sheets.mjs'

const expectedIds = ['sleeve-bushing', 'four-hole-plate', 'angle-support', 'hole-gauge']

function ezdxfAudit(dxf) {
  const script = String.raw`import io,json,os,ezdxf
s=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()
d=ezdxf.read(io.StringIO(s));a=d.audit()
print(json.dumps({'version':ezdxf.__version__,'errors':len(a.errors),'fixes':len(a.fixes),'dimensions':len(d.modelspace().query('DIMENSION')),'layers':sorted({e.dxf.layer for e in d.modelspace()})}))`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf,
    { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(result.stderr ?? '')) return null
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return JSON.parse(result.stdout)
}

test('curated manufacturing sheets are editable, dimensioned and independently auditable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-curated-mechanical-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifest = await buildCuratedMechanicalSheets(root)
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.synthetic, true)
  assert.deepEqual(manifest.cases.map(item => item.id), expectedIds)
  const inMemory = await buildCuratedMechanicalSheetDocuments()
  assert.deepEqual(inMemory.map(item => item.id), expectedIds)

  for (const item of manifest.cases) {
    assert.ok(item.entityCount >= 35, item.id)
    assert.equal(item.svg.diagnostics, 0, item.id)
    assert.equal(item.svg.rendered, item.entityCount, item.id)
    assert.deepEqual(item.layerNames, ['0', 'CENTER_LINES', 'DIMENSIONS', 'NOTES', 'PART_OUTLINE', 'SECTION_HATCH', 'SHEET_FRAME'])
    const original = inMemory.find(entry => entry.id === item.id)
    assert.equal(original.document.validate().valid, true, item.id)
    assert.ok(original.document.listEntities({ type: 'DIMENSION' }).length >= 2, `${item.id} has native dimensions`)
    assert.ok(original.document.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === item.title), `${item.id} title block`)
    assert.ok(original.document.listEntities({ type: 'LWPOLYLINE' }).length >= 3, `${item.id} uses editable polylines`)
    const sdk = createKJDrawSDK()
    let dxf
    for (const format of ['KJD', 'DXF']) {
      const bytes = await readFile(join(root, item.id, item.files[format.toLowerCase()]))
      if (format === 'DXF') dxf = bytes.toString('utf8')
      const reopened = await sdk.readDocument(bytes, { format })
      assert.equal(reopened.validate().valid, true, `${item.id}/${format}`)
      assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0, `${item.id}/${format}`)
      assert.equal(reopened.listEntities({ type: 'DIMENSION' }).length, original.document.listEntities({ type: 'DIMENSION' }).length, `${item.id}/${format}`)
      assert.ok(reopened.listEntities().length >= item.entityCount, `${item.id}/${format}`)
    }
    const svg = await readFile(join(root, item.id, item.files.svg), 'utf8')
    assert.match(svg, /<svg\b/u, item.id)
    assert.doesNotMatch(svg, /<image\b|(?:href|src)=["']https?:\/\//u, item.id)
    const external = ezdxfAudit(dxf)
    if (!external) t.diagnostic(`Independent ezdxf not available for ${item.id}`)
    else {
      assert.equal(external.errors, 0, `${item.id}/ezdxf errors`)
      assert.equal(external.fixes, 0, `${item.id}/ezdxf fixes`)
      assert.ok(external.dimensions >= 2, `${item.id}/ezdxf dimensions`)
      assert.ok(external.layers.includes('PART_OUTLINE'), `${item.id}/ezdxf outline layer`)
    }
  }

  const sleeve = inMemory.find(item => item.id === 'sleeve-bushing').document
  assert.deepEqual(sleeve.listEntities({ type: 'CIRCLE' }).map(entity => entity.payload.radius).sort((a, b) => a - b), [16, 30])
  assert.equal(sleeve.listEntities({ type: 'HATCH' }).length, 2)
  const plate = inMemory.find(item => item.id === 'four-hole-plate').document
  assert.deepEqual(plate.listEntities({ type: 'CIRCLE' }).map(entity => entity.payload.radius).sort((a, b) => a - b), [5, 5, 5, 5, 18])
  const angle = inMemory.find(item => item.id === 'angle-support').document
  assert.equal(angle.listEntities({ type: 'CIRCLE' }).length, 2)
  const gauge = inMemory.find(item => item.id === 'hole-gauge').document
  assert.equal(gauge.listEntities({ type: 'CIRCLE' }).length, 6)
})
