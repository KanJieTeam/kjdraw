import test from 'node:test'
import assert from 'node:assert/strict'
import {createChatModelAdapter} from '../../../apps/playground/chat-model-settings.js'
import {createKJDrawSDK} from '../src/sdk.js'
import {KJAgentToolSession} from '../src/agent-tools.js'
import {runKJAgentTask} from '../src/agent-runner.js'
const protocols=['chat-completions','responses','anthropic-messages','gemini-generate-content']
const response=(protocol,limited)=>protocol==='chat-completions'?{choices:[{finish_reason:limited?'length':'stop',message:{role:'assistant',content:limited?null:'Ready'}}],usage:{prompt_tokens:20,completion_tokens:4096,total_tokens:4116,completion_tokens_details:{reasoning_tokens:4096}}}
 :protocol==='responses'?{status:limited?'incomplete':'completed',incomplete_details:limited?{reason:'max_output_tokens'}:null,output:limited?[]:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Ready'}]}],usage:{input_tokens:20,output_tokens:4096,total_tokens:4116,output_tokens_details:{reasoning_tokens:4096}}}
 :protocol==='anthropic-messages'?{role:'assistant',stop_reason:limited?'max_tokens':'end_turn',content:limited?[]:[{type:'text',text:'Ready'}],usage:{input_tokens:20,output_tokens:4096}}
 :{candidates:[{finishReason:limited?'MAX_TOKENS':'STOP',content:{role:'model',parts:limited?[]:[{text:'Ready'}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:4096,thoughtsTokenCount:0,totalTokenCount:4116}}
for(const protocol of protocols){
 test(`${protocol} workbench passes explicit output budgets unchanged and preserves 4096 default`,async()=>{
  for(const limit of [undefined,8192,16384,32768]){
   const requests=[],model=createChatModelAdapter({protocol,model:'unit-fixture',...(limit?{maxOutputTokens:limit}:{}),request:async({body})=>{requests.push(body);return response(protocol,false)}})
   const turn=await model.createConversation({instructions:'Read only',tools:[]}).next({kind:'prompt',text:'Hello'},new AbortController().signal)
   assert.equal(turn.text,'Ready');assert.equal(requests.length,1)
   const body=requests[0],actual=protocol==='responses'?body.max_output_tokens:protocol==='gemini-generate-content'?body.generationConfig.maxOutputTokens:body.max_tokens
   assert.equal(actual,limit??4096)
  }
 })
 test(`${protocol} output exhaustion is actionable, preserves usage and never retries or dispatches`,async()=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument(),session=new KJAgentToolSession(sdk,document),before=document.serialize();let requests=0
  const model=createChatModelAdapter({protocol,model:'truncation-protocol-fixture',request:async()=>{requests++;return response(protocol,true)}})
  const result=await runKJAgentTask({session,model,prompt:'Read this drawing',toolNames:['cad_read_drawing']})
  assert.equal(result.status,'failed');assert.equal(result.error.code,'KJMODEL_OUTPUT_LIMIT');assert.equal(requests,1);assert.equal(result.toolCalls,0);assert.equal(document.serialize(),before)
  assert.equal(result.measurements.turns.length,1);assert.equal(result.measurements.totals.outputTokens,4096)
 })
}
test('workbench refuses unsupported output choices without a transport call',()=>{for(const limit of [0,1,4097,65536,Infinity,'32768'])assert.throws(()=>createChatModelAdapter({protocol:'chat-completions',model:'x',maxOutputTokens:limit,request:async()=>{throw Error('must not run')}}))})
