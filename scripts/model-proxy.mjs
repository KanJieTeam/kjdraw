// Optional loopback-only development transport. Provider credentials stay in this process.
const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
const loopbackHosts = ['localhost', '127.0.0.1', '[::1]']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

class ProxyError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}

function positiveLimit(value, fallback, maximum) {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) throw new Error('Invalid model proxy limit')
  return limit
}

function readRequest(req, limit, signal) {
  return new Promise((resolve, reject) => {
    let bytes = 0
    const chunks = []
    const cleanup = () => {
      req.off('data', data); req.off('end', end); req.off('error', error)
      signal.removeEventListener('abort', aborted)
    }
    const fail = reason => { cleanup(); req.resume(); reject(reason) }
    const data = chunk => {
      bytes += chunk.length
      if (bytes > limit) { fail(new ProxyError(413, 'MODEL_REQUEST_LIMIT')); return }
      chunks.push(chunk)
    }
    const end = () => {
      cleanup()
      try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { reject(new ProxyError(400, 'MODEL_REQUEST_INVALID')) }
    }
    const error = () => fail(new ProxyError(400, 'MODEL_REQUEST_INVALID'))
    const aborted = () => fail(signal.reason)
    if (signal.aborted) { aborted(); return }
    req.on('data', data); req.on('end', end); req.on('error', error)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

async function readResponse(response, limit) {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new ProxyError(502, 'MODEL_UPSTREAM_FAILED') }
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) throw new ProxyError(502, 'MODEL_RESPONSE_LIMIT')
      chunks.push(value)
    }
    const result = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
    if (!object(result)) throw new ProxyError(502, 'MODEL_RESPONSE_INVALID')
    return result
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Accept the SDK adapter's JSON body; the server alone chooses protocol, model and endpoint. */
export function createModelProxy(options) {
  const { protocol, model, endpoint, apiKey } = options
  let upstream
  try { upstream = new URL(endpoint) } catch { throw new Error('Invalid model proxy endpoint') }
  const loopback = loopbackHosts.includes(upstream.hostname)
  if (!protocols.includes(protocol) || typeof model !== 'string' || !model.trim() || model.length > 256) throw new Error('Invalid model proxy protocol or model')
  if (upstream.username || upstream.password || upstream.search || upstream.hash || (upstream.protocol !== 'https:' && !(upstream.protocol === 'http:' && loopback))) throw new Error('Model proxy requires a trusted HTTPS endpoint or HTTP loopback without URL credentials, query or fragment')
  if ((!loopback && !apiKey) || (apiKey !== undefined && (typeof apiKey !== 'string' || /[\r\n]/.test(apiKey)))) throw new Error('Configure the model API key in the server environment')
  const requestBytes = positiveLimit(options.maxRequestBytes, 1048576, 16777216)
  const responseBytes = positiveLimit(options.maxResponseBytes, 1048576, 16777216)
  const timeoutMs = positiveLimit(options.timeoutMs, 60000, 120000)
  const maxOutputTokens = positiveLimit(options.maxOutputTokens, 16384, 131072)
  const headers = { 'Content-Type': 'application/json' }
  if (protocol === 'anthropic-messages') { headers['anthropic-version'] = '2023-06-01'; if (apiKey) headers['x-api-key'] = apiKey }
  else if (protocol === 'gemini-generate-content') { if (apiKey) headers['x-goog-api-key'] = apiKey }
  else if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  return async function modelProxy(req, res) {
    const controller = new AbortController()
    let timer
    const disconnect = () => { if (!res.writableEnded) controller.abort(new ProxyError(499, 'MODEL_CANCELLED')) }
    res.on('close', disconnect)
    const respond = (status, value) => {
      if (res.destroyed || res.writableEnded) return
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status >= 400 ? { Connection: 'close' } : {}) })
      res.end(JSON.stringify(value))
    }
    try {
      if (req.method !== 'POST') throw new ProxyError(405, 'MODEL_METHOD_NOT_ALLOWED')
      let host
      try { host = new URL(`http://${req.headers.host}`) } catch { throw new ProxyError(403, 'MODEL_ORIGIN_REJECTED') }
      if (!loopbackHosts.includes(host.hostname) || host.username || host.password || host.pathname !== '/' || host.search || host.hash || Number(host.port || 80) !== req.socket.localPort || req.headers.origin !== host.origin) throw new ProxyError(403, 'MODEL_ORIGIN_REJECTED')
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new ProxyError(415, 'MODEL_JSON_REQUIRED')
      if (Number(req.headers['content-length']) > requestBytes) throw new ProxyError(413, 'MODEL_REQUEST_LIMIT')
      timer = setTimeout(() => controller.abort(new ProxyError(504, 'MODEL_TIMEOUT')), timeoutMs)
      let body
      try { body = JSON.parse(await readRequest(req, requestBytes, controller.signal)) } catch (error) { if (error instanceof ProxyError) throw error; throw new ProxyError(400, 'MODEL_REQUEST_INVALID') }
      if (!object(body) || (body.stream !== undefined && body.stream !== false) || (protocol === 'gemini-generate-content' ? 'model' in body : body.model !== model)) throw new ProxyError(400, 'MODEL_REQUEST_INVALID')
      const tokenLimits = protocol === 'gemini-generate-content' ? [body.generationConfig?.maxOutputTokens] : protocol === 'responses' ? [body.max_output_tokens] : [body.max_tokens, body.max_completion_tokens].filter(value => value !== undefined)
      if (!tokenLimits.length || tokenLimits.some(value => !Number.isSafeInteger(value) || value < 1 || value > maxOutputTokens)) throw new ProxyError(400, 'MODEL_TOKEN_LIMIT')
      const response = await fetch(upstream, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' })
      const result = await readResponse(response, responseBytes)
      if (apiKey && JSON.stringify(result).includes(apiKey)) throw new ProxyError(502, 'MODEL_UPSTREAM_FAILED')
      respond(200, result)
    } catch (error) {
      const failure = controller.signal.aborted ? controller.signal.reason : error
      respond(failure instanceof ProxyError ? failure.status : 502, { error: { code: failure instanceof ProxyError ? failure.code : 'MODEL_UPSTREAM_FAILED' } })
    } finally { clearTimeout(timer); res.off('close', disconnect) }
  }
}

export function modelProxyFromEnvironment(env = process.env) {
  const names = ['KJDRAW_MODEL_PROTOCOL', 'KJDRAW_MODEL_NAME', 'KJDRAW_MODEL_ENDPOINT', 'KJDRAW_MODEL_API_KEY']
  if (!names.some(name => env[name] !== undefined)) return null
  if (!names.slice(0, 3).every(name => env[name])) throw new Error('Set KJDRAW_MODEL_PROTOCOL, KJDRAW_MODEL_NAME and KJDRAW_MODEL_ENDPOINT together')
  return createModelProxy({ protocol: env.KJDRAW_MODEL_PROTOCOL, model: env.KJDRAW_MODEL_NAME, endpoint: env.KJDRAW_MODEL_ENDPOINT, apiKey: env.KJDRAW_MODEL_API_KEY })
}
