import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKjpPackage, openKjpPackage } from '../src/project-package.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

async function fixture(){
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
  await document.transact('Engineering notes',tx=>{
    tx.createEntity('TEXT',{position:[10,10,0],height:3,text:'REV A',rotation:0.2},{id:'revision'})
    tx.createEntity('MTEXT',{position:[10,20,0],height:3,width:80,text:'数量 1\\P材料 6061-T6'},{id:'notes'})
    tx.createEntity('LINE',{start:[0,0,0],end:[100,0,0]},{id:'outside'})
  })
  const changes=[{id:'revision',expectedText:'REV A',text:'REV B'},{id:'notes',expectedText:'数量 1\\P材料 6061-T6',text:'数量 4\\P材料 6061-T6；尺寸公差 ±0.2'}]
  return {sdk,document,changes,session:new KJAgentToolSession(sdk,document)}
}
const propose=value=>value.session.call('cad_propose_text_edit',{expectedRevision:value.document.revision,units:'millimeter',changes:value.changes})

test('exact heterogeneous annotation edits preview and commit once while preserving identity, styles and unrelated geometry',async()=>{
  const value=await fixture(),before=value.document.serialize(),revision=value.document.revision,original=value.changes.map(change=>structuredClone(value.document.getObject(change.id)))
  const proposal=await propose(value)
  assert.equal(proposal.ok,true);assert.equal(proposal.value.command,'TEXTEDIT')
  assert.equal(value.document.serialize(),before)
  assert.equal(proposal.value.preview.before.length,2);assert.equal(proposal.value.preview.after.length,2)
  const approved=await value.session.approve(proposal.value.planId,'test-reviewer')
  assert.equal(approved.ok,true);assert.equal(value.document.revision,revision+1)
  for(const [index,change]of value.changes.entries()){
    const entity=value.document.getObject(change.id),expected=original[index]
    expected.payload.text=change.text
    assert.deepEqual(entity,expected)
  }
  assert.deepEqual(value.document.getObject('outside').payload.start,[0,0,0])
  assert.equal((await value.session.approve(proposal.value.planId,'test-reviewer')).ok,false)
  await value.document.undo();assert.equal(value.document.getObject('revision').payload.text,'REV A')
  await value.document.redo();assert.equal(value.document.getObject('revision').payload.text,'REV B')
  const at='2026-09-15T00:00:00.000Z',bytes=await createKjpPackage({projectId:'text-edit',drawings:{[value.document.id]:value.document},activeDrawing:value.document.id,createdAt:at,modifiedAt:at})
  const reopened=(await openKjpPackage(bytes)).activeDocument
  for(const change of value.changes)assert.deepEqual(reopened.getObject(change.id),JSON.parse(JSON.stringify(value.document.getObject(change.id))))
  const dxf=await value.sdk.writeDocument(value.document,{format:'DXF'}),sdk=createKJDrawSDK(),dxfDocument=await sdk.readDocument(dxf,{format:'DXF'})
  for(const change of value.changes)assert.ok(dxfDocument.listEntities().some(entity=>entity.payload.text===change.text))
})

test('one mismatched text, protected layer or unsupported entity rejects the complete batch without changing revision/history',async()=>{
  for(const mode of ['mismatch','layer','hidden','type','paper']){
    const value=await fixture()
    if(mode==='mismatch')value.changes[1].expectedText='Wrong original'
    if(mode==='layer')await value.document.transact('Lock notes layer',tx=>{const layer=tx.upsertTableRecord('layers',{name:'LOCKED',type:'LAYER',payload:{locked:true}});tx.updateObject('notes',{payload:{layerId:layer.id}})})
    if(mode==='hidden')await value.document.transact('Hide annotation',tx=>tx.updateObject('notes',{payload:{visible:false}}))
    if(mode==='type')value.changes[1]={id:'outside',expectedText:'',text:'not an annotation'}
    if(mode==='paper')await value.document.transact('Paper annotation',tx=>tx.reparentObject('notes',value.document.spaces.paperSpaceIds[0]))
    const before=value.document.serialize()
    assert.equal((await propose(value)).ok,false,mode)
    await assert.rejects(value.sdk.executeCommand('TEXTEDIT',{changes:value.changes},{document:value.document}))
    assert.equal(value.document.serialize(),before,mode)
  }
})

test('text edits reject duplicate IDs, no-op, blank text, field codes and non-data inputs before executing accessors',async()=>{
  const value=await fixture(),before=value.document.serialize()
  for(const changes of [[value.changes[0],value.changes[0]],[{...value.changes[0],text:'REV A'}],[{...value.changes[0],text:' '}],[{...value.changes[0],text:'%<field>%'}],[{...value.changes[0],text:'x'.repeat(16385)}],[]]){
    await assert.rejects(value.sdk.executeCommand('TEXTEDIT',{changes},{document:value.document}))
    assert.equal(value.document.serialize(),before)
  }
  let invoked=false
  const input={get changes(){invoked=true;return value.changes}}
  await assert.rejects(value.sdk.executeCommand('TEXTEDIT',input,{document:value.document}))
  assert.equal(invoked,false)
})

test('text approval rejects stale plans and command replacement with no partial replacement',async()=>{
  for(const mode of ['stale','replaced']){
    const value=await fixture(),proposal=await propose(value)
    assert.equal(proposal.ok,true)
    if(mode==='stale')await value.document.transact('Other edit',tx=>tx.updateObject('outside',{payload:{start:[1,0,0]}}))
    else value.sdk.commands.register({id:'TEXTEDIT',execute(){throw new Error('not called')}},{replace:true,owner:'test-plugin'})
    const before=value.document.serialize()
    assert.equal((await value.session.approve(proposal.value.planId,'reviewer')).ok,false)
    assert.equal(value.document.serialize(),before)
  }
})

test('imported DXF text remains editable and independently readable with zero audit errors or fixes',async t=>{
  const python=process.env.KJDRAW_PYTHON
  if(!python){t.skip('Set KJDRAW_PYTHON to run independent DXF validation');return}
  const source=await fixture(),sdk=createKJDrawSDK(),document=await sdk.readDocument(await source.sdk.writeDocument(source.document,{format:'DXF'}),{format:'DXF'}),session=new KJAgentToolSession(sdk,document)
  const changes=source.changes.map(change=>({...change,id:document.listEntities().find(entity=>entity.payload.text===change.expectedText).id}))
  const proposal=await session.call('cad_propose_text_edit',{expectedRevision:document.revision,units:'millimeter',changes})
  assert.equal(proposal.ok,true);assert.equal((await session.approve(proposal.value.planId,'interop')).ok,true)
  const dxf=await sdk.writeDocument(document,{format:'DXF'})
  const checked=spawnSyncWithFileStdin(python,['-c',"import io,json,sys,ezdxf; d=ezdxf.read(io.StringIO(sys.stdin.read())); a=d.audit(); print(json.dumps({'errors':len(a.errors),'fixes':len(a.fixes),'texts':[e.dxf.text if e.dxftype()=='TEXT' else e.text for e in d.modelspace() if e.dxftype() in ('TEXT','MTEXT')]}))"],dxf,{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},timeout:30000})
  assert.equal(checked.status,0,checked.stderr)
  const result=JSON.parse(checked.stdout)
  assert.equal(result.errors,0);assert.equal(result.fixes,0)
  for(const change of changes)assert.ok(result.texts.includes(change.text),change.id)
})
