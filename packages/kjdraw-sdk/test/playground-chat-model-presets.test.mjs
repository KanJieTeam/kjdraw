import assert from 'node:assert/strict'
import test from 'node:test'

import { CHAT_MODEL_PROVIDER_PRESETS, formatChatModelUpstreamEndpoint, getChatModelProviderPreset } from '../../../apps/playground/chat-model-presets.js'

const protocols=new Set(['responses','chat-completions','anthropic-messages','gemini-generate-content'])

test('chat provider presets stay within supported transports and direct browser routing',()=>{
  assert.equal(CHAT_MODEL_PROVIDER_PRESETS.length,14)
  assert.equal(new Set(CHAT_MODEL_PROVIDER_PRESETS.map(item=>item.id)).size,CHAT_MODEL_PROVIDER_PRESETS.length)
  for(const item of CHAT_MODEL_PROVIDER_PRESETS){
    assert.equal(protocols.has(item.protocol),true,item.id)
    assert.equal(item.endpoint,item.upstreamEndpoint,item.id)
    assert.equal(new Set(item.models).size,item.models.length,item.id)
    if(item.id==='custom'){assert.deepEqual(item.models,[]);assert.equal(item.upstreamEndpoint,'')}
    else {assert.equal(item.models.length>0,true,item.id);assert.match(item.upstreamEndpoint,/^https:\/\//,item.id)}
  }
})

test('provider lookup falls back safely and Gemini substitutes its selected model',()=>{
  assert.equal(getChatModelProviderPreset('deepseek').models[0],'deepseek-v4-flash')
  assert.equal(getChatModelProviderPreset('kimi').models[0],'kimi-k3')
  assert.equal(getChatModelProviderPreset('hunyuan').models[0],'hy3-preview')
  assert.equal(getChatModelProviderPreset('missing').id,'custom')
  assert.equal(formatChatModelUpstreamEndpoint(getChatModelProviderPreset('gemini'),'gemini-3.8-flash'),'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
  assert.equal(formatChatModelUpstreamEndpoint(getChatModelProviderPreset('custom'),'anything'),'')
})
