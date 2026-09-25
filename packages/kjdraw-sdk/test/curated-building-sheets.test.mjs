import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, exportDrawingSvg } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { buildCuratedBuildingSheetDocuments } from '../../../examples/curated-building-sheets.mjs'

function independentDxfAudit(dxf) {
  const script = String.raw`import io,json,os,sys
p=os.environ.get('KJDRAW_EZDXF_PATH')
if p: sys.path.insert(0,p)
import ezdxf
s=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()
d=ezdxf.read(io.StringIO(s));a=d.audit()
print(json.dumps({'errors':len(a.errors),'fixes':len(a.fixes),'entities':sum(len(layout) for layout in d.layouts)}))`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-I', '-c', script], dxf,
    { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(result.stderr ?? '')) return null
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return JSON.parse(result.stdout)
}

test('curated building and site sheets are distinct editable CAD drawings with black-canvas-ready output', async t => {
  const sheets = await buildCuratedBuildingSheetDocuments()
  assert.deepEqual(sheets.map(sheet => sheet.id), [
    'compact-office-plan', 'door-window-elevations', 'retail-power-one-line', 'courtyard-circulation-plan',
  ])
  for (const sheet of sheets) {
    assert.equal(sheet.document.validate().valid, true, sheet.id)
    assert.ok(sheet.document.listEntities().length >= 65, `${sheet.id}: expected a detailed sheet`)
    assert.ok(sheet.document.getTable('layers').records.length >= 7, `${sheet.id}: expected editable layers`)
    assert.ok(sheet.document.listEntities({ type: 'TEXT' }).length >= 12, `${sheet.id}: missing labels`)
    assert.ok(sheet.document.listEntities({ type: 'LWPOLYLINE' }).length >= 3, `${sheet.id}: missing editable geometry`)
    assert.equal(sheet.facts.concept, true)
    const svg = exportDrawingSvg(sheet.document, { layoutId: sheet.layoutId })
    assert.deepEqual(svg.report.diagnostics, [], `${sheet.id}: SVG diagnostics`)
    assert.ok(svg.report.rendered >= 65, `${sheet.id}: incomplete SVG rendering`)
    assert.doesNotMatch(svg.svg, /<image\b|(?:href|src)=["']https?:\/\//u)
    for (const format of ['KJD', 'DXF']) {
      const bytes = await sheet.sdk.writeDocument(sheet.document, { format, version: format === 'DXF' ? '2018' : '1' })
      const restored = await createKJDrawSDK().readDocument(bytes, { format })
      assert.equal(restored.validate().valid, true, `${sheet.id}/${format}`)
      assert.equal(restored.listEntities({ type: 'PROXY_ENTITY' }).length, 0, `${sheet.id}/${format}`)
      assert.ok(restored.listEntities({ type: 'TEXT' }).length >=
        sheet.document.listEntities({ type: 'TEXT' }).length, `${sheet.id}/${format} text loss`)
      if (format === 'DXF') {
        const external = independentDxfAudit(bytes.toString('utf8'))
        if (external) {
          assert.equal(external.errors, 0, `${sheet.id}/ezdxf errors`)
          assert.equal(external.fixes, 0, `${sheet.id}/ezdxf fixes`)
          assert.ok(external.entities >= 65, `${sheet.id}/ezdxf entities`)
        } else t.diagnostic(`ezdxf unavailable for ${sheet.id}`)
      }
    }
  }
  assert.equal(sheets[0].document.listEntities({ type: 'DIMENSION' }).length, 0)
  assert.match(sheets[0].document.listEntities({ type: 'TEXT' }).map(e => e.payload.text).join(' '), /NTS/)
  assert.match(sheets[3].document.listEntities({ type: 'TEXT' }).map(e => e.payload.text).join(' '), /NTS/)
  assert.equal(sheets[1].document.listEntities({ type: 'DIMENSION' }).length, 0)
  assert.equal(sheets[2].document.listEntities({ type: 'CIRCLE' }).length >= 8, true)
  assert.equal(sheets[3].document.listEntities({ type: 'HATCH' }).length >= 4, true)
})
