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

function containsCredential(value, apiKey) {
  if (!apiKey) return false
  if (typeof value === 'string') return value.includes(apiKey)
  if (Array.isArray(value)) return value.some(item => containsCredential(item, apiKey))
  if (object(value)) return Object.values(value).some(item => containsCredential(item, apiKey))
  return false
}

function containsArgumentCredential(value, apiKey) {
  if (!apiKey || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(item => containsArgumentCredential(item, apiKey))
  if ((value.type === 'function_call' || object(value.function)) && typeof (value.arguments ?? value.function?.arguments) === 'string') {
    try {
      if (containsCredential(JSON.parse(value.arguments ?? value.function.arguments), apiKey)) return true
    } catch { /* Incremental, incomplete arguments are checked by their stream slots. */ }
  }
  return Object.values(value).some(item => containsArgumentCredential(item, apiKey))
}

// Only actual delta slots concatenate across events. Metadata such as "tool_calls"
// and model names are complete values, not text fragments of a credential.
function inspectCredentialDeltas(value, apiKey, tails, state) {
  let reflected = false
  const track = (slot, fragment) => {
    if (!apiKey || typeof fragment !== 'string') return
    const combined = (tails.get(slot) ?? '') + fragment
    if (combined.includes(apiKey)) reflected = true
    tails.set(slot, combined.slice(Math.max(0, combined.length - apiKey.length + 1)))
  }
  // Function arguments are JSON inside the already decoded SSE JSON. Inspect
  // that additional escape layer too, across arbitrary argument fragment cuts.
  const trackArguments = (slot, fragment) => {
    if (!apiKey || typeof fragment !== 'string') return
    const raw = (state.argumentEscapes.get(slot) ?? '') + fragment
    let decoded = '', pendingEscape = ''
    const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
    for (let index = 0; index < raw.length; index++) {
      if (raw[index] !== '\\') { decoded += raw[index]; continue }
      if (index + 1 >= raw.length) { pendingEscape = raw.slice(index); break }
      if (raw[index + 1] === 'u') {
        const digits = raw.slice(index + 2, index + 6)
        if (!/^[a-fA-F0-9]*$/.test(digits)) throw new ProxyError(502, 'MODEL_RESPONSE_INVALID')
        if (digits.length < 4) { pendingEscape = raw.slice(index); break }
        decoded += String.fromCharCode(parseInt(digits, 16)); index += 5
      } else {
        if (!Object.hasOwn(escapes, raw[index + 1])) throw new ProxyError(502, 'MODEL_RESPONSE_INVALID')
        decoded += escapes[raw[++index]]
      }
    }
    if (pendingEscape) state.argumentEscapes.set(slot, pendingEscape)
    else state.argumentEscapes.delete(slot)
    track(slot, decoded)
  }
  const clear = prefix => {
    for (const slot of tails.keys()) if (slot.startsWith(prefix)) tails.delete(slot)
    for (const slot of state.argumentEscapes.keys()) if (slot.startsWith(prefix)) throw new ProxyError(502, 'MODEL_RESPONSE_INVALID')
  }
  if (state.protocol === 'chat-completions' && Array.isArray(value.choices)) for (const [ordinal, choice] of value.choices.entries()) {
    if (!object(choice)) continue
    const prefix = `chat:${Number.isSafeInteger(choice.index) ? choice.index : ordinal}:`
    if (state.closedChoices.has(prefix)) throw new ProxyError(502, 'MODEL_RESPONSE_INVALID')
    const delta = choice.delta
    if (object(delta)) {
      for (const field of ['content', 'refusal', 'reasoning_content', 'reasoning']) track(prefix + field, delta[field])
      if (object(delta.function_call)) {
        track(prefix + 'function:name', delta.function_call.name)
        trackArguments(prefix + 'function:arguments', delta.function_call.arguments)
      }
      if (Array.isArray(delta.tool_calls)) for (const [toolOrdinal, tool] of delta.tool_calls.entries()) {
        if (!object(tool)) continue
        const slot = `${prefix}tool:${Number.isSafeInteger(tool.index) ? tool.index : toolOrdinal}:`
        track(slot + 'id', tool.id)
        if (object(tool.function)) {
          track(slot + 'name', tool.function.name)
          trackArguments(slot + 'arguments', tool.function.arguments)
        }
      }
    }
    // The finish marker closes all fragments for this choice. A harmless final
    // "s" may now be released, but a completed credential above still fails.
    if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
      clear(prefix)
      state.closedChoices.add(prefix)
    }
  }
  if (state.protocol === 'responses') {
    if (state.responseCompleted) throw new ProxyError(502, 'MODEL_RESPONSE_INVALID')
    if (typeof value.type === 'string' && value.type.endsWith('.delta') && typeof value.delta === 'string') {
      const slot = `responses:${value.type}:${value.item_id ?? value.output_index ?? ''}:${value.content_index ?? ''}:${value.summary_index ?? ''}`
      if (value.type === 'response.function_call_arguments.delta') trackArguments(slot, value.delta)
      else track(slot, value.delta)
    }
    if (value.type === 'response.completed') {
      if (state.argumentEscapes.size) throw new ProxyError(502, 'MODEL_RESPONSE_INVALID')
      tails.clear()
      state.responseCompleted = true
    }
  }
  return reflected
}

function hasCredentialPrefix(apiKey, tails) {
  if (!apiKey) return false
  return [...tails.values()].some(tail => {
    for (let length = Math.min(tail.length, apiKey.length - 1); length > 0; length--) if (apiKey.startsWith(tail.slice(-length))) return true
    return false
  })
}

async function streamResponse(response, res, limit, apiKey, protocol) {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new ProxyError(502, 'MODEL_UPSTREAM_FAILED') }
  if (!/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new ProxyError(502, 'MODEL_RESPONSE_INVALID')
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }), tails = new Map()
  const credentialState = { protocol, closedChoices: new Set(), responseCompleted: false, argumentEscapes: new Map() }
  let bytes = 0, buffer = '', data = [], pending = [], wrote = false, finished = false
  const write = async payload => {
    if (!wrote) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' })
      wrote = true
    }
    if (!res.write(`data: ${payload}\n\n`)) await new Promise((resolve, reject) => { res.once('drain', resolve); res.once('error', reject) })
  }
  const emit = async () => {
    const payload = data.join('\n'); data = []
    if (!payload) return
    if (payload === '[DONE]') {
      if (pending.length) throw new ProxyError(502, 'MODEL_UPSTREAM_FAILED')
      finished = true; await write(payload); return
    } else {
      let value
      try { value = JSON.parse(payload) } catch { throw new ProxyError(502, 'MODEL_RESPONSE_INVALID') }
      const escaped = JSON.stringify(apiKey ?? '').slice(1, -1)
      if (!object(value) || (apiKey && (payload.includes(apiKey) || (escaped && payload.includes(escaped)) || containsCredential(value, apiKey) || containsArgumentCredential(value, apiKey)))) throw new ProxyError(502, 'MODEL_UPSTREAM_FAILED')
      if (inspectCredentialDeltas(value, apiKey, tails, credentialState)) throw new ProxyError(502, 'MODEL_UPSTREAM_FAILED')
    }
    pending.push(payload)
    if (credentialState.argumentEscapes.size || hasCredentialPrefix(apiKey, tails)) return
    const ready = pending; pending = []
    for (const item of ready) await write(item)
  }
  try {
    while (!finished) {
      const { done, value } = await reader.read(); if (done) break
      bytes += value.byteLength; if (bytes > limit) throw new ProxyError(502, 'MODEL_RESPONSE_LIMIT')
      buffer += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line === '') await emit()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
    }
    buffer += decoder.decode()
    if (!finished && buffer) { if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1); if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, '')) }
    if (!finished) await emit()
    if (pending.length) throw new ProxyError(502, 'MODEL_UPSTREAM_FAILED')
    if (!wrote) throw new ProxyError(502, 'MODEL_RESPONSE_INVALID')
    res.end()
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
  if (options.chatStreamToolCalls !== undefined && typeof options.chatStreamToolCalls !== 'boolean') throw new Error('Invalid model proxy stream-tool setting')
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
      if (!object(body) || (body.stream !== undefined && typeof body.stream !== 'boolean') || (body.stream === true && !['chat-completions', 'responses'].includes(protocol)) || 'tool_stream' in body || (protocol === 'gemini-generate-content' ? 'model' in body : body.model !== model)) throw new ProxyError(400, 'MODEL_REQUEST_INVALID')
      const tokenLimits = protocol === 'gemini-generate-content' ? [body.generationConfig?.maxOutputTokens] : protocol === 'responses' ? [body.max_output_tokens] : [body.max_tokens, body.max_completion_tokens].filter(value => value !== undefined)
      if (!tokenLimits.length || tokenLimits.some(value => !Number.isSafeInteger(value) || value < 1 || value > maxOutputTokens)) throw new ProxyError(400, 'MODEL_TOKEN_LIMIT')
      if (protocol === 'chat-completions' && body.stream === true && options.chatStreamToolCalls === true) body.tool_stream = true
      const response = await fetch(upstream, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' })
      if (body.stream === true && /^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { await streamResponse(response, res, responseBytes, apiKey, protocol); return }
      const result = await readResponse(response, responseBytes)
      if (apiKey && JSON.stringify(result).includes(apiKey)) throw new ProxyError(502, 'MODEL_UPSTREAM_FAILED')
      respond(200, result)
    } catch (error) {
      const failure = controller.signal.aborted ? controller.signal.reason : error
      if (res.headersSent) res.destroy()
      else respond(failure instanceof ProxyError ? failure.status : 502, { error: { code: failure instanceof ProxyError ? failure.code : 'MODEL_UPSTREAM_FAILED' } })
    } finally { clearTimeout(timer); res.off('close', disconnect) }
  }
}

export function modelProxyFromEnvironment(env = process.env) {
  const names = ['KJDRAW_MODEL_PROTOCOL', 'KJDRAW_MODEL_NAME', 'KJDRAW_MODEL_ENDPOINT', 'KJDRAW_MODEL_API_KEY', 'KJDRAW_MODEL_MAX_OUTPUT_TOKENS', 'KJDRAW_MODEL_CHAT_TOOL_STREAM']
  if (!names.some(name => env[name] !== undefined)) return null
  if (!names.slice(0, 3).every(name => env[name])) throw new Error('Set KJDRAW_MODEL_PROTOCOL, KJDRAW_MODEL_NAME and KJDRAW_MODEL_ENDPOINT together')
  const configuredLimit=env.KJDRAW_MODEL_MAX_OUTPUT_TOKENS
  if(configuredLimit!==undefined&&(typeof configuredLimit!=='string'||!/^\d+$/.test(configuredLimit)))throw new Error('Set KJDRAW_MODEL_MAX_OUTPUT_TOKENS to an integer from 1 to 131072')
  const toolStream=env.KJDRAW_MODEL_CHAT_TOOL_STREAM
  if(toolStream!==undefined&&!['true','false'].includes(toolStream))throw new Error('Set KJDRAW_MODEL_CHAT_TOOL_STREAM to true or false')
  return createModelProxy({ protocol: env.KJDRAW_MODEL_PROTOCOL, model: env.KJDRAW_MODEL_NAME, endpoint: env.KJDRAW_MODEL_ENDPOINT, apiKey: env.KJDRAW_MODEL_API_KEY, ...(configuredLimit===undefined?{}:{maxOutputTokens:positiveLimit(Number(configuredLimit),16384,131072)}), ...(toolStream===undefined?{}:{chatStreamToolCalls:toolStream==='true'}) })
}
