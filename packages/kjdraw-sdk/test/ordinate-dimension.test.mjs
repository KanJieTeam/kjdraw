import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../src/sdk.js'
import { projectDimension } from '../src/geometry/annotation.js'

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const dxfDimensionRecords = source => {
  const lines=source.split('\r\n'),records=[]
  for(let index=0;index+1<lines.length;index+=2){
    if(lines[index]!=='0'||lines[index+1]!=='DIMENSION')continue
    const record=['DIMENSION']
    for(let cursor=index+2;cursor+1<lines.length&&lines[cursor]!=='0';cursor+=2)record.push(lines[cursor],lines[cursor+1])
    records.push(record)
  }
  return records
}
const hasDxfTag = (record, code, value) => record.some((item, index) => index > 0 && index % 2 === 1 && item === String(code) && record[index + 1] === String(value))

test('native ordinate dimensions derive X and Y measurements from rotated definition axes', () => {
  const angle = Math.PI / 6, localX = [Math.cos(angle), Math.sin(angle)], localY = [-Math.sin(angle), Math.cos(angle)]
  const origin = [10, 20, 0]
  const xFeature = [origin[0] + localX[0] * 20, origin[1] + localX[1] * 20, 0]
  const xEnd = [xFeature[0] + localY[0] * 18, xFeature[1] + localY[1] * 18, 0]
  const yFeature = [origin[0] + localY[0] * 25, origin[1] + localY[1] * 25, 0]
  const yEnd = [yFeature[0] + localX[0] * 18, yFeature[1] + localX[1] * 18, 0]
  const x = projectDimension({ dimensionType: 'ORDINATE', dxfDimensionType: 70, definitionPoints: [origin, xFeature, xEnd], rotation: angle, textHeight: 2.5, arrowSize: 1 })
  const y = projectDimension({ dimensionType: 'ORDINATE', dxfDimensionType: 6, definitionPoints: [origin, yFeature, yEnd], rotation: angle, textHeight: 2.5, arrowSize: 1 })
  assert.ok(x && y)
  close(x.measurement, 20); close(y.measurement, 25)
  assert.equal(x.arrows.length, 0); assert.equal(y.arrows.length, 0)
  assert.equal(x.lines.length, 3); assert.equal(y.lines.length, 3)
  const zero = projectDimension({ dimensionType: 'ORDINATE', dxfDimensionType: 70, definitionPoints: [origin, origin, xEnd] })
  assert.ok(zero);assert.equal(zero.measurement,0);assert.equal(zero.label.text,'0');assert.equal(zero.lines.length,3)
  assert.equal(projectDimension({ dimensionType: 'ORDINATE', dxfDimensionType: 6, definitionPoints: [origin, yFeature, yFeature] }), null)
})

test('zero ordinate is a valid native datum label through KJD, DXF and official audit',async t=>{
  const payload={dimensionType:'ORDINATE',dxfDimensionType:70,definitionPoints:[[0,0,0],[0,0,0],[0,15,0]],textHeight:2.5,precision:2}
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'});await sdk.executeCommand('CREATE',{type:'DIMENSION',payload})
  // Validate each independent format artifact without coupling format evidence
  // to host scheduling or another adapter's completion.
  const kjd=await sdk.writeDocument(document,{format:'KJD'})
  const dxf=await sdk.writeDocument(document,{format:'DXF',version:'2018'})
  const rawDimensions=dxfDimensionRecords(dxf)
  assert.equal(rawDimensions.length,1,JSON.stringify({rawDimensions,source:document.listEntities({type:'DIMENSION'}),spaces:document.spaces}))
  assert.ok(hasDxfTag(rawDimensions[0],280,0)&&hasDxfTag(rawDimensions[0],71,5),JSON.stringify(rawDimensions[0]))
  for(const [format,source] of [['KJD',kjd],['DXF',dxf]]){
    const reopened=await createKJDrawSDK().readDocument(source,{format}),projection=projectDimension(reopened.listEntities({type:'DIMENSION'})[0].payload)
    assert.ok(projection);assert.equal(projection.measurement,0);assert.equal(projection.label.text,'0')
  }
  const script=String.raw`
import io,json,sys,ezdxf
d=ezdxf.read(io.StringIO(sys.stdin.read()));items=list(d.modelspace().query('DIMENSION'))
before_all=[{'handle':e.dxf.handle,'owner':e.dxf.owner,'paperspace':e.dxf.get('paperspace',0),'block':e.dxf.get('geometry','')} for e in d.entitydb.values() if e.dxftype()=='DIMENSION']
before_layouts={layout.name:[e.dxf.handle for e in layout.query('DIMENSION')] for layout in d.layouts};a=d.audit()
all_dims=[{'handle':e.dxf.handle,'owner':e.dxf.owner,'paperspace':e.dxf.get('paperspace',0),'block':e.dxf.get('geometry','')} for e in d.entitydb.values() if e.dxftype()=='DIMENSION']
layouts={layout.name:[e.dxf.handle for e in layout.query('DIMENSION')] for layout in d.layouts}
if not items: print(json.dumps({'errors':len(a.errors),'fixes':len(a.fixes),'beforeAll':before_all,'beforeLayouts':before_layouts,'all':all_dims,'layouts':layouts}));sys.exit(3)
e=items[0];print(json.dumps({'errors':len(a.errors),'fixes':len(a.fixes),'measurement':list(e.get_measurement()),'lines':sum(x.dxftype()=='LINE' for x in e.virtual_entities()),'all':all_dims,'layouts':layouts}))
`
  const native=spawnSync(process.env.KJDRAW_PYTHON||'python',['-c',script],{input:dxf,encoding:'utf8',timeout:30_000,env:{...process.env,PYTHONPATH:process.env.KJDRAW_EZDXF_PATH||process.env.PYTHONPATH||'',PYTHONIOENCODING:'utf-8'}})
  if(native.error?.code==='ENOENT'||/No module named ['"]ezdxf/u.test(native.stderr||'')){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(native.stderr||native.error?.message);t.skip('official ezdxf unavailable');return}
  assert.equal(native.status,0,[native.stderr,native.stdout].filter(Boolean).join('\n'));const report=JSON.parse(native.stdout);assert.deepEqual([report.errors,report.fixes],[0,0]);assert.equal(Math.hypot(...report.measurement),0);assert.equal(report.lines,3)
})

test('ordinate dimensions survive KJD and native DXF reopen with axis bit, rotation, picture block and measurement', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), angle = Math.PI / 6
  const localX = [Math.cos(angle), Math.sin(angle)], localY = [-Math.sin(angle), Math.cos(angle)], origin = [10, 20, 0]
  const payloads = [
    { dimensionType: 'ORDINATE', dxfDimensionType: 70, definitionPoints: [origin, [10 + localX[0] * 20, 20 + localX[1] * 20, 0], [10 + localX[0] * 20 + localY[0] * 18, 20 + localX[1] * 20 + localY[1] * 18, 0]], rotation: angle, textHeight: 2.5, precision: 3 },
    { dimensionType: 'ORDINATE', dxfDimensionType: 6, definitionPoints: [origin, [10 + localY[0] * 25, 20 + localY[1] * 25, 0], [10 + localY[0] * 25 + localX[0] * 18, 20 + localY[1] * 25 + localX[1] * 18, 0]], rotation: angle, textHeight: 2.5, precision: 3 },
  ]
  for (const payload of payloads) await sdk.executeCommand('CREATE', { type: 'DIMENSION', payload })
  const before = document.serialize()
  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const rawDimensions = dxfDimensionRecords(dxf)
  assert.equal(rawDimensions.length, 2, JSON.stringify({ rawDimensions, source: document.listEntities({ type: 'DIMENSION' }), spaces: document.spaces }))
  rawDimensions.forEach(record => assert.ok(hasDxfTag(record, 280, 0) && hasDxfTag(record, 71, 5), JSON.stringify(record)))
  assert.equal(document.serialize(), before)
  const reopenedKjd = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  const kjdMeasurements = new Map(reopenedKjd.listEntities({ type: 'DIMENSION' }).map(entity => [(entity.payload.dxfDimensionType & 64) ? 'x' : 'y', projectDimension(entity.payload).measurement]))
  assert.deepEqual(Object.fromEntries(kjdMeasurements), { x: 20, y: 25 })
  const reopenedDxf = await createKJDrawSDK().readDocument(dxf, { format: 'DXF', version: '2018' })
  const dimensions = reopenedDxf.listEntities({ type: 'DIMENSION' })
  assert.deepEqual(dimensions.map(entity => entity.payload.dxfDimensionType).sort((a, b) => a - b), [38, 102], JSON.stringify({ rawDimensions, reopened: reopenedDxf.listEntities().map(entity => ({ type: entity.type, ownerId: entity.ownerId, payload: entity.payload })), spaces: reopenedDxf.spaces }))
  const dxfMeasurements = new Map(dimensions.map(entity => [(entity.payload.dxfDimensionType & 64) ? 'x' : 'y', projectDimension(entity.payload).measurement]))
  close(dxfMeasurements.get('x'), 20); close(dxfMeasurements.get('y'), 25)
  dimensions.forEach(entity => close(entity.payload.rotation, angle))

  const script = String.raw`
import io,json,sys,ezdxf
d=ezdxf.read(io.StringIO(sys.stdin.read())); dims=[]
for e in d.modelspace().query('DIMENSION'):
    picture=list(e.virtual_entities())
    measurement=e.get_measurement()
    dims.append({'type':e.dxf.dimtype,'measurement':list(measurement),'horizontal':e.dxf.get('horizontal_direction',0),'lines':sum(x.dxftype()=='LINE' for x in picture),'texts':sum(x.dxftype() in ('TEXT','MTEXT') for x in picture)})
a=d.audit(); print(json.dumps({'dims':dims,'errors':len(a.errors),'fixes':len(a.fixes)}))
`
  const native = spawnSync(process.env.KJDRAW_PYTHON || 'python', ['-c', script], { input: dxf, encoding: 'utf8', timeout: 30_000, env: { ...process.env, PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (native.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(native.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(native.stderr || native.error?.message)
    t.skip('official ezdxf unavailable')
    return
  }
  assert.equal(native.status, 0, native.stderr)
  const report = JSON.parse(native.stdout)
  assert.deepEqual([report.errors, report.fixes], [0, 0])
  assert.deepEqual(report.dims.map(item => item.type).sort((a, b) => a - b), [38, 102])
  const nativeMeasurements = new Map(report.dims.map(item => [(item.type & 64) ? 'x' : 'y', Math.hypot(...item.measurement)]))
  close(nativeMeasurements.get('x'), 20); close(nativeMeasurements.get('y'), 25)
  report.dims.forEach(item => { close(item.horizontal, -30); assert.equal(item.lines, 3); assert.equal(item.texts, 1) })
})
