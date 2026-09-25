import assert from 'node:assert/strict'
import test from 'node:test'
import { exportDrawingSvg } from '../src/index.js'
import { buildCuratedCivilSheetDocuments } from '../../../examples/curated-civil-sheets.mjs'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

test('curated civil sheets remain editable and reopen without missing vector geometry', async t => {
  const sheets = await buildCuratedCivilSheetDocuments()
  assert.deepEqual(sheets.map(sheet => sheet.id), ['drainage-network', 'retaining-wall', 'utility-trench'])
  const ids = new Set()
  for (const sheet of sheets) {
    assert.equal(sheet.document.validate().valid, true, sheet.id)
    assert.ok(sheet.document.listEntities().length >= 45, sheet.id)
    assert.equal(sheet.category, 'civil')
    assert.equal(sheet.facts.illustrative, true)
    for (const entity of sheet.document.listEntities()) {
      assert.ok(!ids.has(entity.id), `${sheet.id}: repeated entity id ${entity.id}`)
      ids.add(entity.id)
    }
    const svg = exportDrawingSvg(sheet.document, { layoutId: sheet.layoutId })
    assert.equal(svg.report.diagnostics.length, 0, sheet.id)
    assert.equal(svg.report.rendered, sheet.document.listEntities().length, sheet.id)
    assert.doesNotMatch(svg.svg, /<image\b|(?:href|src)=["']https?:\/\//u, sheet.id)
    for (const format of ['KJD', 'DXF']) {
      const bytes = await sheet.sdk.writeDocument(sheet.document, { format, version: format === 'DXF' ? '2018' : '1' })
      const reopened = await sheet.sdk.readDocument(bytes, { format })
      assert.equal(reopened.validate().valid, true, `${sheet.id}/${format}`)
      assert.equal(reopened.listEntities().length, sheet.document.listEntities().length, `${sheet.id}/${format}`)
      assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0, `${sheet.id}/${format}`)
      if (format === 'DXF') {
        const script = String.raw`import io,json,os,ezdxf
s=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read();d=ezdxf.read(io.StringIO(s));a=d.audit();print(json.dumps({'errors':len(a.errors),'fixes':len(a.fixes),'entities':sum(len(layout) for layout in d.layouts)}))`
        const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], bytes.toString('utf8'), { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
        if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(result.stderr ?? '')) t.diagnostic(`ezdxf unavailable for ${sheet.id}`)
        else {
          assert.equal(result.status, 0, result.stderr || result.error?.message)
          const audit = JSON.parse(result.stdout)
          assert.equal(audit.errors, 0, `${sheet.id}/ezdxf errors`)
          assert.equal(audit.fixes, 0, `${sheet.id}/ezdxf fixes`)
          assert.ok(audit.entities >= 45, `${sheet.id}/ezdxf entities`)
        }
      }
    }
  }
})
