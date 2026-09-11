import {createKJModelAdapter,KJModelError} from '../../packages/kjdraw-sdk/src/model-adapters.js'
export const CHAT_OUTPUT_TOKEN_LIMITS=Object.freeze([4096,8192,16384,32768])
const outputLimited=(protocol,response)=>protocol==='chat-completions'?Array.isArray(response?.choices)&&response.choices.some(choice=>choice?.finish_reason==='length')
 :protocol==='responses'?response?.status==='incomplete'&&response?.incomplete_details?.reason==='max_output_tokens'
 :protocol==='anthropic-messages'?response?.stop_reason==='max_tokens'
 :protocol==='gemini-generate-content'?Array.isArray(response?.candidates)&&response.candidates.some(candidate=>candidate?.finishReason==='MAX_TOKENS'):false

/** Workbench policy; SDK defaults and usage observation remain unchanged. */
export function createChatModelAdapter(options){
 const maxOutputTokens=options.maxOutputTokens??4096
 if(!CHAT_OUTPUT_TOKEN_LIMITS.includes(maxOutputTokens))throw new Error('Invalid workbench output token limit')
 // Validate configuration immediately, while preserving a per-conversation stop reason.
 createKJModelAdapter({...options,maxOutputTokens})
 return {createConversation(conversationOptions){
  let limited=false
  const adapter=createKJModelAdapter({...options,maxOutputTokens,request:async request=>{limited=false;const response=await options.request(request);limited=outputLimited(options.protocol,response);return response}})
  const conversation=adapter.createConversation(conversationOptions)
  return {async next(input,signal){try{return await conversation.next(input,signal)}catch(error){
   // The adapter has already recorded provider usage before parsing the stop reason.
   // Never retry or increase the limit here: that is an explicit user decision.
   if(limited&&error?.code==='KJMODEL_INCOMPLETE')throw new KJModelError('KJMODEL_OUTPUT_LIMIT','The model exhausted its output token budget, including reasoning; no tool calls in this response were dispatched')
   throw error
  }}}
 }}
}
