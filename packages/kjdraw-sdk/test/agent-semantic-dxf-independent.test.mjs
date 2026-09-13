import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { createKJDrawSDK } from '../src/sdk.js'
import { buildAgentArchitecturePlan } from '../src/agent-architecture-plan.js'
import { buildAgentSitePlan } from '../src/agent-site-plan.js'

const python=process.env.KJDRAW_PYTHON||'python'
const validator=`import io,json,os,ezdxf
s=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read();d=ezdxf.read(io.StringIO(s));a=d.audit();m=d.modelspace()
names=[e.dxf.name for e in m.query('INSERT')];layers={e.dxf.layer for e in m};blocks={b.name:len(list(b)) for b in d.blocks if b.name.startswith('KJ_ARCH_')}
layouts=[]
for layout in d.layouts:
 if layout.name.startswith('KJ_'):
  viewports=list(layout.query('VIEWPORT'))
  layouts.append({'name':layout.name,'paperWidth':layout.dxf_layout.dxf.paper_width,'paperHeight':layout.dxf_layout.dxf.paper_height,'paperUnits':layout.dxf_layout.dxf.plot_paper_units,'plotType':layout.dxf_layout.dxf.plot_type,'viewports':[{'paper':v.dxf.paperspace,'height':v.dxf.height,'viewHeight':v.dxf.view_height,'ratio':v.dxf.height/v.dxf.view_height} for v in viewports]})
print(json.dumps({'version':ezdxf.__version__,'units':d.units,'errors':len(a.errors),'fixes':len(a.fixes),'entities':len(m),'insertNames':names,'blocks':blocks,'layers':sorted(layers),'dimensions':len(m.query('DIMENSION')),'circles':len(m.query('CIRCLE')),'layouts':layouts}))`

function inspectDxf(dxf){
  const result=spawnSyncWithFileStdin(python,['-c',validator],dxf,{encoding:'utf8',env:{...process.env,PYTHONPATH:process.env.KJDRAW_EZDXF_PATH||process.env.PYTHONPATH||''}})
  if(result.error?.code==='ENOENT'||/No module named ['"]ezdxf/.test(result.stderr||''))return null
  assert.equal(result.status,0,result.stderr)
  return JSON.parse(result.stdout)
}

test('official ezdxf independently reads architectural semantic blocks and dimensions',async t=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
  const compiled=buildAgentArchitecturePlan(document,{version:'1.0.0',expectedRevision:0,units:'millimeter',drawingId:'ARCH-INDEPENDENT',title:'OFFICE FLOOR PLAN',width:10000,depth:8000,wallThickness:200,
    exteriorOpenings:[{wall:'south',offset:1200,width:900,kind:'door'},{wall:'north',offset:3000,width:1500,kind:'window'}],
    partitions:[{id:'P1',axis:'vertical',position:5000,start:200,end:7800,openings:[{offset:3100,width:900,kind:'door'}]}],
    rooms:[{id:'R1',name:'MEETING',bounds:[200,200,4700,7600]},{id:'R2',name:'STUDIO',bounds:[5100,200,4700,7600]}]})
  await sdk.executeCommand('CREATEBATCH',compiled.commandArgs,{document})
  const report=inspectDxf(await sdk.writeDocument(document,{format:'DXF',version:'2018'}))
  if(!report)return t.skip('official ezdxf is unavailable')
  assert.equal(report.units,4);assert.equal(report.errors,0);assert.equal(report.fixes,0)
  assert.deepEqual(report.blocks,{KJ_ARCH_DOOR_900:2,KJ_ARCH_WINDOW_1500:3})
  assert.equal(report.insertNames.filter(name=>name==='KJ_ARCH_DOOR_900').length,2)
  assert.equal(report.insertNames.filter(name=>name==='KJ_ARCH_WINDOW_1500').length,1)
  assert.equal(report.dimensions,2)
  assert.equal(report.layouts.length,1);assert.match(report.layouts[0].name,/^KJ_ARCH_/)
  assert.deepEqual([report.layouts[0].paperWidth,report.layouts[0].paperHeight,report.layouts[0].paperUnits,report.layouts[0].plotType],[420,297,1,5])
  assert.equal(report.layouts[0].viewports.length,1);assert.equal(report.layouts[0].viewports[0].paper,1)
  assert.ok(Math.abs(report.layouts[0].viewports[0].ratio-0.01)<1e-12)
})

test('official ezdxf independently reads site layers, utilities and dimensions',async t=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'meter'})
  const compiled=buildAgentSitePlan(document,{version:'1.0.0',expectedRevision:0,units:'meter',drawingId:'SITE-INDEPENDENT',title:'CAMPUS GENERAL SITE PLAN',revision:'A',
    boundary:[[1000,2000],[1260,2000],[1270,2120],[1220,2220],[1000,2200]],roads:[{name:'MAIN ROAD',width:8,centerline:[[990,2020],[1080,2020],[1160,2060],[1280,2060]]}],
    buildings:[{name:'ADMIN',floors:4,footprint:[[1025,2040],[1080,2040],[1080,2080],[1025,2080]]}],
    utilities:[{kind:'water',name:'WATER',diameterMm:200,path:[[1005,2028],[1090,2028],[1240,2070]],nodeIndices:[0,1,2]},{kind:'drainage',name:'STORM',diameterMm:600,path:[[1010,2190],[1080,2160],[1250,2120]],nodeIndices:[0,1,2]}],
    coordinateReference:{position:[1010,2010],easting:385000.125,northing:3452000.75,crs:'EPSG:32650'},northAngleDegrees:-8,scale:500})
  await sdk.executeCommand('CREATEBATCH',compiled.commandArgs,{document})
  const report=inspectDxf(await sdk.writeDocument(document,{format:'DXF',version:'2018'}))
  if(!report)return t.skip('official ezdxf is unavailable')
  assert.equal(report.units,6);assert.equal(report.errors,0);assert.equal(report.fixes,0)
  for(const layer of ['SITE_BOUNDARY','ROAD_EDGE','ROAD_CENTER','BUILDING','WATER','DRAINAGE','UTILITY_NODE','DIMENSIONS'])assert.ok(report.layers.includes(layer),layer)
  assert.equal(report.circles,6);assert.equal(report.dimensions,2)
  assert.equal(report.layouts.length,1);assert.match(report.layouts[0].name,/^KJ_SITE_/)
  assert.deepEqual([report.layouts[0].paperWidth,report.layouts[0].paperHeight,report.layouts[0].paperUnits,report.layouts[0].plotType],[841,594,1,5])
  assert.equal(report.layouts[0].viewports.length,1);assert.equal(report.layouts[0].viewports[0].paper,1)
  assert.ok(Math.abs(report.layouts[0].viewports[0].ratio-2)<1e-12)
})
