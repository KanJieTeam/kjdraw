import test from 'node:test'
import assert from 'node:assert/strict'
import {createChatModelAdapter,readChatModelResponse} from '../../../apps/playground/chat-model-settings.js'
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

test('workbench reads fragmented bounded SSE, DONE and complete JSON fallback',async()=>{
 const encoder=new TextEncoder(),parts=['data: {"choices":[{"delta":{"content":"你"}}]}\r','\n\r\ndata: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n']
 const stream=new ReadableStream({start(controller){for(const part of parts)controller.enqueue(encoder.encode(part));controller.close()}})
 const events=[];for await(const event of await readChatModelResponse(new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8'}})))events.push(event)
 assert.equal(events.length,2);assert.equal(events[0].choices[0].delta.content,'你');assert.equal(events[1].choices[0].delta.content,'好')
 assert.deepEqual(await readChatModelResponse(new Response(JSON.stringify({choices:[]} ),{headers:{'Content-Type':'application/json'}})),{choices:[]})
 await assert.rejects(async()=>{for await(const ignored of await readChatModelResponse(new Response(new ReadableStream({start(controller){controller.enqueue(encoder.encode('data: '+JSON.stringify({value:'x'.repeat(80)})+'\n\n'));controller.close()}}),{headers:{'Content-Type':'text/event-stream'}}),{maxBytes:32}))void ignored},/budget/)
})

test('workbench maps a streamed output-limit finish without retrying',async()=>{
 let requests=0
 const model=createChatModelAdapter({protocol:'chat-completions',model:'stream-limit',chatStreaming:true,request:async()=>{requests++;return{async*[Symbol.asyncIterator](){yield{choices:[{index:0,delta:{role:'assistant',content:null},finish_reason:'length'}]}}}}})
 const sdk=createKJDrawSDK(),document=sdk.createDocument()
 const result=await runKJAgentTask({session:new KJAgentToolSession(sdk,document),model,prompt:'draw'})
 assert.equal(result.status,'failed');assert.equal(result.error.code,'KJMODEL_OUTPUT_LIMIT');assert.equal(requests,1);assert.equal(result.toolCalls,0)
})

test('workbench maps a streamed Responses output-limit terminal without retrying',async()=>{
 let requests=0
 const request=async()=>{
  requests++
  return{async*[Symbol.asyncIterator](){yield{type:'response.incomplete',sequence_number:0,response:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[],usage:{input_tokens:5,output_tokens:4096,total_tokens:4101}}}}}
 }
 const model=createChatModelAdapter({protocol:'responses',model:'responses-stream-limit',responsesStreaming:true,request})
 const sdk=createKJDrawSDK(),document=sdk.createDocument(),result=await runKJAgentTask({session:new KJAgentToolSession(sdk,document),model,prompt:'draw'})
 assert.equal(result.status,'failed');assert.equal(result.error.code,'KJMODEL_OUTPUT_LIMIT');assert.equal(requests,1);assert.equal(result.toolCalls,0);assert.equal(result.measurements.totals.totalTokens,4101)
})

test('workbench maps streamed Anthropic and Gemini output limits and preserves terminal usage',async()=>{
 const cases=[
  ['anthropic-messages','anthropicStreaming',[
   {type:'message_start',message:{id:'msg-limit',type:'message',role:'assistant',content:[],model:'fixture',stop_reason:null,stop_sequence:null,usage:{input_tokens:5,cache_read_input_tokens:0,cache_creation_input_tokens:0}}},
   {type:'message_delta',delta:{stop_reason:'max_tokens',stop_sequence:null},usage:{output_tokens:4096}},
   {type:'message_stop'},
  ],4101],
  ['gemini-generate-content','geminiStreaming',[
   {candidates:[{index:0,content:{role:'model',parts:[{text:'partial'}]},finishReason:'MAX_TOKENS'}],usageMetadata:{promptTokenCount:5,candidatesTokenCount:4096,thoughtsTokenCount:0,totalTokenCount:4101}},
  ],4101],
 ]
 for(const[protocol,option,chunks,total]of cases){
  let requests=0
  const model=createChatModelAdapter({protocol,model:'stream-limit',[option]:true,request:async()=>{requests++;return{async*[Symbol.asyncIterator](){for(const chunk of chunks)yield chunk}}}})
  const sdk=createKJDrawSDK(),document=sdk.createDocument(),result=await runKJAgentTask({session:new KJAgentToolSession(sdk,document),model,prompt:'draw'})
  assert.equal(result.status,'failed',protocol);assert.equal(result.error.code,'KJMODEL_OUTPUT_LIMIT',protocol);assert.equal(requests,1,protocol);assert.equal(result.toolCalls,0,protocol);assert.equal(result.measurements.totals.totalTokens,total,protocol)
 }
})
