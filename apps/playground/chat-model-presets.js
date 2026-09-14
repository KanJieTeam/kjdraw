const preset = (id, label, protocol, upstreamEndpoint, models) => Object.freeze({
  id,
  label: Object.freeze(label),
  protocol,
  endpoint: upstreamEndpoint,
  upstreamEndpoint,
  models: Object.freeze(models),
})

export const CHAT_MODEL_PROVIDER_PRESETS = Object.freeze([
  preset('custom', ['Custom / self-hosted', '自定义 / 自托管'], 'chat-completions', '', []),
  preset('openai-responses', ['OpenAI · Responses', 'OpenAI · Responses'], 'responses', 'https://api.openai.com/v1/responses', ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']),
  preset('openai-chat', ['OpenAI · Chat Completions', 'OpenAI · Chat Completions'], 'chat-completions', 'https://api.openai.com/v1/chat/completions', ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']),
  preset('anthropic', ['Anthropic · Claude', 'Anthropic · Claude'], 'anthropic-messages', 'https://api.anthropic.com/v1/messages', ['claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']),
  preset('gemini', ['Google · Gemini', 'Google · Gemini'], 'gemini-generate-content', 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.1-pro-preview']),
  preset('deepseek', ['DeepSeek', 'DeepSeek'], 'chat-completions', 'https://api.deepseek.com/chat/completions', ['deepseek-v4-flash', 'deepseek-v4-pro']),
  preset('kimi', ['Moonshot AI · Kimi', '月之暗面 · Kimi'], 'chat-completions', 'https://api.moonshot.cn/v1/chat/completions', ['kimi-k3', 'kimi-k2.6']),
  preset('qwen', ['Alibaba Cloud · Qwen', '阿里云百炼 · 通义千问'], 'chat-completions', 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions', ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash']),
  preset('zhipu', ['Zhipu AI · GLM', '智谱 AI · GLM'], 'chat-completions', 'https://open.bigmodel.cn/api/paas/v4/chat/completions', ['glm-5.2', 'glm-5-turbo', 'glm-4.7-flash']),
  preset('minimax', ['MiniMax', 'MiniMax'], 'chat-completions', 'https://api.minimaxi.com/v1/chat/completions', ['MiniMax-M2.7']),
  preset('volcengine', ['Volcengine Ark · Doubao', '火山方舟 · 豆包'], 'responses', 'https://ark.cn-beijing.volces.com/api/v3/responses', ['doubao-seed-2-0-lite-260215']),
  preset('hunyuan', ['Tencent TokenHub · Hunyuan', '腾讯 TokenHub · 混元'], 'chat-completions', 'https://tokenhub.tencentmaas.com/v1/chat/completions', ['hy3-preview']),
  preset('xai', ['xAI · Grok', 'xAI · Grok'], 'responses', 'https://api.x.ai/v1/responses', ['grok-4.6']),
  preset('mistral', ['Mistral AI', 'Mistral AI'], 'chat-completions', 'https://api.mistral.ai/v1/chat/completions', ['mistral-large-latest', 'mistral-small-latest']),
])

const presets = new Map(CHAT_MODEL_PROVIDER_PRESETS.map(item => [item.id, item]))

export function getChatModelProviderPreset(id) {
  return presets.get(id) ?? presets.get('custom')
}

export function formatChatModelUpstreamEndpoint(provider, model = '') {
  if (!provider?.upstreamEndpoint) return ''
  return provider.upstreamEndpoint.replace('{model}', encodeURIComponent(String(model).trim()))
}
