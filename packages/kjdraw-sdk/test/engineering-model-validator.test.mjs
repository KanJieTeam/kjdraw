import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { engineeringDrawingRequirements, referenceAnnotatedInput } from '../../../scripts/benchmarks/engineering-drawing-tasks.mjs'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const python = process.env.KJDRAW_PYTHON ?? 'python'
const validator = fileURLToPath(new URL('../../../scripts/benchmarks/engineering-model-validator.py', import.meta.url))
function runPython(args, input) {
  const result = spawnSyncWithFileStdin(python, args, input, { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout)
  return result.stdout
}
const validate = (dxf, expected) => JSON.parse(runPython([validator], JSON.stringify({ dxf, expected })))
async function fixture(revision = 'A') {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const input = referenceAnnotatedInput(revision, document.revision)
  const proposal = await session.call('cad_propose_drawing_annotated', input)
  assert.equal(proposal.ok, true, JSON.stringify(proposal))
  assert.equal(document.listEntities().length, 0)
  const approval = await session.approve(proposal.value.planId, 'fixture-reviewer')
  assert.equal(approval.ok, true, JSON.stringify(approval))
  assert.equal(document.listEntities().length, 70)
  return { dxf: await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), expected: engineeringDrawingRequirements(revision) }
}

test('engineering annotated fixture independently passes actual ezdxf geometry, dimensions, notes and styled layers', async t => {
  try { runPython([validator, '--probe']) } catch (error) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') throw error
    t.skip('Configure KJDRAW_PYTHON/PYTHONPATH and KJDRAW_BENCH_INTEGRATION_REQUIRED=1 for mandatory ezdxf acceptance')
    return
  }
  for (const revision of ['A', 'B']) {
    const { dxf, expected } = await fixture(revision), result = validate(dxf, expected)
    assert.equal(result.passed, true, JSON.stringify(result))
    assert.equal(result.dimensionsChecked, 14)
    assert.equal(result.notesChecked, 16)
    assert.equal(result.auditErrors, 0)
    assert.equal(result.auditFixes, 0)
    if (revision === 'B') assert.equal(validate(dxf, engineeringDrawingRequirements('A')).passed, false)
  }
})

test('independent engineering validator rejects actual DXF mutations, including geometry-correct false dimension evidence', async t => {
  try { runPython([validator, '--probe']) } catch (error) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') throw error
    t.skip('Independent ezdxf dependency required')
    return
  }
  const { dxf, expected } = await fixture()
  assert.equal(validate(dxf, expected).passed, true, 'A passing unmodified baseline is required before mutation tests')
  const mutations = [
    "doc.header['$INSUNITS']=6",
    "doc.dxfversion='AC1015'",
    "next(iter(doc.modelspace().query('CIRCLE'))).dxf.radius=4",
    "next(iter(doc.modelspace().query('LINE'))).dxf.start=(0,0,100)",
    "next(iter(doc.modelspace().query('CIRCLE'))).dxf.extrusion=(0,1,0)",
    "next(iter(doc.modelspace().query('LWPOLYLINE'))).dxf.const_width=20",
    "next(iter(doc.modelspace().query('DIMENSION'))).dxf.text='180'",
    "next(iter(doc.modelspace().query('DIMENSION'))).dxf.actual_measurement=999",
    "next(e for e in doc.modelspace().query('DIMENSION') if e.dimtype==0).dxf.angle=45",
    "doc.modelspace().delete_entity(next(iter(doc.modelspace().query('DIMENSION'))))",
    "next(iter(doc.modelspace().query('TEXT'))).dxf.text='MISSING REQUIRED NOTE'",
    "doc.layers.get('HIDDEN').dxf.linetype='CONTINUOUS'",
    "doc.layers.get('CENTER').dxf.lineweight=35",
    "doc.header['$LTSCALE']=2",
    "next(iter(doc.modelspace().query('TEXT'))).dxf.width=10",
    "doc.blocks.new('UNREQUESTED').add_line((0,0),(1,1))",
    "doc.modelspace().add_line((1000,1000),(1001,1001))",
  ]
  for (const mutation of mutations) {
    const program = `import ezdxf,io,sys\ndoc=ezdxf.read(io.StringIO(sys.stdin.read()))\n${mutation}\nout=io.StringIO();doc.write(out);sys.stdout.write(out.getvalue())`
    const wrong = runPython(['-c', program], dxf)
    assert.equal(validate(wrong, expected).passed, false, mutation)
  }
})
