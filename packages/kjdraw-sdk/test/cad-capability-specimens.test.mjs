import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKJDrawSDK } from '../src/index.js'
import { buildCadCapabilitySpecimenDocuments, buildCadCapabilitySpecimens } from '../../../examples/cad-capability-specimens.mjs'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

function independentlyAudit(dxf) {
  const script = String.raw`import io,json,os,ezdxf
s=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read();d=ezdxf.read(io.StringIO(s));a=d.audit();print(json.dumps({'version':ezdxf.__version__,'errors':len(a.errors),'fixes':len(a.fixes),'entities':sum(len(layout) for layout in d.layouts)}))`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf, { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(result.stderr ?? '')) return null
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return JSON.parse(result.stdout)
}

test('public CAD capability specimens write independently reopenable editable evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-capability-specimens-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifest = await buildCadCapabilitySpecimens(root)
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.synthetic, true)
  assert.deepEqual(manifest.specimens.map(item => item.id), ['geometry', 'hatch-patterns', 'dimensions', 'typography', 'layout-print', 'dxf-import', 'editing-history', 'blocks-references'])
  const inMemory = await buildCadCapabilitySpecimenDocuments()
  assert.deepEqual(inMemory.map(item => item.id), manifest.specimens.map(item => item.id))
  assert.ok(inMemory.every(item => item.document.validate().valid && item.layoutId && item.facts))

  for (const specimen of manifest.specimens) {
    assert.ok(specimen.entityCount > 0, specimen.id)
    assert.equal(specimen.svg.diagnostics, 0, specimen.id)
    assert.ok(['complete', 'approximate'].includes(specimen.svg.status), specimen.id)
    const sdk = createKJDrawSDK()
    let dxfBytes
    for (const format of ['KJD', 'DXF']) {
      const file = specimen.files[format.toLowerCase()]
      const bytes = await readFile(join(root, specimen.id, file))
      if (format === 'DXF') dxfBytes = bytes
      const reopened = await sdk.readDocument(bytes, { format })
      assert.equal(reopened.validate().valid, true, `${specimen.id}/${format}`)
      assert.ok(reopened.listEntities().length > 0, `${specimen.id}/${format}`)
      assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0, `${specimen.id}/${format}`)
    }
    const svg = await readFile(join(root, specimen.id, specimen.files.svg), 'utf8')
    assert.match(svg, /<svg\b/u, specimen.id)
    assert.doesNotMatch(svg, /<image\b|(?:href|src)=["']https?:\/\//u, specimen.id)
    const independent = independentlyAudit(dxfBytes.toString('utf8'))
    if (!independent) t.diagnostic(`Independent ezdxf unavailable for ${specimen.id}`)
    else {
      assert.equal(independent.errors, 0, `${specimen.id}/ezdxf errors`)
      assert.equal(independent.fixes, 0, `${specimen.id}/ezdxf fixes`)
      assert.ok(independent.entities > 0, `${specimen.id}/ezdxf entities`)
    }
  }

  const geometry = manifest.specimens.find(item => item.id === 'geometry')
  assert.deepEqual(geometry.facts.entityTypes, ['LINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'LWPOLYLINE', 'HATCH'])
  const dimensionDocument = await createKJDrawSDK().readDocument(await readFile(join(root, 'dimensions', 'dimensions.kjd')), { format: 'KJD' })
  assert.deepEqual(dimensionDocument.listEntities({ type: 'DIMENSION' }).map(entity => entity.payload.dimensionType).sort(), ['ALIGNED', 'ANGULAR_3_POINT', 'DIAMETER', 'RADIUS'])
  const typographySvg = await readFile(join(root, 'typography', 'typography.svg'), 'utf8')
  assert.match(typographySvg, /font-family="&quot;Source Han Sans SC&quot;,&quot;Microsoft YaHei&quot;,&quot;Arial&quot;,sans-serif,/u)
  assert.match(typographySvg, /工程图纸 KJDraw 123/u)
  const printHtml = await readFile(join(root, 'layout-print', 'layout-print.print.html'), 'utf8')
  assert.match(printHtml, /@page\{size:297mm 210mm;margin:0\}/u)
  assert.match(printHtml, /<svg[^>]+width="297mm"[^>]+height="210mm"/u)
  const imported = await createKJDrawSDK().readDocument(await readFile(join(root, 'dxf-import', 'dxf-import.kjd')), { format: 'KJD' })
  assert.deepEqual(imported.listEntities().map(entity => entity.handle).sort(), ['A1', 'A2', 'A3'])
  assert.equal(imported.listEntities({ type: 'TEXT' })[0].payload.text, 'UTF-8 工程导入')
  assert.deepEqual(manifest.specimens.find(item => item.id === 'editing-history').facts, { moved: [50, 35, 0], undone: [20, 20, 0], redone: [50, 35, 0], failedEditAtomic: true })
  const blocks = await createKJDrawSDK().readDocument(await readFile(join(root, 'blocks-references', 'blocks-references.kjd')), { format: 'KJD' })
  const blockFacts = manifest.specimens.find(item => item.id === 'blocks-references').facts
  assert.deepEqual(blockFacts, { definitionName: 'PUBLIC-REFERENCE-MARK', definitionEntityCount: 2, insertCount: 3 })
  assert.equal(blocks.listEntities({ type: 'INSERT' }).length, 3)
  const block = blocks.getTable('blockRecords').records.find(item => item.name === blockFacts.definitionName)
  assert.equal(blocks.listEntities({ ownerId: block.id }).length, 2)
})
