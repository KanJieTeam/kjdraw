import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

const python = process.env.KJDRAW_PYTHON ?? 'python'
const validator = fileURLToPath(
  new URL('../scripts/benchmarks/dxf-reference-scorer.py', import.meta.url),
)
const schema = 'com.kanjie.kjdraw.benchmark.dxf-reference@1'

const fixtureCode = String.raw`
import io,json,sys,ezdxf
def output(doc):
    stream=io.StringIO(newline='\n')
    doc.write(stream)
    return stream.getvalue()
def drawing(reverse=False):
    doc=ezdxf.new('R2018')
    doc.units=4
    doc.layers.new('SURVEY',dxfattribs={'color':3})
    m=doc.modelspace()
    def line(): m.add_line((0,0),(10,0),dxfattribs={'layer':'SURVEY'})
    def circle(): m.add_circle((20,20),5,dxfattribs={'layer':'SURVEY'})
    if reverse: circle();line()
    else: line();circle()
    h=m.add_hatch(color=2,dxfattribs={'layer':'SURVEY'})
    h.paths.add_polyline_path([(30,30),(40,30),(40,40),(30,40)],is_closed=True)
    return doc
expected=drawing()
actual=drawing(True)
mode=sys.argv[1]
if mode=='line': next(e for e in actual.modelspace() if e.dxftype()=='LINE').dxf.end=(11,0,0)
elif mode=='hatch': next(e for e in actual.modelspace() if e.dxftype()=='HATCH').dxf.color=4
elif mode=='extra': actual.modelspace().add_circle((50,50),2)
elif mode=='layer': actual.layers.get('SURVEY').dxf.color=5
elif mode=='units': actual.units=6
elif mode=='unsupported': actual.modelspace().add_blockref('UNKNOWN',(0,0))
elif mode=='block':
    block=actual.blocks.new('UNSCORED')
    block.add_line((0,0),(2,0))
elif mode=='spoofed-layout-block':
    block=actual.blocks.new('*PAPER_SPACE_FAKE')
    block.add_line((0,0),(2,0))
elif mode=='paperspace': actual.layout().add_circle((5,5),2)
elif mode=='many':
    for i in range(600):
        expected.modelspace().add_line((100+i,0),(100+i,10))
        actual.modelspace().add_line((100+i,0),(100+i,10))
print(json.dumps({'expectedDxf':output(expected),'actualDxf':output(actual)}))
`

function fixture(mode) {
  const child = spawnSync(python, ['-c', fixtureCode, mode], {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(child.status, 0, `${child.error?.message ?? ''}\n${child.stderr}`)
  return JSON.parse(child.stdout)
}

function score(drawing, extra = {}) {
  const child = spawnSync(python, [validator], {
    input: JSON.stringify({ schema, ...drawing, ...extra }),
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.ok([0, 1].includes(child.status), `${child.error?.message ?? ''}\n${child.stderr}`)
  return { status: child.status, report: JSON.parse(child.stdout) }
}

test('independent reference comparison ignores entity order and handle allocation', () => {
  const { status, report } = score(fixture('same'))
  assert.equal(status, 0, JSON.stringify(report))
  assert.equal(report.passed, true)
  assert.equal(report.matchedEntities, 3)
  assert.deepEqual(report.entityMismatches, [])
})

test('geometry, hatch, additions, layer styling and units must match reference', () => {
  for (const mode of ['line', 'hatch', 'extra', 'layer', 'units']) {
    const { status, report } = score(fixture(mode))
    assert.equal(status, 1, mode)
    assert.equal(report.passed, false, mode)
    if (mode === 'layer') assert.deepEqual(report.layerMismatches, ['SURVEY'])
    else if (mode === 'units') assert.deepEqual(report.criticalHeaderChanges, ['$INSUNITS'])
    else assert.ok(report.entityMismatches.length > 0, mode)
  }
})

test('unscored entity types and malformed inputs fail closed', () => {
  assert.equal(score(fixture('unsupported')).report.error, 'ValueError')
  assert.equal(score(fixture('block')).report.error, 'ValueError')
  assert.equal(score(fixture('spoofed-layout-block')).report.error, 'ValueError')
  assert.equal(score(fixture('paperspace')).report.error, 'ValueError')
  assert.equal(score(fixture('same'), { actualDxf: 'not a DXF' }).report.passed, false)
  assert.equal(score(fixture('same'), { tolerance: 0.5 }).report.passed, false)
})

test('hundreds of repeated supported entities use exact multiset matching', () => {
  const { status, report } = score(fixture('many'))
  assert.equal(status, 0, JSON.stringify(report))
  assert.equal(report.matchedEntities, 603)
})

test('real KJDraw DXF exports compare independently across creation order', async () => {
  const sdk = createKJDrawSDK()
  const expected = sdk.createDocument({ units: 'millimeter' })
  const actual = sdk.createDocument({ units: 'millimeter' })
  const line = { type: 'LINE', payload: { start: [0, 0], end: [30, 0] } }
  const circle = { type: 'CIRCLE', payload: { center: [15, 15], radius: 5 } }
  for (const entity of [line, circle])
    await sdk.executeCommand('CREATE', entity, { document: expected })
  for (const entity of [circle, line])
    await sdk.executeCommand('CREATE', entity, { document: actual })
  const { status, report } = score({
    expectedDxf: String(await sdk.writeDocument(expected, { format: 'DXF', version: '2018' })),
    actualDxf: String(await sdk.writeDocument(actual, { format: 'DXF', version: '2018' })),
  })
  assert.equal(status, 0, JSON.stringify(report))
  assert.equal(report.matchedEntities, 2)
})
