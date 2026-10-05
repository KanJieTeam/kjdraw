import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

const python = process.env.KJDRAW_PYTHON ?? 'python'
const validator = fileURLToPath(
  new URL('../scripts/benchmarks/dxf-untouched-validator.py', import.meta.url),
)
const schema = 'com.kanjie.kjdraw.benchmark.dxf-untouched@1'

const fixtureCode = String.raw`
import io,json,sys,ezdxf
def output(doc):
    stream=io.StringIO(newline='\n')
    doc.write(stream)
    return stream.getvalue()
doc=ezdxf.new('R2018')
doc.units=4
doc.layers.new('PROTECTED',dxfattribs={'color':3})
model=doc.modelspace()
target=model.add_line((0,0),(10,0))
circle=model.add_circle((50,50),5,dxfattribs={'layer':'PROTECTED'})
hatch=model.add_hatch(color=2)
hatch.paths.add_polyline_path([(70,70),(80,70),(80,80),(70,80)],is_closed=True)
before=output(doc)
circle_handle=circle.dxf.handle
mode=sys.argv[1]
if mode=='target':
    target.dxf.end=(15,0,0)
    model.add_circle((0,30),2)
elif mode=='circle': circle.dxf.radius=6
elif mode=='hatch': hatch.dxf.color=5
elif mode=='layer': doc.layers.get('PROTECTED').dxf.color=4
elif mode=='units': doc.units=6
elif mode=='churn':
    model.delete_entity(circle)
    model.add_circle((50,50),5,dxfattribs={'layer':'PROTECTED'})
print(json.dumps({'beforeDxf':before,'afterDxf':output(doc),'target':target.dxf.handle,'circle':circle_handle,'hatch':hatch.dxf.handle}))
`

function fixture(mode) {
  const result = spawnSync(python, ['-c', fixtureCode, mode], {
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `${result.error?.message ?? ''}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}

function validate(drawing, allowedChangedHandles = [], extra = {}) {
  const result = spawnSync(python, [validator], {
    input: JSON.stringify({
      schema,
      beforeDxf: drawing.beforeDxf,
      afterDxf: drawing.afterDxf,
      allowedChangedHandles,
      ...extra,
    }),
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.ok([0, 1].includes(result.status), `${result.error?.message ?? ''}\n${result.stderr}`)
  return { status: result.status, report: JSON.parse(result.stdout) }
}

test('independent ezdxf scorer permits only declared target changes and reports additions', () => {
  const drawing = fixture('target')
  const { status, report } = validate(drawing, [drawing.target])
  assert.equal(status, 0, JSON.stringify(report))
  assert.equal(report.passed, true)
  assert.deepEqual(report.modifiedHandles, [drawing.target])
  assert.ok(report.addedHandles.length > 0)
  assert.deepEqual(report.unexpectedModifiedHandles, [])
  assert.match(report.identityBoundary, /DXF handles only/u)
})

test('unlisted geometry, hatch, layer and unit changes fail without trusting a preview', () => {
  for (const mode of ['circle', 'hatch', 'layer', 'units', 'churn']) {
    const drawing = fixture(mode)
    const { status, report } = validate(drawing, [drawing.target])
    assert.equal(status, 1, mode)
    assert.equal(report.passed, false, mode)
    if (mode === 'units') assert.deepEqual(report.criticalHeaderChanges, ['$INSUNITS'])
    else if (mode === 'churn') assert.ok(report.unexpectedRemovedHandles.includes(drawing.circle))
    else assert.ok(report.unexpectedModifiedHandles.length > 0, mode)
  }
})

test('invalid allowlists and malformed DXF fail closed', () => {
  const drawing = fixture('target')
  assert.equal(validate(drawing, ['FFFFF']).report.passed, false)
  assert.equal(validate(drawing, [drawing.target, drawing.target]).report.passed, false)
  assert.equal(validate(drawing, [drawing.target], { afterDxf: 'not a DXF' }).report.passed, false)
})

test('independent preservation check accepts a real KJDraw target edit', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ units: 'millimeter' })
  const line = await sdk.executeCommand(
    'CREATE',
    { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } },
    { document },
  )
  await sdk.executeCommand(
    'CREATE',
    { type: 'CIRCLE', payload: { center: [30, 30], radius: 4 } },
    { document },
  )
  const beforeDxf = String(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }))
  await sdk.executeCommand('MOVE', { ids: [line.id], dx: 2, dy: 0 }, { document })
  const afterDxf = String(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }))
  const { status, report } = validate({ beforeDxf, afterDxf }, [document.getObject(line.id).handle])
  assert.equal(status, 0, JSON.stringify(report))
  assert.equal(report.passed, true)
})
