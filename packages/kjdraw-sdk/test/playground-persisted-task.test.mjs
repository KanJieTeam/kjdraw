import assert from 'node:assert/strict'
import test from 'node:test'
import { selectChatPersistedTask, inspectChatPersistedTask, startChatPersistedTask } from '../../../apps/playground/chat-persisted-task.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createAgentTaskToolBinding } from '../src/agent-task-runner.js'
import { createAgentTask, readAgentTasks, transitionAgentTask } from '../src/agent-tasks.js'

async function fixture(patch={}) {
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'}),actor={kind:'host',id:'test'},at='2026-09-12T00:00:00.000Z'
  await document.transact('Seed',tx=>tx.createEntity('LINE',{start:[0,0,0],end:[10,0,0]},{id:'edge'}))
  const session=new KJAgentToolSession(sdk,document),allowedToolNames=['cad_check_geometry','cad_propose_move']
  const definition={tools:createAgentTaskToolBinding(session.definitions,allowedToolNames),capabilities:[],requirements:[{id:'length',description:'Keep the edge length',check:{toolName:'cad_check_geometry',assertion:{path:'passed',operator:'is_true',expected:true},geometryCheck:{id:'length',kind:'point-distance',from:{objectId:'edge',feature:'start'},to:{objectId:'edge',feature:'end'},expected:10,tolerance:0}}}],steps:[{id:'edit',title:'Edit',requirementIds:['length']}],...patch}
  await document.transact('Task',tx=>createAgentTask(document,tx,{id:'task',expectedRevision:document.revision,title:'Task',goal:'Move edge right by five mm.',entityIds:['edge'],definition,actor,at}))
  const task=readAgentTasks(document)[0]
  await document.transact('Ready',tx=>transitionAgentTask(document,tx,{id:task.id,expectedRevision:document.revision,expectedTaskVersion:task.taskVersion,expectedStatus:'draft',to:'ready',actor,at,reason:'Ready'}))
  return {sdk,document,session,allowedToolNames,selection:selectChatPersistedTask(document,'task')}
}

test('host review is read-only and explicit start records only one ready-to-running checkpoint',async()=>{
  const value=await fixture(),before=value.document.serialize(),revision=value.document.revision
  assert.equal((await inspectChatPersistedTask(value)).status,'ready')
  assert.equal(value.document.serialize(),before)
  assert.equal((await startChatPersistedTask(value)).status,'running')
  assert.equal(value.document.revision,revision+1)
  assert.deepEqual(value.document.getObject('edge').payload.start,[0,0,0])
  const started=value.document.serialize()
  await startChatPersistedTask({...value,selection:selectChatPersistedTask(value.document,'task')})
  assert.equal(value.document.serialize(),started)
})

test('stale selection, replaced document instance and cancelled start cannot record a checkpoint',async()=>{
  for(const mode of ['revision','instance','abort','switched']) {
    const value=await fixture()
    if(mode==='revision')await value.document.transact('Outside task',tx=>tx.createEntity('LINE',{start:[100,0,0],end:[101,0,0]}))
    if(mode==='instance'){const sdk=createKJDrawSDK();value.document=await sdk.readDocument(await value.sdk.writeDocument(value.document,{format:'KJD'}),{format:'KJD'});value.session=new KJAgentToolSession(sdk,value.document)}
    if(mode==='abort'){const abort=new AbortController();abort.abort();value.signal=abort.signal}
    if(mode==='switched')value.isCurrent=()=>false
    const before=value.document.serialize()
    await assert.rejects(startChatPersistedTask(value),/stale|cancelled/)
    assert.equal(value.document.serialize(),before)
  }
})

test('changed contract, untrusted capability and removed host tools fail before status mutation',async()=>{
  for(const mode of ['hash','capability','policy']){
    const baseline=await fixture(),patch=mode==='hash'?{tools:{...createAgentTaskToolBinding(baseline.session.definitions,baseline.allowedToolNames),contractHash:'f'.repeat(16)}}:mode==='capability'?{capabilities:[{id:'untrusted.task',version:'1.0.0',contentHash:'f'.repeat(16)}]}:{}
    const value=await fixture(patch),before=value.document.serialize()
    if(mode==='policy')value.allowedToolNames=['cad_check_geometry']
    await assert.rejects(startChatPersistedTask(value),/contract|registry|policy/)
    assert.equal(value.document.serialize(),before)
  }
})

test('incompatible acceptance conditions are not silently downgraded to ordinary approval',async()=>{
  const value=await fixture({requirements:[{id:'length',description:'Read only evidence is not atomic acceptance',check:{toolName:'cad_check_geometry',assertion:{path:'passed',operator:'equals',expected:true}}}]}),before=value.document.serialize()
  await assert.rejects(startChatPersistedTask(value),/deterministic/)
  assert.equal(value.document.serialize(),before)
})
