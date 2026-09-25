import assert from 'node:assert/strict'
import test from 'node:test'
import { exportDrawingSvg } from '../src/index.js'
import {
  GEOLOGY_SAMPLE_FACTS, buildCuratedGeologySheetDocuments,
} from '../../../examples/curated-geology-sheets.mjs'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const ids = ['borehole-log-sheet', 'geological-section-sheet', 'investigation-point-plan']

test('original synthetic geology sheets preserve geology, scale and cross-view identities', async () => {
  const sheets = await buildCuratedGeologySheetDocuments()
  assert.deepEqual(sheets.map(sheet => sheet.id), ids)
  assert.deepEqual(sheets.map(sheet => sheet.category), ['geology', 'geology', 'geology'])
  assert.deepEqual(sheets[1].facts.boreholeIds, sheets[2].facts.boreholeIds)
  assert.deepEqual(sheets[0].facts.boreholeIds, ['ZK03'])
  assert.equal(GEOLOGY_SAMPLE_FACTS.depthMeters, 30)
  assert.ok(new Set(GEOLOGY_SAMPLE_FACTS.depthBoundaries.map(row => row.join(','))).size >= 4,
    'the section must have genuinely variable layer boundaries')

  const [log, section, plan] = sheets
  assert.equal(log.facts.waterY, 139)
  assert.equal(log.facts.millimetresPerMetre, 5)
  assert.equal(log.facts.topY - log.facts.bottomY, 150)
  const waterRule = log.document.getObject('geology-log-stable-water-rule')
  assert.equal(waterRule?.type, 'LINE')
  assert.deepEqual(waterRule.payload.start.slice(0, 2), [67, 139])
  assert.deepEqual(waterRule.payload.end.slice(0, 2), [92, 139])
  assert.equal(log.document.listEntities({ type: 'HATCH' }).length, 12)
  const logTexts = log.document.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
  assert.equal(logTexts.filter(value => value.includes('SYNTHETIC, NOT MEASURED')).length, 1)
  assert.ok(logTexts.includes('SWL 18.40 m / EL 281.45 m'))
  assert.ok(logTexts.some(value => value.includes('VERTICAL SCALE 1:200')))

  assert.ok(section.document.listEntities({ type: 'HATCH' }).length >= 30)
  const sectionTexts = section.document.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
  for (const id of GEOLOGY_SAMPLE_FACTS.boreholeIds) assert.ok(sectionTexts.includes(id), id)
  assert.equal(sectionTexts.filter(value => value.includes('SYNTHETIC, NOT MEASURED')).length, 1)
  assert.ok(sectionTexts.includes('WL 18.40'))
  assert.ok(sectionTexts.some(value => value.includes('HORIZONTAL 1:500   VERTICAL 1:200')))

  const markers = plan.document.listEntities({ type: 'CIRCLE' })
    .filter(entity => entity.payload.semanticRole === 'investigation-point')
  assert.equal(markers.length, 5)
  assert.deepEqual(markers.map(entity => entity.payload.center.slice(0, 2)).sort((a, b) => a[0] - b[0]),
    GEOLOGY_SAMPLE_FACTS.boreholeIds.map((_, i) => [1000 + i * 25, 1000]))
  assert.equal(plan.facts.buildingFootprintCount, 2)
  assert.equal(plan.facts.roadPathCount, 2)
  const planTexts = plan.document.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
  for (const id of GEOLOGY_SAMPLE_FACTS.boreholeIds) assert.ok(planTexts.some(value => value.includes(id)), id)
  assert.equal(planTexts.filter(value => value.includes('SYNTHETIC, NOT MEASURED')).length, 1)
  const paperFrame = plan.document.getObject('geology-plan-paper-frame')
  assert.equal(paperFrame?.type, 'LWPOLYLINE')
  assert.equal(paperFrame.payload.closed, true)
  assert.deepEqual(paperFrame.payload.vertices.map(vertex => vertex.point.slice(0, 2)),
    [[15, 30], [390, 30], [390, 260], [15, 260]])
  assert.equal(plan.document.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  for (const sheet of sheets) {
    assert.equal(sheet.facts.illustrative, true)
    assert.equal(sheet.facts.measuredData, false)
    assert.doesNotMatch(sheet.document.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text).join(' '),
      /技术示意|版式未验收|layout.unverified/u)
  }
})

test('curated geology KJD/DXF reopen, dark-preview SVG and independent ezdxf audit', async t => {
  const sheets = await buildCuratedGeologySheetDocuments()
  for (const sheet of sheets) {
    assert.equal(sheet.document.validate().valid, true, sheet.id)
    const svg = exportDrawingSvg(sheet.document, { layoutId: sheet.layoutId })
    assert.equal(svg.report.diagnostics.length, 0, `${sheet.id}: SVG diagnostics`)
    assert.ok(svg.report.rendered >= 50, `${sheet.id}: SVG rendered entity count`)
    assert.doesNotMatch(svg.svg, /<image\b|(?:href|src)=["']https?:\/\//u, sheet.id)
    if (sheet.id !== 'investigation-point-plan') {
      assert.match(svg.svg, /kj-pat-clip-\d+/u, `${sheet.id}: native hatch pattern must render`)
      assert.ok(sheet.document.listEntities({ type: 'HATCH' }).every(entity => entity.payload.patternName),
        `${sheet.id}: unnamed hatch`)
    }
    for (const format of ['KJD', 'DXF']) {
      const bytes = await sheet.sdk.writeDocument(sheet.document, {
        format, ...(format === 'DXF' ? { version: '2018' } : {}),
      })
      const reopened = await sheet.sdk.readDocument(bytes, { format })
      assert.equal(reopened.validate().valid, true, `${sheet.id}/${format}`)
      assert.equal(reopened.listEntities().length, sheet.document.listEntities().length, `${sheet.id}/${format}`)
      assert.equal(reopened.listEntities({ type: 'HATCH' }).length,
        sheet.document.listEntities({ type: 'HATCH' }).length, `${sheet.id}/${format}`)
      assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0, `${sheet.id}/${format}`)
      if (format !== 'DXF') continue
      const script = String.raw`import io,json,os,ezdxf
source=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()
drawing=ezdxf.read(io.StringIO(source)); report=drawing.audit(); model=drawing.modelspace()
print(json.dumps({'errors':len(report.errors),'fixes':len(report.fixes),'hatches':len(model.query('HATCH'))}))`
      const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script],
        bytes.toString('utf8'), { encoding: 'utf8', timeout: 30_000,
          env: { ...process.env, PYTHONPATH: process.env.KJDRAW_EZDXF_PATH ?? process.env.PYTHONPATH ?? '',
            PYTHONIOENCODING: 'utf-8' } })
      if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(result.stderr ?? '')) {
        if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(result.stderr || result.error?.message)
        t.diagnostic(`ezdxf unavailable for ${sheet.id}`)
      } else {
        assert.equal(result.status, 0, result.stderr || result.error?.message)
        const audit = JSON.parse(result.stdout)
        assert.deepEqual([audit.errors, audit.fixes], [0, 0], `${sheet.id}/ezdxf`)
        assert.equal(audit.hatches, sheet.document.listEntities({ type: 'HATCH' }).length,
          `${sheet.id}/ezdxf hatch count`)
      }
    }
  }
})
