import {createKJModelAdapter,KJModelError} from '../../packages/kjdraw-sdk/src/model-adapters.js'
export const CHAT_OUTPUT_TOKEN_LIMITS=Object.freeze([4096,8192,16384,32768])
const outputLimited=(protocol,response)=>protocol==='chat-completions'?Array.isArray(response?.choices)&&response.choices.some(choice=>choice?.finish_reason==='length')
 :protocol==='responses'?(response?.response??response)?.status==='incomplete'&&(response?.response??response)?.incomplete_details?.reason==='max_output_tokens'
 :protocol==='anthropic-messages'?response?.stop_reason==='max_tokens'
 :protocol==='gemini-generate-content'?Array.isArray(response?.candidates)&&response.candidates.some(candidate=>candidate?.finishReason==='MAX_TOKENS'):false
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const iterable=value=>value&&typeof value[Symbol.asyncIterator]==='function'

async function responseJson(response,maxBytes){
 if(!response.body)throw new Error('Model endpoint returned no body')
 const reader=response.body.getReader(),chunks=[];let length=0
 try{while(true){const{value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes)throw new Error('Model response exceeds budget');chunks.push(value)}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const bytes=new Uint8Array(length);let offset=0
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new Error('Model endpoint returned invalid JSON')}
 if(!object(json))throw new Error('Model endpoint returned invalid JSON')
 if(!response.ok){if(json?.error?.code==='MODEL_TOKEN_LIMIT')throw new KJModelError('KJMODEL_SERVER_TOKEN_LIMIT','Server output-token policy rejected the request');throw new Error('Model endpoint failed')}
 return json
}

async function* responseEvents(response,maxBytes){
 if(!response.body)throw new Error('Model endpoint returned no body')
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let length=0,buffer='',data=[]
 const event=()=>{const value=data.join('\n');data=[];if(!value||value==='[DONE]')return value==='[DONE]'?null:undefined;let json;try{json=JSON.parse(value)}catch{throw new Error('Model endpoint returned invalid event data')}if(!object(json))throw new Error('Model endpoint returned invalid event data');return json}
 try{
  while(true){const{value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes)throw new Error('Model response exceeds budget');buffer+=decoder.decode(value,{stream:true});let newline
   while((newline=buffer.indexOf('\n'))>=0){let line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(line.endsWith('\r'))line=line.slice(0,-1);if(line===''){const value=event();if(value===null)return;if(value!==undefined)yield value}else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''))}
  }
  buffer+=decoder.decode();if(buffer){if(buffer.endsWith('\r'))buffer=buffer.slice(0,-1);if(buffer.startsWith('data:'))data.push(buffer.slice(5).replace(/^ /,''))}
  const value=event();if(value!==undefined&&value!==null)yield value
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}

/** Read the fixed same-origin proxy response as bounded JSON or bounded SSE JSON events. */
export async function readChatModelResponse(response,{maxBytes=2097152}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('Invalid model response budget')
 const type=response.headers.get('content-type')??''
 if(response.ok&&/^text\/event-stream(?:\s*;|$)/i.test(type))return responseEvents(response,maxBytes)
 return responseJson(response,maxBytes)
}

/** Workbench policy; SDK defaults and usage observation remain unchanged. */
export function createChatModelAdapter(options){
 const maxOutputTokens=options.maxOutputTokens??4096
 if(!CHAT_OUTPUT_TOKEN_LIMITS.includes(maxOutputTokens))throw new Error('Invalid workbench output token limit')
 // Validate configuration immediately, while preserving a per-conversation stop reason.
 createKJModelAdapter({...options,maxOutputTokens})
 return {createConversation(conversationOptions){
  let limited=false
  const adapter=createKJModelAdapter({...options,maxOutputTokens,request:async request=>{limited=false;const response=await options.request(request);if(!iterable(response)){limited=outputLimited(options.protocol,response);return response}return{async*[Symbol.asyncIterator](){for await(const chunk of response){limited=limited||outputLimited(options.protocol,chunk);yield chunk}}}}})
  const conversation=adapter.createConversation(conversationOptions)
  return {async next(input,signal){try{return await conversation.next(input,signal)}catch(error){
   // The adapter has already recorded provider usage before parsing the stop reason.
   // Never retry or increase the limit here: that is an explicit user decision.
   if(limited&&error?.code==='KJMODEL_INCOMPLETE')throw new KJModelError('KJMODEL_OUTPUT_LIMIT','The model exhausted its output token budget, including reasoning; no tool calls in this response were dispatched')
   throw error
  }}}
 }}
}
