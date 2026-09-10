import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { runKJAgentTask } from '../src/agent-runner.js'

function fixture() {
  const sdk=createKJDrawSDK(),document=sdk.createDocument({ units:'millimeter' }),session=new KJAgentToolSession(sdk,document)
  const model={createConversation:()=>({next:async()=>({text:'',calls:[{id:'draw',name:'cad_propose_lines',arguments:{expectedRevision:0,units:'millimeter',lines:[{start:{x:0,y:0},end:{x:10,y:0}}]}}]})})}
  return {document,session,model,prompt:'Draw one line'}
}
test('agent progress follows actual model/tool work and does not disclose drawing payloads',async()=>{
  const options=fixture(),events=[],before=options.document.serialize()
  const result=await runKJAgentTask({...options,onProgress:event=>{assert.ok(Object.isFrozen(event));events.push(event)}})
  assert.equal(result.status,'awaiting-approval')
  assert.deepEqual(events,[{phase:'model',turns:1,toolCalls:0},{phase:'tool-start',turns:1,toolCalls:1,toolName:'cad_propose_lines'},{phase:'tool-complete',turns:1,toolCalls:1,toolName:'cad_propose_lines',ok:true}])
  assert.equal(options.document.serialize(),before)
})
test('progress cancellation before a tool prevents dispatch; callback failure rejects a registered proposal',async()=>{
  const options=fixture(),controller=new AbortController(),before=options.document.serialize()
  const cancelled=await runKJAgentTask({...options,signal:controller.signal,onProgress:event=>{if(event.phase==='tool-start')controller.abort()}})
  assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.outputs.length,0)
  assert.equal(options.document.serialize(),before)
  let id
  const failed=await runKJAgentTask({...options,onProgress:event=>{if(event.phase==='tool-complete')throw new Error('private callback failure')}})
  assert.equal(failed.status,'failed');assert.equal(failed.proposalIds.length,0)
  assert.ok(!JSON.stringify(failed).includes('private callback failure'))
  id=failed.outputs[0].result.value.planId
  assert.equal((await options.session.approve(id,'reviewer')).ok,false)
  assert.equal(options.document.serialize(),before)
})
