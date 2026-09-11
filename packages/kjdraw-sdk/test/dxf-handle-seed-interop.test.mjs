import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createKJDrawSDK} from '../src/sdk.js'

function records(text){
 const lines=String(text).trimEnd().split(/\r?\n/),result=[];let record
 for(let i=0;i<lines.length;i+=2){const code=Number(lines[i]),value=lines[i+1];if(code===0){record={type:value,tags:[]};result.push(record)}else record?.tags.push([code,value])}
 return result
}
async function fixture(){
 const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
 await document.transact('nested native dimension blocks',tx=>{
  const inner=tx.upsertTableRecord('blockRecords',{name:'Motor',payload:{basePoint:[2,1,0],entityIds:[]}})
  tx.createEntity('LINE',{start:[0,0,0],end:[10,0,0]},{ownerId:inner.id})
  tx.createEntity('DIMENSION',{dimensionType:'ALIGNED',definitionPoints:[[0,3,0],[0,0,0],[10,0,0]],textHeight:1.2},{ownerId:inner.id})
  const outer=tx.upsertTableRecord('blockRecords',{name:'Assembly',payload:{basePoint:[4,3,0],entityIds:[]}})
  tx.createEntity('INSERT',{blockRecordId:inner.id,position:[20,10,0],scale:[1.25,1.25,1],rotation:.3},{ownerId:outer.id})
  for(let i=0;i<3;i++)tx.createEntity('INSERT',{blockRecordId:outer.id,position:[i*50,0,0],scale:[2,2,2]})
 })
 return {sdk,document}
}

test('DXF HANDSEED reserves all emitted handles, including generated dimensions and late layout objects',async()=>{
 const {sdk,document}=await fixture(),before=document.serialize()
 for(const version of ['2000','2018','2024']){
  const output=String(await sdk.writeDocument(document,{format:'DXF',version})),all=records(output),header=all[0].tags
  const index=header.findIndex(([code,value])=>code===9&&value==='$HANDSEED');assert.ok(index>=0)
  assert.equal(header[index+1][0],5);const seed=BigInt('0x'+header[index+1][1]),handles=new Set()
  for(const entity of all.slice(1))for(const [code,value]of entity.tags)if(code===5||entity.type==='DIMSTYLE'&&code===105){assert.ok(!handles.has(value),`Duplicate ${value}`);handles.add(value);assert.ok(seed>BigInt('0x'+value),`${seed} must exceed ${entity.type} #${value}`)}
  const reopened=await createKJDrawSDK().readDocument(output,{format:'DXF'});assert.equal(reopened.listEntities({type:'INSERT'}).length,4);assert.equal(reopened.listEntities({type:'DIMENSION'}).length,1)
 }
 assert.equal(document.serialize(),before)
})

test('independent DXF load never overwrites an implicit INSERT SEQEND with a later LAYOUT',async t=>{
 const {sdk,document}=await fixture(),output=String(await sdk.writeDocument(document,{format:'DXF',version:'2018'}))
 const result=spawnSync(process.env.KJDRAW_PYTHON??'python',['-c',String.raw`
import io,json,sys,logging,re,ezdxf
source=sys.stdin.read();events=[]
class Capture(logging.Handler):
 def emit(self,record):
  if 'non-unique entity handle' in record.getMessage():events.append(record.getMessage())
handler=Capture();logger=logging.getLogger('ezdxf');logger.addHandler(handler)
def load(text):
 events.clear();d=ezdxf.read(io.StringIO(text));warnings=list(events)
 inserts=list(d.query('INSERT'));identities=[d.entitydb.get(e.seqend.dxf.handle) is e.seqend for e in inserts]
 a=d.audit();assert not a.errors and not a.fixes
 return d,{'warnings':warnings,'seqendIdentities':identities,'inserts':len(inserts),'dimensions':len(d.query('DIMENSION'))}
# The old writer omitted HANDSEED. Prove that a zero audit is insufficient:
# the reader allocates a low SEQEND before loading the later LAYOUT record.
old,broken=load(re.sub(r'9\r?\n\$HANDSEED\r?\n5\r?\n[^\r\n]+\r?\n','',source))
d,fixed=load(source)
original={h:id(e) for h,e in d.entitydb.items()};created=d.modelspace().add_line((0,0),(1,1));assert created.dxf.handle not in original
assert all(id(d.entitydb[h])==identity for h,identity in original.items())
print(json.dumps({'old':broken,'fixed':fixed,'newHandle':created.dxf.handle}))
`],{input:output,encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}})
 if(result.error?.code==='ENOENT'||/No module named 'ezdxf'/.test(result.stderr)){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(result.stderr||result.error.message);t.skip('ezdxf required');return}
 assert.equal(result.status,0,result.stderr);const observed=JSON.parse(result.stdout)
 assert.ok(observed.old.warnings.length>0,JSON.stringify(observed));assert.ok(observed.old.seqendIdentities.includes(false),JSON.stringify(observed))
 assert.deepEqual(observed.fixed.warnings,[]);assert.equal(observed.fixed.inserts,4);assert.equal(observed.fixed.dimensions,1);assert.ok(observed.fixed.seqendIdentities.every(Boolean))
})
