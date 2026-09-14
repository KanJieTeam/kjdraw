import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { runKJAgentTask } from '../src/agent-runner.js'

const fixture=()=>{
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'millimeter'})
  return {sdk,document,session:new KJAgentToolSession(sdk,document)}
}
const circle=(id,radius=2)=>({id,name:'cad_propose_circles',arguments:{expectedRevision:0,units:'millimeter',circles:[{center:{x:5,y:5},radius}]}})

test('runner stops after the initial failure and two repair attempts without another model request',async()=>{
  const {document,session}=fixture();let calls=0
  const model={createConversation:()=>({next:async input=>{
    if(calls)assert.equal(input.results[0].result.ok,false)
    return {text:'',calls:[circle(`attempt-${++calls}`,-1)]}
  }})}
  const result=await runKJAgentTask({session,model,prompt:'Draw the specified circle.'})
  assert.equal(result.status,'limit-reached')
  assert.equal(result.error.code,'KJAGENT_REPAIR_LIMIT')
  assert.equal(calls,3);assert.equal(result.turns,3);assert.equal(result.toolCalls,3)
  assert.equal(result.repairAttempts,2);assert.equal(result.failedToolCalls,3)
  assert.equal(document.revision,0);assert.equal(document.listEntities().length,0)
  assert.deepEqual(result.proposalIds,[])
})

test('zero repair budget does not prevent a valid initial proposal or a later independent run',async()=>{
  const {document,session}=fixture();let calls=0
  const failed=await runKJAgentTask({session,prompt:'Draw.',maxRepairAttempts:0,model:{createConversation:()=>({next:async()=>({text:'',calls:[circle(`bad-${++calls}`,-1)]})})}})
  assert.equal(failed.status,'limit-reached');assert.equal(calls,1);assert.equal(failed.repairAttempts,0)
  const valid=await runKJAgentTask({session,prompt:'Draw.',maxRepairAttempts:0,model:{createConversation:()=>({next:async()=>({text:'Review this proposal.',calls:[circle('good')]})})}})
  assert.equal(valid.status,'awaiting-approval');assert.equal(valid.failedToolCalls,0)
  assert.equal((await session.approve(valid.proposalIds[0],'reviewer')).ok,true)
  assert.equal(document.revision,1)
  await document.undo();assert.equal(document.listEntities().length,0)
})

test('corrected arguments within the budget produce one unapplied proposal',async()=>{
  const {document,session}=fixture();let calls=0
  const result=await runKJAgentTask({session,prompt:'Draw.',maxRepairAttempts:1,model:{createConversation:()=>({next:async input=>{
    const attempt=++calls
    if(attempt===2)assert.equal(input.results[0].result.ok,false)
    return {text:'',calls:[circle(`circle-${attempt}`,attempt===1?-1:2)]}
  }})}})
  assert.equal(result.status,'awaiting-approval');assert.equal(calls,2)
  assert.equal(result.repairAttempts,1);assert.equal(result.failedToolCalls,1)
  assert.equal(document.revision,0);assert.equal(result.proposalIds.length,1)
})

test('real geometry check failures consume the same repair budget even with ok true',async()=>{
  const {document,session}=fixture()
  await document.transact('Seed',tx=>tx.createEntity('CIRCLE',{center:[0,0,0],radius:5},{id:'hole'}))
  let calls=0
  const result=await runKJAgentTask({session,prompt:'Verify the radius.',maxRepairAttempts:1,model:{createConversation:()=>({next:async()=>({text:'All good.',calls:[{id:`check-${++calls}`,name:'cad_check_geometry',arguments:{expectedRevision:1,units:'millimeter',lineLengths:[],pointDistances:[],polylineClosures:[],circleRadii:[{id:'radius',objectId:'hole',expected:9,tolerance:0}]}}]})})}})
  assert.equal(result.status,'limit-reached');assert.equal(result.error.code,'KJAGENT_REPAIR_LIMIT')
  assert.equal(result.turns,2);assert.equal(result.failedToolCalls,2)
  assert.ok(result.outputs.every(output=>output.result.ok&&output.result.value.passed===false))
  assert.equal(document.revision,1)
})

test('a failed tool in a proposal batch rejects every pending proposal instead of offering partial approval',async()=>{
  const {document,session}=fixture(), before=document.serialize()
  for(const order of ['bad-first','good-first']){
    const calls=[circle(`${order}-bad`,-1),circle(`${order}-good`)]
    if(order==='good-first')calls.reverse()
    const result=await runKJAgentTask({session,prompt:'Complete both requested features.',model:{createConversation:()=>({next:async()=>({text:'Everything is ready.',calls})})}})
    assert.equal(result.status,'failed');assert.equal(result.error.code,'KJAGENT_INCOMPLETE_BATCH')
    assert.deepEqual(result.proposalIds,[])
    const proposal=result.outputs.find(output=>output.result.ok).result.value
    assert.equal((await session.approve(proposal.planId,'reviewer')).ok,false)
    assert.equal(document.serialize(),before)
  }
})

test('invalid repair limits are rejected before contacting the model',async()=>{
  const {session}=fixture();let opened=false
  for(const maxRepairAttempts of [-1,0.5,NaN,Infinity,33,'2',null]){
    await assert.rejects(runKJAgentTask({session,prompt:'Draw.',maxRepairAttempts,model:{createConversation(){opened=true}}}),/repair/i)
  }
  assert.equal(opened,false)
})
