import type { KJAgentToolDefinition, KJAgentToolResult } from './agent-tools.js'
import { KJDrawError } from './errors.js'
import { deepFreeze } from './utils.js'
import { extractKJModelUsage, type KJModelUsage } from './model-usage.js'

export type KJModelProtocol = 'responses' | 'chat-completions' | 'anthropic-messages' | 'gemini-generate-content'
export interface KJModelToolCall { readonly id: string; readonly name: string; readonly arguments: unknown }
export interface KJModelToolOutput { readonly id: string; readonly name: string; readonly result: KJAgentToolResult }
export interface KJModelTurn { readonly text: string; readonly calls: readonly KJModelToolCall[]; readonly usage?: KJModelUsage }
/** Explicit host-provided attachment. Wire support does not imply the selected model supports vision. */
export type KJModelImage = { readonly dataUrl: string } | { readonly mimeType: 'image/png' | 'image/jpeg'; readonly base64: string }
export type KJModelInput = { readonly kind: 'prompt'; readonly text: string; readonly images?: readonly KJModelImage[] } | { readonly kind: 'tool-results'; readonly results: readonly KJModelToolOutput[] }
export interface KJModelConversation {
  next(input: KJModelInput, signal: AbortSignal): Promise<KJModelTurn>
}
/** Custom models and framework/harness bridges implement this interface; no vendor SDK is required. */
export interface KJAgentModel {
  createConversation(options: KJModelConversationOptions): KJModelConversation
}
export interface KJModelConversationOptions {
  readonly instructions: string
  readonly tools: readonly KJAgentToolDefinition[]
  /** One observation per received transport response, even when response parsing later fails. Exceptions are isolated. */
  readonly onUsage?: (usage: KJModelUsage) => void
}
export interface KJModelRequest {
  readonly protocol: KJModelProtocol
  readonly model: string
  /** REST JSON body. Gemini's model belongs in the URL, not this body. */
  readonly body: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
}
export interface KJModelAdapterOptions {
  protocol: KJModelProtocol
  model: string
  /** Trusted host transport owns credentials, endpoint allowlisting and HTTP errors; return parsed, non-streaming JSON. */
  request: (request: KJModelRequest) => Promise<unknown>
  maxOutputTokens?: number
  /** Compatible endpoints differ; choose the field accepted by the selected model. */
  chatTokenParameter?: 'max_tokens' | 'max_completion_tokens'
  maxResponseBytes?: number
  maxHistoryBytes?: number
  /** Host-only observer; contains counters and timing, never response text or credentials. Exceptions are isolated. */
  onUsage?: (usage: KJModelUsage) => void
}
export class KJModelError extends KJDrawError {
  constructor(code: string, message: string) { super(message, { code }) }
}

function invalid(message: string): never { throw new KJModelError('KJMODEL_PROTOCOL', message) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a JSON object from the model transport')
  return value as Record<string, unknown>
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid('Expected a complete model response array')
  return value
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) invalid('Missing or invalid tool identifier')
  return value
}
function jsonArguments(value: unknown): unknown {
  if (typeof value !== 'string') invalid('Tool arguments must be a JSON string')
  try { return JSON.parse(value) } catch { return null } // Runtime schema validation returns an actionable tool error.
}
function jsonCopy<T>(value: T, budget: number): T {
  const serialized = JSON.stringify(value)
  if (!serialized || new TextEncoder().encode(serialized).length > budget) throw new KJModelError('KJMODEL_SIZE_LIMIT', 'Model response or conversation exceeds its configured JSON byte limit')
  return JSON.parse(serialized) as T
}
const IMAGE_BYTES = 1048576
function imageDimensions(width: number, height: number): void {
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 16777216) invalid('Image dimensions exceed the supported 16-megapixel limit')
}
/** Validate bounded image containers without executing a decoder or loading remote resources. Pixel decoding remains the provider's responsibility. */
function imageContainer(bytes: Uint8Array, mimeType: string): void {
  const u16 = (offset: number) => bytes[offset]! * 256 + bytes[offset + 1]!
  const u32 = (offset: number) => bytes[offset]! * 16777216 + bytes[offset + 1]! * 65536 + bytes[offset + 2]! * 256 + bytes[offset + 3]!
  if (mimeType === 'image/png') {
    if (bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) invalid('Image bytes do not match PNG media type')
    let offset = 8, header = false, data = false, palette = false, indexed = false
    while (offset + 12 <= bytes.length) {
      const length = u32(offset), end = offset + 12 + length
      if (end > bytes.length) invalid('Truncated PNG image chunk')
      const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
      let crc = 0xffffffff
      for (let i = offset + 4; i < end - 4; i++) {
        crc ^= bytes[i]!
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
      }
      if (((crc ^ 0xffffffff) >>> 0) !== u32(end - 4)) invalid('PNG image checksum mismatch')
      if (!header && kind !== 'IHDR') invalid('PNG image requires an initial header')
      if (kind === 'IHDR') {
        if (header || length !== 13) invalid('Invalid PNG image header')
        imageDimensions(u32(offset + 8), u32(offset + 12))
        const depth = bytes[offset + 16]!, color = bytes[offset + 17]!, allowed: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
        if (!allowed[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20]! > 1) invalid('Unsupported PNG image header')
        header = true; indexed = color === 3
      } else if (kind === 'PLTE') {
        if (data || !length || length % 3 || length > 768) invalid('Invalid PNG palette')
        palette = true
      } else if (kind === 'IDAT') {
        if (indexed && !palette) invalid('Indexed PNG requires a palette')
        data ||= length > 0
      } else if (kind === 'IEND') {
        if (length !== 0 || !data || end !== bytes.length) invalid('Invalid PNG image end')
        return
      }
      offset = end
    }
    invalid('PNG image is incomplete')
  }
  if (bytes.length < 16 || bytes[0] !== 255 || bytes[1] !== 216) invalid('Image bytes do not match JPEG media type')
  let offset = 2, frame = false, scan = false
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) invalid('Invalid JPEG marker')
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 217) { if (!frame || !scan || offset !== bytes.length) invalid('Invalid JPEG image end'); return }
    if (marker === undefined || marker === 0 || marker === 216 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) invalid('Invalid JPEG image structure')
    const length = u16(offset), end = offset + length
    if (length < 2 || end > bytes.length) invalid('Truncated JPEG image segment')
    if ([192, 193, 194].includes(marker)) {
      if (frame || length < 8) invalid('Invalid JPEG frame')
      imageDimensions(u16(offset + 5), u16(offset + 3)); frame = true
      if (length !== 8 + 3 * bytes[offset + 7]!) invalid('Invalid JPEG frame components')
    }
    offset = end
    if (marker === 218) {
      if (!frame || length < 6) invalid('JPEG scan requires a valid frame')
      scan = true
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { offset++; continue }
        const next = bytes[offset + 1]
        if (next === 0 || next !== undefined && next >= 208 && next <= 215) { offset += 2; continue }
        break
      }
    }
  }
  invalid('JPEG image is incomplete')
}
function imagesForPrompt(input: KJModelInput): { mimeType: string; base64: string; dataUrl: string }[] {
  const descriptor = Object.getOwnPropertyDescriptor(input, 'images')
  if (!descriptor) { if ('images' in input) invalid('Image attachments must be explicit own properties'); return [] }
  if (!('value' in descriptor) || !descriptor.enumerable) invalid('Image attachments must not use accessors or hidden fields')
  const images = descriptor.value
  if (images === undefined) return []
  if (!Array.isArray(images) || Object.getPrototypeOf(images) !== Array.prototype || images.length > 2 || Reflect.ownKeys(images).length !== images.length + 1) invalid('Supply at most two explicit image attachments')
  const output = []
  for (let index = 0; index < images.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(images, String(index))
    if (!entry || !entry.enumerable || !('value' in entry)) invalid('Image attachment arrays must contain plain indexed values')
    const image = entry.value
    if (!image || typeof image !== 'object' || Array.isArray(image) || ![Object.prototype, null].includes(Object.getPrototypeOf(image))) invalid('Image attachment must be a plain object')
    const values: Record<string, unknown> = Object.create(null)
    for (const key of Reflect.ownKeys(image)) {
      if (typeof key !== 'string' || !['dataUrl', 'mimeType', 'base64'].includes(key)) invalid('Unsupported image attachment field')
      const field = Object.getOwnPropertyDescriptor(image, key)!
      if (!field.enumerable || !('value' in field)) invalid('Image attachment fields must not use accessors')
      values[key] = field.value
    }
    let mimeType: unknown, base64: unknown
    if ('dataUrl' in values) {
      if (Object.keys(values).length !== 1 || typeof values.dataUrl !== 'string' || values.dataUrl.length > 1398130) invalid('Provide one bounded PNG/JPEG data URL')
      const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(values.dataUrl)
      if (!match) invalid('Only inline base64 PNG/JPEG data URLs are allowed; external URLs are not fetched')
      mimeType = match[1]; base64 = match[2]
    } else {
      if (Object.keys(values).length !== 2) invalid('Image attachment requires mimeType and base64')
      mimeType = values.mimeType; base64 = values.base64
    }
    if (!['image/png', 'image/jpeg'].includes(mimeType as string) || typeof base64 !== 'string' || !base64.length || base64.length > 1398104 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) invalid('Invalid PNG/JPEG base64 attachment')
    let binary: string
    try { binary = atob(base64) } catch { return invalid('Invalid image base64 encoding') }
    if (binary.length > IMAGE_BYTES) throw new KJModelError('KJMODEL_SIZE_LIMIT', 'Each image attachment is limited to 1 MiB of decoded bytes')
    if (btoa(binary) !== base64) invalid('Image attachment requires canonical base64 encoding')
    imageContainer(Uint8Array.from(binary, char => char.charCodeAt(0)), mimeType as string)
    output.push({ mimeType: mimeType as string, base64, dataUrl: `data:${mimeType};base64,${base64}` })
  }
  return output
}
function limit(value: number | undefined, fallback: number, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) invalid('Invalid model adapter limit')
  return resolved
}
function notifyUsage(observer: ((usage: KJModelUsage) => void) | undefined, usage: KJModelUsage): void {
  try { void Promise.resolve(observer?.(usage)).catch(() => {}) } catch { /* Accounting observers must not alter CAD or model execution. */ }
}

/** Four wire formats, one CAD tool schema. This adapter never fetches, approves edits or selects a model. */
export function createKJModelAdapter(options: KJModelAdapterOptions): KJAgentModel {
  const { protocol, request, onUsage: adapterUsage } = options
  if (!['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content'].includes(protocol) || typeof request !== 'function') invalid('Choose an explicit protocol and host transport')
  if (adapterUsage !== undefined && typeof adapterUsage !== 'function') invalid('onUsage must be a function')
  const model = identifier(options.model)
  const outputTokens = limit(options.maxOutputTokens, 4096, 131072)
  const chatTokenParameter = options.chatTokenParameter ?? 'max_tokens'
  if (!['max_tokens', 'max_completion_tokens'].includes(chatTokenParameter)) invalid('Unsupported chat token-limit field')
  const responseBytes = limit(options.maxResponseBytes, 1048576, 16777216)
  const historyBytes = limit(options.maxHistoryBytes, 2097152, 16777216)
  return Object.freeze({
    createConversation({ instructions, tools, onUsage }: KJModelConversationOptions): KJModelConversation {
      if (onUsage !== undefined && typeof onUsage !== 'function') invalid('onUsage must be a function')
      const definitions = tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema }))
      const schema = jsonCopy(definitions, historyBytes)
      const history: unknown[] = []
      let pending: readonly KJModelToolCall[] = []
      let started = false, busy = false, ended = false, turnNumber = 0
      const geminiIds = new Map<string, string>()
      return {
        async next(input: KJModelInput, signal: AbortSignal): Promise<KJModelTurn> {
          if (busy || ended) invalid('Conversation is busy or has ended; start a fresh conversation')
          busy = true
          try {
            signal.throwIfAborted()
            if (!started) {
              if (input.kind !== 'prompt' || typeof input.text !== 'string') invalid('A conversation starts with a prompt')
              const images = imagesForPrompt(input)
              started = true
              if (protocol === 'gemini-generate-content') history.push({ role: 'user', parts: [{ text: input.text }, ...images.map(image => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } }))] })
              else if (!images.length) history.push({ role: 'user', content: input.text })
              else if (protocol === 'responses') history.push({ role: 'user', content: [{ type: 'input_text', text: input.text }, ...images.map(image => ({ type: 'input_image', image_url: image.dataUrl }))] })
              else if (protocol === 'chat-completions') history.push({ role: 'user', content: [{ type: 'text', text: input.text }, ...images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }))] })
              else history.push({ role: 'user', content: [...images.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } })), { type: 'text', text: input.text }] })
            } else {
              if (input.kind !== 'tool-results' || input.results.length !== pending.length || !pending.length) invalid('Every pending tool call needs exactly one result')
              const results = input.results
              for (let index = 0; index < pending.length; index++) {
                if (results[index]?.id !== pending[index]!.id || results[index]?.name !== pending[index]!.name) invalid('Tool results must preserve the original call IDs, names and order')
              }
              if (protocol === 'responses') history.push(...results.map(item => ({ type: 'function_call_output', call_id: item.id, output: JSON.stringify(item.result) })))
              else if (protocol === 'chat-completions') history.push(...results.map(item => ({ role: 'tool', tool_call_id: item.id, content: JSON.stringify(item.result) })))
              else if (protocol === 'anthropic-messages') history.push({ role: 'user', content: results.map(item => ({ type: 'tool_result', tool_use_id: item.id, content: JSON.stringify(item.result), is_error: !item.result.ok })) })
              else history.push({ role: 'function', parts: results.map(item => ({ functionResponse: { ...(geminiIds.has(item.id) ? { id: geminiIds.get(item.id) } : {}), name: item.name, response: item.result } })) })
            }
            let body: Record<string, unknown>
            if (protocol === 'responses') body = { model, instructions, input: history, tools: schema.map(tool => ({ type: 'function', ...tool, strict: false })), max_output_tokens: outputTokens, store: false, include: ['reasoning.encrypted_content'] }
            else if (protocol === 'chat-completions') body = { model, messages: [{ role: 'system', content: instructions }, ...history], tools: schema.map(tool => ({ type: 'function', function: tool })), [chatTokenParameter]: outputTokens, stream: false }
            else if (protocol === 'anthropic-messages') body = { model, system: instructions, messages: history, tools: schema.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })), max_tokens: outputTokens, stream: false }
            else body = { systemInstruction: { parts: [{ text: instructions }] }, contents: history, tools: [{ functionDeclarations: schema.map(tool => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }], generationConfig: { maxOutputTokens: outputTokens, candidateCount: 1 } }
            // Never expose mutable internal history, or credentials, through the public result.
            const outgoing = deepFreeze(jsonCopy(body, historyBytes))
            const startedAt = performance.now()
            const rawResponse = await request({ protocol, model, body: outgoing, signal })
            const usage = extractKJModelUsage(protocol, rawResponse, { latencyMs: Math.max(0, performance.now() - startedAt) })
            notifyUsage(onUsage, usage)
            notifyUsage(adapterUsage, usage)
            const response = record(jsonCopy(rawResponse, responseBytes))
            signal.throwIfAborted()
            turnNumber++
            let text = ''
            const calls: KJModelToolCall[] = []
            const addCall = (id: unknown, name: unknown, args: unknown) => calls.push({ id: identifier(id), name: identifier(name), arguments: args })
            if (protocol === 'responses') {
              if (response.status !== 'completed') throw new KJModelError('KJMODEL_INCOMPLETE', 'Response is incomplete or failed; no tool calls were dispatched')
              const output = array(response.output)
              for (const raw of output) {
                const item = record(raw)
                if (item.type === 'function_call') addCall(item.call_id, item.name, jsonArguments(item.arguments))
                else if (item.type === 'message') {
                  if (item.role !== 'assistant') invalid('Expected an assistant response')
                  for (const rawPart of array(item.content)) { const part = record(rawPart); if (part.type === 'output_text' && typeof part.text === 'string') text += part.text; else if (part.type === 'refusal') throw new KJModelError('KJMODEL_REFUSED', 'The model refused this request'); else invalid('Unsupported Responses message content') }
                } else if (item.type !== 'reasoning') invalid('Unsupported Responses output item; use a custom adapter for additional tools')
              }
              history.push(...output) // Includes reasoning items and opaque encrypted content.
            } else if (protocol === 'chat-completions') {
              const choices = array(response.choices)
              if (choices.length !== 1) invalid('Expected exactly one model choice')
              const choice = record(choices[0]), message = record(choice.message)
              if (!['stop', 'tool_calls'].includes(String(choice.finish_reason))) throw new KJModelError('KJMODEL_INCOMPLETE', 'Chat response is truncated, blocked or incomplete')
              if (message.role !== 'assistant') invalid('Expected an assistant message')
              if (message.refusal) throw new KJModelError('KJMODEL_REFUSED', 'The model refused this request')
              if (message.content !== null && message.content !== undefined && typeof message.content !== 'string') invalid('Only text and function-call chat messages are supported')
              text = typeof message.content === 'string' ? message.content : ''
              for (const raw of array(message.tool_calls ?? [])) { const item = record(raw), fn = record(item.function); if (item.type !== 'function') invalid('Unsupported chat tool type'); addCall(item.id, fn.name, jsonArguments(fn.arguments)) }
              // Some compatible endpoints finish valid function-call messages with stop.
              // Completeness is enforced above; call structure and IDs are still validated.
              if (choice.finish_reason === 'tool_calls' && !calls.length) invalid('Chat finish reason requires tool calls')
              history.push(message) // Preserve provider fields such as reasoning_content verbatim.
            } else if (protocol === 'anthropic-messages') {
              if (response.role !== 'assistant') invalid('Expected an assistant message')
              if (!['end_turn', 'tool_use', 'stop_sequence'].includes(String(response.stop_reason))) throw new KJModelError('KJMODEL_INCOMPLETE', 'Claude response is truncated, paused or incomplete')
              const content = array(response.content)
              for (const raw of content) { const item = record(raw); if (item.type === 'tool_use') addCall(item.id, item.name, item.input); else if (item.type === 'text' && typeof item.text === 'string') text += item.text; else if (!['thinking', 'redacted_thinking'].includes(String(item.type))) invalid('Unsupported Claude content block') }
              if ((response.stop_reason === 'tool_use') !== (calls.length > 0)) invalid('Claude stop reason does not match its tool calls')
              history.push({ role: 'assistant', content }) // Preserve signed thinking blocks.
            } else {
              const candidates = array(response.candidates)
              if (candidates.length !== 1) invalid('Expected exactly one Gemini candidate')
              const candidate = record(candidates[0])
              if (candidate.finishReason !== 'STOP') throw new KJModelError('KJMODEL_INCOMPLETE', 'Gemini response is blocked, truncated or incomplete')
              const content = record(candidate.content)
              if (content.role !== 'model') invalid('Expected a Gemini model turn')
              const parts = array(content.parts)
              for (const [index, raw] of parts.entries()) {
                const part = record(raw)
                if (part.functionCall) {
                  const call = record(part.functionCall)
                  const id = call.id === undefined ? `kj-gemini-${turnNumber}-${index}` : identifier(call.id)
                  if (call.id !== undefined) geminiIds.set(id, identifier(call.id))
                  addCall(id, call.name, call.args ?? {})
                } else if (typeof part.text === 'string') { if (part.thought !== true) text += part.text }
                else invalid('Unsupported Gemini part')
              }
              history.push(content) // Preserve thoughtSignature on its original part.
            }
            if (calls.length > 16 || new Set(calls.map(call => call.id)).size !== calls.length) invalid('Too many calls or duplicate call IDs in one model turn')
            if (!calls.length && !text.trim()) invalid('Model returned neither tool calls nor user-visible text')
            pending = calls
            ended = !calls.length
            return deepFreeze({ text, calls, usage }) as KJModelTurn
          } catch (error) { ended = true; throw error } finally { busy = false }
        },
      }
    },
  })
}
