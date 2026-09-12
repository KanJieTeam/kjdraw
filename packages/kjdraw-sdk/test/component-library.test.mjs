import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, listComponentCatalog, searchComponentCatalog } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const FLANGE='org.kjdraw.mechanical.four-hole-flange'
const json=value=>JSON.parse(JSON.stringify(value))
const insert=(sdk,document,patch={})=>sdk.executeCommand('COMPONENTINSERT',{
  componentId:FLANGE,version:'1.0.0',units:document.snapshot().header.units,position:[10,20,0],scale:1,rotation:Math.PI/6,...patch,
},{document,expectedRevision:document.revision})

test('read-only bilingual catalog has stable versions, SPDX provenance and bounded cursor search',async()=>{
  const catalog=listComponentCatalog()
  assert.equal(catalog.length,3);assert.equal(Object.isFrozen(catalog),true)
  for(const item of catalog){assert.match(item.id,/^org\.kjdraw\./);assert.match(item.version,/^\d+\.\d+\.\d+$/);assert.ok(item.title.en&&item.title.zh);assert.equal(item.license.spdx,'Apache-2.0');assert.match(item.license.source,/KJDraw original/)}
  const first=searchComponentCatalog({query:'',locale:'en',limit:1})
  assert.equal(first.items.length,1);assert.equal(first.total,3);assert.equal(first.nextCursor,'1')
  const second=searchComponentCatalog({query:'',locale:'zh-CN',limit:1,cursor:first.nextCursor})
  assert.notEqual(second.items[0].id,first.items[0].id)
  assert.equal(searchComponentCatalog({query:'插座',locale:'zh-CN'}).items[0].category,'electrical')
  assert.equal(searchComponentCatalog({query:'bearing',category:'mechanical'}).items[0].id,FLANGE)
  for(const invalid of [{limit:51},{limit:0},{cursor:-1},{cursor:99},{query:'x'.repeat(129)},{locale:'fr'},{category:'survey'}])assert.throws(()=>searchComponentCatalog(invalid),/COMPONENT/)
  const sdk=createKJDrawSDK(),document=sdk.createDocument()
  const revision=document.revision,result=await sdk.executeCommand('COMPONENTSEARCH',{query:'door',locale:'en',limit:2},{document})
  assert.equal(result.items[0].category,'architecture');assert.equal(document.revision,revision)
})

test('component insertion creates one native definition transaction and repeated inserts reuse it',async()=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
  const first=await insert(sdk,document)
  assert.equal(document.revision,1);assert.equal(first.definitionReused,false);assert.equal(first.definitionEntityCount,6)
  assert.equal(first.insert.type,'INSERT');assert.deepEqual(first.insert.payload.position,[10,20,0]);assert.deepEqual(first.insert.payload.scale,[1,1,1])
  const block=document.getObject(first.definitionId);assert.equal(block.kind,'block-record');assert.equal(block.payload.component.license.spdx,'Apache-2.0')
  assert.equal(document.listEntities({ownerId:block.id}).length,6)
  const second=await insert(sdk,document,{position:[200,20,0],scale:2,rotation:0})
  assert.equal(second.definitionId,first.definitionId);assert.equal(second.definitionReused,true)
  assert.equal(document.getTable('blockRecords').records.filter(item=>item.name===first.definitionName).length,1)
  assert.equal(document.listEntities({ownerId:document.snapshot().spaces.modelSpaceId,type:'INSERT'}).length,2)
  await sdk.executeCommand('UNDO',{}, {document});assert.equal(document.listEntities({type:'INSERT'}).length,1);assert.ok(document.getObject(first.definitionId))
  await sdk.executeCommand('UNDO',{}, {document});assert.equal(document.listEntities({type:'INSERT'}).length,0);assert.equal(document.getObject(first.definitionId),null)
  await sdk.executeCommand('REDO',{}, {document});assert.equal(document.listEntities({type:'INSERT'}).length,1);assert.equal(document.listEntities({ownerId:first.definitionId}).length,6)
  await sdk.executeCommand('REDO',{}, {document});assert.equal(document.listEntities({type:'INSERT'}).length,2)
})

test('parameters and physical units are validated and converted before native geometry is created',async()=>{
  const sdk=createKJDrawSDK(),meters=sdk.createDocument({documentId:'meters',units:'meter'})
  const result=await insert(sdk,meters,{position:[1,2],parameters:{outerDiameter:200,boreDiameter:80,boltCircleDiameter:150,holeDiameter:10,holeCount:8}})
  const circles=meters.listEntities({ownerId:result.definitionId,type:'CIRCLE'})
  assert.equal(circles.length,10);assert.equal(circles[0].payload.radius,.1);assert.equal(circles[1].payload.radius,.04)
  for(const patch of [
    {units:'millimeter'},{scale:0},{scale:[1,2,1]},{rotation:Infinity},{position:[0]},{parameters:{unknown:1}},
    {parameters:{holeCount:3.5}},{parameters:{outerDiameter:100,boreDiameter:80,boltCircleDiameter:70,holeDiameter:20}},
  ]){const fresh=createKJDrawSDK(),document=fresh.createDocument({units:'meter'}),before=document.serialize();await assert.rejects(insert(fresh,document,patch),/COMPONENT/);assert.equal(document.serialize(),before)}
})

test('protected, stale, definition collision and budget failures reject atomically',async()=>{
  for(const mode of ['locked','frozen','hidden']){
    const sdk=createKJDrawSDK(),document=sdk.createDocument();let layer
    await document.transact('protected layer',tx=>{layer=tx.upsertTableRecord('layers',{name:mode.toUpperCase(),payload:{visible:mode!=='hidden',locked:mode==='locked',frozen:mode==='frozen'}})})
    const before=document.serialize();await assert.rejects(insert(sdk,document,{layerId:layer.id}),new RegExp(mode));assert.equal(document.serialize(),before)
  }
  {const sdk=createKJDrawSDK(),document=sdk.createDocument(),before=document.serialize();await assert.rejects(sdk.executeCommand('COMPONENTINSERT',{componentId:FLANGE,units:'millimeter'},{document,expectedRevision:1}),/revision/i);assert.equal(document.serialize(),before)}
  {const sdk=createKJDrawSDK(),document=sdk.createDocument(),before=document.serialize();await assert.rejects(insert(sdk,document,{maxDefinitionEntities:5}),/budget/);assert.equal(document.serialize(),before)}
  {const sdk=createKJDrawSDK(),document=sdk.createDocument(),first=await insert(sdk,document);await document.transact('corrupt metadata',tx=>tx.updateObject(first.definitionId,{payload:{component:{wrong:true}}}));const before=document.serialize();await assert.rejects(insert(sdk,document,{position:[30,40]}),/collision/);assert.equal(document.serialize(),before)}
})

test('catalog components persist as editable native blocks through KJD and DXF reopen',async()=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
  const first=await insert(sdk,document,{componentId:'org.kjdraw.architecture.single-swing-door',position:[100,200],rotation:Math.PI/2})
  await insert(sdk,document,{componentId:'org.kjdraw.architecture.single-swing-door',position:[300,200],rotation:0})
  for(const format of ['KJD','DXF']){
    const artifact=await sdk.writeDocument(document,{format,...(format==='DXF'?{version:'2018'}:{})})
    const reopened=await createKJDrawSDK().readDocument(artifact,{format})
    const inserts=reopened.listEntities({ownerId:reopened.snapshot().spaces.modelSpaceId,type:'INSERT'})
    assert.equal(inserts.length,2);assert.equal(new Set(inserts.map(item=>item.payload.blockRecordId)).size,1)
    const block=reopened.getObject(inserts[0].payload.blockRecordId)
    assert.equal(block.name,first.definitionName);assert.equal(reopened.listEntities({ownerId:block.id,type:'LINE'}).length,3);assert.equal(reopened.listEntities({ownerId:block.id,type:'ARC'}).length,1)
    if(format==='KJD')assert.deepEqual(json(block.payload.component),json(document.getObject(first.definitionId).payload.component))
  }
})

test('independent official ezdxf reopens native catalog BLOCK/INSERT output without repairs',async t=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'}),first=await insert(sdk,document)
  await insert(sdk,document,{position:[200,20],rotation:0})
  const dxf=await sdk.writeDocument(document,{format:'DXF',version:'2018'}),python=process.env.KJDRAW_PYTHON??'python'
  const script=`import io,json,os,sys,ezdxf
p=os.environ.get("KJDRAW_FILE_STDIN_PATH");source=open(p,encoding="utf-8").read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));a=d.audit();name=${JSON.stringify(first.definitionName)};b=d.blocks.get(name);m=list(d.modelspace().query('INSERT[name=="'+name+'"]'))
print(json.dumps({'version':ezdxf.__version__,'errors':len(a.errors),'fixes':len(a.fixes),'inserts':len(m),'circles':len(list(b.query('CIRCLE')))}))`
  const result=spawnSyncWithFileStdin(python,['-c',script],dxf,{encoding:'utf8',windowsHide:true,timeout:30000})
  if(result.error?.code==='ENOENT'||/No module named ['"]ezdxf/.test(result.stderr)){t.skip('official ezdxf runtime is unavailable');return}
  assert.equal(result.status,0,result.stderr);const inspected=JSON.parse(result.stdout)
  assert.deepEqual(inspected,{version:'1.4.4',errors:0,fixes:0,inserts:2,circles:6})
})
