import test from 'node:test'
import assert from 'node:assert/strict'
import { delimiter } from 'node:path'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const validator = `import io, json, os, ezdxf
with open(os.environ['KJDRAW_FILE_STDIN_PATH'], encoding='utf-8') as source:
    document = ezdxf.read(io.StringIO(source.read()))
audit = document.audit()
texts = {entity.dxf.text: {
    'handle': entity.dxf.handle,
    'insert': list(entity.dxf.insert),
    'alignPoint': list(entity.dxf.align_point),
    'extrusion': list(entity.dxf.extrusion),
    'horizontalAlignment': entity.dxf.halign,
    'verticalAlignment': entity.dxf.valign
} for entity in document.modelspace().query('TEXT')}
print(json.dumps({'reader': ezdxf.__version__, 'units': document.units,
    'errors': len(audit.errors), 'fixes': len(audit.fixes), 'texts': texts}))`

test('independent ezdxf preserves reviewed TEXT XY movement, constant native elevations, handles and alignment without repairs', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const originals = []
  await document.transact('Public synthetic elevated native text', transaction => {
    for (const [index, z] of [12.5, 25, 50, -1704.5].entries()) originals.push(transaction.createEntity('TEXT', {
      text: 'SYNTHETIC-ELEVATION-' + index, height: 2,
      position: [10 + index * 40, 20, z], alignmentPoint: [30 + index * 40, 20, z],
      horizontalAlignment: 3, verticalAlignment: 0, normal: [0, 0, 1],
    }))
  })
  const session = new KJAgentToolSession(sdk, document)
  const proposed = await session.call('cad_propose_move', { expectedRevision: document.revision,
    units: 'millimeter', ids: originals.map(entity => entity.id), dx: 2, dy: -3 })
  assert.equal(proposed.ok, true, JSON.stringify(proposed.error))
  const committed = await session.approve(proposed.value.planId, 'independent-synthetic-elevation-review')
  assert.equal(committed.ok, true, JSON.stringify(committed.error))
  const data = await sdk.writeDocument(document, { format: 'DXF' })
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', validator], data, {
    // A process-startup budget, not a CAD operation performance assertion.
    // Windows hosted runners can spend over 30 seconds importing ezdxf while
    // other test workers run; timeouts still fail and no retry hides a failure.
    encoding: 'utf8', windowsHide: true,
    timeout: process.platform === 'win32' ? 90_000 : 30_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8',
      PYTHONPATH: [process.env.KJDRAW_EZDXF_PATH, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
  })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(result.stderr ?? '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(result.stderr || result.error.message)
    return t.skip('install the independent ezdxf validator to run this interoperability check')
  }
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const report = JSON.parse(result.stdout)
  assert.equal(report.units, 4)
  assert.equal(report.errors, 0)
  assert.equal(report.fixes, 0)
  assert.equal(Object.keys(report.texts).length, originals.length)
  for (const original of originals) {
    const text = report.texts[original.payload.text]
    assert.ok(text)
    assert.equal(text.handle, original.handle)
    assert.deepEqual(text.insert, [original.payload.position[0] + 2, 17, original.payload.position[2]])
    assert.deepEqual(text.alignPoint, [original.payload.alignmentPoint[0] + 2, 17, original.payload.alignmentPoint[2]])
    assert.deepEqual(text.extrusion, [0, 0, 1])
    assert.equal(text.horizontalAlignment, 3)
    assert.equal(text.verticalAlignment, 0)
  }
  t.diagnostic('ezdxf ' + report.reader + ': four constant elevations and native alignment anchors retained; zero audit errors/fixes')
})
