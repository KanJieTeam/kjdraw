import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK, KJDocument, KJValidationError } from '../src/index.js'
import { buildAgentCartesianChart, KJDRAW_CARTESIAN_CHART_VERSION } from '../src/agent-cartesian-chart.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

function practicalInput(overrides={}) {
  return {
    version: KJDRAW_CARTESIAN_CHART_VERSION,
    expectedRevision: 0,
    units: 'millimeter',
    drawingId: 'OPS-2026-Q3',
    title: 'MONTHLY OUTPUT AND TARGET',
    categories: ['APR', 'MAY', 'JUN', 'JUL'],
    series: [
      { id: 'output', name: 'Output', kind: 'bar', values: [82, 96, 91, 108], color: 3 },
      { id: 'target', name: 'Target', kind: 'line', values: [90, 90, 100, 100], color: 1 },
    ],
    origin: [20, 30], width: 420, height: 260, textHeight: 5,
    xLabel: 'MONTH', yLabel: 'UNITS', showValues: true,
    ...overrides,
  }
}

function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }

test('chart data labels preserve source precision independently of axis tick size', async () => {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'millimeter'})
  const input=practicalInput({series:[{id:'data',name:'Data',kind:'line',values:[82.5,96.125,91.75,108.0625]}],yAxis:{minimum:80,maximum:110,tick:5}})
  const result=buildAgentCartesianChart(document,input)
  const expected=input.series[0].values.map(String)
  for(const label of expected)assert.ok(result.commandArgs.entities.some(entity=>entity.type==='TEXT'&&entity.payload.text===label),label)
  const session=new KJAgentToolSession(sdk,document), proposal=value(await session.call('cad_propose_cartesian_chart',input))
  value(await session.approve(proposal.planId,'precision-reviewer'))
  for(const format of ['KJD','DXF']){
    const reopened=await sdk.readDocument(await sdk.writeDocument(document,{format}),{format})
    const labels=reopened.listEntities({type:'TEXT'}).map(entity=>entity.payload.text)
    for(const label of expected)assert.ok(labels.includes(label),`${format}: ${label}`)
  }
  const dxf=await sdk.writeDocument(document,{format:'DXF'})
  const independent=spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON||'python',['-c','import os,io,json,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"texts":[e.dxf.text for e in d.modelspace().query("TEXT")]}))'],dxf,{encoding:'utf8',windowsHide:true})
  assert.equal(independent.status,0,independent.stderr)
  const audit=JSON.parse(independent.stdout)
  assert.equal(audit.errors,0);assert.equal(audit.fixes,0)
  for(const label of expected)assert.ok(audit.texts.includes(label),`ezdxf: ${label}`)
})

test('fractional ticks and offset axes retain their actual numeric labels',()=>{
  for(const axis of [{minimum:0,maximum:10,tick:2.5},{minimum:0.125,maximum:4.125,tick:1}]){
    const document=KJDocument.create({units:'millimeter'})
    const input=practicalInput({categories:['A','B'],series:[{id:'data',name:'Data',kind:'line',values:[axis.minimum,axis.maximum]}],yAxis:axis,showValues:false})
    const result=buildAgentCartesianChart(document,input)
    const labels=result.commandArgs.entities.filter(entity=>entity.type==='TEXT').map(entity=>entity.payload.text)
    for(let i=0;i<=4;i++)assert.ok(labels.includes(String(axis.minimum+i*axis.tick)),JSON.stringify({axis,i,labels}))
  }
})

test('chart rejects invalid option types, colliding layer names and unusable tick intervals',()=>{
  const document=KJDocument.create({units:'millimeter'})
  assert.throws(()=>buildAgentCartesianChart(document,practicalInput({showValues:'true'})),/showValues.*boolean/)
  for(const id of ['axis','GRID','Text']){
    assert.throws(()=>buildAgentCartesianChart(document,practicalInput({series:[{id,name:'Data',kind:'line',values:[1,2,3,4]}]})),/reserved/)
  }
  assert.throws(()=>buildAgentCartesianChart(document,practicalInput({yAxis:{minimum:0,maximum:120,tick:200}})),/tick.*range/)
})

test('Cartesian compiler deterministically expands mixed data intent into editable native chart geometry', () => {
  const document=KJDocument.create({documentId:'chart-compile',units:'millimeter'})
  const first=buildAgentCartesianChart(document,practicalInput()), second=buildAgentCartesianChart(document,practicalInput())
  assert.deepEqual(first,second)
  assert.equal(first.evidence.skillId,'cartesian-chart')
  assert.equal(first.evidence.skillVersion,'1.0.0')
  assert.equal(first.evidence.parameters.categoryCount,4)
  assert.deepEqual(first.evidence.bounds,{min:[20,30],max:[440,290],width:420,height:260})
  assert.equal(first.evidence.entityCount,first.commandArgs.entities.length)
  assert.ok(first.evidence.entityCount<=512)
  assert.ok(first.evidence.parameters.yAxis.minimum<=0)
  assert.ok(first.evidence.parameters.yAxis.maximum>=108)
  assert.equal(new Set(first.commandArgs.entities.map(entity=>entity.options.id)).size,first.evidence.entityCount)
  assert.deepEqual(first.commandArgs.resources.layers.map(layer=>layer.name),['CHART_AXIS','CHART_GRID','CHART_TEXT','CHART_OUTPUT','CHART_TARGET'])
  const byLayer=Object.fromEntries(first.commandArgs.resources.layers.map(layer=>[layer.name,layer.id]))
  assert.equal(first.commandArgs.entities.filter(entity=>entity.type==='LWPOLYLINE'&&entity.payload.layerId===byLayer.CHART_OUTPUT).length,5,'four bars plus legend swatch')
  assert.equal(first.commandArgs.entities.filter(entity=>entity.type==='LWPOLYLINE'&&entity.payload.layerId===byLayer.CHART_TARGET).length,1,'line series is one editable polyline')
  assert.equal(first.commandArgs.entities.filter(entity=>entity.type==='CIRCLE'&&entity.payload.layerId===byLayer.CHART_TARGET).length,4)
  assert.ok(first.commandArgs.entities.some(entity=>entity.type==='TEXT'&&entity.payload.text==='MONTHLY OUTPUT AND TARGET'))
  assert.ok(first.commandArgs.entities.some(entity=>entity.type==='TEXT'&&entity.payload.text==='108'))
})

test('Cartesian chart proposal is atomic, verifiable, undoable and survives KJD and DXF reopen', async () => {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({documentId:'chart-roundtrip',units:'millimeter'}), session=new KJAgentToolSession(sdk,document)
  const proposal=value(await session.call('cad_propose_cartesian_chart',practicalInput()))
  assert.equal(document.revision,0)
  assert.equal(document.listEntities().length,0)
  assert.equal(proposal.command,'CREATEBATCH')
  assert.equal(proposal.engineeringEvidence.skillVersion,'1.0.0')
  assert.equal(proposal.preview.after.length,proposal.engineeringEvidence.entityCount)

  const lineSeries=proposal.arguments.entities.find(entity=>entity.type==='LWPOLYLINE'&&entity.payload.layerId.endsWith('layer-series-2'))
  assert.ok(lineSeries)
  value(await session.approve(proposal.planId,'chart-reviewer'))
  assert.equal(document.revision,1)
  assert.equal(document.listEntities().length,proposal.engineeringEvidence.entityCount)
  const checked=value(await session.call('cad_check_geometry',{expectedRevision:1,units:'millimeter',lineLengths:[],circleRadii:[],pointDistances:[],polylineClosures:[{id:'target-open',objectId:lineSeries.options.id,expected:false}],polylineVertexCounts:[{id:'target-points',objectId:lineSeries.options.id,expected:4}]}))
  assert.equal(checked.passed,true)

  await sdk.executeCommand('UNDO',{}, {document})
  assert.equal(document.listEntities().length,0)
  assert.equal(document.getTable('layers').records.some(layer=>layer.name==='CHART_TARGET'),false)
  await sdk.executeCommand('REDO',{}, {document})
  assert.equal(document.listEntities().length,proposal.engineeringEvidence.entityCount)

  for(const format of ['KJD','DXF']){
    const reopened=await sdk.readDocument(await sdk.writeDocument(document,{format}),{format})
    assert.equal(reopened.listEntities().length,proposal.engineeringEvidence.entityCount)
    assert.equal(reopened.listEntities({type:'PROXY_ENTITY'}).length,0)
    assert.equal(reopened.getTable('layers').records.some(layer=>layer.name==='CHART_TARGET'),true)
  }
})

test('Cartesian compiler rejects stale, nonblank, malformed, excessive and inconsistent data before proposal', async () => {
  const document=KJDocument.create({documentId:'chart-invalid',units:'millimeter'})
  const rejects=(patch,pattern)=>assert.throws(()=>buildAgentCartesianChart(document,practicalInput(patch)),error=>error instanceof KJValidationError&&pattern.test(error.message))
  rejects({version:'2.0.0'},/version/)
  rejects({expectedRevision:1},/does not match document revision/)
  rejects({units:'meter'},/units/)
  rejects({surprise:true},/unsupported field/)
  rejects({categories:['ONLY']},/2-32/)
  rejects({series:[{id:'bad id',name:'Bad',kind:'line',values:[1,2,3,4]}]},/letters, numbers/)
  rejects({series:[{id:'a',name:'A',kind:'pie',values:[1,2,3,4]}]},/line or bar/)
  rejects({series:[{id:'a',name:'A',kind:'line',values:[1,2]}]},/match categories/)
  rejects({series:Array.from({length:6},(_,index)=>({id:`s${index}`,name:`S${index}`,kind:'line',values:Array(32).fill(index)})),categories:Array.from({length:32},(_,index)=>`C${index}`)},/160 data values/)
  rejects({yAxis:{minimum:0,maximum:50,tick:5}},/contain every data value/)
  rejects({yAxis:{minimum:80,maximum:120,tick:5}},/contain zero/)
  rejects({yAxis:{minimum:0,maximum:120,tick:1}},/12 tick intervals/)

  const sdk=createKJDrawSDK(), nonblank=sdk.createDocument({documentId:'chart-nonblank',units:'millimeter'})
  await nonblank.transact('existing geometry',tx=>tx.createEntity('LINE',{start:[0,0,0],end:[1,1,0]}))
  assert.throws(()=>buildAgentCartesianChart(nonblank,practicalInput({expectedRevision:nonblank.revision})),/blank document/)
  const meter=KJDocument.create({documentId:'chart-meter',units:'meter'})
  assert.throws(()=>buildAgentCartesianChart(meter,practicalInput()),/millimeter document/)
})
