// Bounded, non-streaming Chat Completions transport for the token benchmark.
// Credentials are read only from process.env and never included in results/errors.
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { extractKJModelUsage } from '../../packages/kjdraw-sdk/src/model-usage.js'

const providers = Object.freeze({
  deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', key: 'KJDRAW_DEEPSEEK_API_KEY' },
  qwen: { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', key: 'KJDRAW_QWEN_API_KEY' },
  glm: { endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', key: 'KJDRAW_GLM_API_KEY' },
})
const maxRequestBytes = 2 * 1024 * 1024, maxResponseBytes = 2 * 1024 * 1024
const fail = code => { const error = new Error(code); error.code = code; throw error }
const count = value => Number.isSafeInteger(value) && value >= 0
const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host)

function endpointFor(provider) {
  const fixture = process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT
  if (!fixture) return new URL(providers[provider].endpoint)
  let url
  try { url = new URL(fixture) } catch { fail('INVALID_FIXTURE_ENDPOINT') }
  if (url.protocol !== 'http:' || !loopback(url.hostname) || url.username || url.password || url.search || url.hash) fail('INVALID_FIXTURE_ENDPOINT')
  return url
}

function proxyFor() {
  const value = process.env.KJDRAW_BENCH_PROXY
  if (!value) return null
  let url
  try { url = new URL(value) } catch { fail('INVALID_PROXY') }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash) fail('INVALID_PROXY')
  return url
}

export function createBenchmarkProxyAgent(proxy) {
  const agent = new https.Agent({ keepAlive: false })
  agent.createConnection = (options, callback) => {
    let settled = false
    const done = (error, socket) => { if (settled) return; settled = true; callback(error, socket) }
    const host = options.hostname ?? options.host
    const connect = http.request({ hostname: proxy.hostname, port: proxy.port || 80, method: 'CONNECT', path: `${host}:${options.port ?? 443}`, headers: { Host: `${host}:${options.port ?? 443}` }, timeout: 10000 })
    connect.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200 || head.length) { socket.destroy(); done(new Error('PROXY_CONNECT_FAILURE')); return }
      const secure = tls.connect({ socket, servername: host, rejectUnauthorized: true })
      secure.once('secureConnect', () => done(null, secure))
      secure.once('error', () => done(new Error('PROXY_TLS_FAILURE')))
    })
    connect.once('timeout', () => { connect.destroy(); done(new Error('PROXY_TIMEOUT')) })
    connect.once('error', () => done(new Error('PROXY_CONNECT_FAILURE')))
    connect.end()
  }
  return agent
}

function postJson(url, json, key, timeoutMs, proxy) {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(json)
    const client = url.protocol === 'https:' ? https : http
    const agent = proxy && url.protocol === 'https:' ? createBenchmarkProxyAgent(proxy) : undefined
    let settled = false, timer
    const done = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); if (agent) agent.destroy(); error ? reject(error) : resolve(result) }
    const request = client.request(url, { method: 'POST', agent, headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length, Authorization: `Bearer ${key}` } }, response => {
      const chunks = []; let size = 0
      response.on('data', chunk => { size += chunk.length; if (size > maxResponseBytes) { request.destroy(); done(new Error('RESPONSE_TOO_LARGE')); return } chunks.push(chunk) })
      response.once('end', () => done(null, { status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      response.once('error', () => done(new Error('TRANSPORT_FAILURE')))
    })
    request.setTimeout(timeoutMs, () => { request.destroy(); done(new Error('PROVIDER_TIMEOUT')) })
    request.once('error', () => done(new Error('TRANSPORT_FAILURE')))
    timer = setTimeout(() => { request.destroy(); done(new Error('PROVIDER_TIMEOUT')) }, timeoutMs)
    request.end(bytes)
  })
}

export async function callBenchmarkModel({ provider, model, messages, settings = {}, timeoutMs = 60000 } = {}) {
  if (!Object.hasOwn(providers, provider)) fail('INVALID_PROVIDER')
  if (typeof model !== 'string' || !model || model.length > 256 || /[\r\n]/.test(model) ||
    !Array.isArray(messages) || !messages.length || messages.some(item => !item || typeof item !== 'object' || !['system', 'user', 'assistant', 'tool'].includes(item.role)) ||
    !settings || typeof settings !== 'object' || Array.isArray(settings) ||
    ['model', 'messages', 'stream', 'authorization', 'api_key', 'apiKey'].some(key => Object.hasOwn(settings, key)) ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) fail('INVALID_REQUEST')
  const key = process.env[providers[provider].key]
  if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) fail('MISSING_API_KEY')
  const url = endpointFor(provider), proxy = proxyFor()
  let body
  try { body = JSON.stringify({ model, messages, ...settings, stream: false }) } catch { fail('INVALID_REQUEST') }
  if (body.includes(key)) fail('INVALID_REQUEST')
  if (Buffer.byteLength(body) > maxRequestBytes) fail('REQUEST_TOO_LARGE')
  const started = performance.now()
  let response
  try { response = await postJson(url, body, key, timeoutMs, proxy) }
  catch (error) { fail(['RESPONSE_TOO_LARGE', 'PROVIDER_TIMEOUT'].includes(error?.message) ? error.message : 'TRANSPORT_FAILURE') }
  if (response.status !== 200) {
    if (response.status === 429) fail('PROVIDER_RATE_LIMIT')
    if (response.status === 401 || response.status === 403) fail('PROVIDER_AUTH_FAILURE')
    if (response.status === 402) fail('PROVIDER_PAYMENT_REQUIRED')
    if (response.status >= 500 && response.status <= 599) fail('PROVIDER_TRANSIENT_FAILURE')
    fail('PROVIDER_HTTP_FAILURE')
  }
  if (response.body.includes(key) || response.body.includes(JSON.stringify(key).slice(1, -1))) fail('PROVIDER_REFLECTED_CREDENTIAL')
  let value
  try { value = JSON.parse(response.body) } catch { fail('INVALID_PROVIDER_JSON') }
  const choice = value?.choices?.[0], content = choice?.message?.content
  if (typeof value?.model !== 'string' || !value.model || value.model.length > 256 || !Array.isArray(value.choices) || value.choices.length !== 1 ||
    choice.message?.role !== 'assistant' || (typeof content !== 'string' && content !== null) || !['stop', 'tool_calls', 'length'].includes(choice.finish_reason)) fail('INVALID_PROVIDER_RESPONSE')
  let usage
  try { usage = extractKJModelUsage('chat-completions', value) } catch { fail('INCOMPLETE_PROVIDER_USAGE') }
  if (usage.inputTokensSource !== 'reported' || usage.outputTokensSource !== 'reported' || usage.totalTokensSource !== 'reported' ||
    !count(usage.inputTokens) || !count(usage.outputTokens) || !count(usage.totalTokens) || usage.invalidFields.length) fail('INCOMPLETE_PROVIDER_USAGE')
  return { content, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens, cacheMissInputTokens: usage.cacheMissInputTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens }, elapsedMs: performance.now() - started, model: value.model,
    finishReason: choice.finish_reason,
    toolCalls: Array.isArray(choice.message.tool_calls) ? choice.message.tool_calls : [] }
}
