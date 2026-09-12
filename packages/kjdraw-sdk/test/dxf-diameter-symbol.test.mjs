import test from 'node:test'
import assert from 'node:assert/strict'
import {createKJDrawSDK} from '../src/sdk.js'
import {projectDimension} from '../src/geometry/annotation.js'
import {spawnSyncWithFileStdin} from '../../../scripts/spawn-file-stdin.mjs'
const definition={dimensionType:'DIAMETER',definitionPoints:[[0,0,0],[6,0,0]],textHeight:1.2}
const write=(sdk,document)=>sdk.writeDocument(document,{format:'DXF',version:'2018'})
function texts(dxf){const lines=String(dxf).trimEnd().split(/\r?\n/),result=[];let type;for(let i=0;i<lines.length;i+=2){if(Number(lines[i])===0)type=lines[i+1];else if(type==='TEXT'&&Number(lines[i])===1)result.push(lines[i+1])}return result}

test('native diameter pictures encode only automatic prefixes and preserve Canvas labels, custom text and undo/redo',async()=>{
 const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'}),ids=[]
 const labels=['⌀6','BORE ⌀6 / literal ⌀ / %%x','user ⌀ nominal'],encoded=['%%c6','BORE %%c6 / literal ⌀ / %%x','user ⌀ nominal']
 for(const textOverride of [null,'BORE <> / literal ⌀ / %%x','user ⌀ nominal'])ids.push((await sdk.executeCommand('CREATE',{type:'DIMENSION',payload:{...definition,textOverride}})).id)
 const before=document.serialize();assert.deepEqual(ids.map(id=>projectDimension(document.getObject(id).payload).label.text),labels)
 const output=await write(sdk,document);assert.deepEqual(texts(output),encoded);assert.equal(document.serialize(),before)
 const other=createKJDrawSDK(),reopened=await other.readDocument(output,{format:'DXF'})
 const dims=reopened.listEntities({type:'DIMENSION'});assert.deepEqual(dims.map(d=>projectDimension(d.payload).label.text),labels)
 assert.deepEqual(reopened.listEntities({type:'TEXT'}).map(t=>t.payload.text),['Ø6','BORE Ø6 / literal ⌀ / %%x','user ⌀ nominal'])
 const kjd=await other.writeDocument(reopened,{format:'KJD'}),saved=createKJDrawSDK(),restored=await saved.readDocument(kjd,{format:'KJD'})
 assert.deepEqual(texts(await write(saved,restored)).sort(),[...encoded].sort())
 const d=restored.listEntities({type:'DIMENSION'}).find(entity=>entity.payload.textOverride==null),points=d.payload.definitionPoints
 await saved.executeCommand('MOVE',{ids:[d.id],dx:1,dy:2});assert.notDeepEqual(restored.getObject(d.id).payload.definitionPoints,points)
 assert.ok(texts(await write(saved,restored)).includes('%%c6'));assert.equal(projectDimension(restored.getObject(d.id).payload).label.text,'⌀6')
 await saved.executeCommand('UNDO');assert.deepEqual(restored.getObject(d.id).payload.definitionPoints,points)
 await saved.executeCommand('REDO');assert.notDeepEqual(restored.getObject(d.id).payload.definitionPoints,points)
 assert.ok(texts(await write(saved,restored)).includes('%%c6'))
})

test('TEXT decodes only finite native symbol controls and retains unknown formatting and unchanged source encoding',async()=>{
 const sdk=createKJDrawSDK(),document=sdk.createDocument()
 const original='%%c %%C %%d %%D %%p %%P %%x \\P %%u underline %%u ⌀'
 await sdk.executeCommand('CREATE',{type:'TEXT',payload:{position:[0,0,0],height:2,text:original}})
 const output=await write(sdk,document);assert.deepEqual(texts(output),[original])
 const other=createKJDrawSDK(),reopened=await other.readDocument(output,{format:'DXF'}),entity=reopened.listEntities({type:'TEXT'})[0]
 assert.equal(entity.payload.text,'Ø Ø ° ° ± ± %%x \\P %%u underline %%u ⌀');assert.equal(entity.payload.dxfText,original)
 assert.deepEqual(texts(await write(other,reopened)),[original])
 await reopened.transact('Edit decoded text',tx=>tx.updateObject(entity.id,{payload:{text:'Literal Ø and ⌀'}}))
 assert.deepEqual(texts(await write(other,reopened)),['Literal Ø and ⌀'])
 await other.executeCommand('UNDO');assert.deepEqual(texts(await write(other,reopened)),[original])
 await other.executeCommand('REDO');assert.deepEqual(texts(await write(other,reopened)),['Literal Ø and ⌀'])
})

test('independent native default-font rendering resolves the generated diameter glyph, with exact measured value',async t=>{
 const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
 await sdk.executeCommand('CREATE',{type:'DIMENSION',payload:definition})
 const output=await write(sdk,document)
 const script=String.raw`
import sys,os,io,json,logging
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
from ezdxf.tools.text import plain_text
warnings=[]
class Capture(logging.Handler):
 def emit(self,r):warnings.append(r.getMessage())
logging.getLogger('ezdxf').addHandler(Capture());p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read();d=ezdxf.read(io.StringIO(source));e=list(d.modelspace().query('DIMENSION'))[0];labels=[x for x in e.virtual_entities() if x.dxftype()=='TEXT']
assert e.dimtype==3 and e.get_measurement()==6 and len(labels)==1 and labels[0].dxf.text=='%%c6'
assert plain_text(labels[0].dxf.text)=='Ø6'
result={'measurement':e.get_measurement(),'raw':labels[0].dxf.text,'plain':plain_text(labels[0].dxf.text)}
try:
 from ezdxf.addons.drawing import Frontend,RenderContext,svg,layout
 from ezdxf.fonts import fonts
 ctx=RenderContext(d);face=ctx.resolve_all(labels[0]).font;cmap=fonts.font_manager.get_ttf_font(face.filename).getBestCmap()
 assert all(ord(c) in cmap for c in plain_text(labels[0].dxf.text)),(face,cmap.get(216))
 backend=svg.SVGBackend();Frontend(ctx,backend).draw_layout(d.modelspace(),finalize=True);image=backend.get_string(layout.Page(100,50,margins=layout.Margins.all(5)))
 assert '<path' in image and '<image' not in image
 result['font']={'filename':face.filename,'family':face.family,'diameterGlyph':cmap[216]};result['vectorRendered']=True
 if os.environ.get('KJDRAW_FONT_INTEROP_OUTPUT'):
  from pathlib import Path
  Path(os.environ['KJDRAW_FONT_INTEROP_OUTPUT']).write_text(image,encoding='utf-8')
except ImportError as error:
 result['fontUnavailable']=str(error)
a=d.audit();assert not a.errors and not a.fixes;result['warnings']=warnings
print(json.dumps(result))
`
 const r=spawnSyncWithFileStdin(process.env.KJDRAW_FONT_PYTHON??process.env.KJDRAW_PYTHON??'python',['-c',script],String(output),{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8',...(process.env.KJDRAW_FONT_PYTHON?{PYTHONPATH:''}:{})}})
 if(r.error?.code==='ENOENT'||/No module named 'ezdxf'/.test(r.stderr)){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(r.stderr||r.error.message);t.skip('ezdxf required');return}
 assert.equal(r.status,0,r.stderr);const observed=JSON.parse(r.stdout);assert.equal(observed.measurement,6);assert.equal(observed.raw,'%%c6');assert.equal(observed.plain,'Ø6');assert.deepEqual(observed.warnings,[])
 if(process.env.KJDRAW_FONT_INTEROP_REQUIRED==='1')assert.equal(observed.vectorRendered,true,JSON.stringify(observed))
 if(observed.fontUnavailable)t.diagnostic(`Optional independent font renderer unavailable: ${observed.fontUnavailable}`)
})
