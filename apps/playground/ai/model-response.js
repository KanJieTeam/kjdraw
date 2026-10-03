const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
// Framing is not CAD content: many small SSE deltas repeat protocol metadata.
// Bound both transport work and each JSON event independently; the SDK still
// validates the complete assembled model payload before dispatching any call.
const DEFAULT_MAX_STREAM_BYTES = 8 * 1024 * 1024
const MAX_EVENT_BYTES = 1024 * 1024
const encoder = new TextEncoder()
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Decode transport bytes only. The SDK validates complete model turns and
 * assembles tool-call fragments before any call can reach the CAD session. */
async function* responseText(response, { signal, maxBytes }) {
  signal?.throwIfAborted()
  if (!response.body) throw new Error('Model endpoint returned no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    signal?.throwIfAborted()
    while (true) {
      const { value, done } = await reader.read()
      signal?.throwIfAborted()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw new Error('Model response exceeds budget')
      yield decoder.decode(value, { stream: true })
    }
    const tail = decoder.decode()
    if (tail) yield tail
  } finally {
    signal?.removeEventListener('abort', cancel)
    // Cancellation may be backed by an arbitrary browser/provider source;
    // releasing this reader must not wait for its own cancellation promise.
    cancel()
    reader.releaseLock()
  }
}

async function* responseEvents(response, options) {
  let buffer = '', data = [], dataBytes = 0
  const event = () => {
    const value = data.join('\n')
    data = []
    dataBytes = 0
    if (!value) return undefined
    if (value === '[DONE]') return null
    let json
    try { json = JSON.parse(value) } catch { throw new Error('Model endpoint returned invalid event data') }
    if (!isObject(json)) throw new Error('Model endpoint returned invalid event data')
    return json
  }
  const line = value => {
    if (!value) return event()
    // Comments, event/id/retry fields and unknown SSE fields carry no JSON.
    if (value === 'data' || value.startsWith('data:')) {
      const part = value === 'data' ? '' : value.slice(5).replace(/^ /, '')
      dataBytes += encoder.encode(part).byteLength + (data.length ? 1 : 0)
      if (dataBytes > options.maxEventBytes) throw new Error('Model event exceeds budget')
      data.push(part)
    }
    return undefined
  }
  for await (const text of responseText(response, options)) {
    buffer += text
    while (true) {
      const newline = buffer.search(/[\r\n]/)
      if (newline < 0) break
      // A CR at a chunk boundary may be half of CRLF. Keep it until the next
      // bytes arrive so a split terminator cannot dispatch an extra event.
      if (buffer[newline] === '\r' && newline === buffer.length - 1) break
      const completedLine = buffer.slice(0, newline)
      if (encoder.encode(completedLine).byteLength > options.maxEventBytes + 6) throw new Error('Model event line exceeds budget')
      const value = line(completedLine)
      const width = buffer[newline] === '\r' && buffer[newline + 1] === '\n' ? 2 : 1
      buffer = buffer.slice(newline + width)
      if (value === null) return
      if (value !== undefined) yield value
    }
    const partialLine = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
    if (encoder.encode(partialLine).byteLength > options.maxEventBytes + 6) throw new Error('Model event line exceeds budget')
  }
  if (buffer.endsWith('\r')) {
    const value = line(buffer.slice(0, -1))
    buffer = ''
    if (value === null) return
    if (value !== undefined) yield value
  }
  if (buffer) line(buffer)
  // SSE dispatches only blank-line-terminated events. A partial event at EOF
  // must not turn incomplete tool arguments into a completed model response.
  if (data.length) throw new Error('Model event stream ended inside an event')
}

/** A bounded, cancellation-aware browser JSON/SSE transport. Returning an
 * async iterable lets the SDK notify the UI while network bytes are arriving. */
export async function readAiModelResponse(response, { signal, maxBytes } = {}) {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) throw new Error('Invalid model response budget')
  const contentType = response.headers.get('content-type') ?? ''
  if (response.ok && /^text\/event-stream(?:\s*;|$)/i.test(contentType)) {
    return responseEvents(response, { signal, maxBytes: maxBytes ?? DEFAULT_MAX_STREAM_BYTES,
      maxEventBytes: Math.min(maxBytes ?? MAX_EVENT_BYTES, MAX_EVENT_BYTES) })
  }
  let text = ''
  for await (const chunk of responseText(response, { signal, maxBytes: maxBytes ?? DEFAULT_MAX_BYTES })) text += chunk
  let json
  try { json = JSON.parse(text) } catch { throw new Error('Model endpoint returned invalid JSON') }
  if (!isObject(json)) throw new Error('Model endpoint returned invalid JSON')
  if (!response.ok) throw new Error('Model endpoint failed')
  return json
}
