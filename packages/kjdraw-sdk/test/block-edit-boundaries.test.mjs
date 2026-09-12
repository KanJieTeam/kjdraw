import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

async function fixture() {
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'block-edit-boundaries',units:'millimeter'})
  await document.transact('nested attributed blocks',tx=>{
    const target=tx.upsertTableRecord('layers',{id:'target-layer',name:'TARGET',payload:{visible:true}})
    const locked=tx.upsertTableRecord('layers',{id:'locked-layer',name:'LOCKED',payload:{visible:true,locked:true}})
    const inner=tx.upsertTableRecord('blockRecords',{id:'inner-block',name:'INNER',payload:{entityIds:[],isSpace:false,basePoint:[0,0,0]}})
    tx.createEntity('LINE',{start:[0,0,0],end:[10,0,0]},{id:'inner-line',ownerId:inner.id})
    const outer=tx.upsertTableRecord('blockRecords',{id:'outer-block',name:'OUTER',payload:{entityIds:[],isSpace:false,basePoint:[0,0,0]}})
    tx.createEntity('INSERT',{blockRecordId:inner.id,position:[2,3,0],scale:[1,1,1],rotation:0},{id:'nested-insert',ownerId:outer.id})
    tx.createEntity('CIRCLE',{center:[5,5,0],radius:2},{id:'outer-circle',ownerId:outer.id})
    for(const [id,x] of [['instance-a',20],['instance-b',60]])tx.createEntity('INSERT',{blockRecordId:outer.id,position:[x,30,0],scale:[1,1,1],rotation:0,attributes:{}},{id})
    tx.createEntity('ATTRIB',{parentInsertId:'instance-a',position:[20,25,0],text:'A-001',tag:'MARK',height:2.5},{id:'instance-a-mark'})
    tx.createObject({id:'instance-a-end',kind:'custom',type:'SEQEND',ownerId:'instance-a',payload:{dxfOwnerMode:'insert'}})
    tx.updateObject('instance-a',{payload:{attributeIds:['instance-a-mark'],sequenceEndId:'instance-a-end'}})
    void target;void locked
  })
  return {sdk,document}
}

const json=value=>JSON.parse(JSON.stringify(value))
const objectSet=document=>json(Object.fromEntries(document.listObjects({includeErased:true}).map(item=>[item.id,item])))

test('instance updates preserve its definition and other instances, including native attributes and history',async()=>{
  const {sdk,document}=await fixture(),before=objectSet(document),revision=document.revision
  const changed=await sdk.executeCommand('BLOCKINSTANCEUPDATE',{id:'instance-a',patch:{payload:{layerId:'target-layer'}},attributeValues:{mark:'A-009'}},{document})
  assert.equal(document.revision,revision+1)
  assert.equal(changed.instance.id,'instance-a');assert.equal(changed.attributes[0].id,'instance-a-mark')
  assert.equal(document.getObject('instance-a').payload.layerId,'target-layer')
  assert.equal(document.getObject('instance-a-mark').payload.text,'A-009')
  assert.deepEqual(json(document.getObject('instance-b')),before['instance-b'])
  for(const id of ['outer-block','inner-block','inner-line','nested-insert','outer-circle'])assert.deepEqual(json(document.getObject(id)),before[id])
  await sdk.executeCommand('UNDO',{}, {document});assert.deepEqual(objectSet(document),before)
  await sdk.executeCommand('REDO',{}, {document});assert.equal(document.getObject('instance-a-mark').payload.text,'A-009')
  const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format:'KJD'}),{format:'KJD'})
  assert.deepEqual(objectSet(reopened),objectSet(document))
})

test('definition updates mutate the explicit member once and preserve every instance payload and attribute association',async()=>{
  const {sdk,document}=await fixture(),instances=['instance-a','instance-b'].map(id=>json(document.getObject(id))),attribute=json(document.getObject('instance-a-mark'))
  const result=await sdk.executeCommand('BLOCKDEFINITIONUPDATE',{blockRecordId:'inner-block',id:'inner-line',patch:{payload:{end:[18,0,0],color:3}}},{document})
  assert.equal(result.block.id,'inner-block');assert.deepEqual(result.entity.payload.end,[18,0,0])
  assert.deepEqual(instances,['instance-a','instance-b'].map(id=>json(document.getObject(id))))
  assert.deepEqual(json(document.getObject('instance-a-mark')),attribute)
  assert.equal(document.getObject('nested-insert').payload.blockRecordId,'inner-block')
  await sdk.executeCommand('UNDO',{}, {document});assert.deepEqual(document.getObject('inner-line').payload.end,[10,0,0])
  await sdk.executeCommand('REDO',{}, {document});assert.deepEqual(document.getObject('inner-line').payload.end,[18,0,0])
  const dxf=await sdk.writeDocument(document,{format:'DXF',version:'2018'})
  const reopened=await createKJDrawSDK().readDocument(dxf,{format:'DXF'})
  const inner=reopened.getTable('blockRecords').records.find(item=>item.name==='INNER')
  const outer=reopened.getTable('blockRecords').records.find(item=>item.name==='OUTER')
  const line=reopened.listEntities({ownerId:inner.id,type:'LINE'})[0],nested=reopened.listEntities({ownerId:outer.id,type:'INSERT'})[0]
  assert.deepEqual(line.payload.end,[18,0,0]);assert.equal(nested.payload.blockRecordId,inner.id)
  const root=reopened.listEntities({type:'INSERT'}).filter(item=>item.ownerId===reopened.snapshot().spaces.modelSpaceId)
  assert.equal(root.length,2)
  const attributed=root.find(item=>item.payload.attributeIds?.length)
  assert.equal(reopened.getObject(attributed.payload.attributeIds[0]).payload.text,'A-001')
  assert.equal(reopened.validate().valid,true)
})

test('explicit boundaries and protected layers reject atomically without losing links',async()=>{
  for(const mutate of [
    (sdk,document)=>sdk.executeCommand('PROPERTIES',{id:'inner-line',patch:{payload:{color:2}}},{document}),
    (sdk,document)=>sdk.executeCommand('PROPERTIES',{id:'instance-b',patch:{payload:{blockRecordId:'inner-block'}}},{document}),
    (sdk,document)=>sdk.executeCommand('BLOCKINSTANCEUPDATE',{id:'instance-b',patch:{payload:{blockRecordId:'inner-block'}}},{document}),
    (sdk,document)=>sdk.executeCommand('BLOCKINSTANCEUPDATE',{id:'nested-insert',patch:{payload:{position:[7,8,0]}}},{document}),
    (sdk,document)=>sdk.executeCommand('BLOCKDEFINITIONUPDATE',{blockRecordId:'inner-block',id:'outer-circle',patch:{payload:{radius:4}}},{document}),
    (sdk,document)=>sdk.executeCommand('BLOCKDEFINITIONUPDATE',{blockRecordId:'outer-block',id:'nested-insert',patch:{payload:{blockRecordId:'outer-block'}}},{document}),
    (sdk,document)=>sdk.executeCommand('BLOCKINSTANCEUPDATE',{id:'instance-a',patch:{payload:{position:[99,99,0]}},attributeValues:{MARK:'must roll back'}},{document}),
  ]){
    const {sdk,document}=await fixture(),before=document.serialize()
    await assert.rejects(mutate(sdk,document))
    assert.equal(document.serialize(),before)
  }
  {
    const {sdk,document}=await fixture()
    await document.transact('protect definition member',tx=>tx.updateObject('inner-line',{payload:{layerId:'locked-layer'}}))
    const before=document.serialize()
    await assert.rejects(sdk.executeCommand('BLOCKDEFINITIONUPDATE',{blockRecordId:'inner-block',id:'inner-line',patch:{payload:{color:4}}},{document}),/locked/)
    assert.equal(document.serialize(),before)
  }
  {
    const {sdk,document}=await fixture()
    await document.transact('protect attached value',tx=>tx.updateObject('instance-a-mark',{payload:{layerId:'locked-layer'}}))
    const before=document.serialize()
    await assert.rejects(sdk.executeCommand('BLOCKINSTANCEUPDATE',{id:'instance-a',attributeValues:{MARK:'blocked'}},{document}),/locked/)
    assert.equal(document.serialize(),before)
  }
})

test('independent ezdxf audits nested and attributed output after separate instance and definition edits',async t=>{
  const {sdk,document}=await fixture()
  await sdk.executeCommand('BLOCKINSTANCEUPDATE',{id:'instance-a',attributeValues:{MARK:'A-777'}},{document})
  await sdk.executeCommand('BLOCKDEFINITIONUPDATE',{blockRecordId:'inner-block',id:'inner-line',patch:{payload:{end:[18,0,0]}}},{document})
  const source=await sdk.writeDocument(document,{format:'DXF',version:'2018'})
  const script=String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source))
assert set(d.blocks.block_names()) >= {'inner','outer'}
inner=d.blocks.get('INNER');lines=list(inner.query('LINE'));assert len(lines)==1 and tuple(lines[0].dxf.end)==(18,0,0)
outer=d.blocks.get('OUTER');nested=list(outer.query('INSERT'));assert len(nested)==1 and nested[0].dxf.name=='INNER'
roots=list(d.modelspace().query('INSERT[name=="OUTER"]'));assert len(roots)==2
marked=[i for i in roots if i.attribs];assert len(marked)==1 and marked[0].get_attrib_text('MARK')=='A-777'
audit=d.audit();assert not audit.errors and not audit.fixes,([str(e) for e in audit.errors],[str(e) for e in audit.fixes])
print(json.dumps({'blocks':len(d.blocks),'roots':len(roots)}))
`
  const result=spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON??'python',['-c',script],source,{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}})
  if(result.error?.code==='ENOENT'||/No module named 'ezdxf'/.test(result.stderr)){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(result.stderr||result.error.message);t.skip('ezdxf required');return}
  assert.equal(result.status,0,result.stderr)
  assert.deepEqual(JSON.parse(result.stdout),{blocks:4,roots:2})
})
